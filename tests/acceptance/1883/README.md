# Acceptance tests for #1883: recording an agent's folder trust writes through a symlinked config file, not over the link

Written first, blind, by a job that never saw an implementation of #1883; none existed. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

The issue has three checkbox criteria, AC1 to AC3 in the body's order. Each test's name carries its criterion's ID
(`#1883.` and the first 8 hex digits of SHA-256 of the criterion's text, computed with `scripts/proof-change.mjs`'s
`readIssue`): AC1 `#1883.cba928bb`, AC2 `#1883.6b16b1ac`, AC3 `#1883.dd68075b`.

## What was read

- Issue #1883 as of 2026-11-14: Scope (write through the one writer setup uses; the file keeps mode 0600), the three
  criteria, Proof ("the start on a real hub with the linked config, failing on the merge base"), Depends on (#1330).
- `docs/technical-design.md` (How it installs; What each agent gives us), `AGENTS.md` (Proof).
- At the base `c740dede7` (main, 2026-11-14), for surfaces and format only: `packages/hub/src/starts.ts` (`launch`,
  `trust`, `versionOf`, `sandboxOf`), `packages/hub/src/plant.ts` (a hub refuses a plant it doesn't list),
  `packages/hub/src/claude-settings.ts` (`writeThrough`, the plant `setup-renames-over-link`), the `started` block of
  `adapters/claude-code.facts.json` (`trust.file` `~/.claude.json`, `trust.set`
  `projects.{worktree}.hasTrustDialogAccepted`, `defaultHome` `~/.claude`), the CLI's `deep start` usage, and the
  suite `tests/acceptance/1330` (its line client, waits, `mustStart` and `failureOf` are imported, not copied).

## What the base does

`Starts.trust` reads `~/.claude.json`, sets `projects.<worktree>.hasTrustDialogAccepted` to `true`, writes
`JSON.stringify(config, null, 2)` and a newline to `~/.claude.json.deep-<pid>` with mode 0600 and renames it over the
path. With a symlink there, the link becomes a regular file holding the trust and the link's target is unchanged, so
AC1 fails, naming the path. With a regular file there, the bytes are the ones AC2 spells out, so AC2 passes. The base
lists no plant `trust-renames-over-link`, so its hub refuses to start with it and AC3 reads BLOCKED.
`BASE-FAILURE.txt` has the run.

## Run them

Linux or macOS, with the repo's Node (`.node-version`, 24.22.0):

```sh
npm ci                         # once
npm run build --workspaces     # every test runs packages/cli/dist/main.js
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook   # the hub won't open without it
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1883 --no-file-parallelism --testTimeout=300000
node node_modules/typescript/bin/tsc -p tests/acceptance/1883/tsconfig.json
```

The hub needs deep-hook built to open (it reads `target/{release,debug}/deep-hook`), though no hook runs here: the
trust is written before the agent launches, and the stand-in runs none. Each test
makes its own test home under `/tmp/dh1883-*` and sets `HOME` to it for the hub and every child, so no real
`~/.claude.json`, `~/.claude` or `~/.deepbuild` is touched. The hub runs as `deep hub run` with `DEEP_HUB_TEST_CONFIRM`
(the OS confirming your answer), `DEEP_HUB_TEST_FORGE=http://127.0.0.1:9` (no forge) and, for AC3,
`DEEP_HUB_PLANT=trust-renames-over-link`. Processes are stopped by PID only. No model is called and nothing leaves
127.0.0.1. A missing CLI build or deep-hook, or a hub that won't start with the plant, reads BLOCKED, never a pass.

## The start

Each test makes the start #1330 defines, as you run it in your terminal: `deep start approve --repo <repo> --issues
1883 --agents claude-code --at-once 1 --plan-share 100 --json` (no `--home`, so Claude Code's default home and its
config file `~/.claude.json`), your yes through `deep inbox answer <ask> <allow option>`, then `deep start --repo <repo>
--issue 1883 --agent claude-code --prompt "Say ready." --json`, which must say `started`. The worktree it names is the
key the trust is read under.

`fixtures/claude.mjs` stands in for Claude Code, installed as `claude` first on the login PATH (`config.json`'s
`runner.login_path`). It reports the newest version the shipped facts list that their `sandbox` has no entry for (at
the base `2.1.304`), so the start runs with no sandbox of its own on any platform, then idles until stopped. It writes
nothing of Claude Code's config, so whatever `~/.claude.json` holds after a start, the hub wrote.

## How each criterion is read

- **AC1**: `~/.claude.json` is a symlink to `~/dotfiles/claude.json`, which holds some of Claude Code's own keys with
  mode 0600. After the start the path is still a symlink to that target; the target holds
  `projects[<worktree>].hasTrustDialogAccepted: true`, keeps every other key it held, and keeps mode 0600 (Scope). The
  failure message names the path and says what was found (a regular file, the target unchanged, on the base).
- **AC2**: `~/.claude.json` is a regular, compact file (mode 0600, one non-ASCII value). After the start it is still a
  regular file, mode 0600, holding exactly the bytes the base writes, spelled out line by line in the test: two-space
  indented JSON, keys in their order, the worktree's entry last under `projects`, a closing newline.
- **AC3**: under the plant `trust-renames-over-link` (a `Starts.trust` that writes a temporary file and renames it
  over the config path, as the base does), AC1's check runs and must fail, its message naming `~/.claude.json`'s full
  path and the link no longer being a symlink.

## Known limits

- Only Claude Code is played; Codex's facts name no `trust` at the base.
- A non-default home (`<home>/.claude.json`, the facts' `homeFile`) is not exercised: the issue's case is the
  dotfile-managed `~/.claude.json`.
