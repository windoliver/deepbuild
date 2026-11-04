# #160's oracle lane: upstream tests held to our output

Written by a blind job from issue #160 (its text as `.oracle-input/issue-160.md`), the oracle map for it
(`oracle-tests/README.md`, `issues/160.md`, `cases/160.json`, `pins.json`), the upstream files the map vendors, and
base commit `69803b94`, with AGENTS.md, `docs/technical-design.md` (the parity-suite paragraphs, "A CPU reference
counts as an oracle only once …", and Dogfooding) and `docs/canvas-primitives.md` (Path `path@1`, Path: ops, Star,
Paint: stroke gradients, taper and wave, Frame and group, union outline, draw order). No implementation of #160 was
seen. These tests reuse the parent suite's proof surface and tools unchanged (`../README.md`: The surface under test;
`../helpers.ts`): `deep-canvas-render path` with its frame fields and planted values, `raster` and `check`. They add
no option, subcommand or planted value.

The map's rule: a linked test counts as evidence only when a runner feeds it our output and it rejects our output
with a planted fault. Each test below feeds our binary a document built from the upstream case and compares the
binary's answer with the upstream's expected value (or one computed here in f64 from the formula source the map
names), and the table says which planted fault, or which twin, shows it rejecting a wrong program.

## Run

```sh
npx vitest run --root tests/acceptance/160/oracle --no-file-parallelism
```

As the parent suite: each file builds `deep-canvas-render` once (`cargo build --locked --bin deep-canvas-render`)
and fails its tests if it can't; Node built-ins and vitest only; PNGs go under the OS temp folder and are deleted.
The files type-check under the root `tsconfig.json`'s strict options with `allowImportingTsExtensions` and `noEmit`
(checked outside the repo, as the parent suite was), so no `tsconfig.json` is added. Vitest's default include also
picks these files up in the parent suite's own run (`--root tests/acceptance/160`); no parent file was changed.
A run leaves Vitest's cache in `oracle/node_modules/.vite`; delete it.

## Numbering

The map lists 15 criteria; the issue has 18 (the parent suite numbers the first 17 AC1–AC17; the last is the
screenshots, unmapped). The map omits the issue's AC8 (columns) and AC17 (repeater slide and lag), so its 8–15 are
AC9–AC16 here. This folder uses the parent suite's IDs: map 1 → AC1, 3 → AC3, 5 → AC5, 7 → AC7, 11 → AC12,
12 → AC13, 13 → AC14, 15 → AC16.

## Criteria to tests

| ID (map) | Upstream | Tests | Wrong program shown failing |
|---|---|---|---|
| AC1 (1) | lottie-spec Trim Path, `trim_path.json` (run on our code; formula) | `lottie.test.ts`: the example as it is (four shapes, 0..50%, m 1 as `each: true`) against the spec's window by actual length; offsets 90°, 450° and −270° give the spec's 0.25..0.75 and 270° wraps; m 2 as `each: false`, the shapes in render order as one length; all within 0.01 u (Hausdorff both ways) | `moved:trim` fails the example's reference |
| AC1 (1) | kurbo `cubicbez_inv_arclen` (formula) | `arclength.test.ts`: trim 0.25..0.75 of kurbo's cubic for y = x² covers it from a quarter to three quarters of its arc length within 0.01 u | `moved:trim` |
| AC3 (3) | lottie-web `ZigZagModifier` (formula) | `lottie.test.ts`: 5 ridges on a closed 4-segment square: `declared` 24, `segments` 24, 24 vertices, the 20 ridges where processPath puts them within 0.01 u | `moved:zigzag` moves the ridges; no planted value changes a count, so for the count the wrong program is the base (no `path`) |
| AC5 (5) | lottie-spec, lottie-web (formula; the examples run on our code) | `lottie.test.ts`: trim (above); round_corners on `rounded_corners.json`'s star by RoundCornersModifier; pucker on `pucker_bloat.json`'s pentagon by the spec's pucker_bloat; zigzag ridges and corners by ZigZagModifier; each within 0.01 u | `moved:trim`, `moved:round_corners`, `moved:pucker`, `moved:zigzag`, each failing its op's reference |
| AC7 (7) | kurbo `cubicbez_inv_arclen` (formula) | `arclength.test.ts`: an arrow at the end of kurbo's cubic trimmed to 0.25, 0.5 and 1 has its tip at that fraction of the arc length within 0.1 u, along the tangent within 1° | none: `moved:trim` moves the tip 0.02 u, inside the 0.1 u bound; the wrong program is the base |
| AC12 (11) | kurbo `test_intersect_qad` (formula) | `contact.test.ts`: an end attached `at: outline`, gap 0, along kurbo's line stops at kurbo's contact (10, 5), the case turned 45° and moved, within 0.5 u | no planted value reaches an attachment; the twin `at: edge` (a program that reads the box) must not land on the contact |
| AC13 (12) | kurbo arc-length tests; Godot PathFollow2D and Curve2D (formula; port) | `arclength.test.ts`: `#length` of kurbo's cubic, quadratic, accuracy cubic, line and pathological quadratic within 0.01 u; `#at:j/10` on the parabola as a cubic and as a quadratic, the accuracy cubic's point 50 u along, the line's at 1/3, within 0.1 u and 1°; Godot's square by progress ratio and progress (150 is 50 u into the second side), the removal-of-a-point case, Curve2D's line samples and rotations, its sample Bézier | no planted value reaches an anchor; the wrong program is the base |
| AC14 (13) | Blender `grease_pencil_boolean_test.cc` | none | not ported: the file is GPL-2.0-or-later and was removed from the inputs on purpose; this project never ports GPL code (AGENTS.md). The parent suite's `outline.test.ts` is the proof |
| AC16 (15) | WPT `css/CSS2/zindex`, `isolation-establishes-stacking-context` (port) | `zindex.test.ts`: z-index-001, -007, -010 (greater z in front though earlier); stack-001, -002, z-index-005, -013 (by z, then tree order); abspos-001's rule across groups; isolation (an isolated group keeps its z −1 child over the red before it); dynamic-001 (a z channel −1 → 1); each "green square, no red" or the stack's sample pixels | no planted value reaches z; the base ignores z on rect@1 and fails each test; the isolation test carries its own twin (not isolated, the child sinks) |

AC2, AC4, AC6, AC8–AC11, AC14's slit, AC15, AC17 and the screenshots have no upstream test in the map (its "No
upstream test" table); the parent suite proves them.

## What could not be ported, and why

- **offset_path** (lottie-web `OffsetPathModifier`): its offset direction depends on the path's winding through
  `polarOffset` and `lineIntersection`, which live in `PolynomialBezier.js`, not vendored; and its miter test
  compares the miter's distance in px with the limit (`pointDistance(intersection, p0) < miterLimit`), where our
  `miter_limit: f32 = 4` is a ratio, so at amount 10 it bevels what ours miters. The parent suite's parity test is
  the offset reference.
- **twist** and **repeater**: the map names no source (twist) and no vendored file (lottie-web's RepeaterModifier).
- **The 50,000-segment refusal** (AC3's second half): ours, per the map.
- **kurbo `test_intersect_line`**: a target needs area for `attach`, and a straight edge meeting is the box case the
  parent suite's AC7 and AC12 tests already hold. **`test_intersect_cubic`**: the cubic isn't symmetric about
  kurbo's line x = 10, so the line toward the target's centre, which our attachment follows, isn't kurbo's line
  unless the centre is pinned, and the surface doesn't pin it for a path. The multi-intersection counts (two and
  three crossings) aren't observable: an attachment takes one contact.
- **Godot**: h_offset and v_offset, progress out of range (looping and clamping `#at` past 0..1 is not in the
  design), get_closest_point, tessellate and bake intervals, baked point counts.
- **WPT**: the other z-index files test CSS's parsing of the same values (sign prefixes, 32-bit limits, `inherit`,
  invalid tokens), positioning schemes and floats (`applies-to`, `stack-003`, `stack-floats`, `stack-overflow`,
  the other `abspos` files), which have no counterpart in our documents; their assertions were read, the files
  weren't ported.
- **lottie-spec `tests/validate_animations.test.js`**: schema validation of Lottie files, not an op.

## Readings where the inputs leave a choice

1. **Upstream cases moved onto the figure.** kurbo's curves are scaled by 100 (cubicbez_inv_arclen's own scale;
   at unit size the criteria's 0.01 u would be 0.7% of a curve) and moved by (50, 50); Godot's Curve2D lines and
   Bézier by (100, 100); the CSS boxes by (20, 20). Expected values move with them; lengths don't change.
2. **Trim `each`** is Lottie's `m`: `each: true` trims every sub-path on its own (m 1, parallel), `each: false`
   all as one (m 2, sequential), per Path: ops ("with each, every sub-path is trimmed on its own rather than all as
   one"). Sequential runs in render order, which the spec gives as reverse order and lottie-web's TrimModifier walks
   last shape first, so the m 2 test writes the shapes into the path last first.
3. **The trim's offset** is the spec's o ÷ 360 less its whole turns (floor for o ≥ 0, ceil below); −270° and 90°
   are the same window on a closed path, as lottie-web's `o % 360`, plus 1 when negative, gives.
4. **round_corners' reference is lottie-web's construction**: each corner cut min(side ÷ 2, r) along both sides,
   joined by a cubic whose handles run E_t of the way back toward the old vertex (the spec's elliptical constant
   0.55191502…; lottie-web rounds it to 0.5519, under 0.001 u apart here). On the example's 52.5° spikes this differs
   from a circular fillet of radius r by several units; on the parent suite's square they agree within 0.003 u.
5. **zigzag** is lottie-web's processPath with corner points: ridges at (r + 1) ÷ (ridges + 1) of each side
   (`PolynomialBezier.shapeSegment` linearizes a straight segment's handles, so its points are even; that file isn't
   vendored and this is read from it as the map describes it), each moved `size` along (vy, −vx) ÷ |v|, and each
   corner moved `size` along the normal of its neighbours' chord (getPerpendicularVector, vendored), the direction
   alternating through ridges and corners. Which side comes first is a sense the test reads from the output and
   holds for every point, as the parent suite does for turns. The corner displacement is Lottie's and is pinned here
   (the parent suite leaves it open) in its own test.
6. **pucker's amount** is the spec's a ÷ 100; positive pulls the vertices to their mean and pushes the handles out
   (a bloat, as the issue's "above 0 bloats").
7. **Bounds** are the criteria's: 0.01 u for trims and op outputs (AC1, AC5), `#length` within 0.01 u on curves as
   on lines (AC13; a length from the curve flattened at the design's 0.1 px is about 0.037 u short on kurbo's
   parabola and fails it), `#at` and an arrow's tip within 0.1 u (AC13, AC7), angles within 1°, an outline contact
   within 0.5 u (AC12). Godot's own 0.001 and kurbo's requested accuracies are not used.
8. **The contact case** uses `gap: 0`, so the end is the contact itself (with a gap the end sits off a curve whose
   apex radius, 3.3 u, is under the 4 px gap, and "4 px from the curve" is ambiguous). It is turned 45° so the
   shape's bounds don't touch the curve where the line meets it; the line from the start toward the target's centre
   runs along kurbo's line whether the centre is the shape's bounds' centre, its control points' or its centroid,
   all of which lie on that line inside the shape.
9. **WPT documents**: a CSS box is a rect@1, `z-index: auto` no `z` (our default 0), a wrapper a group@1,
   `isolation: isolate` `isolate: true`; colours are the parent look's roles (green `dot`, red `rim`, blue `body`,
   orange `hand`, yellow `petal`). Our groups have no background, so abspos-001's "child under its parent's
   background" and the isolation test's "child over its isolated parent's background" are ported as the rule each
   asserts, with the background as a box before the child's group. dynamic-001's script is a z channel keyed −1 at
   0 s and 1 at 1 s, drawn at 1 s.

## Base failure

`BASE-FAILURE.txt`: all 28 tests fail at the base: every `path` test on the missing subcommand, every WPT port on
pixels the base draws in tree order because it ignores z.
