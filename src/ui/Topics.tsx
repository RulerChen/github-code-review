import { useEffect, useRef, useState } from "react";
import { changeIds } from "../shared/hunks";
import type { Block, DisplayHunk, FileDiff, Review, Thread } from "../shared/types";
import { type CommentsApi, onShownVersion, useComments } from "./comments";
import { hasLine } from "./DiffTable";
import { ChevronIcon, FileCard, hunksOf } from "./FileCard";
import { keepHeaderInPlace } from "./keyboard";
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
    };
  };

  const views = review.topics.map((t, i) => make(`topic:${t.title}`, i, t.title, t.summary, t.related, t.ids));
  const rest = [...known].filter((id) => !assigned.has(id));
  const other = rest.length
    ? [make("other", views.length, "Other changes", "Changes that are in no topic, including any edited after Claude grouped them.", true, rest)]
    : [];

  return [...views.filter((v) => v.related), ...other, ...views.filter((v) => !v.related)];
}

const partHunks = new WeakMap<TopicPart, DisplayHunk[]>();

/** Whether a thread's line is in the topic's diff before any expanding. */
export function topicShows(topic: TopicView, thread: Thread, versions: CommentsApi["versions"]): boolean {
  if (!onShownVersion(thread, versions)) return false;
  const { path, side, end } = thread.anchor;
  return topic.parts.some((p) => {
    if (p.file.path !== path) return false;
    let hunks = partHunks.get(p);
    if (!hunks) {
      hunks = hunksOf(p.file, p.blocks, null);
      partHunks.set(p, hunks);
    }
    return hasLine(hunks, side, end);
  });
}

interface SectionProps {
  topic: TopicView;
  viewed: boolean;
  onToggleViewed: () => void;
}

export function TopicSection({ topic, viewed, onToggleViewed }: SectionProps) {
  const [collapsed, setCollapsed] = useState(viewed || !topic.related);
  useEffect(() => {
    if (viewed) setCollapsed(true);
  }, [viewed]);
  const { revealSeq, peekReveal, versions } = useComments();
  useEffect(() => {
    const thread = peekReveal()?.thread;
    if (thread && topicShows(topic, thread, versions)) setCollapsed(false);
  }, [revealSeq]);

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
        </span>
        <span className="spacer" />
        <label className="viewed-toggle">
          <input
            type="checkbox"
            checked={viewed}
            onChange={() =>
              keepHeaderInPlace(header.current, () => {
                if (!viewed) setCollapsed(true);
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
          {topic.stale > 0 && (
            <p className="topic-note">
              {topic.stale} change{topic.stale === 1 ? " was" : "s were"} edited after Claude grouped them and now
              appear under Other changes.
            </p>
          )}
          {topic.parts.map((p) => (
            <FileCard key={p.anchor} file={p.file} blocks={p.blocks} anchor={p.anchor} />
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
