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
  anchor: ThreadAnchor;
  snippet: string;
  comments: ThreadComment[];
}

export interface ViewData {
  diff: DiffResult;
  review: Review | null;
  threads: Thread[];
}

export interface DiffResult {
  repoRoot: string;
  base: string;
  baseCommit: string | null;
  files: FileDiff[];
}
