# Acceptance tests for #375: auto layout on the canvas

Written first, from issue #375 (its scope, the Auto layout fields, its acceptance criterion, its proof line and
its "It can never" line), the design sections it names and the ones they lean on (`docs/technical-design.md`:
Rules every primitive follows, line 855, with "Universal rules are tested as properties", 877; The canvas core,
1041, with Canvas modules, 1049, and the module table's text and marks2d rows, 1053–1054; Dogfooding, 2508;
Tests written first, 2539, and Universal rules as generated properties, 2541; `docs/canvas-primitives.md`:
Conventions every primitive uses, line 7, with Units and axes, 28; Document envelope, 291; Item and kind, 321;
Text `text@1`, 1374; Frame and group, 1864; Auto layout, 2293), the base's `deep-text` binary (#390's surface,
`crates/deep-text/src/main.rs`) and the conventions of #390's, #391's and #394's suites, at base commit
`7222b16` ("Merge pull request #672 … feat/96-shared-documents"), by a job that never saw an implementation;
none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job.

Run them (a root with no config of its own uses Vitest's defaults; the repo's `vitest.config.ts` also takes
`tests/**/*.test.ts` from `scripts/lanes.mjs`, so they join the unit lane; like #389–#394's they build cargo
binaries, so they run with `--no-file-parallelism`, and `scripts/lanes.mjs` needs its exclude and its
one-at-a-time line widened to `tests/acceptance/375/` too):

```sh
npm ci                        # once, if node_modules is missing
npx vitest run --root tests/acceptance/375 --no-file-parallelism
```

`column.test.ts` and `never.test.ts` first run `cargo build --locked --bin deep-layout` and `--bin deep-text`,
and `row.test.ts` and `grid.test.ts` `--bin deep-layout`, in the checkout (cached after the first file); each
fails every test of its file when a build fails. `scope.test.ts` reads `cargo metadata --format-version 1
--locked`. The tests use only node built-ins, vitest and fast-check (a root dev dependency), and type-check
with `npx tsc -p tests/acceptance/375/tsconfig.json` (the root's strict options with
`allowImportingTsExtensions` and `noEmit`). A run with `--root tests/acceptance/375` leaves Vitest's cache in
`tests/acceptance/375/node_modules/.vite`; delete it, it is not part of the suite. `BASE-FAILURE.txt` is the
run at the base: every test fails there because no `deep-layout` binary exists and no package builds one.

Every test runs on the CPU, on any platform: nothing here draws pixels.

## The surface under test

The issue names auto layout, Taffy and the shaper, but no code API, so these tests define the smallest surface
they need: one binary `deep-layout` (found at `target/debug/deep-layout`) with one subcommand, `solve`, plus
`deep-text fit` as #390 left it, to cross-check text leaves. Nothing else is read, except `cargo metadata`.

`deep-layout` belongs to the canvas module that owns frames and their auto layout: marks2d (the module table:
"text, rect, … frame and group kinds", depending on text), whose crate at the base is `crates/deep-canvas-marks`.
`scope.test.ts` holds the crate that builds it to three things the issue and the design state: it is a
canvas module crate (named `deep-canvas…`, which also puts it in `scripts/canvas-lint.mjs`'s scope, as checks
read the boxes it computes), it depends on `taffy` (Auto layout: "Computed by Taffy … the engine GPUI already
uses"), and it depends on `deep-text`, the canvas's one shaper, for text leaves. Which `deep-canvas…` crate is
the implementer's choice. It runs on the CPU and needn't reach GPUI.

### The JSON-lines convention

As #391's and #394's: `<binary> <subcommand>` reads one JSON object per stdin line and writes exactly one
JSON object per input line to stdout, in order, then exits 0. A line it can't read as JSON, or that lacks a
required field, is still answered with one line, `{"ok": false, "code": "bad_input"}`, never a panic. A run
that writes fewer lines than it read, or exits non-zero, fails every test that drove it. Every refusal is
`{"ok": false, "code": string}`; every acceptance has `"ok": true`. Numbers are written so they read back to
the same f64. Lengths are in `u`, one logical pixel at zoom 1 (Units and axes), so the criterion's "0.5 px" and
"0.5 u" are the same tolerance here.

### `deep-layout solve`

Input:

```json
{"doc": Document, "readings"?: {handle: number}}
```

`doc` is required (`bad_input` without it). It is the design's envelope (`format`, `id`, `profile`, `title`,
`description`, `size`, `layers`, `items`, and `bound_values` where a test binds a number), as #391's and #373's
documents are; the fixtures pass the base's `deep-canvas check` with no issue (only `unknown_kind` notices,
since the kernel's own registry holds no marks kinds). `readings` gives the value of
each `reading:` handle a bound value names, as #391's `readings` do; a handle no bound value names is ignored.
The binary may run the document check first; the documents here are meant to pass it, and a refusal fails the
test that sent it.

Items the tests use (2D, u, y down, origin top left):

| Kind | Fields the tests use |
|---|---|
| `frame@1` with auto layout | `params`: `layout` (`row`, `column`, `grid`), `gap` (a number, or `[u, u]` in the generated trees), `padding`, `wrap`, `align_main`, `align_cross`, `grid: {rows, cols, flow, reverse, align_rows, align_cols}`; a track is a number of u, `"1fr"`/`"2fr"`, or `"hug"`. No `box`: a root frame with no `box` hugs its children and sits at its `at.pos` (`[x, y, 0]`, three numbers as the base's check requires); in the generated trees a root may instead carry `box: [0, 0, w, h]`, a fixed size |
| `frame@1` as a fixed child | `parent`, `order`, `params`: `box: [0, 0, w, h]` with `width: "fixed"`, `height: "fixed"` (the child keeps its box's size); in the generated trees also `"fill"` |
| `text@1` as a text leaf | `parent`, `order`, `params`: `text`, `font` (`body`), `size`, `weight`; for a bound number, `widest` and a bound value `{target: "items/<id>/params/text", source: "reading:<ULID>"}` |

A frame's children are the items whose `parent` is its ID, in their `order` keys' order, never the items map's
order (Item and kind: "References are by ID, never by position"); the fixtures list their items out of order
to hold that.

Output:

```json
{"ok": true, "boxes": {item ID: [x, y, w, h]}}
```

One box per frame and per child of a frame that lays out: its border box (a frame's includes its padding) in
document u after the auto layout and before device-pixel snapping (Auto layout: "Positions snap to device
pixels when drawn"), `x, y` its top-left corner, y down. A root frame's box starts at its `at.pos`; a child's
is its parent's position plus its place in the parent's layout. A text leaf's box is the shaped text's layout
box: `w` its widest line's advance and `h` its lines × its line height, which is what `deep-text fit` answers
as `width` and `height` for the same `text`, `font`, `size` and `weight` with no box. A text bound to a live
number is sized by its `widest`, measured as a number (`deep-text fit` with `number: true`, tabular numerals).

## Fixtures

All written by this job before any implementation ran. Every item has a name; no text holds a digit or a
number word, so none reads as an unsourced number.

- `fixtures/column.doc.json`: the column. `card`, a column frame with gap 12 and padding 8 at (40, 32), holding
  three text leaves in order `title` ("Review the plan", 20 u, weight 600), `status` ("Checks are waiting on
  you", 13 u) and `note` ("Updated a moment ago", 13 u). The test grows `status` to "Checks are waiting on
  you\nbefore the plan can go ahead": one more line (the shaper breaks at the line feed, UAX #14), whose new
  line is wider than every other, so the frame's hugged width changes too.
- `fixtures/row.doc.json`: the row. `strip`, a row frame with gap 24, align_cross end and no padding at
  (24, 40), holding six fixed children in order: `kiwi` 40 × 30, `apple` 120 × 56, `fig` 64 × 44, `plum`
  96 × 72, `date` 52 × 24, `lime` 80 × 60. Widths run 40 to 120 u (sum 452, so the row is 572 u wide) and all
  six heights differ, so only an end-aligned row shares a bottom line.
- `fixtures/grid.doc.json`: the grid. `tiles`, a grid frame with gap 24 holding the same six children,
  `grid: {rows: [hug, hug], cols: [hug, hug, hug], flow: column, align_cols: [start, center, end]}`. Flowed by
  column, column 1 holds kiwi and apple (120 u wide), column 2 fig and plum (96), column 3 date and lime (80);
  row 1 is 44 u tall and row 2 72. Column 3's two widths differ by 28 u, so centered its east sides are 14 u
  apart and started 28.

## Criteria to tests

Each test's name starts with what it proves. Where a wrong program would pass a weaker check, a comment at the
assertion that catches it says so, and each assertion's message names what the criterion asks for. This job
also ran the suite against a throwaway stand-in kept outside the repo, and against twins of it that ignore the
gap, ignore the padding, align the row's cross axis at the start, flow the grid by row, center column 3,
measure text by character count, answer zero boxes, pile children on one point, measure a bound number's
current reading, or answer a repeated document differently: the stand-in passed every test, and each twin failed
the tests named below.

| ID | Criterion (the issue's text) | Tests, and the wrong program each fails on |
|---|---|---|
| AC1 | A column frame of three text items with gap 12 and padding 8 hugs them within 0.5 u … | `column.test.ts`: each text leaf's box is `deep-text fit`'s width and height for it within 0.5 u (a leaf measured any other way fails); each starts at the left padding and 12 u below the last (no gap or no padding fails); the frame sits at its `at.pos` and is padding + the widest leaf + padding wide and padding + the three heights + two gaps + padding tall, within 0.5 u (zero boxes fail) |
| AC1 | … and moves the third down by the second's new height when its text grows by one line | `column.test.ts`: the column and the column with `status` grown, solved in one run; the shaper breaks the grown text into one more line; `status` grows by the shaper's height change, `note` moves down by exactly that and sits 12 u below `status`'s new bottom, `title` stays, the frame grows by the same height, and the grown column still hugs as above, its wider second line included, all within 0.5 u |
| AC1 | six children 40 to 120 u wide in a row with gap 24 and align_cross end share one bottom line within 0.5 px, the row the sum of their widths + 5 × 24 u wide within 0.5 px | `row.test.ts`: each child keeps its fixed size (a stretched row, all 72 u tall, fails), they run left to right in order key order 24 u apart, their six bottoms lie within 0.5 px of one line (start or center alignment fails), and the row is 452 + 5 × 24 = 572 u wide within 0.5 px |
| AC1 | the same six in a grid with `cols: [hug, hug, hug]`, `flow: column` and `align_cols: [start, center, end]` put the second child in row 2, column 1, and column 3's east sides on one line within 0.5 px | `grid.test.ts`: the fixture holds the row's six children and sizes; every child keeps its size and lies within its cell when the grid flows by column (child i in row i mod 2 + 1, column ⌊i ÷ 2⌋ + 1), the cells built from the hug tracks and the 24 u gap from the frame's top left, so `apple`, the second child, is in row 2, column 1 (flow by row puts it in row 1, column 2 and fails); `date`'s and `lime`'s east sides are within 0.5 px of each other and of column 3's east edge (center or start fails) |

The issue's "It can never" line, as generated properties (`never.test.ts`, fast-check from the recorded seed
375, 1,000 cases each, the local preflight's count; a failure shrinks to its smallest case):

| Rule | Generator and check, and the wrong program it fails on |
|---|---|
| never let flow children overlap | Trees of a root frame (row, column or grid; hugging or a fixed `box`; any `wrap`, padding 0–24, gap 0–32 or a pair, `align_main`, `align_cross`, and for grids 1–3 rows and 1–4 columns of u, fr or hug tracks, `flow`, `reverse`, `align_rows`, `align_cols`) with 1–10 children: fixed or fill tiles 1–160 u, text leaves of one to three words, and nested row or column frames of one to three fixed tiles. Within every frame, no two flow children's boxes overlap by more than 0.5 u on both axes, and every fixed child keeps its size (so zero boxes don't pass); a layout that piles children on one point fails |
| never depend on its own result | The same trees, each solved twice in one run: once in sample order, then again after every other case in reverse order, so after its own result. Both answers are the same bytes; a layout that warm-starts from, or caches against, a result it gave before and answers differently fails |
| never resize because a bound number changed | A row, column or grid frame of zero to three fixed tiles, a text bound to a reading with `widest` "8,888,888", and zero to three more tiles, solved once per reading (two to four readings from 0 to 9,999). Every box is the same for every reading, and the bound text is as wide and as tall as the shaper measures its `widest` as a number; a layout that measures the reading it shows, or the placeholder, fails |

Shrunk counterexamples print with the seed and path that replay them. None has been found, so no shrunk case
is kept as a fixture yet; one found later is kept beside these (Universal rules are tested as properties). The
release preflight's 100,000 cases are the preflight's to run; this suite runs the local count.

`scope.test.ts` holds the scope line ("by Taffy, with text leaves measured by the shaper") as stated above. The
`bad_input` convention is checked once, in `column.test.ts`.

## Readings where the issue and design leave a choice

- **One binary on marks2d.** The module table gives frames to marks2d, which depends on text; auto layout is a
  frame's (Frame and group: "A frame adds bounds, … auto layout"), so its proof surface sits in a marks2d
  crate and its text leaves reach the shaper through `deep-text`, the crate #390 built as the text module.
- **Boxes, not pixels.** What the criterion names is sizes and positions within 0.5 u, so the tests read
  boxes before device-pixel snapping and draw nothing.
- **"Hugs them"** is read as the frame's size being its padding plus its content: the widest child's width
  across a column, and the children's heights plus the gaps down it, each child at its hug size. With
  `align_cross` at its default `start`, each child starts at the left padding.
- **"Measured by the shaper"** is read as a text leaf's hug size being exactly what `deep-text fit` measures
  for the same text, font, size and weight (width the widest line's advance, height lines × the line height,
  the `text@1` default `1.3 × size` rounded to whole px), within the criterion's 0.5 u.
- **"Grows by one line"** is a line feed added to the text with more words after it; the test checks the
  shaper counts one more line before using it. "Moves the third down by the second's new height" is read as
  the third's y moving by the second's height change, which equals the third sitting a gap below the second's
  new bottom; both are checked.
- **Fixed children.** `width, height: fixed` is read as the child keeping its own `box`'s width and height;
  "hug" for a frame with no `box` as hugging its children; a root frame with no `box` hugs, at its `at.pos`.
- **Grid rows.** The criterion's grid names its columns; a grid flowed by column needs its rows, so the fixture
  gives two hug rows, and "row 2, column 1" is the second row track and the first column track, from the top
  left (`reverse: none`). A child is in a cell when its box lies within the cell's tracks within 0.5 u; where it
  sits inside a row (`align_rows`) is not read, since the criterion names only the columns' alignment.
- **"East sides on one line"** is read as the right edges of column 3's children within 0.5 px of each other;
  with `align_cols` end they are also checked at column 3's east edge.
- **The "never" rules.** The design checks every never-rule of a primitive's It can never line with a generated
  test, so all three are here. "Let flow children overlap" is read per frame, among its own flow children,
  overlapping by more than 0.5 u on both axes; tracks given in u in the generated grids are wider than any
  child, so no child is larger than its cell (where the design's "overflow is masked and counted" would apply
  instead). "Depend on its own result" is read through what the binary shows: the boxes are a function of the
  document alone, so a document solved again after its own result gives the same bytes. "Resize because a bound
  number changed" is read through `widest` (Auto layout: "A child sized by a live value uses its `widest`"):
  the bound text keeps the size of its widest, so nothing moves when the reading changes. A `[u, u]` gap's
  axis order is not read: no check depends on it.
- **Fr tracks** are written `"1fr"` and `"2fr"`, as a literal with its unit (Units and axes: "Literals may carry
  a unit"); only the never-overlap generator uses them.

Not tested, because no criterion asks: `wrap` and `align_main` beyond the overlap property, `min` and `max`,
`position: absolute`, `resize`, `align_cross: stretch` and `baseline` and `align_rows` beyond the overlap
property, `reverse` beyond it, channel targets and keyed layout changes, dirty-subtree reruns, the 500-node
budget, device-pixel snapping, overflow masking and counting, and R1's gpui-kit cards.
