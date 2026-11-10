# Acceptance tests for #1903: the combined envelope — every pass on at once, a baseline whose limits you set, and input on screen within 2 frames

Written first, from issue #1903 (its Scope, its Frame budget fields and "It can never" line, its eight acceptance
criteria, its Proof line and its Oracle note, which says no upstream test checks these criteria), its dependency #1899
and its parent #404, the design sections it links and those they lean on, and base commit `f38d2b39` ("Merge pull
request #2155 …"), by a job that never saw an implementation; none existed. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- `docs/technical-design.md`: Document check (timing and frame budget among its kinds); Every task carries its own
  budgets (a p95 frame-time limit gates, over every frame of a run of at least 300; five runs after warm-up; PASS when
  all five are within, FAIL when all five are over by more than the margin, the larger of 5% and their spread, else
  INCONCLUSIVE; a budget's value comes from its issue, and an estimate may be moved once by a measurement); The
  reference Macs (three; a timing or memory budget counts only on one of them on mains power, Low Power Mode off,
  thermal state nominal, and anywhere else is a reading); Dogfooding and Tests written first.
- `docs/canvas-primitives.md`: the budget class table (showpiece: 10 ms of GPU full screen on the reference Mac's
  display, 4 ms of CPU, 256 MB per window; "only you raise a class's caps"); The cost model (cold timings from opening a
  document in a fresh process to its first settled frame, kept as readings until a budget names a limit); What holds a
  document to its rules (issues as data; a check of a deliverable the base doesn't have fails); **Frame budget** (its
  fields, `envelope: {scene: every pass on at once, run: s = 60, report: […], baseline: the first run's report on the
  reference Mac, limits: your decision}`, the semantics from "Its combined envelope plays full screen…" to "…created in
  each frame after the first", and "It can never"); the render worker (a batch's `draw_key`, replay, Dirty classes);
  Material (one pipeline per feature set: pattern, alpha mode, transmission, unlit, ink; values in a material buffer
  indexed per instance); Compile, validate and cache (the warm-up at check enumerates every reachable feature set); One
  word per idea (`look`).
- Issues #1903, #1899 (merged at the base, with its suite), #404.
- At the base: AGENTS.md; `tests/acceptance/1899/` (the README, helpers and tests this suite follows: `frame_budget`, its
  stub meter and stub environment, `machines: same`, the criterion-ID command), `379/` (`live`, the stub meter's pass
  intervals, `test.gpu`'s `test.burn@1`), `378/` (`view3d`'s `counts: true`, `encoded` batches, "counted on the noop
  lane"), `380/` (`golden` and `decide`: the owner's decision by `via`, `not_your_decision`, the bless `ask`), `432/`
  (the warm-up at check, materials, controls and patches in documents); `crates/deep-gpu-layer/src/main.rs` (`deep-gpu
  run`, `App::call`, `Planted`), `budget.rs` (`frame_budget`), `golden.rs` (`decide`), `live.rs` and `warm.rs` (the
  check's warm-up); `crates/deep-gpu/src/frame_budget.rs` (the five-run judgment); `scripts/benchmark.mjs`
  (`fingerprint()`, the reference Macs and their conditions).

What the base already does and these tests don't credit: #1899's `frame_budget` checks one document's frame-budget run
(warm-up, five runs, invalid frames, `machines: same`) on a stub meter, stub timer and stub environment; #379's `live`
plays the app's window with a stub meter whose passes can be named intervals; #432's warm-up compiles every reachable
feature set at check, and `live` lists the pipelines each frame creates; #378's `view3d` counts the batches each frame
encodes; #380's `decide` takes your blessing of a golden and refuses an agent's. There is no envelope: no every-pass run
judged as a whole, no calibration baseline or store for it, no ask for its limits and no decision that sets them, no
input-to-present measure or display seam a test can stand in, no `separate-items` fixture or ratio to its instanced
twin, no first frame wait, no count of bind groups, buffers or uploaded bytes per frame, and none of the planted names
below. So these tests define the surface below.

## Run them

They build `deep-gpu` with `test-meter`, as #1899's suite does, so they run with `--no-file-parallelism`, and
`scripts/lanes.mjs` needs this folder in its `alone` list beside `tests/acceptance/1899/`. This README is the
instruction; the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/1903 --no-file-parallelism
npx tsc -p tests/acceptance/1903/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Every file first builds `cargo build --locked --bin deep-gpu --features test-meter` once (cargo on `PATH`), copies the
binary out of `target/debug` (or `$CARGO_TARGET_DIR/debug`) into a temporary folder, and fails each test if the build
failed. Each test writes into its own temporary folder and deletes it. Every test but one runs `deep-gpu run --backend
noop`: on the stub meter, the stub display, the virtual clock and a stubbed environment fingerprint wherever a reading
decides it, so it passes or fails the same on any Mac. Two kinds of reading are this machine's own: `first-frame.test.ts`
times wall clock against a 500 ms delay (its second open must read under 500 ms on a loaded machine; its document is a
camera and one box), and the last test of `separate-items.test.ts` draws on this Mac's GPU and counts only on a reference
Mac in its conditions, read with `scripts/benchmark.mjs`'s `fingerprint()`; anywhere else it is skipped as
`INCONCLUSIVE`, never passed. A run with `--root tests/acceptance/1903` leaves Vitest's cache in
`tests/acceptance/1903/node_modules/.vite`; delete it. `BASE-FAILURE.txt` says what each test gets at the base.

## The surface under test

The issue names an envelope, its report, a calibration baseline, an ask, your limits, a display seam's presentation
time, the `separate-items` fixture and its twins, a first frame wait, counts on the noop lane, a test shim and nine
wrong programs, but no code API. So these tests define the smallest surface they need on the binary #1899 extended:
**two new calls on #377's `deep-gpu run`, `envelope` and `envelope_counts`**, **one more decision on #380's `decide`**,
four stub fields that only the `test-meter` build holds, and nine more `--planted` names. No new binary. Every name below
that the issue or design doesn't give is this job's choice; the implementer builds exactly these, or a dispute goes to a
blind redraft.

#377's JSON-lines protocol holds unchanged: one scenario `{"out": dir, "calls": [Call]}` per stdin line, answered with
exactly one line `{"ok": true, "replies": [Reply]}`, one reply per call in order, then exit 0; a call missing a required
field, or carrying one its build doesn't hold, is answered `{"code": "bad_input", …}`; an unknown `--planted` name answers
one `{"ok": false, "code": "bad_input"}` line and exits 2. All calls of a scenario run in one process.

### The `envelope` call

```json
{"call": "envelope", "look": look@1, "writer": "<kind>:<id>", "store": dir,
 "scene": path, "separate_items"?: {"doc": path, "instanced": path},
 "render": {"seconds": s, "pixels": [w, h]}, "warmup"?: 60,
 "inputs"?: {"control": id, "at_ns": [ns]}, "first_frame_wait"?: false,
 "report"?: ["frames" | "inputs"],
 "stub_meter"?: EnvelopeStub, "stub_display"?: {"rate_hz": hz},
 "stub_environment"?: Fingerprint, "stub_pipeline_delay_ms"?: ms}
```

The frame budget's combined envelope (Frame budget). Each `path` is a JSON file holding a document as `writer` sends it
(#393's deep_show payload, as `frame_budget` takes it); each is checked as that writer's revision, and a refused one is
answered `{"code": "refused", "issues": [Issue]}`. The envelope plays each fixture live in the app's window (headless on
noop), off the UI thread, at `render.pixels` (full screen on the display), at its class's base rung, as `frame_budget`
renders: its check (and the check's warm-up), `warmup` untimed frames (run 0), then five timed runs (1–5) of n =
`render.seconds` × rate frames, frame k of a run at t = k ÷ rate on that run's own clock, where rate is the display's
refresh rate (the stub display's `rate_hz`; 60 on noop without one). The fixtures, in order: the every-pass scene
(fixture `scene`); with `separate_items`, `separate-items` (`doc`) and its instanced twin (`separate-items/instanced`).
Each frame's GPU time is read by #1899's rules (its own pass timestamps, an invalid reading never filled from another
frame, never CPU encode time for a GPU limit). After its timed runs the scene is sought once and exported once, and the
app's and its decode worker's peak memory over the call are read; with `first_frame_wait`, the first frame wait is
measured (below). It answers:

```json
{"verdict": V, "fixtures": [Fixture], "input": Input, "calibration": [Metric], "asks": [Ask],
 "first_frame_wait": null | [Open], "frames"?: [FrameLog], "inputs"?: [InputLog]}
V        = "PASS" | "FAIL" | "BLOCKED" | "INCONCLUSIVE"
Fixture  = {"fixture": "scene" | "separate-items", "verdict": V, "why": null | "not_run",
            "frame_time": null | {"limit_ms", "verdict": V, "runs": [{"p50_ms", "p95_ms", "p99_ms"}], "margin",
                                  "passes": [{"item": id | null, "name", "p95_ms"}]},
            "gpu_memory": null | {"limit_bytes", "verdict": V, "peak_bytes": bytes | null}}
Input    = {"limit_frames": 2, "rate_hz": hz | null, "limit_ms": ms | null, "verdict": V,
            "runs": [{"p95_ms", "p95_frames"}], "margin": fraction | null, "missing": null | "inputs" | "presentation_times"}
Metric   = {"metric", "unit": "ms" | "bytes" | "x" | "ratio", "better": "lower" | "higher", "measured": number | null,
            "limit": number | null, "verdict": V, "baseline": [{"device": {"model", "chip"}, "value"}], "why": null | "not_run"}
Ask      = {"id", "kind": "envelope_limits", "metrics": [{"metric", "unit", "better", "baseline": [{"device", "value"}]}]}
Open     = {"open": "fresh" | "same_process", "ms", "pipelines"}
FrameLog = {"fixture", "run": 0..5, "frame": k, "latched_ns", "encoded_ns", "presented_ns"}
InputLog = {"run": 1..5, "input": i, "arrived_ns", "frame": k, "presented_ns", "ms"}
```

- **`fixtures`**: always a `scene` row and a `separate-items` row; without `separate_items` the latter is `BLOCKED`, `why:
  "not_run"`, its `frame_time` and `gpu_memory` null, so an envelope that didn't time it never passes. The instanced
  twin has no row; its runs feed the ratio. `frame_time` is the fixture's frame GPU time against its class's limit
  (`limit_ms`: a showpiece's 10), judged as `frame_budget` judges `limits.gpu` (#1899: the five-run rule, invalid frames,
  `machines: same`, `margin`); each run's `p50_ms`, `p95_ms` and `p99_ms` are nearest-rank percentiles over its n frames.
  `passes`: each pass the fixture's frames ran, by the meter's `name`, with `item` the item whose operator runs it
  (null for the core's own passes) and its p95 GPU time over the timed runs' frames. `gpu_memory`: the device's
  allocated size at its peak over the fixture's play, against the class's GPU memory (`limit_bytes`: 256,000,000 for a
  showpiece): PASS within, FAIL over, BLOCKED when the device can't say, under `machines: same`. A row's `verdict` is its
  worse: FAIL, then BLOCKED, then INCONCLUSIVE, then PASS.
- **`input`**: input on screen. With `inputs`, in each timed run of the scene, each time in `at_ns` (ns on the run's
  clock) a test input arrives at the app: an entry of writer `you` on the scene's input track for its toggle control
  `control`, its values alternating `true` (first), `false`, …. Its reading (`InputLog.ms`) is from its arrival to the
  presentation time the display seam reports for the first frame that reads it. Each run's `p95_ms` is the nearest-rank
  p95 over its inputs' readings, and `p95_frames` that in frames at the display's rate; `limit_ms` = 2 × 1000 ÷
  `rate_hz`; the verdict is the five-run rule's on the five `p95_ms` against `limit_ms`, under `machines: same`. Without
  `inputs` it is BLOCKED, `missing: "inputs"`; with no display seam that reports presentation times (noop without
  `stub_display`), BLOCKED, `missing: "presentation_times"`; `runs: []` and nulls either way.
- **`calibration`**: one row for each metric below, always all eight, in this order. `measured` is this run's value;
  null, with `why: "not_run"` and `BLOCKED`, when the call didn't measure it (no `separate_items`, no
  `first_frame_wait`). `limit` is your limit from `store`, null until you set one. The verdict: BLOCKED when `measured`
  or `limit` is null, never PASS; else PASS when within (`lower`: measured ≤ limit; `higher`: measured ≥ limit), else
  FAIL; then, under `machines: same`, a PASS or FAIL off a reference Mac is INCONCLUSIVE.

  | `metric` | `unit` | `better` | Measured |
  |---|---|---|---|
  | `frame_time_p99` | ms | lower | The scene's frame time p99: the median of its five runs' `p99_ms` |
  | `seek_rebuild` | ms | lower | The scene sought to the middle of its span after its timed runs: from the seek to the rebuilt frame's presentation |
  | `peak_memory/app` | bytes | lower | The app's process's peak resident memory over the call |
  | `peak_memory/decode_worker` | bytes | lower | Its decode worker's (#423) |
  | `export_throughput` | x | higher | The scene exported headless at `render.pixels` as a delivery film with every guard: its duration ÷ the wall time from the command to the file |
  | `first_frame_wait/fresh` | ms | lower | `first_frame_wait`'s fresh open |
  | `first_frame_wait/same_process` | ms | lower | Its second open |
  | `separate_items_ratio` | ratio | lower | `separate-items`' p95 ÷ its instanced twin's, each the median of its five runs' `p95_ms` |

- **The baseline and the ask.** `store` is the envelope's own folder (its files are the implementer's choice): it keeps
  each metric's calibration baseline per device, the asks raised and your limits. A device is the `model` and `chip` of
  the environment the run is judged under. A metric's baseline on a device is the value of the first run that measured
  it there, never replaced by a later run; each row's `baseline` lists every device's, in the order they were measured.
  The first run that measures a metric on a reference Mac (in its conditions) asks you for its limit: a run's `asks`
  holds at most one ask, `kind: "envelope_limits"`, listing every metric first measured on a reference Mac in that run,
  each with its `baseline` (every device's value measured by then). A metric is never asked again, by any later run on
  any device: a Mac measured later adds its value to the metric's `baseline`, a reading beside the reference Mac's, and
  raises nothing. The envelope never sets a limit itself.
- **`verdict`**: FAIL when any judged row fails (a fixture's `frame_time` or `gpu_memory`, `input`, a `calibration`
  metric); else BLOCKED when any is blocked; else INCONCLUSIVE when any is; else PASS. So it passes only within the
  limits you approved.
- **`first_frame_wait`**: with `first_frame_wait: true`, the envelope starts a fresh process, a copy of this binary on
  the same backend with nothing kept from this one (no pipelines, no caches), which checks and opens `scene`, closes it,
  and checks and opens it once more. Each `Open`'s `ms` is wall time from the start of the document's check to its first
  presented frame, and `pipelines` the pipelines created from that start to that frame; fresh first. Without it,
  `first_frame_wait` is null.
- **`frames`** (`report: ["frames"]`): every frame each fixture drew, warm-up (run 0) first, in order: when it latched
  its inputs, when its encode ended and the presentation time the display seam reported for it, each in ns on its run's
  clock. **`inputs`** (`report: ["inputs"]`): for each timed run, each input in `at_ns`'s order: its arrival, the first
  frame that read it, that frame's reported presentation time and its reading.

### Stubs (`test-meter` only)

The `test-meter` build holds these fields; the shipped build answers each with `bad_input`.

**`stub_meter`**: the test meter, standing in for the device's pass timestamps and for the readings the envelope takes
of the process and the export. Every fixture the call plays needs an entry.

```json
{"fixtures": {"scene" | "separate-items" | "separate-items/instanced":
               {"gpu_ms"?: ms, "passes"?: {item: ms}, "cpu_ms"?: 0, "gpu_bytes": bytes}},
 "seek_rebuild_ms": ms, "peak_bytes": {"app": bytes, "decode_worker": bytes}, "export_x": x}
```

- Each fixture's entry has exactly one of `gpu_ms` (in every frame of every run, its passes together cover `gpu_ms`, as
  #1899's stub does) and `passes` (in every frame, the pass each listed item's operator runs covers that many ms, the
  listed passes one after another from the frame's start in submission order, every other pass 0 ms, so the frame's
  passes cover their sum). `cpu_ms` is each frame's CPU time, `gpu_bytes` the device's allocated size through the
  fixture's play.
- `seek_rebuild_ms`, `peak_bytes` and `export_x` stand in for the seek's rebuild, each process's peak memory and the
  export's throughput.
- Everything the envelope, the meter and the judgment do from these readings is the real ones' (with `--planted`, the
  planted one's).

**`stub_display`**: the test display seam the app's window is on, refreshing at `rate_hz` on each run's virtual clock.
Frame k of a run latches at its refresh, k × 10⁹ ÷ `rate_hz` ns; its encode ends at its latch plus its CPU time (the
stub meter's `cpu_ms`); the seam reports its presentation time as the refresh at which the swap slot holding it is
first shown.

**`stub_environment`**: #1899's, the environment the call is judged under: `{"model", "chip", "memoryBytes", "power":
"ac" | "battery", "lowPowerMode", "thermalState", "macosBuild"}`, the shape of `scripts/benchmark.mjs`'s `fingerprint()`;
without it the call reads this machine's.

**`stub_pipeline_delay_ms`**: the test shim. In the fresh process `first_frame_wait` starts, the first pipeline the
scene's check creates is created that many ms late: the thread creating it sleeps first. Nothing else changes.

### Your limits: `decide` (#380's call), a decision added

```json
{"call": "decide", "store": dir, "via": "you" | "agent", "decision": {"limits": {metric: number}}}
```

`via` stands in for the connection's identity, as it does for a blessing. Yours answers `{"outcome": "decided"}` and
writes each limit to `store`, replacing your earlier one for that metric; the envelope judges by them from its next
run. An agent's answers `{"outcome": "refused", "code": "not_your_decision"}` and writes nothing. A name that isn't one
of the eight metrics is `bad_input`. You may set any of them, at any time; a metric you leave unset stays BLOCKED and
is not asked again.

### The `envelope_counts` call (the noop lane)

```json
{"call": "envelope_counts", "look": look@1, "writer": "<kind>:<id>", "doc": path,
 "render": {"seconds": s, "pixels": [w, h]}, "fps"?: 60,
 "patches"?: [{"frame": k, "ops": [Op]}]}
```

The counts the envelope takes beside its timings, on `--backend noop`: `doc` checked as `writer`'s revision (refused:
`{"code": "refused", "issues"}`), with its warm-up, then drawn as the envelope draws a fixture, at the class's base rung
and never stepping, for frames 0 … n − 1 (n = `seconds` × `fps`, frame k at t = k ÷ `fps`), with no untimed frames
before frame 0. `patches`: each patch's ops (#389's: `set`, …) apply as `writer` before frame k latches, as its next
revision, checked first, so frame k is the first to show it. It answers:

```json
{"warmup": {"pipelines": n},
 "frames": [{"frame": k, "encoded": [{"batch": name, "items": [id]}],
             "bind_groups": n, "buffers": n, "pipelines": n, "uploaded_bytes": n}]}
```

- `warmup.pipelines`: the pipelines the document's check created on the device at its warm-up (#432), before frame 0,
  in this process.
- `bind_groups`, `buffers`, `pipelines`: those created on the device while frame k was drawn (and while a patch first
  shown in frame k was checked), by anything on the frame path.
- `uploaded_bytes`: the bytes written to the device for frame k: queue writes, staging copies and mapped writes, of any
  buffer or texture.
- `encoded`: #378's: the batches the render worker encoded for frame k, each with a name stable across the call and
  every item it draws.

### Planted programs (`deep-gpu run --planted <name>`, each reachable only there)

| Name | The wrong program | Criterion |
|---|---|---|
| `times_each_pass_alone` | The envelope times each pass in a run of its own, the others off, and judges each against the class | 47941574 (issue-named) |
| `takes_first_measurement_as_limit` | The envelope takes each calibration metric's first measurement on the device as its limit, whatever limit you set | d472967b (issue-named) |
| `holds_input` | The app holds each input one extra step (the frame after the first that could read it reads it) and one extra swap slot (that frame is presented one refresh later) | a03bdb26 (issue-named) |
| `held_input_meter_at_encode` | `holds_input`'s path, measured by a meter that stops each input's clock at the end of the encode of the frame that reads it | a03bdb26 (issue-named) |
| `bind_group_per_item` | The renderer makes one bind group per item per frame | 26bdf7d3 (issue-named) |
| `uploads_every_transform` | The renderer uploads every item's transform (64 bytes) each frame | 6598323c (issue-named) |
| `warms_per_item` | The check's warm-up keys its pipelines by item instead of by feature set | fbd78805 (issue-named) |
| `times_only_scene` | The envelope times only the every-pass scene, ignoring `separate_items`, and reports no `separate-items` row | 561ba507 (issue-named) |
| `wait_clock_after_warmup` | The first frame wait's clock starts after the check's warm-up | c2287dc1 (issue-named) |

Every build takes the names, as #1899's; the tests run them on the `test-meter` build.

## Fixtures

- `fixtures/look.json`: #1899's acceptance look (#379's), copied.
- Documents are generated by `helpers.ts`, as payloads (no `id`, `layers` or item `layer`), each a showpiece
  (`budget.class`) requiring scene3d:
  - **The every-pass scene's stand-in** (`sceneDoc`): an orbit camera turning once over 60 s around a 1 m box, full
    screen (3456 × 2234, Mac15,7's display); with `burns`, a `test.burn@1` item each (`test.gpu`); with `nudge`, the
    toggle control `nudge` (class document, role `switch`) that lifts the box from 0.5 m to 0.75 m.
  - **`separate-items`** (`separateItemsDoc()`): 4,000 separate 1 m boxes, `item-0000` … `item-3999`, on an 80 × 50
    grid 1.5 m apart (119 m × 74 m), none in an instancer; 400 looks, `look-000` … `look-399`, each a `material@1` item
    with its own base color and roughness, item i wearing look i mod 400; 12 feature sets, look m having set m mod 12:
    the patterns none, plaster, wood, rock, concrete and asphalt, each lit or unlit; an unshadowed sun; and an orbit
    camera (target the grid's centre, elevation 60°, 300 m out, fov 40°) whose azimuth a linear channel turns from 0° to
    360° over the 60 s span, so every item stays in view.
  - **Its 40-item twin** (`separateItemsDoc(40)`): its first 40 boxes, one look each (looks 0–39), over the same 12
    feature sets, under the same camera.
  - **Its instanced twin** (`instancedTwinDoc`): the same 400 looks and the same 4,000 boxes at the same places, drawn
    as 400 `instance@1` items of 10, instancer m drawing look m's ten (items m, m + 400, …, m + 3,600) from a hidden
    prototype box wearing look m.
- `stub_environment` stand-ins: the reference Mac, Mac15,7 (Apple M3 Pro, 36 GiB) on mains power, Low Power Mode off,
  thermal state nominal, a macOS build; and a Mac measured later, an M1 (MacBookAir10,1, 16 GiB), in the same conditions.
- Test inputs: 1,000 times from mulberry32 seeded 1903, uniform over a run's first 59 s, sorted.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the leading
`- [ ] ` dropped, computed with #607's command (as #305's README gives it) with the issue's eight criterion lines on
stdin. Each test's name starts with its criterion's ID. Where a criterion names a wrong program, the test runs it
through `--planted` and asserts it fails the way the criterion says.

| ID | Criterion (the issue's text) | Tests, what each asserts, and the wrong programs |
|---|---|---|
| `#1903.47941574` | Three test passes that each meet their own budget alone, 4 ms of GPU each at full screen, fail the combined envelope together on the showpiece class's 10 ms at p95, naming the three passes and the measured total, where a check that times each pass alone passes all three | `combined.test.ts`: the scene with burn-a, burn-b and burn-c, each pass stubbed at 4 ms, five runs of 300 frames full screen under the reference Mac: the scene's frame time FAIL against `limit_ms` 10, each run's p95 12 ms, its `passes` naming burn-a, burn-b and burn-c at 4 ms each, the envelope FAIL. Each burn alone in its own scene: frame time PASS, p95 4 ms, the pass named. `times_each_pass_alone` reads PASS on the three together and fails the check |
| `#1903.d472967b` | The envelope's first run on the reference Mac records its p99 frame time, seek rebuild, each process's peak memory and export throughput as a calibration baseline and asks you once for their limits, that baseline beside each; until you answer, the envelope is BLOCKED on those four, never PASS; and with a seek-rebuild limit you set below the baseline, a run that matches the baseline fails, naming the metric, the limit and the measured value, where a planted envelope that takes its first measurement as the limit passes it | `baseline.test.ts`, one process, a fresh store, the scene at 3 ms, seek 40 ms, app 900 MB, decode worker 200 MB, export 3×: the first run's five rows (`frame_time_p99`, `seek_rebuild`, `peak_memory/app`, `peak_memory/decode_worker`, `export_throughput`) measured, their baseline that value on Mac15,7, no limit, each BLOCKED, the envelope BLOCKED, one `envelope_limits` ask listing each with its baseline. A second run: no ask, still BLOCKED. A run on the M1 (other readings): no ask, each baseline keeping Mac15,7's value and adding the M1's, never PASS. An agent's limits: `refused`, `not_your_decision`, and the next run still BLOCKED with no limit. Your limits (p99 5 ms, seek 30 ms, app 1 GB, decode worker 300 MB, export 2×): `decided`; a run matching the baseline: `seek_rebuild` FAIL with limit 30 and measured 40, the other four PASS, the envelope FAIL, no ask. `takes_first_measurement_as_limit` passes `seek_rebuild` there and fails the check, naming it |
| `#1903.a03bdb26` | In the envelope run, input on screen is measured per input from the entry's arrival at the app to the presentation time the display seam reports for the first frame that reads it: 1,000 test inputs at seeded times give a p95 within 2 frames at the display's rate; a planted path that holds each input one extra step and one extra swap slot reads past 2 frames and fails, naming the frames; and a meter that stops at the frame's encode instead of its presentation reads within 2 frames on that planted path and fails this test | `input.test.ts`: the scene with `nudge`, five 60 s runs under the reference Mac on the 60 Hz stub display, the 1,000 seeded inputs in each: for every run, 1,000 input rows, each arriving at its seeded time, read by a frame that latched at or after it, its reading ending at that frame's presentation in the frame log, its `ms` that span; each run's p95 the inputs' p95, within 2 frames (33.333 ms), `rate_hz` 60, `limit_frames` 2; input PASS. `holds_input`: input FAIL, each run's `p95_frames` past 2, the envelope FAIL, the check naming the frames. `held_input_meter_at_encode`: input PASS (within 2 frames) and the check fails, naming the presentation its readings stop short of |
| `#1903.26bdf7d3` | Over the 60 s orbit of `separate-items`, counted on the noop lane, the first frame encodes each batch once and every later frame creates 0 bind groups, 0 buffers and 0 pipelines. A planted renderer that makes one bind group per item per frame creates 4,000 in the second frame and fails, naming the count and the frame | `counts.test.ts`: `envelope_counts` of `separate-items`, 3,600 frames: frame 0 encodes at least one batch, none twice, their items covering all 4,000; frames 1–3599 create 0 bind groups, 0 buffers and 0 pipelines. `bind_group_per_item` (a 1 s orbit): frame 1 creates at least 4,000 bind groups, and the check names frame 1 and that count |
| `#1903.6598323c` | Over the orbit with no item changing, each frame after the first uploads at most 1 KB, and a patch that moves one item uploads at most 256 bytes more in its frame. A planted renderer that uploads every item's transform each frame uploads at least 256,000 bytes (4,000 × 64) and fails, naming the bytes | `counts.test.ts`: the same unchanged orbit, frames 1–3599 at most 1,024 bytes each; the orbit with item-0000 moved half a metre at frame 1,800: that frame uploads more than the unchanged orbit's frame 1,800, by at most 256 bytes. `uploads_every_transform` (a 1 s orbit): frame 1 uploads at least 256,000 bytes, and the check names frame 1 and the bytes |
| `#1903.fbd78805` | At check, `separate-items` creates the same number of pipelines as a twin fixture with 40 items over the same 12 feature sets. A planted warm-up keyed by item instead of by feature set creates 100 times as many and fails, naming both counts | `counts.test.ts`, each document in a process of its own: `warmup.pipelines` equal for `separate-items` and its 40-item twin, and at least 12. `warms_per_item`: `separate-items` creates at least 4,000, and the check names both counts |
| `#1903.561ba507` | On the reference Mac, `separate-items` holds the showpiece class's 10 ms at p95 under the five-run rule, and its ratio to the instanced twin is in the baseline. Until you set the ratio's limit the envelope is BLOCKED on it, never PASS. With a limit set below the baseline, a run that matches the baseline fails, naming the ratio and the limit. A planted envelope that times only the every-pass scene reports no `separate-items` row and fails, naming the fixture | `separate-items.test.ts`, one process, a fresh store, under the reference Mac: `separate-items` at 6 ms and its instanced twin at 4 ms: the `separate-items` row's frame time PASS against 10 ms, five runs at p95 6 ms; `separate_items_ratio` measured 1.5, its baseline 1.5 on Mac15,7, no limit, BLOCKED, asked with its baseline beside it; the envelope BLOCKED. Your ratio limit 1.2: `decided`; the run matching the baseline: the ratio FAIL with limit 1.2 and measured 1.5, the envelope FAIL. `times_only_scene`: no `separate-items` row, and the check names the fixture. On this Mac's GPU with no stub, five 60 s runs: on a reference Mac in its conditions the `separate-items` row PASS against 10 ms, else skipped `INCONCLUSIVE` (and a five-run INCONCLUSIVE there is skipped as a reading) |
| `#1903.c2287dc1` | A test shim delays the creation of one pipeline by 500 ms. The `first frame wait` in a fresh process reads at least 500 ms, and the second open in the same process creates 0 pipelines and reads under 500 ms. A planted meter that starts its clock after warm-up reads under 500 ms in the fresh process and fails, naming the reading. Until you set the wait's limit the envelope is BLOCKED on it, never PASS | `first-frame.test.ts`, under the reference Mac with `stub_pipeline_delay_ms` 500: the fresh open reads at least 500 ms and creates at least one pipeline; the second open creates 0 and reads under 500 ms; `first_frame_wait/fresh` and `/same_process` measured as those opens, no limit, BLOCKED, both asked; the envelope never PASS. `wait_clock_after_warmup`: the fresh open reads under 500 ms, and the check names the reading |

## Readings where the issue and design leave a choice

- **One call for the envelope, beside `frame_budget`.** The envelope is a field of the Frame budget check and builds on
  #1899's runs and meter, so it is one more call on the binary that holds `frame_budget`, with its stubs, and its
  judgment of a fixture's frame time is `frame_budget`'s. "Played live in the app" is the app's window on the noop
  backend here, headless, on the run's virtual clock.
- **The every-pass scene.** The build's passes (skin and hair, rays, a volume, frame history, physics, text, narration)
  mostly don't exist yet, and the envelope takes whatever scene it is given, so each test gives a stand-in: three test
  passes where the passes matter (`#1903.47941574`), a box elsewhere. "Every pass the build has" is not checked.
- **"4 ms of GPU each at full screen"**: each `test.burn@1` pass stubbed at 4 ms (the stub's `passes`) with the envelope
  drawn at the reference display's full size. The three run one after another, so the frame covers 12 ms, the "measured
  total"; "naming the three passes" is the frame time's `passes` listing each by its item at 4 ms. "A check that times
  each pass alone" is two things: each pass alone in a scene of its own passes (the twin, so each meets its own budget),
  and `times_each_pass_alone`, the wrong envelope, passes the three together.
- **The baseline, the store and the one ask.** #380's golden store is the base's way a proof binary keeps an owner's
  decision between runs, and its `decide` (with `via` standing in for the connection) the base's way one is taken, so the
  envelope keeps its baseline, asks and limits in a `store` folder the call names, and your limits arrive through
  `decide`. "Asks you once": one ask per first measurement on a reference Mac, never raised again by any later run;
  "a Mac measured later adds a reading without a new ask" (Scope) is the M1 run. "Limits: your decision": an agent's
  `decide` is refused and nothing the envelope does sets one. "BLOCKED on those four" is the five rows of the four kinds
  ("each process's peak memory" is two rows: the app and its decode worker). "A run that matches the baseline" is a run
  on the same device with the stub's same readings. "Naming the metric, the limit and the measured value" is the row's
  `metric`, `limit` and `measured` with its FAIL.
- **Judging a calibration metric** is one value per run against your limit, not the five-run rule: seek, export and peak
  memory are measured once per run, and the design gives these limits no margin. Throughput holds at or above its limit,
  every other metric at or below.
- **First runs split by what they measure.** The design's first envelope run measures everything at once and so asks
  once; these tests run the scene, `separate-items` and the first frame wait in separate stores, so each first run asks
  for what it measured, and no metric is ever asked twice.
- **Input on screen.** "The entry's arrival at the app" is an input-track entry of writer `you` for a document control,
  and "the first frame that reads it" the first frame whose latch takes it. On noop there is no display, so the stub
  display seam stands in for it, refreshing on the run's virtual clock and reporting the refresh a frame is shown at;
  the frame log carries the seam's times, and each input's reading is checked against them, so a meter that ends
  anywhere but the reported presentation fails. "Within 2 frames at the display's rate" is p95 ≤ 2 × 1000 ÷ 60 ms; the
  five-run rule applies to it as to frame time, since it is one of the class's envelope limits. "Naming the frames" is
  `p95_frames`. "A meter that stops at the frame's encode … on that planted path" is one planted program, the held path
  with that meter, since `--planted` takes one name; its encode ends at its latch on the virtual clock, so it reads
  within 2 frames and only the per-input check catches it. The 1,000 inputs are the same in each of the five runs, over
  each run's first 59 s so the held path's frames still present within the run.
- **Counts on the noop lane** are taken by `envelope_counts`, one pass of the orbit, rather than inside the envelope's
  five runs: a count doesn't vary run to run, and a 60 s orbit five times over for two fixtures would cost the noop lane
  far more than it shows. It draws as the envelope draws, from the same check. `encoded` keeps #378's meaning and form,
  since "encodes each batch once" is #378's replay rule. "The first frame" is frame 0, "the second frame" frame 1.
  "Each batch once" also asks that frame 0's batches cover every item, so a frame that encodes nothing doesn't pass.
- **"Look" and "feature set".** A document has one look asset (One word per idea), so "400 looks" are 400 appearances:
  `material@1` items, each with its own values; "12 feature sets" are the materials' compiled keys (Material: pattern,
  alpha mode, transmission, unlit, ink), here six patterns each lit or unlit. Values live in a material buffer, so 400
  looks need 12 feature sets' pipelines, not 400.
- **1 KB** is 1,024 bytes, the larger reading. **"256 bytes more in its frame"** is against the unchanged orbit's same
  frame, and the moved frame must upload more than that frame, since the move must reach the GPU.
- **"At check"** is the warm-up the document's check runs (#432), counted before frame 0, each document in a fresh
  process so neither finds the other's pipelines cached. "The same number" also asks at least 12, one per feature set,
  so a warm-up that compiles nothing doesn't pass. "100 times as many" is read as at least one pipeline per item (4,000
  against 40): the core's own pipelines, the same for both, keep the ratio just under 100.
- **"On the reference Mac, separate-items holds the showpiece class's 10 ms"** is a fact of the device, so it has a test
  on this Mac's own GPU that counts only on a reference Mac in its conditions and is otherwise skipped INCONCLUSIVE; the
  rest of the criterion (the ratio, its baseline, BLOCKED, the limit, the planted envelope) is the rule's, tested on the
  stub. The ratio is the two fixtures' median p95s; with the stub at 6 and 4 ms it is 1.5.
- **"A test shim delays the creation of one pipeline by 500 ms"** is the first pipeline the scene's check creates in the
  fresh process, held 500 ms of wall time; "with no kept caches" is a fresh process the envelope starts, nothing kept
  from its own. "Reads at least 500 ms" also asks that the fresh open created a pipeline, so the delay was in its wait.
  "The wait's limit" covers both opens' rows.
- **Run length.** Where a criterion names none, a run is 5 s, 300 frames, the design's floor for a frame-time p95, as in
  #1899; "the envelope run" and "the 60 s orbit" are 60 s; a planted renderer that fails at frame 1 runs 1 s.

Not tested, because no criterion asks or the surface can't reach it: the envelope's GPU memory verdict (in the result,
judged by no test), every pass the build has, the estimate of every pass the check makes before the envelope runs, the
M1's, M3's and later Macs' ray readings beyond the one later Mac's reading, seek, export and peak memory measured for
real (stubbed here), never running on the UI thread, #1899's invalid-frame rules inside the envelope, the CPU limit,
and the shipped build's refusal of the four stubs.

## Upstream tests (the Oracle lane)

The issue's Oracle note says no upstream test checks these criteria (the envelope, its baseline and ask, the counts and
the first frame wait are this project's rules); these tests are their local proof.
