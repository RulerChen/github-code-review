const WORD = "A-Za-z0-9_";
const IS_WORD = new RegExp(`[${WORD}]`);
const PIECE = /([A-Za-z0-9]+(?:[_-]+[A-Za-z0-9]+)*)|[^A-Za-z0-9]+/g;
const BETWEEN = "[_-]*";

function nameParts(name: string): string[] {
  return name.split(/[_-]+|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/).filter(Boolean);
}

function parts(query: string, whole: boolean, matchCase: boolean, special: RegExp): { words: string[]; wordStart: boolean; wordEnd: boolean } {
  const q = query.trim();
  const escape = (s: string) => s.replace(special, "\\$&");
  return {
    words: q.split(/\s+/).map((w) => (matchCase ? escape(w) : w.replace(PIECE, (piece, name?: string) => (name ? nameParts(name).join(BETWEEN) : escape(piece))))),
    wordStart: whole && IS_WORD.test(q[0] ?? ""),
    wordEnd: whole && IS_WORD.test(q[q.length - 1] ?? ""),
  };
}

export function wordRegExp(query: string, whole: boolean, matchCase: boolean): RegExp | null {
  if (!query.trim()) return null;
  const { words, wordStart, wordEnd } = parts(query, whole, matchCase, /[.*+?^${}()|[\]\\]/g);
  return new RegExp(`${wordStart ? `(?<![${WORD}])` : ""}${words.join("\\s+")}${wordEnd ? `(?![${WORD}])` : ""}`, matchCase ? "" : "i");
}

export function wordPattern(query: string, whole: boolean, matchCase: boolean): string {
  const { words, wordStart, wordEnd } = parts(query, whole, matchCase, /[.*+?^${()|[\\]/g);
  return `${wordStart ? `(^|[^${WORD}])` : ""}${words.join("[[:space:]]+")}${wordEnd ? `([^${WORD}]|$)` : ""}`;
}

export function plainOf(query: string, matchCase: boolean): string[] {
  const plain = matchCase ? (query.match(/[A-Za-z0-9_]+/g) ?? []) : (query.match(/[A-Za-z0-9]+/g) ?? []).flatMap(nameParts).map((p) => p.toLowerCase());
  return [...new Set(plain)].sort((a, b) => b.length - a.length);
}
