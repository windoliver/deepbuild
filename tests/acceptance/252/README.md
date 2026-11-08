# Acceptance tests for #252: GPU state stepped between frames — big flocks, live fire and soft blobs as declared carried state, same-machine class

Written first, from issue #252 (its scope, 4 acceptance criteria and proof line), its Oracle page
(`doneright/oracles/issues/252.md`: no upstream test checks any criterion), the design sections it links and those they
lean on, and base commit `9bdebdfb` ("Merge pull request #1560 …", which holds #429's GPU operators and #483's
structural steps), by a job that never saw an implementation; none existed. The owner decided to build #252, which
reopens the design's deferred "GPU state stepped between frames" (technical design: Cut, or deferred) and the GPU
operator's rule that it never reads state from an earlier frame. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one file per criterion,
with the planted twins the criteria name.

## What was read

- Issue #252 and its Oracle page.
- `docs/technical-design.md`: GPU operator; Particles, closed form; World pages; Logic bake and checks; Pure evaluation;
  Device gate, capture and export; Cut, or deferred; Numbers version 0 has to hold (the canvas row; Every task carries
  its own budgets: five runs after warm-up, the margin, INCONCLUSIVE; the reference Macs).
- `docs/canvas-primitives.md`: The cost model and its budget class table; Carried state; Checkpoint ring; Bake; Golden;
  Logic: checkpoints and bake; Logic: world pages; Determinism; Frame budget; the whole of GPU operators, as data (GPU
  operator; Step and the closed step list and its structural steps; Operator input; Operator output; Place in the
  frame; Compile, validate and cache; Operator cost and limits; Determinism class; Operator budgets by class).
- At the base: AGENTS.md; `tests/acceptance/483/` and `429/` (the models: README, helpers, tsconfig, BASE-FAILURE, budgets,
  taste, sort, seek and classes tests), `380/goldens.test.ts` (golden's `environment` stand-in), `428/taste.test.ts` (a
  recording as an animated PNG); `crates/deep-gpu-layer/src/{main,view3d,opframe,golden}.rs`;
  `crates/deep-canvas-effects/src/{graph,check,table}.rs`; `crates/deep-canvas/src/steps.rs`; `scripts/lanes.mjs`.

## What the base already does, which these tests don't credit

`check_operator` checks and costs an operator; compute operators write storage at their own slots, add anywhere through
atomic statements, and run every frame, their storage starting each frame at its `clear` value; passes read storage
through `read@1`. `view3d` draws a document's operator items on a virtual clock at `fps`, opens a session at `from`,
jumps after a frame with `seeks: [{after, to}]`, and with `read` reads an operator's output back on each captured
frame. `golden` judges a PNG or a view3d frame's final target against a blessed golden, INCONCLUSIVE under a changed
fingerprint (`environment` stands in for another machine's); `decide` blesses a PNG by your decision. There is no
operator field `stepped` (an operator with one is refused, `operator_type`, "not a field of an operator"), no `carry`
on a storage output, no input that reads the previous step or the step index, nothing carried between frames, no
`carried` or `wall_ms` in view3d's frames, no `read` on `golden`, no `state` in `decide`'s bless, no `class` in
golden's reply, and none of the three planted names below.

## Run them

They build `deep-gpu`, so they run with `--no-file-parallelism`, and `scripts/lanes.mjs` needs
`'tests/acceptance/252/'` in its `alone` list beside `'tests/acceptance/483/'`. This README is the instruction; the
implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/252 --no-file-parallelism
npx tsc -p tests/acceptance/252/tsconfig.json   # type-check
```

Each file builds its binary once with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked --bin
deep-gpu`, copies it out of `target/debug` to a temporary folder and fails each test that uses it if the build failed.
Each test writes into its own temporary folder and deletes it.

- Anything the GPU runs runs on Metal: off macOS a test fails with a message starting `INCONCLUSIVE:`, never passing.
- The one timed test (`ring.test.ts`, the seek time) runs only on a reference Mac (Mac15,7 or Mac15,12; power and Low
  Power Mode not gated, by the owner's rule) and through the design's judge; a miss on a machine whose one-minute load
  is over 1 a core reads INCONCLUSIVE, never FAIL or PASS. It reads the dev binary, as #96's budgets do.
- `taste.test.ts` keeps its three screenshots and three recordings in `DEEPBUILD_EVIDENCE_DIR` (else
  `$TMPDIR/deep-252-taste`) and reads your taste call from the file `DEEPBUILD_TASTE_252` names; without it the test
  fails as `INCONCLUSIVE:`.
- `BASE-FAILURE.txt` says why the suite can't pass at the base; it wasn't run there beyond the type-check.

## The surface under test

**No new binary and no new call.** #377's `deep-gpu run [--planted <name>]` with its JSON-lines protocol unchanged,
#429's operator check, #378's `view3d`, #380's `golden` and `decide`; with three operator fields, two input forms, two
view3d reply fields, a field each on `golden`, golden's reply and `decide`, and three planted programs. Each is the
least a criterion needs, as its row says.

### Stepped operators, as operator data (all three criteria)

| Field | Form these tests write | Why it's the least |
|---|---|---|
| `stepped: {rate}` on a compute operator | `{rate: 60}`: the operator runs once per fixed step, `rate` steps a second of document time, not once per frame. Step k is computed when the frame's time t reaches k ÷ rate, so the state at t holds steps 0 … ⌊t × rate⌋; a frame that passes several steps runs them all, in order; every stepped operator in a document runs in each step, in dependency order (`flock_grid` then `flock`) | Scope: "storage it steps once per fixed step"; criterion 1's 30 and 144 Hz |
| `carry: {every, budget}` on a stepped operator's storage output | `{storage: {type: "f32", count}, carry: {every: 60, budget: <bytes>}}`: carried state, kept between steps and frames (never reset to `clear`), with a checkpoint every `every` steps in a ring within `budget` bytes, whose spacing doubles each time the ring passes its budget (Carried state; Checkpoint ring). A checkpoint's bytes are its storage's bytes | Scope: "checkpoints at a declared interval and a byte budget"; criterion 2 forces the budget |
| Input `{type, count, from: {storage: {op, output, step: "previous"}}}` | The carried output as the previous step left it, zeros before step 0; an operator may read its own (`flock` reads `flock.state`) | The one read of an earlier step the design forbade, scoped to declared carried storage |
| Input `{type: "u32", from: {time: "step"}}` | The index of the step being computed, 0 for the first | Seeded noise per step, and step 0's placement |
| A plain storage input on carried storage | `{storage: {op, output}}` from a per-frame operator or pass reads it as the frame's latest step left it | How the frames show it (criterion 4) |

Other storage outputs of a stepped operator (`flock_grid.grid`) start each step at their `clear` value, as a frame's
do today. Its computed class is at most `same_machine` (Scope); the check costs it as any compute operator.

### `view3d` (#378's): reply fields added

| Field | Meaning | Why |
|---|---|---|
| `frames[].carried: {"<op>.<output>": {step, ring: {bytes, budget, checkpoints: [step]}, restored?: {from, steps}}}` | On every frame drawn, for each carried output: the step its state holds; the ring's bytes held, its budget and the steps of the checkpoints it holds; on a frame a seek drew, the checkpoint step it restored and the steps it then ran | Criterion 2's "the ring stays within it" is read off every frame; criterion 1's frames say which step they show; a seek is shown to restore the nearest checkpoint, as Scope says |
| `frames[].wall_ms` (with `timings: true`) | The frame's wall time, from its start (before any seek's restore) until its pixels are read back | Criterion 2's seek time is a frame's |

A seek on the virtual clock (as exports, checks and goldens run, Carried state) waits for every step it needs and draws
the frame it lands on. `read: ["flock.state"]` (#483's) reads the carried state as the frame shows it.

### `golden` and `decide` (#380's): fields added (criterion 3)

- `golden` takes `read: "<op>.<output>"` beside `view3d`: the snapshot is that output's bytes as the view3d's first
  frame (frame `from`) reads them, compared with `oracle: "hash"` byte for byte. Its reply adds `class`: the operator's
  computed class. A `same_machine` snapshot compares only under the fingerprint its golden was blessed under; under
  another it reads `INCONCLUSIVE`, `environment_changed`, naming both fingerprints, with no `numbers`, as a frame's does
  today. (An exact one would compare across machines; no criterion here asks it.)
- `decide`'s bless takes `state: <path>` in place of `png`: your decision records those bytes as the fixture's golden
  under this run's fingerprint.

### Planted programs (`deep-gpu run --planted <name>`, each reachable only there)

| Name | The wrong program | Criterion |
|---|---|---|
| `steps_per_frame` | A stepped operator runs once per frame drawn instead of once per fixed step | e326cc65 |
| `ring_keeps_every_checkpoint` | The ring keeps a checkpoint every `every` steps and never thins | 1d7d5564 |
| `carried_class_exact` | A stepped operator's carried state computes as class `exact`, so goldens compare it across machines | 3f867a9b |

## The fixtures (helpers.ts)

Every fixture document is a showpiece (its passes draw at full resolution, past a figure's half), 65 s long, a camera,
a box the passes draw over and the operators, each declaring the cost the check estimates for it. The look is
#483's (`fixtures/look.json`, its ID changed): tone map none at scale 1, so a pass's color reaches the final as written.

- **The flock**, 262,144 boids, each three carried f32 (x and y on the unit torus, a heading): Vicsek's model
  (Vicsek et al., Phys. Rev. Lett. 75, 1995) on a 128 × 128 cell grid. Each step `flock_grid` adds each boid's heading
  as a fixed-point unit vector into its cell with two atomic adds, and `flock` turns each boid to its cell's mean
  heading (itself included) plus noise seeded by (boid, step), and moves it 0.0015 along it. Neighbours are a cell's
  boids, 16 on average: a boid reads 5 words, within a compute operator's 8 fetches, and the cell sums are order-free
  integer atomics, so no sort is needed (a sort-by-cell neighbour scan through #483's `sort_by_key` would take two more
  operators a step and 2 fetches a neighbour). `flock_density` counts boids per texel of a 512 × 512 grid each frame
  and `flock_view` shades it. Its ring for criteria 1, 3 and 4 is the design's defaults (every 60 steps, 16 MiB).
- **Live fire**: a 256 × 256 carried heat grid; each cell takes the row below's heat (1, 2, 1) blended with its own,
  less seeded cooling; a burning floor spreads from the middle a quarter cell a step. `fire_view` maps heat to black,
  red, yellow and white.
- **A soft blob**: a 256 × 256 damped membrane (carried height and velocity) held at 0 outside a disc of radius 100,
  pushed once at step 0 by a Gaussian dent off centre, so it wobbles from where it was pushed. `blob_view` shades its
  slope.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, `- [ ] ` dropped
(`scripts/proof-change.mjs: criterionId`), computed from the live issue. Each test's name starts with its ID.

| ID | Criterion | Test file: what it asserts |
|---|---|---|
| `#252.e326cc65` | 1: seek equals play by hash; planted per-frame stepping | `stepping.test.ts`: the flock's state at step 1,800 (`flock.state`'s SHA-256) played at 60 Hz equals it after stepping to 3,600 and seeking back, played at 30 Hz (frame 900) and at 144 Hz (frame 4,320), and opened cold at 1,800, each frame reporting step 1,800; the played state is a flock that moved since step 1,799. Twin `steps_per_frame` differs at 30 and 144 Hz, failing with "at step 1800, the flock played at 30 Hz (frame 900) hashes …" and the same at 144 Hz |
| `#252.1d7d5564` | 2: ring within a forced budget; seek time; planted ring | `ring.test.ts`: budget 20 × 3,145,728 bytes; every frame's ring within it; held checkpoints at step 3,600 at most 240 steps apart; the seek to 1,800 restores the nearest held checkpoint at or before it and equals the play; five seeks after a warm-up each within 488 ms (judged, reference Mac); twin `ring_keeps_every_checkpoint` fails with "operator flock's ring … past its budget" |
| `#252.3f867a9b` | 3: INCONCLUSIVE on a second machine; planted class | `machines.test.ts`: on this machine the flock at 1,800 PASSes its recording and FAILs a one-ulp shift of it, class `same_machine`; under another GPU (`environment`) both read INCONCLUSIVE, `environment_changed`, naming both GPUs, no numbers. Twin `carried_class_exact` reads FAIL there, failing with "… class exact, was compared and read FAIL" |
| `#252.b3fac129` | 4: taste | `taste.test.ts`: INCONCLUSIVE until your call is recorded on these three screenshots and three recordings |

## Readings where the issue and design leave a choice

- **The fixed step** is 60 steps a second, so the three rates the criteria name are 60 (where per-frame and per-step
  stepping agree), 30 (two steps a frame) and 144 Hz (a step every 2.4 frames). Step 1,800 is 30 s; step k is the state
  once the frame's time reaches k ÷ 60. "Naming the step" is the failure's "at step 1800".
- **"Stepped 3,600 steps, then seeked to step 1,800"** is one session played to step 3,600 that jumps back (#484's
  `seeks`); a cold session opened at 1,800 is the design's other seek ("Each seek is made from a cold session and from
  one last played past the target", Determinism). The hash is the SHA-256 of the carried state's bytes as `read` writes
  them, which names the file.
- **The flock's ring for criterion 1** is the design's default, 16 MiB (5 checkpoints of 3 MiB), so the seek restores
  step 960 and steps 840, rather than landing on a checkpoint.
- **"20 checkpoints' bytes"** is 20 × the carried storage's bytes, 62,914,560. "The ring stays within it" is every
  frame's `ring.bytes` at most that. The design's doubling (every 60, then 120, then 240) leaves checkpoints at most 240
  steps apart; the test holds them to that, and the seek to the nearest at or before its target.
- **The class's seek time.** The design names no seek time for any class. What it says: a seek that needs more steps
  than fit in a frame runs them across frames "within the budget class's worker time each frame" (Carried state); a
  restore is O(steps since the checkpoint); a showpiece's operators get 4 ms of GPU time a frame and its frame 10 ms
  (Operator budgets by class; the budget class table). On the virtual clock the sought frame holds the restore, every
  step and the draw. So its bound is the steps a seek can need at the forced ring, 239 (spacing 240, less one), each
  within what a fixed step may take in play (a 30 Hz frame, the showpiece's ambient cap and criterion 1's slowest rate,
  holds two steps in 4 ms: 2 ms a step), plus one 10 ms frame: **239 × 2 + 10 = 488 ms of wall time** for the sought
  frame (`wall_ms`), judged over five seeks after a warm-up on a reference Mac (Numbers version 0 has to hold). The
  seek tested is the criterion's, to step 1,800 (120 steps from checkpoint 1,680), under the worst case's bound.
- **"The same check" on a second machine** is the flock at step 1,800 against its recording: a golden of the carried
  state, since a check must compare against something recorded for "another machine" to mean anything (Scope: "checks
  and goldens compare it only on the machine that recorded it"). The second machine is golden's `environment` with
  another GPU, as #380's test stands in for one. Its flock would differ (f32 rounding, amplified by a flock), simulated
  as the design's planted shift: one ulp of one field (boid 0's x) in the recording. The planted class's FAIL needs that
  difference, and the same-machine FAIL on it shows the comparison runs where it should.
- **"Naming the class"** is the failure carrying the class the golden reports it compared under.
- **A recording** is the canvas's own final PNGs at 30 fps, put into one animated PNG with their compressed data
  unchanged (helpers.ts: `apng`), 256 × 256; screenshots are 512 × 512 finals.
- **Not tested** (no criterion asks it): exports stepping from the start (Scope's third line; no criterion names an
  export), a seek spread across live frames while showing a stale frame (view3d runs on the virtual clock), forks,
  the checkpoint's deep hash, an exact operator's state comparing across machines, and the cache manifest.

## Upstream tests (the Oracle lane)

None: the Oracle page lists no upstream test for any of the four criteria (1 to 3 are held to our own play and seek
hashes, 4 is a person's taste call).
