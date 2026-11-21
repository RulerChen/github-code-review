import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { splitLines } from "../shared/hunks";
import type { DiffLine, DisplayHunk, FileDiff, RepoFile } from "../shared/types";
import { errorMessage } from "../shared/util";
import { ThreadView, useComments } from "./comments";
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
  name?: string;
  listed?: boolean;
}

const WINDOW = 500;
const MAX_CRUMBS = 5;
const FOUND_MS = 2500;

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
  trail: Peek[];
  onGo: (steps: number) => void;
  onClose: () => void;
  onShowDiff: () => void;
  full?: boolean;
}

const placeOf = (p: Peek) => (p.line === null ? p.path : `${p.path}:${p.line}`);

export function CodePanel({ peek, file, revision, version, load, trail, onGo, onClose, onShowDiff, full = false }: Props) {
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

  const lang = languageFor(path, text);
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

  const { threadsFor } = useComments();
  const threads = threadsFor(path);
  const fileThreads = file ? [] : threads.filter((t) => t.anchor.side === null);

  const error = local === null && current && "error" in current ? current.error : null;
  let note: string | null = null;
  if (error) note = error;
  else if (!repoFile) note = "Loading…";
  else if (repoFile.binary) note = "Binary file not shown.";
  else if (repoFile.tooLarge) note = "File too large to display.";
  else if (lines.length === 0) note = "Empty file.";

  return (
    <aside className={`code-panel${full ? " is-full" : ""}`} aria-label={`Code of ${path}`}>
      <header className="code-head">
        {trail.length > 1 && (
          <button className="icon-button" onClick={() => onGo(-1)} aria-label="Back" title="Back (Alt+←)">
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
        {!full && (
          <button className="icon-button" onClick={onClose} aria-label="Close code" title="Close code (Esc)">
            <CloseIcon />
          </button>
        )}
      </header>
      {trail.length > 1 && (
        <nav className="code-trail" aria-label="The way here">
          {trail.length > MAX_CRUMBS && <span className="code-crumb-gap">…</span>}
          {trail.slice(-MAX_CRUMBS).map((p, i, shown) => {
            const back = shown.length - 1 - i;
            const label = p.name ?? (p.line === null ? basename(p.path) : `${basename(p.path)}:${p.line}`);
            return (
              <Fragment key={p.seq}>
                {i > 0 && <span className="code-crumb-gap">›</span>}
                {back === 0 ? (
                  <span className="code-crumb is-current" title={placeOf(p)}>
                    {label}
                  </span>
                ) : (
                  <button className="code-crumb" onClick={() => onGo(-back)} title={`Back to ${placeOf(p)}`}>
                    {label}
                  </button>
                )}
              </Fragment>
            );
          })}
        </nav>
      )}
      <div className="code-body" ref={body}>
        {fileThreads.length > 0 && (
          <div className="file-threads">
            {fileThreads.map((t) => (
              <ThreadView key={t.id} thread={t} />
            ))}
          </div>
        )}
        {note !== null ? (
          <p className="file-note">{note}</p>
        ) : (
          <DiffTable path={path} hunks={hunks} oldTokens={null} newTokens={newTokens} threads={threads} onExpand={expand} single panel={!full} />
        )}
      </div>
    </aside>
  );
}
