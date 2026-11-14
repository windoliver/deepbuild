# Acceptance tests for #503: depth video as points, 360° video backgrounds, spectrum bands and our own audio decoders

Written first, blind, from issue #503 (as of Nov 10, 2026: its Scope, its Fields, its 5 acceptance criteria, its Proof
and Oracle lines), its Oracle page, the design rows and sections it links and those they lean on, and the base commit
`014344430` (`0143444304ea87f9b094ed85b59a5183e98a43d0`, "design(#503): how a document declares a spectrum bake, its
key, empty bands and its array; the depth value a point set reads; how a video background is sampled; the refusal of
an unlisted audio codec"), by a job that never saw an implementation; none exists at the base, and no other worktree,
branch or PR was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job (design: Dogfooding). The Oracle lane for criterion 4 is in `tests/acceptance/503-oracle/`.

## What was read

- The issue, live (`gh issue view 503 --repo windoliver/deepbuild`). Each test's name starts `AC<n> #503.<id>`, the
  first 8 hex digits of SHA-256 of the checkbox's text after `- [ ] `, trimmed, white space collapsed
  (`scripts/proof-change.mjs`, `criterionId`).
- The Oracle page (`doneright/oracles/issues/503.md`, DeepBuildAI/deepbuild, branch `doneright`) and the files it
  vendors: criterion 4 has FFmpeg's FATE recipes and one upstream engine's WAV test; criteria 1, 2, 3 and 5 have none.
- `docs/canvas-primitives.md` at the base, with the paragraphs the base commit added: Analysis bake (the spectrum's
  fields and semantics; `bakes`, the answer's `rate`, `bands`, `rows`, `key`; `spectrum_band_empty`; the array
  `spectrum.<bake ID>`), Marks in 3D (a point set `from: video`, its unprojection, the depth value d read from the
  decoded 8-bit R′G′B′, the cap of 1,048,576 points, the classes), Sky `sky@1`: environment (a video background, its
  sampling, the blur refusal), Decode worker (the codec list, sample ÷ 2^(depth − 1), `unsupported_codec`), Image
  `image@1`: video frames (`frames`), Mark set and columns, Mark set: logic columns, Time and the flick, Asset.
- `docs/technical-design.md`: The media module, Dogfooding. `AGENTS.md`.
- At the base, for existing surfaces only: `crates/deep-show/src/` (`main.rs`: calls, the scenario's `planted`;
  `bake.rs`: `media_bake`'s reply; `media.rs`: `media_import`, `media_decode`, the worker's pid; `frames.rs`: `eval`'s
  `arrays`; `time.rs`: `determinism`; `spatial.rs`: `spatial`; `hub.rs`: `deep show`'s refusal), `crates/deep-codecs`
  (the probe, the decode, a refusal's shape, the WAV reader), `crates/deep-gpu-layer/src/view3d.rs` (`from`, `frames`,
  `capture`, `targets`, `seeks`, `read`, `assets`, `licenses`, a refusal), `crates/deep-canvas-scene3d/src/sky.rs` (the
  base already parses `background: {video: {asset}}` and refuses it `unsupported`; it refuses `background_blur` with
  a video naming the field), `crates/deep-scene3d-render/src/env.wgsl` (the equirectangular convention), and the suites
  `502/`, `501/`, `501-redraft-ac10/`, `500/bake/`, `498/decode/`, `499/video/`, `420/`, `422/`, `426/`, `535/`,
  `1818/`, `1819/` as patterns and for their helpers.

What the base already does and these tests don't credit: `media_bake`'s loudness, onsets, envelope and model kinds
(#500, #1819), `media_decode` of WAV and AAC in MP4 (#498), video frames on `image@1` (#499), `determinism`, `eval`
with `arrays` of scalars (#497), `spatial` (#421), `view3d` with `read` of operator outputs (#483) and `seeks` (#484),
the HDR environment and its background (#422, #426), and the refusal of `background_blur` above 0 with a video, naming
the field (so AC3's refusal test may pass at the base). There is no spectrum kind, no `bakes`, no point set from a
video, no video background drawn, no AIFF, CAF, MP3, ALAC, FLAC, Opus or Vorbis decoder, and no `unsupported_codec`.

## Run them

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
node node_modules/vitest/vitest.mjs run --root tests/acceptance/503 spectrum.test.ts      # AC1 (Linux leg: Docker)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/503 points.test.ts        # AC2 (deep-gpu)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/503 points-check.test.ts  # AC2 (deep-show, deep-gpu)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/503 background.test.ts    # AC3 (deep-gpu)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/503 formats.test.ts       # AC4
node node_modules/vitest/vitest.mjs run --root tests/acceptance/503 taste.test.ts         # AC5
node node_modules/typescript/bin/tsc -p tests/acceptance/503/tsconfig.json                # type-check (exits 0)
```

- **Builds:** each file builds what it drives once, in `beforeAll`: `cargo build --locked --bin deep-show
  --no-default-features --features full` (#501's `useShow`) and `cargo build --locked --bin deep-gpu` (#422's
  `useGpu`), honoring `CARGO_TARGET_DIR`, copied to a temporary folder.
- **Alone:** `scripts/lanes.mjs` needs `'tests/acceptance/503/'` and `'tests/acceptance/503-oracle/'` in its `alone`
  list (the files build cargo binaries, draw on the GPU and run Docker). This job writes only its two folders; the
  implementer makes that edit.
- **Needs:** macOS for AC2, AC3 and AC4 (the decode worker's codecs, the GPU layer's Metal device); `ffmpeg` and
  `ffprobe` (PATH, `/opt/homebrew/bin`, `/usr/local/bin`, or `DEEP_FFMPEG` and `DEEP_FFPROBE`) with libx264 and the
  setts filter (#499's check) for AC2 and AC3, and the encoders flac, alac, pcm_*, libmp3lame, aac, aac_at
  (AudioToolbox), libopus, vorbis and ac3 for AC4; Docker with the local image `deep-501-linux:1.99.1` for AC1's Linux
  leg (Legs that read BLOCKED).
- **Safety:** every temporary folder is removed after its test or file; the Linux leg's evidence store sits under
  `target/acceptance-503-linux/` and is removed after it; no process is stopped by name or port; no network but the
  first `cargo fetch` in the Linux image. Delete `tests/acceptance/503/node_modules/.vite` after a `--root` run.
- Every `it` passes a 3,600,000 ms timeout.

Nothing missing passes (invariant 2): a reply without a field a test reads fails naming the field; a run that answers
`bad_input`, exits non-zero or writes other than one line fails every test that drove it; BLOCKED and INCONCLUSIVE
legs fail with a line starting `BLOCKED:` or `INCONCLUSIVE:`.

## Criteria to tests

| AC | ID | File | Test, and the wrong program it fails on |
|---|---|---|---|
| 1 | `#503.385199c8` | spectrum.test.ts | (1) the 16-band bake of the fixture: 16 log bands across [40, 16000] at 60 rows a second; at 3 s band 8 at −6.02 ± 0.01 dB and every other band at −120; at 1 s every band at −120; the same bake again, and in a second process, has the same key, readings hash and rows; bands 32 / window 8192 bakes under another key; a document declaring bands 32 / window 2048 is refused at check with `spectrum_band_empty` naming exactly bands 1 and 2 (windows 8192 and 4096), the same at 16 bands is presented. (2) the bar chart: `eval`'s `spectrum.tone` at 1 s and 3 s is the bake's row exactly; each bar's height in the snapshot is its level + 120 u within 1.5 px; `determinism` at all 180 frames of the 6 s chart at 30 fps: played and seeked frames equal. (3) the bake in a linux/amd64 container: same key, readings hash, edges and every level. (4) planted `spectrum_bands_even_hz`: band 0 holds the tone, the judge fails naming band 8. (5) planted `spectrum_skips_window_norm`: band 8 reads 49.93 ± 0.01 dB, the judge fails naming band 8 |
| 2 | `#503.c6bbfb83` | points.test.ts | (1) played from 0: 307,200 points at frames 10, 45 and 80, each within 1e-4 m of the f64 unprojection of FFmpeg's decode of that frame (and frame 45 against frame 10's depths fails, naming frame 45). (2) frame 45 opened in a fresh session and seeked to from frame 10 in the same session read back the same bytes, by SHA-256, as played. (3) planted `point_video_keeps_frame_before_seek`: after the seek the points sit at frame 10's depths and the check fails naming frame 45 |
| 2 | `#503.c6bbfb83` | points-check.test.ts | (1) a 1,920 × 1,080 video at step 1 is refused by `deep show` with an error issue naming `depth`; at step 2 it is presented, and `view3d` reads back 518,400 points. (2) `spatial`: `items.depth.bounds` is x ±2.887, y ±2.071, z −5 to −1 within 1e-3; no `depth#…` row in the index or a box query; the spatial answer under 64 KiB and the evaluated frame under 256 KiB |
| 3 | `#503.d2172917` | background.test.ts | (1) at 2.5 s the 128 × 96 px centre region is within one code value of this suite's lookup of frame 75, played from 0, opened at 2.5 s and seeked to it (frames 74 and 76 differ there at 760 and 200 pixels); the sphere's interior pixels equal, byte for byte, those of the same scene with no video. (2) `background_blur: 0.5` with the video is refused, naming `background_blur`. (3) planted `video_background_prefiltered`: the sphere's pixels differ and the check fails naming `sphere` |
| 4 | `#503.89909452` | formats.test.ts | (1) WAV 8/16/24, AIFF 16/24, CAF 16/24, ALAC 16/24, FLAC 16/24: each decoded by the worker (a pid other than deep-show's) to the PCM hash of the reference decode, with its rate, channels and length. (2) MP3, AAC-LC, HE-AAC, Opus in Ogg and in WebM, Vorbis in Ogg: same rate, channels and length as FFmpeg's decode and a peak difference at or below −90 dBFS (FFmpeg's decode one sample late is beyond it). (3) AC-3 in MP4 is refused `unsupported_codec`, naming AC-3 as the probe names it. Wrong programs: the base (no decoder for most of them), a decoder off by one LSB or one sample, a refusal that names no codec |
| 5 | `#503.07910052` | taste.test.ts | the recorded taste call on exactly the check run's three pictures |

## The surface under test

`deep-show run` (#393's convention: one scenario line on stdin, one answer line `{"ok": true, "replies": [...]}`) and
`deep-gpu run` (#377's: `{"out", "calls"}` in, one answer line out), with their existing calls. No new binary,
subcommand or call. Names the issue and the design give are used as they give them; **every name marked *(chosen)*
is this job's**, taken from the design's words and shaped like the neighbouring fields. The implementer builds exactly
these, or a dispute goes to a blind redraft. Times are flicks (integers); hashes are lower-case hex.

### `deep-show run`

| Call | Request fields | Reply fields read | New or existing |
|---|---|---|---|
| `media_bake` | `bake: {asset: <sha256>, kind: "spectrum", bands, scale: "log", range: [lo, hi], rate, window}` (no `analyzer`: it is `spectrum@1`, as #500's kinds are `<kind>@1`) | `bake.kind`, `bake.rate`, `bake.bands` (`[[low, high], …]` Hz), `bake.rows` (`[{t, levels: [one per band]}]`), `bake.key`, `bake.sha256` | existing call; the kind, its fields and `rate`, `bands`, `rows`, `key` are the design's. *(chosen)*: row r's `t` is r × 705,600,000 ÷ rate, the rows from 0 in order (the design's "row ⌊t × rate⌋"); a level at the floor is exactly −120 |
| `deep show` | a document with `bakes: {tone: {asset: <sha256>, analyzer: "spectrum@1", kind: "spectrum", bands, scale, range, rate, window}}` | `outcome: "presented"`; refused: `outcome: "refused"`, `issues` | existing; `bakes` is the design's, `asset` as the asset's SHA-256 *(chosen)*, as `image@1` and `media_bake` name an asset |
| refusal at check | | an issue `{code: "spectrum_band_empty", severity: "error", bands: [{band, window}]}`, or one such issue per band with `band` and `window` *(chosen form)*: each empty band and the shortest window of 512 … 16384 that fills it | code: the design's |
| `eval` | `doc`, `t`, `pixels: true`, `arrays: ["spectrum.tone"]` | `outcome: "evaluated"`, `snapshots[0].sha256`, `arrays["spectrum.tone"]`: **a list of the band levels** *(chosen: an array of n f64 elements answers as a list; #497's scalars are unchanged)* | existing; the array's name is the design's |
| `determinism` | `doc`, `display_hz: 30`, `at_times`, `compare: "same_machine"` | `frames[].play.pixels`, `frames[].seek.pixels`, `pixel_hash` when given | existing (#488, #1897) |
| `media_decode` | `path`, `out`, `video_frames: 0` | `decoded.streams[]` of `type: "audio"`: `sample_rate`, `channels`, `file` (interleaved f32 LE under `out`); `decoded.worker.pid`; refused: **`code: "unsupported_codec"`, `codec`** at the reply's top level *(chosen place, as the worker's refusals are)* | existing; the code and `codec` "in the probe's own words" are the design's |
| `media_import` | `path` | `asset.probe.streams[]`: `type`, `codec` | existing (#498) |
| `spatial` | `doc`, `t`, `queries: [{box: {min, max}}]` | `items.depth.bounds: {min, max}`, `results[0]` | existing (#421) |
| scenario `planted` | `spectrum_bands_even_hz`, `spectrum_skips_window_norm` | | existing form, new names *(chosen)* |

### `deep-gpu run`'s `view3d`

`{call: "view3d", doc: <path>, look: <#422's plain look>, size, fps: 30, from, frames, capture: [n], targets, seeks?,
read?, assets: {<sha256>: <path>}, licenses: {<sha256>: <license>}}`, existing (#378, #380, #483, #484); a video is
named in `assets` as glTF files, images and HDRs are *(chosen)*. Each frame: `frame`, `final` (PNG), `linear` (f32
RGBA, rows top-down), `ids` with `picks` (#422's readers).

- **`read: ["depth.points"]`** *(chosen output name `points` of the item `depth`)*: each captured frame's
  `read["depth.points"] = {type: "f32", count, components: 3 | 4, file}` *(chosen form)*: `count` points, `components`
  little-endian f32 a point with x, y, z first, in the item's space, in row-major order of the sampled pixels (point i
  is pixel ((i mod cols) × step, ⌊i ÷ cols⌋ × step)), written to `<out>/<file>.f32` and named by the SHA-256 of its
  bytes, as the `linear` target is.
- **A refusal** is a reply with a string `code` and no `frames`, its other fields naming what it refuses (#426's
  reading of a sky refusal).
- **`--planted`** takes `point_video_keeps_frame_before_seek` and `video_background_prefiltered` *(chosen)*.

### The documents

| Field | As written | From |
|---|---|---|
| A depth point set | `{kind: "mark.point@1", params: {from: {video: {asset: <sha256>, frames: {start: "0s", in: 0, rate: [1, 1]}, near: 1, far: 5, fov: [60, 45], step?: 2}}}}` with `depth` left at `luma` | the issue's fields; `from: {video: {…}}` nesting *(chosen)*, as the sky's `background: {video: {asset}}` is parsed at the base |
| The showpiece | `budget: {class: "showpiece"}`, a camera at the origin looking along −Z, `assets: {depth: {sha256, license}}` | #422's castle envelope |
| A video background | `sky@1 {environment: {from: <HDR sha256>, intensity: 1}, background: {video: {asset: <sha256>, frames: {start: "0s", in: 0, rate: [1, 1]}}}}` | the issue's field |
| The bar chart | `marks@1 {mark: "rect", n: 16, columns: {x, x2: f32 data, y: {const: -120}, y2: {array: "spectrum.tone", as: "f64"}}}` | Mark set and columns; the array column is the design's form with logic columns' `as` *(chosen f64)* |

## Planted programs

| Name | Where | What it does wrong | Criterion | A failure must name |
|---|---|---|---|---|
| `spectrum_bands_even_hz` | deep-show scenario `planted` | the spectrum's band edges are spaced evenly in hertz across `range` (16 bands of 997.5 Hz), so the tone falls in band 0 | 1 | band 8 |
| `spectrum_skips_window_norm` | deep-show scenario `planted` | a band's level is 10 log10 Σ\|X_k\|², without the division by 3N²/32 | 1 | band 8 (49.93 dB) |
| `point_video_keeps_frame_before_seek` | `deep-gpu run --planted` | after a seek within a session, the point operator keeps unprojecting the frame it decoded before the seek | 2 | frame 45 |
| `video_background_prefiltered` | `deep-gpu run --planted` | the video's frame at t is prefiltered into the environment, so lighting and reflections read the video | 3 | the sphere |

## Fixtures

Nothing but text is committed. Every sound, video and image is made by the tests at run time, under temporary folders.

- **The spectrum file** (AC1): 10 s, one channel, 48 kHz, **32-bit float WAV** (#1819's writer): a 937.5 Hz sine of
  amplitude 0.5 from sample 96,000 to 192,000, silence elsewhere. 937.5 Hz is bin 40 of a 2048-sample window, 40 whole
  cycles, so a periodic Hann window puts its energy in bins 39 to 41 of band 8 and nowhere else; float keeps
  quantization noise from reaching any other band above −120 dB.
- **The depth video** (AC2): 640 × 480, 30 fps, 90 frames (3 s); frame k's Y′ at (x, y) is (x + 2y + 5k) mod 256, Cb =
  Cr = 128. **H.264** by libx264 at QP 10, **yuv420p, full range** (`pc`), BT.709 matrix and primaries, sRGB transfer,
  no B-frames, a key frame every 30 frames, time base 1/15360, no edit list (checked by ffprobe). Gray and full range,
  so the decoded 8-bit R′G′B′ is Y′ at every pixel and d = Y′ ÷ 255 under the luma formula. The 1,920 × 1,080 video is
  the same recipe, 10 frames.
- **The equirectangular video** (AC3): 1,024 × 512, 30 fps, 90 frames, the same codec, pixel format, full range and
  tags; Y′ 96 everywhere with frame n's two digits in Y′ 192 about the image's centre (24 × 40 px seven-segment digits,
  4 px strokes). Mid levels keep a filtered edge's error under a code value.
- **The still environment** (AC3): a 128 × 64 RGBE Radiance file written by the test (#426's form), a warm sky over a
  dark ground.
- **The audio files** (AC4), all by the local FFmpeg. Lossless, from integer PCM this suite writes (tones and seeded
  noise at 0.9 of full scale, the two extreme codes first), 1.5 s: WAV `pcm_u8` mono 22,050 Hz, `pcm_s16le` stereo
  44.1 kHz, `pcm_s24le` stereo 48 kHz; AIFF `pcm_s16be` stereo 44.1 kHz, `pcm_s24be` stereo 48 kHz; CAF `pcm_s16be`
  stereo 44.1 kHz, `pcm_s24le` mono 96 kHz; ALAC in MP4 (`.m4a`) at 16 bits 44.1 kHz and 24 bits 48 kHz; FLAC at 16
  bits 44.1 kHz and 24 bits 96 kHz. Each is checked to decode back, by FFmpeg, to the very integers written. Lossy, from
  3 s of stereo float at 48 kHz (tones, a sweep, seeded noise): MP3 (libmp3lame 192k), AAC-LC (FFmpeg's aac 192k, MP4),
  HE-AAC (AudioToolbox's aac_at at profile 4, 64k, MP4), Opus in Ogg and in WebM (libopus 128k), Vorbis in Ogg
  (FFmpeg's vorbis); the unlisted file is AC-3 (ac3 192k) in MP4.
- **The documents** are written by `helpers.ts` (`spectrumDocument`, `depthDocument`, `backgroundDocument`).
- **Licenses:** CC0, #501's `LICENSE`, on every asset: made at test time and deleted after.

## Legs that read BLOCKED or INCONCLUSIVE

None of these is ever a pass.

- AC1's Linux leg: BLOCKED when Docker is unreachable, when the local image `deep-501-linux:1.99.1` is missing (the
  suite pulls and builds nothing; the unblock is 501-redraft-ac10's one line: `printf 'FROM
  rust:1.99.1-slim-bookworm\nRUN apt-get update && apt-get install -y --no-install-recommends g++ libclang-dev && rm
  -rf /var/lib/apt/lists/*\n' | docker build --platform linux/amd64 -t deep-501-linux:1.99.1 -`), when the image
  doesn't run as x86_64 or lacks cargo of the channel, `cc`, `c++` or libclang, or when `cargo fetch` fails;
  INCONCLUSIVE when the emulated build or the fetch runs out of the test's hour (a warm cache in
  `target/acceptance-501-linux/`, shared with #501's leg, finishes it on a rerun) or the run doesn't answer in 15
  minutes.
- AC2, AC3, AC4: BLOCKED off macOS; BLOCKED when `view3d` answers `unsupported_platform`; BLOCKED without ffmpeg and
  ffprobe with libx264 and setts (#499's check: `brew install ffmpeg`), or without an encoder AC4 needs, or when the
  local FFmpeg can't make a fixture.
- AC5: INCONCLUSIVE without the three pictures in `docs/evidence/503/` or without a recorded call on exactly them.

## The taste call

The check run puts in `docs/evidence/503/`, each from the renderer's own output (`view3d`'s `final` targets):

- `depth-points.png`: the depth showpiece at frame 45, from a camera at (2.5, 1.5, 1) looking at (0, 0, −3), so the
  point cloud shows its depth;
- `background-360.png`: the 360° scene at 2.5 s (frame 75), the video behind the white metal sphere;
- `background-360.apng`: the 360° scene's frames 0 to 89 at 30 fps, a recording of the background playing.

They are attached to the PR and shown in the session. The call is recorded in `tests/acceptance/503/TASTE.json`:
`{issue: 503, criterion: "#503.07910052", verdict: "looks_right" | "looks_wrong", who, when (ISO 8601), screenshots:
{<name>: sha256}, note?}`. This job writes no TASTE.json and creates no picture.

## Readings where the issue and design leave a choice

- **"At its row for 3 s"** is the row whose `t` is 3 s (row 180); **"at the −120 dB floor"** is exactly −120.
  **"Band 8 (800 to 1,163 Hz)"** is also held to its edges: every band's within 0.5 Hz of 40 × 400^(k ÷ 16).
- **"Bakes under a new key"**: another key than the 16-band bake's, which itself re-checks to the same key, readings
  hash and rows in the same run and in a second process ("re-checked to an exact match").
- **"Naming bands 1 and 2"**: exactly bands 1 and 2, each with the shortest window of the list that fills it, which
  this suite computes from the band edges and bin centres: 8,192 for band 1 and 4,096 for band 2. "At check" is `deep
  show`'s check of a document declaring the bake.
- **"Puts the tone in band 0 and fails, naming band 8"**: band 0 reads above −7 dB at 3 s, and this suite's judge of
  the bake fails with a line naming band 8 (its edges, its level). **"Reads band 8 at 49.93 dB"**: within 0.01 dB.
- **"A bar chart whose 16 rows' heights read the bands"**: each bar spans from y = −120 to y2 = its band's level, so
  its height is the level + 120 u; it is read from the canonical snapshot at 1 s and 3 s, 1 u a px, within 1.5 px, and
  `eval`'s array equals the bake's row exactly. **"The same heights seeked or played at every frame"**: `determinism`
  at each of the chart's 180 frames, the played and seeked canonical renders equal.
- **"Byte for byte equal"** on Linux: the same key and readings hash, and every edge and level equal as JSON numbers
  (exact f64).
- **"Read back by the test harness"** is `view3d`'s `read`; **"within 1e-4 m"** is the Euclidean distance; **"the
  decoded frame's own value d"** is computed from FFmpeg's decode of the same file (exact by the H.264 standard) by the
  design's rule: full-range BT.709 R′G′B′ and the luma weights ÷ 255. **"Three sampled frames"**: 10, 45 and 80.
- **"Seeked or played, by hash"**: the SHA-256 of the read-back points at frame 45 played from 0, in a session opened
  at frame 45, and in a session seeking from frame 10 to 45, all equal. The plant shows only in the last.
- **"Refused at check in a showpiece, naming the item"**: `deep show` refuses the document with an error issue naming
  `depth` in its `ids` or `path`; "checks" is presented, and `view3d` then draws 518,400 points.
- **"Evaluated data holds its bounds … and none of its points"**: `spatial`'s world bounds of the set within 1e-3 m of
  near, far and fov's box, the set one item with no rows in the index, and neither `spatial`'s answer nor `eval`'s
  frame large enough to hold 307,200 positions (64 KiB and 256 KiB).
- **"From a camera looking along the video's centre direction"**: at the origin looking along −Z, the direction the
  base's equirectangular convention (u = atan2(x, −z) ÷ 2π + 0.5, v = acos(y) ÷ π) puts at the image's centre; fov 60°
  across the wider side of 320 × 240 (#378's pinhole). **"A centre region"**: 128 × 96 px about the view's centre,
  which holds both digits and no item. **"Within 1 code value"**: each channel of the linear target, encoded as 8-bit
  sRGB, against the lookup's code; the lookup samples bilinearly in linear light along the pixel's centre ray, u
  wrapping and v clamped (the base commit's sentence). **"Played or seeked"**: played from 0, opened at 2.5 s, and
  seeked to it from 0.33 s in one session.
- **"Reflects the still environment byte for byte as with no video"**: the same scene with `background` left out (the
  HDR then draws behind it), frame 75 of each; the sphere's pixels 3 px inside its silhouette (the IDs target) equal in
  the linear target's RGB bytes and the final target's RGBA bytes.
- **"Refused at check, naming the field"**: `view3d`'s refusal names `background_blur` (the base's sky check refuses it
  already).
- **"PCM hashes equal to the reference decode"**: SHA-256 of the worker's interleaved little-endian f32 against that
  of the integers this suite wrote, each ÷ 2^(depth − 1) (8-bit WAV: the byte less 128, ÷ 128), with the rate,
  channels and length equal. **"Within −90 dBFS of FFmpeg's decode"**: the peak per-sample difference from FFmpeg's
  decode of the same file (its default decoder, f32, at the stream's own rate) at or below −90 dBFS (10^(−90 ÷ 20) of
  full scale, about one 16-bit step), after the rate, channels and length are equal; this is how #501's AC10 reads a
  difference "in dBFS". **"In the worker on macOS"**: the decoding pid differs from deep-show's, off macOS BLOCKED.
- **"An unlisted format … naming its codec"**: AC-3 in MP4; the refusal's `codec` names AC-3, and equals the probe's
  `codec` when `media_import` answers a probe.

## Not tested, and why

In the Scope or design but in no criterion: the points' colour (the taste call shows it), `depth: r`, `step` other
than 1 and 2, another class refused, an export of the points, `frames` other than start 0, `background_ground` with a
video, the background at another rotation or intensity, `scale: mel`, `range` and `rate` other than the criterion's,
rings reading the bands, a driver var reading `spectrum.<id>[i]`, `column.source@1` by name, decoding on Linux or in
the web player (criterion 4 reads macOS), Opus's fixed-point form by itself, the costs. They are follow-ups for the
implementer's own tests.

## Not settled

- **The depth fixture's d** is read from FFmpeg's decode, not from the worker's: the worker's `media_decode` with
  `format: "bgra"` gives the same picture for a gray full-range video, and the H.264 decode is exact by the standard,
  so either reads the same d; FFmpeg's leaves the reference outside the code under test.
- **"Within −90 dBFS"** could be read as the difference's level (RMS) rather than its peak. The peak is the stricter
  reading and the one this repository's suites already use; each failure prints the peak so a dispute has the number.
