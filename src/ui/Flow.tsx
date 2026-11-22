import dagre from "@dagrejs/dagre";
import { BaseEdge, type Edge, EdgeLabelRenderer, type EdgeProps, Handle, type Node, type NodeProps, Position, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { useState } from "react";
import type { FlowStep } from "../shared/types";
import "./flow.css";
import { basename, dirPrefix } from "./paths";

export interface FlowItem {
  step: FlowStep;
  changed: boolean;
}

const NODE_H = 40;
const LABEL_W = 200;
const LINE = 15;

const num = (i: number) => String(i + 1).padStart(2, "0");

function scopeName(inside: string | null | undefined): string | null {
  return inside ? inside.split(" › ").slice(-2).join(".") : null;
}

function incoming(flow: FlowItem[]): FlowItem[] {
  if (!flow[0]?.step.via) return flow;
  return flow.map((item, i) => ({ ...item, step: { ...item.step, via: i === 0 ? null : flow[i - 1]!.step.via } }));
}

const plain = (text: string | undefined) => (text ?? "").replace(/`/g, "");

const componentOf = (step: FlowStep) => step.component?.trim() || step.path.split("/")[0]!;

const viaOf = (step: FlowStep) => plain(step.via?.label) || step.via?.kind || "call";

let canvas: CanvasRenderingContext2D | undefined;

function measure(text: string, kind: "label" | "name"): number {
  canvas ??= document.createElement("canvas").getContext("2d")!;
  const css = getComputedStyle(document.documentElement);
  canvas.font = kind === "label" ? `11px ${css.getPropertyValue("--mono")}` : `600 13px ${css.getPropertyValue("--sans")}`;
  return canvas.measureText(text).width;
}

const WIDE = "⺀-꓏가-힣豈-﫿＀-￯";
const PARTS = new RegExp(`[${WIDE}]|[^ /?&${WIDE}]+[ /?&]*|[ /?&]+`, "g");

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const part of text.match(PARTS) ?? []) {
    if (line && measure((line + part).trimEnd(), "label") > width) {
      lines.push(line.trimEnd());
      line = "";
    }
    line = line ? line + part : part.trimStart();
    while (measure(line.trimEnd(), "label") > width) {
      let cut = line.length - 1;
      while (cut > 1 && measure(line.slice(0, cut), "label") > width) cut--;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}

function headAt(x: number, y: number, dir: number): string {
  return `M${x - 7 * dir} ${y - 4}L${x} ${y}L${x - 7 * dir} ${y + 4}Z`;
}

function curve(x0: number, y0: number, x1: number, y1: number): string {
  const d = (x1 - x0) / 2;
  return `C${x0 + d} ${y0} ${x1 - d} ${y1} ${x1} ${y1}`;
}

type ComponentData = { name: string; first: number; actions: string; current: boolean; onPick: (i: number) => void };

type HandoffData = {
  d: string;
  head: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  labels: { step: number; lines: string[]; title: string }[];
  current: number | null;
  onPick: (i: number) => void;
};

type ComponentNode = Node<ComponentData, "component">;
type HandoffEdge = Edge<HandoffData, "handoff">;

function ComponentBox({ data }: NodeProps<ComponentNode>) {
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} className="flow-handle" />
      <button type="button" className={`flow-node${data.current ? " is-current" : ""}`} title={data.actions} onClick={() => data.onPick(data.first)}>
        {data.name}
      </button>
      <Handle type="source" position={Position.Right} isConnectable={false} className="flow-handle" />
    </>
  );
}

function Handoff({ data }: EdgeProps<HandoffEdge>) {
  if (!data) return null;
  return (
    <>
      <BaseEdge path={data.d} className={`flow-edge-line is-${data.kind}`} />
      <path className={`flow-edge-head is-${data.kind}`} d={data.head} />
      <EdgeLabelRenderer>
        <div
          className={`flow-label is-${data.kind} nodrag nopan`}
          style={{ transform: `translate(${data.x - data.w / 2}px, ${data.y - data.h / 2}px)`, width: data.w, height: data.h }}
        >
          {data.labels.map(({ step, lines, title }) => (
            <button key={step} type="button" className={`flow-label-step${data.current === step ? " is-current" : ""}`} title={title} onClick={() => data.onPick(step)}>
              {lines.map((line, k) => (
                <span key={k} className="flow-label-line">
                  <span className="flow-label-num">{k === 0 ? num(step) : ""}</span>
                  {line}
                </span>
              ))}
            </button>
          ))}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { component: ComponentBox };
const edgeTypes = { handoff: Handoff };

interface Part {
  key: string;
  name: string;
  steps: number[];
  w: number;
}

interface Link {
  from: Part;
  to: Part;
  steps: number[];
  lines: string[][];
}

interface End {
  key: string;
  side: number;
  toward: number;
  y: number;
}

function layout(flow: FlowItem[], parent: number[], current: number | null, onPick: (i: number) => void) {
  const parts = new Map<string, Part>();
  const keyOf = (i: number) => componentOf(flow[i]!.step).toLowerCase();
  flow.forEach(({ step }, i) => {
    const key = keyOf(i);
    const part = parts.get(key) ?? { key, name: componentOf(step), steps: [], w: Math.max(96, measure(componentOf(step), "name") + 34) };
    part.steps.push(i);
    parts.set(key, part);
  });

  const indent = measure("00 ", "label");
  const links: Link[] = [];
  flow.forEach(({ step }, i) => {
    const p = parent[i]!;
    if (p < 0 || keyOf(p) === keyOf(i)) return;
    const from = parts.get(keyOf(p))!;
    const to = parts.get(keyOf(i))!;
    const lines = wrap(viaOf(step), LABEL_W - indent);
    const link = links.find((l) => l.from === from && l.to === to);
    if (link) {
      link.steps.push(i);
      link.lines.push(lines);
    } else links.push({ from, to, steps: [i], lines: [lines] });
  });
  const boxOf = (l: Link) => ({
    w: Math.ceil(indent + Math.max(...l.lines.flat().map((line) => measure(line, "label"))) + 12),
    h: l.lines.flat().length * LINE + 8,
  });

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 80, edgesep: 14, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const part of parts.values()) g.setNode(part.key, { width: part.w, height: NODE_H });
  for (const l of links) {
    const { w, h } = boxOf(l);
    g.setEdge(l.from.key, l.to.key, { width: w, height: h, labelpos: "c" });
  }
  dagre.layout(g);

  const at = (key: string) => g.node(key) as { x: number; y: number; width: number };
  const ends: End[] = [];
  const routes = links.map((l) => {
    const points: { x: number; y: number }[] = g.edge(l.from.key, l.to.key).points ?? [];
    const a = at(l.from.key);
    const b = at(l.to.key);
    const dir = Math.sign(b.x - a.x) || 1;
    const src = { key: l.from.key, side: dir, toward: points[1]?.y ?? b.y, y: a.y };
    const dst = { key: l.to.key, side: -dir, toward: points.at(-2)?.y ?? a.y, y: b.y };
    ends.push(src, dst);
    return { l, points, a, b, dir, src, dst };
  });
  for (const part of parts.values()) {
    for (const side of [1, -1]) {
      const mine = ends.filter((t) => t.key === part.key && t.side === side).sort((p, q) => p.toward - q.toward);
      const gap = mine.length > 1 ? Math.min(12, (NODE_H - 12) / (mine.length - 1)) : 0;
      mine.forEach((t, i) => (t.y = at(part.key).y + (i - (mine.length - 1) / 2) * gap));
    }
  }

  const nodes: ComponentNode[] = [...parts.values()].map((part) => {
    const p = at(part.key);
    return {
      id: part.key,
      type: "component",
      position: { x: p.x - part.w / 2, y: p.y - NODE_H / 2 },
      width: part.w,
      height: NODE_H,
      data: {
        name: part.name,
        first: part.steps[0]!,
        actions: part.steps.map((i) => `${num(i)} ${flow[i]!.step.action ?? ""}`).join("\n"),
        current: current !== null && keyOf(current) === part.key,
        onPick,
      },
    };
  });

  const edges: HandoffEdge[] = routes.map(({ l, points, a, b, dir, src, dst }) => {
    const x0 = a.x + (dir * a.width) / 2;
    const x1 = b.x - (dir * b.width) / 2;
    const label = g.edge(l.from.key, l.to.key);
    const half = (dir * boxOf(l).w) / 2;
    const inner = points.slice(1, -1).flatMap((p) => (p.x === label.x && p.y === label.y ? [{ x: p.x - half, y: p.y }, { x: p.x + half, y: p.y }] : [p]));
    let d = `M${x0} ${src.y}`;
    let px = x0;
    let py = src.y;
    for (const p of [...inner, { x: x1, y: dst.y }]) {
      d += curve(px, py, p.x, p.y);
      px = p.x;
      py = p.y;
    }
    return {
      id: `${l.from.key}→${l.to.key}`,
      source: l.from.key,
      target: l.to.key,
      type: "handoff",
      data: {
        d,
        head: headAt(x1, dst.y, dir),
        kind: flow[l.steps[0]!]!.step.via?.kind ?? "call",
        x: label.x ?? 0,
        y: label.y ?? 0,
        ...boxOf(l),
        labels: l.steps.map((i, n) => ({ step: i, lines: l.lines[n]!, title: `${flow[i]!.step.action ?? ""}\n${flow[i]!.step.path}:${flow[i]!.step.line}` })),
        current,
        onPick,
      },
    };
  });

  const { width = 0, height = 0 } = g.graph();
  return { nodes, edges, width: Math.ceil(width), height: Math.ceil(height) };
}

function Graph({ flow, parent, current, onPick }: { flow: FlowItem[]; parent: number[]; current: number | null; onPick: (i: number) => void }) {
  const { nodes, edges, width, height } = layout(flow, parent, current, onPick);
  return (
    <div className="flow-graph">
      <div className="flow-canvas" style={{ width, height }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          minZoom={1}
          maxZoom={1}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          panOnDrag={false}
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          proOptions={{ hideAttribution: true }}
        />
      </div>
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
        })}
      </ol>
    </div>
  );
}
