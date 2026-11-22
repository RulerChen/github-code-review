import type { KeyboardEvent } from "react";
import type { DiffRepo, FlowStep } from "../shared/types";
import { basename, dirPrefix } from "./paths";

export interface FlowItem {
  step: FlowStep;
  changed: boolean;
  lane: number;
}

export interface FlowLanes {
  kind: "repository" | "folder" | "file";
  lanes: { key: string; label: string }[];
  laneOf: number[];
}

export function flowLanes(steps: FlowStep[], repos: DiffRepo[]): FlowLanes {
  const repoOf = (p: string) => repos.find((r) => r.dir !== "" && p.startsWith(`${r.dir}/`))?.dir ?? "";
  const dirOf = (p: string) => dirPrefix(p).replace(/\/$/, "");
  const ways = [
    { kind: "repository", keyOf: repoOf, label: (k: string) => k },
    { kind: "folder", keyOf: dirOf, label: (k: string) => k || "/" },
    { kind: "file", keyOf: (p: string) => p, label: basename },
  ] as const;
  for (const { kind, keyOf, label } of ways) {
    const keys = steps.map((s) => keyOf(s.path));
    const order = [...new Set(keys)];
    if (order.length > 1) return { kind, lanes: order.map((key) => ({ key, label: label(key) })), laneOf: keys.map((k) => order.indexOf(k)) };
  }
  return { kind: "file", lanes: [], laneOf: steps.map(() => 0) };
}

const LANE = 200;
const BOX_W = 172;
const BOX_H = 40;
const ROW = 60;
const HEAD = 34;
const TEXT_X = 28;
const BEND = 8;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function titleOf(step: FlowStep): { title: string; sub: string } {
  if (!step.inside) return { title: clip(basename(step.path), 19), sub: `line ${step.line}` };
  const parts = step.inside.split(" › ");
  const two = parts.slice(-2).join(".");
  return { title: clip(two.length <= 19 ? two : parts.at(-1)!, 19), sub: clip(`${basename(step.path)}:${step.line}`, 23) };
}

interface Props {
  items: FlowItem[];
  lanes: FlowLanes;
  current: number | null;
  onPick: (index: number) => void;
}

export function FlowDiagram({ items, lanes, current, onPick }: Props) {
  const width = lanes.lanes.length * LANE;
  const height = HEAD + (items.length - 1) * ROW + BOX_H + 8;
  const left = (lane: number) => lane * LANE + (LANE - BOX_W) / 2;
  const center = (lane: number) => lane * LANE + LANE / 2;
  const top = (i: number) => HEAD + i * ROW;

  const arrows = items.slice(1).map((to, k) => {
    const from = items[k]!;
    const y1 = top(k + 1);
    const x = center(to.lane);
    const head = `M${x - 4} ${y1 - 6}L${x + 4} ${y1 - 6}L${x} ${y1}Z`;
    if (from.lane === to.lane) {
      return { key: k, cross: false, line: `M${x} ${top(k) + BOX_H}V${y1 - 6}`, head };
    }
    const dir = to.lane > from.lane ? 1 : -1;
    const x0 = left(from.lane) + (dir > 0 ? BOX_W : 0);
    const y0 = top(k) + BOX_H / 2;
    return { key: k, cross: true, line: `M${x0} ${y0}H${x - dir * BEND}Q${x} ${y0} ${x} ${y0 + BEND}V${y1 - 6}`, head };
  });

  const press = (i: number) => (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    onPick(i);
  };

  return (
    <div className="flow-diagram">
      <svg viewBox={`0 0 ${width} ${height}`} style={{ maxWidth: width, minWidth: width * 0.75 }} role="group" aria-label="Flow diagram">
        {lanes.lanes.map((lane, i) => (
          <g key={lane.key}>
            {i > 0 && <line className="flow-divider" x1={i * LANE} y1={4} x2={i * LANE} y2={height - 4} />}
            <text className="flow-lane" x={center(i)} y={18} textAnchor="middle">
              <title>{lane.key || lane.label}</title>
              {clip(lane.label, 22)}
            </text>
          </g>
        ))}
        <line className="flow-divider" x1={0} y1={HEAD - 8} x2={width} y2={HEAD - 8} />
        {arrows.map((a) => (
          <g key={a.key} className={`flow-arrow${a.cross ? " is-cross" : ""}`}>
            <path d={a.line} />
            <path className="flow-arrow-head" d={a.head} />
          </g>
        ))}
        {items.map((item, i) => {
          const { title, sub } = titleOf(item.step);
          const x = left(item.lane);
          const y = top(i);
          const classes = ["flow-node", item.changed ? "is-changed" : "", current === i ? "is-current" : ""].filter(Boolean).join(" ");
          return (
            <g
              key={i}
              className={classes}
              role="button"
              tabIndex={0}
              aria-label={`Step ${i + 1}: ${item.step.path}:${item.step.line}`}
              onClick={() => onPick(i)}
              onKeyDown={press(i)}
            >
              <title>{[item.step.inside, `${item.step.path}:${item.step.line}`, item.step.text.replace(/`/g, "")].filter(Boolean).join("\n")}</title>
              <rect x={x} y={y} width={BOX_W} height={BOX_H} rx={6} />
              <text className="flow-num" x={x + 10} y={y + 17}>
                {i + 1}
              </text>
              <text className="flow-title" x={x + TEXT_X} y={y + 17}>
                {title}
              </text>
              <text className="flow-sub" x={x + TEXT_X} y={y + 31}>
                {sub}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flow-legend">
        <span>
          <i className="flow-key-box" /> changed line
        </span>
        <span>
          <i className="flow-key-box is-dashed" /> unchanged code
        </span>
        <span>
          <i className="flow-key-arrow" /> into another {lanes.kind}
        </span>
      </div>
    </div>
  );
}
