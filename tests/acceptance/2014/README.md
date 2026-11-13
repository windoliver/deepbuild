# Acceptance tests for #2014: the terrain plate, one surface for drawing, physics, picks and rest_on, and a size cap in samples

These tests were written before any implementation existed. The writer had issue #2014 (its Scope, its Fields for
Builder plate: terrain, its two acceptance criteria, its Proof line "The plate cell and the 24 km plate with their parity
fixtures" and its Oracle line), the parent #442 for what the sibling parts own, the issue's Oracle page, the design
sections the issue names and the ones those lean on, and base commit `35df4523f`. No implementation existed, and no other
worktree, branch or pull request was read.

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job
(design: Dogfooding). The suite is lean: one file per criterion, the planted wrong program each criterion names, and no
budget or timing test. The Oracle line's lane is `tests/acceptance/2014-oracle/`.

**Not run against a binary.** The machine's one-minute load was about 238 on 18 cores and `cargo` isn't on this shell's
`PATH`, so no Rust was built. The surfaces the tests read plainly don't exist at the base (see `BASE-FAILURE.txt`, which
says which lines were read from the code). Every test file was run once without `cargo`: each test's judge self-checks,
which run before the binary is asked for, passed, and each test then failed at "the binary builds". The type-check passes.

## What was read

- Issue #2014 and its Oracle page (`doneright/oracles/issues/2014.md` on branch `doneright` of `DeepBuildAI/deepbuild`),
  with the one upstream file it pins for criterion 1, the pinned upstream physics library's `src/shape/heightfield3.rs`
  at commit `3383f51cbbe9af70565427e7a66c605e1557c1fc`, read from the vendor copy. Issue #442's body, for the siblings:
  levels of detail by projected error and full-detail shading normals are #2017's, scatter and rest_on #2013's.
- `docs/canvas-primitives.md`: Builders, recipes, looks and cameras; Builder (`plate`, `true_shape`, the vertex cap per
  build); Builder plate: terrain, and Builder plate: terrain overlays; Attribute and field (a field is an expression in
  the closed grammar over `position`, f32); Constraint: rest_on; Control: point (a ground point on a terrain plate "as
  the two triangles per sample quad that its height-field collision uses", rounded to 1/1024 m); Control: picks on rows
  and grid focus; Level of detail: chunks streamed by view; Shape (`heightfield {cols, rows, heights, scale}`, static
  only); World and backend (`query()`); Check input: `physics.query`.
- `docs/technical-design.md`: Modeling steps; Scenes, physics and the canvas core; The physics module (World, Shape);
  Dogfooding.
- At the base, for surfaces and conventions only: `AGENTS.md`; `crates/deep-show` (`run`'s calls and the planted match in
  `main.rs`, the `geometry` call in `geometry.rs`, `physics.rs`, `spatial.rs`); `crates/deep-canvas-scene3d` (the
  `plate@1` builder and its spec, `hit.rs`, `rest.rs`, `PLANTED`); `crates/deep-canvas-physics` (the shape reader, which
  refuses `heightfield` as not built yet; the backend interface); `crates/deep-canvas/src/document` (the issue shape,
  `unknown_field`); `crates/deep-canvas/src/expr.rs` (the function list); `scripts/proof-change.mjs` (`criterionId`) and
  `scripts/lanes.mjs` (`alone`); and the earlier suites `2013/`, `2013-oracle/` (the model for layout), `1976/` (the hit
  path) and `505-oracle/` (a formula re-expressed in an oracle lane).

Code was read only to learn the surface. Every expected value comes from the issue and the design.

## Run them

Every file builds `deep-show` with cargo, so they run one file at a time. The implementer adds these lines to
`scripts/lanes.mjs`. This README is the instruction; this job edits nothing outside its two folders.

```js
// #2014's files each build deep-show.
alone.push('tests/acceptance/2014/', 'tests/acceptance/2014-oracle/');
```

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/2014 --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/2014/tsconfig.json   # type-check
rm -rf tests/acceptance/2014/node_modules/.vite
```

- **Build.** Each file first runs `cargo build --locked --bin deep-show --no-default-features --features full`, with
  `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0` unless they're already set, copies the binary out of `target/`
  (honoring `CARGO_TARGET_DIR`), and fails each test whose build failed. Cargo may need `/opt/homebrew/opt/rustup/bin`
  on `PATH`. Every test passes a 60-minute timeout of its own.
- **Isolation.** Every test writes into temporary folders and deletes them. The suite uses Node built-ins and vitest only.

## The surface under test

The suite drives the #393 `deep-show run` (one scenario line in, one answer line out) with the agent's `deep_show`,
#420's `geometry`, #411's `deep_query`, and one new call, `terrain_rays`. Every name below that the issue and the design
don't give is this job's choice, listed again under Readings. An implementation builds exactly these, or disputes them.

### The documents (helpers.ts)

Every fixture is a `scene` document in the agent's form: no `id`, no `layers`, `requires.modules` holding `scene3d`,
plus `motion` where a constraint is written. The working agent (`sess-alpha`) shows it with
`{"call": "deep_show", "session", "doc", "document", "include": ["issues"]}`. Metres, +Y up, right +X.

- **The terrain plate** is the item `ground`, `{"kind": "plate@1", "params": {"terrain": {"height", "size", "spacing",
  "tile", "lod_levels"}}}`, with no `grid`, `outline`, `cover` or `at`, so its own space is the world's.
  - `height` is a field: an expression string in the closed grammar over `position`, read at each sample as
    `position = (x, 0, z)` in the plate's space.
  - The samples lie `spacing` apart, centred on the plate's origin: x = −size[0] ÷ 2 + i × spacing for i from 0 to
    size[0] ÷ spacing, and z likewise. This is how `plate@1 {grid}` centres its grid at the base, and how the pinned
    upstream height field centres its samples.
  - Cell [c, r] is the square from sample (c, r) to (c + 1, r + 1). c counts along +x from the −x edge and r along +z
    from the −z edge, both from 0. Failures name cells this way, with their x and z.
- **The stone** is `stone`, a `mark.sphere@1` ball (`params.size` = its diameter, centred on `at.pos`), its own true
  shape.
- **A rest** is `constraints: {rest: {owner: "stone", kind: "rest_on", on: "ground"}}`, every other field at its default:
  axis (0, −1, 0), contact true_shape, offset 0, max_drop 10. This is #2013's form.

| Fixture | `terrain` | Other items |
|---|---|---|
| The plate cell (criterion 1) | `height: "max(sign(position.x - 0.5), 0) * max(sign(-position.z - 0.5), 0)"`, `size: [2, 2]`, `spacing: 1`, `tile: 2`, `lod_levels: 1` | `stone` r 0.1 m at (0.5, 1.5, −0.5), and the rest |
| The 24 km plate (criterion 2) | `height: "10 * floor(position.x * 0.00048828125) + 5 * floor(position.z * 0.00048828125)"`, `size: [24000, 24000]`, `spacing: 30`, `tile: 2400`, `lod_levels: 1` | `stone` r 0.5 m at (7515, 20, −4485), and the rest |
| The 4,097 plate (criterion 2) | as the 24 km plate, with `size: [122910, 122910]` (4,097 × 30 m) | none |
| The twisted plate (oracle lane) | `height: "(position.x * position.z + position.x) * 0.125"`, `size: [4, 4]`, `spacing: 1`, `tile: 4`, `lod_levels: 1` | none |

### The drawn triangles: the `geometry` row

`{"call": "geometry", "doc", "items": ["ground"]}` answers a row for the plate, `{id, positions, indices, …}`, as it does
for every built item at the base. `positions` (`[x, y, z]` in the plate's space) and `indices` (three per triangle) are
the triangles the plate draws at full detail, every tile included. A `world` matrix on the row, if any, is applied;
the plate has no `at`, so it is the identity.

### The new call: `terrain_rays`

```json
{"call": "terrain_rays", "doc": "<doc>", "item": "ground", "rays": [{"from": [x, y, z], "dir": [dx, dy, dz]}, …]}
```

It answers:

```json
{"shape": {"kind": "heightfield", "samples": [nx, nz]} | null,
 "rays": [{"drawn": [x, y, z] | null, "physics": [x, y, z] | null, "pick": [x, y, z] | null}, …]}
```

Each ray gets one answer, in order, in world metres, evaluated at t = 0. A refusal is `{"code", "path"}`, as the
`geometry` call's are (for example `no_revision`). The tests send unit directions, all (0, −1, 0).

| Field | Meaning |
|---|---|
| `drawn` | The nearest point ahead of `from` where the ray meets the plate's drawn triangles, the ones the `geometry` row holds, on the CPU in f64. This is how #1976's hit path meets an item's evaluated triangles. |
| `physics` | The nearest point where the ray meets the plate's own physics height-field shape (Shape: `heightfield`, built from the plate's samples), asked through the physics backend interface's ray query on the pinned backend. |
| `pick` | The ground point a point control `{kind: point, on: "ground"}` writes for a press whose pointer ray is this ray: the ray met with the plate's height samples as the two triangles per sample quad that its height-field collision uses, nearest hit, rounded to 1/1024 m (Control: point). No camera, pointer or input track is involved. |
| `shape` | The plate's physics height-field shape as the plate builds it: `kind` and its sample counts along x and z. `null` for a plate with no collision. |

A null point means the ray meets nothing of that surface.

### The stone's place: `deep_query`

`{"call": "deep_query", "session", "doc", "paths": ["items/stone/at/pos"], "at": ["0s"]}`: `values[path][0]` is the
stone's evaluated place with rest_on applied. This is how #2013's suite reads its vase.

### The refusal

The show of the 4,097 plate answers `outcome: "refused"`. Among its `issues` is an error with:

- `code: "out_of_range"`;
- `ids` holding `"ground"`;
- `path` equal to `items/ground/params/terrain`, or below it;
- `actual`, an object holding `size` and `spacing` as the document writes them. The terrain block as written holds both.

The same refusal names the 24 km plate under the planted cap below.

### The planted programs (the scenario's `planted`, reachable only there)

The implementer adds them where the scenario's `planted` reaches the builder and the check, as #2013 added its own to
scene3d's `PLANTED`. An unknown name is `bad_input` at the base.

| Name | The wrong program | Criterion |
|---|---|---|
| `terrain_splits_other_diagonal` | The plate's builder splits every cell along the other diagonal from the one it ships with. Its physics shape, its picks and everything else stay as shipped. | `#2014.13d18756` |
| `terrain_cap_in_metres` | The plate's size cap reads the size in metres: a plate is refused when size > 4,096 m on a side, whatever its spacing. Everything else stays as shipped, the refusal's shape included. | `#2014.be2d6fcd` |

## Criteria to tests

IDs are `#2014.` and the first 8 hex digits of the SHA-256 of each criterion's text, as `scripts/proof-change.mjs`
computes them: `- [ ] ` dropped, trimmed, and whitespace collapsed. Every test's name starts with its ID. Each file's
header states its fixture, numbers and wrong programs in full.

| ID | File (tests) | What it asserts |
|---|---|---|
| `#2014.13d18756` | `ac1-one-surface.test.ts` (2) | See [Criterion 1](#criterion-1) |
| `#2014.be2d6fcd` | `ac2-size-cap.test.ts` (3) | See [Criterion 2](#criterion-2) |

### Criterion 1

The plate cell: nine samples at x, z ∈ {−1, 0, 1}. The field raises only the sample at (1, −1) to 1 m, so cell [1, 0]
(x 0 to 1, z −1 to 0) has corner heights 0, 0, 0 and 1 m. The other three cells are flat at 0. One process runs
`deep_show`, `geometry`, `terrain_rays` with the four rays straight down from y 2 through the cells' centres, and
`deep_query`.

- **The fixture.** The drawn mesh has a vertex at each of the nine samples, and the topmost there is at the field's
  height, within 1e-6 m. A vertex under it, such as a tile's skirt, is allowed.
- **One surface.** At every cell's centre, four readings lie on the ray within 1e-6 m of each other: the height of the
  drawn triangles over that point, and `drawn`, `physics` and `pick`. The centre of cell [1, 0] is at 0.5 m when the
  cell is split along the diagonal through its raised corner, and at 0 m when split along the other.
- **rest_on.** The stone keeps its written x and z (within 1e-6 m). Its centre is above the drawn surface, and its ball
  is within 1e-6 m of the drawn triangles, neither apart nor passing in. The ball rests at y 0.62247 on the first split
  (on the crease) and 0.17321 on the second (on the slope).
- **The planted `terrain_splits_other_diagonal`** (the second test). The same readings fail at exactly one cell, and the
  failure names cell [1, 0]. There, the drawn triangles and `drawn` are 0.5 m off `physics` (within 1e-6 m), while
  `pick` stays on `physics`. The fixture check still passes: the plant moves no sample.

### Criterion 2

- **The 24 km plate** (the first test): 801 × 801 samples. Terraces 2,048 m wide step 10 m along x and 5 m along z, from
  −90 m to 75 m. The sampled cell [650, 250] (x 7,500 to 7,530 m, z −4,500 to −4,470 m) and its eight neighbours lie
  flat at 15 m. The stone is written 5 m over its centre.
  - The show is presented with no error.
  - `shape` is `{kind: "heightfield", samples: [801, 801]}`.
  - The ray straight down from y 100 through the cell's centre meets `drawn` at (7515, 15, −4485) within 1e-6 m.
  - It meets `physics` within 1e-3 m of `drawn`.
  - The stone keeps its written x and z, and its lowest point is within 1e-6 m of `drawn`'s height.
- **The 4,097 plate** (the second test): the show is refused at check with the out_of_range error above, naming
  `ground`, the size [122910, 122910] and the spacing 30.
- **The planted `terrain_cap_in_metres`** (the third test): the 24 km plate's show isn't presented, and the refusal names
  it, its size [24000, 24000] and its spacing 30.

## The judges, and the sets they must fail

The tests compute these themselves. Each test first runs its judges on planted sets (`cellJudgesFailTheirPlants`,
`landJudgesFailTheirPlants` in `helpers.ts`), so a judge that passes everything can't pass a file. All of them were run
here and pass.

| Judge | Passes | Must fail |
|---|---|---|
| height of the drawn triangles over a point | 0.5 m at cell [1, 0]'s centre split through its raised corner, 0 split the other way | (it is the reference the others are held to) |
| the samples | the field's mesh | its mirror, the raised sample at (−1, 1): two samples off |
| the spread at each cell's centre | all four readings from one surface | drawn split one way, met split the other: one failure, naming cell [1, 0] alone |
| the stone on the drawn triangles | the ball touching the crease (y 0.5 + 0.1 √1.5) and the slope (y 0.1 √3) | 2e-6 m high (a gap); 2e-6 m low (passing in); the slope's place on the crease (centre under the surface); the lowest point on the centre's surface (0.042 m into the slope); 1e-5 m sideways (off its axis) |
| the stone on the terrace | the centre at 15.5 m | 2e-6 m high; left as written (20 m); on the ground plane (0.5 m); on the plate's bounds (75.5 m); 1e-5 m sideways |
| the refusal | out_of_range naming `ground`'s terrain with its size and spacing | the base's unknown_field at the same path with the same actual; a presented show; an actual without the spacing; an error naming another item |

## Wrong programs and traps

| Criterion | Wrong program | What catches it |
|---|---|---|
| 1 | the builder splits the cell along the other diagonal from the physics shape (planted) | the drawn centre is 0.5 m off; the spread judge names cell [1, 0] |
| 1 | the base's `plate@1` grid, which splits along (x0, z0)–(x1, z1), drawn over the upstream height field's default split, along (x0, z1)–(x1, z0) | the same: 0 m drawn against 0.5 m met at cell [1, 0] |
| 1 | a physics shape or a pick that reads the samples as a smooth or bilinear surface | the centre at 0.25 m |
| 1 | a `drawn` reading taken from another surface than the drawn triangles, or a pick from the drawn triangles | the planted test: `drawn` must move with the triangles and `pick` stay with the collision |
| 1 | rest_on onto the plate's bounds, onto the ground plane, onto the other split, or by the lowest point onto the surface under its centre | a gap, a centre under the surface, or 0.042 / 0.018 m into the slope |
| 1 | a plate placed by its corner, or with x and z swapped | a sample of the drawn mesh off the field's |
| 2 | a cap that refuses the 24 km plate, demands a chunk tree, or draws it with no collision | not presented, or `shape: null` |
| 2 | a physics shape made coarser, or in tiles of shapes | samples other than 801 × 801 |
| 2 | the 4,097-sample limit read as size ÷ spacing ≤ 4,097 | the 4,097 plate is presented |
| 2 | a refusal for another reason (the base's unknown_field), or one that doesn't name size and spacing | no out_of_range error carrying both |
| 2 | rest_on that leaves the stone where it was, or rests it on the ground plane or on the plate's bounds | its lowest point 4.5 m, 15 m or 60 m off the drawn surface |
| 2 | a cap read in metres (planted) | the 24 km plate is refused |

## Readings where the issue and design leave a choice

### The surface

- **The terrain plate's form.** `plate@1` with `params.terrain`, since the Fields come under "Builder plate: terrain"
  and the design's `plate` builder already takes a height field. No `cover`: no criterion reads it.
- **`height: field`** is an expression string over `position`, the form #2013's suite gave a density field. A
  `heightmap` needs an asset in the store, and no criterion asks for one.
- **Where the samples lie.** Centred on the plate's origin, as `plate@1 {grid}` centres its grid at the base and as the
  pinned upstream height field centres its samples. The fixture check fails a plate placed any other way, with a message
  naming the sample.
- **`tile` and `lod_levels`** are written though they aren't read. `lod_levels` has no default in the Fields. The value
  1 means full detail only; levels are #2017's.
  - `tile` is the whole plate on the small plates.
  - On the 24 km plate it is 2,400 m: 80 spacings, so 10 tiles a side.
  - The 4,097 plate keeps 2,400 m. It is refused for its size before its tiles matter.
- **"The drawn surface"** is the plate's triangles at full detail, read two ways: from the `geometry` row, which is what
  the build made, and by a ray (`terrain_rays`' `drawn`).
  - The geometry row of an 801 × 801 plate is about 641,000 vertices of JSON. So criterion 2 reads only the ray.
  - Criterion 1 holds the ray to the row on the correct program and under the plant.
- **"A physics ray's hit"** is `terrain_rays`' `physics`: a ray against the plate's own height-field shape.
  - The design gives a terrain plate collision ("Collision uses the physics height-field shape on the same samples";
    a chunk tree "draws and has no collision"). It doesn't say how a plate enters a world.
  - So no world is written. The call asks the plate's shape through the backend interface's ray query.
  - The design's ray probe, Check input: `physics.query`, reads a bake of a world. That needs a world and a bake that
    no criterion here names.
- **"A pick's ground point"** is `terrain_rays`' `pick`: the computation Control: point gives a ray on a terrain plate.
  The criterion reads the ground point on the plate. The control itself (a camera, a pointer and an entry on the input
  track) isn't asked for, and lands with the logic module.
- **`shape`** carries the shape's kind and sample counts, so "one plate with its physics height-field shape (801 × 801
  samples)" can be read.
- **The refusal's code** is `out_of_range`, the base's code for a param past its range.
  - "Naming size and spacing" is read as the error's `actual` holding both as written. The terrain block as written
    holds them, at the path `items/<plate>/params/terrain`.
  - The code is fixed because the base already refuses the block, as `unknown_field` with the same path and actual.
    A refusal for any reason would otherwise pass.
- **The planted names** are `terrain_splits_other_diagonal` and `terrain_cap_in_metres`.

### Criterion 1

- **Where the 1 m corner is.** The plate's +x −z corner, so one cell holds it and the other three are flat.
  - Under either split the plant moves only that cell's centre. So "naming the cell" picks it out of four.
  - It isn't the +x +z corner, which would leave the fixture symmetric in x and z, blind to a physics shape built with x
    and z swapped. Here such a shape raises (−1, 1) instead. Split as the upstream default, that puts 0.5 m at cell
    [0, 1]'s centre against 0 m drawn.
  - Split through the raised corner (the upstream height field's default for this cell) the centre is at 0.5 m. Split
    the other way (the base's `plate@1` grid, the upstream's zigzag) it is at 0 m.
- **"Agree within 1e-6 m"** is read pairwise. Every reading lies on the vertical ray through the centre within 1e-6 m,
  and their heights spread by at most 1e-6 m.
  - Every value read is a multiple of 1/1024 m. So the pick's rounding to 1/1024 m and a backend in f32 both resolve it
    exactly.
  - The rays start at y 2, just over the plate, so f32 distances along them stay short.
- **The item resting on it** is a ball of radius 0.1 m written over the centre.
  - Under neither split does a ball touch the surface at the centre: it rests on the crease or on the slope.
  - So "agree" for rest_on is read as the ball touching the drawn triangles, its gap between −1e-6 m and 1e-6 m, with its
    centre above them and its x and z as written.
- **"Fails, naming the cell"** is read as the test's own spread judge failing with one message, naming cell [1, 0]. The
  design names no product check that compares a drawn plate with its physics shape.
- **Under the plant**, `pick` is held to `physics`, since Control: point meets "the two triangles per sample quad that
  its height-field collision uses". `drawn` is held to the drawn triangles. rest_on isn't read under the plant: the
  design doesn't say whether a builder's true shape follows its drawn split.

### Criterion 2

- **"Builds as one plate with its physics height-field shape"**: the show is presented with no error; `shape` is one
  height field of 801 × 801 samples; and a ray meets both the drawn surface and the physics shape at the sampled cell.
- **"A sampled cell"** is cell [650, 250], chosen flat with its neighbours.
  - The stone's ball then touches straight under its centre, so "stands within 1e-6 m of the drawn surface" is its
    lowest point against `drawn`'s height there.
  - Its 15 m is neither the ground plane's 0 nor the plate's highest point, 75 m.
  - Terraces 2,048 m wide keep every sample exact: x × 2⁻¹¹ is exact for a whole number of metres, so no sample sits on
    a rounding edge.
- **The physics hit at the sampled cell** is held within 1e-3 m of `drawn`. The criterion gives the physics shape no
  bound at this size. A backend in f32 places points near 12 km to about 1e-3 m, and a shape at the wrong height or
  place misses by metres.
- **The 4,097 plate** is square at 30 m spacing, 122,910 m a side: the 24 km plate's spacing, with neither number equal
  to the cap's 4,096.

## Not tested

No criterion asks for these, so none is tested:

- **The plate:** `heightmap {sha256, range}` and its refusal from a URL; `heights: chunks@1` and a chunk tree past the cap.
  Also the plate at exactly 4,096 spacings a side, which would build 16.8 million samples.
- **Cover:** `cover` by fields of slope, height and noise, and its `projection`, `modify` and `albedo`.
- **Other fields:** `horizon`, overlays and `ground.registered`.
- **Siblings' work:** levels of detail by projected error, morphing, and normals from full detail (#2017); the
  geometry audit and height queries, which the Scope names as sharers of the one surface but no criterion reads.
- **Budgets and timings.** #2017 owns the task's.

## What the implementer adds outside this folder

- The `alone` line in `scripts/lanes.mjs` above.
- The two planted names, reachable through the scenario's `planted`.
- In `deep-show`: the `terrain_rays` call, and a `geometry` row for a terrain plate.
- Nothing else is asked of the surface. `deep_query`'s place with constraints applied is #2013's.
