# Acceptance tests for #224: surfaces and space curves from a formula, refined by interval bounds, colored by value or checkered

Written first, blind, from issue #224 (its Scope, its Fields, its 11 acceptance criteria, its Proof line "A fixture
film of egg crate, saddle and bell morphing into each other and of the helicoid rolling into the catenoid, a gridded
saddle, a gyroid and two blobs merging, with seek-equals-play hashes and frame timings", its Oracle line and Depends
on), its oracle page, the design and base commit `c56fe5407` ("Merge pull request #2462 …"). No implementation of
`surface` existed, and no other worktree, branch or pull request was read. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

Lean: one file per criterion (criterion 2 has two, its timing in a timed file of its own), at most three tests a file,
and the five planted wrong programs the criteria name. Criterion 3 also has `../224-oracle/` (its README), the upstream
tests re-expressed against our output.

## What was read

- The issue, live (`gh issue view 224 --repo windoliver/deepbuild`), and its oracle page
  (`doneright/oracles/issues/224.md` on branch `doneright` of DeepBuildAI/deepbuild) with the two upstream test excerpts
  it pins for criterion 3, from the vendor copy beside it.
- `docs/canvas-primitives.md`: Builder (the ten trusted builders, `surface`'s fields, the 262,144-vertex cap, "Pure and
  deterministic … an over-budget build is refused before it runs"); Builder `surface`: surfaces from a formula,
  implicit surfaces and grid lines; Builder: shading and uv; Curve `curve@1`; Path `path@1`: function (the 2D
  precedent: `vars: {name → path | control | channel}`, interval sampling, an implicit `zero` on a quadtree); The
  closed function list; Marks in 3D, lines, mesh edges, and axes `axes3d@1`; Control, Control: kinds as a registry,
  Input track, Tour; Frame budget and the budget classes' table (a time-bound re-mesh against the class's frame CPU).
- `docs/technical-design.md`: Dogfooding, the parity suite (goldens, oracles, "Every comparison between two outputs has
  a planted-mismatch twin"), Built to be hard to get wrong. AGENTS.md.
- At the base, for surfaces and conventions only: `crates/deep-show` (`main.rs`'s calls and the scenario's `planted`,
  `threads`, `at`; `geometry.rs`, its `at`, `stage` and rows; `played.rs`, the played form's inline `track`;
  `frames.rs`'s `eval` with `track`; `hub.rs`'s document look); `crates/deep-canvas-scene3d` (`builders.rs`'s kinds,
  `Plants` and `two_sided` plate; `geom.rs`'s `Mesh::to_json`, `values` and `attributes`; `curve.rs`; `lib.rs`'s
  `PLANTED`); `crates/deep-canvas/src/document/mod.rs` (`Issue::to_json`, an issue's fields spread from `actual` as
  #537's are); `crates/deep-canvas-motion/src/doc.rs` (`track`); `crates/deep-canvas-marks/src/functions.rs` (a var's
  path, `controls/<id>/value` and `data/<name>`); `crates/deep-gpu-layer/src/view3d.rs` (request fields, `world`,
  `capture`, `targets`); `scripts/benchmark.mjs` (`judgeLimit`, `validateBudgets`, `judgeTargets`, `fingerprint`),
  `scripts/lanes.mjs`, `scripts/proof-change.mjs` (`criterionId`), `scripts/proof-runs.mjs` (`twins.json`); and as
  style models the suites `226/`, `226-oracle/`, `441/`, `505/`, `524/` and `407/`'s look in the evidence store.

Code was read only to learn the surface. Every expected value is the issue's, the design's, or a closed form computed
in the tests.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  scripts/lease npx vitest run --root tests/acceptance/224 --no-file-parallelism --testTimeout=3600000 <file>
npx tsc -p tests/acceptance/224/tsconfig.json
rm -rf tests/acceptance/224/node_modules/.vite
```

The implementer adds these lines to `scripts/lanes.mjs`; this README is the instruction, and this job edits nothing
outside its folders:

```js
// #224's files build deep-show (and ac11 deep-gpu, drawing on the Metal GPU); the oracle lane builds deep-show;
// ac02-rebuild-budget judges the task's budget on the reference Mac.
alone.push('tests/acceptance/224/', 'tests/acceptance/224-oracle/');
timed.push('tests/acceptance/224/ac02-rebuild-budget.test.ts');
```

- **Builds.** A file builds what it first needs, once, debug, with `cargo build --locked`: `-p deep-show --bin
  deep-show` (its default features, the full build set) and, for `ac11-taste.test.ts` only, `--bin deep-gpu`; each is
  copied out of the target folder (honoring `CARGO_TARGET_DIR`) and deleted after the file. Homebrew's rustup goes first
  on `PATH` when present; `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0` unless set. No cargo is a failure starting
  `BLOCKED:`, never a pass. `ac02-rebuild-budget.test.ts` builds nothing before its record is checked.
- **Platform.** Only `ac11-taste.test.ts` draws on the GPU: off macOS it fails `INCONCLUSIVE:`, never passing. The
  budget test is `INCONCLUSIVE:` anywhere `judgeLimit` doesn't pass a reference Mac at rest, decided before anything is
  timed. Nothing else depends on the machine.
- **Isolation.** Each `deep-show run` gets its own temporary evidence store, deleted after it. `ac11-taste.test.ts`
  writes into `docs/evidence/224/` and keeps what it writes. Node built-ins and vitest only; `../226/helpers.ts` (the 3D
  axes, sky, sun, material and look shape) and `../252/helpers.ts` (`apng`, `sha256`) are imported read only.

## The surface under test

The issue and the design name the fields, the issue codes and the behaviours, but no call. **Every call, request
field, reply field, scenario value, task and planted name below that the issue or the design doesn't give is this
job's choice**, the smallest the criteria need beside the base's own calls: `deep-show run` (#393) with `deep_show`
and #420's `geometry` (#441's `at`, `stage`), `deep-gpu run` (#377) with `view3d` (#378), and §12a's budget record. The
implementer builds exactly these, or a dispute goes to a blind redraft.

### Documents

- **`surface@1`**, a builder kind beside `plate@1` and the rest, with the design's params by their names: `fn: {x, y, z}`
  (expressions over u and v, as strings in the closed function list's grammar), `u`, `v`, `vars`, `tolerance`, `max`,
  `closed`, `two_sided`, `color: {by, ramp, domain}` or `checker: {roles, cells}`, `grid_lines: {u, v, stroke}`; or, for
  an implicit surface, `zero` (an expression over x, y and z), `box`, `max_cells`, `tolerance`, `vars`, `two_sided`,
  `color`. Items carry `material`, `parent`, `modifiers` and `at` as any item does.
- **`curve@1`** takes `fn: {x, y, z, over, vars, tolerance}` in place of `points`, its other fields (`mode`) as #441's.
- **A var's source** is spelled as 2D path@1's fn spells it (`crates/deep-canvas-marks/src/functions.rs`): a control's
  value `controls/<id>/value`, a keyed value `data/<name>` (a channel targets `data/<name>`, as #505's suite does).
- Documents reach `deep-show` as an agent sends them (`deep_show`: no `id`, no `layers`), `requires: {modules:
  {scene3d: "^1"}}`, `budget: {class: "figure"}` unless a test says otherwise; `view3d` takes the session form (an
  `id`, one writer layer `main`).

### `deep-show run`

- The scenario's **`planted`** names one of this suite's five wrong programs (The planted programs), each reachable
  only there; it lives in scene3d's `PLANTED` beside #420's and #441's, so it reaches the builder as theirs do.
- The scenario's **`threads`** (1 to 64, the base's) also sets how many threads the implicit mesher runs on.
- **`deep_show`** with `include: ["issues"]` answers the check's issues, `surface.nonfinite` and `surface.coarse`
  among them (the check samples and meshes the surface). Each carries its fields, `item`, `u`, `v` (each `[lo, hi]`)
  and `size` (m), on the issue or in its `actual` (as #537's issues spread theirs; the tests read either). A refusal is
  `outcome: "refused"` with an error issue whose `path` is the field it names: `items/<id>/params/max` for a grid past
  the cap, `items/<id>/params/grid_lines` for grid lines on an implicit surface (codes aren't pinned).

### `geometry` gains `track` and `play`

```json
{"call": "geometry", "doc", "items": [ID], "t": time | flicks, "stage"?: "built", "track"?: [entry], "play"?: {"fps": n}}
```

- **`track`**: the document's input track for this call, inlined into its played form as `eval`'s `track` is
  (`{t: flicks, seq, control, value, writer: "you", player: 1}`, #504's entries). The rows read controls from it.
- **Without `play`**, the rows are #420's: a clean evaluation at `t`, which is what a seek to `t` gives.
- **`play: {fps}`**: the session plays every frame from 0 to `t` in order at `fps` (`t` a whole frame), each through
  its own frame path as `frames` plays it, never a clean evaluation, and the rows read each item's build as the played
  frame at `t` holds it. A build that keeps an earlier frame's mesh shows it here.

### Rows

A `surface@1` row is #420's builder row (`positions`, `normals`, `indices`, `uv0`, `values`, `attributes`, …, every
number as f64 JSON), with:

- **`attributes.color`**: `{"domain": "point" | "face", "type": "oklab", "values": [[L, a, b]]}`, one OKLab color per
  vertex (`point`) or per triangle (`face`), unrounded (as #167's rows answer `oklab`), for `color` and for `checker`.
- **`grid_lines`**: `[{"u": value, "edges": [[i, j]]} | {"v": value, "edges": [[i, j]]}]`, one entry per line drawn, its
  value and each mesh edge it runs along as two indices into the row's `positions`.
- For an implicit surface, **`values.cell`** (the edge of the mesh's cells, m) and **`values.cells`** (how many cells
  its last level kept, the count `max_cells` caps).

A `curve@1` row with `fn` is #441's curve row with **`points`**: `[[x, y, z]]`, the points the formula built, in order.

### `view3d`

Draws `surface@1` items and a document's inline `track` (the played form, as #504's hub inlines it), with the call's
`look`.

### The vertex hash

SHA-256 of: the vertex count (u32 little-endian), each position's x, y and z as IEEE 754 f64 little-endian in vertex
order, the index count (u32), and each index (u32), all as a `geometry` row answers them. Seek and play, and 1 and 8
threads, are compared by this one function of the returned arrays (`helpers.ts`'s `vertexHash`).

### The look

`look-224@1`: the shipped clean look (`crates/deep-canvas-marks/looks/clean.json`) with roles added, each a palette
entry of its own: `a` #1f5fbf, `b` #2f9e44, `c` #d9480f (criterion 3) and the oracle lane's `blue` #58c4dd, `green`
#83c167, `yellow` #ffff00, `orange` #ff862f, `red` #fc6255. A document names it (`look: {asset: "look-224@1", theme:
"light"}` with `assets["look-224"]`, as #407's suite does) and its bytes go into the run's evidence store. Expected
colors are each role's sRGB converted to OKLab by its published formula, never read from the program. The taste call
draws in #226's physical look, filmic, with the same roles (`LOOK_3D`).

### The budget

`benchmarks/budgets.json` gains `{"id": "canvas-surface", "command": ["node", "benchmarks/canvas.mjs", "surface"],
"margin": 0.5, "limits": {}, "targets": {"rebuild_128_ms": 2}, "initialReason": "<why, naming #224>", "criteria":
["#224.e2f417bd"]}`, which the lane's `validateBudgets` accepts against the merge base's file. `canvas.mjs surface`
times, in a release build on five runs after a warm-up, the rebuild of `ac02-family.test.ts`'s family (128 × 128, θ
moved by one slider entry), and `canvas.mjs judge` holds `rebuild_128_ms` to 2 by `judgeLimit`, as the other canvas
tasks are judged.

## Fixtures

All in `helpers.ts` and the test files; no file on disk. Metres; the formula's own coordinates are the item's.

- **The unit sphere** (`UNIT_SPHERE`, criteria 1, 4 and 11): the criterion's formula over u ∈ [0, 2π], v ∈ [0, π],
  tolerance 0.001 m, `two_sided: false`.
- **The family** (criterion 2): x = cos θ sinh v sin u + sin θ cosh v cos u, y = −cos θ sinh v cos u + sin θ cosh v
  sin u, z = u cos θ + v sin θ: θ = 0 is the helicoid, θ = π/2 the catenoid, and every θ has the metric
  cosh² v (du² + dv²), so it bends without stretching. u ∈ [−π/2, π/2], v ∈ [−1, 1], `max: [128, 128]`, tolerance 1e-5 m
  (the build reaches its 128 × 128 grid), `grid_lines: {u: 2, v: 2}` (the lines u = 0 and v = 0, the two marked
  curves, 2 sinh 1 m and π m long), θ bound to the slider `theta` over [0, π/2], default 0; entries at 0.25, 0.5, 0.75
  and 1 s move it to π/8, π/4, 3π/8 and π/2.
- **Criterion 3**: `ramp` (x = u, y = v, z = u·v over [−1, 1] × [0, 1]) and `board` (z = 0.1 sin πu sin πv over
  [0, 1]², checker of a and b, 8 × 8, one-sided).
- **Criterion 4**: `root` (x = u, y = v, z = √u over [−1, 1] × [0, 1], one-sided); `torus`, a Clifford torus turned
  45° in the 3-sphere and projected from (0, 0, 0, 1), through the pole at its range's four corners; `huge`, the unit
  sphere with `max: [1024, 1024]`.
- **Criterion 5**: the helix x = cos s, y = sin s, z = 0.1 s over [0, 10π], tolerance 0.001 m, `mode: linear`.
- **Criterion 6**: the plane over [−0.3, 1] × [0, 1] with `grid_lines: {u: 0.25, stroke: {role: ink, width: 1.5}}`;
  `blob`, the implicit unit sphere.
- **Criteria 7 to 10**: implicit surfaces, `two_sided: false`: the unit sphere and the torus in [−1.5, 1.5]³ at
  0.05 m; the bead (radius 0.01 m at (0.31, 0.27, 0.43)) in [−1, 1]³ at 0.002 m; the capped unit sphere at 0.001 m with
  `max_cells: 4096`; the blobs in [−2, 2]³ at 0.05 m, centers at (±h, 0, 0), h written as 0.7 or 0.85, or keyed through
  `data/half` from 0.85 at 0 s to 0.7 at 1 s in the export class.

## The planted programs

Each is reachable only through `deep-show run`'s scenario `planted`; everything else is as shipped. Its process must
exit 0 and answer; the judge that passes the shipped program must fail on it, at a named assertion naming what its
criterion says. `twins.json` maps each criterion's ID to its plant.

| Name | The wrong program | Criterion |
|---|---|---|
| `grid_lines_from_start` | Grid lines fall at the range's start plus whole steps, not at whole multiples of the step. | AC6 `#224.bb45c6d2`: lines at −0.3, −0.05, 0.2, …; the judge's first failure names line 1, expected at u = −0.25 |
| `nets_number_by_thread` | The implicit mesher numbers each vertex as its thread finishes it; with 8 threads the order differs from 1 thread's on every run. | AC7 `#224.52ce6885`: the 1- and 8-thread vertex hashes differ; the failure names the 8 threads |
| `octree_drops_same_sign` | The octree drops every cell whose eight corners share a sign, whatever its interval bound. | AC8 `#224.5f6db998`: nothing drawn; the judge fails, naming that it found nothing |
| `octree_stops_mid_level` | Where the next level would pass `max_cells`, the mesher refines that level's cells in order until the cap and stops part way. | AC9 `#224.08c2cd78`: the judge fails, naming open edges |
| `zero_keeps_first_mesh` | An implicit surface keeps the mesh it built at t = 0 as its var moves. | AC10 `#224.01150621`: played to 1 s it shows 2 shells; the judge fails, naming them |

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: `#224.` and the first 8 hex digits of the SHA-256 of each criterion's text,
trimmed, white space collapsed, computed from the live issue. Each test's name starts with `AC<n> #224.<id>`. Each file's
header states its fixture, numbers and wrong programs in full.

| ID | File (tests) | What it asserts, and what fails it |
|---|---|---|
| AC1 `#224.855c9747` | `ac01-sphere.test.ts` (1) | At 10,000 (u, v) seeded 224, the ray from the centre through the true point meets the drawn triangles within 0.001 m of radius 1; no two drawn vertices on the u seam (y = 0, x > 0, poles aside) with different indices closer than 1e-6 m; at each seam point the normals the two sides shade with within 1°. Fails: a stray or holed mesh, an unwelded seam |
| AC2 `#224.e2f417bd` | `ac02-family.test.ts` (2) | At each slider entry, `geometry` at its time (seek) and with `play` give one vertex hash; helicoid at 0 s, catenoid after the last entry, the first entry changes the hash. At 0 s and each entry, the lines u = 0 and v = 0 within 1e-4 relative of 2 sinh 1 and π. Fails: play apart from seek, θ ignored, lengths off |
| AC2 `#224.e2f417bd` | `ac02-rebuild-budget.test.ts` (1, timed) | The record (`canvas-surface`, `rebuild_128_ms: 2`, margin 0.5, #224, the ID; valid against the merge base); on a reference Mac at rest only, the task's judge: PASS passes, FAIL fails, else INCONCLUSIVE |
| AC3 `#224.7f436e55` | `ac03-color-and-checker.test.ts` (2) | Every vertex at z = 0 is b within OKLab ΔE 0.01 (and z = ∓1 a and c). The checker: each triangle one color, sharp; 64 cells each one role's; no two edge neighbours share a role. Fails: no colors, a ramp off its stops, blended or striped cells |
| AC4 `#224.84d92ff1` | `ac04-nonfinite-and-cap.test.ts` (3) | √u: nothing drawn at u < 0, all of u ∈ [0, 1] drawn (area 1), `surface.nonfinite` names u ∈ [−1, 0], v ∈ [0, 1]. The stereographic torus: `surface.nonfinite` names a range through the pole; nothing non-finite drawn. `max: [1024, 1024]` refused at `items/huge/params/max`; `[256, 256]` presented |
| AC5 `#224.54b3f7df` | `ac05-helix.test.ts` (1) | 2 to 4,096 points, from P(0) to P(10π); at 1,000 s seeded 224, P(s) within 0.001 m of the polyline. Fails: no `fn`, too coarse, too many points |
| AC6 `#224.bb45c6d2` | `ac06-grid-lines.test.ts` (3) | Six lines at −0.25 … 1 on mesh edges, their vertices at their u within 1e-12, each running v ∈ [0, 1]; `grid_lines_from_start` draws −0.3, −0.05, 0.2, … and fails at line 1; `grid_lines` on `blob` refused at `items/blob/params/grid_lines` |
| AC7 `#224.52ce6885` | `ac07-implicit-closed.test.ts` (2) | The sphere one closed shell, V − E + F = 2, its cell 3 ÷ 2^k with a diagonal within the tolerance (or named by `surface.coarse`), every vertex within √3 × `values.cell` of radius 1; the torus one closed shell, V − E + F = 0; `threads` 1 and 8 one vertex hash; `nets_number_by_thread` fails |
| AC8 `#224.5f6db998` | `ac08-small-sphere.test.ts` (2) | The bead found: one closed shell, V − E + F = 2, every vertex within 0.002 m of it; `octree_drops_same_sign` draws nothing and fails |
| AC9 `#224.08c2cd78` | `ac09-coarse.test.ts` (2) | `surface.coarse` names the capped sphere and `size` = `values.cell` = 3 ÷ 2^k; `values.cells` ≤ 4,096; one closed shell, V − E + F = 2; the next level, uncapped, keeps more than 4,096 cells; `octree_stops_mid_level` fails on open edges |
| AC10 `#224.01150621` | `ac10-blobs.test.ts` (2) | 1.4 m apart one closed shell, 1.7 m two, each V − E + F = 2; keyed, at 0 s two shells, at 1 s seek and play one shell each with one vertex hash; `zero_keeps_first_mesh` shows 2 shells played to 1 s and fails |
| AC11 `#224.c7725e3e` | `ac11-taste.test.ts` (1) | The four documents presented; four screenshots and the slider recording from `view3d`'s own final PNGs, kept in docs/evidence/224/ and printed; the call read from `DEEPBUILD_TASTE_224` on those hashes: `looks_right`, else INCONCLUSIVE (none, or on other files) or FAIL (`looks_wrong`) |

Test count: 1 + 2 + 1 + 2 + 3 + 1 + 3 + 2 + 2 + 2 + 2 + 1 = 22.

## Readings where the issue or the design leaves a choice

- **The surfaces read.** `geometry` is the base's call that says what a build made; its clean evaluation at t is a
  seek. Playing needs the session's own frame path, so `geometry` gains `play`; a slider needs entries, so it gains
  `track`, as `eval` has it. Issues are the check's, read from `deep_show`.
- **One side.** A two-sided build may repeat each triangle for its back, as `plate@1`'s does, so the fixtures whose
  topology, weld or area is read (criteria 1, 4's √u, 6's blob, 7 to 10) set `two_sided: false`; criterion 3's ramp,
  criterion 2's family and criterion 4's torus keep the default.
- **"Stays within 0.001 m of radius 1 at (u, v)"** (criterion 1) is the drawn mesh along the ray from the centre
  through the true point at (u, v), so it holds whatever the grid; "no unwelded vertex pair closer than 1e-6 m" is read
  on the u seam's drawn vertices, the poles left out (a pole is a row meeting in a point, not ends of u or v meeting);
  "normals across the seam" are the normals each side's triangles shade with at each seam point.
- **"The two marked curves"** (criterion 2) are grid lines: lines of constant u and v drawn on the surface, which run
  along mesh edges and follow it as its vars move, so their lengths are read from evaluated data. The family is an
  isometry, so "keep their lengths" is each within 1e-4 relative of its closed-form length, 2 sinh 1 and π, which is
  its length at θ = 0. The u range is [−π/2, π/2] so a 128 × 128 grid holds the polyline deficit of the catenoid's waist
  to about 2.5e-5 (at [−π, π] it would be about 1.0e-4, at the limit itself). "A 128 × 128 grid" is `max: [128, 128]`
  at a tolerance the build can't meet sooner.
- **"Gives a vertex at z = 0 role b's color"** (criterion 3) holds every vertex at z = 0 to b; the fixture's z = 0
  edge is a range end, so it is sampled whatever the refinement. The ends a and c are checked too, so one color can't
  pass. "Cells" are the checker's 8 × 8 (u, v) cells, a triangle placed by its centroid; "sharp at cell edges" is one
  color per triangle.
- **"Drops only the cells with u < 0"** (criterion 4) is nothing drawn where u < 0 and all of [0, 1] × [0, 1] drawn;
  "naming that range" is the issues for `root` together naming u ∈ [−1, 0], v ∈ [0, 1]. "Through the pole" puts the
  pole at the domain's corners, so every grid samples it. "Naming the grid" is the error at `params/max`.
- **"Within 0.001 m of the true helix at s"** (criterion 5) is P(s)'s distance to the curve, the polyline through its
  points under `mode: linear`, the form its interval bound holds.
- **"Draws six lines … naming the first line"** (criterion 6): lines in value order; the first failure names line 1
  and the u it should be at.
- **Topology** (criteria 7 to 10) is read on positions welded at 1e-6 m (the base's `welded`): a closed shell has every
  edge on two triangles; V − E + F per connected shell. "Within √3 × its cell's edge" reads the cell from
  `values.cell`. "1 and 8 threads" is the scenario's `threads`.
- **"Found"** (criterion 8) includes where: every vertex within the 0.002 m tolerance of the bead.
- **"The last level whose cells fit"** (criterion 9) is checked from both sides: the capped mesh keeps at most 4,096
  cells, and the same sphere one level finer, uncapped, keeps more.
- **The keyed blobs** (criterion 10) bind a var to time, so each evaluated frame re-meshes; the check refuses a
  re-mesh past the class's frame CPU, and the criterion's box and tolerance don't fit a figure's 4 ms, so the keyed
  document is in the export class, whose frame CPU has no cap. Its centers move through `data/half`, a channel. "Two
  shells at 1 s" is the played reading.
- **The taste call** follows #524's: a file named by an environment variable, on the files' hashes.

## The taste call

`ac11-taste.test.ts` first presents the four documents with `deep_show` (so a build without `surface@1` fails at that
assertion), then draws with `view3d` in `LOOK_3D`, each surface turned −90° about x so its z is up, and writes to
`docs/evidence/224/`: `sphere.png` (the unit sphere), `family.png` (the family over u ∈ [−π, π], gridded every π/4 in u
and 0.5 in v, at θ = π/4), `value-colored.png` (the saddle z = (v² − u²)/2 over [−1, 1]² through a, b, c over
[−0.5, 0.5], gridded) and `checker.png` (a torus, 16 × 8 cells of a and b), 960 × 540, frame 0; and
`family-slider.apng`, θ from 0 to π/2 one entry a frame, 60 frames at 30 fps, 480 × 270. Each is the renderer's final
PNG byte for byte (the recording those PNGs in one animated PNG, unchanged), and its path and SHA-256 are printed. The
implementer attaches them to the PR and shows them in the session; you record the call in a file named by
`DEEPBUILD_TASTE_224`: `{"criterion": "#224.c7725e3e", "by": "you", "screenshots": [sha256 × 4], "recordings":
[sha256], "call": "looks_right" | "looks_wrong"}`. No other test reads a picture.

## Not tested, because no criterion reaches it here

`closed: false` forced open; `refine by camera distance` (never); uv0's values; `shade: flat`; color by u, v, x, y or
an expression; more than three ramp roles outside the oracle lane; `studio.metaballs`'s expansion (criterion 10 writes
its `zero` out); a gyroid; a curve fn read by tube, mark.curve or follow_path, or on 3D axes; a surface on 3D axes
outside the oracle lane; grid lines' stroke, dash, depth bias, a closed direction's seam line and the refusal of steps
past `max`; the implicit check refusing a time-bound re-mesh past the class's frame CPU; the decision that lofts aren't
needed. They are follow-ups for the implementer's own tests.

## What the implementer adds outside this folder

- `surface@1` in scene3d (parametric and implicit, color, checker and grid lines), `fn` on curve@1, their issues and
  refusals, and the rows' `attributes.color`, `grid_lines`, `values.cell`, `values.cells` and `points`.
- In `deep-show`: `geometry`'s `track` and `play`; the scenario's `threads` reaching the implicit mesher; the five
  planted names in scene3d's `PLANTED`. In `deep-gpu`: `view3d` drawing `surface@1` and a document's inline `track`.
- The `canvas-surface` task in `benchmarks/budgets.json` and its `surface` mode in `benchmarks/canvas.mjs`.
- The two `scripts/lanes.mjs` lines under Run them.
- After your taste call: the pictures attached to the PR.

`BASE-FAILURE.txt` says what each test meets at the base.
