# Screenshot check, 22w-97fffed5 (and two from 22v-97fffed5)

I opened each PNG myself and compared it with the run log written at the same moment and with the expected result. All six images are captures of the deep-app window alone (`screencapture -l <window>`), 1920 wide. None is black, blank, cropped or the wrong window. Sidebar ask rows are cut short by the column width, so I can read only the start of each question.

| PNG | Expected | Verdict |
|---|---|---|
| 22w-97fffed5/e2e/0-before-batch.png | Needs you empty before the batch | MATCHES |
| 22w-97fffed5/e2e/1-needs-you.png | 8 rows after the batch, D6 folded into "This session keeps asking…" | MATCHES |
| 22w-97fffed5/e2e/2-after-bulk-answer.png | after "together", only A1 and B1, count 2 | MATCHES |
| 22w-97fffed5/signin/0-signin.png | PASS; sign-in row shown, no T1 row | MATCHES |
| 22v-97fffed5/signin-fail/0-signin.png | old commit fe56c134: no sign-in row | MATCHES |
| 22v-97fffed5/e2e/0-before-batch.png | Needs you empty | MATCHES |

The 22w runs passed: 22w-97fffed5/e2e/vitest.txt `Tests  1 passed (1)` (start 18:22:35), 22w-97fffed5/signin/vitest.txt `Tests  1 passed (1)` (start 18:28:19). The PNG file times (18:27, 18:28) fall inside these runs.

## 22w-97fffed5/e2e/0-before-batch.png

**What it shows:** The window is focused (coloured traffic lights). In the sidebar, "Needs you" has no count and no rows under it. Below that is the project header "repo3478" with three task rows, each with a brown square: "Pick heade… · 6e7db0b6" 9 s, "Pick heade… · 401e4795" 9 s, "Pick heade… · 966e2061" 8 s. The main pane reads "New task" and "Nothing needs you", with an empty composer and a Send button.

**Log** (22w-97fffed5/e2e/app-run.txt):
- `$ deep inbox    # before the batch, 2026-11-16T02:27:12.776Z` → `Nothing needs you`
- `   screenshot 0-before-batch.png (window 25512)`

The three session ids are the ones the later inbox gives for A1 (`6e7db0b6-…`), B1 (`401e4795-…`) and D1–D5 plus the exception (`966e2061-…`). They show here as tasks, not asks.

**Against the log and expected result:** No ask rows, and the pane says "Nothing needs you", which agrees with the log. Needs you is empty before the batch time (02:28:00Z).

**Verdict: MATCHES**

## 22w-97fffed5/e2e/1-needs-you.png

**What it shows:** It is the same window (25512) and it is focused. "Needs you" has a count of **8**, and these eight rows sit under it, each with a brown square:
1. "A1: whi…" How it looks, Wed 18:27
2. "B1: whi…" How it looks, Wed 18:27
3. "D1: whi…" How it looks, Wed 18:27
4. "D2: whi…" How it looks, Wed 18:27
5. "D3: whi…" How it looks, Wed 18:27
6. "D4: whi…" How it looks, Wed 18:27
7. "D5: whi…" How it looks, Wed 18:27
8. "This sessio…" Problem, Wed 18:27

There is no D6 row. Under "repo3478" the same three tasks show (6e7db0b6, 401e4795, 966e2061), each at 1 min. The main pane reads "8 asks need you".

**Log:** `$ deep inbox    # after the 2026-11-16T02:28:00.000Z batch` lists A1, B1 and D1–D5 (`taste`), each with `If you don't answer: Green header, on Wed 18 Nov at 18:27`. It then lists `This session keeps asking: answer its asks together, pause it, or leave them to their defaults?  exception  … 966e2061-…  … ask:01M7H2W1KCGK4YGTNWDJXWXCHN`, and ends with `8 asks need you`, then `   screenshot 1-needs-you.png (window 25512)`. No D6 line appears.

**Against the log and expected result:** Rows, order, count (8), deadline "Wed 18:27" and the main-pane text all agree with the log. D6 does not appear on its own and the exception row is there, as expected. The question text is cut short ("A1: whi", "This sessio"), so the picture alone does not show the full wording. The prefixes and labels (taste rows read "How it looks", the exception row reads "Problem") agree with the log.

**Verdict: MATCHES**

## 22w-97fffed5/e2e/2-after-bulk-answer.png

**What it shows:** The same window, focused. "Needs you" has a count of **2**, with two rows: "A1: whi…" How it looks, Wed 18:27 and "B1: whi…" How it looks, Wed 18:27. Under "repo3478" are "Pick head… · 6e7db0b6" 1 min and "Pick head… · 401e4795" 1 min, then a grey-square row "1 quiet session", quiet, 38 s. The 966e2061 task row is gone. The main pane reads "2 asks need you". The composer shows no text cursor this time.

**Log:**
- `$ deep inbox answer ask:01M7H2W1KCGK4YGTNWDJXWXCHN together` → `ask:01M7H2W1KCGK4YGTNWDJXWXCHN answered together; no decision saved (exit 0)`
- `$ deep inbox` lists only A1 and B1, then `2 asks need you`, then `   screenshot 2-after-bulk-answer.png (window 25512)`

**Against the log and expected result:** After the "together" answer, D1–D5 and the exception row are gone. Only A1 and B1 remain, the count is 2, and the picture agrees with the log.

**Not covered by the log:** The D session (966e2061) now shows as "1 quiet session" rather than a task row. The log says nothing about the session's state, so I cannot confirm from the log that this is the intended look. It does not touch the expected claims.

**Verdict: MATCHES**

## 22w-97fffed5/signin/0-signin.png

**What it shows:** The window is focused. "Needs you" has a count of **1**, with one row: "Sign in to (…" (cut short), Your step, Tue 18:28. Under "repobaff" are two task rows: "Pick a header colour for th…" 8 s and "Add a README line, then s…" 8 s. The main pane reads "1 ask needs you". No ask row for the header-colour taste call is in Needs you. The header-colour line is only the agent's task under the project.

**Log** (22w-97fffed5/signin/signin-run.txt):
- `$ deep inbox    # 2026-11-16T02:28:31.144Z` → `Sign in to Claude Code again? Your sign-in lapsed. The work waits, and nothing is lost.  unblock  repobaff  … If you don't answer: Leave it blocked, on Tue 17 Nov at 18:28  ask:01M7H2YCB5W37JK78HZQC3EPBF`, then `1 ask needs you`
- `sign-in task ask:01M7H2YCB5W37JK78HZQC3EPBF "Sign in to Claude Code again? …": inbox shown, hub list listed`
- `taste call ask:01M7H2YC4B0DQ6A46V81DVGCAG: inbox queued, hub list not listed`
- `   screenshot 0-signin.png (window 25527)`

22w-97fffed5/signin/vitest.txt: `✓ signin 15499ms`, `Tests  1 passed (1)`.

**Against the log and expected result:** The run passed. The one row in Needs you is the sign-in ask, and its deadline (Tue 18:28) agrees with the log's `Tue 17 Nov at 18:28`. The taste call is queued and has no row. The full text "Sign in to Claude Code again?…" is cut to "Sign in to (" in the picture, so the wording rests on the log. The start of the row and the "Your step" label agree with an unblock ask.

**Verdict: MATCHES**

## 22v-97fffed5/signin-fail/0-signin.png (old commit fe56c134)

**What it shows:** The window is focused. "Needs you" has no count and no rows. Under "repod669" are two task rows: "Pick a header colour for th…" 9 s and "Add a README line, then s…" 9 s. The main pane reads "Nothing needs you". Nothing in the picture mentions signing in.

**Log** (22v-97fffed5/signin-fail/signin-run.txt):
- `$ deep inbox    # 2026-11-16T01:46:38.856Z` → `Nothing needs you`
- `sign-in task ask:01M7H0HPY61GV1MHQ57T6K1NZK "Sign in to Claude Code again? …": inbox held, hub list not listed`
- `taste call ask:01M7H0HPQJMJJ3ZHGCFH523RQP: inbox queued, hub list not listed`
- `   screenshot 0-signin.png (window 25280)`

22v-97fffed5/signin-fail/vitest.txt: `AssertionError: the sign-in task shows at once and the hub lists it: expected [ 'held', false ] to deeply equal [ 'shown', true ]`, `Tests  1 failed (1)`.

**Against the log and expected result:** At the old commit the sign-in ask is held, and the picture shows no sign-in row, as expected. The test fails for the expected reason. I agree with the earlier check in 22v-97fffed5/SCREENSHOT-CHECK.md.

**Verdict: MATCHES**

## 22v-97fffed5/e2e/0-before-batch.png

**What it shows:** The traffic lights are grey, so the window was not focused, which does not matter here. "Needs you" has no count and no rows. Next comes a "repoeb38" header with no rows, then "No project" with three task rows: "Pick header… · 97fa1d5f" 8 s, "Pick heade… · 104464e0" 8 s, "Pick heade… · 8ba5034d" 7 s. The main pane reads "Nothing needs you".

**Log** (22v-97fffed5/e2e/app-run.txt):
- `$ deep inbox    # before the batch, 2026-11-16T01:53:10.658Z` → `Nothing needs you`
- `   screenshot 0-before-batch.png (window 25331)`

**Against the log and expected result:** Needs you is empty, as the log says and as expected. I agree with the earlier check.

**Side note (not a verdict change):** In 22v the three sessions sit under "No project" while the inbox later names them repoeb38. In 22w, at the same head 97fffed5, they sit under "repo3478" as the log names them. So the 22v grouping looks like a timing difference in when the project was known, not a fixed behaviour. I have not checked the cause. 22v's e2e run itself BLOCKED before 1-needs-you.png (22v-97fffed5/e2e/vitest.txt: `BLOCKED: no on-screen window for deep-app pid 36351, so 1-needs-you.png wasn't taken`). The 22w run now supplies those two pictures.

**Verdict: MATCHES**
