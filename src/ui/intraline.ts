export type Marks = number[];

interface Tok {
  text: string;
  at: number;
}

const TOKEN = /[A-Za-z0-9_]+|\s+|[^]/gu;
const WORD = /^[\p{L}\p{N}_]/u;
const SPACE = /^\s/;
const MAX_CELLS = 250_000;
const MIN_SHARED = 1 / 3;

function tokenize(s: string): Tok[] {
  const out: Tok[] = [];
  for (const m of s.matchAll(TOKEN)) out.push({ text: m[0], at: m.index });
  return out;
}

function shared(a: Tok[], b: Tok[]): [boolean[], boolean[]] {
  const inA = new Array<boolean>(a.length).fill(false);
  const inB = new Array<boolean>(b.length).fill(false);
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo]!.text === b[lo]!.text) {
    inA[lo] = inB[lo] = true;
    lo++;
  }

  let endA = a.length;
  let endB = b.length;
  while (endA > lo && endB > lo && a[endA - 1]!.text === b[endB - 1]!.text) {
    endA--;
    endB--;
    inA[endA] = inB[endB] = true;
  }

  const n = endA - lo;
  const m = endB - lo;
  if (n === 0 || m === 0 || n * m > MAX_CELLS) return [inA, inB];

  const w = m + 1;
  const len = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      len[i * w + j] =
        a[lo + i]!.text === b[lo + j]!.text ? len[(i + 1) * w + j + 1]! + 1 : Math.max(len[(i + 1) * w + j]!, len[i * w + j + 1]!);
    }
  }

  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[lo + i]!.text === b[lo + j]!.text) {
      inA[lo + i] = inB[lo + j] = true;
      i++;
      j++;
    } else if (len[(i + 1) * w + j]! >= len[i * w + j + 1]!) i++;
    else j++;
  }
  return [inA, inB];
}

function weigh(toks: Tok[], counts: (text: string) => boolean, only?: boolean[]): number {
  let total = 0;
  toks.forEach((t, i) => {
    if (counts(t.text) && (!only || only[i])) total += t.text.length;
  });
  return total;
}

function changed(toks: Tok[], kept: boolean[], line: string): Marks {
  const out: Marks = [];
  toks.forEach((t, i) => {
    if (kept[i]) return;
    const last = out.length - 1;
    if (last >= 0 && !/\S/.test(line.slice(out[last], t.at))) out[last] = t.at + t.text.length;
    else out.push(t.at, t.at + t.text.length);
  });
  return out;
}

export function intraline(a: string, b: string): [Marks, Marks] | null {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const [inA, inB] = shared(ta, tb);

  const isWord = (text: string) => WORD.test(text);
  const isInk = (text: string) => !SPACE.test(text);
  const counts = weigh(ta, isWord) > 0 && weigh(tb, isWord) > 0 ? isWord : isInk;
  const common = weigh(ta, counts, inA);
  if (common === 0 || common < Math.min(weigh(ta, counts), weigh(tb, counts)) * MIN_SHARED) return null;

  const marks: [Marks, Marks] = [changed(ta, inA, a), changed(tb, inB, b)];
  return marks[0].length || marks[1].length ? marks : null;
}
