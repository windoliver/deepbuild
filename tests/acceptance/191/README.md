# Acceptance tests for #191: the physics behavior kit, analytic fixtures with tolerances every physics backend passes before a build can choose it

Written first, blind, from issue #191 (its Scope, Fields, twelve acceptance criteria, Proof line and Oracle line), its
Oracle page, the design sections it links and the base commit this worktree stands on, `dc9b4315` ("Merge pull request
#2578 …", a descendant of the `0e557273` the job was handed; neither holds any of #191), by a job that never saw an
implementation; none existed, and no other worktree, branch, stash or pull request was read. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). The
upstream tests the Oracle page links for criteria 1, 2, 3, 10 and 11 are ported in `tests/acceptance/191-oracle/`, on
this suite's surface.

## What was read

- The issue, live with `gh issue view 191 --repo windoliver/deepbuild`, and its Oracle page and cases
  (`doneright/oracles/issues/191.md`, `doneright/oracles/cases/191.json`, `DeepBuildAI/deepbuild`, branch `doneright`).
- `docs/technical-design.md`: The physics module (Character body, Behavior kit, Input, occurrence, output); Dogfooding;
  Tests written first. `docs/canvas-primitives.md`: Physics: behavior kit; World and backend `physics.world@1`; Body
  `body@1`: character; Canvas module: interface and implementation (the trial, `bit` and `measured`, the release gate);
  Input track entries; Occurrence list; Physics output. AGENTS.md and `docs/parallel-proof.md`.
- At the base, for surfaces only: `crates/deep-physics-rapier` (`runner.rs`: `answer`, `bake`, `query`, `golden`,
  `golden_verify`, the planted names; `main.rs`; `lib.rs` where bodies are built; `inputs.rs`), `crates/deep-canvas-physics`
  (`caps.rs`, `doc.rs`, `roles.rs` for the assumption rows a recipe already writes, `occurrence.rs`),
  `crates/deep-show` (`Cargo.toml`'s `test-sim-*` features, `test_sim.rs`, `main.rs`'s `golden`, `decide` and
  `corpus_record` calls), `crates/deep-canvas-test-modules/src/sim.rs`, `scripts/physics-wasm32.mjs`,
  `scripts/proof-change.mjs` (criterion IDs), and the suites `1919/`, `2009/`, `2009-oracle/`, `1918/`, `185/`, `1920/`,
  `2010/`, `2012/`, `138/`, `124/` (layouts and helpers copied, nothing imported).

What the base already does, which these tests don't credit: `deep-physics` checks, bakes (bodies, occurrences, keyed
records), records and verifies goldens, answers `query`, takes `--planted <name>`, and runs on wasm32 through
`scripts/physics-wasm32.mjs`; caps() refuse a restitution threshold, rolling resistance, tangent speed and dynamic
couplings; a `character` body is refused with `physics.unsupported` naming #182; `deep-show` builds `test.sim@1`'s A and
B (#185), writes corpus documents and takes your decisions. The base has no behavior kit, no `backend`, `behavior_kit`,
`behavior_fixtures` or `expand` call, no test backend, none of this suite's planted names, no `physics.fast_body`, no
trial, no `track_record` and no switch decision.

## Run them

```sh
npm ci                          # once, with node 24.22.0 first on PATH
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/191 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/191/tsconfig.json
rm -rf tests/acceptance/191/node_modules/.vite
```

Each file builds what it uses once, before its tests, and copies each binary out (honoring `CARGO_TARGET_DIR`;
`CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set; Homebrew's rustup put on PATH when present):
`cargo build --locked -p deep-physics-rapier --bin deep-physics` (shipped), the same with `--features test-backends`
(test), with `--release` (ac8 only), and `deep-show` per feature set (`--no-default-features --features …`, ac8 and ac9).
`ac1` also builds the crate for wasm32 through `node scripts/physics-wasm32.mjs`. Every test passes an explicit
60-minute timeout, which overrides `--testTimeout`; each file's build hook has 4 hours (first deep-show builds on a
loaded shared machine took over an hour here). Node built-ins and vitest only. No cargo is `BLOCKED:`, a failure,
never a pass. **`scripts/lanes.mjs` needs `'tests/acceptance/191/'` (and `'tests/acceptance/191-oracle/'`) in its
`alone` list** (the files build cargo binaries and ac8 times them); this README is the instruction, the implementer makes
that edit. Processes are stopped only by the PIDs this suite starts (`spawnSync` with a timeout); nothing is killed by
name or port.

`BASE-FAILURE.txt` is the run at the base: every test fails because the surface is absent (a missing call, a missing
cargo feature, a refused planted name or test backend), never in the harness.

## The surface under test

The issue names the kit's fields, its result, the trial's fields, the lint `physics.fast_body` and the caps rule, but
no command line. Everything below that the issue or the design doesn't name is this job's choice, the smallest the
criteria need, next to the base's own calls; **bold** names are the ones the implementer must provide as written.

### `deep-physics` (crate `deep-physics-rapier`): new calls

One JSON object per stdin line, one reply line each, as at the base. `deep-physics --backend <test backend>` (only in
the `test-backends` build) runs the same binary on a test backend; `--planted <name>` plants one wrong program; both may
be given together. An unknown backend or planted name answers `bad_input` and exits 2, as the base does for `--planted`.

| Call | Reply |
|---|---|
| **`{"call": "backend"}`** | `{"ok": true, "backend": name, "reference": bool, "caps": [cap], "tolerances"?: {fixture: Tolerance}}`: the backend's manifest, its caps() as a list of cap names, and any tolerances the backend itself declares |
| **`{"call": "behavior_fixtures"}`** | `{"ok": true, "fixtures": [{"name", "world": World, "measure", "answer": number, "tolerance": Tolerance, "caps": [cap]}]}`: the interface's behavior part, as data |
| **`{"call": "behavior_kit"}`** | `{"ok": true, "backend": name, "target": triple, "admitted": bool, "refused"?: {"features": [cap], "what"}, "results": [Result], "verdict": "pass" \| "fail" \| "refused"}` |
| **`{"call": "expand", "world": World}`** | `{"ok": true, "world": World, "assumptions": [{"body", "reason", …}]}`, or a refusal `{"ok": false, "issues": [Issue]}` |
| `{"call": "bake", …}` (the base's) | gains **`issues: [Issue]`**, the lints a bake runs, among them **`physics.fast_body`** |

```text
Tolerance = {"relative": x} | {"m": x} | {"deg": x} | {"steps": x}      (one key; relative 0.01 is 1%)
Result    = {"backend", "fixture", "measure", "measured": number | null, "answer": number, "tolerance": Tolerance,
             "caps": [cap], "result": "pass" | "fail" | "excluded_by_caps", "what": string, …extras}
             extras on a fail: "joint" (hinge_limit), "hit" and "probe": {"kind", "groups", …} (queries),
             "body" and "step" (ccd_wall); on queries "probes": {"ray": n, "sweep": n, "overlap": n};
             on each sensor cell "occurrences": [{"kind": "sensor_enter" | "sensor_exit", "step"}], its own rows
Issue     = the base's {check, code, severity, ids, path, actual, t, what, fix}; physics.fast_body adds
             "step" (the first step the body moved farther than half its thinnest extent), "move" (m, that
             step's move) and "half_extent" (m), one issue per body
```

- `behavior_kit` runs every fixture of the interface's behavior part on this process's backend and reads the measure
  from the bake. A fixture whose `caps` name a cap the backend's caps() lack reads `excluded_by_caps`. A candidate (any
  backend whose `reference` is false) whose caps() claim a cap no fixture names is refused before any fixture runs:
  `admitted: false`, `results: []`, `verdict: "refused"`, `refused.features` naming the caps. `verdict` is `pass` when
  no result fails. A fail's `what` names the backend and the fixture.
- `answer`, `tolerance` and `caps` in a result are the interface's (`behavior_fixtures`'), never the backend's.
- `target` is the build's triple: `aarch64-apple-darwin` natively here, `wasm32-unknown-unknown` through the script.

### Names this suite chooses

| Name | What it is |
|---|---|
| **`backend`**, **`behavior_fixtures`**, **`behavior_kit`**, **`expand`** | the calls above |
| **`soft_bodies`**, **`character_controller`** | cap names in `backend.caps`: Rapier's caps claim `soft_bodies`; `character_controller` is claimed only by a backend that runs character bodies (not Rapier's until #182) |
| Cargo feature **`test-backends`** on `deep-physics-rapier` | builds the test backends and the test fixture below; in no shipped build |
| Fixture **`test_capped`** | the test fixture of criterion 4, in the `test-backends` build's kit only; its `caps` name a cap Rapier's caps hold that no other fixture needs, and its world needs that cap, so caps() refuse it on a backend without |
| `--backend` **`friction_average`** | criterion 2: Rapier combining friction by the average whatever the world declares |
| `--backend` **`no_joint_limits`** | criterion 3: Rapier with every joint's limits left off |
| `--backend` **`restitution_min`** | criterion 3: Rapier combining restitution by the minimum whatever the world declares |
| `--backend` **`drops_cap`** | criterion 4: Rapier whose caps() leave out the cap `test_capped` names |
| `--backend` **`query_ignores_groups`** | criterion 5: Rapier whose `query()` ignores collision groups |
| `--backend` **`rapier_caps`** | criterion 6: Rapier as a candidate, keeping Rapier's caps(), `soft_bodies` included |
| `--backend` **`no_soft_bodies`** | criterion 6: the same with `soft_bodies` taken out of its caps() |
| `--backend` **`loose_tolerance`** | criterion 7: Rapier whose free fall lands 2% off (its gravity 2% strong, say) and whose manifest declares `tolerances.free_fall: {"relative": 0.05}` |
| `--planted` **`kit_runs_excluded`** | criterion 4: a kit that runs a fixture its backend's caps exclude |
| `--planted` **`kit_admits_unfixtured`** | criterion 6: a kit that runs only the fixtures it has and never refuses a candidate |
| `--planted` **`pair_filter_default`** | criterion 10: the backend wrapper left on the engine's default pair filter (no kinematic–static pairs) |
| `--planted` **`swept_collision_off`** | criterion 11: the wrapper turns swept collision off for the whole world, ignoring `solver.ccd: true` |
| `--planted` **`recipe_leaves_ccd_off`** | criterion 12: `expand`'s recipe leaves the flagged body's `ccd` off |

Every test backend wraps Rapier and is a candidate (`reference: false`); each but `rapier_caps` leaves `soft_bodies` out
of its caps(), so the kit admits it and runs (criterion 6's rule would otherwise refuse it before its fixture fails).
The backend's name in a result and in `backend` is the test backend's name.

**Fixture names** (`behavior_fixtures` and `results`), with the issue's answers and tolerances the tests hold them to:

| Fixture | Answer | Tolerance | Judged |
|---|---|---|---|
| `free_fall` | 4.905 m | `{"relative": 0.01}` | both ways |
| `projectile_range` | 10.19 m | 1% | both ways |
| `pendulum_period` | 2.010 s | 1% | both ways |
| `bounce_max`, `bounce_min`, `bounce_average`, `bounce_geometric`, `bounce_multiply` | 0.81, 0.25, 0.49, 0.45, 0.2025 m | 3% | both ways |
| `slide_geometric`, `slide_average`, `slide_min`, `slide_max`, `slide_multiply` | 3.186, 2.548, 6.371, 1.593, 7.964 m | 3% | both ways |
| `slope_hold` | 0 m (its move in 2 s) | `{"m": 0.001}` | both ways |
| `slope_slide` | 1.314 m | 3% | both ways |
| `hinge_limit` | 30° (the largest angle) | `{"deg": 0.5}` | at most 30.5° |
| `slider_limit` | 0.5 m (the largest travel) | `{"m": 0.005}` | at most 0.505 m |
| `hinge_motor` | 90°/s | 1% | both ways |
| `first_contact_time`, `first_contact_speed` | 0.4515 s, 4.429 m/s | `{"steps": 1}`, 2% | both ways |
| `sensor_entry` | 0.3193 s | `{"steps": 1}` | both ways |
| `sleep` | the world's sleep time in steps | `{"steps": 2}` | at most (steps from the speed falling under the sleep speed to sleep) |
| `sleep_off` | 0 (sleeps) | any | exactly |
| `queries` | 0 (probes whose hits differ from the brute-force scan) | any | exactly |
| `ccd_wall` | 0.04975 s (first contact) | `{"steps": 1}` | both ways |
| `sensor/<sensor>/<crosser>` | see below | | its own rows |

The sensor matrix's cells are `sensor/<static|kinematic|dynamic>/<dynamic|kinematic|character|placed|inside>`: the
sensor body's kind, then the crosser (a dynamic sphere, a kinematic sphere, a character capsule, a character moved by
`place`, and a body active inside the sensor from the start). Crossing cells: one `sensor_enter` at step 75 and one
`sensor_exit` at step 165, each within one step; `placed`: enter at 300, exit at 360; `inside`: enter at 1, exit at 240
(set inactive). The `character` and `placed` cells name `character_controller` in their `caps`.

An answer printed in the issue is matched within half a unit of its last printed digit (10.19 admits the exact
100 ÷ 9.81 = 10.1937), so the interface may hold the exact analytic value. Character and vehicle fixtures, when the
kit holds them, must name `character_controller` (or a vehicle cap) in their caps: on a backend whose caps lack it they
read `excluded_by_caps`, and any result that names a cap its backend lacks and still passes fails criterion 1's check.

### `deep-show run` (the trial, criterion 9)

The base's scenario (`{evidence, sessions, processes, panels, docs, calls}`) and its `corpus_record`, `schedule` and
`decide` calls, plus:

| Call | Reply |
|---|---|
| **`{"call": "track_record", "store": dir, "document": D, "steps": 1200, "entries": [{"step", "kind": "set", "target": "s1", "data": {"path": "params.value", "value"}}]}`** | `{"ok": true, "track": hash, "steps": 1200}`: a recorded input track kept in `store` by hash |
| **`{"call": "trial", "candidate": implementation, "build": path, "corpus": dir, "store": dir, "tracks": [hash]}`** | `{"ok": true, "trial": ID, "replicas": [{"implementation", …}], "results": [{"input", "result"}], "switched": false}` |
| `{"call": "decide", "decision": {"switch": {"interface", "to", "trial"}}}` (no session: you) | `{"outcome": "decided", "decision": ID, "moved": [{"input", "cause": ID, …}]}` |

- `build` is the binary of a build that chose the candidate; the trial runs a replica of it and one of the build in use,
  both replaying every document in `corpus`, the interface's parity fixtures and the named tracks.
- `input` is `{"corpus": name}`, `{"fixture": name}` or `{"track": hash}`; `result` is `"equal"`, `{"within":
  {"fixture", "tolerance": number}}` or `{"differs": {"item", "step", "field"}}`.
- A switch moves each golden or corpus snapshot the switch changes (the trial's inputs that weren't `equal`) once, each
  `moved` entry naming the decision as its `cause`; the same decision again moves nothing (`moved: []` or refused).
- **deep-show test feature `test-sim-b-plus-one`**: B adding one unit to `test.sim.pos` of one item at step 300, built
  without `test-sim-b` as #185's B variants are. The builds read: `core,test-sim-a,test-sim-behavior` (in use),
  `core,test-sim-b,test-sim-behavior` (candidate), `core,test-sim-b-plus-one,test-sim-behavior` (planted B).

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed. Each test's name starts with its criterion's ID.

| ID | File (tests) | What it asserts |
|---|---|---|
| 1 `#191.8c7c5edf` | `ac1-reference-kit.test.ts` (2) | macOS arm64 and wasm32: `rapier3d` is the reference, admitted, verdict pass; every fixture above present with the issue's answer and tolerance, `pass`, its measured value beside its answer and within the tolerance on the issue's side; each sensor cell's own rows at its steps (the character and `placed` cells `excluded_by_caps`, naming `character_controller`, while Rapier's caps lack it, and passing once they claim it); every result's answer and tolerance equal the interface's data; no result names a cap its backend lacks and passes; every fixture world at 120 Hz, 4 substeps, g 9.81; the kit's free-fall measure equals the drop its own world shows baked here, within 1e-6 |
| 2 `#191.7542a335` | `ac2-friction-average.test.ts` (2) | `friction_average`: `slide_geometric` fails, naming the backend and fixture in its fields and text, answer 3.186, tolerance 3%, measured within 3% of 2.548; `slide_average` passes; the verdict fails. Goldens of a geometric and an average slide world recorded on it replay PASS on it, and its geometric world's block slides 2.548 m |
| 3 `#191.5e3fd235` | `ac3-limits-and-restitution.test.ts` (2) | `no_joint_limits`: `hinge_limit` fails naming the one joint of its world (field and text) and a largest angle past 30.5°; `restitution_min`: `bounce_max` fails with answer 0.81 and measured within 3% of 0.25 |
| 4 `#191.11530f89` | `ac4-excluded-by-caps.test.ts` (2) | the cap `drops_cap` leaves out of Rapier's caps is one `test_capped` names; on `drops_cap` `test_capped` reads `excluded_by_caps` naming it, every fixture naming a missing cap is excluded, every other passes, verdict pass; on Rapier (test build) `test_capped` passes. With `kit_runs_excluded`, `test_capped` reads fail and the same judge fails, naming the fixture and the cap |
| 5 `#191.db04732f` | `ac5-queries.test.ts` (2) | Rapier: `queries` passes with 0 differing probes and at least one ray, sweep and overlap compared; `query_ignores_groups`: `queries` fails naming the fixture and a `hit`, a body of its world whose every shape use is a member of none of the failing ray's groups |
| 6 `#191.7d1f689f` | `ac6-admission.test.ts` (3) | Rapier's caps claim `soft_bodies`; `rapier_caps` keeps exactly them, is a candidate, and is refused with no result, naming `soft_bodies`; `no_soft_bodies` lacks it, is admitted, nothing fails, verdict pass; `kit_admits_unfixtured` admits `rapier_caps` and the refusal judge fails naming `soft_bodies` |
| 7 `#191.55b756cb` | `ac7-tolerance-owner.test.ts` (1) | `loose_tolerance`'s manifest declares `free_fall: {"relative": 0.05}`; its `free_fall` fails with tolerance `{"relative": 0.01}`, 1% in its text, its fixture named, measured 1.5% to 2.5% off the answer |
| 8 `#191.8b5fd147` | `ac8-budgets.test.ts` (3) | structurally everywhere: the release kit and the wasm32 kit run fixtures; the trial runs in two replicas; the release build carries the kit. On a fit reference Mac only: five runs each of the whole kit (release native, and the wasm32 script) under 60 s; five trials under 15 min; five runs of two 600-step bakes here within the merge base's median + 5% (the merge base's release `deep-physics` built from `git archive` in `target/acceptance-191-base/`). Elsewhere INCONCLUSIVE |
| 9 `#191.d1baa3cb` | `ac9-trial.test.ts` (3) | B against A: two corpus documents, `sim-small` and `sim-large`, two 1,200-step tracks, each `equal` or `within {fixture, tolerance}`; replicas of A and B; `switched: false` and the plan still names A. Planted B: each track `differs {item: "s1", step: 300, field ∋ "pos"}`, still A, and the clean judge rejects it. One switch decision moves exactly the inputs the trial found changed, once each, `cause` the decision; the same decision again moves nothing |
| 10 `#191.9d50a1a7` | `ac10-sensor-matrix.test.ts` (2) | Rapier: every cell's rows as above (the character and `placed` cells excluded by caps while Rapier has no character controller); `pair_filter_default`: `sensor/static/kinematic` (and `sensor/static/character` when a controller is claimed) writes no rows and fails naming the cell, the kit fails, the matrix judge fails naming each |
| 11 `#191.e5696c9f` | `ac11-fast-bodies.test.ts` (3) | the issue's sphere and wall (helpers `fastBallWorld`), `ccd: true`: its centre never past x 10.02, first `contact_begin` with the wall at step 6 ± 1; `ccd_wall` passes. `swept_collision_off`: the judge fails, the ball ends past the wall, and `ccd_wall` fails naming its world's ball and the step its centre first passes the wall's far face in a bake of that world under the same wrapper. A bake with `ccd: false` raises exactly one `physics.fast_body` naming `ball`, step 1, move 1.667 m (1%) and half extent 0.05 m; none with `ccd: true` or for a ball (r 0.1 m) rolling at 2 m/s |
| 12 `#191.a949ec63` | `ac12-ccd-by-default.test.ts` (3) | `expand` of the sphere with `ccd` unset: `ccd: true`, one assumption row with `body: "ball"` and a `reason` naming `physics.fast_body`; its bake first touches the wall at step 6 ± 1 and never passes it. The rolling ball keeps `ccd` off, no row. `recipe_leaves_ccd_off`: `expand` refused with an error issue naming `ball` |

Test count: 2 + 2 + 2 + 2 + 2 + 3 + 1 + 3 + 3 + 2 + 3 + 3 = 28.

## Wrong programs

Each criterion's twins are its test backends and planted names above; each test asserts the judge that passes the real
program fails on the twin (`caught`), or reads the twin's failure as the criterion's text requires. Beyond them, each
comparison has its planted mismatch: criterion 1's pass judge is run on its own free-fall result with the measured
value moved 2% (it must fail); criterion 9's clean-trial judge is run on the planted B's report (it must fail).

## Readings where the issue leaves a choice

- **The surface.** The kit is calls on the physics runner, because its fixtures are physics worlds the runner already
  bakes, natively and on wasm32 with the same calls; test backends are a feature's startup flag, so one build holds
  them all and the shipped build holds none.
- **"Rapier passes every fixture"** while the character body is still #182's: the character fixtures and the
  character and `place` sensor cells read `excluded_by_caps` on a backend without a character controller (Scope), so
  they are never a pass and never a fail here; criterion 1's test requires that exactly while Rapier's caps lack
  `character_controller`, and their pass once a backend claims it. **At this base, Rapier has no character controller:
  that branch runs.**
- **"Naming"** a value: a result's fields (`backend`, `fixture`, `answer`, `tolerance`, `measured`, and the extras),
  and for the backend, the fixture, the joint, the hit, the body and the cell also its `what` text.
- **"The largest angle it reached"** is the hinge's `measured`; **"the 2.548 m it slid"**, **"the 0.25 m it bounced"**
  and **"a 2% error"** are the measured values, held to the issue's 3%, 3% and 1.5–2.5% bands, since a wrong program's
  number is itself a simulation.
- **"Every golden recorded on it"** is two goldens this suite records on `friction_average` (a geometric and an average
  slide world), each replayed there; the issue names no other.
- **"Within the world's sleep time plus 2 steps"** is one-sided, the answer read from the fixture's own world.
- **"Never past 30.5°" / "0.505 m"** are one-sided bounds on the largest angle and travel.
- **The query fixture's "hit"** is a body ID; "a body its ray's groups filter out" is one whose every shape use names
  `member` groups disjoint from the ray's `groups`.
- **The sensor matrix's cells** are fixtures of their own, each listing its sensor rows, so a cell is named by its
  fixture name; the body inside from the start is one cell per sensor kind. An entry stamped step k is applied by the
  step whose rows are stamped k + 1 (`runner.rs`), so "set inactive at step 240 writes its exit at 240" is the row
  stamp, whichever entry stamp the kit's world uses.
- **"In a playtest run"**: a playtest run bakes, and the lint runs on every bake, so the lint is read on `bake`'s reply;
  no playtest plug-in exists at the base. "Names the body, step 1" is the first step it moved past the bound.
- **"Never passes the wall's far face"** is read by the ball's centre: its centre never beyond x 10.02. A swept sphere
  stopped by the contact's softness may sink its leading point a few millimetres into a 0.02 m wall (the base does,
  below), which isn't passing through it; a tunnel puts the centre past the face.
- **The ccd fixture's step it crossed** is the first step the ball's centre is past the wall's far face, read from the
  kit's own world baked under the same planted wrapper.
- **"Writes its first contact at step 6"** (criteria 11, 12) is the first `contact_begin` between ball and wall, at 6
  within one step, the fixture's tolerance.
- **"Refused at check"** (criterion 12): `expand` checks the recipe's output and refuses a body `physics.fast_body`
  flags whose `ccd` the recipe left off, naming it in `ids`.
- **The trial's goldens a switch changes** are the trial's inputs it reported other than `equal`; "move once" is one
  `moved` entry each and none on the same decision again. The trial and the decision run on the build in use; the
  candidate's build is passed by path, since a build never loads another implementation at run time.
- **Budgets** follow #185's gate: a reference Mac (Mac15,7 or Mac15,12) on mains power, Low Power Mode off, thermal
  nominal, 1-minute load at most its cores; five runs after a warm-up, judged by the design's rule; else INCONCLUSIVE
  (a skip, never a pass). "A build gains no work at run time" is bakes as fast as the merge base's (median + 5%). The
  wasm32 kit is timed through its script, whose cargo step finds its build fresh after the warm-up.

## Readings at the base

The base run (`BASE-FAILURE.txt`) and these readings of the base's `deep-physics` were taken on this Mac (Mac17,10,
Apple M5 Max, not a reference Mac; the machine was shared, 1-minute load above 100). They are where the base stands,
not expected values:

- The issue's fast sphere and wall (helpers `fastBallWorld`), 120 steps: with `ccd: true` and with `ccd: false` alike
  (at this pin a fast body is swept against static shapes either way, as the Oracle page says), the first
  `contact_begin` between ball and wall is at **step 7** (one step after the analytic step 6, inside the criterion's
  "within one step"), a `hit` row on the same step, and the ball's centre reaches at most **x 9.9759** and ends at
  9.95. Its leading point thus reaches 10.026 m, 0.006 m past the far face, while its centre stays 0.044 m before it:
  this suite reads "passes the far face" by the ball's centre (README: Readings). With `solver.ccd: false` (the
  planted wrapper's setting) its centre first passes x 10.02 at **step 8** and ends at 10.0699, past the wall. No
  bake reply holds an `issues` field.
- Free fall from rest, 120 steps: a drop of **4.915230 m** at 1 s, 0.21% over the analytic 4.905 m (inside 1%).
- A 0.5 m box sliding from 5 m/s, friction 0.2 against 0.8: **3.1803 m** under the geometric mean (3.186 m, 0.18%
  short) and **2.5432 m** under the average (2.548 m), 240 steps.
- A kinematic ball inside a static sensor box (the Oracle lane's pair-filter world at 60 Hz), one step: **no rows**: the
  base is on the engine's default pair filter, which is criterion 10's planted wrapper.
- `backend`, `behavior_kit`, `behavior_fixtures` and `expand` each answer `{"ok": false, "code": "bad_input"}`;
  `--backend <name>` is refused at startup (exit 2), and `--features test-backends` is no feature of the crate.

## Not tested, because no criterion reaches it here

The release build refusing a physics implementation that fails the kit, and the kit in the local preflight for every
target a build ships (Scope lines no criterion names beyond criterion 1's two targets); the character fixtures' own
answers (slope, step, snap, jump) and the vehicle fixtures (#182, #251); the soft-body, force, cone, contact-impulse and
2D fixtures (#1786 and the first candidate backend); an agent's switch decision being refused; corpus snapshot files'
contents after a switch; goldens' cross-machine standing.

## What the implementer adds

The calls, fields, cargo features, test backends, test fixture and planted names above, in `deep-physics-rapier`,
`deep-canvas-physics` and `deep-show`; `'tests/acceptance/191/'` and `'tests/acceptance/191-oracle/'` in
`scripts/lanes.mjs`'s `alone` list. Nothing in these folders changes.
