# Acceptance tests for #419: Canvas looks: samples per frame and motion blur from the pure evaluation

Written first, from issue #419 (its scope, its three Fields blocks, its nine acceptance criteria and its proof line),
the design sections it links and those they lean on, and the base commit `5def43f9` ("Merge pull request #1307"), by
a job that never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean, as #421's to #424's: one file per
criterion, at most two tests each, plus the planted twins the criteria name.

## What was read

- Issue #419. There is no oracle page for it: `doneright/oracles/issues/419.md` and `cases/419.json` don't exist on
  `DeepBuildAI/deepbuild`'s `doneright` branch (both folders list their neighbours, not 419), so no upstream test was
  ported.
- `docs/canvas-primitives.md`: Look `look@1` (fields, `time.quantize_hz`), Look: samples, Look: frame history (the
  settle rule: "the frame you stop on equals the export"), Motion blur, Motion blur: velocity, Camera `camera@1` and
  Shot (the pose at t is closed form), Overlay (drawn after the resolve), Marker (`kind: hold`), Film audit (reading
  holds), Channel and key: quantize jump (held values), Physics output (`interpolate`), Bake (`step_hashes`),
  Checkpoint ring (step hashes by IEEE bits), Mesh sequence `mesh.sequence@1`, Asset: skinned playback (pre-skin once
  per evaluated time; "each motion-blur sample is its own evaluated time"), The cost model.
- `docs/technical-design.md`: Look; Samples, grade, bloom and lens; Frame history; the canvas list ("motion blur
  sampled from the pure evaluation at sub-frame times, applied only during declared moves and never over a reading
  hold"); Dogfooding; taste calls and "Shown to you".
- At the base: `crates/deep-gpu-layer` (`main.rs`'s calls and `Planted` table; `view3d.rs`: `parse`, `from` as a seek,
  `targets` limited to final, linear, ids, pre_tone and dirt, `samples.live` sub-samples, `selection`, `clicks`,
  frame `notices`), `crates/deep-canvas-scene3d` (`look.rs`: `samples.live` 1–64; `scene.rs`: unknown kinds collected
  as `others` and drawn by nothing here, the `moving` test of an item whose `at` a channel targets),
  `crates/deep-canvas-motion` (`doc.rs`: marker kinds cue, shot, section, record), `crates/deep-scene3d-render`
  (sub-sample jitter), `crates/deep-canvas-marks` (`look.rs`, `finish.rs`: no motion blur), and the suites
  `tests/acceptance/418/`, `421/` to `424/` (conventions, `TASTE.json` and the taste test).

## What the base already does, which these tests don't credit

`view3d` draws `samples.live` (1–64) sub-samples per frame, each jittered by Halton (2, 3) of its index alone, and
averages them in linear light (#423); a call with `from` opens at that frame as a seek; channels key a camera's
`position` and `target` and an item's `at/pos`; the call's `selection` draws outlines; frames carry `notices`. There is
no motion blur by either method, no export class, no `samples.export` or `at_rest`, no settling and no per-frame
samples report, no `scene` target, no `hold` marker (refused as `bad_marker_kind`), no per-frame viewer input, no
skinned part, physics world or mesh sequence (`fixture.skin@1`, `fixture.world@1` and `mesh.sequence@1` fall to
`others` and draw nothing), no `overlay.text@1` in a 3D layer, no `worlds` report, no `velocity_topology`, and none of
the planted names below. Skinned playback is #526/#130, the physics module #97 and mesh sequences #529: criteria 4, 5
and 6 run on the fixture kinds of Assumed surfaces 9, which stand in for them without weakening any criterion.

## Run them

They build `deep-gpu` with cargo, as #421's to #424's suites do, so they run one file at a time. `scripts/lanes.mjs`
needs `'tests/acceptance/419/'` added to its `alone` list, beside `tests/acceptance/418/`; this README is the
instruction, the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/419 --no-file-parallelism --testTimeout=600000 declared-moves.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/419/tsconfig.json
```

Every test draws on macOS's Metal device; off macOS it fails with a message starting `INCONCLUSIVE:`, never passes.
AC9 is INCONCLUSIVE until `TASTE.json` records the call on this run's pictures. Nothing is gated on power or load. A run
with `--root` may leave Vitest's cache in `tests/acceptance/419/node_modules/.vite`; delete it.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the leading
`- [ ] ` dropped. Each test's name starts with `AC<n> #419.<id>`. Each file's header states its fixture, numbers and
wrong programs in full.

| ID | File (tests) | What it asserts |
|---|---|---|
| AC1 `#419.f32101aa` | `declared-moves.test.ts` (2) | The slider at 8 m/s (10 px per 180° shutter), 8-sample blur: moving at 0.5 s, ≥ 12 partly covered px on its row (unblurred ≤ 2); still at 1.5 s and moving inside a `hold` marker at 2.5 s, final byte-equal to the unblurred frame; without the hold, 2.5 s blurs (control). Frame 12 seeked equals played by hash, and is blurred |
| AC2 `#419.a8380bef` | `settled-still.test.ts` (1) | The still scene exported at 16 samples: frames 0–2 report {16, false} and share one hash E; 1 sample differs (control); the live view at rest settles to {16, false} within 48 frames, every settling frame holds < 16, and from then on every frame is E |
| AC3 `#419.209b85be` | `velocity-seek.test.ts` (1) | Velocity blur in the live view: the slider's frame 12 seeked has the played frame's final hash, is blurred (≥ 12 partly covered px) and differs from blur off |
| AC4 `#419.b5c57ec8` | `walker.test.ts` (2) | The `fixture.skin@1` walker, root still, legs at 120°/s: on each leg's band (pixels covered 5–95% of the shutter), the unblurred frame is posed, both blurred frames differ from it by ≥ 0.12 mean, and velocity matches 16 samples within 0.1 mean. `velocity_from_transform` fails naming `walker` |
| AC5 `#419.a7e27e24` | `physics-lab.test.ts` (2) | The `fixture.world@1` lab exported 0–47 with 8-sample blur, with blur off, and frame 12 seeked: one list of ≥ 240 step hashes (≥ 200 distinct) in all three; frame 12 seeked equals played and differs from blur off. `sampler_steps_world` fails naming `lab` |
| AC6 `#419.fe6b20a9` | `topology.test.ts` (2) | The `mesh.sequence@1` flag, 4 vertices to frame 10 and 6 from 11, velocity blur over the change: frame 11 raises `velocity_topology` naming `flag`; ≥ 14,000 px lit; no lit px beyond the swept bounds + 2 px. `velocity_pairs_by_index` fails naming `flag` |
| AC7 `#419.06b9bdd4` | `settle-viewer.test.ts` (2) | The still scene with a readout, live at rest under a pointer moving every frame, hovers, selections and readout texts: the count never falls, reaches {16, false} and keeps it, and the settled `scene` target equals the 16-sample export's. `settle_resets_each_frame` never reaches 16 samples and fails |
| AC8 `#419.ef726005` | `camera-track.test.ts` (2) | The tracked car at 1920 × 1080, t = 2 s, 16-sample blur, seeked and played: every whole car pixel within 1 code of blur off; each of 30 lines on 4 rows a band 12.5 ± 1 px wide holding its energy within 1%. `sampler_holds_camera` fails naming `car` |
| AC9 `#419.fc4ea214` | `taste.test.ts` (1) | Writes the three screenshots and the recording (The taste call) and reads `TASTE.json`: absent or on other SHA-256s INCONCLUSIVE, `looks_wrong` fails, `looks_right` on exactly these passes |

## Assumed surfaces

The issue and design name the behaviors and fields but not these calls; each is this job's choice, the most natural
extension of the base's `deep-gpu run` / `view3d`. The implementer provides exactly these.

1. **The look's samples fields**, read by `view3d` from the call's `look`, as the issue's first Fields block gives
   them: `samples: {live: u16 = 1, export: u16 = 16 (≤ 256), at_rest: "none" | "settle" = "none"}`,
   `filter: "box" | "blackman_harris" = "blackman_harris"`, `filter_px: f32 = 1.5`,
   `vary: ["pixel" | "lens" | "light" | "time"] = ["pixel"]`, `sequence: "r2" = "r2"`. The base reads `samples.live`
   only.
2. **The look's `motion_blur`**: `"none"` (also when absent: off) or
   `{scope: "declared_moves", method: "samples" | "velocity", shutter_angle: deg, phase: "centred", samples: u8,
   adaptive: bool, exclude: [ID], preview_cap?: u8, velocity: {taps: u8, max: px, tile: px}}`, the issue's second and
   third Fields blocks. Its `samples` are its own shutter times, apart from the look's sub-samples (every test here
   sets the look to one sub-sample with `vary: ["pixel"]`, so a frame's shutter samples are Motion blur's alone). It
   blurs what a declared move moves (an item whose pose a channel keys across the shutter, and everything a keyed
   camera shows), and nothing over a `hold` marker's span.
3. **`view3d`'s `class: "live" | "export"`**, default `"live"` (the base's view). `"export"` draws every frame with
   all `samples.export` sub-samples and motion blur at its full samples (no `preview_cap`), and never settles.
   `"live"` draws `samples.live` while moving and, with `at_rest: "settle"`, adds sub-samples on each frame presented
   at rest until it holds `samples.export`. A document with nothing moving is at rest.
4. **`view3d`'s `viewer: [{frame, pointer?: [x, y], hover?: ID | null, selection?: [ID], readout?: {item: ID, text:
   string}}]`**: viewer-only input in session state from the frame named, never a document revision: the pointer at
   view px, the hovered item, the session's selection (whose outlines draw, as the base's call-level `selection`
   does), and the text an `overlay.text@1` readout shows (as its template's bound value would change it).
5. **Each frame reports `samples: {drawn: u16, settling: bool}`**: the sub-samples its pixels hold, and whether it is
   a settling frame (true exactly while a live view at rest holds fewer than `samples.export`). An export frame
   reports `{drawn: samples.export, settling: false}`.
6. **The target `"scene"`**: like `"final"` (an 8-bit sRGB PNG written under `out`, named by its SHA-256, the frame's
   key `scene`), the frame as it stands before overlays, selection outlines and hover marks draw. The `"linear"`
   target holds the frame after the sub-samples' mean and motion blur (either method), in linear light.
7. **Markers of kind `"hold"`** (Marker: `kind: … | hold`): `markers: {<id>: {kind: "hold", name, t, span}}` in the
   document is a reading hold over [t, t + span]. The base's marker kinds refuse it (`bad_marker_kind`).
8. **The reply's `worlds: {<world ID>: {step_hashes: [string]}}`**: for each `fixture.world@1` in the call's document,
   its bake's step hashes from step 0 through its span as they stand after the call, each 16 lowercase hex digits.
9. **Fixture kinds** standing in for modules the base lacks, each a scene3d kind in the document:
   - **`fixture.skin@1`** (for skinned playback, #526/#130): `params: {positions: [[x, y, z]], triangles: [[i, j, k]],
     joints: [[b0, b1, b2, b3]], weights: [[w0, w1, w2, w3]], bones: [{id, parent: index | null, pos: [x, y, z],
     rot: [deg, deg, deg]}]}`, with `material` and `at`. `positions` are the bind pose, where every bone's `rot` is
     [0, 0, 0]; a bone's world is its parent's × T(pos) × R(rot), R = Rz·Ry·Rx; each evaluated time pre-skins every
     vertex by linear blend, Σ wᵢ · world(bᵢ) · bind(bᵢ)⁻¹ · p, then applies the item's transform. Channels key
     `items/<id>/params/bones/<i>/rot/<axis>` (f32, degrees). Velocity reads the two pre-skins at t ± s/2; each
     motion-blur sample is its own evaluated time.
   - **`fixture.world@1`** (for the physics module, #97): `params: {step_hz, span: time, gravity: m/s² along y,
     floor: m, restitution, bodies: {<id>: {radius: m, pos: [x, y, z], vel: [x, y, z]}}}`, with `material`. Baked at
     check from step 0 to its span: each step of dt = 1 ÷ step_hz does, for each body in ID order, v.y += gravity·dt,
     p += v·dt, and if p.y − radius < floor then p.y = 2 (floor + radius) − p.y and v.y = −restitution · v.y. Step k's
     hash is the first 8 bytes of SHA-256 over every body's p then v, f64 little-endian, bodies in ID order, after
     step k (step 0: the initial state). Each body draws as a sphere `<world>#<body>` at the bake's position at t,
     lerped between steps ⌊t · step_hz⌋ and the next (Physics output's `interpolate: linear`), read from the bake at
     every sample's time; drawing never steps the world.
   - **`mesh.sequence@1`** in a per-frame-glTF form (for the asset form, #529): `params: {frames: [sha256],
     frame_rate, start: time, interpolate: "none" | "linear"}`, with `material` and `at`; frame f is the JSON glTF the
     call's `assets` name, read as `mesh.asset@1` reads node 0; the frame at t is ⌊(t − start) × frame_rate⌋,
     clamped to the list, mixed with the next under `linear` when their topology matches.
   - **`overlay.text@1`** in a 3D writer layer: `params: {anchor: "corner", role: "readout", template: string}`,
     drawn after the resolve into `final`, never into `scene`.
10. **The frame notice `{code: "velocity_topology", item: ID}`** in a frame's `notices`: under velocity blur, for an
    item whose vertex count or index buffer differs between t − s/2 and t + s/2; that item's velocity then comes from
    its transform and its skin alone.
11. **Planted programs**, each reachable only through `deep-gpu run --planted <name>`, added to `Planted` in
    `crates/deep-gpu-layer/src/main.rs`:

| Name | The wrong program | Criterion |
|---|---|---|
| `velocity_from_transform` | Velocity blur takes each item's velocity from its transform at t ± s/2 alone, never from its pre-skins | AC4 (named) |
| `sampler_steps_world` | The motion-blur sampler steps each world to each sample's time instead of reading its bake | AC5 (named) |
| `velocity_pairs_by_index` | The velocity pass pairs vertex i at t − s/2 with vertex i at t + s/2 across a topology change, and raises nothing | AC6 (named) |
| `settle_resets_each_frame` | The live view's settle starts its count again on every presented frame | AC7 (named) |
| `sampler_holds_camera` | The motion-blur sampler evaluates the camera at the frame's time in every sample | AC8 (named) |

12. **`tests/acceptance/419/TASTE.json`** records the taste call (The taste call).

The base's channels on a camera's `params/position/<i>` and `params/target/<i>` and on an item's `at/pos/<i>`, its
`from` seek, `fps`, `capture`, `targets: ["final", "linear"]` and `assets` are used as they are.

## The taste call

`taste.test.ts` writes, from one run's output, to `docs/evidence/419/`, printing each SHA-256:

| File | What it shows |
|---|---|
| `car-lines-blur.png` | AC8's car at t = 2 s over the 1 px lines with 16-sample blur at 180°: the renderer's final PNG, byte for byte |
| `walker-velocity.png` | AC4's walker at frame 6 with velocity blur at 180°: the renderer's final PNG |
| `still-16-samples.png` | AC2's still scene exported with 16 samples: the renderer's final PNG |
| `blur-move.apng` | AC1's slider over its first declared move (frames 0–24 at 24 fps) with 8-sample blur: its final targets as an animated PNG |

They are attached to the PR and shown to the owner in the session. The answer is recorded in
`tests/acceptance/419/TASTE.json`, the one file anyone adds to this folder after this commit, and only to record it:

```json
{"issue": 419, "criterion": "#419.fc4ea214", "verdict": "looks_right" | "looks_wrong", "who": string,
 "when": "ISO 8601 time", "screenshots": {"<file name>": sha256, … all four}, "note"?: string}
```

No file is INCONCLUSIVE; a call on other SHA-256s is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly this
run's pictures passes. No other test reads these pictures or the call.

## Fixtures

None on disk: every document and glTF is generated in the test files and `helpers.ts`. The fixtures the taste test
shares (`sliderDoc`, `stillDoc`, `walkerDoc`, `carDoc`) are in `helpers.ts`, with the references they're judged by:
`walkerBands` (each leg's band from the bone poses alone, 64 times over the shutter), `carLineColumn` and `CAR_PIXELS`,
and `bandWidth`. The lab and the flag are built in their own files.

## Readings where the issue and design leave a choice

- **Motion blur lives on the look** (`look.motion_blur`), where the issue's title and the design's Look row ("Samples,
  grade, bloom and lens … motion blur") put it.
- **"Declared moves"** are poses a channel keys across the shutter, and everything a keyed camera shows (the issue's
  last scope line). **"Never in a reading hold"** is no blur at all over a `hold` marker's span ("never over a reading
  hold" in the scope and the design's canvas list), so AC1 moves a plain box inside the hold, with a control that
  blurs without it.
- **"Blur shows"** for the slider is ≥ 12 partly covered pixels (linear 0.05–0.95) on its centre row; an ideal 8-sample
  shutter gives 16, the unblurred frame 0.
- **AC8's and AC4's "16 samples"** are Motion blur's own; the look stays at one sub-sample with `vary: ["pixel"]`, so
  the comparison judges the shutter alone. AC2's and AC7's 16 are the look's `samples.export`.
- **"The velocity mode's tolerance"** has no number in the issue or the design; it is read as mean |velocity − samples|
  ≤ 0.1 in linear light (white = 1) over each leg's band, about a third of what a sharp leg gives against an ideal
  16-sample frame (0.280). **"Both show blur there"** is mean |blurred − sharp| ≥ 0.12 on the same band. Each leg's band
  is the pixels below the hips whose centres the leg covers for 5–95% of the shutter: 3,982 px each.
- **"The same world step hashes"** is the bake's whole list after each export, equal; ≥ 240 steps and ≥ 200 distinct
  keep it from being vacuous (the stated integrator gives 241 steps, all distinct).
- **"Every blurred pixel stays inside the item's bounds swept over the shutter"**: the union of the item's boxes at its
  sample times (frames 10 and 11: x 80–560, y 200–280 px), plus 2 px for a sample's sub-pixel offset; a pixel is
  blurred-into when its linear luminance exceeds 1/256.
- **"A band 12.5 ± 1 px wide"** is √(12 σ²) of the band's energy along the row, each pixel counted 1 px wide, so a lone
  1 px line reads 1.00 and an ideal 16-sample shutter reads 12.71 (13.23 with the end samples at the shutter's ends).
  **"Holding its summed linear energy within 1%"** is against the same ±16 px window in the unblurred frame.
- **"The car's pixels"** are its whole pixels (x 760–1159, y 465–614), every channel of the final target.
- **"Continue the sample count"** is: from frame to frame the reported count never falls, and once it reaches
  {16, false} every later frame keeps it, while the pointer moves every frame and hovers, selections and readout texts
  change before and after it settles. **"The settled frame's pixels before overlays"** is the `scene` target.
- **"No frame that reports settling is ever exported or compared"**: every export frame reports `settling: false`, and
  the tests compare only frames that report {16, false}.

Not tested, because no criterion asks: `vary` with lens, light or time; `preview_cap` and its label; `exclude`; a
logic item and a spring chain read from their bakes (in the scope, with no criterion); a builder param bound to time
or a particle dying inside the shutter (AC6 reaches the topology change through a mesh sequence); `sequence: r2`
against the base's Halton offsets; and motion blur never feeding a check.
