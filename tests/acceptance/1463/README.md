# Acceptance tests for #1463: one row, and the list, `deep`, `deep status` and `deep inbox` read it

Written first and blind, at base commit `0c4a4ec7`, from issue #1463 (updatedAt 2026-11-10T05:46:00Z: its problem, Scope,
twelve acceptance criteria and Proof), the design and the base, before any implementation. The implementing agent does not
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). There is no taste
criterion, so no `TASTE.json`.

## What was read

- Issue #1463; the titles and states of #1459 (closed), #1141 (closed), #1461, #1340, #1810, #1354 (open), #668 and #19 (closed),
  and #1461's lines on `unread`.
- `docs/technical-design.md`: States people see (the table and the row shape), One hub per user, First-party extensions that
  ship on by default, One list and one page, Replica, the deep CLI and DeepBuild app rows, Setup, the reference Macs, Dogfooding
  and "Tests written first".
- At the base: `packages/cli/src/main.ts`, `packages/hub/src/{status,inbox,plant}.ts`, `deep_status` and `ask.undo` in
  `packages/hub/src/core.ts`, `packages/asks/src/index.ts` (`undo`, `inbox`), `packages/record/src/projections.ts`,
  `crates/deep-app/src/{states,views,notify,plain}.rs`, `crates/deep-replica/src/drive/mod.rs` (`launch`, `record_copy`, the
  notifier, `close`'s trace), `crates/deep-replica/Cargo.toml`, `scripts/proof-change.mjs` (criterion IDs),
  `scripts/benchmark.mjs` (`validateBudgets`), `benchmarks/budgets.json`, and the suites `1459`, `1455`, `1172`, `992`, `1359`,
  `667`, `26`, `24`, `16`, `1515`, `1551`.

## How to run

With Node 24.22 first on `PATH`, the workspaces built (`npm ci --ignore-scripts; npm run build --workspaces`), `deep-hook` built
(`cargo build --locked -p deep-hook`), cargo on `PATH`, on macOS:

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1463 --no-file-parallelism
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1463 judges     # the judges alone, anywhere
node node_modules/typescript/bin/tsc -p tests/acceptance/1463/tsconfig.json
```

- **Builds.** The replica's `deep-drive` is built by the helpers once a run with #1172's build environment (`CARGO_INCREMENTAL=0`,
  `CARGO_PROFILE_DEV_DEBUG=0`), with `--features env-plants` and then plain, each copied out of the target folder into
  `$TMPDIR/dh1463-bin-<uid>`, so `target/debug` holds the plain build afterwards. `CARGO_TARGET_DIR` is honored.
- **The time zone.** Every process runs with `TZ=Asia/Kolkata` (UTC+5:30), so neither UTC nor a whole-hour slip reads as a
  clock time in your zone. The worlds that need "16:40 today" ahead of the hub start its clock at noon today in that zone
  (`DEEP_HUB_TEST_CLOCK`); it moves with real time from there.
- **`992/agree`.** `words.test.ts` runs `tests/acceptance/992/agree.test.ts` as it is, in a vitest process of its own; it takes
  minutes (twelve replays and #992's replica build) and writes #992's cache under `tests/acceptance/992/node_modules/.vite/`,
  which git ignores.
- **Folders and processes.** Homes and outputs are under `/tmp` (#16's `tempDir`; a socket path must fit 104 bytes). Nothing
  touches the real `~/.deepbuild`, `~/.claude` or `~/Library/LaunchAgents`; the machine not set up is #1359's world, its login
  service a stand-in. Only what a test started is stopped, by PID. The OS confirmation is #24's stub, `confirmed`.
- **`--root` cache.** Vitest writes `tests/acceptance/1463/node_modules/.vite/`; delete it before committing.
- **Lanes.** `scripts/lanes.mjs` needs `tests/acceptance/1463/` in a macOS lane (the replica draws on macOS only); the
  implementer makes that edit.

## The surface (my choice where the issue names none)

The readers are the real ones: `deep`, `deep status`, `deep inbox` and their `--json` from the built CLI against a real hub in
a temp HOME; the agent's `deep_status` through #26's agent stand-in and its own `deep mcp`; and the app's list as the real
`deep-drive` reads it, launched with `launch.from: "record_copy"` in the same HOME, so it copies that hub's record. The
notifications are the ones that replica posts, from its trace. No reply, label or log line credits a criterion.

### Pinned here: the implementation must provide these

1. **`deep status --json`** prints one JSON object, `{"log_pos": <n>, "rows": [<row>, …]}`, and exits 0 with the hub up: the
   list's rows, in the list's order, built at that `log_pos`.
2. **`deep inbox --json`** prints the same shape with the open asks' rows. An ask's row also holds `default`, its default
   option's label (`"No"`), and `default_at`, the ms number of its deadline.
3. **The row shape.** Each row holds the keys `id`, `address`, `title`, `entry`, `word`, `why`, `waits_on`, `since`, `actions`
   and `unread`; `id` and `word` are non-empty strings and `unread` is `true` or `false`. A row's `id` is the `id` its node
   carries in the app's tree (#1459): `ask:<ULID>` for an ask, `session:<session ID>` for a session at the base.
4. **Every row's `word`** is a word of `states::TABLE` (`crates/deep-app/src/states.rs`, read from its source) and its `entry`
   is that word's status-map entry there.
5. **`deep_drive`'s `see`** answers, beside `snapshot`, `rows` (the list's rows, in the list's order, in the row shape) and
   `log_pos` (the record position they were built at). The window draws each of those rows: the first node, in reading order,
   whose `id` is the row's, holding the row's `title` and `word` in its own or its children's names or string values, in the
   rows' order.
6. **`deep`** with no arguments prints, in the rows' order, a line per row holding its `title` and its `word`; the count sentence
   as the app writes it (`views::asks_need_you`: `1 ask needs you`, `3 asks need you`), with the app's one count; and nothing
   after the list. No help (`Usage:`, `deep <command>` lines) and no `Reading the hub at …`. It exits 0. On a home with no
   `setup-finished.json` and no hub it runs setup first, as the first `deep` command does, then prints the list. `deep --help`
   prints help.
7. **`deep` with the hub stopped** prints the rows it reads from the database, as with the hub up, and a line saying the hub
   `isn't answering` (or `is not answering`) holding a clock time `HH:MM`, in your zone, since when: some minute between the
   hub's last start and now, by the wall clock or by the hub's own. No text reads `0 asks`, `0 sessions`, `0 rows` or `0 tasks`,
   and every count sentence it prints is the one it printed with the hub up.
8. **`deep status`** prints the rows' lines as `deep` does, each with its detail, and its last non-empty line starts with the
   count sentence.
9. **`deep inbox`** prints each open ask's question, then its handle, the handle the last thing on its line; between the two,
   `If you don't answer: <label>, at HH:MM` for an ask that defaults today, as the notification says it. `deep inbox answer
   <handle> <option>` answers as before. `deep inbox undo <handle>` says the ask's new deadline as `HH:MM` in your zone, and no
   ISO or UTC timestamp.
10. **A notification's title** is the first line of the text the replica posts for it (its trace's `notifications[].text`). It
    names its session's project by the repo folder's name (`shop`), and no session's ID in any form: whole, its first 8, its
    letters and digits, or their first 8.
11. **Plants**, each selected by `DEEP_HUB_PLANT`, everything else as shipped:
    - Read by `deep`'s own process (`activePlant()`); the hub runs without it:
      - `status-second-order`: `deep status` (text and `--json`) lists the rows in reverse.
      - `status-own-word`: `deep status` (text and `--json`) names the needs-you state `need you`.
      - `status-unread-flipped`: `deep status --json` gives every row the opposite `unread`.
      - `deep-second-count`: `deep` counts the open asks a second time, itself, and prints a count sentence one too many.
      - `inbox-no-default`: `deep inbox` prints each ask without its `If you don't answer: …`.
    - Read by the hub, added to `Plant` and `PLANTS` in `packages/hub/src/plant.ts`: `status-row-leak`, an agent's `deep_status`
      holding every session's ask rows, others' included.
    - Read by the app through `plain::planted` in the replica built with `--features env-plants`: `notification-title-id`, every
      notification's title holding its session's ID in place of its project.
12. **The perf lane** (`benchmarks/budgets.json`) has a task `deep-list-700`, its `initialReason` naming `#1463`, valid against the
    merge base's budgets (`scripts/benchmark.mjs` `validateBudgets`), whose command exits 0.

### Merged surfaces, used as they are

`deep hub run` with `DEEP_HUB_TEST_CLOCK`, `DEEP_HUB_TEST_CONFIRM` and `DEEP_HUB_PLANT`; the hook protocol (#16's `sendHook`,
`hookRequest`, `newSession`); `events.read`; the record and asks core (`openRecord`, `openAsks`, `raise`, `tick`) through #26's
`seed`; `ask.defaulted` and `default.undone` events; `deep inbox answer` and `deep inbox undo`; #26's `agentWorld`, `callTool` and
agent stand-in; #1359's `world`, `deep` and launcher stand-in; `deep-drive --out <dir>` and its `launch` (`from: record_copy`),
`see`, `wait_for` and `close` with its trace; the replica's `env-plants` feature; `tests/acceptance/992/agree.test.ts`; #1551's
`timingProblem` (Mac15,7, Mac15,12, Mac17,10; mains, Low Power Mode off, thermal nominal, load at most half the cores).

### The fixture

`helpers.ts`, `makeWorld`: each repo a git folder under one temp folder; each session's hooks (SessionStart, a prompt, its calls
as PreToolUse then PostToolUse or PostToolUseFailure, and its Stop) through a real hub from a `sleep` stand-in process; then,
with that hub stopped, each title (`task.created`) and ask raised through the record and asks core ten minutes on, an ask marked
`defaulted` taken by its default (`tick`); `setup-finished.json`; and a real hub again.

`MAIN` (AC1, AC2, AC3, AC4, AC6, AC8, AC10, AC12), on the hub's clock at noon today in Asia/Kolkata: `Cart totals` in `shop` (two
calls, stopped; open asks *Which header colour on the login page?* and *Ship the cart page today?*, Yes or No, defaulting to No at
16:40 today); `Release notes` in `docs` (one open ask); `Search index` in `search` (three calls, one failed, stopped); an untitled
session in `shop` still working; `Docs refresh` in `docs`, whose ask *Keep the cart on SQLite or plain files?* took its default.
Three open asks, so the app's count is 3. `detail.test.ts`: ten finished sessions of 30 calls each, two failed, and two sessions
with an open ask each. `notification.test.ts`: an open ask in each of `shop`, `docs` and `search`, the last session untitled.
`budget.test.ts`: 140 sessions in 7 repos with five open asks each, 700 asks. `scope.test.ts`: #26's world, with an open ask of
the agent's own session and one of another session.

## Criterion to tests

IDs are `criterionId` in `scripts/proof-change.mjs`; `criteria.json` lists them with their text.

| Criterion | ID | Tests | Wrong programs it fails on |
|---|---|---|---|
| AC1 | `#1463.f9ab70a8` | `list.test.ts`: at one `log_pos`, every row in the row shape; the app's rows and `deep status --json`'s equal by id, order, title, entry, word, address, waits_on, since and unread; the window draws see's rows by id in order | the base (no `--json`, no `rows` in `see`); `status-second-order`, naming the row out of place; `status-own-word`, naming each needs-you row; `judges.test.ts` |
| AC2 | `#1463.824c8001` | `deep.test.ts`: `deep` exits 0 with the app's rows in order and the app's one count, then nothing; in #1359's home nobody set up, `deep` writes `setup-finished.json`, exits 0, prints no help | the base (help text, no setup); `deep-second-count`, naming its count sentence |
| AC3 | `#1463.59289fca` | `deep.test.ts`: the hub stopped by PID, `deep` lists the app's rows, says the hub isn't answering with a clock time since when, counts as with the hub up, and no 0 | the base (help text); `judges.test.ts`: no such line, no time, `0 asks need you` |
| AC4 | `#1463.91324b7e` | `inbox.test.ts`: each open ask's question before its handle, the handle last on its line; `deep inbox answer <handle> <option>` exits 0, the record holds one `ask.answered` with that option, and the ask leaves `deep inbox` | the base (handle first), naming each ask; `judges.test.ts` |
| AC5 | `#1463.31fc1678` | `scope.test.ts`: the agent's `deep_status` is bound to its session and holds no form of the other session's ID, its ask's handle or its question | `status-row-leak`, naming the other session; `judges.test.ts` |
| AC6 | `#1463.cc5d1e3f` | `words.test.ts`: #992's `agree.test.ts` passes as it is; no reader's text holds `gone quiet`, `<n> need you` or a multi-word "never call it" of the table; every row's word in `deep status --json`, `deep inbox --json` and the app's list is a table word with its entry; each row's line in `deep` and `deep status` holds it | the base (`2 need you` in `deep status`); `judges.test.ts`: `finished`, a wrong entry, `gone quiet`, `waiting on you` |
| AC7 | `#1463.0c303476` | `budget.test.ts`: the perf lane's `deep-list-700`, valid against the merge base, runs; `deep` on 700 asks lists them with `700 asks need you`, five runs after a warm-up within 100 ms on a fit, quiet reference Mac, else INCONCLUSIVE | the base (no task; `deep` prints help); any run over 100 ms past the spread |
| AC8 | `#1463.8ad45787` | `inbox.test.ts`: the 16:40 ask's line holds `If you don't answer: No, at 16:40` between its question and its handle; its `--json` row holds `default: "No"` and `default_at` the deadline | the base; `inbox-no-default`, naming the ask; `judges.test.ts`: another time, a lower-case id, an ISO date |
| AC9 | `#1463.03f69be1` | `detail.test.ts`: `deep status`'s last line starts with `2 asks need you` and it prints under 40 lines | the base (over 200 lines, ending on a tool call); `judges.test.ts` |
| AC10 | `#1463.dacb7e33` | `inbox.test.ts`: after the defaulted ask's undo, `deep inbox undo` says the `default.undone` deadline as `HH:MM` in Asia/Kolkata, with no ISO or UTC timestamp | the base (`it waits until 2026-…Z`), naming the text |
| AC11 | `#1463.bfbc08f9` | `notification.test.ts`: each open ask's notification title names its repo and no session ID | the base (`DeepBuild · Cart totals`, `DeepBuild · Session 1a2b3c4d`); `notification-title-id`, naming each session |
| AC12 | `#1463.17f151eb` | `list.test.ts`: every app row's `unread` is a boolean, and AC1's comparison covers it | `status-unread-flipped`, naming each row |

Two criterion-tagged tests pass at the base on purpose (`BASE-FAILURE.txt`): AC5's first, since `deep_status` holds no rows at
the base and the criterion guards that it never leaks one (its wrong program is the plant); and AC4's answer, since `deep inbox
answer` works at the base and the criterion says it still must. AC6's `992/agree` half is a regression guard too and is
expected to pass at the base; `BASE-FAILURE.txt` says how it ran.

## Scope the criteria don't cover

No criterion names these, so nothing here tests them: the hub building rows "in one place" (only that every reader agrees);
the record-reader guard naming one reader; `Reading the hub at …` moving into `deep doctor` (#19's redraft); `waits_on` naming
the person (#1340); the chat's status answer (#1810) and the web client (#1354); a finished session's one-line detail (calls,
failures, commits and its `deep read` handle) beyond the line count; `actions`' values; `why`'s wording.

## Disputes and assumptions a redraft may revisit

1. **`992/agree` beside `states::TABLE`.** #992's suite compares `deep status`'s six words (`needs you`, `stuck`, `flagged`,
   `working`, `finished`, `quiet`) with the app's, and needs `flagged` and `finished` covered; `stuck`, `flagged` and `finished`
   are no words of the table at the base. Both halves hold only if the table gains those words (the design's table with them)
   or #992's suite goes to its blind redraft. This suite reads the table from its source, so a word added there counts.
2. **Which fields "the same rows" compares.** `why` can carry an age and `actions` what a device offers, so they aren't compared;
   `since` is a number and is. A redraft may compare all of them.
3. **The drawn list holds each row's word.** The design's row is one line with fixed slots: mark, title, state word, time. An
   ask's row that draws only its question fails `drawnFailures`.
4. **The count sentence** is the app's (`N asks need you`), the one count of open asks, in `deep`, `deep status`'s last line and
   the window; `deep`'s other numbers aren't read as counts. A `deep` that writes the count another way fails.
5. **"Since when"** accepts any minute from the hub's last start to now, by either clock, since the issue doesn't say whether it is
   when the hub stopped or when it last wrote.
6. **The CLI-side plants** run in `deep`'s process only. If the rows come from the hub, the plant still has to change what `deep`
   prints, not what the hub builds, so the app's list stays as shipped.
7. **`deep inbox answer <handle>`** keeps the base's form, `answer <handle> <option>`.
8. **No ID in a notification's title** is read as no form of any fixture session's ID, which is what the base's untitled
   `Session 1a2b3c4d` fails. The project is the repo folder's name, as `deep status` groups by today.
9. **Order at one `log_pos`.** The comparison takes the `deep status --json` read whose `log_pos` equals the replica's copy, read
   just before or just after it; a hub that writes between every read fails it.

## Files

- `helpers.ts`: the IDs, the time zone, the builds, the fixture and `makeWorld`, the readers (`deep`, `--json`, the replica's list
  and notifications, one `log_pos`), `states::TABLE` from its source, and the judges. Reuses `../16/helpers.ts` (hub, hooks,
  sessions, temp folders, PIDs), `../26/helpers.ts` (seeding) and `../1551/helpers.ts` (the reference-Mac gate).
- `list.test.ts` (AC1, AC12), `deep.test.ts` (AC2, AC3), `inbox.test.ts` (AC4, AC8, AC10), `scope.test.ts` (AC5), `words.test.ts`
  (AC6), `budget.test.ts` (AC7), `detail.test.ts` (AC9), `notification.test.ts` (AC11); `judges.test.ts`, no app and no criterion
  tag, passes at the base.
- `criteria.json`, `tsconfig.json`, `BASE-FAILURE.txt`.
