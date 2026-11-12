import { type ReactNode, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { contextOf } from "../shared/comments";
import { comparisonFromQuery, comparisonQuery, isFor, repoFailures, sameComparison } from "../shared/comparison";
import { splitLines } from "../shared/hunks";
import type { CommitInfo, Comparison, DiffResult, FileDiff, Grouping, Review, Thread, ThreadAnchor, ViewData } from "../shared/types";
import { errorMessage, sum } from "../shared/util";
import { followActiveFile } from "./active";
import { scrollToTop, startAnchoring } from "./anchor";
import {
  ApiError,
  createThread,
  deleteComment,
  deleteReview,
  editComment,
  fetchFile,
  fetchRefs,
  fetchVersion,
  fetchView,
  groupTopics,
  replyToThread,
  submitReview,
  type TopicRequest,
  viewUrl,
} from "./api";
import { type CommentActions, CommentActionsContext, type CommentsApi, CommentsContext } from "./comments";
import { CommitBar, CommitList, CompareControls, refLabel, RepoComparisons } from "./Compare";
import { ConversationsButton, ConversationsPanel, type Place, useConversations } from "./Conversations";
import { FileCard, FileLoader } from "./FileCard";
import { dirPaths, FileTree } from "./FileTree";
import { FoldIcon } from "./icons";
import { go, KeyboardButton, ShortcutHelp, stepSection, useShortcuts } from "./keyboard";
import { locate } from "./locate";
import { comparePaths } from "./paths";
import { ReviewBar } from "./ReviewBar";
import { type Hit, revealLine, searchDiff, SearchResults } from "./Search";
import { useStoredState, useViewed } from "./storage";
import { SubmitReview } from "./SubmitReview";
import { ChangeStats, RefreshButton, SidebarToggle, type Tab, ThemeToggle, ViewTabs } from "./TopBar";
import { buildTopics, TopicSection, topicShows, type TopicView } from "./Topics";

interface Props {
  viewId: string | null;
}

const POLL_MS = 2000;
const NO_THREADS: Thread[] = [];

const signature = (f: FileDiff) => (f.blocks.length ? f.blocks.map((b) => b.id).join(",") : `${f.status}:${f.binary}`);

const sameTarget = (a: Comparison | null, b: Comparison | null) => a === b || (a !== null && b !== null && sameComparison(a, b));

interface Opened {
  view: string;
  repo: string;
  compare: Comparison;
}

interface CommitRange {
  compare: Comparison | null;
  commits: CommitInfo[];
  count: number;
}

const savedRange = () => (history.state as { range?: CommitRange } | null)?.range ?? null;

const commitComparison = (c: CommitInfo): Comparison => ({ base: c.parents[0]!, head: c.sha, threeDot: false, overrides: [] });

export function App({ viewId }: Props) {
  const [data, setData] = useState<ViewData | null>(null);
  const [error, setError] = useState<{ message: string; status: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [listening, setListening] = useState(false);
  const [stale, setStale] = useState(false);

  const [tab, setTab] = useState<Tab>("topics");
  const [sidebarOpen, setSidebarOpen] = useStoredState("diff-review:sidebar", true);
  const [filter, setFilter] = useState("");
  const [foldedDirs, setFoldedDirs] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [hit, setHit] = useState<Hit | null>(null);

  const [threads, setThreads] = useState<Thread[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [pickedAt, setPickedAt] = useState(() => new URLSearchParams(location.search).get("review"));
  const [groupings, setGroupings] = useState<Grouping[]>([]);
  const [range, setRange] = useState(savedRange);

  const requested = useRef<Comparison | null>(comparisonFromQuery(new URLSearchParams(location.search)));
  const seq = useRef(0);
  const version = useRef<string | null>(null);
  const scrolls = useRef<Partial<Record<Tab, number>>>({});
  const resetScroll = useRef(false);

  const load = useCallback(async (target: Comparison | null, push = false, nextTab?: Tab, nextRange: CommitRange | null = null) => {
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
      if (push && other) history.pushState(nextRange && { range: nextRange }, "", target ? `?${comparisonQuery(target)}` : location.pathname);
      if (other) {
        scrolls.current = {};
        resetScroll.current = true;
        setRange(nextRange);
      }
      if (nextTab || fresh) {
        const mine = isFor(root, result.diff);
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
    } catch (e) {
      if (n !== seq.current) return;
      setError({ message: errorMessage(e), status: e instanceof ApiError ? e.status : 0 });
    } finally {
      if (n === seq.current) {
        setLoading(false);
        setSwitching(false);
      }
    }
  }, [viewId]);

  useEffect(() => {
    void load(requested.current);
    const onPop = () => void load(comparisonFromQuery(new URLSearchParams(location.search)), false, undefined, savedRange());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [load]);

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
      } catch {}
      if (!stopped) timer = window.setTimeout(check, Math.max(POLL_MS, 10 * (performance.now() - started)));
    };
    timer = window.setTimeout(check, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [viewId]);

  const loadFile = useCallback(
    async (path: string) => {
      const loaded = version.current;
      if (!viewId || loaded === null) return;
      const file = await fetchFile(viewId, requested.current, loaded, path);
      setData((d) => (d && version.current === loaded ? { ...d, diff: { ...d.diff, files: d.diff.files.map((f) => (f.path === path ? file : f)) } } : d));
    },
    [viewId],
  );

  const loadRefs = useCallback((repo?: string) => fetchRefs(viewId ?? "", repo), [viewId]);

  const diff = data?.diff ?? null;
  const compareWith = (next: Comparison, nextTab?: Tab, nextRange: CommitRange | null = null) => {
    if (data) void load(sameComparison(next, data.opened) ? null : next, true, nextTab, nextRange);
  };

  const stepIndex = range && diff ? range.commits.findIndex((c) => c.parents.length > 0 && sameComparison(commitComparison(c), diff)) : -1;
  const stepping = stepIndex >= 0 ? range : null;

  const viewCommit = (c: CommitInfo) => {
    if (!diff) return;
    const outer = stepping ?? { compare: requested.current, commits: diff.commits, count: diff.commitCount };
    compareWith(commitComparison(c), "files", outer);
  };
  const showAllCommits = () => stepping && void load(stepping.compare, true);

  const showReview = (r: Opened, at: string | null = null) => {
    if (!diff) return;
    setPickedAt(at);
    if (r.repo === diff.repoRoot) compareWith(r.compare, "topics");
    else location.assign(`/v/${encodeURIComponent(r.view)}?${comparisonQuery(r.compare)}${at ? `&review=${encodeURIComponent(at)}` : ""}`);
  };

  const reviewCount = useRef<number | null>(null);
  useEffect(() => {
    if (!data) return;
    if (reviewCount.current !== null && reviews.length > reviewCount.current) setPickedAt(null);
    reviewCount.current = reviews.length;
  }, [data !== null, reviews]);

  const onOpened = useRef(showReview);
  onOpened.current = showReview;

  useEffect(() => {
    if (!viewId) return;
    const events = new EventSource(viewUrl(viewId, "events"));
    const on = <T,>(name: string, fn: (data: T) => void) =>
      events.addEventListener(name, (e) => fn(JSON.parse((e as MessageEvent<string>).data) as T));
    on<Thread>("thread", (thread) => setThreads((prev) => mergeThreads(prev, [thread])));
    on<boolean>("listening", setListening);
    on<Review[]>("reviews", setReviews);
    on<Grouping[]>("groupings", setGroupings);
    on<Opened>("view", (o) => onOpened.current(o));
    return () => events.close();
  }, [viewId]);

  const current = useMemo<Comparison | null>(
    () => diff && { base: diff.base, head: diff.head, threeDot: diff.threeDot, overrides: diff.overrides },
    [diff?.base, diff?.head, diff?.threeDot, diff?.overrides],
  );
  const repoCommits = JSON.stringify(diff?.repos.map((r) => [r.dir, r.oldCommit, r.headCommit]) ?? []);

  const newLines = useMemo(() => {
    const cache = new Map<string, string[] | null>();
    return (path: string) => {
      let lines = cache.get(path);
      if (lines === undefined) {
        const text = diff?.files.find((f) => f.path === path)?.newContent ?? null;
        lines = text === null ? null : splitLines(text);
        cache.set(path, lines);
      }
      return lines;
    };
  }, [diff]);
  const latestLines = useRef(newLines);
  latestLines.current = newLines;

  const actions = useMemo<CommentActions>(() => {
    const repos = JSON.parse(repoCommits) as [string, string | null, string | null][];
    const versions = (path: string) => {
      const r = repos.find(([dir]) => dir === "" || path.startsWith(`${dir}/`));
      return { old: r?.[1] ?? null, new: r?.[2] ?? null };
    };
    const update = (thread: Thread) => setThreads((prev) => mergeThreads(prev, [thread]));

    return {
      versions,
      create: async (anchor, snippet, body, single) => {
        if (!viewId || !current) return;
        const full: ThreadAnchor = anchor.path === null ? { ...anchor, compare: current } : { ...anchor, commit: versions(anchor.path)[anchor.side ?? "new"] };
        const lines = full.side === "new" && full.commit === null ? latestLines.current(full.path) : null;
        const context = lines && full.side !== null ? contextOf(lines, full.start, full.end) : null;
        update(await createThread(viewId, full, snippet, context, body, single));
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
    };
  }, [viewId, repoCommits, current]);

  const placed = useMemo(() => {
    const cache = new WeakMap<Thread, Thread>();
    return (t: Thread) => {
      let p = cache.get(t);
      if (!p) {
        const { anchor } = t;
        const onWorkingTree = anchor.side === "new" && anchor.commit === null && actions.versions(anchor.path).new === null;
        const lines = onWorkingTree ? newLines(anchor.path) : null;
        p = lines ? locate(t, lines) : t;
        cache.set(t, p);
      }
      return p;
    };
  }, [newLines, actions]);
  const live = useMemo(() => threads.filter((t) => t.comments.length > 0).map(placed), [threads, placed]);

  const pathThreads = useRef(new Map<string, Thread[]>());
  const comments = useMemo<Pick<CommentsApi, keyof CommentActions | "threadsFor" | "threadsForTopic" | "pending" | "listening">>(() => {
    const byPath = new Map<string, Thread[]>();
    const byTopic = new Map<string, Thread[]>();
    const add = (map: Map<string, Thread[]>, key: string, t: Thread) => {
      const list = map.get(key);
      if (list) list.push(t);
      else map.set(key, [t]);
    };
    for (const t of live) {
      const { anchor } = t;
      if (anchor.path !== null) add(byPath, anchor.path, t);
      else if (current && sameComparison(anchor.compare, current)) add(byTopic, anchor.topic, t);
    }

    for (const [path, list] of byPath) {
      const old = pathThreads.current.get(path);
      if (old && old.length === list.length && old.every((t, i) => t === list[i])) byPath.set(path, old);
    }
    pathThreads.current = byPath;

    return {
      ...actions,
      threadsFor: (path) => byPath.get(path) ?? NO_THREADS,
      threadsForTopic: (title) => byTopic.get(title) ?? NO_THREADS,
      pending: live.some((t) => t.comments.some((c) => c.draft)),
      listening,
    };
  }, [live, actions, current, listening]);

  const drafts = sum(live, (t) => t.comments.filter((c) => c.draft).length);
  const submit = async (body: string) => {
    if (!viewId) return false;
    const result = await submitReview(viewId, body);
    setThreads((prev) => mergeThreads(prev, result.threads));
    return result.delivered;
  };

  const review = useMemo(() => {
    if (!diff) return null;
    const mine = reviews.filter(isFor(diff.repoRoot, diff));
    return mine.find((r) => r.createdAt === pickedAt) ?? mine.at(-1) ?? null;
  }, [reviews, diff, pickedAt]);
  const grouping = diff ? (groupings.find(isFor(diff.repoRoot, diff)) ?? null) : null;
  const group = async (ask: TopicRequest) => {
    if (viewId && current) setGroupings(await groupTopics(viewId, current, ask));
  };
  const removeReview = async (r: Review) => {
    if (viewId) setReviews(await deleteReview(viewId, r));
  };

  const entries = useMemo(
    () =>
      [...(diff?.files ?? [])]
        .sort((a, b) => comparePaths(a.path, b.path))
        .map((file, i) => ({ file, anchor: `file-${i}` })),
    [diff],
  );
  const shown = useMemo(() => matching(entries, filter), [entries, filter]);
  const topics = useMemo(() => (review ? buildTopics(review, entries.map((e) => e.file)) : []), [review, entries]);
  const topicFiles = useMemo(
    () =>
      topics
        .flatMap((t) => t.parts.filter((p) => t.firstFor.has(p.file.path)))
        .sort((a, b) => comparePaths(a.file.path, b.file.path)),
    [topics],
  );

  const view: Tab = tab === "topics" ? "topics" : tab === "commits" && diff?.commits.length ? "commits" : "files";

  const searched = useDeferredValue(query);
  const found = useMemo(() => searchDiff(shown.map((e) => e.file), searched), [shown, searched]);
  const openHit = (next: Hit) => {
    setHit(next);
    if (view !== "files") setTab("files");
    revealLine(next);
  };
  const stepHit = (dir: 1 | -1) => {
    const { hits } = found;
    const i = hit ? hits.indexOf(hit) : -1;
    const next = hits[i < 0 ? (dir > 0 ? 0 : hits.length - 1) : (i + dir + hits.length) % hits.length];
    if (next) openHit(next);
  };
  const topicTab = view === "topics" && topics.length > 0;

  useEffect(() => (diff !== null ? startAnchoring() : undefined), [diff !== null]);
  useEffect(() => (diff !== null ? followActiveFile() : undefined), [diff !== null]);

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

  const pendingSelect = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (shownView.current === view) return;
    shownView.current = view;
    window.scrollTo(0, scrolls.current[view] ?? 0);
    const target = pendingSelect.current && document.getElementById(pendingSelect.current);
    pendingSelect.current = null;
    if (target) go(target);
  }, [view]);

  const [opening, setOpening] = useState<{ anchor: string } | null>(null);
  useLayoutEffect(() => {
    const target = opening && document.getElementById(opening.anchor);
    if (target) go(target);
  }, [opening]);

  useLayoutEffect(() => {
    if (!resetScroll.current) return;
    resetScroll.current = false;
    scrollToTop();
  });

  const place = useCallback(
    (t: Thread): Place | null => {
      const { anchor } = t;
      if (anchor.path === null) {
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
    j: () => stepSection(1),
    k: () => stepSection(-1),
    u: conv.nextUnread,
    Escape: () => (help ? setHelp(false) : conv.setOpen(false)),
  });

  const [isViewed, toggleViewed] = useViewed(diff && `diff-review:viewed:${diff.repoRoot}`, (f: FileDiff) => f.path, signature);
  const [isTopicViewed, toggleTopicViewed] = useViewed(
    diff && `diff-review:viewed-topics:${diff.repoRoot}`,
    (t: TopicView) => t.key,
    (t) => t.signature,
  );
  const isTopicFileViewed = useCallback(
    (f: FileDiff) => topics.every((t) => isTopicViewed(t) || !t.parts.some((p) => p.file.path === f.path)),
    [topics, isTopicViewed],
  );

  const select = (anchor: string) => {
    if (!topicTab && view !== "files") {
      pendingSelect.current = anchor;
      setTab("files");
      return;
    }
    const el = document.getElementById(anchor);
    if (el) go(el);
    else if (topicTab) setOpening({ anchor });
  };
  const latestSelect = useRef(select);
  latestSelect.current = select;
  const onSelect = useCallback((anchor: string) => latestSelect.current(anchor), []);
  const treeEntries = useMemo(() => (topicTab ? matching(topicFiles, filter) : shown), [topicTab, topicFiles, filter, shown]);
  const toggleDir = useCallback(
    (path: string) =>
      setFoldedDirs((prev) => {
        const next = new Set(prev);
        if (!next.delete(path)) next.add(path);
        return next;
      }),
    [],
  );
  const shownDirs = useMemo(() => dirPaths(treeEntries, foldedDirs), [treeEntries, foldedDirs]);
  const anyDirOpen = shownDirs.some((d) => !foldedDirs.has(d));

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

  return (
    <FileLoader.Provider value={loadFile}>
      <CommentActionsContext.Provider value={actions}>
        <CommentsContext.Provider value={commentsValue}>
          <div className="app">
            <header className="topbar">
              <div className={`loading-bar${switching ? " is-active" : ""}`} aria-hidden="true" />
              <SidebarToggle open={sidebarOpen} onToggle={() => setSidebarOpen((o) => !o)} />
              <div className="topbar-title">
                <CompareControls diff={diff} loadRefs={loadRefs} onCompare={compareWith} />
                <RepoComparisons diff={diff} loadRefs={loadRefs} onCompare={compareWith} />
              </div>
              <ChangeStats files={diff.files} />
              <RefreshButton stale={stale} loading={loading} onClick={() => void load(requested.current)} />
              <span className="spacer" />
              <ViewTabs view={view} commitCount={stepping?.count ?? diff.commitCount} onSelect={setTab} />
              <ConversationsButton conv={conv} />
              <KeyboardButton onClick={() => setHelp(true)} />
              <ThemeToggle />
              <SubmitReview drafts={drafts} listening={listening} onSubmit={submit} />
            </header>

            {error && <div className="banner">{error.message}</div>}

            <div className={`layout${conv.open ? " with-conversations" : ""}${sidebarOpen ? "" : " no-sidebar"}`}>
              <aside className="sidebar" hidden={!sidebarOpen}>
                <div className="view">
                  <div className="filter-row">
                    <input
                      className="filter"
                      type="search"
                      placeholder="Filter files"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      aria-label="Filter files"
                    />
                    {shownDirs.length > 0 && !searched.trim() && (
                      <button
                        className="icon-button"
                        aria-label={anyDirOpen ? "Collapse all folders" : "Expand all folders"}
                        title={anyDirOpen ? "Collapse all folders" : "Expand all folders"}
                        onClick={() => setFoldedDirs(anyDirOpen ? new Set(dirPaths(treeEntries)) : new Set())}
                      >
                        <FoldIcon fold={anyDirOpen} />
                      </button>
                    )}
                  </div>
                  <input
                    className="filter"
                    type="search"
                    placeholder="Search in the diff"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setHit(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                      e.preventDefault();
                      stepHit(e.shiftKey ? -1 : 1);
                    }}
                    aria-label="Search in the diff"
                    title="Enter goes to the next match, Shift+Enter to the previous one"
                  />
                  {searched.trim() ? (
                    <SearchResults found={found} query={searched} current={hit} onOpen={openHit} />
                  ) : (
                    <FileTree
                      entries={treeEntries}
                      isViewed={topicTab ? isTopicFileViewed : isViewed}
                      onSelect={onSelect}
                      collapsed={foldedDirs}
                      onToggle={toggleDir}
                    />
                  )}
                </div>
              </aside>

              <main className={`files${switching ? " is-switching" : ""}`}>
                {repoFailures(diff.repos).map((f) => (
                  <p key={f.error} className="file-note inline">
                    Not compared in {f.dirs.join(", ")}: {f.error}
                  </p>
                ))}
                {stepping && view !== "commits" && (
                  <CommitBar commits={stepping.commits} count={stepping.count} index={stepIndex} onView={viewCommit} onAll={showAllCommits} />
                )}
                {view !== "commits" && diff.files.length === 0 && <Notice title="No changes">{noChanges(diff)}</Notice>}
                {visited.current.has("topics") && (
                  <div className="view" hidden={view !== "topics"}>
                    <ReviewBar
                      reviews={reviews}
                      review={review}
                      grouping={grouping}
                      repoRoot={diff.repoRoot}
                      hasChanges={diff.files.length > 0}
                      onPick={(r) => showReview(r, r.createdAt)}
                      onGroup={group}
                      onRemove={removeReview}
                    />
                    {topics.map((t) => (
                      <TopicSection
                        key={t.key}
                        topic={t}
                        viewed={isTopicViewed(t)}
                        opening={opening}
                        onToggleViewed={() => toggleTopicViewed(t)}
                      />
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
                        onToggleViewed={toggleViewed}
                      />
                    ))}
                  </div>
                )}
                {visited.current.has("commits") && diff.commits.length > 0 && (
                  <div className="view" hidden={view !== "commits"}>
                    <CommitList
                      commits={stepping?.commits ?? diff.commits}
                      count={stepping?.count ?? diff.commitCount}
                      current={stepping ? diff.head : null}
                      onView={viewCommit}
                      onAll={showAllCommits}
                    />
                  </div>
                )}
              </main>
            </div>
            {conv.open && <ConversationsPanel conv={conv} />}
          </div>
          {help && <ShortcutHelp onClose={() => setHelp(false)} />}
        </CommentsContext.Provider>
      </CommentActionsContext.Provider>
    </FileLoader.Provider>
  );
}

function matching<T extends { file: FileDiff }>(list: T[], filter: string): T[] {
  const q = filter.trim().toLowerCase();
  return q ? list.filter((e) => e.file.path.toLowerCase().includes(q)) : list;
}

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

function Notice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="notice">
      <h1>{title}</h1>
      {children && <div>{children}</div>}
    </div>
  );
}
