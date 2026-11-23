# Acceptance tests for #2317: a body at rest on a turning body stays on it

Written first, blind, from issue #2317 as saved for this job on November 21, 2026 (its opening paragraph, Scope, five
acceptance criteria, Proof line and dependencies; it has no comments), the design's physics sections and base commit
`c7dc0edc3` ("Merge pull request #3058 …"), by a job that never saw an implementation or a diff of one; no other
worktree, branch or pull request was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test per criterion, one more where a clause
needs its own run, and one per planted wrong program a criterion names.

## Files, one per criterion

| File | Criterion | Tests |
|---|---|---|
| `ac1-turntable.test.ts` | `#2317.0a959d8a`: the box stays within 0.06 m of 1 m from the axis at every step of the 6 s at 90°/s, and within 0.01 m at 30°/s; the planted wrapper that leaves the backend's contact reuse on reads 3.957 m at 6 s and fails, naming the box and the first step past the bound | 2 |
| `ac2-straight-platform.test.ts` | `#2317.74dfcf37`: the box on a kinematic platform that reaches 2 m/s over 1 s and holds it 5 s is within 1 mm of its place on it at every step, here and at the merge base | 1 |
| `ac3-what-rested.test.ts` | `#2317.ebf76689`: five and ten 1 m cubes rest through the sixth second and the top of five ends 5.87 mm low; the 1 cm cube at the table's edge at `step_rate: 480` has dropped 0.5 mm before 1.6 sides past it, where the first criterion's planted wrapper has not until 5.23; five 1 cm cubes at 480 Hz, `contact_hz: 240` and `length_unit: 0.01` end 4.5 sides up within 2% of a side, and the planted wrapper that turns the reuse off for every world topples them and fails, naming the top body | 3 |
| `ac4-budget.test.ts` | `#2317.122f57d7`: the step budget's report on the 800-body world lists the step's p50 and p95 before (the merge base's build) and after, and the world stays under its `budget.step_p95` on the reference Mac | 1 |
| `ac5-kit.test.ts` | `#2317.c14f39c6`: the kit's data holds `turntable` once, and Rapier 0.36.1 passes it on macOS arm64 and on wasm32 | 2 |
| `helpers.ts` | the worlds, the runner and the judges, over `../191/`, `../2308/`, `../2309/` and `../2011/helpers.ts` (imported read only; `ac4` also reads `../1921/helpers.ts`) | |
| `twins.json` | each criterion's ID to its planted programs | |
| `lane.json` | the folder runs alone (#1327) | |
| `BASE-FAILURE.txt` | each file run once at the base | |

## What was read

- The issue as saved for this job; the criterion IDs are computed here from its body and match the ones the job was
  handed. `gh issue view` of #97 (the epic), #191, #2308 (and its one comment, a note about this issue), #2011, #924,
  #2306 and #2318.
- `docs/technical-design.md`: The physics module (World; Shape, body, contact material, collision group; Joint and
  force; Bake and golden; Behavior kit); Who drafts it; Proven on the base; Criteria to tests; Wrong programs; Tests
  written first. `docs/canvas-primitives.md`: World and backend `physics.world@1`; Physics: behavior kit. AGENTS.md
  and CONTRIBUTING.md. The design at the base says nothing of a turntable or of how contacts are found from step to
  step; the issue is their source.
- At the base, for surfaces only: `tests/acceptance/2308/` (README, helpers, `ac1`, `ac2`, `twins.json`, the head of
  `BASE-FAILURE.txt`), `191/` (helpers, `ac1`), `2309/` (helpers, `ac2`), `2306/` (helpers, `ac4`, `ac5`,
  `twins.json`), `1918/` (helpers, `ac1` and its fixture scene), `2011/` (helpers, `ac2`), `1921/` (helpers' drop
  and budget, `ac6`, `twins.json`), two suites' `lane.json`; `scripts/physics-budget.mjs`,
  `scripts/physics-wasm32.mjs`, `scripts/proof-change.mjs` (criterion IDs), `scripts/proof-runs.mjs` (`twins.json`),
  `scripts/lanes.mjs` (`lane.json`); `crates/deep-canvas-physics` (`kit.rs`, `kit/fixtures.rs`, `kit/vehicles.rs`'s
  platform, `kit/small.rs`'s head, `backend.rs`'s `Targets`, `doc.rs`'s motor) and `crates/deep-physics-rapier`
  (`main.rs`, `planted.rs`, `runner/contact.rs`, `scene.rs`, `channels.rs`, `belt.rs`, `lib.rs`'s `Twin`, `build`,
  `collider`, `joint` and `aim`). Not read, though the job's brief offered them: `523/` and `2241/`'s suites.
- The pinned backend's own source, which the issue cites: rapier3d 0.36.1's `src/dynamics/integration_parameters.rs`
  (`contact_recycling` and its distance), `src/geometry/narrow_phase/pair_update.rs` (`process_pair`: when a pair
  keeps its contact points, and that a pair with an active hook never does) and `src/geometry/contact_pair.rs` (the
  drift a pair is held to).

Nothing else was needed, and nothing else was read.

What the base already does, which these tests don't credit: `deep-physics` checks and bakes a world, alone or inside
the scene that lists it, runs the behavior kit natively and on wasm32, and takes `--planted <name>`; a hinge's velocity
motor reads its target from a scene's channel at each step's time, and a kinematic body follows one; the step-budget
check times a world on the app host and judges it by the reference-Mac rule. Its wrapper never sets the backend's
contact reuse, which stays on, so at the base the box on the turntable slides out (3.957 m at 6 s) and the 1 cm cube
hangs past the table's edge (5.23 sides). Its kit holds no turntable and no fixture whose motor target rises, its
budget report lists no p50 and nothing of another build, and it knows neither planted name.

## Run them

```sh
npm ci                          # once, if node_modules is missing
# the builds first, each through the one build slot:
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  nice -n 10 sh scripts/lease cargo build --locked -j 6 --release -p deep-physics-rapier --bin deep-physics
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/2317 --no-file-parallelism --testTimeout=3600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2317/tsconfig.json   # type-check
rm -rf tests/acceptance/2317/node_modules                                      # vitest's cache
```

| File | Builds (each asked of cargo once per file, found made and copied out of the target folder) |
|---|---|
| `ac1`, `ac3` | `cargo build --locked --release -p deep-physics-rapier --bin deep-physics` (#191's `release`) |
| `ac2` | the same; and the merge base's release build (`git merge-base HEAD origin/main`), exported by `git archive` into `target/acceptance-191-base/<sha>` and built there (#191's `mergeBasePhysics`) |
| `ac4` | the merge base's release build; `node scripts/physics-budget.mjs` builds this checkout's release `deep-physics` itself |
| `ac5` | #191's `release`; and `node scripts/physics-wasm32.mjs` builds the crate's library for wasm32-unknown-unknown |

Every test passes #191's 60-minute timeout (four times that for the two that read the merge base) and each file's
build hook its 4 hours. Node built-ins and vitest only. No process is started but `cargo`, `git`, `tar`,
`deep-physics`, `node scripts/physics-wasm32.mjs` and `node scripts/physics-budget.mjs`, each waited for; none is
stopped by name or port. Only `ac4` times anything; no other test depends on the machine or its load. No cargo and no
merge base are `BLOCKED:`, and a reply that can't be read is `INCONCLUSIVE:`, each a failure, never a pass.
`lane.json` says the folder runs alone (its files build cargo binaries, one of them a second checkout's), so
`scripts/lanes.mjs` needs no line.

## The surface under test

The issue names worlds, numbers and the kit, and no call, field or flag. These tests drive `deep-physics` and the
step-budget check as #191, #1918, #2011 and #2308 left them and add the least the criteria need: one fixture and one
field of a fixture's data in the kit, one field of the budget's request and two of its report, and two planted names.
Each name is marked: *(issue)* the issue's word, *(design)* the design's, *(base)* what the base's suites already
drive, and **bold** with *(ours)* this job's choice, which the implementer builds as written.

### Calls and flags, all *(base)*

| Call | Reply, as read here |
|---|---|
| `{"call": "bake", "world": World, "steps": n, "read"?: [ID]}` | `{"ok": true, "bodies": {ID: [state]}, …}`; state k is the body after step k: `pos`, `rot` (a quaternion, x y z w), `linear`, `angular` (deg/s) |
| `{"call": "bake", "scene": Scene, "world": "<world ID>", "steps": n, "read"?: [ID]}` | the same, for a world inside the scene that lists it (#1918): its motor's target and its kinematic body's `follow` read the scene's channels at each step's time |
| `{"call": "behavior_fixtures"}` | `{"ok": true, "fixtures": [{name, world, steps, answer, tolerance, …}]}` |
| `{"call": "behavior_kit"}` | `{"ok": true, "backend", "target", "results": [{backend, fixture, measured, answer, tolerance, result, what, …}], …}` |

`deep-physics --planted <name>` starts one wrong program. `node scripts/physics-wasm32.mjs` answers the same calls
with the crate built for wasm32. No world field is added: the Scope says no world field chooses how.

### The fixture in the behavior kit

One fixture joins `behavior_fixtures` and `behavior_kit`, exactly once:

```text
{"name": "turntable", "world": <the turntable's world, below>, "steps": 720,
 "ramps": {"axle": {"to": 90, "steps": 240}}, "answer": 1, "tolerance": {"m": 0.06}, …}
```

- `name` **`turntable`** *(ours; the issue's word for it)*. `world` is the document under The worlds, field for
  field (key order free, numbers within 1e-12), and `steps` its 6 s.
- **`ramps`** *(ours)*, the one addition to a fixture's data: `{<joint ID>: {"to": number, "steps": n}}`. The kit
  steps a backend with no scene, so it plays the scene's part for a motor whose `target` names an item path: in step
  k of the run, counted from 1, it hands the backend that joint's motor target, `to` × min(k, `steps`) ÷ `steps`, in
  the motor's own unit (deg/s here), through the step's `Targets` *(base: `Targets.motors`, which a scene's channel
  fills)*. That is a rise from 0 over the first `steps` steps, then held: what a channel with a linear key of 0 at
  0 s and a held key of `to` at `steps` ÷ `step_rate` s gives a step that reads it at its own time. `behavior_fixtures`
  shows `ramps` on the turntable; nothing is asked of any other fixture's.
- `answer` 1 *(issue: 1 m from the axis)* and `tolerance` `{"m": 0.06}` *(issue)*, judged both ways.
- A row *(base)* is `{backend, fixture, measured, answer, tolerance, result, what, …}`; its `answer` and `tolerance`
  are the interface's. **`measured`** *(ours)* is the box's centre's distance from the axis (the vertical through the
  origin: √(x² + z²)), m, after the step at which it is farthest from the answer. On the reference backend it reads
  `pass`, natively (`target: "aarch64-apple-darwin"`) and on wasm32 (`target: "wasm32-unknown-unknown"`).
- A fail's `what` names the backend and the fixture *(design)*, and the row carries `"body": "box"` and `"step"`,
  **the first step after which the box is past the bound** *(issue: "naming the box and the first step past the
  bound"; `body` and `step` are the fields the base's fails already carry)*.
- The kit measures the run: each row's `measured` is held within a micrometre of what this suite's own judge reads of
  the same world baked in a scene whose channel `dial` rises as the ramp does, on the same program, the real one and
  the planted one alike. The 30°/s run is a bake of this suite's, not a fixture (Readings).

### The budget report

`node scripts/physics-budget.mjs` *(base, #2011)* reads `{"scene", "world", "steps", "reference_mac": {"app", "web"}}`
and answers `{ok, verdict, limit_ms, hosts: {app, web}, asks}`. The criterion's "before and after" adds:

- Request: **`"before": "<path>"`** *(ours)*, the path of a release `deep-physics` built from the merge base, which
  this suite builds as #191's `mergeBasePhysics` does. With it, the app host times the same world and steps on that
  binary as it times its own: one untimed warm-up, then five runs.
- Report: **`hosts.app.before`** and **`hosts.app.after`** *(ours)*, each `{"p50": [5 numbers], "p95": [5 numbers]}`:
  each run's median and 95th percentile of a step, ms, on the merge base's build and on this checkout's.
  `after.p95` is `hosts.app.runs`, the five runs the verdict is judged on *(base)*. The verdict stays the
  reference-Mac rule's on this checkout's runs against `budget.step_p95`; nothing is judged of `before`.

```text
"app": {"verdict": "PASS", "runs": [0.41, 0.40, 0.42, 0.41, 0.40], …,
        "before": {"p50": [0.11, …], "p95": [0.39, …]}, "after": {"p50": [0.12, …], "p95": [0.41, 0.40, 0.42, 0.41, 0.40]}}
```

(The numbers in that example are made up; no test holds one.)

### Planted wrong programs

Each is `deep-physics --planted <name>` on the shipped build *(base: its way of starting a wrong program)*, the real
program but for what its row says. Its process exits 0 and answers every call; the judge that passes the real program
fails on it, naming what the criterion says. Both names are *(ours)*; `twins.json` maps each criterion's ID to its
names.

| Name | Criterion | The wrong program | Its failure |
|---|---|---|---|
| **`wrapper_leaves_contact_reuse_on`** | 1, 3 | the wrapper leaves the backend's contact reuse on for every pair of every world, as the merge base's does. The box on the turntable slides out to 3.957 m from the axis at 6 s; the 1 cm cube at the edge has not dropped 0.5 mm until its centre is 5.23 sides past. The five 1 cm cubes still stand | names `box` and the first step past 0.06 m of 1 m, in the judge's sentence and in the kit's `turntable` row (`body`, `step`), whose `measured` is that 3.957 m; at the edge the judge names `cube` and reads 5.23 sides |
| **`wrapper_turns_contact_reuse_off`** | 3 | the wrapper turns the backend's contact reuse off for every world (`contact_recycling` false). The five 1 cm cubes at 480 Hz, `contact_hz: 240` and `length_unit: 0.01` fall over: the top one ends more than half a side below 4.5 sides. The 1 cm cube at the edge still drops before 1.6 sides | names the top body, `cube5` |

## The worlds

Criteria 1, 2 and 5's worlds are at the kit's own settings: `kind: "physics.world@1"`, `dimensions: 3`,
`step_rate: 120`, `substeps: 4`, `gravity: [0, -9.81, 0]`, `mode: "dynamic"`, the kit's capacity
(`{bodies: 32, shapes: 32, joints: 4, contacts: 128, particles: 0}`), one contact material `m`,
`{friction: 0.5, restitution: 0, density: 1000}`, and no `solver`, seed or backend written. A dynamic body is
`{kind: "dynamic", shapes: [{shape, contact_material: "m"}], pose: {pos}, sleep: false, mass}`; `sleep: false` is the
kit's own. `helpers.ts` builds each document.

**The turntable** (`turntableWorld`, the kit's `turntable`; in a scene, the world `table`):

```text
shapes  disc: {kind: "cylinder", half_height: 0.1, radius: 30}      box: {kind: "box", half: [0.25, 0.25, 0.25]}
bodies  disc: dynamic, pos (0, -0.1, 0), mass 20000                 box: dynamic, pos (1, 0.25, 0), mass 1
joints  axle: {kind: "hinge", a: "world", b: "disc",
               frame_a: {anchor: [0, -0.1, 0], axis: [0, 1, 0]}, frame_b: {anchor: [0, 0, 0], axis: [0, 1, 0]},
               motor: {mode: "velocity", target: "items/dial/at/pos/0", max_torque: 100000000, hz: 30, damping_ratio: 1}}
```

- The disc is 0.2 m thick, as #2306's is, its top face y = 0, with nothing under it; its hinge is the vertical through
  the origin. The box rests on it with its centre at (1, 0.25, 0): "set 1 m from the axis" is the centre's distance
  from that vertical, and "the box's centre" is the body's `pos`.
- The motor has torque to spare (the disc's 9,000,000 kg·m² needs 7,070,000 N·m for 45°/s²). Its `hz: 30` and
  `damping_ratio: 1` are the ones at which the base reads the issue's own numbers for this world: 1.040 m at 1 s,
  1.549 m at 3 s and 3.957 m at 6 s at 90°/s, and 1.309 m at 6 s at 30°/s (1.0399, 1.5490, 3.9571 and 1.3094). At
  `hz: 10` the base reads 3.943 m at 6 s, and with the box on the z axis 3.972 m, so the third decimal is this world's.
- "Rising from 0 to 90°/s over 2 s and held 4 s": the scene's channel `dial`, `{target: "items/dial/at/pos/0",
  type: "f32", keys: {k0: {t: "0s", value: 0, interp: "linear"}, k1: {t: "2s", value: 90, interp: "hold"}}}`, which
  step k reads at k ÷ 120 s (#1918): 90 × min(k, 240) ÷ 240. "With 30°/s in place of 90°/s": the same scene with
  `value: 30`. Each is baked 720 steps; "every step of the 6 s" is the states after steps 1 to 720 (and the built one).

**The straight platform** (`platformScene`; the world `ride`): `platform`, a kinematic body with one box of
`half: [2, 0.1, 2]` on material `m`, at (0, -0.1, 0), `follow: "items/platform/at/pos"`; and the same box at
(0, 0.25, 0) on its middle. The channel `deck` (`type: "vec3"`) holds a linear key at every step of the first second,
(k ÷ 120)² m along x (2 m/s² up to 2 m/s), and one at 6 s, 11 m, as #2306's platform ramps. Baked 720 steps.

**What rested** (criterion 3), each world from the suite that first held it:

| World | From | Document | Steps |
|---|---|---|---|
| Five and ten 1 m cubes | #2309's `stackWorld` | #191's world (120 Hz, 4 substeps) with a static floor and `cube1` … `cube<n>`, 1 m cubes of density 1,000 kg/m³ and friction 0.5 at y = k − 0.5, `sleep: false`; with no `solver`, and with `solver: {contact_hz: 80}` | 720 |
| The edge | #2308's `edge`, its `solver` left unwritten | `step_rate: 480` and nothing else changed from the defaults; the static `table`, a box of half (0.1, 0.05, 0.1) at (−0.1, −0.05, 0), its edge the plane x = 0; `cube`, a 1 cm cube of friction 0 with `velocity.linear` (0.886, 0, 0) at (−0.0603042, 0.005, 0) | 120 |
| Five 1 cm cubes | #2308's `stack` | `step_rate: 480`, `solver: {contact_hz: 240, length_unit: 0.01}`, the kit's floor, `cube1` … `cube5` at y = 0.005 … 0.045 | 1440 |

- **The edge's start.** The issue gives none, and what the base reads there depends on it: the backend keeps the
  cube's contact with the table until the cube has moved 5 cm from where it last found it, so the reading turns on
  where along the slide that was. From #2308's start, four sides before the edge, the base reads 2.09 sides (as
  #2308's README records). Started 11 steps of its slide earlier (11 × 0.886 ÷ 480 m, so at −0.04 − 0.0203042 m),
  the cube passes #2308's start after step 11 and every later position is #2308's; there the base reads the issue's
  5.23 sides (5.2292, at step 61) and a wrapper that finds the table's contacts anew its 1.35 (1.3531, at step 40).
  That start is this suite's.

**The 800-body world** (criterion 4) is #1921's drop, `dropScene()` with its world `drop` and its 600 steps, which
#1921's sixth criterion times with #2011's check: 400 boxes and 400 balls that land and fall asleep, its `budget` left
out, so its `step_p95` is the default 2 ms.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s; each `describe` and test title starts with its criterion's ID. A judge returns
what is wrong as sentences, and each test asserts in its own file that there are none.

| File | Test | What fails it |
|---|---|---|
| `ac1` | real | either scene's world not baking; the box's centre more than 0.06 m (at 90°/s) or 0.01 m (at 30°/s) from 1 m from the axis after any step; the disc not turning at half its target at 1 s, or at its target at 2 s or at 6 s, within 1% of the target; the box gone around the axis no more than half the disc's own turn |
| | planted `wrapper_leaves_contact_reuse_on` | the planted program not running; the box's distance at step 720 not printing as 3.957 m; the judge passing it, or no failure naming `box` and the first step past the bound; the kit's `turntable` not held once with the data above, its row not `fail` with `body: "box"`, that `step` and a `measured` within a micrometre of the bake's farthest reading |
| `ac2` | here and at the merge base | the world not baking on either build; no merge base, or none that builds (`BLOCKED:`); the platform not where its channel puts it after any step; the box more than 1 mm from its place on the platform after any step, on this build or on the merge base's; the judge passing the same bake with the box left where it was built |
| `ac3` | real | a cube of the five or the ten at 1 mm/s or faster in any state after steps 601 to 720, at the default contact frequency or at `contact_hz: 80`; the top of five at the default not ending 5.87 mm below 4.5 m within 0.3 mm; the 1 cm cube never 0.5 mm below where it was built, or first so with its centre 1.6 sides or more past x = 0, or still before it; the top of the five 1 cm cubes ending more than 0.2 mm from y = 0.045 |
| | planted `wrapper_leaves_contact_reuse_on` | the planted program not running; the cube's centre at its first dropped step not printing as 5.23 sides past; the judge passing it; the five 1 cm cubes not standing under it |
| | planted `wrapper_turns_contact_reuse_off` | the planted program not running; the top 1 cm cube not ending more than half a side below 4.5 sides; no failure naming `cube5`; the cube at the edge not dropping before 1.6 sides under it |
| `ac4` | budget | no merge base, or none that builds (`BLOCKED:`); the check not answering one report; the app host not timed on this Mac's release build (five runs, loads, slowest step); `hosts.app.before` or `hosts.app.after` not `{p50, p95}` of five times each; a run's p50 over its p95; `after.p95` not `hosts.app.runs`; `before` a copy of `after`; then the app host's verdict anything but `PASS`: `INCONCLUSIVE:` where the rule reads a loaded machine or one off the reference Macs |
| `ac5` | macOS arm64 | another platform (`INCONCLUSIVE:`); `turntable` not in the kit's data once, or with another world, steps, `ramps`, answer or tolerance; its row not `pass` on `rapier3d`; its `measured` not this suite's reading of the same world's bake; the report's target not `aarch64-apple-darwin` |
| | wasm32 | the wasm32 build not answering; the same, with target `wasm32-unknown-unknown` |

Test count: 2 + 1 + 3 + 1 + 2 = 9. At the base one passes, as it should (`ac2`: the criterion says "as it is at the
merge base", and the merge base is the base); every other test fails there at its own assertion, and criteria 1 and 3
each have a test that fails on its planted program once it exists.

Not vacuous: the turntable's judge requires that the disc turned at its target and that the box went around with it,
so a box left where it was built, 1 m from the axis at every step, can't pass; the platform's requires that the
platform went its 11 m, and is shown failing on the same bake with the box left behind; the edge's fails a cube that
drops while still over the table; each planted wrapper is shown doing the rest of what its name says; and the budget's
`before` is held not to be a copy of `after`.

## Readings where the issue leaves a choice

- **The surface.** Motion is read on `bake`, the fixture on the kit's two calls, the budget on #2011's check, as the
  base's suites read them; no new call and no world field. "A new fixture" and "the turntable joins the … kit's data
  … once" are one fixture named `turntable`, the 90°/s run. "With 30°/s in place of 90°/s" is a second bake, judged
  here against its 0.01 m; no second fixture is asked for, and none is forbidden.
- **A target that rises, in the kit.** The kit has no scene, and at the base no fixture's motor target changes. The
  fixture's world keeps the motor's `target` as the item path a scene would write, the one form in which the base's
  backend takes a target at a step, and `ramps` says what the kit hands it. So the kit's world is, field for field,
  the world a scene bakes, and the wrapper needs nothing new for it.
- **"Within 0.06 m of 1 m from the axis at every step"**: |√(x² + z²) − 1| ≤ 0.06 for the box's `pos` after every
  step. **"The first step past the bound"**: the first step after which that fails. **"Reads 3.957 m at 6 s"**: the
  distance after step 720 printed to three decimals.
- **"Carries"**: the criterion bounds the distance from the axis alone, which a box that never moved would keep. The
  judge also asks, as premises, that the disc turns at its motor's target within 1% (the kit's hinge motor's bound)
  at 1 s (half of it), 2 s and 6 s, and that the box has gone around the axis more than half the disc's own turn. No
  closer bound on the box's turn is the issue's (#2318's second criterion has one, for its own suite).
- **"The box"** of criterion 2 is criterion 1's: 1 kg, half extent 0.25 m, friction 0.5, on a platform of friction
  0.5. **"Reaches 2 m/s in a straight line over 1 s and holds it 5 s"**: from rest at a constant 2 m/s² along +x,
  then 2 m/s to 6 s, 11 m in all, a key at every step of the first second. **"Its place on it"**: the box's offset
  from the platform along the platform (x and z), against that offset as built. **"As it is at the merge base"**:
  the same bake on the merge base's build is held to the same bound, and both must hold.
- **The stacks' contact frequency.** #2309's second criterion, which first held these stacks, reads the speeds at
  `contact_hz: 80` and the 5.87 mm at the default 30 Hz; the issue's opening paragraph reads both of five at the
  defaults (0.0001 m/s and 5.85 mm). "What rested still rests" is held to both: five and ten rest at the default and
  at 80 Hz, and the top of five ends 5.87 mm low at the default. **"Throughout the sixth second"**: the states after
  steps 601 to 720. **"Ten stacked rest too"**: the same speed bound, no depth.
- **"At `step_rate: 480`, with no other setting changed"**: changed from the world's defaults, the world the issue's
  opening paragraph measured 5.23 and 1.35 sides in ("at 480 Hz"); #2308's own edge world also writes a contact
  frequency and a solver length, and reads 1.35 at the base already. **"Has dropped 0.5 mm"**, **"before its centre
  is 1.6 sides past the edge"** and the cube's start: #2308's judge (`edgeRead`), and The worlds, the edge.
- **"Topples them"**: the top cube's centre ends more than half a side below 4.5 sides, as #2308 reads its own
  planted stack. **"End"**: after the last step of #2308's 3 s.
- **"The 800-body world of the step budget (#2011)"**: the world #1921's sixth criterion times with #2011's check.
  **"Before and after"**: the merge base's release build and this checkout's, on the app host, five runs each.
  **"p50"**: each run's median step. The web host has no merge-base build to time and is asked with no reference
  Mac, as #1921 asks it.
- **"On macOS arm64"** is the native build on this machine; **"in the wasm32 build"** is
  `node scripts/physics-wasm32.mjs`, as #191's first criterion runs the kit there.
- **"Naming"** a body or a step: the judge's sentence starts with the body's ID and holds `step <k>`; a kit's row
  carries them as `body` and `step`.

## A right program, to check these worlds

A throwaway change was made in this checkout to see that a right program can pass and the wrong ones fail, then put
back (`git checkout -- crates scripts`); the base's binaries were rebuilt before `BASE-FAILURE.txt` was taken, the
release one byte-identical to the one built before the change. In
`lib.rs` it gave an active contact hook, which does nothing, to every shape use of a static body, of a kinematic body
and of a dynamic body a hinge motor turns, so the backend reuses no pair that touches one and reuses every other; it
added the two plants (no such marks; `contact_recycling` false), the kit's `ramps`, a measure and the `turntable`
fixture, and `before` with the two report fields in the budget script, about 150 lines in all. No expected value here
was taken from it. All nine tests of the suite as delivered ran on it; eight passed and `ac4` read `INCONCLUSIVE:`
after its report passed every other check (the machine was loaded past its cores and its thermal state wasn't
nominal, so the rule gave a reading: the step's p50 0.305 to 0.381 ms before and 0.354 to 0.421 ms after, its p95
0.765 to 1.192 ms before and 0.780 to 1.161 ms after). Its readings:

| | Right program | Planted program |
|---|---|---|
| The turntable at 90°/s | 1.001, 1.007, 1.017, 1.028, 1.038, 1.049 m at 1 s to 6 s (the issue: 1.049 at 6 s); 450.11° around of the disc's 450.14° | `wrapper_leaves_contact_reuse_on`: 1.040, 1.210, 1.549, 1.970, 2.570, 3.957 m (1.040, 1.549, 3.957); first past the bound after step 146 |
| The turntable at 30°/s | 1.005 m at 6 s (1.005); 150.04° of 150.05° | 1.309 m at 6 s (1.309) |
| The kit's `turntable` | `pass`, `measured` 1.0491340920853967, equal to the bake's reading, natively and on wasm32 | `fail`, `body: "box"`, `step: 146`, `measured` 3.95710434684388 |
| The straight platform | 0.1772 mm at most, at the merge base 0.1772 mm | |
| Five 1 m cubes | 0.084 mm/s at most and 5.845 mm low at the default (0.0001 m/s, 5.84 to 5.85 mm); 0.064 mm/s at 80 Hz | |
| Ten 1 m cubes | 0.397 mm/s at the default, 0.085 mm/s at 80 Hz | |
| The edge | dropped at step 40, 1.3531 sides past (1.35) | `wrapper_leaves_contact_reuse_on`: step 61, 5.2292 sides (5.23); `wrapper_turns_contact_reuse_off`: 1.3531 |
| Five 1 cm cubes | 0.916% of a side low (0.92%) | `wrapper_turns_contact_reuse_off`: fallen, the top 4.000 sides low; `wrapper_leaves_contact_reuse_on`: 0.916% |

No number of the issue's was missed. Every other fixture of the kit still passed on it (87 of 87).

## Not asserted, because no criterion says so

`caps()`'s declared list and the sentence the Scope gives it; which pairs a right program reuses, and how it marks
them; the box's speed, height or turn beyond the premise above; two boxes stacked on the disc, a kinematic disc
turned by its channel (#2318), a character or a vehicle on a turning body, and things under 2 cm on one (the Scope's
Not in this task); the 30°/s run as a kit fixture; the kit's `turntable` on any backend but the reference, or its
`caps`; `ramps` on any other fixture; a row's `step` on a pass; the step hashes of any world and the goldens recorded
again (the Scope's, by the owner's decision); how much slower or faster a step is after than before; the web host's
budget; the stacks' sideways drift; the 1 cm stack's speeds and its 1% aside (#2308's); the design documents' text.

## What the implementer adds outside this folder

How contacts are found for a body on a turning body, in `deep-physics-rapier`, with the two planted names; the
`turntable` fixture, `ramps` and its measure in `deep-canvas-physics`'s kit; `before` and `hosts.app.before` /
`hosts.app.after` in `scripts/physics-budget.mjs`; and what the Scope lists beside the criteria (the caps' sentence,
the goldens recorded again, the design's kit list). Nothing in this folder changes.

## Gaps, deviations and what the owner must settle

1. **The Scope's named way doesn't meet the edge clause by itself.** The Scope says what the probe saw meet the
   turntable and the small stack is "reuse turned off only for pairs that touch the body that turns", a kinematic
   body or a dynamic body a hinge motor turns. Criterion 3 also asks that the 1 cm cube drop before 1.6 sides past a
   *static* table's edge at a solver length of 1 m, which the base reads 5.23 for because that pair is reused. With
   only turning bodies marked the throwaway program still read 5.2292 there; with static bodies' pairs not reused
   either it read 1.3531 and every other clause held. The tests hold the criterion. How is the implementer's.
2. **#2308's first planted test leans on the reuse this issue's third criterion ends.**
   `tests/acceptance/2308/ac1-edge.test.ts` holds `wrapper_ignores_length_unit` to 2.09 sides. On the throwaway
   program that plant read 1.35 (the static table's pair was no longer reused at a length of 1 m), as #2308's own
   comment warns. Read from that test's code and one bake, not run (this job runs no other suite). The implementer
   can't edit that suite: either that plant also leaves the reuse on, or the owner sends #2308's criterion to a
   redraft.
3. **The edge's start is this suite's, chosen so the base reads the issue's 5.23.** The issue gives no start, and
   from #2308's the base reads 2.09. The start (11 steps of slide before #2308's) is the nearest one to #2308's at
   which the base reads 5.23 and a right program 1.35; whether it is the probe's is unknown. If the owner names
   another, the world changes and the two printed values stay.
4. **The turntable's motor (`hz: 30`, `damping_ratio: 1`), thickness and the box's place on the x axis** are this
   suite's too, chosen as the world in which the base reads all four of the issue's numbers; the planted test's
   3.957 holds the planted wrapper to that world to the millimetre.
5. **Criterion 2 names no wrong program and holds at the base**, so its test passes there: a guard for behavior that
   must not change (design: Proven on the base), not a proof of new behavior. It fails on a program that leaves the
   box behind (shown on a doctored bake) and on one whose remedy moves the box more than 1 mm on a straight platform;
   it proves nothing about the remedy itself.
6. **Criterion 4 can't pass off the reference Mac.** Here the rule reads `INCONCLUSIVE:` whatever the program does;
   the fields are judged first, so a report without them fails as a failure and not as a reading. "So what the change
   costs … is a number you see" is held as the four lists being in the report; no bound on the cost is the issue's.
7. **#191's first criterion's test** holds every fixture of the kit to 120 Hz and 4 substeps; the turntable is at
   both. It also reads each fixture's `world`, `answer`, `tolerance` and `caps` and none of `ramps`, so the new field
   doesn't touch it (read from its code, not run).
8. **The bake lints the disc as a fast body** (`physics.fast_body`, a warning: its rim moves 0.39 m a step and it is
   0.2 m thick). The bake is accepted and no criterion mentions the lint; a thicker disc quiets it and moves the
   base's 3.957 to 3.949, so the disc stays 0.2 m thick.
9. Nothing here proves the Scope's sentences that no criterion states: the caps' sentence, the goldens recorded again
   with their cause, two boxes stacked on the disc, and the marks a kinematic body gets.
