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

## Remote development over SSH

When Claude Code runs in an SSH session, the viewer listens on every network interface and its URL uses the address you connected to, so the page opens from any machine that can reach that address. The URL carries an access token, which the page keeps in a cookie. Anyone with the URL can read the diff and ask @claude questions that read files on that machine, so share it only with people you would give that access. The viewer uses port 7800, or the next free one up to 7809 when other sessions on the machine have a viewer open, so a firewall there needs to let TCP ports 7800 to 7809 through.

When the browser cannot reach the remote machine, for example behind a jump host, forward the ports in `~/.ssh/config` on your own machine and open the URL with its host changed to 127.0.0.1:

```
Host devbox
  LocalForward 7800 127.0.0.1:7800
  LocalForward 7801 127.0.0.1:7801
  LocalForward 7802 127.0.0.1:7802
  LocalForward 7803 127.0.0.1:7803
  LocalForward 7804 127.0.0.1:7804
  LocalForward 7805 127.0.0.1:7805
  LocalForward 7806 127.0.0.1:7806
  LocalForward 7807 127.0.0.1:7807
  LocalForward 7808 127.0.0.1:7808
  LocalForward 7809 127.0.0.1:7809
  ControlMaster auto
  ControlPath ~/.ssh/cm-%C
  ControlPersist 10m
```

The `Control` lines make further connections to the host share the first one and its forwards. Without them, each further connection prints a warning for every port the first one already forwards. A session that finds all ten ports taken uses a random port.

## Saved reviews

The comments, submitted reviews and topics of a review are saved in the plugin's data directory, `~/.claude/plugins/data/` followed by the plugin's name, under `reviews`. When a session is resumed and opens the viewer on the same repository again, they come back, and comments on lines of the working tree follow those lines if the files changed in between. Each session keeps its own, and a file not written to for 30 days is deleted. The files hold the lines you commented on, and only your user can read them.
