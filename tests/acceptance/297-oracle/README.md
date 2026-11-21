# Acceptance tests for #297, Oracle lane: the two Unicode files the Oracle page pins, run on our entry text

Written first, blind, from issue #297, its Oracle page (`doneright/oracles/issues/297.md` on branch `doneright` of
`DeepBuildAI/deepbuild`), the two upstream files that page pins (fetched with `gh api` from that branch's
`doneright/oracles/vendor/`), the #297 suite's surface (`tests/acceptance/297/README.md`, written by the same job) and
the base commit `4bf2fc7ad`. The job never saw an implementation of #297; none existed, and no other worktree, branch
or pull request was read. #136's rule applies: a linked test counts only when run against our output, so every case
here commits a string as an entry and asserts on what `deep-show`'s `eval` says the entry text shows. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

The page links upstream tests to 2 of 11 criteria, 3 and 6; the other nine have none (the page's "No upstream test"
table) and stay with `tests/acceptance/297/`.

## Sources

| Criterion | Upstream, pinned | File | Use | Here |
|---|---|---|---|---|
| 3 `#297.d2e288d8` | icu4x `b1cec62bb76ddd8f1f7f52616997f0f243d5eb9e`, `components/segmenter/tests/spec_test.rs` lines 377 to 452 (`grapheme_break_test`) | `components/segmenter/tests/testdata/GraphemeBreakTest.txt` (Unicode 17.0.0), SHA-256 `e2d134d2c52919bace503ebb6a551c1855fe1a1faec18478c78fff254a1793ec` | data, run on our code (the page's use) | `graphemes.test.ts` (1 test) |
| 6 `#297.cd44d20a` | the same commit, `components/normalizer/tests/tests.rs` lines 936 to 1102 (`test_conformance`) | `components/normalizer/tests/data/NormalizationTest.txt` (Unicode 17.0.0), SHA-256 `5019ffd530751a741900c849c0e010332f142a3612234639bd200b82138a87db` | data, run on our code | `normalization.test.ts` (1 test) |

**The upstream tests, re-expressed.** No upstream code is copied or run. Each upstream test reads its file and asserts
each line's answer: the segmenter's boundaries equal the row's `÷` marks; the normalizer's NFC form is the line's c2 for
c1, c2 and c3, and c4 for c4 and c5. Here the file's answers are asserted on our entry text instead: the boundaries are
the places an ellipsis may cut, and the NFC form is what the entry text shows. Nothing of the files is copied into this
folder: they are read in place, so their notice stays in their own headers (`© 2025 Unicode, Inc.`, terms at
https://www.unicode.org/terms_of_use.html, license https://www.unicode.org/license.txt).

## Where the lane reads the files, and how a fresh checkout gets them

The lane reads `<oracles>/vendor/icu4x-b1cec62bb7/components/{segmenter/tests/testdata,normalizer/tests/data}/…`, where
`<oracles>` is the folder `doneright/oracles/` of branch `doneright` of DeepBuildAI/deepbuild: `$DEEP_ORACLES` when set,
else `../deep-oracles/doneright/oracles` beside this checkout (as #538's and #1965's lanes read theirs). A fresh checkout
gets them with:

```sh
git fetch origin doneright && git worktree add ../deep-oracles origin/doneright   # or: DEEP_ORACLES=/path/to/doneright/oracles
```

or with `gh api -H 'Accept: application/vnd.github.raw'
'repos/DeepBuildAI/deepbuild/contents/doneright/oracles/vendor/<path>?ref=doneright'` into `<dir>/vendor/<path>` and
`DEEP_ORACLES=<dir>`, as this job did for its base run. If a file is missing the test fails with a line starting
`BLOCKED:` and that one unblock line; a file whose SHA-256 isn't the pin fails. It never passes and is never skipped, and
the lane makes no network call.

## Run

```sh
npm ci                                   # once, if node_modules is missing
DEEP_ORACLES=<path> PATH=$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/297-oracle --no-file-parallelism --testTimeout=600000
npx tsc --noEmit -p tests/acceptance/297-oracle    # type check (exits 0)
rm -rf tests/acceptance/297-oracle/node_modules     # vitest's cache after a --root run
```

`helpers.ts` re-exports the #297 suite's helpers (`../297/helpers.ts`) and its fixture builders (`../297/fixtures.ts`),
so both lanes build and ask the same binary the same way: `cargo build --locked --bin deep-show` once a file. **The lane
runs alone**: `scripts/lanes.mjs` needs `'tests/acceptance/297-oracle/'` in its `alone` list; the #297 README gives the
line, and the implementer makes that edit. `normalization.test.ts` draws about 2,700 frames in one `deep-show run`.

## The surface under test

The #297 suite's (its README: The surface under test and Choices), with nothing added: `deep_show` of a piece, a
recorded track loaded with `track`'s `load` (seat 1's commits to `name`, one a step), and `eval` at each step, its
`shown`. The piece is the #297 suite's (`fixtures.ts`'s `piece`), with `name`'s `max_bytes` 64 so the longer strings fit,
a span covering every step, and one entry text for seat 1:

- `form` (normalization): at (16, 80), a box of 440 u at 16 u, `widest` "WWWWWW"; nothing here overflows it.
- `cut` (graphemes): at (16, 80), a box of 80 u at 16 u, `widest` "WWW" (47.3 u, 73.2 u with " (2)", so the fit check
  takes it).

## Which strings

The lane runs every string of the file that our entry text must take and draw, and leaves out the rest, printing how
many it ran:

- **Drawn**: every code point is in the character map (`cmap`) of a bundled face of the shipped look the piece is shown
  in, read from the face file in `crates/deep-text/fonts`: the body face (`Inter-Regular.ttf`) for the normalization
  file; the body face and the emoji face (`NotoEmoji-Regular.ttf`, the look's emoji fallback) for the grapheme file.
- **Taken** (the #297 rules, by Unicode properties): no control, format, other default-ignorable, private-use,
  unassigned or surrogate code point and no line or paragraph separator (hidden characters, standing alone or not, are
  refused by criterion 8's rule, which this lane leaves to the #297 suite); a base, not a mark, first; something that
  isn't white space; no base with more than 4 marks (general category Mn or Me); at most 64 bytes.

That leaves 2,709 inputs from the normalization file's lines and 27 of the grapheme file's 766 rows (21 of them more than
one cluster: regional indicators, the copyright sign, combining marks on a space and on letters, emoji modifiers), each
run after 21 prefixes.

## Criteria to tests

| ID | Test | Upstream | Ours |
|---|---|---|---|
| `#297.d2e288d8` | `graphemes.test.ts` | each row's boundaries | Each row is committed after a prefix of j letters i and a space (j from 1 to 20; none for j = 0), so the box's edge falls at another place in it each time; the prefix's letters and its space are clusters of their own (a space breaks from what follows it, the file's own rule GB999). Each frame's `shown` must be the whole entry's NFC form, or the NFC form of its first k clusters by the file, any white space before the ellipsis dropped, followed by U+2026. At least one cut must fall between two clusters of a row, so the file's boundaries inside a row are tried |
| `#297.cd44d20a` | `normalization.test.ts` | each line's NFC column | Each distinct input of the five columns is committed (c1, c2, c3 must show as c2; c4, c5 as c4; the line 141 case, e then U+0301, among them); each frame's `shown` must be the file's NFC form |

## The judge, and the sets it must fail

Each test first runs its judge on answers the model itself gives, so a judge that passes everything can't pass the file:

- graphemes: a cut inside a cluster (`b…` for the clusters "b" + U+0308, "c") fails; the whole string and the cuts
  between clusters pass.
- normalization: the file's own NFC forms pass; the bytes shown as typed fail on line 141; the NFD forms fail.

Then the pinned file is read and our code runs. The #297 suite's planted twins are run there, not here.

## Readings where the port leaves a choice

- **"The boundaries an ellipsis may cut at"**: what is kept before U+2026 ends at one of the file's `÷` marks; a cut
  that keeps nothing (U+2026 alone) is one too.
- **NFC per cut**: the NFC form of the kept clusters, which agrees with the whole string's NFC form cut at the same
  boundary wherever a composition can't cross a cluster boundary (a mark extends its cluster).
- **"Run on our code"**: the piece through `deep-show`, the frame `eval` evaluates, its `shown`.

## Not tested, because the page says no upstream test applies

Criteria 1, 2, 4, 5, 7, 8, 9, 10 and 11 (the #297 suite); the fit check, `widest` and its refusal (criterion 3's own
test there); keeping the typed bytes in the track (criterion 6's own test there); the rows and lines our faces don't draw
or the #297 rules refuse (above).

## What the implementer adds outside this folder

The `alone` line in `scripts/lanes.mjs`. Nothing else.

`BASE-FAILURE.txt` is the run at the base.
