import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Review, Thread } from "../shared/types.js";
import { errorMessage } from "../shared/util.js";
import type { Submission } from "./threads.js";

const DIR = process.env.CLAUDE_PLUGIN_DATA ? path.join(process.env.CLAUDE_PLUGIN_DATA, "reviews") : null;
const FORMAT = 1;
const KEEP_MS = 3 * 24 * 60 * 60 * 1000;

interface SavedState {
  threads: Thread[];
  submissions: Submission[];
  read: number;
  reviews: Review[];
}

function fileFor(session: string, repo: string): string {
  return path.join(DIR!, `${session}-${createHash("sha256").update(repo).digest("hex").slice(0, 16)}.json`);
}

export function loadState(session: string, repo: string): SavedState | null {
  if (!DIR) return null;
  try {
    const saved = JSON.parse(readFileSync(fileFor(session, repo), "utf8"));
    return saved.format === FORMAT ? saved.state : null;
  } catch {
    return null;
  }
}

export function saveState(session: string, repo: string, state: SavedState): void {
  if (!DIR) return;
  const file = fileFor(session, repo);
  try {
    mkdirSync(DIR, { recursive: true, mode: 0o700 });
    writeFileSync(`${file}.tmp`, JSON.stringify({ format: FORMAT, repo, state }), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  } catch (err) {
    console.error(`diff-review: could not save the review of ${repo}: ${errorMessage(err)}`);
  }
}

export function dropOldStates(): void {
  if (!DIR) return;
  try {
    for (const name of readdirSync(DIR)) {
      const file = path.join(DIR, name);
      if (Date.now() - statSync(file).mtimeMs > KEEP_MS) unlinkSync(file);
    }
  } catch {}
}
