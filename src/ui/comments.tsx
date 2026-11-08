import { createContext, type FormEvent, type KeyboardEvent, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MENTION } from "../shared/comments";
import type { FileAnchor, LineAnchor, Thread, ThreadAnchor, ThreadComment, TopicAnchor } from "../shared/types";
import { pin } from "./anchor";
import { type Format, format, suggestion, type TextEdit } from "./format";
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
  /** A single comment is sent to Claude on its own at once instead of going into the pending review. */
  create: (anchor: NewAnchor, snippet: string, body: string, single: boolean) => Promise<void>;
  reply: (threadId: string, body: string, single: boolean) => Promise<void>;
  edit: (threadId: string, commentId: string, body: string) => Promise<void>;
  remove: (threadId: string, commentId: string) => Promise<void>;
  unread: (thread: Thread) => number;
  markRead: (thread: Thread) => void;
  current: string | null;
  /** Whether comments wait in a review the user has not submitted yet. */
  pending: boolean;
  /** Whether Claude is waiting for a review right now. */
  listening: boolean;
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
  pending: false,
  listening: false,
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

/** The selected lines of a snippet without the diff marks in front of them. */
export const unmark = (snippet: string) =>
  snippet
    .split("\n")
    .map((l) => l.slice(1))
    .join("\n");

/** The lines a suggested change in a thread replaces. Only lines of the new version can take one. */
export const suggestionLines = (thread: Thread) => (thread.anchor.side === "new" ? unmark(thread.snippet) : undefined);

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
  /** Editing saves the text and nothing else. A new comment asks Claude, goes into the pending review, or is sent on its own. */
  editing?: boolean;
  /** The lines a suggested change replaces: the selected lines of the new version. Without them there is no suggestion button. */
  lines?: string;
  onSubmit: (body: string, single: boolean) => Promise<void>;
  onCancel: () => void;
}

type Tool = { name: string; keys?: string; icon: string } & ({ format: Format } | { suggest: true });

// Octicons (16px) from @primer/octicons 19.15.0, as on GitHub's comment toolbar.
const SUGGEST: Tool = {
  suggest: true,
  name: "Suggest a change",
  keys: "Ctrl+G",
  icon: "M1 1.75C1 .784 1.784 0 2.75 0h7.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16H2.75A1.75 1.75 0 0 1 1 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V4.664a.25.25 0 0 0-.073-.177l-2.914-2.914a.25.25 0 0 0-.177-.073ZM8 3.25a.75.75 0 0 1 .75.75v1.5h1.5a.75.75 0 0 1 0 1.5h-1.5v1.5a.75.75 0 0 1-1.5 0V7h-1.5a.75.75 0 0 1 0-1.5h1.5V4A.75.75 0 0 1 8 3.25Zm-3 8a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Z",
};

const TOOLS: Tool[][] = [
  [
    { format: "heading", name: "Heading", icon: "M3.75 2a.75.75 0 0 1 .75.75V7h7V2.75a.75.75 0 0 1 1.5 0v10.5a.75.75 0 0 1-1.5 0V8.5h-7v4.75a.75.75 0 0 1-1.5 0V2.75A.75.75 0 0 1 3.75 2Z" },
    { format: "bold", name: "Bold", keys: "Ctrl+B", icon: "M4 2h4.5a3.501 3.501 0 0 1 2.852 5.53A3.499 3.499 0 0 1 9.5 14H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm1 7v3h4.5a1.5 1.5 0 0 0 0-3Zm3.5-2a1.5 1.5 0 0 0 0-3H5v3Z" },
    { format: "italic", name: "Italic", keys: "Ctrl+I", icon: "M6 2.75A.75.75 0 0 1 6.75 2h6.5a.75.75 0 0 1 0 1.5h-2.505l-3.858 9H9.25a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1 0-1.5h2.505l3.858-9H6.75A.75.75 0 0 1 6 2.75Z" },
  ],
  [
    { format: "quote", name: "Quote", keys: "Ctrl+Shift+.", icon: "M1.75 2.5h10.5a.75.75 0 0 1 0 1.5H1.75a.75.75 0 0 1 0-1.5Zm4 5h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5Zm0 5h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5ZM2.5 7.75v6a.75.75 0 0 1-1.5 0v-6a.75.75 0 0 1 1.5 0Z" },
    { format: "code", name: "Code", keys: "Ctrl+E", icon: "m11.28 3.22 4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734L13.94 8l-3.72-3.72a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215Zm-6.56 0a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L2.06 8l3.72 3.72a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L.47 8.53a.75.75 0 0 1 0-1.06Z" },
    { format: "link", name: "Link", keys: "Ctrl+K", icon: "m7.775 3.275 1.25-1.25a3.5 3.5 0 1 1 4.95 4.95l-2.5 2.5a3.5 3.5 0 0 1-4.95 0 .751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018 1.998 1.998 0 0 0 2.83 0l2.5-2.5a2.002 2.002 0 0 0-2.83-2.83l-1.25 1.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042Zm-4.69 9.64a1.998 1.998 0 0 0 2.83 0l1.25-1.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042l-1.25 1.25a3.5 3.5 0 1 1-4.95-4.95l2.5-2.5a3.5 3.5 0 0 1 4.95 0 .751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018 1.998 1.998 0 0 0-2.83 0l-2.5 2.5a1.998 1.998 0 0 0 0 2.83Z" },
  ],
  [
    { format: "ordered", name: "Numbered list", keys: "Ctrl+Shift+7", icon: "M5 3.25a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 0 1.5h-8.5A.75.75 0 0 1 5 3.25Zm0 5a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 0 1.5h-8.5A.75.75 0 0 1 5 8.25Zm0 5a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1-.75-.75ZM.924 10.32a.5.5 0 0 1-.851-.525l.001-.001.001-.002.002-.004.007-.011c.097-.144.215-.273.348-.384.228-.19.588-.392 1.068-.392.468 0 .858.181 1.126.484.259.294.377.673.377 1.038 0 .987-.686 1.495-1.156 1.845l-.047.035c-.303.225-.522.4-.654.597h1.357a.5.5 0 0 1 0 1H.5a.5.5 0 0 1-.5-.5c0-1.005.692-1.52 1.167-1.875l.035-.025c.531-.396.8-.625.8-1.078a.57.57 0 0 0-.128-.376C1.806 10.068 1.695 10 1.5 10a.658.658 0 0 0-.429.163.835.835 0 0 0-.144.153ZM2.003 2.5V6h.503a.5.5 0 0 1 0 1H.5a.5.5 0 0 1 0-1h.503V3.308l-.28.14a.5.5 0 0 1-.446-.895l1.003-.5a.5.5 0 0 1 .723.447Z" },
    { format: "unordered", name: "Bulleted list", keys: "Ctrl+Shift+8", icon: "M5.75 2.5h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5Zm0 5h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5Zm0 5h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5ZM2 14a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm1-6a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM2 4a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" },
    { format: "task", name: "Task list", icon: "M2 2h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm4.655 8.595a.75.75 0 0 1 0 1.06L4.03 14.28a.75.75 0 0 1-1.06 0l-1.5-1.5a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215l.97.97 2.095-2.095a.75.75 0 0 1 1.06 0ZM9.75 2.5h5.5a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1 0-1.5Zm0 5h5.5a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1 0-1.5Zm0 5h5.5a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1 0-1.5Zm-7.25-9v3h3v-3Z" },
  ],
  [SUGGEST],
];

/** GitHub's comment shortcuts, held with Ctrl, or Cmd on a Mac. Shifted keys go by their place on the keyboard. */
const FORMAT_KEYS: Record<string, Format> = { b: "bold", i: "italic", e: "code", k: "link" };
const SHIFT_FORMAT_KEYS: Record<string, Format> = { Digit7: "ordered", Digit8: "unordered", Period: "quote" };

export function CommentForm({ placeholder, initial = "", editing = false, lines, onSubmit, onCancel }: FormProps) {
  const { pending, listening } = useComments();
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The height inside the box when the preview took the field's place, or null while writing.
  const [preview, setPreview] = useState<number | null>(null);
  const asking = !editing && MENTION.test(text);
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const previewBox = useRef<HTMLDivElement>(null);

  // Focusing would scroll the field to the middle of the screen. Scroll only as far as it takes to show the form.
  useLayoutEffect(() => {
    const el = input.current;
    el?.focus({ preventScroll: true });
    el?.setSelectionRange(el.value.length, el.value.length);
    form.current?.scrollIntoView({ block: "nearest" });
  }, []);

  // The focus follows the tab, so the keys keep working after the field hides.
  const writing = preview === null;
  useLayoutEffect(() => {
    (writing ? input.current : previewBox.current)?.focus({ preventScroll: true });
  }, [writing]);

  // The box keeps its height: the preview takes the field's room and the toolbar's, which goes with the field and
  // takes rows of its own in a narrow box.
  useLayoutEffect(() => {
    if (preview !== null && previewBox.current && tabs.current) previewBox.current.style.minHeight = `${preview - tabs.current.offsetHeight}px`;
  }, [preview]);

  const ready = !busy && text.trim() !== "" && !(editing && text.trim() === initial);
  const submit = async (single: boolean) => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(text.trim(), single);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // insertText goes through the field's own undo history, which setting the value would wipe.
  const apply = (edit: TextEdit) => {
    const el = input.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(edit.from, edit.to);
    if (!document.execCommand("insertText", false, edit.text)) {
      el.setRangeText(edit.text, edit.from, edit.to);
      setText(el.value);
    }
    el.setSelectionRange(edit.start, edit.end);
  };
  const use = (tool: Tool | Format) => {
    const el = input.current;
    if (!el || !writing) return;
    const { selectionStart: start, selectionEnd: end, value } = el;
    if (typeof tool === "string") apply(format(tool, value, start, end));
    else if ("format" in tool) apply(format(tool.format, value, start, end));
    else if (lines !== undefined) apply(suggestion(value, start, end, lines));
  };
  const togglePreview = () => setPreview(writing ? (box.current?.clientHeight ?? 0) : null);

  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") return onCancel();
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    let action: (() => void) | null = null;
    if (e.key === "Enter" && !e.shiftKey) action = () => void submit(false);
    else if (e.shiftKey && e.code === "KeyP") action = togglePreview;
    else if (e.target === input.current) {
      const kind = e.shiftKey ? SHIFT_FORMAT_KEYS[e.code] : FORMAT_KEYS[e.key.toLowerCase()];
      if (kind) action = () => use(kind);
      else if (!e.shiftKey && e.key.toLowerCase() === "g" && lines !== undefined) action = () => use(SUGGEST);
    }
    if (!action) return;
    e.preventDefault();
    action();
  };

  const singleTitle = asking
    ? "A comment that mentions @claude is answered right away."
    : listening
      ? "Send only this comment to Claude now, without a review. Claude is waiting and starts on it at once."
      : "Send only this comment to Claude now, without a review. Claude isn't waiting, so ask it in the terminal to address your review comments.";

  return (
    <form
      className="comment-form"
      ref={form}
      onKeyDown={onKeyDown}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void submit(false);
      }}
    >
      <div className="comment-box" ref={box}>
        <div className="comment-tabs" ref={tabs}>
          <div className="comment-tablist" role="tablist">
            <button type="button" role="tab" className="comment-tab" aria-selected={writing} onClick={() => writing || togglePreview()}>
              Write
            </button>
            <button type="button" role="tab" className="comment-tab" aria-selected={!writing} onClick={() => writing && togglePreview()} title="Preview (Ctrl+Shift+P)">
              Preview
            </button>
          </div>
          {writing && (
          <div className="comment-toolbar" role="toolbar" aria-label="Formatting">
            {TOOLS.map((group, g) => {
              const tools = group.filter((t) => "format" in t || lines !== undefined);
              if (!tools.length) return null;
              return (
                <span className="tool-group" key={g}>
                  {tools.map((t) => (
                    <button
                      type="button"
                      key={t.name}
                      className="icon-button"
                      aria-label={t.name}
                      title={t.keys ? `${t.name} (${t.keys})` : t.name}
                      // The field keeps the focus and its selection.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => use(t)}
                    >
                      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                        <path d={t.icon} />
                      </svg>
                    </button>
                  ))}
                </span>
              );
            })}
          </div>
          )}
        </div>
        <textarea ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} rows={3} hidden={!writing} />
        {!writing && (
          <div ref={previewBox} className="comment-preview" tabIndex={-1}>
            {text.trim() ? <Markdown text={text} base={lines} /> : <p className="comment-preview-empty">Nothing to preview</p>}
          </div>
        )}
      </div>
      <div className="comment-form-actions">
        {editing ? (
          <span className="comment-hint" />
        ) : (
          <Either
            className="comment-hint"
            show={asking ? 0 : 1}
            texts={["Claude answers here right away.", "Mention @claude to get an answer right away."]}
          />
        )}
        <span className="comment-form-buttons">
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          {!editing && (
            <button type="button" className="button" onClick={() => void submit(true)} disabled={!ready || asking} title={singleTitle}>
              Add single comment
            </button>
          )}
          <button type="submit" className="button primary" disabled={!ready}>
            {editing ? "Save" : <Either show={asking ? 0 : pending ? 2 : 1} texts={["Ask Claude", "Start a review", "Add review comment"]} />}
          </button>
        </span>
      </div>
      {error && <p className="comment-error">{error}</p>}
    </form>
  );
}

/** Shows one of its texts in a box sized for the longest, so switching between them moves nothing around it. */
function Either({ show, texts, className }: { show: number; texts: string[]; className?: string }) {
  return (
    <span className={`either${className ? ` ${className}` : ""}`}>
      {texts.map((t, i) => (
        <span key={i} aria-hidden={i !== show}>
          {t}
        </span>
      ))}
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
            lines={suggestionLines(thread)}
            onSubmit={async (body, single) => {
              await reply(thread.id, body, single);
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
          lines={suggestionLines(thread)}
          editing
          onSubmit={async (body) => {
            await edit(thread.id, c.id, body);
            setMode("view");
          }}
          onCancel={() => setMode("view")}
        />
      ) : (
        <>
          {c.status === "error" ? <p className="comment-error">{c.body}</p> : c.body && <Markdown text={c.body} base={suggestionLines(thread)} />}
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
