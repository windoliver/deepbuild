# Acceptance tests for #2034: shadow tiles by what the view sees, every shaded key light keeps its shadow from one atlas

Written first, blind, from issue #2034 (its scope, including the Nov 22 line on `local_map` that answers the Nov 9
tracker review, its seven acceptance criteria, its proof line and its "Runs on" line), the design sections it links and
those they lean on, and the base commit `5fcfb690b` ("Merge pull request #3079 …"), by a job that never saw an
implementation; none existed, and no other worktree, branch or pull request was read. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). One file per
criterion, plus exactly the five planted wrong programs the criteria name. The issue's oracle page says no upstream test
checks these criteria, so there is no oracle lane.

## What was read

- The issue, live (`gh issue view 2034 --comments`).
- `docs/canvas-primitives.md`: Light policy: local shadows; Light policy: soft shadows; Light and the light policy;
  Document envelope (`light_policy`, `size`); Camera `camera@1` (#378's pinhole). `docs/technical-design.md`: Light
  without history; Dogfooding; Tests written first.
- At the base, only to learn how surfaces are driven: AGENTS.md; `tests/acceptance/446/` (README, helpers), `1634/`
  (README, helpers, reference, budgets), `425/` (hold channels), `2031/` and `2053/` (merge-base builds), `1015/` and
  `1018/` (budgets); `crates/deep-canvas-scene3d/src/{light,sets,scene}.rs` (`Shadowing`, `shadowed`, the policy's
  scores, `light_policy` parsing, the camera's focal length); `crates/deep-scene3d-render/src/{local,shadow}.rs` and
  `scene3d.wgsl`'s `local_lit`; `crates/deep-gpu-layer/src/{main,view3d}.rs` and `view3d/{parse,history}.rs` (the
  `--planted` table, the `view3d` call, its `shadows` report, `lights_over_budget`, seeks and patches);
  `scripts/{lanes.mjs,throttle.mjs,lease}`. No expected value comes from them.

## What the base already does, which these tests don't credit

A document with no `light_policy` draws no local shadow map; one that names a policy but no counts shadows the top 2
spots and no point light, each map `local_map` px (512) a side, at most 8 spots and 4 points; the rest are reported in
`lights_over_budget`'s `shadows`. The parser reads only `spots` and `points` under `shadowed`, so `local: fixed` passes
unread and the hall under `fixed` already draws as today. `shadows.maps` rows hold `light`, `kind`, `key` and `drawn`,
no `size`, `slots` or `pixel_hash`. None of the planted names exists (`deep-gpu run --planted <name>` answers
`bad_input` and exits 2). So AC6 passes at the base by construction (it holds the change to the base's picture); every
other test fails there at its own assertion or, for a plant, at the run. `BASE-FAILURE.txt` holds the noop-lane run at
the base, says which Metal files weren't run there and why, and records the fixture checks made against the base's
binary with today's fixed maps.

## Run them

Every file builds `deep-gpu` (#1634's `useGpu`: `cargo build --locked --bin deep-gpu` in this checkout, the pinned
toolchain added to PATH when installed). `ac6-unchanged.test.ts` also exports the merge base with `git archive` into
`<target>/acceptance-2034-base/` and builds its `deep-gpu` there (a cold build the first time; git runs with every
`GIT_*` variable removed); `ac7-budget.test.ts` builds `--release` only where a timing can be judged. So the folder runs
alone: `lane.json` here says so (#1327's suite lane file). **The implementer adds
`'tests/acceptance/2034/ac7-budget.test.ts'` to `timed` in `scripts/lanes.mjs`**; this README is the instruction, and
AC7's test reads that list.

```sh
npm ci --ignore-scripts         # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs build --wait 720 -- scripts/lease \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/2034 --no-file-parallelism --testTimeout=600000
npx tsc --noEmit -p tests/acceptance/2034
rm -rf tests/acceptance/2034/node_modules/.vite
```

- **Platform** (the issue's "Runs on"). The tile table is evaluated data: AC1, AC2's 32 lamps and AC6's hall under
  `fixed` run on the noop lane (`deep-gpu run --backend noop`), on any machine the binary builds on, Spark included.
  Every frame, hash and timing needs macOS's Metal device and fails with a message starting `INCONCLUSIVE:` off it,
  never passing. AC7 also fails `INCONCLUSIVE:` (with its reading) wherever the perf lane can't judge a timing.
- **Isolation.** Documents and outputs go to a temporary folder per test, deleted after; AC6's merge-base tree and
  build stay under the target folder for the next run of the same merge base.

## Criteria to tests

IDs are `#2034.` and the first 8 hex digits of SHA-256 of each criterion's text as its `- [ ] ` line reads, trimmed,
whitespace collapsed (the trace lane's `criterionId`). Each test's name starts with `AC<n> #2034.<id>`; each file's
header states its fixture, numbers and wrong programs.

| ID | File (tests) | What it asserts |
|---|---|---|
| AC1 `#2034.07726d12` | `ac1-tile-table.test.ts` (2) | Noop lane. The hall at its 8 poses, a document each: every frame's `shadows.maps` (size, slots) equals `tileTable` light by light. `--planted tile_arrival_order` fails with `pose <n> (<name>): <light> holds …`, the pose's first wrong light in fill order |
| AC2 `#2034.f29824eb` | `ac2-every-light.test.ts` (3) | Metal. The hall at `above`, 19 frames (all on, then each light off by ID): each light's check pixel within 4 code values of its own off frame, and a map row for each of the 18. `--planted tile_keeps_fixed_caps` fails, the first failure naming `point_1`, the first light by ID today's 2 spots leave unshadowed. Noop lane: the 32 lamps each hold six slots of 256 px or less, no shadow reported dropped |
| AC3 `#2034.97fa2de4` | `ac3-threshold-hash.test.ts` (2) | Metal. The walk at A (1 cm nearer than `edge_lamp`'s 256 px threshold) and B (1 cm beyond): one pixel hash at each whether moving out, moving in or sought; each frame's table the rule's. `--planted tile_hysteresis` fails with `… moving in and moving out give different pixel hashes …; their tiles differ at edge_lamp: …` |
| AC4 `#2034.051fac12` | `ac4-edge-width.test.ts` (2) | Metal. The board's edge under `edge_lamp` at A (512 px) and B (256 px): 10%–90% width at B 8 coarse texels or more, A and B under 10% apart; tables the rule's. `--planted tile_filter_in_texels` fails with `edge_lamp's shadow edge is … apart, 10% or more` |
| AC5 `#2034.1a79031a` | `ac5-cache-clean.test.ts` (2) | Metal. The walk played 0–11: at frames 3 and 8 (after each crossing) and 11 (after the crate outside `edge_lamp`'s range moves) every light's tile `pixel_hash` and the frame's pixel hash equal a clean render's (`cache: none`); `edge_lamp` cached at 11. `--planted tile_key_without_size` fails with `frame 3 (…): edge_lamp …` |
| AC6 `#2034.7732697b` | `ac6-unchanged.test.ts` (2) | Metal: every fixture the criterion holds, the trio with `local_map` among them, draws frame 0 with the merge base's pixel hash and linear bytes. Noop lane: the hall under `shadowed.local: fixed` shadows the policy's first 2 spots and reports the other 16 once each, in frame 0 |
| AC7 `#2034.250d73ea` | `ac7-budget.test.ts` (1) | `timed` lists the file; the hall at `above`, 1920 × 1080, 120 frames: all 18 hold tiles, cached frames draw none, `cache: none` frames draw all; then on a reference Mac at rest, five release runs judged by the lane's `judgeLimit`: p95 GPU ms under 10 cached and under 25 redrawn, else INCONCLUSIVE |

The proof line: "the planted arrival-order assignment, hysteresis, texel-sized filter and size-blind cache shown failing
first" are AC1's, AC3's, AC4's and AC5's second tests; "the tile tables at the 8 poses" AC1's first; "the threshold
hashes" AC3's first; "the timings on the reference Mac" AC7's.

## The surface under test

The issue names the field `shadowed.local` and the behaviours; where it leaves the interface open, these are this job's
choices, each the plainest extension of the base's `deep-gpu run` / `view3d`. The implementer provides exactly these.

1. **`light_policy.shadowed.local: "auto" | "fixed"`**, default `auto` (the issue's Scope). The tests leave it out (auto)
   except AC6's hall (`fixed`). Other policy fields they use exist at the base: `soft: {method: "pcss", max_penumbra}`,
   `cache: "none"`, `local_map`.
2. **Light params as at the base**: `shadow: true`, `range` (m, always given), `radius`, spot `inner` and `outer`, `power`,
   `visible` (AC2 patches it to switch a light off).
3. **`shadows: true` on `view3d`** keeps the base's report, `frames[i].shadows = {passes, maps: [...]}`, one row per light
   that has a shadow this frame, and in tile mode each row is
   `{light: <item ID>, kind: "spot" | "point" | "area", key: <hex>, drawn: boolean, size: 128 | 256 | 512 | 1024, slots: [n, …], pixel_hash: <64 hex>}`:
   - `size`: the side of the light's tiles in px;
   - `slots`: its tiles' slots, one number per tile (a spot 1, a point light 6), where a **slot** is a tile's place in
     the atlas's fill order counting from 0 (README: The tile rule); where in the 4,096 px atlas a slot lies is the
     implementer's, since the issue doesn't say;
   - `drawn`: this frame drew the light's tiles; `key`: their cache key, which holds the tile's size;
   - `pixel_hash`: on a captured frame on a GPU (not read on the noop lane), the SHA-256 (lowercase hex) of exactly the
     texels the light's tiles hold as this frame's shading reads them, read back from the atlas, in a fixed order (its
     tiles in slot order, each tile's rows in order, each texel's bytes as stored), so two frames whose tiles hold the
     same texels give one hash.
   The tests read `size`, `slots` and `pixel_hash` only from documents in tile mode; a fixed-mode row may carry them or
   not. The table is the CPU's, so the noop lane answers it.
4. **`lights_over_budget`** as at the base: `{code: "lights_over_budget", lights: [ID], shadows: [ID]}`, raised in the
   frame its lists change; `shadows` names each light whose shadow was dropped. In tile mode no shaded key light is in it.
5. **`timings: true`**: each frame's `gpu_ms`, as at the base.
6. **Planted programs**, each reachable only through `deep-gpu run --planted <name>`, added to `Planted` in
   `crates/deep-gpu-layer/src/main.rs`; everything else as shipped:

| Name | The wrong program | Criterion |
|---|---|---|
| `tile_arrival_order` | Sizes by the rule, but slots filled in the order the scene holds its lights (the document's creation order), not largest first and by ID | AC1 |
| `tile_keeps_fixed_caps` | Under `auto`, a document that names no counts keeps today's fixed rule: 2 spots and no point light shadowed, at `local_map` px, the rest reported dropped | AC2 |
| `tile_hysteresis` | A light keeps the size it had in the frame before until its diameter passes the threshold by more than 5%, so its size depends on how the view got there | AC3 |
| `tile_filter_in_texels` | The shadow filter is as wide in the tile's texels at every size (its world width at 512 px kept as a count of texels), so halving a tile doubles the edge | AC4 |
| `tile_key_without_size` | A tile's cache key is today's map key alone, with neither its size nor its place in the atlas, so a light whose tile changes size isn't drawn again and its slot keeps the old tile's texels | AC5 |

## The tile rule, read exactly (`reference.ts`, in f64)

- **Which lights**: the key lights the policy shades with `shadow: true`: those whose range sphere meets the frustum,
  the top 32 by score bucket, then ID (#1634's `ordered`: power ÷ max(d², radius²) from the eye, eight buckets a stop).
  Every fixture keeps its lights' ranges at least 0.3 m clear of a frustum plane either way, and under 32 lights.
- **The diameter in px of a range sphere on screen**: `D = 2 f r ÷ √(d² − r²)`, the sphere's angular diameter
  `2 asin(r ÷ d)` carried to the screen at the view's centre, so it reads the eye and the light alone, not where in the
  frame the sphere lies. `d` is the distance from the camera's `position` (as the frame draws it, a hold channel's f32
  value where one drives it) to the light's position; `r` the light's `range`; `f = (max(W, H) ÷ 2) ÷ tan(fov ÷ 2)`, the
  focal length in px, with `W × H` the document's `size` (every call draws at it) and `fov` the camera's, in degrees,
  across the wider side (#378's pinhole). The eye is inside the sphere when `d ≤ r`.
- **The size asked**: the smallest of 128, 256, 512 and 1,024 px at least as large as `D`; 1,024 px when none is or the
  eye is inside.
- **Stepping down**: the tiles cover Σ (tiles × size²), a spot 1 tile and a point light 6. While that is more than
  4,096² = 16,777,216 px², every light at the largest size in use halves (strictly more: a table that fills the atlas
  exactly stays).
- **Slots**: the tiles listed largest first, then by light ID (byte order), a light's tiles together; a slot is a
  tile's index in that list from 0. A point light's six slots are six consecutive numbers; which face takes which isn't
  read.

## The fixtures

All are generated in `helpers.ts`; none is on disk. Each sits under a black sky with no sun, in the look of tone map
none and exposure scale 1 (#1634's `PLAIN_LOOK`), a work product.

- **The hall** (AC1, AC2, AC6, AC7; `hallDoc`): a floor (albedo 0.5) 50 × 24 m and a wall 44 × 2 × 0.2 m down its
  middle; spots `spot_01` … `spot_16` 2.4 m up, 0.5 m either side of the wall's line (01–08 at z = −0.5, 09–16 at
  z = 0.5), every 5 m from x = −17.5 to 17.5, aimed down, cones 50° and 60°, 120 lm, ranges 4.5, 7.5, 6.5, 5.5 m by
  turns; `point_1` at (−10, 1.6, −0.6) and `point_2` at (10, 1.6, 0.6), 60 lm, range 6 m; radius 0.05 m, `shadow:
  true`; created in a seeded shuffled order; `light_policy: {soft: {method: pcss}}`; 1920 × 1080, fov 60°, near 0.1 m.
  The wall is taller than the points and nearly as tall as the spots, so each light's far side of the wall is dark.
- **The hall's poses** (eye → target; the target is the origin but where given): 1 `far` (0, 87.2, −98.1): 256 and
  128 px; 2 `overview` (0, 23.4, −27): asks 24.6 M px², steps to 512 px; 3 `inside` (−21, 2, −2): the eye inside
  `spot_01`'s and `spot_09`'s spheres, steps to 512 px; 4 `east end` (24.6, 6.8, 5.1) → (−6, 0, 0): steps to 512 px;
  5 `north` (5.5, 44, 49.5): 512 and 256 px; 6 `oblique` (−46.75, 23.8, −38.25): 512 and 256 px; 7 `east far` (44, 15,
  6): 1,024, 512 and 256 px, asking 16,384,000 px², which fits without a step; 8 `above` (0, 40, −12): 1,024 and 512 px.
  At each, every light is shaded and every diameter sits 2% or more from 128, 256 and 512 px (AC1 checks both).
- **AC2's check pixels** (`checkPixels`): for each light, on a 3 px grid inset 20 px, a pixel whose ray and those of
  every pixel within 3 px meet the floor first (no other item's edge near it); whose floor point and the eight points
  0.3 m around it are blocked from the light's position by the wall (the CPU rays); with no other reaching light's
  shadow edge within 0.3 m; inside the light's inner cone and range; where all 18 lights unshadowed would sum to at most
  0.85; of those, the one where the light alone would add the most 8-bit code values over the rest (lm ÷ 4π cd, cosine,
  inverse square, the range window, ρ E ÷ π, sRGB). The test requires 12 or more for every light, so a light shining
  through the wall can't hide in clipping. At `above` they are 24 to 41.
- **The threshold walk** (AC3, AC4, AC5; `walkDoc`): a floor 16 × 16 m; `edge_lamp` 3 m over the origin aimed down
  (cones 50° and 60°, 400 lm, radius 0.5 m, range 6 m); `board`, 0.1 × 1.5 × 4 m standing at x = 1.15 to 1.25 m,
  whose shadow runs out from it to a soft straight edge along z near x = 2.5 m, cast by its top; `side_lamp_1` over
  (−6, 0) and `side_lamp_2` over (6, 4), 3 m up, aimed down, 200 lm, ranges 4 and 3.5 m; `crate`, a 0.5 m cube at
  (−7, 0.25, 1), inside `side_lamp_1`'s range and outside `edge_lamp`'s, moved to x = −7.5 at frame 11;
  `light_policy: {soft: {method: pcss, max_penumbra: 64}}`; 1280 × 720, fov 50°, 25 fps (so each hold key, half a
  frame before its frame, is a whole number of flicks). The eye sits at the lamp's position plus d × unit(0.3, 1,
  −0.6), aiming at (2.5, 0, 0), held per frame by #425's hold channels (f32). D* = √(r² + (2 f r ÷ 256)²) ≈ 64.61 m
  is where the lamp's sphere spans 256 px; frames 0–11 sit at D* − 0.51, −0.11, −0.01, +0.01, +0.11, +0.51, +0.11,
  +0.01, −0.01, −0.11, −0.51, −0.51 m: A (D* − 1 cm, 512 px) at frames 2 and 8, B (D* + 1 cm, 256 px) at 3 and 7. The side lamps stay at 256 px,
  13% or more from a threshold, all along. The edge lies about 20 px to the metre on screen.
- **The 32 lamps** (AC2; `lamps32Doc`): point lights `lamp_01` … `lamp_32` on an 8 × 4 grid 2.5 m apart, 1.5 m up,
  40 lm, range 3 m, over a floor; 960 × 540, the eye at (0, 12, −14). They ask 512 and 256 px and step to 256 px.
- **The trio** (AC6; `trioDoc`): spots `trio_1` … `trio_3` 3 m over (−3, −1), (0, 0) and (3.5, 1), aimed down, 300,
  340 and 380 lm, range 6 m, each over a post; `light_policy: {local_map: 1024}` and no counts; 640 × 360.
- **AC6's fixtures**: every scene document (`profile: scene` with `items`, up to four levels deep in a file) in the merge
  base's tracked `.json` files outside `docs/evidence/` (run outputs), read from its exported tree; and, built in code,
  #446's `plankDoc(0.1)`, `houseDoc('night')` and `engineDoc('spot', 'cut')`, #432's `shadowDoc`, #1937's
  `sessionDoc`, and the trio. The criterion holds a document that names `spots` or `points` under
  `light_policy.shadowed`, or declares at most 2 spots and no point or area light with `shadow: true`, and the trio
  (it names `local_map`); the test prints the ones it leaves out (at the base, `tests/acceptance/2189/fixtures/
  every-pass.json`, which declares a shadowed point and names no counts) and those the merge base draws no frame of.

## Readings where the issue and design leave a choice

- **"The tile table (light, size, slot)"** is `shadows.maps` with `size` and `slots`, one row per light; a slot is a
  place in the fill order, and the slots compared are the light's set of them.
- **"8 camera poses"** are 8 documents, each with its camera fixed: the rule is pure in the pose, so a pose reached
  any other way must give the same table (AC3 holds that for frames).
- **"The CPU rays call occluded"**: segments from the light's position to the floor point and to eight points 0.3 m
  around it all meet the wall. **"The frame with that light off"**: the same run's frame with the light's `visible`
  patched to false. "4 code values": in each of R, G and B of the final 8-bit frame.
- **"Naming the first by ID"** (AC2's plant): the failures are listed by light ID, and the first must be the first light
  by ID that today's 2-spot rule leaves without a shadow at the pose (`point_1`: points never have one under it).
- **"None is reported as dropped"**: no frame's `lights_over_budget` has an ID in `shadows`. **"Six tiles of 256 px or
  less"**: six slots at a `size` of 256 or under.
- **"1 cm either side of a size threshold"**: the eye moved 1 cm along the line from the light, so its distance from the
  light changes by exactly 1 cm. **"Moving in, moving out, seeking"**: frames of one played walk toward and away from
  the lamp, and a session opened at the near end and sought to B, then A. **"Naming the light"**: the first light whose
  tile size differs between the two frames whose hashes differ.
- **"One shadow edge on the floor, chosen 8 coarse texels wide or more"**: the board's edge, its profile the ratio of
  the frame with the board to the same frame without it, averaged over 21 lines; a coarse texel is the 256 px tile's at
  the edge, 2 tan(outer) × distance ÷ 256 (a spot's map spans its outer cone at the base). "Changes by under 10%":
  |w(B) − w(A)| ÷ w(A) < 0.1.
- **"Each cached tile equals a clean render by pixel hash"**: each light's tile `pixel_hash` equals the one the same
  frame gives under `cache: none`, where every tile is drawn in the frame that reads it; the frame's own pixel hash too.
  At frame 11 `edge_lamp`'s tile must be cached (`drawn: false`), the design's "cached as a local map is today", so a
  cached tile is what is compared after the crate moves.
- **"Every fixture already in the repo"** is read as the scene documents on disk at the merge base plus the local-shadow
  fixtures other suites build in code that name counts; other suites' code-built documents with no local shadow aren't
  enumerated. **"Byte-identical"**: the final pixel hash and the linear target's SHA-256 at frame 0, at the document's
  own size, under one look for both binaries (the linear target is before the look, so a saturated look can't hide a
  change).
- **"As today"** (AC6's hall): today's rule, the first 2 spots by the policy's order, read at the `inside` pose. Today's
  rule fades a kept spot's shadow out as its score nears the first spot left out, and at `above` the spot left out
  shares a score bucket with the kept ones and scores as high, so the base keeps neither there; at `inside` the 2nd scores over 10% above the 3rd (the test
  checks it), so both are kept in full. **"Once each"**: each of the other 16 in `lights_over_budget`'s `shadows`
  exactly once over three frames, in frame 0.
- **"Once its tiles are cached"**: frames 1–119 of a still view; **"a frame that redraws every tile"**: a frame of the
  same view under `cache: none`. The reading is the p95 of `gpu_ms` a run; five release runs are judged by the perf
  lane's `judgeLimit` (#1634's helpers). **"In the local preflight"**: this file is in `scripts/lanes.mjs`'s `timed`.

Not tested, because no criterion asks: area lights' tiles (no fixture has one), a pose's table under fill lights,
shadows for fill lights, a second atlas, a size named per light, dropping a shadow when the atlas is full, the passes
count, and where in the atlas a slot lies.
