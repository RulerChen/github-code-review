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

export function CopyButton({ text, label = "Copy file path" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), COPIED_MS);
      })
      .catch(() => undefined);
  };

  return (
    <button className="icon-button" aria-label={label} title={copied ? "Copied" : label} onClick={copy}>
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}
