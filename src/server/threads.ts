import { randomBytes } from "node:crypto";
import { MENTION } from "../shared/comments.js";
import type { Thread, ThreadAnchor, ThreadComment } from "../shared/types.js";
import { ask } from "./claude.js";

const EMIT_INTERVAL_MS = 100;

const newId = () => randomBytes(6).toString("base64url");

/** The draft comments the user submitted at once, with an optional comment on the whole review. */
export interface Submission {
  n: number;
  body: string;
  submittedAt: string;
}

export class RepoThreads {
  readonly threads: Thread[] = [];
  readonly submissions: Submission[] = [];
  cwd: string;
  parentSession: string | null = null;
  private fork: { parent: string | null; session: string | null } | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(thread: Thread) => void>();
  private readonly listeningListeners = new Set<(listening: boolean) => void>();
  private readonly waiters = new Set<(s: Submission) => void>();

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  subscribe(fn: (thread: Thread) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Whether Claude is running the wait command, so a submitted review reaches it at once. */
  get listening(): boolean {
    return this.waiters.size > 0;
  }

  /** Calls fn whenever `listening` changes. */
  subscribeListening(fn: (listening: boolean) => void): () => void {
    this.listeningListeners.add(fn);
    return () => this.listeningListeners.delete(fn);
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

  /** Changes the text of a comment the user wrote. It does not ask Claude again. */
  edit(threadId: string, commentId: string, body: string): Thread | null {
    const thread = this.threads.find((t) => t.id === threadId);
    const c = thread?.comments.find((x) => x.id === commentId && x.author === "user");
    if (!thread || !c) return null;
    c.body = body;
    c.editedAt = new Date().toISOString();
    this.emit(thread);
    return thread;
  }

  /**
   * Deletes a comment the user wrote. Deleting the first one deletes the thread with its replies: the page gets
   * the thread with no comments and drops it.
   */
  remove(threadId: string, commentId: string): Thread | null {
    const thread = this.threads.find((t) => t.id === threadId);
    const i = thread ? thread.comments.findIndex((x) => x.id === commentId && x.author === "user") : -1;
    if (!thread || i < 0) return null;
    if (i === 0) {
      this.threads.splice(this.threads.indexOf(thread), 1);
      // A new array, so an answer still being written goes into the old one and stays out of the page.
      thread.comments = [];
    } else {
      thread.comments.splice(i, 1);
    }
    this.emit(thread);
    return thread;
  }

  /** A reply from the Claude Code session that addressed the review. */
  replyFromSession(threadId: string, body: string): boolean {
    const thread = this.threads.find((t) => t.id === threadId);
    if (!thread) return false;
    thread.comments.push(comment("claude", body, "done"));
    this.emit(thread);
    return true;
  }

  /** Submits every draft comment as one review and wakes whoever waits for it. Null when there is nothing to submit. */
  submit(body: string): { submission: Submission; delivered: boolean; threads: Thread[] } | null {
    const changed = this.threads.filter((t) => t.comments.some((c) => c.draft));
    if (!changed.length && !body) return null;
    const submission: Submission = { n: this.submissions.length + 1, body, submittedAt: new Date().toISOString() };
    this.submissions.push(submission);
    for (const t of changed) {
      for (const c of t.comments) {
        if (!c.draft) continue;
        c.draft = false;
        c.review = submission.n;
      }
      this.emit(t);
    }
    const delivered = this.waiters.size > 0;
    for (const wake of this.waiters) wake(submission);
    this.waiters.clear();
    if (delivered) this.emitListening();
    return { submission, delivered, threads: changed };
  }

  /** Calls onReview once a review numbered above `after` is submitted, right away if one already is. Returns a function that stops waiting. */
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

  private emitListening(): void {
    for (const fn of this.listeningListeners) fn(this.listening);
  }

  private emit(thread: Thread): void {
    thread.rev++;
    for (const fn of this.listeners) fn(thread);
  }

  private addComment(thread: Thread, body: string): void {
    const asking = MENTION.test(body);
    const c = comment("user", body, "done");
    c.draft = !asking;
    thread.comments.push(c);
    if (asking) this.answer(thread);
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
    // The user deleted the thread while the question waited its turn.
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
      // A fork belongs to the parent session it came from. When a viewer is opened from another
      // session, the old fork no longer matches and the next question forks the new parent.
      const parent = this.parentSession;
      const known = this.fork?.parent === parent ? this.fork : null;
      const forking = known === null && parent !== null;
      let note = "";
      let res;
      try {
        res = await ask({ cwd: this.cwd, resume: known ? known.session : parent, fork: forking, prompt, onText, onActivity });
      } catch (err) {
        if (!forking) throw err;
        note = `_Answered without the original conversation, because it could not be resumed: ${errorText(err)}_\n\n`;
        res = await ask({ cwd: this.cwd, resume: null, fork: false, prompt, onText, onActivity });
        // Even without a session to resume, remember that this parent cannot be forked, so later questions do not retry it.
        this.fork = { parent, session: res.sessionId };
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
  return { id: newId(), author, body, status, activity: null, createdAt: new Date().toISOString(), draft: false, review: null, editedAt: null };
}

function buildPrompt(thread: Thread): string {
  const { anchor } = thread;
  const version = anchor.commit
    ? ` as of commit ${anchor.commit}. The files on disk are the working tree and can differ from that commit`
    : anchor.side !== "old"
      ? " in the working tree"
      : "";
  const history = thread.comments
    .filter((c) => c.status === "done")
    .map((c) => `${c.author === "user" ? "User" : "Claude"}: ${c.body}`)
    .join("\n\n");
  const answer = "Answer the last comment directly and concisely, in the language it is written in, using Markdown. You can read files to check details, but do not change anything.";
  if (anchor.path === null) {
    return [
      `The user is reviewing the code changes in a diff viewer, where you grouped the changes into topics. They wrote in a comment thread on the topic "${anchor.topic}" as a whole.`,
      answer,
      "",
      "The topic:",
      thread.snippet,
      "",
      "Thread:",
      history,
    ].join("\n");
  }
  if (anchor.side === null) {
    return [
      `The user is reviewing the code changes in a diff viewer. They wrote in a comment thread on the whole file ${anchor.path}${version}, not on particular lines.`,
      answer,
      "",
      "Thread:",
      history,
    ].join("\n");
  }
  const lines = anchor.start === anchor.end ? `line ${anchor.start}` : `lines ${anchor.start}-${anchor.end}`;
  return [
    `The user is reviewing the code changes in a diff viewer. They selected ${lines} of the ${anchor.side} version of ${anchor.path}${version}. They wrote in a comment thread on these lines.`,
    answer,
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
