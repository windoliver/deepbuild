# Spike for #1330: each agent's own sandbox in a started session

Run on 2026-11-07, Mac17,10, macOS 27.2, Node 24.22.0. The agents are the real CLIs at versions their facts cover:
Claude Code 2.1.308 and Codex 0.166.0-alpha.5.1, from npm. The model is a local fake (`fake-model.mjs` for Anthropic's
Messages API, `fake-openai.mjs` for OpenAI's Responses API), so no run spends anything. It scripts the tool calls:
`npm test` first, then a call that asks to run outside the sandbox and reads the key.

Each run uses a scratch HOME with a planted `~/.ssh/id_ed25519` and `~/.zshrc`, and a worktree whose `npm test` runs
`child.mjs`. That child reads the key, appends to `~/.zshrc`, writes in the worktree, and connects to 93.184.215.14:80.
A stand-in hub socket takes each hook's event name from a hook that runs `node hook.mjs <socket>`.

```sh
CLAUDE=/path/to/claude NODE=/path/to/node ./run-claude.sh
CODEX=/path/to/codex NODE=/path/to/node CONFIG='<config.toml, HOMEDIR for the scratch home>' ./run-codex.sh
```

## Questions and answers

**Does deep-hook still reach the hub's socket from inside?** Yes, for both. Hooks run in the agent's own process,
outside the sandbox that wraps its tool calls. Claude Code's Stop hook and Codex's SessionStart and Stop hooks each
reached the socket while every wall below held. Codex needs `[features] hooks = true` and each hook trusted
(`trust.mjs` writes what `/hooks` approval writes). Untrusted, its hooks never fire.

**Which walls can each hold?**

| Wall | Claude Code 2.1.308 | Codex 0.166.0-alpha.5.1 |
|---|---|---|
| Writes held to the worktree and temp folders | Yes, by default with `sandbox.enabled`. `~/.zshrc` refused, the worktree written | Yes with a profile that extends `:workspace` and gives the home `"read"`. `:workspace` alone lets all of `/tmp` be written, a home under it too |
| Credential folders unreadable | Yes: `sandbox.filesystem.denyRead: ["~/.ssh", ...]` | Yes: `[permissions.<p>.filesystem] "<home>/.ssh" = "deny"` |
| Network held to the API and named hosts | Yes: `sandbox.network.allowedDomains`. The agent's own API calls run outside | Commands: `[permissions.<p>.network] enabled = false`. Named hosts need `domains` and the network proxy feature. Its API calls run outside |
| Way out turned off | `sandbox.allowUnsandboxedCommands: false`: a call with `dangerouslyDisableSandbox: true` still ran sandboxed, and `cat ~/.ssh/id_ed25519` was refused | `approval_policy = { granular = { sandbox_approval = false, ... } }`: an escalation request is refused without a prompt. `codex exec` forces `never`, which refuses it too |
| Sandbox that can't start | `sandbox.failIfUnavailable: true` fails each call, naming why (seen when its socket folder was missing) | No setting found; the profile is enforced or the command fails |

Observed results, with each run's full settings in the scripts:

```text
claude  npm test: READ refused EPERM | WRITE refused EPERM | WRITE-WT ok | NET refused EPERM
claude  dangerouslyDisableSandbox: cat: .../home/.ssh/id_ed25519: Operation not permitted
codex   workspace-write only:        READ ok | WRITE ok (home under /tmp) | WRITE-WT ok | NET refused EPERM
codex   profile, home read, .ssh deny: READ refused EPERM | WRITE refused EPERM | WRITE-WT ok | NET refused EPERM
```

**How a refusal is seen.** Claude Code's file refusals reach the system log's sandbox stream as
`Sandbox: node(<pid>) deny(1) file-read-data <path>`, tagged `CMD64_<base64 tool_use_id>_END_<random>_SBX`. The tool
call's ID ties each one to its session, since PreToolUse carries it. A refused connection to a raw IP made no log line,
but the command's exit and output say EPERM. Claude Code lists domain refusals in the tool result as
`<sandbox_violations>`. Codex's refusals come back only as the command's output.

**What a repo's build needs.** Only `npm test` was run inside. npm's update check wrote `~/.npm/_update-notifier-last-checked`
and was refused, harmlessly. Not run, so inferred: `npm ci` needs `registry.npmjs.org` and a writable npm cache, and
cargo needs `~/.cargo` readable and its registry hosts. A started session's approval names those hosts, and its cache
folders are temp folders of its own.

## What #1330 takes from it

- A started session runs unconfined by DeepBuild's own sandbox: macOS can't nest Seatbelt, and each agent's sandbox
  only works at the top. Its walls are the agent's, set at launch from its facts. Claude Code gets `--settings` with
  `sandbox`. Codex gets a profile in the session's own `CODEX_HOME` config, or `-c` overrides that name the same keys.
- The facts name per version the setting, each wall it holds and the way-out setting. A wall not named shows as not held.
- Codex takes the same profile as `-c` overrides on its command line (`default_permissions`, `permissions.<p>.extends`,
  `.filesystem` as an inline table, `.network.enabled`), so a start leaves your `config.toml` alone. Checked the same
  way: all three refused, the worktree written, both hooks reached the socket.
- Live, a start's fresh worktree meets Claude Code's folder-trust dialog, and nothing types into a started session, so
  the first run ended as never started at 60 s. Trust on a parent folder doesn't cover it. A start now marks its own
  worktree trusted where the agent keeps folder trust (Claude Code's `projects.<path>.hasTrustDialogAccepted`, Codex's
  `projects."<path>".trust_level` as a `-c` override). With that, real Claude Code 2.1.308 started, its first event named
  the run, its sandbox refused `~/.ssh/known_hosts` (`head: ...: Operation not permitted`, recorded as `sandbox.refused`),
  and its Stop reached the gate (`docs/evidence/1330/live.json`).
