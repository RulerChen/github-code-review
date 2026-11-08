import type { Comparison } from "./types.js";

/** How the page names a comparison in its URL and requests: ?base=main&head=feature, with dots=2 for a direct one. */
export function comparisonQuery(c: Comparison): string {
  const params = new URLSearchParams({ base: c.base });
  if (c.head !== null) params.set("head", c.head);
  if (!c.threeDot) params.set("dots", "2");
  return params.toString();
}

export function comparisonFromQuery(params: URLSearchParams): Comparison | null {
  const base = params.get("base");
  return base ? { base, head: params.get("head") || null, threeDot: params.get("dots") !== "2" } : null;
}

export const sameComparison = (a: Comparison, b: Comparison) => a.base === b.base && a.head === b.head && a.threeDot === b.threeDot;

/** base...head, or base..head for a direct comparison. */
export function describeComparison(c: Comparison): string {
  return `${c.base}${c.threeDot ? "..." : ".."}${c.head ?? "the working tree"}`;
}
