# Mac round 22af at 80086dcc6 (2026-11-20)

The MacBook Pro, Mac18,1 (Apple M6, 32 GiB), on AC power. At this head the Pro was not yet in #319's REFERENCE_MACS. The run used a fresh GitHub clone at #2097's head 80086dcc6 (merge base = main 86b99ac36), the same steps as 22ad (`run-22af.sh`), and nothing waited for load (5 to 145). The clone was removed afterwards. The scan finds 0 login-name hits and 0 email hits. Its 5 secret-pattern hits are the same `#an-ask-and-…` URL anchor as 22ad's. All 4 PNGs were checked by hand and show only fixture data.

| Part | Result |
| --- | --- |
| 1 deep-app | `--lib` **132/132**. The whole crate exits 101 on the **same 7 failures as 22ad** (main's six, plus 1141_memory AC1 INCONCLUSIVE off a reference Mac) |
| Setup | exit 0 |
| 2 e2e-app | exit 0, 3 PNGs |
| 3 sign-in | exit 0, 1 PNG (the full sign-in card) |
| 4 window suites | 1460/cli exit 0. 1459/identifier, 1459/panel, 1172/rows and 1172/panel exit 1 with "no reply to canvas.user within 10000 ms", the same as 22ad and main 9550dc0f0 |
| 5 suites | 318 27/27. 319-budgets 2 skipped (the Pro isn't a reference Mac at this head). 83-redraft-319 5/5. 1349 the same 12 failures as 22ad. 1345 AC8 only, the same as 22ad and main |
| 6 judge | exit 1, 535 s, verdict INVALID: #22.48b6696b PASS, #22.1f14a778 INCONCLUSIVE (319 budgets), #22.f57a814c PASS, **#22.3d85284a (#321) INVALID**. #321's body and test files are unchanged since 22ad, so INVALID means every #321 criterion came back with no test results. The likely cause is a missing vitest report in the judge's temporary checkout, written while free disk was at 20 to 26 GB. A direct rerun of `tests/acceptance/321/` in the same clone right after gave **9/9 pass, all 5 criteria** (`diag-321.json`, `diag-321.txt`). Round 22ag's judge at 9c7ecd658 read #321 PASS. The gh probe matched before and after; git status shows only the judge copy |
