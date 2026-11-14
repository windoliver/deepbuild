# Acceptance tests for #2513: render.exposure on one GPU reduction, the check and the snapshot light readings reducing the subject's px on the GPU and reading back a few KB

These tests were written before any implementation existed, by a job that never saw one. The writer had issue #2513
(its Scope, its Fields line for `render.exposure`, its three acceptance criteria, its Proof line "The frame-filling
fixture's snapshot readings beside render.exposure's numbers on the same revision, the readings' added time on the
reference Mac (a reading where the Mac is loaded), and #1939's and #1938's suites passing unchanged", and its Oracle
line: no upstream test checks these criteria, so there is no `2513-oracle/` folder), the titles of its two
dependencies (#1938 the loop's render checks, #1939 light readings on every snapshot), the design sections the issue
links and those they lean on, and base commit `0f89ab109` ("Merge origin/main into #1939"), the head of #1939's branch,
which holds #1938's render checks and #1939's readings; neither has merged on main yet.

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job
(design: Dogfooding). The suite is lean: one test per criterion it can run, and the one wrong program criterion 1
names. Criterion 3 names existing suites, so it gets no test here (below).

## What was read

- Issue #2513, and the titles of #1938 and #1939.
- `docs/canvas-primitives.md`: Render-back (the request `{doc, rev, t, size, camera, include}`, the reply's
  `snapshots: [{sha256, w, h}]`, "about 4 ms at 1936×1584"); Check input: loop kinds (`render.exposure {subject:
  collection | kept = kept, clipped_max, crushed_max, key_ev}`, "key_ev is the subject's mean log luminance against
  middle gray", exposure reads pixels "on one machine and are INCONCLUSIVE elsewhere", "pixel kinds one GPU reduction and
  a few KB read back per checked time (about 0.1 ms)"); Camera `camera@1` (`projection`, `orbit`, `exposure: EV100`,
  `fit: {keep, pad = 0.08}`) and its framing (`fit.fill = 0.6`, "the share of the shorter side the kept items span";
  `fit.place`; "the distance or view width that makes the bounds span fill, then the target offset that puts their
  center at place").
- `docs/technical-design.md`: "Proven on the base"; Dogfooding; "Every task carries its own budgets" (five runs after
  warm-up, the margin, a loaded or other machine's time a reading) and the reference Macs.
- At the base, for surfaces and conventions only: `AGENTS.md`; `tests/acceptance/1939/` (README, helpers, both tests,
  BASE-FAILURE, the closest model; its patterns are copied into `helpers.ts`, never imported) and
  `tests/acceptance/1938/` (README, `machines.test.ts`'s header); `crates/deep-show/src/main.rs` (the scenario's
  `planted` match, which refuses an unknown name as bad input), `pixels.rs` (the frames a pixel check draws, at the
  document's size, and #1939's `light3d`), `hub.rs` (the snapshot entry's `light`); `crates/deep-canvas-loop/src/
  exposure.rs` (`measure`, the `results` row `{t, subject, px, clipped, crushed, key_ev, exposure, pass}`);
  `crates/deep-canvas/src/camera.rs` (`frame`: fill as a share of the frame's shorter side, pad widening the bounds;
  `rig`); `crates/deep-canvas-scene3d/src/scene.rs` (`posed`: an orthographic camera's px per metre is the frame's width
  over its view width); `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`); `scripts/lanes.mjs`;
  `scripts/proof-change.mjs` (`criterionId`).

Code was read only to learn the surface and what the base already does. Every expected value comes from the issue and
the design.

## What the base already does

- `deep_show` of a whole 3D revision with `include: ['issues', 'pixels']` renders it back on this Mac's GPU at the
  request's `size` and returns `{rev, outcome: presented, snapshots: [{sha256, w, h, light}]}`, where `light: {clipped,
  crushed, key_ev}` (#1939) is render.exposure's measure on the kept subject's pre-tone px, read back to the CPU. A
  snapshot whose kept item shows no px carries no `light`.
- `render.exposure` (#1938), as a claim's requirement judged by `verdict`, draws the revision at the document's own
  size, reads its whole pre-tone image back and measures the kept subject's px on the CPU: a row with
  `results: [{doc, t, subject, px, clipped, crushed, key_ev, exposure, pass}]` and its `fingerprint`.
- `reduction_leaves_out_last_rows` isn't a planted name at the base: a scenario carrying it is refused as bad input.
- A release `deep-show` built at the base refuses to start: its first answer is `{ok: false, code: "seal_refused",
  reason: "kit_failed", modules: ["motion"], …}` (the kit ledger it embeds records motion failing the canvas
  conformance kit at its digest). The debug build starts. So criterion 2's timing can't run at the base.
- **A gap this suite steps around, not one it tests:** at the base, a 3D scene's camera `fit` (with no shot) isn't
  solved. `camera.rs`'s `Spec::frame` is called only by the core's 2D test draw, and a 3D camera framed by `fit` keeps
  `rig`'s placeholders, a distance of 1 m and a view width of 1 m, whatever `keep`, `fill` and `pad` say. A scratch
  probe at the base (outside the repo, not kept) showed it: #1939's kept 0.2 m cube at 320 × 240 through its
  perspective camera, with `fill` left at its default, set to 1 with `pad` 0, and set to 0.2 with `pad` 0, drew one
  snapshot (one SHA-256) with render.exposure's `px` 9604 each time, as at 1 m, where `fill` 1 would make its near face
  240 px tall. The fixture below is sized so the framing the design defines and the placeholder draw the same picture, so
  criterion 1 holds the reduction to its numbers whether or not that gap is closed (Readings, below). It is reported
  to the issue's owner as a separate finding.

## Run them

Each file builds `deep-show` with cargo (`--no-default-features --features full`) and draws on this Mac's GPU, so they
run one file at a time. The implementer adds these lines to `scripts/lanes.mjs`, beside #1939's; this README is the
instruction, and this job edits nothing outside its folder:

```js
// #2513's files each build deep-show and draw on the GPU; ac2-budget times the readings on a reference Mac (building
// deep-show for release there).
alone.push('tests/acceptance/2513/');
timed.push('tests/acceptance/2513/ac2-budget.test.ts');
```

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/2513 --no-file-parallelism --testTimeout=600000 ac1-agreement.test.ts
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/2513 --no-file-parallelism --testTimeout=600000 ac2-budget.test.ts
npx tsc -p tests/acceptance/2513/tsconfig.json   # type-check
```

Each file first runs `cargo build --locked --bin deep-show --no-default-features --features full` (with the 1.99.1
toolchain put on PATH), copies the binary out of `target/` (honoring `CARGO_TARGET_DIR`; `CARGO_INCREMENTAL` and
`CARGO_PROFILE_DEV_DEBUG` default to `0`), and fails each test whose build failed. Every `it` passes its own timeout
(an hour, four for the timing), which overrides `--testTimeout`. Off macOS, without cargo, or where the verdict's row
says the frame couldn't be drawn on a GPU (`gpu_unavailable`, `unsupported_platform`, a `software_adapter`), a test
fails with a message starting `INCONCLUSIVE:`; none passes or skips. Tests print the issue's proof as lines starting
`PROOF #2513`. Every test writes into temporary folders it deletes.

## The surface under test

**No new binary, no new call and no new field.** The suite drives `deep-show run` (one scenario line in, one answer
line out; for the timing one process kept open, a scenario a line, as #412's budgets do) with #393's `deep_show` and
`revisions`, #403's `claims` and `verdict`, and #387's `planted`, exactly as #1939's suite does. It adds one planted
name.

- **The documents** are the working agent alpha's (`sess-alpha`): each scenario mints them on panel `main` with no
  revision, and alpha's `deep_show` sends each as a whole revision in the agent's form (no `id`, no `layers`, no item
  `layer`): `{call: "deep_show", session: "sess-alpha", doc, document, t: "0s", size: [1936, 1584], include: ["issues",
  "pixels"]}`.
- **`deep_run`'s render.exposure on the same revision** is a claim of alpha's whose one deliverable is the document
  and whose one requirement is `check: {kind: "render.exposure"}` (every field at its default, so its subject is the
  kept items), judged by `{call: "verdict", claim}` after the deep_show, as #1938's and #1939's suites judge it. The
  test reads the row's `results` entry for the document at `t: 0` (its `px`, `clipped`, `crushed`, `key_ev`), and the
  verdict's `key.revisions` entry for the document (`rev`, `hash`), which must be the deep_show reply's `rev` with the
  hash `{call: "revisions", doc}` gives that rev.
- **The readings** are #1939's, unchanged (the issue's Scope: "the readings' fields … as #1938 and #1939 left them"):
  each snapshot entry with pixels carries `light: {clipped, crushed, key_ev}`; a snapshot whose kept item shows no px
  carries none (`light` absent, null, or without the three numbers).
- **The planted program** (the scenario's `planted`, reachable only there). The implementer adds it beside the
  scenario's other planted names and names it in `crates/deep-show/src/main.rs`'s planted match:

  | Name | The wrong program | Criterion |
  |---|---|---|
  | `reduction_leaves_out_last_rows` | render.exposure's one GPU reduction leaves out the frame's last 16 rows (as a dispatch that rounds the frame's 1584 rows down to whole 32-row groups would, reading 1568), for every frame it reduces, so render.exposure's numbers and the snapshot readings, which run on it, both measure without those rows; everything else as shipped | `#2513.50c62d71` |

## Fixtures (helpers.ts `fillDoc`)

Metres, +Y up. A `scene` document of 1936 × 1584 px with `requires.modules: {scene3d: "^1"}`, viewed through `cam`,
with no number and no number word in any text (title, description: #1938's contrast redraft found a number in a text
fails the document's own check):

- `cam`: an orthographic `camera@1`, `target` (0, 1, 0), `orbit {azimuth: 0, elevation: 0}` (level, from +Z), near
  0.05 m, far 50 m, `fit: {keep: [<kept>], fill: 1, pad: 0}` (framing sets the view width, so no view width, position
  or orbit distance sits beside it), and `exposure` EV100 1 − log2 1.2, a scale of 1 ÷ (1.2 × 2^EV100) = ½
  (render.exposure's own fix).
- `sky`: black, no ambient light. `grey-mat`: an unlit, opaque, double-sided material of linear grey 0.18 (middle
  grey), so each of the card's px is 0.18 at the camera's exposure.
- `card`: a `mark.box@1` 1584/1936 m (9/11 m) square and 0.05 m thick at (0, 1, 0) in `grey-mat`, face on to the
  camera: the kept subject.

**What the criteria expect of it, from the design.** `fit.fill` is the share of the frame's shorter side the kept
items span; the shorter side of 1936 × 1584 is its height, so `fill` 1 with `pad` 0 makes the card's side span all
1584 px of it, the issue's "framed to fill a 1936 × 1584 frame's height". Through an orthographic camera that makes
the view 1936 px × (9/11 m) ÷ 1584 px = 1 m wide, 1936 px a metre across and up, so the card draws a 1584 × 1584 px
square at the frame's centre, edges on whole px, with 176 columns of black sky on each side:

| Expected | Value | From |
|---|---|---|
| the card's area in the frame | 1584 × 1584 = 2 509 056 px | fill 1, pad 0, face on, square |
| its edge px | 2 × (1584 + 1584) = 6336 px (the square's outline) | criterion 1's "within its edge px" |
| its key EV | log2(0.18 × ½ ÷ 0.18) = −1 EV, within 0.002 EV | its grey at the camera's exposure |
| readings against render.exposure | each of clipped, crushed, key_ev within 1e-6 | criterion 1 |
| under the planted program | px fewer than 2 509 056 − 6336 (it counts 1584 × 1568 = 2 483 712) | criterion 1's "counts fewer px" |

Nothing is clipped or crushed (0.09 is far inside both limits). At −1 EV render.exposure's row is FAIL on its key, so
its fix's measure at the metered EV runs too; no test reads the verdict or the fix (#1938's suite does).

| Fixture | Keeps | Holds the stand-in | Used by |
|---|---|---|---|
| the frame-filling card | `card` | no | criterion 1, both tests |
| criterion 2's "on" | `card` | yes: `stand-in`, an invisible (`visible: false`) card of the same size where the card is | criterion 2 |
| criterion 2's "off" | `stand-in` | yes | criterion 2 |

Criterion 2's two documents differ only by the item the camera keeps, which has the same bounds either way, so they
draw one picture (the test checks one SHA-256) and their render-backs differ by the readings alone.

## Criteria to tests

IDs are `#2513.` and the first 8 hex digits of the SHA-256 of each criterion's text, `- [ ] ` dropped, trimmed and
whitespace collapsed (`criterionId` in `scripts/proof-change.mjs`): `50c62d71`, `ea6f22ea` and `296f5cfc`. Each file
holds its criterion's ID as a `const ID`, and every test's name starts with `${ID}`.

| ID | File (tests) | What it asserts |
|---|---|---|
| `#2513.50c62d71` | `ac1-agreement.test.ts` (2) | (1) In one run on the frame-filling card: the verdict judged the revision deep_show rendered back (its `rev`, and the hash `revisions` gives it); the judge `judge` finds nothing: each snapshot is 1936 × 1584 px and carries `light`, its clipped, crushed and key_ev each within 1e-6 of render.exposure's `results`; render.exposure's `px` is 2 509 056 within 6336; its `key_ev` is −1 within 0.002. (2) Under `reduction_leaves_out_last_rows`, the same calls: render.exposure's `px` is under 2 509 056 − 6336, the judge fails, and every failure names the snapshot's SHA-256 |
| `#2513.ea6f22ea` | `ac2-budget.test.ts` (1) | On any machine, on the debug build: at 1936 × 1584 the "on" render-back's snapshot carries readings, the "off" one's none, both one snapshot of 1936 × 1584 px with the same SHA-256. Then, only on a reference Mac by its hardware (else INCONCLUSIVE before timing): deep-show built for release and kept open, one warm-up run and five of 20 rounds each, on and off alternating which goes first; a run's value is median(on) − median(off) wall time (a negative one read as 0); `judgeLimit(20 ms)` from `scripts/benchmark.mjs`: FAIL fails, PASS passes, anything else (a loaded Mac's reading among them) INCONCLUSIVE |
| `#2513.296f5cfc` | none here | "`tests/acceptance/1939/` and `tests/acceptance/1938/machines.test.ts` pass unchanged": those suites are the proof, run as their READMEs say (`npx vitest run --root tests/acceptance/1939 --no-file-parallelism` and `npx vitest run --root tests/acceptance/1938 --no-file-parallelism machines.test.ts`), with no file under either folder changed (`git diff --stat <base> -- tests/acceptance/1939 tests/acceptance/1938` empty). This job writes no copy of them |

Wrong programs each file fails on are in its header. On the base, criterion 1's first test meets the issue's expected
values (the base already measures on the CPU what the reduction must give: px 2 509 056, key −1.000548 EV, the
readings equal to the check's) and its second fails at an assertion (the scenario is refused as `bad_input`: no such
planted name). Criterion 2's structure holds on the base, and its timing reads INCONCLUSIVE: the base's release
`deep-show` refuses to start (`seal_refused`, `kit_failed`, module `motion`), so nothing is timed; on a release build
that starts, a reference Mac at rest would time the base's CPU readings against the 20 ms. `BASE-FAILURE.txt` has what
the base printed.

## Readings where the issue and design leave a choice

- **"Framed to fill a 1936 × 1584 frame's height (`fit` with `fill` 1 and `pad` 0)"** is the document's camera `fit`
  with those two fields, its kept card face on and square, so its side spans the shorter side, the height. The camera
  is orthographic so the card's area doesn't hang on a lens's depth (a box's near face draws larger than its far face
  in perspective), and its size, 9/11 m, makes the framed view 1 m wide: the same picture as the base's unsolved
  placeholder (What the base already does). A program that solves `fit` and one that doesn't draw it alike, so
  criterion 1 judges the reduction, not the framing.
- **"The subject's area in the frame within its edge px"**: the square's 1584 × 1584 px within the px along its
  outline, 2 × (1584 + 1584). Its edges fall on whole px, so the honest count is expected to be exact; the tolerance
  is the criterion's.
- **"Its key EV is the subject's grey at the camera's exposure"**: log2 of the card's linear grey times the camera's
  exposure scale, against middle grey (Fields: "the subject's mean log luminance against middle grey"): −1 EV.
- **"Agree within 1e-6"** compares the three numbers a snapshot's readings carry (#1939's fields, which the issue
  keeps) with render.exposure's `results` at `t: 0`, the time both draw. `px` is render.exposure's, since the readings
  carry none.
- **"A planted reduction that leaves out the frame's last rows"**: the last 16 rows, the rows a dispatch rounded down
  to whole 32-row groups loses at 1584 rows. Fewer than 5 rows would hide inside the edge px (each row is 1584 of the
  card's px, the tolerance 6336), so the plant names a count well past it. It sits in the one reduction the check and
  the readings share, so they still agree with each other; it is caught by the px.
- **"Fails, naming the snapshot"** is the test's judge: each failure line names the snapshot's SHA-256, including the
  px and key failures, which are render.exposure's numbers on the snapshot's revision.
- **`deep_run`'s render.exposure** is the claim verdict `deep-show run` gives through `{call: "verdict", claim}`, as
  #1938's and #1939's suites judge it: the surface the base has for a requirement judged on a deliverable's current
  revision.
- **"Add under 20 ms to a render-back"** is on against off in one process, as #1939's criterion 2: the same picture
  rendered back with readings (the kept card) and without (a kept stand-in that shows no px), so the difference is what
  the readings add. "Off" reads nothing for the readings, as #1939 left it.
- **"On the reference Mac"**, with the Proof's "a reading where the Mac is loaded": the timing runs on any reference
  Mac by its hardware (model, chip and memory, the lane's list), loaded or not, and prints its five runs and the load
  at each run's start and end as a `PROOF #2513` line; `judgeLimit` alone decides, and only a reference Mac on mains
  power, Low Power Mode off, thermal state nominal and the load within its cores can make it PASS or FAIL. Off the
  reference Macs nothing is timed. Timings come from a release build; the debug build only checks the structure.
- **A release build that refuses to start.** A release `deep-show` whose seal refuses it answers its first scenario
  `{ok: false, code: "seal_refused", …}` and presents no render-back, so there is nothing to time: the test fails
  `INCONCLUSIVE:` with that answer, never PASS, and never FAIL, since the readings' time wasn't measured. Any other
  refusal or an early exit fails the test as it stands. At this base the release build is refused this way
  (`BASE-FAILURE.txt`), so the timing waits on a base whose release build starts.

## Not tested

No criterion asks for these, so none is tested: render.exposure's verdicts, limits and fixes beyond what #1938's suite
proves (the Scope's "nothing else changes" is criterion 3's suites); how many KB the reduction reads back (the Scope
says a few KB, but no criterion measures it); the readings' memory; readings at other times than the start; other
subjects, sizes or perspective cameras; the 3D `fit` gap above.
