# Acceptance tests for #1899: frame budget runs — five runs a verdict, unresolved frames never PASS, and the ladder held at its base rung

Written first, from issue #1899 (its scope, the Frame budget fields and "It can never" line, its four acceptance
criteria and its proof line), its parent #404, its Oracle page (`doneright/oracles/issues/1899.md`: no upstream test
checks any of the four criteria, so none is ported), the design sections it links and those they lean on, and base
commit `d51be2c3` ("Merge pull request #2108 …"), by a job that never saw an implementation; none existed. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding).

What was read:

- `docs/technical-design.md`: Document check (timing and frame budget among its kinds); Every task carries its own
  budgets (a frame-time limit stated at p95 gates, over every frame of a run of at least 300; a timing result from
  five runs after warm-up, PASS when all five are within, FAIL when all five are over by more than the margin, the
  larger of 5% and the five runs' spread, otherwise INCONCLUSIVE with all five attached); the platform seam's feature
  table (pass timestamps or the CPU fallback).
- `docs/canvas-primitives.md`: What holds a document to its rules; Check input (`render: {seconds, pixels, theme,
  reduced_motion}`, `document.frame_time` among the core's kinds); **Frame budget** (`machines: same`, so INCONCLUSIVE
  on any other; each frame's GPU reading only from its own resolved pass timestamps; unresolved, zero, reversed or
  from work submitted before a device loss is invalid and never filled from another frame; the percentile passes only
  if it holds with every invalid frame counted as over budget and fails only if it fails with them counted as within,
  otherwise BLOCKED naming the frames and why; on an adapter without pass timestamps a GPU-time limit is BLOCKED naming
  the feature and the CPU encode fallback is never compared with it; "It can never" count a degraded frame as within
  budget); Meter and degrade ladder (the rungs, 30 frames down, canonical renders never step down or climb, CPU encode
  time reported as the fallback); the budget class table as `crates/deep-canvas/src/budget.rs` holds it (showpiece:
  10 ms GPU, 4 ms CPU).
- Issues #404 (the parent; siblings #1897, #1901 and #1903 are other pull requests), #379 (the meter and the ladder).
- At the base: AGENTS.md; `tests/acceptance/379/` (README, helpers, `canonical.test.ts`, `ladder.test.ts`: the
  README this one follows, and its "Not tested" line naming "the frame-budget check kind's five-run judgment",
  which is this issue), `377/`, `1413/` (#377's `lose_device`, the `test-faults` events); `crates/deep-gpu`
  (`meter.rs`: `Rung`, `Ladder`, `covered`, `charges`; `device.rs`: `Timestamps`, `force_loss`; `seam.rs`: the
  feature `timestamps`), `crates/deep-gpu-layer` (`main.rs`: `deep-gpu run`, its calls and `--planted`, the
  `test-meter` feature; `live.rs`: the `live` call's `stub_meter`, `canonical` with purpose `frame_budget`;
  `timing.rs`), `crates/deep-canvas/src/budget.rs`, `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`, the
  reference Macs and their conditions).

What the base already does and these tests don't credit: #379's meter reads pass timestamps and charges covered
time; its ladder steps a live view; `canonical` with purpose `frame_budget` renders one frame at the class's base
rung; #377 forces a device loss; `--withhold timestamps` withholds the feature on a real device;
`scripts/benchmark.mjs` judges a perf-lane limit on five runs. There is no frame-budget run: no warm-up and five
timed runs of a document against its class, no invalid readings, no worst-case rule over them, no five-run verdict in
the check, no environment rule, no fallback rule, and no stub that breaks a frame's timestamps or seeds a timer. So
these tests define the surface below.

## Run them

They build `deep-gpu` with `test-meter`, as #379's suite does, so they run with `--no-file-parallelism`, and
`scripts/lanes.mjs` needs this folder in its `alone` list beside `tests/acceptance/377/` and `379/`. This README is
the instruction; the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/1899 --no-file-parallelism
npx tsc -p tests/acceptance/1899/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Every file first builds `cargo build --locked --bin deep-gpu --features test-meter` once (cargo on `PATH`), copies
the binary out of `target/debug` into a temporary folder, and fails each test if the build failed. Each test writes
into its own temporary folder and deletes it. Every test runs `deep-gpu run --backend noop` on the stub meter or the
stub timer, the virtual clock and a stubbed environment fingerprint, so it reads no device timing and no fact of this
machine: the suite passes or fails the same on any Mac, with no reference Mac and no gate on power, Low Power Mode,
thermal state or load (the owner's rule). A run with `--root tests/acceptance/1899` leaves Vitest's cache in
`tests/acceptance/1899/node_modules/.vite`; delete it. `BASE-FAILURE.txt` says what each test gets at the base.

## The surface under test

The issue names a frame-budget run, a test meter, a stub timer, environment fingerprints and three wrong programs,
but no code API. So these tests define the smallest surface they need on a binary that exists: **one new call on
#377's `deep-gpu run`, `frame_budget`**, three stub fields on it that only the `test-meter` build holds, and three
more `--planted` names. No new binary. Every name below that the issue or design doesn't give is this job's choice;
the implementer builds exactly these, or a dispute goes to a blind redraft.

#377's JSON-lines protocol holds unchanged: one scenario `{"out": dir, "calls": [Call]}` per stdin line, answered
with exactly one line `{"ok": true, "replies": [Reply]}`, one reply per call in order, then exit 0; a call missing a
required field, or carrying one its build doesn't hold, is answered `{"code": "bad_input", …}`; an unknown
`--planted` name answers one `{"ok": false, "code": "bad_input"}` line and exits 2. All tests start
`deep-gpu run --backend noop [--planted <name>]`.

### The `frame_budget` call

```json
{"call": "frame_budget", "look": look@1, "writer": "<kind>:<id>", "doc": path,
 "render": {"seconds": s, "pixels": [w, h]}, "fps"?: 60, "warmup"?: 60,
 "report"?: ["frames"],
 "stub_meter"?: StubMeter, "stub_timer"?: StubTimer, "stub_environment"?: Fingerprint}
```

The document check's frame-budget run, as the check makes it (Frame budget). `doc` is a JSON file holding the
document as `writer` sends it (#393's deep_show payload, as #379's `live` and `canonical` take it); it is checked as
that writer's revision, and a refused one is answered `{"code": "refused", "issues": [Issue]}`. The run renders it
headless, off the UI thread, at `render.pixels`, at its budget class's base rung, the way a canonical render does:
first `warmup` frames (run 0, untimed), then five timed runs (runs 1–5) of n = `render.seconds` × `fps` frames each.
Each run's frames are numbered **0 … n − 1**, frame k at t = k ÷ `fps`. The meter reads each frame's GPU time from
that frame's own pass timestamps (the time they cover) and its CPU time on the canvas core's threads, and the check
judges the five runs against the document's class (its `budget.class`, as its `budget` caps tighten it). The check
input's other render fields, `theme` and `reduced_motion`, may be taken; no test sets them.

It answers a **Result**:

```json
{"verdict": "PASS" | "FAIL" | "BLOCKED" | "INCONCLUSIVE",
 "limits": {"gpu": Limit, "cpu": Limit},
 "fallback": null | {"source": "cpu_encode", "runs": [{"p95_ms": ms}]},
 "frames"?: [{"run": 0..5, "frame": k, "rung": rung, "gpu_ms": ms | null,
              "invalid": "unresolved" | "zero" | "reversed" | "device_lost" | null}]}
Limit = {"limit_ms": ms, "verdict": "PASS" | "FAIL" | "BLOCKED" | "INCONCLUSIVE",
         "runs": [{"p95_ms": ms | null, "invalid": [{"frame": k, "why": "unresolved" | "zero" | "reversed" | "device_lost"}]}],
         "margin": fraction | null, "missing": feature | null}
```

- `limits.gpu` and `limits.cpu`: the class's frame GPU and CPU limits (`limit_ms`; a showpiece's are 10 and 4) and
  each one's verdict, with the five timed runs attached in order (`runs`, run 1 first).
- A run's `invalid`: the frames of that run whose GPU reading is invalid, in frame order, each with why:
  `unresolved` (its pass timestamps never resolved), `zero`, `reversed` (an end timestamp before its start) or
  `device_lost` (work submitted before a device loss). An invalid reading is never filled from another frame.
- A run's `p95_ms`: the nearest-rank 95th percentile (the ⌈0.95 n⌉-th smallest) of its n frames' readings with every
  invalid frame counted as over budget, above every reading; `null` when that rank falls on an invalid frame.
- `missing`: the feature a limit can't be measured without (`"timestamps"`), else null.
- `fallback`: when the adapter has no pass timestamps, each timed run's p95 of the CPU encode times the meter reports
  instead, marked `cpu_encode`; null otherwise.
- `frames` (`report: ["frames"]`): the meter's log, one row per frame the run drew, warm-up first, in order: the rung
  it was drawn at, its GPU reading (null when invalid or with no pass timestamps) and why it is invalid.

**The judgment.** For each limit:

1. On an adapter without pass timestamps, the GPU limit is `BLOCKED` with `missing: "timestamps"`, `runs: []` and
   `margin: null`; the CPU encode times go to `fallback` and are never compared with any limit.
2. A run **holds** when its p95, with every invalid frame counted as over budget, is within the limit (≤). It is
   **over** when its p95, with every invalid frame counted as within (below every reading), exceeds the limit. A run
   that neither holds nor is over is **undecided**: its invalid frames decide it.
3. `PASS` when all five runs hold. `FAIL` when all five are over by more than the margin: each run's p95, invalid
   frames counted as within, above limit × (1 + margin), where `margin` is the larger of 0.05 and those five p95s'
   spread (largest less smallest) as a fraction of the limit. Otherwise `BLOCKED` when any run is undecided, naming
   its frames and why in `invalid`. Otherwise `INCONCLUSIVE`, with all five attached.
4. `machines: same`: unless the environment is a reference Mac's, a limit that step 3 would PASS or FAIL is
   `INCONCLUSIVE`, its runs still attached; a BLOCKED limit stays BLOCKED. The environment is a reference Mac's when
   its `model`, `chip` and `memoryBytes` are one of the reference Macs `scripts/benchmark.mjs` lists (Mac15,7,
   Mac15,12, Mac17,10) and it is in that file's conditions: `power: "ac"`, `lowPowerMode: false`, `thermalState:
   "nominal"`, and a `macosBuild`.

The Result's `verdict`: `FAIL` when either limit fails, else `BLOCKED` when either is blocked, else `INCONCLUSIVE`
when either is, else `PASS`.

### Stubs (`test-meter` only)

The `test-meter` build (#379's feature) holds these fields; the shipped build answers each with `bad_input`. A call
carries at most one of `stub_meter` and `stub_timer`.

**`stub_meter`**, the test meter: the run renders as above, and the stub stands in for the device's pass timestamps
and the frames' CPU readings, whatever the device has (noop has none of its own).

```json
{"timestamps"?: true,
 "frames": [{"from": k, "to"?: k2, "gpu_ms": ms, "by_rung"?: {rung: ms}, "cpu_ms"?: 0, "cpu_encode_ms"?: 0}],
 "unresolved"?: [k], "reversed"?: [k],
 "lose_device"?: {"frame": k, "in_flight": n}}
```

- `frames`: for frames `from` to `to` (to the run's end when absent) of every run, warm-up included, the frame's
  passes cover `gpu_ms` of GPU time: its pass timestamps are written that far apart. At a rung `by_rung` lists, they
  cover that rung's value instead. `cpu_ms` is the frame's CPU reading, and `cpu_encode_ms` the CPU encode time the
  meter would report as the fallback. A later entry overrides an earlier one for the frames both cover; a frame no
  entry covers makes the call `bad_input`.
- `unresolved`: in each timed run, those frames' pass timestamps never resolve; the frame still took its `gpu_ms`.
- `reversed`: in each timed run, those frames' end timestamp is written before their start.
- `lose_device`: in each timed run, the device is lost (#377's forced loss) right after frame `frame` is submitted,
  while it and the `in_flight − 1` frames before it are unfinished, so those frames' readings come from work submitted
  before the loss; the run reopens the device and goes on from frame `frame + 1`. `{"frame": 300, "in_flight": 2}`
  leaves frames 299 and 300 in flight.
- `timestamps: false`: the stub is an adapter without pass timestamps (the GPU seam's feature `timestamps` absent, as
  `--withhold timestamps` makes a real device): no frame has pass timestamps, and the meter reports each frame's
  `cpu_encode_ms` as its fallback.

Everything the meter, the ladder and the check do from these readings is the real meter's, ladder's and check's (with
`--planted`, the planted one's).

**`stub_timer`**, the stub timer: `{"p95_ms": ms, "spread_ms": ms, "seeds": [integer]}`. Nothing is drawn. For each
seed, the check judges five runs whose readings are the stub's: run r's every frame reads `p95_ms + d` ms of GPU and
0 ms of CPU, d drawn uniformly in [−`spread_ms`, +`spread_ms`] by a generator seeded from the seed and r, so run r's
p95 is `p95_ms + d`; the same seed gives the same draws, and different seeds give independent ones. The call answers
`{"seeds": [{"seed": s, …Result}]}`, one Result per seed in the order given, without `frames`.

**`stub_environment`**, the environment the run is judged under: a fingerprint of the shape `scripts/benchmark.mjs`'s
`fingerprint()` returns, `{"model", "chip", "memoryBytes", "power": "ac" | "battery", "lowPowerMode",
"thermalState", "macosBuild"}`. With it the check reads nothing of this machine's environment (no fingerprint,
power, thermal state or load); without it, it reads this machine's as `fingerprint()` does.

### Planted programs (`deep-gpu run --planted <name>`, each reachable only there)

| Name | The wrong program | Criterion |
|---|---|---|
| `repeats_last_reading` | The meter gives a frame whose pass timestamps never resolve the last resolved frame's reading, as a valid one | 38e30b39 (issue-named) |
| `drops_unresolved_frames` | The check leaves unresolved frames out of the percentile: a run's p95 is over its resolved frames alone | 38e30b39 (issue-named) |
| `ladder_acts_in_budget_run` | The run's frames are drawn at the rung the live degrade ladder gives the session, stepping on the meter's readings as a live view's does, warm-up included | 3bcb7572 (issue-named) |

Every build takes the names, as #379's; the tests run them on the `test-meter` build, with the stubs.

## Fixtures

- `fixtures/look.json`: #379's acceptance look, copied.
- The document is generated by `helpers.ts`'s `showpiece`: a camera and four 1 m boxes drawn by scene3d, at
  320 × 240, `budget.class` showpiece, `requires.modules` naming scene3d, and a channel that slides a box over the
  60 s span so every frame draws.
- `stub_environment` stand-ins (`helpers.ts`): the reference Mac, Mac15,7 (Apple M3 Pro, 36 GiB) on mains power with
  Low Power Mode off, thermal state nominal and a macOS build; another machine, Mac14,6 (Apple M2 Max, 64 GiB), in
  the same conditions; and the reference Mac on battery.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the
leading `- [ ] ` dropped, computed with #607's command (as #305's README gives it) with the issue's four criterion
lines on stdin. Each test's name starts with its criterion's ID. Where a criterion names a wrong program, the test
runs it through `--planted` and asserts it fails the way the criterion says; where it names none, the test's twin
shows the check can fail.

| ID | Criterion (the issue's text) | Tests, what each asserts, and the wrong programs |
|---|---|---|
| `#1899.f1c79d5d` | A frame over budget fails with its timing | `over-budget.test.ts`: a showpiece whose every frame takes 14 ms of GPU, five runs of 300 frames under the reference Mac: FAIL, its GPU limit FAIL against `limit_ms` 10, each run's p95 14 ms attached, margin 0.05, no invalid frame. Twin: the same at 3 ms a frame PASSes (p95 3 ms) |
| `#1899.38e30b39` | A frame-budget run of 600 showpiece frames at 3 ms of GPU each uses a test meter that leaves frames 560 to 599 unresolved and gives frame 100 an end timestamp before its start: frame 100 counts as invalid and is named, and where frames 560 to 599 actually took 14 ms the check is BLOCKED, naming those 40 frames and unresolved, since counting them as over budget fails the 10 ms p95 and counting them as within passes it; it is never PASS. With frame 100 valid and frames 560 to 599 at 3 ms, 20 of them unresolved and a forced device loss at frame 300 that leaves the 2 frames then in flight invalid, the check passes, because the p95 holds with all 22 counted as over budget. A planted meter that repeats the last resolved reading, or a check that drops unresolved frames from the percentile, passes the first run and fails this criterion, naming frame 560. On a test adapter without pass timestamps the GPU limit is BLOCKED, naming the feature, and the CPU encode time reported as the fallback is never compared with it | `invalid-frames.test.ts`, five runs of 600 frames under the reference Mac. First run (frames 560–599 took 14 ms and are `unresolved`, frame 100 `reversed`): never PASS; the check and its GPU limit BLOCKED; in every run the log reads null for frames 560–599 (`unresolved`) and 100 (`reversed`), `invalid` is exactly frame 100 reversed and frames 560–599 unresolved, and `p95_ms` is null. Second run (3 ms, frames 560–579 unresolved, `lose_device` at 300 with 2 in flight): every run's `invalid` is exactly frames 299 and 300 `device_lost` and 560–579 `unresolved`, p95 3 ms, the GPU limit and the check PASS. `repeats_last_reading` and `drops_unresolved_frames` each PASS the first run and fail its check, naming frame 560. Without timestamps (`timestamps: false`) and CPU encode at 3 ms and at 14 ms: the GPU limit BLOCKED, `missing` `timestamps`, no p95 of its own, the fallback `cpu_encode` with five runs at 3 / 14 ms, the check BLOCKED both times |
| `#1899.40e3ec20` | A stub timer whose p95 is drawn around 9.9 ms ± 0.2 against a 10 ms limit gives no FAIL over 1,000 seeds, only PASS or INCONCLUSIVE with the five runs attached, while stubs at 8 ms and 12 ms give PASS and FAIL every time; and a frame budget run under another machine's environment fingerprint, or on battery, is INCONCLUSIVE, never PASS or FAIL | `five-runs.test.ts`: one process, three calls, seeds 1–1,000 each, under the reference Mac. At 9.9 ± 0.2: no FAIL, only PASS or INCONCLUSIVE; each seed's five runs attached and within 9.9 ± 0.2, its verdict and margin the design's rule on those five; the draws reach below 9.8 and above 10. At 8 ± 0.2 every seed PASSes, at 12 ± 0.2 every seed FAILs, each judged the same way. The showpiece on the stub meter at 3 ms and at 14 ms (the PASS and FAIL of `over-budget.test.ts`) under Mac14,6's fingerprint, and under the reference Mac's on battery: INCONCLUSIVE, the GPU limit too, the five runs attached at 3 / 14 ms |
| `#1899.3bcb7572` | A frame-budget run of a showpiece whose passes take 14 ms of GPU at p95 FAILs with the ladder free to act, the meter's rung log showing the base rung on every frame; a planted run that lets the ladder step to 30 Hz reports p95 under 10 ms and fails this criterion, naming the rung | `ladder.test.ts`: the showpiece's passes cover 14 ms at every rung but `30hz`, where they cover 7 ms; 150 warm-up frames, five runs of 300, under the reference Mac: FAIL, each run's p95 14 ms, a log row for every frame of the warm-up and the five runs, each at `base`. `ladder_acts_in_budget_run` reports every run's p95 under 10 ms and fails the rung check, naming `30hz` |

## Readings where the issue and design leave a choice

- **One call for the run.** The frame-budget run is the canvas core's GPU side, which #377's `deep-gpu` drives
  headless; `frame_budget` is one more call there, beside #379's `canonical` (whose `frame_budget` purpose renders one
  frame). The whole check runs in it: warm-up, five runs, the meter, the judgment.
- **Frame numbers.** A run's frames are numbered from 0, so "frames 560 to 599" are the last 40 of a 600-frame run
  (10 s at 60 fps), and "frame 100" and "frame 300" use the same numbers. (#379's `live` numbers from 1; this call has
  its own run.) "600 showpiece frames" is each of the five runs; the stub's faults land on the same frames in every
  run, so all five agree.
- **"Actually took 14 ms".** The stub's frames 560–599 take 14 ms, which a meter that resolved them would read. That
  is what makes the two planted programs the wrong ones: they read 3 ms for those frames, or nothing, and pass.
- **"20 of them unresolved"** are frames 560–579. **"The 2 frames then in flight"** are frames 299 and 300: the stub
  loses the device right after frame 300 is submitted with those two unfinished. Which frames a real queue holds in
  flight depends on its depth, so the stub fixes them and the test names them exactly.
- **Counting invalid frames.** "Over budget" places them above every reading and "within" below every reading, both in
  the run's count, so a check that leaves them out of the count is the planted `drops_unresolved_frames`. Where a run
  is undecided by its invalid frames the check is BLOCKED; INCONCLUSIVE is left for runs the five-run rule can't
  decide on valid readings. `p95_ms` is null when, counted over budget, the percentile falls on an invalid frame,
  which is what "counting them as over budget fails the 10 ms p95" reads as in the first run.
- **"Passes the first run".** The first of the criterion's two runs (frames 560–599 unresolved): each plant's verdict
  is PASS there, and the criterion's check fails on it with a sentence naming frame 560.
- **"A test adapter without pass timestamps"** is the stub's `timestamps: false`: the noop backend never has the
  feature, and `--withhold timestamps` acts only on a real device, so the stub stands in for the adapter. "Never
  compared" is read through two fallbacks, 3 ms (which would pass 10 ms) and 14 ms (which would fail it): both leave
  the GPU limit and the check BLOCKED. "Naming the feature" is `missing: "timestamps"`, the GPU seam's feature name.
- **"Drawn around 9.9 ms ± 0.2"** is uniform within ± 0.2 ms of 9.9, per run and seed, and every frame of a run reads
  its draw, so the run's p95 is the draw. Read as a standard deviation instead, a FAIL is still out of reach (FAIL needs
  all five above 10.5 ms). The 8 ms and 12 ms stubs draw with the same ± 0.2 over the same 1,000 seeds ("every time").
  Beyond "no FAIL", each seed's verdict is checked against the design's rule on its own five attached runs, so a check
  that decides on anything else fails on the draws it gets, and the draws must vary (below 9.8, above 10).
- **The environment.** "Another machine's environment fingerprint" is Mac14,6 (Apple M2 Max), none of the reference
  Macs, otherwise in the reference conditions; "on battery" is the reference Mac's fingerprint with `power: "battery"`.
  The reference Macs and conditions are `scripts/benchmark.mjs`'s; its load check is the perf lane's and isn't in the
  fingerprint. Since `machines: same` makes every verdict off a reference Mac INCONCLUSIVE, every PASS and FAIL here is
  under the stubbed reference Mac, and no test reads this machine.
- **"With the ladder free to act".** Nothing in the call turns the ladder off or asks the run to hold its rung; the
  run is the check's own render at the class's base rung, as canonical renders are ("never step down or climb"). The
  stub's 14 ms is over the showpiece's 10 ms on every frame, which steps a live view down every 30 frames (#379); the
  planted run is that ladder let loose. Its readings under 10 ms at 30 Hz are the false pass the criterion guards
  against: at every other rung the stub reads 14 ms, so the planted ladder steps down to 30 Hz and stays, and 150
  warm-up frames give its four steps room before the first timed frame, so all five runs report 7 ms.
- **"The meter's rung log"** is the `frames` report, warm-up included; "naming the rung" is a sentence for each rung
  other than base the log shows, so the planted run's names `30hz` (and the rungs it passed through).
- **"A frame over budget fails with its timing"** is a run whose frames are over the class's limit: the design judges
  p95s, and one slow frame among 300 can't move one, so all five runs' frames are over by more than the margin and
  the FAIL carries each run's p95, the limit and the margin.
- **CPU.** The stubs give every frame 0 ms of CPU, so the CPU limit (4 ms) passes under the reference Mac and never
  decides a verdict here; the criteria are about the GPU limit. The Result's `verdict` still takes both limits.
- **Run length.** Where a criterion names no frame count, a run is 5 s, 300 frames, the design's floor for a
  frame-time p95; at 320 × 240, since the stubs decide every reading.

Not tested, because no criterion asks or the surface can't reach it: `still` (no frame drawn while nothing moves),
`allocations` (0 after warm-up), never running on the UI thread, the GPU lease, the `zero` reading, `theme` and
`reduced_motion`, the run on a real device's timestamps and this machine's own fingerprint, the CPU limit's own
judgment, the shipped build's refusal of the three stubs, and the combined envelope (#1903).

## Upstream tests (the Oracle lane)

The Oracle page says no upstream test checks any of the four criteria (frame budgets, the worst-case rule over
invalid frames, the verdict logic in the noise band and the rung log are this project's rules); these tests are their
local proof.
