# Acceptance tests for #468: lens and focus: a camera lens, depth of field, focus pulls and 3D lines anchored to parts

Written first, blind, from issue #468 (its Scope, its Fields, its eight acceptance criteria, its Proof line "The dof
occlusion fixture, the lens's closed forms, a focus pull by seeking and by playing, and the task's timings", its Depends
on list and its one comment), the design sections it names and those they lean on, and the base: this worktree's HEAD
`eb2822a36` (the merge of #2526, a hub-only change, over `a50d92323`), by a job that never saw an implementation; none
existed, and no other worktree, branch, PR or stash was read. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, live (`gh issue view 468 --repo windoliver/deepbuild`). Eight criteria: seven functional and the "Shown to
  you" taste call (AC8). Each test's name starts `AC<n> #468.<id>`, the first 8 hex digits of SHA-256 of the checkbox's
  text, trimmed, white space collapsed (`scripts/proof-change.mjs`, `criterionId`); the eight were computed again here
  and match the IDs this job was given.
- The Oracle page: `doneright/oracles/issues/468.md` and `cases/468.json` (DeepBuildAI/deepbuild, branch `doneright`)
  don't exist (404), so nothing is ported.
- `docs/canvas-primitives.md`: Effect; Effect: dof; Effect: flare (the effect item's shape); Camera `camera@1`, its lens,
  framing and Shot sections; Marks in 3D and Marks in 3D: lines (`ID[#anchor]` points); Overlay (its `anchor`, `leader`
  and `hide: off_frame`) and Overlay: clamped to the edge; Labels; Item and kind (`at.pivot`, the transform order);
  Builder (`anchors`); Body (`anchors: {name → local point}`); Paint: drop; Paint: glow, bevel and satin; Channel and
  key; Export and Export: glTF (the receipt's `warnings: [{item, what}]`); The cost model and its class table.
- `docs/technical-design.md`: Films and figures on the canvas; Effect; Dogfooding; Every task carries its own budgets;
  The reference Macs; Load; taste calls.
- At the base, for surfaces and conventions only: AGENTS.md; `crates/deep-gpu-layer/src/{main,view3d,film,
  op_transition,paintfx}.rs` (the call table, `view3d`'s fields, targets and per-frame report, `evaluate`, `timings`'
  `passes_ms` and `declared_ms`, `--planted`); `crates/deep-canvas/src/camera.rs` (Spec, Rig, Pose, Projector);
  `crates/deep-canvas-scene3d/src/{flare,label,trail,slots,scene}.rs`; `crates/deep-canvas-motion/src/shots.rs`;
  `crates/deep-motion/src/main.rs`; `crates/deep-canvas-loop/src/framing.rs` (camera.framing); `crates/deep-show/src/
  {main,time,export,scene3d}.rs`; `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`, `validateBudgets`),
  `scripts/lanes.mjs`, `scripts/lease`, `benchmarks/budgets.json`; and the sibling suites `tests/acceptance/466`, `467`,
  `465`, `419`, `421` to `424`, `1938`, `1637`, `429`, `382`, `493` for their conventions and helpers. #467's helpers
  (its 2D documents, look and `film2d` call) and #1938's (deep-show's build, scenario, claims and `verdict`) are imported
  as they are; #466's mosaic test pack is read from its fixtures folder.

## What the base already does, which these tests don't credit

The core's camera already takes `view_width` with `fov` (the distance follows; `fov: 0` is the orthographic view) and a
`shift` as a fraction of the view (`deep-canvas/src/camera.rs`), so AC4's flat board may already project right at the
base; the base reports no projection, so the test can't see it. `view3d` draws scene3d documents with `from` (a cold
seek), `capture`, `targets` `final` and `pre_tone`, `pixel_hash`, `timings` (`gpu_ms`, `passes_ms`, `declared_ms`) and
#429's `evaluate` (`values`). The effect item draws kind flare only. #466's operator transitions run their pass on the
CPU reference interpreter. #467's drop, glow, bevel and satin draw in `film2d`. camera.framing (#1938) reads cut, fill
and horizon. deep-show's `export` writes the video, png, lottie and pdf targets; a document must be presented first.
`overlay.text@1` draws as a top-left readout; `mark.line@1` points are numbers; a trail reads `ID#anchor` as the item's
origin. No lens, no dof, no anchor names, no leader, no `verticals_max`, no gltf target exists.

## Run

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:/opt/homebrew/opt/rustup/bin:$PATH"
npm ci                                   # once, if node_modules is missing
export NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
node node_modules/vitest/vitest.mjs run --root tests/acceptance/468 --no-file-parallelism --testTimeout=600000 <file>
node node_modules/typescript/bin/tsc -p tests/acceptance/468/tsconfig.json   # type-check (exits 0)
rm -rf tests/acceptance/468/node_modules/.vite
```

Run the files one at a time. Each builds what it drives once, in `beforeAll` (up to 7,200,000 ms), and copies it out of
`target/` (`CARGO_TARGET_DIR` honoured): `cargo build --locked --bin deep-gpu` (every file but the taste test), and
`ac7-shift.test.ts` also `cargo build --locked --bin deep-show --no-default-features --features full` (#1938's build).
So `scripts/lanes.mjs` needs `'tests/acceptance/468/'` in its `alone` list, and `'tests/acceptance/468/ac5-budgets.test.ts'`
in `timed` (the local preflight's perf step; AC5 checks that entry). This job writes only this folder; the implementer
makes those edits. Everything draws on macOS's Metal device: off macOS a test fails with a message starting
`INCONCLUSIVE:`, never passing, as does an `unsupported_platform` answer. Each test writes into temporary folders it
deletes. `BASE-FAILURE.txt` holds each file's run on the base.

## The surface under test

No new binary or call: #377's `deep-gpu run [--planted <name>]` (`view3d`, `film2d`) and `deep-show run` (#1938's
stored documents, claims and `verdict`; #493's `deep show` and #501's `export`). Names the issue and the design give are
used as they give them; every other name is this job's choice, listed here, the least each criterion needs.

### Documents (helpers.ts)

Scene documents as #378's and #465's suites write them: one writer layer `main`, camera `cam`, `safe: 24`,
`requires.modules: {scene3d, effects}`, items keyed by ID, f32 channels with linear keys on item paths. The look is a
physical one with tone map none at the exposure whose scale is 1, no bloom and no finish (`PLAIN_LOOK`).

| Field | As the tests write it | From |
|---|---|---|
| The lens | `camera@1` params `lens: {focal_length, sensor, fit, shift}`, `aperture: {f_stop, blades}`, `shutter: {angle}`, `iso`, `exposure: "from_lens"`, and no `fov` | the issue's Fields |
| Depth of field | `{kind: "effect@1", params: {kind: "dof", dof: {focus, coc: "physical", max_coc, taps: 64, rotate: "pixel_hash", far_over_near: "refuse", projection?, ortho_coc?, band?}}}` | the issue's Fields; the item's shape as #465's flare *(chosen)* |
| A focus pull | `channels.pull = {target: "items/fx/params/dof/focus", type: "f32", keys: {k0: {t: "0.5s", value: "A"}, k1: {t: "1.3s", value: "B"}}}`, no `interp` (in_out_cubic) | design; `type` *(chosen)* |
| A named anchor | `params.anchors: {hinge: [x, y, z]}` on the lid (Assumed surface 5) | *(chosen)* |
| The label | `overlay.text@1` params `{anchor: "right", role: "caption", template, size, leader: {to: "lid#hinge", line: "ink", width: 1.5, dash: false, end: "dot", elbow: "none", gap: 4}, hide: "off_frame"}` | Overlay; `anchor: "right"` for "the right edge" *(chosen)* |
| The wire | `mark.line@1` params `{points: [[x, y, z], "lid#hinge"], width, paint}` | Marks in 3D: lines |
| A one-pixel emissive point | `ball@1` of radius 0.5 px at its depth, centred on a pixel centre, material `{base_color: black, emission: white, emission_strength: 50}` | *(chosen)*; checked to draw one pixel of 50 |
| The framing check | `{kind: "camera.framing", keep: ["tower"], verticals_max: 0.5}` | the issue's Scope |
| The glTF export | deep-show `export` `{doc, out, video: {codec: "gltf"}, range: {still: {t: 0}}}` → `{outcome: "exported", receipt: {warnings: [{item, what}]}}` | Export (a codec naming its target), Export: glTF |

### Assumed surfaces

Where the base has no call that exposes a value a criterion needs:

1. **`view3d`'s `evaluate` (#429) on derived values.** Each frame's `values[path]` is the evaluated value at t of:
   `items/<camera>/params/fov` → the field of view the lens derives, in degrees across the frame's wider side;
   `items/<camera>/params/exposure` → the EV100 that `from_lens` works out; `items/<effect>/params/dof/focus` → the focus
   distance in m (a key naming an item evaluated to its distance); `items/<line>/params/points` → the line's points in
   world m, an `ID#anchor` entry as that anchor's world point (AC2, AC3, AC4).
2. **`view3d` target `coc`.** `targets: ["coc"]` adds to each captured frame `coc`: the SHA-256 of a file
   `<sha256>.f32` under `out`, little-endian f32, one a pixel, rows top-down, `w × h × 4` bytes (as `depth` is written):
   each pixel's signed circle of confusion in frame px, its diameter (AC1's tilt band).
3. **`view3d`'s `project`.** `project: [[x, y, z], …]` (world m) adds to each frame `projected: [[x, y] | null, …]`, one
   per point in order, in frame px (f64; (0, 0) the top-left corner, pixel (i, j)'s centre at (i + 0.5, j + 0.5)),
   through the camera that frame draws (its lens, shift, fov and view width at t); null at or behind the eye (AC4, AC7).
4. **`view3d`'s `overlays`.** `overlays: true` adds to each frame `overlays: {<item ID>: {shown: bool, leader: {from:
   [x, y], to: [x, y]} | null}}`, frame px; `to` is the leader's end at its target (AC3).
5. **Named anchors.** An item's `params.anchors: {<name>: [x, y, z]}` (local m, as `body@1`'s `anchors`); `ID#name`
   reads that point at t through the item's evaluated transform, in a line's points and a leader's `to` (AC3).
6. **`film2d`'s `fills`.** Each frame adds `fills`: the number of fills and glyph runs its 2D marks encode (AC5).
7. **An operator transition's pass in `passes_ms` and `declared_ms`.** With `timings: true`, each frame whose operator
   transition's pass runs carries its measured time in `passes_ms` and its declared cost at the frame's size in
   `declared_ms`, both under the key `transition/<transition ID>` (AC5).

### Planted programs

| Name | Where | Criterion | The wrong program |
|---|---|---|---|
| `coc_linear_in_distance` | `deep-gpu run --planted` | AC6 (named) | the circle of confusion is k·\|d − s\|, k set so it equals the physical one at 10 m (the 4 m disc about 4.9 px across); everything else as shipped |
| `gltf_drops_shift` | `deep-show run` scenario `planted` | AC7 (named) | the glTF exporter drops the lens shift and lists no warning for it; the export still succeeds |

The implementer adds both names where the binaries read their planted programs (`Planted::parse` in
`crates/deep-gpu-layer/src/main.rs`; deep-show's planted match), reachable only there. AC7's "planted twin that pitches
the camera 12°" is a document, not a program.

### The perf lane (AC5)

`benchmarks/budgets.json` gains a task whose `criteria` list `#468.43d77df2` (or whose `initialReason` names #468), with
a command, passing the lane's `validateBudgets` against the merge base's file; `scripts/lanes.mjs` lists
`tests/acceptance/468/ac5-budgets.test.ts` in `timed`. The task's targets and command are the implementer's.

## Criteria to tests

| Criterion | File (tests) | What it asserts |
|---|---|---|
| AC1 `#468.01baeaa5` | `ac1-occlusion.test.ts` (2) | A 2 m grey plate in focus before a radiance-10 wall at 10 m (f/2): every plate pixel 2.5 px inside its edge at most 0.01 above the no-dof frame in `pre_tone`, while the wall's edge spreads at least 0.5 into the sky. Orthographic, `ortho_coc: 4`: points 2 m before and 3 m behind the focus plane 8 ± 1 and 12 ± 1 px across, the one on it under 2 px. Tilt band centred on row 320: every `coc` there under 0.5 px; rows 20 and 620 at a median of at least 2 px |
| AC2 `#468.75d393c7` | `ac2-lens.test.ts` (2) | Five lenses' fov equal 2·atan(side ÷ 2f) of the fitted side within 1e-6°; three exposures (defaults f/5.6, 180°, ISO 100 at 24 fps; f/2.8, 90°, ISO 800 at 30 fps; f/11, 270°, ISO 50 at 60 fps) equal log2(N² ÷ t) − log2(ISO ÷ 100) within 1e-6 |
| AC3 `#468.632af807` | `ac3-leader.test.ts` (1) | 200 seeded frames of 481 (120 fps, 4 s), played and cold-seeked: the label shown exactly while lid#hinge projects inside the safe frame (at least 20 of each), the leader's end within 0.5 px of that projection, the wire's anchored point within 1e-6 m of the hinge, the same `pixel_hash` seeked as played |
| AC4 `#468.7ecff161` | `ac4-focus-pull.test.ts` (2) | Frames 30 to 78 (0.5 to 1.3 s), played and seeked: focus within 1e-6 m of (1 − e)·dA(t) + e·dB(t), e in_out_cubic. View width 20 m: at 0° each of 75 points where the 20 m orthographic view puts it within 1.92e-6 px; (±10, 0, 0) 1920 px apart within 1e-9 relative at every frame of 0° to 40°; at 40° every point within 0.01 px of the pinhole 27.47 m out; from 0° to 0.01° no point moves over 0.5 px |
| AC5 `#468.43d77df2` | `ac5-budgets.test.ts` (2) | Five runs after a warm-up, by the lane's `judgeLimit` with loads: dof with 64 taps adds under 0.8 ms at 1080p; glow, bevel, satin each add under 0.15 ms an item (8 sliding texts); the mosaic transition's measured ÷ declared at most 1 and its worst frame within the figure class's 2 ms; INCONCLUSIVE off a reference Mac at rest. A drop adds exactly one `fills`, on a text and on a rect; the budgets.json task and the `timed` entry |
| AC6 `#468.1d583371` | `ac6-bokeh.test.ts` (2) | 50 mm, f/2.8, 1920 wide, focus 2 m: the 10 m point 19.5 ± 1 px across, the 4 m point 12.2 ± 1, each within 2% of its in-focus energy; at blades 6 the 10 m disc's centre-to-edge within 1 px of cos 30° × its centre-to-corner. `coc_linear_in_distance` fails, naming `point_4m` |
| AC7 `#468.af788480` | `ac7-shift.test.ts` (2) | Through `project`: the tower's four vertical edges within 0.05° of vertical, its eight corners within 0.5 px of the shifted pinhole and inside the frame. Through `verdict`: the shifted camera PASSes `verticals_max: 0.5` with nothing raised; the twin pitched 12° FAILs with a camera.framing issue naming `tower` and an angle (1.08°, 1.32° or 12°). The glTF export's receipt warns `{item: "cam"}` of the shift; under `gltf_drops_shift` it exports without, and the check fails naming cam |
| AC8 `#468.ce8ac7ee` | `taste.test.ts` (1) | Reads the record only; no pictures, or no call on exactly them, is INCONCLUSIVE, never PASS (The taste call) |

## Readings where the issue is open

1. **The field of view** is the core camera's: degrees across the frame's wider side. Each AC2 fixture lets the fitted
   sensor side span the frame's wider side (a portrait frame for `fit: vertical`), so the closed form applies as written.
   "To 1e-6" is absolute, in degrees and in EV.
2. **The frame rate** in t = angle ÷ (360 × frame rate) is the document's `transport.frame_rate`; the call's `fps` is
   the same.
3. **"A one-pixel emissive point of linear radiance 50"** is an emissive ball half a pixel in radius at its depth on a
   pixel centre; the test checks that its in-focus frame holds one pixel of 50 (within 5%, and 95% of its energy), as it
   does on the base's renderer with the equivalent fov (BASE-FAILURE.txt).
4. **A disc's width across** is 2·√(A ÷ π) of the pixels at or above half its level (the mean within 0.4 of its
   second-moment radius); its energy is summed within 24 px and held to the in-focus frame's. **The hexagon's**
   centre-to-corner is the mean reach of the six rays 60° apart that reach furthest, its centre-to-edge the six between.
   Checked on synthetic discs apart from the suite: a 19.54 px disc measures 19.3, a hexagon's edge comes within 0.6 px of
   cos 30° of its corner under a 1.5 px blur, and a round disc misses it by 1.3 px.
5. **"No far sample brightens a sharper nearer pixel"** is read on `pre_tone` against the frame without the effect, 2.5
   px or more inside the near plate's edge, within 0.01 of 0.2; that the gather runs at all is the wall's edge spreading
   into the sky beside it.
6. **The orthographic CoC** is a diameter, |Δ| × `ortho_coc`, from the focus plane `focus` m along the view. **The tilt
   band's centre** is `center` in screen px with `angle: 0`; its CoC is read from Assumed surface 2, and the band is seen
   to blur by rows far from it.
7. **AC3's times** are 200 distinct seeded frames of a 120 fps clock; "seeked" is a cold seek by `from`, "on one
   machine" one process here. The safe frame is the frame less `safe` (24 px) on each side, as camera.framing reads it.
   The hinge is the lid's pivot, so it stays put while the lid's origin turns; a leader drawn to the origin misses.
   A projection within 0.001 px of the safe frame's edge isn't judged for hiding.
8. **AC4's distances** are from the eye to each item's evaluated centre; A and B move on the view axis, where that is
   their depth too. "1e-9 of the view" is 1e-9 of the frame's width in px. The 40° check is this job's control that the
   channel turns the board.
9. **AC5's composed transition** is #466's mosaic dissolve, its declaration the pack's; "the class budget" is the
   figure class's 2 ms of GPU in its worst frame; dof's and the paints' costs are differences of median `gpu_ms` with
   and without (per item over eight); "a drop adds one fill" is a count (Assumed surface 6), the same on any Mac.
10. **AC7's shift** is a fraction of the sensor (the frame's 3:2 matches it), a positive y raising the view. "Naming the
    angle" is an angle in the issue (a number followed by ° in its text, or under a key naming an angle, lean, vertical
    or pitch) within 0.05 of an edge's lean or of the 12° pitch. The export runs on a presented revision.

## Criteria out of reach

- **AC5 off the reference Mac or under load.** The lane's `judgeLimit` reads INCONCLUSIVE there (a reference Mac, on
  mains, Low Power Mode off, thermal state nominal, load at most one a core), never PASS; nothing waits for the machine.
  "Compared with the merge base" is the lane's comparison of the budgets.json task; this file checks that the task and
  the `timed` entry exist and the validator accepts them.
- **AC8's "taken by the check run from the renderer's own output" and "attached to the PR and shown to you".**
  `taste.test.ts` reads what is recorded and can't see how a picture was made or where it was shown; it holds
  INCONCLUSIVE until the record exists.

## The taste call

The check run writes four files to `docs/evidence/468/`, each from the renderer's own output: `bokeh-disc.png` (the
depth-of-field bokeh disc), `focus-pull.png` (a frame of the focus pull from A to B), `lid-leader.png` (the label's
leader on the opening lid) and `focus-pull-and-lid.apng` (a recording of the focus pull and the lid). The owner's one
call goes in `tests/acceptance/468/TASTE.json`:

```json
{ "issue": 468, "criterion": "#468.ce8ac7ee", "verdict": "looks_right", "who": "…", "when": "2026-11-15T09:00:00Z",
  "screenshots": { "bokeh-disc.png": "<sha256>", "focus-pull.png": "…", "lid-leader.png": "…", "focus-pull-and-lid.apng": "…" }, "note": "…" }
```

`verdict` is `looks_right` or `looks_wrong`; `screenshots` names all four with their SHA-256. No test judges a picture.
This job writes no TASTE.json and creates no picture.

## Scope not under a criterion

The issue's Scope and Fields also name: `rotate: pixel_hash` and the taps' golden-angle spiral, `taps` 96 and 128,
`max_coc`'s clamp, `band.center` naming an item, the band's `width`, `feather` and `amount` profile, the lens fields'
channels beyond focus and fov, `exposure` as a plain EV100, "giving both lens and fov is an error", the shutter shared
with motion blur, the comment's per-sub-sample aperture sampling, `verticals_max`'s fix as a patch op, and the "can
never" rows (reading an earlier frame, blurring status colors or text in a reading hold, smoothing focus or exposure by
frame history, adapting exposure). No criterion states an observation for them, so these tests don't check them; they
are follow-ups for the implementer's own tests.
