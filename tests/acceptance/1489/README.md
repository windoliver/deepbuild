# Acceptance tests for #1489: animated images as a frame source: a GIF or WebP plays at its own delays, holding three frames

Written first, blind, from issue #1489 (its problem, Scope, four acceptance criteria, Proof, Not in scope and Depends
on), the design lines it names and the base commit `8db4b0bfe` ("Merge pull request #2842 …", origin/main), by a job
that never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue (its body as of 2026-11-19T19:00:19Z, no comments; the live body read again and found the same), its epic
  #241, its dependency #1486, and the issues it cites: #1426 (the carried-patch table and its lint), #501 and #1250
  (exports, not in scope).
- `docs/canvas-primitives.md`: Image `image@1` (Semantics: "an animated GIF, WebP or APNG plays as a frame source at its
  own delays, holding three frames, so seeking equals playing"; the decode caps; Cost: "at most 64 MB of drawn levels
  per document"), Image `image@1`: video frames (`frames: {start, in, rate, loop, hold}`; "At t the item shows the
  source frame at source time in + (t − start) × rate, floored …"; "The frame shown at t is fixed by the asset's hash,
  the decoder's version and t, so seeking equals playing"), Asset (It can never: "be decoded outside the worker, except a
  still image"),
  Decode worker (`memory: MB = 200`), Frame clock and scheduler (a frame armed only on … a `valid_until`; "quantized
  motion sleeps on a timer"; "Idle: 0 frames and 0 wakeups"), the document envelope's `transport.reduced_motion: hold |
  slow = hold`, and Operator and read set (`view(… reduced_motion)`).
- `docs/technical-design.md`: How we know version 0 works (Wrong programs; Dogfooding; Criteria to tests, both ways; The
  canvas: "reduced motion holds still"), Numbers version 0 has to hold (the Chrome frames row; Every task carries its own
  budgets; The reference Macs), and the reference window (Decided).
- `AGENTS.md`.
- At the base: `crates/deep-marks-render` (`lib.rs`: the subcommands, `parse`, `live_request`, `view`, the counting
  allocator; `macos.rs`: `frames`, `live`, `render`, `image_of`, where "a frame on a simulated clock waits for the
  level", and the video players; `video.rs`), `crates/deep-images` (`source.rs`, `lib.rs`),
  `crates/deep-canvas-media/src/frames.rs`, `crates/deep-replica/src/drive/` (`mod.rs`: `launch` and its
  `reduced_motion`, `tick`, `wait_for`, `screenshot`; `frames.rs`, `counts.rs`, `arms.rs`, `plant.rs`),
  `crates/deep-app/src/images.rs` (`Thumbnails`, which no view uses at the base), `vendor/gpui-pre/src/elements/img.rs`
  (`request_layout`), `vendor/gpui-pre/src/window.rs` (`request_animation_frame`, `on_request_frame`),
  `vendor/gpui-pre/src/app/headless_app_context/request_frame.rs`, `vendor/gpui-pre/src/platform/test/window.rs`,
  `vendor/gpui-pre-apple/upstream/README.md` (Carried patches), `scripts/vendor-rebase.mjs`, `scripts/benchmark.mjs`,
  `scripts/lanes.mjs`, `scripts/proof-change.mjs`.
- Prior suites, for their shape: `tests/acceptance/1486/` (whose helpers this suite imports), `1485/`, `499/video/`,
  `854/`, `1546/`, `1482/` and `124/`.

## What the base does

Probed with this suite's own pictures (BASE-FAILURE.txt has the run). `deep-canvas-render` decodes a GIF asset as one
still picture, its first frame, on every path: `render`, `raster`, `frames` and `live` all draw frame 0 of the cells GIF
at t = 1 s, where its delays give frame 12, with or without `frames` on the item. `live` holds it as one level-0 entry
(16,384 B for 64 × 64) and reports its `levels`, but no answer names an animation or what it holds. `check` refuses
nothing (it skips every `image@1` with a notice, `unknown_kind`). No request reads `view.reduced_motion` (`view` reads
`zoom` and `theme` and ignores the rest), and
`frames` answers `{"ok": false, "code": "bad_input"}` to the plant name `decoder_holds_all_frames`. The replica refuses
`arm: "picture"` and won't start with `DEEP_DRIVE_PLANT=picture-frame-each-vsync`. In chrome, GPUI's `img` element (no
app view shows one at the base) decodes a GIF into one `RenderImage` holding every frame and, while the window is active
and reduced motion is off, asks for a frame at each layout, so at every vsync.

## Run them

```sh
npm ci --ignore-scripts         # once, if node_modules is missing
PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH" CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  scripts/lease npx vitest run --root tests/acceptance/1489 --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/1489/tsconfig.json   # type-check
```

- **Builds.** `memory`, `seek` and `ui-thread` build `cargo build --locked --release --bin deep-canvas-render` once per
  file (#1486's `useRender`: release, as the timing needs); `chrome` builds #124's debug replica with the planted
  programs, `cargo build --locked -p deep-replica --bin deep-drive --features env-plants`, once per file. Each binary is
  copied out of `target/` for the file, so another build can't replace it mid-run, and a build that fails fails each
  test that needs it, naming cargo's words. No workspace package is built or loaded.
- **Machines.** macOS only: both binaries draw with GPUI's offscreen Metal renderer; elsewhere each test fails
  `INCONCLUSIVE:` and never passes. AC2's time is judged by `scripts/benchmark.mjs`'s `judgeLimit`: only on a reference
  Mac (Mac15,7 / Apple M3 Pro / 36 GiB, Mac15,12 / Apple M3 / 16 GiB, Mac17,10 / Apple M5 Max / 64 GiB) on mains power,
  Low Power Mode off, thermal state nominal, the one-minute load at each run's start and end no higher than the core
  count; elsewhere it reads `INCONCLUSIVE:`, which fails here and never passes. Every other number (bytes held, frames
  shown, frames drawn, tiles changed, pixels) is judged on any Mac.
- **Folders and processes.** Pictures, stores and captures go under the OS temp folder (`deep-1489-*`), replicas' homes
  under `/tmp/dd1489-*`; all are deleted after. Every process is stopped by its own PID. A run with `--root` leaves
  Vitest's cache in `tests/acceptance/1489/node_modules/.vite`; delete it.
- **Time.** At the base the whole run took 60 s at a one-minute load of about 200 on 18 cores, the binaries already
  built (a fresh worktree's first builds take far longer). With an implementation, expect a few minutes more: AC1
  plays the big GIF three times (it takes about 5 s to encode under load), AC2 makes six `live` runs of about 10 s each,
  and `chrome.test.ts` runs three debug replicas of 240 frames of the clock.
- **Names** are plain string literals, so the trace lane (`scripts/proof-change.mjs`) and the carried-patch lint
  (`vitest list`) read each test's name, and its criterion's ID, without running it.
- **Lanes.** The files build binaries and start windows, and `ui-thread.test.ts` times frames, so `scripts/lanes.mjs`
  needs (this README is the instruction; the implementer makes the edit):

  ```js
  // #1489's files build deep-canvas-render (release) and deep-drive (debug, env-plants); ui-thread.test.ts times the UI thread.
  alone.push('tests/acceptance/1489/');
  timed.push('tests/acceptance/1489/ui-thread.test.ts');
  ```

## The pictures

Made in code by `helpers.ts` (`gif`: GIF89a, a global color table, a NETSCAPE2.0 block that loops forever, every frame's
disposal "do not dispose", LZW written here); none is committed. Checked once, while this suite was written, against
ffmpeg's decoder: every frame's pixels and every delay as below.

| Picture | Size, frames, delays | What frame j shows | Read by |
|---|---|---|---|
| the big GIF (AC1) | 512 × 512, 200 frames, each 2 hundredths (20 ms; 4 s in all) | eight bars 64 px wide, black or white by j's eight bits, the most significant at the left; every frame covers the canvas | `barsShown`: each bar's mean |
| the 200 tile GIFs (AC2) | 60 × 60, 8 frames each; GIF i's every frame 4 + (i mod 7) hundredths (40 to 100 ms); each with its own comment, so each is its own file | all one color, `SMALL_COLORS[(i + j) mod 8]` | `smallShown`: the tile's centre |
| the chrome GIF (AC3, AC4) | 64 × 64, 10 frames of 10 hundredths (100 ms) | all one color, `CHROME_COLORS[j]` (none of them the window's white) | `chromeShown`: the picture's centre |
| the cells GIF (AC4) | 64 × 64, 16 frames; delays 10, 4, 7, 12, 5, 9, 6, 15, 8, 4, 11, 6, 13, 5, 7, 20 hundredths (1.42 s) | sixteen 16 × 16 cells, four to a row: frame 0 covers the canvas, the base grey [60, 60, 60] but cell 0 in its color; frame j ≥ 1 covers cell j alone, in its color, drawn over what the frames before left. So the canvas at frame j has cells 0 … j in their colors and the rest the base, and no frame but the first can be shown without the ones before it | `cellsShown`: each cell's centre |

No delay in any picture is 10 ms or less (which the Scope stretches to 100 ms), so no expected frame leans on that line.

## The surface under test

The issue names a held-frame reading, frames a second, a planted decoder, UI-thread p99, reduced motion and a seek, but no
API. These tests extend the two binaries that already draw `image@1` live and canonically, and the one harness that
counts the frames a chrome window draws: `deep-canvas-render` (#391, #1485, #1486) and the replica `deep-drive` (#124,
#1546, #1482). No new binary or subcommand. Every name marked *(chosen)* is this job's choice; the implementer builds
exactly these, or a dispute goes to a blind redraft.

### Documents

#391's board with #674's `image@1` items (#1486's `board`). An animated picture is an `image@1` whose `asset` is the
GIF's sha256 in the request's `store` and which carries `frames` (#499's field, the Scope's "with `frames`"):
`{"start": 0, "in": 0, "rate": [1, 1]}` to play once from t = 0 (AC1, AC4), and with `"loop": true` (AC2). Each item is
drawn 1:1: its `box` is the GIF's size in u, `fit: "fill"`, at `view.zoom` 1.

### `deep-canvas-render`

| Name | Shape and units | Tests |
|---|---|---|
| `frames` *(base)* | `{doc, look, store, view, refresh_hz, vsyncs, captures: [{vsync, out}], planted?}`: `vsyncs` frames of a virtual clock at `refresh_hz`, vsync k at t = k × 705,600,000 / `refresh_hz` flicks, each presented only when the frame clock arms one, every captured vsync written as a PNG of what is on screen | AC1, AC4 |
| `vsyncs[k].animations` *(chosen)* | `{"<item id>": {"asked": j, "drawn": j \| null, "held": bytes}}` for every animated `image@1` item in view, after vsync k: `asked`, the frame the item's delays give at the vsync's t (frames numbered from 0 in file order); `drawn`, the frame on screen (the one asked, another it still holds, or `null` for none); `held`, the bytes of the item's decoded pixels held in memory then, wherever they are held (this process or a worker it started; its frame source or a cache): its shown frame, any frame decoded ahead, its decoder's canvas and any other frame of it kept; not the copy the GPU draws from | AC1 |
| `planted: "decoder_holds_all_frames"` *(chosen)* | on `frames`: the wrong decoder: it decodes the whole GIF and holds every frame's pixels for as long as the item is drawn, as GPUI's element does at the base (one picture holding all 200 frames), and counts them in `held`; it shows the same frames at the same times | AC1 |
| `render` *(base)* | `{doc, look, store, view, t, out}`: one frame at t (flicks) through GPUI's renderer, written to `out`; several request lines in one process, each its own frame | AC4 (the seek) |
| `live` *(base, #1486)* | `{doc, look, store, view: {zoom, rect}, moves: [{at, t}], captures}`: the live view on the real clock at 60 Hz, one frame per move at its t, then the settle phase; each frame's `ui_ms`, the UI thread's CPU time from its start to the next frame's | AC2 |
| `frames[k].animations` on `live` *(chosen)* | the same shape as on `frames`, for the live frame k at its t | AC2 |
| `settling` on `live` *(extended, chosen)* | true also while an animated item in view draws another frame than `asked`, or none; so the settle phase ends with every animation on its frame at the last t | AC2 |
| `view.reduced_motion` *(chosen)* | `true` on `frames`, where the test reads it: the view's reduced motion, as the app's setting reaches a canvas view (the spelling `deep-show` and `deep-motion` already read); an animated item holds the frame it shows | AC4 |

### The replica `deep-drive`

| Name | Shape | Tests |
|---|---|---|
| `launch.arm: "picture"` *(chosen)* | needs `frames: "dirty"` (#1546), as #1482's arms do; a window of `size` points holding one element on a white ground: GPUI's `img`, the vendored image element chrome draws pictures with, showing the file `launch.picture` names at its own size in points at the window's top-left corner. The window is the active one (GPUI's `is_window_active()` is true), as the app's window is while you look at it. The reply echoes `arm` | AC3, AC4 |
| `launch.picture` *(chosen)* | an absolute path to an image file | AC3, AC4 |
| `launch.reduced_motion` *(base)* | the base's flag: `cx.set_reduce_motion` | AC4 |
| `DEEP_DRIVE_PLANT=picture-frame-each-vsync` *(chosen)* | read only in an `env-plants` build (`drive/plant.rs`): the picture window's image asks for a frame at every vsync while it shows a picture of more than one frame (the window active, reduced motion off), as the base's `img` does | AC3 |
| `wait_for {t}`, `screenshot`, `close`'s `frames` report *(base)* | #1546's steps (`{step, call, t, frames, drawn}`) and #1482's `list` (each frame of the clock and each frame GPUI drew, with `step`, `t`, `drawn` and `tiles`, the 64 × 32 px tiles changed since the frame read back before) | AC3, AC4 |

The picture window's run (`helpers.ts`, `pictureRun`): launch at `size: [128, 128]`, `scale: 1`; run the clock to 1 s
(step 1: the picture loads and starts); run it to 4 s (step 2, the 3 s the criteria read: 180 frames of the clock);
take a screenshot (step 3); close.

## Criteria to tests

Each test's name starts with its criterion and the criterion's ID (`scripts/proof-change.mjs`'s `criterionId`, from the
issue's text, checked against the live issue).

| ID | Criterion | Test, and the wrong programs it fails on |
|---|---|---|
| AC1 `#1489.c22ffe3a` | A 200-frame 512 × 512 GIF holds under 3 frames of pixels, under 4 MB. A planted decoder that holds all frames takes 200 MB and fails | `memory.test.ts`, two tests. One: the big GIF drawn 1:1 in a 512 × 512 board, played by `frames` at 60 Hz for 240 vsyncs (4 s): every vsync's `drawn` is the frame the delays give at its t (all 200 show), eleven captured vsyncs show those frames in their bars, and at every vsync `held` ≤ 3 × 512 × 512 × 4 = 3,145,728 B and < 4,000,000 B. Two: the honest run and `decoder_holds_all_frames`, each with its process tree's resident memory read every 25 ms by `ps`: the plant plays the same frames, its `held` reaches 200,000,000 B, its processes' resident memory peaks at least 190,000,000 B above the honest run's, and the check fails on it naming the vsync. Wrong programs: the base (a still first frame; no `animations`; the plant name refused), a decoder that holds every frame (the plant), one that reports three frames while it holds them all (no 190 MB gap to the plant), one that never steps past a frame |
| AC2 `#1489.17043bb4` | 200 animations at 60 px keep UI-thread p99 under 3 ms | `ui-thread.test.ts`: the 200 tile GIFs, looping, drawn 1:1 as 60 × 60 u tiles on a 64 u pitch (20 × 10) in a 1280 × 640 view at zoom 1; `live` opens and settles them, plays 360 move frames (6 s), one per vsync at t = (m + ½) × a 60 Hz period, and settles. On any Mac, in every run: each frame names all 200, each tile draws at least two frames of its GIF while it plays, and the settle phase's last frame, captured, shows each tile at its GIF's frame at the last t. A warm-up and five runs: each run's p99 of `ui_ms` over its 360 move frames, judged against 3 ms by `judgeLimit`. Wrong programs: the base (stills; no `animations`), a live view that decodes or composites frames on the UI thread, one that freezes its animations to stay cheap |
| AC3 `#1489.2f43c62d` | A 100 ms GIF in chrome causes 10 frames a second, not 120 | `chrome.test.ts`, two tests. One: the chrome GIF in the picture window, frames drawn only when GPUI says the window is dirty: over step 2 (3 s of the clock) it draws 30 frames (±1), 10 a second; each drawn frame, read back, changes a tile (a new frame of the GIF, not the one it showed); the screenshot shows one of the GIF's frames. Two: `picture-frame-each-vsync` draws at every frame of the clock (at least 180 in step 2) and the same check fails, naming the frames a second it caused. Wrong programs: the base's element (the plant), a timer that draws without stepping the picture, a window that never draws the picture |
| AC4 `#1489.f265e8f8` | Reduced motion holds the frame, and a seek to `t` shows the same frame as playing to `t` | `seek.test.ts` (canvas): the cells GIF in a 64 × 64 board. Playing: `frames` at 60 Hz from 0, captured at vsyncs 10, 25, 43, 56, 67 and 80, each inside one frame's delay; each capture shows the frame the delays give at its t (frames 2, 5, 8, 11, 13, 15). Seeking: `render` at each of those t, the latest first, in one process; each shows the same frame as the play. Reduced motion: the same play with `view.reduced_motion: true`, captured at vsync 0 and the six; each shows frame 0. `chrome.test.ts` (chrome): the picture window launched with `reduced_motion: true`: no frame drawn over step 2 changes a tile, and the screenshot shows the GIF's frame 0. Wrong programs: the base (a still: frame 0 at every t), a seek that decodes the frame at t alone (cells before it missing), a seek that steps from where the last one stopped (a backward seek shows a later frame), an animation that plays under reduced motion, in a piece or in chrome |

The carried patch in chrome is proven by AC3's first test, which fails with the patch reverted (the base's element draws
at every frame of the clock, as its planted twin shows). Its row's Test cell in `vendor/gpui-pre-apple/upstream/README.md`:

`` `tests/acceptance/1489/chrome.test.ts › AC3 #1489.2f43c62d A 100 ms GIF in chrome causes 10 frames a second, not 120 › AC3 #1489.2f43c62d a 10-frame GIF of 100 ms a frame in the replica's picture window (GPUI's img element, the window active, a frame drawn only when GPUI says the window is dirty): over 3 s of the clock it draws 30 frames, 10 a second, each showing a new frame of the GIF` ``

(`vitest list` prints it with ` > `; the lint joins the names with ` › `.)

## The wrong programs

| Program | Where | Criterion | Fails |
|---|---|---|---|
| the base | everywhere | all | a GIF is a still first frame; `animations`, `view.reduced_motion`, the plants and the picture arm are missing |
| `decoder_holds_all_frames` | `deep-canvas-render frames`, `planted` | AC1 | the held check, naming the first vsync over 3 frames, after its `held` reaches 200 MB and its processes hold 190 MB more than the honest run's |
| `picture-frame-each-vsync` | `deep-drive`, `DEEP_DRIVE_PLANT` (`env-plants` build) | AC3 | the rate check, naming the frames a second it caused, after it drew at every frame of the clock |

AC2 and AC4 name no plant; their tests fail at the base, and each check is written to fail the programs listed above.

## Readings where the issue leaves a choice

- **"Holds under 3 frames of pixels, under 4 MB"** is at most three frames' pixels at every vsync (the Scope's shown
  frame, next frame and decoder's canvas: 3 × 512 × 512 × 4 = 3,145,728 B, so "under" can't mean fewer than three) and
  under 4,000,000 B. It is read from the program's `held`, wherever the frames are held, since the Scope's "worker" may
  be another process (Asset: decoded in the worker, except a still image). **"Takes 200 MB"** is read twice: the plant's
  `held` reaches 200,000,000 B (all 200 frames are 209,715,200 B), and its process tree's resident memory, read by `ps`
  every 25 ms for the renderer and every process it started, peaks at least 190,000,000 B (5% allowed, as #1485 allowed
  for two processes) above the honest run's, so neither a plant that only reports 200 MB nor an honest run that holds
  every frame while it reports three passes.
- **Playing the GIF through.** "A 200-frame GIF holds …" is read while it plays all 200 frames: `frames` at 60 Hz for 4 s,
  every vsync showing the frame its delays give at t. A program that never steps past its first frame would hold one.
- **"200 animations at 60 px"**: 200 GIFs, each its own asset, drawn 1:1 as 60 px tiles at zoom 1, all in one view,
  looping, with delays from 40 to 100 ms, so their frames change throughout rather than all at once. **"UI-thread p99"**
  is #1486's reading: `ui_ms` per frame of `live` on the real clock at 60 Hz, p99 over each run's 360 frames of play,
  five runs after a warm-up, judged as the design judges a frame-time limit.
- **"In chrome"** is GPUI's `img` element, the element the issue says holds every frame and asks for a frame each
  vsync, in a window drawn by GPUI's own frame path only when GPUI says it is dirty: the replica's dirty mode (#1546),
  in an arm of its own, as #1482's `lists` arm holds GPUI's list elements. No app view shows a picture at the base, and a
  real window on a shared Mac draws only while it is focused, at the display's rate. **"10 frames a second"** is the
  frames GPUI drew in 3 s of the replica's clock, 30, one either side allowed for where 100 ms steps fall against the
  step's edges; each must change a tile, so a timer that draws without stepping the picture doesn't pass. The frames
  are on GPUI's clock: in a replica the image's timer and the frame it steps to both run on it, as every timer in a
  replica does.
- **"Not 120"** is the base's element: on a 120 Hz display it asks for 120 frames a second. The replica's clock runs at
  60 Hz and the replica draws again at once while a frame leaves the window dirty (#1482), so there the planted twin
  draws at every frame of the clock, 60 a second or more; the test asserts that, and that the check fails on it.
- **Where reduced motion is asked for: both.** The criterion pairs it with seeking, which only the canvas has, and the
  canvas holds still under reduced motion (technical design, The canvas); in chrome the patch replaces the element's
  per-vsync request with a timer, and a timer that ignores reduced motion would start chrome's GIFs moving. On the
  canvas it is `view.reduced_motion`, in chrome the replica's existing launch flag. **"Holds the frame"** is the frame the
  view first showed, frame 0 at t = 0, for every later vsync (canvas) or for 3 s of the clock (chrome); whether a held
  frame is presented again is not judged.
- **"A seek to t shows the same frame as playing to t"**: playing is `frames` from 0 through every vsync to t; a seek is
  `render` at t. The seeks run latest first in one process, so all but the first go back: the Scope's "a seek restarts
  from the top and skips forward" shapes the expected frames (each composited from frame 0), with no test of its own.
  "The same frame" is read from the pixels, cell by cell, and must also be the frame the delays give at t, since a still
  picture would show the same frame on both sides. The six times sit inside frames, never at an edge.
- **Frames are named** by their index in the file from 0 (`asked`, `drawn`) and, where a test reads pixels, by what
  each frame of its picture draws.

## Known limits

- WebP and APNG (Scope) and a delay of 10 ms or less shown for 100 ms (Scope) have no test, as no criterion reads them.
- The decode caps and the 64 MB of drawn levels for an animation, `frames.hold` and a loop's end, a time remap, and
  where the frame source runs (in process or a worker) are not tested beyond what AC1's readings see.
- AC1's memory is resident memory as `ps` reads it; memory the system compresses isn't resident, so a machine under
  heavy memory pressure could hide part of the plant's 200 MB and fail the plant's test. The honest run's own memory
  isn't held to 4 MB by `ps`: a process's other memory moves by more than that between runs.
- AC3 counts frames on the replica's 60 Hz clock, not a display's; the 120 of the criterion is read as "every vsync".
- AC2's time stays INCONCLUSIVE off a reference Mac and under load; its counts are judged anywhere.

## What the implementer adds outside this folder

- `crates/deep-marks-render` (with the image service, `crates/deep-images`, or a decode worker): GIF, animated WebP and
  APNG as `image@1` frame sources with `frames`; `animations` on `frames`' vsyncs and `live`'s frames; `settling` that
  waits for animations; `view.reduced_motion` on `frames`; the plant `decoder_holds_all_frames` on
  `frames` (in `parse` and `asset::Plant`, or beside them).
- `crates/deep-replica/src/drive/`: `arm: "picture"` and `launch.picture` (in `arms.rs` and `launch`), and the plant
  `picture-frame-each-vsync` in `plant.rs` (`Plant::parse`), read only under `env-plants` (`scripts/plant-lint.mjs`).
- `vendor/gpui-pre/src/elements/img.rs`: the timer for the frame's delay in place of the request at every layout, each
  hunk marked `DeepBuild patch (windoliver/deepbuild#1489)`, within 8 lines a hunk and 40 added lines a file (a pure
  addition in a new file with one `mod` line), with its row in `vendor/gpui-pre-apple/upstream/README.md` under
  Carried patches: Behavior, `#1489`, the files, the Test cell above, Budget, and its Removal condition.
- `scripts/lanes.mjs`: the two lines in Run them.

## Files

| File | What |
|---|---|
| `helpers.ts` | the GIF writer and its LZW, the four pictures and their readers, the frame at t, the documents, the readers of `frames`' and `live`'s answers, several request lines in one process, the process tree's resident memory, the replica's build and process, the picture window's run, the timing judge |
| `memory.test.ts` | AC1 and its plant |
| `ui-thread.test.ts` | AC2 |
| `chrome.test.ts` | AC3 and its plant; AC4 in chrome |
| `seek.test.ts` | AC4 on the canvas |
| `tsconfig.json` | the root's strict options, `allowImportingTsExtensions`, `noEmit` |
| `BASE-FAILURE.txt` | this suite run once at the base |
