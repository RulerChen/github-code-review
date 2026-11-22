import dagre from "@dagrejs/dagre";
import { BaseEdge, type Edge, EdgeLabelRenderer, type EdgeProps, Handle, type Node, type NodeProps, Position, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { useLayoutEffect, useRef, useState } from "react";
import type { FlowStep } from "../shared/types";
import { componentOf, type FlowItem, num, plain } from "./Flow";
import { basename } from "./paths";
import "./flow.css";

const HEAD = 34;
const ROW_LINE = 16;
const ROW_W = 180;
const LABEL_W = 176;
const LINE = 15;
const MIN_ZOOM = 0.8;

type Font = "label" | "name" | "row";

const viaOf = (step: FlowStep) => plain(step.via?.label) || step.via?.kind || "call";

let canvas: CanvasRenderingContext2D | undefined;

function measure(text: string, font: Font): number {
  canvas ??= document.createElement("canvas").getContext("2d")!;
  const css = getComputedStyle(document.documentElement);
  const family = css.getPropertyValue(font === "label" ? "--mono" : "--sans");
  canvas.font = font === "label" ? `11px ${family}` : font === "name" ? `600 13px ${family}` : `12px ${family}`;
  return canvas.measureText(text).width;
}

const WIDE = "⺀-꓏가-힣豈-﫿＀-￯";
const PARTS = new RegExp(`[${WIDE}]|[^ /?&${WIDE}]+[ /?&]*|[ /?&]+`, "g");

function wrap(text: string, width: number, font: Font): string[] {
  const lines: string[] = [];
  let line = "";
  for (const part of text.match(PARTS) ?? []) {
    if (line && measure((line + part).trimEnd(), font) > width) {
      lines.push(line.trimEnd());
      line = "";
    }
    line = line ? line + part : part.trimStart();
    while (measure(line.trimEnd(), font) > width) {
      let cut = line.length - 1;
      while (cut > 1 && measure(line.slice(0, cut), font) > width) cut--;
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

interface Row {
  step: number | null;
  lines: string[];
  branch: boolean;
}

type ComponentData = {
  name: string;
  first: number;
  rows: Row[];
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
  step: number;
  lines: string[];
  title: string;
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
        <button type="button" className="flow-node-name" onClick={() => data.onPick(data.first)}>
          {data.name}
        </button>
        {data.rows.map((row, n) =>
          row.step === null ? (
            <span key={`when-${n}`} className="flow-node-when">
              {row.lines.join("\n")}
            </span>
          ) : (
            <button
              key={row.step}
              type="button"
              className={`flow-node-row${row.branch ? " is-branch" : ""}${data.current === row.step ? " is-current" : ""}`}
              onClick={() => data.onPick(row.step!)}
            >
              <span className="flow-node-num">{num(row.step)}</span>
              <span className="flow-node-action">{row.lines.join("\n")}</span>
            </button>
          ),
        )}
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
          <button type="button" className={`flow-label-step${data.current === data.step ? " is-current" : ""}`} title={data.title} onClick={() => data.onPick(data.step)}>
            {data.lines.map((line, k) => (
              <span key={k} className="flow-label-line">
                <span className="flow-label-num">{k === 0 ? num(data.step) : ""}</span>
                {line}
              </span>
            ))}
          </button>
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
  rows: Row[];
  at: Map<number, number>;
  w: number;
  h: number;
}

interface Port {
  key: string;
  side: number;
  row: number;
  y: number;
}

function layout(flow: FlowItem[], parent: number[], current: number | null, onPick: (i: number) => void) {
  const keyOf = (i: number) => componentOf(flow[i]!.step).toLowerCase();
  const branch: number[] = [];
  flow.forEach(({ step }, i) => branch.push(step.from ? i : i > 0 ? branch[i - 1]! : -1));
  const order: number[] = [];
  const walk = (start: number) => {
    for (let i = start; i < flow.length && (i === start || !flow[i]!.step.from); i++) {
      order.push(i);
      flow.forEach(({ step }, j) => step.from === i + 1 && walk(j));
    }
  };
  walk(0);

  const indent = measure("00 ", "label");
  const handoff = (i: number) => parent[i]! >= 0 && keyOf(parent[i]!) !== keyOf(i);
  const conditionOf = (step: FlowStep) => (step.from ? `↳ ${plain(step.when)}` : `[${plain(step.when)}]`);
  const parts = new Map<string, Part>();
  for (const i of order) {
    const { step } = flow[i]!;
    const key = keyOf(i);
    const part: Part = parts.get(key) ?? { key, name: componentOf(step), steps: [], rows: [], at: new Map(), w: measure(componentOf(step), "name") + 34, h: HEAD };
    parts.set(key, part);
    part.steps.push(i);
    if (step.when && !handoff(i)) {
      const lines = wrap(conditionOf(step), ROW_W + indent, "label");
      part.rows.push({ step: null, lines, branch: true });
      part.w = Math.max(part.w, Math.max(...lines.map((line) => measure(line, "label"))) + 22);
      part.h += lines.length * ROW_LINE + 4;
    }
    const lines = wrap(plain(step.action) || basename(step.path), ROW_W, "row");
    part.rows.push({ step: i, lines, branch: branch[i]! >= 0 });
    part.w = Math.max(part.w, indent + Math.max(...lines.map((line) => measure(line, "row"))) + 22);
    part.at.set(i, part.h + 2 + ROW_LINE / 2);
    part.h += lines.length * ROW_LINE + 4;
  }
  for (const part of parts.values()) {
    part.w = Math.ceil(Math.max(96, part.w));
    part.h += 7;
  }

  const links = flow.flatMap(({ step }, i) => {
    const p = parent[i]!;
    if (p < 0 || keyOf(p) === keyOf(i)) return [];
    const lines = wrap(viaOf(step), LABEL_W - indent, "label");
    const when = step.when ? wrap(conditionOf(step), LABEL_W, "label") : [];
    const w = Math.ceil(Math.max(indent + Math.max(...lines.map((line) => measure(line, "label"))), ...when.map((line) => measure(line, "label"))) + 12);
    return [{ step: i, from: keyOf(p), to: keyOf(i), source: p, lines, when, w, h: (when.length + lines.length) * LINE + 8 }];
  });

  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 72, edgesep: 14, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const part of parts.values()) g.setNode(part.key, { width: part.w, height: part.h });
  for (const l of links) g.setEdge(l.from, l.to, { width: l.w, height: l.h, labelpos: "c" }, String(l.step));
  dagre.layout(g);

  const box = (key: string) => g.node(key) as { x: number; y: number; width: number; height: number };
  const rowY = (key: string, step: number) => box(key).y - box(key).height / 2 + parts.get(key)!.at.get(step)!;
  const ports: Port[] = [];
  const routes = links.map((l) => {
    const a = box(l.from);
    const b = box(l.to);
    const dir = Math.sign(b.x - a.x) || 1;
    const src = { key: l.from, side: dir, row: l.source, y: rowY(l.from, l.source) };
    const dst = { key: l.to, side: -dir, row: l.step, y: rowY(l.to, l.step) };
    ports.push(src, dst);
    return { l, a, b, dir, src, dst };
  });
  for (const port of ports) {
    const same = ports.filter((p) => p.key === port.key && p.side === port.side && p.row === port.row);
    port.y += (same.indexOf(port) - (same.length - 1) / 2) * 5;
  }

  const nodes: ComponentNode[] = [...parts.values()].map((part) => {
    const p = box(part.key);
    return {
      id: part.key,
      type: "component",
      position: { x: p.x - part.w / 2, y: p.y - part.h / 2 },
      width: part.w,
      height: part.h,
      data: { name: part.name, first: part.steps[0]!, rows: part.rows, current, here: part.steps.includes(current ?? -1), onPick },
    };
  });

  const edges: HandoffEdge[] = routes.map(({ l, a, b, dir, src, dst }) => {
    const label = g.edge(l.from, l.to, String(l.step));
    const points: { x: number; y: number }[] = label.points ?? [];
    const x0 = a.x + (dir * a.width) / 2;
    const x1 = b.x - (dir * b.width) / 2;
    const half = (dir * l.w) / 2;
    const inner = points.slice(1, -1).flatMap((p) => (p.x === label.x && p.y === label.y ? [{ x: p.x - half, y: p.y }, { x: p.x + half, y: p.y }] : [p]));
    let d = `M${x0} ${src.y}`;
    let px = x0;
    let py = src.y;
    for (const p of [...inner, { x: x1, y: dst.y }]) {
      d += curve(px, py, p.x, p.y);
      px = p.x;
      py = p.y;
    }
    const { step } = flow[l.step]!;
    return {
      id: String(l.step),
      source: l.from,
      target: l.to,
      type: "handoff",
      data: {
        d,
        head: headAt(x1, dst.y, dir),
        kind: step.via?.kind ?? "call",
        branch: branch[l.step]! >= 0,
        x: label.x ?? 0,
        y: label.y ?? 0,
        w: l.w,
        h: l.h,
        when: l.when,
        step: l.step,
        lines: l.lines,
        title: `${step.action ?? ""}\n${step.path}:${step.line}`,
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
  const frame = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(Infinity);
  useLayoutEffect(() => {
    const el = frame.current!;
    const observer = new ResizeObserver(() => setRoom(el.clientWidth - 8));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const zoom = Math.min(1, Math.max(MIN_ZOOM, room / width));
  return (
    <div className="flow-graph" ref={frame}>
      <div className="flow-canvas" style={{ width: width * zoom, height: height * zoom }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          viewport={{ x: 0, y: 0, zoom }}
          onViewportChange={() => {}}
          minZoom={MIN_ZOOM}
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
