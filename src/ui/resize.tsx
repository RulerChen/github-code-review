import type { PointerEvent } from "react";
import { readStorage, writeStorage } from "./storage";

const MAIN_MIN = 360;

interface Edge {
  cssVar: string;
  key: string;
  from: "left" | "right";
  min: number;
}

export const EDGES = {
  sidebar: { cssVar: "--sidebar-w", key: "diff-review:sidebar-w", from: "left", min: 180 },
  code: { cssVar: "--code-panel-w", key: "diff-review:code-panel-w", from: "right", min: 320 },
  conversations: { cssVar: "--conversations-w", key: "diff-review:conversations-w", from: "right", min: 280 },
} satisfies Record<string, Edge>;

const root = document.documentElement;
for (const edge of Object.values(EDGES)) {
  const width = readStorage<number | null>(edge.key, null);
  if (typeof width === "number") root.style.setProperty(edge.cssVar, `${width}px`);
}

export function ResizeHandle({ edge, label }: { edge: Edge; label: string }) {
  const start = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const main = document.querySelector(".files")?.getBoundingClientRect();
    const max = !main ? Infinity : edge.from === "left" ? main.right - MAIN_MIN : root.clientWidth - main.left - MAIN_MIN;
    let width: number | null = null;
    let frame = 0;
    const move = (ev: globalThis.PointerEvent) => {
      const at = edge.from === "left" ? ev.clientX : root.clientWidth - ev.clientX;
      width = Math.round(Math.max(edge.min, Math.min(at, max)));
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => root.style.setProperty(edge.cssVar, `${width}px`));
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      document.body.classList.remove("is-resizing");
      if (width !== null) writeStorage(edge.key, width);
    };
    handle.setPointerCapture(e.pointerId);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    document.body.classList.add("is-resizing");
  };

  const reset = () => {
    root.style.removeProperty(edge.cssVar);
    writeStorage(edge.key, null);
  };

  return (
    <div
      className={`resize-handle ${edge.from}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title="Drag to resize. Double-click to reset."
      onPointerDown={start}
      onDoubleClick={reset}
    />
  );
}
