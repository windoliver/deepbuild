# Acceptance tests for #2015: a recipe repeat over a part's elements

Written first, from issue #2015 ("Geometry measures and repeats over elements: convexity, edge angle, face area,
islands and baked occlusion as attributes, and a recipe repeat over a part's elements": its scope, its Fields block
Recipe: repeat over elements, its one acceptance criterion, its proof line and its oracle page), the design sections
it names and those they lean on, and base commit `75f3eed4f` ("design(#2015): a repeat's part names an ID input and
a part, as along names a curve input"), by a job that never saw an implementation; none existed. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

The geometry measures (convexity, edge angle, face area, islands, baked occlusion) have no criterion of their own,
so nothing here tests them.

What was read:

- `docs/canvas-primitives.md`: Recipe (3280: steps with `op`, `kind`, `params: {k → literal | expression}`, `at`,
  `repeat`; "Expanded at check time, never per frame, into derived items `<instance>.<step>[.<index>]` … seeds come
  from (instance, step, index)"); Recipe: repeat over elements (3303: `repeat: {each: {part: named part, domain:
  face | point | curve}, as}`; per element `i`, `center: vec3, m`, `normal`, `area`, `size`; "`part` is
  `<input>#<part>`, such as `ground#top`: an `ID` input of the recipe that holds a builder item of the same
  document, as `along` takes an input that holds a curve … the step reads each element `e` of it under `as` as
  `e.i`, `e.center` … A face is a face of the builder's polygon view, so a grid plate's faces are its cells, x
  fastest, then z … Seeds come from (instance, step, element index), so adding a face never reseeds the others";
  at most 1,024 per repeat); Builder (2909: `plate {outline | grid: [u16, u16] with size: [m, m]; …}`, named parts);
  Pack (3320); ID and sub-address (395: derived IDs; "a recipe step's [seed is] of (instance seed, step, index)");
  the path grammar's sub-address (43: "a builder's anchor or named part (`plank.01#near`)"); Units and axes (metres,
  +Y up).
- `docs/technical-design.md`: Builder (1187), Recipe (1201), Modeling steps (1406: "a repeat over a part's
  elements … All run at build or check time, with counts known from params"); Dogfooding and the parity suite
  (2652, 2672: "a planted-fault twin for every fixture", expected values set outside the implementation); Tests
  written first (2683).
- The oracle page: the only upstream test is Blender's For Each Element zone goldens
  (`tests/files/modeling/geometry_nodes/foreach_geometry_element_zone`), which need Blender, so none runs on our
  output; "Reseeding no other element when a face is added is ours." The method is ported, not the data: one
  iteration per element of a geometry's domain, each reading that element's own values.
- At the base, for call shapes and conventions only: AGENTS.md; `tests/acceptance/306/` (packs as fixtures, the
  scenario's `packs`, recipe instances, `deep_show`, the reply's `expansions` with per-instance `derived` and
  `seeds`, `planted`); `tests/acceptance/440/` (a scene3d suite: the `full` build once per file, `sceneDoc`, the
  `geometry` call, parity fixtures with twins); `crates/deep-show` (`run`, `planted`, `expansions`, `geometry`);
  `crates/deep-canvas/src/document/packs.rs` (how a pack, a recipe and an `along` repeat naming an `ID` input that
  holds a `curve@1` item are written); `crates/deep-canvas-scene3d/src/builders.rs` and `spec.rs` (that `plate@1`
  and `mark.box@1` exist, and their params).

## What the base does and lacks

At the base `deep-show run` installs packs from the scenario's `packs`, expands recipe instances at check into
`<instance>.<step>.<index>` with seeds from (instance, step, index), answers `expansions`, presents scene3d
documents, builds `plate@1` grids with a part `top`, and answers `geometry` rows with `positions`. Its pack check
accepts a repeat only as `{count, as}` or `{along, count | spacing, as}` and refuses any other key ("over, on and
pack land later"), so `repeat.each` is refused, the test pack doesn't install, and the document naming it is
refused. Neither planted value below exists. `BASE-FAILURE.txt` says how each test is expected to fail there; the
suite was not run at the base, since the surface plainly doesn't exist.

## Run them

The file builds `deep-show` in the `full` set (`cargo build --locked --bin deep-show --no-default-features
--features full`, honouring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless
set), once, copies it to a temporary folder, and fails each test if the build failed. `scripts/lanes.mjs` may need
`'tests/acceptance/2015/'` added to its `alone` list (the one-at-a-time unit-lane line), as #440's is; this README
is the instruction, and the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2015 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2015/tsconfig.json
```

Each test writes its scenario's evidence store into its own temporary folder and deletes it. Node built-ins and
vitest only. A run with `--root tests/acceptance/2015` leaves Vitest's cache in
`tests/acceptance/2015/node_modules/.vite`; delete it. Everything is CPU only; no criterion has a time budget.

## The surface under test

Everything #306's, #420's and #440's READMEs define for `deep-show run` holds unchanged: the scenario (`evidence`,
`sessions`, `processes`, `panels`, `docs`, `packs: [{id, dir}]`, `planted`, `calls`), `deep_show` with `document`
and `include: ["issues"]` and its reply (`outcome`, `issues`, `notices`, `expansions`), and `geometry` (`{call, doc,
items, t}` → `items: [{id, positions, …}]`). What this suite adds is the recipe field the issue names and two
planted values. No new call, reply field or binary.

### The recipe (fixtures/packs/test-lots-1.0.0/lots.post@1.json)

```json
{"inputs": {"ground": {"type": "ID"}},
 "steps": {"post": {"op": "mark", "kind": "mark.box@1",
   "repeat": {"each": {"part": "ground#top", "domain": "face"}, "as": "e"},
   "params": {"size": [0.2, 0.5, 0.2], "paint": {"fill": {"role": "muted"}}},
   "at": {"pos": "e.center"}}}}
```

The instance is `{"id": "lot", "kind": "lots.post@1", "params": {"ground": "plot"}, "at": {"pos": [0, 0, 0]}}` in
a scene document whose `packs` is `["test/lots@1.0.0"]`, beside `{"id": "plot", "kind": "plate@1", "params":
{"grid": [3, 2], "size": [3, 2]}}`.

### Reply fields read

- `deep_show`: `outcome` (`presented`), `issues` (no error), `notices` (no `unknown_kind`), and the `expansions` row
  whose `instance` is `lot`: `derived` (derived ID → item; each item's `kind` and `at.pos`) and `seeds` (derived ID
  → string, read only through sameness and difference).
- `geometry` on `plot`: `items[].positions`, the plate's built positions, read only for its extent.

### `planted` values added (scenario field, each reachable only through it)

| Value | The wrong program | Must fail |
|---|---|---|
| `each_seeds_by_element_count` | a derived item's seed hashes the part's element count with (instance, step, element index), so adding faces reseeds every element | the reseed check, naming `lot.post.0` |
| `each_face_per_triangle` | the repeat walks the part's triangles, not its polygon view's faces, so each grid cell makes two derived steps | the face check, naming `12 derived items for 6 faces` |

## Fixtures

| Fixture | What it is |
|---|---|
| `packs/test-lots-1.0.0/` | Pack `test/lots@1.0.0` (`requires.modules: {scene3d}`), recipe `lots.post@1` above |
| `parity/recipe/repeat-plate-faces.scene` | The two revisions (the 3 x 2 plate of 1 m cells, then 3 x 3), each with its expected derived IDs and its cells `[i, j]` in index order, x fastest then z; the six IDs that must keep their seeds; the 1e-9 m tolerance; and the two twins with the check each must fail and the names its failure must carry |

## Criteria to tests

| ID | Criterion | Tests (count), what each asserts |
|---|---|---|
| AC1 | A repeat over a plate's faces makes one derived step per face, and adding a face reseeds no other | `faces.test.ts` (3): in one process, revision 0 (3 x 2 plate) and revision 1 of the same document (the plate with one more row, 3 x 3) are both presented with no error; in each, `lot` expands into exactly `lot.post.0` … `lot.post.5`, then `lot.post.0` … `lot.post.8`, each a `mark.box@1` whose `at.pos` is its face's cell centre within 1e-9 m (x fastest, then z, over the plate's built extent), each with its own seed (`faceFailures`); `lot.post.0` … `lot.post.5` keep their seeds in revision 1 (`reseedFailures`). `each_seeds_by_element_count` fails the reseed check naming `lot.post.0`; `each_face_per_triangle` fails the face check naming `12 derived items for 6 faces`. Wrong programs also caught: faces z fastest, a skipped or duplicated face, centres at a cell's corner, one seed for every face |

## Readings where the issue and design leave a choice

- **"Adding a face" on a grid plate** is one more row of cells: faces are numbered x fastest, then z, so a new row
  takes the indices after the old ones (6, 7, 8) and keeps every existing face's index, which is what "seeds from
  (instance, step, element index)" can keep. A new column would renumber every face past the first row, and the
  design's seed rule promises nothing for that. A grid's smallest such addition is a row, so three faces are added,
  not one.
- **Where a grid plate stands about its origin** isn't in the design. The expected centres take the design's cell
  rule (cell `[i, j]`'s centre is (i + ½, j + ½) cell sizes from the plate's least corner, on its top) over the
  plate's own extent from its built positions, guarded to be flat and to span its `size`; nothing else is read from
  the build.
- **`e.center`'s frame**: the plate and the instance both stand at the world origin with no rotation, so the plate's
  item space, the instance's and the world coincide, and a derived item's `at.pos` is its face's centre whichever of
  them `e.center` is in. `"pos": "e.center"` writes the vec3 whole, as the design names `e.center` a `vec3`.
- **"One derived step per face"** is one derived item `<instance>.<step>.<index>` per face, its index the face's
  `e.i`, nothing more and nothing less.
- **"Reseeds no other"** is read on the `seeds` row by sameness, as #306 reads seeds; each face having a seed of its
  own (no two alike in one expansion) is read too, since seeds come from the element index.
- **The `ID` input's name differs from the item's ID** (`ground` holds `plot`), so the part's prefix resolves
  through the recipe's input, not as an item ID.

## Not tested, because no criterion asks

The geometry measures (convexity, edge angle, face area, islands, baked occlusion); `domain: point | curve`;
`e.normal`, `e.area`, `e.size` and `e.<attribute>`; refusals of an input holding no builder item or a part the
builder lacks; the 1,024 cap; nesting past 4; reading another document; an outline plate; draws and pixels.
