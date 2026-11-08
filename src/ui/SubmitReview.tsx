import { type FormEvent, useEffect, useRef, useState } from "react";
import { focusInPlace } from "./anchor";
import { CopyButton } from "./FileCard";

/** What to tell Claude when it was not waiting. get_review_comments is the tool it reaches for. */
const ASK = "address my review comments";

interface Props {
  drafts: number;
  /** Whether Claude is waiting for a review right now, so submitting starts it at once. */
  listening: boolean;
  /** Resolves to whether Claude was waiting for the review. */
  onSubmit: (body: string) => Promise<boolean>;
}

export function SubmitReview({ drafts, listening, onSubmit }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [delivered, setDelivered] = useState<boolean | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Escape is heard on the whole page: once a review is sent, the button that had the focus is gone.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const toggle = () => {
    setOpen((o) => !o);
    setDelivered(null);
    setError(null);
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy || (!drafts && !text.trim())) return;
    setBusy(true);
    setError(null);
    try {
      setDelivered(await onSubmit(text.trim()));
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
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
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit();
                }}
              />
              <div className="comment-form-actions">
                <span className="comment-hint">
                  {drafts ? `${drafts} pending comment${drafts === 1 ? "" : "s"}` : "No pending comments"}
                </span>
                <button type="submit" className="button primary" disabled={busy || (!drafts && !text.trim())}>
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
