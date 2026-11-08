import type { DiffResult } from "../shared/types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function fetchDiff(viewId: string): Promise<DiffResult> {
  const res = await fetch(`/api/views/${encodeURIComponent(viewId)}/diff`, { cache: "no-store" });
  const body = (await res.json().catch(() => null)) as { diff?: DiffResult; error?: string } | null;
  if (!res.ok || !body?.diff) throw new ApiError(body?.error ?? `HTTP ${res.status}`, res.status);
  return body.diff;
}
