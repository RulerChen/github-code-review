# GitHub Code Review

A Claude Code plugin that shows your code changes in a GitHub-style diff viewer in the browser.

![Reviewing a folder of two repositories: Claude's topics, the refs of each repository, a question to @claude about a line, and a review that Claude applies to both repositories](docs/demo.gif)

```
/diff-review:review                          uncommitted changes
/diff-review:review main...feature           a branch, compared like a pull request
/diff-review:review topics: parser, docs     grouped into topics that Claude explains
/diff-review:review ~/work                   every repository in a folder, on one page
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