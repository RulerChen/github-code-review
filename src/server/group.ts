import { readRepoFile } from "../engine/browse.js";
import { changeIds, editedInto, oldCommitOf } from "../shared/hunks.js";
import type { DiffResult, FlowStep, Review, Topic } from "../shared/types.js";
import { isRecord, plural } from "../shared/util.js";
import { ask } from "./claude.js";
import { checkTopics, formatChanges, formatFiles } from "./review.js";

interface AskOptions {
  cwd: string;
  session: string | null;
  onActivity: (activity: string) => void;
}

interface GroupOptions extends AskOptions {
  diff: DiffResult;
  focus: string | null;
  names: string[] | null;
}

const SUMMARY_RULES = "Add why in one sentence when you know it. Describe the end result of the changes as listed: no commit hashes, no account of which commit did what, nothing about code these changes leave alone, and no advice to the reviewer.";

const flowRules = (root: string) =>
  `as steps {"path", "line", "text"} in the order the code runs. Include the steps in code these changes leave alone and in other repositories, so the reviewer can follow the path from where it starts to where it ends, one step per function it passes through. "path" is relative to ${root}, like the paths below. "line" is the line of that function or call in the new version of the file. "text" says in one sentence what happens there. Give [] when the changes do not sit on a path through several functions.`;

const REPLY =
  'Reply with only a JSON object and no other text: {"topics": [{"title": "...", "summary": "...", "ids": ["..."], "flow": [{"path": "...", "line": 1, "text": "..."}]}]}';

async function askTopics(o: AskOptions, prompt: string, allowEmpty: boolean, check: (topics: Topic[]) => Promise<string | null>): Promise<Topic[]> {
  const run = (resume: string | null, fork: boolean, prompt: string) =>
    ask({ cwd: o.cwd, resume, fork, prompt, onText: () => {}, onActivity: o.onActivity });

  let res;
  try {
    res = await run(o.session, true, prompt);
  } catch (err) {
    if (o.session === null) throw err;
    res = await run(null, false, prompt);
  }

  let topics = parseTopics(res.text, allowEmpty);
  const problem = typeof topics === "string" ? topics : await check(topics);
  if (problem && res.sessionId) {
    o.onActivity("Correcting its answer");
    res = await run(res.sessionId, false, `${problem} Reply again with only the corrected JSON object.`);
    topics = parseTopics(res.text, allowEmpty);
  }
  if (typeof topics === "string") throw new Error(`Claude's answer could not be used. ${topics}`);
  return topics;
}

export async function groupChanges(o: GroupOptions): Promise<Topic[]> {
  const focused = o.focus !== null || o.names !== null;
  const topics = await askTopics(o, buildPrompt(o.diff, o.focus, o.names), focused, async (t) =>
    problems(unknownIds(o.diff, t), flowProblem(await missingSteps(o.diff, t), o.diff.repoRoot)),
  );

  const known = new Set(o.diff.files.flatMap(changeIds));
  const kept = withoutSteps(topics, await missingSteps(o.diff, topics))
    .map((t) => ({ ...t, ids: t.ids.filter((id) => known.has(id)) }))
    .filter((t) => t.ids.length > 0);
  if (!kept.length) {
    throw new Error(
      o.names ? "No change belongs to these topics." : focused ? "No change matches the focus." : "Claude's answer put no change of this comparison in a topic.",
    );
  }
  return kept;
}

function buildPrompt(diff: DiffResult, focus: string | null, names: string[] | null): string {
  const empty = ' If no change fits, reply with {"topics": []}.';
  const scope = names
    ? `Use exactly these topics, in this order and with these titles: ${names.map((n) => JSON.stringify(n)).join(", ")}. Do not add topics of your own. Put each change in the topic it belongs to, leave out the changes that fit none of them, and leave out a topic that no change belongs to.${empty}`
    : focus
      ? `Make topics only for the changes the focus asks for. Leave every other change out of your answer, and do not make a topic for changes that have nothing to do with the focus. The reviewer still finds those in the list of all files.${empty}`
      : "Put every id in a topic.";
  return [
    `The user is reviewing code changes in a diff viewer and asked, from the page, for them to be grouped into topics${focus ? `, with this focus: ${JSON.stringify(focus)}` : ""}.`,
    "A topic is one feature, fix or purpose, and can span files. Use what you know about why the changes were made, and the commit messages, to tell which changes belong together. You can read files to check details, but do not change anything.",
    "For each topic give:",
    '- "title": a few words.',
    `- "summary": Markdown on what behaves differently after these changes: name each function or file involved and say what it did before, what it does now, and in which cases. ${SUMMARY_RULES}`,
    '- "ids": the ids of all changes in the topic, exactly as listed below.',
    `- "flow": the path a call or data takes through the code these changes sit on, ${flowRules(diff.repoRoot)}`,
    scope,
    "Order the topics the way a reviewer should read them. Write titles, summaries and flow steps in the language the user writes in.",
    REPLY,
    "",
    formatChanges(diff),
  ].join("\n");
}

export interface TopicDelta {
  added: Set<string>;
  removed: Set<string>;
}

export function topicDelta(review: Review, diff: DiffResult): TopicDelta | null {
  const before = review.changes;
  if (!before) return null;
  const now = new Set(diff.files.flatMap(changeIds));
  const added = new Set([...now].filter((id) => !(id in before)));
  const removed = new Set(Object.keys(before).filter((id) => !now.has(id)));
  return added.size || removed.size ? { added, removed } : null;
}

export function needsClaude(review: Review, delta: TopicDelta): boolean {
  return delta.added.size > 0 || review.topics.some((t) => t.ids.some((id) => delta.removed.has(id)) && t.ids.some((id) => !delta.removed.has(id)));
}

interface SyncOptions extends AskOptions {
  review: Review;
  diff: DiffResult;
  delta: TopicDelta;
}

export async function syncTopics(o: SyncOptions): Promise<Topic[]> {
  const { review, diff, delta } = o;
  const answer = await askTopics(o, buildSyncPrompt(review, diff, delta), true, async (t) =>
    problems(syncProblem(t, delta.added, review.focus !== null), flowProblem(await missingSteps(diff, t), diff.repoRoot)),
  );
  return mergeSync(review, diff, delta, withoutSteps(answer, await missingSteps(diff, answer)));
}

export function mergeSync(review: Review, diff: DiffResult, delta: TopicDelta, answer: Topic[]): Topic[] {
  const now = new Set(diff.files.flatMap(changeIds));
  const added = (ids: string[]) => ids.filter((id) => delta.added.has(id));
  const updates = new Map<string, { summary: string; ids: string[]; flow?: FlowStep[] }>();
  for (const t of answer) {
    const u = updates.get(t.title);
    updates.set(t.title, { summary: t.summary || u?.summary || "", ids: [...(u?.ids ?? []), ...added(t.ids)], flow: t.flow ?? u?.flow });
  }

  const topics: Topic[] = review.topics.map((t) => {
    const u = updates.get(t.title);
    updates.delete(t.title);
    const flow = u?.flow ?? t.flow;
    const ids = [...new Set([...t.ids.filter((id) => now.has(id)), ...(u?.ids ?? [])])];
    return { title: t.title, summary: u?.summary || t.summary, ids, ...(flow ? { flow } : {}) };
  });
  for (const [title, u] of updates) topics.push({ title, summary: u.summary, ids: [...new Set(u.ids)], ...(u.flow ? { flow: u.flow } : {}) });
  return topics.filter((t) => t.ids.length > 0);
}

function buildSyncPrompt(review: Review, diff: DiffResult, delta: TopicDelta): string {
  const now = new Set(diff.files.flatMap(changeIds));
  const commitOf = oldCommitOf(diff.repos);
  const before = new Set(Object.keys(review.changes ?? {}));
  const labels = new Map<string, string>();
  const replacing = new Set<string>();
  for (const t of review.topics) {
    for (const id of t.ids.filter((x) => delta.removed.has(x))) {
      for (const into of editedInto(review.changes?.[id], diff.files, commitOf, before)) {
        labels.set(into, labels.has(into) ? `${labels.get(into)}, ${JSON.stringify(t.title)}` : `replaces a change of ${JSON.stringify(t.title)}`);
        replacing.add(t.title);
      }
    }
  }

  const affected = review.topics.filter((t) => replacing.has(t.title) || t.ids.some((id) => delta.removed.has(id)));
  const context = new Set(affected.flatMap((t) => t.ids.filter((id) => now.has(id))));
  const topics = review.topics.flatMap((t) => {
    const kept = t.ids.filter((id) => now.has(id));
    const gone = t.ids.filter((id) => delta.removed.has(id)).length;
    const changes = `${kept.length ? kept.join(", ") : "no changes left"}${gone ? `; ${plural(gone, "change")} gone since` : ""}`;
    const flow = t.flow?.length ? ["    Flow:", ...t.flow.map((s, i) => `      ${i + 1}. ${s.path}:${s.line} ${s.text}`)] : [];
    return [`- ${JSON.stringify(t.title)} (${changes})`, t.summary.replace(/^/gm, "    "), ...flow];
  });
  const scope = review.focus
    ? `The topics were made with this focus: ${JSON.stringify(review.focus)}. Put a new change in a topic only when the focus asks for it, and leave the others out.`
    : "Put every new change in a topic, in a new one when none fits.";
  const touched = new Set(diff.files.filter((f) => changeIds(f).some((id) => delta.added.has(id))).map((f) => f.path));
  const reflow = review.topics.filter((t) => t.flow?.some((s) => touched.has(s.path))).map((t) => JSON.stringify(t.title));
  const alsoReflow = reflow.length
    ? `, and these topics, whose flows pass through files with new or edited changes, with their summaries as above: ${reflow.join(", ")}`
    : "";

  return [
    "The user is reviewing code changes in a diff viewer, grouped into topics that were made earlier. The code has changed since: some changes are new or were edited, and some are gone. Update the topics to match the code as it is now. You can read files to check details, but do not change anything.",
    "",
    "The topics, in order, with the ids of the changes they still have, their summaries and flows:",
    ...topics,
    "",
    "The new and edited changes. Each starts with its id, and an edited change says which topic's change it replaces:",
    ...(delta.added.size ? formatFiles(diff.files, delta.added, labels) : ["", "  None."]),
    ...(context.size ? ["", "The changes those topics still have, unchanged, for context:", ...formatFiles(diff.files, context)] : []),
    "",
    `Give each topic that gains or loses changes, each new topic${alsoReflow}:`,
    '- "title": the title exactly as above, or a few words for a new topic.',
    `- "summary": Markdown on what behaves differently after the topic's changes as they are now: name each function or file involved and say what it did before, what it does now, and in which cases. ${SUMMARY_RULES}`,
    '- "ids": the ids of the new and edited changes that belong in the topic. Leave out the ids it already has.',
    `- "flow": the topic's whole flow as the code is now: the path a call or data takes through the code its changes sit on, ${flowRules(diff.repoRoot)}`,
    `${scope} Leave out the other topics. Write in the language of the summaries above.`,
    REPLY,
  ].join("\n");
}

function syncProblem(topics: Topic[], added: Set<string>, focused: boolean): string | null {
  const used = new Set(topics.flatMap((t) => t.ids));
  const unknown = [...used].filter((id) => !added.has(id));
  if (unknown.length) return `These ids are not new or edited changes: ${unknown.join(", ")}.`;
  const missing = focused ? [] : [...added].filter((id) => !used.has(id));
  return missing.length ? `Put these ids in a topic too: ${missing.join(", ")}.` : null;
}

function parseTopics(text: string, allowEmpty: boolean): Topic[] | string {
  const value = parseJson(text);
  if (value === undefined) return "The answer was not a JSON object.";
  const list = Array.isArray(value) ? value : isRecord(value) ? value.topics : undefined;
  if (!Array.isArray(list) || (list.length === 0 && !allowEmpty)) return 'The answer had no "topics" array.';
  const topics = list.map(toTopic);
  if (topics.some((t) => t === null)) {
    return 'Each topic needs a "title" and a "summary" string, an "ids" array of strings and a "flow" array of {"path", "line", "text"} with a whole-number line.';
  }
  return topics as Topic[];
}

function toTopic(t: unknown): Topic | null {
  if (!isRecord(t)) return null;
  const { title, summary, ids, flow } = t;
  if (typeof title !== "string" || !title.trim() || typeof summary !== "string") return null;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) return null;
  if (flow === undefined) return { title: title.trim(), summary: summary.trim(), ids };
  const steps = Array.isArray(flow) ? flow.map(toStep) : [null];
  if (steps.some((s) => s === null)) return null;
  return { title: title.trim(), summary: summary.trim(), ids, flow: steps as FlowStep[] };
}

function toStep(s: unknown): FlowStep | null {
  if (!isRecord(s) || typeof s.path !== "string" || !s.path.trim() || typeof s.text !== "string") return null;
  if (typeof s.line !== "number" || !Number.isInteger(s.line) || s.line < 1) return null;
  return { path: s.path.trim(), line: s.line, text: s.text.trim() };
}

export async function missingSteps(diff: DiffResult, topics: Topic[]): Promise<Map<FlowStep, string>> {
  const counts = new Map<string, Promise<number | null>>();
  const lineCount = (p: string) => {
    if (!counts.has(p)) {
      const count = readRepoFile(diff, p).then((f) => (f === null ? null : f.text === null ? Infinity : f.text.replace(/\n$/, "").split("\n").length));
      counts.set(p, count.catch(() => null));
    }
    return counts.get(p)!;
  };
  const bad = new Map<FlowStep, string>();
  for (const s of topics.flatMap((t) => t.flow ?? [])) {
    const count = await lineCount(s.path);
    if (count === null) bad.set(s, `${s.path}:${s.line} (no such file)`);
    else if (s.line > count) bad.set(s, `${s.path}:${s.line} (the file has ${count} lines)`);
  }
  return bad;
}

export function flowProblem(bad: Map<FlowStep, string>, root: string): string | null {
  return bad.size ? `These flow steps point to no line of the compared version: ${[...bad.values()].join(", ")}. Paths are relative to ${root}.` : null;
}

function withoutSteps(topics: Topic[], bad: Map<FlowStep, string>): Topic[] {
  return topics.map((t) => (t.flow ? { ...t, flow: t.flow.filter((s) => !bad.has(s)) } : t));
}

function problems(...found: (string | null)[]): string | null {
  return found.filter(Boolean).join(" ") || null;
}

function parseJson(text: string): unknown {
  const fenced = /```(?:json)?[ \t]*\n([\s\S]*?)\n[ \t]*```/.exec(text)?.[1];
  const braced = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  for (const candidate of [text.trim(), fenced, braced]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  return undefined;
}

function unknownIds(diff: DiffResult, topics: Topic[]): string | null {
  const { unknown } = checkTopics(diff, topics);
  return unknown.length ? `These ids are not in the list of changes: ${unknown.join(", ")}.` : null;
}
