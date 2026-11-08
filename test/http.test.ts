import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ReviewServer, TOKEN_HEADER, type View } from "../src/server/http.js";

let root: string;
let server: ReviewServer;
let view: View;
let port: number;

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), "diff-review-http-"));
  const repo = path.join(root, "repo");
  const ui = path.join(root, "ui");
  mkdirSync(repo);
  mkdirSync(path.join(ui, "assets"), { recursive: true });
  writeFileSync(path.join(ui, "index.html"), "<!doctype html><title>t</title>");
  writeFileSync(path.join(ui, "assets", "app.js"), "console.log(1)");
  writeFileSync(path.join(root, "secret.txt"), "do not serve");

  const sh = (...args: string[]) => execFileSync("git", args, { cwd: repo });
  sh("init", "-q");
  sh("config", "user.email", "t@example.com");
  sh("config", "user.name", "t");
  writeFileSync(path.join(repo, "a.txt"), "one\n");
  sh("add", "-A");
  sh("commit", "-q", "-m", "c");
  writeFileSync(path.join(repo, "a.txt"), "two\n");

  server = new ReviewServer(ui);
  await server.start();
  view = server.addView(repo, "HEAD");
  port = Number(new URL(server.url(view)).port);
});

afterAll(() => {
  server.close();
  rmSync(root, { recursive: true, force: true });
});

function get(
  pathname: string,
  headers: Record<string, string> = {},
  method = "GET",
): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path: pathname, method, headers: { host: `127.0.0.1:${port}`, ...headers } },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("ReviewServer", () => {
  it("puts the token in the URL fragment, not the path or query", () => {
    const url = new URL(server.url(view));
    expect(url.hostname).toBe("127.0.0.1");
    expect(url.search).toBe("");
    expect(url.hash).toBe(`#token=${server.token}`);
  });

  it("rejects requests whose Host header is not this server", async () => {
    const res = await get(`/api/views/${view.id}/diff`, { host: "evil.example:80", [TOKEN_HEADER]: server.token });
    expect(res.status).toBe(403);
  });

  it("requires the token for the API", async () => {
    expect((await get(`/api/views/${view.id}/diff`)).status).toBe(401);
    expect((await get(`/api/views/${view.id}/diff`, { [TOKEN_HEADER]: "wrong" })).status).toBe(401);
  });

  it("returns the diff with the right token", async () => {
    const res = await get(`/api/views/${view.id}/diff`, { [TOKEN_HEADER]: server.token });
    expect(res.status).toBe(200);
    const { diff } = JSON.parse(res.body);
    expect(diff.files).toHaveLength(1);
    expect(diff.files[0].blocks[0]).toMatchObject({ del: ["one"], add: ["two"] });
  });

  it("returns 404 for an unknown view", async () => {
    expect((await get("/api/views/nope/diff", { [TOKEN_HEADER]: server.token })).status).toBe(404);
  });

  it("serves the page with a content security policy", async () => {
    const res = await get(`/v/${view.id}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(String(res.headers["content-security-policy"])).toContain("default-src 'self'");
    expect((await get("/assets/app.js")).body).toBe("console.log(1)");
  });

  it("does not serve files outside the UI directory", async () => {
    for (const p of ["/assets/../secret.txt", "/assets/%2e%2e/%2e%2e/secret.txt", "/assets/..%2f..%2fsecret.txt"]) {
      const res = await get(p);
      expect(res.status).toBe(404);
      expect(res.body).not.toContain("do not serve");
    }
  });

  it("only accepts GET", async () => {
    expect((await get(`/api/views/${view.id}/diff`, { [TOKEN_HEADER]: server.token }, "POST")).status).toBe(405);
  });
});
