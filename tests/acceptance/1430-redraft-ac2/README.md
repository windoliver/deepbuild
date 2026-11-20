# Blind redraft of #1430's AC2: the split cache's output byte-equal to an empty cache's, after #1484 set the body role in its variable face

A blind redraft of AC2, written because #1484 moved the role faces. Written from issue #1430 (its second acceptance
criterion and its scope), the design, and base commit `a4d0290b5` ("Merge pull request #2846 …"), which holds #1484 ("Text
at the size it's set: Inter on its variable face at its optical size and weight") and none of #1430's work, by the job that
drafted `tests/acceptance/1430/` (the first draft, branch `blind-1430`, commit `111feac77`), which has never seen an
implementation of #1430: no other worktree, branch, pull request or stash was read. The request for this redraft said
that the first draft's AC2 can't pass on this base: run on a build over it, every case in the body role fails the first
draft's face check, as in `"r. it's A-Z fjord W.AVE ; Tw Tw" in body at 9 px, 72 px wide: a glyph is
["crates/deep-text/fonts/InterVariable.ttf",9,852,0,9.27392578125], not one of a Inter face at 9 px`. That message names
only what this base sets body text in, which this job read at the base itself (below). The implementing agent doesn't edit
these files (AGENTS.md, Proof); the first draft's other criteria stand as written.

## What changed from the first draft

Only the face each glyph of an empty cache's output is held to:

- **First draft**: a face of the role's family as `deep-text fonts` names it (`fonts[].family`: `Inter` for body).
- **This redraft**: a face of the family the role's text is set in at this base. `crates/deep-text/src/fonts.rs`'s
  `shaped_in` (#1484) says a family is shaped in "its variable twin when the bundled faces hold one … else `family`
  itself", and the shaper sets each family in `shaped_in(family)`. The test reads that rule from `deep-text fonts`: the
  role's family as `fonts` names it, or, when `faces` holds the family named `<family> Variable`, that twin. At this base
  body is set in `Inter Variable` (`crates/deep-text/fonts/InterVariable.ttf`), mono in `JetBrains Mono` and math in `STIX
  Two Math`, the two with no variable twin. A role whose family the faces don't hold fails, naming it.

Everything else is the first draft's, unchanged, so one implementation serves both drafts: the surface (`deep-text
shape`, its `run` field and the plant's name), the seed and its 160 cases, the comparison, the shrinking and the
failure's sentences. The first draft's helpers aren't at this base, so what this test needs of them is restated in this
folder's `helpers.ts` rather than imported.

## What was read

- The issue (`gh issue view 1430`): AC2 `#1430.c8134c7e`, its ID computed from the live text as
  `scripts/budget-window.mjs`'s `criterionId` computes it, and the scope ("Two keys: a shape key (text, font, size,
  features) and a layout key …").
- `docs/canvas-primitives.md` Text `text@1` (its Semantics: the shape key and the layout key, "A variable font's axis
  values join the shape key and the atlas key and reach the rasterizer: optical size follows the size in u, and a weight
  draws exactly as asked"); `docs/technical-design.md` Decided ("Which text shaper"), Dogfooding (a disputed test's
  redraft) and Wrong programs.
- At `a4d0290b5`: `crates/deep-text/src/fonts.rs` (`FACES`, `Role::family`, `shaped_in`), `src/shape.rs` (the family list
  set through `shaped_in`, the `wght` and `opsz` axes), `src/cache.rs` (the font hash through `shaped_in`), `src/main.rs`
  (`shape` and `fonts`, unchanged since the first draft's base), the changes to `crates/deep-text` since `7312c66d2`,
  `tests/acceptance/1484/README.md` (how #1484's suite reads a face), and the bundled faces' character maps (every
  character the cases use is mapped by `InterVariable.ttf`, `JetBrainsMono-Regular.ttf` and `STIXTwoMath-Regular.ttf`).
  `tests/acceptance/856/` and `224/` are reused by import, as in the first draft.

## Run it

It builds the release `deep-text` (#856's `useRelease`), so it runs alone: `scripts/lanes.mjs` needs
`'tests/acceptance/1430-redraft-ac2/'` in its `alone` list (the implementer makes the edit). It judges no time, so it
isn't a timed file.

```sh
npm ci                          # once, if node_modules is missing
PATH=$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH \
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease npx vitest run --root tests/acceptance/1430-redraft-ac2 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1430-redraft-ac2/tsconfig.json   # type-check (exits 0)
```

The file first runs `cargo build --release --locked --bin deep-text` (cached after the first) and fails both tests when
it fails. A run with `--root` leaves Vitest's cache in `tests/acceptance/1430-redraft-ac2/node_modules/.vite`; delete it.
Node built-ins and vitest only; the folder imports `../856/helpers.ts` (the binary, its JSON lines, #856's reader of
`shape`) and `../224/helpers.ts` (`seeded`) by path. `BASE-FAILURE.txt` says how each test is expected to fail at the
base.

## The surface under test

The first draft's choices, unchanged; this test reads only those below. **Names marked *(chosen)* are the first draft's
choices** where the issue and the design leave it open.

- **`deep-text shape [--planted <name>]`** (#856): one process, one shaper, one JSON line out per line in, in order. A
  line takes `fit`'s fields (`text`, `font`: `body`, `mono` or `math`, `size`, `box: {w, h}`, `overflow`, …) and answers
  `{"ok": true, "glyphs", "width", "shown", "shaped", "cache", …}`.
- **`run: true`** *(chosen)* in a request asks for the laid-out text's whole output, which the reply then carries:

  ```json
  "run": {"lines": n, "width": px, "height": px, "shown": string,
          "glyphs": [[face, size, id, x, y], …]}
  ```

  `glyphs` lists every glyph drawn, in the run's order: `face`, the bundled face it is set in, as `deep-text fonts` names
  that face's `file` in its `faces` list (`crates/deep-text/fonts/InterVariable.ttf` for body text at this base);
  `size`, its font size in px; `id`, its glyph ID in that face; `x` and `y`, its position in px from the run's origin,
  `y` on its baseline. `lines`, `width` (the widest line's advance), `height` and `shown` are the run's.
- **`--planted key_without_font`** *(chosen)*: the split caches with a shape key that leaves the font out, so a text laid
  out in one font is reused for another. Reached only by its startup argument, as #856's plants are.
- **`deep-text fonts`** (#390, #417), as the base answers it: `fonts`, each role with its `family`, and `faces`, each
  bundled face's `file` and `family`.

The first draft's other choices (`caches`, `shaped` read per paragraph, `--planted keyed_on_width` and `whole_text`, the
budget task) are unchanged and not read here.

### How a text's output is compared byte for byte

Each case is laid out with `run: true` twice: in turn, in one process after every case before it (the split cache,
warm), and alone, in a fresh process that has laid nothing out (an empty cache). The two `run` fields must be the same
JSON: the test parses each line and compares the two `run` values' JSON text, which for one serializer is byte equality.
So that equal outputs can't be empty ones, each empty-cache output must show the case's text whole, list as many glyphs
as the reply's `glyphs` counts (some, for a text with any) and set every glyph, at the case's size, in a face of the
family its role is set in (above).

## Criteria to tests

| Criterion | File (tests) | What it asserts |
|---|---|---|
| AC2 `#1430.c8134c7e` | `ac2-property.test.ts` (2) | The 160 cases from seed 1430 lay one text out in two fonts at one size and width, one text at two widths in one font and size, and a typed text after its original in one font and size (`meetingFailures`); every empty-cache output is the case's own, each glyph in a face of the family its role is set in at this base (`outputFailures`, `faces`); each case's `run` laid out in turn equals its `run` laid out alone, byte for byte; a difference is shrunk and named with the seed (`propertyFailures`). **(planted)** `--planted key_without_font` fails it, naming the seed, the case, its first difference and the shrunk cases |

Both test names start `AC2 #1430.c8134c7e`.

## Planted program

`--planted key_without_font`, in the binary (above): the criterion's wrong program. Its empty-cache outputs pass the face
check, since a fresh process has nothing to reuse, and its first layout of a text in a second font, after the same text
at the same size and width in another, comes out in the first font's faces.

## Fixtures

The first draft's, unchanged. Seed 1430, mulberry32 (#224's `seeded`), 160 cases over eleven texts: six random texts of
one to five paragraphs (one paragraph in ten empty) of 1 to 18 words from a 36-word ASCII list chosen for kerning pairs,
ligature candidates, figures and punctuation (`AVATAR`, `office`, `->`, `1,234.50`, …); the first four again, each with
one character typed into one paragraph; and one text of the last two's paragraphs. Each case is one of the eleven texts,
a font role (`body`, `mono` or `math`), a size (9, 11, 13, 16.5 or 24 px, or one case in five any of 8 to 30 px to the
hundredth) and a width (72, 150, 233.5, 320, 480 or 777 px, or one case in four any whole width from 40 to 799 px), with
`overflow: "mask"`. The texts are 30 to 312 characters. At this seed the cases hold 6 pairs laying one text out in two
fonts at one size and width, 62 at two widths in one font and size, and 17 typed texts after their original in one font
and size.

## Legs that read BLOCKED or INCONCLUSIVE

None: this criterion judges no time and reads no machine. Both tests fail, never pass, when `cargo build --release
--locked --bin deep-text` fails.

## Readings where the issue and design leave a choice

1. **The face a role is set in** is the base's: `shaped_in`'s rule, read from `deep-text fonts` (above). It isn't
   `fonts[].family` alone, which still names the static face a look names its role by, nor a copy of `shaped_in`'s table
   in the test, which a further twin would break again.
2. **"Output"** is the laid-out run as drawing reads it: each glyph's face, size, ID and position, and the run's lines,
   width, height and shown text. **"An empty cache"** is a fresh process that has laid out nothing but that case; "the
   split cache" is the process that has laid out every case before it.
3. **Cases recur by design** (eleven texts, short lists of sizes and widths), so both caches are hit: a property over
   texts that never repeat would never read a cache. The seed is recorded, and a failure is shrunk to the fewest cases
   before it that still make it differ.
4. **"Random fonts"** are the three font roles `shape` takes; weight, numerals, line limit and alignment stay at their
   defaults, since the criterion names text, fonts, sizes and widths.

## Not tested, and why

- A glyph's variation coordinates: `run` lists face, size, ID and position, as the first draft chose, so one
  implementation serves both drafts. A variable face's coordinates follow its size and weight (#1484), both in the shape
  key, and its advances, which the positions carry, move with them.
- AC1, AC3 and AC4: the first draft's tests stand.
