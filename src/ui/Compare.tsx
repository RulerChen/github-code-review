import { useEffect, useMemo, useRef, useState } from "react";
import type { CommitInfo, Comparison, DiffResult, RefList } from "../shared/types";
import { focusInPlace } from "./anchor";

const SHA = /^[0-9a-f]{40,64}$/;
const MAX_ITEMS = 100;

export const sameComparison = (a: Comparison, b: Comparison) => a.base === b.base && a.head === b.head && a.threeDot === b.threeDot;

export const refLabel = (ref: string | null) => (ref === null ? "working tree" : SHA.test(ref) ? ref.slice(0, 7) : ref);

interface CompareProps {
  diff: DiffResult;
  loadRefs: () => Promise<RefList>;
  onCompare: (next: Comparison) => void;
}

export function CompareControls({ diff, loadRefs, onCompare }: CompareProps) {
  const current: Comparison = { base: diff.base, head: diff.head, threeDot: diff.threeDot };
  const dotsTitle = diff.threeDot
    ? "Showing the changes on compare since it diverged from base (base...compare). Click to compare them directly (base..compare)."
    : "Comparing base and compare directly (base..compare). Click to show only the changes since compare diverged from base (base...compare).";
  return (
    <div className="compare">
      <button
        className="icon-button"
        onClick={() => diff.head !== null && onCompare({ ...current, base: diff.head, head: diff.base })}
        disabled={diff.head === null}
        aria-label="Swap base and compare"
        title={diff.head === null ? "The working tree can only be compared, not used as the base" : "Swap base and compare"}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M5.22 14.78a.75.75 0 0 0 1.06-1.06L4.56 12h8.69a.75.75 0 0 0 0-1.5H4.56l1.72-1.72a.75.75 0 0 0-1.06-1.06l-3 3a.75.75 0 0 0 0 1.06l3 3Zm5.56-6.5a.75.75 0 1 1-1.06-1.06l1.72-1.72H2.75a.75.75 0 0 1 0-1.5h8.69L9.72 2.28a.75.75 0 0 1 1.06-1.06l3 3a.75.75 0 0 1 0 1.06l-3 3Z" />
        </svg>
      </button>
      <RefPicker
        role="base"
        value={diff.base}
        commit={diff.baseCommit}
        loadRefs={loadRefs}
        onPick={(ref) => ref !== null && onCompare({ ...current, base: ref })}
      />
      <button className="dots" onClick={() => onCompare({ ...current, threeDot: !diff.threeDot })} title={dotsTitle} aria-label={dotsTitle}>
        {diff.threeDot ? "..." : ".."}
      </button>
      <RefPicker role="compare" value={diff.head} commit={diff.headCommit} loadRefs={loadRefs} onPick={(ref) => onCompare({ ...current, head: ref })} />
    </div>
  );
}

type PickerTab = "branches" | "tags" | "commits";

interface Item {
  key: string;
  value: string | null;
  label: string;
  detail?: string;
}

interface PickerProps {
  role: "base" | "compare";
  value: string | null;
  commit: string | null;
  loadRefs: () => Promise<RefList>;
  onPick: (ref: string | null) => void;
}

function RefPicker({ role, value, commit, loadRefs, onPick }: PickerProps) {
  const [open, setOpen] = useState(false);
  const [refs, setRefs] = useState<RefList | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<PickerTab>("branches");
  const [cursor, setCursor] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setFailed(null);
    loadRefs()
      .then((r) => !cancelled && setRefs(r))
      .catch((e: unknown) => !cancelled && setFailed(e instanceof Error ? e.message : String(e)));
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => {
      cancelled = true;
      document.removeEventListener("mousedown", away);
    };
  }, [open, loadRefs]);

  const items = useMemo(() => {
    const q = query.trim();
    const lq = q.toLowerCase();
    const list: Item[] = [];
    if (role === "compare" && "working tree".includes(lq)) list.push({ key: "worktree", value: null, label: "Working tree", detail: "uncommitted" });
    if (refs) {
      if (tab === "commits") {
        for (const c of refs.commits) {
          if (!q || c.sha.startsWith(lq) || c.subject.toLowerCase().includes(lq)) {
            list.push({ key: c.sha, value: c.sha, label: c.subject, detail: c.sha.slice(0, 7) });
          }
        }
      } else {
        const names = (tab === "branches" ? refs.branches : refs.tags).filter((n) => n.toLowerCase().includes(lq));
        names.sort((a, b) => Number(b === q) - Number(a === q));
        for (const n of names) list.push({ key: n, value: n, label: n });
      }
    }
    const shown = list.slice(0, MAX_ITEMS);
    if (q && !list.some((i) => i.value === q)) shown.push({ key: "typed", value: q, label: `Use ${q}`, detail: "any ref" });
    return shown;
  }, [refs, tab, query, role]);

  useEffect(() => setCursor(0), [items]);

  const pick = (item: Item | undefined) => {
    if (!item) return;
    setOpen(false);
    setQuery("");
    if (item.value !== value) onPick(item.value);
  };

  const selected = (item: Item) => item.value === value || (item.value !== null && item.value === commit);
  const title = role === "base" ? "Choose a base ref" : "Choose a ref to compare";

  return (
    <div className="picker" ref={root}>
      <button
        className="picker-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={commit ? `${refLabel(value)} at ${commit}` : undefined}
        onClick={() => setOpen(!open)}
      >
        <span className="picker-role">{role}:</span>
        <span className="picker-value">{refLabel(value)}</span>
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="m4.427 7.427 3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 7H4.604a.25.25 0 0 0-.177.427Z" />
        </svg>
      </button>
      {open && (
        <div className="picker-menu" role="dialog" aria-label={title}>
          <div className="picker-title">{title}</div>
          <div className="picker-search">
            <input
              className="filter"
              type="search"
              ref={focusInPlace}
              placeholder="Find a branch, tag or commit"
              aria-label="Find a ref"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                else if (e.key === "Enter") pick(items[cursor]);
                else if (e.key === "ArrowDown") setCursor((c) => Math.min(c + 1, items.length - 1));
                else if (e.key === "ArrowUp") setCursor((c) => Math.max(c - 1, 0));
                else return;
                e.preventDefault();
              }}
            />
          </div>
          <div className="picker-tabs" role="tablist">
            {(["branches", "tags", "commits"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                {t[0]!.toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <ul className="picker-list" role="listbox" aria-label={title}>
            {items.map((item, i) => (
              <li key={item.key} role="option" aria-selected={selected(item)}>
                <button className={i === cursor ? "is-cursor" : undefined} onMouseEnter={() => setCursor(i)} onClick={() => pick(item)}>
                  <svg className="picker-check" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                    {selected(item) && (
                      <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
                    )}
                  </svg>
                  <span className="picker-item-label">{item.label}</span>
                  {item.detail && <span className="picker-item-detail">{item.detail}</span>}
                </button>
              </li>
            ))}
            {items.length === 0 && <li className="picker-empty">{failed ?? (refs ? "Nothing to show" : "Loading…")}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

interface CommitListProps {
  diff: DiffResult;
  onView: (commit: CommitInfo) => void;
}

export function CommitList({ diff, onView }: CommitListProps) {
  const groups = useMemo(() => {
    const out: { day: string; commits: CommitInfo[] }[] = [];
    for (const c of diff.commits) {
      const day = new Date(c.date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
      const last = out[out.length - 1];
      if (last?.day === day) last.commits.push(c);
      else out.push({ day, commits: [c] });
    }
    return out;
  }, [diff.commits]);

  return (
    <div className="commits">
      {diff.commitCount > diff.commits.length && (
        <p className="file-note inline">
          Showing the newest {diff.commits.length.toLocaleString()} of {diff.commitCount.toLocaleString()} commits.
        </p>
      )}
      {groups.map((g) => (
        <section key={g.day} className="commit-group">
          <h3 className="commit-day">Commits on {g.day}</h3>
          <ol className="commit-list">
            {g.commits.map((c) => (
              <li key={c.sha} className="commit">
                <div className="commit-main">
                  <button
                    className="commit-subject"
                    onClick={() => onView(c)}
                    disabled={c.parents.length === 0}
                    title={c.parents.length ? "Show the changes in this commit" : "This commit has no parent to compare with"}
                  >
                    {c.subject || "(no message)"}
                  </button>
                  <div className="commit-meta">
                    {c.author} committed {new Date(c.date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                    {c.parents.length > 1 && " · merge"}
                  </div>
                </div>
                <code className="commit-sha" title={c.sha}>
                  {c.sha.slice(0, 7)}
                </code>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
