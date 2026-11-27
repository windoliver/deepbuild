# Acceptance tests for #2039: nine-part frames on free atlas rows

Written first, from issue #2039 (its opening paragraph, its Scope, four acceptance criteria, its `Runs on:`, Proof and
Oracle lines; it has no comments), the design sections it links and those they lean on, and base commit `dbbddd5dd`,
by a job that never saw an implementation; no other worktree, branch or pull request was read. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean:
one test per criterion, one more only where a clause needs its own run, plus exactly the three planted programs the
criteria name. The issue's Oracle lane is `tests/acceptance/2039-oracle/`.

## What was read

- The issue as saved for this job (`#2039`, body and title; no comments), and its Oracle map with the one upstream
  file it pins (read for the Oracle lane only).
- `docs/canvas-primitives.md`: Units and axes; The path grammar; Document envelope; Spatial index; Image `image@1`;
  Mark set and columns `marks@1`; Mark set: atlas tiles; Mark set: logic columns.
- `docs/technical-design.md`: 2D marks and paint; Mark set, scale and encode; Numbers version 0 has to hold (Every task
  carries its own budgets; The reference Macs); Criteria to tests; Closed issues stay proven; Criteria in a checked
  shape; Wrong programs; Dogfooding; Built to be hard to get wrong (Tests written first; Independent first oracles;
  Repo guards); Proven on the base. `docs/parallel-proof.md`: Binaries for tests; the throttle; A suite's own lane
  file; Budget windows. AGENTS.md, CONTRIBUTING.md.
- At the base, only for how surfaces are driven: `scripts/proof-change.mjs` (`criterionId`), `scripts/proof-runs.mjs`
  (`twinsOf`, the before lane), `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`, `validateBudgets`),
  `scripts/lanes.mjs` and `scripts/lanes-lists.mjs` (`timed`, `alone`, the lane file), `scripts/wait-ratchet.mjs`,
  `benchmarks/budgets.json`, `benchmarks/canvas.mjs` and `benchmarks/atlas-draw.mjs` (a task's entry and its mode);
  the suites `2386/` and `2386-redraft-ac6-hashes/` (the form of this one), `535/` (free rows; `deep-show run`),
  `1653/` (atlas sets through `deep-canvas-render`), `536/` (a check issue's own fields), `467/` (helpers) and
  `1500-oracle/`; `crates/deep-canvas-marks/src/{atlas,check}.rs` (a row's quad, how a refusal becomes an issue),
  `crates/deep-canvas/src/document/mod.rs` (an issue's fields), `crates/deep-marks-render/src/{lib,raster}.rs`
  (`check`, `raster`), `crates/deep-marks-raster/src/lib.rs` (`batches`, how an atlas row is drawn) and
  `crates/deep-show/src/{main,hub}.rs` (the scenario, `deep_show`'s reply).

Code was read only to learn the surfaces. Every expected value comes from the issue and the design.

## What the base already does, and these tests don't credit

#1653 draws an atlas tile set; #535 draws free rows, each its cell as one quad centred on (x, y), and gives `batches`
an atlas run's `instances`; #2386 gives that quad the size `atlas.draw` and refuses `draw` beside `slice`. That refusal
is the one place the base reads `slice`. By a search of `crates/`, nothing reads `fill`, `center` or the columns `w`
and `h` on an atlas set, and `marks@1`'s params are not held to a closed list. So at the base, as the suite's run
there and this job's probes of the base's two binaries found (`BASE-FAILURE.txt`):

- a free row of a set with `slice` draws as if `slice`, `fill`, `center`, `w` and `h` weren't written: the whole
  24 × 24 px cell as one 24 × 24 u quad centred at (x, y), in the middle of the box the row should fill;
- `check` takes a row of any width, and takes `slice` on `place: cell`;
- 500 such rows are one `batches` entry with `instances` 500 already, as 500 plain quads. The test of "one instanced
  draw" therefore reads, in the same snapshot, that the rows counted are nine-part rows;
- a quad drawn at its atlas cell's size shows its texels exactly (the base's 24 × 24 u quad of the frame's cell: 0 of
  576 pixels differ; #2386's README records the same of its cell), so "exactly" asks nothing new of the sampler where
  a part is drawn at its own size.

The three planted programs are built only from what the base draws (a plain free row; `atlas.draw`), so each runs at
the base as it will beside the work.

No test passes at the base: in the suite's run there, 11 of 11 fail, nine at an assertion because the behaviour is
missing, the budget's record at its missing task, and the budget's timing as `INCONCLUSIVE:` on a machine whose load
was above its cores. `BASE-FAILURE.txt` is that run, test by test, and below it what this job's probes of the base
found behind each test's first failing assertion.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/2039 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc --noEmit -p tests/acceptance/2039    # type-check
```

On a shared machine the first command goes through its throttle: `node scripts/throttle.mjs test --wait 60 -- node
node_modules/vitest/vitest.mjs run …`. Vitest may leave a cache: look for `tests/acceptance/2039/node_modules/` and
for `node_modules/.vitest-cache/` at the checkout's root (where `vitest list` left one for this job), and remove it.

Each file builds its binary once in `beforeAll` (`cargo build --locked --bin deep-canvas-render` or `--bin deep-show`,
debug, the default features, honoring `CARGO_TARGET_DIR`, with rustup's bin on PATH where it exists) and copies it to a
temporary folder:

| File | Builds | Processes it starts |
|---|---|---|
| `ac1-corners.test.ts` | `deep-show` | two `deep-show run` |
| `ac2-tiles.test.ts` | `deep-show` | two `deep-show run` |
| `ac3-center.test.ts` | `deep-show` | one `deep-show run` |
| `ac3-narrow.test.ts` | `deep-canvas-render` | two `check`, one `raster` |
| `ac4-one-draw.test.ts` | `deep-show` | one `deep-show run` (a 1304 × 884 px snapshot) |
| `ac4-place-cell.test.ts` | `deep-canvas-render` | one `check` |
| `ac4-budget.test.ts` (timed) | nothing; a release `deep-show` (`cargo build --locked --release --bin deep-show`) only on a machine that can judge a timing | `node` on `scripts/benchmark.mjs`, two read-only `git` calls; then seven `deep-show run` |

Both binaries draw on the CPU, so every test but the budget's timing runs on any machine with no GPU. With the
binaries built, a file takes seconds: its own build compiles nothing and each process draws one small page (the
run at the base took 20.58 s for the seven files, the longest 6.8 s). Asset stores, evidence stores and binary copies are
temporary and deleted; nothing is written outside them. Every test passes an explicit 30-minute timeout. No test
waits for time. Imports: Node built-ins, vitest, and `../467/`, `../1653/` and `../535/helpers.ts`, read only, as
#2386's and #536's suites import them. No process is started but those in the table, each waited for, none stopped
by name or port.

`fixtures.ts`, `planted.ts` and `judges.ts` import no test runner, so `node` runs them as they are. This job ran each
judge that way against pictures drawn from the atlas's own texels, the right way (stretch, tile and tile_fit, by
nearest and by linear sampling, clamped to the part or to the cell) and each wrong way (the planted three; the merge
base's quad; nothing drawn; a frame shifted by a px and by half a px; corners scaled; a neighbouring cell drawn; an
edge sampled a texel past the cell; one pixel with blue 1; 21 and 23 repeats; a repeat 2 u too wide; a centre drawn;
refusals naming the set alone, another row, no size, 160 and 16.5): every good input passed and every wrong one
failed, naming what its criterion names. The probe is not part of the suite.

`lane.json` says the folder runs alone: its files build cargo binaries. `ac4-budget.test.ts` is a timed file (What the
implementer adds outside this folder).

## The surface under test

**No new binary, call or reply field, and no `planted` value.** The issue names three fields, two columns, three
planted programs and a budget. Everything is read where the base already shows it, through `deep-show run` (one JSON
scenario on stdin, one answer `{"ok": true, "replies": […]}`, as #535's and #2386's suites drive it) and
`deep-canvas-render` (one JSON line in, one out, as #1653's and #2386's drive it). **Every name below marked "this
suite's" is this job's choice, the least the criteria need; the implementer builds exactly these, or a dispute goes
to a blind redraft.**

### The fields

| Field | As the tests write it | Whose |
|---|---|---|
| `slice` | `params.slice: {left, top, right, bottom}` in px on a `marks@1` set with `mark: "image"` and `atlas`, e.g. `"slice": {"left": 8, "top": 8, "right": 8, "bottom": 8}` | the issue's |
| `w`, `h` | typed columns beside `x` and `y`: `"w": {"dtype": "f32", "len": 1, "data": "<base64>"}`, the box the row fills in u, centred at (x, y) | the issue's |
| `fill` | `params.fill: "tile"` or `"tile_fit"`; left out for `stretch`, the default | the issue's |
| `center` | `params.center: false`; left out for `true`, the default | the issue's |
| a free row | `place: "free"`, columns `x`, `y` (`f32`) and `tile` (`u16`); no `angle` and no `scale` column, so angle 0 and scale 1; no key column, so a row's key is its index and row 0 of `frame` is `frame#0` | the base's (#535) |
| the atlas | `params.atlas: {asset: "<sha256>", cell: [24, 24], padding: 1}`; `params.grid: {shape: "square", cell: [24, 24]}` on every set (Readings) | the base's (#1653) |
| a grid row | `place: "cell"`, columns `cx`, `cy` (`i32`), `tile` (`u16`) | the base's (#1653) |
| the item under a row | `image@1`: `{asset, box: [0, 0, 232, 128], fit: "fill", sampling: "linear", alt}`, ordered before the set | the base's (#535's form) |
| the set's place | `at: {pos: [x, y, 0]}` on the set (the 500 rows only) | the base's |

Documents are #391's film envelope with a 2D orthographic camera over the page for `deep-show` (#2386's form) and
#373's figure envelope with one writer layer for `deep-canvas-render` (#1653's form), each picture a PNG the suite
writes, in the scenario's evidence store and the document's `assets`, or in the line's `store` folder by its SHA-256.

### Calls

| Call | Sent | Read | New or existing |
|---|---|---|---|
| `deep_show` | `{session, doc, document, include: ["issues", "pixels"]}` | `outcome` (`presented`); `snapshots[0].sha256` (a PNG in the evidence store, at the document's size); `batches: [{batch, items, instances}]` | existing (#393, #535) |
| `frames` | `{doc, count, step: "1f", pixels}` | `frames[].frame_ms`, `frames[].ran`; with pixels `frames[].pixel_hash` (the budget's timing only) | existing (#387, #856) |
| `deep-canvas-render check` | `{doc, look, store}` | `ok`; the error issues (`severity: "error"`): `ids`, `path`, `what`, and their other own fields (`actual` and any more; not `fix`, `check` or `close`) | existing (#373) |
| `deep-canvas-render raster` | `{out, doc, look, t: 0, store, view: {zoom: 1}}` | `ok` and the PNG at `out` (a planted program's picture only) | existing (#373, #1653) |

### What the calls must answer

- **A snapshot draws the frame.** In `deep_show`'s snapshot of a page at its own size, a free row of a set with
  `slice` fills the box `w` × `h` centred at (x, y): each corner of the box holds that corner of the cell, texel for
  pixel; with nothing else written the edges and the centre fill the rest; with `fill: "tile"` the top edge is its
  8-texel strip repeated at its own size from the left corner; with `fill: "tile_fit"` it is a whole number of repeats
  of one width; with `center: false` the middle is left as whatever is under the row.
- **`check` refuses a row narrower than `left + right`**: `ok: false` with an error issue that **names the row**, and
  one that does **holds the smallest width**. It names the row when the row's name `<set>#<key>` (`narrow#1`) stands
  whole in the issue's own fields, such as its `ids` or its `path`; or when the issue names the set (below) and its own
  fields hold `row`, at the top or under `actual`, equal to the row's key or index (1), as the column view's issue
  names a row. It holds the smallest width when 16 stands as a whole number in its message, `what`, or in its own
  fields. A row of exactly `left + right` passes.
- **`check` refuses `slice` on a set with `place: "cell"`**: `ok: false` with an error issue that **names the set**:
  its `ids` hold the set's ID, or its `path` is `items/<set>` or under it. Codes are the implementer's.
- **`batches`** holds exactly one entry whose `items` hold the set, and its `instances` is a whole number no smaller
  than the set's rows.
- **`benchmarks/budgets.json`** holds the task `canvas-atlas-slice` (this suite's name; The budget).

One example of each refusal that the tests take:

```json
{"severity": "error", "code": "out_of_range", "ids": ["narrow#1"], "path": "items/narrow/params/columns/w",
 "what": "the row is 12 u wide, narrower than left 8 + right 8: its smallest width is 16 u"}
{"severity": "error", "code": "bad_doc", "ids": ["tiles"], "path": "items/tiles/params/slice",
 "what": "slice needs free rows: the set has place: cell"}
```

### Planted programs

All three are **test code** (`planted.ts`), written whole by this job from what the base already draws. None is a
`planted` value, a build feature or a file laid over the program, so the implementer adds nothing for them, no shipped
binary knows them, and each runs at the merge base as it runs beside the work. Each planted test hands the planted
program's picture, or its check's answer, to the same judge (`judges.ts`) that the shipped program's row passes; the
judge must fail it, naming what the criterion names; and the test then asks that the shipped program passes that
judge, which is where it fails at the base. `twins.json` maps each criterion's ID to its program's name.

| Name | How it is reached | The wrong program | What fails it, naming | Criterion |
|---|---|---|---|---|
| `whole_cell_scaled_to_box` | `planted.ts` `wholeCellScaledToBox`: the first row's set with no `slice`, `w` and `h` and with `atlas.draw: [200, 96]`, shown by the shipped `deep_show` | The row drawn as one quad of the whole 24 px cell scaled to its box, which is how an atlas row draws without `slice`. The test first reads that it is that draw: on a 5 × 5 lattice the box's pixel (px, py) shows the cell at ((px + ½) × 24 ÷ 200, (py + ½) × 24 ÷ 96) | `cornerProblems`: the row `frame#0` and the first differing pixel | AC1 |
| `tile_fit_cuts_last_tile` | `planted.ts` `tileFitCutsLastTile`: the row 190 u wide laid by hand, a plain free set that reads the same atlas as 8 × 8 px cells, each row one part of the frame at its own size; the right corner and edge draw last on their line, over what the last tile holds past the run's end. Shown by the shipped `deep_show` | Every tile at the strip's own size, 8 u, and the last cut at the run's end, as `fill: tile` cuts it: 21 whole tiles and the first 6 u of a 22nd. The test first reads exactly that | `tileFitProblems`: the row `fit#0` and the top edge, its last repeat among the lines | AC2 |
| `check_takes_narrow_row` | `planted.ts` `checkTakesNarrowRow`: the row 12 u wide laid by hand the same way, with no `slice` for the shipped check to refuse; `deep-canvas-render check` takes it and `raster` draws it | A check with no smallest size: it takes the row, and what it takes is drawn with both 8 u corners at their own size in a box 12 u wide, overlapping by 4 u. The test first reads that `check` takes it and that the picture is the left corner's first 4 columns, then the right corner's 8 | `rowRefusalProblems`: the row `narrow#1`, taken where it must be refused; and `cornerProblems` on its picture: the row and pixel (88, 20), the left corner's fifth column | AC3 |

## The fixtures

`fixtures.ts` holds every texel and every document. Every texel is opaque.

- **The atlas** is new: 72 × 72 px, nine 24 × 24 px cells, three by three, with no gap between them. **The frame is
  the middle cell** (`tile` 4), so another cell touches each of its sides and corners. Texel (x, y) of the frame
  cell, 0 to 23 each way, is `[10x + 5, 10y + 5, 0, 255]`: its red spells its column and its green its line. So:
  - no two of its 576 texels are equal and each differs from every neighbour, so a corner pixel equals its texel or
    it doesn't, and a corner that is scaled, shifted, flipped or taken from another part can't equal it by accident;
  - a pixel's red and green say which texel it shows, or how far between two, so the top edge's strip, texels
    (8..15, 0..7), climbs in red 85, 95, … 155 along its run and falls back where the next repeat starts: repeats can
    be counted, and a pixel says how far into its repeat it is;
  - the centre, texels (8..15, 8..15), and the other edges differ from the top edge in green, so a centre can't be
    taken for an edge;
  - **the eight cells around it** hold the same red and green at the same place in their own cell, with **blue 255**
    where the frame's is 0. A draw that shows another cell, or lets a sample cross the cell's border, looks like the
    frame by its red and green and is told by its blue: any mix of the frame's texels has blue 0 exactly, by any
    sampling, and a pixel with any blue holds some of a neighbour's texel.
- **The item under the first row**, `under`: an `image@1` over the whole 232 × 128 u page at one px a u, drawn before
  the row's set. Its pixel (x, y) is `[240 + (3x + 5y) mod 16, (37x + 101y) mod 256, 0, 255]`: red above every texel of
  the frame (at most 235), so a pixel of the box that shows it isn't the frame's; blue 0, so it can't be taken for a
  neighbour's texel; no pixel equal to its right or lower neighbour and no short shift that repeats it, so the hash of
  a region of it says whether exactly it shows there.
- **The first row** (criteria 1, 2 and 3): the set `frame`, one free row at (116, 64) with `w` 200 and `h` 96, so its
  box is [16, 16, 200, 96], on whole units, with `slice` 8 on each side. Criterion 1: nothing else written, and on a
  second page the same row with `tile` 5, the cell to the frame's right. Criterion 2: with `fill: "tile"`. Criterion 3:
  with `center: false`, beside the row with nothing else and the item alone.
- **The row 190 u wide** (criterion 2): the set `fit`, one free row at (116, 64) with `w` 190 and `h` 96, box
  [21, 16, 190, 96], with `fill: "tile_fit"`, over `under` on the same page.
- **The narrow row** (criterion 3): the set `narrow` on a 120 × 80 u page, two free rows 40 u tall: row 0 at (40, 40),
  40 u wide, and row 1 at (90, 40), 12 u wide. The row to name is not the set's first, so a refusal that names the set
  alone, or always its first row, fails. The document that passes differs by row 1's width alone: 16 u. No other
  number of the refused document is 16.
- **The grid set** (criterion 4): `tiles`, two rows on cells (1, 1) and (2, 1) of a square grid of 24 u cells with
  `place: "cell"`, on a 96 × 48 u page; refused with the issue's `slice` and columns `w` and `h`.
- **The 500 rows** (criterion 4): the set `rows` at (4, 4) of a 1304 × 884 u page, row i in column i mod 25 and line
  ⌊i ÷ 25⌋ of a lattice 52 u by 44 u, its box 32, 40 or 48 u wide (by i mod 3) and 32 or 40 u tall (by i mod 2), on
  whole units, no two touching. None is 24 × 24 u, the one size at which a quad of the whole cell and a nine-part
  frame draw the same pixels. For the budget a keyed channel slides the set 15 u a second along x, and the other side
  is the same rows with no `slice`, `w` and `h`.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: `#2039.` + the first 8 hex digits of the SHA-256 of each criterion's text,
trimmed, white space collapsed, computed from the issue's body. Each `describe` and each test's name starts with
`AC<n> #2039.<id>`, and each file quotes its criterion in full. Test count: 2 + 2 + 3 + 4 = 11.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| AC1 `#2039.31be1538` | `ac1-corners.test.ts` (2) | (1) The snapshot is 232 × 128 px. Each of the four corners' 8 × 8 pixels of the box [16, 16, 200, 96] equals its source texel on all four channels (`cornerProblems`). The frame fills its box: no pixel of it shows the item under it (`coverProblems`). The same row showing the cell to its right fails the neighbour check, naming the row and a pixel; and no pixel of the first row's snapshot, in the box or out of it, has any blue (`neighbourProblems`). (2) `whole_cell_scaled_to_box`: it is that draw, the corners' check fails, and its first line names `frame#0` and the first differing pixel in reading order; the shipped row passes the same check. Fails: the base (one 24 × 24 u quad in the middle: pixel (16, 16) reads the item under the row), corners scaled with the box, a frame off by a px or half a px, a sample that leaves the cell |
| AC2 `#2039.18a89663` | `ac2-tiles.test.ts` (2) | (1) With `fill: tile` each of the 23 repeats across the 184 u between the corners is the strip's 8 × 8 texels exactly (`tileProblems`). With `fill: tile_fit` and the row 190 u wide: on each of the strip's 8 lines the red falls back 21 times across 174 u, so 22 repeats; and in each repeat every pixel more than a texel from the repeat's ends shows the texel a whole repeat 174 ÷ 22 u wide shows there (`tileFitProblems`; Readings). (2) `tile_fit_cuts_last_tile`: it is that draw, the check fails naming `fit#0` and the top edge, its 22nd repeat among the lines; the shipped row passes the same check. Fails: the base, stretch where a tile is asked, 21 or 23 repeats, a repeat cut or 2 u wider than the rest |
| AC3 `#2039.87a8de22` | `ac3-center.test.ts` (1), `ac3-narrow.test.ts` (2) | (1) The middle [24, 24, 184, 80] of the first row with `center: false` hashes as the same region of the item alone (`throughProblems`); the item's middle holds over 1,000 colors; the row with nothing but its `slice` hashes differently there; and the row with `center: false` is drawn, its corners the source texels. (2) The set with row 1 16 u wide passes `check`; with row 1 12 u wide it is refused, an error names `narrow#1` and holds 16 (`rowRefusalProblems`). (3) `check_takes_narrow_row`: `check` takes it, its picture is the two corners overlapping, the corners' check names `narrow#1` and pixel (88, 20), and the refusal's check fails naming `narrow#1`; the shipped check passes the same check. Fails: the base (the cell drawn in the middle; every row taken), a centre that draws, a refusal that names the set alone, the wrong row or no smallest width |
| AC4 `#2039.2e193c48` | `ac4-one-draw.test.ts` (1), `ac4-place-cell.test.ts` (1), `ac4-budget.test.ts` (2) | (1) The snapshot is 1304 × 884 px, each of the 500 rows' four corners is the source texels, and `batches` holds one entry drawing `rows` with at least 500 `instances` (`oneDrawProblems`). (2) The grid set passes `check`; with `slice`, `w` and `h` it is refused and an error names `tiles` (`setRefusalProblems`). (3) The budget's record, and (4) its timing (The budget). Fails: the base (plain quads: no row's corners; `slice` on `place: cell` taken; no task), rows drawn in nine draws or one by one, a check that refuses only a `slice` with no `w` and `h`, a slower frame |

Clauses the base already meets, each asserted beside something it lacks, and what fails each:

- **Criterion 4's one instanced draw.** The base draws the 500 rows in one instanced draw, as plain quads. The test
  reads every row's corners in the same snapshot, which fails at the base; a set drawn part by part in nine draws, or
  row by row, fails the count.
- **Criterion 1's "no pixel holds a texel from a neighbouring cell".** The base's quad is the frame's own cell, so no
  pixel has any blue there either. The test first asks for the corners and for the frame filling its box, which fail
  at the base, and shows on the second page that the blue is read: a row showing a neighbouring cell fails, on any
  program that draws it.
- **Each planted test's planted half** passes at the base, where the planted programs already run. Each such test
  ends by asking that the shipped program passes the same judge, which fails at the base.

## The budget

`ac4-budget.test.ts` is timed. Its first test reads the record and runs anywhere: `benchmarks/budgets.json` holds

```json
{"id": "canvas-atlas-slice", "command": ["node", "benchmarks/canvas.mjs", "atlas-slice"], "margin": 0.5, "limits": {},
 "targets": {"slice_rows_frame_ms": 0.2}, "initialReason": "Issue #2039 …", "criteria": ["#2039.2e193c48"]}
```

(the task's ID, its command and its target's name are this suite's; the number is the issue's, a target because the
issue calls it "drafted, a target to be measured"), the file passes the lane's `validateBudgets` against the merge
base's, and `scripts/lanes.mjs`'s `timed` holds `tests/acceptance/2039/ac4-budget.test.ts`. The second test is the
timing, described in the file's head: a release `deep-show`, `frames` of the 500 sliding rows with `slice`, `w` and
`h` and of the same rows without the three, 300 frames a side, the difference of the sides' median `frame_ms`, five
runs after a warm-up, judged by `judgeLimit`. `benchmarks/canvas.mjs atlas-slice` is the implementer's, measuring the
same fixture.

**A timing under load decides nothing.** The design counts a timing only on a reference Mac, on mains power, with Low
Power Mode off and the thermal state nominal, and makes a task INCONCLUSIVE when the load is at or above the cores
(Numbers version 0 has to hold; Budget windows). So the timing test reads the machine and its one-minute load before
it builds or times anything: off a reference Mac, or with the load above the core count, it fails `INCONCLUSIVE:`,
naming what it read, never a pass and never a fail, and starts no build. On a machine that can judge it, a run whose
load rises above the cores is INCONCLUSIVE with all five readings attached. The scheduled budget window, not this
test, is what closes the criterion's budget (Budget windows: the reading rule).

## Legs that read BLOCKED or INCONCLUSIVE, and what unblocks each

| Leg | Reads | What unblocks it |
|---|---|---|
| Any test, when `cargo` can't be run | `BLOCKED:` (a failed test), naming the toolchain | Rust's toolchain on the machine |
| `ac4-budget.test.ts`, the timing, off a reference Mac, off mains, in Low Power Mode, not thermally nominal, or with the one-minute load above the cores | `INCONCLUSIVE:`, naming each condition it read | A reference Mac at rest: the lane's timed grant, or the budget window |
| The same, on a fit machine, when the five runs are neither all within 0.2 ms nor all over it by more than the margin | `INCONCLUSIVE:` with the five runs and their loads | A quieter run; the window's record |

No other reading depends on the machine or its load. Nothing is skipped.

## Readings where the issue and design leave a choice

- **Where the fields go.** The design lists `slice`, `fill` and `center` among the set's fields, beside `place` and
  `grid`, and `w` and `h` as columns beside `x` and `y`; #2386's suite writes `slice`, `w` and `h` the same way.
- **`grid` and `padding`.** Every set writes `grid: {shape: "square", cell: [24, 24]}`: the design gives `grid.cell`
  no default, the base reads it for every atlas set, and a row's box here is its `w` and `h`, never the grid's cell.
  `padding: 1` is written as every atlas suite at the base writes it, on an atlas with no gap between its cells.
- **"A snapshot at zoom 1 and scale factor 1"** is `deep_show`'s snapshot at the document's own size, through a camera
  whose view is the page (#2386's reading). **"On whole units"**: the box's four edges lie on whole u. **"At angle 0
  and scale 1"**: no `angle` and no `scale` column, the design's defaults.
- **"Each corner's 8 × 8 pixels equal the source texels exactly"**: the pixel at (i, j) of a corner of the box equals,
  on all four channels and with no tolerance, the texel at (i, j) of that corner of the cell: 256 pixels a row.
- **"No pixel holds a texel from a neighbouring cell"** is every pixel of the snapshot, in the row's box and out of
  it, and "holds" is any share: the fixture's blue makes a 1 in 255 share of a neighbour's texel show. That the frame
  fills its box is asked too, with the Scope's "the centre fills the rest", so the pixels read are the row's.
- **"Naming the row"** is the row's name, `<set>#<key>` (The path grammar), which each judge's line starts with.
  **"The first differing pixel"** is the first in the picture's reading order, line by line, then left to right, among
  the four corners' pixels; the planted test asks it of the first line and names no coordinates, since which pixel
  differs first under a scaled draw is the sampler's.
- **"The top edge"** is the 8 lines at the top of the box between the two corners. **"Repeats its 8-texel strip 23
  times across 184 u"** under `tile` at scale 1 is 23 copies of the strip at its own size, each compared exactly, as a
  corner is.
- **"Repeats 22 times across 174 u, each tile the same width and none cut."** A repeat is 174 ÷ 22 u, not a whole
  number of px, so its pixels mix texels and the issue doesn't say how. The judge holds what both nearest and linear
  sampling give: a pixel whose centre is d u into its repeat shows the strip at texel coordinate 8d ÷ (174 ÷ 22), its
  red within half a texel's step and one code of that (6 codes), its green its line's within one code, its blue 0. It
  reads no pixel within a texel of a repeat's ends, where one repeat meets the next and a sampler may clamp, wrap or
  mix; those pixels count only toward the 21 falls of the red. So "the same width" is held to half a texel in each
  repeat, which a cut tile, a 21st or 23rd repeat and a repeat 2 u off all break, and repeats snapped to whole px (7
  or 8 px) do not. The row 190 u wide is as tall as the first and centred where it is.
- **"A planted draw that cuts the last tile under `tile_fit`"** keeps every tile at the strip's size and cuts the
  last at the run's end, as the design says `tile` does. **"Naming the edge"**: each line says `top edge`.
- **"The middle 184 × 80 u … is not drawn, and an item under it shows through by pixel hash"**: the SHA-256 of the
  middle's pixels with the row over the item equals that of the same region of a snapshot of the item with no row
  over it. "An item" is an `image@1`.
- **"Refused at check"** is `deep-canvas-render check`, the document check #2386's, #1653's and #536's refusals are
  read from. **"Naming the row"** there: in the error's `ids`, its `path` or its other own fields, not its prose, as
  those suites read a name; or the set named and a `row` field, as the column view names a row. **"The smallest width
  16"**: the Scope says "with the smallest size in the message", so 16 is read as a whole number in the issue's
  message, `what`, and, so that a program which also or only states it as a field passes, in its own fields.
  **"A row … is refused"** leaves a row of exactly 16 u taken: the criterion calls 16 the smallest width.
- **"A planted check that takes it draws overlapping corners and fails, naming the row."** The planted check has no
  smallest size; what it takes is drawn, each corner at its own size, and in 12 u two 8 u corners overlap. It is
  reached by laying the frame by hand, which the shipped check has no `slice` to refuse. What fails is the
  criterion's own check of the refusal, naming the row; the picture's corners are read too, through `raster` at zoom
  1 (one px a u, as #2386's suite reads a pixel there), since this clause names no snapshot.
- **"500 such rows"** are free nine-part rows of the fixture's cell with nothing but their `slice`, of several
  sizes. **"One instanced draw for their atlas"** is one `batches` entry drawing the set (#535's and #2386's reading).
  Its `instances` are at least 500: whether an instance is a row or one of its parts is the implementer's.
- **"A set with `slice` on `place: cell` is refused, naming the set"**: at check, as the Scope says. The refused set
  also carries `w` and `h`, so a check that refuses only a `slice` with no `w` and `h` doesn't pass.
- **"The 500 rows add under 0.2 ms a frame", "compared with the merge base".** The merge base draws these rows as one
  quad of the whole cell each. So what the rows add is read in one binary as the frame time of the 500 nine-part rows
  less that of the same rows with no `slice`, `w` and `h`, the way #2386's suite reads what `draw` adds. A frame is
  `frames`' `frame_ms`; a channel slides the set so every frame places the rows again.
- **The planted programs are test code**, not `planted` values. The design has a criterion's wrong programs written
  by the job that writes its tests (Criteria in a checked shape) and lets one live in test code (Wrong programs). Each
  of the three can be built from a plain free row, so each stands on the base and none asks the implementer for a
  name.

## Not asserted, because no criterion says so

The implementer owes these a mapping or a note (AGENTS.md: review requirement → change → proof):

- the Scope's "corners draw at their own size times the row's `scale`" at any scale but 1, and a row at an angle;
- "each edge runs along one axis" and the stretch default's pixels: the edges and the centre under `stretch` are held
  only to filling the box, and the left, right and bottom edges and the centre under `tile` and `tile_fit` are not read;
- "under `tile` the last tile is cut at the run's end" (criterion 2's run is 23 whole tiles) and "at least 1" tile
  under `tile_fit`;
- "sampling stays inside the cell and the padding rule holds" beyond criterion 1's row, and beyond blue 0 on the
  pixels criterion 2 reads;
- the refusals of "`slice` without `w` and `h`" and of "a `slice` whose sides leave no texel between them"; a row
  "shorter than top + bottom" is asserted in the Oracle lane only, on upstream's sides;
- "a set with no `slice` draws as before": no criterion reaches it and no test here holds it by itself. It stays held
  where the base holds it (#2386's pixel hashes of #1653's and #536's fixtures), and the three planted programs here,
  plain free sets whose pictures their tests compare exactly, would fail if such a set drew otherwise;
- "not in this task": a nine-part frame on `image@1`, and rows whose `w` and `h` read logic arrays;
- a nine-part row's bounds, its box in the spatial index and in `deep_show`'s table, and its hit area;
- what `instances` counts; any code or wording of an issue beyond the row, the set and the number 16;
- the budget's p95, memory and instructions retired, which the perf lane and the window judge.

## What the implementer adds outside this folder

- `scripts/lanes-lists.mjs`: `timed.push('tests/acceptance/2039/ac4-budget.test.ts')` (the first budget test asserts
  it through `scripts/lanes.mjs`'s `timed`). `lane.json` already puts this folder in `alone`, its reason `binary`.
  For the Oracle lane, whose folder a lane file can't name: `alone.push('tests/acceptance/2039-oracle/')`, and that
  entry under `binary` in `scripts/lanes.mjs`'s `aloneReasons`.
- `benchmarks/budgets.json`: the task `canvas-atlas-slice` above; `benchmarks/canvas.mjs`: its mode `atlas-slice`.
- Nothing for the planted programs: no `planted` value, build feature or twin folder.

`BASE-FAILURE.txt` is the run at the base, test by test, and below it what this job's probes of the base's binaries
found that the run doesn't show.
