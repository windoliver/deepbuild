# Acceptance tests for #1330: a session that writes starts without your Send only under a run you approved

Written first, blind, by a job that never saw an implementation of #1330; none existed. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

The issue has nine checkbox criteria, AC1 to AC9 in the body's order. Each test's name carries its criterion's ID
(`#1330.` and the first 8 hex digits of SHA-256 of the criterion's text, as `scripts/proof-change.mjs` reads it).

## What was read

- Issue #1330 as of 2026-11-07: Scope, the nine criteria, Proof, Depends on (#159, #104).
- `docs/technical-design.md`: Threats, and what stops each one (the "Sessions DeepBuild starts" row), Starting a session
  from the app (and A worktree for each session you start, Who does the work), the Extension API block
  (`deep.startSession(task)`), the extension-block table's Session row, Dogfooding. `AGENTS.md` (Proof).
- At the base `ec8f2c9a44f6a5ec4fccf5edb7a17e7f723de497` (main, 2026-11-07), for surfaces and conventions only:
  `packages/hub/src/plant.ts` (how a hub refuses a plant it doesn't list), `server.ts`, `core.ts` (the trusted path,
  `agentAbove`, `sessions.read`), `confirm.ts` (`DEEP_HUB_TEST_CONFIRM`), `hookmap.ts` (`DEEP_HUB_TEST_FACTS`),
  `claude-settings.ts` (the hooks setup writes), `mcp.ts`, `inbox.ts`; `packages/runner/src/runner.ts` (the login PATH
  from `config.json`'s `runner.login_path`, `--version`); `packages/asks` (authority asks and their options);
  `adapters/claude-code.facts.json`, `codex.facts.json`; `crates/deep-hook/src/main.rs` (its socket); the suites
  `tests/acceptance/342`, `332`, `104`, `159`, `965`, `27`, `1312` for their form. `../342/fixtures/agent.mjs` is
  imported by path, not copied.

## What the base does

There is no `deep start` command (`Unsupported command`), no approval, no started session, no sandbox facts and none
of the plants below. Every test fails or reads BLOCKED; `BASE-FAILURE.txt` has the run.

## Run them

macOS only (the stand-in agent's sandbox is Seatbelt), with the repo's Node (`.node-version`, 24.22.0):

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:/opt/homebrew/opt/rustup/bin:/opt/homebrew/bin:$PATH"
npm ci                                      # once
npm run build --workspaces                  # every test runs packages/cli/dist/main.js
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook   # the sessions' hooks
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1330 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1330/tsconfig.json
```

Each test makes its own test home under `/Users/Shared/dh1330-*`, not under `/tmp`: the sandbox under test lets
writes reach the temp folders, and AC6's `~/.zshrc` must be a file it holds. A missing CLI build, deep-hook or
`/usr/bin/sandbox-exec`, or a hub that won't start with a plant it doesn't list, reads BLOCKED, never a pass.
AC5 waits out the 60 s; AC3 waits out a 45 s approval. No model is called and nothing leaves 127.0.0.1.

### The live run (the issue's Proof)

`start.live.test.ts` is skipped unless `DEEP_1330_LIVE=1`. It runs on your own home and installed hub: one approval
for issue 1330 on this repo for Claude Code and Codex (`deep start approve`, then `deep inbox answer`, which asks you
to confirm), then a real Claude Code and a real Codex session started under it with a one-word prompt, each checked
for an event naming its run and a row that says what its sandbox holds. It spends plan usage, makes two worktrees and
leaves both sessions for you to look at and remove. Never in hosted CI.

## The stand-in agent

Every criterion needs an agent to start, act or stay quiet, and a real one costs a model call; the agent is the
boundary this repo doesn't own. `fixtures/claude.mjs` stands in for Claude Code: it is installed as `claude` in the
test home's `bin`, which is first on the login PATH (`config.json`'s `runner.login_path`, `~/.zprofile` and the hub's
own PATH), and it reports the newest Claude Code version the shipped facts list. It reads argv, settings and the
permission mode as Claude Code does, runs the hooks in the merged settings (the test home's `~/.claude/settings.json`
holds deep-hook's hooks as `deep setup` writes them), and enforces Claude Code's sandbox settings with Seatbelt; its
header lists exactly which keys. Two choices are the stand-in's, named so a dispute can name them:

- Its hooks run inside its sandbox, as its Bash commands do: the issue's spike asks that deep-hook "still reaches the
  hub's socket from inside", and AC8's wrong program is a sandbox that cuts that socket.
- Asked for `dangerouslyDisableSandbox`, it runs the call outside the sandbox whenever the settings leave the way out
  open (`sandbox.allowUnsandboxedCommands` not `false`), standing for the permission being granted.

The prompt picks what its turn does: `[standin:silent]` (no hook, no event, ever), `[standin:npm-test]`,
`[standin:npm-test-unsandboxed]`; any other prompt is a turn with no tool call. It ends every turn with Stop and logs
what it saw to `~/.standin/<pid>.json`, which the tests read. Only Claude Code is played; Codex is in the live run.

The test repo has an origin, and its `npm test` is `node probe.mjs` (`fixtures/probe.mjs`), which reads the planted
`~/.ssh/id_ed25519` (random text), appends to `~/.zshrc`, and connects to a TCP listener on 127.0.0.1 that no
approval names, writing what happened to `probe-<label>.json` in its worktree.

## The surface under test

The issue names `deep.startSession` as the extension point, the authority ask, the record and the facts, but no
command, field or event. This suite defines the smallest surface that reaches every criterion:

- **`deep start approve`** `--repo <path> --issues <n>[,<n>…] --agents <agent>[,<agent>…] [--home <agent>=<folder>]…
  [--mode <agent>=<mode>]… --at-once <n> --plan-share <percent> [--until <ISO 8601>] [--host <host>]… --json`:
  raises one authority ask bound to those, exits 0 and prints `{ "ask": "ask:<id>" }`. The ask's `ask.created` event
  is the one whose JSON names that ID. Nothing is approved until you answer it.
- **The approval** is that ask answered yes on the trusted path: `deep inbox answer <ask> <option>` with the option
  whose `decision` is `allow`, the OS confirming you (the hub's existing `DEEP_HUB_TEST_CONFIRM` stand-in for it).
- **`deep start`** `--repo <path> --issue <n> --agent <agent> [--mode <mode>] --prompt <words> --json`, as you run it
  in your terminal. Started: exit 0, `{ "status": "started", "run": <id>, "worktree": <path>, "branch": <name> }`.
  Refused: non-zero exit, `{ "status": "refused", "reason": <words>, "bound": <bound> }`, where `bound` is `set`,
  `agent`, `mode`, `end` or `at_once` when the start falls outside that bound of the approval (AC3, AC5).
- **`deep_start`**, a tool `deep mcp` answers (AC2): its arguments are `{ repo, issue, agent, prompt }`; called, it
  is refused with an error whose words name the caller as an MCP call (`/\bMCP\b/i`).
- **The record**: the session's first event (the earliest event whose JSON names the agent's session ID) names the
  run (its JSON holds the run's ID). `session.never_started`, naming the run (AC5). `sandbox.refused`, one per
  refusal, naming the run or the session and the path or host refused (AC6). `agent.stop` (existing) for the Stop.
- **The session's row** (`sessions.read`, the row whose JSON names the session or the run) has `sandbox`:
  `{ "sandboxed": <bool>, "walls": { "writes": <bool>, "credentials": <bool>, "network": <bool> } }` (AC9).
- **Facts**: an agent's facts carry its sandbox under a top-level `sandbox` key; each object under it that says what
  a version's sandbox holds has a `walls` object whose keys name the walls held: `writes`, `credentials`, `network`.
  AC6 to AC8 run on the shipped Claude Code facts, which must name all three; AC9 reads facts through the hub's
  existing `DEEP_HUB_TEST_FACTS`: the shipped file with `sandbox` removed, and with every `walls` cut to `writes`.
- **The setting** the hub launches Claude Code with is the implementation's to choose (its facts name it); the stand-in
  honours Claude Code's own keys, listed in its header.

### Plants (`DEEP_HUB_PLANT`)

| Plant | The wrong program | Read by |
|---|---|---|
| `starts-without-approval` | a hub that starts a session with no approval on the record | AC1: must fail, naming `#1330` and the issue |
| `starts-without-sandbox` | a start with no sandbox | AC6: must fail, naming `.ssh/id_ed25519` |
| `sandbox-way-out-open` | a setting that leaves the agent's way out of its sandbox open | AC7: must fail on the read |
| `sandbox-cuts-hub-socket` | a sandbox that cuts the hub's socket | AC8: must fail |

A hub that doesn't list a plant refuses to start; that reads BLOCKED. The sandbox plants read BLOCKED too while the
shipped facts don't name all three walls, since nothing could then tell a plant from the clean hub.

## How each criterion is read

- **AC1** (`start.test.ts`): with no approval, `deep start` for issue 41 is refused, and three seconds later no agent
  ran and no worktree was added. Then an approval for {41}, Claude Code, one at once; the start succeeds; its worktree
  is in `git worktree list`, is not the checkout, sits at `origin/main`'s commit, on a branch whose name holds 41; the
  agent ran there; the session's first event names the run. The plant runs the no-approval half.
- **AC2** (`callers.test.ts`): an approval that would cover the start is on the record. A Claude Code session in your
  terminal (#342's agent process, deep-hook as its child) runs `deep start` through its Bash tool, the command run
  whatever its PreToolUse said, so the hub must refuse on its own: refused, the reason naming the session's ID. Then
  it calls `deep_start` through `deep mcp`, as its child: refused, naming an MCP call. Neither starts an agent or
  adds a worktree.
- **AC3** (`bounds.test.ts`): an approval for {41}, Claude Code, mode `default`, ending in 45 s. Issue 42 is refused
  with `bound: set` naming 42; Codex with `agent` naming codex; `acceptEdits` with `mode` naming it; after the end,
  issue 41 with `end`. None starts anything.
- **AC4** (`start.test.ts`): your own Claude Code settings name `bypassPermissions` as the default mode. The ask
  `deep start approve --mode claude-code=bypassPermissions` raises shows `bypassPermissions`. Under an approval that
  names no mode, a start that names none runs the agent in `default`, read from what the agent was launched with.
- **AC5** (`never-started.test.ts`): one at once; an agent started with `[standin:silent]`; a second start meanwhile
  is refused with `bound: at_once`. `session.never_started` names the run between 55 s and 110 s after the agent's
  process started, the process ends, and a third start then succeeds and runs.
- **AC6** (`sandbox.test.ts`): on the shipped facts (all three walls), an approval naming one host,
  `api.allowed.test`; the turn runs `npm test`. Its child's read of the key, its write of `~/.zshrc` and its connection
  to 127.0.0.1 are each refused (the probe's report, the rc file unchanged, no connection reaching the listener during
  the call), and `sandbox.refused` events name `.ssh/id_ed25519`, `.zshrc` and `127.0.0.1` for the run.
- **AC7**: in that session, `PROBE_LABEL=out npm test` asked to run outside the sandbox ran, and its read of the key
  was refused.
- **AC8**: in that session, the Stop hook, run inside the sandbox, reached the hub: `agent.stop` naming the session
  is recorded within 20 s, and deep-hook answered it with exit 0 or 2, as the gate answers a Stop. The gate's hold
  itself is read no further here: the session has no claim to hold.
- **AC9** (`facts.test.ts`): on facts with no `sandbox`, a start succeeds and its row has `sandboxed: false` and no
  wall held; on facts whose walls are cut to `writes`, the row shows writes held and the other two not held.

## Known limits

- The stand-in plays Claude Code's sandbox settings as its header lists them; an implementation whose setting uses a
  key it doesn't play fails here though real Claude Code would hold. The live run is the check on the real agent.
- Codex is played only in the live run.
- The test home is under `/Users/Shared`, which every macOS has; elsewhere the suite reads BLOCKED.
