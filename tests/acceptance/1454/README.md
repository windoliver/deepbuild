# Acceptance tests for #1454: what the replica proves reaches the real app

Written first and blind, at base commit `c12a65bb`, from issue #1454 (updatedAt 2026-11-07T03:21:15Z: Scope, seven acceptance
criteria, Proof), the design and the base, before any implementation. The implementing agent does not edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). `TASTE.json` is the one file here a
person's call changes.

**Read this first: most of this suite has not run against a real window.** The Mac this job ran on gave no process it could
reach Accessibility or Screen Recording, and it can't run a sandboxed package. So the real-window tests stop `BLOCKED` before they
reach the app, and these were never exercised: `probe key`, `probe gif`, the `Recorder`, ⌘K's delivery, an AX press on a list
option, the OCR of the panels and the figure, and the bar judge on real pixels. Treat them as drafted, not tried.
`BASE-FAILURE.txt` says which test reached what.

## What was read

- Issue #1454, and epic #1453 for context.
- `docs/technical-design.md`: Replica; Panels and devices (trusted ring); Needs-you view; An ask, and your answer getting back;
  the trusted-path text (The trusted path is a device you paired; Clicks on the question card); the DeepBuild app row; Dogfooding.
  `docs/extension-guide.md` for `deep.registerView` and its kit. `docs/canvas-primitives.md` where those lean on it.
- At the base: `crates/deep-app/src/{main,lib,views,commands,card,question,confirm,arming,show,setup,hub,answer}.rs`,
  `crates/deep-replica/src/{main,shell,canvas,kit,lib,replica,snapshot}.rs`, `packages/hub/src/{core,confirm,install,inbox,tools,server}.ts`,
  `packages/asks/src/index.ts`, `packages/extension-host/src/host.ts`, `scripts/lanes.mjs`, `scripts/record-reader-guard.mjs`,
  and the suites `1172`, `806`, `26`, `16`, `34`, `326/panels`, `351`, `363`, `366`.

## How to run

With an official Node 24.22 first on `PATH`, the workspaces built (`npm ci --ignore-scripts; npm run build --workspaces`), cargo and
Xcode's command line tools, on macOS, in a logged-in, unlocked session:

```sh
caffeinate -di npx vitest run --root tests/acceptance/1454 --no-file-parallelism   # every file; one window at a time
npx vitest run --root tests/acceptance/1454 judges lint                            # no window needed
node node_modules/typescript/bin/tsc -p tests/acceptance/1454/tsconfig.json
DA1454_SCREENS=<dir> caffeinate -di npx vitest run --root tests/acceptance/1454 shown   # keeps AC7's files in <dir>
```

- **Permissions.** The process that runs the tests needs Accessibility and Screen Recording; `probe access` reads both. Without
  them a window test fails `BLOCKED: …`, never passes. A locked screen does too: check `CGSSessionScreenIsLocked` first.
- **Node.** `deep install` loads a package in the platform sandbox. On this Mac every such process exits `SIGABRT` before it connects,
  on main too, and `helpers.ts`, `install`, reads that as `BLOCKED`, not as the app's failure. A likely cause, not proven: Homebrew's
  `node` links dylibs under `/opt/homebrew/opt`, outside the sandbox's `NODE_HOME` read grant. Use an official, static Node build.
- **Builds.** The helpers run them, each once, and copy `deep-app` out of the target folder: plain, then `--features test-confirm`,
  then each plant. The plain build runs last, so the checkout's `target/debug/deep-app` is never a plant. `CARGO_TARGET_DIR` is honored.
- **Folders and processes.** Homes are under `/tmp`, binaries in `$TMPDIR/da1454-bin-<uid>`. Nothing touches the real `~/.deepbuild`,
  `~/.claude` or `~/Library/LaunchAgents`, and only what a test started is stopped, by PID. Windows are captured by ID, never the display.
- **`--root` cache.** Vitest writes `tests/acceptance/1454/node_modules/.vite/`; delete it before committing.
- **Lanes.** `scripts/lanes.mjs` needs `tests/acceptance/1454/` in its `alone` list, in a macOS, logged-in lane; the implementer makes that edit.

## The surface (my choice, since the issue names none)

As #1172: the real `deep-app` against a real hub with `HOME` a temp folder, read **from outside its process** by `probe.swift`
(window list, accessibility tree, the press a screen reader sends, a key posted to that PID, Vision OCR) and `screencapture -l<window>`.
The record is the hub's own `events.read`, and what reached a session is what its own `deep mcp` returned. Neither a label nor a reply
credits a criterion about what a person sees. The session is #26's agent stand-in; the figure is #806's.

### Pinned here: the implementation must provide these

1. **What the window names**, as #1172 pinned and #327 draws: a Needs you row is a node whose name holds its question and takes a press;
   the card's options are `AXButton`s whose names hold their labels, in the main window. The window can be set to 1512 × 982 points.
2. **`test-confirm`, a Cargo feature of `deep-app`, in no shipped build.** Built with it, the app reads `DEEP_APP_TEST_CONFIRM=<file>` in
   place of the OS prompt, at each ask: the file holding `confirmed` is you, anything else, a missing file included, a cancelled
   prompt. This is the hub's `DEEP_HUB_TEST_CONFIRM` file form, for the one boundary we don't own. A feature, not a plain environment
   variable, because an agent could start the shipped app with one and answer for you. The plain binary must not hold that string.
   After a cancelled prompt the ask stays open and the card stays up, and the same option takes a second press.
3. **The app signs its own answers.** The hub refuses an unsigned answer from the app (#34), and at the base the app holds no key. The
   app pairs its key through `device.pair` no later than its first answer; the hub's stand-in says yes in these homes. The fixture runs no
   `deep setup`, so pairing can't rest on setup alone. A test key stays under the temp `HOME`, never in your login Keychain.
4. **⌘K in the real window.** A `cmd-k` posted to the app's PID opens it once the app is frontmost, with no query typed. Each entry is a
   node named exactly its entry, `Board: alpha` and `Refresh board`, from the installed plug-in's `deep.registerView` pages and commands.
   A press on the page's entry closes ⌘K and mounts the panel with `props.page` in the page region, left edge past 18% of the window's
   width, in the same window. The list comes from what's installed, with no flag.
5. **Installed panels.** A view of area `sidebar`, installed before launch, draws in the main window at launch with no flag and no
   press, wherever in the left region the shell puts it. `deep install` runs the view's kit: a panel failing `panel@1` exits non-zero,
   with `panel@1` in its output, and the app doesn't mount it.
6. **The canvas.** `deep_show` while the app runs appears in the main window, on the session's page or at once. An untitled session's row is
   an `AXButton` holding `Session <first 8 of its id>`. The hub's world file is #806's (`panels.main.rect` `[0, 0, 800, 600]`); where the page
   puts that rect is yours, as the bars are judged by their ratio, at any scale. The picture is drawn, not its words retyped.
7. **The lint: `scripts/render-lint.mjs`**, run as `node scripts/render-lint.mjs [--root <dir>]`, checking every `fn render` of an `impl
   Render for …` under `<dir>/crates/deep-app/src`. Exit 0 with no `FAIL` line on a clean tree. Exit 1 with a line for each finding,
   starting `FAIL ` and holding `crates/deep-app/src/<file>:<line>`, for any read in a `render` of `current_state()`, or of a variable
   named `decorations`. A view's own state, `self.terminal.is_none()`, passes. It reads text, so a plant needn't compile. It runs in a
   lane of `scripts/lanes.mjs`'s `checks` on a change to the app. The plants need `impl Render for Shipped` in `views.rs` and `impl
   Render for Palette` in `commands.rs`. If the fix deletes `current_state`, the lint still flags that name.
8. **Plants: Cargo features of `deep-app`**, in no shipped build, added to `crates/deep-app/Cargo.toml` by the implementer (this job
   commits only this folder):
   - `plant-card-skips-confirm`: the card takes a press from no hardware as you, with no OS confirmation. Built with `test-confirm`.
   - `plant-page-drops-param`: ⌘K opens a page with no `props.page.params`, so it reads `Board page: (none)`.
   - `plant-panel-skips-kit`: the app mounts every installed panel, kit failed or not.
9. **The replica over its fixture.** `deep-replica --view needs-you` holds nodes named `Pop out Needs you` and `N asks need you`, and
   `--view session` one named `Terminal`, in a home where `setup-finished.json` exists.

### Merged surfaces, used as they are

`deep hub run`, `DEEP_HUB_TEST_CONFIRM`, `DEEP_HUB_TEST_SHOW`, `events.read`, `deep mcp` with `deep_ask` and `deep_wait`, `deep_show`,
`deep install`, `DEEP_APP_APPEARANCE`, `deep-replica --view`, `packageDigest`. A taste ask comes back from `deep_ask` at once as
`provisional`, with its recommended option: the tests pick the other one, and read the answer from `deep_wait`.

### The fixtures

`fixtures/board`: a plug-in with one panel, reading `Installed board panel` as the view and `Board page: <name>` as a page, a page per board,
and the command `Refresh board`. `fixtures/fails-panel-kit`: a panel the host's own `registerView` check takes and `panel@1` refuses, since it
imports `Dialog`; it reads `Refused overlay panel`. Whether that script draws at all when mounted is unverified (see Disputes, 3).
`fixtures/views-at-base.rs.txt`: the base's `views.rs`, the wrong program AC5's issue text names. `fixtures/wrong-lints`: three wrong lints.

## Criterion to tests

IDs are `criterionId` in `scripts/proof-change.mjs`.

| Criterion | ID | Tests | Wrong programs it fails on |
|---|---|---|---|
| AC1 | `#1454.67866115` | `answer.test.ts`: press with the OS saying no, nothing counts; yes, and `deep_wait` hands the session the option, with one `ask.answered`, `via: card`, and the row gone | the base; `plant-card-skips-confirm`; a stand-in in the shipped binary. `judges.test.ts`: none, two, another option, one from `deep inbox`, one the session never got |
| AC2 | `#1454.ecdbb26a` | `commands.test.ts`: both entries on the tree and pixels; the page's text, with its parameter, right of the list | the base; `plant-page-drops-param`; an empty list; a page in the sidebar's slot or its own window |
| AC3 | `#1454.a94aca43` | `panel.test.ts`: both packages installed, the good one's words on the pixels, the refused one's absent, `panel@1` named | the base; `plant-panel-skips-kit`; a window with nothing installed |
| AC4 | `#1454.913e347e` | `canvas.test.ts`: presented, recorded, then the figure's words and its bars in 4:3:2 in the snapshot's own color | the base; `judges.test.ts`: words with no picture, equal bars, bars with no one left edge |
| AC5 | `#1454.cbcbeda8` | `lint.test.ts`: the lint on the app, on each plant by file and line, on the base's `views.rs`, and its lane; and the replica's tree | the issue's plant, a renamed one, one in another view, the base's four lines; `fixtures/wrong-lints` |
| AC6 | `#1454.2c46f342` | **Not here.** #1002's and #994's first-screen criteria are proven on the real window by their blind redrafts in `tests/acceptance/1002/` and `tests/acceptance/994/`, a separate job's | those suites' |
| AC7 | `#1454.f1f3739d` | `shown.test.ts`: every file written, each state checked before its picture, then `TASTE.json` | no call, a call on other files: `INCONCLUSIVE`; `looks_wrong` fails, quoting it (`judges.test.ts`) |

No criterion above AC7 reads a picture to judge taste: they read words and where they sit, and a color's layout.

## The taste call (AC7)

`$DA1454_SCREENS` (a temp folder without it) gets `after-answer`, `commands`, `panel` and `canvas` as `.png`, each 3024 × 1964 px from the real
window, each with a `.record.json` beside it (the Proof's record: position, kind, writer and subject of each event, no words of anyone's),
`answer-recording.gif`, and `run.json`, the app binary's SHA-256. The criterion names no appearance, so the pictures are light. "Attached to the
PR and shown to you in the session" no test can see: the implementing agent does it.

`TASTE.json` is 1172's shape, and its `verdict` is `null` until a person calls it. Take the pictures once, call them, record them, and run again
against the same `$DA1454_SCREENS`: a kept folder holding exactly the files of a recorded call, from this same app binary, stands.

## Scope the criteria don't cover

No criterion names these, so nothing here tests them: the replica's window at the app's opening size, 960 × 640; `deepbuild.quotes` and the
recorded stocks leaving the shipped module; held, folded and later state coming from record events; Home's path in the real window.

## Disputes and assumptions a redraft may revisit

1. **The hardware path isn't proven.** A test from outside can't be hardware, by design, so AC1 proves the OS-confirmed path only.
2. **⌘K's delivery is untried.** A key posted to a PID may not reach GPUI's key equivalents, as a posted click doesn't (#1172, dispute 2). If so
   the probe needs another route, such as a menu item's press, which is a test defect for a redraft, not the app's failure.
3. **The refused panel's marker.** `plant-panel-skips-kit` shows its failure only if that script draws when mounted. If importing `Dialog` stops it
   drawing, the plant's test fails for the wrong reason.
4. **Where the kit is named.** I read "naming the kit" as `deep install`'s output, since the design runs kits at install. A window that names it
   would also serve a person, but is a new surface.
5. **Only `panel@1`.** "Under their kits" could also cover `needs-you@1`, `session.row@1` and `return.card@1`; no test here does.
6. **The lint's judge has only been seen failing.** Its pass side needs a clean tree, which the base isn't.
7. **A helper called from `render`** that hides a fixture read isn't planted: the criterion says `render`. The replica half covers the three
   things the issue names.
8. **`sidebar` as the fixture's area** is the one `panel@1` lays out and #366 used; the epic keeps the areas.

## Files

- `helpers.ts`: builds, the probe, `App`, the recorder, worlds, judges. Reuses `../26/helpers.ts` and `../806/`. `probe.swift`: copied from #1172, with `key` and `gif`.
- `answer.test.ts` (AC1), `commands.test.ts` (AC2), `panel.test.ts` (AC3), `canvas.test.ts` (AC4), `lint.test.ts` (AC5), `shown.test.ts` (AC7);
  `judges.test.ts`, no app and no criterion tag, passes at the base.
- `TASTE.json`, `tsconfig.json`, `BASE-FAILURE.txt`, `fixtures/`.
