# Acceptance tests for #182: a character body, a capsule that walks, climbs steps and jumps, moved by the physics backend's own character controller

Written first, blind, from issue #182 (its Scope, Fields, seventeen acceptance criteria, Proof line and Oracle line), its
Oracle page, the design sections it links and the base commit this worktree stands on, `1ab89128` ("Merge pull request
#2597 …", which holds #191's behavior kit and #522's, #1918's and #1919's physics module, and #531's to #533's logic
module), by a job that never saw an implementation; none existed, and no other worktree, branch, stash or pull request
was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding). The upstream tests the Oracle page links for criteria 1, 2, 3, 6, 8, 10 and 12 are ported in
`tests/acceptance/182-oracle/`, on this suite's surface.

## What was read

- The issue, live with `gh issue view 182 --repo windoliver/deepbuild`, and its Oracle page and cases
  (`doneright/oracles/issues/182.md`, `doneright/oracles/cases/182.json`, `DeepBuildAI/deepbuild`, branch `doneright`)
  with the two upstream files it pins.
- `docs/technical-design.md`: The physics module (World; Shape, body; Character body; Input, occurrence, output; Bake and
  golden; Behavior kit); The logic module (Logic; Logic bake and checks); Scenes, physics and the canvas core (Physics,
  Logic, Bounded games); Dogfooding; Tests written first. AGENTS.md.
- `docs/canvas-primitives.md`: World and backend `physics.world@1` (its step order and backend interface, with
  `move_character`); Shape; Body `body@1`; Body `body@1`: character; Input track entries; Occurrence list; Physics
  output; Checkpoint ring; Bake; Golden; Physics: behavior kit; Logic `logic@1`; Logic: readings.
- At the base, for surfaces only: `crates/deep-physics-rapier` (`main.rs`, `runner.rs`, `runner/kit.rs`,
  `runner/timeline.rs`, `runner/replay.rs`, `planted.rs`, `Cargo.toml`'s features), `crates/deep-canvas-physics`
  (`caps.rs`, `backend.rs`, `doc.rs`, `doc/inputs.rs`, `doc/reads.rs`, `kit.rs`, `kit/sensors.rs`, `track.rs`,
  `occurrence.rs`, `bake.rs`), `crates/deep-show` (`physics.rs`, `physics/derive.rs`, `physics/kit.rs`, `logic.rs`,
  `picks.rs`'s `logic` call, `query.rs`'s logic read), `crates/deep-logic` (`piece.rs`'s reads, `module.rs`),
  `scripts/proof-change.mjs` (criterion IDs), and the suites `191/`, `191-oracle/`, `522/`, `2009/`, `2010/`, `213/`,
  `213-redraft-ac3/`, `533/`, `548/`, `1983/` and `138/` (layouts and helpers copied, nothing imported).

What the base already does, which these tests don't credit: `deep-physics` checks, bakes with a track of declared
inputs (an entry is admitted whatever its input's `on`), keeps checkpoints in a ring, seeks, runs physics.determinism,
records and verifies goldens, times steps, and runs #191's behavior kit with test backends and planted names;
`character_controller` is already one of caps()' claim names, but Rapier's caps don't claim it; the kit's sensor cells
for a character already name it and read `excluded_by_caps`. deep-show bakes a scene's worlds, runs logic items, answers
`deep_query`'s logic read and the `logic` call, and runs #138's kit with the physics module's `late-joint` fixture. A
`character` body is refused (`physics.unsupported` at `bodies/<id>/kind`, naming #182), so is the input kind `jump`
(naming #182) and the reads `grounded` and `sliding` (naming #182); `place` and `crouch` are no input kinds, and a
`move` takes `to`, not `velocity`. A logic item can't read a world's reading, and one can't fire a world's inputs (#1834).

## Run them

```sh
npm ci                          # once, with node 24.22.0 first on PATH
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/182 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/182/tsconfig.json
rm -rf tests/acceptance/182/node_modules/.vite
```

Each file builds what it uses once, before its tests, and copies each binary out (honoring `CARGO_TARGET_DIR`;
`CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set; Homebrew's rustup put on PATH when present):
`cargo build --locked -p deep-physics-rapier --bin deep-physics` (shipped), the same with `--features test-backends`
(test), with `--release` (ac11), and `cargo build --locked -p deep-show --bin deep-show` (the full set; ac5 and ac6).
ac7 makes rustdoc's JSON of the physics crates into `target/acceptance-182-doc/` (`RUSTC_BOOTSTRAP=1`); ac5's golden
test builds this checkout for linux/amd64 in Docker with `rust:<rust-toolchain.toml's channel>-slim-bookworm`, caches
under `target/acceptance-182-linux/`, pulling nothing; ac11 builds the merge base's release `deep-physics` from
`git archive` in `target/acceptance-182-base/`. Every test passes an explicit timeout (60 minutes; the Linux golden
three hours), and each file's build hook has four hours a build. Node built-ins and vitest only. No cargo, no Docker
or no image is `BLOCKED:`, a failure, never a pass. Processes are stopped only by the PIDs this suite starts
(`spawnSync` with a timeout); nothing is killed by name or port. **`scripts/lanes.mjs` needs `'tests/acceptance/182/'`
and `'tests/acceptance/182-oracle/'` in its `alone` list** (the files build cargo binaries, copy them out of the shared
target folder and ac11 times them); this README is the instruction, the implementer makes that edit.

`BASE-FAILURE.txt` says why each test fails at the base.

## The surface under test

The issue names the body's fields, its inputs, outputs, state, occurrences, the kit's four fixtures, test backends and
planted programs, but no command line. Everything below that the issue or the design doesn't name is this job's
choice, the smallest the criteria need, next to the base's own calls; **bold** names are the ones the implementer must
provide as written.

### `deep-physics` (crate `deep-physics-rapier`): the world document

- `body@1` takes **`kind: "character"`** with **`character: {slope_limit: deg = 45, step: {height: m = 0.3, width: m =
  the capsule's radius}, snap: m = 0.2, offset: m = 0.01, jump: {height: m = 1}, crouch?: {height: m}}`**; its `shapes`
  hold one capsule use and it has no `follow`. `check` refuses, as error issues whose `path` is the field (never
  `bodies/<id>/kind` for these): a shape other than one capsule at **`bodies/<id>/shapes…`**, a follow channel at
  **`bodies/<id>/follow`**, a crouch height under twice the radius or not under the tall capsule's height at
  **`bodies/<id>/character/crouch/height`**.
- The body's frame (its `pose`, and `pos` in its states) is the tall capsule's centre, crouched or not; the crouch
  capsule shares the tall one's lowest point.
- The character's document field **`slope_limit`** is a public struct field of the physics crates, as #2009 required
  of the world's fields, so the public-API scan reaches the character body's types.
- Input kinds a world declares in `inputs` and a track's entries carry: **`move {velocity: [x, y, z] m/s}`** on a
  character, **`jump {height: m}`**, **`launch {vertical: m/s}`** on a character, **`place {pose: {pos, rot?}}`** and
  **`crouch {on: bool}`**. As at the base, an entry is admitted for an input the world declares whatever its `on`; an
  input with `on: {logic: <item>}` takes the entries that logic item fires, written on the track as a bake keeps them.
- Outputs **`read: "grounded"`** and **`read: "sliding"`** of a character body, and `velocity` and `pose` of one; a
  `velocity` output's series in a bake's `outputs.series[<output ID>]` holds **`[vx, vy, vz]` m/s a frame**, the move the
  body made over the step's length, as the base writes a position's.

### `deep-physics`: replies

| Call | What this suite reads |
|---|---|
| `bake`, `seek`, `restore` (the base's) | each state of a character body in `bodies[<id>][i]` gains **`character: {wants: [x, y, z], vertical: m/s, grounded: bool, sliding: bool, crouched: bool, touching: [{body, index, shape}]}`**, its own state after that step; `occurrences` gain **`contact_begin`** and **`contact_end`** rows naming the character and each shape its controller starts or stops touching (a `place` ends every one), sorted with the rest |
| `check` (the base's) | on a backend whose caps() lack `character_controller`, a world with a character body is refused: an error issue naming the body (in `ids` or `path`) and the backend's name (anywhere in the issue) |
| `golden_verify` (the base's) | takes **`track`**, as `golden` does, and keys the golden with it |
| `time` (the base's) | takes **`track`**, as `bake` does |
| `determinism` (the base's) | unchanged: PASS over the course |
| `behavior_fixtures` (#191's) | each fixture gains **`steps`** and **`track`**, the run the kit makes of its world |
| `backend` (#191's) | Rapier's `caps` claim **`character_controller`** |
| `behavior_kit` (#191's) | the fixtures below |

**Fixture names** (each names `character_controller` in its `caps`): **`character/slope`**, **`character/step`**,
**`character/snap`** and **`character/jump`** (the Scope's four), and **`character/grounded_0.04`**,
**`character/grounded_0.07`**, **`character/sliding_30`** and **`character/sliding_50`** (criterion 10's rules). A
`character/step` fail adds **`body`** (the character), **`obstacle`** (the step's body) and **`height`** (m, how far its
lowest point rose) and names all three in `what`; a `character/snap` fail adds **`body`** and **`step`** (the first step
it read airborne) and names the step in `what`. A fail's `what` names the backend and the fixture, as #191's do.

### `deep-physics`: wrong programs

| Name | Criterion | The wrong program |
|---|---|---|
| `--backend` **`no_character_controller`** | 7, 9 | Rapier whose caps() leave out `character_controller` |
| `--backend` **`steps_too_high`** | 8 | Rapier whose controller climbs steps higher than the body's step height (a 0.4 m step under 0.35 m) |
| `--backend` **`ignores_snap`** | 8 | Rapier whose controller never snaps to ground |
| `--backend` **`ground_distance_1mm`** | 10 | Rapier reading grounded only where a walkable surface lies within 0.001 m below the capsule |
| `--backend` **`ignores_launch_airborne`** | 13 | Rapier ignoring `launch` off the ground |
| `--planted` **`slope_limit_ignored`** | 1 | a controller that climbs under 45° whatever the body's `slope_limit` |
| `--planted` **`checkpoint_drops_vertical`** | 5 | checkpoints that leave out each character's vertical speed, restored as 0 |
| `--planted` **`kit_passes_excluded`** | 9 | a kit whose report reads `pass` for a fixture its backend's caps exclude |
| `--planted` **`character_as_kinematic`** | 12 | a character stepped as a plain kinematic body, moved by (wants + up × vertical) × the step's length with no controller, which the backend lets shove dynamic bodies |
| `--planted` **`place_keeps_vertical`** | 14 | a `place` that keeps the body's vertical speed |
| `--planted` **`ceiling_keeps_upward`** | 15 | a controller that keeps its upward speed against a surface above |
| `--planted` **`crouch_stands_on_release`** | 16 | a crouch let go switches to the tall capsule at once |
| `--planted` **`corner_one_wall_at_a_time`** | 17 | a controller resolving one wall's contact alone each pass, alternating |

Test backends are in the `test-backends` build only and are candidates (`reference: false`) claiming `ccd` and
`character_controller` (`no_character_controller`: `ccd` alone) and not `soft_bodies`, so #191's admission rule doesn't
refuse them while no fixture tests soft bodies; the backend's name in a result and an issue is the test backend's.
Planted names work in any build and with `--backend`. An unknown backend or planted name exits 2, as at the base.

### deep-show (the full set)

- The physics module's kit fixture **`parity/physics/character-course.<profile>`**: the course below, with its
  entries declared, run by #138's `kit` call's **`carried_state`** and **`late_entry`** parts.
- A `logic@1` item's `reads` may name **`<world ID>.<body ID>.grounded`**, a character body's grounded reading (the
  core's column-view name a mark set reads `lab.ball.position` by); its region map entry (region `reads`) has type
  `bool`, `i32` or `f64`, and logic step j reads it as the last physics step before j's time left it.
- Driven unchanged: `deep_show`, `deep_query` with `what: "logic"` (the item's `region_map`), the `logic` call with
  `track`, a world input `on: {control}`, and `kit` with `modules` and `parts`.

### The worlds (helpers.ts)

Every world runs at 120 Hz, 4 substeps, gravity (0, −9.81, 0); `hero` is the issue's capsule (radius 0.3 m, half height
0.6 m, 1.8 m tall) standing with its lowest point the offset (0.01 m) above its floor. Ramps are convex wedges.
**The course** (criteria 5 and 6, `courseWorld`): `start` (top at 0 to x 2), a 1 m gap, `shelf` (x 3 to 5), the 30°
`ramp` rising 2 m from x 5, `top` (y 2) to x 11, then `step` 0.3 m up to x 30, `pit` far below; the body walks +x at
2 m/s from x 0 for 1,200 steps and jumps 1 m at steps 96 (over the gap) and 960; outputs `speed` (velocity, to a
readout) and `footing` (grounded).

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed. Each test's name starts with its criterion's ID.

| ID | File (tests) | What it asserts |
|---|---|---|
| 1 `#182.78fd65bc` | `ac1-slope.test.ts` (2) | moved by the logic item `walker`'s entry: under 45° the 30° ramp's body ends grounded over the top, lowest point 2.00 ± 0.02 m; at 50°, and at 30° under 25°, its lowest point never 0.05 m above its start; `slope_limit_ignored` fails, naming the 30° ramp under 25° |
| 2 `#182.d146e624` | `ac2-step.test.ts` (1) | at 2 s on the 0.3 m step's 6 m floor, grounded, lowest point 0.30 ± 0.02 m; the 0.4 m step, and 0.3 m under 0.25 m, keep its lowest point within 0.05 m of the floor and its front off the step's face for 5 s |
| 3 `#182.11a4f4a4` | `ac3-snap.test.ts` (1) | down a 20° ramp at 3 m/s: grounded after each of 240 steps with snap 0.2 m, airborne after one at least with snap 0 |
| 4 `#182.3f233106` | `ac4-jump.test.ts` (1) | the discrete solution peaks at 1.0185; the body rises that within 1 mm; a second jump in flight leaves every step hash equal |
| 5 `#182.b30809e4` | `ac5-course.test.ts` (4) | seeks from every checkpoint (one mid-jump at least) equal the straight run's states and step hashes, and physics.determinism PASSes; `checkpoint_drops_vertical` fails, its first failure naming the first mid-jump checkpoint's step and `vertical`; the golden recorded here replays PASS here and on Linux x86_64; the kit's `carried_state` and `late_entry` parts PASS on the course's fixture |
| 6 `#182.e8a0f46c` | `ac6-readers.test.ts` (2) | the velocity readout reads 2.00 m/s within 1% at every frame on flat ground (20 at least); contact_begin rows name the body with the ramp and with the step; the list is sorted; in deep-show a counter reading `course.hero.grounded` counts each landing at logic step ⌊k/2⌋ + 1 for a landing at physics step k |
| 7 `#182.3a7d3534` | `ac7-refusals.test.ts` (3) | a box shape, two capsules and a follow channel are refused naming the field, one capsule admitted; `no_character_controller` refuses the world naming `hero` and itself; rustdoc's JSON of `deep-canvas-physics` and `deep-physics-rapier` holds the public field `slope_limit` and names no Rapier type, and `test-leaks-rapier` is caught |
| 8 `#182.a3e169f2` | `ac8-wrong-controllers.test.ts` (2) | `character/step` and `character/snap` pass on Rapier; on `steps_too_high` `character/step` fails naming a character, a static step and a height 0.4 ± 0.02 m equal (± 0.02 m) to the fixture's own bake there; on `ignores_snap` `character/snap` fails naming the first step its own bake there reads airborne |
| 9 `#182.e3211fef` | `ac9-excluded-by-caps.test.ts` (2) | the four pass on Rapier; on `no_character_controller` they and every fixture naming the cap read excluded_by_caps, every other passes, verdict pass; `kit_passes_excluded`'s report is refused by the caps rule, naming a fixture it counted |
| 10 `#182.ca0e2323` | `ac10-grounded-sliding.test.ts` (2) | held 0.04 m up grounded, 0.07 m not, up the 30° ramp never sliding, on the 50° slope sliding; the four rule fixtures pass on Rapier; `ground_distance_1mm` fails the 0.04 m world and `character/grounded_0.04` |
| 11 `#182.60fc90f0` | `ac11-budgets.test.ts` (2) | structurally everywhere (16 bodies move through the 500-shape level; the release build bakes them, and the world without one); on a fit reference Mac only, five runs: the 16 bodies add under 1 ms a step, and the world without one steps within the merge base's median + 5%. Elsewhere INCONCLUSIVE |
| 12 `#182.e7c14b4e` | `ac12-push.test.ts` (2) | the body ends within offset + 1 mm of the 10 kg box's face, the box never 1 mm from where it rested; `character_as_kinematic` moves it over 0.1 m and fails, naming the box and the first step it was 1 mm off |
| 13 `#182.bb969ef1` | `ac13-launch.test.ts` (2) | jump at 30, launch 4.4294 stamped 85: peak 2.0370 within 1 mm, second arc 1.0185 within 1 mm; a jump stamped 85 instead changes no step hash; `ignores_launch_airborne` peaks at 1.0185 and fails naming step 86 |
| 14 `#182.7b2434da` | `ac14-place.test.ts` (2) | a place stamped 600 on the 30° ramp: state 601 at the pose within 1e-6 m, vertical 0, contact_end with the ramp at 601, list sorted; a seek to 599 restores 540 and matches to 700; a place falling at 5 m/s leaves vertical 0; `place_keeps_vertical` fails naming the step and `vertical` |
| 15 `#182.999cb64d` | `ac15-ceiling.test.ts` (2) | it meets the slab (contact_begin) and reads a downward vertical speed the next step; `ceiling_keeps_upward` fails naming the meeting step, staying 40 ± 1 steps |
| 16 `#182.7b0f1d9a` | `ac16-crouch.test.ts` (2) | standing it stops within offset + 1 mm of the slab's face; crouched it passes beneath; let go under the slab it never stands where the tall capsule overlaps and stands by two steps after it first fits; crouch 0.5 m refused naming the field; `crouch_stands_on_release` fails naming step 151 and a 0.6 ± 0.05 m overlap |
| 17 `#182.adc48e67` | `ac17-corner.test.ts` (2) | after 2 s its axis within 1 cm of 0.62 m out along the bisector; under 1 mm travelled over the last second; 1.00 ± 0.02 m farther 0.5 s after moving away; `corner_one_wall_at_a_time` fails naming a step of the last second |

Test count: 2 + 1 + 1 + 1 + 4 + 2 + 3 + 2 + 2 + 2 + 2 + 2 + 2 + 2 + 2 + 2 + 2 = 34.

## Readings where the issue leaves a choice

- **"By a logic item's move" (criteria 1, 2, 5).** The world's `walk` and `hop` take `on: {logic: <item>}`, and the
  bake's track holds the entries that item fires, as the Input track entries section says a bake keeps derived entries
  and the physics module reads them from the track without naming the logic module. A logic item firing a world's
  inputs is #1834's (open), not #182's, so criterion 6's counter test drives the same course in deep-show from presses
  of two controls deriving the same entries at the same steps.
- **Steps.** #522's convention: an entry stamped k applies in the step from state k to state k + 1; `states[k]` is the
  state after k steps; a row's `step` is the step that wrote it. A jump stamped 30 has its 56th step end in state 86.
- **Heights.** "Lowest point" is the frame less 0.9 m. Jump heights (criteria 4, 13) are read from where the lowest
  point stood before the jump, since the body stands the offset above the floor and 2.0370 = 2 × 1.0185 is the two arcs'
  rises; criterion 1's 2.00 m and criterion 2's 0.30 m are above the floor's top, the offset inside their 0.02 m.
- **"Stops it"** (criteria 1, 2): criterion 1's 50° measure (the lowest point never 0.05 m above its start) for the 25°
  limit too; criterion 2's "within 0.05 m of the floor", and the body's front never more than 1 mm past the step's face.
- **"Every step"** is the states after steps 1 … n; the built state 0 is no step.
- **Criterion 5.** "The same full-state hash at every checkpoint" is physics.determinism's comparison of every
  checkpoint's canonical and deep hash from runs restored at each checkpoint; "the same step hashes when seeked" is a
  `seek` from each checkpoint to step 1,200. The planted checkpoint's failure names the field by the seek judge's
  field-by-field comparison of the states, the first differing step being the first mid-jump checkpoint itself.
  "Recorded on macOS" requires this host to be macOS; the Linux run is this checkout built for linux/amd64 in Docker.
- **Criterion 6.** Logic steps first at a shared time and reads physics only from earlier steps, so at 60 Hz beside
  120 Hz logic step j reads grounded after physics step 2j − 1, and a landing at physics step k is counted at
  ⌊k/2⌋ + 1. The counter ignores its reads at steps 0 and 1 (the standing start). "Flat ground" is a frame whose state
  and the four before and two after are grounded at one height (1e-4 m) over a flat level of the course.
- **Criterion 8.** "The height it reached" is the rise of the body's lowest point, 0.4 m within 0.02 m (the step plus at
  most the offset), matched against the fixture's own bake on the same backend.
- **Criterion 9.** "Refused" is the kit's caps rule applied to its report (a fixture naming a cap its backend lacks reads
  excluded_by_caps, never pass), as #191's criterion 4 judged its planted kit; the test reads the four fixtures among
  every fixture naming `character_controller`, not a count of four.
- **Criterion 12.** "The step it first moved" is the first step the box is more than 1 mm from where it rested, the
  criterion's own bound; "within its offset plus 1 mm of the box's face" is |gap| ≤ 0.011 m.
- **Criterion 14.** "Falls at 5 m/s" is the state of a fall from 20 m whose vertical speed is nearest −5 m/s (within
  0.1); "the checkpoint before step 600" is the one a seek to 599 restores (540).
- **Criterion 15.** It "meets the slab" on the step of its contact_begin with the slab and "stays against" it until its
  contact_end; "the first of them" is the meeting step. A 1 m jump meets the slab on its 16th step with 3.2 m/s left,
  which a kept upward speed spends over 39 more steps against it, 40 in all, one more or less as the offset moves the
  meeting step by one: the test holds the planted stay to 40 ± 1.
- **Criterion 16.** The tall capsule fits where its axis is at least its radius past the slab's far edge; "stands at
  that first step" is no later than two steps after the first state that fits (whether a step tests its start or end
  pose, and the offset's clearance, move it by one each), and never where the tall capsule would overlap by over 1 mm.
- **Criterion 17.** "Moves less than 1 mm over the last second" is the path summed step by step from state 120 to 240,
  so an alternating body fails it even if it ends where it was; "farther" is the distance from the corner's edge.
- **Budgets** follow #191's gate: a reference Mac (Mac15,7 or Mac15,12) on mains power, Low Power Mode off, thermal
  nominal, 1-minute load at most its cores; five runs after a warm-up, judged by the design's rule; else INCONCLUSIVE
  (a skip, never a pass). "Adds under 1 ms" is the level with the 16 bodies less the level alone, mean step over 600
  steps; "a world without one" is the level with 16 dynamic balls, against the merge base's median + 5%.

## Not tested, because no criterion reaches it here

`deep_kinds` listing the character body (Scope only); platforms and their `platform` field (#924); pushing (#254);
`jump {height}` left to the body's own default; a crouch height not under the tall capsule's (the criterion names
0.5 m); the kit's answers and tolerances for the four fixtures (criterion 9 needs them excluded, criterion 8 two of them
passing and failing); the course's cross-machine run on wasm32.

## What the implementer adds

The fields, kinds, outputs, state, rows, fixtures, test backends and planted names above in `deep-physics-rapier` and
`deep-canvas-physics`; `golden_verify`'s and `time`'s `track` and `behavior_fixtures`' `steps` and `track`; in deep-show
the course's kit fixture and a logic item's read of a character's grounded reading; and `'tests/acceptance/182/'` and
`'tests/acceptance/182-oracle/'` in `scripts/lanes.mjs`'s `alone` list. Nothing in these folders changes.
