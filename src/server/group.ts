import { changeIds, editedInto, oldCommitOf } from "../shared/hunks.js";
import type { DiffResult, NotedTopic, Review, Topic, TopicNote } from "../shared/types.js";
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

const NOTES =
  '- "notes": comments you leave on the lines a reviewer most needs explained, such as a subtle invariant, a non-obvious reason, an edge case or a risk to check. Each is {"id": a change id, "line": a line number inside that change or null for the whole change, "body": one to four sentences of Markdown}. A change\'s added lines are numbered from the + number in its @@ header, and its removed lines from the - number; use a removed line only when the change adds none. Leave a note only where it says something the summary and the code do not, at most three in a topic, and give an empty array when nothing needs one.';
const REPLY =
  'Reply with only a JSON object and no other text: {"topics": [{"title": "...", "summary": "...", "ids": ["..."], "notes": [{"id": "...", "line": 12, "body": "..."}]}]}';

async function askTopics(o: AskOptions, prompt: string, allowEmpty: boolean, check: (topics: NotedTopic[]) => string | null): Promise<NotedTopic[]> {
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
  const problem = typeof topics === "string" ? topics : check(topics);
  if (problem && res.sessionId) {
    o.onActivity("Correcting its answer");
    res = await run(res.sessionId, false, `${problem} Reply again with only the corrected JSON object.`);
    topics = parseTopics(res.text, allowEmpty);
  }
  if (typeof topics === "string") throw new Error(`Claude's answer could not be used. ${topics}`);
  return topics;
}

export async function groupChanges(o: GroupOptions): Promise<NotedTopic[]> {
  const focused = o.focus !== null || o.names !== null;
  const topics = await askTopics(o, buildPrompt(o.diff, o.focus, o.names), focused, (t) => unknownIds(o.diff, t));

  const known = new Set(o.diff.files.flatMap(changeIds));
  const kept = topics.map((t) => ({ ...t, ids: t.ids.filter((id) => known.has(id)) })).filter((t) => t.ids.length > 0);
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
    "A topic is one feature, fix or purpose, and can span files. Use what you know about why the changes were made, and the commit messages for the why. You can read files to check details, but do not change anything.",
    "For each topic give:",
    '- "title": a few words.',
    '- "summary": two to six sentences of Markdown on what changed and why, naming the files and functions involved and anything the reviewer should check closely.',
    '- "ids": the ids of all changes in the topic, exactly as listed below.',
    NOTES,
    scope,
    "Order the topics the way a reviewer should read them. Write titles, summaries and notes in the language the user writes in.",
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

export interface TopicSync {
  topics: Topic[];
  notes: TopicNote[];
}

export async function syncTopics(o: SyncOptions): Promise<TopicSync> {
  const { review, diff, delta } = o;
  const answer = await askTopics(o, buildSyncPrompt(review, diff, delta), true, (t) => syncProblem(t, delta.added, review.focus !== null));
  return mergeSync(review, diff, delta, answer);
}

export function mergeSync(review: Review, diff: DiffResult, delta: TopicDelta, answer: NotedTopic[]): TopicSync {
  const now = new Set(diff.files.flatMap(changeIds));
  const added = (ids: string[]) => ids.filter((id) => delta.added.has(id));
  const updates = new Map<string, { summary: string; ids: string[] }>();
  for (const t of answer) {
    const u = updates.get(t.title);
    updates.set(t.title, { summary: t.summary || u?.summary || "", ids: [...(u?.ids ?? []), ...added(t.ids)] });
  }

  const topics: Topic[] = review.topics.map((t) => {
    const u = updates.get(t.title);
    updates.delete(t.title);
    return { title: t.title, summary: u?.summary || t.summary, ids: [...new Set([...t.ids.filter((id) => now.has(id)), ...(u?.ids ?? [])])] };
  });
  for (const [title, u] of updates) topics.push({ title, summary: u.summary, ids: [...new Set(u.ids)] });

  const notes = answer.flatMap((t) => t.notes).filter((n) => delta.added.has(n.id));
  return { topics: topics.filter((t) => t.ids.length > 0), notes };
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
    return [`- ${JSON.stringify(t.title)} (${changes})`, t.summary.replace(/^/gm, "    ")];
  });
  const scope = review.focus
    ? `The topics were made with this focus: ${JSON.stringify(review.focus)}. Put a new change in a topic only when the focus asks for it, and leave the others out.`
    : "Put every new change in a topic, in a new one when none fits.";

  return [
    "The user is reviewing code changes in a diff viewer, grouped into topics that were made earlier. The code has changed since: some changes are new or were edited, and some are gone. Update the topics to match the code as it is now. You can read files to check details, but do not change anything.",
    "",
    "The topics, in order, with the ids of the changes they still have and their summaries:",
    ...topics,
    "",
    "The new and edited changes. Each starts with its id, and an edited change says which topic's change it replaces:",
    ...(delta.added.size ? formatFiles(diff.files, delta.added, labels) : ["", "  None."]),
    ...(context.size ? ["", "The changes those topics still have, unchanged, for context:", ...formatFiles(diff.files, context)] : []),
    "",
    "Give each topic that gains or loses changes, and each new topic:",
    '- "title": the title exactly as above, or a few words for a new topic.',
    '- "summary": two to six sentences of Markdown on what the topic changes now and why, naming the files and functions involved and anything the reviewer should check closely.',
    '- "ids": the ids of the new and edited changes that belong in the topic. Leave out the ids it already has.',
    NOTES,
    `${scope} Leave notes only on the new and edited changes, and leave out the topics that neither gain nor lose changes. Write in the language of the summaries above.`,
    REPLY,
  ].join("\n");
}

function syncProblem(topics: NotedTopic[], added: Set<string>, focused: boolean): string | null {
  const used = new Set(topics.flatMap((t) => t.ids));
  const unknown = [...new Set([...used, ...topics.flatMap((t) => t.notes.map((n) => n.id))])].filter((id) => !added.has(id));
  if (unknown.length) return `These ids are not new or edited changes: ${unknown.join(", ")}.`;
  const missing = focused ? [] : [...added].filter((id) => !used.has(id));
  return missing.length ? `Put these ids in a topic too: ${missing.join(", ")}.` : null;
}

function parseTopics(text: string, allowEmpty: boolean): NotedTopic[] | string {
  const value = parseJson(text);
  if (value === undefined) return "The answer was not a JSON object.";
  const list = Array.isArray(value) ? value : isRecord(value) ? value.topics : undefined;
  if (!Array.isArray(list) || (list.length === 0 && !allowEmpty)) return 'The answer had no "topics" array.';
  const topics = list.map(toTopic);
  if (topics.some((t) => t === null)) {
    return 'Each topic needs a "title" and a "summary" string and an "ids" array of strings.';
  }
  return topics as NotedTopic[];
}

function toTopic(t: unknown): NotedTopic | null {
  if (!isRecord(t)) return null;
  const { title, summary, ids, notes } = t;
  if (typeof title !== "string" || !title.trim() || typeof summary !== "string") return null;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) return null;
  return { title: title.trim(), summary: summary.trim(), ids, notes: Array.isArray(notes) ? notes.flatMap(toNote) : [] };
}

function toNote(n: unknown): TopicNote[] {
  if (!isRecord(n) || typeof n.id !== "string" || typeof n.body !== "string" || !n.body.trim()) return [];
  const line = typeof n.line === "number" && Number.isInteger(n.line) && n.line > 0 ? n.line : null;
  return [{ id: n.id, line, body: n.body.trim() }];
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

function unknownIds(diff: DiffResult, topics: NotedTopic[]): string | null {
  const { unknown } = checkTopics(diff, topics);
  return unknown.length ? `These ids are not in the list of changes: ${unknown.join(", ")}.` : null;
}
