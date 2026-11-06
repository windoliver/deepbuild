# Acceptance tests for #398: vector art and formulas, SVG imported as parts with roles, internal references resolved, and terms written on

Written first, from issue #398 (its scope, its `vector@1` fields, its six acceptance criteria and its proof line: "The
refused SVGs with their reasons, the imported parts at their boxes, and the write-on frames against the perceptual
oracle"), its Oracle page (`doneright/oracles/issues/398.md`) with the upstream files it pins, the design sections
it names and those they lean on, and base commit `a7e140b` ("Merge pull request #1007 …"), by a job that never saw
an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes
to a blind redraft of this job (design: Dogfooding).

What was read:

- `docs/canvas-primitives.md`: Units and axes (28: 2D in u, y down, origin top left); The status-color rule (68);
  The path grammar (`items/<id>/…`, a sub-address after `#` names a part); Document envelope (291) and Item and kind
  (321: `at.pos`, `adjust.opacity`, a missing param takes its default); Text `text@1` (1381: "In write mode each unit
  (a grapheme, or a formula's term) first draws its outline along its path in its stroke paint, or its fill's paint
  when it has no stroke, over the first half of its span, then its fill comes in while the outline turns into its
  own stroke. Units overlap by `lag: ratio = min(4 ÷ n, 0.2)`, and the progress runs linear unless keyed
  otherwise"); Path `path@1` (1524: `#at:<f>` by arc length); Vector and formula `vector@1` (1812) and its quote
  (1836); Channel and key (5260: types, `enum`, `bool` and `string` hold only; right-continuous keys).
- `docs/technical-design.md`: The canvas core and Canvas modules (the `vector` row: "SVG import, formulas; … a
  formula's parts as channel targets, named by the SVG's ids or the typeset job", depending on marks2d), the
  Conventions paragraph (2D writer layers composite in sRGB-encoded space); Vector and formula (1289: "SVG imported as
  static paths, with no script, no external references and a capped size … text in an SVG must arrive as
  outlines"); the parity suite, the perceptual oracle and its blank guard, planted twins and "a linked test counts
  only by what it asserts on our output" (2542–2560); the seams' rule that a 2D writer layer is compared through the
  perceptual oracle with "interior pixels (farther than 1.5 device px from every edge it draws) within one code value
  on 99.9%" (2476).
- The Oracle page's files: resvg `77b12f4951` `crates/usvg/tests/parser.rs` and `crates/resvg/tests/tests/
  {structure/use, structure/defs, painting/color}`; Manim CE `a6d5cc02b4` `manim/animation/creation.py`
  (`DrawBorderThenFill.interpolate_submobject`, `Write`'s `lag_ratio = min(4 / length, 0.2)`),
  `tests/test_graphical_units/test_creation.py` and `tests/module/animation/test_composition.py`.
- At the base: AGENTS.md; `tests/acceptance/373/` (the `raster`/`geometry` surface, its README format), `381/`,
  `391/` (the JSON-lines convention, channels, flicks), `385/` and `140/view/` (the perceptual oracle as test code),
  `380/` (the Oracle-lane section), `305/`, `371/`; `crates/deep-marks-render` (`deep-canvas-render`:
  `check`, `look`, `raster`, `geometry`, `planted`), `crates/deep-canvas-motion` (channel types at the base: `f32`,
  `color`, `bool`), `crates/deep-canvas` (the ID grammar, `unknown_kind`, `module_missing`), `scripts/lanes.mjs`.

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/398 --no-file-parallelism
npx tsc -p tests/acceptance/398/tsconfig.json   # type-check (exits 0)
```

Like #373's and #391's suites, every file first runs `cargo build --locked --bin deep-canvas-render` in the
checkout (cached after the first file) and fails each of its tests when the build fails, so the files run one at a
time: `scripts/lanes.mjs` needs `'tests/acceptance/398/'` added to its `alone` list (this job writes only this
folder). The tests write PNGs and the SVG store under the OS temp folder and delete them. They use only node
built-ins and vitest. A run with `--root tests/acceptance/398` leaves Vitest's cache in
`tests/acceptance/398/node_modules/.vite`; delete it, it is not part of the suite. Vello CPU needs no GPU: every
test runs on every platform.

**AC6 is the blind redraft.** The first draft's `elements.test.ts` was replaced, on the owner's go-ahead, by
`elements-redraft.test.ts` with `elements-helpers.ts`, `fixtures/elements/` and its resvg pairs; `REDRAFT-AC6.md`
is its README and `BASE-FAILURE-redraft.txt` its run at the base (43 of 43 fail). The first draft's five
self-contained tests failed `bad_id` on its own document IDs, longer than the ID grammar's 48 characters. The rows
for AC6 below, and its lines in `BASE-FAILURE.txt`, describe the first draft and are kept as its record.

`BASE-FAILURE.txt` is the run at the base: all 55 tests fail. Every failure is a missing surface: the base has no `vector@1` kind (the check's marks2d pass answers
`module_missing` for it), part channel targets reach nothing (`ref_unresolved`), and `raster` answers `bad_input` to
the new `planted` values.

## The surface under test

The issue names no code API, so these tests extend #373's proof surface, the `deep-canvas-render` binary
(`target/debug/deep-canvas-render`, crate `crates/deep-marks-render` at the base), and add no subcommand. #391's
JSON-lines convention holds unchanged: one JSON object in per stdin line, exactly one out per line, in order, exit
0; a line that isn't JSON, lacks a required field or names an unknown `planted` value answers
`{"ok": false, "code": "bad_input"}`. Everything #373's, #381's and #385's READMEs define for `check`, `raster` and
`geometry` stays as it is. Times are flicks (1/705,600,000 s) as JSON integers.

### Documents and the `vector@1` item

The design's envelope as #373's tests write it (`{format: 1, id, profile: "figure", title, description, size,
layers, items, channels?}`), with items `{id, kind: "vector@1", layer, name, order, at?: {pos: [x, y, 0]}, params}`
and these params (Vector and formula `vector@1`):

| Param | As the tests use it |
|---|---|
| `src` | the sha256 (lowercase hex) of the SVG's bytes, read from the request's `store` |
| `size` | `[w, h]` in u: the SVG's viewBox (or `0 0 width height` with no viewBox) is drawn scaled onto the box `[pos.x, pos.y, w, h]`, its top-left at the item's `at.pos` (0 when absent). Every fixture's size has its viewBox's aspect, so the scale is uniform |
| `colors` | `{SVG color → look role}`. A key matches every color the SVG writes that parses to the same color (CSS syntax, case-insensitive: `black`, `#000000` and `#000` are one key); the tests give each color once. `currentColor` resolves to the `color` property in effect where the SVG sets one, and that color maps through `colors`; where the SVG sets none (MathJax's output), the key `currentColor` maps it. The resvg runs give both keys the same role, so either path draws the same |
| `alt` | the formula's source text (always given; never read) |
| `write_on` | `{progress: number 0..1, order: "term"}`; a channel keys `items/<id>/params/write_on/progress` |

Drawing follows the 2D conventions: Vello CPU, scale 1, compositing in sRGB-encoded space. Elements inside `<defs>`
(and other non-rendering containers) draw only where referenced. A part's `opacity` applies to the part as a whole,
as a group's opacity does.

**Parts.** Every element the SVG draws that has an `id` (or a class named in `parts`) is a part, addressed
`<item>#<id>`; nothing else is. Its read-only `box` is `[x, y, w, h]` in document u: the tight bounds of the
geometry of the paths it draws (fills' outlines; stroke width not included), every SVG transform, `<use>`
placement, the viewBox scale and the item's `at.pos` applied. `source` is the term's source when the import knows
it, else `null`; the tests require the key and never read its value.

### Channels on parts

| Target | Channel |
|---|---|
| `items/<id>/parts/<part>/role` | `type: "enum"`, keys whose `value` is a look role name, `interp: "hold"` (enum is hold only); the part's paths draw in that role while it is keyed |
| `items/<id>/parts/<part>/opacity` | `type: "f32"`, linear keys, 0..1 |
| `items/<id>/params/write_on/progress` | `type: "f32"`, linear keys, 0..1 |

The check resolves these targets (at the base they are `ref_unresolved`). `/at` exists per the design; no test
keys it.

### `check {"doc", "look", "store", "planted"?}`

The import runs at check, for every `vector@1` item, reading `src` from `store`. Answer and issues as at the base:
`{ok, issues: [{check, code, severity, ids, path, actual, what, fix}], notices}`. The tests read:

- **Refusals** (`severity: "error"`, `ids` holding the item's ID): `svg_malformed` for bytes that aren't
  well-formed XML or whose root isn't `<svg>`; `svg_script` for a `<script>` element, an `on*` event attribute or a
  `javascript:` URL; `svg_text` for a `<text>` element, naming the element and carrying a non-empty `fix` (convert
  the text to outlines). A refused SVG's errors all carry its one reason.
- **Naming as data.** An issue names an element (`text`, `clipPath`, `mask`, `pattern`, `marker`, `style`) by
  holding its SVG tag name, exactly cased, as a string value outside `what` and `fix`, alone or as a whole word
  (`"clipPath"`, `"<clipPath>"`, `"clipPath#clip1"` all name `clipPath`); the code is the import's choice (for
  example `svg_unsupported`).
- **The closed list.** An element or attribute outside the import's list is drawn as SVG defines it, or comes back
  as an issue naming it that doesn't refuse the SVG (a warning), never dropped without one. `<title>` and `<desc>`
  may come back as such warnings; no test minds.
- `planted: "import_skips_clip_path"` (AC6's wrong program, here and on `raster`, reachable only through this field):
  the import ignores every `<clipPath>` and `clip-path` reference, raising no issue for them, so clipped content
  draws unclipped.

### `raster {"out", "doc", "look", "store", "t", "planted"?}`

As at the base (#373): the check first, a refused document answered with its first error's code (so a refused SVG
answers `svg_malformed`, `svg_script` or `svg_text`), else the PNG of the document's size at `t` with channels
applied. New `planted` values, each the criterion's wrong program and nothing else:

- `write_fades_fills_from_start` (AC4): write_on draws each term's outline as the honest write does but fades its
  fill in from the start of the term's span (fill opacity rising from 0 at the span's start) instead of from its
  midpoint.
- `import_skips_clip_path` (AC6): as on `check`.

### `geometry {"doc", "item", "store"}`

As at the base, plus, for a `vector@1` item, `parts: [{id, source, box: [x, y, w, h], subpaths}]`, one entry per
part, each `subpaths` in #373's form (`{closed, verbs: [M | L | Q | C | Z], points}`, document u, y down; one point
per M and L, two per Q, three per C, none for Z): the part's own outline as imported. A `<use>` part's outline is
its own copy of the referenced geometry at its placement. A `rect` with `rx` is its rounded outline (lines and
curves).

## Fixtures

Written by this job before any implementation ran (`fixtures/`):

| Fixture | What it holds |
|---|---|
| `clean.svg` | a 100 × 60 viewBox with one ink bar (10..90, 10..50): every refused fixture's clean twin |
| `malformed-unclosed.svg`, `malformed-not-xml.svg`, `malformed-root.svg` | a `<g>` never closed; text that isn't XML; an XHTML document |
| `scripted-script.svg`, `scripted-onload.svg`, `scripted-href.svg` | `clean.svg` with a `<script>`; with `onload`; inside an `<a>` with a `javascript:` link |
| `glyphs.svg` | glyph groups `g#x` (an X of 12 corners, black) and `g#eq` (two red bars) in font units under `translate(10,80) scale(1,-1)` |
| `glyphs-text.svg` | `glyphs.svg` plus a `<text>` in a `<g id="caption">` |
| `eq5.svg` | five ink parts `t-a_1`, `t-b_5e2` (a group of two paths), `t-c_7`, `t-d_3f`, `t-e_9`, rects in a 300 × 80 viewBox |
| `formula3.svg` | three terms `t1`, `t2`, `t3`: 125 u squares filled `#3366cc` with their own 3 u `#000000` stroke, each path starting at its top-left corner, clockwise on screen, centrelines on pixel centres |
| `mathjax.svg` | `x = x` as MathJax writes it: glyph outlines in `<defs>` (`MJX-1-TEX-I-1D465`, `MJX-1-TEX-N-3D`), `fill="currentColor"` with no `color` set, `scale(1,-1)`; parts `term-x1` and `term-eq` (`<g>`s around a `<use>`) and `term-x2` (a `<use>` with an id), the two x's uses of one glyph |
| `elements.svg` | a rect clipped by a `<clipPath>`, a rect under a luminance `<mask>`, a rect filled by a user-space `<pattern>` of red stripes, a line with a `<marker>` end, a rect filled only by a `<style>` class rule, and `rect#rounded` (120, 120, 80 × 50, `rx="4"`) |
| `resvg/…` | resvg's SVG/PNG pairs and two parser tests written out as SVG (below), with `resvg/NOTICE.md` (MIT/Apache-2.0, the copyright line and the MIT text) |

The analytic expectations are computed in the tests from these numbers. Before any test ran against the base, the
hand-written fixtures' sample points and the write-on measures were checked against an independent renderer
(resvg 0.45.1 from the cargo registry, in a scratch folder outside the repo): every sample in `elements.test.ts`
reads its role, the glyph boxes are as computed, and a dashed outline 175 u of 500 reads 0.348 drawn while the
same frame with its fill at 0.175 opacity fails the 0.15 s oracle by 36 codes.

## Criteria to tests

Each test's name starts with its criterion's ID.

| ID | Criterion (the issue's text) | Tests, and the wrong program each fails on |
|---|---|---|
| AC1 | A malformed or scripted SVG is refused with the reason | `refusals.test.ts` (7): `clean.svg` passes the check and draws its bar in ink (a refuse-everything import fails); each of the three malformed fixtures is refused with `svg_malformed` and each of the three scripted ones with `svg_script`, every error carrying that one reason and naming the item, and `raster` refuses each with that code (an import that drops the script and draws, one that refuses with one generic code, or one that calls a script malformed fails) |
| AC2 | An SVG whose glyph groups carry the ids x and eq imports with the parts `#x` and `#eq` at their drawn boxes, and an SVG with a text element is refused naming the element | `parts.test.ts` (4): `glyphs.svg` at `at.pos` (20, 10) and twice its viewBox has exactly the parts `x` and `eq`, boxes (40, 42, 120, 128) and (220, 74, 140, 64) within 0.01 u, each part's outline spanning its box (an import that ignores a parent transform, the flip, the item's scale or its position fails); its ink and red pixels span those boxes within 1 px; `glyphs-text.svg` is refused, every error `svg_text`, naming the item and `text` as data, with a fix, and `raster` refuses it (an import that skips the text, or refuses without naming it, fails); usvg's `use_node_abs_transform` (use1 at (20, 30, 50, 50)) and `path_transform_nested` (g1 and path1 at (30, 0, 10, 10)), ported |
| AC3 | A channel keying `items/eq/parts/t-b_5e2/role` from ink to accent at 1 s recolors only that part's paths, every other part's pixels unchanged, and `opacity` from 1 to 0.3 on the other four parts dims them to 0.3 within one code value | `channels.test.ts` (2): at 0.5 s the frame equals the unkeyed frame byte for byte; at 1 s and 2 s both of `t-b_5e2`'s paths are accent within one code, at least 1,520 pixels changed, and every pixel more than 1 px off its paths is the unkeyed frame's byte for byte (a recolor of the whole item, of one path, or none fails). Opacity: at 0 s the unkeyed frame; at 1 s and 2 s each of the four parts' interiors within one code of 178.5 (ink at 0.3 over the ground in sRGB-encoded space; linear-light compositing gives 218 and fails, so does no dimming), `t-b_5e2` and the ground byte for byte |
| AC4 | Writing a 3-term formula over 1.2 s gives each term 6/7 s, the terms starting at 0, 6/35 and 12/35 s (lag 0.2): at 0.15 s term 1's outline is 0.35 drawn within 0.01 with no fill; from 3/7 s its fill comes in while the outline turns into its stroke, and at 6/7 s it is filled with its own stroke; term 3 draws nothing before 12/35 s; and a planted write that fades fills in from the start fails the 0.15 s frame by the perceptual oracle | `write.test.ts` (4), `progress` keyed 0 → 1 linearly over 1.2 s. At 0.15 s: term 1's outline, read on its centreline every 1 u, is one run from the path's start in ink 0.35 ± 0.01 long; its inside is exactly the ground; terms 2 and 3 draw nothing. The 0.15 s frame passes the perceptual oracle against the analytic frame (blank guard, then every pixel farther than 7.5 u from term 1's centreline within one code on 99.9%), and `planted: write_fades_fills_from_start` fails it on its pixels. Starts: term 2 nothing at 0.165 s, ink at 0.19 s; term 3 nothing at 0.3 and 0.34 s, ink at 0.36 s; drawn shares 0.7 and 0.3 at 0.3 s, 0.98, 0.58 and 0.18 at 0.42 s, term 3 0.6 at 0.6 s, each within 0.01 (a wrong lag, span or start fails). Fill: none at 0.42 s or 3/7 s, the outline whole at 3/7 s; at 0.6 s more than 0.1 in and even, further at 0.75 s yet under 0.97, the outline whole throughout; at 6/7 s term 1 matches the formula drawn whole through the perceptual oracle, filled in its role with its whole stroke in ink |
| AC5 | An SVG whose glyphs are `<use>` references into `<defs>`, as MathJax writes them, imports with each glyph as its own path at its drawn box, and a `currentColor` fill maps through `colors` like any other color | `defs.test.ts` (13): `term-x1`, `term-eq` and `term-x2` at (20, 26, 60, 64), (100, 44, 50, 28) and (190, 26, 60, 64) within 0.01 u, each with its glyph's contours and corners where its use places them (the two x's are two paths 170 u apart: an import that shares or drops a use, or ignores its transform, fails); `currentColor` mapped to accent draws accent and mapped to ink draws ink at the glyphs' samples, the gap ground, and nothing at the defs' own coordinates. The resvg pairs (Oracle lane, below): 9 through the perceptual oracle, their planted mismatch, and use1's boxes |
| AC6 | An SVG with a `<clipPath>`, a `<mask>`, a `<pattern>` fill, a `<marker>` and a `<style>` block imports with each drawn as listed or named in an issue, and a `rect` with rx 4 imports with rounded corners within 0.01 u; a planted importer that skips `<clipPath>` without an issue fails, naming the element | Now `elements-redraft.test.ts` (43), as `REDRAFT-AC6.md` maps it; four `paint-servers/pattern` pairs (`with-x-and-y`, `patternUnits=objectBoundingBox`, `patternContentUnits=objectBoundingBox`, `with-viewBox`) are judged against the pinned headless Chrome's render instead of resvg's PNG, as `REDRAFT-AC6.md`'s "Redraft 2 (pattern pairs vs Chrome)" records. The first draft, replaced: `elements.test.ts` (3 own + 22 Oracle-lane): `elements.svg` imports with no error, draws its rounded rect, and each of the five elements is either named as data in an issue on the item or draws its analytic samples (clip: inside ink, the clipped-away corners ground; mask: ink under the white, ground past it; pattern: red at x mod 20 < 10, ground at ≥ 10; marker: a blue square on the line's end; style: the class rule's green); `rect#rounded`'s outline lies within 0.01 u of the rounded rect and every point of that rounded rect's edge, the arcs' midpoints among them, lies within 0.01 u of the outline (a sharp rect fails by 1.66 u); `planted: import_skips_clip_path` raises no issue naming `clipPath`, and the drawn-or-named check fails with a problem naming `<clipPath>`. Oracle lane (below): 21 resvg pairs, each drawn to its PNG or naming what it exercises in an issue (the 4 rect pairs must draw), and `import_skips_clip_path` failing all 4 clipPath pairs, each problem naming `<clipPath>` |

## Readings where the issue and design leave a choice

- **No new subcommand.** The parts are read through `geometry` (the outline before flattening, #373's form) and the
  frames through `raster`; the import's refusals and issues come back from `check`, as every document's do ("It's
  checked all at once, and failures come back with fixes"). The planted twins are `planted` values, as #373's are.
- **Codes.** The design names none for the import, so `svg_malformed`, `svg_script` and `svg_text` are this suite's
  (as #373's `key_not_unique` was). "Refused with the reason" is read as the error's code; "naming the element" as
  the tag name held as data, not only in a message.
- **"Imports with each … named in an issue"** is read as the SVG importing (no error) with a warning-level issue
  naming each element it doesn't draw; an element drawn as SVG defines it needs no issue.
- **"0.35 drawn"** is the share of the outline's arc length, drawn from the path's first point along its direction.
  The terms are squares, so arc length and Manim's share of equal straight segments agree.
- **"Its outline first in its stroke paint"** is read from the colour on the centreline (ink, not the fill's role).
  The design doesn't fix the outline's width while it draws (Manim draws it 2 wide, then interpolates to the
  stroke), so the oracle's interior leaves out a band of 7.5 u around term 1's centreline and the width is not
  tested; every pixel past that band, term 1's inside included, is compared.
- **The perceptual oracle at 0.15 s** compares our frame with the analytic frame (the ground and term 1's first
  175 u of outline), never with another output of the implementation; the blank guard is film.blank's black measure
  plus a frame with under 64 pixels off its most common color.
- **"From 3/7 s its fill comes in"** is read as no fill at or before 3/7 s, and a fill rising, even across the term,
  strictly between none and whole at 0.6 and 0.75 s; its curve isn't pinned (the design says the progress runs
  linear; the fill's own ease inside the second half isn't spelled out). "At 6/7 s filled with its own stroke" is
  the term as the formula draws it with no write.
- **Role channels** use the design's `enum` type (hold only), the role switching at its key; "at 1 s" includes 1 s
  (keys are right-continuous).
- **`currentColor`** with no `color` in the SVG maps through the key `currentColor` (MathJax's output carries
  none); with a `color` it resolves as SVG does.
- **Boxes** are geometric bounds without stroke width, as usvg's `abs_bounding_box`; the fixtures' boxed parts have
  no stroke, so stroke-inclusive bounds aren't tested.

## Upstream tests (the Oracle lane)

The Oracle page pins resvg `77b12f4951` for criteria 2, 5 and 6 and Manim CE `a6d5cc02b4` for criterion 4. Per #136
a linked test counts only by what it asserts on our output:

- **resvg `structure/use`, `structure/defs`, `painting/color` (AC5, run on our code).** `from-defs`,
  `with-currentColor`, `simple-case`, `transform-attribute-1`, `indirect`, `non-linear-order`,
  `ignore-shapes-inside-defs`, `painting/color/simple-case` and `inherit` are copied unchanged into `fixtures/resvg/`
  and each drawn by our import and raster at its PNG's size (300 × 300), every color they name mapped to a role
  holding CSS's value for it, and held to the reviewed PNG (composited over the ground) through the perceptual
  oracle: the blank guard, then the PNG's own interior (pixels whose 5 × 5 neighbourhood is one color) within one
  code value on 99.9%. The planted mismatch (our `from-defs` against `ignore-shapes-inside-defs.png`) must fail on
  its pixels. In the scratch calibration, resvg 0.45.1's own renders of all nine passed this comparison and the
  mismatch kept 31.5% of its interior within one code. Recursive and SVG 2 context-paint cases, and the gradient-based `defs` cases, are left
  out: no criterion asks for them.
- **usvg `parser.rs` (AC2, port).** `use_node_abs_transform` and `path_transform_nested` are written out as SVGs with
  ids added, and their asserted boxes are read from our parts. The rest of `parser.rs` tests usvg's tree API, sizes
  and style sheets, which no criterion asks for.
- **Manim CE (AC4, formula).** `creation.py` is the formula source: `Write`'s `lag_ratio = min(4 / n, 0.2)` and
  `DrawBorderThenFill`'s two halves (outline by `pointwise_become_partial`, then interpolation to the filled shape),
  with Animation's lagged sub-alpha, give the expected numbers. `test_DrawBorderThenFill`'s stored frames
  (`DrawBorderThenFill.npz`) are **not run**: they are Manim's camera, Cairo's antialiasing, a 2-wide outline and
  `double_smooth` timing, which our write (linear by design) doesn't reproduce, so feeding our output to them would
  fail for reasons outside the criterion. `test_composition.py` checks Manim's own `AnimationGroup` run times and has
  nothing to feed our output to.
- **resvg `masking/clipPath`, `masking/mask`, `paint-servers/pattern`, `painting/marker`, `structure/style`,
  `shapes/rect` (AC6, run on our code).** These folders reached this job after the first draft, from the oracles
  repo's vendored copy at `77b12f4951` (the older `deepbuild-oracle-tests-4bfb6fe.zip` predates them); this redraft
  replaces the first draft's BLOCKED placeholder. Of their 242 pairs, the 21 that exercise what the criterion names
  are copied unchanged into `fixtures/resvg/`:

  | Element | Pairs | Named by |
  |---|---|---|
  | clipPath | `simple-case`, `clip-rule=evenodd`, `clipPathUnits=objectBoundingBox`, `multiple-children` | `clipPath`, or the attribute each exercises (`clip-rule`, `clipPathUnits`) |
  | mask | `on-group-with-transform`, `half-width-region-with-rotation` | `mask` |
  | pattern | `simple-case`, `with-x-and-y`, `patternUnits=objectBoundingBox` | `pattern`, `patternUnits` |
  | marker | `marker-on-line`, `only-marker-end`, `with-markerUnits=userSpaceOnUse`, `orient=auto-on-M-L-L` | `marker`, `markerUnits`, `orient` |
  | style | `class-selector`, `type-selector`, `iD-selector`, `universal-selector` | `style` |
  | rect rx | `rounded-rect`, `rx-attribute-resolving`, `rx-attribute-clamping`, `simple-case` | nothing: each must draw |

  **How "drawn or named" is judged, per pair.** The SVG must import (no error). Then the pair passes when an issue
  on the item names, as data, one of the names in its row; otherwise our raster at 300 × 300, every color the files
  name (`green`, `black`, `red`, `blue`, `grey`, `darkblue`, `white`) mapped to a role holding CSS's value for it,
  must pass the perceptual oracle against the reviewed PNG as the AC5 pairs do. A pair that fails reports problems
  naming its elements. The rect pairs paint red under the rect being tested ("should be covered"), so a wrong
  radius or clamp shows red. **Planted twin:** `import_skips_clip_path` must fail all four clipPath pairs, with
  every problem naming `<clipPath>` and on its pixels, not the blank guard. In the scratch calibration (resvg
  0.45.1, outside the repo), all 21 pairs drawn by resvg passed this comparison, and `clipPath/simple-case` drawn
  with its `clip-path` removed kept only 20.6% of its interior within one code.

  Left out: pairs about invalid or recursive references, text and images as children, `switch` and `symbol`
  children, gradient-filled masks (their pixels test gradients, not the mask), gray masks (whose luminance SVG takes
  from encoded values, where the design's `mask@1` takes linear light), CSS units, and the many marker orient
  variants beyond one.

## BLOCKED, INCONCLUSIVE and not tested

- Nothing is BLOCKED or INCONCLUSIVE: the AC6 upstream pairs are now run (above), and Vello CPU is deterministic on
  one machine.
- Not tested, because no criterion asks: parts by class (`parts: [class]`), `lines`, `hotspot`, `numbers`, `quote`,
  the 512 KB cap and external references (scope, not criteria), filters and embedded rasters as issues, unmapped
  colors, `/at` offsets, match_morph and connectors reading parts, the draw-order rule, terms with no stroke (outline
  in the fill's paint), `n` other than 3, the vector module's registry entry and seal (#305), the typeset job.
