# Acceptance tests for #1381: far ground light — one horizon bake gives ridge shadows past the last cascade and sky occlusion in valleys, with a sun that moves for free

These tests were written before any implementation existed. The writer had issue #1381 (its Scope, its Fields for
plate and chunks@1, its seven acceptance criteria, its Proof line "The closed-form shadow and crater values, pass
counts, seek-and-play hashes and the planted plates failing", Not in scope and Depends on), its parent #442 (for what
the sibling parts own), the text of #2014, #199 and #446, the design documents and base commit `3557b3489` (main, one
merge past `1ab891283`). No implementation existed, and no other worktree, branch or pull request was read.

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job
(design: Dogfooding). The suite is lean: one file per criterion, at most two tests a file, and the two planted wrong
programs the criteria name.

## What was read

- Issue #1381; #442's body (the parts: the plate #2014, its levels #2017, forests #1382, cover #1383, pictures #1384,
  trees #1636); #2014, #199 and #446 as issue text only.
- `docs/canvas-primitives.md`: Builder plate: terrain (its `horizon: {azimuths: 16, size: 257}` field, "a stored
  payload, baked with the plate or its height tiles", and its Semantics: the bake traces in f64 through a min-max
  pyramid "the highest ground each texel sees along each azimuth; the sun's visibility from it multiplies the key light
  beyond the last cascade, fading in over that cascade's far tenth, and one minus the mean squared sine of its angles is
  the cover's sky occlusion"); Builder plate: terrain overlays (where a plate's other params sit); Level of detail and
  Level of detail: chunks streamed by view ("a moving sun recomputes nothing"); Light and the light policy; Light policy:
  cascades (`cascades`, `split`, `shadow_far: m = auto`, `fade`; splits in closed form, "so a seek gives the same
  shadows as playing"); Light policy: soft shadows (`angle: deg = 0.53`, the sun's apparent diameter).
- `docs/technical-design.md`: Scenes, physics and the canvas core; Chunks streamed by view; "Every task carries its own
  budgets" (five runs after warm-up, the margin, the reference Mac); Dogfooding ("Who drafts it").
- `docs/parallel-proof.md`: §3 (budgets count only on a reference Mac), §7a (slow and timed files: a criterion only a
  timed test judges is never the budget window's to prove), §12a (budget windows).
- At the base, for surfaces and conventions only: `AGENTS.md`; `crates/deep-gpu-layer` (`view3d.rs`'s request fields
  `ground_points`, `counts`, `capture`, `targets`, `timings`, `from`, `fps`, and each frame's `pixel_hash`, `gpu_ms`
  and counters; `lod.rs`'s `ground_points` rows `{at, tile, level, y}`; `main.rs`'s `Planted` and `--planted`;
  `golden.rs`'s blank guard, #1399); `crates/deep-canvas-scene3d` (`terrain.rs`: the plate's `terrain` keys, an unknown
  one refused; `spec.rs`: `overlays` beside `terrain` on a plate; `scene.rs`: the sun's `cascades`, `split`,
  `shadow_far` (refused unless > 0), `fade`, and a sun shining along its local −Z); `crates/deep-scene3d-render`
  (`module.rs`'s `Counts`; `sway.rs`: one compute pass a frame while something sways); `crates/deep-canvas/src/expr.rs`
  (the function list); `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`); `scripts/lanes.mjs` (`alone`, `timed`);
  `scripts/proof-change.mjs` (`criterionId`); `scripts/throttle.mjs`; and the suites `2014/` (the plate), `2017/`
  (levels, `view3d` driving, `ground_points`, `counts`, budgets, `ac4-taste.test.ts` and `TASTE.json`),
  `2017-redraft-ac2/`, `446/` (cascades, shadows), `425/` (seek against play, taste), `1637/` (timing), `1732/` and
  `418/` (channels in a `view3d` document).

Code was read only to learn the surface. Every expected value comes from the issue and the design.

## Run them

Every file builds `deep-gpu` with cargo and draws on this Mac's Metal GPU, so they run one file at a time. The
implementer adds these lines to `scripts/lanes.mjs`; this README is the instruction, and this job edits nothing outside
its folder.

```js
// #1381's files each build deep-gpu and draw 4,097 × 4,097-sample plates on the Metal GPU; ac6-budget judges the
// horizon's 0.1 ms at 1080p on the reference Mac.
alone.push('tests/acceptance/1381/');
timed.push('tests/acceptance/1381/ac6-budget.test.ts');
```

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1381 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1381/tsconfig.json
rm -rf tests/acceptance/1381/node_modules/.vite
```

- **Build.** Each file first runs `cargo build --locked --bin deep-gpu`, with the pinned toolchain's folder and
  `/opt/homebrew/opt/rustup/bin` put first on `PATH` and `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0` unless already
  set, copies the binary out of the target folder (honoring `CARGO_TARGET_DIR`), and fails each test whose build failed.
- **Platform.** Anything the GPU draws is drawn on Metal: off macOS a test fails with a message starting
  `INCONCLUSIVE:`, never passing. The 0.1 ms budget is INCONCLUSIVE anywhere the perf lane's `judgeLimit` doesn't pass
  a reference Mac at rest (`scripts/benchmark.mjs`: the fingerprint, mains power, Low Power Mode off, thermal state
  nominal, the load within the cores), checked before anything is timed.
- **Isolation.** Each test writes into its own temporary folders and deletes them. `ac7-taste.test.ts` writes into
  `docs/evidence/1381/` and keeps what it writes. The suite uses Node built-ins and vitest, and imports
  `scripts/benchmark.mjs` and `scripts/lanes.mjs` as the lane's own.

## Fixtures

All generated in `helpers.ts`; no file on disk. Metres, +Y up, right +X. Session documents for `view3d`, each item in
one writer layer `main`, camera `cam`, `budget.class: work_product`. Each terrain plate is a `plate@1` with
`params.terrain` and no `at`, so its own space is the world's (#2014), and holds 4,097 × 4,097 samples, the tile the
issue's "257² for a 4,097² tile" names, so a 257-texel table is at 1/16 of its samples whichever way that is read. Tile
[i, j] covers x from −size[0] ÷ 2 + i × tile, and z likewise with j (#2017's naming). The key sun is a `light.sun@1`
with `shadow: true`, `at.rot` [−e, −90, 0]: e degrees above the horizon on the −x side, shining toward +x.

- **The ridge plate** (`RIDGE`, `ridgeDoc`; criteria 1, 2, 4, 5, 6 and the sunset pictures). 8,192 × 8,192 m at 2 m,
  16 × 16 tiles of 512 m, `lod_levels` 6, `horizon: {azimuths: 16, size: 257}` (one texel 32 m). The field
  `100 * max(0, 1 - abs(position.x + 1024) / 400) + 140 * max(0, 1 - abs(position.x - 2600) / 400)`: a straight ridge
  along z, its crest 100 m high at x = −1,024 (a sample), falling linearly 400 m either side to a flat floor at 0; a
  second ridge, 140 m at x = 2,600, closes the valley 2.2 km east of the first one's foot; it lies east of every point
  the tests read, never between one and the sun. One grey-brown matte material, a sunset sky.
  - **The far view** (criteria 1 and 2): the sun still at 5°, its cascades at zero range (`shadow_far: 0`), a camera at
    (256, 300, 2,000) looking at (256, 0, −256), fov 60.
  - **The sunset** (criteria 4, 5, 6 and the pictures): a camera at (800, 250, 2,500), the valley's south end, looking
    at (300, 0, −500), fov 60, still; the cascades end 300 m out (`shadow_far: 300`); a channel on
    `items/sun/at/rot/0` sinks the sun linearly from 15° at 0 s to 3° at 3 s, then holds; nothing else moves. At 10
    frames a second frame n is at n ÷ 10 s, the sun at 15 − 0.4 n degrees (5° at frame 25). Criterion 4's control adds
    a 14 m lathe tree swaying by #2016's `mod.sway@1` beside the eye. Criterion 6's baseline leaves the plate's
    `horizon` out.
- **The crater plate** (`CRATER`, `craterDoc`; criterion 3 and the occlusion pictures). 2,048 × 2,048 m at 0.5 m, 8 × 8
  tiles of 256 m, `lod_levels` 6, `horizon: {azimuths: 16, size: 257}`. The field
  `min(H, max(0, (hypot(position.x, position.z) - 300) * H / 300))` with H = 600 × tan 30° = 346.41 m: a flat floor out
  to 300 m from the centre, a wall rising linearly to the rim at 600 m, a plateau at the rim's height beyond. A day sky
  with a bright ambient, a sun at 38°; criterion 3 sets its cascades to zero range. A camera at (0, 560, 980) looking at
  (0, 0, −60), fov 60.

## The surface under test

Each test enters through the base's own calls: `deep-gpu run [--planted <name>]` (#377) with `view3d` (#378; its
`size`, `fps`, `from`, `frames`, `capture`, `targets: ['final']`, `timings` with each frame's `gpu_ms`, each frame's
`pixel_hash`, `counts: true` with `meshes_built`, and #2017's `ground_points: {item, at}`), and the document's
`channels` (one on `items/sun/at/rot/0`, as suites 449 and 1732 key a turn). What the base lacks is below, each named
by this job.

## Assumed surfaces

The issue and the design name the behaviours and the `horizon` field but not these calls and readings; each is this
job's choice, the most natural one beside the base's own calls. The implementer provides exactly these, or disputes
them.

1. **A plate's `horizon`.** A terrain plate takes `params.horizon: {azimuths: 16, size: 257}` beside `params.terrain`,
   as #537's `overlays` sits (the base refuses an unknown key inside `terrain`). With it, the plate's build bakes its
   horizon table, a stored payload keyed with the plate; without it, the plate bakes none and draws as at the base:
   unshadowed past the last cascade and unoccluded. The tests write only `{azimuths: 16, size: 257}`, on plates of
   4,097 × 4,097 samples. The taste test's "occlusion off" picture and the budget's baseline are the same documents with
   `horizon` left out.
2. **Cascades at zero range: `shadow_far: 0`** on the key sun. The base refuses 0 (`out_of_range`, it must be > 0); here
   it is accepted and means the cascades cover no ground: every ground point lies past the last cascade, where the
   horizon alone shades the key light (no fade band). A negative `shadow_far` stays refused.
3. **`ground_points` rows gain `sun_visibility` and `occlusion`**, beside #2017's `at`, `tile`, `level` and `y`, on
   every row of a terrain plate:
   - `sun_visibility`: 0..1, the factor this frame's shading multiplies the key sun's direct light by at the ground
     point: 1 lit, 0 in full shadow. Past the last cascade it is the horizon's visibility for the key sun, the issue's
     "smoothstep of sun elevation less interpolated horizon, across the sun's ±0.27°"; over the last cascade's far 10%
     its blend with the cascade's shadow; inside the cascades the cascade's shadow. The tests ask only points past the
     last cascade.
   - `occlusion`: 0..1, the sky occlusion the plate's shading reads at the point, 1 − the mean over the azimuths of
     sin² of the horizon angle; 1 where nothing occludes.
   - Each is read back from the GPU, or computed on the CPU by the same function the plate's shading runs on the same
     table texels, the same sun and the same interpolation; never by a trace of its own. A plate without `horizon`, and
     the planted plate with no bake, read `sun_visibility` 1 past the last cascade and `occlusion` 1.
4. **`counts: true` gains `compute_passes` and `horizons_baked`** on each frame, beside the base's `meshes_built`:
   - `compute_passes`: the compute passes this frame's drawing began, in every render module and in the scene's own
     operators (culls, depth pyramids, sway, effects, material operators, and anything this issue adds); 0 when none.
     A pass the harness runs to read the frame back, hash it or check it (#1897's GPU pixel hash, #157's frame
     checks) isn't the frame's drawing and isn't counted.
   - `horizons_baked`: the horizon tables this frame baked, a plate's or a height tile's. A session's first frame counts
     the tables its document's build baked; a frame that bakes none reports 0.
5. **Planted programs**, each reachable only through `deep-gpu run --planted <name>` (`Planted` in
   `crates/deep-gpu-layer/src/main.rs`); an unknown name is `bad_input` at the base.

   | Name | The wrong program | Criterion |
   |---|---|---|
   | `terrain_no_horizon_bake` | A plate whose `horizon` is accepted but never baked, and whose shading reads no table: past the last cascade the key light falls unshadowed (`sun_visibility` 1) and `occlusion` is 1. Everything else is shipped. | AC2 `#1381.60933b30` (issue-named: "a planted plate with no bake") |
   | `terrain_occlusion_from_slope` | Sky occlusion from the ground's slope alone, (1 + cos slope) ÷ 2 of the full-resolution normal, which reads 1 on flat ground; the horizon's sun visibility is shipped. | AC3 `#1381.44fb6045` (issue-named: "a slope-only occlusion") |

6. **The taste call** is recorded in `tests/acceptance/1381/TASTE.json`, the one file anyone adds to this folder after
   this commit, and only to record the owner's answer: `{"issue": 1381, "criterion": "#1381.63539ab9", "verdict":
   "looks_right" | "looks_wrong", "who", "when": ISO 8601, "screenshots": {name → sha256 for the three pictures and the
   recording}, "note"?}`.
7. **`scripts/lanes.mjs`** gains the two lines under Run them.

No `twins.json`: every test fails on the base at an assertion of its own (`BASE-FAILURE.txt`), and the two planted
programs are run by the tests themselves.

## Criteria to tests

IDs are `#1381.` and the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the
leading `- [ ] ` dropped (`scripts/proof-change.mjs`). Each test's name starts with `AC<n> #1381.<id>`. Each file's
header states its fixture, numbers and wrong programs in full.

| ID | Criterion (short) | File (tests): what it asserts |
|---|---|---|
| AC1 `#1381.aa8d0d8a` | A 100 m ridge under a 5° sun: shadow reaching 1,143 m from the crest, within one horizon texel | `ac1-ridge-reach.test.ts` (1): 401 ground points every 4 m from 400 m to 2,000 m east of the crest, cascades at zero range: every point up to 1,143.005 − 32 m reads `sun_visibility` under ½ and every point from 1,143.005 + 32 m at least ½; up to 1,000 m at most 0.05, from 1,300 m at least 0.95; the first lit point within 32 m of 1,143.005 m. Catches: the base; no horizon past the cascades; a trace short of the crest or overstating it; a horizon fetched away from the sun |
| AC2 `#1381.60933b30` | A tile 2 km out keeps its shadow with zero-range cascades; a planted plate with no bake lights it and fails | `ac2-far-tile.test.ts` (2): tile [7, 7], 2,038 m from the eye and inside the shadow, 25 points each at most 0.05; tile [9, 7] beside it, past the shadow, each at least 0.95. `--planted terrain_no_horizon_bake`: every point of [7, 7] over ½, the judge fails, each failure naming `tile [7, 7]`. Catches: the base; far ground only cascades shade; the plant |
| AC3 `#1381.44fb6045` | A crater floor's centre under a 30° rim reads occlusion 0.75 ± 0.02; a slope-only occlusion reads 1 and fails | `ac3-crater-occlusion.test.ts` (2): the centre (0, 0) reads 0.75 ± 0.02. `--planted terrain_occlusion_from_slope`: reads 1 within 0.02, the judge fails naming the point. Catches: the base; the plant; a trace short of the rim; 1 − mean(sin h) |
| AC4 `#1381.4970e130` | Moving the sun runs no GPU compute and no rebuild, by pass count | `ac4-sun-moves-free.test.ts` (2): the sunset, 31 frames: frame 0 bakes a horizon; frames 1 to 30 report `compute_passes`, `meshes_built` and `horizons_baked` 0; the point 800 m east of the crest lit at 15° and shadowed at 3°; frames 0 and 30 differ by pixel hash. The control: with one swaying tree, frames 1 to 3 each count a compute pass. Catches: the base; a re-bake or rebuild as the sun moves; a GPU trace each frame; a dead counter |
| AC5 `#1381.1451e92c` | Seek equals play by pixel hash at sunset | `ac5-seek-equals-play.test.ts` (1): frames 10, 25 and 30 of the sunset sought in a fresh process equal the played ones by pixel hash and by their readings at the far point; the three differ; each passes #1399's blank guard; the far point lit at 11°, shadowed at 5° and 3°. Catches: the base; a bake refined over frames; anything read from an earlier frame |
| AC6 `#1381.82d06a5e` | Under 0.1 ms at 1080p on the reference Mac, measured | `ac6-budget.test.ts` (1): `lanes.mjs` times this file; frame 75 of the sunset at 1920 × 1080 draws other pixels with the horizon than without; then, on a reference Mac at rest only, one warm-up and five runs of 300 frames a side, the difference of median `gpu_ms` judged against 0.1 ms by `judgeLimit`. Catches: the base; a horizon costing 0.1 ms or more |
| AC7 `#1381.63539ab9` | Pictures and a recording shown; one taste call recorded, else INCONCLUSIVE | `ac7-taste.test.ts` (1): writes the pictures and the recording (The taste call), each still past #1399's blank guard, the occlusion pair different, the recording's ends different; prints their SHA-256s; reads `TASTE.json`: absent or recorded on other SHA-256s is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on these passes. Attaching them to the PR and showing them in the session is the implementer's, outside any test |

## Readings where the issue leaves a choice

### Criterion 1

- **"Within one horizon texel"** is one texel of the fixture's table: 8,192 m over the 257-texel table's 256 steps,
  corner to corner, 32 m (a cell-centred reading gives 31.9 m; the test uses 32).
- **"Casts a shadow reaching 1,143 m"** is where the sun's visibility crosses one half: the issue's visibility is a
  smoothstep of the sun's elevation less the horizon across the sun's ±0.27°, one half where the crest stands exactly
  5° high, at 100 ÷ tan 5° = 1,143.005 m. So that a grey ground can't pass, it is a full shadow and full light away from
  the edge: at 1,000 m the crest stands 5.71°, more than 0.27° plus a texel's change (0.18°) above the sun, and at 1,300
  m 4.40°, that far below; the test allows 0.05 for the table's quantized angles.
- **Why the cascades are at zero range here.** The criterion's tolerance is the horizon's texel, so the horizon alone
  must draw this shadow; zero range (criterion 2's own setting) leaves nothing else to.
- **Why a 32 m texel.** The plate holds 4,097 samples a side, as the issue's tile does, so that "257²" is 1/16 of its
  samples on every reading. At 2 m spacing its texel is 32 m, which also leaves the test indifferent to where the 16
  azimuths start: the sun shines along +x, and a table whose azimuths straddle it 11.25° either side sees a straight
  ridge 1 − cos 11.25° (1.9%) lower, which moves the edge 22 m. At 1 m spacing (16 m texels) the test would hold the
  implementer to an azimuth origin the issue doesn't state.
- **"A straight ridge"** is infinite along z on the plate (its ends are 3.8 km from the line read), with a sharp crest at
  a sample and a 14° lee slope, steeper than the sun, so the crest is the highest ground every floor point sees toward
  the sun.

### Criterion 2

- **"Cascades set to zero range"** is `shadow_far: 0` (Assumed surfaces 2), the design's own field for the last
  cascade's far end.
- **"A tile 2 km out"**: a tile of the plate (512 m) whose nearest point is 2,038 m from the eye, in the ridge's shadow
  from 512 m to 1,024 m east of the crest. "Keeps its shadow" is every point of a 5 × 5 grid in it reading at most 0.05;
  the lit tile beside it, 1,536 m to 2,048 m east, at least 0.95, so a reading dark everywhere can't pass.
- **"A planted plate with no bake lights it"**: every point of the tile reads over one half under the plant, and the
  shipped judge fails, each failure naming `tile [7, 7]`.

### Criterion 3

- **"A flat-bottomed crater whose rim stands 30° high"**: the rim at 600 m, 346.41 m high, from the floor's centre.
  The wall's height over distance rises to the rim and the plateau's falls past it, so 30° is the horizon on every
  azimuth, and 1 − sin² 30° = 0.75 whatever the azimuths' count or start. The reading is at the centre (0, 0), a texel
  on any 2ⁿ + 1 table.
- **"A slope-only occlusion reads 1 and fails"**: the plant's reading is within 0.02 of 1 and outside 0.75 ± 0.02.

### Criterion 4

- **"No GPU compute"** is no compute pass in any frame where only the sun moved: every frame after the first, the
  camera still and nothing else bound to time. The cascades' depth passes redraw as the sun turns (Light policy:
  cascades: a cascade's map is keyed by the sun's direction); they are render passes, and the criterion doesn't ask
  them away.
- **"No rebuild"**: no mesh built and no horizon baked after the first frame. **"By pass count"** is read from the
  frame's counters (Assumed surfaces 4), not timings.
- So the counters can't pass by never counting: the first frame counts the bake, and a swaying tree's compute pass is
  counted every frame. So the sun is seen to move: the far point turns from lit to shadow and the frames' hashes differ.

### Criterion 5

- **"Seek"** is a fresh process asked for that frame alone (`from` the frame, one frame), as #425's suite seeks;
  "play" is one process drawing frames 0 to 30 in order. Frames 10, 25 and 30 put the sun at 11°, 5° (the issue's
  sunset) and 3°; at 5° and 3° the far point lies in the ridge's shadow past the last cascade, so the horizon shades
  what is compared. #1399's blank guard holds the played frames, so two blank frames can't match.

### Criterion 6

- **What is timed** is what the far ground light adds to a frame: the same sunset at 1920 × 1080 with and without the
  plate's `horizon`, 300 frames at 30 frames a second a side, the sides' order alternating, one warm-up and five runs,
  the difference of median `gpu_ms` (#2017's sway pattern), judged by the lane's `judgeLimit` against 0.1 ms. It draws
  on the debug `deep-gpu`: GPU time is the GPU's work, which the CPU build's profile doesn't change.
- The criterion says "measured", not "in the local preflight" or "compared with the merge base", so no
  `benchmarks/budgets.json` task is asked; a criterion only a timed test judges isn't the budget window's to prove
  (`docs/parallel-proof.md` §7a).

## The taste call

`ac7-taste.test.ts` writes to `docs/evidence/1381/`, each still re-encoded without filtering at zlib level 9, so the same
pixels give the same SHA-256, and prints the SHA-256s:

| File | What it shows |
|---|---|
| `ridge-shadow-sunset.png` | The sunset at 2.5 s, the sun at 5°: the ridge's shadow lying 1.1 km across the valley floor past the last cascade, 960 × 540, filmic |
| `valley-occlusion-on.png` | The crater, a valley in the round, under a 38° sun and a bright sky, with the plate's horizon: its sky occlusion on, 960 × 540 |
| `valley-occlusion-off.png` | The same with `horizon` left out: no occlusion |
| `sun-moving.apng` | The sunset from 0 to 3 s, the sun sinking from 15° to 3°, 8 frames a second, 25 frames at 480 × 270 |

The implementer attaches them to the PR, shows them in the session, and records the owner's answer in `TASTE.json`
(Assumed surfaces 6). The pictures are evidence for the one taste call only; no other test reads them.

## Not tested

No criterion asks for these, or they can't be reached at this base, so none is tested:

- **The chunks half.** `chunks@1` has no code at this base: no `chunks.build`, no height tiles, no `chunk_missing`.
  Every criterion is proven on a terrain plate; a height tile's horizon, traced over its neighbours, and `chunks.build`'s
  bake are left to #199's suites once it lands. No chunks surface is invented here.
- The table's size in bytes (16 B a texel, 1.06 MB at 257²) and its encoding; the min-max pyramid and f64 tracing
  themselves (only their result, through criterion 1's reach and criterion 3's value); the fade over the last cascade's
  far 10% (the sunset's frames draw it and criterion 5 compares them, but no value is judged); inside-cascade readings;
  other azimuth counts or table sizes; bounced light (Not in scope).

## What the implementer adds outside this folder

- The two `scripts/lanes.mjs` lines under Run them.
- In `deep-canvas-scene3d`: the plate's `horizon` and its bake; `shadow_far: 0`.
- In `deep-gpu`: `ground_points`' `sun_visibility` and `occlusion`, `counts`' `compute_passes` and `horizons_baked`, and
  the two planted names.
- After the owner's taste call: `TASTE.json`, and the pictures attached to the PR.
