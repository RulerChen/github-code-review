import { useEffect, useState } from "react";
import type { DisplayHunk, FileDiff } from "../shared/types";
import { DiffTable } from "./DiffTable";
import { highlight, languageFor, type TokenLines } from "./highlight";

const LARGE_DIFF_LINES = 800;

interface Props {
  file: FileDiff;
  hunks?: DisplayHunk[];
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

export function FileCard({ file, hunks = file.hunks, anchor, viewed = false, onToggleViewed }: Props) {
  const [collapsed, setCollapsed] = useState(viewed);
  const [forceLoad, setForceLoad] = useState(false);
  useEffect(() => setCollapsed(viewed), [viewed]);

  const lineCount = hunks.reduce((s, h) => s + h.lines.length, 0);
  const partial = hunks !== file.hunks;
  const additions = partial ? countLines(hunks, "add") : file.additions;
  const deletions = partial ? countLines(hunks, "del") : file.deletions;
  const deferred = lineCount > LARGE_DIFF_LINES && !forceLoad;
  const tokens = useHighlight(file, !collapsed && !deferred);

  return (
    <section className={`file${viewed ? " is-viewed" : ""}`} id={anchor}>
      <header className="file-header">
        <button
          className="icon-button chevron"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand file" : "Collapse file"}
          onClick={() => setCollapsed(!collapsed)}
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
        {onToggleViewed && (
          <label className="viewed-toggle">
            <input type="checkbox" checked={viewed} onChange={onToggleViewed} />
            Viewed
          </label>
        )}
      </header>
      {!collapsed && (
        <div className="file-body">
          <FileBody file={file} hunks={hunks} deferred={deferred} lineCount={lineCount} onLoad={() => setForceLoad(true)} tokens={tokens} />
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
  onLoad,
  tokens,
}: {
  file: FileDiff;
  hunks: DisplayHunk[];
  deferred: boolean;
  lineCount: number;
  onLoad: () => void;
  tokens: { old: TokenLines | null; new: TokenLines | null };
}) {
  if (file.binary) return <p className="file-note">Binary file not shown.</p>;
  if (hunks.length === 0) {
    if (file.tooLarge) return <p className="file-note">File too large to display.</p>;
    if (file.modeChange) return <p className="file-note">File mode changed from {file.modeChange.from} to {file.modeChange.to}.</p>;
    if (file.status === "renamed") return <p className="file-note">File renamed without changes.</p>;
    return <p className="file-note">Empty file.</p>;
  }
  if (deferred) {
    return (
      <div className="file-note">
        Large diff ({lineCount.toLocaleString()} lines) not rendered by default.{" "}
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
        <DiffTable hunks={hunks} oldTokens={tokens.old} newTokens={tokens.new} />
      </div>
    </>
  );
}

function countLines(hunks: DisplayHunk[], kind: "add" | "del"): number {
  return hunks.reduce((n, h) => n + h.lines.filter((l) => l.kind === kind).length, 0);
}

function useHighlight(file: FileDiff, enabled: boolean): { old: TokenLines | null; new: TokenLines | null } {
  const [tokens, setTokens] = useState<{ old: TokenLines | null; new: TokenLines | null }>({ old: null, new: null });
  const lang = languageFor(file.path);
  useEffect(() => {
    if (!enabled || !lang) return;
    let cancelled = false;
    Promise.all([
      file.oldContent !== null ? highlight(file.oldContent, languageFor(file.oldPath ?? file.path) ?? lang) : null,
      file.newContent !== null ? highlight(file.newContent, lang) : null,
    ])
      .then(([o, n]) => {
        if (!cancelled) setTokens({ old: o, new: n });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled, lang, file.oldContent, file.newContent, file.oldPath, file.path]);
  return tokens;
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
