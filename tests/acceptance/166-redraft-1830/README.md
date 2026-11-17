# Blind redraft for #1830: #166's budgets, with the load read at each run's start and end

A blind redraft of `tests/acceptance/166/budgets.test.ts` (criterion 8, `#166.198cb586`), written for #1830 from the
issues, the design and base commit `3557b348` ("Merge pull request #2626 …"). It is to run in the first draft's place:
the same three tests, each name with its ID unchanged, the same criterion, the same scenes, calls and measures against
the issue's limits. The first draft stays as it was, frozen; nothing outside this folder changed.

## Why

Since #1555 the lane's `judgeLimit` (`scripts/benchmark.mjs`) reads INCONCLUSIVE when a call gives no `loads`, one
`{start, end}` per run: the one-minute load average read at that run's start and at its end. The first draft's judge
and gate in `../166/helpers.ts` (`judge`, `timingProblem`) call it with `limit`, `runs` and `fingerprint` only, so both
timing tests read INCONCLUSIVE on every machine, the reference Macs included. This redraft reads `os.loadavg()[0]` right
before and right after each timed run's `deep-gpu` process, as the lane's own runs read it, and passes those five
readings to `judgeLimit` in the runs' order, as the design's timing rule says.

## What was read

- AGENTS.md.
- Issue #1830 and issue #166's body (criterion 8's text, unchanged here).
- `tests/acceptance/166/` at the base: `budgets.test.ts`, `helpers.ts` (its judge, gate and the scene builders this
  file imports), `README.md`, `tsconfig.json`.
- `scripts/benchmark.mjs`: `judgeLimit` (five readings; reference Mac, mains, Low Power Mode off, thermal state nominal;
  `loads` one per run, a reading above the core count or unreadable making it INCONCLUSIVE) and `fingerprint`.
- `docs/technical-design.md`: How we know version 0 works (the timing rule: five runs after warm-up, the margin, and
  the load; The reference Macs) and Dogfooding.

## What the base has

The first draft and the lane's judge as read above; this job read no implementation, and with no base run (below) it
doesn't say what `deep-gpu` or `benchmarks/budgets.json` hold at the base. The first draft's judge gives no loads, so its timings can't pass anywhere. This redraft's judge is its own (`judgeLimit` in a
child process through the first draft's `lane` runner, with `loads`); it imports only scene builders, the build and
the `deep-gpu` runner from `../166/helpers.ts`.

## Run it

```sh
npm ci                                                   # once, in a fresh checkout
export PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
scripts/lease node scripts/throttle.mjs build -- cargo build --locked --bin deep-gpu   # so the file's own build is a no-op
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/166-redraft-1830 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/166-redraft-1830/tsconfig.json
```

The file builds `deep-gpu` once, as the first draft does (`../166/helpers.ts`: `useGpu`). The timings must have the
machine to themselves, so this folder belongs in `scripts/lanes.mjs`'s `alone` list beside `tests/acceptance/166/`;
that edit is the implementer's. Delete Vitest's cache in `tests/acceptance/166-redraft-1830/node_modules/.vite` after a
run.

## What each test proves

| Test | Proves |
|---|---|
| `#166.198cb586 budgets.json holds the task canvas-water with the issue's numbers, compared with the merge base at the lane's margin, and passes the lane's validator` | The perf lane compares the issue's two numbers with the merge base: the task, its command, targets `{lake_gpu_ms: 0.5, waves_vertex_ms: 0.1}`, margin 0.5, an initialReason naming #166, and the lane's `validateBudgets` against the merge base's file. Runs anywhere. |
| `#166.198cb586 a lake filling half a 1080p frame with four waves, ripples and rain adds under 0.5 ms of GPU beside its mirror's own pass, in five runs` | The lake's water against the same plate as a plain mirror, median `gpu_ms` difference per run, five runs after a warm-up, each with its load at start and end, judged by `judgeLimit` against 0.5 ms. |
| `#166.198cb586 a 256 × 256 plate's waves add under 0.1 ms in the vertex stage, in five runs` | The far 256 × 256 plate's waves against the plain mirror plate, the same way, against 0.1 ms. |

Each timing test first reads the machine with the same judge on five empty readings carrying the load read then, and
times nothing when that isn't PASS. Then `judgeLimit` decides with the five runs' loads: PASS passes; FAIL fails; INCONCLUSIVE
or BLOCKED fails with a message starting `INCONCLUSIVE:` and its reason, never a pass. Off macOS a timing test fails
`INCONCLUSIVE:` before anything runs. The first run's two sides must draw different pixel hashes, so each measure sees
what it times.

## The base run

Not run. The throttled `deep-gpu` build waited in this Mac's build queue (a Mac17,10 on mains, load 300–650 on 18
cores, about 17 other sessions' builds ahead) for over an hour without a slot, so the request was stopped on the
coordinator's call and the run left to them. The file typechecks (`tsc -p tests/acceptance/166-redraft-1830`, exit 0).
Not observed, so not a result: on a Mac loaded past its cores each timing test should fail `INCONCLUSIVE:` before
timing anything, its reason naming the load (`load N at a run's start or end is above the 18 cores`), and the
budgets.json test runs as the first draft's does.
