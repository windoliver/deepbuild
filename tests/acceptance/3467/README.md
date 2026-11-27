# Acceptance tests for #3467: a live video decodes each frame once and starts a jump at the key frame before it

Written first, from issue #3467 (its opening paragraph and six bullets, its Scope, its `Runs on:` and Proof lines and
its six acceptance criteria, as saved on Nov 25, 2026; it has no comments), the design sections it links and those
they lean on, and base commit `a1ef97760cbc` (main after #3457), by a job that never saw an implementation. No other
branch, worktree or pull request was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, whole. Its criteria's IDs are computed from its body (`scripts/proof-change.mjs`, `criterionId`).
- `docs/canvas-primitives.md`: Image `image@1`: video frames ("A seek decodes from the previous key frame … The frame
  shown at t is fixed by the asset's hash, the decoder's version and t, so seeking equals playing"; Cost: "about
  1.5 B a pixel for 4:2:0, with a ring of 8 decoded frames; a seek O(GOP)"), Asset ("A seek goes to the previous key
  frame and decodes forward"), Decode worker ("Evidence video hashes decoded YUV planes before color conversion";
  "It can never … exceed its memory budget"), Time and the flick, Frame clock and scheduler.
- `docs/technical-design.md`: Media asset; Numbers version 0 has to hold with The reference Macs; Criteria to tests,
  Criteria in a checked shape, Wrong programs, Dogfooding, Tests written first, Repo guards, Proven on the base.
  `docs/parallel-proof.md`: Binaries for tests; the `alone` block and a suite's own lane file.
- At the base: AGENTS.md; `tests/acceptance/499/video/` (the live view's suite: its README, `helpers.ts`,
  `players.test.ts`, `out-of-view.test.ts`), `498/decode/` (`media_decode`), `1487/`, `2694/helpers.ts` (binaries
  from `DEEP_BIN_DIR`), `3300/` (the machine's state from `scripts/benchmark.mjs`); for call shapes only,
  `crates/deep-marks-render/src/lib.rs` (`idle`, `session`, `planted`), `macos.rs` (`videos`, `idle`, `session`),
  `video.rs` (the player), `crates/deep-codecs/src/live.rs` (the worker), `apple.rs` (`LiveDecoder`, `on_picture`),
  `lib.rs` (`decode` with `frames`), `crates/deep-show/src/media.rs` (`media_decode`).

Each line the issue cites was checked against the base and holds there: the start rule (`live.rs:105-108`), the one
picture kept (`live.rs:110-121`), the copy of every picture (`apple.rs:389-419`), the request inside the frame
(`video.rs:216-246`, `macos.rs:2020`), the canonical decode's start (`lib.rs:541-542`).

## What the base already does, and these tests don't credit

`deep-canvas-render idle` plays a video image item on the real clock and answers a `players` block: per item, `shown`
rows `{at_ms, t, frame, planes}` and `decodes` rows `{at_ms, frame}`, `planes` named on the first frame after the
window opened and after each pan only. `session` presents each step's frame at the step's `t`, so a video item shows
its frame at that time there too, but its answer has no `players` block. The player asks its worker for the frame it
shows and then for the next one ahead; the worker starts and keeps as the issue's first bullet says. No row holds
`samples`, nothing reports frame bytes, and neither call knows this suite's planted names (`session` answers an
unknown `planted` value `{"ok": false, "code": "bad_input"}`). `deep-show run`'s `media_decode` with `frames: [k, …]`
is the canonical decode and names each frame's planes by their SHA-256.

## Run them

From the checkout's root. Each file is run alone, one at a time:

```sh
node node_modules/typescript/bin/tsc -p tests/acceptance/3467/tsconfig.json   # type-check

DEEP_BIN_DIR="$PWD/target/debug" NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3467 --no-file-parallelism --exclude jump-forward.test.ts forward.test.ts
DEEP_BIN_DIR="$PWD/target/debug" NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3467 --no-file-parallelism jumps.test.ts
DEEP_BIN_DIR="$PWD/target/debug" NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3467 --no-file-parallelism jump-forward.test.ts
DEEP_BIN_DIR="$PWD/target/debug" NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3467 --no-file-parallelism forward-and-back.test.ts
DEEP_BIN_DIR="$PWD/target/debug" NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3467 --no-file-parallelism bytes.test.ts
DEEP_BIN_DIR="$PWD/target/debug" NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3467 --no-file-parallelism players.test.ts
```

Vitest runs every file whose path holds the name given, and `jump-forward.test.ts` holds `forward.test.ts`, so the
first command excludes it. Started by an agent, Vitest takes its `minimal` reporter, which prints nothing of a
passing test: add `--reporter=default` to a command to read what each passing test prints.

| File | Criterion | Needs built | Time at the base (an estimate, not measured: this job built and ran nothing) |
|---|---|---|---|
| `forward.test.ts` | AC1 | `deep-canvas-render` | about 40 s: 10 s on the real clock, and a session of 250 steps in which today's rule decodes 10,789 samples |
| `jumps.test.ts` | AC2 | `deep-canvas-render`, `deep-show` | about 1 min: the canonical decode of 250 frames, and a session of 200 jumps in which today's rule decodes 25,462 samples |
| `jump-forward.test.ts` | AC3 | `deep-canvas-render` | about 10 s |
| `forward-and-back.test.ts` | AC4 | `deep-canvas-render` | about 10 s |
| `bytes.test.ts` | AC5 | `deep-canvas-render` | 2 to 4 min: a 4K fixture to encode and probe, and a session of 250 steps in which today's rule decodes 10,789 samples of 3840 × 2160; under 1 min once each sample is decoded once |
| `players.test.ts` | AC6 | `deep-canvas-render` | about 1.5 min: five 1080p fixtures, then six runs of 9 s on the real clock |

On a shared machine, outside a proof run or a build slot of its own, start a command through `scripts/lease`, which
waits for the machine's grant.

**Binaries.** With `DEEP_BIN_DIR` set (the proof run sets it; the commands above point it at the checkout's own debug
build) a file takes its binaries from that folder and starts no build. Without it, each file first runs `cargo build
--locked --bin <name>` in the checkout, with `CARGO_INCREMENTAL` and `CARGO_PROFILE_DEV_DEBUG` at 0 unless the
environment sets them, and takes `target/debug/<name>`. A binary that isn't there is `BLOCKED:`, never a pass.

**Platform.** macOS: the live view draws with the offscreen Metal renderer and both decodes use the platform's
decoder; elsewhere every test fails `BLOCKED:`. **ffmpeg and ffprobe** (with libx264) on `PATH`, in
`/opt/homebrew/bin` or `/usr/local/bin`, or named by `DEEP_FFMPEG` and `DEEP_FFPROBE`: they make and check fixtures
only. Without them, or when a fixture doesn't come out as its recipe says, a test fails `BLOCKED:`, naming it.

**Alone.** `lane.json` says so: two files hold a window on the real clock, every file draws on the GPU and decodes on
the hardware decoder. Every fixture and store is in a temporary folder of its file's own, removed after it. A run
with `--root` leaves Vitest's cache in `tests/acceptance/3467/node_modules/.vite`; remove it.

**`BASE-FAILURE.txt`** holds each file's run on the base commit. It is written from the logs of that run, after this
suite: until it is there, nothing here was run on a built binary.

## The surface under test

The issue names the live view, its requests, a `players` block's `decodes` rows and their `samples`, jumps, frame
bytes and four planted workers, but no call. These tests reach all of it through the two calls of `deep-canvas-render`
that already present a video item's frames, and add no call, no binary and no request field but `planted` values.
**Every name marked "this job's" below is this job's choice**; the implementer builds exactly these, or a dispute goes
to a blind redraft.

### `idle` (the live view on the real clock, as #499's suite drives it)

Request, unchanged: `{doc, look, view, seconds, store}`.

Answer, one field added. Each `decodes` row of `players.<item>` gains **`samples`** (the issue's name): a whole
number, 0 or more, the samples the worker decoded for that request. Every row holds it: a request asked ahead and
never shown, and the last request of the run too.

```json
{"ok": true, "players": {"rec": {"shown": [{"at_ms": 0, "t": 0, "frame": 0, "planes": "9f…"}, {"at_ms": 33.4, "t": 23567040, "frame": 1, "planes": null}],
  "decodes": [{"at_ms": 0, "frame": 0, "samples": 1}, {"at_ms": 0, "frame": 1, "samples": 2}, {"at_ms": 33.4, "frame": 2, "samples": 1}]}}, "…": "…"}
```

### `session` (the same view on a clock of the test's own)

Request, unchanged: `{look, store, steps: [{doc, t, view, frames}, {t, frames}, …]}`. Each step presents its first
frame at its `t` (flicks), so a step whose `t` is another time is a jump of every video item to the frame at that
time, forward or back; the player and its worker live through the whole session. The tests give every step `frames:
1`. `planted` takes the four names below.

Answer, **this job's**: `session` gains the **`players`** block `idle` has, one entry per video image item, over the
whole session:

- `shown`: each new source frame the item put on screen, in order: `{"t", "frame", "planes"}`, `t` the document time
  it was presented at (the step's `t`), `frame` its index in presentation order, `planes` the SHA-256 of its decoded
  planes as `idle` names them. In a session **every** row names its `planes`: no timing is read there for the hashing
  to disturb. `at_ms` may be there and isn't read.
- `decodes`: each request the player made of its worker, in the order asked: `{"frame", "samples"}`, as in `idle`.
- **`frame_bytes`** (this job's): `{"app": n, "worker": n}`, whole numbers of bytes. For each side, the most bytes of
  decoded frames it held for this item at one time during the session. `app`: every buffer of the render process
  that holds a decoded frame of the item (at the base, the pooled buffer on screen and the buffer an answer is read
  into). `worker`: every decoded picture the worker holds outside the decoder, from the time it is copied out until
  it is released: a picture kept ahead of its turn, the one being answered. The decoder's own reference frames are
  neither's. `idle`'s entries may carry it too; no test reads it there.

```json
{"ok": true, "steps": ["…"], "players": {"rec": {"shown": [{"t": 682080000, "frame": 29, "planes": "41…"}, {"t": 35632800000, "frame": 1515, "planes": "c0…"}],
  "decodes": [{"frame": 29, "samples": 30}, {"frame": 30, "samples": 1}, {"frame": 1515, "samples": 16}, {"frame": 1516, "samples": 1}],
  "frame_bytes": {"app": 230400, "worker": 115200}}}}
```

### Planted workers (this job's names)

Each is reached only through a `session` line's `planted` field, as this binary's other planted programs are, and
only to prove a test fails on a wrong program. With one named, every video item of that session gets that worker in
place of the shipped one; everything else is the shipped program, and the answer has the same shape. An unknown value
still answers `bad_input`. How the render process tells its worker is the implementer's; never an environment
variable (design: Wrong programs). Example: `{"look": …, "store": …, "planted": "keeps_base_start_rule", "steps": […]}`.

| `planted` | Criteria | The wrong program, exactly |
|---|---|---|
| `keeps_base_start_rule` | AC1, AC3 | The merge base's worker with the count. For a request for sample s it starts at the sample after the last one it decoded when that is before s, and otherwise at the last key frame at or before s (`live.rs:105-108`); it decodes every sample from there through s, answers s's picture, and keeps no other. It never answers from a kept picture. `samples` is what it decoded, s − start + 1. On the first fixture stepped through, 10,789; on the second, 1,485 for frame 1,515 after frame 30 |
| `answers_picture_kept_for_another` | AC2 | The shipped worker, but when it answers a request while it holds a picture kept ahead of its turn for another sample, it answers that picture (the one presented soonest, when it holds several) in place of the one asked for. Its counts are the shipped worker's. On the first fixture every request for a B-frame arrives with the next reference frame's picture kept, and is answered with it |
| `starts_every_request_at_key_frame` | AC4 | Every request starts at the last key frame at or before the sample asked for and decodes through it, whatever the worker decoded before; it never goes on from the last sample decoded and never answers from a kept picture. `samples` is what it decoded. On the second fixture, requests for frames 0 to 91 decode 1,398 |
| `keeps_every_picture` | AC5 | The shipped worker, but it releases no picture: each one it decodes is copied at the output size and held until the worker ends, and `frame_bytes.worker` counts them all. On the third fixture played through at 640 × 360, 250 × 345,600 = 86,400,000 bytes |

**None of the four can be built at the base.** Each one's check reads a field only the work adds (`samples`,
`session`'s `players`, `frame_bytes`), so the base with one place changed still fails at the missing field, not at
the sum, the frame, the count or the bytes; and two of them (the second and the fourth) vary pictures kept ahead,
which the base doesn't have. A twin folder can't carry them either: a twin's files are laid over the change's, and
this job can write neither line edits for files it never sees nor whole files that wouldn't undo the work. So they
are the implementer's to build, to the table above, and the same test files run them unchanged. At the base each
planted test fails at its own assertion that the worker is there (`session` answers `bad_input`).

## Fixtures

Made at test time by the recipes in `fixtures.ts`, in the file's temporary folder; none is committed. All three are
ffmpeg's `testsrc2` (every frame differs) at 30 frames a second, encoded by libx264 (`-preset veryfast -crf 20`) with
a fixed number of B-frames (`-bf n -b_strategy 0`), none of them a reference (`-x264-params b-pyramid=none`), key
frames only where the interval puts them (`-g n -sc_threshold 0`), tagged BT.709 limited range, in an MP4 whose
video time base is 1/15360 with ffmpeg's own edit list. So frame k is presented at 512k ticks = k/30 s = k ×
23,520,000 flicks, a whole number.

| Fixture | Criteria | Recipe | What it is |
|---|---|---|---|
| `REORDERED` | AC1, AC2 | 320 × 240, 250 frames, `-bf 2 -g 250` | one key frame (frame 0); every third frame a P-frame, the two between B-frames; stored 0, 3, 1, 2, 6, 4, 5, … (each reference frame ahead of the two frames shown before it) |
| `IN_ORDER` | AC3, AC4 | 320 × 240, 1,800 frames (60 s), `-bf 0 -g 30` | a key frame at frames 0, 30, 60, … (60 of them); stored in presentation order |
| `REORDERED_4K` | AC5 | 3840 × 2160, otherwise `REORDERED`'s | as `REORDERED` |

Each is checked after it is made, from ffprobe's reading of its stream, its packets as stored and its frames as
shown (`fixtureProblems`): size, time base, a frame every 512 ticks, the stored order above, the key frames above
and no other, each frame's type. This job made all three with FFmpeg 9.0.2 and they passed that check; replaying the
base's start rule over `REORDERED`'s sample table gives the issue's own counts, 10,789 samples for 250 frames and 248
for one of them, and over `IN_ORDER`'s, 1,485 for frame 1,515 after frame 30.

The five players of AC6 are #499's own recordings (`players1080` in `tests/acceptance/499/video/helpers.ts`): five
1920 × 1080 `testsrc2` files of 330 frames at 30 frames a second, without B-frames.

**The canonical decode** (AC2) is `deep-show run` with one call, `{"call": "media_decode", "path", "out", "frames":
[0, …, 249]}`: its reply names each frame's `planes`, the SHA-256 of its decoded I420 planes at the stream's own
size. The 250 hashes must all differ, so a hash names a frame. When that call can't be read the test is `BLOCKED:`.

## Criteria to tests

Each test's title starts with its criterion's ID. A judge (`judges.ts`) decides each from the answer's JSON alone;
where a criterion names a planted worker, a second test runs the same line with `planted` and asserts the same judge
fails, naming what the criterion says it names.

| ID | Criterion | Tests, and the wrong program each fails on |
|---|---|---|
| AC1 `#3467.261c442a` | 250 frames, two B-frames between reference frames, one key frame, played forward through its whole span in the live view: `samples` sum to at most 250. On the merge base the rows hold no `samples`; fails naming the field. Planted today's start rule sums to over 10,000; fails naming the sum | `forward.test.ts` (3). One: `idle` for 10 s; the frames shown rise from frame 0 to frame 249, every `decodes` row holds `samples`, and they sum to at most 250 and to no less than the frames shown. Wrong program: the merge base, whose rows hold no `samples`; the failure names the field. Two: `session`, one step a frame, frames 0 to 249 each shown once in order; the same sum. Three: that session with `keeps_base_start_rule`; the judge fails naming the sum, and the sum is over 10,000 |
| AC2 `#3467.6bd8eb71` | At 200 seeded times, jumped to in a seeded order, the frame shown has the canonical decode's planes of that frame, by hash. Planted answers a picture kept for another sample; fails naming the frame | `jumps.test.ts` (2). One `session` of 200 steps at the seeded times, the recording drawn at its own size; at each, the `shown` row carrying that `t` has the `planes` the canonical decode names for the frame whose interval holds it. With `answers_picture_kept_for_another` the judge fails, each failure naming the frame that should have shown |
| AC3 `#3467.f53de7f6` | 60 s, key frame every 30 frames, stored in order: a jump from frame 30 to frame 1,515 decodes at most 16 samples. Planted today's start rule decodes 1,485; fails naming the count | `jump-forward.test.ts` (2). A `session` of two steps, frame 29 then frame 1,515: the one request for frame 1,515 comes right after the request for frame 30 and holds `samples` of at most 16 and no fewer than the 16 from frame 1,500. With `keeps_base_start_rule` the judge fails naming the count, and the count is 1,485 |
| AC4 `#3467.4c4b1527` | The second fixture played forward decodes one sample a frame; a jump back decodes from the key frame before its target and no sample earlier. Planted starts every request at a key frame, decodes more than one sample a frame; fails naming the sum | `forward-and-back.test.ts` (2). A `session`: frames 0 to 90, one step each, then back to frame 47. The forward requests' `samples` sum to the frames they cover; the request for frame 47 holds 18, frames 30 to 47. With `starts_every_request_at_key_frame` the judge fails naming the forward sum, which is over the frames covered |
| AC5 `#3467.1a19a5d4` | 3840 × 2160 encoded as the first, in a 640 × 360 player: frame bytes held by the app and the worker together stay under 8 MB. Planted keeps every picture; fails naming the bytes | `bytes.test.ts` (2). A `session` stepping the 250 frames in a 640 × 360 box: `frame_bytes.app + frame_bytes.worker` is under 8,000,000, and each side is at least one 640 × 360 frame (345,600 bytes). With `keeps_every_picture` the judge fails naming the bytes, and the worker's alone are 8 MB or more |
| AC6 `#3467.43114bc0` | #499's five players at 640 × 360 show their frames as on the merge base: 150 frames a second with under 0.5% dropped, 0 allocations a frame in the render process after warm-up | `players.test.ts` (2). #499's check, run again: a warm-up run and five runs of `idle` for 9 s, judged over [1 s, 9 s). One: in each run a frame is drawn there and every frame drawn has `allocs` 0 (any Mac). Two: the five players' `shown` frames number at least 150 a second less 0.5%, with under 0.5% of the frames due skipped (a fit reference Mac at a load no higher than its cores, over the five runs). No wrong program is named; it passes at the base |

At the base: `forward.test.ts`'s first test fails naming `samples`; the others of AC1 to AC5 fail naming the
`players` block `session` doesn't answer, or, for a planted test, the planted worker that isn't there; AC6 passes
where the machine can judge it.

## Readings where the issue and design leave a choice

1. **Two calls, no new one.** "The live view" is `deep-canvas-render`, and `idle` is the call that plays a video on
   the real clock. A jump to a named frame can't be made on the real clock, and `session`'s steps already put each
   video item on its frame at a time the request gives. So the jumps, and every count that must be exact, run on
   `session`, which gains only the block `idle` already answers. A new request field for jumps on `idle` would be a
   second way to set the time.
2. **Criterion 1's second sentence** says how its test fails on the merge base: "the rows hold no `samples`". Only
   `idle` has rows there. So the criterion's own test is the `idle` run, and at the base it fails reading `samples`
   from rows that hold `at_ms` and `frame`.
3. **"Plays forward through its whole span"**: 10 s of the real clock for a recording of 8.33 s. The real clock may
   skip frames; the test holds only that the frames shown rise from the first to the last. The sum is at most 250
   whatever is skipped, since each sample is decoded once.
4. **"Sums to over 10,000"** needs every frame asked for in order. On the real clock the planted worker's own decodes
   (up to 248 samples for one frame) make the clock skip frames, and the sum then depends on which: replayed over one
   skipping order it is 6,491. So AC1 has one more run, on `session`, which the shipped worker must pass and the
   planted one fails with its sum over 10,000 (10,789 by the rule's replay; the test asserts only "over 10,000").
5. **"200 seeded times … in a seeded order"**: 200 different whole-flick times in the recording's span drawn with
   seed 3,467,001, sorted, then shuffled with seed 3,467,002 (mulberry32, as #499's suite seeds its times). They
   make 104 jumps back and 95 forward; 121 land on B-frames. The first step opens the session at the first time.
6. **"The frame shown"** is the `shown` row carrying the jump's `t`. A jump into the frame already on screen shows
   no new frame and has no row (none of the 200 is one). The item is drawn at the recording's own size at zoom 1,
   so the live view decodes at the source's size and its planes compare with the canonical decode's (#499's README,
   readings 2 and 11).
7. **"The canonical decode"** is the Scope's: `crates/deep-codecs/src/lib.rs`, `frames: [k]`, reached through
   `deep-show run`'s `media_decode`. It is not in this task, so it is the oracle as it stands at the base.
8. **"A jump from frame 30"** means the worker is at frame 30: the last frame asked of it, so the last sample it
   decoded, is frame 30's. The criterion's 1,485 is 1,515 − 30, and the issue counts by replaying the worker's rule
   over a list of requests. The base's player asks for the next frame ahead, so the test shows frame 29. With frame
   30 on screen the worker would be at frame 31 and today's rule would decode 1,484. The judge checks that the
   request before the jump's is for frame 30 and says so when it isn't; how the player asks is not in this task.
9. **"Decodes at most 16 samples"** is counted over the one request for frame 1,515. The request for frame 1,516
   that follows it is the play going on, not the jump. The judge also refuses fewer than 16: the Scope puts the
   start at the later of the sample after the last one decoded and the last key frame at or before the target,
   here frame 1,500, so a lower count is no count of the worker's.
10. **"The second fixture played forward"** is a stretch of it, frames 0 to 90, across the key frames at 30, 60 and
    90, each frame one step: enough for a worker that starts every request at a key frame to decode 1,398 samples
    where 92 would do. **"One sample a frame"**: the forward requests' `samples` sum to the frames they cover, the
    one asked ahead of the last shown among them. **"A jump back"** is from there to frame 47; **"from the key frame
    before its target and no sample earlier"** is exactly the 18 samples of frames 30 to 47.
11. **"Played in a 640 × 360 player"**: a 640 × 360 box at zoom 1, the 250 frames stepped through once.
    **"Frame bytes held by the app and the worker together"** are read from `frame_bytes` (the surface above): each
    side's most at one time, added, which is never under the most the two held at once. The decoder's own reference
    frames aren't counted: #395's planted ring of 8 "at source size holds about 100 MB", which is eight frames'
    bytes and no decoder's. **"8 MB"** is 8,000,000 bytes: the design writes MiB where it means 2^20, and the
    decimal reading is the stricter. Each side must count at least one frame at the player's size, or the field
    counts nothing: the app holds the frame on screen, and on this recording the worker keeps a picture ahead.
12. **"As on the merge base"** (AC6): the behaviour #499's criterion 12 states, held by the check #499's suite holds
    it with, on the same fixture and document. It is behaviour that must not change, so the test passes at the base
    and proves nothing new there; the criterion names no planted program, and none is added. One difference from
    #499's file: its allocation test also fails a run that drew fewer than 240 frames in the 8 s, which is a timing;
    here a run must draw at least one frame there, and the rate is left to the second test.
13. **Timings and the machine.** Sums, counts, bytes, hashes and allocations are judged on any Mac. The one timing,
    AC6's frames shown and dropped, counts only on a fit reference Mac (technical design: The reference Macs): one
    of the design's three machines, on mains power, with Low Power Mode off and the thermal state nominal, read from
    `scripts/benchmark.mjs` (`references`, `fingerprint`) as #3300's suite reads them. It counts there only while
    the 1-minute load, read when the five runs have ended, is no higher than the core count: a loaded run counts
    neither way, pass or fail (technical design: How runs become one of five verdicts; parallel proof: Invariants).
    The throttle's `timed` class waits for a load below the core count (parallel proof: Scheduling). #499's own
    helper lists two of the three Macs and lets five passes under load count; the design is the rule. A timing that
    counts is judged by #854's rule over the five runs: PASS when all five pass, FAIL when all five fail; anything
    else, and every run elsewhere or under load, fails `INCONCLUSIVE:` with the reading printed. It never passes by
    skipping.
14. **Reuse.** #499's documents, store, ffmpeg runner, five players' recordings and verdict helpers are imported
    from `tests/acceptance/499/video/helpers.ts`, as #503's, #1488's and #172's suites import that file.

## Not asserted, and why

- Scope: "The pictures kept ahead are bounded by what the stream's own order needs, and never more than 16
  (drafted)". No criterion states an observation of how many pictures are kept; AC5's bound holds them only under
  8 MB in all.
- Scope: "A picture the worker doesn't keep is released without being copied". No criterion reads a copy: neither
  `samples` nor `frame_bytes` shows one that is made and dropped at once.
- The issue's bullet "The frame being drawn waits for all of it": no criterion holds a frame's time but AC6.
- The exact planted counts beyond the criteria's own (10,789; 248 for one frame; 709 and 204 for other key frame
  intervals), the shipped worker's `samples` request by request, and that AC1's real-clock run shows every frame.
- That `idle` reports `frame_bytes` or names more `planes`, and anything about `at_ms` in a session.
- Scope's "Not in this task": what the view shows while a decode is out, how a picture crosses from the worker to
  the app, a recording in WebM (#3464), the canonical decode.
- #395's own planted ring of 8 at source size: this issue names another planted worker for the same bound.
- The Proof line's "on the merge base" counts: the base holds no `samples`, so today's rule is read through
  `keeps_base_start_rule` on the change, for the first sum and the jump's count (each test prints its reading). No
  test runs the second fixture's forward play on that worker: today's rule decodes one sample a frame there.

## What the implementer adds outside this folder

- The surface above, in the crates.
- `'tests/acceptance/3467/players.test.ts'` in the `timed` list of `scripts/lanes-lists.mjs`, beside
  `'tests/acceptance/499/video/players.test.ts'`: it judges a timing. `lane.json` already runs the folder alone.
- Nothing else: no dependency, no fixture file, no change to another suite.
