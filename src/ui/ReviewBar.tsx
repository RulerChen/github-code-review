import { useRef, useState } from "react";
import { describeComparison } from "../shared/comparison";
import type { Grouping, Review } from "../shared/types";
import { plural } from "../shared/util";
import { refLabel } from "./Compare";
import { useAction, useDismiss } from "./hooks";
import { CaretIcon, CheckMark, TrashIcon } from "./icons";
import { basename } from "./paths";

interface Props {
  reviews: Review[];
  review: Review | null;
  grouping: Grouping | null;
  repoRoot: string;
  hasChanges: boolean;
  onPick: (review: Review) => void;
  onGroup: (focus: string) => Promise<void>;
  onRemove: (review: Review) => Promise<void>;
}

export function ReviewBar({ reviews, review, grouping, repoRoot, hasChanges, onPick, onGroup, onRemove }: Props) {
  const running = grouping !== null && grouping.error === null;
  const { busy, error, run } = useAction(onGroup);
  const removing = useAction(onRemove);

  return (
    <div className="review-bar">
      {(reviews.length > 0 || review) && (
        <div className="review-bar-row">
          {reviews.length > 0 && (
            <ReviewPicker reviews={reviews} current={review} repoRoot={repoRoot} onPick={onPick} onRemove={removing.run} />
          )}
          {review?.focus && (
            <p className="focus" title={review.focus}>
              Focus: <strong>{review.focus}</strong>
            </p>
          )}
          <span className="spacer" />
          {review && hasChanges && !running && (
            <button
              className="button"
              title="Run this grouping again"
              disabled={busy}
              onClick={() => void run(review.focus ?? "")}
            >
              Group again
            </button>
          )}
          {review && (
            <button className="button" title="Remove these topics from the Reviews list" disabled={removing.busy} onClick={() => void removing.run(review)}>
              Remove
            </button>
          )}
        </div>
      )}
      {removing.error && <p className="comment-error">{removing.error}</p>}
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
      {hasChanges && !running && (
        <GroupForm initial={grouping?.focus ?? ""} explain={review === null} busy={busy} error={error} onSubmit={run} />
      )}
    </div>
  );
}

interface FormProps {
  initial: string;
  explain: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: (focus: string) => Promise<void>;
}

function GroupForm({ initial, explain, busy, error, onSubmit }: FormProps) {
  const [focus, setFocus] = useState(initial);
  return (
    <form
      className="group-card group-form"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(focus.trim());
      }}
    >
      {explain && <p>Claude has not grouped this comparison into topics. It can do that now and explain each topic.</p>}
      <div className="group-form-row">
        <input
          className="filter"
          type="text"
          placeholder="What you want to review, or leave empty to group every change"
          aria-label="Focus"
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
        />
        <button className="button primary" type="submit" disabled={busy}>
          Group into topics
        </button>
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
  onRemove: (review: Review) => Promise<void>;
}

function ReviewPicker({ reviews, current, repoRoot, onPick, onRemove }: PickerProps) {
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
                      <span className="picker-item-label">{r.focus ?? r.topics.map((t) => t.title).join(", ")}</span>
                      <span className="review-item-detail">
                        {otherRepos && `${basename(r.repo)} · `}
                        <code>{describeComparison(r.compare, refLabel)}</code> · {plural(r.topics.length, "topic")} · {time}
                      </span>
                    </span>
                  </button>
                  <button className="icon-button small review-remove" aria-label="Remove these topics" title="Remove" onClick={() => void onRemove(r)}>
                    <TrashIcon />
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
