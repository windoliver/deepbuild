# Blind redraft of #311 AC12, timing half: validating an event takes under 20 µs at p95

AC12 `#311.5a2a5cc9`: "Budgets, on the reference Mac in the local preflight, compared with the merge base: validating an
event against its schema takes under 20 µs at p95, and the generated types add nothing at runtime." This folder holds the
timing half only; "the generated types add nothing at runtime" stays with `../codegen.test.ts`. Written from the issue,
the design and base `6e7e31d8`, without reading the test it redrafts (`../budgets.test.ts`) or its `BASE-FAILURE.txt`.

## What it read

- Issue #311 as of 2026-11-07 (Scope, Fields, the 22 criteria, Proof, Added Oct 9).
- `docs/technical-design.md`: Numbers version 0 has to hold (Every task carries its own budgets: five runs after
  warm-up, PASS, FAIL, INCONCLUSIVE and the margin; The reference Macs, now three, the Mac17,10 with an M5 Max and 64 GB
  among them); Speed claims name their baseline. AGENTS.md.
- `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`), which this test calls rather than copies.
- `../README.md` (the package surface: `validate`, `catalogue`, `fixtures`), `../helpers.ts` (`REPO`).
- `tests/acceptance/1018/redraft-ac6` for a redraft folder's shape.

## How to run

On a reference Mac, on mains power, with Low Power Mode off and the thermal state nominal:

```sh
npm ci   # once, if node_modules is missing
npx vitest run --root tests/acceptance/311 redraft-ac12 --disable-console-intercept --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/311/redraft-ac12/tsconfig.json
```

One test, a few seconds. It needs no build, network, model or sign-in. Keep the console output: the five p95 readings
printed there are the criterion's proof. It belongs on the one-at-a-time line of the budget window: anything beside it
moves its timings. With `--root`, Vitest writes `node_modules/.vite/` under `tests/acceptance/311`; delete it before
committing.

## Expected values

| | Value |
|---|---|
| Limit | under 20 µs at p95 for one `validate(name, value)` of a whole event |
| Events | every valid fixture (`fixtures(schema)`) of the newest catalogued schema of 17 kinds the issue names: `user.ask`, `session.child_started`, `task.created`, `worktree.created`, `worktree.removed`, `doc.patched`, `claim.made`, `tool.before`, `verdict.made`, `verdict.stale`, `definition.locked`, `definition.revised`, `decision.created`, `decision.applied`, `ask.created`, `ask.answered`, `ask.defaulted` |
| Runs | one warm-up run, then five runs of 600 rounds; a round validates the next fixture of each kind, so a run is 10,200 calls and each kind weighs the same |
| Each call | on its own fresh `structuredClone` of the fixture, timed alone with `process.hrtime.bigint()`, and accepted (`ok: true`) |
| A run's reading | the nearest-rank p95 of its 10,200 call times, in µs, printed with its p50 and max |
| Judge | `judgeLimit`: PASS when all five p95s are at most 20 µs, FAIL when all five are over 20 µs by more than the margin (the larger of 5% and the five runs' spread over 20 µs), else INCONCLUSIVE |
| Where it counts | `fingerprint()` before and after the runs on one of Mac15,7 / Apple M3 Pro / 36 GB, Mac15,12 / Apple M3 / 16 GB, Mac17,10 / Apple M5 Max / 64 GB, on mains, Low Power Mode off (not unknown), thermal state nominal, macOS build known |

Outcomes: PASS passes; FAIL is a failed assertion whose message starts `FAIL`; INCONCLUSIVE, and every run off the
reference Macs or their conditions, is a skip whose message starts `INCONCLUSIVE` with the five readings in it. A kind
missing from the catalogue, a schema without a fixture, or any refused call fails with a message starting `FAIL`, so a
validator can't look fast by refusing. A missing or non-finite reading is `BLOCKED` (thrown).

## Fails on a wrong program

A planted slow `validate` that busy-waits 30 µs per call before validating makes every call at least 30 µs, so every
run's p95 is well over 20 µs. Margin: the larger of 5% and the five p95s' spread over 20 µs; FAIL needs all five over
20 × (1 + margin). This was run once on this machine with the import swapped for such a wrapper (a temporary copy in this
folder, deleted after):

```text
p95 per run [45.88, 46.29, 48.21, 46.08, 49.25] µs against 20 µs; p50 [32.67, 32.75, 32.92, 32.46, 33.13]
judgeLimit with Low Power Mode read as off: {"status":"FAIL","margin":0.16875,"reason":"all five runs are over 20 by more than the 16.9% margin"}
```

On a reference Mac that is the test's own verdict: the assertion fails with `FAIL all five p95s [...] µs are over 20 µs
by more than the 16.9% margin`. Here it skipped, since this Mac's Low Power Mode reads as unknown (below). A validator
that answers from a cache keyed on the object fails too, since each call gets a fresh copy; one that refuses events fails
on the refused calls.

## Readings and deviations

- **"Compared with the merge base."** The limit is an absolute time ("takes under 20 µs"), not a difference, so the merge
  base's time can't change the verdict and the test doesn't time it. A limit stated as an amount added would need both
  sides in one run (Speed claims name their baseline).
- **No load guard.** The design's conditions are the machine, mains, Low Power Mode and thermal state; the test adds none
  of its own and prints the 1-minute load beside the readings instead.
- **Low Power Mode on the Mac17,10.** On this Mac (Mac17,10, Apple M5 Max, 64 GB, macOS 26B8119), `pmset -g` prints a
  `powermode` line and no `lowpowermode` line, so `fingerprint()` reads Low Power Mode as `null` and every budget here is
  INCONCLUSIVE. That is `scripts/benchmark.mjs`'s reading, outside this folder; this test follows it.

Run here once at base `6e7e31d8`, 2026-11-07: skipped as INCONCLUSIVE (Low Power Mode is null); readings p95
`[8.21, 6.79, 9.79, 8.63, 6.29]` µs, p50 `[1.71, 1.58, 2.04, 1.83, 1.54]` µs, at a 1-minute load of 39.9 on 18 cores.
