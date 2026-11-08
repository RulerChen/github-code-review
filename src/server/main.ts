import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { computeDiff, summarize } from "../engine/diff.js";
import type { Comparison, Review, Topic } from "../shared/types.js";
import { stopAll } from "./claude.js";
import { errorMessage, ReviewServer } from "./http.js";
import { checkTopics, formatChanges, formatReviewComments } from "./review.js";

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

async function openViewer(repo: string, compare: Comparison, focus?: string, topics?: Topic[], session?: string): Promise<string> {
  const diff = await computeDiff(repo, compare);
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
  const view = server.addView(diff.repoRoot, compare, review, repo, session && SESSION_ID.test(session) ? session : null);
  return `${server.url(view)}\n${summarize(diff)}${note}\nWait for the user's review in the background with: ${server.waitCommand(view)}`;
}

async function shutdown(): Promise<never> {
  stopAll();
  if (serverPromise) (await serverPromise).close();
  process.exit(0);
}

async function runHttpOnly(base: string): Promise<void> {
  console.error(await openViewer(process.cwd(), { base, head: null, threeDot: true }));
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
    .describe("Git ref for the old side, such as HEAD, main, HEAD~3, a tag or a commit. Defaults to HEAD.");
  const head = z
    .string()
    .optional()
    .describe("Git ref for the new side. Omit it to compare the working tree, with staged, unstaged and untracked changes.");
  const threeDot = z
    .boolean()
    .optional()
    .describe(
      "true (the default) compares from the merge base of base and head, like GitHub's base...head, so only the changes " +
        "made on head's side show. false compares base with head directly, like git diff base..head.",
    );
  const comparison = (args: { base?: string; head?: string; threeDot?: boolean }): Comparison => ({
    base: args.base ?? "HEAD",
    head: args.head ?? null,
    threeDot: args.threeDot ?? true,
  });

  mcp.registerTool(
    "list_changes",
    {
      title: "List changes",
      description:
        "List every change between a base ref and either the working tree (staged, unstaged and untracked) or a head " +
        "ref, each with a stable id and its removed and added lines, and the commits in between. Use the ids to group " +
        "changes into topics for open_diff_viewer.",
      inputSchema: { repo, base, head, threeDot },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        const diff = await computeDiff(args.repo ?? process.cwd(), comparison(args));
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
        "Open a GitHub-style diff viewer in the user's browser for a git repository: the working tree or a head ref " +
        "compared with a base ref. The user can pick other branches, tags and commits to compare in the page. With " +
        "topics, the page also shows the changes grouped by topic with your explanation of each. Returns a local URL " +
        "to give to the user.",
      inputSchema: {
        repo,
        base,
        head,
        threeDot,
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
        const text = await openViewer(args.repo ?? process.cwd(), comparison(args), args.focus, topics, args.session);
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
        "Read the review the user submitted in the diff viewer: their comment on the whole review and each comment " +
        "thread with its id, the selected lines (or the whole file or topic) and the earlier comments. Without after it also " +
        "lists draft comments they have not submitted yet and their @claude questions. Use it when the wait command from open_diff_viewer " +
        "finishes, or when the user asks you to address their review comments.",
      inputSchema: {
        repo: z
          .string()
          .optional()
          .describe("The repository the wait command names. Omit it to read every repository with a viewer open."),
        after: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            "Read every review of that repository numbered above this one, as the wait command says. Omit it for the " +
              "latest review and the drafts.",
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      const server = serverPromise ? await serverPromise : null;
      const all = server?.repoThreads() ?? [];
      const wanted = args.repo ? path.resolve(args.repo) : null;
      const repos = wanted ? all.filter((r) => wanted === r.repo || wanted.startsWith(r.repo + path.sep)) : all;
      // Each repository numbers its reviews from 1, so one after number cannot serve several.
      if (args.after !== undefined && !wanted && repos.filter((r) => r.threads.submissions.length).length > 1) {
        const text = "Several repositories have reviews, numbered separately. Set repo to the one the wait command named.";
        return { content: [{ type: "text", text }], isError: true };
      }
      const parts = repos.flatMap(({ repo, threads, view }) => {
        const text = formatReviewComments(threads.threads, threads.submissions, args.after ?? null);
        if (!text) return [];
        return [
          `${repo}\n\n${text}\n\nWhen you have addressed it, reply on each thread with reply_to_review. Then wait for the next ` +
            `review by running this in the background: ${server!.waitCommand(view)}`,
        ];
      });
      return { content: [{ type: "text", text: parts.length ? parts.join("\n\n") : "No review comments yet." }] };
    },
  );

  mcp.registerTool(
    "reply_to_review",
    {
      title: "Reply to review",
      description:
        "Reply on comment threads in the diff viewer after addressing the user's review, saying what you changed or " +
        "answering the comment. The replies show in the page.",
      inputSchema: {
        replies: z
          .array(
            z.object({
              thread: z.string().describe("A thread id from get_review_comments."),
              body: z.string().min(1).describe("Markdown: what you changed, or your answer."),
            }),
          )
          .min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ replies }) => {
      const repos = serverPromise ? (await serverPromise).repoThreads() : [];
      const owner = (id: string) => repos.find((r) => r.threads.threads.some((t) => t.id === id))?.threads;
      const unknown = replies.filter((r) => !owner(r.thread)).map((r) => r.thread);
      if (unknown.length) {
        return { content: [{ type: "text", text: `Unknown thread ids: ${unknown.join(", ")}. Nothing was posted.` }], isError: true };
      }
      for (const r of replies) owner(r.thread)!.replyFromSession(r.thread, r.body.trim());
      return { content: [{ type: "text", text: `Replied on ${replies.length} thread${replies.length === 1 ? "" : "s"}.` }] };
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
