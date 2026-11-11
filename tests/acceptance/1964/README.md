# Acceptance tests for #1964: styled text runs, a subscript drawn from the font's own metrics

Written first, from issue #1964 (its scope, its `runs` field and its one acceptance criterion), the design sections it
links and those they lean on, and base commit `64b4bf56` ("Merge pull request #2194 …"), by a job that never saw an
implementation; no other worktree, branch or pull request was read. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one file per clause that
needs its own run, and one control. The issue's oracle note says no upstream test checks a subscript run's offset and
size from the font's OS/2 fields, so the expected values here are read from the font files themselves.

What was read:

- `docs/canvas-primitives.md`: Text `text@1` (its fields and Semantics: "Runs style spans of the one shaped run … sub
  and super use the font's own metrics where it has them"), its halo, code and keyed-copy subsections; the
  status-color rule; Status binding; Honest numbers (names with digits).
- `docs/technical-design.md`: Dogfooding.
- At the base, only for how surfaces are driven: AGENTS.md; `tests/acceptance/1653/` (README, helpers, halo,
  refusals), `tests/acceptance/467/helpers.ts` (the build, the driver, PNG reading, `fixtures/look.json`),
  `tests/acceptance/443/kerning.test.ts` (an `honest_numbers` check input's `names`), `406/names.test.ts`;
  `crates/deep-marks-render/src/{lib,raster}.rs` (`check`, `raster`, the `texts` glyph rows), `deep-canvas-marks/src/
  scene.rs` (`text_runs`, `text_spec_in`), `deep-canvas/src/document/rules.rs` (the status-role rule).
- The font files' own `head` and `OS/2` tables, read by `helpers.ts` `subscriptMetrics` (below).

What the base already does, and these tests don't credit: `text@1` `runs` of `{from, to, role}` that paint graphemes
in a role without reshaping; `raster`'s `texts.<id>.glyphs`; the document check's `status_color_unbound` for any
`role` under an item's params that starts `status.`, with the path to it, so a run naming a status role is already
refused at check naming `…/runs/<i>/role`. Any other run field (`shift`, `size`, `font`, `weight`, `style`,
`tracking`, `underline`, `strike`) is refused at `check` (and so by `raster`) with `module_missing` at `items/<id>/params/runs/<i>/<field>`.

## Run them

They build `deep-canvas-render` and draw with Vello CPU, so they run on every platform with no GPU. Run them with
`--no-file-parallelism`; `scripts/lanes.mjs` needs `'tests/acceptance/1964/'` in its `alone` list beside `1653/`. This
README is the instruction; the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease npx vitest run --root tests/acceptance/1964 --no-file-parallelism --testTimeout=600000
npx tsc --noEmit -p tests/acceptance/1964    # type-check
```

Each file builds `deep-canvas-render` once (`cargo build --locked --bin deep-canvas-render`, through
`../467/helpers.ts` `useBin`), copies it to a temporary folder and fails each test that uses it if the build failed.
The PNGs go under the OS temp folder and are deleted. No test takes an outside input or a timing, so none reads
`BLOCKED`, `INCONCLUSIVE` or depends on load.

## The surface under test

**No new binary, command or field beyond the issue's.** Everything is entered through `deep-canvas-render`'s existing
`raster` and `check`, one JSON line in and one out, as #467's and #1653's suites drive them. `helpers.ts` imports
#467's helpers (the build, the driver, PNG reading, `fixtures/look.json` as the look) and builds this suite's one
document in code.

### The document

#373's envelope (`{format: 1, id, profile: "figure", title, description, size: [760, 240], budget: {class: "figure"},
layers: {main}, items}`), as #1653's suite writes it, with a paper backdrop and one `text@1` item `formula`:

| Field | As the tests write it |
|---|---|
| the text | `{text: "H2O is water", font: "body" \| "math", size: 96, box: {w: 680, h: 160}, paint: {fill: {role: "title"}}}` at `at.pos: [40, 40, 0]`, start-aligned, top (the defaults) |
| the subscript run | `runs: [{from: 1, to: 2, shift: "sub"}]`: grapheme 1 is the 2; nothing else set, so the rest stays the item's |
| a role run | `{from: 7, to: 12, role}` ("water") after the subscript run, so it is run 1 |
| H2O as a name | `checks: [{kind: "honest_numbers", names: ["H2O"]}]` on the document (#443's form): the 2 of a formula's name isn't a number (Honest numbers: names), and without it the base refuses the text `number_unsourced` |

`body` is Inter and `math` is STIX Two Math in #467's look (`fonts.body.file` `Inter-Regular.ttf`, `fonts.math.file`
`STIXTwoMath-Regular.ttf`).

### `deep-canvas-render raster` (every platform)

`{out, doc, look, t: 0}` → `{ok, texts, …}` and the PNG at `out`, as #373, #381 and #467 give it. Read:
`texts.formula.glyphs`, each `{font: "crates/deep-text/fonts/<file>", size, id, x, y, grapheme, …}` (#381's Glyph:
`x` the pen position and `y` the baseline, in u, from the item's origin); the PNG's pixels at zoom 1 (1 u = 1 px). A
refusal is `ok: false` with `code`, and `path` or `issues`.

### `deep-canvas-render check` (every platform)

`{doc, look}` → `{ok, issues: [{code, severity, ids, path, …}], …}`. An error "names the run" when its `path` is
`items/formula/params/runs/1` or under it: the one grammar names a run by its index (canvas primitives: "One grammar …
`items/<id>/params/<name>[/<sub>]`"). The code is the implementer's and isn't asserted.

### The expected values: the font's own fields

`helpers.ts` `subscriptMetrics` opens the file the plain run's 2 reports (`glyphs[…].font`, relative to the checkout),
walks its OpenType table directory, and reads `head.unitsPerEm` (uint16 at byte 18) and `OS/2.ySubscriptYSize` and
`OS/2.ySubscriptYOffset` (int16 at bytes 12 and 16; present in every OS/2 version). Read at the base:

| File | unitsPerEm | ySubscriptYSize | ySubscriptYOffset | At size 96: subscript size | offset below the baseline |
|---|---|---|---|---|---|
| `Inter-Regular.ttf` (and `InterVariable.ttf`, `Inter-Medium.ttf`, `Inter-SemiBold.ttf`, the same) | 2048 | 1229 | 154 | 96 × 1229 ÷ 2048 = 57.609375 u | 96 × 154 ÷ 2048 = 7.21875 u |
| `STIXTwoMath-Regular.ttf` | 1000 | 500 | 250 | 96 × 500 ÷ 1000 = 48 u | 96 × 250 ÷ 1000 = 24 u |

(A Python `struct` read of the same bytes gave the same numbers; for the other bundled faces see Readings.)

## Criteria to tests

The ID is `#1964.` + the first 8 hex digits of SHA-256 of the criterion's text, trimmed, whitespace collapsed
(`scripts/proof-change.mjs` `criterionId`). Each test's name starts with `AC1 #1964.437d15d8`, and each file quotes the
criterion in full. No planted program: the issue names none, and each assertion fails on the wrong programs listed.

| ID | Criterion | Test file: what it asserts |
|---|---|---|
| `AC1 #1964.437d15d8` | In `H2O is water` a run that makes the 2 a subscript draws it at the font's subscript offset and size, the glyphs before it keep the plain run's positions, and a run that names a status role is refused naming the run | `subscript.test.ts` (4: two clauses × two faces). One `raster` process per face draws the plain card and the card with `{from: 1, to: 2, shift: "sub"}`. **Offset and size:** the plain 2 is in the face (Inter / STIX Two Math), at size 96 on H's baseline; in the run with the subscript the 2 keeps that face, its `size` is within 0.1 u of 96 × ySubscriptYSize ÷ unitsPerEm (57.609375 / 48), and its `y` minus H's `y` is within 0.5 u of 96 × ySubscriptYOffset ÷ unitsPerEm (7.21875 / 24). Drawn so: against H's ink on the same card, the 2's ink bottom drops by that offset more than the plain 2's does, and its ink is the plain 2's height × subscript size ÷ 96, each within 1.5 px. **Before it:** H's `x` and `y` equal the plain run's within 1e-3 u, and every pixel left of the 2's pen position (one column short) equals the plain card's. `refusal.test.ts` (1): with runs `[{from: 1, to: 2, shift: "sub"}, {from: 7, to: 12, role: "status.fail"}]` the check refuses the document with an error whose path is `items/formula/params/runs/1` or under it; with run 1 in `wine` instead the check passes and `raster` draws it. |

What each assertion fails on (a wrong program it was written against):

| Wrong program | Fails at |
|---|---|
| The 2 drawn at the plain size (96) | the size (off by 38 / 48 u) and the ink height |
| The 2 drawn on the baseline | the offset (off by 7.2 / 24 u) and the ink drop |
| The 2 raised instead of lowered (sign flipped) | the offset (off by 14.4 / 48 u) |
| A fixed 0.6 em size and 0.075 em offset in place of the font's fields | STIX Two Math: size 57.6 not 48, offset 7.2 not 24 |
| A fixed 0.5 em and 0.25 em (STIX's numbers for every face) | Inter: size 48 not 57.6, offset 24 not 7.2 |
| `ySubscriptXSize` read for the size (1331 in Inter) | Inter: size 62.4 not 57.6 |
| The superscript fields read for a subscript | the offset (Inter 33.6 up or down, STIX 48) |
| The offset scaled by the subscript size, not the item's | Inter 4.3 not 7.2; STIX 12 not 24 |
| The run applied from grapheme 0 (H shrunk or shifted) | H's position and the pixels left of the 2 |
| The line's baseline moved to fit the subscript | H's `y` and the pixels left of the 2 |
| A report that says one thing and a drawing that does another | the ink checks |
| A status role in a run accepted | the refusal |
| An error that names the item or the wrong run (e.g. run 0's `shift`) | the run's path |
| Every run with `shift` refused, or every role run refused | the control (`wine`) |

## Readings where the issue and design leave a choice

- **"The font's subscript offset and size"** are the face's OS/2 `ySubscriptYOffset` and `ySubscriptYSize` over
  `head.unitsPerEm`, as the issue's oracle note names them ("a subscript run's offset and size from the font's OS/2
  fields"), not a math face's MATH table (STIX Two Math has one; the OS/2 fields are what the issue names).
  **Offset:** OS/2 `ySubscriptYOffset` is positive downward from the baseline (OpenType spec), so the 2's baseline `y`
  (document y grows downward) is size × ySubscriptYOffset ÷ unitsPerEm greater than its line's. It is measured
  against H's `y` on the same card, so a moved line shows in the second clause, not here. **Size:** the item's font
  size × ySubscriptYSize ÷ unitsPerEm, read as the glyph's `size`. The face is the one the plain run's 2 reports; the
  run sets no font, so the subscript 2 must report the same file.
- **Two faces.** Inter's fields are 0.6001 em and 0.0752 em: within 0.01 u at size 96 of the common defaults (0.6 em,
  0.075 em) a renderer might use when it ignores the font. The other bundled faces with Latin letters (Caveat,
  JetBrains Mono, Noto Sans Arabic, Noto Sans SC) carry exactly those defaults (650 × 600 at 75, of 1000). Only STIX
  Two Math (500 at 250, of 1000) differs, so the clause is checked in Inter (`body`) and in STIX Two Math (`math`, the
  look's math face, which the design sets text in beside formulas).
- **Tolerances.** Size within 0.1 u: no rule in the design rounds a size, the expected values are exact in binary
  (57.609375, 48), and 0.1 u covers f32 and 26.6 fixed-point arithmetic; every wrong size above is 4.8 u or more away.
  Offset within 0.5 u: the design lets a baseline move by at most half a device pixel when it is rounded for drawing
  (Text `text@1` Semantics), here at zoom 1; every wrong offset above is 2.8 u or more away. Ink within 1.5 px: an
  anti-aliased edge read at one threshold is good to about a pixel at each end. H's position within 1e-3 u: the same
  text shaped the same way gives the same numbers; any real move is larger.
- **"The glyphs before it"** is H alone (grapheme 0). Start alignment keeps H's place independent of the line's width,
  so a narrower 2 moves nothing before it. Glyphs after the 2 aren't asserted: the criterion says nothing of them.
- **"Draws it"**: the glyph rows are the shaped run, which the design makes the only source for drawing; the ink checks
  hold the PNG to them. A pixel is ink when a channel is more than 64 codes from the paper's; a glyph's ink is read in
  the columns between its pen position and the next glyph's, one column in from each.
- **"Names a status role"**: a run whose `role` is `status.fail` (the look's status roles are `status.<state>`; the
  status-color rule allows a status color only through a status binding). **"Naming the run"**: an error whose `path`
  is the run's, `items/formula/params/runs/1`, or under it (its `role`). The status run is run 1, after a styled run,
  so a refusal that names run 0's `shift` doesn't count.
- **"Is refused"** is read at `check`, the document's gate; `raster` runs the same check first.

## Not asserted, because the criterion doesn't say so

The implementer owes these a mapping or a note (AGENTS.md: review requirement → change → proof):

- Superscript; a numeric `shift` in u; `font`, `weight`, `style`, `size`, `tracking`, `underline`, `strike` on a run.
- Kerning across a run's edge, line breaks and the fit check with runs; where the glyphs after the 2 go.
- The 1,024-run limit; overlapping runs; `from`/`to` out of range.
- A face without OS/2 subscript fields ("where it has them").
