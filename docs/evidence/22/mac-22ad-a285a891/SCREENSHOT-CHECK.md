# Screenshot check: Mac run 22ad, commit a285a891 (issue #22, asks show at their batch time)

Sources: e2e/app-run.txt, e2e/vitest.txt (app.test.ts 1/1 passed), signin/signin-run.txt and the four PNGs. No personal data appears in any image (only generated repo names, session id prefixes and the public pricing line). No error text on screen.

## e2e/0-before-batch.png: OK

- **On screen:** "Needs you" heading with no count and no rows. Group repo976f with three task rows "Pick header… · 1f06e3e4 / 27bee751 / 6abf5ae8", 10 s each. Main pane: "New task", "Nothing needs you".
- **Log:** `deep inbox` at 09:37:11Z printed "Nothing needs you".
- **Agree:** yes. No ask shows before the 09:38:00Z batch.

## e2e/1-needs-you.png: OK

- **On screen:** "Needs you" count 8, rows A1, B1, D1, D2, D3, D4, D5 (each "How it looks") and "This session keeps a…" (Problem). No D6 row. Main pane: "8 asks need you". The three repo976f task rows remain (1 min).
- **Log:** the same 8 asks in the same order, the exception ask from session 6abf5ae8 (the D session), "8 asks need you"; no D6.
- **Agree:** yes. The sixth D ask is folded into the exception, not on its own row.

## e2e/2-after-bulk-answer.png: OK

- **On screen:** "Needs you" count 2, rows A1 and B1. Main pane: "2 asks need you". repo976f shows tasks 1f06e3e4 and 27bee751 plus a grey "1 quiet session · quiet · 39 s" row.
- **Log:** `deep inbox answer … together` exit 0, then A1 and B1, "2 asks need you".
- **Agree:** yes. The D task turning into "1 quiet session" is not stated in the log but fits its asks being answered together.

## signin/0-signin.png: OK

- **On screen:** "Needs you" count 1, the selected row "Sign in to Claude C…" (Your step). The main pane shows the ask's card: "Your step", the full title "Sign in to Claude Code again? Your sign-in lapsed. The work waits, and nothing is lost.", the explanation that Claude Code opens its own sign-in and DeepBuild never sees the password, the paid-plan note with claude.com/pricing, "Once Claude Code reads signed in, this closes by itself…", and a Sign in button. repoa430 lists two task rows. The queued taste ask does not appear.
- **Log:** one ask, the sign-in unblock ask ("opens claude auth login"), "1 ask needs you"; taste call "inbox queued, hub list not listed".
- **Agree:** yes. The card shows only a Sign in button where the CLI lists done/wait/agent answers; the composer reads "Answer", so other answers can presumably be typed. Not a mismatch with the log.

Cosmetic notes: sidebar row titles are truncated with an ellipsis (A1–D5 show "which header…"/"which heade…"); the ask text that matters is in the log and, for sign-in, in full on the card. In 1 and 2 the window is inactive (grey traffic lights), which does not affect content.

## Overall

Nothing blocks. All four pictures match the expectations and the `deep inbox` output logged beside them.
