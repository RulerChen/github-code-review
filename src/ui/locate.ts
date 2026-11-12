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
  const gone = { ...thread };
  outdated.add(gone);
  return gone;
}
