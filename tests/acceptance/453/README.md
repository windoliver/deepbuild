# Acceptance tests for #453: the loop's geometry.shading, its defect counts and quad ratio

Written first, from issue #453 ("The loop: geometry.shading's defect counts and quad ratio": its scope, its two
Fields blocks, its five acceptance criteria and its proof line), the design sections it links and those they lean
on, and base commit `e2e6e1cc` ("Merge pull request #1211 …"), by a job that never saw an implementation; none
existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of
this job (technical design: Dogfooding).

What was read:

- `docs/canvas-primitives.md`: the glossary row for **defect** (262: "a defect is counted, its count decides, and
  no geometry job may add one"); Asset job (7793: "Every kind that writes a mesh it changed … runs
  `geometry.shading` on its input and its output"; Draco named among what an inbound convert decodes) and its
  modeling kinds (7827: `remesh {mode: voxel | isotropic | quad, …}`); What holds a document to its rules (8171:
  issues as data, `{check, code, severity, ids, path, actual, t, what, fix}`, "the code, never the message text, is
  what an agent branches on"); Check input (8175); Check input: loop kinds (8264: `geometry.shading {normals:
  outward | consistent = outward, uv_when, stretch_max, texel, degenerate: refuse, manifold: for_boolean}`; "Each
  code kind returns numbers, the pixels or item IDs that fail, and a fix"; "shading … run[s] on evaluated data and
  hold[s] on any machine"); Check input: loop kinds: shading defects (8331: every field and sentence, "A mesh the
  check can't read is BLOCKED, naming the primitive and why, never skipped and never passed: Draco or meshopt data
  that tool can't decode, a mode other than triangles, or a skinned or morphed mesh away from its bind pose") and
  quad ratio (8349: the pairing rule, "best first, by their worst corner, with ties to the lower triangle indices",
  "a remesh job in quad mode as the fix", "It pairs on positions welded within `weld`, at the bind pose").
- `docs/technical-design.md`: Canvas modules (1079: the `skin` module; 1086: "loop | the loop's check kinds: …
  shading defects and the quad ratio … | scene3d, look | R6"); Document check (1509) and its check list (1528:
  "shading with defects counted per face after welding"); What done means (2064). AGENTS.md's four invariants.
- At the base: `crates/deep-show` (`run`; #403's `claims`, `requirements`, `verdict`; `verdict.rs`: `judge` and
  `run_check`, which drop notice-severity issues and give a module's check no way to make a requirement BLOCKED;
  `geometry.rs`: a `mesh.asset@1`'s glTF read from the evidence store by `sha256`; `evidence.rs`: `<2 hex>/<62
  hex>`), `crates/deep-canvas/src/registry/mod.rs` (`Registrar::check`, `KNOWN_MODULES` with `loop` in the `full`
  set and no module registering it, `module_of_check`), `crates/deep-canvas-scene3d/src/gltf.rs` (one node's
  triangle primitives; a primitive of another mode is skipped), `spec.rs` (`mesh.asset@1 {sha256, node, shade,
  paint}`), and the suites `tests/acceptance/403/` (conventions copied: claims, requirement rows, `blocked`,
  planted values, tags), `420/` and `423/` (scene documents, `mesh.asset@1`, glTF fixtures). Code was read to learn
  the surface; every expected value comes from the issue, the design and each fixture's own geometry.

## What the base does, which these tests don't credit

No canvas module registers `geometry.shading`, so a requirement naming it is BLOCKED with `module_missing` (no
`module`: `geometry` is no module's family). The glTF reader silently skips a primitive whose mode isn't
triangles, reads no skin and no Draco, and welds nothing. A requirement row carries no measured numbers, a
module's check can't make its row BLOCKED, and none of the planted values below exists, so `run` refuses each
planted scenario.

## Run them

They build `deep-show` with cargo, so they run one file at a time. `scripts/lanes.mjs` needs
`'tests/acceptance/453/'` added to its `alone` list (the one-at-a-time line, which also takes the folder off the
parallel line); this README is the instruction, the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/453 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/453/tsconfig.json
```

Each product file first runs `cargo build --locked --bin deep-show --no-default-features --features full` once
(honoring `CARGO_TARGET_DIR`), copies the binary to a temporary folder, and fails each test if the build failed.
Each test writes its glTF files into a fresh evidence store in a temporary folder and deletes it. Node built-ins
and vitest only; no file in this folder is binary. `fixtures.test.ts` builds nothing and runs anywhere in about
two seconds. Every test reads evaluated data on the CPU, so none is gated on a GPU, a platform or a machine. A run
with `--root` may leave Vitest's cache in `tests/acceptance/453/node_modules/.vite`; delete it.

`BASE-FAILURE.txt`, the run at the base with a header saying why each test fails there, is still to be produced
by the implementer: the drafting job could not run cargo builds. Expected there: every product test fails
(`geometry.shading` BLOCKED with `module_missing`, no `results`, and each planted scenario refused as
`bad_input`); the ten fixture tests pass, since they read only the fixtures.

`tsconfig.json` is #403's, unchanged: it extends the checkout's `tsconfig.json` three levels up, so it holds as the
folder lands at `tests/acceptance/453/`. The drafting job type-checked the suite from outside the checkout with
the same options and that root config by absolute path.

## The surface under test

The issue names `geometry.shading`, its check-input fields and its Result fields, but no reply shape. These tests
reuse `deep-show run` with everything #393's, #96's and #403's READMEs define for it (sessions, the process table,
panels, `docs[…].document` opened as revision 0, `claims` with `deliverables` and `requirements`, the `verdict`
call and its requirement rows `{id, kind, result, blocked?, issues}`, `planted`), and #420's `mesh.asset@1 {sha256,
node}` whose glTF is read from the scenario's evidence store by its SHA-256 (`<first 2 hex>/<other 62 hex>`, as
`geometry` reads it). What follows adds to it, as little as the criteria need. Names the issue gives are kept
exactly; every other name is this job's.

### The check input

`{"kind": "geometry.shading", …}` with the issue's fields and the loop kinds' fields, each at its default when
absent: `weld: 0.00001` (m), `degenerate_area: 1e-12`, `quad_min: 0.85`, `pair: {normal_max: 30, corner_max:
30}` (degrees), `normals: "outward"`, `degenerate: "refuse"`, `manifold: "for_boolean"`. These tests give only
`kind`, so every number is the design's default. The check reads every `mesh.asset@1` item of each deliverable:
its glTF from the evidence store, the node `node` names, every primitive of that node's mesh, all welded together.

### Requirement rows gain `results` (every row of geometry.shading, PASS and FAIL alike)

```json
"results": [{"doc": doc ID, "item": item ID,
             "welded_vertices": u32, "triangles": u32,
             "non_manifold_edges": u32, "non_manifold_vertices": u32, "inconsistent_edges": u32,
             "flipped_faces": u32, "degenerate_faces": u32, "boundary_edges": u32,
             "ids": {"non_manifold_edges": [EdgeID], "non_manifold_vertices": [VertexID],
                     "inconsistent_edges": [EdgeID], "flipped_faces": [FaceID],
                     "degenerate_faces": [FaceID], "boundary_edges": [EdgeID], "unpaired": [FaceID]},
             "signed_volume": f64 | null,
             "quad_ratio": f32, "unpaired": u32}]
```

- One entry per `mesh.asset@1` item the check read in full. `welded_vertices` is the count after welding within
  `weld`; `triangles` the triangles read, over every primitive of the node's mesh.
- Each `ids` list holds that field's IDs, `min(count, 64)` of them (the issue's "up to 64"), each once; which 64
  when there are more is the implementer's, and every listed ID is one the count counted.
- `signed_volume` (m³): Σ a · (b × c) ÷ 6 over the triangles on welded positions, when every welded edge has
  exactly two faces; `null` otherwise.
- `quad_ratio` = 2 × pairs ÷ triangles and `unpaired` = triangles − 2 × pairs, by the design's pairing.

### Face, vertex and edge IDs

- **FaceID** `"<primitive>:<triangle>"`: the primitive's index in the node's mesh's `primitives`, and the
  triangle's index in that primitive in file order (triangle t is `indices[3t … 3t + 2]`, or vertices 3t … 3t + 2
  with no `indices`). `"0:13"` is primitive 0's fourteenth triangle.
- **VertexID** `"<primitive>:<vertex>"`: a welded vertex, named by its first member in (primitive, vertex index)
  order.
- **EdgeID** `"<VertexID>/<VertexID>"`: its two welded vertices, the earlier in (primitive, vertex index) order
  first. `"0:4/0:5"`.

### `blocked` gains `mesh_unreadable`

A mesh geometry.shading can't read makes the requirement BLOCKED (never PASS, never FAIL, never skipped), with one
row in #403's `blocked` per primitive it can't read:

```json
{"code": "mesh_unreadable", "kind": "geometry.shading", "ids": [item ID],
 "doc": doc ID, "item": item ID, "primitive": u32, "why": "draco" | "meshopt" | "mode" | "pose"}
```

`primitive` as in a FaceID; `why` is `draco` or `meshopt` for compressed data the check didn't decode, `mode` for a
primitive whose mode isn't 4 (triangles), and `pose` for a skinned or morphed mesh away from its bind pose
(README: Readings). The claim is then never PASS. This is the first way a module's check makes its own row
BLOCKED; #403's rows already carry `blocked`.

### Issue codes (in the catalog, module `loop`, check `geometry.shading`)

The tests read two codes, each an error in the row's `issues` with `ids` holding the item:

- **`loop.normals_inward`**: under `normals: outward`, a closed part (every welded edge with two faces) whose
  signed volume is negative; `actual` is that signed volume (m³, a number).
- **`loop.quad_ratio`**: a mesh that deforms (README: Readings) whose `quad_ratio` is under `quad_min`; `actual`
  is `{"quad_ratio": f32, "unpaired": u32, "ids": [FaceID]}`, the result's own numbers and its `ids.unpaired`; its
  `fix` (text or ops) names the remesh job in quad mode (it contains "remesh" and "quad").

The codes for counted defects that fail (by `degenerate: refuse`, `manifold`, `normals`) are the implementer's;
no test reads them.

### `planted` values added (scenario field, each reachable only through it)

| Value | Criterion | The wrong program |
|---|---|---|
| `no_weld` | AC1 | counts on the file's own vertices, unwelded (the seam cube has 24 vertices and 24 boundary edges) |
| `one_winding_sum` | AC1 | judges `flipped_faces` by one winding sum per mesh: a mesh whose signed volume is positive has none |
| `degenerate_exact_zero` | AC2 | counts a face degenerate only at exactly zero area |
| `outward_skips_volume` | AC2 | holds `normals: outward` to each face's corner normals alone, never the closed part's signed volume |
| `vertex_fans_skipped` | AC3 | never counts a non-manifold vertex (no fan check; only edges are counted) |
| `unreadable_skipped` | AC4 | leaves out a primitive it can't read (undecoded Draco, not triangles, skinned away from its bind pose) and judges the rest |
| `quad_fails_rigid` | AC5 | fails every mesh under `quad_min`, with a skin or not |
| `pair_ignores_corners` | AC5 | pairs two triangles whenever their normals are within `normal_max`, whatever their corners |

## Fixtures

All written by `gltf.ts` at test time as GLB (a JSON chunk and one BIN chunk; positions f32), each the only
`mesh.asset@1` item (`asset`, node 0) of its own document and claim:

| Fixture | What it is | Criterion |
|---|---|---|
| `seamCube()` | side 1 about the origin, 24 vertices (four per face, the face's normal, a UV square each), 36 indices; a corner's second and third copies 2 µm off its first along x and y | AC1 |
| `seamCube([8, 10])` | the same, triangles 8 (−X) and 10 (+X) wound backwards, their normals still out; signed volume 2/3 m³ | AC1 |
| `sliverBox(1e-14)` / `(1e-10)` | a closed 100 m box (bounds diagonal² 30,000 m²) whose −Z face's triangle on the edge (0,0,0)–(100,0,0) is split at M = (50, h, 0), the sliver (B, A, M) closing it: triangle 13, area 3e-10 m² (1e-14 of the diagonal², yet above 1e-12 m²) / 3e-6 m²; a soup with flat normals | AC2, AC3 |
| `indexedCube(…, {inward: true})` | the unit cube, 8 shared corners, every triangle wound in and every normal in; signed volume −1 m³ | AC2 |
| `DEFECT_FIXTURES` | per defect kind, a planted fixture and its clean twin: the cube less its +Z triangle (4, 5, 6) → boundary edges `0:4/0:5`, `0:5/0:6`, `0:4/0:6`; the cube with a fin (0, 1, 8) → non-manifold edge `0:0/0:1`; two cubes touching at corner (1, 1, 1) → non-manifold vertex `0:6` (twin: apart); the 36-vertex soup cube with triangle 4 wound and facing backwards → inconsistent edges `0:0/0:2`, `0:0/0:7`, `0:2/0:7`; the cube with triangle 10 wound backwards, normals out → flipped face `0:10`; the sliver box → degenerate face `0:13` (twin: at 1e-10) | AC3 |
| Draco, lines, skin | a clean cube as primitive 0 beside primitive 1 as `KHR_draco_mesh_compression` data (required; accessors with no buffer view; a cut stream: the magic, four header bytes and seven zero bytes) or as the cube's 12 edges in mode 1; a skinned cube (one joint, inverse bind matrix the identity, every vertex weighted 1 to it) whose joint the file turns 90° about y, or leaves at the identity | AC4 |
| `torus()` | R = 1, r = 0.4, a 49 × 25 grid whose seam rows repeat, 48 × 24 quads each split on one diagonal: 2,304 triangles, 1,152 welded vertices; with and without a skin at its bind pose | AC5 |
| `icosphere()` | radius 1, the icosahedron split in four three times, each new point pushed to the sphere: 1,280 triangles, 642 vertices, side ratios under 1.25; with and without a skin at its bind pose | AC5 |

`fixtures.test.ts` checks each against `reference.ts`, the design's definitions applied to the fixture's own
positions: AC1's 24 vertices weld to 8 within 0.00001 m but not by equality, the backwards faces are the only
flipped ones and the winding still sums outward; the sliver's ratio is 1e-14 within 1%; each AC3 fixture holds
exactly its IDs and its twin none; the GLBs' Draco, mode and skin fields are what AC4 says; the torus is clean and
pairs fully. No product test compares the product to `reference.ts`.

## Criteria to tests

Each test's name starts with its criterion's tag, `#453.` and the first 8 hex digits of the SHA-256 of the
criterion's text, trimmed and whitespace collapsed (as `scripts/proof-change.mjs` computes it), then its ID; each
file's head quotes its criterion and names in `asserts` what carries it.

| ID | Tag | Criterion | Tests (count) |
|---|---|---|---|
| AC1 | `#453.c5097296` | A glTF cube split at its UV seams into 24 vertices welds to 8 within 0.00001 m and reports no defect; with two of its faces wound backwards it reports flipped_faces 2 naming both, though its summed winding still points outward | `weld-flipped.test.ts` (3): the seam cube has `welded_vertices` 8, every count 0 with no IDs, PASS; the twin reports `flipped_faces` 2 naming exactly `0:8` and `0:10`. `no_weld` fails naming `welded_vertices`; `one_winding_sum` fails naming `flipped_faces`. Fixture: `fixtures.test.ts` (summed winding outward) |
| AC2 | `#453.061ce907` | A triangle whose area is 1e-14 of its part's bounds diagonal squared counts as a degenerate face, and a closed part whose normals all point inward fails normals: outward on its negative signed volume | `degenerate-inward.test.ts` (4): the sliver at 1e-14 reports `degenerate_faces` 1 naming `0:13`, at 1e-10 nothing and PASS; the inward cube is FAIL with `loop.normals_inward`, `actual` and `signed_volume` −1 m³, no flipped face, no inconsistent edge; outward it passes at +1 m³. `degenerate_exact_zero` fails naming `degenerate_faces`; `outward_skips_volume` fails naming `loop.normals_inward` |
| AC3 | `#453.e9d7118c` | Each defect kind has a planted fixture that reports exactly its count with the face or edge IDs, and a clean twin that reports zero | `defects.test.ts` (7): one test per kind, its planted fixture's count and IDs exactly, its twin all zero and PASS; `vertex_fans_skipped` fails naming `non_manifold_vertices`. Fixtures: `fixtures.test.ts` (6) |
| AC4 | `#453.bb73e219` | An undecoded Draco mesh, a primitive in line mode and a skinned mesh checked away from its bind pose each make geometry.shading BLOCKED naming the primitive, never PASS | `unreadable.test.ts` (2): each BLOCKED with `mesh_unreadable` naming the item and primitive 1 (`draco`), primitive 1 (`mode`), primitive 0 (`pose`), the claim not PASS; the skinned cube at its bind pose passes. `unreadable_skipped` fails each, naming its primitive |
| AC5 | `#453.c8592e0f` | A 48 × 24 quad torus, triangulated, reports a quad_ratio of at least 0.95 and passes with a skin; an icosphere of 1,280 near-equilateral triangles reports under 0.7, and with a skin fails naming the ratio and its unpaired triangles with a remesh in quad mode as the fix, while with no skin it reports its ratio and passes | `quad-ratio.test.ts` (5): the torus, skinned and not, 2,304 triangles on 1,152 welded vertices, `quad_ratio` ≥ 0.95, PASS; the icosphere's `quad_ratio` under 0.7, skinned and not (its own test: README, Readings); skinned, FAIL with `loop.quad_ratio` naming the ratio, `unpaired` and 64 unpaired IDs, its fix a remesh in quad mode; with no skin its ratio reported, PASS. `quad_fails_rigid` fails naming `quad_ratio`; `pair_ignores_corners` fails naming `loop.quad_ratio` |

## Readings where the issue and design leave a choice

- **The icosphere's number was "under 0.6" and the design's pairing rule disagreed with it.** Applied to this
  icosphere (and to the other common 1,280-triangle geodesic spheres tried: midpoints normalised at every level or
  once at the end, and a flat frequency-8 grid projected), the design's rule (normals within 30°, a convex quad,
  every corner within 30° of a right angle, best first) pairs to a `quad_ratio` of 0.65625 to 0.6875 by
  `reference.ts`, not under 0.6: two near-equilateral triangles make a rhombus of about 60° and 120°, right at the
  30° limit, so the ratio hangs on small differences in shape. The pairs that pass, in symmetry classes of 60 or
  120 edges, have worst corners of 18.9°, 21.6°, 21.8°, 22.4° and 27.5°, and a class of 60 edges sits at exactly
  30° (f32 rounding puts some on each side). Only with the 27.5° class left out (corner_max under about 27.4°)
  does the ratio drop to 0.5625. After the dispute this suite raised, the user changed the issue to "under 0.7" on
  2026-11-04, and this suite was redrafted to that number, which 0.6875 meets. The test still holds the
  criterion's number in a test of its own. The other icosphere tests (FAIL with a skin, PASS without) hold either
  way, since 0.6875 is under 0.85.
- **"Faces" are triangles.** glTF holds only triangles and the check judges "each face on its own", so "two of its
  faces wound backwards" are two triangles, on opposite sides of the cube, so they share no edge; `flipped_faces`
  2 names both. Their edges are then inconsistent too (six), which the criterion doesn't ask and no test reads.
- **A flipped face** is one whose corner normals (the file's `NORMAL`, unit) point against its own vector area.
  Every fixture writes `NORMAL`, and in every fixture each corner agrees or disagrees with its face alike, so "any
  corner against" and "their sum against" read the same here.
- **"Reports no defect"** and **"a clean twin that reports zero"** are all six counts 0 with empty ID lists, and
  the requirement PASS. On a planted fixture only its own kind is read: a fin's two free edges are boundary edges,
  and whether a non-manifold edge's ends count as non-manifold vertices the design doesn't say.
- **"Welds to 8 within 0.00001 m"** is `welded_vertices` 8, on a cube whose seam copies are 2 µm apart, so equal
  positions alone don't weld it.
- **"Its part's bounds diagonal squared".** Each fixture is one primitive and one connected piece, so a part is the
  same whether read as the item, the primitive or a connected component. The box is 100 m so that 1e-14 of its
  diagonal squared (3e-10 m²) is above 1e-12 m²: a threshold taken as an absolute area would miss it.
- **"Fails normals: outward on its negative signed volume"** is a FAIL with `loop.normals_inward`, whose `actual` is
  the signed volume (−1 m³), on a cube with no flipped face and no inconsistent edge, so the volume alone fails it.
- **The face and edge IDs** are README's, chosen to be checkable from the file alone. A non-manifold vertex is named
  by a VertexID (the issue says "face or edge IDs"; a vertex count has vertex IDs).
- **"With a skin"** is a mesh that deforms, read from the glTF: the item's node has a `skin`, or a primitive of its
  mesh has morph `targets`. No `skin` canvas module is in the build, and the check needs none to read this.
- **"A skinned mesh checked away from its bind pose"**, read from the glTF and the document alone: a skinned mesh is
  at its bind pose when, for every joint of its skin, the joint node's world matrix in the file (parent × T·R·S, or
  its `matrix`) times its inverse bind matrix is the identity within 1e-6 per entry; otherwise it is away (`why:
  pose`). A morphed mesh is away when any weight its mesh or node gives is not 0 (not tested). The fixture's joint is
  turned 90° about y with an identity inverse bind matrix; the control leaves it at the identity, so a skin alone
  doesn't block.
- **"An undecoded Draco mesh".** No Draco decoder is pinned in the build, and the design says the check decodes
  "through the compress job's pinned tool". The fixture's Draco stream is cut short (the magic, four header bytes, seven
  zero bytes), so no decoder reads it, whichever tool is pinned later; it carries no uncompressed fallback.
- **"Naming the primitive"** is `primitive` (its index in the mesh) with the item and `why`. The Draco and line
  meshes put a clean cube in primitive 0, so a check that skips what it can't read passes them: that is
  `unreadable_skipped`, the base reader's own behavior.
- **"Never PASS"** is the requirement exactly BLOCKED and the claim not PASS.
- **"Fails naming the ratio and its unpaired triangles"** is `loop.quad_ratio`'s `actual` holding `quad_ratio`,
  `unpaired` and the IDs; the IDs are checked as primitive 0's triangles, distinct, `min(64, unpaired)` of them, and
  `unpaired` = 1,280 × (1 − `quad_ratio`). Which triangles stay unpaired isn't read, since it depends on pairs at
  the 30° limit. **"A remesh in quad mode as the fix"** is a `fix` that names `remesh` and `quad`.
- **"Reports its ratio and passes"** is a `quad_ratio` in [0, 1] in its result, no `loop.quad_ratio`, PASS.
- **"Passes with a skin"** for the torus is PASS with the skin at its bind pose and no defect: its 1,152 quads are
  planar (isosceles trapezoids) with corners within about 4° of square, so every quad pairs back first.

Not tested, because no criterion asks: meshopt data, morph targets, `manifold: for_boolean`, `normals:
consistent`, UV stretch and texel density (`uv_when`, `stretch_max`, `texel`), the 64-ID cap on a count over 64
(only the icosphere's unpaired list reaches it), which code each failing defect raises, a brief tightening a number,
geometry.shading on builder items, asset jobs running it on their input and output, rig jobs, and costs.

## Upstream tests (the Oracle lane)

The issue's Oracle page maps criteria 1 and 5 to upstream Blender tests. Blender is GPL-2.0, which AGENTS.md
forbids porting, and no Blender runner exists here, so the Oracle lane is BLOCKED (no runner, GPL), with one unblock
ask, never PASS. No oracle test is written; these tests are the criteria's local proof.
