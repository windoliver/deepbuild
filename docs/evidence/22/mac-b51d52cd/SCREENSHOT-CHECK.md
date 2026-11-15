# Screenshot check, issue #22 e2e, build b51d52cd3 (target/mac/22n/e2e)

Checked by reading the three PNGs as images, plus `app-run.txt`, `vitest.txt`, `docs/evidence/22/e2e-app.test.ts`, and the previous run's check and three PNGs (`docs/evidence/22/mac-093c5bc8-app/`). PNG chunks and the two text files were scanned for personal data, and the pixels for dark or transparent areas. Nothing in the repo was edited.

## Verdicts

- **0-before-batch.png: OK.** Needs you has no count and no rows; main pane says "Nothing needs you"; `deep inbox` says "Nothing needs you". Three sessions listed under the repo heading.
- **1-needs-you.png: OK.** 8 rows (A1, B1, D1 to D5, exception), no D6 row, count 8, "8 asks need you", same order as `deep inbox`.
- **2-after-bulk-answer.png: OK.** A1 and B1 only, count 2, "2 asks need you", same as `deep inbox`.

Nothing in the pictures blocks the claim, and there is no regression against the previous run. One point outside the pictures is not proven by the files I was given: which commit the app in the pictures was built from (see "Not verified").

## 0-before-batch.png

On screen:
- Title bar: coloured traffic lights, the app's "D" logo, no title text.
- Sidebar: "Needs you" with no count and no rows. Heading "repod3ae" with three brown-square session rows:
  - "Pick header... · 9fd477cb  8 s"
  - "Pick header... · 6eed0618  8 s"
  - "Pick header... · 15eb8af1  7 s"
- Main pane: "New task", then grey "Nothing needs you". Empty input with a text cursor, "Send".

Against the log: `deep inbox` at 04:41:10.925Z prints "Nothing needs you". Agrees. Session ages 7-8 s put the capture at about 04:41:13Z, before the 04:42:00Z batch. The three 8-hex ids are the prefixes of the three session UUIDs in the later log lines.

Blocks the claim: nothing.

Cosmetic, odd or unexplained:
1. That eight asks were already waiting is not in the picture. It follows from the log (ask ages 57-59 s at about 04:42:05Z, so created about 04:41:06-08Z, before the 04:41:10.9Z "Nothing needs you") and from the script waiting for each `ask.created`.
2. Sessions carry the same brown square that ask rows carry later, while Needs you is empty; the picture doesn't say what the square means.
3. "Nothing needs you" sits about 12 px lower (y 213 against 201) and lighter than "8 asks need you" / "2 asks need you" in the other two.
4. Session titles are ellipsised here as "Pick header..." and in the other two as "Pick head..." (the age column is wider there).

## 1-needs-you.png

On screen:
- Sidebar: "Needs you" with count "8", then eight brown-square rows:
  1. "A1: whic" · "How it looks" · "Tue 20:41"
  2. "B1: whic" · "How it looks" · "Tue 20:41"
  3. "D1: whic" · "How it looks" · "Tue 20:41"
  4. "D2: whic" · "How it looks" · "Tue 20:41"
  5. "D3: whic" · "How it looks" · "Tue 20:41"
  6. "D4: whic" · "How it looks" · "Tue 20:41"
  7. "D5: whic" · "How it looks" · "Tue 20:41"
  8. "This sessior" (the "n" cut) · "Problem" · "Tue 20:41"
- Then "repod3ae" with "Pick head... · 9fd477cb  1 min", "Pick head... · 6eed0618  1 min", "Pick head... · 15eb8af1  1 min".
- Main pane: "New task", then "8 asks need you". Empty input with cursor, "Send".

Against the log, line by line: the eight lines after the 04:42:00Z batch are A1, B1, D1, D2, D3, D4, D5, "This session keeps asking...", then "8 asks need you". Same order, same number. Kinds: `taste` on the first seven is drawn "How it looks", `exception` on the last is drawn "Problem". "Tue 20:41" on every row equals the log's "Tue 17 Nov at 20:41" (17 Nov 2026 is a Tuesday; the run was Sat 14 Nov 20:41 local = 04:41Z on the 15th). Count 8 = 8 rows = heading = log's last line. Session ages "1 min" fit a capture at about 04:42:09Z.

Told apart: yes; A1, B1, D1, D2, D3, D4, D5 all differ in their first two characters, and the exception differs in text and kind. No D6 row.

Blocks the claim: nothing.

Cosmetic, odd or unexplained:
1. Ask titles are hard-clipped mid-glyph with no ellipsis ("whic", "This sessior"); session rows in the same sidebar use "...". Only the two-character prefix tells the taste rows apart.
2. The exception row shows only "This sessior" and "Problem"; "keeps asking" is not visible, and nothing ties it to session 15eb8af1 or to the D asks. That comes from the log.
3. Rows don't show their session, so "D1 to D5 are one session, A1 and B1 two others" is log-only.
4. That a D6 ask was raised at all is in neither the picture nor the log; it rests on the script (loop D2 to D6, each waiting for `ask.created` or throwing) and the passing vitest run. The picture shows the absence of a D6 row, not the fold itself.
5. "Tue 20:41" has no label. It is the default-answer deadline, three days out at the same clock time as the run, so it can be misread as a creation time.
6. The count "8" sits mid-sidebar (about x=334), not at the rows' right edge (about x=485).
7. "taste" to "How it looks" and "exception" to "Problem" is the app's wording; the log only confirms the positions.

## 2-after-bulk-answer.png

On screen:
- Sidebar: "Needs you" with count "2", then:
  1. "A1: whic" · "How it looks" · "Tue 20:41"
  2. "B1: whic" · "How it looks" · "Tue 20:41"
- Then "repod3ae" with "Pick head... · 9fd477cb  1 min", "Pick head... · 6eed0618  1 min", and a grey-square row "1 quiet session  quiet  40 s".
- Main pane: "New task", then "2 asks need you". Empty input, no text cursor visible, "Send".

Against the log: `deep inbox answer ask:01M7ER4MBVCBMF005XJA7J77T5 together` returned "answered together; no decision saved (exit 0)"; that handle is the exception's in the earlier listing. The next `deep inbox` lists A1 and B1 with the same handles and sessions as before, then "2 asks need you". Agrees: 2 rows, same order, kinds and times; count 2 = heading = log.

Told apart: yes (A1, B1).

Blocks the claim: nothing.

Cosmetic, odd or unexplained:
1. Session 15eb8af1 is no longer listed by name; "1 quiet session" stands in its place. That it is D's session is an inference (the only one missing).
2. "quiet 40 s" is not explained by the log. D's session was last active about 70 s before the capture; 40 fits "quiet from 30 s after last activity", which is a guess.
3. The picture can't show what became of D1 to D6 (answered, defaulted, closed), only that their rows are gone. The log's "no decision saved" is all there is.
4. The text cursor seen in 0 and 1 is missing here; probably blink phase, the traffic lights are still coloured.
5. Same mid-glyph clipping and unlabeled "Tue 20:41" as in screenshot 1.

## Compared with the previous run (mac-093c5bc8-app)

Same:
- Layout, window size (1920x1282), headings, logo, input box, in all three.
- Screenshot 1: 8 rows in the same order with the same titles and kinds, count 8, "8 asks need you", no D6 row, three sessions under the repo heading at "1 min".
- Screenshot 2: A1 and B1, count 2, "2 asks need you", two named sessions plus "1 quiet session".
- Screenshot 0: empty Needs you with no count, "Nothing needs you", three sessions at 8 s, 8 s, 7 s.
- The same cosmetic points: mid-glyph clipping, count position, "Nothing needs you" offset, missing cursor in 2.

Differs:
- **Screenshot 0 grouping: the previous run had an empty repo heading and the three sessions under "No project". This run has them under "repod3ae" with no "No project" heading, the same grouping as in 1 and 2.** The previous check's one unexplained oddity is gone. Whether that is the new build or timing can't be told from one run each.
- Expected per-run values only: repo name (repod3ae / repo182a), session ids, ask ids, clock time (Tue 20:41 / Tue 12:17), window id (15557 / 8730), quiet age (40 s / 41 s).
- vitest took 264 s against 100 s. The log puts the first step 195 s after the start, so the extra time is before the sessions were made (the script builds the app first); nothing in the files says so directly.

Regression signs looked for and not found: a row missing or extra, a different count, D6 as its own row, rows before the batch.

## Capture quality and personal data

- No blank or black area: dark pixels are 0.3-0.5 % of each image (text, logo, squares); transparent 0.05 % (the window's rounded corners). No desktop, menu bar or other app's content. No overlapping or garbled text.
- Pixels: only the repo name, 8-hex session prefixes and the test questions. No user name or path.
- PNG chunks: dimensions, 144 dpi, colour profile, UserComment "Screenshot". No name, path or date.
- `app-run.txt` and `vitest.txt`: no `/Users/`, `/home/`, user name or email. They hold a temp path under `/private/tmp`, the hardware model `Mac15,12`, full session UUIDs and ask ids, and a tilde-form path of the run's worktree in `vitest.txt`.

## Not verified

- **Which commit the pictured app was built from.** The e2e folder names no commit. The run's `exits.txt` (one level up) records "part 2 at b51d52cd3..." at 20:20, then a part 3 that merged another PR's head into b51d52cd3 as a scratch commit, then "part 4 setup" and the app run at 20:37-20:42 with no commit stated. If the scratch merge was made in the same worktree and not undone, the pictured app is b51d52cd3 plus that merge, not b51d52cd3 alone. The files I read can't settle it.
- Whether the script on disk is the one that ran: no copy in the e2e folder. Its question text, 1-minute batch and file names match the log.
- The machine was under load during the run (load averages about 19-25 at start and end of the app step per `exits.txt`); no timing claim rests on these pictures, so this only matters if one is made.
- The log mixes time zones: step headers are UTC (04:41, 04:42 on the 15th), default times and vitest's start are local (20:41, 20:37 on the 14th).
