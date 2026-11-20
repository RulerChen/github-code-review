const WORD = "A-Za-z0-9_";
const IS_WORD = new RegExp(`[${WORD}]`);

function parts(query: string, special: RegExp): { words: string[]; wordStart: boolean; wordEnd: boolean } {
  const q = query.trim();
  return {
    words: q.split(/\s+/).map((w) => w.replace(special, "\\$&")),
    wordStart: IS_WORD.test(q[0] ?? ""),
    wordEnd: IS_WORD.test(q[q.length - 1] ?? ""),
  };
}

export function wordRegExp(query: string): RegExp | null {
  if (!query.trim()) return null;
  const { words, wordStart, wordEnd } = parts(query, /[.*+?^${}()|[\]\\]/g);
  return new RegExp(`${wordStart ? `(?<![${WORD}])` : ""}${words.join("\\s+")}${wordEnd ? `(?![${WORD}])` : ""}`, "i");
}

export function wordPattern(query: string): string {
  const { words, wordStart, wordEnd } = parts(query, /[.*+?^${()|[\\]/g);
  return `${wordStart ? `(^|[^${WORD}])` : ""}${words.join("[[:space:]]+")}${wordEnd ? `([^${WORD}]|$)` : ""}`;
}
