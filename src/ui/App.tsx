import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { DiffResult, FileDiff } from "../shared/types";
import { ApiError, fetchDiff } from "./api";
import { FileCard } from "./FileCard";
import { comparePaths, FileTree } from "./FileTree";
import { readStorage, writeStorage } from "./storage";

interface Props {
  token: string | null;
  viewId: string | null;
}

const signature = (f: FileDiff) => (f.blocks.length ? f.blocks.map((b) => b.id).join(",") : `${f.status}:${f.binary}`);

export function App({ token, viewId }: Props) {
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [error, setError] = useState<{ message: string; status: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [theme, setTheme] = useState(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [viewed, setViewed] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!token || !viewId) return;
    setLoading(true);
    try {
      const result = await fetchDiff(viewId, token);
      setDiff(result);
      setError(null);
      setUpdatedAt(new Date());
      setViewed((prev) => (Object.keys(prev).length ? prev : readStorage(`diff-review:viewed:${result.repoRoot}`, {})));
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : String(e), status: e instanceof ApiError ? e.status : 0 });
    } finally {
      setLoading(false);
    }
  }, [token, viewId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const isViewed = useCallback((f: FileDiff) => viewed[f.path] === signature(f), [viewed]);
  const toggleViewed = (f: FileDiff) => {
    if (!diff) return;
    const next = { ...viewed };
    if (isViewed(f)) delete next[f.path];
    else next[f.path] = signature(f);
    setViewed(next);
    writeStorage(`diff-review:viewed:${diff.repoRoot}`, next);
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

  if (!token || !viewId) {
    return (
      <Notice title="This link is incomplete">
        Open the exact link Claude gave you. It ends with <code>#token=…</code>, which this page needs to read the diff.
      </Notice>
    );
  }
  if (error && !diff) {
    const hint =
      error.status === 401
        ? "The token in this link is not valid for the running server. Ask Claude to open the viewer again."
        : error.status === 404
          ? "The server restarted since this link was made. Ask Claude to open the viewer again."
          : null;
    return (
      <Notice title="Could not load the diff">
        {error.message}
        {hint && <p>{hint}</p>}
      </Notice>
    );
  }
  if (!diff) return <Notice title="Loading diff…" />;

  const additions = diff.files.reduce((s, f) => s + f.additions, 0);
  const deletions = diff.files.reduce((s, f) => s + f.deletions, 0);
  const viewedCount = diff.files.filter(isViewed).length;
  const repoName = diff.repoRoot.slice(diff.repoRoot.lastIndexOf("/") + 1);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-title">
          <strong>{repoName}</strong>
          <span className="refs">
            <code>{diff.base}</code>
            {diff.baseCommit && <span className="sha">{diff.baseCommit.slice(0, 7)}</span>}
            <span aria-hidden="true">←</span>
            <code>working tree</code>
          </span>
        </div>
        <div className="topbar-stats">
          <span>
            {diff.files.length} file{diff.files.length === 1 ? "" : "s"} changed
          </span>
          <span className="count-add">+{additions.toLocaleString()}</span>
          <span className="count-del">−{deletions.toLocaleString()}</span>
        </div>
        <span className="spacer" />
        <div className="viewed-progress" title={`${viewedCount} of ${diff.files.length} files viewed`}>
          <span>
            {viewedCount} / {diff.files.length} viewed
          </span>
          <span className="progress" aria-hidden="true">
            <span style={{ width: `${diff.files.length ? (viewedCount / diff.files.length) * 100 : 0}%` }} />
          </span>
        </div>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <button className="button" onClick={() => void load()} disabled={loading} title={updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : undefined}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>
      {error && <div className="banner">Refresh failed: {error.message}</div>}
      <div className="layout">
        <aside className="sidebar">
          <input
            className="filter"
            type="search"
            placeholder="Filter files"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter files"
          />
          <FileTree entries={shown} active={active} isViewed={isViewed} onSelect={select} />
        </aside>
        <main className="files">
          {diff.files.length === 0 ? (
            <Notice title="No changes">
              The working tree matches <code>{diff.base}</code>.
            </Notice>
          ) : (
            shown.map(({ file, anchor }) => (
              <FileCard
                key={`${file.path}:${signature(file)}`}
                file={file}
                anchor={anchor}
                viewed={isViewed(file)}
                onToggleViewed={() => toggleViewed(file)}
              />
            ))
          )}
        </main>
      </div>
    </div>
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
