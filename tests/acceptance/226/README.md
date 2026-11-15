# Acceptance tests for #226: 3D axes, x, y and z scales, labels that face the camera

These tests were written before any implementation existed. The writer had issue #226 (its Scope, its Fields for
`axes3d@1` and `scale@1`'s `range`, its eight acceptance criteria, its Proof line "A fixture figure of a saddle on axes
with a riding point, and orbit screenshots" and its Oracle line), its oracle page (criterion 1 has one upstream test
file; the `226-oracle/` folder re-expresses it), the design documents and base commit `9b77cd2cd`. No implementation
existed, and no other worktree, branch or pull request was read.

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job
(design: Dogfooding). The suite is lean: one file per criterion, at most two tests a file, and the three planted wrong
programs the criteria name.

## What was read

- Issue #226 and its oracle page (`doneright/oracles/issues/226.md`), and the one upstream test file it links, read
  from the vendor copy on that branch.
- `docs/canvas-primitives.md`: Units and axes (3D is +Y up, right-handed); Marks in 3D: axes `axes3d@1` (its fields,
  "Ticks come from `axis@1`'s rule, on 1, 2 and 5 × 10^k, and enter and leave by opacity as `axis@1`'s do; labels face
  the camera, so an orbit never mirrors them", "an item that carries `mod.axes@1` maps through three scales per
  change", "It can never: Take values ≤ 0 on a log scale"); Marks in 3D and Marks in 3D: facing; Modifier ("the data
  module fills `mod.axes@1` … so no module's interface digest holds another module's modifiers"); Scale and encode
  `scale@1`, `axis@1`, `legend@1` (`range: x | y | z | [u, u] | palette roles`, "Ticks enter and leave by opacity as
  their values enter and leave the domain", "put values ≤ 0 on a log scale (refused, naming the rows)"); Registry and
  seal and its registries; Array and table (contributions); Frame budget.
- `docs/technical-design.md`: Canvas modules (the data row: "`axes3d@1` beside the scales and axes, with its
  `mod.axes@1` deform in the core's modifier registry"; `module_missing`; build sets), Dogfooding, "Every task carries
  its own budgets" and the reference Macs.
- `docs/parallel-proof.md` §3, §7a and §12a.
- At the base, for surfaces and conventions only: `crates/deep-gpu-layer` (`view3d.rs`'s request fields and frame
  rows, `labels`, `counts`, `capture`, `patches`; `budget.rs`'s `frame_budget`; `main.rs`'s `--planted`),
  `crates/deep-show` (its calls, `deep_show`, `registry`, `registries`, `schedule`, `geometry`, `frames`; the `planted`
  scenario field; `Cargo.toml`'s `test-leave-out-data`), `crates/deep-canvas-marks/src/data.rs` (`scale@1`, `axis@1`,
  `faded_ticks`, `ticks_report`), `crates/deep-marks-render/src/raster.rs` (`geometry`'s `ticks`),
  `crates/deep-canvas/src/camera.rs` (the orbit's eye), `crates/deep-canvas/src/registry/core_lists.rs`
  (`modifier@1`), `crates/deep-canvas-scene3d/src/scene.rs` and `cloud.rs` (`parent`, `mark.point@1`'s position),
  `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`, `validateBudgets`), `scripts/lanes.mjs`,
  `scripts/proof-change.mjs` (`criterionId`), and the suites `2017/`, `443/`, `489/`, `167/`, `378/`, `1899/` and
  `2014-oracle/`.

Code was read only to learn the surface. Every expected value comes from the issue and the design.

## Run them

Every file builds its binaries with cargo, and the GPU files draw on this Mac's Metal GPU, so they run one file at a
time. The implementer adds these lines to `scripts/lanes.mjs`; this README is the instruction, and this job edits
nothing outside its folders.

```js
// #226's files each build deep-gpu, deep-show (full and without data) or deep-canvas-render and draw on the Metal GPU;
// ac7-budgets judges the task's budgets on the reference Mac.
alone.push('tests/acceptance/226/', 'tests/acceptance/226-oracle/');
timed.push('tests/acceptance/226/ac7-budgets.test.ts');
```

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease npx vitest run --root tests/acceptance/226 --no-file-parallelism --testTimeout=600000 <file>
npx tsc -p tests/acceptance/226/tsconfig.json
rm -rf tests/acceptance/226/node_modules/.vite
```

- **Build.** Each file first builds what it uses, debug, with `cargo build --locked`: `--bin deep-gpu`;
  `--bin deep-show --no-default-features --features full`; the same with `--features full,test-leave-out-data` (the
  full set without the data module, #489's); `--bin deep-canvas-render`. The pinned toolchain's folder and
  `/opt/homebrew/opt/rustup/bin` go first on `PATH`, `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0` unless set; each
  binary is copied out of the target folder (honoring `CARGO_TARGET_DIR`) right after its build, and a test whose
  build failed fails.
- **Platform.** What the GPU draws is drawn on Metal: off macOS a test fails with a message starting `INCONCLUSIVE:`,
  never passing. The timings of `ac7-budgets.test.ts` are INCONCLUSIVE anywhere the perf lane's `judgeLimit` doesn't
  pass a reference Mac at rest, checked before anything is timed.
- **Isolation.** Each test writes into its own temporary folders and deletes them. `ac8-taste.test.ts` writes into
  `docs/evidence/226/` and keeps what it writes. The suite uses Node built-ins and vitest, and imports
  `scripts/benchmark.mjs` and `scripts/lanes.mjs` as the lane's own.

## Fixtures

All generated in `helpers.ts`; no file on disk. Metres, +Y up. Session documents for `view3d` (each item in one writer
layer `main` of writer `agent:alpha`, camera `cam`, `budget.class: figure`, `requires: {modules: {scene3d: '^1'}}` as
the base's 3D fixtures name it); the same documents in the agent's form for `deep_show` and `frame_budget`.

- **The scales** `xs`, `ys`, `zs`: `scale@1 {type, domain, range: x | y | z, nice: false}`, linear over [−4, 4]
  unless a test says otherwise; `nice: false` keeps each domain as written, so the issue's numbers are the domains.
- **The axes** `axes`: `axes3d@1 {x: xs, y: ys, z: zs, lengths: [8, 8, 8], up: z}` at the world origin, its other
  fields at their defaults (`ticks {size: 0.05, labels: camera}`, `tips: true`, no titles, `planes: []`) unless named.
- **The point** `pt`: `mark.point@1`, `parent: axes`, `at.pos` its coordinates, carrying `mod.axes@1 {axes: axes}`.
- **The surface** `surface`: `plate@1 {grid: [4, 4], size: [4, 4]}` (25 vertices), `parent: axes`, carrying
  `mod.axes@1`. A saddle needs #224's surface formula, which comes later; a plate is a surface the base builds.
- **Criterion 1, 4 and 7's scene** (`axesDoc`): the axes with `pt` at (2, 3, 1) (and `surface` in 4 and 7) under a
  still orthographic orbit camera (azimuth 35°, elevation 25°), a day sky and a sun.
- **Criterion 2's orbit** (`orbitDoc`): the axes under an orthographic orbit camera at 20° elevation, its azimuth keyed
  linearly from 0° at 0 s to 360° at 1 s.
- **Criterion 3's rows** (`logRowsDoc`): `zs` log over [1, 1000]; `pts`, a `marks@1` point set parented to the axes,
  rows r0 … r4 keyed by `key`, x (−3, −1, 0, 2, 3), y (1, 2, −2, 3, 0) and z (10, 100, 1000, z₃, 1) as f32 columns,
  encoding x, y and z through `xs`, `ys` and `zs`; z₃ = 0, and 50 in the control.
- **Criterion 6's key** (`keyedAxesDoc`, `keyedAxis2d`): `items/xs/params/domain/0` keyed linearly from −4 to −6 and
  `/1` from 4 to 6 over 1 s. The 2D figure holds `xs` with the same type, domain, `nice` and keys (its range [40, 440] u)
  and `xaxis`, an `axis@1 {scale: xs, side: bottom}`.
- **Criterion 7's twin** (`marksTwinItems`): written from the issue's numbers, the same ticks (−4 … 4 on each axis,
  0.05 m), labels (0.25 m world text facing the camera), axis lines with arrow tips and the xy grid plane as
  `mark.line@1` and `mark.text@1`, with up z mapping math x → +X, math y → −Z, math z → +Y.

## The surface under test

Each test enters through the base's own calls: `deep-gpu run [--planted <name>]` (#377) with `view3d` (#378: `size`,
`fps`, `from`, `frames`, `patches`, `capture`, `targets: ['final']`, and `counts: true` with `meshes_built`,
`instances_written`, `element_uploads` and `encoded`) and `frame_budget` (#1899); `deep-show run` (#393) with
`deep_show`, `registry`, `registries` (#200) and `schedule` (#185), on the full build and on
`full,test-leave-out-data`; and `deep-canvas-render geometry` (#167: an `axis@1`'s `ticks`, `{value, opacity}`, at t).
What the base lacks is below, each named by this job.

## Assumed surfaces

The issue and the design name the behaviours but not these calls and fields; each is this job's choice, the most
natural one beside the base's own calls. The implementer provides exactly these, or disputes them.

1. **The kinds.** The data module registers `axes3d@1` with the fields of Marks in 3D: axes, and fills the entry
   `mod.axes@1` (class `deform`) into the core's `modifier@1`, which deep://registries lists with `module: "data"`.
   `scale@1` takes `range: "z"` (and `"x"`, `"y"`): an axes3d's scale spans that axis's length. A `marks@1` set takes
   `encode.z`. Without the data module both kinds are refused at check with `module_missing`, naming data.
2. **`view3d` gains `axes: true`.** Each frame then carries `axes: [{"item": "<axes3d ID>", "ticks": [Tick]}]`, one
   row per `axes3d@1` item the frame draws, with every tick it draws on each axis, and optionally ticks at opacity 0:
   `Tick = {"axis": "x" | "y" | "z", "value": number, "opacity": 0..1, "at": [x, y, z], "label": null | {"text":
   string, "quad": [[x, y, z] × 4]}}`. `value` is in the scale's domain; `opacity` the tick's (and its label's)
   opacity this frame; `at` the world point where the tick meets its axis line, in metres; `label.quad` the world-space
   corners of the label's text box as the vertex stage places them this frame, facing applied, in reading order:
   bottom-left (where the text starts, on its baseline side), bottom-right, top-right, top-left. A tick whose label
   isn't drawn (thinned, or at opacity 0) has `label: null`.
3. **`view3d` gains `world: [item ID]`.** Each frame then carries `world: {"<ID>": [[x, y, z], …]}`: every vertex of
   the item as this frame draws it, in world space in metres, after its modifiers (`mod.axes@1` included) and its
   parents' transforms, in the item's vertex order; a `mark.point@1` has its one position. Read back, or computed on the
   CPU in f64 by the function the vertex stage runs.
4. **`view3d`'s `counts` gains `axes_mapped`.** With `counts: true`, each frame carries `axes_mapped: [item ID]`, the
   items whose vertices `mod.axes@1` mapped through the axes' scales in this frame (empty when none did).
5. **No new deep-show or deep-canvas-render field**: criterion 3's and 5's refusals are `deep_show` issues, criterion
   5's digests `schedule`'s `interfaces`, criterion 6's 2D reading `geometry`'s `ticks`.
6. **`benchmarks/budgets.json` gains the task `canvas-axes3d`**: `{"id": "canvas-axes3d", "command": ["node",
   "benchmarks/canvas.mjs", "axes3d"], "margin": 0.5, "limits": {}, "targets": {"axes_over_marks": 1.05,
   "still_maps": 0}, "initialReason": "<why, naming #226>", "criteria": ["#226.6a40f5c8"]}`, which the lane's
   `validateBudgets` accepts against the merge base's file. `canvas.mjs axes3d` measures this suite's timing fixtures
   on release builds as the other canvas tasks do; what the mode prints is the implementer's.
7. **`scripts/lanes.mjs`** gains the two lines under Run them.
8. **Planted programs**, each reachable only through `deep-gpu run --planted <name>` (`Planted` in
   `crates/deep-gpu-layer/src/main.rs`; the planted code may live in the data module, reached as the other modules'
   plants are); an unknown name is `bad_input` at the base. Listed under The planted programs.
9. **The taste call** is recorded in `tests/acceptance/226/TASTE.json`, the one file anyone adds to this folder after
   this commit, and only to record the owner's answer: `{"issue": 226, "criterion": "#226.6f3a3161", "verdict":
   "looks_right" | "looks_wrong", "who", "when": ISO 8601, "screenshots": {name → sha256 for the five pictures and the
   two recordings}, "note"?}`.

## The planted programs

| Name | The wrong program | Criterion |
|---|---|---|
| `axes_mod_applies_transform` | `mod.axes@1` maps each vertex through the three scales and then also applies the axes item's own transform, so an item parented to the axes takes that transform twice. Everything else is shipped. | AC4 `#226.a8945cc1` (issue-named) |
| `axes3d_own_tick_rule` | The axes compute their ticks by a rule of their own: on the same 1, 2 and 5 × 10^k steps over the scale's domain at t, every tick inside the domain at opacity 1 and none outside, so a tick entering the domain shows at full opacity at once. `axis@1` and everything else are shipped. | AC6 `#226.86722d38` (issue-named) |
| `axes_mod_maps_every_frame` | `mod.axes@1` maps every item that carries it through the scales in every frame, changed or not, and counts it in `axes_mapped`, re-uploading what it maps. Everything else is shipped. | AC7 `#226.6a40f5c8` (issue-named) |

No `twins.json`: every test fails on the merge base at an assertion of its own (`BASE-FAILURE.txt`), and the planted
programs are run by the tests themselves.

## Criteria to tests

IDs are `#226.` and the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the
leading `- [ ] ` dropped (`scripts/proof-change.mjs`). Each test's name starts with `AC<n> #226.<id>`. Each file's
header states its fixture, numbers and wrong programs in full.

| ID | Criterion (short) | File (tests): what it asserts |
|---|---|---|
| AC1 `#226.c218cc0a` | Domains [−4, 4], lengths 8 m, up z: a point at (2, 3, 1) sits at world (2, 1, −3) within 1e-6 m | `ac1-point-at-its-numbers.test.ts` (1): `pt`'s `world` position is within 1e-6 m of (2, 1, −3). Catches: the base; a point left at its own position; up y; math y to +Z; a domain mapped from its start |
| AC2 `#226.1adcd447` | Every tick label faces the camera within 1° through a 360° orbit, none mirrored at 36 azimuths | `ac2-labels-face-camera.test.ts` (1): at azimuths 0°, 10°, … 350°, each drawn label's quad normal is within 1° of the camera's view axis and its front faces the camera; every axis draws at least three labels each frame. Catches: the base; labels fixed in the axes' planes; upright labels; labels drawn from behind |
| AC3 `#226.88f58ce5` | A log z scale refuses a row with z = 0, naming the row | `ac3-log-z-refuses-zero.test.ts` (1): `deep_show` refuses the set with r3 at z = 0, an error naming r3 of pts and none naming another row; the control with z = 50 has no error naming a row or zs. Catches: the base; clamping or dropping the row; a refusal naming only the domain; one naming every row |
| AC4 `#226.a8945cc1` | Moving the axes 1 m moves a surface and a point 1 m, no rebuild; the plant moves them 2 m and fails, naming the modifier | `ac4-move-with-axes.test.ts` (2): every vertex of `pt` and `surface` moves by (1, 0, 0) within 1e-5 m and frame 1 builds no mesh; under `axes_mod_applies_transform` the judge fails, each failure naming mod.axes@1, one a 2 m move. Catches: the base; items not following the axes; the plant; a move that rebuilds |
| AC5 `#226.58ad6172` | No edge from scene3d to data: the build without data seals, scene3d's digest unchanged, axes3d@1 refused `module_missing` naming data | `ac5-no-edge-scene3d-to-data.test.ts` (2): (1) the build without data seals with scene3d; the full build's data fills `mod.axes@1` and the other build has none; scene3d@1's digest is the same in both. (2) without data, the axes item is refused with `module_missing` naming data (the scales' own module_missing doesn't count) and with no other code; the full build presents it. Catches: the base; scene3d holding axes3d@1 or reading data; another refusal |
| AC6 `#226.86722d38` | The x domain keyed [−4, 4] → [−6, 6] over 1 s: the axes' x ticks and opacities equal a 2D axis@1's at 20 times; the plant fails, naming the first tick that differs | `ac6-ticks-as-2d-axis.test.ts` (2): at t = k/20 s, k = 1 … 20, the 3D x ticks shown equal the 2D axis's, opacities within 1e-6, and the 2D axis fades an entering tick in; under `axes3d_own_tick_rule` the comparison fails, its first difference an entering tick, and the plant shows one at opacity 1 where the 2D axis doesn't. Catches: the base; the plant; other steps; ticks that pop in |
| AC7 `#226.6a40f5c8` | Budgets: the axes at the cost of the same marks under the frame-budget rule; mapping only in frames where something changed; the plant fails, naming the item | `ac7-budgets.test.ts` (2): (1) frames 0 and 2 (a scale changed) map pt and surface; still frames 1 and 3 map nothing, build, write, upload and encode nothing; under `axes_mod_maps_every_frame` the judge fails naming the item. (2) `budgets.json` holds `canvas-axes3d`, valid against the merge base, this file timed; on a reference Mac at rest only, `frame_budget` on the axes and on their marks twin: the axes pass the frame-budget rule and their GPU p95 is judged by `judgeLimit` against 1.05 × the twin's median. Catches: the base; the plant; mapping every frame; axes dearer than their marks |
| AC8 `#226.6f3a3161` | Screenshots and recordings shown; one taste call recorded, else INCONCLUSIVE | `ac8-taste.test.ts` (1): writes the pictures and recordings from this run's final targets (The taste call), prints their SHA-256s, then reads `TASTE.json`: absent or recorded on other SHA-256s is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on these passes. Attaching them to the PR and showing them in the session is the implementer's, outside any test |

Criterion 1 also has `../226-oracle/` (its README), the upstream test re-expressed against our output.

## Readings where the issue leaves a choice

- **Where a point's coordinates live.** A `mark.point@1`'s positions come from one source, its own (Marks in 3D), so a
  point "at (2, 3, 1)" is written with its own position, `at.pos: [2, 3, 1]`, and `mod.axes@1` maps it through the
  scales; its place comes from its parent, the axes. A surface's coordinates are its built vertices in its own space.
- **Where 0 sits.** The issue's numbers fix it: with domains [−4, 4] on 8 m, (2, 3, 1) at (2, 1, −3) means each value
  v lands v metres from the axes' origin along its axis. No test reads where an axis line is drawn.
- **"Faces the camera"** is judged under an orthographic camera, where facing the viewer and facing the view plane
  agree: the label's plane within 1° of the view plane. "Reads mirrored" is the label's front, by its reading order,
  facing away from the camera. Both are read from the label's quad in world space, not from pixels (criterion 8: no
  criterion above reads a picture). "Through a 360° orbit" is checked at the 36 sampled azimuths.
- **"Naming the row"**: an error issue whose JSON names the set and the row's key (as `pts#r3` or with `pts` and
  `r3`), and no error naming another row. The rows sit on the axes through a `marks@1` set encoding z, the data
  module's rows; `mod.axes@1` maps items, not rows.
- **"The same scale"** in criterion 6: the 2D figure holds a scale of the same type, domain, `nice` and keys as the 3D
  one; its range is the 2D view's own, which no tick depends on. "Ticks and their opacities equal": the ticks shown
  (opacity > 0), value for value, opacities within 1e-6. "Ticks that enter the domain fade in" is checked on the 2D axis
  (some tick outside [−4, 4] at an opacity strictly between 0 and 1 at a sampled time), so the equality carries it to
  3D. The 20 times are k ÷ 20 s for k = 1 … 20, exact in flicks; the last is the key's end. "Naming the first tick
  that differs": the comparison's first difference, by time then value.
- **"No rebuild of the surface"**: the move's frame builds no mesh at all (Dirty classes: a move never rebuilds a mesh).
- **"Moves them by 2 m"**: the plant leaves the axes at the origin in frame 0, so the doubled transform shows only
  after the move, as a 2 m displacement.
- **Criterion 7, the counters.** "Only in frames where it or a scale changes" is read through `axes_mapped`: the first
  frame and the frame a scale changed map the items, still frames none, and a still frame also builds, writes,
  uploads and encodes nothing. The camera is still, so the label facing isn't redone either.
- **Criterion 7, the timings.** "At the cost of the same ticks, labels and planes written as marks in 3D, under the
  frame-budget rule": the axes' `frame_budget` (the rule itself: five runs after warm-up, judged against the class) is
  not FAIL and is PASS for a pass, and their five GPU p95s are within 1.05 × the twin's median GPU p95, judged by
  `judgeLimit` (its margin, the larger of 5% and the runs' spread, applies to a FAIL). Both draw the same orbit for 5 s
  at 1920 × 1080. "Compared with the merge base" is the perf lane's and the budget window's (`canvas-axes3d`, valid
  against the merge base's `budgets.json`).

## The taste call

`ac8-taste.test.ts` writes to `docs/evidence/226/`: `axes-az000.png`, `axes-az090.png`, `axes-az180.png`,
`axes-az270.png` (the axes with titles and the xy grid plane, the surface of 6 × 6 cells and the point at (2, 3, 1),
under a perspective orbit at 20° elevation, 960 × 540), `tick-entering.png` (criterion 6's keyed domain with the
surface and the point at t = 0.5 s), `orbit-360.apng` (the orbit's 36 frames at 480 × 270, 12 fps) and
`domain-change.apng` (0 to 1 s, 21 frames at 480 × 270, 20 fps), each a frame's `final` target re-encoded without
filtering at zlib level 9, so the same pixels give the same SHA-256, and prints the SHA-256s. The implementer attaches
them to the PR, shows them in the session, and records the owner's answer in `TASTE.json` (Assumed surfaces 9). The
pictures are evidence for the one taste call only; no other test reads them.

## Not tested

No criterion asks for these, so none is tested: titles given as a vector; `ticks.labels: upright`; `tips: false`; grid
planes' roles; a status color on the axes; log x and y scales beyond the oracle lane; a line, a curve fn or a vector
field on the axes (#224 and #225 come later); labels thinning; the axes' memory, p50 and CPU budgets beyond the frame
budget. The Proof line's saddle needs #224's surface formula; the taste pictures use a plate.

## What the implementer adds outside this folder

- The two `scripts/lanes.mjs` lines under Run them.
- The `canvas-axes3d` task in `benchmarks/budgets.json`, and its `axes3d` mode in `benchmarks/canvas.mjs`.
- In `deep-gpu`: `view3d`'s `axes` and `world` reports and `counts`' `axes_mapped`, and the three planted names in
  `--planted`.
- In the data module: `axes3d@1`, `mod.axes@1` in the core's `modifier@1`, `scale@1`'s `range: z`, `marks@1`'s
  `encode.z`, and their refusals (`module_missing` without data; a row ≤ 0 on a log scale, naming the row).
- After the owner's taste call: `TASTE.json`, and the pictures attached to the PR.
