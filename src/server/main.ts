import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { computeDiff, describeFailures, diffVersion, summarize } from "../engine/diff.js";
import { sameRange, sortOverrides } from "../shared/comparison.js";
import type { Comparison, Topic } from "../shared/types.js";
import { errorMessage, plural } from "../shared/util.js";
import { stopAll } from "./claude.js";
import { ReviewServer } from "./http.js";
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

function result(text: string, isError = false) {
  const content = [{ type: "text" as const, text }];
  return isError ? { content, isError } : { content };
}

async function attempt(failure: string, run: () => Promise<string>) {
  try {
    return result(await run());
  } catch (err) {
    return result(`${failure}: ${errorMessage(err)}`, true);
  }
}

async function openViewer(repo: string, compare: Comparison, focus?: string, topics?: Topic[], session?: string): Promise<string> {
  const [version, diff] = await Promise.all([diffVersion(repo, compare), computeDiff(repo, compare)]);
  let grouped: { focus: string | null; topics: Topic[] } | null = null;
  let note = "";

  if (topics) {
    const { unknown, unassigned } = checkTopics(diff, topics);
    if (unknown.length) {
      throw new Error(`Unknown change ids: ${unknown.join(", ")}. Call list_changes again and use the ids it prints.`);
    }
    if (unassigned.length) {
      note = `\n${unassigned.length} change(s) are in no topic and appear under "Other changes": ${unassigned.join(", ")}`;
    }
    grouped = { focus: focus?.trim() || null, topics };
  }

  const server = await getServer();
  server.keepDiff(diff.repoRoot, compare, { version, diff });
  const { view, restored } = server.addView(diff.repoRoot, compare, grouped, repo, session && SESSION_ID.test(session) ? session : null);
  if (restored?.threads) note += `\nBrought back ${plural(restored.threads, "comment thread")} from the viewer this session had open before.`;
  if (restored?.unread) {
    note += `\n${plural(restored.unread, "review")} submitted there ${restored.unread === 1 ? "was" : "were"} never read. Read ${restored.unread === 1 ? "it" : "them"} with get_review_comments.`;
  }
  const shown = server.pageOpen
    ? "\nThe viewer page already open in the user's browser has switched to this comparison, so they do not need to open the URL again."
    : "";
  const failed = describeFailures(diff).map((l) => `\n${l}`).join("");
  return `${server.url(view)}\n${summarize(diff)}${failed}${note}${shown}\nWait for the user's review in the background with: ${server.waitCommand(view)}`;
}

async function shutdown(): Promise<never> {
  stopAll();
  if (serverPromise) (await serverPromise).close();
  process.exit(0);
}

async function runHttpOnly(base: string): Promise<void> {
  console.error(await openViewer(process.cwd(), { base, head: null, threeDot: true, overrides: [] }));
  process.on("SIGINT", () => void shutdown());
}

async function runMcp(): Promise<void> {
  const mcp = new McpServer({ name: "diff-review", version: VERSION });

  const repo = z
    .string()
    .optional()
    .describe(
      "Absolute path of a directory inside the git repository. Defaults to the server's working directory. A directory " +
        "with no .git of its own but git repositories directly under it covers all of them in one diff, each file's " +
        "path starting with its repository's directory.",
    );

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

  const overrides = z
    .array(
      z.object({
        dir: z.string().describe("The repository's directory under repo, which starts the paths of its files."),
        base: z.string().describe("Git ref for the old side in this repository."),
        head: z.string().optional().describe("Git ref for the new side in this repository. Omit it for its working tree."),
        threeDot: z.boolean().optional().describe("As threeDot, for this repository. Defaults to true."),
      }),
    )
    .optional()
    .describe(
      "When repo is a directory of repositories: the repositories that compare refs of their own instead of base, head " +
        "and threeDot.",
    );

  type Overrides = { dir: string; base: string; head?: string; threeDot?: boolean }[];
  const comparison = (args: { base?: string; head?: string; threeDot?: boolean; overrides?: Overrides }): Comparison => {
    const c = { base: args.base ?? "HEAD", head: args.head ?? null, threeDot: args.threeDot ?? true };
    const own = new Map((args.overrides ?? []).map((o) => [o.dir, { dir: o.dir, base: o.base, head: o.head ?? null, threeDot: o.threeDot ?? true }]));
    return { ...c, overrides: sortOverrides([...own.values()].filter((o) => !sameRange(o, c))) };
  };

  mcp.registerTool(
    "list_changes",
    {
      title: "List changes",
      description:
        "List every change between a base ref and either the working tree (staged, unstaged and untracked) or a head " +
        "ref, each with a stable id and its removed and added lines, and the commits in between. Use the ids to group " +
        "changes into topics for open_diff_viewer.",
      inputSchema: { repo, base, head, threeDot, overrides },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) => attempt("Could not list changes", async () => formatChanges(await computeDiff(args.repo ?? process.cwd(), comparison(args)))),
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
        overrides,
        focus: z.string().optional().describe("What the user wants to review, in their words."),
        session: z
          .string()
          .optional()
          .describe(
            "The current Claude Code session id. @claude questions in the page continue a fork of this session, and the " +
              "review's comments are saved under it, so they come back when the session opens the viewer again.",
          ),
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
    (args) =>
      attempt("Could not open the diff viewer", () => {
        const topics = args.topics?.map((t) => ({ ...t, related: t.related ?? true }));
        return openViewer(args.repo ?? process.cwd(), comparison(args), args.focus, topics, args.session);
      }),
  );

  mcp.registerTool(
    "get_review_comments",
    {
      title: "Get review comments",
      description:
        "Read the review the user submitted in the diff viewer: their comment on the whole review and each comment " +
        "thread with its id, the selected lines (or the whole file or topic) and the earlier comments. Without after it also " +
        "lists draft comments they have not submitted yet and their @claude questions. A ```suggestion block in a comment " +
        "holds the lines the user wants in place of the thread's selected lines. Use it when the wait command from " +
        "open_diff_viewer finishes, or when the user asks you to address their review comments.",
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
              "reviews this tool has not returned yet, or the latest one if it returned them all, and the drafts.",
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      const server = serverPromise ? await serverPromise : null;
      const all = server?.repoThreads() ?? [];
      const wanted = args.repo ? path.resolve(args.repo) : null;
      const containing = wanted ? all.filter((r) => wanted === r.repo || wanted.startsWith(r.repo + path.sep)) : all;
      const repos = wanted ? containing.filter((r) => !containing.some((o) => o.repo.length > r.repo.length)) : all;
      if (args.after !== undefined && !wanted && repos.filter((r) => r.threads.submissions.length).length > 1) {
        return result("Several repositories have reviews, numbered separately. Set repo to the one the wait command named.", true);
      }

      const parts = repos.flatMap(({ repo, threads, view }) => {
        const text = formatReviewComments(threads.threads, threads.submissions, args.after ?? null, threads.read);
        threads.markRead();
        if (!text) return [];
        return [
          `${repo}\n\n${text}\n\nWhen you have addressed it, reply on each thread with reply_to_review. Then wait for the next ` +
            `review by running this in the background: ${server!.waitCommand(view)}`,
        ];
      });
      if (!all.length) {
        return result("No viewer is open. Open it with open_diff_viewer, which brings back the comments of the viewer this session had open before.");
      }
      return result(parts.length ? parts.join("\n\n") : "No review comments yet.");
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
      if (unknown.length) return result(`Unknown thread ids: ${unknown.join(", ")}. Nothing was posted.`, true);
      for (const r of replies) owner(r.thread)!.replyFromSession(r.thread, r.body.trim());
      return result(`Replied on ${plural(replies.length, "thread")}.`);
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
