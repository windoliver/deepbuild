# Acceptance tests for #572: `deep backup` and `deep restore` through SQLite's online backup, with a restore counted as a power cut

Written first, blind, from issue #572 (its text as of October 28, 2026: Scope, the 5 checkbox criteria, Proof and
Depends on), the issues it depends on (#14, #15, #19, #317, read for scope only), `docs/technical-design.md` (One
event log, with tables built from it; How it installs, the upgrade bullet and Backups; Scale later, a writer
generation; the Threats row "Agents switching off what watches them"; Numbers version 0 has to hold, Hook overhead;
How we know version 0 works), `AGENTS.md`, the acceptance tests of #14, #16, #19, #317, #387 and #331 for their
conventions and surfaces, and `packages/record`, `packages/hub` (`src/vfs.ts`, `src/confirm.ts`, `src/server.ts`,
`src/paths.ts`), `packages/cli`, `packages/evidence` and `crates/deep-hook` as they are at the base commit
`7b39aa0d0c006301ee72a96c3ce9868181205803`, by a job that never saw an implementation of #572. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

The issue has 5 checkbox criteria, AC1 to AC5 in the body's order.

## How to run

On macOS, with the repo's Node (24.22.0) first on `PATH`:

```sh
npm ci                                            # once, if node_modules is missing
npm run generate -w @deepbuild/contracts
npm run build --workspaces                        # the tests run the built CLI, packages/cli/dist/main.js
cargo build -p deep-hook                          # AC3 runs target/debug/deep-hook (the tests build it if missing)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/572 --no-file-parallelism --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/572/tsconfig.json
```

- `--no-file-parallelism`: each file starts real hubs and 30 sessions' worth of hook traffic; AC4's numbers only
  mean something with nothing else running.
- Nothing needs the network. Every test makes its folders under `/tmp/dh572-*` (real paths, short enough for a
  socket path), points `HOME` at `<tmp>/h` for itself and every child (so the installed hub's root is
  `<tmp>/h/.deepbuild`, never your own `~/.deepbuild`), and removes the agent's own `CLAUDE_*`, `DEEP_*` and billing
  variables first. The suite stops only processes it started, by PID.
- AC4's timing test seeds a 1 GB record and runs only on a reference Mac in a fit state (below); it can take most of
  an hour there. Run it alone, in a terminal, not under a 10-minute background job.
- With `--root` here, Vitest may write a cache under `tests/acceptance/572/node_modules/.vite/` or `.vitest/`;
  delete it before committing.

## The surface under test

The issue names `deep backup <folder>`, `deep restore <folder>`, SQLite's online backup on the hub's writer
connection, the `evidence/` and `wiki/` folders, the OS confirming you, deep-hook's floor, and a writer generation
the hub reports on every connection. It names no output, exit code, folder layout or wire field. These tests define
the smallest surface that reaches every criterion, consistent with the surfaces already on main.

### The CLI

- **`deep backup <folder>`**, run by you with the installed hub up (HOME's `~/.deepbuild`). The tests pass a fresh,
  empty folder that exists. Exit 0 once the copy is complete. The folder then holds:
  - `<folder>/ledger.db`: the record, written through SQLite's online backup (never a file copy). The tests read
    `ledger.db` and, if one is there, `ledger.db-wal` beside it, as SQLite would; a finished backup needs no WAL.
  - `<folder>/evidence/…` and `<folder>/wiki/…`: the hub root's `evidence/` and `wiki/` with the same relative paths
    and bytes (#15's layout, `evidence/ab/cdef…`).
- **`deep restore <folder>`**, run by you with the hub stopped (the test stops it with SIGTERM and waits for it to
  exit). It asks the OS to confirm you before it changes anything, and exits 0 once the record, evidence and wiki
  are back with every projection rebuilt. Unconfirmed, it exits non-zero and changes nothing. No output is matched.
- **The OS confirmation** in tests is #24's seam, `DEEP_HUB_TEST_CONFIRM` (`packages/hub/src/confirm.ts`,
  `confirmYou`): the path of a file reading `confirmed` or `cancelled`, or of an executable standing for the prompt,
  run once per ask with the reason as its one argument, exit 0 meaning you confirmed. Since the hub is stopped,
  **`deep restore` asks itself**, through the same seam, in the CLI process; the tests set the variable on every
  process they start (hub and CLI alike). AC3 counts the asks with the executable form.

### What a restore leaves, and when the power cut is judged

- Right after `deep restore` exits (the hub still stopped), every projection the record names (`PROJECTIONS` of
  `@deepbuild/record`) in `<root>/ledger.db` holds exactly the backup's rows. **The restore itself appends nothing**:
  a restored record counts as one after a power cut, so it is the hub's next start that finds no clean stop and
  judges every claim still open INVALID, cause events lost (the record's own recovery, #14). (A backup taken from a
  running hub records the hub as running, so the record put back as it is already reads as an unclean start.)
- The tests read ledgers off disk only on a scratch copy (`ledger.db` and `ledger.db-wal`), with `better-sqlite3`,
  never through the hub's files in place.

### The generation

- The record keeps a writer generation, an integer. **The hub reports it as `generation`, a JSON integer, in the
  hello line it sends first on every connection** (`{"v":1,"hello":"deep-hub","start":…,"features":[…],
  "generation":6}`), before the client says anything, so a client can refuse a hub left behind before it writes.
  The tests also accept it in the hub's first reply instead (the `{"role":…}` line for app and cli, the `ack` for a
  hook request), and where both carry one they must agree. "Every connection, to deep-hook, the app and the CLI" is
  read as: a hook connection (a hook.request@1 line as deep-hook sends it, no hello), an `app` hello and a `cli`
  hello with the control token, each on a new connection, all reporting the same value.
- A fresh record starts at a generation of at most 3 (the tests need to reach 3 from it); each `deep restore` sets
  it to one more than the larger of the backup's generation and the replaced record's. The backup carries the
  generation of the record it was taken from.

### The perf lane (AC4)

"Compared with the merge base" is read as #16's AC12 reads it: `benchmarks/budgets.json` has a task for hook replies
during a backup, whose `initialReason` names `#572`, and the file passes `validateBudgets` (`scripts/benchmark.mjs`)
against the merge base's. The task's id and command are the implementer's.

## Criteria to tests

Each test's name starts with its criterion's number, and each `describe` carries the criterion's ID,
`#572.<first 8 hex of the SHA-256 of its text>` (trimmed, whitespace collapsed, `- [ ] ` dropped). A test headed
`(wrong program)` runs the criterion's check against the wrong program the criterion names and expects it to fail,
naming what the criterion says.

| ID | Criterion (short) | Tests | At this base |
|---|---|---|---|
| AC1 `#572.f4b300d0` | backup under 30 appending sessions passes integrity_check and holds every committed event; a mid-commit file copy fails, naming the commit | `backup.test.ts` AC1 (2) | the backup fails: no `deep backup`; the wrong program's test passes (a negative control) |
| AC2 `#572.98ee1d86` | restore of that copy: projections equal the backup's; each claim open at the copy INVALID, events lost | `backup.test.ts` AC2 (1) | fails: AC1's backup never exits 0 |
| AC3 `#572.5cfb15dd` | an agent's restore denied, directly and via `sh -c`, hub up and down, naming the command; yours changes nothing until the OS confirms you | `authority.test.ts` AC3 (3) | the two denial tests pass (#317's `no-deep-restore` entry is already on main); yours fails: no `deep backup`, no `deep restore` |
| AC4 `#572.3213724a` | during a backup of a 1 GB record, hook replies within the hook overhead budget; reference Mac; vs the merge base | `budgets.test.ts` AC4 (2) | fail: no #572 task in budgets.json; no `deep backup` (the timing test fails at its probe before seeding) |
| AC5 `#572.b961a7af` | backup at generation 3 restored onto 5 → 6 on every connection; 3 or 5 fails | `generation.test.ts` AC5 (1) | fails: the hub reports no generation |

### AC1

- **`backup under the load of 30 appending sessions`**: the record is seeded (below), the hub starts, an image is
  pasted through the app connection (`evidence.paste`) and a wiki page written under `<root>/wiki/`, then
  **30 scripted sessions** append: each a Claude Code session sending hook.request@1 lines to the hub's socket as
  deep-hook does (SessionStart, then PreToolUse and PostToolUse in turn, 100 ms apart), all at once. After 300
  acknowledged requests, every event `events.read` serves is taken as **committed before the backup began**, and
  `deep backup <folder>` starts at once while the sessions keep appending. It asserts: exit 0; every request was
  acknowledged and some were acknowledged while the backup ran; `PRAGMA integrity_check` on the copy's `ledger.db`
  says `ok`; the copy holds **every event committed before the backup began** (by ID, each missing one named); the
  copy's `evidence/` and `wiki/` hold the root's files as they were, byte for byte.
- **`(wrong program)`**: a hub under the test VFS (`DEEP_HUB_TEST_VFS`: `points` file, `syncDelayMs: 2000`,
  `cutAfter` set far beyond reach so every FULL commit is written to `ledger.db` and none is cut). Three sessions
  append, the committed events are read, then one verdict is committed with `synchronous=FULL` (`test.load`,
  `verdicts: 1`) and held at its sync; 600 ms in, **`ledger.db` is copied as a plain file** (with any
  `ledger.db-wal`), as a backup by file copy would. The same check runs on that copy, with the commit that was
  landing (its point number, mode and `verdict.made` ID from the points file) as a group the copy must hold. It must
  fail, and the failure must **name the commit** (the verdict's event ID). This is the issue's staged mid-commit copy:
  a negative control, so it passes on the base too.

### AC2

- **The seed**: before the hub's first start, `<root>/ledger.db` is seeded through `@deepbuild/record` (as #16's and
  #19's suites seed it): three sessions started (`session.start`, hook writer) and still running, each with a
  `claim.made` (app writer, the contracts' fixture) left open, and a fourth session whose claim has a PASS
  `verdict.made`. The record is closed cleanly, so the hub's start is clean and the claims stay open; the test checks
  they are open in the backup's `claims` projection.
- **The run**, on AC1's backup ("that copy"): the replaced record moves on (three more sessions append 30 more
  requests; the wiki page is edited), the hub stops, and `deep restore <folder>` runs with the OS confirming you. It
  asserts, before the hub starts again: **every projection equals the backup's** (each `PROJECTIONS` table, all rows
  compared as stored, each difference named by table and row); the record holds every event of the backup and none
  the replaced record added after it; the evidence files are back and the wiki page is the backup's. Then the hub
  starts, and **each claim open at the copy has a `verdict.made` whose outcome is INVALID and whose reasons say
  `events lost`**; one left open fails, naming the claim. The settled claim keeps its one PASS verdict.

### AC3

- **The agent** (two tests, the hub stopped and up): `<root>/rules.json` is the core's shipped defaults
  (`crates/deep-hook/default-rules.json`, verbatim); deep-hook runs as Claude Code's PreToolUse entry runs it
  (`deep-hook claude-code PreToolUse`, the hook JSON on stdin) for a Bash call of `deep restore
  ~/backups/deep-2026-10-28` and of `sh -c 'deep restore ~/backups/deep-2026-10-28'`. Each must be denied (exit 2 or a
  deny decision) and the denial must **name `deep restore ~/backups/deep-2026-10-28` for you to run** (compared with
  `~/` read as the home, quotes dropped, whitespace collapsed, as #317's suite compares it).
- **Yours**: a hub with a record, an image and a wiki page; `deep backup`; the record moves on; the hub stops. Then
  `deep restore <folder>` three times: with the prompt standing in as a program that logs the ask and cancels — it
  must have **asked the OS once**, not exit 0, and **change nothing** (the record's event IDs, every projection, the
  evidence files and the wiki files, compared before and after); with the stub file reading `cancelled` — not exit 0
  and nothing changed; with the prompt confirming — exit 0, the OS asked again, the backup's events and wiki back and
  the newer events gone.

### AC4

- **The perf lane**: as above.
- **The number**: on a reference Mac (Mac15,7 M3 Pro 36 GB or Mac15,12 M3 16 GB) on mains power, Low Power Mode
  off, no thermal warning (#14's gate, `environmentProblem()`); anywhere else the test is skipped with
  `INCONCLUSIVE (reading only): <why>`, never passed. A small `deep backup` runs first, so a missing command fails at
  once. The record is then grown past **1 GB** (`ledger.db` plus its WAL) through `@deepbuild/record` with the hub
  stopped (one session's `tool.before`/`tool.after` shell calls of about 7 KB each), the release deep-hook is built,
  the hub starts, and one hook call is timed alternately with a native no-op floor (`/usr/bin/true`): deep-hook's
  PreToolUse for `ls` in a session, which must be allowed and exit 0. Only calls answered **while a `deep backup` of
  that record runs** count (a new backup starts whenever one ends). Six runs of 200 counted calls; the first is the
  warm-up; each run's number is p95(deep-hook) − p95(floor). Judged by the design's rule against the **hook overhead
  budget, 10 ms**: PASS when every run is within it, FAIL when every run is over it by more than the margin, otherwise
  INCONCLUSIVE. No timed call may have failed open into the spool.

### AC5

- From a fresh record, the generation is read on a hook, an app and a cli connection. **Restores of the record's own
  backups** (backup, stop, restore with the OS confirming you, start) raise it by one each, up to **3**; a backup is
  taken there; **restores of that backup** onto the record raise it to **5** (each step: one more than the larger of
  the backup's and the replaced record's); then the generation-3 backup is restored onto the generation-5 record and
  every connection must report **6**. Each step names why a wrong value fails: reporting the backup's generation
  (3 at the end) means the restore kept the backup's, reporting the replaced record's (5 at the end) means it kept
  that one; either way a client that has seen the newer generation couldn't refuse a hub left behind. A fresh record
  above 3 fails, naming it.

## Wrong programs

| Wrong program | Criterion | How the test fails on it |
|---|---|---|
| A backup that copies `ledger.db` as a file while a commit lands (staged by the test VFS) | AC1 | the check fails, naming the landing commit's `verdict.made` ID (the `(wrong program)` test asserts exactly that) |
| A restore that leaves the claims open at the copy open | AC2 | `claim <id>, open at the copy, is still open after the restore …` |
| A restore that keeps the replaced record's projections or events | AC2 | the first differing projection row, or the events the replaced record added, named |
| A `deep restore` that takes effect without the OS confirming you | AC3 | the state comparison fails, or the stub was never asked |
| A restore that keeps the backup's generation / the replaced record's | AC5 | `… the restore kept the backup's generation …` / `… kept the replaced record's generation …` |

## Proof

The issue's Proof asks for three things, each shown failing first: a backup under load that passes the integrity
check (AC1's first test: fails at the base, no `deep backup`), a file copy staged mid-commit that fails it (AC1's
wrong-program test: the check fails on the copy, naming the commit, on the base and after), and a restore that marks
open claims INVALID (AC2: fails at the base). `BASE-FAILURE.txt` is the run on the base commit.

## Files

- `helpers.ts`: temp homes, the OS confirmation's stub, the hub as a process and its line protocol, the 30 scripted
  sessions, the record's seed, `deep backup` / `deep restore`, the copy's checks, projections read off a ledger,
  deep-hook as an agent's hook entry runs it, the generation on each connection, the reference-Mac gate and the
  timing judge.
- `backup.test.ts` (AC1, AC2), `authority.test.ts` (AC3), `budgets.test.ts` (AC4), `generation.test.ts` (AC5).
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit.
