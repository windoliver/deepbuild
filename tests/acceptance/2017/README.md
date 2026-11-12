# Acceptance tests for #2017: terrain levels of detail by error projected at the view's size, shading normals from full detail, and the task's budgets

These tests were written before any implementation existed. The writer had issue #2017 (its Scope, its Fields for
Builder plate: terrain, its four acceptance criteria, its Proof line "The terrain plate at 1080p and 4K with its parity
fixtures, and the task's timings" and its Oracle line), its parent #442, its oracle page (no upstream test checks any
criterion, so no `2017-oracle/` folder), the design documents and base commit `eeb45a10a`. No implementation existed,
and no other worktree, branch or pull request was read.

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job
(design: Dogfooding). The suite is lean: one file per criterion, at most two tests a file, and the two planted wrong
programs the criteria name.

## What was read

- Issue #2017 and its oracle page; issue #442's body, for what the earlier parts own: distribute and rest_on (#2013),
  the terrain plate at full detail (#2014), measures (#2015), wind (#2016), bevel and subdivision (#440), curves and
  sweeps (#441).
- `docs/canvas-primitives.md`: Builder plate: terrain; Level of detail; Level of detail: levels by error (`lod_px`, a
  pure function of the view, never by an earlier frame); Level of detail: chunks streamed by view (a chunk's error is
  its largest deviation from full detail in metres, projected at the chunk's nearest point; height tiles morph by a
  smoothstep of the projected error; "each tile's normals ... come from the full-resolution source ... so a level
  change leaves its light alone"; "nothing while still"); Modifier, Modifier: bevel, subdivide and normals; Curve
  `curve@1` (its arc-length table); Attribute and field: distribute (`max: u32 ≤ 100,000`); Builder `extrude`: sweep
  along a curve; Light and the light policy.
- `docs/technical-design.md`: Modeling steps; Scenes, physics and the canvas core; Chunks streamed by view; Dirty
  classes and content key; "Every task carries its own budgets" (five runs after warm-up, the margin, the reference Mac).
- `docs/parallel-proof.md`: §3 (budgets count only on a reference Mac), §7a (slow and timed files), §12a (budget
  windows: a task of `benchmarks/budgets.json` names the criteria it proves; the reading rule for "in the local
  preflight").
- At the base, for surfaces and conventions only: `AGENTS.md`; `crates/deep-gpu-layer` (`view3d.rs`'s request fields
  `lod`, `targets`, `capture`, `counts`, `timings`, `sway` and the frame's counters; `lod.rs`'s #425 rows; `main.rs`'s
  `Planted` and `--planted`); `crates/deep-canvas-scene3d` (`terrain.rs`, the plate at full detail with smooth vertex
  normals; `lod.rs`'s `lod_px` from `budget.lod_px`, `level_at`, `px_per_m`; `scene.rs`'s camera `posed`, which takes
  `fov` across the wider side, `local_of`'s Rz·Ry·Rx and a sun's local −Z; `distribute.rs`'s fields; `builders.rs`'s
  lathe count); `crates/deep-show` (`geometry.rs`'s rows and `stack`, `frames.rs`'s `ran`, `terrain.rs`);
  `crates/deep-canvas/src/camera.rs` (`screen_basis`, orthographic `view_width`); `crates/deep-canvas/src/expr.rs` (the
  function list); `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`, `validateBudgets`); `scripts/lanes.mjs`
  (`alone`, `timed`); `scripts/proof-change.mjs` (`criterionId`); `scripts/proof-runs.mjs` (twins); `benchmarks/
  budgets.json`; and the suites `425/` (layout, levels by error, `taste.test.ts`, `TASTE.json`), `2014/` (the plate),
  `2016/` (the wind field, `view3d` driving), `2013/` (the garden and the vase), `1637/`, `166/` and `1700/` (budgets).

Code was read only to learn the surface. Every expected value comes from the issue and the design.

## Run them

Every file builds `deep-gpu` (and `ac3-budgets.test.ts` also `deep-show`) with cargo and draws on this Mac's Metal
GPU, so they run one file at a time. The implementer adds these lines to `scripts/lanes.mjs`; this README is the
instruction, and this job edits nothing outside its folder.

```js
// #2017's files each build deep-gpu (ac3-budgets also deep-show, for release where it times) and draw on the Metal GPU;
// ac3-budgets judges the task's budgets on the reference Mac.
alone.push('tests/acceptance/2017/');
timed.push('tests/acceptance/2017/ac3-budgets.test.ts');
```

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2017 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2017/tsconfig.json
rm -rf tests/acceptance/2017/node_modules/.vite
```

- **Build.** Each file first runs `cargo build --locked --bin deep-gpu` (and `--bin deep-show --no-default-features
  --features full`), with the pinned toolchain's folder and `/opt/homebrew/opt/rustup/bin` put first on `PATH` and
  `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0` unless already set, copies each binary out of the target folder
  (honoring `CARGO_TARGET_DIR`), and fails each test whose build failed. `ac3-budgets.test.ts` builds `deep-show` for
  release too, but only on a machine that can judge a timing.
- **Platform.** Anything the GPU draws is drawn on Metal: off macOS a test fails with a message starting
  `INCONCLUSIVE:`, never passing. The budget timings are INCONCLUSIVE anywhere the perf lane's `judgeLimit` doesn't
  pass a reference Mac at rest (`scripts/benchmark.mjs`: the fingerprint, mains power, Low Power Mode off, thermal state
  nominal, the load within the cores), checked before anything is timed.
- **Isolation.** Each test writes into its own temporary folders and deletes them. `ac4-taste.test.ts` writes into
  `docs/evidence/2017/` and keeps what it writes. The suite uses Node built-ins and vitest, and imports
  `scripts/benchmark.mjs` and `scripts/lanes.mjs` as the lane's own.

## Fixtures

All generated in `helpers.ts`; no file on disk. Metres, +Y up, right +X. Session documents for `view3d`, each item in
one writer layer `main`, camera `cam`, `budget.class: work_product`; the same documents in the agent's form (no `id`,
no `layers`, no item `layer`) for `deep-show`'s `deep_show`.

- **The plate** (`plateDoc`; criteria 1, 3, 4). The item `ground`, `plate@1` with `params.terrain`: `size [512, 512]`,
  `spacing 1`, `tile 64` (8 × 8 tiles), `lod_levels 6`, and the field
  `0.03 * (1 - 4 * fract(position.x * 0.5)) + 6 * sin(position.x * 0.025) * cos(position.z * 0.019) + 2 * sin((position.x + position.z) * 0.07)`:
  rolling hills (±8 m) under a 3 cm zigzag along x, +0.03 m at even x and −0.03 m at odd x. Every level past full
  detail drops the odd samples, so at an odd x it is about 6 cm off full detail wherever the tile lies, and its error
  grows from about 0.065 m (level 1) to about 1.3 m (level 5). No `at`, so its own space is the world's (#2014). A
  perspective camera at (0, 25, 300), looking at (0, 0, 0), fov 60, near 0.5 m, far 2,000 m; a sun; a day sky.
- **The 200 ground points** (`groundPoints`; criterion 1). Samples of the plate at an odd column and an odd row, none
  within one sample of a tile's edge, each on screen at 1920 × 1080 at least 2 px inside the frame, drawn in order from
  a 32-bit LCG (Numerical Recipes' constants) seeded 2017 until 200 are kept. They lie from about 80 m to 600 m from the
  eye. Full detail at a sample is the field's own value there.
- **The shaded plate** (`shadedDoc`; criterion 2). `ground` with `size [256, 256]`, `spacing 1`, `tile 64`,
  `lod_levels 6` and the field `0.1 * sin(position.x * 1.0471975511965976) + 1.5 * sin(position.x * 0.031) * cos(position.z * 0.027)`:
  a 6 m ripple along x, 10 cm high (slopes to 6°), on gentle hills (slopes under 3°), so no ground faces away from a
  sun 10° up. One material, grey 0.6, roughness 1, metallic 0. A sun of illuminance 12 at `at.rot [-10, 90, 0]`: it
  shines along its local −Z, so toward −x from 10° above the horizon on the +x side, with no shadow; a black sky with
  no ambient. An orthographic camera straight down from (0, 100, 0) at (0, 0, 0), `view_width` 112 m, drawn at
  960 × 540: about 8.57 px a metre, screen right +X and screen down +Z (the base's `screen_basis`), the view x from −56
  to 56 m and z from −31.5 to 31.5 m, on tiles [1, 1], [2, 1], [1, 2] and [2, 2]. Drawn as written (lod_px 1: level
  1's error, about 0.045 m, is 0.39 px, level 2's about 0.135 m 1.16 px) and with `budget.lod_px` lowered to 0.01
  (full detail).
- **The still scene** (`stillDoc`; criterion 3). The plate, a 10 × 10 m lawn scattered with a 0.6 m bush and a 0.2 m
  flower (poisson at 0.5 m, pruned larger first), the prop at 64 segments, the mesh at 16, a 100-span curve and a rail
  (`extrude@1` along it, 256 rings), a still camera, nothing bound to time. **The bare scene** (`stillDoc(true)`): the
  same camera, sky, sun and materials with one box in place of the task's items.
- **The budget scene** (`budgetDoc`; criterion 3). `prop`: a `lathe@1` vase of 11 outline points (10 bands, every
  corner sharp, both ends on the axis) at 1,000 segments, 10,000 faces, with `mod.bevel@1 {width: 0.002, segments: 2}`
  then `mod.normals@1 {mode: weighted}`. `mesh`: the same lathe at 100 segments, 1,000 faces, with `mod.subdivide@1
  {levels: 2}`. `scatter`: an `instance@1` of the bush and the flower from `distribute {on: field, mode: poisson,
  min_distance: 0.5, prune: larger_first, seed: 2017, max: 100000}` over `field`, a flat 200 × 200 m plate, which holds
  more than 100,000 points at 0.5 m. `path`: a `curve@1` of 1,001 points (1,000 spans), a slow spiral, `catmull_rom`.
  Observed at the base (`geometry`): the prop's builder mesh has 20,020 vertices (10 bands × 1,001 rings × 2, so 10 ×
  1,000 faces) and 22,000 welded faces after its bevel; the mesh's builder mesh 2,020 vertices (1,000 faces) and 15,200
  faces after two levels; the scatter keeps 54,485 elements; the curve's length is 1,000.05 m; the forest's tree
  estimates 2,000 vertices.
- **The forest** (`forestDoc`; criterion 3). 10,000 elements of one `instance@1`, 100 × 100 at 3 m, of `tree`: a
  `lathe@1` of 5 outline points with both ends on the axis at 249 segments, 4 bands × 250 rings × 2 = 2,000 vertices,
  with `mod.sway@1 {amount: 0.3, wind: {direction: 0, speed: 5, gust: {scale: 20}}, seed: 7}` (#2016's numbers),
  `enabled` on one side and off on the other. A ground plate, a camera at (148.5, 35, 360) looking at (148.5, 0, 140),
  fov 60, 1920 × 1080.
- **The taste scenes** (criterion 4). `gardenDoc`: #2013's garden, a 10 × 10 m plate scattered with a 1.2 m bush and a
  0.3 m flower (poisson at 0.5 m, seed 2013, unturned, pruned larger first). `vaseDoc`: #2013's vase, a ball of radius
  0.1 m written at (−0.3, 1.2, 0) over a 1.2 × 0.05 × 0.8 m table top at y 0.8 tilted 20° about +Z, rested on it by
  `rest_on` with every default, over a floor. `windDoc`: #2016's field, 36 identical lathe trees 2 m apart, 12 along the
  wind by 3, each with the sway above, seed 2016, on a ground plate. `plateDoc` in the filmic look. Each with a camera,
  a sun (casting, where it helps) and a day sky.

## The surface under test

Each test enters through the base's own calls: `deep-gpu run [--planted <name>]` (#377) with `view3d` (#378; its
`size`, `fps`, `from`, `frames`, `capture`, `targets: ['final']`, `timings` with each frame's `gpu_ms` and
`pixel_hash`, #425's `lod: true`, and `counts: true` with `meshes_built`, `instances_written`, `element_uploads` and
`encoded`), and `deep-show run` (#393) with `deep_show`, `geometry` (#420: `items`, `stage: built`, `estimate_only`,
each builder row's `declared` and `stack`, an instancer's `elements`) and `frames` (#387: each frame's `ran`). What
the base lacks is below, each named by this job.

## Assumed surfaces

The issue and the design name the behaviours but not these calls and fields; each is this job's choice, the most
natural one beside the base's own calls. The implementer provides exactly these, or disputes them.

1. **Terrain tile rows in `view3d`'s `lod` report.** With `lod: true`, each frame's `lod` array also holds one row
   for each terrain plate (a `plate@1` with `params.terrain`) the document draws: `{"item": "<plate ID>", "tiles":
   [{"tile": [i, j], "level": n, "errors_px": [e0, e1, …]}, …]}`, beside #425's rows. The tests find it by `item` and
   read only `tiles`, so #425's fields may be absent or null on it.
   - One entry for every tile of the plate, on screen or not, none twice, in any order. Tile [i, j] covers x from
     −size[0] ÷ 2 + i × tile to −size[0] ÷ 2 + (i + 1) × tile, and z likewise with j: i counts along +x from the
     plate's −x edge, j along +z from its −z edge, both from 0 (#2014's cell naming, on tiles of `tile` metres).
   - `level`: the level the frame draws the tile at. 0 is full detail; each level up is coarser, up to `lod_levels` −
     1. A tile that morphs between two levels reports the finer of the two.
   - `errors_px`: `lod_levels` numbers, one per level: that level's error over the tile (its largest deviation in
     height from full detail, in metres) projected at the tile's nearest point to the eye at the view's size (the
     call's `size` at internal scale 1, whatever the surface draws at), in device px. `errors_px[0]` is 0, and none is
     lower than the one before.
   - The selection: `level` is the coarsest level whose `errors_px` is at most the document's `lod_px`, a pure
     function of the view computed on the CPU.
2. **`view3d` gains `ground_points: {"item": "<plate ID>", "at": [[x, z], …]}`.** Each frame then carries
   `ground_points: [{"at": [x, z], "tile": [i, j], "level": n, "y": h}, …]`, one per point asked, in the order asked,
   `at` echoing it (world x and z in metres). `tile` is the tile the point lies in; `level` the level this frame draws
   that tile at, as its row in `lod` says; `y` the world height of the surface this frame draws at (x, z): where the
   vertical line through the point meets that tile's triangles as the vertex stage places them, at its level with any
   morph applied. It is read back from the GPU, or computed on the CPU by the same function the vertex stage runs on the
   same vertex data and morph weights; never from the full-detail samples unless the tile draws at full detail with no
   morph. The tests ask only points on the plate, inside a tile.
3. **`budget.lod_px` lowers the terrain's `lod_px` too.** The base reads a document's `budget.lod_px` for mesh levels
   (each class's 1 device px, which a document may only lower); terrain tiles read the same value.
4. **`geometry` gains `timings: true`** (deep-show). The call then builds the items it answers afresh, reusing nothing
   an earlier call or an earlier build of the same content left, and adds CPU times in milliseconds, measured
   in-process with a monotonic clock around each step as this call ran it:
   - each entry of a builder row's `stack` (one per modifier, as at the base) gains `ms`, that modifier's step;
   - an `instance@1` row whose elements come from `from: {distribute}` gains `distribute_ms`: sampling, density,
     pruning and projection, to the elements the row lists;
   - a `curve@1` row gains `arc_length_ms`: tabulating its arc-length table over every span, its frames apart.

   Without `timings` nothing changes. The bevel clause reads `stack[0].ms + stack[1].ms` of `prop` (`mod.bevel@1`, then
   `mod.normals@1`), the subdivision clause `stack[0].ms` of `mesh`.
5. **`view3d`'s `counts` gains `terrain_tiles_selected`.** With `counts: true`, each frame carries the number of terrain
   tiles whose level this frame selected afresh: 0 when nothing the selection reads (the view, its size, the plates,
   `lod_px`) changed since the frame before, so the last selection stands. The base's counters (`meshes_built`,
   `instances_written`, `element_uploads`, `encoded`) count the plate's tile draws and any per-tile data too.
6. **`benchmarks/budgets.json` gains the task `canvas-ground`**: `{"id": "canvas-ground", "command": ["node",
   "benchmarks/canvas.mjs", "ground"], "margin": 0.5, "limits": {}, "targets": {"bevel_ms": 20, "subdivide_ms": 50,
   "distribute_ms": 200, "arc_length_ms": 2, "still_steps": 0, "sway_gpu_ms": 0.5}, "initialReason": "<why, naming
   #2017>", "criteria": ["#2017.751f674c"]}`, which the lane's `validateBudgets` accepts against the merge base's file.
   `canvas.mjs ground` measures this suite's budget fixtures on release builds and `canvas.mjs judge` holds its targets,
   as the other canvas tasks do; what the mode prints is the implementer's.
7. **`scripts/lanes.mjs`** gains the two lines under Run them.
8. **Planted programs**, each reachable only through `deep-gpu run --planted <name>` (`Planted` in
   `crates/deep-gpu-layer/src/main.rs`); an unknown name is `bad_input` at the base.

   | Name | The wrong program | Criterion |
   |---|---|---|
   | `terrain_lod_by_distance` | Each tile's level comes from its distance alone: at every view size the plate draws each tile at the level, and with the morph, that the shipped selection gives it in a 1920 × 1080 view from the same pose, so the level reads the tile's distance and never the view's size. `errors_px` are reported as shipped, at the view's size; everything else is shipped. | AC1 `#2017.3e1437ba` (issue-named: "a planted selection by distance alone") |
   | `terrain_shades_own_level_normals` | Each tile shades from the vertex normals of the level it draws (each vertex's normal from that level's own triangles around it, as the base's full-detail plate computes its smooth normals), in place of normals from the plate's full-resolution heights. Levels, positions and everything else are shipped. | AC2 `#2017.e778fe83` (issue-named: "a planted plate that shades from each level's own vertex normals") |

9. **The taste call** is recorded in `tests/acceptance/2017/TASTE.json`, the one file anyone adds to this folder after
   this commit, and only to record the owner's answer: `{"issue": 2017, "criterion": "#2017.44d27f48", "verdict":
   "looks_right" | "looks_wrong", "who", "when": ISO 8601, "screenshots": {name → sha256 for the five pictures and the
   recording}, "note"?}`.

No `twins.json`: every test fails on the merge base at an assertion of its own (`BASE-FAILURE.txt`), and the two
planted programs are run by the tests themselves.

## Criteria to tests

IDs are `#2017.` and the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the
leading `- [ ] ` dropped (`scripts/proof-change.mjs`). Each test's name starts with `AC<n> #2017.<id>`. Each file's
header states its fixture, numbers and wrong programs in full.

| ID | Criterion (short) | File (tests): what it asserts |
|---|---|---|
| AC1 `#2017.3e1437ba` | Levels by error projected at 1080p and 4K; 200 points within lod_px; a planted selection by distance alone fails at 4K, naming the tile | `ac1-levels-by-error.test.ts` (2): the plate from one pose at 1920 × 1080 and 3840 × 2160: a row per tile (64); each tile's level the coarsest whose `errors_px` is within 1 px; every `errors_px` at 4K twice its 1080p value; some tile coarser than full detail at 1080p, some finer at 4K, none coarser; each of the 200 points in its own tile at that tile's level, its drawn height within 1 px of full detail on screen (+1e-3 px) at both sizes; at 1080p at least 20 points on coarser tiles more than 0.05 px off. `--planted terrain_lod_by_distance` at 4K: the point judge fails, each failure naming its tile. Catches: the base (no rows, no points); a level by distance or by 1080p's projection at every size; errors not projected through the view's size; a level not the coarsest within lod_px; a coarse level or a morph that strays past lod_px; a drawn height read from full detail |
| AC2 `#2017.e778fe83` | Under a sun 10° up a pixel's lit color holds within one code value across a level change; a plate shaded from each level's own vertex normals fails, naming the tile | `ac2-light-holds.test.ts` (2): the shaded plate straight down, as written and with `lod_px` lowered to 0.01: some tile in view changes level (and drew coarser as written); every pixel of each such tile keeps its final color within one code value in each channel; the pixels compared span at least 40 code values of green, under 1% clipped. `--planted terrain_shades_own_level_normals`: some pixel moves by more, the failure naming its tile. Catches: the base (no rows); normals from each level's own triangles; full detail shaded one way and coarse levels another; detail below a level's spacing lost from the light |
| AC3 `#2017.751f674c` | Budgets: bevel 20 ms, subdivision 50 ms, distribution 200 ms, arc length 2 ms, nothing per frame while still, sway 0.5 ms of GPU at 1080p | `ac3-budgets.test.ts` (2): (1) the still scene for six frames: in deep-show the first frame runs more operators than the bare scene's and no later frame more than the bare scene's same frame (`ran`); `view3d` selects tiles at frame 0 and some tile draws coarser, and after it builds no mesh, writes no instance, uploads no element, encodes no batch and selects no tile. (2) `budgets.json` holds `canvas-ground` with the numbers, margin 0.5, this criterion's ID and #2017 in its reason, valid against the merge base's file, and `lanes.mjs` times this file; on the debug build the timing fields answer, the scatter keeps 20,000 to 99,999 of 100,000 points and the tree has 2,000 vertices; then, on a reference Mac at rest only, release deep-show five runs after warm-up for the four CPU numbers, and the forest's sway on against off, five runs after warm-up, each judged by `judgeLimit`. Catches: the base (no task, no fields, no counter); a selection or a build that runs every frame; a regression past the issue's numbers |
| AC4 `#2017.44d27f48` | Screenshots and a recording shown; one taste call recorded, else INCONCLUSIVE | `ac4-taste.test.ts` (1): writes the pictures and the recording from this run's final targets (The taste call), prints their SHA-256s, then reads `TASTE.json`: absent or recorded on other SHA-256s is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on these passes. Attaching them to the PR and showing them in the session is the implementer's, outside any test |

## Readings where the issue leaves a choice

### Criterion 1

- **"From the same pose at 1080p and at 4K"**: one document and one camera, drawn at 1920 × 1080 and 3840 × 2160. The
  base's camera takes `fov` across the wider side, so 4K's focal length in px is exactly twice 1080p's, and an error
  projected at 4K is exactly twice the same error at 1080p (held within a part in 10⁶).
- **"Its error projected at that size"** follows Level of detail: chunks streamed by view: a level's error is its
  largest deviation from full detail in metres, projected at the tile's nearest point, and the view draws the coarsest
  level within `lod_px`. The tests read it through `errors_px` (Assumed surfaces 1) and hold the level to it. `lod_px`
  is each budget class's 1 device px; the fixture's class is `work_product` and doesn't lower it.
- **"The drawn height stays within `lod_px` of full detail on screen"** is |y − full| × focal ÷ the point's distance
  from the eye ≤ lod_px, plus 1e-3 px for f32 heights: the vertical difference projected at the point's distance, the
  projection the selection itself uses ("selects ... so ... stays within"). A strict screen-space displacement of a
  vertical step differs from it by the obliquity of the view ray, and a selection that projects at a tile's nearest
  point by distance would then stray past 1 px at the frame's edges without any fault in its levels. The plant still
  fails by up to twice.
- **"200 sampled ground points"**: samples at an odd column and row, which every level past full detail drops, so a
  point sees a coarse level's deviation; off tile edges, where skirts or stitching are the implementer's; on screen at
  1080p, where both sizes see them. Full detail at a sample is the field's value there (#2014), computed by the test.
- **The drawn height** is the view's own (Assumed surfaces 2), morph included, so a morph is held to the same bound.
  The design morphs odd vertices "toward the parent's surface by a weight that is a smoothstep of the tile's projected
  error between half of `lod_px` and `lod_px`"; the parent's error can be twice `lod_px` there, so a mix that reaches
  the parent while the tile's own error is near half `lod_px` strays past the bound. In the scratch model below, that
  literal weighting put 8 of the 200 points past 1 px at 1080p (worst 1.22 px). The criterion bounds the drawn height,
  so this suite reads that as the criterion failing, not as a test fault.
- So the points can't pass by reading full detail, at least 20 of them at 1080p must lie on coarser tiles and be off
  by more than 0.05 px.
- **"A planted selection by distance alone"** reads a tile's distance and never the view's size; planted as 1080p's
  levels at every size, it passes at 1080p by construction and is judged at 4K, where the criterion says it fails.
  "Naming the tile" is each failure of the point judge naming `tile [i, j]`.
- **Why the zigzag.** A selection that is right at 1080p draws, between about 108 m and 216 m, coarse levels whose
  points are 0.5 to 1 px off at 1080p and so 1 to 2 px off at 4K, where the shipped selection draws full detail. A
  scratch model (not kept: levels by halving the samples, each tile's error the largest deviation over its samples, the
  coarsest within 1 px at the nearest point, no morph) gave: shipped worst 0.73 px at 1080p and 0.86 px at 4K; the plant
  22 of the 200 points over 1 px at 4K in 12 tiles, worst 1.46 px; 55 of 64 tiles finer at 4K.

### Criterion 2

- **"When its tile changes level"**: the same plate, camera, sun and pixels, drawn as written and with the document's
  `budget.lod_px` lowered to 0.01, so the level is the only thing that changes (Assumed surfaces 3). A tile changes level
  when its `level` differs between the two.
- **"A plate pixel"** is every pixel of every tile that changes level, seen through an orthographic camera straight
  down: a pixel then sees the same ground (x, z) whatever height its tile is drawn at, so only its shading can change.
  No pixel centre lies on a tile edge in this view.
- **"Its lit color"** is the 8-bit `final` target in a look with tone map none at exposure scale 1, no finish, deband,
  bloom or ao, under a sun with no shadow and a black sky with no ambient, on one matte grey: the sun's light on the
  shading normal alone. "At most one code value" is each of red, green and blue.
- **The ripple** is 6 m long and 10 cm high: level 1 keeps it in its heights to 0.39 px, so lod_px 1 draws level 1,
  while its normals tilt the light by up to 6°, which under a sun 10° up changes N·L by up to about 0.1 against 0.17
  for flat ground. Light from each level's own vertex normals loses that. The hills and the ripple together never tilt
  the ground more than 8.7° from the sun, so no pixel faces away from it into black.
- So a black or flat picture can't pass, the pixels compared must span at least 40 code values of green with under 1%
  clipped. On the base (full detail at both lod_px, smooth vertex normals, the earlier field with 12 cm ripples and 3 m
  hills) the frame's green ran from 0 to 217, median 153, with 1.3% black where the ground faced away; with this field
  it runs from 88 to 201, median 157, none clipped (observed).

### Criterion 3

- **"Compared with the merge base"** is the perf lane's and the budget window's (`docs/parallel-proof.md` §12a and its
  reading rule for "in the local preflight"): the task `canvas-ground` names this criterion, the lane's validator
  accepts it against the merge base's `budgets.json`, and the lane and the window compare the task's p50 with the merge
  base at its 50% margin. The test judges the issue's own numbers, five runs after warm-up, by the lane's `judgeLimit`.
- **The four CPU clauses** run on a release `deep-show`, each run a fresh process, one warm-up and five.
  - "A bevel with weighted normals on a 10,000-face prop builds in under 20 ms" is the bevel step plus the
    weighted-normals step, on a builder mesh of 10,000 welded faces; the builder's own time isn't the bevel's.
  - "Two levels of subdivision of a 1,000-face mesh" is the subdivide step at `levels: 2` on 1,000 faces.
  - "Distributing 100,000 points with pruning" is the distribute step with `max: 100000` (the field's cap) over a part
    that holds more, two prototypes pruned larger first: so it keeps fewer than 100,000 (54,485 at the base), and the
    test asks at least 20,000.
  - "A curve's arc-length table for 1,000 spans" is the table of a 1,001-point open curve at the default 16 samples a
    span.
  - "Faces" are the builder's faces, before any modifier: the lathe's bands times its segments. The base's `geometry`
    reports welded faces only after the stack, so the test doesn't read them; the counts follow from the params and
    were observed at the base (Fixtures).
- **"Nothing in this task runs per frame while still"** is read by counters on a still scene of the task's steps, in
  the canvas core (deep-show's `ran`) and in the view (`view3d`'s counts and the tile counter). The base's scheduler
  runs one operator every frame even for a scene of one box (observed: `ran` 22, 1, 1, 1 for a box; 83, 1, 1, 1, 1, 1
  for the still scene), so the core is held to the bare scene's count frame by frame, not to 0. At the base the view's
  existing counters already read 0 after the first frame on the still scene (observed); the tile counter is new. A
  swaying tree moves every frame by design, its GPU deform reading t, so the still scene has none; the sway's
  per-frame cost is the GPU clause.
- **"Sway on 10,000 instanced trees of 2,000 vertices each adds under 0.5 ms of GPU at 1080p"** is the difference of
  the median `gpu_ms` of the forest with its sway on and with it `enabled: false`, 300 frames at 30 fps a side at
  1920 × 1080 in one process, the sides' order alternating, one warm-up run and five (#166's `canvas-water` pattern); a
  negative difference reads as 0, and the first run's sides must draw different pixels. It draws on the debug
  `deep-gpu`: GPU time is the GPU's work, which the CPU build's profile doesn't change.

### Criterion 4

- **The pictures**: `scattered-field.png`, `vase-on-table.png`, `terrain-1080p.png`, `terrain-4k.png`,
  `trees-in-wind.png` and `wind-rolling.apng` (TASTE.json's names), each a frame's `final` target re-encoded without
  filtering at zlib level 9, so the same pixels give the same SHA-256. The trees in wind are at 2.5 s; the recording is
  0 to 6 s at 8 fps, 49 frames at 480 × 270, the wind blowing along the field's 22 m.

## The taste call

`ac4-taste.test.ts` writes to `docs/evidence/2017/` and prints the SHA-256s. The implementer attaches them to the PR,
shows them in the session, and records the owner's answer in `TASTE.json` (Assumed surfaces 9). The pictures are
evidence for the one taste call only; no other test reads them.

## Not tested

No criterion asks for these, so none is tested: `cover` by slope, height and noise; `heightmap`; `heights: chunks@1`
and its residency; the morph's own shape (only its bound, through the drawn heights); skirts and cracks between tiles;
seeks and a level's purity across frames (the selection is checked for one frame per view); shadow passes' levels;
overlays and `horizon`; physics, picks and rest_on on a coarse level; the task's memory and p95 budgets. The Proof
line's parity fixtures are the implementer's to add beside the parity suite; this suite generates its documents.

## What the implementer adds outside this folder

- The two `scripts/lanes.mjs` lines under Run them.
- The `canvas-ground` task in `benchmarks/budgets.json`, and its `ground` mode and judge in `benchmarks/canvas.mjs`.
- In `deep-gpu`: the terrain tile rows in `lod`, `ground_points`, `counts`' `terrain_tiles_selected`, and the two
  planted names.
- In `deep-show`: `geometry`'s `timings`.
- After the owner's taste call: `TASTE.json`, and the pictures attached to the PR.
