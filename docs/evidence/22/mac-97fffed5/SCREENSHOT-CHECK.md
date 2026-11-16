# Screenshot check, 22w (PR #2097, issue #22)

Independent check. Each PNG viewed in full; `e2e/app-run.txt` and `signin/signin-run.txt` read in full (and both `vitest.txt`: 1/1 passed each).

## e2e/0-before-batch.png: MATCH

- "Needs you" header with no count and no ask rows beneath it.
- Main pane: "New task" / "Nothing needs you", same as the log's `deep inbox` ("Nothing needs you").
- Project group `repo3478` lists three tasks: "Pick heade... · 6e7db0b6" (9 s), "· 401e4795" (9 s), "· 966e2061" (8 s). These are task rows, not ask rows; their ids match the three sessions in the log.

## e2e/1-needs-you.png: MATCH

- "Needs you" count 8; main pane "8 asks need you" (log: "8 asks need you").
- Rows, in log order: A1, B1, D1, D2, D3, D4, D5 (each "<id>: whi..." / "How it looks" / "Wed 18:27"), then "This sessio..." / "Problem" / "Wed 18:27".
- No D6 row: D6 is folded into "This session keeps asking", as the log shows (kind `exception`, shown as "Problem"). "Wed 18:27" matches the log's "If you don't answer ... on Wed 18 Nov at 18:27".
- `repo3478` still lists the three tasks (now "1 min").
- Odd but not a mismatch: the ask texts are cut hard to "A1: whi" / "This sessio", so the question itself can't be read in the list.

## e2e/2-after-bulk-answer.png: MATCH

- "Needs you" count 2; rows A1 and B1 only ("How it looks", "Wed 18:27"); main pane "2 asks need you". Same as the log after `answer ... together`.
- D1-D5 and the "This session keeps asking" row are gone.
- `repo3478` now shows tasks 6e7db0b6 and 401e4795 (1 min) and a new row "1 quiet session · quiet 38 s"; task 966e2061 no longer appears by name. The log doesn't mention this; it looks like D's session settling to quiet after its asks were answered together (the choice was "together", not "pause"). Worth a glance but not against the expectation.
- The composer has no text cursor in this shot (focus elsewhere); harmless.

## signin/0-signin.png: MATCH

- "Needs you" count 1; one row "Sign in to (..." / "Your step" / "Tue 18:28"; main pane "1 ask needs you". The log has the sign-in ask "Sign in to Claude Code again? ..." (kind `unblock`, default "Leave it blocked, on Tue 17 Nov at 18:28") and "1 ask needs you".
- No row for the taste call T1 (log: "taste call ...: inbox queued, hub list not listed").
- Project group `repobaff` lists two tasks: "Pick a header colour for th..." and "Add a README line, then s..." (8 s each). These are task rows, not ask rows.

## "No project" label

Not visible in any of the four pictures (every task sits under `repo3478` or `repobaff`). Noted as the known follow-up; not counted.

## Personal data

No picture shows a home path, a user name or an email: the only text is the app's own UI, the ask and task texts, repo names `repo3478` / `repobaff`, short session ids and times. (Outside the pictures, the logs name throwaway homes under `/private/tmp/dh27-*/h`, and `vitest.txt` shows a `~/private/d22w` run directory; neither names a user.)

## Verdict

4 of 4 MATCH.

## Second look (the #22 session)

I viewed 0-signin.png and 2-after-bulk-answer.png myself. I agree with both MATCH verdicts. Two observations, not
mismatches:
- The row dates ("Tue 18:28", "Wed 18:27") aren't the run's day (Sunday, 2026-11-15). The column reads like a by-when
  or deadline, not the time the ask came in.
- The rows' question text is cut to a few characters ("A1: whi", "Sign in to (").
Both are follow-ups for the app's list layout, outside #22's criteria.
