# Acceptance tests for #374: paint completeness

Written first, from issue #374 ("Paint completeness: gradients across a box or a group, stroke opacity,
`scale_stroke`, fitted dashes and stepped fills": its scope, its Fields, its three acceptance criteria and its
proof line), the comment "From #373" on it (what #661 built: `Gradient` with linear, radial and sweep kinds, up to
8 stops, `from` and `to` as box points or fractions, `dense()`, the Vello side; what is left: a stop's `opacity`,
`kind: along` on a stroke, `span: item | parent | ID`, stroke `opacity` and `scale_stroke`), and the design it
names: `docs/canvas-primitives.md` (Paint (fill and stroke), line 1647, whose last five bullets are this issue's
fields; Paint: stroke gradients, taper and wave; Conventions every primitive uses, with the status-color rule;
Frame and group; Item and kind, `at`) and `docs/technical-design.md` (Rules every primitive follows; the canvas
core; 2D marks and paint). Base commit `7222b16`. The job never saw an implementation of #374; none exists. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

Run them (they build a cargo binary, so they run with `--no-file-parallelism`, as #373's do):

```sh
npm ci                      # once, if node_modules is missing
npx vitest run --root tests/acceptance/374 --no-file-parallelism
```

Every file first runs `cargo build --locked --bin deep-canvas-render` (cached after the first file) and fails each
of its tests when the build fails. The tests write PNGs under the OS temp folder and delete them, use only node
built-ins and vitest, and type-check under the root `tsconfig.json`'s strict options with
`allowImportingTsExtensions` and `noEmit` (checked with a copy of the options outside the repo whose `include` is
this folder: `tsc -p` exits 0). A run with `--root tests/acceptance/374` leaves Vitest's cache in
`tests/acceptance/374/node_modules/.vite`; delete it, it is not part of the suite. `BASE-FAILURE.txt` is the run
at the base.

## The surface under test

Nothing is added to #373's proof surface. The tests drive `deep-canvas-render` (crate `crates/deep-marks-render`)
through `check` and `raster`, which exist at the base, exactly as #373's do (`helpers.ts` is copied from
`tests/acceptance/373`, with its PNG reader, its OKLab and sRGB functions in f64 and its JSON-lines helpers). The
`geometry` subcommand isn't needed: widths, dash lengths and colors are all read from pixels. Documents are built
in code (`figure()` in `helpers.ts`), not in fixture files, because every value a test reads sits next to the
geometry that makes it.

### Field spellings the tests assume (the issue gives the names, not the nesting)

| Field | Where the tests put it | Source |
|---|---|---|
| `from`, `to` | `paint.fill.gradient.from: "sw"`, `to: "ne"` (a box point as a bare name, as `at.pivot: sw` is written) | Paint: "box point \| [f32, f32] = w, e" |
| `span: "parent"` | `paint.fill.gradient.span`; the parent is a `group@1` whose parts are the gradient's box | Paint; Frame and group: "no bounds of its own" |
| stop `opacity` | `{at, role, opacity}` in a gradient's `stops` | Paint |
| `kind: "along"` | `paint.stroke.gradient.kind`, stops at 0 to 1 of the path's total length | Paint |
| stroke `opacity` | `paint.stroke.opacity`; the fill's is `paint.fill.opacity`; the paint's own `paint.opacity` multiplies both | Paint: "the paint's `opacity` multiplies both" |
| `scale_stroke` | `paint.stroke.scale_stroke`; a parent's scale is `at: {scale: [3, 3, 1]}` on a `group@1` | Paint; Item and kind: `at` |
| dash `count` | `paint.stroke.dash: {count: 12}` ("the dash takes `count`", so `dash` is an object here) | Paint |
| `steps` | `paint.fill.steps: {over: "children", stops, by: "order"}` on each member (the fill's `over: children` is its parent's children) | Paint |

## Criteria to tests

| ID | Criterion (the issue's text) | Tests, and the wrong program each fails on |
|---|---|---|
| AC1 | A square's gradient from sw to ne reads its first role at the lower left corner and its last at the upper right within one code value | `paint.test.ts`: the four corner pixels, the centre and two diagonal pixels of a 200 u square read the OKLab ramp at their t along the sw to ne axis within one code value. A gradient left at its default w to e reads t = 0 at the upper left and 1 at the lower right, and misses by half the ramp. (This part is #373's: it passes at the base.) |
| AC1 | with `span: parent` over three squares in a row, the middle square's centre reads the stops' OKLab midpoint within 0.001 ΔEOK | `paint.test.ts`: three 100 u squares under a group, the group's parts 341 u wide with the middle centre at pixel centre x = 190.5, t = 0.5 exactly; the pixel is within 0.001 ΔEOK of the OKLab midpoint, and the left, right and edge samples read the one gradient at their own t. `span: item` reads the midpoint at all three centres and fails the left and right ones; a midpoint mixed in encoded sRGB is more than 0.01 ΔEOK off |
| AC1 | and fill opacity 0.5 under stroke opacity 1 draws the outline's centre line at alpha ≥ 0.99 over a fill at 0.5 ± 0.01 | `paint.test.ts`: a rect filled at 0.5 and stroked 20 u at 1; the fill reads alpha 0.5 ± 0.01, and the two rows either side of the top edge, over the ground and over the fill, read the stroke at alpha ≥ 0.99. A stroke that takes the fill's opacity reads 0.5. A second test: stroke 0.5 with the fill at 1 reads 0.5 over the ground (a stroke that ignores its opacity reads 1) and paint opacity 0.5 halves both |
| AC1 (scope) | stops with their own opacity; a stroke gradient by arc length | `paint.test.ts`: a ramp of one role from opacity 0 to 1 reads alpha t at 16 columns (an implementation that drops stop opacity reads the solid role); an `along` stroke on an L-shaped path (200 u then 200 u down) reads the OKLab ramp at s ÷ 400 at eight arc lengths on both legs, which a box-wise linear gradient misses by far more than a code value |
| AC1 (the paint's "can never") | a stroke or fill naming a status role stays refused | `paint.test.ts`: a status role in a `steps` fill, in a stop that carries `opacity` and in an `along` stroke each give exactly `status_color_unbound` naming the item, and `raster` refuses the `along` one; the same `along` stroke over data roles passes the check (a check that refuses every new field fails) |
| AC2 | A circle with a 4 u stroke scaled 3× by its parent keeps a 4 ± 0.1 u stroke, and 12 ± 0.1 u with `scale_stroke: true` | `stroke.test.ts`: a circle r 20 at (60, 60) under a group scaled 3×, drawn at r 60 about (180, 180); the stroke read as the coverage summed on the row through its centre, at both crossings. The ring's centre line is at radius 60 (an implementation that ignores the parent's scale draws it at 20), the width is 4 ± 0.1 with the field omitted (identical bytes to `false`) and 12 ± 0.1 with `true` (a stroke that always scales, or never, fails one of the two) |
| AC2 | `count: 12` on a circle draws 12 dashes and 12 gaps of equal length within 0.5 px | `stroke.test.ts`: an 8 u stroke on a r 100 circle with `dash: {count: 12}`; the centre line read every 0.25 px (bilinear coverage), the 24 crossings of one half found, and each interval within 0.5 px of 2π × 100 ÷ 24 = 26.18 px, alternating dash and gap. A fixed-length dash that doesn't fit, or a count that leaves a closed path with one gap fewer than dashes, fails |
| AC3 | `steps {over: children, stops: [{at: 0, role: a}, {at: 1, role: b}], by: order}` over 5 squares colors the third at the OKLab midpoint within 0.001 ΔEOK, and the first and last exactly a and b | `steps.test.ts`: five squares, the first reads exactly `a` and the last exactly `b`, the third is within 0.001 ΔEOK of the OKLab midpoint, the second and fourth read the ramp at 0.25 and 0.75 within one code value, and each square is one solid color (its inner corners equal its centre; a gradient across each square fails). A second test gives the squares shuffled order keys (ranks 2, 0, 4, 1, 3 left to right) and reads each at its own rank (a rank from position or from ID fails) |

## Readings where the issue and design leave a choice

- **The stops.** `ps.a` (30, 11, 165) and `ps.b` (246, 245, 60) are chosen so the stops' OKLab midpoint is
  (117, 147, 153) to within 0.012 of a code value in every channel: 8-bit pixels can then meet 0.001 ΔEOK, which
  an arbitrary pair can't (one code value is about 0.002 to 0.004 ΔEOK). The tests still compute the expected
  midpoint in f64 from Ottosson's matrices, never from this number.
- **"Within one code value" at the corners.** A pixel centre sits 0.00125 of the ramp in from the square's corner,
  which in this pair is two code values from the bare role, so the corners are read against the ramp at their own
  t, as #373's stroke samples are.
- **`along` spans the whole path.** Stops at 0 to 1 are fractions of the path's total length (400 u in the test),
  as the linear gradient's are fractions of its axis. The samples keep clear of the bend; a stroke split by arc
  length into solid pieces must still be within one code value of the ramp at the sampled arc lengths.
- **A gradient's box under `span: parent`** is the union of the group's parts' boxes (geometry only, as box points
  are), and a group has no bounds of its own, so the union is the parent's extent.
- **Opacity composes in encoded sRGB**, as 2D does (canvas core: Conventions): alpha is read as
  (backdrop − pixel) ÷ (backdrop − color) on the channel where the two differ most. "The outline's centre line" is
  the two rows either side of the edge, one over the ground and one over the fill.
- **`scale_stroke`'s width** is read from pixels, on the row through the circle's centre, where the ring crosses
  nearly square to the row. `√|sx × sy|` for a 3× parent is 3, so 4 u becomes 12 u.
- **Dash lengths** are measured along the circle's centre line, because a dash's length is its length along the
  path, and the phase of the first dash isn't the criterion's, so only the intervals between neighbouring edges
  are read.
- **The opacity test's shape is a `rect@1`** (the criterion names none; its paint is the plain Paint). At the base
  neither a rect's nor a plain circle's stroke is drawn, and a closed `path@1` with both a fill and a stroke
  draws the stroke role over its whole interior, so a stroke on those shapes is part of what an implementation
  must make work; the tests don't work around it.

Not tested, because no criterion asks: `steps` by `x`, `y` or `distance`, `over` a collection ID, more than 8
stops or steps (no code for it is named), the other `span` forms (`item`, an ID), `along` on a fill, dashes on
several sub-paths or open ones, `scale_stroke` under an item's own scale or a rotated parent, and the paint's
`opacity` on text.
