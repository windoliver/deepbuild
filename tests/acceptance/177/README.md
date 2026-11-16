# Acceptance tests for #177: HDR output on XDR displays, highlights above paper white in the live view, with checks and exports still SDR

Written first, blind, from issue #177 (its Scope, Fields, seven acceptance criteria, Proof and Depends on), the design
and the base commit `0e5572731` ("Merge pull request #2529 …"), by a job that never saw an implementation; none existed,
and no other worktree, branch, PR or stash was read. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, live (`gh issue view 177 --repo windoliver/deepbuild`). Seven criteria: six functional and the "Shown to
  you" taste call (AC7). Each test's name starts `AC<n> #177.<id>`, the first 8 hex digits of SHA-256 of the checkbox's
  text, trimmed, white space collapsed (`scripts/proof-change.mjs`, `criterionId`); computed again here, they match the
  IDs this job was given (`helpers.ts`'s `AC`).
- The Oracle page (`doneright/oracles/issues/177.md`, DeepBuildAI/deepbuild, branch `doneright`) and the vendored files it
  cites for criteria 1 and 2: an upstream engine's tone mapper, which takes the output's maximum (never below 1), keeps
  the toe below 0.18 unchanged and ends the shoulder at that maximum, so a maximum of 1 is the SDR curve. It has no test;
  it is the formula of `helpers.ts`'s `agxTo` (The roll-off, below). Nothing is ported.
- `docs/canvas-primitives.md`: GPU surface; GPU surface: HDR output; Look `look@1`: tone mapping; the determinism
  classes' "live only" (the HDR surface's fallback is SDR; it never reaches a canonical render, render-back, an export,
  a golden, a content key or a check).
- `docs/technical-design.md`: How it installs; Decided; Dogfooding; Every task carries its own budgets; The reference
  Macs; taste calls.
- At the base, for surfaces only: `crates/deep-gpu-layer/src/{main,view3d,tone,golden,window,frames}.rs` (the call
  table, `--planted`, view3d's fields, targets, window, capture and per-frame report, `class: export | render_back`,
  `golden`'s `oracle: "hash"` and `decide`); `crates/deep-scene3d-render/src/output.wgsl` (the agx curve and its clamp
  to 1); `vendor/gpui-pre-apple/src/metal_renderer.rs` (`configure_layer`: BGRA8Unorm, opaque, tagged sRGB) and
  `metal_renderer/layer_colorspace.rs` (#140's drawable read-back); `crates/deep-app` (`--color-check`, the
  `chrome-fixture` and `env-plants` features); `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`); and the suites
  `tests/acceptance/1434`, `468`, `418`, `424`, `1903`, `1938`, `380`, `140`. #424's helpers (documents, PNG reader,
  `readNamed`) and #1903's (`envelopeOf`, `fixtureRow`, `seededTimes`, `offReference`, `p95`, its look) are imported as
  they are.

## Run them

```sh
npm ci                                                       # once, if node_modules is missing
node node_modules/typescript/bin/tsc -p tests/acceptance/177/tsconfig.json
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/177 --no-file-parallelism ac1 ac2 ac3 ac4-card taste
# by hand on a reference Mac with its XDR display (never in CI), nothing else on screen showing HDR content:
DEEP_177_LIVE=1 npx vitest run --root tests/acceptance/177 --no-file-parallelism live
rm -rf tests/acceptance/177/node_modules/.vite
```

Files build once before their tests and copy the binary out of `target/` (`CARGO_TARGET_DIR` honoured):

- `cargo build --locked --bin deep-gpu --features test-meter` (ac1 to ac4-card; and ac5's envelope, live only);
- `cargo build --locked --release -p deep-app --bin deep-app --features hdr-fixture` (the `*.live.test.ts` files, only
  with `DEEP_177_LIVE=1`; without it each of their tests fails `INCONCLUSIVE`, as #1434's live files do).

Everything draws on macOS's Metal device: off macOS a test fails `INCONCLUSIVE:`, never passing, as does an
`unsupported_platform` answer. Lanes (the implementer edits `scripts/lanes.mjs`): `tests/acceptance/177/` in `alone`
(its files build cargo binaries); the three `*.live.test.ts` files in `byHand`; `ac6-budgets.live.test.ts` in `timed`,
the local preflight's perf step that sets `DEEP_177_LIVE=1` on the reference Mac. This job wrote only this folder.
`BASE-FAILURE.txt` says what each test meets at the base (not run here: the machine was loaded and this job builds no
Rust).

## The surface under test

The issue names fields (`hdr: auto | off`, `headroom`, `surface: {format: RGBA16Float, color_space: extended linear sRGB,
edr: true}`), a stub display, the surface's linear values, a capture of the window, an export, render-back and golden,
the combined envelope and budgets, but no binary or call. The headless criteria (AC1 to AC4) go through #377's
`deep-gpu run` and #378's `view3d`, so they run on a locked screen; the legs on the real XDR display (AC5, AC6 and the
Scope's last line) go through the app's real window, as #1434's live legs do. New names are marked *(chosen)*.

### deep-gpu: the stub display and the view's HDR output

`view3d` gains these fields (the shipped build answers `stub_display` with `bad_input`, as #1903's stubs; the rest are
the product's):

```jsonc
{"call": "view3d", …,                      // #378's call as it is
 "hdr": "auto" | "off",                    // the view's session state (the design's field; default auto)
 "stub_display": {                         // (chosen) test-meter builds: the display seam's test backend the view is on
   "potential": 4,                         //   its potential EDR headroom
   "headroom": 4,                          //   its current headroom once something on it asks for EDR (1 before, as a real display)
   "posts": [{"frame": 3, "headroom": 1.5}]  // (chosen) a change the display posts after frame n − 1 presents, before frame n latches
 },
 "window": {"size", "view", "page", "card"?: {"question", "options": [{"label"}], "rect": [x, y, w, h]}},  // card (chosen): #377 frames' card shape
 "targets": [… | "surface" | "window_linear"]}                                                           // (chosen) two more targets
```

Without a `stub_display` the run's headless window has no display reporting EDR, so `hdr: "auto"` stays SDR. Every
frame of a view3d reply gains:

- `hdr: {"state": "on" | "off", "headroom": number}` *(chosen)*: whether this frame presented through the HDR surface,
  and the headroom its tone map rolled off to (1 when off).
- with `targets` naming `surface` *(chosen)*: `surface: {"format": "rgba16float" | "bgra8unorm", "color_space":
  "extended_linear_srgb" | "srgb", "edr": bool, "file": sha256}`, what the view presented this frame, read back as its
  surface stores it into `<out>/<sha256>.bin`: `rgba16float` as little-endian f16 RGBA (w × h × 8 bytes), the
  surface's linear values; `bgra8unorm` as its sRGB-encoded bytes in B, G, R, A order (w × h × 4 bytes). Rows top-down.
- with `targets` naming `window_linear` and a `window` *(chosen)*: the SHA-256 of `<sha256>.f32`, the window as the
  compositor composites its layers (the HDR surface's layer beneath GPUI's, premultiplied over, each in its own color
  space), in extended linear sRGB: little-endian f32 RGBA, w × h × 16 bytes, rows top-down, at the window's scale 1.

`final`, `pixel_hash`, `linear` and `ids` stay as #378 has them: `final` is the SDR frame, the one checks read.
Status-mark bounds (#382's `status.marks[].bounds`) are read in the view's px, offset by `window.view` in the window.
AC3 also uses `view3d`'s existing `class: "export" | "render_back"` and #380's `golden` with `oracle: "hash"` (its
`numbers.pixels`, the snapshot's pixel hash) after `decide` blesses a golden by your decision.

### deep-gpu: the envelope on the main display (AC5)

#1903's `envelope` call gains `"hdr": "auto" | "off"` and `"screen": "main"` *(chosen)*: its fixtures play in a window
on the main display, full screen at `render.pixels`, through the app's real layers, so a live 3D view's HDR surface
goes through the display's real EDR. Its reply gains `hdr: {"state": "on" | "off", "potential_headroom": number,
"headroom": number}` *(chosen)*: whether the scene presented HDR in every timed frame, the display's potential headroom,
and the least current headroom read in the timed runs.

### deep-app `--hdr <scenario.json>` (live; `hdr-fixture` build *(chosen)*)

The app's real window on the main display, the scenario's document in a live 3D view, presenting through its layers.
It plays the scenario, prints one report line `{"hdr": 177, …}` and quits. The feature is in no shipped build; it
builds in release, which AC6 needs.

```jsonc
// scenario (chosen), format "hdr-fixture@1"
{"format": "hdr-fixture@1", "out": dir,      // captures are written under out
 "doc": path, "look": look@1,                // a scene document and look as view3d takes them
 "window": [w, h], "page": [r, g, b],        // points; the window's fill around the view (the chrome)
 "view": [x, y, w, h],                       // the view's rect in points; in a resize it keeps its inset from every edge
 "hdr": "auto" | "off", "frames": n,         // n frames back to back once the window shows, the whole view drawn each frame
 "close_view_at"?: k,                        // the view closes after frame k; the window shows the page alone after
 "resize"?: {"to": [w, h]},                  // a live resize: the window's size steps linearly from window to `to` over the n frames
 "captures"?: true,                          // each frame captured as the compositor composited the window (8-bit PNG, device px)
 "posts"?: [{"frame", "headroom"}],          // the display seam posts this current headroom before frame k (hdr-fixture builds)
 "read_peak"?: true}                         // each frame reports the largest linear value its HDR surface held
// report line (chosen)
{"hdr": 177, "scale": s, "display": {"potential_headroom": f},
 "frames": [{"frame", "ms",                  // ms since the view's first presented frame
             "state": "on" | "off", "headroom", // the display's current headroom this frame's tone map rolled off to (1 when off)
             "cpu_ms", "gpu_ms",             // the UI thread's time in the frame; its command buffers' GPU time (the GPU ledger)
             "peak"?, "size"?: [w, h], "capture"?: path}],
 "layers": [{"owner": "gpui" | "hdr" | …, "format", "colorspace", "edr", "opaque"}],  // the window's Metal layers bottom to top after the run, as they report themselves
 "headroom_reads": n,                        // times the app read the display's headroom in the run
 "display_posts": n}                         // change notifications the display posted in the run
```

`format` is the layer's MTLPixelFormat case name (`BGRA8Unorm`, `RGBA16Float`), `colorspace` its CGColorSpace name as
#140's `--color-check` reports it (`kCGColorSpaceSRGB`, `kCGColorSpaceExtendedLinearSRGB`), `edr` its
`wantsExtendedDynamicRangeContent`.

### Planted programs

| Name | Passed by | The wrong program | Criterion |
|---|---|---|---|
| `clips_at_one` | `deep-gpu run --planted` | The HDR surface carries the SDR curve, clipped at 1 | AC1 (issue-named: "none clips") |
| `clips_at_headroom` | `deep-gpu run --planted` | The toe kept, the shoulder replaced by the identity clipped at the headroom | AC1 |
| `moves_toe` | `deep-gpu run --planted` | The roll-off scales the whole SDR curve by the headroom, so the curve below 0.18 changes | AC1 (issue-named: "keep their curves below 0.18") |
| `status_over_paper_white` | `deep-gpu run --planted` | Status colors drawn on the view are scaled by the headroom | AC1 (Fields: "never draw a status color … above paper white") |
| `reads_headroom_once` | `deep-gpu run --planted` | The headroom is read when the view opens and never again | AC2 |
| `export_reads_hdr_surface` | `deep-gpu run --planted` | An export, a render-back snapshot and a golden made while a view presents HDR draw from the HDR surface (rolled off to the headroom, then 8-bit) | AC3 (Fields: "never reach … an export") |
| `hdr_layer_above_chrome` | `deep-gpu run --planted` | The HDR surface's layer composites above GPUI's | AC4 (Fields: "never cover the shell or the card") |
| `catcher_view_goes_hdr` | `deep-gpu run --planted` | A view that draws 3D over a 2D page presents HDR too | AC4 |
| `keeps_hdr_layer` | `DEEP_HDR_PLANT` (hdr-fixture build) | The HDR layer stays in the window once the HDR view closes | AC4, live (Scope's last line) |
| `surface_resizes_late` | `DEEP_HDR_PLANT` | The HDR surface takes each new size a frame after GPUI's layer | AC4, live (Scope's last line) |
| `auto_waits_for_headroom` | `DEEP_HDR_PLANT` | `auto` turns HDR on only once the current headroom reads above 1, which nothing else asks for | AC5 |
| `reads_headroom_every_frame` | `DEEP_HDR_PLANT` | The UI thread reads the display's headroom every frame | AC6 |

The implementer adds the `deep-gpu` names where `Planted::parse` reads them and the app's where its `hdr-fixture` build
reads `DEEP_HDR_PLANT`, reachable only there.

## Criteria to tests

| Criterion | File (tests) | What it asserts |
|---|---|---|
| AC1 `#177.b891d426` | `ac1-paper-white.test.ts` (1 + 4 plants) | The lamps in a window, hdr auto on the stub display (4, 4), and hdr off: the frame presents HDR through `{rgba16float, extended_linear_srgb, edr: true}`; the `linear` target holds 8, 2 and 0.18 (the fixture); in the surface every interior lamp pixel is 4 ± 0.01, the highlight at 2 is `agxTo(2, 4)` = 1.5724 within 1%, nothing exceeds 4.01; every mid-grey pixel encodes within one 8-bit code of hdr off's surface; the fail mark's most common color in `window_linear` encodes to exactly #bf232b. Each plant fails, naming the lamp, the highlight, mid-grey or the status color |
| AC2 `#177.d09c9a85` | `ac2-headroom-change.test.ts` (1 + 1 plant) | Posts 4 → 1.5 before frame 3 and → 1 before frame 6: frame 2's lamp 4 and frame 3's 1.5 (the highlight `agxTo(2, h)`), `hdr.headroom` the display's; frames 6 and 7 present the same `surface` (format and bytes) and pixel hash as hdr off. `reads_headroom_once` fails, naming frame 3 |
| AC3 `#177.ab6f72b4` | `ac3-sdr-outputs.test.ts` (1 + 1 plant) | Two processes, a live view with hdr auto (presenting HDR) or off, then the export, the render-back and the golden of the same revision: export and render-back `final` and `pixel_hash`, and the golden snapshot's `numbers.pixels`, equal across the two. `export_reads_hdr_surface` fails, naming an output |
| AC4 `#177.7ae0f098` | `ac4-card.test.ts` (1 + 2 plants) | The card over the big lamp with HDR on: the lamp around it reads 4 in `window_linear`; every judged card pixel encodes to hdr off's color and none is above 1. The catcher over the page with hdr auto: `hdr.state` off, an SDR surface, the whole window equal to hdr off's. `hdr_layer_above_chrome` and `catcher_view_goes_hdr` fail, naming the card and the catcher |
| AC4, live (Scope's last line) | `ac4-layers.live.test.ts` (2 + 2 plants) | With hdr off, and with hdr auto after the view closed, the window's layers are exactly the merge base's `[{gpui, BGRA8Unorm, kCGColorSpaceSRGB, edr false, opaque true}]` (with HDR on an HDR layer lies beneath GPUI's: the precondition). A 60-frame resize 900 × 600 → 1300 × 860 pt with HDR on in every frame: on 20 lines across the view's edges in each capture, at most 1 device px between the page and the view's color. The two plants fail |
| AC5 `#177.3a1b9bb2` | `ac5-envelope.live.test.ts` (2 + 1 plant) | The envelope on the main display, hdr auto: `hdr.state` on with headroom above 1; the scene's frame time and GPU memory and input on screen PASS (INCONCLUSIVE stays INCONCLUSIVE). The lamps in the app, hdr auto, 120 frames: a frame within 1,000 ms presents HDR with the headroom above 1. `auto_waits_for_headroom` fails, naming auto |
| AC6 `#177.707c9022` | `ac6-budgets.live.test.ts` (2 + 1 plant) | 3024 × 1964 px (1512 × 982 pt at scale 2): five runs of 360-frame pairs, hdr auto against off; the added p95 GPU by `judgeLimit` against 0.2 ms, the added p95 CPU against 0.01 ms, and `headroom_reads` ≤ 1 + `display_posts` in every run. A post of 1.5 before frame 120: the surface's peak reads 1.5 by frame 122 in each of five runs. `reads_headroom_every_frame` fails the reads |
| AC7 `#177.c861c4c9` | `taste.test.ts` (1) | Reads the record only; no pictures, or no call on exactly them, is INCONCLUSIVE, never PASS (The taste call) |

## Fixtures

Generated at test time (`helpers.ts`); no fixture files.

- **The look** (`LOOK`): #424's plain physical look (exposure scale 1, no bloom, no deband, the clean status map) with
  `tone_map: {agx: {white: 8, contrast: 1.25}}`: the design's contrast, its white set to the lamp, so the lamp at 8
  reaches the headroom exactly and the criterion's "reaches 4" is a value, not a range.
- **The lamps** (`lampsDoc`, 480 × 240, orthographic, 40 px per m, a black opaque sky, no lights): the lamp (emission 8:
  8 times paper white), the highlight (emission 2), mid-grey (unlit 0.18), each a 2.4 m square, and a small `tag` box
  whose badge is bound to a verdict in state fail, so the fail mark (a status color) draws on the same view. In a
  520 × 280 window at (20, 20) on a page of grey 200 for AC1.
- **The big lamp** (`bigLampDoc`): one 4 m lamp of emission 8 (160 px) and the card's slot (100 × 100) over its middle.
- **The catcher** (`catcherDoc`): #424's shadow catcher (a catching floor, a 1 m caster, a casting sun) and a 0.6 m lamp
  of emission 8, no sky, over the window's page.
- **The envelope scene** (AC5): an orbit camera turning once in 60 s, a floor, a box the `nudge` toggle lifts, a lamp of
  emission 8 and a casting sun, under #1903's look with agx (white 8), bloom and ambient occlusion; 1,000 inputs a run
  at seeded times (seed 177).
- **The sky** (AC4 live): a flat sky of linear (0.05, 0.3, 0.05), nothing else, so the view's color is uniform.
- **AC3's golden**: a 480 × 240 grey checker blessed by `decide` with `via: "you"`, so each run's `golden` compares and
  reports its own snapshot's pixel hash.

## The roll-off

`agxTo(x, m)` is the look's agx curve per channel with its shoulder ending at the headroom m (never below 1): below
0.18, x^c ÷ (x^c + a) as the look defines it; above, 0.18 + k·d·(1 + d ÷ w) ÷ (1 + k·d ÷ (m − 0.18)) with w = k ×
(white − 0.18)² ÷ (m − 0.18); m at and above white. At m = 1 it is the look's SDR curve; at x = white it is m. On greys
the AgX inset and outset matrices are the identity (their rows sum to 1), so a grey's channels read the curve itself.
The design says agx and neutral "keep their curves below 0.18 and end their shoulders at the headroom"; the Oracle
page's formula gives agx's exactly. Neutral has no such formula in the design or the oracle, so no test fixes its
curve (Not tested).

## Readings where the issue and design leave a choice

- **"Reaches 4 in the surface's linear values"**: 4 within 0.01 at every interior lamp pixel of the f16 surface. With
  the look's white at the lamp's 8 the roll-off reaches the headroom exactly there; a white above 8 would leave the lamp
  under 4 and the criterion unmet, so the fixture sets it. That the shoulder rolls off rather than clips is read on the
  highlight at 2 (Scope: "none clips at it").
- **"Mid-grey keeps its SDR value within one 8-bit code value"**: the HDR surface's mid-grey, sRGB-encoded to 8 bits,
  against the bytes the same view's SDR surface holds with hdr off.
- **"A status color … reads its exact SDR value"**: read in the window as composited, so it holds wherever the status
  mark is drawn (in the view's surface or in GPUI's layer above it): the mark's most common color, exactly.
- **"The next frame rolls off to 1.5"**: a change the display posts after frame n − 1 presents is followed by frame n.
- **"At 1 the view presents SDR, byte for byte as with hdr off"**: the surface frame 6 presents has the same format and
  bytes as hdr off's frame 6, and the same pixel hash. A view that kept presenting f16 values equal to the SDR curve
  would not be "byte for byte" and fails.
- **"HDR output on or off"** in AC3 is the live view's session state on the stub display at headroom 4 in the same
  process, before the export, render-back and golden; the run with it on must present HDR, or nothing was compared.
- **"Draws first and opaque"** against **"3D over a 2D page"**: the lamps and the card's view draw an opaque sky over
  their whole view; the catcher's view has no sky, so the page shows through it and its catcher composites over it.
- **"A capture of the window"** headless is `window_linear`, the layers composited as the compositor would; on the real
  display it is the live captures. "Covers it … at its exact colors": the card's slot less a 2 px border and its 16 px
  corners (its rounded corners show the view), each pixel the 8-bit color it has with hdr off and none above 1.
- **"The window's layers equal the merge base"**: the merge base's window has GPUI's one layer, read from its code
  (BGRA8Unorm, opaque, tagged sRGB, no EDR); the report lists the window's Metal layers. "Closed" is the view closed
  in a window that showed it with HDR on.
- **"More than 1 device pixel between the SDR chrome and the HDR surface's edge"**: along 20 lines across the view's
  edges in each of the 60 captures, the widest run of pixels that are neither the page's grey nor the view's color
  (within 3 codes). An HDR surface reaching under the chrome is covered by it and doesn't count.
- **"Compared with the merge base"** (AC6): the merge base has no HDR output, so its frame is the same view with hdr
  off, drawn through the SDR surface as at the base; what HDR adds is the p95 difference (#1434's reading). The design's
  whole-budget regression check against the merge base stays the perf lane's. A negative difference counts as 0.
- **"Nothing on the CPU per frame"**: the headroom is read only once the HDR surface shows and on each change the
  display posts, and the added p95 UI-thread time per frame is under 0.01 ms, the resolution taken as nothing.
- **"A changed headroom takes effect within 2 frames"** (AC6): live, a post before frame 120 shows in the HDR surface's
  peak by frame 122. AC2 already holds the headless view to the next frame.
- **AC5's "beside every other pass"**: the envelope's scene with the passes this suite can name (agx, bloom, AO, a
  casting sun's shadow) and HDR on; "holds the envelope's totals" is the scene's frame time and GPU memory
  verdicts PASS, the rest of the envelope (calibration asks, `separate-items`) being #1903's. "Within 1 s" is from the
  view's first presented frame.

## Legs that read BLOCKED or INCONCLUSIVE

- Off macOS, or an `unsupported_platform` answer: every test, INCONCLUSIVE.
- Without `DEEP_177_LIVE=1`: every test in the three `*.live.test.ts` files, INCONCLUSIVE.
- AC5 off a reference Mac with an XDR display (Mac15,7 or Mac17,10) or out of its conditions (mains, Low Power Mode
  off, thermal nominal; #1903's `offReference`), or when the display reports a potential headroom of 1: INCONCLUSIVE.
  A frame time, GPU memory or input verdict of INCONCLUSIVE under the five-run rule: INCONCLUSIVE.
- AC4 live and AC6 when the window's display reports a potential headroom of 1: INCONCLUSIVE. AC6 at a scale other than
  2: INCONCLUSIVE; its timings off the reference Macs, out of their conditions or under load (`judgeLimit`), or neither
  all within nor all over: INCONCLUSIVE; with the display's headroom at or below 1.5 before the post: INCONCLUSIVE.
- AC4 live's `surface_resizes_late` when the planted run never turned HDR on: INCONCLUSIVE.
- AC7 with no pictures in `docs/evidence/177/`, no `TASTE.json`, or a call on other pictures: INCONCLUSIVE.
- Nothing reads BLOCKED here; a `judgeLimit` BLOCKED (fewer than five readings) fails the test.

## The taste call

The check run writes three screenshots from the app at the reference window to `docs/evidence/177/`:
`lamp-hdr-on.png` (the lamp at 8 times paper white with HDR on, an HDR capture), `lamp-hdr-off.png` (the same with hdr
off) and `card-over-view.png` (the question card over the view). They are attached to the PR and shown to the owner in
the session. The one call goes in `tests/acceptance/177/TASTE.json`:

```json
{ "issue": 177, "criterion": "#177.c861c4c9", "verdict": "looks_right", "who": "…", "when": "2026-11-16T09:00:00Z",
  "screenshots": { "lamp-hdr-on.png": "<sha256>", "lamp-hdr-off.png": "…", "card-over-view.png": "…" }, "note": "…" }
```

`verdict` is `looks_right` or `looks_wrong`. No test judges a picture. This job writes no TASTE.json and no picture.

## Not tested, and why

- **Neutral's and filmic's HDR curves**: the Scope says neutral ends its shoulder at the headroom and filmic stays SDR,
  but no criterion states a value for either and neither the design nor the oracle gives neutral's HDR formula.
- **Chrome surfaces lit by #1437** reading the same headroom: #1437 is blocked by this issue; nothing to drive yet.
- **The layer-stack record** (the GPU and compositor cost of both stacks at 3024 × 1964, how they stay in step): a
  record, not behavior; no criterion reads it. The resize and layers legs check the stack that ships.
- **The headroom from another display, battery or brightness**: only the stub's posts and the real display's report are
  driven; a move between displays isn't.
- **`hdr` as session state surviving a reopen**, and the memory estimate counting the HDR slots: no criterion.
