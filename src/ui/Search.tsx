import { useEffect, useRef, useSyncExternalStore } from "react";
import { wordRegExp } from "../shared/search";
import type { DiffLine, FileDiff, RepoHit } from "../shared/types";
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
}

interface Found {
  groups: { path: string; hits: Hit[] }[];
  hits: Hit[];
  capped: boolean;
}

export function searchDiff(files: FileDiff[], query: string, whole: boolean): Found {
  const word = wordRegExp(query, whole);
  const found: Found = { groups: [], hits: [], capped: false };
  if (!word) return found;

  for (const file of files) {
    const hits: Hit[] = [];
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        const match = word.exec(line.text);
        if (!match) continue;
        if (found.hits.length === MAX_HITS) return { ...found, capped: true };

        const side = line.kind === "del" ? "old" : "new";
        const no = (side === "old" ? line.oldNo : line.newNo)!;
        const hit: Hit = { path: file.path, side, no, kind: line.kind, text: line.text, at: match.index, length: match[0].length };
        if (!hits.length) found.groups.push({ path: file.path, hits });
        hits.push(hit);
        found.hits.push(hit);
      }
    }
  }
  return found;
}

export function repoFound(hits: RepoHit[], capped: boolean, files: FileDiff[], query: string, whole: boolean): Found {
  const word = wordRegExp(query, whole);
  const changed = new Map(files.map((f) => [f.path, f]));
  const groups = new Map<string, Hit[]>();
  let added = new Set<number>();
  for (const h of hits) {
    let list = groups.get(h.path);
    if (!list) {
      list = [];
      groups.set(h.path, list);
      added = addedLines(changed.get(h.path));
    }
    const match = word?.exec(h.text);
    const kind = added.has(h.no) ? "add" : "context";
    list.push({ path: h.path, side: "new", no: h.no, kind, text: h.text, at: match?.index ?? -1, length: match?.[0].length ?? 0 });
  }
  const ordered = [...groups].sort(([a], [b]) => comparePaths(a, b)).map(([path, list]) => ({ path, hits: list }));
  return { groups: ordered, hits: ordered.flatMap((g) => g.hits), capped };
}

export function definitionsFound(hits: RepoHit[], capped: boolean, files: FileDiff[], name: string): Found {
  const changed = new Map(files.map((f) => [f.path, f]));
  const first = [...hits]
    .sort((a, b) => Number(!changed.has(a.path)) - Number(!changed.has(b.path)) || comparePaths(a.path, b.path) || a.no - b.no)
    .slice(0, MAX_DEFINITIONS);
  const groups: Found["groups"] = [];
  for (const h of first) {
    const kind = addedLines(changed.get(h.path)).has(h.no) ? "add" : "context";
    const hit: Hit = { path: h.path, side: "new", no: h.no, kind, text: h.text, at: h.at, length: h.at < 0 ? 0 : name.length };
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
  found: Found;
  definitions: Found | null;
  current: Hit | null;
  onOpen: (hit: Hit) => void;
  empty: string;
}

export function SearchResults({ found, definitions, current, onOpen, empty }: Props) {
  return (
    <div className="search-results">
      {definitions && (
        <div className="search-definitions">
          <p className="search-count" title="Where the name is defined in the compared version. A definition opens its file on the right.">
            {definitions.capped ? "First " : ""}
            {plural(definitions.hits.length, "definition")}
          </p>
          <HitGroups groups={definitions.groups} current={current} onOpen={onOpen} />
        </div>
      )}
      {found.hits.length === 0 ? (
        <p className="tree-empty">{empty}</p>
      ) : (
        <>
          <p className="search-count">
            {found.capped ? "First " : ""}
            {plural(found.hits.length, "line")} in {plural(found.groups.length, "file")}
          </p>
          <HitGroups groups={found.groups} current={current} onOpen={onOpen} />
        </>
      )}
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
        {g.hits.map((h) => (
          <li key={`${h.side}${h.no}`}>
            <HitButton hit={h} current={h === current} onOpen={onOpen} />
          </li>
        ))}
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
