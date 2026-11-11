# Acceptance tests for #1100: the first-launch screen says what Set up will do before you click

Written first and blind, at base commit `435141d5` (origin/main, which holds `07b63844`), from issue #1100 (updatedAt
2026-11-11T06:56:54Z: its problem, Scope, 15 acceptance criteria and Proof), the design and the base, before any
implementation. The implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of
this job (design: Dogfooding).

## What was read

- **The issue**, #1100, and for the words it cites: #19, #1002, #1461 and #1998 (dependencies), #329 and #1453 (siblings).
- **The design**, `docs/technical-design.md`: How it installs (Setup: the first-launch screen's row per agent and three
  lines built from setup's one list of steps; Editing agent settings: undo restores the bytes kept before the first write),
  States people see (every term a view shows carries its meaning from the One word per idea table), How we know version 0
  works (Criteria to tests, Criteria in a checked shape, Wrong programs, Dogfooding), Decided: The reference window.
  `docs/canvas-primitives.md`, One word per idea (Name | Means | Never call it | Why).
- **The base**, for its surfaces only: `packages/hub/src/{setup,box,plant,list,codex-settings,paths,service,wiki-build}.ts`,
  `packages/cli/src/main.ts`, `crates/deep-app/src/{setup,views,notify,open,plain}.rs` and `probes/notification_center.rs`,
  `crates/deep-replica/src/{main,deep_drive}.rs`, `drive/{mod,locate,frames}.rs`, `snapshot.rs`, `lib.rs`,
  `crates/deep-hook/default-rules.json` and its denial text, `scripts/proof-change.mjs` (`criterionId`), and the suites
  `1002` (with `first-screen-redraft/`), `1461`, `1556`, `1998`, `1348`, `326/setup`, `19/setup` and `1454/helpers.ts`.

No branch, worktree, pull request or session working on #1100 was read.

## How to run

macOS (the replica and the app draw there only), Node 24.22 or newer first on `PATH`, cargo on `PATH`, Xcode's command line
tools (`swiftc`, for `shown.test.ts`), outside the Bash tool's sandbox, in a logged-in, unlocked session:

```sh
npm ci --ignore-scripts && npm run build --workspaces
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook --bin deep-hook
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-replica --bin deep-drive
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-replica --bin deep-drive --features env-plants
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-app --bin deep-app
caffeinate -di node node_modules/vitest/vitest.mjs run --root tests/acceptance/1100 --no-file-parallelism --testTimeout=3600000
DA1100_SCREENS=<dir> caffeinate -di node node_modules/vitest/vitest.mjs run --root tests/acceptance/1100 shown
node node_modules/typescript/bin/tsc -p tests/acceptance/1100/tsconfig.json
```

- **Builds.** The helpers run those cargo builds once a file (a no-op when current) with #1172's build environment, and
  copy each `deep-drive` out of the target folder into `$TMPDIR/da1100-bin-<uid>`, so the planted build never stands in for
  the plain one. `shown.test.ts` builds the app through #1454's `appBinary`. A build that fails is `BLOCKED`, never a pass.
- **Files.** `journey.test.ts` and `plants.test.ts` (the replica, real setups), `stops.test.ts` and `busy.test.ts` (the
  replica), `first-command.test.ts` (the CLI; on macOS and Linux), `shown.test.ts` (the real app, read from outside: the
  process running the tests needs Accessibility and Screen Recording, or it fails `BLOCKED`).
- **Folders and processes.** Everything is under `/tmp/da1100-*`; HOME is `<tmp>/h` for every process. Nothing touches the
  real `~/.deepbuild`, `~/.claude`, `~/.codex`, `~/.paseo` or `~/Library`. Children get none of this process's `DEEP_*`,
  `CLAUDE*`, `CODEX*`, `XDG_*`, `GIT_*`, `GH_*`, `ANTHROPIC_*`, `OPENAI_*` or `AWS_*` variables. Only what a test started is
  stopped, by PID, the hubs the login service stand-in started included (`<tmp>/launched`).
- **No model, no network.** `claude`, `codex` and `paseo` are stubs that log and exit 0; the OS confirming you is
  `DEEP_HUB_TEST_CONFIRM`'s file holding `confirmed`.
- **Pictures.** AC15 writes to `$DA1100_SCREENS` (a temp folder without it) and reads INCONCLUSIVE until `TASTE.json`'s call
  is recorded on exactly that run's files.
- **Lanes.** The folder runs real setups and replicas: `scripts/lanes.mjs` needs `tests/acceptance/1100/` on its `alone`
  list, in a macOS, logged-in lane, and AC15 by hand as #1461's AC28 is. The implementer makes that edit.
- **`--root` cache.** Vitest writes `tests/acceptance/1100/node_modules/.vite/`; delete it before committing.

## The fixture machine

`helpers.ts` `makeHome`: a temp home with nothing of DeepBuild. `<tmp>/bin` comes first on `PATH` and holds `node`;
`launcher`, the login service stand-in reached through the merged seam `DEEP_HUB_LAUNCHER` (`fixtures/launcher.mjs`, #16's,
which starts the program the service definition names and logs its PID); `launchctl` and `systemctl`, which log and exit 0;
`sh-login`, your login shell (`SHELL`), whose PATH is `<tmp>/bin` and the system's folders only; and `deep`, which logs
`start <args>` and `end <code>` to `<tmp>/deep.log`, drops `DEEP_HUB_PLANT` (so an app plant never reaches setup or its
hub) and runs the built CLI. The app's Set up finds that `deep` on the login shell's PATH, as it does at the base.

- **Claude Code installed**: `claude` on that PATH (`--version` answers the newest version its facts cover), your
  `~/.claude/settings.json` (tabs, your status line and hooks, no final newline) and `~/.claude.json`.
- **Codex installed**: `codex` on that PATH, your `~/.codex/hooks.json` and `~/.codex/config.toml`.
- **pi absent**: no `pi` anywhere on the PATH and no `~/.pi`.
- **History** (the journey, the plants, AC15): one session in each agent's history, where their facts put transcripts.
- Per test: `paseo` on the PATH (AC11; it lists no plugin and writes `~/.paseo/config.json` as it installs one, as paseo's
  manager does); Claude Code's settings file unparseable (AC5); `deep setup` that takes 5 s
  (`slow`, AC13) or fails with `fixtures/trace.txt` on stderr (`trace`, AC10); a login service that first makes
  `~/.deepbuild/wiki` a folder nobody may write (AC8); a `cargo` whose build of deep-hook takes 5 s (AC12).

## The surface

### Pinned here: the implementation must provide these

The issue names the screen, its rows and lines, setup's one list of steps, the record's setup events and the planted wrong
programs, but no node, event kind, launch option or plant name. These are this job's, the narrowest the base allows.

1. **The first-launch screen's list, as author ids** in the replica's snapshot (and, by #1459's rule, the real tree's
   identifiers), all inside the first-launch page, `page/welcome` (#1461):
   - `setup-agent:<agent>`: one node per agent setup found, `<agent>` the agent's id as the adapters' facts name it
     (`claude-code`, `codex`, `pi`, …), its words holding the agent's name (`Claude Code`, `Codex`, `pi`);
   - `setup-step:<step>:<agent>` for each step of the one list of steps setup then runs for that agent, and
     `setup-step:<step>` for a step of no agent; `<step>` is setup's own name for it, free, except that the step that reads
     an agent's history into the wiki, a reading job, is `history` (`setup-step:history:codex`). These may be the rows' marks
     that say done as each step ends, or nodes with no words of their own; none is a control;
   - `setup-line:undo`: the take-it-back line, its words its name or value.
2. **While Set up runs** the Set up button stays a button (role `button`) whose name starts `Setting up`; **once a Set up
   stopped**, a button named exactly `Set up` is on the page again.
3. **The record's setup events: `setup.step@1`**, one per step setup ran, from the app's Set up and from `deep setup` and the
   first `deep` command alike, `data.step` the same `<step>` the screen's node names and `data.agent` the agent's id, or null
   for a step of no agent. They are in the home's record, read through the hub's `events.read`, within a minute of setup's
   end. Its schema joins `packages/contracts/schemas/`.
4. **The replica stands in for macOS's notification setting.** `deep-drive`'s `launch` takes `notifications: "not_asked"`,
   a fresh account whose app was never asked (without it, the replica behaves as now). `see` answers `notifications:
   {setting}`, one of `not_asked`, `allowed`, `denied` or `alerts_none`; the stand-in answers each request of the app's at
   once, as a person pressing Allow. `close`'s trace holds `permission_requests: [{t, ask}]`: every request the app made to
   macOS to allow notifications, `t` the replica's clock, `ask` the handle of the ask whose notification it was posting when
   it asked, or null.
5. **The first `deep` command's lines**, each on stderr: the set-up line names `deep setup --undo` and says the guard
   entries block, with the number of `mode: "block"` entries in `crates/deep-hook/default-rules.json` (30 at the base); it
   is printed before the command's own output whenever setup wrote anything, whatever setup's exit code, and the command
   still runs. A step that takes more than 2 s prints one line naming it before it ends; the deep-hook build's line says
   `build` (or `compile`) and `hook`.
6. **App plants**, selected by `DEEP_HUB_PLANT` and read through `plain::planted` in builds with deep-app's `env-plants`
   (`deep-drive --features env-plants`), everything else as shipped:
   - `first-launch-written-list` (AC1): the first-launch screen's rows and lines come from a written list naming Claude
     Code, Codex and pi, each with the same steps (`setup-agent:pi` among the rows), not from setup's list.
   - `first-launch-second-option` (AC2): a second button beside Set up, named exactly `Set up without history`, that runs
     setup too.
   - `undo-line-missing-route` (AC3): the take-it-back line reads exactly `To take it back, run deep uninstall.`
   - `first-launch-pretooluse` (AC4): the line saying what setup adds reads exactly `It adds PreToolUse hooks to Claude Code
     and Codex.`, with no gloss anywhere on the page.
   - `stays-on-first-launch` (AC6): after a Set up that works the window stays on `page/welcome`.
   - `notifications-asked-at-first-post` (AC7): the click asks macOS nothing; the first notification posted asks, as at the
     base, in the code the replica runs too, so its trace records it.
   - `set-up-prints-output` (AC10): the screen shows setup's error output, every line of it, as the base's line does.
   - `set-up-hides-button` (AC13): while Set up runs the button is hidden and a label says it's setting up, as the base
     draws it.
   - `set-up-starts-twice` (AC13): while Set up runs the button reads Setting up, and a press on it starts setup again.
   - `first-launch-nothing-leaves` (AC14): the line saying what setup never does reads exactly `Nothing leaves this Mac.`
7. **CLI plants**, selected by `DEEP_HUB_PLANT` through `activePlant()`, and listed in `packages/hub/src/plant.ts`'s closed
   list and `PLANTS`, so the hub the login service starts with the same variable starts too:
   - `set-up-line-says-nothing-blocks` (AC9): the set-up line says nothing of the guard entries that block (the base's
     line, "no verdict blocks").
   - `set-up-line-to-stdout` (AC11): the first command writes its set-up line to stdout.
   - `silent-steps` (AC12): setup prints nothing while a step runs, however long it takes.
8. **The One word per idea table holds the term "PreToolUse hooks" uses** (`hook`, or `PreToolUse hook`) with its Means,
   since AC4's check reads the table itself and must refuse those words; at the base the table holds neither.

### Merged surfaces, used as they are

`deep-drive` (#124): `launch` with `from: "empty"`, `setup: "unfinished"` (#1461) and `clock: "real"`; `see` (the snapshot's
nodes with ids and the drawn `runs`, `address`, `focus`); `act` click by locator and at a point (#1461); `wait_for` a time;
`feed`; `close` and its trace. The Set up button (#326) running `deep setup` from the login shell's PATH; the first-launch
page `page/welcome` and the box `box`/`box-draft` (#1461). `deep setup`, `deep setup --undo` and the first `deep` command
(#19, #326, #1002); `deep <command> --help`, which never acts (#1359); the hub's `events.read` and `box.say` on the `cli`
role (#1998); `DEEP_HUB_LAUNCHER` (#16) and `DEEP_HUB_TEST_CONFIRM` (#24); #19's Claude Code stand-in
(`19/setup/fixtures/claude.mjs`), which fires the entries of `~/.claude/settings.json`; #1454's `App`, probe and capture;
#1461's `rowSet` and #26's `askData` for the ask AC7 feeds; deep-app's `DEEP_APP_APPEARANCE`; the `env-plants` features.

## The journey

`journey.test.ts` judges seven criteria on one walk: the fixture machine with history; the replica's first launch as a fresh
account; a press on Set up, which runs the real `deep setup`; the clock alone until the window leaves `page/welcome` (or
setup ends); an ask fed and left to come due; the replica closed; the home's hub read (`setup.step` events), the
take-it-back line's routes tried (each `deep` command's help, each box sentence through `box.say`); `deep setup --undo`; the
four settings files read again. A Set up that doesn't work on the fixture makes the parts after it `BLOCKED`.

## Criterion to tests

IDs are `criterionId` in `scripts/proof-change.mjs`. A test headed `wrong program` runs the planted program and expects
the criterion's judge to fail on it, naming what the criterion says.

| ID | Criterion | Tests | Wrong programs it fails on |
|---|---|---|---|
| `#1100.09a72dfd` | AC1: the screen names Claude Code and Codex, not pi; the record's setup events name exactly the agents and steps it listed | `journey.test.ts` AC1: rows `setup-agent:claude-code` and `:codex`, both names, nothing naming pi, a list of steps; then `setup.step` events equal to the screen's steps and agents | the base (no rows, no steps, no events); `first-launch-written-list`, naming pi (`plants.test.ts`) |
| `#1100.919771a4` | AC2: one button and no other control that writes | `journey.test.ts` AC2: on `page/welcome`, the controls that write are the one `Set up` button | `first-launch-second-option`, naming `button … "Set up without history"` |
| `#1100.f7be8897` | AC3: after Set up, `deep setup --undo` restores both agents' settings byte for byte; the take-it-back line names that route | `journey.test.ts` AC3: `setup-line:undo` names `deep setup --undo`; each route it names exists; undo exits 0; the four files equal their bytes before | the base (no line); `undo-line-missing-route`, naming `deep uninstall` |
| `#1100.7caad132` | AC4: no term of the One word per idea table without its Means beside it, the check reading the table | `journey.test.ts` AC4: each table Name the page shows has its Means in the same text or the one before or after | `first-launch-pretooluse`, naming the term (needs Pinned 8) |
| `#1100.bde8557a` | AC5: settings unparseable: one line naming the file, Set up pressed again in the same window | `stops.test.ts` AC5: one line naming `.claude/settings.json`, on one line, no exit status, the `Set up` button back, a second press starting setup again | the merge base: the button is gone and the line reads `deep setup failed (exit status: 1): …` |
| `#1100.dbc87baa` | AC6: after a Set up that works, the first open ask, the latest project or the box, no further input | `journey.test.ts` AC6: `ask/…`, `project/…`, or the page holding `box` with the focus | `stays-on-first-launch` |
| `#1100.51fb49b2` | AC7: after the click on a fresh account the notification setting is no longer "not asked" | `journey.test.ts` AC7: `not_asked` before, not after; the trace's first request carries no ask | `notifications-asked-at-first-post`, naming the ask fed |
| `#1100.5f1d5581` | AC8: hub's wiki read refused: `deep status` prints the set-up line naming `deep setup --undo`, then the session list | `first-command.test.ts` AC8: a stderr line naming the route, before stdout's first output; stdout only lines a later `deep status` prints | the merge base: setup's exit 4 ends the command, stderr names no undo |
| `#1100.c0eb6fe9` | AC9: a shipped guard entry blocks a session's call, and the set-up line says so | `first-command.test.ts` AC9: the session's `pkill -f vite` is denied; the line names blocking and the count 30 | the base; `set-up-line-says-nothing-blocks`, naming `no-kill-by-name` |
| `#1100.fb98dd92` | AC10: a stack trace in setup's error output, none of it on the screen | `stops.test.ts` AC10: no line of `fixtures/trace.txt` in any text of the page | the base; `set-up-prints-output`, naming the trace's line |
| `#1100.0bc0935d` | AC11: paseo on the PATH: the first `deep status \| cat` holds only the session list | `first-command.test.ts` AC11: every stdout line is one a later `deep status \| cat` prints | the base (paseo's line on stdout); `set-up-line-to-stdout`, naming the line |
| `#1100.ccd14b19` | AC12: a 5 s build step: one line naming it before it ends | `first-command.test.ts` AC12: a scratch checkout, cargo stand-in; one stderr line naming the build, before cargo's end | the base; `silent-steps`, naming `cargo build -p deep-hook` |
| `#1100.ac11c199` | AC13: during a 5 s Set up the button reads Setting up and a second press starts nothing | `busy.test.ts` AC13: a `Setting up` button 0.8 s after the press and after a second press at its place; one setup start in all | the base; `set-up-hides-button`; `set-up-starts-twice` |
| `#1100.da894c8b` | AC14: with a reading job queued, a screen that says nothing leaves this Mac fails, naming the job | `journey.test.ts` AC14: the page lists `setup-step:history:<agent>` and says nothing leaves this Mac nowhere | `first-launch-nothing-leaves`, naming `history:<agent>` |
| `#1100.616f99b5` | AC15: Shown to you, from the real app at the reference window; one taste call, else INCONCLUSIVE | `shown.test.ts`: `first-launch-1512x982-light.png` taken once the tree shows Set up, Claude Code and Codex and no pi; `run.json`; then `TASTE.json` | none: no picture is judged |

## Disputes and assumptions a redraft may revisit

1. **The screen's list as author ids** (Pinned 1). "The lines come from the one list of steps" can't be seen in words alone,
   so the list is pinned as node ids the record's events must match. Step names are free but one: AC14's reading job is the
   `history` step.
2. **"Installed"** is the agent's binary on the login shell's PATH and its folder in the home; pi is absent by both.
3. **"The record's setup events"** are a new kind, `setup.step@1` (Pinned 3); "name exactly" is set equality of `(step,
   agent)` with the screen's steps, and of agents with its rows.
4. **"No other control that writes"**: buttons, menu items, switches, check boxes, radio buttons, sliders, combo boxes and
   every text input; a link only reads and isn't counted.
5. **"Names that route"**: the take-it-back line names `deep setup --undo`. "A route that doesn't exist": a `deep` command
   whose own help doesn't exit 0 listing its flags, or box words `box.say` doesn't draft. "remove DeepBuild from `<agent>`"
   is tried for each agent row; the base's box drafts it for Codex only, so a line offering it for Claude Code needs the box
   to take it. "Both agents' settings" are `~/.claude/settings.json`, `~/.claude.json`, `~/.codex/hooks.json` and
   `~/.codex/config.toml`.
6. **AC4's check.** A term is a Name of the table (a cell naming two gives two); a name in backticks counts only shown in
   backticks; a match is a whole word or phrase in any case, plural `s`/`es` too. "Beside" is the same text, or the text
   before or after it in the page's reading order; the Means is matched whole, white space and case aside, a trailing
   parenthetical cross-reference optional. The table at the base has no `hook`, so the plant is refused only once it has
   (Pinned 8); a redraft may read "the check" as a lint the implementation adds.
7. **AC5's "one line"** is one distinct text naming the file, with no line break; "exit status" is any `exit status`,
   `exit code`, `exited with` or `status: <n>`. "Pressed again" is a press that starts `deep setup` again.
8. **AC6.** A replica launched with no record has no ask and no project, so the box is the right page; `ask/…` and
   `project/…` are accepted as the criterion says.
9. **AC7 in the replica.** No test can make a fresh macOS account, so the replica stands in for its notification setting
   (Pinned 4). "No longer not asked" is read once the window moved on after the click; the planted app's ask is named from
   the trace.
10. **AC8's "hub whose wiki read is refused"** is a hub whose `~/.deepbuild/wiki` is a folder nobody may write (mode 0500),
    made by the login service stand-in just before it starts the hub, so the wiki build setup asks for fails. On the base the
    hub starts with it and `wiki.build` is refused with EACCES (BASE-FAILURE.txt). "The session list" is what a later `deep
    status` prints; "then" is the set-up line's arrival before stdout's first output.
11. **AC9's "says so"** is the line naming blocking and the shipped count of blocking entries; the entry named is the one
    the denial names, else `no-kill-by-name`, which `pkill -f vite` meets.
12. **AC11's "second tool"** is paseo, which setup reports on at the base (its install line, on stdout). "Only the session
    list" is every stdout line being one a later `deep status | cat` prints, with setup finished by then.
13. **AC12's "fixture build step"** is deep-hook's build, the one step setup runs only from a checkout with nothing built:
    a scratch copy of the checkout (tracked files, each workspace's `dist`, `node_modules` linked) whose `cargo` takes 5 s.
    "Naming the step" is `build` or `compile` with `hook`; "once" is one such line. Its wrong-program test passes at the base
    on purpose, since the base is itself silent; the tagged test is the one that fails there.
14. **AC13's "second press"** lands at the Set up button's place a second after the first, on the wall clock, whatever is
    drawn there; "starts nothing" is one `start setup` in the `deep` stand-in's log once setup ended and 6 s more.
15. **AC14's "reading job queued"** is setup's list holding a history step for an agent with history; "says nothing leaves
    this Mac" is read by three patterns ("nothing … leaves this Mac", "never leaves this Mac", "stays on this Mac").
16. **AC15** takes one picture, light, at the reference window, as the criterion names; a redraft may add dark.
17. **Plants by environment.** As #1348, #1461 and #1998's, through the `env-plants` build feature a release build refuses
    and the hub's closed list; none is a new switch in shipped code.
18. **Not covered by a criterion, so not tested:** the agents' rows in the sidebar after the click (#329); the one line as
    a notice on what opens; macOS asking nothing later; the history line naming your own agent and your plan; the first
    command's line naming each agent changed and the wiki read; a failing step said after the line; rows saying done.

## Files

- `helpers.ts`: IDs and plant names; the fixture machine; runs with timed output; builds; the first command and the
  scratch checkout; the hub's socket; the replica driver; the window's readers; one judge per criterion; the word table.
- `journey.test.ts` (AC1, AC2, AC3, AC4, AC6, AC7, AC14), `plants.test.ts` (their wrong programs), `stops.test.ts` (AC5,
  AC10), `busy.test.ts` (AC13), `first-command.test.ts` (AC8, AC9, AC11, AC12), `shown.test.ts` (AC15).
- `fixtures/launcher.mjs` (#16's login service stand-in, as #1002 copied it), `fixtures/trace.txt` (AC10's stack trace).
- `TASTE.json` (no call yet), `tsconfig.json`, `BASE-FAILURE.txt`.
