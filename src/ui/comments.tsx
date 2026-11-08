import { createContext, type FormEvent, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MENTION } from "../shared/comments";
import type { FileAnchor, LineAnchor, Thread, ThreadAnchor, ThreadComment, TopicAnchor } from "../shared/types";
import { pin } from "./anchor";
import { Markdown } from "./Markdown";

export interface RevealRequest {
  thread: Thread;
}

/** An anchor before the page fills in the commit it is on. A topic has no commit. */
export type NewAnchor = Omit<LineAnchor, "commit"> | Omit<FileAnchor, "commit"> | Omit<TopicAnchor, "compare">;

export interface CommentsApi {
  /** The commit each side of the diff comes from, or null for the working tree. */
  versions: Record<LineAnchor["side"], string | null>;
  threadsFor: (path: string) => Thread[];
  threadsForTopic: (title: string) => Thread[];
  create: (anchor: NewAnchor, snippet: string, body: string) => Promise<void>;
  reply: (threadId: string, body: string) => Promise<void>;
  edit: (threadId: string, commentId: string, body: string) => Promise<void>;
  remove: (threadId: string, commentId: string) => Promise<void>;
  unread: (thread: Thread) => number;
  markRead: (thread: Thread) => void;
  current: string | null;
  /** Bumped on every reveal, so collapsed files and topics can open and the thread can scroll into view. */
  revealSeq: number;
  peekReveal: () => RevealRequest | null;
  takeReveal: (threadId: string) => RevealRequest | null;
}

export const CommentsContext = createContext<CommentsApi>({
  versions: { old: null, new: null },
  threadsFor: () => [],
  threadsForTopic: () => [],
  create: async () => {},
  reply: async () => {},
  edit: async () => {},
  remove: async () => {},
  unread: () => 0,
  markRead: () => {},
  current: null,
  revealSeq: 0,
  peekReveal: () => null,
  takeReveal: () => null,
});

export const useComments = () => useContext(CommentsContext);

export function anchorLabel(anchor: ThreadAnchor, withVersion = false): string {
  if (anchor.path === null) return `Topic “${anchor.topic}”`;
  if (anchor.side === null) return "Whole file";
  const side = anchor.side === "old" ? "Old" : "New";
  const lines = anchor.start === anchor.end ? `${side} line ${anchor.start}` : `${side} lines ${anchor.start}–${anchor.end}`;
  if (!withVersion) return lines;
  return anchor.commit ? `${lines} at ${anchor.commit.slice(0, 7)}` : `${lines} in the working tree`;
}

/**
 * What the first comment's header says about where the thread is. In the diff a thread sits under the last line on
 * its side, so only a range needs saying. A thread on lines the diff does not show says the side and version too.
 */
function whereText(anchor: ThreadAnchor, withVersion: boolean): string | null {
  if (anchor.path === null || anchor.side === null) return null;
  if (withVersion) return `on ${anchorLabel(anchor, true).toLowerCase()}`;
  return anchor.start === anchor.end ? null : `on lines ${anchor.start}–${anchor.end}`;
}

/** Comments before the first pending answer: the ones the reader can have seen. */
export function readableCount(thread: Thread): number {
  const i = thread.comments.findIndex((c) => c.status === "pending");
  return i < 0 ? thread.comments.length : i;
}

/** Whether a thread's lines come from the version of the file shown on its side of the diff. A comment on the whole file or a topic always does. */
export const onShownVersion = (thread: Thread, versions: CommentsApi["versions"]) =>
  thread.anchor.side === null || thread.anchor.commit === versions[thread.anchor.side];

interface FormProps {
  placeholder: string;
  /** The text to start from when editing a comment. */
  initial?: string;
  /** Editing saves the text and nothing else. A new comment asks Claude or goes into the pending review. */
  editing?: boolean;
  onSubmit: (body: string) => Promise<void>;
  onCancel: () => void;
}

export function CommentForm({ placeholder, initial = "", editing = false, onSubmit, onCancel }: FormProps) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const asking = !editing && MENTION.test(text);
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // Focusing would scroll the field to the middle of the screen. Scroll only as far as it takes to show the form.
  useLayoutEffect(() => {
    const el = input.current;
    el?.focus({ preventScroll: true });
    el?.setSelectionRange(el.value.length, el.value.length);
    form.current?.scrollIntoView({ block: "nearest" });
  }, []);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(text.trim());
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="comment-form" onSubmit={submit} ref={form}>
      <textarea
        ref={input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        rows={3}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit();
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="comment-form-actions">
        {editing ? (
          <span className="comment-hint" />
        ) : (
          <Either
            className="comment-hint"
            first={asking}
            a="Claude answers here right away."
            b="Goes into your review. Mention @claude to get an answer now."
          />
        )}
        <span className="comment-form-buttons">
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={busy || !text.trim() || (editing && text.trim() === initial)}>
            {editing ? "Save" : <Either first={asking} a="Ask Claude" b="Add review comment" />}
          </button>
        </span>
      </div>
      {error && <p className="comment-error">{error}</p>}
    </form>
  );
}

/** Shows one of two texts in a box sized for the longer, so switching between them moves nothing around it. */
function Either({ first, a, b, className }: { first: boolean; a: string; b: string; className?: string }) {
  return (
    <span className={`either${className ? ` ${className}` : ""}`}>
      <span aria-hidden={!first}>{a}</span>
      <span aria-hidden={first}>{b}</span>
    </span>
  );
}

/** Rings the thread for a moment after a jump, so the eye finds where it landed. */
function flash(el: HTMLElement): void {
  el.classList.remove("is-flash");
  void el.offsetWidth;
  el.classList.add("is-flash");
  const done = (e: AnimationEvent) => {
    if (e.animationName !== "thread-flash") return;
    el.classList.remove("is-flash");
    el.removeEventListener("animationend", done);
  };
  el.addEventListener("animationend", done);
}

export function ThreadView({ thread, withVersion = false }: { thread: Thread; withVersion?: boolean }) {
  const { reply, unread, markRead, revealSeq, takeReveal } = useComments();
  const [replying, setReplying] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unreadCount = unread(thread);

  // The thread goes to the middle of the screen and stays there while the files around it mount. A copy in a
  // hidden tab leaves the request to the one on screen.
  useEffect(() => {
    const el = ref.current;
    if (!el || el.getClientRects().length === 0 || !takeReveal(thread.id)) return;
    el.scrollIntoView({ block: "center" });
    flash(el);
    return pin(el);
  }, [revealSeq]);

  // An answer counts as read once its thread is on screen while the page is in front.
  useEffect(() => {
    const el = ref.current;
    if (!el || unreadCount === 0) return;
    let inView = false;
    const check = () => {
      if (inView && document.visibilityState === "visible") markRead(thread);
    };
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry?.isIntersecting ?? false;
      check();
    });
    observer.observe(el);
    document.addEventListener("visibilitychange", check);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", check);
    };
  }, [thread, unreadCount, markRead]);

  const where = whereText(thread.anchor, withVersion);
  return (
    <div ref={ref} className="thread" data-thread={thread.id}>
      {thread.comments.map((c, i) => (
        <CommentView key={c.id} thread={thread} comment={c} where={i === 0 ? where : null} />
      ))}
      <div className="thread-foot">
        {replying ? (
          <CommentForm
            placeholder="Reply…"
            onSubmit={async (body) => {
              await reply(thread.id, body);
              setReplying(false);
            }}
            onCancel={() => setReplying(false)}
          />
        ) : (
          <button className="thread-reply" onClick={() => setReplying(true)}>
            Reply…
          </button>
        )}
      </div>
    </div>
  );
}

function CommentView({ thread, comment: c, where }: { thread: Thread; comment: ThreadComment; where: string | null }) {
  const { edit, remove } = useComments();
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const mine = c.author === "user";
  // Deleting the first comment deletes the thread, answers and all.
  const takesThread = thread.comments[0]?.id === c.id && thread.comments.length > 1;
  return (
    <div className={`comment comment-${c.author}`}>
      <div className="comment-head">
        <span className="comment-author">{c.author === "claude" ? "Claude" : "You"}</span>
        {where && <span className="comment-where">{where}</span>}
        {c.draft && <span className="pending-label">Pending</span>}
        {c.editedAt && <span className="comment-edited">edited</span>}
        {mine && mode === "view" && (
          <span className="comment-actions">
            <button className="icon-button small" onClick={() => setMode("edit")} aria-label="Edit comment" title="Edit">
              <PencilIcon />
            </button>
            <button className="icon-button small" onClick={() => setMode("delete")} aria-label="Delete comment" title="Delete">
              <TrashIcon />
            </button>
          </span>
        )}
      </div>
      {mode === "edit" ? (
        <CommentForm
          placeholder="Edit comment"
          initial={c.body}
          editing
          onSubmit={async (body) => {
            await edit(thread.id, c.id, body);
            setMode("view");
          }}
          onCancel={() => setMode("view")}
        />
      ) : (
        <>
          {c.status === "error" ? <p className="comment-error">{c.body}</p> : c.body && <Markdown text={c.body} />}
          {c.status === "pending" && <p className="comment-activity">{c.activity ? `${c.activity}…` : "Writing…"}</p>}
        </>
      )}
      {mode === "delete" && (
        <ConfirmDelete
          message={takesThread ? "Delete this conversation and its replies?" : "Delete this comment?"}
          onCancel={() => setMode("view")}
          onConfirm={() => remove(thread.id, c.id)}
        />
      )}
    </div>
  );
}

function ConfirmDelete({ message, onCancel, onConfirm }: { message: string; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => cancel.current?.focus({ preventScroll: true }), []);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  return (
    <div className="comment-confirm" role="alertdialog" aria-label={message} onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <span className="comment-confirm-text">{message}</span>
      <button ref={cancel} className="button" onClick={onCancel}>
        Cancel
      </button>
      <button className="button danger" onClick={() => void confirm()} disabled={busy}>
        Delete
      </button>
      {error && <p className="comment-error">{error}</p>}
    </div>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M10.75 2.75l2.5 2.5L5.5 13H3v-2.5l7.75-7.75ZM9.25 4.25l2.5 2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M2.75 4.25h10.5M6.25 4.25v-1.5h3.5v1.5M4.25 4.25l.6 8.6a1 1 0 0 0 1 .9h4.3a1 1 0 0 0 1-.9l.6-8.6M6.75 7v4M9.25 7v4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
