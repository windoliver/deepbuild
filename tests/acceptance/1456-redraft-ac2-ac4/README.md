# Acceptance tests for #1456, AC2 and AC4: an old record replays to the base's states, and `992/agree` holds

Written first, blind, from issue #1456 ("A reworded reading changes a session's state: display text is used as logic";
its body as of November 24, 2026, no comments), the design sections it links ("One event log, with tables built from
it", with its subsections, and "States people see", as `node scripts/design-section.mjs --issue 1456` prints them) and
base commit `118ec119f`, by a job that saw no implementation. It writes two of the issue's four criteria:

| | Criterion | ID | Test |
|---|---|---|---|
| AC2 | A record written before this change, replayed, gives the same states as the merge base | `#1456.f70bc414` | `replay.test.ts` |
| AC4 | `992/agree` holds | `#1456.6799dc51` | `agree.test.ts` |

Each ID is `scripts/proof-change.mjs`'s `criterionId`: `#1456.` and the first eight hex digits of the SHA-256 of the
criterion's text, trimmed, white space collapsed, read from the issue body by that script's `readIssue`. Each test's
name starts with its ID, which is how `tagsIn` finds it.

Base code read for the surfaces: `packages/hub/src/{status,rows,list,plant,core,session-state,hub-shared,
stop-judging,hook-programs,mods,server}.ts`, `packages/record/src/{index,projections}.ts`,
`packages/contracts/schemas/session.{reading,attention}@*.json`, and the suites `tests/acceptance/{16,26,1337,1463,992,
2668}` (helpers, twins, READMEs), with `scripts/{proof-change,proof-runs,lanes}.mjs` for tags, twins and lanes. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

## How to run

With the workspaces built (`npm run build --workspaces`) and `target/debug/deep-hook` built (`cargo build --locked -p
deep-hook`), under Node 24:

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1456-redraft-ac2-ac4 replay.test.ts
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1456-redraft-ac2-ac4 agree.test.ts
node node_modules/typescript/bin/tsc --noEmit -p tests/acceptance/1456-redraft-ac2-ac4/tsconfig.json
```

- `replay.test.ts` takes seconds. `agree.test.ts` runs #992's suite, which takes 12 to 20 minutes on the reference Mac
  (twelve replays and the replica's cargo build) and runs on macOS only, as that suite does.
- Every hub here runs in a temp `HOME` under `/tmp/dh16-*` (#16's `tempDir`; a socket path must fit 104 bytes), with
  the setup marker written so `deep status` runs no first-run setup. Nothing touches the real `~/.deepbuild` or
  `~/.claude`. Processes are stopped by the PID they were started with. No live agent, no network.
- `lane.json` keeps the folder alone, for the reason `binary`: its hubs run `deep-hook` from `target/`, and #992's
  suite builds `deep-drive` with cargo.
- `DEEPBUILD_1456_MAKE_RECORD=1 DEEPBUILD_1456_BASE=<commit>` runs `replay.test.ts`'s second block, which writes
  `fixtures/ledger.db` and `fixtures/base-states.json` from the checkout it runs in. It ran once, at `118ec119f`, and
  must never run again on a later checkout: the fixtures are the merge base's by definition.

## AC2: the record (`fixtures/`)

`fixtures/ledger.db` is a record the merge base's hub and record wrote. `helpers.ts` `makeRecord` made it:

1. A real hub (`deep hub run`) took, for each of eight Claude Code sessions in one repo folder, a SessionStart, a
   prompt and one or two Bash calls (PreToolUse, PostToolUse) over its socket, each session's PID a `sleep` stand-in.
2. Each stand-in was stopped and the hub recorded each session gone (`session.gone`), so the record says so and no
   later reader's state turns on whether some process holds that PID now. Then the hub stopped.
3. With the hub stopped, through the base's record (`openRecord`), the core's own events were appended as the base's
   core appends them: for a session whose turn ended, `session.attention@2 {state: finished}` (as `session-state.ts`
   `attention()` records an interrupted turn's end); then each reading, `session.reading@1 {reading}` (as `core.ts`
   `appendReading` does). No reading carries a code: none could, at the base.
4. The base's own `deep status --json` and `deep status <session> --why --json` read the copy at one hub clock
   (`DEEP_HUB_TEST_CLOCK`, 30 minutes after the last event): `fixtures/base-states.json`, with the base commit.

No Stop hook is sent: at the base every stop is judged and makes a claim, and its `says done` row would sit above the
rows the readings decide. The sessions and what the base read (each reading text is one the base's hub writes, its
variable part filled in):

| Session | Its readings | Base state, by the table's row |
|---|---|---|
| `hooks-cant-run` | `BLOCKED: hooks can't run, …` | stuck, by `hooks` |
| `hooks-run-again` | that, then `Hooks can run again: …` | flagged, by `gone` |
| `monitor` | turn ended, then `Waiting on its monitor …` | working, by `monitor` |
| `monitor-ended` | turn ended, `Waiting on its monitor …`, then `Its monitor … ended: …` | finished, by `finished` |
| `interrupted` | turn ended, then `Interrupt: …` | finished, by `interrupted` |
| `denied-ran-anyway` | `DeepBuild denied … and it ran anyway: …` | flagged, by `gone` |
| `plain-working` | none | flagged, by `gone` |
| `plain-ended` | turn ended, none | finished, by `finished` |

Every reading the base's state reading matches by text (`status.ts`: `LIKE '%watch-only%'`, `'DeepBuild denied % and
it ran anyway%'`, `'Waiting on its monitor%'`, `'Its monitor%'`, `'Interrupt:%'`, and `startsWith` on `CANT_RUN` and
`CAN_RUN`) is there; six of them move a state, a row or a flag, and `denied-ran-anyway` and the two plain sessions
guard against a table that maps too much.

## AC2: what the test asserts, and why

`replay.test.ts` copies `fixtures/ledger.db` into a fresh home, has the record under test replay it (`openRecord`,
then `rebuild()`: every projection rebuilt from the log, as the design's replay does), starts the hub under test on it
at the clock `base-states.json` names, and reads each session's state the way the base read it. Every session must
read what the merge base read; each one that moved is named with both states.

### What "the same states" compares

From the session's `deep status --json` row: `word`, `entry` (its status-map entry), `waits_on`, `unread` and the
flag's `code`. From `deep status <session> --why --json`: `rule`, the state table's row that matched (design: "the
table's row that matched"). The rule is there because two rows can give one word: an interrupted turn and a stopped
one both read finished, and only the row tells them apart. `why` and `since` are not compared: a why can carry the
reading's own text or an age, and the issue is about letting text change.

## AC4: what the test asserts, and why

The criterion names a test, so the test runs it: `tests/acceptance/992/agree.test.ts`, as it stands in the checkout, in a
vitest process of its own (`--root tests/acceptance/992 --no-file-parallelism`), as #1463's AC6 does. It must exit 0
with `1 passed` and nothing failed or skipped; otherwise it fails with the child's exit, its summary and its last 4,000
characters. The issue moves `session.state` to the app as its status entry and drops word matching in `states.rs`, the
two ends #992's suite holds to the same state for twelve recorded sessions.

## Planted programs (`twins.json`, `twins/`)

Both criteria hold at the base by construction, so each test's wrong program is planted. Each twin replaces whole files
(no `lines.json`, whose lines could not be written against a change that doesn't exist yet).

| Criterion | Twin | It plants | What the test does on it |
|---|---|---|---|
| AC2 | `legacy-readings-unread` | `packages/hub/src/status.ts`, the base's whole, whose state reading takes only a reading that carries a code (`json_extract(r.data, '$.code') IS NOT NULL`): the program that reads codes and has no table for readings written before them | fails at its assertion, naming `hooks-cant-run` (flagged by `gone`, base stuck by `hooks`), `monitor` (finished, base working) and `interrupted` (rule `finished`, base `interrupted`) |
| AC2 | `legacy-table-skipped` | `packages/hub/src/plant.ts`, the base's whole, its `Plant` union with `'legacy-table-skipped'` added, and `plantOf`/`activePlant` giving that name whatever `DEEP_HUB_PLANT` says (the list of known names they read is gone) | at the base, nothing reads that name, so it passes (BASE-FAILURE.txt); on the change it must fail, see below |
| AC4 | `app-maps-waiting-to-working` | `packages/hub/src/plant.ts`, the same way (its union as the base has it), giving the base's own plant `waiting-as-working`: the app maps a session that waits on you to Working | #992's suite fails naming the needs-you sessions, so the test fails at its assertion |

### What the implementation must provide

1. **The plant `legacy-table-skipped`.** The issue reads every earlier reading with no code "through one table, kept in
   one place". With `activePlant() === 'legacy-table-skipped'` that table must map no reading, so the record here
   replays as if its readings said nothing (`hooks-cant-run`, `monitor` and `interrupted` move). It is listed in
   `plant.ts`'s `Plant` and `PLANTS` like every plant. This is the twin that can prove AC2 on the change:
   `legacy-readings-unread` lays the base's `status.ts` over the change, which proves the test tells right from wrong
   at the base but may not build over the change once its imports move. A twin that doesn't build leaves its run
   unrunnable; `legacy-table-skipped` still proves the test then.
2. **The plant `waiting-as-working`**, kept as the base has it, read by the app (`crates/deep-app`) under the
   replica's `env-plants` feature, and `@deepbuild/hub`'s `activePlant` export, which #992's suite reads.
3. **`plant.ts` as the base has it**: a twin of it is the base's file with two functions changed, so a new export or
   plant name the change adds to `plant.ts` must go elsewhere, or the twins here go to a blind redraft. (Widening
   `Plant` to `string` instead, as #992's twins do, doesn't build at this base: `core.ts` passes it where
   `ExtensionHostOptions` wants the union.)
4. **`deep status --json`** rows with `session`, `word`, `entry`, `waits_on`, `unread` and `flag.code`, and
   **`deep status <session> --why --json`** with `rule`, as at the base. The record's `openRecord(...).rebuild()` from
   `packages/record/src/index.ts`.

## Disputes and assumptions a redraft may revisit

1. **Readings written by the record, not the hub.** The six readings were appended through the base's record with the
   hub stopped, in the shape the base's core appends them, rather than raised by a live hub (a monitor's watch, a
   broken hook program, an interrupt). The record is still one the base wrote; the hub never validated these events.
2. **No Stop hook.** A turn's end is the core's `session.attention`, so no claim is made. A record with judged stops
   would read says done above every row these readings decide.
3. **Gone processes.** Every session's process is gone in the record, so a session at work reads flagged by `gone`.
   The `hooks` row (stuck) sits above `gone`, so the hooks readings still decide `hooks-cant-run` and `hooks-run-again`.
4. **Which row is "the state".** `rule` from `--why --json` is compared; if the change renames the table's rows, the
   test fails naming them, and the row names need a redraft or an approved mapping.
