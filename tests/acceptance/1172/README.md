# Acceptance tests for #1172: the app a person runs is still the #337 spike

Written first and blind, at base commit `58862789` (origin/main), from issue #1172 (its text, Scope, seven acceptance
criteria and Proof), the design and the base, before any implementation. The implementing agent does not edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). `TASTE.json` is the one file
here a person's call changes.

## What was read

- `docs/technical-design.md`: Needs-you view; Panels and devices (trusted ring) with Panel, Bound value in panels, Keymap,
  placement, window, Stream and raw input, Cell grid and Replica; States people see; the reference window and app's
  toolkit rows under Decided; Dogfooding; Source and reading.
- `docs/canvas-primitives.md`: Bound value, Cell grid `cells@1`, Panel runtime and panel host, Window and display placement.
- At the base: `crates/deep-app/src/{main,lib,views,card,cells,chrome,record,setup,hub,show}.rs`, `crates/deep-replica`
  (`shell.rs`, `live.rs`, `main.rs`), `crates/deep-show/src/{main,ring,terminal,hub}.rs`, `crates/deep-canvas-marks/looks/clean.json`,
  `packages/hub/src/{canvas,core,inbox}.ts`, `packages/extension-host/src/terminals.ts`, and the suites
  `1002`, `883`, `1141`, `326/surfaces`, `326/panels`, `882`, `1162`, `428`, `34`, `16`, `400`, `401`, `402`, `806`, `989`.

## How to run

With Node 24.22 first on `PATH`, the workspaces built (`npm ci; npm run build --workspaces`), cargo and Xcode's command
line tools (`swiftc`), on macOS, in a logged-in session:

```sh
npx vitest run --root tests/acceptance/1172 --no-file-parallelism     # every file; the app's windows run one at a time
npx vitest run --root tests/acceptance/1172 judges                    # the pixel judges alone, on drawn pictures, anywhere
node node_modules/typescript/bin/tsc -p tests/acceptance/1172/tsconfig.json
DA1172_SCREENS=<dir> npx vitest run --root tests/acceptance/1172 shown   # keeps AC7's pictures in <dir>
```

- **Permissions.** The process that runs the tests needs Accessibility and Screen Recording (System Settings, Privacy &
  Security); `probe access` reads both. Without them every test fails `BLOCKED: …`, never passes. In Claude Code on this Mac
  the Bash tool's sandbox hides them, so these runs go outside it.
- **Real windows.** Each launch opens the real app on your screen and brings it forward, since an occluded window stops
  drawing. Set the machine aside for a run, or expect windows to come and go. Nothing clicks with your mouse: a click is the
  press a screen reader sends, so a covered window can never take it in the wrong app.
- **Builds.** The helpers run them, each once, and copy `deep-app` out of the target folder under its own name:
  `cargo build --locked -p deep-app --bin deep-app` (plain, then with each plant), and `deep-show`, `deep-replica` and
  `deep-hook`, which the hub and the proof run from `target/debug`. After a plant's build the plain build runs again, so the
  checkout's `target/debug/deep-app` is never left a plant. `CARGO_TARGET_DIR` is honored.
- **Folders.** Homes are `/tmp/dh16-*/h` (a socket path must fit 104 bytes), binaries `$TMPDIR/da1172-bin-<uid>`. It never
  touches the real `~/.deepbuild`, `~/.claude` or `~/Library/LaunchAgents`; the real hub here is started by `deep hub run`, not
  the login service.
- **Processes.** It stops only what it started, by PID.
- **`--root` cache.** Vitest writes `tests/acceptance/1172/node_modules/.vite/`; delete it before committing.
- **Lanes.** `scripts/lanes.mjs` needs `tests/acceptance/1172/` in its `alone` list and these tests in a macOS, logged-in lane;
  the implementer makes that edit.
- **Time.** Two to ten minutes a file. A first launch of a debug build took 36 s at load 118 here; the helpers wait up to 3 min.

## The surface (my choice, since the issue names none)

The tests enter through the real `target/debug/deep-app` against a real hub (`deep hub run`) with `HOME` a temp folder, and
read it **from outside its process**: `probe.swift` (window list, Accessibility tree, menu-bar item, the press, Vision OCR),
`screencapture -l<window>` for the window's pixels, `sips` to sRGB. So the app needs **no test seam** for reading, and the
base's spike is judged by the same judges as the fix. (The tree appears after the frame that follows the first read, so
`App.place` reads and then resizes. GPUI's hidden helper window is left out by listing only the windows the Accessibility API
lists.) What the app must provide:

Tried before pinning it, on this Mac: on the base binary the menu bar's title reads through `AXExtrasMenuBar`, `Session 0001` and
`143 waiting on you` read off the pixels, and `AXPress` on `Set up` ran its `on_click`. On a temporary build, reverted and not in
this folder, whose `main.rs` opened `views::Shell` as the base's code stands, `Sessions`, `Needs you` and the three handles read
through the tree and the pixels, the handle rows failed AC3's judge naming the ask, and AC1 was left failing on exactly what's
missing: the sidebar's sessions, the rows' questions and the menu bar's 143. That is no proof a whole implementation passes:
no card, panel, terminal tab or pop-out has been drawn in the real window, so those judges have run only on the base and, for
the grid and the inks, on drawn pictures (`judges.test.ts`).

### Pinned here: the implementation must provide these

1. **`deep-app` with no arguments opens the shell.** The sidebar on the left and Needs you in the center, through the panel
   registry (`views::Shell`), for a home with a hub. The window may open at any size: the tests set it to the reference
   window, 1512 × 982 points, through the Accessibility API, so the window must be resizable that far.
2. **Accessible names** (each a node with a role, so GPUI lists it, as `Set up` is at the base):
   - a node named exactly `Sessions` (as `views.rs` draws) and a node named exactly `Needs you`;
   - each sidebar row an `AXButton` (role `Button`, as the base) whose name holds its task's title, once;
   - each Needs you row one node whose name holds its ask's question, never its handle (`ask:…`);
   - a Needs you row and a sidebar row each take a press: any node with a role and an `on_click`, which is what GPUI gives
     `AXPress`. An `on_click` with no role takes no press;
   - the presented card's option rows as `#327` draws them: `AXButton`s whose names hold the option's label, in the same
     window, not a window of their own;
   - a `Terminal` tab control on a session's page, whose name holds `Terminal`;
   - a `Pop out Needs you` control, by that name, in the main window, for the Needs you view.
3. **A click on a sidebar row shows that session's page** in the center.
4. **The menu-bar item's title** holds exactly one number, the hub's count (AC1, AC2). Its words are free. The count must follow
   the record while the app runs: at the base `menu_bar::show_title` makes a new item at launch and keeps no handle.
5. **`DEEP_APP_APPEARANCE=dark|light`** in the environment forces that appearance on the real window, as macOS would for that
   process (NSApp's appearance, or `chrome::force_dark`). macOS has no outside switch for one process: `-AppleInterfaceStyle
   Dark` and a `CFFIXED_USER_HOME` preference both left a test window in Aqua here. Unset, the app follows macOS. An
   environment variable, not a flag, so the base draws on and fails on the color, not on an unknown argument.
6. **The welcome pane on a first launch.** In a home with nothing of DeepBuild (no `~/.deepbuild`) and no hub, the window shows
   the welcome pane with its `Set up` button, whose ground is the look's `ground` role in the appearance.
7. **A plug-in panel: `deep-app --panel <dir>`**, the base's flag. It opens the shell with that panel as the center's shown view,
   a panel directory with `main.js` as at the base, and beside it **`panel.json`**, `{"tree": [...]}`, in #401's element-tree
   form (`crates/deep-show/src/ring.rs`, `panel_def`): each `{"id", "component": "text", "bind": {...}}` draws one bound value,
   in the panel, in the tree's order, one line each. `bind.source` is a reading's handle, `reading:<name>`; its value is the newest
   `reading.recorded` in the record whose `data.reading` equals it, as `canvasWorld` keys them. It draws through the canvas's own
   bound-value text (`deep_canvas_marks::scene::bound_text`: value, unit, and past `stale_after` its age), in the look's `muted`
   role once stale, in `ink_primary` otherwise, on the wall clock.
8. **A terminal tab.** The terminal is one the **hub's canvas core** holds for a session: the tests open it as the app would,
   `canvas.user` with `{"call": "terminal_open", "terminal", "session", "cols", "rows", "feed": [{"at": 0, "text"}]}`, a call
   the base serves. The app's session page finds it through the core's merged calls (`tab`, `cells`, `cell`, `session_page`) and
   draws its rows through `deep_app::cells::cells`: glyphs, and a fill for each cell whose background isn't the grid's. So the
   app must draw each cell's colors; `cells`'s reply at the base holds only text, so `cell` per cell or a fuller reply is the
   implementer's choice. The world file (`DEEP_HUB_TEST_SHOW`) names one panel, `session-page`, for `session_page`.
9. **Plants: Cargo features of `deep-app`**, in no shipped build, added to `crates/deep-app/Cargo.toml` by this suite:
   - `plant-spike-window`: `deep-app` opens the spike window: rows reading `Session 0001` on, and the made-up count;
   - `plant-handle-rows`: Needs you rows show each ask's handle instead of its question, otherwise right;
   - `plant-tab-text`: the terminal tab writes each row with the chrome's text, in a `div`, outside the cell grid, otherwise right.
   The spike's generated sessions leave the binary (Scope), so `plant-spike-window` carries its own, under its `cfg`.

### Merged surfaces, used as they are

`deep hub run`, `DEEP_HUB_TEST_CONFIRM`, `DEEP_HUB_TEST_SHOW`, the hub's socket and control token, `inbox.read`, `deep inbox
answer <ask> <option>`, `canvas.user`, `deep-replica --first-screen --out <dir> --appearance <light|dark>`, the asks core and
`@deepbuild/record` (to seed the ledger before a hub runs, as #34's suite does).

### The fixture (`helpers.ts`, `makeWorld`)

A fresh home whose ledger holds, written before the hub starts, through the record and the asks core: two sessions, tasks
`Cart totals` and `Release notes`; three open `deep_ask.taste` asks, two in the first session and one in the second, each with
its own question and two options of its own; two `reading.recorded`: `reading:quotes` 182.4 USD as of 2 minutes ago and
`reading:rates` 96.1 USD as of now. `setup-finished.json` is written, so no `deep` command offers Set up. Then a real hub, a
`SessionStart` hook for each session (from a `sleep` stand-in, so a test's own `deep` command is never inside an agent's process
tree), and the terminal `term1`, 40 × 6, for the first session, fed `FEED`:

| Row | Prints |
|---|---|
| 0 | `grid says hello` |
| 1 | 5 cells of background `#d81b9a`, a gap of 2, 1 cell of `#13c4a3` |
| 2 | ten `i`s in `#ff7a00`, then 1 cell of `#6040d0` |
| 3 | ten `W`s in `#ff7a00`, then 1 cell of `#6040d0` |

## Criterion to tests

| Criterion | Tests | Wrong programs it fails on |
|---|---|---|
| AC1 | `shell.test.ts`: the real window's tree, pixels and menu bar over the fixture; beside it, its sidebar rows equal the replica's over the same record | the base (it *is* the spike, named so); `plant-spike-window`, a test that must see "the spike window" |
| AC2 | `shell.test.ts`: `deep inbox answer`, then the tree and menu bar polled; within 1 s, then the pixels | the base (reads 143 before it starts); a late window fails, INCONCLUSIVE only when the machine's load is over half its cores |
| AC3 | `rows.test.ts`: each ask in a fresh launch: its row by question, a press, its card's own two options on the tree and the pixels, no other ask's, no new window | `plant-handle-rows`, naming the ask; a row with no click; a card for another ask |
| AC4 | `panel.test.ts`: the stale value's strokes are nearest the look's `muted`, with its age, and the fresh value's aren't, with none, on the window's pixels. `terminal.test.ts`: cell fills on the window's pixels hold the grid's law (below) | a value drawn live; everything grayed; `plant-tab-text`, naming the tab; drawn-picture twins in `judges.test.ts` |
| AC5 | `popout.test.ts`: the main window's tree and pixels hold no question; the new window's pixels hold all three; the same reading saw them before the press | a program with no control; a window opened with the view still drawn in the main one; a view that vanishes |
| AC6 | `welcome.test.ts`: the ground beside Set up equals the look's dark `ground`, and its light one in light | the base's Paper; one color for both |
| AC7 | `shown.test.ts`: every picture written; `TASTE.json` | no call, a call on other pictures: `INCONCLUSIVE`; `looks_wrong` fails, quoting it |

No criterion above AC7 reads a picture to judge taste: AC1, AC2, AC3 and AC5 read words off it, AC4 and AC6 read a color and
where it sits.

**The grid's law (AC4).** Only the cell grid paints a cell's background, at its column, one cell wide. `gridLaw` takes the 1-cell
block's own size as the cell and requires that the 5-cell block is 5 × that, that the cell at column 7 starts 7 cells after
column 0, and that the two cells after ten `i`s and ten `W`s stack as one block one cell wide and two tall, 10 cells in. Each
block must be ≥ 97% solid. Slack: 4 device pixels. No cell size is assumed, and the hub's reply gives only the colors the cells
asked for, which the session page's status rule may have moved.

**Why the ink comparison (AC4) is relative.** A text's anti-aliased strokes rarely reach their exact color, so `groundAndInk`
takes the core of the strokes and `nearest` asks which of `muted`, `ink_primary` and `ink_secondary` it lies closest to. A value
drawn in `ink_tertiary` over the ground sits close to `muted` in this look and would pass; that is a known limit.

## The taste call (AC7)

`$DA1172_SCREENS` (a temp folder without it) gets, for `light` and `dark`: `shell-`, `card-`, `panel-` and `terminal-<a>.png`
(3024 × 1964 px from the real window), `menu-before-` and `menu-after-<a>.png`, and `replica-first-screen-<a>.png`, the replica's
frame of the same record, for the Proof's "beside". `run.json` names the app binary's SHA-256. "Attached to the PR and shown to
you in the session" no test can see: the implementing agent does it.

`TASTE.json` is 1162's shape: `{"issue", "criterion", "verdict": "looks_right" | "looks_wrong", "who", "when", "files":
{name: sha256}, "note"}`. Its `verdict` is `null` until a person calls it. The test fails `INCONCLUSIVE` while there is no call,
it names no one, or its files aren't this run's; `looks_wrong` fails, quoting the note. A real window's pixels can differ run to
run, so a kept folder holding exactly the files of a recorded call, from this same app binary, stands, and is not retaken. Take
the pictures once, call them, record them, and run again against the same `$DA1172_SCREENS`.

## Disputes and assumptions a redraft may revisit

1. **Reading from outside.** Needs two OS permissions on the machine that runs it. An in-process seam (as `--color-check` reads its
   drawable) would need none but would trust the app under test. Tried on this Mac, outside the Bash sandbox, both held.
2. **The press is not a mouse click.** A click posted to the process's PID changed nothing in the base's window here, with or
   without the window fields set, and one at the real cursor would land on whatever covers the window on a shared Mac. So "a
   click" is `AXPress`. A row with an `on_click` and no role fails, which pins item 2 above.
3. **The plug-in panel's path.** A real installed plug-in has no path to the app at the base. `--panel` plus `panel.json` is the
   smallest route to a real panel in the real window, and a reading from the real record. It does not prove an installed
   package's panel reaches the app.
4. **The terminal's path.** A real hosted terminal (`packages/extension-host`) has no hub method the app can call at the base, so
   the fixture's terminal is the canvas core's (`terminal_open` with `feed`), whose reply the issue quotes. It does not prove a
   program's live output reaches the tab, or #989's read-only older-host tab, which the issue names in its problem but no criterion.
5. **AC2's clock** starts when `deep inbox answer` exits, and stops when a tree read that shows 2 ends, so it reads late, never early.
6. **The window's "count".** Judged as Needs you's rows, plus any text on the pixels of the form `N asks need you`.
   The spike's `waiting on you` is named as the spike.
7. **Which view pops out.** Needs you, since the fixture fills it; the issue says "a view".
8. **No test of a panel's value turning stale while shown**, of a real stale reading from a failing source, or of light vs dark for a
   stale value; AC4 needs one stale value, and AC7's pictures show both appearances.

## Files

- `helpers.ts`: builds, the probe, `App`, pictures, the look's roles, the fixture world, the judges. Reuses `../16/helpers.ts`.
- `probe.swift`: the outside reader. `fixtures/panel/`: the plug-in panel.
- `shell.test.ts` (AC1, AC2), `rows.test.ts` (AC3), `panel.test.ts`, `terminal.test.ts` (AC4), `popout.test.ts` (AC5),
  `welcome.test.ts` (AC6), `shown.test.ts` (AC7); `judges.test.ts`, drawn pictures, no criterion tag, passes at the base.
- `TASTE.json`: the taste call, none yet. `tsconfig.json`: as 1162's. `BASE-FAILURE.txt`: the run at the base.
- Outside this folder: three `[features]` in `crates/deep-app/Cargo.toml`. No `[[test]]` entry: there is no Rust test here.
