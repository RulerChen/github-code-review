import { Fragment, useEffect, useRef } from "react";
import { markActiveFile } from "./active";
import { pin } from "./anchor";
import { CloseIcon, KeyboardIcon } from "./icons";
import "./keyboard.css";

const TEXT_INPUT = /^(text|search|email|url|password|number|tel)$/;

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && TEXT_INPUT.test(target.type);
}

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

export function go(el: HTMLElement): void {
  el.scrollIntoView({ block: "start" });
  pin(el);
  markActiveFile();
}

export function KeyboardButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="icon-button" onClick={onClick} aria-label="Keyboard shortcuts" title="Keyboard shortcuts">
      <KeyboardIcon />
    </button>
  );
}

const KEYS: [string[], string][] = [
  [["Ctrl+Enter"], "Send the comment being written"],
  [["Ctrl+click"], "Go to where the name under the pointer is defined, or list the lines that use it when the pointer is on its definition. On selected text, find the lines with that text (⌘+click on a Mac)"],
  [["Alt+←", "Alt+→"], "Back and forward through the code opened on the right, as the browser's own buttons do (⌘+[ and ⌘+] on a Mac)"],
  [["Esc"], "Cancel a comment, or close this list, the code panel or the conversations"],
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
