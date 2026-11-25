# Acceptance tests for #3433: a stopped run stops its whole tree and says what it stopped

I drafted these tests blind from these sources:

- issue #3433, as `gh issue view 3433` printed it on 2026-11-24
- `docs/parallel-proof.md`, section 6 (Scheduling: the throttle table, a table of a test's own, `DEEP_THROTTLE_TABLE`)
- the Dogfooding part of `docs/technical-design.md`
- AGENTS.md
- the base commit `16dd75036` (origin/main), where `measureOnce` in `scripts/benchmark.mjs` runs a captured command
  under `/usr/bin/time` as the leader of its own group and SIGKILLs that group at the timeout (#1322), rethrowing
  spawnSync's `ETIMEDOUT`; `scripts/perf.mjs` prints that error as `BLOCKED perf: <message>`; and `runLanes` in
  `scripts/lanes.mjs` runs each command with `spawnSync` through `throttle.mjs <class> --wait 30 -- scripts/lease …`
  and writes the lane's record with `writeRecord` under `~/.deepbuild/lanes/<tree>-<lane>.json`

At the base I also read `scripts/throttle.mjs` (`descendants`, `killTree`, the table folder inside a test run),
`scripts/lease`, the #1322 stop test in `tests/benchmark.test.mjs`, the `repository()` fixture and the allowance tests
in `tests/perf.test.mjs`, `tests/cargo-no-grant-lane.test.mjs` (a `runLanes` run in a child process of a fixture
repository), and `tests/acceptance/3350/` and `3336/` for the suite's shape. Per AGENTS.md the implementing agent
doesn't edit these tests; a dispute goes to a blind redraft by this job.

Run them with Node 24:

```sh
npm ci                                   # once, if node_modules is missing: lanes.mjs's binaries step loads typescript
node --test 'tests/acceptance/3433/*.test.mjs'
```

There are 6 tests in five files. On the base the suite takes about 40 s (`BASE-FAILURE.txt`). Each file stays well
under 20 minutes even when every bound in it runs out: `lane-term.test.mjs` and `lane-group-kill.test.mjs` at most
about 3 minutes (2 to see the grandchild start, 6 s, 15 s for the stop, 30 s for the record), `lane-ends.test.mjs` at
most about 4 minutes, `perf-line.test.mjs` at most 4 (its perf run is bounded at 240 s), `measure-stop.test.mjs` under
a minute. No test needs an idle machine and none holds a port or a shared resource, so there is no `lane.json`: every
test has its own sandbox folder, HOME and throttle table, and starts and stops only its own processes.

## Criteria to tests

Each test's name starts with its criterion's tag.

| Criterion | Test (file) | What it requires | Wrong program |
|---|---|---|---|
| `#3433.bf4b249a` A `measureOnce` captured run past its timeout, whose command starts a grandchild in a process group of its own and waits, throws `ETIMEDOUT`, and 2 s later nothing the command started is alive | `measure-stop.test.mjs` | `measureOnce([node, lead-3433.mjs, <pids>], dir, false, 3000)`: the lead records its PID, spawns `grandchild-3433.mjs` with `detached: true` and no stdio of the run's, and both wait forever. The call throws an error whose `code` is `ETIMEDOUT`; both processes had started; within 2 s of the throw neither is alive (by PID and start) | Twin `stop-lead-only`; the base fails the same way: its group kill leaves the grandchild |
| `#3433.0ced7c1d` That `ETIMEDOUT` error names each process the stop ended, by PID and command, and perf's `BLOCKED perf` line for a copy's checks past their allowance carries the same names | `measure-stop.test.mjs` (the error) and `perf-line.test.mjs` (perf's line) | The same run's error message still holds `ETIMEDOUT`, and for the lead and for the grandchild one line of it holds the process's PID (as a whole number) and its script's file name (`lead-3433.mjs`, `grandchild-3433.mjs`). In a fixture repository as `tests/perf.test.mjs` makes one (budget `elapsedMs` 1000, margin 0.5: an allowance of 1.5 s), a copy's `scripts/checks.mjs` records its PID, spawns the grandchild detached and waits; `node scripts/perf.mjs` prints `BLOCKED perf: …ETIMEDOUT…`, and the text from `BLOCKED perf:` up to its `Fix:` line has, for the checks process and the grandchild, one line holding its PID and its script's name (`checks.mjs`, `grandchild-3433.mjs`) | Twin `stop-names-nothing`; the base names nothing (`spawnSync /usr/bin/time ETIMEDOUT`) |
| `#3433.46eec7ed` A lanes.mjs lane run whose command starts a grandchild in a process group of its own, stopped by SIGTERM to the lanes.mjs process alone, leaves nothing its command started alive 15 s later; the record reads `INCONCLUSIVE` with a finding naming each process stopped | `lane-term.test.mjs` | The lane (see The lane run) has started: its `node --test` runner, its test file's process and the grandchild are alive, and the grandchild has run 6 s. SIGTERM to the lanes.mjs process alone. Within 15 s none of the three is alive. Within 30 s of the signal one record of the lane is under the run's HOME; its `state` is `INCONCLUSIVE`; it has a finding whose `note` matches `/\bstop/i`, and those notes have, for the test file's process and for the grandchild, one line holding its PID and its script's name (`fixture-3433.test.mjs`, `grandchild-3433.mjs`) | Twin `lanes-as-main`; the base fails the same way: all three run on and no record is written |
| `#3433.d424696d` The same lane run stopped by SIGKILL to the lanes.mjs process's whole group leaves nothing its command started alive 15 s later, and the record reads `INCONCLUSIVE` naming them | `lane-group-kill.test.mjs` | As above, but the stop is `process.kill(-pid, 'SIGKILL')` on the group the test made the lanes.mjs process lead. Within 15 s none of the three is alive; within 30 s one record reads `INCONCLUSIVE` with a stop finding; its notes have a line holding the grandchild's PID and `grandchild-3433.mjs` (the processes in lanes.mjs's group were ended by the group kill itself, so only the grandchild is required to be named) | Twin `stop-in-lane-group`; the base fails: the grandchild runs on, no record |
| `#3433.cd15df63` A lane run that ends by itself writes its record by its tests, with no stop finding, and leaves no process of the stop running | `lane-ends.test.mjs` | The lane's one test records its PIDs, waits 2 s and passes. While lanes.mjs runs the test lists every process under it every 100 ms (by PID and start). lanes.mjs exits 0; one record, `lane` `stop-3433`, `state` `PASS`, holds the test's row `tests/fixture-3433.test.mjs › …` as `PASS`, and no finding matching `/\bstop/i`; the listing saw the lane's `node --test` runner; 5 s after the run's end none of the processes seen under lanes.mjs is alive | Twin `stop-outlives-run`. The base passes this test: it is today's behavior |

`twins.json` names each twin, and `twins/README.md` says exactly what each must plant. The implementing job writes the
twin files.

## The surfaces (my choice where the design leaves it open)

Every surface is one the issue names. The tests import only `measureOnce` from the checkout's `scripts/benchmark.mjs`;
everything else runs as a process and is read by its output and its files.

- **measureOnce**: the export, called in the test's own process with a 3 s timeout. Read: what it throws (`code`,
  `message`).
- **perf's line**: `node scripts/perf.mjs '{"status":0,"elapsedMs":1,"cpuMs":1,"peakBytes":1}'` in a fixture
  repository whose `scripts/` is a copy of the checkout's (so a twin's `benchmark.mjs` is the one perf loads), under a
  HOME, cache and throttle table (`DEEP_THROTTLE_TABLE`) of the test's own. The merge base's copy is the first whose
  checks run past the allowance. Read: the `BLOCKED perf:` verdict up to its `Fix:` line. perf takes its own `timed`
  grant first, and a top-level timed request waits for the 1-minute load to fall below the cores (section 6), as
  `tests/perf.test.mjs`'s own grant does: on a machine loaded past its cores perf prints nothing within the test's
  240 s bound, and the test fails at its first assertion with `status null`, which says nothing of the stop. Rerun the
  file alone then (`BASE-FAILURE.txt`, the second run).
- **The lane run**: a child `node --input-type=module -e` process, started `detached: true` so it leads a process group
  the test made, that imports the checkout's `scripts/lanes.mjs` and calls
  `runLanes([{ name: 'stop-3433', commands: [[node, '--test', 'tests/fixture-3433.test.mjs']], fix: 'none' }], { cwd })`
  in a fixture git repository with one commit, as `scripts/checks.mjs` runs a lane. That child is "the lanes.mjs
  process". Its environment: a HOME of the test's own (the record goes to `<HOME>/.deepbuild/lanes/<tree>-stop-3433.json`),
  `DEEP_THROTTLE_TABLE` naming a folder of the test's own (no machine grants are needed: the throttle reads it inside a
  test run), `DEEP_LEASE_WAIT=1`, and a PATH of node's folder and the system's (`/usr/bin:/bin:/usr/sbin:/sbin`), so
  `scripts/lease` finds no `deep` of the machine's. No caller's `DEEP_THROTTLE`, report, lock or `NODE_TEST_CONTEXT`
  passes on.
- **The processes**: each fixture process appends `<role> <pid>` to a pid file of the test's own (`lead`, `runner` = the
  test file's `process.ppid`, `file`, `grandchild`). A process is alive while `ps -o lstart= -p <pid>` gives the start it
  had when the test first read it. The test's cleanup SIGKILLs only those PIDs, and the processes its own listing saw
  under lanes.mjs, each still holding the start it was seen with; never a PID of 1 or less, never by name or port.
- **Naming a process "by PID and command"**: one line of the text holds the PID as a whole number (not part of a longer
  number) and the file name of the script the process runs, which is in its command line. So `pid 123 (node /…/grandchild-3433.mjs …)`,
  `123 node …grandchild-3433.mjs`, or a JSON object on one line all match; a list of PIDs with the commands on other
  lines does not.

## Assumptions, where the design is silent

1. **The error keeps its code**: the `ETIMEDOUT` error `measureOnce` throws keeps `code: 'ETIMEDOUT'` and the word
   `ETIMEDOUT` in its message (as the #1322 test and perf's allowance tests read it); the names are added to the
   message, as the issue says the error "names" them, and perf prints the message in its `BLOCKED perf` line.
2. **Which processes are named**: in a `measureOnce` stop, the lead (the measured command's own process) and the
   grandchild; `/usr/bin/time` may be named too, and isn't required. After a SIGTERM to lanes.mjs alone, the lane's test
   file process and the grandchild (the runner, the throttle and the lease may be named too). After a SIGKILL to
   lanes.mjs's group, only the grandchild is required: the rest of that group were ended by the kill, not by the stop.
3. **"Its command started"**: the processes required gone are the ones the fixture recorded: in the lane runs, the
   `node --test` runner, its test file's process and the grandchild.
4. **The listing has time to see the grandchild**: the lane is stopped once the grandchild has run 6 s. The issue
   says the helper "keeps a current listing of the run's tree"; a listing older than 6 s isn't current.
5. **The record of a stopped lane** may be written by the lanes.mjs process (on SIGTERM) or by the stop (after a group
   SIGKILL): the test reads it up to 30 s after the signal, and requires exactly one record of the lane. Its `tests` may
   be empty or hold what finished; its state must be `INCONCLUSIVE`.
6. **"A finding that the run was stopped"**: a `findings` entry whose `note` holds a word starting with `stop`
   (`stopped`, `stop`), case aside. A run that ends by itself has no such finding.
7. **"No process of the stop running"** after a run that ends by itself: the test can see the stop only as a process
   under the lanes.mjs process while it runs, so the stop must have been a descendant of lanes.mjs at some moment of a
   100 ms listing (a stop started `detached` by lanes.mjs is; one started by a parent that exits at once is not seen).
   It must be gone 5 s after lanes.mjs exits.

## What stays unproven here

- **The Spark**: the issue's Proof asks for the fixture runs on the Mac and the Spark; this suite ran on the Mac only
  (`BASE-FAILURE.txt`). The tests have no platform gate and should run as they are on Linux.
- **A process that ignores SIGTERM** (the SIGKILL to what is left): the fixtures end on SIGTERM; no test plants one that
  ignores it.
- **Section 6 says so**: docs, read by diff review.
- **perf's whole run on the Mac (1350 s)**: the fixture's allowance is 1.5 s.

## How I checked the tests can pass

No implementation was written into the repository. In a copy of the checkout in this job's scratch folder I wrote a
throwaway one: a watcher process, started `detached` by `measureOnce` and by `runLanes` for each lane, that lists the
tree under its target every 200 ms and keeps each process it saw by PID and start; on a stop request from `measureOnce`
(after spawnSync's `ETIMEDOUT`), or when the lanes.mjs process is gone before the lane said it was done, it SIGTERMs
then SIGKILLs what is still alive and lists `pid <n> (<args>)` lines, which `measureOnce` adds to the error's message
and the watcher writes into an `INCONCLUSIVE` record's finding (`the run was stopped part way; the stop ended: …`).
All 6 tests passed on it. Then I planted, one at a time: the watcher started without `detached` (fails
`#3433.d424696d`), the watcher ignoring the run's end (fails `#3433.cd15df63`), and the message left as spawnSync's
(fails both `#3433.0ced7c1d` tests; `#3433.bf4b249a` passes). The merge base is `stop-lead-only`'s and
`lanes-as-main`'s behavior. `BASE-FAILURE.txt` is the suite's run on the merge base, then a summary of those runs. The
throwaway isn't kept and proves nothing about the real change.

## Files

- `helpers.mjs`: the sandbox and its cleanup, the pid files, the fixture scripts, the lane fixture and its run, the
  records, the test's own tree listing, and the names check.
- `measure-stop.test.mjs`: `measureOnce`'s stop and its error (`#3433.bf4b249a`, `#3433.0ced7c1d`).
- `perf-line.test.mjs`: perf's `BLOCKED perf` line (`#3433.0ced7c1d`).
- `lane-term.test.mjs`, `lane-group-kill.test.mjs`, `lane-ends.test.mjs`: the lane runs (`#3433.46eec7ed`,
  `#3433.d424696d`, `#3433.cd15df63`).
- `twins.json`, `twins/README.md`: the planted wrong programs.
- `BASE-FAILURE.txt`: the run on the base, home paths written as `~`.

No fixture holds a secret or personal data.
