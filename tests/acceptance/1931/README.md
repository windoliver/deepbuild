# Acceptance tests for #1931: three force laws with worked answers

An inverse square, a magnetic turn and a Lennard-Jones pair, each held to an orbit, a gyration radius or a rest
distance in the behavior kit.

Written first, blind, from issue #1931 as saved for this job on November 19, 2026 (its opening paragraph, Scope, six
acceptance criteria, Proof line, `Runs on:` line and dependencies; it has no comments), the design's physics sections
and base commit `a0d3713a7` ("Merge pull request #2847 …"), by a job that never saw an implementation or a diff of
one; no other worktree, branch, pull request or issue was read, and the page the issue's Oracle line links was not
opened. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding). Lean: one test per clause that needs its own run, one per planted wrong program the criteria
name, and one for the test backend criterion 6 names.

## Files, one per criterion

| File | Criterion | Tests |
|---|---|---|
| `ac1-orbit.test.ts` | `#1931.1a76985e`: the 2 kg body stays 2 m from the point within 1% at every step for 8 s and first comes back to its start line after 4.000 s within 1%; the planted 1 ÷ r law leaves the band within 12 steps, falls to 1.067 m and fails, naming the fixture, the answer and the step | 2 |
| `ac2-substeps.test.ts` | `#1931.b13f64e3`: the orbit world at `substeps: 4` refused with `out_of_range`, naming the force and `substeps`, and taken at 1; the planted check admits it, and the admitted orbit gains energy, leaves the band within its first turn and fails the fixture, naming it and the step | 2 |
| `ac3-gyration.test.ts` | `#1931.a7ffb5c9`: the 1 kg charged body keeps 3 m/s within 0.1% at every step for 5 s on a circle of radius 0.5 m within 1%, between y = −1.000 m and 0 m, turning once every 1.047 s; the planted held law reaches 6.345 m/s and y = −1.514 m and fails, naming the speed; the planted B × v law turns between y = 0 m and +1.000 m and fails, naming the side | 3 |
| `ac4-pair.test.ts` | `#1931.e8d79a14`: the pair released 0.7 m apart is 0.5612 m apart at 10 s within 0.5%; the pair released 1.3 m apart is still 1.3 m apart; the planted law without the factor 2 rests at 0.500 m and fails, naming the fixture, the answer and the distance; the planted law without the cutoff closes the far pair to 0.561 m and fails | 4 |
| `ac5-refusals.test.ts` | `#1931.02a6e7e5`: `min_distance: 0` and `sigma: 0` refused naming the field and the value, a `lennard_jones` over 257 bodies refused with `over_budget` naming the force and 257, each before any step runs, each beside the same world taken with a legal value | 3 |
| `ac6-kit.test.ts` | `#1931.f0905250`: the kit's report lists the three fixtures' measured values beside the interface's answer and tolerance, on macOS arm64 and on wasm32; the test backend that claims the laws passes them, and with the fixtures taken out of the kit it is refused before any fixture runs, naming each law | 3 |
| `helpers.ts` | the worlds, the runner and the judges, over `../191/helpers.ts` (imported read only) | |
| `twins.json` | each criterion's ID to its planted wrong programs | |
| `BASE-FAILURE.txt` | each file run once at the base | |

## What was read

- The issue as saved for this job (title, state and body), and its body alone for the criterion IDs, each worked as
  `scripts/proof-change.mjs`'s `criterionId` works it and found equal to the ID its tests carry. The job had no access
  to the issue tracker, so #191, #520, #1786, #2009 and #2012 are known here only through their suites and the design.
- `docs/canvas-primitives.md`: Time and the flick; Units and axes; Honest numbers; The cost model; Closed enums; Canvas
  module: interface and implementation; Seam and backend; World and backend `physics.world@1`; Shape; Body `body@1`;
  Force; Bake; Golden; Physics: behavior kit. `docs/technical-design.md`: The physics module (World; Joint and force;
  Bake and golden; Behavior kit); What done means, fixed at the start; Criteria to tests; Wrong programs; Dogfooding;
  Tests written first. AGENTS.md and CONTRIBUTING.md.
- At the base, for surfaces only: the suites `191/` (README, helpers, ac1, ac4, ac6, ac7), `2241/` (README, helpers,
  ac1 to ac5, `BASE-FAILURE.txt`), `2239/` (README, `twins.json`, `BASE-FAILURE.txt`), `2009/` (helpers and its refusal
  reader) and `2012/` (its file list); `crates/deep-canvas-physics` (`doc.rs`'s world, body and force readers,
  `check.rs`, `caps.rs`, `kit.rs`, `kit/fixtures.rs`); `crates/deep-physics-rapier` (`main.rs`, `planted.rs`,
  `runner.rs`'s `check`, `bake` and issue, `runner/kit.rs`'s calls, test backends and planted kits, `lib.rs` where a
  force is pushed and a body built, `Cargo.toml`); `scripts/physics-wasm32.mjs`, `scripts/proof-change.mjs` (criterion
  IDs), `scripts/proof-runs.mjs` (`twins.json`, what counts as failing at an assertion), `scripts/lanes.mjs` (its
  `alone` list).
- The pinned backend's own source in cargo's registry (rapier3d 0.36.1, the version `Cargo.lock` pins), only to see
  how a step with several substeps treats a force: each substep adds force × dt ÷ substeps to the velocity and then
  moves the body by the new velocity, so a force is held over the step as the issue says.

Nothing else was needed, and nothing else was read.

What the base already does, which these tests don't credit: `deep-physics` checks and bakes a world document, answers
`backend`, `behavior_fixtures` and `behavior_kit`, takes `--planted <name>` and, in a `test-backends` build,
`--backend <name>`, and runs on wasm32 through `scripts/physics-wasm32.mjs`; the reader takes a force written
`{kind: {<law>: {fields}}, applies_to}` and runs `uniform`, `drag` and `spring_to_point`; it knows the three new laws
by name and refuses each at `forces/<ID>/kind` with `physics.unsupported`, naming #1931. So at the base every world of
this suite is refused at check, whatever its `substeps`, `min_distance`, `sigma` or body count: each refusal test here
holds the refusal to what its criterion names, and shows beside it the same world taken with a legal value, so none
passes on the base's refusal. The base's kit holds no force-law fixture, its caps() claim none of the three laws, and
it knows none of this suite's seven planted names or its test backend.

## Run them

```sh
npm ci                          # once, if node_modules is missing
# the builds first, each through the one build slot:
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  nice -n 10 sh scripts/lease cargo build --locked -j 6 --release -p deep-physics-rapier --bin deep-physics
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  nice -n 10 sh scripts/lease cargo build --locked -j 6 -p deep-physics-rapier --bin deep-physics --features test-backends
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  nice -n 10 sh scripts/lease cargo rustc --locked -j 6 -p deep-physics-rapier --lib --crate-type cdylib --target wasm32-unknown-unknown
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/1931 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1931/tsconfig.json     # type-check
rm -rf tests/acceptance/1931/node_modules                                       # vitest's cache
```

| File | Builds (each once per file, copied out of the target folder) |
|---|---|
| all six | `cargo build --locked --release -p deep-physics-rapier --bin deep-physics` (#191's `release`); the planted names run on it |
| `ac6` | also `cargo build --locked -p deep-physics-rapier --bin deep-physics --features test-backends` (#191's `test`, a debug build), for `--backend claims_force_laws`; and the wasm32 library, which `node scripts/physics-wasm32.mjs` builds itself before it answers |

The suite's own cargo calls find those builds made and only bring them up to date and copy them. Every test passes
#191's 60-minute timeout and each file's build hook its 4 hours. Node built-ins and vitest only, no network. No
process is started but `cargo`, `node` and `deep-physics`, each waited for; none is stopped by name or port. A process
that can't be run fails its test with `BLOCKED:`, one that doesn't finish with `INCONCLUSIVE:`; nothing unrun passes.
The copied binaries' temp folder is removed when each file ends. No test times anything, so none depends on the
machine or its load.

**`scripts/lanes.mjs` needs this line** (the files build cargo binaries); this README is the instruction, the
implementer makes that edit:

```js
// #1931's files build deep-physics (release and test-backends) and the wasm32 library.
alone.push('tests/acceptance/1931/');
```

## The surface under test

The issue names the three laws and their fields, the refusals' codes `out_of_range` and `over_budget`, `substeps`,
`caps()`, the kit and what each wrong program does. It names no call, no flag, no fixture, no row field, no cap, no
planted program and no test backend. These tests drive `deep-physics` as #191, #2009 and #2241 left it: one JSON
object per stdin line, one reply line each, and no new call. Each name below is marked: *(issue)* the issue's word,
*(design)* the design's, *(base)* what the base's suites already drive, and **bold** with *(ours)* this job's choice,
which the implementer builds exactly as written.

### The laws in a world document

A force is written as the base writes one *(base)*: under the world's `forces`, by ID,
`{"kind": {"<law>": {fields}}, "applies_to": [body ID, …]}`. The laws' names and fields are the issue's *(issue)*;
`point` is three numbers, as `spring_to_point`'s is at the base. The tests write exactly these:

```json
"forces": {"sun_pull": {"kind": {"inverse_square": {"point": [0, 0, 0], "k": -39.47841760435743, "min_distance": 0.1}}, "applies_to": ["moon"]}}
"forces": {"ion_turn": {"kind": {"magnetic": {"field": [0, 0, 3], "charge": 2}}, "applies_to": ["ion"]}}
"forces": {"pair_bond": {"kind": {"lennard_jones": {"epsilon": 1, "sigma": 0.5, "cutoff": 1.25}}, "applies_to": ["left", "right"]},
           "pair_drag": {"kind": {"drag": {"linear": 2}}, "applies_to": ["left", "right"]}}
```

Every world writes `substeps` (1, or 4 where criterion 2 says so) and every `inverse_square` writes `min_distance`
(0.1 m where it isn't the field in question), `point` and `k`; every `lennard_jones` writes `epsilon`, `sigma` and
`cutoff`. A body is the base's: `kind: "dynamic"`, `mass`, `pose.pos`, `velocity.linear`, `gravity_scale: 0`,
`sleep: false`, one sphere shape use.

### Calls and reply fields

| Call, as the tests write it | Reply fields the tests read |
|---|---|
| `{"call": "check", "world": World}` *(base)* | `{"ok": true, "issues": [{"code", "severity", "ids", "path", "actual", "what", …}]}`; a world is taken when `ok` is true and no issue has `severity: "error"` |
| `{"call": "bake", "world": World, "steps": 960, "read": ["moon"]}` *(base)* | `{"ok": true, "bodies": {"moon": [State × 961]}}`; `State` is `{"pos": [3], "linear": [3], …}`, index k the state after step k, index 0 the built one. A refused world answers `{"ok": false, "issues": […]}` with no `bodies` and no `step_hashes` |
| `{"call": "behavior_fixtures"}` *(base)* | `{"ok": true, "fixtures": [{"name", "world", "answer", "tolerance", "caps", …}]}` |
| `{"call": "behavior_kit"}` *(base)* | `{"ok": true, "target", "admitted", "refused"?: {"features": [cap], …}, "verdict", "results": [Row]}` |
| `{"call": "backend"}` *(base)* | `{"ok": true, "backend": name, "reference": bool, "caps": [cap]}` |

Flags, as at the base: `deep-physics --planted <name>` on the release build, `deep-physics --backend <name>` on the
`test-backends` build, and both together. With names it knows the process exits 0 and answers every call; the base
answers `{"ok":false,"code":"bad_input"}` and exits 2 to one it doesn't. On wasm32 the same three kit calls go
through `node scripts/physics-wasm32.mjs` *(base)*.

### The three fixtures in the behavior kit

**`inverse_square_orbit`**, **`magnetic_gyration`** and **`lennard_jones_rest`** *(ours)* join `behavior_fixtures`
and `behavior_kit`, each exactly once, each with one row. A row is the base's `{backend, fixture, measured, answer,
tolerance, caps, result, what, …}`; the fields in bold are new *(ours)*.

| | `inverse_square_orbit` | `magnetic_gyration` | `lennard_jones_rest` |
|---|---|---|---|
| `world` | criterion 1's: at 120 Hz with `substeps: 1` written; exactly one dynamic body, `gravity_scale: 0`, built 2 m from the point and launched at π m/s (3.1416 as printed) square to the line from the point; exactly one `inverse_square` force, its `point` three numbers and its `k` −4π² (−39.478 as printed) | criterion 3's: at 120 Hz; exactly one dynamic body, `gravity_scale: 0`, at the origin (or no `pose.pos`) with `velocity.linear: [3, 0, 0]`; exactly one `magnetic` force, `{"field": [0, 0, 3], "charge": 2}` | criterion 4's: at 120 Hz with `substeps: 1` written; exactly two dynamic bodies, `gravity_scale: 0`, 0.7 m apart with no velocity but 0; exactly one `lennard_jones` force, `epsilon: 1`, `sigma: 0.5`, `cutoff: 1.25` (or left to its default); exactly one `drag`, `linear: 2`, no `quadratic` but 0 |
| `answer` | exactly 2 (m) | exactly 0.5 (m) | 0.5612 (m) as printed, read within half a unit of its last digit (2^(1/6) × 0.5 = 0.561231 is inside) |
| `tolerance` | `{"relative": 0.01}` | `{"relative": 0.01}` | `{"relative": 0.005}` |
| `caps` | names **`inverse_square`** | names **`magnetic`** | names **`lennard_jones`** |
| `measured` | the body's distance from the force's `point` after each step of 8 s (steps 1 to 960): the one farthest from the answer, m | half the extent along y of the body's path over 5 s (the built state and steps 1 to 600): the circle's radius, m | how far apart the two bodies are after step 1200, m |
| other measured values in the row | **`period`**: when the body first comes back to its start line, s from the launch | **`speed`**: the body's speed after each step: the one farthest from 3 m/s. **`y`**: `[lowest, highest]` y of its path, m | |
| on a fail, also | **`step`**: the first step whose distance is outside the tolerance | | |

- Ids of bodies and forces in these worlds, the orbit's plane and where its point lies, and the gyration's `substeps`
  are the implementer's. The tests find the bodies as the world's dynamic bodies and the law by its kind.
- The cap that claims a law is the law's own name *(ours as a cap; the name is the issue's)*. Rapier's `caps` in
  `backend` hold all three, natively and on wasm32.
- On Rapier each row reads `pass` with `backend: "rapier3d"`, the interface's `answer` and `tolerance`, and: the orbit's
  `measured` within 1% of 2 m and its `period` within 1% of 4.000 s; the gyration's `measured` within 1% of 0.5 m, its
  `speed` within 0.1% of 3 m/s and its `y` no lower than −1.0005 m and no higher than 0.0005 m; the pair's `measured`
  within 0.5% of 0.561231 m.
- The kit measures the bake. On macOS arm64 the test bakes each fixture's own `world` (960, 600 and 1200 steps) and
  reads it with this suite's judges: the row's `measured`, `speed` and each end of `y` are within 0.000001 of that
  reading, and `period` within 0.0001 s (the return falls between two steps, and the two readers may each draw that
  line their own way).
- The gyration's row fails when its speed leaves 3 m/s by more than 0.1% at any step, and when its path leaves
  y = −1.000 m to 0 m, whatever its radius reads; the planted rows below hold it to both.
- `step` is read only on a failing orbit row, `period` only on Rapier's passing one.

### The refusals

Each is an issue of the check, shaped as the design shapes one and the base writes it *(design, base)*: `{"code",
"severity": "error", "ids", "path", "actual", "what", …}`, `actual` the value refused at `path`. An issue **names** an ID or a field when it is a segment of its `path`, an entry of its `ids`,
or a whole word of its `what`; it names a number when that number is its `actual` or a whole word of its `what`. What
the tests hold, with one example each (the sentences are the implementer's):

```text
substeps 4 with an inverse_square   {"code": "out_of_range", "severity": "error", "path": "substeps", "actual": 4,
                                      "what": "force sun_pull is an inverse_square, which runs at substeps 1 …"}
min_distance 0                       {"severity": "error", "path": "forces/sun_pull/kind/min_distance", "actual": 0, …}
sigma 0                              {"severity": "error", "path": "forces/pair_bond/kind/sigma", "actual": 0, …}
lennard_jones over 257 bodies        {"code": "over_budget", "severity": "error", "path": "forces/pair_bond/applies_to",
                                      "actual": 257, "what": "force pair_bond applies to 257 bodies …"}
```

- Criterion 2: an error with `code: "out_of_range"` *(issue)* that names the force's ID and `substeps`. Its `actual`
  isn't read.
- Criterion 5, a field: an error whose `path` holds `forces`, then the force's ID, and ends with the field
  (`min_distance`, `sigma`), and whose `actual` is the value written, 0. Its code isn't read: the issue gives none.
- Criterion 5, the count: an error with `code: "over_budget"` *(issue)* that names the force's ID and the number 257.
- The same world with a legal value (substeps 1; `min_distance: 0.1`; `sigma: 0.5`; 256 bodies) is taken: `ok: true`
  and no error.
- "Before any step runs": a `bake` of the refused world answers `ok: false` with the same issue, and neither `bodies`
  nor `step_hashes`.

### Planted wrong programs

Each is `deep-physics --planted <name>` on the release build *(base: its way of starting a wrong program)*, changing
nothing but what its row says: the document reader, the check, caps() and the kit's data are the shipped ones. Its
process exits 0 and answers every call; the judge that passes the real program fails on it, naming what the criterion
says. Every name is *(ours)*; `twins.json` maps each criterion's ID to its names.

| Name | Criterion | The wrong program | What the test holds it to | The failure names |
|---|---|---|---|---|
| **`inverse_square_one_over_r`** | 1 | the law falls off as 1 ÷ r: F = k × (p − point) ÷ \|p − point\|² | it takes the orbit world and bakes it; the body is first outside 2 m within 1% at a step no later than 12, and the nearest it comes to the point in 8 s is within 0.0005 m of 1.067 m. The kit's `inverse_square_orbit` row reads `fail`, its `what` naming the backend and the fixture, `answer` 2, `measured` within 0.0005 of 1.067, and `step` a step from 1 to 12, the same step the fixture's own world leaves the band at when the test bakes it under the same planted law | the fixture, `the answer 2 m` and `at step <that step>`, in one failure of the test's judge and in the kit's row |
| **`check_admits_force_substeps`** | 2 | the check takes a world holding `inverse_square` (or `lennard_jones`) at any `substeps`; the laws, and how a force is held over the substeps, are the shipped ones | `check` of the orbit world at `substeps: 4` raises no error; its bake leaves 2 m within 1% at a step no later than 480 (one turn), and at that step ½·m·\|v\|² + k ÷ r, from the body's state, is above its value at the launch | the fixture and `at step <that step>`, in one failure of the test's judge |
| **`magnetic_force_held`** | 3 | the law applies q (v × B) from the state at t(k), held over the step, with no rotation | it bakes the gyration world; the body's speed at 5 s is within 0.0005 of 6.345 m/s and its lowest y within 0.0005 of −1.514 m. The kit's `magnetic_gyration` row reads `fail`, its `what` naming the backend and the fixture, and its `speed` is within 0.0005 of 6.345 | the fixture and `its speed is 6.345 m/s`, in one failure of the test's judge; `speed` in the kit's row |
| **`magnetic_b_cross_v`** | 3 | the half-angle rotation turns the velocity in the sense of q (B × v) | it bakes the gyration world; the path's lowest y is within 0.0005 of 0 m and its highest within 0.0005 of +1.000 m. Every failure of the test's judge is the side's (its speed, its circle and its turn hold). The kit's row reads `fail`, its `y` within 0.0005 of `[0, 1]`, its `measured` within 1% of 0.5 and its `speed` within 0.1% of 3 | the fixture and `the +y side`, in every failure of the test's judge; `y` in the kit's row |
| **`lennard_jones_no_factor_2`** | 4 | F(r) = 24ε ÷ r × ((σ/r)^12 − (σ/r)^6) | it bakes the pair released 0.7 m apart; at 10 s they are within 0.0005 of 0.500 m apart. The kit's `lennard_jones_rest` row reads `fail`, its `what` naming the backend and the fixture, `answer` 0.5612 as printed, `measured` within 0.0005 of 0.500 | the fixture, `the answer 0.5612 m` and `0.500 m apart`, in one failure of the test's judge and in the kit's row |
| **`lennard_jones_no_cutoff`** | 4 | every pair takes F(r), whatever its distance | it bakes the pair released 1.3 m apart; at 10 s they are within 0.0005 of 0.561 m apart | the test's judge of "still 1.3 m apart" fails |

### The test backend and its kit (criterion 6)

**`claims_force_laws`** *(ours)*: `deep-physics --backend claims_force_laws` in the `test-backends` build, Rapier as a
candidate under its own name, as #191's test backends are, whose caps() claim `inverse_square`, `magnetic` and
`lennard_jones`.

- `backend` answers `{"backend": "claims_force_laws", "reference": false, "caps": […]}` with the three laws in `caps`.
- With the kit as shipped, `behavior_kit` on it is admitted (`admitted: true`) and each of the three fixtures reads
  `pass` with `backend: "claims_force_laws"`. So its caps() claim nothing no fixture names: it leaves out
  `soft_bodies` as #191's test backends do.

**`kit_without_force_law_fixtures`** *(ours)*: `deep-physics --backend claims_force_laws --planted
kit_without_force_law_fixtures`, the same backend on the kit with the three fixtures taken out. The base's two flags
together, as #191's `rapier_caps` runs with `kit_admits_unfixtured`; nothing new.

- `behavior_fixtures` under it lists the names `--backend claims_force_laws` alone lists, in the same order, less the
  three.
- `behavior_kit` under it answers `ok: true`, `admitted: false`, `verdict: "refused"`, `results: []` and
  `refused.features` holding `inverse_square`, `magnetic` and `lennard_jones`.

## The worlds

All on #191's `world` defaults: `physics.world@1`, 3 dimensions, 120 Hz, gravity (0, −9.81, 0), seed 191, mode
`dynamic`, backend `rapier3d` `=0.36.1`, one contact material, every solver, combine and checkpoint field unwritten;
`substeps: 1` unless said. Every body is dynamic, one sphere of radius 0.1 m, with `mass` written, `gravity_scale: 0`
and `sleep: false`. No two bodies ever touch.

| World | Bodies | Forces | Baked |
|---|---|---|---|
| the orbit (ac1, ac2, ac5) | `moon`, 2 kg, at (2, 0, 0) m, `velocity.linear` (0, π, 0) m/s | `sun_pull`: `inverse_square`, `point` (0, 0, 0), `k` −4π², `min_distance` 0.1, on `moon` | 8 s, 960 steps |
| the orbit at 4 substeps (ac2) | the same, `substeps: 4` | the same | 8 s under the planted check |
| `min_distance: 0` (ac5) | the orbit's | the same with `min_distance: 0` | refused |
| the gyration (ac3) | `ion`, 1 kg, at the origin, `velocity.linear` (3, 0, 0) m/s | `ion_turn`: `magnetic`, `field` (0, 0, 3), `charge` 2, on `ion` | 5 s, 600 steps |
| the pair (ac4, ac5) | `left` and `right`, 1 kg each, at rest at (∓0.35, 0, 0) m, 0.7 m apart | `pair_bond`: `lennard_jones`, `epsilon` 1, `sigma` 0.5, `cutoff` 1.25, on both; `pair_drag`: `drag`, `linear` 2, on both | 10 s, 1200 steps |
| the pair past the cutoff (ac4) | the same at (∓0.65, 0, 0) m, 1.3 m apart | the same | 10 s |
| `sigma: 0` (ac5) | the pair's | the same with `sigma: 0` (and `cutoff: 1.25` still written) | refused |
| the crowd (ac5) | `atom000` to `atom256` (257) or to `atom255` (256), 1 kg each, at rest 2 m apart on a grid 17 wide; `capacity.bodies` and `capacity.shapes` 512 | `pair_bond`: `lennard_jones` as above, every body named in `applies_to` | refused at 257, checked at 256 |

## Criteria to tests, and the wrong program each fails on

IDs are `scripts/proof-change.mjs`'s; each `describe` and test title starts with its criterion's ID. A judge returns
what is wrong as sentences, and each test asserts in its own file that there are none.

- **ac1, `#1931.1a76985e`.**
  1. The orbit baked 8 s: after every one of 960 steps the body is within 1% of 2 m from the point, and it first comes
     back to its start line within 1% of 4.000 s. Fails on the base, which refuses the world.
  2. Under `inverse_square_one_over_r`, as the table says. The wrong program is the planted law; the base doesn't know
     the name.
- **ac2, `#1931.b13f64e3`.**
  1. The orbit world at `substeps: 4` is refused as The refusals say, and the same world at `substeps: 1` is taken.
     Fails on the base, which refuses both for the law, with another code and no word of `substeps`. A check that
     takes the law at any substeps fails the first leg; one that refuses the law outright fails the second.
  2. Under `check_admits_force_substeps`, as the table says. The wrong program is the planted check.
- **ac3, `#1931.a7ffb5c9`.**
  1. The gyration baked 5 s: after every one of 600 steps the speed is within 0.1% of 3 m/s; the path's y stays
     between −1.000 m and 0 m; every state is within 1% of 0.5 m from the middle of the path's extents; the velocity
     turns once every 1.047 s within 1%. Fails on the base, which refuses the world.
  2. Under `magnetic_force_held`, as the table says.
  3. Under `magnetic_b_cross_v`, as the table says.
- **ac4, `#1931.e8d79a14`.**
  1. The pair released 0.7 m apart is within 0.5% of 0.561231 m apart at 10 s. Fails on the base.
  2. The pair released 1.3 m apart is within a micron of 1.3 m apart at 10 s. Not vacuous: in the same process the pair
     released 0.7 m apart ends more than 0.1 m from where it started. Fails on the base, which bakes neither.
  3. Under `lennard_jones_no_factor_2`, as the table says.
  4. Under `lennard_jones_no_cutoff`, as the table says.
- **ac5, `#1931.02a6e7e5`.** Three tests, one per refusal, each one process: `check` of the world as the criterion
  writes it, `check` of the same world with a legal value, and a 1-step `bake` of the refused world. Each fails on the
  base, which refuses the wrong world at the law's `kind` with the kind as its `actual` (no field, no 0, no
  `over_budget`, no 257) and refuses the legal one too.
- **ac6, `#1931.f0905250`.**
  1. macOS arm64, the release build: the three fixtures in the kit's data and their rows on Rapier, as The three
     fixtures say; each row's numbers against its own world baked here; and the pass judge shown to fail on the same
     rows measuring 1.067 m, a radius 2% off and 0.500 m. Fails on the base, whose kit holds none of the three.
  2. wasm32, through `node scripts/physics-wasm32.mjs`: the same data and rows, `target: "wasm32-unknown-unknown"`.
     Fails on the base.
  3. `claims_force_laws` with the kit as shipped and with `kit_without_force_law_fixtures`, as The test backend says.
     Fails on the base, whose `test-backends` build has no such backend. A kit that never refuses a candidate fails
     the second leg; a backend that claims a law no fixture names fails the first.

Test count: 2 + 2 + 3 + 4 + 3 + 3 = 17.

## Readings, where the issue and the design leave a choice

1. **The surface.** The laws are read through `check` and `bake`, the fixtures through `behavior_fixtures` and
   `behavior_kit`, caps() through `backend`, as #191's and #2241's suites read them; no new call.
2. **How a law is written.** As the base writes `drag` and `spring_to_point`: `kind: {<law>: {fields}}`, `point` a
   list of three numbers. The issue gives `min_distance` no default, so every `inverse_square` here writes it; it
   gives `cutoff` one, and every `lennard_jones` here writes `cutoff` all the same, so `sigma: 0` is the only field at
   or below 0 in its world.
3. **What the issue leaves unsized.** Each body is a sphere of radius 0.1 m with its `mass` written and
   `sleep: false`, so nothing but the law decides when it moves. The orbit lies in the x-y plane about the origin,
   from (2, 0, 0) m along +y. The pair lies along x about the origin. The crowd stands 2 m apart, past the cutoff.
4. **The gyration's substeps.** Criterion 3 names none. Its world is written at `substeps: 1`, the one value the issue
   names for these fixtures, and the one at which its planted numbers come out as printed: a force held over one
   substep moves the body by the step's new velocity, which puts the held law's lowest y at −1.5136 m; over 4
   substeps the same arithmetic gives −1.5135 m, which doesn't print as −1.514. The speeds, 3 m/s and 6.345 m/s, are
   the same at any substeps. The kit's own gyration fixture may sit at any substeps: no test reads the planted row's
   `y` to the millimetre.
5. **"At every step".** Every state after the built one: 960, 600 or 1200 of them, each read.
6. **"Stays 2 m from the point within 1%".** The body's distance from the force's `point` is within 0.02 m of 2 m.
7. **"First comes back to its start line".** The start line runs from the point through where the body was built. The
   body is back on it when the angle it has swept about the point reaches a whole turn; the time is taken on the
   straight line between the two steps around that moment, and held within 1% of 4.000 s.
8. **"Leaves the 1% band within its first 12 steps", "within its first turn".** The first step whose distance is
   outside the band is at most 12, or at most 480 (4.000 s at 120 Hz). **"Falls to 1.067 m"**: the nearest the body
   comes to the point in the 8 s, within half a unit of the last digit printed, 0.0005 m.
9. **"Gains energy".** ½·m·|v|² + k ÷ r, worked from the body's state with the criterion's m and k, is higher at the
   step the body leaves the band than at the launch.
10. **"Fails the fixture, naming it and the step"** (criterion 2). The kit's own orbit world is at 1 substep and the
    planted program changes the check alone, so the kit's row still passes under it. What fails is the fixture's
    judge, the one that passes the world at 1 substep, on the admitted world's bake; its failure names the fixture and
    the step. The test for criterion 6 holds the kit's `measured` to that judge's reading of the same bake.
11. **"Keeps its speed at 3 m/s within 0.1%"**: |v| after every step. **"Stays between y = −1.000 m and 0 m"**: to the
    millimetre the issue prints, so no lower than −1.0005 m and no higher than 0.0005 m; a circle traced in steps of
    0.025 m touches its bounds within a fraction of a millimetre. **"A circle of radius 0.5 m within 1%"**: every
    state is within 1% of 0.5 m from the middle of the path's extents along x and y, in the plane it started in. The
    middle is the path's own, not (0, −0.5, 0): a body moved by each step's new velocity circles a centre a few
    millimetres off along x, which the criterion doesn't place. **"Turning once every 1.047 s"**: the velocity's mean
    turn a step about the field gives the time of one turn; the criterion prints it without a bound, and it is held to
    the circle's 1%.
12. **The planted magnetic laws' numbers.** 6.345 m/s is the speed at step 600; −1.514 m is the path's lowest y over
    the 5 s; 0 m and +1.000 m are the path's lowest and highest y. Each within 0.0005.
13. **"Naming the speed", "naming the side".** The judge's failure says `its speed is 6.345 m/s`, or says the path
    lies on `the +y side`; the kit's row carries the number in `speed`, or the path's ends in `y`. For the B × v law
    every failure of the judge is the side's, since that law keeps the speed, the circle and the turn.
14. **"0.5612 m apart at 10 s"**: the distance between the two bodies' centres after step 1200, against the closed
    form in full, 0.561231 m. **"Rests them at 0.500 m"** and **"closes them to 0.561 m"**: that distance at 10 s,
    within 0.0005 m. **"Still 1.3 m apart"**: within a micron, since a pair past the cutoff takes no force at all.
15. **"And fails"** (the law without the cutoff). The fixture's pair, 0.7 m apart, is inside the cutoff and rests where
    it should under that law, so its row isn't read; the criterion's own judge of the pair past the cutoff fails.
16. **"Naming the fixture, the answer and the step"**, **"… and the distance"**. Held twice, as #2241's suite holds
    its first criterion: one failure of the test's judge holds all of them as text, and the kit's row holds them as
    fields (`fixture`, `answer`, `step` or `measured`) with the fixture and the backend in `what`.
17. **"Refused at check, naming …"**. As The refusals say. A name counts wherever an issue carries one (`path`, `ids`,
    `what`), since the base puts a refused field in `path` and its entry's ID in `ids`, and the issue asks for no
    more. Where the criterion says "the field and the value", the design's shape is held (What holds a document to its
    rules: "`actual` is the value refused at `path`"): the field ends `path` and the value is `actual`.
18. **"Before any step runs".** The refusal comes from `check`, which steps nothing; and a bake of the same world is
    refused with the same issue and answers no state and no step hash.
19. **"The kit's report lists each of the three fixtures' measured values beside its answer and tolerance".** Three
    fixtures, one row each, as the issue counts them. Each row is the base's, with one `measured` beside the
    interface's `answer` and `tolerance`; the answers Scope lists besides (the orbit's period, the gyration's speed and
    side) are further fields of the same row, measured values without a tolerance of their own in the row, which the
    test holds to the criteria's bounds. Which of a fixture's values is its `measured` follows the issue's title (an
    orbit, a gyration radius, a rest distance) and what its planted failure names (the answer 2 m; 1.067 m; 0.500 m).
20. **"Claims these laws in its caps()"**, **"naming the law"**. One cap per law, named as the law is, so the refusal's
    `features` names the law itself. **"With the fixtures taken out of the kit"**: a second flag on the same backend,
    so the same candidate is seen admitted with the fixtures in and refused with them out.

## Where the issue, the design and the base's suites disagree

1. **#191's first criterion holds every fixture to 4 substeps.** `tests/acceptance/191/ac1-reference-kit.test.ts`
   fails any fixture whose world isn't at g = 9.81 m/s², 120 Hz and 4 substeps (both its tests, macOS arm64 and
   wasm32). This issue's Scope and the design's force-laws line put the orbit, and any world holding `inverse_square`
   or `lennard_jones`, at `substeps: 1`. Once the fixtures land, those two tests of #191 fail on them by their own
   rule. That is a dispute over #191's test, not something this suite or the implementer can settle; it goes to the
   owner as AGENTS.md says. No other suite at the base reads every fixture's substeps.
2. **The technical design's lists.** `docs/technical-design.md`, Joint and force, lists the forces as wind, drag, a
   spring to a point and buoyancy, and its Behavior kit paragraph names no force-law fixture; `docs/canvas-primitives.md`
   already holds all three. Bringing the first in line is the work's.
3. **The printed y = −1.514 m** is the 1-substep number (reading 4). At the kit's usual 4 substeps the same wrong law
   gives −1.5135 m.

Nothing in the criteria proved impossible to test; each clause that needed a reading is above.

## Readings at the base

Where the base stands, not expected values (`BASE-FAILURE.txt` has the runs). Taken on the base's release
`deep-physics` on this Mac (macOS 27.2 arm64, shared and loaded):

- A force is held over the substeps as the issue says. A body pushed from rest by `uniform {accel: (1, 0, 0)}` has
  speed a·dt after one step at 1 substep and at 4, and has moved 0.999 × a·dt² at 1 substep and 0.625 × a·dt² at 4:
  each substep adds force × dt ÷ substeps to the velocity and then moves the body by the new velocity.
- The orbit world with `spring_to_point {hz: 0.25, damping_ratio: 0}` in place of its `inverse_square` (a spring that
  holds the same 2 m circle at π m/s) bakes 8 s: the body stays 1.9935 m to 2.0066 m from the point at 1 substep, and
  reaches 2.0637 m at 4 substeps. A central force held over 4 substeps adds energy at the base too.
- This suite's worlds with a law the base runs in place of the new one (`uniform {accel: 0}` for `inverse_square` and
  `magnetic`, a `drag` for `lennard_jones`) check with no issue and bake 961, 601 and 1201 states of each body, with
  no lint issue; the crowds of 257 and of 256 bodies under a `drag` are both taken. So the worlds, their capacity and
  their calls are well formed, and 257 bodies alone refuse nothing.
- The worlds as written are each refused, at 1 substep and at 4, with a legal value or without:
  `{"code": "physics.unsupported", "ids": ["sun_pull"], "path": "forces/sun_pull/kind", "actual": {"inverse_square":
  {…}}, "what": "a inverse_square force isn't run by this backend interface yet; #1931 brings it"}`; their bakes
  answer `{"ok": false, "issues": […]}` and nothing else.
- `backend` answers `{"backend": "rapier3d", "reference": true, "caps": ["ccd", "soft_bodies",
  "character_controller", "vehicle_controller", "belts"]}`; the kit holds 64 fixtures, none a force law's, and Rapier
  passes all 64 on `aarch64-apple-darwin`.
- `--planted` with any of this suite's seven names, and `--backend claims_force_laws`, answer
  `{"ok":false,"code":"bad_input"}` and exit 2.

## What isn't asserted, because no criterion says so

- A force's `region` or `strength` on the new laws, and a `channel` as an `inverse_square`'s point.
- Inside `min_distance` (the magnitude held, 0 at the point itself), and k > 0 repelling.
- `cutoff` at or below 0, a `min_distance` or `sigma` below 0, a field or a charge that isn't finite (JSON carries
  none), and `cutoff` left to its default in a world of this suite.
- A velocity along the field staying unchanged, and a magnetic law with no sine or cosine in its code.
- `lennard_jones` at `substeps` other than 1, a world that raises `step_rate` instead, and the 480 Hz example.
- More than two bodies under `lennard_jones` running, their canonical order, and the 32,640 pairs.
- The refusals' sentences, the code of a field's refusal, `actual` on the substeps refusal, and a `fix`.
- A test backend that leaves a law out of its caps() reading `excluded_by_caps` or refusing a world that holds it.
- The fixtures' `measure` text, their `steps`, the bodies' masses as written (the rows' numbers hold them), and the
  three fixtures on any target but macOS arm64 and wasm32.
- A failing orbit row's `period`, a passing row's `step`, and the orbit fixture failing on its period alone: the
  criteria plant no law that keeps the distance and breaks the period.
- The planted programs' kit rows on wasm32, and the test backend there.
- Step hashes, goldens, any timing or cost, and the order the Proof line shows its evidence in.
- Everything under the issue's "Not in this task": a charge or a field per body, inverse-square forces between
  bodies, electric fields, a field from a grid or an asset, 2D twins, any new integrator.

`BASE-FAILURE.txt` is each file's run at the base, with each test's result and failing assertion.

## What the implementer adds outside this folder

The three laws in the reader, the check and the backend wrapper; the refusals; the caps `inverse_square`, `magnetic`
and `lennard_jones`; the three fixtures and their row fields in the interface's kit; the six planted wrong programs,
the planted kit `kit_without_force_law_fixtures` and the test backend `claims_force_laws`, in `deep-canvas-physics`
and `deep-physics-rapier`; and `'tests/acceptance/1931/'` in `scripts/lanes.mjs`'s `alone` list. Nothing in this
folder changes.
