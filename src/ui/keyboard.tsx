import { Fragment, useEffect, useRef } from "react";
import "./keyboard.css";

const TEXT_INPUT = /^(text|search|email|url|password|number|tel)$/;

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && TEXT_INPUT.test(target.type);
}

/** Runs the action named by the key pressed, unless a modifier is held or the focus is in a text field. */
export function useShortcuts(shortcuts: Record<string, () => void>): void {
  const latest = useRef(shortcuts);
  useEffect(() => {
    latest.current = shortcuts;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      if (typing(e.target)) {
        if (e.key === "Escape" && e.target instanceof HTMLInputElement) e.target.blur();
        return;
      }
      const action = latest.current[e.key];
      if (!action) return;
      e.preventDefault();
      action();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

// File and topic sections are found in the page itself, so the keys follow the reader's scrolling.
const sections = () => [...document.querySelectorAll<HTMLElement>(".files > section[id]")];

function topOffset(): number {
  const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--topbar-h"));
  return (Number.isFinite(bar) ? bar : 0) + 8;
}

/** The active section while it is on screen, otherwise the last one whose top has reached the top bar, or the first. */
function currentIndex(list: HTMLElement[], active: string | null): number {
  const top = topOffset();
  const i = active ? list.findIndex((s) => s.id === active) : -1;
  if (i >= 0) {
    const r = list[i]!.getBoundingClientRect();
    if (r.bottom > top && r.top < window.innerHeight) return i;
  }
  let index = 0;
  list.forEach((s, k) => {
    if (s.getBoundingClientRect().top <= top + 1) index = k;
  });
  return index;
}

function go(el: HTMLElement, setActive: (id: string) => void): void {
  el.scrollIntoView({ block: "start" });
  setActive(el.id);
}

export function stepSection(dir: 1 | -1, active: string | null, setActive: (id: string) => void): void {
  const list = sections();
  if (!list.length) return;
  const i = currentIndex(list, active);
  if (dir > 0) return go(list[Math.min(i + 1, list.length - 1)]!, setActive);
  const cur = list[i];
  const inside = cur !== undefined && cur.getBoundingClientRect().top < topOffset() - 2;
  go(list[inside ? i : Math.max(i - 1, 0)]!, setActive);
}

export function toggleSection(what: "viewed" | "collapsed", active: string | null, setActive: (id: string) => void): void {
  const list = sections();
  const el = list[currentIndex(list, active)];
  if (!el) return;
  const selector = what === "viewed" ? ":scope > header input[type=checkbox]" : ":scope > header .chevron";
  el.querySelector<HTMLElement>(selector)?.click();
  setActive(el.id);
  // A section that folds while its header is above the screen would leave the reader further down the page.
  requestAnimationFrame(() => {
    if (el.getBoundingClientRect().top < topOffset() - 2) el.scrollIntoView({ block: "start" });
  });
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M3.75 3.75l8.5 8.5M12.25 3.75l-8.5 8.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function KeyboardButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="icon-button" onClick={onClick} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <rect x="1" y="3.5" width="14" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M4 6.5h.5M7.75 6.5h.5M11.5 6.5h.5M4.75 9.5h6.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}

const KEYS: [string[], string][] = [
  [["j", "k"], "Next or previous file or topic"],
  [["n", "p"], "Next or previous conversation"],
  [["u"], "Next conversation with a new answer"],
  [["r"], "Reply to the current conversation"],
  [["v"], "Mark the current file or topic viewed"],
  [["o"], "Collapse or expand the current file or topic"],
  [["c"], "Show or hide conversations"],
  [["t"], "Switch between topics and files"],
  [["/"], "Filter files"],
  [["?"], "Show this list"],
  [["Esc"], "Close this list or the conversations"],
];

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="shortcut-backdrop" onClick={onClose}>
      <div
        className="shortcut-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shortcut-head">
          <h2 id="shortcut-title">Keyboard shortcuts</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close" autoFocus>
            <CloseIcon />
          </button>
        </header>
        <table className="shortcut-table">
          <tbody>
            {KEYS.map(([keys, label]) => (
              <tr key={label}>
                <td>
                  {keys.map((k, i) => (
                    <Fragment key={k}>
                      {i > 0 && " "}
                      <kbd>{k}</kbd>
                    </Fragment>
                  ))}
                </td>
                <td>{label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
