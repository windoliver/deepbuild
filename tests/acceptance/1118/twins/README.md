# Twins for the 1118 tests

The base has no proof lane that runs in bays, so every test already fails there at its assertion
(`../BASE-FAILURE.txt`). The issue's Proof also asks for a planted wrong program shown failing first, "a planted copy
that keeps the previous use's overlay", and `../twins.json` names it, with one more (a lock-blind install). No
implementation existed when these tests were drafted, so their folders aren't here yet: each twin is to be
`twins/<name>/scripts/<file>`, the merged implementation's file (`bays.mjs`, `proof-runs.mjs` or wherever the rule
lives) with exactly one rule broken as below, and nothing else changed (same CLI, same record lines). A twin folder
holds only the files it replaces, never a file under the test paths or `node_modules`. Until a folder exists, the
before lane never needs it: every tagged test here fails on the merge base at its assertion first.

Each was checked against a throwaway planted implementation (`../BASE-FAILURE.txt`), and failed the tests listed.

| Criterion | Twin | The one rule it breaks | Tests it fails |
|---|---|---|---|
| `#1118.dc689388` (AC2) | `keeps-overlay` | Before a use, the bay's replace writes the use's files whose bytes differ but never deletes a file the use's recipe lacks, so what the previous use laid over its tree (the before lane's base overlay, crash's main files under `tests/`) stays | `run.test.mjs` AC2: replay's base copy holds the change's `tests/` files ("not in the recipe") |
| `#1118.5a7b1fc3` (AC1) | `lock-blind-install` | `npm ci` runs in a bay before every use, whatever the lock's bytes and the post-install marker say | All three AC1 tests: `npm ci` ran 6 times, not 0 or 1 |

Two more wrong programs were checked with the planted implementation, though the issue doesn't name them:
`rewrite-all` (the replace writes every file anew, bytes equal or not, so each gets a new mtime) fails both AC3 tests
(`run.test.mjs` and `rust.test.mjs`: the base bay compiles greet and word); `no-untracked` (the change's recipe leaves
out the worktree's untracked files) fails AC4 and AC2 (the untracked test never ran; replay's change copy misses it).
