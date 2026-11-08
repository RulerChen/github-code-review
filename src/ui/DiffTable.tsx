import { Fragment } from "react";
import type { DiffLine, DisplayHunk } from "../shared/types";
import type { Token, TokenLines } from "./highlight";

interface Props {
  hunks: DisplayHunk[];
  oldTokens: TokenLines | null;
  newTokens: TokenLines | null;
}

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

const MARK = { add: "+", del: "-", context: " " } as const;

export function DiffTable({ hunks, oldTokens, newTokens }: Props) {
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
            {toSplitRows(h.lines).map((row, ri) => (
              <tr key={ri}>
                <SplitCell line={row.left} tokens={row.left ? tokensFor(row.left, oldTokens, newTokens) : undefined} side="old" />
                <SplitCell line={row.right} tokens={row.right ? tokensFor(row.right, oldTokens, newTokens) : undefined} side="new" />
              </tr>
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

function SplitCell({ line, tokens, side }: { line: DiffLine | null; tokens: Token[] | undefined; side: "old" | "new" }) {
  if (!line) {
    return (
      <>
        <td className="num empty" />
        <td className="code empty" />
      </>
    );
  }
  const n = side === "old" ? line.oldNo : line.newNo;
  return (
    <>
      <td className={`num ${line.kind}`} data-n={n ?? ""} />
      <td className={`code ${line.kind}`} data-mark={MARK[line.kind]}>
        <Code line={line} tokens={tokens} />
      </td>
    </>
  );
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
