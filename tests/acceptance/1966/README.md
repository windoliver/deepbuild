# Acceptance tests for #1966: code lines, highlights, line anchors, and lists that share them

Written first, from issue #1966 (its scope, its fields, its two acceptance criteria and its proof line), the design
sections it links and those they lean on, and base commit `c56fe540` ("Merge pull request #2462 …"), by a job that never
saw an implementation; no other worktree, branch, pull request or `tests/acceptance/1966*` folder was read. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). The Oracle lane for criterion 2 (the pinned upstream list test, run on our code) is the sibling folder
`tests/acceptance/1966-oracle/`.

What was read: `docs/canvas-primitives.md` (Text `text@1` with its `list` field, Text `text@1`: code with its read-only
anchors `#line:n` and `#tok:k`, Path `path@1` with `attach`, Item and kind with `at` and `adjust`, Look `look@1`),
`docs/technical-design.md` (Films and figures on the canvas, 2D marks and paint, Dogfooding); at the base, only for how
surfaces are driven and what answers look like: `tests/acceptance/1965/` and `1965-oracle/` (READMEs, helpers),
`467/helpers.ts`, `160/` (helpers, `ends.test.ts` and `bend.test.ts`: `path`'s `subpaths` and an end attached with
`gap: 0` to an item a channel moves), `crates/deep-marks-render/src/{lib,raster,place}.rs` and
`crates/deep-canvas-marks/src/{code,scene}.rs`.

## Run

```sh
npm ci                      # once, if node_modules is missing
PATH=$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH \
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease npx vitest run --root tests/acceptance/1966 --no-file-parallelism --testTimeout=600000
npx tsc --noEmit -p tests/acceptance/1966      # type-check (exits 0)
```

Each file builds `deep-canvas-render` once (`cargo build --locked --bin deep-canvas-render`, honoring
`CARGO_TARGET_DIR`; #467's `useBin`), and a test whose build failed fails with cargo's error. They draw with Vello CPU,
so they run on every platform with no GPU. A run with `--root` leaves Vitest's cache in
`tests/acceptance/1966/node_modules/.vite`; delete it. Node built-ins and vitest only; temporary folders are deleted. The
folder imports `../467/helpers.ts`, `../1965/helpers.ts` and `../160/helpers.ts` by path.

`BASE-FAILURE.txt` is the run at the base: all 3 tests fail, each at its own assertion for missing behavior (below).

## The surfaces under test

All through `deep-canvas-render`, one JSON line in, one out, with #1965's look `LOOK_A` (#467's look with a role for
each token class) passed as the line's `look`:

- **`raster {out, doc, look, t: 0}`** → `texts[<item>] = {shown, glyphs: [{x, y, grapheme, advance, …}]}` and the PNG at
  `out`: `grapheme` indexes the shown text (a line end counts one), `x`/`y` are the pen position and baseline from the
  item's origin. Ink is read from the PNG.
- **`geometry {doc, look, item: "cfg#line:4", t}`** → `box: [x, y, w, h]` in u at time `t`: the read-only anchor
  `#line:n` ("a line's box"), as #1965 answers it.
- **`path {doc, look, item, times}`** → `frames[i].subpaths[].points`: the path after its attachment at each time (#160's
  answer); its end is the last point of its last sub-path.

The document fields the tests write, as the issue lists them:

- A code item `cfg`: `text@1` with `font: mono`, `size: 24`, `paint.fill.role: ink`, `raw` (a string) and
  `code: {language: python, tokens, numbers: false, highlight: [{lines: [3, 5]}]}` (the treatment left at its default,
  `dim_others`), placed by `at.pos`. Its raw is seven lines, no digits and no tabs:

  ```
  def area(radius):
      if radius < lower:
          raise ValueError(radius)
      square = radius * radius
      total = pi * square
      print(total)
      return total
  ```

- The film: the code at `at.pos [40, 150]`, a channel `code-scroll` keying `items/cfg/at/pos/1` linearly from 150 at
  0 s to 50 at 2 s (`transport.span: 2s`), and a `path@1` `pointer` with `d: "M 860 200 L 640 200"`,
  `attach: {end: "cfg#line:4", gap: 0}` and a stroke.
- A list item `steps`: `text@1` with `text: "Alpha\nBravo charlie delta echo foxtrot golf hotel india juliet\nKilo"`,
  `font: body`, `size: 24`, `box: {w: 360, h: 280}`, `autosize: height`, `overflow: mask`, `paint.fill.role: ink` and
  `list: {marker: bullet}` (`indent` and `gap` left at their defaults), at `at.pos [40, 30]`.

## Criteria to tests

| ID | Criterion (the issue's text) | Tests and assertions |
|---|---|---|
| AC1 `#1966.3e2ae44d` | A highlight on lines 3 to 5 dims every other line to 40% opacity, and a path attached to `#line:4` ends at that line's box edge within 0.5 u while the code scrolls | `highlight.test.ts` (2). **(dims)** `raster` of the code with the highlight, with none, and with none at `adjust.opacity` 0.4: each line's ink (how much darker than the paper its band is, summed: the band is the line's glyphs' x span ±2 px, from 0.75 of the line pitch above its baseline to 0.25 below) as a share of the same line with no highlight is, on lines 1, 2, 6 and 7, the share the item at opacity 0.4 keeps (± 0.03), and on lines 3 to 5 the whole (1 ± 0.03). **(anchor)** At 0, 0.37, 0.5, 1, 1.13, 1.5, 1.71 and 2 s of the film: the box `geometry` gives for `cfg#line:4` is line 4's where the scroll has put it (it holds line 4's baseline, neither line 3's nor line 5's, and spans line 4's glyphs: baselines and x from `raster` at 0 s, moved by the channel's linear value), and the path's end lies within 0.5 u of that box's edge, where the line from the box's centre toward the path's start meets it |
| AC2 `#1966.bbe0ca22` | A 3-item bullet list wraps its second item's long line under its text, not under the marker | `list.test.ts` (1). `raster` of the list: the second item takes two lines or more; each of its wrapped lines' first glyph (spaces aside) starts within 0.5 u of the x of its first line's first glyph; and left of that x the PNG has exactly one marker (an 8-connected blob of ink, a pixel more than 64 codes from the paper in a channel, 3 px or more) beside each item's first line (its centre from 0.75 of the line pitch above the line's baseline to 0.25 below), and none beside a wrapped line. The Oracle lane runs the pinned upstream list test's assertion through the same judge (`tests/acceptance/1966-oracle/`) |

## Wrong programs

Each test first runs its judge on planted wrong programs and requires it to fail, naming the assertion that catches
them; they are built from the binary's own answers at the base, so they hold before and after the work.

- **(dims)** a renderer that ignores the highlight (the code with none: line 1 keeps all its ink); one that dims every
  line, lines 3 to 5 too (the item at opacity 0.4); one that dims the other lines to 50% (the item at opacity 0.5); one
  that keeps lines 2 to 4 (a picture spliced band by band from the two). Also failed, unplanted: dimming by a color
  that isn't the item's 40% opacity, a range read 0-based, a band or box drawn in place of the default dimming.
- **(anchor)** an end left where it was at 0 s, not re-solved as the code scrolls; an end on the whole code item's box
  (the anchor dropped); `#line:4` read as the fifth line (0-based); a line box that stays where the code was at 0 s.
  Each from `geometry`'s boxes at the eight times. Also failed, unplanted: the default 4 px gap kept, an end at the box's
  centre, an attachment refused or unresolved (`path` must place it).
- **(list)** the lines with no list (no marker: the base's program); a bullet typed into each line (the wrap goes
  under the marker); the list's own picture with its marker painted again beside the wrapped line (a marker on every
  visual line). Also failed, unplanted: a wrapped line set at the item's left edge or at the marker's x, a hanging
  indent that isn't the text's x, a list that doesn't wrap (no second line), a marker for the wrapped line, an item
  with no marker.

## What the base already does and these tests don't credit

At the base, `geometry` answers a code item's `#line:n` with the line's box where the scroll has put it (#1965), `raster`
draws the code with its tokens, and a `text@1` with `box.w` is wrapped by the shaper; `adjust.opacity` draws an item at
that alpha (at 0.4 each line keeps 0.40 of its ink). The tests lean on these only to read and to build the plants; none
of them is credited, and every plant was rejected at the base.

## What is missing at the base (why each test fails)

`BASE-FAILURE.txt` is the run.

- AC1 (dims): `code.highlight` is ignored, so lines 1, 2, 6 and 7 keep all their ink (1.00, not 0.40).
- AC1 (anchor): `path` refuses the path attached to `cfg#line:4` with `ref_unresolved` (`items/pointer/params/attach:
  cfg`): an attachment finds no box for a text item or its lines.
- AC2: `list` is ignored: the three lines draw as plain lines with no marker (the wrapped line lines up with the text
  only because nothing is indented).

## Readings where the issue and design leave a choice

- **"Dims … to 40% opacity"** is read against the renderer's own 40% opacity, the item drawn at `adjust.opacity: 0.4`
  (Item and kind: adjust), so the compositing space is the renderer's and the test needs no model of it: a dimmed line
  keeps, within 0.03, the share of its ink that opacity 0.4 keeps. A share is read over a line's band, summed, not
  pixel by pixel, since glyphs drawn one by one at 0.4 and a whole layer at 0.4 may differ by a code where antialiased
  edges overlap. The highlight's `treatment` is left out, so the default (`dim_others`) is what is tested.
- **`numbers: false`** in every code item: no criterion places line numbers or says whether a dimmed line's number
  dims, so the gutter is kept out of every read; the line's box and glyphs are the code's alone.
- **"While the code scrolls"**: no field of `text@1` scrolls its own text, and `control@1`'s `scroll` is viewer input
  for a list longer than its frame, not a film's motion. A film's scroll is motion: the item's `at.pos` y keyed by a
  channel (Channel and key), as #160's suite moves an attached item, and the design's "An attachment re-solves its ends
  when the attached item moves" applies. It moves 100 u up over 2 s, about three lines, sampled at eight times, three
  off the key grid.
- **"Ends at that line's box edge within 0.5 u"**: the attachment names the line (`cfg#line:4`, "an end may name … a
  text's line") with `gap: 0`, since the default 4 px gap would hold the end off the edge. The edge is the outline of the
  box `geometry` gives for `cfg#line:4` at that time, and the end is where "the line toward the other end meets that
  target's bounds": from the box's centre toward the path's start (#160's AC7 reading). That box is checked to be line
  4's, from `raster`'s glyphs, so a wrong anchor can't pass by agreeing with itself.
- **Which answer reports the end**: `path`'s `subpaths`, the path after its attachment (#160's surface); its end is the
  last point of the last sub-path. (`#at:1`, the design's read-only anchor for a path's end, is not read.)
- **Which film each read uses**: the path's ends and the boxes they are judged against come from the one film with the
  path (`path` and `geometry` of the same document). Where line 4 is (`raster`'s glyphs at 0 s) and the plants' boxes come
  from the same film without the path, so they can be read and built where the path can't be placed (at the base); the
  code doesn't depend on a path attached to it.
- **Line numbers**: `#line:n` counts from `first_line`, 1 by default, as #1965's anchor does; lines 3 to 5 are the
  third to fifth lines of raw.
- **A list item** is each line of `text` after `\n` (the field's own words). Its box keeps its width (`box.w` with
  `autosize: height`, since the default `width` would grow the box and never wrap). Which glyph rows belong to an item
  is read from `shown` (the item's own words, in order), so a renderer may or may not put the marker in `shown`.
- **`overflow: mask`** on the list, with a box tall enough for every line: the text is drawn whole, so the fit check's
  ellipsis, which no criterion here tests, takes no part. At the base the fit check counts a wrap's trailing space
  against `box.w`, so with the default `ellipsis` a wrapped line that ends a space short of the width is cut with "…"
  (seen in this job's first run); that is a text@1 fit finding, listed for the implementer, not a list behavior.
- **"Under its text, not under the marker"** is read as the upstream list test words it: the lines of an item line up
  with each other at its text's x (within 0.5 u), and a single marker sits to their left, beside the first line. The
  marker is read from pixels, not from `glyphs`, since the design doesn't say whether a marker is a glyph of the run.

## Not tested, because no criterion says so

Line numbers on by default and `first_line`, the gutter's added, removed and changed marks in the diff roles, the
`band` and `box` treatments, `#tok:k`, `tab`, labels, shots and a puppet's reach reading an anchor, numbered lists,
`list.indent` and `list.gap` values, a list's own `#line:n` anchors, and every performance bound.
