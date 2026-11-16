# Acceptance tests for #1935: the loop's mesh readings: UV sets, hidden faces, stray vertices and islands in geometry.shading

These tests were written before any implementation existed. The writer had issue #1935 (its scope, its Fields line,
its three acceptance criteria and its proof line: "The UV-set, hidden-face and island fixtures with their readings,
and each planted reading failing, with the issues as data"), its Oracle page, its parent #455, #453 (closed: the
check this extends), the design sections below, and base commit `9b77cd2cd` ("Merge pull request #2438 …"). The
Oracle page says no upstream test checks any criterion, so this suite ports nothing.

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job
(design: Dogfooding). The suite is lean: one file and one test per criterion, the planted reading criterion 1 names
asserted inline in criterion 1's test.

**Not run against a binary.** The machine is shared and was loaded (one-minute load about 200), so no Rust was built
and the suite wasn't run at the base. `BASE-FAILURE.txt` says why each test fails there, read from the base's code.
The type-check passes. A scratch script outside the repo (not kept) ran the fixture generators and checked every
number below from the f32 values the files hold.

## What was read

- Issue #1935, its Oracle page (`doneright/oracles/issues/1935.md`), #455 and #453.
- `docs/canvas-primitives.md`: Check input: loop kinds (`geometry.shading {normals, uv_when: map | always = map,
  stretch_max: 0.25, texel: [px/m, px/m] (optional), degenerate, manifold}`), its shading defects and quad ratio
  sections; Attribute and field: geometry measures ("occlusion … from 32 fixed directions", "a fixed, hash-seeded
  direction table"); Builder: uv ("It can never: … check uv0 for overlaps (tiling is allowed)"; uv1 for bakes from
  the unwrap job); Asset job's `unwrap {uv: uv1, texel_density, padding: px = 4, resolution: px, …}`; What holds a
  document to its rules (issues as data: `{check, code, severity, ids, path, actual, t, what, fix}`); Check input.
- `docs/technical-design.md`: Document check, Criteria to tests both ways (`#<issue>.<h8>`), Wrong programs,
  Dogfooding, Proven on the base.
- At the base: `AGENTS.md`; `tests/acceptance/453/` (README, helpers, glTF writer, `defects.test.ts`,
  `quad-ratio.test.ts`) and `tests/acceptance/1936/` (README, the tag constants, the inline plant);
  `crates/deep-show/src/main.rs` (the scenario's `planted`), `crates/deep-show/src/verdict.rs` (the row, `results`,
  `raised_json`), `crates/deep-canvas-loop/src/lib.rs` (`report`, `PLANTED`), `crates/deep-canvas-loop/src/count.rs`,
  `crates/deep-canvas-scene3d/src/gltf.rs` (`primitives`), `crates/deep-show/src/kit/manifest.rs` (`CHECK_KEYS`),
  `scripts/proof-change.mjs` (`criterionId`, `spans`) and `scripts/lanes.mjs`.

Code was read only to learn the surface. Every expected value comes from the issue, the design and each fixture's
own geometry.

## What the base already does

- `geometry.shading` is the loop module's (#453): on every `mesh.asset@1` item of a deliverable it reads the glTF
  from the evidence store and reports, per item, one object in the row's `results`: `welded_vertices`, `triangles`,
  the six defect counts, `ids`, `signed_volume`, `quad_ratio`, `unpaired`. It reads positions, normals and indices
  only; no UV set, no hidden face, no unused vertex, no island.
- Its check input is read for `weld`, `degenerate_area`, `pair`, `quad_min` and `normals`; every other key passes
  through unread.
- A scenario's `planted` names one wrong program from a closed list (`deep_canvas_loop::PLANTED` among others); any
  other name refuses the scenario as `bad_input`.

## Run them

Every file builds `deep-show` with cargo, so they run one file at a time.

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/1935 --no-file-parallelism
npx tsc -p tests/acceptance/1935/tsconfig.json   # type-check
rm -rf tests/acceptance/1935/node_modules/.vite
```

Each file first runs `cargo build --locked --bin deep-show --no-default-features --features full`, copies the binary
out of `target/` (honoring `CARGO_TARGET_DIR`), and fails each test whose build failed. A test that can't decide here
(cargo can't run) fails with a message starting `INCONCLUSIVE:`; it never passes. Every test writes its glTF files
into a fresh evidence store in a temporary folder and deletes it. Node built-ins and vitest only; nothing binary is
committed. `tsconfig.json` is #453's, unchanged.

### Lanes

The implementer adds this to `scripts/lanes.mjs`; this job edits nothing outside its folder.

```js
// #1935's files each build deep-show.
alone.push('tests/acceptance/1935/');
```

## The surface under test

**No new binary and no new call.** The suite drives `deep-show run` (one scenario line in, one answer line out) as
#453's suite does: a stored scene document per case holding one `mesh.asset@1` item, `asset`, whose GLB sits in the
scenario's evidence store by SHA-256 (node 0); a claim per case whose one requirement is the check input below; and
`{"call": "verdict", "claim"}`. Names the issue gives are kept exactly; every other name is this job's, listed again
under Names. An implementation builds exactly these, or disputes them.

### The check input, per test

| Test | Check input |
|---|---|
| criterion 1, both cases | `{kind: "geometry.shading", uv_when: "always", resolution: 1024, uv_overlap_max: 0}` |
| criterion 2, half texel density | `{kind, uv_when: "always", resolution: 1024, texel: [480, 560]}` |
| criterion 2, lower-left quarter | `{kind, uv_when: "always", resolution: 1024, padding: 4, uv_fill_min: 0.6}` |
| criterion 2, 2 px and 6 px apart | `{kind, uv_when: "always", resolution: 1024, min_gap_px: 4}` |
| criterion 3, all four cases | `{kind: "geometry.shading"}` |

`resolution` (px, the issue's "rasterized at `resolution`" and "at 1,024 px") and `padding` (px, the issue's "with
`padding` dilation", the unwrap job's default 4) are passed explicitly. `uv_when: "always"` is the design's own value,
passed because no fixture has a material that uses a map. `uv_overlap_max`, `uv_fill_min` and `min_gap_px` are the
issue's threshold names; the issue and design give them no default, so these tests read a threshold as deciding only
when the check input gives it, as `texel` (optional) does.

### The result: one object per item, as #453 has it, gaining

```json
{"doc": …, "item": "asset", …#453's fields…,
 "uv": {"uv0": UvSet, "uv1": UvSet},
 "hidden_faces": u32, "unused_vertices": u32, "islands": u32, "smallest_island_share": f64,
 "ids": {…#453's lists…, "hidden_faces": [FaceID]}}

UvSet = {"uv_flipped": u32, "uv_overlap": f64, "out_of_unit": f64, "uv_fill": f64,
         "min_gap_px": f64, "texel_p5": f64, "texel_p95": f64,
         "ids": {"uv_flipped": [FaceID], "uv_overlap": [ChartID], "out_of_unit": [ChartID],
                 "min_gap_px": [ChartID], "texel": [ChartID]}}
```

- The new readings sit inside the item's one result, beside #453's, so #453's suite, which finds a result by its
  `item`, still finds one. `uv` has one key per UV set the mesh carries: `uv<n>` for `TEXCOORD_<n>`.
- Each `ids` list names up to 64 charts or faces, each once. `ids.uv_overlap`: the charts that share covered area
  with another chart. `ids.min_gap_px`: the charts that lie closer than the check's `min_gap_px` to another chart.
  `ids.texel`: the charts whose texel density lies outside `texel`.
- `smallest_island_share`: the smallest island's area over the mesh's area.
- The tests read `uv.uv1.uv_overlap`, `uv.uv1.uv_fill`, `uv.uv1.min_gap_px`, `uv.uv1.ids.uv_overlap`,
  `uv.uv1.ids.min_gap_px`, `uv.uv1.ids.texel`, `hidden_faces`, `ids.hidden_faces`, `unused_vertices`, `islands` and
  `smallest_island_share`. The other members are the issue's readings, named here so the shape is whole; no test
  reads them.

### A failure, as issues as data

A threshold a reading breaks makes the requirement `FAIL` with an error issue on the item (`ids` holding `asset`)
whose `code`, `what` or `actual` contains the reading's name: `uv_overlap`, `texel`, `uv_fill` or `min_gap_px`. No
test reads which code. (The kit at the base admits only `kind, probe, at_times, expect, tolerance, except, render,
sweeps, declared_cuts` in a fixture's check input, so a code raised only under a threshold can't have a kit fixture of
its own; one code for the UV readings, naming the reading, is enough for these tests.)

### Names

- **FaceID** `"<primitive>:<triangle>"`, #453's: the triangle's index in its primitive in file order.
- **Chart**: the triangles of one primitive joined through edges whose two ends have the same UV in that set. Every
  chart here is one flat sheet sharing its own vertices, and no two sheets share a vertex or touch in 3D, so any
  reading of "chart" gives the same charts.
- **ChartID**: the FaceID of the chart's first triangle in (primitive, triangle) order. Here: the overlap and gap
  pairs `0:0` and `0:2`; the L pair `0:0` and `0:6`; the four texel sheets `0:0`, `0:2`, `0:4`, `0:6`.
- **The plant**: `uv_overlap_from_boxes` (below).

## The planted program (the scenario's `planted`, reachable only there)

| Name | The wrong program | Criterion |
|---|---|---|
| `uv_overlap_from_boxes` | `uv_overlap` computed from each chart's bounding box in place of its triangles; everything else as shipped | `#1935.ac062d91` |

The implementer adds it to `deep_canvas_loop::PLANTED`, which `crates/deep-show/src/main.rs` already reads, and to
`report`. No Cargo test feature is needed: every test builds `full`.

## Fixtures (gltf.ts)

Written as GLB at test time: one node, one triangle primitive. The UV fixtures are flat sheets in z = 0 facing +z
(`NORMAL` (0, 0, 1)), wound counter-clockwise in 3D and in both UV sets, one chart per sheet, sheets 1 m or more apart
in 3D. Each set maps a sheet without stretch at one density (px/m, at 1,024 px); every UV corner is a whole pixel, so
f32 holds it exactly. Each fixture writes `TEXCOORD_0` and `TEXCOORD_1`, and its uv0 is laid out cleanly (no overlap,
inside [0, 1], 80 px or more between charts, every chart at one density, 520 px/m in the texel fixture) and unlike its
uv1, so a reading taken from uv0 fails each test. "Lower-left" is UV space's own: u and v in [0, 0.5]. The closed meshes have no normals and no UV set.
Below, px are pixels of the 1,024 px square.

**Criterion 1, `overlapPair`.** Two 520 × 800 px charts (1.015625 × 1.5625 m sheets at 512 px/m), uv1 from x = 112
and x = 392, both from y = 112. They share a 240 px strip. The issue defines `uv_overlap` as the share of covered
area two or more charts cover: covered = (2 × 520 − 240) × 800 = 800 × 800 px², covered twice = 240 × 800 px²,
share = 240 ÷ 800 = 0.3. In general two equal W-wide charts sharing o give o ÷ (2W − o), so 0.3 needs o = 6W ÷ 13:
W = 520, o = 240. ("30% of each chart under the other", o = 0.3W, would read 0.3 ÷ 1.7 = 0.18, so it isn't the
fixture whose reading is 0.3.) The edges are on pixel boundaries, so a raster at 1,024 px reads 0.3 exactly; even
4 px of dilation on both would read 248 ÷ 808 = 0.307. uv0: 260 × 400 px at 256 px/m, 124 px apart.

**Criterion 1, `lPair`.** Two L charts at 512 px/m, each three rectangles meeting along whole edges. L1: its corner
[64, 448]², arms [448, 960] × [64, 448] and [64, 448] × [448, 960]. L2: its corner [704, 960]², arms
[480, 704] × [704, 960] and [704, 960] × [480, 704]. L2 sits in L1's notch, 32 px from it at the nearest (L1's arms
end at 448, L2's begin at 480), so they don't touch and share no pixel: true overlap 0. Bounding boxes: L1 [64, 960]²,
L2 [480, 960]², inside L1's, so the plant finds 480² ÷ 896² = 0.287 of the boxes' union covered twice (or
230,400 ÷ 720,896 = 0.32 of the true covered area). uv1 fill is 720,896 ÷ 1,024² = 0.69. uv0: the two at 256 px/m,
L1 in [32, 480]², L2 in [720, 960]².

**Criterion 2, `texelQuad`.** Four 0.5 m square sheets, each a quarter of the mesh's area; their uv1 one per quadrant
from (64, 64), (576, 64), (64, 576), (576, 576) px. Texel density = resolution × √(UV area ÷ surface area) =
1,024 × (side in UV) ÷ (side in m): three at 260 px ÷ 0.5 m = 520 px/m, inside [480, 560]; sheet 2, chart `0:4`, at
130 px ÷ 0.5 m = 260 px/m, half of 520 and under 480. So `0:4` is the one chart out of band. Area-weighted, it holds
25% of the area, so `texel_p5` is 260 and `texel_p95` 520 (not asserted). uv0: all four at 520 px/m.

**Criterion 2, `lowerLeftQuarter`.** One 1 m square sheet whose uv1 is [0, 512]² px at 512 px/m: 0.25 of the unit
square. Dilated by `padding` 4 px and kept inside the unit square, it grows along its top and right sides only:
516² ÷ 1,024² = 0.2539 (round dilation 0.2539 too). Dilated on all four sides and not clipped: 520 × 520 ÷ 1,024²
= 0.2579. Either is 0.25 ± 0.01, and under 0.6. uv0: [64, 960]² at 896 px/m, fill 0.77, above 0.6.

**Criterion 2, `gapPair(gap)`.** Two 440 × 896 px charts at 512 px/m (0.859375 × 1.75 m sheets), side by side in
uv1, `gap` px apart, the pair centred: the left from x = (144 − gap) ÷ 2. 2 px: [71, 511] and [513, 953], 2 < 4, so
it fails and names both. 6 px: [69, 509] and [515, 955], 6 ≥ 4, so it passes. Each uv1 fills 0.75, its charts are
inside [0.0625, 0.9375] and at one density, so nothing else in it can fail. uv0: [32, 472] and [552, 992], 80 px apart.

**Criterion 3, `boxInBox`.** A closed 2 m cube about the origin (vertices 0–7, triangles 0–11, wound outward) and a
closed 1 m cube about the origin inside it (vertices 8–15, triangles 12–23). Every ray from the inner cube meets the
outer cube first, so its 12 triangles are hidden: `0:12` … `0:23`. Every outer face has its outward half of
directions free to the bounding sphere, so none of the outer 12 is hidden.

**Criterion 3, `cup`.** A square cup open to +Y (glTF's up): outside 2.5 × 0.5 × 2.5 m, a cavity 2 m wide and 0.25 m
deep, walls and floor 0.25 m thick; 16 vertices, 28 triangles, closed, wound outward (signed volume 2.5² × 0.5 −
2² × 0.25 = 2.125 m³). Triangles 18–27 are its inner walls and floor, facing into the cavity. Proportions: the cavity
is eight times as wide as it is deep, so from any point of an inner wall or the floor almost every direction that
rises into the cavity leaves through the open top. Checked in scratch with the triangles' centroids as the only
sample points: a 32-direction spiral table hides no face; of 2,000 tables of 32 uniformly random directions, 5 left
one inner face with no direction out, each a table with no direction in some quarter of the sphere. A cavity as deep
as half its width failed 16 of 2,000 such tables.

**Criterion 3, `strayCube(true)` and its twin `strayCube(false)`.** The unit cube (vertices 0–7, triangles 0–11,
6 m²). With `true`, also 10 vertices no triangle uses (8–17, at (−2, 0, 0.1k), 0.1 m apart) and a triangle 2 mm wide
and 1 mm high, 0.002 × 0.001 ÷ 2 = 1 mm², 2 m above the cube, touching nothing (vertices 18–20, triangle 12). So
`unused_vertices` 10, `islands` 2 (stray vertices are in no island), and `smallest_island_share` = 1e-6 ÷ (6 + 1e-6)
= 1.6667e-7, read within 1% (the f32 file gives 1.66655e-7, 0.007% off). The twin is the cube alone: 0 unused
vertices, 1 island.

## Criteria to tests

IDs are `#1935.` and the first 8 hex digits of the SHA-256 of each criterion's text, as `scripts/proof-change.mjs`
computes them: `- [ ] ` dropped, trimmed, and whitespace collapsed.

```sh
gh issue view 1935 --repo windoliver/deepbuild --json body -q .body | grep '^- \[ \]' | \
  node -e 'for (const t of require("fs").readFileSync(0,"utf8").split("\n").filter(Boolean)) console.log(require("crypto").createHash("sha256").update(t.replace(/^\s*- \[[ xX]\] /,"").trim().replace(/\s+/g," ")).digest("hex").slice(0,8))'
# ac062d91
# 4898a100
# aaf15575
```

Each file holds its criterion's ID as a string `const ID`, and its test's name starts with `${ID}`, so `spans` reads
it. Each file's header states its fixtures, numbers and wrong programs.

| ID | File (tests) | What it asserts |
|---|---|---|
| `#1935.ac062d91` | `overlap.test.ts` (1) | The pair laid 30% over: uv1 `uv_overlap` 0.3 ± 0.01, FAIL with an error naming uv_overlap, `ids.uv_overlap` exactly `0:0`, `0:2`. The L pair: uv1 `uv_overlap` 0, PASS. **Planted:** under `uv_overlap_from_boxes` the L pair's uv1 `uv_overlap` is above 0, and the L pair's assertion fails on it, naming uv_overlap. |
| `#1935.4898a100` | `texel-fill-gap.test.ts` (1) | Half density: FAIL with an error naming texel, uv1 `ids.texel` exactly `0:4`. Lower-left quarter: uv1 `uv_fill` 0.25 ± 0.01, FAIL with an error naming uv_fill. 2 px apart: uv1 `min_gap_px` under 4, FAIL with an error naming min_gap_px, `ids.min_gap_px` exactly `0:0`, `0:2`. 6 px apart: uv1 `min_gap_px` at least 4, PASS. |
| `#1935.aaf15575` | `hidden-islands.test.ts` (1) | Box in a box: `hidden_faces` 12, `ids.hidden_faces` exactly `0:12` … `0:23`. Cup: `hidden_faces` 0, `ids.hidden_faces` empty. Stray fixture: `unused_vertices` 10, `islands` 2, `smallest_island_share` 1.6667e-7 within 1%. Twin: `unused_vertices` 0, `islands` 1. |

## Readings where the issue and design leave a choice

- **"Laid 30% over each other"** is read through the issue's own definition of the reading it reports: the charts
  are laid so that 0.3 of their covered area is covered twice (Fixtures).
- **"Naming both charts", "naming the chart", "naming both"** are the reading's `ids` list in uv1's set, exactly
  those charts. The failure itself is the row's FAIL with an error naming the reading; no code is required.
- **"Fails `uv_overlap_max: 0`"** is the threshold in the check input; the L pair under the same input must PASS.
  uv0 "never fails on overlap" is not tested here: every uv0 is clean.
- **The plant "fails this test"**: the test asserts that the plant reports overlap above 0 on the L pair, so the
  test's own assertion on the L pair (0 and PASS) fails on it. Under the plant the 30% pair still reads 0.3 (two
  rectangles' boxes are the rectangles); the criterion asks no more.
- **"Half the others' texel density"**: three charts at 520 px/m, the band's middle, and one at 260 px/m, each a
  quarter of the area, so the area-weighted `texel_p5` falls on it as well as its own density.
- **"Packed into the lower-left quarter"**: one chart that is the quarter. Dilation by `padding`, clipped or not, keeps
  the reading within 0.01 of 0.25.
- **"2 px apart at 1,024 px"**: 2 ÷ 1,024 apart in UV, `resolution: 1024`. The test asserts the reading is under 4
  (2 px) or at least 4 (6 px), not its exact value, since a raster may read a 2 px gap as 2 or 3.
- **"Reports the inner box's 12 triangles as hidden, naming them"**: `hidden_faces` 12 and `ids.hidden_faces` those
  12 FaceIDs exactly, so no outer face. **"A cup's inner faces … are not hidden"**: no face of the cup is hidden.
- **"Reports both"**: `unused_vertices` 10, and the floating triangle as a second island whose share is the smallest.
  **"Its clean twin reports 0 and 1 island"**: `unused_vertices` 0 and `islands` 1.
- **Rows in criterion 3** are not asserted PASS or FAIL: the criterion asks for readings, and the issue gives no
  threshold for them.

## Not tested

No criterion asks for these, so none is tested: `uv_flipped`, `out_of_unit`, `texel_p5` and `texel_p95` as values,
uv0's exemption from overlap and out-of-unit failures, the 64-ID cap, `stretch_max`, `uv_when: map`, UV sets
generated or converted in, which issue code each reading raises and its fix, which stray vertices or which island's
faces are named, hidden faces over several primitives or items, a cylindrical cup, and costs.
