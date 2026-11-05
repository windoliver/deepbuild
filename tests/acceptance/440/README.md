# Acceptance tests for #440: Modeling steps — bevel, subdivision, normals, UVs in metres, analytic uv1, cage edges and convex hulls

Written first, from issue #440 (its scope, its five Fields blocks — Modifier: bevel, Modifier: subdivide, Modifier:
normals, Builder: uv, Builder `hull` — its eight acceptance criteria and its proof line), the design sections it
links and those they lean on, its oracle page, and base commit `15de8c5b` ("Merge pull request #1155 …"), by a job
that never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof);
a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- Issue #440 and its oracle page (`doneright/oracles/issues/440.md` in `DeepBuildAI/deepbuild`, branch
  `doneright`): upstream tests for 3 of 8 criteria (1, 2, 7), none runnable on our output: Blender's bevel operator
  and geometry-node bevel files, its CatmullClark / Crease2d / Crease3d subdivision modifier cases, which all need
  Blender, and Bevy's weighted-normal tests. Their method is ported, not their data: a bevel's vertex count follows
  from its params (AC1 holds the build to the count declared before it); Catmull-Clark with creases at two levels
  is compared with an expected mesh, counts included (AC2 holds the build to a reviewed Catmull-Clark reference
  with sharp creases and to the design's counts); Bevy's area-weighted normals inform AC1's reading that weighted
  normals keep a large face flat. AC3–AC6 and AC8 have no upstream test (the page says so).
- `docs/canvas-primitives.md`: Units and axes (28: metres, +Y up); Builders, recipes, looks and cameras (2766);
  Builder (2864: the builders and their params; "a vertex count computable from params … so an over-budget build is
  refused before it runs"); Builder `ball`: tessellation (2892: geodesic, `base`, `detail`); Builder `hull`: convex
  hulls (2910: `points` or `of`, one closed part `hull`, `hull.flat {item}`, exact predicates, "fanned from the
  corner that sorts first by (x, y, z)", V − E + F = 2); Builder: shading and Builder: uv (2965, 2981: `uv0`,
  `uv_scale`, "Every builder emits uv0 in meters, so a pattern or a texture map keeps one texel density"); Modifier
  (3685: generate modifiers, counts "computable from params"); Modifier: store (3702: `domain: point | face |
  corner`); Modifier: bevel (3718: "Bevel rounds only edges sharper than the angle … harden sets the bevel faces'
  corner normals so the large faces beside them stay flat-shaded"); Modifier: subdivide (3734: "faces = C × 4^(levels
  − 1) … V′ = V + E + F and E′ = 2E + C"); Modifier: normals (3750); Marks in 3D: mesh edges (4594: `all`, `quads`,
  `cage` "the quads of the mesh as its modifier stack left it before the first `subdivide`", counted on welded
  positions); and, for "the registered block count", Operator and read set (1116: "`parallel: fixed_blocks` … a
  block count its canvas module registers, never one taken from the machine").
- `docs/technical-design.md`: Modeling steps (1349); the parity suite (2544: our own documents, "a planted-fault
  twin for every fixture", expected values set outside the implementation, CPU references as reviewed test code);
  Dogfooding (2524); Tests written first (2555).
- At the base, to learn the call shapes only: `tests/acceptance/420/README.md` and `helpers.ts`, `tests/acceptance/
  441/README.md`, `helpers.ts` and `reference.ts` (the `geometry` call, builders as item kinds, the scenario's
  `planted`); `crates/deep-show/src/geometry.rs` (the reply: `declared.vertices`, `key`, `stack`, and the mesh's
  `positions`, `normals`, `indices`, `closed`, `parts` as triangle lists, `attributes` as point values, `uv0`;
  `estimate_only`); `crates/deep-canvas-scene3d/src/geom.rs` (each triangle's face, the mesh-edge rule),
  `builders.rs`, `stack.rs` and `spec.rs`.

## What the base already does, which these tests don't credit

`deep-show run` presents scene3d documents; the builders build with a box-projected uv0 in metres; the stack runs
`mod.array@1` (copies' parts suffixed `.<k>`), `mod.bevel@1 {width, segments}`, `mod.store@1` (point attributes),
and a `mod.subdivide@1` that splits each triangle into four at its edge midpoints; `geometry` answers builder items'
meshes and `estimate_only` counts; mesh-edge lines of kind `quads` and `all` draw on the GPU layer. There is no
Catmull-Clark, no creases, no bevel `shape`, `limit`, `angle`, `clamp` or `harden`, no `mod.normals@1`, no `uv0` or
`uv_scale` param, no `uv1`, no face-domain attribute, no named parts on a slab, no `hull@1`, and `cage` draws as
`quads`. So the tests define the surface below.

## Run them

Each file builds `deep-show` in the `full` set (`cargo build --locked --bin deep-show --no-default-features
--features full`, honouring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless
set), once, copies it out under its own name in a temporary folder, and fails each test if the build failed. So
they run one file at a time. `scripts/lanes.mjs` may need `'tests/acceptance/440/'` added to its `alone` list (the
one-at-a-time unit-lane line, which also takes the folder off the parallel line), as #420's and #441's are; this
README is the instruction, and the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/440 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/440/tsconfig.json
```

Each test writes its scenario's evidence store into its own temporary folder and deletes it. Node built-ins and
vitest only. A run with `--root tests/acceptance/440` leaves Vitest's cache in `tests/acceptance/440/node_modules/
.vite`; delete it. Every test is CPU only and runs anywhere; no criterion has a time budget. `BASE-FAILURE.txt` says
why the suite wasn't run at the base.

## The surface under test

The issue names the modifiers' and builders' fields, the hull's issue code and the planted programs, but no code
API. These tests define the smallest surface they need on the binary and call that exist, #420's `geometry` call on
`deep-show run`: **two new request fields** (`blocks`, `rotate_corners`), **new fields on builder rows** (`faces`,
`uv1`, `blocks`, face-domain `attributes`, `declared.points/edges/faces`), **mark.line@1 rows** (`segments`), a
refusal code, and planted names. Everything #420's and #441's READMEs define for `deep-show run` holds unchanged. No
new binary, no new call. Every name below the issue doesn't give is this job's invention.

### Documents

- `mod.bevel@1 {width: m, segments ≤ 8, shape: 0..1 = 0.5, limit: angle | parts | all = angle, angle: deg = 30,
  parts: [part], clamp: bool = true, harden: bool = true}`, as the issue gives it.
- `mod.subdivide@1 {levels ≤ 3, scheme: catmull_clark | loop | simple = catmull_clark, creases: {named part → 0..1},
  crease_angle, boundary, uv}`, as the issue gives it. A named part's crease applies to every edge of that part's
  faces; crease 1 is sharp at every level. (The issue's "edge set" form isn't used.)
- `mod.normals@1 {mode: weighted | by_angle = weighted, angle, weight: area | angle | both = area, keep_sharp}`.
- On every builder: `uv0: "natural" | "box" | "sphere" | {box: {size}} | {planar: {axis}} | {cylinder: {axis}}`
  (a bare string for the forms without fields; `axis` is `"x" | "y" | "z"`), and `uv_scale: m = 1`.
- `mod.store@1 {name, domain: face, type: f32, field}`: a face-domain attribute; the field is evaluated at each
  face's centroid (the mean of its corners). `field: distance` is the base's field, the distance from the item's
  origin.
- `hull@1 {points: [[x, y, z], …]}` or `hull@1 {of: ID[#part]}`, as the issue gives it.
- `slab@1` names its faces' parts: `top` (its upper face) and `side`, and may name others (such as `bottom`); every
  face is in exactly one.
- `mark.line@1 {edges: {of, kind: all | quads | cage}, width, size_space, paint}` as #420's.
- Documents reach `deep-show` as an agent sends them (`deep_show` from one session: no `id`, no `layers`).

### `deep-show run`: the `geometry` call gains `blocks` and `rotate_corners`

```json
{"call": "geometry", "doc": doc ID, "items": [ID], "t"?: time, "stage"?: …, "estimate_only"?: bool,
 "blocks"?: 1, "rotate_corners"?: k}
```

- `blocks: 1` runs every operator that splits its work into fixed blocks (`parallel: fixed_blocks`) at one block,
  one after another. Without it they run at the block count their canvas module registers.
- `rotate_corners: k` starts every face's corner list of each builder's output k corners later (mod its size)
  before the item's modifier stack runs: a metamorphic input, reachable only here, so a test can feed the stack
  the same faces listed from another corner.

### Builder rows gain

```json
{"faces": [face ID per triangle],
 "uv1": [[u, v] per position],
 "blocks": n,
 "declared": {"vertices", "points", "edges", "faces"},
 "attributes": {name → {"domain": "point" | "face", "type", "values"}}}
```

- `faces`: one face ID per triangle, in triangle order; the triangles of one quad or polygon share one (the base
  mesh's own `faces`, which #420's mesh-edge rule reads).
- `uv1`: one coordinate per position, from the builder itself for the builders with known charts (slab, lathe,
  extrude, plate, ball, tube).
- `blocks`: the block count the item's stack ran at (1 when `blocks: 1` was asked or nothing splits).
- `declared.points`, `declared.edges`, `declared.faces`: the welded points, the edges (a face's diagonals left
  out) and the faces of the item's final mesh, computed from its params as `declared.vertices` is, and given with
  `estimate_only` as well. `declared.vertices` stays #420's (the vertex count, splits included).
- An attribute of domain `face` holds one value per triangle, equal on the triangles of one face.
- `parts` stays the base's (part name → triangle indices); `uv0` stays one [u, v] per position.

### mark.line@1 rows

A `mark.line@1` item with `edges` named in `items` answers `{"id", "kind": "mark.line@1", "segments": [[[x, y, z],
[x, y, z]], …]}`: each segment it draws at t, by its two ends in world metres, as `deep-gpu`'s view3d `segments`
report them.

### Refusals at check

A hull of fewer than four points, or of points that span no volume, is refused when presented (`deep_show` outcome
`refused`) with an error issue of code `hull.flat` whose `path` is `items/<id>` or under it, so it names the item.

### `deep-show run`: scenario `planted` values added (each reachable only there)

| Value | The wrong program | Criterion |
|---|---|---|
| `quads_keep_diagonals` | A mesh-edge line of kind `quads` keeps each quad's diagonal (draws every triangle edge) | AC5 (issue-named) |
| `cage_reads_subdivided` | A mesh-edge line of kind `cage` reads the subdivided mesh (draws its quads) | AC5 (issue-named) |
| `hull_keeps_face_points` | `hull@1` keeps points that lie on a face (or an edge) of the hull as vertices | AC6 (issue-named) |
| `hull_fan_input_order` | `hull@1` fans each flat face from its first point in input order | AC6 (issue-named) |
| `subdivide_first_corner` | `mod.subdivide@1` orders each face's new edge points from the face's first corner, so a face listed from another corner subdivides differently | AC7 (issue-named) |
| `bevel_drops_wear` | `mod.bevel@1` drops the face attribute `wear` on its bevel faces (or entirely) | AC8 (issue-named) |
| `bevel_faces_unparted` | `mod.bevel@1` leaves its bevel faces outside every part | AC8 (issue-named) |

## Fixtures

| Fixture | What it is | Read by |
|---|---|---|
| `parity/geometry/uv0-metres.scene` | Six parts from 0.1 m to 4 m (three box-projected slabs, an L extrusion, a lathe cylinder projected around y, a slab at uv_scale 0.5), each part's density (1 ÷ uv_scale) and the 1% bound | AC3 |
| `parity/geometry/uv1-charts.scene` | One item per builder with known charts (slab, lathe vase with caps, extrude with a hole, plate grid, UV ball, tube on a bent path with caps), the collapse and overlap tolerances | AC4 |
| `parity/geometry/subdivide-cage.scene` | A 1 m slab box subdivided twice, three lines reading it as cage, quads and all, the expected 12/192/288 and 98/192/96, and the two twins with the names their failures must carry | AC5 |
| `parity/geometry/hull-cube.scene` | The cube's 8 corners (in (x, y, z) order), 100 interior points (mulberry32 seed 440, written out), 12 face points, the shuffle seeds, the expected values, the icosahedron ball and its volume, the four flat points, and the two twins | AC6 |

AC1's, AC2's, AC7's and AC8's documents are generated in their test files. The CPU references are `reference.ts`:
welding at 1e-6 m, edge topology, area and the divergence-theorem volume; a mesh's edges as `all` and `quads` read
them; the design's Catmull-Clark counts; Catmull-Clark positions with infinitely sharp creases; a triangle's UV
stretch (the singular values of its surface-to-UV map); 2D triangle overlap by separating axes; a seeded shuffle and
the check that it changes a fan; the icosahedron's volume; and the mesh hash and the welded-position and UV hash.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the
leading `- [ ] ` dropped (#607's command, as #305's README gives it, with the issue's eight criterion lines on
stdin). Each test's name starts with `AC<n> #440.<id>`. Where a criterion names a wrong program, the test runs it
through `planted` and asserts it fails the way the criterion says, naming what it says.

| ID | Criterion | Tests, what each asserts, and the wrong programs |
|---|---|---|
| AC1 `#440.f942298e` | A chair built with a bevel (shape 0.5, limited by a 30° angle, hardened) and weighted normals shows flat large faces and rounded edges, and its vertex count equals the bound computed from its params before the build | `chair.test.ts` (1): six slab parts with bevel then weighted normals; `estimate_only` builds nothing and each part builds exactly the vertices it declared; on each box plane the triangles in it cover the inset face (a − 2w)(b − 2w) within 1e-9 relative, their corner normals within 1e-3 rad of the face's; every vertex outside a corner patch is at the width from the box shrunk by it (a circular profile), each edge end has at least segments − 1 points strictly on its arc, and their normals are within 15° of the arc's outward direction. Wrong programs: a count known only after the build; a chamfer or a square profile; large faces shaded with their bevel's normals; a bevel that skips edges |
| AC2 `#440.d34ffa24` | A creased cube subdivided twice stays sharp along its creased edges and rounds elsewhere, with its vertex, edge and face counts known exactly before the build (Catmull-Clark turns an n-gon into n quads at the first level, then each quad into four) | `creased-cube.test.ts` (1): `estimate_only` builds nothing and declares 98 points, 192 edges, 96 faces (the design's formulas from 8, 12, 6, C = 24); the build has exactly those on welded positions; its points are the creased Catmull-Clark surface's within 1e-9 m, 25 of them on the flat top at y = 1, none above it, the lowest above y = 0. Wrong programs: midpoint or Loop subdivision; creases ignored or softened; counts from the build |
| AC3 `#440.c0ab6932` | uv0 in metres keeps one texel density across parts of different sizes, within 1% on a fixture | `texel-density.test.ts` (1): on every triangle of the six parts of `uv0-metres.scene`, both singular values of the surface-to-uv0 map equal 1 ÷ uv_scale within 1%. Wrong programs: uv0 normalized per part (0..1 across each); uv_scale ignored or inverted; a cylinder projection in radians or wrapped at its seam |
| AC4 `#440.c9e9574e` | Analytic uv1 on every builder with known charts has no overlapping charts, checked on fixtures | `uv1-charts.test.ts` (1): each of the six builders' items has a uv1 per vertex, every uv1 triangle has positive area, and no two triangles' uv1 interiors overlap. Wrong programs: uv1 = a box projection (opposite faces coincide); a collapsed chart; charts packed over one another |
| AC5 `#440.a93b61e0` | A slab box subdivided twice by Catmull-Clark draws 12 edge segments as `cage`, 192 as `quads` and 288 as `all`, with V − E + F = 98 − 192 + 96 = 2; a planted `quads` that keeps each quad's diagonal draws 288 and fails, and a planted `cage` that reads the subdivided mesh draws 192 and fails | `cage.test.ts` (3): cage draws the box's 12 edges before the subdivide, quads the mesh's 192 face edges, all its 288 triangle edges, each once on welded positions; the mesh has V − E + F = 98 − 192 + 96 = 2; `quads_keep_diagonals` fails naming `quads draws 288 segments`, `cage_reads_subdivided` naming `cage draws 192 segments` |
| AC6 `#440.7c557cc9` | A hull of a 1 m cube's 8 corners, 100 seeded points inside it and 12 on its faces builds a closed mesh of 8 corners and 12 triangles, V − E + F = 2 on welded positions, with an area of 6 m² and a volume of 1 m³ within 1e-12 relative, and the same points shuffled give the same mesh hash; a planted builder that keeps the face points as vertices builds more than 8 and fails, naming the item, and one that fans each face from its first point in input order gives another hash when shuffled and fails. A hull `of` a geodesic ball at detail 0 and radius 1 m has the icosahedron's 12 vertices, 20 faces and volume 2.53615 m³ within 1e-5, and four points on one plane are refused with hull.flat, naming the item | `hull.test.ts` (5): `crystal` and two shuffles each watertight with 8 welded corners (the cube's), 12 triangles, V − E + F = 2, 6 m² and 1 m³ within 1e-12 relative, and one mesh hash; `hull_keeps_face_points` fails naming `crystal` and its corner count; `hull_fan_input_order` (after a guard that a shuffle moves some face's fan) fails naming `crystal_s…` and the mesh hash; the hull `of` the icosa ball has 12 welded vertices on the unit sphere, 20 triangles, closed, 2.53615 m³ within 1e-5; four points on y = 0.5 are refused with `hull.flat` at `items/slate`. Wrong programs: interior or face points kept; an order-dependent fan or vertex order; a float orientation test that misjudges a point on a face; `of` not read |
| AC7 `#440.e32f40c2` | A creased slab cube whose face corner lists each start at another corner subdivides twice and bevels with 2 segments to the same welded-position and UV hash as the unrotated cube, at 1 block and at the registered block count; a planted subdivider that orders new edge points from each face's first corner differs and fails | `corner-order.test.ts` (2): the cube unrotated and with `rotate_corners: 1`, each at the registered block count (reported at least 2) and at `blocks: 1` (reported 1), gives one welded-position and UV hash; `subdivide_first_corner` gives the rotated cube another hash and fails, naming it. Wrong programs: edge points or UVs that follow a face's first corner; a block split that changes results |
| AC8 `#440.f4a52a05` | A slab with face attribute `wear` and parts top and side, run through array ×3, bevel and subdivide, gives every output face exactly one part and a `wear` equal to its source face's; a planted bevel that drops `wear`, or leaves bevel faces outside every part, fails, naming the attribute or the face | `parts-attributes.test.ts` (3): the source slab names `top` and `side`, each face in one part with one wear; every output face's triangles are in exactly one part, a source part's name, and carry one wear equal to a source face's of that part facing its way; `bevel_drops_wear` fails naming `wear`, `bevel_faces_unparted` naming a face `is in no part`. Wrong programs: attributes dropped or averaged across faces; bevel faces in two parts or none; parts renamed |

## Readings where the issue and design leave a choice

- **The bevel's width** (AC1) is the offset from the edge along each face (Blender's default), so the large face is
  inset by the width on every side and, at shape 0.5, the profile is the quarter circle of that radius tangent to
  both faces. **"Flat large faces"** is every corner normal of a triangle lying in a face's plane within 1e-3 rad of
  the face's normal (flat-shaded, as harden and weighted normals both promise); **"rounded edges"** is the circular
  profile (each point at the width from the shrunk box, within 1e-9 m), at least segments − 1 points strictly on
  each arc at each end of the edge, and normals that turn with the arc (within half a segment's turn of its outward
  direction). Corner patches are held only to lie within the rounding (between half the width and the width from
  the shrunk box), since the design doesn't fix their pattern. **"Equals the bound computed from its params before
  the build"** is the `estimate_only` count (with `builds: 0`) equal to the vertices built.
- **"Known exactly before the build"** (AC2) is `estimate_only` declaring welded points, edges and faces; edges are
  counted as `quads` counts them, a face's diagonals left out. **"Stays sharp … and rounds elsewhere"** is held to
  Catmull-Clark with the top's four edges infinitely sharp (crease 1), the rules OpenSubdiv uses for a sharpness at
  or past the level count, within 1e-9 m on welded positions.
- **"One texel density"** (AC3) is both singular values of each triangle's surface-to-uv0 map (UV units per metre
  in its most and least stretched directions) within 1% of 1 ÷ uv_scale. The lathe's polygon sides stretch arc
  against chord by 0.16%.
- **"No overlapping charts"** (AC4) is no two uv1 triangles whose interiors overlap by more than 1e-9 of the uv1
  extent, with every uv1 triangle of positive area (a collapsed chart overlaps nothing and would pass otherwise).
  Whether uv1 lies in [0, 1]² and the "no unwrap job" are not checked.
- **Mesh edges** (AC5) are read on the CPU through `geometry` rows for the lines, the same derivation the GPU layer
  draws; V, E and F are the cube row's welded points, face edges and distinct faces.
- **"The same mesh hash"** (AC6) is SHA-256 over the hull's positions and indices in order (reference.ts:
  meshHash), since the item's content key covers its params, whose order differs. **"Naming the item"** is a
  failure that starts with the item's ID. "Within 1e-5" for the icosahedron's volume is absolute, in m³ (the exact
  value, 2.5361507…, is within it).
- **"Face corner lists each start at another corner"** (AC7) is `rotate_corners: 1`, since no document can order a
  builder's face corners; whether the rotation reached the stack shows when the twin, which reads the first corner,
  gives another hash. **"The welded-position and UV hash"** is SHA-256 of the sorted set of distinct (welded
  position, uv0) pairs rounded to 1e-6, free of vertex order, triangle order and which diagonal splits a quad.
  **"The registered block count"** is the count each row reports as `blocks` without `blocks: 1`; it must be at
  least 2.
- **"Its source face"** (AC8) is checked through the attribute itself: each of the slab's six faces has its own
  `wear` (its centroid's distance from the item's origin), so an output face's wear names the source face it came
  from, which must be of the same part (less an array copy's `.<k>`) and face the same way (normals less than 90°
  apart). This doesn't decide the issue's tie rule for a bevel face midway between two faces ("ties to the lower
  index"); any adjacent face facing its way passes. "Naming the face" is `face <id>`, by the row's `faces`.

## Not tested, because no criterion asks

Bevel `limit: parts | all`, `parts`, `clamp` stopping overlapping bevels, shape other than 0.5, the audit's
tolerance; subdivide's `loop` and `simple` schemes, crease values below 1, `crease_angle`, `boundary`, the `uv`
rules, levels 3 and its refusal past 3; normals `by_angle`, `weight: angle | both`, `keep_sharp`, and `shade:
by_angle`; uv0 `natural`, `planar`, `sphere` and `box {size}`; uv1 on the other builders; point attributes
interpolating through subdivide; a hull `of` an item's part, its 4,096-point cap, its `true_shape` and part name
`hull`, its box uv0 and declared count; edge sets as crease keys; and that nothing here runs per frame.
