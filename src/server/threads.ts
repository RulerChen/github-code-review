import { randomBytes } from "node:crypto";
import { lineRange, MENTION } from "../shared/comments.js";
import { describeComparison } from "../shared/comparison.js";
import type { Thread, ThreadAnchor, ThreadComment, ThreadContext } from "../shared/types.js";
import { errorMessage } from "../shared/util.js";
import { ask } from "./claude.js";

const EMIT_INTERVAL_MS = 100;
const REVIEWING = "The user is reviewing the code changes in a diff viewer";
const STOPPED = "The viewer stopped before Claude answered. Ask again for an answer.";
const ANSWER =
  "Answer the last comment directly and concisely, in the language it is written in, using Markdown. You can read files to check details, but do not change anything.";

const newId = () => randomBytes(6).toString("base64url");
const now = () => new Date().toISOString();

export interface Submission {
  n: number;
  body: string;
  submittedAt: string;
}

export class RepoThreads {
  readonly threads: Thread[] = [];
  readonly submissions: Submission[] = [];
  read = 0;
  parentSession: string | null = null;
  onChange: () => void = () => {};

  private fork: { parent: string | null; session: string | null } | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(thread: Thread) => void>();
  private readonly listeningListeners = new Set<(listening: boolean) => void>();
  private readonly waiters = new Set<(s: Submission) => void>();

  constructor(public cwd: string) {}

  subscribe(fn: (thread: Thread) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get listening(): boolean {
    return this.waiters.size > 0;
  }

  subscribeListening(fn: (listening: boolean) => void): () => void {
    this.listeningListeners.add(fn);
    return () => this.listeningListeners.delete(fn);
  }

  restore(threads: Thread[], submissions: Submission[], read: number): void {
    for (const c of threads.flatMap((t) => t.comments)) {
      if (c.status !== "pending") continue;
      c.status = "error";
      c.body = STOPPED;
      c.activity = null;
    }
    this.threads.push(...threads);
    this.submissions.push(...submissions);
    this.read = read;
  }

  markRead(): void {
    this.read = this.submissions.length;
    this.onChange();
  }

  create(anchor: ThreadAnchor, snippet: string, context: ThreadContext | null, body: string, single: boolean): Thread {
    const thread: Thread = { id: newId(), rev: 0, anchor, snippet, context, comments: [] };
    this.threads.push(thread);
    this.addComment(thread, body, single);
    return thread;
  }

  addNote(anchor: ThreadAnchor, snippet: string, context: ThreadContext | null, body: string, noteOf: string): void {
    const thread: Thread = { id: newId(), rev: 0, anchor, snippet, context, comments: [comment("claude", body, "done")], noteOf };
    this.threads.push(thread);
    this.emit(thread);
  }

  removeNotes(noteOf: string): void {
    for (const thread of this.threads.filter((t) => t.noteOf === noteOf && t.comments.every((c) => c.author === "claude"))) {
      this.threads.splice(this.threads.indexOf(thread), 1);
      thread.comments = [];
      this.emit(thread);
    }
  }

  reply(threadId: string, body: string, single: boolean): Thread | null {
    const thread = this.find(threadId);
    if (thread) this.addComment(thread, body, single);
    return thread;
  }

  edit(threadId: string, commentId: string, body: string): Thread | null {
    const thread = this.find(threadId);
    const c = thread?.comments.find((x) => x.id === commentId && x.author === "user");
    if (!thread || !c) return null;
    c.body = body;
    c.editedAt = now();
    this.emit(thread);
    return thread;
  }

  remove(threadId: string, commentId: string): Thread | null {
    const thread = this.find(threadId);
    const i = thread?.comments.findIndex((x) => x.id === commentId && x.author === "user") ?? -1;
    if (!thread || i < 0) return null;
    if (i === 0) {
      this.threads.splice(this.threads.indexOf(thread), 1);
      thread.comments = [];
    } else {
      thread.comments.splice(i, 1);
    }
    this.emit(thread);
    return thread;
  }

  replyFromSession(threadId: string, body: string): void {
    const thread = this.find(threadId);
    if (!thread) return;
    thread.comments.push(comment("claude", body, "done"));
    this.emit(thread);
  }

  submit(body: string): { submission: Submission; delivered: boolean; threads: Thread[] } | null {
    const changed = this.threads.filter((t) => t.comments.some((c) => c.draft));
    if (!changed.length && !body) return null;
    const submission = this.newSubmission(body);
    for (const t of changed) {
      for (const c of t.comments) {
        if (!c.draft) continue;
        c.draft = false;
        c.review = submission.n;
      }
      this.emit(t);
    }
    return { submission, delivered: this.wake(submission), threads: changed };
  }

  waitForReview(after: number, onReview: (s: Submission) => void): () => void {
    const latest = this.submissions.at(-1);
    if (latest && latest.n > after) {
      onReview(latest);
      return () => {};
    }

    this.waiters.add(onReview);
    if (this.waiters.size === 1) this.emitListening();
    return () => {
      if (this.waiters.delete(onReview) && this.waiters.size === 0) this.emitListening();
    };
  }

  private find(threadId: string): Thread | null {
    return this.threads.find((t) => t.id === threadId) ?? null;
  }

  private newSubmission(body: string): Submission {
    const submission: Submission = { n: this.submissions.length + 1, body, submittedAt: now() };
    this.submissions.push(submission);
    this.onChange();
    return submission;
  }

  private wake(submission: Submission): boolean {
    const delivered = this.waiters.size > 0;
    for (const wake of this.waiters) wake(submission);
    this.waiters.clear();
    if (delivered) this.emitListening();
    return delivered;
  }

  private emitListening(): void {
    for (const fn of this.listeningListeners) fn(this.listening);
  }

  private emit(thread: Thread): void {
    thread.rev++;
    for (const fn of this.listeners) fn(thread);
    this.onChange();
  }

  private addComment(thread: Thread, body: string, single: boolean): void {
    const c = comment("user", body, "done");
    thread.comments.push(c);
    const asking = MENTION.test(body);
    const submission = !asking && single ? this.newSubmission("") : null;
    if (asking) this.answer(thread);
    c.draft = !asking && !single;
    c.review = submission?.n ?? null;
    this.emit(thread);
    if (submission) this.wake(submission);
  }

  private answer(thread: Thread): void {
    const prompt = buildPrompt(thread);
    const reply = comment("claude", "", "pending");
    reply.activity = "Waiting";
    thread.comments.push(reply);
    this.queue = this.queue.then(() => this.run(thread, reply, prompt));
  }

  private async run(thread: Thread, reply: ThreadComment, prompt: string): Promise<void> {
    if (!this.threads.includes(thread)) return;
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
      const parent = this.parentSession;
      const known = this.fork?.parent === parent ? this.fork : null;
      const forking = known === null && parent !== null;
      let note = "";
      let res;

      try {
        res = await ask({ cwd: this.cwd, resume: known ? known.session : parent, fork: forking, prompt, onText, onActivity });
      } catch (err) {
        if (!forking) throw err;
        note = `_Answered without the original conversation, because it could not be resumed: ${errorMessage(err)}_\n\n`;
        res = await ask({ cwd: this.cwd, resume: null, fork: false, prompt, onText, onActivity });
        this.fork = { parent, session: res.sessionId };
      }

      if (res.sessionId) this.fork = { parent, session: res.sessionId };
      reply.body = note + res.text;
      reply.status = "done";
    } catch (err) {
      reply.body = errorMessage(err);
      reply.status = "error";
    }

    reply.activity = null;
    this.emit(thread);
  }
}

function comment(author: ThreadComment["author"], body: string, status: ThreadComment["status"]): ThreadComment {
  return { id: newId(), author, body, status, activity: null, createdAt: now(), draft: false, review: null, editedAt: null };
}

function buildPrompt(thread: Thread): string {
  const history = thread.comments
    .filter((c) => c.status === "done")
    .map((c) => `${c.author === "user" ? "User" : "Claude"}: ${c.body}`)
    .join("\n\n");
  const [intro, ...context] = promptContext(thread.anchor, thread.snippet);
  return [intro, ANSWER, ...context, "", "Thread:", history].join("\n");
}

function promptContext(anchor: ThreadAnchor, snippet: string): [string, ...string[]] {
  if (anchor.path === null) {
    const topic = `the topic "${anchor.topic}" of ${describeComparison(anchor.compare)}`;
    return [
      `${REVIEWING}, where you grouped the changes into topics. They wrote in a comment thread on ${topic} as a whole.`,
      "",
      "The topic:",
      snippet,
    ];
  }

  const version = anchor.commit
    ? ` as of commit ${anchor.commit}. The files on disk are the working tree and can differ from that commit`
    : anchor.side !== "old"
      ? " in the working tree"
      : "";
  if (anchor.side === null) {
    return [`${REVIEWING}. They wrote in a comment thread on the whole file ${anchor.path}${version}, not on particular lines.`];
  }
  return [
    `${REVIEWING}. They selected ${lineRange(anchor)} of the ${anchor.side} version of ${anchor.path}${version}. They wrote in a comment thread on these lines.`,
    "",
    "Selected lines:",
    "```",
    snippet,
    "```",
  ];
}
