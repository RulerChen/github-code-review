---
name: review
description: Open a GitHub-style diff viewer in the browser for the current repository's uncommitted changes, or for the changes since a given git ref. Use when the user wants to look through code changes visually, for example "/review", "open the diff viewer", or "review against main".
argument-hint: "[base-ref]"
---

Open the diff viewer by calling the `open_diff_viewer` tool from the `diff-review` MCP server once.

- `repo`: the absolute path of the current working directory.
- `base`: `$ARGUMENTS` when it names a git ref (a branch, tag, commit, or `HEAD~N`). Leave it out when `$ARGUMENTS` is empty; the tool then compares against `HEAD`.

Reply with the URL from the tool result on its own line, followed by its one-line summary. Do not paste the diff into the conversation.
