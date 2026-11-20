# Acceptance tests for #2240: a body's centre of mass as a field, held to a tall box on a slope and a hinged bar

Written first, blind, from issue #2240 as of November 18, 2026 (its Scope, five acceptance criteria, Proof line and
dependency; it has no comments), the design sections named below and base commit `9d0256132543`, by a job that never
saw an implementation; no other worktree, branch or pull request was read. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test per
criterion clause that needs its own run, plus one test per planted wrong program the criteria name.

## What was read

- The issue, as copied live on November 18, 2026: open, no comments.
- `docs/canvas-primitives.md`, three sections: Body `body@1` (`mass`, `inertia`, `anchors: {name → local point, m}`,
  and no field for where the weight is); Physics output (`read: pose`); Physics: behavior kit (a fixture's `{name,
  world, measure, answer, tolerance, caps}`, g = 9.81 m/s² at 120 Hz and 4 substeps, the result's fields, and "A fail
  names the backend, the fixture, the measure, the answer and the tolerance"). AGENTS.md.
- At the base, for surfaces only: the names these files import from `tests/acceptance/251/helpers.ts` (and through it
  #522's, #1918's, #2010's, #2009's and #191's), `191/helpers.ts`, `523/helpers.ts` and `2309/helpers.ts`;
  `tests/acceptance/2306/README.md`, the model for this one.
- `base-run.log`, this job's one run of the suite at the base.

What the base already does, which these tests don't credit: its reader refuses `centre_of_mass` on every body, of any
kind, as a field it doesn't know. `check` and `bake` answer an error issue of `document.validate`, code
`unknown_field`, at `bodies/<ID>/centre_of_mass`, whose sentence lists the body's fields (`base-run.log` prints it for
the dynamic box and bar). So criterion 3's four refusals "naming the field" already hold at the base, for another
reason. ac3 doesn't credit that: each refusal by kind stands beside two worlds the check must take, and the outside
point's refusal must name the box's bounds while (0, −0.75, 0) is taken. The base also runs every world that writes no
field as the criteria say: the box turns 0.002965° at most on the 20° slope and 90.26° on the 33° slope, the bar swings
at 1.6414 s, and 13 worlds give the merge base's step hashes (the merge base is the base). None of these is a test of
its own: each shares its test with a run that writes the field.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs build --wait 120 -- sh scripts/lease \
  npx vitest run --root tests/acceptance/2240 --testTimeout=3600000 --no-file-parallelism
npx tsc -p tests/acceptance/2240/tsconfig.json         # type-check
rm -rf tests/acceptance/2240/node_modules              # vitest's cache
```

These are #2306's commands for this folder; the vitest line is the one `base-run.log` records, less its
`--reporter=verbose`.

| File | Builds (each once per file) |
|---|---|
| `ac1` to `ac5` | `cargo build --locked --release -p deep-physics-rapier --bin deep-physics` (#191's `release`) |
| `ac5` also | the merge base's release build, exported by `git archive` into `target/acceptance-191-base/<sha>` and built there (#191's `mergeBasePhysics`, through #2309's `onBase`); its copy of the binary sits in `<tmp>/deep-2309-base-…` until the file ends |

Every test passes #191's 60-minute timeout (four times that for ac5's merge-base test). Node built-ins and vitest only;
`../251/helpers.ts` (and through it `../522`, `../1918`, `../2010`, `../2009`, `../191`), `../191/helpers.ts`,
`../523/helpers.ts` and `../2309/helpers.ts` are imported read only. This folder's files start no process themselves;
the helpers they import start `cargo`, `git`, `tar` and `deep-physics`. Nothing here depends on the machine or its
load: no test times anything, and the bar's period is counted in steps of the bake.

`BASE-FAILURE.txt` is `base-run.log` trimmed to each test's failing assertion: 14 tests, 14 failing. Every run that
writes `centre_of_mass` is refused as an unknown field; the kit holds none of the six fixtures; every twin fails because
the base knows none of the four planted names and exits 2.

## The surface under test

The issue drafts one name, the field `centre_of_mass` on a dynamic `body@1`, which the tests write as a local point of
three numbers in metres, `centre_of_mass: [0, -0.75, 0]`. Everything else they drive is `deep-physics` as #2009, #2010,
#1918, #522, #523, #191, #251 and #2309 left it (their READMEs' surfaces stand as written): `check` of a world document
(`{ok: true, issues: [{code, severity, path, actual, what, …}]}`); `bake` at `frame_rate: "120/1"`, where
`bodies.<ID>[k]` is the state after step k (`pos`, `rot` as a quaternion `[x, y, z, w]`), `outputs.series.<ID>[k]` an
output's sample and `step_hashes[k]` the step's hash; a hinge's `joint_coordinate` output read as #523 reads it; `seek`
from a store with `checkpoint: {every}`; `behavior_fixtures` and `behavior_kit`. **Every name below marked *(ours)* is
this job's invention**, the smallest the criteria need, named as the issue and the design name things; the implementer
builds exactly these, or a dispute goes to a blind redraft.

### Planted twins

Each is `deep-physics --planted <name>` on the release build (the base's way of starting a wrong program, as #251's
are), changing nothing but what its row says. Its process must exit 0 and answer every call, `behavior_fixtures` and
`behavior_kit` included, and the judge that passes the real program must fail on it, naming what the criterion says it
names. `twins.json` maps each criterion's ID to its twins; criterion 5 names none.

| Name | Criteria | The wrong program | Its failure must name |
|---|---|---|---|
| `centre_of_mass_ignored` *(ours)* | 1, 2 | the wrapper reads the field (its check takes it and its bake runs) and leaves the weight where the shapes put it | 1: the body and the angle it turned. The judge's failure reads `box: turned <angle>° on the 33° slope …`, and the box turns past 45° within 3 s. The kit's row for `box_slope_33_centre` reads `fail`; its text names the backend, the fixture and the fixture's one dynamic body by ID; its `body` *(ours)* is that ID; its `measured` is over 45. 2: the answer and what it read. The judge's failure reads `bar: … swings with a period of <read> s, not 1.865 s within 1%`, the period read 1.641 s within 1%. The kit's row for `bar_period_centre` reads `fail`; its text names the backend and the fixture; its `answer` prints as 1.865; its `measured` is 1.641 s within 1% |
| `centre_of_mass_parallel_axis` *(ours)* | 2 | the wrapper moves the weight to the written point and also adds a parallel-axis term to the shapes' inertia (on the bar, m × 0.25² about the written point) | 2, as above, with the period read and the row's `measured` 1.953 s within 1% |
| `check_accepts_centre_outside` *(ours)* | 3 | the check takes a point outside the bounds of the body's shapes: `check` of the box writing (0, 3, 0) lists no error issue, and a one-step `bake` of it holds `box` as built and after the step | the field: the judge's failure starts `bodies/box/centre_of_mass: ` |
| `pose_reads_centre_of_mass` *(ours)* | 4 | a `pose` output reads the body's centre of mass, not its origin: with the field written, at every step its position is 0.75 m lower than with none, within 1 mm, and no more than 1 mm aside | the output: the judge's failure starts `box_pose: ` |

### Fixture names in the behavior kit

Six names join `behavior_fixtures` and `behavior_kit`, once each: the box fixture's four runs and the two bars. The
reference backend's report (`BACKEND`; `rapier3d` in `base-run.log`) passes each, and each row's `answer` and
`tolerance` are the data's.

| Name | Answer | Tolerance | Its world, as the test reads it | Its row on the reference backend |
|---|---|---|---|---|
| `box_slope_20` *(ours)* | 0 | `{"deg": 1}` | the box standing 20° from the world's up, no `centre_of_mass` | `pass`, `measured` under 1 in size |
| `box_slope_33` *(ours)* | 45, the turn in degrees its box passes | not read | the box standing 33° from up, no `centre_of_mass` | `pass`, `measured` over 45 in size |
| `box_slope_33_centre` *(ours)* | 0 | `{"deg": 1}` | the box standing 33° from up, `centre_of_mass` exactly `[0, -0.75, 0]` | `pass`, `measured` under 1 in size |
| `box_slope_45_centre` *(ours)* | 0 | `{"deg": 1}` | the box standing 45° from up, `centre_of_mass` exactly `[0, -0.75, 0]` | `pass`, `measured` under 1 in size |
| `bar_period` *(ours)* | 1.641 as printed | `{"relative": 0.01}` | one dynamic body on a hinge to the world, no `centre_of_mass` | `pass`, `measured` within 1% of the worked 1.64107 s |
| `bar_period_centre` *(ours)* | 1.865 as printed | `{"relative": 0.01}` | one dynamic body on a hinge to the world, its `centre_of_mass` 0.75 m from the hinge's anchor on it, within 1e-9 m | `pass`, `measured` within 1% of the worked 1.8651 s |

"As printed" admits the exact value within half a unit of the last printed digit, as #191's and #251's suites read
answers. Every one of the six worlds is at the kit's g = 9.81 m/s² (in size), 120 Hz and 4 substeps, each written or
left to its default. A box world holds at least one static body and exactly one dynamic body: `mass` 100, one use of
one box shape whose `half` is 1 along its y and 0.5 along the slope's fall (its x or its z), `pose.rot` (a quaternion,
or degrees about X, Y and Z) standing it within 0.01° of the run's slope from the world's up, and friction 2 on every
shape use of the dynamic and the static bodies. A bar world's hinge is a joint of `kind: hinge` with the body at one end
and `world` at the other; its anchor on the body is the body's named anchor (`<ID>#<anchor>`), else the joint frame's
`anchor`. The IDs inside the kit's worlds are the implementer's.

### The refusals

- **The field's path** *(ours)*: a refusal is an issue of `severity: error` whose `path` is
  `bodies/<ID>/centre_of_mass`, with or without a leading `/`. It is the path the base's own `unknown_field` refusal
  writes.
- **By kind**: `centre_of_mass` on a static, a kinematic and a character body `box` is each refused at
  `bodies/box/centre_of_mass`. The same body with no field lists no error issue, and neither does a dynamic body of the
  same shape writing the same point.
- **The sentence of a point outside** *(ours)*: the refusal of (0, 3, 0) on `box` is an error issue at the field whose
  `what` writes the box's bounds as the four numbers −0.5, 0.5, −1 and 1 (the faces across x and y; those across z are
  at x's ±0.5). A minus sign is `-` or `−`; a hyphen straight after a digit joins two numbers and is no sign, so
  `-0.5-0.5` reads −0.5 and 0.5; `±0.5` reads 0.5 alone. Other numbers may stand in the sentence. The same box writing
  (0, −0.75, 0) lists no error issue.

### A body's `pose` output

`outputs: {box_pose: {from: "box", read: "pose"}}`. In a bake at `"120/1"`, `outputs.series.box_pose` holds one sample
for the built state and one per step, sample k the pose after step k. A sample is `{pos: [x, y, z], rot: [x, y, z, w]}`
or the same as seven numbers, `[x, y, z, qx, qy, qz, qw]` *(ours: the tests take either form)*. Only `pos` is compared.

### IDs

All *(ours)*, in the documents the tests send: bodies `box`, `ground` and `bar`; joint `pivot`; outputs `swing` and
`box_pose`; shapes `box`, `ground`, `bar` and `capsule`; contact materials `box` and `ground`; in the drawn worlds,
bodies `floor` and `body0` to `body5`, shapes `floor`, `brick`, `ball`, `pill` and `drum`, contact materials `light` and
`heavy`. The judges' failures name `box`, `bar` and `box_pose`.

## The fixtures

All at 120 Hz, 4 substeps, gravity (0, −9.81, 0), on #2009's `world` defaults. Every dynamic body that is baked has
`sleep: false`.

- **The box on a slope** (criteria 1 and 5; `standWorld`): the dynamic `box`, 100 kg declared, one box shape 1 m wide
  (x), 2 m tall (y) and 1 m deep (z), its origin at its middle. It stands on the static `ground`, a slab 20 × 1 × 10 m
  turned 20°, 33° or 45° about +Z, whose top face passes through the origin; the box is turned with it and its base
  rests on that face. Both shapes use a contact material of friction 2, restitution 0. With the field the box writes
  `centre_of_mass: [0, -0.75, 0]`, 0.25 m above its base. Baked 3 s (360 steps), reading `box`'s states. In ac5 the 45°
  world also writes `checkpoint: {every: 70}`.
- **The bar** (criteria 2 and 5; `barWorld`): the dynamic `bar`, 1 kg declared, one box shape 1 m long (y) and 0.04 m
  thick, hanging from the world by the hinge `pivot` about +Z at its top end, the bar's local (0, 0.5, 0), 2 m up. It is
  built turned 10° from hanging and at rest. Output `swing` reads the pivot's `joint_coordinate`. With the field the
  bar writes `centre_of_mass: [0, -0.25, 0]`, 0.75 m from the hinge. Baked 5 s (600 steps).
- **The level world** (criteria 3, 4 and 5): the box on the same slab turned 0°, its base on y = 0. ac4 adds the output
  `box_pose` and bakes 1 s (120 steps) with no field and with (0, −0.75, 0). ac3 asks `check` of it with `box` made
  static or kinematic (the box as written, only its kind changed) or a character body (one capsule, half height 0.5 m
  and radius 0.3 m, set 0.01 m over the ground, no mass declared), writing a point inside its shape: (0, −0.75, 0) in
  the box, (0, −0.25, 0) in the capsule.
- **The drawn worlds** (criterion 5; `drawnWorld`), from seeds 224001 to 224008 through #1918's mulberry32: a static
  floor 60 × 0.2 × 60 m with its top at y = 0, and three to six dynamic bodies dropped onto it from 1 m up and 1.2 m
  apart in height. Each has one shape or two (the second at an offset of up to 0.4 m and 90° on each axis), drawn from a
  brick, a ball, a capsule and a cylinder, each use of one of two contact materials (densities 300 and 2,500 kg/m³).
  Each is turned up to 90° on each axis and moving at up to 2 m/s and 180°/s on each, its mass declared (0.5 to 20 kg)
  or left to its shapes. Every number has two decimals. None writes `centre_of_mass`. Baked 2 s (240 steps).
- **#251's lap** (criterion 5; `lapWorld`, `LAP_TRACK`): a vehicle body driven for 1,200 steps, with no field.

## The tests

IDs are `scripts/proof-change.mjs`'s; each `describe` and `it` title starts with its criterion's ID.

| File | Test | What fails it |
|---|---|---|
| `ac1-box-on-slope` (1 `#2240.b395689a`) | turns | a world not baked; the box's greatest turn from its built orientation over steps 0 to 360 not under 1° (20° with no field, 33° and 45° with it) or not over 45° (33° with no field) |
| | kit | the report not the reference backend's; one of the four box fixtures not once in the data or the report; its data off the table above; its row not `pass`, its `measured` off the table, or its `answer` and `tolerance` not the data's |
| | twin: centre_of_mass_ignored | the twin passing; no failure reading `box: turned <angle>° on the 33° slope …`; its box not turning past 45°; under it `box_slope_33_centre` not once in the data and the report, its row not `fail` naming the backend, the fixture and the box, its `body` not the box's ID, or its `measured` not over 45 |
| `ac2-bar-period` (2 `#2240.07b0552b`) | periods | a bar not baked; its reading not falling twice through the middle of its swing in 5 s; its period not within 1% of the answer worked from the issue's formula (1.641 s with no field, 1.865 s with it) |
| | kit | the report not the reference backend's; `bar_period` or `bar_period_centre` not once in the data or the report; its data off the table above; its row not `pass`, its `measured` not within 1% of the worked answer, or its `answer` and `tolerance` not the data's |
| | twin: centre_of_mass_ignored | the twin passing; no failure reading `bar: … swings with a period of <read> s, not 1.865 s within 1%`; its period not 1.641 s within 1%; under it `bar_period_centre`'s row not once, not `fail` naming the backend and the fixture, its `answer` not printing as 1.865, or its `measured` not 1.641 s within 1% |
| | twin: centre_of_mass_parallel_axis | the same, with 1.953 s for 1.641 s |
| `ac3-refusals` (3 `#2240.cb44a798`) | kinds | for a static, a kinematic or a character body: no error issue at `bodies/box/centre_of_mass`; an error issue on the same body with no field; an error issue on a dynamic body of its shape writing the same point |
| | outside | (0, 3, 0) on the box with no error issue at the field, or none whose sentence writes −0.5, 0.5, −1 and 1; an error issue for (0, −0.75, 0) |
| | twin: check_accepts_centre_outside | the twin's check listing an error issue; its one-step bake refused or not holding `box`'s two states; the judge passing; no failure starting `bodies/box/centre_of_mass: ` |
| `ac4-pose-origin` (4 `#2240.c9639f9f`) | same | a world not baked; `box_pose` not 121 samples of either form; the box with no field more than 1 mm from where it was built at a step; the two positions more than 1 mm apart at a step |
| | twin: pose_reads_centre_of_mass | the twin passing; no failure starting `box_pose: `; at a step, the position with the field not 0.75 m under the one with none within 1 mm, or more than 1 mm aside |
| `ac5-seek-and-merge-base` (5 `#2240.e07f41f3`) | seek | the straight run refused or not 361 step hashes; the seek to step 180 not restoring the checkpoint at step 140, or not 221 hashes; a hash from step 140 to 360 differing from the straight run's; a step from 180 on whose hash the same world with no field shares |
| | merge base | a compared world writing the field; the merge base not building; a world's hashes here not one per step and one for the built state; a hash differing from the merge base's by position; the 33° world that writes the field refused, with another count of hashes, or with the same last hash as the one that doesn't |

Test count: 3 + 4 + 3 + 2 + 2 = 14.

## Readings where the issue leaves a choice

- **"1 m wide and 2 m tall"**: the box is 1 m deep too, its origin at its middle, and its width lies along the slope's
  fall. **"Both of friction 2"**: the box's contact material and the slope's, restitution 0. **"Stands on a static
  slope"**: built with its base on the slab's face, turned with the slab, at rest, sleep off.
- **"Turns less than 1° in 3 s"** and **"past 45° within 3 s"**: the turn is the angle between the box's orientation
  after a step and the one it was built with, read at every step from 0 to 360. The box that stands never reaches 1°;
  the box that topples passes 45° at some step.
- **"In a new fixture"** and **"gains the two fixtures"**: a kit fixture has one answer, so the box's four runs and the
  two bars are six names in the kit. A run that stands has the answer 0 within `{"deg": 1}`. The run that topples has
  the answer 45, the turn it passes; its tolerance is left to the implementer, and its row passes with a turn over 45.
- **"Naming the body and the angle it turned"**: in the judge's failure, `box` and the angle; in the kit's row, the
  body's ID in the row's `body` and in its text, and the angle as its `measured`.
- **The bar**: a box 0.04 m thick of 1 kg, its hinge 2 m up with nothing under it. **"Released from 10°"**: built
  turned 10° about the hinge's axis, at rest. **"0.75 m from the hinge along the bar"**: the local point (0, −0.25, 0),
  the hinge being at (0, 0.5, 0).
- **"Swings with a period of"**: the time between the first two times the hinge's `joint_coordinate` falls through the
  level midway between its highest and lowest values in a 5 s bake, each time interpolated between its two steps. The
  level is the reading's own, so the program's zero and sign for the coordinate are its own.
- **"Within 1%"**: of the answer worked from the issue's formula at full precision, which prints as the issue prints
  it. **"Reads 1.641 s"** and **"reads 1.953 s"**: within 1% of those. **"Naming the fixture, the answer and what it
  read"**: the kit's failing row for `bar_period_centre`, with its `answer` and its `measured`, and the judge's failure
  with 1.865 s and the period read.
- **"On a static body, on a kinematic body and on a character body"**: the 2 m box with only its kind changed, and for
  the character body one capsule with a point inside it. **"Refused at check, naming the field"**: an error issue whose
  `path` is the field's. Because the base refuses the field everywhere, each is held beside the two worlds the check
  takes.
- **"Naming the box's bounds"**: the refusal's sentence (`what`) writes the four numbers of the faces across x and y.
- **"Builds the body and fails"**: under the planted check, `check` lists no error and a one-step `bake` returns the
  box's states; "fails" is the refusal's judge failing on that check, naming the field.
- **"At rest on level ground"**: the box built with its base on the ground, baked 1 s; at rest means the pose with no
  field stays within 1 mm of where it was built. **"The same `pose` position … within 1 mm"**: at every one of the 121
  frames. **"0.75 m lower"**: at every frame, 0.75 m down within 1 mm and no more than 1 mm aside.
- **"The 45° world"**: criterion 1's box with the field on the 45° slope, a checkpoint every 70 steps. **"Sought to
  1.5 s and played on"**: `seek` to step 180 from a store of the 3 s bake, playing 180 steps more; the hashes compared
  run from the restored checkpoint at step 140 to step 360.
- **"Every world with no `centre_of_mass`"**: the 13 worlds this suite writes without it: the box on the 20° and 33°
  slopes and on level ground, the bar, #251's lap and the eight drawn worlds. **"Byte-identical to the merge base's"**:
  the same strings by position and the same count; the merge base is `git merge-base HEAD origin/main`, and both builds
  are release builds.

## Not tested, because no criterion reaches it here

`inertia` written beside `centre_of_mass` (#2098; a Scope line); a vehicle body that writes the field (a Scope line;
the lap writes none); a point outside the shapes of a body of several shapes, of another shape than the box, or on a
face; the tolerance of `box_slope_33`; the bar's length, mass and release angle in the kit's data, beyond its answer and
its period; a `pose` output while the body turns, and any other read of a body that writes the field; a seek to another
time, or of the bar; a second backend's rows for the six fixtures; a centre that moves during a run, a centre on a soft
body, spring shares that follow a moved centre and a rollover fixture (the issue's Not in this task).

## What the implementer adds outside this folder

`'tests/acceptance/2240/'` in `scripts/lanes.mjs`'s `alone` list, by the rule #2306's README gives for its own folder:
these files build the release binary and, in ac5, a whole second checkout's. This job didn't open `scripts/lanes.mjs`;
the instruction follows #2306's. Nothing in this folder changes.
