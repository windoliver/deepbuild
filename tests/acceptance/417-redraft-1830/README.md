# Blind redraft of #417's budgets (AC5) that reads the load at each run's start and end (#1830)

AC5: "Budgets, on the reference Mac in the local preflight, compared with the merge base: switching looks takes under
100 ms, and every look stays within the canvas frame budget on its fixture film." Written from issue #1830, issue #417,
the design and base `3557b348`, by a job that never saw #1830's implementation or any other redraft of it.
`budgets.test.ts` here runs in place of `tests/acceptance/417/budgets.test.ts`; once it lands, that first draft stops
running (the swap is the implementer's). Nothing here edits a test: a dispute goes to a blind redraft (design:
Dogfooding).

## Why a redraft

Since #1555, `judgeLimit` (`scripts/benchmark.mjs`) reads INCONCLUSIVE when a call gives no `loads`: one `{ start, end }`
per run, the one-minute load average (`os.loadavg()[0]`) read at that run's start and at its end. The first draft holds
the function in a variable (`const limit = await judgeLimit(); limit({...})`) and calls it with `limit`, `runs` and
`fingerprint` only, so both judged tests read INCONCLUSIVE on every machine, a fit reference Mac included. This draft
gives `judgeLimit` each run's load. No criterion text, test name or limit changes.

## What was read

- Issue #1830 (the dispute, its scope and criteria) and issue #417 (Scope, Fields, the ten criteria, Proof).
- `docs/technical-design.md`: How we know version 0 works (Dogfooding), Numbers version 0 has to hold (Every task carries
  its own budgets: five runs after warm-up, the margin; The reference Macs). `AGENTS.md`.
- At the base: `tests/acceptance/417/budgets.test.ts` (the first draft), its `helpers.ts`, `README.md` (AC5's reports)
  and `BASE-FAILURE.txt`; `scripts/benchmark.mjs` (`judgeLimit`, `fingerprint`, `measureOnce`'s `loadStart` and
  `loadEnd`); `benchmarks/budgets.json`'s two #417 entries; and `benchmarks/canvas.mjs`, searched only for whether its
  `look-switch` and `look-frames` reports carry a load per run.

## What the base has

At `3557b348` #417 is built: `benchmarks/budgets.json` has `canvas-look-switch` and `canvas-look-frames`, and
`benchmarks/canvas.mjs` has both modes, each printing the report the first draft's README sets out. Neither report's
runs carry a load reading: `benchmarks/canvas.mjs` never reads `os.loadavg()`. The reference Macs in
`scripts/benchmark.mjs` are three, the Mac17,10 among them.

## Where the load is read

The first draft's runs aren't taken by the test: each mode of `benchmarks/canvas.mjs` takes a warm-up and five runs in
one process and reports them. A load read by the test around that process would bracket all five runs and the
warm-up, not each run. So the readings are taken where the runs are taken, in the bench, and the report carries them.
This draft adds one thing to each report's surface (the first draft's README, AC5's reports):

- every element of `runs`, in both `look-switch` and `look-frames`, gains `loadStart` and `loadEnd`: the one-minute load
  average, `os.loadavg()[0]`, read by the bench at that run's start and at its end, as `scripts/benchmark.mjs`'s
  `measureOnce` names them for the perf lane's runs.

The test passes them to `judgeLimit` as `loads`, `{ start: loadStart, end: loadEnd }` per run in the report's order. A
reading that is missing or not a number is passed as `null`, which `judgeLimit` reads as "the load at each run's start
and end can't be read": INCONCLUSIVE, never PASS. The non-timing tests don't read the load, so a report without it still
passes them.

## The tests

`budgets.test.ts`, six tests, named as the first draft's, under the describe
`#417 AC5 budgets on the reference Mac, compared with the merge base: a look switch under 100 ms, every look within the frame budget on its fixture film`.
Each runs a mode once (cached per mode and plant) through the #417 suite's helpers (`../417/helpers.ts`, frozen), with
the first draft's checks unchanged:

| Test | What it proves |
|---|---|
| `AC5 budgets.json has canvas-look-switch and canvas-look-frames, each with the issue's targets, the lane's 50% margin against the merge base, and passes the lane's validator against the merge base's budgets` | the perf lane's merge-base comparison has its two tasks, with the issue's numbers, valid by `validateBudgets` |
| `AC5 look-switch times every switch between shipped looks on the fixture film until the new look is on screen` | every ordered pair of shipped looks is switched in every run, and each switch stops on the new look's ground |
| `AC5 the measure sees the new look: a clock that stops at the request (planted stops_at_request) fails the check above` | the check above catches a clock that stops before the new look is drawn |
| `AC5 switching looks takes under 100 ms: each run's slowest switch, in five runs` | judged: each run's slowest switch against 100 ms, with each run's load |
| `AC5 look-frames plays each shipped look's fixture film for at least 300 frames, every frame drawn and timed` | every shipped look plays its own fixture film, 300 frames or more, each drawn and timed |
| `AC5 every look stays within the figure class's frame budget on its fixture film: p95 GPU and CPU ms a frame, worst look per run, in five runs` | judged: the worst look's p95 GPU (2 ms) and CPU (4 ms) a frame per run, with each run's load |

The judge, in both judged tests: `judgeLimit` with the report's runs, the report's own `fingerprint` and each run's
`loads`. PASS passes; FAIL fails, naming the runs and the loads; INCONCLUSIVE (off a reference Mac, not on mains, Low
Power Mode on, the thermal state not nominal, the macOS build missing, or a run's load above the core count or
unreadable) or BLOCKED skips as INCONCLUSIVE with its reason, the #417 suite's way. A skip is never a pass.

## Run it

They build cargo binaries, so they run one file at a time (the first draft's README: Run them). macOS only for the
window the modes play in.

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:/opt/homebrew/opt/rustup/bin:$PATH"
npm ci                                                       # once
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease node scripts/throttle.mjs build -- cargo build --locked --bin deep-canvas-render
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/417-redraft-1830 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/417-redraft-1830/tsconfig.json
```

The modes build what they time with `--release`. Delete `tests/acceptance/417-redraft-1830/node_modules/.vite` if
Vitest leaves one.

## The base run

Not run. On 2026-11-15 this job's Mac (a Mac17,10, on mains, at a one-minute load of 300 to 600 from other sessions'
work) held its build request in `scripts/throttle.mjs`'s build queue for hours: `cargo build --locked --bin
deep-canvas-render` and the release `deep-gpu` the modes time never got a slot, so the request was stopped and the suite
handed on unrun. `node node_modules/typescript/bin/tsc -p tests/acceptance/417-redraft-1830/tsconfig.json` exits 0.

What a run on the base should show, from the code and not seen: the four non-timing tests as the first draft's (#417 is
built at the base), and both judged tests skipping as INCONCLUSIVE with "the load at each run's start and end can't be
read: [{"start":null,"end":null}, ...]", since the base's bench records no load; once it does, at this Mac's load,
"load N at a run's start or end is above the 18 cores".

## What this doesn't settle

- It hasn't run at all yet (The base run), so no result of any of its six tests has been seen from this file.
- At the base the bench records no load, so the judged tests read INCONCLUSIVE on any machine until `benchmarks/canvas.mjs`
  adds `loadStart` and `loadEnd` to each run of both modes; that edit is the implementer's, not this folder's.
