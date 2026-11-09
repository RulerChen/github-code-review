import type { Comparison, DiffRepo, RefRange, RepoRange } from "./types.js";
import { compareText } from "./util.js";

const rangeOf = (r: RefRange): RefRange => ({ base: r.base, head: r.head, threeDot: r.threeDot });

export const sameRange = (a: RefRange, b: RefRange) => a.base === b.base && a.head === b.head && a.threeDot === b.threeDot;

export const rangeFor = (c: Comparison, dir: string): RefRange => c.overrides.find((o) => o.dir === dir) ?? rangeOf(c);

export function withOverride(c: Comparison, dir: string, next: RefRange): Comparison {
  const rest = c.overrides.filter((o) => o.dir !== dir);
  return { ...rangeOf(c), overrides: sameRange(next, c) ? rest : sortOverrides([...rest, { dir, ...rangeOf(next) }]) };
}

export function withRange(c: Comparison, range: RefRange): Comparison {
  return { ...rangeOf(range), overrides: c.overrides.filter((o) => !sameRange(o, range)) };
}

export const sortOverrides = (overrides: RepoRange[]) => [...overrides].sort((a, b) => compareText(a.dir, b.dir));

export function comparisonQuery(c: Comparison): string {
  const params = new URLSearchParams();
  const add = (r: RefRange, suffix: string) => {
    params.set(`base${suffix}`, r.base);
    if (r.head !== null) params.set(`head${suffix}`, r.head);
    if (!r.threeDot) params.set(`dots${suffix}`, "2");
  };

  add(c, "");
  for (const o of c.overrides) add(o, `@${o.dir}`);
  return params.toString();
}

export function comparisonFromQuery(params: URLSearchParams): Comparison | null {
  const read = (suffix: string): RefRange | null => {
    const base = params.get(`base${suffix}`);
    return base ? { base, head: params.get(`head${suffix}`) || null, threeDot: params.get(`dots${suffix}`) !== "2" } : null;
  };

  const top = read("");
  if (!top) return null;

  const overrides: RepoRange[] = [];
  for (const key of new Set(params.keys())) {
    const range = key.startsWith("base@") ? read(key.slice(4)) : null;
    if (range) overrides.push({ dir: key.slice(5), ...range });
  }
  return { ...top, overrides: sortOverrides(overrides) };
}

export function sameComparison(a: Comparison, b: Comparison): boolean {
  return (
    sameRange(a, b) &&
    a.overrides.length === b.overrides.length &&
    a.overrides.every((o, i) => o.dir === b.overrides[i]!.dir && sameRange(o, b.overrides[i]!))
  );
}

export const isFor = (repo: string, c: Comparison) => (r: { repo: string; compare: Comparison }) =>
  r.repo === repo && sameComparison(r.compare, c);

export function describeComparison(c: Comparison, ref = (r: string | null) => r ?? "the working tree"): string {
  const range = (r: RefRange) => `${ref(r.base)}${r.threeDot ? "..." : ".."}${ref(r.head)}`;
  const own = c.overrides.map((o) => `${o.dir}: ${range(o)}`);
  return own.length ? `${range(c)} (${own.join("; ")})` : range(c);
}

export function repoFailures(repos: DiffRepo[]): { error: string; dirs: string[] }[] {
  const out = new Map<string, string[]>();
  for (const r of repos) if (r.error !== null) out.set(r.error, [...(out.get(r.error) ?? []), r.dir]);
  return [...out].map(([error, dirs]) => ({ error, dirs }));
}
