# Acceptance tests for #1918: the physics module's occurrence lists and outputs, sorted per step and read through the column view

Written first, from issue #1918 (its Scope, its Fields, five acceptance criteria and its Proof line: "The ball-and-goal
lab's occurrence lists read through the column view, with their planted twins"), its Oracle page
(`doneright/oracles/issues/1918.md` in DeepBuildAI/deepbuild, branch `doneright`: no upstream test for any criterion),
the design sections it names and base commit `f0405959a` ("Merge pull request #2226 …", which holds #2009's, #2010's,
#2012's, #397's and #200's merges), by a job that never saw an implementation; none existed, and no other worktree,
branch or pull request was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding). Lean: one test per criterion clause that needs its own run, plus the
planted twins the criteria name and the one twin that keeps criterion 5's equality from passing vacuously.

## What was read

- The issue, live with `gh issue view 1918 --repo windoliver/deepbuild`, and its Oracle page.
- `docs/technical-design.md`: The physics module (World; Shape, body, contact material, collision group; Joint and
  force; Input, occurrence, output; Bake and golden; Behavior kit); The canvas core (canvas modules, phases, the column
  view, registries and the seal); Dogfooding and Tests written first. AGENTS.md.
- `docs/canvas-primitives.md`: Document envelope (`worlds`); Canvas module; Registry and seal, its registries; Phase;
  Operator and read set; Array and table, and its column view; Channel and key; Driver; A timeline as data over a pinned
  backend; World and backend `physics.world@1`; Shape; Body `body@1`; Contact material; Collision group; Joint `joint@1`;
  Input track entries; Occurrence list; Physics output; Checkpoint ring; Bake; Golden; Physics: behavior kit; Kinematic
  solve.
- At the base, read only for the surfaces these tests extend: `tests/acceptance/2009/`, `2010/`, `2012/` (READMEs,
  helpers, the ball-and-goal lab), `544/`, `535/`, `397/`, `443/`, `200/`, `388/` (READMEs and helpers: deep-show
  scenarios, `eval`, `registries`, startup refusals, parity fixtures, `twins.json`); `crates/deep-physics-rapier`
  (`runner.rs`, `main.rs`, `lib.rs`, `Cargo.toml`), `crates/deep-canvas-physics` (`doc.rs`, `backend.rs`, `caps.rs`,
  README); `crates/deep-canvas/src/columns.rs` and `registry/core_lists.rs` (`column.source@1` and its kit),
  `registry/lists.rs` and `registry/mod.rs` (kit results, `entry_refused`, `undeclared_dependency`, `private_read`);
  `crates/deep-show` (`main.rs`: calls, the startup refusal; `frames.rs`: `eval`; `query.rs`: reading a path;
  `logic.rs`, `registries.rs`, `Cargo.toml`'s features); `crates/deep-canvas-motion` (`doc.rs`: drivers, occurrence-list
  vars, `worlds`; `occurrence.rs`; `program.rs`: a world's list read as empty); `scripts/proof-change.mjs` (criterion IDs);
  `scripts/lanes.mjs` (`alone`).

What the base already does, which these tests don't credit: `deep-physics` checks, bakes, restores, plays and goldens a
world document with static and dynamic bodies, sensors, collision groups, fixed, ball, hinge, slider, distance and rope
joints and numeric motors (#2009, #2010); it refuses kinematic bodies, `follow`, channel motor targets, `breaks_at`,
outputs other than a body's position and every output field but `from` and `read`, and answers no occurrences
(`golden`'s `occurrences_hash` is null). `deep-show`'s motion module parses a driver var `{list: "<world ID>.occurrences",
kinds, tags}` and reads a world's list as empty ("a world's occurrences come from its bake, which no evaluation here has
run"); no build registers the physics module; `column.source@1` holds the data, logic and test modules' entries.
Checked at the base before the run, with a probe (not committed) on the base's `deep-physics` and the fixtures' fields
the base runs (kinematic paddles stood in by static boards, `breaks_at` left out): the stacked cubes hold still and the
stone lands on them at step 97 (0.808 s); the 100 m/s bullet stops 0.85 m along +x, against the +x wall, from step 2 on;
the incline cube moves 0.17 mm in 2 s; red and purple land, blue and mute fall through the floor; the sensor ball's
lowest point reaches 0.5 m below its start after step 39 (0.325 s) and the floor after step 55; the lab ball first lands
at step 74 and again at 104; the rally's ball meets a board at x = 5 at step 107 and at x = 6 at step 135; the table's
legs land at step 25 and settle within 0.22 mm with no lift; a hinge velocity motor of 0 holds the wheel exactly still
and one of 90°/s turns it at 54.5°/s after one step and at 90.0000°/s after 0.5 s.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/1918 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/1918/tsconfig.json
rm -rf tests/acceptance/1918/node_modules/.vite
```

Each file builds what it drives once, in `beforeAll`, honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and
`CARGO_PROFILE_DEV_DEBUG=0` unless set, Homebrew's rustup put on PATH when present, and copies each binary into a
temporary folder:

- `deep-physics`: `cargo build --locked --bin deep-physics` through `../2009/helpers.ts` (`ac1`, `ac2`, `ac4`, `ac5`);
  and for `ac5` also `cargo build --locked -p deep-physics-rapier --bin deep-physics --features test-reverse-pairs`.
- `deep-show`: `cargo build --locked -p deep-show --bin deep-show` (the default `full` set; `ac3`, `ac4`), and for `ac3`
  the same with `--features test-physics-hands-no-changes` and with `--features test-motion-reads-physics-array`.

Every test passes an explicit timeout: 60 minutes (#2009's `TIMEOUT`), or 30 for `ac3`'s tests; each deep-show run
within one has 30 minutes, and the builds in `beforeAll` 60 a build. Bake stores,
evidence stores and binaries are temporary and deleted. Node built-ins and vitest only; `../2010/helpers.ts` and, through
it, `../2009/helpers.ts` are imported read only (the world builders, `world`, `box`, `sphere`, `floor`, `dynamic`,
`bake`, `ballAndGoal`, `statesOf`, `keyOf`, the build of `deep-physics`). No process is started but `cargo`,
`deep-physics` and `deep-show`, each waited for, none stopped by name or port. No criterion names another machine, so
there is no Docker leg. Gates: no cargo on this machine is `BLOCKED:` (#2009's helper), a failed test, never a pass;
nothing here is INCONCLUSIVE, since no reading depends on load, a device or a reference machine.

## The surface under test

The issue names occurrence kinds and columns, outputs, the kinematic solve, `column.source@1`, the column view, the
registry's kit, a driver, a seal refusal and a test backend, but no command line. **Every call, field, reply field,
flag, cargo feature and planted name below that the issue or the design doesn't give is this job's invention**, the
smallest the criteria need, extending #2009's and #2010's `deep-physics` (their READMEs' surfaces stand as written) and
#393's `deep-show run` as #200, #397, #535 and #544 left it. The implementer builds exactly these, or a dispute goes to a
blind redraft.

### `deep-physics`: what this suite adds

**A scene's world.** `check`, `bake` and `restore` also take `"scene": Scene` with `"world": "<world ID>"` (a string): the
world is `scene.worlds[<world ID>]`, which holds the world document itself, inline. The world then reads the scene: each
path physics reads is evaluated at each step's time by the motion module, from the scene's channels, drivers and items'
own fields, as the scene evaluates it (Phase: "each physics step first evaluates, at that step's time, the channels,
drivers and logic arrays physics reads"). With `world` a document (#2009's form) nothing changes. `Scene` is a scene
document as the agent's session sends it (no `id`, no `layers`) or as a file holds it (`channel-targets.scene` has an
`id`); `deep-physics` doesn't run the canvas document check on it.

| Call | Reply |
|---|---|
| `{"call": "check", "scene", "world": "<world ID>"}` | #2009's: `{"ok": true, "issues": [Issue]}`; a path physics reads that depends on a physics pose is an error issue `"code": "cycle"` whose JSON holds that path |
| `{"call": "bake", "scene", "world": "<world ID>", "steps", …}` (#2009's and #2010's fields: `read`, `every`, `checkpoints`, `frame_rate`, `store`) | #2009's and #2010's, plus `"occurrences": [Row]` and `"occurrences_hash": 64 hex`; the `key` covers the scene channels and drivers the world reads (Bake: `key`) |
| `{"call": "restore", "scene", "world": "<world ID>", "checkpoint", "steps"}` | #2009's: `bodies` from the restored step on, the scene's paths read at each step's own time t(k) = k × the step length, k counted from step 0 |
| every `bake`, with `world` a document too | `"occurrences"` and `"occurrences_hash"` as above (the list empty when nothing occurs) |

```text
Row = {"step": k, "kind": Kind, "a": ID, "b": ID | null, "a_use"?: i, "b_use"?: i, …payload}
Kind = contact_begin | contact_end | hit | force | sensor_enter | sensor_exit | break | tear | rest | wake | crossing | fault
```

- **`occurrences`** is the world's occurrence list over the bake's steps 1 to `steps`, in list order, one Row per entry.
  `step` is the step after which it was read (its time step × 1/120 s here); `kind` the kind's name. A kind's `u8` is its
  index in the design's list above (contact_begin 0 … fault 11), and the list is sorted by (step, kind, a, b), then
  `a_use`, then `b_use` (Occurrence list).
- **`a` and `b`** are stable IDs as the document writes them. A pair kind (contact_begin, contact_end, hit, force,
  sensor_enter, sensor_exit) names two bodies: `a` the lower in canonical order ((priority, ID); every priority here is 0,
  so ID order), `b` the other. A kind with one subject has `b: null` (or no `b`): `rest` and `wake` name the body, `break`
  names the joint (its ID in `joints`).
- **`a_use` and `b_use`** (contact kinds): the index of the shape use on `a` and on `b` (in its body's `shapes` list)
  the entry names; a contact entry names each pair of shape uses.
- **Payload** fields sit beside these, as the design names them: contact_begin `point`, `normal` ([x, y, z], the normal
  from `a` to `b`); hit `point`, `normal`, `speed` (m/s), `impulse` (N·s), `tags` (strings: the `tag` of each side's
  contact material); break `force`, `torque`; and the rest as the design writes them. The tests read `normal` and `tags`.
- **`occurrences_hash`**: the sha256 of the occurrence list as the bake stores it (its column bytes, the hash a golden's
  `occurrences_hash` names); equal lists, and only equal lists, give equal hashes.

**The world document**, besides #2009's and #2010's fields (each as the issue's Fields and the design name it):

- a body `kind: "kinematic"` with **`follow: "items/<id>/at/pos"`**: the body's position after step k is that path's
  value at t(k) (a vec3, m); its rotation stays its pose's. Its built pose is its `pose` (the fixtures write the
  channel's value at 0 there).
- a joint `motor.target` that is a path, **`"items/<id>/at/pos/<i>"`** (a number: for a hinge's velocity motor, deg/s),
  read at t(k) for step k.
- a joint's `breaks_at: {force: N, torque?: N·m, over_steps: u8 = 1}` (Joint `joint@1`).
- in `mode: "kinematic"`, the world's **`solve: {drivers: [{"joint": joint ID, "channel": path}], iterations: u8 = 20,
  tolerance: m = 1e-5}`** (Kinematic solve): each step sets each driven joint's coordinate (a slider's, in m) to its
  path's value at t(k), within `tolerance`. The world's non-static bodies are written `dynamic`; the solve places them.
- a contact material's `tag`; a shape use's `sensor: true` and `member` / `collides` (#2009's reader already takes them).
- an output `{from, read: "pose", to: "items/<id>/at"}` (Physics output): in a scene, the item's pose is the body's at
  the frame's time by Physics output's rule.

### The test backend (criterion 5)

Cargo feature **`test-reverse-pairs`** of `deep-physics-rapier`: `deep-physics` built with it runs a backend that wraps
Rapier but iterates contact pairs in reverse: it reads the engine's contact pairs (and sensor intersections) last to
first, and each pair from its second collider's side (its colliders swapped, its normals negated), so neither the order
nor the orientation the engine reports reaches the occurrence list. Everything else is Rapier's. It is a test backend,
never in a shipped build.

### Planted twin of `deep-physics`

| Switch | Criterion | The wrong program |
|---|---|---|
| `--planted occurrences_in_engine_order` | 5 | the occurrence list keeps each step's entries in the order the backend reads its pairs, with `a`, `b`, the shape uses and the normal as the backend gives them (its first collider's body as `a`), unsorted and unoriented; nothing else changes |

### `deep-show`: what this suite adds

- **The physics module in the `full` set** (canvas module `physics`, implementing `physics@1`; Canvas modules table:
  physics depends on motion and input). A scene's `worlds: {<world ID>: world document}` (inline, as above) runs in the
  scene: its outputs' item paths and its bodies' follow paths resolve there, it is baked over the transport's span, and
  its list and readings are what readers read. `eval` waits for every step its frame needs (no frame read here is stale).
- **`column.source@1` entries the physics module fills at the seal** (Array and table: column view), listed by
  `{"call": "registries"}` (#200's listing) with `"module": "physics"`: one whose `value.form` is the design's
  `"<world ID>.occurrences"` and one whose form is `"<world ID>.<ID>.<read>"` (the tests accept any placeholder names in
  angle brackets: `<…>.occurrences` and `<…>.<…>.<…>`), each with the registry's `types` and `fixture` and its kit
  result. The readings entry's kit fixture is the ball-and-goal lab's ball read over its first frames
  (`fixture.frames`, `fixture.changed`, `fixture.seeks`, the core kit's shape), so its rows change while the ball moves.
- **A driver var `{list: "<world ID>.occurrences", kinds, tags}`** reads the world's list through the column view (the
  base's motion parse); `count` counts the entries at or before the frame's t, an entry's time being its step's.
- **`eval`'s `paths`**: `{"call": "eval", "doc", "t": flicks, "paths": [path]}` answers as before plus
  `"values": {path: value | null}`, each path's evaluated value at that frame on the document's live session, read as
  `deep_query` reads a path (`items/<id>/at/pos` a vec3, `items/<id>/at/pos/0` a number). Successive `eval` calls in time
  order on one document play it; a call at another time on a session is a seek (#497's convention).
- **Two test builds** (the twins below), each a cargo feature of `deep-show`, refused by the seal at startup with #200's
  line `{"ok": false, "code": "seal_refused", "reason", "modules", "operators", "arrays", "what", "registry"?,
  "entries"?, "rules"?}` and exit 2.

Existing calls driven unchanged: the scenario (`evidence`, `sessions`, `processes`, `panels`, `docs`, `calls`),
`deep_show` with `session` and `include: ["issues"]` (#393), `registries` (#200).

### Planted twins of `deep-show` (criterion 3)

| Cargo feature | The wrong program |
|---|---|
| `test-physics-hands-no-changes` | the physics module's readings entry (`<world ID>.<ID>.<read>`) hands the view no changed ranges: the same entry, its kit fixture's frames the real entry's, every `changed` list empty. The seal must refuse it: reason `entry_refused`, `registry: "column.source@1"`, `entries` naming the entry, `rules: ["clean_rebuild_equality"]`, `modules` naming physics, and `what` naming `frame <k>`, k the first fixture frame whose rows differ from frame 0's |
| `test-motion-reads-physics-array` | the motion module with one more operator that reads the physics module's array holding the occurrence lists by its array name (`physics.<…>`) instead of by the form through the column view. The seal must refuse it: `modules` naming motion and physics, and the line naming the read, a `physics.<…>` array, in `arrays` or `what` (the reason, `undeclared_dependency`, `private_read` or another, isn't pinned) |

`twins.json` maps each criterion's ID to its twins.

## The fixture: `fixtures/parity/physics/channel-targets.scene`

The issue names `parity/physics/channel-targets.scene`; the base has no `parity/` tree, so it lives here, to be moved
when the corpus lands, as #388's did. It is a scene document (JSON): a 2 s transport at 60 fps, items `paddle`, `wheel`,
`dial`, `slider` (scene3d `mark.box@1`) and a camera, and two worlds:

- `rig` (dynamic, 120 Hz, checkpoints every 60 steps): `paddle`, a kinematic plate following `items/paddle/at/pos`, which
  the vec3 channel `paddle` keys (linear from (0, 1, 0) at 0 s to (1.5, 1.25, −0.5) at 1 s, held until 1.525 s, then
  linear from (0.5, 0.75, 0.25) to (0, 1, 0) at 2 s); `wheel`, a 1 kg box with gravity_scale 0 on the hinge `spin` to the
  world about +y, whose velocity motor (max torque 1,000 N·m, 10 Hz, damping ratio 1) reads `items/dial/at/pos/0`, which
  the f32 channel `dial` holds at 0 until 0.525 s (step 63) and at 90 (deg/s) from then; the output binding the wheel's
  pose to `items/wheel/at`.
- `linkage` (kinematic mode, no gravity): `slide` on the slider `rail` along +x from the world, driven by the solve from
  `items/slider/at/pos/0`, which the f32 channel `slider` keys (linear 0 to 0.5 m over 1 s, held until 1.525 s, then
  linear 0.75 to 0.25 m at 2 s).

The held segments jump at 1.525 s, step 183, and the dial at step 63: odd steps, between 60 fps frames, so a world that
reads its paths per frame, or at a step's start, lands off them.

## Criterion 2's fixtures

In `ac2-rigid-fixtures.test.ts`, each world and the list it must write. g = 9.81 m/s², 120 Hz, 4 substeps, restitution
0, so nothing bounces; materials `ground` (friction 0.6) and `block` (0.5).

| Fixture | World | Steps | The list, in order |
|---|---|---|---|
| a stack that sleeps and wakes | two 0.5 m cubes `lower` and `upper` stacked at rest on `floor`; a 50 g `stone` dropped 3.139 m (lands at 0.8 s) onto `upper` | 120 | contact_begin floor/lower, contact_begin lower/upper; rest lower, rest upper; contact_begin stone/upper, hit stone/upper, wake lower, wake upper |
| a sealed box with continuous collision | static `cell`: six 0.2 m walls as six shape uses (−x, +x, −y, +y, −z, +z), inner faces at ±0.9 m; a 5 cm `bullet` with `ccd: true` fired along +x at 100 m/s; no gravity | 60 | contact_begin bullet#0/cell#1, hit bullet#0/cell#1 |
| friction on an incline | a 0.5 m cube `block` (`sleep: false`) resting on a static `ramp` tilted 30°, friction 0.6 on both | 240 | contact_begin block/ramp (and so no contact_end) |
| a collision-group matrix | groups ground, red, blue; `floor` member ground, collides red; balls `red` (red; ground) from 1 m, `blue` (blue; ground), `mute` (red; none), `purple` (red and blue; ground) from 1.5 m | 90 | contact_begin floor/red, hit floor/red, contact_begin floor/purple, hit floor/purple |
| a sensor | a ball whose lowest point falls 1 m through the static sensor slab `gate` (top 0.5 m below it, bottom 0.6 m) onto `floor` | 72 | sensor_enter ball/gate (at 0.3193 s within one step), sensor_exit ball/gate, contact_begin ball/floor, hit ball/floor |
| a joint that breaks at its threshold | `heavy` (2 kg, 19.62 N) and `light` (1 kg, 9.81 N) hang from the world on fixed joints `snap` and `hold`, each `breaks_at: {force: 15, over_steps: 3}` | 60 | break snap (at step 3 or 4) |

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed, computed from the live issue. Each `describe` and `it` title starts with its criterion's ID.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 `#1918.adfa6a63` | `ac1-channel-targets.test.ts` (3) | The fixture's two worlds check with no error. Baked 240 steps: the paddle's position after every step k is the `paddle` channel's at k ÷ 120 s, within 1e-6 m; the wheel is still (|ω_y| ≤ 1e-3 deg/s) at every step before 63, turns (ω_y > 1 deg/s) after step 63, and turns at 90 deg/s within 1% after step 123; the slider sits at the `slider` channel's value at k ÷ 120 s, within the solve's 1e-5 m, at every step. Each world restored from its checkpoints at 60, 120 and 180 and stepped to 240 gives the straight bake's position and rotation at every step, exactly. The fixture with the dial's channel replaced by a driver of the same path reading `items/wheel/at/pos/1` (the wheel's own output) is refused with an error of code `cycle` naming `items/dial/at/pos/0`. Fails: a channel read at a step's start, per frame or not at all; a seek that reads its paths from its own start; a cycle accepted |
| 2 `#1918.ea47680a` | `ac2-rigid-fixtures.test.ts` (6) | Each fixture's bake answers exactly the list written above: kinds, `a`, `b` (shape uses for the bullet), order and count, sorted by (step, kind, a, b); the sensor's entry within 1/120 s of 0.3193 s; the one break at step 3 or 4; no contact_end for the incline. Fails: a missing, extra or misnamed row (a rest or wake not written, a contact ended by sleep, a tunnelled bullet, a matrix read one way, a sensor that responds or is late, a joint that breaks below its threshold, early, late or twice), an unsorted list |
| 3 `#1918.62636f58` | `ac3-column-view.test.ts` (4) | The full build's `column.source@1` (owner core) holds the physics module's `<…>.occurrences` and `<…>.<…>.<…>` entries, each PASS on every kit rule, `seek_equals_clean` and `clean_rebuild_equality` among them, the readings entry's fixture frames changing. The lab scene (#2010's ball-and-goal lab as `lab`, a driver writing count(hits) into the tally's x), played at every frame 0 to 180 and seeked on a second session to 20 frames mulberry32 (seed 1918) draws: the count never falls, is 0 before the ball's first landing (2 × 3 ÷ g = 0.6116 s, less one step) and at least 1 after it (plus one step), and each seek's count is playing's. `test-physics-hands-no-changes` is refused at the seal (entry_refused, column.source@1, the readings entry, clean_rebuild_equality alone, physics) naming the frame the ball first moves in; `test-motion-reads-physics-array` is refused naming motion, physics and a `physics.` array. Fails: no physics entry or one failing its kit; a driver that reads nothing, counts other kinds or reads another way when seeking; a kit that admits either twin; a refusal that names no frame or no read |
| 4 `#1918.1b4ea358` | `ac4-scene-lab.test.ts` (2) | The rally baked by `deep-physics` hits wood at least once and something else too; presented in `deep-show` and played at every frame 0 to 120, the scene's ball is the lab ball's position after step 2f within 1e-6 m at every frame f (3 m along x at 0.5 s, within 1%), and the driver reads the number of hit rows tagged wood at or before step 2f. Baked into one store: the same scene keys the same bake and reuses it; the edited scene (the paddle's channel 1 m back) keys another, isn't reused, its paddle follows the edited channel at every step within 1e-6 m and its ball moves otherwise; in `deep-show` the edited revision's ball at 2 s is the edited bake's, the first revision's the first's. Fails: an output that doesn't reach the item or lags a step, a driver that counts every hit or reads a stale list, a key blind to the scene's channels, a store that answers the old motion |
| 5 `#1918.4bdfb685` | `ac5-reverse-pairs.test.ts` (2) | On Rapier, the table's list is 4 contact_begin then 4 hit rows at one step, floor#0/table#1 … table#4, normals (0, 1, 0) within 1e-3, and the ball's contact_begin and hit ball#0/floor#0 with normal (0, −1, 0); pair rows name the lower ID as `a`; the two lists hash differently. On the reversed test backend both lists are Rapier's, byte for byte (rows as JSON with signs of zero kept, and `occurrences_hash`). With `occurrences_in_engine_order` on both builds the table's lists differ. Fails: a list in engine order or orientation, ties in pair order, normals as the engine gives them, a hash over something else |

Test count: 3 + 6 + 4 + 2 + 2 = 17.

## Readings where the issue leaves a choice

- **The surfaces.** The world's own behavior (criteria 1, 2, 5, and criterion 4's bake key) through `deep-physics`,
  which #2009 and #2010 left as the physics module's runner and which already bakes, keys and restores; a scene's world,
  the column view, the seal, the registry's kit and drivers (criteria 3 and 4) through `deep-show run`, the binary that
  holds the motion module, the core's registries and the document's evaluation. Criterion 4's one scene goes to both.
- **"Read their channels at each step's time, inside the step".** Step k (the state after k steps) reads each path at
  t(k) = k ÷ 120 s, the end of the step (Body: the follow target at t(k+1) for the step from k to k+1; Joint: motor
  targets at t(k+1)). **"A channel"** a body follows, a motor targets or a solve's driver reads is an item property path
  the scene's channels and drivers write (Channel and key: "a typed property path"), so a driver can make it depend on a
  physics pose. **"The body's pose … equals its channel"**: its position, within 1e-6 m (the f32 of the channel's f64
  value), at every step 0 to 240. For the motor, the observable is the step that first turns the wheel and the speed
  0.5 s later (the behavior kit's 90°/s within 1%); for the solve, the slider's coordinate within the solve's tolerance.
- **"A seek reproduces every pose"**: a restore of each checkpoint stepped to the end, against the straight bake, every
  body's position and rotation exactly (Checkpoint ring: "a seek restores the nearest checkpoint at or before t and steps
  forward"). **"Refused as a cycle"**: an error issue of code `cycle`, the canvas's code for a cycle, naming the path.
- **Criterion 2's lists** are written from each world's laws, before any run: a contact begins in the step two shape uses
  first touch and ends in the step they stop; a `hit` comes with a contact_begin in its step when the approach speed is
  at least `solver.hit_threshold` (1 m/s); `rest` is written in the step a body falls asleep and `wake` in the step it
  wakes, a stack's bodies together; a sleeping body's contacts don't end; a sensor writes `sensor_enter` and
  `sensor_exit` and never a contact; no world here declares what writes `force`, `crossing` or `fault` rows, so none is
  expected. Times are pinned only where the issue pins them; **"within one step"** is |step ÷ 120 − 0.3193| ≤ 1/120 s;
  **"within over_steps steps"**: the load passes 15 N from step 1, so the break is written at step over_steps (3) or the
  next, when the joint is disabled.
- **"Seeks to 20 seeded times"**: 20 distinct frames in 1 … 180 drawn by mulberry32 seeded 1918, evaluated in the drawn
  order on a session presented for them, against the played session's value at each; "the counts playing gives" is
  equality. The count's physics window keeps a driver that reads nothing from passing.
- **"Fails clean-rebuild equality, naming the frame"**: the seal's `what` names `frame <k>` and `rules` is
  `["clean_rebuild_equality"]` (#200's line for an entry failing its kit). **"Refused at the seal, naming the read"**: the
  line names a `physics.` array; the code is the implementer's.
- **"Moves the scene's ball"**: the item's evaluated position at each 60 fps frame equals the body's after step 2f (α = 0,
  so no interpolation is involved), and the ball does move. **"Equals the number of such hits up to each frame's t"**:
  hit rows whose tags include wood, at or before the frame's step, from the same scene's bake. **"Changes the bake's key
  and replays the new motion"**: `deep-physics`'s key differs and the edited bake simulates, its paddle on the edited
  channel; the scene shows the edited bake's ball.
- **"Iterates contact pairs in reverse"**: reverse order and reversed roles (The test backend), so the three rules the
  criterion names are each exercised. **"Byte for byte"**: the rows' JSON with -0 kept, and `occurrences_hash`.

## Not tested, because no criterion reaches it here

The kinds `force`, `tear`, `crossing` and `fault`, media and logic kinds; the payloads' values (a hit's speed and
impulse, a break's force); outputs' `interpolate`, `reduce`, `average`, `sample`, `keep`, `expr`, `unit`, skins and the
reads other than `pose` and `position`; joint_force and the other readings as columns; a kinematic solve's jams,
residuals and branch flips; sounds, spawns and logic reading a world's list; the bake key's input track; goldens'
`occurrences_hash`; 2D worlds; character and vehicle bodies; the web build. They are follow-ups for the implementer's own
tests.

**`scripts/lanes.mjs` needs `'tests/acceptance/1918/'` in its `alone` list**: the files build cargo binaries (deep-show
three times) and run long scenarios. This README is the instruction; the implementer makes that edit.

`BASE-FAILURE.txt` is the run at the base.
