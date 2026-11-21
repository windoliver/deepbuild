# Acceptance tests for #1576: reads a phone can afford

Written first, blind, from issue #1576 (its text as of November 20, 2026: the opening, Scope, the six acceptance
criteria, Proof), from `docs/technical-design.md` (Socket roles and contract versions, above all "Reads and writes a slow
link can afford"; Scale later; States people see; and How we know version 0 works: Dogfooding, Criteria to tests, Wrong
programs), from `AGENTS.md`, and from the base commit `3f02bf52b` (main): the hub's reads (`hub-control.ts`'s
`inbox.read`, `sessions.read`, `events.read`, `rows.read`; `human-answers.ts`'s inbox; `session-state.ts`'s session rows;
`log-reads.ts`; `server.ts`; `inbox.ts`, which is `deep inbox`; `plant.ts`), the record and asks core, the app's reader
(`crates/deep-app/src/record.rs`), `benchmarks/budgets.json` and `scripts/benchmark.mjs`'s count ceilings,
`scripts/proof-change.mjs` and `scripts/proof-runs.mjs`, and the suites of #1575, #1577, #34, #24 and #16, whose
helpers these reuse. Nothing of #1576 is implemented at the base, and no implementation of it was read. Never edit
these files; a dispute goes to this job's blind redraft (design: Dogfooding).

## Run

```sh
npm ci && npm run build --workspaces                  # the hub runs from the built CLI: deep hub run
scripts/lease cargo build --locked -q -p deep-hook    # the hub won't start without target/debug/deep-hook
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1576 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1576/tsconfig.json
```

- `--no-file-parallelism`: every test starts real hubs, and AC5 loads every core.
- Every hub runs under `HOME=/tmp/dh16-*/h` (#16's folders), so its root is `<home>/.deepbuild`, with
  `DEEP_HUB_TEST_CONFIRM` set to #34's stand-in, which says no: no test touches the real `~/.deepbuild` or raises an OS
  prompt. Each test stops the hubs it started by PID; AC5's busy processes are stopped by PID too.
- Each record is seeded once per file, then opened once by a hub of its own (`deep hub run --root` on the record's
  folder, HOME a temp home too), which records its first state of every session and the list's rows and stops; each
  test's hub starts on a copy of that ledger. The 100,000-session record
  takes minutes to seed and to open on a loaded machine; nothing here is timed.
- With `--root` here, Vitest writes `tests/acceptance/1576/node_modules/.vite/`; leave it out of a commit.

## The surface (my choice)

The issue and the design name `inbox.read`, `sessions.read`, a session's page, `deep inbox` and the budgets in
`benchmarks/budgets.json`; not a cold open's calls, a page's params or fields, how queries are counted, where the new
ceilings sit or what a turn's frames are. Where they leave a name open, this suite takes the smallest shape that fits
the base's wire. Each name is in one place in `helpers.ts` (the block "The surface #1576 leaves open"), so another choice
is a one-line change there. The implementation must serve exactly this:

```ts
// The base's, unchanged: one JSON object per line with "v": 1; a reply is {v, id, result | error}; each read's result
// carries `start` and the `log_pos` it reflects.

'inbox.read'    {}            => { ..., asks: [every open ask, then the 25 newest settled asks at most],
                                   rest: <settled asks older than this page>, next: <cursor> | null,
                                   queries: <the SQL statements the hub ran to answer this call> }
'inbox.read'    { page: <cursor> } => the next, older settled asks, 25 at most, with their own rest and next
'sessions.read' {}            => { ..., sessions: [every live session, then the 25 newest settled sessions at most],
                                   rest, next, queries }
'sessions.read' { page: <cursor> } => the next, older settled sessions, as inbox.read's pages
```

- **Open and settled.** An open ask is one with no answer, default or close yet (the base's `outcome: 'unanswered'`);
  every other ask is settled. A live session is one whose turn is under way or that waits on you (an open ask of its
  own, a permission prompt); a session whose last turn stopped, or that ended, is settled. Newest is by when it
  settled. The records here hold no case in between: each live session has an open ask and no stop, and each settled
  one a stopped turn and no open ask. Rows keep the base's shapes (`asks[].ask` is the ask's handle,
  `sessions[].id` the session's ID); `offers` and `rows` stay as the base has them.
- **A page.** `rest` is an integer: the settled items older than this page that no page before it held, so following
  `next` from the first page, `rest` falls to 0. `next` is a string the hub reads back as `page` (its form is the hub's),
  or null once `rest` is 0. Each settled item is on exactly one page.
- **A cold open (AC1, AC2).** A new connection presents the app's hello, `{v: 1, hello: 'app', token}`, then calls
  `inbox.read {}` and `sessions.read {}`, each after the last one's reply. Its bytes are every byte the hub sends on that
  connection: its own hello line, the role's answer and the two replies, each line with its newline, counted as UTF-8
  (decoded bytes, never compressed). It is the first connection after the hub has started on a copy of the record and
  settled: two `inbox.read`s on a CLI connection, a second apart, reflect the same `log_pos`.
- **A reconnect (AC4).** The same calls on a second connection, after the cold open's closed. Its queries are the sum of
  `queries` over the two replies. `queries` is an integer the hub keeps: the SQL statements its record ran to answer
  that one call, from its request to its reply, and none run for anything else meanwhile (a hook's append, a state pass
  something else started, a timer); a plant's statements count like any other.
- **A turn (AC3).** `fixtures/turn.jsonl` is the first turn of the recorded agent session
  `adapters/corpus/claude-code/2.1.308/tools`, payloads only: its `SessionStart`, then `UserPromptSubmit`, `PreToolUse`
  and `PostToolUse` of one Bash call, and `Stop`; `fixtures/turn-transcript.jsonl` is that session's transcript through
  the turn. Each payload is sent as deep-hook sends it (hook.request@1, this process's PID), its `cwd` a fresh folder and
  its `transcript_path` the transcript copied under the hub's home, one at a time, the hub settled after each (two
  `status.read`s, which answer behind every hook acknowledged and the state pass, reflect the same `log_pos` a second
  apart). After the `SessionStart`, the session's page subscribes,
  `stream.subscribe {after: <log end>, scope: {kind: 'session', session}}` (#1575's), and waits for its caught-up frame. A turn's frames are every line on that subscription after the caught-up
  frame until the hub has settled after the `Stop`; its bytes are theirs, counted as a cold open's are. A frame's kind
  is its event's `kind`, or else the name of what it carries. At the base this reads 8 frames, 4,147 bytes.
- **The ceilings (AC3, AC4).** `benchmarks/budgets.json` holds a task `phone-reads` (its command the budget report the
  Proof names) whose `limits` hold `report.turnFrames`, `report.turnBytes` and `report.reconnectQueries`, count
  ceilings judged on any machine (#2665). Each holds this suite's own reading, as above: a turn is within its ceiling
  when its frames are at or under `report.turnFrames` and its bytes at or under `report.turnBytes`, and a reconnect
  when its queries are at or under `report.reconnectQueries`. Each ceiling sits just above what is seen, low enough that
  its planted wrong program goes over it, and its reason names that program (the issue's Scope).
- **Wrong programs' settings.** `DEEP_HUB_PLANT=<name>` (below), as the base's other plants are. The wrong programs'
  code stays outside `plant.ts`, keyed on its `Plant` value, as the base's plants are, since a twin replaces that file.

## Criteria to tests

Every test's name carries its criterion's ID, `#1576.<h8>`, the first 8 hex digits of the SHA-256 of the criterion's
text, trimmed and with whitespace collapsed (`scripts/proof-change.mjs`, `criterionId`).

| Criterion | ID | Test | On the base |
| --- | --- | --- | --- |
| AC1 cold-open bytes on 1,000 and on 100,000 sessions differ by under 10%; a planted read of every row fails, naming the method | `#1576.bd04ffbe` | `budgets.test.ts` › AC1, AC1 (wrong program) | fails: `sessions.read` grows with every row |
| AC2 a cold open is under 1 MiB on 100,000 sessions | `#1576.cfed4450` | `budgets.test.ts` › AC2 | fails: tens of MB, `sessions.read` the largest |
| AC3 a turn's frames and bytes on a recorded fixture stay at the ceiling; a planted per-event page hook frame fails, naming the kind | `#1576.054c1375` | `turn.test.ts` › AC3, AC3 (wrong program) | fails: no ceiling recorded |
| AC4 queries per reconnect are counted and held; a planted per-row query fails, naming the method | `#1576.61b3806a` | `budgets.test.ts` › AC4, AC4 (wrong program) | fails: no read counts its queries |
| AC5 two runs of each budget under load give identical numbers | `#1576.f767c108` | `budgets.test.ts` › AC5 | fails: queries per reconnect can't be read |
| AC6 `deep inbox` lists every open ask, and paging finds every settled one | `#1576.84557f89` | `inbox.test.ts` › AC6 | fails: no page; every settled ask on the first read |

Each judge (`helpers.ts`, Judges) tells missing from wrong: a ceiling not recorded, a read that counts no queries or a
read with no page each fails with its own message, and a number over its bound names what made it so. Every
assertion is Vitest's `expect`; a setup that can't run (a hub that won't start, a hook not taken) throws `BLOCKED`.

- **AC1.** The records (`helpers.ts`, `recordOf`) hold 1,000 and 100,000 sessions: 5 live, each started and with an
  open ask that waits a week, and the rest settled, from six hours ago on, each started and its turn stopped
  (`agent.stop`), with an ask answered on the question card in one settled session of every 100 (50 at least), so both
  fill a page of settled asks and of settled sessions. Seeded through the real record and asks core before a hub
  starts. The settled sessions send no `session.end`: at the base the asks core forgets ended sessions in a pass that
  grows with their square (`forgetEnded`), and a hub on 100,000 ended sessions hadn't come up after 15 minutes here,
  where without the ends it starts on 30,000 in about 30 s. That is a finding for a follow-up, not this issue's. The
  two cold opens' bytes may differ by under 10% of the smaller; otherwise the failure names the read whose reply grew
  most: `cold-open bytes on a record of 100000 sessions (…) and on one of 1000 (…) differ by …%, not under 10%:
  sessions.read grew most, from … to … bytes`.
- **AC2.** The cold open on 100,000 sessions under 1,048,576 bytes; otherwise the failure names the largest reply.
- **AC3.** The turn above, on a hub with an empty record, within both ceilings; otherwise `a turn of fixtures/turn.jsonl
  sent the session's page … frames, … bytes, past the ceiling of … frames, … bytes: the most frames were of kind …`, the
  kind with the most frames (then the most bytes).
- **AC4.** The reconnect on the 1,000-session record: every reply carries `queries`, and their sum is within the
  ceiling; otherwise `a reconnect ran … queries, past the ceiling of …: <method> ran … of them`, the method that ran
  the most.
- **AC5.** One busy process per core (`node -e 'for (;;) {}'`, at the lowest priority, so the load is over the core
  count while the hubs' own work goes first and a shared machine's other users lose only idle time) runs beside two
  whole runs, one after the other, each of the cold opens on both records, the reconnect and the turn, every hub fresh
  on a copy of the same records. The two runs' five numbers must be equal; one that can't be read in a run (a reply with no `queries`) is missing, never equal.
  Since every number is a count, AC1, AC2 and AC4 judge the first of these runs rather than take one of their own.
- **AC6.** A record of 90 sessions: 30 live, each with an open ask, and 60 settled, each with an ask answered on the
  card. The real `deep inbox` must exit 0 and print every open ask's handle; then, as the app, `inbox.read {}` and each
  page its `next` names must hold every open ask on the first page, at most 25 settled asks on each, each settled ask
  once over all, and on each page a `rest` equal to the settled asks no page has held yet.

## Wrong programs

The plants are the hub's, selected with `DEEP_HUB_PLANT`; the implementation adds each name to `Plant` and `PLANTS` in
`packages/hub/src/plant.ts` and makes the hub do that wrong thing under it. Each twin under `twins/<name>/` is that
file as base `3f02bf52b` has it, with the three names in `Plant` and `plantOf` and `activePlant` fixed to its own, so
the proof lane runs a criterion's tests on its wrong program (`twins.json`). Each was type-checked laid over the base
hub. A plant name main adds later must join a twin's `Plant` too, or the hub won't type-check with it.

| Value | The wrong program | Its criterion's failure |
| --- | --- | --- |
| `reads-every-row` | `sessions.read` returns every session's row, whatever its params, as the base does | AC1: `… sessions.read grew most …` |
| `page-hook-frame-per-event` | for each event frame a subscriber scoped to a session is sent, the hub sends it one more: an event frame whose event's `kind` is `page.hook` | AC3: `… the most frames were of kind page.hook (…)` |
| `query-per-row` | `inbox.read` runs one more query for each ask its page holds, counted in its `queries` | AC4: `… inbox.read ran … of them` |

The three `(wrong program)` tests start a hub under the plant on the same record and assert that their criterion's
judge fails with the message that names the method or the kind. At the base the hub names no such plant and won't
start, so each fails there at its first assertion (`the planted wrong program … runs`).

## Readings where the issue leaves a choice

- **"The list's read"** is `inbox.read` and `sessions.read`, the two reads the issue's opening says return every ask
  and every row; `rows.read`, which at the base also returns every session's row, is no part of a cold open here.
- **"Differ by under 10%"** is the larger over the smaller, less one, under 0.1.
- **"A cold open"** is the list's reads on a new connection, as a phone that opens the list makes them; the app's own
  subscribe with no scope stays as #1575 left it, so no reply field is asked of it.
- **"A turn's frames"** are the session's page's, since the plant the criterion names is a page's frame, and a phone
  shows the list and the page one at a time.
- **"Queries … counted"** is `queries` on each read's result, so a reconnect's count is its own, whatever else the hub
  runs meanwhile, and the failure can name the method.
- **"Under load"** is a busy process per core beside both runs; the numbers are bytes, frames and queries, never times.
- **"Paging finds every settled one"** pages `inbox.read`, the read `deep inbox` makes; `deep inbox` itself still prints
  the open asks, as the base's does.
- **Not tested**, as no criterion names them: `events.read`'s byte cap, a session's page's window of 1 MiB or 10
  returns, `sessions.read`'s later pages, and what the app reads.

## How far these tests were checked

Type-checked with this tsconfig. Run once on base `3f02bf52b` (`BASE-FAILURE.txt`): all 9 tests fail, each at its
criterion's assertion, for the reason the table above gives; AC5's two runs under load read the same cold-open bytes and
the same turn there, and fail only on the queries the base doesn't count. Before that run, throwaway probes checked the
setup on the base: the records seed and a hub starts on them, a cold open reads the same bytes twice, and the recorded
turn reads 8 frames, 4,147 bytes in each of three runs. Never run against an implementation, because none exists, nor
against the twins: the twins were only type-checked over the base hub.
