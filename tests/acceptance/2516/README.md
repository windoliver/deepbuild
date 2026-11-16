# Acceptance tests for #2516: ambient occlusion reads the visibility its radius means

Written first, from issue #2516 (its scope, seven acceptance criteria and proof line), the design sections it links
(canvas-primitives: Look `look@1`: ao; technical-design: Decided, How we know version 0 works with Dogfooding, the
reference Mac and CPU references) and base commit **`1c4d1f0e2aaad8c6a6573848823566d04ff73d17`**, by a job that never saw
an implementation; none exists in that snapshot. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding). The one file anyone adds here later is `TASTE.json`,
and only to record the owner's call (The taste call); `APPROVED.md` records the owner's approved corrections, below.

**Owner-approved corrections** (2026-11-15) to AC4's CPU qualification, the full-radius plant's wall witness and the
redraft's machine gate and typing are applied in place and mapped, requirement by edit, in [`APPROVED.md`](APPROVED.md);
the versions before them are at commit `3cd75b8aa`.

**Nothing here has been run.** The drafting job could not execute commands: no type-check, no CPU test, no GPU test,
no base run. The implementing session runs them unchanged first, on the base, and keeps the failing output as
`BASE-FAILURE.txt`.

## What was read

- `../issue.json` (#2516); `AGENTS.md`; `docs/technical-design.md` (How we know version 0 works, the parity suite's
  CPU-reference rule, Dogfooding, Decided); `docs/canvas-primitives.md` (Look `look@1`: ao and its Cost line, Material,
  Light, the Decided row "Ambient occlusion in shading").
- At the base: `crates/deep-scene3d-render/src/ao.wgsl` and `ao.rs` (the loop, the blur, all three passes timed under
  `scene3d.ao`); `crates/deep-canvas-scene3d/src/look.rs` (`Ao`), `scene.rs` (`posed`, `project`, `unproject`),
  `crates/deep-canvas/src/camera.rs` (`screen_basis`); `crates/deep-gpu-layer/src/view3d.rs` (`targets`, `timings`,
  `passes_ms`, `profiler`, `packs`); `crates/deep-show/src/kit/goldens.rs` (`GpuLease`); `scripts/benchmark.mjs`
  (`fingerprint`, `judgeLimit`), `scripts/lanes.mjs`; `packs/examples/castle.json`, `castle.look.json`,
  `packs/studio-1.0.0/looks/physical_{film,night}.json`; `tests/acceptance/418/` (ao.test.ts, helpers.ts, README),
  `1637/` (budgets, helpers), `446/` (taste), `166/` README (the `depth` target).

## Run them

They build `deep-gpu` with cargo and draw on Metal, so they run one file at a time. The implementer adds
`'tests/acceptance/2516/'` to `alone` and `'tests/acceptance/2516/timing.test.ts'` to `timed` in `scripts/lanes.mjs`;
this README is the instruction.

```sh
npm ci                                   # once, if node_modules is missing
npx tsc -p tests/acceptance/2516/tsconfig.json                     # type-check
npx vitest run --root tests/acceptance/2516 reference.test.ts      # CPU only, any machine
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/2516 --no-file-parallelism
```

- Each drawing file builds `deep-gpu` once (#418's `useGpuBin`: `cargo build --locked --bin deep-gpu`) and copies it out.
- `taste.test.ts` also builds main's `deep-gpu` from the base commit's tree (`git archive` into a temporary folder,
  `CARGO_TARGET_DIR=target/acceptance-2516-main`): slow the first time.
- `unedited-418.test.ts` runs `tests/acceptance/418/ao.test.ts` through vitest in a child process.
- Off macOS, or where `deep-gpu` answers `unsupported_platform`, a drawing test fails with a message starting
  `INCONCLUSIVE:`; it never passes. `timing.test.ts` is INCONCLUSIVE off a reference Mac, on battery, in Low Power Mode,
  above nominal thermal state, under load above the core count, or while another job holds the GPU lease.
- Each test writes into its own temporary folder and deletes it, except what is meant to stay:
  `docs/evidence/2516/{room,castle}-{main,after}.png` and `docs/evidence/2516/timings-<sha256 prefix>.json`.

## The surface under test

No new binary or call. **#377's `deep-gpu run [--planted <name>]`** with **#378's `view3d`**, through #418's own driver
(`tests/acceptance/418/helpers.ts`, imported, unedited) and the fields the base already has: `look.ao {radius,
strength, samples, resolution, multi_bounce, specular}`, `targets: ["linear", "ids", "depth"]` (`depth`: #166's
view-axis distance, one f32 a pixel), `timings` (each frame's `passes_ms`, the reply's `profiler`), `packs`, `sky@1`,
`material@1` (`metallic`, `roughness`, `specular_level`). The perf lane's `judgeLimit`/`fingerprint` and #1637's and
#418's helpers are reused, not copied.

### Missing public surface (fails on the base by its absence; minimal proposed contract)

1. **Each AO pass timed on its own.** At the base `ao.rs` times the prepass, the occlusion and the blur all under
   `scene3d.ao`, so no reading of the prepass or the blur exists (the issue: "nothing reads it today"). Proposed: with
   `timings`, each frame's `passes_ms` carries **`scene3d.ao_prepass`**, **`scene3d.ao`** (the occlusion alone) and
   **`scene3d.ao_blur`**, each from its own pass's wgpu-profiler timestamps (the names `ao.rs` already declares as
   `PREPASS`, `OCCLUSION`, `BLUR`).
2. **Planted programs** (added to `Planted` in `crates/deep-gpu-layer/src/main.rs`, reachable only through
   `--planted`, never an environment variable), each replacing only the occlusion loop:

   | Name | The wrong program | Criterion |
   |---|---|---|
   | `ao_main_loop` | The occlusion loop exactly as `ao.wgsl`'s `ao_fs` is at the base commit (lengths 0.15 to 1 of the radius by the index's square, depth-buffer counting, `clamp((2r − dist) ÷ r)` weights), scaled by the look's `strength` | AC1, AC2 (with the look's `strength` raised), AC3 |
   | `ao_uniform_hemisphere` | The shipped loop with its directions weighted evenly over the hemisphere in place of by cosine | AC3 |
   | `ao_full_radius` | Main's loop with every one of its points at the full radius | AC4 |

   "Main's loop with its strength raised" (AC2) is `ao_main_loop` under a raised look `strength`: the test finds the
   strength itself (1 to 6 by 0.5, then by 0.1), the first at which the 10 cm reading passes.
3. **The GPU lease for a timed run.** `deep-gpu` takes no lease; the machine's only GPU lease in code is `GpuLease`
   (`$HOME/.cache/deepbuild-gpu/lease`, created exclusively, holding its PID; kits and exports). `timing.test.ts` takes and
   holds that same lease for its warm-up and five runs and reads INCONCLUSIVE, with no number, if a live process holds
   it or takes it meanwhile. **Limitation:** a GPU job that doesn't use that lease (another `deep-gpu` run, another
   app) is not seen. Proposed, for the implementer to weigh: `deep-gpu run` takes `GpuLease` for any call with
   `timings`, or `deep lease` gains a `gpu` kind the perf lane holds.

## Fixtures and cameras (`helpers.ts`)

Every document is generated: one writer layer, a `sky@1` with `ambient_top = ambient_low = 0.6` (uniform ambient), no
light, the floor's `material@1` `{metallic: 0, roughness: 1, specular_level: 0}` (no specular share); #418's look (tone
map none at scale 1, identity finish, no bloom, no deband) with `ao: {radius: 0.5, strength: 1, samples, resolution,
multi_bounce: false, specular: false}` or `"none"`. Frames are 1920 × 1080. Boxes are `mark.box@1`; floors' tops are y = 0.

| Fixture | Boxes (min → max, m) | Read | Cameras (`position` → `target`, fov over the wider side, near) |
|---|---|---|---|
| Wall | floor (−10, −0.1, −0.2) → (10, 0, 12); wall (−10, 0, −0.2) → (10, 4, 0): 20 m long, 4 m high, face z = 0 | floor at z = d ± 0.5 cm, \|x\| ≤ 2 m (4 m of the wall); d = 5, 10, 15, 20, 30, 40, 60, 100 cm | A (0, 4.2, 6) → (0, 0.2, 0.5), 75°, 0.1; B: A turned 30° about the vertical through the target, (2.75, 4.2, 5.263) |
| Slab | floor (−12, −0.1, −12) → (12, 0, 12); slab (−10, h, −10) → (10, h + 0.1, 10): 20 m square; h = 0.25, 0.375 | floor \|x\|, \|z\| ≤ 0.25 m (the middle) | in the gap: (0, h/2, 1.5) → (0, h/2, 0), 100°, 0.02 |
| Cube | floor (−6, −0.1, −6) → (6, 0, 6); cube (−0.1, 0, −0.1) → (0.1, 0.2, 0.1), front face z = 0.1 | floor at z = 0.1 + d ± 0.5 cm, \|x\| ≤ 0.05 m (the middle 10 cm); d = 5, 10 cm | facing the face (0, 1.2, 2.2) → (0, 0.05, 0.15), 60°, 0.05; 90° around it (2.05, 1.2, 0.15) |

**Measurement.** Per camera, one process draws `ao: none` (targets linear, ids, depth) and then each ao setting
(linear). A pixel is read when it and its eight neighbours are `floor` in the object-ID target; its world point is the
depth target unprojected through the stated camera (scene.rs's model: focal length = half the wider side ÷ tan(fov/2),
centre the frame's middle, pixel centres at +0.5). The reading of a bin is Σ luminance(ao on) ÷ Σ luminance(ao none),
Rec. 709, on the linear target. A run fails, rather than reads, if more than 1% of interior floor pixels within 10 m of the eye don't
unproject onto y = 0 within 5 mm (the stated camera doesn't match the renderer), if a bin holds under 50 pixels, or if the floor's
ambient light is absent.

**In frame** (`reference.test.ts`, CPU): every point of every box face within 0.5 m of any read point, on a 2.5 cm
grid, projects inside the frame in front of the near plane, for each camera. Hand-checked corners: wall B's nearest
floor corner lands at y ≈ 338 of 540 below centre; the slab's widest neighbourhood points at x ≈ 547 of 960.

## The references

- **Closed forms**: the wall 1 − (acos a − a√(1 − a²)) ÷ π, a = d ÷ 0.5, and 1 past the radius; the slab (h ÷ 0.5)².
  Held to the issue's numbers to the digits stated (±0.0005; slab exact).
- **CPU reference** (`cubeReference`): f64, 4,096 rays on a 64 × 64 stratified grid, cosine-weighted by Malley's
  method, slab-tested against the fixture's occluders out to 0.5 m; the cube's value is the mean over 11 points across
  the middle 10 cm. It counts as an oracle only after it reproduces the wall's six closed forms and the slab's two, each
  within **0.01**, and its twin (the same rays weighted evenly) reads 0.5 under the slab at 0.25 m and fails. On the cube
  (owner-approved, `APPROVED.md` A) the point and the band are qualified separately, each within **0.01**: its value at
  the point in front of the middle of the face (`cubePointReference`) against the issue's 0.68 and 0.81 and against the
  face's f64 closed form (the redraft's `cubeFaceClosed`), and its average over the middle 10 cm (`cubeReference`, what
  the GPU is compared with) against that closed form averaged over the same 11 points.

## Criteria to tests

The suite names no criterion hash IDs (the drafting job could not compute SHA-256); each test's name starts with its
`AC<n>`, numbered in the issue's order, which the closed-issue sweep reads.

| AC | Criterion (short) | Test (file) | What fails it |
|---|---|---|---|
| AC1 | Wall at 5–40 cm within 0.05 of the closed form, 8/16 samples, half/full, two cameras; main's loop planted fails naming the first point and reading | `wall.test.ts` (2) | Any (camera, setting, distance) off by > 0.05, listed. Plant `ao_main_loop` must fail with its first failure naming the first failing distance and its reading |
| AC2 | 60 cm and 1 m read 1 within 0.01; main's loop with strength raised until 10 cm passes fails at 5 cm | `wall.test.ts` (2) | Any open-floor reading off 1 by > 0.01. The strengthened `ao_main_loop` must fail naming `at 5 cm the reading is …`; if no strength makes 10 cm pass, the test fails saying so |
| AC3 | Slab at 0.25 m within 0.05 of 0.25, at 0.375 m of 0.5625; main reads > 0.8 and fails naming the height; even-weighted loop reads 0.5 and fails | `slab.test.ts` (3) | Every setting. `ao_main_loop` > 0.8 and fails naming `the slab 0.25 m above the floor`; `ao_uniform_hemisphere` within 0.05 of 0.5 and fails |
| AC4 | Cube at 5 and 10 cm within 0.1 of the 4,096-ray f64 reference (0.68, 0.81), facing and 90° cameras; full-radius plant passes the wall, reads > 0.99 here, fails naming the camera | `cube.test.ts` (2), `reference.test.ts` (2 + 6 camera checks) | Every setting. `ao_full_radius` must pass the wall fixture at full resolution, 8 and 16 samples, from both cameras (owner-approved, `APPROVED.md` D), read > 0.99 at both points from each cube camera, and fail naming that camera |
| AC5 | #418's three occlusion tests pass, unedited | `unedited-418.test.ts` (2) | `git diff <base> -- tests/acceptance/418/{ao.test.ts,helpers.ts,tsconfig.json}` non-empty; the three tests not all `passed` in vitest's JSON report |
| AC6 | Prepass, occlusion, blur timed on the castle at 1080p, 8/16 × half/full, p50 and p95 over five warmed runs from GPU timestamps; Cost line carries them; a run under another job's lease is INCONCLUSIVE | `timing.test.ts` (3) | A kept frame without all three passes in `passes_ms` (the base); `profiler` not wgpu-profiler. The lease twin: with a live process holding the lease, nothing is drawn and the outcome is INCONCLUSIVE with no number. The Cost line still says "estimate", or carries no recorded run's 24 numbers |
| AC7 | Room and castle with ao on, main and after, from the renderer, shown; one taste call recorded, else INCONCLUSIVE | `taste.test.ts` (1) | An after-picture identical to main's (the base); no `TASTE.json` or one on other pictures → INCONCLUSIVE; `looks_wrong` → FAIL |

Proof line: every GPU test logs its readings beside the closed form or reference (`#2516 wall, camera …: 5 cm 0.571, …`),
the plants' failures, and the timings table; the timing evidence file is what the Cost line must carry.

## What fails on the base, and why (expected; not run)

- AC1, AC3: the shipped program is main's loop; the issue's CPU model reads 0.82–0.84 at 10 cm (closed form 0.626) and
  0.93 under the slab at 0.25 m (0.25). These fail on their readings, the criterion's defect. AC3's and AC1's plant tests
  fail on `--planted ao_main_loop` being refused: the plants are new code.
- AC2's open-floor test may pass on the base (main may read 1 past the radius); its plant test fails as above.
- AC4's shipped test: the issue states no reading for main on the cube; it may or may not fail on the base. Its plant
  test fails on the refused plant.
- AC5: expected to **pass** on the base. It is a guard: it fails on an edit to #418's tests or a change that breaks them.
- AC6: the timing test fails on the base at the first kept frame (`scene3d.ao_prepass` not in `passes_ms`) on a
  reference Mac, and is INCONCLUSIVE elsewhere; the Cost line test fails (it says "estimate"); the lease twin passes on
  the base (it holds test code to its rule).
- AC7: fails on the base: "after" is main, so each after-picture equals main's.
- `reference.test.ts` holds no product code; it passes on the base if the references and cameras are right.

## Stays BLOCKED or INCONCLUSIVE until a person acts

- **AC7's taste call** is INCONCLUSIVE until the owner, shown the four pictures in the session (and attached to the PR),
  records `tests/acceptance/2516/TASTE.json`: `{"issue": 2516, "criterion": "AC7", "verdict": "looks_right" |
  "looks_wrong", "who", "when" (ISO 8601), "screenshots": {"room-main.png", "room-after.png", "castle-main.png",
  "castle-after.png": sha256}, "note"?}`. Nothing here records it; an agent's word isn't one.
- **AC6** reads only on a reference Mac (Mac15,7, Mac15,12 or Mac17,10, per `scripts/benchmark.mjs`) under the GPU lease;
  elsewhere INCONCLUSIVE, never a number. The Cost line test is BLOCKED until a judged run's evidence file exists. The
  lease covers only jobs that take `GpuLease` (Missing public surface, 3).
- **Every GPU reading** is one machine's; on another it is a reading, not a verdict (the issue's "Runs on").

## Readings where the issue leaves a choice (each for the redraft or the owner, not the implementer)

- **Tolerances kept as the issue's**: 0.05 (wall, slab; "drafted until the first run"), 0.01 (open floor), 0.1 (cube;
  "drafted"). Changing a drafted one is the owner's decision by approved proposal, never an edit here.
- **Drafted by this job, for the owner to confirm** (the issue gives no number): the CPU reference's qualification
  tolerance **0.01** against stated numbers (unchanged by the approval); the read band **±0.5 cm** across d; at least 50 pixels a bin; the camera
  check (1% of floor pixels, 5 mm).
- **"Averaged along 4 m of the wall"**: |x| ≤ 2 m, centred on the camera A's line of sight. **"Under the slab's
  middle"**: |x|, |z| ≤ 0.25 m. **"The middle 10 cm of the cube's face"**: |x| ≤ 0.05 m on the floor in front of it; the
  reference averaged the same way.
- **"A second camera 30° around the first"**: turned about the vertical through the first's target. The slab's camera
  sits in the gap, so the floor and the underside within the radius are both in the frame.
- **AC1's plant and the strengthened plant are read at 8 samples, half resolution, camera A**, the look's defaults; AC3's
  plants likewise; the full-radius plant on the wall at full resolution, 8 and 16 samples, from both cameras (the
  criterion claims it passes the wall; owner-approved narrowing of this wrong program's witness only, `APPROVED.md` D;
  the shipped program is still held on the wall at every setting).
- **"p50 and p95 over five runs"**: nearest-rank p95 and the median over the 150 kept frames (30 a setting a run) of the
  five runs pooled; each run's median is recorded too. "After warm-up": one discarded run and the first 10 frames of each
  setting. **"1080p"**: 1920 × 1080 (the castle document's own 1280 × 800 is overridden by the call's `size`).
- **"The Cost line carries those readings"**: the ao section's `**Cost:**` line names the prepass, the occlusion and the
  blur, p50 and p95, 16 samples and half and full resolution, no longer says "estimate", and contains every p50 and p95 of
  one recorded evidence file to two decimals in ms.
- **"As main draws them"**: built from the base commit, never a plant (a plant is this checkout's program).
- **Debug build timing**: `deep-gpu` is a debug build here (as #1637's budget test); pass times are GPU timestamps, which
  the CPU build profile doesn't time.

## Not tested, because no criterion asks

The scope's recorded choice of method with its reason and measured cost; the PR's list of goldens that move through
approved proposals (`physical_film`, `physical_night` and any frame drawn with ao on); the Decided row's reopening;
`multi_bounce` and `specular` on; an occluder outside the frame or behind another surface; ray-traced occlusion (#475).
