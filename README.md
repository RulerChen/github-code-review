# GitHub Code Review

A Claude Code plugin marketplace with one plugin, `diff-review`. It opens the changes in your working tree in a browser page laid out like GitHub's "Files changed" tab, so you can read what Claude changed with a file tree, syntax highlighting, unified or split view, and per-file "Viewed" checkboxes.

## Install

```sh
claude plugin marketplace add RulerChen/github-code-review
claude plugin install diff-review@github-code-review
```

To try it from a local checkout without installing, start Claude Code with `claude --plugin-dir /path/to/github-code-review/plugins/diff-review`.

The plugin needs Node.js 20 or newer and `git` on `PATH`. The server bundle and the UI are committed under `plugins/diff-review/dist`, so there is no install step.

## Use

In a git repository, run `/diff-review:review` to compare the working tree against `HEAD`, or `/diff-review:review main` to compare against another ref. Claude replies with a `http://127.0.0.1:<port>/v/<id>#token=<token>` link. Open it in your browser. Press Refresh on the page after Claude makes more changes.

The comparison includes staged, unstaged and untracked files (ignored files are left out). The viewer only reads the repository. It never writes to it or takes git's index lock.

## How it works

The plugin ships an MCP server (`plugins/diff-review/dist/server.mjs`) that Claude Code starts with the session. Its one tool, `open_diff_viewer`, starts a small HTTP server on `127.0.0.1` with a random port the first time it is called, and returns a link to a view of the requested repository and base. The server stops when the Claude Code session ends, so links from an earlier session stop working.

The page fetches the diff from the server on load and on Refresh. The diff comes from `git diff -U0` plus `git ls-files --others`, and each change block gets an ID from a hash of its path and content, so a block keeps its ID when unrelated lines move. Context lines are read from the files themselves.

The link carries a random token in its `#fragment`, which never leaves the browser except as the `X-Review-Token` header that the page sends to the API. The server answers only `GET` requests with a matching `Host` header (against DNS rebinding) and sends a strict Content-Security-Policy. Any local process that can read the link can read the diff.

## Develop

```sh
npm install
npm run typecheck   # server and UI
npm run build       # UI (Vite) and server (esbuild) into plugins/diff-review/dist
npm run dev:server  # serve the current repository's diff and print the link, without MCP
```

Rebuild and commit `plugins/diff-review/dist` together with any change under `src/`, since the installed plugin runs the committed bundle. Check the manifests with `claude plugin validate .` and `claude plugin validate plugins/diff-review`.

| Path | Contents |
| --- | --- |
| `src/engine` | git diff parsing, block IDs, display hunks |
| `src/server` | MCP server and the local HTTP server |
| `src/ui` | React page (Vite, Shiki for highlighting) |
| `src/shared` | types shared by the server and the page |
| `plugins/diff-review` | the plugin: manifest, MCP config, `review` skill, built `dist` |

## Roadmap

Phase 2 groups the diff by topic for a focus you give (`/diff-review:review the cache eviction change`) and has Claude explain each group. Phase 3 adds GitHub-style comment threads on lines, where `@claude` asks a read-only Claude session about the selected lines.
