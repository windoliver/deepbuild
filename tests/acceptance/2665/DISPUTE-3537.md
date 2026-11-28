# Dispute under #3537: `lowering.test.mjs` (#2665's first criterion, the lowering that passes)

#3537 lets a change lower a ceiling only on a task that reports `work`, and only when the runs the ceiling is judged
on report what the merge base's runs report. Its third criterion says so of this suite's own: "With `work` reported
and equal on both sides, it passes as #2665's first criterion has it." This file's scene lowers the `peakBytes`
ceilings of `held` and `tight`, whose commands print no report, so neither reports `work`, and on the right program
the lowering is refused. Run on #3537's change, where main without it passes:

```
#2665.54342405: held didn't pass on <sha>, which lowers its peakBytes limit from 9961472 to 2829964: {"id":"held","state":"BLOCKED","note":"held lowers its peakBytes ceiling from 9961472 to 2829964 on runs that report no work, where the merge base's runs report no work. A ceiling is lowered only on a task that reports work, by runs that report what the merge base's runs report", …
```

The criterion still holds under #3537, read with `work` reported and the same on both sides. The file's other three
tests pass on the change; the swap is by file, so they are carried into the redraft as they are.

The blind redraft that runs in this file's place is `tests/acceptance/2665-redraft-3537/`. Its `held` and `tight`
end by printing `{"work":{"rounds":20000}}`, and nothing else of the scene changes, so it holds the criterion on main
and under #3537. Each file once:

- `2665-redraft-3537/lowering.test.mjs`: on the change 4 pass, 0 fail; on main without it 4 pass, 0 fail.
- `2665/lowering.test.mjs`: on the change 3 pass, 1 fail, the test above.

The original file moves to the by-hand list (`scripts/lanes-lists.mjs`) until the owner rules on the swap.
