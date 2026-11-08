import { randomBytes } from "node:crypto";
import type { Thread, ThreadAnchor, ThreadComment } from "../shared/types.js";
import { ask } from "./claude.js";

const MENTION = /(^|\s)@claude\b/i;
const EMIT_INTERVAL_MS = 100;

const newId = () => randomBytes(6).toString("base64url");

export class RepoThreads {
  readonly threads: Thread[] = [];
  cwd: string;
  parentSession: string | null = null;
  private fork: { parent: string | null; session: string } | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(thread: Thread) => void>();

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  subscribe(fn: (thread: Thread) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  create(anchor: ThreadAnchor, snippet: string, body: string): Thread {
    const thread: Thread = { id: newId(), rev: 0, anchor, snippet, comments: [] };
    this.threads.push(thread);
    this.addComment(thread, body);
    return thread;
  }

  reply(threadId: string, body: string): Thread | null {
    const thread = this.threads.find((t) => t.id === threadId);
    if (!thread) return null;
    this.addComment(thread, body);
    return thread;
  }

  private emit(thread: Thread): void {
    thread.rev++;
    for (const fn of this.listeners) fn(thread);
  }

  private addComment(thread: Thread, body: string): void {
    thread.comments.push(comment("user", body, "done"));
    if (MENTION.test(body)) this.answer(thread);
    this.emit(thread);
  }

  private answer(thread: Thread): void {
    const prompt = buildPrompt(thread);
    const reply = comment("claude", "", "pending");
    reply.activity = "Waiting";
    thread.comments.push(reply);
    this.queue = this.queue.then(() => this.run(thread, reply, prompt));
  }

  private async run(thread: Thread, reply: ThreadComment, prompt: string): Promise<void> {
    reply.activity = "Thinking";
    this.emit(thread);

    let last = 0;
    const onText = (text: string) => {
      reply.body = text;
      reply.activity = null;
      if (Date.now() - last > EMIT_INTERVAL_MS) {
        last = Date.now();
        this.emit(thread);
      }
    };
    const onActivity = (activity: string) => {
      reply.activity = activity;
      this.emit(thread);
    };

    try {
      // A fork belongs to the parent session it came from. When a viewer is opened from another
      // session, the old fork no longer matches and the next question forks the new parent.
      const parent = this.parentSession;
      const resume = this.fork?.parent === parent ? this.fork.session : null;
      const forking = resume === null && parent !== null;
      let note = "";
      let res;
      try {
        res = await ask({ cwd: this.cwd, resume: resume ?? parent, fork: forking, prompt, onText, onActivity });
      } catch (err) {
        if (!forking) throw err;
        note = `_Answered without the original conversation, because it could not be resumed: ${errorText(err)}_\n\n`;
        res = await ask({ cwd: this.cwd, resume: null, fork: false, prompt, onText, onActivity });
      }
      if (res.sessionId) this.fork = { parent, session: res.sessionId };
      reply.body = note + res.text;
      reply.status = "done";
    } catch (err) {
      reply.body = errorText(err);
      reply.status = "error";
    }
    reply.activity = null;
    this.emit(thread);
  }
}

function comment(author: ThreadComment["author"], body: string, status: ThreadComment["status"]): ThreadComment {
  return { id: newId(), author, body, status, activity: null, createdAt: new Date().toISOString() };
}

function buildPrompt(thread: Thread): string {
  const { path, side, start, end } = thread.anchor;
  const lines = start === end ? `line ${start}` : `lines ${start}-${end}`;
  const history = thread.comments
    .filter((c) => c.status === "done")
    .map((c) => `${c.author === "user" ? "User" : "Claude"}: ${c.body}`)
    .join("\n\n");
  return [
    `The user is reviewing the code changes in a diff viewer. They selected ${lines} of the ${side} version of ${path} and wrote in a comment thread on them.`,
    "Answer the last comment directly and concisely, in the language it is written in, using Markdown. You can read files to check details, but do not change anything.",
    "",
    "Selected lines:",
    "```",
    thread.snippet,
    "```",
    "",
    "Thread:",
    history,
  ].join("\n");
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
