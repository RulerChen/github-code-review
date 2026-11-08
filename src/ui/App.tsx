import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CommitInfo, Comparison, DiffResult, FileDiff, Thread, ViewData } from "../shared/types";
import { ApiError, comparisonFromQuery, comparisonQuery, createThread, fetchRefs, fetchVersion, fetchView, replyToThread, submitReview } from "./api";
import { type CommentsApi, CommentsContext } from "./comments";
import { CommitList, CompareControls, refLabel, sameComparison } from "./Compare";
import { ConversationsButton, ConversationsPanel, type Place, useConversations } from "./Conversations";
import { FileCard } from "./FileCard";
import { comparePaths, FileTree } from "./FileTree";
import { stepSection, useShortcuts } from "./keyboard";
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

export function App({ viewId }: Props) {
  const [data, setData] = useState<ViewData | null>(null);
  const [error, setError] = useState<{ message: string; status: number } | null>(null);
  const [loading, setLoading] = useState(false);
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
  // The comparison in the page URL, or null for the one Claude opened the viewer with.
  const requested = useRef<Comparison | null>(comparisonFromQuery(location.search));
  const seq = useRef(0);
  // The version of the diff on screen.
  const version = useRef<string | null>(null);

  const load = useCallback(async (target: Comparison | null, push = false) => {
    if (!viewId) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const result = await fetchView(viewId, target);
      if (n !== seq.current) return;
      const root = result.diff.repoRoot;
      requested.current = target;
      version.current = result.version;
      if (push) history.pushState(null, "", target ? `?${comparisonQuery(target)}` : location.pathname);
      setData(result);
      setThreads((prev) => mergeThreads(prev, result.threads));
      setError(null);
      setStale(false);
      setViewed((prev) => (Object.keys(prev).length ? prev : readStorage(`diff-review:viewed:${root}`, {})));
      setViewedTopics((prev) => (Object.keys(prev).length ? prev : readStorage(`diff-review:viewed-topics:${root}`, {})));
    } catch (e) {
      if (n !== seq.current) return;
      setError({ message: e instanceof Error ? e.message : String(e), status: e instanceof ApiError ? e.status : 0 });
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [viewId]);

  useEffect(() => {
    void load(requested.current);
    const onPop = () => void load(comparisonFromQuery(location.search));
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
      try {
        if (loaded !== null && !document.hidden) {
          const v = await fetchVersion(viewId, target);
          if (!stopped && version.current === loaded && requested.current === target) setStale(v !== loaded);
        }
      } catch {
        // The next check tries again.
      }
      if (!stopped) timer = window.setTimeout(check, POLL_MS);
    };
    timer = window.setTimeout(check, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [viewId]);

  const loadRefs = useCallback(() => fetchRefs(viewId ?? ""), [viewId]);

  const compareWith = (next: Comparison) => {
    if (data) void load(sameComparison(next, data.opened) ? null : next, true);
  };

  const viewCommit = (c: CommitInfo) => {
    setTab("files");
    compareWith({ base: c.parents[0]!, head: c.sha, threeDot: false });
  };

  useEffect(() => {
    if (!viewId) return;
    const events = new EventSource(`/api/views/${encodeURIComponent(viewId)}/events`);
    events.addEventListener("thread", (e) => {
      const thread = JSON.parse((e as MessageEvent<string>).data) as Thread;
      setThreads((prev) => mergeThreads(prev, [thread]));
    });
    return () => events.close();
  }, [viewId]);

  const oldCommit = data?.diff.oldCommit ?? null;
  const headCommit = data?.diff.headCommit ?? null;
  const comments = useMemo<Pick<CommentsApi, "versions" | "threadsFor" | "create" | "reply">>(() => {
    const byPath = new Map<string, Thread[]>();
    for (const t of threads) byPath.set(t.anchor.path, [...(byPath.get(t.anchor.path) ?? []), t]);
    const versions = { old: oldCommit, new: headCommit };
    return {
      versions,
      threadsFor: (path) => byPath.get(path) ?? [],
      create: async (anchor, snippet, body) => {
        if (!viewId) return;
        const thread = await createThread(viewId, { ...anchor, commit: versions[anchor.side ?? "new"] }, snippet, body);
        setThreads((prev) => mergeThreads(prev, [thread]));
      },
      reply: async (threadId: string, body: string) => {
        if (!viewId) return;
        const thread = await replyToThread(viewId, threadId, body);
        setThreads((prev) => mergeThreads(prev, [thread]));
      },
    };
  }, [threads, viewId, oldCommit, headCommit]);

  const drafts = threads.reduce((n, t) => n + t.comments.filter((c) => c.draft).length, 0);
  const submit = async (body: string) => {
    if (!viewId) return false;
    const result = await submitReview(viewId, body);
    setThreads((prev) => mergeThreads(prev, result.threads));
    return result.delivered;
  };

  const diff = data?.diff ?? null;
  const review = data?.review ?? null;
  const isOpened = data !== null && sameComparison(data.diff, data.opened);

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
  const topics = useMemo(
    () => (review && isOpened ? buildTopics(review, entries.map((e) => e.file)) : []),
    [review, isOpened, entries],
  );

  const topicTab = review !== null && isOpened && tab === "topics";
  const place = useCallback(
    (t: Thread): Place | null => {
      const fileIndex = entries.findIndex((e) => e.file.path === t.anchor.path);
      if (fileIndex < 0) return null;
      if (!topicTab) return { tab: "files", rank: fileIndex };
      const topicIndex = topics.findIndex((topic) => topicShows(topic, t, comments.versions));
      return topicIndex >= 0 ? { tab: "topics", rank: topicIndex } : { tab: "files", rank: topics.length + fileIndex };
    },
    [entries, topics, topicTab, comments.versions],
  );
  const conv = useConversations({
    repoRoot: diff?.repoRoot ?? null,
    threads,
    place,
    show: (t, p) => {
      if (topicTab || tab === "commits") setTab(p.tab);
      if (p.tab === "files" && !t.anchor.path.toLowerCase().includes(filter.trim().toLowerCase())) setFilter("");
    },
  });
  const commentsValue = useMemo(() => ({ ...comments, ...conv.api }), [comments, conv.api]);
  useShortcuts({
    j: () => stepSection(1, active, setActive),
    k: () => stepSection(-1, active, setActive),
    u: conv.nextUnread,
    Escape: () => conv.setOpen(false),
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
    setActive(anchor);
    document.getElementById(anchor)?.scrollIntoView({ block: "start" });
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

  const view: Tab = tab === "topics" && review && isOpened ? "topics" : tab === "commits" && diff.commits.length ? "commits" : "files";
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
          {view !== "commits" && <SidebarToggle open={sidebarOpen} onToggle={() => showSidebar(!sidebarOpen)} />}
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
            <span>
              {viewedCount} / {total} viewed
            </span>
            <span className="progress" aria-hidden="true">
              <span style={{ width: `${total ? (viewedCount / total) * 100 : 0}%` }} />
            </span>
          </div>
          {(review || diff.commits.length > 0) && (
            <div className="segmented" role="tablist" aria-label="Show">
              {review && (
                <button
                  role="tab"
                  aria-selected={view === "topics"}
                  title={isOpened ? undefined : `Claude's topics are for ${describe(data!.opened)}. Go back to it.`}
                  onClick={() => {
                    setTab("topics");
                    if (!isOpened) compareWith(data!.opened);
                  }}
                >
                  Topics
                </button>
              )}
              <button role="tab" aria-selected={view === "files"} onClick={() => setTab("files")}>
                Files
              </button>
              {diff.commits.length > 0 && (
                <button role="tab" aria-selected={view === "commits"} onClick={() => setTab("commits")}>
                  Commits <span className="counter">{diff.commitCount.toLocaleString()}</span>
                </button>
              )}
            </div>
          )}
          <ConversationsButton conv={conv} />
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <SubmitReview drafts={drafts} onSubmit={submit} />
        </header>

        {error && <div className="banner">{error.message}</div>}

        <div className={`layout${conv.open ? " with-conversations" : ""}${view === "commits" || !sidebarOpen ? " no-sidebar" : ""}`}>
          <aside className="sidebar" hidden={view === "commits" || !sidebarOpen}>
            {byTopic ? (
              <TopicList topics={topics} active={active} isViewed={isTopicViewed} onSelect={select} />
            ) : (
              <>
                <input
                  className="filter"
                  type="search"
                  placeholder="Filter files"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  aria-label="Filter files"
                />
                <FileTree entries={shown} active={active} isViewed={isViewed} onSelect={select} />
              </>
            )}
          </aside>

          <main className="files">
            {view === "commits" ? (
              <CommitList diff={diff} onView={viewCommit} />
            ) : diff.files.length === 0 ? (
              <Notice title="No changes">{noChanges(diff)}</Notice>
            ) : byTopic && review ? (
              <>
                {review.focus && (
                  <p className="focus">
                    Focus: <strong>{review.focus}</strong>
                  </p>
                )}
                {topics.map((t, i) => (
                  <Fragment key={t.key}>
                    {i === firstUnrelated && <h2 className="topic-divider">Not related to the focus</h2>}
                    <TopicSection topic={t} viewed={isTopicViewed(t)} onToggleViewed={() => toggleTopicViewed(t)} />
                  </Fragment>
                ))}
              </>
            ) : (
              shown.map(({ file, anchor }) => (
                <FileCard
                  key={file.path}
                  file={file}
                  anchor={anchor}
                  viewed={isViewed(file)}
                  onToggleViewed={() => toggleViewed(file)}
                />
              ))
            )}
          </main>
        </div>
        {conv.open && <ConversationsPanel conv={conv} />}
      </div>
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

function describe(c: Comparison): string {
  return `${refLabel(c.base)}${c.threeDot ? "..." : ".."}${refLabel(c.head)}`;
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
