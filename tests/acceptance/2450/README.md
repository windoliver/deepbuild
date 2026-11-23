# Acceptance tests for #2450: 3D axes, titles drawn from a vector item

These tests were written before any implementation existed. The job had issue #2450's body (its Scope, its three
acceptance criteria and its Depends on line; no comments, and the issue names no oracle), the design documents and base
commit `89863843d`. It ran in three sittings: the first two wrote the test files, `helpers.ts` and `tsconfig.json` and
ran each test file once on the base; the last wrote this README and `BASE-FAILURE.txt` from them and changed none of
them. At the base a title naming an item is refused (`crates/deep-canvas-marks/src/axes3d.rs`). The job's brief
forbids reading any other worktree, branch or pull request, and the last sitting read none.

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job
(design: Dogfooding). The suite is lean: one file per criterion, at most two tests a file, and one planted wrong
program.

## What was read

What the last sitting read; the test files and `helpers.ts` name their own sources in their headers.

- Issue #2450's body, as saved for the job. It links the design's Marks in 3D: axes `axes3d@1` and depends on #226.
- `docs/canvas-primitives.md`: Marks in 3D: axes `axes3d@1` (`titles: {x, y, z: text | vector ID}`; "labels face the
  camera, so an orbit never mirrors them"; "scene3d names no chart kind and the data module no scene3d kind"; "It can
  never: … mirror a label"); Marks in 3D and Marks in 3D: facing (`camera` turns a mark to face the viewer, `upright`
  turns it about +Y only); Vector and formula `vector@1` (its fields; "Imported once into path and paint marks … every
  color mapped to a role"); Builder `extrude`: outlines from text, paths and SVG (`{vector: ID[#part], size: m}`:
  "size is the height of its box").
- `docs/technical-design.md`: Dogfooding (the job that never sees the work, and its one redraft). `AGENTS.md`.
- At the base, for surfaces and conventions only: `crates/deep-canvas-marks/src/axes3d.rs` (how `titles` is read, the
  refusal of a title naming an item, a text title's size and place, the check's rule, `PLANTED`),
  `crates/deep-gpu-layer/src/axes.rs` (the `axes` report's rows and a label's `quad`),
  `crates/deep-gpu-layer/src/view3d.rs` and `view3d/parse.rs` (`axes`, and `store`, from which each `vector@1` item's
  SVG is inlined), `crates/deep-show/src/main.rs` (the scenario's `planted`), `crates/deep-show/Cargo.toml`
  (`test-leave-out-vector`), `crates/deep-canvas/src/camera.rs` (the orbit's eye), `rust-toolchain.toml`,
  `.node-version`, `scripts/lanes.mjs`, `scripts/proof-change.mjs` (`criterionId`), and the suites `226/` (its README,
  `BASE-FAILURE.txt` and `TASTE.json`) and `443/` (its README: the vector item and the store).
- This folder's three test files, `helpers.ts` and `tsconfig.json`, and the three saved outputs of their base runs.

Code was read only to learn the surface. Every expected value comes from the issue and the design, but for two that
are read off the axes' own text titles: "at the title's size" is the size the base draws a text title at, and "at
the x axis's end" is the place a text title takes, read from the text title "y" in the same frame (Readings).

## Run them

Every file builds its binaries with cargo, and two of the three draw on this Mac's Metal GPU, so they run one file at a
time. The implementer adds this line to `scripts/lanes.mjs`; this README is the instruction, since the job's brief
keeps its files inside this folder.

```js
// #2450's files each build deep-gpu or deep-show (full, and ac1 also without vector); ac1 and ac3 draw on the Metal
// GPU, and ac3-taste writes docs/evidence/2450/ and waits on your taste call in tests/acceptance/2450/TASTE.json.
alone.push('tests/acceptance/2450/');
```

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease npx vitest run --root tests/acceptance/2450 --no-file-parallelism --testTimeout=600000 <file>
node node_modules/vitest/vitest.mjs run --root tests/acceptance/2450 --no-file-parallelism --testTimeout=600000 <file>   # the same, with no lease
node node_modules/typescript/bin/tsc -p tests/acceptance/2450/tsconfig.json   # or: npx tsc -p tests/acceptance/2450/tsconfig.json
```

- **Build.** Each file first builds what it uses, debug, with `cargo build --locked`: `--bin deep-gpu` (`ac1`,
  `ac3`); `--bin deep-show --no-default-features --features full` (`ac1`, `ac2`); the same with `--features
  full,test-leave-out-vector` (`ac1`: the full set without the vector module, #443's). The pinned toolchain's folder
  and `/opt/homebrew/opt/rustup/bin` go first on `PATH`, `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0` unless set;
  each binary is copied out of the target folder (honoring `CARGO_TARGET_DIR`) right after its build, and a test whose
  build failed fails with cargo's error.
- **Platform.** What the GPU draws is drawn on Metal: off macOS, `ac1`'s first test and `ac3`'s test fail with a
  message starting `INCONCLUSIVE:`, never passing, and so do they where `view3d` answers `unsupported_platform`.
  `ac1`'s second test and `ac2` draw nothing.
- **Isolation.** Each test writes into its own temporary folder and deletes it. `ac3-taste.test.ts` also writes into
  `docs/evidence/2450/` and keeps what it writes. The suite uses Node built-ins and vitest only.
- **Time.** Each test sets its own timeout, 3,600 s, and gives each run of a binary 3,000 s.
- **Type-check.** The `tsc` line passes on these files as they stand, under the pinned Node 24.22.0: no output, exit
  0. It was run once, after the base runs.

## Fixtures

All generated in `helpers.ts`; no file on disk. Metres, +Y up. Session documents for `view3d` (`sessionDoc`: `profile:
scene`, `seed: 2450`, `budget.class: figure`, camera `cam`, every item in the one writer layer `main` of writer
`agent:alpha`, `requires: {modules: {scene3d: '^1', vector: '^1'}}` as #443's documents that hold a vector item name
it); the same documents in the agent's form for `deep_show` (`agentDoc`: no `id`, no `layers`, no item's `layer`).

- **The title's graphic** (`titleSvg`, `GLYPH`): an SVG of "x′" as three filled polygons in a 200 × 100 box
  (`viewBox="0 0 200 100" width="200" height="100"`), y down, no text element: one `<path>` per part, each
  `fill="#000000"`, with the ids `bar-down` (10, 10) (30, 10) (90, 90) (70, 90), `bar-up` (70, 10) (90, 10) (30, 90)
  (10, 90) and `prime` (140, 10) (175, 10) (160, 45) (125, 45). Its bytes go into the test's temporary folder at their
  SHA-256, as the hub keeps bytes (`<2 hex>/<62 hex>`; `putBytes`); that folder is `view3d`'s `store` and `deep-show
  run`'s `evidence`.
- **The vector item** `xt`: `vector@1 {src: <that SHA-256>, size: [200, 100], colors: {"#000000": "ink"}, alt: "x
  prime"}`, with no `at`, in the layer `main` like every other item.
- **The scales** `xs`, `ys`, `zs`: `scale@1 {type: linear, domain: [-4, 4], range: x | y | z, nice: false}`.
- **The axes** `axes`: `axes3d@1 {x: xs, y: ys, z: zs, lengths: [8, 8, 8], up: z, ticks: {size: 0.05}, titles}` at
  `at.pos: [0, 0, 0]`, its other fields at their defaults unless a test names them. With `up: z` and these domains
  the x axis's line ends at world (4, 0, 0), the y axis's at (0, 0, −4) and the z axis's at (0, 4, 0) (`ENDS`).
- **The camera** `cam`: `camera@1 {projection, target, orbit: {azimuth: 0, elevation: 20, distance}, near: 0.1, far:
  200}` with `view_width` (14 m unless named) when orthographic and `fov: 45` in perspective. **The sky** `sky`: a
  `sky@1` day sky. **The sun** `sun`: `light.sun@1`, illuminance 3, no shadow.
- **The orbit** (`SPIN`, `ORBIT`): `transport: {span: '1s'}` and one channel, `items/cam/params/orbit/azimuth` keyed
  linearly from 0 at 0 s to 360 at 1 s; 36 frames at 36 fps, so frame k sees azimuth 10k° at 20° elevation.
- **The looks**: `PLAIN` (`plain-2450`: physical basis, tone map none at the exposure whose scale is 1, no finish,
  deband, bloom, ao or 3D ground; roles `ground: paper`, `ink: graphite`, `muted: slate`) and `FILMIC`
  (`filmic-2450`: the same with `tone_map: filmic`, `exposure: 0`), in #166's look shape.
- **Criterion 1's documents**: `titles: {x: "xt", y: "y"}`. The wide view `orbit-2450` (640 × 360, orthographic,
  target the origin, 14 m across) and the close view `close-2450` (960 × 540, orthographic, target the x axis's end
  (4, 0, 0), 2.4 m across, so 400 px a metre), both with the orbit; and `titled-2450` (640 × 360, no orbit) in the
  agent's form.
- **Criterion 2's document** `kinds-2450` (640 × 360, the wide camera, no orbit), in the agent's form: the scene's
  items and seven more, `clay` (`material@1`), `note` (`mark.text@1`), `pt` (`mark.point@1`), `rule` (`mark.line@1`),
  `slab` (`plate@1`, material `clay`), `word` (`text@1`) and `shape` (`path@1`). The twelve items a title must not
  name are `cam`, `sky`, `sun`, `xs`, `axes` and those seven: twelve kinds, none `vector@1`. Each revision differs
  only in `titles`.
- **Criterion 3's document** `taste-2450` (1280 × 720): `titles: {x: "xt", y: "y", z: "z"}`, `ticks: {size: 0.15}`,
  `planes: ["xy"]`, a perspective camera (`fov: 45`, distance 26 m, target the origin), with the orbit.

## The surface under test

Each test enters through the base's own calls: `deep-gpu run` (#377: one scenario `{out, calls}` in, one line out,
one reply per call) with `view3d` (#378: `doc`, `look`, `size`, `fps`, `frames`, `capture`, `targets: ['final']`;
#443's `store`; #226's `axes: true`), and `deep-show run` (#393: one scenario `{evidence, sessions, processes,
panels, docs, calls}` in, one line out) with `deep_show` (`include: ['issues']`), `registry` and `schedule` (#185), on
the full build and on `full,test-leave-out-vector` (#443's). Of their replies the tests read:

- `view3d`: a refusal's `code` (`unsupported_platform` is INCONCLUSIVE, any other fails); `frames`, one object per
  frame in order, each with `frame`; with `axes: true`, each frame's `axes`, an array with a row whose `item` is the
  axes' ID; and on a captured frame `final`, the SHA-256 that names `<out>/<sha>.png` and that the file hashes to. A
  frame that isn't captured carries no `final`.
- `deep_show`: `outcome` (`presented` or `refused`), `issues` (each with `code`, `severity`, `ids` and `path`) and
  `notices`. A revision is presented clean when its outcome is `presented`, no issue has severity `error`, and no
  issue or notice has the code `unknown_kind`.
- `registry`: `modules`, the build's module names. `schedule`: `interfaces["scene3d@1"].digest`.

What the base lacks is below, each named by this job.

## Assumed surfaces

The issue and the design name the behaviours but not these fields and names; each is this job's choice, the most
natural one beside the base's own calls. The implementer provides exactly these, or disputes them. One frame field
(1) and one planted name (3) are new; the rest is the base's, which must go on working when a title names a vector
item.

1. **`view3d`'s `axes` rows gain `titles`.** With `axes: true` (#226's request field), each frame's `axes` row for an
   `axes3d@1` item, `{"item": "<axes3d ID>", "ticks": [...]}` at the base, also carries `titles: [Title]`, one entry
   for each title the frame draws and none for an axis without a title: `Title = {"axis": "x" | "y" | "z", "text":
   string, "quad": [[x, y, z] × 4]}` for a text title, and `{"axis", "vector": "<vector@1 item ID>", "quad"}` for a
   title drawn from a vector item. Exactly one of `text` and `vector` is a string; the other is absent or null.
   `quad` is the world-space corners, in metres, of the title's box as the frame draws it, facing applied, in reading
   order: bottom-left, bottom-right, top-right, top-left, as a tick's `label.quad` is at the base
   (`crates/deep-gpu-layer/src/axes.rs`). A vector title's box is the item's whole `size` box, 200 × 100 here: the
   SVG's (0, 0) at top-left, its x running from bottom-left to bottom-right and its y from top-left to bottom-left,
   so the SVG's point (x, y) is drawn at TL + (BR − BL) · x ÷ 200 + (BL − TL) · y ÷ 100.
2. **The document: a title names a vector item by its ID.** `titles: {x: "xt"}`, the design's `titles: {x, y, z:
   text | vector ID}`: a title whose string is the ID of an item of the document names that item, and any other
   string is text, as at the base, where a title that names an item is refused. No document field is new.
3. **`deep-show run`'s `planted` takes `axes_title_takes_any_kind`.** `planted` is the scenario's own field at the
   base (#393), a string naming one wrong program; this name is new, and at the base the scenario that carries it is
   answered `{"ok": false, "code": "bad_input"}` (`BASE-FAILURE.txt`). Under The planted program.
4. **The SVG comes from the store.** The tests hand the vector item's SVG to the binaries only as bytes in the store
   at the item's `src`: `view3d`'s `store` and `deep-show run`'s `evidence`, as #443's suite hands its SVGs. A vector
   title is drawn from those bytes.
5. **The refusal is `deep_show`'s own issue.** A title naming an item of another kind gives `outcome: "refused"` and
   an issue with `code: "bad_axis"`, `severity: "error"` and `path: "items/axes/params/titles/<axis>"`, the shape
   the base's refusal has (`BASE-FAILURE.txt` shows one), and no other error issue whose `ids` hold `axes` or whose
   `path` is `items/axes` or starts with `items/axes/`. A title naming the vector item gives `outcome: "presented"`
   with no error issue and no `unknown_kind`.
6. **No new request field, call or build feature.** `cargo build --locked --bin deep-gpu`, `--bin deep-show
   --no-default-features --features full` and the same with `--features full,test-leave-out-vector` build as at the
   base. The build without vector still starts and seals: its `registry` lists `scene3d` and `data` and no `vector`,
   the full build's lists `vector`, and `schedule`'s `interfaces["scene3d@1"].digest` is the same in both.
7. **`scripts/lanes.mjs`** gains the line under Run them.
8. **The pictures** are four files the test itself writes into `docs/evidence/2450/`, a folder it makes: under The
   taste call.
9. **The taste call** is recorded in `tests/acceptance/2450/TASTE.json`, the one file anyone adds to this folder
   after this job, and only to record the owner's answer: under The taste call.

## The planted program

| Name | The wrong program | Criterion |
|---|---|---|
| `axes_title_takes_any_kind` | The axes' check takes a title that names an item of any kind: where a title names an item that isn't a `vector@1`, it raises no `bad_axis` at `items/<axes>/params/titles/<axis>`. Everything else is shipped. | AC2 `#2450.880b408d` (this job's: the issue names none) |

It is reached only as `"planted": "axes_title_takes_any_kind"` in a `deep-show run` scenario (`runShow`'s last
argument), never by a document, a request field or a build feature. Where its code lives is the implementer's; the
check it changes is `axes3d@1`'s, the data module's at the base (`crates/deep-canvas-marks/src/axes3d.rs`), and the
base hands a scenario's `planted` to its modules' plants by name (`crates/deep-show/src/main.rs`). Under the plant
`deep-show run` still exits 0, accepts the scenario and answers one reply per call; what it does with such a title
after the check isn't read.

Why a plant: the base refuses every title that names an item, so on the base the twelve refusals of criterion 2's
first test already hold and that test fails only at its control (`BASE-FAILURE.txt`). The plant is the wrong program
on which the refusals' judge fails.

No `twins.json`: every test fails on the merge base at an assertion of its own (`BASE-FAILURE.txt`), and the planted
program is run by the test itself.

## Criteria to tests

IDs are `#2450.` and the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the
leading `- [ ] ` dropped (`scripts/proof-change.mjs`), as `helpers.ts` holds them in `AC`. Each test's name starts
with `AC<n> #2450.<id>`. Each file's header states its fixture, numbers and wrong programs in full.

| ID | Criterion (short) | File (tests): what it asserts |
|---|---|---|
| AC1 `#2450.308e31fa` | An `axes3d@1` whose x title names a `vector@1` item draws that vector at the x axis's end, facing the camera within 1° at 36 azimuths of a 360° orbit and never mirrored | `ac1-vector-title-faces-camera.test.ts` (2): (1) "at each of 36 azimuths of a 360° orbit the x title is the vector item's box …": at azimuths 0°, 10°, … 350° the axes' `titles` are exactly the x title from the item `xt` and the text title "y"; the x title's quad is a rectangle 0.5 m wide and 0.25 m high within 1e-6 m, its reading normal within 1° of the camera's view axis with its front toward the camera, its bottom edge within 1° of the camera's right, and its centre on the x axis's line beyond (4, 0, 0), as far beyond it as the text title "y" is centred beyond (0, 0, −4), within 1e-6 m; and in the close view's `final` target at azimuths 30°, 150°, 210° and 330°, at six points of the SVG inside that quad, the picture is ink where the SVG fills and ground where it doesn't. (2) "the full build presents the axes whose x title names the vector item, and scene3d's interface digest is the same …": `deep_show` on the full build presents the document clean; the build without vector seals with `scene3d` and `data` and no `vector`, the full build with `vector`; `scene3d@1`'s interface digest is the same in both. Wrong programs its header names: the base; a title that reports a box and draws nothing, draws the item's `alt` as text or draws another graphic; the vector fixed in the axes' plane, turned about +Y only, drawn from behind, mirrored inside a box that faces the camera, or upside down; a box at the vector's own 200 × 100, or squashed square; a title at the axes' origin or the axis's low end; a scene3d that takes an edge to the vector module |
| AC2 `#2450.880b408d` | A title naming an item of any other kind is refused at check with `bad_axis`, naming `items/<axes>/params/titles/<axis>` | `ac2-other-kind-refused.test.ts` (2): (1) "a title naming an item of each of twelve other kinds is refused with bad_axis … and the same title naming the vector@1 item isn't": the document with three text titles is presented clean; each of twelve revisions whose one title, on x, y and z in turn, names an item of another kind is refused, with an error issue `bad_axis` whose `path` is `items/axes/params/titles/<that axis>` and no other error on the axes; the same one title naming `xt`, on each of x, y and z, is presented clean. (2) "a planted check that takes a title naming an item of any kind fails, naming … for each kind": under `axes_title_takes_any_kind` that judge fails for every one of the twelve revisions, each failure naming the title's field. Wrong programs its header names: the base (its control fails there); the plant; a check that tells a vector item only by its ID resolving; a refusal with another code, at the axes item or at `titles` without the axis, or at another axis |
| AC3 `#2450.9a0cac61` | Shown to you: the axes with a vector title at four azimuths, taken by the check run from the canvas's own frames; one taste call, recorded | `ac3-taste.test.ts` (1): "the run writes the axes with a vector title at four azimuths from the canvas's own frames, and the recorded call on exactly those says they look right": draws the orbit through `view3d`, writes the four pictures from this run's `final` targets (The taste call), four different SHA-256s, and prints them; then reads `TASTE.json`: absent, or recorded on other SHA-256s, is INCONCLUSIVE; one that isn't JSON or isn't the shape below fails; `looks_wrong` fails; `looks_right` on exactly these passes. Wrong programs its header names: the base; a run with no recorded call, or one made on other pixels; a call that says they look wrong. Showing the pictures to the owner is the implementer's, outside any test |

## Readings where the issue leaves a choice

- **"Draws that vector"** is read twice. The frame says so: the x title's entry names the item (`vector: "xt"`) and
  carries its box. And the picture shows it: in the close view, where the box is 200 × 100 px and one unit of the SVG
  is one pixel, six points of the SVG are looked up inside the reported box, each the mean of 3 × 3 pixels and each at
  least 6 units from an edge of the SVG's parts. Two are in its ink (the x's crossing (50, 50), the prime (150, 20))
  and four on its ground: (50, 20), (50, 80) and (150, 80), where the prime would land if the graphic were mirrored
  left to right, turned half round or upside down, and (105, 60), between the x and the prime. The ground is, by
  channel, the third in order of the four ground samples; an ink sample must differ from it by at least 60 of 255 in
  some channel and a ground sample by at most 24 in every channel. The thresholds are this job's.
- **"At the x axis's end"**: the box's centre lies on the x axis's line within 1e-6 m, beyond its end at the
  domain's high end, (4, 0, 0), and as far beyond it as the text title "y" of the same frame is centred beyond the y
  axis's end, (0, 0, −4), within 1e-6 m: a vector title takes a text title's place. The test holds no distance of
  its own, and first asserts that the text title is centred on its axis's line beyond its end.
- **"At the title's size"** (Scope): a text title's `size` is its em, which the base draws at 5 × `ticks.size`, so
  0.25 m here. For a vector, size is the height of its box (design, Builder `extrude`: outlines from text, paths and
  SVG), and the width follows the item's `size`, 200 × 100: a rectangle 0.5 m wide and 0.25 m high, within 1e-6 m.
- **"Facing the camera within 1°"** is judged under an orthographic camera, as #226's labels are, where facing the
  viewer and facing the view plane agree: the box's reading normal n = (BR − BL) × (TL − BL) is within 1° of b, the
  unit vector from the camera's target toward its eye, (cos el · sin az, sin el, cos el · cos az), whichever way n
  points. It is read from the title's quad in world space, not from pixels.
- **"As the axes' text labels do"** (Scope): a label that faces the camera reads level, so the box's bottom edge runs
  along the camera's right within 1°. A box in the view plane but turned in it fails.
- **"Never mirrored"**: n̂ · b isn't negative at any of the 36 azimuths, so the box's front, by its reading order,
  never faces away from the camera; and the picture's samples catch a graphic mirrored inside a box that faces the
  camera.
- **"At 36 azimuths of a 360° orbit"**: frames 0 to 35 of the keyed orbit, azimuth 10k° at frame k, 20° elevation.
  The picture is read at four of them, 30°, 150°, 210° and 330°.
- **"Through the data module's marks fill (scene3d names no vector kind)"** (Scope) is held as #226 and #443 hold
  their own such lines: the build without the vector module seals with scene3d and data, and `scene3d@1`'s interface
  digest is the same with and without it. No test reads which fill draws the title.
- **"Any other kind"**: twelve kinds, one item of each, the ones a title is most easily mistaken to take among them:
  `camera@1`, `sky@1`, `light.sun@1`, `scale@1`, `axes3d@1` (the axes themselves), `material@1`, `mark.text@1`,
  `mark.point@1`, `mark.line@1`, `plate@1`, `text@1` and `path@1`. Each is named by one title, on x, y and z in turn
  (`cam` on x, `sky` on y, `sun` on z, and so on), so each axis carries four of them, not all twelve.
- **"Refused at check with `bad_axis`, naming …"**: `deep_show` answers `outcome: "refused"` with an error issue whose
  `code` is `bad_axis` and whose `path` is exactly `items/axes/params/titles/<axis>`, and with no other error on the
  axes item. All that separates a refusal from the control is the kind of the item the one title names.
- **"The check stops refusing a title that names a `vector@1` item"** (Scope): the control, on each of x, y and z,
  is presented clean.
- **"Taken by the check run from the canvas's own frames"**: the test run itself draws through `view3d` and writes
  the pixels of each captured frame's `final` target. **"Four azimuths"**: 30°, 120°, 210° and 300°. **"One taste
  call, recorded"**: one answer file on exactly those pixels (The taste call).

## The taste call

`ac3-taste.test.ts` draws `taste-2450` (Fixtures) with one `view3d` call in the `FILMIC` look, 1280 × 720, the
orbit's 36 frames at 36 fps, capturing the `final` target of frames 3, 12, 21 and 30, and writes to
`docs/evidence/2450/`: `axes-vector-title-az030.png`, `axes-vector-title-az120.png`, `axes-vector-title-az210.png`
and `axes-vector-title-az300.png`: #226's axes with the xy grid plane, their x title the vector item `xt` (the
suite's "x′") and their y and z titles text, `ticks.size` 0.15 m so a title is 0.75 m, under a perspective orbit at
20° elevation. Each is the frame's `final` target re-encoded as 8-bit RGB without filtering at zlib level 9, so the
same pixels give the same SHA-256. The four SHA-256s must differ, and the test prints them:

```
#2450.9a0cac61: pictures written from this run's pixels:
  docs/evidence/2450/axes-vector-title-az030.png  <sha256>
  docs/evidence/2450/axes-vector-title-az120.png  <sha256>
  docs/evidence/2450/axes-vector-title-az210.png  <sha256>
  docs/evidence/2450/axes-vector-title-az300.png  <sha256>
```

The implementer shows them to the owner and records the answer in `tests/acceptance/2450/TASTE.json`, the one answer
file, which the test reads as:

```json
{
  "issue": 2450,
  "criterion": "#2450.9a0cac61",
  "verdict": "looks_right",
  "who": "<who made the call>",
  "when": "<ISO 8601 time>",
  "screenshots": {
    "axes-vector-title-az030.png": "<sha256>",
    "axes-vector-title-az120.png": "<sha256>",
    "axes-vector-title-az210.png": "<sha256>",
    "axes-vector-title-az300.png": "<sha256>"
  },
  "note": "<optional>"
}
```

- `issue` is the number 2450 and `criterion` the string `#2450.9a0cac61`.
- `verdict` is `looks_right` or `looks_wrong`.
- `who` is a string that isn't blank.
- `when` is a string: `YYYY-MM-DDTHH:MM`, then optionally `:SS` and a fraction, then `Z` or `+HH:MM` or `-HH:MM`,
  and a time that parses.
- `screenshots` is an object whose keys are exactly the four names, each value the SHA-256 the run printed for that
  file, in hex.
- `note` is optional; when it is a string and the verdict is `looks_wrong`, the failure prints it.

The test reads it in this order: no file is INCONCLUSIVE; a file that isn't JSON, or isn't this shape, fails; a
SHA-256 that differs from this run's is INCONCLUSIVE, naming the pictures; `looks_wrong` fails; `looks_right` passes.
INCONCLUSIVE is a failure whose message starts `INCONCLUSIVE:`. Each run writes the four files again, so a run whose
pixels aren't the recorded ones is INCONCLUSIVE until the call is made on them. The pictures are evidence for the
one taste call only; no other test reads them or the call.

## Not tested

No criterion asks for these, so none is tested: the drawing of a y or z title that names a vector item (criterion 2's
control reads only that the check takes one); more than one vector title on the same axes; a title that names one
part of a vector item; `up: y`; `ticks.labels: upright` with a vector title; a vector title's facing under a
perspective camera (the perspective pictures are for the taste call only); a vector title's box at another
`ticks.size` than 0.05 m; the vector item's `lines`, `parts`, `hotspot` and `write_on`, or a second colour or role;
what the vector item `xt` draws at its own place in the scene; the title's opacity, and its colour beyond the two
ink samples' contrast with the ground; `view3d`'s answer to a title that names an item of another kind (criterion 2
reads `deep_show`'s check); a document with a vector title on the build without the vector module; the cost of a
vector title, and any budget.

## What the implementer adds outside this folder

- The `scripts/lanes.mjs` line under Run them.
- In `deep-gpu`: `titles` in each `axes` row of `view3d` (Assumed surfaces 1).
- For the axes: the vector title drawn (Scope: "through the data module's marks fill"), and the check that takes a
  title naming a `vector@1` item and refuses one naming any other kind with `bad_axis` at its field.
- In `deep-show run`: the planted name `axes_title_takes_any_kind` (The planted program).
- `docs/evidence/2450/` and its four pictures, which `ac3-taste.test.ts` writes when it runs.
- After the owner's taste call: `TASTE.json`, in this folder.

## Open points

- **No saved run goes past the base's refusal.** On the base each drawing test stops where `view3d` answers
  `bad_axis`, criterion 1's second test where `deep_show` refuses the document, and the planted test where the
  scenario is answered `bad_input` (`BASE-FAILURE.txt`). So no saved run reaches the judge of a title's box, the
  picture's sampling with this suite's own closed form of the orthographic orbit camera (`cameraAxes`, `pixelOf`),
  criterion 1's seal and digest checks, the refusals' judge under the plant, or the reading of `TASTE.json`. What
  did run and hold on the base: criterion 1's checks of its own SVG samples, and criterion 2's text-title control
  and twelve refusals. A fault found in what hasn't run is a dispute for the blind redraft, not an edit.
- **The planted test's second assertion** ("each failure names the title's field") holds whenever its first does:
  every sentence the judge writes carries the field. The test's force is that the judge fails for all twelve.
- **The criterion IDs** are the ones `helpers.ts` holds; the sitting that wrote this README could not run a hash to
  recompute them from the issue's text.
- **The base runs were unleased**: `scripts/lease` found no `deep` on `PATH` and no built CLI, and said so.
