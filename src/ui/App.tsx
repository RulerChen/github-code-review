import { Fragment, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { comparisonFromQuery, comparisonQuery, repoFailures, sameComparison } from "../shared/comparison";
import type { CommitInfo, Comparison, DiffResult, FileDiff, Grouping, Review, Thread, ThreadAnchor, ViewData } from "../shared/types";
import {
  ApiError,
  createThread,
  deleteComment,
  editComment,
  fetchRefs,
  fetchVersion,
  fetchView,
  groupTopics,
  replyToThread,
  submitReview,
} from "./api";
import { type CommentsApi, CommentsContext } from "./comments";
import { CommitList, CompareControls, refLabel, RepoComparisons } from "./Compare";
import { ConversationsButton, ConversationsPanel, type Place, useConversations } from "./Conversations";
import { FileCard } from "./FileCard";
import { comparePaths, FileTree } from "./FileTree";
import { scrollToTop, startAnchoring } from "./anchor";
import { go, KeyboardButton, ShortcutHelp, stepSection, useShortcuts } from "./keyboard";
import { ReviewBar } from "./ReviewBar";
import { readStorage, writeStorage } from "./storage";
import { SubmitReview } from "./SubmitReview";
import { buildTopics, TopicList, TopicSection, topicShows, type TopicView } from "./Topics";

interface Props {
  viewId: string | null;
}

type Tab = "topics" | "files" | "commits";

// How often the page asks whether the diff changed on disk.
const POLL_MS = 2000;

const signature = (f: FileDiff) => (f.blocks.length ? f.blocks.map((b) => b.id).join(",") : `${f.status}:${f.binary}`);

const sameTarget = (a: Comparison | null, b: Comparison | null) => a === b || (a !== null && b !== null && sameComparison(a, b));

// The review or grouping of a repository's comparison.
const matches = (repo: string, c: Comparison) => (r: { repo: string; compare: Comparison }) => r.repo === repo && sameComparison(r.compare, c);

/** What Claude sends when it opens a view, so the open page shows it. */
interface Opened {
  view: string;
  repo: string;
  compare: Comparison;
}

export function App({ viewId }: Props) {
  const [data, setData] = useState<ViewData | null>(null);
  const [error, setError] = useState<{ message: string; status: number } | null>(null);
  const [loading, setLoading] = useState(false);
  // Whether a different comparison is loading. The page dims what it shows until the new one arrives.
  const [switching, setSwitching] = useState(false);
  // Whether Claude is waiting for a review right now.
  const [listening, setListening] = useState(false);
  // Whether the files or refs changed since the diff on screen was loaded.
  const [stale, setStale] = useState(false);
  const [theme, setTheme] = useState(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  const [tab, setTab] = useState<Tab>("topics");
  const [sidebarOpen, setSidebarOpen] = useState(() => readStorage("diff-review:sidebar", true));
  const showSidebar = (open: boolean) => {
    setSidebarOpen(open);
    writeStorage("diff-review:sidebar", open);
  };
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [viewed, setViewed] = useState<Record<string, string>>({});
  const [viewedTopics, setViewedTopics] = useState<Record<string, string>>({});
  const [threads, setThreads] = useState<Thread[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [groupings, setGroupings] = useState<Grouping[]>([]);
  // The comparison in the page URL, or null for the one Claude opened the viewer with.
  const requested = useRef<Comparison | null>(comparisonFromQuery(new URLSearchParams(location.search)));
  const seq = useRef(0);
  // The version of the diff on screen.
  const version = useRef<string | null>(null);
  // Where each tab was scrolled to, so coming back to one returns to the same place.
  const scrolls = useRef<Partial<Record<Tab, number>>>({});
  // Set when a different comparison arrives, so the page starts it from the top.
  const resetScroll = useRef(false);

  // A different comparison keeps the old one on screen, dimmed, until it arrives, then shows `nextTab` from the
  // top. Switching tabs first would show the old comparison's files in the new tab for a moment. A comparison
  // that arrives without topics shows Files instead of an empty Topics tab, unless the user goes there.
  const load = useCallback(async (target: Comparison | null, push = false, nextTab?: Tab) => {
    if (!viewId) return;
    const n = ++seq.current;
    const other = !sameTarget(target, requested.current);
    setLoading(true);
    if (other) setSwitching(true);
    try {
      const result = await fetchView(viewId, target);
      if (n !== seq.current) return;
      const root = result.diff.repoRoot;
      const fresh = other || version.current === null;
      requested.current = target;
      version.current = result.version;
      if (push && other) history.pushState(null, "", target ? `?${comparisonQuery(target)}` : location.pathname);
      if (other) {
        scrolls.current = {};
        resetScroll.current = true;
      }
      if (nextTab || fresh) {
        const mine = matches(root, result.diff);
        const topical = result.reviews.some(mine) || result.groupings.some((g) => mine(g) && g.error === null);
        setTab((t) => {
          const want = nextTab ?? t;
          return want === "topics" && !topical ? "files" : want;
        });
      }
      setData(result);
      setReviews(result.reviews);
      setGroupings(result.groupings);
      setThreads((prev) => mergeThreads(prev, result.threads));
      setListening(result.listening);
      setError(null);
      setStale(false);
      setViewed((prev) => (Object.keys(prev).length ? prev : readStorage(`diff-review:viewed:${root}`, {})));
      setViewedTopics((prev) => (Object.keys(prev).length ? prev : readStorage(`diff-review:viewed-topics:${root}`, {})));
    } catch (e) {
      if (n !== seq.current) return;
      setError({ message: e instanceof Error ? e.message : String(e), status: e instanceof ApiError ? e.status : 0 });
    } finally {
      if (n === seq.current) {
        setLoading(false);
        setSwitching(false);
      }
    }
  }, [viewId]);

  useEffect(() => {
    void load(requested.current);
    const onPop = () => void load(comparisonFromQuery(new URLSearchParams(location.search)));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [load]);

  // Ask whether the files or refs changed since the diff on screen was loaded, so the refresh button can show.
  // The check is cheap, and waits while the page is hidden. A load that lands meanwhile makes the answer moot.
  useEffect(() => {
    if (!viewId) return;
    let timer = 0;
    let stopped = false;
    const check = async () => {
      const target = requested.current;
      const loaded = version.current;
      const started = performance.now();
      try {
        if (loaded !== null && !document.hidden) {
          const v = await fetchVersion(viewId, target);
          if (!stopped && version.current === loaded && requested.current === target) setStale(v !== loaded);
        }
      } catch {
        // The next check tries again.
      }
      // A check runs git status and reads changed files. In a large working tree that takes a while, so wait ten
      // times as long as it took and polling stays a small part of the load.
      if (!stopped) timer = window.setTimeout(check, Math.max(POLL_MS, 10 * (performance.now() - started)));
    };
    timer = window.setTimeout(check, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [viewId]);

  const loadRefs = useCallback(() => fetchRefs(viewId ?? ""), [viewId]);
  const loadRepoRefs = useCallback((repo: string) => fetchRefs(viewId ?? "", repo), [viewId]);

  const compareWith = (next: Comparison, nextTab?: Tab) => {
    if (data) void load(sameComparison(next, data.opened) ? null : next, true, nextTab);
  };

  const viewCommit = (c: CommitInfo) => compareWith({ base: c.parents[0]!, head: c.sha, threeDot: false, overrides: [] }, "files");

  // A review in another repository is another view's page, opened in place of this one.
  const showReview = (r: { view: string; repo: string; compare: Comparison }) => {
    if (!data) return;
    if (r.repo === data.diff.repoRoot) compareWith(r.compare, "topics");
    else location.assign(`/v/${encodeURIComponent(r.view)}?${comparisonQuery(r.compare)}`);
  };
  const onOpened = useRef(showReview);
  onOpened.current = showReview;

  useEffect(() => {
    if (!viewId) return;
    const events = new EventSource(`/api/views/${encodeURIComponent(viewId)}/events`);
    const on = <T,>(name: string, fn: (data: T) => void) =>
      events.addEventListener(name, (e) => fn(JSON.parse((e as MessageEvent<string>).data) as T));
    on<Thread>("thread", (thread) => setThreads((prev) => mergeThreads(prev, [thread])));
    on<boolean>("listening", setListening);
    on<Review[]>("reviews", setReviews);
    on<Grouping[]>("groupings", setGroupings);
    // Not "open", which EventSource fires itself on connecting.
    on<Opened>("view", (o) => onOpened.current(o));
    return () => events.close();
  }, [viewId]);

  const diff = data?.diff ?? null;
  const current = useMemo<Comparison | null>(
    () => diff && { base: diff.base, head: diff.head, threeDot: diff.threeDot, overrides: diff.overrides },
    [diff],
  );
  // Each repository's directory and the commits of its two sides, as a string so that a refresh that leaves them
  // as they were keeps `comments` as it was.
  const repoCommits = JSON.stringify(diff?.repos.map((r) => [r.dir, r.oldCommit, r.headCommit]) ?? []);
  // A deleted thread stays in `threads` with no comments, so an older copy arriving late cannot bring it back.
  const live = useMemo(() => threads.filter((t) => t.comments.length > 0), [threads]);
  const comments = useMemo<
    Pick<CommentsApi, "versions" | "threadsFor" | "threadsForTopic" | "create" | "reply" | "edit" | "remove" | "pending" | "listening">
  >(() => {
    const byPath = new Map<string, Thread[]>();
    const byTopic = new Map<string, Thread[]>();
    for (const t of live) {
      const { anchor } = t;
      if (anchor.path !== null) byPath.set(anchor.path, [...(byPath.get(anchor.path) ?? []), t]);
      else if (current && sameComparison(anchor.compare, current)) byTopic.set(anchor.topic, [...(byTopic.get(anchor.topic) ?? []), t]);
    }
    const repos = JSON.parse(repoCommits) as [string, string | null, string | null][];
    const versions = (path: string) => {
      const r = repos.find(([dir]) => dir === "" || path.startsWith(`${dir}/`));
      return { old: r?.[1] ?? null, new: r?.[2] ?? null };
    };
    const update = (thread: Thread) => setThreads((prev) => mergeThreads(prev, [thread]));
    return {
      versions,
      threadsFor: (path) => byPath.get(path) ?? [],
      threadsForTopic: (title) => byTopic.get(title) ?? [],
      create: async (anchor, snippet, body, single) => {
        if (!viewId || !current) return;
        const full: ThreadAnchor = anchor.path === null ? { ...anchor, compare: current } : { ...anchor, commit: versions(anchor.path)[anchor.side ?? "new"] };
        update(await createThread(viewId, full, snippet, body, single));
      },
      reply: async (threadId, body, single) => {
        if (viewId) update(await replyToThread(viewId, threadId, body, single));
      },
      edit: async (threadId, commentId, body) => {
        if (viewId) update(await editComment(viewId, threadId, commentId, body));
      },
      remove: async (threadId, commentId) => {
        if (viewId) update(await deleteComment(viewId, threadId, commentId));
      },
      pending: live.some((t) => t.comments.some((c) => c.draft)),
      listening,
    };
  }, [live, viewId, repoCommits, current, listening]);

  const drafts = live.reduce((n, t) => n + t.comments.filter((c) => c.draft).length, 0);
  const submit = async (body: string) => {
    if (!viewId) return false;
    const result = await submitReview(viewId, body);
    setThreads((prev) => mergeThreads(prev, result.threads));
    return result.delivered;
  };

  const review = useMemo(() => (diff ? (reviews.find(matches(diff.repoRoot, diff)) ?? null) : null), [reviews, diff]);
  const grouping = diff ? (groupings.find(matches(diff.repoRoot, diff)) ?? null) : null;
  const group = async (focus: string) => {
    if (viewId && current) setGroupings(await groupTopics(viewId, current, focus));
  };

  const entries = useMemo(
    () =>
      [...(diff?.files ?? [])]
        .sort((a, b) => comparePaths(a.path, b.path))
        .map((file, i) => ({ file, anchor: `file-${i}` })),
    [diff],
  );
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? entries.filter((e) => e.file.path.toLowerCase().includes(q)) : entries;
  }, [entries, filter]);
  const topics = useMemo(() => (review ? buildTopics(review, entries.map((e) => e.file)) : []), [review, entries]);

  const view: Tab = tab === "topics" ? "topics" : tab === "commits" && diff?.commits.length ? "commits" : "files";
  const topicTab = view === "topics" && topics.length > 0;

  useEffect(() => (diff !== null ? startAnchoring() : undefined), [diff !== null]);

  // A tab's content stays mounted once shown and is hidden while another tab shows, so it keeps its layout, and
  // the page scrolls back to where that tab was.
  const visited = useRef(new Set<Tab>());
  visited.current.add(view);
  const shownView = useRef(view);
  useEffect(() => {
    const onScroll = () => {
      scrolls.current[shownView.current] = window.scrollY;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // A file picked in the sidebar of the Commits tab, to show once the Files tab is on screen.
  const pendingSelect = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (shownView.current === view) return;
    shownView.current = view;
    window.scrollTo(0, scrolls.current[view] ?? 0);
    const target = pendingSelect.current && document.getElementById(pendingSelect.current);
    pendingSelect.current = null;
    if (target) go(target, setActive);
  }, [view]);
  useLayoutEffect(() => {
    if (!resetScroll.current) return;
    resetScroll.current = false;
    scrollToTop();
  });
  const place = useCallback(
    (t: Thread): Place | null => {
      const { anchor } = t;
      if (anchor.path === null) {
        // A topic's own thread shows only in the Topics tab. In the list it comes before the files.
        if (!current || !sameComparison(anchor.compare, current)) return null;
        const i = topics.findIndex((topic) => topic.title === anchor.topic);
        return i < 0 ? null : { tab: "topics", rank: topicTab ? i : i - topics.length };
      }
      const fileIndex = entries.findIndex((e) => e.file.path === anchor.path);
      if (fileIndex < 0) return null;
      if (!topicTab) return { tab: "files", rank: fileIndex };
      const topicIndex = topics.findIndex((topic) => topicShows(topic, t, comments.versions));
      return topicIndex >= 0 ? { tab: "topics", rank: topicIndex } : { tab: "files", rank: topics.length + fileIndex };
    },
    [entries, topics, topicTab, comments.versions, current],
  );
  const conv = useConversations({
    repoRoot: diff?.repoRoot ?? null,
    threads: live,
    place,
    show: (t, p) => {
      if (topicTab || tab === "commits" || p.tab === "topics") setTab(p.tab);
      const { path } = t.anchor;
      if (p.tab === "files" && path !== null && !path.toLowerCase().includes(filter.trim().toLowerCase())) setFilter("");
    },
  });
  const commentsValue = useMemo(() => ({ ...comments, ...conv.api }), [comments, conv.api]);
  const [help, setHelp] = useState(false);
  useShortcuts({
    j: () => stepSection(1, active, setActive),
    k: () => stepSection(-1, active, setActive),
    u: conv.nextUnread,
    Escape: () => (help ? setHelp(false) : conv.setOpen(false)),
  });

  const isViewed = useCallback((f: FileDiff) => viewed[f.path] === signature(f), [viewed]);
  const toggleViewed = (f: FileDiff) => {
    if (!diff) return;
    const next = { ...viewed };
    if (isViewed(f)) delete next[f.path];
    else next[f.path] = signature(f);
    setViewed(next);
    writeStorage(`diff-review:viewed:${diff.repoRoot}`, next);
  };

  const isTopicViewed = useCallback((t: TopicView) => viewedTopics[t.key] === t.signature, [viewedTopics]);
  const toggleTopicViewed = (t: TopicView) => {
    if (!diff) return;
    const next = { ...viewedTopics };
    if (isTopicViewed(t)) delete next[t.key];
    else next[t.key] = t.signature;
    setViewedTopics(next);
    writeStorage(`diff-review:viewed-topics:${diff.repoRoot}`, next);
  };

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    writeStorage("diff-review:theme", next);
    setTheme(next);
  };

  const select = (anchor: string) => {
    if (view === "commits") {
      pendingSelect.current = anchor;
      setTab("files");
      return;
    }
    const el = document.getElementById(anchor);
    if (el) go(el, setActive);
    else setActive(anchor);
  };

  if (!viewId) {
    return <Notice title="This link is incomplete">Open the exact link Claude gave you.</Notice>;
  }
  if (error && !diff) {
    const hint =
      error.status === 404 ? "The server restarted since this link was made. Ask Claude to open the viewer again." : null;
    return (
      <Notice title="Could not load the diff">
        {error.message}
        {hint && <p>{hint}</p>}
        {!hint && requested.current && (
          <p>
            <a href={location.pathname}>Open the comparison Claude chose</a>
          </p>
        )}
      </Notice>
    );
  }
  if (!diff) return <Notice title="Loading diff…" />;

  const byTopic = view === "topics";
  const additions = diff.files.reduce((s, f) => s + f.additions, 0);
  const deletions = diff.files.reduce((s, f) => s + f.deletions, 0);
  const total = byTopic ? topics.length : diff.files.length;
  const viewedCount = byTopic ? topics.filter(isTopicViewed).length : diff.files.filter(isViewed).length;
  const unit = byTopic ? "topics" : "files";
  const firstUnrelated = topics.findIndex((t) => !t.related);

  return (
    <CommentsContext.Provider value={commentsValue}>
      <div className="app">
        <header className="topbar">
          <div className={`loading-bar${switching ? " is-active" : ""}`} aria-hidden="true" />
          <SidebarToggle open={sidebarOpen} onToggle={() => showSidebar(!sidebarOpen)} />
          <div className="topbar-title">
            <CompareControls diff={diff} loadRefs={loadRefs} onCompare={compareWith} />
          </div>
          <div className="topbar-stats">
            <span>
              {diff.files.length} file{diff.files.length === 1 ? "" : "s"} changed
            </span>
            <span className="count-add">+{additions.toLocaleString()}</span>
            <span className="count-del">−{deletions.toLocaleString()}</span>
          </div>
          <RefreshButton stale={stale} loading={loading} onClick={() => void load(requested.current)} />
          <span className="spacer" />
          <div className="viewed-progress" title={`${viewedCount} of ${total} ${unit} viewed`}>
            <span className="viewed-count" style={{ minWidth: `${2 * String(Math.max(topics.length, diff.files.length)).length + 10}ch` }}>
              {viewedCount} / {total} viewed
            </span>
            <span className="progress" aria-hidden="true">
              <span style={{ width: `${total ? (viewedCount / total) * 100 : 0}%` }} />
            </span>
          </div>
          <div className="segmented" role="tablist" aria-label="Show">
            <SlidingIndicator selected={view} />
            <button role="tab" aria-selected={view === "topics"} onClick={() => setTab("topics")}>
              <TabLabel text="Topics" />
            </button>
            <button role="tab" aria-selected={view === "files"} onClick={() => setTab("files")}>
              <TabLabel text="Files" />
            </button>
            {diff.commits.length > 0 && (
              <button role="tab" aria-selected={view === "commits"} onClick={() => setTab("commits")}>
                <TabLabel text="Commits" /> <span className="counter">{diff.commitCount.toLocaleString()}</span>
              </button>
            )}
          </div>
          <ConversationsButton conv={conv} />
          <KeyboardButton onClick={() => setHelp(true)} />
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <SubmitReview drafts={drafts} listening={listening} onSubmit={submit} />
        </header>

        {error && <div className="banner">{error.message}</div>}

        <div className={`layout${conv.open ? " with-conversations" : ""}${sidebarOpen ? "" : " no-sidebar"}`}>
          {/* The Commits tab keeps the file tree, so switching tabs does not move the page sideways. */}
          <aside className="sidebar" hidden={!sidebarOpen}>
            {byTopic ? (
              <div className="view" key="topics">
                <TopicList topics={topics} active={active} isViewed={isTopicViewed} onSelect={select} />
              </div>
            ) : (
              <div className="view" key="files">
                <input
                  className="filter"
                  type="search"
                  placeholder="Filter files"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  aria-label="Filter files"
                />
                <FileTree entries={shown} active={view === "files" ? active : null} isViewed={isViewed} onSelect={select} />
              </div>
            )}
          </aside>

          <main className={`files${switching ? " is-switching" : ""}`}>
            <RepoComparisons diff={diff} loadRefs={loadRepoRefs} onCompare={compareWith} />
            {repoFailures(diff.repos).map((f) => (
              <p key={f.error} className="file-note inline">
                Not compared in {f.dirs.join(", ")}: {f.error}
              </p>
            ))}
            {view !== "commits" && diff.files.length === 0 && <Notice title="No changes">{noChanges(diff)}</Notice>}
            {visited.current.has("topics") && (
              <div className="view" hidden={view !== "topics"}>
                <ReviewBar
                  reviews={reviews}
                  review={review}
                  grouping={grouping}
                  repoRoot={diff.repoRoot}
                  hasChanges={diff.files.length > 0}
                  onPick={showReview}
                  onGroup={group}
                />
                {topics.map((t, i) => (
                  <Fragment key={t.key}>
                    {i === firstUnrelated && <h2 className="topic-divider">Not related to the focus</h2>}
                    <TopicSection topic={t} viewed={isTopicViewed(t)} onToggleViewed={() => toggleTopicViewed(t)} />
                  </Fragment>
                ))}
              </div>
            )}
            {visited.current.has("files") && diff.files.length > 0 && (
              <div className="view" hidden={view !== "files"}>
                {shown.map(({ file, anchor }) => (
                  <FileCard
                    key={file.path}
                    file={file}
                    anchor={anchor}
                    viewed={isViewed(file)}
                    onToggleViewed={() => toggleViewed(file)}
                  />
                ))}
              </div>
            )}
            {visited.current.has("commits") && diff.commits.length > 0 && (
              <div className="view" hidden={view !== "commits"}>
                <CommitList diff={diff} onView={viewCommit} />
              </div>
            )}
          </main>
        </div>
        {conv.open && <ConversationsPanel conv={conv} />}
      </div>
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
    </CommentsContext.Provider>
  );
}

// Fetches, POST responses and events can arrive out of order, so keep whichever copy of a thread
// is newest. On a tie the update wins: a snapshot can hold streamed text not yet sent as an event.
function mergeThreads(base: Thread[], updates: Thread[]): Thread[] {
  const next = [...base];
  for (const t of updates) {
    const i = next.findIndex((x) => x.id === t.id);
    const current = next[i];
    if (!current) next.push(t);
    else if (t.rev >= current.rev) next[i] = t;
  }
  return next;
}

function noChanges(d: DiffResult): ReactNode {
  const from =
    d.threeDot && d.oldCommit && d.oldCommit !== d.baseCommit ? (
      <>
        the merge base of <code>{refLabel(d.base)}</code> and <code>{refLabel(d.head ?? "HEAD")}</code>
      </>
    ) : (
      <code>{refLabel(d.base)}</code>
    );
  return d.head === null ? <>The working tree matches {from}.</> : <><code>{refLabel(d.head)}</code> has the same files as {from}.</>;
}

// Octicons sidebar-collapse-16 and sidebar-expand-16 draw the panel on the right; mirror them for a left sidebar.
const SIDEBAR_ICON = {
  collapse: [
    "M6.823 7.823a.25.25 0 0 1 0 .354l-2.396 2.396A.25.25 0 0 1 4 10.396V5.604a.25.25 0 0 1 .427-.177Z",
    "M1.75 0h12.5C15.216 0 16 .784 16 1.75v12.5A1.75 1.75 0 0 1 14.25 16H1.75A1.75 1.75 0 0 1 0 14.25V1.75C0 .784.784 0 1.75 0ZM1.5 1.75v12.5c0 .138.112.25.25.25H9.5v-13H1.75a.25.25 0 0 0-.25.25ZM11 14.5h3.25a.25.25 0 0 0 .25-.25V1.75a.25.25 0 0 0-.25-.25H11Z",
  ],
  expand: [
    "m4.177 7.823 2.396-2.396A.25.25 0 0 1 7 5.604v4.792a.25.25 0 0 1-.427.177L4.177 8.177a.25.25 0 0 1 0-.354Z",
    "M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v12.5A1.75 1.75 0 0 1 14.25 16H1.75A1.75 1.75 0 0 1 0 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25H9.5v-13Zm12.5 13a.25.25 0 0 0 .25-.25V1.75a.25.25 0 0 0-.25-.25H11v13Z",
  ],
};

function SidebarToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const label = open ? "Collapse sidebar" : "Expand sidebar";
  return (
    <button className="icon-button sidebar-toggle" onClick={onToggle} aria-label={label} aria-expanded={open} title={label}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <g transform="matrix(-1 0 0 1 16 0)">
          {SIDEBAR_ICON[open ? "collapse" : "expand"].map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
      </svg>
    </button>
  );
}

// The selected tab's background, which slides to the tab picked. It shows by clipping a box as wide as the whole
// control, since clip-path animates without layout. It moves only once it has been placed, so it does not slide in
// from the side when the page loads.
function SlidingIndicator({ selected }: { selected: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    const place = () => {
      const tab = box.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!tab) return;
      el.style.clipPath = `inset(0 ${box.clientWidth - tab.offsetLeft - tab.offsetWidth}px 0 ${tab.offsetLeft}px)`;
    };
    place();
    const frame = requestAnimationFrame(() => (el.dataset.ready = ""));
    const observer = new ResizeObserver(place);
    observer.observe(box);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [selected]);
  return <span ref={ref} className="segmented-indicator" aria-hidden="true" />;
}

// The selected tab's label is bold. Each label is as wide as its bold text, so selecting a tab moves nothing.
function TabLabel({ text }: { text: string }) {
  return (
    <span className="tab-label" data-text={text}>
      {text}
    </span>
  );
}

// Shows only when the diff on disk changed. Hidden, it keeps its slot next to the stats, so showing it moves
// nothing in the top bar.
function RefreshButton({ stale, loading, onClick }: { stale: boolean; loading: boolean; onClick: () => void }) {
  const label = "Load new changes";
  return (
    <button
      className={`icon-button refresh-button${stale ? " is-shown" : ""}${loading ? " is-loading" : ""}`}
      onClick={onClick}
      disabled={!stale || loading}
      aria-label={label}
      title={label}
    >
      {/* Octicon sync-16, @primer/octicons 19.42.0 */}
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z" />
      </svg>
    </button>
  );
}

function ThemeToggle({ theme, onToggle }: { theme: string; onToggle: () => void }) {
  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button className="icon-button theme-toggle" onClick={onToggle} aria-label={label} title={label}>
      {theme === "dark" ? (
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <circle cx="8" cy="8" r="3" />
          <path
            d="M8 0.75v1.5M8 13.75v1.5M0.75 8h1.5M13.75 8h1.5M2.87 2.87l1.06 1.06M12.07 12.07l1.06 1.06M2.87 13.13l1.06-1.06M12.07 3.93l1.06-1.06"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M6.2 1.1a6.75 6.75 0 1 0 8.7 8.7A5.5 5.5 0 0 1 6.2 1.1Z" />
        </svg>
      )}
    </button>
  );
}

function Notice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="notice">
      <h1>{title}</h1>
      {children && <div>{children}</div>}
    </div>
  );
}
