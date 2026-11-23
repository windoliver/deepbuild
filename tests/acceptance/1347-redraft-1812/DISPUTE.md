# Dispute: #1347's `deep workspace` reads, after #1812

**The first draft's tests can't pass on #1812's work.** #1812's Scope says "A command a person runs prints a sentence, and JSON only with `--json`: `deep fix`, `deep workspace`, `deep rules` and `deep numbers refresh`". It also says "An exit or a line an acceptance suite pins moves only through that suite's blind redraft". `tests/acceptance/1347/helpers.ts` opens every test's world by reading JSON from plain `deep workspace new` and `deep workspace task`.

One run on the work (`05d624f27`, before main was merged in) fails all 5 tests while opening the world, before any #1347 criterion is asserted:

```
AssertionError: #67's `deep workspace new Trip plan` makes the workspace: exit 0, stdout "Made the workspace Trip plan as Tripplanb3ac8a90, in <tmp>/h/.deepbuild/workspaces/tripplan-c4ce8bac.\n", stderr ""
```

**The redraft.** A fresh run of the blind job wrote this folder (commit `d14e7b0d3`, cherry-picked as `4a716be83`). It was given #1347, #1812, the frozen suite, #1812's blind suite, the design and the base `c0a9de979`, which holds no implementation of #1812. It never saw the work, the diff or this dispute. `helpers.ts` here adds `--json` to those two calls and nothing else. The four test files are byte for byte the originals, and `revert`, `drift` and `move` still run without `--json`, read by their exit. At the base all 5 tests fail at `deep workspace new <topic> --json`'s usage error (`BASE-RESULTS.txt`).

On the work merged with main, at `4a716be83`, one run passes all 5 tests: `Test Files 4 passed (4); Tests 5 passed (5)`, in 268 s.

## Your call, once

- **Swap in the redraft** (recommended): it runs in the first draft's place. `scripts/lanes.mjs` moves `tests/acceptance/1347/` to `byHand`, and this folder stays `alone`. The signed approval tag on that lanes commit is owed with it.
- **A third draft**: name the reading to change, and a blind job writes these tests again on that ruling.

Until then both drafts stay in the lanes as their commits registered them, and neither draft was edited.
