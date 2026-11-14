# #1458 AC13, redrafted blind: each shipped page shown to you

A blind redraft (design: Dogfooding) of AC13 of #1458, written at base `2721ca7b` from issue #1458, epic #1453 for what a
page is, `docs/technical-design.md` (Look, States people see, Dogfooding), `AGENTS.md` and the base's code. No
implementation of #1458 was read; at the base `tests/acceptance/1458/` does not exist. `TASTE.json` is the one file here a
person's call changes.

## Criterion → test

AC13: "Shown to you: screenshots of each shipped page at both windows, in light and dark, taken by the check run from the
real app, are attached to the PR and shown to you in the session. Whether they look right is one taste call, recorded;
without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it".

`shown.test.ts`, one test. It builds the plain `deep-app` (and `deep-hook`, which a hub needs), copies it out of the target
folder, and runs it against a real hub in a temp home, read from outside its process with #1454's probe and `App`
(`../../1454/helpers.ts`, imported, not copied). For each appearance, light then dark, it reaches every page below. On each
page it sets the window to 960 × 640, waits until that page is on the window's accessibility tree, captures the window by
its ID, then does the same at 1512 × 982. That makes 6 pages × 2 windows × 2 appearances = 24 PNGs, named
`<page>-<w>x<h>-<light|dark>.png`, plus `run.json` with the app binary's SHA-256. They go to `$DA1458_SCREENS`, or a temp
folder without it. The run only takes the pictures. Nothing here reads a picture to judge it.

| Reads | When |
|---|---|
| BLOCKED | no Accessibility or Screen Recording for the process, a locked screen, or the build fails |
| FAIL | a page isn't on the window's tree in 30 s (the message names the page, window, appearance and the names the tree holds), the window can't be set to a size, a picture is missing, or `TASTE.json` holds `looks_wrong` (the message quotes its `note`) |
| INCONCLUSIVE | every picture was taken, but `TASTE.json` holds no call (`verdict: null`), or a call that names no one or no time, or a call whose `files` aren't exactly this run's names and SHA-256s. Also when a picture isn't 2× its window, which means this Mac's screen can't take it |
| PASS | `verdict: "looks_right"`, with `who` and `when`, on exactly this run's 25 files |

The pixels of a real window can differ from run to run. So a folder holding exactly a recorded call's files, whose
`run.json` names this same app binary, stands: the run doesn't take those pictures again. To record a call: run once with
`DA1458_SCREENS=<dir>` and look at the 24 pictures. Then fill `TASTE.json` with `verdict`, `who`, `when` and `files` (each
file's name and SHA-256, as the run prints them, `run.json` among them), and run again against the same `<dir>`. "Attached
to the PR and shown to you in the session" is the implementing agent's job. No test can see it.

## The pages, and how each is reached (my choice, since the issue doesn't list them)

The issue says "each shipped page" and doesn't list them. I took the pages that the base's real window can show, as
`views::Layout::app` and ⌘K's `installed::shipped_pages` put them. The question card counts as a page because the epic says
the page shows "an ask's question card, a session's page or a project's page". The seeded world is two sessions, titled
`Header layout` and `Checkout page`, in project `shop`, with one open choice ask on the first: "Store the drafts in SQLite
or plain files?", whose options are `SQLite` and `Plain files` (#26's seeding).

| Page | Reached by | On the tree once |
|---|---|---|
| `welcome` | the first launch: a home with no `setup-finished.json` and no hub, since setup is what starts the hub | an `AXButton` named `Set up` |
| `needs-you` | where the window opens, in the seeded home with setup finished | a node named `Needs you`, and an `AXButton` holding the question |
| `question-card` | a press on that row, in the same launch | `AXButton`s holding `SQLite` and `Plain files` |
| `session` | a new launch: a press on the sidebar's `Header layout` row | a node named `Session Header layout` |
| `agents` | the sidebar's `Agents` button, in the same launch | a node named `MCP servers` |
| `home` | ⌘K posted to the app's PID, then a press on its `Home` entry | a node named `Home`, with none named `Needs you` (so ⌘K closed and Needs you is gone) |

Dark is the app's own appearance: `DEEP_APP_APPEARANCE=dark`, which `main.rs` reads ("macOS has no outside switch for one
process's appearance"). Light is `DEEP_APP_APPEARANCE=light`. No system setting changes.

Left out, and why:
- **Rules** (`Kind::Rules`) is drawn only by the replica's `--view rules`. At the base nothing in the real window opens it.
  When ⌘K or a menu lists it (#1460, #1462), it belongs here. That would be a redraft, not this criterion's change.
- **The line** (bottom dock) and **the sidebar** are in every picture. They aren't pages.
- **An installed plug-in's page** isn't shipped.
- **The popped-out Needs you** is a window of its own, not a page.

## How to run

On macOS, logged in, with the screen unlocked. With Node 24.22 and cargo 1.99.1 first on `PATH`
(`$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin`), and the workspaces built (`npm ci; npm run build --workspaces`):

```sh
caffeinate -di npx vitest run --root tests/acceptance/1458/redraft-ac13 --testTimeout=600000
DA1458_SCREENS=<dir> caffeinate -di npx vitest run --root tests/acceptance/1458/redraft-ac13 --testTimeout=600000   # keeps the pictures
```

- **Permissions.** The process running vitest needs Accessibility and Screen Recording (#1454's `probe access` reads both).
  Without them the test stops BLOCKED. The screen must be at least 1512 × 1022 points, since the window is placed 40 points
  down.
- **Builds.** `cargo build --locked -p deep-app -p deep-hook` with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0`. The app
  is copied to a temp folder. `CARGO_TARGET_DIR` is honored. The probe compiles once into `$TMPDIR/da1454-bin-<uid>`, as
  #1454's suite does.
- **Folders and processes.** Homes are under `/tmp/dh26-*`. Nothing touches the real `~/.deepbuild`, `~/.claude` or system
  settings. Only what the test started is stopped, by PID. Windows are captured by ID, never the display. The run takes
  about 6 launches of the app.
- Vitest writes `node_modules/.vite/` under `--root`. Delete it before committing.

## Ambiguities a redraft may revisit

1. **Which pages.** My list is the table above. If the implementation adds a page to the real window, the list won't grow
   on its own.
2. **⌘K's delivery.** Home is reachable at the base only through ⌘K. A key posted to a PID may not reach GPUI's key
   equivalents (#1454, Disputes 2). If it doesn't, `home` fails naming ⌘K, and that is a test defect, not the app's.
3. **The welcome has no hub.** It's a first launch, before Set up starts one. Every other page runs on a real hub.
4. **One picture per page per window and appearance.** The card is pictured over Needs you, where the base draws it.
