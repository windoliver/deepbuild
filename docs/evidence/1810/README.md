# #1810 evidence

`final-13a35ce37/`: `tests/acceptance/1810` on the Mac (Mac15,12, macOS 27.2.1), in a GitHub-only fresh clone at 13a35ce37. It was the code head then. Later heads merged main twice (444c638cd, 8f2e51904) with no change to this PR's code, added and then dropped a `scripts/known-failures.json` entry (0ca80ac97, 8a2a8a745), and added evidence; their runs are listed at the end.

- Setup exit 0: `npm ci`, the workspace build, `deep-hook`, and `deep-drive` prebuilt.
- 12 of 13 tests pass, including both `count.test.ts` tests (#1810.eebcb4a2, the replica's list on macOS among them), `defaulted.test.ts` (#1810.a646c123) and `width.test.ts` (#1810.1a3e8cda).
- The one failure is in the blind redraft `redraft-replica/list.test.ts`, written for criterion 1 in 61eb9d40a, and it has one failing line: the open ask's row node "lacks its word "needs you"". The app draws the ask's kind there (#1461 AC27), while the hub's row says "needs you". That mismatch is #2690, and it is there at the base too.
- The original draft passes and the redraft fails, so under the design's Dogfooding rule this dispute goes to the owner once, with both drafts and this output. On 2026-11-16 the owner moved the redraft's word check to #2690 and waived criterion 1's "the base says 3" clause, which #1463 had already made untrue (BASE-FAILURE.txt).
- After the run the clone's working tree was clean, and the secret scan found nothing.

`linux-13a35ce37.txt`: the same suite and the proof guard on Linux at 13a35ce37. 11 tests pass; the two replica tests are BLOCKED because they draw on macOS only, and they pass in the Mac run above.

`guard-0ca80ac97.txt`: the proof guard at 0ca80ac97, the commit that adds the known-failures entry.

`unit-tests-13a35ce37.txt`: its second line, on the two timing budgets that ran over in an earlier run, is a note written by hand. That run's output was not kept, so those two readings have no output here.

`main-comparison.txt`: the lint lines at its end are counts written by hand from the two runs' FAIL lines, not the runs' output.

At the later heads, after merging main:
- `linux-444c638cd.txt`, `unit-tests-444c638cd.txt`, `final-444c638cd/` (Mac): 444c638cd, main 0f34aacbe merged. Mac 12/13, the one failure the #2690 line.
- `main-comparison-444c638cd.txt`: the affected run at 444c638cd and each of its new failures checked at main 0f34aacbe.
- `linux-8f2e51904.txt`, `unit-tests-8f2e51904.txt`, `final-8f2e51904/` (Mac): 8f2e51904, main 79bf7e203 merged. Mac 11/13: the #2690 line, and count.test.ts's replica read at log_pos 39 where `deep status --json` said 35.
- `linux-log-pos-probe-8f2e51904.txt`: a probe on Linux showing why 39 and 35 can differ. About 10 s after the status question, the hub writes 4 events (two `delivery.outcome` stalled, two `session.reading`) because the fixture's answers never reach an agent. When they land between the test's `deep status --json` read and the replica's copy of the record, the two log positions differ by 4. That code is main's (since 953b1dc40, 2026-11-10); this PR doesn't touch it.
- `linux-8a2a8a745.txt`: after the owner dropped the #2690 entry from `scripts/known-failures.json` (2026-11-18): the guard passes, and #1115's failures test passes 3/3.
- `linux-1d626e5d8.txt`, `final-1d626e5d8/` (Mac): 1d626e5d8, main 9550dc0f0 merged (the owner's merge for the throttle fix). Linux: guard PASS (23 commits), acceptance 11 pass with the 2 replica tests BLOCKED, unit tests 86/86. Mac: 12/13; both `count.test.ts` tests pass (the race didn't recur), and the redraft reads "deep status --json at 35 and 35; the app's list at 35", counting 1, failing only the #2690 word line.
- `linux-log-pos-repeat-1d626e5d8.txt`: the probe five times at 1d626e5d8. Every run moves 35→39 by the same 4 events, with the same ask rows at both positions and every count at 1. So the count is never wrong; two readers that read at different moments see different log positions. That is the test's timing, not the product.
- `linux-log-pos-probe-main-9550dc0f0.txt`: the same probe at main 9550dc0f0. Runs 1-4 behave the same (4 events, counts 1). Run 5 is void: at load 228 the hook gave no answer.
- `affected-1d626e5d8.txt`, `main-comparison-1d626e5d8.txt`: the affected run at 1d626e5d8 on the PR's own diff ("346 new"), and each new failing test file run alone at main 9550dc0f0 and at the head. Of 187 files, 184 exit the same at both, 3 fail at main and pass at the head, and none fail only at the head. The lints match apart from `core.ts`'s +2 over a ceiling main already exceeds, plus git-ignored panel build output in the head tree.
