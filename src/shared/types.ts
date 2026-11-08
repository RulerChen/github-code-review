// Data shapes shared by the diff engine (Node) and the review UI (browser).
// Keep this file free of runtime imports.

export type FileStatus = "added" | "deleted" | "modified" | "renamed";

/**
 * The smallest unit of change: one `git diff -U0` hunk. The id is derived from
 * the path and the changed text, so it survives edits elsewhere in the file
 * that shift line numbers, and changes when this change itself is edited.
 */
export interface Block {
  id: string;
  /** 0-based index of the first removed line, or the insertion point when oldCount is 0. */
  oldStart: number;
  oldCount: number;
  /** 0-based index of the first added line, or the deletion point when newCount is 0. */
  newStart: number;
  newCount: number;
  del: string[];
  add: string[];
  /** The last removed / added line has no trailing newline. */
  oldNoEol: boolean;
  newNoEol: boolean;
  /** Text git prints after the second "@@" (usually the enclosing function). */
  section: string;
}

export interface DiffLine {
  kind: "context" | "add" | "del";
  /** 1-based line numbers. */
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
  /** Previous path, set only for renames. */
  oldPath: string | null;
  status: FileStatus;
  binary: boolean;
  /** File contents were too large to load; the diff has no context lines. */
  tooLarge: boolean;
  modeChange: { from: string; to: string } | null;
  additions: number;
  deletions: number;
  blocks: Block[];
  hunks: DisplayHunk[];
  /** Full text of each side for syntax highlighting; null when absent, binary, too large or inconsistent. */
  oldContent: string | null;
  newContent: string | null;
}

export interface DiffResult {
  repoRoot: string;
  base: string;
  /** Resolved commit of `base`; null when the repository has no commits yet. */
  baseCommit: string | null;
  files: FileDiff[];
}
