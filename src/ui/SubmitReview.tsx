import { type FormEvent, useRef, useState } from "react";
import type { Thread, ThreadComment } from "../shared/types";
import { plural } from "../shared/util";
import { focusInPlace } from "./anchor";
import { preview } from "./comments";
import { ThreadWhere } from "./Conversations";
import { useAction, useDismiss } from "./hooks";
import { AskInTerminal, type Claude } from "./Status";

const STATUS: Record<Claude, string> = {
  waiting: "Claude is waiting for this review and starts on it as soon as you submit.",
  working: "Claude is still working on what you sent before and picks this review up when it is done.",
  idle: "Claude isn't waiting for a review right now. Submitting saves it, and Claude works on it once you ask in the terminal.",
  gone: "The viewer can't be reached, so the review can't be submitted. If the Claude Code session ended, ask Claude to open the viewer again.",
};

interface Props {
  pending: { thread: Thread; comment: ThreadComment }[];
  state: Claude;
  onSubmit: (body: string) => Promise<boolean>;
  onOpen: (thread: Thread) => void;
}

export function SubmitReview({ pending, state, onSubmit, onOpen }: Props) {
  const drafts = pending.length;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [delivered, setDelivered] = useState<boolean | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  const { busy, error, run, clearError } = useAction(async (body: string) => {
    setDelivered(await onSubmit(body));
    setText("");
  });
  const ready = drafts > 0 || text.trim() !== "";

  const toggle = () => {
    setOpen((o) => !o);
    setDelivered(null);
    clearError();
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!busy && ready) void run(text.trim());
  };

  return (
    <div className="review-menu" ref={ref}>
      <button className={`button${drafts ? " primary" : ""}`} onClick={toggle} aria-expanded={open}>
        Submit
        {drafts > 0 && <span className="counter">{drafts}</span>}
      </button>
      {open && (
        <div className="review-popover" role="dialog" aria-label="Finish your review">
          <div className="picker-title">Finish your review</div>
          {delivered === null ? (
            <form className="comment-form" onSubmit={submit}>
              <p className={`review-status is-${state}`}>
                <span className="status-dot" aria-hidden="true" />
                {STATUS[state]}
              </p>
              {drafts > 0 && (
                <ul className="review-drafts" aria-label="Pending comments">
                  {pending.map(({ thread, comment }) => (
                    <li key={comment.id}>
                      <button
                        type="button"
                        className="review-draft"
                        title="Show this comment"
                        onClick={() => {
                          setOpen(false);
                          onOpen(thread);
                        }}
                      >
                        <ThreadWhere anchor={thread.anchor} />
                        <span className="conv-text">{preview(comment.body)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Leave a comment on the whole review (optional)"
                rows={4}
                ref={focusInPlace}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
                }}
              />
              <div className="comment-form-actions">
                <span className="comment-hint">{drafts ? plural(drafts, "pending comment") : "No pending comments"}</span>
                <button type="submit" className="button primary" disabled={busy || !ready}>
                  Submit review
                </button>
              </div>
              {error && <p className="comment-error">{error}</p>}
            </form>
          ) : delivered ? (
            <p className="review-sent">Review sent. Claude is working on it in the terminal and will reply on each thread here.</p>
          ) : state === "working" ? (
            <p className="review-sent">Review saved. Claude picks it up when it finishes what it is working on.</p>
          ) : (
            <div className="review-sent">
              <p>Review saved. Claude wasn't waiting for one, so nothing has started yet. To start, tell Claude in the terminal:</p>
              <AskInTerminal />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
