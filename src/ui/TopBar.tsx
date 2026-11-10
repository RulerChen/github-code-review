import { memo, useLayoutEffect, useRef, useState } from "react";
import type { FileDiff } from "../shared/types";
import { plural, sum } from "../shared/util";
import { MoonIcon, SidebarIcon, SunIcon, SyncIcon } from "./icons";
import { readStorage, writeStorage } from "./storage";

export type Tab = "topics" | "files" | "commits";

const THEME_KEY = "diff-review:theme";

export function initTheme(): void {
  const stored = readStorage<string | null>(THEME_KEY, null);
  document.documentElement.dataset.theme =
    stored === "light" || stored === "dark" ? stored : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    writeStorage(THEME_KEY, next);
    setTheme(next);
  };
  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button className="icon-button" onClick={toggle} aria-label={label} title={label}>
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

export function SidebarToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const label = open ? "Collapse sidebar" : "Expand sidebar";
  return (
    <button className="icon-button sidebar-toggle" onClick={onToggle} aria-label={label} aria-expanded={open} title={label}>
      <SidebarIcon open={open} />
    </button>
  );
}

export const ChangeStats = memo(function ChangeStats({ files }: { files: FileDiff[] }) {
  return (
    <div className="topbar-stats">
      <span>{plural(files.length, "file")} changed</span>
      <span className="count-add">+{sum(files, (f) => f.additions).toLocaleString()}</span>
      <span className="count-del">−{sum(files, (f) => f.deletions).toLocaleString()}</span>
    </div>
  );
});

export function RefreshButton({ stale, loading, onClick }: { stale: boolean; loading: boolean; onClick: () => void }) {
  const label = "Load new changes";
  return (
    <button
      className={`icon-button refresh-button${stale ? " is-shown" : ""}${loading ? " is-loading" : ""}`}
      onClick={onClick}
      disabled={!stale || loading}
      aria-label={label}
      title={label}
    >
      <SyncIcon />
      {label}
    </button>
  );
}

const TABS: [Tab, string][] = [
  ["topics", "Topics"],
  ["files", "Files"],
  ["commits", "Commits"],
];

export function ViewTabs({ view, commitCount, onSelect }: { view: Tab; commitCount: number; onSelect: (tab: Tab) => void }) {
  return (
    <div className="segmented" role="tablist" aria-label="Show">
      <SlidingIndicator selected={view} />
      {TABS.filter(([tab]) => tab !== "commits" || commitCount > 0).map(([tab, text]) => (
        <button key={tab} role="tab" aria-selected={view === tab} onClick={() => onSelect(tab)}>
          <span className="tab-label" data-text={text}>
            {text}
          </span>
          {tab === "commits" && (
            <>
              {" "}
              <span className="counter">{commitCount.toLocaleString()}</span>
            </>
          )}
        </button>
      ))}
    </div>
  );
}

function SlidingIndicator({ selected }: { selected: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    const place = () => {
      const tab = box.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!tab) return;
      el.style.clipPath = `inset(0 ${box.clientWidth - tab.offsetLeft - tab.offsetWidth}px 0 ${tab.offsetLeft}px)`;
    };

    place();
    const frame = requestAnimationFrame(() => (el.dataset.ready = ""));
    const observer = new ResizeObserver(place);
    observer.observe(box);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [selected]);

  return <span ref={ref} className="segmented-indicator" aria-hidden="true" />;
}
