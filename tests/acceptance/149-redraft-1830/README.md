# Blind redraft for #1830: #149's budgets, with the load read at each run's start and end

A blind redraft of `tests/acceptance/149/budgets.test.ts` (AC10, `#149.affd8de8`), written for #1830 from the issues,
the design and base commit `3557b348` ("Merge pull request #2626 …"). It is to run in the first draft's place: the
same three tests, each name with its ID unchanged, the same criterion, the same modes, report checks and measures
against the issue's limits. The first draft stays as it was, frozen; so does `../149-redraft-ac10/`, which holds the
clause on a target's bytes. Nothing outside this folder changed.

## Why

Since #1555 the lane's `judgeLimit` (`scripts/benchmark.mjs`) reads INCONCLUSIVE when a call gives no `loads`, one
`{start, end}` per run: the one-minute load average read at that run's start and at its end. The first draft's own
`judge` calls it with `limit`, `runs` and `fingerprint` only, so the showpiece and paper timings read INCONCLUSIVE on
every machine, the reference Macs included. This redraft passes each run's load to `judgeLimit` in the runs' order,
as the design's timing rule says.

## What was read

- AGENTS.md.
- Issue #1830 and issue #149's body (AC10's text, unchanged here).
- `tests/acceptance/149/` at the base: `budgets.test.ts`, `helpers.ts` (the readers and constants this file imports),
  `README.md` (its "AC10's reports" section gives the report each mode prints), `tsconfig.json`.
- `scripts/benchmark.mjs`: `judgeLimit`, `fingerprint` and `validateBudgets`.
- `docs/technical-design.md`: How we know version 0 works (the timing rule and the load; The reference Macs) and
  Dogfooding.

## The surface under test: two fields added to each report run

The five timed runs are the mode's own, inside one `node benchmarks/canvas.mjs <mode>` process, so only that process
can read the load as each run starts and ends; a reading this test made around the whole process would bracket the
warm-up and all five runs, not each run. So the reports are the first draft's (`../149/README.md`: AC10's reports),
with the two fields the design's rule needs, named as the perf lane names a run's load:

- **Each element of a report's `runs` carries `loadStart` and `loadEnd`**: `os.loadavg()[0]` read by the mode as that
  run starts and as it ends, for `drawn-frames` (one pair per run of all families) and for `paper-cost` (one per run of
  both sides). These are `scripts/benchmark.mjs`'s names: `measureOnce`'s run record carries `loadStart` and
  `loadEnd`, and `judgeTask` gives them to `judgeLimit` as `{start: loadStart, end: loadEnd}`. The tests pass them the
  same way, as `loads` in the runs' order, with the report's `fingerprint`.

A report run missing either field gives `null` for that run, and a value that isn't a finite non-negative number makes
`judgeLimit` read INCONCLUSIVE ("the load at each run's start and end can't be read"), never a pass; the report checks
don't fail on it, so the fields move no verdict but the timing's.

## Dispute

The first version of this redraft read each run's load from a field it chose, `load: {start, end}`. The coordinator
disputed it: the perf lane names a run's load `loadStart` and `loadEnd` (`measureOnce`, lines 137–158; `judgeTask`,
line 394), and `benchmarks/canvas.mjs`'s modes give each report run those two fields, so under the first version every
run's load read `null` and both timings stayed INCONCLUSIVE on every machine. This version reads `{start: loadStart,
end: loadEnd}`, as `judgeTask` does. No test name, criterion, measure or limit changed.

## Run it

```sh
npm ci                                                   # once, in a fresh checkout
export PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
scripts/lease node scripts/throttle.mjs build -- cargo build --locked --release --bin deep-gpu   # the modes time a release deep-gpu
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/149-redraft-1830 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/149-redraft-1830/tsconfig.json
```

Importing `../149/helpers.ts` sets Vitest's timeouts to an hour (`vi.setConfig`), as the first draft has them; each
mode runs once per file, with an hour to finish. The timings must have the machine to themselves, so this folder
belongs in `scripts/lanes.mjs`'s `alone` list beside `tests/acceptance/149/`; that edit is the implementer's. Delete
Vitest's cache in `tests/acceptance/149-redraft-1830/node_modules/.vite` after a run.

## What each test proves

| Test | Proves |
|---|---|
| `AC10 #149.affd8de8 budgets.json has both tasks, with the issue's numbers, the lane's margin against the merge base, and passes the lane's validator` | The perf lane compares both tasks with the merge base: `canvas-drawn-frames` `{frame_gpu_p95_ms: 10, frame_cpu_p95_ms: 4}` and `canvas-paper-cost` `{paper_added_gpu_ms: 0.2}`, their commands, margin 0.5, initialReasons naming #149, and `validateBudgets` against the merge base's file. Runs anywhere. |
| `AC10 #149.affd8de8 each family's fixture, in 2D and 3D at 1080p, plays within the showpiece budget: worst p95 per run, in five runs` | `drawn-frames`' report on any Mac: a release build, five runs, every family's fixture in 2D and 3D at 1920 × 1080 with at least 300 drawn frames. Then the worst family's p95 CPU and GPU per run, judged by `judgeLimit` against 4 ms and 10 ms with each run's load. |
| `AC10 #149.affd8de8 paper adds under 0.2 ms of GPU a frame at 1080p, in five runs` | `paper-cost`'s report on any Mac: the paper fixture, two sides with different pixel hashes, at least 300 drawn frames each. Then paper's median GPU less the flat ground's per run, judged by `judgeLimit` against 0.2 ms with each run's load. |

`judgeLimit` decides: PASS passes; FAIL fails; INCONCLUSIVE or BLOCKED fails with a message starting `INCONCLUSIVE:` and
its reason, never a pass. Off macOS the two timing tests fail `INCONCLUSIVE:` before a mode runs.

## The base run

Not run. The throttled `deep-gpu` build waited in this Mac's build queue (a Mac17,10 on mains, load 300–650 on 18
cores, about 17 other sessions' builds ahead) for over an hour without a slot, so the request was stopped on the
coordinator's call and the run left to them. The file typechecks (`tsc -p tests/acceptance/149-redraft-1830`, exit 0).
Not observed, so not a result: this job didn't read `benchmarks/canvas.mjs`; the coordinator states its modes give
each run `loadStart` and `loadEnd` (Dispute, above). Where a run lacks them, the two timing tests fail `INCONCLUSIVE:`
with "the load at each run's start and end can't be read"; where they carry them, on a Mac loaded past its cores, with
`load N at a run's start or end is above the 18 cores`. The report checks and the budgets.json test run as the first draft's do.
