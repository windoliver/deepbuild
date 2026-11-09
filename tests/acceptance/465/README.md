# Acceptance tests for #465: flares and mirrors: lens flares, planar mirrors, and the finishes' budgets

Written first, from issue #465 (its scope, its two field rows and their "It can never" lines, its eight acceptance
criteria and its proof line: "A flare's ghosts at 1,000 random times, a mirror seeked and played, and each field's
measured cost"), its Oracle page (`doneright/oracles/issues/465.md` in `DeepBuildAI/deepbuild`, branch `doneright`), the
design sections it links and those they lean on, and base commit `db917989` ("Merge pull request #1656 …"), by a job
that never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one file per criterion or pair of related
criteria, one test per clause that needs its own run, plus exactly the two planted twins the criteria name.

## What was read

- Issue #465 and its Oracle page; the titles of #422 and #464 it depends on.
- `docs/canvas-primitives.md`: Effect, Effect: flare, Effect: dof (for the row's shape), Effect and GPU operator: target
  inputs, Material: mirror, Material (an item of kind `material@1`), Look `look@1`: bloom, print finishes, indexed basis;
  Render-back; Determinism class; Shipped operators and composed graphs.
- `docs/technical-design.md`: Films and figures on the canvas; Effect; Every task carries its own budgets; The reference
  Macs; Load; Speed claims name their baseline; Dogfooding; Tests written first.
- At the base, for call shapes only: AGENTS.md; `tests/acceptance/464/`, `422/`, `149/`, `380/`, `418/` (READMEs, helpers,
  the identity, budget and taste tests; #418's `pre_tone`); `crates/deep-gpu-layer/src/{main,view3d,film}.rs` (the call
  table, `view3d`'s fields and targets, `seeks`, `timings`, each frame's `pixel_hash`; `film2d`'s `gpu_ms`);
  `crates/deep-canvas-scene3d/src/{light,builders}.rs` (`light.point@1`'s `power` and `radius`, `plate@1`'s `grid`,
  `size` and `outline`); `crates/deep-canvas-effects/src/module.rs`; `scripts/benchmark.mjs` (`fingerprint`,
  `judgeLimit`, `validateBudgets`); `benchmarks/budgets.json`; `scripts/proof-change.mjs` (`criterionId`);
  `scripts/lanes.mjs`.

## What the base already does, which these tests don't credit

`view3d` draws scene3d documents with `from` (a cold seek), `seeks` (jumps inside a call, #484), `capture`, `targets`
including `final` and `pre_tone` (#418: the linear image the tone-mapping pass reads, after the effects chain and bloom,
before exposure), `timings` (each frame's `gpu_ms`), and each frame's `pixel_hash`. `light.point@1` takes `power` and
`radius` (0.05 m by default); `plate@1`, `mark.box@1`, `material@1`, `sky@1`, `light.sun@1`, `camera@1` and f32 channels
on `at/pos/<axis>` exist. #464's five finishes (print wear, tone curve, screen, grain, vignette) draw under a look's
`finish`, and `film2d` answers an indexed look's `indexed` record. `benchmarks/budgets.json` and the lane's judge exist.
Nothing of #465's exists: no flare effect item, no `mirror` on a material, no `indexed.target_bytes`, no
`canvas-flares-mirrors` task, none of the two planted names. So every test fails at the base on a refused document or
call, an unread field or a missing task; the budget timings are INCONCLUSIVE off a reference Mac at rest. The surfaces
plainly don't exist there, so no base run was made and there is no `BASE-FAILURE.txt`.

## Run them

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/465 --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/465/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Each file builds `deep-gpu` once with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked --bin
deep-gpu`, adding the pinned toolchain (`~/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin`) to PATH, copies the
binary out of the target folder (`CARGO_TARGET_DIR` honoured) and fails each test that uses a build that failed. So the
files run one at a time, and the timings must have the machine to themselves: `scripts/lanes.mjs` needs
`'tests/acceptance/465/'` in its `alone` list beside `'tests/acceptance/464/'`. This README is the instruction; the
implementer makes that edit. Each test writes into its own temporary folder and deletes it (`ghosts.test.ts` plays in
chunks of 250 captured frames, each chunk's folder deleted before the next, so at most about 0.5 GB of `pre_tone` targets
sit on disk; `edge.test.ts` holds about 0.5 GB). Imports: Node built-ins and vitest only; the lane's judge and
validator run as `scripts/benchmark.mjs` in a child process. A run with `--root tests/acceptance/465` leaves Vitest's
cache in `tests/acceptance/465/node_modules/.vite`; delete it.

- Everything draws on Metal: off macOS a test fails with a message starting `INCONCLUSIVE:`, never passing.
- **Budgets** (`budgets.test.ts`) count only on a reference Mac (Mac15,7 or Mac15,12) on mains power, Low Power Mode off,
  thermal state nominal, as the lane's `judgeLimit` reads the fingerprint, and with the machine's load at most one per
  core; anywhere else each timing test fails `INCONCLUSIVE:` before timing anything. The indexed target's bytes and the
  budgets.json entry are checked on any Mac.
- `taste.test.ts` keeps its three files in `DEEPBUILD_EVIDENCE_DIR` (else `$TMPDIR/deep-465-evidence`), prints their
  paths, and reads your taste call from the file `DEEPBUILD_TASTE_465` names; without it the test fails `INCONCLUSIVE:`.

## The surface under test

**No new binary and no new call.** #377's `deep-gpu run [--planted <name>]` with its JSON-lines protocol unchanged
(`{"out", "calls"}` in, `{"ok", "replies"}` out): #378's `view3d` for every 3D frame and #417's and #149's `film2d` for
the indexed look. Field names the issue and design give are used as they give them; the rest are this suite's choices,
marked **bold**, each the least a criterion needs.

### Documents (scene3d, as #378's and #422's suites write them)

One writer layer `main` (writer `agent:sess-alpha`), camera `cam`, `requires: {modules: {scene3d: "^1", effects:
"^1"}}`, items keyed by ID, f32 channels with linear keys on `items/<id>/at/pos/<axis>` and
`items/cam/params/orbit/azimuth`.

- **The flare is an Effect item: `{"kind": "effect@1", "params": {"kind": "flare", "flare": {…}}}`**, the design's Effect
  row (`kind: … | flare`, its fields in Effect: flare). `flare` holds the issue's fields as it names them: `{"from":
  "lights", "ghosts": u8, "streak": {"count", "length", "anamorphic"}, "halo": f32, "starburst": {"blades"},
  "intensity": 1, "tint": "flare"}` (`tint` a look role; the suite's looks add a white role `flare`). With `from:
  "lights"` it is built from every evaluated light in view. A field this suite leaves out of a test is given at its
  "off" value: `ghosts: 0`, `streak: {count: 0, length: 0, anamorphic: false}`, `halo: 0`, `starburst: {blades: 0}`.
- **Units**: `streak.length` is a share of the frame's width (the issue's 0.25 → 480 px at 1920), and **`halo` is the
  halo's radius as the same share** (0.05 → 24 px at 480).
- **The mirror is a material field**, as the issue writes it: a `material@1` item's `params.mirror: {"strength": 1,
  "blur": 0, "plane": "<the planar part's item ID>"}`, on the material of a `plate@1` part (`params: {grid: [1, 1],
  size}` or `{outline}`, turned by `at.rot`) that names it with `material`.
- Point lights: `light.point@1 {power, radius: 0.05, color: [1, 1, 1], shadow: false}`; "linear radiance L" is read as
  the radiance of the light's disc, I ÷ (π r²) with I = power ÷ 4π as the light policy reads `power`, so power = 4π · L
  · π r² (L = 50: 4.93 lm).

### `view3d` (#378, #380, #418, #484): unchanged

`{"call": "view3d", "doc": path, "look", "size", "frames", "fps", "from"?, "capture"?: "every" | [n], "targets"?:
["final" | "pre_tone"], "timings"?: true, "seeks"?: [{"after", "to"}]}`; read: each frame's `frame`, `pixel_hash`,
`final` (PNG by SHA-256), `pre_tone` (f32 RGBA by SHA-256) and `gpu_ms`. **The flare is drawn before tone mapping
(the design's words), so it is in `pre_tone`.**

### `film2d` (#417, #149, #464): one reply field added

`{"call": "film2d", "doc", "look", "frames": 1, "hash": true}` with #464's indexed basis on the look; **the reply's
`indexed` record adds `target_bytes`: the bytes of the GPU targets the indexed basis draws into (the index target, and
the light target when `light` is on)**.

### `benchmarks/budgets.json`: one task added

`{"id": "canvas-flares-mirrors", "command": ["node", "benchmarks/canvas.mjs", "flares-mirrors"], "targets":
{"finish_gpu_ms": 0.3, "flare_gpu_ms": 0.3, "mirror_share": 0.25, "indexed_target_bytes": 1000000}, "margin": 0.5,
"limits": {…}, "initialReason": "… #465 …"}`, passing `validateBudgets` against the merge base's file, so the perf lane
compares the issue's measures with the merge base. What the mode prints is the implementer's, as the lane needs it.

### Planted programs (`deep-gpu run --planted <name>`, each reachable only there)

| Name | The wrong program | Criterion |
|---|---|---|
| `flare_fixed_ghosts` | Each ghost drawn at a fixed place in the frame, whatever the light's projected point; everything else as shipped | `1b29e5c0` (issue-named) |
| `flare_ignores_occlusion` | The flare built as if nothing covered its light's disc (the frame's edge still counts); everything else as shipped | `c54ce6c3` (issue-named) |

### Files and environment

- `DEEPBUILD_EVIDENCE_DIR` (optional): where `flare-<sha>.png`, `mirror-<sha>.png` and `flare-follows-light-<sha>.apng` go.
- `DEEPBUILD_TASTE_465`: a JSON file `{"criterion": "#465.e3e14ecf", "by": "you", "screenshots": [sha256 × 3], "call":
  "looks_right" | "looks_wrong"}`.
- `fixtures/look.json`: a copy of #464's base 2D look (`tests/acceptance/464/fixtures/look.json`), for the indexed look.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, `- [ ] ` dropped
(`scripts/proof-change.mjs: criterionId`), from the live issue. Each test's name starts with its ID.

| ID | Criterion | File: what it asserts |
|---|---|---|
| `#465.fd08a941` | 1: mirror seeked, mirror in a mirror | `mirror.test.ts`: two facing mirrors, the back one behind the camera: frames 17 and 44 seeked by `from` have the played hashes; m1's mirror and the box's motion change the frame. The frame with both mirrors within one code value at every pixel of the frame where m2 has no `mirror`; m2 shows inside m1 (≥ 1% of pixels change by > 2 codes without it). |
| `#465.b55974ba` | 2: ghosts follow, seek | `ghosts.test.ts`: 1,000 random frames of a wandering light, visited by seeks in a shuffled order, have the played hashes; with AC4's test, every ghost on the line at each. |
| `#465.5d373d2b` | 3: budgets | `budgets.test.ts`: the budgets.json task and the lane's validator against the merge base; the fused finish, a flare and a mirror at 1080p, five runs judged by the lane (≤ 0.3 ms, ≤ 0.3 ms, ≤ 0.25 of the scene); the indexed look's `target_bytes` < 1,000,000. |
| `#465.1b29e5c0` | 4: ghost centroids | `ghosts.test.ts`: at the 1,000 frames each uncut part of the flare's `pre_tone` within 0.5 px of the line through the light's projected point and the centre; twin `flare_fixed_ghosts` names `ghost <k>`. |
| `#465.c54ce6c3` | 5: occlusion | `occlusion.test.ts`: covered 0%, 50%, 100% → 1, 0.5, 0 of the unoccluded summed energy within 0.02; frames 30 and 60 seeked equal played; twin `flare_ignores_occlusion` names `light key-light` and `covered 100%`. |
| `#465.72006fae` | 6: frame edge | `edge.test.ts`: no flare pixel while the light is beyond its halo's radius outside; no step between adjacent frames over 5% of the full energy; the energy never falls while the light enters. |
| `#465.e0d48d0f` | 7: streak geometry | `streaks.test.ts`: four arms within 1° of 0°, 90°, 180°, 270° and no fifth, each reaching 480 ± 4 px at 1% of its peak; anamorphic arms horizontal within 1°, vertical spread ≤ the light's disc + 2 px; six spikes at 60° ± 1° steps and no seventh. |
| `#465.e3e14ecf` | 8: taste | `taste.test.ts`: the flare and the mirrors as the renderer's PNGs, the flare following its light as an APNG of its frames; INCONCLUSIVE without your recorded call; `looks_wrong` fails. |

## Readings where the issue and design leave a choice

- **"Its fallback"** for a mirror inside a mirror: the design names none, so it is the least: the part drawn by its own
  material without the `mirror` field. "Draws its fallback" is held within one 8-bit code value, since the fallback may
  run another pipeline than a plain material. The fixture keeps "at most one per view": the back mirror is never in the
  direct view, only inside the front one; a check that refuses a document holding two mirror materials anywhere would
  read the design's "per view" as "per document".
- **The flare's own light** is `pre_tone` with the flare less the same document without it (luminance, Rec. 709), so
  the light's own disc, if the renderer draws it, and the room cancel. `ghosts.test.ts` reads `pre_tone` alone in a black
  room: whatever else is there is the light's disc at its projected point, which lies on the line it checks.
- **A ghost's centroid** is the luminance-weighted centroid of a connected part of the flare's light at or above 1% of
  its brightest pixel outside the light's disc; parts the frame's border cuts aren't judged; ghosts that overlap make one
  part, whose centroid lies on the line when theirs do. Ghosts are named `ghost 1, 2, …` by distance from the light.
- **"1,000 random times"** are 1,000 distinct frames drawn with a seeded generator from a 300 fps film of 10 s, so the
  times are random to 1/300 s; "seeking" reaches them by `seeks` in a shuffled order, a jump per frame.
- **"The unoccluded summed linear energy"** is the same sum with no disc in the room; "within 2%" is 0.02 of it, an
  absolute share, since 2% of 0 is nothing. The covered share is the light's projected disc on a 401 × 401 grid, through
  #378's pinhole.
- **The frame edge (AC6).** "Outside by more than its halo's radius" counts from the disc's nearest point, with 1.5 × the
  on-axis disc radius for the disc's stretch off the axis. "Its energy" is the summed energy of the flare's light, its
  full value the last frame's, with the disc wholly inside. "Fades in by the visible share of its disc" is held where it
  can be measured: no flare beyond the halo's radius, steps of at most 5%, and an energy that never falls (by more than
  1% between adjacent frames) as the light enters. The proportionality to the visible share itself is AC5's measure; at
  the frame's edge the frame also cuts the flare's own halo, streaks and mirrored ghosts, so the drawn energy there isn't
  the share times a constant for any flare. **The implementer owes a note on this**: if a flare's visibility is computed
  from samples over the light's disc, it is the same function at an occluder and at the frame's edge.
- **Arms** are read from a 1° histogram of the flare's light over an annulus round the light (40 to 400 px), smoothed
  over 3°, peaks at least 20° apart, each refined by the light-weighted mean of a 0.1° histogram within 10°; exactly the
  asked count, with no further peak above 10% of the weakest. **Reach** is where the arm's profile (the brightest of 7
  points across it, bilinear) last stands at 1% of its peak. **"The vertical spread … within 2 px of the light's"**: in
  each column 40 to 400 px from the light, the rows from the first to the last at 1% of the arms' peak; the widest must
  not pass the light's projected disc (2 × 6.6 px) by more than 2 px. The anamorphic flare takes `length: 0.25`.
- **Budgets.** "Compared with the merge base" is the perf lane's task (as #149's and #429's suites read it). Each cost
  is a difference of medians of `gpu_ms` over 300 frames, with and without the feature in one process; the mirror's as a
  share of the plain scene's median; five runs after a warm-up, the lane's `judgeLimit`. A negative difference reads 0.
  The fused finish is timed on the same 3D stage at 1080p with #464's five finishes off identity (one look `finish`).
  "An indexed look's target" is its targets' bytes at the basis's default size with the light target on, from the
  renderer's own record, held to at least a byte per target pixel so it can't be zero.
- **The recording** is an animated PNG the suite encodes from the renderer's final frames, since the issue names no
  container.

## Not asserted, because no criterion says so

The implementer owes these a mapping or a note (AGENTS.md: review requirement → change → proof):

- `from: emissive ≥ EV100` (a flare from the brightest emissive pixels), `intensity`, `tint`; the flare's "It can
  never" lines (an earlier frame, a status color, over the question card) beyond seek equal to play.
- A mirror's `strength`, `blur` and roughness blur; "at most one per view" when two mirrors are in the direct view; its
  "It can never" lines (status colors and overlays mirrored) beyond seek equal to play.
- The Oracle's Blender glare scenes (below).

## The oracle page

Read. It pins upstream tests for criteria 2 and 4 (Blender `0a18557098`'s compositor glare: `node_glare_ghosts.blend`,
`node_glare_streaks.blend`, `node_glare_simple_star.blend`, `compositor_renders`, `compositor_render_tests.py`), each
"port; needs Blender", and none for 1, 3, 5–8.

| Row | Status |
|---|---|
| Blender ghost glare (criteria 2 and 4) | **Ported as behavior**: Blender draws each ghost as the bright image scaled about the frame's centre, so every ghost of a source lies on the line through it and the centre; `ghosts.test.ts` holds that placement on our renderer at 0.5 px over 1,000 times. The `.blend` scenes and reference renders aren't run: they need Blender and judge Blender's compositor, not our output (#136). |
| Blender streaks and simple star | **Not ported**: criterion 7's geometry is held on our renderer by its own numbers. |
| Criteria 1, 3, 5–8 | No upstream test, as the page says. |

Nothing from Blender is copied into this folder.
