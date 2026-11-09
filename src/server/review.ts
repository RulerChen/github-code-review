import { describeFailures, summarize } from "../engine/diff.js";
import { lineRange } from "../shared/comments.js";
import { describeComparison } from "../shared/comparison.js";
import { changeIds, hunkHeader } from "../shared/hunks.js";
import type { DiffResult, Thread, Topic } from "../shared/types.js";
import { plural, sum } from "../shared/util.js";
import type { Submission } from "./threads.js";

const MAX_CHARS = 60_000;
const MAX_LINES_PER_CHANGE = 40;
const MAX_LINE_CHARS = 300;
const MAX_COMMITS_LISTED = 100;
const MAX_SNIPPET_LINES = 8;

const indent = (text: string, prefix: string) => text.replace(/^/gm, prefix);

export function formatChanges(diff: DiffResult): string {
  const count = sum(diff.files, (f) => changeIds(f).length);
  const out = [`${summarize(diff)}, ${plural(count, "change")}. Each change starts with its id.`, ...describeFailures(diff)];
  let size = 0;
  let omitted = 0;

  if (diff.commits.length) {
    const shown = diff.commits.slice(-MAX_COMMITS_LISTED);
    out.push("", diff.commitCount > shown.length ? `Commits (newest ${shown.length} of ${diff.commitCount}, oldest first):` : "Commits, oldest first:");
    for (const c of shown) out.push(`  ${c.sha.slice(0, 7)} ${c.repo ? `${c.repo}: ` : ""}${c.subject}`);
  }

  for (const f of diff.files) {
    const stat = f.binary ? "binary" : `+${f.additions} -${f.deletions}${f.diffTooLarge ? ", too large to list its lines" : ""}`;
    out.push("", `${f.oldPath ? `${f.oldPath} -> ` : ""}${f.path} (${f.status}, ${stat})`);
    if (f.blocks.length === 0) {
      out.push(`  file:${f.path}`);
      continue;
    }
    for (const b of f.blocks) {
      out.push(`  ${b.id}  ${hunkHeader(b.oldStart, b.oldCount, b.newStart, b.newCount, b.section)}`);
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

  if (omitted) out.push("", `The lines of ${plural(omitted, "change")} were left out to keep this short. Read the files for them.`);
  return out.join("\n");
}

export function formatReviewComments(threads: Thread[], submissions: Submission[], after: number | null, read: number): string | null {
  const withDrafts = after === null;
  const unread = submissions.filter((s) => s.n > (after ?? read));
  const reviews = withDrafts && !unread.length ? submissions.slice(-1) : unread;
  const numbers = new Set(reviews.map((s) => s.n));
  const submitted = threads.filter((t) => t.comments.some((c) => c.review !== null && numbers.has(c.review)));
  const drafts = withDrafts ? threads.filter((t) => !submitted.includes(t) && t.comments.some((c) => c.draft)) : [];
  const asked = withDrafts ? threads.filter((t) => t.comments.every((c) => c.author !== "user" || (!c.draft && c.review === null))) : [];
  if (!reviews.length && !drafts.length && !asked.length) return null;

  const out: string[] = [];
  const section = (title: string, list: Thread[], showDrafts: boolean) =>
    out.push(title, ...list.flatMap((t) => ["", formatThread(t, showDrafts)]));
  for (const s of reviews) {
    out.push(`Review ${s.n}, submitted at ${new Date(s.submittedAt).toLocaleTimeString("en-GB")}.`);
    if (s.body) out.push("  Comment on the whole review:", indent(s.body, "    "));
  }
  if (reviews.length) section(`Comments in ${plural(submitted.length, "thread")}:`, submitted, withDrafts);
  if (drafts.length) section(`\nDraft comments the user has not submitted yet, in ${plural(drafts.length, "thread")}:`, drafts, true);
  if (asked.length) section(`\nQuestions the user asked @claude, answered in the page, in ${plural(asked.length, "thread")}:`, asked, true);
  return out.join("\n");
}

function formatThread(t: Thread, withDrafts: boolean): string {
  const { anchor } = t;
  const comments = t.comments
    .filter((c) => c.status === "done" && (withDrafts || !c.draft))
    .map((c) => {
      const who = c.author === "claude" ? "Claude" : c.draft ? "User (draft)" : c.review ? `User (review ${c.review})` : "User";
      return `  ${who}: ${indent(c.body, "    ").trimStart()}`;
    });
  if (anchor.path === null) {
    const files = t.snippet.split("\n", 1)[0] ?? "";
    const title = `Thread ${t.id}: the topic "${anchor.topic}" of ${describeComparison(anchor.compare)} as a whole`;
    return [title, ...(files ? [`  ${files}`] : []), ...comments].join("\n");
  }
  const version = anchor.commit ? ` at commit ${anchor.commit}` : anchor.side !== "old" ? " in the working tree" : "";
  const where = anchor.side === null ? "the whole file" : `${anchor.side} ${lineRange(anchor)}`;
  const snippet = anchor.side === null ? [] : t.snippet.split("\n").slice(0, MAX_SNIPPET_LINES).map((l) => `  > ${l}`);
  return [`Thread ${t.id}: ${anchor.path}, ${where}${version}`, ...snippet, ...comments].join("\n");
}

export function checkTopics(diff: DiffResult, topics: Topic[]): { unknown: string[]; unassigned: string[] } {
  const known = new Set(diff.files.flatMap(changeIds));
  const used = new Set(topics.flatMap((t) => t.ids));
  return {
    unknown: [...used].filter((id) => !known.has(id)),
    unassigned: [...known].filter((id) => !used.has(id)),
  };
}
