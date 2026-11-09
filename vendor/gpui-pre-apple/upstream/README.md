# The GPUI patches we carry (#1426)

Zed closed our pull request unmerged on October 28, 2026: https://github.com/zed-industries/zed/pull/66114. The maintainer's reason was that they were missing the motivation for it, with no earlier discussion with the team. So nothing here has an end date: every change below is ours to carry, on `gpui-pre` and `gpui-pre-apple` 0.3.9 and on `quickjs-jit-runtime` 0.12.11 at the commit gpui-shell pins.

## Carried patches

| Behavior | Issue | Files | Test | Budget | Removal |
|---|---|---|---|---|---|
| The sRGB layer tag: the window's `CAMetalLayer` is tagged sRGB, which GPUI leaves to AppKit | #140 | `vendor/gpui-pre-apple/Cargo.toml`, `vendor/gpui-pre-apple/src/metal_renderer.rs`, `vendor/gpui-pre-apple/src/metal_renderer/layer_colorspace.rs` | `tests/vendor-srgb.test.mjs › gpui-pre-apple tags the layer it configures sRGB` | — | gpui-pre's `MetalRenderer` tags the layer it configures with an sRGB colorspace |
| The drawable read-back: the next frame a window draws reads back from its layer, for the color check | #140 | `vendor/gpui-pre-apple/src/metal_renderer.rs`, `vendor/gpui-pre-apple/src/metal_renderer/layer_colorspace.rs` | `tests/acceptance/140/gpu/color.live.test.ts › AC5 status color swatches read back from the surface as the same 8-bit values (live) › AC5 every status color of the look, drawn through each Metal layer the app presents through, reads back from that layer as the look's 8-bit values` | — | gpui-pre hands a window's last presented drawable back for reading |
| Presented times: a hook gets each drawable's label and `presentedTime` | #140 | `vendor/gpui-pre-apple/src/metal_renderer.rs`, `vendor/gpui-pre-apple/src/metal_renderer/presentation.rs` | `tests/acceptance/140/view/timing.test.ts › #140.81e434c9 (C2) display timing: predicted presentation within one refresh at 60 and 120 Hz; a still scene schedules no wakeups › #140.81e434c9 (C2) a moving film in the app's window, paced at 60 Hz and at 120 Hz: every presented frame's predicted presentation is within one refresh of its measured one` | — | gpui-pre reports each drawable's label and `presentedTime` through a public hook |
| The exact gradient mode: `ColorSpace::OklabExact`, through the sRGB curve, premultiplied, with no dither | #391 | `vendor/gpui-pre/src/color.rs`, `vendor/gpui-pre-apple/vendor/gpui/src/color.rs`, `vendor/gpui-pre-apple/src/shaders.metal`, `vendor/gpui-pre-apple/src/shaders_carried.metal` | `tests/acceptance/391/gradient.test.ts › AC6 a two-stop OKLab gradient from black to sRGB 0.2, drawn by GPUI through the patch's exact gradient mode, reads 13 at its midpoint, with identical rows › AC6 the exact mode: the midpoint reads 13 and every row of the horizontal gradient is identical` | — | gpui-pre adds a gradient mode that mixes in Oklab, through the sRGB curve, premultiplied and undithered |
| The GPU ledger: frame command buffers committed and completed, and their GPU time | #391 | `vendor/gpui-pre-apple/src/metal_renderer.rs`, `vendor/gpui-pre-apple/src/metal_renderer/gpu_ledger.rs` | `tests/acceptance/391/still.test.ts › AC1 a still view uses no GPU time › AC1 the same board while its live layer moves uses GPU time at every vsync, so the counters are not a fixed zero` | — | gpui-pre reports each frame's command buffers, their completion and their GPU time |
| A frame on demand: `HeadlessAppContext::present_frame` presents through GPUI's own frame path | #391 | `vendor/gpui-pre/src/app/headless_app_context.rs`, `vendor/gpui-pre/src/app/headless_app_context/present_frame.rs` | `tests/acceptance/391/clock.test.ts › AC5 a still figure whose placement starts at 3 s and whose spring settles at 4.2 s presents frames at both times by the frame clock alone › AC5 the armed run presents its first frame, then nothing until 3 s, every vsync while the spring moves, the settled frame at 4.2 s, and nothing after` | — | gpui-pre's `HeadlessAppContext` presents a frame on request through its own frame path |
| The tinted mask sprite: `AtlasKey::Mask`, `Window::paint_mask_sprite` and `Window::remove_mask_page` | #390 | `vendor/gpui-pre/src/platform.rs`, `vendor/gpui-pre/src/platform/mask_params.rs`, `vendor/gpui-pre/src/window.rs`, `vendor/gpui-pre/src/window/mask_sprite.rs` | `tests/acceptance/390/atlas.test.ts › AC3 two labels in two colors from one shaped run share one atlas page and draw through the patch's tinted mask sprite › AC3 the two labels have one coverage mask tinted per instance: equal red channels, different green` | — | gpui-pre paints a tinted monochrome sprite from an atlas page it doesn't own |
| The mask rect write: `Window::write_mask_rect` overwrites a rectangle of an uploaded mask page in place, so a new glyph costs its own bytes and the page keeps its key | #1480 | `vendor/gpui-pre/src/platform.rs`, `vendor/gpui-pre/src/platform/mask_rect.rs`, `vendor/gpui-pre/src/window.rs`, `vendor/gpui-pre/src/window/mask_rect.rs`, `vendor/gpui-pre-apple/src/metal_atlas.rs`, `vendor/gpui-pre-apple/src/metal_atlas/rect.rs` | `tests/acceptance/1480/upload.test.ts › AC1 one new 26 px glyph on a warm page uploads at most (w + 2) x (h + 2) bytes › AC1 the new glyph's own rectangle goes up in each of two windows, and nothing else` | — | gpui-pre writes a rectangle into an atlas page it uploaded |
| Frames only on request: `HeadlessAppContext::draw_on_request`, `request_frame` (no forced render; answers whether GPUI drew) and `simulate_resize`, so a replica draws only the frames a real window would | #1546 | `vendor/gpui-pre/src/app/headless_app_context.rs`, `vendor/gpui-pre/src/app/headless_app_context/request_frame.rs` | `tests/acceptance/1546/ac1-journey.test.ts › #1546 AC1 a record event reaches the window by itself, and the replica reads the frame it drew › an ask raised on the record is drawn with no input: the frame drawn after it lists the row and the new count, and equals a forced one` | — | gpui-pre's `HeadlessAppContext` delivers a frame request with no forced render, says whether it drew, and resizes a window through its platform callback |
| Headless scale: `HeadlessAppContext::simulate_scale_factor_change`, so a render reads at scale 1 | #390 | `vendor/gpui-pre/src/app/headless_app_context.rs`, `vendor/gpui-pre/src/app/headless_app_context/scale_factor.rs` | `tests/acceptance/390/atlas.test.ts › AC3 two labels in two colors from one shaped run share one atlas page and draw through the patch's tinted mask sprite › AC3 the two labels have one coverage mask tinted per instance: equal red channels, different green` | — | gpui-pre's `HeadlessAppContext` lets a test change the scale factor |
| Hits at a point: `Hitbox::element` and `Window::hits_at`, the hit test a replica asks before a pointer action, so it names what covers the target | #124 | `vendor/gpui-pre/src/window.rs`, `vendor/gpui-pre/src/window/hits.rs` | `tests/acceptance/124/ac6-scrim.test.ts › ${AC.scrim} a click on Save under a transparent scrim is refused naming it, delivered once it is gone, and the probe names it without dismissing it › ${AC.scrim} the probe on Save names the scrim without dismissing it, and answers the same hit test as the click` | — | gpui-pre exposes a window's own hit test at a point, with the element that inserted each hitbox |
| What each identified element painted: `Window::note_painted` in a div's paint, and `note_paints` and `take_painted`, so a replica's motion recording has every element's bounds and opacity at each step | #1427 | `vendor/gpui-pre/src/window.rs`, `vendor/gpui-pre/src/window/painted.rs`, `vendor/gpui-pre/src/elements/div.rs` | `tests/acceptance/1427/scope-recording.test.ts › #1427 scope: a journey records every element's bounds, opacity and text at each 1/120 s step, keyed by stable identity › Fade in: fade-row's opacity rises a tick at a time, never more than 10% between frames` | — | gpui-pre exposes each painted element's bounds and opacity by its global id |
| Line breaks by the Unicode rules: `wrap_line`, `truncate_wrapped_line` and a shaped line's wrap break only where UAX #14 at Unicode 17.0.0 allows, through the ICU segmenter `deep-text` uses, instead of by an allow-list of word characters; a shaped line wraps in text order, and one whose glyphs run out of text order (right-to-left text, a reordered vowel sign) has each row laid out on its own | #1550 | `vendor/gpui-pre/Cargo.toml`, `vendor/gpui-pre/src/text_system/line_wrapper.rs`, `vendor/gpui-pre/src/text_system/line_wrapper/breaks.rs`, `vendor/gpui-pre/src/text_system/line_layout.rs` | `tests/acceptance/1550/redraft/wrap.test.ts › #1550.8fc59257 (C3) every boundary chrome picks over LineBreakTest.txt at narrow widths is a break the file allows` | — | the pin moves to gpui-pre 0.3.11 or later, which breaks lines by ICU's segmenter upstream (its stable one, at 15.1's rules) |
| gpui-pre's manifest: the library alone, its own workspace, and upstream's one deprecation allowed | #390 | `vendor/gpui-pre/Cargo.toml` | `tests/acceptance/390/atlas.test.ts › AC3 two labels in two colors from one shaped run share one atlas page and draw through the patch's tinted mask sprite › AC3 the two labels have one coverage mask tinted per instance: equal red channels, different green` | 1 over: cargo refuses a `[[example]]` or `[[test]]` whose file isn't there, so upstream's entries go with the files we don't vendor | none: vendoring needs our own manifest while any row above stands |
| The BGRA surface: `paint_surface` takes a premultiplied BGRA buffer, with the planted twins `DividesAlpha` and `AfterScene` | #377 | `vendor/gpui-pre-apple/build.rs`, `vendor/gpui-pre-apple/src/metal_renderer.rs`, `vendor/gpui-pre-apple/src/metal_renderer/bgra_surface.rs`, `vendor/gpui-pre-apple/src/shaders_carried.metal` | `tests/acceptance/377/handoff.test.ts › #377.756c6dce the surface handoff passes parity/gpu/surface-handoff.scene against the copy path on this machine › #377.756c6dce captured from the window, the glow beyond the 3D object over the 2D page and the 50% pane match the f64 premultiplied over of the slot onto the page within one code value, on both paths` | — | none: zed closed zed-industries/zed#66114 unmerged on October 28, 2026 |
| The surface reports: which surfaces a frame's command buffer samples, and its completion | #377 | `vendor/gpui-pre-apple/src/metal_renderer.rs`, `vendor/gpui-pre-apple/src/metal_renderer/bgra_surface.rs`, `vendor/gpui-pre-apple/src/metal_renderer/gpu_surfaces.rs` | `tests/acceptance/377/handoff.test.ts › #377.756c6dce the surface handoff passes parity/gpu/surface-handoff.scene against the copy path on this machine › #377.756c6dce the conformance run: macOS passes every part of the fixture on this machine, keeps the zero-copy path, and health shows no handoff reading` | — | none: zed closed zed-industries/zed#66114 unmerged on October 28, 2026 |
| Chrome layers in the scene: `Window::paint_chrome_layer`, `paint_chrome_backdrop`, `paint_chrome_effect` and `guard_from_chrome`, a layer's subtree drawn to its own scene while its paint stays in the root's, and the planted twins `plant_multiplies_per_element` and `plant_effects_after_frame` | #1434 | `vendor/gpui-pre/src/scene.rs`, `vendor/gpui-pre/src/scene/chrome.rs`, `vendor/gpui-pre/src/window.rs`, `vendor/gpui-pre/src/window/chrome_layer.rs` | `tests/acceptance/1434/ac1-group-opacity.test.ts › #1434 AC1 two overlapping quads in a 50% layer: every pixel of the overlap equals the composite of the group › AC1 a planted renderer that multiplies 0.5 per element (DEEP_CHROME_PLANT=multiplies_per_element) fails, naming the pixel` | — | gpui-pre composites an element's subtree offscreen once, reads what is drawn beneath an element and draws a registered pass at an element's place in paint order |
| Chrome layers on Metal: a layer's offscreen target composited once, a backdrop copied from the drawable at full, half or quarter scale, a registered operator's runs, and the slot drawn premultiplied with its clip and edge, with the planted twin `Planted::StraightAlpha` | #1434 | `vendor/gpui-pre-apple/src/metal_renderer.rs`, `vendor/gpui-pre-apple/src/metal_renderer/bgra_surface.rs`, `vendor/gpui-pre-apple/src/metal_renderer/chrome_layers.rs`, `vendor/gpui-pre-apple/src/metal_renderer/layer_colorspace.rs`, `vendor/gpui-pre-apple/src/shaders_carried.metal` | `tests/acceptance/1434/ac3-slot-order.test.ts › #1434 AC3 a slot between two elements draws in order, with rounded corners within one code value of the reference › AC3 a planted straight-alpha path (DEEP_CHROME_PLANT=straight_alpha_slot) multiplies translucent pixels twice and fails, naming one` | — | gpui-pre's Metal renderer draws those three primitives |
| The panel host's switch: `deny_native_code`, its read-back and `limit_heap` | #358 | `vendor/quickjs-jit-runtime/Cargo.toml`, `vendor/quickjs-jit-runtime/src/carried.rs`, `vendor/quickjs-jit-runtime/src/lib.rs` | `tests/acceptance/358/spike.live.test.mjs › #358.fc68d243 a release-profile host runs gpui-shell's numeric kernel on the interpreter, while the switch's control enters native code on the same kernel` | 2 over: the manifest drops upstream's dev-dependencies, bins, benches and tests, whose files we don't vendor, in two blocks cargo won't accept in place | longbridge/quickjs-jit adds a switch that denies native code, with its read-back and a heap limit |
| A row's AXIndex: AccessKit's macOS adapter answers `accessibilityIndex` from a node's row index, so VoiceOver reads a long table's rows by number | #1477 | `vendor/accesskit_macos/src/node.rs` | `tests/acceptance/1477/built.test.ts › #1477.035131da if built: with VoiceOver active, the tree holds a row node for each visible row, and arrows, Shift ranges, Enter and ⌘C as TSV work. With no assistive tech running it costs 0 extra allocations › #1477.035131da read through the Accessibility API, the tree holds one row node with 8 cells for each visible row; Down, Up, Shift-Down, ⌘C (TSV of the cells read) and Enter work; and an ours arm with no assistive tech allocates nothing for accessibility` | — | accesskit_macos implements `accessibilityIndex` for rows from their row index |

`node scripts/vendor-rebase.mjs check`, in the lint lane, compares each vendored file with its pinned release against this table. It reads the release from the network once, then from `~/.cache/deepbuild/vendor-releases`; with neither it reports `BLOCKED`, which fails the lane.

- Every changed file of every tree under `vendor/` has a row, and every row an issue, a removal condition (the upstream change that would retire it, or `none: <reason>`) and a test by its full path and its name in that suite's own list: `vitest list`, the tests a `node --test` file registers, or `cargo test -- --list`. A vendored `LICENSE` needs none. A tree with no manifest, such as `unicode-17.0.0`, is pinned by its folder's name and checked against the SHA-256 list in its README.
- Every carried hunk has the mark `DeepBuild patch (windoliver/deepbuild#n)` in it, or at most one unchanged line from it, and `n` is the issue of a row that lists its file.
- A hunk holds at most 8 lines, added and removed, and a file gains at most 40. A pure addition goes in a new file with one `mod` line, which can't conflict and counts against neither budget.
- A row over budget says so: `N over: reason`. N is how many of its hunks and files may be over. The numbers are guarded: `scripts/proof-guard.mjs` refuses a change to one that isn't its own signed proposal, so the count falls only with your signature too.

`node scripts/vendor-rebase.mjs diff` prints what we carry. `node scripts/vendor-rebase.mjs merge <crate> <version>` three-way merges a new release onto our tree, leaves conflict markers and lists each as `CONFLICT <path>:<line>`. A clean merge proves the source only: it then runs the tests of the rows that tree carries, and moves the pin only when they all pass. Otherwise it puts the tree back, keeps the pin and names each test that failed.

## Rebase trial

Tried: gpui-pre 0.3.9 -> 0.3.11, gpui-pre-apple 0.3.9 -> 0.3.11, gpui-kit 0.8.0 -> 0.9.0 (November 6, 2026, the newest of each)
Outcome: pin left

| Suite | Result |
|---|---|
| #377 | not run |
| #390 | not run |
| #391 | not run |
| #140 | not run |
| #358 | not run |

The merges of `gpui-pre` and `gpui-pre-apple` onto this tree stop at these conflicts, so no suite could build. gpui-kit 0.9.0 needs `gpui-pre` at exactly 0.3.11, so it moves with them and was not built either.

```
CONFLICT vendor/gpui-pre/src/platform.rs:4
CONFLICT vendor/gpui-pre-apple/Cargo.toml:252
CONFLICT vendor/gpui-pre-apple/build.rs:172
CONFLICT vendor/gpui-pre-apple/src/metal_renderer.rs:143
CONFLICT vendor/gpui-pre-apple/src/metal_renderer.rs:242
CONFLICT vendor/gpui-pre-apple/src/metal_renderer.rs:428
CONFLICT vendor/gpui-pre-apple/src/metal_renderer.rs:670
CONFLICT vendor/gpui-pre-apple/src/metal_renderer.rs:732
CONFLICT vendor/gpui-pre-apple/src/metal_renderer.rs:747
CONFLICT vendor/gpui-pre-apple/src/metal_renderer.rs:1004
CONFLICT vendor/gpui-pre-apple/src/metal_renderer.rs:1502
CONFLICT vendor/gpui-pre-apple/src/metal_renderer.rs:1623
```

Three are small: `platform.rs` and `Cargo.toml` are neighboring additions, and `build.rs` a neighboring rename. The nine in `metal_renderer.rs` have one cause: 0.3.11 moves `gpui_apple`'s renderer from `metal-rs` to `objc2-metal`, about 1,800 changed lines. That's why the pin can't move by a merge: our carried files call the old API, so `src/metal_renderer/bgra_surface.rs`, `layer_colorspace.rs` and `presentation.rs` need porting even though they can't conflict. Moving the additions into new files took the lines of ours inside those conflicts from 231 to 62.

## What was offered upstream (#711)

`0001-gpui_apple-premultiplied-BGRA-surfaces-and-per-frame-surface-reports.patch` is the part of
this crate's `DeepBuild patch (windoliver/deepbuild#377)` changes that isn't DeepBuild's own,
rebased onto zed-industries/zed `main` at `08cbb88` (October 25, 2026) as one commit, with a test
of its own. `0002-...patch` is the review-round-4 follow-up: a replaced hook dropped outside the
lock (with its test), the hook test lock timing out instead of hanging a failed run, the `Hook`
doc on panics, `gpu_surfaces` re-exported from `gpui_macos::metal_renderer`, and
`parking_lot::RwLock`.

What it carries:

- `paint_surface` accepts a `kCVPixelFormatType_32BGRA` pixel buffer beside the 4:2:0 YCbCr video
  frames it took before: one format branch in `draw_surfaces`, one pipeline (source factor one,
  destination factor one minus source alpha, as path sprites blend) and the 7-line
  `surface_bgra_fragment` shader, so a premultiplied slot keeps its color where alpha is zero.
- `metal_renderer::gpu_surfaces`: each frame that samples a BGRA surface reports the buffers it
  samples once its command buffer is encoded (`Event::Encoded { frame, surfaces }`) and its
  completion with the GPU time it took (`Event::Completed { frame, gpu_ns }`), through one
  `set_hook`. This is this crate's `gpu_surfaces` module without `Planted`. The vendored copy
  was aligned with it on 2026-10-25: the hook is called outside the lock (so a hook may replace
  itself from Metal's completion thread, `surface_hook_may_replace_itself` in this crate's
  `metal_renderer::gpu_surfaces::tests`), the report and its frame number are skipped when no hook is
  installed, and the events are named `Encoded { frame }` (the report precedes the commit) and
  `Completed { frame }`; deep-app's `gpu_view.rs` is the one consumer.
- The BGRA shader samples linear, as the YCbCr one does; this crate's samples nearest. At 1:1 on
  snapped bounds both read texel for texel, which is what #377's handoff fixture checks.
- `render_bgra_surface_premultiplied`, in `metal_renderer::tests`: a half-alpha red and an
  alpha-zero green BGRA surface beside a gray YCbCr surface in one batch, rendered headless;
  pixels and both reports checked. A straight-alpha blend for the BGRA pipeline fails it at the
  alpha-zero half; a dropped `sampled_surfaces.push` fails it at the report count; a dropped
  YCbCr pipeline bind after a BGRA surface fails it at the gray half. `surface_hook_may_replace_itself`
  fails (times out) when the hook is called under the lock. The two tests that install a hook take
  one test-only mutex, since the hook is process-wide and `cargo test` runs tests in parallel.
- Reviewed in four rounds by fresh reviewers (this folder's PR). Round 1 found the hook called
  under the lock, the report named for a commit it precedes and the pipeline switch untested; round
  2 found the hook tests racing each other; round 3 found nothing; round 4 (two reviewers, on the
  rebased branch) found the old hook dropped under the write lock, a failed hook test hanging the
  test binary, and the module unreachable from gpui without a direct `gpui_apple` dependency, all
  fixed in `0002`. Round 4 also raised design questions only zed can settle: a process-global
  single-slot hook rather than per-renderer state, surfaces identified by `CVPixelBuffer` address
  as bare `u64` rather than a newtype or `IOSurfaceID`, and whether to split the BGRA format
  support from the reports. The PR description already offers the per-renderer change. Each fix is
  in the patch with a check that fails without it.

What it leaves out, on purpose: the planted twins `DividesAlpha` and `AfterScene` (#377's
acceptance tests only), `gpu_ledger` and `ColorSpace::OklabExact` (#391, a separate offer), and
`paint_mask_sprite` (#390, in `vendor/gpui-pre`).

Reproduce the proof on a Mac:

```sh
git clone --depth 1 https://github.com/zed-industries/zed && cd zed
git fetch --depth 1 origin 08cbb88 && git checkout FETCH_HEAD
git am ../deepbuild/vendor/gpui-pre-apple/upstream/000*.patch
cargo fmt -p gpui_apple --check
cargo clippy -p gpui_apple --all-targets -- -D warnings
cargo test -p gpui_apple
```

Zed's `CONTRIBUTING.md` asks for a discussion before feature code, a signed CLA, and a human
author who understands the change and writes the PR description themself; it doesn't accept pull
requests from autonomous agents. So the pull request is the owner's to open, from their fork;
The pull request was opened from the owner's fork, with the CLA signed:
https://github.com/zed-industries/zed/pull/66114 (`JingW6/zed`, branch `gpui-bgra-surfaces` at
`a639e72d`, these two commits on `08cbb88`, zed main of 2026-10-25; `cargo fmt --check`, clippy
on `gpui_apple` and `gpui_macos`, and the 14 `gpui_apple` tests pass there), linked from #711;
`PR-DESCRIPTION.md` is its description as posted.

How it was opened, for a redo on a new base (sign the CLA at https://zed.dev/cla first):

```sh
gh repo fork zed-industries/zed --clone=false            # once
git clone --depth 1 https://github.com/zed-industries/zed && cd zed
git remote add fork https://github.com/<you>/zed.git
git fetch --depth 1 origin 08cbb88
git checkout -b gpui-bgra-surfaces FETCH_HEAD
git am ../deepbuild/vendor/gpui-pre-apple/upstream/000*.patch   # keep or amend the author line
cargo test -p gpui_apple                                  # 14 pass; attach the output to the PR
git push -u fork gpui-bgra-surfaces
gh pr create --repo zed-industries/zed --base main --head <you>:gpui-bgra-surfaces \
  --title "gpui_apple: premultiplied BGRA surfaces and per-frame surface reports" \
  --body-file ../deepbuild/vendor/gpui-pre-apple/upstream/PR-DESCRIPTION.md   # in your words
```

Then on windoliver/deepbuild#711: paste the PR link under criterion 1.
