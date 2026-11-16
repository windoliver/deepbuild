# Blind redraft for #1830: #268's budgets, with the load read at each run's start and end

A blind redraft of `tests/acceptance/268/budgets.test.ts` (criterion 6, `#268.b2dd7e77`), written for #1830 from the
issues, the design and base commit `3557b348` ("Merge pull request #2626 …"). It is to run in the first draft's place:
the same three tests, each name with its ID unchanged, the same criterion, the same scenes, calls and measures against
the issue's limit. The first draft stays as it was, frozen; nothing outside this folder changed.

## Why

Since #1555 the lane's `judgeLimit` (`scripts/benchmark.mjs`) reads INCONCLUSIVE when a call gives no `loads`, one
`{start, end}` per run: the one-minute load average read at that run's start and at its end. The first draft's judge
and gate in `../268/helpers.ts` (`judge`, `timingProblem`) call it with `limit`, `runs` and `fingerprint` only, so its
timing and its bake reading read INCONCLUSIVE on every machine, the reference Macs included. This redraft reads
`os.loadavg()[0]` right before and right after each timed run's `deep-gpu` process, and around the bake's one run, as
the lane's own runs read it, and passes those readings to `judgeLimit` in the runs' order, as the design's timing rule
says.

## What was read

- AGENTS.md.
- Issue #1830 and issue #268's body (criterion 6's text, unchanged here).
- `tests/acceptance/268/` at the base: `budgets.test.ts`, `helpers.ts` (its judge, gate and the scene builders this
  file imports), `README.md`, `tsconfig.json`.
- `scripts/benchmark.mjs`: `judgeLimit` and `fingerprint`.
- `docs/technical-design.md`: How we know version 0 works (the timing rule and the load; The reference Macs) and
  Dogfooding.

## What the base has

The first draft and the lane's judge as read above; this job read no implementation, and with no base run (below) it
doesn't say what `deep-gpu` or `benchmarks/budgets.json` hold at the base. The first draft's judge gives no loads, so its timing can't pass anywhere and its
reading can't count. This redraft's judge and gate are its own (`judgeLimit` in a child process through the first
draft's `lane` runner, with `loads`); it imports only scene builders, the build, the `deep-gpu` runner and the shore
row reader from `../268/helpers.ts`.

## Run it

```sh
npm ci                                                   # once, in a fresh checkout
export PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
scripts/lease node scripts/throttle.mjs build -- cargo build --locked --bin deep-gpu   # so the file's own build is a no-op
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/268-redraft-1830 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/268-redraft-1830/tsconfig.json
```

The file builds `deep-gpu` once, as the first draft does. The timing must have the machine to itself, so this folder
belongs in `scripts/lanes.mjs`'s `alone` list beside `tests/acceptance/268/`; that edit is the implementer's. Delete
Vitest's cache in `tests/acceptance/268-redraft-1830/node_modules/.vite` after a run.

## What each test proves

| Test | Proves |
|---|---|
| `#268.b2dd7e77 budgets.json holds the task canvas-water-shore with the issue's number, compared with the merge base at the lane's margin, and passes the lane's validator` | The perf lane compares the issue's number with the merge base: the task, its command, targets `{shore_lake_gpu_ms: 0.5}`, margin 0.5, an initialReason naming #268, and `validateBudgets` against the merge base's file. Runs anywhere. |
| `#268.b2dd7e77 a lake filling half a 1080p frame with shore on still adds under 0.5 ms of GPU beside its mirror's own pass, in five runs` | #166's lake with twelve piles, a quay and a deck as its shore against the same plate and items as a plain mirror, median `gpu_ms` difference per run, five runs after a warm-up, each with its load at start and end, judged by `judgeLimit` against 0.5 ms. |
| `#268.b2dd7e77 the field's bake time is recorded as a reading` | The same lake drawn once with `shore: true`: its row's `bake_ms` is above 0 and printed with the load at that run's start and end; it counts only when the same judge, given that run's load, reads the machine fit, and is `INCONCLUSIVE:` otherwise. |

The timing test first reads the machine with the same judge on five empty readings carrying the load read then, and
times nothing when that isn't PASS. Then `judgeLimit` decides with the five runs' loads: PASS passes; FAIL fails;
INCONCLUSIVE or BLOCKED fails with a message starting `INCONCLUSIVE:` and its reason, never a pass. Off macOS each GPU
test fails `INCONCLUSIVE:` before anything runs. The first run's two sides must draw different pixel hashes.

## The base run

Not run. The throttled `deep-gpu` build waited in this Mac's build queue (a Mac17,10 on mains, load 300–650 on 18
cores, about 17 other sessions' builds ahead) for over an hour without a slot, so the request was stopped on the
coordinator's call and the run left to them. The file typechecks (`tsc -p tests/acceptance/268-redraft-1830`, exit 0).
Not observed, so not a result: on a Mac loaded past its cores the timing test should fail `INCONCLUSIVE:` before
timing anything and the bake reading should print, then fail `INCONCLUSIVE:`, each reason naming the load (`load N at
a run's start or end is above the 18 cores`); the budgets.json test runs as the first draft's does.
