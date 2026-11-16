# Blind redraft of #518's AC10 test: the encoder's open hidden behind the film's preparing

AC10, `#518.f259d9bf`: "With a stub tool whose open takes 2.0 s, the fixture film's wall time grows by at most 0.2 s over
a stub whose open takes 0 s, since the open overlaps compiles; a planted export that opens the tool after the first
frame grows by about 2 s and fails, naming the encoder open"

Written by a fresh blind job from the same inputs as the first draft (`tests/acceptance/518/open.test.ts`): issue #518's
text, the design and the base commit `d8c46f0d5` (`d8c46f0d58162ff0a4a483544149316aec960637`), which has no
implementation of #518. No implementation was seen, and no other checkout, worktree, branch or pull request was read.
The job was given the criterion and told that the first draft's surface is fixed; it was not told why a redraft was
asked for. The implementing agent doesn't edit these files (AGENTS.md, Proof; design: Dogfooding).

## What was read

- The issue's text as handed to this job: its Scope, Fields, 12 acceptance criteria, Proof line and dependencies. The
  criterion's ID is the one the job was given, the first draft's `AC[10]`.
- `AGENTS.md` (the four invariants, Proof). `docs/technical-design.md`: Dogfooding, Wrong programs, and Criteria to
  tests and The edit guard beside them. `docs/canvas-primitives.md`: Export: encode job, and Export's receipt and
  Semantics (`timing {prepare, …, wall}`, `start: cold | warm`, the ring, all or nothing).
- The first draft: `tests/acceptance/518/README.md`, `helpers.ts`, `open.test.ts` and `tsconfig.json`; and the helpers
  it imports from, `157/helpers.ts` and `501/helpers.ts`, for what the imports do, with `157/fidelity.test.ts` for a
  film of this length.
- The redraft convention: `501-redraft-ac10/README.md`, and `162-redraft-ac6/` (README, test file, tsconfig).
- At the base, for what an export does before its first frame: `crates/deep-show/src/export.rs` (the sound is rendered
  first, then the frames), `export/frames.rs` (`export_frames`, `sink_for`, `sink_push`; `readback` puts each frame in
  the evidence store as it is drawn), `export/feed.rs` (`Part::open`), `frames.rs`, `snapshot.rs` and `print.rs` (a
  2D frame is drawn on the CPU; a look that prints goes through a GPU pass), the root `Cargo.toml` (which crates the
  dev build optimizes), `crates/deep-show/Cargo.toml` (no `test-encode-tools`), `scripts/lanes.mjs` (`alone`,
  `timed`).
- Nothing was run but `tsc` on this folder, which exits 0. No cargo and no vitest: the job was told the machine is
  shared and loaded. So there is no `BASE-FAILURE.txt`, and the judge was not tried on made-up readings.

## The surface under test

The first draft's, as its README has it. Nothing is added to it.

| Surface | What this test uses | From |
|---|---|---|
| scenario | `deep-show run`, one line on stdin, one answer line; `planted` | 518/README |
| `deep show` | the film, presented | existing |
| `export` | `out`, `video: {codec: "h264"}`, `audio: {codec: "aac"}`, `tool`, `brief: {tools: [tool]}`, `readback: true` | `tool` and `brief`: 518/README; the rest existing (#501, #157) |
| reply | `outcome: "exported"`; `receipt.encoder {name, version, hardware}`, `receipt.frame_hashes`, `receipt.timing.open`; `readback.frames[0]`; `outcome: "blocked"` | `timing.open` and `blocked`: 518/README; `readback.frames`: #501 |
| the evidence store | `<2 hex>/<62 hex>` (#15): with `readback: true`, each frame's raw BGRA8 bytes | existing (#501) |
| build | `full,test-encode-tools`, with `test-open-2s@1.0.0` and `test-open-0s@1.0.0` | 518/README |
| planted | `export_opens_tool_after_first_frame` | 518/README |

Everything else comes by import from `../518/helpers.ts`: the build, the scenario, the film, the watched run, the
receipt's readers, `loadProblem`, `inconclusive`, `blocked`, `failsNaming`. This folder has no `helpers.ts`.

## The fixture

A 2 s cut of the export guards' fixture film (#157's `filmDoc`, through the first draft's `film`): 48 frames of
160 × 90 at 24 fps, a ground, a side panel and two bars that move a pixel a frame, with its 48 kHz stereo tone. It is
exported as H.264 with AAC, the form the issue exports the fixture film in and the codec the two stubs stand behind.

Why this cut:

- The criterion names the fixture film and no length (criteria 1 and 12 say 60 s; this one doesn't). The open and the
  compiles are the same for a film of any length.
- A short film's wall time is nearly all cold start, which is where the open belongs. A 60 s film adds 1,440 frames
  of drawing, hashing, encoding and decoding to both sides, and their run-to-run scatter is of the order of the 0.2 s
  being judged.
- 48 frames are more than any ring a tool holds (`frame_delay` ≤ 16, so at most 18 slots). An export can't draw the
  whole film ahead of a tool that isn't open, so a late open can't hide behind frames drawn ahead.
- The base exports this film at this length as H.264 with AAC (#157's criterion 4, its film without grain), and
  exports films as H.264 with AAC with `readback: true` (#157's wrap test).

Made at test time in a temp folder, removed after each reading. No personal data; CC0.

## What the test drives and measures

`open.test.ts`, two tests, each named `AC10 #518.f259d9bf …`.

**A reading** is one fresh `deep-show run`: the film presented, then one `export` pinned to a stub, with
`readback: true`. It gives three numbers, in seconds:

- `wall`: from the command to its answer, by this process's clock.
- `first`: when frame 0's bytes (57,600 of them, named by `readback.frames[0]`) were first seen in the evidence store,
  which is watched every 20 ms while the run lasts. It is the film's time to its first frame, read from outside.
- `open`: the receipt's `timing.open`.

Each reading also checks that the receipt's encoder names the stub and that 48 frames were delivered. `readback` is
asked of both stubs alike, so what it costs cancels in the growth.

**The growth.** Readings come in pairs, one through each stub, the stub that goes first alternating. The growth is
the least `wall` through `test-open-2s@1.0.0` less the least through `test-open-0s@1.0.0`: what disturbs a run only
adds to it, so the least is the nearest to the true time. A least time is taken as good to its gap to the third least
reading of the same stub, so the growth lies in a span, `low` to `high`. Pairs are added, from 3 to at most 10, until
the span is wholly within 0.2 s or wholly over it.

**The room.** The least `first` through the 0 s stub is the longest a 2.0 s open could hide behind on this machine.

**Test 1** (the export as shipped). The receipt times each open: at least 2.0 s through the 2.0 s stub in every
reading, and under 2.0 s through the 0 s stub in its quickest. Then the judge: a growth over 0.2 s fails, in a line
that starts `encoder open:` and gives every reading.

**Test 2** (planted `export_opens_tool_after_first_frame`). The same readings and the same judge. The judge must
fail, naming the encoder open, and the growth must be about 2 s: 1.5 to 3 s, the band the plant is built to
(518/README: Planted programs). This test is also the proof from outside that the 2.0 s stub's open takes real time.

Thresholds, all the issue's or the first draft's surface: 2.0 s (the open), 0.2 s (the most growth), 1.5 to 3 s (about
2 s). This job's own: 48 frames, 20 ms between looks at the store, 3 to 10 pairs, the third least as the confirming
reading, 10 minutes as one run's limit.

## A loaded machine, and the verdicts

A loaded machine can turn a verdict into INCONCLUSIVE and never into a pass.

- **PASS** (test 1): the whole span is at or under 0.2 s, and both opens are timed as above.
- **FAIL** (test 1): the whole span is over 0.2 s, the one-minute load is at or under the core count, and the film
  took at least 2.0 s to reach its first frame. Also: the build fails; a run doesn't answer; the export isn't
  delivered; the receipt lacks `encoder` or `timing.open`, or times an open wrongly.
- **INCONCLUSIVE** (test 1):
  - after 10 pairs the span still straddles 0.2 s: the clock can't tell;
  - the growth is over 0.2 s while the one-minute load is above the core count (the first draft's `loadProblem`);
  - the growth is over 0.2 s and the film reached its first frame in under 2.0 s. No export can hide the whole of a
    2.0 s open in a shorter start, so the growth then says nothing of where the export opens its tool. The failure
    gives both times. See Not settled.
- **Test 2**: PASS when the judge fails naming the encoder open and the growth is in 1.5 to 3 s. Outside that band,
  which is where a plant the judge doesn't fail lands, it is INCONCLUSIVE while the load is above the core count or
  the span still reaches into the band, and FAIL otherwise.
- **BLOCKED** (both): the export answers `blocked`. The stubs stand behind this machine's own H.264 tool; where the
  export finds none, nothing was run.

## Wrong programs

- **The planted twin** the criterion names: `export_opens_tool_after_first_frame`. Test 2 asserts the judge fails on
  it. It is the order the base has: there the tool's part is opened when its first frame is pushed, after that frame
  is drawn (`export/frames.rs`, `sink_push`).
- **Test 1 on the plant** (read, not run): the growth is about 2 s whatever the film, so the span is wholly over
  0.2 s. On a quiet machine it reads FAIL where the film has 2.0 s of start, and INCONCLUSIVE where it doesn't. Never
  a pass.
- **A stub whose open isn't slow** would pass the growth with nothing hidden. It fails `timing.open` at least 2.0 s
  by the receipt, and test 2's 1.5 s by the clock.
- **A receipt that times every open the same** fails one side of the `timing.open` reading.
- **At the base** (read, not run): `crates/deep-show/Cargo.toml` has no feature `test-encode-tools`, so the build
  fails and both tests fail on "the binary builds".

## Run it

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci    # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/518-redraft-ac10 open.test.ts --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/518-redraft-ac10/tsconfig.json   # type-check (exits 0)
```

The file builds `deep-show` once in `beforeAll` (`cargo build --locked --bin deep-show --no-default-features --features
full,test-encode-tools`). Each test then runs 6 to 20 cold exports of the 48-frame film, one at a time, and prints
every reading. Delete `tests/acceptance/518-redraft-ac10/node_modules/.vite` after a `--root` run.

It reads a clock, so it must not share the machine with another heavy file. `scripts/lanes.mjs` needs these lines
(this job writes only its folder; the implementer adds them):

```js
alone.push('tests/acceptance/518-redraft-ac10/');
timed.push('tests/acceptance/518-redraft-ac10/open.test.ts');
```

## How it differs from the first draft

| | First draft | This draft |
|---|---|---|
| Film | the 60 s fixture film, 1,440 frames | its 2 s cut, 48 frames |
| Readings | a warm-up, then 3 pairs (2 for the plant) | 3 to 10 pairs, until the growth's span settles |
| Growth | least less least | the same, with the span it lies in |
| The film's start | not read | time to the first frame, read from the evidence store |
| A growth over 0.2 s | FAIL, or INCONCLUSIVE under load | FAIL, or INCONCLUSIVE under load or when the film's start is under 2.0 s |
| A growth the clock can't place | judged as read | INCONCLUSIVE |
| `timing.open` | at least 2.0 s through the 2.0 s stub | that, and under 2.0 s through the 0 s stub |
| An export that answers `blocked` | FAIL | BLOCKED |
| The plant | judge fails, growth 1.5 to 3 s | the same |

## Readings where the issue and the design leave a choice

- **"The fixture film"** is the export guards' fixture film as #157's suite makes it, the first draft's reading. Its
  length is this job's choice (The fixture).
- **"Wall time"** is the whole command, from its start to its answer, by the test's clock. The design's receipt has
  `timing.wall`, but it is not in the fixed surface, and a clock outside is not the product's word.
- **A cold start** is a fresh process for every reading. Nothing else is cleared between readings.
- **"Grows by at most 0.2 s"** compares least times. The limit itself is within: a span whose top is exactly 0.2 s
  passes.
- **"Since the open overlaps compiles"** is read as a condition on the film: the open can hide only behind a start
  that lasts as long as it does. The test reads that start from outside rather than take it on trust.
- **"Fails, naming the encoder open"** is this suite's judge failing in a line that starts `encoder open:` and quotes
  the opens the receipts time, as the first draft read it.
- **"About 2 s"** is 1.5 to 3 s, taken from the first draft's table of planted programs, since the plant is built to
  that table.
- **"A stub whose open takes 0 s"**: its receipt's `timing.open` must read under 2.0 s. The issue gives no number.

## Not settled

- **Whether this film's start lasts 2.0 s.** An export can't run more than a ring of frames ahead of a tool that
  isn't open. So through the 2.0 s stub the wall time grows by about 2.0 s less the time the film takes to reach its
  first frame, however early the export opens the tool. The criterion's 0.2 s can hold only on a film whose start
  lasts about as long as the open, which is what "since the open overlaps compiles" assumes. Neither the issue nor the
  design says how long the fixture film's compiles last, and this job ran nothing, so it does not know. What it read
  points to a short start: at the base a 2D frame is drawn on the CPU (`snapshot.rs`, `raster`), and the GPU compiles
  only the passes that hash and read each frame. If the start is under about 1.8 s on the machine, no export can meet
  0.2 s on this film. Test 1 then reads INCONCLUSIVE with both times, as it does for any growth over 0.2 s on a start
  under 2.0 s, and the criterion needs the issue to name a film whose compiles outlast the open, or a shorter stub
  open. This job did not pick a heavier film: nothing it could read says which film the base can draw compiles for
  2 s, and it could not run one to find out.
- **A start a little over 2.0 s.** `first` counts from the command, so it includes the process's start and the
  document's presenting, which no export can open its tool in. A right export on a film that reaches its first frame
  just after 2.0 s can still grow by more than 0.2 s. Test 1 fails it, as the criterion is written.
- **Shaders kept between processes.** Every reading is a fresh process, but the operating system may keep compiled
  shaders from one process to the next (not verified here). If it does, the first reading has the longest start and
  the least times come from the shortest, which is the state the test judges.
- **When `readback` writes.** #501 says an export keeps each frame's bytes in the evidence store, not when. If an
  export writes them late, `first` reads long, the 2.0 s rule doesn't apply, and a growth over 0.2 s fails as it
  would in the first draft.
- **The confirming reading.** Taking a least time as good to its gap to the third least is this job's rule for
  when a clock can tell. The issue gives the limit and no way to read it on a busy machine.
