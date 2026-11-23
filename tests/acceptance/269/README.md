# Acceptance tests for #269: a grid image mark, a 2D image drawn from a logic grid

Written first, from issue #269 (its Scope, seven acceptance criteria, its Proof line and its Oracle line), the design
sections the issue links and those they lean on, and the base commit `d84d541e9` (origin/main), by a job that never saw
an implementation; none existed, and no commit, branch, pull request or other checkout naming #269 or `grid_image` was
read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding). Lean: one file per criterion, one test per criterion and one per planted program the criterion
names, each test carrying its criterion's ID. The issue's Oracle line says no upstream test checks these criteria, so
there is no Oracle lane. The issue's "it reopens a raster mark (Cut, or deferred), so it needs your decision" is decided:
the owner asked for #269 to be built.

## What was read

- The issue (`gh issue view 269`, no comments) and its dependency #535 (logic columns).
- `docs/technical-design.md`: Cut, or deferred; the canvas module table (marks2d, data, cells, scene3d); 2D marks and
  paint; Mark set, scale and encode; Budgets by class; Dogfooding.
- `docs/canvas-primitives.md`: Mark set and columns `marks@1` (its `mark:` list); Mark set: atlas tiles; Mark set: logic
  columns; Array and table, and its column view; Cell grid `cells@1` and its logic grid; Marks in 3D; Look `look@1`; Draw
  path: GPUI or the GPU layer; The cost model and its class table (data view: 2 ms of frame GPU); Golden.
- At the base, only for surfaces and conventions: `AGENTS.md`; `scripts/proof-change.mjs` (`criterionId`),
  `scripts/proof-runs.mjs` (twins), `scripts/lanes.mjs`, `scripts/lanes-lists.mjs` (`alone`, `timed`, a suite's own
  `lane.json`), `scripts/alone-lint.mjs`, `scripts/loads-lint.mjs`, `scripts/benchmark.mjs`, `benchmarks/budgets.json`,
  `benchmarks/canvas-world.mjs`; `crates/deep-canvas/src/registry/bare.rs` and `document/check.rs` (which kinds need a
  `requires.modules` entry); `crates/deep-canvas-marks/src/scene.rs` (`KINDS`) and `drawn.rs` (`is_3d`: a `mark.` kind
  is a 3D item); `crates/deep-canvas-cells/src/logic_grid.rs` (`grid.out_of_range` and where it's raised);
  `crates/deep-canvas-marks/looks/clean.json` (its roles); `crates/deep-show` (`main.rs`'s scenario `planted`,
  `frames.rs`' `eval` and its issues, `time.rs`' `determinism`, `snapshot.rs`); `crates/deep-marks-render` (`layer.rs`,
  `lib.rs`'s looks, `raster.rs`); `crates/deep-gpu-layer` (`main.rs`'s `--planted`, `marks2d.rs`' `layers`, `film.rs`'
  `film2d`, `view3d.rs`' `counts`, `row_uploads` and `assets`); the suites `538/` (the model: documents, programs, the
  taste call, the budget), `535/`, `537/` (`view3d`, `row_uploads`, `putAsset`), `385/`, `458/` (Vello CPU against the
  GPU layer), `495/` (`layers` at t, `film2d` from a frame), `265/` and `1634/` (a frame budget on the reference Mac),
  and `544/wat` (the assembler).

Code was read only to learn the surfaces. Every expected value comes from the issue, the design and this suite's own
programs and fixtures: the Catmull-Rom kernel's half level is solved here (`helpers.ts` `catmullRom`, `halfLevel`), and
the values of every cell at every step are written out beside each program.

## What the base already does, and these tests don't credit

`deep-show run` presents film documents, runs their logic items' programs, evaluates and draws their frames on the CPU
(`eval`'s snapshot, render-back's Vello CPU raster) and plays and seeks them (`determinism`); the cell grid's logic grid
raises `grid.out_of_range`. `deep-gpu run`'s `layers` draws a 2D writer layer by Vello CPU and by the GPU layer, and
`film2d` plays a 2D film on the GPU layer with each frame's `gpu_ms` and `pixel_hash`, but neither runs a logic item, and
neither has `counts` or `timings` for a 2D item. No kind draws a logic grid as an image. `BASE-FAILURE.txt` is the run
at the base.

## Run them

```sh
npm ci && npm run build --workspaces   # once, in a fresh worktree
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 \
  npx vitest run tests/acceptance/269/<file> --testTimeout=600000 --hookTimeout=600000
npx tsc --noEmit -p tests/acceptance/269
```

Each file builds what it drives once, in `beforeAll`, through `../538/helpers.ts` (`cargo build --locked --bin
deep-show`, the default set; `cargo build --locked --bin deep-gpu` for `ac3`, `ac5` and `ac6`; `ac6` also `--release`,
on a reference Mac at rest only), honoring `CARGO_TARGET_DIR`, and copies it to a temporary folder. Programs are
assembled by #544's assembler (`tests/acceptance/544/wat`, read only) through the same helpers. Folders are temporary and
deleted; only `ac7-taste.test.ts` writes outside them, its pictures to `docs/evidence/269/`. No process is started but
`cargo`, the assembler, `deep-show`, `deep-gpu` and `git` (`ac6`'s merge base, read only), each waited for, none stopped
by name or port.

**The lanes.** The folder runs alone by its own `lane.json` (reason `shared: the GPU`: `ac3`, `ac5` and `ac6` draw on the
Metal device through `deep-gpu`, and `ac3` hashes `deep-show`'s renders on it). The implementer adds the timed line to
`scripts/lanes-lists.mjs` (this README is the instruction):

```js
// #269's folder (blind) runs alone by its lane.json; ac6-budgets.test.ts times a 256 × 256 grid image's frame GPU with
// judgeLimit.
timed.push('tests/acceptance/269/ac6-budgets.test.ts');
```

Gates: off macOS, a GPU-layer reading fails `INCONCLUSIVE:` (`ac3`, `ac5`, `ac6`); a `determinism` refused for want of
a GPU fails `BLOCKED:` (`ac3`); an assembler that doesn't build fails `BLOCKED:`; none is a pass. `ac6` times only where
the perf lane's rule can judge (a reference Mac, Low Power Mode off, thermal state nominal, the load under the cores at
each run's start and end), else INCONCLUSIVE before anything is timed; its record and its surfaces are read everywhere.
`ac7` is `INCONCLUSIVE:` until its taste call is recorded. No other reading depends on load, timing or a device.

## The surface under test

The issue names fields, an issue code, planted programs and a budget, but no call. Everything goes through calls the base
already has, extended by the fields below. **Every field, reply field, plant name and value below that the issue or the
design doesn't give is this job's choice, the smallest the criteria need; the implementer builds exactly these, or a
dispute goes to a blind redraft.** Times are flicks (705,600,000 a second; a 60 Hz step is 11,760,000), and "step k" is
the frame at k × 11,760,000, which reads the arrays as step k left them; a `film2d` frame n at 60 fps is step n.

### The item

The issue writes `mark.grid_image {grid, size, cell, roles, sample, edge}`, "a 2D mark". The tests write it as an item
kind of its own, **`grid_image@1`**, with exactly the issue's fields as `params`:

| Field | As written | Source |
|---|---|---|
| `kind` | `"grid_image@1"` | the issue's `mark.grid_image`; see Readings |
| `params.grid` | `"teams.ground"`, a logic item's i32 array (`<logic>.<name>`) | the issue |
| `params.size` | `[64, 64]` (`[cols, rows]`); `[8, 8]` and `[256, 256]` in the other fixtures | the issue |
| `params.cell` | `[8, 8]` (u; the films draw 1 u a px); `[32, 32]` and `[2, 2]` in the other fixtures | the issue |
| `params.roles` | `["term_red", "term_green", "term_blue", "none"]`: value 0 to 2 a team, 3 `none`, 4 and up past `roles` | the issue (`[role \| none] ≤ 16`); the clean look's roles |
| `params.sample` | `"nearest"` or `"smooth"`, always written | the issue |
| `params.edge` | `1`, always written | the issue |
| `at.pos` | the grid's top-left corner: cell (0, 0) there, x to the right and y down, the array row-major (index cols × y + x), as the cell grid's logic grid reads it | this job's |

The document needs no `requires.modules` entry for it, as it needs none for `marks@1`, `vector_field@1` or `logic@1`.

### `deep-show run`: what the tests send and read

One JSON scenario line on stdin, one answer `{"ok": true, "replies": […]}`, as #538's suite drives it
(`../538/helpers.ts`).

| Call | What the tests send | What they read | New or existing |
|---|---|---|---|
| `deep_show` | `{session, doc, document, include: ["issues"]}` | `outcome: "presented"` | existing; the kind is new |
| `eval` | `{doc, t, pixels}` | `snapshots[0].sha256`, a PNG in the evidence store at the document's size, 1 px a u; `issues` | existing |
| `eval`'s `issues` | | **`grid.out_of_range {array, cell: [x, y], value, step}`** raised by a grid image at the frame of the step a cell's value first passes `roles`, its fields at the top level or under `actual`, as the cell grid's logic grid raises it | the code exists; a grid image raising it is new |
| `determinism` | `{doc, display_hz: 60, at_times, compare: "same_machine"}` | `outcome: "compared"`, each `frames[i].t`, `play.pixel_hash`, `seek.pixel_hash` | existing |
| scenario `planted` | `grid_bspline_rebuild`, `grid_bilinear_rebuild`, `grid_share_passes_half` | | existing form, new names |

### `deep-gpu run`: what the tests send and read

One `{out, calls}` line on stdin, one answer `{"ok": true, "replies": […]}`, `--planted <name>` on the command line. The
document is the session's form of the same film (`fixtures.ts` `sessionForm`): one writer layer `main` every item is
on, no camera. The look is the shipped `clean`.

| Call or field | What the tests send | What they read | New or existing |
|---|---|---|---|
| `layers` | `{call: "layers", doc, look: "clean", t, by: ["vello_cpu", "gpu_layer"], assets}` | `layers[]` (the one `layer: "main"`), its `drawn.vello_cpu.png` and `drawn.gpu_layer.png`, PNGs in `out` named by their SHA-256 | existing (#385); **new: it runs the document's logic items** |
| `film2d` | `{call: "film2d", doc, look: "clean", fps: 60, from, frames, hash, counts?, timings?, assets}` | `frames[]`: `frame`, `pixel_hash`, `gpu_ms` | existing (#417, #430); **new: it runs the document's logic items** |
| **`assets`** on both | `{<sha256>: <path of the program's bytes>}` | | new on these calls; `view3d`'s field (#537), read the same way: each `logic@1` item's program by its `params.program` hash, run as the logic module runs it, so the frame at t reads the arrays as step ⌊t × step_rate⌋ left them |
| **`counts: true`** on `film2d` | | each frame's **`row_uploads: {"<item>": [y, …]}`**: for each grid image, the grid rows (0-based, ascending, each once) that frame wrote to the GPU: all rows on a film's first frame (a new reader: frame 0, or the frame a film opened `from`, a seek), else exactly the rows holding a cell the frame's step changed, `[]` when it changed none | new on `film2d` (`view3d`'s name, #537) |
| **`timings: true`** on `film2d` | | each frame's **`draw_ms: {"<item>": ms}`**: the GPU time of each grid image's draw on that frame, its row uploads and its pass, as the device times them | new |
| `--planted` | `grid_keeps_previous_step`, `grid_role_before_rebuild` | | existing form, new names |

The GPU layer draws a grid image from its grid, uploaded to the GPU by rows: the GPU path rebuilds the shares itself,
never from a picture the CPU drew (criterion 5's plant and criterion 3's `row_uploads` read that path).

### Plants

Each is one criterion's wrong program and changes nothing else; any other `planted` value stays `bad_input`, as the
base's do. The CPU render's three are `deep-show run`'s scenario values; the GPU layer's two are `deep-gpu run
--planted` names. They live in the binaries, as #538's do, so this folder has no `twins.json` of twin folders: every
test fails on the base at its assertion (`BASE-FAILURE.txt`).

| Name | Where | Criterion | The wrong program |
|---|---|---|---|
| `grid_bspline_rebuild` | `deep-show` `planted` | 1 | `smooth` rebuilds each role's share with the approximating cubic B-spline (k(0) = 2/3, so a lone cell's share peaks at 4/9) in place of the Catmull-Rom cubic |
| `grid_bilinear_rebuild` | `deep-show` `planted` | 1 | `smooth` rebuilds each role's share bilinearly from the four nearest cell centres, (1 − \|x\|)(1 − \|y\|) |
| `grid_share_passes_half` | `deep-show` `planted` | 2 | a pixel draws a role only where that role's share passes 1/2, antialiased as shipped, and draws nothing elsewhere |
| `grid_keeps_previous_step` | `deep-gpu --planted` | 3 | on each played frame after a film's first, the GPU path writes the grid rows the step before the frame's step changed, so a played frame at step k draws step k − 1's grid; a film's first frame (frame 0, or one opened `from` a frame) still uploads its own step's grid whole |
| `grid_role_before_rebuild` | `deep-gpu --planted` | 5 | on the GPU path each pixel first takes the role of the cell it lies in, then rebuilds that role's share alone and antialiases it against nothing over `edge` px; the CPU render stays the shipped one |

## Programs

`programs.ts` holds the logic programs as WebAssembly text, assembled by #544's assembler. Each exports `memory`, `init`,
`step`, `reads_at` (0) and `writes_at` (4096), writes one i32 array `ground` from 4096, and writes every cell at every
step; its values are written out beside it as a function of (x, y, step).

- `teams` (the grid fixture, 64 × 64, `teams.ground`): for x < 32, y < 32 a three-role corner of four cells, two of them
  one role: role 0 above row 16, then role 1 left of column 16 and role 2 right of it; for x ≥ 32, y < 32 `none` but the
  lone held cell (48, 16), role 0; for y ≥ 32 blocks of 4 × 4 cells cycling the roles, ((x ÷ 4) + (y ÷ 4)) mod 3, where
  step k (from 1) moves the 10 cells of slots 10 k to 10 k + 9 on by one role and keeps them there (slot s is cell 2,048
  + (397 s mod 2,048)), so every step changes exactly 10 cells, in 9 or 10 rows; and cell (8, 6), inside role 0, holds 7 from
  step 30 (that step changes 11 cells).
- `front` (the corner fixture, 8 × 8, `front.ground`): role 0 in rows 0 to 3, then role 1 left of column 4 and role 2
  right of it.
- `war` (the budget's fixture, 256 × 256, `war.ground`): blocks of 16 × 16 cells cycling the roles, each cell moving on
  by one role every 50 steps at its own phase, 7 i mod 50, so every step changes 1,311 of the 65,536 cells, 2%, spread
  over every row.

## Fixtures

`fixtures.ts`. Each is a #391 film envelope as #535's and #538's suites write one: `{format: 1, id, profile: "film",
title, description, size, seed: 269, camera: "cam", transport: {span: "4s", frame_rate: [60, 1]}, items, assets}`, a 2D
orthographic `camera@1` over the page, the logic item `{kind: "logic@1", params: {program: <sha256>, step_rate: 60,
writes: {ground: {type: "i32", count}}}}` with its program in the evidence store and listed in `assets`. Each holds a
`rect@1` backdrop in the `ground` role under everything (so every pixel is opaque on every path, and `none` shows the
ground) and a key: one 24 × 16 `rect@1` in each team role, whose centre pixels give each role's color as the canvas draws
it; no color is written in this suite.

- **The grid fixture** (`gridDoc`): `teams` drawn at 8 px a cell, one grid image per sample asked, side by side from
  (8, 8) 16 px apart: `nearest_map` and `smooth_map` (criteria 1, 4 and 7, 1,056 × 552), or `smooth_map` alone, "the
  `smooth` fixture" (criteria 3 and 5, 528 × 552); the key at y = 528.
- **The corner fixture** (`cornerDoc`): `front` drawn smooth at 32 px a cell, `corner_map` at (8, 8), 272 × 296, its
  corner at (136, 136); the key at y = 272.
- **The budget's fixture** (`warDoc`): `war` drawn smooth at 2 px a cell, `war_map` at (0, 0), 512 × 512.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s `criterionId`. Each test's name starts with `AC<n> #269.<id>`; each file quotes its
criterion in full. The judges are `judges.ts`' pure functions of the pictures. Test count: 3 + 2 + 2 + 1 + 2 + 1 + 1 = 12.

| ID | File (tests) | What it asserts, and the wrong programs it fails |
|---|---|---|
| AC1 `#269.871a5dac` | `ac1-nearest-smooth.test.ts` (3) | `deep-show`'s `eval` of the grid fixture at step 20: every pixel of every cell of `nearest_map` is its value's role color, or the ground, exactly; on `smooth_map` the lone cell (48, 16), along both axes both ways and the four diagonals through its centre, passes from its role to the ground where k(x)·k(y) = 1/2 crosses that line (0.545 cells on an axis, 0.553 on a diagonal; solved here for the exact pixel line), within 0.5 px, and every pixel more than 1 px from that half level is its role inside and the ground outside, within one level. `grid_bspline_rebuild`: no pixel within 2 cells of the lone cell is nearer its role than the ground, and the judge fails naming `smooth_map`. `grid_bilinear_rebuild`: the four diagonal crossings are at 0.414 cells within 0.5 px, and the judge fails naming `smooth_map` and a diagonal. Fails: a cell off by a pixel or a color, a kernel other than the interpolating cubic, a share that doesn't sum to 1, a role read from a status color |
| AC2 `#269.5fc34243` | `ac2-corner.test.ts` (2) | `eval` of the corner fixture at step 2: each of the four cells' centres shows its own role; every pixel of the 4 × 4 cells round the corner (16,384) is a blend of the three roles (in sRGB or linear light, the better fit) with at most a quarter of the ground in it. `grid_share_passes_half`: a pixel within a cell of the corner draws none and the judge fails naming `pixel (x, y)` |
| AC3 `#269.93b14936` | `ac3-rows-seek.test.ts` (2) | `film2d` with `counts` plays frames 0 to 73: frame 0 uploads all 64 rows and every later frame exactly the rows its step changed; opened at each of 20 sampled frames (3, 7, …, 73, not 30), that frame uploads all 64 rows and hashes as the played one; `determinism` at the same 20 times gives one `pixel_hash` played and seeked; on both paths the 20 played hashes are all different. `grid_keeps_previous_step`: a played frame's hash differs from the same step seeked, and the judge fails naming `step k` |
| AC4 `#269.21d6944d` | `ac4-out-of-range.test.ts` (1) | `eval` at step 29 raises no `grid.out_of_range`; at step 30 one naming `teams.ground`, cell [8, 6], 7 and step 30; at step 30 every pixel of cell (8, 6) of `nearest_map` is the ground, the 4 × 4 pixels at that cell's centre on `smooth_map` are, and the neighbours (cells (7, 6) and (9, 6) nearest, (6, 6) and (10, 6) smooth) still draw role 0 |
| AC5 `#269.2dd4ac2c` | `ac5-cpu-gpu.test.ts` (2) | `layers` of the `smooth` fixture at step 20 by Vello CPU and by the GPU layer: every pixel within one level in R, G, B and A; the Vello CPU picture equals `deep-show`'s canonical render of the same document at step 20 within one level, and at every cell centre away from an edge shows the cell's role. `grid_role_before_rebuild`: a pixel at an edge (its cells two either side hold more than one value) differs and the judge fails naming `pixel (x, y)` |
| AC6 `#269.6ad7e180` | `ac6-budgets.test.ts` (1, timed) | `benchmarks/budgets.json` has a task naming the criterion with a command, valid by the lane's validator against the merge base's file, and `timed` lists this file; on the debug build the budget's fixture draws (`film2d`, 60 frames, every frame from 1 uploading rows, every frame with `gpu_ms` and `draw_ms.war_map`); then, on a reference Mac at rest only, a release build, a warm-up and five runs, each run's p95 of `gpu_ms` over frames 5 to 59 judged against 2 ms by `judgeLimit`, and each run's median `draw_ms.war_map` printed as the reading |
| AC7 `#269.40ff86cd` | `ac7-taste.test.ts` (1) | The check run (below) writes the two pictures and prints their SHA-256s, then reads `TASTE.json`: none, or a call on other pictures, fails `INCONCLUSIVE:`; `looks_wrong` fails; `looks_right` on exactly these pictures passes. It judges no picture |

At the base every test fails at an assertion that names the missing behavior (`BASE-FAILURE.txt`).

## The budget

"Compared with the merge base" is the perf lane's and the budget window's: they run `benchmarks/budgets.json`'s task and
compare its p50 with the merge base at the task's margin. The test holds the record and judges the issue's own number.
The implementer adds a task whose `criteria` hold `#269.6ad7e180` and whose `command` the lane runs, valid by
`validateBudgets` against the merge base's file. As #265's does, it can run this file through `benchmarks/canvas-world.mjs`
(the file added to that script's `TESTS`), for example:

```json
{"id": "canvas-grid-image", "command": ["node", "benchmarks/canvas-world.mjs", "tests/acceptance/269/ac6-budgets.test.ts"],
 "margin": 0.5, "limits": {}, "targets": {"frame_gpu_p95_ms": 2}, "initialReason": "<why, naming #269>",
 "criteria": ["#269.6ad7e180"]}
```

The reading per run: the p95 of `film2d`'s `gpu_ms` (#417's frame GPU: the GPU layer's part, the window's and the
finish's) over frames 5 to 59 of the budget's fixture, played from frame 0 at 60 fps with `timings` and nothing hashed or
captured; the draw time recorded beside it is the median `draw_ms.war_map` of the same frames.

## The taste call

`ac7-taste.test.ts` is the check run. It draws the criteria's own fixtures through `deep-show run` and takes each picture
from the canvas's canonical render of the hub session's frame (`eval`'s snapshot), re-encoded so the same pixels always
give the same bytes, into `docs/evidence/269/`:

- `grid-beside.png`: the grid fixture at step 20, `nearest_map` (its cells) with `smooth_map` beside it, and the key;
- `corner.png`: the corner fixture at step 2, the three-role corner at 32 px a cell.

Each SHA-256 is printed. `tests/acceptance/269/TASTE.json`, written by whoever records the call after the pictures are
attached to the PR and shown in the session: `{"issue": 269, "criterion": "#269.40ff86cd", "verdict": "looks_right" |
"looks_wrong", "who", "when": ISO 8601, "screenshots": {"grid-beside.png": sha256, "corner.png": sha256}, "note"?}`. A
call stands while this run's two hashes equal the ones it names. No agent records a call it wasn't given; this job wrote
none.

## Readings where the issue leaves a choice

- **The kind.** In the design `mark.<name>` names the 3D marks (Marks in 3D: `mark.point`, `mark.image`, …, kinds
  `mark.<name>@1`), and at the base a `mark.` kind makes its item a 3D item (`deep_canvas_marks::drawn::is_3d`), while
  every 2D kind is `<name>@1`. `marks@1` was set aside: its rows are instanced marks with columns and `encode`, it can
  never mix mark types, and its `grid` already means the atlas layout (`{shape, cell, size}`), where the issue's `grid`
  is an array. So the issue's 2D mark is the kind `grid_image@1`, its fields as written.
- **Roles** come from the look: the clean look's `term_red`, `term_green` and `term_blue` (three hues, all far from the
  ground and none a status color), read back from the key the canvas draws. **The ground** is the picture's top-left
  pixel, on the backdrop.
- **"Matches its cells pixel for pixel"**: every pixel of a cell equals the key's color for its value, or the ground for
  `none`, with no tolerance.
- **"Draws the region where k(x) × k(y) passes 1/2 … within 0.5 px"**: the role's coverage of a pixel is its color's
  projection between the ground and the role, in sRGB or in linear light, whichever line the part-covered pixels round
  the lone cell lie nearer (so an edge antialiased in either space reads alike). Along each of eight lines through the
  cell's centre (a pixel corner), the edge is where that coverage passes 1/2, interpolated between the pixel centres either
  side, against the half level solved for that very line (an axis line runs half a pixel off the axis, so its crossing
  is 0.542 cells, not 0.545). And every pixel more than 1 px from the half level, beyond any antialiasing over `edge` =
  1 px, is wholly the role or the ground.
- **"Draws nothing there"** (B-spline): no pixel within 2 cells of the lone cell is nearer its role than the ground.
  **"A four-pointed star whose diagonal reaches 0.414 cells"** (bilinear): the diagonal crossings at √2 − 1 within 0.5 px.
  **"Naming the mark"**: the item ID, `smooth_map`.
- **"Every pixel draws one of the three roles and none draws `none`"**: every pixel of the 4 × 4 cells round the corner
  (whose rebuilt shares read only the three roles' cells) decomposes into the three roles and the ground with the
  ground's weight at most 1/4 and no role's below −0.1, in sRGB or in linear light, whichever fits better; antialiasing
  between two roles is a blend of roles. At 32 px a cell, so the hole the planted rule leaves (a wedge under the corner)
  spans many pixels. **"Naming the pixel"**: `pixel (x, y)`.
- **"Uploads only their rows"**: `film2d`'s `row_uploads` lists exactly the rows the step changed, no more and none
  missing. **"Whole after a seek"** (the Scope): the first frame of a film opened `from` a frame. **"20 sampled times"**:
  steps 3, 7, 11, 14, 18, 22, 25, 29, 33, 36, 40, 44, 47, 51, 55, 58, 62, 66, 69 and 73. **"One pixel hash seeked and
  played"**: on the GPU layer, `film2d`'s played frame against the same frame opened `from` it; on the canonical render,
  `determinism`'s two sides. Since every step changes the grid, the 20 played hashes must also differ. **"Naming the
  step"**: `step k`.
- **"Draws nothing in its cell"**: nearest, the whole cell is the ground; smooth, its centre's 4 × 4 pixels are (a value
  past `roles` counts as no role, so its neighbours' shares still reach into its cell's border, as they would round a
  `none` cell). **"Naming the array, the cell, the value and the step"**: the issue's fields, as #538's suite reads them.
- **"The CPU render and the GPU draw"**: `layers`' `vello_cpu` and `gpu_layer` sides of one call, the CPU side held to be
  `deep-show`'s canonical render (what 2D goldens and checks read) within one level. **"Within one 8-bit level at every
  pixel"**: each of R, G, B and A. **"Differs at the edges"**: some differing pixel lies where the cells two either side
  of its cell hold more than one value.
- **"2% of its cells a step"**: 1,311 of 65,536 every step. **"Within the data view class's 2 ms of frame GPU"**: each
  run's p95 of `gpu_ms`, five runs judged by the lane's `judgeLimit`. **"Its draw time recorded as a reading"**:
  `draw_ms.war_map`, printed, never judged.
- **The taste call's "beside its cells"**: the grid drawn nearest (its cells, one color a cell) with the same grid drawn
  smooth beside it.

## Not tested, because no criterion reaches it here

The refusals the Scope implies (more than 16 roles, an array whose count isn't cols × rows, a status color as a role);
`edge` other than 1; cells that aren't square; grid images in 3D or in the web player; `deep_kinds` listing the kind.
They are follow-ups for the implementer's own tests.

## What the implementer adds outside this folder

- The kind `grid_image@1`: its check, its CPU raster in the canonical render (`deep-show`) and in `layers`' Vello CPU
  side, its GPU path in `deep-gpu`, and `grid.out_of_range` from `eval`.
- In `deep-gpu`'s `layers` and `film2d`: `assets` and the logic items run from them; `film2d`'s `counts` (`row_uploads`)
  and `timings` (`draw_ms`).
- The five planted names, in `deep-show`'s scenario `planted` and `deep-gpu`'s `--planted`.
- `benchmarks/budgets.json`'s task (and its command's entry), and the `timed` line above.
