# Acceptance tests for #1202: Claude Code hooks after SessionStart are unverified where /bin/sh is dash

Written first, blind, from issue #1202 (its body as of November 3, 2026), `docs/technical-design.md` (Proof in
AGENTS.md; One hub per user, a tiny hook client; Hook protocol; Socket roles and contract versions; the Claude Code
adapter) and base commit `db09e652`, by a job that never saw an implementation of #1202. The implementing agent does
not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

The issue has three numbered criteria, AC1 to AC3 in the body's order, with IDs as `scripts/proof-change.mjs` computes
them (SHA-256 of the text, trimmed, white space collapsed). Each test's title starts with its criterion and ID.

| Criterion | ID | File | Lane |
|---|---|---|---|
| AC1: each entry `deep setup` writes, the waiter included, runs deep-hook as a child of the process that runs the command, under dash and `/bin/sh` | `#1202.3792a9e0` | `entries.test.ts` (two tests) | fast |
| AC2: `deep doctor` and the hub's hook-program check (#993) still find the program each entry runs | `#1202.d1a1edc6` | `programs.test.ts` | fast |
| AC3: a live Claude Code 2.1.308 session on a dash machine records every hook event `verified: true` | `#1202.cbf2a1cb` | `session.live.test.ts` | by hand |

## How to run

On Linux, with Node 24.22 first on `PATH`, `cargo` on `PATH`, dash installed and the workspaces built:

```sh
npm run build --workspaces                       # the tests copy packages/hub/dist and packages/cli/dist
cargo build --locked -q -p deep-hook             # the tests copy target/debug/deep-hook (they build it if missing)
node node_modules/vitest/vitest.mjs run --no-file-parallelism tests/acceptance/1202/entries.test.ts tests/acceptance/1202/programs.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/1202/tsconfig.json
DEEP_HARNESS_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=<from `claude setup-token`> node node_modules/vitest/vitest.mjs run tests/acceptance/1202/session.live.test.ts   # by hand only: spends plan usage
```

- The fast tests take about 15 s. They need `/proc` (Linux) and dash; without either they fail with `BLOCKED` in the
  message. Nothing skips.
- Every test makes its folders under `/tmp/dh1202-*` (a socket path must fit in 108 bytes), sets `HOME` to `<tmp>/h`
  for every process it starts and never touches the real `~/.deepbuild` or `~/.claude`. `<tmp>/bin` holds stand-ins
  for `launchctl`, `systemctl` and the login-service launcher (`DEEP_HUB_LAUNCHER`), so `deep setup` never reaches the
  real service manager. Tests stop only processes they started, by PID. No child inherits a `CLAUDE*`, `DEEP_*`,
  `XDG_*`, `GIT_*` or billing variable of the runner's.
- `scripts/lanes.mjs` should list `tests/acceptance/1202/session.live.test.ts` in `byHand` and this folder in `alone`
  (its tests start hubs). This job edits nothing outside its folder; without the `byHand` entry the unit lane runs the
  live file and it fails as BLOCKED.

## The surface under test

### Merged surfaces, used as their suites define them

- **`deep setup`** (#18, #19), run with a hub answering: it writes DeepBuild's hook entries into Claude Code's user
  settings, `~/.claude/settings.json`, the waiter (`asyncRewake`) under Stop and StopFailure (#85). The settings start
  as `{}`, so every command hook entry in them afterwards is one setup wrote; the tests run each exactly as written.
- **`deep doctor --json`** (#19): one `doctor.item@1` per line; `claude.hooks` with `hook_program_missing` (#993).
- **The hub** (`deep hub run`), its control socket with the control token: `events.read`, each event's `verified`
  (the record's mark: true unless the hub couldn't check the event against its session); the stepped clock
  (`DEEP_HUB_TEST_CLOCK_STEPS=1`, `test.clock`, #965); the hook-program check every 10 minutes on that clock, which
  says on each open session that its hooks can't run (#993).
- **The hook protocol** (design: Hook protocol): deep-hook's request carries `pid` and `ppid`, and with the hub down it
  is kept byte for byte in deep-hook's spool, `~/.deepbuild/spool/*.jsonl`.
- **The agent test harness** (#48), its `bash-calls` scenario (#21), for the live file only.

### The copy of the checkout (from #993's suite)

AC2 removes the program the entries run. `deep setup` names the deep-hook the checkout built, and removing that would
break every other suite, so each test sets DeepBuild up from a copy of the checkout at `<tmp>/s` (`copyOfTheCheckout`,
as `tests/acceptance/993` makes it): links, except real copies of `packages/{hub,cli}/dist` and of
`target/debug/deep-hook`. The copy's setup names `<tmp>/s/target/debug/deep-hook`, which a test may remove.

### Defined here, where the issue leaves a surface open

1. **The Claude Code stand-in** (`fixtures/claude.mjs`) is Claude Code's side of the hook contract, the boundary these
   tests don't own: one process per session that reads the settings at each hook, picks the entries whose matcher
   matches, and runs each as `<shell> -c <command>` (the issue: "Claude Code runs each hook command with `/bin/sh
   -c`"), the payload on stdin; it waits for a synchronous entry and runs an `async`/`asyncRewake` one (the waiter) in
   the background until the session exits. The shell is named per hook: dash's own path (`/usr/bin/dash`), `/bin/sh`,
   and `/bin/bash` for the control. It decides nothing and never edits a file.
2. **"The process that runs the command"** is Claude Code, here the stand-in. **"Runs deep-hook as a child"** of it:
   the deep-hook process's parent is the stand-in.
3. **Reading deep-hook's parent** (AC1). A hook entry's deep-hook lives a few milliseconds, too short to catch in the
   process table, so the test reads the request deep-hook sends: the hub is stopped after setup, so each request lands
   in the spool with deep-hook's own `pid` and `ppid`. An entry passes when the request's `pid` is the PID of the
   `<shell> -c` process the stand-in started (the shell gave deep-hook its own place, so its parent is the stand-in)
   and its `ppid` is the stand-in's PID. Matching on `pid` as well as `ppid` means a deep-hook that a shell started as
   its child can't pass by sending another `ppid`. The waiter waits, so its deep-hook is read off `/proc` while it
   runs: the process under the stand-in's `<shell> -c` whose `/proc/<pid>/exe` is `deep-hook` must have the stand-in
   as its parent.
4. **The control** (AC1): before the criterion's runs, SessionStart's entry runs under `/bin/bash`, which runs a lone
   command in its own place; if the reading still finds deep-hook isn't the stand-in's child there, the test fails
   BLOCKED (the harness can't tell), never as the criterion.
5. **The record's `verified`** (AC1's second test, AC3): a session's hooks (SessionStart, UserPromptSubmit, a Bash
   call's PreToolUse and PostToolUse, Stop, SessionEnd) run from one stand-in through `dash -c` against a running hub;
   each hook event the record holds for the session (`session.start`, `user.ask`, `tool.before`, `tool.after`,
   `agent.stop`, `session.end`) must read `verified: true`. This is the issue's "What happens" seen fast; AC1 itself
   doesn't name the record, so it sits under AC1 as its consequence, and AC3 asks the same of a real session.
6. **"Still find the program each entry runs"** (AC2): with the program in place, no `hook_program_missing` item and no
   failed `claude.hooks` item, and after the hub's clock steps one check interval no reading on the open session says
   its hooks can't run. With the program removed, `deep doctor` fails `claude.hooks` with `hook_program_missing`
   naming the program's path and every event whose entry runs it, and after another interval the hub's check says on
   the open session that its hooks can't run, naming the path. The first half fails a check that misreads an entry's
   new command (it was found failing on a twin, below); the second, a check that stopped reading the program at all.
7. **The live session** (AC3): `deep setup` in the throwaway HOME, then the harness's `bash-calls` scenario with
   `--hooks` holding exactly the `hooks` object setup wrote (the issue's "with DeepBuild's entries as its hooks"),
   two Bash calls, `--pass-env CLAUDE_CODE_OAUTH_TOKEN`, `--claude` the `claude` on PATH. Claude Code runs with `HOME`
   the throwaway home and no `CLAUDE_CONFIG_DIR`, so its transcript is under `<home>/.claude/projects`, where the hub
   checks it. "A dash machine" is one whose `/bin/sh` resolves to dash; "Claude Code 2.1.308" is `claude --version`
   reading 2.1.308. Either missing fails BLOCKED.

### Additions the implementation must make

None beyond the criteria: no plant, no new surface. The live file needs the `byHand` entry above.

## How each test fails on a wrong program

| Test | Wrong program | Seen |
|---|---|---|
| AC1 entries | the base: setup's `'<deep-hook>' claude-code <Hook>` under dash, which starts it as a child | at the base, 24 entries (12 per shell) fail, naming the shell's PID as deep-hook's parent (BASE-FAILURE.txt) |
| AC1 the record | the base: each later hook's parent is a new `sh` | at the base, `user.ask`, `tool.before`, `tool.after`, `agent.stop`, `session.end` read `verified: false` |
| AC2 | a fix that writes `exec '<deep-hook>' …` without teaching the program check to read it | a throwaway twin (base `dist` edited so setup writes `exec '<path>' claude-code <Hook>` and `exec '<path>' claude-code waiter`, reverted after): AC1's two tests passed, AC2 failed on the doctor ("run exec, which is gone"), and with the doctor's asserts taken out of a throwaway copy, on the hub's reading |
| AC2 | a check that no longer looks at the program | the removal half: no `hook_program_missing` naming the path, or no reading on the session |
| AC3 | the base | not run (it needs Claude Code 2.1.308 and spends plan usage); this machine's `claude` is 2.1.317, so it fails BLOCKED |

## Not covered by these tests

- The issue's print-run waiter (#668) and claims, held stops and origins: consequences the issue names under "What
  happens", with no criterion of their own; they follow from `verified`.
- "Existing installs keep the old entries until `deep setup` runs again": a statement, not a criterion.
- macOS: the issue is about dash; AC1 runs there only if dash is installed, and needs `/proc`.

## Files

- `helpers.ts`: dash and `/proc`, temp folders and processes by PID, the copy of the checkout, homes, `deep` through the
  copy's CLI, setup's entries, the doctor, the hub and its line protocol, the stepped clock, the spool, payloads, and
  the stand-in's client.
- `fixtures/claude.mjs`: the Claude Code stand-in.
- `entries.test.ts` (AC1), `programs.test.ts` (AC2), `session.live.test.ts` (AC3).
- `BASE-FAILURE.txt`: the run at the base, each test's first failing assertion.
