import { type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { lineNumbers } from "../shared/comments";
import type { Thread, ThreadAnchor } from "../shared/types";
import { anchorLabel, authorName, type CommentsApi, readableCount, ThreadView } from "./comments";
import { CloseIcon, ConversationIcon } from "./icons";
import { basename, comparePaths } from "./paths";
import { readStorage, useStoredState, writeStorage } from "./storage";
import "./conversations.css";

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
  api: Pick<CommentsApi, "unread" | "markRead" | "revealSeq" | "peekReveal" | "takeReveal">;
  current: string | null;
  ordered: Thread[];
  placeOf: Map<string, Place | null>;
  unreadThreads: number;
  open: boolean;
  setOpen: (open: SetStateAction<boolean>) => void;
  reveal: (thread: Thread) => void;
  nextUnread: () => void;
  markAllRead: () => void;
}

const REVEAL_MS = 1500;

function countUnread(thread: Thread, seen: number): number {
  return thread.comments.slice(seen, readableCount(thread)).filter((c) => c.author === "claude").length;
}

function byPlace(placeOf: Map<string, Place | null>) {
  return (a: Thread, b: Thread) => {
    const ra = placeOf.get(a.id)?.rank ?? Infinity;
    const rb = placeOf.get(b.id)?.rank ?? Infinity;
    return (
      (ra === rb ? 0 : ra - rb) ||
      Number(a.anchor.path !== null) - Number(b.anchor.path !== null) ||
      comparePaths(a.anchor.path ?? "", b.anchor.path ?? "") ||
      (a.anchor.end ?? 0) - (b.anchor.end ?? 0) ||
      (a.anchor.start ?? 0) - (b.anchor.start ?? 0)
    );
  };
}

export function useConversations({ repoRoot, threads, place, show }: Options): Conversations {
  const key = repoRoot ? `diff-review:read:${repoRoot}` : null;
  const [seen, setSeen] = useState<Record<string, number>>({});
  const [current, setCurrent] = useState<string | null>(null);
  const [open, setOpen] = useStoredState("diff-review:conversations", false);
  const [revealSeq, setRevealSeq] = useState(0);
  const pending = useRef<{ thread: Thread; timer: number } | null>(null);
  const baseTitle = useRef(document.title);

  useEffect(() => {
    if (key) setSeen(readStorage(key, {}));
  }, [key]);

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
  const ordered = useMemo(() => [...threads].sort(byPlace(placeOf)), [threads, placeOf]);
  const unreadThreads = ordered.filter((t) => unread(t) > 0).length;

  useEffect(() => {
    document.title = unreadThreads ? `(${unreadThreads}) ${baseTitle.current}` : baseTitle.current;
  }, [unreadThreads]);

  const peekReveal = useCallback(() => pending.current?.thread ?? null, []);
  const takeReveal = useCallback((threadId: string) => {
    const p = pending.current;
    if (!p || p.thread.id !== threadId) return false;
    clearTimeout(p.timer);
    pending.current = null;
    return true;
  }, []);

  const reveal = (thread: Thread) => {
    setCurrent(thread.id);
    if (!document.querySelector(`.files > :not([hidden]) [data-thread="${thread.id}"]`)) {
      const p = placeOf.get(thread.id);
      if (p) show(thread, p);
      else setOpen(true);
    }

    if (pending.current) clearTimeout(pending.current.timer);
    const timer = window.setTimeout(() => (pending.current = null), REVEAL_MS);
    pending.current = { thread, timer };
    setRevealSeq((s) => s + 1);
  };

  const at = ordered.findIndex((t) => t.id === current);
  const nextUnread = () => {
    for (let k = 1; k <= ordered.length; k++) {
      const t = ordered[(at + k + ordered.length) % ordered.length]!;
      if (unread(t) > 0) return reveal(t);
    }
  };
  const markAllRead = () => {
    if (!key) return;
    const next = Object.fromEntries(threads.map((t) => [t.id, Math.max(seen[t.id] ?? 0, readableCount(t))]));
    writeStorage(key, next);
    setSeen(next);
  };

  const api = useMemo(() => ({ unread, markRead, revealSeq, peekReveal, takeReveal }), [unread, markRead, revealSeq, peekReveal, takeReveal]);

  return { api, current, ordered, placeOf, unreadThreads, open, setOpen, reveal, nextUnread, markAllRead };
}

function lineLabel(anchor: ThreadAnchor): string {
  if (anchor.path === null) return "topic";
  if (anchor.side === null) return "file";
  const lines = `L${lineNumbers(anchor)}`;
  return anchor.side === "old" ? `old ${lines}` : lines;
}

const preview = (text: string) =>
  text
    .replace(/```[^\n]*\n?/g, " ")
    .replace(/\*\*|`/g, "")
    .replace(/\s+/g, " ")
    .trim();

export function ConversationsButton({ conv }: { conv: Conversations }) {
  const n = conv.unreadThreads;
  const label = n ? `Conversations, ${n} with new answers` : "Conversations";
  return (
    <button
      className={`button conv-button${conv.open ? " is-open" : ""}`}
      onClick={() => conv.setOpen((o) => !o)}
      aria-pressed={conv.open}
      aria-label={label}
      title={label}
    >
      <ConversationIcon />
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
        <button className="icon-button" onClick={() => conv.setOpen(false)} aria-label="Hide conversations" title="Hide conversations">
          <CloseIcon />
        </button>
      </header>
      {ordered.length === 0 ? (
        <p className="conversations-empty">
          No conversations yet. Click a line number to comment on lines, or the comment button in a file's or topic's
          header to comment on all of it. Mention @claude to ask a question, or leave comments for Claude to address and
          press Submit review.
        </p>
      ) : (
        <ul className="conversations-list">
          {ordered.map((t) => (
            <ConversationItem
              key={t.id}
              thread={t}
              inDiff={placeOf.get(t.id) != null}
              current={conv.current === t.id}
              unread={api.unread(t)}
              onOpen={() => conv.reveal(t)}
            />
          ))}
        </ul>
      )}
      <footer className="conversations-foot">
        <kbd>u</kbd> jumps to the next new answer
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

  const { anchor } = thread;
  const first = thread.comments[0];
  const last = thread.comments[thread.comments.length - 1];
  const className = `conv-item${current ? " is-current" : ""}${unread ? " is-unread" : ""}`;

  const head = (
    <span className="conv-row">
      {anchor.path === null ? (
        <span className="conv-where" title={anchorLabel(anchor)}>
          <span className="conv-file conv-topic">{anchor.topic}</span>
          <span className="conv-lines">{lineLabel(anchor)}</span>
        </span>
      ) : (
        <span className="conv-where" title={`${anchor.path}, ${anchorLabel(anchor).toLowerCase()}`}>
          <span className="conv-file">
            <span className="conv-dir">{anchor.path.slice(0, anchor.path.length - basename(anchor.path).length)}</span>
            {basename(anchor.path)}
          </span>
          <span className="conv-lines">{lineLabel(anchor)}</span>
        </span>
      )}
      {thread.comments.some((c) => c.draft) && <span className="pending-label">Pending</span>}
      {unread > 0 && <span className="conv-badge">{unread} new</span>}
    </span>
  );

  if (!inDiff) {
    return (
      <li ref={ref}>
        <div className={`${className} is-static`}>
          {head}
          <span className="conv-status">{anchor.path === null ? "This topic is not on the page." : "This file is no longer in the diff."}</span>
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
            <strong>{authorName(last)}:</strong> {preview(last.body)}
          </span>
        )}
        {last?.status === "pending" && <span className="conv-status">{last.activity ? `${last.activity}…` : "Claude is writing…"}</span>}
        {last?.status === "error" && <span className="conv-status is-error">Claude could not answer.</span>}
      </button>
    </li>
  );
}
