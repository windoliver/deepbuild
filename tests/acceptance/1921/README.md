# Acceptance tests for #1921: sizes in metres without scale, and one body per instancer element in one instanced draw

Written first, from issue #1921 (its Scope, its Fields, six acceptance criteria and its Proof line: "The 800-body
world's draw list and step hashes beside its one-by-one twin, with the planted outputs' failures"), its Oracle page
(`doneright/oracles/issues/1921.md` in DeepBuildAI/deepbuild, branch `doneright`: no upstream test for any criterion, so
none is ported), the design sections it names and base commit `35df4523f` ("Merge pull request #2280 …", which holds
#1918's, #2009's, #2010's, #2011's and #2012's merges), by a job that never saw an implementation; none existed, and no
other worktree, branch or pull request was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test per criterion clause that needs its own
run, plus the two planted twins the criteria name.

## What was read

- The issue, live with `gh issue view 1921 --repo windoliver/deepbuild`, and its Oracle page.
- `docs/technical-design.md`: Scenes, physics and the canvas core; The physics module (World; Shape, body; Input,
  occurrence, output; Bake and golden; Behavior kit); The canvas core (canvas modules, phases, the column view);
  Dogfooding and Tests written first. AGENTS.md.
- `docs/canvas-primitives.md`: Units and axes (rotations: degrees, R = Rz·Ry·Rx); The path grammar (`#` sub-addresses);
  Document envelope (`worlds`); Item and kind (`at`: pos, rot, scale); Phase; Array and table, and its column view;
  Marks in 3D (`mark.box`, `mark.sphere`); Instance `instance@1` and its logic columns; World and backend
  `physics.world@1` (`capacity`, `budget.step_p95 = 2`); Shape; Body `body@1`; Physics output; Checkpoint ring; Bake;
  Golden; Physics: behavior kit.
- At the base, read only for the surfaces these tests extend: `tests/acceptance/1918/`, `2009/`, `2010/`, `2011/`,
  `2012/` (READMEs, helpers, a test each), `484/` (README, helpers, two tests), `1903/` and `2013/` (helpers: instancer
  scenes), `378/helpers.ts`; `crates/deep-physics-rapier` (`runner.rs`, `main.rs`, `scene.rs`, `lib.rs`'s canonical
  state), `crates/deep-canvas-physics` (`doc.rs`, `doc/reads.rs`, `check.rs`, `golden.rs`); `crates/deep-show`
  (`physics.rs`, `geometry.rs`, `query.rs`, `frames.rs`'s `eval`, `main.rs`'s scenario `planted`);
  `crates/deep-gpu-layer/src/view3d.rs` (request fields, `evaluate`, `counts`), `crates/deep-scene3d-render/src/lib.rs`
  (`Counts`); `crates/deep-canvas-scene3d` (`cut.rs`: an instancer's columns, `scene.rs`: `elements_at`);
  `scripts/physics-budget.mjs`, `scripts/proof-change.mjs` (criterion IDs), `scripts/lanes.mjs` (`alone`).

What the base already does, which these tests don't credit: `deep-physics` checks, bakes and restores a world in its
scene (`scene` with `world: "<world ID>"`, #1918), answers #2010's `step_hashes` (each body's ID, then its pose and
velocity bits), the occurrence list with `rest` rows, and #2011's `time`; it reads `capacity` but refuses nothing by it,
accepts a plane shape, and takes any string as a declared body ID, `#` included. Its world reader refuses `item` and
`each` on a body (`unknown_field`) and a `from` of `<body>#*` (`ref_unresolved`). `deep-show` turns an output with
`to: items/<id>/at` into channels on `at/pos` and `at/rot` only, so an item's own scale already stays; `eval`'s `paths`
read an item's `at/pos`, `at/rot`, `at/scale` and its params. `deep-gpu`'s `view3d` draws an instancer of more than 256
elements by one indexed indirect draw per batch and view (#484), reports `encoded`, `indirect_draws` and
`instances_written` with `counts`, and evaluates paths with `evaluate`; it doesn't run physics (its `worlds` are
#419's `fixture.world@1` items). `scripts/physics-budget.mjs` times a world document, not a scene's world.

Checked at the base before the run, with a probe (not committed) on the base's `deep-physics` and plain world documents
standing in for the fixtures (no `item`, no `each`, the 800 bodies declared under their element addresses): the sized
crate dropped 0.5 m lands at step 39 and rests with its centre at 0.99995 m, asleep by step 240, 4 mm across the plane
from where it was dropped; the die spins at 90°/s about +Y until it lands and stops turned 54°; in the drop, all 800
bodies land (800 contact_begin, 800 hit) and fall asleep (800 rest rows, the last at step 326, no wake), 115 are still
awake at step 300, no body's pose changes after its rest row, the moving elements of one instancer between two 60 fps
frames form at most 31 runs of consecutive rows (so within the column view's 64 changed ranges), 108 frames hold
sleeping and moving bodies together, and from frame 164 on no pose changes (137 frames). The base's answer to criterion
1's check is `unknown_field` at `bodies/box/item`.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/1921 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/1921/tsconfig.json
rm -rf tests/acceptance/1921/node_modules/.vite
```

Each file builds what it drives once, in `beforeAll`, honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and
`CARGO_PROFILE_DEV_DEBUG=0` unless set and Homebrew's rustup put on PATH when present (#2009's helper), and copies each
binary into a temporary folder:

- `deep-physics`: `cargo build --locked --bin deep-physics` through `../2009/helpers.ts` (every file).
- `deep-show`: `cargo build --locked -p deep-show --bin deep-show`, the default `full` set, through
  `../1918/helpers.ts` (`ac1`, `ac5`).
- `deep-gpu`: `cargo build --locked --bin deep-gpu` (`ac3`, `ac6`).
- `ac6`'s budget test runs `node scripts/physics-budget.mjs`, which builds `deep-physics` in cargo's release profile
  itself (#2011).

Every test passes an explicit timeout: 60 minutes (#2009's `TIMEOUT`), or 2 hours for the budget (#2011's
`BUDGET_TIMEOUT`). Stores, documents and binaries are temporary and deleted. Node built-ins and vitest only;
`../1918/helpers.ts` (and through it `../2010/` and `../2009/`), `../2011/helpers.ts` (`BUDGET_SCRIPT`,
`BUDGET_TIMEOUT`, `LIMIT_MS`, `hostOf`, `reportFailures`, `timedFailures`) and `../484/helpers.ts` (`LOOK`, #484's
acceptance look) are imported read only. No process is started but `cargo`, `deep-physics`, `deep-show`, `deep-gpu` and
the budget script, each waited for, none stopped by name or port. No criterion names another machine, so there is no
Docker leg.

Gates: no cargo on this machine is `BLOCKED:` (#2009's helper), a failed test, never a pass. `deep-gpu` draws on macOS's
Metal device: off macOS, or when `view3d` answers `unsupported_platform`, a test that draws fails with `INCONCLUSIVE:`.
The budget is a timing: off the reference Mac, or under load, #2011's check reads INCONCLUSIVE and the test fails with
`INCONCLUSIVE:` and the check's reasons, never passing and never retried, after everything else the check reports is
judged. The upload counts don't depend on load and are asserted on any Mac.

`BASE-FAILURE.txt` is the run at the base: the two files that build only `deep-physics` were run, and each other file
says there why it fails at the base.

## The surface under test

The issue names `body@1 {each: instancer ID}`, `<body>#<element id>` addresses, `<body>#*` outputs, a body bound to an
item, a twin world, a draw list, a seek, uploads and a step budget, but no command line. **Every call, field, reply
field, flag and planted name below that the issue or the design doesn't give is this job's invention**, the smallest the
criteria need, extending #1918's, #2009's, #2010's and #2011's `deep-physics` and budget check, #393's and #1918's
`deep-show run`, and #378's and #484's `deep-gpu run` (their READMEs' surfaces stand as written). The implementer
builds exactly these, or a dispute goes to a blind redraft.

### The world document: what this suite adds

- **`body@1 {item: "<item ID>"}`** (a world in a scene): the body is bound to that item of the scene. It is built at the
  item's world transform at time 0, its position and its rotation, and takes no `pose` of its own. When that world
  transform scales the item (any axis of its scale, its own or its parents', other than 1), the world is refused at
  check with an error issue that names the item (in `ids`, as a segment of `path`, or as a word in `what`) and holds the
  scale as `actual` (`[sx, sy, sz]`, here `[2, 1, 1]`); its `fix` says to size the shape in metres instead. Binding
  writes nothing back: an output does (below).
- **`body@1 {each: "<instancer ID>"}`** (a world in a scene): one body per element of the scene's `instance@1` item,
  each with the body's own fields (`kind`, `shapes`, `mass`, …) and no `pose` of its own. Element `e`'s body has the
  stable ID `<body>#<e>`, its address everywhere: in `bake`'s `bodies` and `read`, in occurrence rows' `a` and `b`, in
  `step_hashes` (#2010's: the ID's text, then its pose and velocity bits) and in `built`. Each is built at its element's
  row: `pos`, and `rot` as a quaternion `[x, y, z, w]` (identity without a `rot` column). The world's bodies are built in
  canonical order: by stable ID, an each-body's elements in element-ID order (ascending u32) at its place, so a world
  with element IDs of four digits orders them as the same IDs declared as text would be.
- **A declared body ID may be an element address** (`"balls#1000"`), as criterion 4's twin declares them: it is a stable
  ID like any other, and such a world steps as the world whose `each:` body gives that element.
- **`capacity.bodies`** below the number of bodies a world builds, each element body counted, is refused at check: an
  error issue at `capacity/bodies` (or `capacity`) whose JSON names the capacity and the count, as numbers or words
  (here 399 and 400).
- **An output `{from: "<body>#*", read: "pose", to: "items/<instancer ID>"}`**, `<body>` an each-body over that
  instancer: at each frame it writes every element's position into its row of the instancer's `pos` column and its
  rotation into its row of `rot` (`[x, y, z, w]`), as f32, rows in the instancer's own row order; the instancer's
  other columns, `scale` among them, stay its own. At t = 0 it writes the built state.
- **An output `{from: <body>, read: "pose", to: "items/<id>/at"}`** writes the body's position and rotation into the
  item's transform and keeps the item's own scale (the issue's Scope; the base's `deep-show` already does).

### `deep-physics`: what this suite adds

| Call | Reply |
|---|---|
| `{"call": "check", "scene", "world": "<world ID>"}` (#1918's form) | #1918's, plus **`"built": [ID]`**: the world's bodies in the order the backend built them, element bodies by their addresses. With `world` a document, the same |
| `{"call": "bake", "scene", "world": "<world ID>", "steps", "every"?, "read"?}` | #1918's and #2010's, with element bodies under their addresses in `bodies` and in the occurrence rows |
| `{"call": "time", "scene", "world": "<world ID>", "steps"}` | #2011's `time` of a scene's world (for the budget check) |

### `deep-show`: what this suite adds

- The physics module runs `item:` and `each:` bodies and `<body>#*` outputs in a scene a session presents (#1918's
  `worlds`), refusing what the check refuses.
- **`eval`'s `paths`** (#1918's) also read **`items/<instancer>/params/pos`** and **`items/<instancer>/params/rot`**: the
  columns the frame draws, one row per element in the instancer's row order, `[x, y, z]` and `[x, y, z, w]`, each value
  an f32. Successive `eval` calls in time order on one document play it; a call at another time on a session is a seek
  (#497's convention). The suite also reads, as the base does, `items/<id>/at/pos`, `at/rot` (Euler degrees, R = Rz·Ry·Rx;
  a quaternion `[x, y, z, w]` is read too), `at/scale` (a vec3, or one number) and `params/size`.
- **The scenario's `planted`** (the base's top-level field) takes this suite's two names (Planted twins).

### `deep-gpu`: what this suite adds

- **`view3d` draws a scene that lists `worlds`** (inline `physics.world@1` documents, as `deep-show` takes them): each
  baked by the physics module over the transport's span, its outputs writing their items and instancer columns at each
  frame (frame n at t = n ÷ `fps`, step 2n here). The `doc` is the scene as a session holds it (an `id`, one writer
  layer).
- **`evaluate`** (#429's) reads `items/<instancer>/params/pos` as the column the frame drew.
- With `counts: true`, each frame adds **`"element_uploads": {"<instancer ID>": [element ID]}`**: per instancer, the IDs
  of the elements whose rows (any column) this frame wrote to the GPU; an instancer that wrote none maps to `[]` or is
  absent. Beside #484's `indirect_draws: [{item, view, batch}]` (`view` is `"view"` for the camera) and #378's
  `encoded: [{batch, items}]`, which stand as written.

### The budget check

`node scripts/physics-budget.mjs` (#2011) also takes **`{"scene": Scene, "world": "<world ID>", "steps",
"reference_mac": {"app", "web"}}`**, `world` a world ID of `scene.worlds`: every `deep-physics` call it makes passes
`scene` and `world` as given, and `limit_ms` is that world's `budget.step_p95` (2 ms by default). Its report is
#2011's. This suite asks with `reference_mac: {"app": true, "web": false}`.

## Planted twins

Each is a value of `deep-show run`'s scenario field `planted` (the base's mechanism for module twins), reachable only
there:

| Name | Criterion | The wrong program |
|---|---|---|
| `output_writes_whole_transform` | 1 | an output with `read: "pose"` to `items/<id>/at` writes the body's whole transform: its position, its rotation and a scale of 1 (a body has none), so the item's own scale is reset to 1 |
| `output_keeps_previous_columns` | 5 | a `<body>#*` output writes, at each frame, the columns it wrote for the frame its session drew before (a session's first frame, that frame's own), so play lags a frame and a seek shows the frame before the seek |

`twins.json` maps each criterion's ID to its twins.

## The fixtures (helpers.ts)

g = 9.81 m/s², 120 Hz, 4 substeps, seed 1921; materials `ground` (friction 0.6) and `block` (friction 0.5, density
500), restitution 0 everywhere, so nothing bounces; `ground` a static plane y = 0, normal +Y. Scenes at 60 fps, so frame
f is step 2f exactly and no output interpolates.

- **The crate lab** (`crateScene`, world `lab`, 2 s): `crate`, a `mark.box@1` (a unit solid centred on its origin,
  scaled by `size`) at (0, 1.5, 0), and `box`, the body bound to it (`item: "crate"`) with an output back to
  `items/crate/at`; `token`, a 1 m `mark.box@1` drawn at scale (0.5, 0.5, 0.5), driven by an output from `die`, a 0.5 m
  box with its own pose at (3, 2, 0) spun at 90°/s about +Y. `scaled`: the crate drawn 1 × 2 × 1 at scale (2, 1, 1)
  over a collider of half extents (0.5, 1, 0.5). `sized`: drawn 2 × 2 × 1 at scale 1 over half extents (1, 1, 0.5), the
  x half extent doubled instead, so resting on the plane its centre is 1 m up.
- **The pile** (`pileScene`, world `pile`): one body `crate` with `each: "crates"`, an instancer of 400 elements whose
  IDs 0 … 399 sit in its rows out of order (row i holds element (163 × i) mod 400), row i at
  ((i mod 20) × 1.5 − 14.25, 2 + ⌊i ÷ 20⌋, 0.5 × (i mod 3)) and turned (7 × i) mod 360 degrees about +Y; capacity
  `{bodies: 400, shapes: 400}`, or bodies 399 with shapes still 400. Its IDs have one to three digits, so element-ID
  order isn't the order of their addresses as text.
- **The drop** (`dropScene`, world `drop`, 5 s, 600 steps): instancers `boxes` (prototype `cube`, a 0.5 m `mark.box@1`
  in `box_mat`) and `balls` (prototype `bead`, a 0.5 m `mark.sphere@1` in `ball_mat`), 400 elements each with IDs 1000
  … 1399 in row order, on a 20 × 20 grid 1 m apart (boxes at z < 0, balls at z > 0), element 1000 + j dropped from
  1 + 3j ÷ 64 m (1 m to 19.70 m); bodies `boxes` and `balls` with `each:` over them (0.25 m half-extent cubes and
  0.25 m spheres), written back by `<body>#*` outputs; capacity 801 bodies and 801 shapes (each body has one shape
  use), 8,192 contacts; an unshadowed sun, so the camera's view is the only view drawn. Every place is exact in f32.
- **The one-by-one twin** (`oneByOneTwin`): the drop's world with the 800 bodies declared one by one in element-ID
  order, each under its element body's address with the each-body's fields and its element's pose, and no outputs.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed, computed from the live issue. Each `describe` and `it` title starts with its criterion's ID.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 `#1921.a5fff896` | `ac1-scale-out-of-physics.test.ts` (4) | The scaled lab's check holds an error naming `crate` with `actual` (2, 1, 1), and none naming `token`; the sized lab checks with no error. Baked 240 steps, `box` is built at (0, 1.5, 0) unturned and rests with its centre within 1 mm of 1 m, at rest; in `deep-show` at 2 s the drawn crate's eight corners (its size × its scale, at its evaluated transform) lie within 1 mm of its collider's (the body's pose after step 240, half extents (1, 1, 0.5)). Played at every frame 0 to 120, `token`'s scale reads (0.5, 0.5, 0.5) and its position (1e-6 m) and rotation (1e-5) are the die's after step 2f. `output_writes_whole_transform` fails that judge, naming `items/token`, its scale reading 1. Fails: a binding that takes the scale into the body or accepts it, a body not built at its item, a collider sized by the item, a drawn mesh off its collider, an output that resets or keeps out the scale, or doesn't write the pose |
| 2 `#1921.e4dd3dda` | `ac2-each-element-order.test.ts` (2) | The pile checks with capacity 400; `built` is exactly `crate#0`, `crate#1`, … `crate#399`; each `crate#<id>` is built at its own row's position (exactly) and rotation (1e-6). With capacity 399 an error at `capacity/bodies` names 399 and 400. Fails: a build in row order or in the addresses' text order, an element at another's pose, a missing or extra body, a capacity not enforced or a refusal naming one count |
| 3 `#1921.877e2ad5` | `ac3-one-instanced-draw.test.ts` (1) | `view3d` of the drop, frames 0 to 60: at frame 60 each instancer's evaluated `pos` column holds its bodies' positions after step 120 within 1e-6 m; at every frame the camera's view holds exactly one indirect draw of `boxes` and one of `balls`, in two batches, and no encoded batch draws an item whose ID holds `#`. Fails: poses not written back, elements drawn as items or as many draws |
| 4 `#1921.e35aba59` | `ac4-one-by-one-twin.test.ts` (1) | The twin checks; the drop's 601 step hashes (as built, then after each of 600 steps) equal the twin's at every index, and the last isn't the first. Fails: element bodies built in another order, at other poses, with other fields or under other IDs |
| 5 `#1921.ff1e7756` | `ac5-seek-columns.test.ts` (2) | Played frame by frame to frame 150 (step 300), both instancers' `pos` and `rot` columns are, byte for byte, their bodies' poses after step 300; a second session at frame 0 (where the bake's built poses are, byte for byte) seeked to frame 150 writes play's columns byte for byte. `output_keeps_previous_columns` fails that judge, naming step 300. Fails: a seek that keeps, lags or rebuilds the columns otherwise, values not the backend's f32s |
| 6 `#1921.bcd2acd3` | `ac6-budget-and-uploads.test.ts` (2) | `view3d` of the drop, frames 0 to 300: from frame 1 each frame's `element_uploads` per instancer are exactly the elements whose pose bits changed since the frame before, and none asleep since before the frame's first step (rest rows from the bake); the bake has 800 rest rows, some frames hold sleeping and moving bodies together, and some, once all sleep, upload nothing. The budget check on the app host: limit 2 ms, the host timed as #2011 times it, its verdict PASS (INCONCLUSIVE fails as such). Fails: uploads of every element, of none, of sleeping bodies, or with changed ones missing; a step over 2 ms |

Test count: 4 + 2 + 1 + 1 + 2 + 2 = 12.

## Readings where the issue leaves a choice

- **The surfaces.** The world's own behavior (criteria 1's refusal and rest, 2, 4, and the expected poses everywhere)
  through `deep-physics`, which #1918 already lets read a scene's world. What a scene's items and columns show at a frame
  (criteria 1 and 5) through `deep-show run`'s `eval`, the session that plays and seeks a scene. What a frame draws and
  uploads (criteria 3 and 6) through `deep-gpu`'s `view3d`, the GPU layer's own frame loop, which #484 reads for
  instanced draws; it gains the physics module as `deep-show` did in #1918. The budget through #2011's check.
- **"Bound to an item"** is a body declared with `item:`, built at the item's pose, as an `each:` body is built at its
  elements' (the Scope's "a body bound to an item whose world transform scales it" beside "built … at each element's
  pose"). An output alone doesn't bind: the criterion has an output drive an item drawn at scale 0.5 without a refusal.
  **"Naming the item and the scale"**: an error issue naming `crate` with `actual` (2, 1, 1).
- **"Rests on the floor at 1 m"**: its centre 1 m above the plane after 2 s, within the criterion's 1 mm, speed under
  1 mm/s. **"Its drawn mesh matching its collider within 1 mm"**: the drawn box's eight corners (its `size` × its
  evaluated `scale`, through its evaluated position and rotation) each within 1 mm of the collider's at the same time.
- **"Keeps the drawn scale while it writes the body's position and rotation"**: at every frame the scale is exactly the
  item's own and the pose is the body's within #1918's 1e-6 m (1e-5 on the rotation matrix, for the degrees). **"Resets
  the scale to 1 and fails, naming the item"**: the judge that passes the real output fails the twin with a failure
  naming `items/token`, and the token's scale reads 1.
- **"Builds 400 bodies in element-ID order"**: the order the backend built them (`built`), numeric by element ID, and
  each body at its own element's pose. **"Naming both counts"**: the issue's JSON holds 399 and 400.
- **"`each:`'s form, `<body>#<element id>` and `<body>#*`"**: `each` names the instancer; the address is the element
  body's stable ID everywhere a body ID appears; `from: "<body>#*"` with `to: "items/<instancer>"` writes the `pos` and
  `rot` columns.
- **"The frame's draw list holds exactly 2 instanced draws for them, one per prototype and material"**: in the camera's
  view, one indexed indirect draw per instancer (each has more than 256 elements, so its one batch is culled on the GPU
  and drawn indirectly: Instance `instance@1`), two batches, and no element drawn as an item of its own; held at every
  frame from 0 to 1 s, with the poses checked written back at 1 s, so a static instancer can't pass.
- **"The same world state hash"** is #2010's step hash after each step. It hashes each body's ID with its state, so the
  twin declares its bodies under the element addresses: the same bodies, the same IDs, the same canonical order. (The
  design's canonical hash, floats in canonical ID order, is then equal too.) "At every one of 600 steps": indices 0 to
  600.
- **"A seek to step 300 writes the instancer's columns byte for byte as play does"**: frame 150 reached by a session
  that played every frame against one that drew frame 0 and jumped; byte for byte as f32 bits, -0 apart from 0; play's
  columns also equal the bake's poses after step 300, so play can't be wrong with the seek. **"Fails, naming the step"**:
  a judge failure that starts `step 300:`.
- **"Budget … in the local preflight against the merge base"**: the check runs in the local preflight on the change as
  merged with its base; the budget is the absolute 2 ms of the world's default `step_p95`, judged by #2011's five-run
  rule on the app host (this Mac's release build). The base can't step `each:`, so nothing is compared with it. The web
  host isn't named, so it is asked without a reference Mac and not judged.
- **"Each frame uploads only the elements whose pose changed"**: exactly those, by position and rotation bits against
  the frame before, from frame 1 (frame 0 is a new reader, which uploads every row); an element missing would draw a
  stale pose, so missing ones fail too. The drop's moving rows stay within 31 runs, inside the column view's 64 changed
  ranges, so a reader that uploads changed ranges uploads exactly these. **"Sleeping bodies upload nothing"**: a body
  whose rest row is at or before the frame's first step (2f − 2) and that hasn't woken by step 2f uploads nothing in
  frame f; and the run must hold frames where some bodies sleep while others move, and frames that upload nothing.

## Not tested, because no criterion reaches it here

A parent's scale reaching a bound item; the refusal's `fix` text; scaled instancer elements under `each:`; outputs from
one element (`<body>#<element id>`) or of reads other than `pose` from `<body>#*`; interpolated columns between steps
(every frame here sits on a step); logic-fed instancers (`live`, `gen`); waking bodies' uploads; uploads past the column
view's 64 changed ranges; shadow cascades' draws; `instances_written`; the web host's budget; `capacity` of shapes and
contacts; 2D worlds. They are follow-ups for the implementer's own tests.

**`scripts/lanes.mjs` needs `'tests/acceptance/1921/'` in its `alone` list**: the files build cargo binaries
(`deep-show`, `deep-gpu`, and `deep-physics` in release for the budget), bake 800-body worlds, draw on the GPU and time
steps. This README is the instruction; the implementer makes that edit.
