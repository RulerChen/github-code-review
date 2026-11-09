import { type FormEvent, useRef, useState } from "react";
import { plural } from "../shared/util";
import { focusInPlace } from "./anchor";
import { CopyButton } from "./controls";
import { useAction, useDismiss } from "./hooks";

const ASK = "address my review comments";

interface Props {
  drafts: number;
  listening: boolean;
  onSubmit: (body: string) => Promise<boolean>;
}

export function SubmitReview({ drafts, listening, onSubmit }: Props) {
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
        Submit review
        {drafts > 0 && <span className="counter">{drafts}</span>}
      </button>
      {open && (
        <div className="review-popover" role="dialog" aria-label="Finish your review">
          <div className="picker-title">Finish your review</div>
          {delivered === null ? (
            <form className="comment-form" onSubmit={submit}>
              <p className={`review-status${listening ? " is-listening" : ""}`}>
                <span className="status-dot" aria-hidden="true" />
                {listening
                  ? "Claude is waiting for this review and starts on it as soon as you submit."
                  : "Claude isn't waiting for a review right now. Submitting saves it, and Claude works on it once you ask in the terminal."}
              </p>
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
          ) : (
            <div className="review-sent">
              <p>Review saved. Claude wasn't waiting for one, so nothing has started yet. To start, tell Claude in the terminal:</p>
              <p className="review-ask">
                <code>{ASK}</code>
                <CopyButton text={ASK} label="Copy" />
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
