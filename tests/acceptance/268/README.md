# Acceptance tests for #268: water that meets its shore: foam, calmer swell and shade from the distance to named static items, baked at check

Written first, from issue #268 (its scope, its Fields row, its seven acceptance criteria, its proof line: "The pile, quay
and deck fixtures with foam coverage, amplitudes and shade beside their expected values, and the planted twins'
failures", and its Oracle line), its Oracle page (`doneright/oracles/issues/268.md` in `DeepBuildAI/deepbuild`, branch
`doneright`), the design sections it links and those they lean on, and base commit `42319109` ("Merge pull request
#1745 …"), by a job that never saw an implementation. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one file per criterion, one test per
clause that needs its own run, plus exactly the two planted twins the criteria name.

## What was read

- Issue #268 and its Oracle page (no upstream test for any criterion; nothing pinned to port).
- `docs/canvas-primitives.md`: Material: water (its `shore` field, Semantics, Cost and "It can never"), Material,
  Material: mirror, Units and axes, Order keys (collections are maps keyed by ID), the document's `collections: {ID →
  {members: [ID] | rule}}`, Particles' `land` (the other bake of static items at check, refused the same way), Clip,
  Placement, World and backend `physics.world@1`, Body `body@1`, Physics output, Logic `logic@1`, Determinism class.
- `docs/technical-design.md`: Scenes, physics and the canvas core; Every task carries its own budgets; The reference
  Macs; Dogfooding; Tests written first.
- At the base, for call shapes only: AGENTS.md; `tests/acceptance/166/` (the model: README, helpers, every test, its
  tsconfig), `378/` (patches and `set` ops in `view3d`), `387/` (clips and placements); `crates/deep-gpu-layer/src/
  {main,view3d}.rs` (the call table, `view3d`'s fields and targets, `patches`, refusals as `{code, reason}` or `{code:
  "refused", issues}`, `Planted`); `crates/deep-canvas-scene3d/src/{water,scene,sets,fixtures}.rs` (how `water` is read
  today, `collections` read by members, `mark.cylinder@1`, `fixture.world@1`); `crates/deep-scene3d-render/src/mesh.rs`
  (the unit cylinder: radius 0.5, height 1, about +Y); `crates/deep-canvas-motion/src/doc.rs` (clips and placements);
  `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`, `validateBudgets`); `benchmarks/budgets.json` (#166's frozen
  `canvas-water`); `benchmarks/canvas.mjs` (its `water` mode); `scripts/proof-change.mjs` (`criterionId`);
  `scripts/lanes.mjs` (`alone`).

## What the base already does, which these tests don't credit

`view3d` draws scene3d documents with #166's water (waves, ripples, rain, foam by steepness, a wake, the bed tint),
`from` (a cold seek), `capture`, `patches`, the targets `final | linear | ids | pre_tone | dirt | scene | backdrop |
depth | reflection`, `timings` and each frame's `pixel_hash`. A document's `collections` are read only for lights'
receivers and casters. The water reads no `shore` (an unknown key it ignores), so the base draws every fixture here as
plain #166 water. There is no `foam` target, no `shore` call field or row field, no `canvas-water-shore` task and no
planted name of this suite's. So every test fails at the base on a refused call (the unknown target `foam`), an unread
field (the quay's swell at full height by the quay, the deck's water at its full radiance, the movers and the oversized
field drawn instead of refused, no `shore` row) or a missing task; the budget timings are INCONCLUSIVE off a reference
Mac at rest. `BASE-FAILURE.txt` holds `foam.test.ts`, `calm.test.ts` and `field.test.ts` run against the base.

## Run them

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/268 --no-file-parallelism --testTimeout=3600000
npx tsc -p tests/acceptance/268/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Each file builds `deep-gpu` once with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked --bin
deep-gpu`, adding the pinned toolchain (`~/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin`) to PATH, copies the
binary out of the target folder (`CARGO_TARGET_DIR` honoured) and fails each test if the build failed. So the files run
one at a time, and the timings must have the machine to themselves: **`scripts/lanes.mjs` needs
`'tests/acceptance/268/'` in its `alone` list beside `'tests/acceptance/166/'`. This README is the instruction; the
implementer makes that edit.** Each test writes into its own temporary folder and deletes it. Imports: Node built-ins
and vitest only; the lane's judge and validator run as `scripts/benchmark.mjs` in a child process. A run with `--root
tests/acceptance/268` leaves Vitest's cache in `tests/acceptance/268/node_modules/.vite`; delete it.

- Everything draws on Metal: off macOS a test fails with a message starting `INCONCLUSIVE:`, never passing.
- **Budgets** (`budgets.test.ts`) count only on a reference Mac (Mac15,7 or Mac15,12) on mains power, Low Power Mode off,
  thermal state nominal, as the lane's `judgeLimit` reads the fingerprint, and with the machine's load at most one per
  core; anywhere else each timing test fails `INCONCLUSIVE:` before timing anything, and the bake reading is printed and
  then INCONCLUSIVE. The budgets.json entry is checked anywhere.
- `taste.test.ts` keeps its three files in `DEEPBUILD_EVIDENCE_DIR` (else `$TMPDIR/deep-268-evidence`), prints their
  paths, and reads your taste call from the file `DEEPBUILD_TASTE_268` names; without it the test fails `INCONCLUSIVE:`.

## The surface under test

**No new binary and no new call.** #377's `deep-gpu run [--planted <name>]` with its JSON-lines protocol unchanged
(`{"out", "calls"}` in, `{"ok", "replies"}` out), #378's `view3d` for every frame, #166's water as its suite wrote it.
Field names the issue and design give are used as they give them; the rest are this suite's choices, marked **bold**,
each the least a criterion needs.

### Documents (scene3d, as #166's suite writes them)

One writer layer `main` (writer `agent:sess-alpha`), camera `cam`, `seed: 268`, `requires: {modules: {scene3d: "^1"}}`,
items keyed by ID, f32 channels with linear keys on `items/<id>/at/pos/<axis>`.

- **`shore` sits in a `material@1` item's `params.water`**, beside `wake`, as the Fields row says, with every field as it
  names them: `{items, cell, foam: {width, strength, breakup}, calm: {near, far}, shade}`; **`shore: "none"`** is the
  none form, as #166's suite wrote `wake: "none"`. A field a test leaves out takes the row's default.
- **`items` is the ID of a document collection**, `collections: {<ID>: {members: [<item ID>, …]}}` (the design's
  collection by list; the base reads it so for lights). A body of the physics stand-in is a member by its drawn ID
  `<world>#<body>`.
- **The shapes**, with the base's builders: **a pile is a `mark.cylinder@1`** (its unit shape radius 0.5, height 1, about
  +Y, so `size: [2, h, 2]` is a 1 m radius) standing through the water; **a quay is a `mark.box@1`** whose straight face
  x = 0 meets the water; **a floating deck is a `mark.box@1`** wholly above the water, covering part of it from above.
  The water is #166's: a `plate@1` part (`params: {grid, size}`) whose `material` names the water material.
- **The closed form** of a wave is #166's (its suite's `trochoid`): height A cos θ, θ = k (D · x0) − √(g k) t, D = (sin d,
  cos d) in (x, z). The calm tests use steepness 0, so a point moves only up and down.
- **The movers** (criterion 4), each beside the static pile in the collection: a channel on `items/pile-keyed/at/pos/0`;
  a clip `sway` (`slots: {target: {type: "mark.cylinder@1", required: true}}`, a channel on `slot:target/at/pos/0`)
  placed on `pile-clipped` at 0 s; **#419's `fixture.world@1` as the stand-in for the physics module** (#97 isn't in
  the base), its body `pile-falling` dropped onto the water, a member as `harbour-world#pile-falling`, as #166's suite
  stood it in; a driver `{target: "items/pile-steered/at/pos/0", expr: "x", vars: {x: "pilot.x"}}` reading the
  `logic@1` item `pilot`'s array, as #166's suite wrote a logic mover. When the physics module lands, a body and a
  physics output replace the stand-in; that is a redraft of the fixture, not of the criterion.
- A revision is a `view3d` **`patches`** entry `{frame, writer, ops: [{op: "set", id, path, value}]}`, as #378's suite
  writes it: applied before the frame it names.

### `view3d`: one target, one call field, one row field

`{"call": "view3d", "doc", "look", "size", "frames", "fps", "from"?, "capture"?, "targets"?, "timings"?, "patches"?}` as
the base has it; read: each frame's `frame`, `pixel_hash`, `final` (PNG by SHA-256), `pre_tone` and `depth` (f32 by
SHA-256) and `gpu_ms`. Added:

- **Target `foam`**: f32 little-endian, one a pixel, rows top-down, `w × h × 4` bytes, written as `<sha256>.f32` under
  `out` and named in the frame's row: at each pixel where a water part is drawn, the share of foam, 0 to 1, its shading
  mixed in there (the steep waves' and the shore's together, after `breakup` and `strength`); 0 where no water is drawn.
  Criterion 1's "foam covers" is read from it, and held to the drawing by `pre_tone` (each band pixel brighter than with
  `shore: "none"`).
- **Call field `shore: true`**, and on each frame row of the reply **`shore: {material, key, field, bake_ms}`**: the
  water material whose field it is (its item ID), the field's key (a non-empty string; equal fields of equal content
  have equal keys in any process), the field's bytes as the renderer holds them, written as `<sha256>.bin` under `out`
  and named by that SHA-256, and the time in ms the bake behind this frame's field took on the CPU (the reading of
  criterion 6). Criterion 4 reads the key and the bytes; criterion 6 reads `bake_ms`.
- Refusals at check are the base's `{code, reason}` or `{code: "refused", issues}`: the refusal's text names the moving
  item by its ID, or the cell count.

### `benchmarks/budgets.json`: one task added

**`{"id": "canvas-water-shore", "command": ["node", "benchmarks/canvas.mjs", "water-shore"], "targets":
{"shore_lake_gpu_ms": 0.5}, "margin": 0.5, "limits": {…}, "initialReason": "… #268 …"}`**, passing `validateBudgets`
against the merge base's file (which freezes #166's `canvas-water`, so a new task rather than a changed one). What the
mode prints, the bake time among it, is the implementer's, as the lane needs it.

### Planted programs (`deep-gpu run --planted <name>`, reachable only there)

| Name | The wrong program | Criterion |
|---|---|---|
| **`shore_field_from_centre`** | The shore field's distance measured from each item's centre instead of the outline where it meets the water; everything else as shipped | `#268.ed64c4a9` (issue-named) |
| **`shore_calm_ignores_field`** | Each wave's amplitude scaled without reading the field (so by the quay as in open water); everything else as shipped | `#268.2a540142` (issue-named) |

### Files and environment

- `DEEPBUILD_EVIDENCE_DIR` (optional): where `pile-foam-<sha>.png`, `quay-calm-<sha>.png` and `deck-shade-<sha>.png` go.
- **`DEEPBUILD_TASTE_268`**: a JSON file `{"criterion": "#268.f8d9db3f", "by": "you", "screenshots": [sha256 × 3],
  "call": "looks_right" | "looks_wrong"}`.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, `- [ ] ` dropped
(`scripts/proof-change.mjs: criterionId`), from the live issue. Each test's name starts with its ID.

| ID | Criterion | File: what it asserts |
|---|---|---|
| `#268.ed64c4a9` | 1: the foam band; planted field from the centre | `foam.test.ts` (3): a 1 m pile in a still 20 m plate, steepness foam off, seen straight down from 8 m: `foam` ≥ 0.5 at 64 seeded pixels 0.05–0.4 m from the pile, each brighter in `pre_tone` than with `shore: "none"`, and under 1/255 at 64 beyond 0.7 m. Breakup 0.5: the 64 beyond 0.7 m still bare, and some band pixel clears. Twin `shore_field_from_centre`: fails naming `material pile-water` and the band. |
| `#268.2a540142` | 2: calm swell; planted scale | `calm.test.ts` (2): a wave 0.4 m high, cameras straight above x = 0.05, 10 and 20 m from the quay's face; the `depth` readback's half range over 18 frames of one period within 1 mm of 0.25, 0.625 and 1 times the closed form's. Twin `shore_calm_ignores_field`: fails naming `material quay-water` and `at 0 m from the quay`, its amplitude there the closed form's. |
| `#268.7e7ee25a` | 3: shade under the deck | `shade.test.ts`: from below the deck, 16 seeded pixels of water at least 0.5 m inside its footprint show 0.2 ± 0.004 of their `pre_tone` luminance at shade 0 when the shade is 0.8; from 8 m above, where only water outside the footprint shows, the frame's pixel hash is the same at shade 0.8 and 0. |
| `#268.a0c77147` | 4: key, clean bake, refusals | `field.test.ts` (3): a patch moving the pile 1 m changes the `shore` row's key and field, and the field and key equal the moved document's baked clean in a fresh process. `pile-keyed` (channel), `pile-clipped` (clip), `harbour-world#pile-falling` (the physics stand-in) and `pile-steered` (logic) each refused at check naming it; the first three drawn with `shore: "none"` (the base can't draw the logic one: a driver variable on a logic array is `ref_unresolved`), and a static `pile-still` drawn. A 250 × 210 m plate at cell 0.1 refused naming 2,500 × 2,100 (or 5,250,000); at 0.125 drawn. |
| `#268.d5fcb247` | 5: seek equals play | `seek.test.ts`: the harbour (pile, quay, deck; waves, ripples, broken foam band, calm, shade 0.6): frame 600 seeked equals played; with `shore: "none"`, and with breakup 0, frame 600 differs. |
| `#268.b2dd7e77` | 6: budgets; bake reading | `budgets.test.ts` (3): the `canvas-water-shore` task and the lane's validator against the merge base; #166's half-frame 1080p lake with twelve piles, a quay and a deck under its shore (cell 0.25) against the same plate and items as a plain mirror, ≤ 0.5 ms in five runs judged by the lane; the row's `bake_ms` printed as a reading, above 0. |
| `#268.f8d9db3f` | 7: taste | `taste.test.ts`: the pile with shore foam, the calm swell beside the quay and the water under the floating deck as the renderer's PNGs; INCONCLUSIVE without your recorded call; `looks_wrong` fails. |

Proof line: "foam coverage, amplitudes and shade beside their expected values" are criteria 1–3's failure sentences and
log lines (each distance's amplitude against its factor; each pixel's foam or shade share); "the planted twins'
failures" are the two twin tests.

## Readings where the issue and design leave a choice

- **"Where the pile meets the water"** is the outline where the pile's surface meets the water's plane at rest: for a
  1 m cylinder at the origin, the circle of radius 1 m (its mesh's 5 mm of polygon chord is under the band's margins).
  Distances are measured at the point where a pixel's centre ray meets the water at rest; the water there is still
  (amplitude 0), so that point is exact. The pile stands 0.1 m out of the water so its top hides only water within
  1.013 m of its centre, seen from 8 m.
- **"Foam covers"** is a `foam` share of at least 0.5 (a solid band at `strength: 1` and `breakup: 0` is near 1 well
  inside it; 0.5 allows a soft edge); **"none shows foam"** is under 1/255, nothing an 8-bit frame shows. The steepness
  foam off is #166's `foam: {threshold: 1}`.
- **"With `breakup: 0.5` none of those 64"** reads "those 64" as the 64 beyond 0.7 m (breakup never adds foam outside the
  band). That the breakup is drawn at all is shown by one band pixel clearing by more than 0.05.
- **"The vertex height's amplitude over one period"** is half the range of the height over 18 frames spanning one
  period, read at a plate vertex straight below its camera, so neither the ray's slant nor interpolation between
  vertices enters; it is held to the same half range of the closed form at the same times. **"0 m"** is read half a
  cell (0.05 m) off the quay's face, where mix(0.25, 1, smoothstep(0, 20, d)) is 0.250014, so the pixel sees water and
  not the face; 10 and 20 m are read where the factor is the issue's exactly.
- **"Its unshaded radiance"** is the same water drawn with `shade: 0`, the linear `pre_tone` luminance at the same
  pixel; "within 2%" is 2% of 0.2, the stricter reading. Pixels lie at least 0.5 m inside the footprint, five cells of
  the default `cell`.
- **"Water outside the deck's footprint is unchanged by pixel hash"** is a whole frame in which the only water shown
  lies outside the footprint: seen from 8 m above, the deck's top hides its footprint and 0.24 m past it, two cells of the
  field at its default `cell`, so a shade filtered across one cell edge is not counted as outside.
- **"The field's key" and "equals a clean bake"** are read from the renderer's own record of the field (the `shore`
  row), as #166's suite read the rain rings: the key changes with the revision that moves the pile, and the field's bytes
  after it are the bytes a fresh process bakes from the moved document, under the same key. That the field is drawn is
  held by criteria 1–3.
- **"A pile a channel, a clip, physics or logic moves"** is one pile per mover beside a static one. The logic mover's
  document can't be drawn at the base with `shore: "none"` (its driver variable `pilot.x` is `ref_unresolved`, naming
  only `drivers/steer/vars/x`), so its refusal naming `pile-steered` must come from the shore check, before the program
  compiles, as #166's wake check does; a driver and a
  constraint, which the scope names too, aren't in the criterion and aren't tested (Not asserted).
- **"A field past 2,048 × 2,048 cells at its `cell`"** is a plate whose extent divided by `cell` passes 2,048 along both
  axes, so it is past the cap under either reading (per axis or in total); **"naming the count"** is the cells along each
  axis or their product, written with or without group separators.
- **"Beside its mirror's own pass, as #166's budget holds"** is #166's measure with the shore on: the water with its shore
  against the same plate and items as a plain mirror, so the mirror's pass is in both sides and the shore's fetches and
  ALU are on the water side. The lake's shore takes `cell: 0.25`, since a 400 m plate at the default 0.1 m is past the
  cap. A negative difference reads 0. **"Recorded as a reading"** is the `bake_ms` the frame row carries, printed by the
  test with no limit; the bench's report carrying it is the implementer's.
- **The screenshots** are the renderer's final PNGs under a filmic look; the quay's adds a second swell so the calm reads.

## Not asserted, because no criterion says so

The implementer owes these a mapping or a note (AGENTS.md: review requirement → change → proof):

- `foam.strength` other than 1 and `foam.width` other than 0.5; `calm` other than near 0.25, far 20; `shade` other than
  0.8 (and 0.6 and 0.5 in the seek and budget fixtures, unmeasured); `cell` other than the default, 0.125 and 0.25.
- An item a driver or a constraint moves, and any item reshaped (rather than moved) during the span; a collection by
  rule; the field in f64 on the CPU (only its bytes, key and effect are read).
- "No vertex moves past the waves' summed amplitude" beyond the three calm readings; foam beside steep waves' foam (the
  steepness foam is off in criterion 1).
- Caustics staying out (nothing draws them).

## The oracle page

Read. It pins no upstream source and no test: all seven criteria are DeepBuild's own, and the wave closed form the calm
factor scales is #166's. Nothing is ported.

| Row | Status |
|---|---|
| Criteria 1–7 | No upstream test, as the page says. |
