import { randomBytes } from "node:crypto";
import type { SessionStatus, Thread, ThreadAnchor, ThreadComment, ThreadContext } from "../shared/types.js";

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

  private workingSince: string | null = null;
  private readonly listeners = new Set<(thread: Thread) => void>();
  private readonly statusListeners = new Set<(status: SessionStatus) => void>();
  private readonly waiters = new Set<(s: Submission) => void>();

  constructor(public cwd: string) {}

  subscribe(fn: (thread: Thread) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get status(): SessionStatus {
    return { listening: this.waiters.size > 0, workingSince: this.workingSince, read: this.read };
  }

  subscribeStatus(fn: (status: SessionStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  restore(threads: Thread[], submissions: Submission[], read: number): void {
    this.threads.push(...threads);
    this.submissions.push(...submissions);
    this.read = read;
  }

  markRead(): void {
    if (this.read === this.submissions.length) return;
    this.read = this.submissions.length;
    this.workingSince ??= now();
    this.onChange();
    this.emitStatus();
  }

  create(anchor: ThreadAnchor, snippet: string, context: ThreadContext | null, body: string, single: boolean): Thread {
    const thread: Thread = { id: newId(), rev: 0, anchor, snippet, context, comments: [] };
    this.threads.push(thread);
    this.addComment(thread, body, single);
    return thread;
  }

  addNote(anchor: ThreadAnchor, snippet: string, context: ThreadContext | null, body: string, noteOf: string): void {
    const thread: Thread = { id: newId(), rev: 0, anchor, snippet, context, comments: [comment("claude", body)], noteOf };
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
    thread.comments.push(comment("claude", body));
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
      this.workingSince = now();
      this.emitStatus();
      return () => {};
    }

    this.waiters.add(onReview);
    this.workingSince = null;
    if (this.waiters.size === 1) this.emitStatus();
    return () => {
      if (this.waiters.delete(onReview) && this.waiters.size === 0) this.emitStatus();
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
    if (delivered) {
      this.workingSince = now();
      this.emitStatus();
    }
    return delivered;
  }

  private emitStatus(): void {
    const status = this.status;
    for (const fn of this.statusListeners) fn(status);
  }

  private emit(thread: Thread): void {
    thread.rev++;
    for (const fn of this.listeners) fn(thread);
    this.onChange();
  }

  private addComment(thread: Thread, body: string, single: boolean): void {
    const c = comment("user", body);
    thread.comments.push(c);
    const submission = single ? this.newSubmission("") : null;
    c.draft = !single;
    c.review = submission?.n ?? null;
    this.emit(thread);
    if (submission) this.wake(submission);
  }
}

function comment(author: ThreadComment["author"], body: string): ThreadComment {
  return { id: newId(), author, body, createdAt: now(), draft: false, review: null, editedAt: null };
}
