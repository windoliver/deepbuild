# Acceptance tests for #458, the `rect` group: view-rectangle invariance (criteria 15 and 16)

Written first, from issue #458 (its scope, its criteria 15 and 16 and its proof line), its Oracle page, the design
sections it links and base commit `06e231702` ("Merge pull request #2735 …"), by a job that never saw an
implementation; none existed. Four other blind jobs write the issue's other criteria in their own folders; this job
saw none of their files. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job (design: Dogfooding). Lean: one test per criterion, plus one per planted twin a criterion names.

## What was read

- The issue, live: its Scope bullet on view-rectangle invariance ("a view drawn into a rectangle of a larger target,
  at any whole-pixel offset, draws what the same view draws alone in a target of its own size, and writes nothing
  outside its rectangle"), the bullet on the targets a pass can read (color, ID, normal, depth, velocity), "Both run
  in the release preflight's full lane only", and criteria 15 and 16.
- The Oracle page (`doneright/oracles/issues/458.md` in `DeepBuildAI/deepbuild`, branch `doneright`): no upstream test
  checks any criterion, and its list predates criteria 15 to 19, so both are held to this suite's own fixture and
  planted twins.
- `docs/technical-design.md`: How we know version 0 works (Rendering relations, The canvas, Canvas modules, Criteria
  to tests, the proof guard's base-run rule), Decided (The parity suite), and each use of "code value".
  `docs/canvas-primitives.md`: Determinism, and Determinism class (its list of the targets the GPU rasterizes: color,
  depth, normal, object_id, velocity, emission). `AGENTS.md`.
- At the base, for surfaces and conventions only: `tests/acceptance/1897/` (README shape, helpers), `431/` (README,
  helpers: `deep-gpu run`, the velocity target, the file readers), `418/` (the look's `ao`), `419/` (the look's
  `motion_blur`, channels), `422/` (the look's `bloom`), `424/` (the sun and `view3d` helpers), `468/` (the lens and `effect@1` dof),
  `140/gpu/tsconfig.json`;
  `crates/deep-gpu-layer/src/view3d.rs` and `view3d/parse.rs` (the call's fields and what each target's file holds),
  `crates/deep-scene3d-render/src/{lib,targets}.rs` (the read-back comments only), `crates/deep-gpu-layer/Cargo.toml`
  (features), `scripts/proof-change.mjs` (criterion IDs), `scripts/lanes.mjs` (the `alone` list).

What the base already does and these tests don't credit: `view3d` draws a view alone into targets of the view's own
size and returns `final`, `linear`, `ids`, `depth` (view-axis metres), `normal` (the water's shaded normal, 0 without
water) and others; the look has `bloom`, `ao` and `motion_blur`, the camera a lens, and `effect@1` a dof kind; the
velocity target is built when something reads it and has no file. There is no way to draw a view into a rectangle of
a larger target, none to seed a target with noise, no velocity file, and none of the planted names below. So these
tests define the surface below.

## Run them

They build `deep-gpu` and draw on the GPU, so the file runs alone, and `scripts/lanes.mjs` needs
`'tests/acceptance/458/views/rect/'` in its `alone` list. This README is the instruction; the implementer makes that
edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/458/views/rect --no-file-parallelism
npx tsc -p tests/acceptance/458/views/rect/tsconfig.json   # type-check
```

- The file builds its binary once (`cargo build --locked --bin deep-gpu`, default features), copies it out of the
  target folder (`CARGO_TARGET_DIR`, else `target`) and fails each test if the build failed.
- Everything draws on this Mac's Metal GPU. Off macOS, or where the binary answers that it has no GPU, a test fails
  with a message starting `BLOCKED:`, never passing. Nothing here is a timing budget.
- A run writes about 1.5 GB of target files into one temporary folder and deletes it after the file.
- `BASE-FAILURE.txt` is the suite's run at the base.

## The surface under test

**No new binary, one new call, three planted programs.** #377's `deep-gpu run [--planted <name>]` with its JSON-lines
protocol unchanged: one scenario `{"out", "calls"}` per line, one `{"ok": true, "replies"}` line back, files written
under `out`, each named by its SHA-256. `view3d` is used as it is and gains nothing.

### `view_rectangle`: one frame of a scene3d view, drawn alone and into a rectangle of a larger target

The entry the issue's relation needs and the full lane runs (the lane, its verdicts and its report belong to the
`suite` group; these tests drive the call directly). It is a proof call of its own, not a field of `view3d`, `live`
or an export, since the issue keeps the relation out of a live view and an export.

```json
{"call": "view_rectangle", "doc": "<path>", "look": {…}, "size": [960, 540], "fps": 60, "from": 30,
 "target": [2560, 1440], "at": [317, 211], "seed": 458}
```

| Field | Form | Meaning |
|---|---|---|
| `doc`, `look`, `size`, `fps` | as `view3d`'s | the document's file, the look, the view's size in px, frames a second |
| `from` | as `view3d`'s, a whole number | the one frame drawn, at t = `from` ÷ `fps`, as `view3d` draws it with `from` and `frames: 1` |
| `target` | `[w, h]`, whole px | the larger target's size |
| `at` | `[x, y]`, whole px | the rectangle's top left corner in the larger target; the rectangle is `size` px and lies inside it |
| `seed` | a whole number in 0 … 2³² − 1 | the noise's seed |

What it does, in one run on one device:

1. Draws the frame alone into targets of `size`, exactly as `view3d` draws it (the tests hold `alone.final`,
   `alone.linear` and `alone.ids` to `view3d`'s `final`, `linear` and `ids` of the same frame, pixel for pixel).
2. Makes the frame's targets at `target` and seeds every one of them with noise from `seed`: every pixel outside the
   rectangle, in every target a pass can read. What the rectangle's own pixels hold before the view draws is the
   entry's business; the tests read the noise only outside it.
3. Reads the seeded targets back.
4. Draws the same frame through the same passes into the rectangle `at` + `size` of those targets, and reads them
   back.

The reply:

```json
{"alone": Targets, "seeded": Targets, "rectangle": Targets}
```

- `alone`: the view drawn alone; every target is `size` px.
- `seeded`: the larger target after step 2, before the view draws; every target is `target` px.
- `rectangle`: the larger target after step 4; every target is `target` px.

`Targets` is `{"final", "linear", "ids", "normal", "depth", "velocity"}`, each value the SHA-256 that names the file
(as a `view3d` frame's `final`, `linear` and `ids` are). Every file holds one value a pixel (a multisampled target
resolved as `view3d` returns it), rows top-down, left to right, no padding:

| Target | File | Bytes a pixel | Holds |
|---|---|---|---|
| `final` | `<sha>.png` | 8-bit RGB or RGBA PNG, not interlaced | the frame after tone mapping, as `view3d`'s `final` |
| `linear` | `<sha>.f32` | 16: four little-endian f32, R, G, B, A | the linear color target, as `view3d`'s `linear` |
| `ids` | `<sha>.png` | 8-bit RGB or RGBA PNG, not interlaced | the ID target, as `view3d`'s `ids` (no `picks` table is needed) |
| `normal` | `<sha>.f32` | 12: three f32, x, y, z | the normal target the frame's passes read (ambient occlusion's): a unit normal under each drawn pixel, in the space the target stores, the same both ways |
| `depth` | `<sha>.f32` | 4: one f32 | the value the depth target stores, as a pass reading it gets it; not `view3d`'s view-axis metres, since noise outside the rectangle has no view to be unprojected through |
| `velocity` | `<sha>.f32` | 8: two f32, x, y | #431's velocity target: each pixel's travel over the shutter in device px, x to the right; built here because the fixture's velocity blur reads it |

The names are `view3d`'s where it has them; `velocity` is #431's name for the target. The criterion's "color" is
`final` and `linear` (Readings).

The noise, as the tests hold it: each target's first 4,096 pixels as seeded hold at least 256 different pixel values;
one seed gives the same noise in every run (same `size`, `target` and `at`); another seed gives other noise in every
target; the view drawn alone doesn't depend on the seed. Its distribution is the entry's own, with one need the
planted bloom sets: the color noise is bright enough that a bloom tap landing on it brightens the frame beside it (the
fixture's frame is mid gray or darker along its edge, apart from its two emitters).

Refusals, as the binary's other calls give them: `{"code": "bad_input", "reason"}` for a malformed field or a
rectangle that leaves the target, and the code the binary already answers where it has no GPU (`unsupported_platform`),
which these tests read as BLOCKED. No test here asserts a refusal.

### Planted programs (`deep-gpu run --planted <name>`, each reachable only there)

Each differs from the shipped program only when the target is larger than the view, so the view drawn alone keeps the
clean frame (the two criterion 15 tests hold `alone.final` to the clean run's).

| Name | The wrong program | Criterion |
|---|---|---|
| `bloom_clamps_to_target` | Bloom clamps its taps to the target's edge instead of the view's, so taps past the rectangle's edge read the noise and pixels within 32 px of that edge brighten | 15 |
| `ao_scales_by_target` | The ambient-occlusion pass scales its coordinates by the target's size instead of the view's | 15 |
| `clears_whole_target` | The pass that writes the final target clears the whole target before it draws, where the shipped one writes only its rectangle | 16 |

## The fixture (`fixture.ts`)

One scene document and one look, generated in code so every field is readable; nothing is a committed binary.

- A floor and a back wall under a sky with ambient light, a ball, a crate, a thin post 1.5 m from the camera, a box
  sliding along x at 12 m/s (a channel on its position: a declared move), two small emitters of radiance 6 at the
  view's left edge and top right corner, and a sun that casts shadows.
- A perspective `camera@1` through a 35 mm lens at f/1.4, with `effect@1` dof focused 6 m away, on the ball.
- The look: physical basis, tone map none, one sub-sample, `bloom: {intensity: 0.3, radius: 0.85}`, `ao` at #418's
  defaults (half resolution), `motion_blur` by velocity at #419's defaults (180° shutter, 32 px at most).
- Frame 30 at 60 frames a second (t = 0.5 s): the slider is half way along its move, over the ball, travelling about
  18 px over the shutter (12 m/s for 1/120 s, 5.0 to 5.3 m from the camera).

Shown at the base (BASE-FAILURE.txt, "The fixture at the base"): the document passes the base's check and draws
through `view3d`; two draws give one pixel hash; and the frame changes when bloom, ambient occlusion, the depth of
field, velocity blur, the sun's shadow or the sun is taken away. The first test repeats those seven draws, so a
renderer that ignores one of the effects fails it instead of holding the relation over nothing.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed
(`scripts/proof-change.mjs`). Each test's name starts with `AC<n> #458.<id>`. All five tests are in
`rectangle.test.ts`, and the two clean ones judge one `view_rectangle` reply, as criterion 16 says ("in the same run").

| ID | Test | What it asserts |
|---|---|---|
| AC15 `#458.fd784061` | the fixture drawn alone and into the rectangle | Premises: `alone.final`, `.linear` and `.ids` equal `view3d`'s bit for bit; the frame changes with each of bloom, ambient occlusion, depth of field, velocity blur, the shadow and the sun off; the velocity target holds the slider (≥ 5,000 px moving 10 to 30 px right), the normal target a unit normal on ≥ 90% of pixels, the depth target ≥ 1,000 different values. Then, for all 960 × 540 pixels (x, y) against (x + 317, y + 211) of the 2560 × 1440 target: `ids` equal bit for bit; `final`, `linear`, `normal`, `depth` and `velocity` within one code value on every channel |
| AC15 `#458.fd784061` | planted `bloom_clamps_to_target` | The view alone draws the clean frame; the same comparison fails, a failure naming the `final` target and its first pixel; at least one pixel of `final` within 32 px of the rectangle's edge is brighter than alone by more than one code value on a channel and darker on none |
| AC15 `#458.fd784061` | planted `ao_scales_by_target` | The view alone draws the clean frame; the same comparison fails, a failure naming the `final` target and its first pixel |
| AC16 `#458.c54b3af2` | every pixel outside keeps its noise | On the same run: each of the six targets is seeded with noise (≥ 256 different values among its first 4,096 pixels); every one of the 3,168,000 pixels outside the rectangle is equal bit for bit, in every target, to the seeded read-back. A second run with another seed: other noise in every target, the same view alone |
| AC16 `#458.c54b3af2` | planted `clears_whole_target` | The same seed seeds the same noise; the outside comparison fails, a failure naming the `final` target and the first pixel outside, (0, 0) |

A failure reads, for example: "the final target: 28,388 of 518,400 pixels of the rectangle are more than one code
value from the view drawn alone; the first pixel is (0, 0) of the view, (317, 211) of the target: alone […], in the
rectangle […]". The comparisons are this suite's own code (`insideFailures`, `outsideFailures`), run on the files the
binary wrote; the binary returns targets and no verdict.

## Readings where the issue and design leave a choice

- **The entry** is a call that draws both ways and returns every target of both; the full lane's verdict for the
  relation (its words, report and bar) is the `suite` group's and nothing here asserts it. "On one machine" and "in the
  same run" are one reply of one process on one device.
- **The targets** are the issue's list (color, ID, normal, depth, velocity), which is the design's list of targets the
  GPU rasterizes less emission. "Color" is both `view3d` color targets a pass reads or writes: `linear` and `final`.
  At the base bloom shows in `final` and not in `linear`, so the planted twins are held to `final`.
- **"Seeded noise in color and depth"** (criterion 15) and **"keeps its noise … in every target"** (criterion 16) are
  read together: color and depth are the two kinds of attachment, so every target of the list is seeded, the ID,
  normal and velocity targets too, and criterion 16 is checked in all six.
- **Who makes the noise.** The entry does, from `seed`, and returns each target as seeded; the tests compare the
  drawn target with that read-back outside the rectangle. A test that handed the noise in as files would have to know
  each target's stored format, which is the renderer's own. The planted `clears_whole_target` shows the read-back is
  taken before the view draws: read after, it would pass. "Seeded" is held as: one seed, one noise; another seed,
  another noise.
- **"One code value"** is one 8-bit step, 1/255 of a channel's unit, on every target, as the design uses the term for
  frames and #431's suite reads it on float targets: at most 1 on each 8-bit channel of `final`, and at most 1/255 on
  each f32 lane of `linear`, `normal`, `depth` and `velocity`. Where a half float's own step is coarser than 1/255
  (values of 8 and above), one such step is allowed, so one rounding of a stored half float is never a failure. A
  value that isn't finite matches only the same bits. The stricter reading, one representable step of each target's
  stored format, was not taken: the criterion gives the stored formats no name, and a depth held to one f32 step
  would turn on the rasterizer's own rounding at an offset.
- **"Bit for bit"** for the ID target and for every pixel outside is equality of the pixel's bytes as the file holds
  them (a PNG's decoded pixels).
- **"The first pixel"** is the first in rows top-down, left to right: inside, in the view's own coordinates, with the
  target's beside them; outside, in the target's coordinates.
- **"Brightens pixels within 32 px of the rectangle's edge"** is held as: some pixel of `final` in that band is
  brighter. It isn't held as "no pixel farther in changes", which the criterion doesn't say.
- **"Fails the same way"** for the ambient-occlusion twin is: fails, naming the target and the first pixel. The 32 px
  band is the bloom twin's.
- **"A planted pass that clears the whole target"** is pinned to the pass that writes `final`, so the test can name
  the target it expects: `final`, first pixel outside (0, 0).
- **The offset** is the criterion's (317, 211) alone; the Scope's "at any whole-pixel offset" gets no second offset.
- **Numbers of ours**, where the criterion gives none: frame 30 at 60 frames a second; seeds 458 and 1516; 256 values
  among 4,096 pixels for "noise"; 5,000 moving pixels, 90% unit normals and 1,000 depths for "the targets hold the
  view".

## Not covered, and why

- **The full lane itself**: that the relation runs in the release preflight's full lane only, under the lease, with
  PASS, FAIL or BLOCKED and a report, and never in a live view or an export. The lane and its verdict rules are the
  `suite` group's; this folder proves the relation on the entry the lane would run. No test here shows `view3d`,
  `live` or an export lacking the call's fields.
- **A scissor left at the whole target** (the Scope's third catch) has no planted twin of its own in the criteria;
  the outside comparison is what would catch it.
- **Targets the list doesn't name**: `pre_tone`, the backdrop copy, emission, the circle of confusion, shadow maps
  and pooled intermediates aren't returned.
- **A software adapter**: criterion 12, the `relations` group's.
- **The entry's refusals** and any offset, size or frame but the criterion's.
