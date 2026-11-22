import dagre from "@dagrejs/dagre";
import { BaseEdge, type Edge, EdgeLabelRenderer, type EdgeProps, Handle, type Node, type NodeProps, Position, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import type { FlowStep } from "../shared/types";
import { componentOf, type FlowItem, num, plain } from "./Flow";
import { basename } from "./paths";
import "./flow.css";

const NODE_H = 40;
const LABEL_W = 200;
const LINE = 15;

const viaOf = (step: FlowStep) => plain(step.via?.label) || step.via?.kind || "call";

let canvas: CanvasRenderingContext2D | undefined;

function measure(text: string, kind: "label" | "name"): number {
  canvas ??= document.createElement("canvas").getContext("2d")!;
  const css = getComputedStyle(document.documentElement);
  canvas.font = kind === "label" ? `11px ${css.getPropertyValue("--mono")}` : `600 13px ${css.getPropertyValue("--sans")}`;
  return canvas.measureText(text).width;
}

const WIDE = "\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\uff00-\uffef";
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

type ComponentData = {
  name: string;
  first: number;
  actions: string;
  branches: { step: number; lines: string[] }[];
  current: number | null;
  here: boolean;
  onPick: (i: number) => void;
};

type HandoffData = {
  d: string;
  head: string;
  kind: string;
  branch: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  when: string[];
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
      <div className={`flow-node${data.here ? " is-current" : ""}`}>
        <button type="button" className="flow-node-name" title={data.actions} onClick={() => data.onPick(data.first)}>
          {data.name}
        </button>
        {data.branches.map(({ step, lines }) => (
          <button key={step} type="button" className={`flow-node-branch${data.current === step ? " is-current" : ""}`} onClick={() => data.onPick(step)}>
            {lines.map((line, k) => (
              <span key={k} className="flow-label-line">
                <span className="flow-label-num">{k === 0 ? num(step) : ""}</span>
                {line}
              </span>
            ))}
          </button>
        ))}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} className="flow-handle" />
    </>
  );
}

function Handoff({ data }: EdgeProps<HandoffEdge>) {
  if (!data) return null;
  const tone = `is-${data.kind}${data.branch ? " is-branch" : ""}`;
  return (
    <>
      <BaseEdge path={data.d} className={`flow-edge-line ${tone}`} />
      <path className={`flow-edge-head ${tone}`} d={data.head} />
      <EdgeLabelRenderer>
        <div className={`flow-label ${tone} nodrag nopan`} style={{ transform: `translate(${data.x - data.w / 2}px, ${data.y - data.h / 2}px)`, width: data.w, height: data.h }}>
          {data.when.map((line, k) => (
            <span key={k} className="flow-label-when">
              {line}
            </span>
          ))}
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
  branches: { step: number; lines: string[] }[];
  w: number;
  h: number;
}

interface Link {
  key: string;
  from: string;
  to: string;
  branch: number;
  kind: string;
  steps: number[];
  lines: string[][];
  when: string[];
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
    const part = parts.get(key) ?? { key, name: componentOf(step), steps: [], branches: [], w: Math.max(96, measure(componentOf(step), "name") + 34), h: NODE_H };
    part.steps.push(i);
    parts.set(key, part);
  });

  const branch: number[] = [];
  flow.forEach(({ step }, i) => branch.push(step.from ? i : i > 0 ? branch[i - 1]! : -1));
  const indent = measure("00 ", "label");
  const condition = (b: number) => (b >= 0 && flow[b]!.step.when ? wrap(`↳ ${plain(flow[b]!.step.when)}`, LABEL_W) : []);
  const links: Link[] = [];
  flow.forEach(({ step }, i) => {
    const p = parent[i]!;
    if (p < 0 || keyOf(p) === keyOf(i)) return;
    const key = `${keyOf(p)}→${keyOf(i)}#${branch[i]}`;
    const lines = wrap(viaOf(step), LABEL_W - indent);
    const link = links.find((l) => l.key === key);
    if (link) {
      link.steps.push(i);
      link.lines.push(lines);
      return;
    }
    const first = branch[i]! >= 0 && !links.some((l) => l.branch === branch[i]);
    links.push({ key, from: keyOf(p), to: keyOf(i), branch: branch[i]!, kind: step.via?.kind ?? "call", steps: [i], lines: [lines], when: first ? condition(branch[i]!) : [] });
  });
  flow.forEach(({ step }, b) => {
    if (!step.from || links.some((l) => l.branch === b)) return;
    const part = parts.get(keyOf(b))!;
    const lines = wrap(step.when ? `↳ ${plain(step.when)}` : plain(step.action) || basename(step.path), LABEL_W - indent);
    part.branches.push({ step: b, lines });
    part.w = Math.max(part.w, Math.ceil(indent + Math.max(...lines.map((line) => measure(line, "label")))) + 26);
    part.h += lines.length * LINE + (part.branches.length === 1 ? 6 : 0);
  });
  const boxOf = (l: Link) => ({
    w: Math.ceil(Math.max(indent + Math.max(...l.lines.flat().map((line) => measure(line, "label"))), ...l.when.map((line) => measure(line, "label"))) + 12),
    h: (l.when.length + l.lines.flat().length) * LINE + 8,
  });

  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 80, edgesep: 14, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const part of parts.values()) g.setNode(part.key, { width: part.w, height: part.h });
  for (const l of links) {
    const { w, h } = boxOf(l);
    g.setEdge(l.from, l.to, { width: w, height: h, labelpos: "c" }, l.key);
  }
  dagre.layout(g);

  const at = (key: string) => g.node(key) as { x: number; y: number; width: number };
  const sides: End[] = [];
  const routes = links.map((l) => {
    const points: { x: number; y: number }[] = g.edge(l.from, l.to, l.key).points ?? [];
    const a = at(l.from);
    const b = at(l.to);
    const dir = Math.sign(b.x - a.x) || 1;
    const src = { key: l.from, side: dir, toward: points[1]?.y ?? b.y, y: a.y };
    const dst = { key: l.to, side: -dir, toward: points.at(-2)?.y ?? a.y, y: b.y };
    sides.push(src, dst);
    return { l, points, a, b, dir, src, dst };
  });
  for (const part of parts.values()) {
    for (const side of [1, -1]) {
      const mine = sides.filter((t) => t.key === part.key && t.side === side).sort((p, q) => p.toward - q.toward);
      const gap = mine.length > 1 ? Math.min(12, (NODE_H - 12) / (mine.length - 1)) : 0;
      mine.forEach((t, i) => (t.y = at(part.key).y + (i - (mine.length - 1) / 2) * gap));
    }
  }

  const nodes: ComponentNode[] = [...parts.values()].map((part) => {
    const p = at(part.key);
    return {
      id: part.key,
      type: "component",
      position: { x: p.x - part.w / 2, y: p.y - part.h / 2 },
      width: part.w,
      height: part.h,
      data: {
        name: part.name,
        first: part.steps[0]!,
        actions: part.steps.map((i) => `${num(i)} ${flow[i]!.step.action ?? ""}`).join("\n"),
        branches: part.branches,
        current,
        here: current !== null && keyOf(current) === part.key,
        onPick,
      },
    };
  });

  const edges: HandoffEdge[] = routes.map(({ l, points, a, b, dir, src, dst }) => {
    const x0 = a.x + (dir * a.width) / 2;
    const x1 = b.x - (dir * b.width) / 2;
    const label = g.edge(l.from, l.to, l.key);
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
      id: l.key,
      source: l.from,
      target: l.to,
      type: "handoff",
      data: {
        d,
        head: headAt(x1, dst.y, dir),
        kind: l.kind,
        branch: l.branch >= 0,
        x: label.x ?? 0,
        y: label.y ?? 0,
        ...boxOf(l),
        when: l.when,
        labels: l.steps.map((i, n) => ({ step: i, lines: l.lines[n]!, title: `${flow[i]!.step.action ?? ""}\n${flow[i]!.step.path}:${flow[i]!.step.line}` })),
        current,
        onPick,
      },
    };
  });

  const { width = 0, height = 0 } = g.graph();
  return { nodes, edges, width: Math.ceil(width), height: Math.ceil(height) };
}

export default function FlowGraph({ flow, parent, current, onPick }: { flow: FlowItem[]; parent: number[]; current: number | null; onPick: (i: number) => void }) {
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
