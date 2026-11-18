# Mac round 22ab at 4d7224ce5 (2026-11-18)

Reference Mac (Mac15,12, M3, macOS 27.2.1), on AC power at thermal state 1. Load ranged from 7 to 120 and nothing waited for it to drop. The run used an isolated clone, checked against PR #2097's head 4d7224ce5 (origin/main f17fa347c, merge base d4cef00fb), and removed it afterwards. The runner reported a secret scan of 0 and 0 login-name hits; a second scan here also found none. Two empty files were left out: the gh precheck and the judge's stderr.

| Part | Result |
| --- | --- |
| 1 deep-app | `--lib` exit 0, 119 passed. The whole crate exits 101 on 6 tests in acceptance_1141, acceptance_34 and hub_client (`1b-failed-names.txt`), the same six main fails |
| Setup | npm ci, the workspace build and deep-hook all exit 0 |
| 2 e2e-app | exit 0. Three PNGs plus `app-run.txt` |
| 3 sign-in | exit 0. `0-signin.png` |
| 4 window suites | 1460/cli exit 0. 1459/identifier, 1459/panel, 1172/rows and 1172/panel exit 1, each with "no reply to canvas.user within 10000 ms" in makeWorld before any assertion. Windows App was in front for the whole part. **These four were not judged on the window**: they are not read as code failures, and not as passes either |
| 5 suites | 318 got 27/27. 319-budgets: 1 passed, 1 skipped by itself (a p50 sample of 11.155 ms against 5). 83-redraft-319 got 5/5. 1349 failed the same 12 tests as round 22aa at 4c5617fe. **1345 AC8 failed** (see below) |
| 6 judge | exit 0, 636 s. **PASS** on #22.48b6696b, #22.1f14a778, #22.f57a814c and #22.3d85284a; reopen is null. The gh probe matched before and after, and git status was clean afterwards |
| 7 screenshots | `SCREENSHOT-CHECK.md`, written by a separate agent. Its notes: an extra "1 quiet session" row after the bulk answer, and the sign-in PNG shows the sign-in ask as a row rather than a separate screen |

## 1345 AC8

AC8 checks that each row says when its recommended answer applies. It failed with "the list has no row for ask:… to say when its recommended answer applies" on all five calls. The card's rows and the Needs you count were correct; only the list's `ask:…:time` nodes were missing. The same test passed at 4c5617fe (round 22aa) and at 97fffed5.

Since 22aa this branch took main d4cef00fb in a merge (it includes #1482's cached row views) and four fold commits. Round 22ac runs 1345's batch file at the merge 3f2f86464 and at main f17fa347c to show which change caused it. Until it reports, AC8 is open.
