import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { computeDiff, summarize } from "../engine/diff.js";
import type { Review, Thread, Topic } from "../shared/types.js";
import { stopAll } from "./claude.js";
import { errorMessage, ReviewServer } from "./http.js";
import { checkTopics, formatChanges } from "./review.js";

const DIST_DIR = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(DIST_DIR, "ui");
const VERSION: string = JSON.parse(readFileSync(path.join(DIST_DIR, "..", ".claude-plugin", "plugin.json"), "utf8")).version;

let serverPromise: Promise<ReviewServer> | null = null;

function getServer(): Promise<ReviewServer> {
  serverPromise ??= (async () => {
    const s = new ReviewServer(UI_DIR);
    await s.start();
    return s;
  })();
  return serverPromise;
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function openViewer(repo: string, base: string, focus?: string, topics?: Topic[], session?: string): Promise<string> {
  const diff = await computeDiff(repo, base);
  let review: Review | null = null;
  let note = "";

  if (topics) {
    const { unknown, unassigned } = checkTopics(diff, topics);
    if (unknown.length) {
      throw new Error(`Unknown change ids: ${unknown.join(", ")}. Call list_changes again and use the ids it prints.`);
    }
    if (unassigned.length) {
      note = `\n${unassigned.length} change(s) are in no topic and appear under "Other changes": ${unassigned.join(", ")}`;
    }
    review = { focus: focus?.trim() || null, topics };
  }

  const server = await getServer();
  const view = server.addView(diff.repoRoot, base, review, repo, session && SESSION_ID.test(session) ? session : null);
  return `${server.url(view)}\n${summarize(diff)}${note}`;
}

async function shutdown(): Promise<never> {
  stopAll();
  if (serverPromise) (await serverPromise).close();
  process.exit(0);
}

async function runHttpOnly(base: string): Promise<void> {
  console.error(await openViewer(process.cwd(), base));
  process.on("SIGINT", () => void shutdown());
}

async function runMcp(): Promise<void> {
  const mcp = new McpServer({ name: "diff-review", version: VERSION });

  const repo = z
    .string()
    .optional()
    .describe("Absolute path of a directory inside the git repository. Defaults to the server's working directory.");
  const base = z
    .string()
    .optional()
    .describe("Git ref to compare the working tree against, such as HEAD, main, HEAD~3, a tag or a commit. Defaults to HEAD.");

  mcp.registerTool(
    "list_changes",
    {
      title: "List changes",
      description:
        "List every change in the working tree (staged, unstaged and untracked) compared with a base ref, each with " +
        "a stable id and its removed and added lines. Use the ids to group changes into topics for open_diff_viewer.",
      inputSchema: { repo, base },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        const diff = await computeDiff(args.repo ?? process.cwd(), args.base ?? "HEAD");
        return { content: [{ type: "text", text: formatChanges(diff) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Could not list changes: ${errorMessage(err)}` }], isError: true };
      }
    },
  );

  mcp.registerTool(
    "open_diff_viewer",
    {
      title: "Open diff viewer",
      description:
        "Open a GitHub-style diff viewer in the user's browser for a git repository: the working tree compared with " +
        "a base ref. With topics, the page also shows the changes grouped by topic with your explanation of each. " +
        "Returns a local URL to give to the user.",
      inputSchema: {
        repo,
        base,
        focus: z.string().optional().describe("What the user wants to review, in their words."),
        session: z
          .string()
          .optional()
          .describe("The current Claude Code session id. @claude questions in the page continue a fork of this session."),
        topics: z
          .array(
            z.object({
              title: z.string().describe("A few words naming the topic."),
              summary: z.string().describe("Markdown explaining what changed in this topic and why."),
              ids: z.array(z.string()).describe("Ids from list_changes of the changes in this topic."),
              related: z.boolean().optional().describe("false when the topic has nothing to do with the focus."),
            }),
          )
          .optional()
          .describe("Every change from list_changes grouped into topics, in the order the reviewer should read them."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        const topics = args.topics?.map((t) => ({ ...t, related: t.related ?? true }));
        const text = await openViewer(args.repo ?? process.cwd(), args.base ?? "HEAD", args.focus, topics, args.session);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Could not open the diff viewer: ${errorMessage(err)}` }], isError: true };
      }
    },
  );

  mcp.registerTool(
    "get_review_comments",
    {
      title: "Get review comments",
      description:
        "Read the comment threads the user left on lines in the diff viewer, with the selected lines and any " +
        "answers from @claude. Use it when the user asks you to address their review comments.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const server = serverPromise ? await serverPromise : null;
      const repos = server?.allThreads().filter((r) => r.threads.length) ?? [];
      const text = repos.length ? repos.map((r) => `${r.repo}\n\n${r.threads.map(formatThread).join("\n\n")}`).join("\n\n") : "No review comments yet.";
      return { content: [{ type: "text", text }] };
    },
  );

  mcp.server.onclose = () => void shutdown();
  process.stdin.on("end", () => void shutdown());
  await mcp.connect(new StdioServerTransport());
}

function formatThread(t: Thread): string {
  const { path, side, start, end } = t.anchor;
  const range = start === end ? `line ${start}` : `lines ${start}-${end}`;
  const snippet = t.snippet.split("\n").slice(0, 8).map((l) => `  > ${l}`);
  const comments = t.comments
    .filter((c) => c.status === "done")
    .map((c) => `  ${c.author === "user" ? "User" : "Claude"}: ${c.body.replace(/\n/g, "\n    ")}`);
  return [`${path}, ${side} ${range}`, ...snippet, ...comments].join("\n");
}

const httpOnly = process.argv.indexOf("--http-only");
if (httpOnly >= 0) {
  await runHttpOnly(process.argv[httpOnly + 1] ?? "HEAD");
} else {
  await runMcp();
}
