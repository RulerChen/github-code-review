import { useEffect, useRef, useState } from "react";
import { changeIds } from "../shared/hunks";
import type { Block, FileDiff, Review, Thread } from "../shared/types";
import { plural } from "../shared/util";
import { keepHeaderInPlace } from "./anchor";
import { type CommentsApi, onShownVersion, ThreadList, useComments } from "./comments";
import { CollapseButton, CommentButton, ViewedToggle } from "./controls";
import { hasLine } from "./DiffTable";
import { baseHunksOf, FileCard } from "./FileCard";
import { Markdown } from "./Markdown";

interface TopicPart {
  file: FileDiff;
  blocks: Block[];
  anchor: string;
}

export interface TopicView {
  key: string;
  anchor: string;
  title: string;
  summary: string;
  parts: TopicPart[];
  changeCount: number;
  stale: number;
  signature: string;
  firstFor: Set<string>;
}

export function buildTopics(review: Review, files: FileDiff[]): TopicView[] {
  const known = new Set(files.flatMap(changeIds));
  const seen = new Set<string>();

  return review.topics.map((t, index) => {
    const present = [...new Set(t.ids)].filter((id) => known.has(id));
    const chosen = new Set(present);

    const parts: TopicPart[] = [];
    const firstFor = new Set<string>();
    files.forEach((f, fi) => {
      if (!changeIds(f).some((id) => chosen.has(id))) return;
      parts.push({ file: f, blocks: f.blocks.filter((b) => chosen.has(b.id)), anchor: `topic-${index}-file-${fi}` });
      if (!seen.has(f.path)) firstFor.add(f.path);
      seen.add(f.path);
    });

    return {
      key: `topic:${t.title}`,
      anchor: `topic-${index}`,
      title: t.title,
      summary: t.summary,
      parts,
      changeCount: present.length,
      stale: t.ids.length - present.length,
      signature: present.join(","),
      firstFor,
    };
  });
}

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
  opening: { anchor: string } | null;
  onToggleViewed: () => void;
}

export function TopicSection({ topic, viewed, opening, onToggleViewed }: SectionProps) {
  const [collapsed, setCollapsed] = useState(viewed);
  useEffect(() => setCollapsed(viewed), [viewed]);
  const [opened, setOpened] = useState(opening);
  if (opening !== opened) {
    setOpened(opening);
    if (opening?.anchor.startsWith(`${topic.anchor}-`)) setCollapsed(false);
  }
  const { revealSeq, peekReveal, versions, threadsForTopic, create } = useComments();
  useEffect(() => {
    const thread = peekReveal();
    if (thread && topicShows(topic, thread, versions)) setCollapsed(false);
  }, [revealSeq]);
  const [commenting, setCommenting] = useState(false);
  const threads = threadsForTopic(topic.title);

  const header = useRef<HTMLElement>(null);
  const files = topic.parts.map((p) => p.file.path);

  return (
    <section className={`topic${viewed ? " is-viewed" : ""}`} id={topic.anchor}>
      <header className="topic-header" ref={header}>
        <CollapseButton
          collapsed={collapsed}
          noun="topic"
          onClick={() => keepHeaderInPlace(header.current, () => setCollapsed(!collapsed))}
        />
        <h2 className="topic-title">{topic.title}</h2>
        <span className="topic-meta">
          {plural(topic.changeCount, "change")} in {plural(files.length, "file")}
          {threads.length > 0 && ` · ${plural(threads.length, "comment")}`}
        </span>
        <span className="spacer" />
        <CommentButton
          label="Comment on this topic"
          onClick={() =>
            keepHeaderInPlace(header.current, () => {
              setCollapsed(false);
              setCommenting(true);
            })
          }
        />
        <ViewedToggle
          viewed={viewed}
          onChange={() =>
            keepHeaderInPlace(header.current, () => {
              setCollapsed(!viewed);
              onToggleViewed();
            })
          }
        />
      </header>

      {!collapsed && (
        <div className="topic-body">
          {topic.summary && <Markdown className="topic-summary" text={topic.summary} />}
          <ThreadList
            className="topic-threads"
            threads={threads}
            commenting={commenting}
            placeholder="Comment on this topic"
            onCreate={(body, single) => {
              const anchor = { topic: topic.title, path: null, side: null, start: null, end: null, commit: null };
              const snippet = [`Files: ${files.join(", ")}`, topic.summary].filter(Boolean).join("\n\n");
              return create(anchor, snippet, body, single);
            }}
            onClose={() => setCommenting(false)}
          />
          {topic.stale > 0 && (
            <p className="topic-note">
              {plural(topic.stale, "change")} {topic.stale === 1 ? "was" : "were"} edited after Claude grouped them and left
              this topic. Group again to bring {topic.stale === 1 ? "it" : "them"} back.
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
  isViewed: (topic: TopicView) => boolean;
  onSelect: (anchor: string) => void;
}

export function TopicList({ topics, isViewed, onSelect }: ListProps) {
  return (
    <nav className="topic-list" aria-label="Topics">
      <h2 className="topic-list-title">Topics</h2>
      <ul>
        {topics.map((t) => (
          <li key={t.key}>
            <button className={`topic-link${isViewed(t) ? " is-viewed" : ""}`} onClick={() => onSelect(t.anchor)}>
              <span className="topic-link-title">{t.title}</span>
              <span className="topic-link-meta">
                {plural(t.changeCount, "change")} in {plural(t.parts.length, "file")}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
