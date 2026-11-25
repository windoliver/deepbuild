# Screenshot check: Mac run 22ab, commit 4d7224ce (issue #22, "Needs you" list)

Sources: e2e/app-run.txt, e2e/vitest.txt, signin/signin-run.txt, signin/vitest.txt and the four PNGs. No personal data appears in any image. None of the images shows error text.

## e2e/0-before-batch.png

- **On screen:** The deep-app window is present and fully on screen. The sidebar has a "Needs you" heading with no count and no rows under it. Below that is the project group "repo220b" with three task rows, each "Pick header colours for the checko…" (clipped at the sidebar edge). The main pane shows "New task" and "Nothing needs you", plus an empty composer with Send.
- **Log says:** `deep inbox` before the batch printed "Nothing needs you".
- **Agree:** yes.

## e2e/1-needs-you.png

- **On screen:** The window is present. The "Needs you" heading shows a count of 8. There are 8 rows: A1, B1, D1, D2, D3, D4 and D5, each "…: which header colour for this ch…", and "This session keeps asking: answer…". There is no D6 row. The repo220b group still shows its three "Pick header colours…" task rows. The main pane says "8 asks need you".
- **Log says:** 8 asks: A1, B1, D1 to D5, and the exception ask "This session keeps asking…" from the D session, then "8 asks need you". D6 is not listed.
- **Agree:** yes. The rows, their order and the count all match.

## e2e/2-after-bulk-answer.png

- **On screen:** The window is present. The "Needs you" heading shows a count of 2, with rows A1 and B1. The main pane says "2 asks need you". The repo220b group now shows two "Pick header colours…" task rows and a new grey row reading "1 quiet session · quiet · 31 s".
- **Log says:** `deep inbox answer … together` exited 0 and printed "no decision saved". After that, `deep inbox` listed A1 and B1 and printed "2 asks need you".
- **Agree:** yes. The log does not mention the task row that changed into "1 quiet session". This fits the D session going quiet after its asks were answered together, but the log does not confirm it.

## signin/0-signin.png

- **On screen:** The window is present. The "Needs you" heading shows a count of 1, with one row: "Sign in to Claude Code again? Your…" (clipped). Below is the project group "repo47e2" with two task rows: "Pick a header colour for the checko…" and "Add a README line, then stop." The second row has a trailing value that is clipped to "8". The main pane says "1 ask needs you". There is no dedicated sign-in dialog or view, and the ask is not opened in the main pane.
- **Log says:** One ask, the sign-in unblock ask ("opens claude auth login"), then "1 ask needs you". The sign-in task was "inbox shown, hub list listed". The taste call was "inbox queued, hub list not listed". vitest: signin.test.ts 1 passed.
- **Agree:** yes. Only the sign-in ask is listed, and the queued taste ask does not appear.

## Expectations

1. **0-before-batch.png shows nothing in Needs you before the batch: supported.** The heading has no count and no ask rows, and the main pane says "Nothing needs you". The three repo220b rows are task rows, not asks.
2. **1-needs-you.png shows 8 rows after the batch, with D6 folded: supported.** The count is 8 and there are exactly 8 ask rows (A1, B1, D1 to D5, plus "This session keeps asking"). There is no D6 row, which is consistent with D6 being folded into the exception ask. The log matches.
3. **2-after-bulk-answer.png shows a count of 2 (A1/B1) after the bulk answer: supported.** The heading count is 2, the rows are A1 and B1, and the main pane says "2 asks need you". The log matches.
4. **Signin test passes and 0-signin.png shows the sign-in screen: PASS supported, screen partly supported.** vitest reports 1/1 passed. The screenshot shows the sign-in ask as the only Needs you row (count 1). It is a row in the list, not a separate sign-in screen. If the brief expected a dedicated sign-in view or an opened ask, the screenshot does not show one.

Cosmetic notes: every row title is clipped at the sidebar edge with no ellipsis. In 0-signin.png, the trailing value of "Add a README line, then stop." is cut off at "8".

## Overall verdict

The screenshots agree with the run logs. Expectations 1 to 3 are supported, and expectation 4 is supported apart from the fact that it shows a sign-in ask row rather than a dedicated sign-in screen.
