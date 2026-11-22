import { lazy, type ReactNode, Suspense, useState } from "react";
import type { FlowStep } from "../shared/types";
import { basename, dirPrefix } from "./paths";

const FlowGraph = lazy(() => import("./FlowGraph"));

export interface FlowItem {
  step: FlowStep;
  changed: boolean;
}

export const num = (i: number) => String(i + 1).padStart(2, "0");

export const plain = (text: string | undefined) => (text ?? "").replace(/`/g, "");

export const componentOf = (step: FlowStep) => step.component?.trim() || step.path.split("/")[0]!;

function scopeName(inside: string | null | undefined): string | null {
  return inside ? inside.split(" › ").slice(-2).join(".") : null;
}

function incoming(flow: FlowItem[]): FlowItem[] {
  if (!flow[0]?.step.via) return flow;
  return flow.map((item, i) => ({ ...item, step: { ...item.step, via: i === 0 ? null : flow[i - 1]!.step.via } }));
}

export function Flow({ flow: items, open, onOpen }: { flow: FlowItem[]; open: boolean; onOpen: (step: FlowStep) => void }) {
  const [current, setCurrent] = useState<number | null>(null);
  const flow = incoming(items);
  const parent = flow.map(({ step }, i) => (step.from ? step.from - 1 : i - 1));
  const pick = (i: number) => {
    setCurrent(i);
    onOpen(flow[i]!.step);
  };

  const row = (i: number) => {
    const { step, changed } = flow[i]!;
    const scope = scopeName(step.inside);
    const io = step.input || step.output;
    return (
      <li key={i} className={`flow-step${current === i ? " is-current" : ""}`}>
        <button type="button" className="flow-head" title={plain(step.text)} onClick={() => pick(i)}>
          <span className="flow-num">{num(i)}</span>
          <span className="flow-line">
            <span className="flow-action">{step.action || scope || basename(step.path)}</span>
            {step.via?.label && <span className="flow-via">via {plain(step.via.label)}</span>}
            {changed && <span className="flow-changed">changed</span>}
          </span>
          <span className="flow-where">
            <span className="flow-component">{componentOf(step)}</span>
            {" · "}
            <span className="flow-dir">{dirPrefix(step.path)}</span>
            {basename(step.path)}:{step.line}
            {scope && <span className="flow-scope"> · {scope}</span>}
          </span>
          <span className="flow-io">
            {io ? (
              <>
                <span className="flow-io-label">in</span> {plain(step.input) || "-"} <span className="flow-io-label">out</span> {plain(step.output) || "-"}
              </>
            ) : (
              plain(step.text)
            )}
          </span>
        </button>
      </li>
    );
  };

  const run = (start: number): ReactNode[] => {
    const out: ReactNode[] = [];
    for (let i = start; i < flow.length && (i === start || !flow[i]!.step.from); i++) {
      out.push(row(i));
      flow.forEach(({ step }, j) => {
        if (step.from !== i + 1) return;
        out.push(
          <li key={`branch-${j}`} className="flow-branch">
            <div className="flow-branch-head">↳ {plain(step.when) || "branch"}</div>
            <ol className="flow-steps">{run(j)}</ol>
          </li>,
        );
      });
    }
    return out;
  };

  return (
    <div className="flow">
      {open && (
        <Suspense fallback={null}>
          <FlowGraph flow={flow} parent={parent} current={current} onPick={pick} />
        </Suspense>
      )}
      <ol className="flow-steps">{run(0)}</ol>
    </div>
  );
}
