# Dispute: #1342's trip scene, after #1812

**The first draft's tests can't pass on #1812's work.** #1812's Scope says "A command a person runs prints a sentence, and JSON only with `--json`: `deep fix`, `deep workspace`, `deep rules` and `deep numbers refresh`". It also says "An exit or a line an acceptance suite pins moves only through that suite's blind redraft".

`tests/acceptance/1342/home.test.ts`'s `tripScene()` makes its fixture project with plain `deep workspace new "Family trips"` and reads its `id` as JSON. AC2 (`#1342.23ee5c69`) and AC6 (`#1342.435612ed`) start from that scene. One run on the work (`05d624f27`, before main was merged in) ends both BLOCKED there, before any trip assertion. The file's other three tests pass:

```
AssertionError: BLOCKED: #67's deep workspace new "Family trips" makes the fixture's project: exit 0, stdout "Made the workspace Family trips as Familytrips463a73fb, in <tmp>/h/.deepbuild/workspaces/familytrips-5ba9f67d.\n", stderr ""
```

**The redraft.** A fresh run of the blind job wrote this folder (commit `65f4cb33e`, cherry-picked as `c98cad1d9`). It was given #1342, #1812, the frozen suite, #1812's blind suite, the design and the base `c0a9de979`, which holds no implementation of #1812. It never saw the work, the diff or this dispute. Its `home.test.ts` holds AC2 and AC6 only, with the same steps and assertions, and makes the fixture with `deep workspace new "Family trips" --json`. At the base both fail at that call's usage error (`BASE-RESULTS.txt`).

On the work merged with main, at `cfaa7fb8d`, one run passes both tests: `Test Files 1 passed (1); Tests 2 passed (2)`, in 92 s.

## Your call, once

- **Swap in the redraft** (recommended): AC2 and AC6 run from this folder. `scripts/lanes.mjs` moves the first draft's `home.test.ts` to `byHand` once its AC4, AC5 and AC11 run elsewhere, or keeps the file and the swap names only AC2's and AC6's tests. The signed approval tag on that lanes commit is owed with it.
- **A third draft**: name the reading to change, and a blind job writes these tests again on that ruling.

Until then both drafts stay in the lanes as their commits registered them, and neither draft was edited.
