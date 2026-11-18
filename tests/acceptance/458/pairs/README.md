# Acceptance tests for #458, pairs group: pairs that draw the same with no golden, generated cases across implementations, and 25 instances against 25 items

Written first, from issue #458 ("Parity suite: lanes, planted twins, no retries, the release bar and the fixture scan":
its Scope, its 19 acceptance criteria and its Proof line), its oracle page, the design sections it links and those they
lean on, and base commit `06e231702` ("Merge pull request #2735 …"), by a job that never saw an implementation; none
existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding).

Four blind jobs wrote #458's criteria, each in its own folder and never seeing the others': `suite` (criteria 1, 2, 3,
4, 5, 6, 8), **`pairs` (7, 9, 11: this folder)**, `relations` (10, 12, 13, 14) and `views` (15 to 19). This folder holds
only what criteria 7, 9 and 11 need.

What was read:

- The issue's text and its oracle page (`doneright/oracles/issues/458.md`): no upstream test checks criteria 7, 9 or
  11, "hold each criterion to your own fixtures and planted twins".
- `docs/technical-design.md`: How we know version 0 works (Kit hygiene; Case lists; Criteria in a checked shape; Wrong
  programs; The canvas; Rendering relations; Canvas modules; Generated inputs across implementations: "generators draw
  valid documents, and logic programs inside the logic subset … record their seeds … transforms that must not change
  the output … Each output is compared across the pairs DeepBuild already has for one meaning … A difference names the
  seed, the pair and the first value that differs"; Dogfooding; the parity-suite paragraphs: "Reftests need no golden:
  two documents that must draw the same are rendered on one machine and compared", every share tolerance with a ceiling
  and a window bound, the blank guard); Built to be hard to get wrong; Decided ("The parity suite … the named oracles
  … stay reviewed test code"); Item and kind; Recipe.
- `docs/canvas-primitives.md`: Determinism; Determinism class; Frame and group; Pack: kinds in any pack; Instance
  `instance@1`.
- At the base, for surfaces and conventions only: `AGENTS.md`, `CONTRIBUTING.md`; the suites `138/` (the kit, tolerance
  classes, `goldens`), `1897/` (`determinism`, `pixel_hash`), `385/` (`layers`, the writer layer and its oracle), `306/`
  and `1956/` (packs, recipes, pack kinds, hub-stored documents and patches), `2015/`, `378/`, `421/`, `431/`, `968/`,
  `166/`, `1636/`, `1921/` (`view3d`, its targets, `instance@1`, orbit cameras, channels), `238/` (`deep-sandbox`, the
  web runner, headless Chrome), `172/` (the web export, the player, `probe()`), `140/`; `crates/deep-gpu-layer/src/
  view3d.rs` and `view3d/parse.rs` (the target list), `crates/deep-show/src/main.rs` (`planted`), `crates/
  deep-canvas-sandbox/src/check.rs` and `crates/deep-sandbox-wasmtime/src/service.rs` (program roles);
  `scripts/proof-change.mjs` (criterion IDs), `scripts/lanes.mjs`.

What the base already does, and these tests don't credit on its own: recipes and pack kinds expand at check; a group
at opacity 1 draws as its children; `deep-gpu`'s `layers` draws a 2D writer layer by GPUI, by the GPU layer and by
Vello CPU; `determinism` hashes a seek and a play; `deep-sandbox` checks, rewrites and runs a program and hands out the
web runner; `view3d` writes the `final`, `ids`, `normal` and `depth` targets. At the base every honest native step
below passes (the fixtures were run there: `BASE-FAILURE.txt`). What it lacks is the four planted programs and
`view3d`'s `velocity` target, so each test fails there.

## Run them

Put Node 24.22 and the pinned Rust toolchain first on PATH, install once, then run one file at a time. Each file builds
the binaries it lists once, in `beforeAll` (`cargo build --locked --bin deep-show --no-default-features --features
full`, `--bin deep-gpu`, `--bin deep-sandbox`, with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0`, honouring
`CARGO_TARGET_DIR`), and copies them out of the target folder.

```sh
export PATH=/opt/homebrew/opt/rustup/bin:$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH
npm ci
npx vitest run --root tests/acceptance/458/pairs pairs.test.ts --no-file-parallelism --testTimeout=600000      # AC7 (deep-show, deep-gpu)
npx vitest run --root tests/acceptance/458/pairs generated.test.ts --no-file-parallelism --testTimeout=600000  # AC9 (deep-show, deep-gpu, deep-sandbox)
npx vitest run --root tests/acceptance/458/pairs instances.test.ts --no-file-parallelism --testTimeout=600000  # AC11 (deep-gpu)
npx tsc -p tests/acceptance/458/pairs/tsconfig.json
```

Every `it` passes its own 3,600,000 ms timeout. Each test writes into temporary folders and deletes them; Chrome runs
as a child in its own process group and is stopped by its PID. A run with `--root` leaves Vitest's cache in
`tests/acceptance/458/pairs/node_modules/.vite`; delete it.

`scripts/lanes.mjs` needs `'tests/acceptance/458/pairs/'` in its `alone` list: the files build cargo binaries, hold the
GPU and start Chrome. This README is the instruction; the implementer makes that edit.

## Criteria to tests

IDs are the first 8 hex digits of the SHA-256 of each criterion's text, trimmed and with white space collapsed
(`scripts/proof-change.mjs`). Each test's name starts with `AC<n> #458.<id>`. One test per criterion; criterion 9 has
two, one for documents and one for programs.

| AC | ID | File | What the test asserts, and the wrong program it fails on |
|---|---|---|---|
| 7 | `#458.89f8a711` | `pairs.test.ts` (1) | `recipe-expansion`, `pack-kind-expansion` and `group-opacity-1`: both sides drawn by Vello CPU with an empty golden store, pixels equal bit for bit, the store still empty. `seek-play`: a seek's GPU pixel hash equals a play's at 5 times. `gpui-gpu-layer`: a 2D writer layer by GPUI and on the GPU layer within its tolerance class. Planted `expansion_drops_stroke`: `recipe-expansion` fails, the failure naming the pair and the first pixel that differs, which is the top-left pixel of one derived item's stroke, with every differing pixel on that item's stroke |
| 9 | `#458.4ebd041e` | `generated.test.ts` (2) | Documents: 4 seeded figures × 6 renderings (as generated, an invisible item, an identity group, renamed IDs, one patch, the patch split in two): Vello CPU's pixels equal the generated figure's bit for bit and the GPU layer's are within the tolerance class; 2 seeded films × 2 (as generated, transformed) read the same evaluated data in the app and the web player at 3 times. Planted `gpu_layer_multiply_as_screen`: fails on the one figure that multiplies, naming its seed and the first pixel. Programs: 6 seeded programs: the sandbox's rewrite on wasmtime gives what the program as written gives, and the browser's engine gives wasmtime's. Planted `rewrite_rotl_as_rotr`: fails on the one program that rotates left, naming its seed |
| 11 | `#458.0b2667d3` | `instances.test.ts` (1) | The fleet as 25 instances and as 25 items: ID, normal, depth and velocity targets equal byte for byte at 10 sampled times; the targets hold the boxes and their motion. Planted `instanced_skips_velocity`: the final frame's hash is the honest run's at every time, the ID, normal and depth targets still agree, and the pair fails naming the target `velocity` and the first pixel, a box's pixel |

## The surface under test

The issue names the pairs, the transforms, the implementations compared and four planted programs, but no binary,
call, field or script. These tests drive the binaries the base already proves each side through, as they are, and add
**four planted names and one `view3d` target**. No new binary, call, script, scenario field, reply field or Cargo
feature. **Every name below marked new is this job's choice; the implementer builds exactly these, or a dispute goes to
a blind redraft.**

| Surface | Used as | New or existing |
|---|---|---|
| `deep-show run` (`full`): the scenario's `evidence`, `sessions`, `processes`, `panels`, `docs` (a document the hub stored: `{panel, document}`), `packs: [{id, dir}]`, `goldens: dir`, `planted`, `calls` | #393's, #306's, #138's | existing |
| `deep show` with `document`, `include: ["issues", "pixels"]`, `size`; reply `outcome`, `issues`, `snapshots: [{sha256, w, h}]` (a PNG in the evidence store, drawn by Vello CPU) | #393's | existing |
| `deep show` with `patch: {patch, doc, base, reason, ops: [{op: "set", id, path, value}]}`; reply `outcome: "applied"` | #96's | existing |
| `read`; reply `document` (the stored document, with its `layers` and each item's `layer`) | #306's | existing |
| `determinism` with `doc`, `display_hz: 144`, `at_times`, `compare: "same_machine"`; reply `frames[].{t, play.pixel_hash, seek.pixel_hash}` | #1897's | existing |
| `export` with `video.codec: "web"`, the bundle, `<deep-player>`, `currentTime`, `probe().values`; `eval` with `paths` | #172's, through its helpers | existing |
| **the scenario's `planted: "expansion_drops_stroke"`** | criterion 7's wrong program | **new value** |
| `deep-gpu run`: `{out, calls}`; `layers` with `doc`, `look`, `by: ["gpui", "gpu_layer", "vello_cpu"]`; reply `layers[].drawn.<renderer>.png` | #385's | existing |
| `view3d` with `doc`, `look`, `size`, `fps`, `frames`, `capture`, `targets`; frames' `pixel_hash`, `final`, `ids`, `normal`, `depth` | #378's, #968's, #166's | existing |
| **`view3d`'s target `velocity`** | criterion 11 | **new target** |
| **`deep-gpu run --planted gpu_layer_multiply_as_screen`** | criterion 9's wrong program | **new value** |
| **`deep-gpu run --planted instanced_skips_velocity`** | criterion 11's wrong program | **new value** |
| `deep-sandbox`: `rewrite`, `run` (role `provider`, `seed`, `budget`, `read`), `web_runner` | #238's | existing |
| **`deep-sandbox --planted rewrite_rotl_as_rotr`** | criterion 9's wrong program | **new value** |

### `view3d`'s `velocity` target (new)

`"targets": [..., "velocity"]` adds to each captured frame `"velocity": <sha256>`, naming `<sha256>.f32` under `out`:
the core's velocity target as that frame drew it (#431's: the screen motion of what shows at each pixel over the
shutter, in device px, x to the right), read back and written as little-endian f32, **two a pixel (x, then y)**, rows
top-down, `w × h × 8` bytes, each value widened from the target's own format with no other change. Naming the target in
`targets` is a read of it, so the core builds it for that call (#431: built only when something reads it), whether or
not an operator of the document reads it. At the base the call answers `{"code": "bad_input", "reason": "targets are
final, linear, ids, …"}`.

The other targets are read as the base writes them: `ids`, an 8-bit RGBA PNG whose pixel holds the pick ID
`r + 2^8·g + 2^16·b + 2^24·a`, 0 where nothing draws (#378); `normal`, three f32 a pixel (#968); `depth`, one f32 a
pixel, the view-axis depth (#166); `pixel_hash`, the SHA-256 of the frame's slot (#378), which is "the final frame's
hash" here.

### Planted programs

Each is one criterion's wrong program, reachable only through the value named, never by an environment variable and
never in a shipped build's default path; an unknown name answers `bad_input`, as today.

| Name | How | What it does wrong, in the criterion's words | Criterion |
|---|---|---|---|
| `expansion_drops_stroke` | `deep-show run`: the scenario's `planted` | A planted expansion that drops one item's stroke: when a recipe instance expands, one derived item whose paint has a stroke is made without it (any one such item of each instance; nothing else changes) | 7 |
| `gpu_layer_multiply_as_screen` | `deep-gpu run --planted` | A planted GPU-layer blend that differs from Vello CPU: the GPU layer composites a group whose `blend` is `multiply` as `screen`. Vello CPU and GPUI draw as before | 9 |
| `rewrite_rotl_as_rotr` | `deep-sandbox --planted` | A planted rewrite that changes a result: the rewrite copies every `i64.rotl` as `i64.rotr`. The check, the engine and every other instruction are as before | 9 |
| `instanced_skips_velocity` | `deep-gpu run --planted` | A planted instanced path that leaves out the instances in the velocity pass alone: an `instance@1`'s elements draw into every other target and the final frame as before, and write nothing to the velocity target | 11 |

Each must fail this suite's own check in the way its row of the table above says, and must leave the rest of its test
passing.

### What stays the suite group's

A pair here is compared by this suite's own check, in test code, on what the binaries drew (the design: the named
oracles stay reviewed test code). The lanes, their case lists, a fixture's verdict word in a lane's report, the release
bar, and criterion 5's rule that every comparison has a planted-mismatch twin are the `suite` group's. These files are
what a lane would list as its cases for these pairs; they use no lane entry. The names `recipe-expansion`,
`pack-kind-expansion`, `group-opacity-1`, `gpui-gpu-layer` and `seek-play` are this suite's names for the five pairs
in its failure text, not fixture names of the kit's naming scheme.

## Fixtures

All made in test code or kept as data in `fixtures/`; no outside tool, no personal data. `generate.ts` holds them as
pure functions.

### The pairs (criterion 7)

Boards of 320 × 200 units drawn at one pixel a unit, every box on whole pixels, strokes 2 units wide.

| Pair | Side a | Side b | Backends, and how compared |
|---|---|---|---|
| `recipe-expansion` | An item of the recipe `pairs.badge@1` with n = 3 at (24, 24), from the test pack `test/pairs@1.0.0` | The four rects its steps make, written out by hand from the recipe's text: a stroked plate 40 × 40 at (24, 24) and three stroked pips 12 × 12 at (80 + 24 i, 38) | Vello CPU both: bit for bit |
| `pack-kind-expansion` | An item of the pack kind `pairs.tile@1` (a `kinds` entry backed by a recipe) at its defaults | Its two rects: a stroked rim 40 × 40 at (24, 24), a bar 48 × 8 at (80, 40) | Vello CPU both: bit for bit |
| `group-opacity-1` | Two overlapping rects, one stroked, in a `group@1` with `opacity: 1` | The same two rects with no group | Vello CPU both: bit for bit |
| `gpui-gpu-layer` | #385's 2D writer layer (`writerDoc`: a panel, a gradient band, a disc, a title, a stroked rule) by GPUI | The same layer by the GPU layer | Two backends: #385's oracle for this pair (`layerParityProblems`): interior pixels within one code value on 99.9%, each glyph run's and stroke's coverage within 2% of Vello CPU's and its centroid within 0.1 px, the blank guard first |
| `seek-play` | #1897's sliding board, a seek to each of 0, 0.5 s, 1 s, 1.5 s and 2 s − 1 flick | A play to it | The GPU pixel hash of each side's canonical render: equal |

No item of an expansion touches another, so the comparison doesn't hang on the order derived items draw in. The test
pack is `fixtures/packs/pairs-1.0.0/` (`pack.json`, `pairs.badge@1.json`, `pairs.tile@1.json`); the base installs it
with no issue.

### The generated cases (criterion 9), with the counts

Seeds are recorded in `generated.test.ts`; the generator is mulberry32 (`seeded`), and the same seed gives the same
case, which each test checks. Every failure text names the seed.

- **Figures** (`figure(seed)`), 4 seeds (45800, 45802, 45809, 45812): 256 × 128, a ground, 2 to 4 solid rects and a
  group in a seeded blend mode (`normal`, `multiply` or `screen`) holding one rect, every edge on a multiple of 8 px.
  Seed 45802's group multiplies; no other's does. Each is drawn 6 ways: as generated; with an invisible item (a rect
  over the whole figure, `visible: false`); with `r0` in an identity group (a `group@1` with no params); with every ID
  renamed; after one patch of two `set` ops; after the same two ops as two patches. 24 renderings, each by Vello CPU and
  by the GPU layer.
- **The tolerance class** of Vello CPU against the GPU layer on these figures (#138's form): `within: 1` code value
  `on: 99.9`% of pixels, `ceiling: 2`, `window: {size: 8, off: 4}`. Reason: two renderers each round a color once, so a
  fill may land one code value apart; every edge is on a whole pixel and every fill is solid, so no pixel holds
  coverage for them to disagree on. (At the base the two are identical on all 24.)
- **Films** (`film(seed, id)`), 2 seeds (45801, 45803): #172's piece-with-stages shape, 320 × 180, 4 s at 30 fps, a dot
  two drivers move with time by seeded coefficients. Each is exported twice, as generated and with the three document
  transforms at once, and read at 0.5 s, 1.5 s and 3.25 s: 4 exports, 12 probes, 2 paths each.
- **Programs** (`program(seed)`), 6 seeds (45801, 45804, 45805, 45806, 45808, 45811): a provider (`memory` of one
  fixed page, `gen(arg: i64) → i32`, `params_at`, `assets_at`, `out_at`) whose `gen` folds its argument through a loop
  of 3 to 6 i64 operations (add, sub, mul, xor, or, and, shl, shr_u, rotl) with seeded constants, 3 to 10 trips, leaves
  the 64-bit result at memory 0 and returns its low 32 bits. Integers only, a few dozen operations and no call, so no
  fuel, stack or NaN rule applies. Seed 45804's program rotates left; no other's does. Each runs once with `gen(9)`,
  fuel 1,000,000, reading 8 bytes at 0. The expected value of each is computed in BigInt arithmetic from the
  WebAssembly specification's integer rules, outside any engine, and the program as written must give it.

### The fleet (criterion 11)

`fleetDoc("instances" | "items")`: 25 boxes 0.75 m across on a 5 × 5 grid 2 m apart, sliding 3 m along x over 2 s,
under a perspective camera whose orbit turns a quarter turn in the same 2 s; a black sky and an unlit white material.
As instances: one `instance@1` (`of: ["proto"]`, `ids` 0 to 24, `pos` the grid) whose own `at.pos` a channel slides,
and a hidden prototype. As items: 25 `mark.box@1` items `fleet-00` … `fleet-24`, each slid by its own channel. Drawn
at 320 × 240 and 32 frames a second; the 10 sampled times are frames 4, 10, 16, …, 58 (0.125 s to 1.8125 s). Every
number is a small multiple of a power of two, and so is every sampled time and the shutter's ends, so an element's
place (the instancer's slide plus its row) and an item's (its own channel) are the same number however each is
composed. At the base the `final`, `ids`, `normal` and `depth` targets of the two are already identical at all 10
times, with pick IDs 1 to 25 on both sides.

## Legs that read BLOCKED

None of these is ever a pass or a skip: the test fails with a message starting `BLOCKED:`.

- Off macOS (no Metal device), every GPU or GPUI leg: BLOCKED. A `gpu_unavailable` answer to `determinism`, a renderer
  that refuses the layer, or a side the blank guard voids: BLOCKED.
- No Chrome at its path (or `CHROME_BIN`), a Chrome that opens no DevTools port, or one that offers no WebGPU adapter
  headless: the web-player leg is BLOCKED (#172's helpers say so); without Chrome the web-runner leg is BLOCKED (#238's).
- A binary that doesn't build fails each test that uses it with cargo's error.

## Readings where the issue and design leave a choice

- **Who compares.** The criteria say pairs "are compared" and a planted program "fails its pair, naming …". Here the
  comparison is this suite's own check on what the binaries drew, and the naming is that check's failure text, as #1897's
  and #431's suites read the same wording. No product call judges a pair, so the implementer builds only the wrong
  programs and the `velocity` target; whether a lane also reports these pairs by a verdict word is the suite group's.
- **A recipe, and a pack kind.** A recipe is an item whose kind is a pack's recipe (`pairs.badge@1`, no `kinds`
  entry); a pack kind is an item whose kind the pack declares under `kinds`, backed by a recipe (`pairs.tile@1`). "Its
  expansion into primitives" is written by hand from the recipe's text, never read back from the program's own
  `expansions`, which a planted expansion would also change.
- **"A planted expansion that drops one item's stroke"** names no item. The test takes any one stroked derived item of
  the badge: the first pixel that differs must be the top-left pixel of that item's stroke, and every differing pixel
  must be on that one stroke. Whether the plant also reaches the pack kind's expansion isn't asserted.
- **"An item at opacity 1 and the same item with no group"** is the design's "a group at opacity 1 and no group": two
  overlapping items in a group whose opacity is 1.
- **"Within its tolerance class"** for GPUI against the GPU layer is #385's oracle for that pair, which masks edge
  pixels by the layer's own edge list and checks each glyph run and stroke apart; it isn't #138's `{within, on,
  ceiling, window}` form, which has no mask. For Vello CPU against the GPU layer on the generated figures it is #138's
  form with the numbers above.
- **"With no golden."** The `deep-show` runs take an empty golden store and leave it empty, and no test makes a
  `golden`, `record`, `goldens` or `decide` call.
- **"Vello CPU and the GPU layer."** The design's Generated inputs bullet says "Vello CPU and Vello GPU"; the issue
  says the GPU layer. The test draws `layers`' `gpu_layer`, which for a 2D writer layer is Vello GPU on the app's
  device (#385), so both readings are one.
- **"Logic programs."** The design says "logic programs inside the logic subset". The generated programs are programs
  in the one subset in the `provider` role, the role `deep-sandbox`'s `run` and the web runner run; a logic item's
  program (`init`, `step`) is held to the same check and rewrite but is run only by the logic module and the web
  player, which this suite doesn't drive (below).
- **"The sandbox's rewrite of a program and the original."** The rewrite runs on wasmtime (`deep-sandbox`'s `run`,
  which always rewrites). The original runs unrewritten in the test process's own WebAssembly engine, and must first
  give the BigInt model's value. Engines are compared apart, on the same rewritten bytes.
- **"In the app and the web player"** is compared on evaluated data (`eval`'s paths against `probe().values`), exact,
  as #172 compares its pieces; not on pixels, which two GPU backends don't share.
- **"By hash where the pair is exact."** Exact pairs compare the whole value (raw pixels, a run's return and bytes, or
  evaluated numbers), which is at least as strict as comparing digests of them.
- **The transforms.** The four are document transforms; programs take none. A patch split in two is applied to a
  hub-stored document by `deep show`'s patches, and the stored documents are then drawn; the web export takes a whole
  document, so the films take the other three, together. The design's "or reordered" isn't in the issue's list.
- **"A planted … blend … on one generated document"**: the plant is in the GPU layer's `multiply`, and one figure of
  the four multiplies. **"A planted rewrite that changes one result"**: the plant is in `i64.rotl`, and one program of
  the six rotates left.
- **"25 instances … moving"**: the instancer slides, so every element moves, and the camera orbits. **"10 sampled
  times"**: 10 frames spread over the 2 s. **"Equal ID … targets, bit for bit"**: the raw pick IDs, which the two
  documents are ordered to get alike. **"Keeps the final frame's hash"**: each sampled frame's `pixel_hash` under the
  plant equals the honest run's. **"Naming the target and the first pixel"**: the first sampled time's first pixel in
  row-major order, which must be a box's pixel.
- **Small sizes.** Where a criterion gives no count, the counts are small and stated above: 5 seek times, 4 figures,
  2 films, 6 programs, 320 × 240 frames.

## What isn't covered, and why

- **Lanes, verdict words, the release bar, and twins of each comparison** (criteria 1 to 6 and 8): the `suite` group's.
  Only the planted programs criteria 7, 9 and 11 name are built here.
- **The design's generator** (wasm-smith set to the subset, shrinking a failure to its smallest valid case, 1,000 or
  100,000 cases): the criterion names recorded seeds and the transforms, not the generator or a count. This suite's
  generators are small and its own; a failure names its seed and the seed replays it, with no shrinking.
- **Logic items' programs** on the logic module and in the web player: generating one needs the layout probe of
  `deep-logic` and a document around it, and #172's and #533's suites already hold the app's and the player's logic to
  each other on a written program.
- **Pixels of the web player**, and each document transform alone on a film: see the readings.
- **Elements with rotation or scale columns, more than 256 elements (the GPU cull), lit materials and shadows**: the
  criterion's 25 moving instances need none, and each would add ways for the two sides to differ that it doesn't name.
- **Other platforms**: every GPU leg draws on Metal; "on one machine" needs no second one.
