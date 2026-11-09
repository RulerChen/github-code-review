---
name: review
description: Open a GitHub-style diff viewer in the browser for uncommitted changes, the changes since a git ref, or the changes between two branches, tags or commits, grouped into topics with an explanation of each. Works on one repository, or on a directory whose subdirectories are repositories, all in one page. Use when the user wants to review code changes, for example "/review", "review the cache changes", "review against main", "review main...feature" or "review ~/work".
argument-hint: "[directory] [base-ref | base...head | base..head] [focus]"
---

Arguments: $ARGUMENTS

1. The arguments can start with the directory to review, then what to compare. The rest is the focus: what the user wants to review. All are optional.
   - A first argument that names an existing directory, absolute or relative to the current working directory, is the directory to review. Without one, review the current working directory.
   - A git ref (a branch, tag, commit or `HEAD~N`) is the `base`, compared with the working tree. Without one the base is `HEAD`.
   - `base...head` compares two refs the way a GitHub pull request does: the changes on `head` since it branched from `base`. Set `base` and `head`.
   - `base..head` compares the two refs directly. Set `base`, `head` and `threeDot: false`.
2. Call `list_changes` from the `diff-review` MCP server with `repo` set to the directory as an absolute path, plus `base`, `head` and `threeDot` from step 1. It covers the repository the directory is in. A directory with no `.git` of its own but repositories directly under it, such as a workspace of clones, stands for all of them in one diff: each file's path starts with its repository's directory, and each commit names its repository. It prints the commits in the range and every change with its id, and names the repositories where the comparison failed, for example because they lack the ref. If there are no changes, call `open_diff_viewer` without topics, reply with the URL and stop.
3. Group the changes into topics. A topic is one feature, fix or purpose, and can span files and repositories. Use what you know about why the changes were made. For each topic give:
   - `title`: a few words.
   - `summary`: two to six sentences of Markdown on what changed and why, naming the files and functions involved and anything the reviewer should check closely. Use the commit messages for the why. When a topic spans repositories, say how their changes fit together.
   - `ids`: the ids of all changes in the topic.
   Put every id in a topic. Order the topics the way a reviewer should read them, with the ones that match the focus first, and set `related: false` on topics that have nothing to do with the focus. Write titles and summaries in the language the user writes in.
4. Call `open_diff_viewer` with the same `repo`, `base`, `head` and `threeDot`, plus `focus`, `topics` and `session` set to `${CLAUDE_SESSION_ID}`. If it reports unknown ids, fix them and call it again. It prints the page's URL and a `curl` command that waits for the user's review.
5. Run that command with the Bash tool in the background (`run_in_background`), so you are notified when the user submits a review.
6. Reply with the URL, then the topic titles as a short list. If `open_diff_viewer` says the page already open in their browser switched to the comparison, tell them to look there. If the comparison failed in some repositories, say which and why. Tell them they can click line numbers in the page to comment on lines, or the comment button in a file's or topic's header to comment on the whole file or topic. A comment that mentions `@claude` gets an answer in the page right away. Other comments wait in their review until they press Submit review, and then you make the changes they ask for. The Topics tab lists every review opened in this session, and can group any other comparison they pick into topics. Do not paste the diff.
7. When the wait command finishes:
   - If it failed, the viewer has closed. Say so and stop waiting.
   - Call `get_review_comments` with `repo` and `after` set to what the command printed. Address every comment: change the code where the user asks for a change, and answer questions or unclear requests instead of guessing. A comment's path is relative to the directory the wait command names: the repository's root, or the directory holding the repositories, where the path starts with the repository's directory. Its line numbers and quoted lines are from when it was written, so find the code by the quoted lines if it has moved. A comment on the whole file has neither and is about the file as a whole. A comment on a topic is about that topic as a whole.
   - Call `reply_to_review` once with a short reply on each thread, saying what you changed or answering it, in the language of the comment.
   - Tell the user in the terminal what you changed, and that Refresh in the page shows the new diff.
   - Run the wait command that `get_review_comments` printed in the background again.
