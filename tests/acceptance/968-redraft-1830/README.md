# Blind redraft for #1830: #968's budget, with the load read at each run's start and end

A blind redraft of `tests/acceptance/968/budgets.test.ts` (criterion 3, `#968.3dca895d`), written for #1830 from the
issues, the design and base commit `3557b348` ("Merge pull request #2626 …"). It is to run in the first draft's place: the same two tests, each name with its ID unchanged, the same criterion, the same sheet, calls and
measure against the issue's limit. The first draft stays as it was, frozen; nothing outside this folder changed.

## Why

Since #1555 the lane's `judgeLimit` (`scripts/benchmark.mjs`) reads INCONCLUSIVE when a call gives no `loads`, one
`{start, end}` per run: the one-minute load average read at that run's start and at its end. The first draft's judge
and gate in `../968/helpers.ts` (`judge`, `timingProblem`) call it with `limit`, `runs` and `fingerprint` only, so its
timing reads INCONCLUSIVE on every machine, the reference Macs included. This redraft reads `os.loadavg()[0]` right
before and right after each timed run's `deep-gpu` process, as the lane's own runs read it, and passes those five
readings to `judgeLimit` in the runs' order, as the design's timing rule says.

## What was read

- AGENTS.md.
- Issue #1830 and issue #968's body (criterion 3's text, unchanged here).
- `tests/acceptance/968/` at the base: `budgets.test.ts`, `helpers.ts` (its judge, gate and the builders this file
  imports), `README.md`, `tsconfig.json`.
- `scripts/benchmark.mjs`: `judgeLimit` and `fingerprint`.
- `docs/technical-design.md`: How we know version 0 works (the timing rule and the load; The reference Macs) and
  Dogfooding.

## What the base has

The first draft and the lane's judge as read above; this job read no implementation, and with no base run (below) it
doesn't say what `deep-gpu` or `benchmarks/budgets.json` hold at the base. The first draft's judge gives no loads, so its timing can't pass anywhere. This redraft's judge and gate are its own
(`judgeLimit` in a child process through the first draft's `lane` runner, with `loads`); it imports only builders, the
build and the `deep-gpu` runner from `../968/helpers.ts`. The issue's verdict stays the scheduled budget window's at
the merged commit; this file judges a local run as the first draft does.

## Run it

```sh
npm ci                                                   # once, in a fresh checkout
export PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
scripts/lease node scripts/throttle.mjs build -- cargo build --locked --bin deep-gpu   # so the file's own build is a no-op
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/968-redraft-1830 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/968-redraft-1830/tsconfig.json
```

The file builds `deep-gpu` once, as the first draft does. The timing must have the machine to itself, so this folder
belongs in `scripts/lanes.mjs`'s `alone` list beside `tests/acceptance/968/`; that edit is the implementer's. Delete
Vitest's cache in `tests/acceptance/968-redraft-1830/node_modules/.vite` after a run.

## What each test proves

| Test | Proves |
|---|---|
| `#968.3dca895d budgets.json holds the task canvas-water-flow with the issue's number, compared with the merge base at the lane's margin, and passes the lane's validator` | The budget window compares the issue's number with the merge base: the task, its command, targets `{flow_sheet_gpu_ms: 0.4}`, margin 0.5, criteria `[#968.3dca895d]`, an initialReason naming #968, and `validateBudgets` against the merge base's file. Runs anywhere. |
| `#968.3dca895d a 20 m wide, 30 m sheet of water with flow filling a third of a 1080p frame adds under 0.4 ms of GPU, in five runs` | The sheet with `flow` against the same sheet with `water: {}`, median `gpu_ms` difference per run, five runs after a warm-up, each with its load at start and end, judged by `judgeLimit` against 0.4 ms. |

The timing test first reads the machine with the same judge on five empty readings carrying the load read then, and
times nothing when that isn't PASS. Then `judgeLimit` decides with the five runs' loads (a negative cost read as 0):
PASS passes; FAIL fails; INCONCLUSIVE or BLOCKED fails with a message starting `INCONCLUSIVE:` and its reason, never a
pass. Off macOS it fails `INCONCLUSIVE:` before anything runs. The first run's two sides must draw different pixel
hashes.

## The base run

Not run. The throttled `deep-gpu` build waited in this Mac's build queue (a Mac17,10 on mains, load 300–650 on 18
cores, about 17 other sessions' builds ahead) for over an hour without a slot, so the request was stopped on the
coordinator's call and the run left to them. The file typechecks (`tsc -p tests/acceptance/968-redraft-1830`, exit 0).
Not observed, so not a result: on a Mac loaded past its cores the timing test should fail `INCONCLUSIVE:` before
timing anything, its reason naming the load (`load N at a run's start or end is above the 18 cores`); the budgets.json
test runs as the first draft's does.
