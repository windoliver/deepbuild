# Acceptance tests for #2308: small things at their true sizes, a solver length a world sets, and a lint that names a body too small for it

Written first, blind, from issue #2308 as saved for this job on November 19, 2026 (its opening paragraph, Scope, six
acceptance criteria, Proof line, dependencies and its one comment, a note about #2317), the design's physics sections
and base commit `85203f458` ("Merge pull request #2852 …"), by a job that never saw an implementation or a diff of
one; no other worktree, branch or pull request was read. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test per criterion, one more
where a clause needs its own run, and one per planted wrong program the criteria name.

## Files, one per criterion

| File | Criterion | Tests |
|---|---|---|
| `ac1-edge.test.ts` | `#2308.e596080e`: the 1 cm cube has dropped 0.5 mm before its centre is 1.6 sides past the table's edge; the planted wrapper that ignores `length_unit` has not until 2.09 sides and fails, naming the body and the step | 2 |
| `ac2-stack-bounce-slide.test.ts` | `#2308.1cbd6c33`: five 1 cm cubes end 4.5 sides up within 2% of a side, within 1% aside and under 1 mm/s through the third second; the 1 cm ball first bounces to 0.025 m and the 1 cm cube slides 0.05 m to rest, each within 3%; the planted wrapper that ignores `solver.contact_hz` leaves the stack more than half a side low and fails, naming the top body | 2 |
| `ac3-big-among-small.test.ts` | `#2308.3e70c06d`: a 1 m ball dropped 10 m first bounces to 2.5 m within 3% and a 1 cm cube sliding to rest from 0.2 m/s writes `rest` within the world's sleep time plus 2 steps; the planted speed cap reads the bounce more than 90% low and fails, naming the body; the planted sleep speed sleeps later and fails, naming the step | 3 |
| `ac4-dominoes.test.ts` | `#2308.567c906d`: ten dominoes pass 45° in order, the last between 0.6 s and 0.8 s, and at 4 s no two neighbours are more than 0.05 of a thickness inside each other; the planted wrapper that ignores `solver.contact_hz` leaves two more than 0.2 inside and fails, naming the pair | 2 |
| `ac5-small-body-lint.test.ts` | `#2308.762099ef`: `physics.small_body` of kind `unit` and of kind `soft` for a 1 cm die at the defaults, none of kind `unit` for a 5 cm cube, neither in the fixture's world; the planted lint that reads only a body's first shape misses a die whose thin shape is its second and fails, naming the body | 2 |
| `ac6-unwritten-keys-caps.test.ts` | `#2308.66a34a77`: with no `length_unit` the step hashes are the merge base's; two worlds that differ only in `length_unit` have different bake keys; the test backend that scales no lengths refuses `length_unit: 0.01`, naming the field and the backend; the planted check that reads only the field's range accepts it and fails | 4 |
| `helpers.ts` | the worlds, the runner and the judges, over `../191/helpers.ts` (imported read only) | |
| `twins.json` | each criterion's ID to its planted programs | |
| `BASE-FAILURE.txt` | each file run once at the base | |

## What was read

- The issue as saved for this job (title, state, body and its one comment); the criterion IDs are computed here from
  its body and match the ones the job was handed. `gh issue view` of #97 (the epic), #191, #2309 and #2317.
- `docs/canvas-primitives.md`: World and backend `physics.world@1`; Shape; Body `body@1`; Contact material; Physics
  output; Checkpoint ring; Bake; Golden; Physics: behavior kit; Units and axes; What holds a document to its rules (an
  issue's fields). `docs/technical-design.md`: The physics module (World; Shape, body, contact material, collision
  group; Bake and golden; Behavior kit); Who drafts it; Proven on the base; Criteria to tests; Wrong programs;
  Dogfooding; Tests written first. AGENTS.md and CONTRIBUTING.md.
- At the base, for surfaces only: `tests/acceptance/2309/` (all of it), `191/` (README, helpers, `ac1`), `2241/`
  (helpers, `ac4`, `ac5`), `2239/` (README, `twins.json`), `2306/` (README, `twins.json`), `2009/` (how its README
  and helpers read a refusal by caps); `crates/deep-physics-rapier` (`main.rs`, `planted.rs`, `lib.rs`'s `build`,
  `runner.rs`'s `check`, `bake` and issue, `runner/kit.rs`, `runner/contact.rs`, `runner/fast.rs`,
  `runner/vehicle.rs`'s `check`, `runner/live.rs`'s `twin`, `occurrences.rs`'s `rest`), `crates/deep-canvas-physics`
  (`doc.rs`'s `solver`, pose and body readers, `doc/shape.rs`, `check.rs`, `caps.rs`, `kit.rs`, `kit/fixtures.rs`,
  `fast.rs`'s issue, `backend.rs`'s `BodyState`); `scripts/proof-change.mjs` (criterion IDs), `scripts/proof-runs.mjs`
  (`twins.json`, what counts as failing at an assertion), `scripts/lanes.mjs`.
- The pinned backend's own source, which the issue cites: rapier3d 0.36.1's `src/dynamics/integration_parameters.rs`
  (what `length_unit` scales), `src/dynamics/rigid_body_components.rs` (a body's sleep threshold) and where the crate
  reads `length_unit`.

Nothing else was needed, and nothing else was read.

What the base already does, which these tests don't credit: `deep-physics` checks and bakes a world, lists
`physics.mass_ratio` beside a check's refusals, runs the behavior kit, takes `--planted <name>` and, in a
`test-backends` build, `--backend <name>`. Its reader refuses a field it doesn't know, so a world that writes
`solver.length_unit` is refused at check with `unknown_field` at `solver/length_unit`. Its wrapper never sets the
backend's `length_unit`. Its bake key is taken over the world document as written. Its kit holds no small fixture, its
check raises no `physics.small_body`, and it knows neither the test backend nor any of the six planted names.

## Run them

```sh
npm ci                          # once, if node_modules is missing
# the builds first, each through the one build slot:
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  nice -n 10 sh scripts/lease cargo build --locked -j 6 --release -p deep-physics-rapier --bin deep-physics
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  nice -n 10 sh scripts/lease cargo build --locked -j 6 -p deep-physics-rapier --bin deep-physics --features test-backends
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/2308 --no-file-parallelism --testTimeout=3600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2308/tsconfig.json   # type-check
rm -rf tests/acceptance/2308/node_modules                                      # vitest's cache
```

| File | Builds (each asked of cargo once per file, found made and copied out of the target folder) |
|---|---|
| `ac1` to `ac5` | `cargo build --locked --release -p deep-physics-rapier --bin deep-physics` (#191's `release`) |
| `ac6` | the same; `cargo build --locked -p deep-physics-rapier --bin deep-physics --features test-backends` (#191's `test`); and the merge base's release build (`git merge-base HEAD origin/main`), exported by `git archive` into `target/acceptance-191-base/<sha>` and built there (#191's `mergeBasePhysics`) |

Every test passes #191's 60-minute timeout (four times that for the merge-base test) and each file's build hook its
4 hours. Node built-ins and vitest only. No process is started but `cargo`, `git`, `tar` and `deep-physics`, each
waited for; none is stopped by name or port. No test times anything, so none depends on the machine or its load. No
cargo is `BLOCKED:`, and a reply that can't be read is `INCONCLUSIVE:`, each a failure, never a pass.
**`scripts/lanes.mjs` needs `'tests/acceptance/2308/'` in its `alone` list** (the files build cargo binaries, one of
them a second checkout's); this README is the instruction, the implementer makes that edit.

## The surface under test

The issue names the field (drafted), the lint and its two kinds, the refusal's code by `caps()`, the kit and the
worlds' settings, and no call or flag. These tests drive `deep-physics` as #191, #2009 and #2309 left it and add the
least the criteria need. Each name is marked: *(issue)* the issue's word, *(design)* the design's, *(base)* what the
base's suites already drive, and **bold** with *(ours)* this job's choice, which the implementer builds as written.

### Calls and flags, all *(base)*

| Call | Reply, as read here |
|---|---|
| `{"call": "check", "world": World}` | `{"ok": true, "issues": [Issue]}`: refusals of severity `error`, lints beside them |
| `{"call": "bake", "world": World, "steps": n, "read"?: [ID]}` | `{"ok": true, "bodies": {ID: [state]}, "occurrences": [{step, kind, a, …}], "step_hashes": [hash], "key": string, …}`; state k is the body after step k: `pos`, `rot` (a quaternion, x y z w), `linear`, `angular`. A refused world answers `{"ok": false, "issues": [Issue]}` |
| `{"call": "behavior_fixtures"}` | `{"ok": true, "fixtures": [{name, world, steps, answer, tolerance, …}]}` |
| `{"call": "behavior_kit"}` | `{"ok": true, "results": [{backend, fixture, measured, answer, tolerance, result, what, …}], …}` |
| `{"call": "backend"}` | `{"ok": true, "backend": name, "reference": bool, …}` |

`deep-physics --planted <name>` starts one wrong program; `deep-physics --backend <name>` (the `test-backends` build
only) runs a test backend; both may be given together.

### The field

`solver.length_unit` *(issue: "the name is drafted")*, a number of metres, 1 when unwritten: the length the backend
scales its own lengths by. Example: `"solver": {"contact_hz": 240, "length_unit": 0.01}`. A world that writes it bakes;
a world that writes none runs as at the merge base; two worlds that differ only in it have different bake keys.

### The refusals at check

```text
range   {"code": "out_of_range", "severity": "error", "path": "solver/length_unit", "actual": 0, …}
caps    {"code": "physics.backend_cap", "severity": "error", "path": "solver/length_unit", "actual": 0.01,
         "what": "no_length_unit …", …}
```

- `path` is **`solver/length_unit`** *(ours; the field as the reader's other refusals name fields, `solver/contact_hz`
  among them)*, and `actual` the value written there *(design)*.
- Out of its range, "at or below 0 or above 1" *(issue, Scope)*: **`out_of_range`** *(ours; the base's code for a
  number out of its range)*, one such issue for each of 0, −0.01 and 1.01. `length_unit: 1` is accepted.
- By `caps()`: `physics.backend_cap` *(issue, base)*, one such issue, whose `what` holds the backend's name *(base: how
  a refusal by caps names the backend)*.
- **`--backend no_length_unit`** *(ours)*: the test backend of criterion 6, in the `test-backends` build only: Rapier
  whose `caps()` say it scales no lengths, a candidate under its own name, as #2241's `no_belts` is. Its `backend`
  call answers `"backend": "no_length_unit", "reference": false`. On it `length_unit: 0.01` is refused as above; the
  reference backend of the same build accepts the same world.

### The lint, in a check's `issues`

```text
unit   {"code": "physics.small_body", "kind": "unit", "severity": "warning", "ids": ["die"],
        "extent": 0.01, "length_unit": 0.01, …}
soft   {"code": "physics.small_body", "kind": "soft", "severity": "warning", "ids": ["die"],
        "sink": 0.000552, "contact_hz": 50, "step_rate": 120, …}
```

- `code` `physics.small_body` *(issue)*, raised by **the `check` call** *(issue: "a lint run at check")*, beside
  `physics.mass_ratio`, for a world the check accepts.
- `kind` *(base: the field #2239 gave an issue)* with the values `unit` and `soft` *(issue)*; one issue per body and
  kind.
- `ids` *(design)* holds the body's ID alone. **`severity: "warning"`** *(ours)*: a lint, as the base's
  `physics.mass_ratio` is; the Scope says an unwritten world runs as it does today, so the lint refuses nothing.
- Kind `unit`: **`extent`** *(ours)*, the body's thinnest extent, m, the thinnest of any of its shapes (0.01 for a
  1 cm cube); **`length_unit`** *(ours; the field's own name)*, the length to set, the largest power of ten at or
  under that extent (0.01).
- Kind `soft`: **`sink`** *(ours)*, m, the issue's closed form 2 × g ÷ (2π × `contact_hz`)², 0.000552 m at the
  defaults, which prints as the issue's 0.55 mm; **`contact_hz`** *(ours; the field's own name)*, the least frequency
  that brings the sink under 2% of the extent, 50 Hz as the issue prints it (the exact bound is 49.85 Hz; a value from
  there to 50.5 is read as 50 Hz); **`step_rate`** *(ours; the field's own name)*, the least step rate that allows
  that frequency under #2309 and is not under the world's own, so **the world's own `step_rate`, 120, is how the issue
  names "no change"**.
- "Raises none of kind …" is a check that answers with no error and no such issue.

### The fixtures in the behavior kit

Five fixtures join `behavior_fixtures` and `behavior_kit`, each exactly once. All five names are *(ours)*. Each one's
`world` is the document under The worlds, field for field (key order free, numbers within 1e-12), and `steps` its run.

| `name` | `steps` | `measured`, m | `answer` | `tolerance` | Judged | A fail also carries |
|---|---|---|---|---|---|---|
| **`small_edge`** | 120 | how far past the table's edge (x = 0) the cube's centre is after the first step that leaves it 0.5 mm below where it was built | 0.016 (1.6 sides) | `{"m": 0}` | at most | `"body": "cube"`, `"step"` that step |
| **`small_stack`** | 1440 | how far below 4.5 sides, where it was built, the top cube's centre is after the last step | 0 | `{"m": 0.0002}` (2% of a side) | both ways | `"body": "cube5"` |
| **`small_bounce`** | 240 | how high the ball's lowest point is at the top of its first bounce | 0.025 | `{"relative": 0.03}` | both ways | |
| **`small_slide`** | 240 | how far the cube is from where it was built after the last step | 0.05, or its closed form 0.7² ÷ (2 × 0.5 × g) = 0.04995 | `{"relative": 0.03}` | both ways | |
| **`small_dominoes`** | 1920 | the most any two neighbours are inside each other after the last step: the least distance one box must move to stop overlapping the other | 0 | `{"m": 0.000375}` (0.05 of a thickness) | at most | `"bodies": [ID, ID]`, that pair |

- A row *(base)* is `{backend, fixture, measured, answer, tolerance, result, what, …}`; its `answer` and `tolerance`
  are the interface's. On the reference backend each of the five reads `pass`. `body` and `step` are the fields the
  base's fails already carry; **`bodies`** for a pair is the field #2243's meeting writes.
- The kit measures the bake: each row's `measured` is held within a micrometre of what this suite's own judge reads of
  the same world baked on the same program, the real one and the planted one alike.
- On a planted wrapper the criterion's fixture reads `fail`, its `what` naming the backend and the fixture *(design)*,
  with the fields of the last column: `small_edge` under `wrapper_ignores_length_unit`, `small_stack` and
  `small_dominoes` under `wrapper_ignores_contact_hz`.
- The stack's other clauses (within 1% of a side aside, under 1 mm/s through the third second) and the dominoes'
  (in order, the last between 0.6 s and 0.8 s) are held by this suite's judges on the same worlds' bakes. A kit's row
  may fail on them too; no test here needs it to.

### Planted wrong programs

Each is `deep-physics --planted <name>` on the shipped build *(base: its way of starting a wrong program)*, the real
program but for what its row says. Its process exits 0 and answers every call; the judge that passes the real program
fails on it, naming what the criterion says. Every name is *(ours)*; `twins.json` maps each criterion's ID to its names.

| Name | Criterion | The wrong program | Its failure |
|---|---|---|---|
| **`wrapper_ignores_length_unit`** | 1 | the backend wrapper leaves the backend's own length at 1 whatever `solver.length_unit` says; the document, the check and the key read the field as written. The cube keeps its contact with the table past the edge and has not dropped 0.5 mm until its centre is 2.09 sides past | names `cube` and the step it dropped, in the judge's sentence and in the kit's `small_edge` row (`body`, `step`), whose `measured` is that 0.0209 m |
| **`wrapper_ignores_contact_hz`** | 2, 4 | the wrapper never sets the backend's contact frequency, which stays the backend's own (30 Hz, 60 Hz against a static body), whatever `solver.contact_hz` says. The top of the stack ends more than half a side below 4.5 sides; two neighbouring dominoes end more than 0.2 of a thickness inside each other | names `cube5`, in the judge's sentence and the kit's `small_stack` row (`body`); names the pair, in the judge's sentence and the kit's `small_dominoes` row (`bodies`) |
| **`wrapper_scales_speed_cap`** | 3 | the wrapper hands `solver.max_speed` to the backend as it did at the base, so the backend's cap is `max_speed` × `length_unit`, 4 m/s. The 1 m ball's first bounce reads more than 90% low of 2.5 m | names `ball` |
| **`wrapper_scales_sleep_speed`** | 3 | the wrapper hands `solver.sleep.speed` to each body as it did at the base, so a body sleeps under `speed` × `length_unit`. The cube still writes `rest`, later than the sleep time plus 2 steps after its speed fell under 0.05 m/s | names `cube` and the step of its `rest` |
| **`lint_reads_first_shape`** | 5 | the lint reads only the first shape of each body. A die whose one shape is thin still raises both kinds; a die whose thin shape is its second raises nothing | names `die` |
| **`check_reads_range_only`** | 6 | the check holds `solver.length_unit` to its range and never asks `caps()`. With `--backend no_length_unit` it accepts `length_unit: 0.01` and still refuses 0 with `out_of_range` | names `solver/length_unit` and `no_length_unit` |

## The worlds

Every world but the lint's three at the defaults is **the fixture's world**: `kind: "physics.world@1"`, `dimensions: 3`,
`step_rate: 480`, `substeps: 4`, `gravity: [0, -9.81, 0]`, `mode: "dynamic"`, the kit's own capacity
(`{bodies: 32, shapes: 32, joints: 4, contacts: 128, particles: 0}`) and `solver: {contact_hz: 240, length_unit: 0.01}`.
"In the same world" is read as these settings: each scene is a document of its own, as each of the kit's fixtures is.
No world writes a seed, a backend or `solver.sleep`. A contact material is `{friction, restitution, density: 1000}`.
**The floor** is the kit's: a static body `floor` with one box of `half: [10, 0.1, 10]` at `pos: [0, -0.1, 0]`, its top
face y = 0. A dynamic body is `{kind: "dynamic", shapes: [{shape, contact_material}], pose: {pos}, sleep: false}` plus
what its row says; `sleep: false` is the kit's own, so a speed or a depth read here is a waking body's (#2309's README
says why). `helpers.ts` builds each document; the five the kit holds are these, field for field.

| World | Kit fixture | Materials | Shapes | Bodies | Steps |
|---|---|---|---|---|---|
| The edge | `small_edge` | `m`: friction 0, restitution 0 | `cube`: box, half 0.005 each way; `table`: box, half (0.1, 0.05, 0.1) | `table`: static, `pos` (−0.1, −0.05, 0), so its top is y = 0 and its edge the plane x = 0; `cube`: `pos` (−0.04, 0.005, 0), four sides before the edge, `velocity.linear` (0.886, 0, 0). No floor | 120 |
| The stack | `small_stack` | `m`: 0.5, 0 | `cube`; `floor` | the floor; `cube1` to `cube5` at y = 0.005, 0.015, 0.025, 0.035, 0.045, x = z = 0 | 1440 (3 s) |
| The bounce | `small_bounce` | `ball`: 0, restitution 0.5; `ground`: 0, 0; `combine: {friction: "geometric", restitution: "max"}` | `ball`: sphere, radius 0.005; `floor` | the floor on `ground`; `ball` at (0, 0.105, 0), its lowest point 0.1 m up | 240 |
| The slide | `small_slide` | `m`: 0.5, 0 | `cube`; `floor` | the floor; `cube` at (0, 0.005, 0), `velocity.linear` (0.7, 0, 0) | 240 |
| The dominoes | `small_dominoes` | `m`: 0.5, 0 | `domino`: box, half (0.00375, 0.024, 0.012); `floor` | the floor; `domino2` to `domino10` at x = 0.02 × (k − 1), y = 0.024; `domino1` at `pos` (0.004224527190210548, 0.024286566738543982, 0) with `rot: [0, 0, -10]` (degrees) | 1920 (4 s) |
| The 1 m ball | none | as the bounce | `ball`: sphere, radius 0.5; `floor` | the floor on `ground`; `ball` at (0, 10.5, 0) | 1920 (4 s) |
| The sleeper | none | `m`: 0.5, 0 | `cube`; `floor` | the floor; `cube` at (0, 0.005, 0), `velocity.linear` (0.2, 0, 0), `sleep: true` | 480 (1 s) |

- **The dominoes.** Each stands 48 mm tall (y), 24 mm wide (z) and 7.5 mm thick (x), in a row along +x, 20 mm from
  centre to centre. The first leans 10° toward the second, turned about its bottom edge on the second's side, which
  stays on the floor at x = 0.00375: its centre is (0.00375 − 0.00375 cos 10° + 0.024 sin 10°,
  0.00375 sin 10° + 0.024 cos 10°), the numbers in the table.
- **The lint's worlds** (criterion 5). At the defaults: the same document with `step_rate: 120` and no `solver`, so
  contacts at 30 Hz and a length of 1 m, holding the floor and one body on a material of friction 0.5: `die`, a 1 cm
  cube at (0, 0.005, 0); or `cube`, a 5 cm cube at (0, 0.025, 0); or `die` with two shape uses, `core`, a 5 cm cube,
  then `pip`, a 1 cm cube at `offset.pos` (0.03, 0, 0), at (0, 0.025, 0). And the 1 cm `die` in the fixture's world.
- **Criterion 6's worlds** are the stack's document: with no `length_unit` (`solver: {contact_hz: 240}`) for the
  merge base's hashes, over its 1440 steps; with `length_unit` 0.01 and 0.1 for the keys; with 0, −0.01, 1.01 and 1
  for the range; with 0.01 on the test backend.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s; each `describe` and test title starts with its criterion's ID. A judge returns
what is wrong as sentences, and each test asserts in its own file that there are none.

| File | Test | What fails it |
|---|---|---|
| `ac1` | real | the edge's world not baking; the cube never 0.5 mm below where it was built, or first so with its centre 1.6 sides or more past x = 0, or still before it; `small_edge` not in the kit's data once with the world, steps, answer and tolerance above; its row not `pass`, or its `measured` not this suite's reading |
| | planted `wrapper_ignores_length_unit` | the planted program not running; the cube's centre at its first dropped step not printing as 2.09 sides past; the judge passing it, or no failure naming `cube` and that step; the kit's row not `fail` with `body: "cube"`, that `step` and that `measured` |
| `ac2` | real | the top cube's centre ending more than 0.2 mm from y = 0.045 or more than 0.1 mm aside; any cube at 1 mm/s or faster in any state after steps 961 to 1440; the ball's first bounce not 0.025 m within 3%; the cube not at rest at the end, or not 0.05 m within 3% from where it started; any of the three kit fixtures as in `ac1` |
| | planted `wrapper_ignores_contact_hz` | the planted program not running; the top cube's centre not more than half a side below 4.5 sides; no failure naming `cube5`; the kit's `small_stack` row not `fail` with `body: "cube5"` and that `measured` |
| `ac3` | real | the ball's first bounce not 2.5 m within 3%; the cube writing no `rest`, or writing it later than 242 steps after the first step from which its speed stays under 0.05 m/s |
| | planted `wrapper_scales_speed_cap` | the planted program not running; the bounce not under 0.25 m; no failure naming `ball` |
| | planted `wrapper_scales_sleep_speed` | the planted program not running; no `rest`, or a `rest` no later than the real program's bound; no failure naming `cube` and the step of its `rest` |
| `ac4` | real | a domino never leaning past 45°, or passing no later than the one before it; the last passing before 0.6 s or after 0.8 s; two neighbours more than 0.375 mm inside each other after step 1920; `small_dominoes` as in `ac1` |
| | planted `wrapper_ignores_contact_hz` | the planted program not running; no two neighbours more than 1.5 mm inside each other; no failure naming the deepest pair; the kit's row not `fail` with that pair in `bodies` and that `measured` |
| `ac5` | real | the die at the defaults, or the die whose thin shape is its second, not raising exactly one issue of each kind with the fields above; the 5 cm cube raising one of kind `unit`; the die in the fixture's world refused, or raising either kind |
| | planted `lint_reads_first_shape` | the planted program not running; it missing the die whose one shape is thin; it raising either kind for the die whose thin shape is its second; the judge passing it, or a failure not naming `die` |
| `ac6` | merge base | a step hash of the stack with no `length_unit`, or their count, differing from the merge base's over 1441 hashes |
| | keys and range | a world not baking or having no key; the same world's two keys differing; 0.01 and 0.1 sharing a key; 0, −0.01 or 1.01 not refused with `out_of_range` at `solver/length_unit` and that `actual`; 1 refused |
| | test backend | the test build not holding `no_length_unit` as a candidate under that name; `length_unit: 0.01` on it not refused with `physics.backend_cap` at the field, `actual: 0.01` and a `what` naming `no_length_unit`; the reference backend of the same build refusing it |
| | planted `check_reads_range_only` | the planted program not running with the test backend; it refusing 0.01; it not refusing 0 with `out_of_range`; the judge passing it, or no failure naming the field and the backend |

Test count: 2 + 2 + 3 + 2 + 2 + 4 = 15. At the base one passes, as it should (`ac6`'s merge-base test: the merge base
is the base); every criterion has a test that fails at the base and one that fails on its planted program once it
exists.

Not vacuous: the edge's judge fails a cube that drops while still over the table; the sleeper's requires that the cube
was built sliding; the merge-base test requires that the last hash isn't the first and shows its judge failing on the
same run with one hash swapped; the keys test bakes one world twice and requires one key; criterion 6's refusal is
shown beside the reference backend accepting the same world, and each planted lint and check is shown still doing the
rest of its work.

## Readings where the issue leaves a choice

- **The surface.** The lint and the refusals are read on `check`, the motion on `bake`, the fixtures on the kit's two
  calls, as the base's suites read them; no new call. "A new fixture" and Scope's "the behavior kit gains small twins"
  are five fixtures in the kit's data. Criterion 3's two scenes are bakes, not fixtures: the Scope lists the kit's
  gains as the rest, bounce and slide twins, the edge and the dominoes.
- **"A 1 cm ball", "a 1 m ball"**: its diameter, as a 1 cm cube is its side. **"Density 1,000 kg/m³"** is every
  material's. The 1 m ball lands on the small bounce's floor under the same `max` rule.
- **"The speed that crosses 4 sides while a free body falls one"** is written as the issue prints it, 0.886 m/s. The
  cube starts four sides before the edge: with that start the base's wrapper, which ignores the field, reads the
  issue's 2.09 sides (2.0913) and a wrapper that sets the length reads its 1.35 (1.3530).
- **"Has dropped 0.5 mm"**: the cube's centre is at least a twentieth of a side below the height it was built at,
  after a step. **"Before its centre is 1.6 sides past the edge"**: at the first such step its centre's x is under
  0.016 m. A step moves the cube 0.185 of a side, so the reading comes in those steps. **"The step"** a failure names
  is that first step. **"Has not dropped until 2.09 sides past"** is that reading printed to two decimals.
- **"Set one on another"**: built touching, centred on one vertical line, the lowest touching the floor.
  **"End"**: after the last step of 3 s. **"Aside"**: the horizontal distance of the top cube's centre from where it
  was built. **"In the third second"**: the states after steps 961 to 1440. A speed is the length of `linear`.
- **"First bounces to"**: the height of the ball's lowest point at the top of its first rise.
- **"Slides … to rest in 0.05 m"**: its horizontal distance from where it was built after 0.5 s, where it moves
  slower than 1 mm/s. The judge holds 0.05 m, the issue's print, within 3%; the kit's answer may be the closed form.
- **"Writes `rest` and sleeps within the world's sleep time plus 2 steps of its speed falling under 0.05 m/s"**: as
  #191's `sleep` fixture reads it, one-sided: the step of the cube's first `rest` row is at most 240 + 2 steps after
  the first step from which its speed stays under 0.05 m/s. The world's sleep speed and time are its defaults.
  **"Sleeps later than that"**: the planted wrapper's `rest` row comes after that bound; **"the step"** is its step.
- **"20 mm apart"** is from centre to centre. With 20 mm between facing sides a wrapper that sets the length still
  passes, but the planted wrapper's deepest pair reads 0.194 of a thickness, under the criterion's 0.2; from centre to
  centre it reads 0.261, the 0.26 of the issue's opening.
- **"Tipped 10° about its far bottom edge"**: the bottom edge on the side it falls to, the second domino's.
  **"Pass 45°"**: the first step after which the domino's tall axis is more than 45° from the vertical.
  **"In order"**: each passes at a later step than the one before it. **"Inside each other"**: the least distance one
  box must move to stop overlapping the other (their least overlap along their fifteen separating axes), over each
  two neighbours in the row after step 1920. **"The pair"** is the deepest.
- **"More than half a side low"**: the top cube's centre ends more than 0.005 m below 0.045 m, whether the stack
  stands or has fallen.
- **"Naming"** a body, a step or a pair: the judge's sentence starts with the ID or IDs and holds `step <k>`; a kit's
  row carries them as `body`, `step` and `bodies`; an issue names a body in `ids`.
- **"Naming the field and the backend"**: the refusal's `path` is the field and its `what` holds the backend's name,
  as #2241's and #2009's suites read a refusal by caps.
- **"The fixture's world"** in criterion 5 is the fixture's settings around the same die on the same floor.
- **"A die whose thin shape is its second"**: its first shape is a 5 cm cube, which raises neither kind alone, so a
  body's thinnest extent is the thinnest of any of its shapes.
- **The merge base** is `git merge-base HEAD origin/main`, built as #191's `mergeBasePhysics` builds it, as #2309's
  third criterion reads it; the world compared is the stack with no `length_unit`, all 1441 hashes of 1440 steps.
- **"Two worlds that differ only in `length_unit`"** both write it, 0.01 and 0.1.

## A right program, to check these worlds

A throwaway change was made in this checkout to see that a right program can pass and the wrong ones fail, then put
back (`git checkout -- crates`); the base's binaries were rebuilt before `BASE-FAILURE.txt` was taken, the release
one byte-identical to the one built before the change. It read `solver.length_unit` (a number over 0 and at most 1) in
`doc.rs`; in `lib.rs`'s `build` it set the backend's length to it, its speed cap to `max_speed` ÷ length and each
body's sleep threshold to `sleep.speed` ÷ length; it added the four wrapper plants, a caps flag with the test backend
and the two other plants, a rough lint at check, and the five fixtures with two measures of their own, about 220
lines in all. No expected value here was taken from it. All fifteen tests of the suite as delivered passed on it in
one run, the merge-base test against a build of the base. Its readings:

| | Right program | Planted program |
|---|---|---|
| The edge | dropped at step 29, 1.3530 sides past (the issue: 1.35) | `wrapper_ignores_length_unit`: step 33, 2.0913 sides (2.09) |
| The stack | 0.916% of a side low (0.92%), 0.06% aside, at most 0.003 mm/s | `wrapper_ignores_contact_hz`: fallen, the top 4.007 sides low |
| The bounce | 0.02510 m, 0.39% high (0.4% high) | |
| The slide | 0.04977 m, 0.47% short of 0.05 m, 0.37% short of the closed form (0.4% short) | |
| The 1 m ball | 2.4806 m, 0.78% low | `wrapper_scales_speed_cap`: 0.2009 m, 92.0% low (92% low) |
| The sleeper | under 0.05 m/s from step 15, `rest` at step 252, due by 257 | `wrapper_scales_sleep_speed`: `rest` at step 261 |
| The dominoes | pass at steps 221, 242, 259, 275, 290, 305, 319, 330, 338, 343 (0.715 s); at most 0.005 of a thickness inside | `wrapper_ignores_contact_hz`: 0.719 s; `domino9` and `domino10` 0.261 inside (0.26) |
| The lint | the die: `unit` with 0.01 and 0.01, `soft` with 0.000552, 50 and 120; the 5 cm cube and the die in the fixture's world: nothing | `lint_reads_first_shape`: nothing for the die of two shapes |
| Criterion 6 | 1441 hashes equal to the base's; two keys for 0.01 and 0.1; `physics.backend_cap` naming `no_length_unit` | `check_reads_range_only`: accepted |

No number of the issue's was missed. With the kit's own `world`, `floor` and `dynamic` helpers the five fixtures'
documents came out equal to this suite's, and each row's `measured` equal to this suite's reading.

## Not asserted, because no criterion says so

The shape of `caps()`'s data and its declared list; `length_unit: 1` written on a backend that scales no lengths; the
small fixtures reading `excluded_by_caps` on such a backend; the fixtures on wasm32 or any other target; a `soft`
issue that names a higher `step_rate`, and how that rate is rounded; the thinnest extent of a shape that isn't a box;
the lint's `path`, `what` and `fix`; the lint on a bake; the lint's code in the check catalog; the bounce and the
slide under a planted wrapper; a step hash of a world that writes `length_unit`; `length_unit: 1` written hashing as
unwritten; the opening paragraph's readings at the defaults (5.87 mm, 59%, 16.1%, 5.23 sides, the beads); the design
documents' text; bodies thinner than 1 mm, a length per body, 2D worlds and soft bodies (the issue's Not in this task).

## What the implementer adds outside this folder

The field, the two refusals, the caps' say and the test backend `no_length_unit`, the lint, the five fixtures with
their measures and the six planted names, in `deep-physics-rapier` and `deep-canvas-physics`;
`'tests/acceptance/2308/'` in `scripts/lanes.mjs`'s `alone` list. Nothing in this folder changes.

## Gaps, deviations and what the owner must settle

1. **#191's first criterion's test holds every fixture of the kit to 120 Hz.**
   `tests/acceptance/191/ac1-reference-kit.test.ts` fails any fixture in `behavior_fixtures` whose world isn't at
   g = 9.81 m/s², 120 Hz and 4 substeps, natively and on wasm32, and the design's kit section opens its list "with
   g = 9.81 m/s² at 120 Hz and 4 substeps". This issue's Scope puts five fixtures at 480 Hz in that kit, and these
   tests require them there. Read from that test's code, not run (this job runs no other suite): once the five join
   the kit, #191's test fails on each. The implementer can edit neither suite. This is the owner's: #191's criterion
   to its blind redraft, or the small fixtures held elsewhere.
2. **"Runs on: … The lint and every criterion read a bake"** against the Scope's "a lint run at check". The lint is
   read on `check`, which builds the world and steps nothing; it needs nothing a bake has.
3. **The issue's 5.23 sides at the defaults** isn't this suite's reading: with the cube started four sides before the
   edge, the base at 480 Hz reads 2.09 sides with `contact_hz` at 240 and at its default alike. No criterion of this
   issue states 5.23; #2317's third does, for its own suite.
4. **The planted sleep speed fails by four steps** on the throwaway program (`rest` at step 261, due by 257): the
   speed falls from 0.05 m/s to 0.0005 m/s in five steps of this slide. The criterion gives no margin, so none is asked.
5. **The slide's 0.05 m** is the issue's print of 0.04995 m. The judge holds the print; the two bounds differ by 0.1%.
6. Nothing here proves the lint's rule beyond the criterion's cases: one die, one cube and one die of two shapes.
7. **The issue's comment** warns that criterion 1's plant leans on the backend's reuse of contacts: if #2317 lands
   first and changes that reuse, a wrapper that ignores `length_unit` may drop the cube before 1.6 sides, and the
   planted test here, which holds it to 2.09, would then fail. At this base it reads 2.0913. That order is the owner's.
