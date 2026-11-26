import { randomBytes } from "node:crypto";
import type { SessionStatus, Thread, ThreadAnchor, ThreadComment, ThreadContext } from "../shared/types.js";

const newId = () => randomBytes(6).toString("base64url");
const now = () => new Date().toISOString();

export interface Submission {
  n: number;
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

  create(anchor: ThreadAnchor, snippet: string, context: ThreadContext | null, body: string): Thread {
    const thread: Thread = { id: newId(), rev: 0, anchor, snippet, context, comments: [] };
    this.threads.push(thread);
    this.addComment(thread, body);
    return thread;
  }

  reply(threadId: string, body: string): Thread | null {
    const thread = this.find(threadId);
    if (thread) this.addComment(thread, body);
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

  private newSubmission(): Submission {
    const submission: Submission = { n: this.submissions.length + 1, submittedAt: now() };
    this.submissions.push(submission);
    this.onChange();
    return submission;
  }

  private wake(submission: Submission): void {
    if (!this.waiters.size) return;
    for (const wake of this.waiters) wake(submission);
    this.waiters.clear();
    this.workingSince = now();
    this.emitStatus();
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

  private addComment(thread: Thread, body: string): void {
    const submission = this.newSubmission();
    thread.comments.push({ ...comment("user", body), review: submission.n });
    this.emit(thread);
    this.wake(submission);
  }
}

function comment(author: ThreadComment["author"], body: string): ThreadComment {
  return { id: newId(), author, body, createdAt: now(), review: null, editedAt: null };
}
