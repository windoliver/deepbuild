# Acceptance tests for #398, criterion 6: elements outside the closed list, and the rounded rect

`elements-redraft.test.ts`, with `elements-helpers.ts` and `fixtures/`, covers criterion 6 of issue #398 (Vector art and
formulas) and no other criterion:

> An SVG with a `<clipPath>`, a `<mask>`, a `<pattern>` fill, a `<marker>` and a `<style>` block imports with each
> drawn as listed or named in an issue, and a `rect` with rx 4 imports with rounded corners within 0.01 u; a planted
> importer that skips `<clipPath>` without an issue fails, naming the element.

Written first and blind, from the issue alone, its Oracle page, the design and the base commit, by a job that never
saw an implementation. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job (technical design: Dogfooding).

## What was read

- Issue #398: its scope (the closed-list line: "each element outside it, such as clipPath, mask, pattern, marker,
  switch or a style block, is drawn as listed or returned as an issue naming it, never dropped without one"), its
  Fields, its six criteria and its proof line.
- Its Oracle page (`doneright/oracles/issues/398.md`): criterion 6 pins resvg `77b12f4951`'s
  `crates/resvg/tests/tests/{masking/clipPath, masking/mask, paint-servers/pattern, painting/marker, structure/style,
  shapes/rect}` as "run on our code: SVG and PNG pairs …; each either draws to its PNG through our import or must come
  back as an issue naming the element". Per #136, a linked test counts only when run against our output.
- `docs/canvas-primitives.md`: Vector and formula `vector@1` (line 1812), Document envelope (291), Item and kind (321;
  `at.pos` is three numbers), Rect (1478; `radius`), Path (1514).
- `docs/technical-design.md`: Wrong programs (2501), Dogfooding (2522), the parity suite and the perceptual oracle
  (2542: the blank guard, FLIP pooled as the mean over the subject, GMSD, crushed blacks, ΔE2000 with exposure
  removed, silhouette IoU; "Every comparison between two outputs has a planted-mismatch twin"), the Oracle lanes row
  (2703).
- The base: `crates/deep-marks-render` (`deep-canvas-render`'s `check`, `raster`, `geometry`, and how `planted` is
  read), `crates/deep-canvas/src/document` (the ID grammar, `bad_id`'s fix at `mod.rs` 426; `module_missing`,
  `unknown_kind`), and the precedent suites `tests/acceptance/373`, `385` and `380` (layout, helpers, the blank guard,
  README and BASE-FAILURE format).

The checkout is `8907ed99`, a descendant of the named base `a7e140b2`; `crates/deep-marks-render`, `crates/deep-canvas`
and `docs/canvas-primitives.md` are byte-identical between the two (only `docs/technical-design.md` moved by one line).

## Run them

```sh
npm ci                                  # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/398 elements-redraft.test.ts --no-file-parallelism
```

The file first runs `cargo build --locked --bin deep-canvas-render` and fails every test when the build fails. Each
document's SVG is written into a scratch image store under the OS temp folder, named by its sha256, and deleted after
the run, with the PNGs the raster writes. The tests use node built-ins and vitest only. They type-check under the root
`tsconfig.json`'s strict options with `allowImportingTsExtensions` and `noEmit`, checked as #373's are, with a copy
of the options outside the repo whose `include` is these two files: `tsc -p` exits 0. A run with `--root` may leave
Vitest's cache in `tests/acceptance/398/node_modules/.vite`; delete it. `scripts/lanes.mjs` needs this folder in
`alone` (it builds a cargo binary), as #373's is; this README is the instruction, the implementer makes the edit.
`BASE-FAILURE.txt` is the run at the base.

## The surface under test

The issue names no code API, so the tests extend #373's `deep-canvas-render` with no new subcommand:

- **Documents.** One board, one writer layer, one `vector@1` item `art` with `at.pos: [x, y, 0]` and
  `params: {src, size, colors, alt}`: `src` is the sha256 of the SVG bytes, read from the request's `store`, a folder
  whose files are named by their hashes; `size: [w, h]` in u, the viewBox drawn uniformly scaled onto
  [pos.x, pos.y, w, h]; `colors` maps each color the SVG writes to a look role. Every color is mapped twice, as the SVG
  writes it (`green`) and as lowercase `#rrggbb` (`#008000`), to the same role, and black is always mapped (SVG's
  initial fill); the look draws each role in that color's own sRGB value over a white `ground`. Every ID follows the
  ID grammar and the envelope holds every required field: with no look, the base's core check passes all 37
  documents (`ok: true`, the only notice `unknown_kind`); with the look, only the marks2d module's `module_missing`
  stands in the way (BASE-FAILURE.txt, section 2).
- **`check {doc, look, store, planted?}`** answers the import's issues. An issue names an element when it holds the
  element's tag name (`clipPath`, `mask`, `pattern`, `marker`, `style`) as a string value at any depth outside the
  keys `what` and `fix`. Any severity counts: an element named only in a warning still imports.
- **`raster {out, doc, look, store, t: 0, planted?}`** answers a PNG of the document's size.
- **`geometry {doc, item, store}`** answers `parts: [{id, source, box, subpaths}]`, one per SVG element with an id,
  `box` as [x, y, w, h] in u and `subpaths` in #373's form (`verbs` from M, L, Q, C, Z; `points` in u).
- **The planted twin**, `planted: "import_skips_clip_path"` on `check` and `raster`: an importer that ignores
  `<clipPath>` and raises no issue for it.

## Criterion → tests

43 tests, all in `elements-redraft.test.ts`.

| Criterion part | Tests |
|---|---|
| An SVG with a `<clipPath>`, a `<mask>`, a `<pattern>` fill, a `<marker>` and a `<style>` block imports | `AC6 the SVG imports: the raster draws it, and draws something` |
| … with each drawn as listed or named in an issue | `AC6 <clipPath> …`, `AC6 <mask> …`, `AC6 <pattern> …`, `AC6 <marker> …`, `AC6 <style> is drawn as listed or named in an issue` (5) |
| … the same, on upstream data (Oracle page) | `AC6 resvg <folder>/<name>`: 6 clipPath, 6 mask, 6 pattern, 6 marker and 6 style pairs (30) |
| a `rect` with rx 4 imports with rounded corners within 0.01 u | `AC6 the part r4's outline is the rect [36, 28, 40, 24] u with corners of radius 4, within 0.01 u, and draws so`, and 5 `shapes/rect` pairs (6) |
| a planted importer that skips `<clipPath>` without an issue fails, naming the element | `AC6 a planted importer that skips <clipPath> without an issue fails, naming clipPath` |

## What each test holds

**The hand-written SVG** (`fixtures/elements/elements.svg`, viewBox 240 × 160 drawn at scale 1 onto
[16, 16, 240, 160] of a 272 × 192 board). One region per element, each with probes at least 3 units inside its
edges, read within 2 code values, whose expected colors come from SVG's own rules:

- `<clipPath>`: a rect 10..70 filled #1e7b34, clipped to the clip path's rect 20..40: color at (30, 30) and
  (23, 37), ground at (15, 15), (60, 60), (30, 55), (55, 30) and (45, 45).
- `<mask>`: a rect 90..150 × 10..70 filled #2050c0, masked (user-space region 80..160 × 0..80) by white over 90..120
  and black over 120..150: color left, ground right.
- `<pattern>`: a rect 180..220 × 20..60 filled by a 20-unit user-space pattern tiled from (0, 0) whose top-left
  10 × 10 is #c03020: color in each tile's corner cell, ground in the other three cells.
- `<marker>`: a line to (80, 120) whose `marker-end` is a 12 × 12 #7a2a90 rect, `markerUnits` user space, refX and
  refY 6, `orient` 0, so it covers 74..86 × 114..126: color inside, ground around it.
- `<style>`: a block `.tinted { fill: #208080; }` and a rect of class `tinted` whose fill attribute is #e0a000;
  CSS overrides the presentation attribute, so the rect shows #208080.

An element named in an issue of `check` is accounted for and its probes aren't read; otherwise the raster must have
drawn the SVG and every probe of its region must read as above, or the test fails with a sentence that names the
element (`<clipPath> is neither drawn as listed nor named in an issue: at (60, 60) of the SVG the import draws …`).
The import test asks the raster to draw the SVG (so no element's issue refuses the whole SVG: the criterion says it
"imports") and to draw more than 200 non-ground pixels (the line and the styled rect draw in any case).

The planted test runs `check` and `raster` with the planted twin and asks that the raster draws, that no issue names
`clipPath`, that the clipPath accounting fails with every sentence naming `clipPath`, and that the other four
elements are still accounted for, so the twin skips the clip path and nothing else. Whatever the clean import does
with `<clipPath>` (draws it, or names it in a warning), skipping it unnamed either draws the rect unclipped (ground
probes read #1e7b34) or drops it (color probes read the ground).

**The rounded rect** (`fixtures/elements/rounded.svg`: `<rect id="r4" x="20" y="12" width="40" height="24"
rx="4"/>`, ry unset so it resolves to rx, drawn at scale 1 onto [16, 16, 80, 48] of a 112 × 80 board, so the rect is
[36, 28, 40, 24] u). `geometry` must answer the part `r4` with its box within 0.01 u; every point of its outline
(each segment sampled 64 times) lies within 0.01 u of the boundary of that rect with corner radius 4 (its signed
distance); and every point of that boundary (50 per corner arc and per side) lies within 0.01 u of the outline. A
sharp corner sits 4√2 − 4 ≈ 1.657 u off. The raster's four corner pixels, which lie wholly outside the corner arcs
(nearest point √18 ≈ 4.24 u from each arc's centre), must show the ground, and the middle the fill. A cubic
quarter-circle outline (kappa 0.5523) is 0.0011 u off at most, inside the tolerance.

**The upstream pairs** (`fixtures/resvg/`, copied unchanged from resvg `77b12f4951` with its license notice in
`fixtures/resvg/NOTICE`). Each SVG is imported as it is, its 200-unit viewBox drawn onto [0, 0, 300, 300] of a
300 × 300 board, the size resvg drew its PNG at. If an issue of `check` names an element outside the list that the
SVG holds (`<clipPath>`, `<mask>`, `<pattern>`, `<marker>`, `<style>`), the pair is accounted for; a `shapes/rect`
pair has no such escape, since a rect must draw. Otherwise the raster must draw the SVG and pass the perceptual
oracle against resvg's PNG (composited over white), and the oracle must reject that PNG's two planted-mismatch twins
(its subject erased to the ground, and the frame moved 4 px), so no pair passes on an oracle that can't fail.

The pairs were chosen as those that hold only plain shapes, solid colors and the element under test: no text,
filter, image, gradient, `switch`, external reference, font or relative unit, which other criteria or other
issues own (a text element is refused by criterion 2; gradients paint in OKLab by the design's paint rule, which
resvg's sRGB ramps would not match). Chosen:

- `masking/clipPath`: simple-case, clip-rule=evenodd, clipPathUnits=objectBoundingBox, transform-on-clipPath,
  with-use-child, nested-clip-path
- `masking/mask`: maskContentUnits=objectBoundingBox, on-group-with-transform, half-width-region-with-rotation,
  mask-on-self, on-a-small-object, with-clip-path
- `paint-servers/pattern`: simple-case, patternUnits=objectBoundingBox, with-patternTransform, with-viewBox,
  with-x-and-y, patternContentUnits=objectBoundingBox
- `painting/marker`: marker-on-line, only-marker-end, orient=30, marker-on-polyline, default-clip,
  with-markerUnits=userSpaceOnUse
- `structure/style`: class-selector, iD-selector, type-selector, attribute-selector, style-inside-CDATA,
  resolve-order
- `shapes/rect`: simple-case, rounded-rect, rx-attribute-resolving, rx-attribute-clamping,
  rx-and-ry-attributes-clamping-order

Several gray masks (mask-on-self, maskContentUnits=objectBoundingBox, with-clip-path, on-a-small-object) take their
luminance as SVG does, from sRGB values, where the base's own `mask@1` reads linear light (#373 AC6): an import that
maps an SVG mask onto a linear-light mask misses these PNGs, and must draw the SVG's meaning or name `<mask>`.

## The perceptual oracle

`perceptual()` in `elements-helpers.ts`, reviewed test code, as the design describes it, with these settings:

1. **The blank guard** (film.blank's measure): a frame with luma ≤ 0.06 over at least 98% of its pixels, on either
   side, makes the comparison `BLOCKED:` and voids the other numbers. A BLOCKED comparison fails the test.
2. **FLIP** (LDR-FLIP, Andersson et al. 2020 and NVIDIA's reference `flip.py`: YCxCz, the CSF filters, Hunt-adjusted
   HyAB, qc 0.7, pc 0.4, pt 0.95, edge and point features with qf 0.5, 67 pixels per degree), pooled as the mean over
   the subject (the union of both silhouettes): at most **0.08**.
3. **Structure**: GMSD (Xue et al. 2014; 2 × 2 average and halve, Prewitt, c = 170) at most **0.05**.
4. **Crushed blacks** (luma ≤ 0.02): our share no more than **0.05** above the reference's.
5. **Color**: mean ΔE2000 over the frame, our linear exposure scaled to the reference's mean luminance, at most
   **0.75**.
6. **Silhouette IoU**: a pixel is in the silhouette when some channel lies at least half way from the white ground
   to black; the IoU floor is **0.95**.

There are no blessed baselines (a first blessing is your decision), so each number is held to a ceiling against the
upstream PNG, the expected value set outside the implementation. The ceilings were set from the base's own Vello CPU
drawing shapes the base can draw, equivalent to four upstream SVGs (BASE-FAILURE.txt, section 4): FLIP 0.00002–0.028,
GMSD ≤ 0.017, ΔE2000 ≤ 0.065, IoU ≥ 0.990. The same base renders of wrong results fail clearly: the clip ignored
(FLIP 0.79, IoU 0.22), the style ignored (FLIP 0.93, ΔE2000 27.7), the markers dropped (FLIP 0.26, IoU 0.78); the
planted twins score FLIP ≥ 0.127 and the erased one 0.82 or more. The FLIP ceiling, 0.08, is about 3× the worst
correct case (thin translucent markers, whose subject is mostly edges) and under the smallest twin. The positive
controls in that section also confirm the hand-written SVG's probes against the base drawing the five regions as SVG
does, and the rounded-rect check against a cubic outline (0.0011 u off, coverage 0.00098 u).

Departures from the design's oracle, disclosed: FLIP is implemented in TypeScript here rather than taken from the
`nv-flip` crate; the silhouette comes from color against the white ground, since a 2D raster has no object-ID pass;
and the ceilings are uniform across pairs rather than set per fixture.

## Wrong programs

Every test fails on each wrong program below that reaches it (BASE-FAILURE.txt has the runs):

- **The base**: 43 of 43 fail. The marks2d module refuses `vector@1` (`module_missing` from raster and geometry,
  and no issue naming any element), and the raster refuses the planted value as `bad_input`.
- **A do-nothing program** (every SVG imports with no issue, draws only the ground, and geometry answers no parts):
  43 of 43 fail. Each element's probes read the ground where its color belongs; every pair fails the oracle
  (FLIP 0.87–0.96); the rounded rect has no part `r4`; the planted test fails because the other four elements aren't
  accounted for.
- **A sharp-cornered rect** (as the do-nothing program, but a rect with rx keeps its sharp corners in its outline and
  its drawing): the rounded-rect test fails at the corner (36, 28), 1.6569 u off, and the four rounded `shapes/rect`
  pairs fail the oracle (FLIP 0.33–0.49).
- **The planted importer** (`import_skips_clip_path`): the clipPath test fails on it, naming `clipPath`, which is
  what the planted test asserts; the planted test itself fails on a program whose twin still accounts for the
  clip path (a twin that changes nothing) or fails to account for any of the other four.

The do-nothing and sharp runs used a stand-in `deep-canvas-render` (a node script answering the three calls as
described), put in `target/debug` with `cargo` shimmed to a no-op for the run only and the real binary restored
afterwards; it is not part of the suite.

## Not covered here

`<switch>`, named in the scope line but not in criterion 6, has no test. Other criteria's behaviors (refusing text
and scripts, parts at their boxes, roles and opacity channels, write-on, `<use>` and `currentColor`) belong to their
own suites; this suite's documents need none of them except that `with-use-child` resolves a `<use>` inside a clip
path.

## Redraft 2 (pattern pairs vs Chrome)

**What changed.** For exactly four pairs, `paint-servers/pattern/{with-x-and-y, patternUnits=objectBoundingBox,
patternContentUnits=objectBoundingBox, with-viewBox}`, the reference image is now the pinned headless Chrome's render
of the same SVG, unchanged, at the same 300 × 300 over white, in place of resvg's PNG. Nothing else in #398 changes:
the same SVGs and document, the same perceptual oracle and ceilings, the same "named in an issue" escape, and the
same planted-mismatch twins (the subject erased, the frame moved 4 px), now built from the Chrome reference. The other
32 pairs, `simple-case` and `with-patternTransform` among them, still compare with resvg's PNG. The test names and
the count (43) are unchanged.

**Why.** resvg rasterizes each pattern tile and snaps tile edges that fall on half device pixels, where Chrome
antialiases them, so at the 300 × 300 the suite draws resvg's PNG is not a faithful reference for these four: it
agrees with Chrome within 4 codes on only 96.48%, 96.11%, 92.79% and 99.67% of pixels, and Chrome's own render, as
"ours", fails the oracle against it on every one (FLIP 0.139, 0.122, 0.124; GMSD 0.129, 0.083, 0.084; `with-viewBox`
on IoU 0.950). A faithful import would fail the suite. #1175, which follows #398, names a pinned headless Chrome as
the reference for this import. The owner approved this redraft: "Yes, redraft".

**The pin.** Chrome for Testing 156.0.8078.4 (`chrome-headless-shell`, linux-arm64, Playwright's
`chromium_headless_shell-1248`). `chrome-reference.mjs` makes the references: it checks `--version` and is
`BLOCKED` (exit 2, nothing drawn) when the binary is missing or answers another version; `CHROME_BIN` overrides the
path. Flags: `--headless --disable-gpu --force-color-profile=srgb --force-device-scale-factor=1 --hide-scrollbars
--default-background-color=ffffffff --window-size=300,300 --screenshot=<png> --user-data-dir=<fresh>`, on the SVG's
`file://` URL.

**Checked in, not rendered at test time.** The PNGs are in `fixtures/chrome/paint-servers/pattern/` and the test
holds each one's sha256, so it fails (naming the pair) when a reference is not the one the script made:

| Pair | sha256 |
|---|---|
| with-x-and-y | `8611e4742c2c35f2c1d64f23d8939e75cbf39bf65843ab1a38694ac1b8befed4` |
| patternUnits=objectBoundingBox | `7d4ad317d49a29966f41e69799d947b33178b23679b9b13452ffd50d827dc8e6` |
| patternContentUnits=objectBoundingBox | `f72952fb5a1e57855424680fd5372a75d43874e1f42f0f8214a2806b99b778ff` |
| with-viewBox | `967242db11283df50cb8f23b7e86993a0861180e5684a380f9264564bd53aef4` |

This fits the suite: every other reference is a reviewed PNG checked in beside its SVG, the suite stays runnable on
every machine (a test-time render would make these four pairs `BLOCKED` wherever this exact build is missing, the
Mac among them), and Chrome's output can't drift with the host under a pin the test can't see. The PNGs are renders
of resvg's SVGs (Apache-2.0 or MIT, `fixtures/resvg/NOTICE`).

**Calibration** (BASE-FAILURE-redraft2.txt, section 4, on the base's tooling: `perceptual()` and
`plantedMismatches()` from `elements-helpers.ts`):

| Pair | resvg ≈ Chrome within 4 codes | Chrome as ours vs resvg (before) | Fresh Chrome vs checked-in Chrome (after) | Twin erased | Twin moved 4 px |
|---|---|---|---|---|---|
| with-x-and-y | 96.48% | fails 3 (FLIP 0.139, GMSD 0.129, IoU 0.944) | passes (identical bytes) | fails 4 (FLIP 0.953) | fails 4 (FLIP 0.802) |
| patternUnits=objectBoundingBox | 96.11% | fails 2 (FLIP 0.122, GMSD 0.083) | passes (identical bytes) | fails 4 (FLIP 0.911) | fails 4 (FLIP 0.833) |
| patternContentUnits=objectBoundingBox | 92.79% | fails 2 (FLIP 0.124, GMSD 0.084) | passes (identical bytes) | fails 4 (FLIP 0.944) | fails 4 (FLIP 0.833) |
| with-viewBox | 99.67% | fails 1 (IoU 0.9500) | passes (identical bytes) | fails 4 (FLIP 0.893) | fails 4 (FLIP 0.827) |

Chrome's render is byte-deterministic (two runs of the script, and a third render by hand, give the same sha256), so
its own render passes with every number at its ideal; that shows reproducibility, not the ceilings' slack for a
second correct renderer. That slack is shown by the two pattern pairs kept on resvg, where the two renderers agree:
Chrome's render passes against resvg's `simple-case` (FLIP 0.0036) and `with-patternTransform` (FLIP 0.032), inside
the ceilings set in "The perceptual oracle". Each twin of each Chrome reference fails on all four numbers it can
move (FLIP, GMSD, ΔE2000, IoU).

**At the base** (`e2e6e1cc`, BASE-FAILURE-redraft2.txt): 43 of 43 pass. This base holds #398's import, which names
every element outside the list in an `svg_unsupported` warning, so every pair takes the escape before a drawing is
compared (section 2); the redraft is reached up to that point, and a reference swapped back to resvg's PNG fails its
pair on the sha256 (section 3). The Chrome comparison itself runs once an import draws a pattern (#1175).

Not done: no base-drawn equivalent of these four SVGs was compared against Chrome (the first redraft's Vello
controls cover other pairs), and `with-patternTransform`, which agrees with Chrome on 96.54% of pixels within 4 codes
but passes the oracle against resvg's PNG, stays on resvg as the scope of this redraft says.
