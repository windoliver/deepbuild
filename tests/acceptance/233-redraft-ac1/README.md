# Acceptance test for #233, criterion 1 (blind redraft)

`#233.b6a28e06` "`math.axes {x_range: [−3, 3, 1], y_range: [0, 9, 3], x_length: 8, y_length: 5}` with `math.plot {f:
x^2}` puts every tick and the curve within 1 px of a stored golden Parabola, rendered once outside the repo, at
1920×1080"

One test, `ac1-parabola-golden.test.ts`, named `AC1 #233.b6a28e06 …`. It replaces nothing: the earlier suite's AC1 file
stays as it was. Written blind from the issue (`gh issue view 233 --repo windoliver/deepbuild`), the design and base
commit `670931294` ("tests(#233): the parabola golden, made once outside the repo …"); no implementation, other branch,
worktree or open PR was read. The implementing agent doesn't edit these files (AGENTS.md, Proof).

## What was read

- `AGENTS.md`; `docs/canvas-primitives.md`: Pack: math@1 math-film words (the stated conversions; axes "expand to a
  `scale@1` and an `axis@1` per axis, so their ticks follow the one tick rule"), Pack, Scale and encode (`axis@1`'s
  fields, ticks entering and leaving by opacity); `docs/technical-design.md`: the canvas core, Dogfooding, goldens.
- The oracle page `doneright/oracles/issues/233.md` (DeepBuildAI/deepbuild, branch `doneright`): criterion 1's
  upstream tests, and that the Parabola golden is ours, rendered outside the repo.
- At the base: `tests/acceptance/233/` (README, `helpers.ts`, `ac1-parabola-golden.test.ts`,
  `fixtures/parabola-golden.json`); `crates/deep-marks-render/src/raster.rs` (`geometry`: which marks it answers as
  sub-paths) and `crates/deep-canvas-marks/src/data.rs` (`axis`: an axis@1 draws its line and each tick as a 1 u rule;
  `ticks_report`).

## The golden, as it is

`tests/acceptance/233/fixtures/parabola-golden.json` holds `frame_px` [1920, 1080], 601 curve points from (420, 202.5)
through (960, 877.5) to (1500, 202.5), and 7 ticks: x at −3, −2, −1, 1, 2 on y = 877.5 px, and y at 3 and 6 on x = 960
px, 180 px per x unit and 75 px per y unit. The upstream library's Axes leave the origin's ticks and the ticks under
the tips (x at 0 and 3, y at 0 and 9) undrawn. The earlier suite's AC1 asked for ticks at x −3 … 3 and y 0, 3, 6, 9
and also that every tick of ours be in the golden, which no program can meet against this golden; this redraft judges
against what the golden holds.

## The surface under test

Reused from the earlier suite (its README, "The surface under test"), imported from `tests/acceptance/233/helpers.ts`:
the pack folder `packs/math-1.0.0` installed as `deepbuild/math@1.0.0` beside `deepbuild/verbs@1.0.0`; the figure
(`profile: figure`, 1920 × 1080 u, 1 u = 1 px at 1x) holding `ax: math.axes@1 {x_range: [−3, 3, 1], y_range: [0, 9, 3],
x_length: 8, y_length: 5}` and `curve: math.plot@1 {axes: "ax", f: "x^2"}`, sent by `deep-show run`'s `deep show`; the
derived items from the reply's `expansions`; the drawn form handed to `deep-canvas-render geometry` at t = 0.

### Reading the drawing

The criterion is about where things are drawn, and the issue's AC12 says no criterion reads a picture, so this test
reads `geometry`'s drawn sub-paths, never pixels.

- **An axis.** Each derived `axis@1` of `ax`. Its line is its longest thin sub-path (at most 3 u across: a stroked
  line's centre line, or a 1 u rule's outline); it is the x axis when the line runs horizontally, the y axis when
  vertically.
- **Its ticks.** The `geometry` answer's `ticks` with opacity above 0, in value order, one mark each. A mark is a thin
  sub-path of the axis across its line, at most 60 u long. A tick's place is its mark's centre along the axis and the
  line's centre across it, so a mark that stands on one side of the line (as axis@1's do) is read where it meets the
  line, which is where the upstream library centres its ticks. Marks pair with values rightward for x and upward for y
  (the stated conversion: y flips).
- **The curve.** Every sub-path of `curve`'s derived items, flattened: lines as they are, quadratics and cubics at 32
  steps each.

**What the base's surface lacks.** At the base `geometry` answers only path and shape marks as sub-paths; an axis@1
draws its line and ticks as rule marks, which are filled rectangles, so the base answers none of them. The test needs
`geometry` to answer every drawn mark of the item, a rectangle as its closed outline (as it already does for a
frame@1's box). The earlier suite's reading of tick marks needs the same.

## Judging against the golden

All within 1 px, in px of the 1920 × 1080 frame:

1. Each golden tick has a tick of ours on the same axis at the same value, within 1 px of it.
2. Each tick of ours is at a step of its axis's range (x: −3 … 3 by 1; y: 0 … 9 by 3). One at a value the golden draws
   is judged by 1. One at a step the golden leaves undrawn is judged within 1 px of where the golden's axis puts that
   value: the line through the golden's ticks of that axis (x at 0 is (960, 877.5), x at 3 (1500, 877.5), y at 0
   (960, 877.5), y at 9 (960, 202.5)). So a program that draws those ticks, as the one tick rule does, and one that
   leaves them undrawn, as the upstream library does, are judged alike; neither may put them anywhere else.
3. Every golden curve point lies within 1 px of our flattened curve, and every point of our flattened curve within 1 px
   of the golden's polyline.

The test also asserts on the way: the golden's own shape (the frame, ticks on both axes, at least 601 points); that
`deep-show run` accepts the scenario and presents the figure with no error and nothing skipped; two derived axis@1
items, one horizontal and one vertical; and a plot that draws something.

## Wrong programs it fails

The base (no math@1: the instances are skipped with `pack_missing`); a math@1 unit other than the frame's short side ÷
8 (a unit of 120 u puts x at −3 60 px off); y kept up (the golden's curve points end up to about 317 px from ours); the
origin at the frame's top left; the axes' coordinate origin put at the frame's centre instead of their box centred (all
337.5 px off); y ticks on the one tick rule's steps of 2 (no tick at 3 or 6, and ticks at no step of y_range); x ticks
every 0.5; tick marks off their values; a curve of another f, clipped to part of x_range, or a 7-point polyline (up to
about 34 px off at mid-chord); a plot that draws nothing. The judge was tried on synthetic geometry answers built as
axis@1 draws (rules as 1 u rectangles) before the run: an honest program with ticks at every step and one with only
the golden's ticks pass, a curve drawn as cubics passes, and y kept up, a 120 u unit, y ticks by 2, x ticks by 0.5 and
a 7-point polyline each fail. That trial was a scratch script and isn't part of the suite.

## Run it

```sh
npm ci                      # once
export PATH=/opt/homebrew/opt/rustup/bin:$PATH
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/233-redraft-ac1 --no-file-parallelism --testTimeout=3600000 ac1-parabola-golden.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/233-redraft-ac1/tsconfig.json   # type-check
```

The file builds `deep-show` (`--no-default-features --features full`) and `deep-canvas-render` once in `beforeAll`
(the earlier suite's `useBins`), so it runs alone, like `tests/acceptance/233/`. Node built-ins and vitest only. A run
with `--root` leaves Vitest's cache in `tests/acceptance/233-redraft-ac1/node_modules/.vite`; delete it.

`BASE-FAILURE.txt` is the one run at the base.
