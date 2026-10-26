# Acceptance tests for #381: text in depth from the core's glyph atlas, one shaper everywhere, and templates of evaluated values

Written first, from issue #381 (its scope, its four acceptance criteria and its proof line: "A label in depth beside
the same text in a 2D layer, the dependency tree with one shaper, and the template fixture with and without
status"), the design sections it leans on, and base commit `d122341` ("Merge pull request #737 …"), by a job that
never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- `docs/technical-design.md`: Rules every primitive follows (863: honest numbers and colors, "a story's own numbers
  are data constants marked as story, allowed only where no status or reading is bound"; "Universal rules are tested
  as properties", 885); The canvas core and Canvas modules (1050–1062: the core check kind `honest_numbers`; the
  `text` row: "the one shaper, bundled fonts …, the glyph atlas … (the atlas for text in depth R2)"; the marks2d and
  scene3d rows: "marks in 3D … with their facing"); Conventions (1089: "a tinted mask sprite drawn from the core's
  glyph atlas"); Marks, data and diagrams (1115: "Text takes styled runs and templates over sourced values");
  Dogfooding, the parity suite and Tests written first (2518–2551); the "Which text shaper" decision (2670: "Text in
  depth draws from our own glyph atlas over parley and skrifa, rasterized by Vello CPU (R2) … parley shapes with
  HarfRust, so swash, which carries a shaper of its own, isn't linked"; "GPUI's own text stays for the app's chrome").
- `docs/canvas-primitives.md`: The status-color rule (68); Honest numbers (76: "a story's own number … names `source:
  story`, which passes only in a document that binds no status and no reading"); Document envelope (291: `data:
  {name → number | number[] | string[] | {value, source}}`); Text `text@1` (1379: `runs` "styled spans; what a run
  doesn't set stays the item's", `template` "each `{path}` shows the evaluated value at that path, such as
  `{data/k}` … at its own precision"; Semantics: "lines broken by UAX #14, bidi by UAX #9 and graphemes by UAX #29";
  "Runs style spans of the one shaped run, so a run changes its glyphs' font, weight, size, role or baseline without
  breaking kerning"; "each number it shows traces to its path's source"; "held to Unicode's own conformance files
  (LineBreakTest.txt, BidiCharacterTest.txt, GraphemeBreakTest.txt) at the pinned Unicode version …; a line the
  pinned segmenter tailors is listed by number, never skipped silently"); Look `look@1` fonts and roles (2407);
  Marks in 3D (4546: "mark.text draws from the core's glyph atlas over the one shaper (parley, with outlines read by
  skrifa), with raster sizes quantized in steps of about 12% and pages evicted least recently used (R2) … No second
  shaper") and its facing (4605); Honest numbers, the check (8858: "a number a template shows traces to its path's
  source"; "A story number … passes only where the document binds no status and no reading").
- At the base: AGENTS.md; `tests/acceptance/390/` (deep-text, `fit`, the dependency tree), `375/` (fast-check from a
  recorded seed, cases sampled and answered in one process), `378/` (`deep-gpu run`, view3d, `--planted`, the noop
  backend), `392/` and `373/` (`deep-canvas-render check` and `raster`, the clean look, a status mark bound to a
  verdict); `crates/deep-text` (parley 0.12 over HarfRust and skrifa, `Shaper`, `Atlas`, `fit`, `fonts`),
  `crates/deep-canvas-scene3d` (labels as one coverage mask per label at a fixed 64 px em, `label.rs`),
  `crates/deep-canvas` (`document/rules.rs`: `number_unsourced`, `bound_typed_over`, `status_color_unbound`),
  `crates/deep-canvas-marks`, `crates/deep-marks-vello`, `crates/deep-marks-render` (`deep-canvas-render`),
  `crates/deep-gpu-layer` (`deep-gpu`), and the base's Cargo.lock.

What the base already does and these tests don't credit: one shaper (#390) measures and draws 2D text from the
core's atlas; scene3d (#378) shapes each label once with that shaper but at a fixed 64 px em, rasterizes the whole
label into one mask of its own and scales the quad; the document check refuses a typed number (`number_unsourced`).
There is no `template` on text@1 (the check refuses a text item with no `text` as `bad_doc`), no `runs`, no report of
the glyphs a text or a label draws, and no line break, bidi or grapheme surface. The dependency rule of AC1's second
half already holds at the base (#390 laid it); its test is a regression guard, shown able to fail by its twins.

## Run them

They build cargo binaries, as #390's, #375's and #378's do, so they run one file at a time. `scripts/lanes.mjs`
needs this folder in its `alone` list (the one-at-a-time unit-lane line, so excluded from the parallel line),
beside `tests/acceptance/378/`; this README is the instruction, and the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/381 --no-file-parallelism
npx tsc -p tests/acceptance/381/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Each file first runs `cargo build --locked --bin <name>` for the binaries it drives (`deep-text`,
`deep-canvas-render`, `deep-gpu`), in the checkout, and fails each of its tests when a build fails. `tree.test.ts`
runs `cargo tree --locked` in the checkout and `cargo tree --offline` in throwaway workspaces under the OS temp
folder. PNGs and atlas pages go to temporary folders that are deleted. The tests use node built-ins, vitest and
fast-check. A run with `--root tests/acceptance/381` leaves Vitest's cache in `tests/acceptance/381/node_modules/.vite`;
delete it. `BASE-FAILURE.txt` is the run at the base.

Every test runs on the CPU, on any platform: `deep-text` and `deep-canvas-render raster`/`check` need no GPU, and the
labels in depth are read from `deep-gpu run --backend noop` (wgpu's noop backend, as #378's counting tests). A
view3d reply of `unsupported_platform` fails the test with a message that starts `INCONCLUSIVE:`; it never passes.

## The surface under test

The issue names the text module, labels in depth, the honest-numbers check and text@1's `template` and `runs`, but no
code API. These tests extend three binaries that exist, and add none:

| Binary (crate at the base) | What these tests add | Criteria |
|---|---|---|
| `deep-text` (`crates/deep-text`) | subcommands `breaks`, `graphemes`, `bidi`; `fit` read as at the base | AC3; AC4's kern precondition |
| `deep-canvas-render` (`crates/deep-marks-render`) | `raster` answers `texts`, takes `planted: "shapes_spans_apart"`; text@1 takes `template` and `runs`; `check` read as at the base | AC1 (2D side), AC2, AC4 |
| `deep-gpu` (`crates/deep-gpu-layer`) | `run`'s view3d call takes `labels: true`; `--planted label_mask` | AC1 (labels in depth) |

### The JSON-lines convention

As #390, #392 and #373 give it: one JSON object per stdin line, exactly one JSON object out per line, in order, then
exit 0; a line that can't be read, lacks a required field or names an unknown `planted` value is answered `{"ok":
false, "code": "bad_input"}`, never a panic. Every acceptance has `"ok": true`. `deep-gpu run` keeps #377's protocol
(one scenario `{"out": dir, "calls": [Call]}` per line, answered `{"ok": true, "replies": [Reply]}`).

### Glyphs

Both `raster`'s `texts` and view3d's `labels` report a text's shaped run as a list of glyphs in the order the one
shaper lays them out (left to right on a line, lines top to bottom):

```json
{"font": string, "size": number, "id": integer, "x": number, "y": number, "grapheme": integer, "role"?: string, "atlas"?: Atlas | null}
```

- `font`: the bundled font file the glyph's face comes from, as a path relative to the checkout (as `deep-text
  fonts` names files, such as `crates/deep-text/fonts/Inter-Regular.ttf`).
- `size`: the font size in px the run was shaped at; `id`: the glyph ID in that face.
- `x`, `y`: the glyph's origin as the shaped run holds it, in px from the top-left of the text's layout box, `y` on
  the glyph's baseline: the shaper's f32 values, which the tests compare as f32 (`Math.fround`), so writing them as
  f32 or as the f64 of that f32 reads the same. Not where the text sits on the page or in the world.
- `grapheme`: the index of the grapheme cluster (UAX #29, as `graphemes` finds them) the glyph belongs to.
- `role` (`raster` only): the look role the glyph's fill is painted in: its run's `role` inside a run, else the
  item's `paint.fill.role`, else `ink`.
- `atlas` (view3d only): where the glyph's raster sits in the core's glyph atlas, `{"page": integer, "x", "y", "w",
  "h": integer px, "raster": number}`, `raster` the device-px size it was rasterized at; `null` for a glyph with no
  ink (a space).

### `deep-text breaks`, `graphemes`, `bidi` (every platform)

- `breaks`: in `{"text": string, "planted"?: "space_breaker"}`, out `{"ok": true, "breaks": [integer]}`: the code
  point offsets k in 1…n (n the text's code points) where the one shaper's line breaker (UAX #14, as parley lays
  lines out) allows a line to start at code point k, n always among them. They are the opportunities the layout
  breaks at: on the file's ASCII lines, `fit` with `"box": {"w": 0}, "overflow": "mask"` must report one line per
  segment. `planted: "space_breaker"` is the criterion's wrong breaker: an opportunity after each run of U+0020
  SPACE and at the end of the text, nowhere else.
- `graphemes`: in `{"text": string}`, out `{"ok": true, "breaks": [integer]}`: the code point offsets in 1…n where a
  grapheme cluster ends, as the shaper finds clusters (UAX #29), n always among them.
- `bidi`: in `{"text": string, "dir": "ltr" | "rtl" | "auto", "planted"?: "logical_arabic"}`, out `{"ok": true,
  "paragraph": integer, "levels": [integer | null], "order": [integer]}`, the text laid out as one paragraph on one
  line with no width: `paragraph` the resolved paragraph embedding level (`auto` resolves by P2 and P3, LTR when no
  strong character is found); `levels` one entry per code point, its resolved level, `null` for a character rule X9
  removes; `order` the code point indices in the order the shaper's layout draws them from left to right, the
  removed ones left out (within a cluster: logical order at an even level, reversed at an odd one, so L2 is read
  per code point as the file does). `planted: "logical_arabic"` is the criterion's wrong layout: every run of
  Arabic-script characters resolved at an odd level is drawn in logical order, everything else as the clean layout.

Each of the 19,338 test lines of LineBreakTest.txt, 766 of GraphemeBreakTest.txt and 91,707 of BidiCharacterTest.txt
is sent as one line (BidiCharacterTest's field 1: 0 is `ltr`, 1 `rtl`, 2 `auto`).

### The vendored files

`vendor/unicode-17.0.0/` holds `LineBreakTest.txt`, `GraphemeBreakTest.txt` and `BidiCharacterTest.txt` as unicode.org
publishes them, with their sources and SHA-256 in its README; the tests check each file's SHA-256 and its version
line before reading it. Lines are numbered from 1 as the file holds them, comments included, and every failure
names `<file>:<line>`.

### Tailored lines

A line the pinned segmenter tailors may be listed in `crates/deep-text/conformance/tailored.json` (the implementation's
file, committed; absent means none):

```json
{"unicode": "17.0.0", "lines": [{"file": "LineBreakTest.txt", "line": 4351, "reason": string}]}
```

Each entry names a vendored file, a test line of it and a non-empty reason; anything else fails every conformance
test. The list must be exactly the lines that differ: a listed line where the shaper matches the file fails (stale),
an unlisted line that differs fails, and the tests print the list when it isn't empty. The planted programs run
against the same list. The tests prefer none, and none is listed here.

### `deep-canvas-render raster` (every platform), extended

Input as #373 gives it (`{"out", "doc", "look", "view"?, "t"?, "states"?, "store"?, "planted"?}`), plus `planted:
"shapes_spans_apart"` (AC4's wrong program: each span the item's runs cut the text into is shaped on its own and the
pieces are set side by side). Output adds `"texts": {item ID: {"shown": string, "glyphs": [Glyph]}}`, one entry per
text@1 item drawn: `shown` the string it draws (a template's with each `{path}` replaced by the value it shows) and
its glyphs with `role`. Documents may now use:

- `data: {name → … | {"value": number, "source": "story" | …}}` (Document envelope);
- text@1 `template: string` in place of `text`, each `{data/<name>}` showing that constant's value at its own
  precision (k = 3 shows `3`);
- text@1 `runs: [{"from", "to": grapheme index, "role": string}]` (only `role` is set by these tests).

`check {"doc", "look": "clean"}` is read as at the base (`{"ok", "issues": [{check, code, severity, ids, path, …}]}`):
the tests read `ok`, and each error's `ids`.

### `deep-gpu run --backend noop [--planted label_mask]`, view3d with `labels`

#378's view3d call, plus `"labels": true`: each frame adds

```json
"labels": [{"item": ID, "glyphs": [Glyph]}], "pages": [{"page": integer, "png": sha256}]
```

one `labels` entry per `mark.text` label the frame draws, its glyphs with `atlas`, and one `pages` entry per atlas
page those glyphs sample, written to `<out>/<sha256>.png` as an 8-bit grayscale PNG (color type 0, no interlace) of
1,024 × 1,024 whose value is the page's alpha. On the noop backend nothing is drawn, but the labels and their atlas
placements are what the frame's label instances sample. `--planted label_mask` is AC1's wrong program, the base's
path: each label shaped once at a fixed em (64 px) and rasterized into one coverage mask of its own, its glyphs
reported as that shaping gives them, with no atlas placements.

### The dependency tree

For each of `deep-text` (the text module), `deep-canvas-marks` (the text module's registration and marks2d),
`deep-marks-vello` (2D marks in Vello CPU terms), `deep-canvas-scene3d` (marks in 3D, labels among them) and
`deep-scene3d-render` (scene3d's render module, which draws text in depth): `cargo tree --locked -p <crate> -e normal
--target all --prefix none -f '{p}|{f}'`, which resolves features as a build of that crate alone (not the workspace's
union, where GPUI's own text system enables CoreText, DirectWrite and swash for the chrome). Its tree must hold:

- no package whose name starts with `gpui`;
- `harfrust`, at one version;
- none of `swash`, `rustybuzz`, `harfbuzz`, `harfbuzz-sys`, `harfbuzz_rs`, `allsorts`, `cosmic-text`, `skia-safe`,
  `skia-bindings`, `pango`, `pango-sys`, `pangocairo` (another shaper);
- none of `core-text`, `objc2-core-text`, `font-kit`, `fontdb`, `fontconfig`, `fontconfig-sys`,
  `yeslogic-fontconfig-sys`, `servo-fontconfig`, `servo-fontconfig-sys`, `fontconfig-cache-parser`,
  `fontconfig-parser`, `dwrote`, `freetype`, `freetype-sys`, `freetype-rs`, `font-loader` (a system font library);
- none of the features `fontique/system`, `windows/Win32_Graphics_DirectWrite`, `windows-sys/Win32_Graphics_DirectWrite`,
  `objc2-core-graphics/CGFont`, `objc2-app-kit/NSFont` (the system's fonts through an allowed crate).

`deep-text`'s tree must also hold `parley` and `skrifa`. The twins: a throwaway workspace whose members each depend
on a stub `harfrust` and one stub of a forbidden name (or the forbidden feature of a stub), one member with no
`harfrust`, one with `gpui-kit`, and a clean one; each forbidden member fails naming what it adds, and the clean one
passes.

## Fixtures

Written by this job before any implementation ran.

| Fixture | What it is | Read by |
|---|---|---|
| `depth-3d.json` | a 640 × 480 scene: an orthographic camera looking down −Z and four `mark.text@1` labels in screen size facing the camera: `avatar-13` (AVATAR, body, 13 px), `avatar-13-again` (the same, elsewhere), `tower-24` (Tower Yard, body, 24 px), `avatar-mono` (AVATAR, mono, 13 px) | `depth.test.ts` |
| `depth-2d.json` | a 480 × 240 board: the same four IDs as text@1 items in a 2D writer layer, the same texts, font roles and sizes, box auto | `depth.test.ts` |
| `look3d.json` | a `look@1`: #378's acceptance look (the clean look's status map and fonts, a black ground, tone map none at the exposure whose scale is 1) with only the roles these fixtures paint | `depth.test.ts` |
| `step.json` | a 480 × 120 board with `data.k = {value: 3, source: "story"}` and one text@1 `step` whose `template` is `Subtract {data/k} from both sides`; no status. The test derives the same with a 96 × 24 rect `gate` whose fill is bound to `verdict:01JB3810000000000000000001`, and each of the two with `text: "Subtract 3 from both sides"` instead, and the status one with words only | `template.test.ts` |
| generated in `runs.test.ts` | a 320 × 80 board with one text@1 `word` showing AVATAR (body, at 11, 13, 16, 24 or 37.5 px, weight 400, 500 or 600, an optional item paint), with one or two disjoint runs `{from, to, role}`, and its plain twin | `runs.test.ts` |

## Planted programs

| Where | Name | The wrong program | Criterion |
|---|---|---|---|
| `deep-text breaks` line field | `space_breaker` | breaks only after runs of spaces, and at the end | AC3 (issue-named) |
| `deep-text bidi` line field | `logical_arabic` | draws each Arabic run at an odd level in logical order | AC3 (issue-named) |
| `deep-canvas-render raster` line field | `shapes_spans_apart` | shapes each span the runs cut on its own | AC4 (issue-named) |
| `deep-gpu run --planted` | `label_mask` | the base's labels: shaped at a fixed em, one mask per label, no atlas | AC1 (a mutant: the criterion names none) |

## Criteria to tests

Each test's name starts with its criterion's ID as the issue writes it.

| ID | Criterion (the issue's text) | Tests, and the wrong programs each fails |
|---|---|---|
| AC1 | A label in depth shapes to the same glyph runs as the same text in a 2D writer layer, and the dependency tree of the canvas's text and marks crates, which never depend on gpui, links HarfRust as its one shaper and no other shaping or system font library, swash's shaper among them | `depth.test.ts`: each of the four labels' glyphs from view3d (noop) equal, glyph for glyph, the 2D twin's from `raster`: face, size, ID, grapheme, x and y as f32; the 2D runs are real (a glyph per character, at the item's size, at distinct places, from a bundled font file, mono another face than body); a twin with one glyph one f32 step off fails, naming the label and glyph. Atlas: every inked glyph has a place on a listed 1,024² grayscale page, inside it and holding ink; one place per (face, glyph, raster size) and never two keys on one place or overlapping; AVATAR samples four places and the second AVATAR the same four; each raster within one 12% step of the label's size. `--planted label_mask` fails both, naming every label. Wrong programs: the base (no `labels`, no `texts`); a label shaped at a fixed em or with another spec than 2D text; a label drawn from a mask of its own. `tree.test.ts`: the five crates' trees hold one harfrust and nothing forbidden, and deep-text's holds parley and skrifa; the twins (swash, every other shaper and system font library listed above, each forbidden feature, gpui-kit, no harfrust) each fail, named, and the clean twin passes. The base passes this half |
| AC2 | A text item `Subtract {data/k} from both sides`, with k a story constant 3, shows `Subtract 3 from both sides` and passes honest numbers in a document that binds no status, fails naming the item in one that binds a status, and the same sentence with a literal 3 in its words fails in both | `template.test.ts`: with no status, `check` passes with no error and `raster`'s `texts.step.shown` is exactly `Subtract 3 from both sides`, drawn with 26 glyphs; with the status mark bound, `check` fails with an error whose `ids` hold `step`, while that document with words only passes and the template with no status passes (so the story number in a status document is what fails), and `raster` refuses it; the literal sentence fails naming `step` in both. Wrong programs: the base (no template: `bad_doc` everywhere); a template that shows the path or nothing; a check that passes a story number beside a status binding; one that fails every template |
| AC3 | Line breaks, bidi order and grapheme boundaries match LineBreakTest.txt, BidiCharacterTest.txt and GraphemeBreakTest.txt at the pinned Unicode version on every line, read from vendor/; a planted breaker that breaks only at spaces fails the first file and a planted layout that draws an Arabic run in logical order fails the second, each naming the first line that differs | `unicode.test.ts`: every line of each file, from `vendor/unicode-17.0.0/` (SHA-256 checked), matches `breaks`, `graphemes` or `bidi` (paragraph level, levels with null where X9 removes, visual order), apart from tailored lines listed with their reasons (exactly the lines that differ); the layout at width 0 makes the file's segments on its ASCII lines. `space_breaker` answers as a space-only breaker and fails LineBreakTest first at the line a space-only breaker first differs, named; `logical_arabic` fails BidiCharacterTest first at a line holding an Arabic character at an odd level, named, by the visual order, and differs nowhere without one. A doctored grapheme answer (each code point its own cluster) fails, naming the first line that differs. Wrong programs: the base (no subcommands); a breaker on Unicode 15.1's rules (it fails 13 of the 352 ASCII lines at the base's layout); a dictionary-tailored breaker left unlisted; a bidi report computed apart from the layout |
| AC4 | Runs that change only role or paint, over any span of `AVATAR`, leave every glyph's position bit-identical to the plain run's; a planted run that shapes each span on its own loses the A-V kern and fails, naming the pair | `runs.test.ts`: a fast-check property (seed 381, 1,000 cases, all 21 spans among them, shrinking): each case's glyphs equal the plain run's in face, size, ID and grapheme, and in x and y as f32, and each glyph is painted in its run's role inside a span and the item's paint (or ink) outside. `shapes_spans_apart` with runs [1, 6), [0, 1) and [1, 3) fails naming `the pair A-V (graphemes 0, 1)`, after `fit` shows AV narrower than A beside V; a run over the whole word, which splits nothing, passes under the plant. Wrong programs: the base (no `runs`, no `texts`); runs shaped apart; runs that move glyphs by a rounding; runs that are ignored (the role check) |

## Readings where the issue and design leave a choice

- **The pinned Unicode version is 17.0.0.** At the base, `parley_engine` 0.12 finds line breaks and grapheme
  clusters with `icu_segmenter` 2.3 (compiled data, `icu_segmenter_data` 2.3) and resolves bidi with its own
  resolver over `icu_properties` 2.3 (`icu_properties_data` 2.3); `parley_data` 0.12's composite trie is tested
  against the same `icu_properties`. Both data crates were generated from ICU 78 and CLDR 48.2.1, which carry
  Unicode 17.0.0; `icu_segmenter` 2.3 ships the same LineBreakTest.txt and GraphemeBreakTest.txt (identical
  SHA-256). One thing the implementer should know: parley calls `LineSegmenter::new_dictionary`, which in
  `icu_segmenter` 2.3 runs its Unicode 15.1 rule set (the Unicode 17 rules, `new_17_*`, sit behind its `unstable`
  feature), and the dictionary segmenter breaks complex-context scripts by dictionary; at the base the layout differs
  from the 17.0.0 file on 13 of its 352 ASCII lines (such as 4351, `}%`, and 7775, `-#`). Either the breaker follows
  the 17.0.0 rules, or each line it tailors is listed with its reason; the criterion's "on every line" is read with
  the design's "a line the pinned segmenter tailors is listed by number, never skipped silently".
- **"The shaper's" breaks and order are the layout's.** `breaks` reports the opportunities parley lays lines out at,
  and the test holds the layout itself to the file where it can read it cheaply (`fit` at width 0 on ASCII lines);
  `order` is read from the layout's glyph runs. A subcommand that ran a second segmenter beside the layout would be
  a second engine, which text@1 can never be ("be measured by one engine and drawn by another").
- **"Same glyph runs"** is the shaped run itself: face, size, glyph ID, grapheme and position from the layout box's
  origin, f32 for f32. The labels are in screen size (px), so a label and a 2D text of one size are the same shaping
  input; a world-size label's run is in its own units and isn't compared. The 2D side is read from `raster`
  (Vello CPU, every platform), which draws a 2D writer layer from the same marks2d frame GPUI draws on macOS; the
  label in depth from view3d on the noop backend, so no test needs a GPU. "Beside" is two documents, since
  `deep-canvas-render` doesn't link scene3d and the 2D layers over a 3D view are drawn by GPUI only with a window.
- **"Draws from the core's glyph atlas"** (the scope, and the proof line's label in depth) is read through the
  placements the frame's label glyphs sample: one place per face, glyph and raster size across labels, with ink, on
  1 MB pages, rasterized within one ~12% step of the label's size. Subpixel variants of a glyph, if an
  implementation wants them, would need their own key reported; none is read here.
- **The canvas's text and marks crates** are deep-text, deep-canvas-marks, deep-marks-vello, deep-canvas-scene3d and
  deep-scene3d-render: the crates that shape, lay out or draw the canvas's text and marks without GPUI. The crates
  that hand them to GPUI (deep-text-gpui, deep-text-render, deep-marks-render) depend on GPUI by design, and GPUI's
  own text system (CoreText, DirectWrite, cosmic-text with swash) stays for the chrome; "which never depend on gpui"
  is read as naming the set. `skrifa`'s `autohint_shaping` feature is its autohinter's own coverage analysis, not a
  library that brings a second shaper.
- **"Fails naming the item"** is an error whose `ids` hold the item. No code is required (the base's
  `number_unsourced` would do); the words-only status twin pins the cause to the story number.
- **"Role or paint"**: runs set only `role` (the role their glyphs are painted in, the run fields' only paint), and
  cases also vary the item's own `paint`; "paint" in the criterion is read as the item's paint under the runs.
- **The planted bidi layout** is defined by script (Arabic blocks) and level (odd), since parley itemizes runs by
  script and level; the test names the first failing line and checks it holds such a run.

Not tested, because no criterion asks: the exact raster quantization steps and least-recently-used page eviction;
tabular figures, the fit check and "never cut short" (#390's suite covers them); a template's other paths (a
control, a driver's target, a mark set's period or head) and precisions other than an integer constant's; a
number's trace reported beside it; HarfRust's own shaping tests; text that scales or carries a halo (R6).
