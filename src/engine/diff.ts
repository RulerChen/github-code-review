import { createHash } from "node:crypto";
import { lstat, readdir, readFile, readlink, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { rangeFor, repoFailures } from "../shared/comparison.js";
import { buildHunks, splitLines, stripCr } from "../shared/hunks.js";
import type { Block, CommitInfo, Comparison, DiffRepo, DiffResult, FileDiff, FileStatus, RefList, RefRange, RepoRange } from "../shared/types.js";
import { compareText, errorMessage, plural, sum } from "../shared/util.js";
import { git, gitText } from "./git.js";

const MAX_CONTENT_BYTES = 1024 * 1024;
const MAX_DIFF_LINES = 20_000;
const MAX_DIFF_CHARS = 500 * 1024;
const MAX_COMMITS = 250;
const MAX_RECENT_COMMITS = 100;
const BATCH_BYTES = 64 * 1024 * 1024;
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const REPO_LIMIT = 4;
const FILE_LIMIT = 8;
const STAT_LIMIT = 16;
const COMMIT_FORMAT = "%H%x1f%P%x1f%an%x1f%aI%x1f%s";
const DIFF_ARGS = ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--submodule=short", "--find-renames"];
const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;
const STATUS: Record<string, FileStatus> = { A: "added", D: "deleted", R: "renamed" };

type Content = { kind: "text"; text: string } | { kind: "binary" } | { kind: "tooLarge" } | { kind: "absent" };
type RawBlock = Omit<Block, "id">;

interface RepoPart {
  repo: DiffRepo;
  commits: CommitInfo[];
  commitCount: number;
  files: FileDiff[];
}

interface RepoContext {
  root: string;
  prefix: string;
  range: string[];
  oldCommit: string | null;
  headCommit: string | null;
  blobs: Map<string, Content>;
}

interface RawEntry {
  code: string;
  path: string;
  oldPath: string | null;
  oldOid: string;
  newOid: string;
}

interface ParsedSection {
  binary: boolean;
  modeChange: { from: string; to: string } | null;
  blocks: RawBlock[];
}

interface FileHash {
  stat: string;
  hash: string;
}

const ABSENT: Content = { kind: "absent" };
const contentHashes = new Map<string, Map<string, FileHash>>();

const byPath = (a: { path: string }, b: { path: string }) => compareText(a.path, b.path);
const byDate = (a: CommitInfo, b: CommitInfo) => Date.parse(a.date) - Date.parse(b.date);
const statusOf = (code: string): FileStatus => STATUS[code] ?? "modified";

function normalize(compare: Partial<Comparison>): Comparison {
  const c: Comparison = {
    base: compare.base ?? "HEAD",
    head: compare.head ?? null,
    threeDot: compare.threeDot ?? true,
    overrides: compare.overrides ?? [],
  };

  for (const { base, head } of [c, ...c.overrides]) {
    for (const ref of [base, head]) {
      if (ref !== null && (ref === "" || ref.startsWith("-"))) throw new Error(`Invalid git ref: ${ref}`);
    }
  }
  return c;
}

async function findRepos(dir: string): Promise<{ root: string; repos: string[] | null }> {
  const abs = await realpath(dir);
  const isRepo = (d: string) => stat(path.join(d, ".git")).then(() => true, () => false);
  if (!(await isRepo(abs))) {
    const names = (await readdir(abs)).sort();
    const found = await Promise.all(names.map((n) => isRepo(path.join(abs, n))));
    const repos = names.filter((_, i) => found[i]);
    if (repos.length) return { root: abs, repos };
  }

  try {
    return { root: await gitText(abs, ["rev-parse", "--show-toplevel"]), repos: null };
  } catch {
    throw new Error(`${dir} is not in a git repository and has no git repository directly under it.`);
  }
}

export async function computeDiff(dir: string, compare: Partial<Comparison> = {}): Promise<DiffResult> {
  const c = normalize(compare);
  const { root, repos } = await findRepos(dir);
  checkOverrides(root, repos, c.overrides);

  if (!repos) {
    const { repo, commits, commitCount, files } = await diffRepo(root, c, "");
    const { baseCommit, headCommit, oldCommit } = repo;
    return { repoRoot: root, ...c, baseCommit, headCommit, oldCommit, repos: [repo], commits, commitCount, files };
  }

  const parts = await mapLimit(repos, REPO_LIMIT, (name) => {
    const range = rangeFor(c, name);
    return diffRepo(path.join(root, name), range, name).catch((err: unknown) => failedPart(name, range, err));
  });
  const states = parts.map((p) => p.repo);
  if (states.every((r) => r.error !== null)) {
    throw new Error(repoFailures(states).map((f) => `${f.error} (${f.dirs.join(", ")})`).join("; "));
  }

  return {
    repoRoot: root,
    ...c,
    baseCommit: null,
    headCommit: null,
    oldCommit: null,
    repos: states,
    commits: parts.flatMap((p) => p.commits.map((commit) => ({ ...commit, repo: p.repo.dir }))).sort(byDate).slice(-MAX_COMMITS),
    commitCount: sum(parts, (p) => p.commitCount),
    files: parts.flatMap((p) => p.files).sort(byPath),
  };
}

function failedPart(dir: string, range: RefRange, err: unknown): RepoPart {
  const repo = { dir, ...range, baseCommit: null, headCommit: null, oldCommit: null, error: errorMessage(err) };
  return { repo, commits: [], commitCount: 0, files: [] };
}

function checkOverrides(root: string, repos: string[] | null, overrides: RepoRange[]): void {
  const unknown = overrides.filter((o) => !repos?.includes(o.dir)).map((o) => o.dir);
  if (!unknown.length) return;
  if (!repos) throw new Error(`${root} is a single repository, so no repository in it can compare a range of its own.`);
  throw new Error(`No repository named ${unknown.join(", ")} directly under ${root}.`);
}

async function diffRepo(repo: string, { base, head, threeDot }: RefRange, dir: string): Promise<RepoPart> {
  const root = await gitText(repo, ["rev-parse", "--show-toplevel"]);
  const [baseCommit, headCommit, headOfRepo] = await Promise.all([
    resolveCommit(root, base),
    head === null ? null : resolveCommit(root, head),
    head === null ? resolveCommit(root, "HEAD") : null,
  ]);
  if (head !== null && headCommit === null) throw new Error(`Unknown git ref: ${head}`);
  const tip = headCommit ?? headOfRepo;
  const oldCommit = threeDot && baseCommit && tip ? await mergeBase(root, baseCommit, tip, base, head) : baseCommit;
  const range = headCommit ? [oldCommit ?? EMPTY_TREE, headCommit] : [oldCommit ?? EMPTY_TREE];

  const [raw, patch, untracked, commits] = await Promise.all([
    git(root, [...DIFF_ARGS, "--raw", "-z", "--no-abbrev", ...range, "--"]),
    git(root, [...DIFF_ARGS, "-U0", ...range, "--"]),
    head === null ? git(root, ["ls-files", "--others", "--exclude-standard", "-z"]) : Buffer.alloc(0),
    listCommits(root, baseCommit, tip),
  ]);

  const entries = parseRaw(raw);
  const sections = splitSections(patch.toString("utf8"));
  const aligned = sections.length === entries.length;
  const untrackedPaths = untracked.toString("utf8").split("\0").filter(Boolean);
  const blobIds = entries.flatMap((e) => {
    const status = statusOf(e.code);
    return [status !== "added" && oldCommit ? e.oldOid : null, status !== "deleted" && headCommit ? e.newOid : null];
  });
  const [blobs, generated] = await Promise.all([
    readBlobs(root, blobIds.filter((id): id is string => id !== null)),
    generatedPaths(root, [...entries.map((e) => e.path), ...untrackedPaths], headCommit),
  ]);

  const ctx: RepoContext = { root, prefix: dir ? `${dir}/` : "", range, oldCommit, headCommit, blobs };
  const tracked = await mapLimit(entries, FILE_LIMIT, (entry, i) => trackedFile(ctx, entry, aligned ? sections[i] : undefined));
  const added = await mapLimit(untrackedPaths, FILE_LIMIT, (p) => untrackedFile(ctx, p));
  const files = [...tracked, ...added.filter((f): f is FileDiff => f !== null)].sort(byPath);
  for (const f of files) {
    f.generated = generated.has(f.path);
    f.path = ctx.prefix + f.path;
    if (f.oldPath !== null) f.oldPath = ctx.prefix + f.oldPath;
  }
  return { repo: { dir, base, head, threeDot, baseCommit, headCommit, oldCommit, error: null }, ...commits, files };
}

export async function diffVersion(dir: string, compare: Partial<Comparison> = {}): Promise<string> {
  const c = normalize(compare);
  const { root, repos } = await findRepos(dir);
  if (!repos) return repoVersion(root, c.base, c.head);
  const versions = await mapLimit(repos, REPO_LIMIT, (name) => {
    const { base, head } = rangeFor(c, name);
    return repoVersion(path.join(root, name), base, head).catch((err: unknown) => `! ${errorMessage(err)}`);
  });
  return createHash("sha256")
    .update(repos.map((name, i) => `${name}\0${versions[i]}`).join("\n"))
    .digest("hex")
    .slice(0, 16);
}

async function repoVersion(repo: string, base: string, head: string | null): Promise<string> {
  const [commits, status] = await Promise.all([
    git(repo, ["rev-parse", `${base}^{commit}`, `${head ?? "HEAD"}^{commit}`], [0, 128]),
    head === null ? git(repo, ["status", "--porcelain", "-z", "--untracked-files=all"]) : null,
  ]);

  const hash = createHash("sha256").update(commits);
  if (status) {
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
    const versions = await mapLimit(paths, STAT_LIMIT, (p) => fileVersion(path.join(repo, p), known, next));
    contentHashes.set(repo, next);
    hash.update(entries.join("\0")).update(versions.join("\0"));
  }
  return hash.digest("hex").slice(0, 16);
}

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
  const what = (r: RefRange) => (r.head === null ? `the working tree against ${r.base}` : `${r.base}${r.threeDot ? "..." : ".."}${r.head}`);
  const fromMergeBase =
    result.oldCommit && result.oldCommit !== result.baseCommit ? ` from their merge base ${result.oldCommit.slice(0, 7)}` : "";
  const own = result.overrides.map((o) => `${o.dir} compares ${what(o)}`).join("; ");
  const where =
    result.repos[0]?.dir === ""
      ? ""
      : ` in ${plural(result.repos.length, "repository", "repositories")} under ${result.repoRoot}${own ? ` (${own})` : ""}, each file's path starting with its repository's directory`;
  const commits = result.commitCount ? `, ${plural(result.commitCount, "commit")}` : "";
  const add = sum(result.files, (f) => f.additions);
  const del = sum(result.files, (f) => f.deletions);
  return `${plural(result.files.length, "file")} changed, +${add} -${del}, comparing ${what(result)}${fromMergeBase}${where}${commits}`;
}

export function describeFailures(result: DiffResult): string[] {
  return repoFailures(result.repos).map((f) => `Not compared in ${f.dirs.join(", ")}: ${f.error}`);
}

async function resolveCommit(root: string, ref: string): Promise<string | null> {
  try {
    return await gitText(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  } catch {
    if (ref === "HEAD") return null;
    throw new Error(`Unknown git ref: ${ref}`);
  }
}

async function mergeBase(root: string, a: string, b: string, base: string, head: string | null): Promise<string> {
  const out = await gitText(root, ["merge-base", a, b], [0, 1]);
  if (out) return out;
  throw new Error(`${base} and ${head ?? "HEAD"} share no history, so there is no merge base. Compare them directly instead.`);
}

async function listCommits(root: string, from: string | null, to: string | null): Promise<{ commits: CommitInfo[]; commitCount: number }> {
  if (!from || !to) return { commits: [], commitCount: 0 };
  const range = `${from}..${to}`;
  const [log, count] = await Promise.all([
    git(root, ["log", "-z", `-n${MAX_COMMITS}`, "--reverse", `--format=${COMMIT_FORMAT}`, range, "--"]),
    gitText(root, ["rev-list", "--count", range, "--"]),
  ]);
  return { commits: parseCommits(log), commitCount: Number(count) };
}

function parseCommits(buf: Buffer): CommitInfo[] {
  return buf
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((rec) => {
      const [sha = "", parents = "", author = "", date = "", subject = ""] = rec.split("\x1f");
      return { sha, parents: parents.split(" ").filter(Boolean), author, date, subject };
    });
}

export async function listRefs(dir: string, repo: string | null = null): Promise<RefList> {
  const { root, repos } = await findRepos(dir);
  if (repo !== null) {
    if (!repos?.includes(repo)) throw new Error(`No repository named ${repo} directly under ${root}.`);
    return repoRefs(path.join(root, repo));
  }
  if (!repos) return repoRefs(root);

  const lists = await mapLimit(repos, REPO_LIMIT, (name) => repoRefs(path.join(root, name)).catch(() => null));
  const merge = (pick: (l: RefList) => string[]) => {
    const names = lists.map((l) => (l ? pick(l) : []));
    const out = new Set<string>();
    for (let i = 0; names.some((n) => i < n.length); i++) for (const n of names) if (i < n.length) out.add(n[i]!);
    return [...out];
  };

  const commits = lists
    .flatMap((l, i) => (l ? l.commits.map((c) => ({ ...c, repo: repos[i]! })) : []))
    .sort((a, b) => byDate(b, a))
    .slice(0, MAX_RECENT_COMMITS);

  const holders = new Map<string, number>();
  for (const l of lists) for (const n of new Set(l ? [...l.branches, ...l.tags] : [])) holders.set(n, (holders.get(n) ?? 0) + 1);
  const partial = [...holders].filter(([, count]) => count < repos.length);
  return { branches: merge((l) => l.branches), tags: merge((l) => l.tags), commits, repoCount: repos.length, partial };
}

async function repoRefs(root: string): Promise<RefList> {
  const refs = async (pattern: string[]) =>
    (await git(root, ["for-each-ref", "--sort=-creatordate", "--format=%(refname:short)%00%(symref)", ...pattern]))
      .toString("utf8")
      .split("\n")
      .map((l) => l.split("\0"))
      .filter(([name, symref]) => name && !symref)
      .map(([name]) => name!);
  const recent = git(root, ["log", "-z", `-n${MAX_RECENT_COMMITS}`, `--format=${COMMIT_FORMAT}`, "HEAD", "--"]).then(parseCommits, () => []);
  const [branches, tags, commits] = await Promise.all([refs(["refs/heads", "refs/remotes"]), refs(["refs/tags"]), recent]);
  return { branches, tags, commits, repoCount: 1, partial: [] };
}

function parseRaw(buf: Buffer): RawEntry[] {
  const parts = buf.toString("utf8").split("\0");
  const out: RawEntry[] = [];
  for (let i = 0; i < parts.length - 1; ) {
    const [, , oldOid = "", newOid = "", code = ""] = parts[i++]!.slice(1).split(" ");
    const oldPath = code.startsWith("R") || code.startsWith("C") ? parts[i++]! : null;
    out.push({ code: code[0]!, path: parts[i++]!, oldPath, oldOid, newOid });
  }
  return out;
}

async function readBlobs(root: string, ids: string[]): Promise<Map<string, Content>> {
  const out = new Map<string, Content>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return out;
  const checks = (await git(root, ["cat-file", "--batch-check"], [0], `${unique.join("\n")}\n`)).toString("utf8").split("\n");

  const batches: string[][] = [[]];
  let bytes = 0;
  for (const [i, id] of unique.entries()) {
    const [, type, sizeText] = checks[i]!.split(" ");
    const size = Number(sizeText);
    if (type !== "blob") {
      out.set(id, ABSENT);
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
    const buf = await git(root, ["cat-file", "--batch"], [0], `${wanted.join("\n")}\n`);
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

async function generatedPaths(root: string, paths: string[], source: string | null): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  const input = `${paths.join("\0")}\0`;
  const read = (from: string | null) =>
    git(root, ["check-attr", "-z", "--stdin", ...(from ? ["--source", from] : []), "linguist-generated"], [0], input);
  const parts = (await read(source).catch((err) => (source ? read(null) : Promise.reject(err)))).toString("utf8").split("\0");
  const out = new Set<string>();
  for (let i = 0; i + 2 < parts.length; i += 3) {
    if (parts[i + 2] === "set" || parts[i + 2] === "true") out.add(parts[i]!);
  }
  return out;
}

function diffTooLarge(blocks: Block[]): boolean {
  return (
    sum(blocks, (b) => b.oldCount + b.newCount) > MAX_DIFF_LINES ||
    sum(blocks, (b) => sum([...b.del, ...b.add], (line) => line.length + 2)) > MAX_DIFF_CHARS
  );
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

function classify(buf: Buffer): Content {
  if (buf.length > MAX_CONTENT_BYTES) return { kind: "tooLarge" };
  if (buf.subarray(0, 8000).includes(0)) return { kind: "binary" };
  return { kind: "text", text: buf.toString("utf8") };
}

async function readWorkTree(root: string, filePath: string): Promise<Content> {
  const abs = path.join(root, filePath);
  try {
    const st = await lstat(abs);
    if (st.isSymbolicLink()) return { kind: "text", text: await readlink(abs) };
    if (!st.isFile()) return ABSENT;
    if (st.size > MAX_CONTENT_BYTES) return { kind: "tooLarge" };
    return classify(await readFile(abs));
  } catch {
    return ABSENT;
  }
}

function matchingText(c: Content, blocks: Block[], side: "old" | "new"): { text: string; lines: string[] } | null {
  if (c.kind !== "text") return null;
  const lines = splitLines(c.text);
  const matches = blocks.every((b) => {
    const [start, want] = side === "old" ? [b.oldStart, b.del] : [b.newStart, b.add];
    return want.every((t, k) => {
      const got = lines[start + k];
      return got !== undefined && stripCr(got) === stripCr(t);
    });
  });
  return matches ? { text: c.text, lines } : null;
}

function fileDiff(filePath: string, fields: Partial<FileDiff>): FileDiff {
  return {
    path: filePath,
    oldPath: null,
    status: "added",
    binary: false,
    tooLarge: false,
    generated: false,
    diffTooLarge: false,
    modeChange: null,
    additions: 0,
    deletions: 0,
    blocks: [],
    hunks: [],
    oldContent: null,
    newContent: null,
    ...fields,
  };
}

function withoutLines(file: FileDiff, blocks: Block[]): FileDiff {
  return { ...file, diffTooLarge: true, blocks: blocks.map((b) => ({ ...b, del: [], add: [] })) };
}

async function trackedFile(ctx: RepoContext, entry: RawEntry, section: string[] | undefined): Promise<FileDiff> {
  const status = statusOf(entry.code);
  if (!section) {
    const paths = entry.oldPath ? [entry.oldPath, entry.path] : [entry.path];
    const one = await git(ctx.root, [...DIFF_ARGS, "-U0", ...ctx.range, "--", ...paths]);
    section = splitSections(one.toString("utf8"))[0] ?? [];
  }

  const parsed = parseSection(section);
  const blocks = assignIds(ctx.prefix + entry.path, parsed.blocks);

  const oldC = status === "added" || !ctx.oldCommit ? ABSENT : (ctx.blobs.get(entry.oldOid) ?? ABSENT);
  const newC =
    status === "deleted" ? ABSENT : ctx.headCommit ? (ctx.blobs.get(entry.newOid) ?? ABSENT) : await readWorkTree(ctx.root, entry.path);
  const binary = parsed.binary || oldC.kind === "binary" || newC.kind === "binary";
  const file = fileDiff(entry.path, {
    oldPath: status === "renamed" ? entry.oldPath : null,
    status,
    binary,
    tooLarge: oldC.kind === "tooLarge" || newC.kind === "tooLarge",
    modeChange: parsed.modeChange,
    additions: sum(blocks, (b) => b.newCount),
    deletions: sum(blocks, (b) => b.oldCount),
  });

  if (binary) return file;
  if (diffTooLarge(blocks)) return withoutLines(file, blocks);
  const old = matchingText(oldC, blocks, "old");
  const next = matchingText(newC, blocks, "new");
  return {
    ...file,
    blocks,
    hunks: buildHunks(blocks, old?.lines ?? null, next?.lines ?? null),
    oldContent: old?.text ?? null,
    newContent: next?.text ?? null,
  };
}

async function untrackedFile(ctx: RepoContext, filePath: string): Promise<FileDiff | null> {
  const c = await readWorkTree(ctx.root, filePath);
  if (c.kind === "absent") return null;
  const file = fileDiff(filePath, { binary: c.kind === "binary", tooLarge: c.kind === "tooLarge" });
  if (c.kind !== "text") return file;
  const lines = splitLines(c.text);
  if (lines.length === 0) return file;

  const raw: RawBlock = {
    oldStart: 0,
    oldCount: 0,
    newStart: 0,
    newCount: lines.length,
    del: [],
    add: lines,
    oldNoEol: false,
    newNoEol: !c.text.endsWith("\n"),
    section: "",
  };

  const blocks = assignIds(ctx.prefix + filePath, [raw]);
  const added = { ...file, additions: lines.length };
  if (diffTooLarge(blocks)) return withoutLines(added, blocks);
  return { ...added, blocks, hunks: buildHunks(blocks, null, lines), newContent: c.text };
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
