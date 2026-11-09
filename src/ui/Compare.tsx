import { useEffect, useMemo, useRef, useState } from "react";
import { withOverride, withRange } from "../shared/comparison";
import type { CommitInfo, Comparison, DiffResult, RefList, RefRange } from "../shared/types";
import { errorMessage, plural } from "../shared/util";
import { focusInPlace } from "./anchor";
import { useDismiss, usePlaceBelow } from "./hooks";
import { CaretIcon, CheckMark, SwapIcon } from "./icons";

const SHA = /^[0-9a-f]{40,64}$/;
const MAX_ITEMS = 100;

export const refLabel = (ref: string | null) => (ref === null ? "working tree" : SHA.test(ref) ? ref.slice(0, 7) : ref);

interface CompareProps {
  diff: DiffResult;
  loadRefs: () => Promise<RefList>;
  onCompare: (next: Comparison) => void;
}

export function CompareControls({ diff, loadRefs, onCompare }: CompareProps) {
  return (
    <RangeControls
      range={diff}
      baseCommit={diff.baseCommit}
      headCommit={diff.headCommit}
      loadRefs={loadRefs}
      onChange={(next) => onCompare(withRange(diff, next))}
    />
  );
}

interface ReposProps {
  diff: DiffResult;
  loadRefs: (repo: string) => Promise<RefList>;
  onCompare: (next: Comparison) => void;
}

export function RepoComparisons({ diff, loadRefs, onCompare }: ReposProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const loaders = useMemo(() => new Map<string, () => Promise<RefList>>(), [loadRefs]);
  const loaderFor = (dir: string) => {
    let load = loaders.get(dir);
    if (!load) loaders.set(dir, (load = () => loadRefs(dir)));
    return load;
  };

  useDismiss(root, open, () => setOpen(false));
  usePlaceBelow(button, menu, open);
  if (diff.repos[0]?.dir === "") return null;
  const own = diff.overrides.length;
  const title = "Refs for each repository";

  return (
    <div className="picker repos-picker" ref={root}>
      <button
        ref={button}
        className="picker-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={own === 1 ? "1 repository compares refs of its own" : own ? `${own} repositories compare refs of their own` : title}
        onClick={() => setOpen(!open)}
      >
        <span className="picker-value">{plural(diff.repos.length, "repo")}</span>
        {own > 0 && <span className="picker-role">· {own} custom</span>}
        <CaretIcon />
      </button>
      {open && (
        <div ref={menu} className="picker-menu is-fixed repos-menu" role="dialog" aria-label={title}>
          <div className="picker-title">{title}</div>
          <ul className="repos-list">
            {diff.repos.map((r) => {
              const overridden = diff.overrides.some((o) => o.dir === r.dir);
              const files = diff.files.filter((f) => f.path.startsWith(`${r.dir}/`)).length;
              return (
                <li key={r.dir}>
                  <div className="repos-row">
                    <span className="repos-dir" title={r.dir}>
                      {r.dir}
                    </span>
                    <RangeControls
                      range={r}
                      baseCommit={r.baseCommit}
                      headCommit={r.headCommit}
                      loadRefs={loaderFor(r.dir)}
                      onChange={(next) => onCompare(withOverride(diff, r.dir, next))}
                    />
                    {r.error === null && <span className="repos-files">{plural(files, "file")}</span>}
                    {overridden && (
                      <button className="link-button repos-reset" onClick={() => onCompare(withOverride(diff, r.dir, diff))}>
                        Use default
                      </button>
                    )}
                  </div>
                  {r.error !== null && <p className="repos-error">{r.error}</p>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

interface RangeProps {
  range: RefRange;
  baseCommit: string | null;
  headCommit: string | null;
  loadRefs: () => Promise<RefList>;
  onChange: (next: RefRange) => void;
}

function RangeControls({ range, baseCommit, headCommit, loadRefs, onChange }: RangeProps) {
  const current: RefRange = { base: range.base, head: range.head, threeDot: range.threeDot };
  const dotsTitle = range.threeDot
    ? "Showing the changes on compare since it diverged from base (base...compare). Click to compare them directly (base..compare)."
    : "Comparing base and compare directly (base..compare). Click to show only the changes since compare diverged from base (base...compare).";

  return (
    <div className="compare">
      <button
        className="icon-button"
        onClick={() => range.head !== null && onChange({ ...current, base: range.head, head: range.base })}
        disabled={range.head === null}
        aria-label="Swap base and compare"
        title={range.head === null ? "The working tree can only be compared, not used as the base" : "Swap base and compare"}
      >
        <SwapIcon />
      </button>
      <RefPicker
        role="base"
        value={range.base}
        commit={baseCommit}
        loadRefs={loadRefs}
        onPick={(ref) => ref !== null && onChange({ ...current, base: ref })}
      />
      <button className="dots" onClick={() => onChange({ ...current, threeDot: !range.threeDot })} title={dotsTitle} aria-label={dotsTitle}>
        {range.threeDot ? "..." : ".."}
      </button>
      <RefPicker role="compare" value={range.head} commit={headCommit} loadRefs={loadRefs} onPick={(ref) => onChange({ ...current, head: ref })} />
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
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useDismiss(root, open, () => setOpen(false));
  usePlaceBelow(button, menu, open);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setFailed(null);
    loadRefs()
      .then((r) => !cancelled && setRefs(r))
      .catch((e: unknown) => !cancelled && setFailed(errorMessage(e)));
    return () => {
      cancelled = true;
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
            const detail = c.repo ? `${c.repo} ${c.sha.slice(0, 7)}` : c.sha.slice(0, 7);
            list.push({ key: `${c.repo ?? ""} ${c.sha}`, value: c.sha, label: c.subject, detail });
          }
        }
      } else {
        const names = (tab === "branches" ? refs.branches : refs.tags).filter((n) => n.toLowerCase().includes(lq));
        names.sort((a, b) => Number(b === q) - Number(a === q));
        const partial = new Map(refs.partial);
        for (const n of names) {
          const holders = partial.get(n);
          list.push({ key: n, value: n, label: n, detail: holders === undefined ? undefined : `${holders}/${refs.repoCount} repos` });
        }
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
    <div
      className="picker"
      ref={root}
      onKeyDown={(e) => {
        if (!open || e.key !== "Escape") return;
        e.preventDefault();
        setOpen(false);
      }}
    >
      <button
        ref={button}
        className="picker-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={commit ? `${refLabel(value)} at ${commit}` : undefined}
        onClick={() => setOpen(!open)}
      >
        <span className="picker-role">{role}:</span>
        <span className="picker-value">{refLabel(value)}</span>
        <CaretIcon />
      </button>
      {open && (
        <div ref={menu} className="picker-menu is-fixed" role="dialog" aria-label={title}>
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
                if (e.key === "Enter") pick(items[cursor]);
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
                  <CheckMark checked={selected(item)} />
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
              <li key={`${c.repo ?? ""} ${c.sha}`} className="commit">
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
                    {c.repo && `${c.repo} · `}
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
