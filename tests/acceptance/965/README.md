# Acceptance tests for #965: a looping session's slow checks wait in their queued places until the loop pauses

Written first, blind, by a job that never saw an implementation of #965; none existed. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- Issue #965 as of 2026-11-01T06:39:50Z: its problem, Scope, Not in scope, the five acceptance criteria, Proof and Depends
  on.
- `docs/technical-design.md`: An agent says it's done (Slow runs start when the turn ends; A loop's turn end isn't a
  hand-back; Latest snapshot wins; Held time is counted), What each agent gives us (prompt origins, loop facts) and
  Dogfooding.
- At the base (`a7e140b2`): `packages/hub/src/gate-runner.ts` (`stop`, `turnEnded`, `backgroundEnded`, the 30-minute
  timer), `packages/hub/src/core.ts` (the Stop path that calls `turnEnded`, `enrich`, `loopAt`, the 2 s background poll,
  `backgroundCapped`, `judgedLine`, `runClaim`, `runApproved`, `claim` for `deep_claim`, the mid-turn queue and acks),
  `packages/hub/src/hookmap.ts` (`loopFact`), `packages/hub/src/wire.ts` (`HookMeta.loop`), `packages/hub/src/server.ts`
  (the clock, the `test.*` methods), `packages/hub/src/plant.ts`, `packages/hub/src/ask-tasks.ts` (`asksForChange`,
  drafts), `packages/hub/src/verdict-chat.ts`, `packages/verdicts/src/line.ts`, `packages/leases/src/index.ts` (the
  `cpu.slot` pool), `packages/gate/src/scheduler.ts` (the modelled rule: `atFastEnd`, `starterAt`, `loopFit`,
  `releaseHeld`, `recheckHeld`, `HeldRecord`, `line`), `adapters/loops.facts.json`, `adapters/claude-code.facts.json`
  (prompt origins), the hub tests `packages/hub/test/background-group.test.ts`, `background-hold.test.ts`,
  `gate-stop.test.ts`, `verdict-stop.test.ts`, and the blind suites `tests/acceptance/907`, `tests/acceptance/29`
  (`h-d.ts`, `fixtures/agent.mjs`), `tests/acceptance/18/binding` (deep mcp under an agent), `tests/acceptance/31`
  (`hub-env.test.ts`) and `tests/acceptance/303` for format.

What the base does: at a green stop whose reply ends the turn, `core.ts` calls `gate.turnEnded(claim, background,
stopAt)` whatever started the turn, so a `/loop` turn's slow checks start at once unless a background command or
subagent still runs (#907, which holds them for it at most 30 minutes, on a real `setTimeout`). It reads no wake-up, cron
or prompt origin for the hold, keeps no grace window, writes no held place to the record, and its verdict line names no
held check. The hub's clock is the wall clock, or a fixed offset from it (`DEEP_HUB_TEST_CLOCK`), and its check slots
are half this machine's cores.

## Run them

```sh
npm ci                            # once, if node_modules is missing
npm run build --workspaces        # every test starts `deep hub run` from packages/cli/dist
cargo build --locked -p deep-hook # every test drives its sessions through target/debug/deep-hook
node node_modules/vitest/vitest.mjs run tests/acceptance/965/loops.test.ts
node node_modules/vitest/vitest.mjs run tests/acceptance/965/starts.test.ts
node node_modules/vitest/vitest.mjs run tests/acceptance/965/cron.test.ts
node node_modules/vitest/vitest.mjs run tests/acceptance/965/grace.test.ts
node node_modules/vitest/vitest.mjs run tests/acceptance/965/background.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/965/tsconfig.json
```

Use the repo's Node (`.node-version`, 24.22.0), one file at a time. Every test starts a hub and real processes (the
checks run through the command check kind, in its sandbox) and reads starts to within seconds, so all five files belong
on the one-at-a-time line: `scripts/lanes.mjs` needs each `tests/acceptance/965/*.test.ts` added to its `alone` list.
This README is the instruction; the implementer makes that edit. They need a machine the hub's fast lane can run on: with
load averages near 100 on this 12-core Mac (other sessions' hubs and suites), the base hub took over 180 s to lock a
definition, or its 2 s check outran the 60 s stop hold so the stop recorded no held time and queued nothing; such a run
says nothing about #965 and is to be redone, never read as a pass or a fail. Nothing needs the network (the forge is a closed local
port), a real `claude`, a sign-in or a model call. Folders are under `/tmp/dh29-*` (made by `../29/h-d.ts`) and removed
after each test; every process a test starts is stopped by its PID, and each background command by its process group's
ID, never by name or port.

## The world every test drives

Each test drives a running hub through its hook socket, as the issue's criteria say: `deep hub run` (README, Surfaces)
with two check slots and a stepped clock, and Claude Code sessions played through the real deep-hook binary as children
of a stand-in Claude Code process (`fixtures/agent.mjs`), which also runs the session's `deep mcp` and its background
commands, each in a process group of its own. None calls `simulate`.

- **One ask.** The session types `make the cart total round each line to cents`, which opens one task; its handed
  definition (DEEP_HUB_TEST_DRAFTS) has R1 checked by `.deepbuild/checks/unit.sh` (unit depth) and R2 by
  `.deepbuild/checks/journey.sh` (journey depth), both `on_base: passes`; AC3 adds R3 checked by
  `.deepbuild/checks/soak.sh`. Each check is a node:test suite of one test, committed to the repo.
- **Expected times.** Before the hub starts, its record (`<home>/.deepbuild/ledger.db`) gets five clean runs of each
  check, a day old: 2 s for the unit check ("fast-lane checks of 2 s"), 300 s for the journey, 20 minutes for the soak.
  So the gate runner's expected times are the issue's, and the 10 s budget admits the unit check to the fast lane and
  leaves the journey and the soak to the slow lane. The seeded runs name no session's claim and are left out of every
  reading.
- **Real durations.** The unit check really takes 2 s. The journey and the soak run for an hour (they run on past the
  test, which stops the hub), except in AC4's first test, whose journey takes 3 s so its verdict is made.
- **Turns.** A `/loop` turn is a `scheduled` prompt (`turnOrigin: scheduled`), another session's message is a `peer`
  prompt (origin `session`), and a background command's end notice is a `task_notification` prompt (origin `subagent`),
  each with its transcript entry, as Claude Code 2.1.304 writes them. Each turn changes `src/cart.ts` (a new line each
  time, so each snapshot differs). A wake-up is `ScheduleWakeup` (`delaySeconds: 60`); a cron job is `CronCreate`
  (`recurring: true`, its response's `nextFireAt` 15 minutes on the hub's clock); a background command is `Bash`
  `{ command: 'npm run e2e', run_in_background: true }`, its process `/bin/sh -c 'sleep 7200; : npm run e2e'` started
  by the agent in its own group before the call's PostToolUse; `deep_claim` is its PreToolUse (`mcp__deep__deep_claim`),
  the call on the session's own `deep mcp`, then its PostToolUse; `gh pr create` is a `Bash` call whose response prints
  a pull request's URL; your words mid-turn are Claude Code's queue entry in the transcript, read at the next hook. AC1,
  AC2 and AC3 open with a typed turn that makes no tool call (so its stop makes no claim); AC5's first turn is the typed
  one.
- **Readings.** Everything is read back through the hub's socket (`events.read`). A stop's line is its reply's
  `systemMessage`. A judged stop is the `claim.made` the stop rule made there (the session's claim that carries the
  recomputed definition `hash`; `deep_claim`'s carries none), its snapshot the commit its claim's run of the unit check
  names, and its held time the `stop.held` naming the claim. A stop the hub never judges within 180 s is BLOCKED. A journey run is a `run.started` of the journey
  check, on the snapshot its `commit` names, at its `ts` on the hub's clock. A held place is the newest `check.held` for
  its check and snapshot (Surfaces). A stop's time and its reply's time are taken on the test's side, on the hub's clock
  (the wall clock plus every step the test asked for), just before the Stop hook is sent and just after it returns.

Each test prints, for the Proof, when each journey started and on which snapshot, and the held places in the record.

## Criteria to tests

Each test's name starts with its criterion's ID and tag (`#965.<first 8 hex of the SHA-256 of the criterion's text>`, as
`scripts/proof-change.mjs` computes it). Each criterion's wrong programs run through the same assertions and must fail
them, naming what the criterion says. The issue's Proof asks for each wrong program as a hub plant; they are
`DEEP_HUB_PLANT` values (Surfaces).

| ID | File | Tests |
|---|---|---|
| AC1 `#965.2723aec9` | `loops.test.ts` | the three-turn `/loop` session; the merge base's rule (`starts-on-every-green-stop`); `holds-every-loop-check` |
| AC2 `#965.932ea160` | `starts.test.ts` | the second turn calls `deep_claim`; its twin runs `gh pr create`; its twin with your words; `holds-claim-stop-for-loop` (both claim twins); `words-only-at-turn-start` |
| AC3 `#965.3dfb5f43` | `cron.test.ts` | the cron due in 15 minutes; `holds-every-loop-check` |
| AC4 `#965.a4f3c27b` | `grace.test.ts` | no automatic prompt by 60 s, and the verdict at the next prompt; the twin whose next message comes at 40 s; `no-grace-window`; `starts-on-every-green-stop` |
| AC5 `#965.ef38e013` | `background.test.ts` | the process group ends at 4 minutes; the twin whose command never ends; the twin woken at 20 minutes; `holds-background-without-limit`; `caps-from-first-stop`; `rechecks-facts-at-stops-only` |

### AC1, `loops.test.ts`

Three turns, each a `scheduled` prompt, a change to `src/cart.ts` and a green stop; turns 1 and 2 schedule their next
wake-up in 60 s, turn 3 none. The next turn's prompt comes 55 s after each stop (`test.clock`), before its wake-up is due.
Asserted at each stop, in order, naming it:

1. Stops 1 and 2: no journey runs on their snapshot (read 6 s after the stop is recorded); the unit check's
   `run.finished` comes before the stop's `stop.held` (its reply comes when its fast-lane check ends); `stop.held.slow`
   is 0 (no slow hold); the stop is no send-back; its line contains `1 check waits for the loop · wake-up`. At stop 2,
   stop 1's held place for the journey is in the record with `replaced_by` the second snapshot and `started_at` null.
2. Stop 3: one journey run, slow lane, on the third snapshot, at or after the stop; none ever on the first two; the
   second snapshot's held place has `started_by: 'loop_paused'` and `started_at` at or after stop 3; the first's stays
   replaced by the second.

Wrong programs: `starts-on-every-green-stop` must fail naming `stop 1`; `holds-every-loop-check` naming `stop 3`.

### AC2, `starts.test.ts`

AC1's session with every turn scheduling its next wake-up in 60 s. In turn 2 the agent calls `deep_claim` for the task
(after its edit and wake-up); in a twin it runs `gh pr create`; in a third twin you type
`why does the cart round half up?` (a question: it opens no task) while turn 2 runs, and no claim is made. Asserted:
stop 1 holds (no journey on its snapshot; line names the wake-up); stop 2 starts one slow-lane journey on its snapshot
within 20 s, at or after the stop, its failure message naming the claim's tool (`deep_claim` or `` `gh pr create` ``) or
your words, and `stop 2`; stop 3 holds again (no journey on its snapshot; line contains `1 check waits for the loop ·
wake-up`); no journey ever runs on the first snapshot.

Wrong programs: `holds-claim-stop-for-loop`, run on both claim twins, must fail naming `deep_claim` and
`` `gh pr create` ``; `words-only-at-turn-start` on the words twin naming `stop 2`.

### AC3, `cron.test.ts`

One `scheduled` turn changes `src/cart.ts`, creates a cron job whose next fire is 15 minutes on, and ends green, with
the unit check, the 300 s journey and the 20-minute soak. Asserted: one slow-lane journey run on the stop's snapshot,
starting within 15 s of the reply; no soak run; the soak's held place is in the record with a `reason` containing
`cron` and `started_at` null; the journey has no held place; the line contains `1 check waits for the loop · cron`.

Wrong program: `holds-every-loop-check` must fail naming `.deepbuild/checks/journey.sh`.

### AC4, `grace.test.ts`

1. A `peer` turn (origin `session`) changes `src/cart.ts` and ends green; no automatic prompt follows. 50 s after its
   reply, no journey; then the clock reaches 65 s and one slow-lane journey run must be there, starting no earlier than
   60 s − 1 s and no later than 90 s after the reply. Its run passes, the claim's `verdict.made` is PASS, and your next
   prompt (a question you type) gets the line in its reply's context, containing `PASS`.
2. The twin: the next `peer` message comes 40 s after the first reply, its turn changes `src/cart.ts` and ends green;
   70 s after the first reply (plus 6 s), no journey ran on the first snapshot.

Wrong programs: `no-grace-window` on the first must fail naming `stop 1`; `starts-on-every-green-stop` on the twin
naming `stop 1`.

### AC5, `background.test.ts`

After the opening turn you type `Is the rounding right yet? Run the e2e suite in the background to see.` (a question:
it opens no task, so the turn works the ask already open, and its origin is yours, not a loop's); the turn changes
`src/cart.ts`, starts `npm run e2e` in the background and ends green. Stop 1's line
contains `1 check waits for the loop · npm run e2e in the background`, and no journey runs on its snapshot. Then:

1. At 3.5 minutes no journey. At 4 minutes the test ends the command's process group (SIGTERM to the group), the
   session idle; one slow-lane journey run must start within 30 s, at or after 4 minutes from the stop; its held place
   has `started_by: 'loop_paused'`, `started_at` at or after 4 minutes.
2. The command never ends. At 29.5 minutes no journey; at 30.5 minutes one slow-lane journey run, starting between 30
   minutes and 30.5 minutes + 30 s after the stop; a `session.reading` of the session names `npm run e2e` and says
   "still running"; the command's process group is still alive; its held place has `started_by: 'cap'`.
3. At 20 minutes the command's end notice arrives (a `task_notification` prompt naming the call; the test ends its
   process group right after), and that turn changes `src/cart.ts`, starts `npm run e2e` in the background again and
   ends green. Stop 2's line contains the background line, and stop 1's held place has `replaced_by` the second
   snapshot. At 30.5 minutes from stop 1, no journey at all; at 29.5 minutes from stop 2, none; at 30.5 minutes from
   stop 2, one slow-lane journey on the second snapshot, at least 30 minutes after stop 2 and at least 50 minutes after
   stop 1; none ever on the first; the second's held place has `started_by: 'cap'`.

Wrong programs: `holds-background-without-limit` on twin 2 must fail naming `stop 1` and `pending past 30 minutes`;
`caps-from-first-stop` on twin 3 naming `stop 2`; `rechecks-facts-at-stops-only` on twin 1 naming `stop 1`.

## Surfaces and plants the implementation must provide

None exists at the base; each is the smallest the criteria need.

- **`DEEP_HUB_TEST_CORES=<n>`**: the cores the hub counts, so its `cpu.slot` pool (half of them, `openLeases`'s `cores`)
  and the gate runner's free slots (`slots`, half the cores less the check runs going) are those of an `n`-core machine.
  The suite sets 4: two check slots. Unset, the machine's own.
- **A stepped clock: `DEEP_HUB_TEST_CLOCK_STEPS=1` and the `test.clock` method.** With the variable set, the hub serves
  `test.clock` on the control socket to the `cli` role: params `{ advance_ms: <integer ≥ 0> }`, result
  `{ now: <the hub's clock after the step, ms since the epoch> }`; without it, the method is refused as `unknown_method`,
  as `test.verdict` is. The hub's clock is then the wall clock (or `DEEP_HUB_TEST_CLOCK`'s start, moving with it) plus
  every step asked for; it never goes back. Everything the hub times for this issue is on that clock, and every timer
  comes due on it, within a second of the step that passes it: a stop's time and its reply, a wake-up's due time (the
  call's time plus its delay), a cron job's `nextFireAt`, the grace window (60 s from the stop's reply), the 30 minutes
  background work may hold a stop's slow checks (from that stop), and the `ts` the core writes on `run.started`,
  `check.held` and `session.reading`. The suite reads the hub's now as the wall clock plus its own steps, and checks it
  against `now`. Real-time waits the hub makes (the stop hold, the 2 s background poll) may stay on the wall clock.
- **`check.held` events**: the record of each held place, as the scheduler's `HeldRecord` has it: `data` is
  `{ session, claim, check, snapshot, held_at, reason, started_at, started_by, replaced_by }`, where `session` is
  `session:<letters>`, `check` the check's path as its definition names it, `snapshot` the commit the claim's runs name,
  `reason` what it waits for (`wake-up`, `cron`, `npm run e2e in the background`, …), `started_by` one of `loop_paused`,
  `cap`, `claim`, `words`, `answer` (or null while held), `started_at` and `held_at` on the hub's clock, `replaced_by`
  the snapshot that took the place first (or null). One is appended when the place is held and again, whole, each time
  it changes; the newest for a check and snapshot stands. A held place that a later stop starts for its own snapshot
  (AC1's stop 3) records `started_by` on the place that was held.
- **The verdict line** (the Stop reply's `systemMessage`): while a claim's checks are held, it carries
  `<n> check(s) waits for the loop · <reasons>`, with the reasons as above, as the scheduler's `line` writes them
  (`1 check waits for the loop · wake-up`, `1 check waits for the loop · cron`,
  `1 check waits for the loop · npm run e2e in the background`). The suite asserts these strings are in the line.
- **The session's row at the cap**: a `session.reading` naming each background command still running and saying
  "still running" (the base's `backgroundCapped` text does).
- **Hub plants** (`DEEP_HUB_PLANT`, listed in `packages/hub/src/plant.ts`), each a wrong program the issue names:
  - `starts-on-every-green-stop`: the merge base's rule; every green stop whose reply ends the turn starts its slow
    checks at once (background work aside, as at the base), with no loop hold and no grace window.
  - `holds-every-loop-check`: a looping stop's slow checks are always held for the loop; no fact ever shows it pausing
    for them, at that stop or later.
  - `holds-claim-stop-for-loop`: a claim the agent makes in a loop's turn (`deep_claim`, `gh pr create`) doesn't start
    its stop's slow checks.
  - `words-only-at-turn-start`: your words count only when they start a turn; words typed mid-turn start nothing.
  - `no-grace-window`: a prompt no fact foresees holds the checks with no 60 s timer to start them.
  - `holds-background-without-limit`: background work holds slow checks with no 30-minute cap.
  - `caps-from-first-stop`: the 30 minutes are timed from the first stop that held the place, never restarted by a
    newer stop that takes it.
  - `rechecks-facts-at-stops-only`: the session's facts are read again only at its stops, so a process group that ends
    while the session is idle starts nothing until the next stop or the cap.

## Open points (choices the issue leaves open; the tests assert the least they can)

1. **AC1's "the second started by `loop_paused`".** Stop 3 starts the journey on its own snapshot, and the record's
   held place of stop 2 must say `started_by: 'loop_paused'`: the place that was held is started by the loop's pause,
   carrying the newest snapshot. Whether that record also names stop 3's snapshot in `replaced_by` is not asserted.
2. **Wake-ups come early.** Each `/loop` turn's next prompt comes 55 s after the stop, inside the 60 s it scheduled, so
   no test depends on what happens when a wake-up's due time passes with no prompt.
3. **One fast-lane check.** "Fast-lane checks of 2 s" is one 2 s unit check; "a 300 s journey on one ask" is the
   journey check of the same ask.
4. **Expected times come from the record's history**, seeded before the hub starts, as the gate runner reads them
   (the median of a check's last five clean runs).
5. **Tolerances.** A stop's and a reply's times are read on the test's side, so each start is checked inside a window:
   the grace window's start in [60 s − 1 s, 90 s] after the reply, the cap's in [30 min, 30.5 min + 30 s] after the stop,
   the process group's in [4 min, its end + 30 s]. A start at the stop, or none, falls outside each.
6. **AC4 runs in real time where the hub has no stepped clock** (the base): 60 s and less pass by waiting. A longer
   wait on such a hub is BLOCKED, never a pass; AC5's minutes need `test.clock`, and on the base AC5 fails before it.
7. **"Its verdict reaches the session at its next prompt or through its waiter"**: the next prompt is the route
   tested; the waiter is not.
8. **AC2 leaves the first snapshot's held place unasserted** beyond "no journey ever runs on it": stop 2 starts the
   journey on its own snapshot, whether that record reads replaced or started.
9. **"With the session idle"** (AC5 twin 1): the session's last hook was its Stop.
10. **Not covered**: Codex sessions and their goal and heartbeat facts (out of scope), an answer of yours delivered
    (`answer`), words sent from the app, a cancelled cron job or wake-up emptying the facts, a `none_left` stop other than
    AC1's third, held places across a hub restart, and the readings (#45) that count from the record.
