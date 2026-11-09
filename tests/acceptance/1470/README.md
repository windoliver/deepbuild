# Acceptance tests for #1470: menus pick on release

Written first, blind, by a job that saw only the issue, the design (Panel; Keymap, placement, window) and the base commit.
The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

Run (macOS only; Node 24 first on PATH, after `npm ci`):

```
CARGO_INCREMENTAL=0 npx vitest run --root tests/acceptance/1470 --no-file-parallelism --reporter=verbose
npx tsc -p tests/acceptance/1470/tsconfig.json
```

The first run builds `deep-drive` with the `env-plants` feature (#124's `buildDrive`).

## Criteria

IDs are `#1470.` and the first 8 hex of SHA-256 of the criterion's checkbox text in the issue body, trimmed, white space
collapsed.

| AC | ID | Test (`menu.test.ts`) |
|---|---|---|
| 1 | `#1470.505e6fae` | press on the trigger, move to row 2, release: `ran bravo 1`, `ran total 1`, the others 0, rows gone |
| 2 | `#1470.4c830268` | a click and a 2 px press-release leave the rows shown and run nothing; a later click on row 2 runs it once and closes; the planted always-release fails this journey |
| 3 | `#1470.ff7b4e38` | press on the trigger, release in empty panel space (from the panel box `see` reports): rows gone, every counter 0 |
| 4 | `#1470.51fc1f6d` | with the trigger given the keyboard by a click and the menu closed with Escape: Enter and Space open; Escape closes, runs nothing; Down/Up move the highlight and Enter picks once and closes; the open menu's text is the same by Enter, Space and click |

## The surface (the owner's decision; the implementer adds it)

`@deepbuild/panel` exports `Menu`: `new Menu(id, { label, rows: [{ id, label, disabled?, on_pick: (cx) => ... }] })`, returned from
a View's `render()`. It draws a trigger showing `label`; a left press on it opens the menu, its rows drawn inside the panel, in
order, each showing its `label`. `fixtures/menu/main.js` is the panel (imports only `@deepbuild/panel`): rows "Alpha row",
"Bravo row" (row 2), "Charlie row"; each `on_pick` adds one to `ran <id> <n>` and `ran total <n>`, lines drawn under the menu.

Readings are `see` snapshots: every string a node names or holds, with the first node's box for each. "Open" means the three
row labels are drawn; "closed" means none is.

## What the drive can and can't do

- No separate press, move and release steps. The closest real verb is `act drag` (down at the locator's centre, moves, up at
  the point), used for every pointer gesture here: criterion 1 and 3's slides, and criterion 2's 2 px drag. A `click` is down
  and up at one point.
- `act drag` resolves a `to` locator before anything is sent, and the rows exist only after the press opens the menu, so the
  slides use `to_point`. Each journey first reads row positions in a replica of its own, opened by a plain click, then
  drags in a fresh one. This assumes a menu draws its rows at the same place every time it opens.
- The drag's intermediate steps and speed are the drive's, so the 3 px threshold is tested at 0 (click) and about 2.2 px
  (`+2, +1`), and the slide at tens of pixels; the threshold's edge (3 px exactly) is not.
- The drive runs one replica at a time: every journey closes its replica (`close`) before the next launch.
- Scale is 1, so device pixels are points.
- The fixture mounts in the sidebar slot: `see` reports the panel as `[0, 0, 260, 600]` in the 800x600 window, the rest being
  the shipped centre view. Criterion 3's release point is therefore computed from that panel box (its horizontal centre,
  40 points above its bottom: below the counters, off every row), never hard-coded.
- The window has no Tab traversal into panel content: Tab, pressed up to 40 times, never focuses the trigger. A click on
  the trigger gives it the keyboard. So each keyboard journey starts with a click on the trigger, then Escape to close the
  menu that click opened, then the keys under test.
- The plant closes the menu on a click's release, so it can't show where the rows are. The plant test reads the row
  centres on an honest drive (stopped before the planted one starts) and passes them into the plant's criterion 1 and 3
  journeys; where a row is drawn doesn't depend on what a release does.

## The plant

`DEEP_DRIVE_PLANT=menu-release-always` (a build with `--features env-plants`, #1408): the Menu treats every release over an
open menu as a pick or a close: a release over a row picks it, any other release closes the menu, whether or not the press
moved. `crates/deep-replica/src/drive/plant.rs` takes the name, as for #124's plants. The AC2 plant test requires it to fail
the no-drag journey by closing the menu (`left the menu closed`) and to pass criteria 1 and 3, so it differs from the honest
program on that one journey. Without the plant being added, the replica refuses the name and the test is BLOCKED, not passing.

## Not verified

- Nothing here ran against an implementation: at the base there is no `Menu`, so every test fails on the missing export
  (`BASE-FAILURE.txt`).
- That Enter and Space open the menu and the highlight's start row are assumed from the brief; the Down/Up test reads only relative movement (one Down, two Downs, two Downs and an Up).
- "Keyboard use is unchanged" has no base to compare with (no Menu at base), so it is checked as the brief's keyboard
  behaviour, plus equal text between key- and click-opened menus.
- The Escape test leans on Escape twice: once in every keyboard journey's setup, then as the key under test (`enter
  escape`). It isn't circular: if Escape didn't close the menu, the setup would leave it open and the test's own Escape
  would leave it open too, and `shown` fails. But a broken Escape also fails the other keyboard tests, at their setup,
  so a failure there may name Escape rather than the key the test is about.
