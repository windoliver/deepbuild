# Acceptance tests for #1002: Set up that didn't finish is offered again

A blind job wrote these tests before any implementation of #1002 existed. It worked from:
- issue #1002 (its body as of November 3, 2026): Scope, the three acceptance criteria and Proof;
- the design's How it installs (Setup, Editing agent settings, the hub at login), States people see, the reference
  window row under Decided, Dogfooding and How we know version 0 works;
- base commit `407d600d` (origin/main): `packages/hub/src/setup.ts` (`install`, `setUpFirst`), `service.ts`
  (`startHub`, the `DEEP_HUB_LAUNCHER` seam), `packages/cli/src/main.ts`, `crates/deep-app/src/{setup,lib,views,main}.rs`
  and `crates/deep-replica` (`src/main.rs`, `src/lib.rs`, `src/snapshot.rs`);
- the conventions of `tests/acceptance/326/setup` (this folder's model), `326/surfaces`, `326/panels` and `882`.

Nothing of #1002 is implemented at the base. The implementing agent does not edit these files (AGENTS.md, Proof). A
dispute goes to a blind redraft of this job.

## How to run

With Node 24.22 first on `PATH`, the workspaces built (`npm ci; npm run build --workspaces`) and cargo on `PATH`:

```sh
cargo build --locked -q -p deep-hook                          # setup's entries run target/debug/deep-hook
cargo build --locked -q -p deep-app --bin deep-app            # macOS: the app's Set up
cargo build --locked -q -p deep-replica --bin deep-replica    # macOS: the app's first screen
npx vitest run --root tests/acceptance/1002 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1002/tsconfig.json
```

- The helpers run the cargo builds themselves if needed. No `Cargo.toml` was edited: there is no Rust test here.
- `DA1002_SCREENS=<dir>` keeps the screenshots `screens.test.ts` takes (`first-screen-settings.png`,
  `first-screen-hub.png`), to attach to the PR and show you; without it they go to a temp folder that is removed.
- **Folders.** Every test makes its folders under `/tmp/da1002-*` (a socket path must fit in 104 bytes). HOME is
  `<tmp>/h` for every process it starts. It never touches the real `~/.deepbuild`, `~/.claude`, `~/.claude.json`,
  `~/.config/systemd` or `~/Library/LaunchAgents`.
- **Processes.** It stops only processes it started, by PID, including the hubs the login service stand-in started
  (their PIDs are in `<tmp>/launched`). Children get no billing key and none of the runner's `DEEP_*`, `CLAUDE*`,
  `CODEX*`, `GIT_` or `XDG_*` variables.
- **Cache.** With `--root` here, Vitest writes its cache to `tests/acceptance/1002/node_modules/.vite/`. Delete it
  before committing.
- **Where it runs.** `cli.test.ts` and `twins.test.ts` run on macOS and Linux. `app.test.ts` and `screens.test.ts`
  need macOS (the app and the replica draw there only); elsewhere each fails `BLOCKED`, never passes. This draft ran
  on Linux arm64, so the four macOS tests have not been run by this job (BASE-FAILURE.txt).
- **Time.** About 60 s on Linux at the base; each hub that doesn't start costs setup's 15 s wait.

### Stand-ins, first on PATH as `<tmp>/bin`

- **The login service** is reached through the merged seam `DEEP_HUB_LAUNCHER` (`packages/hub/src/service.ts`),
  which every child gets: `launcher` runs `fixtures/launcher.mjs` (copied as-is from `tests/acceptance/16/fixtures/`),
  which starts the program the hub's service definition names, plist or systemd unit, detached, and logs its PID.
  `dead-launcher` takes the definition, exits 0 and starts nothing: **a hub that doesn't start**. The seam works on
  both platforms, so the CLI half runs on Linux too; #326's `launchd.mjs` isn't copied, as nothing here needs launchd's
  state.
- **`launchctl`, `systemctl`** and **`claude`** (`fixtures/stub-bin.sh`, copied from `326/setup`) log their call and
  exit 0, so a program that ignored the seam would start no hub and fail, never reach the real service manager.
- **`sh-login`** is `SHELL`, your login shell, with no profile of the test machine.
- **`deep`** runs the built CLI, `packages/cli/dist/main.js`; the app's Set up runs it from PATH.

## The surface

### Pinned here: the implementation must provide these

1. **The finished record: `~/.deepbuild/setup-finished.json`.** Setup writes it as its last step, once everything is
   in place and the hub answers. It is a JSON object whose `version` is DeepBuild's version, exactly what
   `deep --version` prints (trimmed); other keys are free. A setup that stops, for any reason, leaves none: neither a
   settings file that won't parse nor a hub that doesn't start may leave one, whatever else that setup wrote. Every
   way in writes it: the first `deep` command and the app's Set up (`deep-app --set-up`, which may run `deep setup`).
2. **The first `deep` command offers Set up while the record is missing, whatever else exists.** `deep status` in a
   home with `~/.deepbuild` in place (the tests make sure it is) and no record runs setup's steps again, as #326's
   first command does in an empty home:
   - setup failing on the settings file: it exits non-zero and its stderr names the file by its path
     (`<home>/.claude/settings.json`);
   - setup failing on the hub: it exits non-zero and its stderr names the hub (`/\bhub\b/i`);
   - setup finishing: it says so in **exactly one non-empty line on stderr** naming the hooks, watch-only, the hub and
     `deep setup --undo` (#326's pinned line), writes the record, and exits 0 doing its own job; the hub then answers at
     `~/.deepbuild/hub.sock` within 30 s.
   - Once the record exists, the next `deep status` exits 0, prints no stderr line naming watch-only, `deep setup
     --undo` or `deep setup:`, and rewrites none of `~/.claude/settings.json`, `~/.claude.json`,
     `~/.deepbuild/rules.json`, `~/.deepbuild/config.json` or the record.
3. **Reopening the app: `deep-replica --first-screen --out <dir> --appearance light`.** The replica binary
   (`crates/deep-replica`, bin `deep-replica`, built at `target/debug/deep-replica`) takes `--first-screen` in place of
   `--view <id>` and draws **the app's first screen as a launch of the app would show it for the HOME it runs with**:
   what the window shows before you do anything (the welcome with its Set up button, the home with its count, or
   whatever the implementation shows first) and the menu bar's count. It reads that home's `~/.deepbuild` (the record,
   why setup stopped) and its hub if one answers; it never reads a fixture record. At the reference window, 1512 ×
   982 points at 2×, light. It exits 0 and writes under `<dir>`:
   - `snapshots/first-screen.json`: the replica's snapshot of the window (`deep_replica::snapshot::Snapshot::to_json`:
     `{"window": {"size": [1512, 982], "scale": 2}, "tree": <node>, "items": [...]}`, each node
     `{"role", "name", "value", "bounds", "children"}`), whose nodes are the window's accessibility tree;
   - `screens/first-screen.png`: its screenshot, 3024 × 1964 pixels;
   - `menu-bar.txt`: the menu-bar item's title, as `deep_app::menu_bar_title` gives it, one line.
   At the base `deep-replica --first-screen` exits 2, `deep-replica: unknown argument --first-screen`.
4. **What that first screen shows after a setup that stopped** (judged by accessibility names and values, never by
   pixels; `offeredAgain` in `helpers.ts`), in this order:
   - **the count reads setup didn't finish, never 0**: no node's name or value matches `0 asks need you` (or `0 ask
     needs you`, `0 waiting on you`); the menu bar's title is not empty and not a bare number; and some node's name or
     value matches `/set ?up did(n't| not) finish/i`;
   - **Set up is offered again**: a node with role `button` and name `Set up` (#326's button);
   - **the reason, with its fix**: for the settings file, the names and values together contain the file's path
     (`<home>/.claude/settings.json`, or `~/.claude/settings.json`) and a fix (`/\bfix/i`); for the hub, they name the
     hub (`/\bhub\b/i`) and its start (`/start/i`).
   Once setup finished, the first screen has no `Set up` button and nothing reading setup didn't finish.
5. **The taste call: `docs/evidence/1002/taste.json`**, a person's call on the two screenshots `screens.test.ts`
   took:
   ```json
   { "criterion": "#1002.1f6f1740", "call": "looks right", "by": "<who>", "at": "<date>",
     "screens": { "first-screen-settings.png": "<sha256>", "first-screen-hub.png": "<sha256>" } }
   ```
   With no file, one on #1002 naming nobody, or one whose `screens` aren't exactly this run's screenshots by SHA-256,
   the test fails with a message starting `INCONCLUSIVE`, never passes. `"call"` other than `looks right` fails,
   quoting it and its `note`. No suite before this one records a taste call on screenshots, so the shape is this
   job's (Disputes 5).

### Merged surfaces, used as they are

- `deep-app --set-up` (#326): the Set up click, headless; at the base it runs `deep setup` from PATH and exits 1,
  `deep-app: deep setup failed (...)`, with setup's stderr, when setup fails.
- `deep setup`, the first `deep` command (`setUpFirst`) and their one line (#19, #326); `deep --version`.
- `DEEP_HUB_LAUNCHER` (#16), `DEEP_HUB_TEST_CONFIRM` (#24), the hub's socket and hello (#16).

## Criterion to tests

| ID | Criterion (short) | Tests | Wrong programs each fails on |
|---|---|---|---|
| `#1002.4273b842` | settings unparseable: Set up fails naming the file; reopening offers Set up again with that reason; the count reads setup didn't finish, never 0; the base opens on "0 asks need you" | `cli.test.ts` (first `deep` command: fails naming the file, no record, the next command offers it again); `app.test.ts` (the app's Set up fails naming the file; the first screen offers Set up with the reason and its fix; the count) | the base (CLI: the next command runs no setup; app: no first-screen surface); twins `record-first`, `folder-check`, `folder-check` screen, `count-reads-zero`, `no-reason` |
| `#1002.8e3f037e` | file fixed: Set up from the app finishes, writes its record, the next `deep` command runs no setup; a hub that doesn't start is offered again the same way | `cli.test.ts` (after the fix the next `deep status` sets up, writes the record with its version, the one after runs no setup; the hub that didn't start: no record, offered again, finishes); `app.test.ts` (after the fix `deep-app --set-up` finishes, the record, `deep status` runs no setup, no Set up on the first screen; the hub that didn't start: no record, the first screen offers Set up with the hub as the reason, the count) | the base; twins `no-version`, `folder-check` |
| `#1002.1f6f1740` | screenshots at the reference window, shown to you; one taste call recorded, else INCONCLUSIVE | `screens.test.ts` (both first screens at 1512 × 982 at 2×, light, judged as above, kept in `$DA1002_SCREENS`, then the taste call) | the taste-call judge's wrong records in `twins.test.ts` |

"Attached to the PR and shown to you in the session" is not something a test can see: the implementing agent attaches
the files `$DA1002_SCREENS` holds and shows them; the taste call names them by digest.

### Wrong programs (`twins/`, runnable now on any platform)

Built from merged code, so they run at the base. The CLI twins stand in for `deep` (`twins/twin.mjs <mode>`, run
through a shell file per mode). Each does setup's steps with `deep setup`, keeps its own finished record, and runs the
command's own job through the hub package's public entry (`statusCommand` from `@deepbuild/hub`), never through
`deep status`, so the first-command setup of the CLI under test never runs inside a twin and can't repair the fault
it plants (Disputes 9). `first-screen.mjs <mode>` stands in for `deep-replica --first-screen`, writing the pinned files in the
replica's snapshot shape. `twins.test.ts` runs the same scenarios (`scenario.ts`) and judges (`helpers.ts`) on them.

| Twin | What it does wrong | Message it must fail with |
|---|---|---|
| the base | the first command keys on `~/.deepbuild`; no record; no first-screen surface | every tagged test (BASE-FAILURE.txt) |
| `record-first` | writes the record before setup plans any file, and keeps it whatever setup does (puts it back if setup removed it) | "…'s setup stopped, so it must leave no record that it finished" |
| `folder-check` | writes the record on success, but a first command checks only that `~/.deepbuild` exists | "while setup hasn't finished, the next deep command (deep status) must offer Set up again …"; and for the hub, "after a setup whose hub didn't start, the next deep command … must offer Set up again" |
| `no-version` | its record names no version | "…'s record must name its version" |
| `first-screen.mjs folder-check` | the base's first screen: Set up only while the folder is missing, else "0 asks need you", menu bar "0" | "the count must read setup didn't finish, never 0: the first screen reads "0 asks need you"" |
| `first-screen.mjs count-reads-zero` | offers Set up with the reason, but the count reads "0 asks need you" | the same |
| `first-screen.mjs no-reason` | offers Set up and the count, without the reason | "reopening the app must show why setup stopped, naming …" |
| taste records | none; on other screenshots; by nobody; "looks wrong" | `INCONCLUSIVE: no taste call …`, `INCONCLUSIVE: … on other screenshots`, `INCONCLUSIVE: … names no person`, "the recorded taste call says the screenshots don't look right" |

Positive controls, which must pass the same checks: `finishes-once` (the first command runs `deep setup` while the
record is missing and writes it with `deep --version` once setup exits 0) and `first-screen.mjs right` (Set up, the
count "Setup didn't finish" and the reason with its fix while the record is missing; no Set up once it exists), and a
taste record of "looks right" on exactly these screenshots. So a failure on the real CLI, app or replica is the
program's, not the test's.

The twin and control tests carry no criterion tag (`#1002 (wrong program …)`, `#1002 (control …)`): they pass at the
base on purpose. The first-screen twins are written models, not the app: they show the judges reject what they must,
and only `app.test.ts` and `screens.test.ts` reach the real first screen.

## Disputes and assumptions a redraft may revisit

1. **The first-screen surface.** The issue names the app's first screen but no entry point, and the base has none
   that draws it for a home: the replica draws a fixture record, and the shipped window is still #337's spike.
   `deep-replica --first-screen` is the smallest surface that reaches it headless and reads it as text, beside the
   replica's `--view`. At the base it is an unknown argument, so #1002.4273b842's app test fails there on the missing
   surface, not on the count; "fails, naming the count" is shown by the `folder-check` first screen, the base's logic
   written as a model. A redraft that can reach the base's real first screen would make the base itself fail on the
   count.
2. **The record's place and shape.** `~/.deepbuild/setup-finished.json` with `version` = `deep --version` is this
   job's choice; `setup.json` already holds undo's record, written partway through setup at the base, so it can't be
   the finished one.
3. **The count.** Judged anywhere on the first screen and in the menu bar: no "0 asks need you", a menu-bar title
   that isn't a bare number, and some node reading setup didn't finish. It does not require that text in the menu
   bar itself, or in one particular node.
4. **The reason and its fix.** For the settings file: its path and the word fix. For the hub: "hub" and "start";
   no fix is required beyond the Set up button, since the base's own hub message points at `deep doctor`.
5. **The taste call's record.** No suite records one yet. A file a person writes, bound to the screenshots by digest,
   assumes the replica draws the same bytes on one machine run to run; if it doesn't, a redraft may bind the call to
   the snapshot instead. The proof lanes' guard, not this test, decides whether the file's author is a person.
6. **Which first command.** `deep status`, as in #326. Whether `deep --help` or `deep mcp` offer Set up is not tested.
7. **"Whatever else exists"** is tested as `~/.deepbuild` in place (made by the test when setup didn't), and, for the
   hub, everything else a setup that got that far wrote (hooks, rules, `setup.json`).
8. **The login service.** Reached through the merged `DEEP_HUB_LAUNCHER` seam rather than a launchd stand-in, so the
   CLI half runs on Linux. An implementation that drops the seam fails these tests (no hub starts), never passes them.
9. **Redraft of the CLI twins (November 3, 2026, on a dispute).** The first draft's twins ended in `exec deep "$@"`
   on the CLI under test. On the implementation branch that CLI re-offered setup on the twin's `deep status` and its
   setup cleared a record it didn't write, so `record-first` and `folder-check` passed the checks they must fail. The
   redraft (blind as before: base, issue, design) runs each twin's own job without the CLI's first-command path, and
   `record-first` keeps its record over whatever setup does. `no-version` was not masked (its record is overwritten
   after setup, and checked at once), but moved to the same shape; the `first-screen.mjs` modes read only the home's
   files and were left as they were. A twin still assumes `statusCommand` itself runs no setup; an implementation that
   moves the first-command setup into it would need another redraft. No tagged test changed.

## Files

- `helpers.ts`: temp homes with the stand-ins; `deep`, the app's Set up and the first screen through the built
  binaries; the finished record; the first screen's judges; the taste-call judge. Adapted from `326/setup/helpers.ts`.
- `scenario.ts`: the CLI half's three scenarios, run on the CLI and on the twins.
- `cli.test.ts`, `app.test.ts`, `screens.test.ts`: the tagged tests. `twins.test.ts`: wrong programs and controls.
- `twins/`: `twin.mjs` with its shell entries `finishes-once`, `record-first`, `folder-check`, `no-version` (for `deep`), and `first-screen.mjs`.
- `fixtures/`: `launcher.mjs` (from `16/fixtures/`), `stub-bin.sh` (from `326/setup/fixtures/`).
- `tsconfig.json`: type-checks the suite under the root's strict options.
- `BASE-FAILURE.txt`: the run at the base, trimmed to each test's reason.
