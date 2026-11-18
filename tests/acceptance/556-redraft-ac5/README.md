# Acceptance test for #556 criterion 5, redrafted blind: the budgets

Criterion 5 (#556.eb50d272): "Budgets, on the reference Mac in the local preflight, compared with the merge base: the
clean fixture's 80 runs of 4,000 steps and their replays finish in under 5 minutes in two replicas, rules.legal over
them adds under 1 minute, grid.reach over 200 recorded floors takes under 1 s, and a piece with no play interface gains
no work per frame".

A fresh run of the acceptance-test job for this one criterion (design: Dogfooding: a disputed test goes to a fresh run
of its job with the same inputs and the criterion, never the work, the diff or the dispute). It was written at
9521772d5 ("Acceptance tests for #556 (blind)": the base c5c5865ac plus the first suite, `tests/acceptance/556/`), where
no implementation of #556 exists, by a job that saw none. The implementing agent doesn't edit this folder (AGENTS.md,
Proof).

## What was read

- The issue, live (`gh issue view 556 --repo windoliver/deepbuild --comments`; no comments), and its Oracle page
  (`doneright/oracles/issues/556.md`): criterion 5 has no upstream test (time budgets on the reference Mac).
- `docs/canvas-primitives.md`: Check input: `grid.reach`; Play interface `game.play@1`; Check input: playtest; Check
  input: `rules.legal`. `docs/technical-design.md`: Checks for work beyond code (the Playtest bullet); Dogfooding.
  `AGENTS.md`.
- The first suite: `README.md` (above all The surface, whose names this test keeps), `helpers.ts`, `programs.ts`,
  `tsconfig.json`, and `ac01-floors.test.ts` for style. Its criterion-5 file, `ac05-budgets.test.ts`, was not opened,
  nor its other test files or its `BASE-FAILURE.txt`.
- At 9521772d5, only for the surfaces this test uses: `tests/acceptance/184` (`helpers.ts`, `budgets.test.ts`, its
  README's surface, Gates and perf-lane paragraphs), `tests/acceptance/555` (`programs.ts`, README: Run them and The
  surface, `ac01-crawler.test.ts`'s input and its replay checks), `tests/acceptance/1048` (README: The surface, the
  kinds through `runCheck` and rules.legal, and Readings; how `ac01-rules-legal.test.ts` reads `legal`; `openHub`'s
  signature in `helpers.ts`), `tests/acceptance/533/helpers.ts` (`bakeCall`, `onLogic`); `packages/checks/playtest`
  (`deepbuild.json`, `index.ts`, `run.ts`, `legal.ts` and `bots.ts`: which replica calls a run, a replay and
  rules.legal make, with which bot); `crates/deep-logic/src/lib.rs` and `bake.rs` (the bake call's `arrays` and each
  step's fuel); `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`, `validateBudgets`, `judgeTask`, `judgeTargets`),
  `scripts/budget-window.mjs` (how the window reads a task's targets and criteria), `scripts/lanes.mjs`,
  `scripts/lease`, `scripts/proof-change.mjs` (the criterion tag's rule, checked against the issue's text),
  `benchmarks/budgets.json` (#184's playtest tasks).

## Run it

```sh
npm ci                          # once, in a fresh worktree
npm run build --workspaces      # once
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  sh scripts/lease npx vitest run --root tests/acceptance/556-redraft-ac5 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/556-redraft-ac5/tsconfig.json
rm -rf tests/acceptance/556-redraft-ac5/node_modules/.vite
```

The test passes its own timeout (3 hours) above `--testTimeout`. It builds through the first suite's helpers, each once
and honoring `CARGO_TARGET_DIR`: `deep-drive` debug with `env-plants` and, on a reference Mac at rest only, release
(#184's helper); `deep-logic` (#533's helper: the crawler's layout probe and the bake); #533's assembler from a copy
into `target/acceptance-555-wat` (#555's helper). **The folder is in `alone` and the file in `timed` in
`scripts/lanes.mjs`** (it calls `judgeLimit`, starts replicas and hubs, and times release replicas).

Gates. Off macOS the test fails `INCONCLUSIVE:` first thing (the replica's binaries exit on any other OS), never a pass.
Cargo that can't run is `BLOCKED:`. The timings are judged only where the perf lane's rule holds (`judgeLimit` given
five zero readings against a limit of 1 reads PASS: a reference Mac on mains power, Low Power Mode off, thermal state
nominal, the load under the core count); elsewhere the test fails `INCONCLUSIVE:` with the rule's reason, after every
part that doesn't depend on the machine has passed, and is never retried. Folders are temporary and deleted; processes
are #184's helpers' children, stopped by PID.

Time. At the base, on this Mac under a load near 170 on 18 cores, the run took 255 s with cold debug builds of
`deep-drive`, `deep-logic` and the assembler, and 7 s with them built (part 1 up to the record). With an implementation,
part 1 adds grid.reach over 200 one-step runs on two debug replicas, tens of seconds by the first suite's measure (400
one-step plays of the crawler in 21 s), and off a reference Mac at rest the test then ends `INCONCLUSIVE:`. On a
reference Mac at rest it adds a release `deep-drive` build (minutes when cold) and 18 timed checks, six each of the
80-run playtest, rules.legal over it and grid.reach over 200 floors, on release replicas: perhaps 10 to 30 minutes
(an estimate; nothing here has timed a release replica).

## The test, part by part

One test (`ac5-budgets.test.ts`), so `INCONCLUSIVE` can only follow every part that doesn't depend on the machine:

1. **Anywhere on macOS, on two debug replicas**:
   - **No work per frame** (`idle_work`): #555's clean crawler played with no play interface and no bot for 4,000 steps,
     its own seed, spends at every step the fuel `deep-logic`'s own bake of the same piece spends; the steps that differ
     must be 0.
   - **The record** the perf lane and the budget window compare with the merge base: `benchmarks/budgets.json`'s task
     `playtest-crawler` with the command, margin, limits and targets the first suite's surface gives (`crawler_80_runs_s:
     300`, `legal_added_s: 60`, `reach_200_floors_s: 1`, `idle_work: 0`), its `criteria` naming #556.eb50d272 and its
     `initialReason` naming #556; `validateBudgets` accepts the file; `scripts/lanes.mjs` runs this file as timed.
   - **grid.reach over 200 recorded floors**: through the hub, over 200 descender runs of one step of the clean crawler
     (check seed 3556, `piece_seed: run`: each run from its own seed), with `goals: [exit]`, `every: [open]`, `depths:
     [1]`. It passes, reads 200 runs, lists 200 floors, one of each run, every one reached, coverage 200 at depth 1,
     and reports `search_ms` as a number at least 0 and no more than the whole check's wall time; the replicas' own
     plays hold each run played with the descender at hash(3556, i) for one step.
2. **The gate**: `judgeLimit({limit: 1, runs: [0, 0, 0, 0, 0], …})` must read PASS, else `INCONCLUSIVE:` with its reason.
3. **On two release replicas behind a hub**, a warm-up and five readings of each, each with the load at its start and
   end, judged by `judgeLimit` against the record's numbers with a fingerprint read after that timing's readings:
   - `crawler_80_runs_s`: the wall time of `runCheck('playtest')` on #555's criterion-1 input (`crawlerInput` with the
     descender banded, the explorer, the seeded legal bot and the waiting policy, 20 runs each of `{steps: 4000}`, seed
     555, `piece_seed: run`), limit 300 s. Each reading passes with `testsRun` 80, and the replicas' own plays hold each
     bot's run i at hash(555, i) for 4,000 steps and a play of its track without the bot to the same track and final
     hash.
   - `legal_added_s`: the wall time of `runCheck('rules.legal')` over the same input (`{playtest, samples: 50, unlisted:
     8, seed: 556}`), limit 60 s. Each reading reads 80 runs, samples each of them and tests entries, and the replicas'
     own plays hold each bot's run i played with its bot.
   - `reach_200_floors_s`: part 1's grid.reach, `search_ms` / 1000, limit 1 s, each reading checked as in part 1.

   Any FAIL (all five over the limit by more than the margin) fails the test, naming each; then anything not PASS is
   `INCONCLUSIVE:`, naming each timing, its readings and the reason.

## Clauses to checks

| Clause | Checked by | The wrong program it fails on |
|---|---|---|
| the clean fixture's 80 runs of 4,000 steps and their replays finish in under 5 minutes in two replicas | part 3, `crawler_80_runs_s` | a playtest over 300 s in every reading (FAIL); one that times other runs, another span, or no replays |
| rules.legal over them adds under 1 minute | part 3, `legal_added_s` | rules.legal over 60 s in every reading (FAIL); one that reads fewer runs or samples none |
| grid.reach over 200 recorded floors takes under 1 s | parts 1 and 3, `reach_200_floors_s` | the base (no grid.reach); a check that records other floors or reports no search time; a search over 1 s in every reading (FAIL) |
| a piece with no play interface gains no work per frame | part 1, `idle_work` | a play mode that spends other fuel on a piece played with no interface |
| compared with the merge base | part 1, the record | the base (no record); a record with another command, number or criterion, or one the lane's validator refuses |
| on the reference Mac in the local preflight | part 2, and the timed lane | never a pass off a reference Mac at rest: `INCONCLUSIVE:` |

## Readings where the criterion leaves a choice

The smallest reading each time, through the first suite's surface; this redraft adds no name to it.

- **"The clean fixture's 80 runs of 4,000 steps"** is #555's criterion 1 playtest, which the first suite names the clean
  fixture: 20 runs each by its four bots, span `{steps: 4000}`, as #555's `crawlerInput` builds it.
- **"Finish in under 5 minutes in two replicas"** is the wall time of that playtest's `runCheck` through a hub whose
  replica is a pool of two release `deep-drive` processes, its runs and replays included.
- **"rules.legal over them adds under 1 minute"** is the wall time of rules.legal's own `runCheck` over that playtest's
  input (the first suite's reading: rules.legal's own run over the 80 runs). It holds every replica call rules.legal
  makes, so it is never less than what rules.legal adds; a difference of two timings would rest on how much of the
  playtest's work rules.legal repeats, which nothing states.
- **"grid.reach over 200 recorded floors takes under 1 s"** is `search_ms` (The surface: the wall time of grid.reach's
  own searches over the floors it recorded, its plays left out), as the design's cost line counts the search. The 200
  floors are 200 runs of one step: a floor is recorded at step 0 (The surface: Floors), so each run records exactly one,
  each from its own seed. `depths: [1]`, since one step generates no other depth.
- **"A piece with no play interface gains no work per frame"** is #184's reading on the clean crawler: played with no
  play interface and no bot for the criterion's 4,000 steps, it spends the bake's fuel at every step. The bake passes
  `arrays: []`, which only leaves its recorded arrays out of the reply.
- **"Compared with the merge base"** is the record `playtest-crawler` (The surface: The budget record), which the budget
  window runs against the merge base; `validateBudgets` checks it against an empty base, as #184's test does. This test
  doesn't build or time the merge base itself.
- **Each reading checks its work** from the replicas' own plays (the pool's log), not the check's word; a reading whose
  work is wrong fails the test, not INCONCLUSIVE.

## The base run, and what has never run

- `BASE-FAILURE.txt`: at 9521772d5 the test fails in part 1, naming the missing `playtest-crawler` record. The parts
  listed with it passed there: the clean crawler played with no play interface spends the bake's fuel at all 4,000
  steps (and spends some, so the match isn't vacuous), the lane's validator accepts the file, and this file is timed.
- Two scratch runs, `benchmarks/budgets.json` restored after each and nothing of them committed: with the surface's
  record added, the record check passes and the next failure is grid.reach's absence from the plug-in's manifest (the
  first suite's `openHub`); with `reach_200_floors_s: 2` in it, the test fails naming `playtest-crawler.targets`.
- **Never run**: part 1's grid.reach (the base has none) and all of part 3. The reading checks of part 3 were confirmed
  only against the code they read: the plug-in's run, replay and rules.legal calls (`run.ts`, `legal.ts`, `bots.ts`'s
  `lower`, which keeps a bot's kind), the first suite's pool log, #555's criterion-1 test (a replay records its run's
  track), and #1048's (the hub's result carries `legal`). A scratch run of them on debug replicas was stopped after 22
  minutes: debug replicas spend their time compiling the crawler's WebAssembly, and this Mac was loaded near 170. When
  this was written the gate read INCONCLUSIVE here (a reference model, but thermal state fair and the load far above its
  18 cores).

## Not covered

The budget window's own run of `node benchmarks/canvas.mjs playtest-crawler` and its `judge` (this test checks the record
the window reads, not that command's report); a comparison of the timings or the command's p50 and peak memory with the
merge base's build (the window's, margin 0.5); `idle_work` as that command reports it; every other criterion of #556.

## Files

`README.md`, `BASE-FAILURE.txt`, `tsconfig.json` (the first suite's), and `ac5-budgets.test.ts`. It imports the first
suite's `helpers.ts` and `programs.ts`, #555's `programs.ts`, #184's and #533's helpers, all read only.
