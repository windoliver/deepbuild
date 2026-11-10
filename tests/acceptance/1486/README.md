# Acceptance tests for #1486: pictures at the size they're drawn: one image service with levels, a visible-first queue and a byte budget

Written first, blind, from issue #1486 (its problem, Scope, eight acceptance criteria, Proof and Not in scope), the
design lines it names and the base commit `f2af227be` ("docs(#1486): image@1's budget counts the levels a frame draws;
still levels are made in process"), by a job that never saw an implementation; none existed. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding, Tests
written first).

What was read:

- `docs/canvas-primitives.md`: Image `image@1` (Semantics: "mipmapped when drawn below half size"; "One image service
  serves every image path … a request is a hash, a level, a crop and a fit, where a level is a box reduction by a power
  of two in linear light, the smallest at or above the drawn size, made once off the UI thread by the service's own
  workers, in process … and kept by hash as a proxy, and canonical renders use the same levels. Jobs run visible first,
  then prefetch; a request no view still wants is dropped; and one cache bounded in bytes and entries never evicts what
  the last two frames drew. Size comes from the probe"; Cost: "at most 64 MB of drawn levels per document"), Asset
  (`proxies: [{sha256, gop, scale}]`; a still image decodes in process), Spatial index (visible tiles first), Decode
  worker (`memory: MB = 200`).
- `docs/technical-design.md`: Dogfooding; Tests written first; Every task carries its own budgets (five runs after
  warm-up, the margin, a frame-time limit over at least 300 frames a run); The reference Macs; The reference window
  (1512 × 982 points at 2×).
- At the base: `crates/deep-marks-render/src/lib.rs` (the subcommands, `parse`, `Counting` and `ALLOCATIONS` from
  #499), `asset.rs` (`decoded`, `Kept`: a session keeps each decoding by store, hash and crop and lets go what a frame
  didn't draw; the 64 MiB `CAP` on what a frame holds decoded at full size), `macos.rs` (`idle`, `frames`, `render`,
  `capture`, `in_view`), `crates/deep-canvas-marks/src/scene.rs` (`image@1` lowering, `fit`, `at.scale` through
  `Place`), `crates/deep-canvas/src/grammar/time.rs` (key times).
- Prior suites, for conventions only (nothing imported): `tests/acceptance/1485/` (helpers, README shape, the
  reference-Mac judge copied from `scripts/benchmark.mjs`), `1477/` (allocation counts per frame), `1479/taste/` and
  `499/video/taste.test.ts` (the taste call: pictures by SHA-256, `TASTE.json`).

What the base does: `deep-canvas-render` has no `live` subcommand, so it prints its usage and exits 2 for every test
here. Underneath, an image is decoded whole from its bytes the first time a frame draws it and held at full size
(1024 × 640 × 4 B = 2.6 MB a picture), so the grid's tiles pass the 64 MiB `CAP`: probed at the base, `raster` and
`render` refuse a 1280 × 1024 grid of 80 of these pictures `{"ok": false, "code": "over_budget", "path":
"items/p31/params/asset"}`. There are no levels, no queue, no cancel, no stats, no kept proxies, and `raster` answers
no `levels`.

## Run them

```sh
npm ci                         # once, if node_modules is missing
PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH" CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/1486 --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/1486/tsconfig.json   # type-check
```

Each file builds `cargo build --locked --release --bin deep-canvas-render` once (release: the timing needs it, and the
10,000-picture runs need to finish), copies the binary out of `target/` and fails each test, with cargo's error, when
the build fails. The tests use node built-ins and vitest only, write under the OS temp folder and delete what they
wrote, except AC8, which writes its pictures to `docs/evidence/1486/` (The taste call). A run with `--root` leaves
Vitest's cache in `tests/acceptance/1486/node_modules/.vite`; delete it. `BASE-FAILURE.txt` is the run at the base.

`grid.test.ts` makes the 1,000 pictures once (about 40 s on an idle M-series Mac; several minutes under load), and
AC2 makes 9,000 more files from them (about 700 MB in the temp folder while the file runs).

`scripts/lanes.mjs` needs (this README is the instruction; the implementer makes the edit):

```js
// #1486's files build deep-canvas-render in release; grid.test.ts times the first screen and the UI thread's frames.
alone.push('tests/acceptance/1486/');
timed.push('tests/acceptance/1486/grid.test.ts');
```

**Where each test can be judged.** Every test draws with GPUI's offscreen Metal renderer, so off macOS each fails
`INCONCLUSIVE:`, never passing. AC1's two limits are judged only on a reference Mac (Mac15,7 / Apple M3 Pro / 36 GiB,
Mac15,12 / Apple M3 / 16 GiB, Mac17,10 / Apple M5 Max / 64 GiB), on mains power, Low Power Mode off, thermal state
nominal, the one-minute load at most the core count at each run's start and end; elsewhere AC1 prints its five readings
and skips `INCONCLUSIVE (reading only)`. Every other number here is a count, a byte size, a level or a pixel, judged on
any Mac. AC8 stays INCONCLUSIVE until a taste call on its pictures is recorded.

## The pictures

Made in code by `helpers.ts`, never committed. Picture n is 1024 × 640: a smooth two-color gradient in its own hues
(the golden angle apart), a saturated disc of radius 200 px at the centre, n in white seven-segment digits inside the
disc, and two bands of one-pixel black and white stripes (columns at the top, rows at the bottom), so a level made by
box reduction differs visibly from a picture merely sampled. Even n is a baseline JPEG (JFIF, 4:2:0, quality 90, the
standard's example tables, encoded by `helpers.ts`'s `jpeg`); odd n is an 8-bit RGB PNG. A tile's **sample patch**,
source pixel (512, 470) ± 2 u under `fit: cover`, lies in the disc below the digits: a tile that shows its picture
shows its disc's saturated color there, and a tile that shows nothing shows the neutral grey ground (`[128, 128, 128]`).

The **grid**: picture i in tile i, 10 columns of 120 u `fit: cover` tiles on a 128 u pitch, each 4 u in from its
cell's corner, 1,280 u wide; 1,000 pictures make it 12,800 u tall. AC2's **10,000** are the 1,000 and nine copies of
each that differ only by a comment (a JPEG COM segment, a PNG tEXt chunk): each its own file by hash, decoded on its
own, with the same pixels.

## Surfaces this suite names

The issue names stats, plants, a job list and a budget but no API. The tests add one subcommand to the binary that
already draws `image@1` live and canonically, `deep-canvas-render`, plus one answer field on `raster`. Every other
subcommand stays as it is. JSON lines in and out, as every subcommand: one request line, one answer line.

| Surface | Shape and units | Tests | Source |
|---|---|---|---|
| `deep-canvas-render live` | A new subcommand: a document's live view (GPUI's offscreen renderer, the image service behind it) on the real clock at 60 Hz, in four phases (below), answering one line | all | The issue's "grid bench with its stats"; `idle`'s real clock, `frames`' records |
| request `doc`, `look`, `store` | As `frames` and `render` take them; `store` is the content-addressed folder the assets are read from by sha256 | all | #391, #674 |
| request `view` | `{"zoom": z, "rect": [x, y, w, h]}`: the window shows `rect` (u) at `z` device px per u, so it is `w·z × h·z` device px | all | `idle`'s `view.rect` (#1487); zoom is the window's scale factor |
| request `moves` | `[{"at": [x, y], "t": flicks}]`, default `[]`: one move-phase frame each, in order; the view's origin moves to `at` (its size stays `rect`'s) and the document is evaluated at `t` (flicks, 705,600,000 a second; default 0) | AC1, AC2, AC7, AC8 | the issue's scroll and resize |
| request `settle_ms` | ms, default 10,000: the most the open phase, and again the settle phase, may run | AC1, AC2, AC4 | |
| request `redraws` | count, default 0: frames after the settle phase at the same view and time | AC3, AC4 | AC3's "10 further full redraws" |
| request `images` | `{"budget": bytes}`: the cache's byte budget for the run; absent, the cache starts at 256 MiB (or the class's smaller budget) | AC2, AC4 | Scope: "starting at 256 MiB and 65,536, with the class's budget in charge"; AC2's "64 MiB budget" |
| request `captures` | `[{"phase", "frame": i \| "last", "out": path}]`: the frame on screen after frame i of that phase (from 0) presented, written as a PNG (8-bit RGBA, the window's device px); or `[{"phase", "dir": folder}]`: every frame of that phase, written as `<folder>/<frame>.png`, `<frame>` the run's frame number | AC3, AC4, AC5, AC8 | `frames`' `captures` |
| request `planted` | `"queue_without_cancel"` or `"evictor_ignores_two_frames"` (below); read only by `live` | AC2, AC4 | the issue's plants |
| answer | `{"ok": true, "frames": [frame…], "jobs": [job…], "stats": stats}`; `stats` read after the last frame, once every started job finished | all | |
| frame `frame`, `phase` | the run's frame number from 0; `"open"`, `"move"`, `"settle"` or `"redraw"` | all | |
| frame `at_ms`, `done_ms` | wall-clock ms from frame 0's start to this frame's start, and to its present | AC1 | `idle`'s `at_ms` |
| frame `ui_ms` | the UI thread's CPU time (its thread clock), ms, from this frame's start to the next frame's start (the last frame's: to its end) | AC1 | #1485's `cpu_ms`, #1434's `--frames` |
| frame `rect` | `[x, y, w, h]`, the view this frame showed | all | |
| frame `levels` | `{"<item id>": {"asked": k, "drawn": k \| null}}` for every `image@1` item whose box, at its place, meets `rect`: `asked`, the level the frame asked of the service; `drawn`, the level whose pixels it drew (the one asked, or the nearest it held), `null` when it drew none. Level k is a box reduction by 2^k; 0 is the picture itself | all | Scope: "A request is (hash, level, crop, fit)"; "shows its nearest level or nothing" |
| frame `settling` | `true` exactly when an image in view drew another level than it asked, or none | all | Scope: "reports settling" |
| frame `stats` | the service's stats, read at the frame's start right after its eviction ran, before anything lands in that frame: `{"bytes", "budget", "entries", "pending", "decoded", "failed", "cancelled", "evicted", "decode_ms"}` (below) | all | Scope: "Stats: bytes, budget, entries, pending, decoded, failed, cancelled, evicted, decode time" |
| frame `drawn_bytes` | bytes of the cache's entries that either of the last two drawn frames (the two before this one) drew, read with `stats` | AC1, AC2, AC4 | AC1: "except for what the last two frames drew" |
| frame `allocations` | gross heap allocations the image service made from this frame's start to the next frame's start (the last frame's: to its end), on any thread: every `alloc`, `alloc_zeroed` and `realloc` call made while the service's own code runs (its requests and lookups, its queues, its eviction and its workers' jobs), counted by the process's counting global allocator (`deep_marks_render::Counting`, #499's); frees are never subtracted; the renderer's and the harness's own allocations aren't the service's | AC3 | AC3: "by a counting allocator. A live-block count doesn't qualify" |
| stats `bytes`, `entries` | bytes the cache's entries hold; entries held | AC1, AC2, AC4 | |
| stats `budget` | the cache's byte budget, bytes | AC1, AC2, AC4 | |
| stats `pending` | requests queued or running | AC2, AC3, AC6, AC8 | |
| stats `decoded` | decode jobs (kind `decode`) finished with pixels since the run began | AC2, AC6 | AC2: "fails on `decoded`" |
| stats `failed` | jobs of either kind that failed since the run began | AC2 | |
| stats `cancelled` | requests dropped or cancelled before a worker started them, since the run began | AC2 | Scope: "a request nobody waits on is cancelled before it runs" |
| stats `evicted` | entries the cache evicted since the run began | AC2 | |
| stats `decode_ms` | the wall time of the finished decode jobs, summed, ms | (shape only) | "decode time" |
| answer `jobs` | every job a worker started during the run, in the order they started: `{"asset": sha256, "level": k, "kind": "decode" \| "read", "frame": n}`; `decode` decodes the asset's own bytes (and makes the level from them); `read` reads a level kept in the store, decoding no asset; `frame`, the frame in progress (the last one started) when it started | AC2, AC6, AC7 | AC6: "by the worker's job list" |
| levels kept in `store` | Every level a job makes is kept in the request's `store`, by asset, level and tool version (the Asset `proxies` path), before `live` answers, so a later process given the same `store` reads it (a `read` job) instead of decoding | AC6 | Scope: "kept in the content store by (hash, level, tool version) … so a second open costs a file read" |
| `planted: "queue_without_cancel"` | The wrong queue: no request is ever dropped or cancelled; every request queued runs, whether or not any view still asks for it | AC2 | AC2: "A planted queue with no cancel" |
| `planted: "evictor_ignores_two_frames"` | The wrong evictor: at each frame's start it evicts oldest first until the cache is within its budget, sparing nothing the last two drawn frames drew | AC4 | AC4: "A planted evictor that ignores the two-frame rule" |
| `raster` answer `levels` | `{"<item id>": k}`: every `image@1` item the canonical render drew, with the level it drew it at (the same levels live frames use) | AC5 | Scope: "Canonical renders use the same levels" |
| `tests/acceptance/1486/TASTE.json` | `{"issue": 1486, "criterion": "#1486.9e82ff7a", "verdict": "looks_right" \| "looks_wrong", "who", "when": ISO 8601, "screenshots": {"grid-mid-scroll.png": sha256, "grid-settled.png": sha256, "grid-scroll.apng": sha256}, "note"?}` | AC8 | #1479's and #499's taste calls |

**The phases of a `live` run.** The window opens and the document compiles before frame 0; neither counts. Frames
start on a 60 Hz vsync grid of the real clock counted from frame 0's start (a frame still running at a vsync makes the
next one start at the following vsync), and every frame is a full redraw: each image item in view is asked of the
service and drawn, and no vsync is skipped for want of a change.

1. **open**: frames at `view.rect` and t = 0 until the first frame with `settling: false` (the first screen), or until
   `settle_ms` has passed since frame 0's start; that frame is the phase's last.
2. **move**: one frame per entry of `moves`, at its `at` and `t`.
3. **settle**: frames at the last view and time until the first frame with `settling: false` and `stats.pending` 0,
   or until `settle_ms` has passed since the phase's first frame; at least one frame.
4. **redraw**: `redraws` frames at the same view and time.

After the last frame `live` waits for every started job to finish (a queued job not started is dropped), keeps every
level made in `store`, and answers. The tests check every report's shape before reading it (`helpers.ts`'s `live`):
frame numbers from 0, phases in order with one frame per move and per redraw, each frame's `rect` the view the request
gives it, `settling` true exactly when some `drawn` differs from its `asked`, `drawn_bytes` within `bytes`, frames in
time order, each job's `frame` a frame of the run.

## Criteria to tests

Each test's name starts with its criterion and the criterion's ID (`scripts/proof-change.mjs`'s, from the issue's
text). Where a criterion names a plant, its second test runs the plant and asserts the same check the first test
applies fails on it, as the criterion says.

| ID | Criterion (the issue's text) | Test, and the wrong programs it fails on |
|---|---|---|
| AC1 `#1486.38c05d85` | A 1,000-image grid of 120 px cover tiles from 1024 × 640 JPEGs and PNGs, in a 1280 × 800 view scrolled at 40 px a frame: first screen under 200 ms, UI-thread p99 under 4 ms, and cache bytes never over budget except for what the last two frames drew | `grid.test.ts`: the grid at zoom 1 in `[0, 0, 1280, 800]`, a fresh store each run (cold), opened and scrolled 40 u a frame to its end (300 move frames). In every run every frame's `levels` are exactly the tiles its view meets, and every frame has `bytes ≤ max(budget, drawn_bytes)` with `budget` at most 256 MiB; the open phase ends settled. A warm-up and five runs: the first screen (the first settled open frame's `done_ms`) judged against 200 ms and the p99 of the 300 scroll frames' `ui_ms` against 4 ms, each by `judgeLimit`. Wrong programs: the base (no `live`; under it, full-size decodes refused `over_budget`), a cache that holds more than its budget, a frame that draws tiles out of view or misses ones in it |
| AC2 `#1486.a0330377` | At 10,000 images with a 64 MiB budget, `evicted` and `cancelled` are above 0 and `failed` is 0. A planted queue with no cancel decodes every row it passed and fails on `decoded` | `grid.test.ts`: the 10,000-picture grid with `images.budget` 64 MiB, flung 800 u a frame (a view's height) from top to bottom in 159 frames, then settled until nothing is pending. Final `evicted` > 0, `cancelled` > 0, `failed` 0, `decoded` below the number of pictures whose tiles met a frame's view (all 10,000), `budget` 64 MiB, and every frame within its budget but for what the last two frames drew. `queue_without_cancel` decodes every picture the view passed and the check fails naming `decoded`. Wrong programs: the base, the plant, a cache that never evicts |
| AC3 `#1486.36b0c465` | After a settled frame, 10 further full redraws make 0 gross allocations in the service, by a counting allocator. A live-block count doesn't qualify, since it can't see an allocation freed in the same frame | `grid.test.ts`: the grid opened and settled (the settle phase ends with nothing settling or pending), then `redraws: 10`. The settled frame, captured, shows each tile's own disc color at its patch (within 16 levels); each redraw's `levels` are exactly the tiles in view, none settling; the open phase's `allocations` sum above 0 (the counter sees the service's decodes); each redraw's `allocations` is 0. Wrong programs: the base, a service that allocates per request or per frame (a key, a list, a boxed job) |
| AC4 `#1486.0be6d156` | A planted evictor that ignores the two-frame rule shows an empty tile in a frame and fails, naming the frame | `grid.test.ts`: the grid held still at its top with `images.budget` 1 MiB, under what one screen of tiles holds at its level; open and settle (1.5 s each at most) and 10 redraws, every frame captured. From the pictures alone: once a tile's patch has shown its picture, no later frame may show it empty (no chroma); the cache's `budget` is 1 MiB, every frame keeps `bytes ≤ max(budget, drawn_bytes)`, one screen at the held entries' size passes 1 MiB (else BLOCKED), and the last frame shows pictures. `evictor_ignores_two_frames` shows a tile empty after it showed, and the check fails naming the frame. Wrong programs: the base, the plant |
| AC5 `#1486.b1bef80e` | At every level, the settled live frame's image pixels equal the canonical render's within 2 levels per channel | `levels.test.ts`: picture 0 (JPEG) and picture 1 (PNG) each drawn `fit: fill` at 0.75 of level k's size for k = 0 … 6 (768 × 480 down to 12 × 7.5) and each as a 120 u cover tile (level 2). `live`'s settled frame (captured at the settle phase's last frame) asks for and draws each at its level, and `raster`'s `levels` names the same; inside each picture's box less a 1 px edge, every pixel of the live frame is within 2 levels per channel of `raster`'s, the live frame shows each picture, and the pictures hold at least 32 colors. Wrong programs: the base (no `live`, no `levels`), a live path that samples another level or filters differently from the canonical one |
| AC6 `#1486.427b5b13` | A second open of the same grid decodes nothing, by the worker's job list | `grid.test.ts`: the grid opened and settled in one process, then again in a new process on the same store. The first's job list decodes every picture in view; the second's holds no `decode` job and a `read` job for each picture in view, its `decoded` is 0, and it settles. Wrong programs: the base, a service that keeps levels only in memory |
| AC7 `#1486.0381bfcf` | Moving an image's box 1% a frame through a 1.2× resize makes no new decode | `levels.test.ts`: picture 0 `fit: fill` at 230 × 143.75 u (0.9 of level 2's 256 × 160) opened and settled at level 2, then `at.scale` channels move it 1% of that size a frame, 20 move frames to 1.2× (276 × 172.5, past level 2's size, within its 1.25×). Every move frame asks for and draws level 2, the job list holds a decode from the open, and no decode job starts at or after the first move frame. Wrong programs: the base, a service that picks "the smallest level at or above" at every size (it asks for level 1 past 256 px and decodes again) |
| AC8 `#1486.9e82ff7a` | Shown to you: screenshots of a 1,000-tile grid mid-scroll and settled, taken by the check run from the fixture document at the reference window, with a recording of the scroll, are attached to the PR and shown to you in the session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it | `grid.test.ts`: the check run (The taste call) takes the pictures with `live` and reads `TASTE.json`: none, or a call on other pictures, fails `INCONCLUSIVE:`; `looks_wrong` fails; `looks_right` on exactly the pictures in `docs/evidence/1486/`, whose settled frame this run drew again bit for bit, passes. It judges no picture. Wrong programs: the base (no `live`), any run without a recorded call |

## The taste call

The check run (AC8's test): the grid at the reference window, zoom 2 and `rect` `[-116, 0, 1512, 982]` (the 1,280 u
grid centred in 1512 × 982 points, so 3024 × 1964 device px), opened, scrolled 20 u (40 device px) a frame for 60
frames, and settled, every move frame captured and the settled frame captured. It writes, in `docs/evidence/1486/`:

| File | What |
|---|---|
| `grid-mid-scroll.png` | the 30th scroll frame, 3024 × 1964 |
| `grid-settled.png` | the settle phase's last frame, 3024 × 1964 |
| `grid-scroll.apng` | the 60 scroll frames, each halved to 1512 × 982 (a mean of each 2 × 2 square, to keep the file small), 60 a second, looping |

The pixels are `live`'s own, decoded and re-encoded (8-bit RGBA, deflate level 9), so the same pixels always give the
same bytes; each file's SHA-256 is printed. Then it reads `TASTE.json` (shape in the surfaces table). A scroll's frames
depend on when each decode lands, so they differ from run to run; the settled frame doesn't. So a recorded call
**stands** when the three files in `docs/evidence/1486/` hash to what it names and this run's settled frame hashes to
the one it names; the run then keeps those files. Otherwise the run writes its own three files there and fails
`INCONCLUSIVE:` (no call, or a call on other pictures). A standing `looks_wrong` fails; a standing `looks_right` passes.

To record the call: run the suite, attach the three files to the PR, show them to the owner in the session, and write
`TASTE.json` with the hashes the run printed and the owner's verdict.

## Readings where the issue and design leave a choice

- **The surface.** No criterion names one. A new `live` subcommand, beside `idle` (#854) and `frames` (#391), is the
  smallest surface that holds a real-clock scroll, the service's stats per frame, a resize on the document's clock, a
  second process on the same store and captures. The real app (`deep-app --canvas`, #1485) shows a panel of pictures
  the hub drew, not `image@1` items, so it can't hold the grid.
- **"120 px tiles in a 1280 × 800 view"** is read at zoom 1: 1 u is 1 device px. The design's reference window is for
  "first screen" criteria in general, but AC1 names its own view, so AC1 uses it and AC8 uses the reference window.
- **"First screen"** is the time from frame 0's start (window open, document compiled) to the present of the first
  frame that draws every tile in view at its level, on a cold store (no level kept). Prefetch still running doesn't
  delay it.
- **"UI-thread p99"** is over the 300 scroll frames of each run, at 60 Hz, each frame's `ui_ms` holding whatever the UI
  thread did up to the next frame, as #1485 reads a frame. Five runs after a warm-up, judged as the design judges a
  limit.
- **"Cache bytes never over budget except for what the last two frames drew"** is `bytes ≤ max(budget, drawn_bytes)`
  on every frame, read when the frame's eviction ran (Scope: "evicts … at frame start"): over budget only when every
  entry held is one the last two frames drew. AC1 runs at the cache's own budget (the Scope's 256 MiB start, or a
  class's smaller one), as the criterion sets none.
- **AC2's speed.** At 40 px a frame four workers keep up with every row, so a correct service would cancel nothing.
  "Decodes every row it passed" reads as a scroll faster than decoding: 800 u a frame, a view's height, so every row
  meets one frame's view and none is skipped. "Passed" is every picture whose tile met a frame's view; a service that
  cancels anything decodes fewer than that, and a queue that never cancels decodes them all once the settle phase has
  waited for nothing to be pending.
- **AC2's "64 MiB budget"** is the cache's byte budget (Scope: "One cache, bounded in bytes and entries"), set by
  `images.budget`, not the document's 64 MB of drawn levels.
- **AC3's "full redraw"** is a frame that asks the service for every image in view again though nothing changed;
  "in the service" is the service's own code on any thread. The counter must also see the service's decodes while the
  grid opens, so a counter that reads 0 always fails.
- **AC4's budget** is 1 MiB, under one screen of tiles at their level, since an evictor that ignores the two-frame rule
  only reaches what was drawn when what is drawn passes the budget. The test reads the captured pictures, not the
  report, for "shows an empty tile". It doesn't require the honest service to fill the screen at that budget: the rule
  keeps what was drawn, and a service may hold back new levels while what it keeps passes its budget.
- **AC5's levels** are 0 to 6 of the 1024 × 640 pictures, each drawn at 0.75 of its level, between half and the
  whole of it, so it's the level asked for under "the smallest at or above the drawn size"; below level 6 a drawn
  picture is under 8 px tall and its inside is all edge. A 1 px edge is left out of each box, where coverage, not the
  picture, sets the pixel. "The canonical render" is `raster` (Vello CPU), as goldens are.
- **AC6's "second open"** is a new process on the same store: in one process the memory cache alone would decode
  nothing. Both opens settle with nothing pending, so the second's prefetch asks for what the first's kept.
- **AC7's "1% a frame"** is 1% of the starting size a frame, 20 frames to 1.2×, through `at.scale` channels evaluated
  at each move's `t`, one frame apart. The start, 0.9 of level 2, makes a service without the 0.5× to 1.25× band switch
  levels during the resize.
- **AC8's mid-scroll** is the 30th of 60 scroll frames at 40 device px a frame; the recording is halved in size to keep
  it attachable. The standing rule (The taste call) is this suite's reading of "taken by the check run" when a scroll's
  frames can't repeat bit for bit.
- **The 10,000 pictures** share 1,000 pixel contents. Each is its own file by hash, so each is its own decode, level
  and cache entry, which is what the criterion counts.

## Not tested, because no criterion asks

The two queues' order (visible first, newest first) and the `min(cores − 1, 4)` job limit, beyond what AC2's counts
show; the 200 MB of bytes in flight; the entries bound (65,536); the band's 0.5× floor; chrome thumbnails through an
`ImageCache`; layout from the probe before pixels arrive; checks waiting for settling (beyond `live`'s settle phase);
linear light in the box reduction (AC5 compares live with canonical, which share the levels); the decode caps and the
document's 64 MB of drawn levels (#1485's); EXIF orientation; images past one texture (#1267).

## Base

`BASE-FAILURE.txt` is this suite run at the base, in this worktree at `f2af227be` with only these files added.
