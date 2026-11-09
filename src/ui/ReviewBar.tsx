import { useEffect, useRef, useState } from "react";
import { describeComparison } from "../shared/comparison";
import type { Grouping, Review } from "../shared/types";
import { plural } from "../shared/util";
import { focusInPlace } from "./anchor";
import { refLabel } from "./Compare";
import { useAction, useDismiss } from "./hooks";
import { CaretIcon, CheckMark } from "./icons";
import { basename } from "./paths";

interface Props {
  reviews: Review[];
  review: Review | null;
  grouping: Grouping | null;
  repoRoot: string;
  hasChanges: boolean;
  onPick: (review: Review) => void;
  onGroup: (focus: string) => Promise<void>;
}

export function ReviewBar({ reviews, review, grouping, repoRoot, hasChanges, onPick, onGroup }: Props) {
  const [regrouping, setRegrouping] = useState(false);
  useEffect(() => setRegrouping(false), [review?.createdAt]);
  const running = grouping !== null && grouping.error === null;
  const form = hasChanges && !running && (review === null || regrouping);

  return (
    <div className="review-bar">
      {(reviews.length > 0 || review) && (
        <div className="review-bar-row">
          {reviews.length > 0 && <ReviewPicker reviews={reviews} current={review} repoRoot={repoRoot} onPick={onPick} />}
          {review?.focus && (
            <p className="focus" title={review.focus}>
              Focus: <strong>{review.focus}</strong>
            </p>
          )}
          <span className="spacer" />
          {review && hasChanges && !running && !regrouping && (
            <button className="button" onClick={() => setRegrouping(true)}>
              Group again
            </button>
          )}
        </div>
      )}
      {running && (
        <div className="group-card group-status" role="status">
          <span className="group-spinner" aria-hidden="true" />
          <div>
            <p>
              Claude is grouping the changes into topics
              {grouping.focus && (
                <>
                  {" "}
                  with the focus <strong>{grouping.focus}</strong>
                </>
              )}
              . This can take a few minutes, and you can keep reviewing meanwhile.
            </p>
            <p className="group-activity">{grouping.activity ?? "Working"}…</p>
          </div>
        </div>
      )}
      {grouping?.error && !running && (
        <p className="group-card group-error" role="alert">
          Could not group the changes: {grouping.error}
        </p>
      )}
      {form && (
        <GroupForm
          initial={regrouping ? (review?.focus ?? "") : (grouping?.focus ?? "")}
          explain={review === null}
          autoFocus={regrouping}
          onSubmit={async (focus) => {
            await onGroup(focus);
            setRegrouping(false);
          }}
          onCancel={review ? () => setRegrouping(false) : null}
        />
      )}
    </div>
  );
}

interface FormProps {
  initial: string;
  explain: boolean;
  autoFocus: boolean;
  onSubmit: (focus: string) => Promise<void>;
  onCancel: (() => void) | null;
}

function GroupForm({ initial, explain, autoFocus, onSubmit, onCancel }: FormProps) {
  const [focus, setFocus] = useState(initial);
  const { busy, error, run } = useAction(onSubmit);
  return (
    <form
      className="group-card group-form"
      onSubmit={(e) => {
        e.preventDefault();
        void run(focus.trim());
      }}
    >
      {explain && <p>Claude has not grouped this comparison into topics. It can do that now and explain each topic.</p>}
      <div className="group-form-row">
        <input
          className="filter"
          type="text"
          ref={autoFocus ? focusInPlace : undefined}
          placeholder="Focus, optional: what you want to review"
          aria-label="Focus"
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && onCancel) onCancel();
          }}
        />
        <button className="button primary" type="submit" disabled={busy}>
          Group into topics
        </button>
        {onCancel && (
          <button className="button" type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      {error && <p className="comment-error">{error}</p>}
    </form>
  );
}

interface PickerProps {
  reviews: Review[];
  current: Review | null;
  repoRoot: string;
  onPick: (review: Review) => void;
}

function ReviewPicker({ reviews, current, repoRoot, onPick }: PickerProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, open, () => setOpen(false));

  const otherRepos = reviews.some((r) => r.repo !== repoRoot);
  const newest = [...reviews].reverse();

  return (
    <div className="picker review-picker" ref={root}>
      <button className="picker-button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="picker-value">Reviews</span>
        <span className="counter">{reviews.length}</span>
        <CaretIcon />
      </button>
      {open && (
        <div className="picker-menu" role="dialog" aria-label="Reviews in this session">
          <div className="picker-title">Reviews in this session</div>
          <ul className="picker-list" role="listbox" aria-label="Reviews in this session">
            {newest.map((r) => {
              const selected = r === current;
              const time = new Date(r.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
              return (
                <li key={`${r.repo}\n${r.createdAt}`} role="option" aria-selected={selected}>
                  <button
                    className="review-item"
                    onClick={() => {
                      setOpen(false);
                      if (!selected) onPick(r);
                    }}
                  >
                    <CheckMark checked={selected} />
                    <span className="review-item-text">
                      <span className="picker-item-label">{r.focus ?? "No focus"}</span>
                      <span className="review-item-detail">
                        {otherRepos && `${basename(r.repo)} · `}
                        <code>{describeComparison(r.compare, refLabel)}</code> · {plural(r.topics.length, "topic")} · {time}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
