# GitHub Code Review

A Claude Code plugin that shows your uncommitted changes in a GitHub-style diff viewer in the browser.

## Install

```sh
claude plugin marketplace add RulerChen/github-code-review
claude plugin install diff-review@github-code-review
```

Requires Node.js 20 or newer and git.

## Use

In a git repository, run `/diff-review:review` to compare the working tree with `HEAD`, or `/diff-review:review main` to compare with another branch, tag or commit. Open the link Claude replies with, and press Refresh on the page after further changes.

## Develop

```sh
npm install
npm run build
```

The plugin runs the built files in `plugins/diff-review/dist`, so commit them together with changes under `src/`.
