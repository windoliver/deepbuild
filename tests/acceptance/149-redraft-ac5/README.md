# Blind redraft of #149's seek criterion

`AC5 #149.75d75ba2`: "Seeking to any time equals playing to it by pixel hash for every field, and no field reseeds with
playback".

Written fresh from issue #149, the design and base commit `c12a65bb`, by a job that never saw an implementation. The
implementing agent doesn't edit these files; a dispute goes to a blind redraft (AGENTS.md, Proof; design: Dogfooding).

What was read: `AGENTS.md`; `docs/technical-design.md` (Dogfooding, Tests written first); `docs/canvas-primitives.md`
(Units and axes, Paint, Paint: noise fill, Look `look@1` and its strokes on surfaces, light, paper, line profiles and
drawn fills, Camera `camera@1`, Effect and GPU operator: collection targets); `tests/acceptance/430/` (README,
`helpers.ts`, which this suite imports for the build and the driver); at the base `crates/deep-gpu-layer/src/film.rs`,
`view3d.rs`, `parity.rs`, `crates/deep-canvas/src/camera.rs`, `crates/deep-canvas-scene3d/src/scene.rs`, `look.rs`,
`crates/deep-scene3d-render/src/mesh.rs`, `crates/deep-canvas-marks/looks/`.

Run it on a Mac, from the checkout's root:

```
npx vitest run tests/acceptance/149-redraft-ac5
```

Off macOS each test fails with `INCONCLUSIVE:`. It makes about 8 processes for each of 14 fixtures in each dimension.

## The fixtures

`fixtures.ts` holds one document per family, each with its own subject, in a 2D look (`film2d`) and a 3D look (`view3d`):
light (a ferry), paper in each of the eight tooth kinds with its age marks (a kite), line profiles (a heron), drawn fills
ink, wash, spatter, offset and hatch (a market stall), collection targets in all four outputs (a flock), the noise fill
in each kind (a weather chart) and strokes on surfaces (an orchard).

Each film is 13 frames at 20 fps. A part moves and the camera trucks through hold keys, one a frame, out and back, so
every frame differs from the last and frames n and 12 − n hold exactly one evaluated document. `framing` works out every
corner's projected place at every tick, with `fov` across the wider side, and fails if one leaves the frame.

## What is held, and what each hold catches

`holds.ts`, on each fixture:

| Hold | Fails on |
| --- | --- |
| Adjacent frames differ | A film that stands still, or draws blank |
| Frames n and 12 − n are equal: one document at two times | A seed from the film's own clock, a frame index or frames drawn. No comparison at one time can see the first of these |
| A second play in a fresh process equals the first | A seed from the wall clock or the process |
| A play opened at frame 4, nothing drawn before it, equals play from there on | A seed from frames drawn; a field keeping state from the frame before |
| Frames 2, 7 and 11, each sought alone in a fresh process, equal play | The same, at the first frame a process draws |
| The same times at 40 fps equal play | A seed from a frame index at a given rate |
| Frame 4 differs from the same film with the family's fields off | A field that draws nothing, which could never reseed |

The second and last aren't in the criterion's words. The second is its clause "no field reseeds with playback"; the last
keeps it from passing on fields that were never drawn.

Checked by a one-off model without a GPU: `judge` passes a right program and fails one seeded from frames drawn, the wall
clock, the film clock, a frame index, one keeping the previous frame, and one whose field draws nothing. The suite itself
plants nothing.

## Forms read from the design, which it doesn't spell out

- `ground: {kind: paper, params: {role, spine, grid, seed, anchor, zoom, tooth, age}}`, with `rules` and `margin` left out.
- Fill and line kinds flat in their entry, as `lines` and `fills` are today: `{kind: 'ink', coverage, …, seed: 'item'}`.
- `seed: 'document' | 'item'` on tooth, age, profile and look fills, numeric on the noise fill.
- `folds` and `creases` as counts, `foxing` as an amount, `tape` as `[[x, y, w, h]]`.
- `strokes.orient: 'surface'` and `strokes.palette: {all: [palette name]}`: a region named `all` is this suite's reading.
- A channel on `items/<id>/params/paint/fill/noise/evolution`.
- `resolution: 'half'` on a collection target, and a group's `gpu.pass@1` around 3D marks, as #430 has around 2D marks.
