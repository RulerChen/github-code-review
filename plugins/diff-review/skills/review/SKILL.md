---
name: review
description: Open a GitHub-style diff viewer in the browser for uncommitted changes, the changes since a git ref, or the changes between two branches, tags or commits, grouped into topics with an explanation of each. Works on one repository or on a directory that holds many, with one page for each repository that has changes. Use when the user wants to review code changes, for example "/review", "review the cache changes", "review against main", "review main...feature" or "review libfoo app".
argument-hint: "[directory ...] [base-ref | base...head | base..head] [focus]"
---

Arguments: $ARGUMENTS

1. The arguments can start with the directories to review, then what to compare. The rest is the focus: what the user wants to review. All are optional.
   - Arguments at the start that name existing directories, absolute or relative to the current working directory, are the directories to review. Without any, review the current working directory.
   - A git ref (a branch, tag, commit or `HEAD~N`) is the `base`, compared with the working tree. Without one the base is `HEAD`.
   - `base...head` compares two refs the way a GitHub pull request does: the changes on `head` since it branched from `base`. Set `base` and `head`.
   - `base..head` compares the two refs directly. Set `base`, `head` and `threeDot: false`.
2. Find the git repositories by running this with the Bash tool, with `DIR...` replaced by the directories from step 1 as quoted absolute paths:
   ```sh
   for d in DIR...; do d=$(cd "$d" && pwd -P) || continue; git -C "$d" rev-parse --show-toplevel 2>/dev/null; find "$d" -name .git -prune -print 2>/dev/null | sed 's|/\.git$||'; done | sort -u
   ```
   Each line is a repository: the one a directory is in, and every repository below it, such as a submodule or a repository cloned inside another. If it prints nothing, tell the user that no git repository was found there and stop.
3. Call `list_changes` from the `diff-review` MCP server for every repository, all in parallel, with `repo` set to the repository's path, plus `base`, `head` and `threeDot` from step 1. It prints the commits in the range and every change with its id. Skip the repositories with no changes. When a call fails, for example because the repository lacks the ref, skip that repository and tell the user which ones failed and why. If only one repository was found and it has no changes, call `open_diff_viewer` for it without topics, reply with the URL and stop. If several were found and none has changes, say so and stop.
4. Group each repository's changes into topics. A topic is one feature, fix or purpose, and can span files of one repository. Use what you know about why the changes were made. For each topic give:
   - `title`: a few words.
   - `summary`: two to six sentences of Markdown on what changed and why, naming the files and functions involved and anything the reviewer should check closely. Use the commit messages for the why. When the changes go with changes in another repository, say so and name that repository.
   - `ids`: the ids of all changes in the topic.
   Put every id of the repository in one of its topics. Order the topics the way a reviewer should read them, with the ones that match the focus first, and set `related: false` on topics that have nothing to do with the focus. Write titles and summaries in the language the user writes in.
5. Call `open_diff_viewer` once for each repository with changes, with `repo`, `base`, `head`, `threeDot`, `focus`, that repository's `topics` and `session` set to `${CLAUDE_SESSION_ID}`. If it reports unknown ids, fix them and call it again. Each call prints the page's URL and a `curl` command that waits for the user's review in that page.
6. Run each of those commands with the Bash tool in the background (`run_in_background`), so you are notified when the user submits a review in any page.
7. Reply with each URL on its own line, then that page's topic titles as a short list. When there are several pages, put the repository's path relative to the current working directory before its URL. If `open_diff_viewer` says the page already open in their browser switched to the comparison, tell them to look there. Tell them they can click line numbers in the page to comment on lines, or the comment button in a file's or topic's header to comment on the whole file or topic. A comment that mentions `@claude` gets an answer in the page right away. Other comments wait in their review until they press Submit review, and then you make the changes they ask for. The Topics tab lists every review opened in this session, and can group any other comparison they pick into topics. With several repositories, tell them its Reviews menu switches between them. Do not paste the diff.
8. When a wait command finishes:
   - If it failed, that viewer has closed. Say so and stop waiting for that page.
   - Call `get_review_comments` with `repo` and `after` set to what the command printed. Address every comment: change the code where the user asks for a change, and answer questions or unclear requests instead of guessing. A comment's line numbers and quoted lines are from when it was written, so find the code by the quoted lines if it has moved. A comment on the whole file has neither and is about the file as a whole. A comment on a topic is about that topic as a whole.
   - Call `reply_to_review` once with a short reply on each thread, saying what you changed or answering it, in the language of the comment.
   - Tell the user in the terminal what you changed, and that Refresh in the page shows the new diff.
   - Run the wait command that `get_review_comments` printed in the background again.
