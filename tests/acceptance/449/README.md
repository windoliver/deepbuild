# Acceptance tests for #449: particles with bursts, bounces, kill regions, turbulence, emit regions, landing and counts by class

Written first, from issue #449 (its summary, Scope, Fields, 17 acceptance criteria and Proof line), its oracle page, the
design sections it links and those they lean on, and base commit `cbd5e4f98` ("Merge pull request #2284 …"), by a job
that never saw an implementation; none existed, and no other branch, worktree or pull request was read. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

This suite covers criteria 1 to 11 and 17. Criteria 12 to 16 (mesh-surface emission: `surface {of}`, `follow`,
`inherit`, bounds on the surface fixtures, the 1,048,577-triangle refusal) are a second blind job's, which starts from
this commit and adds its own files here, reusing `helpers.ts` (the builds, `runGpu`, `sessionDoc`, the `particles` call
and its reader, `view3d` with `particles`, `outsideBounds`, `chiSquared` and `chi2Bound99`) and the surfaces below.

## What was read

- Issue #449, live with `gh issue view 449 --repo windoliver/deepbuild`, and its oracle page
  (`doneright/oracles/issues/449.md` in DeepBuildAI/deepbuild, branch `doneright`): no upstream test checks any of
  these criteria, so nothing is ported (the Oracle lane has nothing to run).
- `docs/technical-design.md`: Particles, closed form; Dogfooding; Tests written first. AGENTS.md.
- `docs/canvas-primitives.md`: Particles `particles@1` and its sections emit regions, occurrence bursts, bounce and kill,
  turbulence, trails and mesh draws, space and paths; Occurrence list; The cost model and its budget-class table;
  Operator budgets by class; Units and axes (metres, +Y up, flicks); the document envelope's `collections`.
- At the base, only to find the surfaces that exist: `crates/deep-gpu-layer` (`main.rs`: `enum Planted`, `fn call`,
  `serve`; `effects.rs`: `sparks_of`, `count_refusal`, `item_seed`; `view3d.rs`: `parse`, the frame loop, its
  `count_refusal` at render, `evaluate`, `read`, `cull`; `physics.rs`: a document's worlds baked in `view3d`);
  `crates/deep-canvas-effects/src/shipped.rs` (`particles()`, `particles.sparks@1`: `elements: MAX_PARTICLES` for every
  class, 8 instance floats a particle, slot e born at e ÷ rate) and `module.rs` (the effects module's check rules);
  `crates/deep-effects-render/src/frame.rs` (`Sparks`); `crates/deep-canvas-physics/src/occurrence.rs` and
  `crates/deep-show/src/physics.rs` (occurrence lists stamped with their step's time, `<world ID>.occurrences`);
  `crates/deep-canvas/src/document/mod.rs` (the check's `Issue`); `scripts/proof-change.mjs` (criterion IDs);
  `scripts/lanes.mjs` (`alone`); and the suites `tests/acceptance/420/` (particles, `view3d`, seek against play),
  `1312/` (the particle operator), `2016/` (a `view3d` read-back field, README layout), `1918/` and `1921/` (occurrence
  lists, worlds in `view3d`, `twins.json`), `2009/` (`deep-physics` bakes), `855/` (an x86_64 build under Rosetta 2),
  `485/` and `252/` (a taste call, an animated PNG of the canvas's own frames), `160/` (a parity `.film`).

## What the base already does, which these tests don't credit

`particles@1` exists only in the GPU layer: `deep-gpu`'s `view3d` evaluates a document and draws each `particles@1` item
through the shipped compute operator `particles.sparks@1`, whose rows are a closed form of t, the row, its generation
and the item's seed (ballistic with linear drag, along a curve, orbit, drift; point, disk, sphere and along shapes;
`emit.rate` and `emit.span`). No canvas module registers the kind, so no document check sees it; a count past
65,536 (1,048,576 in a showpiece or an export) is refused at render with `out_of_range` naming `items/<id>/params/count`,
and the operator declares 65,536 elements in every class. There is no CPU f64 evaluation of a particle, no bounce,
landing, kill region, turbulence, emit region, burst or occurrence source, no bounds, and no way to read a particle's
state or the operator's columns. `view3d` bakes a document's worlds for their `<body>#*` outputs (#1921) but hands no
occurrence list to anything it draws. `deep-physics` bakes a world and answers its occurrence list (#1918).

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/449 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/449/tsconfig.json
rm -rf tests/acceptance/449/node_modules/.vite
```

Each file builds what it drives once, in `beforeAll`: `cargo build --locked --bin deep-gpu` (every file) and
`cargo build --locked --bin deep-physics` (`ac1`), honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0`,
`CARGO_PROFILE_DEV_DEBUG=0` and `NO_COLOR=1` unless set and Homebrew's rustup put first on `PATH` when present, and
copies each binary into a temporary folder. `ac3` also builds `cargo build --locked --target x86_64-apple-darwin --bin
deep-gpu`, inside its test and only after the native half holds. No test feature is needed: the planted programs are
`deep-gpu run --planted <name>`. Every test passes its own timeout (60 minutes); each call writes into the test's own
temporary folder, deleted after it; processes are started by `spawnSync` and stopped only by their own timeout.

**`scripts/lanes.mjs` needs this suite in its `alone` list**, beside the other `deep-gpu` suites, because its files build
cargo binaries and draw on the Metal device. This README is the instruction; the implementer adds the line:

```js
alone.push('tests/acceptance/449/');
```

Gates: no cargo is `BLOCKED:`, a failed test, never a pass. The compute operator's columns and every pixel come from the
GPU layer on Metal: off macOS, or wherever a reply says `unsupported_platform`, those tests fail with a message starting
`INCONCLUSIVE:`, never passing. Calls that need no GPU (the check, the estimate, the CPU f64 closed form, the bounds,
the turbulence table) run on `--backend noop`. `ac3`'s second half is INCONCLUSIVE where rustup has no
`x86_64-apple-darwin` target or Rosetta 2 can't run one. `taste.test.ts` is INCONCLUSIVE until the owner's call is
recorded (below). No test reads a timing.

## The surface under test

The issue names fields and behaviours but no call. **Every call, request field, reply field, document field shape and
planted name below that the issue or the design doesn't give is this job's invention**, the smallest the criteria need,
on the binary that already draws particles. The implementer builds exactly these, or a dispute goes to a blind redraft.

### `deep-gpu run`: the `particles` call

One scenario line `{"out": "<folder>", "calls": [call, …]}` answers one line `{"ok": true, "replies": [reply, …]}`, as
every `deep-gpu run` call does (#377). Request:

```json
{"call": "particles", "doc": "<path>", "t": [flicks, …], "items": ["<item ID>", …], "gpu": false, "bounds": false}
```

- `doc`: a document file as `view3d` reads it (a session document, or a `.film` file as `fixtures/parity/` holds it).
  The call reads it as `view3d` does, every world it lists baked over its transport's span (#1921's `physics.rs`), each
  world's occurrence list available as `<world ID>.occurrences`, channels and drivers evaluated.
- First, **the document check**: the canvas core's check of the document with the `particles@1` rules this issue adds
  (the same rules a revision meets anywhere the check runs). Its error issues refuse the document: no readings.
- `t`: times to read, in whole flicks (705,600,000 a second), in the order given; optional. With none, the reply holds
  the check and the estimate alone (`items` empty), so a 1,048,576-particle item is checked without being evaluated.
- `items`: the `particles@1` items to read; every one when absent.
- `gpu`: also capture the compute operator's instance columns, after its dispatch at each time (needs the GPU backend;
  on `--backend noop` the call answers `{"code": "no_device"}`).
- `bounds`: also report each item's closed-form bounds at each time.
- Without `gpu`, the call needs no device and answers on `--backend noop`.

Reply, when the call itself can't run (an unreadable path, `no_device`): `{"code": "...", "reason": "..."}`, as
`deep-gpu` refuses calls. Otherwise:

```json
{"outcome": "refused", "issues": [Issue, …]}
{"outcome": "checked", "issues": [Issue, …], "estimate": Estimate, "items": {"<item ID>": Item, …}}
```

**Issue** is the canvas core's issue JSON (`crates/deep-canvas/src/document/mod.rs`): `{code, severity, ids, path,
actual, what, fix, …}`. `refused` when any issue has `severity: "error"`. The refusals this issue adds, each an error:

| Refusal | `ids` holds | `path` | `actual` |
|---|---|---|---|
| a count past the class's cap | the item | `items/<id>/params/count` | `{"count": n, "cap": 65536 or 1048576, "class": "<class>"}` |
| a burst `count` expression whose largest value over the baked list's matching occurrences passes 256 | the item | `items/<id>/params/emit/on/count` | `{"peak": the largest value, "cap": 256}` |
| `emit.on.list` naming a list no world of the document bakes | the item | `items/<id>/params/emit/on/list` | the list's name |
| more than six bounce planes | the item | `items/<id>/params/motion/bounce/planes` | the count |
| `land.on` holding an item that a channel, driver, constraint, clip, physics or logic moves | that item and the particles item | `items/<id>/params/land/on` | the moving item's ID |

The codes are the implementer's (the check's catalog); the tests read `severity`, `ids`, and where the table names
them, `path` and `actual`. The class is the document's `budget.class` (`figure` when absent); its cap is 65,536, or
1,048,576 in a `showpiece` or an `export`. `view3d` of a document the check refuses answers the base's refusal of a
checked document, `{"code": "refused", "issues": [...]}`, in place of today's render-time `out_of_range` (not tested).

**Estimate** (the check's, from the cost model's coefficients and the class's operator budgets):

```json
{"class": "showpiece", "operator_ms": 0.42, "storage_bytes": 33554432,
 "items": {"<item ID>": {"elements": 1048576, "operator_ms": 0.14, "scratch_bytes": 33554432}}}
```

- `items[id].elements`: the compute elements the item's operator dispatches in this class: its count (no longer 65,536
  in every class). `items[id].operator_ms`: that item's share of the class's operator time, from its elements and its
  operator's cost terms. `items[id].scratch_bytes`: its scratch, 32 B a particle.
- `operator_ms`: the document's operator time, every operator's share summed, each particles item's included.
  `storage_bytes`: the document's operator storage, every operator's outputs and scratch summed, each item's included.

**Item** (when `t` is given):

```json
{"count": 4096,
 "particles": [Particle, …],
 "turbulence": {"table": "<sha256>", "paths": 32, "steps": 64} | null,
 "at": [{"t": flicks, "cpu": [[x, y, z] | null, …], "gpu": [[x, y, z] | null, …], "bounds": [[x0, y0, z0], [x1, y1, z1]] | null}, …]}
```

- `particles`: every particle born in [0, the transport's span], in order of birth (ties by row), each as its CPU f64
  closed form solves it:
  `{"row": r, "born": s, "from": [x, y, z], "velocity": [x, y, z], "life": s, "hits": [{"t": s, "at": [x, y, z], "plane": i | null}, …], "rest": {"t": s, "at": [x, y, z]} | null, "ends": s}`.
  `row`: the instance row it occupies; `from`: its birth point and `velocity` its launch velocity, world m and m/s;
  `hits`: each bounce off a plane (`plane` its index in `motion.bounce.planes`) and each landing on the `land` map
  (`plane: null`), in order, the one at which it dies or rests included; `rest`: where and from when it rests, or null;
  `ends`: when it stops being live (its life's end, its death at its last bounce or landing, or its exit from a kill
  region). A particle is live at t when `born ≤ t < ends`. All times in s (f64), places in world m.
- `turbulence`: the item's turbulence table, or null without one. The table is written into the scenario's `out` folder
  as `<table>.f32`: paths × steps offsets, path-major, each step's offset as x, y, z in f32 little-endian (metres at
  strength 1), 12 bytes a step; `table` is the SHA-256 of that file's bytes.
- `at`: one entry per asked time, in order, `t` echoing it. `cpu[row]`: the CPU f64 closed form's position (world m) of
  the particle live in that row at t, or null; `count` entries. `gpu[row]` (with `gpu`): the position lanes of the
  compute operator's instance columns for that row, captured after its dispatch at t, null where its age lane is
  negative; `count` entries; row r of the columns is row r of `cpu`. `bounds` (with `bounds`): the item's closed-form
  bounds at t, world m, min and max corners, null when no particle can be live then.

### `deep-gpu run`: `view3d`, two request fields

Everything #378's and #380's READMEs define for `view3d` holds unchanged (`doc`, `look`, `size`, `fps`, `from`, `frames`,
`capture`, `targets`, each frame's `frame`, `pixel_hash` and `final`).

```json
{"call": "view3d", …, "particles": ["<item ID>", …], "particle_cull": "none"}
```

- `particles`: each frame gains `"particles": {"<item ID>": {"hash": "<sha256>", "live": n, "culled": bool}}` for the
  items named. `hash`, the evaluated-data hash: SHA-256 over the item's rows in order, a row with a live particle as the
  byte 1 then x, y and z of the CPU f64 closed form's position at the frame's time as f64 little-endian, a row with none
  as the byte 0 (the same positions the `particles` call's `cpu` gives at that time). `live`: how many rows are live.
  `culled`: whether this frame skipped the item's dispatch and draw because its closed-form bounds lie outside the view.
  Asking for `particles` changes no pixel.
- `particle_cull: "none"`: no particles item is culled by its bounds. Absent, items are culled by their bounds, as the
  shipped view draws.
- `view3d` hands each `particles@1` item the occurrence lists of the worlds it bakes, as the `particles` call does.

### Document fields (the shapes the issue leaves open)

- `emit.shape`: a string `point`, `disk` or `sphere` (radius `emit.radius`, m, as the base reads it), or an object of
  one key: `{"box": {"size": [x, y, z]}}`, `{"ring": {"r", "inner_r"}}`, `{"cylinder": {"r", "h"}}`,
  `{"capsule": {"r", "h"}}`, `{"along": "<curve ID>"}`. Each sits on the item's origin in its own axes: a disk and a ring
  lie in its x-z plane (across +Y); a box is axis-aligned and centred; a cylinder and a capsule stand along +Y, centred.
  A cylinder's `h` is its whole height; a capsule's `h` is its cylindrical part's length, between its hemispheres'
  centres (its whole height h + 2r). A box's size may be 0 on an axis: a flat box.
- `emit.on`: `"volume"` (default) or `"surface"`; or a burst source,
  `{"list": "<world ID>.occurrences", "kinds": ["hit"], "where": "<expression over the payload>", "count": <number or expression>, "max_bursts", "cooldown"}`.
  A matching occurrence's burst is born at its flick, at its `point`.
- `emit.bursts: [{"t": "<time literal>", "count": n}]`. Particle i of a burst occupies row i for the first burst, and
  adding particles to a burst moves none of the others.
- The rate emitter: the k-th particle (k = 0, 1, …) is born when the emitted count ∫₀ᵗ rate reaches k, while within
  `emit.span` (s): under a constant rate at k ÷ rate, the first at 0, as the base births slot e at e ÷ rate. A channel
  may key `items/<id>/params/emit/rate` (`type: "f32"`).
- `motion: {"ballistic": {…}, "bounce": {"planes", "restitution", "friction", "max", "then"}}`: plane i is the set
  n · p = offset (world m, `normal` a unit vec3); particles stay on the side n · p ≥ offset, so the normal points into the
  space they stay in. The fixtures with planes or a landing put the item at the world origin, unrotated (the rain at
  (0, 5, 0)), so nothing here decides whether planes are in the item's frame or the world's.
- `motion.ballistic.velocity: vec3, m/s` (new, optional): every particle launches at this world velocity, in place of
  `v0`'s seeded speed and direction.
- `land: {"on": "<collection ID>", "cell", "then"}`, with the document envelope's `collections: {"<ID>": {"members": [ID, …]}}`.
  A `then: bounce` landing uses `motion.bounce`'s restitution, friction and `max`.
- `turbulence: {"strength", "frequency", "paths", "steps", "travel", "seed"}`, as the issue's Fields.
- `life: [min, max]` (s); `budget: {"class": "figure" | "showpiece" | "export" | …}`.

### Planted programs (`deep-gpu run --planted <name>`; `twins.json` maps each criterion to its names)

| Name | Criterion | The wrong program |
|---|---|---|
| `count_cap_65536_every_class` | 5 | the check applies a count cap of 65,536 in every class |
| `count_cap_1048576_every_class` | 5 | the check applies a count cap of 1,048,576 in every class |
| `bounce_first_two_planes` | 6 | the bounce solver (CPU and compute operator) tests only planes 0 and 1 |
| `land_floor_plane_only` | 7 | `land` meets the horizontal plane at the map's lowest height (here the floor's top, y = 0) instead of the map |
| `drag_first_order` | 8 | the compute operator's drag factor e^(−d a) becomes its first order, 1 − d a (the CPU form unchanged) |
| `drag_euler_120` | 9 | the CPU form integrates ballistic motion with drag by explicit Euler steps of 1/120 s (the operator unchanged) |
| `turbulence_table_zeros` | 9 | every turbulence table is built as zeros, at its size |
| `bounds_emit_region_only` | 10 | an item's bounds at t are its emit region's alone, placed at the item, without motion, turbulence or planes |
| `hides_at_span_end` | 11 | an emitter hides every particle from its span's end on (CPU and compute operator) |

## Fixtures

- `fixtures/parity/vfx/emit-shapes.film`: the issue's parity fixture, a film (`profile: film`, `seed: 449`, a 4 s span):
  ten emitters 2.5 m apart along x at y = 1.5 m, each bursting 4,096 particles at 0 s that hold still (velocity,
  gravity and drag 0, life 10 s): `disk-volume` (radius 1), `ring-volume` (r 1, inner_r 0.5), `sphere-volume` and
  `sphere-surface` (radius 1), `box-volume` and `box-surface` (size 2 × 1 × 0.5), `cylinder-volume` and
  `cylinder-surface` (r 0.5, h 2), `capsule-volume` and `capsule-surface` (r 0.5, h 1), and a camera that sees them all.
  The base has no `parity/` tree, so it lives here, to be moved when the corpus lands, as #1918's did.
- `fixtures/look.json`: #420's acceptance look (tone map none at scale 1, bloom and the 3D ground off), its `spark-a` and
  `spark-b` roles colouring the particles.
- The rest are built by `helpers.ts` and the test files, as session documents (one writer layer, `seed: 449`):
  `boxDoc` (criterion 6's bead in the six planes), `sparksDoc` (64 sparks, a floor y = −0.5 and a wall x = 1.2 m,
  restitution 0.5, max 3, then die, and an undeclared 0.6 m box), `smokeDoc` (256 puffs rising from a 0.2 m ball, drag
  0.2/s, with or without turbulence), `landingDoc` (the issue's rain, cube and floor; a `bounce` variant with restitution
  0.5; a `moving` variant whose cube a channel slides 0.5 m over 2 s), and in their files the lab (`ac1`), the swarm
  (`ac5`), the storm (`ac8`), the shot (`ac9`), the stopping emitters (`ac11`) and the impact scene (`taste`).

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed
(`scripts/proof-change.mjs`'s rule). Every test title starts `AC<n> #449.<id>`.

| Criterion | File | What it reads and asserts | Wrong programs it fails |
|---|---|---|---|
| AC1 `#449.0fcfd1ef` bursts from a baked list; a count past its cap refused naming the peak | `ac1-occurrence-bursts.test.ts` | `deep-physics` bakes the lab's world alone (240 steps); its `hit` rows faster than 1 m/s are the expected bursts. The `particles` call's particles: each born at such a hit's step ÷ 120 s (1e-9 s) and point (1e-6 m), 16 per hit, none elsewhere. `nowhere.occurrences` refused naming `sparks`; `count: "speed * 100"` refused at `items/sparks/params/emit/on/count` with `actual.peak` within 1 of 100 × the fastest matching hit and `actual.cap` 256. Guards: at least three matching hits, each pair's 30 ms apart (so the cooldown drops none) | bursts from anything but the baked list (live physics, a callback, every contact, an unfiltered list), a wrong time or place, a wrong count; a count clamped or unchecked; a peak not named |
| AC2 `#449.7930d605` bounces at closed-form times, off nothing else | `ac2-spark-bounces.test.ts` | From each spark's reported birth point and launch velocity, the test solves its bounces (quadratic roots, reflection with restitution 0.5, death at the third); the CPU's `hits` must match plane for plane within 1e-9 s and m, `ends` too, and its position at 20 random times within 1e-9 m. Guards: every spark meets the floor, some the wall, some pass through the undeclared box | a bounce off the box or anything undeclared, a bounce time stepped or marched rather than solved, a wrong reflection, a bounce past `max` |
| AC3 `#449.c614478f` the turbulence table the same on every machine | `ac3-turbulence-table.test.ts` | Three tables (seed 1, seed 2, 64 × 128): each file hashes to its name, holds paths × steps × 12 bytes, not all zero; the seeds' tables differ; the x86_64 build under Rosetta 2 gives the same three hashes | a table built with machine-dependent math (the FMA, libm or vector paths x86_64 and arm64 differ on), from the wall clock or a random stream; a hash of something but the table |
| AC4 `#449.00a9a9b4` inside or on each shape, chi-squared at 99%, adding a particle moves no other | `ac4-emit-shapes.test.ts` | The film's ten emitters at 1 s: every point inside or on its shape within 1e-9 m; counts over 32 regions of equal share (24 area-weighted for the box's surface; 32 area- or volume-weighted for the cylinder's surface and the capsule) under `chi2Bound99(cells − 1)` (41.638 for 23, 52.191 for 31); with 4,097 a burst, rows 0 to 4,095 bit for bit equal and row 4,096 live | points outside a shape or off its surface; a sampler not uniform (a disk's radius uniform instead of its square root, a ball's radius without the cube root, a box's faces or a cylinder's or capsule's parts chosen without their areas or volumes); a sampler drawing from a stream so a new particle shifts others |
| AC5 `#449.3a94376c` counts by class | `ac5-counts-by-class.test.ts` | Swarms of 1,048,576 in a showpiece and an export check: estimate elements 1,048,576, scratch 33,554,432 B, operator time above 0 and inside the document's, scratch inside its storage. A figure's refused: `ids` ∋ swarm, `items/swarm/params/count`, `actual` count 1,048,576, cap 65,536. A showpiece of 1,048,577 refused, cap 1,048,576 | `count_cap_65536_every_class`, `count_cap_1048576_every_class` (each fails naming swarm); the base's 65,536 elements for every class; a refusal left at render |
| AC6 `#449.6717a1ad` six planes hold a particle for max bounces | `ac6-six-plane-box.test.ts` | CPU: bounces planes 0, 2, 1, 3 at 1/3, 1/2, 1 and 3/2 s (1e-9 s); then die, not live at 1.6, 2, 5 s and `ends` 1.5; then rest, `rest` at (0.5, −1, 0.75) from 1.5 s and there at 1.6, 2, 5 s; at 100 random times before 1.5 s on the folded free path within 1e-9 m. Compute operator: same times within 1e-4 m. Seven planes refused naming bead | `bounce_first_two_planes` (fails naming particle row 0 and the time); a solver past `max`; a wrong rest place |
| AC7 `#449.3af744f9` landing on a height map | `ac7-landing.test.ts` | Particles more than two cells inside the cube's top first land √(8 ÷ 9.81) s after birth, outside √(10 ÷ 9.81) s (1e-4 s), and rest at y = 1 or 0 at 2.5 s (1e-4 m); seek against play by evaluated-data hash at frames 37, 61, 100, 150 (the four differ; frame 61's equals the hash of the `particles` call's CPU positions); `then: bounce`, eight cube-top particles at y = 2 at their apex (1e-3 m); the moving cube refused naming cube | `land_floor_plane_only` (fails naming a particle); a march without refinement; a landing integrated or carried between frames; a moving receiver admitted |
| AC8 `#449.21cedb6d` compute columns against the CPU | `ac8-compute-columns.test.ts` | The storm at 100 random times: same live rows (a row within 1e-5 s of its birth or end let off its live state alone) and positions within 1e-4 × the extent (the largest side of the box holding every CPU position read). Guards: both bursts born, some bounce, live at most times | `drag_first_order` (fails naming the particle); any operator that differs from the CPU form by more |
| AC9 `#449.dd4fc4ae` drag in closed form; turbulence scales | `ac9-drag-and-turbulence.test.ts` | The shot at 100 random times in (0, 3) s against x = 2(1 − e^(−2t)), y = 5.4525(1 − e^(−2t)) − 4.905t, z = 0 within 1e-9 m. The smoke at 50 times: offset at 0.6 twice the offset at 0.3 within 1e-9 m an axis; strength 0 equal to none bit for bit; an offset above 1 mm somewhere; seeds 1 and 2 different tables | `drag_euler_120`, `turbulence_table_zeros` (each fails) |
| AC10 `#449.31a6c28c` bounds hold every live particle; culling by them changes no pixel | `ac10-bounds.test.ts` | On the three fixtures, at 1,000 random times, each live CPU particle inside its item's bounds (1e-9 m). Culling: each fixture with its camera panning 40 m over 1 s, `view3d` at 30 fps for 2 s culled and with `particle_cull: "none"`: equal pixel hashes at every frame. Guards: some item with live particles culled, some drawn, none culled without culling | `bounds_emit_region_only` (fails naming sparks and the time); bounds without turbulence or the planes' reach; a cull that drops visible particles |
| AC11 `#449.776a76da` births stop, lives finish | `ac11-emitter-stops.test.ts` | Both items: 201 particles born at k ÷ 100.3 s (1e-9 s), each ending 1.5 s later, none past 3.5 s; at 100 times in (2, 3.5) s and at 3.5 s, CPU live rows and compute-operator live rows both 200 − ⌊(t − 1.5) × 100.3⌋ (0 at 3.5 s) | `hides_at_span_end` (fails naming the time); a rate channel that stops the twin's particles; births after 2 s |
| AC17 `#449.3f28ed99` shown to you | `taste.test.ts` | Writes three screenshots and two recordings from `view3d`'s own final PNGs to `target/acceptance/449/`; reads `TASTE.json` (below) | none: it is a person's call |

Every test but AC3's second half and the taste call fails at the base at the missing surface (`BASE-FAILURE.txt`).
None can pass on a program that does nothing: each reads values the program must produce (births, hits, positions,
tables, hashes, issues) and holds guards that an empty or still answer fails.

## Readings where the issue and design leave a choice

- **One binary for every reading.** Particles are drawn only by `deep-gpu`, so the check, the estimate and every reading
  are its `particles` call, and seeking and culling are its `view3d`. "Refused at check" is the document check this
  call runs first, the same rules any revision meets; `deep-show`'s `deep_show` would need the kind registered too, and
  no criterion asks which host runs the check.
- **Times are whole flicks.** The issue's 1e-9 m on a particle moving 3 m/s is about one flick of time, so a time in
  seconds rounded to flicks by the program would fail a right answer. Every time a test asks is a whole number of
  flicks, and the test computes its expectation at exactly that time.
- **"A count past its cap … naming the peak"** (criterion 1) is the burst `count` expression's cap, 256 (Fields:
  `count: expression = 12 (≤ 256)`), checked over the baked list's matching occurrences, whose largest value is the
  peak. The item's own count against its class is criterion 5.
- **"Only from a baked occurrence list"** is read two ways: every particle is born at a matching row of the list as the
  physics module bakes it on its own, and a list no world of the document bakes is refused at check.
- **Bounce planes** keep particles on the side their normal points to; with planes listed "x = 1, x = −1, …" each
  normal points into the box. Friction is 0 in every fixture, so its model isn't decided here.
- **One particle's launch velocity** is `motion.ballistic.velocity` (vec3, m/s), beside the design's `v0: [min, max]`.
- **Emit shapes' parameters and axes** are this job's (Document fields). The chi-squared regions follow them: equal
  shares by r² for disks, rings and cylinders, by r³ for balls and hemispheres, by height for a sphere's or hemisphere's
  surface (Archimedes), by octant, sector and slab, and by area or volume across a box's faces and a cylinder's or
  capsule's parts. With ten fixed draws each at 99%, a uniform sampler fails one bound about one time in ten by its seed
  alone; the criterion fixes the bound, so this suite doesn't loosen it.
- **Disk and ring on surface** aren't tested: a flat shape has no surface the design defines apart from its area.
- **Rows.** A burst's particle i is row i (for the first burst), so "adding a particle moves no other" compares rows.
  The rate emitter's k-th particle is born at k ÷ rate, the base's rule, which keeps criterion 11's closed form exact.
- **"The emitter's extent"** (criterion 8) is the largest side of the axis-aligned box that holds every CPU position read
  at the 100 times: about 3 m here, so 1e-4 of it is about 0.3 mm.
- **"Within 1e-9"** for turbulence's doubling is per axis, in metres.
- **"Every machine"** (criterion 3) is this Mac's arm64 build and its x86_64 build under Rosetta 2: two instruction sets,
  each with its own float paths, on one machine. No second machine is configured for this suite.
- **The evaluated-data hash** is defined above so a seek and a play compare the CPU f64 evaluation itself, not pixels;
  one frame's hash is checked against the `particles` call's positions so it can't be of something else.
- **Landing.** Particles within two cells of the cube's edge are left out, as the criterion does. "Rest at y = 1" is read
  at 2.5 s, when every particle is born (by 1 s), landed (by 2.01 s) and alive (life 3 s).
- **"A view that culls by those bounds"** is `view3d` as shipped; the other is `particle_cull: "none"`. The camera pans
  40 m away, so any bounds near the particles leave the view and the culling view must cull; bounds that never let an
  item be culled fail the guard, as a view that culls nothing isn't one that culls by them.
- **Criterion 11's rate**, 100.3/s, keeps every birth off 2 s and every sampled time more than 1 µs from any birth or end.
- **Criterion 5's "counting … in the class's operator time"** is the item's share of operator time above 0 and inside the
  document's operator time; its scratch inside the document's operator storage.

## The taste call

`taste.test.ts` writes, from this run's own frames: `sparks-on-impact.png` (the impact scene at 0.5 s, 640 × 360),
`six-plane-box.png` (the bead at 0.8 s), `landing.png` (the rain at 1.5 s), and `sparks.apng` and `landing.apng`
(320 × 180 at 30 fps, 2 s and 2.5 s), all in `target/acceptance/449/`, printing each SHA-256. Show them to the owner in
the session and attach them to the PR; record the one answer in `tests/acceptance/449/TASTE.json`:

```json
{"issue": 449, "criterion": "#449.3f28ed99", "verdict": "looks_right" | "looks_wrong", "who": "...", "when": "<ISO 8601>",
 "screenshots": {"sparks-on-impact.png": "<sha256>", "six-plane-box.png": "<sha256>", "landing.png": "<sha256>"},
 "recordings": {"sparks.apng": "<sha256>", "landing.apng": "<sha256>"}, "note": "..."}
```

With no file, or one made on other bytes, the test is INCONCLUSIVE; `looks_wrong` fails it. No other test reads a
picture to judge it.

## Not tested

Kill regions (`kill`; no criterion names one); bursts at another item's particles (`emit.on: {particles, at}`);
`inherit`, `follow` and `surface {of}` (criteria 12 to 16, the second job's); `max_bursts` and `cooldown` (the fixture
keeps them from acting); `land.maps` and `layers`, and the 2,048 × 2,048 map cap; `land` on a local-space emitter whose
anchor moves; friction above 0; the drawn size inside the bounds (only positions are held to them, and the culled view's
pixels); the CPU form never run each frame (Scope, no criterion); `view3d`'s refusal of a refused document; the
operator-time and storage caps' own refusals; point and `along` shapes; disk and ring on surface.

## Upstream tests (the Oracle lane)

The oracle page lists no upstream test for any criterion ("Every criterion stays with our own fixtures and formulas").
None is ported.

## Criteria 12 to 16: the surface emitter

Written by a second blind job, from issue #449 (its Scope lines on `surface {of}`, `inherit`, `follow`, bounds over the
emitter's span and the 1,048,576-triangle cap, and criteria 12 to 16), the design and base `cbd5e4f98`, starting from
this suite's commit `e97ea3607`; it saw no implementation, and none existed. Everything above holds for these files: the
builds, `runGpu`, the `particles` call and its reader, `view3d`'s `particles` field, `outsideBounds`, `chiSquared` and
`chi2Bound99`, the gates (no cargo is BLOCKED; a GPU test off macOS or on `unsupported_platform` is INCONCLUSIVE) and the
timeouts. This section adds to what's above and changes none of it; `helpers.ts` gains an appended block.

### What was read for them

- The issue's Scope lines and criteria 12 to 16, live. The design has no section on surface emission past the issue:
  `docs/canvas-primitives.md`'s emit regions lists the analytic shapes alone, and `docs/technical-design.md`'s Particles,
  closed form names none of these fields. Units and axes (Euler angles in degrees, R = Rz·Ry·Rx, right-handed, +Y up)
  and the path grammar (`items/<id>/at/rot/1`) settle the turntable's turn.
- At the base, only for how a mesh, a skinned item and a turning item are written: `crates/deep-canvas-scene3d/src/`
  `fixtures.rs` (`skin`), `scene.rs` (which kinds give a mesh; `local_of`), `builders.rs` (`KINDS`);
  `crates/deep-gpu-layer/src/effects.rs` (`sparks_of`); and `tests/acceptance/419/README.md`'s Assumed surfaces 9 and its
  walker, the base's one skinned fixture.

### What the base does

No surface emission, `follow` or `inherit`, and nothing counts a surface's triangles: the base's operator reads an
object `emit.shape` other than `along` as a point at the item. `fixture.skin@1` draws in `view3d` as a mesh pre-skinned
at each time (#419), and a channel turns an item through `items/<id>/at/rot/<axis>`.

### Surface additions

No new call, request field or reply field: these tests read the `particles` call's `born`, `from`, `velocity`, `cpu` and
`bounds`, and `view3d`'s `pixel_hash` and `particles` field, as defined above. What they add:

- **`emit.shape: {"surface": {"of": "<item ID or collection ID>"}}`**, the issue's `surface {of: item ID | collection}`,
  a one-key object as the other shapes are; a collection is the document envelope's `collections` entry. `emit.on` isn't
  read with it. A birth point lies on the named items' evaluated triangles at the particle's birth time, in the world.
- **`follow: bool = false`**, a field of the particles item's `params`, beside `inherit`.
- **`inherit: {normal: f32 = 0, velocity: f32 = 0}`**, the issue's field. With a surface emitter, `velocity` scales the
  birth point's own velocity. A particle's launch velocity is its motion's own (`motion.ballistic.velocity`, or `v0`'s
  seeded one) plus that, and the `particles` call's `velocity` reports the sum.
- Every particles item here sits at the world origin, unrotated, still and unanchored, so nothing decides whether a
  surface particle's place and motion are in the item's frame or the world's.
- **A refusal**, a row for the table above (an error, in a `refused` outcome):

| Refusal | `ids` holds | `path` | `actual` |
|---|---|---|---|
| a mesh that `emit.shape.surface.of` names (the item, or a member of the collection) holding more than 1,048,576 triangles | the mesh item and the particles item | `items/<id>/params/emit/shape/surface/of` | `{"triangles": n, "cap": 1048576}` |

  The test reads `ids`, `path` and `actual.triangles`.

**Mesh items are `fixture.skin@1`**, exactly as #419's README (Assumed surfaces 9) defines it: `params: {positions,
triangles, joints, weights, bones: [{id, parent, pos, rot}]}`, each time pre-skinned by Σ wᵢ · world(bᵢ) · bind(bᵢ)⁻¹ · p,
channels keying `items/<id>/params/bones/<i>/rot/<axis>`; here with `paint: {fill: {role}}`. It is the one kind at the
base whose document holds a mesh's own positions and triangles, so a test knows every triangle it judges a particle
against (a builder's sphere tessellates as its code chooses, and 1e-5 m is far inside a coarse sphere's chords), and it
is the base's only skinned item (skinned playback of imported assets is #526, open). A still mesh is one bone that
nothing turns.

### Planted programs (`deep-gpu run --planted <name>`)

| Name | Criterion | The wrong program |
|---|---|---|
| `surface_triangles_uniform` | 12 | the surface emitter picks each triangle with equal chance instead of by its area (CPU and compute operator) |
| `surface_bind_pose` | 13 | the surface emitter evaluates a skinned item in its bind pose (every bone's `rot` zero), at a particle's birth and, with `follow`, at t (CPU and compute operator) |
| `inherit_previous_frame` | 14 | `inherit.velocity` takes the birth point's velocity as its position at the birth time less that place's position at the last frame the process drew before the birth, over their gap; where the process drew no frame before the birth (one opened at a later frame, or the `particles` call) it inherits nothing (CPU and compute operator) |
| `bounds_bind_pose` | 15 | a surface emitter's bounds are its surface's bounds in the bind pose (every bone's `rot` zero), at its place at t and widened by the motion's reach, instead of over the emitter's span |

### Fixtures (helpers.ts, as session documents)

- `shapesDoc`: a unit cube centred at (−1, 0.5, 0) (12 triangles of 0.5 m²) and a sphere of radius 0.5 m centred at
  (1, 0.5, 0), 16 segments by 8 bands with a vertex at each pole (224 triangles of 0.0071 to 0.019 m²; a sampler
  uniform over triangles gives each pole sliver about 278 particles where its area gives 52, and each cube triangle 278
  where its area gives 3,624), the collection `shapes`; `grit` bursts
  its count at 0 s on the collection, holding still 10 s. A showpiece, so 65,537 checks.
- `walkerDoc`: a character walking in place, a `fixture.skin@1` of seven bones: a still root at the hips (y = 1 m)
  carrying a torso and a head, each thigh swinging ±25° about X through a 1 s stride, each shin bending 10° to 45° at its
  knee, each arm swinging ±20° against its leg (64 vertices, 96 triangles, its limbs reaching from z = −0.51 to 0.37 m
  against its bind pose's ±0.1 m). The four corners at each knee are weighted half to the thigh and half to the shin, so
  the triangles across a knee deform and a particle that keeps its place on one stays on it only if its place is taken
  on the triangle as it deforms. `dust` bursts its count at 0.1 s on the walker with `follow: true`.
- `turntableDoc`: a band of radius 1 m and height 0.1 m about the Y axis (256 segments, every point within 7.6e-5 m of
  1 m from the axis), its `at/rot/1` keyed linearly from 0° at 0 s to 720/π° at 4 s: 1 rad/s, a right-handed turn about
  +Y. `sparks` bursts 128 particles at each of 0.5, 1, 1.5 and 2 s with `inherit.velocity: 1`, living 1.5 s.
- `ac16`'s sheet: a 1,024 × 512 grid of unit quads and one triangle beside it, 1,048,577 triangles (a 40 MB document).

### Criteria to tests

| Criterion | File | What it reads and asserts | Wrong programs it fails |
|---|---|---|---|
| AC12 `#449.cedb9c33` surface points, per-face chi-squared, adding moves none | `ac12-surface-sampling.test.ts` | 65,536 particles at 1 s: each within 1e-5 m of the nearest of the 236 triangles; counts per triangle against n × area ÷ total area under `chi2Bound99(235)` (288.354); with a burst of 65,537, rows 0 to 65,535 bit for bit equal and row 65,536 on the surface | `surface_triangles_uniform` (fails the bound naming its worst face); points off the surface or placed by the bind pose; a sampler drawing from a stream |
| AC13 `#449.1855dc44` follow on a skinned walker; seek equals play | `ac13-follow-skin.test.ts` | 4,096 particles: each birth point within 0.1 mm of a triangle of the walker as the test skins it at the birth time, and the particle within 0.1 mm of that triangle at 50 random times in (0.1, 2) s; `view3d` at 30 fps, frames 7, 23, 41, 58 sought equal to played by pixel hash (the four differ, 4,096 live) | `surface_bind_pose` (fails naming the particle); a follow that skins a point by its blended weights rather than keeping its place on the triangle; no follow; a frame carried between frames |
| AC14 `#449.a386d09b` inherited velocity on a turntable | `ac14-inherit-velocity.test.ts` | 512 particles: each born within 1e-4 m of 1 m from the axis; its reported launch velocity, and its positions' (place 0.25 s after its burst − birth point) ÷ 0.25 s, 1.000 m/s within 0.001 and within 0.001 m/s of (p.z, 0, −p.x); `view3d` at 30 fps, frames 20, 40, 55, 70 sought equal to played by pixel hash and evaluated-data hash | `inherit_previous_frame` (fails at a sought frame, naming the frame); a velocity from an earlier frame or a one-sided difference; a turn's sign or rate wrong |
| AC15 `#449.bfe8ad15` surface bounds | `ac15-surface-bounds.test.ts` | The cube and sphere and the walker at 256 particles, and the turntable: at 1,000 random times each live particle inside its item's bounds (1e-9 m); live at more than 500 of the times | `bounds_bind_pose` (fails on the walker, naming dust and the time); bounds without the turn's sweep or the inherited velocity's reach |
| AC16 `#449.8688e46a` 1,048,577 triangles refused | `ac16-triangle-cap.test.ts` | The check alone: refused, an error naming heavy and grit at `items/grit/params/emit/shape/surface/of` with `actual.triangles` 1,048,577 | a surface whose triangles aren't counted at check; a refusal that names neither the mesh nor its count |

Every one of these tests fails at the base at the missing surface (`BASE-FAILURE.txt`). None passes on a program that
does nothing: each reads positions, velocities, bounds, hashes or issues the program must produce, and holds guards
(counts, live rows, frames that differ) that an empty or still answer fails.

### Readings where the issue leaves a choice

- **A face is a triangle**, as the base's mesh holds one face per triangle of a `fixture.skin@1`, and "the surface" is
  the meshes' triangles, not the round sphere they approximate. The cells are all 236 triangles of both meshes, so the
  statistic tests the split between the cube and the sphere as well as within each.
- **"Adding a particle"** to 65,536 makes 65,537, past a figure's cap, so the fixture is a showpiece.
- **"Their triangles"** is read without a new reply field: the test skins the walker itself and takes a particle's
  triangles to be those its birth point lies within 0.1 mm of at its birth time (one, or a few on an edge); it must stay
  within 0.1 mm of one of them at every sampled time. A skinned character walking in place is the `fixture.skin@1`
  walker above, its root still.
- **Criterion 13's seek** compares pixel hashes, as it says; criterion 14's compares pixel hashes and evaluated-data
  hashes, so a velocity carried between frames on either the CPU or the compute operator is caught.
- **The turntable** turns by a channel on `at/rot/1`; Units and axes make a positive turn about +Y right-handed, so a
  point at p moves at (0, 1, 0) × p. Births at 0.5 to 2 s keep the birth time ± half a step inside the channel's keys.
  "Start at" is read twice: the `velocity` the call reports and the one the particle's own positions give, which are
  equal when no gravity or drag acts.
- **"Both fixtures"** (criterion 15) doesn't say which two of the three surface fixtures; every one is read. Each is a
  case the Scope's bounds ("enclose every live particle at t") must hold.
- **"Naming the item and the count"** (criterion 16): the issue names both the mesh and the particles item that names it
  as a surface, as the `land.on` refusal does; the count is `actual.triangles`.

### Not tested here

`inherit.normal`; `inherit` on occurrence bursts or another item's particles; `follow` on a rigid or still item; a
surface of a builder, a `mesh.asset@1` or a collection with a moving member; the content-keyed area table itself (only
its effects); `follow`'s per-particle operator time; the compute operator's columns for surface particles (criterion 8
reads its own fixture); a mesh of exactly 1,048,576 triangles passing.
