# Acceptance tests for #2136: the unit lane runs no by-hand or fixture test, and a runner that exits non-zero is never passed

Written first, blind, by a job that never saw a fix. On November 22, 2026 it read:

- issue #2136 (its text as of that day: Scope, Acceptance criteria, What goes wrong today, Proof)
- `AGENTS.md` (Proof), `docs/technical-design.md` ("How we know version 0 works", Dogfooding) and
  `docs/parallel-proof.md`
- the base commit `654c560c1`: `scripts/lanes.mjs`, `scripts/affected.mjs`, `scripts/proof.mjs`,
  `scripts/proof-change.mjs`, `scripts/proof-suites.mjs` (the lifecycle lane), `scripts/proof-runs.mjs` (how the before
  lane runs a test and lays a twin), `scripts/throttle.mjs` (which table a test's run reads), `scripts/lease`,
  `scripts/proof-reporter.mjs` and `tests/preflight.test.mjs`
- for conventions only: `tests/acceptance/1875/`, `tests/acceptance/2179/`, `tests/acceptance/2783/README.md` and the
  scene in `tests/acceptance/1114/lanes.test.mjs`

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## Criteria and tests

Each criterion's ID is `#2136.<first 8 hex digits of the SHA-256 of its "- [ ]" text, trimmed, white space collapsed>`,
as `scripts/proof-change.mjs` works it out from the issue. Each test is a top-level node:test test that carries its tag
at the start of its name.

| Criterion, in full | Test |
| --- | --- |
| `#2136.bcf37dea` "**A test job whose runner exited non-zero with no failed test is never passed.** Given a node job whose report holds a start row for its file and no fail row, and whose status is a signal, when the results are read, then the run's last line is INCONCLUSIVE, not PASS." | `runner-exit.test.mjs`. A real `affected.mjs` run on one node test file whose second test kills the `node --test` runner above it with SIGKILL once the report holds the file's start row. Given, asserted first: the file ran under `node --test`, the report held a start row for it, and afterwards holds no fail row and no row of the killing test. Then: the last line of the run's stdout starts with `INCONCLUSIVE` and doesn't start with `PASS`. |
| `#2136.2bc42651` "**The unit lane's one-at-a-time block runs no file the by-hand list names.** Given the lists lanes.mjs exports, when the unit lane's second command is read, then every by-hand file under an alone folder is the value of an --exclude in it. Today 21 are not." | `unit-lane-alone.test.mjs`. From `alone`, `byHand` and `checks` as `scripts/lanes.mjs` exports them: every `*.test.ts` file of the repository that both lists cover is the value of an `--exclude` in the unit lane's second command. Asserted first: that command is the `--no-file-parallelism` vitest block, and at least one such file exists. |
| `#2136.06841e2a` "**The unit lane's node block runs no live test and no fixture project's test.** Given the repo's tracked files, when the unit lane's node command's patterns are expanded, then no file named *.live.test.mjs and no file under a fixtures folder is among them. Today five are." | `unit-lane-node.test.mjs`. The patterns of the unit lane's `--test` command, expanded in this checkout with `fs.globSync` (never into `node_modules`, as `node --test` expands them) and kept to the repository's files: none is named `*.live.test.mjs` and none has a folder named `fixtures` above it. Asserted first: the command exists and its patterns expand to some file. |
| `#2136.3bd30215` "**affected.mjs never runs a fixture project's test as one of the repo's own.** Given a change to a source file of a gate fixture case, when affected.mjs plans its run, then no file under packages/*/fixtures/ is in any block." | `fixture-selection.test.mjs`. `affected.mjs --list` on the issue's own path, `packages/conformance/fixtures/gate/cases/answered-fail/base/src/cart.js`, and on a plain source file beside it: no block line of the plan names a file under `packages/*/fixtures/`. Asserted first: the plan printed (exit 0) and a block holds the plain file's test, so the blocks were read. |
| `#2136.e7710a49` "**Each lint job in affected.mjs writes and reads a log of its own.** Given the lint lane's commands, when affected.mjs labels them, then no two labels are equal; and a closures run with one FAIL line beside a passing drift run yields that finding once." | `lint-logs.test.mjs`, two tests. **Labels**: a real run whose every lint stand-in prints its own script name and arguments; each of the lane's commands has its line in some log, and no log holds two commands' lines. **Once**: a real run whose `canvas-closures.mjs closures` prints one `FAIL` line and exits 1 while `drift` prints nothing, waits until closures has printed, and exits 0; the finding's text is on exactly one line of the run's stdout. Asserted first: closures ran and drift ended after it had printed. |
| `#2136.4948c95b` "**proof.mjs lists the repository's files once for a change.** Given a change that touches 60 paths, when proof.mjs runs the lifecycle lane, then git ls-files is spawned once for the table lookup and the lane's lines are unchanged." | `proof-listing.test.mjs`. This checkout's `node scripts/proof.mjs lifecycle` in a scratch repository whose change touches 60 paths, under a `git` stand-in that notes each call. The run's lines, less its wall time, are the three the base prints for that change; then exactly one `git ls-files` call lists the repository's files. |

### The affected.mjs tree

Criteria 1, 4 and 5 run `node scripts/affected.mjs` as a process in a scratch tree, as #1875's suite does: a copy of
this checkout's `scripts/`, an empty `known-failures.json`, this checkout's `node_modules` linked, the test's own
files, all committed in a fresh git repository. Two boundaries the repo doesn't own are stood in for:

- `cargo`, first on PATH: its `metadata` reports no crates, so no run needs a cargo build.
- each script of the lint lane: a stand-in that prints nothing and passes, or what criterion 5's tests give it. The
  lane's commands, their order and their arguments are still read from `scripts/lanes.mjs`.

Every run has a HOME and a TMPDIR of its own inside the test's sandbox. Under `node --test` the throttle then keeps a
table of its own there (`scripts/throttle.mjs`: a test run's table is its HOME's), so each job gets its grant at once
whatever the machine is doing, and the run's logs go with the sandbox. Each process runs in its own group and is
stopped by that group's PID if it is still alive when the test ends; the sandbox is then removed.

Criterion 1's runner is not stood in for. `affected.mjs` starts `node --test` itself, by `process.execPath`, and the
tree's test file ends it: it finds the report in its parent's command line (`--test-reporter-destination=`), waits
for the file's first start row, and sends its parent SIGKILL. `node --test` writes a test's start row only when that
test has ended, so the file's first test passes at once and its second does the killing. The report therefore also
holds that first test's pass row, which is how the base comes to print `PASS affected: ... 1 passed`.

### The proof.mjs scene

Criterion 6's scratch repository has a merge base (its `origin/main`) of two lifecycle tables under
`packages/contracts/schemas/` and 5 plain files. Its change touches 60 paths, uncommitted: one table edited, one
deleted, one added (with a state that reaches no final state, so the lane prints a FAIL and its Fix line too), 5 plain
files edited and 52 added. Most are additions because the change's reader spawns git twice for every edited path, and
those spawns are no part of the criterion. `git`, first on PATH, appends each call's arguments to a file and then
execs the real git with them.

### The twin

`twins.json` gives `#2136.2bc42651` one planted wrong program, `alone-excludes-nothing`: the base's
`scripts/lanes.mjs` whole, with the unit lane's second command as the issue describes it, naming the alone entries and
excluding nothing (one line changed, one comment line added above it). The test fails on it at its assertion: 97 of 97
(`BASE-FAILURE.txt`, part 2).

The twin is 2,016 lines, so `scripts/size-ratchet.mjs` reads `FAIL size: ... over 1500 with no ceiling` for it until
`scripts/size-ceilings.json` gives it one, as it does #1407's and #83's twins. That file is outside this folder, so
this job left it alone.

## At the base (`BASE-FAILURE.txt`)

- **Criterion 1 fails** for the issue's reason: the run ends `PASS affected: 0 new, ... 1 passed` and exits 0 with its
  node job's runner killed part way through the file.
- **Criterion 2 passes.** The base already has what the criterion asks: the unit lane's second command carries an
  `--exclude` for every own-lane and by-hand entry, after the alone names (`scripts/lanes.mjs:1417`), and each of the
  97 by-hand files under an alone folder is the value of one. The issue's Scope asks for them before
  `--no-file-parallelism`; no criterion states an order, so none is asserted. The test is kept as written and proven
  on its twin.
- **Criterion 3 fails**: the patterns expand to `tests/panel-host.live.test.mjs`, `tests/panel-keys.live.test.mjs` and
  the three `passes-on-retry/*/test/cart.test.mjs` fixture files, the issue's five.
- **Criterion 4 fails**: `parallel node:` holds `.../answered-fail/base/test/cart.test.js`.
- **Criterion 5 fails**, both tests: two of the three `canvas-closures.mjs` jobs leave their line in no log (the three
  share one, and the last writer's line stands); the one finding is printed twice, as `NEW FAIL`.
- **Criterion 6 fails**: 60 calls list the repository's files, not one. The lane's three lines are as expected.

## How to run

```sh
node --test 'tests/acceptance/2136/*.test.mjs'
```

Node 24, `node_modules` installed, no build of any kind. About 35 s here at a load above 100; nothing waits on or reads
the load. No network.

## Left open

- **What the INCONCLUSIVE line says** (criterion 1; Scope: "saying the runner exited with no failed test"), the run's
  exit status and what `--results` records for the file: no criterion states them. Only the last line's state is
  asserted.
- **"whose status is a signal"** (criterion 1) is made as SIGKILL sent to the `node --test` runner. What status the
  job then has inside `affected.mjs` (the throttle above the runner exits 137) is not a named surface and is not read.
  A runner ended by SIGTERM, and a vitest job, are not tested.
- **"a start row for its file and no fail row"** (criterion 1): the report can't hold a start row alone, since
  `node --test` writes a test's start row with its result. The test's report holds one test's start and pass rows and
  nothing of the test that was running when the runner died.
- **"is the value of an --exclude"** (criterion 2) is read as: the value is the file itself, or `<folder>/**` for a
  folder above it, the form the lane's first command gives a folder entry. At the base every one of the 97 is the first.
  "Under an alone folder" is read as covered by any `alone` entry, a folder or a file. Where in the command the
  excludes stand is not asserted.
- **"the repo's tracked files"** (criteria 2 and 3) is read as the files git lists in the checkout, tracked or not yet,
  less the ignored and the deleted, as `listFiles` in `scripts/proof-change.mjs` reads them. That is what the block
  would run, and it is the same five at the base.
- **Where the two live files go, and the fixture files' new name** (Scope): not guessed. Criterion 3 only requires
  that the node command's patterns reach neither kind.
- **"in any block"** (criterion 4) is read from the block lines `--list` prints, `<block> <runner>: <files>`. Whether
  the dropped fixture test is then named on a SKIP or NOTE line is not asserted, nor is `isTestFile`, which the issue
  leaves as the proof guard reads it. One fixture case is tried, the issue's.
- **The labels themselves** (criterion 5): the label's text is left open, and a label is no printed surface. "No two
  labels are equal" is tested through what the title says a label is for: the log a job writes and reads. LIGHT, and
  whether the canvas-closures jobs still run without a grant, are not tested.
- **"for the table lookup"** (criterion 6): the run makes other `git ls-files` calls, two at the base, where the
  change's reader asks for the untracked files alone (`--others` with no `--cached`). Those are set apart by their
  arguments, and every other `ls-files` call counts as a listing of the repository's files. A fix that lists them by
  other means than `git ls-files` would spawn none and fail the test, as the criterion's "once" reads.
- **"the lane's lines are unchanged"** (criterion 6) is read against the lines the base prints for the scene, written
  into the test. `--release`, which lists every file once already, is not run.
- **The guarded files' approval tags and "each change needs its own commit"**: the guard's to check, not this suite's.
