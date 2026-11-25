# Acceptance tests for #853: stepped particles, GPU particle state advanced at a fixed step

Written first, from issue #853 (its opening paragraph, Scope, six acceptance criteria and Proof line; it has no
comments), its Oracle page (no upstream test checks any criterion), the design sections it links and those they lean
on, and base commit `5fcfb690` (origin/main when the job started), by a job that never saw an implementation: no
other folder, worktree, branch, pull request or agent history was read. The owner decided on 2026-11-22 to build #853,
which takes "GPU state stepped between frames" out of the design's Cut, or deferred, for stepped particles. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). Lean: one test per criterion, one more where a clause needs its own run, and the three wrong programs the
criteria name, each judged by the check its right twin passes, in the same test.

"The surface under test" was written before any test and is what an implementer builds to; the sections after it say
what was read, how to run, the fixtures, each criterion's tests, the readings taken and what isn't asserted.

## The surface under test

**One binary, no new call.** Every test drives `deep-gpu run [--planted <name>]` (#377's JSON-lines protocol: one
scenario line `{"out": "<folder>", "calls": [call, …]}` in, one line `{"ok": true, "replies": [reply, …]}` out), built
with `cargo build --locked --bin deep-gpu`, through calls the base already has: #378's `view3d`, #380's `golden` and
`decide`. **Every name below that the issue or the design doesn't give is this job's choice**, the least its criterion
needs; the implementer builds exactly these, or a dispute goes to a blind redraft. A name marked *base* is read as the
base's suites read it and is listed only because these tests lean on it for the new kind.

### The kind `particles.stepped@1` (mine: every field spelling but the kind's name)

An item of a scene document, its fields in `params`, placed by its `at.pos` (every fixture leaves it unrotated and
unparented). One example, the pour:

```json
{"kind": "particles.stepped@1", "at": {"pos": [0, 1.8, 0]},
 "params": {
   "count": 100000,
   "step_rate": 60,
   "emit": {"shape": {"box": {"size": [0.6, 0.1, 0.6]}}, "rate": 50000, "span": 2, "velocity": [0, -3, 0]},
   "forces": {"gravity": [0, -9.81, 0]},
   "collide": {"world": "pit"},
   "spacing": 0.02,
   "checkpoint": {"every": 60, "budget": 22400000},
   "draw": "dot", "size": 3, "opacity": 1, "color": [{"at": 0, "role": "sand"}]}}
```

| Field | Form the fixtures write | What the tests hold it to | From |
|---|---|---|---|
| `count` | a whole number: 100,000 (the pour), 1,000,000 (the flood), 1,024 (the lift, the corridor, the drops) | the buffer holds `count` particles; every fixture past 65,536 is a `showpiece` document (`budget.class`) | Scope: "at most 1,048,576 in a showpiece or an export" |
| `step_rate` | `60` | the buffer steps 60 times a second of document time, whatever the frame rate: the buffer at step s is the state at time s ÷ 60 s, step 0 the state at 0 s, and a frame at t reads step ⌊t × 60⌋ | Scope: "a fixed rate (60 Hz by default, under the valid-rates rule)"; `logic@1`'s and `physics.world@1`'s spelling |
| `emit.shape` | `{"box": {"size": [x, y, z]}}` | births lie in that axis-aligned box centred on the item's `at.pos`, at points seeded by the document's `seed` (another `seed`, another buffer) | #449's spelling of `particles@1`'s emit regions |
| `emit.rate`, `emit.span` | `50000`, `2` (per s, s) | about `rate` × t particles are live at t: 40% to 60% of the pour at 1 s, at least 95% when its span ends at 2 s, all `count` from 2.5 s on, and under 5% at step 0 | `particles@1`'s `emit: {rate, span}` |
| `emit.bursts` | `[{"t": "0s", "count": 1024}]` | every particle of the burst is live from the step at its time (step 0) | `particles@1`'s `emit.bursts`, as #449 writes it |
| `emit.velocity` | `[24, 0, 0]` (m/s) | each particle's velocity at birth, 0 when absent: with no force it moves `velocity` ÷ 60 a step | mine |
| `forces.gravity` | `[0, -9.81, 0]`, or `[0, 0, 0]` (m/s²) | written in every fixture, so no default is read | Scope: "forces (gravity, …)" |
| `collide.world` | a world ID of the document's `worlds` | a live particle is kept out of every body's shapes of that world (only `box` shapes are used): a static body where it stands, a kinematic body where the world puts it at the step's own time; a particle that moves farther in one step than a shape is thick does not pass it | Scope: "collision against the world's static shapes"; criterion 2 |
| `spacing` | `0.02`, `0.01` (m), or absent | absent: particles don't push each other. Written: 100,000 of them can't lie in one layer of the tray (the pile's height, below) | Scope: "particle-to-particle spacing" |
| `checkpoint` | `{"every": 60, "budget": <bytes>}` | a checkpoint of the buffer at each step that is a multiple of the spacing, which starts at `every` and doubles each time the ring passes `budget` bytes, dropping the checkpoints off the new spacing (Checkpoint ring) | the design's spelling on `physics.world@1` and `logic@1` |
| `readings` | `{"in_gate": {"count": {"box": [[0, 0, -1], [1, 1.9, 1]]}}}` | after each step the item publishes, under that name, how many live particles lie inside the box (two corners, world m) | Scope: "readings the module publishes after a step (counts in a region, …)"; `box: [vec3, vec3]` is `particles@1`'s `kill` spelling |
| `draw`, `size`, `opacity`, `color` | `"dot"`, `3`, `1`, `[{"at": 0, "role": "sand"}]` | the live particles are drawn at their places (frames differ while they move); no test reads a picture | `particles@1`'s, as #449's fixtures write them |

Not written by any fixture, so not spelled here: drag, curl noise, attractors, declared planes, births and deaths
from occurrence lists, attributes.

### The buffer (mine: its name and its layout)

The item's carried state is one buffer, named **`<item ID>.buffer`** (`sand.buffer`) wherever a carried output is named
at the base. Its bytes are little-endian f32 words, **7 a particle with no attributes, in the Scope's order**: particle
i holds words 7i … 7i + 6 = `x, y, z` (its position, world m, +Y up), `vx, vy, vz` (its velocity, m/s) and `age` (s).
**A particle that is live holds an age of 0 or more; one not yet born holds an age below 0.** "The buffer's hash" is the
SHA-256 of those bytes. The pour's buffer is 100,000 × 7 × 4 = 2,800,000 bytes.

### `view3d` on a document that holds the item

| Field | Form | Base or mine |
|---|---|---|
| `read: ["sand.buffer"]` | each captured frame's `read["sand.buffer"].file` is the SHA-256 of the buffer as that frame reads it, naming `<sha256>.u32` under `out` | *base* (#483's `read`), for the buffer |
| `frames[].carried["sand.buffer"]` | `{"step": 150, "ring": {"bytes": n, "budget": n, "checkpoints": [0, 120, …]}, "restored"?: {"from": 120, "steps": 30}}` on every frame drawn: the step the buffer holds, its ring, and on a frame a seek drew the checkpoint restored and the steps then run | *base* (#252's row), for the buffer |
| `seeks: [{"after": 600, "to": 150}]`, `from`, `fps`, `frames`, `capture`, `pixel_hash`, `final`, `evaluate`/`values`, `assets` | as the base has them | *base* |
| `timings: true` | each frame's `passes_ms` holds the GPU time of the item's steps that frame ran under the key **`op.<item ID>`** and any key that starts **`op.<item ID>.`**; the test sums them, and a frame that ran a step holds at least one | *base* key form (`op.<operator item>`), mine for this kind |
| `store: "<folder>"` on a live call (no `class`) | the call keeps the bake of each `particles.stepped@1` item in that folder: the buffer at each frame time it draws. The reply gains **`bakes: {"sand.buffer": {"key": "<64 hex>"}}`**, the key the bake is kept under | `store` is the *base*'s evidence folder; `bakes` is mine |
| `store` with `class: "export"` | the export reads the bake under the document's key and steps nothing: each frame draws, and `read` reads, the buffer the bake holds for that frame time. Its reply holds the same `bakes` entry. With no bake under that key in the store it answers **`{"code": "no_bake", "key": "<64 hex>"}`** and draws no frame | `class: "export"` is the *base*'s; `no_bake` is #2010's word, mine here |

How the store lays a bake out, and what the key hashes, are the implementer's: the tests read only that one document
gives one key in the recording and in the export, and that a document with another `seed` gives another.

### `golden` and `decide` (the *base*'s, #252's fields, for the buffer)

`{"call": "decide", "via": "you", "store", "decision": {"bless": {"fixture": "pour-853", "state": "<file>"}}}` records
a buffer's bytes as the fixture's golden under this run's fingerprint. `{"call": "golden", "store", "fixture",
"oracle": "hash", "view3d": {…, "from": 150, "frames": 1}, "read": "sand.buffer", "environment"?: {"gpu": "…"}}` compares
the buffer at that frame with it. The reply's **`class`** must read `same_machine` for the buffer; under another
fingerprint the reply reads `verdict: "INCONCLUSIVE"`, `reason: "environment_changed"`, names both GPUs and carries no
`numbers`.

### A logic item's read of a published reading (mine: the form and the layout)

A `logic@1` item names a reading in its `reads` by the form **`<particles item ID>.<reading name>`**
(`"reads": ["drops.in_gate"]`). In the read region the entry is **one `i32`**, laid out as a read of an `i32` array of
one element is (entries on 8-byte boundaries, the first at `reads_at`). **Logic step k reads the value the item
published after its last step before step k's time**: with both at 60 Hz, the count after particle step k − 1, and 0 at
step 0, before any step.

### The refusal of a logic item that names the buffer (mine: what the issue holds)

`view3d` of a document whose logic item writes `"reads": ["drops.buffer"]` answers the base's refusal of a checked
document, `{"code": "refused", "issues": [Issue, …]}`, and draws nothing. One issue has `severity: "error"`, **`ids`
holding both the logic item's ID and the particles item's**, **`path: "items/<logic ID>/params/reads/0"`** and
**`actual: "drops.buffer"`**. Its `code` is the implementer's.

### Planted programs

| Name | Reached by | The wrong program | Criterion |
|---|---|---|---|
| `particles_step_by_frame_time` | `deep-gpu run --planted` | the stepped particles advance once a frame drawn, by that frame's time since the last, in place of fixed steps | `#853.fe931abe` |
| `particles_collide_at_end` | `deep-gpu run --planted` | the step tests a particle against the world's shapes only where the step ends, never along its move | `#853.22cd6328` |
| `logic_names_buffer` | a document the test writes (`helpers.ts`: `dropsDoc({namesBuffer: true})`) | a logic item whose `reads` names `drops.buffer` in place of the reading | `#853.8a18357d` |

`twins.json` maps each criterion's ID to its names.

### The taste call's files (mine)

`ac6-taste.test.ts` writes `sand-pile-5s.png`, `bounce-off-moving-floor.png`, `pour.apng` and `bounce.apng` to
`docs/evidence/853/` and reads `tests/acceptance/853/TASTE.json`: `{"issue": 853, "criterion": "#853.a7fb57f6",
"verdict": "looks_right" | "looks_wrong", "who", "when" (ISO 8601), "screenshots": {<file>: <sha256>}, "recordings":
{<file>: <sha256>}, "note"?}`. No environment variable is read by any test.

## What was read

- Issue #853 and its Oracle page; `issue-853-body.md` for the criteria's IDs.
- `docs/technical-design.md`: Particles, closed form; Cut, or deferred; GPU operator; Device gate, capture and export;
  Every task carries its own budgets; The reference Macs; Criteria in a checked shape; Wrong programs; Dogfooding.
- `docs/canvas-primitives.md`: Time and the flick (the valid-rates rule); Canvas module; Phase; Operator and read set;
  Array and table: column view; Carried state and its cache manifest; Held reading; every Particles `particles@1`
  section; World and backend, Shape, Body, Occurrence list, Physics output, Checkpoint ring, Bake and Golden; Logic
  `logic@1`, Logic: readings and Logic: checkpoints and bake; GPU operator, Operator input, Operator output, Operator
  cost and limits, Determinism class and Operator budgets by class. Neither document describes a stepped operator's
  `stepped`, `carry` or a frame's `carried`: those are read from #252's and #1993's suites and the base's code.
- At the base, for call shapes only: the suites `252/`, `1993/fields/`, `449/`, `265/`, `497/`, `501/`, `532/`,
  `537/`, `980/`, `1918/`, `1921/`, `2010/`, `2014/`, `2306/` (READMEs, helpers, tests);
  `crates/deep-gpu-layer/src/{main,view3d,view3d/parse,view3d/history,particles,physics,fed,golden}.rs`,
  `crates/deep-effects-render/src/{docops.rs,docops/stepping.rs}`, `crates/deep-canvas-effects/src/particles/rule.rs`,
  `crates/deep-canvas-scene3d/src/samples.rs`, `crates/deep-canvas-physics/src/doc.rs`,
  `crates/deep-logic/src/{piece/checks.rs,world/world_impl.rs,play.rs}`, `crates/deep-play/src/{read,logic}.rs`;
  `scripts/{proof-runs,lanes}.mjs`; `docs/parallel-proof.md` (a suite's own lane file).

## What the base already does, which these tests don't credit

At `5fcfb690` the design still says `particles@1` "can never integrate from frame to frame" and lists "GPU state
stepped between frames" as deferred, but the code is ahead of it: #252 and #1993 built stepped compute operators as
operator data. A `gpu.compute@1` item with `stepped: {rate}` steps once per fixed step; its outputs with `carry:
{every, budget}` are kept between steps, checkpointed at each multiple of a spacing that doubles when the ring passes
its budget, and restored by a seek, which then steps forward; `view3d` reports each one's `carried` row, `read`
reads its bytes, `timings` its passes' GPU time, and `golden` with `read` compares it under its class, INCONCLUSIVE
under another fingerprint. `particles@1` (#449) is closed form: nothing carried, drawn by `deep-gpu` alone.
`view3d` bakes a document's `physics.world@1` worlds over the transport's span (#1921), a kinematic body following a
channel (#1918), and runs its `logic@1` items from the call's `assets` (#537), whose arrays a driver reads (#265); a
logic item's read that names nothing the piece holds is refused by the logic module. `view3d` draws `class:
"export"` frames at the look's export samples. What it lacks, of what these tests need: the kind
`particles.stepped@1`, a shipped step with forces, collision against a world's shapes and spacing, a buffer named
`<item>.buffer`, a bake of it kept in a store and read by an export, a reading published to a logic item, and the
two planted names. The base draws a document that holds a `particles.stepped@1` item as if the item weren't there,
answers `bad_input` ("sand has no output buffer") to a `read` of its buffer, and refuses a logic item's read of
`drops.in_gate` and of `drops.buffer` alike, as `logic_refused`.

Probed on the base's binary once it was built (`BASE-FAILURE.txt` holds the probe and each test's result there): a
world document with no `backend` field and only static or kinematic boxes is baked, and the lift's floor is where
`judges.ts`'s `liftTop` puts it at every frame; the 110-byte program passes the logic module's check, and a driver
and `evaluate` read what it wrote, a step after the array it reads was written; a live frame and an export frame
have one pixel hash under `samples: {live: 1, export: 1}`, and differ under the look's default; and a stepped
operator's `carried` rows, `read`, `seeks`, `timings` and `golden` answer as `helpers.ts` reads them, its ring as
`judges.ts`'s `ringHeld` computes it.

## Run them

They build `deep-gpu` and draw on the Metal device, so they run one file at a time; `lane.json` puts the folder in
`scripts/lanes.mjs`'s `alone` list (no edit of that file is needed).

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/853 --no-file-parallelism --testTimeout=3600000
npx tsc -p tests/acceptance/853/tsconfig.json   # type-check
rm -rf tests/acceptance/853/node_modules/.vite
```

Each file builds its binary once with `cargo build --locked --bin deep-gpu` (`CARGO_INCREMENTAL=0`,
`CARGO_PROFILE_DEV_DEBUG=0`, the rustup at `/opt/homebrew/opt/rustup/bin` first on `PATH` where a Mac has it,
`CARGO_TARGET_DIR` honored),
copies it to a temporary folder and fails each test that uses it if the build failed. Each test writes into its own
temporary folder and deletes it. Every test passes a 60-minute timeout. Node built-ins and vitest only; no other
suite is imported.

- `judges.ts` holds the fixtures' numbers, every expected value derived from them, and each judge as a function with
  no test runner in it. Every test first runs `plantedSetFailures()`: each judge on a right set of numbers it must
  pass and on wrong sets it must fail, naming what its criterion names, before any binary is asked for.
- Anything the GPU runs runs on Metal: off macOS, or where a reply says `unsupported_platform`, a test fails with a
  message starting `INCONCLUSIVE:`, never passing.
- The one timed test (`ac5-budgets.test.ts`, a step's GPU time) runs only on a reference Mac (Mac15,7, Mac15,12 or
  Mac17,10, by `hw.model`; power and Low Power Mode not gated, as #252's and #1993's budgets aren't) and through the
  design's judge. On a machine whose one-minute load is over 1 a core its five runs are a reading: INCONCLUSIVE
  whatever they are, never PASS or FAIL. It reads the dev binary, as the base's GPU budgets do.
- `ac6-taste.test.ts` writes its four files to `docs/evidence/853/` and is INCONCLUSIVE until the owner's call is
  recorded in `TASTE.json`.

## The fixtures (helpers.ts, from judges.ts's numbers)

Every document is a showpiece scene at 60 frames a second, seed 853: a camera, drawn boxes where a body stands, its
worlds, and one `particles.stepped@1` item at 60 Hz, drawn as sand-coloured dots. A world's bodies are boxes on one
contact material; no world names its backend.

- **The pour** (`pourDoc`; criteria 1, 3 and 6): the item `sand`, 100,000 particles 2 cm apart, born over 2 s at
  50,000 a second in a box 0.6 × 0.1 × 0.6 m centred 1.8 m up, each leaving at 3 m/s downward, under 9.81 m/s². The
  world `pit` is a tray 0.8 m square: a static floor box whose top is y = 0 and four static wall boxes 0.2 m thick
  and 2.2 m high. Its ring: every 60 steps within 22,400,000 bytes, 8 buffers. The seeded run is the same document
  under seed 1853.
- **The lift** (`liftDoc`; criteria 2 and 6): the world `stage` is one kinematic box 2 × 0.2 × 2 m following the
  channel `lift`: its top at y = 0 until 1 s, rising 1.2 m/s to 1.2 m at 2 s, then held. The item `beads`: 1,024
  particles born at 0 s in a square 1 m across, 1 cm above it, with no spacing.
- **The corridor** (`corridorDoc`; criterion 2): the world `room` is two static walls 2 cm thick and 4 m square,
  their near faces at x = ±3 m. The item `shots`: 1,024 particles born at 0 s in a cube 1 m across at the origin,
  leaving at 24 m/s along +x, 0.4 m a step, with no gravity.
- **The drops** (`dropsDoc`; criterion 4): no world. The item `drops`: 1,024 particles born at 0 s at rest in a box
  0.5 × 1 × 0.5 m centred at (0, 2.5, 0), falling under 9.81 m/s², publishing `in_gate`, its count in the box from
  (0, 0, −1) to (1, 1.9, 1) m. The logic item `tally` runs a 110-byte program (`judges.ts`: `tallyBytes`) that
  writes the i32 it reads into its f64 array `seen`; a driver sets the x of the box `gauge` to `tally.seen`.
- **The flood** (`floodDoc`; criterion 5): the pour's shape at 1,000,000 particles 1 cm apart, born over 2 s in a
  box 1.6 × 0.2 × 1.6 m centred 1 m up, in a tray 2 m square. Its ring: every 60 steps within 56,000,000 bytes, 2
  buffers.
- **The taste call's scenes**: the pour at 5 s and the lift 7 steps after its floor stops, as screenshots; the
  pour's first 5 s and the lift from 0.5 s to 3 s, as recordings.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed, `- [ ] ` dropped
(`scripts/proof-change.mjs`: `criterionId`), computed from `issue-853-body.md`. Each `describe` and test title
starts with `AC<n> #853.<id>`.

| ID | Test file: what it asserts | What fails it |
|---|---|---|
| AC1 `#853.fe931abe` | `ac1-pour.test.ts`, 2 tests. (1) The pour at 5 s is a settled pile (all 100,000 live, none under the floor box or outside the walls, none at the emitter, 0.442 m ≤ height at the centre < 1.75 m); so is the seeded run's, with another buffer; the two heights are within 1%; the height at 5 s is within 1% of the height at 10 s; 40% to 60% are live at 1 s. The seek from step 600 to 150 reports `restored: {from: 120, steps: 30}` and step 150, the ring at step 600 holds step 120, and the sought buffer hashes as the played one, which moved since step 120. (2) The buffer at step 150 is one buffer at 60, 30 and 144 frames a second, each frame reporting step 150; then the same check under `--planted particles_step_by_frame_time` fails with "at step 150 (2.5 s), the pour played at 144 frames a second (frame 360) hashes …, at 30 frames a second (frame 75) …" | the base (no such kind); particles through the floor, left at the emitter, in one layer, not all poured; a pile still moving at 5 s; a height that hangs on the seed; a ring that drops the 2 s checkpoint or restores another; a seek that restores and doesn't step, or steps to another state; the planted module |
| AC2 `#853.22cd6328` | `ac2-collide.test.ts`, 2 tests. (1) The lift: the drawn floor is where the channel puts it at each frame; at steps 50 to 60 every particle is within 5 mm of the floor's top; at steps 61 to 150 none is more than 5 mm under the floor's top of that step; after step 120 each rises at least 0.0367 m above the stopped floor. (2) The corridor at every step 0 to 600: no particle past a wall's far face; each moves 0.4 m from step 1 to 2 and at least 80% are seen short of the near face with a step that would end past the far face; then the same check under `--planted particles_collide_at_end` fails with "particle <i> passed through the wall: at step <k> it is at x = …" | the base; a floor met a step late (20 mm under it at step 61) or never; a floor that carries particles without speed; walls met by slow particles only; the planted step |
| AC3 `#853.a87d0063` | `ac3-machines.test.ts`, 3 tests. (1) Two processes play the pour to 10 s: the buffer's hash at steps 0, 60, … 600 is the same in both and differs from step to step; each reports the same checkpoints, all among those steps, with 0, 120, … 600 among them; the first run's buffers are the pour stepping. (2) `golden` of the buffer at step 150: PASS against its own recording and FAIL against one an ulp off, class `same_machine`, on this machine; INCONCLUSIVE, `environment_changed`, naming both GPUs, no numbers, class `same_machine`, under another GPU's name. (3) A live play with `store` names its bake's key; 20 exports, each of one sampled frame, in another process, name that key, have the live frame's pixel hash and read the live frame's buffer; the live frames hold at least 5 pictures; an export from an empty store, and an export of the other seed's pour from this store, answer `no_bake` with their keys | the base; a step that differs run to run; a ring that takes other checkpoints; a comparison that runs on another machine or names another class; an export that steps a run of its own, draws another picture or reads another buffer; a pour that isn't drawn |
| AC4 `#853.8a18357d` | `ac4-readings.test.ts`, 1 test. The document whose logic item reads `drops.in_gate` is drawn; at steps 1 to 59 the value the logic item read is the buffer's count in the gate after step k − 1, and 0 at step 0; the buffer's count is 0 at step 0, every particle of the gate's columns (40% to 60% of all) at step 33, 0 at step 59, and changes between at least 20 pairs of steps. Then the planted document, whose logic item names `drops.buffer`, fails the same check: `{code: "refused", issues}` with an error issue holding `tally` and `drops` in `ids`, `path: "items/tally/params/reads/0"` and `actual: "drops.buffer"` | the base (it refuses both documents alike); a count from another step's buffer, of every particle, or none; a buffer read that is admitted, or refused without naming the buffer and both items |
| AC5 `#853.efbe6335` | `ac5-budgets.test.ts`, 2 tests. (1) The flood played 300 steps: on every frame the ring names 56,000,000 bytes, holds no more and no fewer than its checkpoints' buffers; it holds a checkpoint at step 300 and took more than 2 over the play; the buffer at step 300 is a settled bed (all 1,000,000 live, inside the tray, at least 0.088 m high at the centre). (2) On a reference Mac, six runs of 300 steps with `timings`, the first a warm-up: each run's 95th-percentile step GPU ms, judged against 4 ms | the base; a ring past its budget, or one that never checkpoints; a flood without collision or spacing; a step over 4 ms on an unloaded reference Mac |
| AC6 `#853.a7fb57f6` | `ac6-taste.test.ts`, 1 test: each screenshot's frame reports its buffer at the step named, each recording holds its frames and more than one picture; the four files are written; INCONCLUSIVE until the owner's call is recorded on exactly them | the base; a recorded `looks_wrong` |

## Readings where the issue and design leave a choice

- **One binary.** Stepped GPU state, its `carried` rows, `read`, `seeks`, `timings` and `golden` are
  `deep-gpu`'s at the base, particles are drawn only there, and its `view3d` already bakes worlds and runs logic
  items; so every criterion is read through it, and no second way of reading a state, a refusal or a frame is added.
  "Refused at check" is the check `view3d` makes before it draws, answered as it answers any refused document.
- **"Matches a seeded run's within 1%."** Three readings were weighed. A second run under the same seed is bit for
  bit the first on one machine (criterion 3 holds that by hash), so a 1% bound on it could fail nothing. A reference
  the test integrates itself would fix the solver, which neither the issue nor the design does. The reading taken:
  the same pour under another seed, other grains of the same sand, whose pile is as high within 1%. A wrong program
  can fail it (a height that hangs on where grains happen to fall), and each run is held on its own to what the
  fixture's numbers give: 100,000 spheres 2 cm across fill a 0.64 m² tray to 0.884 m at their densest (spacing³ ÷ √2
  each), so the pile is at least half that, which particles that never push each other apart (one layer), that pass
  through the floor (no pile) or that never leave the emitter (not under 1.75 m) all fail.
- **"A box floor"** is a static box of the document's world, its top at y = 0, standing in a tray of four static wall
  boxes. The issue names no friction, so sand on an open floor could spread without end; walls give any right program
  a pile that settles.
- **"Height at the centre"** is the mean, over the 25 cells (2 spacings square) of the square of 10 spacings around
  the tray's axis, of each cell's highest live particle above the floor's top, so one grain doesn't decide it.
  **"Settle"**: the height at 5 s is within 1% of the height at 10 s. **"Poured"**: 40% to 60% are live half way.
- **"The checkpoint at 2 s."** With checkpoints every 60 steps the design's default budget (16 MiB, 5 of the pour's
  2,800,000-byte buffers) leaves 0, 240 and 480 at step 600, with none at 2 s; the fixture declares 8 buffers, under
  which the ring doubles once and holds 0, 120, … 600 (`judges.ts`: `POUR.budget`, `ringHeld`). "Restores the
  checkpoint at 2 s and steps forward" is the sought frame's `restored: {from: 120, steps: 30}`.
- **"Integrates by frame time … differs between 30 and 144 frames a second … naming the step"**: the buffer at one
  step, 150 (2.5 s, a frame at 30, 60 and 144 frames a second), read from a play at each rate. The check is that the
  three are one buffer; the failure starts "at step 150".
- **"At the step it moves."** Weighed: the particles meet the floor where the step's own time puts it, or where the
  step before left it. The first is taken: a floor a step late is the wrong program this clause can fail, by the
  floor's 20 mm a step. **"Bounce off"** names no restitution, so it is read as leaving the floor with at least its
  speed: once the floor stops, each particle rises at least half of 1.2² ÷ (2 × 9.81) m above it. The particles start
  at rest on the floor, so the step a particle first meets the moving floor is the step the floor first moves.
- **"None passes through a static wall"** is: at no step is a particle past the wall's far face. A particle inside
  the wall's 2 cm isn't judged. "Fast particles" move 20 wall thicknesses a step.
- **"Every checkpoint"** is every step a checkpoint can fall on, the multiples of `every` up to 10 s, since a
  checkpoint the ring later drops was one too; the runs must also report the ring's own checkpoints.
- **"A second machine … naming the class"**: none is configured, so golden's `environment` stands in for one, as
  #380's and #252's suites do; the comparison is a golden of the buffer, and the class is the reply's `class`.
- **"An export of the pour"** is `view3d` with `class: "export"`, the base's export frames for a 3D document.
  **"Reads the bake by hash"** was weighed two ways, the bake named by a key and each frame's buffer named by its
  content hash, and both are held: the recording and the export name one 64-hex key, and at each sampled frame the
  export's `read` gives the SHA-256 the live frame's gave. That it "never steps live" is read as #2010's `play`:
  with no bake under the document's key the export answers `no_bake` and draws nothing. **"20 sampled times"** are
  every half second to 10 s. The live play and the export draw one sample a pixel (the look's default is 1 live and
  16 in an export), so one buffer gives one picture.
- **"The reading the module published after the step."** Weighed: the count after the particle step at the logic
  step's own time, or after the last one before it. The design orders logic first at one time ("logic reads physics
  only from earlier steps"; a world's reading reaches a logic item as "the last value the world's steps before this
  step's time recorded", #182), so the second is taken, and a count from any other step's buffer fails. The entry is
  one i32, as #182's world readings and an i32 array of one element are.
- **"Names the buffer."** At the base a read that names nothing is refused by the logic module, in its own shape,
  whatever it names. Here the refusal must be a check issue that says what was named and whose it is: `actual` the
  buffer's name, `ids` the logic item and the particles item, `path` the read.
- **"Under 4 ms of GPU at 60 Hz"** is judged as #1993's step budget: a run's value is the 95th percentile of its 300
  steps' GPU time at one step a frame; five runs after a warm-up. A loaded machine reads INCONCLUSIVE whatever the
  runs are, which is stricter than the base's judge, by this job's brief.
- **"The checkpoint ring stays inside its byte budget"** is read off every frame's row, with a budget small enough
  (2 buffers for 6 checkpoints due) that staying inside takes thinning.
- **The buffer's layout** is the Scope's list in its order, 7 f32 words a particle with no attributes; a live
  particle's age is 0 or more. The tests read positions and the sign of the age, and velocities not at all.

## What isn't asserted

No criterion reaches these, so no test reads them: drag, curl noise from the closed form's tables and attractors;
declared planes; births and deaths from occurrence lists; attributes; a count past 1,048,576 or past a class's cap
being refused; a step rate that isn't valid under the valid-rates rule being refused; a centroid reading, or physics
reading particles; a check, other than the export, reading the bake, and a bake read on another machine; what a
bake's key hashes and how a store lays it out; the cache manifest and a restart; a seek spread across live frames
with a stale frame shown; an export's `carried` rows; restitution and friction; the look of the particles; the
frame budget; `deep-show`'s check of the kind; and the Scope's "not in this task" (fluids with pressure solves,
cloth, particles in the net module's matches). That the pictures are attached to the PR and shown in the session
is not something a test can see: the files are kept and listed.

## What the implementer adds outside this folder

- Nothing in `scripts/lanes.mjs`: `lane.json` puts the folder in `alone`.
- `docs/evidence/853/`: the four files `ac6-taste.test.ts` writes, attached to the PR.
- `tests/acceptance/853/TASTE.json` is the one file added to this folder later, and only to record the owner's call.
- The design's lines the issue reopens (Particles, closed form; Particles `particles@1`; GPU operator; Cut, or
  deferred) are the implementer's to bring in line with what is built.

## Upstream tests (the Oracle lane)

None: the Oracle page lists no upstream test for any of the six criteria.
