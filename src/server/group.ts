import { changeIds } from "../shared/hunks.js";
import type { DiffResult, NotedTopic, TopicNote } from "../shared/types.js";
import { isRecord } from "../shared/util.js";
import { ask } from "./claude.js";
import { checkTopics, formatChanges } from "./review.js";

interface GroupOptions {
  diff: DiffResult;
  focus: string | null;
  names: string[] | null;
  cwd: string;
  session: string | null;
  onActivity: (activity: string) => void;
}

export async function groupChanges(o: GroupOptions): Promise<NotedTopic[]> {
  const run = (resume: string | null, fork: boolean, prompt: string) =>
    ask({ cwd: o.cwd, resume, fork, prompt, onText: () => {}, onActivity: o.onActivity });

  const prompt = buildPrompt(o.diff, o.focus, o.names);
  let res;
  try {
    res = await run(o.session, true, prompt);
  } catch (err) {
    if (o.session === null) throw err;
    res = await run(null, false, prompt);
  }

  const focused = o.focus !== null || o.names !== null;
  let topics = parseTopics(res.text, focused);
  const problem = typeof topics === "string" ? topics : unknownIds(o.diff, topics);
  if (problem && res.sessionId) {
    o.onActivity("Correcting its answer");
    res = await run(res.sessionId, false, `${problem} Reply again with only the corrected JSON object.`);
    topics = parseTopics(res.text, focused);
  }
  if (typeof topics === "string") throw new Error(`Claude's answer could not be used. ${topics}`);

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
    '- "notes": comments you leave on the lines a reviewer most needs explained, such as a subtle invariant, a non-obvious reason, an edge case or a risk to check. Each is {"id": a change id, "line": a line number inside that change or null for the whole change, "body": one to four sentences of Markdown}. A change\'s added lines are numbered from the + number in its @@ header, and its removed lines from the - number; use a removed line only when the change adds none. Leave a note only where it says something the summary and the code do not, at most three in a topic, and give an empty array when nothing needs one.',
    scope,
    "Order the topics the way a reviewer should read them. Write titles, summaries and notes in the language the user writes in.",
    'Reply with only a JSON object and no other text: {"topics": [{"title": "...", "summary": "...", "ids": ["..."], "notes": [{"id": "...", "line": 12, "body": "..."}]}]}',
    "",
    formatChanges(diff),
  ].join("\n");
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
