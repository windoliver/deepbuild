# Blind redraft of #25 AC2, AC3 and AC5 (for #3289)

A blind redraft (design, Dogfooding). It never saw an implementation, a fix, a PR or an issue comment.

- AC2 `#25.ee0f30b0` "An idle session wakes within 2 s of an answer at p95": `wake.test.ts` (with `helpers.ts`),
  standing in for `../25/routes/wake.test.ts`. Twin: `waiter-never-wakes`.
- AC3 `#25.008fdf08` "No waiter outlives its session": `session-end.test.ts`, standing in for
  `../25/routes/session-end.test.ts`. Twin: `waiter-outlives-session`.
- AC5 `#25.c5d6abef` "With the waiter's hook disabled for one session, its answers arrive through the next route, and a
  new session starts again from its declared flags": `flags.test.ts`, standing in for `../25/fallbacks/flags.test.ts`.
  Twins: `routes-from-settings` and `routes-kept-across-sessions`.

## What it read

Issue #25's body (no comments), `AGENTS.md`, `docs/technical-design.md` and, at base `254bdc87c`:
`tests/acceptance/25/` (the three tests, `routes/helpers.ts`, `fallbacks/helpers.ts`, `routes/README.md`, `twins.json`,
`twins/*/lines.json`, `twins/REDRAFT-1832.md`), `scripts/proof-runs.mjs` (`atAssertion`, `twinOverlay`, `before`),
`scripts/proof-guard.mjs` (`laneFileProblem`), `scripts/lanes-lists.mjs` (`LANE_FILE`), `tests/acceptance/3178/lane.json`,
and `packages/hub/src` where the plants act: `plant.ts`, `core.ts` (`routes-from-settings`), `answer-delivery.ts`
(`routes-kept-across-sessions`, delivery outcomes) and `answers.ts` (`outcome`).

## What changed, and why

The lanes count a wrong program only when the test fails at Vitest's own assertion. A plain `Error` thrown by a helper
does not count (design, Failing on an assertion).

- AC2: `helpers.ts` holds `answerEach` and `judgeP95` that fail at `expect`. A session that never woke within 30 s of
  its answer is named, as is a p95 over 2 s on a machine that is not overloaded. The originals threw `Error`. A p95
  over 2 s on a machine loaded past its core count is still skipped as INCONCLUSIVE, with the load.
  The StopFailure cause ("Claude Code started no waiter at the StopFailure of ...") is now part of the assertion's
  message, so the wrong-program regexes are unchanged.
- AC3: when a waiter is left running, the failure is an `expect(...).toBe('')` whose message names each waiter's pid,
  saying it "outlived its session: N process(es) still running 10 s after it ...". The original threw `Error`.
- AC5: A's delivery is now read from the record's `delivery.outcome`. It must read exactly `next_prompt delivered`
  after A's next prompt (polled up to 20 s, since the hub confirms it from the transcript). Nothing may read
  `delivered` before that prompt, and it must still be once after the following prompt. Text in A's hook reply that
  holds the option's id or label is never taken as the delivery. B's wake check is the original's.
- Wrong-program tests (both AC2 tests and the AC3 one) keep their plants and regexes. Each first runs the same world
  unplanted, as a control that must pass. These tests are tagged, and the before lane judges every tagged test. With
  a twin laid, the unplanted control is the twin's program and fails at its assertion. Without the control, these
  tests would pass on every twin.

- BLOCKED, never a compared text: `helpers.ts`'s `blockedUnlessAsserted` runs a world and passes a Vitest assertion
  failure on unchanged. Anything else (the hub unreachable, a helper's timeout such as a waiter not up within 30 s of
  its Stop) it ends as BLOCKED, with the first line starting with the word, or as INCONCLUSIVE when it said so.
  `assertionFailureOf` gives the wrong-program tests only an assertion failure to compare with their expected text.
  Any other ending is BLOCKED, so on a loaded machine a wrong-program test or its control never reads as a fail at an
  assertion.
  #25's AC2 is measured from your answer to the wake. Idle sessions with their waiters waiting are the precondition
  the criterion starts from, so a world that can't be set up is unrun (design: nothing missing or unrun passes; it is
  BLOCKED). A setup that writes no waiter entry is still caught at an assertion: the StopFailure world reads which
  `asyncRewake` entries Claude Code ran and names a missing one in its never-woke failure.

Expected values are kept: 2 s at p95, 30 s to wake, 10 s for a waiter to end, and 15 s for B's wake.

## How to run

From the clone root, with Node 24, `npm ci`, `npm run build --workspaces`, and
`node scripts/throttle.mjs build -- cargo build --locked -p deep-hook --features env-plants` done. One file at a time,
under the test grant:

```sh
node scripts/throttle.mjs test --wait 720 -- node node_modules/vitest/vitest.mjs run tests/acceptance/25-redraft-3289/<file> --no-file-parallelism
npx tsc --noEmit -p tests/acceptance/25-redraft-3289
```

To run against a twin, lay its `twins/<name>/lines.json` the way `twinOverlay` does: each `find` must match at exactly
one place and is replaced by its `wrong` lines. Then run `npm run build -w packages/hub`, run the file, and restore
the file and rebuild.

## Surfaces

The same as the originals: `deep setup`, `deep inbox answer`, the hub's record (`delivery.outcome` events), and the
Claude Code stand-ins in `../25/routes/fixtures` and `../25/fallbacks/fixtures` (hooks, background waiters, wakes, the
transcript). Process groups come from `ps`.
