# Acceptance tests for #1808: every list scrolls, the window comes back as you left it, a long title fits, a narrow window keeps the count

Written first and blind, at base commit `16dc5eab0`, from issue #1808 (updatedAt 2026-11-17T23:51:14Z, no comments: its
problem, Scope, nine acceptance criteria and Proof), the design and the base, before any implementation. The implementing
agent does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- Issue #1808; epic #1453's rules 3, 10, 14 and 15; #1461, #1462, #1102, #394 and #1477 only for the words #1808 cites
  (what the window opens on, the list hidden under 848, Escape to the list, a long card's options in view and Allow armed
  once its last row was shown, options folded behind a count, the scrolling table).
- `docs/technical-design.md`: Keymap, placement, window (One list and one page, Address, Actions, Pages); Needs-you view;
  Replica; First-party extensions that ship on by default; States people see; How we know version 0 works (Wrong programs,
  Dogfooding). `docs/canvas-primitives.md`: Question card (arming, `arm_after`, the hold-still note).
- At the base: `crates/deep-app/src/{views,chrome,card,question,arming,kinds,list,states,main}.rs`,
  `crates/deep-canvas-marks/looks/clean.json`, `crates/deep-replica/src/drive/{mod,frames,locate,glyphs,hubcopy}.rs`,
  `crates/deep-replica/src/snapshot.rs`; the suites `1461` (README, helpers, shell, shown, moves, budget), `1462`
  (helpers, probe), `1454` (helpers), `2021` (helpers), `124` (the wheel's sign), `26` and `16` (helpers).

## How to run

With Node 24.22 and cargo first on `PATH`, Xcode's command line tools (`swiftc`), on macOS:

```sh
npm ci --ignore-scripts && npm run build --workspaces
caffeinate -di npx vitest run --root tests/acceptance/1808 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1808/tsconfig.json
```

- **Builds.** Each file builds what it uses once a run, with #1172's build environment (`CARGO_INCREMENTAL=0`,
  `CARGO_PROFILE_DEV_DEBUG=0`), and copies each binary out of the target folder into
  `$TMPDIR/dd1808-bin-<uid>-<first 8 hex of SHA-256 of the checkout path>`, so another worktree's build never stands in
  for this one: `deep-drive` with `--features deep-app/test-confirm` (plain) and `--features env-plants,deep-app/test-confirm`
  (planted); `deep-app` plain and with `--features env-plants`; `probe.swift` with `swiftc -O`. `CARGO_TARGET_DIR` is
  honored. `deep-hook` is built when missing (#1461's `needBuilds`), and the CLI and hub must be built (`npm run build`).
- **Permissions.** `kept.test.ts` (AC3) drives the real window from outside its process: it needs Accessibility and an
  unlocked, awake screen. `shown.test.ts` (AC9) also needs Screen Recording. Without them they fail `BLOCKED: …`, never pass.
- **Folders and processes.** Every HOME is a temp folder (#16's `makeHome`). Nothing touches the real `~/.deepbuild`,
  `~/.claude` or `~/Library/LaunchAgents`. Only what a test started is stopped, by PID.
- **Pictures.** AC9 writes to `$DA1808_SCREENS` (a temp folder without it). It reads INCONCLUSIVE until `TASTE.json`
  records a call on exactly that run's files.
- **`--root` cache.** Vitest writes `tests/acceptance/1808/node_modules/.vite/`; delete it before committing.
- **Lanes.** `scripts/lanes.mjs` runs the folder alone and `shown.test.ts` by hand.

## Surface choices (the implementation must provide these)

The issue names no surface. These are mine, the smallest that fit the merged ones; the tests use exactly these.

1. **The replica and its calls, all merged** (#124, #1461, #1462): `deep-drive --out <dir>`, `launch {from: "record_copy",
   size: [w, h]}` in the world's HOME, opened where the app opens; `see` (the snapshot with each node's `id`, `role`,
   `name`, `value` and `bounds`, `runs` (the strings drawn, with `cut`), `focus`; `rows`; `address`; `hub`); `act` with
   `click` at a locator, `press` (`down`, `f6`, `escape`), and `scroll` at a locator with `dy` in points, positive toward
   the end (#124's sign: content moves up); `open {address}`; `feed {session, event}`; `wait_for {t}`. No new call.
   **One extension:** `see`'s `runs` spell a right-to-left string as they spell a left-to-right one: its text, in the
   order it is stored, and the bounds its glyphs were painted at. At the base the replica spells no Arabic string at all,
   not even a short Arabic title that fits its slot, while a Latin title beside it reads (`glyphs.rs` matches a shaped
   line's glyphs left to right; BASE-FAILURE.txt), so AC6's Arabic title can't be seen drawn until it does. The snapshot
   holds only what is visible (`from_observed` keeps `element.visible()`), as at the base.
2. **Ids, merged and kept**: the list `list`; rows `ask:<ULID>`, `session:<id>`, `quiet:<project>`, a project's heading
   row `project:<project>`; a row's slots `<row>:title`, `<row>:word`, `<row>:time` (and `<row>:flag`); the page node
   whose id is its address, `page-title`, `lane`; the card `question-card` valued `armed` once armed, its options
   `card-option:<option id>`, its steps `card-step:<index>`. The snapshot's `focus` is the focused row's id in the list.
3. **New ids**:
   - `page-count`: on a page under 848 wide, the count of what needs you in the page's title row (#1808: "the page with
     the count in its title row as the way back"), its value the one count as a number (`"2"`), its words drawing it.
   - `card-fold`: the control that opens a card's options folded behind a count (#394), its name or value holding how
     many it folds (`3`). Opening it is a press on it.
4. **Plants**, each selected by `DEEP_HUB_PLANT=<name>` and read through `plain::planted` in an `env-plants` build only
   (`deep-drive --features env-plants,deep-app/test-confirm`; `deep-app --features env-plants` for AC3's), everything else
   as shipped:
   - `list-clips` (AC1): the list draws its rows from the top and cuts them at its foot: neither the wheel nor Down moves
     what it draws. The run fails on the wheel, naming the first row below the fold: `by the wheel, the first row that
     can't be reached is session:<id> ("Task 0nn")`.
   - `page-clips` (AC2): a page cuts what's past its lane's foot, as the base does. It fails naming the page: `the session
     page session/<id> doesn't show its last line "line 400 of 400" after scrolling`.
   - `opens-at-opening-size` (deep-app, AC3): the app opens centred at 960×640 at every launch, whatever it kept. It fails
     naming the frame: `after a quit and a launch the window's frame is [x, y, 960, 640], not [x, y, 1200, 800]`.
   - `narrow-no-count` (AC4): under 848 wide the page's title row draws no count, and the count is nowhere else on the
     page. It fails naming the window: `the window at 700×640 shows no count on the page`.
   - `card-grows-past-slot` (AC5): an ask's card grows with its rows past its slot, as the base's does, and never arms.
     It fails naming the ask: `the card for ask:<ULID> ("Push the 30 release commits to origin/main?") never armed`.
   - `title-under-word` (AC6): a row's title draws whole on one line, uncut, over the state word and time slots to its
     right, which keep their places. It fails naming the row: `row session:<id> ("<first 24 characters>…") draws its title
     under its state word slot (session:<id>:word)`.
   - `title-shows-8` (AC7): a row's title shows its first 8 characters and an ellipsis, whatever room its slot has. It
     fails naming the row: `row session:<id> ("Reconciliation of ledger exports across regions") reading INCONCLUSIVE
     shows 8 characters of its title`.
   - `card-arms-folded` (AC8): a card with options folded behind a count arms once its interval ran, its fold opened or
     not. It fails naming them: `the card for ask:<ULID> (…) armed with options never shown: <three labels>`.
5. **The real app, from outside its process** (`probe.swift`, #1462's and #1454's probes with what this issue reads): the
   window's frame placed and read through the Accessibility API; keys posted to the app's PID (`q` with ⌘, F6, the arrows,
   Return, Escape, Down many times); the list's edge dragged and the wheel turned by pointer events posted to the app's
   PID with its window under the pointer; the tree with AXIdentifiers. ⌘Q quits (#1462's action table).
6. **Where the window is kept.** The frame, the list's width and whether the list is hidden are kept under `$HOME/.deepbuild/app/`
   (the app's own files, `src/hub.rs` `root()`), so a temp HOME holds them and a fresh one has none; the file's name and shape
   are the implementer's. The tests read the frame and the width from the window itself after a relaunch, never the file.

## The fixtures

Each world is a record a real hub made (helpers.ts `makeWorld`, #1461's way): sessions, titles, states and asks seeded
with the hub stopped through #26's `seed` and the asks core, each session's worktree a git folder named for its project,
then `deep hub run`, whose first backfill builds every `row.set`.

- `list.test.ts`: 700 finished sessions in shop, `Task 001` to `Task 700`.
- `window.test.ts`: two open asks in shop (a taste call, the older, and a choice), a session whose newest run failed (fed
  as `run.finished@3`, its `actual` the 400 lines `line 001 of 400` to `line 400 of 400`), and four sessions in docs titled
  `TITLE.long` (200 characters), `TITLE.han`, `TITLE.arabic` and `TITLE.twelve`, the last fed INCONCLUSIVE as the core
  writes a row that changed (`row.set` placed by the hub's `orderOf`).
- `card.test.ts`: `THIRTY`, a push approval whose plan is 30 steps (the older ask, so the window opens on it), and `TWELVE`,
  a choice with twelve options, `Teal accent` first, recommended and the default.
- `kept.test.ts`: two open asks in shop and a session in docs.
- `shown.test.ts`: `THIRTY` and a choice in docs, the three titled sessions there, and 700 sessions in shop.

## Criterion to tests

IDs are `criterionId` in `scripts/proof-change.mjs`.

| Criterion | ID | Test | Wrong programs it fails on |
|---|---|---|---|
| AC1 | `#1808.ba86d5b6` | `list.test.ts`: from the top, the wheel over the row shown nearest the list's middle, half its height at a time, until the last row shows; in a fresh window, F6 into the list and Down until the last row, the focused row shown after every press | the base (the wheel moves nothing); `list-clips`, naming the first row that can't be reached |
| AC2 | `#1808.86c051bf` | `window.test.ts`: the failed session's page, the wheel over its lines until `line 400 of 400` is drawn inside the page | the base (the lane clips); `page-clips`, naming the page |
| AC3 | `#1808.f340f4c7` | `kept.test.ts`: the real app placed at 1200×800, the list's edge dragged to 300, a session opened, ⌘Q, a launch: the same frame, the same width, the first open ask's page | the base (opens centred at 960×640); `opens-at-opening-size`, naming the frame |
| AC4 | `#1808.ad9b29cb` | `window.test.ts`: at 700×640 the first ask's page holds `page-count` valued 2, drawn, in its title row, on screen; one Escape shows both ask rows with the keyboard on one | the base (no count; the list stays hidden); `narrow-no-count`, naming the window |
| AC5 | `#1808.952d3557` | `card.test.ts`: at 960×640 a press on Allow 2 s after the approval's card shows, then nothing reads "Hold still"; unanswered, its rows wheeled to their last, it arms within 3 s and Allow answers it, one `ask.answer` | the base (taller than its slot, never armed); `card-grows-past-slot`, naming the ask |
| AC6 | `#1808.445ec374` | `window.test.ts`: each titled row's name holds its whole title; what its title slot draws is one line, inside the slot, clear of the words in the word, time and flag slots, its word drawn clear, and the title whole or its start cut at an ellipsis | the base (the Latin and Han titles run past their slot with their ellipsis cut off; the replica reads no Arabic); `title-under-word`, naming the row |
| AC7 | `#1808.98ed0a32` | `window.test.ts`: the list 260 wide, the row fed INCONCLUSIVE reads it in its word slot and draws at least 12 characters of its title before its ellipsis | the base (the title is clipped at its slot, its ellipsis cut off); `title-shows-8`, naming the row |
| AC8 | `#1808.d7b1f43e` | `card.test.ts`: 2 s after the twelve-option card shows, 9 options shown, `card-fold` saying 3, not armed; the fold pressed, each option shown, then armed; armed with an option never shown fails | the base (no fold); `card-arms-folded`, naming the options |
| AC9 | `#1808.d5e52086` | `shown.test.ts`: five pictures from the real app, each once its state is on the tree, then `TASTE.json`: INCONCLUSIVE until a recorded call on exactly these files | none: a picture is never judged here |

## Ambiguities, and how they're read

1. **"Reached by the wheel."** A row is reached when it is shown: wholly inside the list's part of the window with its
   title drawn. A list that draws a row only once it comes into view is read the same way; rows past the fold need not
   exist until then. The wheel stops when a turn changes nothing shown.
2. **"The focused row is always in view"** is read after every Down press, from where F6 (#1462) puts the keyboard in the
   list; the focused row is the snapshot's `focus`, and a project's heading row counts as a row.
3. **The page that scrolls.** AC2 turns the wheel over the failure's lines (over the lane when none shows); a page that
   scrolls the failure inside a nested area under the wheel passes the same way.
4. **"The kept frame"** is read back from the window after the relaunch, position and size, against the frame read just
   before the quit, which must be 1200×800; the list's width is its `list` node's width, within 2 points of the width
   it was dragged to, itself within 2 of 300. Before the quit a session's page is opened, so "what's selected isn't kept"
   is seen: the relaunch must show the first open ask. The first launch in a fresh home must open at 960×640, so a frame
   kept outside the home is caught.
5. **A posted drag.** No suite here had posted pointer events to the app. AC3 drags the list's edge with events posted to
   the app's PID; if the edge doesn't move at all, the run is BLOCKED (the window server didn't deliver it), never a
   failure of the app and never a pass. The base run couldn't try it (BASE-FAILURE.txt: the screen was locked).
6. **Where the count sits.** On a page under 848 wide: `page-count`, in the page's title row (its vertical extent meets
   `page-title`'s), inside the window, valued and drawing the one count. "One key reaches the ask rows" is Escape (#1462),
   after which both ask rows are shown and the keyboard is on one of them.
7. **"A press 2 s after a card is shown"** is a press on the long card's Allow option, which #1102 holds back until its
   last row was shown. It may answer, or say why it can't, in any words but "Hold still". "Reads" is what the window
   shows: a visible node's name or value, or a string drawn anywhere in it. (At the base the 30-row card appends "Hold
   still" below the window's foot, where no one reads it, so the base fails AC5 on never arming instead.) A card that
   didn't take the answer then has its rows wheeled to their end, must arm within 3 s and must take Allow; exactly one
   `ask.answer` reaches the hub either way.
8. **"Shows at least 12 characters"** counts the characters of the title drawn before the ellipsis, in code points (the
   fixture title is ASCII), and that text must start the title. A title clipped without an ellipsis can't be counted and
   fails.
9. **"Draw on one line inside their slot"** also reads the Scope's rule for a title that doesn't fit: the string drawn
   over the title slot is the whole title or its start cut at an ellipsis, never clipped (a run the replica marks `cut`),
   its painted glyphs inside the slot (2 px for a raster's spill). "Never draws under the right slot" is read as: it
   overlaps a word drawn in the word, time or flag slot by no more than a glyph is wide (the line's height), since a run's
   bounds keep the whole sprite of a glyph its slot's edge cuts; and the state word is drawn clear in its slot (two
   strings drawn over each other spell neither in the replica's reading). "The full text as the accessible name" is the
   row's name holding the whole title; the name also holds the mark's glyph and the word, as #2018 pinned it.
10. **"Three options folded"** is 9 shown and 3 behind `card-fold` (#394's nine a level); an option is shown when it is
    wholly inside the window and the page with its label drawn, and every option must have been shown before the card first
    reads armed.
11. **The Proof's "real app's snapshots at each size"** is read as the replica's snapshots, which draw the real app's tree
    (design: Replica), for AC1, AC2 and AC4 to AC8; the real app itself proves AC3 (the kept frame after a relaunch) and
    takes AC9's pictures, each only once its state is on the real window's tree at its size.
12. **Plants are environment plants** in one planted build of each binary, as #1461's, to keep the builds few.

## Scope the criteria don't cover

No criterion names these, so nothing here tests them: the smallest window, 480×360; a kept frame that's off every display;
whether the list's hidden state is kept; Escape and the count's press as the way back beyond AC4's one key; a title's
direction and the slots' sides beyond staying inside the slot; the scrolling table of #1477 drawing the list or leaving the
crate; every state word other than INCONCLUSIVE at 260; a card that can't arm for another reason saying the reason.

## Files

- `helpers.ts`: IDs and plants; builds; `makeWorld` and the fixtures' titles and asks; the replica driver; readers of the
  window (what's shown, the list's and the page's views, the list's order, words anywhere); the real app's driver.
  Reuses `../16/helpers.ts`, `../26/helpers.ts`, `../1463/helpers.ts` and `../1461/helpers.ts`.
- `list.test.ts` (AC1), `window.test.ts` (AC2, AC4, AC6, AC7), `kept.test.ts` (AC3), `card.test.ts` (AC5, AC8),
  `shown.test.ts` (AC9).
- `probe.swift`, `TASTE.json`, `tsconfig.json`, `BASE-FAILURE.txt`.
