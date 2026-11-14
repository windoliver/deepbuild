# Baseline benchmark blocker: watchdog candidate remains unproven

**BLOCKED, not a completed fix.** This is a narrow attempt to unblock #1123's full Mac unit reading. It does not replace AC4 with sampled timing or change any existing check. The source candidate and new test fixtures remain uncommitted in the dedicated worktree; only this result record is published in #2321.

## Findings and implementation

- The independent blank-arm check was drafted from the issues/design/base, without seeing an implementation fix. Actual **unchanged base** `lists_1477 arm blank` passed: 947 measured frames and an independently observed active-window span of 8.961 s. Therefore the earlier stall was not sufficient evidence to rewrite the drawing algorithm.
- A new real-window regression requested hiding the owned benchmark after three seconds. Base exceeded its external 40-second deadline. The source confirmed that the 30-second watchdog protected only `frame < WARM_FRAMES`. However, that failed run never reached the hide-success assertion, and elapsed time does not establish 60 warm-up renders. It is evidence of a liveness failure, **not deterministic proof of hidden-after-warm-up coverage**.
- The uncommitted candidate in `crates/deep-app/lists_1477.rs` applies the same watchdog to **any unfinished arm**. On expiry it reports explicit `INCONCLUSIVE` with render, counted-paint and return-frame counts. It changes no measurement counters, durations or budgets. Review found the branch sound for a responsive UI thread, but code review is not passing behavioral proof; a blocked UI thread remains outside this watchdog's reach.

## Actual results, not a green claim

- Base normal shown-window regression: **1 passed** (~10.6 s).
- Base hide-at-three-seconds regression: **1 timeout failure** at the external 40-second deadline; exact post-warm-up and hide preconditions were not proven.
- Candidate benchmark build: **passed** using the repository's pinned Cargo toolchain and original release test target; only the watchdog source delta differs. Compilation alone is not a behavioral pass.
- First corrected hidden run: **failed setup evidence**, `hide()` returned false, so the intended hidden-window condition was not established. It completed at about 31.5 s; no expected value or timeout was changed.
- First corrected normal shown run: **INCONCLUSIVE**, finished at about 30.8 s with 2 renders, 0 counted paints, 0 return frames. This is not a measured pass.
- OS session probe then confirmed **locked=true, onConsole=true, loginDone=true**. The retained probe output contains only those booleans, not personal session fields; no security setting was changed. Screen lock is a missing test environment, not an implementation success.
- After the desktop became unlocked, the one-shot waiter ran both unchanged tests: **both failed**. The hide request again returned false; the shown arm returned `INCONCLUSIVE` after about 31.2 s with **174 renders / 115 counted paints**. The waiter ended, with no further automatic retries.
- An observation-only run returned `INCONCLUSIVE` with **320 renders / 261 counted paints**. Owned-window metadata showed the window remained on-screen but lost foreground activation after about two seconds. This establishes observed focus loss, **not that focus loss caused the stall**. No other apps' titles, pixels or inputs were captured.
- One controlled foreground attempt then ran the unchanged pair: **both failed**. The hide request still returned false; the shown arm reported **153 renders / 94 counted paints**, not a measured reading. There is no post-fix green result to select from these attempts.
- These environment investigations were not a completed exclusive timed reading. A subsequent exclusive timed request waited about 14.5 minutes without admission. When the screen was locked again, the request was cancelled by its verified PID/start/command before any test was admitted. All owned waiters, observer/helpers and benchmark processes from this attempt have ended; the throttle table contains no request or grant for the cancelled holder. No unrelated process was stopped.
- A fresh blind hidden-window draft adds active/visible and hide handshakes, but explicitly reports exact post-warm-up reachability **INCONCLUSIVE**: the public CLI gives no live painted-frame counter. It compiled and its missing-argument branch returned BLOCKED; actual base/change runs are **UNRUN**. It remains an unadopted external draft, not a replacement for a failing test.
- `affected.mjs --list` completed; **no WIDE or INCONCLUSIVE-prefixed selector lines**. It lists 9 timed and 6 slow Vitest files, plus parallel/alone/Cargo/manual work. None was executed by this command. The new standalone Node fixtures require a supplied executable argument and are not yet integrated into the normal affected runner. Selection and syntax checks are not PASS. No whole-unit retry was started.

## Scope and current state

The candidate is 7 additions/3 deletions, but its required unchanged passing regression is missing, so it is **not committed or pushed as a finished fix**. The independent tests and wrong-window fixtures remain unchanged. No existing tests, lane filters, goldens, baselines or criteria were edited. The unlock and activation investigations repeated the same binaries without another source correction; these extra diagnostic attempts and all their failures are disclosed, not counted as new passing verification. None substitutes for the full-unit proof.

The warm build cache was reused by copying the candidate benchmark source into the old temporary `full-pair/before` workspace. That workspace is therefore **no longer the original timing input**. Its original logs and separate baseline executable remain preserved. Do not resume the old recipe as an unchanged same-commit pair; any later comparison must freeze and verify both sides anew.

| Remaining requirement | What this attempt establishes | Still missing |
| --- | --- | --- |
| Bound the baseline benchmark stall | Successful candidate build; observed explicit 30-second INCONCLUSIVE completion, including after >60 renders | Deterministic base-red / unchanged candidate-green regression, normal shown measurement, qualified affected verification |
| #1123.273f1f14: complete alone-block before/after reading | Nothing new: the earlier 6 h 55 min partial full run remains INCONCLUSIVE | Both complete same-workload intervals; no sampled substitute was approved |
| Existing verification and trace | Earlier non-PASS results remain recorded | Applicable checks and criterion-tagged executed proof; no new green claim |
| Protected-change approval | Main and the worktree still lack `.deepbuild/approvers`; prior guard failures stand | Owner-established trust root and presence-backed signatures on exact commits |

Spark remains optional. #2321 is still the only PR, draft and **Part of #1123**; #1123 remains open. No auto-resume, merge, closing reference, approval signature or trust-list edit was performed.

Redacted outputs are in [watchdog-unblock/](watchdog-unblock/). Unabridged local build/run evidence remains in `/tmp/deep-1123-unblock/`; the unadopted blind draft remains in `/tmp/deep-1123-hidden-redraft/`. Those temporary paths are not portable proof. This report deliberately ends with the failures and unrun checks, not a completion claim.
