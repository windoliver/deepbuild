# Acceptance tests for #2016: wind on the GPU — mod.sway@1 as per-instance params, gusts as noise over world position, and no move past amount

Written first, from issue #2016 (its summary, scope, one acceptance criterion with four clauses, and its proof line),
its oracle page, the design sections it links and those they lean on, and base commit `a04378eb2` ("Merge pull
request #2190 …"), by a job that never saw an implementation; none existed. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- Issue #2016 and its oracle page (`doneright/oracles/issues/2016.md` in `DeepBuildAI/deepbuild`, branch
  `doneright`): no upstream test checks the criterion ("Our GPU sway with gusts rolling downwind and seek-equals-play
  is ours"), so none is ported.
- `docs/canvas-primitives.md`: **Modifier** (the `sway {amount: m = 0.1, weight: height | attribute name = height,
  wind: {direction: deg = 0, speed: m/s = 3, gust: {scale: m = 20, strength: 0..1 = 0.5}}, hz: f32 = 0.4, seed}`
  fields; "on the GPU from per-instance params: `bob, sway, wave, spin`"; Semantics: "GPU deforms add per-instance
  params and never rebuild. Sway bends each vertex along the wind by amount × its weight …: a slow sway at hz, phased
  per instance by its seed, plus gusts from noise over world position less the wind's velocity × t, seeded by the
  document, so gusts roll across a field and neighbors lean together. Nothing integrates, and bounds grow by amount";
  Cost: about 20 ALU per vertex); **Modifier: store** (a stored wind weight); Units and axes (metres, +Y up; time in
  flicks, the valid frame rates, 8 fps among them); Document envelope (`seed`); Builder (`lathe`, its `from` measured
  "from +x toward +z"); Instance `instance@1` (elements "seeded by hash(seed, id)"), only to place what "per instance"
  can mean.
- `docs/technical-design.md`: the canvas core (`frame(t) = eval(doc, t)`, no state carried between frames); Dirty
  classes and content key ("A move uploads one instance record and never rebuilds a mesh"); Modifier; the parity
  suite (our own documents as fixtures).
- At the base: AGENTS.md (Proof); `crates/deep-canvas-scene3d/src/stack.rs` (the CPU `mod.sway@1`: its defaults, the
  height weight normalized to 0..1 over the item's bounds, the phase from `seed_of(item ID, modifier)`, the gust
  `strength × sin(2π (t × speed − along) ÷ scale)` along the item's own coordinates, and the move `amount × weight ×
  (sin(2π hz t + phase) + gust)`); `build.rs` (a builder whose stack reads time rebuilds every frame); `scene.rs`
  (builders drawn from their mesh at t); `crates/deep-gpu-layer/src/view3d.rs` (`parse`: `from`, `fps`, `frames`,
  unknown fields ignored; the frame loop and `frame_order`; each frame's `pixel_hash`); `crates/deep-show/src/
  geometry.rs` (the `geometry` call, which reads the CPU stack's mesh, not the GPU's); and the suites
  `tests/acceptance/2186/` (the README, helpers, BASE-FAILURE.txt and look this one follows), `378/`, `379/` and
  `420/` (its README's `geometry` and `view3d` surfaces, and `particles.test.ts`'s seek against play).

## What the base already does, which these tests don't credit

`mod.sway@1` runs at the base as a CPU deform (#420): a builder whose stack holds it is rebuilt each frame, its
vertices moved along the wind by `amount × weight × (sin(2π hz t + phase) + strength × sin(2π (t × speed − along) ÷
scale))`, with `along` read in the item's own coordinates and the phase seeded by the item's ID mixed with `seed`.
So at the base every identical tree gets the same gust at the same moment wherever it stands, identical trees sway
out of phase, a vertex moves up to (1 + strength) × amount, and that sine's period in time is scale ÷ speed, which
for this criterion's numbers is 20 m ÷ 5 m/s = 4 s exactly. `view3d` (#378) draws such a document and seeks it
(#380's `from`). The CPU sway is a closed form in t, yet on this field seeking doesn't equal playing at the base:
checking the fixture before the suite's one run (the base binary on `fixtures/field.json`, no test code), a fresh
process opened at frame 45 drew hashes at frames 45, 46 and 47 that no played frame has, while the same field with
its sway switched off, and the field cut to one swaying tree, seek equal to play; a `showpiece` budget class or a
gust strength of 0 changes nothing. So the difference comes with many meshes rebuilt and uploaded every frame, which
a GPU sway (per-instance params, no rebuild) doesn't do; this suite doesn't diagnose it further. Nothing at the base
reads back what the GPU did to a vertex, and nothing reports a gust term, so the first three clauses have no
surface; the fourth has one, and its test also requires that the frames be the GPU sway's (below).

## Run them

They build `deep-gpu` and draw on the Metal device, as #378's, #379's and #2186's suites do, so they run with
`--no-file-parallelism`, and `scripts/lanes.mjs` needs `'tests/acceptance/2016/'` in its `alone` list beside the other
`deep-gpu` suites. This README is the instruction; the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/2016 --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/2016/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Each file first builds `cargo build --locked --bin deep-gpu` once, with the pinned toolchain's folder
(`~/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin`) put first on `PATH`, `CARGO_INCREMENTAL=0` and
`CARGO_PROFILE_DEV_DEBUG=0`, copies the binary out of the target folder (`CARGO_TARGET_DIR` when set) into a temporary
folder, and fails each test if the build failed. **The shipped build**: `view3d` with `sway` needs no test feature,
so none is built. Each file writes its documents into its own temporary folder and deletes it, and each call runs in
its own `deep-gpu run` process, so a sought frame shares nothing with the played run. Node built-ins and vitest only.
A run with `--root tests/acceptance/2016` leaves Vitest's cache in `tests/acceptance/2016/node_modules/.vite`;
delete it. `BASE-FAILURE.txt` is the run at the base.

The criterion reads what the GPU computes and draws ("Metal" below). Off macOS, and wherever the binary answers
`unsupported_platform`, a test fails with a message that starts `INCONCLUSIVE:`; it never passes there. No test reads
a timing or gates on power, Low Power Mode, thermal state or load.

## The surface under test

One new request field on an existing call, **`sway` on `deep-gpu run`'s `view3d`** (#378), which reports what the GPU
computed for each named item in each frame. Everything #378's and #380's READMEs define for `view3d` holds unchanged
(`doc`, `look`, `size`, `fps`, `from`, `frames`, each frame's `frame` and `pixel_hash`). No new call, binary, planted
name or feature. The issue gives no API; every name below is this job's.

Request (one call per `deep-gpu run` scenario, `{"out", "calls": [call]}`):

```json
{"call": "view3d", "doc": "<path to the session document>", "look": {…}, "size": [320, 240],
 "fps": 8, "from": 0, "frames": 97, "sway": ["tree-x00-z0", "tree-x02-z0", …]}
```

Each `frames[k]` of the reply gains:

```json
"sway": {"<item ID>": {"gust": 0.2731 | null, "positions": [[x, y, z], …]}}
```

- One entry for every item `sway` names, in every frame the call draws, played or sought.
- `positions`: every vertex of the mesh the GPU draws for the item, in world metres, where the GPU put it in this
  frame: the item's mesh through its world transform and, when the item has an enabled `mod.sway@1`, the GPU sway.
  It is read back from the GPU (the vertex stage writing a storage buffer, or a compute pass running the vertex
  stage's own sway function on the same buffers and per-instance params), never computed by a CPU formula. The same
  count and order in every frame and in every call on a document with the same items, whether the sway is enabled or
  not (a GPU deform never rebuilds).
- `gust`: the gust term the GPU sway used for the item in this frame, read back from the GPU as `positions` is: the
  noise over world position less the wind's velocity × t, at the item's origin (its instance's world position),
  before `amount` and the vertex's weight scale it. Dimensionless. `null` when the item has no enabled `mod.sway@1`.
- Asking for `sway` changes no pixel; the played and sought runs both ask for it.

At the base `view3d` ignores the field, so no frame has `sway`.

## Fixtures

- `fixtures/field.json`: the issue's swaying field as a session document (one writer layer `main` of `agent:alpha`,
  every item in it; envelope `size: [320, 240]`, `camera: "cam"`, `seed: 2016`). 36 identical trees: `lathe@1` with
  `outline: [[0.15, 0, false], [0.15, 1, false], [1, 1, false], [0, 3, false]]` and `segments: 8` (a trunk and a cone
  crown, 3 m tall, its base at y = 0), material `needles`, and one modifier, `{"kind": "mod.sway@1", "params":
  {"amount": 0.3, "wind": {"direction": 0, "speed": 5, "gust": {"scale": 20}}, "seed": 7}}` (strength, hz and weight
  at their defaults: 0.5, 0.4 and height). They stand 2 m apart on a 12 × 3 grid, x = 0, 2, … 22 m along the wind and
  z = 0, 2, 4 m across it, IDs `tree-x<xx>-z<z>`, so every tree has neighbours 2 m away and each row holds two pairs
  20 m apart along the wind. A sun (no shadow) lights them; a still perspective camera at (11, 10, 30) looking at (11,
  1.2, 2), fov 60, sees the whole field, so no tree is ever culled from view. Nothing else moves.
- The still field (`helpers.ts`'s `writeField(…, false)`): the same document with every tree's sway `enabled: false`,
  for the trees' rest positions.
- `fixtures/look.json`: #2186's acceptance look (#379's, tone map none at scale 1, no finish, deband, bloom or 3D
  ground).

## Criteria to tests

One criterion, `#2016.dd1c9e69` (the first 8 hex digits of the SHA-256 of its text, trimmed, white space collapsed:
`scripts/proof-change.mjs`'s rule), with four clauses; one test per clause, each named `#2016.dd1c9e69 AC1 (<clause>)`.
Frames are at 8 fps, so frame n is at n ÷ 8 s, exactly, and 4 s is 32 frames; the played run is frames 0 … 96 (0 to
12 s).

| Clause | Test | What it reads and asserts | Wrong programs it fails |
|---|---|---|---|
| "the gust term at a tree 20 m downwind equals the upwind tree's 4 s earlier within 1e-4" | `field.test.ts`, (gusts roll) | `gust` of each of the 6 pairs 20 m apart along the wind (x and x + 20 in each row), from the played run: \|gust(downwind, n) − gust(upwind, n − 32)\| ≤ 1e-4 for n = 32 … 96. Guards, so the equality shows a gust rolling: the upwind tree's gust spans more than 1e-2 over the run, and at some frame the two trees' gusts at the same moment differ by more than 1e-2 | a gust fixed in world space (it never reaches the downwind tree, and doesn't move: the first guard); a gust the same for every tree at a moment, from item-local position or from t alone, as the base's sine is (its period is exactly 4 s here, so it would pass the equality alone: the second guard fails it); noise moving at another speed, in another direction, or not by the wind's velocity × t; a gust with a per-instance seed or offset; a gust seeded by anything that differs between trees |
| "trees 2 m apart lean within 10% of each other" | `field.test.ts`, (neighbours lean together) | A tree's lean at frame n: the mean move, from rest, of its top vertices (those within 1 mm of its highest rest point, weight 1), a vector, from `positions` in the played run and the still field. For each of the 57 pairs 2 m apart (33 along the wind, 24 across it) at every frame where the larger of the two leans is at least half the largest lean any tree reaches in the run: \|lean a − lean b\| ≤ 10% × the larger. Guards: the largest lean is at least amount ÷ 4; at least one pair-frame is judged | a per-instance random gust (a hash of the instance or its ID); noise far finer than 20 m (the scale read in another unit, or per-vertex hash noise); identical trees phased by their item IDs instead of their seed, as the base's `seed_of` does (Readings) |
| "no vertex moves more than `amount`" | `field.test.ts`, (bounded) | Every vertex of every tree at every played frame: \|position − rest\| ≤ amount (0.3 m) + 1e-4 m for f32 rounding. Guard: the largest move is at least amount ÷ 4 | the base's `amount × weight × (sway + strength × gust)`, which reaches (1 + 0.5) × amount, 0.45 m here; the height weight read in metres (a 3 m tree's top moving up to 3 × amount); any sum of sway and gust not kept within ±1 |
| "seeking equals playing by pixel hash" | `seek.test.ts` | Played frames 0 … 96 in one process; fresh processes opening the field at frame 17, 45 and 96 (`from`), one frame each: each sought `pixel_hash` equals the played frame's. Guards: the three played frames' hashes differ (the field moves under a still camera); every frame, played or sought, reports each tree's `gust` (the frame is the GPU sway's) | a sway that integrates (a phase or gust offset stepped by each frame's dt), a time counted in frames since the view opened, any state carried from frame to frame, such as the base's per-frame mesh rebuilds and uploads on this field; and, by the guard, a frame not drawn by the GPU sway. Every failure is listed together |

Each test fails at the base, where no frame has `sway`; the fourth also fails its comparison there, at frames 17 and
45 (see `BASE-FAILURE.txt`). None can pass on a program that
does nothing: a field that doesn't sway fails the guards of the second and third clauses and the first guard of the
first, and one that doesn't draw fails the fourth's.

## Readings where the issue and design leave a choice

- **Downwind is +x.** The wind's `direction` is 0°, and a direction in degrees is read from +x toward +z, as a lathe's
  `from` is and as the base's sway reads it (d = (cos, 0, sin)); the design moves the noise by "the wind's velocity ×
  t", so the velocity points where the wind blows, and downwind is along it.
- **"The gust term at a tree"** is the noise term at the tree's origin, its instance's world position, which the GPU
  reports per frame. It's what both trees' leans are made of, so it's compared directly; the 1e-4 is on that term,
  which is dimensionless.
- **Why the two gust guards.** With 5 m/s and 20 m, a gust that is any function of t with a 4 s period, or of
  position along the wind with a 20 m period, gives equal terms 20 m and 4 s apart without rolling; the base's sine is
  both. A gust that varies over the run, and differs between the two trees at the same moment, can only meet the
  equality by moving downwind at 5 m/s. Noise over world position (not periodic at 20 m) meets both guards; 1e-2 is a
  hundred times the clause's tolerance.
- **Identical trees** are identical in every param, the sway's `seed` (7) among them, and differ only in their ID and
  `at.pos`. The design phases the slow sway "per instance by its seed", so identical trees sway in phase and their
  leans differ only by their gusts. An implementation that phases each item by its ID (as the base's CPU `seed_of`
  mixes it in) makes identical trees sway out of phase, and the second clause then fails for it; this suite reads that
  as the clause failing, not as a test fault.
- **A lean** is a vector, the mean move of the tree's top vertices, so it holds every way a tree can lean (along the
  wind, across it, or dipping). "Within 10% of each other" is \|a − b\| ≤ 0.1 × the larger of \|a\| and \|b\|.
  Ten percent of a lean near nothing is a bound no sway that varies at all can meet as both pass zero, so a pair is
  judged only at frames where it clearly leans: the larger lean at least half the largest any tree reaches in the run.
- **Rest positions** come from the still field (every sway `enabled: false`, which the Modifier block says is skipped
  and reads nothing), drawn in its own call; its vertex count must equal the swaying field's, tree by tree.
- **"No vertex moves more than `amount`"** allows 1e-4 m for f32 rounding of world positions near 22 m (about
  2 × 10⁻⁶ m an ulp there), a third of a thousandth of `amount`.
- **Values the issue doesn't give.** `amount` is 0.3 m, so a sway shows in a 320 × 240 frame of the whole field; the
  gust's `strength`, `hz` and `weight` keep their defaults (0.5, 0.4 Hz, height). The tree is a lathe, since no tree
  builder exists yet; the issue says the work "needs no scatter or terrain", so the field is 36 items, each its own
  instance record, not an `instance@1`.
- **8 fps** is a valid frame rate (Units and axes: time), and makes 4 s exactly 32 frames.
- **"Seeking"** is a fresh process opening the document at the frame (#380's `from`), as #420's AC1 reads it, at
  three frames spread over the run.

Not tested, because the criterion doesn't ask: the 3 m/s breeze with no fields set (scope only), a stored wind weight
(`weight: <attribute>` from `mod.store@1`), `on` parts, the swayed mesh's normals, "never rebuild" and its content
keys, bounds growing by `amount`, the sway's cost, `instance@1` elements, other wind directions, shadows of swaying
trees, and `canonical`, `live` or export renders of a swaying field.

## Upstream tests (the Oracle lane)

The oracle page lists no upstream test for the criterion: "Our GPU sway with gusts rolling downwind and
seek-equals-play is ours." None is ported.
