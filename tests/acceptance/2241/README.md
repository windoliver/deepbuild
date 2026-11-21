# Acceptance tests for #2241: belts, a surface that carries what rests on it, run on the reference backend through its contact hook

Written first, blind, from issue #2241 as saved for the job on November 18, 2026 (its opening paragraph, Scope, five
acceptance criteria, Proof line and dependency; it has no comments and no Oracle line), the design's physics sections
and base commit `9d0256132` ("Merge pull request #2836 …"). The suite was written in two runs of the same job, and
neither saw an implementation, a diff of one, or any other worktree, branch, stash or pull request. The first run
wrote the five test files, `helpers.ts` and `tsconfig.json` and stopped there. The second read them as its own draft,
checked each against the issue and the design, type-checked them, ran each file once at the base, and wrote this README
and `BASE-FAILURE.txt`. It changed nothing in the first run's files. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## Files, one per criterion

| File | Criterion | Tests |
|---|---|---|
| `ac1-level-belt.test.ts` | `#2241.b41ad7e6`: on a level static belt with `tangent_speed: 1` the box reaches 1 m/s along the belt's +X at 0.204 s within 2 steps and has moved 1.898 m at 2 s within 1%; the belt's body never moves; the new fixture is in the kit and Rapier passes it; the planted wrapper without the hook leaves the box at rest and fails, naming the fixture, 1.898 m and the 0 m it read | 3 |
| `ac2-belt-direction.test.ts` | `#2241.7f1a12a6`: the belt turned 90° about +Y carries the box 1.898 m along world −Z; `tangent_speed: −1` moves it −1.898 m along x; the planted wrapper that applies the speed along world +X moves the turned belt's box the wrong way and fails, naming the axis | 2 |
| `ac3-tilted-belt.test.ts` | `#2241.cd4957bd`: on the belt tilted 10° the box reaches 1 m/s up the slope at 0.320 s within 2 steps and holds it within 1%; the fixture is in the kit and Rapier passes it; the planted wrapper that takes the speed along level ground holds the box at 0.985 m/s and fails the 1% bound, naming the fixture | 3 |
| `ac4-refusals.test.ts` | `#2241.385c4a4d`: `tangent_speed: 1` on a dynamic body's shape use refused naming the field; `rolling_resistance: 0.05` still refused on Rapier naming the field and the backend; the test backend without belts reads `excluded_by_caps` on the belt fixtures and refuses the first world, naming the field | 2 |
| `ac5-seek-and-merge-base.test.ts` | `#2241.7a6dcc6f`: the first world sought to 1 s and played on gives the straight run's step hashes; a world with no `tangent_speed` gives the merge base's step hashes | 2 |
| `helpers.ts` | the worlds, the judges and the runner, over `../191/helpers.ts` (imported read only) | |
| `BASE-FAILURE.txt` | each file run once at the base | |

## What was read

- The issue as saved for the job (title, state and body), and its body alone for the criterion IDs, each worked as
  `scripts/proof-change.mjs`'s `criterionId` works it and found equal to the ID its test carries. The job had no
  access to the issue tracker, so the epic #97 and the issues #191 and #924 were not read; #191 is known here through
  its suite and its design section.
- `docs/canvas-primitives.md`: Units and axes; World and backend `physics.world@1`; Shape; Body `body@1`; Contact
  material; Checkpoint ring; Bake; Golden; Physics: behavior kit. `docs/technical-design.md`: The physics module
  (World; Shape, body, contact material, collision group; Bake and golden; Behavior kit); Who drafts it; Proven on the
  base; Criteria to tests; Wrong programs; Dogfooding; Tests written first. AGENTS.md and CONTRIBUTING.md.
- At the base, for surfaces only: the suites `2309/` (README, `BASE-FAILURE.txt`, helpers and ac4), `191/` (helpers and
  README), `2009/` (ac3 and its refusal reader) and `522/` (its `seek` call); `crates/deep-physics-rapier` (`main.rs`,
  `planted.rs`'s names, `runner.rs`'s `check` and `bake` replies, `runner/timeline.rs`'s `seek`, `runner/kit.rs`'s
  calls and test backends); `crates/deep-canvas-physics` (`caps.rs`, `check.rs`'s caps refusals, `kit.rs`'s fixture
  and row); `scripts/proof-change.mjs` (criterion IDs); `scripts/lanes.mjs` (its `alone` list).
- The pinned backend's source in cargo's registry (rapier3d 0.36.1, the version `Cargo.lock` pins), only to see that
  it has what the issue names: a `tangent_velocity` on each solver contact, which the solver reads along the contact's
  tangents, and the `modify_solver_contacts` hook.
- The first run left no list of what it read. Its files import only `../191/helpers.ts`, Node built-ins and vitest,
  and cite only #191's, #2009's and #2309's suites.

What the base already does, which these tests don't credit: the reader takes `tangent_speed` and `rolling_resistance`
on a contact material; Rapier's caps() refuse either other than 0 with `physics.backend_cap` at
`contact_materials/<ID>/<field>`, the value in `actual` and `rapier3d 0.36.1` in the sentence, so the base refuses
`tangent_speed: 1` on a dynamic body's shape use as it refuses it on any body; `--planted caps_allow_tangent_speed`
(#2009's) lets the field through and runs no belt; `deep-physics` checks, bakes, seeks over a stored bake, answers
`backend`, `behavior_fixtures` and `behavior_kit`, takes `--planted <name>` and, in a `test-backends` build,
`--backend <name>`; a world with no `tangent_speed` steps as the merge base steps it, the merge base being the base.
The base holds no belt fixture, none of this suite's three planted names, no test backend `no_belts`, and no cap for
belts in `backend`'s `caps`.

## Run them

```sh
npm ci                          # once, if node_modules is missing
# the builds first, each through the one build slot:
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  nice -n 10 sh scripts/lease cargo build --locked -j 6 --release -p deep-physics-rapier --bin deep-physics
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  nice -n 10 sh scripts/lease cargo build --locked -j 6 -p deep-physics-rapier --bin deep-physics --features test-backends
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/2241 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2241/tsconfig.json     # type-check
rm -rf tests/acceptance/2241/node_modules                                       # vitest's cache
```

| File | Builds (each once per file, copied out of the target folder) |
|---|---|
| all five | `cargo build --locked --release -p deep-physics-rapier --bin deep-physics` (#191's `release`); the planted names run on it |
| `ac4` | also `cargo build --locked -p deep-physics-rapier --bin deep-physics --features test-backends` (#191's `test`, a debug build), for `--backend no_belts` and for Rapier beside it |
| `ac5` | also the merge base's release build (`git merge-base HEAD origin/main`), exported by `git archive` into `target/acceptance-191-base/<sha>` and built there (#191's `mergeBasePhysics`) |

The suite's own cargo calls find those builds made and only bring them up to date and copy them. This job ran the
tsc line and the vitest line, the vitest line once for each file with the file's name and `--reporter=verbose` added;
it did not run the two `scripts/lease` lines, since its target folder already held the builds. Every test passes
#191's 60-minute timeout (four times that for ac5's merge-base test), and ac5's own hook the same; each file's build
hook is #191's, 4 hours. Node built-ins and vitest only, no network. No
process is started but `cargo`, `git`, `tar` and `deep-physics`, each waited for; none is stopped by name or port. A
process that can't be run fails its test with `BLOCKED:`, one that doesn't finish with `INCONCLUSIVE:`, and no merge
base to build is `BLOCKED:`; nothing unrun passes. Temp folders (the copied binaries, ac5's store and its copy of the
merge base's binary) are removed when each file ends. No test times anything, so none depends on the machine or its
load.

**`scripts/lanes.mjs` needs this line** (the files build cargo binaries, one of them a second checkout's); this README
is the instruction, the implementer makes that edit:

```js
// #2241's files build deep-physics (release and test-backends) and the merge base's release build.
alone.push('tests/acceptance/2241/');
```

## The surface under test

The issue names the field (`tangent_speed`), the refusals, `caps()`, `excluded_by_caps`, the fixtures' numbers and what
each wrong program does. It names no call, no flag, no fixture, no planted program and no test backend. These tests
drive `deep-physics` as #191, #522, #2009 and #2309 left it: one JSON object per stdin line, one reply line each.
**Bold** names are this job's choices, the smallest the criteria need; the implementer builds exactly these.
Everything else below is the base's, and must stay as it is.

### The document field

`contact_materials.<ID>.tangent_speed`, a number in m/s, as the base's reader already takes it. The tests write `1`
and `-1` on the material of a static body's shape use, `1` on the material of a dynamic body's shape use, and leave it
out. Example: `"contact_materials": {"belt": {"friction": 0.5, "restitution": 0, "density": 1000, "tangent_speed": 1}}`.
`contact_materials.<ID>.rolling_resistance: 0.05` is written once, to be refused.

### Calls and reply fields (all the base's)

| Call, as the tests write it | Reply fields the tests read |
|---|---|
| `{"call": "check", "world": World}` | `{"ok": true, "issues": [{"severity", "path", "actual", "what", …}]}`; a world is accepted when no issue has `severity: "error"` |
| `{"call": "bake", "world": World, "steps": 240, "read": ["box", "belt"]}` (`read` lists the bodies whose states come back; ac5 adds `"store": dir`) | `{"ok": true, "bodies": {"box": [State × 241], "belt": [State × 241]}, "step_hashes": [string × 241]}`; `State` is `{"pos": [3], "rot": [4], "linear": [3], "angular": [3]}`, index k the state after step k, index 0 the built one. A refused world answers `{"ok": false, "issues": […]}` |
| `{"call": "seek", "world": World, "steps": 240, "store": dir, "to": 120, "play": 120, "read": ["box"]}` | `{"ok": true, "from": step, "step_hashes": [string]}`, one hash for each step from `from` to 240 |
| `{"call": "behavior_fixtures"}` | `{"ok": true, "fixtures": [{"name", "world", "answer", "tolerance", "caps", …}]}` |
| `{"call": "behavior_kit"}` | `{"ok": true, "results": [{"backend", "fixture", "measured", "answer", "tolerance", "caps", "result", "what", …}], …}` |
| `{"call": "backend"}` | `{"ok": true, "backend": name, "reference": bool, "caps": [cap]}` |

Flags, as at the base: `deep-physics --planted <name>` on the release build, `deep-physics --backend <name>` on the
`test-backends` build. With a name it knows the process exits 0 and answers every call; the base answers
`{"ok":false,"code":"bad_input"}` and exits 2 to one it doesn't.

### The refusals (criterion 4)

Each is an issue of the check, shaped as the base's caps refusals are and read as #2009's suite reads them:

```text
tangent_speed 1 on the dynamic box   {"severity": "error", "path": "contact_materials/box/tangent_speed", "actual": 1, …}
rolling_resistance 0.05, on Rapier   {"severity": "error", "path": "contact_materials/box/rolling_resistance", "actual": 0.05,
                                      "what": "… rapier3d …", …}
the first world, on no_belts         {"severity": "error", "path": "contact_materials/belt/tangent_speed", "actual": 1, …}
```

- `path` names the field: its last three names are `contact_materials`, the material's ID and the field, separated by
  `/` (or `.`). In the dynamic body's case that is the contact material the dynamic body's shape use names.
- `actual` is the value written there, as a number.
- Where the criterion says "and the backend", `what` holds `rapier3d`. The code and the rest of the sentence are the
  implementer's.
- The first world, `tangent_speed: 1` on the static belt, is accepted on Rapier: no issue of severity `error`.

### Planted wrong programs

Each is `deep-physics --planted <name>` on the release build (the base's way of starting a wrong program), changing
nothing but what its row says: the check, caps() and the kit's data are the shipped ones. Its process must exit 0 and
answer; the judge that passes the real program must fail on it, naming what the criterion says it names.

| Name | Criterion | The wrong program | What the test holds it to | The failure names |
|---|---|---|---|---|
| **`belt_hook_left_out`** | 1 | the wrapper installs no contact hook: a belt's contacts are a plain surface's | it takes the first world and bakes it; at 2 s the box has moved less than 0.0005 m along +X; the kit's `belt_level` row reads `fail`, its `what` naming the backend and the fixture, its `answer` 1.898 m and its `measured` within 0.0005 m of 0 | the fixture `belt_level`, the answer `1.898 m` and the `0.000 m` it read, in one failure of the test's judge and in the kit's row |
| **`belt_speed_along_world_x`** | 2 | the hook applies `tangent_speed` along world +X whatever the shape use's own +X is | it bakes the turned belt; at 2 s the box is 1.898 m along world +X, within 1% | the axis, `world −Z` |
| **`belt_speed_along_level_ground`** | 3 | the hook gives the contact a surface velocity of `tangent_speed` along level ground, the horizontal direction under the belt's +X, not along the belt's direction in the contact's plane, so a slope of 10° sees cos 10° of it | it bakes the tilted belt; the box's speed up the slope is within 0.0005 m/s of 0.985 m/s at every step of the second second (steps 121 to 240); the kit's `belt_tilted` row reads `fail`, its `what` naming the backend and the fixture, `answer` 1, `tolerance` `{"relative": 0.01}`, `measured` within 0.0005 of 0.985 | the fixture, `belt_tilted` |

### The test backend (criterion 4)

**`no_belts`**: `deep-physics --backend no_belts` in the `test-backends` build, Rapier with belts left out of its
caps(), a candidate under its own name as #191's test backends are.

- `backend` answers `{"backend": "no_belts", "reference": false, "caps": […]}`, and its `caps` lack at least one cap
  that the same build's Rapier lists. The tests never spell that cap: they read it as what Rapier's `caps` hold and
  `no_belts`' don't, and hold each belt fixture's `caps` to naming one such cap.
- `behavior_kit` on it must run, so it leaves out any cap no fixture names, as #191's test backends leave out
  `soft_bodies`. A kit that refuses it before its fixtures lists no row, and the test fails saying so.
- Every belt fixture's row on it reads `excluded_by_caps`, and the same fixture reads `pass` on Rapier in the same
  build (the debug build, with no `--backend`).
- `check` of the first world on it is refused as the third line above.

### The fixtures in the behavior kit (criteria 1, 3 and 4)

**`belt_level`** and **`belt_tilted`** join `behavior_fixtures` and `behavior_kit`, each exactly once:

| Field | `belt_level` | `belt_tilted` |
|---|---|---|
| `world` | at g = 9.81 m/s², 120 Hz and 4 substeps: exactly one dynamic body, the box, each of its shape uses a `box` on a contact material of friction 0.5 with no `tangent_speed`, no velocity written but 0; exactly one body with a shape use whose contact material carries a `tangent_speed` other than 0, and that body `static`, its `tangent_speed` 1 and its friction 0.5 | the same; its tilt isn't read from the document, the planted row's 0.985 m/s holds it to 10° |
| measure | how far the box is at 2 s, step 240, from where it was built, in metres | the box's speed up the slope once it holds it, in m/s |
| `answer` | 1.898 as printed, read within half a unit of its last digit (the closed form, 2 − 1 ÷ (2 × 0.5 × 9.81) = 1.89806 m, is inside it) | exactly 1 |
| `tolerance` | `{"relative": 0.01}` | `{"relative": 0.01}` |
| `caps` | a cap `no_belts` leaves out of Rapier's | the same |

The row of each on Rapier reads `pass`, with `backend: "rapier3d"`, the interface's `answer` and `tolerance`, and a
`measured` within 1% of 1.89806 m, or of 1 m/s. For `belt_level` the fixture's own world, baked by the test for 240
steps, has moved its box within 0.00001 m of what the kit measured. "The belt fixtures" of criterion 4 are every
fixture whose world writes a belt, these two among them.

## The worlds

All on #191's `world` defaults: `physics.world@1`, 3 dimensions, 120 Hz, 4 substeps, gravity (0, −9.81, 0), seed 191,
mode `dynamic`, backend `rapier3d` `=0.36.1`, every solver, combine and checkpoint field unwritten (friction combines
by the geometric mean, 0.5 against 0.5 is 0.5; a checkpoint every 60 steps). Two contact materials, `belt` and `box`,
each `{friction: 0.5, restitution: 0, density: 1000}`. A static body `belt`, one box of half (10, 0.1, 10) m on the
material `belt`, its top face through the origin. A dynamic body `box`, one box of half 0.25 m on the material `box`,
built at rest touching the belt's top face above the origin, `sleep` unwritten. Two seconds are 240 steps.

| World | What it writes | Read along |
|---|---|---|
| the first world (ac1, ac4, ac5) | `contact_materials.belt.tangent_speed: 1` | world +X, (1, 0, 0) |
| the turned belt (ac2) | the same, the belt's `pose.rot: [0, 90, 0]` | world −Z, (0, 0, −1) |
| the reversed belt (ac2) | `tangent_speed: -1` | world +X, where −1.898 m is due |
| the tilted belt (ac3) | `tangent_speed: 1`; the belt's and the box's `pose.rot: [0, 0, 10]`, the belt at (0.1 sin 10°, −0.1 cos 10°, 0), the box at (−0.25 sin 10°, 0.25 cos 10°, 0) | up the slope, (cos 10°, sin 10°, 0) |
| a belt on the dynamic body (ac4) | no `tangent_speed` on `belt`; `contact_materials.box.tangent_speed: 1` | |
| rolling resistance (ac4) | no `tangent_speed`; `contact_materials.box.rolling_resistance: 0.05` | |
| the plain surface (ac5) | no `tangent_speed` | |
| the sliding box (ac5) | no `tangent_speed`; the box's `velocity.linear: [2, 0, 0]` and `sleep: false` | |

Angles are degrees, turned about X, then Y, then Z in fixed axes (Units and axes), so `[0, 90, 0]` turns the belt's +X
onto world −Z and `[0, 0, 10]` lifts it 10°. `BASE-FAILURE.txt` lists how the base runs these worlds with
`tangent_speed` left out: each is accepted and bakes, and the box rests.

## Criteria to tests, and the wrong program each fails on

- **ac1, `#2241.b41ad7e6`.**
  1. The first world baked 2 s: the box's speed along +X is first within 1% of 1 m/s at a step within 2 steps of
     0.2039 s (steps 23 to 26); at step 240 it has moved 1.898 m along +X within 1%, and no more than that 1% across
     it; each of the belt body's 241 states is its built pose with zero velocities. Fails on the base, which refuses
     the world.
  2. `belt_level` in the kit's data and its row on Rapier, as the table says; the pass judge is shown to fail on the
     same row measuring 0 m. Fails on the base, which has no such fixture.
  3. Under `belt_hook_left_out` the first world bakes and the box stays put; the first test's judge fails on it, naming
     `belt_level`, `1.898 m` and `0.000 m`; the kit's row fails as the table says. The wrong program is the planted
     wrapper; the base doesn't know the name.
- **ac2, `#2241.7f1a12a6`.**
  1. The turned belt's box at 2 s is 1.898 m along world −Z within 1%, and the reversed belt's −1.898 m along x within
     1%, each no more than that 1% across its axis. Fails on the base, which refuses both worlds.
  2. Under `belt_speed_along_world_x` the turned belt's box is 1.898 m along world +X within 1%; the first test's
     judge fails on it, naming `world −Z`. The wrong program is the planted wrapper.
- **ac3, `#2241.cd4957bd`.**
  1. The tilted belt baked 2 s: the box's speed up the slope is first within 1% of 1 m/s at a step within 2 steps of
     0.3198 s (steps 37 to 40), and within 1% of 1 m/s at every step from that one to step 240. Fails on the base.
  2. `belt_tilted` in the kit's data and its row on Rapier; the pass judge is shown to fail on the same row measuring
     0.985 m/s. Fails on the base.
  3. Under `belt_speed_along_level_ground` the box holds 0.985 m/s up the slope through the second second; the first
     test's judge fails, naming `belt_tilted`; the kit's row fails as the table says. The wrong program is the planted
     wrapper.
- **ac4, `#2241.385c4a4d`.**
  1. On Rapier: the first world is accepted, `tangent_speed: 1` on the dynamic box's material is refused naming the
     field, and `rolling_resistance: 0.05` is refused naming the field and `rapier3d`. Fails on the base, which refuses
     the static belt too; a program that takes a belt on any body fails the second leg.
  2. On `no_belts`: its manifest, each belt fixture `excluded_by_caps` on it and `pass` on Rapier in the same build,
     and the first world refused naming the field. The pass on Rapier shows the exclusion isn't every backend's. Fails
     on the base, whose `test-backends` build has no such backend.
- **ac5, `#2241.7a6dcc6f`.**
  1. The first world baked 2 s into a store, then sought to step 120 and played 120 steps on: the seek starts from a
     checkpoint after the built world and at or before step 120, and each of its step hashes is the straight run's.
     Not vacuous: no hash after the seek repeats the one before it, and the same judge fails on the same seek with its
     last hash swapped for its first. Fails on the base, which doesn't bake the world.
  2. The plain surface and the sliding box: all 241 step hashes are the same strings on this checkout's release build
     and the merge base's. Not vacuous: the first world's hashes differ from the plain surface's, so the hash sees a
     belt. This leg is why the test fails on the base, where the two worlds already match (the merge base is the
     base); after the work, a hook that disturbs a contact with no `tangent_speed` fails the comparison itself.

## Readings, where the issue and the design leave a choice

1. **"Reaches 1 m/s".** The first step whose state has the box's speed along the direction within 1% of 1 m/s, the
   bound the criteria give for that speed. "Within 2 steps": that step's time is within 2 ÷ 120 s of the worked time
   in full (0.20387 s, 0.31980 s), not of its three printed digits.
2. **"Has moved … along".** The box's position at step 240 less its built one, taken along the direction; and, since
   it is carried along that direction, no more than the criterion's 1% of 1.898 m (0.019 m) across it, its sinking
   into the contact included.
3. **"Then holds that speed".** To 2 s, the span criterion 1 gives; the issue names no end.
4. **"The belt's body never moves".** Every one of its 241 states has its built `pos` and `rot` and zero `linear` and
   `angular`.
5. **The poses.** "Turned 90° about +Y" and "tilted 10° up along its +X" are the belt body's `pose.rot`, `[0, 90, 0]`
   and `[0, 0, 10]`. Scope marks the direction's rule "(drafted)", so only what the criteria state of it is tested:
   the body's pose turns it. No test writes a shape use's `offset`.
6. **What the issue leaves unsized.** The box (half 0.25 m, 1,000 kg/m³, as the block on the kit's slope), the belt
   (20 m square, 0.2 m thick), a contact material for each, and the box's `sleep` left at its default: a carried box
   never slows under the sleep speed.
7. **Fixture names and measures.** `belt_level` for criterion 1's "new fixture", measuring the 1.898 m; `belt_tilted`
   for criterion 3's "the fixture", measuring the held speed, since its planted wrapper "fails the 1% bound" at
   0.985 m/s. The two times (0.204 s, 0.320 s) are judged on the tests' own worlds, not as fixtures. Criterion 2 names
   no fixture, so the turned and the reversed belt are the tests' own worlds; if the kit holds them too, criterion 4's
   test holds them to `excluded_by_caps` and `pass` like any belt fixture.
8. **"Naming the field".** The issue's `path` ends `contact_materials/<ID>/tangent_speed` (or `rolling_resistance`)
   and its `actual` is the value, as the base's caps refusals and #2009's reader have it. `tangent_speed` is a contact
   material's field; "on a dynamic body's shape use" is the material that use names, here used by nothing else.
   "And the backend" is `rapier3d` in `what`. No code is asserted.
9. **"Naming the fixture, the answer 1.898 m and the 0 m it read".** Held twice: one failure of the test's own judge
   holds `belt_level`, `1.898 m` and `0.000 m`; and the kit's row names the fixture in `what`, with `answer` 1.898 and
   `measured` 0. "0 m" is read to the printed millimetre (under 0.0005 m): at the base a box at rest on a plain surface
   drifts 0.008 mm and sinks 0.069 mm in 2 s.
10. **"Naming the axis".** Nothing the program answers names an axis, so it is the test's judge that names `world −Z`
    in its failure. "The wrong way" is read as world +X by the same 1.898 m.
11. **"Leaves belts out of its `caps()`".** Read through `backend`'s `caps`, the list #191's kit excludes by: a belt
    fixture names a cap in its `caps`, Rapier lists it and `no_belts` doesn't. The cap's spelling is the implementer's.
12. **"Refuses the first world, naming the field"** on `no_belts`: the field and its value; the criterion doesn't ask
    for the backend's name there, so none is asserted.
13. **"Sought to 1 s and played on".** `to: 120`, `play: 120`, to the bake's end, over a bake of 240 steps kept in a
    store; the seek must restore a checkpoint (`from` after step 0), as Checkpoint ring says a seek does.
14. **"A world with no `tangent_speed`".** The field left out, on two worlds: the first world without it, and the same
    with its box sliding from 2 m/s and kept awake, so a contact works at friction while the hashes are compared.
    "Byte-identical": the `step_hashes` strings are equal, all 241. The merge base is `git merge-base HEAD
    origin/main`, built through #191's `mergeBasePhysics`.

Found in the inputs, and not settled here: `docs/canvas-primitives.md`, Contact material, still says Rapier has no
tangent speed and that caps() refuse it other than 0. The issue reopens that line; these tests follow the issue, and
bringing the design text in line is the work's, not this suite's. Nothing in the criteria proved impossible to test;
each clause that needed a reading is above.

## What isn't asserted, because no criterion says so

- A belt in 2D (the contact's tangent, counter-clockwise), which Scope marks "(drafted)".
- A shape use's `offset` turning the direction, also "(drafted)".
- A `tangent_speed` on a kinematic body's shape use, which Scope allows.
- A `tangent_speed: 0` written out; the criterion's world leaves the field out.
- The spelling of the belt cap, the refusals' codes and sentences beyond the names above, and what `declared` says.
- The belt fixtures on wasm32 or any target but the one the tests run on.
- Which step `belt_tilted` reads its speed at, and whether the kit holds fixtures for the turned belt, the reversed
  belt or the two times.
- The box's turn or spin, the contact occurrences a belt writes, and any timing or cost.
- A character body on a belt, a belt whose speed a channel drives, rolling resistance that runs, and a surface that
  turns: Scope leaves them out of this task.
- The order the Proof line shows its evidence in.

`BASE-FAILURE.txt` is each file's run at the base, with each test's result and failing assertion.
