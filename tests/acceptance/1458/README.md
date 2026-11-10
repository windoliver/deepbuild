# Acceptance tests for #1458: text sizes and spacing are roles of the look, as colors are, with a guard on bare numbers

Written first and blind, at base commit `2721ca7b` (main), from issue #1458 (its Scope, thirteen acceptance criteria and
Proof), the issues it leans on (#1003 for the fills and the look guard's refusal, #1157 and #883 for the notification's
clock time, #1453's rules 4, 6, 7 and 15, #1035's `chrome_fonts`), the design (`docs/technical-design.md`: Look, States
people see, Dogfooding; `docs/canvas-primitives.md`: Look `look@1`) and the base, before any implementation. The
implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). `TASTE.json` is the one file here a person's call changes.

**Read this first.** Every test ran once at the base; `BASE-FAILURE.txt` says what each reached. Twelve fail at a named
assertion. AC13 stopped `BLOCKED`: the screen was locked, so the real app's window never listed through #1454's probe
and no picture was taken. Run it again with the screen unlocked.

## What was read at the base

`crates/deep-replica` (`deep-drive`'s calls: `launch`, `see`, `act`, `wait_for` with `t`, `motion`, `close` and its
trace's notifications; `snapshot.rs`; `drive/glyphs.rs`, `drive/check.rs`, `drive/motion.rs`, `drive/plant.rs`; the
`env-plants` feature), `crates/deep-app/src` (`views.rs`, `card.rs`, `question.rs`, `states.rs`, `notify.rs`,
`chrome.rs`, `plain.rs`'s `planted`), `crates/deep-canvas-marks/src/look.rs` and `looks/clean.json`,
`scripts/color-literal-guard.mjs`, and the suites `1003`, `1455`, `1459`, `1454`, `327` (whose batched fixture is
reused) and `26`.

## How to run

With Node 24.22 first on `PATH`, `cargo` (1.99.1) on `PATH`, the workspaces built (`npm ci; npm run build
--workspaces`), on macOS, in a logged-in session:

```sh
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1458 --no-file-parallelism --testTimeout=600000
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1458 --testTimeout=600000 guard      # AC2, AC5, AC6
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1458 --testTimeout=600000 contrast   # AC3
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1458 --testTimeout=600000 replica    # AC1, AC4, AC7-AC12
DA1458_SCREENS=<dir> node node_modules/vitest/vitest.mjs run --root tests/acceptance/1458 --testTimeout=600000 pictures  # AC13
node node_modules/typescript/bin/tsc -p tests/acceptance/1458/tsconfig.json
```

- **Builds.** `deep-drive` is built with `--features env-plants` and then plain, `deep-canvas-render` plain, each copied
  to `$TMPDIR/da1458-bin-<uid>/`, so the checkout's `target/debug` never holds a plant. AC13 builds the plain `deep-app`
  (#1454's helper) and `deep-hook`, which its hub needs.
- **Permissions.** Only AC13 needs Accessibility and Screen Recording for the process running the tests (#1454's probe
  checks both); without them it stops `BLOCKED: …`, never passes.
- **Folders and processes.** Everything runs under `/tmp/da1458-*` (and #1455's, #26's and #806's folders where their
  helpers make them). A replica's home is a temp folder; nothing touches the real `~/.deepbuild`, `~/.claude` or
  `~/Library`. Only processes a test started are stopped, by PID.
- **Lanes.** `replica.test.ts` and `pictures.test.ts` build and draw, so the folder belongs on `scripts/lanes.mjs`'s
  one-at-a-time list, in a macOS lane; the implementer makes that edit. This job edits nothing outside this folder.
- Vitest writes `tests/acceptance/1458/node_modules/.vite/` under `--root`; delete it before committing.

## Pinned surfaces

The issue names the replica's snapshot, the guard script, the look and "the real app"; where it leaves the shape open,
this suite pins the smallest addition to what the base already has. The implementation must provide these.

1. **`runs` in the snapshot.** Every snapshot `deep-drive`'s `see` returns (`scope: "window"`, the default) gains a
   top-level `runs` list: one entry per string the frame drew through the chrome's text system (the strings
   `drive/glyphs.rs` already finds, named or not), each `{"text": string, "bounds": [x, y, w, h] in device pixels,
   "size": the font size it was shaped at in points, "face": the font family it asked for, "cut": whether its clip cut
   glyphs off it}`. A canvas item's own text stays in `items`. The other keys of the snapshot keep their base shape.
2. **`views` in the snapshot.** A top-level `views` list: each shipped view the frame drew, `{"name":
   "deepbuild/<view>", "bounds": [x, y, w, h]}`, the layout bounds of its `view:<name>` element (the id every shipped
   view already has at the base). A string or node belongs to the smallest view holding it; that view is what a failure
   names.
3. **The shipped pages** are the values `deep-drive`'s `launch.center` accepts, as its refusal of an unknown center lists
   them (at the base: `deepbuild/needs-you`, `home`, `session`, `welcome`, `agents`), and the question card, opened by a
   click on the choice ask's row on Needs you. A page added to `launch.center` is in every test here.
4. **The three sizes** are 11, 13 and 15 pt (the issue's small, body and title), compared to 0.01 pt.
5. **The chrome's faces** are named in the clean look as `chrome_fonts: {"text": <family>, "code": <family>}` (#1035's
   field), read from `deep-canvas-render look`'s answer for `{"look": "clean"}`. `code` is `JetBrains Mono`; `text` is
   the system face, one of `.SystemUIFont`, `system-ui`, `-apple-system`, `.AppleSystemUIFont`, `SF Pro`, `SF Pro
   Text`. A run's `face` is the family as its font asked for it, so a chrome string reads one of the two.
6. **The look's guard** is `deep-canvas-render look` as #1003's suite asks it. Every role named `ink` or `ink_*` but
   `ink_disabled`, including one a look adds, keeps 4.5:1 on #1003's six fills (`ground`, `raised`, `hover over
   ground`, `hover over raised`, `selected over ground`, `selected over raised`), and a look under it is refused as
   #1003 pinned: `{"ok": false, "code": "ink_contrast", "theme", "role", "on": <fill>, "ratio"}`.
7. **The source guard** is `node scripts/color-literal-guard.mjs [--root <dir>]`, as at the base: one line starting
   `FAIL` per finding, holding `<path>:<line>` (with the fix after it), exit 1; with none, exit 0 and no `FAIL` line.
   Under `--root` it reads that folder's `crates/`, `scripts/` and `contracts/` (what this suite copies). A size in the
   look (`crates/deep-canvas-marks/looks/clean.json`) is no finding.
8. **The plants**, each a wrong program a criterion names, selected by `DEEP_HUB_PLANT` and read by the app
   (`deep_app::plain::planted`'s way) only in a build with `env-plants`, which `deep-replica --features env-plants`
   turns on and a release build refuses:

   | Plant | Criterion | The wrong program |
   |---|---|---|
   | `fourth-text-size` | AC1 | a session's page draws its title at 17 pt |
   | `list-600pt-element` | AC4 | the list draws an element 600 pt wide, a `label` node with the id `planted-wide` |
   | `row-label-canvas-face` | AC7 | the list's session rows draw their text in Inter, the canvas face |
   | `time-flows-inline` | AC8 | a row draws its time in one flow between its title and its state word, so a wider time pushes the word |
   | `tooltip-kit-size` | AC9 | a kit tooltip keeps the kit's own text size, 14 pt |
   | `page-fades-250ms` | AC10 | a page change fades the new page in over 250 ms |
   | `row-says-ago` | AC11 | `Checkout page`'s row in the list reads its time as `2 min ago` |
   | `row-says-in` | AC11 | the choice ask's row on Needs you reads its default's time as `in 4 h` |
   | `step-state-in-label` | AC12 | a step's switch keeps the switch role and its value, and its label ends with its state, `· on` or `· off` |

9. **A row's time** is its own drawn string (the row's fixed slot, #1453 rule 3): `Checkout page`'s row, the node
   `session:01QACHEK000000000000000002` as at the base, draws `9 s` at the replica's start and `10 s` one second later.
10. **The real app (AC13)** is the plain `deep-app` on a real hub, through #1454's probe. Dark is asked for at launch with
    the arguments `-AppleInterfaceStyle Dark` (AppKit's argument domain; no system setting changes), and each window size
    is set through the probe's `place`. A page is reached as follows: Needs you is the first screen; the card is a press
    on its ask's row; a session's page a press on its row, shown once a node is named `Session Header layout`; first
    launch (`deepbuild/welcome`) is the app in a home where setup never ran, with no hub; any other page is a press on a
    node whose name holds the page's title as the replica draws it (its `<view>-title` node). Pictures are
    `<page>-<w>x<h>-<light|dark>.png` with `run.json`; `TASTE.json` is #1454's shape.
11. **A kit tooltip (AC9)** is a node of role `tooltip`, shown by hovering a control that has an id (up to twelve on each
    page) and running the clock 2 s; its strings are the runs inside its bounds.
12. **Still chrome (AC10)** is read from `deep-drive`'s `motion` recording (#1427): from the click on `Header layout`'s
    row in the list, which opens its page, over 1 s, no painted element changes its bounds or opacity on more than four
    of the recording's 1/120 s steps.
13. **A step's switch (AC12)** is, on the batched authority card (#327's fixture), each control naming one of the
    batch's steps: role `switch`, a non-null value that carries its state, and a label with no state word (`on`, `off`,
    `enabled`, `checked`, …). The card may show only the steps that fit; it must show one.
14. **Moments (AC11)**: the replica runs with `TZ=UTC`, so the choice ask's default applies at `12:00`. A moment reads
    `16:40`, `tomorrow 16:40` or `Mon 16:40`; an `at` before the clock time is read past (see Disputes 1).

## The fixture

`fixtures/pages.events.jsonl`, on the replica's clock (`NOW`, 1 800 000 000 000 ms, 2027-01-15 08:00 UTC):

- `Header layout` (`01QAHEAD000000000000000001`), the record's first session, with one open choice ask, `Keep the old
  logo in the header?`, whose default (`Keep it`) applies 4 h on, at 12:00.
- `Checkout page` (`01QACHEK000000000000000002`), which the core lists `quiet`, last seen 9 s before `NOW`.
- #327's batched authority asks (`Cart totals`), verbatim but for their log positions: four asks, each with a plan of one
  step, batched, so the card for `Push feat/cart to origin?` shows the batch's steps.

## Criterion to tests

IDs are `#1458.` and the first 8 hex of SHA-256 of each criterion's text, trimmed, white space collapsed
(`scripts/proof-change.mjs`, `criterionId`). Every plant's test holds the clean run to the same judge first
(`expect.soft`), so a program that already fails can't make its plant look caught, and a plant the build ignores fails
as "wasn't caught".

| Criterion | ID | Test | Wrong programs it fails on | Run |
|---|---|---|---|---|
| AC1 three sizes | `#1458.dd02bb24` | `replica.test.ts`: every run on every shipped page and the card, at 1512×982 light, is 11, 13 or 15 pt; then the plant's session page fails naming `deepbuild/session` and 17 pt | the base (no `runs`; it draws at the extra-small size); `fourth-text-size` | `replica` |
| AC2 bare `px(37.)` | `#1458.6aab01b3` | `guard.test.ts`: the guard passes an unplanted copy; a copy with `fn planted_1458() -> Pixels { px(37.) }` appended to `views.rs` exits 1 naming `crates/deep-app/src/views.rs:<line>`; a copy whose clean look holds 37 passes | the base (fails its three color lines; passes `px(37.)`) | `guard` |
| AC3 inks clear 4.5:1 | `#1458.50054406` | `contrast.test.ts`: from the clean look's resolved roles, every `ink`/`ink_*` role but `ink_disabled` on all six fills, light and dark, ≥ 4.5:1 (the table is printed); the clean look with `ink_tertiary` at 3.5:1 in light (`#1b1d2285`, the base's own value; in dark the clean look's dark secondary ink, so only the light pair fails) is refused `ink_contrast`, naming `ink_tertiary` and a fill, ratio under 4.5 | the base (`ink_tertiary` 3.50:1 on the ground, 3.0 floor accepts the plant) | `contrast` |
| AC4 fits 960×640 | `#1458.a98be9c0` | `replica.test.ts`: at 960×640, no run is cut by its clip or ends past its pane or the window, and no node ends past its pane's right edge; then the plant fails naming `planted-wide` and `960×640` | the base (no `runs`/`views`); `list-600pt-element` | `replica` |
| AC5 main's three lines | `#1458.c735b2b1` | `guard.test.ts`: the guard passes this checkout with no `FAIL` line; this checkout's guard over the merge base's tree (`git archive`) exits 1, and its lines are printed for the PR | the base (its own three lines fail) | `guard` |
| AC6 `.gap_6()`, `.text_sm()` | `#1458.3326ddd5` | `guard.test.ts`: each appended to `views.rs` in its own copy, the guard exits 1 naming `views.rs:<line>` | the base (passes both) | `guard` |
| AC7 chrome face | `#1458.0c2959d0` | `replica.test.ts`: the clean look names `chrome_fonts` (code JetBrains Mono, text the system face); every run's face is one of the two; then the plant fails naming `deepbuild/sidebar` and Inter | the base (no `chrome_fonts`, no `runs`); `row-label-canvas-face` | `replica` |
| AC8 a ticking time | `#1458.52c35293` | `replica.test.ts`: `Checkout page`'s row draws `9 s` as a string of its own, `10 s` one second later, and every other string in the row keeps its text and bounds | the base (one string `Checkout page · quiet · last seen…`); `time-flows-inline` | `replica` |
| AC9 kit tooltip | `#1458.a3834e1a` | `replica.test.ts`: hovering controls shows a `tooltip` node on some shipped page, and every string in it is 11, 13 or 15 pt; then the plant's tooltip fails naming 14 pt | the base (no tooltip shows); `tooltip-kit-size` | `replica` |
| AC10 still chrome | `#1458.889098b6` | `replica.test.ts`: the motion recording of opening `Header layout`'s page from the list shows nothing moving or fading over more than four steps; then the plant fails naming `deepbuild/session` | `page-fades-250ms` (the base passes the clean half and fails "wasn't caught") | `replica` |
| AC11 one way to write a time | `#1458.5350b8ad` | `replica.test.ts`: no string on any page, the card or the ask's notification reads a length with `ago` or after `in`; the choice ask's row, card and notification each name the one moment `12:00`; each plant fails naming its string | the base (`last seen 9 s ago`, `applies in 4 h`, no moment on the row); `row-says-ago`; `row-says-in` | `replica` |
| AC12 a step's switch | `#1458.be1a2dad` | `replica.test.ts`: on the batched card each step's control is a `switch`, valued, with no state word in its label; then the plant fails naming the step's switch | the base (steps are `button`s, no value, `· on` in the label); `step-state-in-label` | `replica` |
| AC13 shown to you | `#1458.f1c33792` | `pictures.test.ts`: from the real app, every shipped page and the card at 960×640 and 1512×982, light and dark, each once its page is on the window's tree, to `$DA1458_SCREENS` with `run.json`; then `TASTE.json`: no call, an anonymous one or one on other files is `INCONCLUSIVE`, `looks_wrong` fails quoting its note, `looks_right` on exactly these files passes | no call recorded (`INCONCLUSIVE`); a page the real app can't open (at the base, `deepbuild/home`) | `pictures` |

No criterion but AC13 reads a picture, and AC13 judges none: its pictures are taken once the page is on the tree, and
the taste call is the person's.

## The taste call (AC13)

`$DA1458_SCREENS` (a temp folder without it) gets the pictures, each `2w × 2h` px from the real window, and `run.json`
(this checkout's commit, the app's SHA-256, the pages). `TASTE.json`'s `verdict` is `null` until a person calls it.
Take the pictures once, call them, record each file's SHA-256 with who and when, and run again against the same folder:
a kept folder holding exactly the files of a recorded call, with the same `run.json`, stands without new pictures.

## Disputes and assumptions a redraft may revisit

1. **"at 16:40" or "16:40".** #1458 writes a moment `16:40` / `tomorrow 16:40`; #1157 and #883 have the notification
   say `at 16:40` / `tomorrow at 16:40`. AC11's judge reads past an `at`, so both forms pass "one moment in one form";
   the day word must match.
2. **The issue's line numbers are stale**: it names `panel_check.rs:184`; at the base the literal is at `:196`
   (`panel_tree.rs:246` and `:249` match). AC5 judges the guard's whole pass, not the numbers.
3. **`muted`** (slate, 3.24:1 on the light ground) colors a bound value past its freshness but is not named `ink`;
   AC3 judges only `ink`/`ink_*` roles. "Text has two inks and disabled" suggests it goes too; that is the Scope's.
4. **A 600 pt element at 960×640** fits the base's page pane (700 pt), so the plant is in the list (260 pt), where it
   outgrows its pane. "No scroll bar across the page" is read as nothing wider than its pane, the overflow that would
   need one: the kit's scroll bars have no role in the snapshot.
5. **Canvas text** (a chart's caption, drawn by the canvas) is not in `runs` (Pinned 1); AC1 and AC7 judge the chrome's
   strings. "Inter stays for the canvas" agrees for AC7; for AC1 a canvas caption off the three sizes would escape.
6. **"Each shipped page"** is today's `launch.center` list and the card, not the epic's later list (#1465). At the base
   the real app has no way to Home; AC13 fails naming it until one exists.
7. **AC8 and AC9 name no wrong program**; `time-flows-inline` and `tooltip-kit-size` are this suite's mutants. AC8 reads
   strings, not single glyphs: inside one string a time and its neighbours can't be told apart, which is why the time
   is pinned as its own string.
8. **"The merge base's failure is named in the PR"** can't be seen by a test; AC5 prints it for the PR and requires it
   to be a failure.
9. **Which windows and appearances.** AC1, AC7, AC9 and AC11 render at the reference window in light; AC4 at 960×640
   in light. Sizes, faces and words don't change with the appearance, and AC4's criterion names one window.
10. **A page change in the replica.** At the base a click on a session's row (or on Agents) in the replica opens no page:
    nothing under `view:deepbuild/session` is painted after it. AC10 needs a page change to record, so Pinned 12 asks
    the replica to open a session's page on that click, as the real app's list does; until it does, AC10 fails naming
    that, never passes.
11. **Not covered by a criterion, so not tested:** the 4 pt space scale and the one radius as data, the shell widths as
    roles, line heights and weights, uppercase and letter spacing, a look pack leaving `type` and `space` alone, the
    kit's theme reading faces and radii, overlays fading at 120 ms, the one control builder's main and plain kinds, and
    a card without borders with its question largest.

## Files

- `helpers.ts`: builds, the `deep-drive` client, page renders, every judge, the guard and look guard runners, the taste
  reader.
- `replica.test.ts` (AC1, AC4, AC7-AC12), `guard.test.ts` (AC2, AC5, AC6), `contrast.test.ts` (AC3), `pictures.test.ts`
  (AC13).
- `fixtures/pages.events.jsonl`: the record. `TASTE.json`: AC13's taste call, unrecorded. `tsconfig.json`: as #1459's.
  `BASE-FAILURE.txt`: the run at the base.

## Swapped: AC13

AC13's first test waited for the card option "Drop it", which only the replica's fixture offers, while the real app's
world it seeds (through #26's helper) offers "SQLite" and "Plain files"; and it had no way to Home in the real window.
It was redrafted blind from the issue, the design and the base `2721ca7b`, and swapped in with the owner's approval:
`redraft-ac13/shown.test.ts`, its `TASTE.json` and README. `pictures.test.ts` and this folder's `TASTE.json` are gone;
the rows above that name them read as `redraft-ac13/`.
