import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { buildHunks, splitLines } from "../shared/hunks";
import type { Block, DiffLine, DisplayHunk, Expansion, FileDiff, Thread } from "../shared/types";
import { sum } from "../shared/util";
import { keepHeaderInPlace, keepInPlace } from "./anchor";
import { focusForm, onShownVersion, ThreadList, ThreadView, useComments } from "./comments";
import { CollapseButton, CommentButton, CopyButton, ViewedToggle } from "./controls";
import { DiffTable, hasLine, type OnExpand, toSplitRows, twoExpanders } from "./DiffTable";
import { highlight, languageFor, type TokenLines } from "./highlight";
import { useAction } from "./hooks";
import { isOutdated } from "./locate";
import { showLineTarget, useLineTarget } from "./Search";

const AUTO_LOAD_LINES = 400;
const AUTO_LOAD_CHARS = 20 * 1024;
const NO_EXPANSION: Expansion = { above: {}, below: {} };
const NO_TOKENS: Tokens = { old: null, new: null };
const ROW_PX = 20;
const HUNK_PX = 28;
const TWO_EXPANDERS_PX = 44;
const THREAD_PX = 110;
const NUM_PX = 52;
const CODE_PAD_PX = 32;

const nearCallbacks = new Map<Element, () => void>();
let nearObserver: IntersectionObserver | null = null;

function whenNear(el: Element, callback: () => void): () => void {
  nearObserver ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        nearCallbacks.get(e.target)?.();
        nearCallbacks.delete(e.target);
        nearObserver!.unobserve(e.target);
      }
    },
    { rootMargin: "100% 0px" },
  );
  nearCallbacks.set(el, callback);
  nearObserver.observe(el);
  return () => {
    nearCallbacks.delete(el);
    nearObserver?.unobserve(el);
  };
}

const sizings: { el: HTMLElement; hunks: DisplayHunk[]; threads: number }[] = [];
const arrivals: { el: Element; show: () => void }[] = [];
let settling = false;

function settleSoon(): void {
  if (settling) return;
  settling = true;
  queueMicrotask(() => {
    settling = false;
    const sized = sizings.splice(0).map((s) => ({ ...s, width: s.el.clientWidth }));
    for (const s of sized) {
      if (s.width > 0) s.el.style.height = `${estimateHeight(s.hunks, s.width) + s.threads * THREAD_PX}px`;
    }

    const near = arrivals.splice(0).filter(({ el }) => {
      if (el.getClientRects().length === 0) return false;
      const r = el.getBoundingClientRect();
      return r.bottom > -window.innerHeight && r.top < 2 * window.innerHeight;
    });
    if (near.length) flushSync(() => near.forEach((a) => a.show()));
  });
}

export const FileLoader = createContext<(path: string) => Promise<void>>(async () => {});

interface Props {
  file: FileDiff;
  blocks?: Block[];
  anchor: string;
  viewed?: boolean;
  onToggleViewed?: (file: FileDiff) => void;
}

export const FileCard = memo(function FileCard({ file: next, blocks: nextBlocks = next.blocks, anchor, viewed = false, onToggleViewed }: Props) {
  const [collapsed, setCollapsed] = useState(viewed);
  const [forceLoad, setForceLoad] = useState(false);
  const [expansion, setExpansion] = useState(NO_EXPANSION);
  const [near, setNear] = useState(false);
  const [commenting, setCommenting] = useState(false);
  useEffect(() => setCollapsed(viewed), [viewed]);

  const { lineCount, charCount } = useMemo(() => sizeOf(baseHunksOf(next, nextBlocks)), [next, nextBlocks]);
  const deferred = (next.generated || lineCount > AUTO_LOAD_LINES || charCount > AUTO_LOAD_CHARS) && !forceLoad;
  const loadFile = useContext(FileLoader);
  const loading = useAction(() => loadFile(next.path));
  useEffect(() => {
    if (forceLoad && next.lazy) void loading.run();
  }, [forceLoad, next]);
  const { file, blocks, tokens } = useShown(next, nextBlocks, near && !collapsed && !deferred);
  const partial = blocks !== file.blocks;
  const baseHunks = baseHunksOf(file, blocks);
  const hunks = useMemo(
    () => (expansion === NO_EXPANSION ? baseHunks : hunksOf(file, blocks, expansion)),
    [file, blocks, expansion, baseHunks],
  );
  const expand = useCallback<OnExpand>(
    (dir, id, lines) => setExpansion((e) => ({ ...e, [dir]: { ...e[dir], [id]: (e[dir][id] ?? 0) + lines } })),
    [],
  );

  const ref = useRef<HTMLElement>(null);
  const header = useRef<HTMLElement>(null);
  useEffect(() => (near || !ref.current ? undefined : whenNear(ref.current, () => setNear(true))), [near]);
  useLayoutEffect(() => {
    if (near || !ref.current) return;
    arrivals.push({ el: ref.current, show: () => setNear(true) });
    settleSoon();
  }, []);

  const { threadsFor, create, versions, revealSeq, peekReveal } = useComments();
  useEffect(() => {
    const thread = peekReveal();
    if (!thread || thread.anchor.path !== file.path) return;
    const { anchor } = thread;
    const placed = anchor.side === null || (onShownVersion(thread, versions) && hasLine(hunks, anchor.side, anchor.end));
    if (!placed && partial) return;
    setCollapsed(false);
    setNear(true);
    if (placed && anchor.side !== null) setForceLoad(true);
  }, [revealSeq]);

  const lineSeq = useLineTarget(next.path);
  useEffect(() => {
    if (!lineSeq || partial) return;
    setCollapsed(false);
    setNear(true);
    setForceLoad(true);
  }, [lineSeq]);
  useEffect(() => {
    if (lineSeq && !partial) showLineTarget(ref.current, next.path);
  });

  const threads = threadsFor(file.path);
  const fileThreads = threads.filter((t) => t.anchor.side === null);
  const unplaced = threads.filter(
    (t) => t.anchor.side !== null && (partial ? isOutdated(t) : !onShownVersion(t, versions) || !hasLine(hunks, t.anchor.side, t.anchor.end)),
  );
  const cheap = deferred || hunks.length === 0;
  const additions = partial ? sum(blocks, (b) => b.newCount) : file.additions;
  const deletions = partial ? sum(blocks, (b) => b.oldCount) : file.deletions;

  return (
    <section className={`file${viewed ? " is-viewed" : ""}`} id={anchor} data-path={file.path} ref={ref}>
      <header className="file-header" ref={header}>
        <CollapseButton
          collapsed={collapsed}
          noun="file"
          onClick={() =>
            keepHeaderInPlace(header.current, () => {
              setCollapsed(!collapsed);
              setNear(true);
            })
          }
        />
        <DiffStat additions={additions} deletions={deletions} />
        <span className="file-path" title={file.path}>
          {file.oldPath ? (
            <>
              <span className="old-path">{file.oldPath}</span> → {file.path}
            </>
          ) : (
            file.path
          )}
        </span>
        <CopyButton text={file.path} />
        <span className="spacer" />
        <CommentButton
          label="Comment on this file"
          onClick={() => {
            const open = ref.current?.querySelector(".file-threads > .thread-new .comment-form");
            if (open) return focusForm(open);
            keepInPlace(ref.current, () => {
              setCollapsed(false);
              setNear(true);
              setCommenting(true);
            });
          }}
        />
        {onToggleViewed && (
          <ViewedToggle
            viewed={viewed}
            onChange={() =>
              keepHeaderInPlace(header.current, () => {
                setCollapsed(!viewed);
                setNear(true);
                onToggleViewed(next);
              })
            }
          />
        )}
      </header>
      {!collapsed && !near && !cheap && <Placeholder hunks={hunks} threads={threads.length} />}
      {!collapsed && (near || cheap) && (
        <div className="file-body">
          <ThreadList
            className="file-threads"
            threads={fileThreads}
            commenting={commenting}
            placeholder="Comment on this file"
            onCreate={(body, single) => create({ path: file.path, side: null, start: null, end: null }, "", body, single)}
            onClose={() => setCommenting(false)}
          />
          {unplaced.length > 0 && (
            <div className="unplaced">
              <p className="file-note inline">Comments on lines not shown in this diff</p>
              {unplaced.map((t) => (
                <ThreadView key={t.id} thread={t} withVersion />
              ))}
            </div>
          )}
          <FileBody
            file={file}
            hunks={hunks}
            deferred={deferred}
            lineCount={lineCount}
            charCount={charCount}
            onLoad={() => setForceLoad(true)}
            loadError={loading.error}
            onExpand={expand}
            tokens={tokens ?? NO_TOKENS}
            threads={threads}
          />
        </div>
      )}
    </section>
  );
});

function FileBody({
  file,
  hunks,
  deferred,
  lineCount,
  charCount,
  onLoad,
  loadError,
  onExpand,
  tokens,
  threads,
}: {
  file: FileDiff;
  hunks: DisplayHunk[];
  deferred: boolean;
  lineCount: number;
  charCount: number;
  onLoad: () => void;
  loadError: string | null;
  onExpand: OnExpand;
  tokens: Tokens;
  threads: Thread[];
}) {
  if (file.binary) return <p className="file-note">Binary file not shown.</p>;
  if (file.diffTooLarge) {
    return <p className="file-note">Diff too large to display ({(file.additions + file.deletions).toLocaleString()} changed lines).</p>;
  }
  if (hunks.length === 0 && !file.lazy) {
    if (file.tooLarge) return <p className="file-note">File too large to display.</p>;
    if (file.modeChange) return <p className="file-note">File mode changed from {file.modeChange.from} to {file.modeChange.to}.</p>;
    if (file.status === "renamed") return <p className="file-note">File renamed without changes.</p>;
    return <p className="file-note">Empty file.</p>;
  }
  if (deferred) {
    return (
      <div className="file-note">
        {file.generated ? "Generated file" : `Large diff (${lineCount.toLocaleString()} lines, ${Math.ceil(charCount / 1024).toLocaleString()} KB)`} not
        rendered by default.{" "}
        <button className="link-button" onClick={onLoad}>
          Load diff
        </button>
      </div>
    );
  }
  if (file.lazy) return <p className="file-note">{loadError ? `Could not load the diff: ${loadError}` : "Loading diff…"}</p>;

  return (
    <>
      {file.modeChange && (
        <p className="file-note inline">
          File mode changed from {file.modeChange.from} to {file.modeChange.to}.
        </p>
      )}
      {file.tooLarge && <p className="file-note inline">File too large to load in full: context lines and highlighting are off.</p>}
      <div className="diff-scroll">
        <DiffTable path={file.path} hunks={hunks} oldTokens={tokens.old} newTokens={tokens.new} threads={threads} onExpand={onExpand} />
      </div>
    </>
  );
}

function hunksOf(file: FileDiff, blocks: Block[], expansion: Expansion | null): DisplayHunk[] {
  if (blocks.length === 0 || file.diffTooLarge || file.lazy) return [];
  const lines = (text: string | null) => (text === null ? null : splitLines(text));
  return buildHunks(blocks, lines(file.oldContent), lines(file.newContent), file.blocks, expansion);
}

const partHunks = new WeakMap<Block[], DisplayHunk[]>();

export function baseHunksOf(file: FileDiff, blocks: Block[]): DisplayHunk[] {
  if (blocks === file.blocks) return file.hunks;
  let hunks = partHunks.get(blocks);
  if (!hunks) {
    hunks = hunksOf(file, blocks, null);
    partHunks.set(blocks, hunks);
  }
  return hunks;
}

function sizeOf(hunks: DisplayHunk[]): { lineCount: number; charCount: number } {
  let lineCount = 0;
  let charCount = 0;
  for (const h of hunks) {
    for (const l of h.lines) {
      lineCount++;
      charCount += l.text.length + 1;
    }
  }
  return { lineCount, charCount };
}

function Placeholder({ hunks, threads }: { hunks: DisplayHunk[]; threads: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const height = useMemo(() => estimateHeight(hunks, 1000), [hunks]);
  useLayoutEffect(() => {
    if (!ref.current) return;
    sizings.push({ el: ref.current, hunks, threads });
    settleSoon();
  }, [hunks, threads]);
  return <div className="file-body" ref={ref} style={{ height }} />;
}

let charPx = 0;

function charWidth(): number {
  if (!charPx) {
    const ctx = document.createElement("canvas").getContext("2d");
    if (ctx) {
      ctx.font = `12px ${getComputedStyle(document.documentElement).getPropertyValue("--mono")}`;
      charPx = ctx.measureText("0".repeat(100)).width / 100;
    }
  }
  return charPx || 7.2;
}

function estimateHeight(hunks: DisplayHunk[], width: number): number {
  const cols = Math.max(20, Math.floor(((width - 2 * NUM_PX) / 2 - CODE_PAD_PX) / charWidth()));
  const wrapped = (line: DiffLine | null | undefined) =>
    line ? Math.max(1, Math.ceil(line.text.replace(/\t/g, "    ").length / cols)) : 1;
  let px = 0;
  hunks.forEach((h, i) => {
    px += twoExpanders(hunks[i - 1], h) ? TWO_EXPANDERS_PX : HUNK_PX;
    for (const row of toSplitRows(h.lines)) px += ROW_PX * Math.max(wrapped(row.left), wrapped(row.right));
  });
  if ((hunks.at(-1)?.hiddenBelow ?? 0) > 0) px += HUNK_PX;
  return Math.max(2 * HUNK_PX, px);
}

interface Tokens {
  old: TokenLines | null;
  new: TokenLines | null;
}

interface Shown {
  file: FileDiff;
  blocks: Block[];
  tokens: Tokens | null;
}

const sameText = (a: FileDiff, b: FileDiff) =>
  a.path === b.path && a.oldPath === b.oldPath && a.oldContent === b.oldContent && a.newContent === b.newContent;

function useShown(file: FileDiff, blocks: Block[], enabled: boolean): Shown {
  const lang = languageFor(file.path);
  const want = enabled && lang !== null;
  const wantOld = file.newContent === null || blocks.some((b) => b.oldCount > 0);

  const [shown, setShown] = useState<Shown>({ file, blocks, tokens: null });
  let current = shown;
  if (shown.file !== file || shown.blocks !== blocks) {
    const same = sameText(shown.file, file);
    if (same || !want || !shown.tokens) {
      current = { file, blocks, tokens: same ? shown.tokens : null };
      setShown(current);
    }
  }

  useEffect(() => {
    if (!want) return;
    let cancelled = false;
    const show = (tokens: Tokens | null) => {
      if (!cancelled) setShown({ file, blocks, tokens });
    };
    Promise.all([
      wantOld && file.oldContent !== null ? highlight(file.oldContent, languageFor(file.oldPath ?? file.path) ?? lang) : null,
      file.newContent !== null ? highlight(file.newContent, lang) : null,
    ]).then(([o, n]) => show({ old: o, new: n }), () => show(null));
    return () => {
      cancelled = true;
    };
  }, [want, wantOld, lang, file.oldContent, file.newContent, file.oldPath, file.path]);

  return current;
}

const DiffStat = memo(function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions;
  let green = 0;
  let red = 0;
  if (total > 0 && total < 5) {
    green = additions;
    red = deletions;
  } else if (total > 0) {
    green = Math.round((additions / total) * 5);
    red = Math.min(5 - green, Math.round((deletions / total) * 5));
  }

  return (
    <span className="diffstat" aria-label={`${additions} additions, ${deletions} deletions`}>
      <span className="count-add">+{additions}</span>
      <span className="count-del">−{deletions}</span>
      <span className="bars" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className={i < green ? "bar bar-add" : i < green + red ? "bar bar-del" : "bar"} />
        ))}
      </span>
    </span>
  );
});
