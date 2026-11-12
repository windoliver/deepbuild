# Acceptance tests for #1919: physics.query and the physics shapes mode, reaching the backend only through query()

Written first, from issue #1919 (its Scope, its Fields, four acceptance criteria and its Proof line: "physics.query
probes and casts with their planted twins"), its Oracle page (`doneright/oracles/issues/1919.md` in DeepBuildAI/deepbuild,
branch `doneright`: no upstream test for any criterion), the design sections it names and base commit `35df4523f`
("Merge pull request #2280 …", which holds #2009's, #2010's, #2012's, #1918's and #411's merges), by a job that never
saw an implementation; none existed, and no other worktree, branch or pull request was read. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean:
one test per criterion clause that needs its own run, plus the planted twins the criteria name; `deep-physics` wherever
a criterion allows, `deep-show` only for criterion 3.

## What was read

- The issue, live with `gh issue view 1919 --repo windoliver/deepbuild`, and its Oracle page.
- `docs/technical-design.md`: The physics module; Dogfooding; Tests written first. AGENTS.md.
- `docs/canvas-primitives.md`: World and backend `physics.world@1` and its backend interface; Check input:
  `physics.query`; Bake; Golden; Checkpoint ring; Occurrence list; Physics output; Physics: behavior kit (the
  projectile, 10.19 m; queries against a brute-force scan); Render-back and Render-back: diagnostic modes; Logic:
  between-step services (`physics.cast@1`).
- At the base, read only for the surfaces these tests extend: `tests/acceptance/2009/`, `2010/`, `2012/`, `1918/`, `411/`
  (READMEs, helpers, `modes.test.ts`); `crates/deep-physics-rapier` (`runner.rs`, `main.rs`, `lib.rs`, `Cargo.toml`),
  `crates/deep-canvas-physics` (`backend.rs`, `golden.rs`, `bake.rs`, `lib.rs`, `doc.rs`'s body and output fields);
  `crates/deep-show` (`modes.rs`, `main.rs`'s build set and its `test-leave-out-*` features, `Cargo.toml`);
  `scripts/proof-change.mjs` (criterion IDs), `scripts/proof-runs.mjs` (`twins.json`), `scripts/lanes.mjs` (`alone`),
  `scripts/physics-wasm32.mjs`.

What the base already does, which these tests don't credit: `deep-physics` bakes, keys, stores, restores and goldens a
world document and answers its occurrence list (#2009, #2010, #2012, #1918); its backend interface (`Backend` in
`deep-canvas-physics/src/backend.rs`) has no `query()` or `move_character()`, and no call answers a ray, a sweep, an
overlap or a probe. `deep-show`'s closed list of modes holds `physics_shapes`, owned by `physics`, but lists it among
the modes no build draws yet, so every build answers it `module_missing`; no cargo feature leaves the physics module out
of the full set. Checked at the base before the run, with a probe on the base's `deep-physics` (not committed): the
projectile below writes contact_begin at step 1 and contact_end at step 2 (no hit: the ball leaves the floor), then
contact_begin and its one `hit` of ball and floor at step 174, where the ball's x is 10.2428 m (0.049 m past 10.19, and
0.757 m short of 11).

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/1919 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/1919/tsconfig.json
rm -rf tests/acceptance/1919/node_modules/.vite
```

Each file builds what it drives once, in `beforeAll`, honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and
`CARGO_PROFILE_DEV_DEBUG=0` unless set, Homebrew's rustup put on PATH when present, and copies each binary into a
temporary folder:

| File | Builds |
|---|---|
| `ac1-through-query.test.ts` | `cargo build --locked -p deep-physics-rapier --bin deep-physics --features test-count-calls` (alone) |
| `ac2-probes.test.ts` | `cargo build --locked --bin deep-physics` (#2009's helper) |
| `ac3-shapes-mode.test.ts` | `cargo build --locked -p deep-show --bin deep-show --features test-leave-out-physics`, and the same with `--features test-physics-shapes-empty` |
| `ac4-machines.test.ts` | `cargo build --locked --bin deep-physics`; then `node scripts/physics-wasm32.mjs` (#2012's wasm32 leg, which builds `deep-physics-rapier` for `wasm32-unknown-unknown` and answers in Node's WebAssembly engine) |

Every test passes an explicit timeout: 60 minutes (#2009's `TIMEOUT`), or 30 for `ac3`'s (#1918's `SHOW_TIMEOUT`); the
builds in `beforeAll` have 60 minutes a build. Bake stores, evidence stores and binaries are temporary and deleted. Node
built-ins and vitest only; `../1918/helpers.ts` (and through it `../2010/helpers.ts` and `../2009/helpers.ts`) and
`../2012/helpers.ts` are imported read only: the world builders, `bake`, `recordGolden`, `verifyGolden`, `goldenOf`,
`statesOf`, `rowsOf`, `scratch`, the build of `deep-physics`, #1918's `deep-physics` runner and `deep-show run` scenario
helpers, and #2012's `onWasm32`. No process is started but `cargo`, `deep-physics`, `node scripts/physics-wasm32.mjs`
and `deep-show`, each waited for, none stopped by name or port. Gates: no cargo on this machine is `BLOCKED:` (#2009's
helper), a failed test, never a pass; nothing here is INCONCLUSIVE, since no reading depends on load or a device.

## The surface under test

The issue names a check (physics.query, its probe, state, expectation and result), the backend interface's `query()`
and `move_character()`, a test backend that counts its calls, a mode and planted wrong programs, but no command line.
**Every call, field, reply field, flag, cargo feature and planted name below that the issue or the design doesn't give
is this job's invention**, the smallest the criteria need, extending #2009's, #2010's, #2012's and #1918's
`deep-physics` (their READMEs' surfaces stand as written) and #411's `deep_show` modes in `deep-show run`. The
implementer builds exactly these, or a dispute goes to a blind redraft.

### `deep-physics`: the call `query` (physics.query)

| Call | Reply |
|---|---|
| `{"call": "query", "world": World, "steps": n, "frame_rate"?: "p/q", "store": folder, "probe": Probe, "state"?: State, "expect": Expect, "tolerance"?: number, "golden"?: Golden, "runs"?: [Run]}` | `{"ok": true, "verdict": "PASS" \| "FAIL" \| "BLOCKED", "key": 64 hex, "result": Result \| null, "what": string}` |

```text
Probe   = {"output": {"path": "outputs/<output ID>[/<i>]", "at": flicks | Occ}}
        | {"occurrences": {"list": "occurrences", "filter"?: Filter, "measure"?: "count" | "first" | "last" | {"field": name} | {"order": [ID]}}}
        | {"ray": {"from": vec3, "dir": vec3, "max"?: m = 100, "groups"?: [group name]}}
        | {"sweep": {"shape": Shape, "from": Pose, "to": Pose, "groups"?: [group name]}}
        | {"overlap": {"shape": Shape, "at": Pose, "groups"?: [group name]}}
Occ     = {"list": "occurrences", "filter"?: Filter, "nth"?: "first" | "last" | n = "first"}
Filter  = {"kinds"?: [Kind], "ids"?: [ID]}       rows of those kinds (absent: all) naming every listed ID as a or b
State   = {"step": k} | {"t": flicks} | {"occurrence": Occ}       absent: {"step": 0}
Expect  = {"value": number} | {"range": [lo, hi]} | {"ids": [ID]} | {"order": [ID]}
Result  = {"value": number | null, "step": k, "t": flicks, "ids": [ID], "machines": "any" | "same"}
```

- **The bake** is the one `bake` or `golden` (#2010) kept in `store` under the key of `world`, `steps` and `frame_rate`
  (absent: `"60/1"`), as `play` finds it; `key` is that key. The query reads it and never steps past it, and never bakes:
  with no bake under the key the verdict is `BLOCKED`, `result` null, `what` saying so (Check input: a missing bake is
  BLOCKED).
- **Shapes and poses** are #2009's: a Shape as a world's `shapes` entry (`{"kind": "sphere", "radius"}`, `{"kind":
  "box", "half"}`, …), a Pose `{"pos": vec3, "rot"?}`. `"list": "occurrences"` names the world's own occurrence list
  (#1918's rows); `Kind` is #1918's kind name.
- **A ray, sweep or overlap** runs through the backend interface's `query()`, one call per probe (the interface takes one
  ray, sweep or overlap per call), on the state at `state`'s step (Check input: restored from the nearest checkpoint at
  or before it and stepped to it). `ids` are its hits sorted by distance, then ID (an overlap's by ID); `value` is the
  nearest hit's distance in m along the ray or the sweep (null when nothing is hit), and an overlap's number of IDs.
  `step` and `t` are the state's step and its time.
- **An output** reads the output's value at `at` by Physics output's rule; at an occurrence that is the state after the
  occurrence's step (α = 0), and `step` is that step. `outputs/<ID>/<i>` is component i (0 x, 1 y, 2 z) of a vector
  output. An occurrence that never comes within the bake fails, naming the list and the filter.
- **The verdict**: `PASS` when the result meets `expect` (`value` within `tolerance`, default 0, of the expected value;
  inside `range`; `ids` or the order equal), else `FAIL`, with `what` naming the step and the value read. `result` is
  there on PASS and FAIL.
- **`machines`** (Check input: "machines: any when the bake's golden matched on its second machine"): `golden` is the
  bake's golden (#2010's `golden` reply's object, its `bake_key` the bake's golden key) and `runs` the `golden_verify`
  replays made of it (#2010, #2012, as `golden_cross` takes them). `any` when, for every target in the golden's
  `verify_on`, a run from that target on another architecture than the golden's `machine.arch` passed; `same` otherwise,
  and with no `golden`. A run on the recording architecture never counts.

### The test backend (criterion 1)

Cargo feature **`test-count-calls`** of `deep-physics-rapier`: `deep-physics` built with it runs the module on a backend
that wraps Rapier and counts the backend-interface calls the module makes, and answers one more call:

| Call | Reply |
|---|---|
| `{"call": "backend_calls"}` | `{"ok": true, "calls": {"query": {"ray": n, "sweep": n, "overlap": n}, "<method>": n, …}}` |

`calls` counts every backend-interface call the module made in this process since it started, by method (`build`,
`step`, `restore`, `query`, …); `query`'s count is split by the kind of query asked. Only `calls.query` is read here,
an absent kind or an absent `query` read as 0. Everything else is Rapier's. It is a test backend, never in a shipped
build.

### Planted twins of `deep-physics`

| Switch | Criterion | The wrong program |
|---|---|---|
| `--planted query_bypasses_backend` | 1 | physics.query answers every ray, sweep and overlap from Rapier's query pipeline directly, never through the backend interface's `query()`; its answers are otherwise the same |
| `--planted query_machines_any` | 4 | every physics.query result reports `machines: "any"`, whatever the golden and its runs |

Each twin's process must exit 0 and answer; the judge that passes the real program must fail on the twin's answer.

### `deep-show`: what this suite adds

| Cargo feature | The build |
|---|---|
| `test-leave-out-physics` | the full set without the physics module (as #489's `test-leave-out-data` and the others leave theirs out) |
| `test-physics-shapes-empty` | criterion 3's twin: the same build without the physics module, whose `physics_shapes` mode returns an empty snapshot (presented, a snapshot that draws no shape) instead of `module_missing` |

Driven unchanged: #393's scenario (`evidence`, `sessions`, `processes`, `panels`, `docs`, `calls`) and #411's `deep_show`
with `mode`, `t`, `size` and `include: ["issues", "pixels"]`, whose module_missing answer is `{"outcome": "refused",
"code": "module_missing", "module": <canvas module>, …}` with no snapshot and no `drawn`.

`twins.json` maps each criterion's ID to its twins.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed, computed from the live issue. Each `describe` and `it` title starts with its criterion's ID.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 `#1919.adaa86f8` | `ac1-through-query.test.ts` (2) | On the counting build, the projectile baked into a store, then physics.query once with a ray down from (5, 3, 0), a 0.1 m sphere swept from (5, 3, 0) to (5, −1, 0) and a 0.5 m box overlapping at (5, 0, 0), each at step 0 expecting ids `[floor]`: each PASS with ids `[floor]`, and `backend_calls` counts exactly one `query()` ray, one sweep and one overlap. With `query_bypasses_backend` on the same build the counts are short and the judge fails, naming `query(`. Fails: a probe answered past the interface, one that never runs |
| 2 `#1919.b83c52f8` | `ac2-probes.test.ts` (2) | The projectile baked into a store: the probe of `outputs/ball/0` at the first `hit` of ball and floor expecting 10.19 ± 0.1 is PASS, its step that of the bake's first such row and its value the ball's x after that step within 1e-5 m, within 0.1 of 10.19; expecting 11 ± 0.1 it is FAIL with the same step and value, its `what` naming the step; the ray down from (5, 3, 0) at step 0 expecting 3 ± 0.001 is PASS, ids `[floor]`, step 0, its value within 1 mm of 3 m. The bake's files deleted from the store, the output probe and the ray are each `BLOCKED`. Fails: a probe read at another occurrence or time, a failure that names nothing, a ray that misses or measures from elsewhere, a check that re-bakes or passes without its bake |
| 3 `#1919.4c1f2dbc` | `ac3-shapes-mode.test.ts` (2) | `deep_show` of a 3D scene in `physics_shapes` at 1 s on the build without the physics module: `code: "module_missing"`, `module: "physics"`, no snapshot, nothing drawn. On `test-physics-shapes-empty` the same judge fails. Fails: a mode that answers an empty picture, or names another module |
| 4 `#1919.6198ed94` | `ac4-machines.test.ts` (2) | The projectile's golden recorded here (verify_on wasm32); the x probe given the golden reads `machines: same` with no run and with this Mac's own PASS replay (`machines: same`); after #2012's wasm32 leg replays it (PASS, target wasm32-unknown-unknown, `machines: different`), the probe given both runs is PASS and reads `machines: any`. With `query_machines_any` the probe given no run reads `any` and the judge fails, naming the probe. Fails: machines read from the build or from any run, a result that always says any or never does |

Test count: 2 + 2 + 2 + 2 = 8.

## Readings where the issue leaves a choice

- **The surfaces.** physics.query (criteria 1, 2 and 4) through `deep-physics`, the physics module's runner, which
  already bakes, stores, goldens and plants twins, as #2011's physics.pairs is its `pairs` call; the mode (criterion 3)
  through `deep-show run`, the binary that holds the build set and #411's modes.
- **"A ball whose initial velocity is (10 cos 45°, 10 sin 45°, 0) m/s"**: a 0.1 m sphere resting on a static floor
  whose top is y = 0 (#2009's `floor`), launched from there, so it lands back at launch height (the kit's 10.19 m);
  friction and restitution 0, damping at its default 0 ("no drag"), the world's default gravity (0, −9.81, 0) at
  120 Hz × 4 substeps; baked 240 steps (2 s). **"Its x at its first hit on the floor"**: output `ball` (`read:
  position`) component 0, at the first `hit` row naming ball and floor (#1918's rows: the launch writes a
  contact_begin and a contact_end, no hit, since the ball moves away), so the value is the ball's x after that step.
- **"Fails, naming the step and the value it read"**: the FAIL's `result` holds the step and value the passing probe
  read, and its `what` names the step. **"Returns the floor's ID at 3.00 m within 1 mm"**: `ids` `[floor]` and `value`
  within 0.001 of 3. **"With the bake deleted"**: every file of the store removed, the folder kept; `BLOCKED` for both the
  output probe and the ray.
- **"Sees every ray, sweep and overlap arrive through query()"**: exactly one `query()` call of each probe's kind per
  probe, counted by the test backend; **"leaves the count short and fails, naming the call"**: the judge's failure names
  `query(` and the kind (the twin itself needn't name it).
- **"A build without the physics module"**: a cargo feature leaving physics out of the full set, as the `test-leave-out-*`
  features do; the shown scene holds no world, since a world needs the module the build lacks. **"Naming the module"**:
  #411's `module` field, `physics` (the mode's name contains the word, so the text alone can't tell). **"A planted mode
  that returns an empty snapshot instead"**: a build of its own, judged by the same rule.
- **"Its second machine"**: the target in the golden's `verify_on`; the golden here asks for wasm32 alone (Golden: a
  golden that feeds a check verifies in the web player's wasm32 too), whose replay #2012's leg makes in Node's V8, on
  another architecture, so no container is started. **"Once it has"**: a PASS replay from that target among `runs`. The
  same-architecture replay shows a passing run that isn't the second machine's doesn't count. **"Fails, naming the
  probe"**: the judge's failure names the probe (`output outputs/ball/0 at the first hit of ball and floor`).

## Not tested, because no criterion reaches it here

`move_character()` and the character body; `physics.cast@1` and `nav.reach` reaching `query()`; the `occurrences` probe
and its measures; `at` and `state` as a time or an occurrence; `range`, `ids` and `order` expectations beyond `ids`;
collision groups and `max` on a query; a probe whose occurrence never comes; the GPU and picture rules; expectations
only the working agent wrote; physics shapes drawn in a build with the physics module. They are follow-ups for the
implementer's own tests.

**`scripts/lanes.mjs` needs `'tests/acceptance/1919/'` in its `alone` list**: the files build cargo binaries (deep-show
twice, deep-physics with a test feature, the wasm32 module) and run long scenarios. This README is the instruction; the
implementer makes that edit.

`BASE-FAILURE.txt` is the run at the base.
