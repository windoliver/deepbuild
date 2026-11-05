# Acceptance tests for #425: 3D views — levels of detail by error, a light cut that is pure in the view, and the ladder's climb

Written first, from issue #425 (its scope, its Fields block — Level of detail: levels by error — its six acceptance
criteria and its proof line), the design sections it links and those they lean on, its oracle page, and the base
commit `2ea0fb77` ("Merge pull request #1233 …"), by a job that never saw an implementation; none existed. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). The owner asked for a lean suite: one file per criterion, at most two tests each, with the planted wrong
programs the criteria imply.

## What was read

- Issue #425 and its oracle page: no upstream test checks any of the six criteria, so nothing is ported.
- `docs/canvas-primitives.md`: The cost model and its budget class table (showpiece: 10 ms GPU, render scale while
  moving 0.5; work product 0.75*); Meter and degrade ladder (the `climb` field: "render scale while moving → 1, then 4
  samples while moving, then full-resolution effects, then shadow maps at twice their size"; "rung by rung with the
  same hysteresis", down after 30 frames, up after 120; "a rung dropped for frame health isn't climbed again until the
  view changes or you raise it"; "Canonical renders (exports, render-back snapshots, checks and goldens) never step down
  or climb"; "a test steps it frame by frame on the virtual clock"); Render-back; Render-back: diagnostic modes (read
  for "level of detail per item", not used); Level of detail (`lod: {bands: [{below_px, show, params}], margin = 0.1}`;
  "an integer blend level the CPU computes from the canonical view in f64; the GPU compares it with complementary
  masks keyed by pixel hash and item ID (never by frame), the same in the color, depth, shadow and object-ID passes");
  Level of detail: levels by error (the simplify job's `levels` and `auto`, the probe's `lod_errors`, `lod_px`, its
  "It can never"); Level of detail: proxies and collection proxies (read, not tested); the decision rows "Selection
  without history", "Level of detail by error" and "Exact GPU work".
- `docs/technical-design.md`: the "Selection without history" row ("lights near the cut dim by their score … no
  session hysteresis and no fade in wall-clock time, so a view gives the same frame however it was reached").
- At the base: `crates/deep-gpu/src/meter.rs` (the ladder: `LADDER`, `Rung::up` refusing past `base` — "the climb
  above it needs coefficients measured on this machine at setup (R6)" — `health_step`, `view_changed`, `climbs`);
  `crates/deep-gpu-layer` (`main.rs`'s calls and `--planted` table; `view3d.rs`: `from` as a seek, every frame's
  `pixel_hash`, `surface`, `notices`, `--backend noop`; `live.rs`: the `live` call, its stub meter, `camera`, `rung` and
  `canonical` events, `render_canonical` at the base rung, `camera_moves` choosing the class's scale while moving;
  `levels.rs`: #383's `open` by projected size); `crates/deep-canvas-scene3d` (`light.rs`: #421's policy, 32 lights by
  (score bucket, ID), `MARGIN` 0.1 ramping the weight of a light near the cut, `priority`, `range`; `gltf.rs`:
  `mesh.asset@1`'s reader of a JSON glTF with inline buffers); `crates/deep-canvas` (`budget.rs`'s classes, the item
  field `lod` already allowed, the time grammar's decimal seconds in whole flicks); `crates/deep-canvas-motion` (`hold`
  keys); and the suites `tests/acceptance/422`, `423` (layout, helpers, the taste call) and `379` (the `live` call, its
  stub meter and its ladder checks).

## What the base already does, which these tests don't credit

`view3d` draws scene3d documents and reports each frame's `pixel_hash`; a seek (`from`) opens a session at its frame;
#421's light policy is already a pure function of the view, keeps 32 lights by (score bucket, ID) and dims a light
within 10% of the cut by its score, reporting only the lights it leaves out (as a notice, once per change); #383 opens
documents by projected size; `mesh.asset@1` reads a glTF node's mesh; the `live` call runs the ladder on the stub meter
and steps down for frame health, holds a drop until a `camera` event, takes a `rung` event as yours, and renders
canonical snapshots at the base rung. There are no `lod` bands, no margin blend, no masks, no mesh levels, no simplify
job, no reported light cut, and no climb: `Rung::up` stops at `base`.

## Run them

They build `deep-gpu` (`cargo build --locked --bin deep-gpu`, and with `--features test-meter` for `climb`, `hold` and
`taste`), as #379's and #422's suites do, so they run one file at a time. `scripts/lanes.mjs` needs
`'tests/acceptance/425/'` added to its `alone` list, beside `tests/acceptance/422/`; this README is the instruction,
the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/425 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/425/tsconfig.json
```

`pure-selection`, `levels`, `masks`, `climb` and `taste` draw on macOS's Metal device; off macOS they fail with a
message starting `INCONCLUSIVE:`, never pass. `hold` runs the ladder on the stub meter, the noop backend and the virtual
clock, on every platform. Nothing compares frame times, so nothing needs a reference Mac, and nothing is gated on power
or load (the owner's rule). `taste.test.ts` writes into `docs/evidence/425/` and keeps what it writes; every other
test writes into its own temporary folder and deletes it.

## The fixtures

- **The band sweep** (`helpers.ts`, `bandDoc`; AC1, AC3, AC6), 320 × 240 at 32 fps: a clay `ball@1` of radius 1 m at
  the origin with `lod: {bands: [{below_px: 48, show: box}], margin: 0.1}` on a ground slab; a casting sun and 30 dim
  fill lights kept by `priority: 10`; and two 400 lm lights, `b-near` at (−4, 0.5, 2) and `c-far` at (4, 0.5, 34),
  that trade the light cut's 32nd place where they are equally far from the eye (z = 18 m). The camera at (0, 1.5, z)
  looks at the origin, z going from 6 m to 30 m in 0.25 m steps (frames 0–96) and back (97–192). The ball spans about
  107 px at the start and 22 px at the turn, so any reasonable measure of projected size crosses 48 px and its margin.
- **The level sweep** (`levelDoc`; AC2, AC6): a bumpy icosphere of 5,120 triangles generated by `rockGltf` as a JSON
  glTF with its buffer inline, given index-only levels by the implementer's simplify job (Assumed surfaces 4), drawn as
  `mesh.asset@1` at the origin, the camera on +Z from 1.5 m to 60 m geometrically (frames 0–96) and back. No simplify
  job exists at the base, so the mesh comes from the test and its levels from the job under test.
- **Both sweeps** move the camera by a `hold` channel whose keys sit half a frame before each frame, so frame n shows
  exactly the n-th value, an f32, and frames n and 192 − n show the same view bit for bit, one reached from each side.
  A fresh process seeks (`from`) the first frame, the turn, each out-leg frame whose bands, blend, level or light cut
  differ from the frame before, and the two frames after each.
- **The showpiece** (`showpiece`; AC4, AC5, AC6), 480 × 320, `budget.class: showpiece`: six boxes on a ground under a
  casting sun. For AC4 its camera orbits by a channel, so it draws at the class's render scale while moving (0.5, as
  the base's `camera_moves` already decides); for AC5 a channel slides one box and the view stays still.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the leading
`- [ ] ` dropped. Each test's name starts with `AC<n> #425.<id>`.

| ID | Criterion (short) | Test, what it asserts, and the wrong programs it catches |
|---|---|---|
| AC1 `#425.85981004` | LOD and the light cut are pure functions of the view: crossings from either side and a seek give the same bands, light weights and pixel hash; no hysteresis, no wall-clock fade | `pure-selection.test.ts` (2): the band sweep with `lod` and `light_cut`: the ball is `[full]` at frame 0, `[box]` at 96 and inside its margin (two bands) somewhere; the cut leaves out `c-far` at 0 and `b-near` at 96. Frames n and 192 − n, and each seek beside its frame, report equal `lod` rows and `light_cut` (lights and weights) and equal pixel hashes. `--planted band_hysteresis`, `light_cut_hysteresis` and `band_fade_by_wall_clock` each fail, naming a frame. Catches: the base (no reports); session state in bands or the cut; a fade in time; a band or weight that differs by direction |
| AC2 `#425.fe13e22a` | The same view draws the same mesh level, the coarsest within 1 device px; crossings and a seek give the same pixel hash | `levels.test.ts` (2): `simplify` with `levels: auto` gives ≥ 3 levels, level 0 the 5,120-triangle input at error 0, fewer triangles each level, no error lower than the level before, none past 1. Over the level sweep every frame's level is the coarsest whose reported projected error is ≤ 1 px; those errors are the probe's `lod_errors` times one factor per frame, which falls as 1 ÷ distance within 6% beyond 25 m; the triangles drawn are that level's; ≥ 3 levels drawn. Mirror frames and seeks report the same rows and draw the same pixels. `--planted level_by_earlier_frame` fails, naming a frame. Catches: the base (no job, no levels); a level by time or by the previous frame; errors not projected through the view; a level not the coarsest; a drawn mesh that isn't the reported level |
| AC3 `#425.4c1317b2` | In a band margin the masks cover every pixel once in color, depth, shadow and object-ID; the blend level is the same integer on every machine | `masks.test.ts` (2): margin frames report an integer `blend` (`level` 0 … `of`), others none. At the margin frame nearest half, a seek with `masks` writes the ball's masks for the four passes: every byte is 1 or 2 (one band), the color, depth and ID masks are byte-identical at the view's size, and the less detailed band keeps `level ÷ of` of the pixels within 0.05 in each pass. The sweep on `--backend noop` and at `internal_scale` 0.5 reports the same `blend` at every frame. `--planted band_masks_independent` fails naming a pass; `--planted blend_level_on_gpu` fails naming a frame. Catches: the base; overlapping or holed masks; masks keyed differently per pass; a level from the GPU, the internal scale or f32 |
| AC4 `#425.96e311e5` | Half the showpiece's frame time free: the live view climbs from 0.5 to 1 after 120 frames and steps back down within 30 once the headroom is gone; render-back and export byte-identical either way | `climb.test.ts` (2): on the stub meter (5 ms for frames 1–150, then 12 ms) the orbiting showpiece's changes are exactly base → `scale_1_moving` (headroom) at 120, effective by 150, and `scale_1_moving` → base (frame health) between 151 and 180; it draws at 0.5, then 1, then 0.5. Render-back and export of its frame 10, asked at 140 (climbed) and 190, draw at `base` and equal a fresh process's `canonical` byte for byte. `--planted climb_never_steps_down` fails naming frame 180. Second test: 5 ms throughout climbs to `scale_1_moving` at 120 and `samples_4_moving` at 240; at 245 its render-back and export equal those of a run charged 12 ms throughout (which never climbs) and a fresh process's; `--planted canonical_climbs` fails naming `samples_4_moving`. Catches: the base (no climb); a climb too early or too late; a climb that never steps down; a canonical render at the live rung |
| AC5 `#425.f5321458` | A showpiece that stepped down for frame health stays down while its view is unchanged, even with headroom, and climbs again once the camera moves or you raise it | `hold.test.ts` (2), on noop: the still showpiece charged 5 ms (1–150), 12 ms (151–180), 5 ms after climbs at 120, steps back to base by 180 for frame health, holds base through 420; a `camera` event at 421 brings a headroom climb to `scale_1_moving` by 542; in a second run a `rung` event at 421 takes it there, reason you. `--planted reclimbs_without_view_change` fails, naming the frame it climbed with its view unchanged. Catches: the base (no climb to drop from); a drop that climbs back without a view change; a climb that ignores the camera or you |
| AC6 `#425.e26677a1` | Shown to you: a mesh at each level, a band margin blend, a view climbing the ladder, a recording of an orbit and zoom across the bands; one taste call recorded, else INCONCLUSIVE | `taste.test.ts` (1): writes the pictures and the recording from this run's output (The taste call), then reads `TASTE.json`: absent or recorded on other SHA-256s is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on these passes. Attaching them to the PR and showing them in the session is the implementer's, outside any test |

The scope's shadow passes choosing a level "by the light's projection" and the climb's last two rungs (full-resolution
effects, shadow maps at twice their size) are named by no criterion; no test asserts them beyond AC4's rung order up to
`samples_4_moving`.

## Assumed surfaces

The issue and design name the behaviors but not these calls and fields; each is this job's choice, the most natural
one beside the base's own calls. The implementer provides exactly these.

1. **`view3d` gains `lod: true`**: each frame carries `lod: [{item, bands, blend, level, errors_px, triangles}]`, one
   row per item that has `lod` bands or a mesh asset with levels, by item ID, as the CPU computed it from the canonical
   view (the call's `size` at internal scale 1, whatever `surface` says), so the rows are the same on `--backend noop`.
   `bands`: the bands drawn by their `show` (`full` above the first band's `below_px`), the more detailed first, two
   inside a margin; `blend`: inside a margin `{level, of}`, integers with 0 ≤ level ≤ of, the less detailed band keeping
   the pixels whose mask hash (keyed by pixel and item ID) falls in `level` of the `of` buckets, else null; `level`: the
   mesh level drawn (0 the full mesh), `errors_px`: every level's error projected through the view at the item's
   distance, in device px, `triangles`: the item's triangles drawn in the color pass — these three null for an item
   without levels. A row may carry more fields; mirror frames compare whole rows.
2. **`view3d` gains `light_cut: true`**: each frame carries `light_cut: {shaded: [{light, weight}], left_out: [id]}`,
   #421's policy at that frame's view: the shaded lights in its order with their weights, and the lights left out.
3. **`view3d` gains `masks: true`**: each captured frame carries `masks: [{item, pass, size: [w, h], file}]` for each
   item inside a band margin and each pass of `color`, `depth`, `shadow`, `ids`; `file` names `<sha256>.u8` under
   `out`, w × h bytes, rows top-down, one per pixel of that pass's target (texel, for the shadow map): bit 0 set where
   the more detailed band's mask keeps it, bit 1 where the less detailed band's does, as that pass's own shader
   evaluates the masks at every pixel of its target.
4. **A `simplify` call**: `{"call": "simplify", "asset": path to a glTF, "node", "levels"?: "auto" | [{ratio,
   max_triangles}], "auto"?: {growth, min_gain, max_error}}` (the Fields block's job, defaults as listed) →
   `{"sha256", "levels": [{"triangles"}], "lod_errors": [f32]}`: the job's output written under `out` as
   `<sha256>.gltf`, a glTF whose node's mesh carries its index-only levels over its one vertex buffer, as
   `mesh.asset@1` reads them (`assets` maps the hash to the file, as #420's do); `levels[0]` is the input mesh;
   `lod_errors` is the probe's (each level's object-space error as a fraction of the bounds, `lod_errors[0] = 0`).
5. **The climb in `live`** (#379's call, unchanged otherwise): with headroom the ladder climbs above `base` through
   `scale_1_moving`, `samples_4_moving`, `full_res_effects`, `shadows_2x`, each a change with reason `headroom` 120
   frames after the last change, and a view at `scale_1_moving` or above reports `internal_scale` 1. A `rung` event
   may name a climb rung. "Headroom" for the stub meter: a writer charged half its class's frame time or less has
   headroom; one charged over its class's limit has none.
6. **`live` gains `capture: [frame]`** (for the taste call only): each view at those frames carries `final`, a PNG of
   the view as presented, named by its SHA-256 under `out`.
7. **Each `view3d` call is a clean session**: a seek in a fresh process draws its frame with no history.
8. **The taste call** is recorded in `tests/acceptance/425/TASTE.json`, the one file anyone adds to this folder after
   this commit, and only to record the owner's answer: `{"issue": 425, "criterion": "#425.e26677a1", "verdict":
   "looks_right" | "looks_wrong", "who", "when": ISO 8601, "screenshots": {name → sha256 for the three PNGs and the
   recording}, "note"?}`.
9. **Planted programs**, each reachable only through `deep-gpu run --planted <name>`:

| Name | The wrong program | Criterion |
|---|---|---|
| `band_hysteresis` | A band, once drawn, holds until the item's projected size passes the threshold's margin by a further 10% (session state) | AC1 (issue-named: session hysteresis) |
| `light_cut_hysteresis` | A light once shaded stays shaded until its score falls 10% below the cut's (session state) | AC1 (issue-named) |
| `band_fade_by_wall_clock` | A band change fades from the old band to the new over 250 ms of the host's wall clock | AC1 (issue-named) |
| `level_by_earlier_frame` | A mesh's level is chosen from the previous frame's view (the first frame from its own) | AC2 (design-named: "by an earlier frame") |
| `band_masks_independent` | Each band's mask is keyed by its own hash of (pixel, item ID, band) and keeps its own share, so some pixels are kept by both bands and some by neither | AC3 (a mutant) |
| `blend_level_on_gpu` | The blend level is computed in f32 on the GPU from the drawn frame's projected size and read back, so the noop backend has none and another scale another | AC3 (a mutant) |
| `climb_never_steps_down` | A climbed rung is kept whatever the frames after it charge; only the base and below step down | AC4 (a mutant) |
| `canonical_climbs` | Canonical renders draw at the live view's rung when it has climbed | AC4 (design-named: "never climb") |
| `reclimbs_without_view_change` | A rung dropped for frame health climbs again after 120 frames of headroom, whether the view changed or not | AC5 (a mutant) |

## Readings where the issue leaves a choice

- **Band order.** `bands` lists bands from the largest `below_px` down; above the first, the item draws in full; a band
  holds from its `below_px` down to the next. The tests don't depend on the margin's exact extent or on how projected
  size is measured: they find margin frames from the report, and the sweep passes the threshold by a wide margin.
- **"Every machine"** can't be shown on one machine. The design makes the blend level a CPU computation in f64 from the
  canonical view; the tests hold it to that: the same view gives the same integer on the noop backend (no GPU work at
  all) and at internal scale 0.5 (a machine whose ladder lowered the scale). A cross-GPU comparison isn't asked.
- **Mask shares.** The less detailed band keeps `level ÷ of` of the pixels, within 0.05: the masks blend by the level,
  not just partition the pixels.
- **"Projected at its distance"** is read as the error times the bounds' size times the focal length in px over the
  distance from the eye; with the camera looking at the rock's center, its reported errors must scale as 1 ÷ that
  distance, checked only beyond 25 m (25 radii) so a nearest-point or a center distance both pass.
- **"Headroom is gone"** is a stub charge of 12 ms, over the showpiece's 10 ms; "within 30 frames" is a frame-health
  change by frame 180 when the charge rose at 151 (#379's arithmetic: the 30th consecutive frame over steps).
- **"After 120 frames of headroom"** is the change at frame 120 for a session that opened at frame 1, as #379's ladder
  counts; a climb after a camera move is accepted up to 121 frames after it (#379's suite counts from the next frame).
- **"Its view is unchanged"** is read as #379's suite reads it: a view changes by your input (`camera`), not by the
  document's own animation; AC5's showpiece keeps its camera still, so the reading isn't needed to judge it.
- **The canonical renders** are #379's: a render-back and an export of the session's frame 10, asked by `canonical`
  events, compared by `pixel_hash` with a fresh process's `canonical` call.

## The taste call

`taste.test.ts` writes to `docs/evidence/425/`: `mesh-levels.png`, `band-blend.png`, `ladder-climb.png` and
`orbit-zoom.apng` (TASTE.json's names), each the renderer's own final targets (side by side for the PNGs), and prints
their SHA-256s. The implementer attaches them to the PR, shows them in the session, and records the owner's answer in
`TASTE.json`. The pictures are evidence for the one taste call only; no other test reads them.
