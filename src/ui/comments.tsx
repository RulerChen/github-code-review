import { createContext, type FormEvent, useContext, useEffect, useRef, useState } from "react";
import { MENTION } from "../shared/comments";
import type { Thread, ThreadAnchor } from "../shared/types";
import { Markdown } from "./Markdown";

export interface RevealRequest {
  thread: Thread;
  reply: boolean;
}

export interface CommentsApi {
  /** The commit each side of the diff comes from, or null for the working tree. */
  versions: Record<ThreadAnchor["side"], string | null>;
  threadsFor: (path: string) => Thread[];
  create: (anchor: Omit<ThreadAnchor, "commit">, snippet: string, body: string) => Promise<void>;
  reply: (threadId: string, body: string) => Promise<void>;
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
  create: async () => {},
  reply: async () => {},
  unread: () => 0,
  markRead: () => {},
  current: null,
  revealSeq: 0,
  peekReveal: () => null,
  takeReveal: () => null,
});

export const useComments = () => useContext(CommentsContext);

export function anchorLabel(anchor: ThreadAnchor, withVersion = false): string {
  const side = anchor.side === "old" ? "Old" : "New";
  const lines = anchor.start === anchor.end ? `${side} line ${anchor.start}` : `${side} lines ${anchor.start}–${anchor.end}`;
  if (!withVersion) return lines;
  return anchor.commit ? `${lines} at ${anchor.commit.slice(0, 7)}` : `${lines} in the working tree`;
}

/** Comments before the first pending answer: the ones the reader can have seen. */
export function readableCount(thread: Thread): number {
  const i = thread.comments.findIndex((c) => c.status === "pending");
  return i < 0 ? thread.comments.length : i;
}

/** Whether a thread's lines come from the version of the file shown on its side of the diff. */
export const onShownVersion = (thread: Thread, versions: CommentsApi["versions"]) => thread.anchor.commit === versions[thread.anchor.side];

interface FormProps {
  placeholder: string;
  /** The label when the comment mentions @claude. Other comments go into the pending review. */
  submitLabel: string;
  onSubmit: (body: string) => Promise<void>;
  onCancel: () => void;
}

export function CommentForm({ placeholder, submitLabel, onSubmit, onCancel }: FormProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const asking = MENTION.test(text);

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
    <form className="comment-form" onSubmit={submit}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        rows={3}
        autoFocus
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit();
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="comment-form-actions">
        <span className="comment-hint">
          {asking ? "Claude answers here right away." : "Goes into your review for Claude to address. Mention @claude to ask a question instead."}
        </span>
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button primary" disabled={busy || !text.trim()}>
          {asking ? submitLabel : "Add review comment"}
        </button>
      </div>
      {error && <p className="comment-error">{error}</p>}
    </form>
  );
}

export function ThreadView({ thread, withVersion = false }: { thread: Thread; withVersion?: boolean }) {
  const { reply, unread, markRead, current, revealSeq, takeReveal } = useComments();
  const [replying, setReplying] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unreadCount = unread(thread);

  useEffect(() => {
    const request = takeReveal(thread.id);
    if (!request) return;
    ref.current?.scrollIntoView({ block: "center" });
    if (request.reply) setReplying(true);
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

  return (
    <div ref={ref} className={`thread${current === thread.id ? " is-current" : ""}`} data-thread={thread.id}>
      <div className="thread-head">{anchorLabel(thread.anchor, withVersion)}</div>
      {thread.comments.map((c) => (
        <div key={c.id} className={`comment comment-${c.author}`}>
          <div className="comment-author">
            {c.author === "claude" ? "Claude" : "You"}
            {c.draft && <span className="pending-label">Pending</span>}
          </div>
          {c.status === "error" ? <p className="comment-error">{c.body}</p> : c.body && <Markdown text={c.body} />}
          {c.status === "pending" && <p className="comment-activity">{c.activity ? `${c.activity}…` : "Writing…"}</p>}
        </div>
      ))}
      {replying ? (
        <CommentForm
          placeholder="Reply…"
          submitLabel="Reply"
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
  );
}
