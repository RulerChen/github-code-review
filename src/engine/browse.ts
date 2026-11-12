import path from "node:path";
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

export function grepRepo(diff: DiffResult, query: string, signal: AbortSignal): Promise<{ hits: RepoHit[]; capped: boolean }> {
  const q = query.toLowerCase();
  return grepLines(diff, ["-F", "-i", "-e", query], ["."], MAX_HITS, signal, (text) => text.toLowerCase().indexOf(q));
}

export const isIdentifier = (name: string) => IDENTIFIER.test(name);

export function findDefinitions(diff: DiffResult, name: string, from: string, signal: AbortSignal): Promise<{ hits: RepoHit[]; capped: boolean }> {
  const base = from.slice(from.lastIndexOf("/") + 1);
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1).toLowerCase() : "";
  const language = LANGUAGES.find((l) => l.exts.includes(ext));
  const escaped = name.replaceAll("$", "\\$");
  const patterns = language ? language.patterns(escaped) : anyLanguage(escaped);
  const exts = language?.exts ?? (ext ? [ext] : []);
  const pathspecs = exts.length ? exts.map((e) => `*.${e}`) : ["."];
  return grepLines(diff, ["-E", ...patterns.flatMap((p) => ["-e", p])], pathspecs, MAX_DEFINITIONS, signal, (text) => text.indexOf(name));
}

async function grepLines(
  diff: DiffResult,
  match: string[],
  pathspecs: string[],
  max: number,
  signal: AbortSignal,
  atOf: (text: string) => number,
): Promise<{ hits: RepoHit[]; capped: boolean }> {
  const repos = diff.repos.filter((r) => r.error === null);
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
