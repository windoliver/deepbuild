# Blind redraft for #3236, criterion 8: the live tree read through AppKit

Criterion ID `#3236.b9b04201` (`criterionId` in `scripts/proof-change.mjs`, checked against the live issue's text): "On the
reference Mac, the live tree read through AppKit holds the node's value, and the walk's announcements equal the
replica's. If the platform can't be read, this criterion is BLOCKED, naming where it stopped". One criterion, one test.

Written from issue #3236 (its text, no comment), the design and base commit `f8c6cff82`, by a job that saw no
implementation, no earlier draft of these tests, no pull request and no commit after the base (AGENTS.md, Proof; design:
Dogfooding). The implementing agent doesn't edit these files. One disclosure: the job's standing notes held a line saying an
earlier run of this criterion read BLOCKED because the live window couldn't be read. It was neither opened nor used, and the
client was tried on the base's own window, which it reads (The base).

## What was read

- Issue #3236, and for context the bodies of #376 and #539.
- `docs/technical-design.md`: Rules every primitive follows (Accessible: the tree and its announcements "are compared as
  data in a replica; a screen-reader run is a smoke test, never the check"), Mark set, scale and encode, Replica,
  Dogfooding, Tests written first, Repo guards. `docs/canvas-primitives.md`: Mark set and columns `marks@1`, Control: picks on
  rows and grid focus, Scale and encode, Asset: tables (a column's `unit`).
- At the base, for surfaces only: `crates/deep-show` (`access.rs`, `live.rs`, `main.rs`'s `live`, `hub/presented.rs`,
  `picks.rs`), `crates/deep-play/src/access.rs`, `crates/deep-canvas-marks/src/data.rs` (columns, scales),
  `vendor/accesskit_macos/src` (`node.rs`, `event.rs`, `adapter.rs`, `subclass.rs`), `vendor/gpui-pre` (how a window builds its
  tree once a client asks), and the `accesskit_consumer` release it uses.
- The suites `539`, `376`, `1045`, `1454`, `1459`, `1551`, `1592`, `268-redraft-ac4`, `2215-redraft-ac5`, for form and helpers;
  `scripts/proof-change.mjs`, `scripts/benchmark.mjs`, `scripts/lanes.mjs`, `scripts/wait-ratchet.mjs`.

No expected text comes from the code: the replica's `see` gives each one.

## The surface

Everything this suite relies on. The calls are #539's and #376's, with no new call, reply field or planted name.

| Side | What is sent | What is read |
|---|---|---|
| The replica | `deep-show run`, one scenario line (#539's `scenario`: `evidence`, `sessions`, `processes`, `panels.p1.rect` `[0, 0, 480, 270]`, `docs`, `clock`, `display`) whose `calls` are `deep_show` (the fixture, `include: ["issues"]`), `scope`, `input {type: "key", key: "Tab"}`, `input {type: "key", key: "ArrowRight"}` eleven times, `see`, each at its `at` | `replies[0].outcome` is `presented` with no error issue; `see.tree`: the node whose `id` is `scatter`, its `value`, a string that isn't empty; `see.announcements`: every `text`, in order, at least one |
| The live window | `deep-show live`, the same scenario line (with an evidence folder of its own) | one answer line, `ok: true`; then its window, from outside its process |
| Its tree | the Accessibility API: `AXWindows` of the process, `AXChildren` from each down | an element's `AXIdentifier` (the item's ID, as `write_a11y_info`'s author ID gives it at the base); its `AXValue`, `AXDescription` and `AXTitle` |
| Its announcements | an `AXObserver` with info on the application element for `AXAnnouncementRequested` | each notification's `AXAnnouncementKey` text: what `event.rs` posts on the window, `NSAccessibilityAnnouncementRequestedNotification` with `NSAccessibilityAnnouncementKey` |

**Judged only against the replica** (`judge` in `helpers.ts`). Every element identified `scatter` gives the replica's value,
white space collapsed, as its `AXValue`, its `AXDescription` or its `AXTitle`. The announcements the window asks for are the
replica's, white space collapsed: each text as many times, and all in the same order.

**The replica fails first, on its own assertions**: the scatter presented, its node holding a value, its landings announced.
A walk's length, its texts and the value's words are criteria 1 and 3, not judged here.

**When the window speaks isn't assumed.** The client starts right behind `deep-show live`, before its window exists, and asks
for announcements until AppKit takes the observer, so it hears from as early as the platform allows; it reads the tree the
moment a window lists, which is what makes an AccessKit window build its tree and raise its events. Then it listens: at least
45 s from the listing, until as many announcements came as the replica made and none for 20 s, and never past 240 s (or the
window's end). The tree is read when the identifier first shows and again at the end of the listening; the end's read is
judged, the state `see` reads after the walk.

## The fixture

The issue's scatter: `marks@1`, `mark: point`, `n: 12`, columns `x` (f64, 0 to 11, `unit: "seconds"`) and `y` (f64, 2 to 40, one NaN,
the sixth row, `unit: "metres"`), `encode.x` and `encode.y` through two linear `scale@1` items with fixed domains, `role: "data"`, no
`key` and no control. Beside it a caption (`text@1`, `role: label`), a second item an assistive client hears, so a window that
identifies the caption and not the scatter fails while one that identifies nothing is BLOCKED. No digit or number word is in
any text the document shows. The figure is 480 × 270 u on a panel of that size, so the window is small.

## Readings where the issue leaves a choice

- **"Read through AppKit"** is the Accessibility API from another process, as VoiceOver and every assistive client read a
  window. VoiceOver itself isn't turned on: the design makes a screen-reader run a smoke test, and turning it on would
  speak over the person's work.
- **"Holds the node's value"** is the same text on the element that carries the item's ID, in any of the three attributes
  a client takes a node's words from. The text alone counts, not which attribute, since the issue doesn't say how AppKit
  should carry it.
- **"The walk's announcements"** are every announcement `see` lists in the run, whose only moving thing is the walk, and
  every announcement the window asks for while it's listened to.
- **The walk** is Tab, then Right eleven times: every drawn row is landed on whether Tab enters on the first row (as
  #539's focus does) or only reaches the set. Pressing past the last row lands on nothing new under either reading.
- **A column's unit** is a `unit` string on the column, the design's name for it (Asset: tables; Scale and encode: "the column's
  unit"). A wrong choice of field would leave the unit out of both sides alike, so it can't turn this criterion.
- **The reference Mac** is any of `scripts/benchmark.mjs`'s `references`, by model, chip and memory. Power, thermal state and load
  are not read: nothing here is timed.
- **Which Right** key: `ArrowRight`, as #539's `input` takes it.

## BLOCKED, naming where it stopped, never a pass

Off macOS. Off the reference Macs. No `swiftc`. No Accessibility trust (`AXIsProcessTrusted`). The screen locked, or no login
session on the console (`CGSSessionScreenIsLocked`, `kCGSessionOnConsoleKey`), or the display asleep (`CGDisplayIsAsleep`): read
before the build, again just before the window opens, four times a second while it's read, and after it closes, so a screen
that locks midway never reads as anything else. `deep-show live` answering `no_window`, `no_display` or `unsupported_platform`. No
window AppKit lists within 30 s of the answer. A window with no element identified as any item of the document.
The gates that cost nothing run before the build.

One more, this job's reading: **a covered window**. At the base a window AppKit reports hidden stops its display link
(`gpui-pre-macos/src/window.rs`, `window_did_change_occlusion_state`), so nothing redraws it and an AccessKit tree raises nothing, and on
a Mac others are using a window is often covered. So announcements that are only missing, the rest the replica's in their order,
read BLOCKED when, for each, the window was off the screen or wholly behind other windows (12 × 12 points of it, two samples in a
row or more) at some moment between the announcement heard before it and the one heard after it. One missing while the window was
shown throughout that stretch is a FAIL, as is one said twice, out of order or not the replica's, and a value that differs, wherever
the window was. A window that says everything though covered passes.

## The client, the stand-in and the unit checks

`client.swift`, compiled with `swiftc -O` into a temporary folder, is the assistive client. It presses, types, raises and closes
nothing. Announcements are taken on a thread of their own, so a slow tree read never holds one up.

`standin.swift`, never shipped, is one AppKit window that gives a client what a window drawn through `vendor/accesskit_macos`
gives it: a content view whose `accessibilityChildren` is a root group of `NSAccessibilityElement`s with a role, a title, a value
and an identifier, built when a client first asks; announcements posted on the window with `NSAccessibilityAnnouncementKey` and
the medium priority. It never takes the focus, and its window floats above ordinary ones so that nothing on the person's
screen covers it (a covered one that skips would be BLOCKED, the judge's own rule, checked without a window). `client.test.ts`
(its tests named `client: …`, no criterion's tag, no `deep-show`) runs the same client and the same judge over it:

| Stand-in | Verdict |
|---|---|
| right, with a text past ASCII and one announcement said twice in a row | the identifier and value read back exactly, seven announcements in order, PASS |
| a stale value (40 read as 55) | FAIL, naming both |
| skips an announcement | FAIL, naming it |
| says one twice | FAIL, naming it |
| swaps two | FAIL, naming the first |
| no identified element | BLOCKED |
| no window | BLOCKED after 30 s |

and, on reads without a window: a screen that locked or slept is BLOCKED whatever it holds; announcements only missing are
BLOCKED when the window was hidden as each could have come and FAIL when it wasn't, and one doubled, swapped or added, or a
stale value, FAILs though it was hidden throughout; each of the three attributes can carry the value; a tree that identifies
only the caption FAILs. `TWINS-RUN.txt` is its run here, for real, with five broken copies of the suite that each fail the
check that should see them, and the criterion's own test over a made-up `deep-show`.

## Wrong programs the criterion's test fails

The stand-ins above, which are the judge's wrong programs, since no implementation existed to break: a live tree without the
value, with a stale one, or with it on another item; a window that asks for no announcement, for some of them, for one
twice, for two in another order, or for texts that aren't the replica's. On the replica's side: the scatter refused, its node
without a value, a walk no landing of which is announced. The base is one of them (`BASE-FAILURE.txt`).

## Run it

```sh
npm ci   # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 \
  scripts/lease npx vitest run --root tests/acceptance/3236-redraft-ac8 --testTimeout=600000 --hookTimeout=3600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/3236-redraft-ac8/tsconfig.json
```

In a logged-in, unlocked session, with the app that runs the tests allowed under Privacy & Security, Accessibility. `client` as
an argument runs the unit checks alone, with no build; `live` the criterion alone. The criterion's file builds `deep-show` once
(`cargo build --locked --bin deep-show`, through #539's helpers: `CARGO_TARGET_DIR` honored, rustup's bin first on PATH). Windows
open on the person's screen: six small ones for a few seconds each in `client`, and one, 480 × 310 points, for up to about four
minutes in `live`. Each process is stopped by the handle it was started with. Vitest leaves
`tests/acceptance/3236-redraft-ac8/node_modules`; delete it.

**The lanes line.** Both files open real windows, and one builds `deep-show`, so the implementer adds
`'tests/acceptance/3236-redraft-ac8/'` to `scripts/lanes.mjs`'s `alone` list, in a macOS, logged-in lane.

## The base

The criterion's test FAILs on the base at its first assertion, before any window: the replica refuses the scatter (`out_of_range`
at `items/scatter/params/columns/y/data`, the NaN), as `BASE-FAILURE.txt` records. With a number in the missing row's place the
same document is presented with no issue, its node has no `value`, Tab and Right focus nothing, and nothing is announced.

The client was also tried on the base's own window, in a scratch run outside this suite, so that what it reads isn't only the
stand-in's. `deep-show live` on #376's figure, its readout at 3, then 4, then 5: seven elements identified by their IDs with
their roles and titles, `count`'s AXValue `Rays: 5` at the end, and the announcements `Rays: 3` (81 ms after the window listed: a live
region is announced when a client first asks for the tree), `Rays: 4` (6.2 s) and `Rays: 5` (12.3 s), each once. On this
fixture with no row missing: `scatter` (AXStaticText, titled by its name, no value) and `caption`, which the judge FAILs for
want of the value and the announcements, not BLOCKED.

## Files

- `live.test.ts`: the criterion's one test. `client.test.ts`: the unit checks. `helpers.ts`: the gates, the client's run, the judge, the
  fixture. `client.swift`, `standin.swift`, `tsconfig.json`, `BASE-FAILURE.txt`, `TWINS-RUN.txt`.
