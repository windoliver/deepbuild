# #1632 criterion 5 on the reference Mac: a bound call's p95 against the merge base

Run 2026-11-11 05:26 UTC by the Mac runner, with the owner's go at the Mac. The test is
`tests/acceptance/1632/budgets.test.ts`, `#1632.c4de6dbc`, written blind.

- **Head:** `21ea9ceccab5fe7f8b16ad31e9d94b5a2e09f90d` (PR #2092). **Base:** `ad13e04951a52d6d4c5757c844c487b331840dd4`, `git merge-base HEAD origin/main`. Each was a built tree with its own `node_modules`.
- **Command,** in the head tree: `DEEP_1632_BASE_TREE=~/db1632-base npx vitest run tests/acceptance/1632/budgets.test.ts`
- **Machine:** `Mac15,12` (a reference model), on AC power, with no thermal or performance warning recorded. The 1-minute load was 3.20 at the start and 3.11 at the end. About 106 GB of disk was free.

```text
#1632 bound deep_open_item p95: this tree 0.3, 0.4, 0.4, 0.4, 0.3 ms, merge base 21.6, 0.5, 0.3, 0.3, 0.3 ms (margin 6762%)
 ✓ #1632.c4de6dbc on the reference Mac, a bound deep_open_item's p95 is unchanged from the merge base's  18560ms
 Tests  1 passed (1)
```

**PASS.** Five rounds alternated the two trees, each round 20 untimed and 40 timed calls.

How to read it:

- The test's rule (`helpers.ts`, `judgeAgainstBase`) sets the margin from the spread of the base's rounds. The base's first round, 21.6 ms, is a cold outlier, and it widened the margin to 6762%, so this run doesn't bound the change that tightly.
- Without that round, the base's spread gives a margin of 67%. Every round of this tree still falls inside it: the largest ratio is 0.4 against 0.3 ms, +33%. All readings are under half a millisecond and are printed to 0.1 ms.
- The rule is the blind test's, and it is unchanged here.
