# Acceptance tests for #2248: a physics output's sampling, averaging and expr, and outputs to items and readouts for every read

Written first, blind, from issue #2248 as saved for this job on November 19, 2026 (its opening paragraph, Scope,
Fields, three acceptance criteria, Proof line and dependency; it has no comments and no Oracle line), the design's
physics sections and base commit `85203f458` ("Merge pull request #2852 …"), by a job that never saw an
implementation or a diff of one; no other worktree, branch, pull request or issue was read. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean:
one test per criterion clause that needs its own run, six in all. The criteria name no planted wrong program, so each
test's wrong program is the base, and there is no `twins.json`.

## Files, one per criterion

| File | Criterion | Tests |
|---|---|---|
| `ac1-sampled-series.test.ts` | `#2248.a0a41ad7`: the dropped ball's velocity with `sample: 12, average: 12` bakes one mean every 0.1 s, −9.360 m/s at 1 s within 0.1%; with `keep: 0.5 s` a series reading it holds only the samples of the last 0.5 s | 2 |
| `ac2-expr.test.ts` | `#2248.7a7a91ac`: `expr: "0.5 * m * v * v"` over the reads `v` and `m`, `unit: J`, reads ½ × 1 × 9.81² J at 1 s within 0.5%; an `expr` that names no read is refused at check, naming the output | 2 |
| `ac3-scene-dial-readout.test.ts` | `#2248.ac6cea78`: in a scene that lists a world, the hinge's `joint_coordinate` to `items/dial/at/rot/2` turns the dial as the motor turns its wheel, 45° at 0.5 s within 1%; a body's velocity writes its vertical part to a readout at every frame | 2 |
| `helpers.ts` | the worlds, the scene and the judges, over `../191/helpers.ts` and `../1918/helpers.ts` (imported read only) | |
| `BASE-FAILURE.txt` | each file run at the base | |

## What was read

- The issue as saved for this job (title, state and body); the criterion IDs are computed here from its body by
  `scripts/proof-change.mjs`'s rule.
- `docs/canvas-primitives.md`: Time and the flick; Units and axes; The path grammar; the word list's `scene` row; Text
  `text@1` (`template`); Bound value; Series and decimation `series@1` (a physics output as its source); Overlay (a
  readout; the slots an overlay reads from what names it); Channel and key; Driver; The closed function list; World
  and backend `physics.world@1`; Body `body@1`; Joint `joint@1`; Physics output; Checkpoint ring; Bake; Golden.
  `docs/technical-design.md`: The physics module (World; Input, occurrence, output; Bake and golden); Bound value and
  status binding; Camera and overlay; Criteria to tests; Wrong programs; Dogfooding; Tests written first. AGENTS.md
  and CONTRIBUTING.md.
- At the base, for surfaces only: `tests/acceptance/1918/` (README, helpers, `ac4`, its channel-targets scene),
  `2239/` and `2306/` (README, helpers, `BASE-FAILURE.txt`, a test), `2293/` (README, helpers, `ac1`,
  `BASE-FAILURE.txt`), `523/` (README), `182/` (how `ac6` read a readout's velocity), `397/` and `399/` (how a
  `series@1` is written), `1921/` (README: `eval`'s `paths` on columns), `504/`, `419/` and `1183/` (how a readout
  and an overlay's template are written and read), `2009/`, `2010/`, `191/` (helpers);
  `crates/deep-canvas-physics` (`doc/reads.rs`: an output's fields and their refusal; `doc.rs`: a motor's fields;
  `bake.rs`: `outputs`), `crates/deep-physics-rapier` (`runner.rs`: `check`, `bake`, `play`, an issue's fields;
  `channels.rs`: the channels a world's outputs write; `scene.rs`; `lib.rs`: a hinge's motor; `joints.rs`: a hinge's
  coordinate), `crates/deep-play` (`worlds.rs`: `inline`; `read.rs`: `eval`'s `paths`; `access.rs`: a readout's
  text), `crates/deep-show` (`physics.rs`, `frames.rs`: `eval`'s reply; `query.rs`: `deep_query`'s read of a
  template's text, and the form it reads; `access.rs`, and where `main.rs`, `logic.rs` and `played.rs` take a call
  and bake a scene's worlds), `crates/deep-canvas` (`template.rs`, `document/rules.rs`: a template's slots at
  check; `kinds.rs`: `series@1`'s params), `crates/deep-canvas-motion/src/eval.rs` (the values a readout shows),
  `crates/deep-canvas-scene3d/src/scene.rs` (a scene's readouts), `crates/deep-canvas-marks/src/data.rs` (a
  `series@1`'s columns); `scripts/proof-change.mjs` (criterion IDs), `scripts/proof-runs.mjs` (what counts as
  failing at an assertion), `scripts/studied-names.mjs` (run over these files: no finding), and the headers of
  `scripts/throttle.mjs`, `scripts/public-text.mjs` and `scripts/text-lint.mjs`.
- The pinned backend's own source, for one fact: `rapier3d` 0.36.1's `src/dynamics/joint/motor_model.rs` (how a
  velocity motor's damping softens it, so the scene's motor could be chosen stiff enough for the issue's 45°).

Nothing else was needed. One slip: while it waited for the build slot this job listed the names of the two files in
the build throttle's folder under the home directory; it opened neither, and nothing here comes from them.

What the base already does, which these tests don't credit: `deep-physics` checks and bakes a world document or a
scene's world, with outputs that write `from`, `read`, `to` and `interpolate`; a bake's `outputs.series.<ID>` holds
one value a frame of the call's `frame_rate`, `[x, y, z]` for `position` and `velocity` and a number for
`joint_coordinate`; `check` answers its refusals as error issues with a `path` and `ids`. The world reader refuses an
output's `reduce`, `average`, `sample`, `keep`, `expr` and `unit`, each at `outputs/<ID>/<field>` with
`physics.unsupported`, naming #2248. In a scene `deep-show` bakes each world into the scene: an output of `pose` or
`position` to an item's `at` or a vec3 path becomes channels on that path; any other read to an item path refuses the
world in its scene, naming #2248; a `to` that is no path draws nothing. `eval`'s `paths` read an item's evaluated `at`
and fields, and no text of a readout. By its source, an `overlay.text@1` readout fills its template's slots from the
document's data values.

## Run them

```sh
npm ci                          # once, if node_modules is missing
# the builds first, through the one build slot:
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs build --wait 240 -- nice -n 10 sh scripts/lease \
  cargo build --locked -j 6 --release -p deep-physics-rapier --bin deep-physics
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs build --wait 240 -- nice -n 10 sh scripts/lease \
  cargo build --locked -j 6 -p deep-show --bin deep-show
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/2248 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2248/tsconfig.json   # type-check
rm -rf tests/acceptance/2248/node_modules                                      # vitest's cache
```

| File | Builds (each asked of cargo once per file, found made and copied out of the target folder) |
|---|---|
| `ac1`, `ac2` | #191's `release`: `cargo build --locked --release -p deep-physics-rapier --bin deep-physics` |
| `ac3` | the same, and #1918's `full` `deep-show`: `cargo build --locked -p deep-show --bin deep-show` |

Every test passes #191's 60-minute timeout; the build hooks pass #191's 4 hours and #1918's 60 minutes, and each
`deep-show run` has #1918's 30 minutes. Node built-ins and vitest only; `../191/helpers.ts` and `../1918/helpers.ts`
(and through it `../2010` and `../2009`) are imported read only. No process is started but `cargo`, `deep-physics`
and `deep-show`, each waited for; none is stopped by name or port. Evidence stores and copied binaries are temporary
and deleted. No test times anything, so none depends on the machine or its load. No cargo on the machine is
`BLOCKED:`, and a check whose reply lists no issues is `INCONCLUSIVE:`; each is a failure, never a pass.
**`scripts/lanes.mjs` needs `'tests/acceptance/2248/'` in its `alone` list** (the files build cargo binaries); this
README is the instruction, the implementer makes that edit.

## The surface under test

The issue names the output's fields (`sample`, `average`, `keep`, `expr`, `unit`, `to`), the reads, a series, a
readout and an item path, and no call, reply field or flag. These tests drive `deep-physics` and `deep-show run` as
#191, #523 and #1918 left them and add the least the criteria need. Each name is marked: *(issue)* the issue's word,
*(design)* the design's, *(base)* what the base's suites already drive, **bold** and *(ours)* this job's choice,
which the implementer builds as written, or a dispute goes to a blind redraft.

### Calls

| Call | Reply |
|---|---|
| `{"call": "check", "world": World}` *(base)* | `{"ok": true, "issues": [Issue]}` |
| `{"call": "bake", "world": World, "steps": 120}`, with `"frame_rate": "120/1"` for criterion 2 *(base)* | `{"ok": true, "bodies": {ID: [state]}, "outputs": {"series": {ID: …}, …}, …}`, or a refusal `{"ok": false, "issues": [Issue]}` |
| `{"call": "bake", "scene": Scene, "world": "rig", "steps": 120, "frame_rate": "60/1"}` *(base)* | the same, for a world its scene lists |
| `deep-show run` on one scenario *(base, #1918)*: `{"call": "deep_show", "session", "doc", "document": Scene, "include": ["issues"]}`, then `{"call": "eval", "doc", "t": 11760000 × f, "paths": [path]}` for each frame f, 0 to 60 | `{"outcome": "presented", …}`, then per frame `{"outcome": "evaluated", "values": {path: value}}` |

No call, flag, cargo feature or planted name is new.

### The output's fields in a world document

```text
outputs: {
  "fall": {"from": "ball", "read": "velocity", "sample": 12, "average": 12}                    criterion 1
  "fall": {"from": "ball", "read": "velocity", "sample": 12, "average": 12, "keep": "0.5s"}    criterion 1, kept
  "ke":   {"expr": "0.5 * m * v * v", "unit": "J",                                             criterion 2
           "reads": {"v": {"from": "ball", "read": "speed"}, "m": {"from": "ball", "read": "mass"}}}
  "turn": {"from": "hinge", "read": "joint_coordinate", "to": "items/dial/at/rot/2"}           criterion 3
  "fall": {"from": "ball", "read": "velocity", "to": "vy"}                                     criterion 3
}
```

- `sample: 12` and `average: 12` *(issue)*: whole numbers of steps, written as the issue writes them.
- `keep: "0.5s"` *(issue's `keep: 0.5 s`)*: a duration as documents write time (Time and the flick: `"1.25s"`).
- `expr` *(issue)*: the issue's text, `"0.5 * m * v * v"`, in the closed function list's arithmetic. `unit: "J"`
  *(issue)*.
- **`reads`** *(ours as a field; the issue says "over the reads `v` … and `m`", the design "over named reads")*: a
  map from each name the `expr` uses to the read it names, each written as an output writes one, `{from, read}`. An
  output with an `expr` writes no `from` or `read` of its own.
- **`read: "speed"`** and **`read: "mass"`** *(ours as names; the issue says "the ball's speed" and "its mass")*,
  inside `reads`: the length of the body's linear velocity, m/s, and the body's mass, kg. The design's `read` list
  has neither, and the issue's `expr` needs both as numbers. Whether an output's own `read` takes them isn't asserted.
- `to: "items/dial/at/rot/2"` *(issue)*: an item path, here one number of the item's rotation, degrees about z
  (Units and axes).
- `to: "vy"` *(base's form: a `to` that is no path names a readout by its ID)*: the scene's readout item `vy`.

### Series: a bake's `outputs.series`

`outputs.series.<ID>` *(base)* is where each physics suite reads an output's values, and "the dropped ball's sampled
and averaged series" (the issue's Proof line) is read there.

- **An output that writes `sample` has rows** *(ours)*: `outputs.series.<ID>` is a list of rows
  **`{"t": flicks, "v": value}`**, one a sample, in time order, such as `{"t": 705600000, "v": [0, -9.3604, 0]}`.
  `t` and `v` are the design's names for a series' time and value columns (Series and decimation). `t` is the time
  of the step the sample ends at, a whole number of flicks (step k of a 120 Hz world is k × 5,880,000). `v` is the
  read's value as the base writes it in a series, `[x, y, z]` for `velocity`; the tests read its vertical part, `v[1]`.
- The samples are at every `sample`th step from the first: steps 12, 24 … 120 of a 120-step bake. There is no row at
  step 0, where no 12 steps end.
- With `average: 12` each row's `v` is the mean of the read after each of the 12 steps that end at the row's step.
- With `keep`, the reply's rows are those a series reading the output at the bake's last step holds: the samples of
  the last `keep` before that step. A bake of 120 steps holds the rows of 0.6 s to 1 s, and one of 96 steps those of
  0.4 s to 0.8 s. The row exactly `keep` before the last step may be there or not. Without `keep` the rows are every
  sample of the bake. What the bake's store keeps is the implementer's.
- An output that writes no `sample` keeps the base's series, one value a frame of the call's `frame_rate`. **An
  output with an `expr` writes one number a frame** *(ours)*, as a `joint_coordinate` does: at `"frame_rate":
  "120/1"`, `outputs.series.ke[k]` is the `expr`'s value over its reads after step k, the built state's at 0, so 121
  numbers for 120 steps.

### An output's `expr` at check

- The world whose output `ke` has the `expr` and the `reads` it names checks with no error issue.
- The same output without `reads` *(the `expr` names no read: it has none to name)* is refused: an error issue that
  names the output, by a `path` that is `outputs/ke` or a field of it, or by `ids` holding `ke` *(base: how a
  refusal names what it refuses)*. Its code and sentence are the implementer's.

### The scene, the item path and the readout

- `to: "items/dial/at/rot/2"`: in the scene that lists the world, `eval`'s `paths` *(base)* read
  `items/dial/at/rot/2` as a number, the hinge's `joint_coordinate` at the frame's time, in degrees. The dial's item
  writes `at: {pos, rot: [0, 0, 0]}`.
- **The readout** *(ours as a form; the design says `to: item path | readout`, and gives an overlay `role: readout`
  and a `template`)*: an item of the scene under the ID `vy`, which the output's `to` names:
  `{"kind": "overlay.text@1", "params": {"anchor": "corner", "role": "readout", "template": "{value/1}"}}`, as #419's
  suite writes a readout.
- **The slot `{value}`** *(ours)*: in a readout an output's `to` names, the slot `{value}` reads the value that
  output writes at the frame, and **`{value/1}`** its part 1, as a path's list index reads one (The path grammar): for
  a `velocity`, `[x, y, z]`, the vertical part. This follows the design's rule for the overlay an `exaggerate`
  names, whose slots `{factor}` and `{shown_at}` read that exaggeration's.
- **`eval`'s `paths` read `items/vy/params/text`** *(ours for `eval`; `deep_query` reads a template's text at this
  path since #504, though by its source from a form no world is baked into, which wasn't run here)*: the text the
  readout shows at the frame, its template with each slot filled. The tests read the one number in that text, so `"-4.905"` and `"-4.905 m/s"` both read
  −4.905; a text with no number, with more than one or with a slot left unfilled reads nothing.

## The worlds and the scene

All at 120 Hz and 4 substeps, gravity (0, −9.81, 0), one contact material of friction 0.5, restitution 0 and density
1,000 kg/m³. Body, joint, output, world and item IDs other than `ball`, `hinge` and `dial` are *(ours)*.

- **The dropped ball** (criteria 1 and 2): `ball`, a dynamic sphere of radius 0.1 m and `mass: 1`, built at rest 10 m
  up with nothing under it. After step j it falls at −9.81 × j ÷ 120 m/s. Baked 120 steps, 1 s (and 96 steps, 0.8 s,
  for `keep`).
- **The scene** (criterion 3): a scene document of 1 s at 60 frames a second, so frame f sits on step 2f and no
  frame is between two steps. Its world `rig` holds `wheel`, a 1 kg plate with `gravity_scale: 0` on the hinge
  `hinge` to the world about +z, whose velocity motor has `target: 90` (deg/s), `max_torque: 1000`, `hz: 60` and
  `damping_ratio: 1`; and `ball`, the dropped ball, 3 m aside and 8 m up. Its outputs are `turn` and `fall`, as
  above. Its items are a camera, `dial`, a painted box whose `at` writes `rot: [0, 0, 0]`, and the readout `vy`.
  The dial's test presents this scene. The readout's test presents it without the output `turn`: at the base that
  output refuses the whole world, and the test is to fail there for the readout's own clause.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s; each `describe` and test title starts with its criterion's ID. A judge returns
what is wrong as sentences, and each test asserts in its own file that there are none.

| File | Test | What fails it |
|---|---|---|
| `ac1` | sampled and averaged | the bake refused; `outputs.series.fall` not a list of rows `{t, v: [x, y, z]}`; the rows not at exactly the steps 12, 24 … 120; a row's vertical part not −9.81 × (k − 5.5) ÷ 120 within 0.1% at its step k; the last row not −9.360 m/s within 0.1% |
| | `keep` | any of the three bakes refused or not rows; the series without `keep` not holding all ten samples; with `keep: "0.5s"`, read at 1 s, a sample of 0.6 s to 1 s missing, or a row that is none of them (the one at 0.5 s is allowed); the same read at 0.8 s for 0.4 s to 0.8 s (0.3 s allowed); a kept row whose vertical part isn't its sample's mean |
| `ac2` | energy | the bake refused; `outputs.series.ke` not 121 numbers at a frame a step; its value at 1 s not ½ × 1 × 9.81² = 48.118 J within 0.5%; its value after any step not ½ × 1 × the ball's speed² (from the same bake's body states) within 0.5% |
| | refusal | either world not checked; any error issue for the `expr` over its reads `v` and `m`; no error issue naming the output `ke` for the same `expr` on an output with no reads |
| `ac3` | dial | the scene's world not baked by `deep-physics`, or its hinge not at 45° within 1% at 0.5 s there; the scene not presented; `items/dial/at/rot/2` at 0.5 s not 45 within 1%; at any frame not within 0.001° of the hinge's coordinate in the bake |
| | readout | the scene not presented; at any frame `items/vy/params/text` not a text holding one number within 0.001 m/s of −9.81 × t |

Test count: 2 + 2 + 2 = 6. Every one fails at the base, at an assertion in its own file (`BASE-FAILURE.txt`).

Not vacuous: criterion 1's `keep` test first requires that the series without `keep` holds the samples from before
the last half second, and reads `keep` at two times, so a series that only drops the first half second fails it.
Criterion 2's refusal stands beside the same `expr` taken with its reads, so a reader that refuses every `expr`, as
the base does, fails it. Criterion 2's value is held to the ball's own speed at every step, so one number that is
right at 1 s fails it. Criterion 3's dial is held to the wheel only after the wheel is shown to turn 45° in the bake,
and its readout runs from 0 to −9.81 m/s over the frames.

## Readings where the issue leaves a choice

- **The surface.** A world's own behaviour (criteria 1 and 2) is read on `deep-physics`'s `bake` and `check`, as
  every physics suite reads it; a scene's (criterion 3) on `deep-show run` with `eval`'s `paths`, as #1918's and
  #2293's suites read a world's output in its scene. No new call.
- **"Bakes one value every 0.1 s"** is the output's series in the bake's reply, `outputs.series.fall`, as rows with
  their times, so that "every 0.1 s" and "at 1 s" are read from the rows and not from an index. Ten rows in 1 s: the
  first at 0.1 s, since each is "the mean … over the 12 steps that end at it" and none end at step 0.
- **"The ball's vertical velocity"** and **"its vertical part"**: the y part of the velocity `[x, y, z]` (Units and
  axes: +Y up), `v[1]` of a row and the slot `{value/1}` of the readout. The output itself stays a `velocity`; what
  reads it names the part.
- **"Each the mean … over the 12 steps that end at it"** is held for all ten rows by the closed form the issue gives
  for the last, −9.81 × (k − 5.5) ÷ 120 at step k, within the issue's 0.1%.
- **"With `keep: 0.5 s` a series reading it holds only the samples of the last 0.5 s"**: "a series reading it" is
  read as the output's series in a bake's reply, the reply being the run read at its last step. A `series@1` item
  that takes the output as its `source` isn't drawn here: the criterion names no item, scene or picture for it, and
  at the base a `series@1` is a chart's item that writes its own columns. **"The last 0.5 s"** is counted back from
  the time read (1 s and 0.8 s). The sample exactly 0.5 s back is on the edge: five samples each cover 0.1 s, so the
  plain count is five, but the issue doesn't say which side the edge falls, so that row is neither required nor
  refused.
- **"Over the reads `v` (the ball's speed) and `m` (its mass)"**: named in a `reads` map on the output, each as
  `{from, read}`, with `speed` and `mass` as read names there (The surface). The driver's `vars` are the design's
  model: an expression names its variables and each is bound outside it (The path grammar).
- **"Reads the ball's kinetic energy at 1 s"**: the output's value in the bake at the frame that sits on step 120,
  and, so that it is the energy and not a number, ½ × 1 × speed² of the ball's own state after every step.
  **`unit: J`** is written and taken; nothing reads it back.
- **"An `expr` that names no read"**: the issue's `expr` on an output that declares no reads. Both ways of reading
  the phrase refuse it: the `expr` names no read (there is none), and its names `m` and `v` are no reads. An `expr`
  of constants beside declared reads, and an `expr` that names one read and one stranger, are not asserted.
  **"Refused at check, naming the output"**: `check` answers an error issue whose `path` or `ids` name `ke`; the
  same `expr` with its reads raises none.
- **"Turns the scene's dial as a hinge motor at 90°/s turns its wheel"**: at every frame the dial's rotation about z
  is the hinge's coordinate at that frame's step, read from the same scene's world baked by `deep-physics`, within
  0.001°. **"45° at 0.5 s within 1%"** is asserted of the dial, and first of the wheel in the bake. The motor's
  other fields are chosen so a right program reaches it (Readings at the base).
- **"Writes its vertical part to a readout at every frame"**: at each of the scene's 61 frames the readout's text
  shows the ball's vertical velocity at that frame's time, −9.81 × t m/s, within 0.001 m/s, which admits a text
  rounded to three decimals and no step's lag (0.08 m/s). The issue gives no bound for this clause.
- **Which scene each of criterion 3's tests presents**: the dial's, the scene with both outputs; the readout's, the
  same without `turn` (The worlds and the scene).

## Readings at the base

Where the base stands, not expected values (`BASE-FAILURE.txt` has the runs; the probes were not kept):

- The dropped ball with a plain `{from: ball, read: velocity}` output, baked 120 steps at a frame a step: after step
  k it falls at −9.81 × k ÷ 120 m/s within 0.00004 m/s (−9.81002 at step 120); the mean of steps 109 to 120 is
  −9.36040 m/s, and ½ × 1 × its speed² at 1 s is 48.1182 J.
- Criterion 1's output is refused at `outputs/fall/average` and `outputs/fall/sample`, and with `keep` at
  `outputs/fall/keep`, each `physics.unsupported` naming #2248; `bake` answers `ok: false` with them.
- Criterion 2's output is refused by `unknown_field` at `outputs/ke/reads`, `physics.unsupported` at
  `outputs/ke/expr` and `outputs/ke/unit`, and `physics.missing_field` at `outputs/ke/read`; without `reads`, by the
  last three. Each names `ke`, so at the base the output without reads is refused "naming the output" for reasons
  that refuse the output with its reads too, and the refusal's test fails there on the output that should be taken.
- The scene's world baked by `deep-physics`, which doesn't read an output's `to`: the hinge's coordinate is 1.381°
  after one frame, 44.881° at 0.5 s and 89.881° at 1 s, and the wheel turns at 90.0000°/s by 0.5 s. By the backend's
  motor model a velocity motor closes its gap to the target by dt × c ÷ (1 + dt × c) a substep, c = 4π × `hz`:
  at 60 Hz that works out to 0.12° behind 90°/s × t, which is what the run shows and is inside the issue's 1%;
  #1918's 10 Hz works out to 0.72° behind, outside it, and wasn't run.
- In `deep-show` the scene with `turn` is refused: `physics_refused` at `worlds/rig`, its `actual`
  `{"code": "physics.unsupported", "path": "outputs/turn/to", "what": "an output's to with read joint_coordinate
  isn't drawn by this host yet; #2248 brings it"}`. Without `turn` it is presented, and `items/vy/params/text` reads
  null at every frame, while `items/vy/params/template` reads `"{value/1}"`. With no outputs it is presented and
  `items/dial/at/rot/2` reads 0.
- The base's own way to a scene's item, the wheel's `pose` to `items/dial/at`, puts the dial's rotation about z
  within 0.00002° of the hinge's coordinate in the bake at every frame: the 0.001° bound and the reading of frame f
  as step 2f hold on outputs the base already writes.

## Not asserted, because no criterion says so

`reduce: sum | mean | max` and a `from` that names several addresses or pins; a `to` for `angle`, `contact_count`,
`energy` and `joint_force`, and a `velocity` to an item path; `sample` without `average`, `average` without
`sample`, and either with a `to`; `keep` on an output a scene writes; a `series@1` item that takes an output as its
`source`, its rows and its picture; what the bake's store keeps of a kept series, and `outputs.frames`, `frame_rate`
and `hash` with rows; the row exactly `keep` back; a row's x and z; `speed` and `mass` as an output's own `read`; a
vec3 inside an `expr`, any function of the closed list beyond `*`, and an `expr` with a `to`; what `unit` does
beyond being taken, and a readout showing it; the refusal's code and sentence; the slot `{value}` whole, a readout
two outputs write, a readout's text between two steps and `interpolate` on it; the readout's text in the scene that
also writes the dial; the dial's other two rotations and its position; the bake key; 2D worlds; the web player.

## What the implementer adds outside this folder

The output's `sample`, `average`, `keep`, `expr`, `unit` and `reads` in the world reader and the bake, with the
rows; a world's outputs written to item paths for every read and to readouts in its scene, with the slot `{value}`
and `eval`'s read of a readout's text, in `deep-canvas-physics`, `deep-physics-rapier`, `deep-play` and `deep-show`;
`'tests/acceptance/2248/'` in `scripts/lanes.mjs`'s `alone` list. Nothing in this folder changes.
