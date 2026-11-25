# Acceptance tests for #1488: photos that look right: orientation applied, JPEG in the worker, other stills converted at intake

Written first, blind, from issue #1488 (its body as of 2026-11-22T18:03:30Z, no comments: problem, Scope, six
acceptance criteria, Proof, Not in scope and Depends on), the design sections it links and those they lean on, and the
base commit `5fcfb690b` ("Merge pull request #3079 …", origin/main), by a job that never saw an implementation; none
existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding).

## What was read

- The issue, and the bodies of its epic #241 and dependency #1485. The criteria's IDs were computed from the live body
  as `scripts/proof-change.mjs`'s `criterionId` does.
- `docs/canvas-primitives.md` (`node scripts/design-section.mjs --issue 1488`): Asset (`probe`, `decoder`, `made_by:
  {tool, version, model, input, prompt, edit_of, cost, synthetic, output}`; "It can never: … be decoded outside the
  worker, except a still image …"), Image `image@1` ("EXIF orientation applies on decode, other still formats convert
  to PNG at intake with the source kept in `made_by`"; the decode caps; "Size comes from the probe"), Image `image@1`:
  video frames, and Decode worker (`caps: {max_bytes, max_duration: s, max_pixels}`, the sandbox).
- `docs/technical-design.md`: How we know version 0 works (Criteria to tests, both ways; Wrong programs; Dogfooding;
  the taste calls) and the threat row "Media files that attack their parser".
- AGENTS.md.
- At the base, for surfaces only: `crates/deep-codecs/src/lib.rs` (`run`, `format`, `probe`, `decode`, `serve`, `Caps`,
  `Planted`) and `mp4.rs`; `crates/deep-images/src/source.rs` (`header`, `decode`); `crates/deep-show/src/media.rs`
  (the media calls, `worker_planted`), `main.rs` (the scenario's `planted`, `decode_caps`), `video.rs`,
  `export/web.rs` (`web_levels`); `crates/deep-marks-render/src/lib.rs` (`raster`, `render` and their `planted`),
  `asset.rs`, `macos.rs` (`videos`: the live player decodes to the item's box); `scripts/lanes.mjs` (the lane file);
  and the suites `tests/acceptance/498/decode/`, `499/video/`, `1485/`, `1486/` and `1489/`, whose helpers this suite
  imports (below).

## What the base does

Run at the base with this suite (`BASE-FAILURE.txt`): the decode worker refuses a JPEG and a WebP `{"refused":
{"code": "unreadable", "why": "not a format the worker reads"}}`; the image service reads a JPEG's size from its header
and decodes it without its EXIF orientation, so `raster`, `render` and `deep-show`'s snapshot all draw the phone photo
lying 200 × 100 across its box; an MP4's probe reports its coded size and both video draw paths draw its frames
unturned. Nothing converts a still at intake or writes `made_by` for one, and neither binary knows the plant
`decoder_ignores_orientation` (`deep-show run` answers `{"ok": false, "code": "bad_input"}`). Damaged MP4s answer
`error`s from the decode (`sample 3 didn't decode`, `the decoder answered -12909`), and a WebP cut to 4 bytes hits a
decoder panic the worker catches (`the decoder failed on the file`); the image service drew or refused every damaged
JPEG without a crash.

## Run them

```sh
npm ci --ignore-scripts         # once, if node_modules is missing
PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH" CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  scripts/lease npx vitest run --root tests/acceptance/1488 --no-file-parallelism --testTimeout=600000 --hookTimeout=600000 --silent=false
npx tsc -p tests/acceptance/1488/tsconfig.json   # type-check
```

- **Builds.** Each file builds what it drives once, with #499's `useBinary`: `cargo build --locked --bin deep-show`
  and, for `orientation`, `clip` and `sweep`, `cargo build --locked --bin deep-canvas-render` (debug), copied out of
  `target/debug` so another build can't replace it mid-run; a build that fails fails each test, naming cargo's words.
  No workspace package is built.
- **Machines.** macOS: the worker's still and video decoders and GPUI's offscreen Metal renderer are the platform's.
  Elsewhere the files that draw or decode video fail `BLOCKED:`, and the rest fail where the platform's decoder is
  missing; none passes. Nothing here is timed.
- **Time.** At the base the six files took 199 s in all (one file at a time, binaries already built) at a one-minute
  load of 171 to 257 on 18 cores; `sweep.test.ts` took 82 s of it. A fresh worktree's first builds take far longer.
- **Tools on this Mac, for fixtures only**: ffmpeg and ffprobe (#499's finder: PATH, `/opt/homebrew/bin`,
  `/usr/local/bin` or `DEEP_FFMPEG`/`DEEP_FFPROBE`; missing: `BLOCKED: … brew install ffmpeg`) and cwebp (PATH,
  `/opt/homebrew/bin`, `/usr/local/bin` or `DEEP_CWEBP`; missing: `BLOCKED: … brew install webp`).
- **Folders.** Fixtures, stores and outputs go under the OS temp folder (`deep-499-1488-*`, #499's `useTemp`) and are
  deleted after each test. `taste.test.ts` writes its two screenshots to `docs/evidence/1488/` (The taste call). A run
  with `--root` leaves Vitest's cache in `tests/acceptance/1488/node_modules/.vite`; delete it.
- **`--silent=false`** shows what the tests print (AC4's seed, truncation points and flip offsets; AC6's hashes),
  which this Vitest otherwise keeps for failed tests only.
- **Lanes.** `lane.json` in this folder runs it alone (#1327's lane file): every file builds a cargo binary and starts
  decode workers. No `scripts/lanes.mjs` line is needed (see What the implementer adds).

## The surface under test

The issue names a probe, a decode, a draw on every path, an intake, a sweep, caps and a clip, but no API. These tests
use the two binaries that already carry those parts, with the smallest additions: `deep-show run` (#393's scenarios;
#498's decode-worker calls; #499's documents and `eval` snapshots) and `deep-canvas-render` (`raster`, `render`). No new
binary, subcommand or call. Every name marked *(chosen)* is this job's; the implementer builds exactly these, or a
dispute goes to a blind redraft.

### `deep-show run`

`{"evidence": dir, "decode_caps"?: {max_bytes, max_duration: s, max_pixels}, "planted"?, "calls": [...]}`, plus #499's
`sessions`, `processes`, `panels`, `docs` for presenting a board. One answer line `{"ok": true, "replies": [...]}`.

| Call | What the tests send and read | Criteria |
|---|---|---|
| `media_import {path}` *(base, #498)* | `asset.kind`, `asset.sha256`, `asset.probe.streams[]`: an `image` stream's `size: [w, h]` px and `color: {primaries, transfer, matrix, range, assumed: [field]}`; a `video` stream's `size` and `duration: [ticks, timescale]`; `worker.pid`; or `refused: {code}` | AC1, AC2, AC3, AC4, AC5 |
| `media_import` of a JPEG, `size` *(chosen)* | the size shown after its EXIF orientation: 100 × 200 for orientation 6 on 200 × 100 stored | AC1 |
| `media_import` of an MP4, `size` *(chosen)* | the size shown after the track header's matrix: [96, 160] for a 160 × 96 track turned a quarter | AC5 |
| `media_import` of a WebP *(chosen)* | the intake: `asset` is the PNG it made: `asset.sha256` names a PNG kept in `evidence` (`<aa>/<62 hex>`, #498's split store) under that hash; `asset.made_by` *(chosen fields, Asset's)*: `input` the WebP's SHA-256, whose bytes `evidence` keeps under it, and `tool` and `version` (non-empty strings) the converter | AC3, AC4 |
| `media_decode {path, out, format: "bgra"}` *(base, #498)* | `decoded.streams[0]`: `size`, `frames[0].file` under `out`: BGRA8, rows top-down, no padding; or `refused` | AC1, AC4 |
| `media_decode` of a JPEG *(chosen)* | the pixels turned by the orientation, `size` [100, 200] | AC1 |
| `workers` *(base, #498)* | a `decode_worker` with `pid` the import's `worker.pid` and a `probe` job on the file's hash | AC2 |
| `deep show` then `eval {doc, t, pixels: true}` *(base, #499)* | the canonical snapshot, a PNG of the board's size in `evidence`, named by `snapshots[0].sha256` | AC1, AC5, AC6 |
| scenario `planted: "decoder_ignores_orientation"` *(chosen)* | the wrong program below, in the worker and in the image service the snapshot draws through | AC1 |
| scenario `decode_caps` *(base, #498)* | the caps the sweep's runs set: 1,048,576 B, 2 s, 40,000 px | AC4 |

A **refusal** is `{"refused": {"code": string, …}}` (base). An `{"error": …}` reply, `the decode_worker process … ended`,
or a run that exits other than 0 or stops answering is a crash.

### `deep-canvas-render`

| Subcommand | Request; what is read | Criteria |
|---|---|---|
| `raster` *(base)* | `{out, doc, look, store}` (a flat store, `<sha256>` files): the canonical Vello CPU render, a PNG of the board at zoom 1; `{"ok": false, "code"}` is a refusal | AC1, AC4 |
| `render` *(base)* | `{out, doc, look, view: {zoom: 1, theme: "light"}, t, store}`: GPUI's offscreen Metal render, the live view's renderer (`frames`, `live` and `session` draw through it too) | AC1, AC5 |
| `raster`, `render` `planted: "decoder_ignores_orientation"` *(chosen)* | the wrong program below | AC1 |

### Documents

#391's board (#499's `documentOf`, with `assets: {name: {sha256, license}}`): 240 × 240 u, one `image@1` in the box
[20, 20, 200, 200], `fit: contain`, its `asset` the fixture's SHA-256. A picture upright 100 × 200 stands at [70, 20,
100, 200]; the clip upright 96 × 160 at [60, 20, 120, 200]; ground lies left and right of each. A clip carries `frames:
{start: "0s", in: 0, rate: [1, 1]}` (#499). On `render` the clip is `fit: fill` in [60, 20, 120, 200] (AC5, below).

### The wrong program

| Name | Where | The wrong program | Test |
|---|---|---|---|
| `decoder_ignores_orientation` *(chosen)* | `deep-show run`'s scenario `planted` (the worker's decode and the snapshot's image service); `raster`'s and `render`'s `planted` (the image service) | every still decoder ignores the EXIF orientation: pixels come out as stored. The probe may stay honest | AC1's second test: every path that draws the photo must fail on a corner pixel |

AC2's wrong program is the merge base itself (`BASE-FAILURE.txt`). AC3, AC4 and AC5 name none; the base fails each.

## Fixtures

Made at test time, none committed. Four flat quarters make every corner unambiguous: stored top-left red (220, 50, 50),
top-right green (50, 180, 70), bottom-left blue (50, 80, 220), bottom-right yellow (235, 205, 40). Turned a quarter
clockwise (orientation 6; the matrix below), the upright picture has blue top-left, red top-right, green bottom-right
and yellow bottom-left: the stored top row runs down the right edge.

| Fixture | How | Checked |
|---|---|---|
| the phone photo (AC1, AC4), 2,070 B | #1486's baseline JPEG encoder (4:2:0, quality 90) on 208 × 112 quarters padded from 200 × 100; its frame header set to 200 × 100 (the padding is the blocks every decoder crops); its JFIF APP0 replaced by an EXIF APP1 holding one IFD0 entry, Orientation (0x0112, SHORT) = 6, big-endian | ffmpeg decodes it 200 × 100 with the stored quarters (`-noautorotate`) and, by its tag, 100 × 200 upright; this Mac's ImageIO read Orientation 6 while the suite was written |
| the plain JPEG (AC2) | #1486's encoder, 160 × 96 quarters, JFIF, no EXIF | |
| the WebP (AC3, AC4), 82 B | the 120 × 80 quarters as a PNG (#1486's writer), then `cwebp -quiet -lossless -metadata none` | RIFF WEBP |
| the turned clip (AC4, AC5), 1,717 B | 10 frames at 10 fps of 160 × 96 quarters, converted here to limited-range BT.709 I420, libx264 QP 10, no B-frames, one thread, tagged BT.709 with the sRGB transfer; then `ffmpeg -display_rotation:v:0 -90 -i … -c copy` | the track header's matrix is (a, b, c, d) = (0, 1, −1, 0) and its size 160 × 96; ffmpeg shows it 96 × 160 upright by its tag |
| the taste document's photo and clip (AC6) | a scene drawn upright here (sky, a sun to the top right, green ground, a red arrow pointing up; in the clip a white ball rising), stored a quarter turn the other way: the photo 320 × 240 stored with orientation 6 (240 × 320 upright), the clip 256 × 192 coded with the same matrix (192 × 256 upright) | the clip's track matrix, as above; no criterion reads these pictures |

## Criteria to tests

Each test's name starts `AC<n> #1488.<h8>`, the criterion's ID.

| ID | Criterion | Test, and the wrong program it fails on |
|---|---|---|
| AC1 `#1488.a31e7537` | A JPEG with orientation 6 and a 200 × 100 stored size reports 100 × 200 and draws its top row on the right edge on every path. A planted decoder that ignores the tag fails on the corner pixel | `orientation.test.ts` (2). One: the photo on every path (Readings): the worker's probe reports `size` [100, 200]; its decode answers [100, 200] and each corner of the BGRA, 8 px in, is its upright quarter; `deep-show`'s snapshot, `raster` and `render` each draw the board with each corner of [70, 20, 100, 200], 8 px in, its upright quarter (nearest of the four, within 48 per channel) and the ground at (45, 120) and (195, 120). Two: the same paths with `decoder_ignores_orientation`: each of the four that draw must fail on a corner pixel (a failure naming the corner, its pixel, what it shows and what the upright picture has). Wrong programs: the base (refused in the worker; drawn lying across the box), the plant |
| AC2 `#1488.3ac65184` | A JPEG probes in the worker with `size` and color tags. The merge base refuses it as `unreadable` and fails | `probe.test.ts` (1): `media_import` of the plain JPEG is no refusal; its asset is an `image` by the file's hash whose `image` stream has `size` [160, 96] and `color` with `primaries`, `transfer`, `matrix`, `range` named and `assumed` listing only those fields; `worker.pid` is a `decode_worker` that `workers` lists with a `probe` job on the file's hash. Wrong program: the merge base, which refuses it `unreadable` |
| AC3 `#1488.b1cba5dc` | A WebP becomes a PNG asset by hash with its source named, and two imports give one hash | `intake.test.ts` (1): `media_import` of the WebP in two runs, each its own process and evidence store. The first's asset is an `image` whose `sha256` isn't the WebP's and names a file in the store hashing to it, a PNG of 120 × 80 whose corners are the WebP's quarters; `made_by.input` is the WebP's SHA-256, kept in the store; `made_by.tool` and `version` are named. The second gives the same `sha256`. Wrong program: the base (refused `unreadable`) |
| AC4 `#1488.5b4cd96d` | 40 truncations and 300 seeded four-bit flips of each format fixture give a refusal or an image, never a crash and never past the caps | `sweep.test.ts` (1): seed 1488 (mulberry32); for the photo JPEG, the WebP and the turned MP4, the 40 truncations to ⌊L × k / 41⌋ B (k = 1 … 40) and 300 flips of four adjacent bits from a seeded bit offset in [0, 8L − 4), all printed. Each mutant through `media_import` and `media_decode` (BGRA) under `decode_caps` {1,048,576 B, 2 s, 40,000 px}, 85 mutants a run; the JPEG's also as image@1 through `raster` (the in-process image service). Every answer a refusal or an image; no probe size over 40,000 px or duration over 2 s, no decoded stream over 40,000 px, no frame file over 160,000 B, no intake PNG over 40,000 px; no `error`, ended worker, non-zero exit or missing answer. Each unmutated fixture must first be imported as an image, the JPEG and the MP4 also decoded to a picture and the JPEG drawn by `raster` (a decode of the WebP itself may be refused: its import is the intake's decode). Wrong program: the base (the JPEG and WebP fixtures refused, so the sweep can't count; MP4 mutants answer `error`) |
| AC5 `#1488.a52e928a` | A clip tagged rotation 90 shows upright with width and height swapped | `clip.test.ts` (1): the turned clip's probe reports the video's `size` [96, 160]; at 0.45 s (frame 4) `deep-show`'s snapshot draws it `fit: contain` with each corner of [60, 20, 120, 200] its upright quarter and ground at (40, 120) and (200, 120); `render` draws it `fit: fill` in [60, 20, 120, 200] with each corner its upright quarter. Wrong program: the base (coded size; frames drawn unturned) |
| AC6 `#1488.0776f3d0` | Shown to you: screenshots of a rotated phone photo and a rotated clip, taken by the check run from the fixture document, are attached to the PR and shown to you in the session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it | `taste.test.ts` (1): the check run (The taste call) draws the fixture document and writes the two screenshots, then reads `TASTE.json`: none, or a call on other pictures, fails `INCONCLUSIVE:`; `looks_wrong` fails; `looks_right` on exactly this run's pictures passes. It judges no picture, and no other test reads these. Wrong programs: the base (it draws the document with both lying on their sides, and with no call recorded the run is INCONCLUSIVE; a call on these pictures would have to say `looks_wrong`), any run without a recorded call |

## Readings where the issue leaves a choice

- **"Every path" (AC1)** is the decode worker (its probe and its decode, where the Scope applies orientation "on decode"
  and adds JPEG) and the three binaries that draw image@1 through the image service: `deep-show`'s canonical snapshot,
  `raster` (Vello CPU) and `render` (GPUI; `frames`, `live` and `session` share its renderer and the service). Two draw
  paths aren't driven: the web player, which draws the levels the web export makes natively with the same service
  (`deep-show` `export/web.rs`, `web_levels`) and would need a browser, and the app's chrome thumbnails
  (`crates/deep-app/src/images.rs`), which need the app's window. The Not in scope line bounds formats there, not
  orientation; see Known limits.
- **"Reports 100 × 200"** is the probe's `size` (Image: "Size comes from the probe, so layout never waits on pixels") and
  the decode's `size`; on the draw paths it is read through layout: `fit: contain` in a square box gives a portrait
  picture with ground beside it.
- **"Draws its top row on the right edge"** is read at all four corners of where the upright picture lies: the stored
  top-left at the top-right, the stored top-right at the bottom-right (the top row's two ends), and the other two
  corners likewise, each 8 px in (a 3 × 3 mean), by the nearest of the four colors within 48 per channel. "Fails on the
  corner pixel" is a failure naming a corner and its pixel.
- **The plant (AC1)** reaches every still decoder a path uses, so each path's own check is shown to fail on it; the
  probe isn't a decoder and isn't read under it.
- **"Probes in the worker" (AC2)** is the reply's `worker.pid` being a `decode_worker` that `workers` lists with a
  `probe` job on the file, #498's reading. **"Color tags"** are the four fields and `assumed` (#498's shape, which the
  worker's PNG probe has); their values for an untagged JPEG aren't the criterion's and aren't read.
- **The converted asset (AC3)** is what `media_import` answers for the WebP: the PNG by its hash, kept in the run's
  evidence store; its source is named in Asset's own `made_by` fields, `input` holding the source's SHA-256 with the
  source kept under it, `tool` and `version` naming the converter. "Through the platform's decoder" (Scope) isn't
  read: no criterion states it. **"Two imports give one hash"** is two runs, each its own worker and store, so no cache
  can make them agree.
- **"Each format fixture" (AC4)** is one fixture of each still and video format this suite uses: JPEG, WebP and MP4.
  PNG, a format the worker read before, is no fixture here. **"Four-bit flip"** is four adjacent bits XORed from a
  seeded bit offset. **"A refusal or an image"**: a refusal is `refused.code` (on `raster`, `ok: false` with a `code`);
  an image is an asset with its probe, decoded streams (any number of frames), or `raster`'s `ok: true`; an `error`
  reply, the decoder panic the base catches among them, is neither. **"Never past the caps"** is read against the caps
  the run sets, on what an answer reports and what it writes or keeps. The in-process image service has fixed caps no
  run sets, so `raster` is read for refusal-or-image and no crash only. Each fixture must first give an image (the
  WebP by its import, which is the intake's decode), so a reader that refuses everything can't pass.
- **"Rotation 90" (AC5)** is the track header's matrix (0, 1, −1, 0), a quarter turn clockwise: what a phone writes for
  a portrait recording and what the legacy `rotate` tag calls 90 (ffmpeg's display matrix, counting counter-clockwise,
  calls it −90). The fixture is made with `-display_rotation -90` and its matrix checked. **"Shows upright with width
  and height swapped"** is the probe's `size` [96, 160], the canonical snapshot's corners and portrait extent under
  `fit: contain`, and the live render's corners. The live view's video player decodes to its item's box and fills it
  whatever `fit` says at the base (#499's surface, `macos.rs` `videos`), so the live render is given the box contain
  would give it, `fit: fill`, and read for upright only.
- **AC6's screenshots** are two canonical snapshots of one fixture document holding the photo and the clip, at 0.1 s
  and 0.8 s so the clip's ball is seen to rise: canonical renders repeat bit for bit, so a recorded call stands while
  the run draws the same bytes.

## The taste call

The check run (`taste.test.ts`) writes, from the fixture document's canonical snapshots (PNG, the bytes `eval` stores):

| File | What |
|---|---|
| `docs/evidence/1488/photo-and-clip-0.1s.png` | the board at 0.1 s: the photo (240 × 320 upright, left) and the clip (drawn 240 × 320, right), 540 × 360 |
| `docs/evidence/1488/photo-and-clip-0.8s.png` | the same board at 0.8 s: the clip's ball higher |

It prints each file's SHA-256. To record the call: run the suite, attach the two files to the PR, show them to the owner
in the session, and write `tests/acceptance/1488/TASTE.json`:

```json
{ "issue": 1488, "criterion": "#1488.0776f3d0", "verdict": "looks_right", "who": "…", "when": "2026-11-23T09:00:00Z",
  "screenshots": { "photo-and-clip-0.1s.png": "<sha256>", "photo-and-clip-0.8s.png": "<sha256>" }, "note": "…" }
```

`verdict` is `looks_right` or `looks_wrong`. The call stands while this run's pictures hash to what it names; another
run's pictures (another machine's ffmpeg, a changed renderer) need a new call.

## Known limits

- The web player and the app's chrome thumbnails aren't driven (Readings), nor `frames`, `live` and `session` apart
  from `render`'s renderer.
- HEIC and the other still formats the Scope converts aren't fixtures: AC3 names WebP. Whether the conversion runs
  "through the platform's decoder" isn't read.
- AC4's `raster` leg reads no caps (the service's are fixed: 64 MiB, a 16-bit side), and its mutants are the JPEG's only:
  the draw path reads no WebP or MP4 stills (Not in scope).
- The fixtures depend on this Mac's ffmpeg (libx264) and cwebp; another version may encode other bytes. No criterion
  reads a hash of them, but AC6's pictures, and so a recorded call, are tied to the bytes.
- Off macOS nothing passes: the tests fail `BLOCKED:`.

## What the implementer adds outside this folder

- The decode worker (`crates/deep-codecs`): JPEG in `format`, the probe (`size` after the EXIF orientation, `color`
  tags) and the decode (pixels turned); at intake (`media_import`), any other still converted to a PNG by hash, kept in
  the evidence store with its source, and the reply's `asset` that PNG with `made_by: {tool, version, input}`; the MP4
  track header's matrix applied to the probe's `size`; refusals, not `error`s, for the sweep's mutants.
- The image service (`crates/deep-images`) and both video draw paths (`crates/deep-show/src/video.rs`,
  `crates/deep-marks-render/src/video.rs` and the live player): orientation and the track's turn applied.
- The plant `decoder_ignores_orientation`: in `deep-show`'s scenario `planted` (reaching the worker, as
  `worker_planted` does, and the snapshot's image service) and in `deep-canvas-render`'s `raster` and `render`.
- `docs/evidence/1488/`: the two screenshots `taste.test.ts` writes, attached to the PR; then `TASTE.json` in this
  folder with the owner's call.
- No `scripts/lanes.mjs` line for running alone (`lane.json` here does it). If `sweep.test.ts` runs over two minutes
  where it is recorded, `scripts/lanes.mjs` needs `slow.push('tests/acceptance/1488/sweep.test.ts');`.

## Files

| File | What |
|---|---|
| `README.md` | this |
| `helpers.ts` | the fixtures, the PNG reader, the corner reading, `deep-show run` and `deep-canvas-render` driven without stopping at the first failure; imports #1486's JPEG encoder and PNG writer and #499's builds, documents, store, ffmpeg finder and seeded generator, unchanged |
| `orientation.test.ts` | AC1 (2 tests) |
| `probe.test.ts` | AC2 |
| `intake.test.ts` | AC3 |
| `sweep.test.ts` | AC4 |
| `clip.test.ts` | AC5 |
| `taste.test.ts` | AC6 |
| `lane.json` | runs the folder alone |
| `tsconfig.json` | the type-check |
| `BASE-FAILURE.txt` | the run at the base |
