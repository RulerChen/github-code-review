import { useSyncExternalStore } from "react";
import { childUnder, pinnedElement, topBar } from "./anchor";

let active: string | null = null;
let frame = 0;
const listeners = new Set<() => void>();

function fileAtTop(): Element | null {
  const view = document.querySelector("main.files > .view:not([hidden])");
  if (!view) return null;
  const line = topBar() + 9;
  const fileFrom = (el: Element | null | undefined) => {
    while (el && !el.matches("section.file")) el = el.nextElementSibling;
    return el;
  };
  for (let el = childUnder(view, line); el; el = el.nextElementSibling) {
    const body = el.matches("section.topic") ? el.querySelector(":scope > .topic-body") : null;
    const file = body ? fileFrom(childUnder(body, line)) : el.matches("section.file") ? el : null;
    if (file) return file.getBoundingClientRect().top < window.innerHeight ? file : null;
  }
  return null;
}

export function markActiveFile(): void {
  const file = pinnedElement()?.closest("section.file") ?? fileAtTop();
  const next = file?.getAttribute("data-path") ?? null;
  if (next === active) return;
  active = next;
  for (const notify of listeners) notify();
}

export function followActiveFile(): () => void {
  const soon = () => {
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      markActiveFile();
    });
  };
  const observer = new ResizeObserver(soon);
  const main = document.querySelector("main.files");
  if (main) observer.observe(main);
  window.addEventListener("scroll", soon, { passive: true });
  return () => {
    observer.disconnect();
    window.removeEventListener("scroll", soon);
    cancelAnimationFrame(frame);
    frame = 0;
  };
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

export function useIsActiveFile(path: string): boolean {
  return useSyncExternalStore(subscribe, () => active === path);
}
