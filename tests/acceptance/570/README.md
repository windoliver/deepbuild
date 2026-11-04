# Acceptance tests for #570: lifecycle tables, moves only through them, and a small world enumerated

These tests were drafted blind from issue #570 (its text on 2026-11-03: Scope, the seven acceptance criteria, Proof
and Depends on), `docs/technical-design.md` (Lifecycles, Event, Ask-task, Claim, Ask, Lease, One event log with
tables built from it, One table for an ask's life, How we know version 0 works: Fault injection, Wrong programs,
Dogfooding), AGENTS.md, `tests/acceptance/569/README.md` (Reading 14, which fixes the table format) and the base
commit `d2623d97`, which has no lifecycle table and no table-driven moves. At the base I also read
`packages/contracts` (schemas, `src/index.ts`, `src/schemas.ts`, its tests), `packages/record` (`src/index.ts`,
`src/projections.ts`), `scripts/proof.mjs` and `scripts/proof-suites.mjs`, `scripts/corpus.mjs`, the corpus layout
under `adapters/corpus/`, `packages/hub/src/plant.ts`, and the house style of `tests/acceptance/1113/`, `311/`, `318/`
and `569/`. The helpers are written here, never imported from another suite. Per AGENTS.md, the implementing agent
doesn't edit these tests. A dispute goes to a blind redraft by this job.

Run them with:

```sh
npm ci                                       # once, if node_modules is missing
npx vitest run --root tests/acceptance/570   # Vitest's defaults; the repo's vitest.config.ts also takes them
npx tsc -p tests/acceptance/570              # type-check the tests against the surface
```

All 29 tests are offline. They run on real components: the table files, `@deepbuild/contracts`' public entry, a real
SQLite `@deepbuild/record` in a temporary folder on a clock the test sets, and `node scripts/lifecycle.mjs` as a
process the test starts (`spawnSync`, so it is waited for and never left running). Nothing we own is mocked. Every
process gets a temporary `HOME`, and `DEEP_HUB_PLANT` and `NODE_TEST_CONTEXT` are unset for it. Each temporary folder
is removed when its file ends. On the base all 29 fail at their assertions, as `BASE-FAILURE.txt` shows.

## The surface (my choice where the issue leaves it open)

The issue names the eight objects, `ask.machine@1`, `lease.machine@1`, the states `held`, `defaulted`, `withdrawn`
and `pending`, the contract test, the enumerator, the fixture corpus and the hub's simulation harness. It names no
file for the six other tables, no code API, no command, no event for a refusal or a withdrawal, and no output. The
implementer follows these choices.

### 1. The tables: `packages/contracts/schemas/<object>.machine@1.json`

- **The eight objects' names** are `ask`, `ask_task`, `lease`, `claim`, `attempt`, `waiver`, `open_item` and
  `session_binding`, so the files are `ask.machine@1.json`, `ask_task.machine@1.json` and so on.
- **The format is #569's** (Reading 14): `{ "id": "<object>.machine@1", "states": [...], "initial": "<state>",
  "final": [...], "moves": [{ "from", "event", "guard"?, "to" }] }`. The ID equals the file name without `.json`.
  States are unique, at least two. `initial` and every `final` are states. There's at least one final state and
  one move. Every move's `from` and `to` are states, its `event` is an event kind, and a `guard`, when present, is a
  non-empty name. Every final state other than `initial` is entered by some move.
- **One addition: `conflicts`** (optional, top level): `[{ "name": "<conflict>", "events": ["<kind>", "<kind>"] }]`.
  It names a pair of events whose two arrival orders may end an object in different states. That's what the issue
  means by "a named conflict".
- **What the criteria fix in the real tables:**
  - `ask.machine@1` has the states `defaulted` and `answered`. A move on `ask.defaulted` reaches `defaulted` (the
    deadline is the `ask.defaulted` event), and a move on `ask.answered` from a state other than `defaulted`
    reaches `answered`. No row moves `defaulted` on `ask.answered`. Exactly one `conflicts` entry names
    `ask.answered` and `ask.defaulted` together. The design's "the first to append decides" makes their orders end
    apart.
  - `lease.machine@1` has the state `held`, a move into it, and a guarded move out of it (its holder has ended).
  - `claim.machine@1` starts at `pending` and has a move out of `pending`.
  - `ask_task.machine@1` has `withdrawn` among its final states. Every move into `withdrawn` is on `task.withdrawn`
    and has a guard.

### 2. The contract test's check: `@deepbuild/contracts` (`packages/contracts/src/index.ts`)

```ts
export interface MachineMove { from: string; event: string; guard?: string; to: string }
export interface Machine { id: string; states: string[]; initial: string; final: string[]; moves: MachineMove[];
  conflicts?: { name: string; events: [string, string] }[] }
/** The record objects with a lifecycle: at least the eight above, by those names. */
export const LIFECYCLE_OBJECTS: readonly string[];
/** Every lifecycle table in packages/contracts/schemas (each *.machine@<n>.json), parsed as its file holds it. */
export function machines(): Machine[];
/** One problem string per object that has no table among `tables`, each naming the object; [] when every one has one. */
export function lifecycleGaps(objects: readonly string[], tables: readonly Machine[]): string[];
```

"A record object with a lifecycle" is declared by being named in `LIFECYCLE_OBJECTS`, as hub slots are named in
`hub-slots.json`. An object has a table when a `Machine`'s `id` is `<object>.machine@<n>`. The package's own contract
test should call `lifecycleGaps(LIFECYCLE_OBJECTS, machines())` and expect `[]`. The tests call it with a planted
object, as #311's tests call `frozenDrift` with a planted digest. Whether `listSchemas()` lists the tables is left
to the implementer: no test reads it.

### 3. The hub's moves: `@deepbuild/record`

The hub moves an object by appending an event to its record, and the record's projections make the move. So the
moves are tested on a real record: `openRecord({ path, now })`, `append(connection, event)`, `read`, `table`,
`rebuild` and `close`, as at the base.

- **A move no table row allows** leaves the object's projection row as it was. It also appends a `move.refused` event,
  written by `core`, whose data names the object (its ID, as in `ask:<id>`), the state it was in, the event's kind
  and its ID, and the table, for example `{ "object": "ask:01K…", "table": "ask.machine@1", "state": "defaulted",
  "event": "ask.answered", "event_id": "01K…" }`. The tests read only that the event's data, as JSON text, holds the
  ask's ID, `"defaulted"` and `ask.answered`, and that exactly one `move.refused` does so. `append` may resolve or
  throw for the refused event. Either way the row is unchanged and the refusal is in the log. It still stands after
  `rebuild()`, and after the record is opened again.
- **The asks row** keeps the base's `status` column: `defaulted` and `answered` as now.
- **Withdrawal** is a new event kind, `task.withdrawn@1`: `{ v: 1, kind: "task.withdrawn", subject: "<task_ref>",
  data: {} }`. Its schema accepts `data: {}`, and it accepts the writers `app`, `cli`, `core`, `hook` and
  `mcp:<session>`, so that the table refuses a withdrawal, not the schema. Your trusted path is the writer `app` (the
  task's row or card) or `cli`. Through either, the `tasks` row's `state` becomes `withdrawn`. A withdrawal written
  by anyone else (`mcp:<session>`, `hook`, or `core` acting on an agent's message) leaves the row's state as it was
  (`queued` at the base). It is refused naming the task (its ID) and the event (`task.withdrawn` or the event's ID),
  either in the message `append` throws or in a `move.refused` event's data. The test accepts both.

### 4. The enumerator: `node scripts/lifecycle.mjs world [--tables <dir>]`

- **It runs from this checkout and reads the tables** from `<dir>` (every `*.machine@<n>.json` in it). With no
  `--tables`, it reads `packages/contracts/schemas/`. The event kinds the log can hold are this checkout's published
  schemas: every `packages/contracts/schemas/<kind>@<n>.json` that isn't a table.
- **The small world** is the issue's: two sessions, two asks, one lease, two devices, one hub restart, one clock step
  back and one deadline. It holds at least one object of each table, so each of the eight tables is walked. It fires
  every move whose `from` is the object's state and whose guard holds, whatever its event's name. Guards are names
  the implementer's world knows, and the planted tables below keep the real tables' guards. A move whose event kind
  isn't published is applied in memory only: the log never holds it.
- **What it checks:** each object reaches a final state; two events delivered in either order end in the same state,
  or the table's `conflicts` names their pair; and a crash at each reachable state, replayed from the log alone,
  recovers every object to its state before the crash.
- **Output, one line each**, as #569's lane prints them:
  - A count of the states reached, on a line holding `<n> states reached`, and a count of the crashes replayed, on a
    line holding `<m> crashes` (or `crash`), with `m` at least `n`. Both print whether it passes or fails. For
    example: `lifecycle world: 4312 states reached, 4312 crashes replayed`.
  - `PASS lifecycle world: <table id>: …` for each table that holds, naming its ID.
  - `FAIL lifecycle world: <table id>: …` for each problem. An object short of a final state names its state and the
    path of events that reached it, for example `FAIL lifecycle world: lease.machine@1: lease L1 stays held after
    lease.acquired → session.end; no move reaches a final state`. An order problem names both orders on one line, for
    example `… ask.answered then ask.defaulted ends answered, ask.defaulted then ask.answered ends defaulted, and no
    conflict is named`. A crash problem names the object and the state it recovered as, for example
    `FAIL lifecycle world: claim.machine@1: claim C1 recovers from the log as pending, not checking`.
- It exits 0 when it printed no FAIL, BLOCKED, INVALID or INCONCLUSIVE line, and 1 otherwise. A run takes under 5
  minutes, the tests' timeout.

### 5. The log checker: `node scripts/lifecycle.mjs replay [<log.jsonl> ...]`

- **With no files**, it replays every recorded session of the fixture corpus (each
  `adapters/corpus/<agent>/<version>/<session>/` holding `events.jsonl`, mapped through its adapter as
  `scripts/corpus.mjs replay` does) and each seeded run of the hub's simulation harness. It prints one line per log:
  `PASS lifecycle replay: corpus <agent>/<version>/<session>: <n> moves`, and `PASS lifecycle replay: seed <s>: <n>
  moves` for each seed. The seeds are the implementer's, at least one, and each seeded run moves at least one object.
- **With files**, each file is one log: one event per line, as `@deepbuild/record`'s `toJson` writes an `Event`
  (`v, id, kind, subject?, writer, actor, scope, ts, log_pos, data, evidence, session?`), read in `log_pos` order. An
  ask is `ask:<id of its ask.created>`, and its later events name it by `subject`, as the record does. A log that
  holds is `PASS lifecycle replay: <path>: <n> moves`.
- **A move a table doesn't allow** is `FAIL lifecycle replay: <log>: …`, naming the event (its ID or kind) and the
  table's ID, for example `FAIL lifecycle replay: <path>: event 01K… (ask.answered) moves ask:01K… from defaulted;
  ask.machine@1 allows no such move`.
- It exits as `world` does.

## Criteria to tests

Each test carries its criterion's tag at the start of its name. The tag is `#570.<first 8 hex digits of the SHA-256
of the criterion's "- [ ]" text, trimmed, white space collapsed>`, as `scripts/proof-change.mjs` works it out.

| Criterion | Tests (file) | What they require |
|---|---|---|
| AC1 `#570.97e22112` Each of the eight objects has its table …; a planted record object with a lifecycle and no table fails the contract test, naming it | `tables.test.ts`, 11 | One test per object: its file and its shape (surface 1). The states and moves the criteria name. `LIFECYCLE_OBJECTS` holds the eight, `machines()` reads each table as its file holds it, and `lifecycleGaps` finds nothing. With a planted object `planted_widget` it returns one problem naming it, and with `lease.machine@1` taken away one naming `lease` |
| AC2 `#570.23b51af5` A move no table row allows is refused and recorded …; a hub that sets state directly accepts it and fails this test | `moves.test.ts`, 3 | No row of `ask.machine@1` moves `defaulted` on `ask.answered`. On a real record, an ask is created, then defaulted by the core, then answered by the planted handler (the core's `ask.answered`). The ask stays `defaulted`, after `rebuild()` and after reopening too, and one `move.refused` written by `core` names the ask, `defaulted` and `ask.answered`. An answer to an open ask lands, and nothing is refused |
| AC3 `#570.f58617e9` The enumerator reports how many states it reached; a planted lease table with no move out of held … fails, naming the state and the path | `world.test.ts`, 2 | Over the real tables: exit 0, no problem line, `<n> states reached` with n above the largest table's state count, and a PASS line naming each of the eight table IDs. The planted lease table (the real one with every move out of `held` removed): exit 1, the state count, and a FAIL line naming `lease.machine@1` and `held` and holding the event of a move into `held` |
| AC4 `#570.98951df5` A planted ask table in which an answer and the deadline end in different states by arrival order, with no conflict named, fails the enumerator, naming both orders | `world.test.ts`, 2 | The real ask table names exactly one conflict of `ask.answered` and `ask.defaulted`, and no problem line names `ask.machine@1`. The planted ask table (the real one with `conflicts` removed): exit 1, and one FAIL line naming `ask.machine@1` holds both `ask.answered … ask.defaulted` and `ask.defaulted … ask.answered` |
| AC5 `#570.dfd317ed` A crash at each reachable state … recovers every object to the same state; a planted claim state kept only in memory recovers as pending and fails, naming the claim | `world.test.ts`, 2 | Over the real tables: `<m> crashes` with m ≥ the state count, no problem line, exit 0. The planted claim table (the real one with every move out of `pending` made on `claim.kept_in_memory`, a kind with no published schema): exit 1, and a FAIL line names `claim.machine@1` and `pending` |
| AC6 `#570.2f9f6ed9` Each recorded session in the fixture corpus, and each seeded run of the hub's simulation harness, replays through the lifecycle tables …; a checker that reads only final states passes it and fails this test | `replay.test.ts`, 3 | `replay` with no files: exit 0, no problem line, a PASS line `corpus <ref>: <n> moves` for every recorded session on disk, and at least one `seed <s>: <n> moves` line, each with n > 0. The planted log (created, defaulted, then answered): exit 1, a FAIL line naming `ask.machine@1` and the answer's ID or `ask.answered`. The same log answered before any deadline passes, with a PASS line naming the log |
| AC7 `#570.f596e027` The ask-task table reaches `withdrawn` only from an event your trusted path appended; a planted handler that withdraws a task on an agent's message is refused, naming the task and the event | `withdrawn.test.ts`, 6 | `withdrawn` is final, and every move into it is on `task.withdrawn` with a guard. On a real record, `task.withdrawn` through `app` and through `cli` makes the task `withdrawn`, also after `rebuild()`. Planted handlers write it through `mcp:S1`, through `hook`, and as `core`. Each leaves the task in its open state, also after `rebuild()`, and its refusal names the task and the event. Your withdrawal afterwards still lands |

## Wrong programs

Each criterion's planted wrong program, and where it is:

| Criterion | Planted wrong program | Where |
|---|---|---|
| AC1 | A record object with a lifecycle and no table | In-test: `planted_widget` added to the objects given to `lifecycleGaps`, and the lease table taken from the tables given to it |
| AC2 | A planted handler that moves a defaulted ask to answered; a hub that sets state directly | In-test: the core's `ask.answered` after its `ask.defaulted`. The hub that sets state directly is the merge base, whose `asks` projection writes the event's status whatever the row held. On it the ask ends `answered` and nothing is refused (`BASE-FAILURE.txt`) |
| AC3 | A lease table with no move out of held | In-test: a copy of every real table, with every lease move from `held` removed, given by `--tables` |
| AC4 | An order-dependent ask table with no conflict named | In-test: a copy of the real tables with `ask.machine@1`'s `conflicts` removed |
| AC5 | A claim state kept only in memory | In-test: a copy of the real tables in which `claim.machine@1`'s moves out of `pending` are made on `claim.kept_in_memory`, a kind the log can't hold |
| AC6 | A planted log that moves an ask from defaulted to answered; a checker that reads only final states | The log is written in-test. The checker is the whole-program twin `twins/final-states-only` (`twins.json`, `twins/README.md`), which passes that log |
| AC7 | A handler that withdraws a task on an agent's message | In-test: `task.withdrawn` appended through `mcp:S1`, `hook` and `core` |

## Readings where the issue leaves a choice

- **"In the schemas"** means `packages/contracts/schemas/`, beside the event schemas, as #569 fixed. The degrade
  level's table lands with #379. It isn't one of the eight, and no test reads it.
- **"Fails the contract test, naming it"** is read through the contract test's check, `lifecycleGaps`. The tests
  plant the object in its input, as #311's tests plant a digest in `frozenDrift`'s. Planting a file in the
  package and running its own vitest suite would test the same function, more slowly.
- **"The hub moves an object only through its table"** is tested where the hub's moves land: its record's
  projections. A refusal made earlier, in the asks core or the hub, is welcome, but the record must refuse too. The
  planted handler appends straight to the record, as a handler with a record connection can.
- **"Recorded"** is a `move.refused` event in the log. The design's `answer.refused` is the asks core's own refusal of
  a late answer, with its channel and closing time. A table's refusal is about any object, so it is its own kind.
- **"Your trusted path"** for a withdrawal is the writer `app` or `cli`. #341's Scope says only you withdraw, from the
  task's row or card or by words you confirm once, and either way your confirmation comes through the app. A core
  that withdraws on its own reading of an agent's message is the planted handler, so `core` is refused. #341's
  fuller flow (claims stop being gated, the session is told) is #341's to test.
- **The enumerator is test code over the tables**, with no outside tool. It lives in `scripts/` beside
  `scripts/corpus.mjs` and the proof lanes, as #569 put its final-state check in `scripts/proof-suites.mjs`. The
  tests use its own command, not `scripts/proof.mjs lifecycle`, because they hand it planted tables in a folder.
  #569's tests plant a single lease table in a repository with no event schemas, and expect `proof.mjs lifecycle` to
  pass a sound one. If the implementer wires `world` into that lane, the rule that unpublished kinds are memory-only
  must not fail #569's scene.
- **"Naming the path that reached it"** is read as the line holding the events that moved the lease into `held`. The
  test checks for the event of a move into `held` in the real table, so it holds whatever that event is called.
- **"Naming both orders"** is one FAIL line that lists the answer before the deadline and the deadline before the
  answer.
- **"Recovers as pending … naming the claim"** is a FAIL line naming `claim.machine@1` and `pending`. A wrong program
  that keeps a claim's state only in memory is planted as table data: a move on a kind the log can't hold. The world
  applies it, and the log never sees it.
- **"The hub's simulation harness"** doesn't exist at the base. There is no seeded harness with scripted peers
  (design: Fault injection) under `packages/hub` or `tests/`. The test sees only `replay`'s seed lines and their move
  counts. Which moves of an ask, lease, claim and session binding a seeded run makes is unobservable here.

## What the tests can't see

- **The clock step back, the two devices and the hub restart** of the small world are unobservable from its output.
  A world that leaves them out passes as long as its counts and lines hold. The state count is only required to be
  above the largest table's.
- **Guards** are the implementer's vocabulary. The tests require them only where a criterion implies one (out of
  `held`, into `withdrawn`), and the planted tables keep the real ones.
- **No sample fix was run.** These tests were not run against an implementation. They fail on the base at their
  assertions, and the twin passes the planted log (checked by hand on a scratch copy holding a sample `ask.machine@1`).

## Files

- `helpers.ts`: tags, table reading and planting, the script's runner and output readers, a scratch record, and
  connections.
- `tables.test.ts`: AC1. `moves.test.ts`: AC2. `world.test.ts`: AC3, AC4 and AC5. `replay.test.ts`: AC6.
  `withdrawn.test.ts`: AC7.
- `twins.json` and `twins/`: the whole-program twin for AC6 (`twins/README.md`).
- `tsconfig.json`: the type check, as in `tests/acceptance/318/`.
- `BASE-FAILURE.txt`: the run on the base, with paths redacted.

No fixture holds a secret or personal data. The asks and tasks reuse the published fixtures' data.
