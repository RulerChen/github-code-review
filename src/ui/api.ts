import { comparisonQuery } from "../shared/comparison";
import type { Comparison, FileDiff, Grouping, RefList, Review, Thread, ThreadAnchor, ThreadContext, ViewData } from "../shared/types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface SubmitResult {
  review: number;
  delivered: boolean;
  threads: Thread[];
}

export const viewUrl = (viewId: string, ...parts: string[]) => `/api/views/${[viewId, ...parts].map(encodeURIComponent).join("/")}`;

const withComparison = (url: string, compare: Comparison | null) => (compare ? `${url}?${comparisonQuery(compare)}` : url);

async function request<T>(url: string, ok: (body: Partial<T>) => boolean, method = "GET", payload?: unknown): Promise<T> {
  const init: RequestInit =
    payload === undefined ? { method, cache: "no-store" } : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
  const res = await fetch(url, init);
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

export async function fetchVersion(viewId: string, compare: Comparison | null): Promise<string> {
  const url = withComparison(viewUrl(viewId, "version"), compare);
  return (await request<{ version: string }>(url, (b) => typeof b.version === "string")).version;
}

export function fetchRefs(viewId: string, repo: string | null = null): Promise<RefList> {
  const url = viewUrl(viewId, "refs") + (repo === null ? "" : `?${new URLSearchParams({ repo })}`);
  return request<RefList>(url, (b) => Array.isArray(b.branches));
}

export function createThread(
  viewId: string,
  anchor: ThreadAnchor,
  snippet: string,
  context: ThreadContext | null,
  body: string,
  single: boolean,
): Promise<Thread> {
  return threadRequest(viewUrl(viewId, "threads"), "POST", { anchor, snippet, context, body, single });
}

export function replyToThread(viewId: string, threadId: string, body: string, single: boolean): Promise<Thread> {
  return threadRequest(viewUrl(viewId, "threads", threadId, "comments"), "POST", { body, single });
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

export async function groupTopics(viewId: string, compare: Comparison, focus: string): Promise<Grouping[]> {
  const url = withComparison(viewUrl(viewId, "topics"), compare);
  return (await request<{ groupings: Grouping[] }>(url, (b) => Array.isArray(b.groupings), "POST", { focus })).groupings;
}

export function submitReview(viewId: string, body: string): Promise<SubmitResult> {
  return request<SubmitResult>(viewUrl(viewId, "review"), (b) => Array.isArray(b.threads), "POST", { body });
}
