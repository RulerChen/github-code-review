import { execFile } from "node:child_process";

export class GitError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
  ) {
    super(message);
  }
}

/**
 * Run git and return stdout as raw bytes. Exit codes listed in `okCodes` are
 * treated as success (e.g. `git diff --no-index` exits 1 when files differ).
 */
export function git(cwd: string, args: string[], okCodes: readonly number[] = [0]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        encoding: "buffer",
        maxBuffer: 512 * 1024 * 1024,
        // Never take index.lock: Claude may be running git in the same repo.
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
