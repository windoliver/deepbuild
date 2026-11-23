# Acceptance tests for #2035: jumps draw as cuts

Issue #2035: "a placed body and a marked logic write are never drawn between the old place and the new".

Written first and blind, from:

- issue #2035 as of November 21, 2026: its Scope, five acceptance criteria, Proof line, Oracle line and Depends on line;
- the design sections it links;
- base commit `5f5791e2d` ("Merge pull request #3068 …").

The job never saw an implementation. None existed, and no other worktree, branch or pull request was read. The
implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job (design:
Dogfooding). The suite is lean: one test per criterion clause that needs its own run, plus one test for each planted
wrong program the criteria name.

## What was read

- **The issue**, live: `gh issue view 2035 --repo windoliver/deepbuild --comments` (no comments). Its Oracle line says
  no upstream test checks these criteria.
- **`node scripts/design-section.mjs --issue 2035`**:
  - `docs/canvas-primitives.md`: Physics output (it already says a `place` on a character or vehicle body holds every
    output at the new pose from that step), Input track entries, Logic: interpolated writes (`cut: <write name>`).
  - `docs/technical-design.md`: The physics module.
- **Also in the design**:
  - `docs/technical-design.md`: Dogfooding, Tests written first.
  - `docs/canvas-primitives.md`: Logic: checkpoints and bake; Body `body@1`: character; Body `body@1`: vehicle.
  - AGENTS.md.
- **The base, read only for the surfaces these tests drive**:
  - `crates/deep-physics-rapier`: `main.rs`, `planted.rs`, `runner.rs` (`bake`, `restore`, `take`, `record`),
    `runner/timeline.rs` (`seek`), `runner/vehicle.rs`, `runner/centre.rs` (a body's `pose` output into
    `outputs.series`), `runner/live.rs`, `inputs.rs` and `character.rs` (`place`), `channels.rs`.
  - `crates/deep-canvas-physics`: `bake.rs` (`outputs`, `wheel_series`: lerp and nlerp between the two steps around a
    frame), `doc/reads.rs`, `doc/inputs.rs`.
  - `crates/deep-logic`: `main.rs`, `planted.rs`, `lib.rs` (`bake`, `frames`, `view`, `frame`), `live.rs`,
    `world.rs` (`drawn`), `world/world_impl.rs` (checkpoints, `nearest`, `seek`), `piece.rs` (`Ty`), `piece/checks.rs`
    (a write's fields).
  - The suites `182/`, `251/`, `1918/`, `522/`, `523/`, `545/`, `545-redraft-ac3/` and `545-redraft-ac5/`: READMEs,
    helpers, `twins.json`, `BASE-FAILURE.txt`, and `182/ac14-place`, `251/ac9-place` and `545-redraft-ac5`'s test.
  - `scripts/proof-change.mjs` (criterion IDs) and `scripts/proof-runs.mjs` (`twins.json`).

**What the base already does, which these tests don't credit:**

- `deep-physics` takes a `place {pose: {pos, rot}}` on a character body and on a vehicle body.
- A bake at a `frame_rate` samples a body's `pose` output, and a wheel's `<body>#<wheel>` `pose` output, into
  `outputs.series` as `{pos, rot}`. Positions lerp and rotations nlerp between the two steps around each frame,
  across a place too, so the frame half way across a 40 m place draws 20 m.
- `seek` restores the ring's checkpoint at or before a step and answers states and step hashes, but no drawn output.
- `deep-logic`'s views draw a linear write one step late, blending across every change. They admit a write's `cut`
  field and ignore it.
- Neither binary knows any of this suite's planted names. Each answers `{"ok":false,"code":"bad_input"}` with exit 2.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs build --wait 300 -- sh scripts/lease nice -n 10 \
  npx vitest run --root tests/acceptance/2035 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/2035/tsconfig.json          # type-check
rm -rf tests/acceptance/2035/node_modules               # vitest's cache
```

Each file builds what it drives once, before its tests, and copies the binary out of the target folder. The builds
honor `CARGO_TARGET_DIR`, use `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set, and put Homebrew's
rustup on PATH when present.

| Files | Builds |
|---|---|
| `ac1`, `ac2`, `ac3`, `ac5` | `cargo build --locked --bin deep-physics` (#2009's helper, through `../251/helpers.ts`) |
| `ac4`, `ac5` | `cargo build --locked --bin deep-logic`, and #545's assembler `tests/acceptance/545/wat` into `target/acceptance-545-wat` (`../545/helpers.ts`) |

Imported read only:

- `../251/helpers.ts`, and through it `../522`, `../1918`, `../2010` and `../2009`: the runner, the kart and its
  world, `place`, scratch folders.
- `../182/helpers.ts`: the character world builders, which are pure functions.
- `../545/helpers.ts` and `../545/programs.ts`: the assembler, the layout probe, `deep-logic` one-shot and live, views
  and frames, `check`, the `logic_refused` reader.

Rules the run keeps:

- Node built-ins and vitest only.
- Every test passes a 90-minute timeout.
- No process is started but `cargo`, `deep-physics`, `deep-logic` and the assembler. Each is waited for or stopped
  by its own PID, never by name or port.
- No GPU, window or network call. No reading depends on load, so nothing here is INCONCLUSIVE.
- The issue's "Runs on" line says every criterion reads drawn poses from evaluated state and no pixel, and these tests
  do exactly that.

The folder runs alone through its own `lane.json` (#1327's lane file): its files build cargo binaries and drive a
long-lived `deep-logic`.

`BASE-FAILURE.txt` is the run at the base: each test's failing assertion.

## The surface under test

The issue names a `place`, physics outputs drawn at a frame rate, a vehicle's chassis and wheel items, a linear logic
write's `cut`, frames, seeks and planted programs, but no call. These tests drive `deep-physics` and `deep-logic` as
#2009, #2010, #1918, #522, #182, #251, #545 and #531/#532 left them; their READMEs' surfaces stand as written. Anything
marked **(ours)** below is this job's invention: the smallest surface the criteria need, named as the issue and the
design name things. The implementer builds exactly these, or a dispute goes to a blind redraft.

### `deep-physics`

**Worlds.** Each world is `physics.world@1` as the base reads it, at `step_rate: 60`, with `checkpoint: {every: 60}`.
Outputs are written as Physics output writes them:

- The character: `{"from": "hero", "read": "pose", "to": "items/hero_figure/at"}`.
- The kart's chassis: `{"from": "kart", "read": "pose", "to": "items/kart_body/at"}`.
- Each wheel: `{"from": "kart#<fl|fr|rl|rr>", "read": "pose", "to": "items/kart_<name>/at"}`.

The `to` items are the "items" the criteria name. No scene draws them here. The criteria read drawn poses from
evaluated state, so the tests read the output's samples.

**Track.** `[{"step": 120, "kind": "place", "target": <body>, "data": {"pose": {"pos", "rot"}}}]`, the base's entry.
An entry stamped k applies at the start of step k, in the step from state k to state k + 1 (#522's convention).
`rot` is degrees about X, Y and Z, as the base reads three numbers.

**`bake`.** The base's call, with `frame_rate: "120/1"`, `steps: 180` and `read: []`. Its `outputs.series.<output
ID>[j]` is the output's drawn sample at frame j, t = j ÷ 120 s: `{pos: [x, y, z], rot: [x, y, z, w]}`, or the same
seven numbers. This is what the base writes for a body's and a wheel's `pose` (#2240, #251). The cut changes what a
frame draws, not the layout.

**`seek` to a frame (ours: `frame`).**

```json
{"call": "seek", "world": ..., "track": ..., "steps": 180, "store": "<dir>", "frame_rate": "120/1", "frame": 241, "read": []}
```

- It seeks the bake stored under the same key (the base's key, which holds the frame rate) to frame 241 at that rate.
- It restores the ring's checkpoint at or before what that frame needs, steps on, and never re-bakes.
- `to` and `play` are not given.
- Its reply is the base's `{ok, key, from, …}`, with `from` the checkpoint's step, plus **(ours)** `"outputs":
  {"<output ID>": sample}`. Each sample is laid out as the bake's `outputs.series.<output ID>[241]`.

The test reads `from`, which must be a restored checkpoint (over 0), and `outputs.hero_pose`.

### `deep-logic`

**Writes (the design's field).** A linear write may name `"cut": "<write name>"`. The ship's piece:

```json
{"writes": {"pos": {"type": "vec3", "interpolate": "linear", "cut": "wrapped"}, "wrapped": {"type": "bool"}, "speed": {"type": "f64"}},
 "step_rate": 60, "checkpoint": {"every": 67}}
```

The piece is #545's form: `{seed, items: {ship: {kind: "logic@1", params}}, assets}`.

**`check`.** #545's call. A `cut` naming `speed`, an f64 write, is refused as #545's refusals are: `{"ok": false,
"code": "logic_refused", "item": "ship", "refusals": [{"rule", "what", "write"}]}`. A refusal's `write` must be `pos`
(whose cut it is) or `speed` (the write it names); the issue's "naming the write" doesn't say which. The same piece
with `cut: "wrapped"` is admitted (`ok: true`).

**Views and frames.** #545's `view` (`span: 4`) and `frame`, with `play: 1/120` and `seek: <seconds>`. The tests read
each landed frame's `t` and `draws["ship.pos"]` (one vec3 element, a bake's layout).

### Planted twins

Each is the binary the criterion drives, started with `--planted <name>` **(ours: every name)**. Each changes nothing
but what its row says. The judgement that passes the real program must fail on it, naming what the criterion says it
names. `twins.json` maps each criterion's ID to its twins.

| Name | Binary | Criterion | The wrong program |
|---|---|---|---|
| `place_blends` | `deep-physics` | 1 | every output blends across a place as across any step, position and rotation (the base's drawing): the frame half way across draws 20 m |
| `place_blends_rotation` | `deep-physics` | 2 | across a place every output holds its position as the right program does, but nlerps its rotation: that frame draws 45° |
| `place_blends_wheels` | `deep-physics` | 3 | across a place a vehicle's chassis output holds as the right program does, but its wheels' outputs blend: a wheel is drawn 20 m from the chassis |
| `restore_forgets_place` | `deep-physics` | 5 | a seek's restore keeps no cut: the frames it draws after restoring a checkpoint and stepping on blend across a place as though none had been applied, while a bake (playing) draws the cut |
| `cut_ignored` | `deep-logic` | 4 | drawing a linear write ignores its `cut`: it blends across a wrap as across any change, 9.95 m half way from step 200 to 201 |
| `restore_forgets_cut` | `deep-logic` | 5 | a checkpoint's restore brings back no element's cut (as though every element's cut were false on the step it restored to), so a seek draws the blend there while playing draws the cut |

## The fixtures

**The character** (criteria 1, 2, 5):

- #182's capsule (radius 0.3 m, half height 0.6 m), at rest at x = 40 m, standing on a static floor from x −10 m to
  50 m whose top is y = 0. The world is 60 Hz, 4 substeps, g = 9.81 m/s².
- At step 120 a `place` puts it at x = 0 m on the same floor, at the same height, turned 90° about +Y (`rot: [0, 90,
  0]`).
- It is baked 180 steps, drawn at 120/1.

**The kart** (criterion 3):

- #251's kart (1,000 kg, four wheels on 2 Hz springs), set down settled at the origin with `sleep: false`, in a 60 Hz
  world on level ground.
- At step 120 a `place` puts it 40 m along +x at the same settled height, unturned (`rot: [0, 0, 0]`).
- It is baked 180 steps, drawn at 120/1.

**The ship** (criteria 4, 5): one 60 Hz logic item, assembled by #545's assembler against the layout `check` reports.

- Step k writes `pos` = [(k mod 200) ÷ 10, 0, 0], so it moves 0.1 m a step.
- It writes `wrapped` = (k > 0 and k mod 200 = 0), so at step 200 it wraps from 19.9 m to 0 m with its cut true.
- It writes `speed` = 6, an f64 write that only the refusal names.
- `checkpoint.every` 67 puts a checkpoint at 201, the state step 200 left (#531's labels: a checkpoint is named by the
  step about to run). A seek to the frame after the wrap restores that one, so the cut must be in it.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed. Each `describe` and `it` title starts with its criterion's ID.

| ID | File | Test | What fails it |
|---|---|---|---|
| 1 `#2035.577758f2` | `ac1-place-position` | cut | a frame from 1.9 s to 2.2 s (frames 228 to 264) whose drawn x is neither 40 m nor 0 m within 1e-6 m; frames other than 40 m then 0 m with exactly one change |
| | | twin: place_blends | it drawing x = 20 m (1e-6 m) on other than exactly one frame; no failure naming `item hero_figure` and that frame |
| 2 `#2035.9b03a44c` | `ac2-place-heading` | cut | a frame from 1.9 s to 2.2 s drawing a heading strictly between 1° and 89°; not 0° (within 1°) at 1.9 s or not 90° (within 1°) at 2.2 s |
| | | twin: place_blends_rotation | it failing criterion 1's position judgement (it holds position); a 45° (±0.5°) heading on other than exactly one frame; no failure naming `item hero_figure` |
| 3 `#2035.e60b6f6d` | `ac3-vehicle-place` | cut | at a frame from 1.9 s to 2.2 s, the chassis or a wheel drawn more than 0.25 m from where it is drawn at the step at or before the frame and at the step after |
| | | twin: place_blends_wheels | a failure naming the chassis (it holds it); no frame drawing a wheel 20 m (±0.5 m) from its place on the chassis drawn there; no failure naming that wheel |
| 4 `#2035.4a4b7836` | `ac4-logic-cut` | cut | a frame that draws steps 190 to 210 (frames 382 to 422) drawing x strictly between 1 m and 19 m |
| | | twin: cut_ignored | it drawing 9.95 m (1e-6 m) on other than exactly one of those frames; no failure naming that frame |
| | | refusal | the bool cut not admitted; the f64 cut not refused `logic_refused` for `ship` with a refusal whose write is `pos` or `speed` |
| 5 `#2035.65049ccc` | `ac5-seek` | place | playing (the bake) drawing a blend at frame 241; the seek not answering, restoring no checkpoint, or drawing `hero_pose` other than playing's frame 241 bit for bit |
| | | wrap | playing drawing x strictly between 1 m and 19 m at frame 401; the seek back to frame 401 drawing `ship.pos` other than playing's frame 401 bit for bit |
| | | twin: restore_forgets_place | no failure naming frame 241 and the seek's draw |
| | | twin: restore_forgets_cut | no failure naming frame 401 and the seek's draw |

Test count: 2 + 2 + 2 + 3 + 4 = 13.

## Readings where the issue leaves a choice

- **"At step 120"** is a track entry stamped 120: it applies at the start of step 120, so the state after step 120
  (t = 2.0167 s) is the placed one.
- **The frame between steps 120 and 121** (frame 241, t = 2.00833 s). The design leaves open whether it shows the old
  pose or the new; the tests don't ask. Criterion 1 asks that each frame be one of the two poses, changing once
  (first 40 m, last 0 m). Criterion 3 asks that each part be at the pose of one of the two steps around the frame.
  Criterion 5 compares a seek with playing, whichever they show.
- **"The item"** is the item the output draws on, by its `to` (`hero_figure`, `kart_<wheel>`). Each failure also
  names the output and the body.
- **The heading** is the turn of the drawn rotation's +Z about +Y, by its absolute value: 0° before the place, 90°
  after. "Between 1° and 89°" is strict. Criterion 2 also asks that the place turned the body (0° at 1.9 s, 90° at
  2.2 s, each within 1°), or a program that ignores `rot` would pass.
- **The vehicle.** The issue gives no tolerance, rate or window, so:
  - it runs at criterion 1's 60 Hz, 120 frames a second, 1.9 s to 2.2 s;
  - "at the old pose or the new one" is the part's drawn position within 0.25 m of where that part is drawn at the
    step at or before the frame or at the step after (frames 2k and 2k + 2);
  - 0.25 m leaves room for a parked kart's own motion between two steps (a wheel's hub moves a few centimetres when a
    place sets its spring back to rest) and is 80 times smaller than the 20 m a blend draws;
  - positions only: the place doesn't turn the kart.
- **"A wheel 20 m from the chassis"** is the wheel drawn 20 m (±0.5 m) from its place on the chassis drawn at that
  frame: from its own pose at the step whose chassis pose is nearer the drawn chassis.
- **"Drawn … from step 190 to step 210"** (criterion 4). A linear write draws one step late: at t(k) it shows step
  k − 1's value (Logic: interpolated writes). So the frames that draw steps 190 to 210 are t(191) to t(211), frames
  382 to 422. Read as frames at t(190) to t(210), the band would fail every right program: the frame at t(190) shows
  step 189's 18.9 m. The issue's band [1 m, 19 m] is exactly steps 210's and 190's values, 1.0 m and 19.0 m, which
  the program writes exactly (k ÷ 10).
- **"Naming the write"** (criterion 4's refusal): `pos`, whose `cut` it is, or `speed`, the f64 write it names.
- **"The first frame after the place / the wrap"** is the first frame strictly after the step's time where a blend
  would show: frame 241 and frame 401. That is where the twins draw 20 m, 45° and 9.95 m.
- **"Seeking."**
  - Physics: `seek` to frame 241 of the stored bake. "Playing" is the bake's own frame 241, a run from step 0.
  - Logic: a view played forward by `play: 1/120` past frame 401 to frame 422, then sought back to frame 401, which
    restores the checkpoint at 201. The view's ring holds it only after play has passed it, as #545-redraft-ac5 found.
  - "Bit for bit on one build and architecture": the drawn numbers compared with `Object.is` on this Mac, in one
    process per binary.
  - Criterion 5 also asks that playing draws no blend at that frame. Equality alone would pass the base, which blends
    both ways.
- **Physics twin for criterion 5.** On the base's convention a seek to frame 241 restores a checkpoint at or before
  step 120 and steps through the place, so a checkpoint itself never holds the place. The planted "restore that
  forgets the cut" is therefore the seek's restored run keeping no cut, which is how the twin's row reads.

## Not tested, because no criterion reaches it here

- A check that finds unmarked jumps; trails and other readers of earlier poses at a cut; effects at a cut (all out of
  scope in the issue).
- A `cut` whose bool write has another count, or names a missing write.
- `place` on other body kinds.
- A launch with `from` (it already holds).
- A cut on vec2, f64 or quat writes.
- `alive`, `gen` and `live` cuts.
- The physics seek of the vehicle.
- deep-show's or deep-gpu's drawn channels and pixels.
- Another architecture.

## What the implementer adds

In `deep-physics`:

- cuts at a `place` in drawn outputs;
- `seek`'s `frame` and `outputs`;
- the four physics planted names.

In `deep-logic`:

- `cut` on linear writes, honored in draws and checkpoints and refused at check;
- the two logic planted names.

Nothing in this folder changes.
