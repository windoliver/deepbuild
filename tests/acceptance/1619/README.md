# Acceptance tests for #1619: the screen finish gains a convergence angle, tracking and roll, seeded from the frame, for analog and early-console looks

Written first, from issue #1619 (its three scope lines, its four acceptance criteria, its proof line "The line fixture,
the seek comparison with its planted twin, and the identity frame" and its line "Runs on: the reference Mac (finish
pass); Spark for the seek test"), its oracle page (`doneright/oracles/issues/1619.md` in `DeepBuildAI/deepbuild`,
branch `doneright`), the design sections it links and those they lean on, and base commit `16dc5eab` ("Merge pull
request #2771 …"), by a job that never saw an implementation; none existed. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one file per
criterion, one test per clause that needs its own run, plus exactly the two planted twins the criteria name.

## What was read

- Issue #1619, live (`gh issue view 1619 --repo windoliver/deepbuild`), and its oracle page: no upstream test for any
  of the four criteria, so every expected value here is the issue's own. The titles and bodies of #150, its epic, and
  #464, which it depends on.
- `docs/canvas-primitives.md`: Look `look@1` (the `finish` line); Look `look@1`: print finishes (the `screen` row;
  "Every value is drawn from hash(the frame index at its rate, the document seed), so seeking equals playing"; "Status
  colors draw after the finish"; "It can never: Read an earlier frame"); Look `look@1`: indexed basis; Determinism
  class (a same-machine result, a golden under another fingerprint); the line that leaves chromatic aberration out
  until a look needs it.
- `docs/technical-design.md`: Look; Dogfooding; Tests written first, by a job that never sees the code.
- `docs/parallel-proof.md`: section 3 (what runs on the Mac and what on the Spark, which runs neither macOS nor
  Metal), section 8 (remote lanes, merged per test) and section 10 (`Runs on:` names the machines a step's proof
  needs).
- At the base, for the house format and call shapes only: AGENTS.md; `tests/acceptance/464/` (README, helpers, the
  look fixture, the screen, identity, wear, vignette-grain and tables tests, BASE-FAILURE.txt), `1646/` (README,
  helpers, tsconfig, BASE-FAILURE.txt) and `1640/` (README, helpers, BASE-FAILURE.txt: a suite whose issue names the
  Spark for part of its proof, run there on the noop backend); the top of `375/helpers.ts` (how a redrafted suite
  reads `DEEP_BIN_DIR`; not followed, 464's and 1646's build is); `crates/deep-gpu-layer/src/{main,film,print2d,
  marks2d}.rs` (the call table, `--planted` and `--backend noop`, `film2d`, `refused`, where a printed frame is
  drawn), `view3d.rs` (its noop branch) and `frames.rs` (`hex`), `crates/deep-canvas-marks/src/print.rs` (how a
  look's finish is read and checked, `screen`, `frame`, `indexed`), `crates/deep-scene3d-render/src/print.rs` and
  `print.wgsl` (the finish pass and its uniforms), `crates/deep-show/src/print.rs` (render-back's use of the pass),
  `crates/deep-canvas/src/document/check.rs` (`duration`: a time literal), `scripts/proof-change.mjs`
  (`criterionId`), `scripts/lanes.mjs` (the `alone` list) and `scripts/throttle.mjs` (its use).

## What the base already does, which these tests don't credit

- `film2d` (#417, #149, #464) plays a 2D film under a look@1 with `fps`, `from`, `frames`, `hash` (each frame's
  `pixel_hash`, the SHA-256 of its surface's bytes) and `capture` (each listed frame's `final` PNG). It also runs
  under `deep-gpu run --backend noop`, where it answers each frame's `frame`, `gpu_ms`, `cpu_ms` and `fills` and
  draws no pixel; with `hash` every frame there has one and the same `pixel_hash`, of no pixels (probed once at the
  base), so the noop backend says nothing of a frame's finish.
- #464's screen reads `kind`, `scanlines`, `mask`, `curvature`, `convergence`, `bleed`, `noise` and `rate` (and
  #1646's `afterglow`). `convergence` is horizontal: `print.wgsl` samples red at +convergence px along x and blue at
  −convergence, so red draws that far left and blue that far right. A screen ignores a field it doesn't know, so at
  the base `convergence_angle`, `tracking` and `roll` change nothing, on any basis: an indexed look under a screen
  with `convergence: 2, convergence_angle: 90` draws its frame.
- So two tests pass at the base (`BASE-FAILURE.txt`), and are here because the criterion names them: `line.test.ts`'s
  peaks at `convergence_angle: 0` and its comparison with the merge base's frame. The criterion's first half holds
  the new pass to what #464 already draws, so both must pass before and after; they fail on a pass whose angle 0 or
  whose default angle moves a pixel of the base's frame. `identity.test.ts`'s equalities hold at the base too; the
  test fails there on its guard, since a tracking band and a roll change no frame.
- Nothing of #1619's exists: no `convergence_angle`, `tracking` or `roll`, no refusal on an indexed basis, no
  `finish_hash` on a frame, and neither planted name, which `deep-gpu run --planted` refuses at startup
  (`{"ok": false, "code": "bad_input"}`, exit 2).

## Run them

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/1619 --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/1619/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Each file builds `deep-gpu` once, with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked --bin
deep-gpu`, adding the pinned toolchain (`~/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin`) to PATH when cargo
isn't on it, copies the binary out of the target folder (`CARGO_TARGET_DIR` honoured) to a temporary folder, and fails
each test that uses a build that failed. So the files run one at a time: `scripts/lanes.mjs` needs
`'tests/acceptance/1619/'` in its `alone` list beside `'tests/acceptance/464/'` and `'tests/acceptance/1646/'`. This
README is the instruction; the implementer makes that edit. Each test writes into its own temporary folder and deletes
it; Node built-ins and vitest only. A run with `--root tests/acceptance/1619` leaves Vitest's cache in
`tests/acceptance/1619/node_modules/.vite`; delete it.

**How the `Runs on:` line is served** ("the reference Mac (finish pass); Spark for the seek test"):

- **The finish pass, on the Mac.** Every test that reads a pixel draws on Metal: all of `line.test.ts`,
  `identity.test.ts` and `indexed.test.ts`, and `seek.test.ts`'s two "on Metal" tests. Off macOS each fails with a
  message starting `INCONCLUSIVE:`, never passing and never skipped.
- **The seek test, on the Spark.** The Spark runs neither macOS nor Metal (parallel proof, section 3), so
  `seek.test.ts` runs the seek comparison and its planted twin a second time on the noop backend, which draws no
  pixel and needs no GPU, as #1640's suite serves its own Spark half: its two "on the noop backend" tests compare
  what the finish pass is given for a frame (`finish_hash`, below) and run on any machine `deep-gpu` builds on. On
  the Spark: `npx vitest run --root tests/acceptance/1619 --no-file-parallelism seek.test.ts -t "noop backend"`. A
  whole-suite run there reads those two tests on their own and the rest INCONCLUSIVE, to be merged per test with the
  Mac's run as remote lanes merge (parallel proof, section 8). This job ran them on the Mac only, at the base.
- **The merge base's frame** is compared only on a GPU of the family that drew it (below); on another Mac that one
  test fails as `INCONCLUSIVE:`, naming both GPUs.
- No criterion has a time budget, so nothing is gated on a budget window, power or load.

## The surface under test

**No new binary and no new call.** #377's `deep-gpu run [--backend noop] [--planted <name>]` with its JSON-lines
protocol unchanged, and #417's, #149's and #464's `film2d` for every frame. Field names the issue and design give are
used as they give them; the rest are this suite's choices, marked **bold**, each the least a criterion needs. The
implementer provides each as spelled.

### The look's screen (`look@1`, passed inline as `look`)

`finish: [{screen: {kind, …}}]` as #464 has it: a one-key object, a field left out at its default. Fields added:

- `convergence_angle: deg = 0`, **a bare number of degrees**: `convergence`'s two offsets lie along the angle, green
  in place. At 0 that is #464's pass: red sampled at +convergence px along x, blue at −convergence. At 90 the two
  offsets lie along y. Which of red and blue goes up at 90, the angle's sense, is the implementer's; no test fixes it.
- `tracking: {band: px, rate: Hz, shift: px, seed}` or **`"none"`, the string, its default**: **`band` and `shift`
  bare numbers of px, `rate` a bare number of Hz, `seed` a whole number**, as the separations' `offset: {jitter, hz,
  seed}` is read at the base.
- `roll: {period: s, amount: 0..1}` or **`"none"`, the string, its default**: **`period` a time literal, `"1s"`**, as
  the look's `time.state.span` and #1646's `afterglow` are written; `amount` a bare number.
- With `convergence: 0`, `tracking: "none"` and `roll: "none"` (and #464's other screen fields left out) the screen is
  at its identity, whatever `convergence_angle` says.
- A look on an indexed basis (`basis: {indexed: {…}}`, #464) whose screen names `convergence_angle` is refused at
  check: `film2d` answers a refusal with a `code` (a string, the implementer's choice) and no `frames`, and **its
  `reason` is the field's path in the look, `look/finish/<i>/screen/convergence_angle`** (`<i>` the screen's place in
  `finish`), as the base's print refusals carry the path of what they refuse.

### `film2d` (#417, #149, #464): one field added to a frame's row

```json
{"call": "film2d", "doc", "look", "fps"?, "from"?, "frames", "hash"?: true, "capture"?: [n]}
→ {"size", "frames": [{"frame", "pixel_hash"?, "final"?, "finish_hash"?, …}], …}
```

- **`finish_hash`** on each frame's row whose look's finish pass runs (#464's one print pass, `look.print`; not the
  identity): **the SHA-256, 64 hex digits, of the bytes the finish pass is given for that frame beside the frame's
  own pixels**: its uniforms, and any other buffer it reads, which between them hold every value the pass draws the
  frame from (the frame indices at their rates, the document seed, the screen's fields, and whatever the tracking
  band and the roll are drawn from). **It is answered on the noop backend**, where it is all a frame says of its
  finish and where the tests read it; a row drawn on Metal may carry it too. Two frames with one `finish_hash` are
  given the same bytes.
- `film2d` under `deep-gpu run --backend noop` as at the base: one row per frame, no pixel drawn; the tests ask it
  for neither `hash` nor `capture`.
- `from: n` opens the film cold at frame n (#417), which is this suite's seek.

### Planted programs

| Name | Where it is reached | The wrong program | Criterion |
|---|---|---|---|
| **`convergence_angle_ignored`** | `deep-gpu run --planted`, on Metal | The finish pass draws `convergence`'s offsets along x whatever `convergence_angle` says, as the merge base's pass does: at 90° red and blue stay in green's row and slide 2 px along it | `#1619.a63cb7a9` |
| **`tracking_wall_time`** | `deep-gpu run --planted`, on Metal and on `--backend noop` | The tracking band is drawn from the wall clock instead of hash(the frame index at its rate, the document seed), so one frame's band, and with it its `finish_hash` and its pixels, changes from one draw to the next | `#1619.94959aa8` |

Each is reachable only through `--planted`, as #464's six are.

### The documents

2D figures as #464's: one writer layer `main` (writer `agent-a`), `rect@1` items keyed by ID, `seed: 1619`, no
channels, so every film is still and only the finish moves.

- **The line fixture** (`helpers.ts`: `VERTICAL`, `HORIZONTAL`): 320 × 180, a black rect over the whole frame and one
  white rect 1 px wide and 120 px long: column 160, rows 30 to 149; or row 90, columns 100 to 219.
- **The tape fixture** (`STAIRS`): 320 × 180 on the look's white ground, ten 32 × 18 blocks stepping down the diagonal
  in two colors, so every row holds an edge a band's shift moves and every column one a roll moves. Played 48 frames
  at 24 fps under `tracking: {band: 12, rate: 12, shift: 6, seed: 7}` and `roll: {period: "1s", amount: 0.25}`.
- **The indexed look**: an 80 × 45 target at scale 4 (palette ground, body, trim) over a 320 × 180 document of two
  blocks.

## The merge base's frame

Criterion 1 asks that the frame at `convergence: 2, convergence_angle: 0` be "byte-equal to the merge base's frame".
The implementer can't draw the merge base's frame, so this job did, before any implementation:

- **What**: `fixtures/base-frame.png`, the `final` PNG of frame 0 of the line fixture's vertical line under
  `finish: [{screen: {kind: "crt", convergence: 2}}]`, and `fixtures/base-frame.json`, its record: the base commit,
  the GPU, the PNG's SHA-256 and the whole `film2d` call that drew it.
- **How**: `deep-gpu` built from the base commit `16dc5eab0e5c2687b4ae7a973b350c32bbfb9342` (`CARGO_INCREMENTAL=0
  CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked --bin deep-gpu`, debug) was sent that one call through `deep-gpu
  run`, on Metal, by a scratch script that is not in the suite, so no run of the suite can record the frame again.
  The same run sent the look with `convergence_angle: 0` and with `convergence_angle: 90` added: the base answered
  the same `pixel_hash` and `final` for all three, since it ignores the field.
- **Where**: an Apple M5 Max, Metal GPU family `apple10` (the chip's family as #464's suite reads it), macOS. This
  job could not tell whether that is the "reference Mac" the issue's `Runs on:` line means; a reference Mac of
  another GPU family reads INCONCLUSIVE here until a redraft of this job records the frame there.
- **The test** (`line.test.ts`) first holds the record's call to its own (`lineCall(VERTICAL, {convergence: 2})`,
  deep-equal) and the PNG to the record's hash, then draws the look with `convergence_angle: 0` and with the angle
  left out, and compares each frame's decoded `final` with the fixture's: the same width and height and every RGBA
  byte, a failure naming the first pixel that differs.
- **On a machine where the comparison can't hold**: the frame is a same-machine result (canvas primitives:
  Determinism class: "A golden recorded under another fingerprint reads INCONCLUSIVE, naming both"). On a Mac whose
  GPU family isn't `apple10` the test fails with a message starting `INCONCLUSIVE:`, naming both families and chips,
  and its one ask, to run it on a Mac of the recording family; off macOS it is `INCONCLUSIVE:` as every Metal test is.
  It never passes there and is never skipped. The peaks test beside it holds on any Mac.
- **What it can't see**: the merge base of the implementing PR may be a later commit than `16dc5eab`. The fixture is
  this job's base; if main changes how `film2d` draws this frame before the PR, the test fails and the fixture is
  this job's to redraw in a redraft, never the implementer's.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, `- [ ] ` dropped
(`scripts/proof-change.mjs: criterionId`), from the live issue. Each test's name starts with its ID.

| ID | Criterion | File: what it asserts |
|---|---|---|
| `#1619.a63cb7a9` | 1: the line fixture | `line.test.ts` (4), Metal. At `convergence: 2, convergence_angle: 0` the vertical line's red peak is 2 px left of green's and its blue peak 2 px right, each within 0.5 px, and neither moves along y. That frame and the frame with the angle left out hold the merge base's frame's bytes (INCONCLUSIVE on another GPU family). At `convergence_angle: 90` the horizontal line's red and blue peaks are each 2 px from green's along y within 0.5 px, on opposite sides, and neither moves along x. Twin `convergence_angle_ignored` fails, naming `convergence_angle: 90` and red's 0 px from green along y. |
| `#1619.94959aa8` | 2: seeking equals playing | `seek.test.ts` (4). The tape fixture played 48 frames from 0 in one process, then frames 7, 23 and 41 each opened cold in a second: each seeked frame's hash is the played frame's. On the noop backend (anywhere) the hash is `finish_hash`, every frame has one, and the 48 hold more than one. On Metal it is `pixel_hash`, some played frame differs from the frame with no finish, and the 48 hold more than one. Twin `tracking_wall_time` fails on both, naming a seeked frame. |
| `#1619.244eda5f` | 3: the identity frame | `identity.test.ts` (1), Metal. The tape fixture's 48 frames under `convergence: 0, tracking: "none", roll: "none"`, with the angle left out and with `convergence_angle: 90`, each have the pixel hash of the frame with no finish; `convergence: 2`, the tracking band and the roll each change some frame. |
| `#1619.f0d0fbcf` | 4: refused on an indexed look | `indexed.test.ts` (1), Metal. The indexed look whose screen has `convergence: 2, convergence_angle: 90` is refused: a `code`, no `frames`, `reason` `look/finish/0/screen/convergence_angle`; the same look with the angle left out is answered with its frame. |

## Readings where the issue and design leave a choice

- **A channel's peak** is a point: the centroid, at pixel centres and weighted by value, of the pixels at or above
  half the channel's brightest value. "2 px left" and "2 px right" are along x; "within 0.5 px" is the peak's distance
  from where the criterion puts it. The line is 120 px long and clear of the frame's edges so that a peak has both
  coordinates.
- **Along the angle, and nowhere else.** The scope says "the same offsets along the angle, green in place", so across
  the angle the red and blue peaks stay with green's within the same 0.5 px: along y at 0°, along x at 90°. This is
  what tells degrees from radians: an angle of 90 read as radians puts red 1.79 px from green along y, inside the
  criterion's tolerance, and 0.90 px along x.
- **"On opposite sides"** is the two offsets' signs along y differing. Which is above green isn't asserted.
- **"Byte-equal"** is the frame's picture: the decoded `final` target's width, height and every RGBA byte. A PNG
  file's own bytes also carry its encoder's choices, which no criterion fixes.
- **The merge base's look names no angle**, so the comparison is made twice: with `convergence_angle: 0`, as the
  criterion writes it, and with the angle left out, the look the base drew, which holds the default to 0.
- **"The same frame … played straight and after a seek"** is frame n of the film played from frame 0 against frame n
  opened cold with `from: n`, for n = 7, 23 and 41 (inside a 12 Hz step, at the end of the first roll period and in
  the second). The play is one `deep-gpu` process and the three seeks a second, so nothing a process holds, a clock
  read at its start included, can make them agree. **"Byte-identical"** on Metal is the frame's `pixel_hash`, as
  #464 reads "the same pixels"; on the noop backend it is the `finish_hash`.
- **The Spark's half compares what the pass is given, not pixels**, because the noop backend draws none. On one
  machine the pass's output is a function of the frame it reads and the bytes it is given, and a still film's frame
  doesn't change, so a seek can change a frame only through those bytes. The Metal half holds the pixels themselves.
- **"Shows" and "moves"** aren't the criterion's words. They are there so the equality is not a screen that reads
  neither field (the base's): a band and a roll that draw nothing, or the same thing in every frame, can't differ
  after a seek. Over 48 frames at 24 fps, 24 steps of a 12 Hz band and two periods of a 1 s roll, values drawn from
  a hash of the frame index change.
- **`tracking: none` and `roll: none`** are the string `"none"`, as #464 writes `light: none` and `table: none`.
- **The identity holds at any angle**: at 0 px an offset along any angle is no offset, so the identity frame is drawn
  with the angle left out and with `convergence_angle: 90`. Its guard reads `convergence: 2` along 90°.
- **"The finish changes no pixel"** is every frame of the 2 s film having the pixel hash of the same frame under
  `finish: []`, not only frame 0: a band or a roll that starts later would pass a one-frame test.
- **"Refused at check"** is the look refused before any frame is drawn, which `film2d` answers as a refusal, as
  #464's protected table is. **"Naming the field"** is the refusal's `reason` holding the field's path in the look.
  The test sends `convergence_angle: 90`; whether an explicit `convergence_angle: 0` on an indexed look is refused
  is not asserted.
- **The GPU that drew the merge base's frame** is told from another by its Metal family, the chip's, as #464's
  two-GPU record tells GPUs apart. The design's fingerprint also names the OS build, wgpu, naga and the build's
  sources; the last can never match, since the criterion compares two builds, and the frame holds only 0 and 255, so
  the family is the gate and the rest isn't.
- **`tracking_wall_time` "differs after the seek"** is at least one of the three seeked frames differing; the
  failure names it.

## Not asserted, because no criterion says so

The implementer owes these a mapping or a note (AGENTS.md: review requirement → change → proof):

- What a tracking band and a roll draw: the band's height, its shift and its rate, the roll's period and amount as
  measured values. The oracle page speaks of closed-form offsets and periods; the issue's criteria give a closed
  form for the convergence offset alone.
- `tracking` on an indexed look refused at check (scope line 3 names it beside `convergence_angle`; criterion 4
  names only the angle).
- "Status colours stay exact" under the new fields (scope line 1); #464's criterion 2 holds status under the screen.
- Angles other than 0 and 90, and the angle's sense.
- The new fields on a 3D frame (`view3d`), under reduced motion, and in render-back's GPU snapshot.

## The oracle page

Read. It pins no upstream test for any of the four criteria ("0 of 4 acceptance criteria have one"): criterion 1 is
"proven by our own fixture and its planted wrong twin", criteria 2 to 4 are ours. Nothing is copied into this folder.
