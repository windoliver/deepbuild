# Acceptance tests for #380: shipped effects as GPU operators — glow, shadows, outlines, the ground grid and particles

Written first, from issue #380 (its scope, the GPU operator's fields and "It can never" line, its eight acceptance
criteria and its proof line), its Oracle page (`doneright/oracles/issues/380.md`) and the upstream test family it
names, the design sections it links and those they lean on, and base commit `d122341` ("Merge pull request #737
…"), by a job that never saw an implementation; none existed. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- `docs/technical-design.md`: Canvas (516: "every session's line … draw through it"; "DeepBuild's own lines use
  it"; effects "from a library that ships with the app"; "Only the app talks to the GPU; plug-ins and agents
  describe scenes"); Canvas modules (the `effects` row: shipped effects as GPU operators, closed-form particles; the
  `look` row: bloom); Numbers version 0 has to hold (Every task carries its own budgets: five runs after warm-up,
  the margin, a stated p95 over at least 300 frames; the reference Macs); How we know version 0 works (the canvas
  bullet: "nothing draws outside its panel"; the parity suite: goldens blessed only by your decision, a golden's
  first blessing, the blank guard, "Images from two renderers compare through one perceptual oracle"; "A CPU
  reference counts as an oracle only once it reproduces at least one fixture whose expected numbers the issue
  states, or the formula source its oracle page names gives, and its own planted twin fails"; every share sets a
  ceiling and a window bound; golden triage); Dogfooding; the Decided rows on bundled media (never GPL).
- `docs/canvas-primitives.md`: the whole of GPU operators, as data (GPU operator; Step and the closed step list,
  and its structural steps; Operator input and output; Place in the frame; Compile, validate and cache, pass
  fusion and the WGSL subset; Operator cost and limits; Determinism class, with the environment fingerprint and
  "A golden recorded under another fingerprint reads INCONCLUSIVE, naming both"; Status guard; Shipped operators
  and composed graphs, and pack graphs; Draw path; Every public step; Operator budgets by class); The trusted
  compositor (GPU surface: "Bloom adds to color and leaves alpha"; Panel runtime and panel host: "Reach a GPU API
  … draw outside its panel" it can never; Render-back); Document envelope (`seed`, `requires.modules`, `look`,
  `aspect`); Look `look@1`: bloom ("Fields on the shipped glow: a mip chain (13-tap downsample, tent upsample)
  mixed into scene color before tone mapping. With no threshold it conserves energy"); Look `look@1`: ground grid
  in 3D (`ground_3d`); Light and the light policy (`light.sun`, `illuminance`, `shadow`); Selection ("the
  highlight is an outline"); Effect; Particles `particles@1` ("a closed-form function of its age, its index and
  the seed … seeking equals playing"); Paint: noise fill; Frame and group: union outline; the glossary rows for the
  perceptual oracle and places.
- Issue #380's dependencies as the base holds them (#378, #387, #305), and the Oracle page's family: the WebGPU
  CTS expression tests at `e325d0bcc2cb785c4eab1d908339019215bd9462` (`binary/`, `unary/`, `call/builtin/`; read
  for the case lists in `util/math.ts` and the non-const integer rules in `binary/i32_arithmetic.cache.ts`).
- At the base: AGENTS.md; `tests/acceptance/377/` (the `deep-gpu` binary, JSON lines, `--planted`, the `plugin`
  call and its fixture, `compare` with the blank guard, `declare_dark` by you or an agent, the reference-Mac gate
  with the owner's change, the judge), `378/` (the `view3d` call, its targets and files named by hash, scene3d
  documents, the look fixture, the pinhole projection, `requires.modules` after its redraft), `305/`, `387/` and
  `138/` READMEs (the criterion IDs, the build per binary, the kit's `golden`, `decide` and environment digest);
  `crates/deep-gpu-layer` (its calls), `crates/deep-scene3d-render`, `crates/deep-canvas-scene3d` (the R2 kinds,
  `Look3`), `crates/deep-show/src/kit` (goldens and the GPU lease), `crates/deep-app` (the session line in
  `views.rs`, drawn by `canvas.rs`), `scripts/lanes.mjs`.

What the base already does and these tests don't credit: `deep-gpu` (#377, #378) opens one device, runs a plug-in
fixture beside a live GPU-layer view, compares two images through the blank guard, and draws scene3d documents
(boxes, lines, text, points) unlit through `view3d`, writing the final, linear and ID targets; the canvas kit in
`deep-show` (#138) keeps digest goldens with an environment digest of OS and driver. The app's views hold no wgpu
code and depend on wgpu only through the GPU layer, and no shader in the checkout carries a GPL or Shadertoy
license (two of these tests' checks hold at the base for that reason). There is no effects module: no GPU
operator, no op table, no operator check, no bloom, shadows, outlines, ground grid or particles, no per-pass GPU
timing, no CPU reference, no golden of a GPU frame by fingerprint, and the app's session line is a polyline its view
paints itself (`crates/deep-app/src/canvas.rs`). So these tests define the surface below.

## Run them

They build one cargo binary, as #377's and #378's suites do, so they run with `--no-file-parallelism`.
`scripts/lanes.mjs` needs this folder in its `alone` list (the one-at-a-time unit-lane line, and so excluded from the
parallel line), beside `tests/acceptance/377/` and `378/`. This README is the instruction; the implementer makes
that edit.

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/380 --no-file-parallelism
npx tsc -p tests/acceptance/380/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Every file first builds the binary, once, with `cargo build --locked --bin deep-gpu` (with `CARGO_INCREMENTAL=0` and
`CARGO_PROFILE_DEV_DEBUG=0`) in the checkout, copies it out of `target/debug` to a temporary folder, and fails each
test that uses it if the build failed. `lines.test.ts` reads `cargo metadata --locked` and the app's sources and
builds nothing. Each test writes into its own temporary output folder and deletes it. The tests use node built-ins
and vitest. A run with `--root tests/acceptance/380` leaves Vitest's cache in `tests/acceptance/380/node_modules/.vite`;
delete it. `BASE-FAILURE.txt` is the run at the base.

The tests that draw run the GPU layer on Metal, on macOS, headless, as #377's and #378's do: off macOS they fail with
a message that starts `INCONCLUSIVE:`, and never pass there. `budgets.test.ts`'s judged tests skip as
`INCONCLUSIVE` off a reference Mac (Mac15,7 or Mac15,12, Low Power Mode off, thermal state nominal; on battery or
mains alike, by the owner's rule that mains power never gates); none passes by skipping. The real M1-against-M3 run
in `cts-exact.test.ts` needs a record made on an M1, named by `DEEPBUILD_M1_RECORD`; without it that test skips as
`BLOCKED`, saying how to unblock it, and never passes.

## The surface under test

The issue names the GPU operator's fields, the shipped effects, a test plug-in, a golden, budgets, refusals, noise
seeding and CPU references, but no code API. So these tests define the smallest surface they need on the binary that
exists: **#377's `deep-gpu run` with its JSON-lines protocol unchanged, #378's `view3d` call with three more fields,
#377's `plugin` call with five more fields, and eight new calls.** No new binary.

### `deep-gpu run [--backend noop] [--planted <name>]`

Unchanged: one scenario `{"out": dir, "calls": [Call]}` per stdin line, answered with exactly one line `{"ok": true,
"replies": [Reply]}`, one reply per call whatever its outcome, then exit 0; a line that isn't a scenario answers
`{"ok": false, "code": "bad_input"}`; an unknown argument or planted name answers one such line and exits 2. All
calls of a scenario run in one process on one device. Files are written under `out`, each named by the SHA-256 of
its bytes with its extension (`.png`, `.f32`, `.json`). A reply with a `code` is a refusal, except
`unsupported_platform` off the reference platform.

### Documents and the look (`fixtures/`, `helpers.ts`)

Documents use #378's shape (envelope, one writer layer, items as `family.name@major`), with `requires: {modules:
{scene3d: "^1", effects: "^1"}}`. Kinds beyond #378's, each with the design's fields:

- `light.sun@1` `{illuminance: lx, shadow: bool, angle: deg}`, turned by `at.rot` (degrees, applied as X, then Y,
  then Z); it shines along its local −Z, glTF's convention for lights. The fixtures' sun has `illuminance` π, so a
  white surface facing it reflects 1 at the exposure whose scale is 1.
- `particles@1` (Particles `particles@1`: `count`, `emit {anchor, shape, rate, span}`, `life`, `motion {ballistic
  {v0, gravity, drag}}`, `size`, `opacity`, `color` as roles over life, `draw`).

`fixtures/look.json` is a `look@1` (#378's status map and fonts, `basis: physical`, a near-black ground, one role
per fixture color, `tone_map: none`, `exposure` −log₂ 1.2, `finish: []`, `deband: none`) with `bloom: none` and
`ground_3d: {kind: none}`. Tests turn on the look's `bloom` (`{intensity: 0.3, radius: 0.85}`, no threshold) and
`ground_3d` (`{kind: grid, height: 0.001, spacing: 1, major_every: 5, width: 1, fade: auto, roles}`), and the
plug-in's look adds `tone_map: agx`.

`effectScene(effects)` in `helpers.ts` generates the effects scenes: a 1 m lamp box on a 12 m floor slab (top at
y = 0, so the grid's plane lies 1 mm above it), two smaller boxes, the sun, and a perspective camera orbiting at 60°
a second through a channel on `items/cam/params/orbit/azimuth`, at 480 × 360. Each shipped effect is turned on by
name: `glow` (the look's bloom), `shadow` (the sun's `shadow: true`), `outline` (the lamp selected), `grid` (the
look's `ground_3d`), `particles` (a `particles@1` item at the lamp's top), a list of them, or `all`.

| Fixture | What it is | Read by |
|---|---|---|
| `plugin/box-grid/` | The test plug-in: `main.js`, a panel script that tries `navigator.gpu.requestAdapter()` and draws one line saying how it went; `documents.json`, one scene (a lamp box on a floor, a sun that casts, a red bar running past the right edge; document size 640 × 360) and one request on its writer connection, `{"call": "gpu.request_device"}` | criterion 2 |
| `operators/*.json`, `operators/source-loop.wgsl` | A control pass operator and six shipped operators with one defect each (below) | criterion 6 |
| `look.json` | The look above | every drawing test |

### `view3d` (#378's call, three more fields)

```json
{"call": "view3d", …#378's fields…, "selection"?: [item ID], "from"?: 0, "timings"?: false}
```

- `selection`: the session's selection while the frames draw (Selection: session state); each selected item
  draws its outline.
- `from`: the first frame latched. The session opens at frame `from` (t = from ÷ fps) with nothing drawn before
  it, and the reply's frames run from `from` to `from + frames − 1`: a seek.
- `timings: true`: each frame adds `gpu_ms` (its GPU time, as wgpu-profiler's timestamp queries measure it) and
  `passes_ms: {pass name → ms}` for each pass the frame ran; the reply adds `profiler: {name: "wgpu-profiler",
  version}`. Each entry of the reply's `passes` adds `operator: name@major` when the pass runs a GPU operator.

### `plugin` (#377's call, five more fields)

```json
{"call": "plugin", "dir", "scene"?, "look"?: look@1,
 "window"?: {"size": [w, h], "page": [r, g, b]}, "panel"?: {"rect": [x, y, w, h], "header": px}, "capture"?: false}
```

With `panel`, the plug-in at `dir` loads as #377's call loads it (its panel in the app's panel runtime as the
plug-in's own, its documents handed to the canvas core as its revisions), in a headless window of `window.size`
whose page is `page`. Its panel sits at `panel.rect`; its script's element tree takes the top `header` px and the
panel's canvas view takes the rest of the panel, drawing the plug-in's first presented 3D document there through the
GPU layer with `look` standing in for the plug-in's look asset, at the canvas view's size, as `view3d` draws a
document at `size`. Each entry of `documents.json`'s `requests` is sent on the plug-in's writer connection. It
answers #377's reply with: `panel: {id, loaded, text, rect, canvas: [x, y, w, h]}` (the canvas view's rect in window
px), `requests: [{call, outcome: "accepted" | "refused", code?, reason?}]`, one per request, a refusal's `reason`
naming the call, and with `capture`,
`window`: the window capture (GPUI's offscreen render of the whole window, as #377's) as a PNG named by its hash.
`scene` may then be left out.

### `operators`

`{"call": "operators"}` → `{"operators": [{"name": name@major, "kind": "material" | "pass" | "compute", "origin":
"shipped" | "pack" | "composed", "effect": string | null, "determinism", "noise": bool, "ported": [Port],
"fixture"?: path}]}`: every operator the build holds. `effect` names the shipped effect an operator is: `glow`,
`shadow`, `outline`, `grid`, `particles`, or another the library ships (`ripple`, `noise_fill`, `light`, …), null
for the rest. `noise`: whether it draws seeded noise or random values. A `Port` is `{"files": [path], "from": url,
"license": SPDX ID, "notice": path}`: the shader sources it ports (paths from the checkout's root), where they came
from, their license and the notice file. `fixture`: the document a shipped effect outside the five above is checked
on (its module's parity fixture).

### `reference`

```json
{"call": "reference", "operator": name@major, "look": look@1, "size": [w, h],
 "doc"?: path, "selection"?: [item ID], "input"?: {"color": path}}
```

Draws frame 0 of `doc` (as `view3d` would) up to the operator's place, reads back its inputs, and runs the operator
on this machine's GPU and its CPU reference (reviewed test code, f64) on those same inputs. With `input`, the
operator's color input is that f32 file instead (and `doc` may be left out). It answers `{"operator", "kind",
"encoding": "linear" | "display", "size", "input": sha256, "gpu": sha256, "cpu": sha256}`, each an `.f32` file:
little-endian f32 RGBA, rows top-down, `w × h × 16` bytes. `encoding` says whether the operator's output is linear
light (the effects chain) or display-referred (the finish).

### `golden` and `decide`

```json
{"call": "golden", "store": dir, "fixture": name, "png"?: path, "view3d"?: View3dCall,
 "environment"?: {"os"?, "gpu"?, "driver"?, "wgpu"?}}
{"call": "decide", "store": dir, "via": "you" | "agent", "decision": {"bless": {"fixture", "png"}}}
```

`golden` judges a snapshot of a GPU frame (a PNG, or frame 0's final target of a `view3d` call it makes) against the
fixture's golden in `store`, through the perceptual oracle (the blank guard first). It answers `{"verdict": "PASS" |
"FAIL" | "BLOCKED" | "INCONCLUSIVE", "reason"?, "fingerprint": {os, gpu, driver, wgpu}, "golden": {fingerprint,
digest} | null, "oracle": "perceptual", "numbers"?: {…}, "ask"?: {kind: "bless", fixture}}`. `fingerprint` is
this run's environment: the OS's version and build, the GPU's name, its driver, and the wgpu version the binary
was built with; `environment` stands in for an update to any of them, as #138's does. `numbers` holds the
comparison's numbers and is present only when a comparison ran. Reasons: `no_golden` (with the bless `ask`),
`no_snapshot` (the PNG isn't there, or the frame couldn't be drawn), `environment_changed`, `blank`. `decide`
answers `{"outcome": "decided" | "refused", "code"?}`; `via` stands in for the connection's identity, as #377's
`declare_dark` does, and an agent's decision is refused with `not_your_decision`. A blessing records the PNG as the
fixture's golden under this run's fingerprint.

### `check_operator`

`{"call": "check_operator", "operator": GPU operator, "assets"?: {asset ID → path}}` runs the core's operator check
(Compile, validate and cache: schema, closed ops, types, DAG, fixed repeat counts, the kind's rules, determinism,
limits, cost) on the operator, and only if it passes compiles it (WGSL written by the core, naga, a pipeline) and
runs it once on a 64 × 64 frame. It answers `{"outcome": "accepted" | "refused", "issues": [{code, severity, step?,
path?, line?, column?, construct?}], "reached": {"naga": bool, "pipeline": bool, "gpu": bool}}`: how far the
operator got. Operators are written with the design's fields: `inputs` as `{type, unit, range, default, from}`;
`steps` as `{op: name@major, args}`, an arg naming a step ID (`id.port` for a named output), an input or a literal;
a `repeat` step's `accumulate` maps each accumulator to its initial value, and a body step whose ID is an
accumulator's name gives its next value; `outputs` map each output to the step that gives it; `source: {wgsl:
asset ID}` with the asset's file in `assets`.

### `op`

`{"call": "op", "op": name@major, "types": [type], "rows": [[u32 bits]]}` builds a compute operator from public
steps (an input per argument, the step `op`, a write of its result), checks, compiles and dispatches it over the
rows, and runs the same graph through the step graph's CPU interpreter. Arguments go as bits (i32 two's complement,
f32 IEEE 754, bool 0 or 1), so −0 and subnormals arrive exactly. It answers `{"gpu": [u32 bits], "cpu": [number |
null]}`, one each per row (null where the interpreter's result isn't a finite number).

### `exact` and `cross_gpu`

`{"call": "exact"}` runs every shipped exact operator on its exactness fixture on this GPU and writes a record,
`{"format": 1, "gpu": {"name", "family"}, "os", "wgpu", "operators": {name@major → sha256 of its output bits}}`
(`family`: the Metal GPU family, `apple7` for an M1, `apple9` for an M3), answering `{"record": sha256, "gpu",
"operators": [{name, bits}]}`. `{"call": "cross_gpu", "records": [path]}` compares records: with fewer than two GPU
families among them it answers `{"result": "BLOCKED", "families", "asks": [one unblock ask]}`; otherwise PASS when
every exact operator's bits are equal, else FAIL with `differs: [{operator, …}]` naming each.

### Planted programs (`deep-gpu run --planted <name>`, each reachable only there)

| Name | The wrong program | Criterion |
|---|---|---|
| `host_unclipped` | The plug-in host draws the panel's canvas view at its document's size from the view's origin, unclipped, so the scene draws past the panel's bounds | 2 (issue-named) |
| `slow_glow` | The glow's pass blurs at full resolution 64 times | 3 (a mutant: the measure must see the glow) |
| `compares_any_environment` | The golden compares under any fingerprint | 5 (a mutant) |
| `fails_missing_snapshot` | A missing snapshot reads FAIL | 5 (a mutant) |
| `skips_operator_check` | Operators compile and run without the core's check | 6 (a mutant) |
| `noise_from_frame_counter` | Every shipped operator that draws seeded noise or random values keys it by the session's frame counter | 7 (issue-named) |
| `noise_from_clock` | The same, keyed by the wall clock | 7 (issue-named) |
| `pass_off_by_two` | Every shipped pass operator's GPU output is two 10-bit codes higher in red | 8 (a mutant) |
| `bloom_without_karis` | The glow's first downsample takes a plain average, on the GPU and in its CPU reference alike | 8 (a mutant, for the scope's Karis average) |
| `passes_one_gpu` | `cross_gpu` reads one GPU family as PASS | 8 (issue-named: "never PASS") |

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the
leading `- [ ] ` dropped (#305's command, with the issue's eight criterion lines on stdin). Each test's name starts
with its criterion's ID. Where a criterion names a wrong program, the test runs it through `--planted` and asserts it
fails the way the criterion says; where it names none, a planted mutant or the check's own twin (the check run on a
doctored copy of the real output) shows the check can fail.

| ID | Criterion (the issue's text) | Tests, what each asserts, and the wrong programs |
|---|---|---|
| `#380.3893743e` | DeepBuild's lines are drawn only with the canvas's primitives and effects, with no view-specific GPU code | `lines.test.ts`: `deep-app` (the app's views, the session line among them) depends directly on no GPU API crate (wgpu, naga, metal, …), only on the GPU layer; no file of it is a shader or holds shader text or a GPU API call; no view paints a path, quad or sprite with GPUI's low-level calls. Twins: wgpu planted under deep-app, a view with its own shader module, a shader file, a view that paints its own line, each failing, named. Wrong programs: the base (the line is a polyline its view paints); a line with its own GPU code |
| `#380.32634ba0` | A test plug-in draws a 3D scene of a box on the ground grid with glow and a shadow by describing it, matching that scene's golden, blessed by your decision, through the perceptual oracle; a part of its scene placed past the panel's edge is clipped there, and its call to open a GPU device is refused, naming the call; a planted host that lets the scene draw past the panel's bounds fails, naming the panel | `plugin-scene.test.ts`: the fixture's bar starts in the frame and ends past its right edge (by the pinhole projection); the plug-in's scene is presented with no error; its `gpu.request_device` is refused and the refusal names it; its script's `navigator.gpu.requestAdapter()` fails; one device; outside the panel the window is exactly the page, and the bar reaches the canvas view's last column. The panel's drawing equals `view3d`'s frame of the document within 2 codes on 99.9% of pixels, none past 8, and that frame shows the lamp (2,000 px or more, brighter than the floor), the grid's lines (500 floor pixels up to half the floor), the glow's halo (the floor 3–12 px around the lamp 0.02 brighter than with bloom off) and the shadow (300 floor pixels 25% darker than with the sun's shadow off, 80% of them within 64 px of the lamp); each variant fails that check for what it lacks. Golden: BLOCKED `no_golden` with a bless ask; an agent's blessing refused `not_your_decision`; yours decided once the checks above hold; a fresh run's drawing PASS through the perceptual oracle, with numbers; the scene without its glow, its shadow or its grid FAIL; a black frame BLOCKED with no numbers. `--planted host_unclipped` fails the clip check, naming the panel. Wrong programs: a host that doesn't clip; a GPU route for plug-ins; a scene missing its glow, shadow or grid |
| `#380.c9214bdc` | On the reference Mac, a window-sized 3D scene with glow, shadows and outlines costs under 2 ms of GPU time per frame, measured with wgpu-profiler | `budgets.test.ts`: the scene at 1936 × 1584 with bloom, the sun casting and three boxes selected, 600 frames: the reply names wgpu-profiler at a version in the binary's dependency tree; the glow's, the shadows' and the outlines' operators each run a pass timed in every frame, and each frame's passes fit in its GPU time. Five runs after a warm-up: each run's worst frame ≤ 2 ms by the judge; GPU time per effect printed (the proof line). `--planted slow_glow` judged FAIL. Wrong programs: an effect over budget; a measure that doesn't see the glow |
| `#380.993f9e93` | Every ported shader keeps its license beside it, and none comes from a GPL source or under Shadertoy's default license | `licenses.test.ts`: each shipped operator's ports: files and notice in the checkout, the notice in the same folder as each file and holding its license's text, each file's header naming its source and license, the license permissive (never GPL, LGPL, AGPL, NonCommercial or ShareAlike, nor Shadertoy's default CC BY-NC-SA 3.0); the list is printed (the proof line). The checkout's shader sources and the notices beside them hold no GPL or Shadertoy-default text, and a source naming Shadertoy is a listed port. Twins: a GPL port, a Shadertoy port under its default license, a missing notice, a notice in another folder, a shader with GPL text, each failing, named. Wrong programs: a GPL or Shadertoy-default port; a port without its license |
| `#380.3b28146e` | A GPU golden compares only under an equal environment fingerprint (OS, GPU, driver, wgpu version), and a missing snapshot is BLOCKED, never FAIL | `goldens.test.ts`: the glow scene's frame blessed by you: the fingerprint is this Mac's OS version, its chip's GPU, a driver and the wgpu version of the binary's tree; the frame PASS and a changed copy FAIL with numbers under it; under another OS, GPU, driver or wgpu version each is neither PASS nor FAIL, `environment_changed`, naming both values, with no numbers. No golden, a PNG that isn't there and a frame whose document is refused each BLOCKED (`no_golden`, `no_snapshot`) with no numbers. `--planted compares_any_environment` and `--planted fails_missing_snapshot` fail those checks. Wrong programs: a golden compared across fingerprints; a missing snapshot read as FAIL |
| `#380.e70d1419` | A shipped operator with a loop whose count isn't fixed, an index past a declared length, or shader text is refused before it reaches the GPU | `refusals.test.ts`: the control accepted, reaching naga, a pipeline and the GPU; refused with an error naming the defect and reaching none of them: a repeat counted by an input with no maximum, and by one up to 1,000 (`operator_unbounded`, step `sum`); a write at element 20 of 16 (`operator_limit` or `operator_type`, step `pick`); WGSL in a field (an error whose path is `wgsl`); a `wgsl@1` step (`operator_unknown_op`, step `raw`); a WGSL-subset `loop` (`operator_source`, line 4, construct `loop`). `--planted skips_operator_check` lets one through and fails, named. Wrong programs: a check that runs after the GPU or lets any of them through |
| `#380.b40177b9` | Every shipped pass that uses noise seeds it from a hash of the pixel and the item's seed, never from a frame counter or the clock, so seeking to any time equals playing to it on the same machine's pixel hash for every shipped effect | `seek.test.ts`: for every shipped effect (the five scenes, or an extra effect's own fixture): frames 30 and 90 sought in fresh processes equal frames 30 and 90 played, two plays equal at 90, and 30 differs from 90. Every operator with `noise` (at least one): its scene differs between document seeds 1 and 2 and repeats at seed 1 in two processes. `--planted noise_from_frame_counter` and `--planted noise_from_clock` each break seek against play, named by effect. Wrong programs: noise from a frame counter or the clock; noise that ignores the item's seed |
| `#380.639458be` | Every shipped pass operator matches its CPU reference within one 10-bit code value per channel on 99.9% of pixels on the same machine, and every exact operator gives identical bits on two GPUs of different families (an M1 and an M3); with one GPU that comparison is BLOCKED with one unblock ask, never PASS | `reference.test.ts`: every shipped pass operator (the glow, outline and grid among them) on its effect's scene: GPU against CPU within 1 code on 99.9%, none past 4, no 16 × 16 window with more than 8 off, its output not blank, its reference changing at least 100 pixels. Formula fixtures for the references (and the GPU): the glow passes a uniform 0.25 field within one code, and a firefly of 64 spreads at most twice the light one of 16 does (the Karis average; a plain average gives 4×), more than 0.02 of it; `--planted bloom_without_karis` fails that. The grid at 0.25 px draws 0.25 ± 5% of the 1 px grid on 95% of its line pixels and in total, nothing where the 1 px grid draws nothing. `--planted pass_off_by_two` fails, naming the operator. `cts-exact.test.ts`: the CTS port (below), integers and bools exactly, f32 in CTS's intervals, on the GPU and the CPU interpreter, with twins; this GPU's exact record holds every shipped exact operator (at least one) and names this chip and its Metal family; one family BLOCKED with exactly one unblock ask, as are two of one family; another family's equal bits PASS and a changed operator FAIL, named; `--planted passes_one_gpu` caught; with `DEEPBUILD_M1_RECORD`, the M1's record against this M3's PASS, else BLOCKED (a skip). Wrong programs: a pass off its reference; a reference that isn't an oracle; exactness claimed on one GPU |

## Readings where the issue and design leave a choice

- **One binary.** The GPU layer, the plug-in host's fixture, `view3d` and `--planted` are #377's and #378's
  `deep-gpu`; the effects draw through it, so this suite adds calls there rather than a binary. The golden is a
  call on it too, not #138's kit call, since the kit's golden store holds digests of its own fixtures and its GPU
  backend draws no 3D scene, while this golden judges GPU frames through the perceptual oracle; its words
  (`no_golden`, `environment_changed`, `not_your_decision`, the bless ask) are #138's.
- **"DeepBuild's lines"** are the app's own line views (the session line in `crates/deep-app/src/views.rs`), so
  criterion 1 is read on the app's crate: "no view-specific GPU code" as no GPU crate, shader or GPU API call there,
  and "only with the canvas's primitives and effects" as no drawing of its own with GPUI's low-level paint calls;
  the GPU layer's surface paint (`paint_surface`) and the canvas text module's labels are the canvas's own.
- **The shipped effects** are driven by the design's own fields: the glow is the look's `bloom` ("fields on the
  shipped glow"), the grid the look's `ground_3d`, shadows the sun's `shadow`, outlines the session's selection,
  particles a `particles@1` item. "Shadows" fall on a floor slab, the writer's own ground, whose top is 1 mm under
  the grid's plane; the grid draws its lines over it ("It can never: … draw below a writer's own ground").
- **The plug-in's scene** is checked against the same document drawn by `view3d` with each effect taken out, so
  your blessing follows checks of what the scene shows; the test stands in for you, as `via: "you"` stands in for
  your connection. The golden then gates later runs. Its comparison is the perceptual oracle's (FLIP pooled with
  its guards, reviewed test code in the binary); this suite holds it to passing the same scene and failing it
  without its glow, its shadow or its grid, so its thresholds must see each. "Clipped there" is read as the bar
  drawn up to the canvas view's last column and the window outside the panel exactly the page; the planted host
  draws the document at its own 640 × 360 size, 160 px past the panel. The device call is the plug-in's request on
  its writer connection, refused naming it; the script's own try finds no WebGPU entry point (#377's probe requires
  `navigator.gpu` absent, so no refusing stub is put there).
- **Window-sized** is the reference window the GPU surface's numbers use, 1936 × 1584. "Per frame" is each run's
  worst frame of 600, as #377's suite reads its UI-thread limit; the frames run with the camera orbiting so none
  repeats the last. "Measured with wgpu-profiler" is the reply naming it at a version in the binary's tree, with
  every frame and each effect's pass timed.
- **Ported shaders** are the ones an operator says it ports; the design lets shipped operators carry hand-written
  WGSL, so a listing is the only place a port shows. "Beside it" is a notice in the same folder; AGENTS.md's rule
  that ported code keeps its license notice in the receiving file is the header check. An empty list passes the
  first test only with the five effects shipped as operators; the checkout-wide scan covers what a listing leaves
  out.
- **Fingerprint and missing snapshots.** The fingerprint is the criterion's four fields; the design's fuller one
  (core counts, naga, backend, the build's digest) may hold more. Under another fingerprint the design says
  INCONCLUSIVE, #138 BLOCKED; either reads as "doesn't compare". A missing snapshot is read three ways: no golden
  yet, a snapshot file that isn't there, and a frame that can't be drawn because its document is refused.
- **Refusals.** "A shipped operator" with each defect is an operator of origin `shipped` handed to the core's check:
  the design holds shipped operators to the same check, internal steps aside. "A loop whose count isn't fixed" is
  a repeat counted by an input with no maximum or one past 64, and a WGSL-subset `loop`; "an index past a declared
  length" is a constant write past a storage output's count (`index` on a small array clamps, so it isn't one);
  "shader text" is WGSL in a field or a step. "Before it reaches the GPU" is read on `reached`: naga, a pipeline,
  the device.
- **Noise.** "Seeking to any time equals playing to it" is checked at two times per effect, in fresh processes.
  "Seeds it from a hash of the pixel and the item's seed" is read from outside as: the frames depend on the item's
  seed (a document's seed changes every item's) and on nothing a run carries (no frame counter, no clock). Which
  passes draw noise is the operators call's `noise`; particles' draws count, since they're seeded per particle.
- **10-bit codes.** A linear output is sRGB-encoded before it's quantized to 10 bits (a code is then a step the
  display shows), a display-referred one is taken as it is; alpha as it is. The ceiling (4 codes, one 8-bit code)
  and the window (16 × 16, 8 pixels) are this suite's, with the reason in `helpers.ts`.
- **The CPU references as oracles.** The CTS port holds the step graph's interpreter and the GPU's lowering to
  CTS's formulas op by op, which is what the shipped operators lower to; the glow's and the grid's references are
  also held to fixtures whose numbers the formula and the issue give: energy conservation with no threshold, the
  Karis average's saturation, and fading by width. The firefly bound of 2 sits between what a Karis average gives
  (about 1.06 for a 2 × 2 group, up to about 1.25 where bilinear taps split the pixel) and a plain average's 4.
- **The exact comparison.** Two GPUs are compared by records, since one machine has one GPU; the family is the
  Metal GPU family. The check's twins are this machine's record relabelled; only a record an M1 made proves the
  criterion's M1-against-M3 half, and without one it stays BLOCKED with one unblock ask.

Not tested, because no criterion asks or the surface can't reach it: ripples, noise fills and light beyond seek
against play and their references when shipped; the status guard; pass fusion; the cost model's calibration and
`cost_understated`; the budget by class; composed and pack graphs; the order of places in the frame; the meter's
step-down; HDR; the merge-base comparison of the budget, which is the perf lane's; the effects audit.

## Upstream tests (the Oracle lane)

The Oracle page links one upstream family, for criterion 8: the WebGPU CTS expression tests at
`e325d0bcc2cb785c4eab1d908339019215bd9462`, `src/webgpu/shader/execution/expression/binary`, `unary` and
`call/builtin`, marked "port; formula". `cts-exact.test.ts` ports the families its header lists, with CTS's sparse
value lists and expected-value formulas, and runs them against our operators through `deep-gpu`'s `op` call, on our
GPU and our CPU interpreter, as #136 requires, never against CTS's own harness. The other seven criteria have none;
these tests are their local proof.
