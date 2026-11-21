const WORD = "A-Za-z0-9_";
const IS_WORD = new RegExp(`[${WORD}]`);
const PIECE = /([A-Za-z0-9]+(?:[_-]+[A-Za-z0-9]+)*)|[^A-Za-z0-9]+/g;
const BETWEEN = "[_-]*";

function nameParts(name: string): string[] {
  return name.split(/[_-]+|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/).filter(Boolean);
}

function parts(query: string, whole: boolean, special: RegExp): { words: string[]; wordStart: boolean; wordEnd: boolean } {
  const q = query.trim();
  return {
    words: q.split(/\s+/).map((w) => w.replace(PIECE, (piece, name?: string) => (name ? nameParts(name).join(BETWEEN) : piece.replace(special, "\\$&")))),
    wordStart: whole && IS_WORD.test(q[0] ?? ""),
    wordEnd: whole && IS_WORD.test(q[q.length - 1] ?? ""),
  };
}

export function wordRegExp(query: string, whole: boolean): RegExp | null {
  if (!query.trim()) return null;
  const { words, wordStart, wordEnd } = parts(query, whole, /[.*+?^${}()|[\]\\]/g);
  return new RegExp(`${wordStart ? `(?<![${WORD}])` : ""}${words.join("\\s+")}${wordEnd ? `(?![${WORD}])` : ""}`, "i");
}

export function wordPattern(query: string, whole: boolean): string {
  const { words, wordStart, wordEnd } = parts(query, whole, /[.*+?^${()|[\\]/g);
  return `${wordStart ? `(^|[^${WORD}])` : ""}${words.join("[[:space:]]+")}${wordEnd ? `([^${WORD}]|$)` : ""}`;
}

export function plainOf(query: string): string[] {
  return [...new Set((query.match(/[A-Za-z0-9]+/g) ?? []).flatMap(nameParts).map((p) => p.toLowerCase()))].sort((a, b) => b.length - a.length);
}
