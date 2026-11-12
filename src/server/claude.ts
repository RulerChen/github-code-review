import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";

interface AskOptions {
  cwd: string;
  resume: string | null;
  fork: boolean;
  prompt: string;
  onText: (text: string) => void;
  onActivity: (activity: string) => void;
}

interface StreamLine {
  type?: string;
  subtype?: string;
  session_id?: string;
  is_error?: boolean;
  result?: string;
  event?: { type?: string; delta?: { type?: string; text?: string } };
  message?: { content?: { type: string; name?: string; input?: Record<string, unknown> }[] };
}

const TIMEOUT_MS = 5 * 60 * 1000;
const running = new Set<ChildProcess>();

export function stopAll(): void {
  for (const child of running) child.kill();
}

export function ask(o: AskOptions): Promise<{ sessionId: string | null; text: string }> {
  const args = [
    "-p",
    "--model", "opus",
    "--effort", "medium",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--tools", "Read,Grep,Glob",
    "--strict-mcp-config",
    "--mcp-config", '{"mcpServers":{}}',
  ];
  if (o.resume) args.push("--resume", o.resume);
  if (o.resume && o.fork) args.push("--fork-session");

  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { cwd: o.cwd, stdio: ["pipe", "pipe", "pipe"] });
    running.add(child);
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);

    let settled = false;
    let sessionId: string | null = null;
    let result: string | null = null;
    let failure: string | null = null;
    let streamed = "";
    let stderr = "";

    const finish = (err: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      running.delete(child);
      if (err) reject(err);
      else if (result !== null) resolve({ sessionId, text: result });
      else reject(new Error(failure ?? (stderr.trim() || "Claude stopped without an answer.")));
    };

    child.stderr.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString("utf8")).slice(-2000);
    });

    createInterface({ input: child.stdout }).on("line", (line) => {
      let m: StreamLine;
      try {
        m = JSON.parse(line) as StreamLine;
      } catch {
        return;
      }
      if (m.session_id) sessionId = m.session_id;

      if (m.type === "stream_event") {
        if (m.event?.type === "message_start") streamed = "";
        if (m.event?.type === "content_block_delta" && m.event.delta?.type === "text_delta") {
          streamed += m.event.delta.text ?? "";
          o.onText(streamed);
        }
      } else if (m.type === "assistant") {
        for (const c of m.message?.content ?? []) {
          if (c.type === "tool_use") o.onActivity(describe(o.cwd, c.name ?? "", c.input ?? {}));
        }
      } else if (m.type === "result") {
        if (m.is_error || m.subtype !== "success") failure = m.result || `Claude stopped: ${m.subtype ?? "error"}`;
        else result = m.result ?? streamed;
      }
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      finish(new Error(err.code === "ENOENT" ? "The claude command was not found on PATH." : err.message));
    });
    child.on("close", () => finish(null));
    child.stdin.on("error", () => {});
    child.stdin.end(o.prompt);
  });
}

function describe(cwd: string, tool: string, input: Record<string, unknown>): string {
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  if (tool === "Read") return `Reading ${path.relative(cwd, str("file_path")) || str("file_path")}`;
  if (tool === "Grep") return `Searching for ${str("pattern")}`;
  if (tool === "Glob") return `Looking for ${str("pattern")}`;
  return `Using ${tool}`;
}
