import type { Thread, ThreadAnchor, ViewData } from "../shared/types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function fetchView(viewId: string): Promise<ViewData> {
  const res = await fetch(`/api/views/${encodeURIComponent(viewId)}/diff`, { cache: "no-store" });
  const body = (await res.json().catch(() => null)) as (Partial<ViewData> & { error?: string }) | null;
  if (!res.ok || !body?.diff) throw new ApiError(body?.error ?? `HTTP ${res.status}`, res.status);
  return { diff: body.diff, review: body.review ?? null, threads: body.threads ?? [] };
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
