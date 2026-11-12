import { execFile, spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

const MAX_OUTPUT = 512 * 1024 * 1024;
const MAX_STDERR = 4096;

const gitEnv = () => ({ ...process.env, GIT_OPTIONAL_LOCKS: "0" });

export function git(cwd: string, args: string[], okCodes: readonly number[] = [0], input?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile("git", args, { cwd, encoding: "buffer", maxBuffer: MAX_OUTPUT, env: gitEnv() }, (err, stdout, stderr) => {
      if (!err || (typeof err.code === "number" && okCodes.includes(err.code))) return resolve(stdout);
      reject(new Error(`git ${args[0]} failed: ${stderr.toString("utf8").trim() || err.message}`));
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
  });
}

export async function gitText(cwd: string, args: string[], okCodes?: readonly number[]): Promise<string> {
  return (await git(cwd, args, okCodes)).toString("utf8").trim();
}

export function gitLines(
  cwd: string,
  args: string[],
  onLine: (line: string) => boolean,
  okCodes: readonly number[] = [0],
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, env: gitEnv(), stdio: ["ignore", "pipe", "pipe"], signal });
    const decoder = new StringDecoder("utf8");
    let rest = "";
    let stopped = false;
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      if (stopped) return;
      const lines = (rest + decoder.write(chunk)).split("\n");
      rest = lines.pop()!;
      for (const line of lines) {
        if (onLine(line)) continue;
        stopped = true;
        child.kill();
        return;
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR) stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => (stopped || signal?.aborted ? resolve() : reject(err)));
    child.on("close", (code) => {
      if (stopped || signal?.aborted) return resolve();
      rest += decoder.end();
      if (rest) onLine(rest);
      if (code !== null && okCodes.includes(code)) resolve();
      else reject(new Error(`git ${args[0]} failed: ${stderr.trim() || `exit code ${code}`}`));
    });
  });
}
