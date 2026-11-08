import { execFile } from "node:child_process";

export class GitError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
  ) {
    super(message);
  }
}

export function git(cwd: string, args: string[], okCodes: readonly number[] = [0]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        encoding: "buffer",
        maxBuffer: 512 * 1024 * 1024,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout);
        const code = typeof err.code === "number" ? err.code : null;
        if (code !== null && okCodes.includes(code)) return resolve(stdout);
        const detail = stderr.toString("utf8").trim() || err.message;
        reject(new GitError(`git ${args[0]} failed: ${detail}`, code));
      },
    );
  });
}
