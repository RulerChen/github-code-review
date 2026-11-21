import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { insideOf } from "../shared/scope";
import { wordRegExp } from "../shared/search";
import type { FileDiff, RepoHit } from "../shared/types";
import { plural } from "../shared/util";
import { pin } from "./anchor";
import { addedLines } from "./CodePanel";
import { ChevronIcon } from "./icons";
import { basename, comparePaths, dirPrefix } from "./paths";

const LEAD_CHARS = 16;
const PAGE_ROWS = 300;
const FOUND_MS = 2500;

export interface Hit {
  path: string;
  no: number;
  kind: "add" | "context";
  text: string;
  at: number;
  length: number;
  inDiff: boolean;
  inside: string | null;
}

interface Found {
  groups: { path: string; hits: Hit[] }[];
  hits: Hit[];
}

export interface Section {
  key: string;
  title: string;
  hint: string;
  found: Found;
}

export function searchChanges(files: FileDiff[], query: string, whole: boolean, matchCase: boolean): Found {
  const word = wordRegExp(query, whole, matchCase);
  const found: Found = { groups: [], hits: [] };
  if (!word) return found;

  for (const file of files) {
    const hits: Hit[] = [];
    let place: ((no: number) => string | null) | undefined;
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        const match = line.kind === "add" ? word.exec(line.text) : null;
        if (!match) continue;

        const no = line.newNo!;
        const inside = file.newContent === null ? null : (place ??= insideOf(file.newContent, file.path))(no);
        const hit: Hit = { path: file.path, no, kind: "add", text: line.text, at: match.index, length: match[0].length, inDiff: true, inside };
        if (!hits.length) found.groups.push({ path: file.path, hits });
        hits.push(hit);
        found.hits.push(hit);
      }
    }
  }
  return found;
}

const REFERENCES_HINT =
  "Every other line with the name, in every repository: the files the diff changes come first, each read from top to bottom. A line the diff adds goes to its place in the diff. Any other line opens its file on the right.";

export function searchSections(
  changes: Found,
  repo: { hits: RepoHit[] } | null,
  files: FileDiff[],
  query: string,
  whole: boolean,
  matchCase: boolean,
  definitions: Found | null,
): Section[] {
  const word = wordRegExp(query, whole, matchCase);
  const changed = new Map(files.map((f) => [f.path, f]));
  const idOf = (h: { path: string; no: number }) => `${h.path}\0${h.no}`;
  const defined = new Set((definitions?.hits ?? []).map(idOf));
  const changing = new Set(changes.hits.map(idOf));
  const added = new Map<string, Set<number>>();
  const byFile = new Map<string, Hit[]>();
  const put = (hit: Hit) => {
    const hits = byFile.get(hit.path);
    if (hits) hits.push(hit);
    else byFile.set(hit.path, [hit]);
  };

  for (const h of changes.hits) if (!defined.has(idOf(h))) put(h);
  for (const h of repo?.hits ?? []) {
    if (defined.has(idOf(h)) || changing.has(idOf(h))) continue;
    let lines = added.get(h.path);
    if (!lines) added.set(h.path, (lines = addedLines(changed.get(h.path))));
    const match = word?.exec(h.text);
    const kind = lines.has(h.no) ? "add" : "context";
    const at = match?.index ?? -1;
    put({ path: h.path, no: h.no, kind, text: h.text, at, length: match?.[0].length ?? 0, inDiff: false, inside: h.inside ?? null });
  }

  const groups = [...byFile]
    .sort(([a], [b]) => Number(!changed.has(a)) - Number(!changed.has(b)) || comparePaths(a, b))
    .map(([path, hits]) => ({ path, hits: hits.sort((x, y) => x.no - y.no) }));
  if (!groups.length) return [];
  return [{ key: "references", title: "References", hint: REFERENCES_HINT, found: { groups, hits: groups.flatMap((g) => g.hits) } }];
}

export function definitionsFound(hits: RepoHit[], files: FileDiff[], name: string, matchCase: boolean): Found {
  const changed = new Map(files.map((f) => [f.path, f]));
  const word = wordRegExp(name, true, matchCase);
  const sorted = [...hits].sort((a, b) => Number(!changed.has(a.path)) - Number(!changed.has(b.path)) || comparePaths(a.path, b.path) || a.no - b.no);
  const groups: Found["groups"] = [];
  for (const h of sorted) {
    const kind = addedLines(changed.get(h.path)).has(h.no) ? "add" : "context";
    const match = word?.exec(h.text);
    const length = h.at < 0 ? 0 : match?.index === h.at ? match[0].length : name.length;
    const hit: Hit = { path: h.path, no: h.no, kind, text: h.text, at: h.at, length, inDiff: false, inside: null };
    const last = groups[groups.length - 1];
    if (last?.path === h.path) last.hits.push(hit);
    else groups.push({ path: h.path, hits: [hit] });
  }
  return { groups, hits: groups.flatMap((g) => g.hits) };
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
  const cell = card?.querySelector(`td.num[data-side="new"][data-n="${target.no}"]`);
  const row = cell?.parentElement;
  if (!row || row.getClientRects().length === 0) return;

  target = null;
  row.scrollIntoView({ block: "center" });
  pin(row);
  row.classList.add("is-found");
  setTimeout(() => row.classList.remove("is-found"), FOUND_MS);
}

const MARK = { add: "+", context: "" } as const;

const DEFINITIONS_HINT = "Where the name is defined in the compared version. A definition opens its file on the right.";

interface Props {
  definitions: Found | null;
  sections: Section[];
  note: string | null;
  current: Hit | null;
  onOpen: (hit: Hit) => void;
}

interface Listed extends Section {
  count: string;
}

interface Planned {
  key: string;
  path: string;
  open: boolean;
  count: number;
  hits: Hit[];
}

const groupKey = (section: string, path: string) => `${section}\0${path}`;

function plan(listed: Listed[], folded: ReadonlySet<string>, rows: number): { planned: { section: Listed; groups: Planned[] }[]; cut: boolean } {
  let left = rows;
  let cut = false;
  const planned: { section: Listed; groups: Planned[] }[] = [];
  for (const section of listed) {
    if (left <= 0) {
      cut = true;
      break;
    }
    const groups: Planned[] = [];
    planned.push({ section, groups });
    if (folded.has(section.key)) continue;
    for (const g of section.found.groups) {
      if (left <= 0) {
        cut = true;
        break;
      }
      const key = groupKey(section.key, g.path);
      const open = !folded.has(key);
      const hits = open ? g.hits.slice(0, left - 1) : [];
      if (hits.length < (open ? g.hits.length : 0)) cut = true;
      left -= 1 + hits.length;
      groups.push({ key, path: g.path, open, count: g.hits.length, hits });
    }
  }
  return { planned, cut };
}

function rowsBefore(listed: Listed[], folded: ReadonlySet<string>, target: Hit): number {
  let rows = 0;
  for (const s of listed) {
    if (folded.has(s.key)) continue;
    for (const g of s.found.groups) {
      rows++;
      if (folded.has(groupKey(s.key, g.path))) continue;
      const at = g.hits.indexOf(target);
      if (at >= 0) return rows + at + 1;
      rows += g.hits.length;
    }
  }
  return rows;
}

export function SearchResults({ definitions, sections, note, current, onOpen }: Props) {
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const [rows, setRows] = useState(PAGE_ROWS);
  const more = useRef<HTMLDivElement>(null);
  const listed: Listed[] = [
    ...(definitions ? [{ key: "definitions", title: "Definitions", hint: DEFINITIONS_HINT, found: definitions, count: String(definitions.hits.length) }] : []),
    ...sections.map((s) => ({ ...s, count: plural(s.found.hits.length, "line") })),
  ];
  const { planned, cut } = plan(listed, folded, rows);
  const toggle = (key: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  useEffect(() => {
    const section = current && listed.find((l) => l.found.hits.includes(current));
    if (!current || !section) return;
    const keys = [section.key, groupKey(section.key, current.path)];
    const open = keys.some((k) => folded.has(k)) ? new Set([...folded].filter((k) => !keys.includes(k))) : folded;
    if (open !== folded) setFolded(open);
    setRows((r) => Math.max(r, rowsBefore(listed, open, current) + PAGE_ROWS));
  }, [current]);

  useEffect(() => {
    const end = more.current;
    if (!end) return;
    const seen = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setRows((r) => r + PAGE_ROWS), {
      root: end.closest(".sidebar"),
      rootMargin: "600px 0px",
    });
    seen.observe(end);
    return () => seen.disconnect();
  }, [rows, cut]);

  return (
    <div className="search-results">
      {planned.map(({ section, groups }) => {
        const open = !folded.has(section.key);
        return (
          <div className="search-section" key={section.key}>
            <button className="search-count" aria-expanded={open} title={section.hint} onClick={() => toggle(section.key)}>
              <span className="search-toggle">
                <ChevronIcon />
              </span>
              <span className="search-title">{section.title}</span>
              {section.count}
            </button>
            {open && <HitGroups groups={groups} current={current} onOpen={onOpen} onToggle={toggle} />}
          </div>
        );
      })}
      {cut && <div ref={more} className="search-more" />}
      {note !== null && <p className="tree-empty">{note}</p>}
    </div>
  );
}

interface GroupsProps {
  groups: Planned[];
  current: Hit | null;
  onOpen: (hit: Hit) => void;
  onToggle: (key: string) => void;
}

function HitGroups({ groups, current, onOpen, onToggle }: GroupsProps) {
  return groups.map((g) => (
    <section key={g.key}>
      <button className="search-file" aria-expanded={g.open} title={g.path} onClick={() => onToggle(g.key)}>
        <span className="search-toggle">
          <ChevronIcon />
        </span>
        <span className="search-dir">{dirPrefix(g.path)}</span>
        <span>{basename(g.path)}</span>
        <span className="search-file-count">{g.count}</span>
      </button>
      {g.open && (
        <ul>
          {g.hits.map((h, n) => {
            const starts = h.inside !== (g.hits[n - 1]?.inside ?? null);
            return (
              <li key={h.no} className={starts && h.inside === null ? "search-outside" : undefined}>
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
      )}
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
