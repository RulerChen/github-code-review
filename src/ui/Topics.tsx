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
  related: boolean;
  parts: TopicPart[];
  changeCount: number;
  stale: number;
  signature: string;
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
  const [collapsed, setCollapsed] = useState(viewed || !topic.related);
  useEffect(() => setCollapsed(viewed || !topic.related), [viewed]);
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
              setCollapsed(!viewed || !topic.related);
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
              {plural(topic.stale, "change")} {topic.stale === 1 ? "was" : "were"} edited after Claude grouped them and now
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
  isViewed: (topic: TopicView) => boolean;
  onSelect: (anchor: string) => void;
}

export function TopicList({ topics, isViewed, onSelect }: ListProps) {
  const firstUnrelated = topics.findIndex((t) => !t.related);
  return (
    <nav className="topic-list" aria-label="Topics">
      <h2 className="topic-list-title">Topics</h2>
      <ul>
        {topics.map((t, i) => (
          <li key={t.key}>
            {i === firstUnrelated && <p className="topic-list-heading">Not related to the focus</p>}
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
