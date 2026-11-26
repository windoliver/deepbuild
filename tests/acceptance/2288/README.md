# Acceptance tests for #2288: each: over a moved, turned or scattered instancer

Written first, from issue #2288 (its Scope and three acceptance criteria), the design sections it names and base commit
`b6317234f` ("Merge pull request #3101 …", which holds #1921's, #2013's and #1918's merges), by a job that never saw an
implementation; none existed, and no other worktree, branch or pull request was read. There is no Oracle page for #2288
(the oracles repo answers 404), so there is no Oracle lane. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one file per criterion, criterion 1's
two clauses as two tests because each needs its own run (`deep-physics` alone, then `deep-show` playing).

## What was read

- The issue, live with `gh issue view 2288 --repo windoliver/deepbuild`. AGENTS.md.
- `docs/technical-design.md`: The physics module (`node scripts/design-section.mjs --issue 2288`).
- `docs/canvas-primitives.md`: Units and axes (degrees, R = Rz·Ry·Rx); Item and kind (`at`); Attribute and field:
  distribute; Instance `instance@1` ("element world = instancer world × TRSk", `from: distribute(…)`); World and backend
  `physics.world@1`; Shape; Body `body@1`; Physics output; Checkpoint ring (the step hash); Bake; Golden.
- At the base, read only for the surfaces these tests extend: `tests/acceptance/1921/` (README, helpers, ac1, ac2, ac4,
  ac5), `1918/helpers.ts` and a fixture of it (a scene's `channels`), `2009/helpers.ts`, `2010/helpers.ts`, `2013/`
  (README, helpers: the `geometry` call's scatter row); `crates/deep-physics-rapier` (`bound.rs`, `scene.rs`,
  `runner.rs`'s `subject`, `check` and `issue`, `lib.rs`'s build order); `crates/deep-canvas-physics` (`written.rs`,
  `occurrence.rs`'s `id_order` and `built_order`); `crates/deep-canvas-scene3d` (`distribute.rs`'s fields, samplers and
  `Row::to_json`, `scene/scattered.rs`'s `elements_at`); `crates/deep-show` (`geometry.rs`'s instancer row,
  `physics.rs`, `played.rs`); `scripts/proof-change.mjs` (criterion IDs), `scripts/lanes.mjs` (`alone`, lane files).

What the base already does, which these tests don't credit: `deep-physics` checks and bakes a scene's world, answers
`built` and #2010's `step_hashes`, builds an `each:` body over an instancer that sits at the origin, unturned, with its
own `ids`/`pos`/`rot` columns, and orders element bodies by `id_order` (a declared `rock#10` too). `deep-show`'s `eval`
reads an instancer's `params/pos` and `params/rot` and an item's `at/pos` and `at/rot`; a `<body>#*` output writes the
bodies' world poses into the columns. #420's `geometry` call answers a scatter's elements (#2013). The base refuses an
`each:` body over an instancer whose world transform at t = 0 is moved or turned, or whose params hold `from`, with
`physics.unsupported` at `bodies/<body>/each`, naming #2288.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/2288 --testTimeout=600000 --hookTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/2288/tsconfig.json
rm -rf tests/acceptance/2288/node_modules/.vite
```

Each file builds what it drives once, in `beforeAll`, through #1921's helpers (imported read only, as #1921 imports
#1918's): `deep-physics` by `cargo build --locked --bin deep-physics` (every file, #2009's helper), `deep-show` by
`cargo build --locked -p deep-show --bin deep-show`, the default `full` set (`ac1`, `ac2`, #1918's helper), honoring
`CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set, and each binary copied into a
temporary folder. Every test passes #2009's 60-minute `TIMEOUT`. Stores, documents and binaries are temporary and
deleted. Node built-ins and vitest only. No process is started but `cargo`, `deep-physics` and `deep-show`, each waited
for, none stopped by name or port. No cargo on this machine is `BLOCKED:` (#2009's helper), a failed test, never a pass.
Nothing here draws on the GPU or times a step, so no test is INCONCLUSIVE by host or load.

**Lane.** `lane.json` in this folder (#1327's lane file) runs the folder alone: its files build cargo binaries and
bake and play 100- and 200-body worlds. No timed grant is needed. `scripts/lanes.mjs` needs no edit.

`BASE-FAILURE.txt` is the run at the base: all three files ran, and each of the 4 tests fails at an assertion because
the behavior is absent (`physics.unsupported` at `bodies/<body>/each`, and for criterion 3 no issue naming the channel).
With the binaries already built the run takes about 35 s; a cold build takes about 12 min for `deep-physics` and 24 min
for `deep-show` on this Mac under load.

## The surface under test

The issue names `each:`, `<body>#*` outputs, a scatter (`from: distribute(…)`), a twin world, a channel and "at check",
but no command line. Every call and reply field below is #1921's, #1918's, #2010's or #2013's as their READMEs give them;
**what this suite adds is behavior on those surfaces, not new calls**, plus one refusal. The implementer builds exactly
this, or a dispute goes to a blind redraft.

### The world document: what this suite adds to #1921's

- **`body@1 {each: "<instancer ID>"}` over a moved or turned instancer**: element `e`'s body `<body>#<e>` is built at
  the instancer's world transform at t = 0 times its row (Instance `instance@1`: element world = instancer world ×
  TRSk): position `T + R·p`, rotation `q_T · q_row`, with `T`, `R`/`q_T` the instancer's evaluated `at` (here `pos`
  (5, 0, 0), `rot` [0, 90, 0] degrees) and `p`, `q_row` its row's `pos` and `rot`. No refusal.
- **An output `{from: "<body>#*", read: "pose", to: "items/<instancer ID>"}`** over such an instancer writes each element
  body's pose into its row **in the instancer's own frame**: `pos = Rᵀ(p_body − T)`, `rot = q_T⁻¹ · q_body`, so the
  element drawn there (instancer × row) is where the body is. Rows in the instancer's own row order, as #1921 has it.
- **`body@1 {each: "<instancer ID>"}` over a scatter** (an instancer whose `params` hold `from: {distribute: {…}}` and no
  written columns): one body per scattered element, `<body>#<element id>`, built in element-ID order (ascending u32, as
  #1921's canonical order has it) at the element's evaluated pose, the instancer's world transform × the element's
  transform. The element IDs and poses are the scatter's own, the ones #420's `geometry` call answers (#2013's row:
  `{id, proto, pos (world m), yaw, scale, rot?}`). No refusal.
- **The refusal at check (criterion 3)**: a world with an output writing an instancer's columns (`<body>#*` to
  `items/<instancer>`) in a scene whose `channels` hold a channel on that instancer's transform (here
  `items/tiles/at/pos`) is refused by the world's check in its scene: an issue of `severity: "error"` that names the
  instancer's ID and the channel's ID (its key in the scene's `channels`), each in the issue's `ids`, as a segment of
  its `path`, as a word in its `what`, or as its `actual`. The base has no fitting code; this suite names it
  **`physics.moved_instancer`**, at `outputs/<output ID>` (or `bodies/<body>/each`), with `actual` the channel's ID and
  `what` naming both. The test judges only the severity and the two names, not the code text or the path.

### `deep-physics` (#2009's JSON lines; #1918's scene calls; #1921's and #2010's reply fields)

| Call | Read here |
|---|---|
| `{"call": "check", "scene", "world": "<world ID>"}` | `ok`, `issues` (errors by `severity`), `built` |
| `{"call": "bake", "scene", "world": "<world ID>", "steps", "every"?}` | `bodies.<address>[k]` `{pos, rot}` after k × `every` steps; `step_hashes` (one per step, 0 as built) |
| `{"call": "check", "world": <document>}`, `{"call": "bake", "world": <document>, "steps", "read": []}` | the twin's errors and `step_hashes` |

### `deep-show run` (#393's scenario; #1918's build)

- `{"call": "deep_show", "session", "doc", "document", "include": ["issues"]}`: `outcome: "presented"`.
- `{"call": "eval", "doc", "t", "paths"}` (#1918's, flicks): `values` for `items/tiles/params/pos` (`[x, y, z]` per
  row), `items/tiles/params/rot` (`[x, y, z, w]` per row), `items/tiles/at/pos` and `items/tiles/at/rot` (Euler degrees
  or a quaternion). Successive calls in time order play the document. Values are read as numbers; this suite doesn't
  require them to be f32.
- `{"call": "geometry", "doc", "items": ["rocks"]}` (#420's, #2013's row): `items[].elements[]` `{id, pos, rot?, yaw,
  scale}`.

## The fixtures (helpers.ts)

g = 9.81 m/s², 120 Hz, 4 substeps, seed 2288; #1921's materials (`ground` friction 0.6, `block` friction 0.5, density
500, restitution 0); `ground` a static plane y = 0, normal +Y. Scenes at 60 fps, so frame f is step 2f exactly.

- **The turned lab** (`turnedScene`, world `turned`, 2 s): `tiles`, an `instance@1` at `pos` (5, 0, 0), `rot`
  [0, 90, 0] (the issue's numbers), prototype `chip` (a hidden 0.3 m `mark.box@1`), 100 rows: row i holds element
  (37 × i) mod 100, at ((i mod 10) × 0.5 − 2.25, 0.5 + 5i ÷ 128, ⌊i ÷ 10⌋ × 0.5 − 2.25) in its own frame (exact in f32),
  turned ((11 × i) mod 61) − 30 degrees about +X (an f32 quaternion), so the instancer's turn about +Y and the row's
  about +X don't commute. Bodies: `ground`, and `tile` (`each: "tiles"`, a 0.15 m half-extent box) written back by the
  output `written` (`from: "tile#*"`, `to: "items/tiles"`). Capacity 101 bodies and shapes. With the channel (criterion 3):
  the scene's `channels.nudge` moves `items/tiles/at/pos` from (5, 0, 0) at 0 s to (6, 0, 0) at 1 s, linear.
- **The scatter** (`scatterScene`, world `scatter`, 5 s, 600 steps): `slab`, a 16 × 16 m `plate@1` (grid [1, 1]) at
  (0, 2, 0); `pebble`, a hidden 0.5 m `mark.box@1`; `rocks`, an `instance@1` at the origin with `of: ["pebble"]` and
  `from: {distribute: {on: "slab", mode: "poisson", min_distance: 0.9, seed: 2288, max: 200, yaw: [-60, 60],
  tilt: 30}}`. Bodies: `ground`, and `rock` (`each: "rocks"`, a 0.25 m half-extent box). Capacity 201. The same scene with
  no `worlds` is what `geometry` reads the scatter from.
- **The one-by-one twin** (`oneByOne`): the scatter's world with `ground` and the 200 bodies declared one by one in
  element-ID order, each under its element body's address (`rock#<id>`), with the each-body's fields and its element's
  `pos` and `rot` exactly as the `geometry` row gives them, and nothing else.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s, computed from the live issue. Each test title starts with `AC<n> #2288.<id>`.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| AC1 `#2288.392506fb` | `ac1-turned-instancer.test.ts` (2) | (built) The turned lab checks with no error; `built` is `ground` and `tile#0` … `tile#99`, the element bodies in element-ID order; each `tile#<e>`'s built state is the instancer's world transform × e's row within 1e-6 m. (played) Every body falls more than 0.1 m by step 240 (on the bake); in `deep-show`, at every frame 0 … 120 the instancer reads `at/pos` (5, 0, 0) and `at/rot` 90° about +Y within 1e-6, and each row of `params/pos` and `params/rot` is its element body's pose after step 2f, in the instancer's own frame, within 1e-6 m. Fails: bodies built at the bare row, or with the turns multiplied the other way round; world poses written into the columns; columns that don't follow the bodies; rows mixed between elements |
| AC2 `#2288.015cbad4` | `ac2-scatter-twin.test.ts` (1) | The scatter alone has 200 elements, distinct u32 IDs, scale 1, on the plate, at least 0.9 m apart; the scatter world checks with no error; `built` is the 200 `rock#<id>` in ascending numeric ID order beside `ground`; each is built at its element's pose within 1e-6 m; the twin checks with no error; the 601 step hashes (as built, then after each of 600 steps) of the world and its twin are equal at every index, and the last isn't the first. Fails: a build in row, text or any other order; an element body at another's pose or off its element's; a missing or extra body; element bodies stepped with other fields or IDs |
| AC3 `#2288.e6a5f511` | `ac3-channel-moved-refused.test.ts` (1) | The turned lab with the channel `nudge` on `items/tiles/at/pos` is refused at check with an error naming `tiles` and `nudge`; the same lab with no channel checks with no error. Fails: no refusal; a refusal that doesn't name the channel (the base's `physics.unsupported`) or the instancer; one that refuses every turned or written instancer |

Test count: 2 + 1 + 1 = 4.

## Readings where the issue leaves a choice

- **"Builds each body at the instancer's world transform × its row"**: the bake's state of `tile#<e>` as built (step
  0), against `T + R·p`, `q_T · q_row` computed here in f64 from the issue's (5, 0, 0) and 90° about +Y (R = Rz·Ry·Rx)
  and the row's numbers.
- **"Within 1e-6 m"** holds a pose, position and rotation, to one tolerance in metres: the eight corners of the body's
  own box (the tile's 0.3 m, the rock's 0.5 m) placed by the two poses are each within 1e-6 m of each other. The same
  judge holds the built poses (criteria 1 and 2) to 1e-6 m: the backend keeps f32, whose rounding at these places
  (under 16 m) is at most 4.8e-7 m. Measured at the base on the turned lab's bodies declared one by one at the
  instancer × row (a stand-in, not committed): built within 9.4e-9 m of the f64 poses; their poses over 240 steps
  (world x 2.59 m to 8.48 m) taken into the instancer's frame and rounded to f32 move 1.9e-8 m at most; every tile
  falls at least 0.35 m by step 240, and 65 pairs of tiles touch.
- **"Its columns played for 2 s read back each body's pose in the instancer's own frame"**: one `deep-show` session
  evaluated at every frame 0 … 120 in order; at frame f, row r of `params/pos`/`params/rot` against the bake's pose of
  that row's element body after step 2f (`every: 2`, so sample f), taken through the inverse of the instancer's world
  transform: `Rᵀ(p − T)`, `q_T⁻¹ · q`. The instancer's own `at` is read at every frame too and stays (5, 0, 0), 90°
  about +Y, so the element drawn, instancer × row, is where the body is. A frame at a step needs no interpolation, so
  the comparison holds to the step's pose.
- **"The scatter's poses"** are the poses the scatter module evaluates for the instancer: the `geometry` call's row of
  the same scene with no world (so the world's acceptance can't change what is read), `pos` in world metres and `rot`
  its quaternion (every element leans, `tilt: 30`, so every row has one). The instancer sits at the origin unturned, so
  world and own frame agree; turning a scatter is criterion 1's transform rule and isn't judged twice.
- **"200-element scatter"**: poisson with `max: 200` over a plate that holds more, so the scatter lays out exactly 200;
  their IDs are the sampler's (0 … 199 at the base's sampler, read from the row, not assumed). `yaw` is kept within
  ±60° and the lean within 30°, so each element's turn is under 90° and any conversion to a quaternion gives the same
  sign, which the step hash reads by its bits.
- **"The same per-step world state hash"** is #2010's `step_hashes`, each body's ID with its pose and velocity bits, at
  every index 0 … 600; the twin declares its bodies under the element addresses, so the same bodies, IDs and canonical
  order (#1921's `id_order`). Measured at the base on the twin (not committed): it builds within 3.2e-7 m of the
  scatter's poses, 77 pairs of rocks touch as they land and tip, 202 rest; the same twin declared in its addresses' text
  order gives the same hashes, and one element 1 mm off changes the hash from index 0.
- **"At check"** is `deep-physics`'s `check` of the world in its scene (#1918's call), the one that already holds a
  scene's world refusals (`bound.rs`'s each-refusal, `scene.rs`'s path refusals); `deep-show`'s physics module bakes
  through the same subject and refuses what it refuses (`physics_refused`), which this suite doesn't test again.
  **"Naming the instancer and the channel"**: the instancer's item ID and the channel's ID (its key in the scene's
  `channels`), not the channel's target path. **"Moved by a channel"**: a channel on the instancer's `at/pos` that keeps
  it where its `at` puts it at t = 0 and moves it from there, so the build at t = 0 alone can't see it.

## Not tested, because no criterion reaches it here

A scaled instancer (#1921's refusal stands); a parent's transform reaching an instancer; a channel on `at/rot` or on a
parent; a scatter on a moved or turned instancer, or projected and aligned; a `<body>#*` output over a scatter; a world
with no output beside a channel-moved instancer; `deep-show`'s refusal of the channel case; interpolated columns between
steps; seeks; draws and uploads (#1921's criteria 3 and 6 stand). Follow-ups for the implementer's own tests.
