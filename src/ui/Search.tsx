import { useEffect, useRef, useSyncExternalStore } from "react";
import { insideOf } from "../shared/scope";
import { wordRegExp } from "../shared/search";
import type { DiffLine, DiffRepo, FileDiff, RepoHit } from "../shared/types";
import { plural } from "../shared/util";
import { pin } from "./anchor";
import { addedLines } from "./CodePanel";
import { basename, comparePaths, dirPrefix } from "./paths";

const MAX_HITS = 500;
const MAX_DEFINITIONS = 5;
const LEAD_CHARS = 16;
const FOUND_MS = 2500;

export interface Hit {
  path: string;
  side: "old" | "new";
  no: number;
  kind: DiffLine["kind"];
  text: string;
  at: number;
  length: number;
  // A changed line goes to its place in the diff. Any other line opens its file in the code panel.
  inDiff: boolean;
  // The function, method or class the line is in. Null at the top level and when that is not known.
  inside: string | null;
}

interface Found {
  groups: { path: string; hits: Hit[] }[];
  hits: Hit[];
  capped: boolean;
}

export interface Section {
  key: string;
  title: string;
  hint: string;
  found: Found;
}

// The lines the diff adds or removes that match.
export function searchChanges(files: FileDiff[], query: string, whole: boolean): Found {
  const word = wordRegExp(query, whole);
  const found: Found = { groups: [], hits: [], capped: false };
  if (!word) return found;

  for (const file of files) {
    const hits: Hit[] = [];
    const places: Partial<Record<Hit["side"], (no: number) => string | null>> = {};
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        const match = line.kind === "context" ? null : word.exec(line.text);
        if (!match) continue;
        if (found.hits.length === MAX_HITS) return { ...found, capped: true };

        const side = line.kind === "del" ? "old" : "new";
        const no = (side === "old" ? line.oldNo : line.newNo)!;
        const text = side === "old" ? file.oldContent : file.newContent;
        const place = text === null ? null : (places[side] ??= insideOf(text, side === "old" ? (file.oldPath ?? file.path) : file.path));
        const inside = place?.(no) ?? null;
        const hit: Hit = { path: file.path, side, no, kind: line.kind, text: line.text, at: match.index, length: match[0].length, inDiff: true, inside };
        if (!hits.length) found.groups.push({ path: file.path, hits });
        hits.push(hit);
        found.hits.push(hit);
      }
    }
  }
  return found;
}

const SECTIONS = [
  ["writes", "Writes", "Lines that give the name a value: an assignment, a key of an object, an argument passed by name. A line opens its file on the right."],
  ["changes", "In the changes", "Lines the diff adds or removes. A line goes to its place in the diff."],
  ["files", "Rest of the changed files", "Lines the diff leaves as they are, in the files it changes. A line opens its file on the right."],
  ["repo", "Unchanged files", "Files the diff does not touch. A line opens its file on the right."],
  ["repos", "Other repositories", "Repositories with no changes in the diff. A line opens its file on the right."],
] as const;

// Puts the lines that write the name first, since they answer where a value comes from, then orders the rest by how close they are to the diff: its changed lines, the rest of its files, the files it does not touch, and the repositories with no changes at all. A line listed as a definition is left out of the lines that open the same way.
export function searchSections(
  changes: Found,
  repo: { hits: RepoHit[]; capped: boolean } | null,
  files: FileDiff[],
  repos: DiffRepo[],
  query: string,
  whole: boolean,
  definitions: Found | null,
): Section[] {
  const word = wordRegExp(query, whole);
  const changed = new Map(files.map((f) => [f.path, f]));
  const idOf = (h: { path: string; no: number }) => `${h.path}\0${h.no}`;
  const defined = new Set((definitions?.hits ?? []).map(idOf));
  const changing = new Set(changes.hits.filter((h) => h.side === "new").map(idOf));
  const quiet = repos.filter((r) => r.dir !== "" && !files.some((f) => f.path.startsWith(`${r.dir}/`)));
  const added = new Map<string, Set<number>>();
  const lists: Record<string, Map<string, Hit[]>> = { writes: new Map(), files: new Map(), repo: new Map(), repos: new Map() };

  for (const h of repo?.hits ?? []) {
    const write = h.role === "write";
    if (defined.has(idOf(h)) || (!write && changing.has(idOf(h)))) continue;
    const file = changed.get(h.path);
    const key = write ? "writes" : file ? "files" : quiet.some((r) => h.path.startsWith(`${r.dir}/`)) ? "repos" : "repo";
    let lines = added.get(h.path);
    if (!lines) added.set(h.path, (lines = addedLines(file)));
    const match = word?.exec(h.text);
    const kind = lines.has(h.no) ? "add" : "context";
    const at = match?.index ?? -1;
    const hit: Hit = { path: h.path, side: "new", no: h.no, kind, text: h.text, at, length: match?.[0].length ?? 0, inDiff: false, inside: h.inside ?? null };
    const list = lists[key]!;
    list.set(h.path, [...(list.get(h.path) ?? []), hit]);
  }

  const out: Section[] = [];
  for (const [key, title, hint] of SECTIONS) {
    const groups = key === "changes" ? changes.groups : [...lists[key]!].sort(([a], [b]) => comparePaths(a, b)).map(([path, hits]) => ({ path, hits }));
    const capped = key === "changes" ? changes.capped : (repo?.capped ?? false);
    if (groups.length) out.push({ key, title, hint, found: { groups, hits: groups.flatMap((g) => g.hits), capped } });
  }
  return out;
}

export function definitionsFound(hits: RepoHit[], capped: boolean, files: FileDiff[], name: string): Found {
  const changed = new Map(files.map((f) => [f.path, f]));
  const first = [...hits]
    .sort((a, b) => Number(!changed.has(a.path)) - Number(!changed.has(b.path)) || comparePaths(a.path, b.path) || a.no - b.no)
    .slice(0, MAX_DEFINITIONS);
  const groups: Found["groups"] = [];
  for (const h of first) {
    const kind = addedLines(changed.get(h.path)).has(h.no) ? "add" : "context";
    const hit: Hit = { path: h.path, side: "new", no: h.no, kind, text: h.text, at: h.at, length: h.at < 0 ? 0 : name.length, inDiff: false, inside: null };
    const last = groups[groups.length - 1];
    if (last?.path === h.path) last.hits.push(hit);
    else groups.push({ path: h.path, hits: [hit] });
  }
  return { groups, hits: groups.flatMap((g) => g.hits), capped: capped || first.length < hits.length };
}

let target: Hit | null = null;
let seq = 0;
const listeners = new Set<() => void>();

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

export function revealLine(hit: Hit): void {
  target = hit;
  seq++;
  for (const notify of listeners) notify();
}

export function useLineTarget(path: string): number {
  return useSyncExternalStore(subscribe, () => (target?.path === path ? seq : 0));
}

export function showLineTarget(card: HTMLElement | null, path: string): void {
  if (target?.path !== path) return;
  const cell = card?.querySelector(`td.num[data-side="${target.side}"][data-n="${target.no}"]`);
  const row = cell?.parentElement;
  if (!row || row.getClientRects().length === 0) return;

  target = null;
  row.scrollIntoView({ block: "center" });
  pin(row);
  row.classList.add("is-found");
  setTimeout(() => row.classList.remove("is-found"), FOUND_MS);
}

const MARK = { add: "+", del: "-", context: "" } as const;

interface Props {
  definitions: Found | null;
  sections: Section[];
  // What is still missing from the list, or that nothing matched.
  note: string | null;
  current: Hit | null;
  onOpen: (hit: Hit) => void;
}

export function SearchResults({ definitions, sections, note, current, onOpen }: Props) {
  return (
    <div className="search-results">
      {definitions && (
        <div className="search-section">
          <p className="search-count" title="Where the name is defined in the compared version. A definition opens its file on the right.">
            <span className="search-title">Definitions</span>
            {definitions.capped ? "first " : ""}
            {definitions.hits.length}
          </p>
          <HitGroups groups={definitions.groups} current={current} onOpen={onOpen} />
        </div>
      )}
      {sections.map((s) => (
        <div className="search-section" key={s.key}>
          <p className="search-count" title={s.hint}>
            <span className="search-title">{s.title}</span>
            {s.found.capped ? "first " : ""}
            {plural(s.found.hits.length, "line")}
          </p>
          <HitGroups groups={s.found.groups} current={current} onOpen={onOpen} />
        </div>
      ))}
      {note !== null && <p className="tree-empty">{note}</p>}
    </div>
  );
}

function HitGroups({ groups, current, onOpen }: { groups: Found["groups"]; current: Hit | null; onOpen: (hit: Hit) => void }) {
  return groups.map((g) => (
    <section key={g.path}>
      <h3 className="search-file" title={g.path}>
        <span className="search-dir">{dirPrefix(g.path)}</span>
        {basename(g.path)}
      </h3>
      <ul>
        {g.hits.map((h, n) => {
          // Lines of one function sit under its name. A line outside any function that follows them is set apart by a rule.
          const starts = h.inside !== (g.hits[n - 1]?.inside ?? null);
          return (
            <li key={`${h.side}${h.no}`} className={starts && h.inside === null ? "search-outside" : undefined}>
              {starts && h.inside !== null && (
                <span className="search-inside" title={`These lines are in ${h.inside}`}>
                  {h.inside}
                </span>
              )}
              <HitButton hit={h} current={h === current} onOpen={onOpen} />
            </li>
          );
        })}
      </ul>
    </section>
  ));
}

function HitButton({ hit, current, onOpen }: { hit: Hit; current: boolean; onOpen: (hit: Hit) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (current) ref.current?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const indent = hit.text.length - hit.text.trimStart().length;
  const from = Math.max(indent, hit.at - LEAD_CHARS);
  return (
    <button ref={ref} className={`search-hit ${hit.kind}${current ? " is-current" : ""}`} onClick={() => onOpen(hit)} title={hit.text.trim()}>
      <span className="search-no">
        {MARK[hit.kind]}
        {hit.no}
      </span>
      <span className="search-text">
        {hit.at < 0 ? (
          hit.text.trim()
        ) : (
          <>
            {from > indent && "…"}
            {hit.text.slice(from, hit.at)}
            <mark>{hit.text.slice(hit.at, hit.at + hit.length)}</mark>
            {hit.text.slice(hit.at + hit.length)}
          </>
        )}
      </span>
    </button>
  );
}
