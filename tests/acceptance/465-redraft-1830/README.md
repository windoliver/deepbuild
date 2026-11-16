# Blind redraft for #1830: #465's budgets, with the load read at each run's start and end

A blind redraft of `tests/acceptance/465/budgets.test.ts` (criterion 3, `#465.5d373d2b`), written for #1830 from the
issues, the design and base commit `3557b348` ("Merge pull request #2626 …"). It is to run in the first draft's place:
the same five tests, each name with its ID unchanged, the same criterion, the same stage, looks, calls and measures
against the issue's limits. The first draft stays as it was, frozen; nothing outside this folder changed.

## Why

Since #1555 the lane's `judgeLimit` (`scripts/benchmark.mjs`) reads INCONCLUSIVE when a call gives no `loads`, one
`{start, end}` per run: the one-minute load average read at that run's start and at its end. The first draft's judge
and gate in `../465/helpers.ts` (`judge`, `timingProblem`) call it with `limit`, `runs` and `fingerprint` only, so the
finish's, the flare's and the mirror's timings read INCONCLUSIVE on every machine, the reference Macs included. This
redraft reads `os.loadavg()[0]` right before and right after each timed run's `deep-gpu` process, as the lane's own
runs read it, and passes those five readings to `judgeLimit` in the runs' order, as the design's timing rule says.

## What was read

- AGENTS.md.
- Issue #1830 and issue #465's body (criterion 3's text, unchanged here).
- `tests/acceptance/465/` at the base: `budgets.test.ts`, `helpers.ts` (its judge, gate and the builders this file
  imports), `README.md`, `tsconfig.json`; the indexed test reads `tests/acceptance/465/fixtures/look.json` in place.
- `scripts/benchmark.mjs`: `judgeLimit` and `fingerprint`.
- `docs/technical-design.md`: How we know version 0 works (the timing rule and the load; The reference Macs) and
  Dogfooding.

## What the base has

The first draft and the lane's judge as read above; this job read no implementation, and with no base run (below) it
doesn't say what `deep-gpu` or `benchmarks/budgets.json` hold at the base. The first draft's judge gives no loads, so its three timings can't pass anywhere. This redraft's judge and gate are its own (`judgeLimit` in a child
process through the first draft's `lane` runner, with `loads`); it imports only builders, the build and the `deep-gpu`
runner from `../465/helpers.ts`.

## Run it

```sh
npm ci                                                   # once, in a fresh checkout
export PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
scripts/lease node scripts/throttle.mjs build -- cargo build --locked --bin deep-gpu   # so the file's own build is a no-op
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/465-redraft-1830 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/465-redraft-1830/tsconfig.json
```

The file builds `deep-gpu` once, as the first draft does. The timings must have the machine to themselves, so this
folder belongs in `scripts/lanes.mjs`'s `alone` list beside `tests/acceptance/465/`; that edit is the implementer's.
Delete Vitest's cache in `tests/acceptance/465-redraft-1830/node_modules/.vite` after a run.

## What each test proves

| Test | Proves |
|---|---|
| `#465.5d373d2b budgets.json holds the task canvas-flares-mirrors with the issue's numbers, compared with the merge base at the lane's margin, and passes the lane's validator` | The perf lane compares the issue's four numbers with the merge base: the task, its command, its targets, margin 0.5, an initialReason naming #465, and `validateBudgets` against the merge base's file. Runs anywhere. |
| `#465.5d373d2b the fused finish (print wear, tone curve, screen, grain and vignette) costs under 0.3 ms of GPU a frame at 1080p, in five runs` | The stage under the five finishes against the bare look, median `gpu_ms` difference per run, five runs after a warm-up, each with its load at start and end, judged by `judgeLimit` against 0.3 ms. |
| `#465.5d373d2b a flare costs under 0.3 ms of GPU a frame at 1080p, in five runs` | The stage with a full flare against without it, the same way, against 0.3 ms. |
| `#465.5d373d2b a mirror costs under a quarter of the scene's frame time at 1080p, in five runs` | The floor with `mirror` against without it, as a share of the plain stage's median, the same way, against 0.25. |
| `#465.5d373d2b an indexed look's target is under 1 MB: 320 × 180 at scale 6 with its light target` | `film2d`'s `indexed.target_bytes` is at least one byte per target pixel and under 1,000,000. Bytes, so no load and no judge; runs on any Mac. |

Each timing test first reads the machine with the same judge on five empty readings carrying the load read then, and
times nothing when that isn't PASS. Then `judgeLimit` decides with the five runs' loads (a negative cost read as 0):
PASS passes; FAIL fails; INCONCLUSIVE or BLOCKED fails with a message starting `INCONCLUSIVE:` and its reason, never a
pass. Off macOS each GPU test fails `INCONCLUSIVE:` before anything runs. The first run's two sides must draw different
pixel hashes.

## The base run

Not run. The throttled `deep-gpu` build waited in this Mac's build queue (a Mac17,10 on mains, load 300–650 on 18
cores, about 17 other sessions' builds ahead) for over an hour without a slot, so the request was stopped on the
coordinator's call and the run left to them. The file typechecks (`tsc -p tests/acceptance/465-redraft-1830`, exit 0).
Not observed, so not a result: on a Mac loaded past its cores each of the three timing tests should fail
`INCONCLUSIVE:` before timing anything, its reason naming the load (`load N at a run's start or end is above the 18
cores`); the budgets.json and indexed-bytes tests run as the first draft's do.
