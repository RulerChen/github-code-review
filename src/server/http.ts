import { randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { computeDiff, diffVersion, listRefs } from "../engine/diff.js";
import { comparisonFromQuery, sameComparison } from "../shared/comparison.js";
import type { Comparison, Grouping, Review, Thread, ThreadAnchor, Topic, ViewData } from "../shared/types.js";
import { groupChanges } from "./group.js";
import { RepoThreads } from "./threads.js";

export interface View {
  id: string;
  repo: string;
  compare: Comparison;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

export class ReviewServer {
  private readonly views = new Map<string, View>();
  private readonly repos = new Map<string, RepoThreads>();
  private readonly reviews: Review[] = [];
  private readonly groupings: Grouping[] = [];
  // Each open page's event stream.
  private readonly pages = new Set<(event: string, data: unknown) => void>();
  private readonly uiDir: string;
  private server: Server | null = null;
  private port = 0;

  constructor(uiDir: string) {
    this.uiDir = path.resolve(uiDir);
  }

  async start(): Promise<void> {
    const server = createServer((req, res) => {
      this.handle(req, res).catch((err: unknown) => {
        if (!res.headersSent) sendJson(res, 500, { error: errorMessage(err) });
        else res.destroy();
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    this.port = (server.address() as AddressInfo).port;
    this.server = server;
  }

  close(): void {
    this.server?.closeAllConnections();
    this.server?.close();
    this.server = null;
  }

  /** Whether a page is open, so it shows each view Claude opens instead of the user opening its URL. */
  get pageOpen(): boolean {
    return this.pages.size > 0;
  }

  /** A view for Claude's comparison, with its topics when it grouped the changes. Open pages switch to it. */
  addView(repo: string, compare: Comparison, grouped: { focus: string | null; topics: Topic[] } | null, cwd: string, session: string | null): View {
    let id: string;
    do id = Array.from({ length: 8 }, () => String.fromCharCode(97 + randomInt(26))).join("");
    while (this.views.has(id));
    const view = { id, repo, compare };
    this.views.set(view.id, view);
    let threads = this.repos.get(repo);
    if (!threads) {
      threads = new RepoThreads(cwd);
      this.repos.set(repo, threads);
    }
    threads.cwd = cwd;
    if (session) threads.parentSession = session;
    if (grouped) this.addReview(view, compare, grouped.focus, grouped.topics);
    this.broadcast("view", { view: view.id, repo, compare });
    return view;
  }

  // A newer review of the same comparison replaces the older one.
  private addReview(view: View, compare: Comparison, focus: string | null, topics: Topic[]): void {
    const same = (r: { repo: string; compare: Comparison }) => r.repo === view.repo && sameComparison(r.compare, compare);
    const old = this.reviews.findIndex(same);
    if (old >= 0) this.reviews.splice(old, 1);
    this.reviews.push({ repo: view.repo, compare, focus, topics, createdAt: new Date().toISOString(), view: view.id });
    // A failed attempt at grouping the comparison is moot once it has a review.
    const failed = this.groupings.findIndex((g) => same(g) && g.error !== null);
    if (failed >= 0) this.groupings.splice(failed, 1);
    this.broadcast("reviews", this.reviews);
    this.broadcast("groupings", this.groupings);
  }

  /** Asks Claude to group the comparison into topics, unless it is already at it. Progress and the review reach the pages as events. */
  private group(view: View, compare: Comparison, focus: string | null, threads: RepoThreads): void {
    const i = this.groupings.findIndex((g) => g.repo === view.repo && sameComparison(g.compare, compare));
    if (i >= 0 && this.groupings[i]!.error === null) return;
    if (i >= 0) this.groupings.splice(i, 1);
    const job: Grouping = { repo: view.repo, compare, focus, activity: "Starting", error: null };
    this.groupings.push(job);
    this.broadcast("groupings", this.groupings);
    void (async () => {
      try {
        const diff = await computeDiff(view.repo, compare);
        if (!diff.files.length) throw new Error("This comparison has no changes to group.");
        const onActivity = (activity: string) => {
          job.activity = activity;
          this.broadcast("groupings", this.groupings);
        };
        const topics = await groupChanges({ diff, focus, cwd: threads.cwd, session: threads.parentSession, onActivity });
        this.groupings.splice(this.groupings.indexOf(job), 1);
        this.addReview(view, compare, focus, topics);
      } catch (err) {
        job.activity = null;
        job.error = errorMessage(err);
        this.broadcast("groupings", this.groupings);
      }
    })();
  }

  private broadcast(event: string, data: unknown): void {
    for (const send of this.pages) send(event, data);
  }

  /** Each repository's threads, with the newest view opened for it. */
  repoThreads(): { repo: string; threads: RepoThreads; view: View }[] {
    const newest = new Map<string, View>();
    for (const v of this.views.values()) newest.set(v.repo, v);
    return [...this.repos].map(([repo, threads]) => ({ repo, threads, view: newest.get(repo)! }));
  }

  url(view: View): string {
    return `http://127.0.0.1:${this.port}/v/${view.id}`;
  }

  /** A shell command that exits once the user submits a review newer than the ones submitted so far. */
  waitCommand(view: View): string {
    const after = this.repos.get(view.repo)?.submissions.length ?? 0;
    return `curl -sSf "http://127.0.0.1:${this.port}/api/views/${view.id}/wait?after=${after}"`;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = req.headers.host;
    if (host !== `127.0.0.1:${this.port}` && host !== `localhost:${this.port}`) {
      return sendText(res, 403, "Forbidden host");
    }

    const { pathname, searchParams } = new URL(req.url ?? "/", "http://127.0.0.1");
    const api = /^\/api\/views\/([\w-]+)\/(diff|events|refs|threads|review|wait|version|topics)(?:\/([\w-]+)\/comments(?:\/([\w-]+))?)?$/.exec(pathname);
    if (api) {
      const view = this.views.get(api[1]!);
      if (!view) return sendJson(res, 404, { error: "Unknown view. Ask Claude to open the viewer again." });
      const threads = this.repos.get(view.repo)!;
      const route = api[2];
      const threadId = api[3];
      const commentId = api[4];

      if (req.method === "GET" && route === "diff" && !threadId) {
        try {
          const compare = comparisonFromQuery(searchParams) ?? view.compare;
          const version = await diffVersion(view.repo, compare);
          const diff = await computeDiff(view.repo, compare);
          const data: ViewData = {
            diff,
            version,
            opened: view.compare,
            reviews: this.reviews,
            groupings: this.groupings,
            threads: threads.threads,
            listening: threads.listening,
          };
          return sendJson(res, 200, data);
        } catch (err) {
          return sendJson(res, 500, { error: errorMessage(err) });
        }
      }
      if (req.method === "GET" && route === "version" && !threadId) {
        try {
          return sendJson(res, 200, { version: await diffVersion(view.repo, comparisonFromQuery(searchParams) ?? view.compare) });
        } catch (err) {
          return sendJson(res, 500, { error: errorMessage(err) });
        }
      }
      if (req.method === "GET" && route === "refs" && !threadId) {
        try {
          return sendJson(res, 200, await listRefs(view.repo));
        } catch (err) {
          return sendJson(res, 500, { error: errorMessage(err) });
        }
      }
      if (req.method === "GET" && route === "events" && !threadId) return this.events(req, res, threads);
      if (req.method === "POST" && route === "topics" && !threadId) {
        if (!this.sameOrigin(req)) return sendJson(res, 403, { error: "Cross-site request refused" });
        const { focus } = (await readJson(req)) ?? {};
        if (focus !== undefined && focus !== null && !isText(focus, 2000)) return sendJson(res, 400, { error: "Invalid focus" });
        this.group(view, comparisonFromQuery(searchParams) ?? view.compare, focus?.trim() || null, threads);
        return sendJson(res, 202, { groupings: this.groupings });
      }
      if (route === "threads" && threadId && commentId && (req.method === "PATCH" || req.method === "DELETE")) {
        if (!this.sameOrigin(req)) return sendJson(res, 403, { error: "Cross-site request refused" });
        if (req.method === "DELETE") {
          const thread = threads.remove(threadId, commentId);
          return thread ? sendJson(res, 200, { thread }) : sendJson(res, 404, { error: "Unknown comment" });
        }
        const { body: text } = (await readJson(req)) ?? {};
        if (!isText(text, 20 * 1024, true)) return sendJson(res, 400, { error: "Invalid comment" });
        const thread = threads.edit(threadId, commentId, text.trim());
        return thread ? sendJson(res, 200, { thread }) : sendJson(res, 404, { error: "Unknown comment" });
      }
      if (req.method === "POST" && route === "threads" && !commentId) {
        if (!this.sameOrigin(req)) return sendJson(res, 403, { error: "Cross-site request refused" });
        const { anchor, snippet, body: text } = (await readJson(req)) ?? {};
        if (!isText(text, 20 * 1024, true)) return sendJson(res, 400, { error: "Invalid comment" });
        if (!threadId) {
          if (!isAnchor(anchor) || !isText(snippet, 64 * 1024)) return sendJson(res, 400, { error: "Invalid comment" });
          return sendJson(res, 201, { thread: threads.create(anchor, snippet, text.trim()) });
        }
        const thread = threads.reply(threadId, text.trim());
        if (!thread) return sendJson(res, 404, { error: "Unknown thread" });
        return sendJson(res, 200, { thread });
      }
      if (req.method === "POST" && route === "review" && !threadId) {
        if (!this.sameOrigin(req)) return sendJson(res, 403, { error: "Cross-site request refused" });
        const { body: text } = (await readJson(req)) ?? {};
        if (!isText(text, 20 * 1024)) return sendJson(res, 400, { error: "Invalid review" });
        const result = threads.submit(text.trim());
        if (!result) return sendJson(res, 400, { error: "Nothing to submit. Leave a comment first." });
        return sendJson(res, 200, { review: result.submission.n, delivered: result.delivered, threads: result.threads });
      }
      // Claude runs this with curl in the background, and the response wakes it to address the review.
      if (req.method === "GET" && route === "wait" && !threadId) {
        const after = Number(searchParams.get("after") ?? 0);
        if (!Number.isInteger(after) || after < 0) return sendText(res, 400, "Invalid after");
        const stop = threads.waitForReview(after, (s) =>
          sendText(
            res,
            200,
            `The user submitted review ${s.n} in ${view.repo}. Call get_review_comments from the diff-review MCP server ` +
              `with repo set to ${JSON.stringify(view.repo)} and after set to ${after}.\n`,
          ),
        );
        res.on("close", stop);
        return;
      }
      return sendText(res, 405, "Method not allowed");
    }

    if (req.method !== "GET") return sendText(res, 405, "Method not allowed");
    if (/^\/v\/[\w-]+$/.test(pathname)) return this.sendFile(res, "index.html", "no-store");
    if (pathname.startsWith("/assets/")) return this.sendFile(res, pathname.slice(1), "public, max-age=31536000, immutable");
    return sendText(res, 404, "Not found");
  }

  private sameOrigin(req: IncomingMessage): boolean {
    const type = req.headers["content-type"] ?? "";
    const origin = req.headers.origin;
    const site = req.headers["sec-fetch-site"];
    const origins = [`http://127.0.0.1:${this.port}`, `http://localhost:${this.port}`];
    return type.startsWith("application/json") && (origin === undefined || origins.includes(origin)) && (site === undefined || site === "same-origin");
  }

  private events(req: IncomingMessage, res: ServerResponse, threads: RepoThreads): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.write("retry: 2000\n\n");
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const unsubscribe = threads.subscribe((thread) => send("thread", thread));
    // A reconnect can miss a change, so each connection starts with the current state.
    send("listening", threads.listening);
    send("reviews", this.reviews);
    send("groupings", this.groupings);
    const unlisten = threads.subscribeListening((on) => send("listening", on));
    this.pages.add(send);
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(ping);
      unsubscribe();
      unlisten();
      this.pages.delete(send);
    });
  }

  private async sendFile(res: ServerResponse, rel: string, cacheControl: string): Promise<void> {
    const abs = path.resolve(this.uiDir, rel);
    if (!abs.startsWith(this.uiDir + path.sep)) return sendText(res, 404, "Not found");
    let body: Buffer;
    try {
      body = await readFile(abs);
    } catch {
      return sendText(res, 404, "Not found");
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(abs)] ?? "application/octet-stream",
      "Cache-Control": cacheControl,
      "Content-Security-Policy": CSP,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(body);
  }
}

async function readJson(req: IncomingMessage, limit = 256 * 1024): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) return null;
    chunks.push(chunk);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isText(value: unknown, max: number, nonEmpty = false): value is string {
  return typeof value === "string" && value.length <= max && (!nonEmpty || value.trim() !== "");
}

function isAnchor(value: unknown): value is ThreadAnchor {
  if (value === null || typeof value !== "object") return false;
  const a = value as Record<string, unknown>;
  const line = (n: unknown) => Number.isInteger(n) && (n as number) > 0;
  if (a.path === null) {
    return isText(a.topic, 1024, true) && isComparison(a.compare) && a.side === null && a.start === null && a.end === null && a.commit === null;
  }
  if (!isText(a.path, 4096, true)) return false;
  if (a.commit !== null && !(typeof a.commit === "string" && /^[0-9a-f]{40,64}$/.test(a.commit))) return false;
  if (a.side === null) return a.start === null && a.end === null;
  return (a.side === "old" || a.side === "new") && line(a.start) && line(a.end) && (a.start as number) <= (a.end as number);
}

function isComparison(value: unknown): value is Comparison {
  if (value === null || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return isText(c.base, 1024, true) && (c.head === null || isText(c.head, 1024, true)) && typeof c.threeDot === "boolean";
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" });
  res.end(body);
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
