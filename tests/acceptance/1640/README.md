# Acceptance tests for #1640: Feature edges — mesh edges picked by crease angle and open borders

Written first, from issue #1640 (its scope, its four acceptance criteria and its proof line), the design section it
links and those it leans on, its oracle page, and base commit `a3efe5c8` ("Merge pull request #1746 …"), by a job
that never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof);
a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- Issue #1640 and its oracle page (`doneright/oracles/issues/1640.md` in `DeepBuildAI/deepbuild`, branch
  `doneright`): no upstream test for any of the four criteria ("the upstream edge test pins a different threshold
  rule"), so every expected value here is the issue's own.
- `docs/canvas-primitives.md`: Marks in 3D: mesh edges (4638: `edges: {of: ID[#part], kind: all | quads | cage}` on
  `mark.line`, drawn in segments mode; "counted on welded positions, so an edge split for its normals draws once";
  "Each edge is one segment, drawn with the line's width, dash and paint"; "Edges test depth with a bias toward the
  camera at the edge's slope, so the faces an edge bounds never hide it and faces in front of it do"; "derived again
  whenever the mesh rebuilds"); Marks in 3D: lines (4615: `mode: segments`, "`dash` in the line's size space") and the
  3D marks' common `size_space: screen | world = screen`; Paint's stroke `dash: [u]` (1676), for the dash's shape.
- `docs/technical-design.md`: the parity suite (2643: our own documents, "a planted-fault twin for every fixture",
  expected values set outside the implementation, "Every comparison between two outputs has a planted-mismatch twin",
  CPU references as reviewed test code); Dogfooding (2623); Tests written first (2654).
- At the base, to learn call shapes only: `tests/acceptance/420/` (README, `helpers.ts`, `edges.test.ts`: `deep-gpu
  run [--backend noop] [--planted <name>]`, `view3d`'s `segments` with `counts: true`, the object-ID target and
  `readIds`, `edges_skip_depth`), `tests/acceptance/440/` (README, layout, `BASE-FAILURE.txt`, the AC IDs),
  `tests/acceptance/378/` (the 10 s orbit on a camera channel, per-frame `pixel_hash`), `tests/acceptance/1297/`
  (a JSON glTF as `mesh.asset@1`), `crates/deep-show/src/geometry.rs`, `crates/deep-canvas-scene3d/src/geom.rs`
  (`Mesh::edges`, `edge_list`, `EdgeKind`), `scene.rs` (`EdgesOf`, `edge_line`, `plant_edges`, `mod.dash@1`),
  `builders.rs` (slab, lathe, ball, plate), and `crates/deep-gpu-layer/src/main.rs` and `view3d.rs` (the planted
  table, the `counts` fields).

## What the base already does, which these tests don't credit

`deep-gpu` draws `mark.line@1` items with `edges: {of, kind: "all" | "quads" | "cage"}` on welded positions, reports
each mesh-edge line's segments per frame with `counts: true` on Metal and noop, depth-tests them with a bias, and has
#420's `--planted edges_skip_depth`. There is no crease kind: `edge_line` reads `kind` only as a string, so the
object `{"crease": {...}}` falls back to the default `quads` (which happens to draw a slab cube's 12 edges, so the
cube alone would pass AC1's count at the base; the cylinder and the ball don't), and `"crease"` as a string is
refused. `border` is not read. A 3D line takes no `dash` field (only the `mod.dash@1` stroke modifier, in metres). No
frame reports how often an edge set was derived, and none of this suite's three planted names exists (`deep-gpu`
answers an unknown `--planted` with `bad_input`). So the tests define the surface below.

## Run them

Each file builds `deep-gpu` (`cargo build --locked --bin deep-gpu`, honouring `CARGO_TARGET_DIR`, with
`CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set) once, copies it out under its own name into a
temporary folder, and fails each test if the build failed. So they run one file at a time. `scripts/lanes.mjs` may
need `'tests/acceptance/1640/'` added to its `alone` list, as #420's and #440's are; this README is the instruction,
and the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1640 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1640/tsconfig.json
```

The edge sets and counts (AC1, AC2, AC3's first two tests) run on wgpu's noop backend and run anywhere (the issue:
"Spark for the edge sets and counts"). The drawn frames (AC3's hash comparison, all of AC4) need the reference Mac's
Metal device and fail with an `INCONCLUSIVE` message elsewhere, never pass. No criterion has a time budget. A run
with `--root tests/acceptance/1640` leaves Vitest's cache in `tests/acceptance/1640/node_modules/.vite`; delete it.
`BASE-FAILURE.txt` is the run at the base.

## The surface under test

The issue names the kind, its two fields, the derive count, the noop lane, the pixel-hash comparison and a planted
program, but no code API. These tests enter only through `deep-gpu run`, the binary that draws mesh edges, and add
the smallest surface they need: **two fields on mesh edges** (`kind: {crease}`, `border`), **one field on 3D lines**
(`dash`), **one per-frame report on `view3d`** (`edge_sets_derived`), and **three planted names**. Everything #377's,
#378's and #420's READMEs define for `deep-gpu run` holds unchanged. No new binary, no new call. Every name below the
issue doesn't give is this job's choice, and the implementer must provide it as spelled.

### Documents

- `mark.line@1 {edges: {of: ID[#part], kind: "all" | "quads" | "cage" | {"crease": {"angle": deg}}, border?: bool =
  true}, width, size_space, dash?, paint}`. The crease kind is spelled as the base's other variants with fields are
  (`tone_map: {agx: {…}}`, `uv0: {planar: {axis}}`): an object with one key naming the variant; `"crease"` as a bare
  string means `angle: 30`, the issue's default, though no test uses that spelling. `border` sits beside `kind` on
  `edges`, as the issue's scope lists it beside the kind; the tests read it only with the crease kind.
- A crease line draws, on welded positions, each edge whose two faces' normals are more than `angle` apart, and,
  with `border: true`, each edge that has one face. Each is one segment, drawn with the line's width, dash, paint and
  size space, under mesh edges' depth rule, as `quads` draws.
- `dash: [on, off]` on a 3D `mark.line@1` (Marks in 3D: lines: "`dash` in the line's size space"; Paint's `dash: [u]`):
  lengths in px when `size_space` is `screen`, in m when it is `world`. On a mesh-edge line each edge dashes along
  its own length; where a dash starts on each edge is not checked.
- `mesh.asset@1 {sha256, node: 0}` with the glTF given in `view3d`'s `assets`, as #420's.
- Documents reach `deep-gpu` as a session holds them (#378: `id`, one writer layer, every item's `layer`).

### `deep-gpu run`: `view3d` frames gain `edge_sets_derived` (with `counts: true`)

```json
{"frame": n, …, "segments": {line ID → [[a, b], …]}, "edge_sets_derived": {line ID → count}}
```

Reported on every frame, on the noop backend too, listing every `mark.line@1` with `edges`: how many times that frame
derived the line's edge set (0 when it drew the set it already held). "Derived once per mesh content key" is a
count of 1 in frame 0 and 0 in every later frame while the mesh's key holds.

### `deep-gpu run --planted <name>` names added (each reachable only there)

| Name | The wrong program | Criterion |
|---|---|---|
| `crease_below_angle` | A crease line keeps the edges whose faces meet below the angle instead of above it (borders as before) | AC1 (issue-named); reused by AC2 (it keeps the plane's diagonal) and as AC3's planted-mismatch twin (another edge set) |
| `edges_derive_every_frame` | A mesh-edge line derives its edge set again in every frame instead of once per mesh content key | AC3 (issue-named: "a run that derives it every frame") |
| `edges_dash_other_space` | A mesh-edge line reads its `dash` in the other size space: px as m on a screen-space line, m as px on a world-space one | AC4 |

AC4's depth half reuses #420's `edges_skip_depth` (mesh-edge lines drawn without the depth test), unchanged: a crease
line is a mesh-edge line, so the planted program must reach it.

## Fixtures

| Fixture | What it is | Read by |
|---|---|---|
| `parity/geometry/crease-edges.scene` | A 1 m slab@1 cube, a 32-segment lathe@1 cylinder with flat caps (radius 0.5 m, y from 0 to 1 m), a 32 × 16 UV ball@1, a 1 × 1 m plate@1 of one cell (2 triangles), the crease lines reading them (the plane's with `border: true` and `false`), `all` lines as fixture guards, the issue's expected counts with the sentence each comes from, and the twin with the names its failure must carry | AC1, AC2 |
| `look.json` | A copy of #420's acceptance look | all |

AC3's asset and AC4's document are generated in their test files. The CPU references are `reference.ts`: vector
math, welding at 1e-6 m, the crease and border rule on a triangle mesh, the 100,000-triangle folded sheet and its
JSON glTF, and #378's pinhole projection. `edge-sets.ts` draws the AC1/AC2 fixture and holds its per-case checks.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the
leading `- [ ] ` dropped (#607's command, as #305's README gives it, with the issue's four criterion lines on
stdin). Each test's name starts with `AC<n> #1640.<id>`. Where a criterion names a wrong program, the test runs it
through `--planted` and asserts it fails the way the criterion says, naming what it says.

| ID | Criterion | Tests, what each asserts, and the wrong programs |
|---|---|---|
| AC1 `#1640.b30fa4ba` | With `crease {angle: 30}`, a 1 m cube (12 triangles) draws exactly 12 segments, a 32-segment cylinder with flat caps draws 64 (its two rims) and none on its side, and a 32 × 16 UV ball draws 0. A planted test that keeps edges below the angle instead of above it fails, naming the item and the count | `crease.test.ts` (2), noop: the fixture's counts are the issue's; the cube's `all` guard draws 18 (a closed 12-triangle mesh); the cube draws exactly 12 segments, each a 1 m box edge between 8 corners, none twice; the cylinder 64, 32 on each rim at radius 0.5 m, none on its side or inside a cap; the ball 0. `--planted crease_below_angle` draws other counts for all three and the check fails with `crease edges of cube draw 6 segments, not 12` (its face diagonals) and the same sentence, with the count drawn, for the cylinder and the ball. Wrong programs: edges kept below the angle; every face edge drawn; the side's facets drawn; an angle read in radians; edges counted unwelded |
| AC2 `#1640.1f4212e3` | A 2-triangle plane draws 4 border segments with `border: true`, 0 with `border: false`, and never its diagonal | `border.test.ts` (2), noop: the plane's `all` guard draws 5 (4 border edges and its diagonal); with `border: true` exactly 4 segments, one on each side of the square, none between opposite corners; with `border: false`, 0. `--planted crease_below_angle` draws the diagonal and fails, naming it (`crease edges of plane draw its diagonal`). Wrong programs: `border` ignored either way; the diagonal kept; a border read as a crease with a missing face |
| AC3 `#1640.e3cdf8ce` | A 10 s orbit of a 100,000-triangle asset with crease edges derives the set once, counted on the noop lane, and every frame equals by pixel hash a run that derives it every frame | `orbit.test.ts` (3): on noop, 600 frames at 60 fps of a camera orbiting a 100,000-triangle folded-sheet glTF once: every frame reports `edge_sets_derived` for the line, frame 0 derives once and no later frame again (1 in all), and frames 0 and 599 draw exactly the CPU reference's 800 crease edges (four fold lines of 200, `border: false`); on noop under `edges_derive_every_frame` every frame derives it, so the count can see a derivation; on Metal every one of the 600 frames' pixel hashes equals the `edges_derive_every_frame` run's, the frames differ (the orbit moves), and the planted-mismatch twin, the first 30 frames under `crease_below_angle`, differs at every frame. Wrong programs: a set derived per frame or per camera move; a cached set that draws differently from a fresh one; a counter that always reads 1 or 0 |
| AC4 `#1640.4ab59ee2` | A crease edge on the far side of the cube never draws over its near faces, and with `dash` it dashes in its size space | `depth-dash.test.ts` (5), Metal, three-quarter view, ID target: the crease line draws the cube's 12 edges; the 9 near edges draw unbroken at 3 ± 1.5 px, the 3 at the far corner nowhere clear of the near edges; `--planted edges_skip_depth` fails, naming each far-side edge by its corners; with `size_space: screen` and `dash: [8, 8]` each near edge's dashes start every 16 ± 2 px along its projection; with `size_space: world`, width 0.02 m and `dash: [0.1, 0.1]`, every 0.2 ± 0.02 m along the edge; `--planted edges_dash_other_space` fails both, naming the line and its edges. Wrong programs: crease lines drawn without the depth test or the bias; dash ignored; dash in the other size space |

## Readings where the issue and design leave a choice

- **"Above the angle"** is the angle between the two faces' unit normals, read on welded positions, strictly greater
  than `angle` (reference.ts: `creaseReference`). No fixture has an edge at exactly the angle. An edge with more than
  two faces is neither a crease nor a border in the reference; no fixture has one.
- **"Draws N segments"** is the line's `segments` in the frame (#420's report), counted on welded positions, each
  once. The counts run on noop; AC4 also asserts the Metal frame's 12.
- **"Naming the item and the count"** is a failure sentence of the form `crease edges of <item> draw <n> segments,
  not <expected>`, where `<n>` is what the planted run drew; for the cube the issue's geometry fixes n = 6, its six
  face diagonals, the only edges whose faces meet below 30°.
- **"None on its side"** is no segment whose two ends differ in height; "its two rims" is 32 segments at each of
  y = 0 and 1 m with both ends at the 0.5 m radius. The ball's "0" is an empty list for its line, which must still
  be listed.
- **"Never its diagonal"** is no segment between two opposite corners of the square.
- **"A 100,000-triangle asset"** is a JSON glTF `mesh.asset@1` this suite generates (reference.ts: `foldedSheet`), so
  no large binary fixture is checked in. It has exactly 100,000 triangles and four 90° folds, with `border: false`
  so the per-frame `segments` stay small; its crease set is known in closed form (four lines of 200 edges).
- **"Derives the set once, counted on the noop lane"** is `edge_sets_derived` summed over the 600 frames equal to 1,
  all of it in frame 0. **"A run that derives it every frame"** is the same document under `edges_derive_every_frame`.
  **"Every frame equals by pixel hash"** is each of the 600 frames' `pixel_hash` equal to that frame's in the other
  run, on one machine; the noop lane makes no pixels, so this runs on Metal.
- **"Never draws over its near faces"** is #420's AC6 reading: the 3 edges meeting the corner farthest from the
  camera show no line pixel in the ID target near any sample (15% to 85% along their projection) that is clear of
  the near edges.
- **"Dashes in its size space"** is the dash period (one on and one off length) measured in that space: px along the
  projected edge for `screen`, m along the edge in the world for `world`. The period is measured between dash
  starts, so caps that lengthen a dash don't move it.

## Not tested, because no criterion asks

`kind: "crease"` as a bare string and the default angle of 30°; `border` with `all`, `quads` or `cage`, and its
default of `true`; angles other than 30°; crease lines on an item's `#part`; the notice `edges.no_quads`; a new
derivation when the mesh's content key changes (only that a still mesh derives once); seeking, as against playing,
the orbit; dash offsets, caps and `ends`; and view-dependent silhouettes, which the issue leaves to a look.
