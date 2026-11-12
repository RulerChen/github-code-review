import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { splitLines } from "../shared/hunks";
import type { DiffLine, DisplayHunk, FileDiff, RepoFile } from "../shared/types";
import { errorMessage } from "../shared/util";
import { onShownVersion, ThreadView, useComments } from "./comments";
import { CopyButton } from "./controls";
import { DiffTable, type OnExpand } from "./DiffTable";
import { highlight, languageFor, type TokenLines } from "./highlight";
import { ArrowLeftIcon, CloseIcon } from "./icons";
import { basename, dirPrefix } from "./paths";
import "./code-panel.css";

export interface Peek {
  path: string;
  line: number | null;
  seq: number;
}

const WINDOW = 500;
const FOUND_MS = 1300;

export function addedLines(file: FileDiff | undefined): Set<number> {
  const out = new Set<number>();
  for (const b of file?.blocks ?? []) for (let n = b.newStart + 1; n <= b.newStart + b.newCount; n++) out.add(n);
  return out;
}

type Loaded = { key: string; file: RepoFile } | { key: string; error: string };

interface Props {
  peek: Peek;
  file: FileDiff | undefined;
  revision: string;
  version: string;
  load: (path: string) => Promise<RepoFile>;
  canGoBack: boolean;
  onBack: () => void;
  onClose: () => void;
  onShowDiff: () => void;
}

export function CodePanel({ peek, file, revision, version, load, canGoBack, onBack, onClose, onShowDiff }: Props) {
  const { path } = peek;
  const key = `${version}\0${path}`;
  const local = file?.newContent ?? null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    if (local !== null) return;
    let cancelled = false;
    load(path).then(
      (f) => !cancelled && setLoaded({ key, file: f }),
      (e: unknown) => !cancelled && setLoaded({ key, error: errorMessage(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [key, local === null]);

  const current = loaded?.key === key ? loaded : null;
  const repoFile = local !== null ? { path, text: local, binary: false, tooLarge: false } : current && "file" in current ? current.file : null;
  const text = repoFile?.text ?? null;
  const lines = useMemo(() => (text === null ? [] : splitLines(text)), [text]);

  const lang = languageFor(path);
  const [tokens, setTokens] = useState<{ text: string; lines: TokenLines | null } | null>(null);
  useEffect(() => {
    if (text === null || !lang) return;
    let cancelled = false;
    highlight(text, lang).then(
      (t) => !cancelled && setTokens({ text, lines: t }),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [text, lang]);
  const newTokens = tokens?.text === text ? tokens.lines : null;

  const rangeKey = `${path}\0${peek.seq}\0${lines.length}`;
  const [range, setRange] = useState({ key: "", from: 0, to: 0 });
  let shown = range;
  if (range.key !== rangeKey) {
    const at = Math.min(Math.max((peek.line ?? 1) - 1, 0), lines.length);
    shown = { key: rangeKey, from: Math.max(0, at - WINDOW), to: Math.min(lines.length, at + WINDOW) };
  }
  const { from, to } = shown;
  const expand: OnExpand = (dir) =>
    setRange({
      key: rangeKey,
      from: dir === "above" ? Math.max(0, from - WINDOW) : from,
      to: dir === "below" ? Math.min(lines.length, to + WINDOW) : to,
    });

  const added = useMemo(() => addedLines(file), [file]);
  const hunks = useMemo<DisplayHunk[]>(() => {
    if (from >= to) return [];
    const out: DiffLine[] = [];
    for (let i = from; i < to; i++) {
      out.push({ kind: added.has(i + 1) ? "add" : "context", oldNo: null, newNo: i + 1, text: lines[i]!, blockId: null, noEol: false });
    }
    return [{ header: "", lines: out, firstId: "above", lastId: "below", hiddenAbove: from, hiddenBelow: lines.length - to, joinsPrevious: false }];
  }, [lines, from, to, added]);

  const body = useRef<HTMLDivElement>(null);
  const ready = hunks.length > 0;
  useLayoutEffect(() => {
    const box = body.current;
    const row = peek.line === null ? null : box?.querySelector(`td.num[data-side="new"][data-n="${peek.line}"]`)?.parentElement;
    if (!box || !row) {
      box?.scrollTo(0, 0);
      return;
    }
    const r = row.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    box.scrollTop += r.top - b.top - (box.clientHeight - r.height) / 2;
    row.classList.add("is-found");
    const timer = setTimeout(() => row.classList.remove("is-found"), FOUND_MS);
    return () => {
      clearTimeout(timer);
      row.classList.remove("is-found");
    };
  }, [path, peek.seq, ready]);

  const { threadsFor, versions } = useComments();
  const threads = threadsFor(path);
  const fileThreads = file ? [] : threads.filter((t) => t.anchor.side === null);
  const unplaced = file
    ? []
    : threads.filter((t) => {
        const { side, end } = t.anchor;
        return side !== null && !(side === "new" && onShownVersion(t, versions) && end !== null && end > from && end <= to);
      });

  const error = local === null && current && "error" in current ? current.error : null;
  let note: string | null = null;
  if (error) note = error;
  else if (!repoFile) note = "Loading…";
  else if (repoFile.binary) note = "Binary file not shown.";
  else if (repoFile.tooLarge) note = "File too large to display.";
  else if (lines.length === 0) note = "Empty file.";

  return (
    <aside className="code-panel" aria-label={`Code of ${path}`}>
      <header className="code-head">
        {canGoBack && (
          <button className="icon-button" onClick={onBack} aria-label="Back" title="Back">
            <ArrowLeftIcon />
          </button>
        )}
        <span className="code-path" title={path}>
          <span className="code-dir">{dirPrefix(path)}</span>
          {basename(path)}
        </span>
        <CopyButton text={path} />
        <span className="spacer" />
        <span className="code-rev" title={file ? "This file has changes in the diff" : "This file has no changes in the diff"}>
          {file ? "Changed" : "Unchanged"}, {revision}
        </span>
        {file && (
          <button className="link-button" onClick={onShowDiff}>
            Show diff
          </button>
        )}
        <button className="icon-button" onClick={onClose} aria-label="Close code" title="Close code (Esc)">
          <CloseIcon />
        </button>
      </header>
      <div className="code-body" ref={body}>
        {fileThreads.length > 0 && (
          <div className="file-threads">
            {fileThreads.map((t) => (
              <ThreadView key={t.id} thread={t} />
            ))}
          </div>
        )}
        {unplaced.length > 0 && (
          <div className="unplaced">
            <p className="file-note inline">Comments on lines not shown here</p>
            {unplaced.map((t) => (
              <ThreadView key={t.id} thread={t} withVersion />
            ))}
          </div>
        )}
        {note !== null ? (
          <p className="file-note">{note}</p>
        ) : (
          <DiffTable path={path} hunks={hunks} oldTokens={null} newTokens={newTokens} threads={threads} onExpand={expand} single />
        )}
      </div>
    </aside>
  );
}
