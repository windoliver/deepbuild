# Screenshot check, 22v-97fffed5

I opened each PNG and compared it with the run log next to it. Both images are captures of the deep-app window only (`screencapture -l <window>`), so the macOS menu bar, and any menu-bar number, is not in either picture.

## signin-fail/0-signin.png (old commit fe56c134, before the fix)

**What it shows:** The deep-app window, not cropped, and neither black nor blank. The traffic lights are coloured, so the window is focused. The sidebar shows "Needs you", then a project header "repod669" with two task rows under it, each with a brown square marker:
- "Pick a header colour for th…", 9 s
- "Add a README line, then s…", 9 s

There are no ask rows under "Needs you". No row mentions signing in, and none has "Sign in to Claude Code again?" text. The main pane shows "New task" and "Nothing needs you", with an empty composer and a Send button. The window shows no counts.

**Log lines compared** (signin-fail/signin-run.txt):
- `$ deep inbox    # 2026-11-16T01:46:38.856Z` → `Nothing needs you`
- `sign-in task ask:01M7H0HPY61GV1MHQ57T6K1NZK "Sign in to Claude Code again? …": inbox held, hub list not listed`
- `taste call ask:01M7H0HPQJMJJ3ZHGCFH523RQP: inbox queued, hub list not listed`
- `   screenshot 0-signin.png (window 25280)`

From signin-fail/vitest.txt: `AssertionError: the sign-in task shows at once and the hub lists it: expected [ 'held', false ] to deeply equal [ 'shown', true ]`, `Tests  1 failed (1)`.

**Against the log:** It matches. The log says the inbox is empty and the sign-in ask is held, not shown. The picture has no ask rows and says "Nothing needs you". The two task rows are the agents' tasks (the README task, which probably carries the sign-in ask, and the header-colour taste task), not Needs you asks.

**Against the expected result:** It matches. The test fails, and the screenshot has no sign-in row.

**Verdict: MATCHES**

## e2e/0-before-batch.png (head 97fffed5)

**What it shows:** The deep-app window, not cropped, and neither black nor blank. The traffic lights are grey, so the window was not focused, which is fine. The sidebar shows "Needs you", then "repoeb38", then "No project" with three task rows, each with a brown square marker:
- "Pick header… · 97fa1d5f", 8 s
- "Pick heade… · 104464e0", 8 s
- "Pick heade… · 8ba5034d", 7 s

There are no ask rows under "Needs you". The main pane shows "New task" and "Nothing needs you", with an empty composer and a Send button. The window shows no counts.

**Log lines compared** (e2e/app-run.txt):
- `$ deep inbox    # before the batch, 2026-11-16T01:53:10.658Z` → `Nothing needs you`
- `   screenshot 0-before-batch.png (window 25331)`

The sessions in the picture are the same ones the later inbox lists under repoeb38: `97fa1d5f-…` (A1), `104464e0-…` (B1) and `8ba5034d-…` (D1–D5 and the exception ask). The asks only appeared "after the 2026-11-16T01:54:00.000Z batch", which is after this screenshot.

**Against the log:** It matches. The inbox is empty before the batch, and the picture shows no ask rows. The three sessions are visible as tasks, not as asks.

**Against the expected result:** It matches. Needs you is empty before the batch time.

One oddity in the layout: the three sessions sit under "No project", while the later inbox lines name repoeb38 for them, and the "repoeb38" header has no rows under it. This does not affect the before-batch claim. I have not checked whether it is intended.

**Verdict: MATCHES**

## Missing PNGs

These were not taken. The run BLOCKED, so their absence is not a failure of any picture:
- e2e/1-needs-you.png. e2e/vitest.txt: `Error: BLOCKED: no on-screen window for deep-app pid 36351, so 1-needs-you.png wasn't taken (0 windows 129 onscreen 7 app's ["0/-1", …])`
- e2e/2-after-bulk-answer.png. The run never got this far, because it stopped at the BLOCKED step above.

No image proves the after-batch state: the 8 asks the log lists, and the bulk answer. Only the log text shows the 8 asks.
