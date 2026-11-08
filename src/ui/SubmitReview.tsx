import { type FormEvent, useEffect, useRef, useState } from "react";

interface Props {
  drafts: number;
  /** Resolves to whether Claude was waiting for the review. */
  onSubmit: (body: string) => Promise<boolean>;
}

export function SubmitReview({ drafts, onSubmit }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [delivered, setDelivered] = useState<boolean | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
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
    <div className="review-menu" ref={ref} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <button className={`button${drafts ? " primary" : ""}`} onClick={toggle} aria-expanded={open}>
        Submit review
        {drafts > 0 && <span className="counter">{drafts}</span>}
      </button>
      {open && (
        <div className="review-popover" role="dialog" aria-label="Finish your review">
          <div className="picker-title">Finish your review</div>
          {delivered === null ? (
            <form className="comment-form" onSubmit={submit}>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Leave a comment on the whole review (optional)"
                rows={4}
                autoFocus
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
          ) : (
            <p className="review-sent">
              {delivered
                ? "Sent. Claude is addressing your review in the terminal and will reply on each thread."
                : "Submitted, but Claude is not waiting for a review. Ask Claude in the terminal to address your review."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
