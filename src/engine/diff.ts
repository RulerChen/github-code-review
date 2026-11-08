import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import { buildHunks, splitLines } from "../shared/hunks.js";
import type { Block, CommitInfo, Comparison, DiffLine, DiffResult, DisplayHunk, FileDiff, FileStatus, RefList } from "../shared/types.js";
import { git } from "./git.js";

export type { Block, CommitInfo, Comparison, DiffLine, DiffResult, DisplayHunk, FileDiff, FileStatus };

export const MAX_CONTENT_BYTES = 1024 * 1024;
// GitHub stops showing a file's diff past 20,000 lines or 500 KB. Characters stand in for bytes.
export const MAX_DIFF_LINES = 20_000;
export const MAX_DIFF_CHARS = 500 * 1024;
export const MAX_COMMITS = 250;
const BATCH_BYTES = 64 * 1024 * 1024;
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export async function computeDiff(repo: string, compare: Partial<Comparison> = {}): Promise<DiffResult> {
  const base = compare.base ?? "HEAD";
  const head = compare.head ?? null;
  const threeDot = compare.threeDot ?? true;
  checkRefs(base, head);
  const repoRoot = (await git(repo, ["rev-parse", "--show-toplevel"])).toString("utf8").trim();
  const [baseCommit, headCommit, headOfRepo] = await Promise.all([
    resolveCommit(repoRoot, base),
    head === null ? null : resolveCommit(repoRoot, head),
    head === null ? resolveCommit(repoRoot, "HEAD") : null,
  ]);
  if (head !== null && headCommit === null) throw new Error(`Unknown git ref: ${head}`);
  const tip = headCommit ?? headOfRepo;
  const oldCommit = threeDot && baseCommit && tip ? await mergeBase(repoRoot, baseCommit, tip, base, head) : baseCommit;
  const range = headCommit ? [oldCommit ?? EMPTY_TREE, headCommit] : [oldCommit ?? EMPTY_TREE];

  const diffArgs = ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--submodule=short", "--find-renames"];
  const [raw, patch, untracked, commits] = await Promise.all([
    git(repoRoot, [...diffArgs, "--raw", "-z", "--no-abbrev", ...range, "--"]),
    git(repoRoot, [...diffArgs, "-U0", ...range, "--"]),
    head === null ? git(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"]) : Buffer.alloc(0),
    listCommits(repoRoot, baseCommit, tip),
  ]);

  const entries = parseRaw(raw);
  let sections: (string[] | undefined)[] = splitSections(patch.toString("utf8"));

  if (sections.length !== entries.length) sections = [];

  const untrackedPaths = untracked.toString("utf8").split("\0").filter(Boolean);
  const blobIds = entries.flatMap((e) => {
    const status = statusOf(e.code);
    return [status !== "added" && oldCommit ? e.oldOid : null, status !== "deleted" && headCommit ? e.newOid : null];
  });
  const [blobs, generated] = await Promise.all([
    readBlobs(repoRoot, blobIds.filter((id): id is string => id !== null)),
    generatedPaths(repoRoot, [...entries.map((e) => e.path), ...untrackedPaths], headCommit),
  ]);

  const tracked = await mapLimit(entries.map((e, i) => [e, sections[i]] as const), 8, ([entry, section]) =>
    buildTrackedFile(repoRoot, diffArgs, range, oldCommit, headCommit, blobs, entry, section),
  );
  const added = (await mapLimit(untrackedPaths, 8, (p) => buildUntrackedFile(repoRoot, p))).filter(
    (f): f is FileDiff => f !== null,
  );

  const files = [...tracked, ...added].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const f of files) f.generated = generated.has(f.path);
  return { repoRoot, base, head, threeDot, baseCommit, headCommit, oldCommit, ...commits, files };
}

function checkRefs(base: string, head: string | null): void {
  for (const ref of [base, head]) {
    if (ref !== null && (ref === "" || ref.startsWith("-"))) throw new Error(`Invalid git ref: ${ref}`);
  }
}

/**
 * A fingerprint of what computeDiff reads, at a fraction of its cost: the commits the refs name and, for the
 * working tree, every path git status lists with a hash of its content. A file missing from git status has
 * HEAD's content. Take it before the diff, so a change made while the diff runs shows up as a new version.
 */
export async function diffVersion(repo: string, compare: Partial<Comparison> = {}): Promise<string> {
  const base = compare.base ?? "HEAD";
  const head = compare.head ?? null;
  checkRefs(base, head);
  const [commits, status] = await Promise.all([
    // Exits 128 for a ref that names nothing, such as HEAD before the first commit. The output is still stable.
    git(repo, ["rev-parse", `${base}^{commit}`, `${head ?? "HEAD"}^{commit}`], [0, 128]),
    head === null ? git(repo, ["status", "--porcelain", "-z", "--untracked-files=all"]) : null,
  ]);
  const hash = createHash("sha256").update(commits);
  if (status) {
    // Records are "XY path", and a rename is followed by its source path. Staging a change leaves the diff
    // as it was, so of XY only whether git tracks the path counts.
    const records = status.toString("utf8").split("\0");
    const entries: string[] = [];
    const paths: string[] = [];
    for (let i = 0; i < records.length; i++) {
      const r = records[i]!;
      if (r.length < 4) continue;
      const from = /[RC]/.test(r.slice(0, 2)) ? records[++i] : "";
      entries.push(`${r.startsWith("??") ? "?" : "t"} ${r.slice(3)} ${from}`);
      paths.push(r.slice(3));
    }
    const known = contentHashes.get(repo);
    const next = new Map<string, FileHash>();
    const versions = await mapLimit(paths, 16, (p) => fileVersion(path.join(repo, p), known, next));
    contentHashes.set(repo, next);
    hash.update(entries.join("\0")).update(versions.join("\0"));
  }
  return hash.digest("hex").slice(0, 16);
}

interface FileHash {
  stat: string;
  hash: string;
}

// The content hash of each working-tree file git status listed last time, by repository, reused while the
// file's mtime, size and mode stay the same.
const contentHashes = new Map<string, Map<string, FileHash>>();

// Saving a file without changing it, or undoing an edit, must not count as a change, so a file goes by its
// content. Files too large for the diff to show, and symlinks, go by their stat.
async function fileVersion(abs: string, known: Map<string, FileHash> | undefined, next: Map<string, FileHash>): Promise<string> {
  try {
    const st = await lstat(abs, { bigint: true });
    const stat = `${st.mtimeNs} ${st.size} ${st.mode}`;
    if (!st.isFile() || st.size > MAX_CONTENT_BYTES) return stat;
    let entry = known?.get(abs);
    if (entry?.stat !== stat) entry = { stat, hash: `${createHash("sha1").update(await readFile(abs)).digest("hex")} ${st.mode}` };
    next.set(abs, entry);
    return entry.hash;
  } catch {
    return "-";
  }
}

export function summarize(result: DiffResult): string {
  const add = result.files.reduce((s, f) => s + f.additions, 0);
  const del = result.files.reduce((s, f) => s + f.deletions, 0);
  const n = result.files.length;
  const c = result.commitCount;
  const fromMergeBase = result.oldCommit !== result.baseCommit && result.oldCommit ? ` from their merge base ${result.oldCommit.slice(0, 7)}` : "";
  const what = result.head === null ? `the working tree against ${result.base}` : `${result.base}${result.threeDot ? "..." : ".."}${result.head}`;
  const commits = c ? `, ${c} commit${c === 1 ? "" : "s"}` : "";
  return `${n} file${n === 1 ? "" : "s"} changed, +${add} -${del}, comparing ${what}${fromMergeBase}${commits}`;
}

/** The commit a ref names, or null for HEAD in a repository with no commits yet. */
async function resolveCommit(repoRoot: string, ref: string): Promise<string | null> {
  try {
    return (await git(repoRoot, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).toString("utf8").trim();
  } catch {
    if (ref === "HEAD") return null;
    throw new Error(`Unknown git ref: ${ref}`);
  }
}

async function mergeBase(repoRoot: string, a: string, b: string, base: string, head: string | null): Promise<string> {
  const out = (await git(repoRoot, ["merge-base", a, b], [0, 1])).toString("utf8").trim();
  if (out) return out;
  throw new Error(`${base} and ${head ?? "HEAD"} share no history, so there is no merge base. Compare them directly instead.`);
}

const COMMIT_FORMAT = "%H%x1f%P%x1f%an%x1f%aI%x1f%s";

async function listCommits(repoRoot: string, from: string | null, to: string | null): Promise<{ commits: CommitInfo[]; commitCount: number }> {
  if (!from || !to) return { commits: [], commitCount: 0 };
  const range = `${from}..${to}`;
  const [log, count] = await Promise.all([
    git(repoRoot, ["log", "-z", `-n${MAX_COMMITS}`, "--reverse", `--format=${COMMIT_FORMAT}`, range, "--"]),
    git(repoRoot, ["rev-list", "--count", range, "--"]),
  ]);
  return { commits: parseCommits(log), commitCount: Number(count.toString("utf8").trim()) };
}

export function parseCommits(buf: Buffer): CommitInfo[] {
  return buf
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((rec) => {
      const [sha = "", parents = "", author = "", date = "", subject = ""] = rec.split("\x1f");
      return { sha, parents: parents.split(" ").filter(Boolean), author, date, subject };
    });
}

export async function recentCommits(repoRoot: string, limit = 100): Promise<CommitInfo[]> {
  try {
    return parseCommits(await git(repoRoot, ["log", "-z", `-n${limit}`, `--format=${COMMIT_FORMAT}`, "HEAD", "--"]));
  } catch {
    return [];
  }
}

export async function listRefs(repo: string): Promise<RefList> {
  const repoRoot = (await git(repo, ["rev-parse", "--show-toplevel"])).toString("utf8").trim();
  const refs = async (pattern: string[]) =>
    (await git(repoRoot, ["for-each-ref", "--sort=-creatordate", "--format=%(refname:short)%00%(symref)", ...pattern]))
      .toString("utf8")
      .split("\n")
      .map((l) => l.split("\0"))
      .filter(([name, symref]) => name && !symref)
      .map(([name]) => name!);
  const [branches, tags, commits] = await Promise.all([refs(["refs/heads", "refs/remotes"]), refs(["refs/tags"]), recentCommits(repoRoot)]);
  return { branches, tags, commits };
}

interface RawEntry {
  code: string;
  path: string;
  oldPath: string | null;
  oldOid: string;
  newOid: string;
}

// `git diff --raw -z` records: ":<old mode> <new mode> <old oid> <new oid> <status>", then one path,
// or two for a rename or copy. The new oid is all zeros for a file in the working tree.
function parseRaw(buf: Buffer): RawEntry[] {
  const parts = buf.toString("utf8").split("\0");
  const out: RawEntry[] = [];
  let i = 0;
  while (i < parts.length - 1) {
    const [, , oldOid = "", newOid = "", code = ""] = parts[i++]!.slice(1).split(" ");
    if (code.startsWith("R") || code.startsWith("C")) {
      const oldPath = parts[i++]!;
      out.push({ code: code[0]!, path: parts[i++]!, oldPath, oldOid, newOid });
    } else {
      out.push({ code: code[0]!, path: parts[i++]!, oldPath: null, oldOid, newOid });
    }
  }
  return out;
}

// Reads blobs with two git processes instead of one per file. Spawning is synchronous on Node's main
// thread, and one spawn per file took 3 of the 5.6 seconds a 2,000-file diff needed.
async function readBlobs(repoRoot: string, ids: string[]): Promise<Map<string, Content>> {
  const out = new Map<string, Content>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return out;
  const checks = (await git(repoRoot, ["cat-file", "--batch-check"], [0], `${unique.join("\n")}\n`)).toString("utf8").split("\n");
  // execFile holds all of git's output in memory up to maxBuffer, so read the blobs in batches of limited size.
  const batches: string[][] = [[]];
  let bytes = 0;
  for (const [i, id] of unique.entries()) {
    const [, type, sizeText] = checks[i]!.split(" ");
    const size = Number(sizeText);
    if (type !== "blob") {
      out.set(id, { kind: "absent" });
      continue;
    }
    if (size > MAX_CONTENT_BYTES) {
      out.set(id, { kind: "tooLarge" });
      continue;
    }
    if (bytes + size > BATCH_BYTES) {
      batches.push([]);
      bytes = 0;
    }
    batches.at(-1)!.push(id);
    bytes += size;
  }
  for (const wanted of batches) {
    if (wanted.length === 0) continue;
    const buf = await git(repoRoot, ["cat-file", "--batch"], [0], `${wanted.join("\n")}\n`);
    let pos = 0;
    for (const id of wanted) {
      const eol = buf.indexOf(10, pos);
      const size = Number(buf.subarray(pos, eol).toString("latin1").split(" ")[2]);
      out.set(id, classify(buf.subarray(eol + 1, eol + 1 + size)));
      pos = eol + 1 + size + 1;
    }
  }
  return out;
}

async function generatedPaths(repoRoot: string, paths: string[], source: string | null): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  const input = `${paths.join("\0")}\0`;
  const read = (from: string | null) =>
    git(repoRoot, ["check-attr", "-z", "--stdin", ...(from ? ["--source", from] : []), "linguist-generated"], [0], input);
  // --source needs Git 2.40. Older ones read the working tree's .gitattributes, which is usually the same.
  const parts = (await read(source).catch((err) => (source ? read(null) : Promise.reject(err)))).toString("utf8").split("\0");
  const out = new Set<string>();
  for (let i = 0; i + 2 < parts.length; i += 3) {
    if (parts[i + 2] === "set" || parts[i + 2] === "true") out.add(parts[i]!);
  }
  return out;
}

function diffTooLarge(blocks: Block[]): boolean {
  if (blocks.reduce((n, b) => n + b.oldCount + b.newCount, 0) > MAX_DIFF_LINES) return true;
  let chars = 0;
  for (const b of blocks) for (const line of [b.del, b.add].flat()) chars += line.length + 2;
  return chars > MAX_DIFF_CHARS;
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
  range: string[],
  oldCommit: string | null,
  headCommit: string | null,
  blobs: Map<string, Content>,
  entry: RawEntry,
  section: string[] | undefined,
): Promise<FileDiff> {
  const status = statusOf(entry.code);
  if (!section) {
    const paths = entry.oldPath ? [entry.oldPath, entry.path] : [entry.path];
    const one = await git(repoRoot, [...diffArgs, "-U0", ...range, "--", ...paths]);
    section = splitSections(one.toString("utf8"))[0] ?? [];
  }
  const parsed = parseSection(section);
  const blocks = assignIds(entry.path, parsed.blocks);

  const absent: Content = { kind: "absent" };
  const oldC = status === "added" || !oldCommit ? absent : (blobs.get(entry.oldOid) ?? absent);
  const newC = status === "deleted" ? absent : headCommit ? (blobs.get(entry.newOid) ?? absent) : await readWorkTree(repoRoot, entry.path);
  const binary = parsed.binary || oldC.kind === "binary" || newC.kind === "binary";
  const tooLarge = oldC.kind === "tooLarge" || newC.kind === "tooLarge";
  const file = {
    path: entry.path,
    oldPath: status === "renamed" ? entry.oldPath : null,
    status,
    binary,
    tooLarge,
    generated: false,
    diffTooLarge: false,
    modeChange: parsed.modeChange,
    additions: blocks.reduce((s, b) => s + b.newCount, 0),
    deletions: blocks.reduce((s, b) => s + b.oldCount, 0),
  };
  if (!binary && diffTooLarge(blocks)) return withoutLines(file, blocks);

  let oldLines = oldC.kind === "text" ? splitLines(oldC.text) : null;
  let newLines = newC.kind === "text" ? splitLines(newC.text) : null;

  if (oldLines && !matchesBlocks(oldLines, blocks, "old")) oldLines = null;
  if (newLines && !matchesBlocks(newLines, blocks, "new")) newLines = null;

  return {
    ...file,
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
    generated: false,
    diffTooLarge: false,
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
  if (diffTooLarge(blocks)) return withoutLines({ ...base, additions: lines.length }, blocks);
  return { ...base, additions: lines.length, blocks, hunks: buildHunks(blocks, null, lines), newContent: c.text };
}

// Keeps each block's id and range, so topics and comments still find it, and drops its lines.
function withoutLines(file: Omit<FileDiff, "blocks" | "hunks" | "oldContent" | "newContent">, blocks: Block[]): FileDiff {
  return {
    ...file,
    diffTooLarge: true,
    blocks: blocks.map((b) => ({ ...b, del: [], add: [] })),
    hunks: [],
    oldContent: null,
    newContent: null,
  };
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
