# Mac round 22ag at 9c7ecd658 (2026-11-20)

The MacBook Pro, Mac18,1 (Apple M6, 32 GiB), on AC power. This head adds the Mac17,10 and the Mac18,1 to #319's REFERENCE_MACS (commit 9c7ecd658; it still needs the owner's tag). The run used a fresh GitHub clone at #2097's head 9c7ecd658 and started right after 22af ended, with no wait for load (see `exits.txt`; thermal state is in `exits.txt` and the 319 start line). The clone was removed afterwards. The scan finds 0 login-name hits and 0 email hits; its 5 secret-pattern hits are the same URL-anchor false positive.

| Step | Result |
| --- | --- |
| Setup | npm ci, the workspace build and deep-hook all exit 0 |
| 319 budgets | **2/2 PASS**. Create p50 1.0–1.2 ms against 5 ms. Answer p50 4.0–4.4 ms against 5 ms (9% margin). Inbox with 10,000 asks 0.64–1.5 ms against 100 ms |
| Judge | **exit 0, 532 s, PASS**: #22.48b6696b, #22.1f14a778, #22.f57a814c and #22.3d85284a all PASS. The copy pins #22 to 9c7ecd658 and its reopen() returns at once. The gh probe matched before and after (#22 OPEN with 2 comments, #319 CLOSED with 1). git status shows only the judge copy |

22ag covers only setup, 319 budgets and the judge. Every other step was run in 22af at 80086dcc6. Between the two heads, 7c87c9f15 marks two row keys in notify.rs as copy exceptions, which nothing else in the round ran against.
