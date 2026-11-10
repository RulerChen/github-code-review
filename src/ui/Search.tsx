import { useEffect, useRef, useSyncExternalStore } from "react";
import type { DiffLine, FileDiff } from "../shared/types";
import { plural } from "../shared/util";
import { pin } from "./anchor";
import { basename } from "./paths";

const MAX_HITS = 500;
const LEAD_CHARS = 16;
const FOUND_MS = 1300;

export interface Hit {
  path: string;
  side: "old" | "new";
  no: number;
  kind: DiffLine["kind"];
  text: string;
  at: number;
}

export interface Found {
  groups: { path: string; hits: Hit[] }[];
  hits: Hit[];
  capped: boolean;
}

export function searchDiff(files: FileDiff[], query: string): Found {
  const q = query.trim().toLowerCase();
  const found: Found = { groups: [], hits: [], capped: false };
  if (!q) return found;

  for (const file of files) {
    const hits: Hit[] = [];
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        const at = line.text.toLowerCase().indexOf(q);
        if (at < 0) continue;
        if (found.hits.length + hits.length === MAX_HITS) {
          found.capped = true;
          break;
        }
        const side = line.kind === "del" ? "old" : "new";
        hits.push({ path: file.path, side, no: (side === "old" ? line.oldNo : line.newNo)!, kind: line.kind, text: line.text, at });
      }
      if (found.capped) break;
    }
    if (hits.length) {
      found.groups.push({ path: file.path, hits });
      found.hits.push(...hits);
    }
    if (found.capped) break;
  }
  return found;
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
  query: string;
  current: Hit | null;
  onOpen: (hit: Hit) => void;
}

export function SearchResults({ found, query, current, onOpen }: Props) {
  const length = query.trim().length;
  if (found.hits.length === 0) return <p className="tree-empty">No matches in the lines shown in the diff.</p>;

  return (
    <div className="search-results">
      <p className="search-count">
        {found.capped ? "First " : ""}
        {plural(found.hits.length, "line")} in {plural(found.groups.length, "file")}
      </p>
      {found.groups.map((g) => (
        <section key={g.path}>
          <h3 className="search-file" title={g.path}>
            <span className="search-dir">{g.path.slice(0, g.path.length - basename(g.path).length)}</span>
            {basename(g.path)}
          </h3>
          <ul>
            {g.hits.map((h) => (
              <li key={`${h.side}${h.no}`}>
                <HitButton hit={h} length={length} current={h === current} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function HitButton({ hit, length, current, onOpen }: { hit: Hit; length: number; current: boolean; onOpen: (hit: Hit) => void }) {
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
        {from > indent && "…"}
        {hit.text.slice(from, hit.at)}
        <mark>{hit.text.slice(hit.at, hit.at + length)}</mark>
        {hit.text.slice(hit.at + length)}
      </span>
    </button>
  );
}
