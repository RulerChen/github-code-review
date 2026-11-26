import type { SessionStatus } from "../shared/types";

export type Claude = "waiting" | "working" | "idle" | "gone";

const LABELS: Record<Claude, string> = {
  waiting: "Waiting",
  working: "Running",
  idle: "Idle",
  gone: "Offline",
};

export function claudeState(status: SessionStatus | null, connected: boolean): Claude {
  if (!connected) return "gone";
  if (status?.listening) return "waiting";
  return status?.workingSince ? "working" : "idle";
}

export function ClaudeStatus({ state }: { state: Claude }) {
  const label = LABELS[state];
  return (
    <span className={`status-light is-${state}`} role="img" aria-label={label} title={label}>
      <span className="status-dot" />
    </span>
  );
}
