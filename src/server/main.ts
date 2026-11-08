import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { computeDiff, summarize } from "../engine/diff.js";
import { errorMessage, ReviewServer } from "./http.js";

const VERSION = "0.1.0";

const UI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "ui");

let serverPromise: Promise<ReviewServer> | null = null;

function getServer(): Promise<ReviewServer> {
  serverPromise ??= (async () => {
    const s = new ReviewServer(UI_DIR);
    await s.start();
    return s;
  })();
  return serverPromise;
}

async function openViewer(repo: string, base: string): Promise<{ url: string; summary: string }> {
  const diff = await computeDiff(repo, base);
  const server = await getServer();
  const view = server.addView(diff.repoRoot, base);
  return { url: server.url(view), summary: summarize(diff) };
}

async function shutdown(): Promise<never> {
  if (serverPromise) (await serverPromise).close();
  process.exit(0);
}

async function runHttpOnly(base: string): Promise<void> {
  const { url, summary } = await openViewer(process.cwd(), base);
  console.error(`${summary}\n${url}`);
  process.on("SIGINT", () => void shutdown());
}

async function runMcp(): Promise<void> {
  const mcp = new McpServer({ name: "diff-review", version: VERSION });

  mcp.registerTool(
    "open_diff_viewer",
    {
      title: "Open diff viewer",
      description:
        "Open a GitHub-style diff viewer in the user's browser for a git repository: the working tree " +
        "(staged, unstaged and untracked files) compared with a base ref. Returns a local URL to give to the user.",
      inputSchema: {
        repo: z
          .string()
          .optional()
          .describe("Absolute path of a directory inside the git repository. Defaults to the server's working directory."),
        base: z
          .string()
          .optional()
          .describe("Git ref to compare the working tree against, such as HEAD, main, HEAD~3, a tag or a commit. Defaults to HEAD."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ repo, base }) => {
      try {
        const { url, summary } = await openViewer(repo ?? process.cwd(), base ?? "HEAD");
        return { content: [{ type: "text", text: `${url}\n${summary}` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Could not open the diff viewer: ${errorMessage(err)}` }], isError: true };
      }
    },
  );

  mcp.server.onclose = () => void shutdown();
  process.stdin.on("end", () => void shutdown());
  await mcp.connect(new StdioServerTransport());
}

const httpOnly = process.argv.indexOf("--http-only");
if (httpOnly >= 0) {
  await runHttpOnly(process.argv[httpOnly + 1] ?? "HEAD");
} else {
  await runMcp();
}
