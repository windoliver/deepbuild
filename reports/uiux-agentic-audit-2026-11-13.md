# UI/UX and agent-use audit, 2026-11-13

Base: main at `9b77cd2cd`. Asked for: pull the latest change, audit package by package, apply KISS, and hill-climb on a
simpler UI/UX and on how well an agent can use DeepBuild. This is the second round; the first is
`reports/uiux-agentic-audit-2026-11-10.md`.

## Outcome

Two fixes, each with a test that failed first: +80 −9 handwritten lines in 6 files, not counting this report and its
`failing-first.txt`. Both are in commands and tools that landed after the first round. Sixteen findings were measured
and not applied, because each is an open issue's ground, a blind suite's, or the owner's call.

What every session loads grew 36% in three days, and no check in the repo holds it. That is the largest finding, and
it is not fixed here: a blind suite pins the text.

Like the first round, this is every surface a person or an agent meets, run and measured, not a line-by-line read of
every package. The last section says what was run, what was only read and what was not looked at.

## How it was measured

- **Commands.** 140 `deep` command forms, three times: in a home nobody set up (a new home for each form), in a home
  set up through `deep setup` with its hub stopped, and against a live hub (103 forms; the ones that can start an
  agent or reach a forge were left out). Homes were throwaway, with #1359's stand-ins for the service manager and a
  Node whose folder holds nothing else, so no command could reach this machine's own `~/.deepbuild`, its service
  manager, an agent or a forge login.
- **Agent session.** One scripted session on #26's helpers: 3 hook events sent as deep-hook sends them, a real
  `deep mcp` child making 24 tool calls, and 4 `deep` commands beside it. No real agent ran and no model was called.
- **Tokens.** The skill and `tools/list`, counted with `gpt-tokenizer`, as in the first round.
- The machine restarted part-way through and took the first run's raw outputs with it. Every number below is from a
  second run on a build of the merge base, made after the restart, unless it says otherwise. The scripts and raw
  outputs are in `~/.cache/deepbuild-uiux-audit-1113/` on the machine this ran on; they are not part of the change.

## Scoreboard

| Measure | Nov 10, with #2196 | main today | this change |
|---|---|---|---|
| Skill, tokens every session loads | 1,524 | 3,599 | 3,599 |
| `deep mcp` tool list, tokens | 6,143 (14 tools) | 6,859 (15 tools) | 6,859 |
| Both together | 7,667 | 10,458 (+36%) | 10,458 |
| `deep --help`, words | 824 | 1,089 | 1,089 |
| Forms that ask the OS to confirm you for a change that can't happen, of 4 | not measured | 4 | 0 |
| `deep library off` of a library nothing registers | not measured | "Turned … off.", exit 0 | refused, exit 2 |
| `deep pack rule` of a pack that isn't installed | not measured | exit 3, marked retryable | exit 2, not retryable |
| Refusals that tell an agent to name a host called "none" | not measured | 1 | 0 |
| Lines that print `undefined`, `NaN` or `[object Object]` | 0 | 0 | 0 |
| Command forms that end in a Node stack trace | 0 of 93 | 0 of 140 | 0 of 140 |

The last row is with a canvas core built. With none built, `deep kinds --dump` and `--diff` each ended in a stack
trace in this round's first run; #2176 holds that, and the first round's 93 forms didn't include them.

Measured and unchanged, in a home that was set up with its hub stopped: 64 forms name the hub. They have 24 different
first lines; 59 print an errno and the socket's path twice; 46 open with BLOCKED; 10 name a fix; 52 exit 3 and 10 exit
1 (the other two are `deep lease`, which runs its command unleased). Better than on Nov 10: `deep`, `deep status` and
`deep inbox` now read the hub's database and say since when it isn't answering (#2026). In a home nobody set up, 55
forms print the raw `ENOENT … control.token`, 48 of them under BLOCKED. The form set is larger than the first
round's, so read these beside its numbers, not against them.

## Fixed

| Requirement | Change | Failed first, then passed |
|---|---|---|
| A person sees only what needs a person, and never the same question twice (AGENTS.md, invariant 4). `ask.answer`, `ask.undo`, `decision.overrule` and `person.invite` already check what you named before they ask the OS | `hub/src/trusted-actions.ts`, `hub/src/libraries.ts`: `library.on`, `library.rule`, `library.off` and `pack.rule` refuse a library no loaded package registers, or a pack that isn't installed, before the OS is asked to confirm you. The unknown pack is `not_found` with a sentence that names `deep install`; it was an uncaught error the hub answered as `unavailable`, retryable, so a retry asked you again | New `hub/test/confirm-order.test.ts`. On the merge base all four forms are wrong: each asked the OS, `off` printed "Turned ext.none.library off.", and the pack exited 3 |
| A refusal's remediation is something the caller can do (#1945's `deep_root_plan`, `deep host facts`) | `hub/src/hosts.ts`: with no host in your SSH config the refusal ends "It names no host." It ended "Name one of: none.", which an agent reads as a host to name. The config is read once, not twice | New case in `hub/test/hosts.test.ts`. On the merge base it fails on "Name one of: none." |

Two things the first fix must not break, each held by a test that fails on a wrong build:

- **The OS still decides for a library the hub holds.** `hub/test/library-command.test.ts` gains a case where the OS
  doesn't confirm you: the command exits 3 and the library stays off. A build in which that refusal is switched off
  fails it ("expected 0 to be 3").
- **A library left on by a package that no longer loads can still be turned off.** `confirm-order.test.ts` restarts
  its hub on a saved state that holds one, and `deep library off` asks the OS once and turns it off. A build in which
  off refuses every library nothing registers fails it.

The outputs are in `reports/uiux-agentic-audit-2026-11-13/failing-first.txt`.

What changes for a person, beyond the prompt's order:

- `deep library off <name>` for a library that isn't on and that nothing registers exits 2, where it said it was done.
- `deep pack rule` for a pack that isn't installed exits 2, where it exited 3.
- "The hub has no extension host yet" is now said before the prompt for a library and a pack. No test holds a hub in
  that window, so this part is by reading only.

## Found and not applied, most useful first

### For agents

1. **What every session loads grew 36% in three days.** The skill went from 1,524 to 3,599 tokens. 1,900 of them are
   #409's craft checks for films, which a session that fixes a test also loads; #409 AC3's blind test requires each
   check's description, threshold and fix in `skills/deepbuild/SKILL.md`. The tool list went from 6,143 to 6,859:
   `deep_root_plan` is new (363), and `deep_kinds` (+117), `deep_show` (+142) and `deep_job` (+25) grew. `deep_drive`
   is still 2,045. #1105 owns the ceilings and the canvas tools on demand; until a ceiling exists a change can add
   to every session with no diff saying so. Moving the craft checks to a guide `deep_kinds` serves goes through
   #409's blind redraft.
2. **#2198's three refusals are as they were.** `deep_claim` with a short commit and `deep_wait` with a wrong handle
   answer with the regular expression, and `deep_env` answers `{"status": "BLOCKED"}` with `isError` false.
3. **pi's own tool errors aren't error@2.** `packages/pi/src/index.ts` has three wordings for a hub it can't reach
   (lines 174, 205, 208), none with a code or `retryable`, and "did not answer in time." names no next step. `deep
   mcp` says all three through one function. Not changed: #40's suite needs a pi command, and none was set here.
4. **With no canvas core built, `deep_kinds` and `deep_show` answer `unavailable`, retryable,** "run cargo build --bin
   deep-show first" (`hub/src/canvas.ts:34`). An agent in someone's repo is told to build DeepBuild's checkout, and
   to call again. Seen in this round's first run, before the canvas core was built here.
5. **`deep pack rule` run inside an agent's process tree is refused as a change to "who is on a project"**
   (`trusted-actions.ts`, `asYou`, written for `deep person`). Read from the code, not run.
6. `deep_run` returns the same evidence handle twice when a check prints nothing on stdout and stderr.

### For people, in the terminal

7. **`deep job rule` for a tool nothing lists asks the OS to confirm you, then says the rule is set.** `deep person
   revoke` for a login nobody has asks, then says "Revoked 0". Whether a rule may come before its tool is the
   owner's call, so neither was changed.
8. **More for #1812.** With the hub stopped, `deep host list`, `facts`, `changes` and `run` exit 1 where the table
   says 3. `deep host list` with no host prints nothing. `deep host facts` prints JSON with no flag (read, not
   run). `deep memory overrule` with a wrong form exits 3, not 2 (`memory.ts:231`: every refusal but `not_found` is
   3). The eight commands that answer bad arguments with "Unsupported command." are the same eight.
9. **#2200 is as it was.** In a home nobody set up, 13 forms that exit 2 set the machine up first: `deep status
   --typo`, `deep inbox answer`, `deep inbox --typo`, `deep off now`, `deep env`, `deep env --typo`, `deep memory
   --typo`, `deep secret`, `deep secret --typo`, `deep install` and `deep guard` with no argument, and each of those
   two with a file that doesn't exist.
10. **#1361's second point happens on the README's own path.** A `~/.deepbuild` that holds only `throttle/` makes the
    first `deep status` set nothing up and say "start it with deep hub start", and `deep inbox` print the raw
    `ENOENT … control.token` (run). `scripts/throttle.mjs` and `scripts/lanes.mjs` make that folder, as a `deep
    update --check` that succeeds does (read), and so does `deep debug bundle` (run). The README runs
    `scripts/preflight` before the first `deep status`. The machine this ran on is in that state: its folder holds
    the app's lock, `lanes/` and `throttle/`, and no setup record.
11. **Setup's last line says your history was read "with your own agent, on your plan"** in a home with no history
    and no agent on PATH. The record there holds two `setup.step` events and no run. #1455 pins the line.
12. `deep --help` is 63 lines and 1,089 words. "once the OS confirms you" is on 15 of them, and "Start here" has 15
    lines where #1814 wants five. `deep hub promote` is still not listed (#2124).

### Found on the way

13. `tsc --noEmit` fails with two errors, the same on the merge base: `packages/extension-host/test/liveness.test.ts`
    (no `release`) and `packages/hub/test/job-session-close.test.ts` (no `reserve`, `charge`, `approve`).
14. Three #1820 tests fail on the merge base's build and on the change's alike, and aren't in
    `scripts/known-failures.json`: one in `tests/acceptance/1820/export-redraft/export.test.ts`, two in
    `tests/acceptance/1820/scope/reuse.test.ts`. Not looked into.
15. `distance`, the edit distance for a near name, is written twice: `cli/src/main.ts:273` and `hub/src/tools.ts:249`.
    Left: the CLI loads no hub module for an unknown word.
16. The first round's fixes hold: its tests pass, and `deep_status` at a session's start now names the repo's checks,
    open asks and open items (#2197).

Before the restart, a hub from a test's temp home held the login-service label `com.deepbuild.hub` on this machine,
loaded on Nov 7 from a home with #667's prefix. The first round saw it too, and #2203 closed its cause. It is gone
since the restart; nothing here stopped it.

No issue was filed and no comment posted for any of these.

## Verification

Run once each on a build of the change, after the last edit to the code:

- `hub/test/confirm-order.test.ts`, `hosts.test.ts`, `library-command.test.ts`, `job-rule-command.test.ts`,
  `person-command.test.ts`, the twelve `pack-*.test.ts` files, `tests/acceptance/154/fetch.test.ts` and the blind
  suites `tests/acceptance/1731` and `tests/acceptance/1820`, unchanged: 32 files, 56 of 59 tests pass. The three
  failures are finding 14.
- `tests/acceptance/1942/unnamed.test.ts` and `tests/acceptance/1945`: BLOCKED. Their test machines weren't
  reachable over SSH here. They are the blind tests of a refused host, so `hosts.ts`'s change is proven only by its
  own case.
- The first round's tests: `cli/test/cli.test.ts`, `hub/test/tools.test.ts`, `numbers.test.ts` and `codes.test.ts`, 37
  of 38 (the 38th BLOCKED as on main: no Node older than 24.22.0 here), and `tests/skill.test.mjs` passes.
- `tsc --noEmit`: the merge base's two errors (finding 13), none in a file this change touches.
- `scripts/repo-rules.mjs`, `proof-guard.mjs`, `public-text.mjs`, `plant-lint.mjs`, `blocking-call-guard.mjs`,
  `text-lint.mjs` and `known-failures-check.mjs`: pass. `size-ratchet.mjs` (46 lines) and `record-reader-guard.mjs`
  (1 line): the same FAIL lines as the merge base.

Not run: `node scripts/affected.mjs`. Its list for this change is 325 parallel files, 11 node files, 630 alone, 68
timed, 31 slow and one cargo test, with no WIDE line, on a machine at a load of 70 to 190 on 18 cores. Also not run:
the preflight, clippy, any Rust test (no Rust changed), the timed budgets and the other lint scripts. No real agent
session was run.

## What was covered

| Package or crate | Run | Read | Not looked at |
|---|---|---|---|
| `cli` | every listed command, 383 runs | `main.ts` whole, `update-check.ts` | |
| `hub` | every command; 24 tool calls; 3 hook events | `tools.ts`, `mcp.ts`, `client.ts`, `inbox.ts`, `confirmed-command.ts`, `trusted-actions.ts`, `stop-reply.ts`, `confirm.ts`; parts of `libraries.ts`, `hosts.ts`, `memory.ts`, `list.ts`, `setup-steps.ts`, `human-answers.ts` | the rest of `core.ts`, `server.ts` and the judging files |
| `pi` | | `src/index.ts` whole | its suites: no pi command here |
| `channels` | | the four transports, which only carry | the text a phone shows, rendered in `asks` |
| `deep-hook` | built; called by the hub | the lines it prints when it blocks | the rest of its Rust |
| `deep-show` | built, for the pack tests and `deep kinds` | | its Rust |
| `deep-app`, `deep-replica` | | | all: not built, no view drawn |
| `paseo`, `github`, `asks`, `verdicts`, `readings` and the other packages; the canvas, GPU and text crates | through the hub where a command reaches them | | all |
