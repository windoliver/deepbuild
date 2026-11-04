# Acceptance tests for #996: hub state files, a damaged run journal or terminals index kept aside and rebuilt, never read as empty

Written first, blind, from issue #996 (its text as of November 2, 2026: the problem paragraph, Scope, the 2 checkbox
criteria, Proof and Depends on), `docs/technical-design.md` (One hub per user, a tiny hook client, and extensions
in-process; One event log, with tables built from it; Starting a session from the app, for what a hosted terminal
holds; How we know version 0 works, the test VFS and the crash suite), `AGENTS.md`, the acceptance suites of #16, #104,
#236, #315 and #572 for their conventions and surfaces, and `packages/hub` (`src/core.ts`: `journal()`, `writeJournal`,
`launch`, `finish`, `recoverRuns`; `src/paths.ts`; `src/vfs.ts`; `src/wire.ts`; `src/server.ts`),
`packages/extension-host` (`src/terminals.ts`, `src/host.ts`) and `packages/supervisor` as they are at the base commit
`881e2ed4` (origin/main, "Merge pull request #1136"), on November 2, 2026, by a job that never saw an implementation
of #996; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job.

The issue has 2 checkbox criteria, AC1 and AC2 in the body's order.

## How to run

On Linux (bubblewrap at `/usr/bin/bwrap`; the runs and the seeded terminals run in the platform sandbox) or macOS, with
the repo's Node (24.22.0) first on `PATH`:

```sh
npm ci                                            # once, if node_modules is missing
npm run generate -w @deepbuild/contracts
npm run build --workspaces                        # the tests run the built CLI (packages/cli/dist/main.js) and the supervisor's helper
node node_modules/vitest/vitest.mjs run --root tests/acceptance/996 --no-file-parallelism --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/996/tsconfig.json
```

- The suite takes about 70 s here; AC1's cut test is most of it (a hub start, a cut and a restart per point, about 20
  points). `scripts/lanes.mjs` runs it in its one-at-a-time list (`alone`), beside #16's, #104's and #236's suites,
  since it starts hubs and sandboxed processes by the dozen.
- Nothing needs the network. Every test makes its folders under `/tmp/dh996-*` (real paths, short enough for a socket
  path), runs each hub with `--root <tmp>/…/root` and `HOME` at a temp folder beside it, points this process's `HOME`
  at a temp folder, and removes the agent's own `CLAUDE_*`, `DEEP_*` and billing variables first.
- Processes are stopped only by PID: hubs this suite spawned, the PIDs the seeded terminals note, and every process
  the supervisor recorded as `process.tracked` in a record this suite made, each only while it still has the start
  time first seen or recorded for it. A run whose `process.tracked` a cut lost can't be found that way; AC1's runs are
  `/bin/sleep 90`, so such a run ends on its own soon after.
- With `--root` here, Vitest may write a cache under `tests/acceptance/996/node_modules/`; delete it before committing.

## The surface under test

The issue names the run journal (`runs.json`), the terminals index (`terminals.json`), the test disk and its numbered
durable write points, the record's run events, the supervisor's run tokens, a reading the hub records, and terminals
that reattach or read lost on their sessions. It names no point kind, aside-file name, reading kind or wire field.
These tests define the smallest surface that reaches both criteria, consistent with what is on main.

### The hub, its socket and the test disk

- The hub runs as a process: `node packages/cli/dist/main.js hub run --root <root>` (#16), ready when it prints its
  ready line; tests talk to it on its socket as a `cli` connection with `<root>/control.token`.
- Runs start with **`run.start`** as main serves it (`check`, `claim`, `commit`, `argv`, `cwd`, `deadline_ms`; the
  reply's `run`). The record is read with **`events.read`**.
- **The test disk** is #16's test VFS: `DEEP_HUB_TEST_VFS='{"points":"<file>","cutAfter":n}'`. Each durable write
  point appends `{"n", "kind", …}` to the points file; right after point `n` the hub ends as by kill -9.

### The journal

- `<root>/runs.json`, a JSON object of the runs in flight (an array is accepted too). An entry is found by its
  **`check`** and its **owner, `claim`**, as main writes them; a run relaunched under a new run ID still counts.
- **Its deadline**: `deadline` holding the `deadline_ms` run.start gave, as main writes it; or any numeric field whose
  name says deadline or due holding the time it falls due, within two minutes of the run's start plus `deadline_ms`
  (so a journal that keeps the original due time across a restart passes too).
- **Its writes are numbered points**: a write of the journal (temp file, sync, rename, folder sync) marks a point
  whose `kind` contains `journal` or `runs` (for example `journal_rename`). Starting three runs must make at least
  three such points.
- **The terminals index's writes** likewise mark a point whose `kind` contains `terminal` (for example
  `terminals_rename`); no test here cuts at one (the index is written only by opening or stopping a terminal, which
  needs the platform's pseudo-terminal, see AC2), so this is the implementer's to provide and the cut test of a later
  suite's to reach.

### Kept aside

A state file the hub can't read is moved, not read as empty and not overwritten: afterwards a file **in the same
folder whose name starts with the file's name** (`runs.json…`, `terminals.json…`), isn't the file itself and doesn't
end in `.tmp`, carries **a time in the rest of its name** (a date like `2026-11-02`/`20261102` or an epoch number of 10
digits or more), and **holds the damaged bytes exactly as they were**. For example `runs.json.2026-11-02T23-01-07Z`.

### The reading

The hub records **one reading naming the file**: one event appended at that start whose `kind` contains `reading`
(`reading.recorded`, `session.reading`, or a kind of the implementer's) and whose `data`, as JSON text, contains
`runs.json` or `terminals.json`. For the terminals index, the same reading also names the terminal it lost by its ID
(`term:<ULID>`): "keeps the rest aside and names them".

### Hosted terminals and their sessions (AC2)

- The index is `<root>/extensions/terminals.json` as `Terminals.save` writes it: an object keyed by terminal ID, each
  entry `{terminal, id, run, pid, title, kept}`, two-space JSON.
- **A terminal's session** is read where a hosted terminal shows: its piece's tab, **`deep.terminal.list()`** (each
  hosted terminal is the terminal a session runs in; design, Starting a session from the app). The fixture piece
  `fixtures/hosted-terminals` passes that list through whole (`ext.hosted-terminals.tabs`) and reads output with
  `deep.terminal.read` (`ext.hosted-terminals.read`), on the extension host the hub opens: `openExtensionHost` with the
  hub's record (`<root>/ledger.db`), a supervisor on it and `home` the hub root, as `core.ts` opens it.
- **Reattached**: listed with the terminal, run and PID it had, not lost, its output read from the first byte (beat 1,
  no gap) and still growing a second later.
- **Lost**: still listed, by its `terminal` ID, with **`lost: true`** (`status: "lost"` or `state: "lost"` are
  accepted too), and not reading closed (`closed: true`, or a status or state of `closed`). Left out of the list, it
  reads as a closed one would, and fails.
- The bad byte is a raw 0x01 in place of the second letter of the third entry's `title`. JSON can't hold it, so the file
  doesn't parse; the entry's key and its `id`, `run` and `pid` fields stay whole text, so the hub can name it.

## Criteria to tests

Each test's name starts with its criterion's number, and each `describe` carries the criterion's ID,
`#996.<first 8 hex of the SHA-256 of its text>` (trimmed, whitespace collapsed, `- [ ] ` dropped).

| ID | Criterion (short) | Tests | At this base |
|---|---|---|---|
| AC1 `#996.015d2487` | a cut at each numbered point while three runs start leaves all three in the journal with deadlines and owners; `runs.json` truncated to half is rebuilt from the record and kept aside; the base restarts with no runs and fails, naming them | `journal.test.ts` AC1 (2) | both fail: the journal makes no numbered point (every cut restart does hold the runs: a kill -9 keeps an unsynced file); the truncated journal reads as empty, so the restart has none of the three runs, named, nothing kept aside, no reading |
| AC2 `#996.17155b2f` | one bad byte in one entry of three: the hub starts, two reattach, the third reads lost on its session; the base starts none and fails | `terminals.test.ts` AC2 (3) | the hub and the extension host fail to start (`Terminals` throws on the index), so no terminal reattaches; the control passes |

### AC1

- **The cut** (`journal.test.ts`, first test). A reference hub under the test disk starts three runs, one after
  another (`/bin/sleep 90`, checks `deadline-alpha`, `-bravo`, `-charlie`, each its own claim, deadlines 20, 30 and 40
  minutes), and the points it made from just before the first `run.start` until the points file is quiet for a second
  are the window, printed as the Proof's list. Then for each point in the window: a fresh root, a hub with `cutAfter`
  that point, the same three starts sent in turn until one goes unanswered; the hub must end right after that point
  (a pass where it ends elsewhere, or not at all, is run again, three tries, as #315's cut test does; a point never
  reached fails, named). The hub restarts on the real disk, and within 15 s its journal must hold **every run whose
  start was acknowledged**, with its deadline and owner; the starts it never acknowledged are sent again, as a client
  would, and then **all three** must be there. Every failure names the point, how many starts were acknowledged and the
  run. The test also requires the window to hold **at least three journal points** (README, The journal).
- **The truncation** (second test). A hub on the real disk starts the same three runs; the journal holds them and the
  record holds their `run.started`; the hub is killed (kill -9) and `runs.json` cut to its first half (floor of its
  length over 2). On restart: within 20 s **the journal holds the three runs with their deadlines and owners** (rebuilt
  from the record, since the damaged file can't say), **the damaged bytes are kept aside** (above), and **exactly one
  reading names `runs.json`** among the events appended since the crash. At the base the restart reads the damaged
  file as empty: the failure names each of the three runs missing.
- The record must carry what a rebuild needs. On main `run.started` has no deadline, argv, cwd or grant; the
  implementer adds what the rebuild reads.

### AC2

The seed (each test's own, on a fresh root, the hub stopped): the record, a supervisor and the extension host opened on
the root as the hub opens them; the fixture piece installed, through conformance, with run-as-you approved on your
trusted path (`approve`, writer `app`) and loaded; then three terminals, `alpha`, `bravo`, `charlie`, each a run the
supervisor starts with `keep: true` and `run_as_you`, its folder `<root>/terminals/<ULID>`, appending what it writes to
`out` there. Linux's supervisor helper has no `pty` mode (#104's host process is macOS-only on main), so each
terminal's program writes `out` itself: a shell printing `beat N` every 0.1 s, noting its PID in `pid`. The index is
written as the extension host writes it, then damaged in `charlie`'s entry (above). The programs must outlive the
seed's close.

- **The hub** (first test). `deep hub run --root` on the seed: it must start (ready line, `hub.health` answered); the
  damaged index kept aside; exactly one reading naming `terminals.json`, which names `charlie`'s terminal ID; and the
  programs of `alpha` and `bravo` still running and writing 1.5 s on. At the base the hub exits at start, naming the
  JSON error, and the test fails: "the hub didn't start … so no terminal reattached".
- **Their sessions** (second test). The extension host as the hub opens it, on the seed: it must start, the piece load
  again, and its tabs show `alpha` and `bravo` reattached and `charlie` lost (above). At the base `openExtensionHost`
  throws and the test fails: "… didn't start …, so none of the three terminals reattached".
- **(control)** (third test). The same seed with no bad byte: all three reattach. It passes at the base, so the two
  failures above are the bad byte's, not the seed's.

## Wrong programs

| Wrong program | Criterion | How the test fails on it |
|---|---|---|
| The journal written but not marked as a numbered point (main) | AC1 | "the journal's writes aren't numbered durable write points: …" with the window's kinds |
| A journal read as empty when it can't be parsed (main) | AC1 | "the restart doesn't hold the three runs …: `deadline-alpha` (owner …) is not in the journal; …" |
| A damaged file overwritten or deleted rather than kept aside | AC1, AC2 | "the damaged … isn't kept aside: …" listing what is beside it |
| A rebuild that drops the deadline | AC1 | "… is in the journal without its deadline of … ms" |
| A terminals index that throws on one bad entry (main) | AC2 | the hub, and the extension host, don't start |
| A lost terminal dropped from its piece's list, as if closed | AC2 | "… isn't among the piece's tabs at all, as a closed terminal would be: it must read lost" |

## Proof

The issue's Proof asks for the cut test's list of points before and after, and both restarts on this branch and on the
merge base. The cut test prints the window (`#996 AC1: the points the hub made while it started three runs`) and the
points it cut after; `BASE-FAILURE.txt` is the run at the base, with the list before.

## Files

- `helpers.ts`: temp folders, processes by PID, the hub as a process and its line protocol, the points file, the
  journal and kept-aside checks, the readings, and AC2's world, fixture piece and seeded terminals.
- `journal.test.ts` (AC1), `terminals.test.ts` (AC2).
- `fixtures/hosted-terminals/`: the piece AC2 reads its terminals through (`index.ts.fixture`, renamed when copied).
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit.
