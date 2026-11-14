# Acceptance tests for #523: hinge turns, joint force that counts only locks and limits, breaks and speed caps

Written first, from issue #523 (as of November 13, 2026: its Scope, its seven acceptance criteria, its Proof line "The
flywheel, disc and hanging-body fixtures with their planted twins" and its Depends on line, #522), the design sections
it names and base commit `9b77cd2cd` ("Merge pull request #2438 …"), by a job that never saw an implementation; none
existed, and no other worktree, branch or pull request was read. #522 (the checkpoint ring and seek) is not in the base
and wasn't read: criterion 1's seek uses what the base offers, a bake's checkpoint restored and stepped on. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). Lean: one test per criterion clause that needs its own run, plus a test for each planted twin the criteria
and the Proof line name.

## What was read

- The issue, live (`gh issue view 523 --repo windoliver/deepbuild`).
- `docs/technical-design.md`: The physics module (World; Shape, body, contact material, collision group; Joint and
  force; Soft body and checkpoint ring; Input, occurrence, output; Bake and golden; Behavior kit), Dogfooding and Tests
  written first. AGENTS.md.
- `docs/canvas-primitives.md`: A timeline as data over a pinned backend; World and backend `physics.world@1` (its caps:
  "Rapier caps each body's speed at `max_speed` and its turn at 45° a step, and a body it caps writes `fault {kind:
  speed_cap}` naming it"); Body `body@1`; Contact material; Joint `joint@1` (limits, motor, `breaks_at {force, torque,
  over_steps}`, `ratio`, `of`, `pulley`, and its Semantics: force from locks and limits ÷ the substep, `joint_force`,
  the hinge's `joint_coordinate` counting turns, speed_cap at 180° a step, couplings in kinematic mode only); Occurrence
  list (`break {force, torque}`, `crossing {t: flick, output, level, direction: ±1}`, `fault {kind: nan | capacity |
  speed_cap | penetration}`); Physics output (`read: … joint_coordinate | joint_force …`); Checkpoint ring; Bake;
  Physics: behavior kit; Kinematic solve (`drivers`, `iterations = 20`, `tolerance = 1e-5`; "It can never: Report a
  jam as success"); Check input: `physics.determinism`; the extended `physics.audit` kinds.
- At the base, read only for the surfaces these tests drive: `tests/acceptance/2009/`, `2010/`, `2011/`, `1918/`,
  `1919/`, `1920/`, `1921/`, `525/` (READMEs, helpers, `twins.json`, `BASE-FAILURE.txt`, a test each);
  `crates/deep-physics-rapier` (`README.md`, `Cargo.toml`, `src/main.rs`, `src/runner.rs`, `src/lib.rs`'s joints, motors,
  solve and build, `src/occurrences.rs`, `src/scene.rs`); `crates/deep-canvas-physics` (`doc.rs`, `doc/reads.rs`,
  `check.rs`, `caps.rs`, `occurrence.rs`, `bake.rs`, `module.rs`); `crates/deep-show/src/physics.rs` (which runs the same
  world check); Rapier 0.36.1's speed cap, rotation integration and joint impulse write-back (in cargo's registry);
  `scripts/proof-runs.mjs` (`twins.json`), `scripts/proof-change.mjs` (criterion IDs), `scripts/lanes.mjs`.

What the base already does, which these tests don't credit: `deep-physics` checks, bakes, restores and goldens worlds
with hinges, sliders, fixed joints, limits and numeric motors (#2009, #2010); writes `break` rows from `breaks_at`,
counting a joint's lock impulses alone ÷ the substep (#1918: "#523 brings the accounting that leaves out limits' and
motors' impulses"); accepts outputs that read `joint_coordinate` and `joint_force` but samples only `position` reads
into `outputs`; refuses an output's other fields (`crossings` is `unknown_field`) and gear, rack, pulley and path joints
(`physics.unsupported`, "#523 brings it"); places a kinematic solve's tree of hinges and sliders exactly from each
driven joint, with no closed loop, residual or jam; lets Rapier cap a body at 45° a step and 400 m/s without a row;
writes no crossing, fault or jam row; raises no `physics.mass_ratio`; and answers `--planted` with any of this suite's
names `{"ok":false,"code":"bad_input"}` with exit 2.

Checked at the base before the run, with a probe (not committed) on the base's `deep-physics` and this suite's worlds:
the pressed arm's lock force is between 62.4 N and 63.0 N at every one of its 240 steps (62.5 N worked out below),
its lock torque 6e-6 N·m; the arm resting on its limit never passes a torque threshold under lock-only accounting
(its break payload's torque reads 3.9e-13 N·m) and its last substep's lock force reads 25.2 N, not its 100 N weight,
which is why no test pins joint_force's force on that world; the hanging body's hook breaks at step 6 at substeps 1, 4
and 8 with force 19.6200008 N; the shot moves at 400 m/s from step 1; the disc at 7,200 deg/s and the flywheel at
22,800 deg/s both turn at Rapier's 5,400 deg/s cap from step 1, 44.856° a step by their poses (Rapier's linearized
rotation; hence criterion 5's 1%); the flywheel at 360 deg/s turns 2.99998° a step.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs build --wait 120 -- sh scripts/lease \
  npx vitest run --root tests/acceptance/523 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/523/tsconfig.json          # type-check
rm -rf tests/acceptance/523/node_modules               # vitest's cache
```

Every file builds one binary once, in `beforeAll`, through `../2009/helpers.ts`: `cargo build --locked --bin
deep-physics`, honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set and
Homebrew's rustup put on `PATH` when present, copied to a temporary folder. The planted twins are the same binary
started with `--planted <name>`; no other build or cargo feature. A test whose build failed fails at "deep-physics
builds" with cargo's error; without cargo it throws `BLOCKED:`. Every test passes #2009's one-hour timeout. Node
built-ins and vitest only; `../2010/helpers.ts` and, through it, `../2009/helpers.ts` are imported read only (the world
builders `world`, `box`, `sphere`, the calls `check`, `restore`, the readers `statesOf`, `answered`, `speed`, the
judges `none`, `caught`, the build). No process is started but `cargo` and `deep-physics`, each waited for, none
stopped by name or port; no network call. No reading depends on load, a device or another machine: nothing here is
INCONCLUSIVE or gated.

`BASE-FAILURE.txt` holds the run at the base, trimmed to each test's failing assertion.

## The surface under test

The issue names readings (`joint_coordinate`, `joint_force`), `breaks_at`, a break occurrence, a crossing with a level
and a direction, fault speed_cap, a seek, a gear, a pulley, a jam, `physics.mass_ratio` and planted programs, but no
call. These tests drive `deep-physics` as #2009, #2010 and #1918 left it (JSON lines on stdin, one reply per line,
exit 0; `bake`, `restore`, `check`, and `bake` of a scene's world). Times are flicks (705,600,000 a second; a 120 Hz
step is 5,880,000). **Every field, reply field and planted name below marked *(ours)* is this job's invention**, the
smallest the criteria need, named as the issue and the design name them; the implementer builds exactly these, or a
dispute goes to a blind redraft.

### Readings

`{"call": "bake", "world", "steps", "frame_rate": "120/1", "read": []}` (#2010's call): at 120 frames a second on a
120 Hz world, frame k is the state after step k, so `outputs.series.<output ID>[k]` is the reading after step k, k = 0
to `steps` (#2010's `outputs`, which at the base holds only `position` reads). For an output `{"from": "<joint ID>",
"read": "joint_coordinate" | "joint_force"}` *(ours: the shape of its samples)*:

- `joint_coordinate`: a number, degrees (`[number]` is read the same).
- `joint_force`: a number, newtons, or `{"force": N, "torque": N·m}`. Criterion 3 reads the torque, since a hinge's
  limit and motor act about its axis, so its tests need the object; criterion 4 reads the force either way.

A hinge's coordinate follows the right-hand rule about its frames' axis: body `b` turning positively about it,
relative to `a`, raises it (the flywheel turns +360 deg/s about +y on a +y hinge and reads +1,080° at 3 s).

### The world document, besides #2009's, #2010's and #1918's fields

- **An output's `crossings`** *(ours)*: `[level, …]` in the output's unit, `"outputs": {"spin": {"from": "axle",
  "read": "joint_coordinate", "crossings": [90]}}`. Each time the reading passes a level between two steps it writes
  the design's `crossing {t, output, level, direction: ±1}`.
- **Joints**, as Joint `joint@1` writes them: `{"kind": "gear", "a": "cog_in", "b": "cog_out", "of": ["drive",
  "driven"], "ratio": 2}` and `{"kind": "pulley", "a": "left", "b": "right", "ratio": 1, "pulley": {"ground_a": [-1, 2,
  0], "ground_b": [1, 2, 0], "length_min": 0.5, "length_max": 3.5}}`, run in kinematic mode; the gear holds the second
  hinge's coordinate at `ratio` times the first's (the test takes either sense), the pulley the sum of its two
  lengths, each from its body's anchor to its ground point, at their sum as built (`ratio` 1).
- **The kinematic solve** (#1918's `solve: {drivers: [{joint, channel}], iterations: 20, tolerance: 1e-5}`) solves a
  closed loop: the arm's `shoulder`, `elbow` and `grip` hinges with the driven slider `reach`.
- `breaks_at: {force?, torque?, over_steps}` and motors as at the base.

### Rows this suite reads

#1918's list (`occurrences` of a bake): `{"step": k, "kind": Kind, "a": ID, "b": ID | null, …payload}`.

- **`break`** (#1918's): `{"step", "kind": "break", "a": "<joint ID>", "b": null, "force": N, "torque": N·m}`.
- **`crossing`**: `{"step", "kind": "crossing", "t": flicks, "output": "spin", "level": 90, "direction": 1 | -1}` (its
  `a` and `b` not read). `t` is interpolated between steps and floored to a flick (Occurrence list).
- **`fault`** *(ours: where its kind sits)*: the row's own `kind` is `fault`, so the design's `fault {kind: speed_cap}`
  keeps its kind in another field, e.g. `{"step": 1, "kind": "fault", "a": "disc", "b": null, "fault": "speed_cap"}`.
  The tests take any field but `kind`, `a` and `b` whose value is `"speed_cap"`, or an object whose `kind` is. What it
  names is `a` (or `b`, or a `joint` field): the disc, the shot.
- **A jam** *(ours)*: a row `{"step", "kind": "jam", "a": "<joint ID>"}`, or a fault row as above whose kind is
  `"jam"`, naming one of the arm's joints (`a`, `b` or `joint`): the issue says "naming the joint" and doesn't say
  which, so any of `shoulder`, `elbow`, `grip`, `reach` passes. A jam is a row of the bake, not a refusal of it.

### Hashes and checkpoints

The Scope puts the hinge's turn count in the joint's state, "in checkpoints and the state hash": a bake's
`step_hashes` and a restore's must cover it. Criterion 1's seek is the base's: `bake` with `"checkpoints": true` (the
flywheel checkpoints every 70 steps), the last checkpoint at or before step 300 (2.5 s; step 280) passed whole to
`{"call": "restore", "world", "checkpoint", "steps": 20, "read": []}`, whose `step_hashes` (steps 280 to 300) must be
the bake's.

### The check

`{"call": "check", "world"}` (#2009's), whose reply `{"ok": true, "issues": [Issue]}` lists the world check's issues,
the check the physics module's codes come from at the base (`deep-canvas-physics`'s `check`, which `deep-show` runs
too). *(ours: the issue's fields)* `{"code": "physics.mass_ratio", "ids": ["wrist", "hand", "torso"], "path":
"joints/wrist", "actual": {"ratio": 200}, "what": "…"}`; any `severity`. The test reads `code`; takes an ID as named
when it's in `ids` or a word of `what`; and takes the ratio from `ratio`, `actual` or `actual.ratio`, or a number in
`what`, within 1% of 200. A world the check raises it for may still build: the test doesn't ask.

### Planted twins

Each is `deep-physics --planted <name>` *(ours)*, the base's way of starting a wrong program (`runner.rs`'s
`PLANTED`), and changes nothing but what its row says.

| Name | Criteria | The wrong program |
|---|---|---|
| `hinge_coordinate_wraps` | 1 | a hinge's `joint_coordinate` is the angle between its bodies wrapped at ±180°, with no turn count; its crossings are read from that |
| `checkpoint_drops_turns` | 1 | a checkpoint keeps no hinge turn count: a restore starts each count at 0, while play counts as it should |
| `speed_cap_silent` | 2, 5 | the backend and the hinge cap speeds as before, but no `fault` row is written |
| `joint_force_per_step` | 4 | a joint's force, its `joint_force` and its `breaks_at` divide the last substep's lock and limit impulses by the step's length, not the substep's |
| `solve_cap_reports_success` | 6 | the kinematic solve that stops at its iteration cap reports success and writes no jam |
| `mass_ratio_declared_only` | 7 | the mass-ratio check reads declared masses only, skipping a body whose mass comes from density × volume |

`twins.json` maps each criterion's ID to its twins (`scripts/proof-runs.mjs`).

## The fixtures

All at 120 Hz, 4 substeps unless said, gravity (0, −9.81, 0) unless said, on #2009's `world` defaults; every dynamic
body of criteria 1 to 5 has `sleep: false`, so nothing sleeps under a reading.

- **The flywheel** (criteria 1, 2): a balanced 10 kg cylinder, radius 0.5 m, on the hinge `axle` to the world about +y
  through its centre, started at 360 deg/s (criterion 1; 3° a step, 1,080° in 3 s, level 90° at 0.25 s) or 22,800
  deg/s (criterion 2; 190° a step), no motor, no damping; checkpoints every 70 steps. Criterion 1's has the output
  `spin`; criterion 2's has none.
- **The arm** (criterion 3): a 1 m bar of 100 ÷ g kg (weight 100 N, 50 N·m about its end) on the hinge `elbow` about
  +z at its end, with `breaks_at {torque: 20, over_steps: 6}` and the output `load` (`joint_force`). *Held*: no gravity,
  limits ±90°, a velocity motor (target 90 deg/s, `max_torque` 50 N·m, 10 Hz) pressing it up against a static 5 cm
  ball touching its top 0.8 m from the hinge: the ball pushes back 50 ÷ 0.8 = 62.5 N, the pin holds 62.5 N, no limit
  is engaged, and the motor's 50 N·m is no joint load. *Broken*: gravity, no motor, limits 0° to 90°, the bar level
  on its lower limit, which holds 50 N·m about the axis.
- **The hanging body** (criterion 4): a 2 kg, 0.1 m ball hanging from the world by the fixed joint `hook` at its top,
  at substeps 1, 4 and 8; m·g = 19.62 N; output `load` (`joint_force`); with `breaks_at {force: 15, over_steps: 6}`
  for the break.
- **The disc and the shot** (criterion 5): a 1 kg disc, radius 0.2 m, on the hinge `axle` about +y, launched at 7,200
  deg/s (60° a step), output `turn` (`joint_coordinate`); a free 1 kg ball, no gravity, launched at 500 m/s along +x.
  Rapier's caps at 120 Hz: 45° a step (5,400 deg/s) and `max_speed` 400 m/s.
- **The machines** (criterion 6): one scene (#1918's form: items, f32 channels on `items/<id>/at/pos/0`, `worlds`)
  with three kinematic worlds, no gravity. `gears`: cogs on hinges `drive` and `driven` about +z, the gear `mesh` of
  ratio 2; `drive` set from `crank`, 90°/s. `pulley`: weights on vertical sliders 2 m under their ground points, the
  pulley `rope` of ratio 1 (sum 4 m); the left slider lowered from `lower`, 0 to −0.5 m in 2 s. `arm`: 1 m links
  `upper` (on `shoulder`, at the origin, at 60°) and `fore` (on `elbow`, at −60°), whose tip is held by the hinge `grip`
  to `hand` on the slider `reach` along +x; `reach` set from `reach`, 1 m rising 0.5 m/s, so the arm is straight at 2 s
  (step 240) and can't follow after.
- **The hand and the torso** (criterion 7): the torso box 0.3 × 0.6 × 0.2 m declared 40 kg, the hand box 0.1 × 0.1 ×
  0.02 m, both on a material of density 1,000 kg/m³ (the torso's box would be 36 kg by it), joined by the hinge
  `wrist`; the hand's mass derived (0.2 kg, 200:1), declared 5 kg (8:1) or declared 4 kg (10:1).

## The tests

| File | Test | What fails it |
|---|---|---|
| `ac1-flywheel-turns` | (coordinate) | `spin` not 1,080° ± 0.5° at step 360, or not rising at some step |
| | (crossing) | not exactly one level-90 crossing with direction +1 at t within one step of 0.25 s, or any with −1 |
| | (seek) | a step hash of the restore from step 280 to 300 differing from the bake's |
| | (twin: hinge_coordinate_wraps) | the twin passing the coordinate judge or the crossing judge |
| | (twin: checkpoint_drops_turns) | the twin passing the seek judge |
| `ac2-flywheel-speed-cap` | (fault) | no fault speed_cap at step 1 |
| | (twin: speed_cap_silent) | the twin passing it |
| `ac3-motor-and-limit` | (held) | a break in 2 s; joint_force's force off 62.5 N by more than 5%, or its torque over 2.5 N·m, at a step from 1 s to 2 s |
| | (broken) | other than one break in 1 s, naming `elbow`, at step 6 or 7, with its torque past 20 N·m; joint_force's torque not past 20 N·m on the steps before it that count |
| `ac4-hanging-body` | (reading) | joint_force off 19.62 N by more than 1% at a step from 0.25 s to 1 s, at substeps 1, 4 or 8 |
| | (break) | other than one break naming `hook` at step 6 or 7, at substeps 1, 4 or 8 |
| | (twin: joint_force_per_step) | the twin passing the reading judge or the break judge |
| `ac5-disc-and-shot-caps` | (disc) | no fault speed_cap naming `disc` at step 1; `turn` not gaining 45° ± 1% a step from step 2, or 5,400 deg/s ± 1% over the second |
| | (shot) | no fault speed_cap naming `shot`; the shot's speed or its position's rate off 400 m/s by more than 0.1% |
| | (twin: speed_cap_silent) | the twin passing the disc judge or the shot judge |
| `ac6-kinematic-solve` | (gear) | `turn_in` not 180° ± 0.1° at 2 s, or `turn_out` not twice it ± 0.1° |
| | (pulley) | the left weight not at its driver's −0.5 m at 2 s, or the lengths' sum off 4 m by more than 1e-5 m at a step |
| | (jam) | no jam, the first at a step other than 239 to 241, or naming none of the arm's joints |
| | (twin: solve_cap_reports_success) | the twin passing the jam judge, or the failure not naming step 240 |
| `ac7-mass-ratio` | (ratio) | no `physics.mass_ratio` naming `wrist`, `hand`, `torso` and 200 for the derived hand; one at 8:1 or 10:1 |
| | (twin: mass_ratio_declared_only) | the twin passing it, or the failure not naming `wrist` |

Tolerances the issue gives are used as given (0.5°, one step, 1%, 0.1°, 1e-5 m). Where it gives none, the tests take
5% for the held arm's pin force (worked out from statics; the base's Rapier reads within 1% of it), 1% for the disc's
45° a step (Rapier's linearized rotation turns 44.856°) and 0.1% for the shot's 400 m/s, and the break windows are
`over_steps` or the step after (the design: "disabled at the start of the next step").

Which tests a wrong program other than the base must prove: the base passes (break) of criterion 4 (#1918's break
counts the lock force, which is the whole load of a hanging body), so its proof is `joint_force_per_step`, as
`twins.json` names.
