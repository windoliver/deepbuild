# Acceptance tests for #499, part "video": a recording's frames on image@1, live and canonical

Written first, from issue #499 (as of Nov 8, 2026: its Scope lines on video, its Image `image@1`: video frames field
and acceptance criteria 3, 7, 8, 12, 13, 14 and 17), its oracle map, the design sections it links and those they lean
on, and base commit `f1e8736e` ("Merge pull request #1742"), by a job that never saw an implementation; none existed.
No other branch, worktree or PR was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding). The issue's other criteria (the clock, the mix and
the module: 1, 2, 4, 5, 6, 9, 10, 11, 15, 16) belong to the other parts of #499's suite.

## What was read

- The issue, live (`gh issue view 499 --repo windoliver/deepbuild`). Scope: "An image can play a video's frames …
  so the camera, masks, mattes, passes and callouts reach a recording"; "A video's frame at t is the one whose
  presentation interval holds the source time, looked up in the stream's own time base"; "Canonical renders …
  decode only the source asset; a proxy frame shows only in the live view while its source frame decodes"; "In the
  live view only, a video decodes near the size it's drawn … outside 0.5× to 1.25×"; "Frames are pooled NV12 buffers,
  one pair per player, reused … sampled by a shader that takes matrix and range from the probe's color tags, since
  GPUI's stock fragment is full-range BT.601 only"; "An item out of view stops decoding (#1487). Since the frame is a
  pure function of `t`, it seeks to `t` when it returns". Fields: Image `image@1`: video frames (`frames: {start, in,
  rate, loop, hold}`), Transport, Strip and track. Its Proof line names "the video-frame hashes".
- The oracle map (`doneright/oracles/issues/499.md`, branch `doneright` of `DeepBuildAI/deepbuild`): criterion 7 maps
  to the Flicks divisor test (`flicks_test.cpp`, `6d6362fb77`) as a formula, "not copied"; 3, 8, 12, 13, 14 and 17 have
  no upstream test.
- `docs/canvas-primitives.md`: Time and the flick (9: integer conversions, "Time to index floors"), Item `at` with
  `anchor: ID#anchor` (335), Circle `circle@1` (1523), Image `image@1` (1791: `crop` in image px, `anchors` as fractions
  of the image), Image `image@1`: video frames (1812: "At t the item shows the source frame at source time in + (t −
  start) × rate … A seek decodes from the previous key frame or a short-GOP proxy … `crop` (a channel), masks, mattes,
  passes, the camera and shots reach it, and marks laid over it stay registered while the camera moves … The frame
  shown at t is fixed by the asset's hash, the decoder's version and t, so seeking equals playing"), Mask (1869),
  Frame clock and scheduler (736: "a `valid_until` takes only items whose bounds meet the view"; "Idle: 0 frames and 0
  wakeups"), Camera `camera@1` and Shot (4428, 4513), One clock, pure evaluation (5126), Transport (5142), Channel and
  key (5312: no four-component type), Sound and video on the picture's clock (7101), Asset (7107: `proxies: [{sha256,
  gop: 1 | 10, scale}]`; "A seek goes to the previous key frame and decodes forward, or uses a short-GOP proxy"),
  Strip and track (7312), Decode worker (7606: "Evidence video hashes decoded YUV planes before color conversion; RGB
  conversion uses the stream's tagged matrix and range").
- `docs/technical-design.md`: The media module (1909), Device gate, capture and export (1969), Dogfooding (2623),
  Tests written first (2654).
- At the base: AGENTS.md; `tests/acceptance/498/decode/` (`media_import`, `media_decode`, `media_proxy`, the
  `cfr30`, `screenVfr` and 75% bars recipes, the untagged-colour rule), `493/` (2D push shots, `eval`'s `film` block,
  snapshots in the evidence store, the taste test), `1487/` (`deep-canvas-render idle` with `view.rect`, the
  reference-Mac gate), `488/` (`determinism`: seek against play), `854/` and `391/` (`idle`, `render`); in
  `crates/deep-show/src` `main.rs` (`eval`'s fields), `media.rs` (the media calls; a proxy kept in the evidence store),
  `time.rs` (`determinism`, `play`), `evidence.rs`; `crates/deep-marks-render/src/lib.rs` and `asset.rs` (`render`,
  `idle`, `store`); `crates/deep-canvas-marks/src/scene.rs` (image@1 and circle@1 params); the shipped clean look.

## What the base already does, and these tests don't credit

`deep-show run` has #498's decode worker calls (`media_import`, `media_decode`, `media_proxy`, the proxy kept in the
run's evidence store by its hash), #488's `determinism` (seek against play on canonical renders), and `eval` with
`pixels` (a Vello CPU snapshot in the evidence store) and #493's `film` block and 2D push shots. image@1 draws still
pictures by hash, with `crop`, `fit` and `sampling`; circle@1 takes `inner_r`. `deep-canvas-render` has `render` (one
frame through GPUI's offscreen Metal renderer, to a PNG) and `idle` (#854's real clock, #1487's `view.rect`), and
`store` on `frames`, `session` and `render`. None of it plays a video's frames: no image@1 reads a video asset, no
reply has a `video` block or a `players` block, there is no NV12 path, no `pans`, no per-frame allocation count, and
neither binary knows this suite's planted names.

## Run them

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/499/video --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/499/video/tsconfig.json   # type-check
```

Each test file builds what it drives once, in `beforeAll`: `cargo build --locked --bin deep-show` (frames, interval,
proxy) or `cargo build --locked --bin deep-canvas-render` (shader, players, out-of-view), copied out of `target/debug`
into a temporary folder; every test of a file fails when its build fails. Every fixture and evidence store gets its own
temporary folder, deleted after the test. Node built-ins and vitest only. A run with `--root` may leave Vitest's cache
in `tests/acceptance/499/video/node_modules/.vite`; delete it.

**It must run alone**: the files build cargo binaries, so `scripts/lanes.mjs` needs `'tests/acceptance/499/video/'` in
its `alone` list, and `players.test.ts` and `out-of-view.test.ts` read the real clock, so both belong in its `timed`
list (beside `854/idle.test.ts` and `1487/wakeups.test.ts`). This job writes only this folder; the implementer makes
that edit.

Platform needs:

- **macOS** for a passing run: the decode worker's codecs are AVFoundation and VideoToolbox (#498), and the live view
  draws with GPUI's offscreen Metal renderer. Off macOS, or when `deep-canvas-render` answers
  `unsupported_platform`, the shader, players and out-of-view tests fail `BLOCKED:`.
- **A reference Mac** (Mac15,7 / Apple M3 Pro / 36 GiB or Mac15,12 / Apple M3 / 16 GiB, #854's) for two readings: AC12's
  frames shown and dropped, and AC13's wakeups. Elsewhere each is recorded, printed and fails `INCONCLUSIVE: reading
  only`. On a reference Mac each is judged over five runs after a warm-up by #854's rule: PASS when all five pass, FAIL
  when all five fail, else `INCONCLUSIVE:`; five failures with the 1-minute load average above the core count are
  `INCONCLUSIVE:` too, since load can drop frames. AC12's allocations and AC13's frames, decodes and return frame are
  counts and hashes, judged on any Mac.
- **ffmpeg and ffprobe** (FFmpeg 4.4 or later, with libx264 and the `setts` filter), on `PATH`, in `/opt/homebrew/bin`
  or `/usr/local/bin`, or named by `DEEP_FFMPEG` and `DEEP_FFPROBE`. They make fixtures and the reference decodes only
  (Fixtures) and never stand in for the decode worker. Without them a test fails `BLOCKED:` with `brew install
  ffmpeg`.

What is deterministic: AC3, AC7 and AC8 run on fixtures the tests make, at flick times, on canonical renders, with no
wall time and no network. AC14 is one frame of the live view. AC12 and AC13 run on the real clock (about 1 min and 30 s
of windows). AC17 needs a person (The taste call).

`BASE-FAILURE.txt` explains why every test fails at the base. **It is a note, not a run**: this job was told not to
build (the machine's disk was nearly full), so the base run's output is not attached.

## The surface under test

The issue names image@1's video frames, proxies, canonical renders, players, the live shader and an item out of view,
but no code API. So these tests extend the two binaries that already carry those parts, in their own style: `deep-show
run` for documents and canonical frames (#393, #488, #493, #498), and `deep-canvas-render` for the live view (#391,
#854, #1487). No new binary or subcommand. **Every name below that the issue or the design doesn't give is this job's
choice**, chosen from the design's words; the implementer builds exactly these, or a dispute goes to a blind redraft.

### Documents

#391's envelope (`{format: 1, id, profile: "board" | "film", title, description, size, layers, transport, items,
assets, …}`; `deep show` strips `layers` and item `layer`, which the hub stamps). Rationals are `[p, q]`, as #488's
`transport.frame_rate`.

- **A video image item**: `{"kind": "image@1", "params": {"asset": sha256, "box": [x, y, w, h], "fit": "fill", "alt",
  "frames": {"start": time, "in": flick, "rate": [p, q]}, "crop"?: [x, y, w, h] (image px), "anchors"?: {name: [fx,
  fy]}, "sampling"?}}`, the asset's bytes in the evidence store (deep-show) or `store` (deep-canvas-render) by their
  SHA-256, the document's `assets: {name: {sha256, license, proxies?: [{sha256, gop, scale}]}}`. The media module
  probes it in the decode worker; it is a video by its probe, not by a field.
- **The crop channel**: the design has no four-component channel type, so the crop is two f32 channels on
  `items/rec/params/crop/2` and `items/rec/params/crop/3` (width and height), over a `crop` whose x and y stay 0.
- **The cursor ring**: a `circle@1` (`center: [0, 0]`, `r: 18`, `inner_r: 14`, fill role `accent`) with `at: {anchor:
  "rec#click", pos: [0, 0, 0]}`, keyed at the image's `click` anchor (Item `at`: "with an anchor, pos offsets from that
  point").
- **The 2D push**: #493's shot `{start: "0s", end: "2s", camera: "cam", move: "push", by: 2, target, view_width}`: from
  2 × the framed view width to it.

### `deep-show run`

- **`video`** on `eval`'s reply: `{"video": {<item ID>: {"frame": k, "planes": sha256}}}` for every image@1 whose asset
  is a video: the source frame the item shows at t (its index in presentation order) and the SHA-256 of that frame's
  decoded planes, unconverted, in #498's `media_decode` `yuv` layout (8-bit 4:2:0 as I420: Y, then Cb, then Cr, each
  plane's rows top-down with no padding, at the stream's own size). The tests judge `planes` only; `frame` is for
  people reading the reply.
- **`video` on `determinism`'s sides**: each of `play` and `seek` in #488's `determinism` reply carries the same block,
  so a test reads what playing to t and seeking to t showed.
- **`eval`'s `t`** is the flick evaluated, exactly (on a board; the tests' film times lie on its 30 fps frames).
- **The scenario's `planted`** (#498's field) takes the two names below.

### `deep-canvas-render`

- **`render`**, #391's call with its `store` (a folder whose files are named by their SHA-256): an image@1 whose asset
  is a video draws its frame at `t` through the live view's path: the frame's pooled NV12 planes sampled by the
  shader that takes matrix and range from the probe's colour tags (assumed by #498's rule when untagged). It takes
  `planted: "stock_bt601_fragment"`.
- **`idle`**, #854's call with #1487's `view.rect`, gains:
  - `store`, as `render`'s;
  - `pans?: [{"at_ms", "rect": [x, y, w, h]}]`: your input, a pan arriving at the first vsync at or after `at_ms` into
    the run (the run's clock starting when the window has opened), from which the window shows `rect`;
  - in its answer, `drawn[]` entries gain `allocs`: the heap allocations the render process made, on any thread,
    while preparing and presenting that frame, counted by a counting global allocator (the decode worker is another
    process, not counted);
  - `players: {<item ID>: {"shown": [{"at_ms", "t", "frame", "planes": sha256 | null}], "decodes": [{"at_ms",
    "frame"}]}}` for every video image item: each new source frame the item put on screen, once, in order, with the
    run time it was presented, the document time `t` (flicks) it was evaluated at, its source frame index, and its
    planes' SHA-256 (as `video` above) on the first frame shown after the window opened and after each pan, null on
    the rest (hashing every frame would load the machine the timing reads); and each decode the player asked of the
    decode worker, with its run time and source frame;
  - `views: [{"rect", "from_ms", "to_ms", "frames", "wakeups"}]`: one per view in effect, the opening view first, then
    one per pan: `from_ms` is when the view's first frame was presented (the opening frame, or the frame the pan armed),
    `to_ms` when the next pan arrived or the run ended, `frames` the frames drawn after that first one until `to_ms`,
    and `wakeups` the process's package-idle wakeups over (`from_ms`, `to_ms`] (#854's reading).

### Planted programs

Each reachable only through `planted`, only to prove a test fails on a wrong program as its criterion names it.

| Name | Where | Criterion | The wrong program |
|---|---|---|---|
| `lookup_floors_frame_rate` | deep-show scenario | AC7 | an image item's frame at source time s is ⌊s × the stream's nominal frame rate⌋, not the frame whose presentation interval holds s |
| `seek_reads_proxy` | deep-show scenario | AC8 | a seek on a canonical render decodes its frame from the asset's short-GOP proxy |
| `stock_bt601_fragment` | deep-canvas-render `render` | AC14 | the live view samples Y and CbCr with GPUI's stock fragment, full-range BT.601, whatever the probe's tags |

AC3, AC12 and AC13 name no wrong program; the base fails each, and AC3's checks are shown to fail on a shifted crop and
on neighbouring frames (Criteria to tests).

## Fixtures

Made at test time by pinned recipes in `helpers.ts`, in each test's temporary folder; none is committed.

- **The recording** (AC3, AC8, AC13): 320 × 240 at 30 fps, 300 frames. Each frame is 8 × 8 blocks of gray (Y′ 40, 56,
  … 200) drawn from a hash of the frame and the block, so frames and places differ; around the click at image pixel
  (200, 120) a flat 48 × 48 field of Y′ 128 holds a white 4 × 4 mark (Y′ 235) centred on the click. Cb and Cr are 128.
  Written by the test as I420, encoded by libx264 at QP 10 without B-frames with a key frame every 60 frames, tagged
  BT.709 primaries and matrix, limited range and the sRGB transfer, at time base 1/15360 with no edit list, so frame k
  is at k/30 s (checked with ffprobe).
- **`cfr30` and `screenVfr`** (AC7): #498's recipes, copied: 60 frames at 30 fps, time base 1/15360, frame k at (512k +
  1)/15360 s; and 20 frames at a nominal 60 fps at 1/600 whose frame 10 lasts 30 ticks (checked with ffprobe).
- **Five 1080p recordings** (AC12): `testsrc2` at 1920 × 1080, 30 fps, 330 frames, libx264 at CRF 18 to 22 (so each is
  its own asset).
- **Untagged 1080p 75% bars** (AC14): #498's recipe, copied: eight bars converted by the test with the BT.709 matrix to
  limited range, libx264 at QP 10, no colour description (checked with ffprobe).
- **The proxy** (AC8): made by the decode worker through `media_proxy` (gop 10, scale 0.5), kept in the evidence
  store; the test checks its key frames fall every 10 frames.
- **References by ffmpeg**: its own decode of each fixture, every frame in presentation order with passthrough timing,
  as I420, whose SHA-256 per frame is the "accurate seek". H.264 decoding is exact by the standard, so a conforming
  decoder (VideoToolbox in the decode worker) gives the same planes; #498's suite found VideoToolbox matching FATE's
  MD5s on H.264.

## Criteria to tests

| ID | Criterion | Test, and the wrong program it fails on |
|---|---|---|
| AC3 `#499.65f30d78` | 30 fps recording as image, start 2 s, in 1 s, rate 2 → source frame 90 at 3 s and 120 at 3.5 s by decoded-frame hash, played or seeked; crop channel to top-left quarter; 2D shot pushing 2× keeps a cursor ring at a recorded click's image anchor within 0.5 px | `frames.test.ts` (2). One: a 160 × 120 film, the recording drawn 1:1 into it at `nearest`; `determinism` at 3 s and 3.5 s: both sides' `video.rec.planes` are ffmpeg's frames 90 and 120 (frames 89–91 and 119–121 all differ); `eval` at 3 s, the crop's end: every pixel of the snapshot is frame 90's pixel at the same place (its BT.709 RGB from the reference planes) within 6 code values, and the same check fails a quarter shifted by one pixel at over 500 pixels. Two: a 640 × 480 film, the recording at 2×, the ring keyed at `rec#click`, a 2 s push by 2; at each of the 61 frames, the ring's centre (the centroid of colour) is within 0.5 px of the click's mark in the drawn recording (the centroid of its brightness); the view width halves and the click moves over 60 px on screen. Wrong programs: the base; any frame, crop or registration off by a frame or a pixel |
| AC7 `#499.035a05de` | frame lookup by presentation interval on a 30 fps MP4 with time base 1/15360 and a variable-rate recording whose frame 10 lasts three nominal frames; planted ⌊t × frame_rate⌋ lookup fails naming the frame | `interval.test.ts` (1): each fixture on a board at start 0, in 0, rate 1; `eval` at every frame's own time (the first flick at or after it), the flick before it (from 0) and 200 seeded times (seeds 499,007 and 499,070) in its span; each `video.rec.planes` must be the reference of the frame whose interval holds t. `lookup_floors_frame_rate` fails on the screen recording, its first failure naming source frame 10 |
| AC8 `#499.a9397111` | gop-10 proxy fixture, canonical seek to frame 90 gives the source frame's hash; planted proxy-reading seek fails naming the frame | `proxy.test.ts` (1): the proxy by `media_proxy` (gop 10, scale 0.5) named in the asset's `proxies`; frame 90 is no key frame of the source and is one of the proxy's; `determinism`'s seek to 3 s (from 4 s) shows ffmpeg's frame 90. `seek_reads_proxy` fails, naming source frame 90 |
| AC12 `#499.96045131` | five 1080p players at 640×360 show 150 frames a second with under 0.5% dropped for 8 s, 0 gross allocations per frame after warm-up | `players.test.ts` (2), `idle` for 9 s, judged over [1 s, 9 s): every frame drawn has `allocs` 0, in each of five runs (any Mac); the five players' `shown` frames number at least 1,194 (150 a second less 0.5%) and the source frames skipped between shown ones are under 0.5% of those due (reference Mac, five runs) |
| AC13 `#499.d5826069` | item out of view 3 s: 0 decodes, 0 frames armed, 0 wakeups; back in view the frame equals the source frame at t | `out-of-view.test.ts` (2), `idle` for 5 s with pans to the card at 1 s and back at 4 s: in each of five runs the view away lasts at least 2.95 s, draws 0 frames, holds no decode and no shown frame; the recording had shown at least 20 frames before; the first frame back has the planes of the source frame at its own `t`, and `t` moved at least 2.9 s while away (any Mac); the process's wakeups away are 0 (reference Mac, five runs) |
| AC14 `#499.09623041` | untagged 1080p 75% bars through the live shader within ±2 code values of BT.709; stock full-range BT.601 fragment fails naming the field | `shader.test.ts` (1): `render` of the bars filling a 1920 × 1080 board: every bar's interior within ±2 code values of the bars. `stock_bt601_fragment` misses and fails, each failure naming `color.matrix` (and `color.range`), the probe's fields the shader must take |
| AC17 `#499.9dbb482c` | "Shown to you" screenshots and a recording attached, one taste call recorded, else INCONCLUSIVE | `taste.test.ts` (1): reads the record only (The taste call); no pictures or no call is `INCONCLUSIVE:`, never PASS |

## Readings where the issue and design leave a choice

1. **Two binaries.** Canonical frames, seek and play are deep-show's (#488's `determinism`, #493's films); the live view
   and its shader, players and clock are `deep-canvas-render`'s, which already draws through GPUI's Metal renderer on
   the real clock (#854, #1487). The live view's decodes still run in a decode worker process, as #498 requires; how
   `deep-canvas-render` starts one is the implementer's.
2. **"By decoded-frame hash"** is the SHA-256 of the decoded planes before colour conversion (Decode worker: "Evidence
   video hashes decoded YUV planes"), in #498's I420 layout, against ffmpeg's decode of the same file. The binary
   reports the hash of what the item shows; the tests decide which frame that is.
3. **"Played or seeked"** are #488's `determinism` sides: play evaluates every 144 Hz display frame from 0 in order, seek
   is a fresh session jumping back from t + 1 s.
4. **"Exactly that quarter"** is pixels: the crop's end drawn 1:1 must match the source frame's top-left quarter at
   every pixel within 6 code values (under half the 16 between neighbouring block levels), so a shift, a scale or
   another frame fails; the fixture is gray and tagged with the sRGB transfer, so neither the matrix nor a transfer
   conversion changes its RGB.
5. **"Keyed at a recorded click's image anchor"** is the image's `anchors.click` (fractions of the image) and the ring's
   `at.anchor: "rec#click"`; "the click's pixel" is read from the drawn recording itself (its white mark), so the test
   holds the ring to the picture under it, not to a pose either binary reports.
6. **"The frame whose presentation interval holds the source time"**: frame k holds [pts_k, pts_k+1), the last frame to
   its stream's end; before frame 0's time, frame 0 ("Before start it shows the first frame"). A frame's "own time" is
   the first flick at or after its presentation time, since 1/15360 s isn't a whole flick; "one flick before it" is
   left out where it would be before 0.
7. **"A planted lookup by ⌊t × frame_rate⌋ … naming the frame"**: the frame rate is the stream's nominal one (60 for
   the screen recording); "the frame" is the frame that should show at the first wrong time, frame 10.
8. **The proxy** is made by the decode worker (`media_proxy`, gop 10, at half scale, a proxy's usual size) and named in
   the asset's `proxies`; frame 90 is a key frame of the proxy and not of the source, so reading the proxy is the cheap
   wrong seek.
9. **"150 frames a second … under 0.5% dropped for 8 s"**: 5 players × 30 fps; a dropped frame is a source frame
   skipped between two a player showed; the 8 s follow a 1 s warm-up, which "after warm-up" also reads for the
   allocations. "Gross allocations" are counted allocations, not net bytes.
10. **"Out of view for 3 s"**: pans, your input, as #1487 reads them, here on the real clock (`at_ms`); "0 frames armed
    by it" is 0 frames drawn while only a still card is in view; "0 wakeups from it" is the process's package-idle
    wakeups over that span (#854's reading), judged only on a reference Mac.
11. **"Back in view, the frame shown equals the source frame at t"**: the first frame presented after the pan back, its
    planes against the source frame at its own `t`. The item is drawn 1:1, so the live view's scaled decoding keeps the
    source size, and its planes compare with the source's.
12. **"Within ±2 code values of BT.709"** reads the bars' R′G′B′ code values the live view writes (as #498's decode
    test does): a video's code values are shown as they are, with no transfer conversion between the video and the
    display. **"Naming the field"** is `color.matrix`, as #498's criterion 8 names it; the failure also names
    `color.range`, the other field GPUI's stock fragment ignores.

## Not tested, and why

- Criteria 1, 2, 4, 5, 6, 9, 10, 11, 15 and 16: the other parts of #499's suite.
- `frames.loop`, `frames.hold`, a time remap on the item, masks, mattes and passes on a recording, a proxy shown in the
  live view while its source frame decodes, the decoder's output-size rule (0.5× to 1.25×), the ring of at most 8
  frames, and the record of scaled decoding's cost and zero-copy buffers: Scope and Fields, but no criterion of this
  part states an observation for them. They are follow-ups for the implementer's own tests.
- Whether a frame is pooled NV12 rather than another layout: the criteria read what it shows, its hash and its
  allocations, not its layout.

## The taste call

The check run writes five files to `docs/evidence/499/` from the canvas's own frames: `frame-3s.png` and
`frame-3.5s.png` (AC3's film at 3 s and 3.5 s), `crop-quarter.png` (the crop at its end), `push-ring.png` (the ring
during the 2× push, at 1 s) and `push.apng` (a recording of the push, its 61 frames). They are attached to the PR and
shown to the owner in the session. The owner's one call goes in `tests/acceptance/499/video/TASTE.json`:

```json
{ "issue": 499, "criterion": "#499.9dbb482c", "verdict": "looks_right", "who": "…", "when": "2026-11-08T09:00:00Z",
  "screenshots": { "frame-3s.png": "<sha256>", "…": "…" }, "note": "…" }
```

`verdict` is `looks_right` or `looks_wrong`; `screenshots` names all five with their SHA-256. No test judges a
picture, and no other test reads these files.

## The Oracle lane

The oracle map gives criterion 7 the Flicks divisor test as a formula, not copied: 15,360 isn't a rate the flick
divides, so the lookup must run in the stream's own units. These tests use it that way: the first fixture's ticks are
45,937.5 flicks each, so a frame's own time and the flick before it straddle a boundary no whole flick marks. No other
criterion of this part has an upstream test; these tests are their local proof.
