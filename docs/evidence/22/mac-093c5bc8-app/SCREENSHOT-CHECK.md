# Screenshot check, issue #22 e2e (target/mac/22j/e2e)

Checked by reading the three PNGs as images, plus `app-run.txt`, `vitest.txt` and `docs/evidence/22/e2e-app.test.ts`. PNG chunks and the two text files were also scanned for personal data. Nothing in the repo was edited.

## Verdicts

- **0-before-batch.png: OK for the claim, with one unexplained oddity.** Needs you is empty and `deep inbox` says "Nothing needs you". But the three sessions sit under a "No project" heading below an empty "repo182a" heading, unlike the other two screenshots.
- **1-needs-you.png: OK.** 8 rows (A1, B1, D1 to D5, exception), no D6 row, count 8, heading "8 asks need you", same order as `deep inbox`. Each row can now be told apart by its number.
- **2-after-bulk-answer.png: OK.** A1 and B1 only, count 2, heading "2 asks need you", same as `deep inbox`.

Nothing blocks the claim in any of the three. The findings below are cosmetic, unexplained or limits of what the pixels prove.

## 0-before-batch.png

On screen:
- Title bar: coloured traffic lights, the app's "D" logo, no title text.
- Sidebar: "Needs you" with no count and no rows. Then heading "repo182a" with **no rows under it**. Then heading "No project" with three brown-square session rows:
  - "Pick header... · dd10aa31  8 s"
  - "Pick heade... · 7337394d  8 s"
  - "Pick header... · 6bea1e87  7 s"
- Main pane: "New task", then grey "Nothing needs you". Empty input with a text cursor, "Send".

Against the log: `deep inbox` at 20:17:09.478Z prints "Nothing needs you". Agrees. The session ages (7-8 s) put the capture at about 20:17:13Z, before the 20:18:00Z batch, so the picture dates itself as pre-batch.

Blocks the claim: nothing.

Cosmetic, odd or unexplained:
1. **Session grouping differs from screenshots 1 and 2.** Here the three sessions are under "No project" and "repo182a" is an empty heading. In 1 and 2 the same three ids are under "repo182a" and "No project" is gone. The log gives `repo182a` for every ask's session. The earlier 22h run showed the sessions under the repo heading in all three shots, so this looks like a timing-dependent state in the first seconds of a session (a project heading with nothing under it, sessions not yet attributed). Not part of #22's claim, but it is a visible inconsistency in evidence that is meant to show "same sessions throughout".
2. That eight asks were already queued at this moment is not in the picture. It follows from the log only (ask ages 58 s to 1 m at about 20:18:05Z means created about 20:17:05-07Z) and from the script, which waits for each `ask.created` before going on.
3. The sessions carry the same brown square as ask rows do later, while Needs you is empty. The image doesn't say what the square means.
4. Session titles are ellipsised at slightly different lengths ("Pick header..." / "Pick heade...").
5. "Nothing needs you" sits about 12 px lower and in a lighter colour than "8 asks need you" / "2 asks need you" in the other two.

## 1-needs-you.png

On screen:
- Title bar: coloured traffic lights and the logo.
- Sidebar: "Needs you" with count "8", then eight brown-square rows:
  1. "A1: whic" · "How it looks" · "Tue 12:17"
  2. "B1: whic" · "How it looks" · "Tue 12:17"
  3. "D1: whic" · "How it looks" · "Tue 12:17"
  4. "D2: whic" · "How it looks" · "Tue 12:17"
  5. "D3: whic" · "How it looks" · "Tue 12:17"
  6. "D4: whic" · "How it looks" · "Tue 12:17"
  7. "D5: whic" · "How it looks" · "Tue 12:17"
  8. "This sessior" (the "n" cut) · "Problem" · "Tue 12:17"
- Then "repo182a" with "Pick head... · dd10aa31  1 min", "Pick head... · 7337394d  1 min", "Pick head... · 6bea1e87  1 min". No "No project" heading.
- Main pane: "New task", then "8 asks need you". Empty input with cursor, "Send".

Against the log, line by line: the eight `deep inbox` lines after the 20:18:00Z batch are A1, B1, D1, D2, D3, D4, D5, then "This session keeps asking...", then "8 asks need you". Same order, same number of rows. Kinds: the log's `taste` is drawn as "How it looks" on the seven taste rows and `exception` as "Problem" on the last. "Tue 12:17" on every row equals the log's default time "Tue 17 Nov at 12:17" (17 Nov 2026 is a Tuesday; the run was Sat 14 Nov, 12:17 local = 20:17Z). Count 8 = 8 rows = heading = log. Session ages "1 min" fit a capture at about 20:18:09Z.

Told apart: yes. The seven taste rows read A1, B1, D1, D2, D3, D4, D5, all different. There is no D6 row, so the fold of the sixth is now readable from the pixels, which the 22h run couldn't show.

Blocks the claim: nothing.

Cosmetic, odd or unexplained:
1. Ask titles are still hard-clipped mid-glyph with no ellipsis ("whic", "This sessior"), while session rows in the same sidebar use "...". Only the two- or three-character prefix tells the rows apart; everything after it is lost.
2. The exception row shows only "This sessior" and "Problem". "keeps asking" isn't visible, and nothing in the row ties it to session 6bea1e87 or to the D asks. That it is the keeps-asking exception for D's session comes from the log.
3. The rows don't show which session each ask belongs to, so "A1 and B1 are other sessions, D1 to D5 are one session" is log-only (the log gives dd10aa31, 7337394d, and 6bea1e87 for all D rows and the exception).
4. That a D6 ask was raised at all is not shown in either the picture or the log. It rests on the script (the loop asks D2 to D6 and waits up to 60 s for each `ask.created`, throwing otherwise) and the passing vitest run.
5. "Tue 12:17" has no label. The run itself happened at 12:17 local on a Saturday, so the same clock time three days later can be misread as a creation time with a wrong weekday. It is the default-answer deadline.
6. The count "8" sits mid-sidebar (about x=334) rather than at the rows' right edge (about x=485).
7. "taste" to "How it looks" and "exception" to "Problem" is the app's wording; the log can't confirm the mapping, only that the positions agree.

## 2-after-bulk-answer.png

On screen:
- Title bar: coloured traffic lights and the logo.
- Sidebar: "Needs you" with count "2", then:
  1. "A1: whic" · "How it looks" · "Tue 12:17"
  2. "B1: whic" · "How it looks" · "Tue 12:17"
- Then "repo182a" with "Pick head... · dd10aa31  1 min", "Pick head... · 7337394d  1 min", and a grey-square row "1 quiet session  quiet  41 s".
- Main pane: "New task", then "2 asks need you". Empty input, no text cursor visible, "Send".

Against the log: `deep inbox answer ask:01M7DV9QPGCMQMKEH70QAXXA1S together` returned "answered together; no decision saved (exit 0)"; the handle is the exception's from the earlier listing. The next `deep inbox` lists A1 and B1 with the same handles and sessions as before, then "2 asks need you". Agrees: 2 rows, same order, same kinds and times, count 2 = heading = log.

Told apart: yes (A1, B1).

Blocks the claim: nothing.

Cosmetic, odd or unexplained:
1. Session 6bea1e87 is no longer listed by name; "1 quiet session" stands in its place. That it is D's session is an inference (it is the only one missing).
2. "quiet 41 s" isn't explained by the log. D's session was last active about 72 s before this capture and the bulk answer was about 9 s before it; neither is 41. It fits "became quiet 30 s after its last activity" (the 22h run showed 30 s at about 61 s), but that is a guess.
3. The image can't show what happened to D1 to D5 and D6 (answered, defaulted, closed); only that their rows are gone. The log's "no decision saved" is all there is.
4. The text cursor present in 0 and 1 is missing here. Probably blink phase; the traffic lights are still coloured.
5. Same mid-glyph clipping and unlabeled "Tue 12:17" as in screenshot 1.

## Across the three

- Same window: the log gives window 8730 for all three; all are 1920x1282 RGBA, same layout, same logo, same sidebar width.
- Same sessions: dd10aa31, 7337394d, 6bea1e87 in 0 and 1; dd10aa31, 7337394d plus one quiet session in 2. They match the session ids in the log.
- Same repo name "repo182a" in all three, but the grouping differs in 0 (see finding 1 there).
- A1 and B1 rows are pixel-for-pixel the same text in 1 and 2.
- Times are coherent: 7-8 s, then 1 min, then 1 min; vitest started 12:16:38 and ran 100 s, which covers 20:17:00Z to 20:18:18Z.

## Capture quality and personal data

- No blank or black area, no desktop, menu bar or other app's content in any of the three. No overlapping or garbled text.
- Pixels: only "repo182a", 8-hex session prefixes and the test questions. No user name or path.
- PNG chunks: dimensions, 144 dpi, colour profile, and UserComment "Screenshot". No name, path or date.
- `app-run.txt` and `vitest.txt`: no `/Users/`, `/home/`, user name or email (grepped). They do hold the temp path `/private/tmp/dh27-BX4SRU/h`, the hardware model `Mac15,12`, full session UUIDs and ask ids, and `~/private/dbc-22n/target/e2e-22` (tilde form).

## Other small points

- `vitest.txt` says the run root was `~/private/dbc-22n/...`, while the evidence is filed under `22j`. Nothing in the files explains the different label.
- `vitest.txt` contains raw ANSI colour codes.
- The log mixes time zones: step headers are UTC (20:17, 20:18), default times are local (12:17).
- Whether the script on disk is the one that ran can't be checked from these files; there is no copy in the e2e folder. Its question text, 1-minute batch and file names do match the log.
