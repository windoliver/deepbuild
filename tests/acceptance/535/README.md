# Acceptance tests for #535: live game state: logic arrays as mark-set and atlas columns, with checked narrowing, an alive column and changed row ranges

Written first, from issue #535 (its Scope, its Fields, seven acceptance criteria, its Proof line and its one comment),
the design sections it links and those they lean on, and base commit `7c5e1cc8d` ("Merge pull request #2184"), by a
job that never saw an implementation; none existed, and no other worktree, branch or pull request was read. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). Lean: one test per criterion clause that needs its own run, plus exactly the five planted twins the
criteria name. The issue's oracle line says no upstream test checks these criteria.

## What was read

- The issue (`gh issue view 535`), body and comment.
- `docs/canvas-primitives.md`: Array and table: column view; Mark set and columns `marks@1`; Mark set: atlas tiles;
  Mark set: logic columns; Logic `logic@1` (fields, exports, semantics), Logic: interpolated writes, Logic: checkpoints
  and bake; Image `image@1`; Item and kind (`at.rot`); Selection.
- `docs/technical-design.md`: The canvas core (canvas modules, `module_missing`, build sets); Mark set, scale and
  encode; Dogfooding; Proven on the base.
- At the base, only for how surfaces are driven: AGENTS.md; `scripts/proof-change.mjs` (`criterionId`); the suites
  `1653/` (atlas tiles, twins, README form), `397/` (the column view, `column.out_of_range`), `544/` and `532/` (logic
  items in documents, programs in WebAssembly text, the assembler), `305/` (`module_missing`, build features), `306/`
  (`batches`), `383/` and `384/` (`input`, `scope`, `state.selection`), `421/` (`spatial`), `1897/` (`determinism`'s
  `pixel_hash`), `1486/` (the taste call); `crates/deep-show` (`main.rs` calls and `planted`, `hub.rs` `deep_show`,
  `frames.rs` `eval` and `frames`, `time.rs` `determinism`, `spatial.rs`, `input.rs`, `logic.rs`, `snapshot.rs`),
  `crates/deep-canvas/src/{columns.rs,scope.rs}`, `crates/deep-canvas-marks/src/{atlas.rs,data.rs}`,
  `crates/deep-logic/src/piece.rs` (the write region's layout).

## What the base already does, and these tests don't credit

The core's column view (#397) narrows a mark-set column `{source: <form>, as}` filled by a test module, at the frame a
revision is presented, raising `column.out_of_range {reader, column, row, value, step}`. Atlas tile sets draw (#1653) on
square, isometric and hex grids, with `place` other than `cell` refused `module_missing` ("#535 draws free rows"). A
document's logic items are baked only for their occurrence lists (#544). `determinism` compares a played frame with a
seeked one by pixel hash (#488, #1897); `frames`, `eval`, `spatial` (scene3d's 3D index, #421), the interaction scope
(#383; it hit-tests items by `params.box` alone) and `batches` (pack-instanced items, #306) exist. Nothing reads a column
`{array: <logic>.<name>, …}` (the data module refuses it, `bad_column`), `alive`, `grid.size` or free rows; logic arrays
reach no reader; no changed ranges are handed over or counted; a 2D image item's `at.rot` isn't drawn ("Rotation, shear
and a numeric pivot wait for the GPU layer").

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 \
  scripts/lease npx vitest run --root tests/acceptance/535 --testTimeout=600000 --no-file-parallelism
npx tsc --noEmit -p tests/acceptance/535
```

Each file builds `deep-show` once, in `beforeAll` (`cargo build --locked --bin deep-show`, the default `full` set;
`ac5-refusals.test.ts` also `--features test-leave-out-logic`), honoring `CARGO_TARGET_DIR`, and copies it to a
temporary folder; and #544's assembler (`tests/acceptance/544/wat`, read only) into `target/acceptance-535-wat/`.
Evidence stores and binaries are temporary and deleted; only `ac7-taste.test.ts` writes outside them, its pictures to
`docs/evidence/535/` (The taste call). Every test passes an explicit 30-minute timeout. Node built-ins, vitest and
`../467/helpers.ts`'s PNG reader and writers (imported read only, as #1653's suite does); no process is started but
`cargo`, the assembler and `deep-show`, each waited for, none stopped by name or port. **`scripts/lanes.mjs` needs
`'tests/acceptance/535/'` in its `alone` list**: the files build cargo binaries and draw on the GPU (`determinism`'s pixel
hash). This README is the instruction; the implementer makes that edit.

Gates: a machine with no GPU for `determinism`'s pixel hash, or an assembler that doesn't build, is `BLOCKED:` (a
failed test, never a pass). Criterion 7 is `INCONCLUSIVE:` until its taste call is recorded. No other reading depends on
load, timing or a device.

## The surface under test

The issue names the fields, the issue `column.out_of_range`, the remap count, the bounds, the spatial index, the
selection, the pixel hash and the planted programs, but no call. As in #397's, #421's, #383's and #544's suites,
everything is driven through `deep-show run` (one JSON scenario per stdin line, one answer `{"ok": true, "replies":
[…]}`, one reply per call). **Every field, call extension and planted name below that the issue or the design doesn't
give is this job's choice, the smallest the criteria need; the implementer builds exactly these, or a dispute goes to a
blind redraft.** Times are flicks (integers; 11,760,000 a 60 Hz step) unless a field takes a time literal (`"60f"`).

### Documents

Each is a #391 film envelope as #544's suite writes one: `{format: 1, id, profile: "film", title, description, size,
seed: 535, camera: "cam", transport: {span: "4s", frame_rate: [60, 1]}, items, assets}`, the camera a 2D orthographic
`camera@1` over the page (`target` its centre, `view_width` its width), and each program and atlas PNG in the evidence
store and listed in `assets` as `{sha256, license}`. The issue's fields, as the tests write them:

| Field | As written | Source |
|---|---|---|
| A logic item | `{id, kind: "logic@1", name, order, params: {program: <sha256>, step_rate: 60, writes: {<name>: {type, count}}}}` | #544's form; Logic `logic@1` |
| A logic column | `params.columns.<name>: {array: "<logic>.<name>", as: <dtype>, part?: "x" \| "y"}` (no `range` is written) | the issue's field |
| The row count | no `n`: the arrays' count | the issue's `n` |
| `alive` | `params.alive: {array: "<logic>.<name>", as: "bool"}` | the issue's field |
| `grid.size` | `params.grid: {shape: "square", cell: [u, u], size: [cols, rows]}`; row i at (i mod cols, ⌊i ÷ cols⌋) | the issue's field |
| Free rows | `params.place: "free"`, columns `x`, `y` (the tile's centre, u) and `angle` (deg), each a logic column `as: "f32"` or `{const: v}`; the quad is `grid.cell` | the issue's fields |
| Beside them | `{const: v}` columns, and (criterion 4's references) a u16 data column `{dtype, len, data}` | Mark set and columns |
| The atlas | `params.atlas: {asset: <sha256>, cell: [px, px], padding: 1}` on `mark: "image"` | #1653's |
| The reference image item | `{kind: "image@1", params: {asset, box: [-w/2, -h/2, w, h], fit: "fill", crop: <the cell in px>, sampling: "linear", alt}, at: {pos: [x, y, 0], rot: [0, 0, deg]}}`: its box centred on its origin, turned about it by `rot`'s z, in the sense a row's `angle` turns | Image `image@1`; Item and kind `at` |

### Calls and fields

| Call | What the tests send | What they read | New or existing |
|---|---|---|---|
| `deep_show` | `{session, doc, document, include: ["issues"] \| ["issues", "pixels"], size?: [w, h], at?}` | `outcome`, `issues`, `snapshots[0].sha256` | existing (#393) |
| `deep_show`'s **`batches`** | (with `pixels`) | each instanced 2D draw `{batch, items, instances}`: an atlas set's rows drawn in one instanced draw are one entry whose `items` hold the set's ID and **`instances`** the rows it drew | extends #306's field: atlas draws, `instances` |
| `eval` | `{doc, t, pixels: true}` on the live session | `outcome: "evaluated"`, `snapshots[0].sha256`, **`issues`** | existing (#387); `issues` extended |
| `eval`'s `issues` | | each `column.out_of_range` the frame raised (at a row's first step out of range), in the document check's issue form with its fields at the top level, as the base flattens them: `{code: "column.out_of_range", severity, ids, path, set, column, row, value, step}`; `set` may be written `reader` (the core view's name); a NaN `value` is `null` or a string naming NaN, since JSON holds none | extends `eval` |
| `frames` | `{doc, count, step: "1f", from?: "<k>f", pixels}` | `frames[].t`, `frames[].pixel_hash` (a PNG in the evidence store), **`frames[].remaps`** | existing (#387, #856); `remaps` new |
| **`remaps`** | | `[{set, step, rows}]`: for each mark set whose columns read a logic array, one entry per logic step this frame applied to it, `rows` the rows the data module remapped for that step's changed ranges (0 when it changed none of them); a full remap (a new reader, a seek) is one entry whose `rows` is the set's row count | new |
| `determinism` | `{doc, display_hz: 60, at_times, compare: "same_machine"}` | `frames[]: {t, play: {pixels, pixel_hash}, seek: {pixels, pixel_hash}}` | existing (#488, #1897); on a logic document the play side remaps only the rows each step changed, and the seek side, a seek, remaps every row |
| `spatial` | `{doc, t: 0, queries: [{box: {min: [x, y, -1], max: [x, y, 1]}}]}` | on a 2D document: **`items.<set>.bounds`** `{min: [x, y, 0], max: [x, y, 0]}`, the set's bounds in page u; **`results[0]`**, the IDs the 2D spatial index holds that meet the box, a set's rows as `<set>#<key>` | existing (#421, scene3d's 3D index); extended to the 2D index |
| `scope`, `input` | the scenario's `clock` and `display` (#383's), `{call: "scope", at, panel}`, a press and a release 60 ms apart `{call: "input", at, panel, event: {type: "down" \| "up", pos}}` in panel px | `state.camera`, `state.rect`; `state.selection` | existing (#383, #384); a click on a drawn row selects `<set>#<key>` |
| scenario `planted` | one of the five names below | | existing form, new names |
| `deep-show` build | `--features test-leave-out-logic` | | existing (#403) |

A row's key is its index (no key column is written), so row 20 of `pool` is `pool#20`.

### Planted twins

Each is one criterion's wrong program, reachable only through the scenario's `planted`, and changes nothing else; any
other `planted` value stays `bad_input`. `twins.json` maps each criterion's ID to its twin.

| Name | Criterion | The wrong program |
|---|---|---|
| `hand_over_drops_last_range` | 1 | the logic module's hand-over to the column view drops the last of each step's changed ranges (by index), so readers never remap its rows on that step; seeks are unchanged |
| `narrowing_wraps` | 2 | the column view narrows an integer by wrapping it into `as`'s range (70,000 as u16 is 4,464) instead of hiding its row |
| `dead_rows_hidden_from_drawing_only` | 3 | a row whose `alive` is false isn't drawn, but stays in the set's bounds and the spatial index, so it is hit and selected |
| `keeps_rows_across_seek` | 4 | after a seek the data module keeps the rows it had mapped and remaps only the changed ranges of the steps the seek ran, instead of every row |
| `turns_about_corner` | 6 | a free row turned by its `angle` turns about its quad's top-left corner instead of its centre |

## Programs

`programs.ts` holds the logic programs as WebAssembly text, assembled by #544's assembler. Each exports `memory` (one
page, or two for the 3,000-row and the 9,216 + 9,215 arrays), `init`, `step`, `reads_at` (0: no reads) and `writes_at`
(4096); its write region is laid out as the base's logic module lays it: arrays in declaration order, a bool or an i32
4 bytes, an f64 8, a vec2 16, each array on an 8-byte boundary. Each writes every element it owns at every step.

- `layer96` (`map`): `cells` i32 × 9,216, index 96 cy + cx: (cx + 3 cy) mod 8; (40, 7) set to 6 from step 30; (0, 0) to 3
  and (95, 95) to 7 from step 60. Step 30 changes only (40, 7); step 60 only (0, 0) and (95, 95).
- `narrow` (`nums`): `tile` i32 × 16 = i + 1, with row 12 70,000 at steps 30 to 39 and 5 from step 40; `flip` i32 × 16
  = 0, with row 3 −1 at steps 30 to 39; `fine` f64 × 16 = 16 + 16 i, with row 7 NaN at steps 30 to 39.
- `actors`: `alive` bool × 64, true for rows 0 to 9; `x`, `y` f64 × 64 = (20 + 24 (i mod 8), 20 + 24 ⌊i ÷ 8⌋).
- `keeper`: `tiles` i32 × 48 on 8 × 6: ((cx + cy) mod 4), the door at (5, 3) (index 29) 7 before step 100 and 8 from it.
- `counts` (`grid`): `big` i32 × 9,216, `short` i32 × 9,215, `where` vec2 × 4; writes nothing.
- `flock`: `x`, `y`, `angle` f64 × 3,000: row 0 (10.5, 3.25) at 90; row i ≥ 1 (26 + (i mod 50), 3 + 0.75 ⌊i ÷ 50⌋) at 45
  (i mod 8).

## Fixtures

`fixtures.ts` writes the atlases (opaque PNGs of solid cells) and the documents. Ten well-separated colors are tiles 0
to 9. Criterion 2's atlas is 70 × 64 cells of 2 × 2 px (4,480 tiles, so tile 4,464 is one) whose colors spell their
tile (r = 4 + 8 (t mod 32), g = 4 + 8 (⌊t ÷ 32⌋ mod 32), b = 4 + 8 ⌊t ÷ 1024⌋). Criterion 6's has two 8 × 4 px cells,
cell 1 red on its left half and blue on its right, so a turn shows.

- **The layer** (`layer`, 582 × 582 u): 96 × 96 cells of 6 u, `grid.size [96, 96]`, tile from `map.cells` as u16.
- **The narrowing fixture** (272 × 160 u): `units` (8 × 2 cells of 16 u, tile from `nums.tile` as u16), `flips` (the
  same, tile 2, flip from `nums.flip` as u8), `drift` (16 free rows at (16 + 16 i, 120), x from `nums.fine` as f32, tile
  3). The twin's run has `units` alone.
- **The pool** (`pool`, 208 × 208 u, on a 624 × 624 px panel): 64 free rows of 16 u at `actors.x`, `actors.y`, alive
  from `actors.alive`, tile 0.
- **The door** (`house`, 144 × 112 u): 8 × 6 cells of 16 u, `grid.size [8, 6]`, tile from `keeper.tiles` as u16; its
  references, the same cells as #1653 draws them with no logic and no `grid.size`: `n: 48` and data columns `cx`, `cy`
  (row i at (i mod 8, ⌊i ÷ 8⌋), where `grid.size` lays it) and `tile` (u16, the door's values before or from step 100).
- **The refusals** (160 × 120 u): `mismatch` (`grid.size [96, 96]`, tile from `grid.big` as u16, flip from `grid.short`
  as u8; its control's flip from `grid.big`); `ghost` (`grid.size [96, 96]`, tile from `grid.missing`; its control's from
  `grid.big`); `spots` (free rows, x from the vec2 `grid.where` as f32 without part, y with part y; its control's x with
  part x).
- **The free rows** (`free`, 80 × 50 u, drawn at 640 × 400 px): 3,000 rows of 4 × 2 u, tile 1; and the reference image
  item on the same page.

Where a grid cell is read: the design leaves a square grid's origin open (#1653's README), so a set at (w/2, w/2) is
read at w cx + 3w/4, inside the cell's quad whether the grid centres cells on multiples of w or puts their corners there.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: `#535.` + the first 8 hex digits of the SHA-256 of each criterion's text,
trimmed, white space collapsed. Each test's name starts with `AC<n> #535.<id>`, and each file quotes its criterion in
full. Test count: 2 + 3 + 2 + 3 + 4 + 3 + 1 = 18.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| AC1 `#535.ae486076` | `ac1-layer.test.ts` (2) | The layer is presented; `frames` 0 to 30: the layer's `remaps` for step 30 are one entry of 1 row. `determinism` at steps 30 and 60: on the played and the seeked frame every one of the 9,216 cells shows the tile its value names, and the two sides' `pixel_hash` are equal. `hand_over_drops_last_range`: at step 60 the played frame's (95, 95) shows its old tile 4, and the comparison fails naming `frame 1.000 s` and `row 9215`. Fails: a cell drawn from another index or tile, a remap of more rows, a played frame that differs from the full remap |
| AC2 `#535.098d9861` | `ac2-narrowing.test.ts` (3) | `eval` at steps 29, 30, 35, 39 and 40: `units` row 12 shows the ground at 30 to 39, tile 13 before and 5 after, every other row its tile; the step-30 frame's issues hold `column.out_of_range` naming `units`, `tile`, row 12, 70,000 and step 30. `flips` row 3 (−1 as u8) and `drift` row 7 (NaN as f32) hide at 30 to 39, every other row drawn, each with its `column.out_of_range` at step 30 (value −1; NaN as `null` or a string). `narrowing_wraps`: row 12 at step 30 shows tile 4,464, and the check fails naming `units row 12` and `step 30`. Fails: a wrap, a clamp, a hidden row that stays hidden, a missing or misnamed issue |
| AC3 `#535.341f5d9a` | `ac3-alive.test.ts` (2) | The pool's snapshot shows rows 0 to 9 and the ground at rows 10 to 63; `spatial`: `items.pool.bounds` is [12, 12] to [196, 52] (the alive quads), and a box over the page returns exactly `pool#0` … `pool#9`; a click at row 20's centre leaves `state.selection` empty, and one at row 3's selects `pool#3`. `dead_rows_hidden_from_drawing_only`: the click at row 20 selects `pool#20`, and the check fails naming row 20. Fails: dead rows drawn, bounded, indexed or hit |
| AC4 `#535.b9829532` | `ac4-door.test.ts` (3) | Played: `frames` 0 to 3 s, each frame's pixel hash the reference's at 7 before step 100 and at 8 from it. Seeked: `eval` at 3 s is 8's, then at 1 s 7's, then `frames` from 1 s to 3 s 7's before step 100 and 8's from it. `keeps_rows_across_seek`: the 1 s frame after the seek is 8's, and the check fails naming `cell (5, 3)` and `1.000 s`. Fails: a frame a step early or late, a seek that keeps stale rows |
| AC5 `#535.0f8922c0` | `ac5-refusals.test.ts` (4) | `deep_show` refuses at check, with an error issue naming the set in its `ids` or `path` and, in its own fields: `mismatch` and both `tile` and `flip` (or both `grid.big` and `grid.short`); `ghost` and `tile`; `spots` and `x`. Each control is presented: `mismatch` with both columns reading `grid.big`, `ghost` reading `grid.big`, `spots` with part x. The build without logic (`test-leave-out-logic`, the issue's Proof line): the layer document is refused with an error `module_missing` naming `logic`. Fails: a refusal that names nothing, a check that takes the bad set or refuses every logic column, a reader that needs the logic module |
| AC6 `#535.6cb0e483` | `ac6-free-rows.test.ts` (3) | `deep_show`'s `batches` hold exactly one entry drawing `free`, with `instances` 3,000. The reference image item draws over [76, 10] to [92, 42] px (2 × 4 u about (10.5, 3.25), within a pixel), and the region [0, 0, 160, 96] px of the free rows' snapshot hashes as the reference's. `turns_about_corner`: the regions differ, and the check fails naming `row 0 (free#0)`. Fails: rows drawn one by one or in several draws, a row unturned, turned the other way from the image item, or about another point |
| AC7 `#535.d39cd14c` | `ac7-taste.test.ts` (1) | The check run (below) writes the six pictures and prints their SHA-256s, then reads `TASTE.json`: none, or a call on other pictures, fails `INCONCLUSIVE:`; `looks_wrong` fails; `looks_right` on exactly these pictures passes. It judges no picture. Fails: the base (nothing drawn), any run without a recorded call |

## The taste call

`ac7-taste.test.ts` is the check run. It draws the criteria's own fixtures through `deep-show run` and takes each picture
from the canvas's own canonical render (a PNG the canvas stored in the evidence store), re-encoded so the same pixels
always give the same bytes, and writes to `docs/evidence/535/`:

- `layer-before-step.png` and `layer-after-step.png`: the 96 × 96 layer at steps 29 and 30 (`eval`);
- `unit-pool.png`: the 64-row pool (`eval` at 0);
- `door-before.png` and `door-after.png`: the door at steps 99 and 100, and `door-changing.apng`, the recording of steps
  90 to 110 at 60 frames a second (`frames` with pixels).

Each file's SHA-256 is printed. `tests/acceptance/535/TASTE.json`, written by whoever records the call after the
pictures are attached to the PR and shown in the session: `{"issue": 535, "criterion": "#535.d39cd14c", "verdict":
"looks_right" | "looks_wrong", "who", "when": ISO 8601, "screenshots": {<each of the six names>: sha256}, "note"?}`.
The canvas's renders are deterministic, so a call stands while this run's six hashes equal the ones it names; a changed
picture makes the run INCONCLUSIVE again until a new call. No agent records a call it wasn't given.

## Readings where the issue leaves a choice

- **The surface.** `deep-show run`, the one binary at the base that holds the logic module's runner, the column view,
  the data module, the renderer, the spatial index and the interaction scope (#397, #421, #383, #544 drive it).
- **"The data module's remap count for that step"** is `frames`' `remaps` entry for the set and that step; a 60 fps play
  applies one 60 Hz step a frame. Only step 30's count is asserted, as the criterion says.
- **"The same frame remapped in full"** is `determinism`'s seek side: a fresh session one second later, then back to the
  frame, and "a seek … remaps every row". **"The frame's pixel hash"** is `pixel_hash`, the GPU hash #1897 gives each side.
  Step 60's frame is compared too: the twin's frame is that one.
- **"Fails the full-remap comparison, naming the frame and row 9,215"**: this suite's comparison names the frame by its
  time and the rows whose sample pixels differ between the two sides, `row 9215 (cell (95, 95))`.
- **"Draws at each cell the tile the value names"**: every cell's sample pixel shows that tile's color within 3 codes.
- **"Hides row 12 for steps 30 to 39"** is read at steps 29, 30, 35, 39 and 40; hidden is the ground's color at the row.
  **"−1 read as u8 and an f64 NaN read as f32 … the same way"**: an atlas set's u8 column is `flip`, and an f32 column a
  free row's `x`; "the same way" is hidden for steps 30 to 39 with a `column.out_of_range` at step 30. The issue's
  fields name the set `set` (Mark set: logic columns); the core view names it `reader`; either is read.
- **"Draws tile 4,464"**: the code atlas holds it, so the wrapped value draws a cell; read by its color.
- **The pool's rows sit at free positions** from logic arrays, so their quads, the bounds and the click are exact. "The
  set's bounds" is the union of the alive rows' quads; "the spatial index holds only those 10" is a box over the whole
  page returning only their IDs (the set's own ID, if listed, is not a row). The click at alive row 3 shows clicks reach
  rows, so "selects nothing" isn't met by a scope that never hits a row.
- **"Shows 8", "shows 7" by pixel hash** are the hashes of the same layer drawn with a data column of the door's values
  and no logic: a frame shows 8 when its canonical render's hash is that one's. "Played from 0" is every 60 fps frame
  from 0 to 3 s; "seeked to 3 s and back to 1 s" is `eval` at 3 s then at 1 s on one live session, then every frame from
  1 s to 3 s. **"Naming cell (5, 3) and the frame"**: the suite reads a frame whose hash is wrong at each cell's sample
  pixel against the reference expected, naming the cells that differ and the frame's time.
- **"Naming both"** is both columns (`tile`, `flip`) or both arrays (`grid.big`, `grid.short`), in one error issue's own
  fields, not its prose. **"Naming the column"**: its name in the issue's path or fields.
- **The build without logic** is in the issue's Scope ("a build without logic seals, and a document that reads a logic
  array is refused with module_missing, naming logic") and its Proof line, but no criterion states it alone; its test
  rides with criterion 5's refusals at check and is tagged so. The document holds its logic item and the reader.
- **"One instanced draw for their atlas"** is one `batches` entry drawing the set, with `instances` 3,000.
- **"Equal by hash to an image item showing the same atlas cell at that pose"**: the SHA-256 of the same region's pixels
  in the two snapshots, the region holding row 0 alone. The image item's pose is `at: {pos: [10.5, 3.25, 0], rot: [0, 0,
  90]}` over a box centred on its origin, cropped to the cell; its drawn extent, 2 u wide and 4 u tall about the point,
  shows it turned, so a row and an image item that both ignored the turn don't pass.
- **"Naming the row"** for the corner twin: `row 0 (free#0)`.

## Not tested, because no criterion reaches it here

`seen` and `match.me`, preview arrays, restores and opened saves (in the Scope and Fields, in no criterion); `range`; interpolated
writes; the 64-range cap and the merge into a span; the cells, scene3d, text and marks2d readers (instancers, the cell
grid, keyed copy, flips, terrain overlays); hex grids with `grid.size`; `scale` on free rows; focus and announcing; the
terrain recipe's fixed choice. They are follow-ups for the implementer's own tests.

`BASE-FAILURE.txt` is the run at the base.
