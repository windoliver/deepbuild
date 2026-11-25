# Mac round 22ah at dc12364fb (2026-11-20)

The MacBook Pro, Mac18,1 (Apple M6, 32 GiB), on AC power. At this head it is one of #319's reference Macs (REFERENCE_MACS, from 9c7ecd658). The run used a fresh GitHub clone at #2097's head dc12364fb (merge base main 7ba31d777), the same steps as 22af (`run-22ah.sh`), and nothing waited for load (8 to 210). The clone was removed afterwards. Before the judge, the clone's own incremental cache was removed and free disk checked: 147 GB, over the 40 GB asked. The scan finds 0 login-name hits and 0 email hits; its 5 secret-pattern hits are the usual `#an-ask-and-…` URL anchor.

| Part | Result |
| --- | --- |
| 1 deep-app | `--lib` **132/132**. The whole crate exits 101 on the **same 7 failures as 22af** (main's six, plus 1141_memory AC1) |
| Setup | exit 0 |
| 2 e2e-app | exit 0, and the CLI matches 22af (8 asks after the batch, 2 after "together"). **The window screenshots don't**: 1 and 2 show "Nothing needs you" and are pixel-identical. See "Window screenshots" below |
| 3 sign-in | exit 0. The first run's screenshot shows the list without the card open. The low-load rerun (`rerun/signin/0-signin.png`) shows the full sign-in card, as in 22af |
| 4 window suites | 1460/cli exit 0. 1459/identifier, 1459/panel, 1172/rows and 1172/panel exit 1 with the same "no reply to canvas.user" errors as 22af and main |
| 5 suites | 318 27/27. **319 budgets 2/2 PASS** (create p50 2.0–2.2 ms against 5, answer 4.2–4.8 ms against 5, inbox 0.8–1.2 ms against 100). 83-redraft-319 5/5. 1349 and 1345 have the same failures as 22af (diff empty) |
| 6 judge | **exit 0, 416 s, PASS**: #22.48b6696b, #22.1f14a778, #22.f57a814c and #22.3d85284a all PASS. The gh probe matched before and after; git status shows only the judge copy |

## Window screenshots

The e2e tests assert on the CLI, not the window, so only the pictures show this. In the main run (load about 190) and again in a low-load rerun (`rerun/`, load about 14), the app window was covered by other apps. Its screenshots 1 and 2 kept the pre-batch picture: "Nothing needs you", the same row ages, identical pixels. Meanwhile `deep inbox` listed 8 and then 2 asks. 22af shows the same freeze one step later: its screenshots 1 and 2 are identical, with 8 asks at "54 s", while the CLI went from 8 to 2.

A third run (`rerun-front/`) raised deep-app to the front every second; `front-samples.txt` shows deep-app in front for 61 of 68 samples. In that run, screenshot 1 showed all asks and screenshot 2 the remainder, each matching `deep inbox` row for row. So the window stops redrawing while covered and redraws when visible. This is an artifact of the environment, not a regression at this head.

That run's two PNGs are **withheld**. While the loop kept deep-app in front, text the owner was typing elsewhere landed in the app's New task box and was sent, which added a sign-in row and a task to that test's throwaway home. The PNGs show that text, and `app-run.txt` holds its 9th row (no personal text in it). Read `app-run.txt` as 8 asks plus that one.
