# GitHub Code Review

A Claude Code plugin that shows your uncommitted changes in a GitHub-style diff viewer in the browser.

## Install

```sh
claude plugin marketplace add RulerChen/github-code-review
claude plugin install diff-review@github-code-review
```

Requires Node.js 20 or newer and git.

## Use

In a git repository, run `/diff-review:review` to compare the working tree with `HEAD`, or `/diff-review:review main` to see what the current branch and working tree change since they branched from `main`, as a GitHub pull request shows it. `/diff-review:review main...feature` compares two branches, tags or commits without the working tree, and `main..feature` compares them directly instead of from where they diverged. Add what you want to review, as in `/diff-review:review the cache eviction change`, and Claude puts the matching changes first. Claude groups the changes into topics and explains each one. Open the link Claude replies with, and press Refresh on the page after further changes.

At the top of the page, pick other branches, tags or commits to compare, swap them, or switch between `...` and `..`. The Commits tab lists the commits in the range, and clicking one shows only its changes. Claude's topics belong to the comparison Claude opened, and the Topics tab takes you back to it.

Click a line number to leave a comment. Drag across line numbers, or shift-click a second one, to comment on a range. Write `@claude` in it and Claude answers in the thread right away, continuing a copy of your conversation that can read files but not change them. Comments without `@claude` wait in your review, marked Pending. When you have left them all, press Submit review, optionally with a comment on the whole review. Claude in the terminal is waiting for it in the background: it makes the changes, replies on each thread with what it changed, and waits for your next review. Press Refresh to see the new diff.

Press the speech bubble in the top bar, or `c`, to see every conversation in one list. Answers from Claude you have not seen are marked new until their thread is on screen, and `u` jumps to the next one. Press `?` for all keyboard shortcuts: `j` and `k` move between files or topics, `n` and `p` between conversations, `r` replies and `v` marks a file viewed.

## Update

```sh
claude plugin update diff-review@github-code-review
```

Then restart Claude Code.

## Develop

```sh
npm install
npm run build
```

The plugin runs the built files in `plugins/diff-review/dist`, so commit them together with changes under `src/`.
