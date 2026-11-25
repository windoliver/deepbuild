# Acceptance tests for #3478: an affected.mjs run keeps its place in the build and test lines while they move

I drafted these tests blind from these sources:

- issue #3478, as `gh issue view 3478` printed it on 2026-11-24
- `docs/parallel-proof.md`, section 6 (Scheduling: the grant-wait table and its `affected.mjs` paragraph, a wait
  bounded by a stall, Drain, a stuck drain, admission, tables of a test's own)
- the Dogfooding part of `docs/technical-design.md`, and its Repo guards (the wait ratchet, home paths)
- AGENTS.md
- the base commit `1b4929ae7`, where `scripts/affected.mjs` asks `acquire('build', { wait })` and
  `throttle.mjs test --wait`, each 30 minutes unless `DEEP_TEST_GRANT_WAIT` says otherwise, and reads no
  `DEEP_TEST_GRANT_STALL`

At the base I also read `scripts/affected.mjs`, `scripts/throttle.mjs`, `scripts/proof-change.mjs` (a criterion's
tag), `scripts/proof-runs.mjs` (twins), `scripts/wait-ratchet.mjs`, and `tests/acceptance/1115/`, `2574/`,
`2574-redraft-2833/`, `2820/`, `2869/`, `2902/` and `3334/` for their conventions. The tests import #2820's fixture
repository (`../2820/helpers.mjs`), #1115's and #2574's sandbox and `start` through it, and #2833's reading of the
machine's test limit (`../2574-redraft-2833/helpers.mjs`). Per AGENTS.md, the implementing agent doesn't edit these
tests; a dispute goes to a blind redraft by this job.

Run them with Node 24, cargo on the PATH or in `~/.cargo/bin`:

```sh
npm ci                                   # once, if node_modules is missing
node --test 'tests/acceptance/3478/*.test.mjs'
```

There are 6 tests in six files. Against a throwaway implementation on the 20-core Linux machine they were drafted
on, at a 1-minute load of 68 to 176, the first five files run together took 22 to 99 s; `redrafts.test.mjs`, added
with the seventh criterion, reads one listing of this checkout (38 s on the base at a load near 40). On the merge base
`stalled-build.test.mjs` waits out its 5-minute bound (the base run waits 30 minutes), so the suite there takes about
5 minutes. A run of `affected.mjs` that hasn't ended 8 minutes after its start fails its test, and each file's worst
case is its one test's 15-minute limit. No test needs an idle machine and none holds a
port, so there is no `lane.json`: every test has its own HOME and its own throttle table (`DEEP_THROTTLE_TABLE`), and
never reads or writes `~/.deepbuild/throttle`. `redrafts.test.mjs` starts no run: `--list` only lists.

## Criteria to tests

Each test's name starts with its criterion's tag (`#3478.` and the first eight hex digits of the SHA-256 of the
criterion's text, as `scripts/proof-change.mjs` derives it).

| Criterion | Test (file) | What it requires | Wrong program |
|---|---|---|---|
| `#3478.caea9543` With neither variable set, a run that builds a binary is granted, and the log's `granted` entries for its top-level build and test requests each carry `stall: 720` and no `wait` | `defaults.test.mjs` | A run alone on its own table, with `DEEP_TEST_GRANT_WAIT` and `DEEP_TEST_GRANT_STALL` both unset, whose one selected test builds `fixture-a` itself. The planted test built its binary; the log holds at least one top-level `granted` entry of class `build` and one of class `test`, and every such entry has `stall` equal to 720 and no `wait` key | The base (its entries carry `wait: 30`) |
| `#3478.ee81cf50` With `DEEP_TEST_GRANT_STALL` at 0.05, a run that needs a binary, behind build holders whose grants change hands every 2 s for 20 s, gets its build grant, then its test grant, and reads its tests' own results | `moving-build.test.mjs` | A moving build line (below). The run was seen waiting in it; it never prints `INCONCLUSIVE no grant`; at least 3 holders' grants (4.5 s of hand-overs, past the 3 s bound) are logged between its joining and its own top-level build grant; that grant comes before its top-level test grant; the planted test built its binary, and the run's `--results` file reads the planted file `PASS` | Twin `fixed-build-wait`. The base passes this test: its 30-minute wait outlasts the line |
| `#3478.a5864770` With `DEEP_TEST_GRANT_STALL` at 0.05, a run that needs no binary, behind test holders whose grants change hands every 2 s for 20 s, gets its test grant and reads its tests' own results | `moving-test.test.mjs` | A moving test line (below). The same, for the run's top-level test grant; the log holds no top-level build grant; the planted test ran, and the `--results` file reads its file `PASS` | Twin `fixed-test-wait`. The base passes this test |
| `#3478.981101c5` With `DEEP_TEST_GRANT_STALL` at 0.05 and every build slot held past the bound, the run prints the build line's `INCONCLUSIVE no grant`, an `INCONCLUSIVE` line for each file and a summary ending `no job started`, exits 2 within 5 minutes; its tests never ran | `stalled-build.test.mjs` | Every build slot of the table is held for nine minutes and nothing else changes. Two files are selected, one that builds `fixture-a` and one that builds nothing. Within 5 minutes of its start the run ends: a line of its output starts `INCONCLUSIVE no grant: no build grant changed hands within 0.05 min for the run's binaries; no test grant was asked for`; for each of the two files a line starts `INCONCLUSIVE ` and names it; its last `affected:` line starts `INCONCLUSIVE affected: ` and ends `no job started`; it exits 2; neither planted test ran; the log holds no top-level test grant | The base (it waits 30 minutes, so it is still waiting at the 5-minute bound) |
| `#3478.b300c126` With `DEEP_TEST_GRANT_STALL` at 0.2, every build slot held for 8 s, and a top-level `throttle.mjs timed --wait 0.05` request made after the run joined the line, the timed request ends `INCONCLUSIVE no grant`, and the run then gets its build grant and reads its tests' own results | `drain.test.mjs` | Every build slot is held. Once the run is seen waiting in the build line, a top-level `node scripts/throttle.mjs timed --wait 0.05 -- <command>` is started on the same table, and the holders let go 8 s after the run joined. The timed request prints a line starting `INCONCLUSIVE no grant`, exits 3 and never runs its command. The run never prints `INCONCLUSIVE no grant`; the log's `timeout` entry of class `timed` comes before the run's top-level build grant; the run takes a top-level test grant; the planted test built its binary, and the `--results` file reads its file `PASS` | Twin `fixed-build-wait`. The base passes this test |
| `#3478.cfd0c346` With `DEEP_TEST_GRANT_WAIT` set, the run's waits and lines are as before: `tests/acceptance/2574-redraft-2833/` and `tests/acceptance/2820/` pass unchanged | none here | No new test: the criterion is those two suites, unchanged, passing on the change. `2574-redraft-2833/grant.test.mjs` (`#2574.AC2d`) and `2820/failures.test.mjs` (`#2820.AC5b`) set `DEEP_TEST_GRANT_WAIT` to 0.02 and read `no test grant came within 0.02 min`, a build `timeout` entry with `wait: 0.02`, each file `INCONCLUSIVE` and a non-zero exit | By reading, not run: a run that ignores `DEEP_TEST_GRANT_WAIT` once the stall is in fails `#2820.AC5b` (its `timeout` entry carries no `wait: 0.02`) and `#2574.AC2d` (no `came within 0.02 min` line) |
| `#3478.1c95ae53` The blind redrafts `1113-redraft-3478/`, `2574-redraft-3478/` and `1115-redraft-3478/` take their originals' place: each redrafted test passes on the change and fails on the merge base, each carried test reads as its original did, the three original files are gone from the checkout, and `affected.mjs --list` on a change to `scripts/affected.mjs` selects the three redraft folders' files | `redrafts.test.mjs`, for the checkout and the listing; the redrafts' own runs on the base and on the change are in each folder's `REDRAFT.md` | None of `tests/acceptance/1113/waits.test.mjs`, `tests/acceptance/2574/grant.test.mjs` and `tests/acceptance/1115-redraft-2833/no-grant.test.mjs` exists in this checkout. `node scripts/affected.mjs --list scripts/affected.mjs` in this checkout, with a HOME of the test's own, exits 0 and names files a run would start. Each of the three redraft folders holds at least one test file in the checkout, and every test file in it is on a `<lane> <runner>: …` line that a run of the change starts (not one ending `(--<flag> runs them)`; a `SKIP <file> (by hand)` line selects nothing) | The base, for both halves: it has no redraft folder and holds all three originals. The base with the three redraft folders copied in and nothing else changed fails on the originals alone, so a change that adds the folders and keeps an original fails too |

`twins.json` names each twin, and `twins/README.md` says exactly what each plants.

## The surfaces (my choice where the design leaves it open)

Every surface is one the issue or the design names. The tests start processes and read files; they import nothing of
the code under test.

- **The run**: `node scripts/affected.mjs <planted test files>` in #2820's fixture repository: a scratch git
  repository holding a copy of this checkout's `scripts/`, a tiny Cargo workspace (one bin crate, `fixture-a`, no
  dependencies) and planted `node --test` files that note in a record file when they ran. cargo is real. Read: the
  run's exit status and its stdout lines (`INCONCLUSIVE no grant…`, `INCONCLUSIVE <file>…`, the `<STATE> affected:`
  summary).
- **Its tests' own results**: the run is started with `--results=<file>` (section 6a), which holds one entry for each
  selected test file with its state. The planted file's entry must read `PASS`, and the planted test must have noted
  its run.
- **A run that needs a binary** selects a planted test that runs `cargo build --locked --bin fixture-a` itself, which
  the run builds first under a build grant of its own (#2820). **A run that needs no binary** selects a planted test
  that builds and reads none.
- **The table's log**: `<table>/log`, one JSON object a line. Read: `granted` entries (`class`, `grant: "top-level"`,
  `pid`, `stall`, `wait`) and the timed request's `timeout` entry, and their order.
- **Which grant is the run's**: every holder the test starts is a `throttle.mjs` process whose pid the test knows, and
  a log entry's `pid` is its holder's. The run's grant of a class is the top-level one no holder took.
- **The run joined the line**: the table's `table.json` lists who waits, as `requests`, each with `class` and `pid`
  (read by #2869's and #2902's suites too). The run has joined once a request of the class is there that no holder
  made. The log has no entry for a request joining.
- **The throttle CLI**: `node scripts/throttle.mjs <class> --wait <min> -- <command>` for the holders and for the
  timed request, with the exit status 3 and the `INCONCLUSIVE no grant` line section 6 gives a wait that ran out.
- **`DEEP_TEST_GRANT_STALL`** is set in the run's environment; `DEEP_TEST_GRANT_WAIT` is never set by these tests, and
  neither variable reaches the run from the process that runs the suite.

### The moving line

A line of a class is made of `throttle.mjs <class>` holders the test starts on its own table. Every slot of the class
but one (1 of 2 build slots and 5 of 6 test slots on Linux; none on the Mac's 1 build slot, 1 of its 2 test slots) is
held still for the whole test. The last slot changes hands: a small feeder, written into the sandbox, keeps five
holders waiting for it at every moment, each a `throttle.mjs <class> --wait 10` whose command holds its grant 1.5 s, so
with the hand-over a grant of the class changes hands about every 2 s, as the issue asks. A request that joins at any
moment has five holders ahead of it, at least 7.5 s of hand-overs, past the 3 s bound, while each hand-over is well
inside it. The request under test is never starved: holders the feeder adds after it join behind it.

The line moves for 20 s at least, and goes on until the run has its grant of that class or has ended, so the run finds
it moving however long the run takes to reach its request on a loaded machine. A fixed 20 s would let a slow run
arrive after the line had drained and prove nothing.

A watcher, also written into the sandbox, reads `table.json` and the log every 40 ms: it notes how many holders'
grants the log held when the run's request was first in line, and says when the run's grant is logged. The tests wait
on its lines, never on a clock (the wait ratchet): every timer in this suite is in a helper process or only bounds a
wait.

## Assumptions, where the issue is silent or loose

1. **"Its top-level build request and its top-level test request"** (first criterion): the run is alone on its
   table, so every top-level `granted` entry of class `build` and `test` there is the run's, and each must carry
   `stall: 720` and no `wait`. The run's jobs pass through or take turns (`passed`, `turn`), which are not `granted`
   entries.
2. **"A line of holders whose grants change hands every 2 s for 20 s"**: one slot changes hands and the others are
   held still, so a hand-over comes about every 2 s; with every slot cycling at once, hand-overs on the Spark's six
   test slots would come three times as often. "For 20 s" is read as at least 20 s (above).
3. **"Every build slot held for 8 s"** (fifth criterion): the 8 s count from the moment the run was seen in line, not
   from the holders' own grants. A run on a loaded machine may take longer than 8 s to reach its request, and the
   criterion needs the slots held when the timed request is made "after the run joined the line".
4. **"The run then gets its build grant"**: the log's `timeout` entry of the timed request comes before the run's
   `granted` entry. The timed request is started when the run is seen in line, so its 0.05-minute wait normally ends
   before the holders let go at 8 s; were it later, a loaded machine (load at or above the cores) still refuses it.
5. **The build line's first line** (fourth criterion) is asserted as a line that starts with the issue's text. The
   scope names holders only for the test grant's line; a build line that goes on after `…was asked for` still passes.
6. **"Exits 2 within 5 minutes"** counts from the run's start.
7. **A planted `affected.mjs` that waits a fixed 0.05 min** does so whatever `DEEP_TEST_GRANT_STALL` says: in the fifth
   criterion the variable is 0.2, and a twin that read it as a fixed wait would outlast the 8 s and pass.
8. **"Reads its tests' own results"** is the planted file's own state in the run's `--results` file, `PASS`, not the
   run's summary state or exit status. The fixture run also starts some twenty lint jobs of its own, which are no
   test of the run's; on this machine at a load of 150 one of them once read `INCONCLUSIVE … job: no grant` (its
   request left the table seconds into a 30-minute wait; see the table lock, below), which turns the summary
   `INCONCLUSIVE` with the test still `PASS`.
9. **Exit statuses**: the run's 2 on INCONCLUSIVE (fourth criterion), the throttle's 3 on no grant, as section 6 gives
   them.

## What stays unproven here

- **A stalled test line**: the scope's `INCONCLUSIVE no grant: no test grant changed hands within <min> min`, holders
  named, each file `INCONCLUSIVE`, `no job started`, exit 2. It is in the scope and in no criterion, so no test here.
- **`DEEP_TEST_GRANT_WAIT` set** (sixth criterion): proven by the two existing suites, run unchanged on the change.
- **The seventh criterion on the change**: `redrafts.test.mjs` was run on the base only (it fails, as it must) and
  on the base with the redraft folders copied in (it fails on the originals). It was not run by this job against a
  checkout with the originals deleted, so its passing is the change's run to show.
- **The drain being unchanged**: only the fifth criterion's one case runs; #2744's own suite covers a stuck drain.
- **Section 6's grant-wait table and `affected.mjs` paragraph**: docs, read by diff review.
- **The guard's signed approval tag** for `scripts/affected.mjs`: a person's.
- **Timing on a very loaded machine**: the moving line's hand-overs must stay under 3 s apart, and in `drain.test.mjs`
  the run must look at the table within 12 s of joining (0.2 min) less the 8 s hold. At a load of 30 to 150 on 20
  cores both held.
- **A table lock taken aside** (not this issue's; seen on the unchanged base too). At a load above 100, three of
  about 55 fixture runs stopped their sandbox's table for good, once the run had its grants and its twenty lint jobs asked
  for their turns together: `table.lock` named a live `throttle.mjs` process that was itself waiting for the lock,
  with a lock file of its own of another inode. The only code that puts a lock in place for another process is
  `locked()`'s stale-lock steal ("A live lock taken aside by mistake goes back"), which can put a lock back after its
  owner has finished and found no lock to remove; while the lock is aside a second process can take it, which would
  also explain the lint job above whose request left the table. A test whose run is caught so fails at the run's
  8-minute bound with `the run was still going 8 min after it started` and a `table.lock, still held:` line in its
  message; it never passes. The moving line was cut from 30 processes to about ten after the first such stop, but the
  run's own jobs are enough to cause it, in `defaults.test.mjs` and in #2820's and #2574's suites as well. Until
  `throttle.mjs` is repaired on main, a failure of that shape at a high load is the table's, not the change's.

## How I checked the tests can pass

No implementation was written into the repository. To tell a test bug from a real failure, I wrote a throwaway
implementation in a copy of `scripts/affected.mjs` (the two requests ask with `stall`, `DEEP_TEST_GRANT_STALL` or 720,
unless `DEEP_TEST_GRANT_WAIT` is set), laid it over a copy of the checkout's `scripts/` in this job's scratch folder,
and ran this suite against it, four runs with these files: 5 of 5 passed in three, and in one, at a load of 115 to
135, two tests failed at their 8-minute bound on a stopped table (above). The two suites of the sixth criterion
passed against it, 8 of 8, in one run.
Each first twin was that file with one fault, and failed its test at its assertion; the twins in `twins/` now are the
implementation's file with the same fault, redrafted blind once it existed (`twins/README.md`). The throwaway proves nothing
about the real change. `BASE-FAILURE.txt` is the suite's run on the merge base, then the planted runs.

## Files

- `helpers.mjs`: the sandbox (#2820's, with neither variable set), process starts in their own groups, the bound on a
  run, the still holders and the moving line, the watcher, and what a failure message shows.
- `defaults.test.mjs`: the defaults, read from the log.
- `moving-build.test.mjs`, `moving-test.test.mjs`: the run behind a build line and a test line that keep moving.
- `stalled-build.test.mjs`: the run behind a build line that stands still.
- `drain.test.mjs`: the run through a timed request's drain.
- `redrafts.test.mjs`: the originals gone from the checkout, and the listing on a change to `scripts/affected.mjs`.
- `twins.json`, `twins/README.md`, `twins/fixed-build-wait/`, `twins/fixed-test-wait/`: the planted wrong programs.
- `BASE-FAILURE.txt`: the run on the base and the planted runs, home paths written as `~`.

No fixture holds a secret or personal data.
