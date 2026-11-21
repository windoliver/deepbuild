# Acceptance tests for #2691: a mirror renders at half the internal size

Written first, from issue #2691 (its two opening paragraphs, Scope, five acceptance criteria and Proof line), the design
sections it links and base commit `89863843d85271d0aadcd9ca4702e411d67c7613` (origin/main, "Merge pull request #2834
…"), by a job that never saw an implementation; none existed. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test per criterion,
plus one run for each of the two planted programs the criteria name. The one file anyone adds here later is
`TASTE.json`, and only to record the owner's call.

**Read first: three things the implementer and the owner must know.**

1. **Criterion 4 holds on the base**, so its test passes there (`BASE-FAILURE.txt`). The base's estimate and the base's
   device both count the mirror at half the full frame. The test's wrong program is the change with the estimate left
   behind; it was run as a throwaway and fails at +17.44% (The throwaway check).
2. **No reply of the base names the mirror's size.** On the unchanged base criterion 1's failure names 1728 × 1117 in
   the test's own words, quoting the issue, not from a reading. Read from the device, it is the throwaway's run of the
   base's mirror with the reply field added: `expected [ 1728, 1117 ] to deeply equal [ 864, 559 ]`.
3. **Two existing tests will fail on a right change.** `tests/acceptance/2189/full-screen.test.ts`, `#2189.9104323e`,
   and the unit test `the_check_refuses_the_full_screen_every_pass_scene_naming_what_the_device_held` in
   `crates/deep-gpu-layer/src/live.rs` both hold the `over_budget` refusal's bytes for the every-pass scene at
   3456 × 2234 within 10% of 659,161,088 B (593,244,980 to 725,077,196), the device's figure with the mirror at half
   the full frame. With the mirror counted at half the internal size the throwaway's refusal names 527,645,968 B,
   under that range. This is from reading the two tests beside that figure; neither was run against the throwaway.
   Neither is this job's to change; the acceptance test needs an approved proposal or its own redraft.

## What was read

- Issue #2691 (`issue.json`, in full). The issues it cites were read only through the suites named below, not on GitHub.
- `AGENTS.md`. `docs/technical-design.md`: Dogfooding; Tests written first; the Decided rows "The reference window",
  "The canvas" and "GPU memory for a full-screen 3D view".
- `docs/canvas-primitives.md`: Material: mirror, Material: water, GPU surface, GPU surface: HDR output, The cost model
  and its budget class table.
- At the base, for call shapes and what it does: `crates/deep-scene3d-render/src/{mirror.rs,mirror.wgsl,held.rs,
  surface.rs,planted.rs}` and the mirror's call sites in `lib.rs`; `crates/deep-canvas-scene3d/src/mirror.rs`;
  `crates/deep-scene3d-render/src/water.{rs,wgsl}` (the water's lookup); `crates/deep-gpu/src/meter.rs` (`Shape`,
  `estimate`, `fit`); `crates/deep-gpu-layer/src/{view3d.rs,view3d/parse.rs,session3.rs,liveview.rs,envelope.rs,
  live.rs,main.rs}`; `crates/deep-canvas/src/camera.rs` (`Projector`); `scripts/{proof-change,benchmark,lanes,
  size-ratchet}.mjs`; `packs/examples/castle.json`, `castle.look.json`, `packs/composites-1.0.0/island@1.json`.
- Neighbouring suites, for surfaces and conventions: `tests/acceptance/2189/`, `2189-redraft-ac1/`, `1903/` (helpers,
  fixtures), `465/`, `166/`, `386/` (README, the `live` helpers), `2516/` and `1992/` (the taste call's newest form),
  `177/` (the reference window in px).

## Run them

Each file builds `cargo build --locked --release --bin deep-gpu` once (through `../2189/helpers.ts`'s `useRelease`),
copies the binary out of `target/release` (or `$CARGO_TARGET_DIR/release`) and draws on this Mac's Metal GPU, so the
files run one at a time: **`scripts/lanes.mjs` needs `alone.push('tests/acceptance/2691/')`**. This README is the
instruction; the implementer makes that edit. Nothing here belongs in `timed` (no timing is judged). A file joins
`slow` only if its recorded run passes two minutes; on a warm build each takes 2 to 5 s.

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci --ignore-scripts          # once, if node_modules is missing
for f in mirror-size scale-one half-size estimate taste; do
  node scripts/throttle.mjs test --wait 120 -- node node_modules/vitest/vitest.mjs run \
    --root tests/acceptance/2691 --no-file-parallelism --testTimeout=1800000 $f.test.ts
done
npx tsc -p tests/acceptance/2691/tsconfig.json   # the root's strict options, allowImportingTsExtensions, noEmit
```

A run with `--root` leaves Vitest's cache in `tests/acceptance/2691/node_modules/.vite`; delete it. Each test writes
into its own temporary folder and deletes it. What a run leaves on purpose:

- `target/acceptance/2691/{every-pass,scale-one,scale-one-planted,estimate,lake}.json` and `lake.png`: the run's own
  readings (the mirror's size, the device's bytes, the hashes, the estimate beside the peak, the lake's picture), each
  under a header naming the commit, the machine and whether the tree was changed. They are the issue's Proof line for
  the PR, written before anything is judged, so a failing run keeps them too.
- `docs/evidence/2691/lake-merge-base.png` and `lake-change.png`: the two pictures for the owner (`taste.test.ts`).

Off macOS, with no Metal device, or (where a test needs the merge base's reading) on another machine than the one that
reading was taken on, a test fails with a message starting `INCONCLUSIVE:`, never passing, as #465's, #166's, #2516's
and #1992's suites do.

## Surface choices

**One reply field, two planted names, no new call.** Everything else is the base's: #377's `deep-gpu run [--planted
<name>]` with its JSON-lines protocol, #378's `view3d` with #386's `surface` and #166's `reflection` target, and #379's
`live` with `report: ["meter", "memory"]`.

| Surface | Place and type | Read by |
|---|---|---|
| **`mirror_px`** (new) | In a `view3d` reply's `surface` object, beside `internal_px`: `[w, h]`, two whole numbers of px, the size the mirror's pass drew at for the reply's frames (the size of the mirrored picture the lookup samples), for a plain mirror and for a water's own alike. `null` when the view draws no mirror (the tests read `null` and an absent field alike as "names no size"). It reports what the pass really drew, under a planted program too. | Criterion 1 (864 × 559); criterion 2's failure sentence (the planted 160 × 90); logged by criterion 5 |
| `--planted mirror_halves_twice` (new) | Planted programs, below | Criterion 2 |
| `--planted mirror_samples_full_frame` (new) | Planted programs, below | Criterion 3 |

Existing surfaces as these tests read them:

- `view3d`: `{"call": "view3d", "doc", "look", "size", "frames", "fps", "from"?, "capture"?, "targets"?, "timings"?,
  "surface"?: {"internal_scale"}, "packs"?}`. It draws at the `size` and `surface` it is given, with no class fit. Read:
  `surface.{internal_scale, size_px, internal_px, mirror_px}`; each frame's `frame`, `pixel_hash`, with `timings` its
  `gpu_bytes` (Metal's allocated size as the frame draws), and with `capture` its `final` (PNG) and `reflection` (f32
  RGBA at the internal size) by SHA-256.
- `live`: `{"call": "live", "look", "frames", "fps", "sessions": [{"session", "writer", "doc", "size"}], "report":
  ["meter", "memory"]}`. Read: `meter[]`'s row for the session, `estimate.{gpu_bytes, internal_scale}` (the check's
  fit); each frame's `views[].{internal_scale, drawn}` and `device_bytes`.

## Planted programs

`deep-gpu run --planted <name>`, each reachable only there, each "everything else as shipped". The implementer builds
them to this description; on the base the binary answers `{"ok": false, "code": "bad_input"}` to both names.

| Name | What it does wrong | Where its run must fail, naming what |
|---|---|---|
| `mirror_halves_twice` | The mirror's pass (a plain mirror's and a water's own) draws at half of half the view's internal size, each halving rounded up, at every internal scale. The lookup still spans the whole picture, so the reflection stands where it should at half the detail. `surface.mirror_px` reports the size the pass drew at. | `scale-one.test.ts`, the planted test: the scale-1 check fails, and its failure for `465/mirrors-both` frame 17 (640 × 360) holds `its mirror's pass drew at 160 × 90`. `465/taste-flare`, which has no mirror, must keep the merge base's hash. In the throwaway 26 of the 31 frames failed. |
| `mirror_samples_full_frame` | Below internal scale 1, the pass that lays a plain mirror's picture over its parts looks the picture up with the pixel's place in the internal target divided by the frame's **full** size, where the internal size is due (the flip about the camera's centre unchanged). At internal scale 0.5 the reflection is drawn at twice its size about the frame's top left corner: its point at internal px (x, y) shows at (2x, 2y). The pass's size, its picture and `mirror_px` are as shipped, and at scale 1 nothing changes. | `half-size.test.ts`, the planted test: the two `reflection` targets hash apart, the marker's reflection stands at least 1 px from the canonical render's, and the failure sentence holds `the marker's reflection is offset by (dx, dy) px`. In the throwaway: `offset by (190.12, 53.79) px`, 191,589 of 230,400 texels differing. |

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text with the leading `- [ ] ` dropped, trimmed, white
space collapsed (`scripts/proof-change.mjs: criterionId`), computed from `issue.json`: `ee689a34`, `49387bf5`,
`ecd8e156`, `f1acfa43`, `bf51397a`, as expected. Each test's name starts with its ID.

| ID | File | What it asserts | On the base |
|---|---|---|---|
| `#2691.ee689a34` | `mirror-size.test.ts` (1) | One `view3d` of the every-pass scene at 3456 × 2234, `surface.internal_scale` 0.5, 8 frames with `timings`. The reply drew 3456 × 2234 at 0.5, 1728 × 1117 internal; `surface.mirror_px` equals `[864, 559]`; the largest `gpu_bytes` of the frames is at least 90,000,000 B under the merge base's 536,133,632 B. Both halves are reported. | **FAIL**, both halves: no size named (the failure quotes the issue's 1728 × 1117); 0 B less |
| `#2691.49387bf5` | `scale-one.test.ts` (2) | 22 fixtures of #465 and #166, 31 frames, with no `surface`: each `pixel_hash` equals the merge base's. Planted `mirror_halves_twice`: the same check fails, naming 160 × 90. | **PASS** (a no-change criterion); the planted test **FAIL**: the name is unknown |
| `#2691.ecd8e156` | `half-size.test.ts` (2) | The half-size room at 1280 × 720, internal scale 0.5, against the same document at 640 × 360 and scale 1: the two `reflection` targets have one SHA-256, for a plain mirror and for a still water. Planted `mirror_samples_full_frame`: the hashes differ, the marker is at least 1 px off, the sentence names the offset. | **FAIL**: the hashes differ (73,920 and 74,010 of 230,400 texels); the planted test **FAIL**: the name is unknown |
| `#2691.f1acfa43` | `estimate.test.ts` (1) | Two `live` plays: the every-pass scene at 3024 × 1964 (the check's `estimate.internal_scale` 0.5, every frame drawn at 0.5) and the same scene at rest at 1280 × 800 (1, and 1): \|`estimate.gpu_bytes` − peak `device_bytes`\| ≤ 10% of the peak. | **PASS**: −3.07% and −2.90% |
| `#2691.bf51397a` | `taste.test.ts` (1) | One `view3d` of the castle on a lake at 3024 × 1964, internal scale 0.5: the picture differs from the merge base's; both are written to `docs/evidence/2691/`; `TASTE.json` on exactly those two says `looks_right`. | **FAIL**: the picture is the merge base's. With a change and no `TASTE.json`: INCONCLUSIVE |

`BASE-FAILURE.txt` holds the run.

## The merge base's readings

Criteria 1, 2 and 5 compare with the merge base. Its readings are `fixtures/base/`: `every-pass.json`,
`scale-one.json`, `lake.json` and `lake-merge-base.png`. **What recorded them is this suite itself**: they are, byte for
byte, the files the first run of `mirror-size`, `scale-one` and `taste` on the unchanged base kept under
`target/acceptance/2691/` (`lake.png` renamed), on a Mac17,10 (Apple M5 Max), macOS build 26B8119, from the release
binary of `89863843d`. Each names its commit, an empty list of changed paths and that machine; `mergeBase` in
`helpers.ts` refuses a file that names another commit or a changed tree, and on a machine whose model, chip or macOS
build differs the test is INCONCLUSIVE.

Why recorded and not built at run time: building the merge base in every run is a second full release build on a Mac
many sessions share, and on one machine the readings repeat (the base run that wrote `BASE-FAILURE.txt` was the second
run of the same binary: the same 31 hashes, the same picture, 536,133,632 B again). The cost is that the readings hold
on one machine and one macOS build. After an OS or driver update they are INCONCLUSIVE until a redraft of this job
takes them again from the same commit, as the design says a golden is blessed: check out `89863843d`, run the three
files, copy the kept files over `fixtures/base/`.

## The throwaway check

To see that a right program can pass and that each wrong program fails where this README says, a throwaway change was
made to the product code in this checkout, built for release, run against these files as they are, and put back
(`git status --short` listed only this folder before the base run; the rebuilt base binary had the SHA-256 it had
before). It was: the mirror's pass at half the internal size; `surface.mirror_px`; the two planted programs as
described; the check's estimate counting the mirror at half the internal size of each scale its fit tries; and two
switches, the mirror back at the base's size and the estimate back at the base's. Results on this Mac:

| Program | Result |
|---|---|
| Right program | Criterion 1: mirror 864 × 559, 434,290,688 B, 101,842,944 B under the merge base: pass. Criterion 2: all 31 hashes the merge base's: pass. Criterion 3: both pairs one hash, 0 texels differ: pass. Criterion 4: −3.02% (366,080,272 against 377,470,976 B) and −2.90%: pass. Criterion 5: the picture differs (lake mirror 756 × 491), then INCONCLUSIVE with no `TASTE.json`. |
| The base's mirror with the reply field | Criterion 1 fails: `the mirror's pass drew at 1728 × 1117 … expected [ 1728, 1117 ] to deeply equal [ 864, 559 ]`, and `0 B less`. |
| The mirror shrunk, the estimate left behind | Criterion 4 fails: `the check's estimate 443289040 B is 17.44% from the device's peak 377470976 B`. |
| `mirror_halves_twice` | Its test passes: the check fails, naming 160 × 90. |
| `mirror_samples_full_frame` | Its test passes: offset (190.12, 53.79) px. |

## The taste call

`tests/acceptance/2691/TASTE.json` is the one file anyone adds to this folder after this commit, and only to record the
owner's answer once the two pictures in `docs/evidence/2691/` have been attached to the PR and shown to the owner. This
job does not create it; an agent's word isn't a call.

```json
{"issue": 2691, "criterion": "#2691.bf51397a", "verdict": "looks_right", "who": "…", "when": "2026-11-20T10:00:00Z",
 "screenshots": {"lake-merge-base.png": "<sha256>", "lake-change.png": "<sha256>"}, "note": "optional"}
```

`verdict` is `looks_right` or `looks_wrong`; `when` is ISO 8601; `screenshots` names exactly the two pictures with the
SHA-256 of the files the run wrote. With no file, or a call made on other bytes, the test is INCONCLUSIVE; `looks_wrong`
fails. The form is #1992's and #2516's.

## Ambiguities

- **How the mirror's size is read.** No reply names it, and no existing reading gives it exactly (the device's bytes
  and the `reflection` target only bound it). So one field, `surface.mirror_px`.
- **Through which call the scene is drawn at 3456 × 2234 and internal scale 0.5.** `view3d`, which draws at the size
  and surface it is given. `envelope` refuses the scene at that size on the base (628.0 MB against 95% of 512 MB) and
  in the throwaway still does (527.6 MB), so it never draws it.
- **"The device holds at least 90 MB less for it than on the merge base."** "It" is read as the scene: the device
  reports one allocated size, not a mirror's share, and between the merge base and the change only the mirror's share
  moves. The reading is the largest `gpu_bytes` of the call's 8 frames, in a process that draws nothing else (frame 0
  reads 31 MB lower than the seven after it, which agree). 90 MB is 90,000,000 B, as the budget classes count. The
  merge base's reading is recorded (above). The size half is judged on any Mac with Metal; the bytes half only on the
  recording machine.
- **"Every fixture" of the two suites (criterion 2).** Read as the documents those suites' `helpers.ts` export as their
  fixtures: #465's `mirrors` (four variants) and `flareShowcase` (still and moving), #166's `harbour` in every water
  its tests give it, at each look, size and frame those tests draw (`scaleOneFixtures`): 22 documents, 31 frames, each
  opened by a seek at 30 fps. The measure is the frame's `pixel_hash`, those suites' own. Left out: the stages single
  test files build for themselves and don't export (#465's ghost, occlusion, edge, streak and budget stages; #166's
  depth lake, pond, pools, rain lake, physics harbour and budget lakes), their `depth`, `reflection` and `pre_tone`
  targets, and the debug profile those suites build (this suite draws with the release binary on both sides).
- **"The mirrored picture" (criterion 3)** is read from #166's `reflection` target, the mirror's lookup alone, at the
  frame's internal size. **"A canonical render of the same scene made at half that render's size"** is the same
  document by `view3d` with no `surface`, at half the view's size. A 1280 × 720 view at 0.5 and a 640 × 360 canonical
  render both hold 640 × 360 internal px and a 320 × 180 mirror, so the two targets compare texel for texel. Kept out
  of the fixture because it is sized in px of the frame and so differs between the two: a mirror's `blur` and its
  material's roughness, a water's waves and ripples (`distort` is px), lines, points and labels, a flare. Shadows are
  off, as in #465's and #166's fixtures. **The offset** is the centroid of the marker's pixels (red above 0.5, green
  and blue under 0.1) in the view's target less the canonical render's.
- **Criterion 4's call and sizes.** `live`, because its meter row names the scale the check fits, which `envelope`'s
  row does not; both go through the same check. A showpiece's check fits 0.5 only while its camera moves and 1 at
  rest, so scale 1 is the scene with its one channel (the camera's turn) removed. Scale 0.5 is at the reference
  window's 3024 × 1964: at the scene's own 3456 × 2234 the base's check refuses it (`live`: 535.3 MB), and at #2189's
  1280 × 800 a mirror counted at four times its pixels still reads within 10% (+3.82% in the throwaway), so a test
  there proves nothing. Scale 1 is at 1280 × 800, where it fits its class's 512 MB.
- **"The castle's lake" (criterion 5).** The shipped castle has no lake, water or mirror. The fixture is the shipped
  castle, look and pack with four changes (`castleLake`): a 4 km plate at y = 0 whose material is a mirror at strength
  0.85, no blur, over dark water (the design's Material: mirror names "a lake under a castle"); the sky's height fog
  removed; and the camera's target lowered to the water. The last two are forced by the base (Unrelated findings).
  The frame is the flythrough's first. **"The reference window"** is 1512 × 982 points at 2×, 3024 × 1964 px, as
  #177's suite reads it.
- **INCONCLUSIVE** is a failed test whose message starts `INCONCLUSIVE:`, the commoner form here, not a skip.

## Gaps and deviations

- **Criterion 1 on the unchanged base** names 1728 × 1117 by quoting the issue (Read first, 2).
- **Criterion 4 passes on the base** (Read first, 1). Not proven: the estimate at 3456 × 2234 at either scale (the
  check refuses it on the base; the throwaway admitted it through `live` at 0.5, 435.0 MB against 445.8 MB), and
  `envelope`'s `estimate_bytes` (the same check; `../2189/estimate.test.ts` reads it at 1280 × 800).
- **Criterion 5's merge-base picture is not "taken by the check run".** It was taken once, by this suite's run on the
  base, and the check run copies it beside its own. Building the merge base in every run, as #2516's suite does, would
  meet the words at the cost of a second build.
- **The readings hold on one machine and one macOS build** (The merge base's readings).
- **Not tested, as no criterion asks:** the Scope's fourth line (the design's cost line); a mirror's blur and a
  water's `distort` below scale 1; the water's own lookup under a wrong scale (the plant is the plain mirror's);
  `mirror_px` being `null` for a view with no mirror; internal scales other than 0.5 and 1; the device's bytes at
  3456 × 2234 and scale 1 (the Proof line's "at both scales": 905,445,376 B on the base by `view3d`, for the PR).

## Unrelated findings

Seen on the base while choosing the lake, as symptoms only; neither is this issue's, and no test here depends on
them being fixed.

- **A mirror's picture is misplaced when the camera's target is off the mirror's plane.** With the every-pass scene's
  floor moved to y = −2 (its instancer and flare removed, its mirror's roughness 0), each box's reflection is drawn
  above the box, not below; with the camera's target moved onto that floor it is drawn below. The castle's camera
  aims 7 m above its ground, so a lake under the shipped camera shows the castle's reflection above the castle, up to
  the horizon. The lake fixture and the half-size room keep the target on the plane. The cause was not traced.
- **With the castle's height fog on, a lake reflects nothing of the castle**: the reflected castle and island show as
  flat fog-colored shapes; with the sky's `fog_height` removed they show as themselves. The cause was not traced.
