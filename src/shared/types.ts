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
  /** Marked linguist-generated in .gitattributes. Like GitHub, the page does not render it until asked. */
  generated: boolean;
  /** Over GitHub's per-file limit of 20,000 changed lines or 500 KB: blocks keep their ids and ranges but no lines. */
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

/** Every change of one comparison grouped into topics by Claude, from the terminal or from the page. */
export interface Review {
  /** The repository root. */
  repo: string;
  compare: Comparison;
  focus: string | null;
  topics: Topic[];
  createdAt: string;
  /** A view of the repository, for a page showing another repository to switch to. */
  view: string;
}

/** Claude grouping a comparison's changes into topics, asked from the page. It goes once the review arrives. */
export interface Grouping {
  repo: string;
  compare: Comparison;
  focus: string | null;
  /** What Claude is doing while it runs. */
  activity: string | null;
  /** Why it failed, once it has. */
  error: string | null;
}

export type ThreadAnchor = LineAnchor | FileAnchor | TopicAnchor;

export interface LineAnchor {
  path: string;
  side: "old" | "new";
  start: number;
  end: number;
  /** The commit the lines come from, or null for the working tree. */
  commit: string | null;
}

/** A comment on the whole file. It stays on the file whichever versions the page compares. */
export interface FileAnchor {
  path: string;
  side: null;
  start: null;
  end: null;
  /** The commit of the new side when the comment was written, or null for the working tree. */
  commit: string | null;
}

/** A comment on a topic of Claude's review as a whole. */
export interface TopicAnchor {
  /** The topic's title. */
  topic: string;
  /** The comparison the review grouped, since reviews of other comparisons can have a topic with the same title. */
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
  /** A user comment without @claude waits in the pending review until the user submits the review. */
  draft: boolean;
  /** The number of the review the comment was submitted with. */
  review: number | null;
  /** When the user last edited the comment, or null if never. */
  editedAt: string | null;
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
  /** Changes whenever the diff may have changed. The page polls it to show that newer changes exist. */
  version: string;
  /** The comparison Claude opened the viewer with, shown when the page names none. */
  opened: Comparison;
  /** Every review in this session, oldest first: at most one per repository and comparison. */
  reviews: Review[];
  groupings: Grouping[];
  threads: Thread[];
  /** Whether Claude is waiting for a review right now, so submitting one starts it at once. */
  listening: boolean;
}

/** What one repository's diff compares. */
export interface RefRange {
  base: string;
  /** null for the working tree, including untracked files. */
  head: string | null;
  /** Compare from the merge base of base and head, like GitHub's base...head, instead of from base itself. */
  threeDot: boolean;
}

/** A range of one repository, by its directory. */
export interface RepoRange extends RefRange {
  /** Its directory relative to the diff's repoRoot, which starts the paths of its files: "" for repoRoot itself. */
  dir: string;
}

export interface Comparison extends RefRange {
  /**
   * The repositories that compare a range of their own instead, sorted by directory. Only a diff that covers the
   * repositories under a directory can have them.
   */
  overrides: RepoRange[];
}

export interface CommitInfo {
  sha: string;
  parents: string[];
  author: string;
  date: string;
  subject: string;
  /** The repository's directory, when the diff covers the repositories under a directory. */
  repo?: string;
}

/** One repository of a diff, with the range it compares: the comparison's own, or its override. */
export interface DiffRepo extends RepoRange {
  baseCommit: string | null;
  headCommit: string | null;
  oldCommit: string | null;
  /** Why the comparison failed in this repository, which then has no files in the diff. */
  error: string | null;
}

export interface DiffResult extends Comparison {
  /** The repository root, or the directory whose repositories the diff covers. */
  repoRoot: string;
  /** These three are null when the diff covers several repositories. Each one's are in repos. */
  baseCommit: string | null;
  headCommit: string | null;
  /** The commit the old side comes from: the merge base in a three-dot comparison, otherwise baseCommit. */
  oldCommit: string | null;
  /**
   * The repository, or each repository directly under repoRoot when repoRoot is not one itself. Their files share
   * one diff, with paths starting with the repository's directory.
   */
  repos: DiffRepo[];
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
