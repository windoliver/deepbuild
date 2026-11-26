# Acceptance tests for #1278: 3D views: shading at an occlusion edge depends on GPU timing

Written first, from issue #1278 (its cause, its repro and its three acceptance criteria), the design sections it
links and those they lean on, and the base commit `79d98cbc` ("Merge pull request #1242 …"), by a job that never saw
an implementation; none existed, and PR #1272's diff was not read. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one file per testable
criterion, at most two tests each. No new calls, fields or planted programs: every test drives the base's own
`deep-gpu run` and `view3d`.

## What was read

- Issue #1278: the cause (`direct()` widens the lobe by `dpdx(n)`/`dpdy(n)`, which read the other lanes of a 2 × 2
  quad that an earlier, nearer draw may cull or not by GPU timing), the repro, and the criteria.
- `docs/technical-design.md`: Scenes, physics and the canvas core ("`frame(t) = eval(doc, t)`, with no state carried
  between frames except explicit bakes"); Dogfooding.
- `docs/canvas-primitives.md`: Material (fields and defaults, the direct-light compensation); Light and the light
  policy (`shaded ≤ 32`, `power: lm`, `illuminance: lx`).
- At the base: `crates/deep-gpu-layer/src/view3d.rs` (`doc`, `look`, `size`, `frames`, `fps`, `capture`, `targets`;
  every frame reports `pixel_hash`, the SHA-256 of its bytes, read back whether or not it is captured),
  `crates/deep-scene3d-render/src/scene3d.wgsl` (`direct()`: `dn = |dpdx(n)|² + |dpdy(n)|²`,
  `α² = max(roughness⁴, min(dn, 0.18))`, and its comment on what the floor is for),
  `crates/deep-canvas/src/camera.rs` (orbit position), `crates/deep-canvas/src/grammar/time.rs` (seconds literals),
  `crates/deep-canvas-scene3d/src/scene.rs` (`Shape`: box before built), and the suites `tests/acceptance/421` and
  `422` (helpers, looks, the sphere fixture, #422 AC8's mirror-ball check).

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the leading
`- [ ] ` dropped. Each test's name starts with `AC<n> #1278.<id>`.

| ID | Criterion | Test, what it asserts, and the wrong programs it catches |
|---|---|---|
| AC1 `#1278.09e67199` | In that repro, every frame's `pixel_hash` is the same in all four plays. | `repro-plays.test.ts` (2): the issue's repro (below) played four times as four `view3d` calls in one `deep-gpu run` process, no `capture`: all 97 frames of each play report a `pixel_hash`, and each frame's four are equal; the failure lists every differing frame with the four hashes. A fixture check in a separate process captures the ID target at frames 0, 48 and 96: the ball and the box are in view and at least 10 ball pixels lie beside box pixels, so there is an occlusion edge with the box in front. Catches: the base (7 to 9 frames differ per run here); a fix that leaves a shader-computed derivative at an occlusion edge |
| AC2 `#1278.2d35ce9a` | The specular lobe keeps #422's pixel-footprint widening: a curved smooth solid's lobe still widens by the normal's change across the pixel. | `lobe-widening.test.ts` (2): a white mirror ball (roughness 0, `ball@1`, 256 segments) under a 1 lx sun behind the camera, at radius 1 (≈100 px) and 0.125 (≈12 px, the normal turning 8× faster a pixel), the sun tilted so the highlight lands 0, 0.25 and 0.5 px off a pixel corner; the sun's image is Σ (sun on − sun off) linear × pixel solid angle. Test 1: per ball, the image is the same at the three phases within 2%, and on the big ball it is E·R²/(2d − R)² within 2% at each. Test 2: with the highlight on a pixel center, the brightest pixel holds 2% to 50% of the image on each ball, and the two balls' shares agree within 1.5×. Catches: no widening (`dn` 0: the image swings 16× (big ball) and 66,000× (small) with phase, one pixel holds 98–100%); a fixed widening angle (the big ball's brightest pixel holds 0.2%, shares 74× apart); a widening in wrong units |
| AC3 `#1278.c6e54be3` | The fix's cost is measured against main on the same view, and any change to the #421, #422, #423 or #425 golden or pixel-hash suites is reported. | Not tested: it is a report the implementer writes (a cost measurement against main and a list of changed goldens and hashes), not a behavior a test can see. A reviewer checks the PR holds both. |

## Decisions

- **The repro** is built as the issue states it: 320 × 240, 32 fps, 97 frames; a `mark.box@1` 0.9 m cube with a
  `material@1` of roughness 0.3, and a `ball@1` (radius 1, 64 segments) with its own `material@1` of roughness 0.3;
  one `light.sun@1` and 30 `light.point@1`; a camera orbiting the ball from azimuth 0° to 90° while its distance goes
  from 5 m to 25 m, by linear keys at `0s` and `3s` (whole seconds, so no literal needs more than five fraction
  digits). The issue leaves the rest open; this job chose: the box at 1.6 m from the ball's center toward azimuth 45°
  and 0.2 m up, turned 45° to face it, so it covers part of the ball from every azimuth of the orbit; elevation 15°,
  fov 40°; the sun at 0.6 lx, aimed by `rot [-50, 30, 0]`, no shadow; the lamps at 6 lm on three rings 3 to 4.5 m
  out, 1 to 3 m up; base color 0.8 for both materials; tone map none at scale 1, no bloom. The light levels keep the
  picture inside 8 bits: a first draft at 2 lx and 150 lm was clipped white and showed no flips at the base.
- **Four plays in one process** are four `view3d` calls in one `deep-gpu run` input; "no capture" is no `capture`
  field (so no targets are written).
- **AC2's property** comes from `direct()`'s own comment: a lobe under a pixel wide is point-sampled at pixel
  centers, so a mirror's sun loses light between them. A Riemann sum of a lobe at least a pixel wide doesn't depend on
  where the pixel grid falls; one of a narrower lobe does. "Widens by the normal's change across the pixel" is read
  as: the highlight spans about one pixel footprint whatever the curvature in pixels, so two balls whose normals turn
  8× apart per pixel give the same brightest-pixel share within 1.5×, and that share is between 2% and 50% (the base
  gives 15–19%). The bounds leave room for a fix that computes the footprint another way (Kaplanyan's kernel
  constants differ by about 2× between implementations) while failing no widening and a fixed angle by far.
- **The mirror's limit** E·R²/(2d − R)² (#422's AC8, there within 1%) holds only while the widened lobe is narrow;
  on the 12 px ball the lobe is about 6° wide and the base reads 10% over it at every phase, so only its phases are
  compared. On the big ball 2% (not #422's 1%) covers the base's 0.83% at the 0.5 phase.
- **Discrimination** was shown with two temporary edits to `direct()` (`dn = 0`, `dn = 0.0129`), each reverted after
  its run (BASE-FAILURE.txt); neither is a planted program the implementer must add.

## Notes on the base

- **`sky@1` draws black on main.** At `79d98cbc`, any document with a `sky@1` item draws an all-black frame: the
  sky pipeline's layout has four bind groups (the material maps of #423 are group 3), but `sky_draw()` in
  `crates/deep-scene3d-render/src/lib.rs` binds three, so wgpu rejects the encoder ("The current set RenderPipeline
  with 'scene3d.sky' label expects a BindGroup to be set at index 3"). That likely breaks the #422 suites that use a
  sky on main. Neither fixture here holds a sky; AC2 subtracts a sun-off render instead, so the default background and
  any ambient light cancel. This is a separate bug, not #1278's; it is reported, not fixed.
- Every process also logs one wgpu validation error per view at startup ("Number of bindings in bind group descriptor
  (0) does not match the number of bindings defined in the bind group layout (11)"): `maps.rs` creates an empty
  placeholder bind group before replacing it. Frames draw correctly despite it.
- The mirror ball alone is not bit-stable either at the base: the big ball's sun image at phase 0.25 read 8.31612e-3
  in one process and 8.31609e-3 in another (the issue's note that the ball alone flips, its back faces still
  discarding in the shader). AC2's tolerances are far above that.

## Running

```
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --bin deep-gpu
npx vitest run tests/acceptance/1278 --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1278/tsconfig.json
```

Each file builds `deep-gpu` once (`cargo build --locked --bin deep-gpu`) and copies it out of the target folder. Off
macOS every test is INCONCLUSIVE (a failure, never a pass). A fresh checkout needs `npm ci` and the workspace
packages built (`npm run build --workspaces`) before vitest can load its config.
