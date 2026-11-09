# Acceptance tests for #505: formulas and function plots: formulas written on, plots bounded by interval arithmetic, implicit curves, computed columns and calculus probes

Written first, from issue #505 (its Scope, its Fields for Path `path@1`: function and Mark set and columns `marks@1`,
its eight acceptance criteria and its Proof line: "Plot, implicit-curve and column fixtures against their closed forms,
with each planted sampler or tracer failing"), its Oracle page, the design sections it links and those they lean on,
and base commit `dd83ac2f` ("Merge pull request #1692 …"), by a job that never saw an implementation; none existed, and
no other worktree, branch or PR was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, read live with `gh issue view 505 --repo windoliver/deepbuild`. Its four blockers (#398, #397, #490,
  #308) are closed at the base.
- Its Oracle page, `doneright/oracles/issues/505.md` on branch `doneright` of `DeepBuildAI/deepbuild`, read with
  `gh api` (reachable from this job): upstream tests for criteria 1, 3, 4, 6 and 7, none for 2, 5 and 8. See "Upstream
  tests (the Oracle lane)".
- `docs/canvas-primitives.md` at the base: Path `path@1` (fields, `attach`, the `#at` anchors), Path `path@1`: function
  (all of it), Mark set and columns `marks@1` (the computed column, the `role` column, "It can never"), Vector and
  formula `vector@1` ("Formulas arrive as SVG and write on term by term, with the source text as the accessible name";
  write_on and its terms in reading order), Text `text@1` (write mode: outline first over the first half of a unit's
  span, then the fill; `lag = min(4 ÷ n, 0.2)`; `template`), Text animator and counter (`counter {source: bound value |
  driver, format}`), Bound value (`format: {precision, …}`), The closed function list (interval forms, estimates that
  never decide a check, sums and their caps: 64 ops for a driver), Channel and key, Driver (`vars`, `fallback`), Control
  (`binds`, `range`, the value as the last input-track entry at or before t), Item and kind (`role`, `name`), the path
  grammar (`controls/<id>/value`, `data/<name>`, a sub-address after `#`).
- `docs/technical-design.md`: Films and figures on the canvas (Interactive figures, Formulas and text, Data stories:
  "A formula can also draw where it equals zero … traced on interval bounds so no small loop is missed"); Dogfooding
  and the drafting rules near "Who drafts it".
- At the base, for surfaces only: AGENTS.md; `crates/deep-marks-render` (`deep-canvas-render check | raster | geometry`,
  its `planted` values), `crates/deep-canvas-marks/src/function.rs` and `scene.rs` (#490's path fn: `{y, over,
  samples}` only, no vars, scales, probes or implicit form), `crates/deep-show` (`run`, `deep show`, `see` in
  `access.rs`, whose tree names an item's node by its `name`, the hub's evidence layout, `path` and `fn`); the suites
  `490/` (the closed function list, its README form), `397/` and `167/` (mark-set rows, scales, counters, `oklab` from
  geometry, the taste test and its APNGs), `398/` (vector@1, write_on, the store), `308/` (controls, input entries),
  `373/` and `391/` (the JSON-lines convention), `376/` and `1162/` (`see`, the hub's world).
- Probes of the base build: `geometry` of a path fn answers its sub-paths; `check` refuses `fn.vars` (`bad_doc`) and a
  computed column (`bad_column`); `see` names the formula's node "Formula", its item `name`, not its `alt`.

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/505 --no-file-parallelism
npx tsc -p tests/acceptance/505/tsconfig.json   # type-check (exits 0)
```

Each file builds what it drives once, in `beforeAll` (`cargo build --locked --bin deep-canvas-render`; `formula.test.ts`
also `cargo build --locked --bin deep-show --no-default-features --features full`), honoring `CARGO_TARGET_DIR`, and
copies the binary out under a temporary folder; every test of a file fails when its build fails. The files build cargo
binaries, so they run one at a time: `scripts/lanes.mjs` needs `'tests/acceptance/505/'` added to its `alone` list (this
job writes only this folder; the implementer makes that edit). Every `it` passes a 1,800,000 ms timeout. Temporary
folders are deleted after each test; `taste.test.ts` rewrites `$TMPDIR/deep-505-shots/` on each run. Node built-ins and
vitest only. `--root` leaves Vitest's cache in `tests/acceptance/505/node_modules/.vite`; delete it. Everything runs on
every platform: `raster` is Vello CPU and `deep-show run` is headless.

`BASE-FAILURE.txt` is the run at the base.

## The surface under test

The issue names fields, anchors, a check code (`fn.derivative`) and notices, but no command. These tests extend the
surfaces #373, #398, #397 and #167 left on `deep-canvas-render` (crate `crates/deep-marks-render`) in their JSON-lines
convention (one object in per stdin line, one out per line, in order, exit 0; an unknown `planted` value answers
`{"ok": false, "code": "bad_input"}`), and read `deep-show run`'s `see` (#376) for the screen reader. No new binary or
subcommand. **Every name below that the issue or the design doesn't give is this job's choice**, the smallest consistent
with the design and the base; each is listed again under Open questions. The implementer builds exactly these, or a
dispute goes to a blind redraft. Times are flicks. `look` is #373's role map; its roles `a` and `b` are AC7's ramp,
named as the issue names them. At zoom 1 a document unit (u) is one pixel, so "within 0.5 px" is within 0.5 u.

### Documents

#167's envelope (`{format: 1, id, profile: "figure", title, description, size, layers, transport, items, channels?,
drivers?, data?, controls?}`), items `{id, kind, layer, name, order, params, role?, at?}`, built in `docs.ts`. What the
issue's fields look like as the tests write them:

| Field | As the tests write it |
|---|---|
| Path fn over x | `params.fn: {y: "a * x^2", over: [-2, 2], vars: {a: "controls/a/value"}, scales: {x: "px", y: "py"}}`, in place of `d` (the issue's field; `samples` left at `adaptive`) |
| An `over` end on a var | `over: [0, "e"]`, `vars: {e: "data/end"}`, a channel keying `data/end` (the path grammar: "A channel may key `data/<name>`") |
| Implicit fn | `params.fn: {zero: "x^2 + y^2 - 1", over_x, over_y, scales}`, `max_cells` left at its default, 16,384 |
| Scales | `scale@1` items `{type: "linear", domain, range, nice: false}` (#373's); every plot has both, so positions are in u |
| Probes | `params.probes: {p: {at: 1.5}}` (a number in a field a channel may key, #167's reading of `at: channel`) |
| Fill | `params.fill: {to: "axis", over: [0, 1]}`, drawn in `paint.fill` |
| Color by value | `params.color: {by: "y", ramp: ["a", "b"], domain: [0, 1]}` |
| Derivative | `params.derivative_of: "f"` |
| Attached path | `params: {d: "M 0 0 L 10 10", attach: {start: "curve#p1", end: "curve#p2"}}` (an end that names an anchor lands on it) |
| Anchor reads | driver vars `items/curve#p1/y`, `items/curve#p1/x` (#167's `items/<id>#<anchor>/<field>`) |
| Controls | `controls: {a: {kind: "slider", class: "document", label, role: "slider", range, default}}`; the fill's upper end moved by `binds: ["items/area/params/fill/over/1"]` |
| Computed columns | `columns: {x: {expr: "(i + 0.5) / n"}, y: {expr: "x ^ 2"}, x0: {expr: "i / n"}, x1: {expr: "(i + 1) / n"}}`, a bar from x0 to x1 (#373's `bar`: x to x2, from the y scale's zero to y) |
| n on a slider | `n: "controls/count/value"`, the control's `range` its declared max |
| Role column | a computed column named `role` (a common column), `{expr: "y < 0 ? 1 : 0"}`, indexing the set's `roles: ["ink", "accent"]` |
| Counter | `text@1` `{text: {counter: {source: <driver ID>, format: {precision: 6}, tabular: true}}}`, the driver's `target` a `data/<name>` (#167's) |
| Column sum | the driver var `items/bars#sum/y`: the sum of the set's column `y` over its rows at t |
| Formula | `vector@1` (#398's), `alt` the source text, `write_on: {progress, order: "term"}`, `role: "part"`, `name` other text |

### Requests: what's new on `check`, `raster` and `geometry`

- **`input`**: `[{t, seq, control, value, writer: "you", serial}]`, input-track entries (Input track: entries; #490's
  form), the track the document's controls read: a control's value at t is its last entry at or before t, else its
  `default`. `check` reads the track too.
- **`color_at`** (`geometry` only): `[x, …]`, x values in the function's units.
- **`planted`**: the two below, on all three subcommands.

### Answers

**`geometry {doc, item, look, t, input?, color_at?, planted?}`** runs the check first (#373) and answers, for a path@1
with `fn`:

- `subpaths: [{closed, verbs, points}]` (#373's form) in document u: the drawn line, every point after the scales.
- `notices: [notice]`: the drawing's notices. An estimate is `{code: "estimate", ids: [item], x_range: [a, b]}` for a
  stretch of a function over x (the form `deep-show`'s `path` call already writes at the base), and `{code:
  "estimate", ids: [item], box: [x0, y0, x1, y1]}` for an implicit fn's rest past `max_cells`, both in the function's
  units.
- `anchors: {name → {x, y, slope, at: [u, u], foot: [u, u]}}`, one per probe: `x`, `y` and `slope` in the function's
  units, `at` the anchor's point and `foot` the point on the x axis below it, in u.
- `area: {value, lo, hi}` with `fill`: `#area.value` and its interval bound.
- `fill: [subpath]`: the fill region's outline in u, #373's form.
- `color_at: [[L, a, b], …]`, one per x asked: the stroke's color at that x, unrounded, in OKLab.
- `cells: n` for an implicit fn: the quadtree cells its trace took (at most `max_cells`).

For a `marks@1` set it answers #167's `rows: {key → {columns, place, oklab, …}}`; a set with no key column is keyed by
its row index (`"0"`, `"1"`, …), and a computed column's values are its f64 results. For a path with `attach`, its
`subpaths` after the attachment.

**`check {doc, look, input?, planted?}`** answers as at the base (`ok`, `issues` with `code`, `severity`, `ids`, `path`,
`notices`), plus `curves: {item → {bound: [[a, b], …], estimate: [[a, b], …]}}`, one entry per path fn over x: the x
ranges whose 0.5 px bound held by interval arithmetic, and those drawn as estimates. Its `notices` carry the drawing's
estimate notices. A check refused because it needs a curve's bound over an estimate is an error whose `ids` hold the
item and which carries that `x_range`. `fn.derivative` failures are issues with that `code`, the marked curve in `ids`,
and the x as a member `x`.

**`raster {out, doc, look, t, input?, store?}`** as at the base, with `texts` (#381) holding each counter's `shown`.

**`deep-show run`'s `see {panel, at}`** (#376) as at the base: `tree[]` of `{id, role, name}`. A `vector@1` item's node
is named by its `alt`.

### Planted programs

Each the criterion's named wrong program and nothing else, reachable only through `planted`:

| Name | Criterion | The wrong program |
|---|---|---|
| `stops_at_midpoint` | 3 | the adaptive sampler stops splitting a segment once its midpoint lies on the curve (within 0.5 px of the chord), with no interval bound |
| `drops_cells_by_corner_signs` | 4 | the implicit tracer drops a cell whose four corners share a sign, instead of splitting it while its bound holds 0 |

## Fixtures

`fixtures/pythagoras.svg`, written by this job: a² + b² = c² as an agent's renderer writes it, a 500 × 100 viewBox,
five terms `t-a2`, `t-plus`, `t-b2`, `t-eq`, `t-c2` left to right (reading order), each a `<path>` with an id, filled
`currentColor`. The other documents are code in `docs.ts`, each from its criterion's numbers.

## Criteria to tests

Each test's name starts with its criterion's ID (`scripts/proof-change.mjs`: `#505.<8 hex of the text's sha256>`).

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| AC1 #505.968d0296 | `formula.test.ts` (1) | `raster` of the formula keyed 0 → 1 over 1 s: each term draws nothing before its start (k/9 s: five terms, lag 0.2, spans 5/9 s), has begun 0.06 s after it with its fill not yet in, and is filled in ink after its span; every earlier term has begun when a later one has (a formula drawn whole, or terms out of order, fails). The hub presents it; `see` at 0.5 s and 2 s has one node for it, named exactly its `alt` (a tree that names it by its item `name` fails) |
| AC2 #505.32c898a2 | `parabola.test.ts` (2) | One flick before the slider's entry the curve is y = 0.5x², at the entry's flick y = 2x²: each of 1,000 seeded x's point within 0.5 px of the drawn line, every drawn point within 0.5 px of the curve, at most 2,000 points (a curve that redraws a frame late, or misses its var, fails). With a = 2 the probe reads x 1.5, y 4.5, slope 6 within 1e-6, its anchor on the curve and its foot on the axis within 0.5 px; with a = 0.5, y 1.125 and slope 1.5 |
| AC3 #505.5e6d3319 | `sampler.test.ts` (4) | sin(2πx): the drawn line at x = 0.25 and 0.75 within 0.5 px of ±1, at most 2,000 points, and 10,002 checked x (0.25, 0.75 and 10,000 seeded) each within 0.5 px of it. `stops_at_midpoint` draws a flat line at y = 0 and fails that search at x = 0.25. sin(1/x): an estimate notice names one stretch from 0.0001, short of 1; the check report's notices name it, `curves` lists it as an estimate and no bound overlaps an estimate, and 2,000 checked x across the bounds (by length) hold within 0.5 px. The area over [0.0001, 1] is refused, an error naming `curve` with an `x_range` in the stretch; over [0.5, 1] it passes |
| AC4 #505.00692b98 | `implicit.test.ts` (5) | Unit circle: one closed sub-path, every drawn point within 0.5 px of the circle and 1,000 seeded points of it within 0.5 px of the line, no estimate. y² − x³ + 2x − 1: exactly two sub-paths, a closed oval from −φ to 1/φ and an open branch turning at x = 1 and leaving at y = ±3 (0.5 px each), all points on the curve and 1,000 of its points on the line. The radius-0.02 circle at (1.5, 0) (0.04 < 0.125, a level-5 cell): one closed sub-path on it; `drops_cells_by_corner_signs` fails that. sin(1 ÷ (x·y)) over [−1, 1]²: `cells` exactly 16,384, an estimate notice with a box inside [−1, 1]² holding the origin, in the check report too |
| AC5 #505.91640dd4 | `columns.test.ts` (3) | n = 4: rows 0–3, x = (i + 0.5) ÷ 4 and heights 0.015625, 0.140625, 0.390625, 0.765625 within 1e-12, each bar's top at the y scale's place; the counter shows `0.328125`; in the frame n is driven to 100, 100 rows of ((i + 0.5) ÷ 100)² within 1e-12 and the counter `0.333325`. Bars of sin(2πx), n = 8: rows 4–7 (below the axis) have role 1 and accent's color, rows 0–3 role 0 and ink's, in the rows and the drawn pixels. n up to 4,097 is refused, an error naming `bars`; up to 4,096 passes |
| AC6 #505.80c4ff9d | `calculus.test.ts` (4) | `#area.value` 0.33333333 within 1e-8, its bound holding 1/3, the fill's outline and the region's edge within 0.5 px both ways; in the frame the slider moves the upper end to 0.5, 1/24 within 1e-8 and the edge over [0, 0.5]. The secant readout `1.0000`; `#p1`, `#p2` on the curve and the attached path's ends on them within 0.5 px. `2 * x` raises no `fn.derivative`; `2 * x + 0.1` fails it, an error naming `d` and an x in [0, 2] where the curves part by more than 0.5 px. At 100 seeded times the growing curve starts at 0 and ends exactly (1e-4 u) at the channel's x, never past it |
| AC7 #505.6af13a53 | `color.test.ts` (1) | `color_at` x = 0.5 within 0.001 ΔEOK of a and b's OKLab midpoint (blue and yellow, whose encoded-sRGB mix is more than 0.05 away), x = 0 and 1 at a and b; the drawn pixel on the line at x = 0.5 within one code value of the midpoint |
| AC8 #505.c8aaffce | `taste.test.ts` (1) | No other file of the suite names the call or its pictures; the run draws the pictures and the two recordings from `raster`'s own frames, prints their SHA-256s, and reads `TASTE.json`: missing or on other pictures INCONCLUSIVE, `looks_wrong` FAIL, `looks_right` on exactly these PASS |

## Readings where the issue and design leave a choice

- **One binary for the canvas.** Plots, columns, counters and the formula's frames are drawn by `deep-canvas-render`,
  which already draws path fns, mark sets, counters and `vector@1` imports; only the accessibility tree needs the hub
  (`deep-show run`'s `see`), as #376 read a screen reader's view.
- **"Within 0.5 px of the true curve"** is both ways: each checked or seeded point of the closed form within 0.5 u of
  the drawn line, and every drawn point within 0.5 u of the curve (for an implicit curve, the test's Newton projection
  onto the zero set in f64). The checked x are seeded (mulberry32), so a failing run replays.
- **"Redraws in the frame the slider moves"** is the frame at the entry's own flick: one flick earlier the old curve,
  at the entry the new one. The same reading for the area's upper end and n driven to 100.
- **A probe's readings** are in the function's units (y = 4.5 is the formula's value); its anchor point and foot in u.
- **The planted sampler's "fails"** is this suite's 10,000-x search on its drawn line; the planted tracer's is the
  small-circle test.
- **"The check report lists as an estimate, never a bound"** is the check's notices naming the stretch and its `curves`
  listing it under `estimate`, with no `bound` range overlapping any estimate.
- **"Hits the 16,384-cell cap"** is `cells` equal to 16,384; "its box" is the notice's `box`, which must hold the
  origin, where no cell can settle.
- **The derivative's 0.5 px** is in the marked curve's y scale; both curves share the scales, so 0.1 is 10 px.
- **"Exactly to that x"** is within 1e-4 u: a path's points are an f32 column.
- **"Read by a screen reader"** is the replica's accessibility tree read as data (#376), the formula's node `name`
  equal to its `alt`, while it writes on and after.
- **The slider in the parabola's picture** is a track and a knob with the control's `handle` (#308's reading); no test
  reads where the knob draws.
- **Tolerances not in the issue**: a bar's top 1e-6 u; a row's color 1e-4 ΔEOK from its role; pixels one code value; the
  oval's and branch's ends 0.005 (0.5 px at 100 u per unit).

## Open questions

The issue leaves these open; the tests take the reading in brackets, and each is a point for the early question or a
dispute rather than a guess the implementer must match silently:

1. **How a counter reads sum(y).** No path or function reads a column's sum, and a driver's bounded sum can't hold 100
   terms under the 64-op cap. [A read-only anchor `items/<set>#sum/<column>`, read by the driver `s / n`.]
2. **A computed column naming another.** The design says "an expression over i, n and vars"; the issue writes `y = x²`
   and `y < 0 ? 1 : 0`. [The issue's text: a column may name the set's other computed columns.]
3. **"The set's roles".** No field is named. [`roles: [role, …]` on the set; the column `role` indexes it.]
4. **How n is written as a var.** [`n: "controls/count/value"`, its declared max the control's `range`.]
5. **Which check "needs the curve's bound".** [The area under it (`fill`, its `#area` interval bound).] Its code is not
   stated, so only `ids` and `x_range` are read.
6. **"Naming the first x"**: first in ascending x or in seeded order. [Not asserted beyond an x named, in range, where
   the curves part by more than 0.5 px.]
7. **The shapes of notices, anchors, the area and the check report** (`x_range`, `box` as [x0, y0, x1, y1] in the
   function's units, `anchors.{x, y, slope, at, foot}`, `area.{value, lo, hi}`, `fill`, `cells`, `curves`): the issue
   names what they say, not their fields. [As above.]
8. **Reading a stroke's color to 0.001 ΔEOK**: 8-bit pixels can't. [`geometry`'s `color_at`, with the pixel within one
   code value.]

## The taste call

`taste.test.ts` writes to `$TMPDIR/deep-505-shots/`: `formula-mid-write.png` (0.47 s), `formula-written.png` (1.2 s),
`parabola-slider.png` (a at 2), `implicit-circle.png`, `implicit-elliptic.png`, `implicit-small-circle.png`,
`filled-area.png`, and the recordings `formula-write-on.apng` (0 to 1.2 s at 30 fps) and `slider-moving.apng` (a from
0.5 to 2 over 1 s), each frame `raster`'s PNG byte for byte. Attach them to the PR, show them to the owner in the
session, and record the answer in `tests/acceptance/505/TASTE.json`, the one file anyone adds to this folder after this
commit, and only to record it:

```json
{"issue": 505, "criterion": "#505.c8aaffce", "verdict": "looks_right" | "looks_wrong", "who": string, "when": "ISO 8601 time",
 "screenshots": {"<file name>": "<sha256>", …}, "note"?: string}
```

No `TASTE.json`, or one whose `screenshots` aren't exactly this run's names and SHA-256s, is INCONCLUSIVE; `looks_wrong`
fails; `looks_right` on exactly these passes. A model's reading never stands in for it.

## What the base already does and these tests don't credit

#398 already writes a formula on term by term in `raster`, so AC1's test passes its write-on half at the base and fails
at the screen reader: the base names the formula's node by its item `name`. The base's path fn draws `{y, over,
samples}` in the function's units, with no vars, scales, probes, fill, color, implicit form, notices or planted
programs; it accepts `probes` and `attach` without reading them (the secant's readout shows `0.0000`) and raises no
`fn.derivative`, so y = 2x's half of that test passes there and y = 2x + 0.1's fails. It refuses a computed column
(`bad_column`) and a var `n` (`out_of_range`), so the 4,097 refusal holds at the base for the wrong reason and its
4,096 twin fails. Every test fails at the base (`BASE-FAILURE.txt`).

## Upstream tests (the Oracle lane)

The Oracle page maps upstream tests, pinned by commit, to five criteria: Manim CE `a6d5cc02b4`
(`tests/test_graphical_units/test_creation.py`, `DrawBorderThenFill.npz`, `manim/animation/creation.py`) for AC1;
graphest `0a2e4808a6` (`rust/tests/graph.rs`, `graph_tests/{explicit,implicit,examples}.rs`, `reference/`) and inari
`9e519ce47c` (`tests/itf1788.rs` and the ITF1788 vectors) for AC3 and AC4; boost-math `f12be767c0`
(`gauss_kronrod_quadrature_test.cpp`, `adaptive_gauss_kronrod_quadrature_test.cpp`) for AC6; WPT `2f57f45d21`
(`css/css-color/parsing/color-computed-color-mix-function.html`) and palette `71011dee47` (`palette/src/oklab.rs`) for
AC7; none for AC2, AC5 and AC8. This suite takes two formulas from them, not their tests: Manim's `Write` lag, min(4 ÷
n, 0.2), which the design also states (AC1's term starts), and the OKLab matrices palette checks (AC7's midpoint). A
linked test counts only when run against our output (#136), and this repo has no runner that runs the vendored files
against `deep-canvas-render`'s output, so that lane is **BLOCKED**, with one unblock ask: a runner (or an oracle job
like `490-oracle/`) that runs the graphest reference plots, the ITF1788 enclosures, Boost's Gauss-Kronrod integrals,
WPT's color-mix cases and Manim's border-then-fill frames against our drawings. The eight criteria are each covered
above by this suite's own tests.

## Scope not under a criterion

The issue's Scope and Fields also name parametric curves (x and y over s), `samples: u16`, a fill to another curve,
`#probe` as the first probe's alias, eight probes at most, `max_cells` set by hand, color by x, a 512-node cap after sums
expand, an `over` end on a control, the typeset job's formulas (#220), the grid form, and the "It can never" lines
(looping, past 2,000 points, across a non-finite sample, reading the clock, a branch through an excluded cell). No
criterion states an observation for them beyond what the tests above read; they are follow-ups for the implementer's
own tests.
