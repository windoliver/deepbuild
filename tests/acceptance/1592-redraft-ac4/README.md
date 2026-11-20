# #1592 AC4, redrafted blind: a contact sheet of every state mark and icon

A blind redraft (design: Dogfooding) of AC4 of #1592, written at base `f6ddd396f` from the issue, the design and the
base's code, before and apart from any implementation. No implementation of #1592 and no other test of it was read.
`TASTE.json` is the one file here a person's call changes; the implementing agent doesn't edit the rest (AGENTS.md, Proof).

## Criterion → test

| Criterion | ID | Test |
|---|---|---|
| AC4: "Shown to you: a contact sheet of every state mark and icon in light and dark, taken by the check run from the real app, is attached to the PR and shown to you. Whether it looks right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS" | `#1592.15a3cc5f` | `shown.test.ts`, one test |

The ID is `scripts/proof-change.mjs`'s `criterionId` of the criterion's text in the issue body.

`shown.test.ts` builds the real `deep-app` with its `contact-sheet` probe and runs it twice, light then dark. Each run
opens the app's real window on this Mac's screen with the contact sheet, reads back the frame that window presented, writes
it as a PNG and prints one report line saying what it drew where. The test checks those reports and the pictures' sizes,
writes `run.json`, prints each file's SHA-256, then reads `TASTE.json`. No part of it judges a picture: whether the sheet
looks right is the person's one call.

| Reads | When |
|---|---|
| BLOCKED | not macOS, or cargo can't be started |
| FAIL | the build fails (at the base, `deep-app` has no `contact-sheet` feature); the app exits non-zero or prints no report line; a sheet isn't written, or isn't its window at the report's scale; a sheet has no mark for a status-map entry, or a mark for something that is no entry; no icon on either sheet; a sheet lacks an icon at 14 or at 16 that either sheet shows; a mark or icon outside its window; a report with no window size, or an icon with no name; a report that names the other appearance; the light and dark sheets are the same picture; `TASTE.json` holds `looks_wrong` on exactly this run's files (the message quotes its `note`) |
| INCONCLUSIVE | a sheet was drawn at a scale other than 2; `TASTE.json` holds no call, a call that isn't for #1592 AC4 or names no one or no time, or a call on other files than this run's |
| PASS | every check above holds at scale 2, and `TASTE.json` holds `looks_right` for #1592 AC4, with `who` and `when`, on exactly this run's three files |

## Surface choices (pinned here: the implementation provides these)

The issue leaves the surface open. These are the smallest real surfaces that fit the repo's probe convention and run in
sessions that have Accessibility but no Screen Recording.

- **Binary and build.** `deep-app`, built from the tree with one more Cargo feature, `contact-sheet`, declared in
  `crates/deep-app/Cargo.toml` and in no shipped build, as `chrome-fixture`, `canvas-fixture` and `hdr-fixture` are:

  ```sh
  CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-app --bin deep-app --features contact-sheet
  ```

  The test copies `<target>/debug/deep-app` (`CARGO_TARGET_DIR` honored, relative to the checkout) into a temp folder
  `da1592-bin-*`, runs the copy, and removes it after. The checkout's `target/debug/deep-app` is left as this build.
- **Flag.** `deep-app --contact-sheet <png>`: a probe mode that `main.rs` dispatches as it does `--chrome`, `--canvas` and
  `--hdr`, in a file of its own under `crates/deep-app/src/probes/`, compiled only with `contact-sheet`. It:
  - starts as the app's window does (`gpui_kit::init`, `deep_app::init`), in the appearance `DEEP_APP_APPEARANCE` names,
    `light` or `dark`: the variable `main.rs` reads to force the app's appearance, which this mode honors too;
  - opens one real window on this Mac's screen whose content is the contact sheet: the mark of each status-map entry
    (`pass`, `fail`, `invalid`, `blocked`, `inconclusive`, `running`, `needs_you`, `stale`, `idle`), drawn by the code that
    draws the status mark on the shipped rows and pages, in its 16 slot; and every icon of the one icon set the chrome
    draws, each at the row size, 14, and at the page size, 16, drawn by the builder the shipped views draw icons with. The
    layout, the ground and the labels (each mark's entry and the state words that share it, each icon's name and size) are
    the implementation's, from the look's roles; the test reads none of them;
  - once the window has drawn the sheet, reads back the frame that window presented, as `deep-app --chrome <fixture>
    --snapshot <png>` does in `chrome_fixture.rs` (`layer_colorspace::read_next_frame()`, a refresh, then
    `layer_colorspace::take_frame()`), and writes it to `<png>` at the window's scale. No window-server capture, so no
    Screen Recording permission;
  - prints one JSON report line on stdout and quits with status 0:

    ```json
    {"contact_sheet": 1592, "appearance": "light", "scale": 2.0, "window": [w, h], "png": "<the path written, or {\"error\": …}>",
     "marks": [{"entry": "pass", "rect": [x, y, w, h]}, …],
     "icons": [{"name": "x", "size": 14, "rect": [x, y, w, h]}, {"name": "x", "size": 16, "rect": [x, y, w, h]}, …]}
    ```

    `appearance` is the one drawn; `scale` the window's scale factor; `window` the size in points of what the frame covers,
    the window's content; each `rect` an item's bounds in points from the content's top-left; `size` an icon's size in
    points; `name` the icon's name in the kit's icon set (its file name there without `.svg`), the same in both
    appearances. Other fields are allowed and ignored.
- **Each run's HOME.** A temp folder `da1592-home-*`, also the working directory, removed after the run. Nothing touches
  the real `~/.deepbuild`, `~/.claude` or `~/Library`.
- **Files.** `contact-light.png`, `contact-dark.png` and `run.json` (`{"issue": 1592, "criterion": "AC4", "app": <SHA-256
  of the deep-app binary>, "reports": {"light", "dark"}}`, each report as printed less its `png` path), in
  `$DA1592_SHEETS`, or in a new temp folder `da1592-sheets-*` without it, which the run leaves for you to look at.
- **The taste call.** `TASTE.json` in this folder, #1461's shape: `issue`, `criterion`, `verdict` (`looks_right` or
  `looks_wrong`), `who`, `when`, `files` (each of the three file names with its SHA-256, as the run prints them) and `note`.

## Recording the call

1. Run once with `DA1592_SHEETS=<dir>` and look at `contact-light.png` and `contact-dark.png`.
2. Fill `TASTE.json`: `verdict`, `who`, `when`, `files` as the run printed them, and a `note`, which a `looks_wrong` must
   carry, since the failure quotes it.
3. Run again with the same `<dir>`. A folder holding exactly a recorded call's files, whose `run.json` names this same app
   binary, stands: the run doesn't take the sheets again. A run with another folder or another binary takes them again,
   and the call holds only if every file comes out byte for byte the same.

"Attached to the PR and shown to you" is the implementing agent's: no test can see it.

## How to run

On macOS, logged in, with the screen unlocked and the window on a display at scale 2. No Accessibility or Screen
Recording permission is needed. With cargo 1.99.1 and Node 24.22 first on `PATH`:

```sh
npm ci --ignore-scripts
DA1592_SHEETS=<dir> caffeinate -di npx vitest run --root tests/acceptance/1592-redraft-ac4 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1592-redraft-ac4/tsconfig.json
```

It runs by hand (`scripts/lanes.mjs`, `byHand`): it opens the app's window on your screen and waits on your call. Most of
its time is one debug build of `deep-app`; each of the two app runs takes seconds, at most 5 minutes before it's stopped,
by its PID. Vitest writes `node_modules/.vite/` under `--root`; delete it before committing.

## Ambiguities a redraft may revisit

1. **"Every state mark."** One mark per status-map entry, nine (the issue: "one mark per entry. Two state words that
   share an entry share its mark"). The entries are the design's (`look@1` `status`; States people see), not read from
   the look file, whose shape #1593 may change. The sheet may show a mark more than once, beside each word that shares
   it; the test needs each entry's mark at least once and no mark for something that isn't an entry.
2. **"Every icon."** Every icon of the one icon set the chrome draws, not the whole of the kit's icon set (1,830 icons
   at the pinned commit, nearly all unused), each at both sizes, 14 and 16, whichever size the views use it at: the issue
   sets one icon set at two sizes. The test can't tell whether that set covers every icon on the shipped pages; that is
   AC1's to prove and the person's to see. No icon at all fails: an icon set with none isn't one. Nor does the test check
   that a name is the kit's: it only tells the icons apart.
3. **"Taken by the check run from the real app."** The run itself builds and starts the real `deep-app`, only a probe flag
   added by a feature no shipped build has, and takes the frame its real window presented on this Mac's screen. A replica,
   headless or offscreen picture doesn't count. A window-server capture (`screencapture -l`, #1454's `App.capture`) isn't
   used: these sessions have Accessibility but not Screen Recording, and it would stop BLOCKED whatever the app does. A kept
   folder from an earlier check run of the same binary counts as taken by the check run. That the marks and icons are drawn
   by the shipped views' own code is the implementation's to keep; the test can't see it, the person sees the result.
4. **"In light and dark."** `DEEP_APP_APPEARANCE=light` and `=dark`, one app run each, since macOS has no outside switch
   for one process's appearance. No system setting changes.
5. **A sheet's scale.** The pictures are taken at the window's scale; anything but 2 reads INCONCLUSIVE, since the
   reference Macs draw at 2 (#1454's reference window) and a 14 pt icon at 1× shows less than the person would see there.
6. **"One taste call, recorded."** One call covers both sheets and `run.json`, which ties it to the app binary and the
   reports, so a call made on one build's sheets says nothing about another's.

## Base result

At `f6ddd396f` the test FAILs at the build, at the missing surface: `deep-app` has no `contact-sheet` feature, so the real
app has no contact sheet to draw (`BASE-FAILURE.txt`, one run).

## Checked before commit

Besides that base run, the test's own checks were exercised once against a throwaway stand-in for `deep-app
--contact-sheet` (not kept): with no call it read INCONCLUSIVE; a `looks_right` call on its kept files passed, and so did a
fresh folder whose files came out byte for byte the same; `looks_wrong` failed quoting its note; a call on other files read
INCONCLUSIVE; a sheet without `idle`'s mark, one without an icon at 16 in dark, dark drawn as light, an icon outside its
window each failed naming it; scale 1 read INCONCLUSIVE.

## What was read

- Issue #1592's body; #1453 (rules 5 and 10), #1458, #1461 and #1593 only for the words #1592 cites.
- `docs/technical-design.md`: Look, States people see, Panels and devices (trusted ring) with its Replica, How we know
  version 0 works (Tests written first, Dogfooding). `docs/canvas-primitives.md`: Look `look@1`.
- At the base: `crates/deep-app/Cargo.toml`, `src/main.rs`, `src/probes/{chrome,canvas,hdr}.rs`, `src/chrome_fixture.rs`,
  `src/chrome_gallery.rs`, `src/views.rs` (`status`, `marked`, a row's mark slot), `src/states.rs`;
  `crates/deep-canvas-marks/looks/clean.json`; `crates/deep-replica/src/chrome.rs` (the gallery);
  `vendor/gpui-pre-apple`'s `layer_colorspace`; the kit's icon component and icon folder at the pinned commit;
  `scripts/proof-change.mjs` (`criterionId`), `scripts/lanes.mjs`; the suites `1434` (helpers, AC8), `1436` (AC10),
  `1454` (helpers, `TASTE.json`), `1458/redraft-ac13` and `1461` (`shown.test.ts`, `TASTE.json`, `tsconfig.json`).

## Files

- `shown.test.ts`: the test.
- `TASTE.json`: the call, empty until a person makes it.
- `BASE-FAILURE.txt`: the trimmed output of one run at the base.
- `tsconfig.json`, `README.md`.
