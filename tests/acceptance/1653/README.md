# Acceptance tests for #1653: halos on text, atlas tiles drawn, and the refusals of #467's 2D fields

Written first, from issue #1653 (its scope and four acceptance criteria), the design sections it links and those they
lean on, and base commit `d51be2c3` ("Merge pull request #2108 …"), by a job that never saw an implementation; no other
worktree, branch or pull request was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test per criterion clause that needs its own
run, plus exactly the two planted twins criterion 4 names. The issue says no upstream test checks these criteria.

What was read:

- `docs/canvas-primitives.md`: Text `text@1` and its halo; Paint: shade; Paint: glow, bevel and satin; Frame and group:
  y sort and parallax; Mark set and columns; Mark set: atlas tiles; Mark set: hex grid; Status binding; the
  status-color rule; Honest numbers; the loop's check kinds (`render.contrast`).
- `docs/technical-design.md`: Dogfooding.
- At the base, only for how surfaces are driven: AGENTS.md; `tests/acceptance/467/` (README, helpers, drop, terrain,
  parallax, y-sort), `467-redraft-ac2/`, `373/arc.test.ts`, `399/place-route.test.ts`, `674/nearest.test.ts`, and the
  status bindings in `385`'s and `397`'s helpers; `crates/deep-marks-render/src/{main,lib}.rs` (`check`, `raster`,
  `geometry`, `path`, the `planted` values each takes), `raster.rs` (`geometry`'s answer), `deep-canvas-marks/src/
  {terrain,data,check}.rs` (the terrain's expansion, a mark set's `rows` report, the status checks).

What the base already does, and these tests don't credit: #467's `tiles.terrain@1` expansion at check (a `marks@1`
image set `<id>.tiles` with `cx`, `cy` and `tile` columns); `raster`'s `texts` with each text's glyphs; the
`number_unfit` refusal; `geometry`'s per-row `rows` report for a mark set (`columns`, `opacity`, `place`); status
bindings on a fill, stroke or badge slot. No code reads `halo`, draws a `marks@1` set with `mark: image` and `atlas`,
reads `flip`, `frames`, `frame_rate` or `phase`, lays out an isometric grid, or refuses status inside a parallax or
sorting group.

## Run them

They build `deep-canvas-render` and draw with Vello CPU, so they run on every platform with no GPU. Run them with
`--no-file-parallelism`; `scripts/lanes.mjs` needs `'tests/acceptance/1653/'` in its `alone` list beside `467/`. This
README is the instruction; the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease npx vitest run --root tests/acceptance/1653 --no-file-parallelism
npx tsc --noEmit -p tests/acceptance/1653    # type-check
```

Each file builds `deep-canvas-render` once (`cargo build --locked --bin deep-canvas-render`, through
`../467/helpers.ts` `useBin`), copies it to a temporary folder and fails each test that uses it if the build failed.
Temporary files (the asset store, the PNGs) go under the OS temp folder and are deleted. No test takes an outside input
or a timing, so none reads `BLOCKED`, `INCONCLUSIVE` or depends on load.

## The surface under test

**No new binary, command or field beyond the issue's.** Every criterion is entered through `deep-canvas-render`'s
existing commands, one JSON line in and one out, as #467's suite drives them. `helpers.ts` imports #467's helpers (the
build, the driver, PNG reading and writing, `fixtures/look.json` as `LOOK`, #467's terrain fixture) and builds this
suite's documents in code. Every color is a role of #467's look. The documents that bind status (criterion 3) are
checked with `STATUS_LOOK`: #467's look less the eight data roles the base's check finds within its status distance of a
status color (drop, figd, hill, marquee, moss, satin, sepia, vermilion), since wherever status shows the check holds
every data role of the look apart from the status colors; with #467's look as it is, the base refuses every such
document with `status_distance` naming `look/roles/drop`, before anything this issue adds is reached.

### Documents

#373's envelope (`{format: 1, id, profile: "figure", title, description, size, budget: {class: "figure"}, layers:
{main}, items}`), as #467's suite writes it. The issue's fields as canvas-primitives writes them:

| Field | As the tests write it |
|---|---|
| halo | `params.halo: [{width, role, opacity?}]` on a `text@1` (`width` in px; `offset` and `blur` left at their defaults) |
| atlas tile set | `{kind: "marks@1", params: {mark: "image", n, atlas: {asset: <sha256>, cell: [px, px], padding: 1}, grid: {shape, cell: [u, u]}, columns: {cx: i32, cy: i32, tile: u16, flip?: u8, …}}}`, typed columns as `{dtype, len, data: base64}` |
| animated row | columns `frames: {const: 4}`, `frame_rate: {const: 6}`, `phase: {const: "none" \| "hashed"}`; the document's `seed: 1653` |
| the atlas | a PNG the suite writes, named by its SHA-256 in a folder passed as the line's `store` (as #467's terrain test does) |
| status mark | `status_bindings: {<id>: {target: "items/<item>/params/paint/fill", source: "verdict:01JB1653000000000000000001"}}` (#385, #397) |
| status badge | the same with `target: "items/<item>/params/paint/badge"` |
| parallax | `params.parallax: {rate: [1, 1], repeat: [170, 0], repeat_count: 3, drift: [0, 0], origin: [0, 0]}` on a `group@1` |
| y sort | `params.sort: "y"` on a `group@1`; children by `parent` |

### `deep-canvas-render raster` (every platform)

`{out, doc, look, t?, store?, view?: {zoom}, planted?}` → `{ok, width, height, texts, …}` and the PNG at `out`, as #373,
#381 and #467 give it. Read: `ok`; `code` and `path`/`issues` on a refusal (`number_unfit`, named through #467's
`refusalNames`); `texts.word.glyphs` (#381's Glyph: `font`, `size`, `id`, `x`, `y`, `grapheme`); the PNG's pixels. Zoom
`z` draws the document at `size × z` px. `t` is in flicks (705,600,000 a second).

### `deep-canvas-render check` (every platform)

`{doc, look, store?}` → `{ok, issues: [{code, severity, ids, path, …}], expansions, …}` as at the base. An error
"names" an item when its `ids` hold it or its `path` is `items/<id>` or under it. The terrain's choice is read from
`expansions` as #467's suite reads it (`../467/helpers.ts` `tilesOf`).

### `deep-canvas-render geometry` (every platform): a grid cell's centre

`{doc, item, t, look, store, planted?}` → `{ok, rows: {<key>: {columns, opacity, place}}, …}`, the per-row answer the
base already gives a `marks@1` item (#167). For a row of an atlas tile set on a grid, `place: {x, y}` is **the centre of
its cell in document u** (plus the set's position, here 0); the row is matched to its cell by its own `columns.cx` and
`columns.cy`, so the key scheme is the implementer's. This is the readout criterion 4's centres are taken from: the
most natural existing surface, chosen here because the issue names none.

### Planted programs

| Where | Name | The wrong program | Criterion |
|---|---|---|---|
| `deep-canvas-render geometry`, `"planted": "isometric_as_square_grid"` | `isometric_as_square_grid` | An isometric grid laid out as a square one: the centre of (cx, cy) at (cx × w, cy × h), so (1, 0) at (32, 0); its answer and its drawing otherwise honest | AC4 |
| `deep-canvas-render raster`, `"planted": "tiles_in_row_order"` | `tiles_in_row_order` | An atlas tile set that draws its rows in the order written instead of by centre y, then centre x | AC4 |

Each is reachable only there and only for this proof; any other `planted` value on those commands stays `bad_input`, as
the base answers an unknown one.

## Criteria to tests

IDs are `#1653.` + the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed
(`scripts/proof-change.mjs` `criterionId`). Each test's name starts with `AC[n] #1653.<id>`, and the file that carries a
criterion quotes it in full. `twins.json` maps criterion 4 to its two planted names; no other criterion names one.

| ID | Criterion | Test file: what it asserts |
|---|---|---|
| `AC1 #1653.7cb93294` | 1: two halos under the glyphs, the wider outermost, glyphs unchanged; a halo past a number's box fails the fit check; a halo under render.contrast's minimum refused | `halo.test.ts` (3): `raster` of a 72 px card with halos `[{width: 4, role: glow}, {width: 14, role: sky}]` (narrower first): `texts.word.glyphs` equal the bare card's; every solid glyph pixel of the bare card keeps the text's fill; glow shows on at least 30 pixels and never more than 5.5 px from the glyphs; sky shows on at least 30 pixels more than 5.5 px away. A story constant 8 at 20 px centred in a 40 × 40 u box draws bare and with a 2 px halo; with halos 2 and 40 px wide it's refused `number_unfit`, naming `fit`. `check`: the card with glow and sky halos has no error; with a halo in `dark` (1.8:1 against the fill) it's refused, an error naming `word`. |
| `AC2 #1653.91f150e7` | 2: #467's terrain floor drawn from its atlas inside each cell at zooms 0.5 to 4; a flipped row mirrored; an animated row's frame, seeked as played | `tiles.test.ts` (3): #467's 30-cell hex floor at zooms 0.5, 0.6, 0.75, 1, 1.3, 1.5, 2, 2.7, 3 and 4: every device pixel 1.5 px clear of every quad's edge shows, within 1 code and opaque, the tile color the check chose for the top quad there (quads at the design's hex centres, stacked by centre y then x), and every cell has such pixels. A gradient tile at flip 1 equals the unflipped row mirrored left to right, at flip 2 top to bottom, within 2 codes inside the quad (the tile isn't its own mirror). A phase-none row with 4 frames at 6 a second shows atlas cell ⌊t × 6⌋ mod 4 at 80 times in one process; four phase-hashed rows each show ⌊t × 6 + q⌋ mod 4 for one q in [0, 4), not all four alike; 8 of the times, each in a fresh process, give the played bytes. |
| `AC3 #1653.0a06a5ae` | 3: status in a repeating parallax group, and a status badge in a `sort: y` group, refused at check naming the item | `refusals.test.ts` (2): a band with `repeat: [170, 0]` whose child `lamp` is a status mark: refused, an error naming `lamp`; the band with lamp in a data role, and the status lamp beside the band, both pass. A `sort: y` group holding `post` with a status badge (and `crate` sorted over its top-right corner): refused, naming `post`; the group without the badge, and the badged post beside the group, both pass. |
| `AC4 #1653.00cbd0dd` | 4: the isometric centres; the planted square layout; the pixel at (10, 2); the planted row order | `isometric.test.ts` (4): `geometry` places (1, 0), (0, 1) and (2, 1) at (16, 8), (−16, 8) and (16, 24) within 1e-9 u. Twin: with `isometric_as_square_grid`, (1, 0) is at (32, 0) and the first failure names `cell (1, 0)`. `raster` at zoom 1: pixel (10, 2) reads tile 0's color, the tile of (1, 0). Twin: with `tiles_in_row_order` it reads tile 1's, the tile of (0, 0), and the failure names `pixel (10, 2)`. |

## Readings where the issue and design leave a choice

- **"The terrain floor from #467's fixture" is a hex floor, and the scope says hex grids draw in #536.** The criterion's
  words win over the scope line: the test draws #467's fixture as it is (`../467/helpers.ts` `terrain` and `atlasPng`,
  pointy hexes, offset odd, cell [32, 28]), placing each quad by the design's hex layout (Mark set: hex grid), which the
  design defines in full. If the owner reads the criterion as "the floor's atlas and recipe on a square grid", that is a
  redraft of this one test, not a change to it.
- **"Sampling inside its cell (padding kept)"** is judged on #467's solid tiles: a sample inside a cell, padding
  included, gives exactly that tile's color, and any sample from a neighbouring atlas cell, or from a mip level that
  mixes cells, gives another; so every device pixel 1.5 px clear of every quad's edge must show its tile's color within
  1 code. Where quads overlap, the one drawn later by centre y, then centre x, is on top, as the design orders hex tiles.
- **"Every zoom from 0.5 to 4"** is ten zooms across that range, integer and not.
- **Flip bits** are read in the order the design lists them: bit 0 (1) h, bit 1 (2) v, bit 2 (4) transpose. "Mirrored"
  is judged against the unflipped row's own drawing, about its drawn extent's centre, so it holds however a cell maps
  onto its quad.
- **An animated row's frames** are its atlas cells in order from its `tile`: frame k draws cell `tile + k`. The design
  names `frames` and doesn't say where frames sit; this is the plainest reading. `frame_rate` is a rational; 6 is written
  as the number 6. The phase-none row is checked exactly; `hash(document seed, row key)` isn't specified, so a hashed row
  is checked against the formula for some phase in [0, 1), and four hashed rows with four keys must not all show the
  same frames. Times within 1e-4 of a frame boundary of the phase-none row are skipped.
- **A row's pixel in the animation document** is read 4 u right and down of (16 cx, 16 cy), inside its quad whether a
  square grid puts the cell's centre or its corner there; the design doesn't define the square grid's origin. (The
  issue's planted square layout puts (1, 0) at (32, 0), which reads as centres at (cx × w, cy × h).)
- **Two halos' order.** "From the outside in" is read by width: the halos are listed narrower first, so a renderer that
  drew them in list order would hide the narrower one under the wider, and wouldn't "draw them". "Width" may be read as
  how far the outline grows or as a stroke's full width; the bounds (narrow within 4 + 1.5 px of the glyphs, wide
  beyond that) hold either way.
- **"Under its glyphs"**: every pixel where the card without halos shows the text's solid fill shows it with them.
- **"Passes its box"**: the widest halo reaching past the number's fixed box, which the fit check refuses as it refuses
  a number that doesn't fit, `number_unfit` (Honest numbers; #467's AC1 reads the same code). A centred number with
  room on every side keeps a 2 px halo inside its box, so that one draws.
- **"render.contrast's minimum"** is its default, 4.5:1 WCAG, held by the document check with no `render.contrast`
  item declared ("It can never: … bring text under render.contrast's minimum (checked)"), between the text's fill and
  its innermost halo. The test's halos are far from the line: glow and sky at 7.5:1 and 6.7:1 against the fill, dark at
  1.8:1. The refusal's code is the implementer's; only that it's an error naming `word` is asserted.
- **"Takes a status role"** is a status binding on the child's fill: the status-color rule allows a status color only
  through a binding, and a bare `status.pass` role is already refused by #374's `status_color_unbound`. **"A status
  badge"** is a binding on an item's `badge` slot. **"Naming the item"** is the item that takes the status role or holds
  the badge (`lamp`, `post`), not the group. The badged post is placed so `crate` sorts over its top-right corner, where
  a badge's chip sits, so the group refuses it under either reading of "sliding a status badge under another item".
  Codes are the implementer's and aren't asserted.
- **A cell's centre** is `geometry`'s `rows.<key>.place.{x, y}` (above); "within 1e-9 u" is per coordinate.
- **"The pixel at (10, 2)"** is device pixel (10, 2) at zoom 1 with the set at the document's origin; its centre (10.5,
  2.5) lies inside both quads, at least 2 u from every edge. "Reads the tile" is within 1 code and opaque.

## Not asserted, because no criterion says so

The implementer owes these a mapping or a note (AGENTS.md: review requirement → change → proof):

- Halos on `mark.text`; halo `offset`, `blur` and `opacity` below 1; the limit of 4 halos; a halo's status role.
- Atlas `margin` and `separation`; a square grid's own layout; flip's transpose bit; `frame_rate` as a non-integer
  rational; animated rows on an isometric grid.
- A parallax group repeating a needs-you item; a bevel or a shade on a 3D item refused.
- Hex grids beyond #467's floor drawn here (#536), free rows with `angle` and `scale` (#535).
