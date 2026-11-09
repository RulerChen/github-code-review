import { execFile } from "node:child_process";

const MAX_OUTPUT = 512 * 1024 * 1024;

export function git(cwd: string, args: string[], okCodes: readonly number[] = [0], input?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
    const child = execFile("git", args, { cwd, encoding: "buffer", maxBuffer: MAX_OUTPUT, env }, (err, stdout, stderr) => {
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
