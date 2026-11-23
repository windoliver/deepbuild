# Acceptance tests for #3036: tracks on the ground, a terrain plate's drawn surface sinking along the path named items took

These tests were written before any implementation existed, by a job that never sees one. The writer had issue #3036
as saved on 2026-11-21 (its opening paragraph, Scope, six acceptance criteria, Proof line and `Runs on:` line; it has
no comments and no Oracle line), the four design sections it links and those they lean on, and base commit
`5f5791e2d`. No other worktree, branch, pull request or issue was read. The implementing agent doesn't edit these
files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job (design: Dogfooding). The suite is lean: one
file per criterion, one test per clause that needs its own run, the four planted wrong programs the criteria name, and
no budget or timing test (the issue has none).

**Run at the base.** Each file was run once against the base's own `deep-show` and `deep-gpu`: all 11 tests fail
there, each at an assertion of its own and none at load (`BASE-FAILURE.txt`, with what the base was probed for
first). No implementation exists, so no test has been seen to pass, and the four planted programs have never run:
what each test does past its first failing assertion is checked only by the type-check and by the judges' planted
sets, which every judge fails (`judges.ts` holds nothing of the test runner, so plain Node runs them too).

## Files

| File | Holds |
|---|---|
| `ac1-groove.test.ts` | criterion 1 `#3036.ea21520e`, 2 tests |
| `ac2-hop.test.ts` | criterion 2 `#3036.c665f650`, 2 tests |
| `ac3-physics.test.ts` | criterion 3 `#3036.4fdba809`, 2 tests |
| `ac4-seek.test.ts` | criterion 4 `#3036.e57d7497`, 2 tests |
| `ac5-span-cap.test.ts` | criterion 5 `#3036.69707b1e`, 2 tests |
| `ac6-taste.test.ts` | criterion 6 `#3036.28aa4780`, 1 test |
| `judges.ts` | the fixtures' numbers, the judges, and the planted sets each judge must fail; no test runner in it |
| `fixtures.ts` | the documents and the calls; no test runner in it |
| `helpers.ts` | the builds, the two runners and the reply readers |
| `twins.json` | each criterion's ID to its planted program |
| `lane.json` | the folder runs alone |
| `BASE-FAILURE.txt` | each file run once at the base, and the probes made there |

## What was read

- The issue as saved (title, labels, body) and its body alone for the criterion IDs, each worked as
  `scripts/proof-change.mjs`'s `criterionId` works it and found equal to the ID its tests carry. The job had no access
  to the issue tracker: the epic #442 and issue #2014 were not read; #2014 is known here through its suite's README
  and its code at the base.
- `docs/canvas-primitives.md`, read whole: Units and axes; The cost model; Builder plate: terrain, and terrain
  overlays; Material: water (the wake, the rings' cap); Particles `particles@1`: space and paths; A timeline as data
  over a pinned backend; World and backend `physics.world@1`; Shape; Body `body@1`. Searched for what they say of a
  plate's height field, and not read whole: Control: point and the navigation sections. Not read: Builder; Marks in
  3D: trail; Level of detail: chunks streamed by view; Constraint: rest_on; Render-back; Determinism class; Look;
  Sky; Camera. The trail's chain and the wake's times were read from the base's code instead.
- `docs/technical-design.md`, read: Criteria in a checked shape; Wrong programs; Proven on the base; Dogfooding;
  Built to be hard to get wrong (and, above it, reftests: a seek and a play on one machine); The reference Macs.
  Searched for the terrain plate and the geometry audit, and not read whole: Scenes, physics and the canvas core; The
  physics module; Document check. `docs/parallel-proof.md` (a suite's own lane file). AGENTS.md and CONTRIBUTING.md.
- At the base, for surfaces and conventions only, each read in the parts named: the suites `2014/` (README, helpers,
  both tests, `BASE-FAILURE.txt`: the terrain plate, `terrain_rays`), `2017/` (README, helpers, the taste test:
  `view3d` on a plate), `166/` (helpers, `physics.test.ts`, `seek.test.ts`), `2760/` (helpers, `cap`, `seek`, `span`
  and `taste` tests, `BASE-FAILURE.txt`), `268/` (a collection), `265/` (`ac3-wake-seek.test.ts`, a plant that keeps
  the last frame), `540/` (README, its lab world, `twins.json`), `1918/` and `1921/` (worlds in a scene, outputs to
  items), `2371/` (README), `980/` (the taste call's form), `971/` (`twins.json`), `3023/` (`lane.json`). `1381/`,
  `419/`, `450/` and `2308/` were opened only for a field's spelling. The crates those drive: `deep-canvas-scene3d`
  (`terrain.rs`, `trail.rs`, `fixtures.rs`; the wake in `water.rs`; parts of `shore.rs`, `horizon.rs`, `shapes.rs`,
  `spec.rs`, `scene.rs`; `lib.rs`'s `PLANTED`), `deep-canvas` (`heights.rs`'s `meet` and `local`, the params check in
  `document/check.rs`), `deep-show` (`terrain.rs`, `geometry.rs`, `physics.rs`; the calls and `planted` in `main.rs`;
  `time.rs`'s `eval_time`; `points.rs`'s `world`), `deep-gpu-layer` (`Planted` in `main.rs`, `view3d/parse.rs`,
  `ground_points` in `lod.rs`, `trails.rs`, `physics.rs`), `deep-canvas-physics` (`doc/heightfield.rs`, the backend
  check in `check.rs`), the pinned physics backend's crate (`bound.rs`, `source.rs`), and `scripts/`
  (`proof-change.mjs`, `proof-runs.mjs`, `lanes.mjs`, `benchmark.mjs`, `studied-names.mjs`). `deep-scene3d-render`
  was not read.

Code was read only to learn the surface. Every expected value comes from the issue and the fixtures' own numbers.

## What the base already does, and these tests don't credit

A terrain plate is one surface for drawing, physics, picks and `rest_on` (#2014), and nothing that crosses it leaves
a mark. `terrain_rays` answers, at 0 s, where a ray meets the plate's drawn triangles, its physics height-field shape
and a pick on it. A water's wake reads a named item at whole multiples of the frame interval through the chain a
trail reads. A scene's `physics.world@1` worlds bake on the pinned backend, an output moves a drawn item, and `world`
answers a bake's step hashes and body states. `view3d` plays and seeks a document and answers each frame's pixel hash;
its call field `tracks` is the input tracks of a document's worlds (#251) and has nothing to do with the ground.

Seen at the base (`BASE-FAILURE.txt`):

- A `plate@1` defines no `tracks`. `deep_show` refuses a plate that writes it: the document check raises
  `unknown_field` at `items/<plate>/params/tracks`, an error whose `actual` is the block as written.
- `view3d` draws a session document whose plate writes `tracks` exactly as it draws the same document without it.
- `terrain_rays` reads no `t`.
- No planted program of this suite's names exists: a `deep-show` scenario that names one is `bad_input`, and
  `deep-gpu run --planted` with one exits 2 with `bad_input`.

So no test here passes at the base, and none is a guard.

## Run them

Every file builds `deep-show` or `deep-gpu` with cargo, and two draw on the GPU, so the folder runs one file at a
time: `lane.json` says so, and `scripts/lanes.mjs` reads it. Nothing is edited outside this folder.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3036 --no-file-parallelism --testTimeout=3600000
node node_modules/typescript/bin/tsc -p tests/acceptance/3036/tsconfig.json   # type-check
rm -rf tests/acceptance/3036/node_modules/.vite                               # vitest's cache
```

- **Build.** Each file first runs `cargo build --locked --bin deep-show --no-default-features --features full`
  (criteria 1, 2, 3 and 5) or `cargo build --locked --bin deep-gpu` (criteria 4 and 6), with the pinned toolchain's
  folder and `/opt/homebrew/opt/rustup/bin` put first on `PATH` where they exist and `CARGO_INCREMENTAL=0
  CARGO_PROFILE_DEV_DEBUG=0` unless already set, copies the binary out of the target folder (honoring
  `CARGO_TARGET_DIR`), and fails each test whose build failed. With no cargo at all a test fails `BLOCKED:`.
- **The machine** (the issue's `Runs on:` line). Criteria 1, 2, 3 and 5 read evaluated data from `deep-show` and run
  on any machine. Criterion 4 compares pixel hashes: off macOS, or when `view3d` answers that it has no GPU, it fails
  `BLOCKED:`; on a Mac that is not of a reference model (`scripts/benchmark.mjs`'s `references`, read in a child
  process) it fails `INCONCLUSIVE:`. Criterion 6 draws one still: with no GPU it fails `BLOCKED:`. None of these is a
  pass.
- **Isolation.** Each test writes into temporary folders and deletes them. `ac6-taste.test.ts` writes
  `docs/evidence/3036/wheel-tracks.png` and keeps it. Node built-ins and vitest only; suites don't import each other.
  No process is started but `cargo`, `deep-show`, `deep-gpu` and one `node` child that reads the machine's model, each
  waited for; none is stopped by name or port. The suite adds no environment variable: it reads `PATH`,
  `CARGO_TARGET_DIR`, `CARGO_INCREMENTAL` and `CARGO_PROFILE_DEV_DEBUG`, as the base's suites do.

## The surface under test

The issue names the `tracks` field, what the drawn surface does, the cap, step hashes, pixel hashes seeked and played,
four wrong programs and a still. It names no call. The tests enter through the base's own calls: `deep-show run`
(#393) with `deep_show`, #411's `deep_query`, #2014's `terrain_rays` and #540's `world`; and `deep-gpu run` (#377)
with #378's `view3d`. **Bold** marks every name the issue and the design don't give: each is this job's choice, the
least the criteria need, listed again under Readings. An implementation builds exactly these, or disputes them.

### The field, as the documents write it

| Name | Where | Example |
|---|---|---|
| `tracks` (the Scope's field and its members) | **on the plate's `params`, beside `terrain`** | `"ground": {"kind": "plate@1", "params": {"terrain": {"height": 0.5, "size": [12, 2], "spacing": 0.05, "tile": 12, "lod_levels": 1}, "tracks": {"items": "rollers", "width": 0.4, "depth": 0.05}}}` |
| `tracks.items` | **the ID of a document collection**, whose `members` are item IDs | `"collections": {"rollers": {"members": ["ball"]}}` |
| `tracks.width`, `tracks.depth` | numbers, m | `"width": 0.4, "depth": 0.05` |
| `tracks.span` | **a number of seconds**; left out it is `all` | `"span": 5` |
| `tracks.darken` | a number from 0 to 1; left out it is 0.2 | `"darken": 0.4` (the still alone writes it) |

Every plate is `plate@1` with `params.terrain` (#2014) and no `at`, so its own space is the world's. No test writes
`tracks: "none"` or `span: "all"`: a plate without tracks leaves the field out, and `all` is the default.

### The one new call field: `terrain_rays` takes **`t`**

```json
{"call": "terrain_rays", "doc": "<doc>", "item": "ground", "t": 7056000000, "rays": [{"from": [x, 2.5, z], "dir": [0, -1, 0]}, …]}
```

- **`t`** is the time the plate is read at, a JSON integer of flicks (705,600,000 a second), as `geometry`'s `t` is.
  Left out it is 0 s, as at the base. The tests send whole multiples of the document's frame interval.
- `drawn` is where the ray meets **the surface the plate draws at `t`**: its drawn triangles as the frame at `t`
  places them, the tracks' lowering applied. This is the criteria's "the plate's evaluated drawn surface".
- `physics` and `pick` answer as at the base, from the plate as it was built, whatever `t` is.
- The reply's shape is the base's: `{"shape", "rays": [{"drawn", "physics", "pick"}, …]}`, a point `[x, y, z]` or
  `null`. The tests read `drawn` and `physics`; a point must lie on its ray within 1e-6 m in x and z.

### Calls read as the base has them

| Call | What the tests send | What they read |
|---|---|---|
| `deep_show` | `{session, doc, document, include: ["issues"]}`, the agent's form | `outcome`, `issues` (`code`, `severity`, `ids`, `path`, `actual`), `notices` |
| `deep_query` | `{session, doc, paths: ["items/ball/at/pos"], at: ["0s", "0.5s", …]}` | `values[path][i]`, the ball's place at each time |
| `world` | `{doc, world: "lab"}` | `ok`, `step_hashes` (index k after k steps), `bodies.<ID>[k].pos` |
| `view3d` | `{doc, look, size, fps, from?, frames?, capture?, targets?}` | each frame's `frame` and `pixel_hash`; a captured frame's `final` PNG by its SHA-256 |

### The refusal

The show of the plate with 5,000 samples alive answers `outcome: "refused"`. Among its `issues` is one with:

- `severity: "error"`;
- `ids` holding `"ground"`;
- `path` equal to `items/ground/params/tracks`, or below it;
- **`actual`, an object holding `count: 5000`**, the number of samples alive on the plate.

The tests don't read the issue's `code`. The design's nearest cap, the water's rings, raises `over_budget` with
`actual: {part, count, t}`.

**What counts as a sample alive.** At a time t the plate reads, for each item its collection holds, the item's place
at each whole multiple of the frame interval from t − `span` to t, both ends counted, none before the document's
start: the times a wake reads. So at any time from `span` on, a plate holds items × (`span` × frame rate + 1) samples.

### The planted programs

Each is one criterion's wrong program, reachable only by its name, and changes nothing else. An unknown name is
`bad_input` at the base. `twins.json` maps each criterion's ID to its name.

| **Name** | Reached through | The wrong program | Criterion |
|---|---|---|---|
| **`tracks_lower_at_samples_only`** | `deep-show run`'s scenario `planted` | The plate lowers its drawn surface about each place it read alone: the raised-cosine profile by the distance to that one point, `depth` at the point and nothing from `width` ÷ 2 away. Nothing is lowered along the line from one place to the next. | 1 `#3036.ea21520e` |
| **`tracks_read_ground_position`** | `deep-show run`'s scenario `planted` | The plate reads each item's x and z alone and never how high the item is: every place it reads counts as on the ground, so the groove runs under a hop. | 2 `#3036.c665f650` |
| **`tracks_feed_physics_shape`** | `deep-show run`'s scenario `planted` | The plate's physics height-field shape takes the heights the plate draws: `terrain_rays`' `physics` at `t` meets the surface `drawn` meets at `t`. | 3 `#3036.4fdba809` |
| **`tracks_keep_last_frame`** | `deep-gpu run --planted <name>` | The plate keeps the surface the frame before drew: each frame takes the surface the last frame this process drew left and lowers it about each item's place at this frame's time, reading no place at an earlier time. The first frame a process draws starts from the plate as built. | 4 `#3036.e57d7497` |

### The taste call's files

`ac6-taste.test.ts` writes `docs/evidence/3036/wheel-tracks.png` and reads **`tests/acceptance/3036/TASTE.json`**
(The taste call, below). This suite ships no `TASTE.json`.

## The fixtures

All generated in `fixtures.ts` from the numbers in `judges.ts`; no file on disk. Metres, seconds, +Y up, right +X.
Every plate but the field is level at 0.5 m, not 0, so a plate that takes the ground for y = 0 finds every ball half a
metre in the air and draws nothing. Every ball is a `mark.sphere@1` of radius 0.25 m; its lowest point is its centre
less its radius.

- **The plate (the lane; criteria 1, 2, 4, 5).** `ground`: 12 × 2 m at 0.05 m, 241 × 41 samples, with `tracks:
  {items: "rollers", width: 0.4, depth: 0.05}`. Its row of samples at z = 0 is the roll's line, and `width` is 8
  spacings, so the plate has vertices on the centre line and at the half-depth points (0.1 m either side).
- **The ball and its 10 m roll (criteria 1, 4, 5).** `ball`, the one member of the collection `rollers`. Two linear
  channels move it: x from −5 m at 0 s to 5 m at 10 s (1 m/s), y held at 0.75 m, so it touches the plate all the way;
  z = 0. The document runs 12 s at 2 frames a second, so the plate reads the ball every 0.5 s: 21 places 0.5 m apart.
  **One sample's spacing is 0.5 m**, wider than `width`, so places lowered one by one leave bare ground between them.
- **The hop (criterion 2).** The same lane, plate, tracks and ball, the ball's height keyed too: 0.75 m until 4 s
  (x = −1 m), 1.25 m at 5 s (x = 0), 0.75 m again from 6 s (x = 1 m). Its lowest point is 0.5 × (1 − |t − 5|) m over
  the plate between 4 s and 6 s, more than 2 cm from 4.04 s to 5.96 s. So the places read at 4.5, 5 and 5.5 s are in
  the air, and those at 4 s and 6 s, where the hop begins and ends, on the ground. The hop is 2 m.
- **The yard and the second ball (criterion 3).** `ground`: 16 × 6 m at 0.1 m, 161 × 61 samples, with the lane's
  tracks or none. The world `lab` (`physics.world@1`, 120 steps a second, 5 s, friction 0.6, no bounce) holds a static
  body with one `heightfield` shape, and two dynamic spheres launched rolling: `roller` from (−7, 0.75, 0) along +x at
  3.5 m/s, and `crosser` from (−4, 0.75, −2) along +z at 0.8 m/s. Each ball's `locks` hold it to its line: `roller`
  to the plane z = 0 (`locks: {linear: [false, false, true], angular: [true, true, false]}`), `crosser` to the plane
  x = −4 m. Left free, the base's first ball drifts 0.46 m off its line in 5 s. Outputs write their poses to the
  drawn items `ball` and `crosser`; the collection `rollers` holds `ball` alone. The document runs 5 s at 10 frames a
  second. At the base the first ball rolls 11.7 m in the 5 s, its groove along z = 0; the second meets that line at
  x = −4 m a little over 2 s in, more than a second after the first passed there. The world names no backend, so it
  runs on the build's own.
- **The plate with `span: 5s` (criterion 5).** The lane and its roll with `tracks.span: 5`, read at 8 s: the ball is
  at x = 3 m and was at x = −2 m 5 s before.
- **The plate with 5,000 samples alive (criterion 5).** The lane with eight balls `crowd0` … `crowd7` at rest on it,
  1 m apart, the collection `crowd` holding them, 30 s at 24 frames a second, and `tracks: {items: "crowd", width:
  0.4, depth: 0.05, span: 26}`: 8 × (26 × 24 + 1) = 5,000. Its twin with `span: 20` holds 8 × 481 = 3,848.
- **The film (criterion 4).** The lane and its roll as a `view3d` session holds them (one writer layer, camera `cam`):
  brown soil and a red ball under a day sky and a sun, seen whole from (0, 6, 12) m, 480 × 270, plain look. Drawn at
  10 frames a second, frames 0 to 100. The 20 sampled frames are 4, 14 … 94 (between the document's frames) and 10,
  20 … 100 (on them).
- **The field with wheel tracks (criterion 6).** `ground`: 24 × 16 m at 0.05 m with gentle rises (`0.12 *
  sin(position.x * 0.35) * cos(position.z * 0.27)`), and `tracks: {items: "wheels", width: 0.3, depth: 0.06, darken:
  0.4}`. A cart, a box on four wheels (`mark.cylinder@1`, 0.6 m across, on their sides), drives a straight line from
  (−10, −5) to (10, 5) m in 10 s; each wheel's place is keyed every 0.25 s with its centre one radius over the field
  under it, so its lowest point stays within a millimetre of the ground. The collection `wheels` holds the four
  wheels. 12 s at 30 frames a second: at most 4 × 361 = 1,444 samples alive. A low sun with shadows, the filmic look,
  1280 × 720, the frame at 8 s, the camera 2.4 m up beside the cart's line at (−6.5, 2.4, −1.3) m, looking along the
  tracks toward the cart, about 13 m off.

## Criteria to tests

IDs are `#3036.` and the first 8 hex digits of the SHA-256 of each criterion's text, as `scripts/proof-change.mjs`
computes them. Every `describe` and test title starts with `AC<n> #3036.<id>`. Each file's header states its fixture,
its numbers and its wrong programs in full.

| ID | File (tests) | What it asserts | What fails it |
|---|---|---|---|
| AC1 `#3036.ea21520e` | `ac1-groove.test.ts` (2) | The ball is at its 21 keyed places. At 10 s, on the centre line every 0.05 m between the roll's ends (199 rays), `drawn` is `depth` under the plate as built within 1 mm. At three cross-sections of 160 rays each, the lowering passes half the depth once a side, 0.2 m apart within 5%. Planted `tracks_lower_at_samples_only`: the centre line fails in each of the 20 gaps, each failure naming its gap by the two places it lies between, and none at a place the plate read. | The base (the show is refused); lowering at the samples alone; another depth or width; a groove off the ball's line; the ground taken for y = 0 |
| AC2 `#3036.c665f650` | `ac2-hop.test.ts` (2) | The ball is at its 21 keyed places. At 10 s the centre line is `depth` deep from x = −4.95 to −1.05 m and from 1.05 to 4.95 m, and as built within 1 mm from x = −0.25 to 0.25 m. Planted `tracks_read_ground_position`: the judge fails under the hop alone, naming the span from x = −1 m to x = 1 m (4 s to 6 s). | The base; a plate that never reads the height; one that joins the places either side of the hop; 2 cm read from the ball's centre |
| AC3 `#3036.4fdba809` | `ac3-physics.test.ts` (2) | See [Criterion 3](#criterion-3). Planted `tracks_feed_physics_shape`: the step hashes differ and the failure names the first step that does; so does the second ball's path. | The base; a physics shape that takes drawn heights; a plate that draws no groove |
| AC4 `#3036.e57d7497` | `ac4-seek.test.ts` (2) | Each of the 20 sampled frames opened alone by a seek has the pixel hash of the frame the film played to. The 20 played frames all differ, and at 10 s the same lane without tracks draws another frame. Planted `tracks_keep_last_frame`: the judge fails, its first failure the first seek's. | The base (no tracks drawn); a surface kept from the frame before; places read from earlier frames; a renderer that draws nothing |
| AC5 `#3036.69707b1e` | `ac5-span-cap.test.ts` (2) | (1) With `span: 5`, at 8 s the centre line is `depth` deep from x = −1.45 to 2.95 m, and as built at x ≤ −2.75 m and at x ≥ 3.25 m. (2) The plate with 5,000 samples alive is refused with the error under The refusal; its twin with 3,848 is presented. | The base (its refusal names no count); a span not read, or read in another unit; a groove ahead of the ball; no cap; a cap that refuses 3,848; another count |
| AC6 `#3036.28aa4780` | `ac6-taste.test.ts` (1) | The field with tracks and without draw different frames; the renderer's final PNG is kept; then `TASTE.json`: none, or one on another picture, is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly this picture passes. | The base (no tracks in the still); no recorded call |

### Criterion 3

A world's ground is a shape the world writes, and the base has no way for a plate's samples to reach a world. The
plate's own physics shape is the one `terrain_rays` answers `physics` from. So the roll runs on the plate's physics
shape in two steps, each one `deep-show run` process showing the yard twice, with tracks and without:

1. Each world's `heightfield` holds the plate as built (0.5 m). `terrain_rays` at 4.5 s reads each plate's physics
   shape by a ray straight down beside each of its 159 × 59 inner samples (every sample but the outer ring), and its
   drawn surface at 20 points along the first ball's line, every 0.5 m from x = −6.5 m to x = 3 m. A node's ray runs
   13 mm along +x and 7 mm along +z of its sample, inside one triangle: of the rays cast exactly at a sample, along
   the height field's edges, the base's physics shape answers only about half.
2. Each world's `heightfield` (159 × 59, 15.8 × 5.8 m, centred on the plate) now holds the heights step 1 read from
   that document's plate. `world` answers each bake's step hashes and both balls' positions after every step, and
   `terrain_rays` reads the 20 points again.

The test asserts:

- **The fixture.** Without tracks the physics shape lies at 0.5 m at every node (within 1e-4 m). On it the first
  ball rolls 10 m or more, within 1 cm of its line, its lowest point within 2 cm of the plate at every step; the
  second ball crosses that line, and when it comes within 0.45 m of it the first ball is at least 1 m past x = −4 m.
  The step hashes change from step to step.
- **Not vacuous.** With tracks, `drawn` is lowered by between half the depth and the depth at all 20 points, in step
  1 and in the roll whose hashes are compared; without tracks it is the plate as built within 1 mm.
- **The criterion.** The step hashes with tracks on are those with tracks off, step for step, and the second ball's
  position is the same after every step.

Under the plant, step 1's `physics` for the plate with tracks holds the first ball's groove, so step 2's world with
tracks has a trench where the other has level ground. Probed at the base: the yard's world with a trench of the
tracks' profile written along z = 0 parts from the level one at step 1, and the second ball's path at step 245.

## The judges, and the sets they must fail

The tests compute these themselves (`judges.ts`). Each test first runs its judge on planted sets, before a binary is
asked for, so a judge that passes everything can't pass a file. A planted set is a surface worked out here: a plate's
samples lowered by a rule, drawn as two triangles a cell split as the base's plate is. All were run by plain Node and
pass.

| Judge | Passes | Must fail |
|---|---|---|
| the groove (`grooveFailures`) | the Scope's plate: lowered along the path through the places read | a plate that draws nothing (20 gaps, 19 places, 3 cross-sections); one lowered at the samples alone (20 gaps and the 2 cross-sections between places, each naming its gap, no place); a groove 2 mm too shallow; one half as wide; one twice as wide; a cross-section a ray missed |
| the hop (`hopFailures`) | the Scope's plate, the three places in the air left out | a plate that reads the ground position alone (under the hop only, naming the span); one that draws nothing; a groove that stops 1.5 m short of the hop |
| the span (`spanFailures`) | `span: 5`; a groove one sample shorter | `span: all`; 7.5 s; 2.5 s; the whole roll drawn at 8 s (ahead of the ball); nothing drawn |
| the refusal (`capFailures`) | an error naming `ground` at its tracks with `count: 5000` | the base's `unknown_field` at the same path; a presented show; the count 4,992; a warning; an error naming another plate |
| the step hashes (`stepFailures`) | equal lists | lists that part at step 37 (names step 37); another number of steps; no steps |
| a path (`pathFailures`) | equal paths | a path that dips at step 264 (names step 264) |
| the yard (`yardFailures`) | the fixture's two balls | a first ball that rolls 9 m; one that drifts 2 cm; one 3 cm in the air; a second ball that stops short; one at the line before the first has passed |
| the line (`yardLineFailures`) | a drawn groove with tracks; the plate as built without | the plate as built with tracks; a groove without |
| the seeks (`seekFailures`) | equal hashes | a first seek that differs (names the first seek); every seek differing (20, the first seek first); seeks that drew nothing |

## Readings where the issue and design leave a choice

### The surface

- **Where `tracks` is written.** "A terrain plate gains `tracks`" is read as a field of the plate's `params`, beside
  `terrain`, where the design's other fields on a terrain plate (`horizon`, `overlays`) are written at the base.
- **`items: collection`** is the ID of a document collection, as a water's `shore.items` is at the base.
- **`span: 5s`** is written `span: 5`, a number of seconds, as a wake's and a ring's `span` are at the base.
- **"The plate's evaluated drawn surface"** is `terrain_rays`' `drawn`, the call #2014 made to tell a plate's drawn
  surface from its physics shape and its pick. It reads without a GPU, as the `Runs on:` line asks. It needed a time,
  so `t` is the one field added. `geometry`'s row wasn't used: the Scope says every measure reads the plate as it was
  built, and the design doesn't say whether that row is one. `view3d`'s `ground_points` draws a frame on the GPU.
- **Which times are read.** Heights are read only at whole multiples of the document's frame interval. Whether the
  groove's head follows the item between two frames is the wake's rule, not the Scope's words, and isn't asserted.
- **What a mesh can show.** The drawn surface is the plate's triangles, so the lane puts the roll on a row of samples
  and makes `width` 8 spacings. A plate that lowers each vertex by the closed form then draws `depth` on the centre
  line and half the depth 0.1 m either side exactly. A finer drawn surface passes too.
- **The refusal** is read from `deep_show`, as #2014's cap is. "Naming the plate" is `ids` and `path`; "naming the
  count" is `actual.count`. The code is left to the implementer.
- **The planted names**, and where each is reached: three change evaluated data and are reached through the
  scenario's `planted`; the fourth keeps state between drawn frames and is reached through `deep-gpu run --planted`.

### Criterion 1

- **"The centre line"** is the line the ball's centre moved along. It is judged between the roll's ends, x from
  −4.95 m to 4.95 m. Whether a groove's end is round or square is no criterion's, so the two end points aren't read.
- **"Width at half depth"** is the distance across the groove between the two points where the lowering is
  `depth` ÷ 2, each found between neighbouring probes by a straight line. On a raised cosine across `width` that is
  `width` ÷ 2. "Within 5%" is of that half width: 0.2 m ± 0.01 m.
- **"Naming the gap"** is read as the judge's failure naming the two places the plate read that the failing stretch
  lies between, by their x and their time.
- **Under the plant** the judge must fail on the centre line in all 20 gaps and at none of the places read. The
  cross-section beside a place is not held to pass or to fail there.

### Criterion 2

- **"Hopping"** is a keyed height, so where the hop begins and ends is exact. A hop the physics module throws would
  not be 2 m to any stated tolerance.
- **"No groove under the hop, within one sample's spacing at each end"**: the centre line must lie as built farther
  than one sample's spacing (0.5 m) plus half the width (0.2 m) from either end of the hop. Half the width is how far a
  lowering reaches past its line, so a groove whose line ends within one sample's spacing of the hop's end passes.
- **"Naming the span"** is the judge's failure naming the hop's span, x = −1 m to 1 m and 4 s to 6 s.

### Criterion 3

- **"The roll"** here is one the physics module runs: the same tracks, a ball of the same radius. Criterion 1's ball
  is keyed, so its places are exact.
- **How the plate's physics shape meets a world.** Through `terrain_rays`' `physics`, written by the test into the
  world's `heightfield`. The other choice, a world's shape that names a plate, would be a new field of the physics
  module that neither the issue nor the design gives. The shape is read 13 mm and 7 mm beside each sample, so the
  world's ground is the plate's physics surface moved by that much; on a level plate it is the same surface.
- **"In a straight line"** is held by each ball's `locks`, the design's field for it (Body `body@1`). The balls
  still roll on the ground and fall into anything under them: only the sideways drift is taken away.
- **"Takes the path it takes without it"**: the second ball's position after every step is the same number for
  number.
- **"Naming the step"**: the judge's failure starts `step <k>:`, the first step whose hash differs.
- **The time read**, 4.5 s, is a whole multiple of the frame interval inside the document's span.

### Criterion 4

- **"Hash"** is `view3d`'s `pixel_hash`, as the `Runs on:` line's "pixel hashes" says.
- **"20 sampled times"**: ten between the document's frames and ten on them, over the whole roll. "Seeked" is a
  frame opened alone by `from`, as #166's seeks are; "played" is the film drawn from frame 0 in another process.
- **"At the first seek"**: the seeks are made from the last sampled time back to the first, all in one process, so
  the first seek is the first frame its process draws, at 10 s. The judge lists failures in the seeks' order and the
  first must be the first seek's.
- **"A Mac of a reference model"** is this machine's model being one of `scripts/benchmark.mjs`'s `references`. Power
  and thermal state are for timings and aren't read.

### Criterion 5

- **"5 s long"** is held within one sample's spacing at the groove's old end: `depth` deep from just over one
  sample's spacing past where the ball was 5 s before, as built farther back than one sample's spacing and half the
  width behind that place. Nothing may be lowered ahead of the ball past half the width.
- **"5,000 samples alive"** needs a rule for counting, given under The refusal. By it the fixture's count is 5,000
  at every time from 26 s on. A plate that counts one place fewer an item would name 4,992 and fail.
- **The twin under the cap** shows the fixture is refused for its count and nothing else.

### Criterion 6

- **The still** is the renderer's own final PNG, byte for byte. `looks_right` means the tracks read as tracks.

## Not asserted

No criterion says so, so none of this is tested:

- **`darken`**: its amount and its default. No criterion reads a colour. It is in criterion 4's frames and in the
  still.
- **Picks, `rest_on` and every measure reading the plate as it was built** (Scope). Criterion 3 names the physics
  shape alone. `terrain_rays` answers `pick` beside it; the tests don't read it.
- **"And the design says so"** (Scope): the design's text.
- **The cap's edge**: that 4,096 samples pass and 4,097 are refused; the issue's code; the plate's name in `actual`.
- **The profile's shape** beyond its depth on the line and its width at half depth; a groove's ends; grooves that
  cross or overlap; several items on one plate; `tracks: "none"`.
- **Sources**: an item a logic array or a live drag moves, an item with a parent, a `fixture.world@1` body.
- **Other plates**: more than one level of detail, tiles, a horizon table, cover, a chunk tree.
- **Seeking a document whose items a world moves**; times between the document's frames, but for criterion 4's
  hashes.
- **Cost.** The issue has no budget.
- **"Not in this task"**: ground that pushes back or piles up, grains, a body that sinks, a track that changes grip.

## The taste call

`ac6-taste.test.ts` writes `docs/evidence/3036/wheel-tracks.png` and prints its SHA-256. The implementer shows it to
the owner and records the answer in **`tests/acceptance/3036/TASTE.json`**, the one file anyone adds to this folder
after this commit:

```json
{"issue": 3036, "criterion": "#3036.28aa4780", "verdict": "looks_right", "who": "<who made the call>", "when": "<ISO 8601>", "screenshots": {"wheel-tracks.png": "<sha256>"}, "note": "<optional>"}
```

`verdict` is `looks_right` or `looks_wrong`. The picture is evidence for the one taste call only; no other test reads
it.

## What the implementer adds outside this folder

- In scene3d and `deep-show`: the plate's `tracks`, the check's refusal past 4,096 samples alive, `terrain_rays`'
  `t`, and the three planted names reachable through the scenario's `planted`.
- In `deep-gpu`: the tracks drawn, and `--planted tracks_keep_last_frame`.
- The design's text (Scope: "and the design says so").
- After the owner's taste call: `TASTE.json`, with `docs/evidence/3036/wheel-tracks.png` as the run wrote it.
- Nothing in `scripts/lanes.mjs`: `lane.json` puts the folder in `alone`.
