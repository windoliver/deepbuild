# #1334 blind redraft, for #2570: the crash and misjudge cases with a restart that restarts the hub

The two #1334 tests that go through the rollback scene's judgement (`rolledBack`), as the #2565 redraft has them, end
with "one notice, never twice: after one restart of the hub". This redraft makes that restart a real one: the stopped
hub's process ends, a hub with another start answers, and only then is "never twice" read. A restart that restarts
nothing fails, and never passes.

## What I read

Issues #1334, #2565, #2570 and #1121 with their comments (`gh issue view`); AGENTS.md; `docs/technical-design.md`
(How it installs, Proven on the base, Dogfooding); and the base `254bdc87c` tree: `tests/acceptance/1334/` (helpers,
the launchd stand-in `fixtures/launcher.mjs`), `tests/acceptance/1334-redraft-2565/` (REDRAFT.md, helpers.mjs, the
crash, misjudge and hold tests, twins), `scripts/lanes-lists.mjs`, `scripts/proof-runs.mjs` (`twinsOf`), and these
sources: `packages/hub/src/service.ts` (`startHub`, `stopAsPeer`, the login service's definition),
`packages/hub/src/authority.ts` (`stopAsYou`), `packages/hub/src/hub-command.ts` (`deep hub stop`),
`packages/hub/src/server.ts` (`hub.stop`, the hello, `hub.health`'s pid), `packages/hub/src/trusted-actions.ts`
(`confirmCommand`), `packages/hub/src/session-state.ts` (`agentAbove`), `packages/hub/src/confirm.ts`
(`DEEP_HUB_TEST_CONFIRM`), `packages/hub/src/promote.ts`, `packages/hub/src/hub-readings.ts` (`rolledBack`,
`healthClaim`) and `packages/hub/src/core.ts` (the start). I read no pull request, diff, other branch, worktree,
scratchpad, session notes, or `tests/acceptance/2570-redraft-ac3/`.

## The dispute

`rollbackScene` in the #2565 redraft restarts the hub with the frozen `stopHub(box)` and then `deep hub start` at
once; `rolledBack` then asserts one `build.rolled_back` event. On the base that restart restarts nothing:

- `stopHub` (`tests/acceptance/1334/helpers.mjs:298`) sends `hub.stop` over the socket with the control token and no
  `peer`. The installed hub stops only once the OS confirms you (`server.ts`, `case 'hub.stop'`, through
  `you.confirm`), and `confirmCommand` refuses a call that names no process: `unconfirmed`, "the call names no
  process for the peer check; run the deep command itself."
- `stopHub` catches the refusal and returns; `deep hub start` finds the hub answering and exits 0, "it was already
  running". The record read "after one restart" is the same hub's record, so a program that records the notice again
  at every hub start passes it.

Checked on the base, not only read: `BASE-RESULTS.txt`, "The dispute, on the base".

## The restart, as this redraft makes it

1. **The stop goes through `deep hub stop`, the command a person runs.** For the installed hub it asks the hub to stop
   naming its own process (`stopAsPeer`), and the hub has the OS confirm you before it stops. Two things stand in for
   a person's machine:
   - **The OS's confirmation:** the hub's test seam `DEEP_HUB_TEST_CONFIRM`, a file that reads `confirmed`
     (`confirm.ts`). The hub reads it from its own environment, which is the login service definition's, so
     `fixtures/confirming-launcher.mjs` sits in front of the frozen launchd stand-in (`DEEP_HUB_LAUNCHER`): each
     definition the hub's service code hands over is loaded as a copy whose environment also names
     `DEEP_HUB_TEST_CONFIRM=<sandbox>/confirm`. The file the product wrote is left as written (the C2 test reads it),
     and the frozen stand-in is used as it is. The confirmation file is written only just before the restart, so no
     earlier step of the scene can be confirmed by it.
   - **Your terminal:** deep-hook names the test process as the session's agent, so a `deep hub stop` the test starts
     as its child is inside that agent's process tree, and the hub refuses it (`agentAbove`). The command is run from a
     shell that detaches from the test (a background job whose parent shell has exited and been reaped), so the peer
     check finds no session above it. Its output goes to files, never to the test's pipes; it is bounded at 10 minutes
     and its process group is stopped by PID at teardown.
2. **`deep hub start` is asked for at once**, by the same shell right after `deep hub stop` exits: the race #2570 is
   about.
3. **The restart is proven before "never twice" is read.** Before the stop, the hub's start (hello) and pid
   (`hub.health`) are read; once a hub answers again, its start, and whether the old pid still runs.

The judgement, in order:

| Step | Reads | On failure |
|---|---|---|
| Every assertion of the frozen `rolledBack` up to "the rollback's notice must name the promoted commit" | unchanged | as frozen (INCONCLUSIVE included) |
| "after the rollback the hub didn't come back from deep hub start" | frozen words, on the new restart | FAIL |
| The hub in before the restart was read (start and pid) | new | `BLOCKED:` |
| `deep hub stop` exited 0 | new | `BLOCKED:` the stop stand-ins didn't work, so no restart happened and "never twice" can't be read |
| The old hub's pid no longer runs | new | FAIL: "the restart restarted nothing" |
| The hub answering has another start than the stopped one | new | FAIL: "the restart restarted nothing" |
| "one notice, never twice: after one restart of the hub" | frozen words | FAIL |

So a restart that does nothing reads `BLOCKED:` (the stop was refused) or fails ("the restart restarted nothing"),
never PASS. The twin `stop-stops-nothing` shows the second.

## What changed against the #2565 redraft

| | #2565 redraft | This redraft |
|---|---|---|
| Test files | `crash.test.mjs`, `misjudge.test.mjs`, `hold.test.mjs` | `crash.test.mjs`, `misjudge.test.mjs`: the #2565 files byte for byte, without their comment header (a blind suite carries no comments). `hold.test.mjs` doesn't go through `rolledBack` and is not copied |
| Test names, tags, scenario | | unchanged: `#1334.775c65d4`, `#1334.14e4b3e9`, and the C2 versioned-folder test in `crash.test.mjs` |
| `watched`, the sandbox, builds, session, readers | imported | imported from `../1334-redraft-2565/helpers.mjs` |
| `rollbackScene` up to the restart | its own | the #2565 function line for line (comments dropped), plus one line after `sandbox`: the confirming launcher in front of the frozen stand-in |
| The stop | frozen `stopHub`: `hub.stop` on the token alone, refusal swallowed | `deep hub stop`, run detached from the test's process tree, the OS's confirmation stood in for by `DEEP_HUB_TEST_CONFIRM` |
| The start | `deep hub start` from the test | `deep hub start` from the same detached shell, at once after the stop |
| What the scene records | `restart`, `restarted`, `afterRestart` | the same, plus `inBefore`, `byHand` (both commands' outputs), `inAfter`, `oldRuns` |
| `rolledBack` | the frozen function | the frozen function, called with the restart's two readings set to the pre-restart record (so its last two assertions hold trivially there), then those two assertions in the frozen words on the real restart, with the three new checks between them |
| Twins | eleven `promote.ts` twins on `afe996e03` | nine: the seven of these two tags, re-based on `254bdc87c`'s `promote.ts`, and two new (below) |
| Lanes | listed `alone` in `scripts/lanes-lists.mjs` | `lane.json`, `alone` |

## Mapping, original → replacement

| Original (path › test) | Criterion | Why replaced | Replacement |
|---|---|---|---|
| `1334-redraft-2565/crash.test.mjs` › #1334.775c65d4 a planted build that crashes at start is rolled back within 60 s, with no attempt lost and one notice naming the commit | `#1334.775c65d4` | its restart restarts nothing, so "never twice" reads the hub that recorded the notice | `crash.test.mjs` › the same name |
| `1334-redraft-2565/crash.test.mjs` › the hub runs from a promoted build in a versioned folder … | Scope | shares the scene; unchanged | `crash.test.mjs` › the same name |
| `1334-redraft-2565/misjudge.test.mjs` › #1334.14e4b3e9 a planted build that starts but judges the fixture claim wrongly … | `#1334.14e4b3e9` | as for the crash case | `misjudge.test.mjs` › the same name |

`1334-redraft-2565/hold.test.mjs`, `1334/doctor.test.mjs` and `1334/contract.test.mjs` are not replaced.

## Wrong programs

`twins.json` names nine twins; each is a whole copy of one base (`254bdc87c`) source with one fault, marked
`/* TWIN <name>: … */`, under `twins/<name>/<repo path>`.

| Twin | File | The fault | Tags | Expected to fail at |
|---|---|---|---|---|
| `notice-at-every-start` | `packages/hub/src/core.ts` | each hub start appends the last `build.rolled_back` again | both | "one notice, never twice", only once the restart is real (the hub restored by the rollback starts before the notice exists) |
| `stop-stops-nothing` | `packages/hub/src/hub-command.ts` | `deep hub stop` of the installed hub says it stopped and exits 0 without asking the hub | `#1334.775c65d4` | "the restart restarted nothing" (the restart that does nothing) |
| `slow-rollback` | `promote.ts` | waits 75 s for the new hub before it rolls back | `#1334.775c65d4` | "answered again … the bound is 60 s" |
| `two-notices` | `promote.ts` | records the notice twice | `#1334.775c65d4` | "one notice of the rollback … there are 2" |
| `notice-names-restored` | `promote.ts` | the notice names the build that came back | `#1334.775c65d4` | "the rollback's notice must name the promoted commit" |
| `fresh-root-on-rollback` | `promote.ts` | rolls back to an empty record and spool | `#1334.775c65d4` | "an attempt lost" |
| `loses-mid-outage` | `promote.ts` | drops the calls spooled while the planted build was in | `#1334.775c65d4` | "an attempt lost" |
| `pings-only` | `promote.ts` | the health check only waits for the hub to answer | `#1334.14e4b3e9` | "the last good build … never came back" |
| `judges-in-promote` | `promote.ts` | judges the fixture claim in promote's own process | `#1334.14e4b3e9` | the same |

The seven `promote.ts` twins are the #2565 redraft's for these two tags, planted again on the base's `promote.ts`
(it changed since `afe996e03`: `rootToken(root)`, the restart through `hub.restart`). The rollback branch now
switches `current` back before it restarts, so `fresh-root-on-rollback` and `loses-mid-outage` sit just before that
switch, as they sat before the old one. The #2565 redraft's twins for `#1334.a6dc45e5` and the promoted-commit scope
line belong to `hold.test.mjs`, which this redraft doesn't touch.

Each twin's run is in `BASE-RESULTS.txt`.

## On the base

See `BASE-RESULTS.txt`. On the Spark at load 105-128 both criterion tests read INCONCLUSIVE by the frozen 50 ms spool budget, before the restart; a diagnostic run of the scene showed the restart real on the base (stop accepted, old pid gone, new start, one notice). The dispute was checked on the base: the #2565 restart is refused and `deep hub start` reads "already running". Of the nine twins, five failed at their fault (notice-at-every-start at "never twice" on the misjudge file); four read INCONCLUSIVE by the same budget check at loads 62-139 (stop-stops-nothing, two-notices, fresh-root-on-rollback, loses-mid-outage).

## Run it

With Node 24 first on `PATH`, from the checkout's root, after `npm ci`, `npm run build --workspaces --if-present` and
`cargo build --locked -p deep-hook`:

```sh
node --test --test-concurrency=1 tests/acceptance/1334-redraft-2570/crash.test.mjs tests/acceptance/1334-redraft-2570/misjudge.test.mjs
```

Three tests in two files, each file one scene of several minutes. A twin: in a scratch copy of the built checkout,
`cp -R tests/acceptance/1334-redraft-2570/twins/<name>/packages/. packages/`, `npm run build --workspaces
--if-present`, then the test file its tag names. The frozen README's load rule holds as written: a hook run deep-hook
couldn't hand over within its 50 ms budget reads INCONCLUSIVE.

## At merge

The owner's call: read `crash.test.mjs` and `misjudge.test.mjs` from this folder in place of the #2565 redraft's, and
keep its `hold.test.mjs`.
