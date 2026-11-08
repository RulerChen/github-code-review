import type { Block, DiffLine, DisplayHunk, FileDiff } from "./types.js";

export const CONTEXT_LINES = 3;

export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function changeIds(file: FileDiff): string[] {
  return file.blocks.length ? file.blocks.map((b) => b.id) : [`file:${file.path}`];
}

export function rangeHeader(start0: number, count: number): string {
  if (count === 0) return `${start0},0`;
  if (count === 1) return `${start0 + 1}`;
  return `${start0 + 1},${count}`;
}

export function buildHunks(
  blocks: Block[],
  oldLines: string[] | null,
  newLines: string[] | null,
  all: Block[] = blocks,
): DisplayHunk[] {
  if (blocks.length === 0) return [];
  const hasCtx = newLines !== null || oldLines !== null;
  const C = hasCtx ? CONTEXT_LINES : 0;

  const total = newLines ? newLines.length : oldLines ? oldLines.length : 0;
  const endOf = (b: Block) => (newLines ? b.newStart + b.newCount : b.oldStart + b.oldCount);
  const startOf = (b: Block) => (newLines ? b.newStart : b.oldStart);
  const ctxText = (o: number, n: number) => (newLines ? newLines[n] : oldLines?.[o]) ?? "";

  const index = new Map(all.map((b, i) => [b, i]));
  const groups: Block[][] = [];
  for (const b of blocks) {
    const g = groups[groups.length - 1];
    const prev = g?.[g.length - 1];
    const adjacent = prev !== undefined && index.get(b) === index.get(prev)! + 1;
    if (g && prev && hasCtx && adjacent && startOf(b) - endOf(prev) <= 2 * C) g.push(b);
    else groups.push([b]);
  }

  return groups.map((g) => {
    const first = g[0]!;
    const last = g[g.length - 1]!;
    const prevBlock = all[index.get(first)! - 1];
    const nextBlock = all[index.get(last)! + 1];
    const prevEnd = prevBlock ? endOf(prevBlock) : 0;
    const nextStart = nextBlock ? startOf(nextBlock) : total;
    const before = Math.min(C, startOf(first) - prevEnd);
    const after = Math.max(0, Math.min(C, nextStart - endOf(last)));

    let o = first.oldStart - before;
    let n = first.newStart - before;
    const startO = o;
    const startN = n;
    const lines: DiffLine[] = [];
    const context = (count: number) => {
      for (let k = 0; k < count; k++, o++, n++) {
        lines.push({ kind: "context", oldNo: o + 1, newNo: n + 1, text: ctxText(o, n), blockId: null, noEol: false });
      }
    };

    context(before);
    for (const b of g) {
      context(b.newStart - n);
      b.del.forEach((text, k) => {
        lines.push({ kind: "del", oldNo: ++o, newNo: null, text, blockId: b.id, noEol: b.oldNoEol && k === b.del.length - 1 });
      });
      b.add.forEach((text, k) => {
        lines.push({ kind: "add", oldNo: null, newNo: ++n, text, blockId: b.id, noEol: b.newNoEol && k === b.add.length - 1 });
      });
    }
    context(after);

    const header = `@@ -${rangeHeader(startO, o - startO)} +${rangeHeader(startN, n - startN)} @@${first.section ? ` ${first.section}` : ""}`;
    return { header, lines };
  });
}
