import { changeIds } from "../shared/hunks.js";
import type { DiffResult, Topic } from "../shared/types.js";
import { ask } from "./claude.js";
import { checkTopics, formatChanges } from "./review.js";

export interface GroupOptions {
  diff: DiffResult;
  focus: string | null;
  cwd: string;
  /** The Claude Code session that opened the viewer. A fork of it knows why the changes were made. */
  session: string | null;
  onActivity: (activity: string) => void;
}

/**
 * Asks Claude to group every change in the diff into topics, as the review skill does from the terminal. An answer
 * that is not the JSON asked for, or that names ids not in the diff, gets one chance to be corrected. Ids still
 * unknown after that are dropped, and changes in no topic show under Other changes.
 */
export async function groupChanges(o: GroupOptions): Promise<Topic[]> {
  const run = (resume: string | null, fork: boolean, prompt: string) =>
    ask({ cwd: o.cwd, resume, fork, prompt, onText: () => {}, onActivity: o.onActivity });

  const prompt = buildPrompt(o.diff, o.focus);
  let res;
  try {
    res = await run(o.session, true, prompt);
  } catch (err) {
    if (o.session === null) throw err;
    // The session could not be resumed. Claude can still group the changes from the diff and the files.
    res = await run(null, false, prompt);
  }

  let topics = parseTopics(res.text);
  const problem = typeof topics === "string" ? topics : unknownIds(o.diff, topics);
  if (problem && res.sessionId) {
    o.onActivity("Correcting its answer");
    res = await run(res.sessionId, false, `${problem} Reply again with only the corrected JSON object.`);
    topics = parseTopics(res.text);
  }
  if (typeof topics === "string") throw new Error(`Claude's answer could not be used. ${topics}`);

  const known = new Set(o.diff.files.flatMap(changeIds));
  const kept = topics.map((t) => ({ ...t, ids: t.ids.filter((id) => known.has(id)) })).filter((t) => t.ids.length > 0);
  if (!kept.length) throw new Error("Claude's answer put no change of this comparison in a topic.");
  return kept;
}

function buildPrompt(diff: DiffResult, focus: string | null): string {
  return [
    `The user is reviewing code changes in a diff viewer and asked, from the page, for them to be grouped into topics${focus ? `, with this focus: ${JSON.stringify(focus)}` : ""}.`,
    "A topic is one feature, fix or purpose, and can span files. Use what you know about why the changes were made, and the commit messages for the why. You can read files to check details, but do not change anything.",
    "For each topic give:",
    '- "title": a few words.',
    '- "summary": two to six sentences of Markdown on what changed and why, naming the files and functions involved and anything the reviewer should check closely.',
    '- "ids": the ids of all changes in the topic, exactly as listed below.',
    '- "related": false if the topic has nothing to do with the focus, otherwise true.',
    "Put every id in a topic. Order the topics the way a reviewer should read them, with the ones that match the focus first. Write titles and summaries in the language the user writes in.",
    'Reply with only a JSON object and no other text: {"topics": [{"title": "...", "summary": "...", "ids": ["..."], "related": true}]}',
    "",
    formatChanges(diff),
  ].join("\n");
}

/** The topics in Claude's answer, or what is wrong with it. */
function parseTopics(text: string): Topic[] | string {
  const value = parseJson(text);
  if (value === undefined) return "The answer was not a JSON object.";
  const list = Array.isArray(value) ? value : isRecord(value) ? value.topics : undefined;
  if (!Array.isArray(list) || list.length === 0) return 'The answer had no "topics" array.';
  const topics = list.map(toTopic);
  if (topics.some((t) => t === null)) {
    return 'Each topic needs a "title" and a "summary" string, an "ids" array of strings and an optional "related" boolean.';
  }
  return topics as Topic[];
}

function toTopic(t: unknown): Topic | null {
  if (!isRecord(t)) return null;
  const { title, summary, ids, related } = t;
  if (typeof title !== "string" || !title.trim() || typeof summary !== "string") return null;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) return null;
  if (related !== undefined && typeof related !== "boolean") return null;
  return { title: title.trim(), summary: summary.trim(), ids, related: related ?? true };
}

// The answer should be the bare object, but can come in a code fence or with words around it.
function parseJson(text: string): unknown {
  const fenced = /```(?:json)?[ \t]*\n([\s\S]*?)\n[ \t]*```/.exec(text)?.[1];
  const braced = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  for (const candidate of [text.trim(), fenced, braced]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next way the answer may wrap the object.
    }
  }
  return undefined;
}

function unknownIds(diff: DiffResult, topics: Topic[]): string | null {
  const { unknown } = checkTopics(diff, topics);
  return unknown.length ? `These ids are not in the list of changes: ${unknown.join(", ")}.` : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
