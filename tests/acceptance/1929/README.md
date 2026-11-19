# Acceptance tests for #1929: box and mesh deforms, a mesh reshaped by a grid of points over a box or by a coarse closed mesh around it, bound once at build and blended each frame, with outside points refused by name

These tests were written before any implementation existed. The writer had issue #1929 (its summary, Scope, seven
acceptance criteria, Proof line and Oracle line; it has no comments), its oracle page, the design documents and base
commit `376f578e0` ("Merge pull request #2795 …"). No implementation existed, and no other worktree, branch or pull
request was read.

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job
(design: Dogfooding). The suite is lean: one file per criterion, 18 tests, and the eight planted wrong programs the
criteria name.

## What was read

- Issue #1929 and its oracle page: upstream tests for criteria 1, 5 and 6, each marked "port" and each needing the
  upstream tool to run; criteria 2, 3, 4 and 7 have none. The vendored copies the page links were not among this
  job's inputs, so nothing is ported and there is no `1929-oracle/` folder; the issue's Oracle line keeps that lane
  BLOCKED without a runner. Whoever opens it checks the upstream license first (AGENTS.md: never port GPL code).
- `docs/canvas-primitives.md`: Modifier (the Fields lines for `box_deform` and `mesh_deform`; the end of Semantics,
  which states both deforms, the bind at build, its content key, and the four refusals); Modifier: subdivide
  (`scheme: simple`); Builder (`slab`); Units and axes (metres, +Y up); Item and kind; The path grammar; Channel and
  key (`type: vec3`, a key's `interp`, "x computed in f64"); Asset: skinned playback; Dirty classes; Content key.
- `docs/technical-design.md`: What done means, fixed at the start (Who drafts it; Proven on the base); Modifier;
  Channel and key; Dirty classes and content key; Document check; How we know version 0 works (Criteria to tests,
  Criteria in a checked shape, Wrong programs, Dogfooding, the CPU-reference and boundary-pair rules); Tests written
  first. AGENTS.md and CONTRIBUTING.md.
- At the base, for surfaces and conventions only: `crates/deep-canvas-scene3d` (`stack.rs`'s `KINDS`, its deforms and
  `Row`; `build.rs`'s `scene3d.build` and how a fault becomes an operator's error; `contributed.rs`, whose refusals
  name a mesh vertex as `items/<id>/modifiers/<k>/vertices/<index>`; `lib.rs`'s `PLANTED`); `crates/deep-show`
  (`main.rs`'s scenario `planted`; `geometry.rs`'s `stage`, `builds`, `play` and stack rows; `frames.rs`'s `op_issue`
  and `probe`); `crates/deep-canvas` (`document/mod.rs`'s `Issue::to_json`; `schedule/mod.rs`'s `Session::probe`, a
  clean scratch evaluation; the phase lists); `crates/deep-canvas-loop` (a welded vertex named by its first member);
  `scripts/proof-change.mjs` (`criterionId`), `scripts/proof-runs.mjs` (failing at an assertion; twins),
  `scripts/lanes.mjs`, `scripts/lease`; and the suites `420/` and its `redraft/`, `440/`, `441/`, `224/`, `226/`,
  `1636/`, `1640/`, `2013/`, `2017/` and `387/`.

Code was read only to learn the surface. Every expected value is the issue's, or a closed form computed in
`reference.ts` from the issue's Scope. The mean value coordinates there were also compared once, outside the suite,
with a direct numeric integration of their defining integral over the sphere of directions, on both octahedra of
criterion 6 (agreement within 2e-7).

## What the base already does, which these tests don't credit

`deep-show run` presents scene3d documents. `slab@1 {size: [1, 1, 1]}` under `mod.subdivide@1 {levels: 1, scheme:
simple}` builds 96 vertices at 26 welded points (`declared.points` 26), standing on the item's origin (y from 0 to
1 m). `mod.simple_deform@1`, a CPU deform it has, keeps the count and order of the vertices it takes (observed).
`geometry` answers an item's mesh after its stack, its stack rows (`kind`, `class`,
`reads_time`, `enabled`, `gpu`) and `builds`; with `play: {fps}` it plays every frame from 0 to `t` and reads the
played frame; `t` may be flicks. A `vec3` or `f32` channel binds a modifier's param by path. A revision's check runs
the operators once, clean, on a scratch session; an operator's error refuses the revision as an error issue with the
error's code, path and `actual`; after a refused first revision `geometry` answers `no_revision`. An unknown
`planted` name answers `{"ok": false, "code": "bad_input"}`.

There is no `mod.box_deform@1` or `mod.mesh_deform@1` (either is refused `out_of_range` at
`items/<id>/modifiers/<k>/kind`), no `box_deform.*` or `mesh_deform.*` issue code, no `work` on a stack row, and none
of the planted names below.

## Run them

Each file builds `deep-show` in the `full` set, so they run one file at a time. The implementer adds this line to
`scripts/lanes.mjs`; this README is the instruction, and this job edits nothing outside its folder.

```js
// #1929's files each build deep-show (full); CPU only, no GPU and no timing.
alone.push('tests/acceptance/1929/');
```

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease node node_modules/vitest/vitest.mjs run --root tests/acceptance/1929 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1929/tsconfig.json
rm -rf tests/acceptance/1929/node_modules/.vite
```

- **Build.** Each file first runs `cargo build --locked --bin deep-show --no-default-features --features full` (with
  `/opt/homebrew/opt/rustup/bin` first on `PATH` where it exists, `CARGO_INCREMENTAL=0` and
  `CARGO_PROFILE_DEV_DEBUG=0` unless set, honoring `CARGO_TARGET_DIR`), copies the binary out of the target folder,
  and fails each test if the build failed. No cargo is a failure starting `BLOCKED:`, never a pass.
- **Platform.** Every test is CPU only: built geometry and evaluated frames read as data from `deep-show run`. No GPU,
  no Metal, no timing, no reference machine; the same on Linux and macOS. The issue's proof runs on Spark, which this
  job could not reach: `BASE-FAILURE.txt` is the run at the base on an arm64 Mac.
- **Isolation.** Each test writes its scenario's evidence store into its own temporary folder and deletes it. Node
  built-ins and vitest only.
- **The base run** (`BASE-FAILURE.txt`): 18 tests, 18 failed, each at an assertion of its own in `helpers.ts`. The ten
  tests of the shipped program fail on the base's refusal of the new kinds (`out_of_range` at
  `items/<id>/modifiers/1/kind`, read by `admitted` or by the refusal judge, which wants `box_deform.*` or
  `mesh_deform.*`); the eight planted-program tests fail where the base refuses the unknown `planted` name
  (`{"ok": false, "code": "bad_input"}`), the four arithmetic ones after this suite's own twin has failed its judge.
  No `twins.json`.

## Fixtures

All generated in `helpers.ts` and `reference.ts`; no file on disk. Metres, +Y up, the item's own space. Documents in
the agent's form for `deep_show` (no `id`, no `layers`), `requires: {modules: {scene3d: "^1"}}`, a still camera.

- **The cube**: `slab@1 {size: [1, 1, 1]}` with `mod.subdivide@1 {levels: 1, scheme: simple}`, then the deform under
  test. `plain` is the same item with no deform: the stack's mesh before the modifier. Every test that reads a mesh
  checks `plain` first (`cubeOf`): every vertex 0 or 0.5 m from the centre (0, 0.5, 0) along each axis, 26 welded
  points (8 corners, 12 edge midpoints, 6 face centres), closed, wound outward, 1 m³.
- **The 2 m box**: from the cube's centre − 1 m to its centre + 1 m on each axis, so the cube's points sit at 0.25,
  0.5 or 0.75 along each axis of the box.
- **Grids**: `points` and `moves` with x fastest, then y, then z: point (i, j, k) is index i + nx × (j + ny × k). Every
  document writes all its moves out.
- **The octahedron**: 6 points in the order +x, −x, +y, −y, +z, −z, each `r` m from the cube's centre, 8 triangles,
  one per octant, wound outward (checked: every edge in two triangles, once each way, positive volume). `r` is 2 m
  (criteria 5, 6, 7), 1 m (criterion 7), and 2 m with the +y point 2.5 m out (criterion 6's rest move).
- **The bipyramids** (criterion 7): a ring of 63 (or 62) points 2 m out in the plane through the cube's centre and one
  point 2 m above and below: 65 (or 64) points, closed, manifold, wound outward, the cube more than 0.1 m inside.
- **The channel** (criterion 6): `{target: "items/crate/modifiers/1/params/moves/2", type: "vec3", keys: {k0: {t: "0s",
  value: [0, 0, 0], interp: "linear"}, k1: {t: "4s", value: [0, 1, 0]}}}`, with `transport: {span: "4s"}`.

## Criteria to tests

IDs are `#1929.` and the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the
leading `- [ ] ` dropped (`scripts/proof-change.mjs`'s `criterionId`). Each test's name starts with `AC<n> #1929.<id>`.
Each file's header states its fixture, numbers and wrong programs in full.

| ID | Criterion (short) | File (tests): what each asserts |
|---|---|---|
| AC1 `#1929.eabb0101` | A 2 × 2 × 2 grid over the 2 m box, its +x side moved (1, 0, 0) m, moves the cube's +x face 0.75 m and its −x face 0.25 m along x, nothing along y or z, and it holds 1.5 m³, within 1e-12 relative; planted own-bounds moves the +x face 1 m and fails, naming the vertex | `ac1-stretched-grid.test.ts` (2): (1) the closed form gives exactly 0.75 and 0.25 m on the two faces; every vertex moved as the closed form says (0.75, 0.5, 0.25 m along x; 0 along y and z) within 1e-12 relative, a 0 within 1e-12 m; the mesh's volume 1.5 m³ within 1e-12 relative. (2) The suite's twin, then `planted: box_deform_own_bounds`: every +x face vertex moved (1, 0, 0) m; the judge fails naming each of the face's nine points |
| AC2 `#1929.c629697d` | 3 × 3 × 3, only the centre point moved (0, 1, 0) m: corners 0.375³, face centres 0.5 × 0.375 × 0.5, edge midpoints 0.375² × 0.5 m along y within 1e-12 m, x and z unchanged; planted trilinear moves corners 0.125 m and face centres 0.5 m and fails, naming the vertex | `ac2-centre-point.test.ts` (2): (1) the three numbers are 0.052734375, 0.09375 and 0.0703125 and the closed form gives them at all 26 points; every vertex moved its kind's number along y and 0 along x and z, within 1e-12 m. (2) The suite's twin, then `planted: box_deform_trilinear_cells`: corners 0.125 m and face centres 0.5 m along y; the judge fails naming each of the 14 |
| AC3 `#1929.9ba17166` | Every move 0: positions equal the input bit for bit; every move (0.3, −0.2, 0.1) m: every point moves by that within 1e-12 m; on 2 × 2 × 2, 3 × 3 × 3 and 4 × 3 × 2; planted drops-last moves the points by less and fails, naming the vertex | `ac3-zero-and-uniform.test.ts` (2): (1) on each grid, the zero-move cube's every coordinate is `plain`'s same f64 (−0 apart from 0), and the uniform-move cube's every vertex moved (0.3, −0.2, 0.1) m within 1e-12 m. (2) The suite's twin, then `planted: box_deform_drops_last_weight`: on each grid every vertex moves by less on every axis; the judge fails naming every one of the 26 points |
| AC4 `#1929.2bce5ff8` | A cube vertex 0.01 m outside the box is refused at check with `box_deform.outside`, naming the item and the vertex; `points: [5, 2, 2]`, or 7 moves for 8 points, with `box_deform.params`; each with 0 builds; a planted clamping check builds and fails | `ac4-box-refusals.test.ts` (3): (1) the box's +x side at 0.49 m: refused, an error issue `box_deform.outside` names the item and exactly the +x face's nine points, each once, 0 builds; at 0.51 m the clean twin is presented and built. (2) `[5, 2, 2]` with 20 moves, and `[2, 2, 2]` with 7 moves: each refused with `box_deform.params` naming the item, 0 builds. (3) `planted: box_deform_clamps_outside`: presented, `builds` ≥ 1, a mesh of every vertex; the judge fails naming the missing code and the build |
| AC5 `#1929.f933a85f` | The 2 m octahedron: every move (0.3, −0.2, 0.1) m moves the cube by that; each point's move its own offset puts each vertex at twice its offset; only +y moved (0, 1, 0) m moves the +x, +y, +z corner 7/24 m and the +x, −y, +z corner 1/24 m along y; all within 1e-9 m; planted inverse distance passes the translation, puts the doubled corner 0.647193 m out, and fails, naming the vertex | `ac5-octahedron.test.ts` (2): (1) the closed form's weights sum to 1 and reproduce each place at all 26 points and give 7/24 and 1/24 at the corners; every vertex of `moved` by (0.3, −0.2, 0.1) m, of `doubled` by its own offset from the centre, of `lifted` by 7/24 or 1/24 m (corners) or its +y coordinate (other points) along y, each within 1e-9 m. (2) The suite's twin, then `planted: mesh_deform_inverse_distance`: the translation passes; the doubled +x, +y, +z corner is within 5e-7 m of 0.647193 m from the centre on each axis; the judge fails naming that corner |
| AC6 `#1929.ef5c1f92` | The +y move keyed (0, 0, 0) at 0 s to (0, 1, 0) at 4 s: over 120 frames at 30 fps the work counters show the bind computed once; frame 60 has moved the corner 7/48 m; frame 60 sought equals played bit for bit; the rest place at 2.5 m computes the bind once more; planted every-frame counts 120 binds, planted key-without-mesh keeps the old weights, each fails, naming the item | `ac6-bind-once.test.ts` (4): (1) played to frame 119, `work.binds` is 1 and every vertex is where the closed form puts it within 1e-9 m; after the revision that moves the +y point's rest place, played again, `work.binds` is 1 and every vertex follows the new mesh's weights. (2) Frame 60 played and sought, each in its own process: the corner 7/48 m along y (every vertex its weight × 0.5 m) within 1e-9 m; positions, normals and indices the same bit for bit. (3) `planted: mesh_deform_binds_every_frame`: `work.binds` is 120; the judge fails naming `crate` and the count. (4) `planted: mesh_deform_key_without_mesh`: after the rest move every vertex is where the old weights put it; the judge fails naming `crate` and the corner |
| AC7 `#1929.303648a3` | The 1 m octahedron: 8 corners outside, 12 edge midpoints on it, refused with `mesh_deform.outside` naming those 20 vertices, 0 builds; the 2 m octahedron less one triangle refused with `mesh_deform.mesh`, naming its 3 open edges; 65 points, the same code; a planted extrapolating deform builds and fails | `ac7-mesh-refusals.test.ts` (3): (1) the fixture's corners lie 0.289 m outside, edge midpoints on, face centres 0.289 m inside; refused, an error issue `mesh_deform.outside` names the item and exactly those 20 points, each once, 0 builds. (2) Seven triangles with three open edges: refused with `mesh_deform.mesh` naming the item and exactly those edges; 65 points: refused with `mesh_deform.mesh`; 64 points, the clean twin: presented and built. (3) `planted: mesh_deform_extrapolates_outside`: presented, `builds` ≥ 1, a mesh of every vertex; the judge fails naming the missing code and the build |

Test count: 2 + 2 + 2 + 3 + 2 + 4 + 3 = 18.

## The planted programs

Each is reachable only through `deep-show run`'s scenario `planted` (the name added to scene3d's `PLANTED`, as #420's,
#440's, #441's, #224's and #1636's are), and changes nothing else. Its process must exit 0 and answer; the judge that
passes the shipped program must fail on it, naming what its criterion says. A name the build doesn't know is refused
(`ok: false`), as at the base. For the four deforms that are pure arithmetic, `reference.ts` also holds this suite's
own twin, which the same test holds to the issue's wrong numbers and fails with the same judge, on the cube's 26
points, before it asks the program; it is the closed form's planted twin (design: a CPU reference counts only once it
reproduces a stated fixture and its own planted twin fails).

| Name | The wrong program | Criterion | What the test holds it to |
|---|---|---|---|
| `box_deform_own_bounds` | `mod.box_deform@1` measures (s, t, u) over the bounds of the mesh it takes, not over `from` and `to` | AC1 (issue-named) | The +x face moves (1, 0, 0) m; the judge names its nine points |
| `box_deform_trilinear_cells` | Each cell of the grid blends its eight points trilinearly, so a point's weight falls in a line to 0 one cell away, in place of the Bernstein polynomials | AC2 (issue-named) | Corners 0.125 m, face centres 0.5 m along y; the judge names the 14 |
| `box_deform_drops_last_weight` | The sum leaves out the grid's last point (index nx × ny × nz − 1) | AC3 (issue-named) | Every vertex moves by less on every axis, on all three grids; the judge names all 26 points |
| `box_deform_clamps_outside` | The check clamps a vertex outside the box into it instead of refusing the item | AC4 (issue-named) | Presented, `builds` ≥ 1, a row of every vertex; the judge names the missing `box_deform.outside` and the build |
| `mesh_deform_inverse_distance` | A vertex's weight for a control point is 1 ÷ its distance to it, over the sum of those | AC5 (issue-named) | The translation passes; the doubled +x, +y, +z corner stands 0.647193 m from the centre on each axis; the judge names it |
| `mesh_deform_binds_every_frame` | Every frame the session plays computes the bind again and reads no kept weights; the frames' positions are the shipped ones | AC6 (issue-named) | `work.binds` is 120 over the 120 frames; the judge names `crate` and the count |
| `mesh_deform_key_without_mesh` | The bind's content key leaves out the control mesh's points and triangles, so a revision that changes only them finds the kept weights | AC6 (issue-named) | After the rest move every vertex is where the 2 m octahedron's weights put it; the judge names `crate` and its corner |
| `mesh_deform_extrapolates_outside` | Vertices outside the control mesh, or within 1e-6 m of it, are deformed (extrapolated) instead of refusing the item | AC7 (issue-named) | Presented, `builds` ≥ 1, a row of every vertex (finite or not); the judge names the missing `mesh_deform.outside` and the build |

## The surface under test

The issue and the design name the two modifiers' fields, the four issue codes with their fields, the bind, its content
key and the planted programs, but no call. These tests enter through the one binary the base has for built geometry
read as data, `deep-show run` (#393), with `deep_show` and #420's `geometry` (#224's `play`). They add **two modifier
kinds**, **four issue codes with two list fields**, **one field on two kinds' stack rows** and **eight planted
names**. No new binary, no new call, no new request field. Every name below that the issue doesn't give is this job's
choice, listed again under Open points; the implementer provides exactly these, or disputes them.

### Documents

- `{"kind": "mod.box_deform@1", "params": {"from": [x, y, z], "to": [x, y, z], "points": [nx, ny, nz], "moves":
  [[x, y, z], …]}}` and `{"kind": "mod.mesh_deform@1", "params": {"mesh": {"points": [[x, y, z], …], "triangles":
  [[a, b, c], …]}, "moves": [[x, y, z], …]}}` in an item's `modifiers`, as every modifier at the base is written;
  class `deform`, on the CPU. `from`, `to`, the control mesh and the moves are in the item's own space, in metres.
- A channel binds a move by its path, `items/<id>/modifiers/<k>/params/moves/<j>`, with `type: "vec3"`.

### Issues at check

A refused revision answers `deep_show` with `outcome: "refused"` and an error issue whose `code` is the issue's:
`box_deform.outside`, `box_deform.params`, `mesh_deform.outside` or `mesh_deform.mesh`.

- **Naming the item.** The issue names the item in any of the base's three ways: an `item` field, the ID in `ids`, or
  a `path` at or under `items/<id>`.
- **Fields.** `vertices` and `edges` are read on the issue itself or in its `actual`, as #224's and #537's issues
  carry theirs.
- **Naming a vertex.** `vertices` is a list of vertex indices into the positions of the stack's mesh before the
  modifier. A deform keeps the count and order of vertices, so these are the indices `geometry` gives the same
  vertices in the item's row, and in `plain`'s. The list holds one entry per welded point (positions equal to 1e-6 m
  are one point), for every such point, up to 64: the cube has 96 vertices at 26 points, and the issue counts 26 and
  names 20. The judge takes any of a point's vertices as its name (the lowest index is the natural one, and the one
  the judges' own failures print, as `<item> vertex <index>`), and holds that each expected point is named exactly
  once and no other point is named.
- **Naming an open edge.** `mesh_deform.mesh` for an open control mesh carries `edges: [[i, j], …]`: each edge that
  only one triangle uses, by its two indices into `mesh.points`, in either order, each once.
- `reason` (`box_deform.params`, `mesh_deform.mesh`) is not read: neither the issue nor the design lists its values.

### 0 builds

After a refused revision, a `geometry` call for the item answers the base's `{"code": "no_revision"}` (the document
has no admitted revision, so there is nothing to build), or `builds: 0` with no row that holds positions. Either reads
as 0 builds. The two planted programs that build answer `builds` ≥ 1 and a row with positions, so the reading can see
a build.

### The stack's work counters

On a `geometry` call with `play`, the stack row of each `mod.box_deform@1` and `mod.mesh_deform@1` step carries

```json
{"kind": "mod.mesh_deform@1", "class": "deform", "reads_time": true, "enabled": true, "gpu": false, "work": {"binds": n}}
```

- `work.binds`: how many computations of that step's bind, every vertex's weights, the frames this call played
  made or were the first frames to read. A frame that reads weights an earlier frame already read adds 0.
- A revision's check is no frame. At the base it is a clean evaluation on a scratch session that reads and writes no
  cache (`Session::probe`), so there the first frame played after a revision computes the bind. A check that
  computed the weights and kept them would have them counted by the first play whose frames read them, once.
- Weights are kept by their content key across frames and across calls. So a play of 120 frames after the first
  revision answers 1, and a play of 120 frames after a revision that moves a control point's rest place answers 1
  again. Under `mesh_deform_binds_every_frame` the first answers 120: one computation per played frame.
- A call with no `play` (a seek: a clean evaluation at `t`) is not read for `work`.

### Played and sought

`{"call": "geometry", "doc", "items", "t": k × 23,520,000, "play": {"fps": 30}}` plays frames 0 … k (k + 1 frames)
through the session's frame path and answers the rows the played frame k holds; the same call with no `play` is a
clean evaluation at frame k's time, which is what a seek gives. Both are the base's.

## Open points

Each is a place where the issue or the design leaves the interface or the fixture open, the choice this job made, and
what in the base it follows. None was guessed silently; any may be disputed.

1. **The kinds' names.** `mod.box_deform@1` and `mod.mesh_deform@1`, with their fields under `params`. Follows the
   design's `kind: mod.<name>@v` and every modifier at the base (`stack.rs`'s `KINDS`).
2. **Where the cube is.** The issue says "centred on it"; the design doesn't say where a slab stands in its own
   space. The fixture takes the base's (the slab stands on its origin, its centre at (0, 0.5, 0)) and `cubeOf` fails,
   naming the vertex, if a build ever differs.
3. **"Within 1e-12 relative" for a component expected at 0** (criterion 1's "nothing along y or z") is read as within
   1e-12 m.
4. **"A cube vertex 0.01 m outside the box"** (criterion 4). An axis-aligned box cannot leave out one point of an
   axis-aligned cube alone, so the fixture's box leaves the +x face's nine points 0.01 m outside, and "naming the
   vertex" is naming each of the nine and none of the other 17. The Scope's `{item, vertices}`, "naming up to 64",
   asks for every outside vertex.
5. **How a vertex is named**: an index into the positions of the mesh before the modifier, one entry per welded
   point. Follows the base's two nearest conventions: a module's deform refusal names a mesh vertex as
   `items/<id>/modifiers/<k>/vertices/<index>` (`contributed.rs`, #226), and `geometry.shading` names a welded
   vertex by its first member (#453). Welded, because the issue counts the cube's 26 points and "those 20
   vertices", while the mesh has 96 vertices of which 72 lie outside the 1 m octahedron or on it, more than the 64
   an issue may name.
6. **Where an issue's fields are**: on the issue or in its `actual`. The base has both (`surface.nonfinite` spreads
   its fields; an operator's error carries them in `actual`), and #224's suite reads either.
7. **"Naming the item"** accepts `item`, `ids` or `path`. The base's `hull.flat {item}` names its item by `ids` and
   `path` only, `surface.nonfinite {item, u, v}` by an `item` field.
8. **`reason`'s values** are not asserted; only the codes the criteria state are. No convention at the base fixes
   them (the design's other `reason` fields are closed word lists, each given where it is defined).
9. **How an open edge is named**: `edges`, pairs of indices into `mesh.points`. The design's shape is `{item,
   reason}`, and the criterion asks for the three edges by name. There is no convention at the base for an issue
   that names edges of a mesh a document writes out: #453 names a glTF asset's edges as text
   (`<primitive>:<vertex>/<primitive>:<vertex>`), and `mark.line@1` rows give segments by their ends' positions.
   Index pairs follow the document's own `triangles`, which are index triples.
10. **"0 builds"** is read from `geometry`, the base's call that counts builds (`builds`), made after the refusal.
    The base gives a refused first revision no `builds` field at all (`no_revision`), so that answer is accepted as 0
    builds beside `builds: 0`. The base's own check runs `scene3d.build` on a scratch session to find a fault; the
    tests don't read whether a refusal happens before or inside that run.
11. **"The stack's work counters"**: `work: {binds}` on the step's stack row of a played `geometry` call, counted
    over that call's frames. There is no stack-level work counter at the base. The nearest conventions: #2017 puts a
    step's own reading on its stack row, outside the build's key (`ms`); #1640 counts a derivation per frame
    (`edge_sets_derived`) and reads "once" as 1 over the frames; #420's redraft reads "work counters" as nodes that
    `ran` in a frame, which cannot see a bind inside a node. Counting what the played frames computed or first read,
    never the check on its own, follows the base's `eval` and `frames`, which count a session's frames and never
    the check's scratch evaluation; it also keeps the count at 1 whether an implementation's check or its first
    frame computes the bind, and the planted every-frame count at exactly 120.
12. **"Over 120 frames at 30 fps"** is frames 0 … 119: `play` to frame 119. The channel's key at 4 s is frame 120,
    which is not played, so the planted every-frame stack counts exactly 120.
13. **"Computes the bind once more"** is `work.binds` 1 on the play after the rest-move revision, with the vertices
    at the new mesh's weights. Whether a replay with nothing changed computes none is not asserted.
14. **"Sought" and "played"**: `geometry` with no `play` and with `play`, each in a process of its own, as #224's and
    #420's suites compare them.
15. **"Bit for bit"** is every position, every normal and every index of the row, each coordinate the same f64 (−0
    is not 0). Criterion 3 compares positions only, as it says.
16. **The channel** is `type: "vec3"` on the move's own path. The base takes a `vec3` channel on a modifier's vector
    param (observed on `mod.array@1`'s `offset`).
17. **"The +y point's rest place to 2.5 m"** is 2.5 m out from the cube's centre, as the 2 m is. The corner's +y
    weight then falls from 7/24 to 0.23949575879648635 (`reference.ts`), which the issue doesn't state; the test
    holds the frame to the closed form, not to that literal.
18. **Beyond the stated points.** Where a criterion states some points (the two x faces; two corners), the judge holds
    every vertex to the Scope's formula through `reference.ts`, after the closed form has reproduced the stated
    numbers. The other corners of criterion 5 take 7/24 and 1/24 by the octahedron's symmetry.
19. **The 65-point control mesh** is a bipyramid, otherwise valid, so only its point count is at fault; the 64-point
    one beside it and the cube 0.01 m inside its box are clean twins, one step inside each rule (design: boundary
    pairs).
20. **The octahedron's point order and winding**, and which triangle is left out (the +x, +y, +z one), are this
    suite's.
21. **Planted programs live in the program**, selected by the scenario's `planted`, as every planted program of
    scene3d at the base does. The suite's own twins in `reference.ts` are test code and prove the judges and the
    closed forms, not the program.
22. **Mean value coordinates on the control mesh.** `reference.ts` leaves out the published special cases for a
    vertex on a control triangle or in its plane (it answers NaN, which no judge accepts); no vertex the shipped
    program is asked to deform lies there.

## Not tested

No criterion asks for these, so none is tested: `moves` left out (0 for every point); `on` naming a part, and
vertices outside the box that `on` doesn't name; a box with a side of 0 m; a non-manifold control mesh, one wound
inward, or one of fewer than 4 points; a vertex inside the control mesh but within 1e-6 m of it; the cap of 64 named
vertices; `reason`'s values; a keyed `box_deform` move and `work` on a box deform; `reads_time` and `class` on the new
rows; normals after a deform, apart from sought against played; a deform after another deform; the content key's
value; O(vertices × points) per frame; the GPU; an asset's skinned mesh. The Proof line's order (each planted program
shown failing first, then every fixture passing, on Spark) is the implementer's to show in the PR.

## What the implementer adds outside this folder

- The `scripts/lanes.mjs` line under Run them.
- In scene3d and `deep-show`: the two kinds, the four issue codes with `vertices` and `edges`, `work.binds` on the two
  kinds' stack rows of a played `geometry` call, and the eight planted names.
