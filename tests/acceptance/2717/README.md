# Acceptance tests for #2717: deep_kinds lists the vehicle body with its fields and defaults, and a defaults run reads them back

Written first, blind, from issue #2717 ("Physics module: deep_kinds lists the world's body kinds, the vehicle body
with its fields and defaults": its opening paragraph, its Scope and its one acceptance criterion; it has no comments
and no Oracle line), the design sections below and base commit `a0d3713a7`, by a job that never saw an implementation
and read no other worktree, branch or pull request. The implementing agent doesn't edit these files (AGENTS.md, Proof);
a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test per clause of the criterion that
needs its own run, and one for the one planted wrong program this job adds.

The criterion, `#2717.6803fbfb` (`scripts/proof-change.mjs`'s ID, computed here from the issue's body):

> `deep_kinds` lists the vehicle body with every field of its `vehicle` and each default the world reader takes when the
> field is left out, and a defaults run builds the car with every field left out and reads those values back.

## What was read

- The issue as saved for this job (title, state, body), and its body alone for the criterion's ID. Not GitHub.
- `docs/canvas-primitives.md`: Body `body@1`: vehicle (its Fields line is the list of fields and defaults asserted
  here); Body `body@1` and Body `body@1`: character; World and backend `physics.world@1`; Canvas module (`registers:
  {…, tool_entries, …}`); Registry and seal: registries. `docs/technical-design.md`: The physics module (Vehicle body);
  the `deep_kinds` paragraph under the agent tools; Criteria to tests; Wrong programs; Dogfooding; Built to be hard to
  get wrong. `AGENTS.md`, `CONTRIBUTING.md`.
- At the base, for call shapes only: `tests/acceptance/1974/` (README, helpers, both tests, `BASE-FAILURE.txt`: the
  defaults run and this layout), `1971/` and `412/` (deep_kinds `op: field` and `op: list`, the listing's `modules`
  rows), `251/` (README, helpers: the car) and `2306/` (README, helpers, `twins.json`); `crates/deep-show/src/kinds.rs`
  (`module_row`, `listing`, `kinds::command`, `Planted::named`, its unit test of the character body's entry),
  `kinds/replies.rs` (`op: list`), `defaults.rs` (the run and its report) and `physics/lap.rs` (the car);
  `crates/deep-canvas-physics/src/module.rs` (the character body's tool entry), `doc.rs`, `doc/character.rs` and
  `doc/vehicle.rs` (the world reader), `kit/vehicles.rs` (the car); `crates/deep-physics-rapier/src/main.rs`,
  `planted.rs` and `runner.rs` (`check`'s `built`, a bake's `vehicles`); `packages/contracts/canvas-schemas/kinds.dump@1.json`
  (`lists` on a module's row); `scripts/proof-change.mjs` (criterion IDs), `scripts/proof-runs.mjs` (`twins.json`, a
  failure at its assertion), `scripts/lanes.mjs`.

Nothing this job needed lay outside those inputs.

## What the base already does, which these tests don't credit

The issue's opening paragraph describes main as it was on November 16; `f735dc89f` (#182) changed part of it. At the
base (`BASE-FAILURE.txt` has the run and the probes):

- deep_kinds `op: list` answers `modules`, one row per canvas module, and a row's `lists` holds what that module's
  `deep_kinds` tool entries add. The physics module's row lists one entry, the character body's: `{"name":
  "body@1.character", "kind": "character", "shapes": "…", "fields": {"character.slope_limit": "deg = 45", …}}`. It
  lists no other body kind and nothing of `vehicle`. The listing test reads that entry first, with the reader it reads
  the vehicle's with, and then fails: the row lists no `body@1.vehicle`.
- The world reader already takes a value of its own for each of the six fields left out: 0.3, 1, false, false, true,
  and 35 for `steer_max` (`doc/vehicle.rs`), the design's defaults. It refuses a wheel without `at`, `radius` or its
  suspension's `rest`, `travel` or `hz` (`physics.missing_field`). So the car with all six left out already builds:
  `deep-physics`'s `check` of it answers `"issues": []` and `"built": ["ground", "kart"]`, and the same car with one
  wheel's `radius` left out is refused. Nothing at the base prints those defaults or proves a printed one against the
  reader. That the reader's values are the design's is not credited to the work: no test here passes on it alone,
  since each needs the listing or the run's entry.
- A defaults run exists (#1974): `deep-show kinds --defaults [--planted <name>]` answers one report, `{"ok", "verdict",
  "reason", "count", "listed", "first_skipped", "failures", "skipped", "kinds"}`, PASS over the full build's 300 fields
  with a default. It walks the dump's registry entries field by field; it reads no module row's `lists`, builds no
  world, and its report names no body kind and has no `lists`. Both tests of the run fail there.
- `deep-show kinds --defaults --planted vehicle_reader_takes_other_defaults` answers `{"ok":false,"code":"bad_input"}`
  and exits 2: the base knows no such plant.
- No reply at the base hands back a wheel's fields as the reader took them: `deep-physics`'s `check` answers `built`,
  the IDs of the bodies built, and a bake's `vehicles` hold a vehicle body's state (spin, spin rate, touching, and the
  drive, steer and brake it holds).

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs build --wait 180 -- sh scripts/lease \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/2717 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2717/tsconfig.json     # type-check
rm -rf tests/acceptance/2717/node_modules                                       # vitest's cache
```

Node 24 and `cargo` (on the `PATH`, or in rustup's folder on this Mac). Each file builds the full `deep-show` once
(`cargo build --locked --bin deep-show`, default features, which are `full`) in the checkout's own `target/`, with
`CARGO_TARGET_DIR` dropped and `CARGO_INCREMENTAL=0`, `CARGO_PROFILE_DEV_DEBUG=0` unless set, as #1974's suite does;
the binary under test is the newer of `target/release/deep-show` and `target/debug/deep-show`. No hub, no `deep mcp`,
no built packages and no `deep-physics`: both surfaces are `deep-show`'s own. No cargo, or a `deep-show` that can't
start, fails the test with a message starting `BLOCKED:`; a call that outlasts its limit (10 minutes for the listing,
45 for a defaults run) fails it with one starting `INCONCLUSIVE:`; neither is ever a pass. Nothing here depends on
the machine or its load: no test times anything. Every test passes its own timeout (60 minutes) and the build hook
its own (2 hours). Every temporary folder is under `/tmp/dh2717-*` and is deleted after its file; no process is started
but `cargo` and `deep-show`, each waited for, and none is stopped by name or port. Node built-ins and vitest only; no
other suite's helpers are imported.

`BASE-FAILURE.txt` is the run of both files at the base.

## The surface under test

The issue names `deep_kinds`, "the physics module's tool entries" and "a defaults run", and no entry name, field path,
call or report field. The tests reuse what the base's suites already read: deep_kinds `op: list` on `deep-show run`
(#412's, #1971's), the physics module's row and its `lists` (the base's character body), and #1974's defaults run and
its `--planted` plants. **Every name below marked *(ours)* is this job's invention**, the least the criterion needs,
spelled as the issue, the design and the base's character body's entry spell things; the implementer builds exactly
these, or a dispute goes to a blind redraft.

### The listing

deep_kinds `{"call": "deep_kinds", "op": "list"}` on `deep-show run` (one scenario `{"evidence", "calls": [...]}`, one
reply per call). Its answer's `modules` holds the row named `physics`, and that row's `lists` holds, beside the
character body's entry:

```json
{"name": "body@1.vehicle", "kind": "vehicle",
 "fields": {
   "vehicle.wheels.<name>.at": "local point, m",
   "vehicle.wheels.<name>.radius": "m",
   "vehicle.wheels.<name>.suspension.rest": "m",
   "vehicle.wheels.<name>.suspension.travel": "m",
   "vehicle.wheels.<name>.suspension.hz": "f32",
   "vehicle.wheels.<name>.suspension.damping_ratio": "f32 = 0.3",
   "vehicle.wheels.<name>.grip": "f32 = 1",
   "vehicle.wheels.<name>.steers": "bool = false",
   "vehicle.wheels.<name>.drives": "bool = false",
   "vehicle.wheels.<name>.brakes": "bool = true",
   "vehicle.steer_max": "deg = 35"}}
```

- **The entry's name, `body@1.vehicle`** *(ours)*, and **its `kind`, `"vehicle"`** *(ours)*: as the base names the
  character body `body@1.character`, of kind `character`.
- **`fields`**: an object from each field's path to its text, as the character body's. **The eleven paths** *(ours,
  after the issue's `vehicle.wheels.<name>.suspension.damping_ratio`)*: `vehicle.`, then the field's place in the
  design's Fields line, dotted, with the literal `<name>` standing for a wheel's name. The tests read exactly the
  eleven keys above.
- **How a default is printed** *(ours, after the character body's `"deg = 45"`)*: the field's unit or type, then ` = `
  (space, equals sign, space) and the default, a JSON value that ends the text: `0.3`, `1`, `false`, `false`, `true`,
  `35` (a number is read by value, so `1` and `1.0` are one default). A field with no default prints no ` = `. The
  text before ` = ` is not read.

Any other member of the entry (the character body's has `shapes`) and any other key of `fields` are not read.

### The defaults run

`deep-show kinds --defaults [--planted <name>]`, #1974's run: one JSON object on one line, its report. The tests read
its `verdict` (PASS on the full build, as #1974's suite already holds) and one new member:

- **`lists`** *(ours)*: an array with one object for each entry of the module rows' `lists` the run built, found by
  its `name`. The tests read the one named `body@1.vehicle`:

```json
{"name": "body@1.vehicle",
 "world": {"kind": "physics.world@1", "…": "…",
           "bodies": {"ground": {"kind": "static", "…": "…"},
                      "kart": {"kind": "vehicle", "mass": 1000, "…": "…",
                               "vehicle": {"wheels": {
                                 "fl": {"at": [0.8, -0.15, 1.25], "radius": 0.3, "suspension": {"rest": 0.3, "travel": 0.2, "hz": 2}},
                                 "fr": {"at": [-0.8, -0.15, 1.25], "radius": 0.3, "suspension": {"rest": 0.3, "travel": 0.2, "hz": 2}},
                                 "rl": {"at": [0.8, -0.15, -1.25], "radius": 0.3, "suspension": {"rest": 0.3, "travel": 0.2, "hz": 2}},
                                 "rr": {"at": [-0.8, -0.15, -1.25], "radius": 0.3, "suspension": {"rest": 0.3, "travel": 0.2, "hz": 2}}}}}}},
 "built": ["ground", "kart"],
 "read": {"wheels": {
            "fl": {"at": [0.8, -0.15, 1.25], "radius": 0.3, "suspension": {"rest": 0.3, "travel": 0.2, "hz": 2, "damping_ratio": 0.3},
                   "grip": 1, "steers": false, "drives": false, "brakes": true},
            "fr": {"…": "the same fields"}, "rl": {"…": "the same fields"}, "rr": {"…": "the same fields"}},
          "steer_max": 35}}
```

  - **`world`** *(ours)*: the `physics.world@1` document the run built, as it wrote it: the car in it with every field
    that has a default left out.
  - **`built`** *(ours, after `deep-physics`'s `check` reply)*: the IDs of the bodies the world's build made; the
    car's is among them.
  - **`read`** *(ours)*: the car's `vehicle` as the world reader took it, in the document's own shape (the design's
    Fields line): `{"wheels": {name → {"at", "radius", "suspension": {"rest", "travel", "hz", "damping_ratio"}, "grip",
    "steers", "drives", "brakes"}}, "steer_max"}`, every field filled in, the written ones as written and the ones left
    out with the value the reader took. A listed path leads into it as it leads into the document: `vehicle.` is
    `read` itself, and `<name>` each wheel.

Nothing else of the report is read: not `count`, `listed` or `kinds` (#1974's suite holds `count` to the dump's count
of registry fields with a default, so the vehicle's six stay out of it), and no exit status.

### The planted twin

`deep-show kinds --defaults --planted vehicle_reader_takes_other_defaults` *(ours)*, a startup argument as #1974's
plants are (`kinds::Planted::named`). The criterion names no planted program; this one is added because the clause
"reads those values back" can't otherwise be held to the reader: the base only shows that a run with no vehicle body
in it fails. `twins.json` maps the criterion's ID to it.

| Plant | The wrong program |
|---|---|
| `vehicle_reader_takes_other_defaults` | the world reader takes another value for each vehicle field left out: `damping_ratio` 0.6, `grip` 2, `steers` true, `drives` true, `brakes` false, `steer_max` 30, where the listing says 0.3, 1, false, false, true and 35. The listing, the run and the document it builds are the right ones, and nothing else changes |

Under it the run answers its report as ever (exit status not read): `verdict` is `FAIL`, and the `body@1.vehicle`
entry's `world` is the same car with the same fields left out and its `read` holds 0.6, 2, true, true and false at
every wheel and `steer_max` 30.

## The car and its world

**The car** is #251's fixture car (`tests/acceptance/251/README.md`, The car; at the base it is `kart` in
`crates/deep-show/src/physics/lap.rs` and `car` in `crates/deep-canvas-physics/src/kit/vehicles.rs`): a vehicle body of
1,000 kg on four wheels at the corners of a 2.5 m wheelbase and a 1.6 m track centred under its centre of mass, on
springs of 2 Hz with rest 0.3 m and travel 0.2 m. The tests know it in the run's `world` as the one body of kind
`vehicle`, with `mass` 1,000, four wheels whose `at` are (±0.8, y, ±1.25), one at each corner, and each suspension's
`rest` 0.3, `travel` 0.2 and `hz` 2. Its ID, its wheels' names, their radius and mount height, its chassis and its
pose are the run's: both of the base's spellings of the car pass.

**With every field left out**, each wheel writes `at`, `radius` and `suspension: {rest, travel, hz}` and nothing
else, and `vehicle` writes no `steer_max`. #251's own documents write `damping_ratio`, `steers` on the front wheels,
`drives` on the rear ones and (in its suite's helper) `steer_max`; here none is written, so as read this car has no
steering and no driving wheel and brakes on all four.

**Its world** is the run's to choose: this suite builds no world of its own, and reads of `world` only its bodies and
the car's `vehicle`.

## The criterion to its tests

Each `describe` and each test title starts with `#2717.6803fbfb`.

| File | Test | What it asserts | What fails it |
|---|---|---|---|
| `listing.test.ts` | lists | the physics row still lists `body@1.character` with `character.slope_limit` printed `deg = 45` (the base's entry, read by the same reader); it lists `body@1.vehicle`, of kind `vehicle`, with the eleven paths; the six defaulted fields print 0.3, 1, false, false, true, 35; `at`, `radius`, `rest`, `travel`, `hz` print no default | the base (no `body@1.vehicle`); a path missing or spelled otherwise; a default missing, or not the issue's; a default printed for a field the reader refuses a wheel without; the character body's entry gone or reshaped |
| `defaults.test.ts` | run | the run's report has `lists` with `body@1.vehicle`; its `world` holds the car; that document leaves out all six defaulted fields at every wheel and writes the other five; `built` lists the car; `read` holds every written field as written and, at every wheel, the issue's default and the default deep_kinds prints for each field left out; the verdict is PASS | the base (no `lists` in the report, and no listed default to read back); a run that builds another car, or the car with a defaulted field written; a `read` that lacks a field or holds another value than the listing's; a verdict other than PASS |
| | twin: `vehicle_reader_takes_other_defaults` | the planted run answers a report with the entry; its `world` is the same car, every field left out; the read-back check that passes the real program fails on it at each of the six fields and at no other; `read` holds the planted reader's 0.6, 2, true, true, false, 30; the verdict is FAIL | the base (the plant is unknown: `bad_input`); a run that prints the listing's defaults again without building (it reads 0.3 back and passes); a run that builds the car with the fields written (it reads the written values back); a run that passes a reader whose default differs from the listing's |

Test count: 1 + 2 = 3.

**How "reads those values back" is held to the reader, not to the listing.** On the real program the listing's
default and the reader's are the same value, so no report of the real run alone can show where a value came from. The
twin separates them: its reader takes 0.6 where the listing still says 0.3, and so on for all six. A run that only
prints the listing's defaults again, without building the car, shows 0.3 in `read` and PASS under the twin, and the
twin's test fails on it twice (the read-back check finds nothing wrong at the six fields, and `read` is not the planted
reader's). A reader whose default differs from the one listed is the twin itself: the run must say FAIL and show the
reader's value. The comparison of the two runs is not vacuous: `read` is there in both, equal to the listing at every
field and wheel in the real run, and different at every one of the six fields, at every wheel, in the twin's, while the
five written fields read back the same in both.

## Readings where the issue and the design leave a choice

- **Where the vehicle body is listed**: where the base lists the character body, the physics module's row under
  `modules` of deep_kinds `op: list`, in its `lists` (#251's Scope: "through the physics module's tool entries"), and in
  the character body's shape. No second way of listing is invented. The criterion names only the vehicle body; the
  Scope's "`physics.world@1`'s body kinds … the vehicle body among them" is held as far as the base already lists a
  body kind: the character body's entry stays, and the vehicle body's is beside it.
- **"Every field of its `vehicle`"**: the eleven leaves of the design's Fields line, each by its dotted path. `wheels`
  itself (a map of at most 8) is not a key the tests read.
- **"Each default the world reader takes when the field is left out"**: the six defaults the design's Fields line
  and the issue's Scope give, printed with those values. For `at`, `radius`, `rest`, `travel` and `hz` the reader takes
  none (it refuses the wheel), so a default printed for one of them fails the listing test.
- **"A defaults run"** is the base's, #1974's `deep-show kinds --defaults`, with the vehicle body's entry in its
  report; the criterion gives no reason for a second kind of run or a new call. The entry is not one of the report's
  `kinds`: #1974's entries there prove a default by two builds of a kind's example, one per field, and its `count` is
  held to the dump's registry fields, while this criterion asks for one build of the car with every field left out and
  the values read back. So the entry has a member of its own, `lists`, named after the module row's.
- **"Builds the car with every field left out"**: one world holding the car, with every field that has a default left
  out at once (a field with none can't be left out: the reader refuses the wheel). The run shows the document it built
  (`world`) and the bodies its build made (`built`).
- **"Reads those values back"**: "those values" are the defaults deep_kinds prints. The run shows the car's `vehicle`
  as the world reader took it (`read`), and the test compares it, at every wheel, with the default the listing prints
  (read from the listing in the same test) and with the issue's value. The verdict PASS is the run's own word that
  they agree; the twin's FAIL its word that they don't.
- **Numbers** are compared within 1e-6 (the design types a wheel's numbers `f32`), the car's own to 1e-9; booleans and
  everything else by JSON content.

Nothing in the issue is contradictory. One clause can't be tested as its words stand: "every field left out" can't
include `at`, `radius`, `rest`, `travel` or `hz`, which have no default; it is read as every field that has one.

## Not asserted, because no criterion says so

The other body kinds (`static`, `kinematic`, `dynamic`) in the listing, and the character body's entry beyond its
staying; the text before ` = ` (a field's unit or type) and any other member of the entry; `≤ 8` wheels in the
listing; the vehicle body in `deep-show kinds --dump`, `op: field`, the sheet or the hub's `deep kinds`; the run's
`count`, `listed`, `kinds`, `failures` and exit status, and what its report names when it fails; the world the car is
built in, and the car's behaviour in it (that is #251's and #2306's); a defaults run for the character body or any
other listed entry; the schedule snapshot and the kit ledger, which name the physics module's interface digest (it
changes with its tool entries, so a test pinning either would fail on any right program).

## What the implementer adds outside this folder

- `'tests/acceptance/2717/'` in `scripts/lanes.mjs`'s `alone` list (each file builds cargo and starts `deep-show`), as
  #1974's folder is; this README is the instruction, and the implementer makes that edit.
- Whatever names the physics module's interface digest (`crates/deep-show/schedule/full.json`,
  `crates/deep-show/kit-ledger.json`) follows the new tool entry; that is the work's, not this suite's.

Nothing in this folder changes.

## Files

- `helpers.ts`: the full build, deep_kinds `op: list` on `deep-show run`, the defaults run, and the criterion's checks
  (`listingFailures`, `carOf`, `leftOutFailures`, `builtFailures`, `readFailures`), which return sentences and assert
  nothing.
- `listing.test.ts` (the first clause), `defaults.test.ts` (the second clause and the twin).
- `twins.json`: the criterion's ID to the planted twin.
- `tsconfig.json`: type-checks the suite under the root's strict options with `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run at the base.
