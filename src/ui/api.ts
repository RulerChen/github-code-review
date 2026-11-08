import type { ViewData } from "../shared/types";

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
  return { diff: body.diff, review: body.review ?? null };
}
