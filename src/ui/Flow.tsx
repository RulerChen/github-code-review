import { useState } from "react";
import type { FlowStep, FlowVia } from "../shared/types";
import { Markdown } from "./Markdown";
import { basename, dirPrefix } from "./paths";

export interface FlowItem {
  step: FlowStep;
  changed: boolean;
}

function scopeName(inside: string | null | undefined): string | null {
  return inside ? inside.split(" › ").slice(-2).join(".") : null;
}

function Via({ via }: { via: FlowVia | null | undefined }) {
  const kind = via?.kind ?? "call";
  const label = via?.label || (kind === "return" ? "return" : "");
  return (
    <div className={`flow-via is-${kind}`}>
      {label && <span className="flow-via-label">{label}</span>}
    </div>
  );
}

export function Flow({ flow, onOpen }: { flow: FlowItem[]; onOpen: (step: FlowStep) => void }) {
  const [current, setCurrent] = useState<number | null>(null);
  return (
    <ol className="flow">
      {flow.map(({ step, changed }, i) => {
        const scope = scopeName(step.inside);
        return (
          <li key={i} className={`flow-step${current === i ? " is-current" : ""}`}>
            <div className="flow-card">
              <button
                type="button"
                className="flow-head"
                title="Open this line on the right"
                onClick={() => {
                  setCurrent(i);
                  onOpen(step);
                }}
              >
                <span className="flow-num">{String(i + 1).padStart(2, "0")}</span>
                <span className="flow-action">{step.action || scope || basename(step.path)}</span>
                {changed && <span className="flow-changed">changed</span>}
                <span className="flow-where">
                  <span className="flow-dir">{dirPrefix(step.path)}</span>
                  {basename(step.path)}:{step.line}
                  {scope && <span className="flow-scope"> · {scope}</span>}
                </span>
              </button>
              <Markdown className="flow-text" text={step.text} />
            </div>
            {i < flow.length - 1 && <Via via={step.via} />}
          </li>
        );
      })}
    </ol>
  );
}
