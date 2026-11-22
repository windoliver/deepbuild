# Acceptance tests for #2386: tiles that stand taller than their cell

Written first, from issue #2386 (its Scope, its Fields, seven acceptance criteria and its Proof line; it has no comments
and no Oracle line), the design sections it links and those they lean on, and base commit `b6b99ad8c`, by a job that
never saw an implementation; no other worktree, branch or pull request was read. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test per
criterion clause that needs its own run, plus exactly the four planted programs the criteria name.

## What was read

- The issue as saved for this job (`#2386`, body and title; no comments).
- `docs/canvas-primitives.md`: Units and axes; Document envelope; Spatial index; Mark set and columns `marks@1`; Mark
  set: atlas tiles; Mark set: logic columns; Mark set: hex grid; Frame and group: y sort; Selection (session state);
  Control: picks on rows and grid focus; Control: point.
- `docs/technical-design.md`: Proven on the base; Every task carries its own budgets; Criteria to tests; Wrong
  programs; Dogfooding; Built to be hard to get wrong. `docs/parallel-proof.md`: A suite's own lane file. AGENTS.md,
  CONTRIBUTING.md.
- At the base, only for how surfaces are driven: `scripts/proof-change.mjs` (`criterionId`), `scripts/proof-runs.mjs`
  (`twins.json`), `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`, `validateBudgets`), `scripts/lanes.mjs`
  (`timed`, the lane file), `benchmarks/budgets.json` and `benchmarks/canvas.mjs` (a task's entry and its mode); the
  suites `467/` (helpers), `1653/` and `1653-redraft-ac2-flip/` (atlas tiles through `deep-canvas-render`, the two
  planted programs of its criterion 4), `536/` (the hex fixtures, the taste call's form), `535/` (`deep-show run`:
  `deep_show`, `batches`, `spatial`, `scope`, `input`, `frames`), `538/` and `2760/` (a budget criterion), `539/` (a
  click checked against its geometry first); `crates/deep-canvas-marks/src/{atlas,turn,data}.rs` (a row's quad, its
  turn, a column's types), `crates/deep-marks-render/src/{lib,raster}.rs` (`check`, `raster`, `geometry`, the
  `planted` values each takes), `crates/deep-marks-raster/src/lib.rs` (`visible`, `batches`),
  `crates/deep-show/src/{main,hub,spatial,input,frames}.rs` (the scenario, `deep_show`'s reply, `row_boxes`, a press
  on a row, `frames`), `crates/deep-canvas/src/{scope,area}.rs` (a click, the selection, a target's area).

Code was read only to learn the surfaces. Every expected value comes from the issue and the design.

## What the base already does, and these tests don't credit

#1653 draws an atlas tile set on square, isometric and hex grids, each row a quad of the grid's cell times its `scale`,
centered on its cell's center, in order of center y, then center x. #535 draws free rows that size centered on (x, y),
turned about that center, answers `spatial` for a 2D document (each set's bounds, the rows a box meets), gives
`batches` an atlas run's `instances`, and lets a click on a row select it. #536 hands a hex row's hexagon to the hit
test; a row on a square or an isometric grid is hit by its quad, so on the flat click board the click at (4, 2)
selects the row at (1, 0), as the issue says. The base reads none of `atlas.draw`, `atlas.anchor` and `slice`: `check`
passes a document that writes any of them (`draw: [0, 32]` and `anchor: [0.5]` among them) with no issue, and both
binaries draw it as if they weren't written. A quad drawn at its atlas cell's size already shows its texels exactly
(probed: the code cell on a square grid of 64 u cells, through `raster` and through `deep_show`'s snapshot, 0 of 4,096
pixels differ), so criterion 1's "exactly" asks nothing new of the sampler. A still set runs no operator after its
first frame; a set whose `at.pos` a channel moves runs them every frame (the budget's fixture). An unknown `planted`
value answers `bad_input` on both binaries; `tiles_in_row_order` is `raster`'s.

No test passes at the base: 19 fail on an assertion because the behaviour is missing, and two are `INCONCLUSIVE:` (the
budget's timing, by the machine; the taste call, which nobody has made). `BASE-FAILURE.txt` is the base run.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 \
  scripts/lease npx vitest run --root tests/acceptance/2386 --testTimeout=600000 --no-file-parallelism
npx tsc --noEmit -p tests/acceptance/2386    # type-check
```

Each file builds its binary once in `beforeAll` (`cargo build --locked --bin deep-canvas-render` or `--bin deep-show`,
debug, the default features, honoring `CARGO_TARGET_DIR`, with rustup's bin on PATH where it exists) and copies it to a
temporary folder. Everything draws with Vello CPU, so every test but the budget's timing runs on any machine with no
GPU. Asset stores, evidence stores and binary copies are temporary and deleted; only `ac7-taste.test.ts` writes outside
them, its two pictures to `docs/evidence/2386/` (The taste call). Every test passes an explicit 30-minute timeout.
Imports: Node built-ins, vitest, and `../467/`, `../1653/`, `../536/` and `../535/helpers.ts`, read only, as #536's
suite imports #467's and #1653's. No process is started but `cargo`, the two binaries, `git` (two read-only calls in
the budget's record) and `node` on `scripts/benchmark.mjs`, each waited for, none stopped by name or port.

`lane.json` says the folder runs alone: its files build cargo binaries. `ac6-budget.test.ts` is a timed file (What the
implementer adds outside this folder).

Gates: no cargo on the machine is `BLOCKED:` (a failed test, never a pass). The budget's timing is `INCONCLUSIVE:` off
a reference Mac, off mains, in Low Power Mode, not thermally nominal or under load. Criterion 7 is `INCONCLUSIVE:`
until its taste call is recorded. No other reading depends on the machine or its load.

## The surface under test

**No new binary or call.** The issue names two fields, four planted programs and a budget; everything else is read
where the base already shows it, through `deep-canvas-render` (one JSON line in, one out, as #1653's and #536's suites
drive it) and `deep-show run` (one JSON scenario on stdin, one answer `{"ok": true, "replies": […]}`, as #535's suite
drives it). **Every name below marked "this suite's" is this job's choice, the least the criteria need; the implementer
builds exactly these, or a dispute goes to a blind redraft.**

### The fields

| Field | As the tests write it | Whose |
|---|---|---|
| `draw` | `params.atlas.draw: [u, u]` on a `marks@1` set with `mark: "image"` and `atlas`, e.g. `"atlas": {"asset": "<sha256>", "cell": [64, 64], "padding": 1, "draw": [64, 64], "anchor": [0.5, 0.75]}` | the issue's |
| `anchor` | `params.atlas.anchor: [f32, f32]`, a fraction of the drawn quad from its top left | the issue's |
| a grid row | `grid: {shape: "square" \| "isometric", cell: [u, u]}`, typed columns `cx`, `cy` (`i32`) and `tile` (`u16`) as `{dtype, len, data: base64}`, `n`; no key column, so a row's key is its index and row 0 of `wall` is `wall#0` | the base's (#1653, #535) |
| a free row | `place: "free"`, columns `x`, `y` (`f32`), `tile` (`u16`) and, where it turns, `angle` (`f32`, deg) | the base's (#535) |
| `slice` beside `draw` | criterion 3's free row with `params.slice: {left: 4, top: 4, right: 4, bottom: 4}` and columns `w`, `h` (`f32`) | the design's (Mark set: atlas tiles) |
| the set's place | `at: {pos: [x, y, 0]}` on the set | the base's |

Documents are #373's figure envelope with one writer layer for `deep-canvas-render` (#1653's form) and #391's film
envelope with a 2D orthographic camera over the page for `deep-show` (#535's form), each atlas a PNG the suite writes,
in the line's `store` folder by its SHA-256 or in the scenario's evidence store and the document's `assets`.

### Calls

| Call | Sent | Read | New or existing |
|---|---|---|---|
| `deep-canvas-render check` | `{doc, look, store}` | `ok`; the error issues (`severity: "error"`) with their own fields (`code`, `ids`, `path` and any other, not `what`, `fix`, `check` or `close`) | existing (#373) |
| `deep-canvas-render raster` | `{out, doc, look, t, store, view: {zoom}, planted?}` | `ok` and the PNG at `out` | existing (#373, #1653) |
| `deep_show` | `{session, doc, document, include: ["issues"] \| ["issues", "pixels"]}` | `outcome`; with pixels `snapshots[0].sha256` (a PNG in the evidence store, at the document's size), `visible: [{id, box}]`, `batches: [{batch, items, instances}]` | existing (#393, #535) |
| `spatial` | `{doc, t: 0, queries: [{box: {min: [x, y, -1], max: [x, y, 1]}}]}` | `items.<set>.bounds {min, max}` in page u; `results[i]`, the rows the 2D spatial index holds that meet box i, each `<set>#<key>` | existing (#421, #535) |
| `scope`, `input` | the scenario's `clock` and `display` (#383's); `{call: "scope", at, panel}`; a press and its release 60 ms apart `{call: "input", at, panel, event: {type: "down" \| "up", pos}}` in panel px | `state.camera` (`target`, `view_width`), `state.rect`; `state.selection`, each a row as `<set>#<key>` | existing (#383, #384, #535) |
| `frames` | `{doc, count, step: "1f", pixels}` | `frames[].frame_ms`; with pixels `frames[].pixel_hash` | existing (#387, #856) |
| scenario `planted` | one of this suite's three names below | | existing form, this suite's names |

### What the calls must answer

- **A row's box is its drawn quad**, `draw` times its `scale` placed so `anchor` is on the cell's center, or on (x, y)
  for a free row, in page u (the set's own u plus its `at.pos`), wherever the base shows a box: `spatial`'s
  `items.<set>.bounds` (the union of the set's rows' quads), the box the spatial index holds for the row (what a box
  query meets), and the set's row in `deep_show`'s `visible` table (px of the snapshot, which are page u at the
  document's size). A turned free row's box is the box of its quad turned about (x, y).
- **A snapshot draws the quad**: at zoom 1 and scale factor 1 each pixel of a quad drawn at its atlas cell's size is
  that cell's texel.
- **A click on a grid row selects through the row's cell**: `state.selection` after a click is the row whose cell (an
  isometric cell's diamond, a square cell's square) holds the point, a point on an edge two cells share going to the
  cell with the smaller (cy, cx), or empty when no row's cell holds it, whatever quads stand over the point.
- **`check` refuses** a `draw` that isn't two finite numbers above 0, an `anchor` that isn't two finite numbers, and
  `draw` on a set with `slice`: `ok: false` with an error issue that names the set (its `ids` hold it, or its `path` is
  `items/<set>` or under it) and the field: its `path` is `items/<set>/params/atlas/<field>` or under it, or the
  field's name stands as a whole word in the issue's own fields. For `draw` beside `slice` the field is `draw`.
- **`batches`** holds one entry whose `items` hold the set and whose `instances` is its row count, as at the base.

### Planted programs

| Where | Name | The wrong program | Criterion | Whose |
|---|---|---|---|---|
| `deep-show run`, scenario `"planted": "draw_fills_grid_cell"` | `draw_fills_grid_cell` | A row's quad is the grid's cell times its `scale`, centered on the cell's center, whatever `atlas.draw` and `atlas.anchor` say (the merge base's draw): the wall row's box is [−32, −16, 64, 32]. Its boxes are honest reports of that quad | AC1 | this suite's |
| `deep-canvas-render raster`, `"planted": "tiles_in_row_order"` | `tiles_in_row_order` | An atlas tile set draws its rows in the order written instead of by center y, then center x; `draw` and `anchor` are honored | AC2 | the base's (#1653) |
| `deep-show run`, scenario `"planted": "draw_anchors_at_center"` | `draw_anchors_at_center` | A row's quad keeps its `draw` size and sits with its own center on the cell's center, or on (x, y), and a free row turns about that center, as if every `anchor` were [0.5, 0.5]: the tree's box is [24, 32, 16, 32] | AC3 | this suite's |
| `deep-show run`, scenario `"planted": "grid_hit_reads_quads"` | `grid_hit_reads_quads` | A click meets a grid row by its drawn quad, topmost first, as the merge base met it, not by its cell; drawing and boxes are honest | AC4 | this suite's |

Each is reachable only there and only for this proof; any other `planted` value stays `bad_input`, as the base answers
an unknown one. `twins.json` maps each criterion's ID to its name.

## The fixtures

`fixtures.ts` writes the atlases and the documents. Every texel is opaque or clear, never between.

- **The isometric wall** (criteria 1, 2 and 7). Grid isometric with cell [64, 32]; the wall atlas has four 64 × 64 px
  cells: a block (a 64 × 32 px diamond with 32 px of wall above it, its footprint's center on the anchor), a code cell
  whose texel (x, y) is [4x, 4y, 200 or 40 by parity], so every texel differs from its neighbours, and two opaque solid
  cells, red and blue. The set `wall` has `draw: [64, 64]` and `anchor: [0.5, 0.75]`. Criterion 1: one row on (0, 0)
  showing the code cell, the set at (64, 64) of a 128 × 96 u page. Criterion 2: (1, 0) in red written first, then
  (0, 0) in blue, the set at (32, 48) of a 96 × 80 u page. Criterion 7: a 6 × 6 floor of 64 × 32 px diamonds with no
  `draw`, blocks along its two far edges and three standing on it.
- **The square grid's tree** (criteria 3, 4, 5 and 7). Grid square with cell [16, 16]; the tree atlas has three
  16 × 32 px cells: a round tree whose trunk stands on the anchor, a pine, and a code cell. `tree`: one row on (2, 3)
  with `draw: [16, 32]` and `anchor: [0.5, 0.75]`. `free`: one free row of the same atlas at (100, 50) with `anchor:
  [0.5, 1]`, showing the code cell; on a page of its own, the same row with `angle` 90. Both sets sit at the origin of a
  160 × 80 u page, so the criterion's numbers are page u. Criterion 7: a 20 × 10 ground of grass with no `draw` and
  twenty trees, some one cell behind another.
- **The click boards** (criterion 4), isometric with cell [32, 16], each in its own panel at 4 px a u: `board`, 4 × 4
  opaque 32 × 16 px tiles with no `draw`, cell (cx, cy) written as row 4 cy + cx, at (80, 24) of a 160 × 96 u page;
  `tall`, opaque 32 × 32 px tiles with `draw: [32, 32]` and `anchor: [0.5, 0.75]` at (32, 48) of a 64 × 64 u page, on
  two pages: on one, cell (−1, −1), written first (`tall#0`), and cell (0, 0) (`tall#1`); on the other, cell (0, 0)
  alone (`tall#0`); and the tree's page.
- **The 10,000 rows** (criterion 6): `rows`, cell (i mod 100, ⌊i ÷ 100⌋) of a square grid of 4 u cells, 4 × 8 px tiles
  of one atlas with `draw: [4, 8]` and `anchor: [0.5, 0.75]`, at (4, 8) of a 404 × 408 u page. For the budget a keyed
  channel slides the set 15 u a second along x, and the other side is the same set without `draw` and `anchor`.

A set that the criteria place around the origin sits at an `at.pos` that puts its quads on the page (the page's origin
is its top left); its boxes, pixels and clicks are read at the criterion's numbers plus that position.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: `#2386.` + the first 8 hex digits of the SHA-256 of each criterion's text,
trimmed, white space collapsed, computed from the issue's body. Each `describe` and each test's name starts with
`AC<n> #2386.<id>`, and each file quotes its criterion in full. Test count: 3 + 2 + 4 + 4 + 3 + 4 + 1 = 21.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| AC1 `#2386.2ebddc6b` | `ac1-wall.test.ts` (3) | (1) The row `wall#0` on cell (0, 0) has the box [−32, −48, 64, 64] three ways: the set's bounds, the spatial index (probed within 1/64 u on each side) and the set's row in `deep_show`'s table. (2) The snapshot is 128 × 96 px and each of the box's 4,096 pixels equals the code cell's texel, exactly. (3) `draw_fills_grid_cell`: the bounds are [−32, −16, 64, 32] and the check fails naming `wall#0` and both boxes. Fails: the base (the cell's quad; the tile squeezed to half its height), a stretched, shifted or filtered draw, a box that isn't the drawn quad |
| AC2 `#2386.4227a011` | `ac2-overlap.test.ts` (2) | (1) Both quads hold the pixel's center and (1, 0)'s center is lower (checked), and `raster` at zoom 1 reads red, the tile of (1, 0), at (10, −20). (2) `tiles_in_row_order`: it reads blue, the tile of (0, 0), and the check fails naming `pixel (10, -20)`. Fails: the base (no quad reaches the pixel), rows drawn as written |
| AC3 `#2386.022a979d` | `ac3-tree.test.ts` (4) | (1) `tree#0` on (2, 3) has the box [24, 24, 16, 32], three ways. (2) `free#0` at (100, 50) has [92, 18, 16, 32], three ways. (3) Turned 90° its box is a quarter turn of that box about (100, 50), three ways, and the snapshot draws over exactly that box. (4) `draw_anchors_at_center`: the tree's box is [24, 32, 16, 32], and the first failure, in the criterion's order, names `tree#0` at cell (2, 3). Fails: the base (16 × 16 quads on the centers), an anchor ignored, a turn about the quad's center or a corner |
| AC4 `#2386.dd0857c2` | `ac4-clicks.test.ts` (4) | (1) The geometry (checked): (4, 2) inside (0, 0)'s diamond, outside (1, 0)'s, under (1, 0)'s quad; (8, 4) on both edges. Both clicks select `board#0`. (2) The geometry (checked), and the spatial index holds the tile at (0, 0) over (0, −12) on both pages; the click selects the row at (−1, −1) (`tall#0`) where the set has one and nothing where it doesn't. (3) The geometry (checked), and the index holds `tree#0` over (32, 30); a click at (36, 52), inside the tree's cell, selects `tree#0`; the click at (32, 30) doesn't. (4) `grid_hit_reads_quads`: (4, 2) selects `board#1` and the check fails naming `click (4, 2)` and both rows; the checks of (2) and (3) fail on it too. Fails: the base at (1) (it selects `board#1`) and at the standing tile of (2) and (3); a hit test that reads quads |
| AC5 `#2386.a5636b1c` | `ac5-refusals.test.ts` (3) | `check`, each beside a document that passes and differs by the field: `draw: [0, 32]` refused naming `tree` and `draw`; `anchor: [0.5]` refused naming `tree` and `anchor`; the free row with `slice` beside its `draw` refused naming `free` and `draw`. Fails: the base (it reads none of them), a refusal that names nothing, a check that refuses every `draw` |
| AC6 `#2386.b3f6fe16` | `ac6-one-draw.test.ts` (1), `ac6-hashes.test.ts` (1), `ac6-budget.test.ts` (2) | (1) The 10,000 rows' bounds are their drawn quads' ([−2, −6, 400, 404] in the set's u) and `batches` holds one entry drawing `rows` with `instances` 10,000. (2) Each of ten pictures of #1653's and #536's fixtures keeps the pixel hash the merge base draws; none is blank; and the isometric fixture given a `draw` hashes differently. (3) The budget's record, and (4) its timing (The budget). Fails: rows drawn one by one or in several draws, a `draw` ignored, any pixel of a set without the fields moved, a missing task, a slower frame |
| AC7 `#2386.e61634a0` | `ac7-taste.test.ts` (1) | The check run (below) writes the two pictures and prints their SHA-256s, then reads `TASTE.json`: none, or a call on other pictures, fails `INCONCLUSIVE:`; `looks_wrong` fails; `looks_right` on exactly these pictures passes. It judges no picture |

Clauses the base already meets, each asserted beside something it lacks, and what fails each:

- **Criterion 4's click at (0, −12) and its click at (32, 30).** The base draws no tall tile, so nothing stands over
  either point and it selects the row at (−1, −1), nothing, and nothing. Each test first asks the spatial index that the
  tile at (0, 0), or the tree, stands over the point, which fails at the base; and `grid_hit_reads_quads` fails both
  clauses, which its test asserts.
- **Criterion 6's one instanced draw.** The base draws the 10,000 rows in one instanced draw, at their cells' size. The
  test reads the set's bounds in the same run, which at the base are the cells'. A set drawn row by row fails the count.
- **Criterion 6's hashes.** The merge base keeps its own hashes. The test ends by asking that the isometric fixture
  given a `draw` hashes differently, which fails at the base; any change that moves a pixel of a set without the two
  fields (a default `draw` of the atlas cell, a default `anchor` off the center) fails the comparison.

## The hashes

`base-hashes.json` holds, for each picture `ac6-hashes.test.ts` draws, the SHA-256 of its pixels (the text `<width>x<height>`,
a newline, then its RGBA bytes row by row) as base commit `b6b99ad8c` draws it through `deep-canvas-render raster` at
its default setting (the scalar level, the f32 pipeline): #1653's terrain floor (`../467/helpers.ts` `terrain` over
`../1653/helpers.ts` `FLOOR`) at zooms 1 and 2.7, its animated rows (`animDoc`) at 0 and 0.3 s, its isometric fixture
(`isoDoc`), and the flip redraft's two rows with the right one flipped h, then v (built here from the same fields:
that document lives in its test file); #536's terrain fixture (`terrainDoc`) and tile sheet (`tileSheet`) at zoom 2,
and its 6 × 6 pointy odd hex board. These are facts of the merge base, not of the work. To make them again: check out
the merge base and run `ac6-hashes.test.ts`; it prints each fixture's hash in the file's own form.

## The budget

`ac6-budget.test.ts` is timed. Its first test reads the record and runs anywhere: `benchmarks/budgets.json` holds

```json
{"id": "canvas-atlas-draw", "command": ["node", "benchmarks/canvas.mjs", "atlas-draw"], "margin": 0.5, "limits": {},
 "targets": {"draw_rows_frame_ms": 0.1}, "initialReason": "Issue #2386 …", "criteria": ["#2386.b3f6fe16"]}
```

(the task's ID, its command and its target's name are this suite's; the number is the issue's), the file passes the
lane's `validateBudgets` against the merge base's, and `scripts/lanes.mjs`'s `timed` holds
`tests/acceptance/2386/ac6-budget.test.ts`. The second test is the timing, described in the file's head: a release
`deep-show`, `frames` of the 10,000 sliding rows with and without the two fields, 300 frames a side, the difference of
the sides' median `frame_ms`, five runs after a warm-up, judged by `judgeLimit`; INCONCLUSIVE, never a pass, where the
lane can't judge a timing. `benchmarks/canvas.mjs atlas-draw` is the implementer's, measuring the same fixture.

## The taste call

`ac7-taste.test.ts` is the check run. It draws through `deep-canvas-render raster` at zoom 1 (one atlas texel a device
pixel) and takes each picture exactly as raster wrote it, to `docs/evidence/2386/`:

- `isometric-wall.png`: the isometric wall fixture, 416 × 288 px;
- `square-tree.png`: the square grid's tree fixture, 336 × 208 px.

Each file's SHA-256 is printed. `tests/acceptance/2386/TASTE.json`, written by whoever records the call after the
pictures are attached to the PR and shown in the session: `{"issue": 2386, "criterion": "#2386.e61634a0", "verdict":
"looks_right" | "looks_wrong", "who", "when": ISO 8601, "screenshots": {"isometric-wall.png": sha256,
"square-tree.png": sha256}, "note"?}`. Raster's output is deterministic, so a call stands while this run's two hashes
equal the ones it names; a changed picture makes the run INCONCLUSIVE again until a new call. No agent records a call
it wasn't given. This suite ships no TASTE.json.

## Readings where the issue and design leave a choice

- **"The box"** of a row is read where the issue's Scope says the drawn quad shows: "a set's bounds, a row's box in
  the spatial index and its row in `deep_show`'s table". The base shows a row's box nowhere by itself, so each set
  whose box a criterion states holds that one row: its bounds (`spatial`'s `items.<set>.bounds`, #535's reading) are
  then the row's box, exactly. "A row's box in the spatial index" is what box queries meet: a thin box just outside
  each side of the stated box doesn't meet the row and one just inside does, which holds the index's box within 1/64 u.
  "Its row in `deep_show`'s table" is the set's entry of `visible`, which at the base holds one entry a set, the union
  of its rows; were the table to list rows as `<set>#<key>`, their union is read. No new reply field is asked for.
- **Coordinates.** The criteria's boxes, pixels and clicks about the origin are the set's own u; a page's origin is its
  top left (Units and axes), so the set sits at an `at.pos` and each number is read plus that position.
- **"A snapshot at zoom 1 and scale factor 1"** is `deep_show`'s snapshot at the document's own size, through a camera
  whose view is the page. **"Equal the atlas cell's texels exactly"**: every one of the 4,096 pixels equals, on all
  four channels, the opaque texel at its place in the cell, with no tolerance.
- **"The pixel at (10, −20)"** is the device pixel whose corner is there at zoom 1, as #1653's suite reads its pixel
  at (10, 2); its center (10.5, −19.5) lies in both quads. "Reads the tile" is within 1 code and opaque, as there.
  Read through `raster`, where the base already has the criterion's planted program.
- **"Turned 90° it turns about (100, 50)"** is judged without choosing the turn's sense, which this issue doesn't
  move: the row's box is one of the two quarter turns of [92, 18, 16, 32] about (100, 50), [100, 42, 32, 16] or
  [68, 42, 32, 16], and the snapshot draws over exactly that box. A turn about the quad's center gives
  [84, 42, 32, 16], about a corner another box again.
- **"Naming the first row"**: the checks run in the criterion's order (the tree, the free row, the turned row), and the
  first failure names `tree#0` at cell (2, 3). **"Anchors every quad at its center"** keeps the quad's `draw` size, so
  the planted tree's box is [24, 32, 16, 32]; a draw that also drops the size is criterion 1's program.
- **"Selects"** is the scope's selection after a click (`state.selection`), as #535's suite and the base's own test of
  a hex set read it; no pick control is declared. **"Nothing"** is an empty selection. **"Never selects the tree"**:
  after the click the selection doesn't hold `tree#0`, on the set that holds the tree alone; a click at (36, 52), inside
  the tree's cell whether a square grid centers a cell on (cx × w, cy × h), as the base lays it out, or puts its corner
  there, selects the tree, so the click reaches rows.
- **"On the standing part of the tile at (0, 0)"** and the tree standing over (32, 30) are shown from the program, not
  only by arithmetic: a 1 u box about the point meets that row in the spatial index. So these clauses fail on a program
  that doesn't draw the tall tile there.
- **"A planted hit test that reads quads"** meets a grid row by its drawn quad, topmost first. The base's
  `hit_by_quad_bounds` (#539) is that program only inside a pick control's hit, on a hex grid; this criterion's click
  is a selection, so the name is new.
- **"Refused at check"** is `deep-canvas-render check`, the document check #1653's and #536's refusals are read from.
  **"Naming the field"**: in the error's path or its own fields, not its prose; codes are the implementer's. **"`draw`
  beside `slice`"** is written as the design writes a `slice` set (a free row with `w` and `h`); the field named is
  `draw`. The same set without `slice` passes; a set with `slice` and no `draw` is #2039's to judge and isn't checked.
- **"One instanced draw for their atlas"** is one `batches` entry drawing the set with `instances` 10,000 (#535's
  reading). The set's bounds are read in the same run, so the rows counted are rows drawn with their `draw`.
- **"Each fixture of #1653 and #536"** is each atlas document those suites draw (The hashes); #1653's halo cards and
  status groups hold no atlas set. **"Pixel hash"** is of the decoded pixels, not the PNG's bytes.
- **"Add under 0.1 ms a frame"**: a frame is `frames`' `frame_ms`, the frame's evaluation, in which the rows are placed;
  a channel slides the set so that every frame places them again (a still set runs nothing after its first frame, and
  at the base rows with `frames` and `frame_rate` run nothing either). The two sides differ by the two fields alone.
- **The taste pictures** are raster's PNGs as written, at zoom 1.

## Not asserted, because no criterion says so

The implementer owes these a mapping or a note (AGENTS.md: review requirement → change → proof): `scale` times `draw`;
"sampling stays inside the atlas cell and the padding rule holds" beyond criterion 1's exact texels (a code cell
between other cells); rows ordered by their cell's center "never their quad's" where the two orders differ (one
`anchor` a set makes them agree); a hex cell's hexagon under a tall tile, and a vertex four square cells share; a free
row "hit through its drawn quad, as today"; a pick control's hit and grid focus on tall tiles ("on an isometric grid a
pick now meets the diamond"); `draw` or `anchor` of the wrong type or not finite, beyond `[0, 32]` and `[0.5]`; the
terrain recipe with `draw`; a set's bounds with several rows beyond the 10,000; tiles of several sizes in one atlas,
cells of more than one row's ground and collision, which the issue leaves out.

## What the implementer adds outside this folder

- `scripts/lanes.mjs`: `'tests/acceptance/2386/ac6-budget.test.ts'` in `timed` (the first budget test asserts it).
  `lane.json` already puts the folder in `alone`.
- `benchmarks/budgets.json`: the task `canvas-atlas-draw` above; `benchmarks/canvas.mjs`: its mode `atlas-draw`.
- `crates/deep-show` and `crates/deep-marks-render`: the three planted names, each reachable only by its `planted`
  value; `tiles_in_row_order` is there.
- `docs/evidence/2386/`: the two pictures the check run writes, and `tests/acceptance/2386/TASTE.json` once the owner's
  call is given.

`BASE-FAILURE.txt` is the run at the base.
