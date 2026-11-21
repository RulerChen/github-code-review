import { useRef, useState } from "react";
import { describeComparison } from "../shared/comparison";
import type { Grouping, Review } from "../shared/types";
import { plural } from "../shared/util";
import { focusInPlace } from "./anchor";
import type { TopicRequest } from "./api";
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
  onGroup: (ask: TopicRequest) => Promise<void>;
  onRemove: (review: Review) => Promise<void>;
}

export function ReviewBar({ reviews, review, grouping, repoRoot, hasChanges, onPick, onGroup, onRemove }: Props) {
  const running = grouping !== null && grouping.error === null;
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const { busy, error, run } = useAction(async (ask: TopicRequest) => {
    await onGroup(ask);
    setEditing(false);
    setCreating(false);
  });
  const removing = useAction(onRemove);
  const failedEdit = grouping?.error && review && grouping.replaces === review.createdAt ? grouping : null;
  const canGroup = hasChanges && !running && !editing;
  const showCreate = canGroup && (review === null || creating);

  return (
    <div className="review-bar">
      {(reviews.length > 0 || review) && (
        <div className="review-bar-row">
          {reviews.length > 0 && (
            <ReviewPicker
              reviews={reviews}
              current={review}
              repoRoot={repoRoot}
              onPick={onPick}
              onRemove={removing.run}
              onCreate={canGroup && !showCreate ? () => setCreating(true) : null}
            />
          )}
          {review?.focus && (
            <p className="focus" title={review.focus}>
              Focus: <strong>{review.focus}</strong>
            </p>
          )}
          <span className="spacer" />
          {review && hasChanges && !running && !editing && (
            <button
              className="button"
              title="Change these topics and have Claude redo them"
              onClick={() => {
                setCreating(false);
                setEditing(true);
              }}
            >
              Edit topics
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
              {grouping.syncs ? "Claude is updating the topics to the new changes" : grouping.replaces ? "Claude is updating the topics" : "Claude is making topics"}
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
          {grouping.replaces || grouping.syncs ? "Could not update the topics" : "Could not make topics"}: {grouping.error}
        </p>
      )}
      {hasChanges && !running && review && editing && (
        <EditForm
          key={review.createdAt}
          review={review}
          retry={failedEdit}
          busy={busy}
          error={error}
          onSubmit={run}
          onCancel={() => setEditing(false)}
        />
      )}
      {showCreate && (
        <CreateForm
          initial={grouping?.replaces === null && grouping.syncs === null ? (grouping.focus ?? "") : ""}
          explain={review === null}
          busy={busy}
          error={error}
          onSubmit={(focus) => run({ focus, topics: null, replaces: null })}
          onCancel={review === null ? null : () => setCreating(false)}
        />
      )}
    </div>
  );
}

interface CreateProps {
  initial: string;
  explain: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: (focus: string) => Promise<void>;
  onCancel: (() => void) | null;
}

function CreateForm({ initial, explain, busy, error, onSubmit, onCancel }: CreateProps) {
  const [focus, setFocus] = useState(initial);
  return (
    <form
      className="group-card group-form"
      onKeyDown={(e) => {
        if (e.key === "Escape" && onCancel) onCancel();
      }}
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(focus.trim());
      }}
    >
      {explain ? (
        <p>There are no topics for this comparison yet. Claude can make them now and explain each one.</p>
      ) : (
        <p>Claude makes another set of topics for this comparison. The ones you have now stay in the Reviews list.</p>
      )}
      <div className="group-form-row">
        <input
          className="filter"
          type="text"
          placeholder="What you want to review, or leave empty for every change"
          aria-label="Focus"
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          ref={explain ? undefined : focusInPlace}
        />
        {onCancel && (
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="button primary" type="submit" disabled={busy}>
          Create topics
        </button>
      </div>
      {error && <p className="comment-error">{error}</p>}
    </form>
  );
}

interface EditProps {
  review: Review;
  retry: Grouping | null;
  busy: boolean;
  error: string | null;
  onSubmit: (ask: TopicRequest) => Promise<void>;
  onCancel: () => void;
}

function EditForm({ review, retry, busy, error, onSubmit, onCancel }: EditProps) {
  const [focus, setFocus] = useState(retry ? (retry.focus ?? "") : (review.focus ?? ""));
  const [titles, setTitles] = useState((retry?.topics ?? review.topics.map((t) => t.title)).join("\n"));
  const rows = Math.min(12, Math.max(3, titles.split("\n").length + 1));

  return (
    <form
      className="group-card group-form"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
      onSubmit={(e) => {
        e.preventDefault();
        const topics = titles
          .split("\n")
          .map((t) => t.trim())
          .filter(Boolean);
        void onSubmit({ focus: focus.trim(), topics, replaces: review.createdAt });
      }}
    >
      <p>
        Rename, add, remove or reorder the topics, one per line, and Claude redoes them in place of these. Leave the list
        empty to let Claude choose the topics.
      </p>
      <label className="group-field">
        <span>Focus</span>
        <input
          className="filter"
          type="text"
          placeholder="What you want to review, or leave empty for every change"
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
        />
      </label>
      <label className="group-field">
        <span>Topics</span>
        <textarea className="filter" rows={rows} value={titles} onChange={(e) => setTitles(e.target.value)} ref={focusInPlace} />
      </label>
      <div className="group-form-actions">
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="button primary" type="submit" disabled={busy}>
          Update topics
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
  onCreate: (() => void) | null;
}

const MAX_LABEL = 60;

const reviewLabel = (r: Review) => r.focus ?? r.topics.map((t) => t.title).join(", ");

function ReviewPicker({ reviews, current, repoRoot, onPick, onRemove, onCreate }: PickerProps) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<Review | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    setConfirming(null);
  };
  useDismiss(root, open, close);

  const otherRepos = reviews.some((r) => r.repo !== repoRoot);
  const newest = [...reviews].reverse();

  return (
    <div className="picker review-picker" ref={root}>
      <button className="picker-button" aria-haspopup="dialog" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
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
                      close();
                      if (!selected) onPick(r);
                    }}
                  >
                    <CheckMark checked={selected} />
                    <span className="review-item-text">
                      <span className="picker-item-label">{reviewLabel(r)}</span>
                      <span className="review-item-detail">
                        {otherRepos && `${basename(r.repo)} · `}
                        <code>{describeComparison(r.compare, refLabel)}</code> · {plural(r.topics.length, "topic")} · {time}
                      </span>
                    </span>
                  </button>
                  <button
                    className="icon-button small review-remove"
                    aria-label="Remove these topics"
                    aria-pressed={confirming === r}
                    title="Remove"
                    onClick={() => setConfirming(confirming === r ? null : r)}
                  >
                    <TrashIcon />
                  </button>
                </li>
              );
            })}
          </ul>
          {confirming && (
            <div className="comment-confirm review-confirm" role="alertdialog" aria-label="Remove these topics">
              <span className="comment-confirm-text">
                Remove the topics for “{shorten(reviewLabel(confirming))}”?
              </span>
              <button className="button" ref={focusInPlace} onClick={() => setConfirming(null)}>
                Cancel
              </button>
              <button
                className="button danger"
                onClick={() => {
                  const r = confirming;
                  close();
                  void onRemove(r);
                }}
              >
                Remove
              </button>
            </div>
          )}
          {onCreate && (
            <button
              className="picker-action"
              title="Have Claude make another set of topics for this comparison, with a focus you choose"
              onClick={() => {
                close();
                onCreate();
              }}
            >
              New topics…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function shorten(text: string): string {
  return text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text;
}
