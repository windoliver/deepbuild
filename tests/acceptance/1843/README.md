# Acceptance tests for #1843: the card re-arms on every trigger the design names

Written first and blind, at base commit `2c79d71eb`, from issue #1843 (updatedAt 2026-11-10T01:33:17Z, no comments: its
problem, Scope, three acceptance criteria and Proof), the design and the base, before any implementation. The implementing
agent does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- Issue #1843.
- `docs/canvas-primitives.md`: Question card (`rearm_on`, `arm_after`, what a press needs, "each `rearm_on` change returns the
  card to presented and restarts the interval", what it can never do). `docs/technical-design.md`: Wrong programs, Dogfooding,
  Tests written first, Repo guards.
- At the base: `crates/deep-app/src/{arming,card,question,trusted_input,answer,plain,frame,views,open,main,keystore}.rs` and its
  `Cargo.toml`; `crates/deep-replica/src/drive/{mod,frames,see,hubcopy}.rs`; GPUI's windows (`vendor/gpui-pre`: the test window's
  resize, visibility, display and activation; `vendor/gpui-pre-macos/src/window.rs`: first mouse, key, occlusion, move).
- The suites `327`, `1462`, `1808`, `1454`, `1606-redraft-ac5-ac9`, `3234`, `3236-redraft-ac8`, `1815`, `2569` (its cover) and
  `tests/unseen-window.*`, for form and helpers; `scripts/{proof-change,wait-ratchet,lanes,throttle}.mjs`.

## Surfaces

Merged, and used as they are: `deep-drive` (#124) with `launch {from: "fixture", frames: "dirty"}` (#1546), `open`, `see` (with
`hub`, #1462), `act` `click` at a point, `wait_for {t}`, `resize` (#1546); #1462's fixture record; the node ids `question-card`
(valued `presented`, `armed` or `answered`, #1459) and `card-option:<option id>` (#1462), in the snapshot and as the live
tree's AXIdentifier; the page node whose id is its address (#1460); `test-confirm` with `DEEP_APP_TEST_CONFIRM` (#1454) and
`test-secrets` with `DEEP_APP_TEST_SECRETS` (#1606), so no test is you and none reaches your Keychain; `DEEP_HUB_PLANT` in an
`env-plants` build (`plain::planted`); the hub's `events.read`.

**New, and the implementation must provide them:**

1. **`deep-drive`'s `window` call**: what the platform says of the replica's window, one thing a call, as `resize` already is
   for its size. `{"call": "window", "window": <one of>}`:

   | `window` | the platform says |
   |---|---|
   | `{"origin": [x, y]}` | the window is now at x, y on its display, in points |
   | `{"visible": true}` or `{"visible": false}` | the window is visible, or it is covered |
   | `{"display": n}` | the window is now on the display whose id is n; the tests name 2, and a replica opens on another |
   | `{"active": true}` or `{"active": false}` | the window is key, or another is |

   It reaches the app's window the way the platform tells a real one, so what the app's own window listens to hears it, and
   then takes one frame of the clock, as `resize`, `feed` and `open` do. The reply is `ok: true`. Nothing in it names the card or a
   trigger. The base refuses it by name: `"window" is no call`.

2. **Plants**, one a trigger, each selected by `DEEP_HUB_PLANT=<name>` and read through `plain::planted` in an `env-plants` build
   only (`deep-drive --features env-plants,deep-app/test-confirm`; `deep-app --features env-plants,test-confirm,test-secrets`),
   everything else as shipped: `card-ignores-move`, `card-ignores-resize`, `card-ignores-occluded`, `card-ignores-display`,
   `card-ignores-activation`. The card takes no notice of that trigger: one presented stays on the interval it was on, and one
   armed stays armed. For `card-ignores-resize` that means all of what a resize does to the card: the slot and the size it
   was armed with stand.

## How to run

With Node 24.22 and rustup's cargo first on `PATH`, Xcode's command line tools (`swiftc`), on macOS:

```sh
npm ci --ignore-scripts && npm run build --workspaces
node scripts/throttle.mjs test --wait 720 --hold 90 -- \
  caffeinate -di node node_modules/vitest/vitest.mjs run --root tests/acceptance/1843 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1843/tsconfig.json
```

- `clock` as an argument runs criterion 1 alone, headless: no window, no permission, no pointer. `real` runs 2 and 3.
- **Builds.** One of each binary, with the stand-ins and the plants, in a grant of the build throttle that a run inside a grant
  passes through: `deep-drive` through #1101's `driveBin(true)`, `deep-app` copied to `$TMPDIR/dd1843-bin-<uid>-<8 hex of the
  checkout's path>`. With no `DEEP_HUB_PLANT` such a build is the app with its stand-ins; a plant is only ever a name in it. Each
  is followed by the plain build, so the target folder keeps no plant. `CARGO_TARGET_DIR` is honored. `deep-hook` is built when missing.
- **Permissions.** `real.test.ts` needs Accessibility for the app the tests run under, and an unlocked, awake screen.
- **Folders and processes.** Every HOME is a temp folder; nothing touches the real `~/.deepbuild`, `~/.claude`,
  `~/Library/LaunchAgents` or your Keychain. Only what a test started is stopped, by PID. What was forward before comes back.
- **`--root` cache.** Vitest writes `tests/acceptance/1843/node_modules/.vite/`; delete it before committing.
- **Lanes.** `lane.json` runs the folder alone: it shares the screen.

## Criterion to tests

IDs are `criterionId` in `scripts/proof-change.mjs`.

| Criterion | ID | Tests | Wrong programs they fail on |
|---|---|---|---|
| AC1 | `#1843.5a8eb94d` | `clock.test.ts`: the control, then one test a trigger. The app's card on its ask's page in the replica's window, on its virtual clock; the trigger in the frame that ends 300 ms after the presentation; a press at 600 ms answers nothing and one at 800 ms answers, read from what the app sent its hub. Then the same on the armed card, at 700 ms: 1000 ms and 1200 ms | the base (it refuses the `window` call, naming the trigger that never reached the card); `card-ignores-<trigger>`, each naming its trigger: `after <trigger> at 300 ms, a press 600 ms after the card was presented answered ask:…`; a card that never arms, or stays held, fails the control or the press at 800 ms |
| AC2 | `#1843.3a7ab2f8` | `real.test.ts`: the real app's card armed at 960×640, then the window resized to 700×400 with part of it outside; a click in the same breath, then at 150, 400, 700, 1200, 2000 and 3500 ms on an option still in the window; no `ask.answered` within 30 s, never read armed from 500 ms on; then, back at 960×640, it arms and a click answers | `card-ignores-resize`, naming it: `after the window's resize from 960×640 to 700×400, … a click on the card answered ask:…: the card took no notice of resize`. The base likely passes the real window's test (BASE-FAILURE.txt) |
| AC3 | `#1843.0a3b77c9` | `real.test.ts`: a control click on the first ask's armed card in the active window answers; another app forward, the second ask's card armed behind it; the window server's click on its option brings the app forward and answers nothing; then it arms and a click answers | the base and `card-ignores-activation`, naming it: `the click that brought the inactive window forward (activation), landing on card-option:… answered ask:…` |

## Readings where the issue leaves a choice

- **"On the virtual clock"** is the replica's, and the card is the whole app's, in a window: the table, the card that holds it and
  what the window feeds it. The issue's Scope says the window's card feeds them from the platform, and only a trigger that
  comes as the platform says it (Surface 1) shows that. A table right by itself, with a window that never tells it, fails.
- **"At 300 ms"** is the frame that ends 300 ms after the presentation, so a card that hears a change as it is said, or at the
  frame after, passes alike: either way the interval starts at or before 300 ms, 600 ms is inside it and 800 ms is past it.
- **On the armed card too.** The criterion's trigger comes before the card arms; the issue's case is a card already armed ("stays armed after
  the window shrinks past it"), and the Scope has each trigger return the card to presented. So each is also said at 700 ms.
- **A card's presentation** is its ask's page opened, with another ask's card up and past its interval before it, so no frame of
  the launch is in the timing.
- **`occluded`** is said as covered and then uncovered within 34 ms, and **`activation`** as another window key and then this one: the
  criterion wants a press 500 ms on to answer, so the card isn't left covered or behind. Whether the going counts too, or only
  the coming back, passes alike.
- **A press** is the same click at the middle of the same option every time, the option being neither the recommended one nor the
  default. It isn't hardware, which no test can be; `test-confirm`'s file stands for the OS confirming you, so a press the card
  lets through is an answer and one it doesn't is nothing.
- **"Doesn't arm while any of it lies outside the window"** is read from 500 ms after the resize, by the card's own value; the
  clicks are judged from the first moment. "Any of it" is an option whose frame isn't wholly inside the window's, read in a
  resize made before the judged one. The card is nine options, as many as show before they fold (#1808), eight of them two lines long, so it
  fits 960×640 and runs past 700×400; if a layout ever shows all of it at 700×400 the test says so, naming where each lies.
- **The first click of AC2** is at a point that lies on an option of the card both as the large window draws it and as the small one
  does, so it is a click on the card whichever the app has drawn.
- **AC3's "armed card"** is the second ask's, which must read armed in the active window; behind the other app it is waited for, up to 10 s, until it
  reads armed, so no re-arm of the window's going inactive is still running under the click. An app that holds its card unarmed
  while its window is inactive is stricter than the criterion: the click is made all the same and must answer nothing.
- **What macOS does with that click** isn't pinned: an app may be handed it or not. It must come forward, or the click isn't the one
  the criterion names (BLOCKED).
- **AC2 at the base.** The criterion says the merge base answers. The card has since moved onto its ask's page, which presents it
  again when a resize moves its slot, so the base likely passes; the test is the criterion's words, not bent to fail there, and fails on
  `card-ignores-resize`.
- **The controls** say the rest of the run means something: with no trigger the press answers (AC1); back at 960×640 (AC2), or in an
  active window before and after (AC3), a click on the armed card answers. Their clicks are posted to the app's PID. macOS hands a
  window a posted click only with two things the window server writes on its own, the window's number and the point in it; nothing
  public sets the second, so `probe.swift` looks `CGEventSetWindowLocation` up, and without it the test is BLOCKED.

## The cursor

One step takes the real cursor, `probe raise`, once a test of AC3's two, for about 0.15 s: the click that macOS itself routes and
that brings an inactive app forward, which a click posted to a PID doesn't. Before it presses anything it refuses, and the test is
`BLOCKED: …`, when the screen is locked, the display sleeps, or no session is on the console; when the HID system saw an event in the
last 30 s (it waits up to 120 s for that, then refuses: `the Mac is in use`), read again right before the press; when the
app is already forward; when the point isn't in the app's window; when the front window at the point, by the window server's list (its overlays that
cover the whole display aside), isn't the app's, or an assistive client finds another process's element there; when the option isn't at the
point; and, with the cursor moved there, when the front window is no longer the app's. The cursor then goes back where it was. Nothing else here moves it: moves and
sizes go through the Accessibility API, and every other click is posted to the app's PID.

## BLOCKED, never passed

Off macOS. `real.test.ts`: no Accessibility permission; the screen locked, the display asleep or no session on the console, before any
step that reads or presses and behind it (behind a lock every element answers as its application); a main display too small for a 960×640 window
with another beside it; a window macOS won't move, size or bring forward, or no way to post a click to it; no card drawn in 180 s; fewer than three clicks delivered after the resize;
for AC3, the refusals above, no other app brought forward, or a click that didn't bring the app forward. A build that fails, a hub that doesn't
start, no `swiftc`.

## What these criteria don't cover

`content` (#1806's record path, which the issue leaves to it, and #327's suite); a card that stays covered (the design's "unobscured"), beyond `occluded`
re-arming it; a real second display, a real covering window and a real move: the replica says those three as the platform does, and the
real window is tried for the resize and the activation the criteria name.

## Files

- `clock.test.ts` (AC1), `real.test.ts` (AC2, AC3), `helpers.ts` (IDs, plants, the replica, the hub's world, the real app), `probe.swift`
  (the assistive client, the mover and the pointer), `lane.json`, `tsconfig.json`, `BASE-FAILURE.txt`.
