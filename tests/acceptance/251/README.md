# Acceptance tests for #251: a vehicle body, a chassis on ray-cast wheels moved by the backend's own vehicle controller

Written first, blind, from issue #251 as of November 15, 2026 (its Scope, Fields, ten acceptance criteria, Proof line,
Oracle line and its one comment), its Oracle page (`doneright/oracles/issues/251.md` in DeepBuildAI/deepbuild, branch
`doneright`: no upstream test checks any criterion), the design sections it links and base commit `1ab891283` ("Merge
pull request #2597 …"), by a job that never saw an implementation; none existed, and no other worktree, branch or pull
request was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft
of this job (design: Dogfooding). Lean: one test per criterion clause that needs its own run, plus one test per planted
wrong program the criteria name.

## What was read

- The issue, live (`gh issue view 251 --repo windoliver/deepbuild --comments`), and its Oracle page.
- `docs/technical-design.md`: The physics module (World; Shape, body; Character body; Vehicle body; Joint and force;
  Soft body and checkpoint ring), Scenes, physics and the canvas core, Dogfooding, Tests written first. AGENTS.md.
- `docs/canvas-primitives.md`: World and backend `physics.world@1` (the step order, caps(), `drive_vehicle()`); Body
  `body@1`, its character and vehicle siblings; Input track entries; Occurrence list; Physics output (a `place` holds
  outputs at the new pose); Checkpoint ring; Bake; Golden; Physics: behavior kit (its vehicle fixtures); Logic `logic@1`
  (`fires`).
- At the base, for surfaces only: `tests/acceptance/2009/`, `2010/`, `1918/`, `522/`, `523/`, `524/`, `191/`, `2012/`,
  `531/` to `533/`, `138/` (READMEs, helpers, `twins.json`, `BASE-FAILURE.txt`, a test each); `crates/deep-physics-rapier`
  (`runner.rs`: `bake`, `restore`, `golden`, `time`, the planted list; `runner/kit.rs`'s test backends; `main.rs`;
  `planted.rs`; `Cargo.toml`'s features), `crates/deep-canvas-physics` (`backend.rs`, `caps.rs`, `check.rs`, `doc.rs`'s
  body kinds, `doc/inputs.rs`, `doc/reads.rs`, `kit.rs`, `bake.rs`, `golden.rs`), `crates/deep-show/src/physics.rs` and
  `physics/kit.rs`, `crates/deep-show/src/kit/carried.rs`, `crates/deep-gpu-layer/src/physics.rs`, `crates/deep-logic`'s
  refusal of `fires`; `scripts/proof-change.mjs` (criterion IDs), `scripts/proof-runs.mjs` (`twins.json`).

What the base already does, which these tests don't credit: `deep-physics` checks, bakes (with `read`, `checkpoints`,
`track`, outputs at a frame rate), restores, records and verifies goldens, times steps (`time`), runs the behavior kit
(`backend`, `behavior_fixtures`, `behavior_kit`, `--backend` in the `test-backends` build) and takes `--planted`; deep-show
runs #138's kit with the physics module's late-joint fixture. Its body reader refuses `kind: vehicle` with
`physics.unsupported` ("#251 brings it"), its input reader refuses `drive`, `steer` and `brake` (and has no `place`), its
caps claim no vehicle controller, and the backend interface has no `drive_vehicle`. The logic module refuses a logic
item's `fires` ("isn't built yet").

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs build --wait 120 -- sh scripts/lease \
  npx vitest run --root tests/acceptance/251 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/251/tsconfig.json          # type-check
rm -rf tests/acceptance/251/node_modules               # vitest's cache
```

| File | Builds (each once per file, copied out of the target folder) |
|---|---|
| `ac1`, `ac2`, `ac3`, `ac4`, `ac9` | `cargo build --locked --bin deep-physics` (#2009's helper) |
| `ac5` | the same; `cargo build --locked -p deep-show --bin deep-show` (#522's helper, the full set), after the course checks |
| `ac6` | the same; `-p deep-physics-rapier --bin deep-physics --features test-backends` (#191's); rustdoc JSON of `deep-canvas-physics` and `deep-physics-rapier`, and of the latter with `test-leaks-rapier` (#2009's), into `target/acceptance-251-doc` |
| `ac7` | #191's shipped and `test-backends` builds |
| `ac8` | #191's release build; on a reference Mac fit to judge, the merge base's release build (#191's `mergeBasePhysics`) |
| `ac10` | `deep-physics`; on macOS, after the scenes' worlds bake, `cargo build --locked --bin deep-gpu` (#524's helper) |

`ac5`'s golden test builds deep-physics in #2012's linux/amd64 lane image (Docker, the pinned image, `--pull never`)
only after the golden is recorded here. Every test passes #2009's 60-minute timeout (four times that for `ac8` and
`ac10`, the golden test #2012's 3 hours). Node built-ins and vitest only; `../522/helpers.ts` (and through it `../1918`,
`../2010`, `../2009`), `../191/helpers.ts`, `../2012/helpers.ts`, `../138/helpers.ts`, `../524/helpers.ts` and
`../2009/api.ts` are imported read only. No process is started but `cargo`, `git`, `tar`, `docker`, `deep-physics`,
`deep-show` and `deep-gpu`, each waited for; none is stopped by name or port. **`scripts/lanes.mjs` needs
`'tests/acceptance/251/'` in its `alone` list** (the files build several cargo binaries, run Docker and time steps);
this README is the instruction, the implementer makes that edit.

Gates. No cargo is `BLOCKED:` (#2009's helper), a failed test, never a pass. The golden test is `BLOCKED:` off an arm64
Mac, without Docker or without the lane's pinned linux/amd64 image (#2012's `referenceMac`, `laneImage`). `ac8`'s
timings are judged only where #191's `gate` finds a reference Mac (Mac15,7 or Mac15,12) on mains power, Low Power Mode
off, thermal state nominal, its 1-minute load under its core count; otherwise each test runs its structural part and
then skips as `INCONCLUSIVE`, never a pass (#191's `settle` turns a mixed reading into the same skip). `ac10` is
`INCONCLUSIVE:` off macOS and without your recorded taste call. Nothing else depends on the machine or its load.

`BASE-FAILURE.txt` is the run at the base of the files that need only the base's deep-physics (ac1 to ac4 and ac9),
trimmed to each test's failing assertion, and why ac5 to ac8 and ac10 weren't run there.

## The surface under test

The issue names the vehicle body's fields, its inputs, outputs on `<body>#<wheel>`, contact occurrences naming the body
and the wheel, its state in checkpoints and hashes, caps(), the behavior kit, `deep_kinds`, `place` and planted
programs, but no call. These tests drive `deep-physics` as #2009, #2010, #1918, #522 and #191 left it (their READMEs'
surfaces stand as written). **Every field, reply field, flag, name and shape below marked *(ours)* is this job's
invention**, the smallest the criteria need, named as the issue and the design name things; the implementer builds
exactly these, or a dispute goes to a blind redraft.

### The world document

- **A vehicle body** is the issue's Fields as written: `{"kind": "vehicle", "shapes": [shape use], "pose", "mass",
  "vehicle": {"wheels": {name → {"at": [x, y, z], "radius", "suspension": {"rest", "travel", "hz", "damping_ratio"},
  "grip"?, "steers"?, "drives"?, "brakes"?}}, "steer_max"?}}`, plus body@1's other fields (`velocity`, `sleep`, …).
  Each wheel's ray points down the chassis's −Y, its axle along X, its heading along +Z.
- **Inputs** (#522's `inputs: {ID → {"kind", "targets", "on"?}}` and `track: [{"step", "kind", "target", "data"}]`):
  `drive {"force": N}`, `steer {"angle": deg}`, `brake {"force": N}`, `place {"pose": {"pos", "rot"}}`, and #2009's
  `launch {"from", "linear", "angular"}` on a vehicle body. An entry stamped k applies in the step from the state after
  k steps to the state after k + 1 (#522's step convention).
- **Outputs on a wheel**: `{"from": "<body>#<wheel>", "read": "pose" | "contact_count"}`, sampled as #2010's and #523's
  outputs are (`outputs.series.<output ID>[k]` the reading after step k at `frame_rate: "120/1"`). A `pose` sample is
  *(ours)* `{"pos": [x, y, z], "rot": [x, y, z, w]}` (the base's quaternion order; seven numbers in that order are read
  the same): the hub at its suspension's length, turned by its steer and its spin, so its local X is its axle. A
  `contact_count` sample is a number, 0 or 1.

### Replies this suite reads

- **`vehicles`** *(ours)*: `bake` and `restore` replies gain `"vehicles": {ID: [VehicleState]}` beside `bodies`, for each
  vehicle body `read` names (every one when `read` is absent, none for `read: []`), index j the state after j steps from
  the reply's first, as `bodies`. `VehicleState = {"wheels": [{"name", "spin": deg, "spin_rate": deg, "touching": bool}],
  "drive": N, "steer": deg, "brake": N}`, the issue's State field with each wheel's name; `wheels` may also be an object
  keyed by wheel name.
- **Rows** (#1918's `{"step", "kind", "a", "b", …}`): a wheel's `contact_begin` or `contact_end` names the body and the
  wheel *(ours: where)*, by a field `"wheel": "<name>"` beside the body as `a`, `b` or `body`, or by an ID
  `"<body>#<wheel>"` as `a` or `b`. Sleep and wake are the base's `rest` and `wake` rows, `a` the body.
- **Refusals** are the base's check issues `{code, severity: "error", ids, path, actual, what}`: a refusal names the body
  by `ids` holding it or a `path` under `bodies/<body>`, and the field by its `path` (README: The tests, ac6).
- **The cap** *(ours)*: a backend's `backend` reply lists `"vehicle_controller"` in its `caps` when it has a vehicle
  controller (#191's cap names, beside `character_controller`); Rapier's do.

### Test backend and kit

- **`--backend no_vehicle_controller`** *(ours)*, in the `test-backends` build: Rapier with `vehicle_controller` left out
  of its caps(), and like #191's other test backends a candidate without `soft_bodies`, so the kit admits it.
- **Fixture names** *(ours)* in `behavior_fixtures` and `behavior_kit`: `vehicle_sag` (answer 0.0621 m, `{"relative":
  0.02}`), `vehicle_brake` (12.5 m, `{"relative": 0.03}`), `vehicle_drive` (4.00 m/s, `{"relative": 0.02}`),
  `vehicle_turn` (9.330 m, `{"relative": 0.03}`), `vehicle_contacts` (0.4515 s, `{"steps": 1}`), each with `caps`
  naming `vehicle_controller` and a world holding a vehicle body. An answer is read within half a unit of its last
  printed digit, as #191's suite reads them.
- **A refused kit report** *(ours: where)*: the kit refuses a report that counts a fixture its backend's caps exclude
  as passed: `behavior_kit` answers `ok: false`, or a `verdict` other than `pass`, and names the fixture outside its
  `results`.
- **The course in the conformance kit** *(ours)*: the physics module registers a kit fixture of the lap course,
  **`parity/physics/vehicle-lap.<profile>`**, whose sidecar declares the lap's entries; #138's `carried_state` and
  `late_entry` parts run it as they run #522's late-joint fixture.
- **`view3d`'s `tracks`** *(ours)*: `{"call": "view3d", …, "tracks": {"<world ID>": [Entry]}}`, the input track of each
  world the document lists, entries as `deep-physics`'s `track`, so a scene's world is baked with its inputs.

### Planted twins

Each is `deep-physics --planted <name>` (the base's way of starting a wrong program), changing nothing but what its row
says; its process must exit 0 and answer, and the judge that passes the real program must fail on it, naming what the
criterion says it names. `twins.json` maps each criterion's ID to its twins.

| Name | Criterion | The wrong program |
|---|---|---|
| `spring_on_whole_mass` | 1 | each spring sized on the whole chassis mass, k = m × (2π × hz)², so it settles a quarter as far (0.0155 m) |
| `brake_whole_force_each_wheel` | 2 | each braking wheel given the whole brake force, not its share (stops in 3.125 m) |
| `steer_clamps_angle` | 3 | the steer angle itself clamped to steer_max, not the inside wheel (inside 42.06° at steer 50°) |
| `steer_parallel` | 3 | both steering wheels turned by the steer angle (15° and 15°) |
| `contact_names_body_only` | 4 | a wheel's contact rows name the body and not the wheel |
| `checkpoint_drops_steer` | 5 | a checkpoint leaves out the steer a vehicle holds; a restore holds 0 |
| `check_counts_wheels_only` | 6 | the vehicle body's check refuses only a ninth wheel: not a 2D world, not a follow channel |
| `kit_counts_excluded_passed` | 7 | the kit's report counts a fixture its backend's caps exclude as passed (run with `--backend no_vehicle_controller`) |
| `place_keeps_spin_rate` | 9 | `place` keeps each wheel's spin rate |
| `place_keeps_angular_velocity` | 9 | `place` keeps the chassis's angular velocity |

## The fixtures

All at 120 Hz, 4 substeps, gravity (0, −9.81, 0), on #2009's `world` defaults, on a static floor whose top is y = 0.

- **The car** (`helpers.ts`): the vehicle body `kart`, 1,000 kg (`mass`), a box chassis of half extents 0.8 × 0.15 ×
  1.5 m centred on its origin; wheels `fl` (+0.8, −0.15, +1.25), `fr` (−0.8, −0.15, +1.25), `rl` (+0.8, −0.15, −1.25),
  `rr` (−0.8, −0.15, −1.25): a 2.5 m wheelbase and a 1.6 m track centred under the centre of mass; each radius 0.3 m,
  suspension rest 0.3 m, travel 0.2 m, 2 Hz, damping ratio 0.3; front wheels `steers`, rear `drives`, all braking (the
  default), `steer_max` 35°. Heading +Z, so a positive steer turns left, toward +X: the inside front wheel is `fl`. It
  sits with every spring at rest length with its centre 0.75 m up, and settled 0.0621 m lower.
- **Sag**: set down at rest at 0.75 m, sleep off, read after 3 s. A spring's length is from its mount, placed by the
  chassis's pose, to its hub (the wheel's pose), along the chassis's +Y.
- **Drive**: settled, sleep off, a drive of 2,000 N stamped at 1 s, read 2 s later along the heading. **From sleep**:
  sleep on, settled 3 s (its last rest-or-wake row by then is `rest`), a drive of −2,000 N stamped at step 360, its
  `wake` row on step 361, read 2 s later. **Brake**: settled, sleep off, at 10 m/s with drive 2,000 N and brake 4,000 N
  both stamped at step 0, baked 5 s; the stop is the farthest its centre reaches.
- **Turn**: settled, sleep off, rolling at 3 m/s, a steer stamped at step 0. Each front wheel's turn is the signed
  angle from its side's rear wheel's axle to its own, from the same step's poses (rear wheels never steer), at every
  step 1 to 240. The circle is a least-squares fit to the chassis's local point (0, −0.15, −1.25) on the ground plane
  from step 0 until its heading has turned 360°, within 30 s.
- **Contacts**: dropped at rest with each ray's end 1 m above the floor (centre 1.75 m up), sleep off, 1 s. **The
  edge**: settled on a deck 3 m above the floor whose end is 2 m ahead of its centre, rolling at 4 m/s, 2.5 s.
- **The lap** (criteria 5, 9, 10): level ground and four posts at (±90, ±90); the kart settled at the origin, sleep
  off; its drive, steer and brake declared `on: {"logic": "driver"}`, and `place` and `launch` declared; the 1,200
  steps of entries: drive 1,500 N at 0, steer 20° at 180, 0° at 420, −15° at 540, 0° and brake 3,000 N at 720, brake
  0 and drive 2,500 N at 780, steer 25° at 900, drive 0, steer 0 and brake 2,000 N at 1,080.
- **The place** (criterion 9): the lap's entries before step 840; drive, steer and brake 0 at 840; at 860 a `launch`
  from (6, 0.16, 6) rolled 180° about Z (on its roof, 1 cm over the floor), turning 360 deg/s about +Y; at 900 `place`
  at the last gate, (−20, 0.77, 20) turned 90° about +Y: upright, each wheel at rest length 2 cm above the floor.
  Baked 1,260 steps.
- **The level** (criterion 8): 500 static boxes, 4 m tiles in a 25 × 20 grid; 8 cars settled in a row at z = −30 rolling
  at 5 m/s, sleep off; or 8 dynamic boxes of the chassis's size; or nothing.

## The tests

IDs are `scripts/proof-change.mjs`'s; each `describe` and `it` title starts with its criterion's ID.

| File | Test | What fails it |
|---|---|---|
| `ac1-sag` (1 `#251.1571a36a`) | sag | a wheel's spring not 0.0621 m short within 2% at 3 s |
| | twin: spring_on_whole_mass | the twin passing it, its failure not naming a wheel, or its sag not 0.0155 m within 5% |
| `ac2-drive-and-brake` (2 `#251.acf8ab9a`) | drive | not at rest at the drive's stamp; not 4.00 m/s within 2% 2 s later |
| | from sleep | no `rest` row before the stamp, no `wake` on step 361, not −4.00 m/s within 2% 2 s later |
| | brake | its stop not 12.5 m within 3%; still moving at 5 s; coming back more than 1 cm after stopping |
| | twin: brake_whole_force_each_wheel | the twin passing it, its failure not naming `kart`, or its stop not 3.125 m within 5% |
| `ac3-turn` (3 `#251.d72490eb`) | steer 15° | `fl` not 16.33°, `fr` not 13.86°, each within 0.01°, at a step 1 to 240; no full turn in 30 s; the fitted radius not 9.330 m within 3% |
| | steer 50° | `fl` not 35.00°, `fr` not 25.80°, each within 0.01° |
| | twin: steer_clamps_angle | the twin passing, or its failure not naming `fl` at 42.06° |
| | twin: steer_parallel | the twin passing, or its failure not naming a front wheel at 15.00° |
| `ac4-contacts` (4 `#251.0d1641fc`) | drop | a wheel with no contact_begin naming `kart` and it, or its first not at 0.4515 s within one step; the list not in #1918's sorted order, or one step's rows of a pair out of wheel-name order |
| | edge | a wheel with no contact_end; a front wheel's first contact_end not on an earlier step than each rear wheel's |
| | twin: contact_names_body_only | the twin passing, or its failure not naming `contact_begin` |
| `ac5-lap` (5 `#251.eadd341f`) | seek | from a checkpoint (60 … 1,140) a restore's step hash or state not the straight run's at a step to 1,200, or its checkpoints' deep hashes not the straight run's |
| | golden | not recorded on macOS; the linux/amd64 replay not PASS, `machines: different`, step for step equal |
| | twin: checkpoint_drops_steer | the twin passing, or its first failure not naming a step and the field `steer` |
| | kit | the course refused; no `carried_state` or `late_entry` case on `parity/physics/vehicle-lap.*`; such a case or the part not PASS |
| `ac6-refusals` (6 `#251.2e102906`) | fields | the car refused; the 2D world, the follow channel or the ninth wheel not refused by an error naming `kart` and `bodies/kart/kind` or `dimensions`, `bodies/kart/follow`, `bodies/kart/vehicle/wheels…` |
| | caps | Rapier's caps without `vehicle_controller`; `no_vehicle_controller`'s with it; no error naming `kart` and the backend there |
| | api | a public item of either crate naming a Rapier type; no public `drive_vehicle`; the scan missing #2009's planted leak |
| | twin: check_counts_wheels_only | the twin passing, its failure not naming `dimensions`, or it not refusing the ninth wheel |
| `ac7-behavior-kit` (7 `#251.9fb00bb4`) | Rapier | Rapier's caps without `vehicle_controller`; a fixture not once, off its answer or tolerance, not naming the cap or holding no vehicle; one not passing on Rapier within its tolerance |
| | excluded | `no_vehicle_controller` with the cap, refused, or any of the five reading other than `excluded_by_caps` |
| | twin: kit_counts_excluded_passed | its report not counting them passed, the report not refused, or the refusal naming no vehicle fixture |
| `ac8-budgets` (8 `#251.25f1d712`) | vehicles | the level with vehicles refused; judged: 8 vehicles adding 1 ms or more to a step |
| | no vehicle | the levels refused; judged: the level with 8 boxes slower than the merge base's median + 5% |
| `ac9-place` (9 `#251.a96ef62b`) | place | after the place's step: moving faster than one step of gravity, turning, off the gate, not upright, a spring not at rest length or a hub on the floor, a wheel's spin_rate not 0; a wheel's contact_count not 1 by step 960; a spring not 0.0621 m short within 2% at step 1,260 |
| | seek | the restore from the checkpoint at 840 not giving the straight run's step hashes 840 to 1,200 |
| | twin: place_keeps_spin_rate | the twin passing, or its failure not naming a wheel's spin_rate |
| | twin: place_keeps_angular_velocity | the twin passing, or its failure not naming `kart`'s angular velocity |
| `ac10-taste` (10 `#251.74b37407`) | taste | a scene's world refused; a frame not drawn; no recorded call on these files (INCONCLUSIVE); `looks_wrong` |

Test count: 2 + 4 + 4 + 3 + 4 + 4 + 3 + 2 + 4 + 1 = 31.

## Readings where the issue leaves a choice

- **The surface.** `deep-physics` carries every criterion a world document shows, as #2009's to #524's suites do;
  #191's builds the kit and test backend; deep-show's `kit` the conformance kit's parts; deep-gpu's `view3d` the
  renderer's own frames. No new call is invented: the vehicle's own state rides on `bake` and `restore` (`vehicles`).
- **"From a logic item"** (criterion 5). The base's logic module refuses `fires`, and the design gives no layout for a
  fired input's data in a program's regions. The physics module reads a logic item's fired inputs only as derived
  entries on the input track and never names the logic module (Input track entries), so this suite declares the lap's
  inputs `on: {"logic": "driver"}` and gives the entries the item fires as the track a bake keeps (#522: a kept entry
  replays through `deep-physics` whatever its `on`). A logic program firing them is not driven here (README: Not tested).
- **"Settled"** is set down at the settled height (each spring 0.0621 m short), so nothing bounces at the stamp. Sleep
  is off wherever a reading could land on a sleeping chassis, and on only for "from rest and asleep".
- **"With that drive still held"**: drive 2,000 N and brake 4,000 N stamped on the same step, so the drive is held for
  the whole brake. **"Stops it 12.5 m on"** is the farthest its centre reaches; **"never rolls backwards"**: never more
  than 1 cm back from it.
- **A wheel's "pose turns"** is read against the same side's rear wheel's pose of the same step, never against the
  chassis's state, so it can't be a step's yaw (0.15° at 3 m/s on this circle) apart; the issue's printed angles are the
  answers, with its 0.01°.
- **"The middle of the rear axle"** is the chassis's local point midway between the rear mounts; **"over one turn"** is
  from the steer's step until the heading has turned 360°.
- **"In the bake's sorted order"** is #1918's order of the list, and rows of one step, kind and pair in wheel-name order
  (the canonical order of a vehicle's wheels, by name).
- **"The same full-state hash at every checkpoint"** is each restore's own checkpoints' `deep_hash` equal to the straight
  run's at the same steps. **"Naming the first step and that field"**: the judge names the first step at which a seek's
  step hash or state differs, and there the first differing field of the kart's own state, then of its body; under the
  twin that is `steer`.
- **A refusal "naming the field"** (criterion 6): its `path`; for the 2D world `bodies/kart/kind` or `dimensions`, with
  the body named, since the caps already refuse any 2D world on rapier3d naming no body, which doesn't count. **"Naming
  the body and the backend"**: `kart` in `ids` or the path, and the backend's name, as its `backend` reply gives it,
  anywhere in the issue. **"Passes the 2D world"** under the planted check: no error names the vehicle body in it.
- **"The physics crate's public items"**: both physics crates', `deep-canvas-physics` (the interface) and
  `deep-physics-rapier` (the backend), scanned as #2009 scans them; `drive_vehicle` must be among the interface's items,
  so the scan reaches the vehicle's interface.
- **"Is refused, naming the fixture"** (criterion 7) is the kit's own rule, so the refusal is `behavior_kit`'s reply.
- **"Rolled onto its roof at step 900"** is a recorded `launch` from an upside-down pose at 860, turning, so at step 900 it
  lies on its roof still turning with its wheels spinning in the air, and both planted places are caught. **"Its wheels
  at rest length above the floor"**: 2 cm above. **"Reads 0 m/s on the next step"**: after the place's own step, the
  speed one step of gravity gives (g ÷ 120) and no more; **"contact on all four wheels within 0.5 s"**: each wheel's
  `contact_count` reads 1 by step 960. **"The checkpoint before step 900"** is the ring's at 840.
- **Budgets**: "add under 1 ms of CPU to a step" is the level with the 8 vehicles less the level alone, each the mean
  over 600 steps of the base's `time` call; "gains no work per step" is #191's reading, the level with 8 plain bodies no slower
  than on the merge base's build (median + 5%). "The local preflight" is this suite run on the reference Mac.
- **The taste call** follows #524's: files kept in `DEEPBUILD_EVIDENCE_DIR` (else `deep-251-taste` in the temporary
  folder), their paths printed; your call in a file named by **`DEEPBUILD_TASTE_251`**: `{"criterion": "#251.74b37407",
  "by": "you", "screenshots": [sha256 × 3], "recordings": [sha256], "call": "looks_right" | "looks_wrong"}`.

## Not tested, because no criterion reaches it here

A logic program firing the lap's entries (the logic module's `fires`, refused at the base; a follow-up for whoever
builds it); `deep_kinds` listing the vehicle body (a Scope line no criterion names); `grip` limits beyond the turn; a
`place` writing `contact_end` for wheels that touched (no wheel touches on its roof); a vehicle with more than one
steering pair or axle; vehicles on wasm32; the behavior kit's vehicle fixtures on other targets than this Mac.

## What the implementer adds outside this folder

`'tests/acceptance/251/'` in `scripts/lanes.mjs`'s `alone` list. Nothing in this folder changes.
