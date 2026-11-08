import { useEffect, useRef, useState } from "react";
import { changeIds } from "../shared/hunks";
import type { Block, FileDiff, Review, Thread } from "../shared/types";
import { CommentForm, type CommentsApi, onShownVersion, ThreadView, useComments } from "./comments";
import { hasLine } from "./DiffTable";
import { baseHunksOf, ChevronIcon, CommentIcon, FileCard } from "./FileCard";
import { keepHeaderInPlace } from "./anchor";
import { Markdown } from "./Markdown";

export interface TopicPart {
  file: FileDiff;
  blocks: Block[];
  anchor: string;
}

export interface TopicView {
  key: string;
  anchor: string;
  title: string;
  summary: string;
  related: boolean;
  parts: TopicPart[];
  changeCount: number;
  stale: number;
  signature: string;
  /** The files this topic is the first to show. A comment on a whole file belongs to the first topic with the file. */
  firstFor: Set<string>;
}

export function buildTopics(review: Review, files: FileDiff[]): TopicView[] {
  const known = new Set(files.flatMap(changeIds));
  const assigned = new Set<string>();

  const make = (key: string, index: number, title: string, summary: string, related: boolean, ids: string[]): TopicView => {
    const present = [...new Set(ids)].filter((id) => known.has(id));
    for (const id of present) assigned.add(id);
    const chosen = new Set(present);

    const parts: TopicPart[] = [];
    files.forEach((f, fi) => {
      if (!changeIds(f).some((id) => chosen.has(id))) return;
      parts.push({ file: f, blocks: f.blocks.filter((b) => chosen.has(b.id)), anchor: `topic-${index}-file-${fi}` });
    });

    return {
      key,
      anchor: `topic-${index}`,
      title,
      summary,
      related,
      parts,
      changeCount: present.length,
      stale: ids.length - present.length,
      signature: present.join(","),
      firstFor: new Set(),
    };
  };

  const views = review.topics.map((t, i) => make(`topic:${t.title}`, i, t.title, t.summary, t.related, t.ids));
  const rest = [...known].filter((id) => !assigned.has(id));
  const other = rest.length
    ? [make("other", views.length, "Other changes", "Changes that are in no topic, including any edited after Claude grouped them.", true, rest)]
    : [];

  const ordered = [...views.filter((v) => v.related), ...other, ...views.filter((v) => !v.related)];
  const seen = new Set<string>();
  for (const t of ordered) {
    for (const { file } of t.parts) {
      if (!seen.has(file.path)) t.firstFor.add(file.path);
      seen.add(file.path);
    }
  }
  return ordered;
}

/**
 * Whether a thread belongs to the topic: it is on the topic itself, its line is in the topic's diff before any
 * expanding, or it is a comment on a whole file and the topic is the first with the file.
 */
export function topicShows(topic: TopicView, thread: Thread, versions: CommentsApi["versions"]): boolean {
  const { anchor } = thread;
  if (anchor.path === null) return anchor.topic === topic.title;
  if (anchor.side === null) return topic.firstFor.has(anchor.path);
  if (!onShownVersion(thread, versions)) return false;
  return topic.parts.some((p) => p.file.path === anchor.path && hasLine(baseHunksOf(p.file, p.blocks), anchor.side, anchor.end));
}

interface SectionProps {
  topic: TopicView;
  viewed: boolean;
  onToggleViewed: () => void;
}

export function TopicSection({ topic, viewed, onToggleViewed }: SectionProps) {
  const [collapsed, setCollapsed] = useState(viewed || !topic.related);
  // A viewed topic whose changes are edited stops being viewed and opens again.
  useEffect(() => setCollapsed(viewed || !topic.related), [viewed]);
  const { revealSeq, peekReveal, versions, threadsForTopic, create } = useComments();
  useEffect(() => {
    const thread = peekReveal()?.thread;
    if (thread && topicShows(topic, thread, versions)) setCollapsed(false);
  }, [revealSeq]);
  const [commenting, setCommenting] = useState(false);
  const threads = threadsForTopic(topic.title);

  const header = useRef<HTMLElement>(null);
  const files = topic.parts.length;
  return (
    <section className={`topic${viewed ? " is-viewed" : ""}`} id={topic.anchor}>
      <header className="topic-header" ref={header}>
        <button
          className="icon-button chevron"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand topic" : "Collapse topic"}
          onClick={() => keepHeaderInPlace(header.current, () => setCollapsed(!collapsed))}
        >
          <ChevronIcon />
        </button>
        <h2 className="topic-title">{topic.title}</h2>
        <span className="topic-meta">
          {topic.changeCount} change{topic.changeCount === 1 ? "" : "s"} in {files} file{files === 1 ? "" : "s"}
          {threads.length > 0 && ` · ${threads.length} comment${threads.length === 1 ? "" : "s"}`}
        </span>
        <span className="spacer" />
        <button
          className="icon-button"
          aria-label="Comment on this topic"
          title="Comment on this topic"
          onClick={() =>
            keepHeaderInPlace(header.current, () => {
              setCollapsed(false);
              setCommenting(true);
            })
          }
        >
          <CommentIcon />
        </button>
        <label className="viewed-toggle">
          <input
            type="checkbox"
            checked={viewed}
            onChange={() =>
              keepHeaderInPlace(header.current, () => {
                setCollapsed(!viewed || !topic.related);
                onToggleViewed();
              })
            }
          />
          Viewed
        </label>
      </header>

      {!collapsed && (
        <div className="topic-body">
          {topic.summary && <Markdown className="topic-summary" text={topic.summary} />}
          {(threads.length > 0 || commenting) && (
            <div className="topic-threads">
              {threads.map((t) => (
                <ThreadView key={t.id} thread={t} />
              ))}
              {commenting && (
                <div className="thread thread-new">
                  <CommentForm
                    placeholder="Comment on this topic"
                    onSubmit={async (body, single) => {
                      const anchor = { topic: topic.title, path: null, side: null, start: null, end: null, commit: null };
                      const files = `Files: ${topic.parts.map((p) => p.file.path).join(", ")}`;
                      await create(anchor, topic.summary ? `${files}\n\n${topic.summary}` : files, body, single);
                      setCommenting(false);
                    }}
                    onCancel={() => setCommenting(false)}
                  />
                </div>
              )}
            </div>
          )}
          {topic.stale > 0 && (
            <p className="topic-note">
              {topic.stale} change{topic.stale === 1 ? " was" : "s were"} edited after Claude grouped them and now
              appear under Other changes.
            </p>
          )}
          {topic.parts.map((p) => (
            <FileCard key={p.file.path} file={p.file} blocks={p.blocks} anchor={p.anchor} />
          ))}
        </div>
      )}
    </section>
  );
}

interface ListProps {
  topics: TopicView[];
  active: string | null;
  isViewed: (topic: TopicView) => boolean;
  onSelect: (anchor: string) => void;
}

export function TopicList({ topics, active, isViewed, onSelect }: ListProps) {
  const firstUnrelated = topics.findIndex((t) => !t.related);
  return (
    <ul className="topic-list">
      {topics.map((t, i) => (
        <li key={t.key}>
          {i === firstUnrelated && <p className="topic-list-heading">Not related to the focus</p>}
          <button
            className={`topic-link${active === t.anchor ? " is-active" : ""}${isViewed(t) ? " is-viewed" : ""}`}
            onClick={() => onSelect(t.anchor)}
          >
            <span className="topic-link-title">{t.title}</span>
            <span className="topic-link-count">{t.changeCount}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
