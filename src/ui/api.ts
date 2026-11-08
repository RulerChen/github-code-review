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
  return { diff: body.diff, opened: body.opened, review: body.review ?? null, threads: body.threads ?? [] };
}

export async function fetchRefs(viewId: string): Promise<RefList> {
  const res = await fetch(`/api/views/${encodeURIComponent(viewId)}/refs`, { cache: "no-store" });
  const body = (await res.json().catch(() => null)) as (Partial<RefList> & { error?: string }) | null;
  if (!res.ok || !body?.branches) throw new ApiError(body?.error ?? `HTTP ${res.status}`, res.status);
  return { branches: body.branches, tags: body.tags ?? [], commits: body.commits ?? [] };
}

async function postJson(url: string, payload: unknown): Promise<Thread> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => null)) as { thread?: Thread; error?: string } | null;
  if (!res.ok || !body?.thread) throw new ApiError(body?.error ?? `HTTP ${res.status}`, res.status);
  return body.thread;
}

export function createThread(viewId: string, anchor: ThreadAnchor, snippet: string, body: string): Promise<Thread> {
  return postJson(`/api/views/${encodeURIComponent(viewId)}/threads`, { anchor, snippet, body });
}

export function replyToThread(viewId: string, threadId: string, body: string): Promise<Thread> {
  return postJson(`/api/views/${encodeURIComponent(viewId)}/threads/${encodeURIComponent(threadId)}/comments`, { body });
}
