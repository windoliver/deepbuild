# #2699 evidence: a stop whose checks all carry makes no checkout

Runs on the owner's Mac (Node 24.22.0), 2026-11-19. Load was high throughout: other sessions' suites took it from 30 to about 280, and each file's first line gives the load at its start. Temporary paths and session IDs in the captures are from throwaway worlds.

## Requirement → change → proof

| Criterion | Change | Proof |
|---|---|---|
| AC1: a stop after a turn that ran `git status` and one shell command, changing no file, on a tree whose last claim ended every check, makes no checkout. Its verdict and runs equal the merge base's; on the merge base it makes one, and the test fails naming it | `GateRunner.stop` (packages/hub/src/gate-runner.ts) no longer needs the hooks' `same` hint. After the snapshot it asks the carry's question: the last claim has this tree and HEAD, and every check carries a result that ended on a claim of this tree (or is a prerequisite). When all of that holds, no checkout is made | `tests/acceptance/2699/unchanged.test.ts` AC1 passes on the change (`acceptance-2699-change.txt`) and fails on the base, naming the checkout `c-…` (`tests/acceptance/2699/BASE-FAILURE.txt`). By hand on a real hub: `e2e-change.txt` (no checkout entry, 0 files, no run, PASS carried) against `e2e-base.txt` (checkout `c-AqjW90` made, 1,095 files written and removed, no run, same PASS carried) |
| AC2: that stop writes no file under the checkouts' folder and starts no process beyond the snapshot's | Same | `unchanged.test.ts` AC2 passes on the change and fails on the base (BASE-FAILURE.txt: the checkout's files; 7 git processes beyond the reads-only stop's, among them `read-tree`, `ls-tree` and `checkout-index`) |
| AC3: a one-byte change makes its checkout and runs its checks. A planted runner that skips the checkout whenever the last claim passed fails, naming the file | A changed tree fails the "same tree and HEAD" test, so the claim takes a checkout as before | `changed-byte.test.ts` passes on the change. On twin `skips-checkout-when-passed` it fails naming `src/price.cjs` (`twin-skips-checkout-when-passed.txt`) |
| AC4: on an unchanged tree, a check that hadn't ended, and a check whose recorded reads changed, each make their checkout and run that check. A planted runner that looks at the tree alone fails, naming the check | A check with no ended result on a claim of this tree finds nothing to carry. A new state reading folds into the tree (#67). Either way the claim takes its checkout | Both `inputs-changed.test.ts` tests pass on the change. On twin `looks-at-tree-alone` they fail naming `price` and `state` (`twin-looks-at-tree-alone.txt`) |
| AC5: `tests/acceptance/45/` and `tests/acceptance/33/` pass unchanged | No edit to either | **45/**: 13 files, 37 passed, 4 skipped (`acceptance-45-change.txt`). The skips are private data and "not a reference Mac". **33/**: not proven here. On the change, 10 tests failed (`acceptance-33-change.txt`); on the merge base, with the same three files reverted, 9 failed (`acceptance-33-base.txt`), and those 9 are the same tests on both. They are this Mac's: no pytest, approval tags not fetched, #13's commit not in this checkout's history, the pr-needs-ask guard, and `mode-hub-killed` read as INCONCLUSIVE. The 10th, `numeric.test.ts`, failed twice on the change at load 50–90, each time on a different case (`acceptance-33-numeric-change-rerun1.txt`). It passed on the base at load 81 and on the change twice at load 34 and below (`…-rerun2.txt`, `…-rerun3.txt`). Its two cases also passed alone on the change, three runs of three. Each kit play is one stop in a world of its own, so a claim there never has a prior claim and the new path can't be taken |

Other checks: the hub unit tests that drive the gate runner (`hub-unit-change.txt`, 9 files, 79 tests) and `tests/acceptance/2078/` (`acceptance-2078-change.txt`, 4 of 4: an outside edit, a moved HEAD and the snapshot budget still get their checkout or INCONCLUSIVE). The root `tsc --noEmit` reports no error in the files this change touches.

## The manual run

`e2e-driver.test.ts` is the driver, a scratch Vitest file kept here for reference and not part of any lane. It uses #2078's helpers: a real `deep hub run`, the real deep-hook and #82's Claude Code stand-in on #31's sample repo. The session's first stop makes a claim whose check passes. The next turn makes two Bash calls through the hooks, `git status` and `ls src`, each run for real in the worktree, and changes no file. Then it stops. A recursive `fs.watch` on the hub's `checkouts` folder counts what the second stop makes.

- `e2e-change.txt` is from the merged head. The second claim is PASS and carries both runs from the first claim; no run starts, the watch is armed, nothing is made and 0 files are written.
- `e2e-base.txt` is the merge base's three files over the same tree. The verdict and runs are the same, but checkout `c-AqjW90` is made, 1,095 files are written and the folder is given back.

## Timing

Not timed. The issue says it was "not timed", and no criterion sets a budget.
