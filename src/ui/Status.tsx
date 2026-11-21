import { useEffect, useRef, useState } from "react";
import type { SessionStatus } from "../shared/types";
import { CopyButton } from "./controls";
import { useDismiss } from "./hooks";

export type Claude = "waiting" | "working" | "idle" | "gone";

export const ASK = "address my review comments";

const TICK_MS = 15_000;

const LABELS: Record<Claude, string> = {
  waiting: "Claude is waiting",
  working: "Claude is working",
  idle: "Claude isn't waiting",
  gone: "Disconnected",
};

export function claudeState(status: SessionStatus | null, connected: boolean): Claude {
  if (!connected) return "gone";
  if (status?.listening) return "waiting";
  return status?.workingSince ? "working" : "idle";
}

function useMinutes(since: string | null): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!since) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [since]);
  return since ? Math.max(0, Math.floor((now - Date.parse(since)) / 60_000)) : 0;
}

export function AskInTerminal() {
  return (
    <p className="review-ask">
      <code>{ASK}</code>
      <CopyButton text={ASK} label="Copy" />
    </p>
  );
}

function Explain({ state, minutes }: { state: Claude; minutes: number }) {
  if (state === "waiting") {
    return <p>Claude is waiting for your review and starts on it as soon as you submit. Send now on a comment sends just that one.</p>;
  }
  if (state === "working") {
    return (
      <p>
        Claude {minutes > 0 ? `has been working for ${minutes} min` : "is working"} on what you sent. Its replies show on the threads,
        and Load new changes shows its edits. What you submit meanwhile is picked up when it is done.
      </p>
    );
  }
  if (state === "idle") {
    return (
      <>
        <p>
          Claude isn't waiting for a review. What you send is saved and marked Not read yet until Claude reads it. To start, tell
          Claude in the terminal:
        </p>
        <AskInTerminal />
      </>
    );
  }
  return (
    <p>
      The page lost its connection to the viewer, which stops when the Claude Code session ends. Nothing you write can be saved
      until it is back. If the session ended, ask Claude to open the viewer again.
    </p>
  );
}

export function ClaudeStatus({ state, since }: { state: Claude; since: string | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  const minutes = useMinutes(state === "working" ? since : null);
  const label = state === "working" && minutes > 0 ? `${LABELS.working} · ${minutes} min` : LABELS[state];

  return (
    <div className="review-menu status-menu" ref={ref}>
      <button className={`button status-button is-${state}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="status-dot" aria-hidden="true" />
        {label}
      </button>
      {open && (
        <div className="review-popover status-popover" role="dialog" aria-label={label}>
          <div className="review-sent">
            <Explain state={state} minutes={minutes} />
          </div>
        </div>
      )}
    </div>
  );
}
