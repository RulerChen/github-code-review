import { flushSync } from "react-dom";

// The browser's scroll anchoring keeps the element that straddles the top bar in place. Here that is often a file
// card whose own body changes height: a placeholder mounting, lines rewrapping when the sidebar or a panel changes
// the width, a refresh or a new thread above the reader. The card's top stays put and everything under it moves.
// So the page turns it off and keeps the first element under the top bar in place itself, or an element it pins.

const UNIT = "tr, .file-body, .file-note, .file-threads, .unplaced, .topic-summary, .topic-threads, .focus, .topic-divider, section";
const STICKY = ".file-header, .topic-header";
// Blocks that change height only as their text rewraps, unlike a card or a list of threads.
const LEAF = "tr, .file-note, .topic-summary, .focus, .topic-divider";
const READER_INPUT = ["wheel", "touchstart", "keydown", "mousedown"] as const;

// `top` is from the top bar's edge, so content stays under the edge when the top bar changes height.
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

// The first row, note or section after `el` in document order, inside it or not, whose top is at or under `y`.
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

// The diff row, note or section at the edge of what the reader sees: under the top bar, and under the file or topic
// headers stuck below it, which cover the rows they pass over. When
// the element there starts above the edge, its own height can still change. A row keeps whichever of its ends is
// nearer the edge, so rewrapping moves the text at the edge least: its top is itself, its bottom is where the next
// element starts. Anything else gives way to the first element after it that starts under the edge, which may be
// inside it: a file card whose header is stuck starts just above the edge, and its body is what the reader sees.
function pick(): Element | null {
  const main = document.querySelector("main.files");
  if (!main) return null;
  const box = main.getBoundingClientRect();
  const x = box.left + box.width / 2;
  let y = topBar() + 1;
  for (let header = document.elementFromPoint(x, y)?.closest(STICKY); header && main.contains(header); ) {
    y = header.getBoundingClientRect().bottom + 1;
    const below = document.elementFromPoint(x, y)?.closest(STICKY);
    header = below === header ? null : below;
  }
  const hit = document.elementsFromPoint(x, y).find((e) => e !== main && main.contains(e) && !e.closest(STICKY));
  let el = hit?.closest(UNIT) ?? null;
  if (!el || !main.contains(el)) {
    el = [...(hit ?? main).children].find((c) => laidOut(c) && c.getBoundingClientRect().bottom > y) ?? null;
  }
  const r = el?.getBoundingClientRect();
  if (el && r && r.top < y - 1 && !(el.matches(LEAF) && y - r.top < r.bottom - y)) el = firstUnder(el, main, y) ?? el;
  return el;
}

function record(): void {
  const el = laidOut(pinned) ? pinned : pick();
  anchor = el ? { el, top: el.getBoundingClientRect().top - topBar(), scrollY: window.scrollY } : null;
}

// Scrolling moves the anchor by as much as the page scrolled. Whatever it moved beyond that, the layout moved it.
function settle(): void {
  if (anchor && laidOut(anchor.el)) {
    const drift = anchor.el.getBoundingClientRect().top - topBar() - (anchor.top - (window.scrollY - anchor.scrollY));
    if (Math.abs(drift) >= 0.5) window.scrollBy(0, drift);
  }
  record();
}

/** Keeps the content under the top bar in place while the page changes. Returns a function that stops. */
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

/** Scrolls to the top of the page and keeps what is there in place from now on, not what was on screen before. */
export function scrollToTop(): void {
  pinned = null;
  window.scrollTo(0, 0);
  record();
}

/** Holds an element where it is on screen until the reader scrolls, clicks or types. Returns a function that lets go. */
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

/**
 * A ref that focuses an element when it mounts without scrolling the page. Popovers in the top bar are always on
 * screen, but inside the band the top bar covers, so a plain focus scrolls the page to bring them out from under it.
 */
export function focusInPlace(el: HTMLElement | null): void {
  el?.focus({ preventScroll: true });
}

/** Applies a change, then scrolls so the element is where it was on screen, or at least at `floor`. */
export function keepInPlace(el: Element | null, change: () => void, floor = -Infinity): void {
  if (!el) return flushSync(change);
  settle();
  anchor = { el, top: Math.max(el.getBoundingClientRect().top, floor) - topBar(), scrollY: window.scrollY };
  flushSync(change);
  settle();
}

/**
 * Applies a change that may fold a file or topic and keeps its header where it was. Folding under a stuck header
 * would otherwise leave the reader files further down the page. A header above the top bar, which only the keyboard
 * can fold, comes back to just under it.
 */
export function keepHeaderInPlace(header: HTMLElement | null, change: () => void): void {
  keepInPlace(header, change, topBar());
}
