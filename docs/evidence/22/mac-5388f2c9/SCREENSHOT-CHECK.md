# Screenshot check, issue #22 e2e, build 5388f2c93 (target/mac/22s/e2e)

Inputs: the three PNGs (read as images), `app-run.txt`, `vitest.txt`, `docs/evidence/22/e2e-app.test.ts`, `target/mac/22s/exits.txt` and `setup.log`. I formed my view first, then compared with `docs/evidence/22/mac-adaa0e19/rerun/e2e/` and its SCREENSHOT-CHECK.md. Nothing in the repo was edited except this file.

## Verdicts

- **0-before-batch.png: OK.**
- **1-needs-you.png: OK.**
- **2-after-bulk-answer.png: OK.**

Nothing blocks the claim. No regression against the adaa0e19 run. Not verifiable from these files: which build the pictured app came from, and that D6 was raised (see "Not verified").

## 0-before-batch.png

On screen: the deep-app window only (traffic lights, "D" logo). The sidebar shows "Needs you" with no count and no rows. Below it is "repo2390" with three session rows, each with a brown (waiting) square: "Pick heade... · 142dc753 8 s", "Pick header... · ad7a0dec 8 s", "Pick heade... · cd22450b 7 s". The main pane shows "New task", "Nothing needs you", and an empty input with a caret and "Send".

Against the log: `deep inbox` at 20:46:11.202Z prints "Nothing needs you". That agrees. The three session ids are prefixes of the session UUIDs of A (142dc753), B (ad7a0dec) and D (cd22450b) in the later inbox lines. The batch was at 20:47:00Z, so this capture came before it.

Blocks: nothing. Notes:
- The picture does not show the asks themselves waiting. It shows three sessions alive for 7-8 s. That asks were already raised rests on the script, which waits for each `ask.created` before the first `deep inbox`, and on the log: post-batch ages of 57-58 s at about 20:47:05Z put creation at about 20:46:07-08Z, before the 20:46:11Z "Nothing needs you".
- "Nothing needs you" sits a little lower and lighter than the "N asks need you" line in the other pictures. This is cosmetic and the same as before.

## 1-needs-you.png

On screen: "Needs you" with count **8**, then eight rows in this order:
1. "A1: whi · How it looks · Wed 12:46"
2. "B1: whi · How it looks · Wed 12:46"
3. "D1: whi · How it looks · Wed 12:46"
4. "D2: whi · How it looks · Wed 12:46"
5. "D3: whi · How it looks · Wed 12:46"
6. "D4: whi · How it looks · Wed 12:46"
7. "D5: whi · How it looks · Wed 12:46"
8. "This sessio · Problem · Wed 12:46"

There is no D6 row. Below are "repo2390" and the three sessions 142dc753, ad7a0dec and cd22450b, each at "1 min". The main pane shows "8 asks need you".

Against the log: `deep inbox` after the 20:47:00Z batch lists A1, B1, D1-D5 (kind `taste`), then "This session keeps asking..." (kind `exception`), then "8 asks need you". The order, the number and the kinds match (taste = "How it looks", exception = "Problem"). "Wed 12:46" matches the default deadline "Wed 18 Nov at 12:46", and 18 Nov 2026 is a Wednesday. D1-D5 and the exception all carry session cd22450b.

Blocks: nothing. Notes:
- Titles are cut mid-word with no ellipsis ("whi", "This sessio"). Only the two-character prefix tells the taste rows apart. This is cosmetic and the same as the previous run.
- Session ages show "1 min" while the CLI says 57-58 s. That is display rounding, and cosmetic.
- The picture shows that D6 has no row. That D6 was raised and folded into the exception rests on the script and the passing vitest run (1 test passed, 227.9 s), not on the picture or the log. The log never names D6.
- Rows don't name their session. The link between D1-D5, the exception and cd22450b is in the log only.

## 2-after-bulk-answer.png

On screen: "Needs you" with count **2**, then "A1: whi · How it looks · Wed 12:46" and "B1: whi · How it looks · Wed 12:46". Below are "repo2390" with 142dc753 (1 min), ad7a0dec (1 min) and a grey-square row "1 quiet session · quiet 39 s". The main pane shows "2 asks need you", and the input has a caret.

Against the log: `deep inbox answer ask:01M7GFBKK95S9P75GXQQ41CCK3 together` prints "answered together; no decision saved (exit 0)". That handle is the exception's. The next `deep inbox` lists A1 and B1 only, then "2 asks need you", which agrees. D1-D5 and the exception are gone in both the app and the CLI.

Blocks: nothing. Notes:
- Session cd22450b is no longer listed by name. "1 quiet session" stands in its place, and that it is D's session is an inference. The previous run showed the same thing (38 s there, 39 s here).
- "no decision saved" is a design point about bulk answers. Nothing in the pictures speaks to it.

## Personal data and capture integrity

- PNG chunks in all three: IHDR (1920x1282 RGBA), iCCP, cICP, eXIf, pHYs, XMP iTXt, iDOT. The eXIf and XMP hold only the pixel dimensions and UserComment "Screenshot". There are no tEXt/zTXt chunks, and no names, paths or device owner. `strings` found nothing name- or path-like.
- Pixels: all three show the same deep-app window (window id 20717 in the log). None shows a desktop, menu bar or other app's content. They are not blank, black or garbled: on a 1-in-16 sample, 0.43 %, 0.98 % and 0.54 % of pixels are dark (text), and 0.06 % are transparent (rounded corners). exits.txt says the front app during part 3 was "Windows App". The script captures by window id (`screencapture -l`), and none of its content appears in the pictures.
- `app-run.txt`: the home is `/private/tmp/dh27-1RD0lB/h` (a temp dir, no user name). The machine is "Mac15,12", a model id and not personal. `vitest.txt` uses `~/private/dbc-22s/...` with `~`. A grep of both text files for `/Users/`, `/home/`, email patterns and the login name found nothing. exits.txt also records "login-name hits after redaction: 0" and "secret scan hits=0".

## Regression comparison (adaa0e19 rerun)

Same layout, rows, order, counts, kinds and "1 quiet session" behaviour. The only differences are per-run values: repo name, session ids, clock (Wed 12:46 vs Wed 00:39), quiet age (39 s vs 38 s), and a text caret in the input in pictures 0 and 2. The caret is focus only, and cosmetic. I found no missing or extra row, no different count, no D6 row and no row before the batch.

## Not verified

- **Which commit the pictured app was built from.** exits.txt records "head 5388f2c932b3..." and "part 3 setup exit=0". setup.log shows only npm and tsc builds and names no commit. Nothing in these files shows the worktree's HEAD or a clean tree when the app was built, or ties the deep-app binary (pid 87149) to 5388f2c93. "Built from 5388f2c93" is consistent with the files but not proven by them.
- That D6 was raised and folded rests on the script and the vitest pass, not on the pictures or the log.
- The capture times of the screenshots are not logged. Their order relative to the CLI calls is inferred from the script's order and the ages shown.
