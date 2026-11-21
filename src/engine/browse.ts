import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { plainOf, wordPattern, wordRegExp } from "../shared/search.js";
import type { DiffRepo, DiffResult, RepoFile, RepoHit } from "../shared/types.js";
import { compareText } from "../shared/util.js";
import { ABSENT, classify, type Content, MAX_CONTENT_BYTES, mapLimit, readWorkTree, REPO_LIMIT } from "./diff.js";
import { git, gitLines, gitStream } from "./git.js";
import { GENERIC, insideOf, LANGUAGES, languageOf, rolesOf, type Scoped, scopeOf } from "../shared/scope.js";

export const MAX_HITS = 500;
const MAX_DEFINITIONS = 50;
const MAX_HIT_CHARS = 400;
const LEAD_CHARS = 100;
const MAX_READ_FILES = 200;
const NOT_GENERATED = ":(exclude,attr:linguist-generated=true)";
const IDENTIFIER = /^[\p{L}_$][\p{L}\p{N}_$]{0,199}$/u;
const SPELLED = /^[\p{L}_$][\p{L}\p{N}_$-]{0,199}$/u;

export function isRepoPath(p: string): boolean {
  return p !== "" && !/[\0\n\r]/.test(p) && p.split("/").every((s) => s !== "" && s !== "." && s !== "..");
}

function repoOf(diff: DiffResult, filePath: string): { repo: DiffRepo; root: string; rest: string } | null {
  const repo = diff.repos.find((r) => r.error === null && (r.dir === "" || filePath.startsWith(`${r.dir}/`)));
  if (!repo) return null;
  return { repo, root: path.join(diff.repoRoot, repo.dir), rest: repo.dir ? filePath.slice(repo.dir.length + 1) : filePath };
}

function sourceOf(diff: DiffResult, filePath: string): { root: string; rest: string; rev: string | null } | null {
  const where = isRepoPath(filePath) ? repoOf(diff, filePath) : null;
  if (!where) return null;
  const changed = diff.files.find((f) => f.path === filePath);
  if (changed?.status === "deleted") return null;
  const rev = where.repo.headCommit ?? (changed ? null : where.repo.oldCommit);
  return rev || changed ? { root: where.root, rest: where.rest, rev } : null;
}

export async function readRepoFile(diff: DiffResult, filePath: string): Promise<RepoFile | null> {
  const from = sourceOf(diff, filePath);
  if (!from) return null;
  const local = diff.files.find((f) => f.path === filePath)?.newContent ?? null;
  if (local !== null) return { path: filePath, text: local, binary: false, tooLarge: false, size: null };

  const c = from.rev ? await readBlobAt(from.root, from.rev, from.rest) : await readWorkTree(from.root, from.rest);
  if (c.kind === "absent") return null;
  const size = c.kind === "tooLarge" ? c.size : null;
  return { path: filePath, text: c.kind === "text" ? c.text : null, binary: c.kind === "binary", tooLarge: c.kind === "tooLarge", size };
}

function oldSourceOf(diff: DiffResult, filePath: string): { root: string; rest: string; rev: string } | null {
  const changed = diff.files.find((f) => f.path === filePath);
  if (!changed || changed.status === "added") return null;
  const where = repoOf(diff, changed.oldPath ?? changed.path);
  return where?.repo.oldCommit ? { root: where.root, rest: where.rest, rev: where.repo.oldCommit } : null;
}

export async function openRepoFile(diff: DiffResult, filePath: string, old = false): Promise<{ size: number; stream: Readable } | null> {
  const from = old ? oldSourceOf(diff, filePath) : sourceOf(diff, filePath);
  if (!from) return null;
  if (from.rev) {
    const blob = await blobAt(from.root, from.rev, from.rest);
    return blob && { size: blob.size, stream: gitStream(from.root, ["cat-file", "blob", blob.oid]) };
  }
  const abs = path.join(from.root, from.rest);
  const st = await lstat(abs).catch(() => null);
  return st?.isFile() ? { size: st.size, stream: createReadStream(abs) } : null;
}

export async function listRepoFiles(diff: DiffResult): Promise<string[]> {
  const gone = new Set(diff.files.flatMap((f) => (f.status === "renamed" && f.oldPath !== null ? [f.oldPath] : [])));
  const parts = await mapLimit(searchable(diff), REPO_LIMIT, async (repo) => {
    const rev = repo.headCommit ?? repo.oldCommit;
    if (!rev) return [];
    const prefix = repo.dir ? `${repo.dir}/` : "";
    const listed = (await git(path.join(diff.repoRoot, repo.dir), ["ls-tree", "-r", "-z", "--full-tree", rev])).toString("utf8");
    return listed.split("\0").flatMap((entry) => {
      const tab = entry.indexOf("\t");
      return tab > 0 && entry.split(" ", 2)[1] === "blob" ? [prefix + entry.slice(tab + 1)] : [];
    });
  });
  return [...new Set([...parts.flat().filter((p) => !gone.has(p)), ...diff.files.map((f) => f.path)])];
}

async function blobAt(root: string, rev: string, rest: string): Promise<{ oid: string; size: number } | null> {
  const check = await git(root, ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], [0], `${rev}:${rest}\n`);
  const [oid = "", type, size] = check.toString("utf8").trim().split(" ");
  return type === "blob" ? { oid, size: Number(size) } : null;
}

async function readBlobAt(root: string, rev: string, rest: string): Promise<Content> {
  const blob = await blobAt(root, rev, rest);
  if (!blob) return ABSENT;
  if (blob.size > MAX_CONTENT_BYTES) return { kind: "tooLarge", size: blob.size };
  return classify(await git(root, ["cat-file", "blob", blob.oid]));
}

export async function grepRepo(diff: DiffResult, query: string, whole: boolean, signal: AbortSignal): Promise<Found> {
  const found = wordRegExp(query, whole);
  const pattern = wordPattern(query, whole);
  const match = [...plainOf(query).filter((p) => p !== pattern.toLowerCase()).flatMap((p) => ["-e", p, "--and"]), "-e", pattern];
  const changed = new Set(diff.files.map((f) => f.path));
  const busy = searchable(diff).filter((r) => r.dir !== "" && diff.files.some((f) => f.path.startsWith(`${r.dir}/`)));
  const far = (p: string) => (changed.has(p) ? 0 : busy.length === 0 || busy.some((r) => p.startsWith(`${r.dir}/`)) ? 1 : 2);
  const lines = await grepLines(diff, searchable(diff), ["-E", "-i", ...match], ["."], MAX_HITS, signal, (text) => found?.exec(text)?.index ?? -1, far);
  if (!signal.aborted) await describe(diff, lines.hits, found);
  return lines;
}

async function describe(diff: DiffResult, hits: RepoHit[], found: RegExp | null): Promise<void> {
  const texts = await readTexts(diff, [...new Set(hits.map((h) => h.path))].slice(0, MAX_READ_FILES));
  const files = new Map<string, { lines: string[]; inside: ReturnType<typeof insideOf>; roles: ReturnType<typeof rolesOf> }>();
  const every = found && new RegExp(found.source, `${found.flags.replace("g", "")}g`);
  for (const h of hits) {
    const text = texts.get(h.path);
    if (text === undefined) continue;
    let file = files.get(h.path);
    if (!file) files.set(h.path, (file = { lines: text.split("\n"), inside: insideOf(text, h.path), roles: rolesOf(text, h.path) }));
    h.inside = file.inside(h.no);
    const line = file.lines[h.no - 1] ?? "";
    for (const m of every ? line.matchAll(every) : []) {
      if (!SPELLED.test(m[0]) || /[\w$]/.test((line[m.index - 1] ?? "") + (line[m.index + m[0].length] ?? ""))) continue;
      const role = file.roles(h.no, m.index, m[0]);
      if (role === "field" || (role && !h.role)) h.role = role;
    }
  }
}

async function readTexts(diff: DiffResult, paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const changed = new Map(diff.files.map((f) => [f.path, f]));
  const wanted = new Map<DiffRepo, { root: string; rev: string; rests: string[] }>();
  for (const p of paths) {
    const file = changed.get(p);
    if (file) {
      if (file.newContent !== null) out.set(p, file.newContent);
      continue;
    }
    const where = repoOf(diff, p);
    const rev = where && (where.repo.headCommit ?? where.repo.oldCommit);
    if (!where || !rev) continue;
    const list = wanted.get(where.repo) ?? { root: where.root, rev, rests: [] };
    list.rests.push(where.rest);
    wanted.set(where.repo, list);
  }

  await mapLimit([...wanted], REPO_LIMIT, async ([repo, { root, rev, rests }]) => {
    const names = (list: string[]) => list.map((r) => `${rev}:${r}\n`).join("");
    const sizes = (await git(root, ["cat-file", "--batch-check=%(objecttype) %(objectsize)"], [0], names(rests))).toString("utf8").split("\n");
    const small = rests.filter((_, n) => {
      const [type, size] = (sizes[n] ?? "").split(" ");
      return type === "blob" && Number(size) <= MAX_CONTENT_BYTES;
    });
    if (!small.length) return;

    const buf = await git(root, ["cat-file", "--batch"], [0], names(small));
    let at = 0;
    for (const rest of small) {
      const eol = buf.indexOf(10, at);
      if (eol < 0) break;
      const size = Number(buf.toString("utf8", at, eol).split(" ")[2]);
      const content = classify(buf.subarray(eol + 1, eol + 1 + size));
      at = eol + 1 + size + 1;
      if (content.kind === "text") out.set(repo.dir ? `${repo.dir}/${rest}` : rest, content.text);
    }
  });
  return out;
}

type Found = { hits: RepoHit[]; capped: boolean };

const searchable = (diff: DiffResult) => diff.repos.filter((r) => r.error === null);

async function nearestFirst(groups: DiffRepo[][], find: (repos: DiffRepo[]) => Promise<Found>): Promise<Found> {
  for (const repos of groups) {
    const found = repos.length ? await find(repos) : null;
    if (found?.hits.length) return found;
  }
  return { hits: [], capped: false };
}

const defines = (plain: string[], patterns: string[]) => ["-E", ...plain.flatMap((p) => ["-e", p, "--and"]), "(", ...patterns.flatMap((p) => ["-e", p]), ")"];

export const isIdentifier = (name: string) => IDENTIFIER.test(name);

export interface Click {
  line: number;
  col: number;
}

type Defined = Found & { declared: boolean; member: boolean; byName: boolean };

export async function findDefinitions(diff: DiffResult, name: string, from: string, click: Click | null, signal: AbortSignal): Promise<Defined> {
  const text = click ? ((await readRepoFile(diff, from))?.text ?? null) : null;
  const scoped: Scoped = click && text !== null ? scopeOf(text, click.line, click.col, name, from) : { kind: "free" };
  const member = scoped.kind === "member" && !scoped.call;
  const only = (hits: RepoHit[]): Defined => ({ hits, capped: false, declared: false, member, byName: false });
  const itself: Defined = { hits: [], capped: false, declared: true, member, byName: false };
  const lineOf = (no: number) => {
    const line = text!.split("\n")[no - 1]!;
    return hitOf(from, no, line, line.indexOf(name));
  };
  if (scoped.kind === "declared") return itself;
  if (scoped.kind === "bound" && scoped.module === null) return only([lineOf(scoped.line)]);

  const language = languageOf(from);
  const escaped = name.replaceAll("$", "\\$");
  const pathspecs = language.exts.length ? language.exts.map((e) => `*.${e}`) : ["."];
  const own = repoOf(diff, from)?.repo;
  const all = searchable(diff);
  const lookUp = (patterns: string[]) =>
    nearestFirst(own ? [[own], all.filter((r) => r !== own)] : [all], (repos) =>
      grepLines(diff, repos, defines([escaped], patterns), pathspecs, MAX_DEFINITIONS, signal, (line) => line.indexOf(name)),
    );
  const fields = async (): Promise<Found> => {
    const lines = await grepRepo(diff, name, true, signal);
    const hits = lines.hits.filter((h) => h.role === "field" && h.text.slice(h.at, h.at + name.length) === name);
    return { hits: hits.slice(0, MAX_DEFINITIONS), capped: hits.length > MAX_DEFINITIONS || lines.capped };
  };
  const methods = () => lookUp(language.patterns(escaped));
  let found: Found;
  let byName = false;
  if (scoped.kind !== "member") found = await lookUp([...language.patterns(escaped), ...language.values(escaped)]);
  else if (scoped.call) {
    found = await methods();
    if (!found.hits.length) {
      found = await fields();
      byName = found.hits.length > 0;
    }
  } else {
    const [declared, defined] = await Promise.all([fields(), methods()]);
    byName = declared.hits.length > 0;
    found = byName ? declared : defined;
  }
  const clicked = click && text !== null ? (text.split("\n")[click.line - 1] ?? "") : "";
  if (click && clicked.indexOf(name) === click.col && found.hits.some((h) => h.path === from && h.no === click.line)) return itself;

  if (scoped.kind === "bound") {
    const imported = inModule(found.hits, scoped.module!, from);
    return only(imported.length ? imported : found.hits.length === 1 ? found.hits : [lineOf(scoped.line)]);
  }
  const here = scoped.kind === "free" || scoped.own ? found.hits.filter((h) => h.path === from) : [];
  return here.length === 1 ? only(here) : { ...found, declared: false, member, byName };
}

function inModule(hits: RepoHit[], module: string, from: string): RepoHit[] {
  const bare = (p: string) => p.replace(/\.[^./]+$/, "").replace(/\/(?:index|__init__|mod)$/, "");
  if (module.startsWith(".") && module.includes("/")) {
    const target = bare(path.posix.join(path.posix.dirname(from), module));
    return hits.filter((h) => bare(h.path) === target);
  }
  const words = module.split(/[./:]+/).filter((w) => w && w !== "crate" && w !== "self" && w !== "super");
  for (let take = words.length; take > 0; take--) {
    for (let start = 0; start + take <= words.length; start++) {
      const tail = `/${words.slice(start, start + take).join("/")}`;
      const inFile = hits.filter((h) => `/${bare(h.path)}`.endsWith(tail));
      if (inFile.length) return inFile;
    }
  }
  return [];
}

export function findDefinitionsAnywhere(diff: DiffResult, name: string, signal: AbortSignal): Promise<Found> {
  const spelled = wordPattern(name, false);
  const word = wordRegExp(name, true);
  const plain = plainOf(name);
  const all = searchable(diff);
  const changed = all.filter((r) => diff.files.some((f) => r.dir === "" || f.path.startsWith(`${r.dir}/`)));
  return nearestFirst([changed, all.filter((r) => !changed.includes(r))], async (repos) => {
    const find = (patterns: string[], pathspecs: string[]) =>
      grepLines(diff, repos, ["-i", ...defines(plain, patterns)], pathspecs, MAX_DEFINITIONS, signal, (text) => word?.exec(text)?.index ?? -1);
    const found = await Promise.all([
      ...LANGUAGES.map((l) => find([...l.patterns(spelled), ...l.values(spelled)], l.exts.map((e) => `*.${e}`))),
      find(GENERIC.patterns(spelled), [".", ...LANGUAGES.flatMap((l) => l.exts).map((e) => `:(exclude)*.${e}`)]),
    ]);
    const hits = found.flatMap((f) => f.hits).sort((a, b) => compareText(a.path, b.path) || a.no - b.no);
    return { hits: hits.slice(0, MAX_DEFINITIONS), capped: hits.length > MAX_DEFINITIONS || found.some((f) => f.capped) };
  });
}

async function grepLines(
  diff: DiffResult,
  repos: DiffRepo[],
  match: string[],
  pathspecs: string[],
  max: number,
  signal: AbortSignal,
  atOf: (text: string) => number,
  far: (filePath: string) => number = () => 0,
): Promise<Found> {
  const parts = await mapLimit(repos, REPO_LIMIT, async (repo) => {
    const prefix = repo.dir ? `${repo.dir}/` : "";
    const rev = repo.headCommit;
    const strip = rev ? `${rev}:` : "";
    const where = rev ? [rev] : ["--untracked"];
    const args = ["grep", "--no-color", "-n", "-z", "-I", ...match, ...where, "--", ...pathspecs, NOT_GENERATED];
    const hits: RepoHit[] = [];
    await gitLines(
      path.join(diff.repoRoot, repo.dir),
      args,
      (line) => {
        const a = line.indexOf("\0");
        const b = line.indexOf("\0", a + 1);
        if (a < 0 || b < 0) return true;
        const file = line.slice(0, a);
        const text = line.slice(b + 1);
        hits.push(hitOf(prefix + (file.startsWith(strip) ? file.slice(strip.length) : file), Number(line.slice(a + 1, b)), text, atOf(text)));
        return hits.length <= max;
      },
      [0, 1],
      signal,
    );
    return hits;
  });

  const all = parts.flat().sort((a, b) => far(a.path) - far(b.path) || compareText(a.path, b.path) || a.no - b.no);
  return { hits: all.slice(0, max), capped: all.length > max };
}

function hitOf(filePath: string, no: number, text: string, at: number): RepoHit {
  if (text.length <= MAX_HIT_CHARS) return { path: filePath, no, text, at };
  const from = Math.max(0, at - LEAD_CHARS);
  return { path: filePath, no, text: text.slice(from, from + MAX_HIT_CHARS), at: at < 0 ? -1 : at - from };
}
