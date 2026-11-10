# Blind redraft: #1653 AC2, the flip clause

One clause of issue #1653's second criterion, `#1653.91f150e7`: "a flipped row draws mirrored". Written from the issue,
the design and base `d51be2c3` by a job that saw no implementation, no other branch and no PR (AGENTS.md, Proof;
design: Dogfooding). The implementing agent doesn't edit this folder.

The full criterion: "The terrain floor from #467's fixture draws each cell's tile from the atlas, sampling inside its
cell (padding kept) at every zoom from 0.5 to 4; a flipped row draws mirrored; an animated row shows frame
⌊t × frame_rate + phase × frames⌋ mod frames, the same seeked as played". The issue's scope line: "Atlas tiles drawn:
`marks@1` with `mark: image` and `atlas`, on square and isometric grids, `flip` bits, …".

Read: AGENTS.md; `docs/technical-design.md` Dogfooding; `docs/canvas-primitives.md` Units and axes, Image `image@1`,
Mark set and columns, Mark set: atlas tiles, Mark set: hex grid; `tests/acceptance/467/{helpers.ts,README.md}`;
`tests/acceptance/674/nearest.test.ts`; at the base, `crates/deep-marks-render/src/{lib,raster,asset}.rs` for the
`raster` line's fields (`out`, `doc`, `look`, `t`, `view`, `store`) and that it paints the look's ground under the marks.

## Run it

```sh
npm ci --ignore-scripts         # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/1653-redraft-ac2-flip
npx tsc --noEmit -p tests/acceptance/1653-redraft-ac2-flip
```

The file builds `deep-canvas-render` once (`cargo build --locked --bin deep-canvas-render`, through
`../467/helpers.ts`), so `cargo` must be on PATH. It runs on every platform (Vello CPU, no GPU), takes no outside
input and no timing.

## The surface

`deep-canvas-render raster`, one JSON line per picture on stdin, as #467's suite drives it: `{out, doc, look, t: 0,
store}`, the check first, the PNG at `out`. `look` is #467's `fixtures/look.json`. The atlas PNG sits in `store`, a
folder whose files are named by their bare SHA-256, and the document names it by that hash.

The document is one `marks@1` item, spelled as canvas-primitives writes the fields:

```json
{ "mark": "image", "n": 2,
  "atlas": { "asset": "<sha256>", "cell": [16, 16], "padding": 1 },
  "grid": { "shape": "square", "cell": [40, 40] },
  "columns": { "cx": i32 [1, 3], "cy": i32 [1, 1], "tile": u16 [1, 1], "flip": u8 [0, F] } }
```

with each column typed as Mark set and columns gives it, `{dtype, len, data: base64}` (little-endian). The document is
240 × 120 u, and the look's ground is under it.

The atlas is 32 × 16 px, two 16 × 16 cells in one row: cell 0 is all one decoy brown, (120, 60, 20); cell 1, the tile
both rows draw, has four quadrants, each to its cell's edges: top-left red (220, 40, 40), top-right green
(40, 180, 60), bottom-left blue (40, 60, 220), bottom-right yellow (230, 200, 30). All opaque.

## What the test asserts

One test, `AC2 #1653.91f150e7 a row with the h bit draws …`, draws three documents in one `raster` process, the same
but for the right row's `flip`: F = 0, F = 1 (h), F = 2 (v). All three must be drawn, not refused.

1. From the F = 0 picture, every pixel within 12 per channel of a quadrant's color (alpha ≥ 243) is collected, split
   into the left and right tile at the mean x of all of them, and each (tile, quadrant) must cover at least 20 pixels;
   its centroid, rounded, is that quadrant's sample point.
2. The unflipped tiles draw as the atlas holds them: in each, top-left and bottom-left lie left of top-right and
   bottom-right, and top-left and top-right lie above bottom-left and bottom-right (y down: Units and axes).
3. In the F = 1 and F = 2 pictures, the left row (flip 0 in every document) reads, at each of its four sample points,
   the same quadrant's color within 12 per channel.
4. In the F = 1 picture, the right row reads, at its sample point for top-left, top-right, bottom-left and bottom-right,
   the colors of top-right, top-left, bottom-right and bottom-left: mirrored left to right, in place. In the F = 2
   picture it reads bottom-left, bottom-right, top-left and top-right: mirrored top to bottom, in place. Each within 12
   per channel.

Every miss is listed by the bit, the pixel, what it read and what it wanted.

## Readings where the design is silent, and what the test avoids depending on

- **Bit order.** The design gives `flip: u8 (bits h, v, transpose)`. This test reads the bits in the order written,
  from the lowest: h = 1, v = 2, transpose = 4, and h as a mirror left to right (x → −x about the tile's centre), v top
  to bottom. That is the one reading that depends on wording rather than on the picture; transpose isn't used, so the
  order in which h, v and transpose compose doesn't matter.
- **The square grid's layout.** The design defines the isometric and hex layouts but not where a square cell (cx, cy)
  lands (its centre or its corner at (cx × w, cy × h)). The test never computes a position: it finds each quadrant in
  the unflipped picture and samples the flipped pictures there. It assumes only that a larger cx draws further right,
  and that both cells land inside 240 × 120 u (they do under either the centre or the corner reading).
- **Padding.** Whether `padding: 1` insets the sampled rectangle, and by how much the drawn quad shows the cell's edge
  texels, is left alone: the quadrants run to the cell's edges, so any inset leaves four equal quadrants.
- **Sampling filter and the drawn size.** The 16 px cell draws over a 40 u cell at 2.5 × , linear or nearest; sample
  points are quadrant centroids, about 10 u from any color edge, so the filter never reaches another color. The
  tolerance (12 per channel) covers color conversion rounding; the four colors and the decoy differ from one another
  by more than 100 in some channel.
- **Tile numbering.** With one row of cells, tile 1 is the second cell whether cells count row-major or column-major.
- **The ground.** Whatever `raster` paints under the marks is never read: only pixels near the four tile colors are.
- **Zoom.** `view` is left out (zoom 1). The criterion's zoom range belongs to its sampling clause, which this file
  doesn't carry.

## What a wrong program shows

- **Ignores `flip`.** The F = 1 picture's right row reads top-left where top-right is wanted (and so on for all four),
  and F = 2 likewise: four misses per bit.
- **Flips the wrong axis** (h mirrors top to bottom, v left to right, or both bits one axis). The F = 1 right row reads
  bottom-left where top-right is wanted, or the F = 2 one reads top-right where bottom-left is wanted.
- **Takes h for transpose.** Top-left and bottom-right stay where they were: a miss at each.
- **Flips about the wrong point, or flips the atlas rather than the cell.** The mirrored quad lands elsewhere or samples
  cell 0, and a sample point reads the ground or the decoy.
- **Applies one row's flip to every row.** The left row reads mirrored: a miss at each of its sample points.
- **Draws nothing for an image mark set, or refuses it.** `raster` answers `ok: false`, or the F = 0 picture lacks a
  quadrant, and the test fails before judging.

These were tried against synthetic pictures of each wrong program (a throwaway mock of `render` outside the
checkout, not committed): the right program and one laying out square cells by centre rather than corner pass; ignoring
`flip`, swapping h and v, h as transpose and one flip for all rows fail, naming the pixels.

## At the base

`BASE-FAILURE.txt` records the one run at `d51be2c3`.
