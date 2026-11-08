import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { computeDiff } from "../engine/diff.js";

export interface View {
  id: string;
  repo: string;
  base: string;
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

  addView(repo: string, base: string): View {
    const view = { id: randomBytes(6).toString("base64url"), repo, base };
    this.views.set(view.id, view);
    return view;
  }

  url(view: View): string {
    return `http://127.0.0.1:${this.port}/v/${view.id}`;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = req.headers.host;
    if (host !== `127.0.0.1:${this.port}` && host !== `localhost:${this.port}`) {
      return sendText(res, 403, "Forbidden host");
    }
    if (req.method !== "GET") return sendText(res, 405, "Method not allowed");

    const { pathname } = new URL(req.url ?? "/", "http://127.0.0.1");
    const api = /^\/api\/views\/([\w-]+)\/diff$/.exec(pathname);
    if (api) {
      const view = this.views.get(api[1]!);
      if (!view) return sendJson(res, 404, { error: "Unknown view. Ask Claude to open the viewer again." });
      try {
        const diff = await computeDiff(view.repo, view.base);
        return sendJson(res, 200, { diff });
      } catch (err) {
        return sendJson(res, 500, { error: errorMessage(err) });
      }
    }
    if (/^\/v\/[\w-]+$/.test(pathname)) return this.sendFile(res, "index.html", "no-store");
    if (pathname.startsWith("/assets/")) return this.sendFile(res, pathname.slice(1), "public, max-age=31536000, immutable");
    return sendText(res, 404, "Not found");
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
