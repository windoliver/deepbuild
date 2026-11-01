# Acceptance tests for #909: a lost lock turns every gate watch-only, and a failing job is counted in a row

Written blind at base commit `a1707356` ("Merge pull request #914 …"), from the issue, the design doc and the base
alone, before any implementation. Per AGENTS.md the implementing agent doesn't edit these files; a dispute goes to a
blind redraft by this job.

## What was read

- Issue #909 as given to this job: its intro, Scope (two lines), AC1, AC2 and Proof.
- `docs/technical-design.md`: "One hub per user, a tiny hook client, and extensions in-process" and the "A broken
  hub" row of the failure table (the record fails closed: appends fail, the hub stops acknowledging, every gate turns
  watch-only with a BLOCKED reason; the hub removes only its own socket and refuses to start twice through a lock
  the OS holds).
- The base, to learn the existing surface only: `packages/hub/src/lock.ts` (the lock is an exclusive SQLite
  transaction on `<root>/hub-lock.sqlite`, taken once), `server.ts` (`runHub` takes the lock, then `open` removes
  whatever is at `<root>/hub.sock`; `hub.health` is the core's health plus `pid`, `start`, `off`), `core.ts`
  (`health()` returns `gates: { watch_only, reason }` and `jobs: { <name>: { failing } }`, `failing` being the last
  failure `{ at, error }` or `null`; `every()`/`run()` keep only that), `doctor.ts` (items `{ item, agent, code,
  level, evidence, fix }`; the doctor reaches the hub only to see that it answers), `plant.ts`, and the
  `doctor.item@1` schema (its closed list of codes).
- `tests/acceptance/16` (helpers.ts, lock.test.ts, README.md): every helper used here is imported from
  `../16/helpers.ts` (temp homes under short `/tmp` paths, `deep hub run` as a real process, `control()`, `health()`,
  `settle`, `Conn`, `deep`, `waitFor`, cleanup that stops only the PIDs this suite started).

## The surface under test

- `deep hub run` on a temp home (its root `<home>/.deepbuild`), as a real process; its socket's line protocol
  (`hub.health` on a control connection, and the `hello` line every new connection gets, whose `start` names the
  hub); the lock file `<root>/hub-lock.sqlite` and the socket `<root>/hub.sock` under its root.
- `deep doctor --json` from the built CLI, in the hub's home, from a folder outside any repo, with `PATH` set to
  `/usr/bin:/bin:/usr/sbin:/sbin` so no agent binary of this machine is run.

## Surface choices

The issue leaves these names open; the tests use them exactly, so the implementation matches them.

- **Gates after a lost lock**: `hub.health`'s existing `gates: { watch_only: true, reason }`, the reason matching
  `/BLOCKED/` and `/lock lost/i` (for example `BLOCKED: lock lost: <root>/hub-lock.sqlite is no longer the file this
  hub holds locked`).
- **The wrong program for AC1**: a plant, `DEEP_HUB_PLANT=lock-never-rechecked`, added to `packages/hub/src/plant.ts`:
  the hub with its lock check left out, everything else as fixed. It must still start (the plant is listed).
- **A job's failures in a row and their start**: in `hub.health`, `jobs.<name>.failing` stays the object it is at the
  base (or `null`) and gains two fields:
  - `failing.failures`: the job's failures in a row, an integer (1 at the first failure).
  - `failing.since`: when the row began, the hub's clock in ms since the epoch (the `ts` clock); it stays the first
    failure's time for every later failure of the row.
  - A clean run sets `failing` back to `null`, clearing both; the next failure starts a new row at 1.
- **Making a job fail on demand**: no job at the base can be made to fail, run by run, through files under the hub's
  root (the 1 s jobs read only the record; the others run hourly or daily). So one test-only seam:
  `DEEP_HUB_TEST_FAIL_JOB=<file>`. With it set, the hub keeps one more background job, named **`test`**, run through
  the same bookkeeping as every other job and listed in `hub.health`'s `jobs` from the start with `failing: null`.
  Each line appended to `<file>` is one run of that job, taken in order within a few seconds of being written: a line
  `fail` is a run that fails (throws), a line `ok` is a clean run. With no new line there is no run. The hub never
  writes the file. Only tests set the variable.
- **The doctor's report of a failing job**: one item per job at its third failure in a row or later:
  `{ item: "hub.jobs", agent: "deepbuild", code: "job_failing", level: "fail" | "warn", evidence, fix }`, the
  evidence naming the job (`test`) and its failures in a row (`3`). `job_failing` is a new code in `doctor.item@1`'s
  list. A job at one or two failures in a row, or not failing, gives no `hub.jobs` item other than at level `ok`, and
  no item with code `job_failing`. The level is the one place the tests accept either value, since the issue says
  only "reports a job as failing".

## The tests

`lock.test.ts`, AC1:

- **AC1 with the lock file removed under a running hub, within 60 s every gate is watch-only with BLOCKED, lock
  lost.** A hub starts, a control connection opens, the gates read enforcing, then `<root>/hub-lock.sqlite` is
  removed. `hub.health` on that connection is polled every 0.5 s until the gates read watch-only or 61 s pass (60 s
  for the check, 1 s for the poll and the reply); the gates must be watch-only, within that time, with the reason
  matching `/BLOCKED/` and `/lock lost/i`.
- **AC1 a second start beside a hub whose lock file was removed leaves the first hub's socket in place, and the first
  hub's gates still turn watch-only within 60 s.** As above, then at once a second `deep hub run` on the same home.
  Once it is ready, has exited, or 20 s pass, the file at `<root>/hub.sock` must have the inode it had before the
  removal, and a new connection there must get a hello whose `start` is the first hub's. Then the first hub's gates
  are judged as in the first test, from the moment of the removal. Whether the second start exits or runs elsewhere
  is left open; it must not take the socket.
- **AC1 (wrong program) a hub that never checks its lock again fails this test.** The first test's steps on a hub
  started with `DEEP_HUB_PLANT=lock-never-rechecked`; its judge must fail with "every gate is watch-only within
  60 s". The base is that wrong program too: run on the base, the first two tests fail (On the base, below).

`jobs.test.ts`, AC2, one test in steps on one hub at the installed root, so `deep doctor` in that home reaches it:

- **AC2 two failures read failing with 2 and their start, doctor quiet; the third shows in doctor; a clean run
  clears both.** The hub starts with `DEEP_HUB_TEST_FAIL_JOB` set; `jobs.test` must be listed with `failing: null`.
  One `fail` line: `failing.failures` is 1 and `failing.since` lies between just before the line was written and
  just after the failure was seen. A second `fail`: `failures` is 2 and `since` unchanged; `deep doctor --json` then
  has no failing-job report (and its `hub.socket` item is `ok`, so it did reach the hub), and the job still reads 2
  after the doctor ran. A third `fail`: `failures` is 3, `since` unchanged, and `deep doctor --json` has exactly one
  failing-job report, as in Surface choices. An `ok` line: `failing` is `null` and the doctor is quiet again. One
  more `fail`: `failures` is 1 again, with a `since` after the clean run, so the clean run cleared both rather than
  hiding them. Each step waits up to 10 s for its state, failing with the last `jobs.test` read.

## On the base (the wrong programs)

Run on `a1707356`, every test fails, each for the reason its criterion names (BASE-FAILURE.txt, with the hub's
health output):

- AC1 lock removed: 61.4 s after the removal `hub.health` still reads gates `{"watch_only":false,"reason":null}`;
  the base never checks its lock again.
- AC1 second start: the second start takes a new lock file, removes the first hub's socket and listens on its own;
  `<root>/hub.sock` has a new inode. This is the base running beside the second start.
- AC1 wrong program: the base doesn't know the plant, so the hub doesn't start (BLOCKED). The base itself is the
  wrong program the plant names, shown by the first test failing on it.
- AC2: the base has no `DEEP_HUB_TEST_FAIL_JOB` seam, so `jobs.test` is absent. Its health reply's jobs read
  `{"<name>":{"failing":null}}`, and a failure there is only the last one, `{ at, error }`, with no count and no
  start (`core.ts`, `run()`), which is the wrong program the issue describes; its doctor reads no job at all.

## Running them

```
npm ci && npm run build --workspaces
npx vitest run tests/acceptance/909
```

Node 24.22 or later (the repo's `engines`). No `deep-hook` build is needed. AC1's tests wait up to 61 s each for
the lock check, so the file takes about three minutes on a fixed hub that checks once a minute; each hub this suite
starts is stopped by its PID.
