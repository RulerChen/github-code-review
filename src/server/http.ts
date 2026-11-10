import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { type AddressInfo, isIP } from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { computeDiff, diffVersion, listRefs } from "../engine/diff.js";
import { comparisonFromQuery, comparisonQuery, isFor } from "../shared/comparison.js";
import type { Comparison, DiffResult, FileDiff, Grouping, Review, Thread, ThreadAnchor, ThreadContext, Topic, ViewData } from "../shared/types.js";
import { errorMessage, isRecord, sum } from "../shared/util.js";
import { groupChanges } from "./group.js";
import { RepoThreads } from "./threads.js";

interface View {
  id: string;
  repo: string;
  compare: Comparison;
}

export interface LoadedDiff {
  version: string;
  diff: DiffResult;
}

interface CachedDiff extends LoadedDiff {
  key: string;
  chars: number;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

const FIRST_PORT = 7800;
const PORT_COUNT = 10;

const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_COMMENT = 20 * 1024;
const MAX_SNIPPET = 64 * 1024;
const MAX_CONTEXT_LINES = 3;
const MAX_FOCUS = 2000;
const MAX_REF = 1024;
const MAX_OVERRIDES = 1000;
const MAX_PATH = 4096;
const MAX_CACHED_DIFFS = 2;
const MAX_CACHED_CHARS = 64 * 1024 * 1024;

const PING_MS = 25_000;
const PAGE = /^\/v\/[\w-]+$/;
const API = /^\/api\/views\/([\w-]+)\/(diff|file|events|refs|threads|review|wait|version|topics)(?:\/([\w-]+)\/comments(?:\/([\w-]+))?)?$/;
const SHA = /^[0-9a-f]{40,64}$/;

const sshAddress = process.env.SSH_CONNECTION?.split(" ")[2] ?? "";
const SSH_HOST = isIP(sshAddress) ? sshAddress : null;

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

export class ReviewServer {
  private readonly views = new Map<string, View>();
  private readonly repos = new Map<string, RepoThreads>();
  private readonly reviews: Review[] = [];
  private readonly groupings: Grouping[] = [];
  private readonly pages = new Set<(event: string, data: unknown) => void>();
  private diffs: CachedDiff[] = [];
  private readonly token = randomBytes(32).toString("base64url");
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

    const host = SSH_HOST ? undefined : "127.0.0.1";
    let bound = false;
    for (let port = FIRST_PORT; !bound && port < FIRST_PORT + PORT_COUNT; port++) bound = await listen(server, port, host);
    if (!bound) await listen(server, 0, host);
    this.port = (server.address() as AddressInfo).port;
    this.server = server;
  }

  close(): void {
    this.server?.closeAllConnections();
    this.server?.close();
    this.server = null;
  }

  get pageOpen(): boolean {
    return this.pages.size > 0;
  }

  addView(repo: string, compare: Comparison, grouped: { focus: string | null; topics: Topic[] } | null, cwd: string, session: string | null): View {
    let id: string;
    do id = Array.from({ length: 8 }, () => String.fromCharCode(97 + randomInt(26))).join("");
    while (this.views.has(id));
    const view = { id, repo, compare };
    this.views.set(id, view);

    const threads = this.repos.get(repo) ?? new RepoThreads(cwd);
    this.repos.set(repo, threads);
    threads.cwd = cwd;
    if (session) threads.parentSession = session;
    if (grouped) this.addReview(view, compare, grouped.focus, grouped.topics);
    this.broadcast("view", { view: id, repo, compare });
    return view;
  }

  keepDiff(repo: string, compare: Comparison, loaded: LoadedDiff): void {
    const key = `${repo}\0${comparisonQuery(compare)}`;
    const chars = sum(loaded.diff.files, (f) => (f.oldContent?.length ?? 0) + (f.newContent?.length ?? 0));
    this.diffs = [{ ...loaded, key, chars }, ...this.diffs.filter((d) => d.key !== key)].slice(0, MAX_CACHED_DIFFS);
    while (this.diffs.length && sum(this.diffs, (d) => d.chars) > MAX_CACHED_CHARS) this.diffs.pop();
  }

  private async loadDiff(repo: string, compare: Comparison): Promise<LoadedDiff> {
    const key = `${repo}\0${comparisonQuery(compare)}`;
    const version = await diffVersion(repo, compare);
    const cached = this.diffs.find((d) => d.key === key && d.version === version);
    if (cached) return cached;
    const loaded = { version, diff: await computeDiff(repo, compare) };
    this.keepDiff(repo, compare, loaded);
    return loaded;
  }

  repoThreads(): { repo: string; threads: RepoThreads; view: View }[] {
    const newest = new Map<string, View>();
    for (const v of this.views.values()) newest.set(v.repo, v);
    return [...this.repos].map(([repo, threads]) => ({ repo, threads, view: newest.get(repo)! }));
  }

  url(view: View): string {
    const host = !SSH_HOST ? "127.0.0.1" : isIP(SSH_HOST) === 6 ? `[${SSH_HOST}]` : SSH_HOST;
    return `http://${host}:${this.port}/v/${view.id}?token=${this.token}`;
  }

  waitCommand(view: View): string {
    const after = this.repos.get(view.repo)?.submissions.length ?? 0;
    return `curl -sSf "http://127.0.0.1:${this.port}/api/views/${view.id}/wait?after=${after}&token=${this.token}"`;
  }

  private addReview(view: View, compare: Comparison, focus: string | null, topics: Topic[]): void {
    const same = isFor(view.repo, compare);
    const old = this.reviews.findIndex(same);
    if (old >= 0) this.reviews.splice(old, 1);
    this.reviews.push({ repo: view.repo, compare, focus, topics, createdAt: new Date().toISOString(), view: view.id });
    const failed = this.groupings.findIndex((g) => same(g) && g.error !== null);
    if (failed >= 0) this.groupings.splice(failed, 1);
    this.broadcast("reviews", this.reviews);
    this.broadcast("groupings", this.groupings);
  }

  private group(view: View, compare: Comparison, focus: string | null, threads: RepoThreads): void {
    const i = this.groupings.findIndex(isFor(view.repo, compare));
    if (i >= 0 && this.groupings[i]!.error === null) return;
    if (i >= 0) this.groupings.splice(i, 1);

    const job: Grouping = { repo: view.repo, compare, focus, activity: "Starting", error: null };
    this.groupings.push(job);
    this.broadcast("groupings", this.groupings);

    void (async () => {
      try {
        const { diff } = await this.loadDiff(view.repo, compare);
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

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { pathname, searchParams } = new URL(req.url ?? "/", "http://127.0.0.1");
    const assets = pathname.startsWith("/assets/");
    if (!assets && !this.authorize(req, res, pathname, searchParams)) return;

    const api = API.exec(pathname);
    if (api) return this.api(req, res, searchParams, api);

    if (req.method !== "GET") return sendText(res, 405, "Method not allowed");
    if (PAGE.test(pathname)) return this.sendFile(res, "index.html", "no-store");
    if (assets) return this.sendFile(res, pathname.slice(1), "public, max-age=31536000, immutable");
    return sendText(res, 404, "Not found");
  }

  private authorize(req: IncomingMessage, res: ServerResponse, pathname: string, query: URLSearchParams): boolean {
    const given = query.get("token");
    const cookie = `diff-review-${this.port}`;
    if (given !== null && this.validToken(given) && req.method === "GET" && PAGE.test(pathname)) {
      query.delete("token");
      const rest = query.toString();
      res.writeHead(302, {
        Location: rest ? `${pathname}?${rest}` : pathname,
        "Set-Cookie": `${cookie}=${this.token}; Path=/; HttpOnly; SameSite=Strict`,
        "Cache-Control": "no-store",
      });
      res.end();
      return false;
    }

    const fromCookie = req.headers.cookie?.split(/;\s*/).find((c) => c.startsWith(`${cookie}=`))?.slice(cookie.length + 1);
    if (this.validToken(given ?? fromCookie)) return true;

    const error = "Open the URL Claude printed. It carries the access token.";
    if (pathname.startsWith("/api/")) sendJson(res, 401, { error });
    else sendText(res, 401, error);
    return false;
  }

  private async api(req: IncomingMessage, res: ServerResponse, query: URLSearchParams, match: RegExpExecArray): Promise<void> {
    const [, viewId, route, threadId, commentId] = match;
    const view = this.views.get(viewId!);
    if (!view) return sendJson(res, 404, { error: "Unknown view. Ask Claude to open the viewer again." });
    if (req.method !== "GET" && !this.sameOrigin(req)) return sendJson(res, 403, { error: "Cross-site request refused" });

    const threads = this.repos.get(view.repo)!;
    const compare = comparisonFromQuery(query) ?? view.compare;
    const target = commentId ? `${route}/comment` : threadId ? `${route}/thread` : route;

    switch (`${req.method} ${target}`) {
      case "GET diff": {
        const { version, diff } = await this.loadDiff(view.repo, compare);
        const commented = new Set(threads.threads.map((t) => (t.anchor.side === null ? null : t.anchor.path)));
        const data: ViewData = {
          diff: { ...diff, files: diff.files.map((f) => (f.generated && f.hunks.length > 0 && !commented.has(f.path) ? withoutLines(f) : f)) },
          version,
          opened: view.compare,
          reviews: this.reviews,
          groupings: this.groupings,
          threads: threads.threads,
          listening: threads.listening,
        };
        const remote = SSH_HOST !== null && /\bgzip\b/.test(String(req.headers["accept-encoding"]));
        return remote ? sendGzipped(res, data) : sendJson(res, 200, data);
      }
      case "GET file": {
        const { version, diff } = await this.loadDiff(view.repo, compare);
        const file = diff.files.find((f) => f.path === query.get("path"));
        if (!file || version !== query.get("version")) return sendJson(res, 409, { error: "The diff changed. Load the new changes first." });
        return sendJson(res, 200, { file });
      }
      case "GET version":
        return sendJson(res, 200, { version: await diffVersion(view.repo, compare) });
      case "GET refs":
        return sendJson(res, 200, await listRefs(view.repo, query.get("repo")));
      case "GET events":
        return this.events(req, res, threads);
      case "GET wait":
        return wait(res, query, view, threads);
      case "POST topics": {
        const { focus } = await readJson(req);
        if (focus !== undefined && focus !== null && !isText(focus, MAX_FOCUS)) return sendJson(res, 400, { error: "Invalid focus" });
        this.group(view, compare, focus?.trim() || null, threads);
        return sendJson(res, 202, { groupings: this.groupings });
      }
      case "POST threads": {
        const { anchor, snippet, context, body, single } = await readJson(req);
        if (!isComment(body, single) || !isAnchor(anchor) || !isText(snippet, MAX_SNIPPET) || !isContext(context)) {
          return sendJson(res, 400, { error: "Invalid comment" });
        }
        return sendJson(res, 201, { thread: threads.create(anchor, snippet, context, body.trim(), single === true) });
      }
      case "POST threads/thread": {
        const { body, single } = await readJson(req);
        if (!isComment(body, single)) return sendJson(res, 400, { error: "Invalid comment" });
        return sendThread(res, threads.reply(threadId!, body.trim(), single === true), "Unknown thread");
      }
      case "PATCH threads/comment": {
        const { body } = await readJson(req);
        if (!isComment(body, undefined)) return sendJson(res, 400, { error: "Invalid comment" });
        return sendThread(res, threads.edit(threadId!, commentId!, body.trim()), "Unknown comment");
      }
      case "DELETE threads/comment":
        return sendThread(res, threads.remove(threadId!, commentId!), "Unknown comment");
      case "POST review": {
        const { body } = await readJson(req);
        if (!isText(body, MAX_COMMENT)) return sendJson(res, 400, { error: "Invalid review" });
        const result = threads.submit(body.trim());
        if (!result) return sendJson(res, 400, { error: "Nothing to submit. Leave a comment first." });
        return sendJson(res, 200, { review: result.submission.n, delivered: result.delivered, threads: result.threads });
      }
      default:
        return sendText(res, 405, "Method not allowed");
    }
  }

  private validToken(value: string | undefined): boolean {
    const given = Buffer.from(value ?? "");
    const token = Buffer.from(this.token);
    return given.length === token.length && timingSafeEqual(given, token);
  }

  private sameOrigin(req: IncomingMessage): boolean {
    const type = req.headers["content-type"] ?? "";
    const { origin, host } = req.headers;
    const site = req.headers["sec-fetch-site"];
    return type.startsWith("application/json") && (origin === undefined || origin === `http://${host}`) && (site === undefined || site === "same-origin");
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
    send("listening", threads.listening);
    send("reviews", this.reviews);
    send("groupings", this.groupings);
    const unlisten = threads.subscribeListening((on) => send("listening", on));
    this.pages.add(send);
    const ping = setInterval(() => res.write(": ping\n\n"), PING_MS);

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

function wait(res: ServerResponse, query: URLSearchParams, view: View, threads: RepoThreads): void {
  const after = Number(query.get("after") ?? 0);
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
}

function listen(server: Server, port: number, host: string | undefined): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      if (err.code === "EADDRINUSE" || err.code === "EACCES") resolve(false);
      else reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve(true);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) return {};
    chunks.push(chunk);
  }

  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function isText(value: unknown, max: number, nonEmpty = false): value is string {
  return typeof value === "string" && value.length <= max && (!nonEmpty || value.trim() !== "");
}

function isComment(body: unknown, single: unknown): body is string {
  return isText(body, MAX_COMMENT, true) && (single === undefined || typeof single === "boolean");
}

function isAnchor(a: unknown): a is ThreadAnchor {
  if (!isRecord(a)) return false;
  const line = (n: unknown) => Number.isInteger(n) && (n as number) > 0;

  if (a.path === null) {
    return isText(a.topic, MAX_REF, true) && isComparison(a.compare) && a.side === null && a.start === null && a.end === null && a.commit === null;
  }

  if (!isText(a.path, MAX_PATH, true)) return false;
  if (a.commit !== null && !(typeof a.commit === "string" && SHA.test(a.commit))) return false;
  if (a.side === null) return a.start === null && a.end === null;
  return (a.side === "old" || a.side === "new") && line(a.start) && line(a.end) && (a.start as number) <= (a.end as number);
}

function isContext(c: unknown): c is ThreadContext | null {
  const lines = (v: unknown) => Array.isArray(v) && v.length <= MAX_CONTEXT_LINES && v.every((l) => isText(l, MAX_SNIPPET));
  return c === null || (isRecord(c) && lines(c.before) && lines(c.after));
}

function isComparison(c: unknown): c is Comparison {
  return (
    isRange(c) &&
    Array.isArray(c.overrides) &&
    c.overrides.length <= MAX_OVERRIDES &&
    c.overrides.every((o) => isRange(o) && isText(o.dir, MAX_REF, true))
  );
}

function isRange(r: unknown): r is Record<string, unknown> {
  return isRecord(r) && isText(r.base, MAX_REF, true) && (r.head === null || isText(r.head, MAX_REF, true)) && typeof r.threeDot === "boolean";
}

function sendThread(res: ServerResponse, thread: Thread | null, missing: string): void {
  if (thread) sendJson(res, 200, { thread });
  else sendJson(res, 404, { error: missing });
}

function withoutLines(file: FileDiff): FileDiff {
  const blocks = file.blocks.map((b) => ({ ...b, del: [], add: [] }));
  return { ...file, lazy: true, blocks, hunks: [], oldContent: null, newContent: null };
}

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(body));
}

async function sendGzipped(res: ServerResponse, body: unknown): Promise<void> {
  const packed = await promisify(gzip)(JSON.stringify(body), { level: 1 });
  res.writeHead(200, { ...JSON_HEADERS, "Content-Encoding": "gzip" });
  res.end(packed);
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" });
  res.end(body);
}
