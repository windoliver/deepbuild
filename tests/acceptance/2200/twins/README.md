# Twins for the 2200 tests

Criterion 3 (`#2200.b9e90749`, the first command still sets up) holds behaviour the fix must keep, so its test passes
on the merge base, and the before lane counts a tagged test only once it failed on a wrong program
(`scripts/proof-runs.mjs`). `../twins.json` names that program.

| Criterion | Twin | What it plants | Why it is the criterion's wrong program |
|---|---|---|---|
| `#2200.b9e90749` | `never-sets-up` | `packages/cli/src/main.ts` of the base (`72fe11a11`) with one condition changed, on the line marked `Planted`: the first-run setup never runs, for any command | A fix that stops the setup before a usage error by stopping it for every command. `deep status` in a home with no `.deepbuild` then writes nothing and calls no stand-in, and the test fails at its first assertion |

The twin is the base's whole file, so laid over a change it also puts back whatever the change did in that file. It
builds against a hub that still exports what the base's `main.ts` imports. `deep setup` itself is untouched, so the
test's second home still shows what setup leaves.

Run by hand in a copy outside the repository (`../BASE-FAILURE.txt`, second part): on the twin the criterion 3 test
fails, the ten tests of criteria 1 and 2 pass, and the four of criterion 4 fail as on the base.
