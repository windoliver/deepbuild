# Acceptance tests for #420: 3D scenes — scenes as data, builders, recipes, modifiers, particles and mesh edges

Written first, from issue #420 (its scope, its Fields blocks — Object, Builder, Marks in 3D: mesh edges, Building
module, Modifier, Particles `particles@1` — its nine acceptance criteria and its proof line), the design sections it
links and those they lean on, its oracle page, and base commit `960045da` ("Merge pull request #1027 …"), by a job
that never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- Issue #420 and its oracle page (`doneright/oracles/issues/420.md` in `DeepBuildAI/deepbuild`, branch `doneright`):
  upstream tests for 3 of 9 criteria (Blender's modifier stack, split-faces and primitive goldens, which need
  Blender; Godot's `tests/scene/test_primitives.cpp`; Unreal's MeshDescriptionTests prism counts), none runnable on
  our output as they are. Ported here where they fit a criterion and our surface: Godot's box (exactly six distinct
  face normals) and cylinder (side points at the radius, cap points at the ends) and Unreal's prism triangle count,
  all under AC5 (`watertight.test.ts`). Blender's cases are not ported (no Blender runner; the parity design makes
  that lane BLOCKED, never must-pass).
- `docs/technical-design.md`: Scenes, physics and the canvas core (634: `frame(t) = eval(doc, t)`; objects, data
  kinds, modifiers "pure … whether it reads time is computed from its params", "a suspicious order is flagged,
  never silently reordered"; building kinds; one-shot scenes, "stateless particles"); Canvas modules (1058); Dirty
  classes and content key (1492: epochs never enter a key, "A move uploads one instance record and never rebuilds a
  mesh"); the parity suite (2543: our own documents, "a planted-fault twin for every fixture", "CPU references …
  stay reviewed test code", expected values set outside the implementation); Dogfooding (2523); Tests written first
  (2554).
- `docs/canvas-primitives.md`: Units and axes (28: meters, +Y up, degrees; literals); The path grammar (37); Item
  and kind (320: `kind` as `slab@1`; the kind's `schema` with `cost: transform | rebuild` and `dirty: {path → dirty
  class}`); Builders, recipes, looks and cameras (2764); Object (2770); Builder (2862: the ten builders, the
  `build(…) → {positions, normals, uv0, indices, attributes, parts, anchors, values, true_shape, bounds}` shape, "a
  vertex count computable from params … so an over-budget build is refused before it runs"); Builder `ball`:
  tessellation (2890: "3 × faces × (detail + 1)²", 540 at icosa detail 2 against 561 for a 32 × 16 UV ball);
  Builder `hull` (2908); Builder `extrude`: sweep along a curve (2926: "on a closed curve … welds its seam");
  Builder: shading (2963: "flat gives each face its own normal … at most three per triangle"); Curve `curve@1`
  (3107); Building module (3209); Recipe (3230: "repeats have counts fixed at check"); Pack (3262); Modifier (3683)
  and Modifier: store (3700); Marks in 3D: mesh edges (4592); Particles `particles@1` (4811).
- The dependency issues as the base holds them: #377 (the GPU layer, `deep-gpu`, the noop lane, fences), #378
  (scene3d marks, `view3d`, the object-ID target), #379 (the meter, `live`, `test-meter`, `test.texture@1`), #380
  (shipped effects, `particles@1`, `view3d`'s `from`), #387 (the scheduler, `eval`, content keys, `clean`), #200
  (registries; `builder@1` and `modifier@1` declared with planted entries), #306 (packs and recipe expansion).
- At the base: AGENTS.md; `crates/deep-canvas-scene3d` (`module.rs`: scene3d's kinds `mark.*@1`, `light.sun@1`, the
  `scene3d.stack` operator; `modifiers.rs`: #411's subdivide, array and mirror on `mark.box@1`); `crates/deep-show`
  (`run` and its calls: `deep_show`, `eval`, `frames`, `registry`, `install_pack`, `packs`, `revisions`; the
  scenario's `planted`); `crates/deep-gpu-layer` (`main.rs`'s calls and `--planted` table, `view3d.rs`, `live.rs`,
  `testgpu.rs`); `crates/deep-canvas` (the time grammar: seconds are decimals that are whole flicks);
  `crates/deep-canvas-effects`; and the suites `tests/acceptance/377`, `378`, `379`, `380`, `387`, `411`, `306`,
  `200`, whose helpers these follow.

## What the base already does, which these tests don't credit

`deep-show run` presents scene3d documents and evaluates them with `eval` (nodes, keys, results, `ran | hit |
kept`); `mark.box@1` takes a modifier stack (`mod.subdivide@1`, `mod.array@1`, `mod.mirror@1`, #411); packs install
and recipes expand at check (#306), and #306 already says repeat counts are fixed at check. `deep-gpu` draws scene3d
documents with `view3d` (`from` seeks, #380), draws `particles@1` with ballistic motion, and runs `live` with the
meter's memory report and #379's `test.texture@1`. There are no builders: `slab@1`, `lathe@1` and the rest are
skipped with the notice `unknown_kind` ("not registered in this build; the item is skipped"), as are `curve@1` and
every `arch.*` kind; there is no building module, no `geometry` or `kinds` call (a scenario holding either is
`bad_input`), no `edges` on `mark.line@1`, no `segments` count, no `hold` event, no `fences`, `binds` or `errors`
report on `live`, and none of the planted names below. So the tests define the surface below.

## Run them

They build cargo binaries (`deep-show` in the `full` set, `deep-gpu`, and `deep-gpu` with `test-meter`), as #378's,
#379's and #387's suites do, so they run one file at a time. `scripts/lanes.mjs` needs `'tests/acceptance/420/'`
added to its `alone` list (the one-at-a-time unit-lane line, which also takes the folder off the parallel line),
beside `tests/acceptance/378/`. This README is the instruction; the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/420 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/420/tsconfig.json
```

Each file first builds the binaries it uses, once (`cargo build --locked --bin deep-show --no-default-features
--features full`, `cargo build --locked --bin deep-gpu [--features test-meter]`, honoring `CARGO_TARGET_DIR`, with
`CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set), copies each out under its own name in a
temporary folder, and fails each test that uses a build that failed. Each test writes into its own temporary folder
(evidence store, outputs, generated documents) and deletes it. Node built-ins and vitest only. A run with `--root
tests/acceptance/420` leaves Vitest's cache in `tests/acceptance/420/node_modules/.vite`; delete it.
`BASE-FAILURE.txt` is the run at the base, on this Mac: 29 of 34 tests fail, each for a missing surface (`bad_input`
for a scenario holding `geometry` or `kinds`, an unknown `--planted` name or `live` event, no `segments` on
`view3d`, `module_missing` for `building`, a channel into a skipped slab's modifier that "reaches nothing"). Five pass
there: AC5's fixture check (it reads only the fixture and the closed forms) and AC1's four seek-against-play tests,
because the base already draws `particles@1` as a closed form (#380) and seeks equal to plays; AC1's planted mutant
fails at the base, since the base has no `particles_integrate`. These tests don't credit that work to this issue.

The CPU tests (AC2, AC3, AC4, AC5, AC8, AC9, and AC6's counts on wgpu's noop backend) run anywhere. The tests that
read pixels or fences (AC1, AC6's depth half, AC7) draw with the GPU layer on Metal, headless, as #377's–#380's do:
off macOS, and wherever the binary answers `unsupported_platform`, they fail with a message starting
`INCONCLUSIVE:`; they never pass there. No test is gated on power, load or a reference Mac: no criterion here has a
time budget.

## The surface under test

The issue names builders, building kinds, recipes, modifiers, flat shading, particles, mesh edges, the parity
fixture, the release fence and planted programs, but no code API. These tests define the smallest surface they need
on the two binaries that exist: **two new calls on `deep-show run`** (`geometry`, `kinds`), **one new field per frame
on `deep-gpu`'s `view3d`** (`segments`), **one new event and three new reports on `deep-gpu`'s `live`**, and planted
names on both. Everything #393's, #305's, #306's, #387's and #411's READMEs define for `deep-show run`, and #377's,
#378's, #379's and #380's for `deep-gpu run`, holds unchanged. No new binary. Every name below the issue doesn't
give is this job's invention.

### Documents

- Builders are item kinds named as the design names them (Item and kind: "`slab@1`"): `slab@1`, `lathe@1`,
  `extrude@1`, `tube@1`, `ball@1`, `coil@1`, `plate@1`, `display@1`, with the Builder block's params, and `shade:
  smooth | flat` on every one (Builder: shading); `ball@1` also takes `tessellation`, `base`, `detail` (Builder
  `ball`: tessellation). They are scene3d's kinds (the registry's `kinds` maps them to `scene3d`). `curve@1`
  (Curve `curve@1`: `points`, `mode`, `closed`) is scene3d's too. An outline is `[[x, y], …]` in metres; a lathe
  outline is `[[r, y, smooth], …]`; a tube's `path` is points or a curve's ID.
- The building kinds `arch.wall@1`, `arch.opening@1`, `arch.slab@1`, `arch.roof@1`, `arch.stair@1`, `arch.zone@1`,
  `arch.level@1`, `arch.guard_rail@1` (Building module) are the canvas module `building`'s; documents that use them
  name `requires.modules: {building: "^1"}`. Plan coordinates `[x, y]` (a wall's `a` and `b`, a slab's outline, a
  stair's `well`) are the document's world x and z. A slab's `holes` take a polygon or an item ID (`"stair"`), whose
  `well` it reads. An opening is its wall's child (`parent`) and names it (`wall`); its frame, sill and glass are its
  own geometry, and the hole it cuts (with its reveals) is the wall's.
- A modifier is `{"kind": "mod.<name>@1", "params": {…}, "enabled"?: true}` in an item's `modifiers`, applied top to
  bottom. `mod.array@1 {count, offset}` makes copies k = 0 … count − 1, the k-th moved by k × offset;
  `mod.mirror@1 {axes}` keeps the mesh and adds its reflection across the item's own plane through its origin (x = 0
  for `"x"`); `mod.curve_deform@1 {path: curve ID, axis}` bends the item along the curve. A channel may bind a
  modifier's param by path (`items/<id>/modifiers/<k>/params/offset/0`); the modifier then reads time.
- `particles@1` takes the Particles block's fields; `motion` is one of `{ballistic: {v0, gravity, drag}}`, `{along:
  {curve, speed}}`, `{orbit: {axis, rate}}`, `{drift: {amplitude, frequency}}`.
- `mark.line@1` takes `edges: {of: ID[#part], kind: all | quads | cage}` in place of `points` (Marks in 3D: mesh
  edges).
- Documents reach `deep-show` as an agent sends them (`deep_show` from session `sess-alpha`: no `id`, no `layers`),
  and `deep-gpu` as a session holds them (#378: `id`, one writer layer, every item's `layer`), except `live`, which
  takes the agent's shape (#379). A revision that differs from the last only at one path is how these tests change
  that path, as #387's suite does (`deep_show` of whole revisions; an item dropped is named in `removes`).

### `deep-show run`: the `geometry` call

```json
{"call": "geometry", "doc": doc ID, "items"?: [ID], "t"?: time = "0s",
 "stage"?: "final" | "built" = "final", "estimate_only"?: false}
```

Evaluates the document's current revision at `t` and answers, for each item named (every item with geometry when
`items` is absent; derived items of a recipe by their derived IDs, `tree.crown`):

```json
{"builds": n,
 "items": [{"id", "kind", "declared": {"vertices": n}, "key": content key,
            "positions"?: [[x, y, z]], "normals"?: [[x, y, z]], "indices"?: [u32],
            "closed"?: {part name → {"triangles": [triangle index], "genus": g}},
            "attributes"?: {name → {"domain", "type", "values"}},
            "outputs"?: {name → value}, "stack"?: [StackRow]}]}
StackRow = {"kind": "mod.<name>@1", "class": "deform" | "generate", "reads_time": bool, "enabled": bool}
```

- `positions`, `normals` and `indices` are the item's built mesh in its own space (before `at`): at `stage: final`
  after its modifier stack, at `stage: built` the builder's output alone. Triangle t is `indices[3t … 3t + 2]`,
  wound counter-clockwise seen from outside.
- `declared.vertices` is the vertex count the builder computes from its params (after the stack at `final`), the
  count the check estimates before any build. With `estimate_only: true` nothing is built (`builds: 0`) and each
  item carries only `id`, `kind`, `declared` and `key`.
- `closed` lists the builder's closed parts: each a set of triangles that should form a closed surface, with the
  genus g the builder computes from its params (0 for a box or a ball; 1 for a torus, a tube on a closed path, an
  extrude with one hole). An open builder (`plate@1`) has none.
- `outputs`: a building kind's outputs (Building module): a stair's `risers` (a count) and `well` (`[[x, y], …]` in
  plan coordinates), a zone's `area`, a wall's `mitres`.
- `stack`: the item's modifiers, top to bottom, each with its kind's class and whether it reads time (computed from
  its kind and its bound params).
- `key`: the content key of the item's final geometry (#387's 32 lowercase hex).
- `builds`: how many builder runs this call made.

### `deep-show run`: the `kinds` call, and `registry`

`{"call": "kinds"}` answers `{"kinds": [KindRow]}`, one row per kind the build registers:

```json
KindRow = {"kind", "module": canvas module | "core",
           "params": {name → {"type", "unit", "default", "min"?, "max"?, "live": bool, "cost": "transform" | "rebuild"}},
           "dirty": {path → "transform" | "geometry" | "shading" | "presence" | "text" | "reading" | "time"},
           "reads"?: ["siblings" | "children" | "refs"],
           "fixture": {"document": Document, "item": ID} | null,
           "sweep": {path → [from, to]}}
```

- Paths are relative to the item (`params/size`, `params/outline/0`), in the path grammar.
- `reads`: what a building kind declares it reads (Building module: "Each declares `reads: siblings | children |
  refs`").
- `fixture`: a document as an agent sends it holding one item of the kind (`item`), presentable as it is.
- `sweep`: for every path of the kind's dirty map, and at least one path in or under every param of its schema, two
  valid values, different, such that the fixture with the path at `from` and at `to` evaluates to a different
  result in at least one node.
- `registry` keeps #411's `kinds: {kind → canvas module}`, listing the same scene3d and building kinds.

### `deep-show run`: scenario `planted` values added (each reachable only there)

| Value | The wrong program | Criterion |
|---|---|---|
| `torus_genus_0` | `lathe@1` reports genus 0 for a closed outline: the torus is declared with genus 0 | AC5 (issue-named) |
| `vertex_count_off_by_one` | `slab@1` declares one vertex fewer than it builds | AC5 (a twin) |
| `cap_left_open` | `lathe@1` leaves its top flat cap out, declaring one cap's vertices fewer, and still reports the part closed | AC5 (a twin) |
| `ball_scaled` | `ball@1` with `tessellation: geodesic` builds at 1.01 × its radius | AC5 (a twin) |
| `flat_as_smooth` | `shade: flat` builds the smooth mesh: shared vertices with averaged normals | AC4 (a mutant) |
| `slab_size_as_shading` | `slab@1`'s dirty map gives `params/size`, a rebuild-class param, the class `shading` | AC8 (issue-named) |
| `keeps_disabled_refs` | an item's content key and read set keep a disabled modifier's references | AC9 (issue-named) |

### `deep-gpu run`: `view3d` gains `segments`

With `counts: true` (#378), each frame adds `"segments": {item ID → [[[x, y, z], [x, y, z]], …]}`: for every
`mark.line@1` with `edges`, each segment it drew in that frame, by its two ends in world metres. It is reported on
the noop backend too.

### `deep-gpu run`: `live` gains `hold`, `fences`, `binds` and `errors` (`test-meter` build)

- Event `{"frame": k, "hold": {"session", "until": k2}}` (a fault fixture, as #378's `latency`): that session's GPU
  work for frame k is submitted as usual and its `gpu_done` withheld until frame k2 has been presented, so frame k
  is in flight while frames k + 1 … k2 latch and draw.
- `report: ["fences"]`: the reply adds `fences: [{"seq", "event": "submit" | "gpu_done" | "present" | "release",
  "session"?, "frame"?, "resource"?, "bytes"?}]`, in one order, `seq` rising: `submit` (frame k's command buffers
  submitted), `gpu_done` (frame k's fence signalled), `present` (frame k presented), `release` (a resource's memory
  handed back to the device; `resource` is its name, a cached result's being its content key as the meter's
  `results` list it, with its `bytes`).
- `report: ["binds"]`: each frame's `views[]` row adds `binds: [resource name]`, every cached result its frame's
  draws bound.
- `report: ["errors"]`: the reply adds `errors: [{"frame", "session", "code", "resource"?, "message"}]`, every error
  the device's uncaptured-error callback reported during the call: `code` `destroyed_resource` for a destroyed
  resource used by a submitted frame (with `resource` the resource's name), `validation` for any other.
- With `report: ["memory"]` (#379), the meter counts a result's memory against its writer until the memory is
  released, while `results` lists only results a current or pending revision reads.

### `deep-gpu run --planted <name>` names added (each reachable only there)

| Name | The wrong program | Criterion |
|---|---|---|
| `particles_integrate` | The particles compute operator steps each particle from the previous frame's state | AC1 (a mutant) |
| `edges_unwelded` | Mesh edges are read from the unwelded mesh: each face's four edges draw on their own | AC6 (issue-named) |
| `edges_skip_depth` | Mesh edges draw without the depth test | AC6 (issue-named) |
| `releases_at_revision` | The result cache releases a result's memory when a revision drops its last reader | AC7 (issue-named) |

## Fixtures

| Fixture | What it is | Read by |
|---|---|---|
| `look.json` | #380's acceptance look (the clean look's status map and fonts, near-black ground, one role per fixture color, tone map none at scale 1, finish at identity, no deband, bloom and ground grid off) | AC1, AC6, AC7 |
| `parity/geometry/watertight-builders.scene` | The issue's parity fixture (JSON): fifteen builder cases (slab box and plank; lathe cylinder, cone, square-section torus; geodesic octahedron and icosahedron; UV ball 32; geodesic icosa detail 2; extrude block and block with one hole; tube on a straight path and on a closed octagon curve; coil; plate), each with its genera, its closed-form area and volume and the formula they come from (or the design's vertex count), and four twins, each a planted builder and the case it must fail | AC5 |
| `packs/test-lowpoly-1.0.0/` | `test/lowpoly@1.0.0` (requires scene3d), recipe `lowpoly.tree@1`: a six-sided lathe trunk and a geodesic icosa crown at detail 1, both `shade: flat` | AC4 |
| `packs/test-rows-1.0.0/` | `test/rows@1.0.0` (requires building), recipe `rows.fence@1`: `repeat: {count: "n"}` of `arch.wall@1` | AC3 (control) |
| `packs/test-timedrows-1.0.0/`, `packs/test-openrows-1.0.0/` | the same fence with `repeat: {count: "floor(t * 10)"}`, and with `repeat: {as: "i"}` alone | AC3 |

The other documents are generated in the test files and `helpers.ts`.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the
leading `- [ ] ` dropped (#607's command, as #305's README gives it, with the issue's nine criterion lines on stdin).
Each test's name starts with `AC<n> #420.<id>`. Where a criterion names a wrong program, the test runs it through
`planted` or `--planted` and asserts it fails the way the criterion says, naming what it says; where it names none,
a planted mutant shows the check can fail.

| ID | Criterion | Tests, what each asserts, and the wrong programs |
|---|---|---|
| AC1 `#420.822cf410` | Particles seeked to a time equal particles played to it, on the same machine's pixel hash | `particles.test.ts` (5): for ballistic (dot), along a curve (streak), orbit (spark) and drift (puff), 121 frames at 60 fps played, and fresh processes seeking to 17, 45, 90, 120: each sought hash equals the played one, a second play equals the first at 120, the four frames differ, and each differs from the document without particles. `--planted particles_integrate` fails, naming the motion and the frame. Wrong programs: particles integrated frame to frame; a frame drawn for another time; particles that draw nothing |
| AC2 `#420.0fd522a3` | Modifiers apply in their declared order, each pure in its params and time; one that doesn't read time never rebuilds while playing, and a reorder is a recorded change | `modifiers.test.ts` (4): array-then-mirror and mirror-then-array on a 1 m slab each equal this suite's own composition of the built box (the two differ), stack rows `generate`, not reading time; two processes give one geometry and key; an array whose offset a channel moves reads time, and at 1 s sought equals played and equals the box and its copy 1 m along x; over 26 frames in 1 s no node of the static stack's item runs after frame 0 while the moving one's run every frame; a revision that only reorders lists the item as `changed`, makes a new current revision with another hash, and the geometry follows. Wrong programs: a stack sorted by class or run in another order; a modifier keyed by a clock or a counter; a static stack rebuilt each frame; a reorder dropped as unchanged |
| AC3 `#420.1aa64c41` | Walls, openings, slabs, roofs and stairs build from the building module, each declaring what it reads, and a recipe repeat without a fixed count is refused | `building.test.ts` (5): the five kinds are `building`'s and declare `reads` (a wall ⊇ siblings, children; an opening and a slab ⊇ refs); the house builds each as a closed mesh it declares; wa mitres to x = 4.1 beside wb and ends at 4 without it; the door takes 0.9 × 2.1 × 0.2 m³ out of wa; the floor's volume is its outline less the stair's well times 0.2 m; 15 risers of at most 0.18 m; the roof's pitch leaves wa's and the floor's keys while removing wb changes wa's. Packs: the counted fence installs and expands four walls; the t-counted and count-less fences are refused, naming the recipe and `post`; a channel on the count's input is refused, naming `items/f1/params/n`. Wrong programs: building kinds outside the module or with undeclared reads; a wall that ignores its neighbour or child; a repeat whose count isn't fixed at check |
| AC4 `#420.fc311e1d` | A flat-shaded low-poly tree builds one normal per face and at most three vertices per triangle, counted before it builds | `flat-tree.test.ts` (2): `estimate_only` builds nothing and declares each part's count, the crown's 240 (3 × 20 × 2²); the build makes exactly that many, three per triangle, no vertex shared, every vertex normal its triangle's outward normal. `--planted flat_as_smooth` fails, naming `tree.crown`. Wrong programs: smooth normals under flat; a count known only after the build |
| AC5 `#420.adbf19b6` | Every builder's declared vertex count equals what it builds, every closed builder is watertight (…), and areas and volumes match closed forms to 1e-6 relative, on parity fixtures with planted-fault twins, among them a torus declared with genus 0 (parity/geometry/watertight-builders.scene) | `watertight.test.ts` (7): the fixture holds the issue's cases and genera, the torus twin, and closed forms equal to their formulas; every case: declared = built (and = `estimate_only`, which builds nothing), 561 for the UV ball and 540 for geodesic detail 2, no open, non-manifold or same-way edge on welded positions, V − E + F = 2 − 2g per closed part with the builder's g, the genera the fixture gives, area and volume to 1e-6; ported Godot and Unreal checks (six box normals; cylinder and tube points on the side or caps; 60–64 triangles for a 16-sided prism); each twin (`torus_genus_0`, `vertex_count_off_by_one`, `cap_left_open`, `ball_scaled`) fails its case, naming it. Wrong programs: a count from the built mesh; an open seam or cap; a torus declared genus 0; a mesh off its closed form |
| AC6 `#420.2e5e696d` | On a 1 m slab box, a `mark.line` with `edges` of kind `quads` draws 12 segments and of kind `all` 18 (…); a planted reader that skips welding draws 24 (…) and one that skips the depth test draws the 3 hidden edges and fails, naming them | `edges.test.ts` (4): on noop, quads draws the box's 12 unit edges once each between 8 corners and all those 12 plus six √2 face diagonals, 18; `--planted edges_unwelded` draws 24 and fails the count; on Metal, in a three-quarter perspective view, the 9 edges away from the farthest corner are the line's pixels in the ID target at every sample from 15% to 85%, 3 ± 1.5 px across, and the 3 at it show no line pixel near any sample clear of the visible edges; `--planted edges_skip_depth` fails, naming each hidden edge by its corners. Wrong programs: unwelded edges; no depth test; a depth test that hides an edge's own faces' edges |
| AC7 `#420.c4a5924c` | A revision that removes the last item sampling a 2,048 px texture lands while a frame that samples it is still in flight (…); a planted cache that releases at the revision raises a destroyed-resource error on the in-flight frame and fails, naming the texture | `release.test.ts` (2): one shared texture key of at least 22,369,620 B; bound and listed in frames 1–5, neither in 6–9; frame 5's `gpu_done` after frame 7's present; one release of the key, after that `gpu_done`, with its bytes; the meter's count holds it at frames 6–7 and drops by exactly its bytes at frame 8; no error, no missing frame. `--planted releases_at_revision` raises `destroyed_resource` on frame 5 naming the key and fails, naming it. Wrong programs: release at the revision; a result kept in the cache after its last reader; a next frame that still binds it |
| AC8 `#420.34e8fe7a` | For every schema path of every scene3d and building kind, a patch changing only that path followed by one frame equals a clean rebuild by hash; a planted kind that maps a rebuild-class param to shading fails, naming the path | `dirty.test.ts` (3): `kinds` lists every builder and building kind the issue adds (the same set as `registry`), each with a fixture and a sweep covering every param and dirty-map path, classes from the closed list, `from` ≠ `to`, slab@1's size `rebuild` and mapped to `geometry`; for every path of every scene3d and building kind, the frame after a one-path revision has the clean rebuild's nodes with equal result hashes, and the change shows; `slab_size_as_shading` fails, naming slab@1 and params/size. Wrong programs: a dirty map that under-classes a path; a sweep that can't see a change |
| AC9 `#420.9d6960ba` | Moving the curve that a disabled `curve_deform` names leaves its item's content key and work counters unchanged, and enabling the modifier rebuilds the item once; a planted key that keeps a disabled modifier's references rebuilds it and fails, naming the modifier | `disabled.test.ts` (2): moving the rail while the modifier is disabled runs no node of the bar and keeps its node keys and geometry key; enabling it runs the bar in the next frame and in none of the three after, changes its key and bends it; once enabled, moving the rail reruns it. `--planted keeps_disabled_refs` fails, naming `mod.curve_deform@1` and `items/bar/modifiers/0`. Wrong programs: a disabled modifier's references in the key or read set; an enable that never rebuilds, or rebuilds every frame |

## Readings where the issue and design leave a choice

- **One surface per kind of evidence.** Geometry, counts and keys are read on the CPU through `deep-show` (the canvas
  core, as #387's and #411's suites read it); pixels, fences and the meter through `deep-gpu` (the GPU layer, as
  #377–#380's). The new calls are where the base's binaries already hold the parts they read.
- **"A patch changing only that path"** (AC8) is a whole revision that differs from the last one only at that path:
  the base's `deep_show` sessions take whole revisions, and `eval` refuses a shared document patched through `deep
  show` (`no_revision` at the base). The sweep values come from the kind (`sweep`), since only the kind knows a
  valid second value for every path; the test refuses a sweep whose change shows in no node.
- **Welded positions** are positions equal to 1e-6 m. A degenerate triangle (two corners welded together, as at a
  cone's apex) is left out of V, E and F.
- **Closed forms** are the polyhedra the params name, not the smooth shapes they approximate: an n-segment lathe is
  the solid of regular n-gons whose circumradius follows the outline (the volume is (n ÷ 2) sin(2π ÷ n) |∮ r² dy|,
  each outline edge's band n planar trapezoids); a geodesic ball at detail 0 is its Platonic solid with its corners
  on the radius; a prism is its outline's area and perimeter. Cases without one (UV ball, closed tube, coil) are
  held to the count, watertightness and Euler only; the UV ball and the geodesic ball at detail 2 to the design's
  561 and 540.
- **"Every closed builder"** is every part a builder reports in `closed`; the fixture also fixes the genera the issue
  names, so a builder can't pass by reporting nothing closed. `display@1` (it needs an inset item) and
  `mesh.asset` (it needs a glTF asset) are not in the parity fixture; AC8's sweep still covers `display@1`.
- **The flat tree** is a recipe, so the tree is one item made of parts as a pack would ship it; "one normal per face"
  is read per triangle (the three vertex normals are the triangle's unit normal, outward); "counted before it
  builds" is `estimate_only` with no build.
- **Mirror and array** semantics are Blender's (mirror about the item's origin, keeping the original; array copies
  at k × offset), which the design's field names follow. Order is checked on point sets, so a builder's vertex
  layout doesn't matter.
- **"Recorded change"** (AC2) is the revision record: the deep_show reply's `changed` lists the item and `revisions`
  shows a new current revision with another hash.
- **Building kinds** are checked by what they build: the mitre by the wall's x-extent at the corner, the opening by the
  wall's volume, the slab's hole by its volume and the stair's `well`, the stair by `risers` (⌈rise ÷ 0.18⌉), and
  what each reads by which node keys a change moves. "A recipe repeat without a fixed count" is a repeat whose count
  reads `t`, one with no count, and a count whose input a channel drives; the first two are the pack check's to
  refuse, the third the document check's.
- **The three-quarter view** is a perspective camera at (2.4, 1.9, 3.2) looking at (0, 0.25, 0); the hidden corner is
  the box corner farthest from the camera, and the box corners come from the drawn segments, so the test doesn't
  assume where the slab puts its origin. "Unbroken at the line's width" is read across each edge in the ID target
  (3 ± 1.5 px, as #378 reads widths); "draw nowhere" is no line pixel within 2 px of any sample clear of the
  visible edges.
- **The texture in flight** is #379's `test.texture@1`, the only kind at the base whose draw samples a texture of a
  chosen size; "a 2,048 px texture" is 2,048 × 2,048 rgba8 with all mips. "By the meter's count" is the writer's
  `count_bytes` dropping by the texture's bytes at the first frame after the fence. The frame in flight is held by
  the `hold` fault fixture, as #378's `latency` holds a slot.
- **Particles** are judged with a still camera so only the particles move; `particles_integrate` is a mutant for a
  criterion that names no wrong program.

Not tested, because no criterion asks: `true_shape`, `uv0`, anchors, named parts other than closed ones, `store`,
`displace`, `build`, `boil`, `dash`, `outline`, `subdivide`, `bevel` and `solidify` modifiers, `cast_shadow`,
`receive_shadow`, `lod`, figures' tones and relations, `representations: plan | export`, the composites pack
(house, tower, lamp, island, cloud bank) and the castle document, recipe nesting, conditions, lights in a recipe's
budget, channels inside a recipe and repeats along a curve, `edges` of kind `cage`, and the particles' emit regions,
bursts, bounce and turbulence.
