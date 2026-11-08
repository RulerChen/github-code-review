import { summarize } from "../engine/diff.js";
import { changeIds, rangeHeader } from "../shared/hunks.js";
import type { DiffResult, Thread, Topic } from "../shared/types.js";
import type { Submission } from "./threads.js";

const MAX_CHARS = 60_000;
const MAX_LINES_PER_CHANGE = 40;
const MAX_LINE_CHARS = 300;
const MAX_COMMITS_LISTED = 100;

export function formatChanges(diff: DiffResult): string {
  const count = diff.files.reduce((n, f) => n + changeIds(f).length, 0);
  const out = [`${summarize(diff)}, ${count} change${count === 1 ? "" : "s"}. Each change starts with its id.`];
  let size = 0;
  let omitted = 0;

  if (diff.commits.length) {
    const shown = diff.commits.slice(-MAX_COMMITS_LISTED);
    out.push("", diff.commitCount > shown.length ? `Commits (newest ${shown.length} of ${diff.commitCount}, oldest first):` : "Commits, oldest first:");
    for (const c of shown) out.push(`  ${c.sha.slice(0, 7)} ${c.subject}`);
  }

  for (const f of diff.files) {
    const stat = f.binary ? "binary" : `+${f.additions} -${f.deletions}${f.diffTooLarge ? ", too large to list its lines" : ""}`;
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

/**
 * The reviews numbered above `after`, or the latest one without it, and any draft comments not
 * submitted yet. Null when there are neither.
 */
export function formatReviewComments(threads: Thread[], submissions: Submission[], after: number | null): string | null {
  const reviews = after === null ? submissions.slice(-1) : submissions.filter((s) => s.n > after);
  const numbers = new Set(reviews.map((s) => s.n));
  const submitted = threads.filter((t) => t.comments.some((c) => c.review !== null && numbers.has(c.review)));
  const drafts = threads.filter((t) => t.comments.some((c) => c.draft));
  if (!reviews.length && !drafts.length) return null;

  const out: string[] = [];
  for (const s of reviews) {
    out.push(`Review ${s.n}, submitted at ${new Date(s.submittedAt).toLocaleTimeString("en-GB")}.`);
    if (s.body) out.push("  Comment on the whole review:", indent(s.body, "    "));
  }
  if (reviews.length) {
    out.push(`Comments in ${submitted.length} thread${submitted.length === 1 ? "" : "s"}:`);
    for (const t of submitted) out.push("", formatThread(t));
  }
  if (drafts.length) {
    out.push("", `Draft comments the user has not submitted yet, in ${drafts.length} thread${drafts.length === 1 ? "" : "s"}:`);
    for (const t of drafts) out.push("", formatThread(t));
  }
  return out.join("\n");
}

function formatThread(t: Thread): string {
  const { anchor } = t;
  const version = anchor.commit ? ` at commit ${anchor.commit}` : anchor.side !== "old" ? " in the working tree" : "";
  const where =
    anchor.side === null
      ? "the whole file"
      : `${anchor.side} ${anchor.start === anchor.end ? `line ${anchor.start}` : `lines ${anchor.start}-${anchor.end}`}`;
  const snippet = anchor.side === null ? [] : t.snippet.split("\n").slice(0, 8).map((l) => `  > ${l}`);
  const comments = t.comments
    .filter((c) => c.status === "done")
    .map((c) => {
      const who = c.author === "claude" ? "Claude" : c.draft ? "User (draft)" : c.review ? `User (review ${c.review})` : "User";
      return `  ${who}: ${indent(c.body, "    ").trimStart()}`;
    });
  return [`Thread ${t.id}: ${anchor.path}, ${where}${version}`, ...snippet, ...comments].join("\n");
}

const indent = (text: string, prefix: string) => text.replace(/^/gm, prefix);

export function checkTopics(diff: DiffResult, topics: Topic[]): { unknown: string[]; unassigned: string[] } {
  const known = new Set(diff.files.flatMap(changeIds));
  const used = new Set(topics.flatMap((t) => t.ids));
  return {
    unknown: [...used].filter((id) => !known.has(id)),
    unassigned: [...known].filter((id) => !used.has(id)),
  };
}
