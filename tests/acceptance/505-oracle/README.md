# Acceptance tests for #505, Oracle lane: upstream tests, reference data and formulas run against our output

Written first, blind, from issue #505 (`gh issue view 505 --repo windoliver/deepbuild`), its Oracle page
(`doneright/oracles/issues/505.md` on branch `doneright` of `DeepBuildAI/deepbuild`), the upstream files that page pins
(read from `doneright/oracles/vendor/…` at that ref, and for the few files it doesn't vendor from GitHub at the pinned
commits), the #505 acceptance suite's surface (`tests/acceptance/505/README.md`, `helpers.ts` and `docs.ts` at commit
`08b0672d`, which holds only tests), #490's `fn` call (`tests/acceptance/490/README.md`, `tests/acceptance/490-oracle/`)
and base commit `dd83ac2f`, by a job that never saw an implementation of #505; none was read, and no other worktree,
branch or PR was. #136's rule applies: a linked test counts only when run against our output, so every upstream case
here is asserted against what `deep-canvas-render` or `deep-show run` answers. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

Scope: the five criteria the Oracle page links an upstream source to: 1 (manim-ce), 3 and 4 (graphest, and the IEEE
1788 vectors as inari ports them), 6 (Boost.Math) and 7 (WPT and palette). Criteria 2, 5 and 8 have no upstream test
(the page's "No upstream test" table) and stay with `tests/acceptance/505/`. Each criterion's parts the page calls
ours (the 0.5 px bound, the 2,000-point and 16,384-cell caps, the notices, the screen reader's name, the planted
programs, the probes, the secant, `fn.derivative`) belong to that suite too.

## Sources

| Criterion | Upstream, pinned | Files | Use | License |
|---|---|---|---|---|
| 1 | manim-ce `a6d5cc02b430fb57d22add51236b6406fbf19d91` | `tests/test_graphical_units/test_creation.py` (test_DrawBorderThenFill), `…/control_data/creation/DrawBorderThenFill.npz`, `manim/animation/creation.py`; `manim/animation/animation.py` (get_sub_alpha) and `manim/utils/rate_functions.py` (double_smooth) from GitHub at the same commit | control frames run on our code; formula | MIT |
| 3, 4 | graphest `0a2e4808a656d6231342311d53bea74e85485d1f` | `rust/tests/graph.rs`, `rust/tests/graph_tests/examples.rs`, `…/explicit.rs`, `…/implicit.rs`, `…/reference/` | reference plots run on our code | MIT |
| 3, 4 | inari `9e519ce47c9baa897bf11a735300ca4718a7a2a1` | `tests/itf1788.rs`, `tests/itf1788_tests/libieeep1788_elem.rs` | port | inari MIT; the file Apache-2.0 (libieeep1788, Nehmeier and Heimlich) |
| 6 | boost-math `f12be767c04d9499aaa6f88b22d5f1b464c1c27a` | `test/gauss_kronrod_quadrature_test.cpp`, `test/adaptive_gauss_kronrod_quadrature_test.cpp` | port | BSL-1.0 |
| 7 | wpt `2f57f45d21482f94b36123dfcec77ae7ab859bc1` | `css/css-color/parsing/color-computed-color-mix-function.html`; `css/support/color-testcommon.js` (its default epsilon) from GitHub | port | 3-Clause BSD |
| 7 | palette `71011dee471c8fd3ffdb5169de1fc88c882dc0ed` | `palette/src/oklab.rs` (its test module) | port (reference values) | MIT OR Apache-2.0 |

None is GPL or LGPL; inari's `c_xsc.rs` and `fi_lib.rs`, which the page also lists, are LGPL-2.1 and stay out, as
490-oracle's owner decision of 2026-11-03 keeps them out. No upstream code is copied: formulas are re-expressed in the
test that uses them, named after their upstream functions, and data is copied with its notice:

- `fixtures/graphest/t_*.png`: four reference PNGs copied byte for byte (their git blob SHAs equal upstream's at the
  pinned commit), with graphest's `LICENSE` beside them in `fixtures/graphest/LICENSE`.
- `fixtures/manim-draw-border-then-fill.json`: what each of the 13 control frames shows, made by
  `fixtures/extract-manim-npz.mjs` from the pinned `.npz` with Node built-ins (the zip member is deflate with zip64
  sizes, `zlib.inflateRawSync`; the `.npy` is a plain uint8 array of shape (13, 240, 427, 4)); its `notice` is manim's
  two MIT notices, kept in `fixtures/manim-LICENSE.txt`. The extractor exits non-zero if the frames don't follow
  creation.py's rule, so a misread never reaches the fixture. Never edited by hand.
- `fixtures/itf1788-plot-functions.json`: the 259 cases of seven functions taken unchanged from 490-oracle's port by
  `fixtures/subset-itf1788.mjs`, with libieeep1788's Apache-2.0 notice verbatim. Never edited by hand.
- Boost's integrands and known values, WPT's two results and palette's reference coordinates are written in their
  test files with the upstream test and line each comes from.

To remake the generated fixtures (from this folder; the `.npz` from the vendor branch or GitHub at the pinned commit):

```sh
node fixtures/extract-manim-npz.mjs <DrawBorderThenFill.npz> > fixtures/manim-draw-border-then-fill.json
node fixtures/subset-itf1788.mjs ../490-oracle/fixtures/itf1788-libieeep1788-elem.json > fixtures/itf1788-plot-functions.json
```

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/505-oracle --no-file-parallelism
npx tsc -p tests/acceptance/505-oracle/tsconfig.json   # type-check (exits 0)
```

Each file builds what it drives once, in `beforeAll`, honoring `CARGO_TARGET_DIR`: `cargo build --locked --bin
deep-canvas-render` (every file but one) and `cargo build --locked --bin deep-show --no-default-features --features
core` (`interval-itf1788.test.ts`), and copies the binary out under a temporary folder; every test of a file fails
when its build fails. The files build cargo binaries, so they run one at a time: **`scripts/lanes.mjs` needs
`'tests/acceptance/505-oracle/'` in its `alone` list** (this job writes only this folder; the implementer makes that
edit). Every `it` passes a 1,800,000 ms timeout. Temporary folders are deleted after each test. Node built-ins and
vitest only. `--root` leaves Vitest's cache in `tests/acceptance/505-oracle/node_modules/.vite`; delete it.

`BASE-FAILURE.txt` is the one run at the base, with a summary at its head: 15 of 25 tests fail there, each on an
assertion or a missing answer (no `area`, no `color_at`, no estimate notice or `curves`, the implicit form refused).
10 pass there, for reasons outside #505's change: the three of criterion 1 (#398 already writes formulas on as
manim does) and the seven ITF1788 tests (#490's interval forms are at the base). They hold what criteria 1, 3 and 4
rest on to the upstream expectations; they don't tell #505's change from the base.

## The surface under test

Exactly the #505 suite's (its README: The surface under test) and #490's `fn` call; nothing new is named here.

- **`deep-canvas-render check | geometry | raster`**, one JSON object per stdin line, one answer per line, exit 0, on
  #167's envelope with #373's role map as `look` (`{light: {role: [r, g, b]}}`). Path fns as the #505 README writes
  them: `params.fn: {y, over, scales: {x, y}}`, the implicit form `{zero, over_x, over_y, max_cells, scales}`, `fill:
  {to: "axis", over}`, `color: {by: "y", ramp: ["a", "b"], domain}`; `vector@1` with `write_on: {progress, order:
  "term"}` keyed by a channel on `items/formula/params/write_on/progress`, its SVG in `raster`'s `store`.
- Read back: `check`'s `ok`, `issues`, `notices` and `curves: {item → {bound, estimate}}`; `geometry`'s `subpaths`,
  `notices` (`{code: "estimate", ids, x_range}`), `area: {value, lo, hi}`, `color_at: [[L, a, b]]` (asked with
  `color_at: [x, …]`) and `cells`; `raster`'s PNG.
- **`deep-show run`'s `fn` call** (#490's, the `core` build): `{"call": "fn", "expr", "context": "path", "over": [[a,
  b]]}` → `{"bounds": [{lo, hi, estimate?}]}`, and with `"at": [x]` → `{"values": [x]}`, one scenario of calls.

The one field these tests set that the #505 suite leaves at its default is `max_cells` (the issue's own field, `u32 =
16,384`), on the two graphest implicit plots (Choices, 2).

## Criteria to tests

Each test's name starts with its criterion's ID (`scripts/proof-change.mjs`: `#505.<8 hex of the text's sha256>`,
the same IDs as the #505 suite's `AC` table); the ITF1788 tests carry both criteria they bear on.

| ID | File (tests) | Upstream |
|---|---|---|
| AC1 #505.968d0296 | `write-on-manim.test.ts` (3) | manim-ce control frames (run on our code), creation.py and animation.py (formula) |
| AC3 #505.5e6d3319 | `plots-graphest.test.ts` (3), `interval-itf1788.test.ts` (7, shared) | graphest reference plots; libieeep1788 via inari |
| AC4 #505.00692b98 | `implicit-graphest.test.ts` (2), `interval-itf1788.test.ts` (7, shared) | graphest reference plots; libieeep1788 via inari |
| AC6 #505.80c4ff9d | `area-boost.test.ts` (8) | Boost.Math GK15 |
| AC7 #505.6af13a53 | `color-wpt-palette.test.ts` (2) | WPT color-mix, palette OKLab |

## Criterion 1: manim-ce, control frames and formula (`write-on-manim.test.ts`, 3 tests)

**Run on our code (port of the control data):** `test_DrawBorderThenFill` draws a `Square(fill_opacity=1)` by
`DrawBorderThenFill` (run_time 2 s, `double_smooth`) and stores 13 frames. Ours: a one-term formula, a 60 u square
(manim's square at its test's 240p is 60 px), written on by a progress keyed linearly over 1 s, drawn by `raster` at
each frame's alpha (progress p at t = p s). Per frame: at alpha 0 ours draws nothing (manim's frame 0); up to 0.5 our
center stays ground and the share of the outline drawn (pixels off ground in the box over those at 0.5) is manim's
share within 0.1 (manim's: 0.044, 0.211, 0.503, 0.900, 0.986, 1); past 0.5 the fill's opacity at the center is
manim's center pixel ÷ 255 (0.027, 0.153, 0.502, 0.847, 0.973) within 0.03; at 1 the center is ink.

**Formula:** Write's lag, min(4 ÷ n, 0.2), and Animation.get_sub_alpha's part progress clip(p·(1 + (n − 1)·lag) −
k·lag, 0, 1) at n = 5 (lag 0.2) and n = 40 (lag 4/n = 0.1), so both branches of the min are held: each of n 16 u
squares draws nothing just before its start, half its outline (0.5 ± 0.15, manim's 2·sub) and no fill a quarter into
its span, its whole outline and no fill at half, the fill at opacity 0.5 ± 0.05 at three quarters, and ink at its end.

Left out: Write's default run_time (1 s under 15 parts, else 2 s; ours is the keyed progress), `reverse` and
Unwrite (no criterion), the outline's own stroke color and width (`stroke_width=2`; ours draws the outline "in its
stroke paint, or its fill's paint when it has no stroke", and our terms have none), and a pixel-for-pixel comparison
with manim's frames (another rasterizer, camera and stroke width; only shares and opacities carry over). The screen
reader's name is ours (the page), in the #505 suite.

## Criteria 3 and 4: graphest, reference plots (`plots-graphest.test.ts`, 3 tests; `implicit-graphest.test.ts`, 2 tests)

graphest plots by interval arithmetic over a subdivision of the plane and compares with a reference PNG, white where
it proved no solution, black where it could not. Our curves are drawn at the reference's pixel scale: explicit plots
through scales putting [−10, 10]² on 1024 × 1024 u (one reference pixel a u), implicit ones putting [−3, 3]² on
256 × 256 u (four reference pixels a u). Judged on our output, with the 0.5 px of the criteria:

| graphest case (examples.rs) | Ours | Judged |
|---|---|---|
| "Infinite Frequency", `y = sin(40 / x)`, t_f2c337b7… | path fn over [0.01, 10] | an estimate notice from 0.01; every estimate stretch (notices and `curves.estimate`) inside the reference's unresolved stretch next to 0 (columns black over all of y ∈ [−1, 1], up to x = 0.449 computed from the PNG by the test); `curves.bound` covers the rest; at most 2,000 points |
| the same | where `curves.bound` holds | every drawn point within 0.5 u of a black pixel; every black pixel of a column inside a bound range within 0.5 u of the line |
| "Wave", `y = sin(x) / x`, t_95e4d99e… | path fn over [0.1, 10] | no estimate; `curves.bound` covers [0.1, 10]; the same two ways |
| 25 circles of radius √0.4 at the integer points of [−2, 2]², one product, t_0b3b446e… | implicit fn over [−3, 3]², `max_cells` 262,144 | no estimate, `cells` within the cap; every drawn point within 0.5 u of a black pixel; every black pixel within 0.5 u of the line |
| four lines and three circles, one product, t_b8b04a37… | the same | the same |

**How the references were checked when they were taken** (a scratch script, not part of the suite): decoded with the
same PNG reader, each is 1024 × 1024 RGB of exactly two colors, pixel (c, r) covering x from xmin + c·w and y down from
ymax − r·h. For the two explicit plots, 2,000,001 points of the closed form over the drawn range fall in black pixels
(but one, x = 10 exactly, on the image's right edge), and every black pixel in a column over the range holds the
curve (the range of the function over the column, sampled 20,001 times, meets the pixel's rows): 0 of 596 and 0 of
5,354 do not. For the two implicit plots every black pixel meets a factor's zero set and every pixel meeting one is
black (closed-form tests: a circle meets a box iff the nearest point of the box is inside it and the farthest
outside; a line iff its value changes sign over the corners): 21,420 of 21,420 and 8,662 of 8,662. So the second rule
reads the reference's black pixels as the curve at its pixel scale, and the first its white ones as proven empty.

Left out: graphest's inequalities, `mod`, `gcd`, `⌊⌋`, `Γ`, `rankedMin`, `if`, polar and parametric cases and `∧`/`∨`
relations (no criterion or field of ours states them); the huge-coordinate cases (x near 10^15: a path's points are
an f32 column, the #505 suite's reading, so no sub-pixel position survives there); the explicit `x = f(y)` and the
non-square `@size` cases (no reading the five above lack); "Spike" and "O Spike" (a pole: the design's pole rule is
not under a criterion) and "Step" (9^9^9 is past f64); y = sin(x)/x across x = 0 (0/0 at a sample there, where our
design breaks the curve at a non-finite sample, which the reference does not state; from 0.1 on, every column the
reference resolves on that side is held). graphest's own pass (its output PNG equal to the reference byte for byte)
is not applied: ours is not a pixel plot.

## Criteria 3 and 4: the IEEE 1788 enclosures, port (`interval-itf1788.test.ts`, 7 tests)

Both criteria rest on the interval forms. 490-oracle already ports libieeep1788_elem.rs's 504 usable cases against
`deep-show run`'s `fn` call with no context; this file doesn't duplicate that port. It takes from 490-oracle's fixture,
unchanged, the 259 cases of the functions the plots and implicit curves are built from (`minimal_{sin, cos, sqr,
pown, pow, div, recip}_test`; `div`'s four usable cases are `0 / x`) and runs them with `context: "path"`, the context
a path fn's expression is evaluated in, by 490-oracle's rules (its README: "How an upstream assertion maps onto our
wider form"): no estimate; ours contains the tight enclosure; at most 1e-12 × max(1, |end|) wider (unbounded only past
1e300); our point form at both ends inside our bound. What 490-oracle left out, and why, holds here (its fixture's
`dropped` counts); `itf1788.rs` is read for how a case is stated.

## Criterion 6: Boost.Math Gauss-Kronrod, port (`area-boost.test.ts`, 8 tests)

| Boost (gauss_kronrod_quadrature_test.cpp) | Ours (`fill: {to: axis}` of a path fn) | Tolerance (relative) |
|---|---|---|
| test_linear: 5x + 7 on [0, 1] = 9.5 | `5 * x + 7` | 10·ε (Boost's) |
| test_quadratic: 5x² + 7x + 12 on [0, 1] = 17 + 1/6 | `5 * x^2 + 7 * x + 12` | 10·ε |
| test_ca f2: atan(√(x²+1)) ÷ ((x²+1)√(x²+1)) on [0, 1] = π/4 − π/√2 + 3·atan(√2)/√2 | the same | 1e-7 (expected_error<15>) |
| test_three_quadrature_schemes_examples 1: t·log1p(t) on [0, 1] = 1/4 | `x * log1p(x)` | 1e-8 |
| … 2: t²·atan(t) on [0, 1] = (π − 2 + 2 ln 2)/12 | `x^2 * atan(x)` | 2e-8 (Boost's 2·tol) |
| … 3: eᵗ·cos(t) on [0, π/2] = expm1(π/2)/2 | `exp(x) * cos(x)`, over [0, 1.5707963267948966] | 1e-8 |
| … 4: atan(√(x²+2)) ÷ (√(x²+2)(x²+1)) on [0, 1] = 5π²/96 | the same | 1e-8 |
| … 6: √(1 − t²) on [0, 1] = π/4 | `sqrt(1 - x^2)` | 3.5e-3 |

Each: `area.value` within the tolerance of the known value (BOOST_CHECK_CLOSE_FRACTION), the interval bound [lo, hi]
holding the known value, and holding `value`. **Which tolerance:** the fixed GK15 file's for double, each Boost's
stated one; none is tighter than f64 GK15 allows (Boost's own double, 15-point run passes each), so the 1e-8 fallback
never applies. Where Boost's is looser than the criterion's 1e-8 it stands: these are Boost's integrands. The adaptive
file's integrands are the fixed file's (plus 1/cosh over the real line); its 10·ε is what an integrator run to its
termination condition reaches, which the issue doesn't promise, so its tolerances aren't used.

Left out: test_ca f1, atan(x)/(x(x²+1)) (0/0 at x = 0: its interval form over a range holding 0 is unbounded, so
the curve near 0 is an estimate and the area is refused, the #505 suite's AC3 behavior, not a value), test_ca f5 and
example 5 (log(0) at an end, and 0/0 at t = 1 for f5: the same refusal), the integrals over infinite ranges (`over`
and scales are finite), the reversed and empty ranges of test_linear (a fill's region has no stated sign or empty
form), the L1 and error-estimate outputs (ours has no such field), complex Lambert W, and every row for 17 to 61 points
or other types.

## Criterion 7: WPT color-mix and palette's OKLab, port (`color-wpt-palette.test.ts`, 2 tests)

The look's roles `a` and `b` take two of palette's reference colors per request (one document, `y = x` colored by y
through `[a, b]`); `color_at` reads the stroke's OKLab color.

- palette's values: white (1, 0, 0) (`lightness_of_white_is_one`), #0000ff (0.4520137183853429, −0.03245698416876397,
  −0.3115281476783751) (`blue_srgb`), red (0.6279553606145516, 0.22486306106597395, 0.1258462985307351) and green
  (0.8664396115356694, −0.23388757418790812, 0.17949847989672985) (`red`, `green`; sRGB 255 is linear 1). For the ramps
  white→blue, red→green, green→blue, blue→red and red→white: x = 0 and 1 at a and b, x = 0.5 at their coordinate mean
  (WPT's oklab rule, line 469: oklab(0.1 0.2 0.3) and oklab(0.5 0.6 0.7) mix to oklab(0.3 0.4 0.5)), within the
  criterion's 0.001 ΔEOK.
- WPT's two sRGB-input cases (lines 494–495): white→blue at x = 0.5 is `color-mix(in oklab, white, blue)` =
  oklab(0.726 −0.016 −0.156), and at x = 0.9 `color-mix(in oklab, white 10%, blue)` = oklab(0.507 −0.029 −0.28), each
  within WPT's own epsilon, 0.01 a coordinate (color-testcommon.js's default).

Left out: WPT's cases with alpha, `none`, percentages that don't sum to 100, `transparent`, and other spaces (a ramp
has two opaque roles and mixes in OKLab only); palette's XYZ round trips and `visually_eq` tests (not the ramp's).

## Choices where upstream and ours leave one

1. **Compositing space** (criterion 1). Manim's frames are Cairo's, composited in encoded sRGB. The design doesn't say
   which space our fill's opacity composites in, so an opacity is read from the center pixel both ways, encoded and
   linear, and the space that fits a test's frames better is judged; the space isn't this lane's question.
2. **`max_cells` on the graphest implicit plots.** At 256 u a side the trace needs on the order of 10⁵ cells to place
   each curve within 0.5 u (cells split until under 0.5 px), past the default 16,384, and the references hold no
   undecided pixel, so the documents set the issue's `max_cells` (u32) to 262,144 and ask for no estimate. Drawing at
   a coarser scale would keep the default but loosen the comparison past a reference pixel's size.
3. **The implicit plots at 256 u, not 1024**: four reference pixels a u keeps the trace near 10⁵ cells; 0.5 u of ours
   is then two reference pixels, still well under a circle's radius (27 u).
4. **sin(40/x)'s unresolved stretch** is the run of columns from x = 0 whose pixels over y ∈ [−1, 1] are all black.
   Ours must bound everything right of it: about two dozen half-waves remain there, far inside 2,000 points.
5. **Relative tolerances** for Boost, as BOOST_CHECK_CLOSE_FRACTION is; exact values are Boost's closed forms in f64.

## Obligations on the implementer

- Everything the #505 suite's README states for `check`, `geometry` and `raster`, and #490's `fn` call with
  `context: "path"`, as above.
- `scripts/lanes.mjs`: add `'tests/acceptance/505-oracle/'` to `alone`.
