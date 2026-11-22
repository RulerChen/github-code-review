# GitHub Code Review

A Claude Code plugin that shows your code changes in a GitHub-style diff viewer in the browser.

![Demo](docs/demo.gif)

```
/diff-review:review             uncommitted changes in the current repository
/diff-review:review ~/work      every repository in a folder, on one page
```

In the page you pick other branches, tags or commits to compare, and have Claude group the changes into topics that it explains. A topic can also show the flow its changes sit on: what happens at each step, through unchanged code and other repositories, and how each step hands off to the next, such as a function call, an HTTP request or a Kafka message. Each step opens its line beside the diff.

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