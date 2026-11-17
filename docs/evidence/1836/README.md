# Evidence for #1836

The issue's Proof: a replayed Claude Code session with a subagent, through the real hub (`deep hub run` and the real
deep-hook binary), on the branch and on the merge base. Run by hand on the Spark (Linux, Node 24.22) from
`tests/acceptance/1836`, written blind (commit `37824538d`).

- `suite-branch.txt`: the branch. Both tests pass. In the turn a proceed started, after the subagent's
  `SubagentStop`, `gh pr merge 12` is held at PreToolUse by one authority ask naming the proceed. Under
  `DEEP_HUB_PLANT=proceed-ends-at-child-stop`, the merge runs and the check fails naming `gh pr merge 12`.
- `suite-merge.txt`: the branch with main `b1fc9abb2` merged, rebuilt: both pass again.
- `suite-final.txt`: the final head `37514122a` (main `f7d661d67` merged), at load 53: both pass. Three earlier runs at this head, at load 114 to 246, came back BLOCKED on deep-hook's 50 ms sync, which is no verdict.
- `affected-r8-summary.txt`: `node scripts/affected.mjs` at the final head, under an isolated HOME (the shared test slots were held by other runs). FAIL: 515 new, 45 already failing on main; the new ones are being sorted against main.
- `lint-vs-main.txt`: r8's 15 lint-lane sources, each lint's findings counted at the head against main `f7d661d67`: every count matches main, the color-literal lane once the app's served panel copies are in both trees.
- `suite-base.txt`: the merge base `c740dede7` with the same tests. The merge runs with no ask
  (deep-hook exits 0, nothing held), and the plant isn't there yet.
  It ran in the blind job's own worktree, at its commit `87b20a7c0`, which is `37824538d` before the cherry-pick
  onto this branch (the same tree under `tests/acceptance/1836`).
- `unit-before-fix.txt`: `packages/hub/test/holds.test.ts`'s new test before the fix: the gate returns nothing
  for the merge, so no ask holds it.

An earlier branch run under load average ~100 came back BLOCKED (deep-hook couldn't spool within its 50 ms) and
once INCONCLUSIVE (a late acknowledgement). Neither is a verdict; `suite-branch.txt` is the run on a quiet machine.
