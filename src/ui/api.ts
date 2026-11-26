import { comparisonQuery } from "../shared/comparison";
import type {
  Comparison,
  Definitions,
  FileDiff,
  Grouping,
  RefList,
  RepoFile,
  Review,
  SearchHits,
  Thread,
  ThreadAnchor,
  ThreadContext,
  ViewData,
} from "../shared/types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const UNREACHABLE = "Could not reach the viewer. It stops when the Claude Code session ends: ask Claude to open it again.";

export const viewUrl =(viewId: string, ...parts: string[]) => `/api/views/${[viewId, ...parts].map(encodeURIComponent).join("/")}`;

const withComparison = (url: string, compare: Comparison | null) => (compare ? `${url}?${comparisonQuery(compare)}` : url);

async function request<T>(url: string, ok: (body: Partial<T>) => boolean, method = "GET", payload?: unknown, signal?: AbortSignal): Promise<T> {
  const init: RequestInit =
    payload === undefined
      ? { method, cache: "no-store", signal }
      : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new ApiError(UNREACHABLE, 0);
  }
  const body = (await res.json().catch(() => null)) as (Partial<T> & { error?: string }) | null;
  if (!res.ok || !body || !ok(body)) throw new ApiError(body?.error ?? `HTTP ${res.status}`, res.status);
  return body as T;
}

const hasThread = (b: Partial<{ thread: Thread }>) => b.thread !== undefined;

const threadRequest = async (url: string, method: string, payload: unknown) =>
  (await request<{ thread: Thread }>(url, hasThread, method, payload)).thread;

export function fetchView(viewId: string, compare: Comparison | null): Promise<ViewData> {
  return request<ViewData>(withComparison(viewUrl(viewId, "diff"), compare), (b) => !!b.diff && !!b.opened);
}

export async function fetchFile(viewId: string, compare: Comparison | null, version: string, path: string): Promise<FileDiff> {
  const params = new URLSearchParams(compare ? comparisonQuery(compare) : "");
  params.set("path", path);
  params.set("version", version);
  return (await request<{ file: FileDiff }>(`${viewUrl(viewId, "file")}?${params}`, (b) => !!b.file)).file;
}

function fileQuery(compare: Comparison | null, version: string, path: string): URLSearchParams {
  const params = new URLSearchParams(compare ? comparisonQuery(compare) : "");
  params.set("path", path);
  params.set("version", version);
  return params;
}

export async function fetchRepoFile(viewId: string, compare: Comparison | null, version: string, path: string): Promise<RepoFile> {
  return (await request<{ file: RepoFile }>(`${viewUrl(viewId, "blob")}?${fileQuery(compare, version, path)}`, (b) => !!b.file)).file;
}

export function rawFileUrl(viewId: string, compare: Comparison | null, version: string, path: string, old = false): string {
  const params = fileQuery(compare, version, path);
  if (old) params.set("side", "old");
  return `${viewUrl(viewId, "raw")}?${params}`;
}

export async function fetchBytes(url: string): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch {
    throw new ApiError(UNREACHABLE, 0);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? `HTTP ${res.status}`, res.status);
  }
  return new Uint8Array(await res.arrayBuffer());
}

export async function fetchTree(viewId: string, compare: Comparison | null, version: string): Promise<string[]> {
  const params = new URLSearchParams(compare ? comparisonQuery(compare) : "");
  params.set("version", version);
  return (await request<{ paths: string[] }>(`${viewUrl(viewId, "tree")}?${params}`, (b) => Array.isArray(b.paths))).paths;
}

export function searchRepo(
  viewId: string,
  compare: Comparison | null,
  version: string,
  query: string,
  whole: boolean,
  matchCase: boolean,
  signal: AbortSignal,
): Promise<SearchHits> {
  const params = new URLSearchParams(compare ? comparisonQuery(compare) : "");
  params.set("version", version);
  params.set("q", query);
  if (!whole) params.set("word", "0");
  if (!matchCase) params.set("case", "0");
  return request<SearchHits>(`${viewUrl(viewId, "grep")}?${params}`, (b) => Array.isArray(b.hits) && Array.isArray(b.defs), "GET", undefined, signal);
}

export interface ClickedAt {
  path: string;
  line: number | null;
  col: number;
  panel: boolean;
}

export function fetchDefinitions(viewId: string, compare: Comparison | null, version: string, name: string, from: ClickedAt): Promise<Definitions> {
  const params = new URLSearchParams(compare ? comparisonQuery(compare) : "");
  params.set("version", version);
  params.set("name", name);
  params.set("path", from.path);
  if (from.line !== null) {
    params.set("line", String(from.line));
    params.set("col", String(from.col));
  }
  return request<Definitions>(`${viewUrl(viewId, "defs")}?${params}`, (b) => Array.isArray(b.hits));
}

export async function fetchVersion(viewId: string, compare: Comparison | null): Promise<string> {
  const url = withComparison(viewUrl(viewId, "version"), compare);
  return (await request<{ version: string }>(url, (b) => typeof b.version === "string")).version;
}

export function fetchRefs(viewId: string, repo: string | null = null): Promise<RefList> {
  const url = viewUrl(viewId, "refs") + (repo === null ? "" : `?${new URLSearchParams({ repo })}`);
  return request<RefList>(url, (b) => Array.isArray(b.branches));
}

export function createThread(viewId: string, anchor: ThreadAnchor, snippet: string, context: ThreadContext | null, body: string): Promise<Thread> {
  return threadRequest(viewUrl(viewId, "threads"), "POST", { anchor, snippet, context, body });
}

export function replyToThread(viewId: string, threadId: string, body: string): Promise<Thread> {
  return threadRequest(viewUrl(viewId, "threads", threadId, "comments"), "POST", { body });
}

export function editComment(viewId: string, threadId: string, commentId: string, body: string): Promise<Thread> {
  return threadRequest(viewUrl(viewId, "threads", threadId, "comments", commentId), "PATCH", { body });
}

export function deleteComment(viewId: string, threadId: string, commentId: string): Promise<Thread> {
  return threadRequest(viewUrl(viewId, "threads", threadId, "comments", commentId), "DELETE", {});
}

export async function deleteReview(viewId: string, review: Review): Promise<Review[]> {
  const payload = { repo: review.repo, createdAt: review.createdAt };
  return (await request<{ reviews: Review[] }>(viewUrl(viewId, "reviews"), (b) => Array.isArray(b.reviews), "DELETE", payload)).reviews;
}

export interface TopicRequest {
  focus: string;
  topics: string[] | null;
  replaces: string | null;
}

export async function groupTopics(viewId: string, compare: Comparison, ask: TopicRequest | { sync: string }): Promise<Grouping[]> {
  const url = withComparison(viewUrl(viewId, "topics"), compare);
  return (await request<{ groupings: Grouping[] }>(url, (b) => Array.isArray(b.groupings), "POST", ask)).groupings;
}
