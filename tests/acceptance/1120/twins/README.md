# Twins for the 1120 tests

The issue's Proof asks for "a planted scope that builds only the mutated package (no dependents) shown changing the kill
set first". `../twins.json` names it for `#1120.1f2e20de`: `without-dependents/scripts/proof-runs.mjs`.

No implementation existed when these tests were drafted, so the twin is the base's `scripts/proof-runs.mjs` (b4a2049e8)
with one change: the per-mutant `npm run build --workspaces --if-present` becomes `npm run build --if-present -w <folder>`
for the workspace folders holding the mutated files alone (`scopeOf(..., false)` at the end of the file). Nothing else
differs (`diff` against the base: 1 line changed, 17 added). The before lane never needs it while the test fails on the
merge base at its assertion, as it does at the base; it is the Proof's planted wrong program, run by laying it over a
checkout (`../BASE-FAILURE.txt`, section 3).

| Criterion | Twin | The one rule it breaks | What fails |
|---|---|---|---|
| `#1120.1f2e20de` (AC2) | `without-dependents` | Per mutant, only the mutated package is built, never its dependents | `scope.test.mjs` at the kill-set assertion: all 5 mutants survive (`5 surviving`, not `1`), since b's and d's dist never carry the instrumented a |

A twin made from the merged implementation instead (its file with the dependents left out of its scope) would serve
the same; that is a twin change, which goes through the blind redraft (design: Dogfooding).
