# Acceptance tests for #1175: vector@1 draws clipPath, mask, pattern, marker and style blocks instead of only naming them

Written first and blind, from issue #1175 (its scope, its three acceptance criteria and its proof line: "The fixture
drawn by the canvas and by a pinned headless Chrome, with the pixel comparison and the planted importer"), the design
and base commit `e2e6e1cc` ("Merge pull request #1211 …"), by a job that never saw an implementation; none existed.
The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding).

What was read:

- `docs/canvas-primitives.md`: Vector and formula `vector@1` (1815), Mask `mask@1` (1855: luminance in linear
  light), Paint (1657), Builder `extrude`: outlines from text, paths and SVG (2946).
- `docs/technical-design.md`: the verdict rules (205: INCONCLUSIVE, "every non-PASS check result also becomes an open
  item"), Open items as records, Known failures are waivers ("Closing an open item without evidence, as out of scope
  or won't fix, is a waiver too", accepted only through your approval, never by the agent), Whose checks count,
  Evidence states, Protection; the four invariants (AGENTS.md); Dogfooding, the parity suite, the perceptual oracle and
  planted twins ("Every comparison between two outputs has a planted-mismatch twin").
- At the base: `tests/acceptance/398/` (README, REDRAFT-AC6.md, `elements-redraft.test.ts`, `elements-helpers.ts`,
  `helpers.ts`; its fixture `fixtures/elements/elements.svg`), `tests/acceptance/1174/` (the taste-call record
  `TASTE.json` and `taste.test.ts`, the precedent for AC3), `tests/acceptance/1002/README.md`;
  `crates/deep-marks-render` (`deep-canvas-render`: `check`, `raster`, how `planted` is read) and
  `crates/deep-canvas-vector` (`check`: an element the import doesn't read is a `svg_unsupported` warning naming it).

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 npx vitest run --root tests/acceptance/1175 --no-file-parallelism
npx tsc -p tests/acceptance/1175/tsconfig.json   # type-check (exits 0)
```

Every file first runs `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-marks-render --bin
deep-canvas-render` in the checkout and fails each of its tests when the build fails, so the files run one at a time:
`scripts/lanes.mjs` lists `'tests/acceptance/1175/'` in `alone` (this job's one edit outside this folder). The tests
write the store, the PNGs and Chrome's profile under the OS temp folder and delete them; `taste.test.ts` also writes
its screenshots to `target/acceptance/1175/` (kept: they are what the owner is shown). Node built-ins and vitest only.
A run with `--root` leaves Vitest's cache in `tests/acceptance/1175/node_modules/.vite`; delete it.

`BASE-FAILURE.txt` is the run at the base: **10 of 10 fail**. AC1's six fail on the base's drawing (the clipped rect
whole, the right half of the masked rect blue, no pattern, no marker, the styled rect orange; 81.4% of pixels within
4 codes of Chrome's); AC2's three fail on the missing surface (no `verdict` in `check`'s answer; `planted:
"import_drops_marker"` answered `bad_input`); AC3 fails `INCONCLUSIVE: no taste call is recorded`.

## The surface under test

The issue names no code API, so these tests extend #398's proof surface, the `deep-canvas-render` binary (crate
`crates/deep-marks-render`), with no new subcommand. #391's JSON-lines convention holds: one JSON object in per line,
one out, exit 0; an unknown `planted` value or a malformed field answers `{"ok": false, "code": "bad_input"}`.
Everything #373's and #398's READMEs define for `check`, `raster` and the `vector@1` item stays as it is.

**Documents.** One board of `size` u, one writer layer, one `vector@1` item `art` at `at.pos: [0, 0, 0]` with
`params: {src, size, colors, alt}`: `src` the sha256 of the SVG read from the request's `store` folder; `size` the
board's size, so the viewBox is drawn uniformly scaled onto the whole board (elements.svg: 240 × 160 at scale 1, the
same size Chrome draws it; the formula: 940 × 180, twice its 470 × 90 viewBox). `colors` maps every color the SVG
writes (attributes, style attributes and the `<style>` block) as written and as lowercase `#rrggbb`, black, and the
key `currentColor`, each to a role `svg.<rrggbb>`; the look's `light` theme holds each role at exactly that CSS color,
over a white `ground`. Chrome draws on the same white.

**`raster {out, doc, look, store, t: 0, planted?}`** answers `ok` and writes the PNG of the board, as at the base.

**`check {doc, look, store, planted?, accepted?}`**: the answer gains one field, and the request one:

| Field | Shape and meaning |
|---|---|
| answer `verdict` | `{outcome, open: [{item, element}]}`. `open` lists, once per item and element, each visible element an import dropped (did not draw as SVG defines it) and that `accepted` doesn't hold; `element` is the SVG tag name exactly cased (`"marker"`), `item` the vector item's ID. `outcome` is `"INCONCLUSIVE"` while `open` is non-empty and the check raised no error, and `"PASS"` when the check raised no error and `open` is empty. Outcomes for a check with errors aren't tested. |
| request `accepted` | `[{item, element}]`: the issues the person accepted. An entry equal to an open item removes it from `open`. Absent means none. |

The dropped element's issue itself stays as at the base (an issue naming the element as data, for example
`svg_unsupported` with `actual: "marker"`, severity `warning`); the tests read it as #398's do: an issue names an
element when it holds the tag name as a string value outside `what` and `fix`.

**The planted importer** (AC2's wrong program), on `check` and `raster`, reachable only through this field:

- `planted: "import_drops_marker"`: the import drops every `<marker>` and every `marker-start`, `marker-mid` and
  `marker-end` reference, drawing no marker, and reports it only as a warning-level issue naming `marker`; it changes
  nothing else (the other four elements draw as the honest import draws them).

AC1 needs no planted value: the base is its wrong program.

## Chrome

The reference is the pinned headless Chrome, **Chrome for Testing 156.0.8078.4** (`chrome-headless-shell`), read from
`$DEEP1175_CHROME`, by default the path this machine holds it at
(`~/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux-arm64/chrome-headless-shell`). Each
use first runs `--version`: a missing binary, or any other version, fails the test with a message that starts
`BLOCKED:` and says it is not a pass. The SVG is written to a temp file and drawn with `--headless --disable-gpu
--force-color-profile=srgb --force-device-scale-factor=1 --hide-scrollbars --default-background-color=ffffffff
--window-size=W,H --screenshot=…`, a fresh `--user-data-dir` each time. Neither fixture sets `width` or `height`, so
Chrome draws the viewBox onto the whole window, as the canvas draws it onto the whole board.

## Fixtures

| Fixture | What it holds |
|---|---|
| `fixtures/elements.svg` | #398's `fixtures/elements/elements.svg`, copied byte for byte: a rect 10..70 (#1e7b34) clipped by a `<clipPath>` rect 20..40; a rect 90..150 × 10..70 (#2050c0) under a user-space `<mask>` white over 90..120 and black over 120..150; a rect 180..220 × 20..60 filled by a 20 × 20 user-space `<pattern>` whose top-left 10 × 10 is #c03020; a path (20, 120) → (80, 120), #303030, 2 wide, with `marker-end` a 12 × 12 #7a2a90 square, refX/refY 6, user-space units, `orient="0"`; a rect 140..180 × 100..140 with `class="tinted"` and `fill="#e0a000"`, under `<style>.tinted { fill: #208080; }</style>` |
| `fixtures/mathjax-clip.svg` | **written by hand by this job** as MathJax writes a formula: "x + 1 = 1 + x", glyph outlines (`MJX-2-TEX-I-1D465`, `-N-2B`, `-N-31`, `-N-3D`) once in `<defs>`, each glyph a `<use xlink:href>`, `fill="currentColor"` with no color set, `scale(1,-1)`, terms as `<g data-mml-node>` with ids; the right-hand side `g#term-rhs` carries `clip-path` to a `<clipPath>` rect ending at x = 430, through its last glyph, as a reveal leaves it. No `<text>`. It feeds only AC3's screenshots. |

## What each test holds

Measures read the canvas's PNG composited over the ground; elements.svg is at scale 1 from the origin, so pixel column
x covers [x, x + 1) u. "Coverage" is how far a pixel has gone from the ground toward the element's color (least
squares over R, G, B, clamped 0..1). An edge is read from a run of 10 pixels across it: the coverage summed over the
run is the length of color in it, which places the edge to a fraction of a pixel.

- **Clip.** The clipped rect's edges at x = 20, 40 (rows 23, 30, 37) and y = 20, 40 (columns 23, 30, 37), each within
  0.5 u; every pixel of [5, 75)² wholly outside [19, 41)² is the ground within 2 codes.
- **Mask.** Luminance 1 over 90..120, 0 over 120..150: every pixel of [91, 119) × [11, 69) is #2050c0 and every pixel
  of [121, 149) × [11, 69) the ground, within 2 codes (alpha = luminance, composited over the ground).
- **Pattern.** The color's edges at x = 180, 190, 200, 210 (rows 25, 45) and y = 20, 30, 40, 50 (columns 185, 205),
  rising and falling in turn, each within 0.5 u: 20-unit tiles from (0, 0), not scaled to the rect.
- **Marker.** The square's four edges on its middle rows and columns (the left edge skips rows 118..121, where the line
  meets it); each edge's turn, from its least-squares slope, within 1° of the line's tangent at its end (0°); its
  middle (80, 120) within 0.5 u and its sides 12 ± 1 u.
- **Style.** Every pixel of [141, 179) × [101, 139) is #208080 within 2 codes (orange #e0a000 is named if seen).
- **Chrome.** The share of the 38,400 pixels whose every channel lies within 4 codes of Chrome's render is at least
  0.99. In the same test, Chrome's own render must meet all five measures above (a guard on the measures and on
  Chrome's setup), and the comparison's planted-mismatch twin, Chrome's render of the file with its `<style>` block
  removed, must fail it (it scores 0.958).

**Calibration, done while drafting (scratch scripts outside the suite).** Chrome's render meets all five measures
with no problem. Chrome renders of mutated copies fail the measure they touch: clip width 21 (edge at 41.00), pattern
tile 21 (edges 5 u off), refX 7 (middle 1 u off), mask white #fafafa (1,624 pixels off), orient 1.5° and 45°. Chrome's
antialiasing quantizes near-horizontal edges (it reads orient 1.0° as 0° on its top edge), so the 1° bound was also
checked on an analytically covered square (32 × 32 samples per pixel): the measure reads 0.50, 0.88, 1.09, 1.50, −1.19
and 3.01° for squares turned 0.5, 0.9, 1.1, 1.5, −1.2 and 3°, passing the first two and failing the rest, and a square
moved 0.6 u off the line's end fails the middle.

## Criteria to tests

Each test's name starts with its criterion's ID.

| ID | Criterion (the issue's text) | Tests, and the wrong program each fails on |
|---|---|---|
| AC1 | `elements.svg` imports with the clipped rect inside its clip within 0.5 u, the masked rect's alpha following the mask's luminance within 2 codes, the pattern tiled at its own size, an arrowhead at the line's end turned to its tangent within 1°, and the styled rect teal, compared with Chrome's render of the same file at the same size within 4 codes at 99% of pixels | `import.test.ts` (6): one test per measure (clip, mask, pattern, marker, style), and the Chrome comparison with its guard and planted-mismatch twin. Each fails on the base, which draws the clipped rect whole (edges at 10 and 70), the masked rect unmasked, no pattern, no marker and the styled rect orange (0.814 of pixels within 4 codes of Chrome) |
| AC2 | A planted importer that drops `<marker>` with only a warning presents INCONCLUSIVE, naming the element, never PASS | `verdict.test.ts` (3): the honest import of elements.svg raises no error, `open: []`, outcome `PASS` (an import that leaves any of the five dropped, or a check that reads INCONCLUSIVE on any warning, fails); `planted: import_drops_marker` draws no marker while the other four still pass their measures, raises only a warning naming `marker`, and the check presents `INCONCLUSIVE` with `open` exactly `[{item: "art", element: "marker"}]` (a check that presents PASS with the warning, as the base does, fails); with `accepted` naming `mask` it stays INCONCLUSIVE with the marker open, and with `accepted` naming the marker it presents PASS with nothing open (a check that ignores `accepted`, or clears on any acceptance, fails). At the base all three fail on the missing `verdict` and `bad_input` |
| AC3 | Shown to you: screenshots of `elements.svg` drawn by the canvas beside Chrome's render, and a MathJax formula with a clip, taken by the check run from the renderer's own output, are attached to the PR and shown to you in the session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it | `taste.test.ts` (1): writes the screenshots below from this run's `raster` pixels and Chrome's, each non-blank, prints their SHA-256s, then reads `TASTE.json`: none, or one on other pictures, fails `INCONCLUSIVE:`; `looks_wrong` fails; `looks_right` on exactly these pictures passes. No AC1 or AC2 test reads these pictures or the call |

### The taste call (AC3)

`taste.test.ts` writes these 8-bit RGB PNGs (no filter, zlib level 9, so equal pixels give equal bytes) to
`target/acceptance/1175/`:

| File | What it shows |
|---|---|
| `elements-canvas.png` | the canvas's raster of elements.svg, 240 × 160, as drawn |
| `elements-canvas-chrome-x3.png` | the canvas (left) beside Chrome (right), 3 × 3 per pixel, on a grey strip |
| `mathjax-clip-canvas.png` | the canvas's raster of the MathJax formula with a clip, 940 × 180 |
| `mathjax-clip-canvas-chrome-x2.png` | the canvas (left) beside Chrome (right), 2 × 2 per pixel |

Those files are attached to the PR and shown to the owner in the session. The owner's answer is recorded in
**`tests/acceptance/1175/TASTE.json`**, the one file anyone adds to this folder after this commit, and only to record
that answer (the shape #1174's suite uses):

```json
{"issue": 1175, "criterion": "AC3", "verdict": "looks_right" | "looks_wrong", "who": string, "when": "ISO 8601 time",
 "screenshots": {"elements-canvas.png": sha256, "elements-canvas-chrome-x3.png": sha256,
 "mathjax-clip-canvas.png": sha256, "mathjax-clip-canvas-chrome-x2.png": sha256}, "note"?: string}
```

The SHA-256s bind the call to the pictures, so a call can't outlive the pictures it was made on. The base's run wrote
the pictures (the canvas side shows the bug the issue describes) and stops at `INCONCLUSIVE`.

## Readings where the issue and design leave a choice

- **The verdict's surface.** "Its check reads INCONCLUSIVE" is read as `check`'s answer carrying the design's outcome
  word, beside `ok` and the issues, with the open items naming what keeps it from PASS ("every non-PASS check result
  also becomes an open item"). `ok` keeps its base meaning (no error), so an INCONCLUSIVE document still draws; the
  tests never read `ok` as the verdict.
- **Accepting the issue.** The design accepts a known failure, or closes an open item without evidence, only by the
  person's approval, never by the agent (Known failures are waivers; invariant 3). So the acceptance is not a field of
  the document, which agents write: it is an input to the check, `accepted`, which in the product the hub fills from
  the person's saved decisions. This is the smallest surface: one request field naming the item and the element.
- **"Naming the element"** is the open item's `element`, the tag name exactly cased, and an issue holding it as data.
- **"An arrowhead at the line's end turned to its tangent".** The fixture is copied unchanged and its marker is a
  12 × 12 square with `orient="0"` on a horizontal line, so "the arrowhead" is that marker and its expected turn is the
  tangent's 0° (equal here to its fixed orient); a square's turn is read modulo 90°, the most a square shows. "At the
  line's end" is its middle at (80, 120) within 0.5 u, the clip criterion's tolerance (the issue gives none).
- **"Alpha following the mask's luminance within 2 codes"** is read on the composited pixels (the PNG has the ground
  under it): luminance 1 must show the rect's color and 0 the ground, each within 2 codes. The fixture's mask is pure
  white and black, so SVG's sRGB luminance and `mask@1`'s linear-light luminance agree.
- **"Tiled at its own size"** is the tile's edges at multiples of 10 u from the pattern's origin, within 0.5 u (the
  issue gives no tolerance; the clip's is used).
- **"Within 4 codes at 99% of pixels"**: a pixel is within when each of R, G, B differs by at most 4 codes.
- **AC3's screenshots** include Chrome beside the formula too, though the criterion asks only for "a MathJax formula
  with a clip"; it is free (the same Chrome call) and gives the taste call a reference.

## BLOCKED, INCONCLUSIVE and not tested

- **BLOCKED** (fails, never passes): any test that needs Chrome when the pinned Chrome is missing or another version.
  On a machine without it, set `DEEP1175_CHROME` to Chrome for Testing 156.0.8078.4.
- **INCONCLUSIVE** (fails, never passes): AC3 until `TASTE.json` records the owner's call on exactly this run's
  screenshots.
- Not tested, because no criterion asks: `<style>` type and ID selectors (the scope names them; the fixture has a class
  selector only), markers at a path's start and middle vertices and `orient="auto"` on a curve, object-bounding-box
  units, gray masks, other elements still outside the list, the outcome of a check with errors, and the vector
  module's other fields.
