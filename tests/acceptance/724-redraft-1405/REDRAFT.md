# Blind redraft of #724's judge criteria under #1405's rule

#1405 changes how `judgeInstructions` decides: two seeded one-sided sign-flip tests on the paired differences against 2% (FAIL when the change is above 2% at p under 0.01, PASS when "at least 2%" is rejected at p under 0.01, INCONCLUSIVE otherwise, with the seed and both p values in the result), in place of #724's margin, the larger of 2% and the pairs' spread. #1405's "Not in scope" says it lands by an approved proposal with a blind redraft of the suite whose closed criterion it changes. This folder is that redraft, drafted by #1405's blind acceptance job from #724's criteria (as `tests/acceptance/724/README.md` quotes them), #1405's text and the base `de304b9ff`, with #1405's surfaces (`tests/acceptance/1405/README.md`): `judgeInstructions(pairs, uncounted, seed)` and the result's `seed`, `pAbove` and `pBelow`.

The originals are not edited or deleted; a person approves the swap. Run with:

```
node --test 'tests/acceptance/724-redraft-1405/*.test.mjs'
```

They import `tests/acceptance/724/helpers.mjs`, unchanged.

## What each redraft replaces

| Original (path › test) | Criterion | Why the old expectation no longer holds | Replaced by |
|---|---|---|---|
| `724/judge.test.mjs` › a 20% rise in instructions retired fails the comparison, with every pair attached | #724.2a0f8e22 | It still reads FAIL, but its `reports()` asserts `spread` and `margin` = max(2%, spread), which #1405 removes | `judge.test.mjs` › same name: FAIL, every pair attached in order, `pAbove` < 0.01, seed and both p values in the result |
| `724/judge.test.mjs` › an unchanged task passes, with its margin and its pairs' spread reported | #724.dd2beb6a | "with the margin and the pairs' spread reported" is #724's margin; #1405 reports the seed and both p values instead | `judge.test.mjs` › an unchanged task passes, with the seed and both p values reported (`pBelow` < 0.01) |
| `724/judge.test.mjs` › a 1.5% rise passes: the margin is never under 2% | #724.dd2beb6a | It still reads PASS; the asserted margin of 2% is gone | `judge.test.mjs` › a 1.5% rise passes: the line is never under 2% (`pBelow` < 0.01) |
| `724/judge.test.mjs` › a 3% rise with a 0.4% spread fails: the margin is the larger of 2% and the spread, no wider | #724.dd2beb6a | It still reads FAIL; the margin assertions are gone | `judge.test.mjs` › a 3% rise with a 0.4% spread fails: the line is 2%, no higher (`pAbove` < 0.01) |
| `724/judge.test.mjs` › the pairs' spread widens the margin past 2%: a 5% rise within a 10% spread passes, a 13% rise over a 6% spread fails | #724's reading 1, not a criterion | #1405 reverses it: the spread no longer widens anything. Twenty pairs evenly from 0% to +10% (a 5% median) read FAIL under the sign-flip tests (their differences less 2% sum to +0.6 of a possible +0.7) | No redraft: #1405's own test `tests/acceptance/1405/judge.test.mjs` › *19 pairs at +15% and 1 at -5% read FAIL* covers the new expectation |
| `724/loaded.test.mjs` › at a load average above 40 on battery, a planted 20% rise in instructions fails its comparison with the merge base, with every pair attached | #724.2a0f8e22 | Its `reported()` asserts `spread` and the old `margin` | `loaded.test.mjs` › same name, with the same lane, plants and checks, minus margin and spread, plus the seed and both p values and `pAbove` < 0.01 |
| `724/loaded.test.mjs` › under the same load, an unchanged task passes its instruction comparison, with the margin and the pairs' spread reported | #724.dd2beb6a | As above | `loaded.test.mjs` › … with the seed and both p values reported (`pBelow` < 0.01) |
| `724/loaded.test.mjs` › under the same load, a planted 1.5% rise passes: the margin is the larger of 2% and the pairs' spread, never under 2% | #724.dd2beb6a | Its `reported()` and `margin >= 0.02` assert the old margin | `loaded.test.mjs` › … a planted 1.5% rise passes: the line is 2%, never under it (`pBelow` < 0.01) |

`loaded.test.mjs` replaces the whole of `724/loaded.test.mjs`'s three judged tests but shares nothing with its fourth: running both files means two lane runs.

## Kept as they are

These hold under #1405's rule:

- `724/judge.test.mjs` › a missing count is never zero…; a count of 0, or no pairs at all, is not a reading… (INCONCLUSIVE stays INCONCLUSIVE; `change` stays `null`, which #1405 doesn't touch).
- `724/loaded.test.mjs` › every result perf prints carries instructions retired, the counter they came from and the macOS build.
- `724/limits.test.mjs`: `unchanged-limited` (awk, pairs within ~1%) still reads PASS and `plus-20-limited` FAIL; its ms limit is untouched.
- `724/missing.test.mjs`, `724/counter.test.mjs`.

## On the base

The four judge redrafts fail on the base on "the seed is in the result". The three loaded redrafts failed elsewhere on the base run (15:42, load 315): perf was killed at #724's helper timeout, 600 s, before printing a task line, most likely waiting for the machine's timed grant, since #724's lane copies `scripts/throttle.mjs`. The original `724/loaded.test.mjs` shares that helper and would stall the same way on this Mac; their redrafted assertions haven't run. `BASE-FAILURE.txt` in `tests/acceptance/1405/` has the run.
