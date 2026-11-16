# Acceptance tests for #968: flowing water: a river surface that runs downstream in two phases, and foam where it runs fast

Written first, from issue #968 (its scope, its two Fields rows, its four acceptance criteria, its proof line: "The
channel fixture's recording with its phase-wrap differences, the river's foam samples, and each planted program's
failure", and its Oracle line), its Oracle page (`doneright/oracles/issues/968.md` in `DeepBuildAI/deepbuild`, branch
`doneright`), the design sections it links and those they lean on, and base commit `d8c46f0d` ("Merge pull request
#2601 …"), by a job that never saw an implementation; none existed. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one file per criterion,
one test per clause that needs its own run, plus exactly the one planted program the criteria name.

## What was read

- Issue #968 and its Oracle page (no upstream test for any criterion; nothing pinned to port).
- `docs/canvas-primitives.md`: Material: water (its Fields, where the `flow` and `foam.speed` line already stands, its
  Semantics, Cost and "It can never"), Curve `curve@1` (and its bspline and closed-frames rows), Builder plate:
  terrain, Particles `particles@1`: emit regions, Puff `puff@1`, Attribute and field and Vector field
  `vector_field@1` (how the design writes a field as expressions over its axes).
- `docs/technical-design.md`: Scenes, physics and the canvas core; Every task carries its own budgets; The reference
  Macs; Dogfooding; Tests written first.
- At the base, for call shapes only: AGENTS.md; `tests/acceptance/166/` and `268/` (the models: README, helpers, every
  test, tsconfig, BASE-FAILURE); `crates/deep-gpu-layer/src/{main,view3d}.rs` (the call table, `view3d`'s fields, its
  targets `final | linear | ids | pre_tone | dirt | scene | backdrop | depth | reflection | foam | coc`, refusals as
  `{code, reason}`, `Planted` and its names); `crates/deep-canvas-scene3d/src/{water,scene,builders,curve}.rs` (how
  `water` is read today, how a builder names a `curve@1` item by its ID, a curve's `points` and `mode`);
  `crates/deep-scene3d-render/src/water.{rs,wgsl}` (how the ripples bend the normal by a slope, for the size of that
  slope at a given strength); `benchmarks/budgets.json` (#166's frozen `canvas-water`, #268's frozen
  `canvas-water-shore`); `benchmarks/canvas.mjs` (their modes); `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`,
  `validateBudgets`); `scripts/proof-change.mjs` (`criterionId`); `scripts/lanes.mjs` (`alone`).

## What the base already does, which these tests don't credit

`view3d` draws scene3d documents with #166's water (waves, ripples drifting with the wind, rain, foam by steepness, a
wake, the bed's tint) and #268's shore, `from` (a cold seek), `capture`, the targets above, `timings` and each frame's
`pixel_hash`. A water reads no `flow` and no `foam.speed` (unknown keys it ignores), so the base draws every fixture here
as still #166 water: the ripples never travel downstream and no foam shows by speed. There is no `normal` target, no
`canvas-water-flow` task and no planted name of this suite's. So every test fails at the base on a refused call (the
unknown target `normal`, the unknown planted name), an unread field (the river bare where it runs fast) or a missing
task; the budget timing is INCONCLUSIVE off a reference Mac at rest. `BASE-FAILURE.txt` holds `channel.test.ts` and
`foam.test.ts` run against the base.

## Run them

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/968 --no-file-parallelism --testTimeout=3600000
npx tsc -p tests/acceptance/968/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Each file builds `deep-gpu` once with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked --bin
deep-gpu`, adding the pinned toolchain (`~/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin`) to PATH, copies the
binary out of the target folder (`CARGO_TARGET_DIR` honoured) and fails each test if the build failed. So the files run
one at a time, and the timing must have the machine to itself: **`scripts/lanes.mjs` needs `'tests/acceptance/968/'` in
its `alone` list beside `'tests/acceptance/166/'` and `'tests/acceptance/268/'`. This README is the instruction; the
implementer makes that edit.** Each test writes into its own temporary folder and deletes it. Imports: Node built-ins
and vitest only; the lane's judge and validator run as `scripts/benchmark.mjs` in a child process. A run with `--root
tests/acceptance/968` leaves Vitest's cache in `tests/acceptance/968/node_modules/.vite`; delete it.

- Everything draws on Metal: off macOS a test fails with a message starting `INCONCLUSIVE:`, never passing.
- **The budget** (`budgets.test.ts`) counts only on a reference Mac (as the lane's `judgeLimit` reads the fingerprint)
  on mains power, Low Power Mode off, thermal state nominal, and with the machine's load at most one per core; anywhere
  else its timing test fails `INCONCLUSIVE:` before timing anything. The budgets.json entry is checked anywhere. The
  issue's verdict is the scheduled budget window's at the merged commit, so the PR says `Part of #968` until it closes
  the issue; this file judges a local run as #166's and #268's suites do.
- `taste.test.ts` keeps its three files in `DEEPBUILD_EVIDENCE_DIR` (else `$TMPDIR/deep-968-evidence`), prints their
  paths, and reads your taste call from the file `DEEPBUILD_TASTE_968` names; without it the test fails `INCONCLUSIVE:`.

## The surface under test

**No new binary and no new call.** #377's `deep-gpu run [--planted <name>]` with its JSON-lines protocol unchanged
(`{"out", "calls"}` in, `{"ok", "replies"}` out), #378's `view3d` for every frame, #166's water and #268's `foam`
target as their suites wrote them. Field names the issue and design give are used as they give them; the rest are this
suite's choices, marked **bold**, each the least a criterion needs.

### Documents (scene3d, as #166's and #268's suites write them)

One writer layer `main` (writer `agent:sess-alpha`), camera `cam`, `seed: 968`, `requires: {modules: {scene3d: "^1"}}`,
items keyed by ID.

- **`flow` sits in a `material@1` item's `params.water`, beside `waves`**, as the Fields row says: `flow: {along, speed,
  cycle}`; a field left out takes the row's default, and a water with no `flow` has none. **`foam.speed` sits in
  `water.foam` beside `threshold`**: `foam: {threshold, speed}`; left out, it is none.
- **`along: "<curve ID>"`** names a `curve@1` item by its ID as a string, as a builder names one (the issue's `along:
  c` is `along: "c"`). The channel's `c` is `{kind: "curve@1", params: {points: [[−20, 0, 0], [20, 0, 0]], mode:
  "linear"}}`, path data, not drawn; downstream is the curve's direction from its first point to its last.
- **`along: {x: "<expression>", z: "<expression>"}`** is the field form, "field (vec2 over x, z)": the vec2's two parts
  as expressions over `x` and `z` in the closed grammar, as `vector_field@1` writes its `fn`, in world metres (the
  fixtures' plates sit unturned at the origin, so the plate's own axes and the world's agree). **With a field, the
  flow's velocity at a point is the field's vec2 there times `speed`**: its direction is the vec2's and its speed the
  vec2's length times `speed`, so `speed: 1` makes the field the velocity in m/s.
- The water is a `plate@1` part (`params: {grid, size}`) whose `material` names the water material, as #166 has it.
  **FLAT water** (`helpers.ts`) has `waves: {wind: {speed: 0, direction: 0}}` (no waves, and the ripples drift with
  no wind), `ripples: {scale: 0.5, strength: 0.1}`, `rain: 0` and `foam: {threshold: 1}` (the steepness foam off), so
  only the ripples' noise bends the surface and only the flow moves it.

### `view3d`: one target

`{"call": "view3d", "doc", "look", "size", "frames", "fps", "from"?, "capture"?, "targets"?, "timings"?}` as the base
has it; read: each frame's `frame`, `pixel_hash`, `final` (PNG by SHA-256), `pre_tone` (f32 RGBA by SHA-256), `foam`
(#268's: f32, one a pixel, the share of foam where water is drawn, 0 elsewhere) and `gpu_ms`. Added:

- **Target `normal`**: f32 little-endian, three a pixel (x, y, z), rows top-down, `w × h × 12` bytes, written as
  `<sha256>.f32` under `out` and named in the frame's row: at each pixel where a water part is drawn, the unit
  world-space normal the water's shading uses there, after the waves, the ripples (moved by the flow), the rain and the
  wake have bent it; (0, 0, 0) where no water is drawn. Criterion 1 reads it.

### The two-phase closed form (`helpers.ts`: `twoPhase`, `blend`)

The issue states it: "two phases half a `cycle` apart, each phase's offset speed × ((t + phase) mod cycle), blended by
a triangle weight that is 0 where its phase wraps".

- **The phases are p = 0 and p = cycle ÷ 2** (half a cycle apart; the single phase the planted program keeps is p = 0,
  whose first wrap is the issue's t = 2 s). Phase p's fraction is f = ((t + p) mod cycle) ÷ cycle; its offset is
  o_p = speed × ((t + p) mod cycle) metres downstream; its weight is the triangle w_p = 1 − |2 f − 1|, 0 where it
  wraps (f = 0) and 1 halfway. The two weights sum to 1.
- The noise phase p draws at a point x is the still noise at x − D o_p, D the flow's unit direction there (+x along the
  channel). On FLAT water a normal is (−s_x, 1, −s_z) normalized for the noise's slope s; **the blend of the noise is
  the blend of its slopes**: s = w_a s_a + w_b s_b, and the expected normal (−s_x, 1, −s_z) normalized, with each s_p
  read back from a normal n as −(n_x, n_z) ÷ n_y. At ripples' strength 0.1 the slopes stay under about 0.08, where
  blending the unit normals instead differs by under 1e-4 (5e-5 on a value noise like the base's), so either reading of
  "blended" passes the 1e-3.
- **The still noise at x − D o_p is read from the renderer itself**: the same channel with no flow, seen from the camera
  moved upstream by o_p (position and target together; the camera looks straight down, so pixel (i, j) then meets the
  water at rest exactly o_p upstream of where it meets it from the unmoved camera). The test never models the noise; it
  holds the flowing surface to the still one at the offsets and weights the issue's closed form gives.

### `benchmarks/budgets.json`: one task added

**`{"id": "canvas-water-flow", "command": ["node", "benchmarks/canvas.mjs", "water-flow"], "targets":
{"flow_sheet_gpu_ms": 0.4}, "margin": 0.5, "limits": {…}, "initialReason": "… #968 …", "criteria":
["#968.3dca895d"]}`**, passing `validateBudgets` against the merge base's file (which freezes #166's `canvas-water` and
#268's `canvas-water-shore`, so a new task rather than a changed one). What the mode prints is the implementer's, as the
lane needs it.

### Planted programs (`deep-gpu run --planted <name>`, reachable only there)

| Name | The wrong program | Criterion |
|---|---|---|
| **`water_flow_single_phase`** | The flow's noise moved in one phase only: offset speed × (t mod cycle), weight 1, no blend; everything else as shipped | `#968.baa8eab9` (issue-named: "a planted single-phase flow") |

### Files and environment

- `DEEPBUILD_EVIDENCE_DIR` (optional): where `channel-<sha>.png`, `river-<sha>.png` and `channel-running-<sha>.apng` go.
- **`DEEPBUILD_TASTE_968`**: a JSON file `{"criterion": "#968.dc555b94", "by": "you", "screenshots": [sha256 × 3],
  "call": "looks_right" | "looks_wrong"}`.

## The fixtures

- **The straight 40 m channel** (`channelDoc`): a 40 m (x) × 8 m (z) plate `channel` of 512 × 128 cells at y = 0, its
  material `channel-water` carrying FLAT water and `flow: {along: "c", speed: 1.5, cycle: 2}`; the curve `c` along its
  centre from (−20, 0, 0) to (20, 0, 0); stone banks beyond z = ±4 m and a sand bed 1.5 m down; a day sky and a sun.
  Criterion 1 sees it straight down from 6 m over its middle (fov 30°: a 3.2 m square, all water).
- **The river with rapids** (`riverDoc`): a 40 m (x) × 10 m (z) plate `river` of 512 × 128 cells, its material
  `river-water` carrying FLAT water, `foam: {threshold: 1, speed: 2}` and `flow: {along: {x: "0.5 + 0.0625 * (x + 20)",
  z: "0"}, speed: 1, cycle: 2}`: it runs along +x at 0.5 m/s at its head (x = −20 m) rising evenly to 3 m/s at its
  foot (x = 20 m); 1.9 m/s at x = 2.4 m and 2.1 m/s at x = 5.6 m; banks beyond z = ±5 m and a bed. Criterion 2 sees it
  straight down from 16 m over x = 4 m (fov 60° at 512 × 256: x from −5.2 to 13.2 m, all water).
- **The sheet** (`budgets.test.ts`): a plate 30 m along x and 20 m wide of 256 × 256 cells with `water: {flow: {along:
  "c", speed: 1.5, cycle: 2}}` (a 3 m/s breeze's waves and the default ripples), `c` down its middle, against the same
  sheet with `water: {}`; the camera straight down from the height at which it fills a third of a 1920 × 1080 frame
  (fov 60°: 56.6 m × 31.8 m of the plane, 49.0 m up).
- The taste call's channel and river take a 1.5 m/s breeze along +x and ripples at 0.5, seen low and oblique.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, `- [ ] ` dropped
(`scripts/proof-change.mjs: criterionId`), from the live issue. Each test's name starts with its ID.

| ID | Criterion | File: what it asserts |
|---|---|---|
| `#968.baa8eab9` | 1: two phases on the channel; no jump at a wrap; planted single phase | `channel.test.ts` (3): 64 seeded pixels at 30 times (frames 4, 8, …, 120 at 30 fps, to 4 s): the `normal` target of the played film and of each frame seeked cold within 1e-3 of the two-phase closed form, the seeked pixel hash the played one's; at each time some expected normal is over 1e-2 from the still water's. Played at 60 fps over 4 s at 128 × 128: the mean frame-to-frame difference of `normal` at each wrap (1, 2, 3, 4 s) within 1.5 times its cycle's median. Twin `water_flow_single_phase`: the same check fails, first at 2 s, naming `material channel-water` and `at 2 s`, its jumps at 2 and 4 s over 5 times the median. |
| `#968.f3b633ac` | 2: foam by speed on the river | `foam.test.ts`: at 1.5 s, `foam` ≥ 0.5 at 64 seeded pixels where the river runs above 2.1 m/s, each brighter in `pre_tone` than the same river with no `foam.speed`, and under 1/255 at 64 below 1.9 m/s. |
| `#968.3dca895d` | 3: budget | `budgets.test.ts` (2): the `canvas-water-flow` task and the lane's validator against the merge base; the sheet with flow against the same sheet without, ≤ 0.4 ms in five runs judged by the lane. |
| `#968.dc555b94` | 4: taste | `taste.test.ts`: the channel and the river with rapids as the renderer's PNGs and the channel running downstream as an APNG of its frames; INCONCLUSIVE without your recorded call; `looks_wrong` fails. |

Proof line: "the channel fixture's recording with its phase-wrap differences" is criterion 1's wrap test's log lines
(each wrap's difference against its median) and the taste call's recording; "the river's foam samples" are criterion
2's failure sentences and log line; "each planted program's failure" is the twin test.

## Readings where the issue and design leave a choice

- **The closed form and its blend**: above (The two-phase closed form). The phases' starting points are not in the
  issue; 0 and half a cycle are the ones its "first at t = 2 s" and "half a `cycle` apart" fix.
- **"Matches within 1e-3"** is the Euclidean distance between the read-back unit normal and the expected one. **"Seeked
  or played, by pixel hash"** is: the normal holds within 1e-3 both on the played film's frames and on each frame seeked
  cold, and each seeked frame's pixel hash equals the played one's. **"30 times over 4 s"** are frames 4k at 30 fps, k =
  1 … 30, the last at 4 s.
- **"The surface normal"** is the shaded normal, as the `normal` target carries it. On FLAT water only the ripples bend
  it, so the flow is the only thing that moves it; the ripples' strength 0.1 keeps the two blend readings within 1e-4
  of each other.
- **"The mean frame-to-frame difference"** is of the surface normal, the quantity the flow moves: the mean over the
  frame's pixels of |n_k − n_(k−1)|. Read at 60 fps, so a frame moves the noise 2.5 cm (a twentieth of a noise cell) and
  a wrap's jump stands well clear of the steady motion. **"At each phase wrap"** is the larger of the two differences
  touching the wrap's frame (so a wrap computed a hair early or late in f32 is still seen). **"Its median over the
  cycle"** is the median of the 120 differences of the cycle the wrap ends or lies in (0 to 2 s for 1 and 2 s, 2 to 4 s
  for 3 and 4 s). On a value noise like the base's, the two phases' wraps read about 1.2 times the median and a single
  phase's about 12 times at 60 fps (6 at 30 fps).
- **"A river whose flow speed rises along its curve"**: the issue's `speed` is one number, and the form that carries a
  speed per point is the field, so the river's flow is a field whose length rises along the river's course, a straight
  one along +x. The curve form is criterion 1's.
- **"Foam covers"** is a `foam` share of at least 0.5 and **"none"** under 1/255, #268's readings; the foam target is
  held to the drawing by `pre_tone`. The steepness foam is off (`threshold: 1`) and there are no waves, so only the
  speed can make foam. Read at 1.5 s, when both phases weigh half and a blended foam texture is at its flattest.
- **"Adds under 0.4 ms of GPU"** is the water with flow against the same water without it: the difference of the sides'
  median `gpu_ms`, a negative difference reading 0. **"Filling a third of a 1080p frame"** is the sheet's area a third
  of the frame's, seen straight down.
- **The recording** is an animated PNG the suite encodes from the renderer's final frames, since the issue names no
  container: 120 frames at 30 fps, two phase cycles.

## Not asserted, because no criterion says so

The implementer owes these a mapping or a note (AGENTS.md: review requirement → change → proof):

- `deep_kinds` listing `flow` (a scope line no criterion names).
- A curve that bends (criterion 1's curve is straight, so the tangent at the nearest point is +x everywhere), a curve
  form whose speed varies, a field over z, a field whose direction varies, and `cycle` other than 2.
- The foam's noise moving along the flow (only foam coverage by speed is read), foam by speed beside steep-wave foam
  and #268's shore foam, and the foam's look between 1.9 and 2.1 m/s.
- Flow on waves that tilt the surface (the closed-form check is on FLAT water), and the ripples' drift with a wind
  together with a flow.
- "No visible jump" in the final picture beyond the normal's differences and the taste call.
- The design's falls, landings, spray and mist (#1088), and the issue's "Not in this task" list.

## The oracle page

Read. It pins no upstream source and no test: all four criteria are DeepBuild's own (the two-phase flow and its
wrap-free blend, foam keyed to flow speed, the budget by our own fixture, the taste call). Nothing is ported.

| Row | Status |
|---|---|
| Criteria 1–4 | No upstream test, as the page says. |
