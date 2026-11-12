# Oracle lane for #1965: the Unicode files run on our code

Written first, blind, from issue #1965, its Oracle page (`doneright/oracles/issues/1965.md` and `cases/1965.json` in
`DeepBuildAI/deepbuild` branch `doneright`, as saved for this job), the two upstream files that page pins, `AGENTS.md`,
the design (`docs/canvas-primitives.md`: Text `text@1`: code) and base commit `3962d528`, by a job that never saw an
implementation. #136's rule applies: a linked test counts only when run against our output, so every expectation here is
compared with what `deep-canvas-render` answers for the file's strings. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft (design: Dogfooding).

The Oracle page links upstream tests for 1 of 3 criteria, criterion 2 (`#1965.1d486d42`): the page calls both files test
data "run on our code". The raw byte compare and the `quote_mismatch` twins of that criterion are ours and live in
`tests/acceptance/1965/` (`quote.test.ts`). Criteria 1 and 3 have no upstream test (the page says why); nothing here.

## Sources

| Criterion | Upstream, pinned | Use | License |
|---|---|---|---|
| 2 | icu4x `b1cec62bb76ddd8f1f7f52616997f0f243d5eb9e` `components/normalizer/tests/data/NormalizationTest.txt` (Unicode 17.0.0) | data, run on our code | Unicode License v3 |
| 2 | icu4x `b1cec62bb76ddd8f1f7f52616997f0f243d5eb9e` `components/segmenter/tests/testdata/GraphemeBreakTest.txt` | data, run on our code | Unicode License v3 |

Nothing of the files is copied into this folder: they are read in place, so their notice stays in their own headers
(`© 2025 Unicode, Inc.`, terms at https://www.unicode.org/terms_of_use.html, license https://www.unicode.org/license.txt).

## Where the lane reads the files, and how a fresh checkout gets them

The lane reads `<oracles>/vendor/icu4x-b1cec62bb7/components/{normalizer/tests/data,segmenter/tests/testdata}/…`, where
`<oracles>` is the folder `doneright/oracles/` of branch `doneright` of DeepBuildAI/deepbuild (the byte-for-byte copy of the
pins under `vendor/`). It is `$DEEP_ORACLES` when set, else `../deep-oracles/doneright/oracles` beside this checkout. A
fresh checkout gets it with:

```sh
git fetch origin doneright && git worktree add ../deep-oracles origin/doneright   # or: DEEP_ORACLES=/path/to/doneright/oracles
```

If a file is missing the test fails with `BLOCKED: the pinned upstream file … is missing …` and that one unblock ask. It
never passes and is never skipped. (`vendor/` is not in this repo; the lane makes no network call.)

## Run

```sh
npm ci                      # once, if node_modules is missing
DEEP_ORACLES=<path> PATH=$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH \
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease npx vitest run --root tests/acceptance/1965-oracle --no-file-parallelism
npx tsc --noEmit -p tests/acceptance/1965-oracle      # type-check (exits 0)
```

Run **alone**, one file at a time (`scripts/lanes.mjs` should list `'tests/acceptance/1965-oracle/'` in `alone`; the
implementer makes that edit): each file builds `deep-canvas-render` and `normalization.test.ts` runs about 37,000 strings
through `check` and `raster` (several minutes). A run with `--root` leaves `tests/acceptance/1965-oracle/node_modules/.vite`;
delete it. The folder imports `../467/helpers.ts` and `../1965/helpers.ts` by path.

`BASE-FAILURE.txt` is the run at the base.

## The surface under test

`deep-canvas-render check {doc, look, …}` and `raster {out, doc, look, t: 0}` (see `tests/acceptance/1965/README.md`, The
surfaces under test). Each string is one code item: `raw` the string, `name: true` (the item's digits are not numbers
under test), and one `code.tokens` entry per range the test puts a token on. `raster`'s `texts[item]` gives `shown` and
each glyph's `grapheme` and `role`. A string no bundled face draws is refused by `check` as `text.glyph_missing`; the lane
leaves those out and prints the counts; any other `check` refusal is a failure.

## Criteria to tests

| ID | Upstream | Tests and assertions |
|---|---|---|
| AC2 `#1965.1d486d42` | NormalizationTest.txt | `normalization.test.ts` (1). Each distinct input of the five columns (c1, c2, c3 must display as c2; c4, c5 as c4; rows with a C0/C1 control or surrogate left out, which are tab, line-end and byte steps of their own) is a code item with one token, class `string`, over all its bytes. The drawable ones (more than 1,000, among them `e` U+0301) must display (`shown`) exactly as the file's NFC form (so e then U+0301 displays as U+00E9, one grapheme), and every glyph's `role` must differ from the role of a no-token code item's glyphs (the token's byte range lands on the whole display) |
| AC2 `#1965.1d486d42` | GraphemeBreakTest.txt | `grapheme.test.ts` (1). Each row without a control is a code item whose raw is the row's string and whose tokens are one per cluster on its byte range, classes `keyword` and `string` alternating. For each drawable row (more than 50, among them a letter with a combining mark as one cluster), all glyphs of display grapheme k have one role, other than the no-token role, the same for every even k and another for every odd k across the whole run, and no glyph is at a grapheme past the file's cluster count. A display that splits or joins clusters other than the file's, or a token that cuts one, leaves a glyph in the other class's role |

Wrong programs the assertions fail: a code item that ignores tokens (every glyph in the no-token role); one that applies
NFC to the whole raw before display, or not at all (a precomposed or decomposed difference in `shown`); one that maps
tokens by display columns or characters (a mark's 2 bytes, an astral code point's 4 bytes, a conjunct's cluster); one that
splits a cluster into two display graphemes (an extra glyph grapheme, a wrong parity) or joins two.

## Readings where the issue and design leave a choice

- **Which strings**: every string the files give is fed, minus the rows with a control code point (U+0000–001F,
  U+007F–009F: tab, CR and LF are other steps' of the same display map) and what `check` refuses as `text.glyph_missing`.
  Part of both files is in scripts no bundled face covers (the lane prints how many are run and how many are left out).
- **The role observed** is the glyph row's `role` (the name of the role a glyph's run draws in, as #1964's runs set it),
  compared with the no-token baseline and, between classes, with each other; the look's role names are not read, so only
  "a token's class is drawn in a run of its own role" is asserted here (the pixels are in `tests/acceptance/1965/`).
- **NFC is per grapheme** in the design ("NFC, one grapheme at a time"); NormalizationTest's NFC form of a string is
  expected for the whole string, which agrees wherever a composition can't cross a grapheme boundary (the composing
  characters of Unicode's canonical compositions extend their cluster). A row where they differ is a finding, listed.
- **Grapheme index**: `texts[item].glyphs[].grapheme` indexes the display text's graphemes, a line end counting one; a row
  has none, so display grapheme k is the file's cluster k (NFC keeps a cluster one cluster).

## Not tested, because the page says no upstream test applies

Criteria 1 and 3, the raw byte compare and the `quote_mismatch` twins (`tests/acceptance/1965/`), tab, CR and LF rows, the
other normalization forms (NFD, NFKC, NFKD columns), and Hangul and the other rows no bundled face draws.
