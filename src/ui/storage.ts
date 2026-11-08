import { useCallback, useState } from "react";

// localStorage can be missing or throw (private windows, blocked site data); the UI must work without it.
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
  } catch {
    // Not persisting is acceptable.
  }
}

export function usePersistentState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => readStorage(key, initial));
  const set = useCallback(
    (v: T) => {
      setValue(v);
      writeStorage(key, v);
    },
    [key],
  );
  return [value, set];
}
