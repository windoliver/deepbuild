# Acceptance tests for #3507: the geometry pass's shaded fragments are counted, and opaque solids shade a pixel once where the count says they don't

Written first, blind, from issue #3507 (its two opening paragraphs, `Runs on:`, Scope, five acceptance criteria and
Proof line; it has no comments), the design sections it links and those they lean on, and base commit `5a81b58de`
(origin/main, whose last merge is #3353) with what #3031 lands laid over it, by a job that never saw an
implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding). Lean: one test per criterion, one more where a clause needs a run of
its own, and the planted programs below.

**Criterion 2 was reworded by the owner on 2026-11-26**, after this suite was written: the count is now "from 1 to 2
a covered pixel", and the report gives each fixture's count. Its ID and its test are a second blind job's, in
`tests/acceptance/3507-redraft-ac2/`. This suite's first draft, `ac2-classes.test.mjs`, is kept as written, by hand
only, and carries no criterion ID. What this README says of criterion 2 is of the criterion as first written, unless
it says otherwise.

## Files

| File | Criterion | What it runs |
|---|---|---|
| `ac1-two-walls.test.mjs` | `#3507.f9beb02c` | the two walls both ways in the overdraw mode; then the same on the planted count |
| `ac2-classes.test.mjs` | criterion 2 as first written: by hand, no ID. The criterion's test is `../3507-redraft-ac2/`'s | the six class fixtures, 300 frames each, in the overdraw mode |
| `ac3-report.test.mjs` | `#3507.dc916f1d` | #3031's every-pass fixture, 300 frames, in the overdraw mode; the report against that count |
| `ac3-branch.test.mjs` | `#3507.dc916f1d` | what the report says of the pass: unchanged, against the merge base's frames; changed, against the count before |
| `ac3-timing.test.mjs` | `#3507.dc916f1d` | where a pass changed, five rounds that alternate with the merge base |
| `ac4-hashes-418`, `-424`, `-428`, `-465`, `-1637.test.mjs` (the body is in `ac4.mjs`) | `#3507.f3ae7c70` | one of the five suites, whole, each of its frames drawn again by the merge base's build |
| `ac5-unedited.test.mjs` | `#3507.25e79c7f` | git: what differs from the merge base under `tests/acceptance/` |
| `judge.mjs` | | the judges: each decides a criterion from what a test read |
| `drive.mjs` | | the binaries, the scenario, the merge base's checkout, the fixtures |
| `lease.mjs` | | the GPU lease's file, as a test takes it and lets it go |
| `record.mjs`, `record.config.mjs` | criterion 4 | the recorder a suite runs beside, and the vitest config that adds it |
| `fixtures/two-walls.nearer-first.json`, `fixtures/two-walls.farther-first.json` | criterion 1 | the two walls, in both orders |
| `lane.json` | | the folder runs alone |
| `BASE-FAILURE.txt` | | each file run once at the base, and what the probes before it showed |

## What was read

- The issue, and what the checkout holds of the issues it names: `docs/spikes/3031/` (README, `count.mjs`,
  `fixtures/`, the two kept outputs' shapes, and the mode's own largest count in each kept frame) with
  `spikes/3031/src/main.rs` and `tests/acceptance/3031/README.md`.
  #241, #3506 and #2705 have no suite at the base and no criterion reads them.
- `docs/canvas-primitives.md`: The cost model; Render-back; Render-back: diagnostic modes; Look `look@1`: ao; Material;
  Object: see-through order; Determinism class. `docs/technical-design.md`: Numbers version 0 has to hold (Every task
  carries its own budgets, The reference Macs); How we know version 0 works (Criteria to tests, Closed issues stay
  proven, Criteria in a checked shape, Wrong programs, The edit guard, Dogfooding, Tests written first, Repo guards).
  `docs/parallel-proof.md` sections 5, 7 and 12a. AGENTS.md, CONTRIBUTING.md.
- At the base, for names, shapes and conventions, never for expected values:
  `crates/deep-scene3d-render/src/diag.rs` and `diag.wgsl` (`Diag::Overdraw`, `DiagCounts`, `geometry`, `count_fs`,
  `max_value`), `lib.rs` (`SetKey`, `CULL_SHIFT`, `Batch`, `prepare_batch`, `encode`, `opaque_pipeline`, `mesh_pipeline`
  and `mesh_culled`), `mesh.rs` (the box's faces), `created.rs` (`feature_set`);
  `crates/deep-canvas-scene3d/src/scene.rs` (`Solid`, `Camera::clip`, a layer's order); `crates/deep-show/src/`
  `modes.rs` (`MODES`, `view_of`, `mode_show`, `mode_3d`, the `overdraw` row), `main.rs` (the `deep_show` parse, the
  scenario's `planted`), `hub.rs` (`present`, `flicks`), `maps.rs` (`evaluate3d`), `scene3d.rs` and `scene3d/look.rs`
  (the look a document names), `kit/lease.rs`, `probe.rs`; `crates/deep-gpu-layer/src/main.rs` (`run`, `--planted`,
  `draws_black`), `view3d.rs` and `view3d/parse.rs` (`from`, `frames`, `fps`, `capture`, `timings`, `counts`, the
  reply); `scripts/proof-change.mjs`, `proof-runs.mjs` (tags, `atAssertion`, a file's 20 minutes), `benchmark.mjs`
  (`fingerprint`, `references`, `judgeLimit`), `lanes-lists.mjs`, `wait-ratchet.mjs`, `lease`; `benchmarks/canvas/` and
  `canvas.mjs`; the suites `427/`, `1637/`, `1173/`, `3262/`, `3016/` (its `frames.test.ts` and recorder, the same
  criterion's words for four other suites), `2516/`, `2386-redraft-ac6-hashes/`, `1719/` and the helpers of `418/`,
  `424/`, `428/` and `465/`.
- Not read: any other checkout, branch or ref, GitHub, the web, and nothing of the work. `ac5-unedited.test.mjs`,
  run at the base, asks git for `merge-base HEAD origin/main`, which prints a commit's ID and nothing of it.

## How to run

```sh
npm ci                                                # once, if node_modules is missing
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
cargo build --locked --bin deep-show --bin deep-gpu   # each file builds what it drives when DEEP_BIN_DIR doesn't supply it
export DEEP_3507_BASE=<a checkout of the merge base, built the same way>   # criterion 4, and criterion 3 against the merge base

node --test tests/acceptance/3507/ac1-two-walls.test.mjs
node --test tests/acceptance/3507/ac2-classes.test.mjs        # by hand only: criterion 2's first draft
node --test tests/acceptance/3507/ac3-report.test.mjs
node --test tests/acceptance/3507/ac3-branch.test.mjs
node --test tests/acceptance/3507/ac3-timing.test.mjs
node --test tests/acceptance/3507/ac4-hashes-418.test.mjs     # and -424, -428, -465, -1637
node --test tests/acceptance/3507/ac5-unedited.test.mjs
for f in tests/acceptance/3507/*.mjs; do node --check "$f"; done   # the files are plain modules: no type-check
```

The test files are node:test's. Never run vitest with this folder as its root: its default include matches
`*.test.mjs`, and a file loaded that way would start its tests, its cargo build among them, inside vitest's worker
with vitest reporting none. `drive.mjs` refuses to load there (it throws BLOCKED where `globalThis.__vitest_worker__`
is set), so nothing of a file runs under vitest.

macOS on a Mac of a reference model, Node 24.22 first on `PATH`, `git`. One file at a time: each draws on Metal and
holds the machine's GPU lease while it does.

| File | Needs | Takes |
|---|---|---|
| `ac1-two-walls` | `deep-show` | four runs of `deep-show run`, a frame each |
| `ac2-classes` | `deep-show` | 1,801 frames at 480 × 270 to 1280 × 800, each class's 300 in two runs side by side |
| `ac3-report` | `deep-show`; #3031's fixture; the report | 301 frames at 3456 × 2234, in four runs side by side |
| `ac3-branch` | the report; unchanged: `deep-gpu` and `DEEP_3507_BASE`; changed: `deep-show` | unchanged: four frames by each build; changed: 300 frames at 3456 × 2234 |
| `ac3-timing` | the report; changed: `deep-gpu`, `DEEP_3507_BASE`, a machine that can judge a time | unchanged: nothing; changed: twelve runs of 300 frames at 3456 × 2234 |
| `ac4-hashes-<n>` | `deep-gpu` and `deep-show`, `DEEP_3507_BASE` with both, vitest | the suite's own run with each of its frames drawn twice: #3016's four suites took hours |
| `ac5-unedited` | git | under a second |

Read at the base on a loaded Mac17,10 (BASE-FAILURE.txt): a frame of a class's fixture takes about 0.1 s in the
overdraw mode and a frame of the every-pass fixture about 0.7 s with four runs side by side, so the classes' 1,800
frames are about 3 minutes and the every-pass fixture's 300 about 4. A file's runs may take 18 minutes together,
the proof lanes' 20 less room to stop; past that a run is stopped by its own timeout and the file is INCONCLUSIVE.
`ac3-timing` allows itself 110 minutes and an `ac4` file 8 hours, as #3016's `frames.test.ts` does; the proof lanes
stop either at 20, and then it is not run, never passed. Temporary folders are `deep-3507-*` under the system's
temporary folder and are removed. Every process a test starts ends on its own or by its own timeout, which signals
that child alone. An `ac4` file runs another suite, which writes what it writes (#428's taste test rewrites
`docs/evidence/428/`, with the same bytes while no pixel changed; #424's writes under `target/acceptance/424/`); the
file removes only vitest's cache folder in that suite's folder, when the run made it.

## The surface under test

Every name below that the issue or the design doesn't give is this suite's choice and a requirement on the
implementer, exactly as spelled here. Each failure starts with one of the four states: `FAIL` (the program says
otherwise; an assertion failure), `BLOCKED` (a reading is missing or unrun), `INCONCLUSIVE` (what was read can't
decide), `INVALID` (not in this shape); the last three end a test with a plain error, never a pass.

### 1. The count, on the overdraw mode's frame row (yours)

The overdraw view is reached as the base reaches it and as #427's suite reads it: `deep-show run`, one scenario line
in, a `deep_show` call that shows a document, then `deep_show` calls with `mode: "overdraw"` and no document, each
with `t` and `size`. No new call, no new mode. The mode's reply already holds one row in `drawn`,
`{"id": "frame", "what": "overdraw", "max": n}`. That row gains two fields:

```json
{ "id": "frame", "what": "overdraw", "max": 4, "shaded": 38400, "covered": 19200 }
```

| Field | Unit | Meaning |
|---|---|---|
| `max` | fragments | the base's: the most fragments any pixel took, every face, depth ignored. Unchanged |
| `shaded` | fragments, a whole number | what the geometry pass shades in this frame, summed over the frame: the fragments of the pass's opaque solids, drawn in the pass's order, back faces culled as the pass culls them, that the pass's depth test lets through, at one sample a pixel |
| `covered` | pixels, a whole number | the frame's pixels an opaque solid covers: those on which at least one such fragment lands, whether or not depth lets it through |

The frame's pixels are the snapshot's `w × h`, which the reply already gives. A test works the quotients out itself:
`shaded ÷ covered` is the count a covered pixel, `shaded ÷ (w × h)` the count a pixel. A row without both fields as
whole numbers reads "the overdraw view gives no count of what the geometry pass shades", which is the base's failure.

### 2. The planted count (yours; criterion 1 names it)

`shaded_count_skips_depth_test`, a scenario's `planted` (`deep-show run`'s input `{"planted":
"shaded_count_skips_depth_test", …}`), reachable only there: the view's count takes every fragment of the same solids,
in the same order, with the same faces culled, at one sample, and leaves the depth test out. `covered` is as shipped.
Everything else is the shipped program. On the two walls it must read `shaded = 2 × covered` in both orders, and
`wallProblems` must fail it with exactly `FAIL: two walls, the nearer drawn first: the count is 2.000 a covered pixel
(38400 fragments over 19200 covered pixels), not 1`.

### 3. The planted pass (yours; only if a pass changes)

`geometry_pass_at_merge_base`, a scenario's `planted` the same way: the geometry pass draws its opaque solids as the
merge base's pass does (the merge base's order, its own depth cleared before it draws), and the overdraw view counts
that pass. It is the merge base kept as a wrong program, as the renderer's `Planted` keeps other ones: the merge base
itself has no count, so this is the only way a test's own run sees what its pass shades. A change that changes no
pass adds no such name, and no test asks for it then.

### 4. The report, `docs/evidence/3507/README.md` (yours)

"The PR's report" is read as this file, where a change keeps its report and evidence; a test can't reach a pull
request. The tests read these lines of it, each on one line, with anything before and after:

```
Shaded on `every_pass`: 1.016 a covered pixel, 0.868 a pixel, over 300 frames
Geometry pass: unchanged
```

or, where a pass changed:

```
Shaded on `every_pass`: 1.021 a covered pixel, 0.872 a pixel, over 300 frames
Shaded on `every_pass` before: 1.304 a covered pixel, 1.114 a pixel, over 300 frames
Geometry pass: nearest first, p50 3.21 ms before and 2.87 ms after
```

(The numbers are made up.) The counts carry three decimals or more and are the fixture's means, below; `before` is
the count under `geometry_pass_at_merge_base`. The way is one of `unchanged`, `occluders' depth`, `depth pass`,
`nearest first`: the Scope's three, and none. The two times are the geometry pass's p50 in ms on the merge base and
on the change. Everything else in the report is the implementer's, the Proof line's other parts among it, but
the six lines criterion 2's redraft reads (`../3507-redraft-ac2/README.md`).

### 5. The merge base's checkout, `DEEP_3507_BASE` (yours)

An environment variable naming a built checkout of the merge base. It is a path to run, not a switch: it selects no
planted program. The tests refuse it, BLOCKED, unless git reads it as being at `git merge-base HEAD origin/main` of
this checkout with no change under `crates/`, `vendor/`, `Cargo.toml` and `Cargo.lock`, it is another folder than
this checkout, and its `target/debug/` holds the binaries the file needs (`deep-gpu`; for an `ac4` file `deep-show`
too), built as the acceptance helpers build them:

```sh
DEEP_3507_BASE=~/dev/deepbuild-base node --test tests/acceptance/3507/ac4-hashes-424.test.mjs
```

Four more variables are this suite's own wiring, set by `ac4.mjs` for the vitest run it starts and read by
`record.mjs`, never set by hand: `DEEP_3507_FRAMES` (the recorder's JSON-lines file), `DEEP_3507_OWN_BIN` (a
temporary folder of copies of this checkout's own debug `deep-gpu` and `deep-show`, taken before the suite runs)
`DEEP_3507_TWIN_BIN` (the merge base checkout's `target/debug`) and `DEEP_3507_LEASE_PID` (the ID of the process
that holds the GPU lease for the run). The first three carry a path; none selects a program.

### What the base already has, which must stay as it is

- `deep-show run`'s scenario (`evidence`, `sessions`, `processes`, `panels`, `docs`, `window`, `clock`, `record`,
  `planted`, `calls` each with `at`), `deep_show` with `document`, `t`, `size`, `include`, and with `mode: "overdraw"`;
  the mode reply's `outcome: "presented"`, `snapshots[0].{w, h}` and `drawn`; an unknown `planted` answered
  `{"ok": false, "code": "bad_input"}`. A document names its look as `look: {asset: "<id>@1"}` with
  `assets.<id>.sha256`, the look's file in the evidence store.
- `deep-gpu run [--planted <name>]` with `{out, calls}`; `view3d` with `look`, `doc`, `size`, `fps`, `from`, `frames`,
  `capture`, `timings`, `counts`; its reply's `passes` and each frame's `frame`, `pixel_hash`,
  `passes_ms["scene3d.geometry"]`, `draws`, `indirect_draws` and `encoded`; the planted `draws_black`.
- `scripts/benchmark.mjs` (`fingerprint`, `references`, `judgeLimit`), `scripts/lanes-lists.mjs` (`timed`, `byHand`),
  `tests/vitest-setup.ts`, and the GPU lease's file, `~/.cache/deepbuild-gpu/lease`.

### The machine, the lease and the binaries

- **Counts and hashes** are read on a Mac of a reference model (`scripts/benchmark.mjs` `references`: model, chip
  and memory), headless. Off macOS there is no GPU: BLOCKED, as the issue says of the counts. On another Mac a count
  or a hash is a reading: INCONCLUSIVE. Power, thermal state and load decide nothing for a count or a hash.
- **The lease.** Neither `deep-show run`'s mode calls nor `deep-gpu run` takes the GPU lease at the base, so each
  test takes the file `~/.cache/deepbuild-gpu/lease` for as long as it draws, as `spikes/3031` and #2516's suite do,
  and lets it go after. A live process holding it is BLOCKED, naming the process; nothing is drawn, and no test
  waits for it. A program under test that came to take the file itself for a mode call, with no hub, would wait on
  the test: such a run ends INCONCLUSIVE at the file's time limit. In an `ac4` file's run a suite's `deep-show`
  child may take the file itself (a kit does, and waits 300 s for it): the recorder lets the file go for each such
  child and takes it back after, and a lease it can't take back is BLOCKED.
- **The binaries** are `DEEP_BIN_DIR`'s when a proof run supplies them, else this checkout's debug builds, built by
  the file with `cargo build --locked --bin deep-show` or `--bin deep-gpu` (`CARGO_INCREMENTAL` and
  `CARGO_PROFILE_DEV_DEBUG` defaulting to 0, as the acceptance helpers default them). An `ac4` file builds both in this
  checkout's `target/debug`, whatever `DEEP_BIN_DIR` supplies, and copies them aside before its suite runs; the suite then builds and copies its own, and the recorder knows a child
  as this checkout's own build by its bytes being a copy's. (#418's kit files build `deep-show` with a planted
  feature onto the same path in `target/debug`; that build is no copy's, and is left out.)

## What the count is, and what a test holds of it

From the Scope's first line and the base's geometry pass (`lib.rs`: `prepare_batch`, `encode`, `opaque_pipeline`):

| Words | What they oblige the count to be | What a test holds of it |
|---|---|---|
| "what the geometry pass shades" | the fragments that reach shading in `scene3d.geometry`'s opaque draws | criterion 1's two orders; criterion 2's frames |
| "the opaque solids" | the solids the pass draws through its opaque sets (`Batch::solids`): not a per-pixel, faded, transmitting, blend or add part, not a shadow catcher, not a cast-only level. Lines, points, labels, images and the sky are no solids | nothing: no criterion gives a value for a fixture where a see-through part would change the count |
| "in the pass's order" | writer layers in layer order; in a layer, the sets in the pass's set order, a lower band's after the rest; in a set, its solids in the layer's order, the items' `order` keys, then their IDs; an instancer's batch as the rows the cull kept for the camera | criterion 1: two solids of one set, the earlier key drawn first. The order of sets, of layers and of kept rows isn't held |
| "back faces culled as the pass culls them" | each set with the pass's own cull: back faces where the solid has a material that isn't double-sided (front faces when it is mirrored), none where it has no material | criterion 1: the walls have such a material, so the planted count reads 2 both ways, not 4. See the finding below for a solid with no material |
| "against depth" | the pass's compare and depth write, from the depth the pass starts with | criterion 1: 1 with the nearer first, 2 with the farther first, and the planted count failing |
| "at one sample a pixel" | counted at pixel centres, one fragment a primitive a pixel, not at the pass's 4 samples | criterion 1: `covered` is the walls' 19,200 pixels exactly; any row with `covered` above the frame's pixels fails |
| "a covered pixel" | a pixel on which an opaque solid's fragment lands, after the cull, before depth | criterion 1, the same 19,200 |
| "over the frame's pixels" | the frame's `w × h` | the snapshot's size is held to the call's |

A fixture's count over its frames is #3031's kind of mean (`docs/spikes/3031/count.mjs`): each frame's quotient,
averaged over the frames. Criterion 2's "in every one of the 300 frames" is each frame's own quotient.

## Criteria to tests

Each test's name starts with its criterion's number and ID, `AC<n> #3507.<h8>`: the first 8 hex digits of the SHA-256
of the criterion's text as `scripts/proof-change.mjs`'s `criterionId` reads it, computed from the issue's body; they
came out as the brief gave them. `ac2-classes.test.mjs`'s test has no such start since its criterion was reworded:
it holds no criterion of the issue as it stands.

| Criterion | Test | What it asserts | Fails |
|---|---|---|---|
| AC1 `#3507.f9beb02c` two walls, 1 with the nearer drawn first and 2 with the farther; a planted count with no depth test reads 2 both ways and fails, naming the order | `ac1-two-walls.test.mjs`, first test (`wallProblems`) | each order's frame at 0 s: `covered` is 19,200; `shaded` is `covered` with the nearer first and `2 × covered` with the farther first | the base (no count); a count with no depth test; one that sorts or reads a finished depth (1 both ways); one at 4 samples or over the frame's pixels; one that counts both faces |
| | second test (`plantedWallProblems`) | under `planted: "shaded_count_skips_depth_test"` the same documents read `2 × covered` both ways, and the same check fails on the nearer drawn first and on nothing else | the base (BLOCKED: no such planted program, which is not the planted count failing); a planted count that isn't one; a check that passes it or names no order |
| Criterion 2 as first written (each class's fixture, 1 a covered pixel in every one of the 300 frames); reworded since, and tested by `../3507-redraft-ac2/` | `ac2-classes.test.mjs` (`classProblems`), by hand, with no ID | for each of the six classes, each of the 300 frames: `max` is 2 (no bar hides another), a pixel is covered, and `shaded` is `covered` | the base; a frame above 1; a frame not counted (BLOCKED); a frame where a bar hides another (INCONCLUSIVE) |
| AC3 `#3507.dc916f1d` the report gives the every-pass count; past 1.1 the change brings it to at most 1.05 and the pass's p50 is no higher; at 1.1 or under no pass changes and the report says so | `ac3-report.test.mjs` (`countOf`, `reportProblems`) | the test's own count of the 300 frames; the report's `Shaded` line gives it within 0.0005; `unchanged` only at 1.1 or under; a named way only at 1.05 or under, with a count before and two times, the later no higher | the base; a count the view doesn't give; past 1.1 with no pass changed; a changed pass above 1.05; a report that doesn't say |
| | `ac3-branch.test.mjs` (`samePassProblems`, `beforeProblems`) | `unchanged`: frames 0, 75, 150 and 225 by both builds have one pass list, the same timed passes and the same draws. A named way: under `geometry_pass_at_merge_base` the 300 frames count past 1.1 a covered pixel, and the report's `before` line gives that count | the base (no report); a pass or a draw added or dropped while the report says unchanged; a pass changed at 1.1 or under; a `before` the planted pass doesn't give; no merge base (BLOCKED) |
| | `ac3-timing.test.mjs` (`roundOf`, `timingProblems`) | a named way: five rounds after a warm-up, each side's median of `passes_ms["scene3d.geometry"]` over the 300 frames, the change's over the merge base's at most 1 by `judgeLimit`. `unchanged`: times nothing | the base (no report); all five rounds over by more than the margin (FAIL); a machine or a load that can't judge, or rounds neither all within nor all over (INCONCLUSIVE); no merge base (BLOCKED) |
| AC4 `#3507.f3ae7c70` every frame of the five suites hashes as on the merge base | `ac4-hashes-<n>.test.mjs` (`hashProblems`) | every hash a child of the suite prints equals the merge base's build's from the same input; every file of the suite not set apart ran; a frame under `draws_black` fails the same check | a renderer that changes a pixel of any frame; a frame one build draws and the other doesn't; a run that stops early or draws nothing (BLOCKED); no merge base (BLOCKED, the base's reading) |
| AC5 `#3507.25e79c7f` no acceptance test is edited | `ac5-unedited.test.mjs` (`editedProblems`) | `git diff --name-status --no-renames <merge base> -- tests/acceptance` lists additions only | a file under `tests/acceptance/` edited, deleted or changed in type, committed or not. Passes at the base |

## Readings where the issue and the design leave a choice

- **How the view gives its second count.** On the row the mode already returns, as two whole numbers. The design's
  modes return "what it drew as numbers" in `drawn`, and #427's suite reads the row; a second way of reading the view
  (a call on `deep-gpu`) would be a new surface the issue doesn't name. Whole numbers, so a test and a reader work
  the quotients out and nothing is rounded.
- **The two walls.** "Face the camera": an orthographic camera looks along −Z at the middle of both. "One wholly
  behind the other": the same 4 m × 3 m rectangle at z = 1 m and z = −1 m, so both cover the same 160 × 120 pixels,
  with edges on pixel edges. They have a material that isn't double-sided, so the pass culls their back faces and a
  wall is one fragment a pixel. "Drawn first" is the earlier `order` key in one layer: both walls are one shape with
  one material, so one set, and a set draws its solids in the layer's order. The two documents differ in the two
  keys and in the words that say so.
- **"Naming the order."** The planted count is wrong only with the nearer drawn first, where it reads 2 for 1. The
  failure names that order and no other.
- **"Where no bar hides another"** is a statement about the six fixtures, which a test checks before it judges a
  frame: the mode's own count, every face with depth ignored, is 2 for a bar alone and 4 where two bars share a
  pixel, so `max` of 2 says no bar hides another. A frame with another `max` is INCONCLUSIVE: the criterion states no
  count for it, and "every one of the 300 frames" can then not be shown.
- **The 300 frames** are #3031's: frame k at k ÷ 5 s, k from 0 to 299, `t` written `0s`, `0.2s` … `59.8s`; each
  fixture at its own size under the look #3031 counted it under (the perf lane's for a class, its own for the
  every-pass fixture), which the shown document names by asset as a document names its look.
- **The every-pass fixture's count** against 1.1 and 1.05 is the mean a covered pixel over the 300 frames, as #3031
  held its own threshold to a mean. A count is past a line by more than the rounding of that mean (1e-12).
- **How criterion 3's branch is known.** The count is the test's own. Past 1.1 no report can say `unchanged`, and
  above 1.05 none can name a way. At 1.05 or under both branches fit the count, so the report's line says which was
  taken and `ac3-branch` holds the line to a run: `unchanged` to the merge base's own frames, a named way to the
  count before.
- **"Before"** is counted on the changed build under `geometry_pass_at_merge_base`, since the merge base has no
  count. **"The change brings it to at most 1.05 there"** is the shipped view's count on the same 300 frames.
- **"No pass changes"** is shown from what a frame says it draws: `view3d`'s pass list, each frame's timed passes and
  its `draws`, `indirect_draws` and `encoded`, the same from both builds, on four frames a quarter turn apart. A
  change of order inside one draw, or of an attachment's load, doesn't show there; the count before and after would,
  and with no pass changed there is one count.
- **"The report says so"** is the line `Geometry pass: unchanged`.
- **The timing.** A round is the fixture's 300 frames by each build, each in its own process, one right after the
  other, the side that draws first alternating; one warm-up round, then five. "p50" is the median over a round's
  frames of the GPU's time for `scene3d.geometry` (the mirror's view's pass is the reply's to name; only that key is
  read). "No higher" is the change's p50 over the merge base's at most 1 in each round, judged by the design's rule
  for a timing (`judgeLimit`: all five within, or all five over by more than the larger of 5% and their spread, else
  INCONCLUSIVE; only on a reference Mac on mains power, Low Power Mode off, thermal state nominal, at a load under
  its cores). Both sides are debug builds, as #1637's and #2516's timings are: the time is the GPU's own.
- **"Every frame of" a suite** is, as #3016's suite read the same words, every `pixel_hash` a child process of the
  suite prints while it runs whole as its README runs it. Taken: each child that is this checkout's own debug
  `deep-gpu` or `deep-show` and runs without `--planted`. Left out: a suite's planted programs (wrong programs, not
  the renderer); a child of another build, which the merge base's checkout holds no twin of; children started
  otherwise than with `spawnSync`; and the files the lanes run under a timed grant or by hand, whose frames depend
  on the machine's load at that moment (at the base `1637/budgets.test.ts` is timed and `465/budgets.test.ts` is by
  hand; the lists are read when the test runs).
- **Where the merge base's hashes come from.** From the merge base's own build, in the same run: the recorder gives
  each child's command line and input once more to `DEEP_3507_BASE`'s binary of the same name, right after, and keeps
  both lists. No hash is kept in a file, so none can be a copy of the change's or another machine's. The second
  draw shares the first's `out` folder, where both write files named by their bytes' hash.
- **Criterion 5.** "Acceptance test" is every file under `tests/acceptance/`, a helper, a fixture and a golden among
  them. "Edited" is any difference from the merge base in a file the merge base holds. An approval doesn't let an
  edit through, which is what the test adds to the edit guard.

## A finding about criterion 2, for the owner (settled 2026-11-26)

Written before the owner reworded the criterion to "from 1 to 2 a covered pixel", which the redraft tests.

At the base the geometry pass culls no face of a solid that has no material: `prepare_batch` gives such a solid cull
0, and its set draws through the pipeline with no cull (`mesh_pipeline`). Each class's bars are such solids (a paint,
no material; #3031's kept run names their feature set `plain`). A box's faces draw in the order +X, −X, +Y, −Y, +Z,
−Z, and the class's camera stands on the +X, +Y, +Z side of every bar, so a bar's −X back face draws before the +Z
and +Y front faces that cover it, and passes the depth test there. By this reading of the code, not by a run, the
pass shades about 1.3 fragments a covered pixel on a class's fixture, and a count "as the pass culls them" would read
that. The issue's first paragraph says the pass culls back faces, and its criterion said 1. The first draft
asserts that 1. If the count the Scope describes reads above 1 there, the criterion as first written can't be met
with no pass changed; that was the owner's to settle, and the rewording settled it.

## What isn't asserted, because no criterion says so

- The Scope's "it adds no mode": the closed list is #427's suite's to hold. "Nothing of it feeds a check": the
  design's rule for every mode, held by #427's and #464's suites.
- The count on a fixture with see-through parts, with more than one layer or set, or with an instancer's culled
  rows, beyond the every-pass fixture's count being what the report gives.
- That the report gives the mode's own count beside each fixture's, the two walls or the hashes: the Proof line's,
  which a pull request shows; criterion 3 asks the report for the every-pass count. (The six classes' counts in the
  report are criterion 2's as reworded, and its redraft's to assert.)
- Which of the three ways is taken, and that the pass draws as the report's way says.
- "No pixel changes" beyond criterion 4's five suites.
- A task in `benchmarks/budgets.json`: no criterion says the perf lane records the timing.
- #2705, #3506, and transparent, glass and per-pixel parts: not in this task.

## What the implementer adds outside the folder

- `scripts/lanes-lists.mjs`, the `timed` list, one line: `timed.push('tests/acceptance/3507/ac3-timing.test.mjs');`
  (the file judges a time). The folder is alone by its own `lane.json`. For criterion 2's redraft, the `redrafted`,
  `byHand` and `alone` lines its README gives (`../3507-redraft-ac2/README.md`).
- The report, `docs/evidence/3507/README.md`, with the lines above and the redraft's six.
- Nothing else: no manifest, no dependency, no fixture.

## What was checked

Phase 1, with nothing built and no frame drawn:

- `node --check` on every module, and every name a test file imports is one its module exports.
- Every judge on a good input and on each wrong one (79 checks in a scratch script, not kept): each wrong input
  fails naming what its criterion names, and `settle` turns a FAIL into an assertion failure and any other state
  into a plain error.
- The recorder on stand-in binaries, alone and inside a vitest run with `record.config.mjs`: a child that is a copy
  of the checkout's build is drawn again by the twin, a planted child and another build are left out, a child whose
  output only mentions the words is no row, and the judge fails the changed frame.
- The lease, with the home folder moved into a temporary one so the machine's own file was never touched: taken,
  refused to another process, let go, a stale one taken; lent to a `deep-show` child and taken back; one that
  can't be taken back reads BLOCKED.
- `drive.mjs` refuses to load inside a vitest worker.
- `ac1-two-walls`, `ac2-classes` and `ac3-report` run whole against a stand-in for `deep-show` (a scratch script
  that answers a scenario with canned rows, named by `DEEP_BIN_DIR`, the home folder moved as above; 19 checks, not
  kept). It shows the files' own plumbing and nothing of the program: on rows as this README gives them both of
  criterion 1's tests pass and criterion 2's passes over 1,800 frames; on the base's row each fails at its
  assertion on "the overdraw view gives no count", the planted test BLOCKED; a frame above 1 fails naming the
  frame; a frame where a bar hides another is INCONCLUSIVE; `ac3-report` counts 300 frames and then fails on the
  report not being there.
- At the base: `ac5-unedited` passes; `ac3-branch` and `ac3-timing` fail on the report not being there;
  `ac4-hashes-418` and `-424` are BLOCKED on no merge base. None of them builds or draws there.

Not run: any file against the program (nothing is built), so no count, hash or time was read; `ac3-branch` past
its reading of the report, `ac3-timing`'s rounds and an `ac4` file's run of a suite, which need a report or a
merge base; and `scripts/repo-rules.mjs` (it starts `cargo metadata`). No file here holds a home path.

Phase 2, at the base (`5a81b58de`, the caller's debug builds) on a Mac17,10 at a one-minute load of 15 to 300. The
probes are scratch scripts that drive the base's two binaries as `drive.mjs` does, not kept; BASE-FAILURE.txt has
the runs. No probe showed a fixture, the driver or a judge wrong, and no file but this one changed after phase 1.

- `deep_show` presents every fixture as the driver sends it, with no issue: the two walls, the six class fixtures
  and the every-pass fixture at 3456 × 2234, the last seven with their looks named by asset. The overdraw mode draws
  each; the base's row is `max` alone: 4 on the walls, 2 on each class's fixture at frames 0, 150 and 299, 9 or 7 on
  the every-pass fixture. (#3031's kept counts give 2 in all 300 frames of each class, so the where that
  `classProblems` checks held in #3031's run; no test reads those files.)
- The walls' picture in the overdraw mode has 19,200 pixels off the ground, x 80 to 239 and y 60 to 179, in both
  documents: the pixels the documents give.
- The walls draw in the order their keys say: `view3d` with `counts` gives one draw of two instances for both
  walls, named by its first record, `near` in the nearer-first document and `far` in the farther-first; the
  object-ID target shows the nearer wall on all 19,200 pixels of both.
- `view3d` draws the every-pass fixture under its look with `from`, `timings` and `counts`: the reply has
  `passes`, and each frame `passes_ms` (16 passes, `scene3d.geometry` among them), `draws`, `indirect_draws` and
  `encoded`. Frames 0, 75, 150 and 225 drawn twice by the base read as one program to `samePassProblems`, and a
  pass added to one side's frame fails it.
- The walls hash the same twice as shipped and otherwise under the base's `draws_black`, and `hashProblems` fails
  that pair. The recorder on the base's real `deep-gpu`, the base standing in for the merge base: a copy of the
  build is known by its bytes, its six frames are drawn again and hash the same, and a `--planted` child's are left
  out.
- Each file run once under a test grant: BASE-FAILURE.txt. Each file's own `cargo build` found its binary fresh;
  no workspace crate was compiled.

Not checked at the base, where nothing can show it: a count, since the base has none (so nothing here says what the
count reads on any fixture, the finding about criterion 2 among it); an `ac4` file's run of a suite and the
recorder inside it, `ac3-branch` past its reading of the report and `ac3-timing`'s rounds, which need a merge base
or a report; and how long a whole suite takes with each frame drawn twice.

One step of this job went past its rules, and the guard in `drive.mjs` is what came of it: a scratch vitest run
with this folder as its root loaded the node:test files, and the first of them to reach its build started `cargo
build --locked --bin deep-show` in the checkout, outside the machine's build queue. It was stopped by its process
ID after four minutes, before any binary was linked; nothing was drawn and nothing in this suite comes from it.
