# Acceptance tests for #441: Curves and sweeps — curve@1 with bspline mode and closed frames, and extrude along a curve

Written first, from issue #441 (its scope, its four Fields blocks — Curve `curve@1`, its bspline mode, its closed
frames, Builder `extrude`: sweep along a curve — its six acceptance criteria and its proof line), the design
sections it links and those they lean on, its oracle page, and base commit `881e2ed4` ("Merge pull request #1136
…"), by a job that never saw an implementation; none existed. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- Issue #441 and its oracle page (`doneright/oracles/issues/441.md` in `DeepBuildAI/deepbuild`, branch
  `doneright`): upstream tests for 2 of 6 criteria, none runnable on our output as they are. Blender's
  `BLI_length_parameterize_test.cc` and Godot's `test_curve_3d.cpp` / `test_path_follow_3d.cpp` (AC1: points at
  equal arc-length steps, a baked length) and Blender's `curves_geometry_test.cc` NURBSEvaluation and
  KnotVectorUniform (AC3: an order-4 uniform curve's points, the first (p0 + 4 p1 + p2) / 6). Their method is
  ported, not their data: AC1 holds at(u) to points at a fraction of arc length on our own curve, and AC3 holds
  the points at each joint to the uniform cubic's (C[j] + 4 C[j+1] + C[j+2]) / 6. Their fixtures (a straight
  50-unit Godot curve, Blender polylines) don't fit our surface or would test nothing a straight line can't fail;
  the page itself says neither checks the tube's twist, acceleration continuity or locality. AC2, AC4, AC5 and AC6
  have no upstream test (the page says so).
- `docs/canvas-primitives.md`: Units and axes (28: metres, +Y up, degrees in documents); Builder (2863: the
  builders, `extrude {outline; holes; depth; bevel; twist}`, `tube {path: points | curve ID; …}`); Builder
  `extrude`: sweep along a curve (2927: `along {curve, range, scale, rings}`, `caps`, `twist` "the ring at u turns
  by twist × u"; "Each ring is the outline set in the plane normal to the curve, its x and y on the two other axes
  of curve@1's own frame at u"; scale's interval form above 0 "or the build is refused, naming the range"; "Rings
  fall at `rings` even steps of arc length, and a linear curve adds one at each point, mitered … 1 ÷ cos(half the
  turn)"; a closed curve "welds its seam and takes no caps"); Curve `curve@1` (3108: points, ids `curve#p<id>`,
  modes, handles, `closed`, `frames: rmf | up`, `up = (0, 1, 0)`, `samples`, outputs `length` and `at(u)`;
  "Frames are rotation-minimizing by double reflection"); its bspline mode (3132: uniform cubic, C2, "an open curve
  repeats its end points three times so it still starts and ends on them", "Moving one point changes only the
  four spans it touches"); its closed frames (3148: `closure: deg`, spread by arc length so the frame at u = 1
  equals the frame at u = 0).
- `docs/technical-design.md`: Modeling steps (1349); the parity suite (2544: our own documents, "a planted-fault
  twin for every fixture", expected values set outside the implementation, CPU references as reviewed test code);
  Dogfooding (2524); Tests written first (2555).
- At the base, to learn the call shapes only: `tests/acceptance/420/README.md` and `helpers.ts` (the `geometry`
  call, builders as item kinds, the scenario's `planted`); `crates/deep-show/src/geometry.rs` (`geometry` answers
  builder items from their build nodes; any other item is `ref_unresolved`); `crates/deep-canvas-scene3d/src/
  curve.rs` (curve@1 takes `points`, `closed`, `mode: linear | catmull_rom` only, sampled 8 per Catmull-Rom span,
  no arc-length table, frames or outputs), `builders.rs` (extrude takes `depth` only; tube frames by parallel
  transport on the sampled path; a build fault is the param's path, refused as `out_of_range` at
  `items/<id>/<path>`) and `spec.rs` (the kinds' schemas).

## What the base already does, which these tests don't credit

`deep-show run` presents scene3d documents, `curve@1` is a kind (linear or Catmull-Rom, open or closed), `tube@1`
takes a curve ID as its path, `extrude@1` extrudes an outline by `depth` with `twist`, and `geometry` answers
builder items' meshes. There is no `bezier` or `bspline` mode, no `ids`, `frames`, `up` or `samples`, no
arc-length table, no `length` or `closure` output, no closed-frame spreading; `geometry` answers no curve@1 item
(`ref_unresolved`) and takes no `at`; builder rows carry no `rings`; `extrude@1` has no `along` or `caps`; and none
of the planted names below exists. So the tests define the surface below.

## Run them

Each file builds `deep-show` in the `full` set (`cargo build --locked --bin deep-show --no-default-features
--features full`, honouring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless
set), once, copies it out under its own name in a temporary folder, and fails each test if the build failed. So
they run one file at a time. `scripts/lanes.mjs` may need `'tests/acceptance/441/'` added to its `alone` list (the
one-at-a-time unit-lane line, which also takes the folder off the parallel line), as #420's is; this README is the
instruction, and the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/441 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/441/tsconfig.json
```

Each test writes its scenario's evidence store into its own temporary folder and deletes it. Node built-ins and
vitest only. A run with `--root tests/acceptance/441` leaves Vitest's cache in
`tests/acceptance/441/node_modules/.vite`; delete it. Every test is CPU only and runs anywhere; no criterion has a
time budget. `BASE-FAILURE.txt` says why the suite wasn't run at the base.

## The surface under test

The issue names curve@1's fields and outputs, the sweep's fields, the parity fixture and planted programs, but no
code API. These tests define the smallest surface they need on the binary and call that exist, #420's `geometry`
call on `deep-show run`: **one new request field** (`at`), **curve@1 rows** in its reply, **one new field on
builder rows** (`rings`), and planted names. Everything #420's README defines for `deep-show run` holds unchanged.
No new binary, no new call. Every name below the issue doesn't give is this job's invention.

### Documents

- `curve@1` takes the issue's fields: `points`, `ids`, `mode: linear | bezier | catmull_rom | auto | bspline`,
  `handles: {in, out}` (bezier: span k runs from point k by its `out` handle to point k + 1 by its `in` handle,
  each relative to its point), `alpha`, `closed`, `roll`, `frames`, `up`, `samples`.
- `extrude@1` with `along: {curve: ID, range, scale: number | expression string over u, rings}` in place of
  `depth`, `caps: none | flat`, `twist` (degrees). Expressions are strings in the closed function list's grammar,
  `"1 - 0.75 * u"`.
- `tube@1 {path: curve ID}` as at the base.
- Documents reach `deep-show` as an agent sends them (`deep_show` from one session: no `id`, no `layers`), every
  item at the origin, so item space is world space.

### Frames (this suite's reading of the design's words)

- curve@1's frame at u is `tangent` T (unit, the direction of increasing u), `normal` N and `binormal` B = T × N.
  With `frames: rmf` (the default), N at u = 0 is `up` with its part along T taken out, normalized, and is carried
  along by double reflection (on a closed curve, with the closure spread by arc length). So on a planar curve whose
  start tangent is perpendicular to `up`, N stays `up`.
- A sweep's ring at u sets outline point (x, y) at `point(u) + scale(u) · (x · X + y · Y)`, where X = cos θ N +
  sin θ B and Y = −sin θ N + cos θ B, θ = twist × u (right-handed about T), N and B curve@1's frame at u. Outline x
  is on the normal, y on the binormal: "its x and y on the two other axes of curve@1's own frame at u", in order.
  A ring at a linear curve's corner lies in the plane bisecting the corner, its y axis stretched across it by
  1 ÷ cos(half the turn).
- `rings: R` over `range: [a, b]` puts R rings at u = a + k (b − a) ÷ (R − 1), k = 0 … R − 1, plus one at each point
  of a linear curve inside the range: `rings: 3` on the 0.2 + 0.8 m line gives u = 0, 0.2, 0.5, 1.

### `deep-show run`: the `geometry` call gains `at`

```json
{"call": "geometry", "doc": doc ID, "items": [ID], "t"?: time, "at"?: [u]}
```

A `curve@1` item named in `items` answers a curve row (`items` must name it; the default list stays #420's items
with geometry):

```json
{"id", "kind": "curve@1", "key": content key,
 "outputs": {"length": m, "closure": deg},
 "at": [{"u", "point": [x, y, z], "tangent": [x, y, z], "normal": [x, y, z], "binormal": [x, y, z],
         "accel": [x, y, z]}]}
```

- `at` has one entry per value of the request's `at`, in order, each echoing its `u`.
- `point` is at(u): the point at u × `length` of arc length from the start. `tangent`, `normal`, `binormal` are
  the frame above (unit vectors).
- `accel` is d²P/du², the curve's second derivative with u the fraction of arc length: L² (P'' − (P''·T) T) ÷
  |P'|² in any regular parameter t of the span, L the length. A camera moving along u at a steady rate feels it.
- `outputs.length` is the arc length in metres; `outputs.closure` is the rotation-minimizing frame's mismatch at
  the seam of a closed curve, in degrees, before it's spread (sign free; this suite reads its magnitude).

### Builder rows gain `rings`

Every `extrude@1` with `along`, and every `tube@1`, adds:

```json
"rings": [{"u", "scale", "turn": deg, "frame": {"point", "tangent", "normal", "binormal"}, "vertices": [index]}]
```

in sweep order: `u` the ring's fraction of the curve's arc length; `scale` the value of `along.scale` at u (1 for a
tube), not the miter's stretch; `turn` the twist turned at u (twist × u, degrees); `frame` the frame the ring's
outline is set in before `turn` (curve@1's at u, for a sweep); `vertices` one index into `positions` per outline
point (per tube segment), in outline order, a vertex at that point of that ring (where several coincide, any one).
A closed sweep may list the seam ring at u = 0 only, or at u = 0 and u = 1. Caps' own vertices aren't rings and
aren't listed.

### Refusals at check

A sweep whose `scale` reaches 0 or below on its range is refused when presented (`deep_show` outcome `refused`),
with an error issue whose `path` is `items/<id>/params/along/range` (the design: "the build is refused, naming the
range"). The code isn't pinned.

### `deep-show run`: scenario `planted` values added (each reachable only there)

| Value | The wrong program | Criterion |
|---|---|---|
| `seam_twist_left` | A closed curve@1's rotation-minimizing frames keep their closure at the seam: nothing is spread | AC2 (issue-named) |
| `sweep_frenet` | A sweep's ring frames are Frenet frames (normal along the curvature, binormal T × N), turned once about the tangent by the fixed angle that matches the first ring's Frenet frame to its rotation-minimizing one; curve@1's own frames (`at`) are unchanged | AC4 (issue-named) |
| `corner_square` | A sweep's ring at a linear curve's corner is set square to one side: in the plane normal to the segment into the corner, unstretched, instead of mitered | AC5 (issue-named) |
| `u_by_span` | A sweep reads u by span (span index plus the span's own parameter, over the span count) instead of by arc length, for its rings' scale and turn | AC6 (issue-named) |

## Fixtures

| Fixture | What it is | Read by |
|---|---|---|
| `parity/geometry/curve-frames-closed.scene` | The issue's parity fixture (JSON): a closed Catmull-Rom curve through twelve points of a trefoil knot (chiral, so its RMF comes back turned by over 100°), the u values read, the 1e-6 rad bound, and the `seam_twist_left` twin with the names its failure must carry | AC2 |
| `parity/geometry/sweep-s-bar.scene` | The S curve (one point-symmetric Bézier span in the xz plane), the bar outline, 64 rings, the side band and bounds, and the `sweep_frenet` twin with its first failing ring | AC4 |
| `parity/geometry/sweep-picture-frame.scene` | The closed 0.40 × 0.30 m rectangle (ids 1–4), the 0.02 m square outline, the volume and its formula, the corner bound, and the `corner_square` twin with its names | AC5 |

AC1's, AC3's and AC6's documents are generated in their test files. The CPU references are `reference.ts`: cubic
spans in Bézier form, the open uniform cubic B-spline converted to them, arc length by composite Gauss-Legendre
quadrature, u solved to a span and parameter by guarded Newton steps, d²P/du², rotation-minimizing frames by double
reflection on a 4,000-step-per-span grid, welding at 1e-6 m, edge topology and the divergence-theorem volume.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the
leading `- [ ] ` dropped (#607's command, as #305's README gives it, with the issue's six criterion lines on
stdin). Each test's name starts with `AC<n> #441.<id>`. Where a criterion names a wrong program, the test runs it
through `planted` and asserts it fails the way the criterion says, naming what it says.

| Criterion | Text (abridged) | Tests |
|---|---|---|
| AC1 `#441.c7a9e5a5` | at(u) returns the point at that fraction of arc length within 1e-6 of its length, and a tube along it shows no twist | `arc-length.test.ts` (1): on a two-span 3D Bézier, `length` and at(u) at 21 values of u within 1e-6 × length of the reference; the tube's rings keep one angle, within 1e-3 rad, to the reference RMF. It first shows on this curve that u read by span parameter misses by over 1% of the length and an up-held frame twists over 0.1 rad. Wrong programs: u by parameter; frames held to up or by a fixed axis |
| AC2 `#441.f156aca2` | On a closed curve the frame at u = 1 equals the frame at u = 0 within 1e-6 rad, and a planted seam twist fails (parity/geometry/curve-frames-closed.scene) | `closed-frames.test.ts` (2): the trefoil's frames at u = 1 and 1 − 1e-9 within 1e-6 rad of u = 0's, closure at least 1°; `seam_twist_left` fails, naming `loop` and `u = 1`. Wrong programs: closure left at the seam; u = 1 wrapped to 0 hiding it |
| AC3 `#441.88f3e1bc` | A bspline curve's acceleration is continuous at every point within 1e-6 relative, and moving one point changes only the four spans it touches | `bspline.test.ts` (1): seven points, eight spans, seven joints: `accel` at u ± 1e-9 agrees across each joint within 1e-6 of the largest joint acceleration and equals the reference's d²P/du²; the joints' points are the uniform cubic's; moving point 3 leaves spans 0, 1 (by arc length from the start) and 6, 7 (from the end) within 1e-6 × length, and spans 2–5 follow the reference. Wrong programs: a C1 spline (Catmull-Rom), an interpolating or global spline, ends not repeated three times |
| AC4 `#441.d9cbd314` | An S-curve bar stays on its side at every ring, its frame within 1e-6 rad of curve@1's RMF; a planted Frenet sweep turns it 180° at the inflection and fails, naming the ring | `s-bar.test.ts` (2): every vertex of all 64 rings 0.045–0.055 m along T × up from the curve; each ring frame within 1e-6 rad of curve@1's `at` frame, whose normal is +y within 1e-6 rad; `sweep_frenet` fails first at `ring 32`, on the other side. Wrong programs: Frenet frames; ring frames not curve@1's |
| AC5 `#441.2988fbd4` | A swept picture frame builds watertight with V − E + F = 0 and 0.00056 m³ within 1e-9 relative; a planted square-corner sweep misses the volume and fails, naming the corner | `picture-frame.test.ts` (2): welded edges each on two triangles wound opposite ways, V − E + F = 0, volume 0.00056 m³ within 1e-9, each corner ring the miter's points within 1e-9 m; `corner_square` misses the volume and fails, naming `rect#p1` … `rect#p4`. Wrong programs: square corners; an open seam |
| AC6 `#441.501326f2` | With `rings: 3`, `scale: 1 − 0.75 × u`, `twist: 90` the joint ring is at 0.85, the 0.5 m ring at 0.625, the last at 0.25 turned 90°, within 1e-12; u by span puts 0.625 at the joint and fails; 1 − 1.2 × u is refused at check, naming the range | `scale-twist.test.ts` (2): the three rings, found by where they sit, have `scale` and `turn` within 1e-12 and their outline at the closed-form positions within 1e-12 m; the 1 − 1.2 × u bar is refused with an error at `items/bar/params/along/range`; `u_by_span` fails, naming the joint, at 0.625. Wrong programs: u by span; a scale that reaches 0 accepted |

## Readings where the issue and design leave a choice

- **"Within 1e-6 of its length"** (AC1) is a distance of at most 1e-6 × length between at(u) and the point at
  u × length of arc length. The same bound holds wherever a later test compares points on a curve (AC3).
- **"Shows no twist"** (AC1) has no bound in the issue. It is read as: the tube's ring normals keep one angle about
  the tangent, within 1e-3 rad, to a rotation-minimizing frame carried along the curve (a twist is a change in that
  angle; the start angle is the tube's own). The bound leaves room for a double reflection on 16 samples per span
  (about 1e-5 rad on this curve) and is far below the 0.68 rad an up-held frame twists here.
- **"The frame at u = 1"** (AC2) is read at u = 1 and at its left limit u = 1 − 1e-9; frames compare by the largest
  angle between their tangents, normals and binormals.
- **"Acceleration"** (AC3) is d²P/du² (`accel`), what a camera moving along u at a steady rate feels; "at every
  point" is at every joint between spans, one per point of a seven-point open curve; "within 1e-6 relative" is
  relative to the largest acceleration at a joint, because at the first and last joint the acceleration passes
  through 0. Both sides are read 1e-9 in u from the joint the reference places.
- **"Moving one point changes only the four spans it touches"** (AC3) is checked by arc length: arc length shifts
  every u when a point moves, so the kept spans before the touched ones are read at the same arc length from the
  start and those after at the same arc length from the end.
- **The bar** (AC4) is 0.10 m along the outline's x (the normal, +y here) and 0.01 m along its y (the binormal, in
  the xz plane), centred 0.05 m to the side, so all of it lies on one side; "stays on that side" is every vertex
  0.045–0.055 m along T × up, within 1e-6 m. Rings are named by index, `ring <k>`; the S curve's inflection falls
  between rings 31 and 32 of 64.
- **"Watertight"** (AC5) is #420's: on positions welded at 1e-6 m, every edge on exactly two triangles, wound
  opposite ways. **"Naming the corner"** is the curve point's address, `rect#p<id>`; the corner checks compare each
  corner ring's points with the miter as a set, so the order of a ring's vertices doesn't matter there.
- **AC6's rings** are found by where they sit (frame point at x = 0.2, 0.5, 1), not by their reported u, so a
  program that misreads u is judged at the ring the criterion names. The outline is asymmetric so the turn shows in
  the positions.

## Not tested, because no criterion asks

curve@1's `auto` mode and its overshoot clamp, `alpha`, `roll`, `frames: up`, `samples`, anchors `start` and `end`,
`visible`, `fn` curves; NaN or coincident points refused; ids keeping identity on reorder; follow_path,
curve_deform, repeat along and shots reading curve@1; a closed tube's seam; the sweep's flat caps and holes, a text
outline with `along` refused, a miter past 4 refused, a closed sweep's twist that isn't whole turns or a scale that
differs at its ends refused; the vertex count known before the build; and the closure's spread being by arc length
rather than only meeting at the seam.
