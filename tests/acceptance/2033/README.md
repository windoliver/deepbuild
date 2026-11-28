# Acceptance tests for #2033: shadow bias held by a sweep

Written blind at the base `1b4929ae7` (origin/main) from issue #2033, the design and that base. The job saw no fix, no
branch, no pull request, no worktree and no other session's work. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## Sources

- **The issue**, #2033: its account (the cascades' computed bias at `scene3d.wgsl` ~1443, now `cascade_lit` at line
  1642, and the local maps' `1e-5` beside a normal offset, ~1522, now `local_lit` at line 1732), its scope, its four
  criteria, Runs on and Proof. Its oracle link points to another repository; it wasn't read.
- **The design**: `docs/technical-design.md` (Light without history; the reference Macs; Dogfooding),
  `docs/canvas-primitives.md` (Units and axes; Light and the light policy; Light policy: cascades, soft shadows, local
  shadows; the document's `light_policy`). **AGENTS.md.**
- **The base, for surfaces only**: `crates/deep-scene3d-render/src/scene3d.wgsl` (`cascade_lit`, `local_lit`, the tent),
  `crates/deep-scene3d-render/src/lib.rs` (the splits and each cascade's `texel_m`), `crates/deep-gpu-layer/src/view3d.rs`
  and `view3d/reports.rs` (`cascades` and `shadows` in a frame), `crates/deep-gpu-layer/src/full_lane.rs` (the adapter's
  device type), `crates/deep-canvas-scene3d/src/spec.rs` (the light kinds' fields), `sets.rs` (`light_policy`: a policy
  naming `local_map` draws fixed maps, not tiles), `gltf.rs` (normals made from faces where a file has none),
  `crates/deep-show/reference-macs.json`; the suites `tests/acceptance/1297/`, `1297-redraft-2047/`, `424/` (with
  `redraft/`), `422/` and `446/`; `scripts/proof-runs.mjs` (`twinsOf`, the before lane, the at-assertion rule, the
  20-minute cap), `scripts/proof-change.mjs` (`criterionId`), `scripts/lanes.mjs`.

## Criteria to tests

Each test's name starts with `AC<n> #2033.<id>`; the ID is the first 8 hex digits of SHA-256 of the criterion's text,
trimmed and whitespace collapsed (recomputed from the issue body).

| ID | Criterion (short) | Test |
|---|---|---|
| AC1 `#2033.572c2d31` | sun: lit pixels within 4 codes of `shadow: false`, every elevation × cascade | `ac1-sun-lit.test.ts` (1) |
| AC2 `#2033.6912f5fe` | sun: plane pixels behind the wall within 4 codes of the sun off | `ac2-sun-wall.test.ts` (1) |
| AC3 `#2033.51cea4a6` | AC1 for a spot and a point light at 1, 4, 16 m | `ac3-local-lit.test.ts` (1) |
| AC4 `#2033.4b94b05f` | AC2 for a spot and a point light at 1, 4, 16 m | `ac4-local-wall.test.ts` (1) |

## The fixtures

All drawn at 640 × 480 by `deep-gpu`'s `view3d` (one frame, final and object-ID targets, `cascades: true`,
`shadows: true`), under #1297's filmic look at exposure 0 and a black sky with no ambient. Every part is a `mesh.asset@1`
whose positions-only JSON glTF holds its triangles in world coordinates; the CPU rays meet exactly those triangles (f32
positions as the file holds them) and the reader's own smooth normals (each vertex the unit sum of its faces'
unnormalized normals, `gltf.rs`).

- **The parts**: a ground plane (one quad at y = 0, grey 0.5); smooth-shaded icospheres of radius 1 m at subdivision 2
  and 4 (#1297's construction, shared vertices, resting on the plane); a 1 m box resting on the plane; a wall 2 m tall,
  0.5 m thick and 4 m long. Box and wall have a vertex set per face, so their normals are flat. Clay is #1297's
  material.
- **The sun sweep** (`SUN_PARTS`): all five parts on a 12.5 × 9 m plane, the wall at x = −2, the spheres at x = 0.8,
  z = ±1.3, the box at x = 3. A 3 lx `light.sun@1` from azimuth 20° (from +X toward +Z) at elevations 15°, 25° … 75°,
  `cascades: 4`, `split: 0`. The camera looks down 40° from +Z; for cascade i it backs off along its view (its field
  narrowing so the frame stays 13 m across at the target) until the whole fixture's view depths lie inside cascade i,
  short of its last tenth, and `shadow_far` is set so (`sunPlacement`). The test reads the frame's reported splits and
  fails a pair whose fixture isn't inside the cascade it names.
- **The local sweep** (`localFixture`): one subject on a plane at a time (the two spheres and the box for AC3, the wall
  for AC4), under one shadowed `light.spot@1` (outer 45°, inner 40°, aimed at the subject's centre) or one shadowed
  `light.point@1`, 45° above the plane from the subject's centre, from azimuth 20°, at 1, 4 and 16 m from the subject.
  The document's `light_policy` names `shadowed: {sun: 1, spots: 1, points: 1}` and `local_map: 512`, which draws the
  issue's 512 px maps as fixed maps (not tiles). Power gives the subject's centre 3 lx; range is the default.
- **The references**: AC1/AC3, the same document with the light's `shadow: false`; AC2/AC4, the same document with the
  light off: its `illuminance` (sun) or `power` (local) 0, everything else kept, `shadow: true` included.

## How each criterion is read

**AC1.** "Each pixel … that the CPU rays call lit, that lies 0.25 m or more from a shadow edge, and whose face normal
and smooth normal both face the sun by 10° or more": a pixel whose centre ray and four corner rays meet the same part
(the plane, a sphere or the box; never the wall), every one of those five points unoccluded toward the sun (an f64 ray
from 0.1 mm off the face, any triangle of another part counting: every part is convex, so a ray leaving a point of
its face toward a light in front of that face never meets it again) and facing it: the face normal and the interpolated smooth normal each
at n·l ≥ sin 10°. "0.25 m or more from a shadow edge" is read on the surface: every one of 24 samples on a disk about
the centre in its tangent plane (16 at 0.25 m, 8 at 0.125 m) sees the sun too. (A shortcut, exact for the rule: when
no leaf box of another part, grown by 0.26 m, meets the centre's ray, no sample's ray can be blocked, and the samples
aren't cast.) "Within 4 code values" is the largest of
R, G and B differences of the 8-bit final target, ≤ 4. "Every elevation and every cascade": all 7 × 4 pairs are judged
and every failure is listed; each names its elevation and cascade, with the cascade's `texel_m`, the count over 4 codes,
which parts, the worst code and where.

**AC2.** "Each plane pixel whose ray to the sun passes through 0.25 m or more of the wall": the centre and four corners
meet the plane, and each point's segment toward the sun runs 0.25 m or more inside the wall's box. Such a pixel more
than 4 codes over the sun-off frame is lit; a failure names the elevation, the cascade and the count of lit pixels.

**AC3 / AC4.** As AC1 / AC2 with the local light's position in place of the sun's direction (segments end at the light),
a spot's lit points also inside its outer cone. Each failure names the light (spot or point) and its distance (and the
subject). "At 1 m, 4 m and 16 m from the subject" is read as from the subject's surface along the 45° line from its
centre: a sphere's centre is 1 m from its surface, so "from the subject" can't mean its centre at 1 m.

**Guards**, so an empty, unlit or unshadowed frame can't pass (each pair; a failed guard fails the test):
both frames drawn where the rays put the fixture (99% of the pixels whose five rays agree name that part in the
object-ID target); the casting frame's maps drawn (sun: `scene3d.shadow` among the passes and 4 cascade maps; local: a
map reported for the light, of its kind); AC1/AC3: 2,000 or more judged pixels, of them three quarters (AC1) or
2,000 (AC3: a light 1 m away falls off steeply, so a share would fail on its dim far pixels) at code 16 or more with
the shadow off, and 90% of the pixels the rays call occluded 0.25 m inside a shadow (and facing the light) darker than
`shadow: false` by more than 4 codes (200 or more such pixels for the sun, 100 for local lights); AC2/AC4: 200 or more
judged pixels behind the wall (for the spot, 100 or more of them inside its inner cone); AC2: 2,000 or more pixels of
the casting frame more than 4 codes over the sun-off frame; AC4: in a third frame with `shadow: false`, 100 or more of
the judged pixels more than 4 codes over the light-off frame (so a leak would show; the visible lit area can't stand
in, since with the spot 1 m from the wall's far face the wall hides all it lights); and, where the rays call 200 or more pixels lit (as in AC1),
90% of them more than 4 codes over it.

**Runs on.** Every test first reads the machine: off a reference Mac it skips with `INCONCLUSIVE: …` (a skip, never a
pass); on a software adapter (the full lane's call names device type `cpu`) it throws `BLOCKED: …` (an error, not an
assertion, so never a pass and never a twin's failure). The reference list is `crates/deep-show/reference-macs.json`
plus the Mac18,1, which the owner named a reference Mac on 2026-11-20 (#2956, recorded in commit `9c7ecd658`, PR #2097)
and which the base's file doesn't list yet.

## Where the issue is silent, and what was chosen

- The light's azimuth (20°), its illuminance (3 lx, #1297's) and the materials: chosen so lit faces turn toward the
  camera and every shadow falls beside its caster in view.
- The plane's size and the wall's length (4 m); the layout; the camera (40° down from +Z).
- "The subject inside each of 4 cascades": the whole fixture, plane included, inside cascade i (uniform splits, camera
  backed off), so every judged pixel's lookup is cascade i's; `fade` stays at its default (on), and the fixture keeps
  out of the last tenth where it blends.
- The tent filter: no `light_policy.soft` is named, so the sun keeps the fixed filter (as a document naming no soft
  shadows does) and local maps use the tent. Soft shadows aren't swept; the issue excludes soft shadow width.
- A pixel is judged whole: its centre and four corners must agree, so a silhouette pixel mixing parts isn't judged.
- The edge distance is measured on the surface's tangent plane at the pixel's centre point (24 samples).
- The spot's cone (45°/40°) and power (3 lx at the subject's centre); local `range` left at its default.
- "With the sun off": illuminance 0 with everything else kept; for local lights power 0.

## Twins

`twins.json` maps each tag to wrong programs the proof lanes lay over the change (`scripts/proof-runs.mjs`, `twinsOf`).
Each is the base's whole `crates/deep-scene3d-render/src/scene3d.wgsl` with the shadow lookups' bias lines changed (the
switch lives in the test harness only; the product has no option for it):

| Twin | The wrong program | Tags |
|---|---|---|
| `no-bias` | `cascade_lit` looks up at `world` (no bias toward the sun, no normal offset on curved faces) and compares at `t.z` (no `1e-4`); `local_lit` looks up at `world` with `bias = 0.0` | AC1, AC3 |
| `two-metre-bias` | `cascade_lit` looks up at `world + toward_sun × 2 m`, compared at `t.z`; `local_lit` at `world − ray × 2 m` (2 m toward the light), `bias = 0.0` | AC2, AC4 |

The soft-shadow paths (`cascade_pcss`, PCSS in `local_lit`) and `tiles.wgsl` are left alone: no fixture draws them. Being
the base's whole file, a twin laid over a change that also edits the shader's bindings elsewhere may not build, which
the lanes read as BLOCKED, never as a pass.

## What was run

On the Mac18,1 at base `1b4929ae7`, 2026-11-25, with load averages from 8 to 52 (each file ran alone; builds and
runs held throttle grants). Full readings are in `BASE-FAILURE.txt`.

| File | Base | Time | Twin | Twin result | Time |
|---|---|---|---|---|---|
| `ac1-sun-lit.test.ts` | pass: 0 px over 4 codes in all 28 configs, worst 3 codes | 41.7 s | `no-bias` | fails in 28 of 28 configs, naming elevation and cascade, e.g. "elevation 15°, cascade 0 (texel 0.0127 m): 117230 of 117286 sunlit px differ … worst 92 codes" | 37.5 s |
| `ac2-sun-wall.test.ts` | pass: 0 lit px behind the wall in all 28 configs | 15.3 s | `two-metre-bias` | fails in 28 of 28 configs, naming elevation, cascade and the lit count, e.g. "elevation 15°, cascade 0 …: 2850 lit px behind the wall … worst 102 codes" | 36.8 s |
| `ac3-local-lit.test.ts` | pass: 0 px over 4 codes in all 18 configs | 15.8 s | `no-bias` | fails in 18 of 18 configs, naming light and distance, e.g. "the spot light at 1 m (sphere2): 58419 of 78302 lit px differ … worst 94 codes" | 27.3 s |
| `ac4-local-wall.test.ts` | **fails**: the spot at 16 m lights 896 px behind the wall (worst 105 codes), the point at 16 m 435 (worst 109); 1 m and 4 m clean | 6.8 s | `two-metre-bias` | fails in 6 of 6 configs, naming light, distance and the lit count, e.g. "the spot light at 1 m: 15589 lit px behind the wall … worst 113 codes" | 8.8 s |

No guard fired in either twin run: every failure is the criterion's own reading. The first base run of AC3 and AC4
failed on two guards of the tests' own (a share of bright pixels that a light 1 m away can't meet; a visible lit area
the wall hides for the spot 1 m behind it); both were corrected as described under Guards and the two files run
again, with the results above. AC1, AC2 and AC3 pass on the base, so their power to fail rests on their twins.
`tsc --noEmit -p tests/acceptance/2033/tsconfig.json` reports no errors.

## Run them

```sh
PATH=$HOME/.cargo/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run tests/acceptance/2033/ --testTimeout=1200000 --no-file-parallelism --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/2033/tsconfig.json
```

The files build `deep-gpu` with cargo as #1297's do, draw on macOS's Metal device, and write only into temporary
folders they delete. `lane.json` keeps the folder alone (binary).
