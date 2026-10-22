# Acceptance tests for #373: 2D marks in R2

Written first, from issue #373 (its scope, the Mark set and columns, Star, Paint: stroke gradients and Item
and kind: adjust fields, its six acceptance criteria and its proof line, "Vello CPU goldens of each mark,
each with its planted-fault twin failing on its issue code"), the design sections it names and those they
lean on (`docs/technical-design.md`: Rules every primitive follows, line 855, with Checked before it shows
and Seeded and replayable; The canvas core, 1041, with the module table's marks2d and data rows, 1054–1055,
and the Conventions paragraph, 1080; Item and kind, 1096; 2D marks and paint, 1104; Mark set, scale and
encode, 1112; the parity suite, 2528; Tests written first, 2539; Differential and metamorphic checks, plus
reftests, 2545; Independent first oracles, 2546; the 2D renderer decision row, 2651; `docs/canvas-primitives.md`:
Conventions every primitive uses, line 7, with Units and axes, 28, and The status-color rule, 68; Document
envelope, 291; Item and kind, 321; Item and kind: adjust, 357; Rect, 1478; Circle, 1496; Path, 1514; Star,
1625; Paint (fill and stroke), 1644; Paint: stroke gradients, taper and wave, 1747; Image, 1764; Mask, 1842;
Frame and group, 1861; Mark set and columns, 2043; Status binding, 2169; Scale and encode, 2186; Look `look@1`,
2399; Canvas module: interface and implementation, 1007; What holds a document to its rules, 8157; Status
guard, 9210), and base commit `5592207` ("Merge pull request #654 … feat/42-otlp-receiver"), whose code was
read for the existing binary and conventions (`crates/deep-marks-render` and its `deep-canvas-render`
binary, `crates/deep-canvas-marks`, the document check in `crates/deep-canvas`, the clean look), by a job
that never saw an implementation; none existed. The conventions follow #391's and #392's suites. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

Run them (like #391's and #392's they build a cargo binary, so they run with `--no-file-parallelism`;
`scripts/lanes.mjs` needs its exclude and its one-at-a-time line widened to this folder, as #391's README
says for its own):

```sh
npm ci                      # once, if node_modules is missing
npx vitest run --root tests/acceptance/373 --no-file-parallelism
```

Every file first runs `cargo build --locked --bin deep-canvas-render` in the checkout (cached after the first
file) and fails each of its tests when the build fails. The tests write PNGs and an image store under the OS
temp folder and delete them. They use only node built-ins and vitest, and type-check under the root
`tsconfig.json`'s strict options with `allowImportingTsExtensions` and `noEmit` (checked with a copy of the
options outside the repo whose `include` is this folder: `tsc -p` exits 0). A run with `--root
tests/acceptance/373` leaves Vitest's cache in `tests/acceptance/373/node_modules/.vite`; delete it, it is not
part of the suite. `BASE-FAILURE.txt` is the run at the base: every test fails there, because
`deep-canvas-render` has no `raster` or `geometry` subcommand (it exits 2 with its usage line); the two tests
that reach the check first fail on the base check's `unknown_field` for an item's `adjust`.

Every test runs on every platform: Vello CPU needs no GPU. The design's "on the reference build" is read as
the build these tests run against; the run that counts as proof is the one on the reference Mac, but nothing
here is skipped or INCONCLUSIVE elsewhere.

## The surface under test

The issue names no code API, so these tests extend #391's and #392's proof surface, the `deep-canvas-render`
binary (`target/debug/deep-canvas-render`, crate `crates/deep-marks-render` at the base), with two
subcommands, and read two it has (`check`, `look`). Nothing else is read. #391's JSON-lines convention holds
unchanged: one JSON object in per stdin line, exactly one out per line, in order, exit 0; a line that isn't
JSON, lacks a required field or names an unknown `planted` value answers `{"ok": false, "code": "bad_input"}`
with no panic. Every refusal is `{"ok": false, "code": string}`. Everything #391's and #392's READMEs define
for `frames`, `session`, `render`, `check` and `look` stays as it is.

### `deep-canvas-render raster` (every platform)

Input `{"out": path, "doc": Document, "look": look, "view"?: {"zoom": 1, "theme": "light"}, "t"?: 0,
"states"?: {handle → state}, "store"?: dir, "planted"?: "arc_closed_along_chord" | "mask_encoded_luma"}`.

- It runs the document check first, as `check` does with this look. A document the check refuses is never
  drawn: the answer is `{"ok": false, "code": <the code of the check's first error>, "issues": [...]}` (the
  tests' refused documents each hold one error code). A look the status guard refuses answers its refusal,
  as `render` does (#392).
- Otherwise it draws the view at `t` at scale 1 with Vello CPU (`vello_cpu`, its f32 pipeline at the scalar
  SIMD level: the 2D renderer decision row's configuration for goldens and snapshots) and writes `out` as an
  8-bit RGB or RGBA PNG, no interlace, exactly the document's `size` (× zoom; the tests use zoom 1). Output
  `{"ok": true, "width", "height", "offscreen": n}`, `n` the number of offscreen passes the frame drew
  through (Vello layers pushed for clips, masks and isolated groups; Mask: "a rect mask is a scissor, and any
  other shape renders through one offscreen pass").
- `look`, `states` and `store` are as in #391's and #392's `render`: a role map `{light: {role → [r, g, b]}}`,
  a shipped look's ID (`"clean"`) or a look@1; the record's state per status binding's source (a handle no
  binding names is ignored); the content-addressed store images are read from by sha256.
- The planted values are the criteria's wrong programs, reachable only through this field and only for this
  proof; nothing else reads them:
  - `arc_closed_along_chord` (criterion 5): a filled arc closes along its chord, from the arc's end straight
    back to its start, instead of through the centre or along `inner_r`.
  - `mask_encoded_luma` (criterion 6): a luminance mask takes its coverage from the encoded (sRGB) luma of
    its paint instead of linear light.

### `deep-canvas-render geometry` (every platform)

Input `{"doc": Document, "item": ID, "look"?: look}`. Runs the check first and answers a refused document as
`raster` does. Output `{"ok": true, "subpaths": [{"closed": bool, "verbs": [verb], "points": [[x, y]]}]}`:
the item's outline as marks2d builds it before flattening (Path: verbs M, L, Q, C, Z), in document u, y down,
the item's transform applied: one point per M and L, two per Q, three per C, none for Z; `closed` is true
when the subpath ends with Z. A star's vertices are its M and L points in path order (with no roundness its
path holds only M, L and Z); a last point that repeats the first is read as the closing point, not a vertex.

### `check` and `look` (as at the base)

`check {"doc", "look"}` answers `{"ok", "issues": [{check, code, severity, ids, path, actual, what, fix}]}`
(What holds a document to its rules). The tests read the errors' codes, `ids` and `path`, and for the status
distance whether the role is named in the issue outside `what` and `fix` (an agent branches on data, never
on message text). `look {"look": "clean"}` gives the clean look, whose status colors (`"#rrggbb"`, the base's
notation; `[r, g, b]` is also read) and roles the status tests compute with.

### Documents

The design's envelope and items, as #391's and #392's READMEs write them (`{id, kind, layer, name, order,
params, parent?, adjust?}`, 2D in u, y down, a paint naming look roles), with these kinds and fields:

| Kind | Params the tests use |
|---|---|
| `path@1` | `d`; `paint.stroke: {width, gradient: {kind: "linear", stops: [{at, role}] ≤ 8}}`, the gradient running from `w` to `e` of the item's box (the default) |
| `rect@1` | `box`; `paint.fill.gradient: {kind: "radial", stops, from: [0.5, 0.5], to: [1, 0.5], focal: {length, angle}}` |
| `star@1` | `center`, `points`, `outer_r`, `inner_r`, `polygon`, `paint` |
| `circle@1` | `center`, `r`, `inner_r`, `arc: {from, to}` (degrees), `paint.fill` or `paint.stroke: {role, width}` |
| `mask@1` | `shape: "rect"`, `box` (as at the base), `mode: "luminance"` with `paint.fill.role`, `applies_to: "children"` |
| `frame@1` | `box`, `overflow: "mask"`, `paint.fill` |
| `group@1` | `opacity` |
| `marks@1` | `mark`, `n`, `key`, `columns`, `encode`, `paint`, and `fit` for images |
| `scale@1` | `type: "linear"`, `domain`, `range`, `nice: false` |

- **Radial gradients.** A radial gradient's centre is `from` and its radius reaches `to`, both fractions of
  the item's box; on the tests' square box that is SVG's default radial gradient (cx, cy, r 50%). `focal`
  moves the focal point from the centre by `length` × r along `angle`; the tests use angle 0°, which points
  +x whichever way degrees turn.
- **Mark sets.** Columns are the base's form: `{dtype, len, data}` with `data` base64 of little-endian values
  (f32 coordinates, u32 keys), or `{const: value}`; `encode` maps each property to `{column, scale?}`. Every
  set has a `key` column of unique u32 keys. Rows, by mark (`x`, `y`, `x2`, `y2` in u unless a scale maps
  them): `point` a circle of diameter `size` at (x, y) (as at the base); `rule` a line from (x, y) to (x2, y2)
  of width `size` (as at the base); `rect` the rect from (x, y) to (x2, y2); `bar` the rect from x to x2 and
  from its y scale's zero to y (a bar starts at zero); `path` one polyline through the rows in row order, drawn
  by `paint.stroke`; `area` the region between that polyline and its y scale's zero; `symbol` a symbol of
  `size` centred on (x, y), any shape; `text` the text `text` at (x, y) in size `size`; `image` the image
  `asset` (a sha256 in the store) filling the box from (x, y) to (x2, y2), with `alt`.
- **The adjust** is an item field: `{contrast, exposure, gamma, invert}`, beside the existing ones.
- **Status** is as in #392: a `rect@1` with no paint whose fill a status binding gives, the clean look by
  ID, and `states` pinning its verdict to `pass`.

## Fixtures

Written by this job before any implementation ran (`fixtures/parity/2d/`, one per mark this task ships, the
Proof line's "goldens of each mark"; the expected values are analytic and computed in the tests):

- `stroke-gradient.figure`: the stroke `M 20 40 L 532 40`, 24 u wide, with stops `grad.a` (20, 60, 220),
  `grad.b` (240, 240, 230) at 0.5 and `grad.c` (210, 40, 20); and a 384 u square at (20, 80) with a radial
  gradient from `rad.from` (60, 80, 130) to `rad.to` (200, 180, 120), focal `{length: 0.4, angle: 0}`.
- `star.figure`: `star5` (5 points, radii 100 and 40), `hexagon` (6, polygon, radius 100), `star55` (5.5
  points, 100 and 40) and `burst` (100 points, 200 vertices, the most a star may have).
- `arcs.figure`: `sector` (r 100, arc 0°–90°, filled ink), `ring` (the same with `inner_r` 50) and `open` (the
  same arc, no fill, stroked 4 u in ink), centred 256 u apart.
- `adjust.board` (clean look): a status mark bound to a verdict, so status can show, and four swatches with
  `contrast` 1.5 on ink, `gamma` 2 on muted, `invert` on ink and `exposure` 1 on muted, none near a status
  color.
- `masks.board` (clean look): a luminance mask (paint `muted`) over the status mark and a plain ink rect, and
  four nested rect masks over one rect.
- `marks.figure`: nine mark sets side by side in 100 u bands, one per mark type, three keyed rows each; the
  bars and the area through the scale `ys` (domain 0–100 onto 220–20 u, zero at 220 u); the image rows show
  `fixtures/assets/swatch.png`, a 4 × 4 PNG of (200, 30, 160), by its sha256.
- `groups.figure`: a frame (background `frame.bg`) whose rect mask clips a bar that overflows it, and a group
  at opacity 0.5 over two overlapping ink rects.

Each fixture's planted-fault twin is the fixture with one fault planted, written in `parity.test.ts`:

| Fixture | Planted fault | Its code | Named |
|---|---|---|---|
| stroke-gradient | the middle stop names `status.pass` | `status_color_unbound` | `stroke-ramp` |
| star | `burst` with 100.5 points: ⌈100.5⌉ × 2 = 202 vertices | `out_of_range`, at `items/burst/params/points` | `burst` |
| arcs | the sector's fill names `status.fail` | `status_color_unbound` | `sector` |
| adjust | `muted-exposed` at exposure −1, which brings muted within 0.10 of the idle status color | `status_distance` | `muted-exposed`, and the role `muted` |
| masks | a fifth nested mask `m5` | `mask_depth` | `m5` |
| marks | the rect set's keys `[1, 1, 3]` | `key_not_unique` | `set-rect` |
| groups | the group's parent is its own child | `cycle` | `veil` |

## Criteria to tests

Each test's name starts with its criterion's ID. Where a criterion names a wrong program, the test shows the
check fails on it.

| ID | Criterion (the issue's text) | Tests, and the wrong program each fails on |
|---|---|---|
| AC1 | A gradient stroke's color at 32 sampled arc lengths matches its OKLab ramp within one code value, a focal radial gradient matches the two-point form SVG defines, and a stroke naming a status role is refused | `stroke.test.ts`: at the centres of columns 28, 44, …, 524 (arc lengths 8.5 to 504.5 u) on the stroke's centre row, and on its top and bottom rows, every pixel within one code value of the stops' OKLab ramp at s ÷ 512 (Ottosson's matrices and the sRGB curve, in f64); the same stops mixed in encoded sRGB fail that check at more than 8 of the 32. 576 pixels of the focal disc within one code value of the ramp at SVG's two-point t (focal point F, centre C, radius r: the largest t with \|P − F − t(C − F)\| = t r); a radial that ignores its focal point fails at more than 50. The stroke over data roles passes the check; with a stop on `status.pass` its only error is `status_color_unbound` naming `stroke-ramp` at its stroke, and `raster` refuses it |
| AC2 | star@1 with 5 points is a closed path of 10 vertices matching its closed form within 0.01 u, a polygon with 6 points is a regular hexagon, 5.5 points closes on a half spike, and a star past 200 vertices is refused | `star.test.ts`: `geometry` of `star5` is one closed M/L path of 10 vertices, vertex k at −90° + 36° k, radius 100 or 40 alternately, within 0.01 u; `hexagon` 6 corners at radius 100, 60° apart from straight up, every side 100 u; `star55` 12 vertices at 180° ÷ 5.5 apart, its last straight up at the inner radius (550, 70) and its first at the outer (550, 10), so it closes along the radius on a half spike (a count that floors to 10 vertices, or rounds, fails); `burst` at 100 points has 200 vertices and passes, at 100.5 the check's only error is `out_of_range` naming `burst` at its points, and `geometry` and `raster` refuse it |
| AC3 | adjust with contrast 1, exposure 0, gamma 1 and invert false changes no pixel, exposure 1 doubles linear light within one code value, and wherever status can show, an adjust that brings a role the item uses within the status distance is refused naming the role | `adjust.test.ts`: six fixtures drawn as they are and with that adjust on every drawn item but a status mark (which no adjust may reach) are equal byte for byte (an adjust that round-trips colors through 8-bit linear light, or applies any channel at identity, fails). Eight swatches at exposure 1 within one code value of their role with linear light doubled, the unadjusted ones exact (doubling encoded values fails). In `adjust.board` (status shown) the swatches pass; muted at exposure −1 is refused, its only error `status_distance` naming the item at its adjust and the role `muted` as data, and `raster` refuses it; the same document with no status binding passes (a check that refuses every adjust fails). The test first computes from the clean look that muted at −1 is within its `min_distance` of a status color and at +1 is not |
| AC4 | The 2D marks this task ships render bit-identical Vello CPU rasters on the reference build, and each of their parity fixtures has a planted-fault twin that fails with its exact issue code | `parity.test.ts`, per fixture: the check passes it; two processes draw the same RGBA bytes, a third draws them again on its first line and again on its second (a raster seeded by the clock, a per-process hash order, or a cache that changes what it draws, fails), and it draws more than 200 non-ground pixels; its twin's errors hold exactly its code, name the planted item, and `raster` refuses the twin with that code. The marks fixture: each of the nine mark types draws its rows where they are in their role (19 covered samples exact, 8 empty ones the ground, the text band holding at least 60 pixels of its role); the rect set's rows and the same rects as `rect@1` items are a reftest pair, equal byte for byte and exactly 6,000 pixels. The groups fixture: the frame's background, its child masked past the frame's edge, and the half-opacity group's overlap drawn as each rect alone (one offscreen pass, not two blends), about 127.5 |
| AC5 | A filled circle@1 with r 100 u and `arc {from: 0, to: 90}` covers the sample 50 u out along 45°, and its area is 7,854 u² within 0.5%; a twin closed along the chord covers 2,854 u², misses that sample, and fails. With `inner_r: 50` the sample 25 u out is empty. With no fill, no stroked pixel lies within 40 u of the centre | `arc.test.ts`: the sample is ink and the sector's coverage sums to 7,854 u² ± 0.5%; the twin `arc_closed_along_chord` sums to 2,854 u² ± 0.5%, its sample is the ground, and the sector's check fails on it twice; the ring sector's samples 25 u out are the ground and 75 u out ink; no pixel centre within 40 u of the open arc's centre is drawn, and the stroke at 45° on the arc is (a stroke closed through the centre fails) |
| AC6 | A luminance mask of sRGB 0.5 gray covers 0.214 within 1/255, a rect mask is a scissor with no offscreen pass, a fifth nested mask is refused naming the item, and a mask over a status mark leaves its pixels exact; a planted mask that reads encoded luma covers 0.5 and fails | `mask.test.ts`: a luminance mask painted code 128 covers ink with 0.214 ± 1/255, the same everywhere in its box, nothing outside; the planted `mask_encoded_luma` covers 128/255 ± 1/255 and fails the check. A rect mask cuts the ink exactly at its box with `offscreen` 0, while the luminance mask reports at least 1. Four nested masks clip to m4's box; a fifth is refused, its only error `mask_depth` naming `m5`, and `raster` refuses it. Under the luminance mask the status mark's 96 × 24 box is byte for byte as with no mask, its most common pixel the clean look's pass color, while the plain rect beside it is masked |

The bad_input convention is checked once for each new subcommand (`parity.test.ts`).

## Readings where the issue and design leave a choice

- **One binary, two subcommands.** The design's goldens and snapshots render with Vello CPU, so the raster
  joins `deep-canvas-render`, which already links the 2D marks, the text module and the look (and `deep-text`
  links `vello_cpu` 0.3); it answers on every platform. `geometry` exists because the star criterion is
  about vertices, which pixels can't show within 0.01 u.
- **"Bit-identical … on the reference build"** is read as three relations that need no golden blessed in
  advance (a golden's first blessing needs a fixture whose value was set outside the implementation, the
  parity suite): the same build draws each fixture to the same bytes in separate processes and twice in one;
  a reftest pair that must draw the same does (Differential and metamorphic checks, plus reftests); and each
  fixture's analytic checks in the criteria's tests are its first oracle. Which build is the reference build
  is the run's, not the test's.
- **"A planted-fault twin that fails with its exact issue code"** is read as the parity suite's twin of a
  fixture: the document with one fault planted, which the check refuses with exactly that code, naming the
  item ("a deliberately broken fixture reports exactly its … planted faults"). The faults are those the
  marks' "It can never" lines and the issue name. Codes: `status_color_unbound`, `out_of_range` and `cycle` are
  the base check's; `status_distance` is the base look guard's code for a data role within the status
  distance, reused for an adjust that brings one there; `mask_depth` is the base renderer's code for a mask
  past four deep, now the check's; `key_not_unique` is this suite's (the design names none; Mark set: "key:
  … unique and stable"). The star's 200-vertex limit is read through its range (Star: points 3 to 100;
  Item and kind: outside min and max is an error), so 100.5 points is `out_of_range` at its points.
- **Which way degrees turn.** The design doesn't say whether 2D angles turn toward +y or −y. The star's
  vertices and the arc's 45° samples are accepted either way, mirrored, as long as one way holds throughout.
- **"A fractional count closes on a partial spike"** is read as the same closed form for every count:
  ⌈points⌉ × 2 vertices 180° ÷ points apart, so 5.5 points places its twelfth vertex straight up at the inner
  radius and closes along the radius, the top spike drawn half.
- **Coverage from pixels.** 2D composites in sRGB-encoded space (canvas core: Conventions; Paint), so a
  pixel of ink over white reads its coverage as (255 − value) ÷ 255. The sector's and segment's areas, the
  luminance mask's 0.214 and the group's 127.5 are read that way. sRGB 0.5 gray is code 128 (0.502), whose
  linear light, 0.2159, is within 1/255 of the criterion's 0.214; encoded luma gives 0.502.
- **"Within one code value"** is each channel within 1 of the expected value before rounding, computed in f64
  (Ottosson's OKLab, the sRGB curve). Vello is handed the ramp as sRGB-encoded stops within 0.001 ΔEOK
  (Conventions), well inside that. The samples are pixel centres.
- **"A rect mask is a scissor with no offscreen pass"** is read from the raster's own `offscreen` count, as
  #391 read GPU work from the renderer's counters, and from its pixels: the ink stops exactly at the box. The
  luminance mask's count keeps the counter honest.
- **"Wherever status can show"** is read as a document with a status binding (The status-color rule); the
  same adjust in a figure with none passes. "Naming the role" is read as the role's name as a value in the
  issue (in `actual` or a field of its own), not only in its message.
- **"Leaves its pixels exact"** is read as the status mark's box drawn byte for byte as with no mask, its fill
  the look's status color (Mask: "It can never: Hide a status color"; masks apply before status colors).
- **Mark-set rows** for bars, paths, areas, symbols and images aren't spelled out in the design beyond their
  names; the readings above (bars from zero, a path and an area through the rows in order, a symbol of any
  shape) are the plainest, and the samples sit where any of them must draw or must not.

Not tested, because no criterion asks: taper and wave (R6), sweep gradients, roundness, `polygon` refusing
`inner_r`, more than 8 stops, hairlines under 1 device px, contrast, gamma and invert values (only their
identity), the fixed order of the adjust channels, alpha and feathered masks, mask `combine` and `invert`,
`rows_of`, table and logic columns, encodings through palette-role scales, and the 1M-row limit.
