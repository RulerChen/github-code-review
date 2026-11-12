import path from "node:path";
import type { DiffRepo, DiffResult, RepoFile, RepoHit } from "../shared/types.js";
import { compareText } from "../shared/util.js";
import { ABSENT, classify, type Content, MAX_CONTENT_BYTES, mapLimit, readWorkTree, REPO_LIMIT } from "./diff.js";
import { git, gitLines } from "./git.js";

export const MAX_HITS = 500;
const MAX_HIT_CHARS = 400;
const LEAD_CHARS = 100;
const NOT_GENERATED = ":(exclude,attr:linguist-generated=true)";

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

export async function grepRepo(diff: DiffResult, query: string, signal: AbortSignal): Promise<{ hits: RepoHit[]; capped: boolean }> {
  const q = query.toLowerCase();
  const repos = diff.repos.filter((r) => r.error === null);
  const parts = await mapLimit(repos, REPO_LIMIT, async (repo) => {
    const prefix = repo.dir ? `${repo.dir}/` : "";
    const rev = repo.headCommit;
    const strip = rev ? `${rev}:` : "";
    const where = rev ? [rev] : ["--untracked"];
    const args = ["grep", "--no-color", "-n", "-z", "-I", "-F", "-i", "-e", query, ...where, "--", ".", NOT_GENERATED];
    const hits: RepoHit[] = [];
    await gitLines(
      path.join(diff.repoRoot, repo.dir),
      args,
      (line) => {
        const a = line.indexOf("\0");
        const b = line.indexOf("\0", a + 1);
        if (a < 0 || b < 0) return true;
        const file = line.slice(0, a);
        hits.push(hitOf(prefix + (file.startsWith(strip) ? file.slice(strip.length) : file), Number(line.slice(a + 1, b)), line.slice(b + 1), q));
        return hits.length <= MAX_HITS;
      },
      [0, 1],
      signal,
    );
    return hits;
  });

  const all = parts.flat().sort((a, b) => compareText(a.path, b.path) || a.no - b.no);
  return { hits: all.slice(0, MAX_HITS), capped: all.length > MAX_HITS };
}

function hitOf(filePath: string, no: number, text: string, q: string): RepoHit {
  const at = text.toLowerCase().indexOf(q);
  if (text.length <= MAX_HIT_CHARS) return { path: filePath, no, text, at };
  const from = Math.max(0, at - LEAD_CHARS);
  return { path: filePath, no, text: text.slice(from, from + MAX_HIT_CHARS), at: at < 0 ? -1 : at - from };
}
