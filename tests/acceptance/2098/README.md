# Acceptance tests for #2098: 2D worlds on rapier2d, the wind force and a body's explicit inertia

Written first, blind, from issue #2098 as saved for the job on November 19, 2026 (its Scope, three acceptance criteria
and Proof line; it has no comments and no Oracle line), the design's physics sections and base commit `85203f458`
("Merge pull request #2852 …"), by a job that never saw an implementation, a diff of one, or any other worktree,
branch, stash or pull request. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding). Lean: one test per criterion clause that needs its own run, plus one
test per planted wrong program the Proof line names.

Two things criterion 2 states are not held in full, because holding them would mean guessing a law the issue and the
design don't state: "within 1% at its closed-form time", which no test here asserts, and that the gusts are the
hash's own, which is held only by comparison. Both are under [For the early question](#for-the-early-question).

## Files, one per criterion

| File | Criterion | Tests |
|---|---|---|
| `ac1-2d-world.test.ts` | `#2098.07d55616`: a 2D world of a ball dropped 2 m onto a floor, both of restitution 0.5, runs on rapier2d 0.36.1 and rebounds to within 0.05 of a quarter of the drop; the same world with `backend.name: rapier3d` and `dimensions: 2` is refused at check naming `dimensions` and the backend | 3 |
| `ac2-wind.test.ts` | `#2098.7c1127fe`: a body under `wind {velocity: (2, 0, 0)}` with `coupling: {kind: aero_triangles, coefficient: 1}` reaches the wind's speed within 1% at its closed-form time; the same seed gives the same gusts by hash on every run | 3 |
| `ac3-inertia.test.ts` | `#2098.f0ef7a3d`: a box given `inertia` twice its shape's spins up at half the angular acceleration under the same torque, within 1% | 2 |
| `helpers.ts` | the worlds, the judges and the runner, over `../191/helpers.ts` (imported read only) | |
| `twins.json` | each criterion's ID to its planted program, as #2306's and #2239's are | |
| `BASE-FAILURE.txt` | each file run once at the base | |

## What was read

- The issue as saved for the job (title, state, labels and body), and its body alone for the criterion IDs, each
  worked as `scripts/proof-change.mjs`'s `criterionId` works it (the first 8 hex digits of the SHA-256 of the
  criterion's text, trimmed, white space collapsed, the leading `- ` dropped) and found equal to the ID its test
  carries. For context only: #2009's body and comments and #520's body, as saved. The job had no access to the issue
  tracker.
- `docs/canvas-primitives.md`: Time and the flick; Units and axes; The closed function list (its Seeded row: `hash`,
  `noise`); A timeline as data over a pinned backend; World and backend `physics.world@1`; Shape; Body `body@1`;
  Contact material; Collision group; Joint `joint@1`; Force; Input track entries; Occurrence list; Physics output;
  Checkpoint ring; Bake; Golden; Physics: behavior kit. `docs/technical-design.md`: Scenes, physics and the canvas
  core (its Physics entry); The physics module; Who drafts it; Proven on the base; Dogfooding; Built to be hard to get
  wrong. AGENTS.md and CONTRIBUTING.md.
- At the base, for surfaces only: the suites `2009/` (README, helpers, ac1), `2241/` (README, helpers, ac1,
  `BASE-FAILURE.txt`), `2306/` (README, `twins.json`), `2239/`, `522/` and `523/` (`twins.json`; #523's helpers and
  ac3 for a hinge's motor), `191/` (helpers) and the lines of `251/` and `251-redraft-ac6/` that write
  `dimensions: 2`; `crates/deep-physics-rapier` (`Cargo.toml`, `main.rs`, `planted.rs`, `runner.rs`'s `check`, `bake`
  and checkpoint replies, `runner/held.rs`, `joints.rs`, `lib.rs`'s forces, masses and motors);
  `crates/deep-canvas-physics` (`doc.rs`'s reader, `check.rs`'s caps refusals, `caps.rs`); `crates/deep-canvas`
  (`expr/noise.rs`: the closed function list's `hash` and `noise`); `scripts/proof-change.mjs` (criterion IDs),
  `scripts/proof-runs.mjs` (`twins.json`), `scripts/lanes.mjs` (its `alone` list).
- The pinned backend's source in cargo's registry (rapier3d 0.36.1, which `Cargo.lock` pins, and rapier2d 0.36.1,
  which the issue pins), only to see that it can be asked what the criteria need: a ball and a segment as 2D shapes, a
  body's mass properties given as principal moments, and a motor's impulse bounded by its greatest force times the
  step. Neither gave an expected value.

What the base already does, which these tests don't credit:

- Its check refuses `dimensions: 2` with `physics.backend_cap` at `dimensions`, the value in `actual` and
  `rapier3d 0.36.1` in the sentence, whatever `backend.name` says, and refuses `backend.name: rapier2d` at
  `backend/name`. So the second half of criterion 1 already holds there. A test of it alone would pass on the base and
  prove nothing: `ac1`'s second test holds the refusal beside the same world accepted and stepped on rapier2d, and
  fails on the base at that.
- Its reader knows none of the 2D shape kinds and takes a point only as three numbers.
- It refuses a `wind` force at `forces/<ID>/kind` and a body's `inertia` at `bodies/<ID>/inertia`, each with
  `physics.unsupported` in a sentence naming #2098.
- `deep-physics` is the one binary of `crates/deep-physics-rapier`, built on rapier3d; `Cargo.lock` pins rapier3d
  0.36.1 and holds no rapier2d. It checks and bakes a 3D world, answers each body's states, the step hashes and, when
  asked, the checkpoints it kept, each naming `rapier3d` `0.36.1`; a force's kind is written `{<kind>: {fields}}`; a
  hinge's velocity motor presses with at most its `max_torque`; `--planted <name>` starts a wrong program and exits 2
  with `bad_input` for a name it doesn't know.
- A cube with no `inertia` on such a hinge spins up at the torque over its shape's inertia (`BASE-FAILURE.txt` has
  the base's reading), and a body under no force but a steady medium's `drag` repeats its step hashes run after run.

## Run them

```sh
npm ci                          # once, if node_modules is missing
# the build first, through the one build slot:
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  nice -n 10 sh scripts/lease cargo build --locked -j 6 --release -p deep-physics-rapier --bin deep-physics
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/2098 --no-file-parallelism --testTimeout=3600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2098/tsconfig.json     # type-check
rm -rf tests/acceptance/2098/node_modules                                       # vitest's cache
```

Every file reads one build, made once per file and copied out of the target folder: `cargo build --locked --release
-p deep-physics-rapier --bin deep-physics` (#191's `release`). The planted names run on it. The suite's own cargo call
finds the build made and only brings it up to date. Every test passes #191's 60-minute timeout, and each file's build
hook #191's 4 hours. Node built-ins and vitest only, no network. No process is started but `cargo` and
`deep-physics`, each waited for; none is stopped by name or port. A process that can't be run fails its test with
`BLOCKED:`, one that doesn't finish with `INCONCLUSIVE:`; nothing unrun passes. The one temp folder (the copied
binary) is removed when each file ends. No test times anything, so none depends on the machine or its load.

## The surface under test

The issue names the fields (`dimensions`, `backend.name`, the 2D shape kinds, `wind {velocity, gust, coupling, seed}`,
`inertia`), the refusal and what each wrong program does. It names no call, no reply field and no planted program, and
the design leaves some of the fields' shapes open. These tests drive `deep-physics` as #191, #2009 and #2241 left it:
one JSON object per stdin line, one reply line each. **Every name or shape below marked *(ours)* is this job's
choice**, the least the criteria need, named as the issue and the design name things; the implementer builds exactly
these, or a dispute goes to a blind redraft. Everything else below is the base's, and must stay as it is.

### The 2D world document (criterion 1)

`dimensions: 2` and `backend: {"name": "rapier2d", "version": "=0.36.1"}`, as the issue and the design write them.
**One `deep-physics` takes a world of either backend, with no flag** *(ours)*: the binary #191's build command makes
(`deep-physics` of the package `deep-physics-rapier`) is asked the 2D world and the 3D ones alike, and the world's
`backend.name` says which backend runs it. The tests write this document and no other 2D field:

```json
{"kind": "physics.world@1", "dimensions": 2, "step_rate": 120, "substeps": 4, "seed": 2098, "mode": "dynamic",
 "capacity": {"bodies": 16, "shapes": 16, "joints": 8, "contacts": 64, "particles": 0},
 "backend": {"name": "rapier2d", "version": "=0.36.1"},
 "contact_materials": {"half": {"friction": 0.5, "restitution": 0.5, "density": 1000}},
 "shapes": {"ball": {"kind": "circle", "radius": 0.1}, "floor": {"kind": "segment", "a": [-30, 0], "b": [30, 0]}},
 "bodies": {"floor": {"kind": "static", "shapes": [{"shape": "floor", "contact_material": "half"}]},
            "ball": {"kind": "dynamic", "shapes": [{"shape": "ball", "contact_material": "half"}], "pose": {"pos": [0, 2.1]}}}}
```

- **A point of a 2D world is `[x, y]`** *(ours)*, in metres: a segment's `a` and `b`, in its body's frame, and a
  body's `pose.pos`. The design writes `pos: m` and `segment {a, b}` and gives no arity.
- **`circle` takes `radius`** *(ours)*, in metres, as `sphere {radius: m}` does; the design lists `circle` with no
  field. `segment {a, b}` is the design's.
- `gravity` is not written: the design's default, (0, −9.81, 0), pulls a 2D world's bodies at 9.81 m/s² toward −y.
  `combine`, `solver` and `checkpoint` are not written either: restitution combines by `max`, 0.5 against 0.5 is 0.5
  under it, and a checkpoint is kept every 60 steps.
- `density` on a 2D world's contact material is kg/m² (Contact material); no test reads the ball's mass.
- A body with no `pose` is at the origin, unturned, as at the base.

### The wind force (criterion 2)

A force of a 3D world, written as the base writes a force's kind, `{<kind>: {fields}}`, with the design's fields:

```json
"forces": {"wind": {"kind": {"wind": {"velocity": [2, 0, 0], "coupling": {"kind": "aero_triangles", "coefficient": 1},
                                      "gust": {"amplitude": 1, "scale": 0.5, "speed": 2}, "seed": 7}},
                    "applies_to": ["vane"]}}
```

- **`velocity` as three numbers** *(ours)*: the criterion's `(2, 0, 0)`, in m/s, a constant. The design calls it an
  expression of t and p; how an expression is written there is not this suite's, since no criterion varies it.
- `coupling: {"kind": "aero_triangles", "coefficient": 1}` is the criterion's, word for word.
- `gust: {amplitude, scale, speed}` and `seed` are the design's fields; **their values here are ours** (amplitude 1,
  scale 0.5 m, speed 2 m/s, seeds 7 and 8). `seed` is a whole number.
- **`gust` and `seed` may each be left out** *(ours, after the criterion)*: the criterion's first clause writes the
  wind with `velocity` and `coupling` alone, and the first test writes exactly that. A wind with no `gust` blows
  steadily at `velocity`.
- `applies_to` names the body, as the base's forces do.

### A body's inertia (criterion 3)

**`inertia: [Ixx, Iyy, Izz]`** *(ours)*, in kg·m², on a body of a 3D world: its moments of inertia about its own x, y
and z axes through its centre of mass, in place of the ones its shapes give at its mass. The design writes
"`inertia` (optional)" and nothing more. The tests write `"inertia": [2, 2, 2]` on a 6 kg cube of 1 m, whose own
are (1, 1, 1), and leave the field out on the cube beside it.

### Calls and reply fields (all the base's)

| Call, as the tests write it | Reply fields the tests read |
|---|---|
| `{"call": "check", "world": World}` | `{"ok": true, "issues": [{"severity", "path", "actual", "what", …}]}`; a world is accepted when no issue has `severity: "error"` |
| `{"call": "bake", "world": World, "steps": n, "read": [body ID]}` (criterion 1 adds `"checkpoints": true`) | `{"ok": true, "bodies": {<ID>: [State × (n + 1)]}, "step_hashes": [string × (n + 1)], "checkpoints": [{"step", "backend": {"name", "version"}, …}]}`; index k is the state after step k, index 0 the built one. A refused world answers `{"ok": false, "issues": […]}` |

- In a 3D world `State` is the base's: `{"pos": [x, y, z], "linear": [x, y, z], "angular": [x, y, z], …}`, in m, m/s
  and deg/s.
- **In a 2D world the tests read `State.pos[1]` and `State.linear[1]`** *(ours)*: the body's height, m, and its
  vertical velocity, m/s, so `pos` and `linear` are lists whose second number is y. Nothing else of a 2D state is
  read, and how it writes a turn or a turn rate is the implementer's.
- A checkpoint of the 2D world's bake names the backend that wrote it, as the base's name `rapier3d`:
  `"backend": {"name": "rapier2d", "version": "0.36.1"}`.
- `deep-physics --planted <name>` on the release build, as at the base: with a name it knows the process exits 0 and
  answers every call; the base answers `{"ok":false,"code":"bad_input"}` and exits 2 to one it doesn't.

### The refusal (criterion 1)

An issue of the check, shaped as the base's caps refusals are and read as #2009's and #2241's suites read them:

```text
the 2D world with backend.name rapier3d   {"severity": "error", "path": "dimensions", "actual": 2, "what": "… rapier3d …", …}
```

- "Naming `dimensions`": the path's last name is `dimensions` (names split on `/` or `.`), and `actual` is the 2
  written there.
- "And the backend": `what` holds `rapier3d`. The code and the rest of the sentence are the implementer's.
- The same document with `backend.name: rapier2d` is accepted: no issue of severity `error`.

### Planted twins

Each is `deep-physics --planted <name>` on the release build (the base's way of starting a wrong program), changing
nothing but what its row says. Its process must exit 0 and answer; the judge that passes the real program must fail on
it, naming what its row says. The three names are *(ours)*, after the Proof line's words; `twins.json` maps each
criterion's ID to its twin.

| Name | Criterion | The wrong program | What the test holds it to | The failure names |
|---|---|---|---|---|
| `world_2d_built_on_rapier3d` *(ours)* | 1 | the check lets `dimensions: 2` through for a world that names `rapier3d`, so the world goes on to be built there | it answers the check of the refused world with `{"ok": true, "issues": […]}`, and no error issue there has the path `dimensions` | `dimensions` and `rapier3d` |
| `wind_noise_from_platform_sin` *(ours)* | 2 | a gust's noise comes from the platform's sin, not from the integer lattice hash; the rest of the wind is the shipped one | it bakes the gusty wind and the same wind with no gust; with no gust its step hashes are the shipped program's, all 241; with the gust they differ from its own with none (it still gusts), and from the shipped program's for the same seed | the first step whose hash differs |
| `inertia_ignored` *(ours)* | 3 | a body's `inertia` is read and dropped, so the body keeps its shapes' | it takes the two cubes and bakes them; `doubled` spins up at `plain`'s angular acceleration within 1% | `doubled`, and the half it missed |

## The worlds

| World | What it is | Baked |
|---|---|---|
| the 2D drop (ac1) | the document above: a static body `floor`, a `segment` from (−30, 0) to (30, 0); a dynamic body `ball`, a `circle` of radius 0.1 m built at rest at (0, 2.1), its lowest point 2 m above the floor; one contact material, restitution 0.5, on both | 240 steps, 2 s, with `checkpoints: true`; 1 step beside the refusal |
| the same world named for rapier3d (ac1) | the same document with `backend.name: rapier3d`, nothing else changed | checked only |
| the steady wind (ac2) | #191's `world` defaults (3D, 120 Hz, 4 substeps, `rapier3d` `=0.36.1`) with `gravity: [0, 0, 0]`; one dynamic body `vane`, a `box` of half 0.5 m, `mass: 1`, `sleep: false`, built at rest at the origin, nothing near it; the force `wind` on it: `velocity: [2, 0, 0]`, `coupling: {kind: aero_triangles, coefficient: 1}`, no `gust`, no `seed` | 120 steps, 1 s |
| the gusty wind (ac2) | the steady wind with `gust: {amplitude: 1, scale: 0.5, speed: 2}` and `seed: 7`; again with `seed: 8` | 240 steps, 2 s |
| the wind with no gust (ac2) | the steady wind with `seed: 7` | 240 steps |
| the two cubes (ac3) | #191's `world` defaults with `gravity: [0, 0, 0]`; two dynamic bodies 10 m apart, `plain` at (−5, 0, 0) and `doubled` at (5, 0, 0), each a `box` of half 0.5 m, `mass: 6`, `sleep: false`; each on a `hinge` to the world about +z through its centre (`plain_axle`, `doubled_axle`) with `motor: {mode: velocity, target: 3600, max_torque: 1, hz: 10, damping_ratio: 1}`; `doubled` writes `inertia: [2, 2, 2]`, `plain` none | 120 steps, 1 s |

Body, force, joint, shape and material IDs are *(ours)*. A cube of half 0.5 m and 6 kg has, about each axis through
its centre, the inertia m × (b² + c²) ÷ 3 = 6 × 0.5 ÷ 3 = 1 kg·m², so `[2, 2, 2]` is twice its shape's. Each motor
aims at 3,600 deg/s, which neither cube comes near in a second (57.3 and 28.6 deg/s), so each presses with all of its
`max_torque`, 1 N·m, at every step: the same torque.

## Criteria to tests, and the wrong program each fails on

- **ac1, `#2098.07d55616`.**
  1. The 2D drop baked 2 s on rapier2d. The ball is built at rest with its lowest point 2 m above the floor; its
     first rebound, the highest its lowest point rises over the floor between the step its vertical velocity turns
     upward and the step it turns down again, over the 2 m drop, is within 0.05 of 0.25 (0.4 to 0.6 m). "Runs on
     rapier2d 0.36.1": every checkpoint the bake kept names `rapier2d` `0.36.1`, and `Cargo.lock` resolves `rapier2d`
     to 0.36.1 alone. Fails on the base, which refuses the world and links no rapier2d; a bounce off e², a world
     stepped by a backend that names itself otherwise, or another version pinned, fails its own line.
  2. The same document named for rapier3d is refused at check: an error at `dimensions`, `actual` 2, its sentence
     naming `rapier3d`. Held beside the 2D drop accepted at check and baked one step on rapier2d, in one process.
     Fails on the base at "accepted"; after the work it fails on a check that stops refusing, or that refuses without
     naming the field or the backend.
  3. Under `world_2d_built_on_rapier3d` the check of that document holds no error at `dimensions`; the second test's
     judge fails on it, naming `dimensions` and `rapier3d`. The wrong program is the planted one; the base doesn't
     know the name.
- **ac2, `#2098.7c1127fe`.**
  1. The steady wind, exactly as the criterion's first clause writes it, is accepted at check and bakes 1 s. The body
     is built at rest; after its first step it moves along +x, and after 120 it still does and has moved along +x.
     That is the least a body that reaches the wind's speed from rest does: the wind is the same at every place and
     time, so a body it left at rest once would be left there for good. Fails on the base, which refuses the force,
     and on a program that takes the fields and blows nothing. **Not held here: how nearly the body reaches 2 m/s, and
     when** ([For the early question](#for-the-early-question)).
  2. The gusty wind with seed 7, baked 2 s three times, in one process and twice in another: all 241 step hashes are
     the same strings each time. Not vacuous: the same wind with no gust differs in some step's hash, so the gusts
     are in what the hashes compare, and seed 8 differs too, so it is the seed that gives them. Fails on the base,
     which bakes none of them; a wind whose gusts change from run to run, a gust that moves nothing, or a seed that
     is not read, each fails its own line.
  3. Under `wind_noise_from_platform_sin` the wind with no gust steps as shipped and the gusty wind still gusts; the
     second test's comparison, held against the shipped program's run of the same seed, fails on it, naming the first
     step whose hash differs. The wrong program is the planted one.
- **ac3, `#2098.f0ef7a3d`.**
  1. The two cubes baked 1 s. Each cube's angular acceleration is its turn rate about +z at step 120 less its built
     one, over 1 s. `plain` spins up at 1 N·m ÷ 1 kg·m² = 57.30 deg/s² within 1%, so the torque is the one written and
     the cube's inertia the one `doubled` doubles; `doubled` spins up at half of `plain`'s, within 1% of that half.
     Fails on the base, which refuses `inertia`.
  2. Under `inertia_ignored` the world bakes and `doubled` spins up at `plain`'s acceleration within 1%; the first
     test's judge fails on it, naming `doubled` and the half it missed. The wrong program is the planted one.

Test count: 3 + 3 + 2 = 8.

## Readings, where the issue and the design leave a choice

1. **"A 2D world of a ball … onto a floor".** A `circle` over a static `segment`: the two 2D kinds that need the
   fewest choices (the design names a segment's fields; a polygon's it doesn't). Radius 0.1 m, as #2009's ball.
2. **"Dropped 2 m".** The ball is built at rest with its lowest point 2 m above the floor's line.
3. **"Rebounds to within 0.05 of a quarter of the drop".** As #2009's suite reads the same words: the first rebound
   as a fraction of the 2 m drop is within 0.05 of 0.25. The rebound is read at the steps, 1/120 s apart.
4. **"Runs on rapier2d 0.36.1".** Read from the two places the base answers a backend's name and version: the
   checkpoints of the world's own bake, which are that backend's whole-world state, and `Cargo.lock`, where the pin
   is. Nothing the runner answers tells which engine moved a body, so a program that stamps `rapier2d` on a world it
   steps elsewhere is not caught here.
5. **"The same world with `backend.name: rapier3d` and `dimensions: 2`".** The same document, byte for byte but for
   the backend's name: its 2D shapes and points stay. "Refused at check naming `dimensions` and the backend": as
   [The refusal](#the-refusal-criterion-1) says. Other issues the check may raise beside it aren't read.
6. **"A 2D world built on rapier3d"** (Proof). The wrong program that takes that refused document instead of
   refusing it. What it then builds isn't read: the test holds only that nothing at `dimensions` stops it.
7. **"A body under `wind …`".** A rigid dynamic body, a 1 kg box of 1 m, at rest with no gravity, so the wind is the
   only force on it. The box is chosen for its flat faces; its size and mass are not the criterion's and no number
   here leans on them.
8. **"The same seed gives the same gusts by hash on every run".** A run is a bake from step 0; "by hash" is the
   bake's `step_hashes`, the state's hash after each step; "every run" is three bakes in two processes. Seed 8 giving
   other gusts is this suite's reading of what a seed is, used only to show the comparison isn't vacuous.
9. **"Wind noise from platform sin"** (Proof). On one machine such a program repeats itself too, so the clause as
   written doesn't fail it. It is caught as the Proof line's words allow: its gusts are not the ones the shipped
   program gives the same seed, step hash by step hash.
10. **"A box given `inertia` twice its shape's".** A cube, so "its shape's" is one number about every axis, worked
    from its mass and size; `inertia` is written about all three axes.
11. **"Under the same torque".** The only torque a world document writes is a motor's `max_torque`, so each cube is
    on a hinge whose velocity motor aims far past what it reaches and presses with all of it. The base has no other
    way to hold a known torque on a body over time.
12. **"Spins up at half the angular acceleration … within 1%".** Each acceleration is the mean over the first
    second from rest; `doubled`'s is within 1% of half of `plain`'s. `plain`'s own is held to the closed form,
    torque ÷ inertia, within the same 1%, which is what makes the two torques the same and the doubling a doubling.

Found in the inputs, and not settled here:

- `scripts/proof-change.mjs` at the base reads an issue's criteria as `- [ ]` boxes under `### Acceptance criteria`.
  #2098 writes plain bullets under `## Acceptance criteria`. The IDs here are the ones `criterionId` gives each
  bullet's text; whether the trace lane finds the criteria in the issue as written is not this suite's.
- Units and axes says 2D is in `u` with y down, of drawings. These tests need only what World and backend says: the
  default gravity pulls toward −y, and the ball is built at a greater y than the floor.
- #251's suites write `dimensions: 2` on a world named for rapier3d and expect it refused at `dimensions` or at the
  vehicle's kind. Criterion 1's refusal keeps that; a 2D world named for rapier2d is not theirs.

## For the early question

Each is a condition a criterion states that no check here holds, because the issue and the design leave open what the
check would have to assert. A second run of this job drafts each from the owner's answer.

1. **Criterion 2, `#2098.7c1127fe`: "reaches the wind's speed within 1% at its closed-form time".**
   - *Not held:* when the body reaches the wind's speed, and the 1% bound that goes with it. The first test of `ac2`
     holds only that the world is taken and that the wind moves the body along it from rest.
   - *Left open:* the force a wind puts on a body through `coupling: {kind: aero_triangles, coefficient}`. Force
     gives the field's names and no law: not how the force depends on the wind's velocity less the body's (in
     proportion, by its square, per triangle along its normal), not what of the body it scales with (its mass, its
     shapes' faces and their areas), not `coefficient`'s unit. Without the law there is no closed form, so no time;
     no body can be sized so that the time is known; and the run's length can't be chosen without assuming how fast
     the law acts. It is also open which quantity the 1% bounds, the body's speed at that time (within 1% of 2 m/s)
     or the time itself, and, under a law that only approaches the wind's speed, what "reaches" means.
   - *The sentence that would settle it:* one in Force, of the form its other laws take, that gives the law in SI
     units and the fixture's answer, such as "`wind` gives each body in `applies_to` F = (the law, in the wind's
     velocity at the body's place and time, the body's velocity and `coefficient`), so a body of (mass and shape)
     released at rest in a steady wind of 2 m/s moves within 1% of 2 m/s at (the closed form) = (seconds), within
     (steps)".
2. **Criterion 2, the same: "the same gusts by hash".**
   - *Not held:* that the gusts are the ones the integer lattice hash gives, as a value worked outside the program.
     The second test holds that they repeat, and the third that the planted program's differ from the shipped one's.
   - *Left open:* what a gust adds to the wind at a place and time: how `amplitude`, `scale`, `speed` and `seed`
     enter the closed function list's `noise(p, seed)`, and `amplitude`'s unit.
   - *The sentence that would settle it:* one in Force such as "a gust adds `amplitude` × noise((the point, from p, t,
     `speed` and `scale`), `seed`) (along which direction) to the wind's velocity", with the closed function list's
     `noise`.

Nothing else in the criteria proved impossible to test. Two things are tested less directly than their words: which
engine steps the 2D world (reading 4) and where the planted wind's noise comes from (reading 9).

## What isn't asserted, because no criterion says so

- The 2D kinds `polygon` and `chain`, a `segment` on a dynamic body, 2D joints, forces, inputs, sensors, queries and
  character bodies; a vehicle body in a 2D world; a 2D body's turn; a 2D world's mass from `density` in kg/m².
- That the ball then rests (#2009's words, not this criterion's), the bounce under another combine rule, and the
  behavior kit's 2D twins of free fall, the projectile, the bounce and the slide.
- What `backend`, `runtime`, a bake's key or a golden say of a 2D world; 2D worlds on wasm32 or another machine.
- A wind's `velocity` as an expression of t and p, its `region` and `strength`, a wind on a soft body, a wind with a
  gust and no `seed`, how strong a gust is, and that no crate calls a platform sin, cos or exp.
- An `inertia` that is not about the body's own axes, one on a body with several shapes or in a 2D world, and what
  the check says of one that is zero or negative.
- The refusal's code and sentence beyond the names above, and what else the check says of the refused world.
- Step hashes across machines or builds, and any timing or cost.

## What the implementer adds outside this folder

**`scripts/lanes.mjs` needs this line** (the files build a cargo binary); this README is the instruction, the
implementer makes that edit:

```js
// #2098's files build deep-physics (release).
alone.push('tests/acceptance/2098/');
```

Nothing else outside `tests/acceptance/2098/` is asked for by these tests but the work itself.

`BASE-FAILURE.txt` is each file's run at the base, with each test's result and failing assertion.
