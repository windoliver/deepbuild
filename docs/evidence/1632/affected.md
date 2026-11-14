# #1632: `node scripts/affected.mjs`

Run on the Linux dev box at f02c5924 (the branch on main f76eec87), 17,362 s at load 14:

```text
FAIL affected: 449 new, 19 already failing on main, 398 inconclusive or blocked, 21 listed skips, 2077 passed
```

**WIDE:** none printed. **INCONCLUSIVE:** 65 timed files, which run only under `--timed` (this suite's
`budgets.test.ts` among them, off the reference Mac in any case), 36 slow files (`--slow`), and the platform readings
the suites mark themselves: reference-Mac budgets, macOS-only login service, GPU, and the replica/canvas suites of #124
and #806.

`scripts/known-failures.json` lags main, so the "new" failures were checked against a build of the merge base f76eec87:

- 159 of the lines are repo-wide lints of files this branch doesn't touch: `secrets`, `deps`, `cards`, `canvas-lint`,
  `slots`/`slot` kits, `drift`, `guide`, and `cargo -p deep-app` acceptance tests.
- The other 290 were failures in 176 test files. All 176 were run at the merge base, and 33 failures were seen only on the branch. Those
  24 files were run again on both trees, one file at a time with two workers. 23 failed identically on both (or
  passed on both). The one difference, `tests/acceptance/159/plan.test.ts` AC20's planted runner, then passed and
  failed in turn on each tree (branch: pass, fail; base: fail, pass), so it is flaky, not a regression.

No failure is attributable to this change.
