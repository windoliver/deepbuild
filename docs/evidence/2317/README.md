# #2317 evidence: a body at rest on a turning body stays on it

Readings from this change's `deep-physics` (Rapier 0.36.1, macOS arm64, release build) against base `c7dc0edc3`. The
blind suite (`tests/acceptance/2317/`, 9 tests in 5 files) reads 9 of 9 on this change merged with main
(`678622403`): four files once each, and the budget's file once the Mac was at rest (below). At the base it read 8
failing at their own assertions and 1 passing, the straight platform, as its criterion says (`BASE-FAILURE.txt`).

## What the wrapper does now

Rapier keeps the contact points of two bodies, fixed in the world, while the two have moved less than
`solver.length_unit` ÷ 20 against each other, and never for a pair under a contact hook. The wrapper's one hook (#2241's,
for belts) is now active, carrying nothing, on:

- every shape use of a kinematic body, and of a dynamic body a hinge's motor turns, at every step;
- a dynamic body thinner than that distance, the one `physics.small_body` names of kind `unit`, for the one step after
  it has moved a twentieth of its own thinnest extent from where its contacts were last found. That place and that
  length ride in the body's `user_data`, which a checkpoint carries.

Every other pair keeps its points. No world field chooses any of it, and `caps()` declares it in one sentence.

The issue's Scope names the first rule alone. It doesn't meet the third criterion's edge: a static table's pair is
still reused, and the cube reads 5.23 sides. The second rule is what meets it. It was chosen over two others the probe
tried: with no pair of a static body reused, #2308's first planted wrapper stops failing (its cube drops at 1.35 sides
whatever the length); with a shorter reuse distance for the whole world, the stack of five 1 cm cubes that writes no
`length_unit` changes its step hashes, which #2308's sixth criterion holds to the merge base's.

## The planted wrappers, failing first

| `--planted` | What it reads | The judge's failure names |
|---|---|---|
| `wrapper_leaves_contact_reuse_on` | the box is 1.040, 1.210, 1.549, 1.970, 2.570 and 3.957 m from the axis at 1 s to 6 s | `box` and step 146, the first past 0.06 m of 1 m; the kit's `turntable` row fails with `body: "box"`, `step: 146`, 3.957 m against 1 m |
| `wrapper_leaves_contact_reuse_on` | the 1 cm cube has not dropped 0.5 mm until step 61, its centre 5.23 sides past the edge; the five 1 cm cubes still stand | `cube` |
| `wrapper_turns_contact_reuse_off` | the five 1 cm cubes fall, the top one 400.01% of a side below 4.5 sides; the cube at the edge still drops at 1.35 sides | `cube5` |

## The turntable

A dynamic disc of 20,000 kg and radius 30 m on a hinge about the vertical, its motor's target rising to its speed over
2 s and held 4 s; a 1 kg box of half extent 0.25 m set 1 m from the axis, both of friction 0.5; 120 Hz, 4 substeps.

| Speed | The box's distance from the axis at 1 s to 6 s, m | Around the axis | Bound |
|---|---|---|---|
| 90°/s | 1.001, 1.007, 1.017, 1.028, 1.038, 1.049 | 450.11° of the disc's 450.14° | within 0.06 m of 1 m at every step |
| 30°/s | 1.000, 1.001, 1.002, 1.003, 1.004, 1.005 | 150.04° of the disc's 150.05° | within 0.01 m of 1 m at every step |

What is left is what a step's straight move adds on a circle, r × (ω × step)² ÷ 2 a step. Two 0.5 m boxes stacked on
the disc at 90°/s end 1.049 m and 1.051 m from the axis (a probe; no criterion holds it).

## The straight platform

The box on a kinematic platform that reaches 2 m/s over 1 s and holds it 5 s is at most 0.1772 mm from its place on it
at any step, on this build and on the merge base's.

## What rested still rests

| World | Reading | Answer |
|---|---|---|
| five 1 m cubes at the default contact frequency | no cube faster than 0.0852 mm/s in the sixth second; the top ends 5.845 mm below 4.5 m | under 1 mm/s; 5.87 mm within 0.3 mm |
| five 1 m cubes at `contact_hz: 80` | 0.0629 mm/s | under 1 mm/s |
| ten 1 m cubes at the default, and at `contact_hz: 80` | 0.4015 mm/s, and 0.0887 mm/s | under 1 mm/s |
| a 1 cm cube of friction 0 at 0.886 m/s off a static table at `step_rate: 480`, nothing else written | dropped 0.5 mm at step 40, its centre 1.35 sides past the edge | before 1.6 sides |
| five 1 cm cubes at `step_rate: 480`, `contact_hz: 240`, `length_unit: 0.01` | the top ends 0.92% of a side low | within 2% of a side |

From eight starts along the table, 0.86 to 6.03 sides before the edge, the cube drops between 1.245 and 1.400 sides
past it, where the merge base reads 2.09 to 5.26 by where its contact was last found.

## The kit

`turntable` joins the behavior kit's data once, with `ramps: {"axle": {"to": 90, "steps": 240}}`, answer 1 m and
tolerance 0.06 m. Rapier 0.36.1 passes it natively and on wasm32, measuring 1.0491340920853967 m on both, the same as
the suite's own bake of that world in a scene whose channel rises as the ramp does.

## Step times before and after

`node scripts/physics-budget.mjs` with `"before"` naming the merge base's release build, on #1921's 800-body drop (400
boxes and 400 balls of 0.5 m on a static plane, 600 steps), five runs each, ms, on the reference Mac (Mac17,10) at
rest, under the machine's timed grant (`scripts/throttle.mjs timed`), on the tree merged with main:

| | p50 | p95 |
|---|---|---|
| before (the merge base `678622403`) | 0.153, 0.153, 0.148, 0.149, 0.146 | 0.317, 0.321, 0.318, 0.317, 0.321 |
| after | 0.148, 0.146, 0.144, 0.149, 0.140 | 0.326, 0.323, 0.320, 0.318, 0.318 |

Verdict `PASS`: every run is under the world's `budget.step_p95` of 2 ms. The world holds no kinematic body, no motor
and no body under 5 cm, so the change marks nothing in it and its step hashes are the merge base's: a pile at rest on
static ground pays nothing, and the two builds' times are within a run's spread of each other.

That was the fourth run of the file. The first three passed every check of the report and then read `INCONCLUSIVE:`
by the rule's own conditions, never by a time: thermal state "fair" and load 22 on 18 cores (p95 0.333 to 0.385 ms
after); load 102 while other sessions built (0.575 to 1.579 ms); load 22.3 at a run's end (0.318 to 0.327 ms). No run
of any of them was over 2 ms.

## Goldens and step hashes

No golden kept in the repository is recorded again. `docs/evidence/2010/golden-macos.json` and
`docs/evidence/2012/golden-macos.json` still match this build, 361 and 241 step hashes.

Of 96 worlds baked on the merge base's build and on this one (each of the kit's fixture worlds as a document, the two
goldens' worlds, and this issue's), 94 give the merge base's step hashes. The two that move are the ones the criteria
ask to move: the turntable's world, and the 1 cm cube at the edge at 480 Hz with no length written. The stacks of 1 m
cubes, the five 1 cm cubes with and without a `length_unit`, and #2308's edge at `length_unit: 0.01` are unchanged.

A world's step hashes change with this cause where a dynamic body touches a kinematic body or a dynamic body a hinge's
motor turns, and where a dynamic body thinner than `solver.length_unit` ÷ 20 slides. A golden recorded of such a world
on an earlier build is recorded again once, by the owner's decision.

Seeking equals playing for a body whose contacts are found by how far it has moved: the edge's world, with a
checkpoint every 7 steps, restored from each of its 17 checkpoints, steps on to the same hashes as the straight run.

## The suites beside it

Each file once, on the tree merged with main (`678622403`): 32 files, 84 tests, all passing. #2308's six files (15
tests), with `wrapper_ignores_length_unit` still reading 2.09 sides and the stack with no `length_unit` still giving the
merge base's step hashes; #2306's platform, disc, static ground and kit; #2309's stacks and kit; #2240's and #2241's
seek and merge base; #2241's level, turned and tilted belts; #1918's channel targets and rigid fixtures; #523's motor,
disc and kinematic solve; #2239's bats, turning bar and kit; #2307's platform; #182's push; #191's limits and sensor
matrix; #2310's and #2243's kit files. The touched crates' unit tests, clippy (the canvas lint's and plain) and the
touched files' fmt are clean on the same tree.

## Open

- `tests/acceptance/191/ac1-reference-kit.test.ts` and its two redrafts read 0 of 2 here, before the merge. Each names
  only fixtures the base already holds, #2308's five at 480 Hz and #1931's two at one substep, and never the
  turntable, which is at 120 Hz and 4 substeps and reads `pass` in all three. They were not run at the base.
- `tests/acceptance/2310/ac7-seek-golden-merge-base.test.ts`, before the merge, passed its seek, its planted
  checkpoint and its merge-base hashes; its Linux x86_64 leg builds in a container, which was stopped after eight
  minutes and not read. `scripts/affected.mjs` was not run: its selection is 315 test files in 80 folders.
- A dynamic body that turns with no motor on a hinge, one spun by a velocity or swung by its weight, still has its
  pairs' points kept, so what rests on it can slide. The Scope marks by kind; marking by speed toppled settling dice
  in the issue's probe.
- `crates/deep-physics-rapier/src/lib.rs` was 1,550 lines at the base, over the size ratchet's 1,500 with no ceiling;
  this change leaves it at 1,548.
