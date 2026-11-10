# Acceptance tests for #1462: every page and action in the menu bar and ⌘K, and the list from the keyboard

Written first and blind, at base commit `d51be2c3` (Merge pull request #2108), from issue #1462 (its problem, Scope, 22
acceptance criteria and Proof; it has no comments), the design and the base, before any implementation. The implementing
agent does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).
`TASTE.json` is the one file here a person's call changes.

The brief that started this job counted 23 criteria and called the status item's "AC23"; the issue holds 22. The numbers
here are the issue's: AC20 is "Shown to you", AC22 the status item's menu.

## What was read

- Issue #1462; epic #1453, and #327, #329, #330 (with its part #1998, whose preference words AC15 uses), #886, #1003, #1454,
  #1460, #1461, #1586, #1807, #1809, #1815 and #57 for context only.
- `docs/technical-design.md`: Panel; Keymap, placement, window (Keymap, One list and one page, Address, Actions, Pages);
  Needs-you view; Replica; First-party extensions that ship on by default; States people see; Dogfooding; Tests written first.
- At the base: `crates/deep-app/src/{main,lib,views,commands,card,question,arming,trusted_input,confirm,answer,words,installed,
  open,address,events,states,kinds,hub}.rs` and `Cargo.toml` (the `plant-*` and `test-*` features),
  `crates/deep-replica/src/{lib,snapshot,replica}.rs` and `drive/{mod,frames,locate}.rs`, `packages/hub/src/{core,server,rows}.ts`,
  `packages/asks/src/index.ts` (`later`), `packages/record/src/projections.ts` (`ask.later`), `packages/cli/src/main.ts`,
  `scripts/selection-lint.mjs`, `scripts/proof-change.mjs` (criterion IDs), and the suites `1460`, `1454`, `1459`, `1463`,
  `1510`, `327`, `26` and `24`.

## How to run

With Node 24 first on `PATH`, the workspaces built (`npm ci --ignore-scripts; npm run build --workspaces`), cargo first on
`PATH` (`$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin`), Xcode's command line tools (`swiftc`), on macOS, in a
logged-in, unlocked session:

```sh
caffeinate -di node node_modules/vitest/vitest.mjs run --root tests/acceptance/1462 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1462/tsconfig.json
DA1462_SCREENS=<dir> caffeinate -di node node_modules/vitest/vitest.mjs run --root tests/acceptance/1462 shown   # keeps AC20's files
```

- **Headless first.** `actions`, `answers`, `list`, `commands` and `guard` need no window: the replica is the real
  `deep-drive` on GPUI's test platform, and the guard is a script. Only `real.test.ts` (AC2, AC10, AC13, AC22) and
  `shown.test.ts` (AC20) open the real `deep-app`, each on a real hub in a temp home. It is read from outside its process by
  `probe.swift`, and its keys are posted to its PID alone, so the process running the tests needs Accessibility and Screen
  Recording (System Settings, Privacy & Security) and an unlocked screen; without them those tests fail `BLOCKED: …`, never
  pass. Nothing clicks the real window; `shown.test.ts` presses a row with the press a screen reader sends to select it.
- **Builds.** The helpers build each binary once, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0`, and copy it out of
  the target folder under its own name into `$TMPDIR/dd1462-bin-<uid>`: `deep-drive` from `crates/deep-replica`, plain, with
  `--features deep-app/test-confirm`, and with each replica plant (Pinned 16); `deep-app`, plain and with `--features test-confirm`;
  `deep-hook` where #26's agent stand-in runs it. A build with features is followed by the plain one, so `target/debug` never
  holds a plant. `CARGO_TARGET_DIR` is honored.
- **Folders and processes.** Homes and sockets are under `/tmp` short paths (#26's temp folders), removed after. Nothing
  touches the real `~/.deepbuild`, `~/.claude` or `~/Library/LaunchAgents`. Only what a test started is stopped, by PID.
- **AC19's clock.** Its replica lets 10 min 20 s of its virtual clock pass, frame by frame: about 37,000 frames, minutes of
  wall time under load. It does so only once Later already worked.
- **`--root` cache.** Vitest writes `tests/acceptance/1462/node_modules/.vite/`; delete it before committing.
- **Lanes.** `scripts/lanes.mjs` needs `tests/acceptance/1462/` in its `alone` list, in a macOS, logged-in lane; the implementer
  makes that edit.

## The surface (my choice where the issue names none)

The replica is the real `deep-drive` (#124), driven over its stdin as the hub's `deep_drive` tool drives it, launched with
`launch.fixture` on this suite's fixture; `see`, `act press/type/click/hover`, `open`, `feed`, `wait_for` and the snapshot's
`focus` are used as #1459 and #1460 left them. The real app is the real `deep-app` on #26's world. No label, reply or log line
credits a criterion except the notifier's own line for "still notifies" (#994's surface): every other check reads the tree,
the menu bar, the status item, the hub's record or what the app sent its hub.

### Pinned here: the implementation must provide these

1. **The action table** is one JSON file, `crates/deep-app/src/actions.json`: `{"actions": [{"name", "verb", "target", "key",
   "variant_of"}]}`, which the app itself reads (for instance with `include_str!`), so the menu bar, ⌘K, a row's controls and
   the tree read the same rows. `name` is the action's name as the menu and ⌘K show it, unique; `verb` its label's verb;
   `target` what it acts on, a word starting `app`, `window`, `list`, `page`, `box`, `card`, `session`, `ask` or `project` (a
   test selects an ask's page before an `ask…` action and a session's before a `session…` one); `key` its default keystroke in
   GPUI's form (`cmd-shift-j`, `f6`, `enter`, `cmd-,`), or `null`; `variant_of` the name of the action a `⌥` chord is a
   variant of, else `null`. Names these tests use: `Next ask`, `Later`, `Pause`; the Quit item's name starts `Quit` and its key
   is `cmd-q`. A rebinding (15) changes the key the app shows and uses, not this file.
2. **The replica's menu bar:** a new call `{"call": "menus"}` answers `{"ok": true, "menus": [{"name", "items": [{"name",
   "key", "enabled", "items"?}]}]}`: the menus the app set (as it sets them on the real app), in order, separators left out,
   `key` in the table's form or `null`, `items` a submenu's. The menus are DeepBuild, File, Edit, View, Go, Window and Help, and
   `Session` for the selected row; tests read `View` and `Session` by those names.
3. **What the app sends its hub in a replica.** `see`'s reply gains `hub`: every call the app made of its hub since launch, in
   order, each `{"method", "params"}` (and `"error"` when refused). In a replica no call reaches a socket: the replica's own
   copy of the hub (design: Replica) takes it. That copy records `ask.later` as the core does (writer `core`, `data.until` the
   ask's deadline less an hour), so the list folds it, and refuses `command.run` as the hub does with no view installed: the
   message `No installed view runs <action>.` A read is a method ending `.read`, `hub.health`, `health`,
   `stream.subscribe`, `ask.card` or `views.installed`; every other method is a write.
4. **Keys shown.** ⌘K's list is the node `command-list`; each hit a `list_box_option` named exactly its entry's name, its
   `value` the key it shows as a menu draws it, or `null`: ⌃⌥⇧⌘ in that order, then the key, a letter in capitals, `↩ ⎋ ⇥
   Space ⌫ ↑ ↓ ← →`, `F6`. So `cmd-shift-j` shows `⌘⇧J`.
5. **The real app's menu bar** is an `NSMenu` menu bar an assistive client reads without opening it (`kAXMenuBarAttribute`),
   each item's key in `AXMenuItemCmdChar` and `AXMenuItemCmdModifiers`; `probe menubar` reads it, `probe openmenu` opens one
   for its picture.
6. **A row's context menu:** a new `act` kind, `context_click`, with a locator, delivers a secondary click there. The window
   then holds one node `id: "context-menu"`, its `menu_item` nodes its items in order, each named exactly the item's name.
   The Session menu is the menu named `Session` in `menus`, for the row selected by opening its page.
7. **The list from the keyboard.** Rows keep #1459's ids, `session:<id>` and `ask:<ULID>`; a project's heading is a row too,
   `project:<project id>`, and Return on it opens `project/<project id>` (#1460's address; the Map is on that page). The
   snapshot's `focus` is the id of the row that holds the keyboard. F6 moves the keyboard between the list, the page and the
   box; the arrows move it along the list; Return opens; Escape returns to the list; ⌘N puts it in the box, whose input keeps
   the id `box-draft` and its words as its value. `act press` sends keys, `act type` text.
8. **The card's controls** carry ids, in the snapshot and as the live tree's accessibility identifier: `card-option:<option
   id>` (the ask's option id), `card-step:<n>` (the nth step's switch, from 0 in the card's order), `card-send`, `card-undo`.
   While the card holds the keyboard, `focus` is the focused control's id. `question-card` keeps its value (`presented`,
   `armed`, `answered`); a step's switch keeps the role `switch` and the value `on` or `off`.
9. **A press that isn't hardware, the OS confirming you,** is #1454's stand-in, in no shipped build: `deep-drive` built with
   `--features deep-app/test-confirm`, or `deep-app` with `--features test-confirm`, started with `DEEP_APP_TEST_CONFIRM` naming
   a file that holds `confirmed`. In the replica an `act click` carries no HID event, which is how Switch Control's press
   arrives; on the real app a key posted to its PID is synthetic too.
10. **Notices.** Each notice the window shows is one node whose `id` is `notice` or starts `notice:`, named by its words.
11. **A plug-in in the replica** is `launch.panel` (its folder) and `launch.view` (`{name, pages, commands}` as
    `deep.registerView` gives them) on the plain replica binary: View lists its page, named as ⌘K names it (`Board: alpha`) or
    by the page's name, and ⌘K lists `Board: alpha`. A panel that fails its kit (`fixtures/fails-kit`) launches anyway, as the
    app does, and the window draws one notice naming `launch.view.name`.
12. **The status item's menu.** In the real app the status item (`AXExtrasMenuBar`) has a menu, read by `probe status`, with a
    line per session holding its task's title, its state's word and its mark (the glyph `clean.json` gives its status-map
    entry), as `states::menu` writes them. The replica reports the same lines, in order, as its snapshot's `menu_bar.items`;
    here launched `from: record_copy` in the world's home, a read-only copy of the same record.
13. **Later** is the table's `Later` on the selected ask (its page open), run by its key when it has one, else ⌘K, `Later`,
    Return. The replica's clock shows its return through `wait_for {t}`.
14. **A command the hub refuses** is the fixture plug-in's `Refresh board` (`ext.board.refresh`) from ⌘K in a replica, which its
    copy of the hub refuses (3); the reason shows in a notice (10) within 1 s of the replica's clock.
15. **The keymap** is `~/.deepbuild/keymap.json`, `{"bindings": {"<action name>": "<keystroke>"}}`, read at launch and again
    whenever it changes: within half a second of the replica's clock the new key shows and works.
16. **Plants: empty Cargo features of `deep-app`**, in no shipped build, added to `crates/deep-app/Cargo.toml` by the implementer
    (this job commits only this folder), never environment variables, each built into the replica as
    `--features deep-app/<plant>`:
    - `plant-action-missing-from-menu`: one action of the table is in no menu, otherwise right (AC1).
    - `plant-approve-menu-item`: the menu bar holds an item named `Approve` (AC4).
    - `plant-hover-only-control`: a row draws one of its controls only while the pointer is over it (AC5).
    - `plant-tab-skips-control`: Tab on the card passes over one of its controls (AC10).
    - `plant-card-starts-on-allow`: a presented approval's focus starts on the option that allows (AC10).
    - `plant-commands-click-only`: ⌘K's list opens a hit only on a click; Return does nothing (AC12).
    - `plant-opener-only-logs`: a command that doesn't run is written to the error stream only, as at the base (AC12).
    - `plant-no-quit-item`: the menu bar has no Quit item (AC13).
    - `plant-context-only-action`: a row's context menu holds one action the Session menu doesn't (AC14).
    - `plant-list-hides-row`: typing in the list hides the rows that don't match (AC16).
    - `plant-failed-view-silent`: a view that fails its kit is written to the error stream only, as at the base (AC17).
    - `plant-step-ignores-press`: a step's switch takes hardware only, as at the base; built with `test-confirm` (AC18).
    - `plant-no-later`: no control sets Later, as at the base (AC19).
    - `plant-written-key-hint`: ⌘K shows Next ask's shipped key as written text, whatever the keymap says (AC21).
    The merge base itself is AC22's wrong program, not a plant. AC9's plants are copies of the table (17).
17. **The guard:** `node scripts/keymap-guard.mjs [--root <dir>]` reads `<root>/crates/deep-app/src/actions.json` and
    `<root>/scripts/actions-released.json`, the last release's table in the same shape, checked in and rewritten at each
    release. It fails a `⌥` chord whose `variant_of` isn't the action on the chord without `⌥`, any `ctrl` binding, and a chord
    the last release's table gives one action and this one another. One `FAIL keymap: <chord>: <why>` line per finding, the
    chord as the table writes it (or as a menu draws it), or one `PASS keymap` line; exit 1 on a finding, 0 on none.
18. **Pause** on a session is recorded by the hub as one `session.paused` event with `subject: session:<id>`.
19. **The real app reports focus** to assistive clients: the application's `AXFocusedUIElement` is the control or row that
    holds the keyboard, its `AXIdentifier` its `id` (7, 8); the page node's identifier is its address (#1460).
20. **⌘W and ⌘Q in the real app:** ⌘W closes the window and the process keeps running, the status item's title unchanged and
    the notifier logging `deep-app: notified <session> <ask>` (#994's line, `DEEP_APP_NOTIFICATION_SETTING=allowed` in a debug
    build); ⌘Q ends the process and leaves the hub, so `deep` exits 0.

### Merged surfaces, used as they are

`deep-drive` and its calls (`launch` with `from: fixture | record_copy`, `fixture`, `center`, `panel`, `view`; `see`; `act` click,
hover, press and type; `open`; `feed`; `wait_for {t}`), its `{id}` and `{role, name}` locators and the snapshot's `focus` and
`menu_bar` (#1459, #1460); `test-confirm` and `DEEP_APP_TEST_CONFIRM` (#1454); #26's world (`agentWorld` with `seeded`,
`startHub` with `DEEP_HUB_TEST_CONFIRM`, `deep_ask` through the agent stand-in, `events`, `deep`); `deep status --json`'s rows
(#1463); the probe's commands from #1459 and #1454.

### The fixtures

- `fixtures/record.events.jsonl`, in `deep-drive`'s fixture form: four sessions with UUID IDs, `Cart totals` (project `shop`),
  `Release notes` and `Search index` (`docs`), `Shop banner` (`web`); three open asks, oldest first: a taste call
  (`ask:01KB1462AK…01`, "Which header colour for the cart page?", Blue header recommended, its default an hour and 20 s after
  the replica's launch), a choice of four (`…02`, "Which store keeps the release notes?": SQLite, Plain files, Postgres,
  Redis) and a push (`…03`, "Push main to origin?": Push it allows, No denies and is the default; its plan's one step, `git
  push origin main`, can't be undone).
- `fixtures/board/main.js`: a panel importing only `@deepbuild/panel`. `fixtures/fails-kit/main.js`: one importing the toolkit
  and its `Dialog`, which `panel@1` and the loader refuse.
- The real app's worlds are seeded in each test (`realWorld`): sessions of project `shop` with their titles, and the same asks.

## Criterion to tests

IDs are `criterionId` in `scripts/proof-change.mjs`.

| Criterion | ID | Tests | Wrong programs it fails on |
|---|---|---|---|
| AC1 | `#1462.d090fc8d` | `actions`: each action of the table is a menu item and a ⌘K hit with its name and key | the base (no table, no menus); `plant-action-missing-from-menu`, naming the action |
| AC2 | `#1462.61a5fe15` | `real`: on the real app, by keys posted to it: two asks answered on the card, a session opened from the list and paused, its project's page opened and ⌘[ back | the base (no F6, no Next ask, no Pause) |
| AC3 | `#1462.84d5c9de` | `actions`: the plain replica with the board's view registered lists `Board: alpha` in View and ⌘K | the base (no menus) |
| AC4 | `#1462.3f4642da` | `answers`: no menu item names an answer; no chord answers an armed card from the list; Return on an unarmed card writes nothing | the base (no menus, no `hub`); `plant-approve-menu-item`, naming `Approve` |
| AC5 | `#1462.dc5506c4` | `list`: hovering each row shows no control the tree lacked at rest | `plant-hover-only-control`, naming the control |
| AC6 | `#1462.8cf69728` | `list`: with the choice's row focused and the choice answered from the CLI (fed), the next row has the keyboard and reads its question | the base (no keys in the list) |
| AC7 | `#1462.80c987cd` | `list`: F6, the arrows, Return, ⌘N, the words, Return; the app hands the words to its hub | the base (no F6) |
| AC8 | `#1462.37c12e9d` | `answers`: letters pressed and typed on an armed card write nothing and leave the box alone | the base has no `hub` list to read |
| AC9 | `#1462.da9a3a2e` | `guard`: the guard passes the checkout and fails each of the three planted tables, naming the chord | the base (no guard, no table) |
| AC10 | `#1462.efa89138` | `real`: focus starts on No; Tab reaches the step's switch, Space turns it on, Tab reaches Push it, Return approves, by the record. `answers`: the two planted cards in the replica | the base; `plant-tab-skips-control`, naming the control; `plant-card-starts-on-allow`, naming the option |
| AC11 | `#1462.f51260a6` | `answers`: "3" focuses the third option and writes nothing, Return answers it; Esc with typed words returns to the list and the words come back | the base (no digit, no `hub`, no ⌘N) |
| AC12 | `#1462.a91570d4` | `commands`: ⌘K, "need", Return shows the first ask; the refused command's reason in a notice within 1 s | the base; `plant-commands-click-only`; `plant-opener-only-logs`, naming the command |
| AC13 | `#1462.bac1a512` | `real`: Quit on ⌘Q; after ⌘W the window is gone, the count unchanged, a new ask notified; after ⌘Q the app is gone and `deep` answers. `commands`: the planted menu bar | the base (no Quit item); `plant-no-quit-item`, naming Quit |
| AC14 | `#1462.a484845b` | `actions`: session A's context menu holds the Session menu's items in its order, with Copy title and Copy link | the base (no menus); `plant-context-only-action`, naming it |
| AC15 | `#1462.bb9f84a2` | `actions`: ⌘, opens ⌘K showing what each preference word finds; the box and the hub get nothing | the base (⌘, unbound) |
| AC16 | `#1462.bc2ffc0b` | `list`: "shop" puts the keyboard on the first row whose title or project starts with it; every row stays drawn | the base; `plant-list-hides-row`, naming the row |
| AC17 | `#1462.c6bf9687` | `commands`: the replica with the refused view launches and shows one notice naming it | the base (refuses to launch); `plant-failed-view-silent`, naming the view |
| AC18 | `#1462.d9f64dd4` | `answers`: a press that isn't hardware on the push's step turns it on once the OS confirms you | the base; `plant-step-ignores-press`, naming the step |
| AC19 | `#1462.e1f0fec7` | `list`: Later puts the oldest ask last, reading set for later; at 10 min 20 s (its default 50 minutes away) it is first again | the base (no Later); `plant-no-later` |
| AC20 | `#1462.7b2b38a6` | `shown`: the View and Session menus and ⌘K with Next ask's key, from the real app, each state checked, then `TASTE.json` | no call, or a call on other files: `INCONCLUSIVE`; `looks_wrong` fails |
| AC21 | `#1462.0251dfc8` | `commands`: Next ask rebound in the keymap shows its new key in ⌘K at once, and the key walks the asks in Needs you's order | the base (no table); `plant-written-key-hint` |
| AC22 | `#1462.bda7846d` | `real`: the status item's menu has a line per session with its title, word and mark, and the replica's `menu_bar.items` equal it | the base: no menu, naming the surface |

One criterion-tagged test passes at the base on purpose, since the base already has its property: AC5's (hovering a row shows
no control the tree lacked at rest); its planted wrong program is what it fails on. AC8's letters would pass too, were the
`hub` list (Pinned 3) there to read. See `BASE-FAILURE.txt`.

## Scope the criteria don't cover

No criterion names these, so nothing here tests them: the menus' order (DeepBuild, File, Edit, View, Go, Window, Help); Go's back
and forward; Shift-Tab and the arrows on the card; Space as well as Return; a key repeat; Escape closing ⌘K; "No match"; a page
that won't open ending in a notice; focus following a row that moves rather than leaves; Full Keyboard Access as a setting;
the focus ring's role (#1003's suite); ⌘M, ⌘H, ⌘Z and ⌘F; a double-click; the next-ask key's default; Rules in View; "write to
it" as the Session menu's word; Return and ⌘Return in the box (#1586's suite).

## Disputes and assumptions a redraft may revisit

1. **Pause's record** (Pinned 18). Nothing at the base pauses a session; `session.paused` is this job's name for what the hub
   records. A redraft may read "pauses it" another way, as long as it reads the record.
2. **The replica's copy of the hub** (Pinned 3) takes the place of the hub the design gives the replica. Its refusal of a
   command copies the real hub's words for a view nobody installed. AC12's "within 1 s" is the replica's clock.
3. **"Opens the first ask"** (AC12) passes on the first ask's address or its card on the window, since the issue doesn't say
   whether "need" ranks Needs you or the ask first.
4. **"Every row drawn before is still drawn"** (AC16) reads row ids; a row redrawn under another id would count as hidden.
5. **Esc with typed words** (AC11): the words go in the box by ⌘N, and Esc is pressed until the list has the keyboard (at most
   twice), since the issue puts typed words in the ask's box (#1461) and Esc on the card.
6. **"The next row"** (AC6) is the row drawn after the answered one, the row now in its place; the issue's other order (its
   heading first) is for a row that moves.
7. **The real app's focus** (Pinned 19) is read from `AXFocusedUIElement`. If GPUI's bridge can't report it, a redraft may read
   the row an assistive client sees as selected instead.
8. **AC13's count** is read as the status item's title before and after ⌘W, and "notifies" as #994's log line, the only
   surface that sees a notification posted without a bundle.
9. **The status item on this Mac.** At the base, the unbundled `deep-app` showed no status item to an assistive client: none in
   its `AXExtrasMenuBar` and no status-layer window, though `main.rs` makes one. The probe reads `AXExtrasMenuBar`, then the
   element at each status-layer window the process owns. If macOS keeps the item out of the menu bar (System Settings, Menu
   Bar), AC13's count and AC22 fail saying so; a redraft may make that BLOCKED once something outside the app can tell the
   two apart.

## Files

- `helpers.ts`: builds, the fixture's IDs, the action table, the replica driver, the real app and its probe, the worlds and the
  judges. Reuses `../26/helpers.ts`.
- `actions.test.ts` (AC1, AC3, AC14, AC15), `answers.test.ts` (AC4, AC8, AC11, AC18, AC10's plants), `list.test.ts` (AC5, AC6,
  AC7, AC16, AC19), `commands.test.ts` (AC12, AC17, AC21, AC13's plant), `guard.test.ts` (AC9), `real.test.ts` (AC2, AC10,
  AC13, AC22), `shown.test.ts` (AC20).
- `probe.swift`, `TASTE.json`, `tsconfig.json`, `BASE-FAILURE.txt`, `fixtures/`.
