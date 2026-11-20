import { createContext, useLayoutEffect, useRef } from "react";
import type { RepoHit } from "../shared/types";
import { plural } from "../shared/util";
import { useDismiss } from "./hooks";
import { basename, comparePaths, dirPrefix } from "./paths";

export type FindDefinition = (text: string, from: string, x: number, y: number) => void;

export const FindDefinitionContext = createContext<FindDefinition | null>(null);

const WORD = /[\p{L}\p{N}_$]/u;
const FIRST = /^[\p{L}_$]/u;
const NAME = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;
const MAX_SELECTED_CHARS = 200;
const MAX_SHOWN = 50;

export const isName = (text: string) => NAME.test(text);

function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  if ("caretPositionFromPoint" in document) {
    const p = document.caretPositionFromPoint(x, y);
    return p && { node: p.offsetNode, offset: p.offset };
  }
  const r = (document as Document).caretRangeFromPoint(x, y);
  return r && { node: r.startContainer, offset: r.startOffset };
}

export function wordAt(x: number, y: number): string | null {
  const caret = caretAt(x, y);
  const cell = caret?.node.parentElement?.closest("td.code");
  if (!caret || !(caret.node instanceof Text) || !cell) return null;

  let at = caret.offset;
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t && t !== caret.node; t = walker.nextNode()) at += t.textContent?.length ?? 0;
  const text = cell.textContent ?? "";
  let start = at;
  let end = at;
  while (start > 0 && WORD.test(text[start - 1]!)) start--;
  while (end < text.length && WORD.test(text[end]!)) end++;
  const word = text.slice(start, end);
  return FIRST.test(word) ? word : null;
}

export function selectedAt(x: number, y: number): string | null {
  const selection = getSelection();
  const caret = caretAt(x, y);
  if (!selection || selection.isCollapsed || !caret || !selection.getRangeAt(0).isPointInRange(caret.node, caret.offset)) return null;
  const text = selection.toString().trim();
  return text && text.length <= MAX_SELECTED_CHARS && !/[\n\r]/.test(text) ? text : null;
}

export function rankDefinitions(hits: RepoHit[], from: string): RepoHit[] {
  const dir = dirPrefix(from);
  const near = (h: RepoHit) => (h.path === from ? 0 : dirPrefix(h.path) === dir ? 1 : 2);
  return [...hits].sort((a, b) => near(a) - near(b) || comparePaths(a.path, b.path) || a.no - b.no);
}

export interface DefinitionLookup {
  name: string;
  x: number;
  y: number;
  hits: RepoHit[] | null;
  lines: boolean;
  capped: boolean;
  error: string | null;
}

interface Props {
  lookup: DefinitionLookup;
  onPick: (hit: RepoHit) => void;
  onSearch: () => void;
  onClose: () => void;
}

export function DefinitionMenu({ lookup, onPick, onSearch, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, true, onClose);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const below = lookup.y + 12;
    m.style.left = `${Math.max(16, Math.min(lookup.x, innerWidth - 16 - m.offsetWidth))}px`;
    m.style.top = `${below + m.offsetHeight <= innerHeight - 16 ? below : Math.max(16, lookup.y - 12 - m.offsetHeight)}px`;
  });

  const { name, hits, lines, capped, error } = lookup;
  const named = isName(name);
  const count = `${capped ? "First " : ""}${plural(hits?.length ?? 0, lines ? "line" : "definition")}`;
  const title = !hits?.length || error ? (named ? `Definition of ${name}` : `Lines with ${name}`) : `${count} ${lines ? "with" : "of"} ${name}`;
  const shown = hits?.slice(0, MAX_SHOWN) ?? [];
  return (
    <div ref={ref} className="picker-menu is-fixed definition-menu" role="dialog" aria-label={title}>
      <div className="picker-title">{title}</div>
      {error ? (
        <p className="picker-empty">Could not search: {error}</p>
      ) : hits === null ? (
        <p className="picker-empty">Searching…</p>
      ) : hits.length === 0 ? (
        <p className="picker-empty">{named ? "No definition found, and no line has the name." : "No line has this text."}</p>
      ) : (
        <>
          {lines && named && <p className="definition-note">No definition found. These lines have the name.</p>}
          <ul className="picker-list">
            {shown.map((h) => (
              <li key={`${h.path}:${h.no}`}>
                <button onClick={() => onPick(h)} title={`${h.path}:${h.no}`}>
                  <span className="picker-item-label definition-code">{h.text.trim()}</span>
                  <span className="picker-item-detail">
                    {basename(h.path)}:{h.no}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {shown.length < hits.length && (
            <button className="definition-more" onClick={onSearch}>
              Show all {capped ? "" : `${hits.length} `}in the search
            </button>
          )}
        </>
      )}
    </div>
  );
}
