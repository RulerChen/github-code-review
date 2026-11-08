import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeDiff } from "../src/engine/diff.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function repo(): { dir: string; sh: (...args: string[]) => string; write: (p: string, c: string | Buffer) => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "diff-review-test-"));
  dirs.push(dir);
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  const write = (p: string, c: string | Buffer) => {
    mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    writeFileSync(path.join(dir, p), c);
  };
  return { dir, sh, write };
}

const numbered = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`);
const text = (lines: string[]) => lines.join("\n") + "\n";
/** Hunk header without the section heading git appends after the second "@@". */
const range = (header: string) => /^@@ [^@]+ @@/.exec(header)![0];

function commitAll(r: ReturnType<typeof repo>, msg = "c") {
  r.sh("add", "-A");
  r.sh("commit", "-q", "-m", msg);
}

function only<T>(items: T[]): T {
  expect(items).toHaveLength(1);
  return items[0]!;
}

describe("computeDiff", () => {
  it("returns no files for a clean tree", async () => {
    const r = repo();
    r.write("a.txt", text(numbered(5)));
    commitAll(r);
    const res = await computeDiff(r.dir);
    expect(res.files).toEqual([]);
    expect(res.baseCommit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("splits distant changes into separate hunks with three lines of context", async () => {
    const r = repo();
    r.write("a.txt", text(numbered(20)));
    commitAll(r);
    const lines = numbered(20);
    lines[2] = "changed 3";
    lines[14] = "changed 15";
    r.write("a.txt", text(lines));

    const f = only((await computeDiff(r.dir)).files);
    expect(f.status).toBe("modified");
    expect(f.blocks).toHaveLength(2);
    expect(f.additions).toBe(2);
    expect(f.deletions).toBe(2);
    expect(f.hunks.map((h) => range(h.header))).toEqual(["@@ -1,6 +1,6 @@", "@@ -12,7 +12,7 @@"]);
    expect(f.hunks[0]!.lines.map((l) => [l.kind, l.oldNo, l.newNo, l.text])).toEqual([
      ["context", 1, 1, "line 1"],
      ["context", 2, 2, "line 2"],
      ["del", 3, null, "line 3"],
      ["add", null, 3, "changed 3"],
      ["context", 4, 4, "line 4"],
      ["context", 5, 5, "line 5"],
      ["context", 6, 6, "line 6"],
    ]);
  });

  it("merges changes that are close together into one hunk", async () => {
    const r = repo();
    r.write("a.txt", text(numbered(20)));
    commitAll(r);
    const lines = numbered(20);
    lines[4] = "five";
    lines[8] = "nine";
    r.write("a.txt", text(lines));

    const f = only((await computeDiff(r.dir)).files);
    expect(f.blocks).toHaveLength(2);
    expect(f.hunks).toHaveLength(1);
    expect(range(f.hunks[0]!.header)).toBe("@@ -2,11 +2,11 @@");
    const blockIds = f.hunks[0]!.lines.filter((l) => l.blockId).map((l) => l.blockId);
    expect(new Set(blockIds)).toEqual(new Set(f.blocks.map((b) => b.id)));
  });

  it("keeps a block id when an unrelated edit shifts its line numbers", async () => {
    const r = repo();
    r.write("a.txt", text(numbered(20)));
    commitAll(r);
    const lines = numbered(20);
    lines[14] = "changed 15";
    r.write("a.txt", text(lines));
    const before = only((await computeDiff(r.dir)).files).blocks;

    r.write("a.txt", text(["inserted", ...lines]));
    const after = only((await computeDiff(r.dir)).files).blocks;

    expect(before).toHaveLength(1);
    expect(after).toHaveLength(2);
    const moved = after.find((b) => b.id === before[0]!.id);
    expect(moved).toBeDefined();
    expect(moved!.newStart).toBe(before[0]!.newStart + 1);
  });

  it("gives identical changes in one file distinct ids", async () => {
    const r = repo();
    const lines = numbered(20);
    lines[1] = "x";
    lines[15] = "x";
    r.write("a.txt", text(lines));
    commitAll(r);
    lines[1] = "y";
    lines[15] = "y";
    r.write("a.txt", text(lines));

    const ids = only((await computeDiff(r.dir)).files).blocks.map((b) => b.id);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(`${ids[0]}-2`);
  });

  it("shows an untracked file as one added block", async () => {
    const r = repo();
    r.write("a.txt", "a\n");
    commitAll(r);
    r.write("new/file.ts", "one\ntwo\nthree");

    const f = (await computeDiff(r.dir)).files.find((x) => x.path === "new/file.ts")!;
    expect(f.status).toBe("added");
    expect(f.additions).toBe(3);
    expect(f.blocks).toHaveLength(1);
    expect(f.hunks[0]!.header).toBe("@@ -0,0 +1,3 @@");
    expect(f.hunks[0]!.lines.at(-1)).toMatchObject({ kind: "add", newNo: 3, text: "three", noEol: true });
    expect(f.newContent).toBe("one\ntwo\nthree");
  });

  it("shows a deleted file as all removed lines", async () => {
    const r = repo();
    r.write("gone.txt", text(numbered(4)));
    r.write("keep.txt", "k\n");
    commitAll(r);
    rmSync(path.join(r.dir, "gone.txt"));

    const f = only((await computeDiff(r.dir)).files);
    expect(f.status).toBe("deleted");
    expect(f.deletions).toBe(4);
    expect(f.hunks[0]!.header).toBe("@@ -1,4 +0,0 @@");
    expect(f.hunks[0]!.lines.every((l) => l.kind === "del")).toBe(true);
  });

  it("detects a staged rename with an edit", async () => {
    const r = repo();
    r.write("old.txt", text(numbered(20)));
    commitAll(r);
    r.sh("mv", "old.txt", "new.txt");
    const lines = numbered(20);
    lines[9] = "edited";
    r.write("new.txt", text(lines));

    const f = only((await computeDiff(r.dir)).files);
    expect(f.status).toBe("renamed");
    expect(f.oldPath).toBe("old.txt");
    expect(f.path).toBe("new.txt");
    expect(f.blocks).toHaveLength(1);
    expect(f.oldContent).toBe(text(numbered(20)));
  });

  it("marks binary files and gives them no blocks", async () => {
    const r = repo();
    r.write("img.bin", Buffer.from([0, 1, 2, 3]));
    commitAll(r);
    r.write("img.bin", Buffer.from([0, 1, 2, 4, 5]));

    const f = only((await computeDiff(r.dir)).files);
    expect(f.binary).toBe(true);
    expect(f.blocks).toEqual([]);
    expect(f.hunks).toEqual([]);
  });

  it("numbers insertions at the top and pure deletions correctly", async () => {
    const r = repo();
    r.write("a.txt", text(numbered(20)));
    commitAll(r);
    const lines = numbered(20);
    lines.splice(9, 2); // delete lines 10 and 11
    r.write("a.txt", text(["new 1", "new 2", ...lines]));

    const f = only((await computeDiff(r.dir)).files);
    expect(f.hunks.map((h) => range(h.header))).toEqual(["@@ -1,3 +1,5 @@", "@@ -7,8 +9,6 @@"]);
    const del = f.hunks[1]!.lines.filter((l) => l.kind === "del");
    expect(del.map((l) => [l.oldNo, l.text])).toEqual([
      [10, "line 10"],
      [11, "line 11"],
    ]);
    expect(f.hunks[1]!.lines.at(-1)).toMatchObject({ kind: "context", oldNo: 14, newNo: 14, text: "line 14" });
  });

  it("diffs against another base ref even when the tree is clean", async () => {
    const r = repo();
    r.write("a.txt", "one\n");
    commitAll(r, "first");
    r.write("a.txt", "two\n");
    commitAll(r, "second");

    const res = await computeDiff(r.dir, "HEAD~1");
    expect(only(res.files).blocks[0]).toMatchObject({ del: ["one"], add: ["two"] });
  });

  it("treats everything as added in a repository without commits", async () => {
    const r = repo();
    r.write("a.txt", "hello\n");
    const res = await computeDiff(r.dir);
    expect(res.baseCommit).toBeNull();
    expect(only(res.files)).toMatchObject({ path: "a.txt", status: "added", additions: 1 });
  });

  it("rejects unknown refs and refs that look like options", async () => {
    const r = repo();
    r.write("a.txt", "a\n");
    commitAll(r);
    await expect(computeDiff(r.dir, "no-such-branch")).rejects.toThrow("Unknown git ref");
    await expect(computeDiff(r.dir, "--output=/tmp/x")).rejects.toThrow("Invalid git ref");
  });

  it("handles paths with spaces and non-ASCII characters", async () => {
    const r = repo();
    r.write("dir/a b 中文.txt", "x\n");
    commitAll(r);
    r.write("dir/a b 中文.txt", "y\n");

    expect(only((await computeDiff(r.dir)).files).path).toBe("dir/a b 中文.txt");
  });

  it("tracks a missing newline at end of file", async () => {
    const r = repo();
    r.write("a.txt", "a\nb");
    commitAll(r);
    r.write("a.txt", "a\nb\n");

    const b = only(only((await computeDiff(r.dir)).files).blocks);
    expect(b).toMatchObject({ del: ["b"], add: ["b"], oldNoEol: true, newNoEol: false });
  });

  it("puts the enclosing function in the hunk header", async () => {
    const r = repo();
    const src = ["int foo(void)", "{", "    int a = 1;", "    int b = 2;", "    int c = 3;", "    int d = 4;", "    return a;", "}"];
    r.write("foo.c", text(src));
    commitAll(r);
    src[5] = "    int d = 5;";
    r.write("foo.c", text(src));

    const f = only((await computeDiff(r.dir)).files);
    expect(f.blocks[0]!.section).toBe("int foo(void)");
    expect(f.hunks[0]!.header).toBe("@@ -3,6 +3,6 @@ int foo(void)");
  });

  it("can be called from a subdirectory of the repository", async () => {
    const r = repo();
    r.write("sub/a.txt", "a\n");
    commitAll(r);
    r.write("sub/a.txt", "b\n");

    const res = await computeDiff(path.join(r.dir, "sub"));
    expect(only(res.files).path).toBe("sub/a.txt");
  });
});
