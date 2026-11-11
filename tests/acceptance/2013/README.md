# Acceptance tests for #2013: scatter and rest_on, distribute by minimum distance, density and pruning, and an item that rests on another's true shape at check

These tests were written before any implementation existed. The writer had issue #2013 (its Scope, its Fields for
distribute and rest_on, its three acceptance criteria, its Proof line "A scattered garden with its parity fixtures" and
its Oracle line), the parent #442 for what the sibling parts own, the issue's Oracle page, the design sections the
issue names and the ones those lean on, and base commit `7c5e1cc8`. No implementation existed, and no other worktree,
branch or pull request was read.

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job
(design: Dogfooding). The suite is lean: one file per criterion, the one planted wrong program criterion 3 names, and
no budget or timing test, since no criterion here names one. The Oracle line's lane is `tests/acceptance/2013-oracle/`.

**Not run as a suite.** The machine's one-minute load was 284 on 18 cores, so no Rust was built here and the test files
weren't run. A debug build of the base's own `deep-show` (`--features full`, nothing changed) was made outside this
folder, and every fixture document was put through it with the suite's own helpers in a scratch vitest file that
wasn't kept. `BASE-FAILURE.txt` says what each test meets first there, and which lines were observed and which were
read from the code. The type-check passes. The scratch file also ran the judges on their planted sets and computed
every fixture number below.

## What was read

- Issue #2013's body and its Oracle page (`doneright/oracles/issues/2013.md`), with the upstream test that page pins
  for criterion 3 (SciPy's `test_qmc.py`, lines 938 to 968). Issue #442's body, for the siblings: the terrain plate is
  #2014's, geometry measures #2015's, wind #2016's and the task's budgets #2017's. #2013 "needs no terrain, wind or new
  attributes", so its 10 × 10 m plate is a flat part.
- `docs/canvas-primitives.md`: Order keys; Document envelope; Object; Builder (`plate {grid, size}`, true shapes);
  Attribute and field, and Attribute and field: distribute; Instance `instance@1` (`from: distribute(…)`, an element
  addressed `<instancer>#<id>` and seeded by hash(seed, id)) and its logic columns; The order of one evaluation ("as
  rest_on refuses an item a channel drives"); Constraint, and Constraint: rest_on; What holds a document to its rules,
  and Check input; Geometry audit, and Geometry audit: scenes; Determinism.
- `docs/technical-design.md`: Modeling steps, Attribute and field, Constraint, Document check, Rules every primitive
  follows, and in How we know version 0 works: Criteria in a checked shape, Wrong programs, Criteria to tests both ways
  and Dogfooding.
- At the base, for surfaces and conventions only:
  - `AGENTS.md`.
  - `crates/deep-show`: `run`'s calls and the planted match in `main.rs`, `Planted` in `hub.rs`, the `geometry` call
    in `geometry.rs`, the audit's solids in `geometry_audit.rs`, `deep_query`'s `read_path` in `query.rs`, and the
    `frames` reply in `frames.rs`.
  - `crates/deep-canvas/src/geometry_audit.rs`: the tolerances `sunk`, `touch` and `land`, and what holds a part.
  - `crates/deep-canvas-scene3d`: an instancer's rows in `cut.rs` (`elements`) and how `scene.rs` places them, the
    plate builder and `true_shape` in `builders.rs`.
  - `crates/deep-canvas-motion`: a document's `constraints` map in `doc.rs`, and `rest_on` in `constraint.rs`, which
    at the base rests an item on a ground plane (`{ground, bottom, offset, max_drop}`).
  - `crates/deep-canvas/src/expr.rs`: the closed function list's `max` and `sign`, and swizzles.
  - `scripts/proof-change.mjs` (`criterionId`) and `scripts/lanes.mjs` (`alone`).
  - The earlier blind suites `405/` (the model for layout; #405 is #2013's one dependency), `1732/` (how "no solve per
    frame" was read, and `deep_query` for evaluated transforms), `484/` and `424/` (an instancer's rows), `420/` (the
    `geometry` call), `489/` (constraints), `1897/` (a cross-architecture leg held by a record) and `2010/`,
    `2010-oracle/` (an oracle lane beside its suite).

Code was read only to learn the surface. Every expected value comes from the issue and the design.

## Run them

Every file builds `deep-show` with cargo, so they run one file at a time. The implementer adds these lines to
`scripts/lanes.mjs`. This README is the instruction; this job edits nothing outside its two folders.

```js
// #2013's files each build deep-show.
alone.push('tests/acceptance/2013/');
alone.push('tests/acceptance/2013-oracle/');
```

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/2013 --no-file-parallelism
npx tsc -p tests/acceptance/2013/tsconfig.json   # type-check
rm -rf tests/acceptance/2013/node_modules/.vite
```

- **Build.** Each file first runs `cargo build --locked --bin deep-show --no-default-features --features full`, with
  `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0` unless they're already set, copies the binary out of `target/`
  (honoring `CARGO_TARGET_DIR`), and fails each test whose build failed.
- **Isolation.** Every test writes into temporary folders and deletes them. The one file kept is criterion 1's record
  of this machine's points, `target/acceptance-2013/points-<platform>-<arch>.json`. The suite uses Node built-ins and
  vitest only.
- **No decision.** A leg that can't run here fails with a message starting `BLOCKED:`. It never passes.
- **The other machine.** `DEEP_2013_OTHER_RECORD=<path>` names the other CPU architecture's record for criterion 1's
  second test (below).

## The surface under test

**No new binary and no new call.** The suite drives the #393 `deep-show run` (one scenario line in, one answer line
out) with calls the base already has: the agent's `deep_show`, #420's `geometry`, #411's `deep_query`, #387's `frames`,
and #403's scenario `claims` with its `verdict` call. Every name below that the issue and the design don't give is this
job's choice, listed again under Readings. An implementation builds exactly these, or disputes them.

### The documents (helpers.ts)

Every fixture is a `scene` document in the agent's form: no `id`, no `layers`, `requires.modules` holding `scene3d`,
plus `motion` where a constraint is written. The working agent (`sess-alpha`) shows it with `{"call": "deep_show",
"session", "doc", "document", "include": ["issues"]}`. The reply is `outcome: "presented"`, with no error issue and no
`unknown_kind` notice. Metres, +Y up, right +X.

- `plate@1 {grid: [1, 1], size: [x, z]}` is a flat sheet at y = 0 centred on `at.pos`, its normal +Y. `mark.box@1` and
  `mark.sphere@1` are unit solids centred on `at.pos` and scaled by `params.size`; each is its own true shape. A
  prototype is a box with `visible: false`.
- **A scatter** is an `instance@1` whose `params` hold `of: [prototype ID]` and, in place of written columns,
  `from: {distribute: {…}}` with the issue's fields:

  | Field | Used |
  |---|---|
  | `on` | the plate's ID |
  | `mode` | `"poisson"` |
  | `min_distance` | m: 0.5, and the oracle lane's radii |
  | `seed` | 2013 |
  | `prune` | `"larger_first"` on criterion 1's `shrubs`; left out elsewhere (`none`) |
  | `yaw` | `[0, 0]` in criterion 1, so nothing turns; left out elsewhere |
  | `density` | `"max(sign(position.x), 0)"` in criterion 3's second document |
  | `max` | 50 in the oracle lane; left out elsewhere |

- **A rest** is an entry of the document's `constraints` map, where the base's constraints are written:
  `rest: {owner: "vase", kind: "rest_on", on: "table"}`, every other field at the issue's default.

### Reading a scatter back: the `geometry` call

`{"call": "geometry", "doc", "items": [<instancer ID>, …]}` answers `items`, with one row for each instancer named:
`{id, kind: "instance@1", elements: [Element], …}`, the scatter as it feeds the instancer at check.

`Element = {id, proto, pos, yaw, scale}`, the instancer's columns for one element:

| Field | Meaning | When left out |
|---|---|---|
| `id` | the element's stable ID, a whole number ≥ 0, none twice: the element is `<instancer>#<id>` | required |
| `proto` | the index of its prototype in `of` | 0 |
| `pos` | its point, `[x, y, z]` in world metres | required |
| `yaw` | its turn about +Y, in degrees | 0 |
| `scale` | a number, or `[x, y, z]` | 1 |

The tests sort the elements by `id`, so the row may list them in any order. Two scatters are the same when every
element's `id`, `proto`, `pos`, `yaw` and `scale` are the same JSON numbers.

### Reading the rest: `deep_query`, the verdict and `frames`

- `{"call": "deep_query", "session", "doc", "paths": ["items/vase/at/pos"], "at": ["0s"]}`: `values[path][0]` is the
  item's evaluated place with its constraints applied, in m, as #1732 reads an arrangement's place.
- The definition's check is a claim's requirement: `{kind: "geometry.audit", scope: "scene", tolerance: {sunk: 0.002,
  touch: 0.002, land: 0.002}, support: {floating: ["table"]}}`. `{"call": "verdict", "claim"}` judges it, and the
  requirement's row is #405's: `{id, kind, result, issues}`, with `geometry.overlap` and `geometry.floating` among its
  codes.
- `{"call": "frames", "doc", "count": 6}`: six frames 1/60 s apart from 0, each with `ran`, the number of nodes the
  frame ran.

### The planted program (the scenario's `planted`, reachable only there)

The implementer adds it to `Planted` in `crates/deep-show/src/hub.rs` and names it in `src/main.rs`'s planted match:

| Name | The wrong program | Criterion |
|---|---|---|
| `distribute_stops_after_10_points` | the scatter's sampler stops after 10 points; everything else as shipped | `#2013.2dab09c8` |

No Cargo test feature is needed: every test builds `full`.

## Criteria to tests

IDs are `#2013.` and the first 8 hex digits of the SHA-256 of each criterion's text, as `scripts/proof-change.mjs`
computes them: `- [ ] ` dropped, trimmed, and whitespace collapsed (checked with that code's own expression). Every
test's name starts with its ID. Each file's header states its fixture, numbers and wrong programs in full.

| ID | File (tests) | What it asserts |
|---|---|---|
| `#2013.8b415be3` | `ac1-prune-same-points.test.ts` (2) | See [Criterion 1](#criterion-1) |
| `#2013.8f9fddef` | `ac2-rest-on.test.ts` (2) | See [Criterion 2](#criterion-2) |
| `#2013.2dab09c8` | `ac3-poisson.test.ts` (3) | See [Criterion 3](#criterion-3) |

### Criterion 1

The garden: the 10 × 10 m plate and two scatters of `bush` (a 1.2 m box, prototype 0) and `flower` (a 0.3 m box,
prototype 1), each with `min_distance: 0.5`, `yaw: [0, 0]` and seed 2013. `shrubs` has `prune: larger_first`; `loose`
leaves pruning out.

- **Bounds.** `shrubs` places at least two elements. Every pair of its points is at least 0.5 m apart. No two of its
  elements' bounds pass more than 2 mm into each other.
- **The trap is live.** `loose`, the same scatter unpruned, has at least one pair of bounds that do.
- **A second process** gives both scatters to the last bit.
- **Any sibling order.** The same document with its items listed, and their `order` keys running, the other way round
  gives both scatters to the last bit.
- **Every machine** (the second test). This machine's points are written to
  `target/acceptance-2013/points-<platform>-<arch>.json` and must equal the other CPU architecture's record, which
  `DEEP_2013_OTHER_RECORD` names. Without it, or with a record from this machine's own architecture, the test is
  `BLOCKED:`. The unblock: run this test on a machine of the other architecture (x86_64 for an arm64 Mac, or the
  reverse; the design lets a linux/amd64 container count for CPU checks) and point the variable at the record it
  writes there.

### Criterion 2

A table top 1.2 × 0.05 × 0.8 m centred at y 0.8 and tilted 20° about +Z, and a round vase of radius 0.1 m written
0.3 m left of the table's centre at y 1.2, with `rest: {owner: vase, kind: rest_on, on: table}`.

- **The place.** The vase's evaluated x and z are as written (within 1e-6 m), and its ball is within 2 mm of the
  table's true shape, neither apart nor passing in. Its centre rests at y 0.82383.
- **The audit.** The geometry audit's row is PASS with no error or warning.
- **Nothing per frame** (the second test). The vase rests on the table in the revision shown, and of six frames every
  one after the first has `ran` 0.

### Criterion 3

The plate and `stones`, a poisson scatter of one prototype with `min_distance: 0.5`.

- **Plain.** Every point lies on the plate (within 1e-6 m). Every pair is at least 0.5 m apart. No disc of radius
  1.0 m whose centre has |x| and |z| under 4.5 is empty of points.
- **Density.** With `density: "max(sign(position.x), 0)"`: at least two points, all on the plate, every pair at least
  0.5 m apart, and none with x < 0.
- **The planted `distribute_stops_after_10_points`.** It places 10 points, every pair at least 0.5 m apart, so it
  passes the distance rule; and it leaves an empty disc of radius 1.0 m, so it fails the empty-disc rule. The test
  asserts both.

## The judges, and the sets they must fail

The tests compute three things themselves. Each test that uses one first runs it on planted sets
(`judgesFailTheirPlants` in `helpers.ts`, `judgeFailsItsPlants` in criterion 2's file), so a judge that passes
everything can't pass a file.

| Judge | Passes | Must fail |
|---|---|---|
| least pairwise distance | the 441 points of a 0.5 m lattice over the plate (least 0.5 m) | the lattice and a point 0.4 m from one of them; a set of one point |
| empty disc (exact, by branch and bound on the distance to the nearest point) | the lattice: no disc | the lattice less its 12 points within 1.0 m of (2.25, 2.25): the disc there, its nearest point 1.0607 m away |
| bounds that pass into each other | two 1.2 m boxes 1.3 m apart | two 1.2 m boxes 1.0 m apart along x and z (1.414 m apart, 0.2 m deep); a 0.3 m box 0.7 m from a 1.2 m one |
| the vase's gap to the table | the centre at y 0.82383 (gap 0) | where it was written (0.3535 m apart); on the ground plane (0.5241 m under); on the table's bounds (0.2865 m apart); its lowest point on the surface under its centre (6.03 mm in); slid 0.01 m sideways |

## Wrong programs and traps

Criterion 3 names its wrong program; it is planted. Criteria 1 and 2 name none, so their fixtures carry the traps, with
no planted program in shipped code.

| Criterion | Wrong program | What catches it |
|---|---|---|
| 1 | keeps centres 0.5 m apart and never prunes by prototype bounds | two bushes 0.5 m apart pass 0.7 m into each other, so `shrubs` fails the bounds rule; `loose` proves the scatter does produce such pairs |
| 1 | prunes everything, or all but one | fewer than two elements |
| 1 | points depend on sibling order: one random stream shared by the document's scatters and drawn in item order, or a seed from an item's place | the reversed document changes `shrubs` or `loose` |
| 1 | seeds from the clock, the process or thread order | the second process changes a scatter |
| 1 | points depend on the machine | the other architecture's record differs |
| 2 | leaves the item where it was, or rests it on the ground plane (the base's rest_on) | the vase is 0.35 m above the table, or 0.52 m under it; the audit reports it floating |
| 2 | rests bounds on bounds | the tilted table's bounds top is at y 1.0287, so the vase stops 0.2865 m above the top: a gap |
| 2 | drops the vase's lowest point onto the surface under its centre | the ball passes 6.03 mm into the tilted top: an overlap past 2 mm |
| 2 | solves again in every frame (the base's constraints run every frame) | `ran` is over 0 after the first frame |
| 3 | the sampler stops after 10 points (planted) | passes the distance rule, fails the empty-disc rule: ten discs of radius 1.0 m cover at most 31.4 m² of the 81 m² where a centre may lie |
| 3 | fills only part of the plate, or packs closer than 0.5 m to fill it | the empty-disc rule, or the distance rule |
| 3 | ignores the density field, or reads it mirrored | a point with x < 0 |

## Readings where the issue and design leave a choice

### The surface

- **How a document writes `from: distribute(…)`.** As `params.from: {distribute: {…fields}}` on the `instance@1`, in
  place of its written columns. The design writes it as a call; JSON has none.
- **The seed.** `seed` sits among the distribute's fields, where the design's field list has it. It is "the
  instancer's seed" that each element's choices hash with its ID.
- **`on`.** The plate's item ID. "Over the part's area" is the plate's sheet.
- **A density field** is written as an expression string over `position`, from the closed function list.
  `max(sign(position.x), 0)` is 0 for x ≤ 0 and 1 for x > 0. It has no `/`, `log`, `sqrt` or `pow`, so it needs no
  `fallback`.
- **Reading the points back.** The design gives no read of an instancer's rows: `deep_query`'s `elements` read refuses
  `domain: instance`. At the base `deep_query` reads no array param, written or not, and `geometry` refuses an
  instancer with `ref_unresolved`. The `geometry` call already answers "what the build made" for an item, a
  `curve@1`'s row among them, so the scatter's row is added there: `elements`, shaped as the instancer's columns.
- **`max` left out** reads as the cap, 100,000.
- **rest_on's entry** sits in `constraints`, with `owner` as every base constraint has it.
- **The vase's place** is `deep_query`'s `items/vase/at/pos` with the constraint applied. At the base that read is the
  written place.
- **The planted name** is `distribute_stops_after_10_points`.

### Criterion 1

- **"Prototype bounds"** are an element's prototype's box, scaled, turned by its yaw, at its point. The fixture sets
  `yaw: [0, 0]` and leaves `scale` at `[1, 1]`, so a correct program's bounds are the prototype's box at the point,
  whichever of the world box or the turned box "bounds" means. The judge still applies each element's reported `yaw`
  and `scale`.
- **"Closer than allowed"** is read from the design's two rules: every pair of points at least `min_distance` apart,
  and, pruned, "no two prototype bounds overlap". An overlap is one past 2 mm, the tolerance of the audit the design
  says checks it (Geometry audit: scenes, `overlap.tolerance = 0.002`). The issue gives no other number.
- **The prune mode.** `larger_first`. The design names the modes and doesn't say how they differ, so nothing here
  depends on which elements survive.
- **At least two elements.** Neither the issue nor the design gives a count. Two is the least for "two prototype
  bounds" to mean anything.
- **"Any sibling order"** is the order of the scatter's siblings: the items of the document, whose order is their
  `order` keys (Order keys). The reversed document lists them the other way round and reverses the keys. The `of`
  list keeps its order, since `proto` indexes it.
- **"Every machine"** is held as #1897 holds its cross-architecture claim: one leg, a record from the other CPU
  architecture, BLOCKED without it. A second process on this machine is asserted too, but never counts as a second
  machine.
- **The same points** means the same JSON numbers, not near ones.

### Criterion 2

- **The vase and the table.** The issue gives no sizes. The table's top is tilted and the vase is round so that true
  shapes and bounds disagree by far more than 2 mm; on a level box they'd agree and a bounds-on-bounds rest would
  pass. The 20° tilt is this job's number: at 20° both bounds programs in the table above miss by over 2 mm. Both
  shapes are ones the base's audit reads exactly (a ball and a turned box). rest_on "can never settle physically", so
  the vase stays where it touches.
- **"No gap and no overlap past 2 mm"** is asserted twice: by the test's own judge on the vase's evaluated place, and
  by the audit's row. The check sets `tolerance: {sunk: 0.002, touch: 0.002, land: 0.002}`, #405's fields: a part
  sunk more than 2 mm overlaps, and a part further than 2 mm from everything is held by nothing. The base's audit was
  seen to judge this fixture so, with the vase written in place and no constraint: PASS at the rest height,
  `geometry.floating` with the ball 2.5 mm off the top, `geometry.overlap` with it 3.1 mm in.
- **The table may float.** The definition declares it, since nothing stands under it.
- **"Along the axis"**: x and z stay as written, within 1e-6 m. That number is this job's.
- **"Resolves at check with nothing per frame"** is read as #1732 read its like: the place is there in the revision
  shown, and the `frames` call's counters show no work after the first frame. Nothing in the document moves, so
  `ran` must be 0. At the base a static scene's frames have `ran` 0, and a scene with a constraint has `ran` 1. Six
  frames is this job's number.

### Criterion 3

- **The plate** is a flat `plate@1`, 10 × 10 m, centred on the origin. #2014's terrain plate isn't needed.
- **"At least 0.5 m apart"** is judged at 0.5 × (1 − 1e-6): an instancer's `pos` is a column of f32, and 1e-6 is the
  rtol of the pinned upstream test for this criterion. The issue gives no tolerance.
- **"Centered more than 0.5 m inside the plate"**: |x| < 4.5 and |z| < 4.5. A disc is empty when no point is nearer
  its centre than 1.0 m. The judge is exact to a micron.
- **"The left half"** is x < 0, since right is +X.
- **On the plate**: |x| and |z| at most 5 and y 0, within 1e-6 m. That number is this job's.
- **With density**, at least two points and the distance rule are asserted, so an empty scatter can't pass.
- **The planted sampler** places exactly 10 points: it "stops after 10 points", and the plate has room for hundreds.

## Not tested

No criterion asks for these, so none is tested:

- **distribute:** `mode: elimination`, `grid` and `random`; `prune: smaller_first` and `equal`, and which elements a
  mode keeps; `avoid`, collections among them; `project`, its axis and `align`; `scale` and `tilt` ranges, and a `yaw`
  range that turns; `max` (the oracle lane uses it); a density between 0 and 1; refusals of bad fields; the cost.
- **rest_on:** `on: collection` and `on: ground`; another `axis`; `align: normal`; `offset`; `contact: bounds`;
  `max_drop` and its `no_support` report; the refusal of an item a channel drives; a re-solve when either side moves;
  the cache by both content keys.
- **The audit over an instancer's elements**, which the design says checks a pruned scatter: the base's audit reads no
  element, and no criterion here asks the audit of a scatter.
- **Budgets and timings.** #2017 owns the task's.

## What the implementer adds outside this folder

- `distribute_stops_after_10_points` in `Planted` (`crates/deep-show/src/hub.rs`) and in `main.rs`'s planted match.
- The two `alone` lines in `scripts/lanes.mjs` above.
- Nothing else. The `geometry` row for an instancer, and `deep_query`'s place with constraints applied, are the
  surface above.
