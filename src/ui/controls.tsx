import { useState } from "react";
import { CheckIcon, ChevronIcon, CommentIcon, CopyIcon } from "./icons";

const COPIED_MS = 1200;

export function CollapseButton({ collapsed, noun, onClick }: { collapsed: boolean; noun: string; onClick: () => void }) {
  return (
    <button
      className="icon-button chevron"
      aria-expanded={!collapsed}
      aria-label={collapsed ? `Expand ${noun}` : `Collapse ${noun}`}
      onClick={onClick}
    >
      <ChevronIcon />
    </button>
  );
}

export function CommentButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="icon-button" aria-label={label} title={label} onClick={onClick}>
      <CommentIcon />
    </button>
  );
}

export function ViewedToggle({ viewed, onChange }: { viewed: boolean; onChange: () => void }) {
  return (
    <label className="viewed-toggle">
      <input type="checkbox" checked={viewed} onChange={onChange} />
      Viewed
    </label>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {}

  const area = document.createElement("textarea");
  area.value = text;
  area.readOnly = true;
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "0";
  area.style.opacity = "0";
  const focused = document.activeElement;
  document.body.append(area);
  area.focus({ preventScroll: true });
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {}
  area.remove();
  if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
  return copied;
}

export function CopyButton({ text, label = "Copy file path" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void copyText(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_MS);
    });
  };

  return (
    <button className="icon-button" aria-label={label} title={copied ? "Copied" : label} onClick={copy}>
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}
