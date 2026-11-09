# Acceptance tests for #1479: big text draws from outlines instead of vanishing; live and snapshots agree past the atlas limit

Written first, blind, from issue #1479 (its scope, five acceptance criteria, proof line and "Not in scope"), the
issues it names (#385, whose first criterion it holds the label to; #241, its epic; #1481, what is out of scope;
#1426, what it depends on), the design sections it links and those they lean on, and base commit `dd83ac2f`
("Merge pull request #1692 …"), by a job that never saw an implementation; none existed. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- `docs/canvas-primitives.md`: Text `text@1` (Semantics: the run's glyphs come from the core's atlas, rasterized by
  Vello CPU from their outlines, where GPUI draws a 2D writer layer; baselines rounded to a whole device pixel above
  every draw path, "outlined text included, so a live frame and a snapshot take one baseline"; "A glyph past the
  atlas limit draws as a path from its outline, and one with no outline draws from the atlas at its largest size and
  says so in the frame report, so a glyph never vanishes silently"; Cost: "1 MB per atlas page; glyphs above about
  64 px draw as paths"); Marks in 3D (raster sizes in steps of about 12%; "curves tessellated once per content key");
  Path (tessellation "cached by (content key, bucket)", zoom buckets of 2×); The cost model; The trusted compositor.
- `docs/technical-design.md`: the parity suite (planted-fault twins, goldens, "Images from two renderers compare
  through one perceptual oracle, written as reviewed test code"); the canvas line of How we know version 0 works
  ("GPUI's 2D against Vello CPU through the perceptual oracle"); the per-seam suites ("a headless snapshot that
  matches the settled live view"); Wrong programs (a planted twin lives in test code or behind a feature a release
  build refuses, never an environment variable); Dogfooding.
- At the base: `crates/deep-text/src/atlas.rs` (`MAX_DEVICE_SIZE` 256: `glyph_at` remembers `None` past it and
  rasterizes nothing; `rasterized()` counts the glyphs it rasterized), `crates/deep-text-gpui/src/lib.rs` (`place`
  skips a glyph the atlas returns `None` for; `Painted.rasterized`), `crates/deep-text-render` (`render`: `draws`,
  `pages`, `uploads`, scale 1 only), `crates/deep-marks-render` (`deep-canvas-render render`: GPUI's frame path with
  the view's zoom as the window's scale factor, answering `texts`; `raster`: Vello CPU at the view's zoom, answering
  `texts` with each glyph's `advance`, `outline` and `transform`; `view.zoom` refused above 8; `layer.rs`'s `runs`
  and `Planted`), `crates/deep-gpu-layer/src/marks2d.rs` (#385's `layers` call, at scale 1 only), and the suites
  `tests/acceptance/385/` (parity.test.ts and its oracle), `381/`, `390/` and `140/view/` (conventions, planted
  names, the live-headless calls).

What the base already does and these tests don't credit: `raster` (Vello CPU) draws text at any size, and `render`
(GPUI) draws it from the atlas up to 256 device px a em, within 2% and 0.1 device px of Vello CPU (this job ran the
oracle below on 13 to 250 device px text at the base: every case passes). Past 256 device px `render` draws none of
the label's glyphs and says nothing; `view.zoom` above 8 is `bad_input`; no answer reports what the atlas
rasterized.

## Run them

```sh
npm ci                                   # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/1479 --no-file-parallelism
npx tsc -p tests/acceptance/1479/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Each file first runs `cargo build --locked --bin deep-canvas-render` in the checkout (cached after the first file),
copies the binary out of `target/debug` under its own name into a temporary folder, and fails each test when the
build fails. Each test writes PNGs into its own temporary folder and deletes it. The tests use node built-ins and
vitest. A run with `--root` may leave Vitest's cache in `tests/acceptance/1479/node_modules/.vite`; delete it.
`BASE-FAILURE.txt` is the run at the base.

`scripts/lanes.mjs` needs this folder in `alone` (the files build a cargo binary and draw with GPUI), as #385's and
#140's are; this README is the instruction, the implementer makes the edit.

**Where each test can run.** Coverage runs on any Mac: GPUI draws offscreen through its Metal renderer, headless, as
#385's and #391's suites do; no display, person or permission is needed. Off macOS, and on an answer of
`unsupported_platform`, a test fails `INCONCLUSIVE:`, never passing. The issue's "the reference Mac for the live
view" is criterion 5's, which no test here runs (below).

## The surface under test

The issue names the atlas, the label's paint, Vello CPU snapshots, the shaper's outlines, the frame report, a label
"at scale 2", a title "zoomed 1× to 16× over 120 frames" and a planted drop, but no binary, call or field. These
tests drive the binary the base already proves GPUI's frame against Vello CPU through, `deep-canvas-render`, with
the fewest additions the criteria need. No new binary.

- **`deep-canvas-render render`** (#391; GPUI's frame path, the app's): a document's view drawn headless with GPUI's
  offscreen Metal renderer at the view's zoom (the window's scale factor), written as a PNG of the document's size
  times the zoom in device px. Text draws as the app draws a 2D writer layer's `text@1` (deep-text-gpui).
- **`deep-canvas-render raster`** (#373; Vello CPU, as snapshots and goldens draw): the same document at the same
  zoom, and `texts.<item>.glyphs` with each glyph's `transform` (its pen position) and `advance`, as at the base.
- **`view.zoom`** takes at least 1 to 16 on both (the base refuses above 8). "Scale 2" and "zoomed to 16×" are this
  zoom: device px = u × zoom.

Added by this issue (names chosen here; see Open questions):

- **`rasterized`** on `render`'s answer, the frame report's count: the glyphs the canvas's atlas rasterized while
  drawing the line, its prepaint included (`Atlas::rasterized()` before and after; `Painted.rasterized` counts only a
  paint's own). A fresh process starts with an empty atlas.
- **`planted: "drops_glyph"`** on `render` (beside the base's `gpui_oklab_gradient`): the wrong program of criterion
  1. An unknown `planted` stays `bad_input`.

The documents are built in `helpers.ts`: one `text@1` item showing `HIMN` in the `body` face (Inter), in the role
`ink`, under a role map whose `ground` is black and `ink` white, so a pixel's red channel ÷ 255 is the text's
coverage there. H, I, M and N keep their ink inside their own advance, so each glyph's coverage is read in its own
band of columns. No fixture files.

### Planted programs

| Name | Where | The wrong program | Criterion |
|---|---|---|---|
| `drops_glyph` | `deep-canvas-render render`'s `planted` | GPUI's frame leaves out the second glyph (index 1) of every text item's run, silently, as the base's `place` leaves out a glyph the atlas refuses; everything else draws as without it | 1 (issue-named: "A planted drop fails, naming the glyph") |

## Criterion → test

| Criterion | Test |
|---|---|
| C1 a 300 u label at scale 2 draws every glyph and holds #385's first criterion against Vello CPU; a planted drop fails, naming the glyph | `label.test.ts`: `HIMN` at 300 u, zoom 2 (600 device px a em; 1840 × 840 px), by `render` and by `raster`. Every glyph drawn (each glyph's band holds at least half of Vello CPU's coverage there); the glyph run's summed coverage within 2% of Vello CPU's and its centroid within 0.1 device px. `drops_glyph`: exactly one glyph is named missing, glyph 1 `"I"` with its glyph ID, and the run's summed coverage is more than 2% short. |
| C2 a 40 u title zoomed 1× to 16× over 120 frames has no frame with a missing glyph | `zoom.test.ts`: frame k at zoom 16^(k/119), k = 0 … 119 (1× to exactly 16×, 40 to 640 device px a em), all 120 by one `render` process in order, so each frame inherits the atlas and caches the last left; the same 120 by one `raster` process. No frame refused, and no glyph of any frame missing (under half of Vello CPU's coverage in its band). |
| C3 crossing the threshold moves the coverage centroid by at most 0.1 device px | `threshold.test.ts`: `HIMN` at 32 u at zoom 1.97 (63.04 device px) and 2.03 (64.96 px), each by `render` in a fresh process and by `raster`. Both sides draw every glyph; the under side's frame reports `rasterized` > 0 and the over side's 0, so the two sides are drawn two ways; the offset of GPUI's coverage centroid from Vello CPU's changes by at most 0.1 device px across the crossing. |
| C4 above the threshold the atlas rasterizes 0 glyphs | `threshold.test.ts`: 40 u at zoom 2, 4 and 6 (80, 160, 240 device px: over the threshold and under the base's 256 px limit, where the base rasterizes) and 300 u at 2 (600 px), each in a fresh `render` process: every glyph drawn and `rasterized` 0. Its twin: 13 u at 1× in a fresh process reports at least 4, so the count counts (a constant 0 fails it). |
| C5 screenshots at 1×, 8× and 16× beside Vello CPU's, a recording of the zoom, one taste call | Not tested; open (below). |

Proof line ("the failing test first, then the coverage table and the planted drop"): `BASE-FAILURE.txt`, then
`label.test.ts` (the coverage of the run against Vello CPU, and `drops_glyph`).

## Readings where the issue and design leave a choice

- **"At scale 2"** and **"zoomed 1× to 16×"** are the view's zoom on `deep-canvas-render`, which the base already
  makes the window's scale factor, so device px = u × zoom on both renderers. #385's `deep-gpu run` `layers` call,
  where its first criterion was proven, draws at scale 1 only; a document holding one text item makes `render`'s
  frame that item's glyph run, so the frame's coverage is the run's coverage (#385: "each glyph run's … coverage,
  summed over its pixels in the window").
- **"Holds #385's first criterion against Vello CPU"** is that criterion's edge check for a glyph run: summed
  coverage within 2% of Vello CPU's, coverage centroid within 0.1 device px (Euclidean), coverage = red ÷ 255 here,
  the centroid weighted by pixel centres. Its interior-pixel half compares GPUI with the GPU layer, which this issue
  doesn't touch, so it isn't asserted.
- **"Draws every glyph"** and **"a missing glyph"** are read per glyph in its band of device-px columns, from its pen
  position (`raster`'s `transform`) one `advance` on, at the zoom: a glyph is missing when GPUI's coverage there is
  under half of Vello CPU's. The issue gives no per-glyph tolerance; half is this job's line between drawn and
  vanished, and anything partly drawn still fails the run's 2%. The glyph is named by its index in the run, its
  grapheme and its glyph ID.
- **"Over 120 frames"** is 120 frames drawn by one `render` process, one per line at its zoom, in order. Each `render`
  line opens its own view; what carries across frames is the process's atlas, shaped runs and outline cache, which is
  where a glyph would go missing over a long zoom (a full atlas, an evicted page). The zoom steps are geometric, so
  every frame grows by the same factor (about 2.4%) and the threshold (1.6×) and the base's limit (6.4×) are crossed
  between frames.
- **"Crossing the threshold moves the coverage centroid"**: two text sizes on either side of 64 device px can't share
  a centroid, and the baseline rounding moves each by up to half a pixel, so the move is read against Vello CPU at
  each size: the vector from Vello CPU's centroid to GPUI's, under and over the threshold, differs by at most 0.1
  device px. That the threshold is crossed at all is read from `rasterized`: the atlas draws the under side and
  rasterizes nothing for the over side. 32 u at 1.97 and 2.03 is 63.04 and 64.96 device px; neither is near 256.
- **"The threshold is the design's 64 device px"** is the em size in device px (the text's size in u × the zoom), as
  the atlas keys and limits glyphs by device size.
- **"The atlas rasterizes 0 glyphs"** is read in a fresh process, so no glyph is already there, through the frame
  report's count. The sizes between 64 and 256 device px are where the base rasterizes; at 600 px the base already
  rasterizes none (it draws nothing), so that case passes only if every glyph is drawn too.

## Open questions / names chosen

The owner may rename any of these; the tests then change only in the name.

- **The surface**: `deep-canvas-render render` (GPUI) against `raster` (Vello CPU), not `deep-gpu run`'s `layers`
  (#385) or `deep-text-render render` (#390), because it is the only one at the base that draws GPUI's frame at a
  scale other than 1 and reports a run's glyphs beside Vello CPU's at the same zoom. Adding a `scale` to `layers`
  would serve as well.
- **`view.zoom` up to 16**: the base caps it at 8. Criterion 2 needs 16×.
- **`rasterized`** on `render`'s answer: the name of `deep_text::Atlas::rasterized()` and of
  `deep_text_gpui::Painted.rasterized`, the base's own count. The issue calls the place "the frame report"; if the
  owner wants it under a `text` or `report` object, only `rasterized()` in helpers.ts moves.
- **`planted: "drops_glyph"`** on `render`: named after #385's `shifts_glyph_quads` and #140's `shifts_gpu_pixel`;
  set through `render`'s existing `planted` field, never an environment variable (design: Wrong programs). It drops
  glyph index 1 so the test can say which glyph must be named.
- **The no-outline fallback's frame report** (Scope: "a glyph with no outline draws from the atlas at the largest size
  and says so in the frame report") has no criterion and no field name, so nothing asserts it; the bundled faces all
  have outlines, so no document here reaches it.

## Not tested

- **Criterion 5** (screenshots at 1×, 8× and 16× beside the Vello CPU snapshot, taken by the check run from the
  canvas at the reference window, a recording of the zoom, attached to the PR, one taste call): the issue and design
  name no surface for the check run's screenshots or recording (no binary, command, path or artifact name), and the
  taste call needs a person. It stays INCONCLUSIVE until a person records the call; no test here reads a picture to
  judge it. Open: the command that takes the screenshots and the recording, and where the record of the call goes.
- **"Cached by content key and zoom bucket like any shape"** (Scope): no criterion states a value for it. #391's
  `session` `caches` could show the outline tessellations by bucket; not asserted here.
- **The 1 MB page cost at 256 px** (Scope's reason for the threshold): no criterion.
- **Scaling text without raster steps** is #1481's (Not in scope); **Vello GPU** and the interior-pixel half of
  #385's criterion aren't this issue's.
