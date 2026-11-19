# Acceptance tests for #1993, the track part: drops from an input track, and a pattern's ring budget and seek

Criteria 3 and 4 of issue #1993 ("Stepped grids and fields: water rings, growing patterns, pinned cloth and n-body on
carried state, with a stability bound the check enforces"). The issue's suite is written in parts, each in a folder of
its own under `tests/acceptance/1993/` and each self-contained: this one imports nothing from outside its folder but
node and vitest.

Written first, from issue #1993 (its Scope, Fields, criteria 3 and 4 and its Proof line), its Oracle page
(`doneright/oracles/issues/1993.md`: no upstream test checks any criterion), the design sections it links and base
commit `9550dc0f` ("Merge pull request #2831 …", which holds #252's stepped operators, carried storage and checkpoint
ring), by jobs that never saw an implementation; none existed. One blind job wrote the two test files, `helpers.ts`,
`tsconfig.json` and the fixture; a second wrote this README and `BASE-FAILURE.txt` from those files, unchanged, and ran
them at the base. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft
(design: Dogfooding). Lean: one file per criterion, each with the planted twin its criterion names.

## What was read

By the job that wrote this README (the test files name their own sources in their header comments):

- Issue #1993 with its one comment, and its Oracle page.
- This folder's `ac3-drops-from-track.test.ts`, `ac4-pattern-ring.test.ts`, `helpers.ts`, `tsconfig.json` and
  `fixtures/look.json`, in full.
- `docs/canvas-primitives.md`: Carried state; Input track; Checkpoint ring. `docs/technical-design.md`: Dogfooding.
- At the base: AGENTS.md; `tests/acceptance/252/` (README and BASE-FAILURE, the model for these two files); the rows of
  `tests/acceptance/483/README.md` (`read`), `484/README.md` (`seeks`), `508/README.md` (`track`) and `378/README.md`
  (`capture`) that say what the calls used here already take; `crates/deep-canvas-effects/src/graph.rs` (an input's
  `from` forms), `graph/read.rs` (an output's fields) and `check.rs` (`stepped_rules`);
  `crates/deep-gpu-layer/src/main.rs` (the `Planted` list) and `view3d.rs` (where a frame gets `carried`);
  `scripts/proof-change.mjs` (`criterionId`) and `scripts/lanes.mjs` (`alone`).

Nothing outside the brief's inputs was needed for these two files.

## What the base already does, which these tests don't credit

`deep-gpu run [--planted <name>]` answers one scenario line with one reply per call. `check_operator` checks and
costs an operator (`outcome`, `estimate_ns`, `issues`). `view3d` draws a document's operator items on a virtual clock
at `fps`, jumps after a frame with `seeks: [{after, to}]`, reads an operator's output back on each captured frame
with `read`, and applies an input `track` to the document's controls on the frame clock, so a control change lands in
the frame drawn at its time (#508). From #252 a compute operator takes `stepped: {rate}`, a storage output takes
`carry: {every, budget}`, an input reads carried storage with `{storage: {op, output, step: "previous"}}` or the step
index with `{time: "step"}`, and each frame reports `carried` rows for carried storage.

What the base lacks: `carry` is read only beside `storage` (`graph/read.rs`), and a texture input's `step` isn't read
at all, so `{texture: {op, output, step: "previous"}}` is taken as the plain target `{op, output}` (`graph.rs`). The
check therefore accepts both fixtures' operators and `view3d` draws both documents, but nothing is carried in a
texture: no frame reports a `carried` row for `pond.height`, `pond.velocity`, `pattern.u` or `pattern.v`. Neither
planted name below exists: `deep-gpu run --planted <name>` exits 2 with `{"ok":false,"code":"bad_input"}`.

## Run them

They build `deep-gpu`, so they run with `--no-file-parallelism`, and `scripts/lanes.mjs` needs
`'tests/acceptance/1993/'` in its `alone` list beside `'tests/acceptance/252/'`. This README is the instruction; the
implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/1993/track --no-file-parallelism
npx tsc -p tests/acceptance/1993/track/tsconfig.json   # type-check
```

Each file builds its binary once with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked --bin
deep-gpu` (those two only where the environment doesn't set them; `/opt/homebrew/opt/rustup/bin` goes first on `PATH`
where it exists), copies it out of `target/debug` (or `CARGO_TARGET_DIR`) to a temporary folder and fails each test
that uses it if the build failed, as `BLOCKED:` if cargo could not run. Each test writes into its own temporary folder
and deletes it.

- Anything the GPU runs runs on Metal: off macOS, or on a reply with code `unsupported_platform`, a test fails with a
  message starting `INCONCLUSIVE:`, never passing.
- Every test carries its own timeout, 30 minutes, and the build hook 60. A `deep-gpu run` that hasn't answered in 25
  minutes is stopped (the child the test started, nothing else) and reads as a refusal, which fails the test.
- Nothing here is timed and no taste call is read: criteria 3 and 4 name no budget, and criterion 8 belongs to another
  part. Every hash is compared within one test's runs on one machine.
- `BASE-FAILURE.txt` holds each file's one run at the base and each test's failing assertion.

## The surface under test

**No new binary and no new call.** #377's `deep-gpu run [--planted <name>]` with its JSON-lines protocol unchanged
(one line in, `{out, calls}`; one line out, `{ok: true, replies}` with one reply per call), #429's `check_operator`
and #378's `view3d`; with one output field and one input form of the issue's Fields, #252's `carried` rows for texture
outputs, the input track read step by step, and two planted programs. Each is the least a criterion needs.

### Stepped textures, as operator data (both criteria)

| Field | Form these tests write | Why it's the least |
|---|---|---|
| `carry: {every, budget}` on a `texture` output of a stepped compute operator | `{texture: {format: "r32float", size: [512, 512]}, carry: {every: 60, budget: 33554432}}` (the pond's `height` and `velocity`); `{texture: {format: "r32float", size: [1024, 1024]}, carry: {every: 60, budget: 83886080}}` (the pattern's `u` and `v`). Carried as #252's storage is: kept between steps and frames, a checkpoint every `every` steps in a ring within `budget` bytes. A checkpoint's bytes are its texture's (width × height × 4) | Fields: `outputs.<name>.carry` on a `texture` output |
| Input `{type: "texture", from: {texture: {op, output, step: "previous"}}}` | `{type: "texture", from: {texture: {op: "pond", output: "height", step: "previous"}}}`: the carried texture as the previous step left it, zeros before the first step. Each operator reads its own two outputs, with `load@1` (`{tex, ixy}`) and `split@1` (`pick: "x"`), 6 texels a cell | Fields: `inputs.<name>.from.texture` |
| `stepped: {rate}` (#252's), with no `bound` | `{rate: 60}` (the pond), `{rate: 600}` (the pattern). Neither fixture writes `stepped.bound`, so an operator without one still checks and steps | The bound is criterion 2's, another part's |
| A channel input on a stepped operator | `{type: "f32", default: 0, from: {channel: "items/pointer/at/pos/0"}}` (and `/1`, `/2`): read at each step as the document stands at that step's time, the track's entries at or before the step's flick applied (see `track` below) | Scope: input reaches a stepped operator "only as input-track entries, read at the step they land on" |

Both operators write one f32 a texel with `store@1` (`{tex: <output>, ixy, v}`), and the pattern reads #252's step
index (`{type: "u32", from: {time: "step"}}`) to lay its fields at step 0. Each is `kind: "compute"`,
`origin: "composed"`, `workgroup: 256`, one element a texel (`elements` 262,144 and 1,048,576), and declares as
`cost.ns_per_element` the `estimate_ns` that `check_operator` answers for it: the check must answer `outcome:
"accepted"` with a number there, or the test fails on the check's refusal.

### `view3d` (#378's): what the tests write and read

The calls, each with the fixture's `look` and `size: [64, 64]`:

| Call | Form |
|---|---|
| The pond's play (criterion 3) | `{call: "view3d", doc, fps: 60, frames: 1202, track, seeks: [{after: 1200, to: 450}], capture: [0, 60, … 1200, 450], read: ["pond.height", "pond.velocity"]}`: frames 0 to 1,200, then frame 450 again |
| The pond's replay (criterion 3) | `{call: "view3d", doc, fps: 30, frames: 601, track, capture: [0, 30, … 600], read: [the same]}`: the second call of the same `deep-gpu run`, a session of its own |
| The pattern's play (criterion 4) | `{call: "view3d", doc, fps: 60, frames: 602, seeks: [{after: 600, to: 300}], capture: [299, 300], read: ["pattern.u", "pattern.v"]}`: frames 0 to 600, then frame 300 again |

| Field | Form | Why |
|---|---|---|
| `track` (#508's) on a document with a stepped operator | `[{t: flick, seq, control, value, writer: "you", player: 1}]`, 80 entries, `seq` 0 to 79 in order, `t` in whole flicks (705,600,000 a second, 11,760,000 a step of the pond). A step reads the controls as the entries at or before its own flick leave them, whatever frame runs it: at 30 frames a second a frame runs two steps and each reads its own | Criterion 3's replay line; Scope |
| `frames[].frame` | The frame's number; a frame a seek draws again appears again, later in `frames`. Every frame drawn has an entry | Finding the played and the sought frame |
| `frames[].read: {"<op>.<output>": {file}}` (#483's) on a carried texture | On each captured frame, both times a sought number is drawn: `file` is the SHA-256 naming `<sha>.f32` under `out`, little-endian f32, rows top-down, one value a texel or four (RGBA; the test takes the first). The test checks the file hashes to its name | The state hash is the two files' names |
| `frames[].carried: {"<op>.<output>": {step, ring: {bytes, budget, checkpoints: [step]}, restored?: {from, steps}}}` (#252's) for a carried texture | On every frame drawn, for each of the operator's two carried textures, in whole numbers: the step its state holds (frame f at 60 frames a second of the pond holds step f; frame f of the pattern step 10 f; frame f of the replay step 2 f); the ring's bytes held, its `carry.budget` and the steps of the checkpoints it holds, ascending; on the frame a seek drew, the checkpoint step it restored and the steps it then ran | Criterion 4's "never holds more than that" is read off every frame; both seek lines show the seek restored a checkpoint and stepped |

### Planted programs (`deep-gpu run --planted <name>`, each reachable only there)

| Name | The wrong program | Criterion |
|---|---|---|
| `step_reads_live_pointer` | A stepped operator reads the pointer (its channel inputs) as it stands when the frame is drawn, for every step that frame runs, in place of each step's own track entries | cef70375 |
| `ring_checkpoints_textures_on_alternate_steps` | The ring copies an operator's first carried texture (`u`) into a checkpoint at its step and the second (`v`) one step later, so a restored checkpoint holds the two from two different steps | 82266148 |

Each planted run is the criterion's own session under the plant (the document's `check_operator` run stays unplanted).
It must still answer, draw and `read`: the twin test fails if the planted run is refused or a state can't be read.

## The fixtures (helpers.ts)

Each fixture document is a showpiece scene, 64 × 64, 30 s long (`transport.span`), with a camera, a box (`pointer`)
and the one operator as a `gpu.compute@1` item of the writer's layer, written into the test's temporary folder. The
look is #252's (`fixtures/look.json`, its ID changed): tone map none at scale 1. No test reads a pixel.

- **The pond** (`pond-1993`, operator `pond`): a 512 × 512 height grid and its velocity, two carried r32float textures
  stepped 60 times a second. Each step a cell's velocity gains 0.16 of its height's Laplacian (four neighbours, a wall
  cell's missing one being itself) and its height gains that velocity: the wave equation at criterion 1's 0.24 m/s on
  1 cm cells, (0.24 ÷ 60 ÷ 0.01)² = 0.16, undamped, with reflecting walls. While `down` is above 0.5 the step adds a
  drop under the pointer: 1 cm high, a Gaussian of σ = 3 cells. Its ring is `{every: 60, budget: 32 MiB}` a texture
  (1 MiB each), which holds all 21 checkpoints of the run.
- **The pointer** is three document-class sliders, `pointer_x` and `pointer_y` (0 to 511) and `pointer_down` (0 or 1),
  each written by a driver (`expr: "value"`) into one component of the `pointer` item's position, where the operator's
  channel inputs read it. So the pointer reaches the step only through the controls' entries on the track.
- **The track** (`dropTrack`): 20 drops, drop k (0 to 19) at step 60 k + 15, which is k + 0.25 s, at cell
  (96 + 80 (k mod 5), 96 + 100 ⌊k ÷ 5⌋), at least 96 cells from every wall. Half a step before its step the pointer
  moves there and goes down (three entries); half a step after, it comes up (one entry).
- **The pattern** (`pattern-1993`, operator `pattern`): Barkley's model of an excitable medium (D. Barkley, "A model
  for fast computer simulation of waves in excitable media", Physica D 49, 1991), a = 0.75, b = 0.06, ε = 0.02, stepped
  explicitly with Δt = 0.01 on cells of 0.25, its fields u and v two carried 1,024 × 1,024 r32float textures stepped
  600 times a second. Only u diffuses. Step 0 lays u = 1 on the right half and v = a ÷ 2 on the lower half, which
  breaks the first wave into a spiral. Its ring is `{every: 60, budget: 80 MiB}` a texture.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, `- [ ] ` dropped
(`scripts/proof-change.mjs: criterionId`), computed from the issue's body. Each test's name starts with its ID.

| ID | Criterion | Test file: what it asserts |
|---|---|---|
| `#1993.cef70375` | 3: 20 drops from a recorded track; seek to 7.5 s equals play; replay equals play at every checkpoint; planted live pointer | `ac3-drops-from-track.test.ts`: nothing is refused; every frame of the play and of the replay reports both textures' `carried` rows; the play's frame 1,200 holds step 1,200 and each ring holds checkpoints 0, 60, … 1,200; at each of those steps and at step 450 the summed height is within half a drop's volume of the volume of the drops landed by then (0, 1, … 20, and 8); the seek's frame 450 reports `restored: {from: 420, steps: 30}`, step 450 and the played frame 450's hash; the replay's frame 30 k holds step 60 k and hashes as the play's frame 60 k, for k = 0 to 20. Twin `step_reads_live_pointer` is not refused and fails the replay line with "the replay differs from the play first at checkpoint 1 (step 60, 1 s)" |
| `#1993.82266148` | 4: ring within 160 MiB, 20 checkpoints of 8 MiB; seek to step 3,000 equals play; planted alternate-step ring | `ac4-pattern-ring.test.ts`: nothing is refused; every frame reports both textures' `carried` rows; frame 600 holds step 6,000; on every frame drawn, the seek's too, the two rings hold the same checkpoint steps, each names budget 83,886,080, each holds 4,194,304 bytes a checkpoint, and together at most 167,772,160; at step 3,000 both fields are finite, u is not flat and the state differs from step 2,990's; the seek's frame 300 reports `restored: {from: n, steps: 3000 − n}`, n the latest checkpoint at or before 3,000 that frame 600's ring held, step 3,000 and the played frame 300's hash. Twin `ring_checkpoints_textures_on_alternate_steps` is not refused and fails the seek line with "the seek to step 3000 hashes …" |

## Readings where the issue and design leave a choice

- **The ring's 160 MiB is the two textures' budgets together.** `carry` is a field of one output (Fields), so each
  texture's `carry.budget` is half, 80 MiB, and each frame reports a ring a texture, naming 80 MiB. A texture is
  1,024 × 1,024 × 4 bytes, 4 MiB, so "a checkpoint of 8 MiB" is the pair, and the two rings must hold the same steps
  (Scope: "carried and checkpointed together"). "Never holds more than that" is every frame's two `ring.bytes`
  summing to at most 160 MiB. A checkpoint every 60 steps would be 101 by step 6,000, 808 MiB, so the budget binds
  from step 1,200 on and the ring thins (Checkpoint ring: the spacing doubles). The test holds no thinning schedule,
  only that the seek restores the latest checkpoint the ring still held at or before its target.
- **"Replaying the track"** is a second session given the same document and the same recorded track, in the same
  `deep-gpu run`, drawn at 30 frames a second where the play drew 60, so each frame runs two steps. At the play's own
  rate a step that reads the live pointer sees what the track's entries give it and nothing could tell them apart; at
  half the rate the frame that runs step 60 k + 15 is drawn at step 60 k + 16, when the pointer is up again.
- **"Every checkpoint"** is the 21 steps at which the pond's ring takes one, 0, 60, … 1,200, one a whole second.
  Checkpoint k is step 60 k, so the planted replay, which takes no drop, first differs at checkpoint 1.
- **"A recorded input track"** is written by the test in #508's form, not captured from a session. "20 drops over
  20 s" is one a second, a quarter second after each whole second, so no drop lands on a checkpoint.
- **"Takes 20 drops"** is counted by volume: walls reflect and nothing damps, so the summed height changes only by
  the drops added, and the test holds it within half a drop of the landed drops' volume.
- **"Seeking back to 7.5 s"** is one session played to 20 s that jumps back to frame 450 (#484's `seeks`). The seek
  restores checkpoint 420 and steps 30, through the drop at 7.25 s (step 435), so it reads the track again.
- **The state hash** is the two textures' files as `read` wrote them, `"<key> <sha> <key> <sha>"`, each SHA-256
  naming its file and checked against its bytes.
- **The pond's cells, rate and speed** are criterion 1's (1 cm, 60 steps a second, 0.24 m/s); criterion 3 names only
  the grid's size. Height and velocity are two carried textures of one operator.
- **The pattern's frames** are 60 a second, ten steps each: step 3,000 is frame 300 and 10 s is frame 600. "The
  pattern runs" (finite, not flat, moved in ten steps) is there so two equal blank states can't pass the seek line.
- **Not tested** (no criterion of this part asks it): a seek's time (the issue's comment notes #252's seek-time line
  has no home in this issue), `stepped.bound`, passes and materials reading the grid with `load` and `sample`, key
  input, a seek spread across live frames, a cold session opened at the target, and anything across machines.

## Upstream tests (the Oracle lane)

None: the Oracle page lists no upstream test for either criterion; both are held to our own play, seek and replay
hashes.
