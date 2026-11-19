# Acceptance tests for #1666: a started session commits in its own worktree, and the checkout and other worktrees stay closed to it

Written first, blind, by a job that never saw an implementation of #1666; none existed. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

The issue has two checkbox criteria, AC1 and AC2 in the body's order. Each test's name carries its criterion's ID
(`#1666.` and the first 8 hex digits of SHA-256 of the criterion's text, as `scripts/proof-change.mjs` reads it):
AC1 is `#1666.a6894a2d`, AC2 is `#1666.2a45598e`.

## What was read

- Issue #1666 as of 2026-11-18: Scope, the two criteria, Proof, Depends on (#1330).
- `docs/technical-design.md`: Threats, and what stops each one (the "Sessions DeepBuild starts" row), Starting a session
  from the app (and A worktree for each session you start), Dogfooding. `AGENTS.md` (Proof).
- At the base `b7b24aae8` (main, 2026-11-18), for surfaces and conventions only: `packages/hub/src/starts.ts` (the
  start, its worktree, `sandboxOf` and `argvOf`), `start-command.ts`, `plant.ts` (how a hub refuses a plant it doesn't
  list); `adapters/claude-code.facts.json` and `codex.facts.json` (`sandbox`, `launch.started`);
  `tests/acceptance/1330` (its README, helpers and fixtures, for the form; what this suite needs of them is copied into
  `helpers.ts`, not imported); `spikes/1330` (how the real Claude Code and Codex were run against a fake model, and how
  Codex's hooks are trusted).

## What the base does

`deep start` (#1330) starts each agent in a new worktree under `~/.deepbuild/worktrees/<repo>/<id>`, whose git folder is
`<repo>/.git/worktrees/<id>`, inside the agent's own sandbox as its facts set it. The facts say nothing of git folders.
Run on the real binaries, as the issue says: Codex 0.166.0-alpha.5.1's profile opens only the worktree folder, so its
commit fails at `<repo>/.git/worktrees/<id>/index.lock` (AC1 fails) and every write outside the worktree is refused (AC2
holds); Claude Code 2.1.308 commits (AC1 holds) because its sandbox opens the repo's whole `.git` but `config` and
`hooks`, so the checkout's `.git/index` and `.git/HEAD` and the other worktree's git folder are written (AC2 fails,
naming each). The base hub lists neither plant below, so the four plant tests read BLOCKED. `BASE-FAILURE.txt` has the
run.

## Run them

macOS only (both agents' sandboxes are Seatbelt), by hand and never in hosted CI, with the repo's Node
(`.node-version`, 24.22.0) and the real agents at the versions their facts list a sandbox for, Claude Code 2.1.308 and
Codex 0.166.0-alpha.5.1, in one folder named by `DEEP_1666_AGENT_BIN` (an npm folder's `.bin`, for example
`$HOME/.cache/deepbuild-agents/148/node_modules/.bin`, after `npm install @anthropic-ai/claude-code@2.1.308
@openai/codex@0.166.0-alpha.5.1` there):

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:/opt/homebrew/opt/rustup/bin:/opt/homebrew/bin:$PATH"
npm ci                                      # once
npm run build --workspaces                  # every test runs packages/cli/dist/main.js
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook   # the sessions' hooks
DEEP_1666_AGENT_BIN=$HOME/.cache/deepbuild-agents/148/node_modules/.bin \
  NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1666 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1666/tsconfig.json
```

Each test makes its own test home under `/Users/Shared/dh1666-*`, not under `/tmp`: both sandboxes let commands write
the temp folders, so a repo there would read as writable whatever the start set. git is the first `git` on the PATH you
run the suite with (Homebrew's 2.56.0 here), first on the test home's login PATH too. A missing CLI build or deep-hook,
`DEEP_1666_AGENT_BIN` unset, a binary missing from it or one whose `--version` isn't a version the shipped facts list a
sandbox for, or a hub that won't start with a plant it doesn't list, reads BLOCKED, never a pass. No model is called, no
key or sign-in is used, and nothing leaves 127.0.0.1. Six sessions run, about a minute each on a quiet Mac.

## The surface under test

All of it exists at the base (#1330); this suite adds only the two plants.

- **The approval**: `deep start approve --repo <checkout> --issues 1666 --agents <agent> --at-once 1 --plan-share 50
  --json` prints `{ "ask": "ask:<id>" }`; `deep inbox answer <ask> allow` answers it yes on the trusted path, the OS
  confirming you (the hub's `DEEP_HUB_TEST_CONFIRM` stand-in).
- **The start**: `deep start --repo <checkout> --issue 1666 --agent <agent> --prompt <words> --json`, run as you run it
  in your terminal, prints `{ "status": "started", "run", "worktree", "branch", "version", "sandbox", … }`. The test
  reads `worktree`, `branch` and `version` (which must be the version under test).
- **The launch**: the hub runs the binary named `claude` or `codex` first on the login PATH (`config.json`'s
  `runner.login_path`) with the arguments its facts' `launch.started` names: Claude Code's `--permission-mode` and
  `--settings` JSON, Codex's `-c` overrides with the sandbox's spliced at `{sandbox}`, and the prompt. What the sandbox
  opens is the implementation's to set there, per version, in the facts; this suite reads only what the session's
  command could and couldn't do.
- **The record**: `git -C <checkout> log <branch>` for the commit, and the files themselves for each write.

### The agent

The Proof asks for the real agent in its non-interactive mode with the settings and overrides a start launches it
with. `fixtures/agent.mjs` is installed as `claude` (or `codex`) in the test home's `bin`, first on the login PATH, and
the hub finds it as it finds the agent. The hub's start is the call whose arguments carry the start's words as the
prompt; the wrapper runs it through the real binary's non-interactive mode with the launch's arguments unchanged.
Every other call goes to the real binary unchanged, its input and output the caller's: `--version` (so the version the
hub checks is the real binary's), and what the hub and its hooks call by the same PATH during a start (seen:
`claude plugin list --json`, `codex app-server`). The start runs as:

- Claude Code: `claude -p --output-format stream-json --verbose <launch args>`, with `ANTHROPIC_BASE_URL` at the stand-in,
  a placeholder `ANTHROPIC_API_KEY` and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`.
- Codex: `codex exec --json -c model_provider="dh1666" -c model_providers.dh1666={…base_url at the stand-in…} -m
  gpt-dh1666 <launch args>`, with a placeholder key in the variable that provider names.

It logs each call's arguments, whether it was the start, what it ran and how the real binary ended to
`~/.dh1666/<binary>-<pid>.json`, which the tests read, and passes a signal the hub sends on to the real agent. The
agent's own hooks in the test home run deep-hook on SessionStart (Claude Code's user settings; Codex's `hooks.json`,
with `[features] hooks = true` and the hook trusted as `/hooks` approval writes it, through `codex app-server`), so the
session's first event reaches the hub and it isn't ended as never started.

Nothing leaves 127.0.0.1: every child (the hub, `deep`, and so each agent and what it starts) has `HTTPS_PROXY`,
`HTTP_PROXY` and `ALL_PROXY` (both cases) at `http://127.0.0.1:9`, which answers nothing, and `NO_PROXY` for loopback,
so git, Codex and Claude Code fail at once on any other host. The test home's Codex config also has `plugins = false`:
on, `codex exec` and `codex app-server` each start a `git fetch` of OpenAI's curated plugins from github.com.

### The model

A stand-in for each agent's API on 127.0.0.1, in the test process: Anthropic's Messages API for Claude Code, OpenAI's
Responses API for Codex. Its first turn with tools asks for one tool call, the command below; after a tool result it
says `done`. The call is one plain command because Claude Code, in `-p` with `--permission-mode default` and the shipped
`autoAllowBashIfSandboxed`, auto-allows a single command in its sandbox but refuses a compound one ("contains multiple
operations") without running it, which would read a right program as failing.

### The command

The test repo, committed and pushed to a bare origin before the start, holds a tracked `README.md`, `probe.mjs`
(`fixtures/probe.mjs`) and `probe-config.json`, which names the paths below. A second worktree, `src/shop-other` on its
own branch, is added with `git worktree add` before the start, so its git folder is `<checkout>/.git/worktrees/shop-other`.
The session runs `node probe.mjs` in its worktree, which:

1. writes `committed-by-the-session.txt` and runs `git add` and `git commit -m "dh1666: a commit in the session
   worktree"` (identity given with `-c`), keeping each one's exit and stderr;
2. tries, with Node's `fs`, to append a line to the checkout's tracked `README.md`, append to the checkout's
   `.git/index`, rewrite the checkout's `.git/HEAD` (to a valid ref, so git still reads the repo), make a new file in
   the other worktree's git folder and rewrite its `HEAD`, keeping each one's outcome and error code;
3. writes all of it to `probe-report.json` in the worktree, after the commit, so it's never part of it.

### Plants (`DEEP_HUB_PLANT`)

| Plant | The wrong program | Read by |
|---|---|---|
| `sandbox-closes-worktree-git` | a start whose sandbox leaves the worktree's git folder closed | AC1, per agent: must fail, naming `index.lock` |
| `sandbox-opens-whole-git` | a sandbox that opens the repo's whole `.git` | AC2, per agent: must fail, naming `.git/index`, `.git/HEAD` and the other worktree's git folder |

The implementing job adds both to the hub's plant list. A hub that doesn't list a plant refuses to start; that reads
BLOCKED. Each plant test first requires the planted session's command to have run (its report exists), so it fails for
the reason named, never for a missing binary or a session that never ran. Seen directly with the real binaries on this
Mac, without a hub: Claude Code with `sandbox.filesystem.denyWrite` on the worktree's git folder fails the commit at
`index.lock`, and Codex with `"<checkout>/.git"="write"` in its profile lets all three `.git` writes through.

## How each criterion is read

Each agent gets one world (a test home, a hub, a repo) and one session, which both criteria read; a plant gets a world
of its own. Just before `deep start`, the suite reads the digests of the checkout's `README.md`, `.git/index` and
`.git/HEAD` and of every file in the other worktree's git folder. It then waits up to 7 minutes for the real agent to
exit and reads the report.

- **AC1** (`sessions.test.ts`, per agent): the command ran (its report exists); its `git add` and `git commit` each
  exited 0, else the test fails with git's own stderr (for a closed git folder, `fatal: Unable to create
  '<checkout>/.git/worktrees/<id>/index.lock': Operation not permitted`); and the newest commit `git -C <checkout> log
  <branch>` shows on the branch `deep start` named is the command's, on the base the worktree started from.
- **AC2** (`sessions.test.ts`, per agent, the same session): for each of the four targets, every write the command
  tried there failed with `EPERM` or `EACCES` (any other outcome isn't a refusal), and no file there changed, appeared or
  went from the digests read before the start. The failure names each path written.
- **The plants** (`plants.test.ts`, per agent): the same session and reading on a planted hub; the AC1 reading must fail
  naming `index.lock`, the AC2 reading must fail naming the checkout's `.git/index`, `.git/HEAD` and
  `.git/worktrees/shop-other`.

## Known limits

- The agent runs non-interactively (`-p`, `exec`), not interactively in the hub's terminal: the launch's arguments, and
  so the sandbox, are the same, but `codex exec` takes approval policy `never` (spikes/1330), and a permission prompt
  the interactive agent would show is refused instead. A setting under which the one command is no longer auto-allowed
  fails AC1 here.
- Only SessionStart's hook is installed in the test home; the other hooks `deep setup` writes aren't. The test home's
  Codex plugins are off and every proxy is a dead loopback port; neither is part of the sandbox a start sets.
- Only the versions the shipped facts list a sandbox for are run; another version reads BLOCKED.
- The other worktree is a plain `git worktree add`, not another started session's; it exists before the start, which is
  what the criterion names. A worktree made after the start isn't read.
- Writes are tried with Node's `fs` and the commit with git; a wall that refused one way of writing a path but not
  another wouldn't be seen. The checkout's `config` and `hooks`, which the Scope also keeps closed, aren't criteria and
  aren't tried.
- The test home is under `/Users/Shared`, which every macOS has; elsewhere the suite reads BLOCKED.
