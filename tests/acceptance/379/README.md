# Acceptance tests for #379: the meter and the degrade ladder — budget classes, pass timings, and memory counted on the device

Written first, from issue #379 (its scope, the "Meter and degrade ladder" fields and their "It can never" line, its
ten acceptance criteria, its proof line and the owner's comment handed over from #96 about `cost_delta` and
`marks_check`), the design sections it links and those they lean on, and base commit `d122341` ("Merge pull request
#737 …"), by a job that never saw an implementation; none existed. Its Oracle page says no engine's or project's own
test checks these criteria, so no upstream test is ported. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- `docs/technical-design.md`: Rules every primitive follows (863: "Low level, so it's fast": operators over flat
  typed arrays, no heap allocation after warm-up, each with a cost model and a micro-benchmark, the check refusing a
  document over the frame budget; "Budgets by class"; "Checked before it shows"); The canvas core; Numbers version 0
  has to hold (the canvas row: "no heap allocation per frame after warm-up, under 256 MB of GPU memory per window
  measured on the device (a live 3D view that wouldn't fit renders at a lower internal scale, and a shorter
  frame-history window …)"; Every task carries its own budgets (five runs after warm-up, PASS / FAIL / INCONCLUSIVE
  with a margin of the larger of 5% and the spread; merge-base comparison); The reference Macs (Mac15,7 with its
  3456 × 2234 display, Mac15,12 with its 2560 × 1664 display); the platform seam's feature table ("pass timestamps or
  the CPU fallback … withheld at device creation on the same adapter"); How we know version 0 works (criteria IDs,
  wrong programs, planted twins, the edit guard, Dogfooding, Tests written first).
- `docs/canvas-primitives.md`: The cost model (82: per-item and per-pixel terms; "Coefficients come from
  micro-benchmarks on the reference Mac and carry its environment fingerprint, so a refusal is the same on every
  machine. The check … names the top three contributors"; "Cold, warm and while authoring") and the budget class
  table under it; Document envelope (`budget: {class, frame_gpu_ms, frame_cpu_ms, gpu_mb, …}` "caps that only
  tighten the class"); The trusted compositor: Writer connection, Document session (`budget_class`), Admission and
  latch, Frame clock and scheduler, Frame callback and presentation feedback (`degraded(rung)`), GPU surface (internal
  scale down to 0.5, then a shorter frame-history window down to 2 frames; "The check's memory estimate counts the
  slots, the HDR slots and frame history … and refuses a document that can't fit at those floors, naming the size"),
  GPU surface: HDR output, Render worker, **Meter and degrade ladder** (its fields, its semantics in full: covered
  time and charges after earlier passes end, per-writer steps, the climb, reasons, off-screen compiles, battery below
  30%, frame-health drops not climbed until the view changes, canonical renders at the class's fixed quality, counts
  at the device's sizes with 0 for a memoryless target, BLOCKED while a resource can't be sized, 30 frames down and
  120 up, rungs in order), Render-back; Content key (equal keys share one result; it lives while a current or pending
  revision reads it; a refused or superseded revision and a failed load leave nothing behind; its memory counts in
  full against every writer that reads it); Look `look@1`: frame history; Image `image@1`; Asset and Asset: meshes;
  Check input: Frame budget (timestamps per frame, CPU encode never compared with a GPU limit, a counting allocator,
  the class's base rung).
- Issues #64 and #241 (where this sits), #377 and #378 (what it builds on).
- At the base: AGENTS.md; `tests/acceptance/377/`, `378/` (with its redraft notes: a document must name the canvas
  modules its kinds need in `requires.modules`), `387/` (`allocs` counted by the binary), `96/` (deep-show shared
  documents, `benchmarks/canvas.mjs` tasks valid against the merge base), `305/` (criterion IDs, the registry call,
  builds per feature set), `393/` (deep_show's scenario and replies); `crates/deep-gpu`, `crates/deep-gpu-layer`
  (`deep-gpu run` and its calls; `view3d`), `crates/deep-show` (`main.rs`'s counting allocator, `shared.rs`'s
  `marks_check` and `cost_delta`, the `registry` reply), `crates/deep-canvas` (`check.rs`'s `module_checks` and its
  CPU-only `over_budget` warning past 16 ms, the registry's `Cost`), `crates/deep-canvas-scene3d` (its passes
  `scene3d.geometry` and `scene3d.output`), `crates/deep-scene3d-render`, `benchmarks/canvas.mjs`,
  `benchmarks/budgets.json`, `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`, `validateBudgets`),
  `scripts/perf.mjs`, `scripts/lanes.mjs`.

What the base already does and these tests don't credit: `deep-gpu` (#377, #378) draws parity scenes and 3D documents
through one wgpu device; deep-show's check sums module-registered CPU costs and warns `over_budget` past a fixed
16 ms; #96's patch results carry `cost_delta` with real `vertices` and zeros for `cpu_ms`, `gpu_ms` and `gpu_mb`. There
is no budget class, no meter, no pass timestamps, no ladder, no result cache by content key that counts against
writers, no device memory reading, no test writer, no canonical render of a document at a fixed rung, and no perf-lane
record per class. So these tests define the surface below.

## Run them

They build two `deep-gpu` feature sets and `deep-show`, as #377's and #378's suites do, so they run with
`--no-file-parallelism`. `scripts/lanes.mjs` needs this folder in its `alone` list (the one-at-a-time unit-lane line,
and so excluded from the parallel line), beside `tests/acceptance/377/` and `378/`. This README is the instruction;
the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/379 --no-file-parallelism
npx tsc -p tests/acceptance/379/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Every file first builds what it uses, once: `cargo build --locked --bin deep-gpu [--features test-meter]` or
`--bin deep-show`, copies the binary out of `target/debug` under its own name in a temporary folder, and fails each
test that uses a build that failed. Each test writes into its own temporary folder and deletes it. The tests use node
built-ins and vitest, and `scripts/benchmark.mjs`'s `validateBudgets` (as #96's do). A run with `--root
tests/acceptance/379` leaves Vitest's cache in `tests/acceptance/379/node_modules/.vite`; delete it.
`BASE-FAILURE.txt` is the run at the base.

Where the tests read the device (pass timestamps, Metal's allocated size, pixels), they run on macOS's Metal device;
off macOS, and wherever the binary answers `unsupported_platform`, they fail with a message that starts
`INCONCLUSIVE:`; they never pass there. The tests whose criterion says "on the reference Mac" (the two-writer
step-down, full screen on its display, the switch's frame times, the perf lane's record) also fail `INCONCLUSIVE:` off
a reference Mac (`hw.model` Mac15,7 or Mac15,12). No test is gated on power, Low Power Mode, thermal state or load
(the owner's rule). The ladder's schedule, the reasons, the battery, the covered-time arithmetic and the stub fences
run on the stub meter, wgpu's noop backend and the virtual clock, on every platform, with no wall time in them. The
one timing judgment (the switch's frames, `reasons.test.ts`) takes five fresh runs after a warm-up one and judges them
by the design's rule; anything between PASS and FAIL fails as `INCONCLUSIVE:`.

## The surface under test

The issue names the meter's fields, the ladder and its reasons, a stub meter, a stub battery, a test writer, a counting
allocator, planted caches, counts and ladders, canonical renders and the perf lane, but no code API. So these tests
define the smallest surface they need on the binaries that exist: **new calls on #377's `deep-gpu run`** (`adapter`,
`tick`, `live`, `canonical`, and the test writer's `allocate` and `release`), **two startup arguments**
(`--withhold`, more `--planted` names), **one test feature set** (`test-meter`), **additions to #393's `deep-show run`**
(the `over_budget` refusal, a `machine` scenario field, a planted value, `passes` and `costs` on `registry`), and **two
modes of `benchmarks/canvas.mjs`** with six perf-lane tasks. No new binary.

### `deep-gpu run [--backend noop] [--withhold timestamps] [--planted <name>]`

#377's JSON-lines protocol holds unchanged: one scenario `{"out": dir, "calls": [Call]}` per stdin line, answered with
exactly one line `{"ok": true, "replies": [Reply]}`, one reply per call whatever its outcome, in order, then exit 0; a
line that isn't a scenario answers `{"ok": false, "code": "bad_input"}`; a call missing a required field, or carrying a
field its build doesn't hold, is answered `{"code": "bad_input", …}`; an unknown argument, planted name or withheld
feature answers one `{"ok": false, "code": "bad_input"}` line and exits 2. All calls of a scenario run in one process
on the app's one device. A reply off the reference platform may be `{"code": "unsupported_platform"}`.

- `--withhold timestamps`: the device is created on the same adapter without timestamp queries (the platform seam's
  "withheld at device creation"), so the meter has no pass timestamps and reports its CPU fallback.
- `--planted <name>`: the wrong programs below, each reachable only there.

**Builds.** The shipped build (`cargo build --locked --bin deep-gpu`) and `test-meter` (`--features test-meter`),
which adds, and no shipped build has: the stub meter (`stub_meter`), the stub battery (`stub_battery`), the counting
allocator's report (`report: ["allocs"]`), the test writer (`allocate`, `release`) and the test canvas module
`test.gpu` with its three kinds. The shipped build answers each of those fields and calls `bad_input` and refuses a
document needing `test.gpu` with `module_missing` naming it (`stubs.test.ts`).

### Budget classes, rungs and reasons

A document names its class in its envelope, `budget: {class, …caps that only tighten it}`, with the classes
`core_view`, `data_view`, `figure`, `work_product`, `showpiece` and `export` (the budget class table, in snake case).
A session's share is its class's frame limits (work product: 2 ms GPU, 4 ms CPU).

Rungs, top to bottom: the climb rungs `shadows_2x`, `full_res_effects`, `samples_4_moving`, `scale_1_moving` (the
last is the first climbed: "render scale while moving → 1, then 4 samples while moving, then full-resolution effects,
then shadow maps at twice their size"); `base`, the class's base; then `effects_off`, `lod_down`,
`internal_scale_down`, `30hz`, `freeze`, `placeholder`. ("Refuse" is the check's, before a document shows; it is no
live rung.) Reasons: `initial`, `headroom`, `frame_health`, `battery`, `you`.

### The `live` call

```json
{"call": "live", "look": look@1, "frames": n, "fps"?: 60,
 "sessions": [Open], "events"?: [Event],
 "report"?: ["passes" | "hashes" | "memory" | "allocs" | "meter"],
 "stub_meter"?: StubMeter, "stub_battery"?: [{"frame": k, "percent": p, "state": "discharging" | "charging"}],
 "assets"?: {sha256: absolute path}}
Open  = {"session": id, "writer": "<kind>:<id>", "doc": path, "size"?: [w, h] = the document's size}
Event = {"frame": k, "open": Open} | {"frame": k, "close": session}
      | {"frame": k, "revise": {"session", "doc": path}}
      | {"frame": k, "camera": {"session", "azimuth": deg}}
      | {"frame": k, "rung": {"session", "to": rung}}
      | {"frame": k, "canonical": {"session", "purpose": "render_back" | "export" | "frame_budget", "frame": k2, "size": [w, h]}}
```

It runs the app's live window on a virtual clock: each session is one writer's document drawn by the canvas core
into a GPU-layer view of `size` device px at scale 1 in the run's one window, and frames **1 … `frames`** are
presented, frame k at t = (k − 1) ÷ `fps`, every session's view drawn each frame it has something to draw (a session
holds the views of its document's writer layers; `doc` is a JSON file holding the document as its writer sends it,
#393's deep_show payload: the envelope and ID maps, no `id`, no `layers`, no item `layer`; the core stamps the
session's writer). Each revision is checked before it shows (in the build's sealed set); a refused first revision
leaves the session `refused`, never drawn.

- Events at frame k apply before frame k latches, in the listed order. `revise` sends a whole revision; several at
  one frame arrive before one latch, so only the last can become current and the earlier ones are superseded.
  `camera` is your input turning that session's view `azimuth` degrees about its target (a view input: the view
  changes; the document doesn't). `rung` is you setting that session's rung (reason `you`). `canonical` runs after
  frame k is presented: the session's current revision rendered at its frame `frame` (t = (frame − 1) ÷ fps) at
  `size`, as render-back, an export frame or a frame of a frame-budget run would render it.
- `assets` stands in for the evidence store: an item naming an asset by sha256 is loaded from that file, and its
  bytes are checked against the hash.
- **The stub meter** (`test-meter` only). `writers: {writer: [{"from", "to"?, "gpu_ms", "cpu_ms"?: 0}]}`: for the
  frames from `from` to `to` (to the end when absent) that writer's charged GPU and CPU per frame are the stub's, in
  place of what was measured. `passes: [{"from", "to", "intervals": [{"name", "session", "start_ms", "end_ms",
  "shares"?: [{"writer", "share"}]}]}]`: for those frames the frame's passes are exactly these intervals (reported in
  ns, from the frame's origin), in submission order; each pass's charge goes to its session's writer, or by `shares`.
  `operators: {operator: factor}`: that operator is measured at `factor` times its declared cost. Everything the meter
  and the ladder do from those readings is the real meter's and ladder's.
- **The stub battery** (`test-meter` only): the battery reads each listed reading from its frame on.

It answers:

```json
{"frames": [Frame], "changes": [Change], "sessions": [SessionRow], "canonicals": [Canonical],
 "meter"?: [MeterRow], "device_before": bytes | null}
Frame = {"frame": k, "gpu_ms", "cpu_ms", "gpu_source": "timestamps" | "cpu_encode",
         "views": [{"session", "writer", "rung", "drawn": bool, "charged_gpu_ms", "charged_cpu_ms",
                    "internal_scale", "history_frames", "pixel_hash"?: sha256 | null}],
         "passes"?: [{"name", "session" | null, "source": "timestamps" | "cpu_encode", "start_ns", "end_ns", "charged_ms",
                      "shares"?: [{"writer", "share", "charged_ms"}]}],
         "writers"?: [{"writer", "count_bytes", "results": [{"key", "bytes"}]}],
         "cache"?: {"entries", "bytes"}, "device_bytes"?: bytes | null, "allocs"?: n}
Change = {"frame": k, "session", "writer", "from": rung | null, "to": rung, "reason",
          "pipelines": [key], "compiled_by": frame | null, "thread": name | null, "ui_thread": name, "effective": frame}
SessionRow = {"session", "writer", "state": "live" | "refused" | "closed", "class", "issues": [Issue],
              "revisions": [{"rev", "outcome": "current" | "refused" | "superseded" | "failed", "issues"}]}
Canonical = {"frame", "session", "purpose", "pixel_hash", "rung", "internal_scale", "operators": [{"operator", "resolution"}]}
MeterRow = {"scope": "writer", "writer", "session", "rung", "reason", "limits", "estimate", "measured": [ms]}
```

- `gpu_ms`: the frame's GPU time, the time covered by at least one of its passes; `gpu_source` says whether it came
  from pass timestamps or is the CPU encode time reported as the fallback. `cpu_ms`: the frame's CPU time on the
  canvas core's threads, measured by the binary.
- `views`: per session open at that frame, the rung it drew at, whether it drew, what the meter charged its writer
  for that frame, its internal scale and frame-history window, and with `hashes` the SHA-256 of its slot as BGRA8 rows
  top-down with no padding (#377's), null on noop.
- `passes` (`report: ["passes"]`): each pass in submission order with its interval and its charge, the part of its
  interval after every earlier pass's interval ends; a fused pass lists its writers' declared shares and charges.
- `writers`, `cache`, `device_bytes` (`report: ["memory"]`): each writer's meter count (every result its sessions'
  current or pending revisions read, with its content key and its bytes, plus every target, buffer and texture its
  sessions allocate, at the sizes the device reports), the core's result cache, and Metal's allocated size of the
  app's one device read after the frame's queue drained (null off Metal). `device_before` is that size before the
  call opened anything.
- `allocs` (`report: ["allocs"]`, `test-meter` only): heap allocations the canvas core's frame path made in that
  frame, on any thread, counted by a counting global allocator; allocations made inside wgpu or the GPU driver are
  not the core's and aren't counted.
- `changes`: every ladder change, in order. A session's first change is `from: null`, reason `initial`, at the frame
  it opened. A change decided at the end of frame k has `frame: k`; `effective` is the first frame drawn at the new
  rung; `pipelines` the new rung's pipelines that weren't compiled before, compiled on `thread` and done by the end of
  frame `compiled_by`.
- `sessions`: one row per session the call opened, in the order opened, with each revision's outcome as it was
  admitted.
- `meter` (`report: ["meter"]`): the meter's rows after the last frame: the writer's rung and why it holds, its
  limits from the class, its estimate (with `gpu_bytes` and `parts: {slots, hdr_slots, frame_history, …}` in bytes)
  and `measured`, its 120-frame ring of charged GPU ms, oldest first.

### Other calls

- `{"call": "adapter"}` → `{"backend": "metal" | "noop" | …, "name", "timestamps": {"query": bool, "inside_encoders":
  bool, "inside_passes": bool, "period_ns": number | null}, "withheld": [feature]}`: the device's timestamp features as
  the meter uses them.
- `{"call": "tick", "gpu_ms": n}` → `{"ticks", "period_ns", "gpu_ns", "wall_ns"}`: one submission the binary sizes to
  take about `gpu_ms` of GPU time, bracketed by timestamp writes and waited for: the ticks between them, the period,
  their product, and the host's wall time from submit to the wait's return. Without timestamps: `{"code":
  "no_timestamps"}`.
- `{"call": "canonical", "look", "writer", "doc", "size", "frame", "purpose"}` → a Canonical, in a process with no
  live session: the same render a `canonical` event makes.
- `{"call": "allocate", "writer", "limit_bytes", "resources": [{"name", "kind": "texture", "size": [w, h], "format":
  "rgba8unorm" | "rgba16float" | "depth32float" | …, "mips": "all" | n, "cube"?: bool, "samples"?: n, "transient"?:
  bool, "unsizable"?: bool}]}` (`test-meter` only, the test writer) → `{"resources": [{"name", "device_bytes": bytes |
  null, "count_bytes"}], "count_bytes", "device_before", "device_after", "limit": {"result": "PASS" | "FAIL" |
  "BLOCKED", …}}`: creates the allocations as that writer; `device_bytes` is what the device reports for each,
  `count_bytes` what the meter counts, `device_*` Metal's allocated size around the call after the queue drained, and
  `limit` the check of the writer's memory limit `limit_bytes`. `unsizable` stands in for a resource whose size the
  device can't report (`device_bytes: null`). `{"call": "release", "writer"}` → `{"count_bytes", "device_before",
  "device_after"}` releases them all.

### The test canvas module `test.gpu` (`test-meter` only)

Documents name it in `requires.modules` (`{"scene3d": "^1", "test.gpu": "^1"}`). Its kinds, each drawn by the canvas
core through the GPU layer with its results keyed by content key like any operator's:

- `test.texture@1 {size: [w, h], format: "rgba8", mips: "all", pattern}`: a texture of that size with its whole mip
  chain, filled by a pattern seeded from `pattern`, drawn on a 1 m quad.
- `test.mesh@1 {vertices, seed, asset?: sha256}`: a mesh of `vertices` vertices generated from `seed`, or, with
  `asset`, read from that asset's bytes, which must match their sha256 (a mismatch fails the load).
- `test.burn@1 {loops}`: the operator `test.burn`, one pass over its view whose fragment shader runs `loops`
  iterations per pixel, with a declared cost model.

### Planted programs (`deep-gpu run --planted <name>`, each reachable only there)

| Name | The wrong program | Criterion |
|---|---|---|
| `sums_pass_intervals` | A frame's GPU time is the sum of its passes' intervals | 6d4d0202 (a mutant) |
| `allocates_per_frame` | The meter grows a list every frame | 1e889bee (a mutant) |
| `compiles_at_swap` | A rung change compiles its pipelines on the UI thread in the frame it takes effect | 2299cd3b (a mutant) |
| `charges_first_holder` | A shared result counts against its first holder alone | 0806d709 (issue-named) |
| `keeps_unread_results` | The cache keeps results no current or pending revision reads | 0806d709 (issue-named) |
| `formula_count` | A count of width × height × bytes per texel × samples | 20ef578a (issue-named) |
| `steps_on_first_slow_frame`, `skips_a_rung`, `steps_every_writer` | Ladders that step on one slow frame, skip a rung, or step every writer | 1fbf8952 (issue-named) |
| `shares_meter_with_worker` | The headless worker reads the live meter's rung | 459fdbc0 (issue-named) |

### `deep-show run` additions (#393's scenario, the shipped `full` build)

- The document check estimates each document's CPU time, GPU time and GPU memory per frame from its primitives' cost
  models, with coefficients measured on a reference Mac, and refuses a document over its class (as tightened by its
  `budget`) with one error issue `over_budget` whose `ids` are its top three contributors and whose `actual` is
  `{cpu_ms, gpu_ms, gpu_mb, fingerprint: {model, …}}`, the coefficients' environment fingerprint. A refusal is a
  deep_show reply with `outcome: "refused"` and no snapshot.
- Scenario field `machine: {"model", "chip", "memoryBytes"}` stands in for the machine the hub runs on (its
  environment fingerprint); without it, this machine.
- Scenario `planted` takes one more value, `estimates_on_this_machine` (a mutant for #379.57ab116a): the check
  estimates with coefficients for `machine` instead of the reference Mac's.
- `registry` gains `passes: {pass → {module, place}}` (every render pass the build registers) and `costs: {operator or
  pass → {module, terms: {term → coefficient}, fingerprint: {model, …}, benchmark: {task, case?}}}` for every operator
  in `operators` and every pass in `passes`; `task` is a task of `benchmarks/budgets.json`.

### The perf lane

- `benchmarks/budgets.json` gains one task per class, `canvas-class-core-view`, `canvas-class-data-view`,
  `canvas-class-figure`, `canvas-class-work-product`, `canvas-class-showpiece` and `canvas-class-export`, each with
  command `["node", "benchmarks/canvas.mjs", "class", "<class>"]` and an `initialReason` naming #379, valid by
  `validateBudgets` against the merge base's budgets.
- `node benchmarks/canvas.mjs class <class> [--planted warm_only]` runs that class's fixture on this machine and
  prints its report as its last stdout line: `{"class", "fixture": path, "fingerprint": scripts/benchmark.mjs's
  fingerprint(), "cold": {"ms"}, "warm": {"limits": {"gpu_ms", "cpu_ms"}, "runs": [{"frames" ≥ 300, "gpu_p95_ms",
  "cpu_p95_ms"}] × 5}, "authoring": [{"patch": "values", "ms", "pipelines": 0}, {"patch": "pipeline", "ms",
  "pipelines" ≥ 1}]}`: cold from a fresh process opening the fixture to its first settled frame, five warm runs, the
  patch that moves the Q3 bar from 44 to 48 and the one that adds a mark kind the chart didn't use, each from its
  latch to its settled frame. `warm_only` (the planted lane) records warm frames only.
- `node benchmarks/canvas.mjs judge [--planted fails_on_cold]` reads `{"current": Report, "base": Report}` on stdin
  and prints `{"class", "status": "PASS" | "FAIL" | "INCONCLUSIVE", "warm": {…}, "readings": {"cold": {"current_ms",
  "base_ms"}, "authoring": [{"patch", "current_ms", "base_ms"}]}}`: warm frames judged against the class's limits by
  the design's rule (scripts/benchmark.mjs's `judgeLimit`), cold and authoring-loop timings kept as readings beside
  the base's. `fails_on_cold` (the planted lane) fails a change whose cold reading rose.

## Fixtures

- `fixtures/look.json`: #378's acceptance look (the clean look's status map and fonts, black ground, tone map none at
  scale 1, finish at identity, no deband) with this suite's roles. `window-memory.test.ts` adds `history: {mode:
  antialias, window: 8}`.
- Documents are generated by `helpers.ts`'s `sceneDoc`: a camera and 1 m boxes drawn by scene3d, a `budget.class`,
  `requires.modules` naming scene3d (and `test.gpu` when a test kind is in it), and, for `moving`, a channel that
  slides a box over 60 s so every frame draws while the view stays still. `estimate.test.ts` generates its board of
  zigzag `path@1` items.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the
leading `- [ ] ` dropped, computed with #607's command (as #305's README gives it) with the issue's ten criterion
lines on stdin. Each test's name starts with its criterion's ID. Where a criterion names a wrong program, the test runs
it through `--planted` (or the scenario's or the bench's `planted`) and asserts it fails the way the criterion says;
where it names none, a planted mutant or the check's twin shows the check can fail.

| ID | Criterion (the issue's text) | Tests, what each asserts, and the wrong programs |
|---|---|---|
| `#379.6d4d0202` | The meter reports each pass's GPU time from pass timestamp writes, splitting a fused pass by declared shares; on an adapter without timestamps it reports CPU encode time marked as a fallback, and the proof records the reference Mac's timestamp features; a frame's GPU time is the time its passes cover, never the sum of their intervals, and with two writers on the reference Mac where only one is over its share, only that one steps down; the proof checks the timestamp tick against the wall time of a waited submission | `meter.test.ts`: stub intervals a 0–2, b 1–3 fused (alpha 0.75, bravo 0.25), c 3.5–4 ms: frame 3.5 ms (not 4.5), charges 2, 1, 0.5, b split 0.75 / 0.25, alpha 2.75 and bravo 0.75; `sums_pass_intervals` fails naming frame 1. `adapter` records the timestamp features (logged), query true on Metal; withheld, false. On Metal every frame's and pass's source is `timestamps` and each frame's GPU time is its passes' union, each pass charged after earlier ones end; withheld, every frame and pass is `cpu_encode`. `tick` five times: gpu_ns = ticks × period, within the waited submission's wall time, and at least half of it in three of five. On a reference Mac, alpha (`test.burn` 20,000 loops at 1024²) measured over 2 ms in frames 1–30 steps down for frame health at frame ≥ 30, bravo (one box) never steps down |
| `#379.1e889bee` | A counting allocator sees zero heap allocations per frame after warm-up | `allocs.test.ts`: two moving writers on Metal, both stubbed at 1 ms, a camera move at 150, 300 frames: frames 61–300 count 0 allocations, no rung change; `allocates_per_frame` fails naming frame 61 |
| `#379.d5e81f8a` | GPU memory stays under 256 MB per window full screen on the reference Mac's display, measured on the device, with a live 3D view at the internal scale and frame-history window that fit; the check's memory estimate counts the slots, the HDR slots and frame history, and refuses a document that can't fit at scale 0.5 with a 2-frame window, naming the size | `window-memory.test.ts`: a showpiece of 20 boxes under an orbiting camera with an 8-frame history window, at the reference display's size: live, every frame drawn at an internal scale in 0.5..1 and a window of 2..8 frames, the device's allocated size above its value before the call under 256 × 10^6 B at its peak and above two slots at scale 0.5 (the measure sees the view); the meter's estimate lists `slots`, `hdr_slots` and `frame_history` (slots and history above 0) and fits. The same document at 8192 × 8192 is refused with an error naming 8192, never drawn, while at 1920 × 1080 it is live |
| `#379.57ab116a` | A document whose estimated CPU time, GPU time or GPU memory per frame exceeds its budget class is refused before it shows, naming its top three contributors, and the same document gives the same refusal under another machine's environment; every shipped primitive declares its cost model and has a micro-benchmark in the local preflight | `estimate.test.ts`: the five-path board, class core view with caps tightened to 0.001 ms: refused, no snapshot, one `over_budget` error whose `ids` are exactly the 4,000-, 3,000- and 2,000-segment paths and whose `actual` holds the estimate with a reference Mac's fingerprint; one 10-segment path in a data view is presented. Under `machine` Mac15,7, Mac14,6 and none, the issues are equal; `estimates_on_this_machine` makes them differ, named by path. `registry`: every operator and pass (scene3d's two among them) has terms (one positive, none negative), a reference Mac's fingerprint and a benchmark task in `budgets.json`, valid against the merge base, and each such task's command exits 0 |
| `#379.2299cd3b` | Each ladder change records its reason (initial, headroom, frame health, battery or you) and the meter shows it; a change compiles the new rung's pipelines off-screen first, so no frame during the switch exceeds its class's frame time; with a stub battery discharging at 25%, the live view steps down one rung and stops climbing | `reasons.test.ts`, on the stub meter (alpha 3 ms for frames 1–45, then 1; bravo 1): alpha initial, frame health at 30, headroom at 420 (120 after the view change at 300), battery at 460; bravo initial, you at 100 (to `lod_down`), battery at 460; all five reasons; the meter's rows show each writer's rung and reason and a 120-frame ring. Battery: the control at 80% climbs at 420; at 25% from 200 the view steps down one rung at 200 for the battery and never climbs, the view change at 300 included. On Metal your change to `internal_scale_down` at 60 compiles its new pipelines off the UI thread before it takes effect, every frame of the switch draws at the old rung until then and the new one after, below scale 1; `compiles_at_swap` fails naming the frame; on a reference Mac the switch's worst frame is judged against 2 ms GPU and 4 ms CPU over five runs |
| `#379.0806d709` | Two writers' documents in one window each hold a 4096 × 4096 rgba8 texture with all its mips and a 200,000-vertex mesh by equal content keys, allocated once on the device: each writer's meter count holds both in full before and after the other writer's session closes, the surviving writer's next 120 frames have the pixel hashes of a run where it was alone, and the device's allocated size falls by the pair's size only once both sessions have closed and the queue has drained. Over 200 cycles a writer opens a document with a 20,000-vertex mesh keyed by the cycle number, sends one revision the check refuses, one superseded before the latch and one naming an asset whose bytes fail their sha256, then closes; after cycle 200 the core's cache entries and byte count equal those after cycle 10, and the device's allocated size is within 2 MiB of its cycle-10 value. A planted cache that charges a shared result to its first holder alone changes the surviving writer's count when the first closes, and one that keeps results no current revision reads grows by about 1 MB a cycle; each fails, naming the writer or the cycle | `shared.test.ts`, part one: at frame 60 both writers hold the same keys (at least two) whose bytes cover the texture's whole chain and the mesh, each writer's count holds them, bravo's count doesn't move from 60 to 180; the device holds the pair once (≥ the pair, < 1.5 pairs), keeps it while bravo lives, frees alpha's own share within 2 MiB at alpha's close and bravo's whole count within 2 MiB once both closed; bravo's frames 61–180 equal its run alone by pixel hash. `charges_first_holder` fails naming bravo. Part two, 200 cycles of five frames: each sampled cycle's revisions are current, refused, superseded, refused-or-failed, its mesh counted while open; the cache after every cycle equals cycle 10's; the device after cycle 200 is within 2 MiB of cycle 10's; `keeps_unread_results` fails naming cycle 11 and grows by at least a mesh a cycle |
| `#379.20ef578a` | A test writer creates a 2048 × 2048 rgba8 texture with all 12 mips, a 512 × 512 rgba16float cube with all 10 mips, a 1920 × 1080 depth32 target and a 1920 × 1080 rgba8 4× MSAA color target marked transient: its meter count equals within 1% the sum of the sizes the device reports for those allocations, and on Metal the device's allocated size moves by that count within 1 MiB when they're created and again when they're released. A planted count of width × height × bytes per texel × samples counts the base level and one face and charges the memoryless MSAA target its four samples; it misses the first, second and fourth by at least 5 MiB each and fails, naming them. A resource the device can't size makes the writer's memory limit BLOCKED, never PASS | `allocations.test.ts`: each allocation's device size at least its whole chain (faces, mips), the transient MSAA target 0 on the device and in the count, the count the rows' sum and within 1% of the device's, Metal's allocated size moving by it within 1 MiB on creation and on release, the limit PASS; `formula_count` fails the 1% check, missing exactly `color-2048`, `cube-512` and `msaa-1080p` by at least 5 MiB, named; an `unsizable` resource makes the limit BLOCKED, naming it |
| `#379.1fbf8952` | With a stub meter charging a work-product writer 3 ms of GPU per frame for frames 1 to 75, then 1 ms, and a second writer 1 ms throughout: the first steps to effects off at frame 30 and to LOD down at frame 60, each with reason frame health; it stays there with the view still for 600 frames; after a camera move at frame 700 it climbs one rung at frame 820; the second writer's rung never changes; one 3 ms frame among 1 ms frames changes nothing. A ladder that steps on the first slow frame, skips a rung or steps the second writer fails, naming the frame and the rung | `ladder.test.ts`, 900 frames on noop: alpha's changes exactly initial at 1, base → effects off at 30 and → LOD down at 60 (frame health), LOD down → effects off at 820 (headroom) after the camera move at 700; LOD down drawn from the 60 step to 820, effects off after; bravo only initial, base every frame. One 3 ms frame at 150 among 1 ms frames: only the initial rungs. Each planted ladder fails, naming frame 1 and effects off, frame 30 and LOD down, frame 30 and bravo's effects off |
| `#379.459fdbc0` | With a stub meter forcing frame-health step-downs and an operator measured at 3 times its declaration, a render-back, an export frame and a frame-budget run of the same revision each draw at the class's base rung with the operator at full resolution, equal by pixel hash to a fresh process's; a planted meter shared with the headless worker draws the render-back at half scale and fails, naming the rung | `canonical.test.ts`: alpha stubbed at 5 ms with `test.burn` measured at 3 times its declaration steps down at least twice and is below base at frame 100; there the render-back, export frame and frame-budget frame of frame 10 each draw at `base`, scale 1, every operator (`test.burn` among them) at resolution 1, equal by pixel hash to a fresh process's `canonical`; `shares_meter_with_worker` draws the render-back at scale 0.5 and fails, naming the rung |
| `#379.7cc48ffe` | For each budget class's fixture, the perf lane records three timings on the reference Mac with its environment fingerprint: cold, a fresh process opening the fixture to its first settled frame; warm, frame times judged against the class; and the authoring loop, once for a patch that moves the Q3 bar from 44 to 48 and once for one that adds a mark kind the chart didn't use, and so a new pipeline, each to its settled frame. Warm frames pass or fail against the class, while cold and authoring-loop timings are kept as readings beside the merge base's and never fail a change. A lane that records warm frames only, or one that fails a change on a cold reading, fails this test, naming the class | `perf-lane.test.ts`: six tasks in `budgets.json`, valid against the merge base; on a reference Mac each class's report carries this Mac's fingerprint, a cold time, five warm runs of at least 300 frames against the class's limits, the values patch (no pipeline) and the pipeline patch (one or more), and a fixture in the checkout; `--planted warm_only` fails naming the class. The judge: cold and authoring ten times the base's with warm within passes, readings kept beside the base's; warm over fails naming the class; 3 ms of CPU fails a data view and passes a figure; `--planted fails_on_cold` fails the check naming the class |

`stubs.test.ts` holds the fences: the shipped build answers a plain `live` call and refuses `stub_meter`,
`stub_battery`, `report: ["allocs"]`, `allocate` and `release` with `bad_input` and a `test.mesh@1` document with
`module_missing` naming `test.gpu`, while the `test-meter` build takes each; and the JSON-lines convention for the new
call and arguments (`--withhold timestamps` starts; an unknown planted name or withheld feature ends with one
`bad_input` line and status 2). Each fence carries the ID of the criterion whose stub it fences.

## Readings where the issue and design leave a choice

- **One binary for the live window.** The meter, the ladder, the cache and the device are the canvas core's GPU side,
  which #377's `deep-gpu` drives headless; `live` is one more call there, standing in for the app's window of
  sessions, as `view3d` did for #378. The document check's estimate goes through #393's `deep_show` (agents show
  documents there); the registry already lists the operators. The perf lane is `budgets.json` plus `canvas.mjs`, as
  #96's tasks are.
- **"Two writers"** are two sessions in one window, each one writer's document of its own (a writer layer each). The
  ladder steps per session, which is per writer layer here; "its share" is read as its class's frame limit, so the
  criterion's numbers (3 ms and 1 ms against the work product's 2 ms) decide. Frames are numbered from 1, as the
  criterion's are; a change decided at the end of frame k is recorded at k.
- **"The view still"** is no view input: both documents move by a channel so every frame draws ("every class draws
  nothing while still" applies to a view that doesn't change at all); the camera move is your input on that view.
- **The climb.** Climbing back after a frame-health drop is recorded with reason `headroom`. The criterion fixes that
  a writer at 1 ms against 2 ms with no view change never changes rung, so the stub runs never climb above base; runs
  end before a second climb could be due (120 frames after the first).
- **The battery.** A stub reading arriving at frame k acts at frame k: one rung down from the rung held, reason
  `battery`, and no climb after it, even after a view change that would otherwise climb (the control run shows it).
- **Off-screen compile.** Read on your change to `internal_scale_down`, whose upscale and sharpen are new pipelines
  (GPU surface). Pipelines already compiled need no compile; those listed must be compiled off the UI thread before
  the rung takes effect, and every frame until then draws at the old rung. "No frame during the switch exceeds its
  class's frame time" is the worst frame from the change to 10 frames after it takes effect, judged over five runs.
- **Pass timings.** The covered-time arithmetic is checked exactly on stub intervals, since a real GPU's overlap can't
  be planned; on the device every frame must equal its passes' union within 1 µs. "Records the reference Mac's
  timestamp features" is the `adapter` reply, logged with the run. The tick check reads one waited submission's
  timestamps against its wall time: never longer, and at least half of it in three of five tries (scheduling under
  load can stretch the wall time).
- **The counting allocator** counts the canvas core's frame path, not wgpu's or the driver's own allocations, which
  the core can't change; the frame-budget check's "zero heap allocations after warm-up" is read the same way.
  Warm-up is frames 1–60.
- **256 MB** is 256 × 10^6 bytes (the issue writes MiB where it means 2^20). "Per window" is the device's allocated
  size less its value before the window's view opened, at its peak over 60 frames of an orbiting showpiece with frame
  history. The 8192 × 8192 document can't fit at scale 0.5 with 2 frames by any count (its slots alone pass 256 MB);
  "naming the size" is an error issue whose JSON holds 8192.
- **Top three contributors** are made unambiguous by five paths whose segment counts differ by orders of magnitude;
  a cost model with per-vertex or per-pixel terms ranks them so. The caps the document tightens to 0.001 ms make any
  estimate over, so the refusal doesn't rest on the implementer's coefficients.
- **"Under another machine's environment"** is the scenario's `machine`, standing in for the machine the hub runs on;
  the refusal must be byte for byte the same under a reference Mac, a non-reference Mac and this machine.
- **Shipped primitives** are the operators and render passes the full build registers; each one's micro-benchmark is a
  perf-lane task (the local preflight runs `scripts/perf.mjs` over `budgets.json`), which the test runs once.
- **Shared results.** A result's bytes are what the device reports for its allocations. "Allocated once" is the
  device holding less than one and a half pairs; "falls by the pair's size only once both have closed" is read
  exactly through the counts: alpha's close frees alpha's count less the pair, bravo's close frees bravo's whole
  count, each within 2 MiB, and the pair stays resident in between.
- **The cycles.** The refused revision names an item's layer (a payload may never name one: #393's refusal); the
  superseded one arrives before the asset one at the same latch; the asset's file holds bytes that don't match its
  sha256. Each cycle is five frames (open, refuse, supersede and fail, close, idle); "after cycle c" is its idle frame.
- **The test writer's allocations** are named by the test; the device's size for each is checked against its whole
  chain of mips and faces, and the memoryless MSAA target against 0, as the design asks ("0 for a memoryless target").
- **Canonical renders** are asked in the same process as the degraded live session (`canonical` events) and in a fresh
  one (`canonical` call); "half scale" is `internal_scale` 0.5, read at frame 100, when the live view holds
  `internal_scale_down` (steps at 30, 60, 90).
- **The perf lane's three timings** are a class's report; "warm frames judged against the class" is the judge's
  verdict from the class's limits, not from the report's; the readings never decide it.
- **`cost_delta`** (the owner's comment from #96): no criterion asks for it, so no test reads it; `marks_check` is
  where an implementation sums a patch's cost change.

Not tested, because no criterion asks or the surface can't reach it: the app cap's eviction of least recently visible
sessions; the climb above base from setup coefficients and after a GPU or driver change; the 30 Hz, freeze and
placeholder rungs; a document shown inside another (the stricter class, its still); HDR output's own slots on an XDR
display (headless has none, so `hdr_slots` may be 0); scopes other than `writer`; the frame-budget check kind's
five-run judgment and its envelope; the merge-base comparison of the per-class timings, which is the perf lane's.

## Upstream tests (the Oracle lane)

The Oracle page says no engine's or project's own test checks these criteria; these tests are their local proof.
