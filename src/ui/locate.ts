import { stripCr } from "../shared/hunks";
import type { Thread } from "../shared/types";

const WORD = /[\p{L}\p{N}]/u;
const outdated = new WeakSet<Thread>();

export const isOutdated = (thread: Thread) => outdated.has(thread);

const same = (a: string | undefined, b: string) => a !== undefined && stripCr(a) === stripCr(b);

export function locate(thread: Thread, lines: string[]): Thread {
  const { anchor } = thread;
  if (anchor.side === null) return thread;
  const want = thread.snippet.split("\n").map((l) => l.slice(1));
  if (want.length !== anchor.end - anchor.start + 1) return thread;

  const before = thread.context?.before ?? [];
  const after = thread.context?.after ?? [];
  const origin = anchor.start - 1;
  const telling = [...before, ...after].filter((l) => WORD.test(l)).length;
  const score = (at: number) =>
    before.filter((l, k) => WORD.test(l) && same(lines[at - before.length + k], l)).length +
    after.filter((l, k) => WORD.test(l) && same(lines[at + want.length + k], l)).length;

  let best = -1;
  let bestScore = -1;
  for (let at = 0; at + want.length <= lines.length; at++) {
    if (!want.every((l, k) => same(lines[at + k], l))) continue;
    const s = score(at);
    if (s > bestScore || (s === bestScore && Math.abs(at - origin) < Math.abs(best - origin))) {
      best = at;
      bestScore = s;
    }
  }

  if (best >= 0 && bestScore * 2 >= telling) {
    return best === origin ? thread : { ...thread, anchor: { ...anchor, start: best + 1, end: best + want.length } };
  }
  const gone = { ...thread, anchor: { ...anchor, ...around(lines, before, after, anchor.start, anchor.end) } };
  outdated.add(gone);
  return gone;
}

function around(lines: string[], before: string[], after: string[], start: number, end: number): { start: number; end: number } {
  const best = (block: string[], shift: number, from: number, near: number) => {
    let found = -1;
    let foundScore = 0;
    for (let at = from; at <= lines.length; at++) {
      const s = block.filter((l, k) => WORD.test(l) && same(lines[at + shift + k], l)).length;
      if (s > foundScore || (s > 0 && s === foundScore && Math.abs(at - near) < Math.abs(found - near))) {
        found = at;
        foundScore = s;
      }
    }
    return found;
  };

  const top = best(before, -before.length, 0, start - 1);
  const bottom = best(after, 0, Math.max(top, 0), top < 0 ? end : top + end - start + 1);
  const first = top >= 0 ? top + 1 : bottom >= 0 ? bottom - (end - start) : start;
  const last = bottom >= 0 ? bottom : top >= 0 ? top + end - start + 1 : end;
  const clamp = (n: number) => Math.min(Math.max(n, 1), Math.max(lines.length, 1));
  return { start: clamp(Math.min(first, last)), end: clamp(last) };
}
