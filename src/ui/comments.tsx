import { createContext, type FormEvent, useContext, useState } from "react";
import type { Thread, ThreadAnchor } from "../shared/types";
import { Markdown } from "./Markdown";

export interface CommentsApi {
  threadsFor: (path: string) => Thread[];
  create: (anchor: ThreadAnchor, snippet: string, body: string) => Promise<void>;
  reply: (threadId: string, body: string) => Promise<void>;
}

export const CommentsContext = createContext<CommentsApi>({
  threadsFor: () => [],
  create: async () => {},
  reply: async () => {},
});

export const useComments = () => useContext(CommentsContext);

export function anchorLabel(anchor: ThreadAnchor): string {
  const side = anchor.side === "old" ? "Old" : "New";
  return anchor.start === anchor.end ? `${side} line ${anchor.start}` : `${side} lines ${anchor.start}–${anchor.end}`;
}

interface FormProps {
  placeholder: string;
  submitLabel: string;
  onSubmit: (body: string) => Promise<void>;
  onCancel: () => void;
}

export function CommentForm({ placeholder, submitLabel, onSubmit, onCancel }: FormProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        <span className="comment-hint">Mention @claude to ask Claude about these lines.</span>
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button primary" disabled={busy || !text.trim()}>
          {submitLabel}
        </button>
      </div>
      {error && <p className="comment-error">{error}</p>}
    </form>
  );
}

export function ThreadView({ thread }: { thread: Thread }) {
  const { reply } = useComments();
  const [replying, setReplying] = useState(false);

  return (
    <div className="thread">
      <div className="thread-head">{anchorLabel(thread.anchor)}</div>
      {thread.comments.map((c) => (
        <div key={c.id} className={`comment comment-${c.author}`}>
          <div className="comment-author">{c.author === "claude" ? "Claude" : "You"}</div>
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
