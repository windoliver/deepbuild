# #37 AC16, blind redraft

Written on November 4, 2026, at the base commit `69803b94`, by a drafting job that never saw an implementation of
#37 or the first job's AC16 test file. It is for this criterion (ID `#37.2f7f3193`, computed as
`scripts/proof-change.mjs` does and checked with `sha256sum`):

> Budgets, on the reference Mac in the local preflight, compared with the merge base: a journey run's evidence stays
> under 20 MB (video at 720p and 15 fps); the runner adds under 10% to Playwright's own time

## What it read

- Issue #37 in full (`gh api repos/windoliver/deepbuild/issues/37 --jq .body`): Scope, Fields, the 25 criteria,
  Proof, References, Depends on, Added Oct 9.
- `AGENTS.md`.
- `docs/technical-design.md`: How runs become one of five verdicts (the run outcomes, "a timing check that fails
  while other work loads the machine", Evidence states, Speed claims name their baseline, The stack a check runs
  against); Evidence; the `journeys` and `env-local` rows of First-party extensions that ship on by default; Numbers
  version 0 has to hold, with "Every task carries its own budgets" and "The reference Macs"; Dogfooding; Tests
  written first.
- `docs/parallel-proof.md` §12a, Budget windows, and its reading rule for "in the local preflight".
- The first job's suite at `tests/acceptance/37/`: `README.md` (The surface under test, the journey file, the sample
  app, its Budgets reading), `helpers.ts`, `latency.test.ts`, `evidence.test.ts`, `fixtures/app` (the journeys
  `checkout` and `cart-total`).
- How other suites gate a budget: `tests/acceptance/348/budgets.test.ts` and `helpers.ts` (`environmentProblem`,
  `judgeTiming`), `tests/acceptance/331/helpers.ts` (`environmentProblem`, `judge`) and
  `tests/acceptance/30/budgets.test.ts` (a percentage overhead judged by the timing rule).
- `benchmarks/budgets.json` and `scripts/benchmark.mjs` (`validateBudgets`, the 20 interleaved rounds), and
  `packages/evidence/src/index.ts` (the store's public entry; the `ab/cdef…` layout).

## Readings

- **A journey run.** One `runJourney` of the sample app's `checkout` journey on the working build, in its own
  temporary checkout, with the stack env-local starts from that checkout ("a stack its environment starts from that
  check's own temporary checkout", The stack a check runs against). `checkout` is the fixture's longest passing
  journey: a goto, a click inside a named container, an expect, and a locator and a readback end-state check. The run
  must pass; a failed run proves no budget.
- **A journey run's evidence.** Every file the run puts in the evidence store, whatever its slot ("It saves video,
  screenshots and the trace as evidence", the `journeys` row; the saved script and the recording too). Each
  measured run gets a fresh world, so the store's files on disk, at the layout the design fixes ("Each file is
  stored once at `evidence/ab/cdef….png`, named by its SHA-256", Evidence), are exactly that run's. Their sizes sum to
  under 20 MB, read as 20,000,000 bytes (decimal, as `budgets.json` writes 10 MB as `10000000`). The test also checks
  that every hash the run names is in that store and that the store's recorded size matches the file.
- **Video at 720p and 15 fps.** The condition the 20 MB holds under, so a runner can't meet it with a smaller or
  sparser video: the video's frame is 1280×720, the fixed viewport ("Fixed defaults: 1280×720", Added Oct 9), and the
  median gap between consecutive frames is 1000/15 ms, within 0.5 fps. Both are read from the file itself, WebM
  (EBML: PixelWidth, PixelHeight, block times) or MP4 (tkhd, mdhd, stts). Playwright's default would fail it: it
  scales a 1280×720 viewport down to 800×450 and records at 25 fps.
- **Playwright's own time.** `playwrightTime(run)` (the README's surface): the ms the run spent inside Playwright
  doing what the journey itself needs, which is what the same steps cost as a plain Playwright script ("Saved journeys
  stay plain Playwright scripts", Added Oct 9): launching the browser, opening the context with the fixed defaults and
  its video, each step's navigation, action and expect, and closing the context and browser, which finishes the
  video.
- **What the runner adds.** `run.timing.total − playwrightTime(run)`, as a percentage of `playwrightTime(run)`: everything
  else the journey runner spends between the stack being ready and its teardown. That covers reading the journey
  file, the per-step records (route, controls, page errors, animations, screenshots), end-state boxes and readbacks,
  scrubbing, storing evidence by hash, saving the script, and attributing the tree the stack served. A screenshot or snapshot
  the runner asks Playwright for beyond the journey's own steps counts as the runner's addition, not Playwright's
  own time. The stack's start, health wait and teardown belong to neither side. They are env-local's, budgeted by #331
  ("adds under 1 s beyond the repo's own start"), and the 10% would be meaningless with a server start in it.
  `timing.total` is the runner's own measurement, so the test checks it against what it sees from outside:
  0 < playwright ≤ total ≤ the wall-clock time of the `runJourney` call.
- **The rule.** "A timing result comes from five runs after warm-up … passes when all five are within the limit,
  fails when all five are over it by more than the margin, and is otherwise INCONCLUSIVE with all five attached. The
  margin is the larger of 5% and the spread of those five runs" (Numbers version 0 has to hold, Every task carries its
  own budgets). The test takes one warm-up run and five measured runs. The 10% is judged on the five readings with the
  margin as a fraction of the limit, as #30's percentage is. The 20 MB is a size, not a timing, so every run must be
  under it, the warm-up included. INCONCLUSIVE fails the test with that word and is never skipped.
- **On the reference Mac.** "A timing or memory budget counts only on a run whose environment fingerprint is one of
  those machines', on mains power, with Low Power Mode off and the thermal state nominal" (The reference Macs). The
  disk budget is on the reference Mac too ("time … memory … disk … measured on a reference Mac", Every task carries its own
  budgets). Before it runs anything, the measuring test calls `environmentProblem()` (#331's and #348's rule, copied
  into the file because `../helpers.ts` has none). Off a reference Mac in a fit state it fails
  `BLOCKED: … <why>` and never passes ("Nothing missing or unrun passes", AGENTS.md). The design calls the result off
  the Mac "a reading" and the budget check INCONCLUSIVE. This test fails BLOCKED as the other suites do, and either
  way it isn't PASS.
- **In the local preflight, compared with the merge base.** parallel-proof §12a: "An existing budget criterion that
  says 'in the local preflight' is met by the scheduled budget window's record for its commit", which measures
  "every commit merged since the last window, each against its own merge base, 20 samples a side". The merge base has
  no journey runner, so this criterion starts as the perf lane's first measurement. A task in
  `benchmarks/budgets.json` whose `initialReason` names #37 must be valid against the merge base's budgets
  (`validateBudgets`), and its command must run and exit 0, so the window can measure every later commit against its
  base. Agents never run the window, so the acceptance test can't read its record. The measuring test reads the
  budget directly on the reference Mac, and the task test proves the window has something to measure.

## Tests

`budgets.test.ts`, one `describe` carrying `#37.2f7f3193`:

1. `AC16 the perf lane has a #37 first-measurement task …`: `budgets.json` is valid against the merge base and has a
   task naming #37 whose `node …` command exits 0 within the lane's 300 s. It isn't gated, since the task's
   existence doesn't depend on the machine.
2. `AC16 on the reference Mac, every checkout journey run's evidence is under 20 MB …`: gated, then a warm-up run and five
   measured runs, each in a fresh world. It checks evidence bytes, video size and frame rate, the time split, and the
   timing rule on the five readings.

## The surface it needs beyond the README

- From the README's surface: `runJourney`, `playwrightTime`, `JourneyRun.timing.total`, `JourneyRun`'s `outcome`,
  `failures`, `evidence`, `video`, `trace`, `script`, `recording`, `steps[].screenshot` and `endState[].screenshot`.
  From `../helpers.ts`: `openWorld`, `checkout`, `journeyPath`, `runOptions`, `journey`, `isWebm`, `VIEWPORT`,
  `REPO` and `NODE`.
- **One addition the README doesn't name:** a perf-lane task in `benchmarks/budgets.json` for a journey run (any
  `id`, a `node benchmarks/<file>.mjs` command, an `initialReason` naming #37). The README says only "the merge-base
  comparison is the perf lane's". The test fixes no id, file name or output format, only that such a task exists,
  validates and runs.
- The test reads `scripts/benchmark.mjs` (`validateBudgets`) and the store's on-disk layout, beyond `../helpers.ts`,
  as #30's and #348's budget tests do. The layout is the design's (Evidence), not an internal.
- **A weaker point, disclosed:** the split between Playwright's time and the runner's comes from the runner's own
  `timing`. The outside bounds catch a runner that reports more time than it took, but not one that books its own work
  as Playwright's. The stronger proof would be a paired bench, as #30's AC12 is: the runner's run interleaved with
  the run's saved script run by Playwright alone on the same stack, printing the pairs. That bench would be the task
  above, with an output format this redraft doesn't fix.

## How to run

On a reference Mac (Mac15,7 or Mac15,12), on mains power, with Low Power Mode off and the thermal state nominal, with
the repo's Node 24.22.0 and Playwright's Chromium installed, and nothing else running:

```sh
npm ci && npm run build --workspaces
node node_modules/vitest/vitest.mjs run --root tests/acceptance/37 redraft-ac16
rm -rf tests/acceptance/37/node_modules
```

Anywhere else the second test fails `BLOCKED`, naming the platform, the machine or its state. At this base both tests
fail: there is no `#37` task in `budgets.json` and no `packages/checks-journey`.
