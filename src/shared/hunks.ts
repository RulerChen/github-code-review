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
  const runsBetween = (from: number, to: number) => {
    let count = 0;
    for (let i = from + 1; i <= to; i++) count += runBefore(i);
    return count;
  };

  const groups: Block[][] = [];
  for (const b of blocks) {
    const g = groups[groups.length - 1];
    const prev = g?.[g.length - 1];
    if (g && prev && hasCtx && runsBetween(index.get(prev)!, index.get(b)!) <= wantBelow(prev) + wantAbove(b)) g.push(b);
    else groups.push([b]);
  }

  return groups.map((g, gi) => {
    const first = g[0]!;
    const last = g[g.length - 1]!;
    const fi = index.get(first)!;
    const li = index.get(last)!;
    const prevShown = groups[gi - 1]?.at(-1);
    const nextShown = groups[gi + 1]?.[0];
    const pi = prevShown ? index.get(prevShown)! : -1;
    const ni = nextShown ? index.get(nextShown)! : all.length;

    let up = wantAbove(first);
    let top = fi;
    while (hasCtx && top - 1 > pi && up >= runBefore(top)) up -= runBefore(top--);
    let down = wantBelow(last);
    let bottom = li;
    while (hasCtx && bottom + 1 < ni && down >= runBefore(bottom + 1)) down -= runBefore(++bottom);
    const before = Math.min(up, runBefore(top));
    const after = Math.min(down, runBefore(bottom + 1));
    const hiddenAbove = hasCtx ? Math.max(0, runsBetween(pi, fi) - wantAbove(first) - (prevShown ? wantBelow(prevShown) : 0)) : 0;
    const hiddenBelow = hasCtx ? Math.max(0, runsBetween(li, ni) - wantBelow(last) - (nextShown ? wantAbove(nextShown) : 0)) : 0;

    const head = all[top]!;
    let o = head.oldStart - before;
    let n = head.newStart - before;
    const startO = o;
    const startN = n;
    const lines: DiffLine[] = [];
    const context = (count: number) => {
      for (let k = 0; k < count; k++, o++, n++) {
        lines.push({ kind: "context", oldNo: o + 1, newNo: n + 1, text: ctxText(o, n), blockId: null, noEol: false });
      }
    };

    context(before);
    for (const b of all.slice(top, bottom + 1)) {
      const outside = shown.has(b) ? {} : { outside: true };
      context(b.newStart - n);
      b.del.forEach((text, k) => {
        lines.push({ kind: "del", oldNo: ++o, newNo: null, text, blockId: b.id, noEol: b.oldNoEol && k === b.del.length - 1, ...outside });
      });
      b.add.forEach((text, k) => {
        lines.push({ kind: "add", oldNo: null, newNo: ++n, text, blockId: b.id, noEol: b.newNoEol && k === b.add.length - 1, ...outside });
      });
    }
    context(after);

    const header = hunkHeader(startO, o - startO, startN, n - startN, head.section);
    return { header, lines, firstId: first.id, lastId: last.id, hiddenAbove, hiddenBelow, joinsPrevious: prevShown !== undefined };
  });
}
