import { Fragment, useEffect, useRef } from "react";
import { pin, topBar } from "./anchor";
import { CloseIcon } from "./Conversations";
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
const sections = () => [...document.querySelectorAll<HTMLElement>(".files > :not([hidden]) > section[id]")];

function topOffset(): number {
  return topBar() + 8;
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

/** Scrolls a section to the top and holds it there while the sections around it mount. */
export function go(el: HTMLElement, setActive: (id: string) => void): void {
  el.scrollIntoView({ block: "start" });
  pin(el);
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

export function KeyboardButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="icon-button" onClick={onClick} aria-label="Keyboard shortcuts" title="Keyboard shortcuts">
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <rect x="1" y="3.5" width="14" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M4 6.5h.5M7.75 6.5h.5M11.5 6.5h.5M4.75 9.5h6.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}

// Comment fields take Ctrl+Enter on every platform, and Cmd+Enter as well on a Mac.
const KEYS: [string[], string][] = [
  [["j", "k"], "Next or previous file or topic"],
  [["u"], "Next conversation with a new answer"],
  [["Ctrl+Enter"], "Send the comment or review being written"],
  [["Esc"], "Cancel a comment, or close this list or the conversations"],
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
