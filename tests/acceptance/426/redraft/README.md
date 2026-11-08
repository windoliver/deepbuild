# Blind redraft of #426's AC2 test

Written by a fresh run of the acceptance-test job (technical design: Dogfooding, disputes) for one criterion, AC2
`#426.f893b6e0`, from the issue's scope and AC2, the design and the base commit `c12a65bb` only. No implementation,
other worktree, branch or parent suite was seen. `ground.test.ts` and `helpers.ts` stand alone: they import nothing but
node built-ins and vitest. Whoever settles the dispute decides whether this file replaces the original.

## What was read

- Issue #426: its scope (an HDR background lies on a ground at y = 0, projected from the photo's camera height within
  a radius; lighting unchanged; the backdrop pure in t; the projected floor writes no depth and takes no pick; items, a
  shadow catcher on y = 0 and status colors draw over it) and AC2.
- `docs/canvas-primitives.md`: Sky `sky@1` and its environment (`environment.from: sha256`, `background: auto` draws
  an HDR asset behind the scene, `background_ground: {height, radius}`: "each view ray meets a dome of `radius` around
  (0, `height`, 0) whose floor is cut flat at y = 0, and the background shows the environment in the direction from
  (0, `height`, 0) to that point"), Material: shadow catcher ("black with alpha equal to the share of light its shadows
  … remove, in linear light"), Material, Light and the light policy, Light policy: cascades, Channel and key.
- `docs/technical-design.md`: Dogfooding (how acceptance tests are drafted and disputed), and how checks are proven.
- Base code, for conventions only: `crates/deep-gpu-layer/src/view3d.rs` (the call's fields: `fps`, `from`, `frames`,
  `capture`, `targets`, `assets`, `clicks` and each frame's `{at, pick}`), `crates/deep-gpu-layer/src/main.rs` (the
  planted names: none for #426), `crates/deep-canvas-scene3d/src/sky.rs` (how the sky's fields are spelled; an HDR is
  named by its hash and read through the call's `assets`), `crates/deep-scene3d-render/src/env.rs` (the HDR file format
  the base reads: Radiance RGBE, `-Y h +X w`; the equirectangular orientation: u from −Z turning toward +X, rows down
  from the zenith), `crates/deep-canvas-scene3d/src/frames.rs` (an f32 channel addresses an array element,
  `items/<id>/…/0`), and the suites `tests/acceptance/421/`, `422/`, `424/` and `424/redraft/` (harness, plain look,
  PNG reading, #378's pinhole, the catcher fixture of #424's AC1, seek against play).

## Surfaces used

`deep-gpu run`, one JSON line `{out, calls}` in and one out; `view3d` with `look`, `size`, `fps`, `from`, `frames`,
`capture`, `targets: ['final']`, `assets: {sha → path}` and `clicks: [{frame, at}]`; each frame's `final` PNG named by
its SHA-256 and its `clicks: [{at, pick}]`. The document: `camera@1` (position, target, fov), `sky@1` with
`environment: {from: <sha>, intensity: 1}` and `background_ground: {height: 1.7, radius: 20}`, `material@1` with
`catch: shadow`, `mark.box@1`, `light.sun@1` (shining along its own −Z, aimed by `at.rot`), and three f32 channels on
`items/cam/params/position/0..2`. The plain look: tone map none at exposure −log2 1.2 (scale 1), no bloom, no deband,
no finish, so the final target is the sRGB encoding of linear light. No license is passed with the HDR: the base reads
it without one (a correct program that refuses an HDR without a license would fail here, and that is a reading to
dispute).

## How the criterion is read

| Clause | Read as |
|---|---|
| a test HDR whose lower half is a grid of flat 10° cells | A 720 × 360 Radiance file. Below the horizon, 36 columns of 10° of azimuth (from the image's left edge) by 9 rows of 10° of polar angle (from the horizon down), each one flat color; above it, one flat grey. Each texel's RGBE exponent is 128, so its radiance is exactly mantissa ÷ 256 and the file loses nothing. |
| each a color at least 4 code values from every other cell's | The final target's codes of any two cells (sRGB encoding of mantissa ÷ 256, rounded) differ by at least 4 in some channel. The fixture's spacing is wider: the least distance is 23, checked before anything is drawn. |
| `background_ground: {height: 1.7, radius: 20}` and tone map none | Exactly those fields; the plain look above. |
| the background pixel where the world point (2, 0, 1) projects | The one pixel holding (2, 0, 1)'s projection by #378's pinhole (position, target, +Y up, fov across the wider side): 480 × 360 at fov 60°. Nothing else is in the scene, so the pixel is background. |
| shows the flat color of the cell holding direction (2, −1.7, 1) within 1 code value | That cell (column 29, row 3: azimuth 296.6°, θ 127.2°, 2.73° inside its edges) as 8-bit codes, rounded, and the pixel within 1 in every channel. As a check on the fixture, the backdrop directions of the pixel's centre ray and its ±1 px neighbours, by the design's dome, all lie in that cell at least 1° inside it, so filtering across a cell edge can't move the pixel. |
| from a camera at (0, 1.5, 5) aimed at the origin and after it moves to (3, 1, 4) | One document: the camera's position keyed linearly from (0, 1.5, 5) at 0 s to (3, 1, 4) at 0.5 s, target the origin. Played at 60 fps from frame 0; frames 0 (the first pose) and 40 (the second pose, held since frame 30) are judged. The pixel is (435, 208) at frame 0 and (372, 231) at frame 40. |
| the frame at t has the same pixel hash seeked or played while it moves | Frame 15 (t = 0.25 s, halfway through the move) played from frame 0 in one process, and drawn by a fresh process opened at frame 15 (`from: 15`): the SHA-256 of the decoded RGBA pixels of each `final` must be equal. Frame 15 must differ from frame 0, so the camera is moving at t. |
| a planted backdrop that centers the dome above the camera shows another cell and fails, naming the pixel | The dome centred at (eye x, 1.7, eye z) instead of (0, 1.7, 0). The base has no planted switch for it, so it is a CPU image of that backdrop run through the same judge, which must fail, naming the pixel; there it shows column 20 row 2 at frame 0 and column 16 row 2 at frame 40. The right program's CPU image must pass the same judge. |
| A 0.5 m box at the origin | A white Lambertian box standing on the origin: 0.5 m on each side, 0 ≤ y ≤ 0.5, centred on (0, 0.25, 0). |
| under a sun at 45° | A key sun at 45° elevation shining along (0.5, −0.707, 0.5) (`at.rot` (−45°, −135°, 0)), casting, giving the floor 10,000 lx. A second sun straight down that casts no shadow gives the floor another 10,000 lx (see below). |
| over a shadow catcher on y = 0 | A 2 × 2 m `mark.box@1` 2 cm thick whose top is y = 0, with `catch: shadow`. |
| the floor's value × (1 − the catcher's alpha) within 1 code value | The floor's value: the projected floor's linear color at the pixel (the cell its backdrop direction falls in). The catcher's alpha: the share of the floor's light the box's shadow removes, here 10,000 ÷ 20,000 = 0.5; the environment's own light on the floor (under 2 lx: radiance under 1 over the hemisphere) moves it by under 0.01%, a hundredth of a code. Each judged pixel must read the sRGB code of floor × 0.5, rounded, within 1 in every channel. The fill sun is there so the alpha is 0.5 and the product is a real test of the composite: under one bright sun alone the alpha is 1 less the environment's share and the expected value is black, which an opaque black catcher would also give. |
| leaves the projected floor in its shadow | Judged pixels: the centre ray meets y = 0 before the box, the point lies in the box's shadow (a ray toward the key meets the box) at least 5 cm from the shadow's edge and from the box's foot, all ±2 px neighbours do too, and the backdrop direction lies at least 1° inside one cell. 1,891 pixels across 14 cells; at least 500 are required. |
| a click on the projected floor picks nothing | A click at the centre of the pixel holding (1.25, 0, 0.3), on the projected floor 25 cm beyond the catcher's edge (80 px from it) and 1 m from the box, answers `pick: null`. A click on the box's top centre must answer `box`, so a binary whose clicks answer nothing can't pass. |
| a planted order that draws the backdrop after the catcher shows no shadow and fails | A CPU image of the judged pixels with the backdrop drawn over the catcher (the floor's own value) fails the same judge on every pixel, naming the first. The right order's CPU image passes it. |

Not judged: pixels other than these, the box's own color, the catcher's alpha outside the shadow, depth, the ID
target, status colors, `background_blur`, `mix` and a moving HDR.

## Fixture and its counts

All documents and the HDR are generated in `helpers.ts` into a fresh temporary folder; nothing is on disk. Counted on
the CPU helpers before commit:

| Quantity | Value |
|---|---|
| Least code distance between two cells | 23 |
| (2, −1.7, 1)'s cell, its margin to the cell's edge | column 29, row 3; 2.73° |
| (2, 0, 1)'s pixel at frames 0, 15, 40 | (435, 208), (434, 229), (372, 231) |
| The planted dome's cell there at frames 0 and 40 | column 20 row 2; column 16 row 2 |
| Shadow core pixels (640 × 480, camera (1.4, 1.5, 2) at (0.35, 0, 0.35), fov 50°) | 1,891 over 14 cells |
| Floor click, box click | (575.5, 327.5), (291.5, 53.5) |

## Planted programs

The base's `deep-gpu` has no planted switch for #426 (its `--planted` names stop at #424, #425, #428 and #483), so
each planted wrong program the criterion names is a CPU reference image of what that program draws, run through the
same pixel judge the renderer's frame goes through: `cpuBackdrop(cam, 'above_camera')` for the dome above the camera,
and `cpuShadow(core, 'backdrop_over')` for the backdrop drawn after the catcher. Beside each, the right program's CPU
image (`'origin'`, `'catcher_over'`) must pass, so the judge is shown to tell them apart. These prove the judge, not
the renderer; a renderer switch for each would let the same test run the planted program itself.

## What was run

See `BASE-RUN.txt`: the suite run once in the exported base `c12a65bb` on this Mac's Metal device, with
`cargo build --locked --bin deep-gpu` there first, through `scripts/lease` (which ran it unleased: no `deep` CLI in the
export). All three tests pass on the base: it already lays an HDR background on its ground (the sky parses
`background_ground` and the background pass meets the dome around (0, height, 0)), seeks equal plays, the catcher
composites over the projected floor and the floor takes no pick. So this criterion holds no failing test on the base;
the planted programs fail only as CPU images (above). Before the run, the CPU fixture numbers above were computed with
a scratch vitest file outside this folder (not kept).
