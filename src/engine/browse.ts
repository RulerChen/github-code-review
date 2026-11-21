import path from "node:path";
import { plainOf, wordPattern, wordRegExp } from "../shared/search.js";
import type { DiffRepo, DiffResult, RepoFile, RepoHit } from "../shared/types.js";
import { compareText } from "../shared/util.js";
import { ABSENT, classify, type Content, MAX_CONTENT_BYTES, mapLimit, readWorkTree, REPO_LIMIT } from "./diff.js";
import { git, gitLines } from "./git.js";
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

export async function readRepoFile(diff: DiffResult, filePath: string): Promise<RepoFile | null> {
  const where = isRepoPath(filePath) ? repoOf(diff, filePath) : null;
  if (!where) return null;
  const changed = diff.files.find((f) => f.path === filePath);
  if (changed?.status === "deleted") return null;
  if (changed && changed.newContent !== null) return { path: filePath, text: changed.newContent, binary: false, tooLarge: false };

  const { repo, root, rest } = where;
  const rev = repo.headCommit ?? (changed ? null : repo.oldCommit);
  const c = rev ? await readBlobAt(root, rev, rest) : changed ? await readWorkTree(root, rest) : ABSENT;
  if (c.kind === "absent") return null;
  return { path: filePath, text: c.kind === "text" ? c.text : null, binary: c.kind === "binary", tooLarge: c.kind === "tooLarge" };
}

async function readBlobAt(root: string, rev: string, rest: string): Promise<Content> {
  const check = await git(root, ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], [0], `${rev}:${rest}\n`);
  const [oid = "", type, size] = check.toString("utf8").trim().split(" ");
  if (type !== "blob") return ABSENT;
  if (Number(size) > MAX_CONTENT_BYTES) return { kind: "tooLarge" };
  return classify(await git(root, ["cat-file", "blob", oid]));
}

// git grep runs a regular expression on every line. A plain string every match has, joined with --and, lets it skip most lines first.
export async function grepRepo(diff: DiffResult, query: string, whole: boolean, signal: AbortSignal): Promise<Found> {
  const found = wordRegExp(query, whole);
  const pattern = wordPattern(query, whole);
  const match = [...plainOf(query).filter((p) => p !== pattern.toLowerCase()).flatMap((p) => ["-e", p, "--and"]), "-e", pattern];
  // When there are more matches than are kept, keep the ones nearest the diff: its files, then the repositories it changes.
  const changed = new Set(diff.files.map((f) => f.path));
  const busy = searchable(diff).filter((r) => r.dir !== "" && diff.files.some((f) => f.path.startsWith(`${r.dir}/`)));
  const far = (p: string) => (changed.has(p) ? 0 : busy.length === 0 || busy.some((r) => p.startsWith(`${r.dir}/`)) ? 1 : 2);
  const lines = await grepLines(diff, searchable(diff), ["-E", "-i", ...match], ["."], MAX_HITS, signal, (text) => found?.exec(text)?.index ?? -1, far);
  if (!signal.aborted) await describe(diff, lines.hits, found);
  return lines;
}

// Says which function each line is in, so a list of uses reads as a list of callers, and whether the line writes the name or only reads it. The hits are in order of distance from the diff, so the files nearest it are the ones read.
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
    // The whole line, since the text of a hit is cut when it is long. A line can have the name more than once: a place that declares a field counts first, then one that writes.
    const line = file.lines[h.no - 1] ?? "";
    for (const m of every ? line.matchAll(every) : []) {
      if (!SPELLED.test(m[0]) || /[\w$]/.test((line[m.index - 1] ?? "") + (line[m.index + m[0].length] ?? ""))) continue;
      const role = file.roles(h.no, m.index, m[0]);
      if (role === "field" || (role && !h.role)) h.role = role;
    }
  }
}

// The text of files in the compared version: from the diff for a changed file, and two git cat-file runs per repository for the rest, one for the sizes and one for the files small enough to read.
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
    // A file the diff does not change is the same in both versions, so the old commit has it when the new side is the work tree.
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

// Takes the definitions from the first group of repositories that has any, so the nearest repositories win and the rest are only searched when those have none.
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

// The file of the click settles what it can: the name is declared right there, or by a line that encloses the click. Only an imported name, or one the file does not declare, is looked up in the repositories. declared says the click is on a definition, so the question is who uses the name.
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
  // A member is a method, or a field that some type declares. Which one is looked for first follows from whether the member is called.
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
    // Both at once: a member that no type declares would otherwise wait for one search after the other.
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
  // A single definition in the clicked file wins over the same name defined in other files.
  const here = scoped.kind === "free" || scoped.own ? found.hits.filter((h) => h.path === from) : [];
  return here.length === 1 ? only(here) : { ...found, declared: false, member, byName };
}

// The definitions in the file an import names: "./diff.js" next to the importing file, or "airflow.models.dag" and "crate::engine::diff" as the end of a path.
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
