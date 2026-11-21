# Acceptance tests for #971: local tone mapping: a frame's large-scale range compressed toward middle grey while its detail stays, before the tone curve

Written first, blind, from issue #971 (its Scope, its Fields row, its nine acceptance criteria and its Proof line: "The
two-wall fixture with its measured levels, checker amplitudes and edge profile beside the planted blur's, the colour
samples, the seek and sequence hashes, the 4K and 1080p comparison, and the timings"), its Oracle page, the design
sections it links and those they lean on, and base commit `16dc5eab0` ("Merge pull request #2771 …"), by a job that
never saw an implementation; none existed, and no other worktree, branch, PR or stash was read. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean:
one file per criterion, the two planted programs the criteria name, a budgets test and a taste test.

## What was read

- The issue, live (`gh issue view 971 --repo windoliver/deepbuild`): nine criteria, seven functional, the budgets (AC8)
  and the "Shown to you" taste call (AC9); the titles of #418 and #382 it depends on, its parent #73 and epic #310.
  Each test's name starts `AC<n> #971.<id>`, the first 8 hex digits of SHA-256 of the checkbox's text, trimmed, white
  space collapsed (`scripts/proof-change.mjs`, `criterionId`). The nine were computed again here from the live body and
  match the IDs this job was given.
- The Oracle page and cases (`doneright/oracles/issues/971.md`, `cases/971.json`, DeepBuildAI/deepbuild, branch
  `doneright`).
- `docs/canvas-primitives.md`: Look `look@1`; Look `look@1`: tone mapping (the `local` row is there at the base), grade,
  bloom and deband; The status-color rule; Status guard; Determinism class; Material; Instance `instance@1`.
- `docs/technical-design.md`: Look; Samples, grade, bloom and lens; Films and figures on the canvas; Every task carries
  its own budgets; Load; Dogfooding; Tests written first; What done means, fixed at the start. `docs/parallel-proof.md`,
  sections 6 and 12a (the throttle, budget windows).
- At the base, for surfaces and conventions only: AGENTS.md; `crates/deep-gpu-layer/src/main.rs` (the call table,
  `Planted`, `Planted::parse`), `view3d.rs`, `view3d/parse.rs` and `view3d/history.rs` (the call's fields, its targets,
  `from`, `seeks`, `timings`, each frame's `pixel_hash`); `crates/deep-canvas-scene3d/src/look.rs` (`Look3::read`),
  `light.rs` and `scene.rs` (`material@1`'s emission, `instance@1`); `crates/deep-canvas-marks/src/finish.rs`
  (`read_tone_map`, `read_grade`, `exposure_scale`, the finish's order and luminance weights);
  `crates/deep-scene3d-render/src/output.wgsl`; `crates/deep-canvas-loop/src/exposure.rs` (middle grey);
  `scripts/proof-change.mjs`, `proof-runs.mjs`, `lanes.mjs`, `benchmark.mjs`, `budget-window.mjs`, `loads-lint.mjs`,
  `public-text.mjs`; `benchmarks/budgets.json`, `benchmarks/canvas.mjs`; and the suites `tests/acceptance/418/`,
  `382/`, `465/`, `468/`, `484/`, `449/`, `508/`, `177/`, `968/` and `968-redraft-1830/` for their structure and
  helpers. #418's helpers are imported for what is #418's and #382's: the look, the film with a status binding, the
  status report's readers, the PNG reader, OKLab and the JSON readers.

## What the base already does, which these tests don't credit

`view3d` draws scene3d documents through the output pass: exposure, the white balance, the tone curve (none, filmic,
agx, neutral), the CDL, the encode and the deband, then #382's status marks and legend. It has `from` (a session opened
at a frame), `seeks`, `capture`, `timings` (`gpu_ms`), each frame's `pixel_hash`, and the targets `final` and
`pre_tone`. `Look3::read` reads no `local`: a look that carries one is accepted and the field is ignored, so at the base
every frame drawn with `local` is, byte for byte, the frame drawn without it. A criterion that says something stays the
same (AC1, AC3's first clause, AC4, AC5, AC6's first clause, AC7) would therefore pass on a program that does nothing.
Each such test holds, before its criterion's own assertion, that `local` at the criterion's setting changed the frame,
and fails at the base on that guard. There is no `pre_curve` target, neither planted name, no `canvas-local-tone-map`
task. `BASE-FAILURE.txt` holds what each test meets at the base.

## Run them

```sh
export PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
npm ci                                   # once, if node_modules is missing
node scripts/throttle.mjs build --wait 90 -- cargo build --locked --bin deep-gpu   # so each file's own build is a no-op
node scripts/throttle.mjs test --wait 90 -- node node_modules/vitest/vitest.mjs run --root tests/acceptance/971 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/971/tsconfig.json   # type-check (exits 0)
rm -rf tests/acceptance/971/node_modules/.vite
```

Each file builds `deep-gpu` once in `beforeAll` (`cargo build --locked --bin deep-gpu`, with `CARGO_INCREMENTAL=0` and
`CARGO_PROFILE_DEV_DEBUG=0` unless set, `/opt/homebrew/opt/rustup/bin` added to PATH where it exists) and copies the
binary out of `target/` (`CARGO_TARGET_DIR` honoured); a test that uses a build that failed fails with cargo's error,
and with `BLOCKED:` on a machine with no cargo. So the files run one at a time: **`scripts/lanes.mjs` needs the two
lines under "What the implementer adds outside this folder"; this README is the instruction, and the implementer makes
those edits.** Each test writes into its own temporary folder and deletes it; `ac6-sizes.test.ts` holds about 0.3 GB
in memory. Imports: Node built-ins, vitest and `../418/helpers.ts`; the lane's judge and validator run as
`scripts/benchmark.mjs` in a child process.

- Everything draws on macOS's Metal device: off macOS a test fails with a message starting `INCONCLUSIVE:`, never
  passing, as does an `unsupported_platform` answer.
- **The budgets** (`budgets.test.ts`) count only on a reference Mac (as the lane's `judgeLimit` reads the fingerprint)
  on mains power, Low Power Mode off, thermal state nominal, with the load at each run's start and end at most the core
  count; anywhere else each timing test fails `INCONCLUSIVE:` before it times anything. The budgets.json entry is
  checked anywhere. The issue's verdict is the scheduled budget window's at the merged commit, so the PR says
  `Part of #971` until that window closes the issue; this file judges a local run, as #968's suite does.
- `taste.test.ts` writes its three pictures to `docs/evidence/971/` and reads `tests/acceptance/971/TASTE.json`; without
  a recorded call on exactly those bytes it fails `INCONCLUSIVE:` (The taste call, below).

## The surface under test

**No new binary and no new call.** #377's `deep-gpu run [--planted <name>]` with its JSON-lines protocol unchanged
(`{"out", "calls"}` in, `{"ok", "replies"}` out; a reply with a `code` is a refusal) and #378's `view3d` for every
frame. Names the issue and the design give are used as they give them; the rest are this suite's choices, marked
**bold**, each the least a criterion needs.

### The look: `local`

A `look@1` object takes the design's field beside `tone_map`, as the design writes it:

```json
"local": {"strength": 0.5, "detail": 1, "sigma": 0.9, "levels": 6}
```

A field left out takes the Fields row's default (`strength` 0, `detail` 1, `sigma` 0.9, `levels` 6), so the tests write
`{"strength": 0.5}`, `{"strength": 0, "detail": 1}` and `{"strength": 1, "detail": 2}`. **A look with no `local` key has
none** ("the same scene without `local`"). No test sends `"local": "none"`, `sigma` or `levels`.

### `view3d`: one target

`{"call": "view3d", "doc", "look", "size", "frames"?, "fps"?, "from"?, "seeks"?, "capture"?, "targets"?, "timings"?,
"states"?}` as the base has it; read: each frame's `frame`, `pixel_hash`, `final` (PNG by SHA-256), `pre_tone` (#418's:
f32 RGBA by SHA-256, the linear image the tone-mapping pass reads, before exposure), `gpu_ms` (with `timings: true`)
and the reply's `status`. Added:

- **Target `pre_curve`**: with `"pre_curve"` in `targets`, each captured frame's row carries `"pre_curve": "<sha256>"`,
  the name of a file `<sha256>.f32` under `out`, laid out as `pre_tone` is: little-endian f32, four a pixel (R, G, B,
  A), rows top-down, `w × h × 16` bytes. Its R, G and B at each pixel are **the linear values the tone curve reads
  there**: `pre_tone` after the exposure, the grade's white balance and the look's `local`, before the tone curve, the
  CDL, the encode and the deband; not clamped, at the precision the frame holds them (a 16-bit float target is enough).
  A is `pre_tone`'s. With no `local` and the grade at identity it is `pre_tone` times the exposure scale. It is the same
  image whatever the look's `tone_map`. Criteria 2, 3 and 4 read it, always with `local` set; the suite reads the frame
  without `local` from `pre_tone`, at an exposure scale of 1.

Nothing else is added: no request field, no reply field, no per-pass time (the budget reads `gpu_ms`).

### Planted programs (`deep-gpu run --planted <name>`, each reachable only there; `twins.json` maps each criterion to its name)

| Name | The wrong program | Criterion |
|---|---|---|
| **`local_base_ignores_edges`** | The base is brought back up with no regard to the guide: every tap of the joint bilateral upsample takes a range weight of 1, at every level, so the base is a plain blur of the pyramid across edges. Everything else as shipped | AC3 `#971.fc809ae0` (issue-named: "a planted base blurred without regard to edges") |
| **`local_pyramid_fixed_levels`** | The pyramid's level count doesn't follow the output size: at every size it builds the levels the shipped program builds at 1920 × 1080 for the look's `levels`, so at 3840 × 2160 its coarsest texels cover half the share of the frame's width and height that the shipped program's do. Everything else as shipped | AC6 `#971.a3ad5af8` (issue-named: "a planted pyramid with fixed level sizes") |

The implementer adds both names to `enum Planted` and `Planted::parse` in `crates/deep-gpu-layer/src/main.rs`. No other
criterion gets a plant: with its guard, each fails on a program that does nothing, and AC5 on one that keeps a history.

### What the implementer adds outside this folder

`scripts/lanes.mjs`, beside the other suites' lines of this form:

```js
// #971's files build deep-gpu and draw on the Metal GPU; budgets.test.ts judges the local tone map's added GPU time on
// the reference Mac.
alone.push('tests/acceptance/971/');
timed.push('tests/acceptance/971/budgets.test.ts');
```

`benchmarks/budgets.json`, one task (AC8 checks every field but `limits` and the wording of `initialReason`, which must
name #971):

```json
{
  "id": "canvas-local-tone-map",
  "command": ["node", "benchmarks/canvas.mjs", "local-tone-map"],
  "margin": 0.5,
  "limits": {},
  "targets": {"local_1080p_gpu_ms": 0.6, "local_2160p_gpu_ms": 2},
  "initialReason": "Issue #971 first measurement: the merge base has no local tone map and no such task. …",
  "criteria": ["#971.ae60e422"]
}
```

It must pass `validateBudgets` against the merge base's file, so it is a new task and no existing one changes. The
`local-tone-map` mode of `benchmarks/canvas.mjs` and its `judge` row are the implementer's, as the lane needs them:
what `local: {strength: 0.5}` adds to the median GPU time of a frame at 1920 × 1080 and at 3840 × 2160, against the
same frames without `local`.

## The fixtures (`helpers.ts`)

Every fixture but the film is seen face on by an orthographic camera 30 m across the frame, so a 1920 × 1080 frame has
64 px a metre and every part sits on whole pixels there and at 3840 × 2160. Every part is a `mark.box@1` (the walls'
cells an `instance@1` of two boxes) whose `material@1` has a black base colour and an `emission`, under a `sky@1` with
no light and no sun, so a pixel's linear value is its nearest part's emission, which may pass 1. The look is #418's
physical look (`helpers.ts` `lookWith`): the clean status map, exposure at EV100 −log₂ 1.2, whose scale is 1,
`finish: []`, `deband: none`, `bloom: none`, `ao: none`; tests change `tone_map` and `local` only.

**How a part reaches its level.** Middle grey is linear 0.18 after exposure: the grey the design's curves pivot on and
the base's `render.exposure` reads a key against. Luminance is Rec. 709's (0.2126 R + 0.7152 G + 0.0722 B) of linear
RGB, as the base's finish and `render.exposure` weigh it. A part `s` stops from middle grey emits a colour whose
luminance is 0.18 × 2^s; the exposure scale is 1, so that is what the finish reads. The walls are grey, so any weights
that sum to 1 read them the same.

| Fixture | What it is | Criteria |
|---|---|---|
| The two walls (`wallsDoc`) | 1920 × 1080. Left of x = 960 a wall 4 stops above middle grey (linear 2.88), right of it one 4 stops below (0.01125), meeting at that vertical edge. Each is a checker of 8 px cells, the cells whose column and row sum is even 0.25 stop above the wall's level and the others 0.25 below (3.4249 and 2.4217; 0.013379 and 0.0094600). All grey | 1, 2, 3, 9 |
| The coloured patches (`patchesDoc`) | 1920 × 1080: 8 × 8 patches of 240 × 135 px. Row r is a hue (red, orange, yellow, green, cyan, blue, violet, magenta), column c mod 4 a saturation (white mixed 55%, 70%, 85%, 100% toward the hue, in linear RGB). Every patch of the left four columns has a luminance 3 stops above middle grey (1.44), every patch of the right four 3 stops below (0.0225) | 1, 4 |
| The temple (`templeDoc`) | 1920 × 1080, a front elevation: a sky 2.5 stops above; a sunlit front about 4 stops above (ground, three steps, six columns 96 px wide with flutes 0.3 stop apart, an entablature, a pediment); the shade under the colonnade about 4 stops below (the wall behind the columns in courses 0.3 stop apart, a doorway 6 stops below, two plaques, two lamps' glows in ten steps of 0.3 stop). Sun and shade are eight stops apart. The frieze alternates shaded metopes and sunlit triglyphs 64 px wide, starting 32 px off the frame's 64 px grid. With `cloud`, a cloud 1920 px wide slides in behind the pediment at 128 px a second for 15 s, so the frame changes at every frame until then | 1, 5, 6, 8, 9 |
| The film (`../418/helpers.ts` `film`, `binding: true`) | #382's film, 480 × 360: three boxes on a floor under a sun, the lamp's badge bound to a verdict in state fail | 1, 7 |

The fixtures were drawn once on the base's renderer apart from the suite (`BASE-FAILURE.txt`): every pixel of the walls
within 0.0012 stop of its level, the sampled patch pixels within 0.08% of their colours, and the temple at 3840 × 2160
downsampled equal to the temple at 1920 × 1080 at every pixel.

## Criteria to tests

| Criterion | File (tests) | What it asserts |
|---|---|---|
| AC1 `#971.09d7d9af` | `ac1-identity.test.ts` (4, one a fixture) | Under none, filmic, agx and neutral: `local: {strength: 0, detail: 1}` has the pixel hash of the same scene with no `local`. Guard: `local: {strength: 0.5}` has another |
| AC2 `#971.5cd62ea3` | `ac2-walls.test.ts` (1) | The walls under tone map none. The fixture as drawn (`pre_tone`): walls at +4 and −4 stops within 0.01, checkers ±0.25 within 0.005. With `local: {strength: 0.5}`: another pixel hash; from `pre_curve`, each wall's mean log2 luminance 64 px or more from the edge at +2 and −2 stops within 0.1, each checker's amplitude ±0.25 stop within 0.02 |
| AC3 `#971.fc809ae0` | `ac3-edge.test.ts` (2) | The same walls and look. Guards: another pixel hash than without `local`; the walls at +2 and −2 within 0.1. Then no pixel within 32 px of the edge passes its wall's own level by more than 0.05 stop. `--planted local_base_ignores_edges`: the same check fails, its failure naming `the edge at x = 960` and the bright wall's overshoot in stops |
| AC4 `#971.0e27b835` | `ac4-colour.test.ts` (1) | The patches under tone map none. One seeded pixel in each of the 64 patches. Guards: another pixel hash than without `local`; every sampled pixel's luminance moved by more than 1 stop. Then, the luminance change divided out, OKLab hue under 1° and chroma under 1% from the render without `local` |
| AC5 `#971.8fcd3c09` | `ac5-seek.test.ts` (1) | The temple with its cloud, 960 × 540, 30 fps, filmic, `local: {strength: 0.5}`. Guards: frame 360 with `local` is not frame 360 without; frame 360 is not frame 0, 359 or 390, and 150 is not 149. Then frame 360 reached by a seek from 13 s, frame 360 drawn alone and frame 150 drawn alone have the hashes they have in the sequence played from 0 |
| AC6 `#971.a3ad5af8` | `ac6-sizes.test.ts` (2) | The temple under filmic. The fixture agrees across sizes without `local`. Guard: at 1080p `local: {strength: 0.5}` moves more than 1% of pixels by more than 0.02 in OKLab. Then the 3840 × 2160 render, downsampled 2 × 2, is within 0.02 in OKLab of the 1920 × 1080 render at 99% of pixels. `--planted local_pyramid_fixed_levels`: the same check fails, its failure starting with the share of pixels off |
| AC7 `#971.f19031be` | `ac7-status.test.ts` (1) | The film under none, filmic, agx and neutral: exact without `local`. Guard: `local: {strength: 1, detail: 2}` draws another frame. Then the fail mark and the legend's fail swatch draw the fail color exactly |
| AC8 `#971.ae60e422` | `budgets.test.ts` (3) | The `canvas-local-tone-map` task and the lane's validator against the merge base. At 1920 × 1080 and at 3840 × 2160: the two sides draw different pixels; then what `local: {strength: 0.5}` adds to the median `gpu_ms` over 300 frames, five runs after a warm-up, judged by `judgeLimit` with each run's load against 0.6 ms and 2 ms |
| AC9 `#971.573c2449` | `taste.test.ts` (1) | See The taste call |

Proof line: the walls' measured levels, checker amplitudes and worst overshoot, the planted blur's overshoot, the
colour samples' worst hue and chroma differences, the share of pixels off across sizes and each timing are printed by
the tests as log lines; the seek and sequence hashes are in the failure messages when they differ.

## Readings where the issue and design leave a choice

1. **Middle grey and luminance**: above (How a part reaches its level). A level is log2 of a pixel's luminance over
   0.18, in stops.
2. **The walls' frame** is 1920 × 1080, where the design's defaults are stated (a pyramid down to 1/64 of the frame is
   64 px a texel there, the distance the criterion measures from). The edge is the frame's centre line.
3. **"Rendered with no tone curve"** is `tone_map: none`. The levels are read before that map's clip, from
   `pre_curve`, so an overshoot past linear 1 is read whole.
4. **"Measured at least 64 px from the edge"** is every pixel of the wall whose centre is 64 px or more from x = 960,
   over the frame's full height: columns 0 to 895 and 1024 to 1919. The mean is of log2 luminance over those pixels.
5. **"Each checker's amplitude"** is half the difference between the mean level of its higher cells and that of its
   lower cells, over the same pixels. It is a property of the pattern, not of each pixel.
6. **"Within 32 px of the edge"** is every pixel whose centre is within 32 px of x = 960: columns 928 to 991. **"Its
   wall's own level"** is the mean level, 64 px or more from the edge in the same frame, of that wall's cells of the
   pixel's own checker phase; a pixel on a checker has no single wall level. **"Passes … by more than 0.05 stop"** is
   one-sided, as an overshoot is: brighter than that level on the bright wall, darker than it on the dark wall.
7. **"About 1 stop"** has no tolerance in the issue. The planted test asserts that the check fails on the bright wall,
   with the edge and the overshoot named, and prints the overshoot; it holds it to no band.
8. **AC4's 64 pixels** are one per patch at a seeded place. **"After the luminance change is divided out"**: the
   `local` render's linear colour is scaled by the ratio of the two Rec. 709 luminances, then both go to OKLab. Hue is
   atan2(b, a) and chroma the length of (a, b). **"1%"** is of the chroma without `local`. Both are read where the
   tone curve reads, since a curve applied per channel moves hue by itself when luminance moves.
9. **The `local` setting where a criterion names none** (AC5, AC6, AC8, and AC1's guard) is the one the issue gives
   for a working frame, `{strength: 0.5}`, every other field at its default.
10. **AC5.** "Seeking to 12 s" is a session opened at 13 s that jumps to 12 s (`seeks`), as the base's determinism
    check seeks. "Rendered alone" is a session opened at that frame that draws only it (`from`, `frames: 1`). "In a
    sequence" is the sequence played from frame 0. Frames are at 30 fps, so 12 s is frame 360.
11. **AC6.** "Render" is the final PNG under the fixture's look, filmic. The box filter averages each 2 × 2 block in
    linear light. "Within 0.02 in OKLab" is the distance between the two colours (ΔE). "At 99% of pixels" is at least
    99% of the 2,073,600 pixels within it.
12. **AC7.** "Exact" is #418's reading for "status colors still exact": the fail mark reports the look's fail color,
    the most common pixel inside its bounds is that color, and so is the legend's fail swatch. The fixture is #382's
    film with one binding in state fail, under each tone map.
13. **AC8.** "`local` adds" is the difference of the two sides' median `gpu_ms` over 300 frames of the temple, with
    `local: {strength: 0.5}` and without, a negative difference reading 0, as #968's suite reads "adds".

## Not asserted, because no criterion says so

The implementer owes these a mapping or a note (AGENTS.md: review requirement → change → proof):

- The field's bounds and refusals: `strength` outside 0..1, `detail` outside 0..2, `levels` above 7, a bad `sigma`, an
  unknown key; `local: "none"` written out; `local` on a look that isn't physical.
- `detail` off 1: AC7 sets 2 only as the setting under which status colors stay exact, and no criterion measures a
  detail scaled. `sigma` and `levels` off their defaults.
- The base's construction: the pyramid's filter, its size at sizes other than 1920 × 1080 and 3840 × 2160, the
  upsample's taps. The criteria hold its results on these fixtures.
- Where `local` sits against the grade's white balance, and against bloom and the effects chain, beyond "after exposure
  and before the tone curve". Every look here has the grade at identity and no bloom.
- The size of the planted blur's overshoot (reading 7), and the planted pyramid's share of pixels off beyond its
  failing.
- "Shift hue or saturation" on the final picture after a tone curve; a horizontal or slanted edge; an edge off the
  frame's centre; seeks at other times.
- The design's cost line and the determinism class of the new passes; the Scope's "Not in this task" list (eye
  adaptation, exposure fusion, HDR output, LUT images, which stay refused); the new subsection in
  `docs/canvas-primitives.md`.

## Out of a test's reach, and one early question

- **AC8's "measured in the scheduled budget window … at the merged commit against its merge base" and "the PR says
  `Part of #971`"** are the window's and the PR's. This suite checks that the task the window runs exists with the
  issue's numbers and judges a local run.
- **AC9's "attached to the PR and shown to you in the session"** can't be seen by a test; it holds INCONCLUSIVE until
  the call on the run's own bytes is recorded.
- **One early question for the owner: what does "about 1 stop" bound?** By the issue's rule an edge-blind base that
  mixes a quarter of the far wall into the pixel beside the edge overshoots by 1 stop, and one that mixes half by 2. No
  check holds the planted overshoot to a band until the issue gives one.

## The taste call

`taste.test.ts` writes, from this run's own frames at 1920 × 1080, each the renderer's final PNG byte for byte:
`temple-local.png` (the temple under filmic with `local: {strength: 0.5}`), `temple-plain.png` (the same without
`local`) and `walls-edge.png` (the two walls under tone map none with `local: {strength: 0.5}`), all in
`docs/evidence/971/`, printing each SHA-256. Where the temple's two pictures are the same bytes it fails before it
writes anything. Show them to the owner in the session and attach them to the PR; record the one answer in
`tests/acceptance/971/TASTE.json` (this job writes none and creates no picture, so the test stays INCONCLUSIVE until
then):

```json
{"issue": 971, "criterion": "#971.573c2449", "verdict": "looks_right" | "looks_wrong", "who": "…", "when": "<ISO 8601>",
 "screenshots": {"temple-local.png": "<sha256>", "temple-plain.png": "<sha256>", "walls-edge.png": "<sha256>"}, "note": "…"}
```

No call, or one made on other bytes, is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these passes. No
other test reads a picture to judge it.

## The oracle page

Read. It pins no upstream source and no test: all nine criteria are DeepBuild's own (identity, the base compressed
toward middle grey with the detail kept, no halo past 0.05 stop, colour kept in ratio to luminance, no history, levels
that follow the output size, status colors exact, the budget, the taste call). Nothing is ported.

| Row | Status |
|---|---|
| Criteria 1–9 | No upstream test, as the page says |
