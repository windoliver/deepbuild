# C1 blind redraft: a box's edge has partial coverage at 4× MSAA on every frame and every export

Test file: `edges-redraft.test.ts`, helpers `edges-redraft-helpers.ts`, type-check config `tsconfig.c1-redraft.json`.
One `describe` with three `it`s, each named with the criterion's ID `#1173.b5284ee0`.

The criterion: "A box silhouette drawn at 4× MSAA has pixels of partial coverage along its edge on every frame and
every export, and a planted single-sample target fails, naming the target". The issue's Proof line: "Edge coverage
read back from the resolved targets".

## What I read

- Issue #1173 (body, Scope, the five criteria, Proof, Depends on #378 and #380).
- AGENTS.md; `docs/technical-design.md`: Dogfooding (2524), "Tests written first, by a job that never sees the code"
  (2555), the scene renderer ("the sky, the mesh and soft cloud puffs, multisampled", 641); `docs/canvas-primitives.md`:
  the GPU surface (838: `msaa: transient`), the frame-key line (9138: the key hashes MSAA), Temporal effects (9343:
  "MSAA and sample-based motion blur cover exports, render-back and checks").
- At base `e2e6e1cc`:
  - `crates/deep-scene3d-render/src/lib.rs`: `texture2d` makes every target with `sample_count: 1`, `pipeline` uses
    `multisample: Default::default()`; the linear target is `Rgba16Float`; the geometry pass writes `linear`, `ids` and
    `depth`, the output pass reads `linear`. `scene3d.wgsl`: an unlit material returns its base color plus emission.
  - `crates/deep-gpu-layer/src/main.rs`: the `surface` reply's `"msaa": "transient"`; the `--planted` table.
  - `crates/deep-gpu-layer/src/view3d.rs`: `targets` takes `final`, `linear`, `ids`, `pre_tone`, `dirt`; `linear` is
    written as f32 RGBA named by its SHA-256; frame n is drawn at t = n ÷ fps; the reply's `passes` and `surface`.
  - `crates/deep-gpu-layer/src/live.rs`: `canonical` (`{look, writer, doc, size, frame, purpose, fps}`, t =
    (frame − 1) ÷ fps) replies `purpose`, `pixel_hash`, `rung`, `internal_scale`, `upscale`, `operators`, and writes no
    target file.
  - `crates/deep-canvas-scene3d`: `at.rot` in degrees, R = Rz·Ry·Rx; an array `base_color` is linear; `unlit`.
  - `tests/acceptance/386/` (README, helpers, `upscale.test.ts`: the INCONCLUSIVE gate, builds, `run`, the
    `canonical` call), `tests/acceptance/378/` (`C1-REDRAFT.md`, the linear-target reader), `tests/acceptance/420/`
    (format), `tests/acceptance/423/helpers.ts` (orthographic camera and unlit material shapes).

## The fixture (`cubeDoc`)

- View 480 × 360 px; an orthographic `camera@1` at (0, 0, 20) looking at the origin, `view_width` 8 m (60 px a metre).
- A 2 m `mark.box@1` under a `material@1` with `base_color: [0.8, 0.8, 0.8]` (linear) and `unlit: true`, on the look's
  ground `#101114` (tone map none at unit exposure, no finish, deband, bloom or 3D ground). Unlit, every face is one
  linear color, so the silhouette is a flat polygon of that color on the ground: nothing but coverage can make an
  in-between pixel.
- The cube is turned 45° about X and 35.264° about Y (corner-on: a regular hexagon, about 98 px from centre to corner,
  about 590 px around, 14% of the view), then by θ about the view axis. Channels over the 1 s span turn θ from 0 to
  175.2° and slide the box 0.73 m right and 0.53 m up: 7.3°, 1.825 px and 1.325 px a frame. 24 frames at 24 fps, so
  each frame puts the six edges at new angles and sub-pixel offsets.
- Why a hexagon and not a square face: a straight edge along a pixel axis whose offset falls within 1/8 px of a pixel
  boundary splits no pixel's 4 samples, so an axis-aligned square can show no partial pixel on a side for a quarter of
  placements. The hexagon's edges run in three directions 60° apart, so at any θ at least four of its six edges are
  15° or more off both axes, and those cover every sub-pixel offset along their length.

## The measure (`edgeCoverage`, `coverageProblems`)

The resolve averages a pixel's samples in the target's linear color space, so a pixel that k of n samples cover reads
exactly k ÷ n of the way from the ground's color to the face's; the final target then encodes that value in sRGB for
display. The measure therefore works in linear light: on the resolved `linear` target as read back, and on the `final`
PNG after decoding its sRGB codes.

1. Ground G = per-channel median of the view's outer 4 px ring; face F = median of the 9 × 9 px at the view's centre
   (the box covers the centre on every frame).
2. Each pixel's coverage α = (c − G)·(F − G) ÷ |F − G|², and its distance from the G-to-F line ÷ |F − G|.
3. The silhouette: pixels with α ≥ 0.5. Its edge: silhouette pixels with a 4-neighbour outside it (E pixels).
4. A pixel is partly covered when 0.125 ≤ α ≤ 0.875 (4× MSAA's levels are 1/4, 1/2, 3/4; single-sample reads 0 or 1;
   the window is half a level wide on each side, far above 8-bit and half-float rounding) and it lies within 0.05 of
   the G-to-F line. P counts those within 2 px (Chebyshev) of the edge.
5. Pass: P ÷ E ≥ 0.3 and P ≥ 60. Fixture guard (a failure too, reported apart): F at least 0.3 above G in linear
   luminance, and the silhouette 8% to 25% of the view.

A failure names the frame or the export, the target read (scene3d's `linear` target read back resolved, or the `final`
target drawn from it), the sample count the reply claims, and the numbers.

## Simulation (a script using these helpers' `silhouette`, `rasterize`, `throughFinal`, `edgeCoverage` and `coverageProblems`)

The silhouette is rasterized on the CPU with each sample a point-in-polygon test, a pixel's samples averaged in linear
light, and read as the linear target (float) and through the final (sRGB-encoded to 8 bits, decoded back). Patterns:
the standard 4× positions (D3D, Metal, Vulkan: (6,2), (14,6), (2,10), (10,14) sixteenths), a 2 × 2 grid, and one
sample at the pixel centre.

Share P ÷ E (lowest to highest), and the reads failing the measure:

| Sweep | standard 4× | grid 4× | 1 sample |
|---|---|---|---|
| The fixture's 24 frames, linear and final (48 reads) | 0.766 – 0.876 (P 406 – 466), 0 fail | 0.496 – 0.744 (P 264 – 387), 0 fail | 0.000 (P 0), 48 / 48 fail |
| θ 0° – 60° by 0.5° (the hexagon's period) × offsets on a 1/4 px grid, 60 px/m (1,920 poses, each read linear and final) | 0.685 – 0.876, 0 fail | 0.496 – 0.880, 0 fail | 0.000, all fail |
| θ 0° – 180° by 3° × offsets 0.1 and 0.55 px × 45, 52.5, 67.5, 75 px/m (960 poses, linear and final) | 0.501 – 0.879, 0 fail | 0.498 – 0.876, 0 fail | 0.000, all fail |
| 400 random turns and offsets, through the final | 0.686 – 0.863, 0 fail | 0.547 – 0.805, 0 fail | 0.000, 400 / 400 fail |

In every sweep no partly covered pixel lay farther than 2 px from the edge (stray 0) and no pixel near the edge was off
the ground-to-face line (off-line 0), so 8-bit sRGB rounding of the final moves no pixel across a threshold: the final
and linear reads gave the same numbers. The lowest 4× shares come at θ = 0° and 90°, where two edges are axis-aligned;
0.3 leaves a margin of about 0.2 below them, and single-sample reads exactly 0 everywhere. The script and its full
output (`simulate.ts`, `simulation.txt`) stay in the job's scratchpad, outside the repo; it took 677 s.

## Surface fields and the planted program

The base has no sample count and no export targets, so the tests read these, named as the issue names them:

- `view3d`'s reply `surface` (#386's report of what the view drew through) gains `msaa`: the sample count scene3d's
  targets were made with, a number (4 here). The test sends no option: the view draws at the count the surface reports.
- `canonical` takes `targets: ["final", "linear"]`, as `view3d` does, and writes those targets of the export frame
  into the scenario's `out` folder, named by their SHA-256 (`final` a PNG of the slot's bytes, `linear` the resolved
  linear target as little-endian f32 RGBA, rows top-down), and its reply gains `final`, `linear` and `msaa`.
- `deep-gpu run --planted single_sample_targets`: scene3d's geometry-pass targets (color and depth) made single-sample,
  in the live view and in canonical renders alike. Its replies may report any `msaa`; the planted test reads only pixels.

The target a failure names is the one `view3d`'s `passes` says scene3d's geometry pass writes and its output pass reads
(`linear` at the base), which the test checks before measuring.

## Tests

| `it` | Asserts | A wrong program fails it |
|---|---|---|
| the measure (holds at the base) | On the CPU rasterizer at poses 0, 5, 10, 15, 20: standard and grid 4× pass, linear and through the final; 1 sample fails with one problem, "… the synthetic `linear` target: 0 pixels of partial coverage …" | proves the measure only, never the renderer |
| every frame and every export | One `deep-gpu run`: `view3d` frames 0 … 23 (`capture: every`, `targets: [final, linear]`) and 24 `canonical` exports of frames 1 … 24 (the same times). `surface.msaa` and each export's `msaa` are 4; each final PNG's slot hash equals its `pixel_hash`; all 96 reads (2 targets × 24 frames, 2 × 24 exports) pass the measure | the base (no `msaa`, no export targets, single-sample edges) |
| planted single-sample target | The same run under `--planted single_sample_targets`: every one of the 96 reads keeps the fixture (the box draws) and fails the measure with exactly one problem naming scene3d's `linear` target; frames and exports both fail | it is the wrong program |

Off macOS the two drawing tests fail `INCONCLUSIVE:` before building or drawing (as #386's do), and an
`unsupported_platform` reply reads the same; neither ever passes there.

## Readings where the issue leaves a choice

- "Every frame" is every frame of a 24-frame `view3d` run; "every export" is a fresh `canonical` render, purpose
  `export`, of each of those frames. Render-back and checks (the Scope) are not in this criterion's text and aren't
  drawn here.
- "Pixels of partial coverage along its edge" is read as a share of the edge, not one pixel, so a stray partial pixel
  can't pass a single-sample target. 0.3 sits below the lowest share the simulation found for either 4× pattern and
  far above single-sample's 0.
- "Read back from the resolved targets": both the resolved linear target and the final target drawn from it are read,
  for frames and exports alike.

## Type check and run here

- `node_modules/.bin/tsc -p tests/acceptance/1173/tsconfig.c1-redraft.json`: exit 0, no output.
- `node_modules/.bin/vitest run --root tests/acceptance/1173 edges-redraft.test.ts` on Linux: the measure test passes;
  the two drawing tests fail `INCONCLUSIVE: the GPU layer draws these pixels on macOS's Metal device; this is linux`.
  `Tests 2 failed | 1 passed (3)`. Not run on a Mac.
