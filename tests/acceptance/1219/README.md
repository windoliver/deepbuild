# Acceptance tests for #1219: timber halls in the building module, columns on a bay grid, bracket sets, and roofs with a folded profile and rising corners

These tests were written before any implementation existed. The writer had issue #1219 (its opening paragraph, its Scope,
its Fields, its seven acceptance criteria, its Proof line and its "Not in scope" line; it has no comments, no Oracle line
and no `Runs on:` line), the three design sections it links and the ones those lean on, and base commit `5fcfb690b`. No
implementation existed, and no other worktree, branch or pull request was read.

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job
(design: Dogfooding). The suite is lean: one test per criterion, plus the four planted wrong programs the criteria and
the Proof line name, each run through the check its shipped twin passes.

**Run at the base.** The suite was written without a binary, then probed and run once against the base's `deep-show`
(the full set) and `deep-gpu`. Every test fails there at an assertion of its own; none passes. `BASE-FAILURE.txt` holds
each file's run, and "At the base" below says what the probes showed. Also run: the type-check, every judge on its
planted sets as a plain node script, and the trace lane's own scan of the test names.

## What was read

- Issue #1219 as saved on 2026-11-22, and its body byte for byte, from which the seven criterion IDs were computed.
- `docs/canvas-primitives.md`: Building module (the timber-hall sentences, "Each declares `reads`", "Kind rules check
  …", "It can never"); Material: texture maps; Material (`pattern: … roof_tiles …`); Builder (`build(…) → {positions, …,
  parts, anchors, values, true_shape, bounds}`); Builder: uv; Look `look@1` (`time.state {span, interp = ease
  in_out_cubic}`); Pack: kind rules and the kind kit ("an instance whose expression is false gets the issue named by
  the rule's code, with the item, the time and the fix"; "a check's result reads failing until it runs"); What holds a
  document to its rules (an issue's shape); Check input (`kind_rules` and `geometry.audit` among the core's kinds);
  Geometry audit and Geometry audit: scenes (`scope`, `support: {floating}`, the overlap tolerance 0.002 m).
- `docs/technical-design.md`: Scenes, physics and the canvas core (Building kinds); Criteria to tests; Criteria in a
  checked shape; Wrong programs; Proven on the base; Dogfooding; Tests written first; the Decided row "The reference
  window" (1512 × 982 points at 2×).
- At the base, for call shapes only: `AGENTS.md`; `crates/deep-canvas-scene3d` (`building.rs`: the eight kinds, `keyed`,
  the roof's `rise`; `spec/building.rs`; `build.rs`: the operator `building.build`; `geom.rs`: what a mesh answers;
  `shapes.rs`; `lib.rs`: `PLANTED`); `crates/deep-show` (`main.rs`: the scenario's `claims` and `planted`, `deep_show`'s
  `include`; `geometry.rs`: the `geometry` row; `geometry_audit.rs`: `solids_at`; `verdict.rs`: `judge`, `judge_audit`;
  `hub.rs`: when a show is refused); `crates/deep-canvas` (`document/pack_kinds.rs` and `document/mod.rs`: a failed kind
  rule's issue; `registry/mod.rs`: `Rule`, `Raised`, `Report`; `geometry_audit.rs`: `audit`);
  `crates/deep-gpu-layer/src/view3d/parse.rs`; `scripts/proof-change.mjs` (`criterionId`, `spans`), `scripts/lanes.mjs`
  and `docs/parallel-proof.md` (a suite's own lane file).
- The earlier suites `420/` (the building module, `geometry`, `eval`), `387/` (`eval`'s `run`), `405/` (the geometry
  audit as a claim's requirement), `202/` (a kind rule's issue, the `kind_rules` requirement), `453/` (a row's
  `results`), `2014/` (the model for layout, judges and planted programs), `2017/` and `1215/` (the taste call and the
  reference window).

Code was read only to learn the surface. Every expected value comes from the issue and the design.

## At the base

Seen by driving the base's binaries (`BASE-FAILURE.txt` lists the probes):

- The building module registers eight kinds. An `arch.bay_frame@1` or `arch.bracket@1` item is a kind the build doesn't
  know: it is skipped with the notice `unknown_kind`, and `geometry` answers `ref_unresolved` for it. Every test here
  that shows one fails at "is presented".
- `arch.roof@1` reads `type`, `size`, `pitch`, `overhang` and `parapet`, builds straight slopes and answers one output,
  `rise`. A new type is an `out_of_range` error at `items/roof/params/type`; `frame`, `raise`, `profile`, `corner_rise`
  and `corner_reach` are each an `unknown_field` error; the show is refused. `view3d` refuses a roof with no `size`
  (`out_of_range`, `items/roof/params/size`), so the base draws none of the pictures.
- The fixtures are well formed apart from that. With the base's own kinds in the new ones' place: a building item with
  a `parent` is presented and stands where its parent's `at` puts it; one claim takes a `kind_rules` and a
  `geometry.audit` requirement; two `eval` calls at one time answer `ran` and `kept`; and `view3d` draws the pictures'
  set, with a material on each building item, at 3024 × 1964 px.
- A failed kind rule exists only for pack kinds (#202): an issue whose `code` is the rule's, with `ids` holding the
  instance and severity `warning`, which doesn't refuse the show. A `kind_rules` requirement is FAIL on one, PASS when
  its rules hold, and INCONCLUSIVE on a building document, where no rule runs. Its row lists no runs.
- The geometry audit reads marks, the ten builders and instancers. A building kind's item is passed over: a box sunk
  0.3 m into a crate is a `geometry.overlap` naming both, and the same box inside an `arch.wall@1` is a PASS.
- None of the four planted names is known; a scenario that names one is refused whole as `bad_input`.

These tests don't credit any of that to this issue.

## Run them

Every file builds `deep-show` with cargo, and `ac7-taste.test.ts` builds `deep-gpu` and draws on the GPU, so they run
one file at a time. `lane.json` says so; `scripts/lanes.mjs` reads it, and needs no edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1219 --no-file-parallelism --testTimeout=3600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1219/tsconfig.json   # type-check
rm -rf tests/acceptance/1219/node_modules/.vite
```

- **Build.** Each file first runs `cargo build --locked --bin deep-show --no-default-features --features full`
  (`ac7-taste.test.ts`: `cargo build --locked --bin deep-gpu`), with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0`
  unless they're already set and `/opt/homebrew/opt/rustup/bin` put first on `PATH`, copies the binary out of `target/`
  (honoring `CARGO_TARGET_DIR`), and fails each test whose build failed.
- **Isolation.** Every test writes into temporary folders and deletes them, except `ac7-taste.test.ts`, which, once
  all six pictures are drawn, writes them into `docs/evidence/1219/` and keeps them. Node built-ins and vitest only.
- **No decision.** A test that can't decide here fails with a message starting `INCONCLUSIVE:`. It never passes. Only
  criterion 7 can: off macOS, where `view3d` answers `unsupported_platform`, or with no taste call on this run's
  pictures. Criteria 1 to 6 read evaluated data on the CPU and need no GPU. No test is gated on power or load: the issue
  has no budget criterion.
- **The judges alone.** `judges.ts` imports nothing, so `judgeProblems()` runs as a plain node script (Node 24 reads
  `.ts`); every test also runs it first.

## The surface under test

No new binary and no new call. The suite drives `deep-show run` (#393: one scenario line in, one answer line out) with
the agent's `deep_show`, #420's `geometry`, #387's `eval` and #403's `claims` and `verdict`, and `deep-gpu run` (#377)
with #378's `view3d`. Everything those suites' READMEs define holds unchanged. Names the issue gives are kept exactly.
**Every name marked "mine" is this job's choice**, the least the criteria need, listed again under Readings; an
implementation builds exactly these, or disputes them.

### The documents

Every fixture is a `scene` document in the agent's form (no `id`, no `layers`), naming `requires.modules: {scene3d:
"^1", building: "^1"}`, shown by the working agent with `{"call": "deep_show", "session": "sess-alpha", "doc",
"document", "include": ["issues"]}`. Metres, +Y up.

| Kind | An item as the fixtures write it | Whose spelling |
|---|---|---|
| `arch.bay_frame@1` | `{"kind": "arch.bay_frame@1", "params": {"bays": [4.2, 4.2, 4.2, 4.6, 4.2, 4.2, 4.2], "depth_bays": [4, 4], "eave_height": 3.6, "column": {"diameter": 0.4}, "purlins_per_bay": 4, "omit": [[3, 0]]}}` | the issue's fields; `@1` mine, as the module's other kinds |
| `arch.bracket@1` | `{"kind": "arch.bracket@1", "parent": "frame", "params": {"on": "column", "frame": "frame", "steps": 2, "reach": 0.45, "height": 0.3}}` | the issue's fields; `@1` and `parent` mine |
| `arch.roof@1` | `{"kind": "arch.roof@1", "parent": "frame", "params": {"type": "hip_ridge", "frame": "frame", "raise": 0.3333333333333333, "profile": "folded", "corner_rise": 0.3, "corner_reach": 3, "overhang": 0.75}}` | the issue's fields; `overhang` the base's; `parent` mine |

- `omit` names a grid point as `[i, j]`: `i` counts the grid lines across from 0, `j` the lines front to back from 0,
  the front row being `j = 0`. The criterion's `[3, 0]` is the front row's fourth column, at x = 12.6 m.
- `column`'s `sides`, `taper` and `plinth` are left at their defaults; `omit` is absent where no column is omitted.
- **A hall** is a frame, the bracket sets that name it and the roof that names it. The brackets and the roof are the
  frame's children (`parent`) as well as naming it (`frame`), as an opening is its wall's child and names it. So the
  three build in one space, the frame's, and a hall stands where its frame's `at` puts it.
- One `arch.bracket@1` item stands its set on every column head of its frame (`on: column`) or between every two
  (`on: between`): the Fields give it no place of its own.
- A roof of the five new types takes no `size` and no `pitch`: it reads its frame. With no `eave_reach` and no bracket
  set, its eave purlin sits on the column heads over the outer column line.
- The frame's grid starts at x = 0 in the frame's own space (the criterion's "x = 0 … 29.8 m").

### What a build answers: the `geometry` rows

`{"call": "geometry", "doc", "items": [ID]}` answers a row per item, as for every building kind at the base:
`positions`, `indices`, `anchors`, `outputs` and the rest. The tests read each row in the item's own space, which for
every fixture whose numbers are read is the world's (its frame has no `at`).

| Row | Field | Shape | Example | Whose |
|---|---|---|---|---|
| a frame | `anchors["column.<i>.<j>"].pos` | one anchor per standing column, at the center of its head: `[x, y, z]`, y the head's height | `"column.4.0": {"pos": [17.2, 3.6, 0], …}` | mine |
| a bracket set | `outputs.total_reach`, `outputs.total_height` | m | `0.9`, `0.6` | the issue's |
| a bracket set | `positions` | the set's mesh; its top is its highest point | | the base's |
| a roof | `outputs.ridge_height` | the ridge's height, m, in the frame's space | `6.2667` | mine |
| a roof | `outputs.purlins` | one side's purlins from the eave purlin up, the ridge left out: `[{"in": m, "height": m}]`; `in` is the plan distance in from the eave purlin toward the ridge (the eave purlin's is 0), `height` is in the frame's space | `[{"in": 0, "height": 3.6}, {"in": 1, "height": 4.0444}, …]` | mine |
| a roof | `outputs.eave_line` | the points around the roof's eave edge, `[[x, y, z], …]` in the frame's space, in order; for a hipped roof one loop of four eaves | `[[-0.75, 4.1, -0.75], …]` | mine |

- An omitted column has no anchor. A frame's mesh spans its columns' centers in plan and reaches their heads.
- A purlin's `height` is where it bears: the eave purlin's is the height of the bracket set's top that carries it, or
  of the column heads with no bracket set. The tests take every purlin's and the ridge's height above the eave
  purlin's, so any one reference inside the purlins gives the same numbers.
- Over each corner's reach an eave holds a point at each of the 50 samples (below) and at the corner. It may hold
  more. The tests read a height between two points along the straight line between them.
- **The 50 samples** of a corner's reach along one eave: sample `k` (0 to 49) lies `corner_reach × (49 − k) ÷ 49` from
  the corner, so sample 0 is where the rise starts and sample 49 is the corner.

### The kind rules

The Scope's five kind rules, by code (all mine), each on the items of one kind:

| Code | The rule (Scope) | Runs on | Its issue's `actual` holds |
|---|---|---|---|
| `arch.column_on_grid` | columns sit on their grid points within 1e-6 m | a frame | `column: [i, j]`, the first column off its point in grid order (front row first), and `at: [x, y]`, that grid point in plan m: `{"column": [4, 0], "at": [17.2, 0], …}` |
| `arch.bracket_meets` | a bracket set's top meets the beam or purlin it carries within 1 mm | a bracket set | nothing the tests read |
| `arch.purlin_folding` | each purlin's height equals the folding rule's closed form within 1e-6 m | a roof | `in`, the first purlin off the rule from the ridge down, and `difference`, its height less the rule's, m: `{"in": 3, "difference": 0.2667, …}` |
| `arch.eave_monotonic` | the eave line's rise is monotonic toward each corner | a roof | `sample`, the first of a reach's 50 samples that is lower than the one before it: `{"sample": 40, …}` |
| `arch.rafter_clear` | no rafter passes through a purlin | a roof | nothing the tests read |

- **A failed rule's issue** has the rule's code as its `code` and the item in `ids`, as a pack kind's failed rule has at
  the base (#202): `{"code": "arch.column_on_grid", "ids": ["frame"], "actual": {…}, …}`. The tests read `code`, `ids`
  and `actual`, never the severity or the words.
- **A failed rule never refuses a show**, as at the base: the revision is presented, so what it built can be read with
  `geometry`.
- **The runs.** A claim's requirement `{"kind": "kind_rules"}` (#202's check input) runs every kind rule on the claim's
  deliverables. Its row on the verdict is FAIL when a rule fails and PASS when rules ran and all hold, and it gains
  **`results`** (mine, the field #453 gave a row): one entry per rule run on an item,
  `{"doc": doc ID, "item": item ID, "rule": code, "holds": bool}`, on PASS and FAIL alike. The failed rule's issue is
  among the row's `issues`.

### The geometry audit

A claim's requirement `{"kind": "geometry.audit", "scope": "scene", "states": ["rest"], "support": {"floating":
["frame"]}}` (#405's check input) audits a hall at rest: the frame, which stands on the ground, is declared floating by
the definition, and nothing else is. The row is PASS with nothing raised. The three kinds enter the audit with their
true shapes. A fault names its parts in `ids` by item ID, or by `<item>#<part>`, which the tests read as the item.

### What rebuilds: `eval`

`{"call": "eval", "doc", "t": "0s"}` answers every node with its `operator`, `item`, `key` and `run: ran | hit | kept`.
Items of the three kinds have a node of the base's operator `building.build`, as the module's other kinds do.

### The pictures: `view3d`

`{"call": "view3d", "doc": path, "look", "size": [3024, 1964], "fps": 30, "from": 0, "frames": 1, "capture": "every",
"targets": ["final"]}` draws a session-form scene holding the three kinds; the frame's `final` names the PNG it wrote.

### The planted programs (the scenario's `planted`, reachable only there)

All four names are mine. The implementer adds them to the building module's planted programs (`PLANTED` in
`crates/deep-canvas-scene3d/src/lib.rs`); an unknown name is `bad_input` at the base. Each changes what a builder
builds and answers, and nothing else: the kind rules and everything they read stay as shipped, so the rule fails.

| Name | The wrong program | Criterion |
|---|---|---|
| `bay_frame_even_columns` | A bay frame spaces its columns evenly across: every bay as wide as the first of `bays`. Column `[i, j]` stands, and its anchor is, at x = i × `bays[0]`. | `#1219.2fd5962d` |
| `roof_straight_as_folded` | A roof with `profile: folded` builds and answers the straight profile: each purlin on the straight line between the eave purlin and the ridge. | `#1219.cd3d7125` |
| `eave_rise_falls_back` | Over each corner's reach the eave line rises as shipped for the first four fifths of the reach, then falls back in a straight line to its level height at the corner. | `#1219.ccd3f457` |
| `bracket_misses_purlin` | A bracket set stacks one step fewer than `steps`, and answers `total_reach` and `total_height` as shipped: its top is one step's `height` under the purlin it carries. | `#1219.a68fcbf4` (the Proof line's) |

`twins.json` maps each criterion's ID to its name.

## The fixtures

All generated in `judges.ts`; the numbers are the criteria's own where a criterion gives one.

| Fixture | What it is | Read by |
|---|---|---|
| The seven-bay frame | `frame`: bays 4.2, 4.2, 4.2, 4.6, 4.2, 4.2, 4.2 m, depth bays 4 and 4 m, so 29.8 m wide and 8 m deep, with eight grid lines across and three front to back; eave_height 3.6 m, columns 0.4 m across, purlins_per_bay 4 | AC1, and every other fixture's frame |
| The frame with `omit` | the same, with `omit: [[3, 0]]` | AC1 |
| The folded roof | the frame and `roof`, a `hip_ridge` roof on it: raise 1/3, profile folded, corner_rise 0.3 m, corner_reach 3 m, overhang 0.75 m, no eave_reach; no bracket set. Four purlins a side at 0, 1, 2 and 3 m in, the ridge 4 m in. Its eaves are 31.3 m and 9.5 m long | AC2, AC3 |
| The bracket set and its roof | the frame; `brackets`, `on: column`, two steps of 0.45 m reach and 0.3 m height; and the same roof | AC4 |
| The four other types | the whole hall: the frame, `brackets` (`on: column`), `between` (`on: between`), and the same roof with `type` hip_gable, overhang_gable, flush_gable or pyramid; and its twin with `probe`, a 0.6 m `mark.box@1` centred over the middle of the frame at the roof's own `ridge_height` | AC5 |
| Two halls | two whole hip_ridge halls in one document, `a-…` and `b-…`, hall b's frame at `at.pos` (0, 0, 20); the change sets `items/a-frame/params/bays/3` from 4.6 to 5 | AC6 |
| The pictures | the whole hall under each of the five types, with a ground plate, a day sky, a shadowed sun, a timber material on the frame and brackets and a `roof_tiles` material on the roof; and two hip_ridge halls, folded and straight, the straight one 14 m behind, seen from the end | AC7 |

## Criteria to tests

IDs are `#1219.` and the first 8 hex digits of the SHA-256 of each criterion's text, as `scripts/proof-change.mjs`
computes them. Each file holds its criterion's tag as a string `const ID`, and every `describe` and test name starts
with it, `AC<n> #1219.<id>`. Each file's header states its fixture, what it asserts and its wrong programs in full.

| ID | File (tests) | What it asserts | What fails it |
|---|---|---|---|
| AC1 `#1219.2fd5962d` | `ac1-bay-frame.test.ts` (2) | 24 column anchors, the front row's at the eight printed x within 1e-6 m, every one on its grid point; the mesh stands there; `arch.column_on_grid` ran on the frame and holds; with omit the same 23 and not `[3, 0]`. Planted: the judge's first failure is column `[4, 0]` at x 17.2 m, and the rule fails on the frame, its issue naming that column | the base (unknown kind); `bay_frame_even_columns` |
| AC2 `#1219.cd3d7125` | `ac2-folded-profile.test.ts` (2) | four purlins a side; above the eave purlin the ridge is 2.6667 m up and the purlins 1, 2, 3 m in are at the rule's closed form, within 1e-4 m; `arch.purlin_folding` ran on the roof and holds. Planted: the judge's first failure is the purlin 3 m in, 0.2667 m off, and the rule fails on the roof, its issue naming `in: 3` and that difference | the base; `roof_straight_as_folded` |
| AC3 `#1219.ccd3f457` | `ac3-rising-corner.test.ts` (2) | toward each of the eight corner ends the eave line is level beyond 3 m and 0.30 m up at the corner, within 1e-4 m, and never falls between the 50 samples; `arch.eave_monotonic` ran on the roof and holds. Planted: the judge names one first falling sample toward every corner, in the last fifth, and the rule fails on the roof, its issue naming that sample | the base; `eave_rise_falls_back` |
| AC4 `#1219.a68fcbf4` | `ac4-bracket-set.test.ts` (2) | total_reach 0.90 m, total_height 0.60 m; the eave purlin 0.60 m above the front row's column heads; the set's top meets it; the eave line 1.65 m outside the columns' centers on four sides; all within 1 mm; `arch.bracket_meets` ran on the set and holds. Planted: the set's top is 0.30 m under the purlin, and the rule fails on the set | the base; `bracket_misses_purlin` |
| AC5 `#1219.643d7509` | `ac5-roof-types.test.ts` (1) | for each of the four types: presented; frame, both sets and roof build; the `kind_rules` row is PASS with all five rules run where they apply and holding; the audit's row is PASS with nothing raised; and the hall with the probe FAILs with a `geometry.overlap` naming the roof and the probe | the base (the types are unknown, and its audit reads no building kind) |
| AC6 `#1219.5569643b` | `ac6-rebuild.test.ts` (1) | before the change all eight items have a `building.build` node; after it hall a's four ran under new keys and no other build node ran; hall b's four keep their keys and no node of theirs ran | the base |
| AC7 `#1219.9c284fc3` | `ac7-taste.test.ts` (1) | draws the six pictures, then writes them and prints their SHA-256s; reads `TASTE.json` (The taste call) | the base (`view3d` refuses its roof, so no picture is taken); after that, INCONCLUSIVE until the call is recorded |

## The judges, and the sets they must fail

The tests compute these themselves (`judges.ts`). Each test first runs every judge on its planted sets
(`judgesFailTheirPlants`), so a judge that passes everything can't pass a file. All were run here as a plain node
script, and pass.

| Judge | Passes | Must fail |
|---|---|---|
| the closed forms | the bays' sums are the printed front row; 8 × 3 = 24; the rule's heights are the printed 2.6667, 0.4444, 1.0222, 1.7333 m and equal the rule taken step by step; a straight purlin 3 m in is 0.2667 m over; two steps give 0.90 and 0.60 m | (they are the reference the others are held to) |
| columns on the grid | the grid, its rows back along +z or −z, and the grid less `[3, 0]` | every bay as wide as the first: 12 failures, `[4, 0]` at 17.2 m first; columns by the mean bay: 18, 17.2 m among them; one column 2e-6 m off; a back row 0.1 m short; the omitted column standing; a second column dropped; nothing built |
| the profile | the folded roof, wherever its eave purlin sits | the straight roof: the purlin 3 m in first, 0.2667 m off; every purlin lowered by the same tenth; a ridge 2e-4 m low; three purlins a side; no eave purlin; nothing answered |
| the eave line | a straight rise, the cubic ease in and out and a square ease in, toward eight corners | the rise that falls back in its last fifth: sample 40 toward every corner, under each of the three eases; a level line; 0.3002 m at the corner; a rise that starts 4 m out; a four-point eave ramping over 6 m; a missing corner; an eave of two corners alone; no line |
| the bracket set | the set that meets its purlin | built one step short (0.30 m under); a top 2 mm over; the eave purlin left on the column head; one step's totals; no column head |
| the eave's reach | 1.65 m on four sides | the brackets' reach alone, the overhang alone, one step's reach and the overhang, 2 mm more; no line |
| a `kind_rules` row | rules that ran and hold | a pass with no `results`; a pass on which nothing ran; a rule run on another item; a row that isn't PASS; the base's blocked row; no row; a run that doesn't hold |
| a failed rule | FAIL, the run not holding, the issue naming the item; `[4, 0]` at 17.2; `in` 3 with ±0.2667; a sample 0 to 49 | a row whose rule holds; another item or rule; the column at 4.2 m; another purlin or difference; sample 50 or 40.5 |
| a `geometry.audit` row | a clean pass; an overlap naming the roof's part and the probe | a blocked row; a rafter through a purlin; a pass raising a floating roof; an audit that doesn't see the roof; an overlap with another item |
| the rebuild | hall a's four rebuilt under new keys, hall b kept | nothing rebuilt; a roof that didn't rebuild; brackets rerun under their old key; hall b's roof rebuilt, its frame's key moved, its brackets reshaded; another item rebuilt; nothing built |
| the taste call | `looks_right` on exactly this run's pictures | no call and a call on other pictures (inconclusive); `looks_wrong`; another criterion's or issue's call; no name; no time; another verdict; a picture left out or added; not an object |

## Readings where the issue and design leave a choice

### The surface

- **Outputs are read from the `geometry` rows**, as #420 reads a stair's `risers` and `well`. The issue's Fields name
  the bracket's two outputs; "each purlin's height, the ridge height, the eave line" are named `purlins`,
  `ridge_height` and `eave_line`.
- **Columns are anchors.** The Fields name no output for a frame. A build answers named frames (Builder: `anchors`), a
  wall's two ends are anchors at the base, and a column's head is where a bracket set sits, so each column is the anchor
  `column.<i>.<j>` at the center of its head. One name gives the criterion's count, its centers, the omitted column and
  criterion 4's column head.
- **Heights are in the frame's space.** `ridge_height` and each purlin's `height` are absolute there, and the tests take
  them above the eave purlin's. The criterion's printed numbers are those differences. One convention then serves
  criterion 2 (heights above the eave purlin) and criterion 4 (the eave purlin above the column head).
- **"In from the eave"** is the plan distance in from the eave purlin. Criterion 2's numbers (purlins 1, 2 and 3 m in,
  the ridge raise × depth up over an 8 m depth) hold only with the eave purlin over the outer column line and the ridge
  4 m in, so criteria 2 and 3 use a roof with no bracket set.
- **The folding rule.** "A tenth of the raise" is a tenth of the ridge's height above the eave purlin, raise × depth:
  the criterion's 0.2667 m is a tenth of 2.6667 m. "The bay frame's purlin spacing" is a depth bay over
  `purlins_per_bay`. `judges.ts` (`foldedProfile`) shows the derivation and its closed form.
- **The eave line** is a line of points in space, since criterion 3 samples it and criterion 4 measures how far it
  projects. A hipped roof's is a rectangle in plan; the tests read each of its four eaves toward both its corner ends.
  "From a corner" is the distance along the eave from the eave line's own corner. Its level height is the eave's
  middle. "Level more than 3 m from a corner" is read at every point of the eave in that stretch and at 50 heights
  across it.
- **"Past the column line"** is measured in plan from the outermost columns' centers to the eave line, on each of the
  four sides.
- **"The rafter overhang"** is `arch.roof`'s `overhang`, the base's field. The fixtures write 0.75 m, so the brackets'
  reach alone (0.90 m), the overhang alone and one step's reach all miss 1.65 m.
- **The column head and the bracket set's top.** The head is the column anchor's height; the set's top is the highest
  point of its mesh. "The eave purlin it carries sits 0.60 m above the column head" is the roof's purlin 0 m in less the
  front row's heads; the kind rule's "its top meets … the purlin it carries within 1 mm" is the set's top against that
  purlin.
- **Tolerances.** 1e-6 m for columns and 1e-4 m for criteria 2 and 3 are the criteria's. Criterion 4 gives 1 mm for the
  purlin; the suite holds its totals and its eave's reach to the same 1 mm.
- **Kind rules follow the base's pack kind rules** (#202): the issue carries the rule's code and the item, a failed rule
  doesn't refuse the show, and `kind_rules` as a claim's requirement is PASS or FAIL. The design's Building module calls
  them kind rules, and Pack: kind rules is the one written form. A second way to read a rule's failure would need a
  reason; this suite has none.
- **The rule runs** are the row's `results`. "Pass every kind rule" proves nothing unless the rules ran on that roof,
  and the base's row says only whether any rule ran. `results` is the field a row already has for what a check read
  (#453).
- **What a failed rule names.** The criteria say what each failure names; the issue's `actual` holds it as data
  (`column` and `at`; `in` and `difference`; `sample`). A rule names the first element that fails, in its own order:
  grid order for columns, from the ridge down for purlins, toward the corner for samples. That is the order in which the
  criteria's planted programs first fail at the element each criterion names.
- **The planted even spacing** is every bay as wide as the first. The first column it puts off its grid point is then
  the column at 17.2 m, the one the criterion names; spaced by the mean bay, the first would be the column at 4.2 m.
- **The planted rise** keeps the shipped rise for four fifths of the reach, then returns straight to level. Sample 39 is
  inside the first four fifths and sample 40 past it, so the first falling sample is 40 for any ease whose rise at
  39/49 of the reach is over 0.92 of its rise at four fifths. The test asks only for one sample toward every corner, in
  the last fifth, and that the rule's issue names the same one.
- **The planted bracket** builds short and answers its totals as shipped, so only a check of the built set catches it.
- **"The look's ease"** is the look's `time.state.interp`, the cubic ease in and out by default. Criterion 3's three
  values hold for any ease that is 0 at 0, 1 at 1 and monotone, and the tests ask for nothing between.

### Fixtures

- **`eave_height` 3.6 m and columns 0.4 m across**: no criterion gives either.
- **"The same frame"** (criterion 5) is the seven-bay frame of the other criteria, and each of the four roofs carries
  the same fields as the `hip_ridge` roof: folded, raise 1/3, rising corners, on a whole hall with both bracket sets.
  Every one of the five rules then has something to hold on each type.
- **"At rest"** is the audit's `states: ["rest"]` in scope `scene`, at the design's default tolerances.
- **The frame floats.** A scene's item rests on something unless declared floating; a hall's frame stands on the
  ground, which is no item, so the definition's check declares it floating, as #405's declares its base plate. The
  bracket sets and the roof are declared nothing: they must be held by what they stand on.
- **"No rafter through a purlin and no tile through a ridge"** is read as what the two checks find: `arch.rafter_clear`
  ran on the roof and holds, and the audit's overlap pass raises nothing. The suite intersects no mesh itself.
- **The probe** shows the audit reads the roof: at the base an audit of a hall passes having read none of it. The box
  sits where the roof's own `ridge_height` puts its ridge, over the middle of the columns, where each of the four types
  has its ridge or its peak.
- **"A second hall beside it"** is a second whole hall in the same document, its frame placed 20 m behind the first.
  "Rebuilds" is a `building.build` node that ran; "by content key" is that node's `key`. "Rebuilds nothing" is read
  as #420 reads an untouched item: none of hall b's nodes ran, of any operator.
- **"Its brackets"** are the bracket items that name the frame: one on its column heads and one between its columns.
- **"From the app at the reference window"** is `view3d`, the app's frame path for a 3D scene, drawing the frame's
  `final` target at 3024 × 1964 px, the window's 1512 × 982 points at 2×.
- **"With each roof type"** is the five new types, `hip_ridge` among them, one picture each.

## Not tested

No criterion asks for these, so none is tested:

- **The frame:** its beams along the grid lines; `sides: 8`, `taper` and `plinth`; the bounds `bays ≤ 15`, `depth_bays
  ≤ 8`, `purlins_per_bay ≤ 4`, `taper 0..0.1`; a refusal past any of them.
- **The bracket set:** its blocks and arms; `steps` 1, 3 and 4 and the bound `1..4`; how far a set's mesh reaches out;
  where an `on: between` set stands; a bracket set carrying a beam.
- **The roof:** `profile: straight` outside the picture; `eave_reach` when given; `corner_reach` with no `corner_rise`;
  which ease the rise follows, and its shape between the start and the corner; the eave line of a gabled roof; the
  place of any purlin with a bracket set under the eave; rafters, tiles and the ridge as parts; `roof_tiles` along a
  slope's true profile (the pictures show it, and no test reads them).
- **Kind rules:** the rules' own bounds (1e-6 m, 1 mm) at their edges; `arch.rafter_clear` and the audit failing on a
  rafter through a purlin or a tile through a ridge, for which the issue names no wrong program; a rule's `fix`, `path`
  and severity.
- **Reads:** that each new kind declares `reads` (Scope: "they declare what they read"); #420's sweep of every schema
  path covers a kind once it has a spec. Criterion 6 holds what follows from the reads.
- **"It can never":** "take a curve from a drawn path" and "be extended by a plug-in".
- **Not in scope**, as the issue says: carved ornament, ridge beasts, painted beam patterns, multi-storey towers, double
  eaves, masonry vaults.
- **Budgets and timings:** the issue has none.

## The taste call

`ac7-taste.test.ts` draws six pictures at the reference window and writes each PNG, as the renderer wrote it, to
`docs/evidence/1219/`: `hall-hip-ridge.png`, `hall-hip-gable.png`, `hall-overhang-gable.png`, `hall-flush-gable.png`,
`hall-pyramid.png` and `folded-beside-straight.png`. It prints each SHA-256, then reads the call in
`tests/acceptance/1219/TASTE.json`, which this job doesn't create and only the owner's answer fills:

```json
{ "issue": 1219, "criterion": "#1219.9c284fc3", "verdict": "looks_right", "who": "…", "when": "2026-11-23T09:00:00Z",
  "screenshots": { "hall-hip-ridge.png": "<sha256>", "hall-hip-gable.png": "<sha256>", "hall-overhang-gable.png": "<sha256>",
                   "hall-flush-gable.png": "<sha256>", "hall-pyramid.png": "<sha256>", "folded-beside-straight.png": "<sha256>" },
  "note": "…" }
```

No call, or a call whose SHA-256s differ from the run's, fails `INCONCLUSIVE:`, never passing. `looks_wrong` fails,
quoting it. `looks_right` on exactly these pictures passes. Attaching the pictures to the PR and showing them in the
session is the implementer's step. No other test reads a picture, and this one reads no pixel.

## What the implementer adds outside this folder

- In the building module: the kinds `arch.bay_frame@1` and `arch.bracket@1`, the five roof types and the roof's new
  fields, the column anchors and the outputs above, the five kind rules with their issues, and the four planted names.
- In `deep-show`: the building module's rules among `kind_rules`' runs, with `results` on the requirement's row; and the
  three kinds' true shapes in the geometry audit.
- In `deep-gpu`: nothing but what draws the three kinds in `view3d`.
- After the owner's taste call: `TASTE.json`, and the pictures attached to the PR.
- Nothing in `scripts/lanes.mjs`: `lane.json` runs the folder alone.
