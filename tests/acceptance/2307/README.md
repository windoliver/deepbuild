# Acceptance tests for #2307: a parked vehicle stays parked, its brakes and grip hold it on a slope, and its controller rests while it sleeps

Written first, blind, from issue #2307 as saved on November 19, 2026 (its opening paragraph, Scope, seven acceptance
criteria, Proof line, Runs on line and dependencies; it has no comments and no Oracle line), the design sections it
links and base commit `85203f458` ("Merge pull request #2852 …"), by a job that never saw an implementation, a diff of
one, another worktree, branch or pull request. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test per criterion's runs, plus one test
per planted wrong program the criteria name.

## What was read

- The issue, from the two files this job was given: `issue-2307.md` and `issue-2307-body.md` (the criterion IDs are
  computed from the second and match the first's).
- `docs/canvas-primitives.md`: World and backend `physics.world@1` (the step order, `solver.sleep`, `caps()`,
  `drive_vehicle()`); Body `body@1` (`sleep`, `follow`) and its vehicle sibling; Input track entries; Occurrence list
  (`rest`, `wake`, `contact_begin`, `contact_end`); Physics output; Checkpoint ring (`hash`); Bake; Golden; Physics:
  behavior kit. `docs/technical-design.md`: The physics module (Vehicle body; Bake and golden; Behavior kit), Criteria
  to tests, Wrong programs, Dogfooding, Built to be hard to get wrong. AGENTS.md, CONTRIBUTING.md.
- At the base, for surfaces only: `tests/acceptance/251/`, `2306/`, `2309/`, `2243/`, `191/`, `522/`, `1918/`, `2009/`
  (READMEs, helpers, `twins.json`, `BASE-FAILURE.txt`, tests); `crates/deep-physics-rapier` (`main.rs`, `planted.rs`,
  `vehicle.rs`, `occurrences.rs`, `lib.rs`'s `step` and body build, `runner.rs`'s `bake` reply, `runner/vehicle.rs`'s
  planted list, `runner/kit.rs`'s test backends); `crates/deep-canvas-physics` (`kit.rs`'s fixture and row,
  `kit/vehicles.rs`, `golden.rs`'s step hash, `doc.rs`'s pose); the base's own commits of `vehicle.rs` (#251's and
  #2306's); the pinned backend's vehicle controller, `rapier3d-0.36.1/src/control/ray_cast_vehicle_controller.rs`, and
  where it sets a kinematic body's velocity; `scripts/proof-change.mjs` (criterion IDs), `scripts/proof-runs.mjs`
  (`twins.json`), `scripts/lanes.mjs` (the `alone` list).

## What the base already does, which these tests don't credit

The base holds #251's and #2306's wrapper around the backend's controller, not the controller the issue's first
paragraph probes. Read on its release build, on this suite's own worlds (`BASE-FAILURE.txt` has the run):

- **It creeps on a slope.** Its brake brings each wheel's rolling to rest before the step and the step then adds
  gravity. Braked at 4,000 N with sleep off, the car moves 0.144 m facing up 10° and 0.285 m facing up 20° in the 10 s,
  and standing across them 0.149 m and 0.293 m: not the issue's 0.183, 0.361, 0.089 and 0.174 m, which are its
  author's probe of the controller as it is. Criterion 1's test fails on all four.
- **It already slides at the worked rates.** Brakes of 1,000 N facing up 20° leave it 9.429 m/s at 4 s (worked:
  9.421), grip 0.3 across 20° lets its speed rise at 0.5904 m/s² (0.5897), and with `brake` 0 facing up 10° it has
  rolled back 13.635 m at 4 s (13.628). Criterion 2's test passes there, and stands so that a hold never holds more
  than it is asked; `hold_ignores_brake_limit` fails it.
- **#251's fixtures read what they read.** The kit's `vehicle_brake`, `vehicle_drive` and `vehicle_turn` pass at
  12.458 m, 4.000 m/s and 9.336 m, and the braked car's fastest move backwards is 0.038 m/s. Criterion 3's test
  passes there; `hold_takes_out_side_slip` fails it.
- **It already sleeps on a slope and rests its controller while it sleeps.** At its creep the car is slower than the
  world's sleep speed, so with sleep on it writes `rest` at step 117 on the 10° slope (and on level ground), and from
  then on it doesn't move, its step hashes don't change and its wheels write nothing. Criterion 4's test passes there;
  `controller_runs_asleep` fails it.
- **A drive already wakes it and drives it off.** Asleep on level ground and driven at 2,000 N it writes `wake` on
  step 481, reads 4.000 m/s at 2 s, and its centre doesn't rise; asleep on the 10° slope and driven at 6,000 N it
  climbs at 8.593 m/s. Criterion 5's test passes there; `controller_runs_asleep` fails it.
- **Its brake already carries it along a platform that gains speed along its heading**: #2306's brake reads a
  kinematic body's speed over the coming step, and the braked car ends 0.0065 m from its place, inside the criterion's
  0.02 m and not the issue's 0.34 m (README: Readings). A car asleep on a platform that starts to move is left asleep
  and 5.000 m behind. Criterion 6's test fails on the sleeping car.
- The behavior kit holds #251's five and #2306's four vehicle fixtures and none of this issue's three; #251's test
  backend `no_vehicle_controller` exists. Criterion 7's two tests fail.
- The base knows none of this suite's five planted names: each twin test fails there on `deep-physics --planted
  <name>` answering `{"ok": false, "code": "bad_input"}` and exiting 2.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs build --wait 120 -- sh scripts/lease \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/2307 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2307/tsconfig.json   # type-check
rm -rf tests/acceptance/2307/node_modules                                     # vitest's cache
```

| File | Builds (each once per file, copied out of the target folder) |
|---|---|
| `ac1` to `ac6` | `cargo build --locked --release -p deep-physics-rapier --bin deep-physics` (#191's `release`) |
| `ac7` | the same, and `cargo build --locked -p deep-physics-rapier --bin deep-physics --features test-backends` (#191's `test`) |

The suite's own cargo calls find those builds made and only copy them. Every test passes #2009's 60-minute timeout,
and #191's build hook four times that. Node built-ins and vitest only; `../2306/helpers.ts` (and through it `../251`,
`../522`, `../1918`, `../2010`, `../2009`, `../191`, `../2012`, `../138`, `../523`) and `../191/helpers.ts` are imported
read only. No process is started but `cargo` and `deep-physics`, each waited for; none is stopped by name or port, and
a `deep-physics` that outlives its limit is stopped through the child the test started. The only temp folder is
#191's copy of the binaries, removed after each file. No test times anything, so none depends on the machine or its
load. No cargo on the machine is `BLOCKED:` (#191's helper), a failed test, never a pass.

## The surface under test

The issue names no call, field or flag of its own. These tests drive `deep-physics` (JSON lines in, one reply a line)
as #2009, #1918, #522, #191, #251 and #2306 left it, and their READMEs' surfaces stand as written:

| Call | What these tests write and read |
|---|---|
| `{"call": "bake", "world", "track", "steps", "frame_rate": "120/1", "read": ["kart"]}` | `bodies.kart[k]`, the state after step k (index 0 the world as built): `pos`, `rot`, `linear`, `angular`; `step_hashes`, steps + 1 strings of 16 hex; `occurrences`, rows `{step, kind, a, b, …}` |
| `{"call": "bake", "scene", "world": "ride", …, "read": ["kart", "platform"]}` | the same of a scene's world, its kinematic body's `follow` channel resolved in the scene (#1918's form, as #2306's platform) |
| `{"call": "behavior_fixtures"}` | `fixtures: [{name, world, steps, track, answer, tolerance, caps}]` |
| `{"call": "behavior_kit"}` | `backend`, `admitted`, `verdict`, `results: [{backend, fixture, result, measured, answer, tolerance, what}]` |
| `{"call": "backend"}` | `caps` |

A track entry is #251's: `{"step": 0, "kind": "brake", "target": "kart", "data": {"force": 4000}}`, or `"kind":
"drive"`. An entry stamped at step k applies in the step from the state after k steps to the state after k + 1
(#522's convention), and a row that step writes carries `step: k + 1`. A body asleep has no flag in a bake: it falls
asleep in the step whose `rest` row names it (`{"kind": "rest", "a": "kart"}`) and sleeps until a `wake` row names it.
A wheel's row names the body and the wheel as #251's suite reads it: an ID `kart#fl` as `a` or `b`, or a field
`wheel` beside the body.

**Every name below marked *(ours)* is this job's choice**, the least the criteria need, named after what the issue
says the thing does. The implementer builds exactly these, or a dispute goes to a blind redraft.

### Planted wrong programs

Each is `deep-physics --planted <name>` on #191's release build (the base's way of starting a wrong program, as #251's
and #2306's are), changing nothing but what its row says. Its process must exit 0 and answer; the judge that passes
the real program must fail on it, naming what the criterion says it names. `twins.json` maps each criterion's ID to its
planted names. `controller_as_is` is #2306's and keeps the meaning its README gives; none of these is it.

| Name | Criteria | The wrong program | What it reads, and what the judge's failure names |
|---|---|---|---|
| `controller_without_hold` *(ours)* | 1 | the wrapper leaves the backend's vehicle controller as it is: the controller's own brake and grip, worked out from the chassis's velocity before the step, and no hold | braked at 4,000 N facing up the 10° slope, the car moves 0.183 m along it from 2 s to 12 s, within 5%; a failure starts `kart: moves <distance> m along the 10° slope, facing up it` |
| `hold_ignores_brake_limit` *(ours)* | 2 | the hold resists the whole pull along a wheel's heading, whatever its brake has left | with brakes of 1,000 N facing up the 20° slope the car is still at 4 s: slower than 0.05 m/s; a failure starts `kart: with brakes of 1,000 N in all` |
| `hold_takes_out_side_slip` *(ours)* | 3 | the hold itself takes out each touching wheel's sideways slip, where the controller's grip already does | `vehicle_turn`'s own world, baked over its own track and steps, ends with the car slower than 0.05 m/s; a failure starts `vehicle_turn: ` |
| `controller_runs_asleep` *(ours)* | 4, 5 | the wrapper runs the controller on a sleeping vehicle body, and its pushes are stored in the body's velocity | 4: on the 10° slope a step hash differs from the one before it while the car sleeps, a failure starts `step <k>: ` with k the first such step, and after step k the body's `linear` or `angular` isn't zero. 5: asleep on level ground and driven at 2,000 N it reads 3.62 m/s at 2 s, within 2%, and its centre rises 0.079 m, within 5 mm; failures start `kart: asleep on level ground and driven at 2,000 N, moves ` and `kart: woken on level ground, its centre rises ` |
| `leaves_asleep_on_moving_ground` *(ours)* | 6 | a vehicle body asleep stays asleep when the body under its wheels moves | on the platform that starts to move after step 600 no `wake` row names the car and it ends within 0.02 m of where it slept in the world, 5 m of platform gone from under it; a failure starts `kart: doesn't wake on step 601` |

Example: `deep-physics --planted controller_without_hold`, fed criterion 1's bake of the car facing up the 10° slope.

### Fixture names in the behavior kit

The three the criterion names join `behavior_fixtures` and `behavior_kit` once each, each with `caps` naming
`vehicle_controller` (#251's cap) and a world at 120 Hz and 4 substeps holding exactly one vehicle body:

| Name | Answer, as printed | Tolerance | Its world |
|---|---|---|---|
| `vehicle_slope` *(ours)* | 0 (m, the car's move along the slope over the 10 s) | `{"m": 0.001}` | the vehicle body with sleep off (`sleep: false`, or the world's `solver.sleep.on: false`), and a static body whose `pose.rot` turns it |
| `vehicle_weak_brake` *(ours)* | 9.42 (m/s at 4 s) | `{"relative": 0.01}` | a static body whose `pose.rot` turns it |
| `vehicle_sleeping_drive` *(ours)* | 4.00 (m/s at 2 s, from sleep on level ground), or 8.59 (m/s at 2 s, from sleep on the 10° slope) | `{"relative": 0.02}` | the vehicle body with sleep on: no `sleep: false`, and no `solver.sleep.on: false` |

An answer with decimals is read within half a unit of its last printed digit, as #191's, #251's and #2306's suites
read them (the worked 9.4209 and 8.5930 are inside); `vehicle_slope`'s is 0. Rapier's row for each reads `pass` with
its `measured` within its tolerance of its `answer`; on `--backend no_vehicle_controller`, which the kit admits, each
reads `excluded_by_caps`.

## The worlds

All at 120 Hz, 4 substeps, gravity (0, −9.81, 0), on #2009's `world` defaults (so the world's sleep is on, at
0.05 m/s and 0.5 s). **The car** is #251's `kart` (its README: The car; `../251/helpers.ts`): 1,000 kg, a box chassis of
half extents 0.8 × 0.15 × 1.5 m, on four wheels at the corners of a 2.5 m wheelbase and a 1.6 m track, 2 Hz springs
with damping ratio 0.3, rest 0.3 m, travel 0.2 m, front wheels steering, rear wheels driving, all braking, heading +Z,
axle X. Body IDs are *(ours)*: `kart`, `ground`, `platform`; the scene's world is `ride` and its channel `deck`, as
#2306's.

- **Set down** always means with every spring at rest length: the car's centre 0.75 m from the surface along the
  surface's normal, each wheel's ray just reaching it, turned with the surface.
- **The slope** (criteria 1, 2, 4, 5): the static body `ground`, a box of half extents 100 × 0.5 × 100 m whose top
  face passes through the origin, turned by its `pose.rot`, a quaternion. **Facing up it**: turned about X so the
  surface rises along +Z, the car's heading. **Standing across it**: turned about Z so the surface rises along +X, the
  car's axle, and its heading lies level. The car's pose takes the same turn. Level ground is the same body unturned.
  Each wheel's `grip` is written: 1, or criterion 2's 0.3.
- **Criterion 1**: `sleep: false`, a brake of 4,000 N stamped at step 0, baked 1,440 steps, on each of the four slopes.
- **Criterion 2**: `sleep: false`, baked 480 steps. Facing up 20° with a brake of 1,000 N stamped at step 0; across
  20° with grip 0.3 and a brake of 4,000 N; facing up 10° with a brake of 0 stamped at step 0.
- **Criterion 3**: the kit's own `vehicle_brake`, `vehicle_drive` and `vehicle_turn`, each world baked over its own
  track and steps.
- **Criterion 4**: facing up 10°, the body's `sleep` left on, a brake of 4,000 N at step 0, baked 1,380 steps.
- **Criterion 5**: `sleep` left on, baked 720 steps. On level ground a drive of 2,000 N stamped at step 480; facing up
  10° a brake of 4,000 N at step 0, and at step 480 a brake of 0 and a drive of 6,000 N.
- **The platform** (criterion 6): #2306's, a kinematic body 20 × 0.2 × 20 m, its top at y = 0.2, following the
  scene's channel `deck` (`items/platform/at/pos`), nothing under it; the car set down on its middle with a brake of
  4,000 N stamped at step 0. The channel's keys are linear, `t` in whole flicks: still through a start step, then a
  key at every step of one second, t² m along +Z (rest to 2 m/s), and one 3 s after the start, 5 m on. Awake: `sleep:
  false`, start step 240, baked 600 steps. Asleep: `sleep` left on, start step 600, baked 960 steps.

## The tests

IDs are `scripts/proof-change.mjs`'s; each `describe` and `it` title starts with its criterion's ID.

| File | Test | What fails it | Fails on |
|---|---|---|---|
| `ac1-parked-on-a-slope` (1 `#2307.8ca832fd`) | four slopes | on any of the four, the car's centre 1 mm or more along the slope from where it was after step 240 to where it is after step 1,440 | the base (0.144 to 0.293 m) |
| | twin: controller_without_hold | the twin passing, its failure not naming `kart` and the distance, or its move facing up 10° not 0.183 m within 5% | the base (unknown name) |
| `ac2-never-more-than-asked` (2 `#2307.3dfea1f1`) | three slides | the first car's speed down the slope after step 480 not 4 × (g sin 20° − 1) within 1%; the second's speed down the slope not rising at g (sin 20° − 0.3 cos 20°) within 2% from step 120 to 480; the third not g sin 10° × 4² ÷ 2 down the slope after step 480 within 1% | `hold_ignores_brake_limit`, on the first car; the base meets all three |
| | twin: hold_ignores_brake_limit | the twin passing, its failure not naming `kart`, or the first car moving 0.05 m/s or faster at 4 s | the base (unknown name) |
| `ac3-level-ground` (3 `#2307.536a975c`) | #251's fixtures | one of the three not once in the kit's data or report, its row not `pass` or measuring outside the criterion's tolerance; in its own run the braked car's stop not 12.5 m within 3%, not stopped by its last step, or moving backwards faster than 0.05 m/s after the brake's step; the driven car not at 4.00 m/s within 2% 2 s after the drive's step; the turning car's heading not once around, or the middle of its rear axle not on a circle of 9.330 m within 3% | `hold_takes_out_side_slip`, on the turn; the base meets all three |
| | twin: hold_takes_out_side_slip | the twin passing, no failure starting `vehicle_turn: `, or the turning car ending its run at 0.05 m/s or faster | the base (unknown name) |
| `ac4-asleep-on-the-slope` (4 `#2307.9f33326e`) | asleep | no `rest` row by step 180; a `wake` row after it; a step hash from the step after its `rest` to step 1,380 that isn't the one before it; a row naming one of its wheels after its `rest`; its centre 1 mm or more from where it was after step 180, after step 1,380. (The first step's hash must differ from the built state's, so the comparison can fail.) | `controller_runs_asleep`; the base meets it |
| | twin: controller_runs_asleep | the twin passing, no failure starting `step <k>: ` for the first step whose hash changes, or the body's velocity zero after that step | the base (unknown name) |
| `ac5-drive-from-sleep` (5 `#2307.400e4569`) | two drives | either car not asleep after step 480, or its `wake` row not on step 481; on level ground its speed along its heading after step 720 not 4.00 m/s within 2%, its centre more than 5 mm over its height after step 480 at a step to 720, or a wheel's `contact_end` after step 480; on the slope its speed up it after step 720 not 8.593 m/s within 2% | `controller_runs_asleep`, on level ground; the base meets both |
| | twin: controller_runs_asleep | the twin passing, no failure naming `kart` and its speed and none naming `kart` and its rise, its speed not 3.62 m/s within 2%, or its rise not 0.079 m within 5 mm | the base (unknown name) |
| `ac6-platform` (6 `#2307.fd4b6bbc`) | platform | awake: the braked car more than 0.02 m from its place on the platform after step 600. Asleep: no `wake` row on step 601, or the car more than 0.02 m from its place after step 960 | the base, on the sleeping car (no `wake`, 5.000 m); the base meets the first clause |
| | twin: leaves_asleep_on_moving_ground | the twin passing, no failure naming `kart` and step 601, a `wake` row after step 600, or the car more than 0.02 m from where it slept in the world | the base (unknown name) |
| `ac7-behavior-kit` (7 `#2307.ac8e941b`) | Rapier | Rapier's caps without `vehicle_controller`; a fixture of the three not once, off its answer or tolerance, not naming the cap, or its world not as the table says; one not passing on Rapier within its tolerance | the base (none of the three) |
| | excluded | `no_vehicle_controller` with the cap, refused, or any of the three reading other than `excluded_by_caps` | the base (none of the three) |

Test count: 2 × 7 = 14. `BASE-FAILURE.txt` is the run of each file at the base, trimmed to each test's failing
assertion, with a line for each test that passes there.

## Readings where the issue leaves a choice

- **"#251's fixture car"** is the car of #251's own suite, `kart`, as #2306's suite read the same words. It is also
  the car whose numbers the issue's first paragraph gives: worked from the pinned controller's source, a controller
  left as it is creeps (0.625 + m × (w ÷ 2)² ÷ I_yaw) × g sin θ ÷ 120 m a second on a slope, with w the 1.6 m track and
  I_yaw the chassis's moment about its up axis, which is 0.183 m in 10 s at 10° for this chassis (963 kg·m²) and
  0.145 m for the kit's fixture car. The same sum for the base's wrapper gives the 0.144 m the base reads.
- **"Set on a slope"** is set down with every spring at rest length, as #251's sag fixture and the kit's fixtures set
  the car down, which is why the criterion gives it 2 s to settle. On level ground the base then writes `rest` at step
  117, the step the issue's first paragraph gives.
- **"Moves less than 1 mm along the slope over the next 10 s"**: the distance between its centre after step 240 and
  after step 1,440, less the part along the slope's normal. "Facing up it" and "standing across it" are the two
  turns under The worlds.
- **How the twins are held to the issue's printed readings**, none of which could be run here, since the base knows
  no planted name of this issue's. Each is held near enough to be the program the issue probed and not another:
  - *0.183 m* (criterion 1), within 5%, as #251's suite holds its twins' printed readings. The figure is the
    controller's own (above), on this car, so a twin built as the criterion says reads it; 5% keeps out the base's
    wrapper without a hold, which reads 0.144 m.
  - *3.62 m/s* and *0.079 m* (criterion 5), within the criterion's own tolerances for the same readings, 2% and 5 mm.
    The world is the issue's: the car set down at rest length falls asleep at step 117 a little short of its full
    sag, and a controller run on it while it sleeps stores the velocity at which its dampers cancel its springs,
    which the issue gives as 1.259 m/s by step 480, the step this suite stamps the drive.
  - *"keeps the first car still"* (criterion 2) and *"stops the turning car"* (criterion 3): slower than 0.05 m/s,
    the world's sleep speed, under which a body counts as at rest: at 4 s for the first, at the fixture's last step
    for the second.
  - *"stores a velocity in it"* (criterion 4): after the first step whose hash changes, the body's `linear` or
    `angular` isn't zero.
  - *"leaves it behind"* (criterion 6): no `wake` row, and the car within 0.02 m of where it slept in the world.
- **"Brakes without the hold leave it 0.34 m short"** (criterion 6) is not asserted: it could not be reproduced. The
  base is #2306's brakes without a hold, and on the plainest platform that "reaches 2 m/s in 1 s", #2306's own
  constant 2 m/s² with a key every step, it ends 0.0065 m from its place (0.0232 m under #2306's `controller_as_is`).
  The base falls 0.23 to 0.48 m short only on a platform that jumps to its speed, where 4,000 N of brakes can't keep up
  and no hold within them could either. So the first clause stands as a guard the base already meets, in the same test
  as the sleeping car, which the base fails; no planted program is held to fail it.
- **"The car braked on the 10° slope"** (criteria 4 and 5) faces up it, the way its brake holds it. **"Is asleep by
  step 180"**: its `rest` row is on a step to 180, and no `wake` row follows it in the run, since the Scope lists what
  wakes a sleeping vehicle and none of it happens. **"10 s later has not moved 1 mm"**: its centre after step 1,380
  against after step 180. **"While it sleeps"**: from the step after its `rest` row to the run's last.
- **"A `drive` wakes it on that step"**: the `wake` row is on the step the entry applies, 481 for an entry stamped
  at 480, as #251's suite reads its drive from sleep. Both cars sleep 4 s first, so the drive lands at step 480, the
  step of the issue's probe. **On the slope** the drive's step also stamps `brake` 0, since no wheel drives while
  `brake` is above 0; **"climbs at"** is its speed up the slope. **"Its centre never rises more than 5 mm"**: its
  height after each step from 480 to 720 over its height after step 480.
- **"#251's fixtures"** (criterion 3) are the kit's three, by name, as #2306's suite read "#251's sag, brake, drive
  and turn fixtures"; "naming the turn fixture" is naming `vehicle_turn`. They are read by the kit's own rows and by
  their own worlds baked here, so the planted hold is caught through `bake` whether or not a planted wrapper reaches
  the kit's backends. In a fixture's own run "stops the car in 12.5 m" is the farthest it reaches along its heading
  from the step its brake is stamped; "never moves backwards faster than 0.05 m/s" is its speed along its own heading
  at every step after; "at 2 s" is 240 steps after the drive's step; the circle is fitted, as #251's suite fits it,
  from the steer's step until the heading has turned 360°, to the middle of the mounts of the wheels that don't steer.
- **"Its speed down the slope rises at"** (criterion 2): its speed down the slope after step 480 less after step 120,
  over the 3 s between, so the first second's settling is left out. **"With `brake` 0"** is an entry stamping it.
  **"At 4 s"** is after step 480, from the car set down at rest at step 0.
- **"Starts to move at step 600"** (criterion 6): the channel is still through t(600) and the platform first moves
  in the step from the state after 600 steps to the state after 601, as an entry stamped at step 600 applies; "wakes
  on that step" is a `wake` row on step 601. The sleeping car is braked like the first, and the platform moves as the
  first clause's does. Awake, the platform waits 2 s for the car to settle. "Its place" is the car's offset from the
  platform on the ground plane when the platform starts.
- **The kit's three** (criterion 7): one fixture each. "The slope" is one of criterion 1's four, whichever the
  implementer picks; "the sleeping drive" is either of criterion 5's two. The names are #251's pattern, `vehicle_…`.

## Not tested, because no criterion reaches it here

The hold's reaction on a dynamic body under a wheel, and a hold on a slope that itself moves (Scope; no criterion
names a reading); a sleeping vehicle woken by a `place`, by a touch, or by a dynamic body under a wheel that wakes;
"both together never pass grip × load" beyond criterion 2's two slides; the first clause of criterion 6 against a
program that fails it, and its 0.34 m (above); the hold on wasm32 or Linux; the issue's Not in this task (a handbrake
apart from `brake`, rolling resistance, a tyre model beyond the grip limit).

## What the implementer adds outside this folder

`'tests/acceptance/2307/'` in `scripts/lanes.mjs`'s `alone` list (the files build two cargo binaries), as #2309's and
#2243's are. Nothing in this folder changes.
