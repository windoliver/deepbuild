# Acceptance tests for #390: one shaper, the canvas's glyph atlas, and glyphs through the GPUI patch

Written first, from issue #390 (its scope, the `text@1` fields, its three acceptance criteria and its proof
line), the design sections it links (`docs/technical-design.md`: The canvas core and Canvas modules, lines
1049–1080, the `text` module row and the Conventions paragraph's "tinted mask sprite drawn from the core's
glyph atlas (one alpha page, a color per instance)"; Marks, data and diagrams, lines 2447–2463; the "Which
text shaper" decision, line 2660: "the stack Vello uses … parley and skrifa, rasterized by Vello CPU …
swash … isn't linked"; `docs/canvas-primitives.md`: Honest numbers, line 80; Text `text@1`, lines 1364–1399,
whose Semantics say "shaped once", "the fit check uses `widest`", "a number that doesn't fit fails rather
than being cut", and "never from GPUI's own text system, whose macOS rasterizer thickens strokes by the
text's color and the user's font-smoothing setting"; Look `look@1` fonts and roles, lines 2400–2421; the
Draw path row, line 9267) and base commit `554bebb`, by a job that never saw an implementation. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

Run them (a root with no config of its own uses Vitest's defaults; the repo's `vitest.config.ts` also takes
`tests/**/*.test.ts` from `scripts/lanes.mjs`, so they join the unit lane; like #389's they build cargo
binaries, so they run with `--no-file-parallelism`, and `scripts/lanes.mjs` needs its exclude and its
one-at-a-time line widened from `tests/acceptance/389/` to this folder too):

```sh
npm ci                      # once, if node_modules is missing
npx vitest run --root tests/acceptance/390 --no-file-parallelism
```

`fit.test.ts` first runs `cargo build --locked --bin deep-text`, and `smoothing.test.ts` and `atlas.test.ts`
run `cargo build --locked --bin deep-text-render`, in the checkout (cached after the first file), and fail
each of their tests when that build fails. `lint.test.ts` builds two throwaway cargo workspaces under the OS
temp folder that resolve with no registry crate (below). The pixel tests write PNGs under the OS temp folder
and delete them. The tests use only node built-ins and vitest (the PNG reader is in `helpers.ts`), and
type-check under the root `tsconfig.json`'s strict options with `allowImportingTsExtensions` (checked against
a copy of the options outside the repo). A run with `--root tests/acceptance/390` leaves Vitest's cache in
`tests/acceptance/390/node_modules/.vite`; delete it, it is not part of the suite. `BASE-FAILURE.txt` is the
run at the base: every test fails there because the binaries and the script don't exist.

The pixel tests (AC1, AC3's render) need macOS: GPUI's offscreen Metal renderer draws the card, as the
`deep-app` screens suite does at the base. Off macOS, and when the render answers `unsupported_platform`,
they fail with a message that starts `INCONCLUSIVE:`; they never pass there. AC1 also fails `INCONCLUSIVE`
when the user's own global `AppleFontSmoothing` is `0`, since then a twin drawing through GPUI's text system
would draw the same pixels twice as well. The comparison switches smoothing off for the render process alone,
through its own CFPreferences domain (below), and puts the domain back as it found it.

## The surface under test

The issue names a shaper, an atlas, a fit check, a sprite, a dependency tree and a lint, but no code API, so
these tests define the smallest surface they need: one workspace crate `crates/deep-text` with a binary
`deep-text` (found at `target/debug/deep-text`), one binary `deep-text-render` (found at
`target/debug/deep-text-render`, in whichever workspace crate the implementer chooses, since it must reach
GPUI and `deep-text` must not), both driven by JSON lines on stdin and JSON lines on stdout, and one Node
script `scripts/text-lint.mjs`. Nothing else is read, except `cargo metadata` and the font files `fonts`
names.

### The JSON-lines convention

`<binary> <subcommand>` reads one JSON object per stdin line and writes exactly one JSON object per input
line to stdout, in order, then exits 0. A line it can't read as JSON, or that lacks a required field, is still
answered with one line, `{"ok": false, "code": "bad_input"}`, never a panic; a run that writes fewer lines
than it read, or exits non-zero, fails every test that drove it. Every refusal is `{"ok": false, "code":
string}`; every acceptance has `"ok": true`. Lengths are logical pixels as f64 JSON numbers; colors are
`[r, g, b]` integers 0–255 (sRGB-encoded, as the look's roles resolve for a 2D writer layer).

### `deep-text fit`

Input:

```json
{"text": string, "widest"?: string, "number"?: bool, "font"?: string, "size"?: number, "weight"?: number,
 "numerals"?: "tabular" | "proportional", "box"?: {"w"?: number, "h"?: number}, "max_lines"?: number,
 "overflow"?: "mask" | "ellipsis"}
```

- `text` is required (`bad_input` without it). `number: true` says the text stands for a bound number or a
  counter (`text@1`: "or a bound value, or `counter {…, tabular: true}`"); default false.
- `font` is a look role; default `body`. A role the bundled look doesn't define (`system-ui`, `Helvetica`,
  `Arial`, `.AppleSystemUIFont`, anything else) is refused with `bad_font`: a font is never resolved from the
  system.
- `size` default 13, `weight` default 400, `numerals` default `tabular` when `number` is true and
  `proportional` otherwise, `max_lines` default none, `overflow` default `ellipsis` (and ignored for a number,
  which is never ellipsized or wrapped), `box` members absent mean `auto` (so `{"text": …}` alone measures
  the text). The line height is the `text@1` default, `1.3 × size` rounded to whole px.

Output: `{"ok": true, "fits": bool, "width": number, "height": number, "lines": number, "shown": string}`.

- `width`/`height` are the shaped text's extent (the text, not `widest`) as the one shaper lays it out:
  `width` the widest line's advance, `height` `lines × line_height`.
- `fits` is false whenever the text, or `widest` when given, can't be shown whole inside the box (its
  width, and its height or `max_lines`); the fit check reads `widest` as the longest value the item can
  show, so a text that fits but whose `widest` doesn't fails.
- `shown` is the text as it would be drawn: for a number it is always the text itself, on one line (`lines`
  is 1), whether or not it fits; for other text under `overflow: ellipsis` that doesn't fit its last allowed
  line it ends with U+2026 and is shorter than the text.

### `deep-text fonts`

Input `{}`. Output `{"ok": true, "fonts": [{"role": string, "family": string, "file": string}]}`: every role
the bundled look defines, `body` among them, each `file` a path relative to the checkout root of a font file
that ships in the repo (an OpenType/TrueType/WOFF signature at its first four bytes).

### `deep-text-render render`

Input:

```json
{"out": string, "card": {"w": number, "h": number, "color": [r, g, b]},
 "labels": [{"text": string, "x": number, "y": number, "size": number, "weight": number, "font": string, "color": [r, g, b]}]}
```

Draws a `w × h` px card filled with `color`, then each label as a 2D writer layer's `text@1` would be drawn
where GPUI composites it: shaped by the one shaper (`deep-text`), its glyphs rasterized into the canvas's
own atlas by Vello CPU from their outlines, and drawn with GPUI's offscreen Metal renderer through the GPUI
patch's tinted mask sprite, never through GPUI's text system. `x, y` is the top-left of the label's layout
box, `size`/`weight`/`font` as in `fit`. The frame is captured at scale factor 1 and written to `out` as an
8-bit RGB or RGBA PNG, no interlace, exactly `w × h` pixels.

Output on macOS:

```json
{"ok": true, "width": w, "height": h, "labels": [{"x": number, "y": number, "w": number, "h": number}],
 "shaped": number, "draws": [{"kind": "tinted_mask_sprite", "page": id, "color": [r, g, b], "glyphs": number}], "pages": [id]}
```

- `labels[i]` is label `i`'s layout box as shaped (`w` the advance, `h` the line height), in px.
- `shaped` is the number of distinct runs the shaper shaped for this frame: two labels with one text, font,
  size and weight are one shaped run (`text@1`: "shaped once per (text, font hash, size, features, width)").
- `draws` has one entry per label per atlas page it reads, in label order; `page` is the atlas page's id
  (any JSON value, equal for equal pages), `color` the tint; `pages` lists the distinct pages the frame read.
- Off macOS the answer is `{"ok": false, "code": "unsupported_platform"}` (exit 0), which the tests report as
  INCONCLUSIVE.

The process reads no flag for font smoothing. AC1 switches it off for the render process itself with
`defaults write deep-text-render AppleFontSmoothing -int 0`: an unbundled executable's CFPreferences
application domain is its executable name, so that is what GPUI's `CFPreferencesCopyAppValue(…,
kCFPreferencesCurrentApplication)` in `gpui-pre-apple`'s text system reads in that process (this job
verified the domain with a probe tool on macOS 14). The test records the domain's prior state, requires the
key unset before it runs, and deletes the key and, when it created it, the domain afterwards, in a `finally`.
Nothing global is written.

### The dependency tree

`cargo metadata --format-version 1 --locked` in the checkout: the normal-dependency closure of the
workspace package `deep-text` (every `dep_kinds` entry whose `kind` is null, on any target; not dev, not
build) must hold `parley`, `skrifa` and `vello_cpu`, and must hold neither `swash` nor any package whose
name starts with `gpui`. The workspace package with the bin target `deep-text-render` must be in the lint's
scope (below): named `deep-text…`, or carrying `[package.metadata.deep] canvas_text = true`.

### The lint script

`node scripts/text-lint.mjs` lints the repo's own workspace; `node scripts/text-lint.mjs --root <workspace
dir>` lints the workspace at `<workspace dir>` (its `Cargo.toml`; nothing from the repo's own tree is in
scope then). Its scope is every workspace member crate whose name starts with `deep-text`, plus every
workspace member crate whose `Cargo.toml` says `[package.metadata.deep] canvas_text = true` (it draws the
canvas's text), read from `cargo metadata`. A crate outside the scope is not read: GPUI's own text stays for
the app's chrome. In every `.rs` file of a scope crate, the lint refuses each line that calls into GPUI's
text system, by name, whichever crate provides the name:

| Form | What the line holds |
|---|---|
| `text-system` | a `.text_system()` call |
| `shape-line` | a `.shape_line(` call |
| `shape-text` | a `.shape_text(` call |
| `layout-line` | a `.layout_line(` call |
| `paint-glyph` | a `.paint_glyph(` call (GPUI's glyph painter; `paint_emoji` may join it) |
| `styled-text` | the type `StyledText` |
| `shaped-line` | the type `ShapedLine` |
| `wrapped-line` | the type `WrappedLine` |

It prints one line per finding of the form `FAIL <text> <file>:<line>[:<column>] <text>` (any text around,
but the token `<file>:<line>` with the file relative to the workspace root, such as
`drawer-planted/src/lib.rs:9`) and exits non-zero on any finding; with no finding it exits 0 and prints no
`FAIL` line. A compile error in a scope crate is not a finding (the planted workspaces compile).

The planted workspace `lint.test.ts` builds under the OS temp folder has three members, `deep-text-planted`
(the prefix; its manifest says `canvas_text = false`, so the prefix alone must put it in scope),
`drawer-planted` (`canvas_text = true`) and `chrome-planted` (no marker, no prefix: out of scope, and a lint
that names it is wrong), each with one `src/lib.rs` holding the eight forms once each, on these marked lines:

```rust
let system = window.text_system();                 // text-system   (line 9)
let line = system.shape_line("Ready");             // shape-line    (line 10)
let wrapped = system.shape_text("Ready");          // shape-text    (line 11)
let laid = system.layout_line("Ready");            // layout-line   (line 12)
window.paint_glyph(7);                             // paint-glyph   (line 13)
let styled = gpui::StyledText::new("Ready");       // styled-text   (line 14)
let shaped: Option<gpui::ShapedLine> = None;       // shaped-line   (line 15)
let lines: Vec<gpui::WrappedLine> = Vec::new();    // wrapped-line  (line 16)
```

All three crates depend on `gpui` and `atlas` as path crates `stubs/gpui` (a `Window` with `text_system`,
`paint_glyph` and `paint_tinted_mask`, a `TextSystem` with `shape_line`, `shape_text` and `layout_line`,
and `ShapedLine`, `WrappedLine`, `StyledText`) and `stubs/atlas` (a `Shaper` with `shape_run`,
`shape_runs` and `place_run`, and `ShapedRun`, `Line`, `Label`), excluded from the workspace members. Why
stubs: the real GPUI resolves from a git source and the throwaway workspace must build offline and
deterministically, and the lint must catch the forms by name whichever crate provides them (the design's
lint is a call-site lint, not a version check). The clean twins keep the same shape and depend on the same
stub `gpui` (a drawing crate must reach GPUI to issue sprites, so a lint that flags the dependency is wrong)
but call only the canvas's own names: `atlas::Shaper::new()`, `shape_run`, `shape_runs`, `place_run`,
`window.paint_tinted_mask(7)`, `atlas::Label::new`, `Option<atlas::ShapedRun>`, `Vec<atlas::Line>`; a lint
that flags any of those is wrong. The twins' comments carry none of the eight names.

## Fixtures

- `fixtures/fit.json`: nine fit cases with their verdicts, written by this job before any shaper ran. Boxes
  are chosen so the verdicts hold for any text face at 13 px: nine digits and commas never fit 10 px, two
  digits always fit 26 px, ten characters never fit 26 px. Each case names what it expects: `fits`, `shown`
  (a number shown whole), `lines` (a number on one line), `ellipsized` (plain text over its one line).

## Criteria to tests

Each test's name starts with its ID. Where a criterion names a wrong program, a comment at the assertion
that catches it says so, and the assertion's message names what the criterion asks for.

| ID | Criterion (the issue's text) | Tests, and the wrong program each fails on |
|---|---|---|
| AC1 | A white label on a dark card draws the same pixels with macOS font smoothing on and with AppleFontSmoothing set to 0, since its glyphs come from the canvas's atlas; drawn through GPUI's text system, its strokes would thicken | `smoothing.test.ts` AC1: `render` of a white 24 px `body` label on a `[24,24,24]` card, once with the render process's `AppleFontSmoothing` unset and once set to 0; the PNGs must be equal pixel for pixel (the message counts the differing pixels and names the first). The base fails for no binary; a twin drawing through GPUI's text system fails because `glyph_dilation_for_color` dilates white at level 4 with smoothing allowed and at 0 without. A program writing a fixed or empty image passes that and fails the second test, where "Ready" and "Blocked" must differ, and the first test's label check: ink within the reported box (4 px margin), spanning 60% of it, white-ish pixels covering 3–70% of the box, the card color at a corner |
| AC2 | Bound numbers use tabular figures and are never cut short, and text that doesn't fit its widest string fails the fit check | `fit.test.ts` AC2: the fixture cases (a mutant that ellipsizes or truncates a number fails on `shown`, one that wraps a number on `lines`, one that ignores `widest` on `fits`); the measured case, where a box one pixel narrower than the program's own width for `"100,000.00"` fails `"42"` with that `widest` and passes `"42"` alone (a program checking only the text fails); tabular figures, where `0000` … `9999` measure alike within 0.01 px at 13 and 24 px (a mutant shaping bound numbers with proportional figures fails for any face whose `1` is narrower than its `0`), and `numerals: tabular` on plain text gives one advance per digit |
| AC3 | Two labels in two colors from one shaped run share one atlas page and draw through the patch's tinted mask sprite, with no call into GPUI's text system, checked from the dependency tree and a call-site lint | `atlas.test.ts` AC3 render: `"Ready 1,234"` in white and in `[255,24,24]` on a `[24,24,24]` card; both colors share the card's and the label's red, so each pixel's red channel is the card blended by coverage alone, and one mask tinted per instance gives equal red channels at equal offsets (within 3) while the green channels differ by at least 150; the report must say `shaped: 1`, two `tinted_mask_sprite` draws on one `page`, one entry in `pages`. A twin rasterizing each color through GPUI's text system fails on the red channels (white dilates at level 4, this red at level 1). `atlas.test.ts` AC3 tree: `deep-text`'s closure holds `parley`, `skrifa`, `vello_cpu` and no `swash` or `gpui*`; the crate owning `deep-text-render` is in the lint's scope; `scripts/text-lint.mjs` over the repo exits 0 with no `FAIL` line. `lint.test.ts` AC3: the eight plants in each of two scope crates are each named by `<file>:<line>`, the chrome crate is not, and the twins pass |

"It can never" checks that were cheap, in `fit.test.ts`: `fonts` lists `body` with a font file that ships in
the repo; a role the look doesn't bundle is `bad_font` (never a system font); a line without `text` is
`bad_input`, not a panic. "Never ellipsize or wrap a number" is inside AC2's fixtures. "Be measured by one
engine and drawn by another" is read in AC1 as the ink lying within the shaper's reported box; a full check
needs the same shaper's metrics on both sides and is not attempted here. "Shape per frame" is not observable
through this surface and is not tested.

## Readings where the issue and design leave a choice

- **Two binaries.** The shaper's crate must not reach GPUI (the dependency-tree criterion), while drawing
  through the patch's sprite must, so `fit` and `fonts` live in `deep-text` and `render` in a binary the
  implementer places where GPUI is reachable; the test finds it by bin-target name and requires its crate to
  be in the lint's scope, so the drawing code can't sit outside the lint's reach.
- **The smoothing switch** is the test's, not the program's: a flag on the binary would be the program's
  word about what it switched. The render process's own CFPreferences domain is switched with `defaults`,
  which is exactly what GPUI's text system reads, and restored afterwards.
- **Coverage identity** is the behavior behind "one alpha page, a color per instance": with both labels'
  red equal to 255 on a card whose red is 24, the red channel depends on the coverage alone in any blend
  space, so a tinted mask gives equal red channels. The report's `shaped`, `draws` and `pages` are read
  alongside, not instead.
- **`number: true`** stands for "a bound value or a counter", since the surface takes no document; it makes
  `numerals` default to tabular and forbids ellipsis and wrapping, as `text@1` says.
- **`fits`** is false for ellipsized plain text too: the fit check's question is whether the text shows
  whole; `overflow` says what is drawn when it doesn't, and `shown` reports it.
- **The lint's scope marker** is `[package.metadata.deep] canvas_text = true`, and the prefix is the crate
  name `deep-text`; a crate outside both is not read, since the chrome keeps GPUI's text.
- **The eight forms** are the GPUI 0.3.9 text system's entry points a drawing crate could call: the
  `text_system()` accessor, its `shape_line`/`shape_text`/`layout_line`, the window's `paint_glyph`, and
  the `StyledText`, `ShapedLine` and `WrappedLine` types. A `.child("string")` on an element is not among
  them: it is also the chrome's idiom and can't be told apart by name.
- **Scale factor 1** for the render, so pixels and px coincide and boxes can be read as integers.

## The Oracle lane

The issue's Oracle line says no engine's or project's own test checks these criteria, with the reasons per
criterion in the private `doneright/oracles` repo (`doneright/oracles/issues/390.md` in
`DeepBuildAI/deepbuild`, branch `doneright`), which this job can't reach (404). That lane is **BLOCKED** here
with one unblock ask: give the runner read access to `DeepBuildAI/deepbuild` at branch `doneright`, path
`doneright/oracles/issues/390.md`. These tests are the local proof for every criterion; they don't stand in
for that lane.
