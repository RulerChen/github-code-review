import type { Block, DiffLine, DisplayHunk, Expansion, FileDiff } from "./types.js";

const CONTEXT_LINES = 3;

export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export const stripCr = (s: string) => (s.endsWith("\r") ? s.slice(0, -1) : s);

export function changeIds(file: FileDiff): string[] {
  return file.blocks.length ? file.blocks.map((b) => b.id) : [`file:${file.path}`];
}

function rangeHeader(start0: number, count: number): string {
  if (count === 0) return `${start0},0`;
  if (count === 1) return `${start0 + 1}`;
  return `${start0 + 1},${count}`;
}

export function hunkHeader(oldStart: number, oldCount: number, newStart: number, newCount: number, section: string): string {
  return `@@ -${rangeHeader(oldStart, oldCount)} +${rangeHeader(newStart, newCount)} @@${section ? ` ${section}` : ""}`;
}

export function buildHunks(
  blocks: Block[],
  oldLines: string[] | null,
  newLines: string[] | null,
  all: Block[] = blocks,
  expansion: Expansion | null = null,
): DisplayHunk[] {
  if (blocks.length === 0) return [];
  const hasCtx = newLines !== null || oldLines !== null;
  const total = newLines ? newLines.length : oldLines ? oldLines.length : 0;
  const endOf = (b: Block) => (newLines ? b.newStart + b.newCount : b.oldStart + b.oldCount);
  const startOf = (b: Block) => (newLines ? b.newStart : b.oldStart);
  const ctxText = (o: number, n: number) => (newLines ? newLines[n] : oldLines?.[o]) ?? "";
  const wantAbove = (b: Block) => (hasCtx ? CONTEXT_LINES + (expansion?.above[b.id] ?? 0) : 0);
  const wantBelow = (b: Block) => (hasCtx ? CONTEXT_LINES + (expansion?.below[b.id] ?? 0) : 0);

  const index = new Map(all.map((b, i) => [b, i]));
  const shown = new Set(blocks);
  const runBefore = (i: number) =>
    Math.max(0, (i < all.length ? startOf(all[i]!) : total) - (i > 0 ? endOf(all[i - 1]!) : 0));

  const groups: Block[][] = [];
  for (const b of blocks) {
    const g = groups[groups.length - 1];
    const prev = g?.[g.length - 1];
    const i = index.get(b)!;
    const adjacent = prev !== undefined && i === index.get(prev)! + 1;
    if (g && prev && hasCtx && adjacent && runBefore(i) <= wantBelow(prev) + wantAbove(b)) g.push(b);
    else groups.push([b]);
  }

  return groups.map((g) => {
    const first = g[0]!;
    const last = g[g.length - 1]!;
    const fi = index.get(first)!;
    const li = index.get(last)!;
    const prevBlock = all[fi - 1];
    const nextBlock = all[li + 1];
    const joinsPrevious = prevBlock !== undefined && shown.has(prevBlock);
    const joinsNext = nextBlock !== undefined && shown.has(nextBlock);
    const runAbove = runBefore(fi);
    const runBelow = runBefore(li + 1);
    const before = Math.min(wantAbove(first), runAbove);
    const after = Math.min(wantBelow(last), runBelow);
    const hiddenAbove = hasCtx ? Math.max(0, runAbove - before - (joinsPrevious ? wantBelow(prevBlock) : 0)) : 0;
    const hiddenBelow = hasCtx ? Math.max(0, runBelow - after - (joinsNext ? wantAbove(nextBlock) : 0)) : 0;

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

    const header = hunkHeader(startO, o - startO, startN, n - startN, first.section);
    return { header, lines, firstId: first.id, lastId: last.id, hiddenAbove, hiddenBelow, joinsPrevious };
  });
}
