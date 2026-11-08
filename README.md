# GitHub Code Review

A Claude Code plugin that shows your uncommitted changes in a GitHub-style diff viewer in the browser.

## Install

```sh
claude plugin marketplace add RulerChen/github-code-review
claude plugin install diff-review@github-code-review
```

Requires Node.js 20 or newer and git.

## Use

In a git repository, run `/diff-review:review` to compare the working tree with `HEAD`, or `/diff-review:review main` to compare with another branch, tag or commit. Add what you want to review, as in `/diff-review:review the cache eviction change`, and Claude puts the matching changes first. Claude groups the changes into topics and explains each one. Open the link Claude replies with, and press Refresh on the page after further changes.

Click a line number, or shift-click a second one to select a range, to leave a comment. Write `@claude` in it and Claude answers in the thread, continuing a copy of your conversation that can read files but not change them. Ask Claude in the terminal to address your review comments and it reads them from the page.

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
