import { type KeyboardEvent, useState } from "react";
import type { FlowStep } from "../shared/types";
import { basename, dirPrefix } from "./paths";

export interface FlowItem {
  step: FlowStep;
  changed: boolean;
  repo: string;
}

const NODE_W = 184;
const NODE_H = 64;
const ROW = 128;
const PAD = 28;
const BEND = 8;
const PAIR = 9;
const LINE = 14;
const CHAR = 6.9;
const WRAP = 23;

const num = (i: number) => String(i + 1).padStart(2, "0");

function scopeName(inside: string | null | undefined): string | null {
  return inside ? inside.split(" › ").slice(-2).join(".") : null;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function incoming(flow: FlowItem[]): FlowItem[] {
  if (!flow[0]?.step.via) return flow;
  return flow.map((item, i) => ({ ...item, step: { ...item.step, via: i === 0 ? null : flow[i - 1]!.step.via } }));
}

const plain = (text: string | undefined) => (text ?? "").replace(/`/g, "");

const componentOf = (step: FlowStep) => step.component?.trim() || step.path.split("/")[0]!;

function labelOf(step: FlowStep): string {
  const via = step.via?.label || step.via?.kind || "call";
  return `${step.when ? `[${step.when}] ` : ""}${via}`;
}

function wrap(text: string): string[] {
  const lines: string[] = [];
  let line = "";
  for (const part of text.match(/[^ /?&]*[ /?&]*/g) ?? []) {
    if (line && (line + part).trimEnd().length > WRAP) {
      lines.push(line.trimEnd());
      line = "";
    }
    line += part;
    while (line.trimEnd().length > WRAP) {
      lines.push(line.slice(0, WRAP));
      line = line.slice(WRAP);
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}

interface GraphNode {
  key: string;
  name: string;
  repo: string;
  steps: number[];
  changed: boolean;
  layer: number;
  row: number;
  x: number;
  y: number;
}

interface GraphEdge {
  from: GraphNode;
  to: GraphNode;
  steps: number[];
  lines: string[][];
  lane: number;
}

function layout(flow: FlowItem[], parent: number[]) {
  const nodes = new Map<string, GraphNode>();
  const keyOf = (i: number) => componentOf(flow[i]!.step).toLowerCase();
  flow.forEach(({ step, changed, repo }, i) => {
    const key = keyOf(i);
    const node = nodes.get(key) ?? { key, name: componentOf(step), repo, steps: [], changed: false, layer: -1, row: 0, x: 0, y: 0 };
    node.steps.push(i);
    node.changed ||= changed;
    nodes.set(key, node);
  });

  const edges: GraphEdge[] = [];
  flow.forEach((_, i) => {
    const p = parent[i]!;
    if (p < 0 || keyOf(p) === keyOf(i)) return;
    const from = nodes.get(keyOf(p))!;
    const to = nodes.get(keyOf(i))!;
    const edge = edges.find((e) => e.from === from && e.to === to);
    if (edge) edge.steps.push(i);
    else edges.push({ from, to, steps: [i], lines: [], lane: 0 });
  });
  for (const e of edges) e.lines = e.steps.map((i) => wrap(labelOf(flow[i]!.step)));

  const list = [...nodes.values()];
  list[0]!.layer = 0;
  for (const e of edges) {
    if (e.from.layer < 0) e.from.layer = 0;
    if (e.to.layer < 0) e.to.layer = e.from.layer + 1;
  }
  for (const n of list) if (n.layer < 0) n.layer = Math.max(...list.map((m) => m.layer)) + 1;

  const layers: GraphNode[][] = [];
  for (const n of list) {
    (layers[n.layer] ??= []).push(n);
    n.row = layers[n.layer]!.length - 1;
  }
  const rows = Math.max(...layers.map((l) => l?.length ?? 0));

  const widthOf = (e: GraphEdge) => (3 + Math.max(...e.lines.flat().map((l) => l.length))) * CHAR;
  const gaps = layers.map((_, k) => {
    const between = edges.filter((e) => Math.min(e.from.layer, e.to.layer) === k && Math.max(e.from.layer, e.to.layer) === k + 1);
    return Math.max(96, ...between.map((e) => widthOf(e) + 32));
  });

  const rise = (e: GraphEdge) => (e.lines.flat().length - 1) * LINE + 17;
  const span = (e: GraphEdge) => e.to.layer - e.from.layer;
  const lanes = (far: GraphEdge[]) => {
    let off = 0;
    for (const e of far) {
      e.lane = off + 18;
      off = e.lane + rise(e) + 4;
    }
    return off;
  };
  const edge = NODE_H / 2 - PAIR;
  const top = PAD + Math.max(0, lanes(edges.filter((e) => span(e) > 1)), ...edges.filter((e) => span(e) === 1).map((e) => rise(e) - edge));
  const bottom = PAD + Math.max(0, lanes(edges.filter((e) => span(e) < -1)), ...edges.filter((e) => span(e) === -1).map((e) => rise(e) - edge));
  const inner = (rows - 1) * ROW + NODE_H;
  for (const e of edges) if (Math.abs(span(e)) > 1) e.lane = span(e) > 0 ? top - e.lane : top + inner + e.lane;

  let x = PAD;
  layers.forEach((layer, k) => {
    for (const n of layer ?? []) {
      n.x = x;
      n.y = top + ((rows - layer.length) / 2 + n.row) * ROW;
    }
    x += NODE_W + gaps[k]!;
  });
  const width = x - gaps.at(-1)! + PAD;
  return { nodes: list, edges, width, height: top + inner + bottom };
}

interface Route {
  d: string;
  head: string;
  labelX: number;
  labelY: number;
  anchor: "start" | "end";
  place: "above" | "below" | "beside";
}

function headAt(x: number, y: number, dir: "left" | "right" | "up" | "down"): string {
  if (dir === "right") return `M${x - 7} ${y - 4}L${x} ${y}L${x - 7} ${y + 4}Z`;
  if (dir === "left") return `M${x + 7} ${y - 4}L${x} ${y}L${x + 7} ${y + 4}Z`;
  if (dir === "down") return `M${x - 4} ${y - 7}L${x} ${y}L${x + 4} ${y - 7}Z`;
  return `M${x - 4} ${y + 7}L${x} ${y}L${x + 4} ${y + 7}Z`;
}

function route(e: GraphEdge, paired: boolean): Route {
  const { from: a, to: b } = e;
  const cy = (n: GraphNode) => n.y + NODE_H / 2;
  const cx = (n: GraphNode) => n.x + NODE_W / 2;
  const right = b.layer > a.layer;
  const off = paired ? (right ? -PAIR : PAIR) : 0;

  if (b.layer === a.layer) {
    const down = b.y > a.y;
    const x0 = cx(a) + (paired ? off : 0);
    const y0 = down ? a.y + NODE_H : a.y;
    const y1 = down ? b.y : b.y + NODE_H;
    return { d: `M${x0} ${y0}V${y1}`, head: headAt(x0, y1, down ? "down" : "up"), labelX: x0 + 8, labelY: (y0 + y1) / 2, anchor: "start", place: "beside" };
  }

  const near = Math.abs(b.layer - a.layer) === 1;
  if (near) {
    const sx = right ? a.x + NODE_W : a.x;
    const sy = cy(a) + off;
    const labelX = sx + (right ? 10 : -10);
    const anchor = right ? "start" : "end";
    const place = right ? "above" : "below";
    if (Math.abs(cy(b) - cy(a)) < 1) {
      const ex = right ? b.x : b.x + NODE_W;
      return { d: `M${sx} ${sy}H${ex}`, head: headAt(ex, sy, right ? "right" : "left"), labelX, labelY: sy, anchor, place };
    }
    const tx = cx(b);
    const up = cy(b) < cy(a);
    const ey = up ? b.y + NODE_H : b.y;
    const turn = right ? -BEND : BEND;
    const d = `M${sx} ${sy}H${tx + turn}Q${tx} ${sy} ${tx} ${sy + (up ? -BEND : BEND)}V${ey}`;
    return { d, head: headAt(tx, ey, up ? "up" : "down"), labelX, labelY: sy, anchor, place };
  }

  const above = right;
  const y = e.lane;
  const x0 = cx(a) + off;
  const x1 = cx(b) + off;
  const y0 = above ? a.y : a.y + NODE_H;
  const y1 = above ? b.y : b.y + NODE_H;
  return {
    d: `M${x0} ${y0}V${y}H${x1}V${y1}`,
    head: headAt(x1, y1, above ? "down" : "up"),
    labelX: x0 + (right ? 8 : -8),
    labelY: y,
    anchor: right ? "start" : "end",
    place: above ? "above" : "below",
  };
}

function press(run: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    run();
  };
}

function Graph({ flow, parent, current, onPick }: { flow: FlowItem[]; parent: number[]; current: number | null; onPick: (i: number) => void }) {
  const { nodes, edges, width, height } = layout(flow, parent);
  const pairs = new Set(edges.map((e) => `${e.from.key}\u0000${e.to.key}`));
  const currentNode = current === null ? null : componentOf(flow[current]!.step).toLowerCase();

  return (
    <div className="flow-graph">
      <svg viewBox={`0 0 ${width} ${height}`} style={{ maxWidth: width, minWidth: Math.min(width, width * 0.75) }} role="group" aria-label="Flow graph">
        {edges.map((e) => {
          const paired = pairs.has(`${e.to.key}\u0000${e.from.key}`);
          const r = route(e, paired);
          const kind = flow[e.steps[0]!]!.step.via?.kind ?? "call";
          const total = e.lines.flat().length;
          const yAt = (g: number) =>
            r.place === "below" ? r.labelY + 14 + g * LINE : r.place === "above" ? r.labelY - 6 - (total - 1 - g) * LINE : r.labelY + 4 + (g - (total - 1) / 2) * LINE;
          let g = 0;
          return (
            <g key={`${e.from.key}-${e.to.key}`} className={`flow-edge is-${kind}`}>
              <path className="flow-edge-line" d={r.d} />
              <path className="flow-edge-head" d={r.head} />
              {e.steps.map((i, n) => {
                const step = flow[i]!.step;
                return (
                  <text
                    key={i}
                    className={`flow-edge-label${current === i ? " is-current" : ""}`}
                    textAnchor={r.anchor}
                    role="button"
                    tabIndex={0}
                    onClick={() => onPick(i)}
                    onKeyDown={press(() => onPick(i))}
                  >
                    <title>{`${step.action ?? ""}\n${step.path}:${step.line}`}</title>
                    {e.lines[n]!.map((line, k) => (
                      <tspan key={k} x={r.labelX + (k && r.anchor === "start" ? 3 * CHAR : 0)} y={yAt(g++)}>
                        {k === 0 && <tspan className="flow-edge-num">{num(i)} </tspan>}
                        {line}
                      </tspan>
                    ))}
                  </text>
                );
              })}
            </g>
          );
        })}
        {nodes.map((n) => {
          const files = [...new Set(n.steps.map((i) => basename(flow[i]!.step.path)))];
          const sub = clip(files.slice(0, 2).join(" · ") + (files.length > 2 ? ` +${files.length - 2}` : ""), 28);
          const first = n.steps[0]!;
          return (
            <g
              key={n.key}
              className={`flow-node${n.changed ? " is-changed" : ""}${currentNode === n.key ? " is-current" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={`${n.name}, step ${num(first)}`}
              onClick={() => onPick(first)}
              onKeyDown={press(() => onPick(first))}
            >
              <title>{n.steps.map((i) => `${num(i)} ${flow[i]!.step.action ?? ""}`).join("\n")}</title>
              <rect x={n.x} y={n.y} width={NODE_W} height={NODE_H} rx={8} />
              {n.repo && (
                <g>
                  <rect className="flow-node-tag" x={n.x + 10} y={n.y + 8} width={Math.min(80, n.repo.length * 6 + 12)} height={15} rx={3} />
                  <text className="flow-node-tagtext" x={n.x + 16} y={n.y + 19}>
                    {clip(n.repo, 11)}
                  </text>
                </g>
              )}
              {n.changed && (
                <text className="flow-node-changed" x={n.x + NODE_W - 10} y={n.y + 19} textAnchor="end">
                  changed
                </text>
              )}
              <text className="flow-node-name" x={n.x + NODE_W / 2} y={n.y + 40} textAnchor="middle">
                {clip(n.name, 22)}
              </text>
              <text className="flow-node-sub" x={n.x + NODE_W / 2} y={n.y + 55} textAnchor="middle">
                {sub}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function Flow({ flow: items, onOpen }: { flow: FlowItem[]; onOpen: (step: FlowStep) => void }) {
  const [current, setCurrent] = useState<number | null>(null);
  const flow = incoming(items);
  const parent = flow.map(({ step }, i) => (step.from ? step.from - 1 : i - 1));
  const open = (i: number) => {
    setCurrent(i);
    onOpen(flow[i]!.step);
  };

  return (
    <div className="flow">
      <Graph flow={flow} parent={parent} current={current} onPick={open} />
      <ol className="flow-steps">
        {flow.map(({ step, changed }, i) => {
          const scope = scopeName(step.inside);
          const io = step.input || step.output;
          return (
            <li key={i} className={`flow-step${current === i ? " is-current" : ""}`}>
              <button type="button" className="flow-head" title={plain(step.text)} onClick={() => open(i)}>
                <span className="flow-num">{num(i)}</span>
                <span className="flow-line">
                  <span className="flow-action">{step.action || scope || basename(step.path)}</span>
                  {step.from && <span className="flow-from">from {num(step.from - 1)}</span>}
                  {step.when && <span className="flow-when">[{step.when}]</span>}
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
        })}
      </ol>
    </div>
  );
}
