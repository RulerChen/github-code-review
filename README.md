# GitHub Code Review

A Claude Code plugin that shows your uncommitted changes in a GitHub-style diff viewer in the browser.

## Screenshots

![The Topics view: Claude's topics in the sidebar, then each topic's summary above the split diff of its files](docs/screenshot.png)

## Setup

```sh
claude plugin marketplace add RulerChen/github-code-review
claude plugin install diff-review@github-code-review
```

Requires Node.js 20 or newer and git.

```sh
claude plugin update diff-review@github-code-review
# then reload the plugin
```

```sh
claude plugin remove diff-review@github-code-review
```
