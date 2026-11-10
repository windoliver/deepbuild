# Acceptance tests for #1485: image@1 keeps its design line: refused by header before decoding, off the UI thread, and decoded once

Written first, blind, from issue #1485 (its problem, Scope, five acceptance criteria, Proof and Not in scope), the design
lines it names and the base commit `d51be2c3` ("Merge pull request #2108 …"), by a job that never saw an implementation;
none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of
this job (design: Dogfooding, Tests written first).

What was read:

- `docs/canvas-primitives.md`: Image `image@1` (Fields; Semantics: "Decoded once off the UI thread and uploaded once …
  Its header is read first, and an image whose size passes the decode caps or the document's remaining budget is
  refused before anything is allocated, naming the asset"; Cost: "at most 64 MB decoded per document") and Asset
  (Semantics: one checked read of a store file by its name; It can never: "be decoded outside the worker").
- `docs/technical-design.md`: Dogfooding; Tests written first; Every task carries its own budgets (five runs after
  warm-up, the margin, "A frame-time limit … each timing run takes its p95 over every frame of the fixture's run, at
  least 300 frames"); The reference Macs (three since 2026-11-07, Mac17,10 among them).
- At the base: `crates/deep-app/src/show.rs` (`CanvasPanel::present`, which decodes each new picture with `picture()` in
  place; `follow`, which hands the hub's revisions to it on the UI thread), `crates/deep-app/src/main.rs` and
  `Cargo.toml` (#1434's `--chrome` fixture mode in a `chrome-fixture` build, its `--frames` UI-thread times),
  `crates/deep-replica/src/canvas.rs` and `vendor/gpui-pre/src/app/headless_app_context.rs` (the headless context runs
  on GPUI's test platform, whose background tasks run on the calling thread), `crates/deep-marks-render/src/asset.rs`
  (`decoded`: `image::load_from_memory` then `to_rgba8`, no cap), `macos.rs` (`image_of`, a session's decodings by
  hash, crop and opacity; `resampled` and `DECODED_CAP`, checked only when a nearest or cubic copy is made;
  `vello_picture`; `frames` and `session`), `raster.rs` (`Mark::Image`, which reads and decodes at every draw),
  `gpu.rs` (`Vello2d::draw`: a painter with no store, `upload_image` at each image paint and `destroy_image` after each
  draw), `lib.rs` (the subcommands and their `planted` values), `layer.rs` (`gpui_lacks`: an adjusted image's layer
  draws on Vello GPU), `crates/deep-marks-vello/src/lib.rs` (`image`, the adjust on an image's pixels).
- Prior suites, for conventions only (nothing imported): `tests/acceptance/674/` (the store, `render`'s cap refusal
  naming the asset, PNGs in code), `1487/` (README shape, `ctx.skip` as INCONCLUSIVE, the reference-Mac gate), `995/`
  (the canvas panel's revisions and evidence store), `1434/` (the app's real window in a feature build, UI-thread CPU
  per frame, five runs judged against a limit), `385/` (copying binaries out of `target/`), `scripts/benchmark.mjs`
  (`fingerprint`, `judgeLimit`, copied into `helpers.ts`), `scripts/lanes.mjs`.

What the base does, criterion by criterion: `asset::decoded` decodes whatever the store holds and checks no size, so a
PNG whose header says 10,000 × 10,000 is decoded (a whole one is drawn, by `raster` at a peak 500 MB above the
baseline's, and by `render`; a truncated one answers `asset_undecodable`). The cap is held only where a resampled copy is made, so five linear 2,000 × 2,000 images draw on
every path. A Vello GPU layer's painter has no store, so an image on it is refused `asset_missing`; the raster path it
shares reads and decodes the asset at every draw, and `Vello2d::draw` uploads every image it paints and frees it after.
The canvas panel decodes each new picture inside `present`, on the UI thread. None of the counts, plants or the app's
canvas mode below exists.

## Run them

```sh
npm ci                         # once, if node_modules is missing
PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH" CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/1485 --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/1485/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Each file builds what it uses once, with `cargo` from `PATH` (`CARGO_INCREMENTAL` and `CARGO_PROFILE_DEV_DEBUG` default to
`0` in the build's environment): `cargo build --locked --bin deep-canvas-render` for AC1, AC2, AC4 and AC5, and `cargo
build --locked --release -p deep-app --bin deep-app --features canvas-fixture` for AC3 (on macOS only). It copies the
binary out of `target/` into a temporary folder and fails each test that needs a build that failed, with cargo's error.
Every test writes under the OS temp folder and deletes what it wrote. The tests use node built-ins and vitest only. A run
with `--root` leaves Vitest's cache in `tests/acceptance/1485/node_modules/.vite`; delete it. `BASE-FAILURE.txt` is the
run at the base.

`scripts/lanes.mjs` needs, beside #1434's lines (this README is the instruction; the implementer makes the edit):

```js
// #1485's files build deep-canvas-render and the app, and its AC3 file opens the app's window and times its frames.
alone.push('tests/acceptance/1485/');
timed.push('tests/acceptance/1485/panel.test.ts');
```

**Where each test can be judged.** AC1 and AC2 run everywhere on `raster` (Vello CPU: "Any machine for caps") and, on
macOS, also on `render` (GPUI). AC1's memory needs `/usr/bin/time`; without it the refusal is still judged and the test
then skips `INCONCLUSIVE`. AC4 and AC5 draw with GPUI's offscreen Metal renderer and Vello GPU: off macOS, or when the
binary answers `unsupported_platform`, they skip `INCONCLUSIVE`. AC3 opens the app's window on this Mac's screen, not
focused, for about 15 s a run, seven runs in all; off macOS it skips `INCONCLUSIVE`, and its frame times are judged only
on a reference Mac (Mac15,7 / Apple M3 Pro / 36 GiB, Mac15,12 / Apple M3 / 16 GiB, Mac17,10 / Apple M5 Max / 64 GiB),
on mains power, Low Power Mode off, thermal state nominal, the one-minute load at most the core count at each run's
start and end. Elsewhere it prints the five readings and skips as `INCONCLUSIVE (reading only)`. Nothing passes by
skipping.

## The surface under test

The issue names counts, a refusal code and path, plants, frame times and memory, but no API. These tests add the
smallest fields to the two binaries that already draw images: `deep-canvas-render` (`raster`, `render`, `frames`) and the
app (`deep-app`, in a feature build like #1434's). No new binary and no new subcommand.

### `deep-canvas-render`

Requests and answers as at the base (#391, #373, #674), with these additions.

- **The refusal** (AC1, AC2): an image whose decoded size, width × height × 4 bytes as its header gives them, would
  take the document past 64 MiB (67,108,864 B) answers `{"ok": false, "code": "over_budget", "path": "items/<id>/params/asset…"}`
  from `raster` and `render` before decoding it. The tests read `code` (AC1) and that `path` starts with
  `items/<id>/params/asset` (#674's refusal adds `: <sha256>` after it, which they allow). Linear images count, every
  image the document draws counts once by its decoding, and the item refused is the first whose decoding passes the
  cap, in draw order.
- **`frames`, per vsync** (AC4, AC5): each record of `vsyncs` gains `images: {reads, decodes, uploads}`, counts of what
  that vsync did (all `0` on a vsync that presents nothing):
  - `reads`: image assets read from the store (each checked read of a store file by hash);
  - `decodes`: images decoded from their bytes to pixels;
  - `uploads`: images Vello GPU's renderer uploaded (`vello_gpu::Renderer::upload_image` calls) — "by the renderer's count".
- **Plants** (`planted`, as `raster`, `render` and `frames` already take it):

| Subcommand | `planted` | The wrong program | Criterion |
|---|---|---|---|
| `raster` | `decodes_before_header` | Decodes the asset whole first, as the base's `asset::decoded` does (`image::load_from_memory`, then `to_rgba8`), then applies the cap, so it still refuses `over_budget` naming the field, after the allocation | AC1 |
| `raster`, `render` | `cap_counts_copies_only` | The cap counts only resampled copies, as the base's marks path does, so linear images never reach it | AC2 |
| `frames` | `decodes_per_draw` | The raster path reads and decodes the asset at every draw, as the base's `Mark::Image` does | AC4 |
| `frames` | `uploads_per_frame` | Vello GPU uploads each image it paints at every draw and frees it after, as the base's `Vello2d::draw` does | AC5 |

### `deep-app --canvas <scenario.json>` (AC3)

Only in a build with the cargo feature `canvas-fixture` (no shipped build has it, as `chrome-fixture`). The app's real
window on this Mac's screen, not focused, `window` points at the display's scale, holding only the canvas panel: the
app's `CanvasPanel` on the scenario's `evidence` folder, with no sidebar, no hub connection and no record read. From
its first frame it asks for a frame every vsync for `run_ms`, repainting the panel each frame, and hands each revision
of `revisions` to the panel as `follow` hands the hub's (on the UI thread, `present`, then a refresh) right after the
first frame whose start is at or after the revision's `at_ms` (from the first frame's start). Then it prints one JSON
line and exits 0. The tests run it with `HOME` set to a temporary folder.

Scenario:

```json
{"evidence": "<folder: <sha[0..2]>/<sha[2..]>, as the panel reads it>",
 "window": [800, 600], "decode_ms": 500, "run_ms": 13500,
 "revisions": [{"at_ms": 0, "presented": {"doc", "rev", "rect", "layers": [{"layer", "owner", "band", "outline", "items", "picture"}]}}]}
```

`presented` is a revision as the hub's `canvas.drawn` gives it (`Presented::from_json`, #995's shape). `decode_ms` is
the issue's planted decode: every picture decode the panel makes in the run first keeps the thread that decodes it busy
(spinning, never sleeping or yielding) for `decode_ms` of wall time, then decodes as usual.

Report:

```json
{"canvas": 1485,
 "frames": [{"frame": 0, "at_ms": 0.0, "cpu_ms": 1.2, "pictures": ["<sha256>"]}],
 "handed": [{"rev": 1, "frame": 0}]}
```

- `frames`, in order, `frame` its index from 0; `at_ms`, when the frame's draw started, wall clock from the first
  frame's start; `cpu_ms`, the UI thread's CPU time (its thread clock, as #1434's `--frames` reads it) from this frame's
  start to the next frame's start (the last frame's: to the run's end), so it holds whatever the UI thread did between
  frames; `pictures`, the sha256 of each picture the panel painted in that frame, in paint order.
- `handed`: for each revision, the frame after which it was handed to the panel; the hand-over's UI-thread time falls in
  that frame's `cpu_ms`.
- Other fields (the display's scale or refresh rate) may be added; the tests print nothing from them.

The wrong program: `DEEP_CANVAS_PLANT=decodes_in_place`, read only in a `canvas-fixture` build (the plant lint's rule):
the panel decodes each picture in place on the UI thread inside `present`, as the base's `CanvasPanel::present` does,
with the planted `decode_ms` in it.

### Every assumed spelling

| Spelling | Where | Source |
|---|---|---|
| `{"ok": false, "code": "over_budget", "path": "items/<id>/params/asset…"}` | `raster`, `render` answers | AC1's words; #674's cap refusal (`path` with `: <sha256>`) |
| `planted: "decodes_before_header"` | `raster` request | AC1's "a planted path that decodes first" (this suite's name) |
| `planted: "cap_counts_copies_only"` | `raster`, `render` requests | AC2's "a planted cap that counts only copies" |
| `vsyncs[k].images.reads`, `.decodes` | `frames` answer | AC4's "reads and decodes its asset once" |
| `vsyncs[k].images.uploads` | `frames` answer | AC5's "uploads once, by the renderer's count" |
| `planted: "decodes_per_draw"` | `frames` request | AC4's "the merge base does so 60 times" |
| `planted: "uploads_per_frame"` | `frames` request | AC5 (an upload per frame) |
| `canvas-fixture` | `crates/deep-app` cargo feature | #1434's `chrome-fixture` |
| `deep-app --canvas <scenario.json>` | the app binary in that build | #1434's `--chrome <fixture>` |
| scenario `{evidence, window, decode_ms, run_ms, revisions: [{at_ms, presented}]}` | the scenario file | AC3's "a planted decode of 500 ms"; #995's revisions |
| report `{canvas: 1485, frames: [{frame, at_ms, cpu_ms, pictures}], handed: [{rev, frame}]}` | stdout, one line | AC3's "GPUI's frame time … at p99 while it runs"; #1434's `cpu_ms` |
| `DEEP_CANVAS_PLANT=decodes_in_place` | environment, that build only | AC3's "the merge base blocks for 500 ms"; #1434's `DEEP_CHROME_PLANT` |

## Criteria to tests

Each test's name starts with its criterion. Each criterion's second test runs its wrong program and asserts the same
check the first test applies fails on it, for the reason the criterion names.

| ID | Criterion (the issue's text) | Tests, and the wrong program each fails on |
|---|---|---|
| AC1 | A 10,000 × 10,000 PNG of 1 KB in `image@1` is refused `over_budget`, naming `items/<id>/params/asset`, with peak resident memory up under 10 MB. A planted path that decodes first passes 400 MB and fails | `header.test.ts`: `raster` refuses the 1,049 B PNG whose header says 10,000 × 10,000 `over_budget` naming `items/photo/params/asset`; a fresh `raster` process refuses the ~12 KB one that decodes whole the same way, its peak resident memory less than 10,000,000 B above a fresh process drawing a 100 × 100 PNG in the same document; on macOS `render` refuses the ~12 KB one the same way. `decodes_before_header` refuses as well but its peak rises at least 380,000,000 B, and the check fails on the memory. Wrong programs: the base (it decodes and draws the whole one, `asset_undecodable` on the 1 KB one), the planted path |
| AC2 | Four 2,000 × 2,000 linear images (64,000,000 B) draw, and a fifth (80,000,000 B in all) is refused. A planted cap that counts only copies draws it and fails | `cap.test.ts`: five assets of one color each, `sampling: linear`, 20 × 20 u boxes in one board. `raster` (and `render` on macOS) draws four, each box's center its image's color within 3 codes, and refuses five naming `items/p5/params/asset`. `cap_counts_copies_only` draws the fifth and the check fails naming it. Wrong programs: the base (it draws all five), the plant |
| AC3 | A planted decode of 500 ms keeps GPUI's frame time under 16.7 ms at p99 while it runs. The merge base blocks for 500 ms and fails | `panel.test.ts`: the app's window, a revision at 0 s and twelve replacements one a second, every decode planted at 500 ms; for each replacement, every frame from its hand-over to its picture's first frame still draws the old picture, and the picture arrives at least 500 ms after (else BLOCKED: the plant didn't hold). Each run's p99 of `cpu_ms` over those frames (at least 300 a run), a warm-up and five runs, judged as the design judges a limit: PASS on a reference Mac with all five under 16.7 ms; elsewhere INCONCLUSIVE (reading only). `decodes_in_place` puts the decode on the UI thread and its p99 is over 16.7 ms. Wrong programs: the base (no fixture mode or feature: the build fails), the plant |
| AC4 | A 60-frame draw of a moving image reads and decodes its asset once. The merge base does so 60 times | `decode.test.ts`: `frames`, 60 vsyncs at 60 Hz, a 64 × 64 image with `adjust: {invert: true}` (so its layer draws on Vello GPU) moved 1 u a frame by a channel: all 60 present, the last frame shows the inverted picture where it moved to and the ground where it started, and `images.reads` and `images.decodes` each total 1. `decodes_per_draw` totals 60 and 60, and the check fails. Wrong programs: the base (its Vello GPU painter has no store: `asset_missing`), the plant |
| AC5 | A Vello GPU layer with one image over 60 frames uploads once, by the renderer's count | `upload.test.ts`: the same 60 frames; `images.uploads` totals 1. `uploads_per_frame` totals 60 and the check fails. Wrong programs: the base (`asset_missing`, as above), the plant |

## Readings where the issue and design leave a choice

- **"A PNG of 1 KB" that decodes whole can't exist at 10,000 × 10,000.** Deflate can't shrink more than about 1,032 to 1,
  so the smallest PNG whose rows all decode at that size is about 12 KB (one bit a pixel: 12,510,000 bytes of rows).
  The criterion's planted path must pass 400 MB, which only a whole picture's decode does (a truncated one stops at its
  first missing row, and its buffer's untouched pages are never resident). So the 1 KB file the criterion names,
  1,049 B with the header's 10,000 × 10,000 and its first 800 rows, is refused by header (any program that reads the
  header first refuses it whatever follows), and the memory and the plant are read on the ~12 KB whole one.
- **"Peak resident memory up"** is the OS's maximum resident set size (`/usr/bin/time -l` on macOS, in bytes; GNU
  `/usr/bin/time -v` elsewhere, in kbytes) of a fresh `raster` process answering the one request, less the same reading
  of a fresh process answering the same request with a 100 × 100 PNG in the picture's place, which draws. Both processes
  do the same work up to the picture, so the difference is what the picture cost; "10 MB" is 10,000,000 B.
- **"Passes 400 MB"**: the decoded RGBA alone is 400,000,000 B; the plant must rise at least 380,000,000 B over the
  baseline (5% left for the two processes' differences). The plant still refuses with the honest refusal, so the
  memory alone is what fails it.
- **The cap's size** is 64 MiB, 67,108,864 B, as the Scope says; the tests' sizes (64,000,000 B drawn, 80,000,000 B
  refused) hold under both 64 MB and 64 MiB.
- **"The marks path" and "any machine for caps".** The criteria name no subcommand. AC1 and AC2 are judged on `raster`,
  which runs everywhere, and on macOS also on `render`, the GPUI path the app draws with. A refusal names the first
  item whose decoding passes the cap in draw order, so in AC2 it is `p5`.
- **Which path AC4 and AC5 read.** On the base's GPUI path a session already keeps one decoding per hash, crop and
  opacity, so "the merge base does so 60 times" is true only of the raster path's painter, which reads and decodes at
  every draw and which Vello GPU draws a layer with. The tests draw the image on a Vello GPU layer (an item `adjust` GPUI
  can't draw), every frame, in `frames`: the one subcommand that draws one document over 60 vsyncs and reports each.
  The base refuses that image `asset_missing` (its Vello GPU painter reads no store); the Scope's "upload a pixmap to
  Vello GPU once per key" needs it drawn. The counts are totals over the 60 frames: where in them the one read, decode
  and upload fall is not judged.
- **"GPUI's frame time"** is the UI thread's CPU time from a frame's start to the next frame's start, as #1434 reads a
  frame's UI-thread time. A wall-clock interval between frames is paced by the display (16.67 ms at 60 Hz, at the
  limit), so it can't be judged against 16.7 ms; the UI thread's CPU time holds any work it did between frames,
  a decode in place among it, because the planted decode spins rather than sleeps. GPU time isn't counted.
- **"While it runs"**: for each replacement, the frames from the one after which it was handed over to the first that
  draws its picture, both included; the twelve pooled. The first revision, which replaces nothing, isn't counted.
- **Judging AC3** follows the design's frame-time rule: a timing run's percentile over every frame it measures, at
  least 300 frames; five runs after warm-up; PASS when all five are within the limit, FAIL when all five are over it by
  more than the margin, otherwise INCONCLUSIVE; only on a reference Mac under the listed conditions. Twelve replacements
  give about 370 frames a run at 60 Hz. Fewer than 300 is INCONCLUSIVE.
- **The real window, not the headless one.** The headless context (`HeadlessAppContext`, deep-replica's) runs GPUI's
  test platform, whose background tasks run on the thread that waits for them, so it can't tell a decode off the UI
  thread from one on it. The real app's executors can.
- **Scope's "showing the old picture until the new one arrives"** is checked inside AC3's test: a panel that blanks
  while it decodes would draw cheap frames and must not pass on them.

## Not tested, because no criterion asks

JPEG headers (the Scope reads them; no criterion names a JPEG); the decode caps other than the 64 MiB budget; where a
decoding is kept across presentations beyond one `frames` run, its key (hash and crop) or its being freed; mipmaps,
reduced levels and the image cache (#1486); the Asset line's wording in the design ("decoding stays in process, in
Rust"), a docs change, and the planted corrupt file that would move decoding to the worker; frame times on the GPUI
`frames` path; and a `session` or `render` that draws the image on Vello GPU.

## Base

`BASE-FAILURE.txt` is this suite run at the base, in this worktree at `d51be2c3` with only these files added.
