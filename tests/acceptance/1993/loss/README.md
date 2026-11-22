# Acceptance tests for #1993, part "loss": a device loss forced at step 900 of the 128 × 128 run

Written first, from issue #1993 (its scope, fields, 8 acceptance criteria, proof line and its one comment), its Oracle
page (no upstream test checks any criterion) and base commit `9550dc0f`, by a job that never saw an implementation.
This is one part of the suite, written apart from the others and merged side by side under `tests/acceptance/1993/`;
this part holds criterion 7 and imports nothing outside its folder. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test file, one
test, with the wrong program the criterion names.

## What was read

- Issue #1993 and its Oracle page.
- `docs/canvas-primitives.md`: Carried state (a seek that needs more steps than fit in one frame runs them across
  frames; exports, checks and goldens wait for every step); the lines on GPU device loss (every canvas module's
  declared resources rebuild from documents) and on a frame that reports settling. `docs/technical-design.md`: GPU
  operator. Neither document describes `stepped`, `carry`, a frame's `carried` or what a stepped state does when its
  device is lost: those are read from #252's suite, the base's code and the issue's Scope.
- At the base: `tests/acceptance/252/` (the model: README, helpers, `ring.test.ts`); `tests/acceptance/1993/fields/`
  (another blind part of this suite: its conventions, and its water ring document, copied here); `377/README.md` and
  `377/device-loss.test.ts` (the forced loss: `lose_device_at`, `device_losses`, a Frame's `settling`); how `140/gpu`,
  `1413` and `157` force a loss (by grep); `crates/deep-gpu-layer/src/{main,frames,compile,view3d,view3d/parse,opframe}.rs`,
  `crates/deep-effects-render/src/{docops,docops/methods}.rs`; `scripts/proof-change.mjs` and `scripts/proof-runs.mjs`.
- The base's binary, run while drafting: an unknown `--planted` name (exit 2, `bad_input`) and `{"call":
  "lose_device"}` (answers `lost_epoch` and `device_epoch`).

## What the base already does, and what it lacks

At `9550dc0f` a stepped compute operator carries storage outputs, each with a ring of checkpoints that are GPU copies,
and `view3d` reports each one's row on a frame (`carried`). The base forces a device loss in three places, none of
them a document's stepped state: `lose_device_at` on #377's `frames` call (a scene file's frames; the frame the
device is lost under is left out of the reply, `device_losses` counts the losses and each Frame says `settling`),
`{"call": "lose_device"}` between calls (#140) and a `lose_device` event of the live view (#1413, test-faults
builds). What it lacks, of what this part tests:

- **Carried textures.** A texture output's `carry`, a texture input's `step: previous` and `stepped.bound` are read
  past by the check, and a stepped operator that writes a texture doesn't run (its frames carry no `carried` row).
- **A loss under a stepped state.** `view3d` reads past `lose_device_at`; its reply has no `device_losses` and its
  frames no `settling` (they have #383's `settled`, whether the view's level-of-detail documents are resident, and
  #419's `samples.settling`, whether sub-samples are still being added: neither is about carried state).
- **The planted restore.** No planted program is named `restore_starts_from_clear_value`.

## Run it

It builds `deep-gpu`, so it runs with `--no-file-parallelism`, and `scripts/lanes.mjs` needs
`'tests/acceptance/1993/'` in its `alone` list, as `'tests/acceptance/252/'` is. This README is the instruction; the
implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/1993/loss --no-file-parallelism
npx tsc -p tests/acceptance/1993/loss/tsconfig.json   # type-check
```

The file builds its binary once with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked --bin
deep-gpu`, copies it out of `target/debug` to a temporary folder and fails the test if the build failed. The test
writes into its own temporary folder and deletes it. It runs on Metal: off macOS it fails with a message starting
`INCONCLUSIVE:`, never passing. Nothing is timed, so it needs no reference Mac (the issue: "Any Mac with a GPU for the
hash lines"). `BASE-FAILURE.txt` holds what was run at the base and the result there.

## The surface under test

**No new binary or call.** #377's `deep-gpu run [--planted <name>]` with its JSON-lines protocol, #429's
`check_operator`, #378's `view3d` with #483's `read` and #252's stepped operators and `carried`, each as the base's
suites use it. What the implementer has to provide, in the exact forms this test writes and reads:

### The forced loss, on `view3d` (criterion 7)

| What | Form this test writes or reads | Why it's the least |
|---|---|---|
| The loss, forced | `"lose_device_at": 900` on the `view3d` call: the device is lost, forced, while frame 900 draws; the GPU layer opens a new one and the play goes on to its last frame | #377's field of the `frames` call, with its spelling and meaning, on the call that plays a document |
| The losses counted | `"device_losses": 1` on that `view3d` reply | #377's reply field of the `frames` call. Not read on a play without `lose_device_at` |
| The frames of a play that lost its device | `frames[]` holds frames 0 to 1,800 once each, in order; frame 900, the one the device was lost under, may be left out | #377: "Frame d may be missing; every later frame is presented" |
| A frame reports settling | `frames[].settling: true` on every frame drawn before the state is rebuilt. On any other frame `settling` is `false` or absent (the test reads `settling === true`) | #377's Frame field `settling`, spelled the same. `view3d`'s own `settled` and `samples.settling` mean other things (above) and are not read |
| Where a frame's state is | `frames[].carried["water.height"].step` and `["water.rate"].step`: the step the carried state holds as the frame drew. While the state is being rebuilt it is behind the frame's step (or the frame has no such row); once rebuilt, both equal the frame's step | #252's reply field, "the step the carried state holds", unchanged, for a carried texture |
| The state hash | `read: ["water.height", "water.rate"]` with `capture: [1800]`: `frames[].read[key].file`, the SHA-256 naming `<sha>.f32` under `out` (f32 rows top-down; RGBA lanes at the base, the height in a texel's first lane) | #483's `read` of a texture output, unchanged |

The whole call, as written (the unbroken play leaves `lose_device_at` out):

```json
{"call": "view3d", "doc": "<out>/water-1993-loss.json", "look": {…fixtures/look.json}, "size": [64, 64], "fps": 60,
 "frames": 1801, "capture": [1800], "read": ["water.height", "water.rate"], "lose_device_at": 900}
```

After the loss the state is rebuilt across frames, each of which reports settling; how many steps a frame runs is the
implementation's (Carried state: "within the budget class's worker time each frame"). The test needs only that at
least one frame is drawn before the state is rebuilt, and that frame 1,800 holds step 1,800: from the loss, 1,800
steps in 900 frames, so two or more steps a frame.

### Carried textures (the 128 × 128 run's document)

| Field | Form this test writes | From |
|---|---|---|
| `outputs.<name>.carry` on a `texture` output of a stepped operator | `{texture: {format: "r32float", size: [128, 128]}, carry: {every: 60, budget: 16777216}}` (`water.height`, `water.rate`) | Fields, as the issue spells it |
| `inputs.<name>.from.texture: {op, output, step: previous}` | `{type: "texture", from: {texture: {op: "water", output: "height", step: "previous"}}}` (and `rate`); zeros before step 0; read with `load@1`, the value in the texel's first lane; written with `store@1` | Fields, as the issue spells it |
| `stepped.bound` | `stepped: {rate: 60, bound: {speed: 0.24, cell: 0.01}}` on `water` (`max` left at its 0.5; the ratio is 0.4) | Fields |
| A pass reads the grid | `{type: "texture", from: {texture: {target: {op: "water", output: "height"}}}}` in `water_view`, read with `load@1` | Scope; #483's input form |
| A carried texture's row on a frame | `frames[].carried["water.height"]`, `["water.rate"]`: `{step, ring: {…}}`, as a carried storage output's; only `step` is read | #252's reply field, for a carried texture |

These are the forms the "fields" part writes for its ring document, so the two parts agree.

### Planted program

A restore is the binary's, not the document's, so this wrong program lives in the binary, reachable only through
`--planted`:

| Name | The wrong program | Criterion |
|---|---|---|
| `restore_starts_from_clear_value` | After a lost device, the carried state isn't rebuilt by stepping from the start: every carried output starts from its clear value (zeros here) as the state of the step the device was lost at, 900, and the play steps on from there. It still counts the loss (`device_losses: 1`), still draws frame 1,800 holding step 1,800 and still answers `read` there | `#1993.e693a7be` |

## The fixture (helpers.ts: waterOps)

A showpiece scene, 65 s long: a camera, a box the pass draws over, and two operators, each declaring the cost the
check estimates for it. The look is #252's (`fixtures/look.json`, its ID changed).

- **`water`**: criterion 1's grid, 128 × 128 cells of 1 cm at 60 steps a second and 0.24 m/s, as height and rate of
  change in two carried `r32float` textures. Each step a cell's rate gains (c ÷ rate ÷ cell)² = 0.16 × the height's
  five-point Laplacian and its height gains the new rate; the rim reflects and nothing damps it, so the wave is still
  on the grid at step 1,800. Step 0 is the one drop at the centre, a bump of height 1 and σ 2 cells at rest, and no
  later step adds one: a grid of zeros stays zeros, which is what makes the planted restore's state differ.
- **`water_view`**: a pass that shades each pixel by its cell's height. No test reads its picture.

## Criteria to tests

The ID is the first 8 hex digits of SHA-256 of the criterion's text, trimmed, whitespace collapsed, `- [ ] ` dropped
(`scripts/proof-change.mjs: criterionId`), computed from `issue-1993-body.md`. The test's name starts with it.

| ID | Criterion | Test file: what it asserts |
|---|---|---|
| `#1993.e693a7be` | 7: a device loss forced at step 900 of the 128 × 128 run | `loss.test.ts`, one test, three plays of 1,801 frames, each in a process of its own. (1) Unbroken: the operators check; frames 0 to 1,800 are drawn; every frame holds both textures at its own step and none reports settling; the state at 1,800 is read, hashed, finite and not the clear value. (2) With `lose_device_at: 900`: `device_losses` is 1; frames 0 to 1,800 are drawn (900 may be missing); up to the loss the frames are as unbroken; from the loss on at least one frame is drawn with its state behind its step, every such frame reports `settling: true` and no frame at its step does (the settling line); frame 1,800 holds step 1,800 and both hashes are the unbroken run's (the hash line). (3) The same under `--planted restore_starts_from_clear_value`: it counts one loss and reads a state at step 1,800, and the hash line fails on it with "the state hash at step 1,800 differs from the unbroken run's: water.height is … after the loss, … unbroken" |

The right program and its planted one share the test, so the planted run is judged by the same line, against the same
unbroken run, as the right one passes.

## Readings where the issue and design leave a choice

- **"The 128 × 128 run"** is criterion 1's grid, played unbroken from step 0. "The state" is its two carried
  textures, and "the state hash" each one's SHA-256 as #483's `read` names its file; both must match. The play is
  `view3d`'s default class, as #252's tests play a stepped document.
- **"Forced at step 900"** is the device lost while the frame that shows step 900 draws: at 60 frames a second and
  60 steps a second frame n shows step n. The loss is forced as #377 forces one, by `lose_device_at`, moved onto
  `view3d` because `frames` plays a scene file and `{"call": "lose_device"}` falls between calls, not at a step.
- **"Reports settling"** is `settling: true` on the frame, as #377's Frame says it. `view3d` has two narrower flags
  at the base (`settled`, `samples.settling`); neither names carried state, so neither is read.
- **"Every frame before the state is rebuilt"** needs a meaning a reply can show. A frame is before the rebuild when
  its `carried` rows don't hold its own step, which is #252's meaning of `carried.<key>.step` ("the step the carried
  state holds"). The line is read both ways, from Scope's "the frame reports settling until it reaches t": a frame
  behind its step reports settling, and a frame at its step doesn't. A program that reported settling on every frame,
  or on none, fails it.
- **There is at least one such frame.** The criterion speaks of frames before the rebuild, and Scope says the state
  is rebuilt by stepping from the start: at step 900 that is 900 steps, which Carried state runs across frames. A
  play that rebuilt everything inside one frame would show no settling frame, and the settling line would then pass
  on nothing; the invariants don't let nothing pass, so the test asks for one or more. If `view3d` should instead
  wait for every step after a loss, as it does for a seek at the base, this reading is the one to dispute.
- **Frame 900 itself** may be missing from the reply, as #377 allows for the frame a device is lost under. When it is
  there it is judged like any frame from the loss on.
- **Rebuilt by 1,800.** The criterion's hash is at step 1,800, so frame 1,800 must hold step 1,800 (two or more
  steps a frame from the loss). A play still settling at 1,800 fails the hash line, naming what its state holds.
- **"Starts from the clear value at step 900"** is the planted restore taking the carried outputs' clear value as
  step 900's state and stepping on. With this fixture the height then reads zeros at 1,800; the test asserts only
  what the criterion says, that the hash differs. It is a `--planted` program because it changes what the binary
  does on a loss; no document can express it.
- **"On that machine"**: the three plays run on the machine the test runs on, one after another.
- **The ring after a loss** is not read: whether checkpoints are retaken while the state is rebuilt is the
  implementation's.

## Not tested, and not read

- Not tested (criterion 7 doesn't ask it): the picture a settling frame shows; that the rebuild starts at step 0
  rather than at a checkpoint kept off the device (the hash can't tell them apart); a loss during a seek; a loss of a
  document with carried storage rather than textures; the comment's four open lines of #252.
- Needed but not allowed to read: nothing. The other parts' folders (`ring/`, `track/`) were not read, so this
  part's water document is the "fields" part's, not the "ring" part's; they may differ in the drop's shape or the
  rim, which no line here depends on.

## Upstream tests (the Oracle lane)

None: the Oracle page lists no upstream test for any of the eight criteria.
