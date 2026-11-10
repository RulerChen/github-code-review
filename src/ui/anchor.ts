import { flushSync } from "react-dom";

const UNIT = "tr, .file-body, .file-note, .file-threads, .unplaced, .topic-summary, .topic-threads, .focus, .topic-divider, section";
const STICKY = ".file-header, .topic-header";
const LEAF = "tr, .file-note, .topic-summary, .focus, .topic-divider";
const SKIPPED = `${STICKY}, colgroup`;
const READER_INPUT = ["wheel", "touchstart", "keydown", "mousedown"] as const;

interface Anchor {
  el: Element;
  top: number;
  scrollY: number;
}

let anchor: Anchor | null = null;
let pinned: Element | null = null;

export function topBar(): number {
  const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--topbar-h"));
  return Number.isFinite(bar) ? bar : 0;
}

function laidOut(el: Element | null): el is Element {
  return el !== null && el.isConnected && el.getClientRects().length > 0;
}

function firstUnder(el: Element, root: Element, y: number): Element | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, (node) => {
    const e = node as Element;
    if (e.matches(STICKY) || !laidOut(e)) return NodeFilter.FILTER_REJECT;
    const r = e.getBoundingClientRect();
    if (r.bottom <= y) return NodeFilter.FILTER_REJECT;
    return r.top >= y - 1 && e.matches(UNIT) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
  });
  walker.currentNode = el;
  return walker.nextNode() as Element | null;
}

export function childUnder(parent: Element, y: number): Element | null {
  const kids = parent.children;
  const under = (el: Element) => !el.matches(SKIPPED) && laidOut(el) && el.getBoundingClientRect().bottom > y;
  if (kids.length > 8) {
    const first = kids[0]!.matches(SKIPPED) ? 1 : 0;
    let lo = first;
    let hi = kids.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (kids[mid]!.getBoundingClientRect().bottom > y) hi = mid;
      else lo = mid + 1;
    }
    const before = kids[lo - 1];
    const sorted = (lo === kids.length || under(kids[lo]!)) && (lo === first || (laidOut(before!) && !under(before!)));
    if (sorted) return kids[lo] ?? null;
  }
  for (let i = 0; i < kids.length; i++) {
    if (under(kids[i]!)) return kids[i]!;
  }
  return null;
}

function pick(): Element | null {
  const main = document.querySelector("main.files");
  if (!main) return null;
  let y = topBar() + 1;
  let scope = main;
  let el: Element | null = null;
  let last: Element | null = null;

  for (;;) {
    const child = childUnder(scope, y);
    if (!child) break;
    last = child;
    const r = child.getBoundingClientRect();
    const header = child.firstElementChild;
    const bar = header?.matches(STICKY) && laidOut(header) ? header.getBoundingClientRect() : null;
    if (bar && bar.top <= y && bar.bottom + 1 > y) {
      y = bar.bottom + 1;
      if (r.bottom <= y) continue;
    } else if (r.top > y - 1) {
      if (child.matches(UNIT)) el = child;
      break;
    }
    if (child.matches(UNIT)) el = child;
    if (child.matches(LEAF)) break;
    scope = child;
  }
  el ??= last;

  const r = el?.getBoundingClientRect();
  if (el && r && r.top < y - 1 && !(el.matches(LEAF) && y - r.top < r.bottom - y)) el = firstUnder(el, main, y) ?? el;
  return el;
}

function record(): void {
  const el = laidOut(pinned) ? pinned : pick();
  anchor = el ? { el, top: el.getBoundingClientRect().top - topBar(), scrollY: window.scrollY } : null;
}

function settle(): void {
  if (anchor && laidOut(anchor.el)) {
    const drift = anchor.el.getBoundingClientRect().top - topBar() - (anchor.top - (window.scrollY - anchor.scrollY));
    if (Math.abs(drift) >= 0.5) window.scrollBy(0, drift);
  }
  record();
}

export function startAnchoring(): () => void {
  const observer = new ResizeObserver(settle);
  for (const el of document.querySelectorAll("main.files, .topbar")) observer.observe(el);
  window.addEventListener("scroll", settle, { passive: true });
  record();
  return () => {
    observer.disconnect();
    window.removeEventListener("scroll", settle);
    anchor = null;
  };
}

export function pinnedElement(): Element | null {
  return laidOut(pinned) ? pinned : null;
}

export function scrollToTop(): void {
  pinned = null;
  window.scrollTo(0, 0);
  record();
}

export function pin(el: Element): () => void {
  pinned = el;
  record();
  const stop = () => {
    if (pinned === el) pinned = null;
    for (const type of READER_INPUT) window.removeEventListener(type, stop, true);
  };
  for (const type of READER_INPUT) window.addEventListener(type, stop, { capture: true, passive: true });
  return stop;
}

export function focusInPlace(el: HTMLElement | null): void {
  el?.focus({ preventScroll: true });
}

export function keepInPlace(el: Element | null, change: () => void, floor = -Infinity): void {
  if (!el) return flushSync(change);
  settle();
  anchor = { el, top: Math.max(el.getBoundingClientRect().top, floor) - topBar(), scrollY: window.scrollY };
  flushSync(change);
  settle();
}

export function keepHeaderInPlace(header: HTMLElement | null, change: () => void): void {
  keepInPlace(header, change, topBar());
}
