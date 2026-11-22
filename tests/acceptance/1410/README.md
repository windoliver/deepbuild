# Acceptance tests for #1410: evidence a FULL commit names is synced, with its folder, before that commit

Written first, blind, from issue #1410 (its text as of November 7, 2026: Scope, the 3 checkbox criteria, Proof and Not
in scope), `docs/technical-design.md` (One event log, with tables built from it; Evidence; Hook protocol; Fault
injection; Dogfooding; the "A broken hub" row), `AGENTS.md`, the acceptance tests of #14, #16 and #572 for their
conventions, and `packages/record` (`openRecord`, `src/storage.ts`), `packages/evidence` (`openEvidenceStore`),
`packages/hub` (`src/vfs.ts`, `src/server.ts`, `src/paths.ts`) and `crates/deep-show/src/evidence.rs` as they are at
the base commit `2bba2a50`, by a job that never saw an implementation of #1410. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

The issue has 3 checkbox criteria, AC1 to AC3 in the body's order, and a scope line with no checkbox that these tests
also hold: writes that no FULL commit names stay as they are.

## How to run

On Linux (or macOS), with the repo's Node (24.22.0) first on `PATH` and a C compiler as `cc`:

```sh
npm ci                                   # once, if node_modules is missing
npm run generate -w @deepbuild/contracts
npm run build --workspaces               # scenario.mjs and the hub run the built packages
cargo build -p deep-hook --locked        # the hub won't start without it
npx vitest run tests/acceptance/1410/record.test.ts tests/acceptance/1410/hook.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/1410/tsconfig.json
```

Name the files (or the folder with its trailing slash): a bare `tests/acceptance/1410` prefix-matches `14100…`.
Each run builds the shim from `shim/syncshim.c` into a temp folder under `/tmp/dh1410-*`, which it removes after. Nothing
needs the network. `hook.test.ts` points `HOME` at a temp home for the hub and every child, so your own
`~/.deepbuild` is never touched, and it stops only the hub it started, by PID.

## Why a syscall shim, and what it proves

The issue names no API for the fix: not whether the record, the evidence store or the hub does the sync, nor how the
store learns which files a commit names. So these tests don't call one. They observe what the fix must do at the one
level every implementation shares: the system calls. `shim/syncshim.c` is preloaded into the process under test
(`LD_PRELOAD` on Linux, `DYLD_INSERT_LIBRARIES` on macOS) and logs, in order, every sync it makes, with the device,
inode and path of the file or folder synced, and, under the evidence folder, every write, rename, `mkdir` and file
create. It changes no call's result. It sees the record's own WAL sync for each FULL commit, which is what "before the
FULL commit" is measured against, and which proves the shim sees the process at all: a test whose shim saw no WAL sync,
or no marker sync, fails `BLOCKED`, never passes.

- A sync counts on Linux as `fsync`, `fdatasync` or `syncfs`, and on macOS only as `fcntl(F_FULLFSYNC)`, since there a
  plain `fsync` leaves the write in the drive's cache (design: One event log). Whether Node's `FileHandle.sync()`
  reaches `F_FULLFSYNC` on macOS is exactly what a Mac run of these tests shows.
- A file is matched by its inode, not its name, so a sync of the temporary file before its rename counts as a sync of
  the evidence file it becomes.
- Linux's libuv could sync through io_uring, which no libc call shows; the tests set `UV_USE_IO_URING=0` for the
  process under test.

### The scenario (`scenario.mjs`, for AC1, AC2 and the scope line)

One Node process, under the shim, composes the stores as the hub's core does: `openEvidenceStore({ root, now })`, and
`openRecord({ path, now, evidence: store, commitEach: true })` on the record's own file storage. It runs:

1. `session.start`, then a `tool.before` (writer `hook`) whose command is longer than the 8,192 characters the record
   keeps of a field: the record stores its whole text as evidence, cited only by that stream (NORMAL) event.
2. A `claim.made`; then two files put through the store, each recorded by an `evidence.stored` event as the core does:
   one the verdict will cite, one no event ever cites.
3. FULL commit 1: a `verdict.made` (writer `core`) with `evidence: [<the cited file>]`.
4. An `agent.stop` ends the session's turn; FULL commit 2: a `user.ask` that resumes it, longer than 8,192 characters,
   so the record stores its whole text as evidence and the FULL commit cites it.
5. The record's clean close.

Each step is marked by syncing an empty file in a markers folder, which the shim logs in order with everything else.
The four contents are chosen so their hashes fall in four different `ab/` folders. The scenario's events are read back
from the record, so the hashes judged are those the FULL commits actually name (the `evidence` column of their events).

### The power-cut model (AC2)

The design's test VFS keeps the ledger in memory until a sync, but the evidence store writes through the file system,
and no harness on main models what a power cut does to those files. A `kill -9` keeps the page cache, so it can't show
the loss. So AC2 turns the shim's log into what a POSIX disk keeps at a cut placed right after the FULL commit's WAL
sync returned (`imageAtCut` in `helpers.ts`), on a copy of the evidence folder:

- a file's bytes are kept only if the file was synced after its last write; else it is left empty;
- a name made by a rename or a create is kept only if its folder was synced after; else the name is removed;
- a folder made by `mkdir` is kept only if the folder holding it was synced after; else it goes, with all it holds;
- what the run did after the cut isn't there; what existed before the run (the evidence root itself) is kept.

The copy is then read through `openEvidenceStore({ root: <copy>, readOnly: true }).read(sha)`, which checks the hash.

### The hub under slow syncs (AC3)

`deep hub run` starts with the shim preloaded and `SYNC_SHIM_SLOW_UNDER` set to the hub's evidence folder, so every sync
of a file or folder there takes 4 s (`SLOW_MS`); no other sync is slowed. A Claude Code session, sent as deep-hook sends
its hooks: `SessionStart`, a short prompt, `Stop`; once its `agent.stop` is in the record, a prompt of over 12,000
characters resumes it. That is the one hook whose own event is a FULL commit naming evidence: the record keeps the
prompt's whole text by hash, and a prompt resuming an ended session commits FULL. Then, for 10 s, the session's tool
calls (`PreToolUse` and `PostToolUse`, 100 ms apart). Each call is timed from its request to the hub's reply line.

The bound is 1 s (`BOUND_MS`): a reply that waited on one slowed sync takes 4 s, or is cut short at the hub's own 2 s
hold on a prompt's context reply (the ack's `hold_until_ms`, `CONTEXT_HOLD_MS` in `packages/hub/src/server.ts`); one
that never waited takes tens of ms here even at a load average of 60 to 90 (41 ms on the base). The test needs the
evidence sync to happen too, and at least one hook call made while it ran, or it shows nothing: no sync seen fails, and
no call during it fails `INCONCLUSIVE`.

## Criteria, tests and what they expect

| Criterion | Test | Expected |
|---|---|---|
| AC1: a sync-recording shim sees each named evidence file and its folder synced before the FULL commit that names it; on main it sees none | `record.test.ts` › AC1 | For each FULL commit (the verdict, the resuming prompt) and each hash its event names: a sync of the file (by inode) after its last write, and a sync of its `ab/` folder after the file was named there, each returning before that commit's WAL sync began. On the base: none of the four is synced. |
| AC2: with the power-cut harness cutting after a FULL commit, every evidence hash that commit names reads back whole | `record.test.ts` › AC2 | With the cut right after each FULL commit's WAL sync, `read(sha)` of every hash it names resolves (whole, hash checked). On the base: each reads `missing` (its fresh `ab/` folder was never synced into the root, nor its name into the folder, nor its bytes). |
| Scope: writes that no FULL commit names stay as they are | `record.test.ts` › Scope | The file no event cites, and the long command's whole text cited only by a stream event, are never synced, nor their folders, up to the record's close. Holds on the base (nothing is synced there); fails on a store that syncs every put. |
| AC3: a hook call's latency doesn't include an evidence sync | `hook.test.ts` › AC3 | With each evidence sync taking 4 s: every hook call's reply within 1 s, the prompt's evidence synced (file or folder), and a hook call made while that sync ran. On the base: no evidence sync is seen at all. |

## Checked against wrong programs

Before handing these over, the job ran them against planted twins of the evidence store (`packages/evidence/dist`
edited in place, then restored byte for byte), never committed:

- A store that syncs every put (temp file, then its folder and the root, all awaited): AC1 and AC2 pass, the scope test
  fails ("the file no event cites … was synced"), and AC3 fails: the resuming prompt's reply took 1.9 s, cut at the
  hub's context hold.
- The same with a blocking `fsyncSync` of the temp file: AC3 fails the same way.

## Not covered here

- macOS is not run by this job: the shim's macOS branch (`__interpose` of `fsync`, `fcntl`, `write`, `pwrite`,
  `writev`, `rename`, `mkdir`, `open`) is written but untested; if it doesn't load there, the tests fail `BLOCKED`
  (no marker or WAL sync seen), never pass.
- `crates/deep-show/src/evidence.rs`'s `put`, which the issue cites, writes the same way. No FULL commit in the record
  names what render-back keeps through it today that these tests could reach without presuming how the fix routes it,
  so it is not exercised here.
- Batching beyond one sync per commit is out of the issue's scope, and no test counts syncs.
