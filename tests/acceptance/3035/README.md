# Acceptance tests for #3035: a robot description converts in

Written first, blind, from issue #3035 as saved for the job on November 21, 2026 (its opening paragraph, Runs on
line, Scope, six acceptance criteria, Proof line and dependency; it has no comments, no Fields section and no Oracle
line), the design sections it links and those they lean on, and base commit `c7dc0edc3`
(`c7dc0edc3690706adb84d678806301c3d14456ca`), by a job that never saw an implementation, a diff of one, or any other
worktree, branch, stash or pull request. None existed. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test per criterion, one more
where a clause needs its own run, plus the three planted programs the criteria name.

## Files, one per criterion

| File | Criterion | Tests |
|---|---|---|
| `ac1-arm.test.ts` | `#3035.e8200294`: the two-link arm's hinges in degrees and its tip at 30° and 30°; the planted conversion that flips one joint's axis | 2 |
| `ac2-axes.test.ts` | `#3035.b3b50392`: the link 1 m up the file's Z at y = 1 m, the 2 kg link's mass and inertia; the planted conversion that copies poses as written | 2 |
| `ac3-sweep.test.ts` | `#3035.2a1744e4`: each joint swept between its limits, its anchors together, the prismatic joint's 0.2 m | 1 |
| `ac4-dropped.test.ts` | `#3035.0abd59c7`: `dropped` holds exactly the mimic joint, the transmission and the sensor; the planted job that drops one silently | 2 |
| `ac5-refusals.test.ts` | `#3035.a4b3d8f2`: the macro refused naming its element with nothing written; the mesh path refused naming the path | 2 |
| `ac6-same-bytes.test.ts` | `#3035.36c146dd`: the same bytes from two conversions that both ran; a rerun that is a cache hit and starts no process | 2 |
| `helpers.ts` | the hub, the runs, the physics runner, the placements and the judges, over `../1922/helpers.ts` and `../191/helpers.ts` (imported read only) | |
| `model.ts` | the fixtures' numbers as their files write them and every expected value in closed form, with wrong twins | |
| `fixtures/*.urdf` | the six files the tests convert | |
| `fixtures/planted/` | the three planted programs: what each makes wrong (`spoil.mjs`), the planted tool's entry and its plug-in | |
| `twins.json`, `lane.json` | each criterion's ID to its planted names; the folder runs alone | |
| `BASE-FAILURE.txt` | the suite run once at the base | |

## What was read

- The issue as saved for the job (title, state and body), and its body alone for the criterion IDs, each worked as
  `scripts/proof-change.mjs`'s `criterionId` works it and found equal to the ID its tests carry. The job read no
  issue tracker, so #1984 (the mesh convert-in job this issue depends on), #439 and #1730 are known here only through
  what this issue and the design say of them.
- `docs/canvas-primitives.md`: Units and axes; Document envelope; Item and kind; ID and sub-address; Patch; World and
  backend `physics.world@1`; Shape; Body `body@1`; Joint `joint@1` and its swing, twist and pose motor; Occurrence
  list; Physics output; Bake; Kinematic solve; Asset: meshes; Asset: licences through jobs; Asset job (fields and
  Semantics: the key, a cache hit, qualification, the inbound convert); Asset job: Lottie import; Asset job: imports.
  `docs/technical-design.md`: the Extension API (`deep.registerJob`, `deep.registerJobTool`); the Job row; the slot
  table's row for `deep.registerJobTool` (the kind's qualification; its planted wrong fill); Criteria to tests;
  Criteria in a checked shape; Wrong programs; Dogfooding; Built to be hard to get wrong. AGENTS.md, CONTRIBUTING.md.
- At the base, for surfaces only: the suites `162/` (README, `helpers.ts`'s `importWorld`, `importLottie`, `stored`),
  `1922/` (README, helpers, fixtures, `upper`, `tools`, `pinned` and `key` tests), `2310/` (all of it, the model for
  this one), `523/` (helpers, ac3, ac6), `191/` (helpers), `1255/` (how a model's values and its wrong twin sit in a
  test); `packages/jobs/import` (README, `index.ts`, `deepbuild.json`, `tool/lottie.mjs`) and `packages/jobs/README.md`;
  `packages/hub/src/jobs.ts` and `plant.ts`; `packages/extension-host/src/jobs.ts`, `job-kinds.ts`, `digest.ts`,
  `index.ts`; `packages/supervisor/src/seatbelt.ts` (what a tool's sandbox lets it start);
  `crates/deep-canvas-physics` (README, `doc.rs`'s body and joint readers, `doc/centre.rs`, `doc/dims.rs`,
  `doc/reads.rs`, `bake.rs`) and `crates/deep-physics-rapier` (README, `lib.rs` where joints and bodies are built,
  `articulated.rs`, `kinematic.rs`, `joints.rs`, `scene.rs`, `bound.rs`, `runner.rs`'s `check` and `bake`);
  `scripts/proof-change.mjs`, `scripts/proof-runs.mjs` (`twins.json`), `scripts/lanes.mjs` (`lane.json`),
  `scripts/studied-names.mjs`, `scripts/throttle.mjs`, `scripts/lease`.
- Nothing outside those inputs was read.

## What the base already does

These tests don't credit any of it to the work (`BASE-FAILURE.txt` has the runs).

- Nothing at the base reads a robot description: no crate, package, script or design sentence names the format. The
  kind `import` has one tool, `lottie-import@1.0.0`, and its params take `from: lottie` alone, so deep_job lists no
  tool whose name starts `urdf` and every test here fails there for that.
- The physics module already runs an arm written by hand in our units. The world `model.ts` writes for each fixture
  under −90° about X (bodies with `pose`, `mass`, `inertia`, `centre_of_mass` and a shape; `joint@1` hinges, a slider
  and fixed joints with `frame_a`, `frame_b`, `limits` and `articulated: true`) is accepted by `deep-physics`'s
  `check` and placed by its kinematic solve, and this suite's measures read it right: the hand-written arm's tip
  with both joints at 30°, each joint's turn alone, the lift's sweep and its 0.2 m. Each test first proves its
  measure on that hand-written world, and on a wrong twin of it that must fail, and only then judges the conversion.
  That part passes at the base and is no part of the work.
- The job API (#1922) and the import plug-in (#162): a hub installs `packages/jobs/import`, deep_job lists the kind,
  a run returns outputs by hash with a receipt (`cache: miss | hit`, `key`), a rerun is a hit that starts no process,
  and a second plug-in's tool joins a kind once it passes the kind's qualification, or is refused at install. A tool
  runs as `node <entry>` in its own folder with `{params, inputs}` on stdin and `{outputs}` on stdout, base64, in a
  sandbox that lets it start a program of its own folder; the planted entry here, around the Lottie tool, gives the
  Lottie tool's bytes.

## Run them

```sh
npm ci                                              # once, if node_modules is missing
npm run build --workspaces                          # the hub runs packages/cli/dist/main.js
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH" CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
sh scripts/lease cargo build --locked -j 6 -p deep-hook                                   # the hub won't start without it
sh scripts/lease cargo build --locked -j 6 -p deep-physics-rapier --bin deep-physics      # #191's `shipped` build
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3035 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/3035/tsconfig.json               # type-check
rm -rf tests/acceptance/3035/node_modules                                                 # vitest's cache
```

Every test passes #191's 60-minute timeout. `ac1`, `ac2` and `ac3` bring the debug `deep-physics` up to date once a
file (#191's `prebuild`) and copy it; every file starts one hub (`ac6` two) in a temp home under `/tmp/dh1922-*`
(#1922's world) and stops it by its PID. Node built-ins and vitest only; `../1922/helpers.ts` and `../191/helpers.ts`
are imported read only. No network, no model, no GPU, no app, no pixels, and no test times anything, so none depends
on the machine (the issue's Runs on line: any machine). No process is stopped by name or port. The folder runs alone
(`lane.json`): each file starts a real hub that runs job tools through the supervisor.

Nothing missing passes (invariant 2): a hub that doesn't start, a runner that can't run or an install that can't be
made fails its test with a line starting `BLOCKED:`; a job that answers blocked is `BLOCKED:`, never a pass; a bake
short of a state or a reading, a `rot` that can't be read one way, or a planted program that changes nothing fails
with `INCONCLUSIVE:`.

## The surface under test

The issue names the behaviour and no interface. These tests reach it as #162's suite reaches the import job, and
read what a conversion writes with the base's physics runner. **Every name below marked *(ours)* is this job's
choice**, the least the criteria need, in the issue's and the design's spellings where they have them; the
implementer builds exactly these, or a dispute goes to a blind redraft. Everything else is the base's and stays as
it is.

### The job

- The kind is **`import`**, in the first-party plug-in `packages/jobs/import`, installed with
  `deep install packages/jobs/import` (both the base's). Its `from` takes **`urdf`** *(ours: the format's own name
  in lower case, as `lottie`, `midi` and `gcode` are)*.
- deep_job's list names exactly one tool of the kind whose name matches **`^urdf[a-z0-9_-]*@\d+\.\d+\.\d+$`**
  *(ours)*, for example `urdf-import@1.0.0`. The plug-in registers it through `deep.registerJobTool('import', …)`
  with `run {dir, entry}`, and it runs as the base's job tools do: `node <entry>` in its folder, `{params, inputs}`
  on stdin and `{outputs}` on stdout, each file's bytes in base64.
- A run, as the tests write it *(the params ours; the input is the kind's own `file`)*:

  ```json
  {"op": "run", "kind": "import", "tool": "urdf-import@1.0.0", "params": "{\"from\":\"urdf\"}",
   "inputs": [{"name": "file", "path": "/tmp/dh1922-…/proj/arm.urdf"}]}
  ```

  No other param is written and no other input is given. In particular the suite gives no mesh as an input, so how a
  mesh file is given as one isn't fixed here (Readings: visual meshes).
- Done, as the base's jobs answer: `{"status": "done", "outputs": {"document": {"sha256"}, "report": {"sha256"}, …},
  "receipt": {"kind", "tool", "key", "build", "cache": "miss" | "hit", "inputs"}}`. The tests read the outputs
  **`document`** and **`report`** *(the kind's own names, their contents for this `from` ours)*, each JSON, by hash
  from the hub's evidence store (`<home>/.deepbuild/evidence/<2 hex>/<62 hex>`). Any other output the kind declares
  is compared by hash in criterion 6 and read by no test.

### The `document`

A JSON object. The tests read two of its maps *(their use here ours)*:

- **`items.<link name>`**: one item for each link, under the link's `name` as its ID. Only that it is there is
  read.
- **`worlds`**: exactly one entry, the robot's `physics.world@1`, inline, as a scene writes its worlds at the base.
  Its ID isn't read. In it:
  - **`bodies.<link name>`**: one `body@1` for each link, under the link's `name`. The tests read `pose.pos`
    (m) and `pose.rot` (a quaternion `[x, y, z, w]` or degrees `[x, y, z]`, as the base reads one), the link's
    frame in our axes with the root link's frame at the world's origin; `mass` (kg); and `inertia`
    `[Ixx, Iyy, Izz]` (kg·m²). The base's check must accept the rest (shapes, `centre_of_mass`), which no test
    reads.
  - **`joints.<joint name>`**: one `joint@1` for each joint that has a place, under the joint's `name`. `kind` is
    `hinge` for a revolute or a continuous joint, `slider` for a prismatic one, `fixed` for a fixed one; `a` is the
    parent link's body and `b` the child's; `frame_a` and `frame_b` are `{anchor, axis}`, each in its own body's
    frame; `limits` is `{min, max}`, degrees on a hinge and metres on a slider, and a continuous joint writes none;
    `articulated` is `true` (Readings: articulated).
  - The world stands alone: no body is bound to an item (`item`, `each`), and a motor's `target` is a number, so
    the base's `check` reads it with no scene. The suite reads no `motor` and no `outputs`.

```json
{"items": {"base": {…}, "upper": {…}, "fore": {…}, "tip": {…}},
 "worlds": {"two_link_arm": {"kind": "physics.world@1", "capacity": {…}, "shapes": {…},
   "bodies": {"fore": {"kind": "dynamic", "pose": {"pos": [0.5, 0, 0], "rot": [0, 0, 0, 1]}, "mass": 1,
                       "inertia": [0.0004, 0.021, 0.021], "centre_of_mass": [0.25, 0, 0], "shapes": [{…}]}, …},
   "joints": {"elbow": {"kind": "hinge", "a": "upper", "b": "fore", "articulated": true,
                        "frame_a": {"anchor": [0.5, 0, 0], "axis": [0, 0, 1]},
                        "frame_b": {"anchor": [0, 0, 0], "axis": [0, 0, 1]},
                        "limits": {"min": -90.00021045914971, "max": 90.00021045914971}}, …}}}}
```

(The example is the arm under −90° about X. The names in a file here are already IDs, `[a-z0-9_]`; what a name that
is no ID becomes isn't read.)

### The `report`

A JSON object with two fields *(both ours)*:

- **`rotation`**: the one rotation the conversion applies, stated as a `rot` is written: a quaternion
  `[x, y, z, w]`, or degrees `[x, y, z]` about one axis (The change of axes).
- **`dropped`**: a list of rows **`{element, name}`**, both text: `element` is the tag of the file's element that
  has no place and `name` its `name` attribute. A mimic joint's row is `{"element": "joint", "name": <the joint's
  name>}`. A row may hold more fields; the tests compare `element` and `name`.

```json
{"rotation": [-0.7071067811865476, 0, 0, 0.7071067811865476],
 "dropped": [{"element": "joint", "name": "mirror"}, {"element": "transmission", "name": "squeeze"},
             {"element": "sensor", "name": "eye"}]}
```

### The change of axes

The issue says the file's Z-up, right-handed metres become ours, +Y up, "by one stated rotation applied to every
pose, axis and inertia", and prints no matrix; criterion 2 pins that 1 m up the file's Z is y = 1 m. More than one
rotation does that. The tests hold:

- what the issue and the design fix: `report.rotation` is a rotation R, read as a `rot`, and R takes the file's +Z
  to our +Y within 1e-9;
- beyond that, R itself, applied by `model.ts` to the fixture's numbers: a point p is R·p, a link's orientation Q is
  R·Q·Rᵀ, a moment tensor I is R·I·Rᵀ, whose diagonal is the body's `inertia` and whose products must be 0 within
  1e-9, since `[Ixx, Iyy, Izz]` has no place for one. So a conversion that states one rotation and applies another,
  or turns positions and leaves the inertia or an axis as the file writes it, fails.

A `rot` written as degrees about more than one axis reads `INCONCLUSIVE:`: the design composes the three in fixed
axes (R = Rz·Ry·Rx) and the base's backend about turned ones, and they differ there. No expected value here needs
one.

### The refusals

A run that is refused answers, as the base's jobs do, **`{"status": "refused", "reason": text}`**, with no
`outputs`, and keeps nothing. The reason holds *(ours)*:

| File | The reason holds |
|---|---|
| one with an element of the macro namespace | the element's name as the file writes it: `xacro:include` |
| one whose visual names a mesh that is none of the job's inputs | the path as the file writes it: `../elsewhere/shell.stl` |

```json
{"status": "refused", "reason": "macro.urdf needs a macro expanded: xacro:include; nothing was written"}
```

No code and no other field is read. At the base a tool of this machine has no way to say why it stops (its exit
status alone reaches the reply), so how the reason reaches the reply is the implementer's.

### The kind's qualification, and the planted programs

The design: an import's tools "qualify on the kind's fixtures, each with a planted defect", and a job tool's kit is
"the kind's qualification", whose planted wrong fill is a tool that gets a fixture wrong. So the judge of each
planted conversion is the kind's qualification, run by `deep install` with no person, as #1922's criterion 3 plants
a tool:

- **The kind's qualification holds, for `from: urdf`, three fixtures whose `file` is this suite's
  `fixtures/arm.urdf`, `fixtures/axes.urdf` and `fixtures/gripper.urdf`, byte for byte** *(ours; their names and
  expected outputs are the implementer's)*. A tool that joins the kind for this format is run on them.
- A planted program is a plug-in the suite makes at test time (`helpers.ts` `plantedInstall`), one tool for the
  kind `import` registered through `deep.registerJobTool` under **the right tool's own descriptor**, read from the
  import plug-in's default export called with a `deep` that only records, with two fields changed: its `tool`, and
  its `run.entry`. Its folder is a copy of the right tool's folder with three files laid beside the right tool's:
  `deep-3035-tool.mjs` (`fixtures/planted/tool.mjs.fixture`), which runs the right entry on the same request and then
  makes one thing wrong; `deep-3035-spoil.mjs` (`fixtures/planted/spoil.mjs`); and `deep-3035-plan.json`. Whatever
  the qualification runs on the right tool it must run on a tool registered this way.
- **`runs-as-is@1.0.0`** is that plug-in with nothing made wrong: it hands on the right tool's bytes. It must
  qualify and be listed, which is the judge passing the right conversion through the planted tools' own entry.

| Planted program (`twins.json`) | Its tool | What it makes wrong, exactly (`spoil.mjs`) | Criterion | The refusal at install names |
|---|---|---|---|---|
| `flips_one_joint_axis` *(ours)* | `flips-one-joint-axis@1.0.0` | in a document that holds the joint `elbow`: that joint's `frame_a.axis` and `frame_b.axis`, each with the other sign, as if the file's `<axis>` were written negated | 1 | `elbow` |
| `copies_poses_as_written` *(ours)* | `copies-poses-as-written@1.0.0` | in a world that holds the body `mast`: every body's `pose` is the one the file writes, the stated rotation undone on it alone (position Rᵀ·p, orientation Rᵀ·Q·R); anchors, axes, inertia and shapes stay as converted | 2 | `mast` |
| `drops_one_silently` *(ours)* | `drops-one-silently@1.0.0` | in a report whose `dropped` holds a row of element `transmission`: that row left out | 4 | `transmission` and `squeeze` |

Each is wrong about one named thing of its criterion's fixture and hands on every other output byte for byte, so
it passes every fixture but its own. Each planted test asserts three things. The judge passes the right
conversion: `runs-as-is@1.0.0` installs and deep_job lists it. The judge fails the planted one: `deep install` of
its plug-in exits non-zero, what it says holds the name above, and deep_job doesn't list the tool. And the planted
conversion is the wrong program its criterion names: `spoil.mjs`, the function the tool runs, applied to the right
conversion's outputs, puts the tip at (0.9330127, 0.25) m, where a flipped elbow puts it, leaves `mast` at the
file's (0, 0, 1) m, or leaves `dropped` one row short, and this suite's own judge of the criterion fails it, naming
`elbow` and not `shoulder`, `mast`, or `transmission squeeze`.

## How a joint is put at an angle

"Read from evaluated data" (criterion 1) and "swept" (criterion 3) are read on the base's physics runner, never from
the job's word. `helpers.ts` `placing` bakes a copy of the converted world in a scene of the suite's own, in
kinematic mode, where the base's solve places each body from its joint's own frames at the coordinate a channel
gives (canvas primitives: Kinematic solve). The copy differs from the converted world only in this: `mode` is
`kinematic` at 120 Hz; a `solve` drives each hinge and slider from a channel on hold keys, one placement a step; a
link that no joint holds, the root, is held to the world where it is written by one fixed joint; each joint's
`joint_coordinate` is read back; and each joint's `motor` and the world's own `outputs` are left out, since a
kinematic world runs neither and they may read another document. A placement is read from the bake: each body's
`pos` and `rot` after its step, and each joint's `joint_coordinate`.

- The tip (criterion 1) is the body `tip`'s origin less the body `base`'s, held to R applied to the file's point.
  Three placements: both joints at 30°; the shoulder at 30° alone; the elbow at 30° alone. A wrong tip with both
  starts `tip: `; a wrong tip with one joint alone starts with that joint, which is how a failure names a joint.
- A joint's two anchors (criterion 3) are each worked from its body's state and the joint's own frame. A slider's
  anchors part along its axis by its travel, so its gap is what is left across the axis, as the base's
  `physics.articulation_gap` reads one.

The bodies' states are the backend's f32 values: with links of 0.5 m they hold a position to about 1e-7 m, inside
criterion 1's 1e-6 m. Values held to 1e-9 (criterion 2) are read from the document's f64 numbers.

## The fixtures and their numbers

Six files in `fixtures/`, hand-written, in the file's units: metres, radians, kilograms, Z up. Robots, links and
joints carry names of this suite's making. Every link has an `<inertial>` (a mass, three moments with every product
0, and the centre of mass) and a `<collision>` box or sphere around that centre, so each body is one the base's
check accepts whatever a link without them would become. No file has a `<visual>` but `mesh.urdf`, and none has a
`<dynamics>`, a material or anything else whose place the issue doesn't state. `model.ts` holds each file's numbers,
and each test lists what of them its file lacks (none).

- **`arm.urdf`** (criteria 1 and 6). `base`; `upper` on the revolute `shoulder` at `base`'s origin; `fore` on the
  revolute `elbow` at (0.5, 0, 0) in `upper`; `tip` on the fixed `flange` at (0.5, 0, 0) in `fore`. Both revolute
  joints turn about the file's (0, −1, 0) and are limited −1.5708 to 1.5708 rad. At 0 the arm lies along the file's
  +X, and a positive angle lifts it toward +Z, so the arm's plane is the file's X-Z plane.
  - The limits: 1.5708 rad × 180 ÷ π = 90.00021045914971°, 0.00021° from 90.000°, inside the criterion's 0.001°.
    A hinge limited to exactly ±90° passes too.
  - The tip: with the shoulder at s and the elbow at e the upper link points s above +X and the fore link s + e,
    so the tip is 0.5 × (cos s + cos(s + e)) along +X and 0.5 × (sin s + sin(s + e)) up +Z. At 30° and 30°:
    0.5 × (√3/2 + 1/2) = 0.6830127018922193 m on each axis. **The issue prints (0.683, 0.683) m and asks for
    1e-6 m; the printed digits are 1.27e-5 m from the closed form on each axis, so the judge holds the closed form,
    0.6830127 m, at 1e-6 m**: held to the printed digits a right arm would fail.
  - Each joint's turn alone: the shoulder at 30° puts the tip at (0.8660254, 0.5) m, the elbow at 30° at
    (0.9330127, 0.25) m. A flipped shoulder puts the tip with both at 30° at (0.9330127, −0.25) m and a flipped
    elbow at (0.9330127, 0.25) m, 0.5 m from the right place, so the two joints differ in what flipping each does.
- **`axes.urdf`** (criterion 2). `base`; `mast` on the fixed `post` at (0, 0, 1); `slab`, 2 kg with ixx 0.02,
  iyy 0.06 and izz 0.07 kg·m², on the fixed `bracket` at (0.4, 0.3, 0.5), turned 0.5235987755982988 rad (30°) about
  the file's Z.
  - `mast` stands at R·(0, 0, 1) = (0, 1, 0) for every R the tests admit: y = 1 m. Copied as written it is at
    (0, 0, 1), 1.41 m away.
  - `slab` keeps 2 kg. Its moments are the diagonal of R·diag(0.02, 0.06, 0.07)·Rᵀ: about our Y the file's izz,
    0.07, whatever R does besides; under −90° about X, where the file's (x, y, z) is our (x, z, −y),
    (0.02, 0.07, 0.06). The three differ, so a moment left on the file's axis shows.
  - `slab` stands at R·(0.4, 0.3, 0.5), under −90° about X (0.4, 0.5, −0.3), and is turned R·Rz(30°)·Rᵀ, which is
    30° about our Y for every R the tests admit.
- **`lift.urdf`** (criterion 3). `base`; `sled` on the prismatic `rail` at (0, 0, 0.1), along the file's
  (0, 0, 1), limited 0 to 0.2 m; `hand` on the revolute `wrist` at (0.1, 0, 0) in `sled`, about the file's
  (0, 1, 0), limited ±1.5708 rad. From the rail's lower to its upper limit `sled` moves 0.2 m along R·(0, 0, 1),
  our +Y.
- **`gripper.urdf`** (criterion 4). `palm`, `finger_a`, `finger_b`, `knob`, `pad`. Kept: the revolute `pinch`, the
  continuous `spin`, the fixed `glue`. No place: the joint `mirror`, which holds `<mimic joint="pinch">`; the
  `<transmission name="squeeze">`; the `<sensor name="eye">`. So `dropped` is those three rows and no other.
- **`macro.urdf`** (criterion 5). A robot element that declares the macro namespace by the URI such files use (a
  reader that tells a macro by its namespace needs it; nothing else here names another product) and holds one
  element of it, `<xacro:include filename="segment.xacro"/>`, beside one link.
- **`mesh.urdf`** (criterion 5). One link whose visual is `<mesh filename="../elsewhere/shell.stl"/>`. The file
  doesn't exist, and the job is given `mesh.urdf` alone.

## Criteria to tests

| AC | ID | Test | Asserts | Fails on |
|---|---|---|---|---|
| 1 | `#3035.e8200294` | the arm | the model's numbers by hand, and its wrong twin off; the measure passes the hand-written arm and fails it with either joint flipped, naming that joint alone; then the conversion: `shoulder` and `elbow` are hinges limited −90.000 to 90.000° within 0.001°, the report's rotation takes +Z to +Y, and the tip in the three placements is the closed form within 1e-6 m | the base (no tool); a conversion that leaves limits in radians, an axis unturned, a frame off |
| 1 | | planted `flips_one_joint_axis` | `runs-as-is` qualifies; the planted tool is refused at install naming `elbow` and isn't listed; its arm puts the tip at (0.9330127, 0.25) m and the measure names `elbow`, not `shoulder` | the base; a qualification that lets the flipped axis through |
| 2 | `#3035.b3b50392` | the axes | the model's numbers by hand; the base's check accepts the hand-written rig; then the conversion: each link an item and a body, `mast` at (0, 1, 0), `slab` 2 kg with the moments, the place and the turn R gives, all within 1e-9, and the base's check accepts the world as converted | the base; poses copied, moments left on the file's axes, one rotation stated and another applied |
| 2 | | planted `copies_poses_as_written` | `runs-as-is` qualifies; the planted tool is refused naming `mast` and isn't listed; its `mast` is at (0, 0, 1) and the judge names `mast` | the base; a qualification that lets it through |
| 3 | `#3035.2a1744e4` | the sweep | the measure passes the hand-written lift and fails one whose rail is limited to 0.1 m; then the conversion: `rail` a slider 0 to 0.2 m, `wrist` a hinge ±90.000°, every joint `articulated: true`, the base's check raises no error, and over 21 positions of each joint every anchor pair is within 1 mm, the joint reads its lower and its upper limit at the ends, and `sled` travels (0, 0.2, 0) m within 1 mm | the base; limits in the wrong unit, a slider along the wrong axis, poses a millimetre off their frames |
| 4 | `#3035.0abd59c7` | dropped | the comparison passes the three rows in any order and fails one fewer, one more, one twice; then the conversion is done, `dropped` is exactly the three rows, and `pinch`, `spin`, `glue` and their links are kept as a hinge with limits, a hinge with none, a fixed joint and bodies | the base; a row missing, a kept joint listed, a continuous joint given limits |
| 4 | | planted `drops_one_silently` | `runs-as-is` qualifies; the planted tool is refused naming `transmission` and `squeeze` and isn't listed; its report fails the comparison on that one row | the base; a qualification that lets it through |
| 5 | `#3035.a4b3d8f2` | the macro | the run is `refused`, its reason holds `xacro:include`, it returns no output and the store holds no new file; and in the same hub a conversion of `arm.urdf` that is done adds its document and its report to the same listing of the store, so the listing sees what a job writes | the base (no tool); a job that converts the rest, or stops without naming the element |
| 5 | | the mesh path | the run is `refused`, its reason holds `../elsewhere/shell.stl`, no output, no new file | the base; a job that drops the visual, or stops without naming the path |
| 6 | `#3035.36c146dd` | twice | in two hubs each conversion is a miss that starts a process, and both return the same outputs by hash, held by each store, the document and report the same bytes | the base; a tool that writes a time, a random ID or an unordered map |
| 6 | | the rerun | in the first hub the same run again is `done`, `cache: hit`, the same key and outputs, and starts no process | the base |

Numbers are judged at the tolerance the criterion gives: 0.001° on a hinge's limits and on an angle a joint is set
to; 1e-6 m on the tip; 1e-9 on criterion 2's place, mass, moments and turn, and on the slider's limits, which are
the file's own metres; 1 mm on an anchor pair and on the 0.2 m of travel, the one length tolerance its criterion
gives. A slider's `joint_coordinate` at an end of its sweep is held at 1e-6 m, criterion 1's tolerance for a length
read from a bake, since criterion 3 gives none for it. A kind, a name, a row and a status are held exactly.

## Readings where the issue and design leave a choice

- **The kind** is `import`: the issue links Asset job: imports, calls what is left out `dropped`, as that section
  does, and writes items, which is a fragment and no `.glb`; the base's `import` already takes a `from`.
- **`dropped` sits in the `report`**: at the base the hub writes the receipt and a tool only its outputs, and the
  import's `report` is where #162's tool says what a document couldn't hold.
- **A mimic joint's row** is by the element that carries its name, `joint`, as the issue lists "mimic joints" beside
  floating and planar joints. Whether its own turn is kept as a hinge without the coupling isn't read.
- **One row an element**: the transmission's `<joint>` and `<actuator>` go with it and get no row of their own.
- **"The arm's plane"** is the file's X-Z plane, the first number along the arm at 0 and the second up.
- **Articulated**: the Scope doesn't print it. The opening paragraph names "a tree of joints solved as one
  articulation (#2310)" and criterion 3 holds the anchors "as `physics.articulation_gap` requires", a rule the base
  holds articulated joints to and no other, so each converted fixed, hinge and slider joint is read as
  `articulated: true`, and criterion 3's test says so.
- **The sweep** (criterion 3) has three parts, since in a kinematic solve a joint's anchors meet by construction:
  the rule the criterion names is run by the base's own check on the world as converted, where it reads the written
  poses against the frames; the anchors are read at 21 positions of each joint, which also shows the sweep ran; and
  each joint's `joint_coordinate` at the two ends shows it reaches both limits. The dynamic solver isn't used to
  sweep: a motor reaches a limit only as closely as the solver holds it, and #2310's own criterion holds a limited
  hinge to half a degree, which no 0.2 m within 1 mm or 0.001° could be read through. That wasn't measured here.
- **"Travels 0.2 m"** is the place of the prismatic joint's link at the upper limit less its place at the lower, up
  our +Y, the file's +Z.
- **"Before anything is written"** covers the reply (no `outputs`) and the store (no new file under the hub's
  evidence folder). A process may start: the tool has to read the file to find the macro.
- **"Twice"**: a cache hit is no second conversion, so the two conversions run in two hubs, each a miss that starts
  a process.
- **"A file that includes a macro"** is read as a file that holds the macro language's include, the one element of
  that namespace in the fixture, so "the element" is one element.
- **Visual meshes**: no criterion asks for a mesh to be converted, #1984 isn't on the base, and without a qualified
  tool for a mesh's format the design has the job BLOCKED, never PASS. So the suite asserts one thing of a visual
  mesh: a file that names one by a path the job wasn't given is refused, naming the path. It gives no mesh as an
  input, and "outside the job's inputs" is read as "none of the files the job was given"; the fixture's path also
  climbs out of the file's folder, which the design's timeline import refuses by itself.
- **"Naming"**: a refusal names a thing when its text holds the thing's name as the file writes it. The planted
  tools' and plug-ins' own names hold none of those names.

## Not asserted, and why

No criterion asks: a link's item's kind, parent or transform; a body's `kind`, shapes or `centre_of_mass` (the
base's check must accept them); effort and velocity limits as a motor's fields; floating and planar joints and
simulator extensions in `dropped`; a file's inertia with products, a link with no `<inertial>`, a `<visual>` of a
box; a name that is no ID; the world's ID, `capacity` and solver fields; the receipt beyond `cache` and `key`; the
`report` beyond its two fields; any wording of a refusal beyond the name it holds; other robot formats, controllers
and writing a file out, which the issue leaves out.

## What the implementer adds outside this folder

- `from: urdf` and its tool in `packages/jobs/import`, with the kind's qualification holding this suite's
  `arm.urdf`, `axes.urdf` and `gripper.urdf` for that format (The kind's qualification, above). At the base every
  tool of a kind is run on every fixture of the kind, and a tool of this machine can't say why it stops; both are
  the host's, in `packages/extension-host` and `packages/hub`.
- Nothing in `scripts/lanes.mjs`: `lane.json` here makes the folder run alone.
- Nothing in this folder.
