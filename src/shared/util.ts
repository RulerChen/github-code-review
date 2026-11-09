export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

export function sum<T>(items: readonly T[], value: (item: T) => number): number {
  return items.reduce((total, item) => total + value(item), 0);
}

export const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
