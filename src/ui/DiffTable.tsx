import { Fragment, useState } from "react";
import type { DiffLine, DisplayHunk, Thread } from "../shared/types";
import { CommentForm, ThreadView, useComments } from "./comments";
import type { Token, TokenLines } from "./highlight";

type Side = "old" | "new";

interface Selection {
  side: Side;
  start: number;
  end: number;
  pivot: number;
}

interface Props {
  path: string;
  hunks: DisplayHunk[];
  oldTokens: TokenLines | null;
  newTokens: TokenLines | null;
}

const MARK = { add: "+", del: "-", context: " " } as const;

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

export function DiffTable({ path, hunks, oldTokens, newTokens }: Props) {
  const { threadsFor, create } = useComments();
  const [selection, setSelection] = useState<Selection | null>(null);
  const threads = threadsFor(path);

  const isSelected = (side: Side, no: number | null) =>
    selection !== null && no !== null && selection.side === side && no >= selection.start && no <= selection.end;

  const pick = (side: Side, no: number, extend: boolean) => {
    if (extend && selection?.side === side) {
      setSelection({ side, pivot: selection.pivot, start: Math.min(selection.pivot, no), end: Math.max(selection.pivot, no) });
    } else if (selection?.side === side && selection.start === no && selection.end === no) {
      setSelection(null);
    } else {
      setSelection({ side, pivot: no, start: no, end: no });
    }
  };

  const submit = async (body: string) => {
    if (!selection) return;
    const { side, start, end } = selection;
    await create({ path, side, start, end }, snippetOf(hunks, side, start, end), body);
    setSelection(null);
  };

  const below = (side: Side, no: number | null) => (
    <>
      {no !== null &&
        threads
          .filter((t) => t.anchor.side === side && t.anchor.end === no)
          .map((t) => <ThreadRow key={t.id} thread={t} />)}
      {selection?.side === side && selection.end === no && (
        <tr className="thread-row">
          <td colSpan={4}>
            <CommentForm placeholder="Leave a comment" submitLabel="Comment" onSubmit={submit} onCancel={() => setSelection(null)} />
          </td>
        </tr>
      )}
    </>
  );

  return (
    <table className="diff">
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
              <td className="num" />
              <td className="hunk-text" colSpan={3}>
                {h.header}
              </td>
            </tr>
            {toSplitRows(h.lines).map((row, ri) => {
              const oldNo = row.left?.oldNo ?? null;
              const newNo = row.right?.newNo ?? null;
              return (
                <Fragment key={ri}>
                  <tr>
                    <SplitCell
                      line={row.left}
                      tokens={row.left ? tokensFor(row.left, oldTokens, newTokens) : undefined}
                      side="old"
                      selected={isSelected("old", oldNo)}
                      onPick={pick}
                    />
                    <SplitCell
                      line={row.right}
                      tokens={row.right ? tokensFor(row.right, oldTokens, newTokens) : undefined}
                      side="new"
                      selected={isSelected("new", newNo)}
                      onPick={pick}
                    />
                  </tr>
                  {below("old", oldNo)}
                  {below("new", newNo)}
                </Fragment>
              );
            })}
          </Fragment>
        ))}
      </tbody>
    </table>
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

interface CellProps {
  line: DiffLine | null;
  tokens: Token[] | undefined;
  side: Side;
  selected: boolean;
  onPick: (side: Side, no: number, extend: boolean) => void;
}

function SplitCell({ line, tokens, side, selected, onPick }: CellProps) {
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
        data-n={n ?? ""}
        title={n ? "Comment on this line. Shift-click another line to select a range." : undefined}
        onClick={n ? (e) => onPick(side, n, e.shiftKey) : undefined}
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
