# Acceptance tests for #536: live game state: hex grids with six-edge terrain rules

Written first, from issue #536 (its Scope, Fields, three acceptance criteria and Proof line; it has no comments), the
design sections it links and those they lean on, and base commit `f28d8777e` ("Merge pull request #2229"), by a job
that never saw an implementation; none existed, and no other worktree, branch or pull request was read. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). Lean: one test per criterion clause that needs its own run, plus exactly the two planted twins the criteria
name. The issue's oracle line says no upstream test checks these criteria.

## What was read

- The issue (`gh issue view 536`).
- `docs/canvas-primitives.md`: Mark set and columns `marks@1`; Mark set: atlas tiles; Mark set: logic columns; Mark
  set: hex grid.
- `docs/technical-design.md`: Mark set, scale and encode; Dogfooding; Proven on the base.
- At the base, only for how surfaces are driven: AGENTS.md; `scripts/proof-change.mjs` (`criterionId`); the suites
  `467/` (helpers, terrain test), `1653/` (README, helpers, isometric test, BASE-FAILURE), `535/` (README, fixtures,
  refusals, `ac7-taste.test.ts`, TASTE.json); `crates/deep-marks-render/src/lib.rs` (`check`, `geometry`, the `planted`
  values each takes) and `raster.rs` (`geometry`'s `rows`); `crates/deep-canvas-marks/src/{terrain,atlas,data}.rs`
  (the expansion, the hex layout, a mark set's `rows` report); `crates/deep-canvas/src/document/mod.rs` (an issue's
  fields).

## What the base already does, and these tests don't credit

#1653 lays hex centres out (pointy or flat, offset odd or even) and `geometry` reports each atlas row's centre; `raster`
draws atlas sets and terrain recipes on hex grids. #467's `tiles.terrain@1` expands at check into a `marks@1` set
`<id>.tiles` (`cx`, `cy`, `tile`), reading six hex neighbours (E, NE, NW, W, SW, SE) whatever `rules` says, each edge
wanting the neighbour's own terrain with no precedence, an off-grid edge the cell's own; it picks by hash(seed, cx, cy),
and where no tile matches it falls back to any tile of the cell's terrain instead of refusing. A recipe whose `cells`
isn't a list is refused `bad_doc` at `items/<id>/params/cells`. `deep-canvas-render check` skips a `logic@1` item with a
notice (`unknown_kind`) and refuses a set whose `tile` column reads a logic array `out_of_range` at
`items/<set>/params/n`.

So three tests pass at the base, as guards of behaviour that must not change (design: Proven on the base): AC1's
honest centres, AC2's added cell at (6, 0), and AC2's refusal of a recipe whose cells name a logic array.
`BASE-FAILURE.txt` is the base run.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 \
  scripts/lease npx vitest run --root tests/acceptance/536 --testTimeout=600000 --no-file-parallelism
npx tsc --noEmit -p tests/acceptance/536    # type-check
```

Each file builds `deep-canvas-render` once in `beforeAll` (`cargo build --locked --bin deep-canvas-render`, honoring
`CARGO_TARGET_DIR`, with rustup's bin on PATH where it exists) and copies it to a temporary folder. It draws with Vello
CPU, so every test runs on every platform with no GPU. The asset stores and the binary copy are temporary and deleted;
only `ac3-taste.test.ts` writes outside them, its two pictures to `docs/evidence/536/` (The taste call). Node built-ins,
vitest, and `../467/helpers.ts` and `../1653/helpers.ts` (imported read only, as #1653's suite imports #467's); no
process is started but `cargo` and `deep-canvas-render`, each waited for, none stopped by name or port.
**`scripts/lanes.mjs` needs `'tests/acceptance/536/'` in its `alone` list** beside `467/` and `1653/`: the files build a
cargo binary. This README is the instruction; the implementer makes that edit.

Gates: no cargo on the machine is `BLOCKED:` (a failed test, never a pass). Criterion 3 is `INCONCLUSIVE:` until its
taste call is recorded. No test reads a timing, a device or an outside input.

## The surface under test

**No new binary, call or field.** Every criterion is entered through `deep-canvas-render`'s existing commands, one JSON
line in and one out, as #467's and #1653's suites drive them. What's new is behaviour of those calls (below) and two
planted names. **Every reading below that the issue or the design doesn't give is this job's choice, the smallest the
criteria need; the implementer builds exactly these, or a dispute goes to a blind redraft.**

### Documents

#373's envelope (`{format: 1, id, profile: "figure", title, description, size, budget: {class: "figure"}, layers:
{main}, items}`), as #467's and #1653's suites write it. The issue's fields, as the tests write them:

| Field | As written |
|---|---|
| hex grid | `grid: {shape: "hex", cell: [32, 28], hex: {orient: "pointy" \| "flat", offset: "odd" \| "even"}}` |
| atlas hex fixture (AC1) | `marks@1` `board` at the origin: `{mark: "image", n: 36, atlas: {asset, cell: [16, 16], padding: 1}, grid, columns: {cx: i32, cy: i32, tile: u16}}`, rows (cx, cy) for cx, cy in 0..5, tile 0, typed columns `{dtype, len, data: base64}` (../1653/helpers.ts `atlasSet`) |
| terrain fixture (AC2) | `tiles.terrain@1` `floor` at `at.pos [24, 20, 0]`: `{atlas: {asset, cell: [64, 56], padding: 1}, grid (pointy odd), tiles: [{tile, terrain, edges: [label × 6]}], cells: [[cx, cy, terrain]], rules: "edges_6", precedence: ["grass", "sand", "water"], seed: 536}` (#467's form) |
| logic item | `logic@1` `board`: `{program: <sha256 of an 8-byte empty WebAssembly module in the store>, step_rate: 60, writes: {tiles: {type: "i32", count: 36}, terrain: {type: "i32", count: 36}}}` (#535's form) |
| tile column reading a logic array | `marks@1` `units`: the terrain fixture's grid with `size: [6, 6]`, atlas as above, `columns: {tile: {array: "board.tiles", as: "u16"}}`, no `n` |
| cells naming a logic array | the terrain fixture with `cells: {array: "board.terrain", as: "u8"}` |

### Calls

| Call | Sent | Read |
|---|---|---|
| `check` | `{doc, look, store, planted?}` | `ok`; the error issues (`severity: "error"`) with their own fields (`code`, `ids`, `path`, `actual` and any other, not `what`, `fix`, `check` or `close`); the choice from `expansions[].derived`, the `marks@1` set with `cx`, `cy` and `tile` columns (../467/helpers.ts `tilesOf`) |
| `geometry` | `{doc, item: "board", t: 0, look, store, planted?}` | `ok`; `rows.<key>.columns.{cx, cy}` and `rows.<key>.place.{x, y}`, the row's cell centre in document u (#1653's reading) |
| `raster` | `{out, doc, look, t: 0, store, view: {zoom: 2}}` | `ok` and the PNG it writes at `out` |

`store` is a folder of files named by their SHA-256 (the atlas, the program), `look` #467's `fixtures/look.json`.

### What `check` must answer

- **`rules: edges_6` with `precedence`**: each cell's tile has the cell's terrain and, edge by edge, the labels the
  design gives (Readings).
- **Square rules on a hex grid**: refused, with an error that names the recipe (its `ids` hold `floor`, or its `path`
  is `items/floor` or under it) and the rule: its `path` is `items/floor/params/rules`, or `corners_and_sides` stands
  as a whole name in its own fields.
- **A cell no tile matches**: refused, with an error that names the recipe, the cell and its six wanted labels in its
  own fields: the cell as the array `[cx, cy]` anywhere in them (or a `path` of `items/floor/params/cells/<i>`, its
  entry), and the labels as one array in edge order. The smallest form, suggested: the error's existing `actual` set to
  `{cell: [cx, cy], labels: [l0, …, l5]}`.
- **Cells naming a logic array**: refused, with an error that names the recipe and `cells` (as the base's `bad_doc`
  path `items/floor/params/cells` does).
- **A tile column that reads a logic array**: `ok: true`. The design fixes such a set's row count at check from the
  logic item's `writes` (Mark set: logic columns); the base wants a written `n`.

### Planted programs

| Where | Name | The wrong program | Criterion |
|---|---|---|---|
| `geometry`, `"planted": "hex_shifts_other_parity"` | `hex_shifts_other_parity` | A hex grid shifts the rows (pointy) or columns (flat) of the other parity than its offset says: on the pointy odd fixture the even rows shift, so (1, 1) is at (32, 21) and (2, 2) at (80, 42); everything else honest | AC1 |
| `check`, `"planted": "terrain_reads_square_sides"` | `terrain_reads_square_sides` | The terrain expansion reads a square grid's four sides as a hex cell's neighbours, each edge the side it faces: edges 0 and 3 the cells right and left, (cx ± 1, cy); edges 1 and 2 the cell above, (cx, cy − 1); edges 4 and 5 the cell below, (cx, cy + 1). Precedence, off-grid edges, matching and the pick are unchanged. On the fixture (1, 0) wants [water, water, water, water, sand, sand] (honestly [water × 5, sand]) | AC2 |

Each is reachable only there; any other `planted` value on those calls stays `bad_input`, as the base answers an unknown
one. `twins.json` maps each criterion's ID to its twin.

## The fixture

The 6 × 6 pointy odd grid, cell [32, 28]. Terrains, row cy = 0 at the top, cx = 0 at the left (W water, S sand, G
grass):

```
cy 0  W W W W W W
cy 1   W S S W W W
cy 2  S G G S W W
cy 3   S G G S W S
cy 4  W S S W S G
cy 5   W W W W S G
```

The recipe declares 32 tiles over a 512 × 224 px atlas, 8 cells of 64 × 56 px a row (helpers.ts `TILES`, `atlasPng`):
one for each label set a cell wants (21), one for each the planted reading wants besides (7, so the twin's expansion is
answered rather than refused), and the two plain sets the fixture uses (all water, all grass) in three variants each,
so 11 cells pick among equal candidates by the seeded hash. Grass tiles are 0 to 2, sand 3 to 10, water 11 to 31. Each
tile's art is a pointy hexagon filling its cell, in its terrain's color with a seeded texture, with a band of each
edge's label where it differs from the tile's terrain, so a picture shows which tile sits where. No test reads a pixel
of it but criterion 3's pictures, which no test judges.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: `#536.` + the first 8 hex digits of the SHA-256 of each criterion's text,
trimmed, white space collapsed. Each test's name starts with `AC<n> #536.<id>`, and each file quotes its criterion in
full. Test count: 2 + 7 + 1 = 10.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| AC1 `#536.a6553751` | `ac1-centres.test.ts` (2) | `geometry` of the atlas hex fixture, pointy odd, pointy even and flat odd: all 36 rows answered; (1, 1) and (2, 2) at (48, 21) and (64, 42), (32, 21) and (80, 42), (24, 42) and (48, 56), within 1e-9 u on each axis (the design's formula is checked to give the same numbers). Twin `hex_shifts_other_parity` on pointy odd: (1, 1) at (32, 21), and the comparison's first failure names `cell (1, 1)`. Passes at the base (a guard); the twin fails there (`bad_input`). |
| AC2 `#536.b30a306f` | `ac2-terrain.test.ts` (7) | (1) `check` of the terrain fixture: every cell has one tile, of its terrain, whose labels equal the design's (Readings). (2) Twin `terrain_reads_square_sides`: (1, 0)'s tile has the planted reading's labels, and the first failure, in written order, names `cell (1, 0)`. (3) `rules: "corners_and_sides"` on the fixture: refused, an error naming `floor` and the rule. (4) The tiles list without (1, 1)'s tile (tile 3, [sand, sand, sand, sand, grass, grass], wanted by no other cell): refused, an error naming `floor`, `[1, 1]` and those six labels. (5) The fixture with `[6, 0, "water"]` written first: every one of the 36 cells keeps its tile. (6) A document with the logic item and `units`, whose tile column reads `board.tiles`: `ok: true`. (7) The fixture with the logic item and `cells` naming `board.terrain`: refused, an error naming `floor` and `cells`. (5) and (7) pass at the base (guards). |
| AC3 `#536.9a17b91a` | `ac3-taste.test.ts` (1) | The check run (below) writes the two pictures and prints their SHA-256s, then reads `TASTE.json`: none, or a call on other pictures, fails `INCONCLUSIVE:`; `looks_wrong` fails; `looks_right` on exactly these pictures passes. It judges no picture. |

## The taste call

`ac3-taste.test.ts` is the check run. It draws through `deep-canvas-render raster` at zoom 2 (one atlas texel a device
pixel) and takes each picture exactly as raster wrote it, to `docs/evidence/536/`:

- `hex-terrain.png`: criterion 2's 6 × 6 pointy odd terrain fixture, drawn from the recipe's own expansion;
- `terrain-tiles.png`: the recipe's 32 water, sand and grass tiles on one sheet, an atlas set on a square grid of the
  fixture's cell, grass on the first row, sand on the second, water on the three after, each group in list order.

Each file's SHA-256 is printed. `tests/acceptance/536/TASTE.json`, written by whoever records the call after the
pictures are attached to the PR and shown in the session: `{"issue": 536, "criterion": "#536.9a17b91a", "verdict":
"looks_right" | "looks_wrong", "who", "when": ISO 8601, "screenshots": {"hex-terrain.png": sha256,
"terrain-tiles.png": sha256}, "note"?}`. Raster's output is deterministic, so a call stands while this run's two
hashes equal the ones it names; a changed picture makes the run INCONCLUSIVE again until a new call. No agent records
a call it wasn't given. This suite ships no TASTE.json.

## Readings where the issue leaves a choice

- **"A 6 × 6 atlas hex fixture"** is an atlas tile set (`marks@1`, `mark: image`, `atlas`) with a row on each of the
  36 cells; **"the centres"** are `geometry`'s per-row `place`, the cell's centre plus the set's position, here 0
  (#1653's reading). **"The first cell whose centre differs"** is among the criterion's cells in its order.
- **"Shifts the other parity of rows"**: rows, so the twin runs on the pointy odd fixture, where the honest layout
  shifts the odd rows.
- **"That pointy odd fixture with terrains"** is the same 6 × 6 grid as a terrain recipe's cells (The fixture).
- **The labels the design wants** are computed by the test, never read from the binary: a cell's neighbours are the
  cells at distance 1 in cube coordinates, converted from offset coordinates by the layout itself (the axial
  coordinates read back from the design's centre formula, so no offset table is assumed); edge i is the i-th of them
  counterclockwise on screen (y grows down) from the one facing +x; edge i takes the neighbour's terrain where it comes
  before the cell's own in the precedence and the cell's own otherwise, an edge with no cell on the grid taking the
  cell's own. **"A tile whose six edge labels are"** these is a declared tile of the cell's terrain whose `edges` equal
  them in order.
- **"An atlas holding every tile the fixture needs"** holds them and the planted reading's too (The fixture); the
  honest expansion must pick an exact match, so the extra tiles change nothing for it. **"One needed tile removed from
  the atlas"** is one entry dropped from the recipe's `tiles` list, the PNG unchanged, so no other tile's index moves.
- **"The first cell whose labels differ"** is in the order the recipe writes its cells, row by row.
- **"Naming the rule"**: `corners_and_sides` in the error's own fields, or its path at the field that holds it.
  **"Naming a cell and the six labels it wanted"**: in the error's own fields, not its prose (The surface under test).
  Codes are the implementer's and aren't asserted.
- **"Adding a cell at (6, 0) of its neighbours' terrain"**: its neighbours on the grid are (5, 0) and (5, 1), both
  water, so it is water. It is written first, so a choice drawn in written order or by a cell's index would move the
  others; the plain tiles' variants make the pick matter.
- **"The document check"** is `deep-canvas-render check`, the one that expands and refuses terrain recipes, for both
  halves. **"A tile column that reads a logic array"** is `tile: {array: "board.tiles", as: "u16"}` on the fixture's grid
  with `grid.size [6, 6]`, beside a logic item that writes it; **"passes"** is `ok: true` (a notice on the logic item is
  not a refusal). **"A terrain recipe whose cells name a logic array"** is `cells` written in the column source form
  `{array: "board.terrain", as: "u8"}`; **"naming the field"** is `cells` in the error's own fields.
- **Criterion 3's "screenshots … taken by the check run from the renderer's own output"** are raster's PNGs as written,
  of criterion 2's fixture and of a sheet of the recipe's tiles, at zoom 2.

## Not asserted, because no criterion says so

The implementer owes these a mapping or a note (AGENTS.md: review requirement → change → proof): a hex cell's hit area
and picks with ties to the smaller (cy, cx) (in the Scope, in no criterion); draw order on a hex grid (#1653 tests it);
flat hexes' neighbour order and offset even under the terrain rules; `corners` and `sides` alone on a hex grid; hex
grids with `grid.size` under the terrain recipe; the hash's spread over equal candidates; collision or navigation data.
