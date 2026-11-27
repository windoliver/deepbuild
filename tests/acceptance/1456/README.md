# Acceptance tests for #1456: a reworded reading changes no session's state

Written first, blind, from issue #1456 (its body as of November 23, 2026: the problem, Scope, the four acceptance criteria,
Proof), the design sections it links ("One event log, with tables built from it", "States people see") and Dogfooding, and
base commit `118ec119f` (origin/main, "Merge pull request #3321"), by a job that never saw an implementation; none existed.
The base code read for its surfaces: `packages/hub/src/{status,session-state,core,hook-programs,mods,hub-shared,plant}.ts`,
`packages/record/src/{index,projections}.ts`, `packages/contracts/schemas/session.{reading,attention,state}@*.json`,
`packages/contracts/code-words.json`, `crates/deep-app/src/states.rs`, `scripts/{blocking-call-guard,keymap-guard,
proof-change}.mjs`, and the suites `tests/acceptance/{992,1463,2668,965}`. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

At the base a session's state is decided by the words of its readings: `status.ts` reads `session.reading`'s
`data.reading` with `LIKE` and `startsWith` (`'%watch-only%'`, `'Waiting on its monitor%'`, `'Interrupt:%'`,
`'Hooks can run again%'` and the rest), and a reading has no code. So a reworded reading moves its session (AC1 fails,
naming each session), and no guard exists (AC3 fails). AC2 and AC4 hold at the base by construction: they are regression
guards, and each has a planted wrong program (Planted programs).

## How to run

With the workspaces built (`npm run build --workspaces`) and `target/debug/deep-hook` built (`cargo build -p deep-hook`),
under Node 24:

```sh
npx vitest run --root tests/acceptance/1456 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1456/tsconfig.json
```

- `agree.test.ts` (AC4) runs #992's `agree.test.ts` in a vitest process of its own: it takes minutes (twelve replays
  and the replica's build through cargo, macOS only) and writes #992's cache under `tests/acceptance/992/node_modules/.vite/`.
  The other three files take seconds.
- Every test makes its folders under `/tmp/dh1456-*` (a socket path must fit in 104 bytes), sets `HOME` to `<tmp>/h` for
  every process it starts, and never touches the real `~/.deepbuild` or `~/.claude`. `<tmp>/bin` is first on `PATH` with
  #992's stand-ins for `claude`, `launchctl` and `systemctl`. Processes are stopped by PID only (#992's `cleanup`). No
  test runs a live agent or reaches the network.
- With `--root` here, Vitest writes its cache to `tests/acceptance/1456/node_modules/.vite/`; delete it before committing.

## The surface under test

The issue names a session reading's text and its closed code, the states `status.ts` gives, earlier records with no
code, `session.state` crossing to the app, the guard over `status.ts` and `states.rs`, and `992/agree`. It names no field
for the code, no codes, no guard command and no plant. Where it leaves one open, the smallest surface next to an existing
one is pinned below.

### Merged surfaces, used as their suites define them

- **The record** (`@deepbuild/record`, its public entry): `openRecord({path, now})` on `<home>/.deepbuild/ledger.db`,
  `append(connection, event)` with the core's connection (`writer: core`) naming the session, and `RecordError` for an
  event its schemas refuse. Its tables are built from the events (design: One event log).
- **The hub** (#16, #992): `deep hub run` with `HOME` the temporary home, started on that record; its socket's
  `events.read`. #992's helpers (`startHub`, `allEvents`, `cleanup`) are imported as they are.
- **`session.state`** (#992, `packages/hub/src/session-state.ts`): the hub appends one for every session at its first
  start, and again when the one reading gives a session another state or cause. A session's state here is its newest
  `session.state`'s `<state>/<cause>`: `state` is the word every surface names it with, `cause` why (the schema's closed
  sets). Both are compared, since "its turn was interrupted" (`finished/interrupted`) is a reading's state as much as
  `stuck` is.
- **The readings** (`session.reading@1`): `data.reading`, the reading in words. **`session.attention@2`** with the core's
  connection sets a session's status (`working`, `finished`), as the core's own does.

### Defined here

1. **A reading's code.** A reading carries its code as `data.code`, beside `data.reading`, in **`session.reading@2`**:
   `{reading, code}`, both strings, `code` one of the closed set below (contracts take a new version for a changed shape;
   `@1`'s data allows no other field). The record must take `@2` with exactly that data, and must still take `@1`
   (`{reading}` alone, as the base writes it). A reading's state comes from its code; its words change nothing. The codes,
   each the reading family `status.ts` reads by its words at the base:

   | code | the base's words (status.ts matches) | what it gives |
   |---|---|---|
   | `hooks_cant_run` | `BLOCKED: hooks can't run…` (`CANT_RUN`, via `%watch-only%`) | stuck, cause stuck (rule `hooks`), and the row's note |
   | `hooks_run_again` | `Hooks can run again…` (`CAN_RUN`) | takes back each `hooks_cant_run` before it |
   | `watch_only` | any other reading with `watch-only` in it, such as a version its facts don't cover | the row's note |
   | `denied_ran_anyway` | `DeepBuild denied … and it ran anyway…` | the row's note |
   | `mods_watch` | `This session's Claude Code home…` (`MODS_WATCH`) | the row's note |
   | `mods_gone` | `Its Claude Code home loads no mod…` (`MODS_GONE`) | takes back each `mods_watch` before it |
   | `ran_unleased` | `… ran unleased: …` | the row's note |
   | `stop_not_held` | `This stop isn't held…` | the row's note, until a prompt of its own |
   | `monitor_waiting` | `Waiting on its monitor…` | working, cause working (rule `monitor`), until a stop, an end or a `monitor_ended` |
   | `monitor_ended` | `Its monitor…` | ends a `monitor_waiting` |
   | `interrupted` | `Interrupt:…` | finished, cause interrupted (rule `interrupted`), until a prompt |

   The codes are the fixture's; an implementation may have more for readings no state reads (the older and current set
   readings, say), but these must read as the table says.
2. **Earlier records.** A record written before this change holds `session.reading@1` with the base's words and no code.
   Replayed (a hub started on it), each session reads the state the merge base gives it.
3. **The guard**: `node scripts/display-text-guard.mjs [--root <checkout>]`, after the repo's guards
   (`blocking-call-guard.mjs`, `keymap-guard.mjs`). It reads `packages/hub/src/status.ts` and
   `crates/deep-app/src/states.rs` under the root (this checkout without `--root`) and prints one
   `FAIL display text: <path>:<line>:<rest>` line per comparison against display text, `<path>` as above and `<line>` the
   1-based line, or one `PASS display text` line; exit 1 on a finding, 0 on none. It finds at least:
   - in `status.ts`, a line holding `$.reading` and a SQL `LIKE` (any case);
   - in `states.rs`, an `==` or `!=` one of whose sides is a call of `shown(…)`, `copy::text(…)`, `copy::fill(…)` or
     `copy::english(…)`: a comparison against words in the language shown.
   It may find more. This checkout's two files pass it, so the one table that reads earlier records' words (scope item 2)
   lives outside them.
4. **Planted programs**, each a name `DEEP_HUB_PLANT` selects, added to `Plant` and `PLANTS` in
   `packages/hub/src/plant.ts` and to nothing else in that file (the twins replace it whole):
   - `legacy-readings-unread` (new): the hub's and the CLI's reading of states takes a reading with no code as no
     reading, so a record written before this change loses the states its readings gave (AC2's wrong program).
   - `waiting-as-working` (#992's, already there): the app maps a session waiting on you to Working (AC4's).

### The fixture (`fixtures/sessions.json`)

Ten sessions, each its steps in order a minute apart, the newest a minute before the test: a core `session.attention`
(`finished`, or `working`), then one to three readings. Every reading has `text` (the base's words, as its writer in
`core.ts`, `hub-shared.ts` or `stop-judging.ts` writes them, with made-up details), `reworded` (the same reading in other
words, none starting the way the base's do, none holding the words `status.ts` matches) and `code`. No session has a
`session.start`, so none has an agent: the hub's hook-program check, which reads `CANT_RUN` by its words for Claude Code
and Codex sessions, never writes a reading of its own into the fixture. `expected` is each session's `<state>/<cause>`,
pinned from the merge base: `legacy.test.ts` run on it reads exactly these (BASE-FAILURE.txt).

| session | readings | expected |
|---|---|---|
| hooks-cant-run | `hooks_cant_run` | stuck/stuck |
| hooks-run-again | `hooks_cant_run`, `hooks_run_again` | finished/finished |
| monitor-waiting | `monitor_waiting` | working/working |
| monitor-ended | `monitor_waiting`, `monitor_ended` | finished/finished |
| interrupted | `interrupted` | finished/interrupted |
| watch-only | `watch_only` | finished/finished |
| denied-ran-anyway | `denied_ran_anyway` (working) | working/working |
| mods-gone | `mods_watch`, `mods_gone` | finished/finished |
| ran-unleased | `ran_unleased` (working) | working/working |
| stop-not-held | `stop_not_held` | finished/finished |

A record is written in one of three forms (`helpers.ts`, `writeRecord`): `legacy`, `@1` with the base's words; `coded`,
`@2` with the base's words and the code; `reworded`, `@2` with the reworded words and the code. A record that refuses
`@2` (the merge base has none) gets each such reading as `@1` with its words alone, and the test counts the refusals, so
on the base AC1 fails for the state that moved, and after the change a refusal still fails it.

## Criteria to tests

| criterion | tests | fails on |
|---|---|---|
| AC1 `#1456.aa4dd611`: every reading reworded, every session's state unchanged; on the merge base it fails, naming the session whose state moved | `reworded.test.ts` (one): the `coded` and `reworded` records, each in a hub of its own; every session of both reads its `expected` state, printed side by side; the record took every reading as `@2` | the merge base: `hooks-cant-run`, `monitor-waiting` and `interrupted` move, each named with its expected and read state |
| AC2 `#1456.f70bc414`: a record written before this change, replayed, gives the merge base's states | `legacy.test.ts` (one): the `legacy` record in a hub; every session reads its `expected` | passes at the base by construction; twin `legacy-readings-unread` |
| AC3 `#1456.86f6be87`: a planted `LIKE` on a reading fails the guard, naming the line | `guard.test.ts` (three): the guard passes a copy of this checkout's two files; with a `LIKE` on `$.reading` appended to `status.ts` it exits 1 with a finding naming that line; with `word == shown("stuck")` appended to `states.rs`, the same | the merge base (no guard; its `status.ts` holds four such lines) |
| AC4 `#1456.6799dc51`: `992/agree` holds | `agree.test.ts` (one): #992's `agree.test.ts`, as it is, passes | passes at the base; twin `waiting-as-working` |

`twins.json` maps AC2 to `legacy-readings-unread` and AC4 to `waiting-as-working`; each twin is
`twins/<name>/packages/hub/src/plant.ts`, the base's `plant.ts` with `Plant` widened to `string` and `plantOf` and
`activePlant` giving that plant, every other export as the base has it.

## What these tests don't cover

- The issue's third scope item, `session.state` reaching the app as the status entry, is proved here only through AC4
  (992/agree) and the guard's `states.rs` finding; no test reads the app's row over the fixture.
- Readings no state reads at the base (the older and current set readings, `Codex …:` loop readings, hand-backs) are
  not in the fixture, and the guard is pinned only for the two files the issue names.
