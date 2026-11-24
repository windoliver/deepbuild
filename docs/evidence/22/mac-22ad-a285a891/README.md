# Mac round 22ad at a285a8913 (2026-11-20)

**Not the reference Mac.** This round ran on a MacBook Pro, Mac18,1 (Apple M6, 32 GiB), macOS 27.2, on AC power. The usual runner, the reference Mac15,12, was offline. Load ran from about 20 to 145 and nothing waited for it to drop. The run used a fresh GitHub clone at PR #2097's head a285a8913 (`git ls-remote` and `FETCH_HEAD` agree; merge base with main 9550dc0f0) and removed the clone afterwards. Parts ran in the same order and with the same commands as round 22ab (`run-22ad.sh`). The redaction pass leaves 0 login-name hits and 0 email hits. The secret scan's 5 pattern hits are all the same false positive: the URL anchor `#an-ask-and-your-answer-getting-back` matches `sk-…`. Each PNG was looked at by hand and shows only the app window over fixture data.

| Part | Result |
| --- | --- |
| 1 deep-app | `--lib` exit 0, **123 passed**. The whole crate exits 101 on 7 tests (`1b-failed-names.txt`): main's six (acceptance_1141 ac2/ac3, acceptance_34 ac11, hub_client ×3), plus `acceptance_1141_memory` AC1, which reports **INCONCLUSIVE because this isn't a reference Mac** (reading: 17.0 MB peak against 300 MB) |
| Setup | npm ci, the workspace build and deep-hook all exit 0 |
| 2 e2e-app | exit 0. Three PNGs plus `app-run.txt` |
| 3 sign-in | exit 0. `0-signin.png` shows the sign-in ask's full card (Your step, Sign in) |
| 4 window suites | 1460/cli exit 0. 1459/identifier, 1459/panel, 1172/rows and 1172/panel exit 1 with "no reply to canvas.user within 10000 ms", raised in `makeWorld` (the hub's canvas core, `terminal_open`) **before any app window opens**. So the front app isn't the cause, unlike what 22ab read. **Main 9550dc0f0 fails the same way** (`main-9550dc0f/`): 1459/identifier the same; 1172/panel timed out at 480 s on its first, build-included run and then failed the same in its rerun. These are #1459's and #1172's criteria and fail on main |
| 5 suites | 318: 27/27. 319-budgets: **2 skipped, INCONCLUSIVE off a reference Mac** (the test's own rule). 83-redraft-319: 5/5. 1349: 12 failed / 3 passed, **the same 12 as 22ab**. 1345: AC8 fails the same way as 22ab and 22ac ("the list has no row for ask:… to say when its recommended answer applies"); 22ac found this failure on main |
| 6 judge | exit 1, 550 s. **INCONCLUSIVE**: #22.48b6696b PASS, **#22.1f14a778 INCONCLUSIVE** (#319, whose budgets can only read on a reference Mac), #22.f57a814c PASS, #22.3d85284a PASS. `reopen` names #22.1f14a778, but the copy's `reopen()` returns at once. The gh probe matched before and after (#22 OPEN with 2 comments, #319 CLOSED with 1), and git status was clean afterwards |

## Front app

The Mac was in use. Windows App, Google Chrome, Claude, Terminal and the lock screen (`loginwindow`) were each in front at times (`exits.txt`; `4-front-samples.txt` and `main-9550dc0f/front-samples.txt` sample every 2 s). Finder was brought to the front before part 4. The window suites fail in `makeWorld` before a window exists, so the front app can't explain them.

## What a reference Mac still owes

#22.1f14a778 reads INCONCLUSIVE here only because #319's budgets need a reference Mac (Mac15,7 or Mac15,12). The 319 budgets passed on the reference Mac at 07587e38. A rerun of `tests/acceptance/319/budgets.test.ts` and the judge on a reference Mac (the Air) at a285a8913 would close it.

## Files

`exits.txt` (every step, with load, free disk and the front app), `machine.txt`, `1a`/`1b` (cargo), `setup.txt`, `e2e/`, `signin/`, `4-suites.txt`, `5-suites.txt`, `issues/` (the bodies the judge read), `readissue-precheck.txt`, `gh-probe.txt`, `judge.txt` (the criteria JSON), `judge.err` (empty), `git-status-after.txt`, `main-9550dc0f/` (the main comparison), `spine-22-mac-a285a891.mjs` (the judge copy: 4 diff lines from `scripts/spine.mjs`), and `run-22ad.sh` and `run-22ad-main.sh`.
