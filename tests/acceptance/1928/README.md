# Acceptance tests for #1928: Face offsets and planar dissolve as modifiers

Written first, from issue #1928 ("Face offsets and planar dissolve as modifiers: faces inset and raised or sunk by a
depth, faces in one plane merged back, with counts known first and an offset wider than its face refused by name":
its scope, its eight acceptance criteria and its proof line), the design sections it links and those they lean on,
and base commit `336a0a92b` ("Merge pull request #2800 …"), by a job that never saw an implementation; none existed.
The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding).

The suite proves the issue's eight criteria on two new generate modifiers, `mod.offset_faces@1` and
`mod.dissolve@1`: the counts, areas and volumes the issue works by hand, read back from the built mesh; the
refusal of an offset as wide as its face; the warning when merging would leave a hole; counts declared before the
build; a result that doesn't depend on where a face's corner list starts or on the block count; and parts, face
attributes and uv0 carried through. Each criterion has one test the right program must pass and one per wrong
program it names, in which the same check must fail and name what the criterion says.

The issue's Oracle line names a separate lane kept outside this repository. It is not part of this suite, and its
page was not opened.

What was read:

- Issue #1928, live, and for context its epic #127 and the closed #440 and #420 it builds on.
- `docs/canvas-primitives.md`: Modifier (3750: `offset_faces {parts: [part] (every part when empty), by: m, depth:
  m = 0, inner: part (optional)}`; `dissolve {angle: deg = 1}`; "each corner, under or over 180°, sits where its
  two moved edges meet, and one ring face joins each edge to its moved copy"; "The ring faces keep the source
  face's part and face attributes, the inner face takes `inner` when it is given, and new corners take uv0 from the
  source face's own uv map at their place before `depth` moves them"; "A face of n corners adds n points, 2n edges
  and n faces"; "refused at check with `offset_faces.too_wide {item, face, by, max}`"; "a set whose union is not
  one simple loop with no hole stays as it was, with the warning `dissolve.hole {item, faces}` on the item"; "its
  counts are at most its input's"; "never depend on where a face's corner list starts"); Modifier: bevel (3785);
  Modifier: subdivide (3802: `scheme: … simple`); Builder (2914: `slab`, `plate`, "a vertex count computable from
  params"); Builder: uv (3031: `uv0: … box`, uv0 in metres).
- `docs/technical-design.md`: Modifier (1219); Modeling steps (1408: "faces can be offset inward and moved by a
  depth, and faces in one plane dissolved back into one"); Wrong programs (2650); Dogfooding (2671); the parity
  suite (2691); Tests written first (2702).
- At the base, for call shapes and conventions only: `tests/acceptance/440/` (the suite for the issue this one
  builds on: the `full` build once per file, `sceneDoc`, the `geometry` call with `blocks` and `rotate_corners`,
  rows with `faces`, `parts`, face attributes, `declared.points/edges/faces`, `none` and `failsNaming`),
  `tests/acceptance/2015/` and `1636/` (current conventions), `tests/acceptance/224/` (how a build's warnings with
  fields reach `deep_show`'s issues); `crates/deep-show/src/geometry.rs`, `hub.rs` (`show`) and `frames.rs`
  (`op_issue`); `crates/deep-canvas/src/document/mod.rs` (an issue's JSON); `crates/deep-canvas-scene3d/src/
  stack.rs`, `build.rs`, `builders.rs`, `poly.rs` and `geom.rs`.

## What the base already does, and what it lacks

Observed on the base's own `deep-show` (built once, nothing changed): `deep-show run` presents scene3d documents;
`slab@1` builds from `size` or from `outline` and `thickness`, names its parts `top`, `bottom` and `side`, and
emits a box-projected uv0 in metres; `plate@1 {grid, size}`, `mod.subdivide@1 {scheme: simple}` and `mod.store@1
{domain: face}` work; `geometry` answers rows with `positions`, `indices`, `faces`, `parts`, `attributes`, `uv0`,
`blocks` and `declared {vertices, points, edges, faces}`, and takes `stage`, `estimate_only`, `blocks: 1` and
`rotate_corners`. Read through this suite's references, the base gives the facts the issue states as inputs: a
1 m slab cube is 8 welded points, 12 edges, 6 faces and 1 m³; a 3 × 3 m `plate {grid: [3, 3]}` is 16 points; the
cube under `subdivide {scheme: simple}` at level 1 is 26 points; and the L-shaped slab is 12 points, 18 edges and
8 faces, its top one face of six corners and 3 m².

The base has no `mod.offset_faces@1` and no `mod.dissolve@1`: an item with either is refused when presented, with
`out_of_range` at `items/<id>/modifiers/<k>/kind` ("scene3d.build can't evaluate this"). It has no
`offset_faces.too_wide`, no `dissolve.hole`, and none of the nine planted names (`deep-show run` answers an unknown
`planted` with `bad_input`). So every test fails there; `BASE-FAILURE.txt` holds the run.

## Run them

Each file builds `deep-show` in the `full` set (`cargo build --locked --bin deep-show --no-default-features
--features full`, honouring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless
set), once, copies it out under its own name in a temporary folder, and fails each test if the build failed. So
they run one file at a time. `scripts/lanes.mjs` may need `'tests/acceptance/1928/'` added to its `alone` list (the
one-at-a-time unit-lane line), as #440's is; this README is the instruction, and the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1928 --no-file-parallelism --testTimeout=900000
node node_modules/typescript/bin/tsc -p tests/acceptance/1928/tsconfig.json
```

Each test writes its scenario's evidence store into its own temporary folder and deletes it. Node built-ins and
vitest only. A run with `--root tests/acceptance/1928` leaves the test runner's cache in
`tests/acceptance/1928/node_modules/.vite`; delete it. Every test is CPU only and runs anywhere; no criterion has a
time budget.

## The surface under test

Everything #420's and #440's READMEs define for `deep-show run` holds unchanged: the scenario (`evidence`,
`sessions`, `processes`, `panels` with the base's `visible`, `docs`, `planted`, `calls`), `deep_show` with
`document` and `include: ["issues"]`, and `geometry`. This suite adds **two modifier kinds**, **one refusal**,
**one warning** and **nine planted names**. No new binary, no new call, no new request field and no new row
field.

### Documents

- `mod.offset_faces@1 {parts: [part], by: m, depth: m = 0, inner: part}` in an item's `modifiers`, as the issue
  gives it. The tests write `parts: ["top"]` or `["side"]`, `by` 0.1, 0.3, 0.49 and 0.5, `depth` 0.2 and −0.2, and
  `inner: "panel"`.
- `mod.dissolve@1 {angle: deg = 1}`. The tests write it with `params: {}`, so at its default angle.
- Both sit in the stack beside the base's steps: after `mod.store@1` (AC8), after `mod.subdivide@1` (AC5), and
  `mod.dissolve@1` after `mod.offset_faces@1` (AC6, AC7, AC8).
- The base's kinds, as the base has them: `slab@1 {size: [1, 1, 1]}` (the 1 m cube: x and z from −0.5 to 0.5 m, y
  from 0 to 1 m), `slab@1 {outline, thickness}` (the outline in plan (x, z), y from 0 up), `uv0: "box"`, parts
  `top`, `bottom` and `side`; `plate@1 {grid: [3, 3], size: [3, 3]}`; `mod.subdivide@1 {levels: 1, scheme:
  "simple"}`; `mod.store@1 {name: "wear", domain: "face", type: "f32", field: "distance"}`.
- Documents reach `deep-show` as an agent sends them (`deep_show` from one session: no `id`, no `layers`).

### `deep_show`: the refusal and the warning

An issue's fields (`item`, `face`, `by`, `max`, `faces`) are read on the issue itself or in its `actual` object,
whichever holds them (the base spreads some codes' fields onto the issue and keeps others' in `actual`).

- **`offset_faces.too_wide {item, face, by, max}`**: an issue of severity `error`; the revision is refused
  (`outcome: "refused"`).
  - `item`: the item's ID (a string).
  - `face`: the ID of the face that is too narrow, a number, as the mesh the modifier takes numbers its faces. In
    AC4 the modifier is the stack's first step, so that mesh is the builder's, which `geometry` answers at `stage:
    "built"` with one face ID per triangle in `faces`.
  - `by`: the `by` as written, in metres.
  - `max`: the limit, in metres: the offset at which an inner edge first reaches 0 m or the inner outline first
    stops being simple (0.5 for the 1 m cube's top). A `by` at or past it is refused.
  - It is raised by the check, before any build, so it is raised for a hidden panel too. At the base a panel with
    `visible: false` evaluates no frame when a revision is shown to it (`deep_show` answers `not_presented`,
    reason `hidden`, for a revision that passes the check), so nothing is built there and only the check can
    refuse. AC4 shows the too-wide document to such a panel and it must be refused.
  - A `geometry` call for a document whose only revision was refused answers `{"code": "no_revision"}`, as at the
    base.
- **`dissolve.hole {item, faces}`**: an issue of severity `warning` in the `issues` of the `deep_show` that
  presents the revision; the revision is presented (`outcome: "presented"`).
  - `item`: the item's ID (a string).
  - `faces`: the IDs of the faces of the set that stayed, an array of numbers in any order, as the mesh `dissolve`
    leaves numbers them. In AC6 `dissolve` is the stack's last step, so they are the IDs in the item's `geometry`
    row's `faces`.

### `geometry`: nothing new

The tests read, as the base answers them: a row's `positions`, `indices`, `faces` (one face ID per triangle; the
triangles of one face share one, and two faces never share one, in one plane or not), `parts` (part name →
triangle indices), `attributes` (a face attribute as `{domain: "face", values}` with one value per triangle; a
value that is no finite number reads as none), `uv0` (one per position), `blocks`, and `declared {vertices,
points, edges, faces}`; the reply's `builds`; and the options `stage: "built"`, `estimate_only: true`, `blocks:
1` and `rotate_corners: 1`. A face of four corners keeps its two triangles where they have no area, as the
base's rows do.

For the two new modifiers:

- With `estimate_only` the reply builds nothing (`builds: 0`) and each row's `declared` holds the counts of the
  item's final mesh, as for every stack at the base.
- A stack that ends in `mod.offset_faces@1` declares its points, edges and faces exactly.
- A stack that ends in `mod.dissolve@1` declares a bound: counts no greater than those the same item declares
  without that step. No new field marks a bound; the base's `hull@1` declares a bound in the same fields.
- No build has more points, edges, faces or vertices than its item declared.

### `deep-show run`: scenario `planted` values added (each reachable only there)

Each is one wrong program, named in snake_case, that compiles and runs. Each row gives the wrong program in its
criterion's words; where the criterion leaves the mechanism open, the row fixes it, and what the row says of the
fixture is what the planted test asserts.

| Value | The wrong program | Criterion |
|---|---|---|
| `offset_along_bisector` | `mod.offset_faces@1` puts each inner corner at its source corner moved `by` along the corner's bisector (the unit direction midway between its two edges, into the face), not where its two moved edges meet. On the cube's top every corner moves 0.1 m along its diagonal, so the inner face is (1 − 0.2 ÷ √2)² = 0.737157 m². The counts stay 12, 20 and 10. | AC1 |
| `offset_depth_along_y` | `mod.offset_faces@1` moves every inner face by `depth` along the item's +y, not along its source face's normal. An inner face of `top` is built right; an inner face of `side` stays in its side's plane, 0.2 m higher. | AC2 |
| `offset_corner_along_edges` | `mod.offset_faces@1` puts each inner corner at its source corner moved by `by` times the sum of its two edges' unit directions, each pointing away from the corner. At a 90° corner under 180° that is where the moved edges meet; at the L's notch it is plan (1.1, 1.1), on the notch side, and the inner L is 2.44 m². | AC3 |
| `offset_too_wide_unchecked` | The check lets a `by` at or past the limit through: no `offset_faces.too_wide`, the revision is taken, and `geometry` builds it. At by 0.5 on the cube's top the four new points coincide, so the inner face and the ring faces have zero-length edges. | AC4 |
| `dissolve_keeps_straight_points` | `mod.dissolve@1` merges faces as it should and never removes a point left with two edges that turn by under `angle`. The plate keeps the 8 points along its sides: 12 points. | AC5 |
| `dissolve_merges_pairs` | `mod.dissolve@1` merges two faces at a time in index order (a pair merges when the two alone may merge and their union is one simple loop), not each connected set whole or not at all. Around `panel` the ring faces merge until the next merge would close the ring, so part `top` is left with fewer than four faces. | AC6 |
| `offset_first_corner` | `mod.offset_faces@1` numbers a face's new points from the face's first corner and lets that number reach the result, so a face whose corner list starts at another corner gets other welded positions or uv0: for example, the new point at each face's first corner keeps its source corner's uv0. | AC7 |
| `offset_drops_wear` | `mod.offset_faces@1` drops the face attribute `wear` on the faces it makes (the ring faces and the inner face), or on the whole mesh. | AC8 |
| `offset_inner_unparted` | `mod.offset_faces@1` with `inner` given leaves the inner face outside every part: not in `inner`, not in its source face's part. | AC8 |

## The references

`reference.ts` holds the CPU references, written from the issue and the design alone, and reads nothing the
program reports about itself:

- **Welding** at 1e-6 m (positions rounded to a 1e-6 m grid), as #420's and #440's suites weld.
- **The polygon view** of a row: each face is the triangles that share a face ID, read as its boundary loop on
  welded points (the triangle edges no other triangle of the face runs back along). Points are the welded
  positions, edges the faces' boundary edges (a face's diagonals left out), faces the distinct IDs. It never reads
  triangle order, vertex order, how the IDs are numbered or where a loop starts.
- **Area**: a loop's Newell area vector, so a corner over 180° counts as it should.
- **Volume**: the divergence theorem over the row's triangles, sum of p₀ · (p₁ × p₂) ÷ 6, after checking that
  every welded edge is on exactly two triangles wound opposite ways.
- **The welded-position and UV hash**: SHA-256 of the sorted set of distinct (welded position, uv0) pairs.

They were held to the base before use: the plain cube (8, 12, 6, closed, 1 m³), the plate (16 points), the
subdivided cube (26 points) and the L-shaped slab (12, 18, 8, top 3 m²) read as the issue and the base's own
declared counts say.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed (the rule
`scripts/proof-change.mjs` applies to the live issue body's `- [ ]` lines). Each test's name starts with `AC<n>
#1928.<id>`. A planted test runs the same check as its criterion's passing test under `planted`, and asserts that
it fails with a failure that names what the criterion says.

| ID | Criterion | Tests and what each asserts |
|---|---|---|
| AC1 `#1928.ceaee399` | A 1 m slab cube with `offset_faces {parts: [top], by: 0.1}` builds 12 points, 20 edges and 10 faces, V − E + F = 2 on welded positions, with an inner face of 0.64 m² and four ring faces of 0.09 m² each in its top plane, within 1e-9 relative. A planted offset that moves each corner `by` along its bisector leaves an inner face of 0.737157 m² and fails, naming the face | `ac1-inset-cube.test.ts` (2): 12, 20 and 10 on the polygon view, V − E + F = 2; in the plane y = 1 one face that touches no corner of the cube, of 0.64 m², and four that do, of 0.09 m² each, within 1e-9 relative. `offset_along_bisector` fails naming `the inner face (face <id>): its area is 0.737157 m², not 0.64 m²` |
| AC2 `#1928.52811717` | With `depth: 0.2` the inner face lies 0.2 m above the top plane and the cube holds 1 + 0.2 ÷ 3 × (1 + 0.64 + 0.8) = 1.162667 m³, and with `depth: −0.2` it holds 0.837333 m³. With `parts: [side], by: 0.1, depth: 0.2` it holds 1 + 4 × 0.162667 = 1.650667 m³, each within 1e-6 relative. A planted offset that moves every inner face along the item's +y instead of its face's normal passes the top case and fails the side case, naming a side face | `ac2-depth.test.ts` (2): `raised`'s one inner face at y = 1.2 within 1e-9 m and a closed 1.162667 m³; `sunk` a closed 0.837333 m³; `sides`' four inner faces each 0.2 m outside its own side's plane and a closed 1.650667 m³; volumes within 1e-6 relative. `offset_depth_along_y` passes `raised` and `sunk` and fails `sides` naming `face <id>, the inner face of a side face, lies …` |
| AC3 `#1928.a6a07f62` | An L-shaped slab 1 m thick on the outline (0, 0), (2, 0), (2, 1), (1, 1), (1, 2), (0, 2) m, offset on `parts: [top]` by 0.1 m, builds 18 points, 30 edges and 14 faces, an inner L of 1.8² − 1 = 2.24 m² and six ring faces of 0.76 m² in all, within 1e-9 relative, with the inner corner at the notch 0.1 m from both notch edges inside the face. A planted offset that moves that corner along the sum of its edge directions puts it on the notch side, leaves an inner L of 2.44 m² and fails, naming the corner | `ac3-notch.test.ts` (2): 18, 30 and 14; in the plane y = 1 one inner L of 2.24 m² and six ring faces of 0.76 m² in all, within 1e-9 relative; the inner L's corner nearest the notch at (0.9, 1, 0.9) within 1e-9 m. `offset_corner_along_edges` fails naming `the inner corner at the notch is at (1.1, 1, 1.1)` and the inner L's 2.44 m² |
| AC4 `#1928.7f908e67` | On the 1 m slab cube, `by: 0.5` on `parts: [top]` is refused at check with `offset_faces.too_wide`, naming the item, the face, 0.5 m and the limit of 0.5 m, with 0 builds, and `by: 0.49` builds an inner face of 0.02 × 0.02 = 0.0004 m². A planted check that lets 0.5 through builds a face with zero-length edges and fails, naming the face | `ac4-too-wide.test.ts` (2): by 0.49 is presented and its inner face is 0.0004 m² within 1e-9 relative; by 0.5, shown to a hidden panel where nothing is built, is refused with an error `offset_faces.too_wide` whose `item` is `cube`, `face` the cube's top face's ID, `by` 0.5 and `max` 0.5, and `geometry` then answers `no_revision`. `offset_too_wide_unchecked` fails naming `by 0.5 built face <id> with zero-length edges` |
| AC5 `#1928.b81c59f3` | `dissolve` turns a 3 × 3 m `plate {grid: [3, 3]}` of 16 points into 4 points, 4 edges and 1 face of 9 m², V − E + F = 1, and a 1 m slab cube under `subdivide {scheme: simple}` at level 1 (26 points) back into 8 points, 12 edges and 6 faces holding 1 m³, within 1e-12 relative. A planted dissolve that keeps the points between two straight edges leaves 12 points on the plate and fails, naming the count | `ac5-dissolve.test.ts` (2): the inputs have 16 and 26 points; the dissolved plate is 4, 4 and 1, V − E + F = 1, its face 9 m²; the dissolved cube is 8, 12 and 6, closed, 1 m³; both within 1e-12 relative. `dissolve_keeps_straight_points` fails naming `the dissolved plate: 12 points, not 4` |
| AC6 `#1928.d0733dd4` | `offset_faces {parts: [top], by: 0.3}` and then `dissolve` give back the plain cube's 8 points, 12 edges and 6 faces. With `inner: panel`, the four ring faces around `panel` would merge into a face with a hole, so all four stay: 12 points, 20 edges and 10 faces, with the warning `dissolve.hole` naming those four faces. A planted dissolve that merges two faces at a time in index order leaves fewer than four ring faces and fails, naming the part | `ac6-hole.test.ts` (2): `flat` is 8, 12 and 6 and its points are the cube's corners; `framed` is 12, 20 and 10, part `top` holds four faces and part `panel` one, and a `dissolve.hole` warning whose `item` is `framed` names exactly those four faces' IDs. `dissolve_merges_pairs` fails naming `framed: part top holds <fewer than 4> faces, not the four ring faces around panel` |
| AC7 `#1928.b7a3ee7e` | Both modifiers declare their counts before they build, `offset_faces` exactly and `dissolve` as at most its input, and build within them. The L-shaped slab under `offset_faces {parts: [top], by: 0.1, depth: 0.2}` and `dissolve` gives the same welded-position and UV hash with each face's corner list turned by one, at 1 block and at the registered block count. A planted offset that numbers new points from each face's first corner gives another hash and fails | `ac7-counts-order.test.ts` (2): `estimate_only` builds nothing; the L under the offset builds exactly the points, edges and faces it declared; under the offset and dissolve it declares no more than that and builds no more than it declared; neither builds more vertices than declared; the L as written and with `rotate_corners: 1`, each at the registered block count (reported at least 2) and at `blocks: 1` (reported 1), gives one hash. `offset_first_corner` fails naming `rotate_corners: 1 at the registered block count: its welded-position and UV hash` |
| AC8 `#1928.415a3836` | A slab with face attribute `wear`, parts `top` and `side` and box uv0, under `offset_faces {parts: [top], by: 0.1, inner: panel}` and `dissolve`, gives every output face exactly one part and a `wear` equal to its source face's, and its inner face's uv0 spans 0.8 by 0.8 units within 1e-9. A planted offset that drops `wear`, or leaves the inner face outside every part, fails, naming the attribute or the face | `ac8-parts-wear.test.ts` (3): the source slab names `top` and `side`, each face in one part with its own wear; every output face is in exactly one part (`panel` for the inner face, its source face's part otherwise) and carries one `wear`, its source face's within 1e-9; the inner face's uv0 spans 0.8 by 0.8 units within 1e-9. `offset_drops_wear` fails naming `wear`; `offset_inner_unparted` fails naming `face <id>, the inner face, is in no part` |

## Readings where the issue and design leave a choice

- **Points, edges and faces** (AC1, AC3, AC5, AC6, AC7) are counted on the polygon view of the returned mesh: the
  issue says "V − E + F = 2 on welded positions", and #440 left `declared.points`, `edges` and `faces` as "the
  welded points, the edges (a face's diagonals left out) and the faces". Welding is at 1e-6 m.
- **The inner face and the ring faces** are found by where they lie, not by ID or order: the issue says each
  face "gets an inner face whose edges are its edges moved `by` into the face" and "One ring face joins each edge
  to its moved copy", so the inner face touches no corner of the builder's mesh and each ring face touches two.
  The test knows those corners from the document it wrote.
- **Areas** are held "within 1e-9 relative" one by one where the issue gives one (0.64 m², each 0.09 m², 2.24 m²)
  and as a sum where it says "in all" (0.76 m²). AC4 gives no tolerance for 0.0004 m²; it is held to the same
  1e-9 relative.
- **"Naming the face"** (AC1, AC2, AC4, AC8) is `face <id>` by the row's `faces`, with what the face is. **"Naming
  the corner"** (AC3) is `the inner corner at the notch` with where it sits. **"Naming the count"** (AC5) is `12
  points, not 4`. **"Naming the part"** (AC6) is `part top`. **"Naming the attribute"** (AC8) is `wear`.
- **AC2's volumes** are the issue's six-decimal figures, 1.162667, 0.837333 and 1.650667 m³, within the 1e-6
  relative it gives; the exact values of its formulas lie 2e-7 to 4e-7 from them. "Lies 0.2 m above the top
  plane" is every corner of the inner face at y = 1.2 within 1e-9 m. "The top case" is both top documents and "the
  side case" the `parts: [side]` one. To name a side face, the side case also holds each inner face 0.2 m outside
  its own side's plane, on the issue's "`depth` then moves the inner face along the source face's normal, outward
  when positive".
- **The notch** (AC3) is the slab's corner at plan (1, 1); "0.1 m from both notch edges inside the face" is the
  inner L's corner there at (0.9, 1, 0.9), within 1e-9 m, the face being where x < 1 or z < 1.
- **"Naming … the face"** in the refusal (AC4) is the field `face` equal to the top face's ID in the mesh the
  modifier takes, since that is the mesh the check judges; the test reads that ID from the builder's row and
  never assumes a number. "0.5 m and the limit of 0.5 m" are `by` and `max`, each within 1e-9 m.
- **"Refused at check … with 0 builds"** (AC4) is read with what the base answers. The base has no build count
  for a refused revision, and the suite adds none. Instead the too-wide document is shown to a hidden panel: the
  base evaluates no frame there, so nothing is built and a refusal can only be the check's. (At the base a
  failure found by building, such as a modifier kind it doesn't know, refuses a visible panel's revision and
  lets a hidden panel's through.) The revision must be refused there, and then no revision stands, so
  `geometry` answers `no_revision` and builds nothing.
- **"A face with zero-length edges"** (AC4) is a face one of whose triangles has two corners at one welded point.
- **AC5's "within 1e-12 relative"** is held on both measures of its sentence, 9 m² and 1 m³. The 16 and 26 points
  are the criterion's stated inputs and are asserted before the dissolved meshes are read.
- **"Give back the plain cube's 8 points"** (AC6) is 8 welded points, each one of the cube's corners.
- **"The four ring faces"** (AC6) are the faces of part `top` in the built mesh, on the issue's "The ring faces keep
  the source face's part … and the inner face takes `inner` when it is given"; the warning's `faces` must be
  exactly their IDs. The issue says the warning is "on the item": it is an issue of severity `warning` whose
  `item` is the item, in the `deep_show` reply that presents the revision, as a build's warnings are at the base.
- **"Declare their counts before they build"** (AC7) is `geometry` with `estimate_only`, which builds nothing.
  "Exactly" is the built points, edges and faces equal to the declared ones. "At most its input" is the item with
  `dissolve` declaring no more than the same item without it. "Build within them" is no built count, vertices
  included, above its declared one. A tighter bound than the input's counts also passes. The criterion's fixture
  is the L raised by 0.2 m, where no two faces lie in one plane, so `dissolve` merges nothing there and builds its
  input's counts.
- **"Each face's corner list turned by one"** (AC7) is `rotate_corners: 1`, #440's metamorphic input. "The
  registered block count" is the count each row reports as `blocks` without `blocks: 1`; it must be at least 2.
- **"Its source face"** (AC8) is the source face in whose plane the output face lies, which is unique on a box
  and holds for every face here since the offset has no depth. The slab is placed off the item's origin so each
  of its six faces has its own `wear` (its centroid's distance from the origin, #440's fixture). "Equal" is within
  1e-9. "Spans 0.8 by 0.8 units" is the extent of the inner face's vertices' uv0 along u and along v. The four
  ring faces around `panel` stay here as in AC6, and the warning that comes with them is not read again.

## Not tested, because no criterion asks

`parts: []` (every part); `angle` other than 1°; a face that is refused because its inner outline stops being
simple before an edge reaches 0 m; `dissolve` leaving faces apart for a different part, face attribute or uv0;
point and corner attributes through either modifier; normals; `uv1`; bounds and true shapes; `enabled: false`;
that neither takes `on`; the content-key cache; modifiers after `dissolve`; and the items the issue lists under
"Not in this task".
