# Screenshot check, issue #22 e2e, build adaa0e19d (target/mac/22p-rerun/e2e)

Inputs: the three PNGs (read as images), `app-run.txt`, `vitest.txt`, `docs/evidence/22/e2e-app.test.ts`, `target/mac/22p-rerun/exits.txt`. I formed my view first, then compared with `docs/evidence/22/mac-b51d52cd/e2e/` and its SCREENSHOT-CHECK.md. Nothing in the repo was edited except this file.

## Verdicts

- **0-before-batch.png: OK.**
- **1-needs-you.png: OK.**
- **2-after-bulk-answer.png: OK.**

Nothing blocks the claim. No regression against the b51d52cd run. Not verifiable from these files: the exact build of the pictured app (see "Not verified").

## 0-before-batch.png

On screen: the deep-app window only (traffic lights, "D" logo). The sidebar shows "Needs you" with no count and no rows. Under it is the heading "repo98b3" with three session rows: "Pick heade... · d637c713 9 s", "· 6dc75893 9 s", "· 53e64595 8 s". The main pane shows "New task" and "Nothing needs you", plus an empty input and "Send".

Against the log: `deep inbox` at 08:39:13.155Z prints "Nothing needs you", which agrees. The three session ids are prefixes of the session UUIDs in the later inbox lines (A, B, D). The batch was at 08:40:00Z, so the capture came before it.

Blocks: nothing. Notes:
- The picture does not show that asks were already waiting. That comes from the log: post-batch ages of 55-56 s put creation at about 08:39:04-05Z, before the 08:39:13Z "Nothing needs you". It also comes from the script, which waits for each `ask.created`.
- "Nothing needs you" sits slightly lower and lighter than the "N asks need you" line in the other pictures. This is cosmetic and the same as the previous run.

## 1-needs-you.png

On screen: "Needs you" with count **8**, then eight rows in this order:
1. "A1: whi · How it looks · Wed 00:39"
2. "B1: whi · How it looks · Wed 00:39"
3. "D1: whi · How it looks · Wed 00:39"
4. "D2: whi · How it looks · Wed 00:39"
5. "D3: whi · How it looks · Wed 00:39"
6. "D4: whi · How it looks · Wed 00:39"
7. "D5: whi · How it looks · Wed 00:39"
8. "This sessio · Problem · Wed 00:39"

There is no D6 row. Below are "repo98b3" and the three sessions (1 min, 1 min, 59 s). The main pane shows "8 asks need you".

Against the log: `deep inbox` after the 08:40:00Z batch lists A1, B1, D1-D5 (kind `taste`), then "This session keeps asking..." (kind `exception`), then "8 asks need you". The order, the number and the kinds match (taste = "How it looks", exception = "Problem"). "Wed 00:39" matches the default deadline "Wed 18 Nov at 00:39", and 18 Nov 2026 is a Wednesday. D1-D5 and the exception all carry session 53e64595.

Blocks: nothing. Notes:
- Titles are cut mid-word with no ellipsis ("whi", "This sessio"). Only the two-character prefix tells the taste rows apart. The cut is one character tighter than in the previous run ("whic"), because "Wed 00:39" is wider than "Tue 20:41". This is cosmetic.
- The picture shows that D6 has no row. That D6 was raised and folded into the exception rests on the script (it waits for `ask.created` for D2-D6) and on the passing vitest run (1 test passed, 447.7 s). The picture and the log do not show it.
- Rows don't name their session. The link between D1-D5, the exception and 53e64595 is in the log only.
- The CLI now prints "answer with ..." option lines (new since the previous run, from main's #2199 merge). The app rows don't show options. The claim doesn't require them.

## 2-after-bulk-answer.png

On screen: "Needs you" with count **2**, then "A1: whi · How it looks · Wed 00:39" and "B1: whi · How it looks · Wed 00:39". Below are "repo98b3" with d637c713 (1 min), 6dc75893 (1 min) and a grey-square row "1 quiet session · quiet 38 s". The main pane shows "2 asks need you".

Against the log: `deep inbox answer ask:01M7F5RFVK9GMDBFWMVEHX13DR together` prints "answered together; no decision saved (exit 0)". The next `deep inbox` lists A1 and B1 only, then "2 asks need you", which agrees. D1-D5 and the exception are gone in both the app and the CLI.

Blocks: nothing. Notes:
- Session 53e64595 is no longer listed by name. "1 quiet session" stands in its place, and that it is D's session is an inference. The previous run showed the same thing (40 s there, 38 s here).
- "no decision saved" in the CLI output is a design point about bulk answers. Nothing in the pictures speaks to it.

## Personal data and capture integrity

- PNG chunks: IHDR (1920x1282 RGBA), iCCP, cICP, pHYs, iDOT, eXIf, and XMP iTXt. These hold only pixel dimensions and the UserComment "Screenshot". There are no tEXt/zTXt chunks, no names, no paths and no device owner.
- Pixels: all three show the same deep-app window (window id 19359 in the log). They show no other app's content, no desktop and no menu bar. They are not blank, black or garbled: about 0.3-0.5 % of sampled pixels are dark (text only), and 0.09 % are transparent (the rounded window corners).
- `app-run.txt`: the home is `/private/tmp/dh27-F6TRHM/h` (a temp dir, no user name). There are no `/Users/<name>`, `/home/<name>` or email strings. `vitest.txt` uses `~/private/dbc-22pb/...` with `~`, so no user name appears. A grep for `/Users/`, `/home/`, email patterns and the login name found nothing. exits.txt also records "login-name hits after redaction: 0" and "secret scan hits=0".

## Regression comparison (b51d52cd run)

Same layout, rows, counts, kinds and "1 quiet session" behaviour. The only differences are per-run values: repo name, ids, clock, quiet age, the one-character tighter title clip, and the CLI's new "answer with" lines. I found no row missing or extra, no different count, no D6 row and no row before the batch.

## Not verified

- **Which commit the pictured app was built from.** exits.txt records "head adaa0e19d...", "setup in dbc-22pb at adaa0e19d: exit=0", and vitest ran in `~/private/dbc-22pb/target/e2e-22`. Between setup and the app run (00:32:50), rounds A1/B1/A2/B2 and a probe ran, and the probe was "at adaa0e19d". Nothing in these files shows the worktree's HEAD or a clean tree at app-build time, or ties the deep-app binary (pid 98881) to that tree. The claim "built from adaa0e19d" is consistent with the files but not proven by them.
- That D6 was raised and folded rests on the script and the vitest pass, not on the pictures (see above).
- The capture times of the screenshots are not logged. Their order relative to the CLI calls is inferred from the ages shown.
