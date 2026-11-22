import { useState } from "react";
import type { FlowStep } from "../shared/types";
import { Markdown } from "./Markdown";
import { basename, dirPrefix } from "./paths";

export interface FlowItem {
  step: FlowStep;
  changed: boolean;
}

const num = (i: number) => String(i + 1).padStart(2, "0");

function scopeName(inside: string | null | undefined): string | null {
  return inside ? inside.split(" › ").slice(-2).join(".") : null;
}

function titleOf(step: FlowStep): string {
  return step.action || scopeName(step.inside) || basename(step.path);
}

function incoming(flow: FlowItem[]): FlowItem[] {
  if (!flow[0]?.step.via) return flow;
  return flow.map((item, i) => ({ ...item, step: { ...item.step, via: i === 0 ? null : flow[i - 1]!.step.via } }));
}

function Via({ step }: { step: FlowStep }) {
  const kind = step.via?.kind ?? "call";
  const label = step.via?.label || (kind === "return" ? "return" : "");
  return (
    <div className={`flow-via is-${kind}`}>
      {step.when && <span className="flow-via-when">[{step.when}]</span>}
      {label && <span className="flow-via-label">{label}</span>}
    </div>
  );
}

export function Flow({ flow: items, anchor, onOpen }: { flow: FlowItem[]; anchor: string; onOpen: (step: FlowStep) => void }) {
  const [current, setCurrent] = useState<number | null>(null);
  const flow = incoming(items);
  const parent = flow.map(({ step }, i) => (step.from ? step.from - 1 : i - 1));
  const segments: number[][] = [];
  flow.forEach(({ step }, i) => {
    if (i === 0 || step.from) segments.push([i]);
    else segments.at(-1)!.push(i);
  });
  const forksOf = (i: number) => segments.slice(1).map((seg) => seg[0]!).filter((j) => parent[j] === i);
  const idOf = (i: number) => `${anchor}-flow-${i}`;

  const open = (i: number, scroll: boolean) => {
    setCurrent(i);
    onOpen(flow[i]!.step);
    if (scroll) document.getElementById(idOf(i))?.scrollIntoView({ block: "center" });
  };

  return (
    <div className="flow">
      {segments.map((seg, k) => {
        const first = seg[0]!;
        const from = parent[first]!;
        return (
          <section key={first} className={k === 0 ? "flow-path" : "flow-path is-branch"}>
            {k > 0 && from >= 0 && (
              <button type="button" className="flow-branch-head" onClick={() => open(from, true)}>
                Branch from {num(from)} · {titleOf(flow[from]!.step)}
              </button>
            )}
            <ol>
              {seg.map((i) => {
                const { step, changed } = flow[i]!;
                const scope = scopeName(step.inside);
                const forks = forksOf(i);
                return (
                  <li key={i} id={idOf(i)} className={`flow-step${current === i ? " is-current" : ""}`}>
                    {i > 0 && <Via step={step} />}
                    <div className="flow-card">
                      <button type="button" className="flow-head" title="Open this line on the right" onClick={() => open(i, false)}>
                        <span className="flow-num">{num(i)}</span>
                        <span className="flow-action">{titleOf(step)}</span>
                        {changed && <span className="flow-changed">changed</span>}
                        <span className="flow-where">
                          <span className="flow-dir">{dirPrefix(step.path)}</span>
                          {basename(step.path)}:{step.line}
                          {scope && <span className="flow-scope"> · {scope}</span>}
                        </span>
                      </button>
                      <Markdown className="flow-text" text={step.text} />
                      {forks.length > 0 && (
                        <div className="flow-forks">
                          {forks.map((j) => (
                            <button key={j} type="button" className="flow-fork" onClick={() => open(j, true)}>
                              ↳ {num(j)} {flow[j]!.step.when ? `[${flow[j]!.step.when}] ` : ""}
                              {titleOf(flow[j]!.step)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
