# Acceptance tests for #1782: material-boundary mesh edges, and hidden spans that keep their dash phase

Written first, from issue #1782 (its scope, its eight acceptance criteria, its proof line and its "Runs on"), the
design section it links and base commit `16dc5eab0`, by a job that never saw an implementation; none existed. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding).

What was read:

- Issue #1782. Its oracle page was not fetched; the job's brief gives what it says for all eight criteria: no
  upstream test checks them, and edge sets and spans are our own data, checked against values worked by hand. So
  every expected value here is the issue's own number or small reference code in this folder.
- `docs/canvas-primitives.md` at the base: Marks in 3D: mesh edges (4674 to 4690, which already carries this
  issue's fields and rules: `material`, `hidden: {dash, paint}`, the span rule, edge IDs by rank, the `geometry`
  reply `{edge, from, to, hidden}`, the dash measured from the edge's start, the recompute rule), the item
  `materials` map (2829) and Cutaway `cutaway@1` (4872: `planes`, `applies_to`).
- `docs/technical-design.md`: Criteria to tests and Wrong programs (2647, 2650: a planted wrong program is never
  chosen by an environment variable), Dogfooding (2671), the parity suite (2691), Tests written first (2702).
- At the base, for call shapes only: `tests/acceptance/1640/` (README, `helpers.ts`, `reference.ts`, `edge-sets.ts`,
  `orbit.test.ts`, `depth-dash.test.ts`: `deep-gpu run [--backend noop] [--planted <name>]`, `view3d` with
  `counts: true`, `segments`, `edge_sets_derived`, `pixel_hash`, the ID target, the folded sheet), `tests/acceptance/
  440/helpers.ts` and `420/helpers.ts` (`deep-show run`, `deep_show`, the `geometry` call), `457/helpers.ts` (glass,
  blend, a cutaway), `1636/helpers.ts` (an item's `materials`), `1174/helpers.ts` (an orthographic camera, the
  `final` target); and in `crates/`: `deep-canvas-scene3d/src/geom.rs` (`EdgeKind::read`), `scene.rs` (`Line`,
  `EdgesOf`), `gltf.rs` (a primitive is the part `primitive.k`), `builders.rs` (`plate`), `cut.rs` (`applies_to`),
  `scene/scattered.rs` (`by_material`), `deep-canvas/src/camera.rs` (the orbit's eye), `deep-show/src/geometry.rs`
  (a mesh-edge line's row) and `deep-gpu-layer/src/main.rs`, `view3d.rs` and `view3d/parse.rs` (the planted table,
  the `counts` fields, `from`).

## What the base already does, which these tests don't credit

`deep-gpu` draws `mark.line@1` items with `edges` under `crease {angle}` and `border` on welded positions, dashes
them in their size space, depth-tests them, reports each line's `segments` and `edge_sets_derived` per frame with
`counts: true` on Metal and noop, and has #1640's planted names. `deep-show`'s `geometry` call answers a mesh-edge
line with `{id, kind, segments}`. `EdgeKind::read` reads `kind` and `border` alone: `material` is not read, and
no line reads `hidden`. No frame reports `spans`, `dashes` or `edge_spans_computed`, the `geometry` row has no
`spans`, and none of this suite's eight planted names exists. So the tests define the surface below. Each fixture
is guarded by something the base answers (a twin line's `segments`, the plane's `all` and border counts, a solid
swatch line's pixels), so a test that fails at the base fails on the missing surface and not on its fixture.
`BASE-FAILURE.txt` is the run at the base.

## Run them

Each file builds its binary once, copies it out under its own name into a temporary folder, and fails each test if
the build failed: `deep-gpu` as #1640's helper does (`cargo build --locked --bin deep-gpu`), and in
`geometry.test.ts` `deep-show` as #440's does (`cargo build --locked --bin deep-show --no-default-features
--features full`). Both honour `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless
set. So they run one file at a time. `scripts/lanes.mjs` may need `'tests/acceptance/1782/'` in its `alone` list, as
#1640's is; this README is the instruction, and the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1782 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1782/tsconfig.json
```

The edge sets, spans, IDs, dashes and counters run on wgpu's noop backend and on `deep-show`, and run anywhere (the
issue: "Spark for the edge sets and the spans"). The drawn frames need the reference Mac's Metal device and fail
with an `INCONCLUSIVE` message elsewhere, never pass: `dash.test.ts`'s two drawn tests, `orbit.test.ts`'s last test
and both of `unchanged.test.ts`. No criterion has a time budget; `orbit.test.ts` starts about 110 processes on a
100,000-triangle asset. A run with `--root tests/acceptance/1782` leaves Vitest's cache in
`tests/acceptance/1782/node_modules/.vite`; delete it.

`fixtures/base-frames.json` holds the base's pixel hashes for AC8. `node tests/acceptance/1782/record-base.ts`
wrote it once, at the base commit on the reference Mac, and refuses to run when HEAD is not the base or anything
outside this folder differs from it. Nobody runs it again; `unchanged.test.ts` only reads the file.

## The surface under test

The issue and the design name the documents (`edges.material`, `hidden: {dash, paint}`), the span shape
`{edge, from, to, hidden}`, the `geometry` call, edge IDs by rank, the noop lane and the pixel-hash comparison, but
no per-frame report, no counter and no planted name. These tests enter through `deep-gpu run`, the binary that draws
mesh edges and that #1640's suite drives, and add the smallest surface they need: **one field on mesh edges**
(`material`), **one field on mesh-edge lines** (`hidden`), **three per-frame reports on `view3d`** (`spans`,
`dashes`, `edge_spans_computed`), **one field on the `geometry` row of `deep-show run`** (`spans`) and **eight
planted names**. Everything #377's, #378's, #420's and #1640's READMEs define for `deep-gpu run` holds unchanged,
and so does #420's and #440's `geometry` call. No new binary, no new call. Every name below that the issue doesn't
give is this job's choice, and the implementer must provide it as spelled.

### Documents

- `mark.line@1 {edges: {of, kind: {"crease": {"angle": deg}}, border?: bool = true, material?: bool = false}, …}`.
  `material` sits beside `border` and is read with the crease kind only. With `material: true` the line also picks,
  on welded positions, each edge with two faces whose triangles draw with different materials on the item `of`
  names. A triangle's material is the one the item's `materials` map gives a named part that holds it, else the
  item's `material`: the rule the base draws parts by. An edge that crease, border and material pick more than
  once is one edge and one segment.
- `mark.line@1 {edges, width, size_space, dash?, paint, hidden?: {dash?: [on, off], paint}}`. `hidden` sits beside
  `edges` in the line's params. `hidden.dash` and `hidden.paint` are spelled as the line's own `dash` and `paint`,
  and `hidden.dash` is read in the line's `size_space`. With `hidden` set, each stretch of a picked edge that
  opaque geometry hides from the camera at t draws with `hidden.dash` and `hidden.paint`, over what hides it. Every
  other stretch draws as before, with the line's own `dash` and `paint`.
- What hides: every drawn mesh whose material is opaque. An item whose material has `transmission` above 0, or
  `alpha_mode: "blend"` or `"add"`, hides nothing. A `cutaway@1` in effect removes the part of an occluder it cuts
  (`applies_to` names the items it reaches, as at the base). The faces that share an edge never hide it.
- Named parts for the plane come from the base's importer: primitive k of a `mesh.asset@1`'s glTF mesh is the part
  `primitive.k`. The base has no builder whose flat plane has a part per column.
- Documents reach `deep-gpu` as a session holds them (#378), with glTF files in `view3d`'s `assets` (#420), and
  reach `deep-show` as an agent's `deep_show` payload (#393).

### An edge's ID and start

- A line's picked edges are ordered by their welded ends in the mesh's own space. An edge's **start** is the lesser
  of its two ends, comparing x, then y, then z; its end is the other. Edges are ordered by start, then by end.
- An edge's **ID** is its 0-based rank in that order, a JSON integer: the `edge` of every span and dash. It doesn't
  depend on the camera, on t, on any other item or on which stretch is hidden.
- `from` and `to` are metres along the edge from its start, in the world: 0 ≤ `from` < `to` ≤ the edge's length.
- No report carries an edge's ends. The tests rank the edge set themselves: from the `segments` of a twin line
  with no `hidden` and no `material`, drawn in a guard document the base answers, or for the orbit from the
  reference mesh, with that twin as its guard. They name an edge by ID and ends.

### `deep-gpu run`: `view3d` frames gain three reports (with `counts: true`)

```json
{"frame": n, …, "segments": {…}, "edge_sets_derived": {line ID → count},
 "spans":  {line ID → [{"edge": k, "from": m, "to": m, "hidden": bool}, …]},
 "dashes": {line ID → [{"edge": k, "from": m, "to": m, "hidden": bool}, …]},
 "edge_spans_computed": {line ID → count}}
```

Reported on every frame, on the noop backend too. The three new maps list every `mark.line@1` that has `edges` and
`hidden`; the tests read no other line's entry.

- `spans`: the line's spans at the frame's t, ordered by `edge`, then by `from`. An edge's spans tile it: the first
  starts at 0, each next starts where the last ended, the last ends at the edge's length, and neighbours differ in
  `hidden`. So an edge nothing hides is one span, and no span has zero length.
- `dashes`: every stretch of the line the frame inks, in the same shape and order. For a span whose style has a
  dash `[on, off]` (the line's `dash` for a visible span, `hidden.dash` for a hidden one) these are the parts of
  the span inside `[k·(on + off), k·(on + off) + on]`, k = 0, 1, …, measured from the edge's start in the line's
  size space. For a span whose style has no dash it is the span itself. `hidden` is the span's. The tests read
  `dashes` only on `size_space: "world"` lines, where the size space is metres along the edge.
- `edge_spans_computed`: how many times the frame computed the line's spans; 0 when it drew the spans it held.
  "A still view recomputes no span" is 1 in the first frame and 0 in every later frame while the camera, the mesh
  and the occluders hold. A frame whose camera moved reports 1.
- `edge_sets_derived` is #1640's, unchanged in shape. It counts the whole pick set, material edges included.
- `segments` for a line without `hidden` is as at the base: one `[a, b]` per picked edge, in world metres. What it
  lists for a line with `hidden` is not read.

A hand-worked value is compared within 1e-5 m, the issue's tolerance. The same t evaluated in another order or
another process must give equal JSON: the same numbers, digit for digit.

### `deep-show run`: the `geometry` row of a mesh-edge line with `hidden` gains `spans`

```json
{"id": line ID, "kind": "mark.line@1", "segments": […], "spans": [{"edge": k, "from": m, "to": m, "hidden": bool}, …]}
```

The same list a frame at the call's `t` reports, through the document's camera at `t`.

### Drawn frames (Metal, the reference Mac)

A visible dash draws in the line's paint under mesh edges' depth rule, as at the base. A hidden dash draws in
`hidden.paint` over the geometry that hides it. Both write the line's ID in the `ids` target (#378), where the
tests read which pixels a dash covers; the paint is read from the `final` target. "The same frame by pixel hash"
is the frame's `pixel_hash` (#378).

## Planted programs

`deep-gpu run --planted <name>`, each reachable only there (the base's mechanism). A test that names one runs the
criterion's own check against it and asserts that the check fails, naming what the criterion says, and that the
planted run shows the issue's wrong value.

| Name | The wrong program | Criterion |
|---|---|---|
| `edges_material_every_shared` | With `material: true` the picker keeps every edge two faces share, whatever their materials | AC1: the plane draws 8 |
| `edges_spans_cast_nothing` | The classifier casts against no geometry: every picked edge is one visible span | AC2: 12 visible |
| `edges_spans_ends_only` | The classifier tests an edge's two ends only and splits nowhere between them: an edge whose two ends are seen is one visible span | AC3: one visible span |
| `edges_spans_no_perspective` | The classifier casts every ray along the camera's view axis, under a perspective camera too, so a blocker hides its own width | AC4: 0.4 to 0.6 m hidden |
| `edges_dash_restarts_at_split` | A span's dashes are measured from the span's `from` instead of from its edge's start | AC5: the first hidden dash ends at 0.38 m |
| `edges_spans_count_glass` | The classifier counts an item whose material has `transmission` above 0 as an occluder | AC6: the pane hides 0.3 to 0.7 m |
| `edges_spans_cache_no_camera` | The span cache's key leaves the camera out: while the mesh and the occluders hold, a frame returns the spans and dashes the process computed first | AC7: t = 0's spans at t = 0.1 s |
| `edges_id_from_draw_order` | `edge` numbers the edges in the order the frame draws spans (every visible span first, then every hidden one, each group in rank order) instead of by rank | AC8: IDs move with the camera |

AC8's pixel-hash comparison takes #1640's `crease_below_angle` (another edge set, at the base already) as its
planted-mismatch twin.

## Fixtures

Every fixture is generated in code; the one file is the base's hashes. All draw with #1640's look
(`../1640/fixtures/look.json`) at 640 × 480.

| Fixture | What it is | Read by |
|---|---|---|
| The plane (`reference.ts`: `planeParts`, `gltfParts`) | 1 × 1 m in y = 0, 2 × 2 quads, 8 triangles, a glTF whose primitives have their own vertices: two columns split at x = 0, or four quads. Three `mesh.asset@1` items read it: `plane` (a material per column), `plane_one` (both columns on one material), `plane_quads` (a material per quad) | AC1 |
| The cube (`cube.ts`) | #1640's 1 m `slab@1` cube and AC4 camera (2.4, 1.9, 3.2) looking at (0, 0.25, 0); a twin line and a line with `hidden: {paint}` | AC2, AC8 |
| The ridge (`ridge.ts`; `reference.ts`: `fold`, `quad`) | The fold, two quads meeting at 90° along (−0.5, 0, 0) to (0.5, 0, 0) and running back to z = −0.5 m; one flat quad in the plane z = 2 m between it and a camera on +Z, orthographic (1.6 m across) or perspective at (0, 0, 4); the quad's material is opaque, transmission 1 or `alpha_mode: blend`; a cutaway of x > 0 that reaches the quad alone | AC3, AC4, AC5, AC6 |
| The orbit (`reference.ts`: `ORBIT`, `sheetHides`) | #1640's folded sheet (100,000 triangles) and camera (35° up, 9 m from (0, 0.5, 0)), turning once in 10 s from azimuth 45°; its four fold lines are 800 edges of 0.02 m; the sheet as five flat strips is the reference for what it hides of itself | AC7 |
| `fixtures/base-frames.json` (`unchanged.ts`, `record-base.ts`) | The base's `pixel_hash` for #1640's crease-edges scene, its AC4 cube (solid, screen dash, world dash), frames 0, 150, 300 and 450 of its orbit, and a canary (the cube with no line) | AC8 |

The CPU references are `reference.ts`: the ranking of edges by welded ends, the meshes above, where a dash inks an
edge, the sheet's self-occlusion, the seeded shuffle, and the issue's numbers with the sentence each comes from.
`helpers.ts` holds the calls, the replies' readers and the checks every span list is held to; #1640's helpers are
imported, not copied. `cube.ts`, `ridge.ts` and `unchanged.ts` hold a fixture each for the files that share it.
None of these carries a test.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the
leading `- [ ] ` dropped (#607's command, with the issue's eight criterion lines on stdin). Each test's name starts
`AC<n> #1782.<id>`. "noop" is `deep-gpu run --backend noop`, on any machine. "Metal" is the reference Mac, and
fails with an `INCONCLUSIVE` message anywhere else. Where a criterion names a wrong program, a test runs it through
`--planted`, asserts the issue's wrong value, and asserts that the criterion's own check fails on it, naming what
the criterion says. 24 tests in 8 files.

| ID | Criterion, in a few words | Test file (tests) | What the tests assert, and the wrong program |
|---|---|---|---|
| AC1 `#1782.99240d77` | A 2 × 2 plane with a part per column draws 2, 10, 0 and 4 | `material.test.ts` (2), noop | Guards the base answers: `all` draws the plane's 16 welded edges, crease with border its 8, and a `materials` map naming `primitive.0` and `primitive.1` is admitted. Then `material: true, border: false` draws 2 segments that run end to end along x = 0 from z = −0.5 to 0.5 m, neither a diagonal; `border: true` draws 10; both parts on one material 0; the four-primitive plane with a material per quad 4. `edges_material_every_shared` draws 8 and fails, naming `plane` and 8 |
| AC2 `#1782.977b8e45` | A cube in a three-quarter view: 12 spans, 9 visible, 3 hidden | `cube.test.ts` (2), noop; `geometry.test.ts` (1), `deep-show` | Guard: the twin line draws the cube's 12 edges, 1 m each, three meeting the corner farthest from the camera. 12 spans in edge order, edges 0 to 11 once each, each 0 to 1 m, hidden exactly at the three ranks that meet that corner. `edges_spans_cast_nothing` reports 12 visible and fails, its first failure naming the lowest-ranked hidden edge. On `deep-show` the `geometry` row's `spans` pass the same check |
| AC3 `#1782.53389245` | An orthographic blocker over the middle 0.4 m | `blocker.test.ts` (2 of 6), noop | Guard, in every ridge test: the twin line draws the ridge alone. Edge 0's spans are 0 to 0.3 m visible, 0.3 to 0.7 m hidden and 0.7 to 1 m visible, each end within 1e-5 m. `edges_spans_ends_only` reports one visible span and fails, naming edge 0 |
| AC4 `#1782.183712ab` | Its perspective twin, a 0.2 m blocker halfway | `blocker.test.ts` (2 of 6), noop | The same three spans within 1e-5 m. `edges_spans_no_perspective` hides 0.4 to 0.6 m and fails, naming edge 0 |
| AC5 `#1782.91964396` | Dashes keep the edge's phase across a split | `dash.test.ts` (4): 2 noop, 2 Metal | Spans split at 0.33 and 0.73 m. In `dashes` the first hidden one ends at 0.35 m, the next starts at 0.40 m, the first visible one after the blocker is 0.73 to 0.75 m, and the whole list is the reference's, within 1e-5 m. `edges_dash_restarts_at_split` ends its first hidden dash at 0.38 m and fails, naming edge 0. On Metal, after a swatch frame the base draws (the twin line alone, solid, in `hidden.paint`), the frame carries the line's ID at the middle of each reference dash, over the blocker too, and at the middle of no gap; hidden dashes have the swatch's color and visible ones don't, which is that comparison's mismatch twin. The planted run inks the gap 0.35 to 0.4 m and fails, naming edge 0 |
| AC6 `#1782.078d7c3c` | Glass and blend hide nothing; a cutaway cuts the blocker | `blocker.test.ts` (2 of 6), noop | With `pane` (transmission 1) or `veil` (`alpha_mode: blend`) in the blocker's place, edge 0 is one visible span. With a cutaway that removes the blocker past x = 0, only 0.3 to 0.5 m is hidden, so a classifier that hides nothing fails here too. `edges_spans_count_glass` reports a hidden span behind the pane and fails, naming `pane` |
| AC7 `#1782.b25597d6` | The orbit: the same IDs, spans and dashes in every order, and counted | `orbit.test.ts` (5): 4 noop, 1 Metal | Guards: by the reference alone, no fold edge is hidden at some of the 100 times and some are at others, and the hidden set at t = 0.1 s isn't t = 0's; the twin line draws the reference's 800 edges. Forward: at every time the spans are in edge order with every edge tiled, the span over each edge's middle is hidden exactly when the reference says the sheet hides it, and every edge has a dash; `edge_sets_derived` is 1 in frame 0 and 0 after; `edge_spans_computed` is 1 in every frame. In reverse, in the seeded shuffle and one per fresh process, each time's `spans` and `dashes` equal the forward run's, number for number. With the camera still, 4 frames give 1, 0, 0, 0 for both counts and the same spans. `edges_spans_cache_no_camera` returns t = 0's spans at t = 0.1 s forward, and the same-in-every-order check against a fresh process fails, naming the first span that differs. On Metal the 100 frames have the same `pixel_hash` forward and in reverse, and under the planted cache the first two don't |
| AC8 `#1782.c6ee5604` | IDs don't move; #1640's frames don't change | `ids.test.ts` (2), noop; `unchanged.test.ts` (2), Metal | The cube from #1640's camera, from a camera moved to its left, and from the first again with an unrelated box behind it: in each frame the 12 whole-edge spans are hidden exactly at the ranks of the edges that meet that camera's far corner, and the two cameras' far corners differ. `edges_id_from_draw_order` fails, naming the first hidden edge of each camera. The canary's `pixel_hash` is the recorded one (else `INCONCLUSIVE`); then each of #1640's eight fixture frames, drawn with `hidden` unset and `material` false, has the hash recorded at the base. Under `crease_below_angle` the canary still matches and every one of the eight differs, each named |

## Readings where the issue and design leave a choice

- **Three-quarter view.** #1640's AC4 view: a perspective camera above, to the right and in front of the cube, so
  three faces show and one corner is farthest. The three hidden edges are the ones that meet that corner. Each is
  hidden from end to end: its own two faces are back faces, and the faces in front cover all of it.
- **A 1 m edge.** The ridge of a fold: two quads that meet at 90° along a 1 m edge, a glTF asset, read with
  `crease {angle: 30}` and `border: false`. The line picks that edge alone, so it is edge 0. The ridge points at
  the camera, so nothing of its own mesh is in front of it.
- **An edge's start.** The lesser of its two welded ends by x, then y, then z, in the mesh's own space. The ridge
  runs from x = −0.5 to 0.5 m, so "0.33 to 0.73 m" is x from −0.17 to 0.23 m. This binds a line with `hidden`. A
  line without it keeps the base's dash wherever the base starts it, as "byte for byte what it was" needs, and
  these tests read no dash on such a line: the swatch and the guards' twin lines are read for where they draw only.
- **An ID that no report shows by its ends.** An edge's ID is checked through what it must say. On the cube, the
  hidden ranks are those of the edges that meet the far corner, from each of two cameras whose far corners differ.
  On the sheet, each rank's span over its edge's middle is hidden exactly when the reference hides that point.
- **How an edge is named.** By its ID and its two ends, `edge 0 (−0.5, 0, 0)–(0.5, 0, 0)`; a cube edge also by its
  corners' signs, as #1640 names them. "The first hidden edge" is the hidden edge with the lowest ID.
- **The blocker.** A flat quad with no thickness, facing the camera, so its silhouette is exact: 0.4 m wide at any
  distance under the orthographic camera; 0.2 m wide and 2 m from a perspective camera 4 m away, where its shadow
  on the edge is 0.4 m. The pane and the veil are the same quad with another material. The cutaway's `applies_to`
  names the blocker only, so it never cuts the edge's own mesh.
- **The 100 fixed times.** t = k ÷ 10 s for k = 0 to 99: the frames of the 10 s orbit at 10 fps. Forward is one
  `view3d` call (`fps: 10, frames: 100`). Reverse and the shuffle are one process each, with one call per time
  (`from: k, frames: 1`, #380's seek, whose frame is numbered k). A fresh process is one `deep-gpu run` per time.
  The shuffle is a fixed permutation from a seeded generator in the suite (seed 1782).
- **The orbit.** #1640's sheet and camera, but turning from azimuth 45° to 405°. From #1640's azimuth 0° the sheet
  hides none of its fold lines for the first 1.2 s, so a cache that ignores the camera would return right spans at
  the second time. From 45° the reference hides 166 of the 800 edges' middles at t = 0 and 170 at t = 0.1 s, none
  between 2.6 and 4.7 s, and up to 400. The reference is the sheet as its five flat strips: a point of a fold line
  is hidden when the segment from it to the eye meets a strip past the point. Edges whose middle is within 0.1 mm
  of a change of visibility are left to the tiling rules.
- **"The pick set is derived once" and "a still view recomputes no span".** Counted in a process that draws the
  one line and nothing before it: `edge_sets_derived` is 1 in frame 0 of the orbit and 0 in the other 99, with
  `material: true` on the line so the count covers the material set; `edge_spans_computed` is 1 in every frame of
  the orbit, whose camera moves, and 1, 0, 0, 0 over four frames of the same document with no channel on the camera.
- **How a dash's start and end are observed.** As data, from `dashes`, because 1e-5 m is far below a pixel: each
  inked stretch as `{edge, from, to, hidden}`, in metres from the edge's start. AC7's "dash phases" are the same
  lists. The drawn frame is checked at pixel scale only: ink at the middle of each dash, none at each gap's.
- **How criterion 8 compares with the base.** By hashes recorded once at the base on the reference Mac, in
  `fixtures/base-frames.json`: the base commit, one `pixel_hash` per #1640 fixture frame, and a canary frame that
  holds no mesh-edge line. The test draws the same documents and compares. If the canary's hash differs, this
  machine doesn't draw as the recording one did, and the test fails `INCONCLUSIVE`. It is the cheapest design: no
  second checkout and no base build at test time. It passes at the base, as an unchanged frame must.

## Not tested, because no criterion asks

`material` with a kind other than `crease`, and its default of `false` beyond #1640's frames staying as they were;
a part the `materials` map doesn't name, which takes the item's `material`; an edge with more than two faces;
material edges of an item's `#part`. `hidden` on a line without `edges`; `hidden.dash` and `dashes` on a
screen-space line; `dashes` for a style with no dash; a `hidden.paint` other than a role fill. Items at
`alpha_mode: add`, which the scope lists and criterion 6 doesn't, and a transmission between 0 and 1. Spans on a
rotated or scaled item, and edge order there. A recompute when the mesh or an occluder changes: only a moved
camera and a still view are counted. The `geometry` reply at a time other than 0 s, and its agreement number for
number with a frame's `spans`: it is held to the cube's hand-worked spans. `segments` for a line with `hidden`.
On Metal, the pixel where a dash starts or ends, its caps and its width: the frame is read at the middle of
dashes and gaps. Silhouettes, intersection lines, shadow outlines and occluders that hide by their opacity, which
the issue leaves out. No criterion has a time budget.
