import type { FlowStep } from "./types.js";

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

export function sum<T>(items: readonly T[], value: (item: T) => number): number {
  return items.reduce((total, item) => total + value(item), 0);
}

const IMAGE_TYPES = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["avif", "image/avif"],
  ["bmp", "image/bmp"],
  ["ico", "image/x-icon"],
]);

export function imageTypeOf(path: string): string | null {
  return IMAGE_TYPES.get(/\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? "") ?? null;
}

export const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function describeStep(s: FlowStep): string {
  const via = s.via ? ` (then ${s.via.kind}${s.via.label ? ` ${s.via.label}` : ""})` : "";
  return `${s.path}:${s.line} ${s.action ? `${s.action}: ` : ""}${s.text}${via}`;
}
