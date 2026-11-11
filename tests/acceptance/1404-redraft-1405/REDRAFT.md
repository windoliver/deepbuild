# Blind redraft of #1404's tests that #1405's rule contradicts

#1405 judges instructions retired by two seeded one-sided sign-flip tests on the paired differences against 2% (`tests/acceptance/1405/README.md`). A one-sided sign-flip test on n pairs can't go below p = 1/2^n, so 1, 2 or 3 pairs (p ≥ 1/8) can never read FAIL or PASS at p under 0.01; and a budget whose count moves several percent between identical runs reads INCONCLUSIVE, not PASS. Three #1404 tests rest on those. This folder redrafts them from #1404's own criteria (as `tests/acceptance/1404/README.md` quotes them), drafted by #1405's blind acceptance job with #1405's text and the base `de304b9ff`. The originals are not edited or deleted; a person approves the swap.

```
node --test 'tests/acceptance/1404-redraft-1405/*.test.mjs'
```

They import `tests/acceptance/1404/helpers.mjs`, unchanged.

| Original (path › test) | Criterion | Why the old expectation no longer holds | Replaced by |
|---|---|---|---|
| `1404/judge.test.mjs` › a child with 3 times the merge base's work reads FAIL behind the same wrapper, and an unchanged one reads PASS | A child with 3 times the merge base's work reads FAIL | Three pairs: no sign-flip test reaches p under 0.01, so the tripled child can't read FAIL and the unchanged one can't read PASS | `judge.test.mjs` › same name, on 10 alternated rounds (p down to 1/1024), same plants and wrapper |
| `1404/no-counter.test.mjs` › judgeInstructions reads a missing count INCONCLUSIVE, never PASS, and complete pairs by their counts | A host with no counter still reads INCONCLUSIVE | Its complete-pair checks judge 2 equal pairs as PASS and 1 tripled pair as FAIL | `no-counter.test.mjs` › same name: the missing-count cases unchanged; 20 equal pairs PASS, 20 tripled pairs FAIL |
| `1404/no-count.test.mjs` › a budget that started a child still running when it ended reads INCONCLUSIVE, naming the budget, never PASS, and a budget that started none does not | A started child with no count reads INCONCLUSIVE, naming the budget, never PASS | Its childless budget, `spin 1000000` (~30 M instructions), moved −6% to +10% between identical runs at load 430 on this Mac: "at least 2%" isn't rejected, so #1405 reads it INCONCLUSIVE for noise, failing "a budget that started none does not" | `no-count.test.mjs` › same name, with the childless budget at `spin 100000000` (~1 billion instructions), whose count holds; `left-running` unchanged |

## Kept as they are

- `1404/child-count.test.mjs` (all four): `measureOnce` counts only, no judging.
- `1404/proof.test.mjs`: 20 rounds of `measure`, a tripled child: every pair about +200%, FAIL under #1405 too.
- `1404/no-count.test.mjs` › perf reads FAIL on a budget whose child retires 3 times…; › a budget whose shell started a child it reports no count for… (INCONCLUSIVE for a missing count, unchanged). Running the original file and this folder both means two lane runs.
- `1404/no-counter.test.mjs` › a report with no counter…; › perf on a host with no counter… .

## On the base

`judge.test.mjs` and `no-counter.test.mjs` pass on the base: ten rounds, and 20 equal or tripled pairs, read the same under the old margin, and the no-counter criterion says "as it does today". They change only so that they still hold under #1405. `no-count.test.mjs` failed elsewhere on the base: #1404's `perfLane` leaves `scripts/throttle.mjs` out of its copy, and at `de304b9ff` `scripts/bays.mjs` imports it, so perf can't start (`ERR_MODULE_NOT_FOUND`). The original `1404/no-count.test.mjs` uses the same helper and fails the same way at this base; its redrafted assertion hasn't run. `BASE-FAILURE.txt` in `tests/acceptance/1405/` has the run.
