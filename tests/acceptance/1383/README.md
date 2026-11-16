# Acceptance tests for #1383: ground cover that reads the land and the weather: triplanar on cliffs, aspect and curvature rules, and wetness and snow lines that are closed forms of t

These tests were written before any implementation existed. The writer had issue #1383 (its Scope, its Fields for the
amended plate, its eight acceptance criteria, its Proof line "Checker measurements, weight sums, closed-form material
values, seek-and-play hashes and the planted planar UV failing" and its Not in scope; it has no Oracle line, so there is
no oracle lane), its parent #442, the design documents and the base. No implementation existed, and no other worktree,
branch or pull request was read.

The job was asked to write against `1ab891283`; its worktree stood at `3557b3489` ("Merge pull request #2626", flowing
water #968), whose only change since `1ab891283` is that merge: water's flow fields, its renderer passes and its suite.
It touches no terrain, cover, material or `view3d` field these tests read, so the tests were written and run there.

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job
(design: Dogfooding). The suite is lean: one file per criterion, at most two tests a file, the one planted wrong program
the issue names (criterion 1's planar UV) and one more that criterion 2 needs to mean anything (weights from the shaded
normal).

## What was read

- Issue #1383; issue #442's body, for what the siblings own: the far ground light and the horizon bake (#1381), ground
  images (#1384), the terrain plate (#2014), levels of detail (#2017).
- `docs/canvas-primitives.md`: Builder plate: terrain (the `cover` entry, `projection`, `where` over aspect and
  curvature, `modify`, "with `auto`, a cover turns triplanar above 35° of slope, weighted from the geometric normal",
  "thresholds and amounts may read channels, so a snow line or a rain's wetting is a closed form of t and nothing
  accumulates over frames"); Builder plate: terrain overlays (`overlays` beside `terrain`); Builder; Builder: uv (uv0 in
  metres); Attribute and field and its geometry measures (convexity from mean curvature, which this issue's Laplacian is
  not); Material and Material: texture maps (`maps.base_color` by hash); Channel and key (a channel's `target` keys any
  number at its item's path); Units and axes (+Y up, the front facing +Z).
- `docs/technical-design.md`: Scenes, physics and the canvas core ("Pure evaluation": seeking equals playing, compared
  on raw pixels); Builder; Attribute and field; Channel and key; Look; Dogfooding.
- At the base, for surfaces and conventions only: `AGENTS.md`; `crates/deep-gpu-layer` (`view3d.rs`'s request fields
  `size`, `fps`, `from`, `frames`, `seeks`, `capture`, `targets`, `assets`, #2017's `ground_points`, and each frame's
  `pixel_hash` and `final`; `view3d/history.rs`'s frame order under `seeks`; `main.rs`'s `Planted` and `--planted`, an
  unknown name `bad_input`); `crates/deep-canvas-scene3d` (`terrain.rs`: the plate's keys, its field over `position`,
  smooth vertex normals, uv0 by `uv.rs`'s box fallback; `spec.rs`'s `plate@1` and `material@1` params; `scene.rs` and
  `light.rs`'s `maps`); `crates/deep-scene3d-render/src/env.rs` (a sky's azimuth runs from −Z toward +X);
  `crates/deep-canvas/src/expr.rs` (the function list: `clamp`, `abs`, `min`, `max`, `exp`, `sin`, `cos`);
  `crates/deep-show` (not driven: every reading here is a frame's); `scripts/proof-change.mjs` (`readIssue`,
  `criterionId`); `scripts/lanes.mjs` (`alone`); the suites `537/` (plate fixtures, pixel reads from `view3d`, planted
  twins, README form), `2014/` (the plate's form), `2017/` (README form, its taste test and `TASTE.json`, its
  runner and PNG coding), `440/` (uv0 in metres), `1399/` (the golden blank guard) and `1729/` (a material's map named
  by hash in a session document's `assets`).

Code was read only to learn the surface. Every expected value comes from the issue and the design.

## Run them

Every file builds `deep-gpu` and draws on this Mac's Metal GPU, so the folder runs alone. The implementer adds this line
to `scripts/lanes.mjs`; this README is the instruction, and this job edits nothing outside its folder.

```js
// #1383's files each build deep-gpu and draw terrain cover on the Metal GPU; ac8-taste writes docs/evidence/1383/.
alone.push('tests/acceptance/1383/');
```

```sh
npm ci && npm run build --workspaces     # once, in a fresh worktree
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  scripts/lease npx vitest run --root tests/acceptance/1383 --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/1383/tsconfig.json
```

- **Build.** Each file first runs `cargo build --locked --bin deep-gpu` (its own `beforeAll`, with
  `/opt/homebrew/opt/rustup/bin` first on `PATH` and `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0` unless set), copies
  the binary out of the target folder (honoring `CARGO_TARGET_DIR`) and fails each test whose build failed, naming
  cargo's error.
- **Platform.** What the GPU draws is drawn on Metal: off macOS, or where `view3d` answers `unsupported_platform` or
  `gpu_unavailable`, a test fails with a message starting `INCONCLUSIVE:`, never passing. Nothing here is timed.
- **Isolation.** Each test writes into its own temporary folder and deletes it. `ac8-taste.test.ts` writes into
  `docs/evidence/1383/` and keeps what it writes. Node built-ins and vitest only; no process is started but `cargo` and
  `deep-gpu`, each waited for, none stopped by name or port.

## Fixtures

All generated in `helpers.ts`; no file on disk. Metres, +Y up, right +X, the front facing +Z. Session documents for
`view3d` (#378's form: an `id`, one writer layer `main`, `seed: 1383`, `transport: {span: "12s"}`, `budget.class:
work_product`), drawn at 4 frames a second unless a call says otherwise (the recording, 6), so frame n is at n ÷ 4 s.
Terrain plates are #2014's
`plate@1` with `params.terrain: {height, size, spacing}` (no `tile` or `lod_levels`, so full detail) and this issue's
`params.cover` beside it (Assumed surfaces 1); a plate's own `material` lies under its cover. Lights: a sun casting no
shadow and a day sky. Measured frames draw in a plain look (tone map none at exposure scale 1, no finish, deband, bloom
or ao); the taste pictures in a filmic one.

- **The checker.** A 64 × 64 PNG of 2 × 2 cells, sRGB 40 and 215 grey, the base colour map (`maps.base_color`, by
  SHA-256, listed in the document's `assets` and handed to `view3d` in its `assets`) of the material `checker` (white,
  roughness 0.8). One image spans one UV unit, a metre, so a cell is 0.5 m.
- **The cliff** (`cliffDoc`; criterion 1). `ground`, 64 × 32 m at 0.25 m, `clamp((x + 5) × tan 70°, 0, 30)`: flat at 0 for
  x ≤ −5, a 70° face rising toward +x to a plateau 30 m up at x ≈ 5.92, across the whole of z; every cell of the face
  lies in its plane. Turf under one cover entry, the checker everywhere (`where: {}`, `blend: 0`, `projection` left at
  its default). A sun of illuminance 3 at 45° in the west, `at.rot [−45, −90, 0]`, so the west-facing face (N·L 0.91) and
  the ground (0.71) both take it. Two orthographic frames at 960 × 640, `view_width` 23.3 m (41.2 px a metre, chosen
  off a whole number of pixels a cell): straight down on the flat ground from 50 m above (−18.5, 0, 0), seeing x from
  −30.2 to −6.9; and square onto the face from 60 m along its normal, centred on its middle (0.46, 15, 0), seeing
  7.8 m up and down the slope and 11.7 m along z, all on the face.
- **The four planes** (`veeDoc`; criterion 2). `ground`, 32 × 32 m at 2 m, `1.2 max(x, 0) − 0.4 min(x, 0) + 0.5 max(z, 0)
  − 0.9 min(z, 0)`: four planes, rising at 1.2 toward +x, 0.4 toward −x, 0.5 toward +z and 0.9 toward −z, with creases on
  the sample lines x = 0 and z = 0. Each cell lies in one plane, so the geometric normal anywhere in it is its
  quadrant's, (−g_x, 1, −g_z) normalized, with four different sets of |n| components. The vertices on a crease take two
  planes' normals (the plate's smooth normals), so in the cells beside one the shaded normal leans off the geometric
  one. Turf under the checker with `projection: triplanar`. 28 points: in each quadrant (s_x, s_z), (5, 7), (9, 11),
  (13, 3) and (11, 13) inside it, and (1, 7), (7, 1) and (1, 1) in its cells beside a crease, each scaled by the signs.
- **The pyramid** (`pyramidDoc`; criterion 3). `ground`, 64 × 64 m at 1 m, `32 − max(|x|, |z|)`: four 45° faces facing
  north (−Z), east (+X), south (+Z) and west (−X), meeting at an apex 32 m up. Rock under one cover entry of snow with
  `where: {aspect: {direction: 0, min: 0.5}}` and `blend: 0`. Twelve points on the north face, at least 3.5 m from a
  ridge and from the plate's edge, and their mirrors in z on the south face.
- **The ridge and the gully** (`ridgesDoc`; criterion 4). `ground`, 96 × 64 m at 2 m, `20 exp(−(x − 20)² ÷ 128) −
  20 exp(−(x + 20)² ÷ 128)`: a ridge 20 m high along z at x = 20 and a gully 20 m deep at x = −20, each a Gaussian of
  σ = 8 m. Rock under moss where `curvature: {min: 0}`. The fixture centers: (±20, −16), (±20, 0) and (±20, 16), on the
  centre lines.
- **The wet ground** (`wetDoc`; criterion 5). `ground`, flat (height 0), 16 × 16 m at 1 m. Turf under one cover entry of
  `soil` everywhere: base colour (0.5, 0.4, 0.3) in linear light, roughness 0.8, metallic 0; with `modify: [{kind: wet,
  amount: 1}]`, and without `modify` as the control. Four points.
- **The fixture document** (`fixtureDoc`; criteria 6, 7 and 8). Three terrain plates under one sun of illuminance 3 at
  35° in the north-west (`at.rot [−35, −135, 0]`), a day sky, and a camera for each shot, the document's `camera`
  naming the shot's. Each plate has 129 × 129 samples, so a frame whose cover changes stays cheap to draw even where
  it rebuilds the plate:
  - `cliff`, at the origin: the cliff above at 0.5 m, 64 m along z, on ground corrugated along z, `+ 1.2 sin(0.35 z)` (slopes to
    23°, under `auto`'s 35°), under the checker. Its shot looks at the face from (−48, 14, 42).
  - `peaks`, at (0, 0, −1,500): 1,024 m square at 8 m, two massifs (Gaussians 430 m and 310 m high, σ 170 m and 130 m)
    with folds of ±30 m. Rock under two snow entries, each blended over 6 m: entry 0 above a line keyed from 420 m at
    0 s to 120 m at 10 s, and entry 1 above a line 120 m lower (300 m to 0 m) where the ground faces north,
    `aspect: {direction: 0, min: 0.4}`. Each line falls 300 m over 10 s, keyed by a channel on its `where.height.min`
    (Assumed surfaces 1). Its shot looks west across the massifs from (1,400, 520, −1,450), so north faces and south
    faces are both in view.
  - `field`, at (150, 0, 40): 128 m square at 1 m, swells of ±1.5 m. Turf under soil everywhere with `modify: [{kind:
    wet, amount}]`, the amount keyed by a channel from 0 at 2 s to 1 at 6 s: the rain. Its shot looks down to the
    north-west, toward the sun, from (205, 18, 100).

  With `defaults`, every field this issue adds is at its default: the cliff's entry has no `projection`, entry 1 no
  `aspect`, the field's soil no `modify` (and the rain's channel goes with it). Criterion 7 sets one field at a time.

## The surface under test

Each test enters through the base's own call: `deep-gpu run [--planted <name>]` (#377) with `view3d` (#378): its
`size`, `fps`, `from`, `frames`, `seeks` (#173: after drawing frame `after`, the next frame drawn is `to`), `capture`
with `targets: ['final']` (each captured frame's 8-bit PNG, named by its SHA-256), `assets` (`{sha256: path}`, which a
material's map is read from) and each frame's `pixel_hash`. Readings of the cover's values at ground points come from
one new field of `view3d`, `cover_points`, beside #2017's `ground_points`. `deep-show` isn't driven: no criterion reads
the agent's check or a frame's issues.

## Assumed surfaces

The issue and the design name the fields and behaviours but not every form or reading; each below is this job's
choice, the most natural one beside the base's own calls. The implementer provides exactly these, or disputes them.

1. **The cover**, on a terrain plate: `params.cover`, beside `params.terrain` (the design lists `cover` beside
   `terrain`, as it lists `overlays`, which #537 put at `params.overlays`). `cover: [{material, where, blend, projection?,
   modify?}] ≤ 4`:
   - `material`: a `material@1` item's ID. Entries lie in order over the plate's own `material`; at a ground point each
     mixes its material's values over what lies under it by its weight, so an entry of weight 1 shows its material and
     one of weight 0 leaves what is under it.
   - `where`: an object of terms, each optional: `slope: {min?, max?}` (degrees), `height: {min?, max?}` (m),
     `aspect: {direction: deg, min?, max?}` and `curvature: {min?, max?}` (per m); `noise` and `class` are the
     implementer's, and no test writes them. A term holds where its value lies within its bounds (a bound left out is
     open). An entry's weight is 1 where every term holds and 0 where one fails, past `blend` m of ground from where that
     changes; `where: {}` covers the whole plate.
   - **aspect** is the compass facing of the ground: the azimuth of its down-slope direction, 0° facing north (−Z),
     90° east (+X), 180° south (+Z), as a sky's azimuths run at the base (from −Z turning toward +X). The term reads it
     as cos(aspect − direction), so with `direction: 0` a north face reads 1, a south face −1, east and west 0.
   - **curvature** is minus the Laplacian of the heights, −(∂²h/∂x² + ∂²h/∂z²), per metre: positive on a ridge and
     negative in a gully, as the criterion signs it, at the Laplacian's magnitude. (The Laplacian's own sign reads a
     ridge negative; the criterion's signs win.)
   - `blend: m`: the width, in metres of ground, over which the weight crosses from 0 to 1 at its region's edge; 0 is a
     hard edge.
   - `projection: uv | triplanar | auto = auto`: `uv` samples the entry's maps by the plate's uv0; `triplanar` by three
     projections in metres (along X, sampling z and y; along Y, x and z; along Z, x and y), mixed by weights
     |n_i|^(1.5 × sharpness) normalized, n the geometric normal; `auto` is `triplanar` where the slope passes 35° and
     `uv` elsewhere. The sharpness is the implementer's; no test assumes its value.
   - `modify: [{kind: wet | dust, where?, amount}]`: changes the entry's material where `where` holds (everywhere when
     it is left out) by `amount` (0 to 1): `wet` multiplies base colour by 1 − 0.3 a and roughness by 1 − 0.5 a; `dust` is
     the implementer's, as long as amount 1 changes something drawn.
   - Thresholds and amounts read channels by path: a channel's `target` keys `items/<plate>/params/cover/<k>/where/
     <term>/min` (or `max`) and `items/<plate>/params/cover/<k>/modify/<j>/amount`, as it keys any number of an item.
2. **`view3d` gains `cover_points: {"item": "<plate ID>", "at": [[x, z], …]}`.** Each frame then carries
   `cover_points: [{"at": [x, z], "curvature": c, "entries": [{"weight": w, "triplanar": [w_x, w_y, w_z] | null}, …],
   "base_color": [r, g, b], "roughness": ρ}, …]`, one per point asked, in the order asked, `at` echoing it (world x and z
   in metres; the ground point is the plate's surface above it, as the frame draws it):
   - `curvature`: the value `where.curvature` reads there.
   - `entries`: one per cover entry, in order. `weight`: the entry's weight there, after `where` and `blend`.
     `triplanar`: the weights of the projections along X, Y and Z (in that order) the entry's fetches mix there when it
     samples triplanar, or null when it samples by uv0.
   - `base_color` (linear RGB) and `roughness`: the values the fragment stage shades the point with, after every entry and
     its `modify`, before any light.

   Read back from the GPU, or computed on the CPU by the same function the fragment stage runs on the same inputs, so
   a planted program changes the readings as it changes the frame.
3. **`scripts/lanes.mjs`** gains the line under Run them.
4. **Planted programs**, each reachable only through `deep-gpu run --planted <name>` (`Planted` in
   `crates/deep-gpu-layer/src/main.rs`); an unknown name is `bad_input` at the base.

   | Name | The wrong program | Criterion |
   |---|---|---|
   | `cover_keeps_planar_uv` | A cover entry under `auto` or `triplanar` samples its maps by planar UV, the ground's (x, z) in metres, at every slope: the 70° face's texels stretch 1 ÷ cos 70° = 2.92× down the slope. `cover_points` reports `triplanar` null. Everything else is shipped. | 1 `#1383.3bb69dac` (issue-named: "planar UV stretches 2.92× and fails") |
   | `triplanar_by_shaded_normal` | Triplanar weights come from the interpolated shading normal in place of the geometric one, normalized as shipped; `cover_points` reports the weights it samples with. Everything else is shipped. | 2 `#1383.c10c4d30` (the Fields' "It can never: … weight by the shaded normal") |

5. **The taste call** is recorded in `tests/acceptance/1383/TASTE.json`, the one file anyone adds to this folder after
   this commit, and only to record the owner's answer: `{"issue": 1383, "criterion": "#1383.92cc9800", "verdict":
   "looks_right" | "looks_wrong", "who", "when": ISO 8601, "screenshots": {name → sha256 for the four pictures and the
   recording}, "note"?}`.

No `twins.json`: every test fails on the base at an assertion of its own (`BASE-FAILURE.txt`), and the two planted
programs are run by the tests themselves.

## The planted programs

Two, both in `deep-gpu` (Assumed surfaces 4). `cover_keeps_planar_uv` is the issue's own ("planar UV stretches 2.92× and
fails"): criterion 1's second test draws the cliff under it and requires the judge to fail, naming the stretch down the
face, measured within 10% of 2.92×. `triplanar_by_shaded_normal` is added because criterion 2's sum alone holds for any
normalized weights: its second test requires the judge, which also holds the weights to |n|^p of the geometric normal,
to fail at a point beside a crease, naming it. No other plant: the remaining criteria fail on the base, which has no
cover.

## Criteria to tests

IDs are `#1383.` and the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed, the
leading `- [ ] ` dropped, computed with `scripts/proof-change.mjs`'s own `readIssue` from the live issue. Each test's
name starts with its ID. Each file's header states its fixture, numbers and wrong programs in full. Tests: 2 + 2 + 1 +
1 + 1 + 1 + 1 + 1 = 10.

| ID | Criterion (short) | File (tests): what it asserts |
|---|---|---|
| `#1383.3bb69dac` | On a 70° face a checker's texel size stays within 10% of flat ground's; planar UV stretches 2.92× and fails | `ac1-cliff-texels.test.ts` (2): the cliff's two orthographic frames: the checker's cell down the face (the view's columns) and across it (its rows), each within 10% of the flat ground's cell. `--planted cover_keeps_planar_uv`: the judge fails, a failure names the stretch down the face, and it measures within 10% of 2.92×. Catches: the base (no cover); `auto` left on uv0 past 35°; triplanar on the wrong axes or not in metres |
| `#1383.c10c4d30` | Triplanar weights sum to 1 within 1e-5 | `ac2-triplanar-weights.test.ts` (2): at the 28 points of the four planes, `triplanar` sums to 1 within 1e-5 and is |n|^p normalized over the geometric normal, one p > 0 at every point within 1%. `--planted triplanar_by_shaded_normal`: the judge fails, naming a point beside a crease. Catches: the base; weights not normalized; weights from the shaded normal; weights of another form |
| `#1383.7dfe9767` | On a four-sided pyramid a `where: aspect` for north covers the north face and none of the south | `ac3-aspect.test.ts` (1): the snow entry's weight is 1 (within 1e-3) at the 12 north-face points and 0 (within 1e-6) at the 12 south-face points. Catches: the base; aspect from another axis or turning the other way; aspect read without the cosine's sign; `where` ignoring aspect |
| `#1383.3f20cff6` | A ridge has positive curvature and a gully negative at their fixture centers | `ac4-curvature.test.ts` (1): `curvature` is positive at the three ridge points and negative at the three gully points, each within 10% of the Laplacian's magnitude there, 0.3125 per m. Catches: the base; the Laplacian's own sign; mean curvature (half); a Laplacian over sample indices (four times, at 2 m) |
| `#1383.4fb146a3` | At `wet` amount 1, a 0.8 roughness pixel evaluates to 0.4 and its base color to 0.7× | `ac5-wet.test.ts` (1): at four points under soil with `wet` amount 1, roughness 0.4 and base colour (0.35, 0.28, 0.21), each within 1e-4; without `modify`, 0.8 and (0.5, 0.4, 0.3). Catches: the base; wet that replaces the material; another factor, or one on the wrong value |
| `#1383.9241d5cb` | Seeking and playing a snow line falling 300 m over 10 s match by pixel hash | `ac6-snow-line-seek.test.ts` (1): the fixture's snow shot played frame by frame from 0 to 40 (0 to 10 s at 4 frames a second), and in another process opened at frame 40 and sought to frames 0, 20, 10, 30, 3, 39, 15 and 33: each sought frame's `pixel_hash` is the played one's. The played frames at 0, 5 and 10 s differ from each other and pass #1399's guard. Catches: the base (the line doesn't move); snow that accumulates or melts over frames; a threshold a frame late; a stale cover after a seek |
| `#1383.12eb8d92` | Each new field set away from its default changes at least one pixel of the fixture | `ac7-fields-reach-pixels.test.ts` (1): the fixture document at its defaults from each shot at 5 s, against the same with `projection: uv`, `projection: triplanar`, `where.aspect`, `where.curvature`, `modify` wet and `modify` dust each set alone: each differs from its shot's defaults by pixel hash and in at least one pixel, and every frame passes #1399's guard. Catches: the base; a field read but never drawn |
| `#1383.92cc9800` | The pictures and the recording shown; one taste call recorded, else INCONCLUSIVE | `ac8-taste.test.ts` (1): writes the four pictures and the recording from the fixture document's own frames (The taste call), prints their SHA-256s, then reads `TASTE.json`: absent, or recorded on other SHA-256s, is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on these passes. Attaching them to the PR and showing them in the session is the implementer's, outside any test |

## Readings where the issue leaves a choice

### Criterion 1

- **"A checker's texel size"** is the size of the checker's cell on the ground, in metres, measured from the frame: 9
  scan lines along each of the view's axes, each in linear light (sRGB decoded, Rec. 709 luminance), thresholded halfway
  between its 10th and 90th percentiles; the cell is the mean run between the first crossing and the last, each crossing
  placed between its two pixels, and the median over the lines. Thresholding in linear light keeps a triplanar blend's
  dominant projection, whose weight is over a half at any sharpness, as the cell read. An orthographic view square onto
  each surface makes a pixel the same size in metres in every direction on it.
- **"On a 70° face"** is a face whose every cell lies in one plane at 70°, so its geometric normal is exact. **"Its size
  on flat ground"** is the flat ground's cell, the mean of the two directions there (0.5 m in metre UVs).
- **"Stays within 10%"** holds both down the face and across it. Triplanar at 70° samples the projection along X with
  the larger weight, whose cell down the slope is 0.5 ÷ sin 70° = 0.532 m (1.06×) and across it 0.5 m.
- **"Planar UV stretches 2.92× and fails"**: planar UV is the ground's (x, z) in metres, whose cell down a 70° slope is
  0.5 ÷ cos 70° = 1.46 m, 2.92×. It is the planted program, not `projection: uv`, which samples by uv0, whatever layout the
  plate's uv0 has (at the base its box fallback, by each vertex's normal). "Fails" is the judge failing it, and the
  stretch it names must measure within 10% of 2.92×, so the measure itself is held to the issue's number.
- **`projection` is left at its default**, `auto`, so the face's triplanar is `auto`'s, above 35°.

### Criterion 2

- **"Triplanar weights"** are the issue's: |n|^(1.5 × sharpness) over the geometric normal, normalized. The sum alone
  holds for any normalized weights, so the test also holds them to that form: for each point,
  ln(w_x ÷ w_y) ÷ ln(|n_x| ÷ |n_y|) and ln(w_z ÷ w_y) ÷ ln(|n_z| ÷ |n_y|) give the exponent p, and every point gives one p
  > 0 within 1%. The issue gives no sharpness and lists no field for it, so p is not assumed. Points sit off the creases
  and samples, and the four quadrants have four different normals, so the form is tested across normals.
- **"Within 1e-5"**: |w_x + w_y + w_z − 1| ≤ 1e-5 at each point.
- **The shaded normal** differs from the geometric only in cells beside a crease; 12 of the 28 points lie there and 16
  inside the quadrants, so the shipped p is the median under any wrong program confined to the creases.

### Criterion 3

- **"A `where: aspect` for north"** is `aspect: {direction: 0, min: 0.5}` with no other term; the threshold is this job's
  (any threshold between −1 and 1 parts north from south on this pyramid). **"Covers the north face"**: the entry's
  weight is 1 (within 1e-3) at points across it; **"none of the south"**: 0 (within 1e-6) at their mirrors. Points stay
  3.5 m from the ridges, where cells straddle two faces. `blend: 0`, so no reading of `blend` reaches a point.
- **North** is −Z, as the base's skies run their azimuths from −Z (Units and axes names no compass). East and west aren't
  asserted: the criterion names north and south.

### Criterion 4

- **"Positive curvature"** on a ridge with **"a true Laplacian of the heights"** (Scope): the curvature is minus the
  Laplacian, at its magnitude, per metre. The test asserts the sign and the magnitude within 10%: the Laplacian of a
  Gaussian of height 20 m and σ = 8 m at its centre line is 0.3125 per m in size; a five-point Laplacian at the 2 m
  spacing reads 0.3077.
- **"At their fixture centers"**: three points on each centre line, away from the plate's edges.

### Criterion 5

- **"A 0.8 roughness pixel"**: a ground point under a cover entry whose material's roughness is 0.8, fully covering it;
  **"evaluates to"**: the values the fragment stage shades it with (Assumed surfaces 2). **"Its base color to 0.7×"**:
  each linear channel 0.7 times the material's, the issue's 1 − 0.3 a at a = 1, within 1e-4, as is roughness 0.4,
  0.8 × (1 − 0.5).
- The control without `modify` must read the soil's own values, so a reading that never applies the cover can't pass.

### Criterion 6

- **"A snow line falling 300 m over 10 s"**: the fixture document's two snow lines, each keyed by a channel on its
  `where.height.min` linearly over 0 to 10 s, 420 m to 120 m and 300 m to 0 m.
- **"Seeking and playing ... match by pixel hash"**: frame n played after every frame before it, in one process, against
  frame n reached by seeks in another process that opened the document at 10 s and never played: its first frame
  is 10 s, and then 0, 5, 2.5, 7.5, 0.75, 9.75, 3.75 and 8.25 s. Two processes, so nothing a process keeps between
  calls can carry from the played side. **Pixel hash**: each frame's `pixel_hash`. 4 frames a second, 41 played
  frames, keeps the run short on a machine under load; the criterion names no rate.
- So two frames that never show the line can't match, the played frames at 0, 5 and 10 s must differ from each other
  and each pass #1399's guard.

### Criterion 7

- **"Each new field"** is each field the issue's Fields add: `projection` (`uv` and `triplanar`, its two values off
  `auto`), `where.aspect`, `where.curvature`, and `modify` (`wet` and `dust`, its two kinds). `cover`, `material`,
  `where`'s slope and height and `blend` are #2014's, which these tests use but don't count as this issue's.
- **"Of the fixture"**: the fixture document (criterion 8's), drawn at 5 s from the shot that sees the field's plate,
  with every new field at its default against the same with that one field set. 5 s puts the snow lines at 270 m and
  150 m, so both entries cover ground in view. `where.aspect` and `where.curvature` are set on entry 1, whose line lies
  under entry 0's, so its restriction shows; at the defaults entry 1 covers every aspect.
- **"Changes at least one pixel"**: a different `pixel_hash` and at least one pixel of the final target different in a
  colour channel; both frames pass #1399's guard.

### Criterion 8

- **"Taken by the check run from the fixture document"**: `ac8-taste.test.ts` is the check run; every picture is a frame
  of the fixture document as written, from its own shot. The pictures: `cliff.png` (0 s), `snow-line-by-aspect.png`
  (5 s), `ground-before-rain.png` (0 s, wet amount 0) and `ground-after-rain.png` (8 s, amount 1), at 960 × 540 in the
  filmic look; `snow-line.apng` (480 × 270, 0 to 10 s, drawn and played at 6 frames a second: 61 frames).

## The taste call

`ac8-taste.test.ts` writes to `docs/evidence/1383/` and prints the SHA-256s. The implementer attaches them to the PR,
shows them in the session, and records the owner's answer in `TASTE.json` (Assumed surfaces 5). The pictures are
evidence for the one taste call only; no other test reads them to judge them.

## Not tested

No criterion asks for these, so none is tested: `where`'s `slope`, `noise` and `class` (and `class_map`); `albedo` and
ground images (#1384); `horizon` and sky occlusion (#1381); levels of detail under a cover (#2017); `blend`'s shape;
`auto`'s threshold at exactly 35° (the cliff's face is 70° and its corrugation under 23°); "3 fetches per material"; how
`dust` changes a material; a `modify` with its own `where`; the rain's amount sought against played (the snow line's
thresholds are); four entries' cap; overlays over a cover; puddles (Not in scope).

## What the implementer adds outside this folder

- The `scripts/lanes.mjs` line under Run them.
- In `deep-canvas-scene3d` and the renderer: the cover itself, as Assumed surfaces 1 states it.
- In `deep-gpu`: `view3d`'s `cover_points`, and the two planted names in `Planted` (`crates/deep-gpu-layer/src/main.rs`).
- After the owner's taste call: `TASTE.json`, and the pictures attached to the PR.

`BASE-FAILURE.txt` is the run at the base.
