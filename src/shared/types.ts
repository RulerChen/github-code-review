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
  /** First and last block in the hunk. Expansion above and below the hunk is keyed by them. */
  firstId: string;
  lastId: string;
  /** Unchanged lines hidden right above and below the hunk that expanding can show. */
  hiddenAbove: number;
  hiddenBelow: number;
  /** The lines hidden above are the same ones hidden below the previous hunk, with no change between. */
  joinsPrevious: boolean;
}

/** Unchanged lines to show beyond the default context, above and below each block, by block id. */
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
  focus: string | null;
  topics: Topic[];
}

export interface ThreadAnchor {
  path: string;
  side: "old" | "new";
  start: number;
  end: number;
  /** The commit the lines come from, or null for the working tree. */
  commit: string | null;
}

export interface ThreadComment {
  id: string;
  author: "user" | "claude";
  body: string;
  status: "done" | "pending" | "error";
  activity: string | null;
  createdAt: string;
}

export interface Thread {
  id: string;
  /** Bumped on every change the server sends, so the page keeps the newest copy. */
  rev: number;
  anchor: ThreadAnchor;
  snippet: string;
  comments: ThreadComment[];
}

export interface ViewData {
  diff: DiffResult;
  /** The comparison Claude opened the viewer with. The review's topics belong to it. */
  opened: Comparison;
  review: Review | null;
  threads: Thread[];
}

export interface Comparison {
  base: string;
  /** null for the working tree, including untracked files. */
  head: string | null;
  /** Compare from the merge base of base and head, like GitHub's base...head, instead of from base itself. */
  threeDot: boolean;
}

export interface CommitInfo {
  sha: string;
  parents: string[];
  author: string;
  date: string;
  subject: string;
}

export interface DiffResult extends Comparison {
  repoRoot: string;
  baseCommit: string | null;
  headCommit: string | null;
  /** The commit the old side comes from: the merge base in a three-dot comparison, otherwise baseCommit. */
  oldCommit: string | null;
  /** Commits in base..head, oldest first, at most MAX_COMMITS of the newest. */
  commits: CommitInfo[];
  commitCount: number;
  files: FileDiff[];
}

export interface RefList {
  branches: string[];
  tags: string[];
  commits: CommitInfo[];
}
