# Blind redraft: #499 AC3, its push clause

A blind job wrote this from issue #499, the design and base commit `f1e8736e` ("Merge pull request #1742 …"). It never
saw an implementation, and it read no other branch, worktree, PR or `tests/acceptance/499` folder. It redrafts one
clause of AC3 (`AC3 #499.65f30d78`). The full criterion:

> A 30 fps recording placed as an image with start 2 s, in 1 s and rate 2 shows source frame 90 at 3 s and frame 120 at
> 3.5 s by decoded-frame hash, whether played or seeked; a crop channel that runs from the full frame to its top-left
> quarter over 1 s shows exactly that quarter at its end; and a 2D shot that pushes 2× onto the recording keeps a cursor
> ring keyed at a recorded click's image anchor within 0.5 px of the click's pixel through the whole push

This redraft covers only the last clause, "a 2D shot that pushes 2× … through the whole push". Frames 90 and 120 and
the crop are not in it. The implementer doesn't edit these files (AGENTS.md, Proof).

## What was read

- The issue, live (`gh issue view 499 --repo windoliver/deepbuild`): Scope ("An image can play a video's frames …, so
  the camera, masks, mattes, passes and callouts reach a recording"), the Image `image@1`: video frames field, and AC3.
- `docs/canvas-primitives.md`:
  - Time and the flick (9).
  - Item and kind (323): `at.anchor: ID#anchor`, "with an anchor, pos offsets from that point".
  - Item and kind: relations (375).
  - Image `image@1` (1791): `box`, `fit`, `anchors` as "fractions of the image, 0..1".
  - Image `image@1`: video frames (1812): "the camera and shots reach it, and marks laid over it stay registered while
    the camera moves".
  - Camera `camera@1` (4428): in 2D, "its `target` and `view_width` are in u with y down".
  - Shot (4513): the push and `by`, quoted below.
  - Sound and video on the picture's clock and its Asset (7101, 7107).
- `docs/technical-design.md`: Media asset (1913), Dogfooding (2623), Tests written first (2654).
- At the base:
  - `tests/acceptance/493/`: its README, `helpers.ts` (scenario, `deep show`, `eval` with `pixels`, PNG from the
    evidence store) and `seal.test.ts` (a 2D push).
  - `tests/acceptance/498/decode/`: README and helpers (`media_import`, ffmpeg fixtures, `BLOCKED:`).
  - In the code: `crates/deep-show/src/film.rs` (`view`: the 2D pose's affine), `media.rs` (`media_import`),
    `main.rs` (`eval`'s fields), and `crates/deep-canvas-marks/src/scene.rs` (`image@1`'s params, `circle@1` with
    `inner_r`).
  - `crates/deep-canvas-marks/looks/clean.json`: the ground is white and the accent is `#1aa3c8`.
  - `scripts/proof-change.mjs`, for the criterion ID.

## The push, as the design defines it

Shot: "`push` comes in from (1 + `by`) times the framed distance, or view width in an orthographic view", and "Each
shot has one framed pose: its explicit pose, or a fit of its kept items". So "pushes 2×" is `by: 1`. The push starts
at twice the framed view width and lands on the framed one. The shot gives an explicit framed pose (`target`,
`view_width`), so the expected framing needs no fit. The target stays put and only the view width changes. A page point
p is drawn at `frame centre + (p − target) × s`, where `s = 1920 ÷ view width`:

- s = 0.8 at the push's start (view width 2400 u);
- s = 1.6 at its end (the framed 1200 u).

The design gives the ease (`in_out_cubic`) but not the space the view width moves in, linear or log. So between the two
ends the test asks only for this:

- the click's pixel stays on the line from the frame's centre;
- its scale stays within [0.8, 1.6];
- the scale never moves back.

## The surface

No new binary or call. The suite uses `deep-show run` and the calls the base already has. What it adds is a document
that shows a video through `image@1`.

The scenario has an evidence store and one 1920 × 1080 panel. Its calls, in order:

1. `{"call": "media_import", "path"}` (#498): the recording is probed. The reply's `asset.sha256` must be the file's
   hash and `asset.kind` must be `"video"`. The test also puts the file's bytes into the evidence store at its SHA-256,
   as the hub keeps assets (#1162).
2. `{"call": "deep show", peer, doc, document, include: ["issues"]}`, with the payload carrying no `layers` or `layer`.
   The reply's `outcome` must be `"presented"`.
3. `{"call": "eval", doc, t, pixels: true}` for each time. The reply's `outcome` must be `"evaluated"` and it must hold
   one entry in `snapshots`. That entry has `sha256`, `w` and `h`, and its PNG is in the evidence store at that
   SHA-256. It must be drawn at the document's size, 1920 × 1080.

The document (`profile: "film"`, `size: [1920, 1080]`, `camera: "cam"`, `transport: {span: "2s"}`, 60 fps by
default):

| Item or field | As written |
|---|---|
| `assets.recording` | `{sha256, license: {id: "CC0-1.0", …}}` |
| `cam` | `camera@1 {projection: orthographic, target: [960, 540, 0], view_width: 1920}` |
| `rec` | `image@1 {asset: <sha256 of the MP4>, alt, box: [480, 270, 960, 540], fit: fill, frames: {start: "0s"}, anchors: {click: [408/640, 216/360], beside: [409/640, 216/360]}}`, `at.pos [0, 0, 0]`, order `b0` |
| `ring` | `circle@1 {center: [0, 0], r: 30, inner_r: 22, paint: {fill: {role: accent}}}`, `at: {anchor: "rec#click", pos: [0, 0, 0]}`, order `c0` |
| `shots.push` | `{start: "0.5s", end: "1.5s", camera: "cam", move: "push", by: 1, target: [960, 540, 0], view_width: 1200}` |

The implementer must build these:

- An `image@1` whose asset is a video draws that video's frame at t, under the camera and shots.
- Its `anchors` resolve through `at.anchor: "<image>#<anchor>"` as fractions of the image's drawn box, and follow the
  image under the camera.
- `eval` draws all of this into the canonical snapshot.

## The fixture

The recording is made with ffmpeg at test time in each test's temporary folder. Nothing is committed.

- 640 × 360, 30 fps, 2 s. H.264 (libx264, QP 10, no B-frames, GOP 30, yuv420p, untagged) in an MP4.
- A dark neutral screen (`0x202020`) with the recorded click's mark: a light neutral (`0xC0C0C0`) 16 × 16 square at
  source px [400, 416) × [208, 224), in every frame. Its centre (408, 216) is the `click` anchor.
- Both colors are neutral and the mark fills one whole 16 px block, so neither chroma subsampling nor the encoder's
  blocks can move its centre.
- The test checks with ffmpeg that the fixture came out that way: the colors are neutral and the mark is more than
  100 code values over the screen, in the first and last frames.

## Reading the pixels

Every finder works inside one window: the recording's rectangle at the push's start (s = 0.8), 4 px in from its edges
(px x ∈ [580, 1340), y ∈ [328, 752)). The recording is centred on the target, so through a push it only grows. That
means the window lies on the recording in every frame, and the white ground or anything else outside the recording
never enters it.

The window is also checked. At least 90% of its pixels must be neutral, within 6 code values of their median level, and
that median must be dark (≤ 80). A window that caught the white ground fails here, by name.

- **The click's pixel** is the weighted centroid of the neutral pixels (channels within 12 code values of each other).
  Each weighs (level − screen) ÷ (brightest − screen); weights under 0.1 count as 0. The ring is colored, so it adds
  nothing.
- **The ring's centre** is the weighted centroid of chroma (largest channel − smallest) ÷ the window's largest chroma,
  with weights under 0.1 counting as 0. The recording and the ground are neutral, so only the ring weighs.
- **Compactness.** Each mark must be compact: no counted pixel farther from its centroid than the mark's half-diagonal
  (or the ring's outer radius) at s = 1.6, plus 3 px. So nothing stray is taken for either.
- **Accuracy.** A scratch check (not committed) used this fixture, scaled by ffmpeg's bilinear to 0.8–1.6 and placed on
  white, with an analytic antialiased ring 0.3 px off. The finders read both centres within 0.07 px, and the window
  check raised nothing.

## The tests (`push-redraft.test.ts`)

1. **The clause.** The frames are each 60 fps frame in [0.5 s, 1.5 s), plus 1.5 s − 1 flick, where the push has landed.
   That is 61 frames.
   - In every frame, the ring's centre is within 0.5 px (Euclidean) of the click's pixel.
   - The push is the design's 2×: the click's pixel is within 0.5 px of (1065.6, 583.2) at the first frame and of
     (1171.2, 626.4) at the last.
   - Between them, it stays within 0.5 px of the push's line, at a scale in [0.8, 1.6] that never moves back.
2. **The planted twin.** The same film with the ring keyed at `rec#beside`, one source pixel (1.5 u) right of the
   click: 1.2 px on screen at the start and 2.4 px at the end. Drawn at the first and last frames, it passes the window
   check but fails the clause's check, naming both frames. This shows the 0.5 px check and the finders tell a
   one-pixel misregistration apart.

## Run

```sh
npm ci   # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/499/video/redraft --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/499/video/redraft/tsconfig.json   # type-check (exits 0)
```

- The file builds `deep-show` once with `cargo build --locked --bin deep-show` (default features) and copies it out of
  `target/debug`. Every test fails when that build fails.
- Each test gets a temporary folder (the fixture and the evidence store), deleted after it.
- It uses node built-ins and vitest only. Every `it` has a 30 min timeout, and nothing is timed.
- `scripts/lanes.mjs` needs this folder in its `alone` list, since the file builds a cargo binary. The implementer
  makes that edit.
- Platform needs:
  - **ffmpeg with libx264**, found on `PATH`, in `/opt/homebrew/bin` or `/usr/local/bin`, or named by `DEEP_FFMPEG`.
    Without it a test fails `BLOCKED:` with the unblock line `brew install ffmpeg`.
  - **macOS** for a passing run, since the decode worker's codecs are the platform's (#498).

**Not run.** This job ran no cargo build (shared machine) and no vitest run, so there is no `BASE-FAILURE.txt`. Expected
at the base: the base `image@1` has no video frames, so `deep show` doesn't present the film, or `eval` draws no
recording and the window check fails, by name. Type-checked with `tsc` (exit 0).
