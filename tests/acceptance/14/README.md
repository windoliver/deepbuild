# Acceptance tests for #14: the append-only SQLite event log and its projections

Written first, from issue #14 (its text as of October 20, Scope, Fields, Proof and the "Added Oct 9" section
included), the design sections it links (One event log, with tables built from it; Evidence; Privacy; Hook
protocol; the Event, Ask-task, Definition of done, Claim, Check, Verdict, Ask, Decision, Evidence, Lease and
Budget primitives; and, in How we know version 0 works, Property tests, Fault injection, Hook edge cases,
Criteria to tests both ways, Criteria in a checked shape and Wrong programs, all in `docs/technical-design.md`;
The event catalogue, Projections the canvas reads and Closed enums in `docs/canvas-primitives.md`) and base
commit `f346706`, by a job that never saw an implementation. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

Run them (a root with no config of its own uses Vitest's defaults; the repo's `vitest.config.ts` also takes
`tests/**/*.test.ts` from `scripts/lanes.mjs`, so `npx vitest run tests/acceptance/14` runs them too):

```sh
npm ci                      # once, if node_modules is missing
npx vitest run --root tests/acceptance/14
DEEP_RECORD_FULL=1 npx vitest run --root tests/acceptance/14 budgets   # the million-event replay at full size
```

The tests import `packages/record/src/index.ts`, `packages/contracts/src/index.ts` and
`packages/evidence/src/index.ts` with their `.ts` extension; type-checking them needs
`allowImportingTsExtensions` (with `noEmit`). They type-check under the root `tsconfig.json`'s strict options
against the surface below (checked against a declaration-only copy of it outside the repo).

## The surface under test

The issue names tables, events and behaviors but no code API, so these tests define the smallest one they
need. It is the public entry of a new workspace package, `@deepbuild/record`, at
`packages/record/src/index.ts`. The tests import nothing else from it, and use `@deepbuild/contracts` and
`@deepbuild/evidence` as they exist at the base.

```ts
import type { JsonValue, SchemaEntry } from '@deepbuild/contracts';
import type { EvidenceStore } from '@deepbuild/evidence';

/** Every projection's table name. The issue's are among them (see Projections below). */
export const PROJECTIONS: readonly string[];

/** What the hub's socket proved about a writer's connection (#16 proves it; the record only reads it). */
export interface Connection {
  writer: string;                  // hook | app | cli | core | mcp:<session> | ext:<id>, from the socket
  actor: string;                   // from its credential
  scope: string;                   // from its credential
  session?: string;                // the agent session the hub derived for this connection, if any
  project?: string;                // the project (repo root + remote) the hub derived
  agent?: string;                  // claude-code, codex, deep …
  /** What the hub holds for this run, as @deepbuild/evidence takes it: the env it passes and the values it injected or holds by handle. */
  run?: { env?: Readonly<Record<string, string>>; held?: readonly string[] };
}

/** The payload: an event without what the connection supplies. */
export interface EventInput {
  v: number;
  id: string;                      // the ULID deep-hook minted, or one the caller mints
  kind: string;
  subject?: string;
  ts: number;                      // ms since the epoch
  seq?: string;                    // canonical decimal, as on every wire
  data: JsonValue;
  evidence?: readonly string[];    // sha256 hashes
}
/** An event read back from the log. */
export interface Event {
  v: number; id: string; kind: string; subject?: string;
  writer: string; actor: string; scope: string;   // from the connection, never the payload
  ts: number;
  seq?: bigint;                    // exact; never a JavaScript number
  log_pos: number;                 // assigned at append; only grows, never reused
  data: JsonValue;
  evidence: string[];              // the payload's hashes, plus the hash of each text field's whole scrubbed text
  session?: string; project?: string; agent?: string;   // the connection's
}
/** The record's JSON for one event: seq as its decimal string. */
export function toJson(event: Event): string;

export interface Appended { log_pos: number; existing: boolean }   // existing: this ID was already in the log, identical

export class RecordError extends Error {
  readonly code: 'schema' | 'forged' | 'writer' | 'conflict' | 'storage' | 'closed';
  readonly path?: string;          // JSON Pointer of the refused value: '/actor', '/scope', '/log_pos', '/kind', '/data/…'
  readonly kind?: string;          // the event kind a writer may not append
  readonly id?: string;            // the ID appended again with other content
}

/** A forward-only migration of one kind's data from one schema version to the next. */
export interface Migration { kind: string; from: number; to: number; up(data: JsonValue): JsonValue }

export interface RecordOptions {
  path: string;                    // the SQLite file (a name inside a test storage)
  now: () => number;               // the injected clock, ms since the epoch
  storage?: Storage;               // injected storage; default: the record's own, on the OS file system
  evidence?: EvidenceStore;        // where a text field's whole scrubbed text goes, by hash
  contentFree?: boolean;           // content-free mode
  schemas?: readonly SchemaEntry[];   // event-kind schemas beside the published ones (a kind at a later version)
  migrations?: readonly Migration[];
}
export function openRecord(options: RecordOptions): Promise<RecordStore>;

export interface Row { [column: string]: unknown }
export interface Table { name: string; primaryKey: string[]; rows: Row[] }   // rows in primary-key order, values as stored
export interface TurnView { turn: number | null; stopped: boolean; events: string[] }   // event IDs in the record's order
export interface SessionView { id: string; status: string; readings: string[]; turns: TurnView[] }

export interface RecordStore {
  append(connection: Connection, event: EventInput): Promise<Appended>;   // resolves when the event is committed; rejects with RecordError
  read(query: { after: number; limit?: number }): Promise<Event[]>;       // events with log_pos > after, in log_pos order
  table(name: string): Promise<Table>;
  session(id: string): Promise<SessionView | undefined>;
  rebuild(): Promise<void>;        // drops every projection and replays the log
  raw(sql: string): Promise<unknown[]>;   // one SQL statement on the store's own connection (AC18 only)
  close(): Promise<void>;          // a clean stop
}

/** The storage the record writes through. Opaque to the tests; the record's own is the default. */
export interface Storage { readonly name: string }
export interface SyncCall { file: string; mode: 'full' | 'plain' }   // full: SQLite asked for a full sync (F_FULLFSYNC on macOS)
/** The design's test VFS: keeps each file's writes in memory until that file's sync, and drops the rest at a cut. */
export interface TestStorage extends Storage {
  cutPower(): void;                // every write not yet synced is gone; the record opened on it is dead
  syncs(): SyncCall[];             // every sync so far, in order
  refuseWrites: boolean;           // while true, every write fails with an I/O error
}
export function testStorage(): TestStorage;   // its files live in it, so a reopen on the same object is a restart
```

### What each part means

- **`openRecord`** opens the log at `path` in WAL mode, with STRICT tables, and reads the clock only
  through `now`. A reopen with no `close` since the last open is a start with no clean stop recorded.
- **`append`** validates the payload against its kind's schema (`@deepbuild/contracts`, plus `schemas`), sets
  `writer`, `actor`, `scope`, `session`, `project` and `agent` from the connection, assigns `log_pos`
  inside the commit that writes the event, and resolves when that commit is done. A payload that carries
  `actor`, `scope` or `log_pos` is refused with code `forged`, naming the field, and nothing is appended; a
  payload's `writer` is ignored (Done when: "a forged writer field is ignored"). A payload that fails its
  schema is refused with code `schema`, naming the pointer. A kind only the core appends (`verdict.made`,
  `verdict.stale`, `definition.locked`, `definition.revised`, `decision.created`, `decision.applied`,
  `ask.answered`, `ask.defaulted`) from any connection whose writer isn't `core` is refused with code
  `writer`, naming the kind. The same ID appended again with identical content resolves with
  `existing: true` and the first append's `log_pos`; with other content it is refused with code
  `conflict`, naming the ID.
- **Durability** is decided by kind: those eight core-only kinds commit with `synchronous=FULL`, each in
  its own commit, ahead of any stream events still queued (AC19: "a verdict commits … before the batch
  writes"); every other kind is a stream event, queued and committed in a batch with `synchronous=NORMAL`
  when the record chooses. A send's key is your yes to a send: an `ask.answered`. On macOS a FULL commit
  runs with `fullfsync` on.
- **Text fields** (`data.command` of `tool.before` and `tool.after`, `data.text` of `user.ask`) are scrubbed
  before the event is appended, by pattern and by value, exactly as `@deepbuild/evidence`'s text sink
  scrubs (its `run` is the connection's `run`), then cut at 8,192 characters; when the whole scrubbed text
  is longer than the cut it is stored in `evidence` by hash and that hash joins the event's `evidence`.
- **`read`** pages consumers by `log_pos` only. **`table`** returns a projection as stored, rows in
  primary-key order. **`rebuild`** drops every projection and replays the log in `log_pos` order, migrating
  each event whose kind has a later registered version through `migrations` first.
- **`session`** is the record's reading of one session: `turns` in the order they opened, each with its
  event IDs in the record's order and whether its stop arrived; `readings` holds "clock went back" once a
  prompt or stop of the session was stamped before an earlier stop.
- **`raw`** runs one statement on the store's own connection and rejects when the database refuses it.
- **`testStorage`** is the design's test VFS (Fault injection). `syncs()` reports the mode SQLite asked
  for: `full` when it passed its full-sync flag (what the OS VFS turns into F_FULLFSYNC on macOS), `plain`
  otherwise.

### Projections

`PROJECTIONS` holds at least the issue's: `sessions`, `commits`, `claims`, `checks`, `runs`, `verdicts`,
`asks`, `decisions`, `leases`, `definitions`, `attempts`, `tasks`, `open_items`, `notices`, `readings`,
`plans`, `dry_merges`, `session_files` and `evidence`. Columns are the design's data model; the tests read
these by name:

| Table | Columns the tests read | Primary key the tests use |
|---|---|---|
| `claims` | `id` (the `claim.made` event's ID), `session_id`, `verdict_id` (null while open) | `id` |
| `verdicts` | `id`, `claim_id` (the claim's ID, with or without `claim:`), `outcome`, `reasons` (holds the cause, such as `events lost`) | `id` |
| `asks` | `id` (the `ask.created` event's ID), `status`, `outcome` | `id` |
| `decisions` | `id` | `id` |
| `definitions` | `task_ref`, `hash` | `id` |
| `attempts` | `task_ref`, `attempt`, `session_id` | `task_ref`, `attempt` |
| `leases` | `kind`, `key`, `mode`, `holder`, `expires`, `state` (`held`, `stale`, `released` or `denied`) | `kind`, `key` |
| `evidence` | `hash`, `kind`, `type`, `size`, `origin`, `redaction`, `license`, `step_times` | `hash` |
| `session_files` | `session`, `path` | `session`, `path` |
| `sessions` | `id`, `status` | `id` |

### Events the record must accept that the base doesn't publish

`evidence.stored@1` and `evidence.removed@1` (issue scope, "Evidence in the record"). The tests append
them with `data = {sha256, kind, type, size, origin, redaction, license, derived_from, step_times}` (the
`Evidence` record of `@deepbuild/evidence`, its license by name) and `data = {sha256}`, through a `core`
connection. The catalogue is closed and generated from the published schemas, so the implementer adds
both schemas (with `x-feeds: ["evidence"]`) to `packages/contracts/schemas/` with a fixture each.

### Files the tests read

None of the record's own. The contracts fixtures (`packages/contracts/fixtures/<kind>@1/*.json`) and
schemas come through `fixtures()`, `getSchema()` and `catalogue()` of `@deepbuild/contracts`; the
evidence store's files through `@deepbuild/evidence`'s `read`. AC7 and AC26 scan or size every file under
the temp folder the record was opened in; AC23 and AC26 keep the record and the evidence store in
separate temp folders so evidence is excluded from the record's size.

### Boundaries the tests inject instead of building

Per AGENTS.md (mock only at boundaries you don't own), the tests never build a piece another issue owns.
They hand the record: a clock (`now`), the storage (`testStorage()` where a power cut, a sync trace or a
refusal window is needed; the default otherwise), the evidence store (`@deepbuild/evidence`, real, at a
temp root), what the hub proved about a connection (`Connection`, #16), a spooled request as deep-hook
would replay it (an event with an older ID and `seq`, appended later and again), a first-party
extension as a connection whose writer is `ext:done-gate`, the lease and ask deadline events the hub's
lease manager and ask router append (`lease.stale`, `ask.defaulted`), and an older-version schema plus
its migration (`schemas`, `migrations`).

## Readings where the issue and design leave a choice

- **Turns.** A `user.ask` arriving while no turn of its session is open opens one; one arriving while a
  turn is open belongs to it. `agent.stop` closes the open turn, which takes its `data.turn` as its
  number. A tool event whose `seq` falls inside a stopped turn's span (its opening prompt's `seq` to its
  stop's `seq`) belongs to that turn (the one its call began in); any other event belongs to the turn open
  when it arrives. Within a turn events order by `seq`, ties by ID; an event whose `seq` is before its
  turn's start (AC21) sorts after every event of the turn that arrived before it. Turns are in the order
  they opened, whatever their stamps (AC13).
- **A claim's INVALID with cause "events lost"** is read through the design's tables: the claim's
  `verdict_id` names a `verdicts` row with outcome `INVALID` whose `reasons` hold `events lost`, appended
  by the record as the core (only the core appends `verdict.made`). A claim is open while `verdict_id`
  is null.
- **A session has ended** when a `session.attention` with state `finished` or `failed` names it (the
  design: silence never counts as finished).
- **"The wall clock"** a projection must not read is the record's clock, injected through `now`.
- **A lease's state** comes only from its events (`lease.acquired`, `lease.released`, `lease.stale`,
  `lease.denied`); a lease past `expires` with no `lease.stale` event isn't stale. An ask past its
  deadline with no `ask.defaulted` event isn't defaulted.
- **`log_pos` starts at 1 and is contiguous in a run with no power cut** (AC14 expects the 20th live
  event of a fresh record after 500 others at exactly 520; AC19 expects 801 to 811).
- **The 1 GB record budget** is 1,000,000,000 bytes of the record's files (the database and its WAL),
  evidence excluded. The maintainer's recorded day isn't in the repo, so AC26 replays a synthesized heavy
  day (20 sessions, each 150 short shell calls, 100 reads and edits, 10 heredocs of 220 KB, with its
  prompts and stops) whose whole commands would come to 44 MB a day, 1.32 GB over 30 days.
- **A hook payload's response field** never reaches the record: the catalogue's `tool.after` has no field
  for it, and an event carrying `tool_response` fails its schema (AC1), so no event ever keeps one.
  AC23's scrub assertions are on `data.command`, the field the event keeps.
- **The scaled replay.** AC17's million-event replay runs at 100,000 events against 6 s (factor 10) by
  default, and at 1,000,000 events against 60 s with `DEEP_RECORD_FULL=1`.
- **Working memory** is the growth of the process's resident set across the replay.

## Criteria to tests

Each test's name starts with its ID (the criterion's number in the issue's list, 1 to 28). Where a
criterion names a wrong program, the table says which assertion catches it.

| ID | Criterion (short) | Test | The wrong program, and how it fails |
|---|---|---|---|
| AC1 | an event that fails its schema is rejected | `append.test.ts` | a store that doesn't validate appends the event; the read after shows it |
| AC2 | a payload setting actor or scope is rejected | `append.test.ts` | a store that trusts the payload stores `actor: someone`; the refusal and the read after catch it |
| AC3 | 1,000 seeded streams: every projection equals its rebuild a day later | `property.test.ts` | a projection that reads the clock for a lease's stale state differs after the simulated day, named by table and row |
| AC4 | 5,000 events/s batched in WAL mode | `budgets.test.ts` | a store that commits each event alone falls under 5,000/s |
| AC5 | a second attempt reads the first's locked definition | `turns.test.ts` | a store that drafts a definition per attempt leaves two `definitions` rows for the task |
| AC6 | every projection rebuilds from the catalogue's events | `projections.test.ts` | a projection that isn't rebuilt from the log is empty or differs after `rebuild` |
| AC7 | content-free mode keeps counts, durations and verdicts, no text | `projections.test.ts` | a store that keeps text leaves the prompt or command in its files or events |
| AC8 | no outbound request with no sending extension | `projections.test.ts` | a store that connects anywhere is seen by the patched `net`, `http`, `https`, `dgram` and `fetch` |
| AC9 | FULL rows survive a cut; a claim with dropped stream events reads INVALID | `crash.test.ts` | a store committing a send's key with NORMAL loses the `asks` row; a claim read as open or PASS fails |
| AC10 | 64-bit stamps survive append, read, JSON and replay | `append.test.ts` | a store reading `seq` as a number returns 1760013451123456768n for both |
| AC11 | same seq twice kept in ID order; same ID twice is one; same ID other content refused | `append.test.ts` | a store that drops the tie, appends the duplicate, or overwrites fails the count or order |
| AC12 | a late PostToolUse is recorded in its stopped turn | `turns.test.ts` | a store that reopens or opens a turn, or changes the verdict, differs in `session` or `verdicts` |
| AC13 | clock stepped back 5 s between a stop and the next prompt | `turns.test.ts` | a store that orders turns by stamp puts the new turn first; a store with no reading lacks "clock went back" |
| AC14 | a spooled request after 20 live events lands at 521 and is read after 520 | `log.test.ts` | a store paging by ID or `seq` returns nothing after 520; named by the ask's ID |
| AC15 | positions survive a power cut | `crash.test.ts` | a store taking the next position from the table reuses one; named as the first reused |
| AC16 | a payload with `log_pos: 1` is refused | `append.test.ts` | a store that keeps the payload's `log_pos` appends it; the refusal and the read after catch it |
| AC17 | append p95 < 2 ms; 1M-event replay < 60 s; working memory < 100 MB | `budgets.test.ts` | measured; off a reference Mac the result is INCONCLUSIVE |
| AC18 | UPDATE or DELETE on `events` refused by the database | `append.test.ts` | a store that only lacks an update method lets the raw statement through; the row changes |
| AC19 | ten queued stream events and a FULL verdict take positions in commit order | `log.test.ts` | a hub numbering queued events first gives the verdict 811; named 801 |
| AC20 | lost stream events: A's claim INVALID, B's open; both open after a clean stop | `crash.test.ts` | a hub marking only claims with surviving events after the last FULL commit leaves A's open; named |
| AC21 | an event stamped 2 s before its turn sorts after the two before it | `turns.test.ts` | an order breaking ties by ID puts it first; named by the turn |
| AC22 | v1 and v2 `tool.after` rebuild as the log with v1 migrated first | `projections.test.ts` | a replay validating v1 against v2 fails the rebuild at the first v1 event; one skipping v1 lacks 100 rows, named by count |
| AC23 | scrub-list value and gitleaks key scrubbed before the 8,192 cut; whole text as evidence | `privacy.test.ts` | a hub that scrubs only evidence keeps the value in `data.command`; one that cuts first keeps its first 10 characters |
| AC24 | appends refused for 30 s, then a claim: INVALID, events lost | `crash.test.ts` | a hub that only turns gates watch-only leaves the claim open; named |
| AC25 | FULL commits sync with F_FULLFSYNC, plain fsync for none | `crash.test.ts` | a store at SQLite's default records plain syncs; named by the commit's kind |
| AC26 | a day stores only catalogue fields; a heredoc keeps 8,192 characters plus evidence; ×30 < 1 GB | `privacy.test.ts` | a store keeping the whole command grows past 1 GB; named by the kind |
| AC27 | the eight core-only kinds from `ext:done-gate` refused, from `core` appended | `append.test.ts` | a record checking only the writer's grant appends the extension's verdict; named by kind |
| AC28 | 20 puts, a put again, 5 removals: 21 and 5 events; `evidence` rebuilds to the same 15 rows | `projections.test.ts` | a store keeping records only in its journal leaves the rebuilt projection empty; named by the first hash |

## Criteria 4 and 17: budgets

`budgets.test.ts` holds the issue's limits: 5,000 appends a second or more (20,000 stream events fired
200 at a time, five runs); an awaited stream append under 2 ms at p95 (five runs of 2,000); replaying the
projections of a 100,000-event log (1,000,000 with `DEEP_RECORD_FULL=1`) in under 6 s (60 s), with the
process's resident set growing under 100 MB. Per the design's rule for timing results (the same judge as
`tests/acceptance/15` and `311`), each takes five runs after a warm-up (one run for the replay) and passes
when all are within the limit, fails when all are over it by more than the margin (the larger of 5% and
the runs' spread), and is otherwise INCONCLUSIVE. It counts only on a reference Mac (Mac15,7 or
Mac15,12, on mains power, Low Power Mode off, no thermal warning); anywhere else, and when INCONCLUSIVE,
the test is skipped with that reason, never passed. The 30-day size budget is AC26 (`privacy.test.ts`),
which runs anywhere. The merge-base comparison belongs to the perf lane (`scripts/perf.mjs`,
`benchmarks/budgets.json`): the implementer adds tasks that append and replay in a loop and exit 0, with an
`initialReason` saying the merge base has no record package.

## The oracle lane

The issue's Oracle line points at other projects' tests for 2 of the 28 criteria, in the maintainers'
private oracle repo, run against this output (#136). This job can't read that repo, so that lane is BLOCKED
here with one unblock ask; these tests don't stand in for it.

## Files

- `helpers.ts`: the test clock, ULIDs minted from it, event builders from the contracts fixtures,
  connections, table snapshots and their comparison, temp roots, the reference-Mac gate.
- `BASE-FAILURE.txt`: the run on the base commit, where every suite fails because the package doesn't exist.

No fixture holds a secret or personal data; the ULIDs, hashes and planted secrets are made up.
