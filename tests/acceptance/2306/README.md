# Acceptance tests for #2306: a vehicle body's wheels push back on the dynamic body under them and are carried by a kinematic one

Written first, blind, from issue #2306 as of November 16, 2026 (its Scope, seven acceptance criteria, Proof line and
dependencies; it has no comments), the design sections it links and base commit `52aa05fd3` ("Merge pull request
#2729 …"), by a job that never saw an implementation; none existed, and no other worktree, branch or pull request was
read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding). Lean: one test per criterion clause that needs its own run, plus one test per planted wrong
program the criteria name.

## What was read

- The issue, live (`gh issue view 2306 --repo windoliver/deepbuild --comments`).
- `docs/technical-design.md`: The physics module (World; Shape, body; Character body; Vehicle body; Joint and force;
  Input, occurrence, output; Bake and golden; Behavior kit), Dogfooding, Tests written first. AGENTS.md.
- `docs/canvas-primitives.md`: World and backend `physics.world@1` (the step order, `caps()`, `drive_vehicle()`); Shape;
  Body `body@1` (`follow`), its character and vehicle siblings; Physics: behavior kit (its vehicle fixtures, its result).
- At the base, for surfaces only: `tests/acceptance/251/` (README, helpers, `twins.json`, `BASE-FAILURE.txt`,
  `DISPUTE.md`, its tests), `191/`, `2009/`, `2010/`, `1918/` (its channel-targets scene), `522/`, `523/` (helpers);
  `crates/deep-physics-rapier` (`main.rs`, `planted.rs`, `runner.rs`: `bake` of a world or of a scene's world, a body
  state's `contact_impulse`; `runner/kit.rs`'s test backends; `vehicle.rs`'s planted list; `scene.rs`; `joints.rs`'s
  hinge coordinate), `crates/deep-canvas-physics` (`backend.rs`'s `BodyState`, `doc.rs`'s pose, shape and joint fields,
  `doc/reads.rs`, `kit.rs`'s fixture and result), `crates/deep-canvas-motion/src/doc.rs` (a key's `t` in whole flicks);
  `scripts/proof-change.mjs` (criterion IDs), `scripts/proof-runs.mjs` (`twins.json`), `scripts/throttle.mjs`.

What the base already does, which these tests don't credit: #251's vehicle body on Rapier's ray-cast controller, whose
springs, drive and grip push the chassis alone; its brake holds a wheel against the velocity of whatever body its ray
meets; its rays meet dynamic bodies. A kinematic body follows a channel only inside a scene (#1918). The behavior kit has
#251's five vehicle fixtures and #251's test backend `no_vehicle_controller`.

What the base can't do, which criteria 2 and 5 need: a world holding a vehicle body and any dynamic body on a joint
panics in Rapier's island manager (`island_manager/manager.rs:141`, `rb.ids.active_island_id != u32::MAX`) before its
first step, wherever the vehicle is (`BASE-FAILURE.txt` lists the variants probed). An implementation runs the beam and
the disc, and its `controller_as_is` runs them too.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs build --wait 120 -- sh scripts/lease \
  npx vitest run --root tests/acceptance/2306 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/2306/tsconfig.json         # type-check
rm -rf tests/acceptance/2306/node_modules              # vitest's cache
```

| File | Builds (each once per file, copied out of the target folder) |
|---|---|
| `ac1` to `ac5` | `cargo build --locked --bin deep-physics` (#2009's helper) |
| `ac6` | `cargo build --locked --release -p deep-physics-rapier --bin deep-physics` (#191's `release`); the merge base's release build, exported by `git archive` into `target/acceptance-191-base/<sha>` and built there (#191's `mergeBasePhysics`) |
| `ac7` | #191's shipped and `test-backends` builds |

Every test passes #2009's 60-minute timeout (four times that for `ac6`). Node built-ins and vitest only;
`../251/helpers.ts` (and through it `../522`, `../1918`, `../2010`, `../2009`, `../191`, `../2012`, `../138`,
`../2009/api.ts`) and `../523/helpers.ts` are imported read only. No process is started but `cargo`, `git`, `tar` and
`deep-physics`, each waited for; none is stopped by name or port. **`scripts/lanes.mjs` needs
`'tests/acceptance/2306/'` in its `alone` list** (the files build four cargo binaries, one of them a whole second
checkout's); this README is the instruction, the implementer makes that edit. Nothing here depends on the machine or its
load: no test times anything.

`BASE-FAILURE.txt` is the run of the whole suite at the base, trimmed to each test's failing assertion. Three tests pass
there, as they should: ac4's free wheel (the base's free wheel already rolls) and both of ac6's (the merge base is the
base). ac1, ac3 and ac4's braked runs read the issue's wrong values (981 N, the slab at rest with 3,999.98 kg·m/s made,
the braked car 5 m from its place); ac2's and ac5's worlds panic at the base (above); every twin fails because the base
knows neither planted name; ac7 finds none of the four fixtures.

## The surface under test

The issue names no call, field or flag of its own. These tests drive `deep-physics` as #2009, #2010, #1918, #522, #523,
#191 and #251 left it (their READMEs' surfaces stand as written): `bake` of a world document, or of world `ride` of a
scene (#1918's `{"call": "bake", "scene", "world": "<ID>", …}`, a kinematic body's `follow` channel resolved in it);
`track` entries `brake` and `drive` (#251); `bodies.<ID>[k]` states, `pos`, `rot`, `linear`, `angular` (deg/s) and
`contact_impulse` (N·s over the step, #2009's), at `frame_rate: "120/1"` the state after step k; a hinge's
`joint_coordinate` output sampled as #523's readings; `step_hashes`; #191's `backend`, `behavior_fixtures` and
`behavior_kit`; #251's `--backend no_vehicle_controller` and its cap `vehicle_controller`. **Every name below marked
*(ours)* is this job's invention**, the smallest the criteria need, named as the issue and the design name things; the
implementer builds exactly these, or a dispute goes to a blind redraft.

### Planted twins

Each is `deep-physics --planted <name>` (the base's way of starting a wrong program, as #251's are), changing nothing
but what its row says; its process must exit 0 and answer, and the judge that passes the real program must fail on it,
naming what the criterion says it names. `twins.json` maps each criterion's ID to its twins.

| Name | Criteria | The wrong program | Its failure must name |
|---|---|---|---|
| `controller_as_is` *(ours)* | 1, 2, 3, 4 | the wrapper leaves the backend's vehicle controller as it is, as the base does (the issue's first paragraph): nothing returned to the body under a wheel, and no wheel's grip reading a kinematic body's speed | 1: the slab (`slab: …`), whose ground carries 981 N within 1% at every step of the fourth second; 2: the beam (`beam: …`), left within 0.1° of 0° at every step; 3: the slab and the momentum it made (`slab: … <sum> kg·m/s`), the slab under 2% of 4 m/s and the sum 4,000 kg·m/s within 2%; 4: the body (`kart: …`), the braked car 5.000 m from its place (within 0.0005 m) |
| `grip_reads_chassis_only` *(ours)* | 5 | each wheel's grip reads the chassis's velocity at its contact alone, whatever body it touches; all else as the real program | the body (`kart: …`), the car carried less than 10° around |

### Fixture names in the behavior kit

The four the criterion names join `behavior_fixtures` and `behavior_kit` once each, each with `caps` naming
`vehicle_controller` and a world holding a vehicle body (#251's names and rules):

| Name | Answer, as printed | Tolerance | Its world also holds |
|---|---|---|---|
| `vehicle_weight` *(ours)* | 10,791 (N), or the same times the step's length, 89.925 (N·s) | `{"relative": 0.01}` | a dynamic body under the vehicle |
| `vehicle_beam` *(ours)* | 15 (deg) | `{"deg": 0.1}` | a dynamic body and a hinge |
| `vehicle_slab` *(ours)* | 4.00 or −4.00 (m/s) | `{"relative": 0.02}` | a dynamic body under the vehicle |
| `vehicle_platform` *(ours)* | 0 (m, the car from its place on the platform) | `{"m": 0.02}` | a kinematic body under the vehicle |

An answer is read within half a unit of its last printed digit, as #191's and #251's suites read them. Rapier passes each
with its `measured` within its tolerance of its `answer`; on `no_vehicle_controller` each reads `excluded_by_caps`.

## The fixtures

All at 120 Hz, 4 substeps, gravity (0, −9.81, 0), on #2009's `world` defaults. **The car** is #251's `kart` (its
README: The car; `../251/helpers.ts`): 1,000 kg on four wheels at the corners of a 2.5 m wheelbase and a 1.6 m track, 2 Hz
springs with damping ratio 0.3, rest 0.3 m, travel 0.2 m, front wheels steering, rear wheels driving, all braking,
heading +Z, axle X. Here it always has `sleep: false`, and so does every dynamic body (a car that stands still or sleeps
is #2307's), and it is set down at its settled height (each spring 0.0621 m short) on whatever is under it. Body, joint,
output, world and channel IDs are *(ours)*.

- **The weight** (criterion 1): static ground, its top y = 0; on it the dynamic `slab`, 100 kg, 8 × 0.2 × 6 m (x × y ×
  z); the kart set down on the slab's middle. Baked 4 s.
- **The beam** (criterion 2): the dynamic `beam`, 200 kg, 10 m along z, 3 m wide and 0.2 m thick, its middle at y = 2 m
  hinged to the world about x by `pivot` (limits ±15°), nothing under it; output `tilt` reads the pivot's
  `joint_coordinate`. The kart, heading +Z, is set down on it with its centre at z = 2.5 m; a brake of 4,000 N is
  stamped at step 0. Baked 3 s.
- **The slab** (criterion 3): a static floor and on it the dynamic `slab`, 1,000 kg, 6 m wide (x), 0.2 m thick and 60 m
  long (z), both of contact material `ice` (friction 0); the kart set down on its middle. A drive of 2,000 N is stamped
  at step 120 (1 s, settled) and the bodies read at step 360, 2 s later.
- **The platform** (criterion 4): a scene whose world `ride` holds the kinematic `platform`, 20 × 0.2 × 20 m, its top at
  y = 0.2, following the scene's channel `deck` (`items/platform/at/pos`, a `mark.box@1`'s position), nothing under it;
  the kart set down on its middle. The channel's keys are linear, `t` in whole flicks: the **ramp** has a key at every
  step of the first second, its position along the axis t² m (rest to 2 m/s), and one at 3 s, 5 m on; **steady** goes
  from 0 to 6 m along x in 3 s. Braked runs stamp a brake of 4,000 N at step 0. Each run is baked 3 s.
- **The disc** (criterion 5): the dynamic `disc`, a cylinder of radius 8 m and 0.2 m thick, 20,000 kg, its centre hinged
  to the world about +Y by `axle`, whose velocity motor (target 30°/s, max torque 400,000 N·m, 10 Hz, damping ratio 1)
  turns it from rest; nothing under it. The kart is set down on it with its centre at (3, ·, 0), heading +X, away from
  the axis; a brake of 4,000 N is stamped at step 0. Baked 4 s.
- **The course** (criterion 6): #251's lap (`lapWorld`, `LAP_TRACK`: level static ground, four static posts, the kart
  driven, steered and braked for 1,200 steps) with a dynamic 1 m `crate` of 50 kg resting on the ground at (−80, ·,
  −80), off the course.

## The tests

IDs are `scripts/proof-change.mjs`'s; each `describe` and `it` title starts with its criterion's ID.

| File | Test | What fails it |
|---|---|---|
| `ac1-weight` (1 `#2306.9d2f70ed`) | weight | the slab's `contact_impulse` ÷ 1/120 s not 10,791 N within 1% at a step 361 to 480 |
| | twin: controller_as_is | the twin passing, its failure not naming `slab`, or its slab not carrying 981 N within 1% at every one of those steps |
| `ac2-beam` (2 `#2306.b6a098d0`) | beam | the pivot's reading not 15° in size within 0.1°, or the beam's +z end not below the pivot, at a step 60 to 360 |
| | twin: controller_as_is | the twin passing, its failure not naming `beam`, or the pivot reading more than 0.1° at a step |
| `ac3-slab` (3 `#2306.f80ef2cc`) | slab | at step 360 the car not at 4.00 m/s along its heading, the slab not at 4.00 m/s along −z, each within 2%, or their momenta not summing to 0 within 100 kg·m/s |
| | twin: controller_as_is | the twin passing; the slab moving 0.08 m/s or more; the sum not 4,000 kg·m/s within 2%; no failure naming `slab` and that sum |
| `ac4-platform` (4 `#2306.5f9f29ae`) | braked | the braked car more than 0.02 m from its place on the platform at step 360, after the ramp along x |
| | moving | the braked car, set down at 2 m/s along x on the steady platform, more than 0.02 m from its place at step 360 |
| | free | the platform not 5 m along z at step 360; the unbraked car more than 0.02 m from its start in the world at a step, on the ramp along z |
| | twin: controller_as_is | the twin passing, its failure not naming `kart`, or the braked car not 5.000 m from its place within 0.0005 m |
| `ac5-disc` (5 `#2306.61717c4c`) | disc | the disc not turning at 30°/s within 1% at step 480; the car's turn about the axis not within 3° of the disc's, or the car not 3 m from the axis within 0.15 m, at step 480 |
| | twin: grip_reads_chassis_only | the twin passing, its failure not naming `kart`, or the car carried 10° or more around |
| `ac6-static-ground` (6 `#2306.0821d427`) | hashes | the kart touching the crate; the course's 1,201 step hashes not the same strings on this checkout's release build as on the merge base's |
| | kit | `vehicle_sag`, `vehicle_brake`, `vehicle_drive` or `vehicle_turn` not once in either report, or reading another result or another `measured` (exactly) here than on the merge base |
| `ac7-behavior-kit` (7 `#2306.174ffd09`) | Rapier | Rapier's caps without `vehicle_controller`; a fixture of the four not once, off its answer or tolerance, not naming the cap, its world without a vehicle body or the body the table names; one not passing on Rapier within its tolerance |
| | excluded | `no_vehicle_controller` with the cap, refused, or any of the four reading other than `excluded_by_caps` |

Test count: 2 + 2 + 2 + 4 + 2 + 2 + 2 = 16.

## Readings where the issue leaves a choice

- **"Over the fourth second … within 1%"**: the slab's reading at every step from 361 to 480, each within 1%, not their
  mean. The slab is 8 m along x and 6 m along z, so the car's 2.5 m wheelbase lies along its 6 m.
- **The beam's shape**: the issue gives its length and mass; it runs along the car's heading, 3 m wide so the 1.6 m track
  sits on it, 0.2 m thick, its hinge 2 m up with nothing under it. **"15° toward the car"**: the reading's size is 15°
  within 0.1°, and the beam's own pose shows its end on the car's side below the pivot, so the program's sign
  convention for the coordinate is its own. **"By 0.5 s and at every step after"**: steps 60 to 360 of a 3 s bake.
- **"After it has settled"**: set down at the settled height and left 1 s, as #251's drive; "**the other way**": along −z;
  the momenta are the declared masses times the velocities along z.
- **The platform's motion** is a channel whose keys sample the ramp at every step, so its position at each step's time
  is exactly the issue's; "**its place on the platform**" is the car's horizontal offset from the platform's position
  against the same offset at step 0. **"Set down already moving"** is the same braked car with `velocity` 2 m/s along x.
  **"The platform moving along the car's heading"** is the same ramp along z, 5 m in 3 s, and "**stays**" holds at every
  step.
- **The disc**: 0.2 m thick; its motor turns it from rest with a torque that takes about 0.85 s to reach 30°/s, so the
  car isn't jerked past its grip, and the comparison is with the disc's own turn, whatever its spin-up. The car heads
  away from the axis, so its axle lies along the disc's turn and its grip alone carries it around, which is the twin's
  fault; its brake holds it against the pull outward. **"Has gone around the axis"**: the angle of the car's centre
  about +Y; **"the disc's own turn"**: the angle of the disc's local +X about +Y; both unwrapped step to step.
- **"Byte-identical to the merge base's"**: the merge base is `git merge-base HEAD origin/main` (at the base, `52aa05fd3`
  itself), both builds release builds so the comparison is of one profile; a world "whose vehicle bodies touch only
  static shapes" is #251's lap with a dynamic body the vehicle never touches. **"#251's sag, brake, drive and turn
  fixtures"** are the kit's four of #251's five; "**read what they read there**": the same result and the same measured
  value, exactly.
- **The twins' numbers** are the issue's probe of the base (981.0 N, 0°, 4,000 kg·m/s, 5.000 m), and the base is the
  program `controller_as_is` names, so the tolerances on them are the issue's printed digits; `BASE-FAILURE.txt` shows the
  base reading 981 N, 3,999.98 kg·m/s and 5 m. The beam's 0° and the disc's "less than 10°" are the issue's alone: the
  base panics on both worlds.

## Not tested, because no criterion reaches it here

The `force` occurrences under a loaded body (a Scope line); a wheel's own `contact_begin` and `contact_end` on a dynamic
body (#251's criterion, unchanged); collision groups on a wheel's ray; a static or kinematic body taking nothing (no
criterion reads a push on one); a vehicle on a soft body, pushing a character body, on a turning kinematic body, or
standing still on a slope or asleep (the issue's Not in this task).

## What the implementer adds outside this folder

`'tests/acceptance/2306/'` in `scripts/lanes.mjs`'s `alone` list. Nothing in this folder changes.
