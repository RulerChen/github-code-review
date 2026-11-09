import { type RefObject, useEffect, useLayoutEffect, useState } from "react";
import { errorMessage } from "../shared/util";

export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) close();
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
}

export function usePlaceBelow(anchor: RefObject<HTMLElement | null>, menu: RefObject<HTMLElement | null>, open: boolean): void {
  useLayoutEffect(() => {
    const a = anchor.current;
    const m = menu.current;
    if (!open || !a || !m) return;
    const place = () => {
      const r = a.getBoundingClientRect();
      m.style.left = `${Math.max(16, Math.min(r.left, innerWidth - 16 - m.offsetWidth))}px`;
      m.style.top = `${Math.max(16, Math.min(r.bottom + 4, innerHeight - 16 - m.offsetHeight))}px`;
    };

    place();
    const observer = new ResizeObserver(place);
    observer.observe(m);
    addEventListener("scroll", place, true);
    addEventListener("resize", place);
    return () => {
      observer.disconnect();
      removeEventListener("scroll", place, true);
      removeEventListener("resize", place);
    };
  }, [open]);
}

export function useAction<A extends unknown[]>(action: (...args: A) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (...args: A) => {
    setBusy(true);
    setError(null);
    try {
      await action(...args);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, clearError: () => setError(null) };
}
