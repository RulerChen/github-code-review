import { Fragment, memo, type MouseEvent, useEffect, useMemo, useState } from "react";
import type { DiffLine, DisplayHunk, Expansion, Thread } from "../shared/types";
import { CommentForm, onShownVersion, ThreadView, useComments } from "./comments";
import type { Token, TokenLines } from "./highlight";

type Side = "old" | "new";

interface Selection {
  side: Side;
  start: number;
  end: number;
  pivot: number;
}

interface Drag {
  side: Side;
  pivot: number;
  end: number;
  toggle: boolean;
}

const span = (side: Side, pivot: number, end: number): Selection => ({
  side,
  pivot,
  start: Math.min(pivot, end),
  end: Math.max(pivot, end),
});

export type OnExpand = (dir: keyof Expansion, blockId: string, lines: number) => void;

interface Props {
  path: string;
  hunks: DisplayHunk[];
  oldTokens: TokenLines | null;
  newTokens: TokenLines | null;
  onExpand: OnExpand;
}

const MARK = { add: "+", del: "-", context: " " } as const;
const EXPAND_STEP = 20;

const stripCr = (s: string) => (s.endsWith("\r") ? s.slice(0, -1) : s);

function tokensFor(line: DiffLine, oldTokens: TokenLines | null, newTokens: TokenLines | null): Token[] | undefined {
  if (line.kind === "del") return line.oldNo ? oldTokens?.[line.oldNo - 1] : undefined;
  if (line.newNo && newTokens) return newTokens[line.newNo - 1];
  return line.oldNo ? oldTokens?.[line.oldNo - 1] : undefined;
}

function Code({ line, tokens }: { line: DiffLine; tokens: Token[] | undefined }) {
  const text = stripCr(line.text);
  const usable = tokens && stripCr(tokens.map((t) => t.content).join("")) === text;
  return (
    <>
      {usable ? tokens.map((t, i) => (
        <span key={i} className="tok" style={t.style}>
          {t.content}
        </span>
      )) : text}
      {line.noEol && (
        <span className="noeol" title="No newline at end of file" aria-label="No newline at end of file">
          ⊘
        </span>
      )}
    </>
  );
}

export function DiffTable({ path, hunks, oldTokens, newTokens, onExpand }: Props) {
  const { threadsFor, create, versions } = useComments();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const threads = threadsFor(path);
  const rows = useMemo(() => hunks.map((h) => toSplitRows(h.lines)), [hunks]);
  const threadsAt = useMemo(() => {
    const at = new Map<string, Thread[]>();
    for (const t of threads) {
      if (t.anchor.side === null || !onShownVersion(t, versions)) continue;
      const key = `${t.anchor.side}:${t.anchor.end}`;
      at.set(key, [...(at.get(key) ?? []), t]);
    }
    return at;
  }, [threads, versions]);
  const last = hunks[hunks.length - 1];
  const shown = drag ? span(drag.side, drag.pivot, drag.end) : selection;

  const isSelected = (side: Side, no: number | null) =>
    shown !== null && no !== null && shown.side === side && no >= shown.start && no <= shown.end;

  // One pair of handlers on the table finds the line under the pointer, so cells carry no handlers.
  const press = (e: MouseEvent) => {
    const hit = e.button === 0 ? lineAt(e.target, true) : null;
    if (!hit) return;
    e.preventDefault();
    const [side, no] = hit;
    if (e.shiftKey && selection?.side === side) {
      setSelection(span(side, selection.pivot, no));
    } else {
      setDrag({ side, pivot: no, end: no, toggle: selection?.side === side && selection.start === no && selection.end === no });
    }
  };

  const hover = (e: MouseEvent) => {
    const hit = drag ? lineAt(e.target, false) : null;
    if (drag && hit && hit[0] === drag.side && hit[1] !== drag.end) setDrag({ ...drag, end: hit[1] });
  };

  useEffect(() => {
    if (!drag) return;
    const release = () => {
      setSelection(drag.toggle && drag.end === drag.pivot ? null : span(drag.side, drag.pivot, drag.end));
      setDrag(null);
    };
    window.addEventListener("mouseup", release);
    return () => window.removeEventListener("mouseup", release);
  }, [drag]);

  const submit = async (body: string) => {
    if (!selection) return;
    const { side, start, end } = selection;
    await create({ path, side, start, end }, snippetOf(hunks, side, start, end), body);
    setSelection(null);
  };

  const below = (side: Side, no: number | null) => {
    const list = no === null ? undefined : threadsAt.get(`${side}:${no}`);
    const form = selection?.side === side && selection.end === no;
    if (!list && !form) return null;
    return (
      <>
        {list?.map((t) => <ThreadRow key={t.id} thread={t} />)}
        {form && (
          <tr className="thread-row">
            <td colSpan={4}>
              <CommentForm placeholder="Leave a comment" submitLabel="Comment" onSubmit={submit} onCancel={() => setSelection(null)} />
            </td>
          </tr>
        )}
      </>
    );
  };

  return (
    <table className="diff" onMouseDown={press} onMouseOver={hover}>
      <colgroup>
        <col className="col-num" />
        <col />
        <col className="col-num" />
        <col />
      </colgroup>
      <tbody>
        {hunks.map((h, hi) => (
          <Fragment key={hi}>
            <tr className="hunk">
              <td className="num expander">
                <HunkExpanders prev={hunks[hi - 1]} hunk={h} onExpand={onExpand} />
              </td>
              <td className="hunk-text" colSpan={3}>
                {h.header}
              </td>
            </tr>
            {rows[hi]!.map((row, ri) => {
              const oldNo = row.left?.oldNo ?? null;
              const newNo = row.right?.newNo ?? null;
              return (
                <Fragment key={ri}>
                  <Row
                    row={row}
                    oldTokens={oldTokens}
                    newTokens={newTokens}
                    oldSelected={isSelected("old", oldNo)}
                    newSelected={isSelected("new", newNo)}
                  />
                  {below("old", oldNo)}
                  {below("new", newNo)}
                </Fragment>
              );
            })}
          </Fragment>
        ))}
        {last && last.hiddenBelow > 0 && (
          <tr className="hunk">
            <td className="num expander">
              <ExpandButton dir="down" onClick={() => onExpand("below", last.lastId, EXPAND_STEP)} />
            </td>
            <td className="hunk-text" colSpan={3} />
          </tr>
        )}
      </tbody>
    </table>
  );
}

// Lines hidden between two hunks with no change between them open together once few are left,
// as on GitHub. Otherwise each side opens EXPAND_STEP lines at a time.
function HunkExpanders({ prev, hunk, onExpand }: { prev: DisplayHunk | undefined; hunk: DisplayHunk; onExpand: OnExpand }) {
  const up = hunk.hiddenAbove;
  if (hunk.joinsPrevious && up > 0 && up <= EXPAND_STEP) {
    return <ExpandButton dir="all" onClick={() => onExpand("above", hunk.firstId, up)} />;
  }
  return (
    <>
      {prev && prev.hiddenBelow > 0 && <ExpandButton dir="down" onClick={() => onExpand("below", prev.lastId, EXPAND_STEP)} />}
      {up > 0 && <ExpandButton dir="up" onClick={() => onExpand("above", hunk.firstId, EXPAND_STEP)} />}
    </>
  );
}

const EXPAND_ICON = {
  up: { label: "Expand up", d: "M8 13V3M4.5 6.5 8 3l3.5 3.5" },
  down: { label: "Expand down", d: "M8 3v10M4.5 9.5 8 13l3.5-3.5" },
  all: { label: "Expand all", d: "M8 2v12M5 5l3-3 3 3M5 11l3 3 3-3" },
} as const;

function ExpandButton({ dir, onClick }: { dir: keyof typeof EXPAND_ICON; onClick: () => void }) {
  const { label, d } = EXPAND_ICON[dir];
  return (
    <button className="expand-button" aria-label={label} title={label} onClick={onClick}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path d={d} />
      </svg>
    </button>
  );
}

function ThreadRow({ thread }: { thread: Thread }) {
  return (
    <tr className="thread-row">
      <td colSpan={4}>
        <ThreadView thread={thread} />
      </td>
    </tr>
  );
}

// The side and number of the line in the cell under `target`, read from the number cell's data attributes.
function lineAt(target: EventTarget, numberOnly: boolean): [Side, number] | null {
  const td = target instanceof Element ? target.closest("td") : null;
  const num = td?.classList.contains("num") ? td : numberOnly ? null : td?.previousElementSibling;
  if (!(num instanceof HTMLElement)) return null;
  const side = num.dataset.side;
  const no = Number(num.dataset.n);
  return (side === "old" || side === "new") && no > 0 ? [side, no] : null;
}

interface RowProps {
  row: SplitRow;
  oldTokens: TokenLines | null;
  newTokens: TokenLines | null;
  oldSelected: boolean;
  newSelected: boolean;
}

// Memoized so a selection change renders only the rows whose selected state changed.
const Row = memo(function Row({ row, oldTokens, newTokens, oldSelected, newSelected }: RowProps) {
  return (
    <tr>
      <SplitCell line={row.left} tokens={row.left ? tokensFor(row.left, oldTokens, newTokens) : undefined} side="old" selected={oldSelected} />
      <SplitCell line={row.right} tokens={row.right ? tokensFor(row.right, oldTokens, newTokens) : undefined} side="new" selected={newSelected} />
    </tr>
  );
});

interface CellProps {
  line: DiffLine | null;
  tokens: Token[] | undefined;
  side: Side;
  selected: boolean;
}

function SplitCell({ line, tokens, side, selected }: CellProps) {
  if (!line) {
    return (
      <>
        <td className="num empty" />
        <td className="code empty" />
      </>
    );
  }
  const n = side === "old" ? line.oldNo : line.newNo;
  const sel = selected ? " is-selected" : "";
  return (
    <>
      <td
        className={`num ${line.kind}${sel}`}
        data-side={side}
        data-n={n ?? ""}
        title={n ? "Comment on this line. Drag or shift-click to select a range." : undefined}
      />
      <td className={`code ${line.kind}${sel}`} data-mark={MARK[line.kind]}>
        <Code line={line} tokens={tokens} />
      </td>
    </>
  );
}

function snippetOf(hunks: DisplayHunk[], side: Side, start: number, end: number): string {
  return hunks
    .flatMap((h) => h.lines)
    .filter((l) => {
      const no = side === "old" ? l.oldNo : l.newNo;
      return no !== null && no >= start && no <= end;
    })
    .map((l) => `${MARK[l.kind]}${l.text}`)
    .join("\n");
}

export function hasLine(hunks: DisplayHunk[], side: Side, no: number): boolean {
  return hunks.some((h) => h.lines.some((l) => (side === "old" ? l.oldNo : l.newNo) === no));
}

interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

export function splitRowCount(lines: DiffLine[]): number {
  let rows = 0;
  let dels = 0;
  let adds = 0;
  for (const line of lines) {
    if (line.kind === "add") {
      adds++;
      continue;
    }
    if (line.kind === "context" || adds > 0) {
      rows += Math.max(dels, adds);
      dels = adds = 0;
    }
    if (line.kind === "context") rows++;
    else dels++;
  }
  return rows + Math.max(dels, adds);
}

export function toSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.kind === "context") {
      rows.push({ left: line, right: line });
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i]!.kind === "del") dels.push(lines[i++]!);
    while (i < lines.length && lines[i]!.kind === "add") adds.push(lines[i++]!);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
      rows.push({ left: dels[k] ?? null, right: adds[k] ?? null });
    }
  }
  return rows;
}
