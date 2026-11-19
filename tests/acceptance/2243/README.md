# Acceptance tests for #2243: character bodies that meet: two walkers stop at each other, in order, and never end a step inside one another

Written first, blind, from issue #2243 as saved on November 18, 2026 (its opening paragraph, Scope, four acceptance
criteria, Proof line, Runs on line and dependency; it has no comments and no Oracle line), the design sections it
links and base commit `9d0256132` ("Merge pull request #2836 …"), by a job that never saw an implementation, a diff of
one, or any other worktree, branch or pull request. An earlier run of the same job, under the same brief and the same
inputs, drafted the test files, `helpers.ts`, `tsconfig.json` and `twins.json` and stopped before it finished. A fresh
run of the job reviewed them against the issue as its own draft, type-checked them, ran them at the base and wrote
this file and `BASE-FAILURE.txt`; it changed nothing in the tests and took the test backend out of `twins.json`
(Readings, below). The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job (design: Dogfooding). Lean: one test per criterion clause that needs its own run, plus one per
planted wrapper and per test backend the criteria name.

## Files, one per criterion

| File | Criterion | Tests |
|---|---|---|
| `ac1-head-on.test.ts` | `#2243.710b06f5`: two walkers head-on come to rest 0.61 m apart, each writes `contact_begin` naming the other, no step ends under 0.609 m; the planted wrapper that moves both against the last step's poses reads 0.600 m on step 102 and fails, naming the step and both bodies | 2 |
| `ac2-into-standing.test.ts` | `#2243.94c09b0c`: one walks into the other, which wants no move: it stops 0.61 m away and the standing one never moves more than 1e-6 m; the planted wrapper that lets the approach move the standing one fails, naming the body | 2 |
| `ac3-seek-and-order.test.ts` | `#2243.369a5712`: the head-on world sought to 0.5 s and played on has the straight run's step hashes; with the priorities swapped each run repeats by hash and the midpoint at rest moves no more than 0.0333 m | 2 |
| `ac4-behavior-kit.test.ts` | `#2243.2a71ec4b`: the test backend that leaves moved characters' poses stale fails the kit's head-on fixture, naming the backend, the fixture, 0.609 m and the 0.600 m it read; a backend without a character controller reads `excluded_by_caps` on both fixtures and passes the rest | 2 |
| `helpers.ts` | the world, the judges and the runner, over `../182/helpers.ts` and `../191/helpers.ts` (imported read only) | |
| `twins.json` | criteria 1 and 2 to their planted names | |
| `BASE-FAILURE.txt` | each file run once at the base | |

## What was read

- The issue, as the job's inputs hold it (`gh issue view 2243 --repo windoliver/deepbuild`, saved November 18, 2026,
  and its body byte for byte). This job reads no GitHub; the criterion IDs were computed from the saved body.
- `docs/canvas-primitives.md`: Body `body@1`: character; World and backend `physics.world@1` (the step order, the
  backend interface with `move_character`); Occurrence list; Checkpoint ring; Bake; Physics: behavior kit.
  `docs/technical-design.md`: The physics module (Character body; Behavior kit); Criteria to tests; Wrong programs;
  Dogfooding; Tests written first. AGENTS.md.
- At the base, for surfaces only: `tests/acceptance/182/` (helpers, README, its wrong-controller test), `191/`
  (helpers), `2306/` (README, `BASE-FAILURE.txt`, `twins.json`), `2309/` (README, `BASE-FAILURE.txt`), `522/` (its
  seek call);
  `crates/deep-physics-rapier` (`main.rs`, `planted.rs`'s names, `runner/kit.rs`'s test backends and calls);
  `crates/deep-canvas-physics` (`kit.rs`'s fixture, row and report, `kit/walks.rs`'s character fixtures);
  `scripts/proof-change.mjs` (criterion IDs), `scripts/proof-runs.mjs` (`twins.json`), `scripts/lanes.mjs` (`alone`).
- Nothing outside those inputs was needed. The pinned engine's source was not read.

## What the base already does

These tests don't credit any of it to the work (`BASE-FAILURE.txt` has the numbers).

- A world with two character bodies checks and bakes. Each moves against the last step's poses, the other character's
  included, so the base is the program criterion 1's planted wrapper names: in the head-on world the axes first end a
  step under 0.609 m on step 102, at 0.600057 m, and from then on flip between 0.600057 m and 0.633391 m every step.
  Neither body ever rests: each is 0.016667 m from where it stood at 1 s one step later.
- Each body's controller first touches the other on step 103, and each writes its `contact_begin` there (two rows of
  the pair at that step), within four steps of 0.8475 s. The base already meets that clause.
- One walking into the other, which wants no move: the walker stops with the axes 0.610001 m apart and the standing
  one moves 0 m, whichever of the two walks. The base already meets criterion 2's first sentence, so that test passes
  at the base; the program it fails on is the planted `approach_moves_standing`.
- A seek to 0.5 s played on has the straight run's step hashes; a second run repeats the first by hash, as written and
  with the priorities swapped; the midpoint doesn't move. Criterion 3 names no planted program. Both of its tests fail
  at the base on what the criterion says of the world: it reads the midpoint "at rest" and seeks "the head-on world",
  which comes to rest, and at the base the two bodies never do.
- A body's `priority` is honored: the rows of the pair name `guard` as `a` as written and `hero` when swapped, and the
  two worlds have their own bake keys and step hashes.
- The behavior kit holds eight character fixtures (`character/slope`, `step`, `snap`, `jump`, `grounded_0.04`,
  `grounded_0.07`, `sliding_30`, `sliding_50`), each naming `character_controller`, and neither of this issue's two.
  #182's test backend `no_character_controller` is admitted and reads `excluded_by_caps` or `pass` on every fixture.
- An unknown planted or backend name answers `{"ok": false, "code": "bad_input"}` and exits 2: the base knows neither
  planted name and no `stale_character_poses`.

## Run them

```sh
npm ci                          # once, if node_modules is missing
# the builds first, each through the one build slot:
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  nice -n 10 sh scripts/lease cargo build --locked -j 6 --release -p deep-physics-rapier --bin deep-physics
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  nice -n 10 sh scripts/lease cargo build --locked -j 6 -p deep-physics-rapier --bin deep-physics --features test-backends
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/2243 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2243/tsconfig.json   # type-check
rm -rf tests/acceptance/2243/node_modules                                     # vitest's cache
```

| File | Builds (each once per file, copied out of the target folder) |
|---|---|
| `ac1`, `ac2`, `ac3` | `cargo build --locked --release -p deep-physics-rapier --bin deep-physics` (#191's `release`) |
| `ac4` | `cargo build --locked -p deep-physics-rapier --bin deep-physics --features test-backends` (#191's `test`) |

The suite's own cargo calls find those builds made and only copy them. Every test, and this suite's own hook, passes
#191's 60-minute timeout; #191's build hook passes four times that. Node built-ins and vitest only;
`../182/helpers.ts` and `../191/helpers.ts` are imported read only. No process is started but `cargo` and
`deep-physics`, each waited for; none is stopped by name or port, and a `deep-physics` that outlives its limit is
stopped through the child the test started. A bake's store is a temp folder deleted after its test. No test times
anything, so none depends on the machine or its load.

## The surface under test

The issue names no call, field or flag of its own. These tests drive `deep-physics` (JSON lines in, one reply a line)
as #182, #191 and #522 left it, and their READMEs' surfaces stand as written:

| Call | What these tests write and read |
|---|---|
| `{"call": "bake", "world", "steps": 360, "track", "read": ["guard", "hero"]}` (and `"store"`, `"checkpoints": true` for the seek) | `bodies.<ID>[k]`, the state after step k (index 0 the world as built): its `pos` and its own `character.touching: [{body, index, shape}]`; `occurrences`, rows `{step, kind: "contact_begin", a, b, …}` with `a` the body earlier in canonical order; `step_hashes`, 361 strings; `key` |
| `{"call": "seek", "world", "track", "steps": 360, "store", "to": 60, "play": 300, "read"}` | `from` (60, the checkpoint it restored) and `step_hashes`, 301 strings |
| `{"call": "backend"}` | `backend` (the name) and `caps` |
| `{"call": "behavior_fixtures"}` | `fixtures: [{name, world, steps, track, answer, tolerance, caps}]` |
| `{"call": "behavior_kit"}` | `backend`, `admitted`, `verdict`, `results: [{backend, fixture, result, measured, answer, tolerance, caps, what}]` |

A track entry is `{"step": 0, "kind": "move", "target": "guard", "data": {"velocity": [2, 0, 0]}}`.

**Every name below marked *(ours)* is this job's choice**, the least the criteria need, named after what the issue
says the thing does. The implementer builds exactly these, or a dispute goes to a blind redraft.

### Planted wrong programs

Each is `deep-physics --planted <name>` on the shipped build (the base's way of starting a wrong program), changing
nothing but what its row says. Its process must exit 0 and bake; the judge that passes the real program must fail on
its bake, naming what the criterion says. `twins.json` maps each criterion's ID to its planted name.

| Name | Criterion | The wrong program | Its bake, and what the judge's failure names |
|---|---|---|---|
| `characters_against_last_step` *(ours)* | 1 | the wrapper moves every character body against the last step's poses, the other character bodies' included, as the base does | in the head-on world the first step that ends with the axes under 0.609 m apart is step 102, at 0.600 m within 0.0005 m; a failure starts `step 102: ` and names `guard` and `hero` |
| `approach_moves_standing` *(ours)* | 2 | the wrapper lets a walker's approach move a character body that wants no move | in at least one of the two runs (each body in turn the walker) the standing body is more than 1e-6 m from where it was built at some step; in each such run a failure starts with the standing body's ID (`hero: the standing body …` or `guard: the standing body …`) |

Example: `deep-physics --planted characters_against_last_step`, fed the head-on world's bake call.

### The test backend

`deep-physics --backend stale_character_poses` *(ours)*, in the `test-backends` build only, as #182's and #191's
test backends are: Rapier, with each moved character's pose left stale until the backend step, so a character moved
later meets the others where the last step left them.

- `backend` answers `{"backend": "stale_character_poses", "caps": [… "character_controller" …]}`, and the kit admits
  it (`admitted: true`), so the kit runs the character fixtures on it.
- It bakes: `{"call": "bake", "world": <the fixture's world>, "steps": <the fixture's>, "track": <the fixture's>,
  "read": [<its two character bodies>]}`. In that bake the first step that ends with the two axes under 0.609 m apart
  reads 0.600 m, within 0.0005 m.
- Its `behavior_kit` holds `character/head_on` once, as a fail that names all four things the criterion lists:

```text
{"backend": "stale_character_poses", "fixture": "character/head_on", "result": "fail",
 "what": "… stale_character_poses … character/head_on … 0.609 … 0.600 …", …}
```

  `what` holds the backend's name and the fixture's name as written, the bound as the number 0.609, and the distance
  it read as a number within 0.0005 m of what the bake above reads at that first step (0.600, 0.6001 or 0.600057 all
  count; 0.61 and 0.609 don't).

`--backend no_character_controller` is #182's, unchanged: its `caps` lack `character_controller`.

### The fixtures in the behavior kit

Two join `behavior_fixtures` and `behavior_kit` once each, beside #182's character fixtures:

| Name | Answer, as printed | Tolerance | `caps` | Its world and track |
|---|---|---|---|---|
| `character/head_on` *(ours)* | 0.61 (m) | `{"m": 0.001}` | names `character_controller` | at 120 Hz, exactly two character bodies, each one capsule of radius 0.3 m with offset 0.01 m (written or left to its default), built 4 m apart along x and level along z; each one's track entries are `move`s of 2 m/s along x toward the other, its first stamped at step 0; `steps` at least 360 |
| `character/into_standing` *(ours)* | 0.61 (m) | `{"m": 0.001}` | names `character_controller` | the same two bodies, 4 m apart at 120 Hz; one's track entries are `move`s of 2 m/s along x toward the other, its first stamped at step 0, and the other has no entry, or none but moves of zero |

The fixture's body IDs, its floor and what its measure is called are the implementer's. Rapier passes each in the
`test-backends` build: one row, `result: "pass"`, the row's `answer` and `tolerance` the interface's, and `measured`
within 0.001 m of 0.61. On `no_character_controller` each reads `excluded_by_caps`.

## The world

One world serves criteria 1, 2 and 3, on #182's `characterWorld` defaults: 120 Hz, 4 substeps, gravity (0, −9.81, 0),
seed 182, one contact material of friction 0.5. A static `floor` *(ours)*, a box spanning x −8 to 8 m and z −2 to 2 m
whose top face is y = 0. Two character bodies, `guard` *(ours)* at x = −2 m and `hero` *(ours)* at x = +2 m, each
#182's capsule (radius 0.3 m, half height 0.6 m) with `character: {offset: 0.01}`, standing 0.01 m above the floor,
their axes 4 m apart along x. `guard` has `priority: 0` and `hero` `priority: 1`, so `guard` is earlier in canonical
(priority, ID) order; the swapped world gives `guard` 1 and `hero` 0. One input, `walk` (`kind: move`, targets both).

- **Head-on** (criteria 1 and 3): both moves stamped at step 0, `guard` at (2, 0, 0) m/s and `hero` at (−2, 0, 0).
- **Into standing** (criterion 2): one move on the track, the walker's; the other body has no entry. Run once for each
  body as the walker, since which of them moves first differs.

Every run is 3 s, 360 steps. The distance between the axes is the distance along x and z, the axes standing along +Y.

## The tests

IDs are `scripts/proof-change.mjs`'s; each `describe` and `it` title starts with its criterion's ID.

| File | Test | What fails it |
|---|---|---|
| `ac1-head-on` | head-on | a step from 1 to 360 ending with the axes under 0.609 m apart (the failure names the first such step and both bodies); the axes not 0.61 m apart within 1 mm at a step from 120 to 360; a body more than 1 mm from where it stood at step 120 at a step up to 360; a body whose `touching` never names the other, or first names it outside steps 98 to 105; no `contact_begin` row of the pair at that step, or one where both first touch on the same step |
| | twin: `characters_against_last_step` | the process not exiting 0; the judge finding nothing wrong; the first step under 0.609 m not step 102, or not 0.600 m within 0.0005 m; no failure starting `step 102: ` that names `guard` and `hero` |
| `ac2-into-standing` | each walks into the other | in either run, the standing body more than 1e-6 m from where it was built at any step; the axes not 0.61 m apart within 1 mm at a step from 240 to 360 |
| | twin: `approach_moves_standing` | the process not exiting 0; the judge finding nothing wrong; no run whose standing body moved more than 1e-6 m; such a run with no failure starting with the standing body's ID |
| `ac3-seek-and-order` | seek | the straight run not at rest from 1 s to 3 s (criterion 1's measure); a hash that doesn't change from one walking step to the next; the seek not starting from step 60; its 301 step hashes not the straight run's from step 60 on, string for string |
| | swapped | either order not at rest from 1 s to 3 s; either order's 361 step hashes not the same strings from a second process; the midpoint of the two axes at step 360 more than 2 × 2 ÷ 120 m apart between the orders; the swapped world having the bake key of the world as written |
| `ac4-behavior-kit` | stale poses | `--backend stale_character_poses` not running; `character/head_on` not in the data as the table says; the fixture's own bake on it never under 0.609 m, or not 0.600 m there; the manifest's name or caps, the admission, or the row not as The test backend says; the same fixture not passing on Rapier |
| | no controller | either fixture not in the data as the table says; either not `excluded_by_caps` once on `no_character_controller`; a fixture naming a cap it lacks not excluded, or any other fixture not `pass`; its verdict not `pass`; either fixture not passing on Rapier |

Test count: 2 + 2 + 2 + 2 = 8. `BASE-FAILURE.txt` is the run at the base: seven fail at their own assertions and one
passes, as it should (criterion 2's first test; What the base already does).

Nothing missing or unrun passes: a process that can't start fails `BLOCKED:`, one that doesn't finish, a run short of
its 361 states or hashes, a hash that doesn't follow the bodies, or a swap that reaches nothing fails `INCONCLUSIVE:`.

## Readings where the issue and the design leave a choice

- **"Come to rest … within 1 mm"** and **"from 1 s to 3 s neither moves more than 1 mm"**: both are held at every
  step from 120 to 360. The axes are 0.61 m apart within 1 mm at each, and each body is within 1 mm of where it stood
  at step 120, in all three axes.
- **"At the end of every step"**: the states after steps 1 to 360.
- **"Each writes `contact_begin` naming the other within four steps of 0.8475 s"**: 0.8475 s is step 101.7, so steps
  98 to 105. Rows are canonical, so the two rows the bodies write of each other name the same pair; whose row is whose
  is read from each body's own `touching`, which the design says its `contact_begin` compares against. The first step
  a body's `touching` names the other lies in the window, and the list holds a `contact_begin` row of the pair at that
  step: two where both first touch on one step.
- **"Reads 0.600 m on step 102"**: read within half a unit of its last printed digit, at the first step under the
  bound. **"Naming the step and both bodies"**, **"naming the body"**: the judge's own failure line, as #2306's and
  #2309's twins are held; the body named is the standing one.
- **"One of them walks … into the other"**: the same two bodies in the same world, with one move on the track.
  **"It stops"**: held through the last second, steps 240 to 360; the walker arrives at (4 − 0.61) ÷ 2 = 1.695 s.
  **"Never changes"**: every state from step 1 on against the body as built.
- **"Sought to 0.5 s and played on"**: #522's seek of a bake kept in a store with its checkpoints, one every 60 steps,
  to step 60 and played 300 steps. **"Each run is the same by hash on a second run"**: the world as written and the
  swapped world, each baked by two processes. **"The point midway between them at rest"**: the midpoint of the two
  axes after step 360, compared between the two orders. **"Two steps' walk, 0.0333 m"**: the closed form, 2 × 2 ÷ 120.
- **Criterion 3 at the base**: it names no planted program, so each of its tests holds its runs to the head-on world
  at rest by criterion 1's measure, which the criterion states ("at rest") and the base lacks.
- **The fixtures' answer and tolerance**: criteria 1 and 2 both give 0.61 m within 1 mm, so each fixture's `answer`
  is 0.61 and its `tolerance` `{"m": 0.001}`; 0.609 m is that answer less its tolerance. The measure is left open.
- **"Naming the backend, the fixture, the 0.609 m bound and the 0.600 m it read"**: in the row's `what`, as #182's
  wrong controllers are named, with the row's `backend` the test backend's. What it read is checked against a bake of
  the fixture's own world on that backend, so the number is the program's and not a text alone.
- **"Passes the rest"**: on `no_character_controller` every fixture naming a cap the backend lacks reads
  `excluded_by_caps`, every other reads `pass`, and the verdict is `pass`.
- **`twins.json`** lists the two planted names, each reached through `--planted`. Criterion 4's wrong program is a
  test backend, reached through `--backend`, and criterion 3 names none, so neither has an entry.

## Not asserted, because no criterion says so

`contact_end` when the two part (they never part in these worlds); a row's shape-use fields and payload; which of the
two stops short, and that the midpoint differs between the orders at all; the stale backend's `measured`, its result
on `character/into_standing`, or the step it names; `character/into_standing`'s `steps`; the kit on another target;
any budget or timing; the design's text. Characters that push each other or take turns, crowds, a character standing
on another and a carried character are the issue's "Not in this task".

## What the implementer adds outside this folder

`'tests/acceptance/2243/'` in `scripts/lanes.mjs`'s `alone` list (the files build `deep-physics`, shipped and with
`test-backends`); this README is the instruction, the implementer makes that edit. The two planted names, the test
backend and the two fixtures above, in the crates. Nothing in this folder changes.
