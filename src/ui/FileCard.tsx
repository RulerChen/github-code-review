import { useEffect, useMemo, useRef, useState } from "react";
import { buildHunks, splitLines } from "../shared/hunks";
import type { Block, DisplayHunk, Expansion, FileDiff } from "../shared/types";
import { CommentForm, onShownVersion, ThreadView, useComments } from "./comments";
import { DiffTable, hasLine, type OnExpand, splitRowCount } from "./DiffTable";
import { highlight, languageFor, type TokenLines } from "./highlight";
import { keepHeaderInPlace } from "./keyboard";

// GitHub loads 400 lines or 20 KB of a file's diff before asking. Characters stand in for bytes.
const AUTO_LOAD_LINES = 400;
const AUTO_LOAD_CHARS = 20 * 1024;
const NO_EXPANSION: Expansion = { above: {}, below: {} };
const NO_TOKENS: Tokens = { old: null, new: null };
const ROW_PX = 20;
const HUNK_PX = 28;

// One observer for every card: a card's body mounts once it comes within a viewport of the screen.
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

interface Props {
  file: FileDiff;
  blocks?: Block[];
  anchor: string;
  viewed?: boolean;
  onToggleViewed?: () => void;
}

export function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M12.78 5.22a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.22 6.28a.75.75 0 0 1 1.06-1.06L8 8.94l3.72-3.72a.75.75 0 0 1 1.06 0Z" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
    </svg>
  );
}

export function FileCard({ file: next, blocks: nextBlocks = next.blocks, anchor, viewed = false, onToggleViewed }: Props) {
  const [collapsed, setCollapsed] = useState(viewed);
  const [forceLoad, setForceLoad] = useState(false);
  const [expansion, setExpansion] = useState(NO_EXPANSION);
  const [near, setNear] = useState(false);
  const [commenting, setCommenting] = useState(false);
  useEffect(() => setCollapsed(viewed), [viewed]);

  const { lineCount, charCount } = useMemo(() => sizeOf(baseHunksOf(next, nextBlocks)), [next, nextBlocks]);
  const deferred = (next.generated || lineCount > AUTO_LOAD_LINES || charCount > AUTO_LOAD_CHARS) && !forceLoad;
  const { file, blocks, tokens } = useShown(next, nextBlocks, near && !collapsed && !deferred);
  const partial = blocks !== file.blocks;
  const baseHunks = baseHunksOf(file, blocks);
  const hunks = useMemo(
    () => (expansion === NO_EXPANSION ? baseHunks : hunksOf(file, blocks, expansion)),
    [file, blocks, expansion, baseHunks],
  );
  const expand: OnExpand = (dir, id, lines) =>
    setExpansion((e) => ({ ...e, [dir]: { ...e[dir], [id]: (e[dir][id] ?? 0) + lines } }));

  const ref = useRef<HTMLElement>(null);
  const header = useRef<HTMLElement>(null);
  useEffect(() => (near || !ref.current ? undefined : whenNear(ref.current, () => setNear(true))), [near]);
  const { threadsFor, create, versions, revealSeq, peekReveal } = useComments();
  useEffect(() => {
    const thread = peekReveal()?.thread;
    if (!thread || thread.anchor.path !== file.path) return;
    const { anchor } = thread;
    const placed = anchor.side === null || (onShownVersion(thread, versions) && hasLine(hunks, anchor.side, anchor.end));
    if (!placed && partial) return;
    setCollapsed(false);
    setNear(true);
    if (placed && anchor.side !== null) setForceLoad(true);
  }, [revealSeq]);
  const threads = threadsFor(file.path);
  // Comments on the whole file show on every card of the file, since a topic can show part of it.
  const fileThreads = threads.filter((t) => t.anchor.side === null);
  const unplaced = partial
    ? []
    : threads.filter((t) => t.anchor.side !== null && (!onShownVersion(t, versions) || !hasLine(hunks, t.anchor.side, t.anchor.end)));
  const additions = partial ? countLines(hunks, "add") : file.additions;
  const deletions = partial ? countLines(hunks, "del") : file.deletions;

  return (
    <section className={`file${viewed ? " is-viewed" : ""}`} id={anchor} ref={ref}>
      <header className="file-header" ref={header}>
        <button
          className="icon-button chevron"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand file" : "Collapse file"}
          onClick={() => keepHeaderInPlace(header.current, () => setCollapsed(!collapsed))}
        >
          <ChevronIcon />
        </button>
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
        <button
          className="icon-button"
          aria-label="Comment on this file"
          title="Comment on this file"
          onClick={() => {
            setCollapsed(false);
            setNear(true);
            setCommenting(true);
          }}
        >
          <CommentIcon />
        </button>
        {onToggleViewed && (
          <label className="viewed-toggle">
            <input
              type="checkbox"
              checked={viewed}
              onChange={() =>
                keepHeaderInPlace(header.current, () => {
                  if (!viewed) setCollapsed(true);
                  onToggleViewed();
                })
              }
            />
            Viewed
          </label>
        )}
      </header>
      {!collapsed && !near && (
        <div className="file-body" style={{ height: deferred ? 2 * HUNK_PX : estimateHeight(hunks) }} />
      )}
      {!collapsed && near && (
        <div className="file-body">
          {(fileThreads.length > 0 || commenting) && (
            <div className="file-threads">
              {fileThreads.map((t) => (
                <ThreadView key={t.id} thread={t} />
              ))}
              {commenting && (
                <CommentForm
                  placeholder="Comment on this file"
                  submitLabel="Comment"
                  onSubmit={async (body) => {
                    await create({ path: file.path, side: null, start: null, end: null }, "", body);
                    setCommenting(false);
                  }}
                  onCancel={() => setCommenting(false)}
                />
              )}
            </div>
          )}
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
            onExpand={expand}
            tokens={tokens ?? NO_TOKENS}
          />
        </div>
      )}
    </section>
  );
}

function FileBody({
  file,
  hunks,
  deferred,
  lineCount,
  charCount,
  onLoad,
  onExpand,
  tokens,
}: {
  file: FileDiff;
  hunks: DisplayHunk[];
  deferred: boolean;
  lineCount: number;
  charCount: number;
  onLoad: () => void;
  onExpand: OnExpand;
  tokens: Tokens;
}) {
  if (file.binary) return <p className="file-note">Binary file not shown.</p>;
  if (file.diffTooLarge) {
    return <p className="file-note">Diff too large to display ({(file.additions + file.deletions).toLocaleString()} changed lines).</p>;
  }
  if (hunks.length === 0) {
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
  return (
    <>
      {file.modeChange && (
        <p className="file-note inline">
          File mode changed from {file.modeChange.from} to {file.modeChange.to}.
        </p>
      )}
      {file.tooLarge && <p className="file-note inline">File too large to load in full: context lines and highlighting are off.</p>}
      <div className="diff-scroll">
        <DiffTable path={file.path} hunks={hunks} oldTokens={tokens.old} newTokens={tokens.new} onExpand={onExpand} />
      </div>
    </>
  );
}

export function hunksOf(file: FileDiff, blocks: Block[], expansion: Expansion | null): DisplayHunk[] {
  if (blocks.length === 0 || file.diffTooLarge) return [];
  const lines = (text: string | null) => (text === null ? null : splitLines(text));
  return buildHunks(blocks, lines(file.oldContent), lines(file.newContent), file.blocks, expansion);
}

// Hunks of a topic's part of a file, by the part's blocks, so each card works them out once.
const partHunks = new WeakMap<Block[], DisplayHunk[]>();

function baseHunksOf(file: FileDiff, blocks: Block[]): DisplayHunk[] {
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

// Height of a body that has not mounted yet, so the page keeps its length and anchors land close.
function estimateHeight(hunks: DisplayHunk[]): number {
  return Math.max(2 * HUNK_PX, hunks.reduce((px, h) => px + HUNK_PX + splitRowCount(h.lines) * ROW_PX, 0));
}

function countLines(hunks: DisplayHunk[], kind: "add" | "del"): number {
  return hunks.reduce((n, h) => n + h.lines.filter((l) => l.kind === kind).length, 0);
}

interface Tokens {
  old: TokenLines | null;
  new: TokenLines | null;
}

interface Shown {
  file: FileDiff;
  blocks: Block[];
  /** null until the text is highlighted, and for text that is not. */
  tokens: Tokens | null;
}

const sameText = (a: FileDiff, b: FileDiff) =>
  a.path === b.path && a.oldPath === b.oldPath && a.oldContent === b.oldContent && a.newContent === b.newContent;

// The version of the file the card shows. When a refresh changes the text of a highlighted card, the card
// keeps showing the old version until the new one is highlighted, then swaps it in one render, so the code
// does not flash plain.
function useShown(file: FileDiff, blocks: Block[], enabled: boolean): Shown {
  const lang = languageFor(file.path);
  const want = enabled && lang !== null;
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
      file.oldContent !== null ? highlight(file.oldContent, languageFor(file.oldPath ?? file.path) ?? lang) : null,
      file.newContent !== null ? highlight(file.newContent, lang) : null,
    ]).then(([o, n]) => show({ old: o, new: n }), () => show(null));
    return () => {
      cancelled = true;
    };
  }, [want, lang, file.oldContent, file.newContent, file.oldPath, file.path]);
  return current;
}

function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
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
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="icon-button copy"
      aria-label="Copy file path"
      title={copied ? "Copied" : "Copy file path"}
      onClick={() => {
        navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          })
          .catch(() => undefined);
      }}
    >
      {copied ? (
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z" />
          <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
        </svg>
      )}
    </button>
  );
}
