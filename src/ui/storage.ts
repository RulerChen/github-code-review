import { type SetStateAction, useCallback, useState } from "react";

export function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function useStoredState<T>(key: string, fallback: T): [T, (next: SetStateAction<T>) => void] {
  const [value, setValue] = useState(() => readStorage(key, fallback));
  const set = useCallback(
    (next: SetStateAction<T>) =>
      setValue((prev) => {
        const value = next instanceof Function ? next(prev) : next;
        writeStorage(key, value);
        return value;
      }),
    [key],
  );
  return [value, set];
}

export function useViewed<T>(key: string | null, idOf: (item: T) => string, signatureOf: (item: T) => string) {
  const [stored, setStored] = useState<{ key: string | null; marks: Record<string, string> }>({ key: null, marks: {} });
  if (key !== null && stored.key !== key) setStored({ key, marks: readStorage(key, {}) });
  const { marks } = stored;

  const isViewed = useCallback((item: T) => marks[idOf(item)] === signatureOf(item), [marks]);
  const toggle = useCallback(
    (item: T) => {
      if (key === null) return;
      setStored((prev) => {
        const next = { ...prev.marks };
        if (next[idOf(item)] === signatureOf(item)) delete next[idOf(item)];
        else next[idOf(item)] = signatureOf(item);
        writeStorage(key, next);
        return { key, marks: next };
      });
    },
    [key],
  );

  return [isViewed, toggle] as const;
}
