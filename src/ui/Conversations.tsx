import { type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Thread, ThreadAnchor } from "../shared/types";
import { anchorLabel, type CommentsApi, readableCount, type RevealRequest, ThreadView } from "./comments";
import { comparePaths } from "./FileTree";
import { CloseIcon } from "./keyboard";
import { readStorage, writeStorage } from "./storage";
import "./conversations.css";

/** Where a thread shows in the diff: the tab, and its position for sorting. */
export interface Place {
  tab: "topics" | "files";
  rank: number;
}

interface Options {
  repoRoot: string | null;
  threads: Thread[];
  place: (thread: Thread) => Place | null;
  show: (thread: Thread, place: Place) => void;
}

export interface Conversations {
  api: Pick<CommentsApi, "unread" | "markRead" | "current" | "revealSeq" | "peekReveal" | "takeReveal">;
  ordered: Thread[];
  placeOf: Map<string, Place | null>;
  unreadThreads: number;
  open: boolean;
  setOpen: (open: SetStateAction<boolean>) => void;
  reveal: (thread: Thread, reply?: boolean) => void;
  step: (dir: 1 | -1) => void;
  nextUnread: () => void;
  replyToCurrent: () => void;
  markAllRead: () => void;
}

const OPEN_KEY = "diff-review:conversations";

function countUnread(thread: Thread, seen: number): number {
  return thread.comments.slice(seen, readableCount(thread)).filter((c) => c.author === "claude").length;
}

export function useConversations({ repoRoot, threads, place, show }: Options): Conversations {
  const key = repoRoot ? `diff-review:read:${repoRoot}` : null;
  const [seen, setSeen] = useState<Record<string, number>>({});
  const [current, setCurrent] = useState<string | null>(null);
  const [open, setOpenState] = useState(() => readStorage(OPEN_KEY, false));
  const [revealSeq, setRevealSeq] = useState(0);
  const pending = useRef<{ request: RevealRequest; timer: number } | null>(null);
  const baseTitle = useRef(document.title);

  useEffect(() => {
    if (key) setSeen(readStorage(key, {}));
  }, [key]);

  const setOpen = useCallback((next: SetStateAction<boolean>) => {
    setOpenState((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      writeStorage(OPEN_KEY, value);
      return value;
    });
  }, []);

  const markRead = useCallback(
    (thread: Thread) => {
      if (!key) return;
      const n = readableCount(thread);
      setSeen((prev) => {
        if ((prev[thread.id] ?? 0) >= n) return prev;
        const next = { ...prev, [thread.id]: n };
        writeStorage(key, next);
        return next;
      });
    },
    [key],
  );
  const unread = useCallback((thread: Thread) => countUnread(thread, seen[thread.id] ?? 0), [seen]);

  const placeOf = useMemo(() => new Map(threads.map((t) => [t.id, place(t)])), [threads, place]);
  const ordered = useMemo(
    () =>
      [...threads].sort((a, b) => {
        const ra = placeOf.get(a.id)?.rank ?? Infinity;
        const rb = placeOf.get(b.id)?.rank ?? Infinity;
        return (
          (ra === rb ? 0 : ra - rb) ||
          comparePaths(a.anchor.path, b.anchor.path) ||
          a.anchor.end - b.anchor.end ||
          a.anchor.start - b.anchor.start
        );
      }),
    [threads, placeOf],
  );
  const unreadThreads = ordered.filter((t) => unread(t) > 0).length;

  useEffect(() => {
    document.title = unreadThreads ? `(${unreadThreads}) ${baseTitle.current}` : baseTitle.current;
  }, [unreadThreads]);

  const peekReveal = useCallback(() => pending.current?.request ?? null, []);
  const takeReveal = useCallback((threadId: string) => {
    const p = pending.current;
    if (!p || p.request.thread.id !== threadId) return null;
    clearTimeout(p.timer);
    pending.current = null;
    return p.request;
  }, []);

  const reveal = (thread: Thread, reply = false) => {
    setCurrent(thread.id);
    if (!document.querySelector(`.files [data-thread="${thread.id}"]`)) {
      const p = placeOf.get(thread.id);
      if (p) show(thread, p);
      else setOpen(true);
    }
    if (pending.current) clearTimeout(pending.current.timer);
    // Files and topics open over a few renders. A request nothing took must not scroll a thread later.
    const timer = window.setTimeout(() => (pending.current = null), 1500);
    pending.current = { request: { thread, reply }, timer };
    setRevealSeq((s) => s + 1);
  };

  const at = ordered.findIndex((t) => t.id === current);
  const step = (dir: 1 | -1) => {
    if (!ordered.length) return;
    const i = at < 0 ? (dir > 0 ? 0 : ordered.length - 1) : Math.min(Math.max(at + dir, 0), ordered.length - 1);
    reveal(ordered[i]!);
  };
  const nextUnread = () => {
    for (let k = 1; k <= ordered.length; k++) {
      const t = ordered[(at + k + ordered.length) % ordered.length]!;
      if (unread(t) > 0) return reveal(t);
    }
  };
  const replyToCurrent = () => {
    const t = ordered[at];
    if (t) reveal(t, true);
  };
  const markAllRead = () => {
    if (!key) return;
    const next = Object.fromEntries(threads.map((t) => [t.id, Math.max(seen[t.id] ?? 0, readableCount(t))]));
    writeStorage(key, next);
    setSeen(next);
  };

  const api = useMemo(
    () => ({ unread, markRead, current, revealSeq, peekReveal, takeReveal }),
    [unread, markRead, current, revealSeq, peekReveal, takeReveal],
  );

  return { api, ordered, placeOf, unreadThreads, open, setOpen, reveal, step, nextUnread, replyToCurrent, markAllRead };
}

function lineLabel(anchor: ThreadAnchor): string {
  const lines = anchor.start === anchor.end ? `L${anchor.start}` : `L${anchor.start}–${anchor.end}`;
  return anchor.side === "old" ? `old ${lines}` : lines;
}

const preview = (text: string) => text.replace(/\s+/g, " ").trim();

export function ConversationsButton({ conv }: { conv: Conversations }) {
  const n = conv.unreadThreads;
  const label = n ? `Conversations, ${n} with new answers` : "Conversations";
  return (
    <button
      className={`button conv-button${conv.open ? " is-open" : ""}`}
      onClick={() => conv.setOpen((o) => !o)}
      aria-pressed={conv.open}
      aria-label={label}
      title={`${label} (c)`}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path
          d="M2.5 2.75h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H8.25L5 14.25v-2.5H2.5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <span>{conv.ordered.length}</span>
      {n > 0 && <span className="conv-badge">{n}</span>}
    </button>
  );
}

export function ConversationsPanel({ conv }: { conv: Conversations }) {
  const { ordered, placeOf, api, unreadThreads } = conv;
  return (
    <aside className="conversations" aria-label="Conversations">
      <header className="conversations-head">
        <h2>Conversations</h2>
        <span className="conversations-count">{ordered.length}</span>
        <span className="spacer" />
        {unreadThreads > 0 && (
          <button className="link-button" onClick={conv.markAllRead}>
            Mark all read
          </button>
        )}
        <button className="icon-button" onClick={() => conv.setOpen(false)} aria-label="Hide conversations" title="Hide conversations (c)">
          <CloseIcon />
        </button>
      </header>
      {ordered.length === 0 ? (
        <p className="conversations-empty">
          No conversations yet. Click a line number to leave a comment. Mention @claude to ask about the lines, or leave
          comments for Claude to address and press Submit review.
        </p>
      ) : (
        <ul className="conversations-list">
          {ordered.map((t) => (
            <ConversationItem
              key={t.id}
              thread={t}
              inDiff={placeOf.get(t.id) != null}
              current={api.current === t.id}
              unread={api.unread(t)}
              onOpen={() => conv.reveal(t)}
            />
          ))}
        </ul>
      )}
      <footer className="conversations-foot">
        <kbd>n</kbd> <kbd>p</kbd> move, <kbd>u</kbd> next unread, <kbd>r</kbd> reply, <kbd>?</kbd> all shortcuts
      </footer>
    </aside>
  );
}

interface ItemProps {
  thread: Thread;
  inDiff: boolean;
  current: boolean;
  unread: number;
  onOpen: () => void;
}

function ConversationItem({ thread, inDiff, current, unread, onOpen }: ItemProps) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (current) ref.current?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const { path } = thread.anchor;
  const slash = path.lastIndexOf("/") + 1;
  const first = thread.comments[0];
  const last = thread.comments[thread.comments.length - 1];
  const className = `conv-item${current ? " is-current" : ""}${unread ? " is-unread" : ""}`;

  const head = (
    <span className="conv-row">
      <span className="conv-where" title={`${path}, ${anchorLabel(thread.anchor).toLowerCase()}`}>
        <span className="conv-file">
          <span className="conv-dir">{path.slice(0, slash)}</span>
          {path.slice(slash)}
        </span>
        <span className="conv-lines">{lineLabel(thread.anchor)}</span>
      </span>
      {thread.comments.some((c) => c.draft) && <span className="pending-label">Pending</span>}
      {unread > 0 && <span className="conv-badge">{unread} new</span>}
    </span>
  );

  if (!inDiff) {
    return (
      <li ref={ref}>
        <div className={`${className} is-static`}>
          {head}
          <span className="conv-status">This file is no longer in the diff.</span>
          <ThreadView thread={thread} />
        </div>
      </li>
    );
  }

  return (
    <li ref={ref}>
      <button className={className} onClick={onOpen} aria-current={current || undefined}>
        {head}
        {first && <span className="conv-text">{preview(first.body)}</span>}
        {last && last !== first && last.body && (
          <span className="conv-text conv-last">
            <strong>{last.author === "claude" ? "Claude" : "You"}:</strong> {preview(last.body)}
          </span>
        )}
        {last?.status === "pending" && <span className="conv-status">{last.activity ? `${last.activity}…` : "Claude is writing…"}</span>}
        {last?.status === "error" && <span className="conv-status is-error">Claude could not answer.</span>}
      </button>
    </li>
  );
}
