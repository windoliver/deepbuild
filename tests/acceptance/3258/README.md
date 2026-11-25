# Acceptance tests for #3258: a soft body that passed through what it met fails the audit

Written first, blind, from issue #3258 (its opening paragraph, Scope, six acceptance criteria and Proof line; it has no
comments), the design sections it names and base commit `b41a1b521` ("Merge pull request #3324 …", origin/main when the
job started), by a job that never saw an implementation; none existed, and no other worktree, branch, pull request or
plan was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of
this job (design: Dogfooding). Lean: one file per criterion, one test per clause that needs its own run, plus one per
planted reading the criteria name.

| File | Criterion | Tests |
|---|---|---|
| `ac1-rope-through-plate.test.ts` | `#3258.acf18c87`: on the build whose soft solver meets no contact, the rope let go 0.5 m over a 5 mm plate fails `soft.through`, naming the first particle through, the plate and the step; the planted audit that reads only contact pairs passes the run and fails | 2 |
| `ac2-rising-plate.test.ts` | `#3258.96b5e231`: the plate that rises through the pinned rope fails, naming a particle that never moved; the plate that turns back reads 0; the world-frame and single-step readings read nothing and fail, and the one that counts what was inside fails | 5 |
| `ac3-peg-between-particles.test.ts` | `#3258.e4187366`: the rope lowered past the peg fails, naming the edge and the peg; lowered beside it, it passes | 2 |
| `ac4-soft-through-soft.test.ts` | `#3258.5e7ec8a8`: the cloth let go over a second fails, naming both, the particle and the face; the crossed rope fails with `self_contacts: true`, naming both edges, and with it off passes and `self_through` reads that count | 2 |
| `ac5-clean-on-the-pinned-backend.test.ts` | `#3258.940c680d`: #524's banner, rope and soft labs, and the kit's soft fixtures, read 0 on the pinned backend; the rope dragged over a box's edge reads 0 | 2 |
| `ac6-budget.test.ts` | `#3258.7ba56287`: on a reference Mac at rest, the banner's 10 s audit under 1.5 × the merge base's and a world with no soft body no longer | 1 |
| `helpers.ts` | the worlds, the runners and the judges, over `../524/helpers.ts` and `../191/helpers.ts` (imported read only) | |
| `twins.json`, `lane.json`, `tsconfig.json` | each criterion's planted names; the suite runs alone; its type-check | |
| `BASE-FAILURE.txt` | the run at the base, with the merge base's run of criterion 1's rope | |

Test count: 2 + 5 + 2 + 2 + 2 + 1 = 14.

## What was read

- The issue, with `gh issue view 3258`; for context only, the titles and states of #132 and #1786.
- `docs/canvas-primitives.md`: Check input: loop kinds (`physics.audit`'s settings); `soft@1`; World and backend
  `physics.world@1`. `docs/technical-design.md`: Soft body and checkpoint ring; How we know version 0 works (Dogfooding;
  Criteria to tests; Wrong programs); Tests written first; Repo guards. `docs/parallel-proof.md` §12a. AGENTS.md.
- At the base, only for surfaces: `tests/acceptance/524/` (README, helpers, `ac1`, `ac3`, `ac5`, `ac7`, `twins.json`),
  `2239/`, `1918/`, `2009/`, `191/`, `522/`, `2310/`, `2241/`, `2317/`, `3218/`, `3219/` (their helpers and budget or
  merge-base tests); `crates/deep-physics-rapier` (`runner/audit.rs`, `runner.rs`, `main.rs`, `planted.rs`, `soft.rs` with
  both solvers, `runner/kit.rs`, `runner/fast.rs`, `Cargo.toml`); `crates/deep-canvas-physics` (`doc/soft.rs`,
  `doc/shape.rs`, `doc.rs`'s shapes, `kit.rs`'s fixtures); the three labs; `benchmarks/physics.mjs`,
  `benchmarks/budgets.json`, `scripts/benchmark.mjs`; `scripts/proof-change.mjs` (criterion IDs), `scripts/proof-runs.mjs`
  (`twins.json`, what counts as failing at an assertion), `scripts/proof-guard.mjs` (`lane.json`).

What the base already does, which these tests don't credit: `deep-physics` audits a world document or a scene's world,
answering `verdict`, `failures` (each `{rule, id, step, measured, limit, what, fix}`, a pair in `ids`, a stretched edge in
`edge`), `readings` (`energy_gain`, `penetration`, `max_stretch`) and the `settings` it ran with; `soft.max_stretch` is
its only soft setting. Its `test-swap-soft-solver` build steps soft bodies by a small solver of ours that meets no contact
and tears nothing. It has none of `soft.through`, `through`, `self_through` and the four planted names.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs test --wait 120 -- sh scripts/lease \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/3258 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/3258/tsconfig.json --noEmit    # type-check
```

`--no-file-parallelism` is required: the two builds of `deep-physics` share the target folder, and each file copies its
binary out after its own build. Every build is `cargo build --locked -p deep-physics-rapier --bin deep-physics`, with
`--features test-swap-soft-solver` for `ac1` to `ac4` (built when a test first needs it, #524's helper) and as shipped
for `ac5` and `ac6` (#191's helper), with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set. Every test
passes a timeout of one hour or more of its own. Node built-ins and vitest only. No process is started but `cargo`, `git`,
`tar` and `deep-physics`, each waited for; none is stopped by name or port. No test waits for time.

Gates. No cargo is `BLOCKED:`. `ac6` is `INCONCLUSIVE:` off a reference Mac or under load, before it builds or times
anything. Each is a failed test, never a pass; nothing else depends on the machine.

The implementer adds `tests/acceptance/3258/ac6-budget.test.ts` to the `timed` list (`scripts/lanes-lists.mjs`). The
suite's own `lane.json` says it runs alone.

## The surface under test

Marked: *(issue)* the issue's word, *(base)* what the base's suites already drive, **bold** and *(ours)* this job's
choice, the smallest the criteria need, which the implementer builds as written.

### The audit

`{"call": "audit", "world" | "scene" + "world", "steps", "settings"?}` *(base)*. `settings.soft` takes
`{"max_stretch"?, "through"?: {"max": u32 = 0}}` *(issue)*, and the reply's `settings` echoes `soft.through.max` beside
`soft.max_stretch`. The reply's `readings` gain the counts `through` and `self_through` *(issue)*, on every audit.

### A `soft.through` failure, in `failures`

```text
a particle through a shape   {"rule": "soft.through", "id": "rope", "step": 39, "measured": 21, "limit": 0,
                              "particle": "rope#0", "shape": {"body": "plate", "index": 0, "shape": "plate"}, "what", "fix"}
a shape between particles    {… "id": "rope", "edge": ["rope#10", "rope#11"], "shape": {"body": "peg", "index": 0, …}}
a particle through a face    {… "id": "upper", "other": "lower", "particle": "upper#r0c0",
                              "face": ["lower#r0c0", "lower#r0c1", "lower#r1c1"]}
an edge through an edge      {… "id": "rope", "edge": ["rope#4", "rope#5"], "other_edge": ["rope#14", "rope#15"]}
```

- **`rule: "soft.through"`** *(ours; the issue says "fails `soft.through`")*; `id` *(base)* the soft body whose particle,
  edge or face it is; `step` *(base)* the step it is through at the end of; `limit` *(base)* `soft.through.max`;
  **`measured`** *(base's field; ours that it is the count)* how many ways through the audit counted against the limit.
- **`particle`**, **`edge`** *(base's, for a stretched edge)*, **`face`**: addresses. A full address (`rope#7`) or a local
  one is read, an edge's or a face's in any order.
- **`shape`**: the body's shape use as the runner names one, `{body, index, shape}` *(base: `shape_use`)*; `body` and
  `index` are read.
- **`other`**: the other soft body's ID, absent or the same as `id` for a body through itself. **`face`** beside a
  `particle`: the face it met, in `other`. **`other_edge`**: the edge an `edge` met.
- `fix` *(base)*: text naming one of the issue's fixes: `particle_radius`, particles closer together, more substeps, or a
  thicker shape (matched as `particle_radius`, `closer`, `substep` or `thick`). `what` is read by no test.
- One failure, or one for each way through: the tests take either. Where the criterion says "the first", the first in the
  list that names a particle is read.

### Planted readings

`deep-physics --planted <name>` on either build *(base: its way of starting a wrong program)*, changing nothing but the
audit's reading. Each process exits 0 and answers; the judge that passes the real audit fails on it. Every name is *(ours)*.

| Name | Criterion | The wrong reading | The judge's failure |
|---|---|---|---|
| **`through_reads_contact_pairs`** | 1 | reads only the backend's contact pairs: the rope's run passes, `through` 0 | the verdict, PASS |
| **`through_in_world_frame`** | 2 | takes a particle's path in the world, not in the body's frame: the rising plate reads 0 | no particle named |
| **`through_reads_one_step`** | 2 | counts only what goes in and comes out within a single step: the rising plate reads 0 | no particle named |
| **`through_counts_inside`** | 2 | counts every particle that was inside a shape: the plate that turns back reads above 0 | the reading |

`twins.json` maps each criterion's ID to its names.

## The worlds

g = 9.81 m/s², 120 Hz, 4 substeps, seed 524 (#524's `softWorld`), `particle_radius` 0 and `damping` 0 unless said. The
swapped solver steps each substep h = 1/480 s as v ← v + g h, x ← x + v h, then its edges; what falls level stays level
and unstretched, so after k steps it has dropped g h² n (n + 1) / 2, n = 4 k.

- **The rope** (criteria 1 to 3): 21 particles 0.05 m apart from (−0.5, 0.5, 0) to (0.5, 0.5, 0), 0.05 kg each, stretch
  30 Hz.
- **The plate**: a box 2 m × 5 mm × 1 m, its one shape use. Criterion 1: static, its top at y = 0. The rope has dropped
  0.4951 m after step 38 (4.9 mm over the top) and 0.5214 m after step 39 (16.4 mm under the underside): all 21 particles
  pass in step 39, and none is inside the plate at any step's end. 60 steps.
- **The rising plate** (criterion 2): kinematic, on its scene's channel, 0.1 m/s = 5/6 mm a step; its top starts 12.5
  steps (10.42 mm) below the pinned rope, so every particle is 0.42, 1.25, 2.08, 2.92, 3.75 and 4.58 mm under its top at
  the end of steps 13 to 18 and 0.42 mm below its underside at the end of step 19. 30 steps.
- **The plate that turns back**: its top starts 9.5 mm below the rope, rises 12.5 mm in 0.125 s (15 steps at 0.1 m/s), 3 mm
  past the rope, and goes back down in 15: every particle is inside it at the end of steps 12 to 18 and none at 19.
- **The peg** (criterion 3): the rope's ends pinned to two kinematic bodies that go down at 1 m/s (their shapes 0.2 m off
  its ends), the rope falling between them; a static cylinder 4 mm across and 0.1 m long, along z at (0.025, 0.2, 0),
  midway between particles 10 and 11. Worked from the bake: edge 10–11 sweeps the peg's axis in step 30, 11.0 mm over it
  before and 9.2 mm under it after; no particle's move comes closer than 23 mm to the peg. Beside it: the peg at z = 0.1.
  40 steps, the other rules set wide (`energy.max_gain` 1e6, `soft.max_stretch` 100): the edges by the ends stretch.
- **The cloths** (criterion 4): 11 × 11 particles, 0.1 m cells; `lower` at y = 0, every particle pinned; `upper` level at
  y = 0.5, 0.05 m aside along x and z. All of `upper` passes in step 39 (4.9 mm over, 21.4 mm under). 60 steps.
- **The crossed rope**: particles 0 to 9 along x at y = 0 (x from −0.225 by 0.05), pinned, and 10 to 19 along z at
  y = 0.02, `edges` the two chains, so nothing joins them; edge 4–5 and edge 14–15 cross at both their middles, at the
  origin, 2 cm apart. `upper` is 2.7 mm over after step 7 and 2.5 mm under after step 8. One pair of edges meets. 20 steps.
- **The dragged rope** (criterion 5, pinned backend): a static box 2 m × 1 m × 1 m, its top at y = 1 and its side at x = 1;
  61 particles 0.025 m apart along x from −0.45 to 1.05 at y = 1.005, stretch 120 Hz, damping 0.5, friction 0.1, the last
  pinned to a kinematic body (its shape 0.25 m off the rope's end) that goes straight down 0.8 m in 2 s. At the base 27
  particles go from the top to the side; each particle rests up to 0.4 mm inside the top, so 29 times one goes in by the top
  face and comes out of the side one, 30 times out of the top again, and never out of a face opposite. 240 steps.
- **The stack** (criterion 6): #522's `stack(3, 4, 3)`, 36 boxes; the banner is #524's, alone.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s; each test's title starts with its criterion's. A judge returns what is wrong as
sentences and each test asserts there are none, after it has read its fixture's motion back from the same binary's bake.

| File | Test | What fails it |
|---|---|---|
| `ac1` | the rope | the fixture off its motion; the verdict not FAIL; another rule failing; no `soft.through` failure naming a particle of the rope, the plate's one shape use and step 39; one before step 39; a reading missing, or the two counting nothing; a failure with no step of the run, no count over its limit 0 or no fix of the issue's; the default `soft.through.max` not 0 |
| | planted `through_reads_contact_pairs` | the planted run not answering, or not passing with `through` 0; the judge not failing it for its verdict |
| `ac2` | the rising plate | as `ac1`'s, at step 19, the rope read back as never moving and inside the plate at six steps' ends, under 1 cm deep |
| | the plate that turns back | `through` not 0, `self_through` missing, or a `soft.through` failure |
| | planted, three | the planted run not answering; the first two reading anything; the judge not failing each |
| `ac3` | the peg | no failure, or one that names another edge than 10–11, another shape use than the peg's or another step than the pass; `through` not 1 |
| | beside it | the verdict not PASS; `through` not 0; a `soft.through` failure |
| `ac4` | the cloths | no failure naming a particle; the two cloths not both named; not step 39; no face; the particle not shown by the bake to pass that face of the other cloth in that step |
| | the crossed rope | with `self_contacts` on, no failure, or one that names other edges than 4–5 and 14–15, another soft body, another step than 8 or another count than 1; with it off, the verdict not PASS, `through` not 0, `self_through` not that count |
| `ac5` | the clean fixtures | a reading missing or above 0, or a `soft.through` failure, in #524's banner and rope, its bridge and banner labs (600 steps each) or a kit fixture that holds a soft body |
| | the dragged rope | fewer than ten particles dragged over the edge or cutting its corner, or one out of a far side, by the bake; a reading missing or above 0, or a `soft.through` failure |
| `ac6` | the budget | the banner not 280 particles, the stack not free of soft bodies; a reading missing or above 0; on a reference Mac at rest, either ratio judged FAIL, or not PASS |

Every test fails at the base at a named assertion (`BASE-FAILURE.txt`).

## Readings where the issue leaves a choice

- **"Fails `soft.through`"** is a verdict of FAIL whose only failures are of rule `soft.through`. The rope's stretch, the
  fall's energy and the contacts are within the other rules' defaults in criteria 1, 2 and 4, so only `through` can fail
  them; criterion 3 sets the others wide.
- **"The first particle through", on a tie.** A rope let go level passes whole in one step, so any of its particles is a
  first. The step is the one it has come out of the far side by the end of, in criterion 2 step 19 and not the step it
  went in.
- **Between particles.** The issue counts an edge that, "clear of its own particles' spheres, meets" a thin shape. A plate
  that swallows an edge and both its particles isn't between them: criterion 2's turned-back plate, thinner than the rope's
  gaps, must read 0 with the rope's edges 3 mm inside it. So the first rule alone reads a shape the particles are in, and
  no test pins whether the plate's passing of an edge's particles counts for the edge too: the counts of criteria 1, 2 and
  4's cloths are read only as at least 1. Criterion 3's and the crossed rope's are exact, one way through each.
- **"Over a step, an edge … meets"** is read over the step's motion, not at its end: the peg is passed between two states
  that don't touch it.
- **"The first particle and the face it met"** (criterion 4): `lower`'s particles pass `upper`'s faces in the same step, and
  a cell's middle is on the diagonal its two faces share; the failure may name any particle and face of the two cloths the
  motion shows passing in the first step any does, the face three corners of one cell, either half of it.
- **A rope "written as two passes"** is one soft body, its positions the two passes and its `edges` a list that joins
  nothing between them, so each pass moves level and one pair of edges meets.
- **"The count the failure gave"** is its `measured`: 1.
- **"Read 0"** is `through` 0 and no `soft.through` failure. `self_through` must be a count; the banner, whose
  `self_contacts` is off, may fold through itself, which is a reading and never a failure. The audit's other rules aren't
  judged there: at the base #524's rope, whose stretch is 30 Hz, fails `soft.max_stretch` and `energy` at their defaults.
- **"Never 1 cm deep", "inside it for six steps"** are read at the steps' ends.
- **The budget.** The comparison with the merge base is this test's own, as #191's, #3219's and #3234's are: a task of
  `benchmarks/budgets.json` would have no merge base to be measured against on this commit and would read a first
  measurement as a pass. "No longer" is the lane's smallest margin, 5%. The merge base is pinned to `b41a1b521`.

## Where the issue and the base disagree

- **The behavior kit has no soft fixture at the base** (#1786, open, brings them): `behavior_fixtures` lists none whose
  world holds `soft`. Criterion 5's clause holds for whatever the kit has when the test runs; at the base it covers #524's
  banner, its rope and its two labs that hold soft bodies, which #524's first criterion already holds to passing the audit
  at its defaults.
- **The bridge lab's ropes and planks are in collision groups that don't meet**, and each rope runs along the planks' sides.
  A pair its document says doesn't meet is nothing to pass through: the lab reads 0.

## Not tested, because no criterion reaches it here

A plane, a heightfield or a mesh's face passed by a particle; a particle cutting a corner of a moving shape; a face that
meets a thin shape; a particle with a radius; a torn edge; `soft.through.max` above 0; more than one way through for one
pair.
