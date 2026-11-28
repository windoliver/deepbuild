# Acceptance tests for #3225: scene.relations, relations read from where items stand

These tests were written before any implementation existed, by a job that never saw one. It had issue #3225 (its
opening paragraph, Scope, `Runs on:` line, seven acceptance criteria and Proof line: "The room through both routes,
the moved lamp beside the audit's pass, the turned chair, the rug, the crates, the books and the tipped chair, each
reading beside its planted wrong program"), the design sections it links and those they lean on, and base commit
`5a81b58de` (its last merge is #3353). No other branch, worktree, stash, pull request or issue page was read.

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job
(design: Dogfooding). The suite is lean: one file and one test per criterion, each holding the planted wrong check
its criterion names, and no other case.

**Run at the base, by the job's caller.** The machine builds one cargo job at a time through a queue, so this job
started no build and no `deep-show`: the type-check passes, every judge was run against planted rows, and every
fixture's own numbers were checked by arithmetic of this job's own (What was run, below). Its caller then built the
base and ran each file once there. `BASE-FAILURE.txt` holds those runs: all seven tests fail at their own assertion,
on a `scene.relations` row that is BLOCKED `module_missing`.

## What was read

- Issue #3225, as the job's brief gave it. Its epic #310 and parent #99 have no suite in the checkout.
- `docs/canvas-primitives.md`:
  - Units and axes: metres, +Y up, the front facing +Z, degrees, R = Rz·Ry·Rx.
  - What holds a document to its rules: issues as data, `{check, code, severity, ids, path, actual, t, what, fix}`.
  - Check input: `kind` an entry of `check.kind.doc@1`; an exception a document declares never passes a
    definition's check alone.
  - Check input: shape readings: `of: ID | [ID]`, `results` on the row, `unknown`, INCONCLUSIVE, `timing.check_ms`.
  - Geometry audit: scenes: `scope`, `overlap`, `support {floating}`.
  - Check input: loop kinds. Constraint: rest_on. Document (`collections`, `audit`).
  - Registries and closed lists: `arrange@1.relations.rel` is `on`, `inside`, `next_to`, `against`, `facing`, `near`,
    `apart`.
- `docs/technical-design.md`: Document check; Numbers version 0 has to hold with The reference Macs; Criteria to
  tests, Criteria in a checked shape, Wrong programs, Dogfooding; Tests written first, Repo guards; Proven on the
  base. `docs/parallel-proof.md`: Binaries for tests, the throttle, A suite's own lane file, Budget windows.
- At the base:
  - `AGENTS.md`, `CONTRIBUTING.md`.
  - `crates/deep-canvas-motion/src/arrange.rs`: `miss`, `TOL_M`, `TOL_DEG`, `FACING_DEG`, a body as its bounds turned
    about +Y alone, a collection as the box around its members, `solve`, `carry_break_outs`, and `audit` with its
    `relation` failures `{check, ids, arrangement, a, rel, b, by, deg}`. `module.rs`: `register_arrange` (the params
    `items`, `relations`, `broken_out`) and `register_score` (a check kind with `check_report`).
  - `crates/deep-canvas/src/registry/mod.rs`: `CORE_CHECK_KINDS`, the registrar's `check`, `check_report`,
    `check_reads`, `Report`. `crates/deep-canvas/src/document/check.rs` and `form.rs`: a kind's declared forms (an
    empty list is a list). `crates/deep-canvas/src/geometry_audit.rs`: the audit's contacts and its defaults.
  - `crates/deep-show`: `main.rs` (the scenario's `docs`, `claims`, `planted`, whose unknown value is `bad_input`),
    `verdict.rs` (`judge`: a kind neither the core's nor registered is BLOCKED `module_missing`; a reporting kind's
    row holds `results` and `timing.check_ms`), `hub.rs` (`audit_of`, the `audit` on a `deep_show` reply),
    `geometry_audit.rs` (`geometry.audit` as a requirement: `scope`, `support.floating`, `mark.box@1` as a solid).
  - `scripts/proof-change.mjs` (`criterionId`, `spans`), `proof-runs.mjs` (twins), `proof-binaries.mjs`
    (`DEEP_BIN_DIR`), `benchmark.mjs` (`judgeLimit`, `fingerprint`), `lanes-lists.mjs` (`timed`), `wait-ratchet.mjs`,
    `repo-rules.mjs`.
  - The suites `1700/` (this layout, `unknown`, planted programs, the budget), `1732/` (the room, `arrange@1`, the
    audit on a reply, the break-out), `405/` and `1936/` (`geometry.audit` as a requirement, the agent's `deep_show`
    under a claim), `403/` and `1938/` (a module's check kind judged by `verdict`), `2694/` (`DEEP_BIN_DIR`).

- Three rules that landed on main after the base, as the job's caller quoted them: AGENTS.md's Proof (a suite is
  written with no comments, and says how it runs in its own `lane.json`), `docs/adr/0001` (a new suite's file starts
  at zero comment lines; a `// deadline:` marker with its reason isn't counted) and `docs/parallel-proof.md`'s
  section 7 (a lane file may name its folder's timed files).

Code was read only to learn the surface. Every expected value comes from the issue and the design.

## Run them

From the checkout's root, one file at a time:

```sh
cargo build --locked --bin deep-show     # once: the debug binary every file drives
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3225 --no-file-parallelism ac1-room.test.ts
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3225 --no-file-parallelism ac2-lamp.test.ts
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3225 --no-file-parallelism ac3-readings.test.ts
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3225 --no-file-parallelism ac4-count.test.ts
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3225 --no-file-parallelism ac5-tipped.test.ts
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3225 --no-file-parallelism ac6-measure.test.ts
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3225 --no-file-parallelism ac7-budget.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/3225/tsconfig.json   # type-check (exits 0)
rm -rf tests/acceptance/3225/node_modules     # the cache `--root` leaves
```

- **Build.** No file builds the debug binary. Each takes `deep-show` from `DEEP_BIN_DIR` when the proof run supplies
  it, else from this checkout's `target/debug/` (in `CARGO_TARGET_DIR` when the run names one), and fails `BLOCKED:`
  when it isn't there. `deep-show`'s default feature set is `full`, which holds the motion module.
- **Release build.** `ac7-budget.test.ts` alone starts cargo (`cargo build --locked --release --bin deep-show`), and
  only where `judgeLimit` says this machine can judge a timing now: a reference Mac at rest.
- **Time.** At the base each file is one `deep-show run` process, since each test fails on its first row: in a
  debug build at a load of about 40, `ac1`'s test took 2.8 s (it solves the room) and each other test under 0.5 s
  (`BASE-FAILURE.txt`). With the work, not measured: `ac1` runs six processes (four of them solving the room), `ac2`
  to `ac5` one or two, `ac6` twenty (ten documents, shipped and planted), `ac7` one, and six more in release on a
  reference Mac at rest. Every `it` passes its own timeout.
- **`--root`.** The repo's own `vitest.config.ts` loads the built workspace packages, which this job didn't build;
  `--root` runs the folder on its own, as #1700's and #1732's suites run.
- **Processes.** The tests start only `deep-show` (and cargo, as above), wait for each to end, and write only
  evidence folders under the OS temp folder, deleted after each test. Node built-ins and vitest only; no network.
- **No decision.** A test that can't decide here fails with a message starting `INCONCLUSIVE:` or `BLOCKED:`. It
  never passes and never skips.
- **Lane.** `lane.json` says the folder runs alone, for the budget's timing, and names `ac7-budget.test.ts` as its
  timed file.

## The surface under test

**No new binary and no new call.** The suite drives `deep-show run` (#393: one scenario line in, one answer line
out) with the working agent's `deep_show` of a whole revision and its `deep_query` (#411), #403's `claims`,
requirements and `{"call": "verdict", "claim"}`, as #405's and #1732's suites do. Every name below that the issue
and design don't give is this job's choice, listed again under Names this job chose. An implementation builds
exactly these, or disputes them.

### The scenario

- `evidence` is a fresh folder per run; `docs` puts each document on the panel `main`; `claims` holds claims of the
  working agent alpha (`sess-alpha`), each with one deliverable and a locked definition of requirements `{id,
  check}`; `planted` names a planted check, or is absent.
- Each document is shown by `{"call": "deep_show", "session": "sess-alpha", "doc", "document", "include":
  ["issues"]}` (criterion 6 adds `"audit"`), in #420's agent form: `{format: 1, profile: "scene", title, description,
  size, requires: {modules: {scene3d: "^1", motion: "^1"}}, items}`, with `collections` and `audit` where a fixture
  has them. Every solid is a `mark.box@1`, `{params: {size: [x, y, z]}, at: {pos, rot}}`.
- `{"call": "deep_query", "session", "doc", "paths": ["items/<id>/at/pos", "items/<id>/at/rot"], "at": ["0s"]}` reads
  an item's evaluated transform as `values[path][0]`, as #1732's suite reads the solve.

### The check, as a claim's requirement

The issue's Check input, read at the start (no test names `at`):

```json
{"kind": "scene.relations", "expect": [
  {"a": "lamp", "rel": "on", "b": "table"},
  {"a": "crate_a", "rel": "apart", "b": "crate_b", "d": 0.5},
  {"a": "books", "rel": "on", "b": "shelf", "count": [3, 5]}
]}
```

- `a` and `b` are item IDs, as `geometry.shape`'s `of` names items. `a` may be a collection's ID (`books`), which
  reads one result per member. `b` may be a collection's ID too (`room`, as #1732's `table inside room`), read as one
  body: the box around its members' bounds.
- `rel` is one of `on`, `inside`, `next_to`, `against`, `facing`, `near`, `apart`. `d`, in m, is given for `near` and
  `apart` alone. `count` is a whole number or `[min, max]`, inclusive.
- No `expect` in this suite names one `(a, rel, b)` twice, and none holds more than 64 relations.

### The verdict's row

The requirement's row is #403's `{id, kind, result, issues, …}`, decided: never BLOCKED `module_missing`, as it is
at the base.

**Results.** `results` sits on the row, as `geometry.shape`'s does: one object per relation read, with the issue's
fields `{a, b, rel, miss: {m, deg}, held}`. The tests find a relation's result by its `a`, `rel` and `b` alone, need
exactly one, and read no order and no other field.

```json
{"a": "lamp", "b": "table", "rel": "on", "miss": {"m": 0.95, "deg": 0}, "held": false}
```

- `miss.m` is in m and `miss.deg` in degrees, both finite numbers; `held` is true or false.
- **A collection as `a`** gives one result per member, its `a` the member's ID (`book_1` … `book_4`).
- **`count`** is a number on a result of the relation: on a result whose `a` is the collection's ID, or on its
  members' results. The tests read whichever is there, and every `count` the row gives for the relation must be the
  same number.

```json
{"a": "books", "b": "shelf", "rel": "on", "count": 3}
```

- **`unknown`** is the string `"unknown"` in place of `miss`, of `held` or of both. A result that reads unknown
  holds no number under `miss` and no true or false as `held`.

```json
{"a": "chair_tipped", "b": "table", "rel": "facing", "miss": "unknown", "held": "unknown"}
```

**Issues.** Each sits in the row's `issues` with its `code`, and its fields on the issue itself:

```json
{"code": "scene.relation_missed", "ids": ["lamp", "table"], "rel": "on", "miss": {"m": 0.95, "deg": 0}}
{"code": "scene.relation_count", "rel": "on", "b": "shelf", "expected": 4, "actual": 3}
```

- `scene.relation_missed`: `ids` holds the relation's `a` (every test) and its `b` (where the criterion says "naming
  both": criteria 1 and 2); `rel` is the relation; `miss` is the result's miss.
- `scene.relation_count`: `rel` and `b` are the relation's; `expected` is the `count` as `expect` gave it; `actual`
  is the number that hold.

**Result.** PASS when every expected relation holds and every count is in its range; FAIL when a relation doesn't
hold or a count is outside its range; INCONCLUSIVE when a relation the check expects reads `unknown`. A counted
relation is decided by its count: `[3, 5]` passes with one member that doesn't hold.

**Timing.** The row reports `timing: {check_ms}`, in ms, as #405's and #1700's rows do.

### The solve's own measure, for criterion 6

Nothing new: the scene audit on a `deep_show` reply, as #1732's suite reads it (`include: ["issues", "audit"]`,
`audit.failures`). An `arrange@1` item that places nothing and states relations between items it doesn't move makes
the audit list each relation the scene misses as `{check: "relation", a, rel, b, by, deg}`: `by` in m and `deg` in
degrees, from `arrange.rs`'s `miss`, the measure the solve minimises. The check's `miss.m` and `miss.deg` are held
to those. The implementation leaves that failure as the base gives it.

### The planted checks (the scenario's `planted`, reachable only there)

The implementer adds each to the planted names `deep-show run` accepts; any other value stays `bad_input`, as the
base answers an unknown one. Each is the shipped check with one thing wrong, and none can be built at the base,
which has no check to plant in. No twin folder and no `twins.json`: no Cargo feature and no overlay is needed.

| Name | The wrong check | Criterion |
|---|---|---|
| `relations_read_arrangement_list` | For each relation of `expect` it looks for an `arrange@1` item of the document whose `params.relations` lists the same `a`, `rel` and `b`, as written (a broken-out item's relations still count). Where one does, the result reads `miss: {m: 0, deg: 0}`, `held: true`, whatever the poses. Where none does, the result reads `unknown`. It never reads a pose or a bound. The row follows from its results as shipped; the document, the solve, the break-out and the audit are untouched. | `#3225.d1ce56ce` |
| `relations_read_tipped_upright` | It never reads `unknown` for an item turned off the up axis: it takes the item's bounds as the solve's body takes them, its size at `at.pos` turned about +Y by its yaw (`at.rot[1]`) alone, and reads the relation from those. Everything else as shipped. | `#3225.441d60b6` |
| `relations_measure_off_last_place` | A measure of its own: every `miss.m` and `miss.deg` it reports that isn't 0 is the next f64 above what `arrange.rs`'s `miss` gives for the same poses, and a miss of 0 stays 0. `held`, the issues and the row's result as shipped. | `#3225.39a420ed` |

## Criteria to tests

IDs are `#3225.` and the first 8 hex digits of the SHA-256 of each criterion's text, as `scripts/proof-change.mjs`
computes them; this job computed all seven from the issue's body. Each file holds its criterion's ID as `const ID`,
and its `describe` and its one test are named `${ID} …`, so the trace lane's `spans` reads each name with its one
tag. The files hold no comments: a test's title says what it is for, and its fixtures, numbers and planted check
are in this table, under Fixtures and under The files.

| ID | File | What it asserts, and what fails it |
|---|---|---|
| `AC1 #3225.d1ce56ce` | `ac1-room.test.ts` | Run 1, #1732's room shown and solved: the requirement of its twelve relations PASSes, one result each, held, each miss at most 0.001 m and 1°; the lamp stands above the table's height. Run 2, the same room written with `at` alone at run 1's `deep_query` poses: the same, and its results hash equal to run 1's. Run 3, the room and then the patch that lifts the lamp 0.3 m: FAIL, `lamp on table` not held, a `scene.relation_missed` naming lamp and table. Under `relations_read_arrangement_list` the same three runs: run 3's row is PASS, and the same judgements fail on run 2 and on run 3. Fails on: the base; the planted check; a check that reads the list when a document has one. |
| `AC2 #3225.e8197c07` | `ac2-lamp.test.ts` | One verdict on the placed room with the lamp on the floor: the `geometry.audit` row is PASS with no error and no warning; the `scene.relations` row is FAIL, its result not held with `miss.m` ≥ 0.75, a `scene.relation_missed` with `ids` holding lamp and table, `rel` `on` and `miss.m` ≥ 0.75. On the room with the lamp lifted: FAIL, `miss.m` 0.2 within 1e-9 on the result and on the issue. Fails on: the base; `on` read by the footprints alone; a check that follows the audit. |
| `AC3 #3225.288ab799` | `ac3-readings.test.ts` | `chair_90 facing table`: FAIL, `miss.deg` 70 within 1e-9, not held, an issue naming the chair. `chair_15 facing table`: PASS, held. `rug inside room`: FAIL, `miss.m` 0.3 within 1e-9. `crate_a apart crate_b` with `d: 0.5`: FAIL, `miss.m` 0.2 within 1e-9. `crate_a near crate_b` with `d: 0.5`: PASS, held. Fails on: the base; a `facing` with no 20° cone; `inside` read by the centre or against the room's interior; a distance between centres. |
| `AC4 #3225.561aacf0` | `ac4-count.test.ts` | Both rows: one result per book, held for `book_1` to `book_3`, not held for `book_4`, `count` 3. `count: 4`: FAIL, a `scene.relation_count` with `rel` `on`, `b` `shelf`, `expected` 4, `actual` 3. `count: [3, 5]`: PASS, no `scene.relation_count`. Fails on: the base; a count of members; a counted relation failed on its one miss; an exclusive range. |
| `AC5 #3225.441d60b6` | `ac5-tipped.test.ts` | `chair_tipped facing table` reads `unknown` and the requirement is INCONCLUSIVE. Under `relations_read_tipped_upright`: the result holds a number as `miss.deg`, and the same judgement fails, each failure naming `chair_tipped`. Fails on: the base; the planted check. |
| `AC6 #3225.39a420ed` | `ac6-measure.test.ts` | For 1,000 poses and seven relations each: where the scene audit reports the relation, the result is not held and `miss.m`, `miss.deg` have the audit's `by`, `deg` bit for bit; where it doesn't, the result is held within 1 mm and 1°. All 7,000 are compared, at least each pose's `apart` bit for bit. Under `relations_measure_off_last_place`: the comparison fails, the failure names its pose (`pose <k> (a_<k> …`), and a reading it names is one unit in the last place from the solve's. Fails on: the base; the planted check; any other order of operations. |
| `AC7 #3225.ecf55c06` | `ac7-budget.test.ts` | On this machine: the row of 64 relations over the 1,000-item scene PASSes, 64 results held, and reports `timing.check_ms`. Then, only where `judgeLimit` can judge a timing: a release build, one warm-up, five fresh processes, their five `check_ms` judged against 5 ms. A FAIL fails; anything but PASS is `INCONCLUSIVE:`. Fails on: the base; a reading past 5 ms on a reference Mac at rest. |

## Fixtures

Metres, +Y up, an item's front its local +Z, north −Z. Sizes are `[x, y, z]`; a place is the box's centre; a yaw
turns about +Y. `fixtures.ts` holds them all.

**#1732's room** (`roomDoc`), copied whole from `tests/acceptance/1732/helpers.ts` (suites don't import each
other; a scratch script found the two documents equal byte for byte as JSON):

| Item | Size | Place, yaw |
|---|---|---|
| `floor` | 4.2 × 0.1 × 3.2 | (0, −0.05, 0): its top is y = 0 |
| `wall_n`, `wall_s` | 4.2 × 2.5 × 0.1 | (0, 1.25, ∓1.55) |
| `wall_e`, `wall_w` | 0.1 × 2.5 × 3.0 | (±2.05, 1.25, 0): the interior is 4 × 3 m |
| `table` | 1.2 × 0.75 × 0.8 | starts at (0, 0.375, 0) |
| `chair_1` … `chair_4` | 0.65 × 0.85 × 0.65 | start on the floor at (−0.9, 1.1), (0.9, 1.1), (−0.9, −1.0), (0.9, −1.0) |
| `lamp` | 0.2 × 0.45 × 0.2 | starts on the floor at (1.7, 0) |
| `shelf` | 0.9 × 1.8 × 0.35 | starts at (0, −1.2) |
| `rug` | 1.0 × 0.01 × 0.6 | starts at (1.6, 0.95), yaw 90 |
| `arrangement` | `arrange@1` | `items`: the table, chairs, lamp, shelf and rug; `relations`: each chair `next_to table` and `facing table`, `lamp on table`, `shelf against wall_n`, `rug on floor`, `table inside room` |

`collections: {room: {members: [floor, wall_n, wall_e, wall_s, wall_w]}}`; `audit: {scope: scene, overlap: {pairs:
all, tolerance: 0.001}, support: {floating: [floor]}}`. `roomAt(poses)` is the same envelope and shell with no
`arrangement`, each of the eight pieces at the pose given. `withLampAt` changes `items/lamp/at/pos` alone.

**The room placed by hand** (`placedRoom`, criterion 2): #1732's shell and furniture by `at` alone.

| Item | Place, yaw |
|---|---|
| `table` | (0, 0.375, 0): it spans x ±0.6, z ±0.4, its top y = 0.75 |
| `chair_1` | (0, 0.425, 0.725), yaw 180 |
| `chair_2` | (0, 0.425, −0.725), yaw 0 |
| `chair_3` | (0.925, 0.425, 0), yaw −90 |
| `chair_4` | (−0.925, 0.425, 0), yaw 90 |
| `shelf` | (−1.2, 0.9, −1.325): its back on the north wall's face z = −1.5 |
| `rug` | (1.4, 0.005, 1.1) |
| `lamp`, on the floor | (0.8, 0.225, 0.6): its bounds 0.1 m east and 0.1 m south of the table's south-east corner, 0.1 m from the rug, touching nothing but the floor |
| `lamp`, lifted | (0, 1.175, 0): its bottom at y = 0.95, 0.2 m above the table's top |

With the lamp at (0, 0.975, 0) every one of #1732's twelve relations would hold (worst miss 1.7e-16 m by this job's
arithmetic). With it on the floor nothing passes into anything, every item is joined by contacts to the floor, and
`lamp on table` misses by 0.75 + 0.2 = 0.95 m.

**The turned chairs** (`chairsDoc`): a floor, the table at the origin, `chair_90` at (0, 0.425, 1.5) with yaw 90,
`chair_15` at (2.4, 0.425, 0) with yaw −75. The angle between each front and the line to the table's centre is 90°
and 15°. Neither front ray meets the table's bounds: `chair_15`'s passes x = 0.6 at z = 0.482, 0.082 m past the
corner.

**The rug** (`rugDoc`): #1732's shell and the rug at (2.4 − 0.5 cos 45° − 0.3 sin 45°, 0.005, 0) = (1.8343, 0.005,
0), yaw 45. The collection `room` spans x ±2.1, z ±1.6, y −0.1 to 2.5. The rug's corners lie 0.300 m outside (one)
and 0.124, 0.407 and 0.831 m inside.

**The crates** (`cratesDoc`): a floor, `crate_a` at (0, 0.25, 0) and `crate_b` at (0.8, 0.25, 0), each a 0.5 m
cube: 0.3 m between their bounds.

**The books** (`booksDoc`): a floor, `shelf` 0.9 × 1.0 × 0.3 at (0, 0.5, 0), `book_1`, `book_2`, `book_3` each
0.04 × 0.24 × 0.16 at (−0.2, 1.12, 0), (0, 1.12, 0), (0.2, 1.12, 0), and `book_4` at (0.8, 0.12, 0.3).
`collections: {books: {members: [book_1, book_2, book_3, book_4]}}`.

**The tipped chair** (`tippedDoc`): a floor, the table at the origin, `chair_tipped` at (0, 0.5306, 1.2) with
`at.rot` [−30, 180, 0]. Its up axis is 30° off +Y, leaning away from the table; its two lowest corners are its back
bottom ones, on y = 0. Read by its yaw alone it faces the table's centre, so the planted check reads it held.

**The seeded poses** (`seededPairs`, `posesDoc`, criterion 6): mulberry32 seeded with 3225, each number 53 seeded
bits. Pose k, in the order drawn: b's edges, each in [0.3, 1.5); b's yaw in [0, 360); a's edges, each in [0.2, 1.0);
a's yaw in [−180, 180); a's offset from b along x and along z, each in [−2, 2); a mode (0, 1 or 2); a lift in
[0, 2); `near`'s `d` in [0.05, 1.0). `b_<k>` stands on y = 0 at its cell ((k mod 100) mod 10 × 10, ⌊(k mod 100) /
10⌋ × 10); `a_<k>`'s bottom is on y = 0 (mode 0), level with b's top (mode 1) or at the lift (mode 2). A document
holds a hundred poses (200 boxes) and one `arrange@1` with `items: []` and the 700 relations; its claim holds
twelve requirements, eleven of 63 relations and one of 7. By this job's arithmetic 6,357 of the 7,000 relations are
missed (so compared bit for bit), `apart` of 6 m by at least 3.69 m at every pose, and `on` (12), `inside` (1),
`facing` (203) and `near` (427) also hold at some.

**The budget scene** (`budgetDoc`, `budgetRelations`): `floor` 115 × 0.1 × 29 and 333 groups, 1,000 items. Group g
stands at x = 3 ⌊g / 9⌋, z = 3 (g mod 9): `plinth_<g>` 1 × 0.5 × 1 on the floor, `vase_<g>` 0.2 × 0.3 × 0.2 at y =
0.65 on it, `crate_<g>` a 0.4 m cube on the floor at x + 0.7 with yaw 90. `collections: {hall: {members: all
1,000}}`. The 64 relations: for g = 0 … 8, `vase on plinth`, `vase inside hall`, `crate next_to plinth`, `crate
against plinth`, `crate facing plinth_<g+9>`, `crate near vase` (`d: 1`), `plinth apart plinth_<g+9>` (`d: 1.5`);
and `vase_009 on plinth_009`. Each holds.

## The files

No `.ts` file holds a comment but the one `// deadline:` marker in `helpers.ts`, which the wait ratchet reads. What
the names don't say:

- **`judges.ts`** is pure: no process, no file, no clock and no test runner, so a plain node script can run each
  judge against planted rows. Each judge takes a requirement's row (`rowOf`, null when the verdict has none) and
  answers with why the row doesn't read as its criterion says, an empty list when it does. Nothing in it stands in
  for the check: every value compared comes from a reply, every expected value from the issue.
  - `heldFailures`: the row PASSes, and each expected relation has one result, held, its miss at most 1 mm and 1°.
    `holdsFailures` is the same for one relation.
  - `resultsOf`, `resultsHash`, `sameResultsFailures`: the results cut to the issue's five fields, their hash, and
    the relations whose results differ between two rows.
  - `missedFailures`: the row FAILs; the relation's one result is not held and carries the stated miss (`Bound`: at
    least a number, or near one within a tolerance); a `scene.relation_missed` issue carries the relation, the same
    miss and the IDs in `names`.
  - `auditPassFailures`: a `geometry.audit` row is PASS with no error and no warning.
  - `countFailures`: one result per member, held for those in `holding` alone; `count` as stated; a
    `scene.relation_count` issue on a row that FAILs, and none on one that PASSes.
  - `readsUnknown`, `unknownFailures`: the result reads `unknown` and the requirement is INCONCLUSIVE; every
    failure names the relation, and so its `a`.
  - `solveMisses`: the `relation` failures of a `deep_show` reply's `audit`, and those it can't read.
    `measureMismatches`: each reading against them; `bitwise` counts the readings compared bit for bit, `heldOnly`
    those compared by `held` alone.
  - `bitsOf` is an f64's 64 bits as 16 hex digits; `lastPlaces` is how many f64 values apart two finite numbers of
    one sign are. `timingOf` is null for a timing that isn't a finite number at or above 0.
- **`fixtures.ts`** is pure too. Every document is in the agent's form, every solid a `mark.box@1` (a unit box
  scaled by `params.size` about its centre). `Pose` is an item's transform as `deep_query` reads it. `TURNED`,
  `FACING_CONE`, `RUG_OUT`, `CRATE`, `TIP`, `LIFT` and `LIFT_OUT` are the criteria's numbers, in degrees and metres.
  `SEEDED` is the seed, the poses, the poses a document holds, the poses a requirement reads and `apart`'s distance;
  `BUDGET` the scene's items, groups, groups a column, grid pitch, relations and limit in ms. `poseOf` reads a
  relation's pose from its `a`; `poseText` is the pose in words, for a failure to name it.
- **`helpers.ts`** drives `deep-show run` and stands in for nothing. Parts are copied from #405's, #1700's and
  #1732's helpers, since suites don't import each other. `none` fails on any failure and lists the first twelve.
  `inconclusive` and `showBin`'s `BLOCKED:` fail a test that can't be judged; neither passes or skips. `run`'s
  timeout only turns a hang into a failure. `judgeLimit` and `fingerprint` are the perf lane's own, imported from
  `scripts/benchmark.mjs`, never copied. `releaseBin` is called only after the lane's gate passes.
- **`ac1-room.test.ts`**: `solved`, `written` and `moved` are the three runs, each a process of its own; `ROUTE`
  holds the first words of each run's failures, by which the planted run's failures are told apart.
- **`ac3-readings.test.ts`**: `FACING_MISS_DEG` is the issue's 70°, 90° less the 20° cone; `APART_MISS_M` its 0.2 m,
  0.5 m less the crates' 0.3 m.
- **`ac5-tipped.test.ts`**: `judged` is the one run, shipped or planted.
- **`ac6-measure.test.ts`**: `compared` shows and judges one document and holds two guards before it compares: the
  audit's `relation` failures can be read, and each pose's `apart` is among them. `named` is a mismatch as a
  failure, starting with its pose.
- **`ac7-budget.test.ts`**: `reading` is one fresh process: the row judged, then its `timing.check_ms`.

## Readings where the issue and design leave a choice

- **How the check is reached.** As a claim's requirement, judged by `verdict`, on a document the working agent
  showed: the surface #405's, #1700's and #1732's suites already drive. The expected relations sit in the claim's
  locked definition, never in the document.
- **A collection as `b`.** The Scope writes `b: ID | ground`. Criterion 1's relations include `table inside room`
  and criterion 3 reads the rug against the room, so a collection's ID is read as an ID there, as `arrange@1` takes
  it.
- **Where a result sits, and how it is found.** On the row's `results`, by `a`, `rel` and `b`. The issue gives a
  result no index and no path, so the tests read none.
- **`unknown`.** The issue says a relation "reads `unknown`" and gives the result no field for it. The string may
  stand for `miss`, for `held` or for both; what fails is a number or a flag beside it.
- **Where `count` sits.** "`count` is how many hold" names no place. The tests take it from any result of the
  relation, the collection's own or a member's.
- **Issue fields.** On the issue itself, as #1700's `geometry.reading` fields are read.
- **#1732's room, solved by `arrange@1`.** #1732's `roomDoc()`, shown by the agent, its solved poses read by
  `deep_query`, as #1732's first criterion's test reads them. The test also holds the lamp above the table's
  height, so the poses are the solve's.
- **Two routes, compared by hash.** The second route is a second process: the same envelope and shell, no
  `arrange@1` item, each piece at the pose `deep_query` gave, the numbers as JSON carries them. Both routes must
  PASS alike, and their results must be equal: SHA-256 of the canonical JSON (keys sorted) of the twelve results
  cut to the issue's fields `{a, b, rel, miss: {m, deg}, held}`, in `expect`'s order. Other fields, such as the
  document's ID, and the order of `results` are left out of the hash, and JSON prints −0 as 0.
- **A room whose lamp was broken out and moved.** #1732's patch: a whole revision that differs only at
  `items/lamp/at/pos`, the lamp 0.3 m above its solved place. The criterion says the planted check passes that
  room, so the shipped check must not: the test asks it to FAIL `lamp on table`, naming both. Without that run, a
  check that reads the list wherever a document has one would pass both routes.
- **"Fails this test".** The planted check runs the same three runs and the same judgements. The test needs the
  room written with `at` alone to fail them (it has no list to read) and the moved lamp to fail them (it passes).
- **Criterion 2's room.** A room placed by `at` alone, by hand. The issue's first paragraph says an agent "can state
  fewer, or none, and place by `at`"; and at the base the scene audit reports an arrangement's own missed relation
  (#1732's fifth criterion), so a room the audit passes lists no `lamp on table`.
- **"The geometry audit passes that room".** A second requirement of the same claim, `{kind: geometry.audit, scope:
  scene, support: {floating: [floor]}}`, reads PASS in the same verdict, with no error and no warning: the check
  kind as #405's and #1936's suites judge it. The floor is declared floating by the definition, since a document's
  own exception never passes a definition's check. This row passes at the base too.
- **"Beside the table", "at least the table's height", "naming both".** On the floor, off the table's south-east
  corner, 0.1 m clear of it along x and along z. `miss.m` ≥ 0.75 m on the result and on the issue. The issue's `ids`
  holds `lamp` and `table`.
- **"Lifted 0.2 m straight above the table".** The lamp over the table's centre, its bottom 0.2 m above the top.
- **"Turned 90°" and "15° from the table's centre".** The angle between the chair's front and the line from its
  centre to the table's. `chair_15` stands far enough that its front ray clears the table's bounds, so the test
  holds the issue's "within 20° of the other's centre" and not a ray's hit, which the base's measure also counts.
- **"Missed by 0.3 m", "missed by 0.2 m".** Read within 1e-9 m, the bound the criteria give their other distances.
- **"One corner 0.3 m outside the room".** The room is the collection `room`'s box, the outer faces of its shell,
  as the base's measure reads a collection. The rug is turned 45° so one corner alone leads; it passes under the
  east wall, which no reading here judges.
- **"On a shelf".** The measure's `on` reads the other's top, so the books stand on the shelf's top.
- **"A requirement of 4", "of `[3, 5]`".** `count: 4` and `count: [3, 5]`, two requirements of one claim.
- **"Tipped 30° on its back legs".** `at.rot` [−30, 180, 0]: turned about its own X axis, its top leaning back.
- **"Returns a number and fails, naming the chair".** Under the planted check the result's `miss.deg` is a number,
  and the shipped check's judgement, run unchanged, fails with every failure naming `chair_tipped`. The chair's
  yaw faces the table, so the planted check passes the requirement: the case "never PASS" is there for.
- **"What the solve's own measure gives for those poses".** The scene audit's `relation` failures, the one surface
  of the base that reports `miss` for a pose as it stands (the solve's refusal reports it for the best pose its
  search reached). The audit lists a relation only when the measure misses it, so a relation the measure holds is
  compared by `held` alone, within 1 mm and 1°: its number isn't in reach. Each pose's `apart` of 6 m is missed by
  construction, so every pose has a number compared.
- **"Bit for bit".** The two numbers as the reply's JSON carries them, read as f64 and compared by their 64 bits.
- **"Two boxes", "each reading".** Two `mark.box@1` items a pose, read for all seven relations, a to b.
- **"Naming the pose".** Each failure starts `pose <k> (` and gives both boxes' sizes, places and yaws.
- **"Differs in the last place".** Under the planted check a reading the failure names is one f64 from the solve's.
- **The budget.** #1700's model. "64 relations over a 1,000-item scene": the most a check takes, over exactly
  1,000 items, each relation holding, so the time is a whole reading's. "Read in under 5 ms": the row's
  `timing.check_ms`. "On the reference Mac in the local preflight": `judgeLimit`'s rule, five fresh release
  processes after a warm-up; a timing off a reference Mac, off mains power or at a load above the cores is a
  reading and decides nothing (design: The reference Macs). The criterion names no merge base, so none is timed.
- **Planted checks.** Through the scenario's `planted`, as #1700's and #1732's are, each inside its criterion's one
  test after the shipped check's assertions, so at the base each test fails on the shipped check's row.

## Names this job chose

None of these is in the issue or the design; an implementation builds them as written, or disputes them.

- **Planted names:** `relations_read_arrangement_list`, `relations_read_tipped_upright`,
  `relations_measure_off_last_place`, each the scenario's `planted`, each doing exactly what its row above says.
- **Result and issue shapes assumed:** `results` on the requirement's row; a result's `a`, `b`, `rel` as strings; a
  member's result named by the member's ID; `"unknown"` as a string in place of `miss` or `held`; `count` as a
  number on a result of the relation; the issues' `ids`, `rel`, `miss`, `b`, `expected` and `actual` on the issue
  itself; `timing.check_ms` on the row; the audit's `relation` failure with `a`, `rel`, `b`, `by` and `deg`.
- **Item and collection IDs:** #1732's, and `chair_90`, `chair_15`, `crate_a`, `crate_b`, `shelf`, `book_1` to
  `book_4`, `books`, `chair_tipped`, `a_0000` to `a_0999`, `b_0000` to `b_0999`, `plinth_000` to `plinth_332`,
  `vase_…`, `crate_…`, `hall`.
- **Document, claim and requirement IDs:** `01JB3225D…`, `claim:01JB3225C…`, `req:01JB3225Q…`, numbered per file;
  the session `sess-alpha`.
- **Judges, fixtures and helpers:** in `judges.ts`, `rowOf`, `timingOf`, `heldFailures`, `resultsOf`, `resultsHash`,
  `sameResultsFailures`, `missedFailures`, `holdsFailures`, `auditPassFailures`, `countFailures`, `readsUnknown`,
  `unknownFailures`, `solveMisses`, `measureMismatches`, `bitsOf`, `lastPlaces`, `canon`; in `fixtures.ts`, the
  documents and relations named under Fixtures; in `helpers.ts`, `showBin`, `run`, `scenarioOf`, `claimOf`,
  `relations`, `SCENE_AUDIT`, `show`, `query`, `verdict`, `presented`, `posesOf`, `none`, `inconclusive`,
  `judgeLimit`, `load`, `releaseBin`, `PLANTED`.

## Not asserted

No criterion says these, so no test holds them:

- **Scope lines no criterion reaches:** `at` other than the start; `b: ground`; an item placed by `rest_on`, by a
  parent or by a physics bake's pose (the criteria reach an arrangement, `at` and a broken-out item); an item with
  no bounds; `next_to` and `against` on a tipped item, and a tip of 1° or less; that the working agent can't write
  or change the expected relations (every test's relations sit in the claim's locked definition, and no criterion
  plants an agent's write); the cap of 64; what is "Not in this task".
- **Inputs:** an ID the document lacks; a `rel` outside the closed list; `d` missing, or on another relation; a
  collection as `a` with no `count`; `count` on one item; one `(a, rel, b)` named twice.
- **The row and the issues:** the order of `results`; any field of a result beyond the issue's five and `count`;
  `held` on a collection's own result; whether a counted relation's member that doesn't hold raises
  `scene.relation_missed`; an issue's `severity`, `path`, `what` and `fix`; the row's `machines` and `determinism`;
  the claim's own result; the catalog's and the registry's rows for the kind and its codes.
- **Numbers:** in criterion 1 the misses themselves, beyond 1 mm and 1° and the two routes' equality; in criterion
  6 the number of a relation the solve's measure holds; `timing` other than `check_ms`.

## What the implementer adds outside the folder

- The three planted names among those `deep-show run` accepts, each as its row above says.
- Nothing in `scripts/lanes.mjs` or `scripts/lanes-lists.mjs`: the suite's own `lane.json` says the folder runs
  alone and names `ac7-budget.test.ts` as timed (`docs/parallel-proof.md`, section 7, A suite's own lane file), so
  the file lands with the suite and needs no signed approval.
- Nothing in any `Cargo.toml`: the suite holds no Rust test.
- A budget window proves criterion 7 only once a task of `benchmarks/budgets.json` names `#3225.ecf55c06`
  (`docs/parallel-proof.md`, Budget windows). That task is the owner's, not this suite's.

## At the base

`BASE-FAILURE.txt` is the run at the base, base commit `5a81b58de`, on 2026-11-26: the caller's debug build of
`deep-show` and each file once by the command above. All seven tests fail, each at its own `none(…)` line on its
first judgement of a `scene.relations` row: no module registers the kind, so each row is BLOCKED with `{code:
"module_missing", kind: "scene.relations", ids: []}`, with no `results` and no `timing`.

What the runs showed of the base, each line a guard that passed before its test failed:

- `deep-show run` shows every fixture a run reached with no error and no item skipped: #1732's room, both placed
  rooms, the chairs, the rug, the crates, the books, the tipped chair, the first hundred poses with their `arrange@1`
  of `items: []`, and the 1,000-item scene.
- It solves #1732's room and `deep_query` reads its poses.
- Criterion 2's `geometry.audit` row is PASS on the room whose lamp stands on the floor, as the criterion says.
- The scene audit lists a `relation` failure, with `by` and `deg`, for relations between items an arrangement
  doesn't place: `apart` of 6 m for each of poses 0 to 99.

What they didn't reach, since each test stops at its first failure: criterion 1's second and third runs (the room
written with `at` alone, the patch that breaks the lamp out); the later judgements of criteria 2, 3 and 4; poses 100
to 999; any timing; and every planted run, whose name the base would refuse with `bad_input`.

## What was run

By the job's caller, at the base: `cargo build --locked -j 8 --bin deep-show` (debug), then each of the seven files
once (`BASE-FAILURE.txt`). Those runs were made on the files as first written, with comments. The comments were taken
out afterwards and no code changed: each of the ten `.ts` files, emitted by the checkout's TypeScript with comments
removed, is byte for byte what it was, and its tokens are the same. No run was made on the files as they stand now.

By this job, with no build and no product binary:

- `node node_modules/typescript/bin/tsc -p tests/acceptance/3225/tsconfig.json`: exits 0, before and after the
  comments were taken out.
- A scan with TypeScript's own scanner: one comment line in the folder's `.ts` files, the `// deadline:` marker.
- `vitest run --root tests/acceptance/3225` with a name filter no test has: the seven files load and their seven
  tests are found, none run (on the files with comments).
- Scratch scripts outside the repo, in the job's scratch folder (not part of the suite):
  - each judge against planted rows, 99 checks: a good row passes, and each wrong one fails naming what its
    criterion names (the base's BLOCKED row; a miss past 1 mm; one result off in the last place; a miss of 0.2 m
    where the table's height is due; an issue naming the lamp alone; 90° where 70° is due; a count of 4; a number
    for the tipped chair; a measure one unit in the last place off, named by its pose);
  - each fixture's numbers by this job's arithmetic: `roomDoc()` equal to #1732's; the table's height 0.75 m; the
    lamp's 0.95 m and 0.2 m; the chairs' 70° and 15°; the rug's 0.3 m and its one corner; the crates' 0.3 m and
    0.2 m; the books' count of 3; the 30° tip on the back legs; the seeded poses and the 64 relations that hold;
  - each test's name as `spans` reads it, one test a criterion, each ID equal to the issue body's;
  - `judgeLimit` as the budget test asks it: INCONCLUSIVE on this machine at this job's load.
