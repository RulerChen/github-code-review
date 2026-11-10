export type FileStatus = "added" | "deleted" | "modified" | "renamed";

export interface Block {
  id: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  del: string[];
  add: string[];
  oldNoEol: boolean;
  newNoEol: boolean;
  section: string;
}

export interface DiffLine {
  kind: "context" | "add" | "del";
  oldNo: number | null;
  newNo: number | null;
  text: string;
  blockId: string | null;
  noEol: boolean;
}

export interface DisplayHunk {
  header: string;
  lines: DiffLine[];
  firstId: string;
  lastId: string;
  hiddenAbove: number;
  hiddenBelow: number;
  joinsPrevious: boolean;
}

export interface Expansion {
  above: Record<string, number>;
  below: Record<string, number>;
}

export interface FileDiff {
  path: string;
  oldPath: string | null;
  status: FileStatus;
  binary: boolean;
  tooLarge: boolean;
  generated: boolean;
  lazy: boolean;
  diffTooLarge: boolean;
  modeChange: { from: string; to: string } | null;
  additions: number;
  deletions: number;
  blocks: Block[];
  hunks: DisplayHunk[];
  oldContent: string | null;
  newContent: string | null;
}

export interface Topic {
  title: string;
  summary: string;
  ids: string[];
  related: boolean;
}

export interface Review {
  repo: string;
  compare: Comparison;
  focus: string | null;
  topics: Topic[];
  createdAt: string;
  view: string;
}

export interface Grouping {
  repo: string;
  compare: Comparison;
  focus: string | null;
  activity: string | null;
  error: string | null;
}

export type ThreadAnchor = LineAnchor | FileAnchor | TopicAnchor;

export interface LineAnchor {
  path: string;
  side: "old" | "new";
  start: number;
  end: number;
  commit: string | null;
}

export interface FileAnchor {
  path: string;
  side: null;
  start: null;
  end: null;
  commit: string | null;
}

export interface TopicAnchor {
  topic: string;
  compare: Comparison;
  path: null;
  side: null;
  start: null;
  end: null;
  commit: null;
}

export interface ThreadComment {
  id: string;
  author: "user" | "claude";
  body: string;
  status: "done" | "pending" | "error";
  activity: string | null;
  createdAt: string;
  draft: boolean;
  review: number | null;
  editedAt: string | null;
}

export interface Thread {
  id: string;
  rev: number;
  anchor: ThreadAnchor;
  snippet: string;
  comments: ThreadComment[];
}

export interface ViewData {
  diff: DiffResult;
  version: string;
  opened: Comparison;
  reviews: Review[];
  groupings: Grouping[];
  threads: Thread[];
  listening: boolean;
}

export interface RefRange {
  base: string;
  head: string | null;
  threeDot: boolean;
}

export interface RepoRange extends RefRange {
  dir: string;
}

export interface Comparison extends RefRange {
  overrides: RepoRange[];
}

export interface CommitInfo {
  sha: string;
  parents: string[];
  author: string;
  date: string;
  subject: string;
  repo?: string;
}

export interface DiffRepo extends RepoRange {
  baseCommit: string | null;
  headCommit: string | null;
  oldCommit: string | null;
  error: string | null;
}

export interface DiffResult extends Comparison {
  repoRoot: string;
  baseCommit: string | null;
  headCommit: string | null;
  oldCommit: string | null;
  repos: DiffRepo[];
  commits: CommitInfo[];
  commitCount: number;
  files: FileDiff[];
}

export interface RefList {
  branches: string[];
  tags: string[];
  commits: CommitInfo[];
  repoCount: number;
  partial: [ref: string, repos: number][];
}
