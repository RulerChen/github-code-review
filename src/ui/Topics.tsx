import { useEffect, useRef, useState } from "react";
import { changeIds, editedInto, oldCommitOf } from "../shared/hunks";
import type { Block, DiffRepo, FileDiff, Review, Thread } from "../shared/types";
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
  edited: number;
  left: number;
  signature: string;
  firstFor: Set<string>;
}

export function buildTopics(review: Review, files: FileDiff[], repos: DiffRepo[]): TopicView[] {
  const known = new Set(files.flatMap(changeIds));
  const claimed = new Set(review.topics.flatMap((t) => t.ids));
  const commitOf = oldCommitOf(repos);
  const seen = new Set<string>();

  return review.topics.map((t, index) => {
    const ids = [...new Set(t.ids)];
    const present = ids.filter((id) => known.has(id));
    const edited = ids.filter((id) => !known.has(id)).map((id) => editedInto(review.changes?.[id], files, commitOf, claimed));
    const chosen = new Set([...present, ...edited.flat()]);

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
      changeCount: chosen.size,
      edited: edited.length,
      left: edited.filter((into) => into.length === 0).length,
      signature: [...chosen].join(","),
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

function outdatedNote({ edited, left }: TopicView): string {
  const what = `${plural(edited, "change")} ${edited === 1 ? "was" : "were"} edited after Claude made these topics`;
  const gone = left === 0 ? "." : left === edited ? " and left this topic." : `, and ${left} of them left this topic.`;
  return `${what}${gone} Edit topics and update them to ${left === 0 ? "explain the new code" : `bring ${left === 1 ? "it" : "them"} back`}.`;
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
        {topic.edited > 0 && (
          <span className="outdated-label" title={outdatedNote(topic)}>
            Outdated
          </span>
        )}
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
          {topic.edited > 0 && <p className="topic-note">{outdatedNote(topic)}</p>}
          {topic.parts.map((p) => (
            <FileCard key={p.file.path} file={p.file} blocks={p.blocks} anchor={p.anchor} />
          ))}
        </div>
      )}
    </section>
  );
}
