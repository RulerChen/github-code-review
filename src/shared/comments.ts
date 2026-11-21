import type { ThreadContext } from "./types.js";

const CONTEXT_LINES = 3;

export function contextOf(lines: string[], start: number, end: number): ThreadContext {
  return { before: lines.slice(Math.max(0, start - 1 - CONTEXT_LINES), start - 1), after: lines.slice(end, end + CONTEXT_LINES) };
}

interface Lines {
  start: number;
  end: number;
}

export const lineNumbers = ({ start, end }: Lines) => (start === end ? `${start}` : `${start}–${end}`);

export const lineRange = (lines: Lines) => `${lines.start === lines.end ? "line" : "lines"} ${lineNumbers(lines)}`;
