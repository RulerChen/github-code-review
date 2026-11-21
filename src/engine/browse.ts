import path from "node:path";
import { wordPattern, wordRegExp } from "../shared/search.js";
import type { DiffRepo, DiffResult, RepoFile, RepoHit } from "../shared/types.js";
import { compareText } from "../shared/util.js";
import { ABSENT, classify, type Content, MAX_CONTENT_BYTES, mapLimit, readWorkTree, REPO_LIMIT } from "./diff.js";
import { git, gitLines } from "./git.js";

export const MAX_HITS = 500;
const MAX_DEFINITIONS = 50;
const MAX_HIT_CHARS = 400;
const LEAD_CHARS = 100;
const NOT_GENERATED = ":(exclude,attr:linguist-generated=true)";
const IDENTIFIER = /^[\p{L}_$][\p{L}\p{N}_$]{0,199}$/u;

const S = "[[:space:]]";
const START = "(^|[^[:alnum:]_$])";
const END = "([^[:alnum:]_$]|$)";
const OPENS = "\\(([^;]*$|[^;{]*\\)[^;{]*\\{)";

const LANGUAGES: { exts: string[]; patterns: (name: string) => string[] }[] = [
  {
    exts: ["py", "pyi"],
    patterns: (n) => [`^${S}*(async${S}+)?def${S}+${n}${S}*\\(`, `^${S}*class${S}+${n}${END}`, `^${n}${S}*(:[^=]*)?=([^=]|$)`],
  },
  {
    exts: ["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"],
    patterns: (n) => [
      `${START}function${S}*\\*?${S}*${n}${S}*[(<]`,
      `${START}(class|interface|type|enum|namespace)${S}+${n}${END}`,
      `${START}(const|let|var)${S}+${n}${S}*(:[^=]*)?=([^=]|$)`,
      `^${S}*((public|private|protected|static|async|readonly|override|abstract|get|set)${S}+)*\\*?${n}${S}*(<[^>]*>)?\\([^;]*\\)[^;]*\\{${S}*$`,
      `^${S}*((public|private|protected|static|readonly|override)${S}+)*${n}${S}*(:[^=]*)?=${S}*(async${S}*)?(\\(|[[:alnum:]_$]+${S}*=>)`,
    ],
  },
  {
    exts: ["go"],
    patterns: (n) => [`^func${S}*(\\([^)]*\\)${S}*)?${n}${S}*[([]`, `^${S}*type${S}+${n}${END}`, `^(var|const)${S}+${n}${END}`],
  },
  {
    exts: ["rs"],
    patterns: (n) => [
      `${START}fn${S}+${n}${S}*[(<]`,
      `${START}(struct|enum|trait|type|union|mod|const|static)${S}+${n}${END}`,
      `macro_rules!${S}*${n}${END}`,
    ],
  },
  {
    exts: ["c", "h", "cc", "cpp", "cxx", "c++", "hpp", "hh", "hxx", "h++", "ipp", "inl", "cu", "cuh", "m", "mm", "java", "cs"],
    patterns: (n) => [
      `^[^[:space:]#/][^;=]*[^[:alnum:]_$]${n}${S}*${OPENS}`,
      `^${n}${S}*${OPENS}`,
      `^${S}+([[:alnum:]_][[:alnum:]_:<>,*&]*${S}+)+[*&]*${n}${S}*${OPENS}`,
      `^${S}*#${S}*define${S}+${n}${END}`,
      `${START}(struct|class|union|enum|interface|record)${S}+([[:alnum:]_]+${S}+)*${n}${S}*([{:<]|$)`,
      `^${S}*typedef[^;]*[^[:alnum:]_]${n}${S}*;`,
      `${START}using${S}+${n}${S}*=`,
    ],
  },
];

const KEYWORDS = "def|defp|defmodule|fn|fun|func|function|sub|proc|class|struct|interface|trait|object|module|type|enum|macro";
const anyLanguage = (n: string) => [`${START}(${KEYWORDS})${S}+${n}${END}`];

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
export function grepRepo(diff: DiffResult, query: string, whole: boolean, signal: AbortSignal): Promise<Found> {
  const found = wordRegExp(query, whole);
  const pattern = wordPattern(query, whole);
  const plain = (query.match(/[A-Za-z0-9_]+/g) ?? []).reduce((a, b) => (b.length > a.length ? b : a), "");
  const match = plain && plain !== pattern ? ["-e", plain, "--and", "-e", pattern] : ["-e", pattern];
  return grepLines(diff, searchable(diff), ["-E", "-i", ...match], ["."], MAX_HITS, signal, (text) => found?.exec(text)?.index ?? -1);
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

const defines = (name: string, patterns: string[]) => ["-E", "-e", name, "--and", "(", ...patterns.flatMap((p) => ["-e", p]), ")"];

export const isIdentifier = (name: string) => IDENTIFIER.test(name);

// declared says the clicked line is one of the definitions, so the question is who uses the name.
export async function findDefinitions(
  diff: DiffResult,
  name: string,
  from: string,
  line: number | null,
  signal: AbortSignal,
): Promise<Found & { declared: boolean }> {
  const base = from.slice(from.lastIndexOf("/") + 1);
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1).toLowerCase() : "";
  const language = LANGUAGES.find((l) => l.exts.includes(ext));
  const escaped = name.replaceAll("$", "\\$");
  const patterns = language ? language.patterns(escaped) : anyLanguage(escaped);
  const exts = language?.exts ?? (ext ? [ext] : []);
  const pathspecs = exts.length ? exts.map((e) => `*.${e}`) : ["."];
  const own = repoOf(diff, from)?.repo;
  const all = searchable(diff);
  const found = await nearestFirst(own ? [[own], all.filter((r) => r !== own)] : [all], (repos) =>
    grepLines(diff, repos, defines(escaped, patterns), pathspecs, MAX_DEFINITIONS, signal, (text) => text.indexOf(name)),
  );
  return { ...found, declared: found.hits.some((h) => h.path === from && h.no === line) };
}

export function findDefinitionsAnywhere(diff: DiffResult, name: string, signal: AbortSignal): Promise<Found> {
  const escaped = name.replaceAll("$", "\\$");
  const lower = name.toLowerCase();
  const all = searchable(diff);
  const changed = all.filter((r) => diff.files.some((f) => r.dir === "" || f.path.startsWith(`${r.dir}/`)));
  return nearestFirst([changed, all.filter((r) => !changed.includes(r))], async (repos) => {
    const find = (patterns: string[], pathspecs: string[]) =>
      grepLines(diff, repos, ["-i", ...defines(escaped, patterns)], pathspecs, MAX_DEFINITIONS, signal, (text) => text.toLowerCase().indexOf(lower));
    const found = await Promise.all([
      ...LANGUAGES.map((l) => find(l.patterns(escaped), l.exts.map((e) => `*.${e}`))),
      find(anyLanguage(escaped), [".", ...LANGUAGES.flatMap((l) => l.exts).map((e) => `:(exclude)*.${e}`)]),
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

  const all = parts.flat().sort((a, b) => compareText(a.path, b.path) || a.no - b.no);
  return { hits: all.slice(0, max), capped: all.length > max };
}

function hitOf(filePath: string, no: number, text: string, at: number): RepoHit {
  if (text.length <= MAX_HIT_CHARS) return { path: filePath, no, text, at };
  const from = Math.max(0, at - LEAD_CHARS);
  return { path: filePath, no, text: text.slice(from, from + MAX_HIT_CHARS), at: at < 0 ? -1 : at - from };
}
