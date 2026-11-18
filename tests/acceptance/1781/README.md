# Acceptance tests for #1781: typed geometry attributes, their carry rules, fields in store, and geometry.attributes

These tests were written before any implementation existed. The writer had issue #1781 (its opening paragraph, scope,
eight acceptance criteria, proof line and oracle line), its oracle page, the design sections it links and the ones
those lean on, and base commit `16dc5eab0e5c2687b4ae7a973b350c32bbfb9342` (origin/main). It never saw the work.

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job
(design: Dogfooding). The suite is lean: one file and one test per criterion, each holding the planted wrong
program its criterion names, and no other case.

**Not run against a binary.** The machine's load was 160 to 490 on 18 cores and its disk 96% to 98% full, so no Rust
was built, `deep-show` was never started, and the suite wasn't run at the base. No test here has passed or failed.
`BASE-FAILURE.txt` says what each test meets first at the base, read from the base's code. The type-check passes and
`vitest list` collects the eight tests. A scratch script (not kept) ran `reference.ts` alone on arrays it made itself
from a model box, true and planted (BASE-FAILURE.txt lists what it found).

## What was read

- Issue #1781, live (`gh issue view 1781`), and its oracle page (`doneright/oracles/issues/1781.md`, branch
  `doneright`, in DeepBuildAI/deepbuild). The page links upstream tests of an upstream modeling tool for criteria 1
  and 2 and none for 3 to 8, and says none has data our code can read with no engine. The issue texts of #78, #420
  and #440 were not read.
- `docs/canvas-primitives.md`:
  - Attribute and field: the 6 domains and 9 types, the built-ins, `nonfinite {id, attribute, elements}`, a field's
    size, the refusals, and the `elements` read's "values read in f64 as `geometry.attributes` reads them and bool,
    i32 and u32 as whole numbers" and its `after`.
  - Modifier (its fields, `on: named part = all`, and the carry rules), Modifier: store, Modifier: subdivide.
  - Builder and Builder: shading.
  - The closed function list.
  - What holds a document to its rules (issues as data, `{check, code, severity, ids, path, actual, t, what, fix}`),
    Check input (`geometry.attributes` among the core's kinds) and Check input: shape readings (a check with no
    `expect` is INCONCLUSIVE, never PASS; `results` on the row).
- `docs/technical-design.md`, How we know version 0 works: Criteria to tests, Wrong programs, Failing on an
  assertion, Dogfooding, Tests written first.
- At the base, for surfaces only:
  - `AGENTS.md`.
  - `tests/acceptance/1700/` (a core check kind judged on a claim's deliverable: `claims`, `verdict`, `results` and
    issues on a requirement's row, the scenario's `planted`), `440/` and `420/` (`deep_show`, builders as item kinds,
    the modifier stack, a refusal at check read from `outcome` and `issues`), `224/` (an issue's fields read on the
    issue or in its `actual`) and `192/voxel/` (a build per Cargo feature list, several documents in one panel).
  - `crates/deep-show`: `Cargo.toml` (the `test-*` features), `main.rs` (the scenario's `docs`, `claims` and
    `planted`), `hub.rs` `show` (a build operator's error is an error issue of the revision), `verdict.rs` `judge`
    (`module_missing` for a kind nothing registers) and `geometry/shape.rs` (a core kind's row).
  - `crates/deep-canvas`: `registry/mod.rs` (`CORE_CHECK_KINDS`), `document/mod.rs` (an issue's JSON), `expr.rs`
    (the closed function list's compiler and its node cap).
  - `crates/deep-canvas-scene3d`: `geom.rs` (`Mesh`, its two attribute maps), `stack.rs` (the modifier kinds, `on`,
    `mod.store@1`, `mod.subdivide@1`'s schemes, `mod.array@1`), `builders.rs` (`slab@1 {size}`, `shade`, its parts
    `top`, `bottom` and `side`) and `build.rs` (`fault`).
  - `scripts/proof-change.mjs` (`criterionId`, `spans`), `scripts/proof-runs.mjs` (failing at an assertion) and
    `scripts/lanes.mjs`.

Code was read only to learn the surface. Every expected value comes from the issue and the design.

## What the base already does, which these tests don't credit

`deep-show run` presents scene documents. `slab@1 {size: [1, 1, 1]}` builds a box standing on y = 0 with x and z from
−0.5 to 0.5 m, takes `shade: flat`, and names its parts `top`, `bottom` and `side`. The stack runs `mod.array@1`,
`mod.subdivide@1 {levels, scheme: catmull_clark | loop | simple}` and a `mod.store@1` that keeps one f64 per vertex
(`domain: point`) or per triangle (`domain: face`) from a handful of named fields. A claim's requirement is judged by
`verdict`, and a kind nothing registers is BLOCKED with `module_missing`. There is no `test.attrs@1`, no `test-attrs`
build, no typed attribute table, no corner or edge domain, no field from the closed function list in a store, no
`on` on a store, no carry rule by domain and type, no `geometry.attributes`, and none of the planted names below.

## Run them

Every file builds `deep-show` with cargo, so they run one file at a time. The implementer adds these lines to
`scripts/lanes.mjs`. This README is the instruction; this job edits nothing outside the folder.

```js
// #1781's files each build deep-show (the full set, or the full set with the test-attrs fixture builder).
alone.push('tests/acceptance/1781/');
```

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1781 --no-file-parallelism <file>
node node_modules/typescript/bin/tsc -p tests/acceptance/1781/tsconfig.json   # type-check
rm -rf tests/acceptance/1781/node_modules                                      # the cache a run with --root leaves
```

- **Build.** Each file's `beforeAll` runs `cargo build --locked --bin deep-show --no-default-features --features
  <set>` once, with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0` unless they're already set, copies the binary out
  of `target/` (honouring `CARGO_TARGET_DIR`), and the test fails with cargo's error when the build failed.
- **Timeouts.** Builds take many minutes under load, so no command-line timeout is needed: each `it` passes its own
  (2 hours), each build hook its own (2 hours), and each `deep-show run` process is stopped after 15 minutes.
- **Machines.** Every test is CPU only and runs anywhere: no GPU, no browser, no reference Mac, no time budget.
- **Isolation.** Each `deep-show run` gets a fresh evidence folder, deleted after the test. Node built-ins and
  vitest only, no network, no fixture file.

## The surface under test

**No new binary and no new call.** The suite drives the #393 `deep-show run` (one scenario line in, one answer line
out), with the agent's `deep_show`, the #403 scenario `claims` and `{"call": "verdict", "claim"}`. Every name or
shape below that the issue and the design don't give is this job's choice, marked *(chosen)*. An implementation builds
exactly these, or disputes them.

### The test build and its fixture builder

- **`test-attrs`** *(chosen)*: a Cargo feature of `deep-show`, built beside `full`
  (`--no-default-features --features full,test-attrs`). It adds the fixture builder and nothing else. `full` alone
  doesn't know the kind. Four files build `full,test-attrs` (criteria 1, 2, 5 and 6); four build `full`.
- **`test.attrs@1 {attributes: [{name, domain, type, values}]}`**, as the issue gives it: a builder item kind, run
  through the builder interface every builder uses, so it takes a modifier stack as `slab@1` does.
  - Its mesh is a 1 m box: 8 points, 12 edges, 6 faces, 24 corners. *(chosen)* It is axis-aligned, 1 m along each
    axis. Where it stands and how it numbers its elements aren't read.
  - *(chosen)* A document that holds it requires only `requires.modules: {scene3d: "^1"}`: in the test build the
    kind is scene3d's.
  - `values` holds one value per element of the attribute's domain, in element index order.
- **A value's JSON form** *(chosen)*, the same in `test.attrs@1`'s `values`, in the check's `expect`, in a row's
  `results` and in an issue's `expected` and `actual`:

  | Type | Form |
  |---|---|
  | `bool` | `0` or `1`, a whole number, as the design's `elements` read gives bool, i32 and u32 |
  | `i32`, `u32` | a whole number |
  | `f32` | a number |
  | `vec2`, `vec3`, `vec4` | a list of 2, 3 or 4 numbers |
  | `quat` | `[x, y, z, w]` |
  | `color` | `[r, g, b, a]` |

### Documents

Each fixture is a scene document an agent sends (`format: 1, profile: scene, requires.modules: {scene3d: "^1"}`, a
`camera@1` item `cam`, no `id`, no `layers`), holding one item `box`.

- **The slab box:** `{kind: "slab@1", params: {size: [1, 1, 1], shade: "flat"}, modifiers: […]}`.
- **The fixture box:** `{kind: "test.attrs@1", params: {attributes: […]}, modifiers: […]}`.
- **Store:** `{kind: "mod.store@1", on?: part, params: {name, domain, type, field, fallback?}}`.
  - `domain` and `type` are always written out; the issue's `store {name: w, field: -99}` gives neither, and this
    suite doesn't lean on a default.
  - `field` is the expression as a string, so −99 is `"-99"`.
  - `on` is the modifier's own field, beside `kind` and `params`, as the design's Modifier gives it
    (`on: named part = all`) and as the base's deforms take it.
  - `fallback` is a number in `params`.
- **Subdivide:** `{kind: "mod.subdivide@1", params: {levels: 1, scheme: "simple"}}`.
- **Array:** `{kind: "mod.array@1", params: {count: 3, offset: [2, 0, 0]}}`.

### The scenario

One process per run: `{evidence, sessions, processes, panels: {main}, docs: {<doc>: {panel: "main"}}, claims?,
planted?, calls}`.

- `{"call": "deep_show", "session": "sess-alpha", "doc", "document", "include": ["issues"]}` presents a revision.
  A test reads its `outcome` (`presented` or `refused`), its `issues` and its `notices`.
- `claims` holds one claim of the working agent alpha, the presented document its one deliverable, its locked
  definition one requirement `{id, check}` per check. `{"call": "verdict", "claim"}` judges it after the `deep_show`.
- `planted` names a planted wrong program, or is absent.

### The check, as a claim's requirement

`{kind: "geometry.attributes", of: ID, after?: modifier index, expect?: {name → {domain, type, count, values}}}`, as
the issue gives it. `tolerance` is never written, so every comparison runs at its default, 1e-6.

- `of` is `box`.
- `after: k` reads the mesh the item's modifier `k` leaves, counted from 0 as `items/<id>/modifiers/<k>` counts.
  Left out, the check reads the mesh the whole stack leaves. Only criterion 3 writes it.
- `expect` gives every attribute's `domain`, `type`, `count` and `values`.

### The verdict's row

The requirement's row is the #403 `{id, kind, result, blocked?, issues}`, decided: never BLOCKED with
`module_missing`, as it is at the base.

- **`result`.** PASS when every attribute `expect` names matches. FAIL when one differs or the mesh lacks it.
  *(chosen)* INCONCLUSIVE with no `expect`: "a reading, never a pass", as a `geometry.shape` with no `expect` is.
- **`results`** *(chosen)*: `[{attribute, domain, type, count, values}]` on the row, as `geometry.shape` puts its
  `results` there. It holds one entry for each attribute the check read: every attribute `expect` names that the mesh
  carries, and with no `expect` every attribute the mesh carries. `attribute` is its name, `count` its domain's
  element count, and `values` holds `count` values in element index order, read in f64. A test finds an entry by
  `attribute` and reads no other entry, so built-ins may be listed or left out.
- **`issues`.** *(chosen)* An attribute that differs or is lacking raises `geometry.attribute`, with its fields on
  the issue itself as `geometry.reading`'s are: `{check: "geometry.attributes", code: "geometry.attribute",
  severity: "error", ids, path, attribute, element, expected, actual}`.
  - `attribute` is the attribute's name.
  - `element` is the index of the first element that differs, and `expected` and `actual` the two values there.
  - One issue per attribute: the check names the first element that differs, not each.
  - For an attribute the mesh lacks, `attribute` names it and the row's `results` hold no entry for it. Its
    `element`, `expected` and `actual` aren't read.

### Issues a revision raises

They come back in the `deep_show` reply's `issues`, each `{code, severity, ids, path, actual, what, fix}` as the base
writes them. *(chosen)* A field an issue names is read on the issue itself or in its `actual` object; the tests read
either, as #224's suite reads `surface.nonfinite`. A refusal is `outcome: "refused"` with an error issue.

| Code | When | Its `path` | What it names |
|---|---|---|---|
| `attribute.length` *(chosen)* | an array whose length differs from its domain's count | `items/<id>` or under it | `attribute`, `domain`, `length` (the array's) and `count` (the domain's) |
| `attribute.reserved` *(chosen)* | a builder, modifier or provider output that writes `position`, `normal`, `uv0`, `id` or `index` | `items/<id>` or under it | `attribute` |
| not pinned | a store whose `domain` is `edge`, `curve` or `instance` | `items/<id>/modifiers/<k>/params/domain` | the field, by its path |
| not pinned | a store whose `type` is `bool`, `i32`, `u32` or `quat` | `items/<id>/modifiers/<k>/params/type` | the field, by its path |
| `attribute.no_rule` *(chosen)* | a modifier with no rule for an attribute its input carries | `items/<id>/modifiers/<k>` or under it | `modifier` (its kind, `mod.subdivide@1`), `attribute`, `domain` and `type` |
| `field.nodes` *(chosen)* | a field of more than 256 nodes | `items/<id>/modifiers/<k>/params/field` | `nodes` (the field's) and `max` (256) |
| `fallback_missing` *(chosen; the base's code for a driver that needs one)* | a field that takes a root with no `fallback` | `items/<id>/modifiers/<k>` or under it | nothing more |
| `nonfinite` (the design's) | a stored field whose result isn't finite at some elements | not read | the item, as `id` or in `ids`; `attribute`; `elements`, their count |

`nonfinite` is not an error *(chosen: any other severity)*, and its revision is presented.

### The planted programs

*(chosen)* Each is the scenario's `planted`, reachable only there, never an environment variable. The implementer
adds each to the planted names `deep-show run` accepts; any other value stays `bad_input`, as the base answers an
unknown one. Everything a planted program doesn't name stays as shipped.

| Name | The wrong program | Criterion |
|---|---|---|
| `attrs_kept_as_f32` | the built mesh keeps every attribute's values as f32, so a u32 of 16,777,217 reads back 16,777,216 | `#1781.7a007913` |
| `subdivide_corners_per_point` | a corner attribute through `mod.subdivide@1` keeps one value per welded point, so every corner at a point holds the same | `#1781.c26a7b7d` |
| `subdivide_edge_copies_end` | through `mod.subdivide@1` an edge point takes one end's value of a float point attribute, in place of the two ends' mean | `#1781.90e5e7d8` |
| `subdivide_averages_whole` | through `mod.subdivide@1` a point attribute of type bool, i32 or u32 is averaged as a float one is | `#1781.d8b78c9f` |
| `subdivide_drops_edge_attrs` | `mod.subdivide@1` builds its mesh without an edge attribute its input carries, and refuses nothing | `#1781.11d8dbb9` |
| `store_ignores_on` | a store with `on` evaluates over its whole domain | `#1781.9a742846` |
| `store_nonfinite_keeps_earlier` | an element whose result is not finite keeps the value it had before the store, in place of the fallback | `#1781.2282e9be` |

Criterion 2 names no planted program.

## Criteria to tests

IDs are `#1781.` and the first 8 hex digits of the SHA-256 of each criterion's text, as `scripts/proof-change.mjs`
computes them (trimmed, white space collapsed), from the live issue. Each file holds its criterion's number and ID as
`const ID`, and its one test's name starts with `${ID}`, so `spans` reads it. Each file's header states its
fixture, numbers and planted program in full.

| Test name starts | File, build | What it asserts | The wrong program it fails on |
|---|---|---|---|
| `AC1 #1781.7a007913` | `attributes.test.ts`, `full,test-attrs` | The fixture box with 36 attributes is presented, and `geometry.attributes` with all 36 in `expect` PASSes. Its `results` hold each with its domain, type, count (8, 12, 6 or 24) and values, whole types exactly and float types within 1e-6, 450 values in all. `point_u32`'s element 3 reads 16,777,217. | `attrs_kept_as_f32`: element 3 reads 16,777,216, the row FAILs, and its one `geometry.attribute` issue names `point_u32`, element 3, expected 16,777,217 and actual 16,777,216. Also the base. |
| `AC2 #1781.e091f892` | `refusals.test.ts`, `full,test-attrs` | Thirteen revisions are each refused: `attribute.length` naming `seven`, `point`, 7 and 8; `attribute.reserved` naming each of `position`, `normal`, `uv0`, `id` and `index`; an error at `…/modifiers/0/params/domain` for a store on `edge`, `curve` and `instance`; an error at `…/modifiers/0/params/type` for a store as `bool`, `i32`, `u32` and `quat`. | The base (no planted program is named). |
| `AC3 #1781.c26a7b7d` | `corners.test.ts`, `full` | Before the subdivide (`after: 3`) `n` is a corner f32 of 24 values: 3 corners at each of the box's 8 corners, holding the 3 codes of the faces through it, each of −4, −2, −1, 1, 2 and 4 four times. After it `n` holds 96: the corners at each of the 26 points hold what its faces give, each code 16 times. Both rows are INCONCLUSIVE. | `subdivide_corners_per_point`: the check of the corners at each point fails, and its first problem names the first point on more than one face, `point <i>`. Also the base. |
| `AC4 #1781.90e5e7d8` | `points.test.ts`, `full` | After the subdivide `f` is a point f32 of 26 values. The points are the box's 8 corners, 12 edge midpoints and 6 face centres at x and z = ±0.5 m and half way. Each holds the mean of the field at the corners it was made from, which is the field at its own position, within 1e-6. The 26 sum to 52. | `subdivide_edge_copies_end`: a ring edge's point holds another value and is named, `point <i>`; no source point or upright edge's point is wrong. Also the base. |
| `AC5 #1781.d8b78c9f` | `whole-numbers.test.ts`, `full,test-attrs` | After the subdivide `tag` is a point u32 of 26 values, each one of the eight. The 8 points at the box's corners hold the eight, each once. Every other point holds the least of the values at the corners it was made from: its lowest-indexed source point's. | `subdivide_averages_whole`: a point holds a value outside the eight and is named, `point <i>`. Also the base. |
| `AC6 #1781.11d8dbb9` | `edges.test.ts`, `full,test-attrs` | Arrayed, `ridge` is an edge f32 of 36 values, each of the 12 source values held by exactly 3 edges. Subdivided, the revision is refused with `attribute.no_rule` naming `mod.subdivide@1`, `ridge`, `edge` and `f32`. | `subdivide_drops_edge_attrs`: the check of that refusal fails, naming `ridge`; the revision is presented; and `geometry.attributes` expecting `ridge` FAILs with a `geometry.attribute` issue naming it. Also the base. |
| `AC7 #1781.9a742846` | `parts.test.ts`, `full` | `w` is a point f32 of 8 values. Each upper point holds 10 x + 20 z at its own position, so the four hold −15, −5, 5 and 15. Each lower point holds −99. | `store_ignores_on`: exactly the 4 lower points hold another value, and the first is named, `point <i>`. Also the base. |
| `AC8 #1781.2282e9be` | `fields.test.ts`, `full` | The 256-node field is presented and `geometry.attributes` expecting `[127, …, 120]` PASSes. The 257-node field is refused with `field.nodes` naming 257 and 256. `sqrt(position.x)` with no fallback is refused with `fallback_missing`. With `fallback: 7` the revision is presented with exactly one `nonfinite`, not an error, naming `box`, `r` and 4; `r` holds 7 at the 4 points with x = −0.5 m and 0.7071068 within 1e-6 at the other 4. | `store_nonfinite_keeps_earlier`: exactly the 4 points with x = −0.5 m hold another value than 7, and the first is named, `point <i>`. Also the base. |

## Fixtures

Metres, +Y up. Every document is generated in its test file; there is no fixture file. `reference.ts` holds the
worked values and judges the arrays a test read.

- **The 36 attributes** (`reference.ts` `EVERY`). One per pair of a mesh domain and a type, named
  `<domain>_<type>`, with 8, 12, 6 or 24 values: 9 × 50 = 450. Element `i` of domain number `d` (0 point, 1 edge,
  2 face, 3 corner) holds:

  | Type | Value |
  |---|---|
  | `bool` | 1 where `(i + d) mod 3` is 0, else 0 |
  | `i32` | `(i − 2) × 1001 − d` |
  | `u32` | `1000 × (d + 1) + i`, but `point_u32`'s element 3 is 16,777,217 |
  | `f32` | `d − 1 + 0.125 × i` |
  | `vec2` | `[i, d − 0.5 × i]` |
  | `vec3` | `[i + 0.25, d, −i]` |
  | `vec4` | `[i, 0.5 × i, d, −2]` |
  | `quat` | entry `(i + d) mod 12` of twelve unit quaternions whose components are 0, ±0.5 or 1, w never negative |
  | `color` | `[i ÷ 32, 0.25 × d, 1 − i ÷ 32, 1]` |

  Every number but 16,777,217 is exact in f32, so a mesh that keeps its values as f32 differs at that one element.
  Each array differs from itself shifted by one element.
- **The slab box** (criteria 3, 4, 7 and 8): `slab@1 {size: [1, 1, 1], shade: flat}`. Its 8 points lie at x and
  z = ±0.5 m, as the issue says, on two levels 1 m apart. A test reads those levels, never assumes them.
- **Positions, read from the mesh itself.** The design doesn't say how a mesh numbers its points, edges, faces or
  corners, so no test leans on that order. A test that needs to know where an element stands stores three more f32
  attributes on the same domain, `position.x`, `position.y` and `position.z`, and reads them beside the attribute
  under test: element `i` of each array is the same element. The names are `px, py, pz` on points, and `cx, cy, cz`
  and `dx, dy, dz` on corners before and after the subdivide.
- **The box's places.** After `subdivide {levels: 1, scheme: simple}` the 26 points must stand on the box's 8
  corners, 12 edge midpoints and 6 face centres, each once, within 1e-6 m. A point is made from the corners nearest
  it: its own corner, its edge's two ends, or its face's four.
- **Criterion 5's tags.** Point `i` of the fixture box holds 2^(i + 1), so of any source points the lowest-indexed
  is the one whose value is least, wherever the builder stands its points.
- **Criterion 6's edge values.** `ridge` holds 1.5, 2.5, …, 12.5, one value of its own on each of the 12 edges.
- **Criterion 8's fields.** `-index + 1 + 1 …` with 127 `+ 1` is 2 + 127 × 2 = 256 nodes; `index + 1 + 1 …` with 128
  is 1 + 128 × 2 = 257. The test counts both before it runs anything.

## Readings where the issue and design leave a choice

- **Element order.** Only three things lean on an index, each from the issue's own words: `test.attrs@1` gives and
  reads back values in element index order (criterion 1); `index` in a point field is the point's own index, from 0
  (criterion 8: 127, 126, …, 120 on 8 points); and the lowest-indexed source point is the one with the least tag
  (criterion 5). Everything else is judged from each element's own position.
- **`position` and `normal` in a field.** On the point domain `position` is the welded point's. On the corner domain
  `position` is the position of the corner's point and `normal` the corner's own normal, which on a flat-shaded box
  is its face's outward normal. Criterion 3's values (±1, ±2, ±4) already need the second.
- **"The 3 corners at every point hold 3 different values"** is read as the 3 codes of the 3 faces through that
  point, which the field gives: ±1 for ±x, ±2 for ±y, ±4 for ±z. After the subdivide the same rule gives 2 corners of
  each of an edge point's 2 faces and 4 of a face point's 1 face, which is "carried inside its source face only".
- **"Naming the first point"** (criterion 3). The planted subdivide gives every corner at a welded point one value,
  so every point on more than one face (8 source points and 12 edge points) is wrong and no face point is. The first
  point is the lowest-indexed of those 20, by the subdivided mesh's own point index, and the test's first problem
  names it.
- **"Fails on a ring edge, naming the point"** (criterion 4). A ring edge is an edge of the slab's top or bottom
  outline. Its two ends differ by 2, so one end's value is off by 1 at its point. An upright edge's two ends hold one
  value, so copying an end changes nothing there. The test names a ring edge's point by its index and holds that no
  source point or upright edge's point is wrong. It doesn't hold the face points to anything under the planted
  program, since a program may make a face point from its edge points.
- **"Each new point holding the value of the lowest-indexed source point it was made from"** (criterion 5) is held
  for all 26: a point at a corner is made from that one source point and keeps its value.
- **"Each equal to its source edge's"** (criterion 6) is read as each of the 12 source values held by exactly 3 of
  the 36 edges, one per copy. No store may write the edge domain, so an edge's place can't be read back, and the
  order of a copy's edges isn't the design's. A program that swapped two edges' values in every copy would pass.
- **"Its copies 2 m apart"** is the array's own `offset`. It isn't read back; 36 edges show no two copies welded.
- **"Through `subdivide`"** (criterion 6) uses the same `{levels: 1, scheme: simple}` as criteria 3 to 5.
- **"A planted subdivide that builds without the attribute fails, naming it"** is held two ways: the check of the
  refusal fails with a problem naming `ridge`, and `geometry.attributes` expecting `ridge` FAILs naming it. The
  expected count is 48 (a box's 2E + C edges after one level) and its values are never compared.
- **"Refused at check"** and **"refused"** are both a `deep_show` whose `outcome` is `refused`, with an error issue.
  At the base a builder's or a modifier's fault is already an error issue of the revision.
- **"Naming the field"** (criterion 2) is the issue's `path` ending in the store's field at fault, `params/domain`
  or `params/type`. Its code isn't pinned. The store as `quat` takes the field `vec4(0, 0, 0, 1)`, so only its type
  is at fault.
- **The reserved names** (criterion 2) are each given as a point f32 with 8 values, so only the name is at fault.
- **"One `nonfinite` counting 4"** is exactly one issue of that code on the presented revision, not an error.
- **"Its earlier value"** (criterion 8). The criterion's stack has no earlier store of `r`, so the earlier value is
  whatever the element held before, 0 by the store's own rule. The test doesn't pin it: it holds only that exactly
  the 4 non-finite elements read something other than 7.
- **"0.7071068 within 1e-6"** is compared with the issue's own 0.7071068.
- **`geometry.attributes` and the tests' own judgement.** Where the issue fixes values by index, `expect` judges
  (criterion 1, criterion 8's index field, and criterion 6's planted leg). Elsewhere the check is a reading with no
  `expect` and the test judges the arrays it read from each element's position, since an `expect` needs an order
  the design doesn't give.

## Legs that read BLOCKED or INCONCLUSIVE

None of these is a pass.

- **The whole suite, here.** It wasn't run against a binary on this machine, so all eight tests are unrun.
- **The oracle lane, criteria 1 and 2: BLOCKED.** The oracle page links upstream tests for them, which need the
  upstream modeling tool to run, and a linked test counts only when run against our output (#136). There is no runner
  here, so the lane is BLOCKED with one unblock ask, as the issue says. This suite ports their method, never their
  data: attributes kept and looked up by name, domain and type (criterion 1), and an attribute refused for its
  domain's count or for a name the mesh keeps for itself (criterion 2).
- **A reading's row.** A `geometry.attributes` with no `expect` is INCONCLUSIVE by design. The tests hold it to
  that; it is the check's result, not a test's.
- **A build that can't run.** Where cargo is missing or the build fails, the test fails with cargo's error.
- No test has a leg a machine can leave undecided: nothing needs a GPU, a browser, a reference Mac or a time budget.

## Names this job chose

None of these is in the issue or the design; an implementation builds them as written, or disputes them.

- **Cargo feature:** `test-attrs` on `deep-show`.
- **`test.attrs@1`:** a scene3d kind in the test build; its box axis-aligned; a value's JSON form by type.
- **The row:** `results: [{attribute, domain, type, count, values}]`; INCONCLUSIVE with no `expect`; the issue
  `geometry.attribute {attribute, element, expected, actual}` with its fields on the issue.
- **`after`:** the modifier's index from 0; the mesh that modifier leaves.
- **Refusal codes and what they name:** `attribute.length {attribute, domain, length, count}`,
  `attribute.reserved {attribute}`, `attribute.no_rule {modifier, attribute, domain, type}`,
  `field.nodes {nodes, max}`, `fallback_missing`; each field on the issue or in its `actual`.
- **`nonfinite`:** in the `deep_show` reply's `issues`, any severity but `error`.
- **Planted names:** `attrs_kept_as_f32`, `subdivide_corners_per_point`, `subdivide_edge_copies_end`,
  `subdivide_averages_whole`, `subdivide_drops_edge_attrs`, `store_ignores_on`, `store_nonfinite_keeps_earlier`.
- **Fixture names:** the item `box`; the attributes `<domain>_<type>`, `seven`, `tag`, `ridge`, `n`, `f`, `w`, `k`,
  `r`, `s` and the position stores `px, py, pz, cx, cy, cz, dx, dy, dz`.
- **Scenario IDs:** documents `01JB1781D…`, claims `claim:01JB1781C…`, requirements `req:01JB1781Q…`; the session
  `sess-alpha`; the panel `main`.

## Not tested

No criterion asks for these, so none is tested:

- **Domains and types:** attributes on the curve and instance domains; a store on the face domain, or as vec2, vec3,
  vec4 or color; a point attribute of type bool, i32 or quat through a subdivide (only u32 is).
- **Carry rules:** `mirror`, `bevel`, `solidify` and `build`; a face attribute through any modifier (#440's suite
  holds a face attribute through array, bevel and subdivide); a float point attribute or a corner attribute through
  `array`; an edge attribute through `mirror`; `levels` past 1; the `catmull_clark` and `loop` schemes.
- **Refusals:** a second writer of a name with another domain or type; a modifier's or a provider's output that
  writes a built-in name; an array too long; an attribute of another domain given a wrong count.
- **The check:** `tolerance` other than its default; an `expect` whose domain, type or count differs from the
  mesh's; an `after` past the stack's length; an `of` the document lacks or an item with no mesh; a lacking
  attribute's `element`, `expected` and `actual`.
- **Fields:** a store with `on` and no earlier store (the 0 the others hold); a sum's nodes; the nesting cap; a
  field that divides, or takes a log or a power, with no fallback; `t` in a field.
- **Other surfaces:** the `geometry` call's rows (this suite never reads them); the `elements` read; the glTF
  mapping, proxies, a provider's vertex attributes and geometry measures, which the issue leaves out; content keys,
  caching and cost.
