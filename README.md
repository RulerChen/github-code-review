# GitHub Code Review

A Claude Code plugin that shows your code changes in a GitHub-style diff viewer in the browser.

![Asking Claude Code for a review, reading Claude's topics, asking @claude about a line, and submitting a review that Claude then acts on](docs/demo.gif)

```
/diff-review:review                          uncommitted changes
/diff-review:review main...feature           a branch, compared like a pull request
/diff-review:review topics: parser, docs     grouped into topics that Claude explains
```

## Setup

```sh
claude plugin marketplace add RulerChen/github-code-review
claude plugin install diff-review@github-code-review
```

```sh
claude plugin update diff-review@github-code-review
# reload the plugin after updating
```

```sh
claude plugin uninstall diff-review@github-code-review
```