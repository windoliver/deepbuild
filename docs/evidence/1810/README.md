# #1810 evidence

`final-13a35ce37/`: `tests/acceptance/1810` on the Mac (Mac15,12, macOS 27.2.1), in a GitHub-only fresh clone at 13a35ce37. That is the final code head. The commits after it add only this folder and one entry in `scripts/known-failures.json` (0ca80ac97), with no code or test changes.

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
- `mac-log-pos-probe-8f2e51904.txt`: why 39 and 35 can differ. About 10 s after the status question, the hub writes 4 events (two `delivery.outcome` stalled, two `session.reading`) because the fixture's answers never reach an agent. When they land between the test's `deep status --json` read and the replica's copy of the record, the two log positions differ by 4. That code is main's (since 953b1dc40, 2026-11-10); this PR doesn't touch it.
- `linux-8a2a8a745.txt`: after the owner dropped the #2690 entry from `scripts/known-failures.json` (2026-11-18): the guard passes, and #1115's failures test passes 3/3.
