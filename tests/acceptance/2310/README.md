# Acceptance tests for #2310: joints of one tree as one articulation, a chain that carries a load a hundred times a link's mass and never opens

Written first, blind, from issue #2310 as saved for the job on November 19, 2026 (its opening paragraph, Scope, seven
acceptance criteria, Proof line, Runs on line and dependencies; it has no comments and no Oracle line), the design's
physics sections and base commit `85203f458` ("Merge pull request #2852 …"), by a job that never saw an
implementation, a diff of one, or any other worktree, branch, stash or pull request. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test
per criterion clause that needs its own run, plus the planted wrappers, the planted check, the planted checkpoint and
the test backend the criteria name.

## Files, one per criterion

| File | Criterion | Tests |
|---|---|---|
| `ac1-hung-chain.test.ts` | `#2310.e54abd92`: the chain hung with a 10 kg bob never opens 0.1 mm and its bob stays 1.05 m from the fixed point; the new fixture is in the kit; the planted wrapper that builds the joints as separate ones opens a joint 17.5 mm | 3 |
| `ac2-swung-chain.test.ts` | `#2310.4ec9a54e`: the 100 kg chain let go level passes its lowest point at 4.539 m/s and never opens; the 10 kg chain's bob writes `hit` at a wall and stays within 1 mm of where it touches; the swing is in the kit; the planted wrapper's chain falls apart | 4 |
| `ac3-kit-fixtures.test.ts` | `#2310.7b0715e2`: the kit's pendulum, hinge limit and hinge motor hold on articulated joints, and the kit runs them a second time; the planted wrapper that drops limits passes 30.5° | 3 |
| `ac4-trees.test.ts` | `#2310.96ed9c5c`: the square is refused naming the hinge that closes the loop and accepted with it separate; a body held twice and `breaks_at` are refused; the planted check that counts accepts the square | 3 |
| `ac5-written-pose.test.ts` | `#2310.df957af4`: a body written 45° from straight down starts and stays there; written 2 mm off it is refused naming the joint and the gap; the planted wrapper starts it straight down | 3 |
| `ac6-hand-and-torso.test.ts` | `#2310.d9ba72ca`: the hand and the torso on articulated joints raise no `physics.mass_ratio` and never open, and raise it on separate ones; the test backend without articulations refuses the world | 2 |
| `ac7-seek-golden-merge-base.test.ts` | `#2310.648e6d3e`: the 10 kg chain sought from each checkpoint; its golden on Linux x86_64 and in wasm32; step hashes of worlds with no articulated joint against the merge base's; the planted checkpoint | 4 |
| `helpers.ts` | the worlds, the judges and the runner, over `../191/helpers.ts` (imported read only) | |
| `twins.json` | each criterion's ID to its planted names | |
| `BASE-FAILURE.txt` | each file run once at the base | |

## What was read

- The issue as saved for the job (title, state and body), and its body alone for the criterion IDs, each worked as
  `scripts/proof-change.mjs`'s `criterionId` works it and found equal to the ID its tests carry. The job read no
  issue tracker, so the epic #97 and the issues #523, #191 and #132 are known here through their suites and the
  design only.
- `docs/canvas-primitives.md`: Units and axes; World and backend `physics.world@1`; Shape; Body `body@1`; Contact
  material; Collision group; Joint `joint@1`; Input track entries; Occurrence list; Physics output; Checkpoint ring;
  Bake; Golden; Physics: behavior kit. `docs/technical-design.md`: The physics module (World; Joint and force; Soft
  body and checkpoint ring; Input, occurrence, output; Bake and golden; Behavior kit); Criteria to tests; Criteria in
  a checked shape; Wrong programs; Dogfooding; Built to be hard to get wrong. AGENTS.md and CONTRIBUTING.md.
- At the base, for surfaces only: the suites `2243/` (all of it, the model for this one), `523/` (README, helpers,
  ac3, ac4, ac7, `twins.json`), `191/` (README, helpers, ac3, ac4), `2241/` (README, helpers, ac4, ac5,
  `BASE-FAILURE.txt`), `522/` (helpers, ac1, ac7, `twins.json`), `2012/` (helpers, ac1, ac3), `2010/` and `2009/`
  (helpers), `182/` (ac5) and `251/` (ac5's golden test); `crates/deep-physics-rapier` (`main.rs`, `planted.rs`,
  `joints.rs`, `lib.rs` where joints and bodies are built and states are read, `runner.rs`'s `check`, `bake` and
  `golden` replies, `runner/kit.rs`, `runner/replay.rs`, `runner/timeline.rs`'s `seek`, `build.rs`, `Cargo.toml`);
  `crates/deep-canvas-physics` (`caps.rs`, `check.rs`, `doc.rs`'s joint reader, `backend.rs`'s states, `kit.rs`, `kit/fixtures.rs`'s
  pendulum and hinges, `bake.rs`'s key, `occurrence.rs`'s rows); `scripts/proof-change.mjs`, `scripts/proof-runs.mjs`
  (`twins.json`), `scripts/physics-wasm32.mjs`, `scripts/lease`, `scripts/lanes.mjs` (its `alone` list).
- Nothing outside those inputs was read. The pinned engine's source was not read: no test here asks the base's
  backend anything the base's runner doesn't already answer.

## What the base already does

These tests don't credit any of it to the work (`BASE-FAILURE.txt` has the runs and the numbers).

- `articulated` is no field of `joint@1`: the reader refuses a joint that writes it with `unknown_field` at
  `joints/<ID>/articulated`, in `check`'s `issues` and as a bake's, a seek's or a golden's `{"ok": false, "issues"}`.
  So every world of this issue is refused at the base, and every test here fails there for that, or because the base
  holds none of this suite's five planted names, its test backend, its five fixtures, its two issue codes or its cap.
- With `articulated` left out, every world here is accepted, bakes and reads as the issue's opening paragraph says,
  so the worlds are well formed and the measure of a joint's opening reads what the issue reads. The chain: hung with
  a 1 kg bob a joint opens 2.73 mm and let go level 11.81 mm; with 10 kg, 17.52 mm (`joint_02`, step 25) and
  28.81 mm; with 100 kg let go level its joints open up to 3.23 m and its bob passes its lowest point at 3.51 m/s.
  That is what criteria 1 and 2 say their planted wrapper does, and each twin test's own logic was run on it.
- The 10 kg chain on separate joints, swung into the wall, already writes `hit` naming the wall (step 78, 4.46 m/s)
  and its bob's centre is at most 0.37 mm past where it touches; its joints open, which is what fails the wall's test
  on the planted wrapper.
- On separate joints the kit's three worlds read 2.0109 s, 30.000° and 89.995°/s; a hinge whose body is written 45°
  from straight down starts and stays there, and one written 2 mm off its anchor is accepted, 2 mm open as built; the
  square with all four hinges separate, a body held by two separate joints and `breaks_at` on a separate joint are
  accepted.
- The hand and the torso on separate joints raise `physics.mass_ratio` naming `wrist`, `hand`, `torso` and 200, as
  #523's criterion 7 says, and `wrist` opens 15.42 mm (7.65 mm once at rest). The issue's opening paragraph prints
  14.14 mm for "#523's own hand … under a 40 kg torso" and doesn't say how that probe's hand is held; no variant of
  this world tried here reads 14.14 mm, and no test depends on it (Readings).
- The chain let go level on separate joints seeks from each of its eight checkpoints with the straight run's states
  and step hashes; its golden recorded by the release build replays PASS here on the release build and on the debug
  `test-backends` build, under one key and digest, and a replay shifted one ulp at step 240 differs first there. A
  world with no articulated joint has the merge base's step hashes, the merge base being the base itself.
- `deep-physics` checks, bakes, seeks, records and replays goldens, answers `backend`, `behavior_fixtures` and
  `behavior_kit` (64 fixtures, `pendulum_period`, `hinge_limit` and `hinge_motor` among them, each with `caps: []`),
  takes `--planted <name>` and, in a `test-backends` build, `--backend <name>`; a name it doesn't know answers
  `{"ok": false, "code": "bad_input"}` and exits 2. `backend`'s `caps` on the reference backend are `ccd`,
  `soft_bodies`, `character_controller`, `vehicle_controller` and `belts`.

## Run them

```sh
npm ci                          # once, if node_modules is missing
# the builds first, each through the one build slot:
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  nice -n 10 sh scripts/lease cargo build --locked -j 6 --release -p deep-physics-rapier --bin deep-physics
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  nice -n 10 sh scripts/lease cargo build --locked -j 6 -p deep-physics-rapier --bin deep-physics --features test-backends
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/2310 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2310/tsconfig.json   # type-check
rm -rf tests/acceptance/2310/node_modules                                     # vitest's cache
```

| File | Builds (each once per file, copied out of the target folder) |
|---|---|
| all seven | `cargo build --locked --release -p deep-physics-rapier --bin deep-physics` (#191's `release`); the planted names and the kit run on it |
| `ac6` | also `cargo build --locked -p deep-physics-rapier --bin deep-physics --features test-backends` (#191's `test`, a debug build), for `--backend no_articulations` and the reference backend beside it |
| `ac7` | its golden test also builds the wasm32 library (`node scripts/physics-wasm32.mjs`) and, in the lane's pinned image run as linux/amd64, `cargo build --locked --bin deep-physics` under `target/acceptance-2012-linux/amd64/` (#2012's `onLane`; more than an hour under emulation the first time); its merge-base test also builds the release build of `git merge-base HEAD origin/main`, exported by `git archive` into `target/acceptance-191-base/<sha>` (#191's `mergeBasePhysics`) |

The suite's own cargo calls find the first two builds made and only bring them up to date and copy them. Every test
passes #191's 60-minute timeout, the merge-base test four times that and the golden test #2012's three hours for a
test with a container leg; this suite's own hooks pass the 60 minutes, and each file's build hook is #191's, 4 hours.
Node built-ins and vitest only; `../191/helpers.ts` and, in `ac7`, `../2012/helpers.ts` (with the `2010/` and `2009/`
helpers it re-exports) are imported read only. No network but what the container's first build fetches into its
cache. No process is started but `cargo`, `git`, `tar`, `node`, `docker` and `deep-physics`, each waited for; none is
stopped by name or port, and one that outlives its limit is stopped through the child the test started. A process
that can't start fails its test with `BLOCKED:`, one that doesn't finish or a run short of its states or hashes with
`INCONCLUSIVE:`; a host that isn't macOS on arm64, a missing container runtime or image, or no merge base to build is
`BLOCKED:`. Nothing unrun passes. Temp folders (the copied binaries, each bake's store, the copy of the merge base's
binary) are removed after their test or file. No test times anything, so none depends on the machine or its load.

## The surface under test

The issue names the joint field (drafted), `physics.mass_ratio`, `physics.backend_cap`, `caps()`, `hit` and what each
wrong program does. It names no call, no other issue code, no cap, no fixture, no planted program and no test backend.
These tests drive `deep-physics` as #191, #522, #523, #2010 and #2241 left it: one JSON object per stdin line, one
reply line each. **Every name below marked *(ours)* is this job's choice**, the least the criteria need, named after
what the issue says the thing does; the implementer builds exactly these, or a dispute goes to a blind redraft.
Everything else is the base's and must stay as it is.

### The document field

`joints.<ID>.articulated: true`, the name the issue drafts, on a `ball` or a `hinge` joint here. The tests write
`true` or leave the field out (a separate joint, as the base builds every joint); they never write `false`. Example:

```json
"joints": {"joint_01": {"kind": "ball", "a": "world", "b": "link_01",
                        "frame_a": {"anchor": [0, 0, 0]}, "frame_b": {"anchor": [0, 0.05, 0]}, "articulated": true}}
```

### Calls and reply fields (all the base's)

| Call, as the tests write it | Reply fields the tests read |
|---|---|
| `{"call": "check", "world": World}` | `{"ok": true, "issues": [{"code", "severity", "path", "actual", "what", "ids", "ratio"?}]}`; a world is accepted when no issue has `severity: "error"` |
| `{"call": "bake", "world": World, "steps": 480, "read": [every body ID]}` (the seek adds `"store": dir, "checkpoints": true`; a kit fixture's bake adds its `"track"`) | `{"ok": true, "bodies": {ID: [State × 481]}, "occurrences": [Row], "step_hashes": [16 hex × 481], "checkpoints": [{"step", …}]}`; `State` is `{"pos": [3], "rot": [x, y, z, w], "linear": [3], "angular": [3, deg/s]}`, index k the state after step k, index 0 the world as built; a `Row` is `{"step", "kind", "a", "b", …}`. A refused world answers `{"ok": false, "issues": […]}` |
| `{"call": "seek", "world", "steps": 480, "store": dir, "to": c, "play": 480 − c, "read": [every body ID]}` | `{"ok": true, "from": c, "bodies": {ID: [State]}, "step_hashes": [16 hex]}`, one of each from step `from` to 480 |
| `{"call": "golden", "world", "steps": 480, "store": dir, "verify_on": ["x86_64-unknown-linux-gnu", "wasm32-unknown-unknown"]}` | `{"ok": true, "golden": {"bake_key", "runtime_digest", "machine": {"os", "arch", …}, "step_hashes", "record_on", "verify_on", …}}` |
| `{"call": "golden_verify", "golden", "world", "steps": 480}`, and the same with `"shift": {"step": 240, "id": "bob", "field": "linear.x", "ulps": 1}` | `{"ok": true, "verdict", "target", "machine", "machines", "bake_key", "runtime_digest", "step_hashes", "report": {"first_step"}}`, as #2012's `matchFailures` and `shiftedFailures` read them |
| `{"call": "backend"}` | `{"ok": true, "backend": name, "caps": [cap]}` |
| `{"call": "behavior_fixtures"}` | `{"ok": true, "fixtures": [{"name", "world", "steps", "track", "answer", "tolerance", "caps"}]}` |
| `{"call": "behavior_kit"}` | `{"ok": true, "results": [{"backend", "fixture", "result", "measured", "answer", "tolerance", "what"}]}` |

Flags, as at the base: `deep-physics --planted <name>` on the release build, `deep-physics --backend <name>` on the
`test-backends` build. With a name it knows the process exits 0 and answers every call.

### The refusals and the lint

Each is an issue of the check with `severity: "error"`, shaped as the base's are. An issue **names a joint by its
`path`**: `joints/<ID>`, or a path under it such as `joints/<ID>/articulated`; it names a field by the field's path.

| Code | What it refuses | What the tests hold it to |
|---|---|---|
| `physics.articulation_tree` *(ours)* | an articulated joint that makes a body the `b` of two articulated joints, or that closes a loop of them | its `path` names the joint: of two that hold one body, the second in canonical (ID) order; of a loop, the last in canonical order, the one that closes it. No issue of this code names another joint of the world |
| `physics.articulation_gap` *(ours)* | an articulated joint whose two anchors are more than 1 mm apart as written | its `path` names the joint, and its `actual` is the gap in metres, a number within 0.01 mm of it (`0.002` for 2 mm) |
| any code | `breaks_at` on an articulated joint | an error whose `path` is exactly `joints/<ID>/breaks_at` |
| `physics.backend_cap` (the base's) | an articulated joint on a backend whose `caps()` list no articulations | its `path` names an articulated joint, and its `what` holds the backend's name, as the base's caps refusals do |
| `physics.mass_ratio` (#523's, a warning) | nothing for an articulated joint | none in the `issues` of a world whose joints are articulated; for the same world on separate joints one issue naming `wrist`, `hand`, `torso` and the ratio 200, read as #523's suite reads it |

```text
the square                 {"code": "physics.articulation_tree", "severity": "error", "path": "joints/corner_4", …}
load, the b of two         {"code": "physics.articulation_tree", "severity": "error", "path": "joints/hold_2", …}
arm, written 2 mm off      {"code": "physics.articulation_gap", "severity": "error", "path": "joints/hinge", "actual": 0.002, …}
breaks_at on rod           {"severity": "error", "path": "joints/rod/breaks_at", …}
on no_articulations        {"code": "physics.backend_cap", "severity": "error", "path": "joints/wrist/articulated",
                            "what": "no_articulations 0.36.1 …", …}
```

### The cap

`articulations` *(ours)*, a cap name in `backend`'s `caps`: the reference backend lists it
(`{"backend": "rapier3d", "caps": [… "articulations"]}`), `no_articulations` doesn't, and each of the five fixtures
below names it in its `caps`.

### Planted wrong programs

Each is `deep-physics --planted <name>` on the shipped build (the base's way of starting a wrong program), changing
nothing but what its row says. Its process must exit 0 and answer; the judge that passes the real program must fail
on what it answers, naming what the criterion says. `twins.json` maps each criterion's ID to its planted names.

| Name | Criteria | The wrong program | What it answers, and what the judge's failure names |
|---|---|---|---|
| `articulated_built_separate` *(ours)* | 1, 2 | the wrapper builds every articulated joint as a separate constraint between its two bodies, as the base builds every joint | the hung 10 kg chain's widest opening is 17.5 mm, within 0.05 mm; a failure starts `<joint>: step <first step it is open at>: ` and holds `<widest> mm at the most, at step <step>`. The 100 kg chain let go level has a joint's anchors more than 0.1 m apart; the first of the open joints' failures starts `<first joint to open>: step <step>: `. The wall's judge fails too |
| `articulated_drops_limits` *(ours)* | 3 | the wrapper builds an articulated joint without its `limits` | the limited hinge's bar turns past 30.5°; a failure starts `pin: ` and holds its largest angle |
| `articulated_tree_counts_only` *(ours)* | 4 | the check of the articulated joints' trees only counts joints against bodies | the square's `check` answers no error at all (four hinges, four bodies); a failure starts `corner_4: ` |
| `articulated_starts_at_zero` *(ours)* | 5 | the wrapper leaves every articulated joint at coordinate 0, whatever poses the document writes | after step 1 `arm` is within 0.1 mm of (0, −1, 0) m from the hinge; a failure starts `arm: ` |
| `checkpoint_drops_joint_coordinates` *(ours)* | 7 | a restore leaves the articulated joints' coordinates out of what it loads | the bake and its checkpoints are the real program's; some seek's states differ from the straight run's, and the first failure reads `the seek from the checkpoint at step <c>: step <k>: <body> <pos, rot, linear or angular> is …` |

Example: `deep-physics --planted articulated_built_separate`, fed the hung chain's bake call.

### The test backend

`deep-physics --backend no_articulations` *(ours)*, in the `test-backends` build only, as #2241's `no_belts` is:
Rapier with articulations left out of its `caps()`, under a name of its own.

- `backend` answers `{"backend": "no_articulations", "caps": […]}` with no `articulations` in `caps`.
- `check` of the hand and the torso with both joints articulated answers an error `physics.backend_cap` whose `path`
  is under `joints/grip` or `joints/wrist` and whose `what` holds `no_articulations`.
- `check` of the same world with `articulated` left out of both joints answers no error. The worlds here write no
  `backend` field, so nothing else refuses them on it.

### The fixtures in the behavior kit

Five join `behavior_fixtures` and `behavior_kit` once each. Every joint of each one's world is written
`articulated: true`, each world is at 120 Hz, 4 substeps and g = 9.81 m/s², and each names `articulations` in `caps`.

| Name | Answer, as printed | Tolerance | Its world |
|---|---|---|---|
| `articulated/loaded_chain` *(ours)* | 1.05 (m) | `{"m": 0.0001}` | eleven dynamic bodies, ten of 0.1 kg and a bob of 10 kg that is one sphere of radius 0.05 m; eleven ball joints in one line from the world through the ten links to the bob, each one's anchors together as written, a link's two anchors 0.1 m apart, the bob's centre written 1.05 m from the fixed point; gravity along the chain as written; `steps` at least 480 |
| `articulated/swing` *(ours)* | √(2 × 9.81 × 1.05) = 4.539 (m/s) | `{"relative": 0.01}` | the same chain with a bob of 100 kg; gravity square to the chain as written; `steps` at least 480 |
| `articulated/pendulum_period` *(ours)* | 2.010 (s), `pendulum_period`'s | `{"relative": 0.01}` | one ball joint from the world to the one dynamic body, a sphere of 1 kg written 1 m from its anchor, 10° from hanging, at rest |
| `articulated/hinge_limit` *(ours)* | 30 (°), `hinge_limit`'s | `{"deg": 0.5}`, never past | one hinge from the world to the one dynamic body, `limits: {min: -30, max: 30}`, under gravity |
| `articulated/hinge_motor` *(ours)* | 90 (°/s), `hinge_motor`'s | `{"relative": 0.01}` | one hinge from the world to the one dynamic body, with a velocity motor whose `target` is 90 |

An answer is matched within 0.0005 of the issue's (its closed form, so 4.539 and 4.5388 both count); each of the last
three also equals its fixture on a separate joint, number for number, with the same tolerance. A mass is the body's
declared `mass`, or its sphere, box, capsule and cylinder shapes' volumes times their materials' densities, within
0.1%. The fixtures' body and joint IDs and what each measure is called are the implementer's. On the reference
backend each reads one row, `result: "pass"`, the row's `answer` and `tolerance` the interface's, and `measured`
within the tolerance of the answer (for the hinge limit, not past 30.5); `pendulum_period`, `hinge_limit` and
`hinge_motor` still pass beside them. Each fixture's own world, baked over its own `steps` and `track`, must pass the
judge its criterion's test uses, read from its world document: the chain's bob is its heavy sphere and its fixed point
the world end of the joint that holds a body to the world; a pendulum's period is read under its anchor from the side
it is written on; a hinge's angle and turn rate are read about `frame_a`'s `axis`.

## The worlds

All in `helpers.ts`, at 120 Hz, 4 substeps and gravity (0, −9.81, 0) unless said, seed 2310, one contact material
`m` of friction 0.5, restitution 0 and density 1,000 kg/m³, every other field left to the world's defaults. The IDs
are this suite's; a judge's failure names them.

- **The chain** (criteria 1, 2, 7). The fixed point is the origin. `link_01` to `link_10`, each declared 0.1 kg and a
  capsule 0.1 m long on its local Y (half height 0.04 m, radius 0.01 m), hang in a line below it; `bob`, a sphere of
  radius 0.05 m declared 1, 10 or 100 kg, hangs below the last with its centre at (0, −1.05, 0). `joint_01` is a ball
  joint from the world to the top of `link_01`, `joint_02` to `joint_10` each from the bottom of a link to the top of
  the next, `joint_11` from the bottom of `link_10` to the top of `bob`; all eleven are `articulated: true`.
  `checkpoint: {every: 60}`. These shapes are the issue's probe's: with `articulated` left out the base reads its
  2.73, 11.81, 17.52 and 28.81 mm on them.
  - **Hung**: as above, the 10 kg bob.
  - **Let go level**: gravity (9.81, 0, 0), square to the chain as written, so its lowest point is where the bob's
    centre crosses y = 0, at (1.05, 0, 0); the 100 kg bob for criterion 2, the 10 kg bob for criterion 7.
  - **Swung into the wall**: the 10 kg chain let go level, and `wall`, a static box of half extents
    (0.2, 0.1, 0.2) m centred at (1.22, 0.15, 0): its lower face is the plane y = 0.05 over x 1.02 to 1.42 m, so the
    bob's surface meets it as its centre passes its lowest point, moving along +Y at about 4.5 m/s, and a chain that
    hasn't stretched keeps every link clear of it.
- **The kit's three** (criterion 3), each the base kit's world with its joint articulated: `bob`, a 1 kg sphere on
  the ball joint `rod` to the world at (0, 2, 0), written 1 m from it and 10° toward +X; `bar`, a 1 m box held level
  at one end by the hinge `pin` to the world at (0, 2, 0), about +Z with `limits: {min: -30, max: 30}`, or about +Y
  with `motor: {mode: velocity, target: 90, max_torque: 1000, hz: 10}`. `sleep: false` on each body.
- **The square** (criterion 4): bars `side_1` to `side_4`, 1 m each and 1 kg, around the corners (0, 0), (1, 0),
  (1, 1) and (0, 1), each turned 90° more about +Z than the one before. Hinge `corner_i`, about +Z, joins the far
  end of `side_i` (its `a`) to the near end of the next side (its `b`), and `corner_4` joins `side_4` back to
  `side_1`: every body is the `b` of exactly one hinge, every hinge's anchors are together, and the four close a loop.
  **Held twice**: bars `left`, `load` and `right` in a row, the hinges `hold_1` (`a: left`) and `hold_2`
  (`a: right`) both with `b: load`, both articulated. **`breaks_at`**: the pendulum's `rod`, articulated, with
  `breaks_at: {force: 1000, over_steps: 1}`.
- **The written pose** (criterion 5): no gravity; `arm`, a 1 kg sphere on the hinge `hinge` to the world at the
  origin, about +Z, `frame_b.anchor` (0, 1, 0), so at coordinate 0 it hangs at (0, −1, 0). It is written with
  `rot: [0, 0, 45]` and its centre at (sin 45°, −cos 45°, 0), its anchors together. Written 2 mm off: the same,
  its centre 1.002 times as far from the hinge along the same line.
- **The hand and the torso** (criterion 6): #523's shapes, masses and material. `hand`, a box 0.1 × 0.1 × 0.02 m of
  density 1,000 kg/m³ with no declared mass (0.2 kg), hangs from the world at the origin by the ball joint `grip` at
  its top; `torso`, a box 0.3 × 0.6 × 0.2 m declared 40 kg, hangs from the hand's bottom by the hinge `wrist` about
  +X (`a: hand`, `b: torso`).

A joint's opening is the distance between its two anchors: for an end that is a body, its position plus its
`frame`'s anchor turned by its rotation, both from the bake's state of that body; for the world, the anchor itself.

## The tests

IDs are `scripts/proof-change.mjs`'s; each `describe` and `it` title starts with its criterion's ID. Every bake of a
chain is 4 s, 480 steps, and is judged at every state from the world as built to step 480.

| File | Test | What fails it |
|---|---|---|
| `ac1-hung-chain` | hung | a joint whose anchors are more than 0.1 mm apart at a step (the failure names the joint and the first such step); the bob's centre not 1.05 m from the fixed point within 0.1 mm at a step |
| | kit | `articulated/loaded_chain` not in the kit's data as the table says; its row on rapier3d not as the table says; its own world, baked, failing the judge above |
| | twin: `articulated_built_separate` | the process not exiting 0; the judge finding nothing wrong; its widest opening not 17.5 mm within 0.05 mm; no failure naming that joint, the step it first opens at and the step it is widest at |
| `ac2-swung-chain` | 100 kg let go level | the bob's speed at the step nearest where its centre crosses the line through the fixed point along gravity not 4.539 m/s within 1%; the bob never crossing it; a joint open more than 0.1 mm at a step |
| | wall | no `hit` row between `bob` and `wall`; the bob's centre more than 1 mm nearer the wall's box than its radius at a step; a joint open more than 0.1 mm at a step |
| | kit | `articulated/swing` not in the data or the report as the table says; its own world, baked, failing the first test's judge |
| | twin: `articulated_built_separate` | the process not exiting 0; the judge finding nothing wrong; no joint's anchors more than 0.1 m apart; the first open joint's failure not naming the first joint to open and its step; the wall's judge finding nothing wrong |
| `ac3-kit-fixtures` | three bakes | the ball's period (the time between its first two crossings under its anchor from +X, over 4 s) not 2.010 s within 1%; the bar's largest turn about +Z in 2 s past 30.5°, or short of 29.5°; the bar's turn rate about +Y after step 60 not 90°/s within 1% |
| | kit | any of the three fixtures not in the data or the report as the table says, or with another answer or tolerance than its fixture on a separate joint; a fixture on a separate joint not passing; any one's own world, baked, failing the judge above |
| | twin: `articulated_drops_limits` | the process not exiting 0; the judge finding nothing wrong; its largest angle not past 30.5°; no failure starting `pin: ` that holds that angle |
| `ac4-trees` | square | no `physics.articulation_tree` error at `joints/corner_4`, or one at another corner; an error on the square with `corner_4` separate; that world's bake of 1 s refused, short of 121 states or hashes, or with a step hash that repeats the step before's |
| | held twice, `breaks_at` | no `physics.articulation_tree` error at `joints/hold_2`, or one at `joints/hold_1`; no error at `joints/rod/breaks_at`; an error on `rod`, articulated, with `breaks_at` left out |
| | twin: `articulated_tree_counts_only` | the process not exiting 0; an error on the square; the judge finding nothing wrong; no failure starting `corner_4: ` |
| `ac5-written-pose` | starts there | `arm` more than 0.1 mm from (0.7071, −0.7071, 0) m after a step from 1 to 120 |
| | 2 mm off | no `physics.articulation_gap` error at `joints/hinge`, or none whose `actual` is 0.002 within 0.00001; an error on the world with its anchors together |
| | twin: `articulated_starts_at_zero` | the process not exiting 0; the judge finding nothing wrong; `arm` not within 0.1 mm of (0, −1, 0) m after step 1; no failure starting `arm: ` |
| `ac6-hand-and-torso` | articulated and separate | an error on the world with both joints articulated; a `physics.mass_ratio` in its issues; a joint open more than 0.1 mm at a step of its 4 s; no `physics.mass_ratio` naming `wrist`, `hand`, `torso` and 200 on separate joints |
| | `no_articulations` | `--backend no_articulations` not running; its manifest's name not its own, or its `caps` listing `articulations`; the reference backend's `caps`, in the same build, not listing it; no `physics.backend_cap` error at `joints/grip` or `joints/wrist` whose `what` holds `no_articulations`; an error on the world with both joints separate on it; an error on the articulated world on the reference backend in the same build |
| `ac7-seek-golden-merge-base` | seek | the chain let go level not baking into a store; fewer than two checkpoints inside its 4 s; a step hash that repeats the step before's; a seek that restored another step than its checkpoint; a state or a step hash after it that isn't the straight run's |
| | twin: `checkpoint_drops_joint_coordinates` | the process not exiting 0, or not baking; every seek equal to the straight run; a first failure that doesn't name the checkpoint, the first step that differs, the body and its field |
| | golden | a host that isn't macOS on arm64 (`BLOCKED:`); the golden not recorded, or not naming macOS, aarch64 and the two targets; this Mac's replay, the wasm32 replay or the Linux x86_64 replay not PASS under the golden's key and digest with its 481 step hashes, or not on its target and machine; a replay shifted one ulp at step 240 not differing first there |
| | merge base | a world with no articulated joint not baking here; the chain on articulated joints refused, or with the step hashes of the same chain on separate joints; no merge base to build (`BLOCKED:`); a step hash of one of the four worlds differing from the merge base's |

Test count: 3 + 4 + 3 + 3 + 3 + 2 + 4 = 22. `BASE-FAILURE.txt` is the run at the base: all 22 fail at an assertion
in their own file.

The four worlds held to the merge base's step hashes: the 10 kg chain let go level, the hand and the torso, the hinge
limited to ±30° and the hinge motor, each with `articulated` left out, so the wrapper's ball joints, hinges, limits and
motor are each stepped as the merge base steps them.

## Readings where the issue and the design leave a choice

- **The field** is `articulated`, as drafted. Only `ball` and `hinge` joints are written; the issue's `fixed` and
  `slider` have no criterion.
- **"No joint's two anchors are more than 0.1 mm apart at any step"** and **"no joint opens 0.1 mm"**: every joint of
  the world, at the world as built and after every step; a gap that isn't a number counts as open.
- **"Opens a joint 17.5 mm"**: the widest opening of any joint over the 4 s, read to half a unit of that last digit.
  **"Naming the joint and the step"**: the judge's own failure line, as #2243's twins are held; it names the step
  the joint first opens at and the step it is widest at, since the issue doesn't say which.
- **"Gravity turned square to it"**: the same document with gravity along +X, so the chain is written at rest and
  level. **"Passes its lowest point at"**: the bob's speed at whichever of the two steps around the crossing is nearer
  the line through the fixed point along gravity; a step's travel changes that speed by under 0.1%.
- **"Swung into a static wall"**: the issue doesn't place the wall. It stands where the bob passes its lowest point,
  its face square to the bob's travel there, and narrow enough that only the bob reaches it. **"Never more than 1 mm
  past the place where it touches"**: the bob touches the wall where its centre is its radius from the wall's box, so
  its centre is never nearer the box than its radius less 1 mm, at any step of the 4 s; this holds at the face and at
  its edge alike. **"Writes `hit` naming the wall"**: a `hit` row whose `a` and `b` are `bob` and `wall`.
- **The wall's test also holds every joint to 0.1 mm.** The Scope says an articulated joint's "anchors never part",
  and the criteria's bound for that is 0.1 mm. Without it the test would pass on the planted wrapper, whose bob also
  hits the wall and stops (What the base already does).
- **"Falls apart"**: a joint's anchors farther apart than a link is long, 0.1 m. **"The first joint to open"**: the
  joint whose anchors are first more than 0.1 mm apart, the earlier in canonical order on a tie.
- **Criterion 3's worlds** are the base kit's three with the joint articulated and the ball declared 1 kg, as the
  criterion says (the base's ball is 0.52 kg by its density). **"Never past 30.5°"**: the bar's largest turn about
  the hinge's axis from where it was built, read from its rotation; a bar that never comes within 0.5° of its limit
  fails too, since the bound is of a hinge its limit holds. **"After 0.5 s"**: the state after step 60, as the base's
  fixture measures it. **"Naming the joint and its largest angle"**: the judge's failure line.
- **"Runs its pendulum, hinge limit and hinge motor a second time"**: three more fixtures, each with its separate
  fixture's answer and tolerance. **"The loaded chain and the swing"**: criterion 1's and criterion 2's first worlds.
  Each fixture has one answer: the loaded chain's is the bob's 1.05 m within 0.1 mm, the swing's 4.539 m/s within 1%;
  the joints' openings are held by baking the fixture's own world. That a fixture on an articulated joint names
  `articulations` in `caps` follows from the design: a fixture its `caps()` exclude is never run.
- **"The hinge that closes the loop"** and **"naming the second"**: by canonical (ID) order, in which the design
  builds a world: `corner_4` and `hold_2`. The refusal names that joint alone. The square is a pure ring, each body
  the `b` of one hinge, so a check that counts four hinges against four bodies accepts it.
- **"Accepted and steps"**: the check raises no error, and a bake of 1 s holds every body's 121 states and a step
  hash that changes with every step, the square falling.
- **"Refused, naming the field"**: an error at `joints/rod/breaks_at`, whatever its code. **"Naming the joint and the
  2 mm"**: the joint by `path`, the gap as `actual` in metres. The two new codes are this job's; without a code the
  base's own `unknown_field` at `joints/<ID>/articulated` would read as naming the joint.
- **"45° from straight down"**: straight down is the hinge's coordinate 0, the body hanging at (0, −1) m.
  **"Starts the body straight down"**: within 0.1 mm of (0, −1, 0) m after step 1.
- **"Raises no `physics.mass_ratio`"** is held with "accepted": a refused world raises no lint either. **"A world
  with an articulated joint"** on the test backend is the hand and the torso, both joints articulated; an issue for
  either joint counts, and one for each is what the base's caps refusals do.
- **"The 10 kg chain's bake"** in criterion 7 is the 10 kg chain let go level, a world the issue's opening paragraph
  names. The hung chain never moves: its joints stay at the coordinates it is built with and its step hash repeats,
  so a seek of it, and a checkpoint without coordinates, would show nothing. **"Seeked from each checkpoint"**: each
  checkpoint the bake lists with `checkpoints: true`, the one at step 480 included. **"Naming the first step and the
  body"**: the first step whose states differ and the first body in canonical order there, with its field.
- **"Its golden recorded on macOS arm64 matches"**: recorded by the release build, replayed by `golden_verify` with
  verdict PASS under the golden's key and digest, its own 481 step hashes the golden's, on each target. The legs'
  builds are debug builds; at the base a golden recorded by the release build replays on the debug build here.
- **"Byte-identical to the merge base's"**: the 16 hex digits of every step hash, string for string. The test asserts
  first that these hashes see an articulation, so at the base it fails there and the merge base isn't built; the
  comparison itself was run at the base apart from the suite (`BASE-FAILURE.txt`).
- **`twins.json`** lists the five planted names. Criterion 6's wrong program is a test backend, reached through
  `--backend`, so it has no entry.

## Not asserted, because no criterion says so

`spring` and `active: false` on an articulated joint; `fixed` and `slider` joints, `collide_connected`,
`joint_coordinate` and `joint_force` on one; `articulated: false` written out; a gap between 0 and 2 mm, and the
1 mm bound itself; the new fixtures' rows on `no_articulations` (`excluded_by_caps`), the kit on wasm32, and any
kit row under a planted program; the `hit` row's point, speed and impulse, and rows between a link and the wall; the
`physics.fast_body` warnings a swinging link's bake carries; a checkpoint's `deep_hash`, `golden_cross`, and the
field a golden's report names; the issue's probe readings (0.01 mm, 2.0099 s, 30.000°, 89.93°/s, 14.14 mm); any
budget or timing; the design's text. Gear, rack, pulley and path joints inside an articulation, `distance` and
`rope` joints, a ragdoll's cones, 2D worlds and soft bodies are the issue's "Not in this task".

## What the implementer adds outside this folder

`'tests/acceptance/2310/'` in `scripts/lanes.mjs`'s `alone` list (the files build `deep-physics`, release and
`test-backends`, the wasm32 library, the lane's container build and the merge base's release build); this README is
the instruction, the implementer makes that edit:

```js
// #2310's files build deep-physics (release and test-backends), its wasm32 library, the lane's linux/amd64 build
// and the merge base's release build.
alone.push('tests/acceptance/2310/');
```

The field, the two issue codes, the cap, the five planted names, the test backend and the five fixtures above, in
the crates. Nothing in this folder changes.
