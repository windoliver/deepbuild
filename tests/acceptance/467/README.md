# Acceptance tests for #467: paint and 2D fields for films: drops, inner shades, glow, bevel and satin, y sort, parallax, atlas tiles and halos

Written first, from issue #467 (its scope, its Fields, its seven acceptance criteria and its proof line, "Text drops and
glows against their CPU references, and the isometric sorting line seeked and played"), the design sections it links
and those they lean on, and base commit `92aee55f` ("Merge pull request #1598 …"), by a job that never saw an
implementation; none existed, and no other worktree or branch was read. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test per criterion
clause that needs its own run, plus exactly the planted twins the criteria name. There is no Oracle page for #467
(`doneright/oracles/issues/467.md` in `DeepBuildAI/deepbuild`, branch `doneright`, answers 404).

What was read:

- `docs/canvas-primitives.md`: Time and the flick; Units and axes; Order keys; The status-color rule; Honest numbers;
  The cost model; Text `text@1` and its halo; Paint (fill and stroke); Paint: shade; Paint: drop; Paint: glow, bevel
  and satin; Frame and group, its y sort, parallax and draw order; Mark set and columns; Mark set: atlas tiles; Mark
  set: logic columns; Mark set: hex grid; the transport's `loop`.
- `docs/technical-design.md`: Films and figures on the canvas; 2D marks and paint; Mark set, scale and encode; Bake and
  golden; Who drafts it; Dogfooding; Tests written first.
- At the base, only for how surfaces are driven: AGENTS.md; `tests/acceptance/{149,160,374,381,385,397}/` (READMEs,
  helpers, some tests) and `379`'s and `430`'s READMEs; `crates/deep-gpu-layer/src/{main,marks2d,film}.rs` (the call
  list, `layers`, `film2d`), `live.rs` (2D documents and the look it reads); `crates/deep-marks-render/src/{lib,main,
  asset}.rs` (`check`, `raster`, `path`, the store); `crates/deep-canvas/src/document/check.rs` (`lowered`,
  `expansions`); `crates/deep-canvas-marks/src/paint.rs` (`Shade`); `crates/deep-canvas-scene3d/src/look.rs`
  (`Look3::read`); `scripts/lanes.mjs` (`alone`).

What the base already does, and these tests don't credit: #160's crescent and step shade (`kind`, `role`, `offset`,
`light`, `opacity`, `mode`, `highlight`, `rim`; `blur`, `choke` and `kind: inner` are noted there as waiting for this
issue's pass); #149's 2D `camera@1`; `raster`'s `texts` with each text's glyphs; `layers` by the GPU layer and Vello
CPU with glyph-run coverage; `film2d` with `capture`; `live` drawing 2D documents; `check`'s `expansions`; the
`number_unfit` refusal for a bound number that doesn't fit its box (GPUI's draw path only). No code reads `drop`,
`glow`, `bevel`, `satin`, `halo`, `sort`, `sort_anchor`, `parallax`, `atlas`, `grid` on a mark set or
`tiles.terrain@1`.

## Run them

They build `deep-canvas-render` and `deep-gpu` and drive the GPU, so they run with `--no-file-parallelism`, and
`scripts/lanes.mjs` needs `'tests/acceptance/467/'` in its `alone` list beside `149/`. This README is the instruction;
the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/467 --no-file-parallelism
npx tsc --noEmit -p tests/acceptance/467    # type-check
```

Each file builds what it drives once (`cargo build --locked --bin deep-canvas-render`, `--bin deep-gpu`), copies it to
a temporary folder and fails each test that uses it if the build failed. `helpers.ts` sets Vitest's timeouts
(`vi.setConfig`), so they hold under any root. Temporary files go under the OS temp folder and are deleted; only
`taste.test.ts` writes into the checkout, to `docs/evidence/467/`. Delete Vitest's cache in
`tests/acceptance/467/node_modules/.vite` after a run.

- `drop.test.ts`, `y-sort.test.ts`, `parallax.test.ts`, `terrain.test.ts` and AC2's fit and status tests run on every
  platform (Vello CPU and the check need no GPU).
- AC2's CPU-reference and still-card tests, `disc.test.ts` and `taste.test.ts` draw on the GPU layer: off macOS a test
  fails `INCONCLUSIVE:`, never passing; a `deep-gpu` answer `unsupported_platform` does the same.
- No test takes an outside input or a timing, so none reads `BLOCKED` or depends on load.
- `BASE-FAILURE.txt` says why the suite can't pass at the base; it wasn't run there beyond the type-check.

## The surface under test

**No new binary and no new call.** The criteria are entered through the surfaces the issue and design name (document
fields, the check, the 2D renderer and its CPU reference, the film's frames), each reached through the base's binaries
as earlier suites drive them. What the issue leaves open, this suite fixes as below; each is the closest thing the base
already has for the same kind of observation.

### Documents

The envelope is #373's (`{format: 1, id, profile: "figure", title, description, size, budget: {class: "figure"},
layers: {main}, items}`, items `{id, kind, layer, name, order, params, parent?, at?}`), with #391's `transport` and
`channels` (`{target, type: "f32", keys: {k0: {t: "<s>s", value, interp: "linear"}}}`), #381's `data` constants and
templates, and #149's 2D `camera` envelope field naming a `camera@1`. Every document is built in `helpers.ts`; every
color is a role of `fixtures/look.json`, a look@1 (#149's base look with this suite's roles added), passed inline as
`look` to every call. The issue's fields are spelled as canvas-primitives writes them:

| Field | As the tests write it |
|---|---|
| drop | `params.paint.drop: {offset: [7, 5], role: "drop"}` on a `text@1` (`offset` in px) |
| glow | `params.paint.glow: {where, role, size, spread?, opacity, source?, mode}` |
| inner shade | `params.paint.shade: {kind: "inner", role, offset, light, blur, choke, opacity}` |
| bevel | `params.paint.bevel: {shape, technique?, depth?, size, light: {angle, altitude}, highlight: {role, opacity}, shadow: {role, opacity}}` |
| satin | `params.paint.satin: {role, offset, size, angle, opacity, mode}` |
| y sort | `params.sort: "y"` on a `group@1` (`sort_anchor` left at its default `[0.5, 1]`); children by `parent` |
| parallax | `params.parallax: {rate, repeat, repeat_count, drift, origin}` on a `group@1`; `drift` a plain number in u/s; `repeat: [170, 0]` repeats on x only |
| loop | `transport: {span: "4.7s", loop: "wrap"}` |
| terrain | an item of kind `tiles.terrain@1` (a recipe instance, `<pack>.<name>@<major>`) with params `{atlas: {asset, cell, padding}, grid: {shape: "hex", cell, hex: {orient, offset}}, tiles: [{tile, terrain, edges: [label × 6]}], cells: [[cx, cy, terrain]], rules: "edges_6", precedence, seed}`; the atlas PNG is given by SHA-256 through `check`'s `store` (files named by their bare hash, as `asset.rs` reads them) |
| status role | `status.pass`, refused with the base's `status_color_unbound` (#374) |

### `deep-canvas-render raster` (every platform): `texts` fields added

As #373 and #381 give it (`{out, doc, look, t?}` → `{ok, width, height, texts: {id: {shown, glyphs}}}`, the check
first). Each `texts.<id>` adds:

- `drop: {"glyphs": [Glyph]}` on a text with a drop: the copy's glyphs, #381's Glyph shape, in the same frame as the
  text's own glyphs (px from the layout box's top-left). AC1 needs `x` = text `x` + `offset[0]` and `y` = text `y` +
  `offset[1]`, compared exactly (as f64, or as that sum rounded to f32), and `font`, `size`, `id`, `grapheme` equal.
- `bounds: [x, y, w, h]`: the item's bounds in document u, as the fit check and the frame take them: the glyphs and
  every outer paint (a drop's copy, an outer glow, an outer bevel, a halo). AC2 reads it on texts with an outer glow
  and an outer bevel.

**The fit check.** Honest numbers: a number that doesn't fit fails rather than being cut. The base's refusal for that is
`number_unfit`; `raster` answers it (`{ok: false, code: "number_unfit"}`, its `path` under `items/<id>/` or an issue
whose `ids` name the item) for a template number in a fixed box whose drop or outer glow reaches past the box, whether
the check or the draw refuses it.

### `deep-canvas-render check` (every platform)

`{doc, look, store?, planted?}` → `{ok, issues: [{code, severity, ids, path, …}], lowered, expansions}` as at the base.

- **The loop rule.** In a document whose transport loops with `wrap`, a parallax group that drifts and repeats on an
  axis must travel a whole number of repeats over the span within 1e-3 u; one that doesn't is an error whose `ids` hold
  the group and which carries the jump as a number somewhere in the issue (the tests find 0.2 within 1e-3 among its
  numbers; its code is the implementer's, printed, not asserted).
- **The terrain** expands at check. The tests read its choice from the `marks@1` item with `params.columns` `cx`, `cy`
  and `tile`, found among `expansions[].derived` (or, if the check fills a set in place, `lowered.items`); a column may
  be `{dtype, len, data: base64}`, `{const}` or a plain array.
- `planted: "parallax_without_modulo"` (Planted programs).

### `deep-canvas-render path` (every platform): a group's parallax

#160's `{doc, item, times, look?}` → `{ok, frames: [Frame]}` (the check first, one frame per time, in order, in one
process). With `item` a `group@1` that has `parallax`, each frame adds `"parallax": {"offset": [x, y]}`: the group's
offset at that time, in u, as the design's closed form gives it. The camera's position in that form is its `camera@1`'s
`target` x and y.

### `deep-gpu run`: `layers`, `live`, `film2d` (macOS, Metal)

As at the base, with no field added:

- `layers {doc, look, by: ["gpu_layer", "vello_cpu"]}` (#385): each writer layer alone over transparent black, by the GPU
  layer and by Vello CPU. Vello CPU's side is the **CPU reference** AC2 names: goldens and snapshots draw with it, and
  it must draw the same paint with the same blur and dilation. `runs` gives the text's glyph-run coverage.
- `live {look, frames, fps, report: ["passes", "hashes"], sessions: [{session, writer, doc: path}]}` (#379), the doc as a
  session's writer sends it (no `id`, no `layers`, no item `layer`). Each frame's `views[]` (`drawn`, `charged_gpu_ms`,
  `pixel_hash`) and `passes[]` (`session`) are read.
- `film2d {doc, look, hash: true, fps: 30, from: n, frames: 1, capture: [n]}` (#417, #149): a frame's `final` PNG.

### Planted programs

| Where | Name | The wrong program | Criterion |
|---|---|---|---|
| `deep-gpu run --planted bevel_lit_opposite` | `bevel_lit_opposite` | Every bevel lit from its light's angle + 180° | AC5 |
| `deep-canvas-render check`, `"planted": "parallax_without_modulo"` | `parallax_without_modulo` | The loop rule compares a band's offsets at 0 and at the span's end without the repeat's modulo | AC6 |

Each is reachable only there and only for this proof; any other value stays `bad_input`.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, `- [ ] ` dropped. Each
test's name starts with `AC[n] #467.<id>`, and the file that carries a criterion quotes it in full.

| ID | Criterion | Test file: what it asserts |
|---|---|---|
| `AC1 #467.ae875f3c` | 1: a drop on text reuses the shaped run; the fit check counts the copy | `drop.test.ts`: `raster` of a 72 px card with `drop.offset [7, 5]`: the text's glyphs unchanged from the card without a drop; `texts.word.drop.glyphs` one per glyph, each with the text glyph's font, size, ID and grapheme at its x + 7 and y + 5 exactly; the PNG differs. A story constant 8 at 20 px in a 30 × 40 u box: draws bare and with its copy 6 px right; with its copy 40 px right, refused `number_unfit` naming `fit`. |
| `AC2 #467.93e9eaf5` | 2: glow, inner shade, bevel, satin: shaped run, fit, inner/outer, still cost, CPU reference, status | `paint.test.ts` (4): for an outer and an inner glow, the inner shade, an inner and an outer bevel and satin on the card: the glyphs unchanged; on each renderer at least 50 pixels changed, the inner ones only where the text's glyph-run coverage is above 0, the outer ones only inside `texts.word.bounds`; the GPU layer against Vello CPU more than one code (RGBA) off on at most 0.1% of pixels. Fit: the number with an outer glow refused `number_unfit` naming `fit`; with an inner glow, the inner shade, an inner bevel or satin it draws. Still card: in `live`, frame 1 drawn with a hash unlike the bare card's; frames 2–30 not drawn, no pass for the session, 0 GPU ms charged. Status: `status.pass` in each of the four is the check's only error, `status_color_unbound`, naming `word`; the four in data roles pass. |
| `AC3 #467.2c11652d` | 3: the sorting line in foot order at every t, ties, play equals seek | `y-sort.test.ts`: 121 frame times and 40 seeded off-grid times drawn by `raster` in one process: every pixel 1 px clear of every figure's edge shows the figure that (foot y, order key, ID) puts on top, or the floor, exactly; 11 of the times, each in a fresh process, give the played bytes. |
| `AC4 #467.2680a499` | 4: parallax closed form at 1,000 random times; terrain cells don't reseed | `parallax.test.ts`: `path` on `hills` at 1,000 seeded times under a camera moving on both axes; each offset within 1e-3 u of origin + target × (1 − rate) + drift × t, floored-modulo wrapped (x and y both wrap, y through negative values). `terrain.test.ts`: a 30-cell grass hex floor; at least two of the four tiles used; adding (6, 2), (−1, 0) or (3, 5), each written first, changes no other cell's tile. |
| `AC5 #467.2184c808` | 5: the 200 u disc: bevel rims, satin a and a + 180°, outer glow; planted bevel | `disc.test.ts` (4), GPU layer: the upper-left rim's mean highlight alpha (red ÷ 255 of white over black) at least 0.5 over the lower-right's. Twin: `bevel_lit_opposite` fails, naming `upper-left rim`. Satin at 19° and 199° within one code at every pixel, satin changing at least 1% of the disc. The glow: pixels 1.5 px or more inside the edge byte-equal with and without it; along eight rays through pixel centers its alpha above 0 just outside, never rising, and lower at the end. |
| `AC6 #467.0c9e76a0` | 6: the 4.7 s loop's bands pass; the marquee refused; the planted check | `parallax.test.ts` (3): the bands document checks clean; each band's offset at 0 and at 4.7 s within 1e-3 u on both axes, and at 2.35 s within 1e-3 u of its closed form (it drifts). The marquee: refused, an error naming `marquee` with a number within 1e-3 of 0.2. Twin: with `parallax_without_modulo` the check refuses the bands, and the failure names `clouds`. |
| `AC7 #467.16dd5c0a` | 7: shown to you | `taste.test.ts`: below. |

Proof line: "text drops and glows against their CPU references" is AC2's first test, which prints each paint's pixels off
its reference, and AC1's; "the isometric sorting line seeked and played" is AC3's.

## The taste call

`taste.test.ts` writes, from one run, the canvas's own frames through `film2d`'s `capture` to `docs/evidence/467/`:
`text-drop.png`, `text-glow.png`, `text-inner-shade.png`, `text-bevel.png`, `text-satin.png` (one card each),
`y-sort.png` (the sorting line at 2.5 s), `parallax-clouds.png` (the bands at 1 s), byte for byte the renderer's PNGs,
and `parallax-bands.apng`, an animated PNG of the loop's frames 0, 3, … 138 at 30 fps, played at 10 fps. It prints
each SHA-256. Show them to the owner, attach them to the PR, and record the one call in
`tests/acceptance/467/TASTE.json`:

```json
{"issue": 467, "criterion": "#467.16dd5c0a", "verdict": "looks_right" | "looks_wrong", "who": "…", "when": "<ISO 8601>",
 "screenshots": {"<name>": "<sha256>", …}, "note": "…"}
```

`screenshots` names all eight. No file, or one made on other pictures, is `INCONCLUSIVE:`; `looks_wrong` fails. No other
test reads these pictures or the call. `TASTE.json` is the one file under this folder the implementing run writes.

## Readings where the issue and design leave a choice

- **"Its CPU reference"** is Vello CPU's side of `layers`, the renderer goldens and snapshots draw with. Comparing it with
  the GPU layer over an opaque backdrop keeps the comparison in RGB at full alpha.
- **"Exactly"** for the copy's glyph positions is equality, as the shaper's f32 plus the offset, in f64 or in f32.
- **"The fit check counts the copy"** is the Honest-numbers fit: a number whose copy (or outer glow) reaches past its
  fixed box doesn't fit, which the base already refuses as `number_unfit`. Inner paint can't take a number out of its
  box, so "counts" is read for them as leaving it fitting.
- **"The inner ones" and "the outer ones"**: the inner shade, an inner glow, an inner bevel and satin clip to the
  coverage; an outer glow and an outer bevel join the item's bounds (the design: "interior ones clip to the coverage;
  outer ones join the item's bounds"). "Changed" is more than one code value from the same card without the paint, on
  the same renderer; "inside the coverage" is a glyph-run alpha above 0; "inside the bounds" is a pixel touching them.
- **"Costs nothing per frame after its first"** is read in the live window: after frame 1 the still card's view isn't
  drawn, no pass runs for its session and its writer is charged no GPU time ("Every class draws nothing while still";
  "cached by content key, so a still item costs nothing").
- **Angles.** The criterion's "lit from 135°" with its upper-left rim fixes the bevel's convention: 0° right, 90° up,
  counter-clockwise on the screen, as #149's rims take it. A rim is the bevel's `size` band inside the edge, 1.5 px clear
  of the anti-aliased edge, within 45° of its direction. Altitude 30° is this suite's choice; the criterion states none.
- **"Highlight alpha"** is read as red ÷ 255 of a white highlight over a black disc, with a black shadow, in the
  sRGB-encoded space 2D composites in.
- **"Alpha is 0 inside the edge"** is the disc's pixels 1.5 px or more inside the edge unchanged by the glow, byte for
  byte; **"falls monotonically"** is never rising, code by code, along eight rays through pixel centers, and ending lower
  than it starts.
- **Satin's "within one code value"** is per channel at every pixel; satin draws in normal mode here, since multiply over
  a black disc would show nothing.
- **"Foot position"** is the y of `sort_anchor`'s default, `[0.5, 1]`: a figure's bottom. Order keys and IDs compare as
  byte strings. "At every t" is 161 times, 40 of them seeded off-grid, skipping times where two feet differ by less than
  1e-3 u without being equal; the exact ties at 2 s and the standing ties are kept.
- **"Playing and seeking"** is one process drawing the times in order against a fresh process per time, as #160's.
- **The camera's position** in the parallax closed form is the 2D `camera@1`'s `target`. Floored modulo is
  v − R⌊v ÷ R⌋; a repeat of 0 on an axis doesn't wrap it. Where the expected offset sits within 1e-3 u of the seam, a
  value on the other side of the seam is accepted.
- **"Equals its closed form"** takes the issue's parallax tolerance, 1e-3 u, from AC6.
- **"Adding a terrain cell never changes another cell's tile"** is read on a hex floor of one terrain under `edges_6`,
  where no cell's labels change when a cell is added, so any change is a reseeding. Where tiles declare their labels is
  open; here the recipe's `tiles` list does.
- **"Naming the group and the 0.2 u jump"** is data, not message text: `ids` and a number in the issue.
- **The bands** use rate 1, so the camera term drops out and AC6 needs no camera.

## Not asserted, because no criterion says so

The implementer owes these a mapping or a note (AGENTS.md: review requirement → change → proof):

- Text halos (`halo`), beyond what the taste call sees: none of the seven criteria names one. Its fit, its "under
  render.contrast's minimum" check, and drops on marks other than text.
- `drop.blur`, `drop.mode`, `glow.spread` and `source: center`, `shade.choke` beyond drawing, `bevel` `emboss` and
  `pillow`, `chisel`, `soften`, `light: look`, `satin.invert`.
- `sort_anchor` other than its default; a child group sorting as one unit; a status badge never slid under another item.
- `parallax.repeat_count` (≤ 8) and how many copies replay; a parallax group repeating a status color or a needs-you item
  refused at check.
- Atlas drawing itself: `margin`, `separation`, `padding`, `flip`, `frames`, `frame_rate`, `phase`, `place: free`,
  isometric and square grids, square terrain rules, a hex cell no tile matches.
- Glow, bevel and satin costs (about 0.1 ms per item at 1080p is an estimate in the design).
