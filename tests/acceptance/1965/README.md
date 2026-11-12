# Acceptance tests for #1965: code token roles, raw bytes and the code cap

Written first, from issue #1965 (its scope, its fields, its three acceptance criteria and its proof line), the design
sections it links and those they lean on, and base commit `3962d528`, by a job that never saw an implementation; no
other worktree, branch, pull request or `tests/acceptance/1965*` folder was read. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). The Oracle lane
(the two Unicode files) is the sibling folder `tests/acceptance/1965-oracle/`.

What was read: `docs/canvas-primitives.md` (Text `text@1`, Text `text@1`: code, Look `look@1`, The status-color rule,
Honest numbers, Document envelope), `docs/technical-design.md` (Films and figures on the canvas, 2D marks and paint,
Dogfooding); at the base only for how surfaces are driven: `tests/acceptance/467/helpers.ts` (the binary, the JSON-lines
driver, PNG reading, `fixtures/look.json`), `1964/` and `406/` (their READMEs, helpers and `quote.test.ts`),
`crates/deep-canvas-marks/src/{code,check}.rs` and `crates/deep-marks-render/src/{lib,raster}.rs` (answers' shapes).

## Run

```sh
npm ci                      # once, if node_modules is missing
PATH=$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH \
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease npx vitest run --root tests/acceptance/1965 --no-file-parallelism
npx tsc --noEmit -p tests/acceptance/1965      # type-check (exits 0)
```

Each file builds `deep-canvas-render` once (`cargo build --locked --bin deep-canvas-render`, honoring `CARGO_TARGET_DIR`)
and a test whose build failed fails with cargo's error. Run **alone**: the files run one at a time, and `cap.test.ts`
checks a 240,000-byte item four times and a 262,145-byte one twice, each a minutes-long shaping in a debug build
(about 140 s each at the base, 22 minutes for the file); `scripts/lanes.mjs` should list `'tests/acceptance/1965/'` in
`alone` (this job writes only this folder; the implementer makes that edit). A run with `--root` leaves Vitest's cache in
`tests/acceptance/1965/node_modules/.vite`; delete it. Node built-ins and vitest only; temporary folders are deleted.

`BASE-FAILURE.txt` is the run at the base: all 11 tests fail, each at its own assertion for missing behavior (below).

## The surfaces under test

All through `deep-canvas-render`, one JSON line in, one out, every platform, the look passed as a look@1 object (#467's
look with the two role maps below) or a shipped look's ID:

- **`check {doc, look, store?}`** → `{ok, issues: [{code, severity, ids, path, actual, what, fix}]}`: the quote's
  `quote_mismatch`, the refusals of a token class and of the caps. `store` is a folder of files named by the sha256 of
  their bytes, where the quote's source is put (as #406's suite does, with the source in the document's `assets`).
- **`raster {out, doc, look, t: 0, store?}`** → `texts[<item>] = {shown, glyphs: [{x, y, grapheme, advance, role, size}]}`
  and the PNG at `out` (#381's and #1964's answers): `shown` is the display text, `grapheme` an index into it (a line
  end counts one), `role` the paint role a glyph's run was drawn in, `x`/`y` the pen position and baseline from the
  item's origin. Colors are read from the PNG: ink within 6 codes of the look's role color, in the glyph's cell.
- **`geometry {doc, look, item, t: 0}`** → `box: [x, y, w, h]` in u, asked for the anchors `<item>#line:n` and
  `<item>#tok:k` that the design names ("Read-only anchors") and that connectors, labels and shots read.
- **`look {look: <id>}` and `look {list: "shipped"}`** → the look's definition (`look.code`, `look.diff`, `look.status`,
  `look.min_distance`) and its `roles` as `#rrggbb` by theme.

A code item is `text@1` with `font: mono`, `paint.fill.role: ink`, `code: {language, tokens?}` and `raw` (a string) in
`params`, as #406's suite writes it, and no `text`. A look adds `code: {class → role}` for all ten classes and
`diff: {added, removed, changed → role}`; `LOOK_A` and `LOOK_B` give every class another role of #467's look.

## Criteria to tests

| ID | Criterion (the issue's text) | Tests and assertions |
|---|---|---|
| AC1 `#1965.1f0016ec` | Switching a code item's look recolors its keywords to the new look's keyword role with no change to the document's hash, and a token class outside the list is refused naming it | `recolor.test.ts` (3). **(recolor)** `def go(a):` / `    return a` with four tokens drawn under `LOOK_A` and `LOOK_B`: the document is the same bytes (sha256 of its JSON before and after), the display text is the same, each keyword glyph has pixels in its look's keyword role and none in the other's, likewise a function and a variable token, and the untokened `a` is in plain ink in both. **(shipped)** every shipped look's `code` has all ten classes and `diff` its three marks, each a color role in both themes at least `min_distance` (OKLab, default 0.10) from every status color; and the same document under each shipped look has its keywords in that look's keyword color and none of another's. **(refusal)** the ten classes are accepted; `identifier`, `Keyword` and `status.fail` as a class are each refused: `ok` false and an error naming the item whose own words (all but `fix`) hold the class |
| AC2 `#1965.1d486d42` | A quote of lines 3 to 5 of a file with CRLF line ends, a tab indent and a decomposed é (e, then U+0301) passes, its raw bytes equal to the file's; it draws the é as one NFC grapheme, the tab as 4 columns and no line-end mark, and each token's byte range lands on its glyphs; twins with one byte changed, with the é precomposed as U+00E9 and with one CRLF made LF each fail quote_mismatch naming the line and the byte, the last two though they draw the same display text as the quote that passes | `quote.test.ts` (4). The file is six CRLF lines (`# settings`, empty, `def pick(items):`, `\tname = "cafe`U+0301`"`, `\treturn name`, `# end`); the quote is lines 3 to 5 (CRLF after each). **(passes and draws)** `check`: no error; `raster`: `shown` is `def pick(items):` ⏎ `····name = "café"` ⏎ `····return name` exactly (U+00E9, no U+0301, CR or tab), one glyph for the é, no glyph at a line end, the `p` of `pick` four advances in and the first glyph after each tab at the same x, and seven tokens (keyword, function, variable, operator, string with the é, keyword, variable) each in its role on every letter of its byte range, while every letter in no token is plain ink in none of those roles. **(twins)** one byte changed (the last `e` of line 5's `name` made `a`: line 5, byte 11), the é precomposed (line 4, byte 12), one CRLF made LF (the end of line 4: line 4, byte 16): `ok` false, a `quote_mismatch` naming the item and the line and byte, no other error; for the last two, the raw drawn on its own (a failed quote is never drawn) shows the same display text and the same PNG as the passing quote's raw, tokens colored in both |
| AC3 `#1965.47bbd705` | A 2,000-line file of 120 bytes a line (240,000 bytes, 238,000 characters of display text) loads as one code item with its tokens and shows any of its lines, never refused for text@1's 4,096 characters; the same file grown to 262,145 bytes is refused, naming the item, its 262,145 bytes and the 256 KiB cap; and a text item whose own text runs to 4,097 characters is still refused, naming text@1's cap | `cap.test.ts` (4). **(loads)** the file (`def abcd` and letters, 119 characters and LF per line, no digit, a keyword token on each line's `def`) as one code item: `check` has no error; `geometry` gives `cfg#line:1000` and `cfg#line:2000` boxes at x 20, y 20 + 16 × (n − 1), 16 u high and at least 119 advances wide, `cfg#tok:1999` the last line's `def` (3 advances wide), and no box for `cfg#line:2001`. **(over)** grown to 262,145 bytes: `ok` false, an error naming the item with `262145` and the cap (`262144` or `256 KiB`) in its own words and a `fix` that speaks of quoting lines; at exactly 262,144 bytes no error. **(bytes)** 131,072 `é` (262,144 bytes, half as many characters) load; 131,073 are refused naming 262,146 bytes and the cap. **(text)** a `text@1` of 4,097 characters: `ok` false, an error naming the item with `4096`; at 4,096 characters the item has no error |

Wrong programs the assertions fail: AC1 — a renderer that ignores `tokens` (all plain); one that draws every class in the
keyword role or one look's roles after a switch; one that keeps a stale look's colors; one that writes the look's colors
into the document; a shipped look with no `code` or `diff`, with a missing class, with a role that isn't a color, or
with a code color on a status color; a check that passes any class string, one that names no class or no item, or one
that takes `Keyword` or a status role as a class. AC2 — a raw compare against display text (the precomposed and LF twins
pass), against NFC-normalized bytes, or against the lines quoted by display position; a mismatch that names no line or no
byte, the file's byte offset instead of the line's, or line 1; tokens read as UTF-16 or character offsets, as display
columns (the tab, the 2-byte mark and the CRLFs shift them), or ignored; a tab drawn as 1, 8 or 2 columns, or as a glyph;
a CR or a mark glyph at a line end; the é drawn as two glyphs or left decomposed; a twin that draws differently from the
quote. AC3 — a cap of 4,096 characters on a code item's display text (the 240,000-byte file is refused), a cap at 240,000
bytes or in characters (the 262,144-byte and 131,073-é items), an off-by-one cap (262,144 refused, 262,145 passed), a
refusal that names no item, the wrong size or no cap; a text cap that isn't enforced, is 4,097 or applies to code only.

## Which parts #406 already proves, and what these tests add

`tests/acceptance/406/quote.test.ts` proves, for a one-line quote with a tab, a CRLF and a decomposed é: the quote passes
with its digit listed as quotation at its raw byte range and no number counted, and a twin that drops the CR fails
`quote_mismatch` naming the item and never honest numbers. These tests don't repeat that. They add what it doesn't: a quote
of several lines of a larger file (`lines: [3, 5]`), the line and the byte a failure names, the precomposed twin, the
twin of one changed byte, drawing and the tokens' landing, and everything in AC1 and AC3. A quote's digits as quotation
are #406's and stay credited to it; nothing here has digits.

## What the base already does and these tests don't credit

At the base `raster` already draws a code item's display text (`shown`: tab 4 columns, NFC, CRLF dropped), one glyph for
the é, no glyph at a line end, and `check` already raises `quote_mismatch` with `actual: {line, byte}` for the three twins
at exactly the numbers above (and for none of them a second error), though the test for it can't see that: the twin tests
fail at the next assertion, where the quote that draws its keywords in a role is needed, and the first test fails at its
token assertions. Those parts are listed so the implementer doesn't re-do them; no test passes on the base.

## What is missing at the base (why each test fails)

- AC1: `tokens` are ignored, so every glyph is plain ink in every look (recolor, quote, twins); a look's `code` and `diff`
  are ignored and no shipped look has them; a token class outside the list passes `check`.
- AC2: tokens have no effect on glyph roles or pixels (`role` stays `ink`), so no token lands anywhere.
- AC3: `geometry` has no anchor `#line:n` or `#tok:k` (no box); `check` has no cap on a code item's raw (262,145 bytes and
  131,073 é pass) and none on `text@1`'s 4,096 characters (4,097 passes).

## Readings where the issue and design leave a choice

- **"Refused", "fails … naming"**: `check` answers `ok: false` with an error issue; the code is the implementer's except
  `quote_mismatch`. An error *names an item* when its `ids` hold the item's ID or its `path` is under `items/<id>/`; it
  *names a class, a size or a cap* when that text is in the error's own words, every field but `fix`, as JSON text, with
  commas in numbers removed (`262,145` and `262145` both count), `4096` for text@1's cap, and `262144` or `256 KiB` for the
  code cap. Where a token class is named is not fixed (path `items/cfg/params/code/tokens/1/class`, `actual`, `what`).
- **"Naming the line and the byte"**: `actual: {line, byte}` (the base's shape), or `line L` and `byte B` in the words. The
  line is the source's line number (3 to 5 for this quote, counting from the file's first line); the byte is the offset
  within that line, line end included, of the first differing byte (the base's `mismatch`). The changed-`e` twin differs
  at byte 11 of line 5, the precomposed twin at byte 12 of line 4 (`\tname = "caf` is 12 bytes), the LF twin at byte 16
  of line 4 (its CR, after 16 bytes of content).
- **A twin is "drawn"** by `raster` of the same raw with no `quote`: a quote that fails `check` is refused before anything
  is drawn (`raster` answers `{ok: false, code: quote_mismatch}`), so the twin's picture is its raw's.
- **Tokens' glyphs**: a token's byte range lands on its glyphs when each display grapheme whose raw range lies inside it is
  drawn in the look's role for its class, read from the PNG (a glyph's cell: pen x to pen x + advance, from 0.8 size above
  the baseline to 0.2 below; at least 3 pixels within 6 codes of the role's color, and for a plain glyph none in any
  token's role). Thin glyphs (quotes, brackets) are skipped; letters and `=` are read. A tab is one display grapheme per
  column it fills, as each shows as a column.
- **A look is no part of the document**: the look is the line's `look` input, not a member of the document; "no change to
  the document's hash" is read as the document's own bytes (sha256 of its JSON) being the same before and after drawing
  it in both looks, which a renderer that wrote colors into the document would break. The base has no document-hash
  answer to read.
- **The look's maps**: `code: {class → role}` and `diff: {added, removed, changed → role}` at the look's top level, as
  the design's field list has them; a role is a role name of the look's `roles`, which the `look` answer's `roles` gives
  as `#rrggbb` per theme.
- **The status distance**: every code and diff role of a shipped look, in both themes, at least the look's
  `min_distance` (default 0.10) in OKLab from each of its status colors (the design: "kept the status distance from status
  colors wherever status can show"). A shipped look may repeat a role for two classes.
- **"Shows any of its lines"** is read as the line's anchor `<item>#line:n` (1-based, as `first_line` numbers) having a
  box in `geometry`, in u at zoom 1: x the item's, y the item's plus (n − 1) line heights, a line height 1.3 × size
  rounded to whole px (16 u at size 12), at least the line's 119 characters wide (7.2 u each in the mono face). `#tok:k`
  numbers the tokens from 0 as `tokens` is indexed; its box is the token's glyphs on its line. `raster` of 238,000
  glyphs takes over five minutes at the base's debug build, so the lines are read as anchors, not drawn.
- **The 2,000 lines** end each in LF, 119 characters and the LF; the last line's LF makes the file 240,000 bytes. The
  display text is 238,000 characters plus 1,999 line ends.
- **256 KiB is bytes**: the raw's UTF-8 length (262,144), tested at the boundary and with two-byte characters. The `raw` as
  an asset sha256 is not tested: the issue gives its field form (`raw: string | asset sha256`) no JSON shape.

## Not tested, because no criterion says so

The gutter's marks in the diff roles, highlights (`dim_others`, `band`, `box`), `numbers`, `first_line`, line numbers on
by default (scope bullets, with no acceptance criterion; the diff roles are only checked to exist and keep the status
distance), `text_diff`, `#line:n`'s other uses, a quote from an `ev` handle, `quote`'s `lines` beyond `[3, 5]`, non-UTF-8
bytes and U+FFFD, a bare CR line end, `tab` other than 4, a quote's digits as quotation (#406's), a code item over the cap
as an asset, `tokens` over 65,536, and every performance bound.
