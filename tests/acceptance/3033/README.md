# Acceptance tests for #3033: open water from a wind: a sea sums 64 waves drawn from the wind's spectrum at check

Written first, from issue #3033 (its scope, its seven acceptance criteria, its proof line: "The wave table at two winds
with its significant heights, the speeds, the correlation curves for a sea and for four waves, the hashes, and each
planted table failing", and its Runs on line), the design sections it links, and base commit `c7dc0edc` ("Merge pull
request #3058 …"), by a job that never saw an implementation; none existed. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one file per
criterion, one test per clause that needs its own run, plus exactly the three planted programs the criteria name.

## What was read

- Issue #3033, and the issues it cites: #78 (the epic), #166 (water; it left "an ocean spectrum" out by name).
- `docs/canvas-primitives.md`: Material: water, The cost model, Not proposed, and why (the three the issue links).
- `docs/technical-design.md`: Dogfooding; Tests written first, by a job that never sees the code; Who drafts it.
  `docs/parallel-proof.md`: 5 (binaries for tests), 7 (the `alone` block, a suite's own lane file), 12a (budget windows).
- At the base, for call shapes only: AGENTS.md, CONTRIBUTING.md; `tests/acceptance/166/`, `268/`, `968/`, `2760/` (the
  water suites: README, helpers, tests) and `2691/` (how a suite keeps the merge base's hashes);
  `crates/deep-canvas-scene3d/src/water.rs` (how `waves` is read: `parse`, `wind_of`, `wind`, `heading`, `G`);
  `crates/deep-scene3d-render/src/{water,planted}.rs` (the four waves' uniform, `Planted`);
  `crates/deep-gpu-layer/src/{main,view3d,session3}.rs` and `view3d/parse.rs` (the call table, `--backend noop`,
  `--planted`, `view3d`'s fields and targets, `receipt`, refusals); `crates/deep-scene3d-render/src/lib.rs`
  (`read_view_depth`: +∞ where nothing is drawn); `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`,
  `validateBudgets`, `references`); `benchmarks/budgets.json` (the frozen water tasks); `scripts/proof-change.mjs`
  (`criterionId`); `scripts/lanes.mjs` (`alone`, `timed`, how a failure's first word is read).

## What the base already does, which these tests don't credit

Seen at the base (At the base, below). `view3d` draws #166's water with #268's shore, #968's flow and #2760's rings:
`waves` a list of at most four or a wind, from which a fixed table picks four. `receipt: true` answers the maps'
receipt alone, `receipt: {"decoded_bytes": 0, "maps": []}` for these documents, on Metal and on `--backend noop`,
where `view3d` checks and evaluates and draws nothing (each frame's `pixel_hash` is null). **A `waves` object with no
`wind` key is read as the wind itself** (`water.rs`: `parse` hands it to `wind_of`), so the base reads `waves: {sea:
{…}}` as a wind with no `speed` and draws the default 3 m/s breeze's four waves: the sea film and the same film with
`waves: {wind: {speed: 3, direction: 0}}` have one pixel hash. It refuses nothing. There is no `sea`, no wave table in
any reply, no planted name of this suite's (`deep-gpu run --planted <unknown>` prints `{"ok":false,"code":"bad_input"}`
and exits 2) and no `canvas-water-sea` task. So at the base every test of new behavior fails at an assertion on a
missing record (`receipt.water.waves`), a refused planted name or a missing task; criterion 5 holds there by
construction and passes; the timing and the taste call fail before they reach their INCONCLUSIVE. `BASE-FAILURE.txt`
holds every file's run against the base.

## Run them

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/3033 --no-file-parallelism --testTimeout=3600000
npx tsc -p tests/acceptance/3033/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Each file builds `deep-gpu` once with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked --bin
deep-gpu`, putting the pinned toolchain (`~/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin`) first on PATH when it
is there, copies the binary out of the target folder (`CARGO_TARGET_DIR` honoured) and fails each test if the build
failed. Each test writes into its own temporary folder and deletes it; `height`, `repeat` and `unchanged` also keep
their readings as `target/acceptance/3033/{tables,repeat,unchanged}.json` (the proof line's wave tables, significant
heights, correlation curves and hashes). Imports: Node built-ins and vitest only; the lane's judge and validator run as
`scripts/benchmark.mjs` in a child process. A run with `--root tests/acceptance/3033` leaves Vitest's cache in
`tests/acceptance/3033/node_modules/.vite`; delete it.

The files run one at a time and the timing must have the machine to itself. This README is the instruction; the
implementer adds to `scripts/lanes.mjs` (the folder's own `tests/acceptance/3033/lane.json`, `{"alone": true, "why":
"…"}`, serves for the first line if it lands with the suite; docs/parallel-proof.md, 7):

```js
// #3033's files build deep-gpu; height, speed and repeat read the sea's wave table on the noop backend, the others
// draw on the GPU; budgets.test.ts times a sea at 1080p.
alone.push('tests/acceptance/3033/');
timed.push('tests/acceptance/3033/budgets.test.ts');
```

Which machine each file needs, as the issue's Runs on line says:

- **Any machine** (`height.test.ts`, `speed.test.ts`, `repeat.test.ts`, and the first test of `budgets.test.ts`): the wave
  table is read from `deep-gpu run --backend noop`, which opens no GPU and draws nothing, and its measures are
  evaluated in the suite in f64.
- **This Mac's Metal GPU** (`vertex.test.ts`, `unchanged.test.ts`, `taste.test.ts`, the timing of `budgets.test.ts`): off
  macOS, where the binary finds no device (`no_device`, `missing_feature`), or where a reply says
  `unsupported_platform` or `gpu_unavailable`, a test fails with a message starting `BLOCKED:`, the issue's word for the
  pixel hashes and the time without a GPU; never a pass.
- **The machine the merge base's hashes were read on** (`unchanged.test.ts`): on any other, `INCONCLUSIVE:`.
- **A reference Mac at rest** (the timing of `budgets.test.ts`): on mains power, Low Power Mode off, thermal state
  nominal, the load at each run's start and end at most the core count, as the lane's `judgeLimit` reads the fingerprint
  and the loads; anywhere else `INCONCLUSIVE:` before anything is timed. The issue's verdict is the budget window's.
- `taste.test.ts` keeps its three files in `DEEPBUILD_EVIDENCE_DIR` (else `$TMPDIR/deep-3033-evidence`), prints their
  paths, and reads the owner's taste call; without it the test fails `INCONCLUSIVE:`.

## Surface choices

**No new binary and no new call.** #377's `deep-gpu run [--backend noop] [--planted <name>]` with its JSON-lines
protocol unchanged (`{"out", "calls"}` in, `{"ok", "replies"}` out) and #378's `view3d` with #423's `receipt: true`.
Names the issue and the design give are used as they give them; the rest are this suite's choices, marked **bold**,
each the least a criterion needs, and each a requirement on the implementation (the list is at the end).

### Documents (scene3d, as #166's and #2760's suites write them)

One writer layer `main` (writer `agent:sess-alpha`), camera `cam`, `seed: 3033`, `requires: {modules: {scene3d: "^1"}}`,
items keyed by ID. The water is a `material@1` item `sea-water` (`params.water`) on a `plate@1` part `sea` (`params:
{grid, size}`), centred on the origin at y = 0, unturned; every fixture also holds a day sky and a sun.

- **The sea form of `waves` is the one-key object `{"sea": {"wind": m/s, "direction": deg, "spread": deg, "seed":
  u32}}`**, the issue's `sea {wind: m/s, direction: deg = 0, spread: deg = 30, seed}` written as the wind form is
  written (`{"wind": {"speed", "direction"}}`). Every fixture spells all four fields: `{"sea": {"wind": 10 | 5,
  "direction": 90, "spread": 30, "seed": 3033}}`. The issue gives `seed` no default, so none is assumed.
- "The same plate with `waves: wind`" and "the same plate with four waves" are `waves: {"wind": {"speed": 10,
  "direction": 90}}` on the same plate: the four waves the base's table picks for the same wind.
- A heading d runs along (sin d, cos d) in (x, z), as the base reads a wave's `direction`: every fixture's wind blows
  along 90°, +x.
- **Every sea's plate is at least 100 m on its shorter side** (the scope refuses a sea on a smaller one): 2 km × 2 km
  for the table's measures, 400 m × 400 m for the vertices and the film, 1 km × 1 km for the budget and the still.

### `view3d`: the receipt lists the water's wave table

`{"call": "view3d", "doc", "look", "size", "frames", "fps", "from"?, "capture"?, "targets"?, "timings"?, "receipt"?}` as
the base has it; read: each frame's `frame`, `pixel_hash`, `final` (PNG by SHA-256), `depth` (#166's: f32, one a
pixel, the distance along the view axis in m, +∞ where nothing is drawn), `reflection` (by its SHA-256) and `gpu_ms`.
Added, under the base's call field `receipt: true`:

- **`receipt.water: {"material": ID, "waves": [row, …]}`** in the reply: the view's water, by its material item's ID,
  and the wave table "the receipt lists": one row for each wave the water sums. **Required for a `sea` and for a
  `wind`** (criterion 3 reads the four waves of `waves: wind` from it); a list's rows aren't read. **The same on
  `--backend noop`**, where nothing is drawn: the table is made at check.
- **A row is `{"direction": deg, "length": m, "amplitude": m, "phase": rad, "speed": m/s, "vertex": bool}`**:
  `direction` its heading as a listed wave's `direction` is; `length` over 0; `amplitude` 0 or more; `phase` its phase
  at the origin at t = 0, in radians (0 for a wind's waves, which have none); `speed` the speed it travels at;
  `vertex` true when the vertex stage sums the row and false when only the pixel's normal does. The scope names the
  direction, length, amplitude and phase; criterion 2 reads the speed; criterion 4 needs "the waves the vertex stage
  draws", which only the program can say. More fields in a row are free.
- Refusals stay the base's `{code, reason}` or `{code: "refused", issues}`; no test here asks for one.

### The closed form and the measures (`helpers.ts`)

"Any machine for the wave table and its measures, which are evaluated data in f64": the suite reads the table and
evaluates the measures itself, in f64, from the rows alone.

- **The height** at a rest point (x, z) and time t is Σ amplitude × cos(k (D · (x, z)) − k × speed × t + phase) over
  the rows, k = 2π ÷ length, D = (sin d, cos d) for the row's `direction` d. The three measures below don't depend on
  the sign or the origin of the phase or on which way a heading turns, only on the rows' lengths, amplitudes and
  directions relative to the wind's; so they hold the table, not a convention.
- **g = 9.81 m/s²**, the water's own (`water.rs`: `G`), under which the issue's 0.21 × wind² ÷ g is its 2.14 m and
  0.54 m, and its 100 m wave moves 12.495 m in a second.
- **"4,096 seeded points over 600 s"** is 4,096 samples, each a point of the plate at rest and a time: x and z uniform
  over the plate and t uniform over [0, 600) s, drawn x, z, t in turn from one 32-bit linear congruential generator
  (x ← 1664525 x + 1013904223 mod 2³², the value x ÷ 2³²) seeded 3033.
- **The significant height** (criterion 1) is four times the standard deviation (over the 4,096, about their mean) of
  the height at the samples drawn over the whole 2 km plate.
- **The correlation along the wind** (criterion 3) at a lag is the correlation coefficient, over the 4,096 samples
  drawn over the plate's upwind half (x from −1000 to 0 m), of the height at the sample's point and the height at the
  point that lag further along +x at the same time; **"every lag from 200 m to 1 km" is every whole metre**, 801 lags.

### Planted programs (`deep-gpu run --planted <name>`, reachable only there)

Each acts on the sea's table as it is made at check, before the receipt lists it and before anything draws from it, so
its run on `--backend noop` shows it; everything else as shipped. Each test runs the suite's own check of that
criterion on the planted run's table and holds what the check finds.

| Name | The wrong program | Where its run must fail, naming what | Criterion |
|---|---|---|---|
| **`water_sea_amplitudes_halved`** | Every row's amplitude is half of what the spectrum gives | The significant-height check at 10 m/s reads 1.07 m (within 5%) and fails, its failure naming the wind: `a wind of 10 m/s` | `#3033.b7819eb1` |
| **`water_sea_speed_of_longest`** | Every row's speed is the longest wave's, √(g × the longest length ÷ 2π) | The speed check fails for every row shorter than the longest and no other, each failure naming its row: `row <index> of the wave table` | `#3033.dbde0e46` |
| **`water_sea_draws_four_longest`** | The sea keeps only the four longest waves of its table: the receipt lists those four and the sea draws those four | The correlation check fails, each failure naming its lag: `at a lag of <n> m along the wind` | `#3033.2b265ebd` |

### `benchmarks/budgets.json`: one task added

**`{"id": "canvas-water-sea", "command": ["node", "benchmarks/canvas.mjs", "water-sea"], "targets": {"sea_gpu_ms":
0.6}, "margin": 0.5, "limits": {…}, "initialReason": "… #3033 …", "criteria": ["#3033.49bf9e99"]}`**, passing
`validateBudgets` against the merge base's file (which freezes the four earlier water tasks, so a new task rather than a
changed one). What the mode prints is the implementer's, as the lane needs it. The budget window measures it at the
merged commit against its merge base; until that window closes the criterion the PR says `Part of #3033`.

### Files and environment

- `DEEPBUILD_EVIDENCE_DIR` (optional): where `sea-<sha>.png`, `four-waves-<sha>.png` and
  `sea-beside-four-waves-<sha>.png` go.
- **`tests/acceptance/3033/TASTE.json`** (or the file `DEEPBUILD_TASTE_3033` names): the owner's taste call (The taste
  call, below).
- `tests/acceptance/3033/fixtures/base/unchanged.json`: the merge base's hashes (The merge base's readings, below).

## The fixtures

- **The wide plate** (`helpers.ts`: `tableCall`; criteria 1 to 3): 2 km × 2 km of 8 × 8 cells, never drawn; one `view3d`
  frame at 64 × 36 with `receipt: true` on `--backend noop`. A sea at 10 m/s, one at 5 m/s, and `waves: wind` at
  10 m/s.
- **The 400 m sea** (`vertex.test.ts`): 400 m × 400 m of 256 × 256 cells, a sea at 10 m/s, at 10 fps. Seen straight down
  from 150 m (fov 110° at 512 × 512: 428 m of the plane) for the vertices; with a white tower (4 m × 4 m, 22 m out of
  the water at (−40, −45)) and a camera 9 m up, 150 m off the centre, at 480 × 270, for the film. **The 20 sampled
  times** are 20 frames drawn without repeat from frames 1 to 199 (0.1 to 19.9 s) by the generator above seeded 3033.
- **The half-frame sea** (`budgets.test.ts`): 1 km × 1 km of 256 × 256 cells (the grid of #166's and #268's budget
  lakes), a sea at 10 m/s, seen at 1920 × 1080 by a level camera 12 m up, 60 m in from the near edge, fov 60°: the
  water fills the frame from its bottom row to 0.7° under the horizon, 48% of it at rest. Against the same plate and
  camera with `waves: wind` at 10 m/s.
- **The 1 km sea** (`taste.test.ts`): 1 km × 1 km of 1,024 × 1,024 cells, the tower, a camera 14 m up at (−330, 300)
  looking across the wind at the tower 450 m off, fov 50°, at 20 s (frame 600 at 30 fps), 1280 × 720, filmic. Once as a
  sea at 10 m/s, once with `waves: wind` at 10 m/s.
- **Criterion 5's fixtures** (`neighbours.ts`): the water documents #166's and #968's tests hash, repeated from those
  suites' helpers with their own seeds and descriptions (suites don't import each other), 21 documents and 59 frames:
  #166's harbour of `seek.test.ts` (3 documents; frames 17, 44, 89), `defaults.test.ts` (5; 0, 20, 45), `foam.test.ts`
  (3; 600) and `taste.test.ts` (4; 30, 360, 270, 359) and the pond of `mirror.test.ts` (2; frame 30, with the
  `reflection` target's hash); #968's flowing channel of `channel.test.ts` (its 30 frames 4, 8, … 120) and the channel
  and river of `taste.test.ts` (3; frames 45, and 30, 90, 149 of the recording). Each frame is opened by a seek at
  30 fps, at the look and size its suite's test draws it at. Each repeated document and look was compared with the one
  its suite's helpers build, byte for byte as JSON, by a probe at the base that isn't kept: all 21 equal.

## The merge base's readings

Criterion 5 compares with the merge base. Its readings are `fixtures/base/unchanged.json`: 61 hashes (59 pixel hashes
and the pond's two `reflection` hashes). **What records them is this suite itself**: the file is, byte for byte, what
a run of `unchanged.test.ts` on the unchanged base keeps as `target/acceptance/3033/unchanged.json`. It names its
commit, an empty list of changed paths, the machine (model, chip, macOS build) and the binary; `mergeBase` in
`helpers.ts` refuses a file that names another commit or a changed tree, and on a machine whose model, chip or macOS
build differs the test is `INCONCLUSIVE:`.

It was read on a Mac17,10 (Apple M5 Max), macOS build 26B8119, from the debug binary of `c7dc0edc` (`cargo build
--locked --bin deep-gpu`), by the first run of `unchanged.test.ts` at the base, which had no reading to compare with
and ended `INCONCLUSIVE: no reading of the merge base is kept …`; its sha256 is
`6cb0e57dc05bc6b40145026de74b21451b9bded0c9452462d5f600e053ef48cb`. A second run, a fresh process, compared with it and
passed: all 61 hashes repeated, and the file that run kept is byte for byte the first's. The criterion holds at the
base by construction, and this is its output there:

```
#3033.88aca207: 61 hashes of 59 frames of 21 documents; kept as target/acceptance/3033/unchanged.json
 ✓ unchanged.test.ts (1 test) 26395ms
   ✓ #3033.88aca207 water whose waves are left as they are draws as on the merge base (1)
     ✓ #3033.88aca207 with waves left as it is, every water document #166's and #968's suites hash has the merge base's hash at every frame they hash 25139ms
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

Of the 61, 43 are distinct: `water: {}` and its spelled-out defaults have one hash at frames 0, 20 and 45, as #166's
own test holds them, and #968's channel, whose flow has a 2 s cycle over water with no waves and no wind, draws frame
n + 60 as it draws frame n (frames 4 to 60 against 64 to 120). The implementer doesn't record the file again: a reading
taken from a tree that holds the change is not the merge base's, and `mergeBase` refuses one that names another commit
or a changed tree.

Why recorded and not built at run time: building the merge base in every run is a second full build on a Mac many
sessions share, and a pixel hash repeats on one machine (the design's same-machine determinism; the two runs at the
base gave the same 61). The cost is that the readings hold on one machine and one macOS build, and for one merge base:
after an OS or driver update, or once the change's merge base has moved past a commit that redraws these documents,
they are stale until a redraft of this job takes them again (check out the merge base, run `unchanged.test.ts`, copy
the kept file over `fixtures/base/unchanged.json`).

## The taste call

`tests/acceptance/3033/TASTE.json` is the one file anyone adds to this folder after this commit, and only to record the
owner's answer once the still has been shown to the owner. This job does not create it; an agent's word isn't a call
(AGENTS.md, invariant 1). The check run takes the still and prints its three files; the owner looks at
`sea-beside-four-waves-<sha>.png` (the sea on the left, the same plate with four waves on the right) and records, in
the form #268's recorded call has:

```json
{"criterion": "#3033.5c2dc7ad", "by": "you", "screenshots": ["<sha256 of sea-….png>", "<sha256 of four-waves-….png>"], "call": "looks_right"}
```

`screenshots` are the SHA-256 of the two pictures the still is made of, the renderer's own PNGs byte for byte, in
either order (the still's every pixel is one of theirs; its own file is the suite's encoding of them, so its bytes
aren't what the call is tied to). `call` is `looks_right` when the still reads as open water, `looks_wrong` when it
doesn't. With no record, with `by` other than `you`, or with a record made on other pictures, the test is
`INCONCLUSIVE:`; `looks_wrong` fails it; a `note` beside the fields is free. `DEEPBUILD_TASTE_3033` names another file to
read, as the neighbouring suites' variable does.

## At the base

Each file was run once against the base's binary (`unchanged.test.ts` twice: The merge base's readings, above), one at
a time under the machine's test grant, on a Mac17,10 (Apple M5 Max), macOS build 26B8119, on its Metal GPU, at a
one-minute load of 140 to 200 on 18 cores. `BASE-FAILURE.txt` holds the runs. Of the 12 tests, 11 fail, each at an
assertion for its criterion's reason and none at import, at start-up or at a timeout, and criterion 5's passes (the
table below). No test file was changed after the run.

Probes at the base, not kept, each a fact a fixture leans on:

- `deep-gpu run --backend noop` answers `view3d` for the wide plate, as a sea and with `waves: wind`, with `frames`
  (their `pixel_hash` null) and `receipt: {"decoded_bytes": 0, "maps": []}`.
- The 400 m film with the `sea` object and with `waves: {wind: {speed: 3, direction: 0}}` has one pixel hash at frame
  20: the base reads the `sea` object as the default wind. With `waves: wind` at 10 m/s its 200 frames at 10 fps have
  200 different hashes.
- Straight down from 150 m at fov 110°, with `waves: wind` at 10 m/s: the `depth` target is finite over 87.2% and 87.7%
  of the pixels at two frames and +∞ over the rest, none NaN. The surface stands from −1.067 to +1.066 m, inside the
  four waves' summed 1.070 m, and reaches at most 0.66 m outside the plate at rest, where a pixel is 0.84 m.
- The half-frame camera (`far: 5000`) over the 1 km plate with `waves: wind` at 10 m/s: 48.08% of the 1080p frame is
  drawn.
- The still's camera (`far: 5000`) over the 1 km plate of 1,024 × 1,024 cells: the tower stands at the frame's centre
  and the water fills the frame below the horizon.

Not seen from the program, since the base lists no table and has no sea:

- That the base's four waves pass 0.9 by the suite's measure. By the base's constants (`water.rs`: `WIND`), worked by
  hand while drafting and not copied into the suite, a 10 m/s wind's four read 0.935 at 914 m.
- Any passing run of a test of new behavior, and each planted program's failure. Run without the program: the measures
  on made-up tables (a 64-wave table reads 2.149 m and 0.534 m and stays under 0.3, at most 0.207; halved it reads
  1.075 m and fails naming the wind; with one speed it fails naming rows; cut to its four longest it fails at 78 lags,
  the first 271 m), and the still's side-by-side encoding read back.
- The timing of criterion 6: its test fails at the base before the machine is read, and at this load the machine would
  have read INCONCLUSIVE.

Also checked: the type-check (`npx tsc -p tests/acceptance/3033/tsconfig.json`, clean); the 21 repeated documents and
looks against #166's and #968's own helpers' (all equal); the public-text scan of these files (no finding).

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed, `- [ ] ` dropped
(`scripts/proof-change.mjs: criterionId`), computed from the issue's body. Each test's name starts with its ID. "At the
base" is the run `BASE-FAILURE.txt` holds.

| ID | Criterion | File: what it asserts | At the base |
|---|---|---|---|
| `#3033.b7819eb1` | 1: significant height; planted halved table | `height.test.ts` (2): the tables of a sea at 10 m/s and at 5 m/s read 2.14 m and 0.54 m within 5% by four times the standard deviation of the height at the 4,096 samples. `water_sea_amplitudes_halved`: reads 1.07 m within 5% and fails naming `a wind of 10 m/s`. | Both fail. Test 1: `the receipt of a sea from a wind of 10 m/s lists its wave table, receipt.water.waves: expected null not to be null`. Test 2: `deep-gpu run --backend noop --planted water_sea_amplitudes_halved exits 0 …; stdout: {"ok":false,"code":"bad_input"} …: expected 2 to be +0`. |
| `#3033.dbde0e46` | 2: every row's speed; planted one speed | `speed.test.ts` (2): every row of both tables has `speed` within 1e-9 of √(g × length ÷ 2π); the formula gives 12.5 m/s to one decimal at 100 m and half of it at 25 m; each table holds more than one length. `water_sea_speed_of_longest`: every row has the longest wave's speed, and the check fails naming each shorter row. | Both fail, as criterion 1's: the missing table (`… expected null not to be null`), and `--planted water_sea_speed_of_longest` unknown (`bad_input`, exit 2). |
| `#3033.2b265ebd` | 3: no repeat along the wind; planted four waves | `repeat.test.ts` (2): the 10 m/s sea's correlation along the wind is under 0.3 at all 801 lags; the same plate with `waves: wind` passes 0.9 at one. `water_sea_draws_four_longest`: the check fails naming a lag. | Both fail, as criterion 1's: the missing table (`… expected null not to be null`), and `--planted water_sea_draws_four_longest` unknown (`bad_input`, exit 2). |
| `#3033.485e37d6` | 4: vertices within the summed amplitude; seek equals play | `vertex.test.ts` (2): at the 20 sampled times, every surface point the `depth` target shows from above stands within the summed amplitude of the rows with `vertex: true` (+ 1 mm) of the plate at rest and no further outside it (+ one pixel); the sea covers over four fifths of each frame and the heights span over a quarter of the bound. The 20 sampled frames seeked cold have the played frames' pixel hashes, all 20 differ, and the film's receipt lists a sea's table. | Both fail, after the base drew both films (the `sea` object as four waves). Test 1: `the receipt lists the sea's wave table, receipt.water.waves: expected null not to be null`. Test 2: `the film is of a sea: its receipt lists the sea's wave table, receipt.water.waves: expected null not to be null`. |
| `#3033.88aca207` | 5: #166's and #968's suites unchanged | `unchanged.test.ts`: the 61 hashes of the 59 frames of the 21 documents equal the merge base's. | Passes, by construction: all 61 hashes are the reading's. The first run, before the reading was kept, ended `INCONCLUSIVE: no reading of the merge base is kept …`. |
| `#3033.49bf9e99` | 6: budget | `budgets.test.ts` (2): the `canvas-water-sea` task and the lane's validator against the merge base. The half-frame sea against the same plate with `waves: wind`: the sea side's receipt lists a sea's table, each side covers 45% to 55% of the frame, the sides differ; then ≤ 0.6 ms in five runs judged by the lane. | Both fail. Test 1: `budgets.json has the task canvas-water-sea: expected undefined to be defined` (the validator accepted the file). Test 2: `the side that is timed is a sea: its receipt lists the sea's wave table, receipt.water.waves: expected null not to be null`, before the machine is read. |
| `#3033.5c2dc7ad` | 7: taste | `taste.test.ts`: the 1 km sea and the same plate with four waves as the renderer's PNGs and the still of both; the sea's receipt lists a sea's table and the pictures differ; INCONCLUSIVE without the owner's recorded call; `looks_wrong` fails. | Fails: `the still is of a sea: its receipt lists the sea's wave table, receipt.water.waves: expected null not to be null`, before any file is kept or a call is read. |

Proof line: "the wave table at two winds with its significant heights" and "the speeds" are `tables.json` and criterion
1's and 2's log lines; "the correlation curves for a sea and for four waves" are `repeat.json` and criterion 3's log
lines; "the hashes" are `unchanged.json` and criterion 4's seek test; "each planted table failing" is the three planted
tests.

## Ambiguities

Readings where the issue and the design leave a choice. Each is the smallest one that could be grounded; none drops or
adds a criterion.

- **Who evaluates the measures** (criteria 1 to 3). The Runs on line calls the table and its measures "evaluated data
  in f64" on any machine. The suite evaluates them from the table's rows, so the product needs one new record and no
  measuring call, and each planted table fails in the suite's check, as the neighbouring suites' planted programs do.
  The other reading, a height or a measure the product reports, would need a call the issue doesn't name.
- **"4,096 seeded points over 600 s"** (criterion 1) is read as 4,096 samples in space and time, each point at its own
  time. The other reading, 4,096 points each over a time series, needs a time step the issue doesn't give. The
  estimate's own spread is about 1% of the height, well inside the 5%.
- **"Within 5%"** holds both winds, each against the number the issue writes (2.14 m, 0.54 m; 0.21 × wind² ÷ g is
  2.1407 and 0.5352), and the planted table's 1.07 m too: half of a reading within 5% of 2.14 is within 5% of 1.07.
- **"Naming the wind"**: the check's failure sentence states the wind's speed, `a wind of 10 m/s`. The plant is run at
  10 m/s only, the wind the criterion's 1.07 m belongs to.
- **Which tables criterion 2 reads**: the sea's at 10 m/s and at 5 m/s (the proof line's two winds). **"So the 100 m
  wave moves about 12.5 m in a second and the 25 m wave half that"** is held on the criterion's formula as the suite
  evaluates it, since a sea's table need not hold a wave of either length and the criterion names no other surface.
  That a drawn wave travels at its row's speed is not read from pixels (Gaps).
- **g** is the base's 9.81, not 9.80665: within 1e-9 the two differ.
- **"Along the wind … at every lag"** (criterion 3): the correlation coefficient over criterion 1's kind of sample
  (4,096 seeded points over 600 s), pairs a lag apart along the wind's heading at one time, at every whole metre. On
  the tables tried while drafting (made up, not a program's) it lies within about 0.04 of the long-run form Σ A² cos(k
  × lag × cos δ) ÷ Σ A² (δ a wave's heading from the wind's); a table tuned to just under 0.3 by that form may read
  over it here. The criterion names no wind: the sea is the issue's 10 m/s one. **"The same plate"** is the 2 km plate,
  which holds both ends of every pair; the criterion's 1 km plate (criterion 7's) can't hold a 1 km lag with points to
  spare, and the table is made from the wind and the seed, not from the plate.
- **How `waves: wind` is evaluated** (criterion 3): nothing on the base reports a wind's four waves, and copying the
  base's table into the suite would hold the program to its own internals. So the receipt lists them, as it lists a
  sea's: one field for both.
- **"A planted sea that draws only its four longest waves"** acts on the table (it keeps four rows), so the measure,
  which runs with no GPU, sees it. The test doesn't check which four: a table may hold waves of equal length.
- **"No vertex moves further than the summed amplitude"** (criterion 4) is read through #166's `depth` target, seen
  straight down, as #166's and #268's suites read a vertex's height: each pixel shows a surface point, which lies
  between vertices, so a point outside the bound proves a vertex outside it. It is a necessary condition, read at
  512 × 512 pixel centres at 20 times: a vertex that overshoots only between them, or sideways by less than a pixel
  beyond the bound at the plate's edge, isn't seen. **"The waves the vertex stage draws"** are the rows with `vertex:
  true`; the scope's "16 longest" is not asserted.
- **"20 sampled times hash the same seeked and played"**: as #166's `seek.test.ts`, one film played from frame 0 and
  each sampled frame opened cold by `from`, compared by `pixel_hash`; 10 fps so 20 s is 200 frames. The criterion
  doesn't say the 20 differ; the test holds that they do, so a still sea doesn't pass.
- **Which documents, frames and targets count** (criterion 5): every water document those two suites' tests compare
  by a hash, at the frames and with the hash they compare (the frame's `pixel_hash`; the `reflection` target's hash for
  #166's mirror). Left out: #166's `physics.test.ts` (its stand-in world's documents; one of its tests is in
  `scripts/known-failures.json`), `rain.test.ts`, `tint.test.ts` and `waves.test.ts` and #968's `foam.test.ts`, which
  compare records and float targets with closed forms within tolerances, not hashes, and both suites' 1080p timing
  documents. Those tests stay in the lanes and judge themselves.
- **"A sea filling half of a 1080p frame"** (criterion 6): the level camera above, as #166's budget fills its half;
  the test holds the share between 45% and 55% by the `depth` target. The sea is at 10 m/s on a 1 km plate of
  256 × 256 cells; the criterion names neither, and a finer plate costs the vertex stage more.
- **"One still … beside …"** (criterion 7): two frames of one camera and time, the sea's and the four waves', put side
  by side by the suite, pixel for pixel, since one view holds one water. "Four waves" is `waves: wind` at the same
  10 m/s.
- **BLOCKED or INCONCLUSIVE.** The neighbouring suites fail `INCONCLUSIVE:` off macOS. The issue's Runs on line says
  "Without a GPU those read BLOCKED, never PASS", so here a missing GPU fails `BLOCKED:`; another machine than the one
  the hashes were read on, a machine that can't time, and a missing taste call fail `INCONCLUSIVE:`. The lanes read
  both as not passed.
- **The taste call's file**: the neighbouring water suites read a file their `DEEPBUILD_TASTE_<n>` names, and #268's
  recorded call lives in its folder as `TASTE.json`. This suite reads `tests/acceptance/3033/TASTE.json`, or the file
  the variable names.

## Gaps, and what is not asserted because no criterion says so

The implementer owes these a mapping or a note (AGENTS.md: review requirement → change → proof):

- **That the drawn sea is the listed table.** Criteria 1 to 3 measure the table; criterion 4 bounds the drawn surface
  by the table's vertex rows and holds seek to play. No criterion holds the drawn heights or normals to the table's
  closed form, so a program that lists one table and draws another passes this suite. #166's criterion 1 (depth within
  1 mm of the closed form) is the form such a proof would take.
- The scope's 64 waves, the 16 longest in the vertex stage and all 64 in the pixel's normal; `spread` other than 30 and
  `direction` other than 90; that another `seed` draws another table; a sea's default `direction` and `spread`.
- The refusal of a sea on a plate under 100 m on its shorter side, naming the plate.
- Foam, the shore's calm, a wake and rings on a sea.
- "The surface never returns to an earlier shape within a film" beyond 20 different frames in 20 s.
- The Cost line's sea costs and the Not proposed row. At the base "Not proposed, and why" has no row that names water
  or a sea (the "ocean spectrum" was left out in #166's scope, not in the design), so the scope's "the Not proposed row
  for water says a sea is a row now" has no row to edit as written; the implementer says which row carries it.
- Criterion 6's verdict: the budget window's, on a reference Mac at the merged commit. This suite's timing is the same
  measure judged by the lane's rule, and INCONCLUSIVE on a loaded or other machine.
- Criterion 7's verdict: the owner's. Unrecorded, it is INCONCLUSIVE.

## What the implementation must provide

Stated as requirements of these tests:

1. `water.waves` takes `{"sea": {"wind", "direction", "spread", "seed"}}` on a plate of 100 m or more.
2. `view3d` with `receipt: true` answers `receipt.water: {"material", "waves": [{"direction", "length", "amplitude",
   "phase", "speed", "vertex"}]}` for a `sea` and for a `wind`, on Metal and on `--backend noop`, in the units above.
3. `deep-gpu run --planted` takes `water_sea_amplitudes_halved`, `water_sea_speed_of_longest` and
   `water_sea_draws_four_longest`, each acting on the sea's table as described.
4. `benchmarks/budgets.json` holds the task `canvas-water-sea` as written above, and `benchmarks/canvas.mjs` its mode
   `water-sea`.
5. `scripts/lanes.mjs` (or the folder's `lane.json`) runs the folder alone, and `timed` holds `budgets.test.ts`.
6. Water whose `waves` is a list or a wind draws the merge base's pixels.
7. The owner's call in `TASTE.json`; never the implementer's.
