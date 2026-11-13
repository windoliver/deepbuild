# Blind redraft of #2017 AC2

This folder is a blind redraft of #2017's second criterion, AC2 `#2017.e778fe83` (docs/technical-design.md:
Dogfooding: "A disputed test goes to a fresh run of that job, with the same inputs and the criterion, never the work,
the diff or the dispute"). It was written from the issue, its parent, its oracle page, the design and base `108fea237`
(`eeb45a10a` plus the first draft of this issue's suite), before any implementation, and without reading any other
worktree, branch or pull request. It stands beside `tests/acceptance/2017/ac2-light-holds.test.ts` and changes nothing
there; which draft stands is the Dogfooding rule's call, not this folder's. The implementing agent doesn't edit it.

## What was read

- Issue #2017: its Scope (shading normals "from the plate's full-resolution heights at every level, so the light on a
  tile doesn't change when its level does"), its Fields (Builder plate: terrain), the criterion and the Proof line; its
  parent #442's parts; its oracle page (no upstream test checks criterion 2, so no oracle folder).
- `AGENTS.md`; `docs/technical-design.md`: Dogfooding, and "Proven on the base" (a new check fails on the base at an
  assertion of its own).
- `docs/canvas-primitives.md`: Builder plate: terrain ("levels are chosen and morphed by the tile's projected error, as a
  chunked plate's height tiles are"); Level of detail: levels by error (`lod_px`, 1 device px on each budget class, which
  a document may only lower); Level of detail: chunks streamed by view ("Each tile's normals, and the detail below its
  spacing, come from the full-resolution source, never from its own coarse samples, so a level change leaves its light
  alone"; the morph of odd vertices toward the parent).
- In the checkout at `108fea237`, for surfaces only: `tests/acceptance/2017/README.md` (its Assumed surfaces, reused
  here unchanged) and `helpers.ts` (parts copied); its `ac2-light-holds.test.ts` was in the checkout and was read too
  (disclosed; this draft chose its own fixture, judge and guards). `crates/deep-gpu-layer/src/main.rs` (`Planted`,
  `--planted`, an unknown name refused `bad_input`); `view3d.rs` (`doc`, `look`, `size`, `frames`, `capture`,
  `targets`, `lod`; `write_final`); `crates/deep-scene3d-render/src/lib.rs` (`read_view_depth`: the `depth` target, f32
  a pixel, distance in m along the view axis); `crates/deep-canvas-scene3d/src/terrain.rs` (the plate at full detail,
  smooth vertex normals from its triangles) and `scene.rs` (`posed`: an orthographic view's px a metre is width ÷
  `view_width`; `local_of`'s Rz·Ry·Rx; a sun shines along its local −Z); `crates/deep-canvas/src/camera.rs`
  (`screen_basis`: looking straight down, screen right is +X and screen down +Z); `scripts/proof-change.mjs`
  (`criterionId`).

Every expected value comes from the issue and the design; the code was read to learn the surface.

## Run it

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2017-redraft-ac2 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2017-redraft-ac2/tsconfig.json
```

- **Build.** The file first runs `cargo build --locked --bin deep-gpu` with the pinned toolchain's folder and
  `/opt/homebrew/opt/rustup/bin` first on `PATH` and `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0` unless set, copies
  the binary out of the target folder (honoring `CARGO_TARGET_DIR`), and fails each test with cargo's error if it fails.
- **Platform.** The picture is drawn on Metal: off macOS each test fails with a message starting `INCONCLUSIVE:`, and so
  does a `view3d` that answers `unsupported_platform`. Neither ever passes.
- **Isolation.** Each test writes into its own temporary folder and deletes it. Node built-ins and vitest only.

## The fixture

Generated in `helpers.ts` (`plateDoc`); no file on disk. Metres, +Y up. A `view3d` session document, every item in one
writer layer `main`, camera `cam`, `budget.class: work_product`.

- **The plate.** `ground`, a `plate@1` with `params.terrain`: `size [256, 256]`, `spacing 1`, `tile 64` (4 × 4 tiles),
  `lod_levels 6`, height `0.08 * sin(position.x * 0.7853981633974483) + 1.5 * sin(position.x * 0.029) * cos(position.z * 0.023)`:
  an 8 m ripple along x, 8 cm high (slope up to 3.6°), on gentle hills (slopes under 2.5°). No `at`, so its own space is
  the world's. Tile [i, j] covers x from −128 + 64 i to −64 + 64 i, z likewise with j.
- **The light.** `light.sun@1`, illuminance 12, white, `shadow: false`, `at.rot [-10, 90, 0]`: it shines along its local
  −Z, so toward −x and 10° downward, from 10° above the horizon on the +x side. `sky@1` black with no ambient. One
  `material@1`, grey 0.6, roughness 1, metallic 0. The ground's tilt toward or away from the sun stays under 6.1°, so
  N·L runs from about 0.07 to 0.24 (0.17 on flat ground) and no ground faces away from it.
- **The view.** An orthographic `camera@1` at (0, 100, 0) looking at the origin, `view_width` 120, near 1, far 200,
  drawn at 960 × 540: 8 px a metre, x from −60 to 60 and z from −33.75 to 33.75, on tiles [1, 1], [2, 1], [1, 2] and
  [2, 2]. No pixel centre lies on a tile edge. Looking straight down, a pixel sees the same ground (x, z) at any height,
  so between two draws only its shading can change.
- **The look.** #166's physical look with tone map `none` at the exposure whose scale is 1, no finish, deband, bloom,
  ao or 3D ground.
- **The two draws.** `view3d`, `frames: 1`, `capture: [0]`, `targets: ['final', 'depth']`, `lod: true`: the document as
  written (lod_px 1), and the same with `budget: {class: work_product, lod_px: 0.01}`.

Expected levels (a scratch model, not kept: each level's samples every 2^level m, split as the base splits its cells, its
error the largest deviation from full detail over the tile's samples, × 8 px a metre): errors 0, 0.14, 0.67, 0.75,
1.13 and 2.4 px on each tile in view, so the coarsest within 1 px is level 3 as written, and level 0 at 0.01 px. Levels 2
and up keep samples 4 m apart or more, on the ripple's zeros, so their heights hold none of it.

## The criterion and its test

| ID | Criterion | `ac2-light-holds.test.ts` |
|---|---|---|
| AC2 `#2017.e778fe83` | "Under a sun 10° above the horizon, a plate pixel's lit color changes by at most one code value when its tile changes level; a planted plate that shades from each level's own vertex normals changes it by more and fails, naming the tile" | Two tests, both named from `AC2 #2017.e778fe83`. **The shipped program:** the two draws; some tile in view changes level, each such tile coarser than full detail as written and at full detail lowered, its drawn depth changing somewhere by more than 5 mm; every pixel of every such tile keeps its final color within one code value in each of red, green and blue (the judge, each failure naming its tile); under 1% of the compared pixels clipped at 0 or 255; and at full detail the ripple shows in the light, green where its slope faces the sun at least 10 code values above green where it faces away, on average. **The plant:** the same two draws under `--planted terrain_shades_own_level_normals`; some tile in view still changes level, and the judge fails, each failure naming a tile that changed level. |

What it catches: the base (no tile rows; the plant unknown); normals from each level's own triangles; full detail lit
one way and coarse levels another; detail below a level's spacing lost from its light; a level reported in the row but
not drawn; a picture that shows no light.

## Surfaces

The base's: `deep-gpu run [--planted <name>]` (#377), one scenario `{out, calls}` in and one line out; `view3d` (#378)
with `doc`, `look`, `size`, `frames`, `capture`, `targets` and `lod` (#425), each frame's `final` (a PNG named by its
SHA-256) and `depth` (#166: f32 a pixel, rows top-down, the distance in m along the view axis), an unknown planted name
refused `bad_input`.

Assumed, exactly as `tests/acceptance/2017/README.md` (Assumed surfaces) already asks the implementer; nothing new:

1. **Terrain tile rows in `view3d`'s `lod`** (its item 1): with `lod: true`, each frame's `lod` holds a row
   `{"item": "ground", "tiles": [{"tile": [i, j], "level": n, …}, …]}`, one entry per tile of the plate; `level` the
   level the frame draws the tile at, 0 full detail, the finer of two while it morphs. This test reads only `tile` and
   `level`, requires the four tiles in view and no tile twice.
2. **`budget.lod_px` lowers the terrain's `lod_px` too** (its item 3).
3. **The planted program** (its item 8), reachable only through `deep-gpu run --planted <name>`:

   | Name | The wrong program |
   |---|---|
   | `terrain_shades_own_level_normals` | Each tile shades from the vertex normals of the level it draws (each vertex's normal from that level's own triangles around it, as the base's full-detail plate computes its smooth normals), in place of normals from the plate's full-resolution heights. Levels, positions and everything else are shipped. |

## Readings where the issue leaves a choice

- **"When its tile changes level."** The same plate, sun, camera and pixels drawn as written and with the document's
  `lod_px` lowered to 0.01, so the level is the one thing that changes, and full detail, whose light is the plate's own
  by definition, is the reference. A tile changes level when its row's `level` differs. So a level only reported can't
  pass, the tile's drawn surface must move too: its `depth` changes somewhere by more than 5 mm (the ripple alone puts
  level 2 and up 8 cm off at its crests; level 1 is 1.7 cm off between its samples).
- **"A plate pixel."** Every pixel of every tile in view that changes level. Straight down through an orthographic
  camera a pixel sees one ground (x, z) at every level, and a crack or skirt between tiles has no width.
- **"Its lit color."** The 8-bit `final` target in a look that adds nothing after the light, under a sun with no
  shadow and a black sky with no ambient, on one matte grey, so a pixel's code values are the sun's light on its shading
  normal. "At most one code value" holds in each of red, green and blue.
- **"Under a sun 10° above the horizon."** Rotated as above, with no shadow: a shadow's edge would follow the drawn
  heights, which the criterion doesn't judge, while the light on the shading normal is what it does.
- **Why the ripple.** Level 3 keeps none of the ripple in its heights, yet its error, about 0.09 m, is 0.75 px at 8 px
  a metre, within 1 px. The design puts the detail below a level's spacing in its light from full detail, so the light holds; normals
  from level 3's own triangles lose the ripple's 3.6° and change N·L by up to about 0.06 against 0.17 on flat ground.
- **The guards.** A black, flat or saturated picture holds its color trivially, so under 1% of the compared pixels may
  be clipped, and at full detail the light must show the ripple: green where its slope faces the sun (cos(k x) ≤ −0.7,
  the ground descending toward +x) at least 10 code values above green where it faces away (cos(k x) ≥ 0.7), averaged
  over the compared pixels. On the base's full-detail plate it is 46 (BASE-FAILURE.txt), with green from 115 to 193 and
  nothing clipped.
- **Bounded memory.** Each statistic is one pass over the pixels with a fixed number of sums and one record per tile in
  view; nothing collects per-pixel values, so a picture of any size runs in bounded stack and memory beyond its own
  decoded pixels.

## Not tested

No other part of the criterion's text asks for these: perspective views, shadows, cover, the morph's shape, skirts and
tile edges, other sun angles, more than one frame, the selection's errors (criterion 1's).

## What the implementer adds outside this folder

- `scripts/lanes.mjs`: `alone.push('tests/acceptance/2017-redraft-ac2/');` (the file builds deep-gpu and draws on the
  Metal GPU, so it runs alone).
- In `deep-gpu`, the three surfaces above, which `tests/acceptance/2017/README.md` already lists.
