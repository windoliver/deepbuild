# Oracle lane for #1968: the pinned upstream diff tests, run on our code

Written first, blind, from issue #1968, its Oracle page (`doneright/oracles/issues/1968.md` and `cases/1968.json` in
`DeepBuildAI/deepbuild` branch `doneright`, as saved for this job), the five upstream files that page pins, `AGENTS.md`,
the design (`docs/canvas-primitives.md`: Text `text@1`: code and Transition) and base commit `a12be6c8`, by a job that
never saw an implementation. #136's rule applies: a linked test counts only when run against our output, so each pinned
test's sequences and the alignment it expects are ported onto what `deep-show` answers for them. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft (design: Dogfooding).

The Oracle page links upstream tests for 1 of 3 criteria, criterion 1 (`#1968.4bf4e5fe`), "run on our code; formula".
Criteria 2 and 3 have none (the page says why: a budget on the reference Mac, and a taste call); nothing here. Our own
tests of criterion 1 are `tests/acceptance/1968/ac1-text-diff.test.ts`, whose surface and documents this lane reuses.

## Sources

| Criterion | Upstream, pinned | Use |
|---|---|---|
| 1 | the upstream diff library at commit `e3804055b844f5d0c3cb111f5f6276f60e07459a`: `src/algorithms/lcs.rs` (a classic LCS table, walked forward) with its two snapshot files `…__algorithms__lcs__diff.snap` and `…__algorithms__lcs__pat.snap`; `src/text/inline.rs` (a diff by line, then token by token inside changed lines) with its snapshot file `…__text__inline__line_ops_inline.snap` | run on our code; formula |

Nothing of them is copied into this folder: they are read in place, and only each test's sequences, texts and expected
operations are read from them.

## Where the lane reads the files, and how a fresh checkout gets them

The lane reads `<oracles>/vendor/<pin>-e3804055b8/src/…`, the vendor folder whose name ends in the pinned commit's first
ten digits, each snapshot file found there by the end of its name, where `<oracles>` is the folder `doneright/oracles/`
of branch `doneright` of DeepBuildAI/deepbuild (the byte-for-byte copy of the pins under `vendor/`). It is
`$DEEP_ORACLES` when set, else `../deep-oracles/doneright/oracles` beside this checkout (#1965's lane's `ORACLES`,
imported). A fresh checkout gets it with:

```sh
git fetch origin doneright && git worktree add ../deep-oracles origin/doneright   # or: DEEP_ORACLES=/path/to/doneright/oracles
```

If a file is missing the test fails with `BLOCKED: the pinned upstream file … is missing …` and that one unblock ask
(#1965's lane's `vendored`, imported). It never passes and is never skipped. The lane makes no network call.

## Run

```sh
npm ci                      # once, if node_modules is missing
DEEP_ORACLES=<path> PATH=$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH \
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease npx vitest run --root tests/acceptance/1968-oracle --no-file-parallelism --testTimeout=600000
npx tsc --noEmit -p tests/acceptance/1968-oracle      # type-check (exits 0)
```

The file builds `deep-show` once (#535's `prebuild`, as `tests/acceptance/1968/` does), so run it **alone**:
`scripts/lanes.mjs` should list `'tests/acceptance/1968-oracle/'` in `alone` (the implementer makes that edit). A run with
`--root` leaves `tests/acceptance/1968-oracle/node_modules/.vite`; delete it. The folder imports
`../1965-oracle/helpers.ts` and `../1968/helpers.ts` by path.

`BASE-FAILURE.txt` is the run at the base: both tests fail at their own assertion for missing behavior.

## The surface under test

`deep-show run` and `eval {t, film: true}`'s `diffs` block, as `tests/acceptance/1968/README.md` defines it: for each
text_diff, every token of both items once, a kept token naming its token on each side (`<item>#tok:k`), a token that goes
naming only its old one (`to: null`), a token that comes only its new one (`from: null`). Every case is a pair of code
items, `<case>-a` and `<case>-b`, at one place of its own in one film (`size: 12`, `line_height: 16`, `numbers: false`,
each token class `plain`), under its own text_diff `<case>` over [0 s, 1 s]; the film is read once, at 0.5 s. A case's
alignment is the set of its kept pairs, the set of tokens that go and the set that come; the order of the library's
operations isn't compared. Positions and opacities aren't read here: the motion of kept tokens is ours (the page says
so), and `tests/acceptance/1968/` judges it.

## Criteria to tests

`upstream-diff.test.ts` (2 tests), each named with AC1's tag:

| Pinned test | Expected value, from | Ported as | Asserted on our alignment |
|---|---|---|---|
| `test_diff` ([0, 1, 2, 3, 4] against [0, 1, 2, 9, 4]) | its snapshot: equal 0–2, 3 replaced by 3, equal 4 | `diff-lines`, `diff-tokens` | kept, gone and come exactly the library's |
| `test_pat` ([0, 1, 3, 4, 5] against [0, 1, 4, 5, 8, 9]) | its snapshot | `pat-lines`, `pat-tokens` | the same |
| `test_issue44_swapped_regression` | its asserted operations | `swapped-lines`, `swapped-tokens` | the same |
| `test_bad_range_regression` ([0] against [0, 0]) | its asserted operations: the one kept element at the first place, the second one come | `bad-range-lines`, `bad-range-tokens` | the same |
| `test_table` ([2, 3] against [0, 1, 2]) | its asserted table values `get(i, 0)`: the length of the longest common subsequence of each suffix of the second against the first, for i = 0, 1, 2 (each 1) | `table-<i>-lines`, `table-<i>-tokens`, the suffix from i | as many tokens kept as the value (the formula) |
| `test_line_ops_inline` (two six- and four-line texts) | its snapshot: per line, equal, gone or come, and the parts of a replaced line it marks changed | `line-ops`, the texts as they are, a word a token | kept, gone and come exactly the library's |
| `test_line_ops_inline_chars` (`abcde` against `abXYZ`) | its asserts: the old line's parts, `ab` kept and `cde` changed | `chars`, a character a token | the same |
| `test_line_ops_inline_issue_84_chars` (`f(x) y` against `f(z) y`) | its asserts: both lines' parts, `x` and `z` changed | `call`, a character a token | the same |

In every case each token of either item is in exactly one piece, and the kept tokens are a common subsequence (equal
bytes, in order on both sides). A sequence of the LCS module's tests is ported twice, one element a line holding one
token (text_diff's line level) and one element a token of one line (its token level, inside the one changed line). An
element is a word: its decimal digits as the syllables `ka lo mi nu pe ra si tu vo ze` (0 to 9), so equal elements are
equal bytes and no digit or number word reaches a code item.

## Wrong programs

Before reading our answer, each test runs its judge on every case's own library alignment (it must pass) and on planted
wrong alignments (each must fail): nothing kept (`diff-tokens`); tokens paired by position (`diff-tokens`, and
`line-ops`, where no line is aligned first); the bad-range regression's kept element at the later of its two equal
places; a common subsequence shorter than the longest (`table-0-tokens`). The base is the wrong program both tests fail
on.

## Readings where the issue, the design and the page leave a choice

- **Ties.** "Our tie to the earlier position may order equal-length choices differently" (the page). Among the ported
  cases only the bad-range regression has two longest alignments (where its one kept element sits); the design's
  earlier position and the library both keep the first, so the lane asserts it. Every other ported case has one longest
  alignment, and the order of operations (a delete before an insert or after) is never compared.
- **A replace** (an operation or a replaced run of lines) is its old elements going and its new ones coming; a changed
  token is so two pieces, as the design's "a changed token cross-fades" draws it.
- **Words.** The inline test's words are its words without the spaces the library keeps on them, since a code item's
  tokens are the highlighter's and white space isn't one; the unmarked parts on both sides of a replaced line are the
  same words in the same order, and pair in that order.
- **`test_line_ops_inline_chars`** asserts only the old line's parts; the new line's kept parts are read as the same text
  in the same order (a replaced run keeps its equal parts on both sides), the rest of the new line come.
- **Line ends.** Every LCS case's lines end in LF, so how a line's end enters its bytes doesn't matter; the inline
  test's old text ends without one on a line that goes either way.

## Not ported, and why

- `test_contiguous`, `test_same`: their snapshot files aren't pinned.
- `test_subrange_regression`, `test_identical_subrange_issue_98`: diffs of sub-ranges; a text_diff aligns whole items.
- `test_deadline_fallback_issue_97`, `test_deadline_table_allocation_is_incremental`: deadlines; a text_diff has none.
- `test_table`'s `get(3, 0)`: an empty suffix, an empty code item.
- `test_raw_accepts_partialeq_only_values` (it asserts only that some operation comes out), `test_finish_called`,
  `test_empty_table_dimension_does_not_allocate`, `test_table_size_overflow_panics`,
  `test_incremental_table_matches_contiguous_in_both_orientations`: the library's own hooks and table internals.
- The inline module's semantic-cleanup tests (an option a text_diff doesn't have),
  `test_iter_all_inline_changes_helpers_match_manual_iteration` (its API) and `test_serde` (its JSON; its snapshot isn't
  pinned).
