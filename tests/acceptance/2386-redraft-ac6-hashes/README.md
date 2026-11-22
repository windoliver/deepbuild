# Blind redraft: #2386 criterion 6, the pixel-hash clause

One clause of issue #2386's sixth criterion, `#2386.b3f6fe16`: "Each fixture of #1653 and #536 keeps its pixel hash",
with the Scope line it holds: "No pixel of any set without the two fields changes". Written from the issue, the design
and base commit `b6b99ad8` by a fresh run of the blind job, which saw no implementation, no other worktree, branch or
pull request, and not the issue's suite or its earlier test of this clause (AGENTS.md, Proof; design: Dogfooding). The
implementing agent doesn't edit this folder. The suite's tests of the criterion's other two clauses (the 10,000 rows in
one instanced draw, the budget) are not this folder's.

The full criterion: "10,000 rows with `draw` from one atlas draw in one instanced draw for their atlas. Each fixture of
#1653 and #536 keeps its pixel hash. Budgets, on the reference Mac in the local preflight, compared with the merge
base: the 10,000 rows add under 0.1 ms a frame over the same set without `draw` (drafted, a target to be measured)".
Its ID is `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of that text, checked against the
issue's body.

## What was read

- The issue: its Scope, Fields, seven criteria and Proof line. It has no comments.
- `docs/canvas-primitives.md`: Mark set and columns `marks@1`; Mark set: atlas tiles; Mark set: logic columns; Mark
  set: hex grid. `docs/technical-design.md`: Criteria to tests; Wrong programs; Proven on the base; the edit guard;
  Dogfooding; Built to be hard to get wrong. `docs/parallel-proof.md`, section 7. AGENTS.md and CONTRIBUTING.md.
- At the base, for call shapes and the fixtures: `tests/acceptance/1653/` (README, helpers, the tiles and isometric
  tests, BASE-FAILURE), `1653-redraft-ac2-flip/`, `536/` (README, helpers, its three tests, BASE-FAILURE),
  `467/helpers.ts` and its look; `crates/deep-canvas-marks/src/atlas.rs`; `crates/deep-marks-render/src/{lib,raster,
  asset}.rs` (`raster`'s line, how an atlas cell is drawn into its quad, the ground under the items);
  `scripts/proof-change.mjs`, `scripts/lanes.mjs`.

## What the base already does

It draws all eleven pictures below, and keeps its own hashes by definition: the first test passes at the base. It is a
guard of behaviour that must not change, and a guard must pass there (design: Proven on the base). The base reads
neither `atlas.draw` nor `atlas.anchor`: `raster` takes a set that writes them and draws it as if it didn't, to the
same pixel hash. So the second test fails at the base, on its own assertions. `BASE-FAILURE.txt` is the base run.

## Run it

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 \
  scripts/lease npx vitest run --root tests/acceptance/2386-redraft-ac6-hashes --testTimeout=600000 --no-file-parallelism
npx tsc --noEmit -p tests/acceptance/2386-redraft-ac6-hashes    # type-check
```

The file builds `deep-canvas-render` once (`cargo build --locked --bin deep-canvas-render`, through
`../536/helpers.ts` `useRender`; no cargo is `BLOCKED:`, never a pass) and copies it to a temporary folder. It draws
with Vello CPU, so it runs on every platform with no GPU, and takes no outside input and no timing. The asset store,
the pictures and the binary copy are temporary and deleted. Imports: Node built-ins, vitest, and
`../467/helpers.ts`, `../1653/helpers.ts` and `../536/helpers.ts`, read only.

**`scripts/lanes.mjs` needs `'tests/acceptance/2386-redraft-ac6-hashes/'` in its `alone` list**: the file builds a
cargo binary, and a redraft folder takes no `lane.json` (docs/parallel-proof.md, section 7). This README is the
instruction; the implementer makes that edit, and nothing else outside this folder.

## The surface under test

No new call, field or planted name: the call is the base's and the two fields are the issue's.

| What | As the test writes or reads it |
|---|---|
| a picture | `deep-canvas-render raster`, one JSON line each, all of a test's lines through one process: `{out, doc, look, t: 0, store, view: {zoom}}` → `{ok, …}` and the PNG at `out`. `look` is #467's `fixtures/look.json`, `store` a folder holding each atlas PNG under its SHA-256 |
| the two fields | `params.atlas.draw: [u, u]` and `params.atlas.anchor: [f32, f32]` on a `marks@1` set with `mark: "image"` and `atlas`, as the issue writes them: `"atlas": {"asset": "<sha256>", "cell": [16, 16], "padding": 1, "draw": [32, 56], "anchor": [0.5, 0.25]}` |
| a recipe's rows | `deep-canvas-render check {doc, look, store}` → `expansions` (the base's; `../467/helpers.ts` `tilesOf`), read for the tile each cell of a terrain recipe took |

## The fixtures, and how each is drawn

A fixture here is a document that #1653's or #536's suite lays out or draws and that holds an atlas tile set, or a
terrain recipe, which draws as one. There are eleven. Each is built by its suite's own helper, or, where the suite
keeps the builder in a test file, written in `helpers.ts` as that file writes it (the flip rows, the hex board). Each
is drawn once, at `t: 0`, at zoom 1, or at zoom 2 where its suite draws it at that zoom alone.

Two device pixels are named in each. `inside` lies in the quad of one row, the top quad there. `below` lies under the
cell of a row of the set's last line of cells, where no quad reaches. Each lies 1.5 px or more from every quad's
edge. Quads are `[x, y, w, h]` in page u.

| Picture | The fixture | Zoom, px | `inside`: the row's quad, what it reads | `below` |
|---|---|---|---|---|
| `1653-floor` | #467's terrain floor as #1653 draws it (`terrain(asset, FLOOR)`): recipe `floor`, 30 grass cells on pointy odd hexes, cell [32, 28], four solid 16 px tiles | 1, 320 × 240 | (96, 90): `floor (3, 4)` [80, 70, 32, 28], the tile the check chose | (96, 118) |
| `1653-animated` | #1653's animated rows (`animDoc`): sets `plain` (one row, phase none) and `hashed` (four rows), square grid, cell [16, 16], seed 1653 | 1, 176 × 48 | (16, 18): `plain (1, 1)` [8, 8, 16, 16], atlas cell 0 (230, 25, 75) | (16, 34) |
| `1653-isometric` | #1653's isometric fixture (`isoDoc`): set `iso`, cell [32, 16], rows (1, 0), (0, 0), (0, 1), (2, 1) | 1, 128 × 64 | (10, 26): `iso (2, 1)` [0, 16, 32, 16], tile 0 (200, 40, 40) | (10, 42) |
| `1653-flip-none`, `-h`, `-v` | #1653's flip rows, as `1653-redraft-ac2-flip/flip.test.ts` writes them: set `tiles`, square grid, cell [40, 40], rows (1, 1) and (3, 1) of a tile of four quadrants, the right row's `flip` 0, 1 or 2 | 1, 240 × 120 | (110, 50): `tiles (3, 1)` [100, 20, 40, 40], the tile's bottom left (40, 60, 220); mirrored by h its bottom right (230, 200, 30), by v its top left (220, 40, 40) | (30, 90), under `tiles (1, 1)`, never flipped |
| `536-board-pointy-odd` | #536's 6 × 6 atlas hex fixture, as `536/ac1-centres.test.ts` writes it: set `board`, cell [32, 28], 36 rows of one solid tile (200, 120, 40) | 1, 240 × 200 | (80, 110): `board (2, 5)` [64, 91, 32, 28] | (80, 138) |
| `536-board-pointy-even` | the same, offset even | 1, 240 × 200 | (96, 110): `board (3, 5)` [80, 91, 32, 28] | (96, 138) |
| `536-board-flat-odd` | the same, flat hexes | 1, 240 × 200 | (48, 146): `board (2, 5)` [32, 126, 32, 28] | (48, 174) |
| `536-terrain` | #536's terrain fixture (`terrainDoc`): recipe `floor` at (24, 20), 36 cells of water, sand and grass, 32 tiles of 64 × 56 px art | 2, 448 × 296 | (216, 248): `floor (2, 5)` [88, 111, 32, 28], texel (40, 26) of the tile the check chose | (216, 284) |
| `536-tiles` | #536's sheet of the recipe's tiles (`tileSheet`): set `sheet` at (32, 28), square grid, cell [32, 28] | 2, 608 × 364 | (120, 268): `sheet (1, 4)` [48, 126, 32, 28], texel (24, 16) of tile 28 | (120, 312) |

## The hashes

A picture's pixel hash is the SHA-256 of its pixels: the PNG `raster` wrote, decoded to 8-bit RGBA with straight
alpha, `width × height × 4` bytes row by row from the top left (`helpers.ts` `pixelHash`). The PNG file's own bytes
aren't hashed: how an encoder packs them is not a pixel.

`base-hashes.json` holds what each picture drew to at the merge base, `b6b99ad8ccdd5155bed00b7d4b4647c7e066a9ea`:
its zoom, width, height and hash. They are facts of the base, taken there on macOS arm64 with the debug build, and
the only values in this folder recorded from a run. Each picture hashed the same drawn alone in a process of its own
as drawn after the others in one.

To make them again: check out the base commit and run this file. The first test prints one line a picture,
`AC6 #2386.b3f6fe16 <name>: zoom <z>, <w> × <h> px, pixel hash <sha256>`, whatever the file holds, and passes when
they are the file's. By hand: draw a fixture's document with the `raster` line above, decode the PNG to RGBA and take
the SHA-256 of those bytes. A changed entry is a re-recorded golden, which the edit guard refuses.

## What the tests assert, and what fails each

Both tests first work the layout out from the issue's and the design's rules, in f64, and assert what it draws at the
named pixels before any picture is read (`helpers.ts` `quadsOf`, `drawnAt`): each grid's cell centres; each row's
quad, `draw` placed so `anchor` is on the cell's centre, and the grid's cell centred with neither; the draw order, by
the cell's centre y, then centre x; the quad on top at the pixel; and the atlas texel it shows, which must be opaque
and one color with the eight around it. The same code gives the issue's own boxes: [−32, −16, 64, 32], [−32, −48,
64, 64] and [24, 24, 16, 32] (criteria 1 and 3).

1. **`… draws the grid's cell, centered, as at the merge base …`** For every picture: `inside` reads its row's tile
   and `below` the bare page, each within 3 codes a channel and opaque, and the picture's size and pixel hash are
   the merge base's. The hash holds every pixel; the two pixels show, from the issue's rule and not from a run, that
   the hashed picture has the set's tiles in it, where "the grid's cell, centered" puts them and no lower. Passes at
   the base, a guard. Any program that changes one pixel of one picture fails it, naming the picture and both hashes.
2. **`… the hashes see a set's pixels …`** The same sets with the two fields, `draw: [w, 2h]` and `anchor: [0.5,
   0.25]` for a grid cell [w, h]: each tile hangs from its cell's top edge and reaches one cell height below its
   cell. For every picture `below` reads the tile of the row above it, and the pixel hash is not the merge base's.
   A recipe's sets are its expansion written out as a `marks@1` set (Readings). Fails at the base, which reads
   neither field: every `below` reads the bare page and every hash is the base's own.

Tried in scratch, not committed: the base's own renderer drawing the quads each rule gives, as free rows (at the
base a free row's quad is its grid's cell centred on its (x, y); free rows laid as the fixture's own quads hash the
same as the fixture). Quads by the issue's rule pass the second test on all eleven pictures. Quads with neither field
read fail on all eleven. Quads with `anchor` not read (the draw centred), and with `draw` not read (the grid's cell
at the anchor), each fail on ten: `536-terrain`'s page ends 9 u under its last line, so its `below` is inside all
three.

## Readings where the issue and design leave a choice

- **"Each fixture of #1653 and #536"** is each document of the two suites that holds an atlas tile set or a terrain
  recipe and that the suite lays out or draws: the Scope line this clause holds speaks of sets, and the issue changes
  nothing else. #1653's halo cards and status groups hold no mark set. The documents #536 only checks (the missing
  tile, the square rules, the added cell, the logic columns) have no picture of their own. The hex board is in:
  #536's first criterion names it a fixture, though its suite reads only its centres.
- **One picture a fixture.** The floor's other nine zooms and the animated rows' other times aren't hashed: the two
  fields place and size a quad in u, which a zoom scales and a time doesn't touch. The flip rows are three documents
  and three pictures.
- **"Keeps its pixel hash"** is against the merge base, as the criterion's budget is, so the hashes are the base's
  own. They were taken on one machine. `raster` draws at the scalar level through the f32 pipeline on every platform,
  so they are read as the picture's on any; a machine that draws the base to other hashes shows it by the first test
  failing at the base, which is a finding about the renderer and no reason to re-record.
- **The twin's fields.** Every fixture sits at or near its page's top left and several are one color, so a tile that
  stands taller than its cell, the issue's own shape, reaches off the page or over its own color: with `draw: [w,
  2h]` and `anchor: [0.5, 0.75]` the isometric fixture and the flat hex board draw the same picture as with neither,
  pixel for pixel (worked out in scratch with this layout: no pixel's top texel changes; and tried as above: the same
  hash), so that shape can't show that the hashes see a set's pixels. The twin hangs instead: `anchor: [0.5, 0.25]`
  keeps each quad's top edge and reaches down, where every page is bare. Both values are ones the issue takes: a
  `draw` of two finite numbers above 0 and an `anchor` of two finite numbers.
- **A recipe's twin.** The issue writes the two fields on a `marks@1` set; a `tiles.terrain@1` recipe has no place
  for them. So the second test writes each recipe out as the set it expands into (its own atlas, grid, position and
  order, a row a cell in the recipe's order, each with the tile `check` chose) and gives that set the fields. The
  first test draws the recipe itself. At the base the written-out set draws the recipe's hash.
- **The named pixel under the flip rows** is under the unflipped row: what a flipped row shows in a quad of another
  size is no clause of this criterion. `inside` is on the row whose `flip` changes, read as #1653's flip clause
  reads the bits: h (1) mirrors left to right, v (2) top to bottom.
- **A square grid's centre** is (cx × w, cy × h): the third criterion's box [24, 24, 16, 32] for cell (2, 3) puts it
  there. **An atlas's cells** count row by row from its top left, as #536's helpers lay their tiles. **The atlas cell
  fills its quad**: `draw` is "the size one atlas cell draws at", so a pixel shows the texel at its fraction of the
  quad.
- **The bare page** is the look's `ground` role, which `raster` paints under the items: white in #467's look.
- **Tolerances.** A named pixel's centre lies 1.5 px or more from every quad's edge, and its texel is one color
  with its neighbours, so no edge and no sampling filter decides it; it reads its color within 3 codes a channel.
  The hash is exact.

## Not asserted, because this clause doesn't say so

The criterion's other two clauses. What `draw` and `anchor` draw beyond the one pixel under a cell: criteria 1 to 3
hold the boxes, the texels and the order. A set that writes the two fields at their defaults drawing the picture of a
set with neither. A recipe that takes the two fields on its own `atlas`. Pictures by the GPU layer or `deep-show`.
#535's free rows and #539's boards, which are no fixture of #1653 or #536.
