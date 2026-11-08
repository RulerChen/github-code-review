---
name: review
description: Open a GitHub-style diff viewer in the browser for the repository's uncommitted changes, or the changes since a git ref, grouped into topics with an explanation of each. Use when the user wants to review code changes, for example "/review", "review the cache changes", or "review against main".
argument-hint: "[base-ref] [focus]"
---

Arguments: $ARGUMENTS

1. If the arguments start with a git ref (a branch, tag, commit or `HEAD~N`), that is the base. The rest is the focus: what the user wants to review. Both are optional, and the base defaults to `HEAD`.
2. Call `list_changes` from the `diff-review` MCP server with `repo` set to the absolute path of the current working directory, and `base` when there is one. It prints every change with its id. If there are no changes, call `open_diff_viewer` without topics and stop after step 5.
3. Group the changes into topics. A topic is one feature, fix or purpose, and can span files. Use what you know about why the changes were made. For each topic give:
   - `title`: a few words.
   - `summary`: two to six sentences of Markdown on what changed and why, naming the files and functions involved and anything the reviewer should check closely.
   - `ids`: the ids of all changes in the topic.
   Put every id in a topic. Order the topics the way a reviewer should read them, with the ones that match the focus first, and set `related: false` on topics that have nothing to do with the focus. Write titles and summaries in the language the user writes in.
4. Call `open_diff_viewer` once with `repo`, `base`, `focus` and `topics`. If it reports unknown ids, fix them and call it again.
5. Reply with the URL on its own line, then the topic titles as a short list. Do not paste the diff.
