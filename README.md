# GitHub Code Review

A Claude Code plugin that shows your code changes in a GitHub-style diff viewer in the browser.

![Demo](docs/demo.gif)

```
/diff-review:review             uncommitted changes in the current repository
/diff-review:review ~/work      every repository in a folder, on one page
```

In the page you pick other branches, tags or commits to compare, and have Claude group the changes into topics that it explains. A topic can also show the flow its changes sit on, through unchanged code and other repositories. A graph shows the parts of the system the flow passes through, such as a web client, a gateway and a service, each listing its steps in order, and arrows from step to step say how the parts talk, such as an HTTP request, its response or a Kafka message. Branches such as error handling are drawn in their own color with their condition. Below it each step says what it does, where it runs and what data goes in and out, with each branch under the step it leaves from. Clicking a step or an arrow opens its line beside the diff.

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