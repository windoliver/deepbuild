# Acceptance tests for #1992: distance fog you can state — a linear curve, fog from the eye, fog on unlit 3D marks, a background brightness of its own

Written first, blind, from issue #1992 (its scope, Fields block, seven acceptance criteria and Proof line), its Oracle
page, the design rows it links, and the base commit `16dc5eab0` by a job that never saw an implementation; none existed.
The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding).

## What was read

- The issue's body, and no comment or linked PR. Its Oracle page (`doneright/oracles/issues/1992.md`): no upstream
  test checks any of the seven criteria, each value being a closed form read on linear targets, so nothing is ported
  and there is no `1992-oracle/` folder.
- `docs/canvas-primitives.md`: Sky `sky@1` (`background_intensity`; "Every fog curve reads d as the distance from the
  eye, never depth along the view axis"), Sky `sky@1`: environment, Sky `sky@1`: height fog (`fog_curve`, `linear
  {near, far}`, "near ≥ far is refused at check, naming the sky"), Marks in 3D (`fog: bool`, the common fields, "A mark
  with `fog: true` takes the sky's fog, and a status color is never fogged"), Marks in 3D: lines and facing, Image
  `image@1`, Status binding, Material (`unlit`), Look `look@1`: tone mapping, Camera `camera@1`.
- `docs/technical-design.md`: Light without history; Document check; What done means, fixed at the start (Who drafts
  it, Proven on the base); Dogfooding; the wrong-program, planted-twin and boundary-pair rules of How we know version 0
  works. `docs/parallel-proof.md` §12a for "in the local preflight".
- At the base, for surfaces and harness conventions only: `tests/acceptance/426`, `422`, `378`, `382`, `485`, `2031`,
  `233`, `1636` and `1973`; `crates/deep-gpu-layer` (`deep-gpu run`, `view3d`, the status report),
  `crates/deep-canvas-scene3d` (`sky.rs`, `scene.rs`, `spec.rs`, `module.rs`), `crates/deep-scene3d-render`
  (`scene3d.wgsl`'s fog step), `crates/deep-show` (the `deep_kinds` line), `scripts/benchmark.mjs`, `scripts/lanes.mjs`,
  `benchmarks/budgets.json`, `packs/examples/castle.json`.

## What the base has

Read on the base run (`BASE-FAILURE.txt`), not taken on trust:

- `fog_curve` is read as a string, `exp` or `exp2`; an object value falls to the default `exp2`, so a linear curve
  draws no fog and `near ≥ far` is drawn, not refused. `background_intensity` isn't read.
- Fog reaches lit surfaces and puffs only. A solid in an `unlit` material keeps its color at every distance under exp
  and exp2; so do a `mark.line@1` and a `mark.point@1`. `fog` on a mark is not read. No `mark.image@1` draws in a 3D
  layer (the item is ignored, not refused).
- A status binding's chip on a solid is already exact after tone mapping (#382), whatever the fog.
- `deep_kinds` lists `sky@1.fog_curve` with the forms `exp` and `exp2`, no `background_intensity`, `fog` on
  `mark.line@1` alone and with no default, and no `mark.image@1`.
- The castle fixture holds no `mark.text`, line or point item, and no unlit material.

## Run them

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1992 --no-file-parallelism --testTimeout=14400000
node node_modules/typescript/bin/tsc -p tests/acceptance/1992/tsconfig.json
```

Each file builds a cargo binary (`cargo build --locked --bin deep-gpu`; `kinds.test.ts` builds `deep-show`), so they
run one file at a time. Every drawing test needs macOS's Metal device; off macOS it fails with a message starting
`INCONCLUSIVE:`, never passes. `taste.test.ts` writes into `target/acceptance/1992/` and keeps what it writes;
`castle-guard.test.ts` keeps one binary under `target/acceptance-1992-base/` (The merge base, below); every other
test writes into its own temporary folder and deletes it. A run with `--root` may leave Vitest's cache in
`tests/acceptance/1992/node_modules/.vite`; delete it.

What a run cost on the base's machine, a loaded Mac, once `deep-gpu` was built (1 min 40 s from a cloned target
folder): the five files that draw fixtures, 3 to 7 s each (`cost.test.ts` stops at its record there);
`kinds.test.ts`, 3 s after a 23 s build of `deep-show` (0.8 GB more in `target/`); `castle-guard.test.ts`, 64 s the
first time, about 55 s of it the merge base's build, and about 10 s after (The merge base).

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's checkbox text, trimmed, whitespace collapsed
(`criterionId` in `scripts/proof-change.mjs`). Each test's name starts with `AC<n> #1992.<id>`.

| ID | Criterion (short) | File (tests) and what each asserts |
|---|---|---|
| AC1 `#1992.cf298652` | Fog color 0.5, `linear {near: 10, far: 50}`, tone map none: an unlit white panel reads 1.0 at 8 m, 0.75 at 30 m, 0.5 at 60 m within 1/255 linear; planted exp at 0.0231 reads 0.897 at 10 m and fails naming the sky; near 50 / far 10 refused naming the sky | `linear-curve.test.ts` (3). (1) Four panels 8, 10, 30 and 60 m from the eye read 1.0, 1.0, 0.75, 0.5 within 1/255 on the linear target; fixture: each judged surface point is at its distance within 5 cm, covered whole, and spans what the pinhole gives. (2) The planted exp curve, drawn through `fog_curve: exp`, `fog_density: 0.0231`: its 10 m panel reads 0.897 and its 30 m panel 0.75 within 1/255, and the same judge fails, every failure naming the sky, one of them the 10 m panel's. (3) near 50 / far 10 and near 50 / far 50 are refused naming the sky, with one code; near 49.5 / far 50 is drawn. `kinds.test.ts` (1): `deep_kinds` lists `sky@1.fog_curve` with `exp`, `exp2` and `linear` with `near` and `far`, default `exp2` (the scope line) |
| AC2 `#1992.80a02b86` | Camera at the origin, fov 90°: a panel 30 m away on the axis and one 30 m away 40° off it both read 0.75 within 1/255; a 40° turn in place moves neither by more than 1/255; planted view-depth fog reads 0.838 off axis and fails naming the pixel; the same under exp and exp2 | `eye-distance.test.ts` (3, one per curve: linear, exp at 0.0231, exp2 at 0.02775). Each: both panels read 0.75 within 1/255, before the turn; neither moves by more than 1/255 under the turn; fixture as AC1's in both poses. Planted on the CPU: each reading replaced by the curve's value at the depth along the camera's axis (0.838 off axis under linear, asserted), through the same judge: it fails, every failure naming a pixel, on the off-axis panel's reading and on both panels' move |
| AC3 `#1992.5703f3eb` | Under the linear fixture a world-size `mark.line` 0.1 m wide, a `mark.point` 0.2 m across and a camera-facing image mark, white at 30 m, read 0.75 within 1/255; with `fog: false`, and a `mark.text` label by default, 1.0; a status-bound mark reads its exact status color at 60 m under every curve; planted fog that tints it fails naming the mark | `marks.test.ts` (3). (1) Default fog: the three read 0.75 at their centres' pixels; fixture: centre 30 m from the eye, 4 px or more of mark to either side, the 5 × 5 pixels around uniform. (2) `fog: false`: the three read 1.0; the label reads 1.0 on every pixel its ink covers whole (40 or more, 30 m from the eye within 0.2 m). Planted through a real field, `fog: true` on the label: the same judge fails naming the mark `label`. (3) Under linear, exp and exp2 the bound box's chip holds `fail`'s #bf232b exactly on the final target; planted on the CPU, that color with the curve's fog share at 60 m mixed in: the same judge fails naming the mark; fixture: the mark's unlit white body reads the curve's value at 60 m (0.5, 0.625, 0.531). `kinds.test.ts` (1): `fog` listed on line, point and image with default true, on text with default false |
| AC4 `#1992.6b71e62f` | Uniform HDR of radiance 1, `background_intensity: 0.25`, tone map none: background reads 0.25 within 1/255 linear; a white matte sphere's pixels equal the frame at `background_intensity: 1` byte for byte; planted control scaling the lighting changes the sphere and fails naming the pixel | `background.test.ts` (1): every background pixel (no item within 3 px; 50,000 or more) reads 0.25 within 1/255; every pixel the sphere covers whole (20,000 or more) holds the same f32 bytes on the linear target and the same bytes on the final target in both frames; fixture: at intensity 1 the background reads 1 and the sphere's centre 0.5 or more. Planted through a real field, `environment.intensity: 0.25`: the same sphere judge fails on 20,000 or more pixels, each failure naming its pixel. `kinds.test.ts` (1): `sky@1.background_intensity` listed with default 1 |
| AC5 `#1992.597ff532` | A document with no new field draws the castle fixture with the merge base's pixel hash on one machine; planted default `fog: true` on text dims the labels and fails naming the first differing pixel | `castle-guard.test.ts` (2). (1) The guard: the checkout's castle names no new field; its frames 0 and 15 have the pixel hash the merge base's own renderer gives its castle, in this run (the renderer's `pixel_hash` and the suite's hash, no differing pixel); the same for the castle with two labels. (2) Planted through a real field, `fog: true` on the labels: the same judge fails naming the first differing pixel, and half or more of the labels' ink pixels differ |
| AC6 `#1992.9d39bde2` | The castle with `fog_curve: linear` holds its p50 frame time within 2% of the castle with exp, on the reference Mac in the local preflight, against the merge base | `cost.test.ts` (1): `benchmarks/budgets.json` holds the task `canvas-fog-linear` with this ID and `linear_over_exp: 1.02`, accepted by the lane's validator against the merge base's file, and `scripts/lanes.mjs` times this file; the linear castle is drawn and differs from the exp one; then, on a reference Mac at rest only, five p50 `gpu_ms` of the linear castle against 1.02 × the median of five of the exp castle, by the lane's `judgeLimit` |
| AC7 `#1992.b0119deb` | Screenshots of the panels, the off-axis pair, and the fogged and unfogged marks shown; one recorded taste call, else INCONCLUSIVE | `taste.test.ts` (1): writes `panels-8-10-30-60m.png`, `off-axis-pair.png`, `marks-fogged.png`, `marks-unfogged.png` from this run's final targets to `target/acceptance/1992/` and reads `TASTE.json`: absent or made on other SHA-256s is INCONCLUSIVE, `looks_wrong` fails, `looks_right` on exactly these passes. Attaching them to the PR and showing them in the session is the implementer's, outside any test |

The Proof line ("the panel, mark and background readings on linear targets, the unchanged castle hash, the frame
times on the reference Mac, and each planted program's failure") is AC1 to AC4's readings, AC5's guard, AC6's
timing, and the six planted programs below.

No `twins.json`: every test but one fails on the merge base at an assertion of its own (`BASE-FAILURE.txt`), and the
planted programs are run by the tests themselves. The one is AC5's guard, which passes on the base as a guard must
(the design: "one for behavior that must not change must pass"); its wrong program is the planted default in the
test beside it, which fails on the base, and a mutant of the change's own lines.

## The surface under test

The issue and the design name the behaviors and the fields; the base gives the calls. Each name this job had to
choose is marked *(chosen)*. The implementer provides exactly these, or disputes them through a blind redraft.

1. **`deep-gpu run`** with **`view3d`** (#377, #378; base): one JSON line `{out, calls}` in, one line out;
   `targets: final | linear | ids`; files named by their SHA-256 in `out`; `assets: {sha256: path}`; `packs`;
   `states`; `timings`; each frame's `pixel_hash`. The linear target is f32 RGBA, the ID target a PNG of pick IDs.
2. **The linear curve's value form** *(chosen)*: `fog_curve: {"linear": {"near": 10, "far": 50}}` on a `sky@1`'s
   params, the form the base gives a design row written `name {fields}` (as `background: {"video": {...}}`). It takes
   no `fog_density`: the linear fixture writes none. `exp` and `exp2` stay strings with `fog_density`.
3. **The refusal** *(chosen beyond "naming the sky")*: a `view3d` reply with a string `code` other than
   `unsupported_platform` and no `frames`, whose other fields hold the sky item's ID, `sky`, as a word (the base's
   `{code, path: "items/sky/params/..."}` does). The code's name is not fixed; near = far gets the code near > far gets.
4. **Fog on an unlit solid**: a `mark.box@1` in a `material@1` with `unlit: true` takes the sky's fog under every
   curve (Readings: the panel).
5. **`fog: bool` on a 3D mark**, in the mark's params: read on `mark.line@1`, `mark.point@1` and the image mark
   (default true) and on `mark.text@1` (default false; `fog: true` written on a world-size label fogs it).
6. **The 3D image mark** *(chosen)*: kind `mark.image@1`, the design's `mark.image` named as its siblings are. Params:
   `asset: sha256` (Image `image@1`'s; the suite hands a PNG to `view3d` through `assets`, as a material's maps
   arrive), `alt: string` (Image `image@1` requires it), `size: [w, h]` in the mark's size space, `size_space: world`
   (the common field), `facing: camera` (Marks in 3D: facing; its default), `fog: bool = true`. The quad is centred on
   `at.pos`. It draws its picture's pixels unlit in the geometry pass, so a white PNG reads linear 1 on the linear
   target. No other field is used, and no `licenses` entry is passed for the PNG or the HDR, which the suite itself
   writes (#426's HDRs pass none either).
7. **`background_intensity: f32`** on a `sky@1`'s params.
8. **A status binding on a mark**: the document's `status_bindings: {id: {target: "items/<id>/params/paint/badge",
   source}}`, `view3d`'s `states: {source: state}` and its reply's `status.marks[] {item, state, color, bounds}`
   (#382; base). The bound mark is a `mark.box@1`, the mark the base lets carry a chip.
9. **`deep_kinds`** on `deep-show run` (#412, #1973; base): `{call: "deep_kinds", op: "field", path: "<kind>@1"}`
   answers `lines`, one per field, each with `name`, `default` and `forms`.
10. **How frame times are taken** *(chosen)*: `view3d` with `timings: true` gives each frame its `gpu_ms` (#422's
    reading); a run's frame time is the p50 of 300 frames of the castle's orbit at 30 fps at its own size, on the
    suite's debug build (the GPU's time doesn't follow the CPU's build profile).
11. **The cost task** *(chosen)*: `canvas-fog-linear`, mode `fog-linear`, target `linear_over_exp` (Outside this folder).
12. **The merge base's renderer** *(chosen)*: kept at `target/acceptance-1992-base/<merge base, 12 hex>/` (The merge base).
13. **The screenshots** *(chosen)*: the four names in AC7's row. **`TASTE.json`** *(chosen, #426's form)*: The taste call.

## Planted programs

No `deep-gpu --planted` name is added: none is needed. Each wrong program the criteria name is either drawn by the
renderer through real fields of the document, or its pixel value is computed on the CPU, and in both cases it goes
through the same judge as the right frame, which must fail naming what the criterion says.

| Criterion | Wrong program | How it is planted | The judge fails naming |
|---|---|---|---|
| AC1 | An exp curve fitted to the same halfway distance | Real fields: the linear fixture with `fog_curve: exp`, `fog_density: 0.0231`; its 10 m panel must read 0.897 | the sky `sky` |
| AC2 | Fog by view depth | CPU: the curve's value at the depth along the camera's axis (0.838 off axis under linear), for both poses and all three curves | the pixel |
| AC3 | A default of `fog: true` on text | Real field: `fog: true` written on the label | the mark `label` |
| AC3 | A fog that tints a status color | CPU: the status color with the curve's share of the fog at 60 m mixed in, in linear light | the mark `bound` |
| AC4 | A control that scales the environment's lighting instead | Real field: `environment.intensity: 0.25`, the base's control | the pixel |
| AC5 | A default of `fog: true` on text | Real field: `fog: true` written on the castle's labels | the first differing pixel |

The refusal's boundary pair (AC1): near = far, the threshold, is refused; near 1% under far is drawn.

An implementer who adds renderer-side planted names for these is free to; no test here needs them.

## Fixtures

All are built in `helpers.ts`; none is a file. Every one draws in the acceptance look: physical basis, tone map none,
exposure −log2(1.2) so the exposure scale is 1 and the linear target holds the criteria's numbers, no bloom, deband or
ground grid; the role `white` is #ffffff.

- **The linear fixture's sky**, ID `sky`: `top` and `low` black, no ambient light, `fog: [0.5, 0.5, 0.5, 1]`,
  `fog_curve: {linear: {near: 10, far: 50}}`.
- **A panel**: a `mark.box@1` 0.1 m thick in the material `{base_color: [1, 1, 1, 1], unlit: true}`, turned about +Y
  to face the eye, its near face's centre at the stated distance from the eye at the origin.
- **The panels** (AC1, AC7): 640 × 360, fov 60°; panels 8, 10, 30 and 60 m away at −21°, −7°, 7° and 21°, each 8° wide.
- **The pair** (AC2, AC7): 640 × 360, fov 90°; panels 3 m square 30 m away at 0° and 40°; the camera looking along −Z,
  and turned 40° in place.
- **The marks** (AC3, AC7): 640 × 360, fov 12°; a 1.2 m line 0.1 m wide, a 0.2 m point, a 0.6 m image of a white 8 × 8
  PNG and the label TEXT in 1.2 m type, each 30 m from the eye.
- **The bound mark** (AC3): 640 × 360, fov 12°; a 2 m panel 60 m away with its badge bound to a verdict in state `fail`.
- **The sphere** (AC4): 480 × 360, fov 60°; a 256 × 128 Radiance HDR of mantissa 128 at exponent 129 (1 exactly) as
  the environment; a `ball@1` of radius 1 m 4 m ahead, base color 1, metallic 0, roughness 1.
- **The castle** (AC5, AC6): `packs/examples/castle.json` in `castle.look.json` with `packs/composites-1.0.0`, at its
  own 1280 × 800, 30 fps. With labels: `label_keep` (KEEP at [0, 16, 0]) and `label_east` (EAST at [26, 16, −16]),
  `mark.text@1` in 3 m world-size type in the look's `stone`. The linear twin (AC6): its sky's curve replaced by
  `{linear: {near: 0, far: 693}}`.

## The merge base

AC5 is a guard, judged against the merge base's own renderer on the machine and in the run that judges it, never
against a hash frozen elsewhere: `git merge-base HEAD origin/main` (else `main`) is read when the file starts, so the
test still holds after main moves and the branch merges it.

- **Kept**: `target/acceptance-1992-base/<merge base, 12 hex>/` holds that commit's `deep-gpu` (a debug binary, about
  360 MB), its `packs/examples/castle.json` and `castle.look.json`, its `packs/composites-1.0.0/` (under 200 KB), and
  `.built` with the full SHA. One merge base is kept; building another removes the folder first. `target/` is
  git-ignored.
- **Built** when it isn't there: the commit's tree is exported with `git archive` into
  `target/acceptance-1992-base/build-<12 hex>/src` (no worktree is added and no git state changes), the checkout's
  own `target/debug` is cloned beside it with `cp -c -R` (copy-on-write on APFS: the third-party crates are neither
  compiled nor stored again; where the clone fails the build starts cold), `cargo build --locked --bin deep-gpu` runs
  there (the workspace's own crates recompile, as after any move of a checkout), the binary and the fixture are copied
  out, and the scratch folder is removed, whether the build ended well or not.
- **Cost**, as measured at the base (`BASE-FAILURE.txt`'s header has the run): the first run of the file took 64 s,
  about 55 s of it this build: the export about 4 s and 0.6 GB, the clone about 1 s and no space, the rest cargo on
  the workspace's own crates, whose rebuilt artifacts take about 1.4 GB. So a first run needs about 2 GB of scratch
  space, all given back when the scratch folder goes, and leaves the 360 MB binary. A later run on the same merge
  base builds nothing, adds nothing, and draws its five castle runs, 16 frames each, in about 10 s.
- Each renderer draws its own commit's castle, look and pack, so the comparison is the fixture as each commit has it.
  A change to the castle's own files that changes its pixels fails the guard, as it should.

## The taste call

`tests/acceptance/1992/TASTE.json` is the one file anyone adds to this folder after this commit, and only to record
the owner's answer; this job does not create it:

```json
{"issue": 1992, "criterion": "#1992.b0119deb", "verdict": "looks_right", "who": "…", "when": "2026-11-18T10:00:00Z",
 "screenshots": {"panels-8-10-30-60m.png": "<sha256>", "off-axis-pair.png": "<sha256>", "marks-fogged.png": "<sha256>", "marks-unfogged.png": "<sha256>"},
 "note": "optional"}
```

`verdict` is `looks_right` or `looks_wrong`; `when` is ISO 8601; `screenshots` names exactly the four pictures with
the SHA-256 of the files the run wrote. A call made on other bytes is INCONCLUSIVE.

## Outside this folder

This job writes only here. The implementer adds:

- `scripts/lanes.mjs`: `alone.push('tests/acceptance/1992/');` (the files build cargo binaries) and
  `timed.push('tests/acceptance/1992/cost.test.ts');` (it gates on the lane's `judgeLimit`). `castle-guard.test.ts` and
  `kinds.test.ts` join `slow` if their recorded runs pass two minutes.
- `benchmarks/budgets.json`, a task the lane's validator accepts against the merge base's file:

  ```json
  {"id": "canvas-fog-linear", "command": ["node", "benchmarks/canvas.mjs", "fog-linear"], "margin": 0.5, "limits": {},
   "targets": {"linear_over_exp": 1.02},
   "initialReason": "Issue #1992 first measurement: … (it must name #1992)",
   "criteria": ["#1992.9d39bde2"]}
  ```

- `benchmarks/canvas.mjs`: the mode `fog-linear` (the castle with exp and with `linear {near: 0, far: 693}`, each
  orbit timed, the ratio of their p50 frame times as `linear_over_exp`) and its line in `canvas.mjs judge`. What the
  mode prints is the implementer's.
- The PR: the four screenshots attached and shown in the session, and `TASTE.json` once the owner has answered.

## Legs that read BLOCKED or INCONCLUSIVE

- Every drawing test off macOS: INCONCLUSIVE (`requireMetal`).
- AC6's timing: INCONCLUSIVE anywhere the perf lane's `judgeLimit` doesn't pass a reference Mac at rest (its
  fingerprint, mains power, Low Power Mode off, thermal state nominal, the load within the cores), before anything is
  timed; INCONCLUSIVE too when the five runs are neither all within the limit nor all over it by the lane's margin. Its
  record (the task and the timed list) is judged on any machine and fails on the base.
- AC7 with no `TASTE.json`, or one made on other pictures: INCONCLUSIVE, by the criterion's own words.
- AC5 when the merge base can't be exported or built: the test fails saying so, never passes.

## Readings where the issue leaves a choice

- **"An unlit white panel"** (AC1, AC2): a thin `mark.box@1` in a `material@1` with `unlit: true` and base color
  white, square to the line of sight. The design has no `panel` kind; Material's `unlit` is its word for a surface
  that takes no light, and the issue's title says "fog on unlit 3D marks". "At 8 m from the eye" is the distance from
  the eye to the surface point the judged pixel shows, checked by ray in each test.
- **The 10 m panel** (AC1): the criterion reads the planted exp curve "at 10 m", so the fixture holds a fourth panel
  there; under the linear curve it reads 1.0 (d = near).
- **"Within 1/255 on linear targets"**: each channel of the f32 linear target within 1/255 of the stated value.
- **"The same holds under exp and exp2"** (AC2): the issue gives exp's density, 0.0231 per m, half the fog at 30 m. For
  exp2 the suite takes the density that also mixes half in at 30 m, 0.02775 per m (0.02775 × 30 = √ln 2), so "both
  read 0.75" holds under all three and the planted view depth differs under each (0.838, 0.794, 0.833 off axis).
- **"Turning the camera 40° in place"**: the camera's target swings 40° about +Y toward the off-axis panel, its
  position unchanged, so each panel is on the axis in one pose and 40° off it in the other.
- **"Each unlit white at 30 m"** (AC3): each mark's own centre is 30 m from the eye and painted the role `white`;
  marks take no light. The camera's fov is 12° so that a 0.1 m line is 10 px wide; the criterion fixes no camera here.
- **"A `mark.text` label by default"**: a world-size label, since a screen-size one draws after tone mapping and is
  not on the linear target. Its judged pixels are found, not assumed: where the same document with no fog draws 1.
- **"A mark with a status binding"**: a `mark.box@1` with its badge bound, the form the base draws; "its exact
  status color" is the chip's color on the final target, where status draws. "Under every curve" is the three above.
- **"Background pixels"** (AC4): every pixel with no item within 3 px. **"The sphere's pixels"**: every pixel the
  sphere covers at every sample, read as the pixel and all within 2 px being the sphere's in the ID target; rim pixels
  blend the background in and are left out. **"Byte for byte"**: the f32 bytes of the linear target and the bytes of
  the final target.
- **"The same pixel hash as the merge base on one machine"** (AC5): frames 0 and 15 of the orbit, by the renderer's
  `pixel_hash` and by the suite's hash of the decoded final target.
- **"The fixture's labels"** (AC5): the castle holds no label on the base, so the suite adds two to each commit's
  castle, written with the base's fields; a document with no new field. Both the castle as committed and the castle
  with labels are held to the merge base. World-size labels, since those are what the geometry pass fogs.
- **"Dims the fixture's labels"**: half or more of the pixels the labels' ink draws differ from the merge base's
  frame. The ink is where the castle with labels is 8 codes or more off the castle without (5,552 and 5,748 pixels in
  the two frames at the base); the castle's bloom moves a code or two over a halo ten times that, which is not judged.
- **"The castle fixture with `fog_curve: linear`"** (AC6): `linear {near: 0, far: 693}`, the linear curve with the
  castle's exp curve's halfway distance (ln 2 ÷ 0.002 = 346.6 m), as criterion 1 fits its exp to its linear.
  **"p50 frame time"**: the p50 of `gpu_ms` over 300 frames. **"Within 2%"**: the lane's five-run rule against 1.02 ×
  the exp twin's median.
- **"The fogged and unfogged marks"** (AC7): two pictures, AC3's two documents. The panels' picture holds the 10 m
  panel too.

## Not tested

Because no criterion asks: height fog, `fog: background`, puffs, lit surfaces and the froxel grid under the linear
curve; `linear` with a missing or non-numeric `near` or `far`, or a negative one; `fog` on a screen-size (px) mark, on
`mark.curve`, `mark.arc`, `mark.tube`, `mark.area` or `mark.mesh`; an image mark's other fields (`fit`, `crop`,
`sampling`, `opacity`), its `upright` and `fixed` facings, its picking; `background_intensity` over a sky gradient, a
video or a blurred background, with `fog: background`, at values other than 0.25 and 1, or out of range; a status
binding's stroke slot under fog; the design docs' text (the rows the issue names already hold the new fields at the
base); the screenshots' attachment to the PR.

## Not settled

- **Unlit solids in fog change.** Reading the panel as an unlit-material solid means such a solid, unfogged on the
  base under exp and exp2, now takes fog. AC5 guards the castle only, which has no unlit part; a document that relies
  on an unlit solid standing clear of fog would change. If the issue means only marks (lines, points, images), the
  panel needs another reading and AC1 and AC2 a redraft.
- **The design's sentence and the criteria.** Sky `sky@1` says "Fog applies to every lit surface by distance" and its
  height fog row "Fog applies to lit surfaces"; criteria 1 and 2 read fog on an unlit panel, and the issue's title
  says "fog on unlit 3D marks". The suite follows the criteria. If the two are meant to disagree, that is the issue's
  to say (CONTRIBUTING: the docs and the issue).
- **Lines and points in old documents.** The Fields block makes `fog` true by default on `mark.line` and `mark.point`,
  which the base draws unfogged, so a document with no new field that draws them under fog changes. AC5 guards the
  castle, which has neither; no criterion guards such a document.
- **`fog: true` on a screen-size label** is left open: the suite fogs only world-size text.
- **The linear curve with a density.** The fixture writes no `fog_density`; whether one is ignored or refused beside
  `linear` is not judged.
- **AC6 on a debug build.** The GPU time is read from the suite's debug `deep-gpu`; the task in `benchmarks/canvas.mjs`
  is free to use a release build, as the other canvas tasks do.
