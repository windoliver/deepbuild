# Acceptance tests for #1215: vertical text

Written first and blind, from issue #1215 ("Vertical text: CJK set in columns top to bottom and right to left, with
upright and turned runs, vertical punctuation and digits set across": its Scope, Fields, eight acceptance criteria, Proof
and Not in scope), the design sections it links and those they lean on, and base commit `7312c66d2` ("Merge pull request
#2850 …", main), by a job that never saw an implementation; none existed. No other worktree, branch, pull request or
session was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of
this job (technical design: Dogfooding). Lean: one test per criterion, plus exactly the wrong programs the proof line
names.

## What was read

- The issue, live (`gh issue view 1215 --repo windoliver/deepbuild`), and its dependencies #381, #496, #407, #404 and
  #1653 only for what their surfaces do.
- `docs/canvas-primitives.md`: Text `text@1` (its fields, and its Semantics: the shaped run is the only source for layout,
  hit tests, fit checks and drawing; the `flow` sentence; `#head`), Text `text@1`: halo, Text animator and counter and its
  selectors, Film audit, both Honest numbers sections. `docs/technical-design.md`: Films and figures on the canvas,
  Dogfooding, "Tests written first", Decided: The reference window.
- At the base, for surfaces only: `crates/deep-text/src/{main,shape,fonts}.rs` (`fit`, `shape`, `breaks`; the binary sets
  text in a role with no fallback list), `crates/deep-canvas-marks/src/{scene,select,animator}.rs` and `looks/clean.json`
  (a text's `font` resolves through the look's fonts, so the clean look's `cjk` is the bundled Noto Sans SC; a marked name
  skips honest numbers), `crates/deep-marks-render/src/{lib,raster}.rs` (`raster`'s `texts` and glyph rows, `planted`,
  `geometry`), `crates/deep-canvas/src/document/rules.rs` (honest numbers), `crates/deep-show/src/film_audit.rs` (readable
  text, holds, the look's smallest text size), `scripts/proof-change.mjs` (criterion IDs), `scripts/lanes.mjs`, and the
  suites `381/`, `390/`, `407/`, `417/`, `496/`, `538/`, `856/`, `1479/`, `1498/`, `1592/`, `1653/` and `1969/`.
- The bundled face's own tables, read by this suite's code: `crates/deep-text/fonts/NotoSansSC-Regular.otf` has 1,000 units
  per em, a 1,000-unit vertical advance (vmtx) and a vertical origin 880 units above the baseline (VORG) for the glyphs the
  tests measure, a `vert` feature whose lookups map "，" 29763 → 29684, "。" 1142 → 29686, "（" 29759 → 29699 and "）"
  29760 → 29700, and no vertical form for the digits.

Every expected value comes from the issue's numbers, the font file or Unicode's file, computed in the tests; nothing
test-side stands in for the shaper, the renderer, the fit check or the film audit.

## Run them

```sh
npm ci                          # once, if node_modules is missing
export PATH=$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1
scripts/lease npx vitest run --root tests/acceptance/1215 --no-file-parallelism --testTimeout=600000
npx tsc --noEmit -p tests/acceptance/1215    # type-check
rm -rf tests/acceptance/1215/node_modules/.vite
```

Each file builds what it drives once, in `beforeAll`, through the helpers it imports, and fails each of its tests when a
build fails: `deep-canvas-render` (`cargo build --locked --bin deep-canvas-render`, `../496/helpers.ts` `useRender`,
copied to a temporary folder) for AC1 to AC6 and AC8, `deep-text` (`cargo build --locked --bin deep-text`,
`../381/helpers.ts` `useBinaries`) for AC5, and `deep-show` (`cargo build --locked --bin deep-show --no-default-features
--features full`, `../407/helpers.ts` `useBuilds`) for AC7. The files build cargo binaries, so they run one at a time:
the implementer adds `alone.push('tests/acceptance/1215/');` to `scripts/lanes.mjs` (this job writes only this folder).
AC2 draws about 30,800 texts and takes a few minutes. AC8 draws with the app's frame path, macOS only (elsewhere it fails
`INCONCLUSIVE:`), and writes its pictures to `docs/evidence/1215/`. Nothing else is written outside temporary folders,
nothing is timed, and no process is stopped. Node built-ins and vitest only, with helpers imported from `../381/`,
`../407/`, `../417/`, `../496/` and `../1479/` (never copied or edited).

## The surface under test

The issue names `text@1`'s fields and no call. Every criterion is entered through a command the base has, with the
issue's fields in the documents and a few answer fields added. **Every name below that neither the issue nor the design
gives is this job's choice, the smallest the criteria need; the implementer builds exactly these, or a dispute goes to a
blind redraft.**

### Documents

#373's figure envelope (`{format: 1, id, profile: "figure", title, description, size, layers: {main}, items}`), one
`text@1` (or a few) drawn in the shipped clean look (`look: "clean"`), its run's origin at its `at.pos`:

| Field | As the tests write it |
|---|---|
| `flow` | `"vertical_rl"`; absent for horizontal flow |
| `combine_upright` | absent (2), `2`, `4`, or `0` in AC2's conformance run |
| `font` | `"cjk"`, the clean look's font naming the bundled Noto Sans SC (the fixture CJK font); `"body"` in AC7's film, as #407's films set their Han |
| `size`, `line_height`, `box: {w, h}` | u (1 u is 1 px at zoom 1) |
| `halo` | `[{width, role: "ground"}]` (AC7, AC8) |
| `name: true` | on a text showing ASCII digits: a cave number or a fixture string is a marked name, so honest numbers skips it (Honest numbers) |

### `deep-canvas-render raster` (every platform)

`{out, doc, look: "clean", t: 0, planted?, hit?}` → `{ok, texts, …}` and the PNG at `out`, as #373, #381 and #496 give it.
The tests read `texts.<item>.glyphs[]`, the shaped run's glyphs as drawn, each with the base's `font` (the face file),
`size`, `id` (the glyph ID drawn), `grapheme`, `x`, `y` and `transform`, and:

- **`x`, `y`**: the glyph's origin as the shaped run places it, in u from the run's origin, as at the base. In vertical
  flow it is where the column's pen stands when the glyph's place begins: every glyph of a column shares its `x` (a digit
  run set across included: its glyphs take their unit's origin), and `y` is the top of the glyph's place, the column's
  first glyph at 0.
- **`transform`** (#496): `[a, b, c, d, e, f]`, the glyph's own frame (pen on its baseline, x along its advance, y down,
  in u at its `size`) to the document, (x, y) ↦ (a·x + c·y + e, b·x + d·y + f). Drawn upright, its x axis points right
  and its y axis down; turned 90° clockwise, its x axis points down and its y axis left (y down). A digit run set across
  draws each digit upright, scaled by the transform or shaped at a smaller `size`.
- **`orientation`** (new): `"upright"` or `"turned"`, how the shaped run sets the glyph's character in vertical flow (see
  Readings, 1).
- **`planted`**: the three names under Planted programs; any other value stays `bad_input`, as the base answers.
- **`hit: [x, y]`** (new, document u): the hit test at that point. The answer gains `hit: {item, index}`, the text item and
  the grapheme whose box holds the point (`null` when none), and every `texts.<item>` gains `carets`: the item's carets in
  order, one before each grapheme of its source and one after the last, each a segment `[x0, y0, x1, y1]` in document u
  (across the column in vertical flow, along the line's height in horizontal flow).

### `deep-text fit` and `deep-text breaks` (#390, #381; every platform)

`fit {text, size, line_height, box: {w, h}, flow}` → `{ok, fits, lines, width, height, …}`. `line_height` and `flow` are the
`text@1` fields. In vertical flow the column length is the box's `h`; `lines` counts columns; `width` and `height` stay the
text's extent across and down, so `width` is the columns' extent (columns × line height) and `height` the longest column's
length; `fits` is false when either passes the box. `breaks {text}` is #381's UAX #14 opportunities, unchanged.

The binary sets text in a font role with no fallback list (as at the base), so these Han characters are the body face's
.notdef there; a face with no vmtx advances by the em height in vertical flow (the issue's Scope), 64 px, the same as the
fixture font's 1,000 units.

### `deep-show run` (AC7; every platform)

#407's harness, imported: each film stored on the panel and the one deliverable of a claim of its own, its requirement
`{kind: "film.audit"}` at the defaults; the `verdict` call's row.

### `deep-canvas-render render` (AC8; macOS)

`{out, doc, look: "clean", view: {zoom: 2, theme: "light"}}` → the PNG of the app's frame path, as #1479 drives it.

## Planted programs

Each is a `raster` line's `planted` value, reachable only there, a wrong shaper whose run everything after it (layout,
hit tests, drawing) reads. At the base each answers `bad_input`.

| Name | The wrong program | Criterion |
|---|---|---|
| `vertical_laid_horizontal` | A vertical run laid out as horizontal text: glyphs advance along x on one baseline, as if `flow` were `horizontal` | AC1 |
| `never_turns` | A shaper that never turns a glyph: every glyph set upright, `orientation` "upright" | AC2 |
| `skips_vert` | A shaper that never applies the font's `vert` (or `vrt2`) substitution | AC3 |

The proof line's fourth wrong program, "an undersized title", is a document: AC7's title card at 9 px.

## Criteria to tests

IDs are `#1215.` and the first 8 hex digits of the SHA-256 of each criterion's text after `- [ ] `, trimmed, white space
collapsed (`scripts/proof-change.mjs`). Each test's name starts with `AC<n> #1215.<id>`, and each file quotes its
criterion in full.

| ID | File | What it asserts, and the wrong program it fails on |
|---|---|---|
| `AC1 #1215.711889f5` | `ac1-origins.test.ts` | The font guard: 1,000 units per em and a 1,000-unit vmtx advance for each of 第4窟散花楼. In `vertical_rl` at 64 px, six glyphs from the fixture font, one per grapheme, whose `x` equal the first's within 0.01 and whose `y` are 0, 64, 128, 192, 256 and 320 within 0.01. `vertical_laid_horizontal` fails, a failure naming `glyph 1 (4)`, where it sits and where it should |
| `AC2 #1215.cfb50749` | `ac2-orientation.test.ts` | VerticalOrientation.txt checked by SHA-256. Every code point the fixture font maps (30,890), less 116 NFC changes and 1 default-ignorable (U+00AD), alone in a text in `vertical_rl` with `combine_upright: 0`: every glyph's `orientation` is "upright" for `U`/`Tu` and "turned" for `R`/`Tr` (all four classes met). `never_turns` fails, its first failure naming U+0020, the first `R` code point |
| `AC3 #1215.87255816` | `ac3-vert.test.ts` | The guard: each of ，。（） maps to a different glyph under the font's `vert` lookups for Han. "（敦煌，莫高窟。）" in `vertical_rl` draws each of the four as one glyph of the fixture font with the `vert` ID; in horizontal flow with the character map's ID. `skips_vert` fails, naming each of the four |
| `AC4 #1215.89bbe2ef` | `ac4-digits.test.ts` | The guard: the font has no `vert` or `vrt2` form for 1, 4 or 0. "第4窟": "4" upright, its advance box's centre within 0.5 of the column's axis (the centre of 第's and 窟's). "隋1400年" at `combine_upright: 2`: each digit turned 90° clockwise (within 0.01°, not mirrored); at 4, with an 80 px line height: each digit upright, on one baseline, left to right, the four no wider than 80 u |
| `AC5 #1215.3816845b` | `ac5-columns.test.ts` | 24 Han characters, 64 px, line height 72: in the 240 × 512 box, three columns of 8 taking the text in order, right to left, the second's x the first's − 72 within 0.01; in 240 × 400, four of 6. Each column starts where the same text's lines start in horizontal flow 512 (or 400) wide, at a UAX #14 opportunity of `deep-text breaks`. `deep-text fit`: 240 × 512 fits in 3; 240 × 400 doesn't, in 4, its `width` 288 within 0.01 |
| `AC6 #1215.9495512c` | `ac6-hit-caret.test.ts` | "敦煌莫高窟" in `vertical_rl` at 64 px: the hit test a quarter down the third glyph's box, on its centre line, answers `{item: "title", index: 2}`; caret 3 lies across the column (at least 1 u) with both ends within 0.5 of the box's bottom edge and its middle within 0.5 of the box's centre line |
| `AC7 #1215.f8b80d0d` | `ac7-film-audit.test.ts` | In a 1920 × 1080 film, "敦煌莫高窟" at 96 px in `vertical_rl` with a 6 px halo, drawn from (1700, 300), the only subject of its shot, shown 5 s: the film audit's row PASSes with no error or warning. Set across instead (the base), it runs past the safe area and fails. The same title at 9 px: the row FAILs with an error naming `title` as text that never reads |
| `AC8 #1215.c041c4e8` | `ac8-taste.test.ts` | The check run takes the three pictures (The taste call) and reads `TASTE.json`; it judges no picture. No call, or one on other pictures, is INCONCLUSIVE, never PASS |

## Readings where the issue leaves a choice

1. **"Turned" for a `Tr` character the font has a vertical form for.** The Scope says `R` and `Tr` turn 90° clockwise and
   `Tu` and `Tr` take the font's `vert` form, and AC2 and AC3 both cover such characters (（ and ） are `Tr`). UAX #50 calls
   `Tr` transformed, with a fallback to rotated: the font's vertical form of a bracket is the bracket turned. So
   `orientation` names how the run sets the character, `"turned"` for `R` and `Tr` and `"upright"` for `U` and `Tu`,
   whether the drawing turns the glyph or the font's vertical form stands in for the turn; a vertical form is never
   turned again. No test reads the transform of a `Tr` glyph, so one program passes AC2 and AC3 and draws （ as the font's
   upright vertical form.
2. **"Every code point in the file that the fixture font covers"** is every code point the face's Unicode character maps
   give a glyph, each with its line's value in the file (the file lists every assigned code point; its `@missing` value,
   R, covers the rest), less those a `text@1` can't hold alone: code points NFC changes (a text is NFC) and
   default-ignorable ones (they draw nothing, so the run holds no glyph to read). Each stands alone in its own text, so
   nothing it could join with shapes beside it.
3. **`combine_upright: 0` in AC2.** With the default, a lone ASCII digit is a run of at most 2 digits and is set across,
   upright (AC4), not by its class; the issue's own `0` turns every digit with Latin text, so the class alone decides.
4. **"Glyph origins"** are the shaped run's `x`, `y`; in vertical flow the top of the glyph's place on the column, with one
   `x` for the column. AC1's numbers fix the origin's y at the top of the place, the first at 0.
5. **"Turns 90° clockwise"** is the glyph's x axis pointing down and its y axis left, in the y-down document; "upright" is
   x right and y down. Both within 0.01°.
6. **"The column's axis"** is the centre of the full-width ideographs' advance boxes in the column, and "centred" compares
   the digit's advance box (its hmtx advance at the reported size, through its transform), not its ink.
7. **"The column's width"** is the line height, since lines advance by it (AC5's 72 px step). AC4's "隋1400年" sets
   `line_height: 80`; a reading of the column's width as the em (64) also stays under 80.
8. **"Sets it across"**: the digits upright, on one baseline, left to right; "its width" runs from the first digit's pen
   to the last digit's advance end, through the transforms.
9. **"The fit check"** is `deep-text fit` (#390's fit check). "Names the overflow" is `fits: false` with `width` 288, the
   columns' extent across, beside the box's 240.
10. **"Breaks are the UAX #14 opportunities in the same order as in horizontal flow"**: the columns start where the same
    text's lines start in horizontal flow with the line length equal to the column length (the box's `w` set to the
    vertical box's `h`), and each start is one of `deep-text breaks`' opportunities.
11. **"A click on the third glyph's box"** is the hit test at a point inside the glyph's place: its box is its cell, read
    from the font, across its hmtx advance, down from its vertical origin (VORG, 880 units above its baseline) by its vmtx
    advance. The point is a quarter of the way down the box on its centre line, so a hit test that answers the grapheme
    under the point and one that answers the nearest caret both give 2. **"The caret after it sits under that glyph"** is
    caret 3 lying along the box's bottom edge, centred on the box's centre line, both within 0.5 px.
12. **"Fails readable text, naming the item"**: the film audit never counts the 9 px title readable (it is under the look's
    smallest text size, 11 px), so its hold never starts. That shows as a `film.hold_short` naming `title` with `held` 0,
    as #407's suite reads text that never reads, or as an error naming `title` whose code names readability; either is
    accepted. The title is drawn from (1700, 300) with no box, so the passing film reads only when the title is set in a
    column: its one column (480 u down, about one line height across) stays inside the safe area, while the same five
    graphemes set across on one line from x = 1700 run past its right edge (1896 u). The title is in the body font, as
    #407's CJK hold film sets its Han, so the film reads the same whichever face the audit's frame sets the Han in.
13. **"From the app at the reference window"** is the app's frame path, `deep-canvas-render render`, drawing a document the
    size of the reference window, 1512 × 982 u, at view zoom 2 (the window's 1512 × 982 points at 2×), as #1479's taste
    run draws the canvas at it.
14. **Honest numbers.** "第4窟散花楼", "隋1400年" and AC8's mixed column show digits, so their texts are marked names
    (`name: true`); nothing in the issue asks for them to be bound.

## VerticalOrientation.txt

`VerticalOrientation.txt` is Unicode 17.0.0's file, the version the shaper pins (`vendor/unicode-17.0.0/README.md`),
copied byte for byte from <https://www.unicode.org/Public/17.0.0/ucd/VerticalOrientation.txt> on 2026-11-19, with
Unicode's own header, copyright line and terms of use. SHA-256
`dcef09c3fb24d356b042569c328ec341efc5b53447700d799f2fb4834c3cd3cd`; `helpers.ts` checks it before every use. Don't edit it.

## The taste call

`ac8-taste.test.ts` draws three documents, each 1512 × 982 u in the clean look's light theme, with `render` at view zoom 2:

| File | What |
|---|---|
| `title-card.png` | "敦煌莫高窟" at 160 u in `vertical_rl` with an 8 u halo over an accent band, and "北魏　第二百五十四窟" at 48 u beside it |
| `mixed-column.png` | "第4窟与第12窟，开凿于隋代，距今约1400年。Mogao 石窟" at 64 u in `vertical_rl`, in an 880 u column: digits set across and turned, Latin turned |
| `punctuation.png` | "（敦煌，莫高窟。）「散花楼」、《飞天》！" at 64 u in `vertical_rl` |

It writes each PNG, as drawn, to `docs/evidence/1215/`, prints each SHA-256, then reads the call in
`tests/acceptance/1215/TASTE.json` (this job doesn't create it):

```json
{ "issue": 1215, "criterion": "#1215.c041c4e8", "verdict": "looks_right", "who": "…", "when": "2026-11-20T09:00:00Z",
  "screenshots": { "title-card.png": "<sha256>", "mixed-column.png": "<sha256>", "punctuation.png": "<sha256>" },
  "note": "…" }
```

No call, or a call whose SHA-256s differ from the run's, fails `INCONCLUSIVE:`, never passing; `looks_wrong` fails,
quoting it; `looks_right` on exactly these pictures passes. Attaching the pictures to the PR and showing them in the
session is the implementer's step. No other test reads a picture.

## At the base

`BASE-FAILURE.txt` holds each file's run at the base. Every test fails on an assertion of its own: the base ignores `flow`,
`combine_upright` and `line_height` and draws every text across, reports no `orientation`, answers no `hit` or `carets`,
knows none of the three planted names (`bad_input`), and `deep-text fit` reads no `flow`. AC8 draws the documents set
across and fails `INCONCLUSIVE:` with no call recorded; the pictures it wrote at the base were deleted.

## Not tested

No criterion states an observation for: `vertical_lr`; `upright: all`; `combine_upright` of 1 and 3, and a run set across
wider than its column refused ("It can never"); a vertical run whose font lacks a glyph falling back with the fallback's
own vertical metrics; selection, `reveal` and text animators in column order; mixed flows refused in one item; a whole
horizontal run turned to fake a column. They are the implementer's own tests to add.
