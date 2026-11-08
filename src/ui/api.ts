import type { Comparison, RefList, Thread, ThreadAnchor, ViewData } from "../shared/types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function comparisonQuery(c: Comparison): string {
  const params = new URLSearchParams({ base: c.base });
  if (c.head !== null) params.set("head", c.head);
  if (!c.threeDot) params.set("dots", "2");
  return params.toString();
}

export function comparisonFromQuery(search: string): Comparison | null {
  const params = new URLSearchParams(search);
  const base = params.get("base");
  return base ? { base, head: params.get("head") || null, threeDot: params.get("dots") !== "2" } : null;
}

/** Loads the view's diff, or another comparison in the same repository when one is given. */
export async function fetchView(viewId: string, compare: Comparison | null): Promise<ViewData> {
  const query = compare ? `?${comparisonQuery(compare)}` : "";
  const res = await fetch(`/api/views/${encodeURIComponent(viewId)}/diff${query}`, { cache: "no-store" });
  const body = (await res.json().catch(() => null)) as (Partial<ViewData> & { error?: string }) | null;
  if (!res.ok || !body?.diff || !body.opened) throw new ApiError(body?.error ?? `HTTP ${res.status}`, res.status);
  return { diff: body.diff, version: body.version ?? "", opened: body.opened, review: body.review ?? null, threads: body.threads ?? [] };
}

/** A cheap fingerprint of the diff fetchView would load, which changes when the files or refs change. */
export async function fetchVersion(viewId: string, compare: Comparison | null): Promise<string> {
  const query = compare ? `?${comparisonQuery(compare)}` : "";
  const res = await fetch(`/api/views/${encodeURIComponent(viewId)}/version${query}`, { cache: "no-store" });
  const body = (await res.json().catch(() => null)) as { version?: string; error?: string } | null;
  if (!res.ok || typeof body?.version !== "string") throw new ApiError(body?.error ?? `HTTP ${res.status}`, res.status);
  return body.version;
}

export async function fetchRefs(viewId: string): Promise<RefList> {
  const res = await fetch(`/api/views/${encodeURIComponent(viewId)}/refs`, { cache: "no-store" });
  const body = (await res.json().catch(() => null)) as (Partial<RefList> & { error?: string }) | null;
  if (!res.ok || !body?.branches) throw new ApiError(body?.error ?? `HTTP ${res.status}`, res.status);
  return { branches: body.branches, tags: body.tags ?? [], commits: body.commits ?? [] };
}

async function postJson<T>(url: string, payload: unknown, ok: (body: Partial<T>) => boolean): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => null)) as (Partial<T> & { error?: string }) | null;
  if (!res.ok || !body || !ok(body)) throw new ApiError(body?.error ?? `HTTP ${res.status}`, res.status);
  return body as T;
}

const hasThread = (b: Partial<{ thread: Thread }>) => b.thread !== undefined;

export async function createThread(viewId: string, anchor: ThreadAnchor, snippet: string, body: string): Promise<Thread> {
  return (await postJson(`/api/views/${encodeURIComponent(viewId)}/threads`, { anchor, snippet, body }, hasThread)).thread;
}

export async function replyToThread(viewId: string, threadId: string, body: string): Promise<Thread> {
  const url = `/api/views/${encodeURIComponent(viewId)}/threads/${encodeURIComponent(threadId)}/comments`;
  return (await postJson(url, { body }, hasThread)).thread;
}

export interface SubmitResult {
  review: number;
  /** Whether Claude was waiting for the review and has been woken to address it. */
  delivered: boolean;
  threads: Thread[];
}

/** Submits every draft comment, with an optional comment on the whole review. */
export function submitReview(viewId: string, body: string): Promise<SubmitResult> {
  return postJson<SubmitResult>(`/api/views/${encodeURIComponent(viewId)}/review`, { body }, (b) => Array.isArray(b.threads));
}
