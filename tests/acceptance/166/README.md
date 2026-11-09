# Acceptance tests for #166: water surfaces: closed-form waves, a mirror that ripples, depth that tints

Written first, from issue #166 (its scope, its Fields row and its "It can never" line, its ten acceptance criteria, its
proof line: "Recordings of the lake fixture in a breeze and in rain with per-pass GPU timings, and the depth readback
beside the closed form", and its Oracle line), its Oracle page (`doneright/oracles/issues/166.md` in
`DeepBuildAI/deepbuild`, branch `doneright`), the design sections it links and those they lean on, and base commit
`9d31efdb` ("Merge pull request #1642 …"), by a job that never saw an implementation; none existed. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).
Lean: one file per criterion, one test per clause that needs its own run, plus exactly the one planted twin a criterion
names.

## What was read

- Issue #166 and its Oracle page, with the Unreal file the page pins as the formula source (read, not copied).
- `docs/canvas-primitives.md`: Material, Material: mirror, Material: water (its `shore` and `flow` belong to other issues
  and aren't tested here), Particles `particles@1`: space and paths (how a wake reads an item's earlier positions),
  Determinism class, Render-back, Units and axes; for criterion 9, World and backend `physics.world@1`, Force
  (buoyancy), Input track, Input track entries, Physics output (`keep`), Logic `logic@1`, Instance `instance@1`: logic
  columns and Driver.
- `docs/technical-design.md`: Scenes, physics and the canvas core; Every task carries its own budgets; The reference
  Macs; Speed claims name their baseline; Dogfooding; Tests written first.
- At the base, for call shapes only: AGENTS.md; `tests/acceptance/465/` (the model: README, helpers, mirror, budgets
  and taste tests), `421/` (the `deep-show` document check, `admitted`), `419/` (`fixture.world@1`), `467/` (tagged
  forms, refusals); `crates/deep-gpu-layer/src/{main,view3d}.rs` (the call table, `view3d`'s fields, its targets
  `final | linear | ids | pre_tone | dirt | scene | backdrop`, `seeks`, `timings` with `gpu_ms` and `passes_ms`, each
  frame's `pixel_hash`, refusals as `{code, reason}` or `{code: "refused", issues}`, `Planted`);
  `crates/deep-canvas-scene3d/src/{light,builders,mirror,fixtures}.rs` (`plate@1`'s `grid` and `size`, `mirror`'s
  fields, `fixture.world@1`'s bake); `crates/deep-canvas/src/camera.rs` (straight down keeps +X as screen right);
  `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`, `validateBudgets`); `benchmarks/budgets.json`;
  `scripts/proof-change.mjs` (`criterionId`); `scripts/lanes.mjs` (`alone`).

## What the base already does, which these tests don't credit

`view3d` draws scene3d documents with `from` (a cold seek), `capture`, the targets above, `timings` and each frame's
`pixel_hash`; `plate@1` builds a grid of cells; `material@1` takes `mirror: {strength, blur, plane}` (#465) and `unlit`;
`fixture.world@1` (#419) bakes a world of falling spheres at check and draws each body from the bake. There's no
`water` on a material, no `depth` or `reflection` target, no `rings`, no buoyancy or input entries on the stand-in, no
check on a wake's item, no `canvas-water` task and no planted name of this suite's. So every test fails at the base on a
refused call (an unknown target), an unread field (a lake that draws as a plain plate, so the rain, the wind or the
tint changes nothing), a missing record or a missing task; the budget timings are INCONCLUSIVE off a reference Mac at
rest. `BASE-FAILURE.txt` holds `waves.test.ts` (refused: `targets are final, linear, …`) and `seek.test.ts` (the
lake drawn as a still plate: frames 17 and 44 alike) run against the base.

## Run them

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/166 --no-file-parallelism --testTimeout=3600000
npx tsc -p tests/acceptance/166/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Each file builds `deep-gpu` once with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked --bin
deep-gpu` (and `defaults.test.ts` also `deep-show` with `--no-default-features --features full`, as #421's suite does),
adding the pinned toolchain (`~/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin`) to PATH, copies the binary out of
the target folder (`CARGO_TARGET_DIR` honoured) and fails each test that uses a build that failed. So the files run one
at a time, and the timings must have the machine to themselves: `scripts/lanes.mjs` needs `'tests/acceptance/166/'` in
its `alone` list beside `'tests/acceptance/465/'`. This README is the instruction; the implementer makes that edit. Each
test writes into its own temporary folder and deletes it. Imports: Node built-ins and vitest only; the lane's judge and
validator run as `scripts/benchmark.mjs` in a child process. A run with `--root tests/acceptance/166` leaves Vitest's
cache in `tests/acceptance/166/node_modules/.vite`; delete it.

- Everything draws on Metal: off macOS a test fails with a message starting `INCONCLUSIVE:`, never passing.
- **Budgets** (`budgets.test.ts`) count only on a reference Mac (Mac15,7 or Mac15,12) on mains power, Low Power Mode off,
  thermal state nominal, as the lane's `judgeLimit` reads the fingerprint, and with the machine's load at most one per
  core; anywhere else each timing test fails `INCONCLUSIVE:` before timing anything. The budgets.json entry is checked
  anywhere.
- `taste.test.ts` keeps its four files in `DEEPBUILD_EVIDENCE_DIR` (else `$TMPDIR/deep-166-evidence`), prints their
  paths, and reads your taste call from the file `DEEPBUILD_TASTE_166` names; without it the test fails `INCONCLUSIVE:`.

## The surface under test

**No new binary and no new call.** #377's `deep-gpu run [--planted <name>]` with its JSON-lines protocol unchanged
(`{"out", "calls"}` in, `{"ok", "replies"}` out), #378's `view3d` for every frame; #393's `deep-show run` with
`deep_show` for the document checks, unchanged. Field names the issue and design give are used as they give them; the
rest are this suite's choices, marked **bold**, each the least a criterion needs.

### Documents (scene3d, as #378's, #421's and #465's suites write them)

One writer layer `main` (writer `agent:sess-alpha`), camera `cam`, `seed: 166`, `requires: {modules: {scene3d: "^1"}}`,
items keyed by ID, f32 channels with linear keys on `items/<id>/at/pos/<axis>`.

- **Water is a material field**, as the issue writes it: a `material@1` item's `params.water`, on the material of a
  `plate@1` part (`params: {grid, size}`, a rectangle in its XZ plane at the part's y, facing +Y) that names it with
  `material`. Every field as the Fields row names it: `waves`, `ripples: {scale, strength}`, `rain`, `absorption:
  {color, depth}`, `distort`, `foam: {threshold}`, `wake: {item, span}`. A field a test leaves out takes the design's
  default.
- **The wind form of `waves` is the one-key object `{"wind": {"speed", "direction"}}`**, the design's `wind {…}` written
  as its other tagged forms are (`motion: {along: {…}}`); the list form is `[{direction, length, amplitude,
  steepness}]`. **`wake: "none"`** is the none form.
- **A wave's `direction` d is its heading: it travels along D = (sin d, cos d) in (x, z)**, so 0° runs along +Z (the
  front, Units and axes) and 90° along +X, a turn of d about +Y as `at.rot` turns +Z.
- **The closed form** (`helpers.ts`: `trochoid`): a rest point x0 on the plate at t moves to x0 − Σ sᵢ Aᵢ Dᵢ sin θᵢ
  horizontally and Σ Aᵢ cos θᵢ up, with kᵢ = 2π ÷ lengthᵢ, θᵢ = kᵢ (Dᵢ · x0) − √(g kᵢ) t, g = 9.81 m/s² and no phase
  offset, in world x and z (the fixtures' plates sit unturned at the origin, so the plate's own space and the world's
  agree). It is the Oracle's Unreal Gerstner evaluation (height A cos θ, horizontal −Q sin θ along D, θ = k D·x − ω t,
  ω = √(g k) for deep water) with **Q = s·A**: the only reading of `steepness: 0..1` under which no vertex moves further
  than its waves' summed amplitude (the "It can never" line: each wave's move is at most A when s ≤ 1), and at s = 1 it
  is Gerstner's trochoid, whose horizontal and vertical amplitudes are equal.
- The mirror: `mirror: {strength, blur, plane}` as #465 built it; a plain mirror here has `roughness: 0`.
- **The physics stand-in** (criterion 9; the physics module, #97, isn't in the base): #419's `fixture.world@1`
  (`params: {step_hz, span, gravity, floor, restitution, bodies: {<id>: {radius, pos, vel}}}`, baked at check, each
  body drawn as `<world>#<body>` at the bake's position at t), with two additions:
  - **`buoyancy: {level: m, density: kg/m³ = 1000}`** on the world and **`density: kg/m³ = 1000`** on a body: each
    step, before gravity, with h = clamp(level − (p.y − r), 0, 2r) and φ = h² (3r − h) ÷ (4r³) (the sphere's submerged
    share), v.y −= gravity · (ρ_fluid ÷ ρ_body) · φ · dt. Exact for a sphere, as the design's buoyancy force is.
  - **`inputs: [{step: u32, kind: "poke", target: <body ID>, data: {push: [x, y, z] m/s}}]`**, the design's input track
    entry `{step, kind, target, data}` with `poke`'s `push`: at the start of step `step` the push adds to the target's
    velocity, before that step's forces; entries apply in (kind, target) order.
  - A wake names the drawn body by **`item: "<world>#<body>"`** and reads its earlier positions from the bake, which
    is kept through the world's span (the physics output kept that far back).
- **A logic array moving an item** (criterion 9's refusal): a `logic@1` item `pilot` (`program` a sha256, `writes: {x:
  {type: "f64"}}`) and a document driver `{target: "items/skiff/at/pos/0", expr: "x", vars: {x: "pilot.x"}}`, as Driver
  and Logic read arrays by path; the document requires `logic: "^1"`. The refusal is a check on the wake's item, so it
  names `skiff` whatever else the check finds; the program's bytes are never run.

### `view3d`: two targets, one call field, one row field

`{"call": "view3d", "doc", "look", "size", "frames", "fps", "from"?, "capture"?, "targets"?, "timings"?}` as the base
has it; read: each frame's `frame`, `pixel_hash`, `final` (PNG by SHA-256), `pre_tone` (f32 RGBA by SHA-256) and
`gpu_ms`. Added:

- **Target `depth`**: f32 little-endian, one a pixel, rows top-down, `w × h × 4` bytes, written as `<sha256>.f32`
  under `out` and named in the frame's row: at each pixel's centre, the distance in metres along the view axis from the
  eye to the nearest surface drawn there, the water's displaced surface included (the linear depth readback of
  criterion 1).
- **Target `reflection`**: f32 little-endian RGBA, rows top-down, `w × h × 16` bytes, `<sha256>.f32`: at each pixel of
  a part that reflects through a mirror (a plain mirror or a water's own), the linear color its mirror lookup returned,
  after the water's distortion and the mirror's blur and before any mix with the part's own shading, its strength or
  its Fresnel; 0 elsewhere. Criterion 3's "the water's reflection", compared by the file's SHA-256.
- **Call field `rings: true`**, and on each captured frame's row **`rings: [{part, drop, at: [x, z], born, radius}]`**:
  every rain ring alive at the frame's t on each water part (`part` the plate's item ID, `drop` the ring's index in its
  hash's sequence, `at` its centre in metres in world x and z on the water at rest, `born` its birth in s, `radius` in
  m as drawn), sorted by part, then drop. The record the renderer draws the rings from; criterion 6 reads it.

### `benchmarks/budgets.json`: one task added

`{"id": "canvas-water", "command": ["node", "benchmarks/canvas.mjs", "water"], "targets": {"lake_gpu_ms": 0.5,
"waves_vertex_ms": 0.1}, "margin": 0.5, "limits": {…}, "initialReason": "… #166 …"}`, passing `validateBudgets` against
the merge base's file, so the perf lane compares the issue's measures with the merge base. What the mode prints is the
implementer's, as the lane needs it.

### Planted programs (`deep-gpu run --planted <name>`, reachable only there)

| Name | The wrong program | Criterion |
|---|---|---|
| `water_foam_keeps_state` | The water's foam (its wake's foam among it) carried from frame to frame as simulation state; everything else as shipped | `#166.5cdde7aa` (issue-named) |

### Files and environment

- `DEEPBUILD_EVIDENCE_DIR` (optional): where `lake-<sha>.png`, `rain-<sha>.png`, `foam-wake-<sha>.png` and
  `rain-wake-<sha>.apng` go.
- `DEEPBUILD_TASTE_166`: a JSON file `{"criterion": "#166.ad7d1fa8", "by": "you", "screenshots": [sha256 × 4], "call":
  "looks_right" | "looks_wrong"}`.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, `- [ ] ` dropped
(`scripts/proof-change.mjs: criterionId`), from the live issue. Each test's name starts with its ID.

| ID | Criterion | File: what it asserts |
|---|---|---|
| `#166.f045d1c5` | 1: depth vs the closed form | `waves.test.ts`: a 16 m lake of 512 × 512 cells with four stated waves, seen straight down from 10 m at 2.5 s; at 64 seeded pixels the `depth` target is within 1 mm of the eye's height less the closed-form height where the pixel's ray meets the displaced surface (solved for the rest point); the expected heights span over 5 cm. |
| `#166.cc52bd24` | 2: seek equals play | `seek.test.ts`: waves, ripples 0.3, rain 50: frames 17, 44, 89 seeked cold have the played hashes; frames 17 and 44 differ; without rain, and without ripples, frame 44 differs. |
| `#166.ab96f725` | 3: distortion bound, calm equals plain | `mirror.test.ts` (2): every red post pixel of the water's `reflection` within 16 + 2 px of the flat mirror's, which has ≥ 200; the water moves it. Waves of amplitude 0 and no ripples: the `reflection` target's SHA-256 equals the plain mirror's. |
| `#166.f353deab` | 4: depth tints | `tint.test.ts`: a still lake over an unlit bed at 0.2, 1 and 5 m, from straight above, the reflection off (its mirror at strength 0); share = (white − black under water) ÷ (white − black open) at the centre within 2% of exp(−d ÷ 3). |
| `#166.28aab23d` | 5: `water: {}` | `defaults.test.ts` (2): `water: {}` has, at frames 0, 20, 45, the hashes of every default spelled out with its own mirror named at strength 1; a 6 m/s wind, the mirror at 0.5 and another tint each change frame 20; the waves move. `deep_show` presents the document with no error issue and nothing skipped. |
| `#166.037482f7` | 6: rain rings | `rain.test.ts`: rain 50 on a 6 m lake; 100 rings sampled from frame 45's `rings` keep `at`, `born` and radius seeked cold and in a fresh process, lie on the plate, were born by t; their radius within 1 mm of other drops' at the same age (frames 30, 60, 75); 180 ± 67 births in 0.1 s; seed 167 moves them; rain changes the frame. |
| `#166.5cdde7aa` | 7: foam and wake; planted foam | `foam.test.ts` (2): foam 0.6 and a wake behind the keyed boat: frame 600 (20 s) seeked equals played; foam off and no wake each change it. Twin `water_foam_keeps_state`: the foam-off lake still seeks equal to play; the foamy one fails naming `material lake-water` and `20 s`. |
| `#166.198cb586` | 8: budgets | `budgets.test.ts` (3): the `canvas-water` task and the lane's validator against the merge base; a lake filling the lower half of a 1080p frame (four waves, ripples, rain) against the same plate as a plain mirror, ≤ 0.5 ms; a 256 × 256 plate's waves on a few hundred pixels against the plain mirror plate, ≤ 0.1 ms; five runs judged by the lane. |
| `#166.59c5001c` | 9: buoyant body; logic refusal | `physics.test.ts` (2): the stand-in world's buoyant skiff poked at 5 s, its wake behind `harbour-world#skiff`: frame 600 seeked equals played; without the entry, without buoyancy, and without the wake 20 s differs. A wake behind a skiff a driver moves from `pilot.x` is refused at check naming `skiff`; the channel-keyed skiff's wake draws. |
| `#166.ad7d1fa8` | 10: taste | `taste.test.ts`: the lake with waves and ripples, the rain, the foam and wake as the renderer's PNGs, and the lake in rain with the boat's wake as an APNG of its frames; INCONCLUSIVE without your recorded call; `looks_wrong` fails. |

Proof line: "the depth readback beside the closed form" is criterion 1's log line (the worst pixel's offset and the
heights' span); "recordings … in a breeze and in rain" are the taste call's files; "per-pass GPU timings" are the budget
runs' `gpu_ms` (the reply's `passes_ms` is there for the PR to quote).

## Readings where the issue and design leave a choice

- **The closed form, its heading and its steepness**: above (The surface under test). Criterion 1 states direction,
  length and amplitude; the fixture's steepness is nonzero so the horizontal move is held too, and the expected height
  is solved at the displaced point the pixel's ray meets, never read at the pixel's rest position.
- **"A linear depth readback"** is the `depth` target: view-axis distance in metres, not the depth buffer's value.
- **"The flat mirror's"** (criterion 3) is a plain material's mirror on the same plate: strength 1, blur 0, roughness
  0, the water's roughness 0 too, so neither blurs. A post pixel is red above 0.05 and over four times green and blue in
  the `reflection` target; "moves by at most `distort` px" allows 2 px more at the post's edge for the lookup's filter.
- **"The bed's transmitted share"** (criterion 4) is measured so the absorption color, and whatever light it takes,
  cancels: (white bed − black bed) under the water ÷ the same with no water, at the frame's centre. The water's own
  mirror is named at strength 0 there, so no reflection or Fresnel is mixed in; "within 2%" is 2% of the expected share
  (0.0038 at 5 m), the stricter reading.
- **"Gives waves from a 3 m/s wind, a mirror at strength 1 and the default tint"** (criterion 5): the wind table is the
  implementer's, so `water: {}` is held equal by pixel hash to every default spelled out, the mirror named as its own at
  strength 1, and each default is shown to matter. **"Passes the document checks"** is `deep_show`'s issues, as #421's
  suite reads them.
- **"The place and time its hash gives"** (criterion 6): neither the hash nor the ring's growth is in the design, so the
  rings are read from the renderer's own record (as #465 read `indexed.target_bytes`), and held to what the design does
  say: a place and birth that depend on the seed and the drop alone (seeked, fresh process, another seed), the rate
  (births in 0.1 s within five Poisson deviations; a ring lives at least 0.1 s), and one closed form of age shared by
  every ring (radius against other drops' radii at the same age, each neighbour within 5 ms of age). That the drawn
  pixels sit on the recorded rings is shown only as "rain changes the frame": at 50 drops per m² per s the rings overlap
  too densely for a per-ring pixel test.
- **"Draws different foam after the seek and fails, naming the material"** (criterion 7): the suite's check compares
  seek with play at 20 s and names the water's material; the plant's lake with foam off still seeks equal to play, so
  the difference is the foam.
- **The physics** (criterion 9): #419's stand-in with the two fields above; the "physics output kept that far back" is
  the stand-in's bake over its 25 s span. When the physics module lands, its world, body, force and input track
  replace the stand-in's fields; that is a redraft of these fixtures, not of the criterion.
- **Budgets** (criterion 8): "beside its mirror's own pass" is the water against the same plate as a plain mirror, so
  the mirror's pass is in both sides; "in the vertex stage" is held by a plate whose 66,049 vertices all draw while it
  covers a few hundred pixels, so the difference bounds the waves' vertex cost from above. A negative difference reads
  0. "Filling half a 1080p frame" is a level camera 2 m above a 400 m plate: the water fills the lower half up to 0.6°
  under the horizon.
- **The recording** is an animated PNG the suite encodes from the renderer's final frames, since the issue names no
  container.

## Not asserted, because no criterion says so

The implementer owes these a mapping or a note (AGENTS.md: review requirement → change → proof):

- `ripples.scale` and the ripples' drift with the wind; `distort` other than 16 and 0; foam's placement by steepness
  beyond "foam at 0.6 shows and seeks equal to play"; `wake.span` beyond 8 s; a wake read from a channel's earlier
  values (criterion 7 holds it only by seek against play).
- The "It can never" lines beyond seek equal to play: no vertex past the summed amplitude (criterion 1's 1 mm holds it
  at the sampled points), never feeding a check or the physics module.
- A wake whose item's physics output isn't kept far enough back, and a wake behind a live drag (Particles: space and
  paths refuses both; no criterion of #166 names them).
- The design's `shore` and `flow`, which belong to other issues (#968 for `flow`).

## The oracle page

Read. It pins one upstream source, for criterion 1, and no test for 2–10.

| Row | Status |
|---|---|
| Unreal `396c9f0599` `GerstnerWaveEvaluation.cpp` (criterion 1, "formula") | **Ported as behavior**: not a test (the Water plugin has none), but its closed form (height A cos θ, horizontal −Q sin θ along the direction, θ = k D·x − ω t, summed over the waves) is the form `waves.test.ts` holds our depth readback to, restated in `helpers.ts` with Q = s·A. No Unreal code is copied. |
| Criteria 2–10 | No upstream test, as the page says. |
