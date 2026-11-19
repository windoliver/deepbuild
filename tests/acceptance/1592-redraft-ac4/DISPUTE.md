# Dispute: the first draft's AC4 test can't take its pictures in these sessions

This redraft exists because of this dispute. The first draft is `tests/acceptance/1592/shown.test.ts`, from the blind
commit `c622eafb9` (cherry-picked as `79e659903`).

AC4 (#1592.15a3cc5f): "Shown to you: a contact sheet of every state mark and icon in light and dark, taken by the check
run from the real app, is attached to the PR and shown to you. Whether it looks right is one taste call, recorded;
without it the run stays INCONCLUSIVE, never PASS".

## What stops the first draft

The first draft takes each picture through the window server: #1454's `App.capture` runs `screencapture -l <window id>`,
which needs Screen Recording for the process running the test. This Mac's agent sessions have Accessibility but not
Screen Recording; #1454's probe answers `access` with `{"screens":[[1736,1133,2]],"ax":true,"screen":false}`. So the run
stops BLOCKED before any picture, whatever the app draws. Its run on the work (`d3b71df3d`):

```
FAIL  shown.test.ts > #1592 AC4 #1592.15a3cc5f shown to you > AC4 #1592.15a3cc5f: the check run takes the contact sheet of every state mark and icon from the real app in light and dark, and reads INCONCLUSIVE unless a recorded taste call on exactly these files says it looks right
Error: BLOCKED: this process has no Screen Recording permission, so nothing can read the real window's pixels; grant it to the app the tests run under
 ❯ ../1454/helpers.ts:104:25
 ❯ shown.test.ts:74:5
```

By hand, #1459's probe read all ten tiles of the real app's contact-sheet window (nine marks, one icon). The window
opens and holds its tree; only the window-server capture is out of reach.

## How the redraft was made

AC4 went to a fresh run of the blind job with the same inputs: the issue, the design and the base `f6ddd396f`, which
holds neither the work nor the first draft. It never saw the work, the diff or this dispute. Its brief gave two facts of
this Mac, both readable at the base: the process running the tests has no Screen Recording, and the real app can read
back its own window's frame with no screen permission (#1434's `deep-app --chrome <fixture> --snapshot <png>`).

The redraft pinned `deep-app --contact-sheet <png>`: the real app's window reads back the frame it presented, writes the
PNG and prints one report line of what it drew where. Both drafts' surfaces stand in the work: `--contact-sheet` alone
keeps the window open for the first draft's tree and capture, and with a PNG it takes its picture and quits.

## The redraft on the work

On the work (`124a2ad58`), with `DA1592_SHEETS=docs/evidence/1592/contact-sheet`:

1. **20:55, screen locked.** The screen was found locked when the run ended. A locked screen gives a window no frames,
   so the light sheet's app never drew; the test stopped it at its 5 minutes. The README asks for an unlocked screen.

   ```
   AssertionError: DEEP_APP_APPEARANCE=light deep-app --contact-sheet …/contact-light.png exits 0 (SIGKILL): : expected null to be +0
   ```

2. **21:52, unlocked, no call recorded.** Every check held: each entry's mark, `external-link` at 14 and 16, both
   pictures their 960 × 640 window at scale 2, light and dark different. It read INCONCLUSIVE at the taste call:

   ```
     contact-dark.png  bf755bbd24a937861b6958be59d7b69227c15c5bf63c5cb9dd4b63b4199fe9bc
     contact-light.png  a333db21dc4df51a52ba50d226e2aeebf5b9d261c04bbf9810a3ad9307073fc0
     run.json  8e78c7effc452b15466960d1d65cf0b2ff87368c7ed6449521db2595a5dc0462
   AssertionError: INCONCLUSIVE: AC4: no taste call is recorded on these contact sheets (TASTE.json's verdict is null); this is not a pass
   ```

3. **21:53, call recorded.** `looks_right` was recorded on exactly those files, on the owner's delegation in session
   (`38a704445`). Run on the same folder, it kept the recorded files and passed:

   ```
    Test Files  1 passed (1)
         Tests  1 passed (1)
   ```

4. **22:02, after merging main (`c7df74473`).** The new binary took the sheets again. Both pictures came out byte for
   byte the same; only `run.json`, which names the binary, changed. With the call on the earlier `run.json`, it read:

   ```
   AssertionError: INCONCLUSIVE: AC4: the recorded taste call was made on other files than this run's; this is not a pass
   ```

5. **22:03, call re-recorded.** The call was recorded again on the merged app's three files and the test passed:

   ```
    Test Files  1 passed (1)
         Tests  1 passed (1)
   ```

The pictures are `docs/evidence/1592/contact-sheet/contact-light.png` and `contact-dark.png`.

## What is asked

One ruling: the redraft's test stands for AC4 in the first draft's place (design: Dogfooding). Both already run by hand
in `scripts/lanes.mjs`, so the lanes don't change.
