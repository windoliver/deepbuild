# #3440 acceptance: the record's write-ahead file has a size limit, and the record's size counts it

Written blind from the issue (#3440 as `gh issue view 3440` printed it on 2026-11-25: its report, Runs on, Scope, four
checkbox criteria and Proof; no comments), the design (One event log, with tables built from it; Numbers version 0 has
to hold; Dogfooding), `AGENTS.md` and the base `4d8baa118` (origin/main). No implementation was seen. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

At the base I read, for their surfaces: `packages/record/src` (`storage.ts`: `settle`, `fileStorage`, `openReadOnly`;
`index.ts`: `openRecord`, `RecordStore`, the append queue and its one commit a turn, `rebuild`, `openRecordReader`;
`meta.ts`), `benchmarks/record.mjs`, `benchmarks/budgets.json`, `scripts/proof-change.mjs` (criterion IDs),
`scripts/budget-window.mjs` and `scripts/benchmark.mjs` (`validateBudgets`; a task's `criteria`), `scripts/proof-runs.mjs`
(`twins.json`), `scripts/lanes-lists.mjs` and `scripts/alone-lint.mjs` (`lane.json`), `scripts/wait-ratchet.mjs`, and the
suites `3430`, `3389`, `3481`, `3220` and `14` for their conventions.

## Run

Node 24, the checkout built (`npm ci && npm run build --workspaces`). No cargo build, hub or port is used.

```sh
npx vitest run tests/acceptance/3440 --no-file-parallelism
```

About 10 s on the base. Every test opens a record in a real file (`openRecord` with no storage named, so the file
storage in WAL mode) in a temp folder of its own, `deep-3440-*` under the OS temp folder, removed after each test with
its files. `wal-limit.test.ts` holds a write-ahead file of about 290 MiB beside a log of the same size, and
`held-read.test.ts` about 130 MiB of each: under 600 MB on disk at once, run one file at a time. The one process the
suite starts (`reader.mjs`) is ended through its stdin, or by its own PID if a test fails first. No test waits on a
time: each waits for an append's commit or for a line the reader prints, and judges only file sizes.

## Requirement, check, proof

| Criterion | Test | Passes when | Wrong program |
|---|---|---|---|
| `#3440.e48b80ad` one commit that writes four times the limit, then one more commit: the write-ahead file is at most the limit | `wal-limit.test.ts` | 33,555 `tool.after` events, each keeping 8,000 characters of its command, are appended in one turn, which the record commits once; the write-ahead file after that commit is at least 4 × 64 MiB (or already within 64 MiB). One more event is appended and awaited: one more commit. The write-ahead file is then at most 67,108,864 bytes | the merge base; twin `wal-limit-default` |
| `#3440.fd63704e` with a second process holding one read open, appends reach twice the limit; within two commits after the read ends the file is at most the limit | `held-read.test.ts`, `reader.mjs` | A second Node process opens the record's file read-only and holds one read open (below). Commits of 256 such events follow until the write-ahead file is at least 2 × 64 MiB. The read ends and its process exits. Two events are appended, each awaited: two commits. The write-ahead file is then at most 67,108,864 bytes | the merge base; twin `wal-limit-on-reader` |
| `#3440.bc903f14` the record's size as the budget reads it equals the two files' bytes together, within one page | `size.test.ts` | After one commit of 200 such events (its pages still in the write-ahead file, a few MiB against a log file of one page), `recordSize(path)` differs from the bytes of `<path>` plus the bytes of `<path>-wal`, as `stat` gives them, by at most the page size the log's header names (4,096) | twin `size-log-file-alone`; the merge base has no reading |
| `#3440.e9dfc29b` budget: `record-append-20k` and `record-replay-100k` within their margins of the merge base, 20 samples a side | `budget.test.ts` | `benchmarks/budgets.json` is valid against the merge base's (`validateBudgets`); each of the two tasks keeps the merge base's `command` and `margin` and names `#3440.e9dfc29b` in its `criteria`; each task's command runs and exits 0 | the merge base (neither task names it) |

Every failure message names both sizes: the write-ahead file's bytes and the limit's; for the third, the reading and
the two files' bytes. `BASE-FAILURE.txt` has each test's failure on the base.

## Surfaces

What exists at the base and is used as it is:

- `openRecord({ path, now })`, `RecordStore.append(connection, event)` and `close()`, from
  `packages/record/src/index.ts`. Appends made in one turn land in one commit (the append queue's flush); one awaited
  append is one commit. The suite sets no `commitEach`.
- `openRecordReader({ path })`: the record's own read-only connection, kept open in `held-read.test.ts` and read once
  after the held read ends, so the connection the second twin sets its limit on is there.
- The files: `<path>` (the log's file) and `<path>-wal` (its write-ahead file), by `stat`.

What the implementer builds, exactly:

- **The limit.** No new surface: the writer's connection of every record `openRecord` opens on a file sets
  `journal_size_limit`, so both tests pass through the surfaces above. The tests take the issue's 64 MiB
  (67,108,864 bytes) as the limit; a larger one fails them.
- **`recordSize`**, exported from the record package's public entry (`packages/record/src/index.ts`,
  `@deepbuild/record`):

  ```ts
  /** The record's size as the 1 GB budget reads it: the bytes of the log's file at `path` and of its write-ahead file together. */
  export function recordSize(path: string): number;
  ```

  It takes a record's path, as `writerGeneration(path)` and `openRecordReader({ path })` do, so the hub, a benchmark and
  a process beside the hub read one number the same way; it is called while the record is open in the same process. The
  test awaits what it returns, so a `Promise<number>` passes too. Whatever holds the record's size to the 1 GB budget
  or shows it reads it through this.
- **The budget's tasks.** `record-append-20k` and `record-replay-100k` in `benchmarks/budgets.json` each gain
  `"criteria": ["#3440.e9dfc29b"]` (beside any they hold by then), with `command` and `margin` unchanged. The scheduled
  budget window then measures both against the merge base, 20 samples a side, and its record proves the criterion
  (`scripts/budget-window.mjs`). No test here takes samples or judges a time: agents never run the window.

## The second process

`reader.mjs` is run as `node tests/acceptance/3440/reader.mjs <path>`. It opens the file with `better-sqlite3`,
read-only, takes the first row of `SELECT log_pos FROM events ORDER BY log_pos` and leaves the rest, so its read
transaction stays open: one read, held, on a connection of its own, as the issue's readers beside the hub hold theirs
while a query runs. It prints `reading <log_pos>` once the read is open; the test starts appending only then. When its
stdin gets a line it ends the statement, closes, prints `ended` and exits 0; the test's two commits come only after that
exit. `RecordReader` has no read that stays open across calls, so the held read isn't made through it.

That the read held the file is itself asserted: commits of about 2 MiB are each checkpointed, so with no read open the
file starts over and never reaches twice the limit. A file that doesn't reach it within four times the limit of
appended text is BLOCKED in the failure's message, not a pass.

## Planted programs

`twins.json` names one twin per criterion, and `twins/README.md` says what each breaks, the file its lines change and
the assertion it fails at. Their `lines.json` are the implementer's to add once the lines they replace exist (the line
form, `tests/acceptance/1832/README.md`). No `plant` option of `RecordOptions` is asked for: the tests run unchanged on
a twin, so the record needs none.

## How the tests were checked

On the base, all four fail at the assertion named (`BASE-FAILURE.txt`). No product file of the repository was edited:
a throwaway copy of `packages/record/src` outside the checkout stood in for a fix and for each plant, and the first
three tests passed on the stand-in fix and failed on each plant at its assertion. The throwaway isn't kept and proves
nothing about the real change.

## Not named by the issue, so assumed

- **"The limit"**: 64 MiB, 67,108,864 bytes, the Scope's starting value. "At most the limit" is `<=` on the
  write-ahead file's bytes as `stat` gives them.
- **"One commit that writes four times the limit"**: one batch of appends whose kept text alone is over 4 × 64 MiB, so
  the pages written are more. The test then asks that the file after that commit is at least four times the limit, as
  SQLite leaves it under `journal_size_limit`, or already within the limit, should the record truncate it sooner;
  anything between is BLOCKED.
- **"Then one more commit"** and **"within two commits"**: awaited appends of one small event each. Checked after the
  last of them; a record that is within the limit sooner passes.
- **"A second process holding one read open"**: above. It reads through SQLite, not the record package, since the
  package's reader holds no read open.
- **"A planted record that sets the limit on a read-only connection"**: the record's `openReadOnly`, which
  `openRecordReader` opens; the test keeps one such connection open and reads through it.
- **"The record's size as the budget reads it"**: `recordSize(path)` above. The base has no reading: `benchmarks/windows/numbers.md`
  says no task measures the record's size, and #14's test sums a folder.
- **"Within one page"**: the absolute difference is at most the log file's page size, read from its header.
- **"Naming both"**: the failure's message holds the reading, the log file's bytes and the write-ahead file's bytes.
- **The budget**: carried as #3220's budget criterion is, by the tasks naming the criterion for the window.

## Not covered here

- The Proof's reading, the write-ahead file's size after `record-replay-100k`'s rebuild on the merge base and after, is
  evidence the implementer takes; it is no criterion and no test asks for it.
- The amendments to `docs/technical-design.md` (Scope) have no criterion.
- `rebuild()`'s own commit isn't driven: the first criterion names a commit, and a batch of appends is one through the
  public surface without a stale projection.
- Linux wasn't run; nothing here is macOS-only.

## Lanes

`lane.json` runs the folder alone (`shared:` the disk and the perf lane's record tasks): two files hold hundreds of MiB
at once and `budget.test.ts` runs both record tasks. Nothing else lists it.

## Files

- `wal-limit.test.ts`, `held-read.test.ts`, `size.test.ts`, `budget.test.ts`: one tagged test each, no subtests.
- `helpers.ts`: the numbers, the record in a file, the filling events, the sizes, the reader's start and end.
- `reader.mjs`: the second process.
- `twins.json`, `twins/README.md`: the planted wrong programs.
- `lane.json`, `tsconfig.json`, `BASE-FAILURE.txt`.

No fixture holds a secret or personal data; every path is a temp folder's.
