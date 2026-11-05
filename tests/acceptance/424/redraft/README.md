# Blind redraft of #424's AC9 test

Written by a fresh run of the acceptance-test job (technical design: Dogfooding, disputes) for one criterion, AC9
`#424.d0c14cb2`, from the issue, the design and the base commit `79d98cbc` only. No implementation, other worktree,
branch or the parent suite's files were seen. `section.test.ts` and `helpers.ts` stand alone (nothing is imported from
`../`). Whoever settles the dispute decides whether this file replaces the original.

## What was read

- Issue #424: its scope, the `cutaway@1` Fields block and AC9.
- `docs/canvas-primitives.md`: Cutaway `cutaway@1` ("the planes apply in every pass that draws the cut items, shadow
  maps … included"; "every shadow map's … key includes the planes that reach its casters"; "a lit cap shades its role
  as a matte surface facing along the plane's normal"), Material (`shadow: auto`), Light and the light policy, Light
  policy: cascades (a map "cached by everything it reads"), The cost model.
- `docs/technical-design.md`: Scenes, physics and the canvas core; Dogfooding.
- Base code, for conventions only: `crates/deep-gpu-layer/src/view3d.rs` (the `passes` list: `scene3d.shadow` writes
  `shadow`, `scene3d.geometry` writes `linear`, `ids`, `depth`; `cascades: true` reports only `splits` at the base),
  `crates/deep-scene3d-render/src/shadow.rs` (cascade fitting, 2048-texel maps, texel = 2r ÷ size),
  `crates/deep-canvas-scene3d/src/light.rs` (role colors decode by the sRGB transfer function; a sun shines along its
  own −Z), and the suites `tests/acceptance/421/`, `422/`, `423/` (helpers, the plain look, the black sky, photometry:
  a white Lambertian's linear value is E·(n·l) ÷ π).

## Surfaces used

Exactly the suite's assumed surfaces given to this job: `deep-gpu run [--planted cut_color_only]`, one JSON line in
and out; `view3d` with `targets: ['linear', 'ids']`, `cascades: true` and `cutaway: {planes: [{normal, offset}], mode,
applies_to, cap, class, shadows, cap_light}`; each frame's `cascades.maps: [{key, texel_m}]`; the reply's `passes`;
targets named by SHA-256; the plain look (tone map none, exposure −log2 1.2); a black sky with zero ambient. From
#422's surfaces: the key sun's `cascades` and `shadow_far`. The cap role is this look's own `cap` (palette `#bcbcbc`).

## How the criterion is read

| Clause | Read as |
|---|---|
| A half-section cutaway through a closed box under a sun at 45° | Six non-overlapping white Lambertian slabs (base 1, metallic 0, roughness 1, specular level 0) closing a 5 × 4 × 1.2 m cavity, walls 0.3 m; one plane, normal +z, removing z > offset: offset 0 (the box's front half) and offset −0.4. A key sun of 100 lx at 45° elevation, azimuth 45° (toward-sun (0.5, 0.707, 0.5)), one cascade to 12 m, the only light. |
| lights the inner floor where the cut plane's projection along the sun says | Light enters through the cut. The cut plane meets the roof's underside in a line (y 1.2, z offset); projected along the sun onto the floor it is the shadow line z = offset − 0.849. Floor pixels on the opening's side read sunlit: E·(n·l) ÷ π = 22.51 within 5%; beyond it, dark: under 5% of that. The ID target must name `floor` there (else the failure names `scene3d.geometry`). |
| within 2 shadow-map texels | Pixels within 2 × `texel_m` of the shadow line, measured across the light (in the map's own plane), are not judged; all others are. The largest `texel_m` the frame reports is used. |
| moving the plane changes the shadow map's key | The one map's key at offset −0.4 differs from its key at offset 0, and two calls at offset 0 give the same key (so a key that changes on every call does not pass). |
| the cap shades as a matte surface facing along the plane's normal | Cap pixels (the cut faces of floor, roof and west wall, found by a CPU ray cast through the cut box) read Lambert with the cap role's linear grey (0.5029) and n = +z: E × 0.5029 × 0.5 ÷ π = 8.004, within 2%. The sun's azimuth makes a cap shaded with the slab's top normal (11.32), the view direction (about 10), unlit (0.50) or with a specular lobe read differently. |
| a planted cutaway that clips only the color pass … fails, naming the pass | `--planted cut_color_only`: the floor is in the ID target but dark on the sunlit side, so a floor failure names the pass that writes `shadow`, read from the reply's `passes` (`scene3d.shadow`), and no floor failure names `scene3d.geometry`. |

Not judged: the exact light value inside the 2-texel band (soft edges and filtering are free there), the ID the cap
pixels carry, `mode: intersect`, `applies_to` a collection, `shadows: whole`, `class: document`, and caps in a drawing
look.

## Fixture and its counts

All documents are generated in `helpers.ts`; nothing is on disk. Camera (−1, 2, 4.5) → (−0.8, 0.1, −1), fov 50°,
480 × 360. Judged floor pixels lie in x ∈ [−2.3, 0.2] (the east wall's shadow line is over 1.4 m away there) and
z ∈ [−1.9, offset − 0.1], each 2 px clear of other surfaces. Counted on the CPU helpers before commit, at a band of
0.08 m (two texels of 4 cm):

| Offset | Shadow line z | Sunlit floor px | Shadowed floor px | Cap px |
|---|---|---|---|---|
| 0 | −0.849 | 5,823 | 5,231 | 28,618 |
| −0.4 | −1.249 | 4,731 | 2,771 | 25,325 |

The test requires at least 2,000, 2,000 and 500. A coarser map fails with the counts. CPU shadow rays through the cut
box agree with the closed-form shadow line on every judged pixel.

## What was run

- Not run: cargo, the GPU and vitest. `node_modules` is absent here, so tsc was skipped.
- In scratch (not committed), the committed `section.test.ts` and `helpers.ts` ran under Node 23's type stripping, with
  a minimal vitest stand-in, a no-op `cargo` and a CPU stand-in for `deep-gpu`. A right program passed both tests,
  plant included. Each of these failed where it should: no cutaway (the base's behavior, named as `scene3d.geometry`);
  a shadow pass keeping the stale plane; a flat cap; a cap shaded facing +y; a key without the planes; a key that
  changes on every call; a 0.5 m texel; and a binary that ignores `--planted`.
