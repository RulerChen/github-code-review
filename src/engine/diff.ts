import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import { buildHunks, splitLines } from "../shared/hunks.js";
import type { Block, DiffLine, DiffResult, DisplayHunk, FileDiff, FileStatus } from "../shared/types.js";
import { git } from "./git.js";

export type { Block, DiffLine, DiffResult, DisplayHunk, FileDiff, FileStatus };

export const MAX_CONTENT_BYTES = 1024 * 1024;
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export async function computeDiff(repo: string, base = "HEAD"): Promise<DiffResult> {
  if (base.startsWith("-")) throw new Error(`Invalid git ref: ${base}`);
  const repoRoot = (await git(repo, ["rev-parse", "--show-toplevel"])).toString("utf8").trim();
  const baseCommit = await resolveBase(repoRoot, base);
  const treeish = baseCommit ?? EMPTY_TREE;

  const diffArgs = ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--submodule=short", "--find-renames"];
  const [nameStatus, patch, untracked] = await Promise.all([
    git(repoRoot, [...diffArgs, "--name-status", "-z", treeish, "--"]),
    git(repoRoot, [...diffArgs, "-U0", treeish, "--"]),
    git(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);

  const entries = parseNameStatus(nameStatus);
  let sections: (string[] | undefined)[] = splitSections(patch.toString("utf8"));

  if (sections.length !== entries.length) sections = [];

  const tracked = await mapLimit(entries.map((e, i) => [e, sections[i]] as const), 8, ([entry, section]) =>
    buildTrackedFile(repoRoot, diffArgs, treeish, baseCommit, entry, section),
  );
  const untrackedPaths = untracked.toString("utf8").split("\0").filter(Boolean);
  const added = (await mapLimit(untrackedPaths, 8, (p) => buildUntrackedFile(repoRoot, p))).filter(
    (f): f is FileDiff => f !== null,
  );

  const files = [...tracked, ...added].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { repoRoot, base, baseCommit, files };
}

export function summarize(result: DiffResult): string {
  const add = result.files.reduce((s, f) => s + f.additions, 0);
  const del = result.files.reduce((s, f) => s + f.deletions, 0);
  const n = result.files.length;
  return `${n} file${n === 1 ? "" : "s"} changed, +${add} -${del} against ${result.base}`;
}

async function resolveBase(repoRoot: string, base: string): Promise<string | null> {
  try {
    return (await git(repoRoot, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`])).toString("utf8").trim();
  } catch {
    if (base === "HEAD") return null;
    throw new Error(`Unknown git ref: ${base}`);
  }
}

interface NameStatusEntry {
  code: string;
  path: string;
  oldPath: string | null;
}

function parseNameStatus(buf: Buffer): NameStatusEntry[] {
  const parts = buf.toString("utf8").split("\0");
  const out: NameStatusEntry[] = [];
  let i = 0;
  while (i < parts.length - 1) {
    const code = parts[i++]!;
    if (code.startsWith("R") || code.startsWith("C")) {
      const oldPath = parts[i++]!;
      out.push({ code: code[0]!, path: parts[i++]!, oldPath });
    } else {
      out.push({ code: code[0]!, path: parts[i++]!, oldPath: null });
    }
  }
  return out;
}

function statusOf(code: string): FileStatus {
  if (code === "A") return "added";
  if (code === "D") return "deleted";
  if (code === "R") return "renamed";
  return "modified";
}

function splitSections(patch: string): string[][] {
  const sections: string[][] = [];
  let cur: string[] | null = null;
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      cur = [];
      sections.push(cur);
    }
    cur?.push(line);
  }
  return sections;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

type RawBlock = Omit<Block, "id">;

interface ParsedSection {
  binary: boolean;
  modeChange: { from: string; to: string } | null;
  blocks: RawBlock[];
}

function parseSection(lines: string[]): ParsedSection {
  let binary = false;
  let oldMode: string | null = null;
  let newMode: string | null = null;
  const blocks: RawBlock[] = [];
  let cur: RawBlock | null = null;
  let lastSide: "del" | "add" | null = null;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const m = HUNK_RE.exec(line);
      if (!m) throw new Error(`Unparseable hunk header: ${line}`);
      const oldCount = m[2] === undefined ? 1 : Number(m[2]);
      const newCount = m[4] === undefined ? 1 : Number(m[4]);

      cur = {
        oldStart: oldCount === 0 ? Number(m[1]) : Number(m[1]) - 1,
        oldCount,
        newStart: newCount === 0 ? Number(m[3]) : Number(m[3]) - 1,
        newCount,
        del: [],
        add: [],
        oldNoEol: false,
        newNoEol: false,
        section: m[5]!.trim(),
      };
      blocks.push(cur);
      lastSide = null;
    } else if (!cur) {
      if (line.startsWith("Binary files ") || line === "GIT binary patch") binary = true;
      else if (line.startsWith("old mode ")) oldMode = line.slice("old mode ".length);
      else if (line.startsWith("new mode ")) newMode = line.slice("new mode ".length);
    } else if (line.startsWith("-")) {
      cur.del.push(line.slice(1));
      lastSide = "del";
    } else if (line.startsWith("+")) {
      cur.add.push(line.slice(1));
      lastSide = "add";
    } else if (line.startsWith("\\")) {
      if (lastSide === "del") cur.oldNoEol = true;
      else if (lastSide === "add") cur.newNoEol = true;
    }
  }

  for (const b of blocks) {
    if (b.del.length !== b.oldCount || b.add.length !== b.newCount) {
      throw new Error(`Hunk line count mismatch at -${b.oldStart} +${b.newStart}`);
    }
  }
  const modeChange = oldMode && newMode ? { from: oldMode, to: newMode } : null;
  return { binary, modeChange, blocks };
}

function assignIds(filePath: string, raws: RawBlock[]): Block[] {
  const seen = new Map<string, number>();
  return raws.map((r) => {
    const h = createHash("sha256")
      .update(filePath)
      .update("\0")
      .update(r.del.join("\n"))
      .update("\0")
      .update(r.add.join("\n"))
      .update(`\0${r.oldNoEol ? 1 : 0}${r.newNoEol ? 1 : 0}`)
      .digest("hex")
      .slice(0, 12);

    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    return { id: n === 1 ? h : `${h}-${n}`, ...r };
  });
}

type Content = { kind: "text"; text: string } | { kind: "binary" } | { kind: "tooLarge" } | { kind: "absent" };

function classify(buf: Buffer): Content {
  if (buf.length > MAX_CONTENT_BYTES) return { kind: "tooLarge" };
  if (buf.subarray(0, 8000).includes(0)) return { kind: "binary" };
  return { kind: "text", text: buf.toString("utf8") };
}

async function readBase(repoRoot: string, commit: string, filePath: string): Promise<Content> {
  try {
    return classify(await git(repoRoot, ["cat-file", "blob", `${commit}:${filePath}`]));
  } catch {
    return { kind: "absent" };
  }
}

async function readWorkTree(repoRoot: string, filePath: string): Promise<Content> {
  const abs = path.join(repoRoot, filePath);
  try {
    const st = await lstat(abs);
    if (st.isSymbolicLink()) return { kind: "text", text: await readlink(abs) };
    if (!st.isFile()) return { kind: "absent" };
    if (st.size > MAX_CONTENT_BYTES) return { kind: "tooLarge" };
    return classify(await readFile(abs));
  } catch {
    return { kind: "absent" };
  }
}

const stripCr = (s: string) => (s.endsWith("\r") ? s.slice(0, -1) : s);

function matchesBlocks(lines: string[], blocks: Block[], side: "old" | "new"): boolean {
  return blocks.every((b) => {
    const [start, want] = side === "old" ? [b.oldStart, b.del] : [b.newStart, b.add];
    return want.every((t, k) => {
      const got = lines[start + k];
      return got !== undefined && stripCr(got) === stripCr(t);
    });
  });
}

async function buildTrackedFile(
  repoRoot: string,
  diffArgs: string[],
  treeish: string,
  baseCommit: string | null,
  entry: NameStatusEntry,
  section: string[] | undefined,
): Promise<FileDiff> {
  const status = statusOf(entry.code);
  if (!section) {
    const paths = entry.oldPath ? [entry.oldPath, entry.path] : [entry.path];
    const one = await git(repoRoot, [...diffArgs, "-U0", treeish, "--", ...paths]);
    section = splitSections(one.toString("utf8"))[0] ?? [];
  }
  const parsed = parseSection(section);
  const blocks = assignIds(entry.path, parsed.blocks);

  const [oldC, newC] = await Promise.all([
    status === "added" || !baseCommit ? Promise.resolve<Content>({ kind: "absent" }) : readBase(repoRoot, baseCommit, entry.oldPath ?? entry.path),
    status === "deleted" ? Promise.resolve<Content>({ kind: "absent" }) : readWorkTree(repoRoot, entry.path),
  ]);
  const binary = parsed.binary || oldC.kind === "binary" || newC.kind === "binary";

  let oldLines = oldC.kind === "text" ? splitLines(oldC.text) : null;
  let newLines = newC.kind === "text" ? splitLines(newC.text) : null;

  if (oldLines && !matchesBlocks(oldLines, blocks, "old")) oldLines = null;
  if (newLines && !matchesBlocks(newLines, blocks, "new")) newLines = null;

  return {
    path: entry.path,
    oldPath: status === "renamed" ? entry.oldPath : null,
    status,
    binary,
    tooLarge: oldC.kind === "tooLarge" || newC.kind === "tooLarge",
    modeChange: parsed.modeChange,
    additions: blocks.reduce((s, b) => s + b.newCount, 0),
    deletions: blocks.reduce((s, b) => s + b.oldCount, 0),
    blocks: binary ? [] : blocks,
    hunks: binary ? [] : buildHunks(blocks, oldLines, newLines),
    oldContent: oldLines && oldC.kind === "text" ? oldC.text : null,
    newContent: newLines && newC.kind === "text" ? newC.text : null,
  };
}

async function buildUntrackedFile(repoRoot: string, filePath: string): Promise<FileDiff | null> {
  const c = await readWorkTree(repoRoot, filePath);
  if (c.kind === "absent") return null;
  const base: FileDiff = {
    path: filePath,
    oldPath: null,
    status: "added",
    binary: c.kind === "binary",
    tooLarge: c.kind === "tooLarge",
    modeChange: null,
    additions: 0,
    deletions: 0,
    blocks: [],
    hunks: [],
    oldContent: null,
    newContent: null,
  };
  if (c.kind !== "text") return base;
  const lines = splitLines(c.text);
  if (lines.length === 0) return base;
  const blocks = assignIds(filePath, [
    {
      oldStart: 0,
      oldCount: 0,
      newStart: 0,
      newCount: lines.length,
      del: [],
      add: lines,
      oldNoEol: false,
      newNoEol: !c.text.endsWith("\n"),
      section: "",
    },
  ]);
  return { ...base, additions: lines.length, blocks, hunks: buildHunks(blocks, null, lines), newContent: c.text };
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
