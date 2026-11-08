import { summarize } from "../engine/diff.js";
import { changeIds, rangeHeader } from "../shared/hunks.js";
import type { DiffResult, Topic } from "../shared/types.js";

const MAX_CHARS = 60_000;
const MAX_LINES_PER_CHANGE = 40;
const MAX_LINE_CHARS = 300;

export function formatChanges(diff: DiffResult): string {
  const count = diff.files.reduce((n, f) => n + changeIds(f).length, 0);
  const out = [`${summarize(diff)}, ${count} change${count === 1 ? "" : "s"}. Each change starts with its id.`];
  let size = 0;
  let omitted = 0;

  for (const f of diff.files) {
    const stat = f.binary ? "binary" : `+${f.additions} -${f.deletions}`;
    out.push("", `${f.oldPath ? `${f.oldPath} -> ` : ""}${f.path} (${f.status}, ${stat})`);
    if (f.blocks.length === 0) {
      out.push(`  file:${f.path}`);
      continue;
    }

    for (const b of f.blocks) {
      out.push(`  ${b.id}  @@ -${rangeHeader(b.oldStart, b.oldCount)} +${rangeHeader(b.newStart, b.newCount)} @@${b.section ? ` ${b.section}` : ""}`);
      if (size > MAX_CHARS) {
        omitted++;
        continue;
      }
      const lines = [...b.del.map((l) => `-${l}`), ...b.add.map((l) => `+${l}`)];
      for (const l of lines.slice(0, MAX_LINES_PER_CHANGE)) {
        const line = l.length > MAX_LINE_CHARS ? `${l.slice(0, MAX_LINE_CHARS)}…` : l;
        out.push(`    ${line}`);
        size += line.length + 5;
      }
      if (lines.length > MAX_LINES_PER_CHANGE) out.push(`    … ${lines.length - MAX_LINES_PER_CHANGE} more lines`);
    }
  }

  if (omitted) out.push("", `The lines of ${omitted} change${omitted === 1 ? " were" : "s were"} left out to keep this short. Read the files for them.`);
  return out.join("\n");
}

export function checkTopics(diff: DiffResult, topics: Topic[]): { unknown: string[]; unassigned: string[] } {
  const known = new Set(diff.files.flatMap(changeIds));
  const used = new Set(topics.flatMap((t) => t.ids));
  return {
    unknown: [...used].filter((id) => !known.has(id)),
    unassigned: [...known].filter((id) => !used.has(id)),
  };
}
