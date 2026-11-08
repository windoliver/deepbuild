# Twins for the 1119 tests

The base's `scripts/perf.mjs` keys its kept copies by worktree path, so every test already fails there at its
assertion (`../BASE-FAILURE.txt`). The issue's Proof also asks for "a planted path-keyed copy" shown failing first,
and `../twins.json` names it. No implementation existed when these tests were drafted, so its folder isn't here yet:
the twin is to be `twins/path-keyed-copy/scripts/perf.mjs`, the merged implementation's `perf.mjs` with exactly one
rule broken as below, and nothing else changed (same CLI, same record lines, same byte-compare replacement). The
twin folder holds only that file. Until it exists, the before lane never needs it: every tagged test here fails on
the merge base at its assertion first.

It was checked against a throwaway planted `perf.mjs` (`../BASE-FAILURE.txt`), and failed the tests listed.

| Criterion | Twin | The one rule it breaks | Tests it fails |
|---|---|---|---|
| `#1119.a84127b8` (AC1) and `#1119.d33bc868` (AC2) | `path-keyed-copy` | The kept copies' folder under `deepbuild-perf/` is named by the worktree's path (`sha256(realpathSync(root))`, as at the base) instead of by the machine; the lock beside them, the byte-compare replacement and the record stay as they are | `warm.test.mjs`, both tests (the second worktree's base side compiles all 3 crates; the nested perf from the second worktree runs its checks), `ledger.test.mjs` (all 3 crates compile, not deep-show and show-panel alone) |

No other twin is named: AC3 is a reading with no test, and each AC1 and AC2 test already fails on the path-keyed
copy. Four more wrong programs were checked with the planted program, though the issue doesn't name them; see
`../BASE-FAILURE.txt`.
