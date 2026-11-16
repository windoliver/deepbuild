# Acceptance tests for #508: explainer effects and the figure fixtures: plume haze, the turbofan and image-layer explainers, and the generated skill

Written first, from issue #508 (its Scope, its Fields block, its six acceptance criteria, its Proof line "The fixtures
run as documents and exported, the haze readback fixture, two agents' first-try figures, and the budgets" and its
Depends on), the design sections it links and those they lean on, and base commit `0e5572731` ("Merge pull request
#2529 …", main), by a job that never saw an implementation, a plan or anyone's notes for this issue. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

The suite is lean: one file per criterion, the live half of criterion 1 in its own file as #124's is, and the two
planted wrong programs the issue names: a haze that writes into a check's readback (criterion 3) and an effect that
reads the wall clock (criterion 6). Every other criterion fails at the base on its own assertions or is BLOCKED there
(`BASE-FAILURE.txt`), and a program that leaves out its feature fails it, so no other plant is added.

## What was read

- Issue #508, live (`gh issue view 508 --repo windoliver/deepbuild`), body only.
- `docs/technical-design.md`: Films and figures on the canvas (591–630: interactive figures and the image-layer
  explainer, the generated skill, export, fixture films); For an outside agent (the skill at
  `skills/deepbuild-canvas/SKILL.md`, generated from the kinds' schemas); The reference Macs; Every task carries its
  own budgets; Dogfooding. `AGENTS.md`.
- `docs/canvas-primitives.md`: Effect, Effect: dof, Effect: flare, Effect and GPU operator: target inputs; Particles
  `particles@1` and its sections (emit regions, bursts, bounce, turbulence, trails, space and paths); Shot; Inset and
  Inset: projected; Control.
- At the base, only to find surfaces: `crates/deep-gpu-layer/src/{main,view3d,calibrate,effects}.rs` (`Planted`,
  `view3d`'s fields and per-frame reply, `passes`, `timings`' `wall_ms`, `gpu_ms`, `passes_ms`, `declared_ms`, the
  `operators` and `calibrate` calls), `crates/deep-canvas-effects/src/shipped.rs` (sparks drawn by
  `particles.sparks@1`), `crates/deep-canvas-scene3d/src/spec.rs` (`effect@1` takes `kind: flare | dof`),
  `crates/deep-show/src/{export,kinds}.rs` (`export`'s fields, `kinds --dump` and kinds.dump@1), `scripts/skill.mjs`
  (the agent skill's generator, for its form), `scripts/proof-change.mjs` (`criterionId`), `scripts/lanes.mjs`,
  `scripts/benchmark.mjs`, `benchmarks/budgets.json`.
- For conventions and reused tools only: `tests/acceptance/506/`, `507/`, `504/`, `504-redraft-ac1/` (no plug-in code
  per frame), `239/` (export and document checks), `380/` (seek against play, effect scenes), `468/` (budgets, the
  lane's `judgeLimit`), `429/` (calibration), `124/` (live agent sessions), `157/` (the MP4 reader), `424/`, `449/`.

Code was read only to learn the surface. Every expected value comes from the issue and the design.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/508 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/508/tsconfig.json    # type-check
rm -rf tests/acceptance/508/node_modules/.vite
```

Each file builds what it drives the first time a test asks, once per file: `cargo build --locked --bin deep-gpu`
(criteria 3, 5, 6), `cargo build --locked --release --bin deep-gpu` (criterion 4's timings), and `cargo build --locked
--bin deep-show --no-default-features --features full` (criteria 1, 2), honoring `CARGO_TARGET_DIR`, with
`CARGO_INCREMENTAL=0`, `CARGO_PROFILE_DEV_DEBUG=0` and `NO_COLOR=1` unless set, Homebrew's rustup first on `PATH`, and
copies each binary into a temporary folder. A missing fixture or skill fails BLOCKED before any build. Every `it`
passes its own one-hour timeout; processes are started by `spawnSync` or `spawn` and stopped only by their own
timeout, by the PID the test started. The taste test writes its pictures to `docs/evidence/508/`, and the live test
its run records to `docs/evidence/508/agents/`.

Gates: no cargo is `BLOCKED:` (a failed test, never a pass). Pixels are drawn on macOS's Metal device: off macOS, or
wherever a reply says `unsupported_platform`, a GPU test fails with a message starting `INCONCLUSIVE:`. Timings count
only on a reference Mac at rest (the lane's `judgeLimit`); elsewhere they are INCONCLUSIVE after every other part of
the test has been judged. The live sessions run only with `DEEP_SKILL_LIVE=1`; `taste.test.ts` is INCONCLUSIVE until
the owner's call is recorded.

**The lines the implementer adds outside this folder** (this job edits nothing else), in `scripts/lanes.mjs` beside
the other GPU suites, because these files build cargo binaries and draw on the Metal device, the budgets are the local
preflight's perf step, and the live sessions spend plan usage:

```js
alone.push('tests/acceptance/508/');
timed.push('tests/acceptance/508/ac4-budgets.test.ts');
byHand.push('tests/acceptance/508/ac1-skill.live.test.ts');
```

and a task in `benchmarks/budgets.json` whose `criteria` hold `#508.822d5a2c` (or whose `initialReason` names #508),
with a `command`, that `validateBudgets` accepts against the merge base's file.

## The surface under test

`deep-gpu run` (`{out, calls}` in, `{ok, replies}` out, #377) with its `view3d` call (#378) and `--planted <name>`;
`deep-show run` (#393's scenarios) with `deep_show`, `registry`, `sandbox`, `eval` with `film: true` and an input
track, and `export` (#501); `deep-show kinds --dump` (kinds.dump@1). Times are whole flicks (705,600,000 a second);
frame n at fps is n ÷ fps s; frame px from the frame's top left corner, x right, y down.

### Surfaces this job invents

The issue and the design name fields but not these shapes. **The implementer builds exactly these, or a dispute goes to
a blind redraft.**

1. **Fixture documents**, each at `tests/fixtures/figures/<name>/figure.json` (a writer's document: no `layers`), its
   files in `tests/fixtures/figures/<name>/assets/` named anything, found by their SHA-256, as #239's films keep
   theirs; a look it names by `look.asset` is one of them. Names: `turbofan`, `image-layers`, `effect-wave-field`,
   `effect-plume`, `effect-arc`, `effect-airflow`. Each `effect-<kind>` fixture holds at least one `effect@1` whose
   `params.kind` is that kind, with its own params under `params.<kind>`, moving over at least 3 s.
2. **The fixtures' controls and shots**: the turbofan's throttle is `controls.throttle`, `kind: "slider"`; the
   image-layer explainer's drag is `controls.spread`; its five keyed shots are `shots.split`, `shots.parallax`,
   `shots.swap_subject`, `shots.recolour` and `shots.move_title`, each naming its own `camera`. A control's top value is
   the end of its `range` (1 when it has none). Each fixture's span (`transport.span`, written `<s>s`) is at least 3 s.
3. **The effect item's shape**, as the base's `effect@1` writes `kind: flare`: `{kind: "effect@1", params: {kind,
   anchor, axis, <kind>: {...}}}`; a plume is `params: {kind: "plume", anchor: "nozzle", axis: [1, 0, 0], plume:
   {radius, reach, heat, shock_cells, turbulence, seed, haze: {strength: 4, scale: 0.5}}}` (strength in px, scale in m).
4. **`view3d`'s `track`**: an input track (`[{t: flick, seq, control, value, writer, player}]`, #417's form) applied
   to the document's controls on the frame clock, so a control change lands in the frame drawn at its time.
5. **`view3d`'s `footprints: true`** adds to each frame `footprints: {<effect item ID>: {box: [x0, y0, x1, y1]}}`, the
   frame px rectangle that holds everything the effect draws or displaces at that frame, its haze included.
6. **`view3d`'s target `checks`** (`targets: [..., "checks"]`) adds to each frame `checks: {<name>: <sha256>}`, one
   entry per target a check reads back from the frame (color, depth, object IDs, whatever the checks read), each
   written to `<out>/<sha256>.bin` as raw rows of the frame's width × height pixels, every pixel the same number of
   bytes.
7. **Each effect item's pass key** in `timings`: `passes_ms` and `declared_ms` carry `effect/<item ID>`, its measured
   GPU time and its declared one (its `cost`, ms per megapixel, times the megapixels it draws at its resolution).
8. **The skill's generator**: `node scripts/canvas-skill.mjs` writes `skills/deepbuild-canvas/SKILL.md` from the
   kinds' schemas (`deep-show kinds --dump`); `--check` exits 0 when the file on disk is what it writes, and non-zero
   naming the difference otherwise.
9. **A live session's run record**: `docs/evidence/508/agents/<agent>.run.json` for `claude-code` and `codex`,
   `{format: "canvas-skill.run@1", agent: {name, version}, skill_sha256, context: ["SKILL.md"], prompt, document}`,
   written by `ac1-skill.live.test.ts` and committed as evidence.
10. **Planted programs**, each reached only by `deep-gpu run --planted <name>` (added to `Planted` in
    `crates/deep-gpu-layer/src/main.rs`):

| Name | Criterion | The wrong program |
|---|---|---|
| `haze_feeds_check_readback` | 3 `#508.c1610aa6` | a plume's haze displaces the color target before the check readbacks are taken, so they read the bent pixels |
| `effect_reads_wall_clock` | 6 `#508.86fb5cf5` | wave_field, plume, arc and airflow take their time from the wall clock instead of the frame's t |

`twins.json` maps each criterion to these names (empty for the criteria with none). Existing surfaces used as they
stand: `view3d`'s `size`, `fps`, `from`, `frames`, `capture`, `targets: ["final", "ids"]`, `assets`, `timings`
(`wall_ms`, `gpu_ms`), `pixel_hash`, the reply's `passes` with each pass's `operator`; `mark.box@1`, `material@1`
(`unlit`), `camera@1` (orthographic `view_width`), `sky@1`, `light.sun@1`, `particles@1` (#380's sparks scene),
`inset@1` with `project` (#506), the envelope's `assemblies`, `controls` and `shots`; `deep-show run`'s `deep_show`,
`registry`, `sandbox`, `eval`, `export` (`video: {codec: "h264"}`) and its receipt's `frame_hashes`; the perf lane's
`judgeLimit` and `validateBudgets`.

## The haze fixture (helpers.ts: hazeDoc)

640 × 360, orthographic from (0, 0, 10) down −Z, 6.4 m across (100 px a metre). The board: 16 × 9 unlit tiles 0.4 m
square at z = 0 in codes (40, 60, 160) and (230, 225, 210), so each tile is 40 px square on whole pixels. A dark
nozzle 0.16 m at (−2, 0, 0.6), projecting to (120, 180) px; the plume anchored to it along +X with radius 0.35 m,
reach 2.8 m, heat 0.7, 4 shock cells, turbulence 0.4, seed 7 and `haze {strength: 4, scale: 0.5}`. Variants: with the
haze, without it, and the board with no plume.

## Criteria to tests

IDs are `#508.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs`), computed from the live issue. Every test title starts `AC<n> #508.<id>`.

| Criterion | Test | What it asserts |
|---|---|---|
| AC1 `#508.9e5770bb` | `ac1-skill.test.ts` (1), `ac1-skill.live.test.ts` (2, by hand) | The skill at `skills/deepbuild-canvas/SKILL.md` is what `scripts/canvas-skill.mjs --check` generates, and names every entry of the registry holding `effect@1` in `deep-show kinds --dump` and each of wave_field, plume, arc, airflow. The live test runs one real Claude Code and one real Codex session in a fresh folder holding only `SKILL.md` (no MCP server, no shell, a fresh config home) on the brief "a test rig with a throttle slider", keeps each `figure.json` as a run record; the record (made on these skill bytes, context only the skill) holds a `figure` document with a slider that `deep_show` presents with no error and no unknown kind. No record: BLOCKED; a record on other skill bytes: INCONCLUSIVE |
| AC2 `#508.4f6ed3e6` | `ac2-fixtures.test.ts` (2) | Per fixture (turbofan, image-layers), one `deep-show run`: `deep_show` presents it with no error and no unknown kind; three `eval`s with `film: true` under a track that moves its control to the top run only operators the build sealed, step no stepping module, and the sandbox runs nothing; `export` to H.264 is `exported` and the file is an MP4 whose one video track is avc1 with one sample per receipt frame hash. The turbofan has its throttle slider; the image-layer explainer its spread control and five keyed shots, each with its own camera |
| AC3 `#508.c1610aa6` | `ac3-haze.test.ts` (2) | At frames 0, 45 and 90 (30 fps): outside `footprints.plume.box` every pixel equals the frame without haze to the code value; inside it every pixel showing a tile color has that color within 5 px (4 px plus the filter's reach) in the board drawn alone; the haze bends at least one board pixel; the box holds the nozzle and covers under half the frame; the object-ID target and every `checks` readback equal those without haze. Cold seeks to frames 45 and 90 draw the played pixel hash; 45 differs from 90. `--planted haze_feeds_check_readback`: a check readback differs and the failure names `effect plume` |
| AC4 `#508.822d5a2c` | `ac4-budgets.test.ts` (1) | First, anywhere: `benchmarks/budgets.json` has a task for this criterion with a command, valid against the merge base's file by `validateBudgets`, and `scripts/lanes.mjs` lists this file in `timed`. Then, release build, a warm-up checking each side draws what it times (the throttle moved at 1 s shows in frame 120 at 120 fps and not in 119), and five runs judged by `judgeLimit`: the redrawn frame's `wall_ms` under 1000 ÷ 120; the 500-part figure's worst `wall_ms` (frames 1 to 599 at 1080p, 120 fps) under 1000 ÷ 120; a projected inset over the left half of a 1080p frame adds under 0.2 ms of median `gpu_ms` lit and under 0.3 ms unlit. INCONCLUSIVE off a reference Mac at rest |
| AC5 `#508.745c64c0` | `taste.test.ts` (1) | See The taste call |
| AC6 `#508.86fb5cf5` | `ac6-effects.test.ts` (2) | Per effect fixture, one run: its effect items' kind present; frame 90 (3 s at 30 fps) seeked equals played by pixel hash; frame 90 differs from the fixture without its effects, and 45 from 90. The operators the plume and the airflow add to `passes` are among those a `particles@1` item adds to #380's scene. Each effect item's `effect/<id>` median `passes_ms` over its median `declared_ms` within 25% of 1, five runs judged by `judgeLimit`, INCONCLUSIVE off a reference Mac at rest. `--planted effect_reads_wall_clock`: the seek fails for each of the four, naming it |

## Readings where the issue and design leave a choice

- **"Passes the document checks"** is `deep_show`'s issues, as #166 and #421 read it: presented, no error, no item
  skipped as an unknown kind.
- **"On the first try"**: the live session has no tool that checks a document, so the file it hands in is its first
  try; the replay judges that file and only that file.
- **"No plug-in code per frame"** is #504's board reading: sealed operators only, no step, no sandbox run.
- **"Moves no board pixel more than 4 px"** is read from the pixels that still show a tile's own color: each has that
  color within 5 px in the board drawn alone (4 px, and under one more for the bilinear filter's reach). Pixels the
  plume itself lights are not board pixels. "Bends what's behind it" is held by at least one bent board pixel, so a
  haze that does nothing fails.
- **"The plume's screen footprint"** is the rectangle the frame reports (5 above); the test holds it to the plume's
  own part of the frame (the nozzle inside, under half the frame).
- **"Every check's readback"** is every target a check reads back from the frame (6 above); a difference is named by
  the effect whose footprint holds the differing pixels.
- **"Seeking to 3 s equals playing to it on one machine"**: a cold seek (`from`) to frame 90 at 30 fps against the
  same frame played from 0, in one process.
- **"Within 25% of its declaration"**: |median measured ÷ median declared − 1| ≤ 0.25 for the effect's own pass.
- **"Presets of particles@1, as sparks does"**: the plume and airflow add no operator of their own to the frame, only
  the particles operator that draws sparks.
- **"A control change redraws within one frame"**: the change lands in the frame drawn at its time, and that frame
  takes under one frame at 120 Hz of wall time. **"Holds 120 fps"**: every frame after the first under 1000 ÷ 120 ms.
- **"Half a 1080p frame"**: the inset's box covers the frame's left half (960 × 1080 px).

## What couldn't be tested without guessing, and isn't

- glow, ink, blur, sparks and particles as `effect@1` kinds, `envelope`, `mask | occluders`, `theme`, `light`,
  `resolution`, and the "recolor or cover a status color" and "be a plug-in shader" refusals: no criterion names them.
- The lazy tongs and handwheel being driven by the same parameter as the panes, and each shot's camera framing.
- Stills coming in as SVG and web pages opening in the browser (Scope only).

## The taste call

`taste.test.ts` writes, from this run's own frames: `plume-haze.png` (the plume with haze at 1.5 s, 640 × 360),
`turbofan.png` and `image-layers.png` (each fixture at 2 s, at its own size, in its own look) and `plume-haze.apng`
(the plume's 91 frames at 30 fps, the renderer's PNGs moved into one animated PNG unchanged), all in
`docs/evidence/508/`, printing each SHA-256. Show them to the owner in the session and attach them to the PR; record
the one answer in `tests/acceptance/508/TASTE.json` (this job writes none, so the test stays INCONCLUSIVE until then):

```json
{"issue": 508, "criterion": "#508.745c64c0", "verdict": "looks_right" | "looks_wrong", "who": "...", "when": "<ISO 8601>",
 "screenshots": {"plume-haze.png": "<sha256>", "turbofan.png": "<sha256>", "image-layers.png": "<sha256>"},
 "recordings": {"plume-haze.apng": "<sha256>"}, "note": "..."}
```

With no file, or one made on other bytes, the test is INCONCLUSIVE; `looks_wrong` fails it. No other test reads a
picture to judge it.
