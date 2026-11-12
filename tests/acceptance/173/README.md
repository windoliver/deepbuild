# Acceptance tests for #173: frame history in the live view — antialiasing and upscaling over a fixed window that a jump renders again

Written first, from issue #173 (its nine scope lines, its Fields block, its twelve acceptance criteria and its proof
line), the design sections it links and those they lean on, and the base commit `145315636` ("Merge pull request
#2297"), read in this job's worktree at its descendant on main `b0555d120` ("Merge pull request #2323"), by a job that
never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one file per criterion, one test each, plus a
test for each wrong program the issue names.

## What was read

- Issue #173. Its oracle note: no upstream test checks these criteria; these tests are their local proof.
- `docs/canvas-primitives.md`: Look `look@1`: frame history (fields, semantics, cost, "It can never"), Look `look@1`:
  samples (the settle the rest leans on), GPU surface (`upscale: … temporal`, the memory fit that shortens the window,
  "upscale a canonical render, or read a frame from outside the live view's window"), GPU surface: HDR output, the
  frame's pass order ("… the spatial upscale and sharpen or frame history's resolve, then status colors and overlays at
  display size, depth-tested against the core's depth target"), Determinism (canonical renders' raw pixels hashed on
  the GPU, "the live view's frame history is display only, rebuilt on a jump, and never part of the comparison"),
  Determinism class (frame history is live only; its fallback is the settled canonical frame), Frame budget and its
  combined envelope.
- `docs/technical-design.md`: Frame history, Rules every primitive follows, Decided, Dogfooding.
- At the base: `crates/deep-gpu-layer` (`main.rs`'s calls and `Planted`; `view3d.rs`: `parse`, `frame_order` with
  `from` and `seeks`, `class: live | export`, #419's `viewer`, samples report and settle, `timings` with `gpu_ms`,
  `passes_ms` and `wall_ms`, `packs`, the `ids` target and `picks`, the `surface` reply; `live.rs` and `liveview.rs`:
  `history_of`, the `look.history` pass, `history_frames`, the memory report's `targets`, canonical renders;
  `envelope.rs`; `golden.rs`: `golden` with a `view3d` snapshot and the hash oracle, `decide`),
  `crates/deep-canvas-scene3d` (`look.rs`, `scene.rs`: the stroke slot), `crates/deep-canvas/src/film_audit.rs` (the
  flicker check's change rule), `crates/deep-show` (`determinism`, `render_back`, its 3D draw), `packs/examples/castle.json`
  with its look and `packs/composites-1.0.0`, `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`,
  `validateBudgets`), `scripts/lanes.mjs`, and the suites `tests/acceptance/419/`, `386/`, `1903/`, `1897/`, `407/`,
  `421/`, `379/` and `422/` (conventions, `TASTE.json` and the taste test).

## What the base already does, which these tests don't credit

`view3d` draws frame n at t = n ÷ `fps`, opens at `from` as a seek, jumps at `seeks`, draws `class: export` with all of
#419's export samples, settles a live view at rest, takes #419's viewer input, draws through #386's spatial upscale,
installs `packs` (the castle draws, #422), and with `timings` reports `gpu_ms`, `passes_ms` and `wall_ms`. `live` reads
`look.history`'s window for its memory fit and runs a `look.history` pass that averages the last frames it copied: no
jitter by time, no grid, no reprojection, no rejection and nothing a jump renders again. There is no frame history in
`view3d` (it ignores `look.history`, `look.scale` and `look.reject`), no per-frame history report, no frame cap apart
from the display, no stall, no scrub, no hand on the camera, no render-back class, no determinism check on `view3d`, no
temporal upscale, no `frame_history` row in `live`'s memory report, no `history_bytes` or `seek_rebuild` in the
envelope's reply, no stroke on a composite's parts, none of the planted names below and no `canvas-frame-history` task.

## Run them

They build `deep-gpu` with cargo, as #419's and #422's suites do, and draw on the GPU, so they run one file at a time.
`scripts/lanes.mjs` needs `alone.push('tests/acceptance/173/')`, with `timed.push('tests/acceptance/173/budgets.test.ts',
'tests/acceptance/173/envelope.test.ts')` for the two budget files, and `slow` holding each file of this folder whose
run takes over two minutes on the implementer's machine (the two budget files at least: the envelope plays 60 s runs);
this README is the instruction, the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/173 --no-file-parallelism --testTimeout=600000 seek-play.test.ts
npx tsc -p tests/acceptance/173/tsconfig.json
```

Every test draws on macOS's Metal device; off macOS it fails with a message starting `INCONCLUSIVE:`, never passes.
`envelope.test.ts` and the timing and memory legs of `budgets.test.ts` count only on a reference Mac in its conditions
(scripts/benchmark.mjs's `fingerprint()`: Mac15,7, Mac15,12 or Mac17,10 on mains power, Low Power Mode off, thermal
state nominal) and judge timings with its `judgeLimit` (which also reads the load); anywhere else, or on a five-run
INCONCLUSIVE, they fail `INCONCLUSIVE:`. `taste.test.ts` is INCONCLUSIVE until `TASTE.json` records the call on this
run's pictures. A run with `--root` may leave Vitest's cache in `tests/acceptance/173/node_modules/.vite`; delete it.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the leading `- [ ] `
dropped (scripts/proof-change.mjs's `criterionId`). Each test's name starts with `AC<n> #173.<id>`. Each file's header
states its fixture, numbers and wrong programs in full.

| ID | File (tests) | What it asserts |
|---|---|---|
| AC1 `#173.594b573f` | `seek-play.test.ts` (2) | The castle at 30 fps with history on: frame 75 (2.5 s) played from 0, sought from frame 300 (10 s), and played with frame 74 missed by a stall each report `antialias`, show step 75 and resolve steps 68–75; played rendered step 75, sought the window, stalled steps 74 and 75; one final hash, unlike history off. `keeps_frame_past_window`: played and sought hashes differ, naming 2.5 s |
| AC2 `#173.66bdaff9` | `trail.test.ts` (1) | The red box over the grey wall, clamp off: at step 30 the pixels uncovered at step 27 are within 2 codes of the own render with `reject.depth`, and average at least 10 codes redder without it |
| AC3 `#173.3d79705e` | `reactive.test.ts` (1) | The sign's emission strength 0 → 4 at 1 s, clamp off: the first frame after (30 or 31) is within 1 code of its own render with `reactive: auto`; with `reactive: []` it and the next two average more than 1 code off |
| AC4 `#173.52d132b9` | `fence-chart.test.ts` (1) | The fence turning 10°/s, frames 8–127 at 60 fps: the flicker check's pixel changes with history at most a quarter of those at one sample without (which are at least 1,000). The chart's frame 16: temporal upscale from 0.5 keeps ≥ 80% of the full-resolution 1 px contrast, the spatial upscale < 50% |
| AC5 `#173.7d65ca33` | `scrub.test.ts` (1) | The castle's frame 120 (4 s): after a seek it rendered its window and has the played hash, not the one-sample frame's; frames scrubbed through report `none` and equal history off; the frame let go on rendered its window and has the played hash |
| AC6 `#173.126ffc47` | `rest-canonical.test.ts` (1) | The still scene orbited by hand: history while moving, then settled to 16 samples without history, every settled frame equal to the render-back at that view. The orbiting scene: export, render-back and a blessed golden of one revision equal with history off, on after playback, and on fresh |
| AC7 `#173.5e002fc0` | `envelope.test.ts` (1) | On a reference Mac's GPU, the envelope of the orbiting scene full screen with history on: frame time and GPU memory PASS against the showpiece class, the window's bytes counted inside the peak, its seek rebuild rendering the whole window |
| AC8 `#173.67e2e72d` | `determinism.test.ts` (2) | The castle's check at 1, 2.5 and 4 s: PASS, play = seek, one hash per time across history off, on, and on after an orbit by hand. `determinism_hashes_live_view`: FAIL, play ≠ seek at 2.5 s |
| AC9 `#173.f5914d9c` | `budgets.test.ts` (1) | `canvas-frame-history` valid against the merge base; a still scene with history settles and draws nothing (the moving control draws); on a reference Mac the 1080p window under 100 MB, the 1080p resolve under 1 ms and the castle's 8-frame jump at 0.67 under 50 ms by the five-run rule; the perf task exits 0 |
| AC10 `#173.11b2d1f1` | `cap-stall.test.ts` (2) | The castle at a 30 fps cap on 60 Hz and 144 Hz: every frame renders exactly the grid steps since the last one shown (one per new frame shown, none otherwise); after a 50 ms stall the missed step and the shown one, once; renders after the open = new frames shown + the grid frame the stall missed. `grid_at_refresh`: more renders than that, counted |
| AC11 `#173.77c9b0e7` | `outline.test.ts` (2) | The castle's towers stroked 1 px, upscale at 0.67, frames 0–47: the outline with history within 2 px of the outline without and 0.67–1.5× its pixels. `outlines_in_history`: pixels left behind, naming a tower |
| AC12 `#173.7c84d072` | `taste.test.ts` (1) | Writes the three screenshots and two recordings (The taste call) and reads `TASTE.json`: absent or on other SHA-256s INCONCLUSIVE, `looks_wrong` fails, `looks_right` on exactly these passes |

## Assumed surfaces

The issue and design name the behaviors and the look's fields but no call API; each surface below is this job's
choice, the smallest extension of the base's `deep-gpu run` calls. The implementer provides exactly these. Times are
flicks (705,600,000 a second), integers.

1. **The look's frame-history fields**, the issue's Fields block, read from the call's `look` by `view3d`, `live` and
   `envelope`: `history: {mode: "none" | "antialias" | "upscale", window: 2..16}`, `scale: 0.5..1` and
   `reject: {depth: bool, clamp: "neighborhood" | "none", reactive: "auto" | [ID]}` (`reactive: []` is no part
   reactive). Frame history applies to `view3d`'s live class while the view moves (a frame that doesn't draw as the
   one before it, by a channel, a seek or your hand); `class: export` and `class: render_back` never read it. With
   `mode: upscale` the window's frames render at `scale` and the resolve rebuilds the call's size: `view3d`'s reply
   `surface` then reads `internal_scale` = `scale` and `upscale: "temporal"`, and `live`'s view rows the same
   `internal_scale` and `upscale: "temporal"`. Every call in this suite sets `history`.
2. **Each `view3d` frame reports `history: {mode, shows, window, rendered}`**: `mode` is what drew it, `"antialias"`,
   `"upscale"` or `"none"` (no history: at rest, scrubbing, `export` or `render_back`, or the look's mode none);
   `shows` is the grid time the frame shows (its own t when mode is none); `window` the grid times, oldest first, whose
   frames the resolve read for it, the shown one last (`[]` when none); `rendered` the grid frames rendered while this
   frame drew, in order (`[]` when none). The window holds `history.window` frames: the shown grid step and the ones
   before it.
3. **`view3d`'s `cap: fps`**, the view's frame cap, default `fps`. Frame n is a display refresh at t = n × flicks ÷
   `fps`; the history grid steps 1 ÷ `cap` from 0, so grid step k is at k × flicks ÷ `cap`; while history draws, frame
   n shows grid step ⌊n × cap ÷ fps⌋. The grid's `step` field (the issue's `step`) is left at its default here.
4. **`view3d`'s `stalls: [{after: n, ms}]`**: after frame n draws, the view stalls `ms` milliseconds; the display
   frames n + k with 1000 k < `ms` × `fps` are missed. A missed frame counts toward `frames` (the clock runs on) but
   draws nothing and has no entry in the reply.
5. **`view3d`'s `scrubs: [{after: n, through: [frame], release: frame}]`**: after frame n draws, your hand takes the
   playhead and drags it through each frame of `through`, each drawn as you scrub, then lets go on `release`, which
   draws as the frame let go on; play goes on from `release` + 1. Each scrubbed frame and the release count toward
   `frames`. (`seeks`, `from` and `frames` are the base's.)
6. **`view3d`'s `viewer` entries take `camera: {azimuth: deg}`**: your hand's orbit, view input in session state (#419's
   `viewer`), never a document revision: from that frame on the view's camera is the document camera turned `azimuth`
   degrees about its target around +Y (0 is the document's own view). An entry before `from` applies at the open, as
   #419's do.
7. **`view3d`'s `class: "render_back"`**: the render-back of the view at t: drawn as `export` draws (all of the look's
   export samples, no history, scale 1, never settling) through the view's camera, your hand's turn included.
8. **The resolve's pass** is named `look.history` (the base's live-view name) in `timings`' `passes_ms`. `wall_ms`
   (#252's) times a jump.
9. **`view3d`'s `determinism: {at_times: [t]}`**: after the call's frames, the same-machine determinism check on its
   document and look, in the same process: at each t, a canonical render played to t (evaluated at every frame of the
   call's `fps` from 0, then t) against one sought to t (a cold evaluation jumped from t + 1 s), each its 128-bit GPU
   pixel hash as 32 lowercase hex digits (#1897's). The reply gains `determinism: {result: "PASS" | "FAIL", frames:
   [{t, play: {pixel_hash}, seek: {pixel_hash}}]}`, one row per t in order; FAIL when any time's hashes differ.
10. **`live`**: with `report: ["memory"]` each frame's `writers[].targets` holds a row `{session, target:
    "frame_history", bytes, device_bytes}` for a view's window (its frames, color and depth), `device_bytes` as the
    device reports it. **`envelope`**: the scene's `gpu_memory` gains `history_bytes`, the window's device bytes inside
    `peak_bytes`; the reply gains `seek_rebuild: {ms, window, rendered}`: the seek's time (the `seek_rebuild` metric's
    measured value), the window the scene played with, and the window frames the seek rendered before the rebuilt frame
    showed.
11. **A stroke on a composite**: `paint.stroke {role, width}` in a `composites.tower@1` item's params draws #386's
    stroke-slot outline around each solid part its recipe builds (the body and the merlons: the battlements), drawn
    after the resolve at display resolution like any stroke.
12. **The perf lane**: a task `canvas-frame-history` in `benchmarks/budgets.json` with command `["node",
    "benchmarks/canvas.mjs", "history"]` and an `initialReason` naming #173, valid by `validateBudgets` against the
    merge base's budgets, and the `history` mode of `benchmarks/canvas.mjs` it runs (what it measures is the
    implementer's), exiting 0 on a reference Mac.
13. **`tests/acceptance/173/TASTE.json`** records the taste call (The taste call).

Used as the base has them: `view3d`'s `from`, `seeks`, `frames`, `fps`, `capture`, `targets: ["final", "ids"]`,
`packs`, `surface`, `timings`, #419's `class: export` and `samples` report; `live`'s sessions, `report: ["fences",
"memory"]` and view rows; `envelope`; `golden` with a `view3d` snapshot and `oracle: "hash"`, and `decide`'s bless.

## Planted programs

Each reachable only through `deep-gpu run --planted <name>`, added to `Planted` in `crates/deep-gpu-layer/src/main.rs`.

| Name | The wrong program | Must fail |
|---|---|---|
| `keeps_frame_past_window` | The resolve also reads the grid frame just before the window whenever it still holds it, so a played frame mixes in one frame more than a sought one | AC1, `seek-play.test.ts`: played and sought hashes differ at 2.5 s |
| `determinism_hashes_live_view` | The determinism check hashes the frames the call's live view resolves (play: the frame it showed at t; seek: the view jumped to t as it now stands, your hand's camera included) instead of canonical renders | AC8, `determinism.test.ts`: FAIL, play ≠ seek at 2.5 s |
| `grid_at_refresh` | The window's grid steps at the display's refresh (1/60 s on a 60 Hz display) instead of the frame cap, while frames still show at the cap | AC10, `cap-stall.test.ts`: more grid frames rendered than frames shown and grid frames the stall missed, counted |
| `outlines_in_history` | Outlines draw into each window frame at the render scale before the resolve, so the window keeps them and the resolve reprojects and upscales them | AC11, `outline.test.ts`: outline pixels left behind, naming a tower |

The issue's "planted 50 ms stall" (AC10) is a condition the test plants with `stalls`, not a wrong program. "The same
resolve without the depth test" (AC2) and "a resolve without the reactive mask" (AC3) are the look's own fields,
`reject.depth: false` and `reject.reactive: []`.

## The taste call

`taste.test.ts` writes, from one run's output, to `docs/evidence/173/`, printing each SHA-256:

| File | What it shows |
|---|---|
| `castle-moving.png` | The castle's moving frame at 2.5 s played from 0 with history on (AC1's): the renderer's final PNG, byte for byte |
| `fence-turning.png` | The wire fence's frame 60 turning with history on (AC4's) |
| `castle-after-seek.png` | The castle's first frame after a seek from 10 s to 4 s (AC5's) |
| `flythrough-history-on.apng` | The flythrough's first second, frames 0–29 at 30 fps at 640 × 400, history on: its final targets as an animated PNG |
| `flythrough-history-off.apng` | The same with history off |

They are attached to the PR and shown to the owner in the session. The answer is recorded in
`tests/acceptance/173/TASTE.json`, the one file anyone adds to this folder after this commit, and only to record it:

```json
{"issue": 173, "criterion": "#173.7c84d072", "verdict": "looks_right" | "looks_wrong", "who": string,
 "when": "ISO 8601 time", "screenshots": {"<file name>": sha256, … all five}, "note"?: string}
```

No file is INCONCLUSIVE; a call on other SHA-256s is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly this
run's pictures passes. No other test reads these pictures or the call.

## Fixtures

The castle is the checkout's own (`packs/examples/castle.json`, its look and `packs/composites-1.0.0`): a flythrough
whose camera orbits once over 24 s at 1280 × 800. Everything else is generated in `helpers.ts`: the red box and the
grey wall (`trailDoc`, `trailLeftEdge`), the sign (`signDoc`, `signInterior`), the wire fence (`fenceDoc`, with
`fencePxPerM` and `fenceMotion`, a pinhole with the base's horizontal field of view), the
resolution chart (`chartDoc`, `barContrast`), the still scene (`stillDoc`, #419's), the orbiting scene (`orbitDoc`),
the stroked castle (`strokedCastle`), and the measures: the grid in flicks (`frameT`, `gridT`, `shownStep`,
`windowEndingAt`), sRGB decoding and relative luminance (`lumaOf`), the flicker check's change rule
(`flickerChanges`), PNG and APNG reading and writing, and the five-run rule (`judge`, through `judgeLimit`).

## Readings where the issue and design leave a choice

- **The window holds 8 frames, the shown one among them**: the grid step a frame shows and the 7 before it. The
  design's cost (about 90 MB for 8 frames at a 1080p display at 0.67) and AC9's "a jump renders the castle's window of
  8 frames" count 8 in all. A jump renders all 8.
- **Pixel hash** in `view3d` is the final target's SHA-256 (its PNG, named by its hash), as #419's suite reads it; the
  determinism check's is #1897's GPU pixel hash.
- **The grid with no cap given** steps at the call's `fps`, so at 30 fps the moving frame at 2.5 s is frame 75 and the
  grid frame before it frame 74. "Seeking from 10 s" opens at frame 300 and seeks to 75. "The grid frame before 2.5 s
  left undrawn" is a stall that misses display frame 74.
- **"The same resolve without the depth test" and "without the reactive mask"** keep every other field and turn the
  colour clamp off in both legs (`clamp: none`): a clamp to the current frame's neighbourhood would also hide the trail
  and the lag, so with it on the controls couldn't show what the depth test and the mask each do. The sign's emission
  is (0.1, 0.12, 0.15) × strength, so at 4 it reads (0.4, 0.48, 0.6) in linear light, under 1 in a look with no tone
  map, and a lag is visible.
- **"3 grid steps after the box uncovers a pixel"** is step 30 for pixels uncovered at step 27, judged 1.5 px or more
  from either edge position so a jittered sample can't reach the box. "Within 2 code values" is every channel of every
  judged pixel; "at least 10 code values of red" is the judged pixels' mean red excess over the own render.
- **"Shows its new value in the first frame after"** is the first frame whose own render lights the sign (30, or 31 if
  a hold key keeps its old value at exactly 1 s), judged on the sign's interior inset 4 px; "lags by at least 3
  frames" is that frame and the next two each more than 1 code from their own render on average.
- **"Flickers, by the flicker check's measure"** applies the check's own change rule (relative luminance moving more
  than 0.1 with the darker frame under 0.80), counted pixel by pixel over consecutive frames: a flash is two changes,
  so the count is twice the flashes. The check's verdict thresholds (3 flashes in 25% of the view) would pass any thin
  wire, so the quantities are compared. The fixture makes what the rule counts aliasing rather than motion: at the
  base a camera's `fov` spans the view's width, so the wires are 0.0084 m ribbons, 1.0 px at the orbit's target
  (119.4 px/m), and the panel is small and near the orbit's axis, so over frames 8–127 no point of it moves more than
  0.12 px a frame. A wire resolved at its true coverage then changes a pixel by at most 0.6 × 0.12 = 0.07 a frame,
  under 0.1, while one sample, which resolves the base's in-pass 4× multisampling, steps a pixel by a quarter of the
  wire's 0.6 (0.15) each time a wire edge crosses one of its sample points. The test checks these numbers first.
- **The chart under 4× multisampling**: at half resolution a frame resolved through the renderer's 4× multisampling
  averages each bar with the gap beside it, whatever its jitter, so the 80% can come only from window frames whose
  jittered samples are kept apart; the criterion asks for that rebuild, and the spatial upscale's frame has nothing
  to rebuild from.
- **"At one sample without history"** is `history: none` with #419's one live sample.
- **"Contrast at 1 px detail"** is the mean luminance of the bars' columns less that of the columns between them, over
  rows 40–259, so the full-resolution render of 1 px bars reads about 1. "Once the window fills" is frame 16, played
  from 0. "The spatial upscale" is #386's edge-adaptive upscale with sharpen 0.2 at internal scale 0.5.
- **"While you scrub, frames draw without history"** is each scrubbed frame reporting mode `none` and equal, byte for
  byte, to the same frame drawn with history off: no history, and no jitter left from it.
- **"A view that stops after an orbit"** is the still scene turned by your hand (nothing in the document moves), so
  when the hand stops the view rests. The look leaves `samples.at_rest` at `none`: frame history turns settle on
  (design). "The frame a render-back takes at that t and view" is `class: render_back` through the hand's last turn.
- **"An export, a render-back snapshot and a golden of the same revision"** are `class: export` and `class:
  render_back` of frame 30 and the `golden` call's own `view3d` snapshot under the hash oracle, against a golden
  blessed from the export of frame 0 with history off; the look draws one sample live and in export, so the three are
  one canonical render each. "After any playback" is the same process after a played view with your hand orbiting
  and a seek; "fresh" a process that drew nothing before.
- **The envelope's scene** is a stand-in, as #1903's suite says the every-pass scene is: the orbiting scene with
  frame history beside shadows, full screen on this reference Mac's display, for the design's 60 s run. "Holds the
  envelope's totals" is its frame time and GPU memory PASS. Full screen, the memory fit may shorten the window (GPU
  surface), so the seek is held to the window the scene played with.
- **"After an orbit by hand in the live view"** is your hand turning the castle's live view out 30° and back over
  frames 60–120 of the call the check runs after. The planted check differs at 2.5 s, inside the orbit.
- **Budgets**: "adds under 1 ms" is the `look.history` pass's own GPU time, median over frames 60–359 of the castle at
  1080p (no percentile stated, so not the p95 gate, as #386's upscale); "a jump renders the window in under 50 ms" is
  the sought frame's `wall_ms`, median of 10 jumps; "the window holds under 100 MB at a 1080p display" is its
  `frame_history` target as the device reports it, at the design's 0.67 (at scale 1 eight frames would take about
  200 MB); "a still scene draws nothing" is #421's: no frame drawn and no GPU work submitted once settled, within 40
  frames. "Compared with the merge base" is the perf lane's task.
- **"Renders one frame per shown frame"** is each display frame rendering exactly the grid steps after the one shown
  before it, up to its own: one when a new grid frame shows, none otherwise. Over a run the renders after the open are
  the new frames shown plus the grid frames a stall made the view miss: "only the grid frames it missed" adds one render
  per missed grid frame, apart from the one per shown frame. The 50 ms stalls start at or past the
  middle of a grid step, so they miss a grid frame other than the one shown next.
- **"Stays 1 device px wide … nothing of it left behind the moving edge"** compares the outline with history to the
  outline drawn without history at scale 1 in the same frame, so where and how wide an outline sits stays the
  implementer's: every outline pixel within 2 px of the reference outline, and 0.67 to 1.5 times its pixels. The clamp
  is off for the reason AC2's is. A trail is named by the tower nearest it.
- **The taste recording** is the flythrough's first second at 640 × 400, rendered at that size (not scaled down).

Not tested, because no criterion asks: the grid's `step` for a film, cuts, marker jumps, loop wraps and ladder-rung
changes as jumps (a seek stands for them), particles and see-through parts in the reactive mask, the YCoCg clamp's
values, status colors and text after the resolve, indirect light over the window (#476), and content keys.

## Upstream tests (the Oracle lane)

No upstream test checks these criteria; these tests are their local proof.
