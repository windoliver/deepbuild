# Acceptance tests for #1873: listed failures end

I drafted these tests blind from these sources:

- issue #1873, as saved verbatim for this job: its Scope, its eight criteria and its Proof
- `docs/technical-design.md`: How we know version 0 works, Dogfooding, Known failures are waivers
- `docs/parallel-proof.md`: section 12b (Main is watched), section 6 and the evidence records
- AGENTS.md
- the base commit `58d3e19e`, which has no implementation

At the base I also read `scripts/main-watch.mjs`, `scripts/known-failures-check.mjs`, `scripts/known-failures.json`,
`scripts/affected.mjs` (`classify`), `scripts/lanes.mjs` (`runLanes`, `readSkips`, `readRun`, `reportResults`),
`scripts/proof-reporter.mjs`, `scripts/proof-change.mjs` (`criterionId`), and `tests/acceptance/1333/` and `1406/` for
their shape. The helpers are written here; parts are copied from 1333's `helpers.mjs`, never imported. Per AGENTS.md,
the implementing agent doesn't edit these tests. A dispute goes to a blind redraft by this job.

## How to run

```sh
node --test 'tests/acceptance/1873/*.test.mjs'
```

There are 8 tests in 3 files, all offline. They need git and Node 24, and no `npm ci`. They're `*.test.mjs` under
`tests/acceptance/`, so the unit lane doesn't pick them up.

They run real components: the real job (`scripts/main-watch.mjs tick|status`), this checkout's real `lanes.mjs`
(`runLanes`, its report readers, its evidence records), the real `throttle.mjs` and `scripts/lease`, real git, real
`node --test`, and the real `known-failures-check.mjs`, copied with the rest of `scripts/` into each fixture.

Stand-ins, all first on `PATH`, all at boundaries the repo doesn't own (copied from 1333's):

- **`gh`**, for GitHub. Issues are JSON files in the sandbox; `issue view|list|create|reopen|close|comment|edit` and
  `pr view|list` work, anything else exits 1.
- **`claude` and `codex`**, for the agent an attempt starts: each records its run, changes nothing and exits 0.
- **`deep`**, for the hub's `deep lease`: it runs the command.
- **Any HTTP endpoint**: the proxies and model base URLs point at a recorder on 127.0.0.1.

Every test points `HOME` and `TMPDIR` at a temporary folder and unsets `DEEP_*`, `CLAUDE*`, `CODEX_*`, `GH_*`,
`GITHUB_*` and the like. Each process a test starts gets its own process group and is stopped by its PID. Nothing is
killed by name or port. No model is called and no network is used.

## The surface (my choice where the issue leaves it open)

### The lint lane

- **The check** is `node scripts/known-failures-check.mjs`, a command of the `lint` lane in `checks`, as #1333 made
  it. It reads the `known-failures.json` of the repository it sits in, and that repository's tree. The tests run it
  as 1333's do: this checkout's lint lane cut to that command, through this checkout's `runLanes`, with `cwd` a fixture
  repository whose `scripts/` is this checkout's, copied, and whose `scripts/known-failures.json` the test writes.
  "Fails the lint lane, naming X" is the lane's `FAIL lint` with a non-zero exit, and a line reading `FAIL`, `INVALID`,
  `BLOCKED` or `INCONCLUSIVE` that holds X. "Passes" is `PASS lint` with exit 0.
- **A `lint` entry's issue and date** live in the key `lintIssues`, which the file already has at the base: the same
  key as in `lint`, its value ending ` (#<issue>, added <YYYY-MM-DD>)`, the form `failures` takes. A `lint` key with no
  `lintIssues` value names no issue.
- **A `timing` entry's issue and date** live in a new key `timingIssues`, the same shape: the timing ID as key, the
  value ending ` (#<issue>, added <YYYY-MM-DD>)`. `timing` stays a list of IDs, so `affected.mjs` and the main watch
  read it unchanged. This key is my choice; it mirrors `lintIssues`.
- **The 14-day rule and "open"** are #1333's: added more than 14 days before today, or an issue `gh issue view` reads
  other than `OPEN`, fails.
- **A `lint` key names a file** when it holds a repository path, as the real keys do (`canvas-lint: <path> <finding>`).
  The fixture's missing file is `crates/deep-text/src/worker.rs`; a key naming no path (the `embedded-io` one) and a
  key naming a file that exists must pass.
- **A `skips` entry names a deleted test** when its id's file (the part before the first ` › `) is gone from the
  tree. The fixture deletes the file in a later commit. A test removed from a file that stays isn't tested.
- **A reason names an opt-in variable** in the words main's entries use: `gated on the opt-in variable <NAME>: …`.
  The test's file reads it when its source holds `<NAME>`.

### The main watch

- **The tick and the gate** are #1333's: `node scripts/main-watch.mjs tick` in the watched clone, and `status`, whose
  first line is `landings open` (exit 0) or starts `landings paused` (non-zero).
- **"Fails the tick, naming the entry"** is a line of the tick's output that starts with `FAIL` and holds the entry's
  test ID. For a listed skip, the same line holds the state its test ran to: `PASS`, or `FAIL` again after the line's
  first word. Whether such a tick also pauses landings or exits non-zero is the implementation's; neither is tested.
- **The load passed in** is the environment variable `DEEP_MAIN_WATCH_LOAD`, a 1-minute load the tick judges by in
  place of `os.loadavg()[0]`. Nothing at the base passes a load to the main watch, so this name is my choice. The core
  count is `os.availableParallelism()`, as `classify` reads it. "Names the load" is a line of the tick's output holding
  the test's name, the word `load` and the load passed in, as a whole number (the tests pass an integer).
- **"Pauses landings, naming the test"** is `status` reading paused after the tick, its first line holding the test's
  name. **"Pauses nothing"** is `status` reading open at every poll during the tick and after it.

### Main

The criteria name main at `a9d2e682`. These tests read **this checkout's own `scripts/known-failures.json` and tree**
(the merge result) instead, running this checkout's check in it with every issue the file names open in the `gh`
stand-in, so only the file's own entries and the tree can fail it. This checkout's file holds no
`crates/deep-text/src/worker.rs` key, and its tree has no such file, so AC3's "the three worker.rs keys pass" reads
here as "no lint key of main's fails the check". The 14-day rule makes these readings date-bound: an entry dated more
than 14 days before the run fails them, as the rule says it should.

## The fixtures

- **Lint repositories** (`lint.test.mjs`): a git repository with this checkout's `scripts/`, a written
  `known-failures.json`, and only the files a test needs: `crates/deep-text/src/cache.rs`, `tests/timed.test.mjs`,
  `tests/gated.test.mjs` (reads `DEEP_FIXTURE_OPT_IN`, or in the other variant never does), `tests/gone.test.mjs`
  (committed, then deleted). Issue 9801 is open and 9802 closed.
- **Watched repositories** (`watch.test.mjs`, `load.test.mjs`): #1333's shape. A bare `origin.git`, a `work` clone and
  the job's `mac` clone at the first commit. The first commit holds this checkout's `scripts/`, with `scripts/lanes.mjs`
  a shim that re-exports this checkout's `lanes.mjs` whole and cuts `checks` to `unit` (`node --test
  tests/*.test.mjs`) and `lint` (the known-failures command). A landing is a `--no-ff` merge of a branch, as GitHub
  merges pull request `#920<k>`, saying `Part of #910<k>`.

## The scenes

| File | Scene |
|---|---|
| `watch.test.mjs` | One tick, opted in with `DEEP_FIXTURE_OPT_IN=1` and load 0, on a head where `tests/fixed.test.mjs › passes again` (listed in `failures`) and `tests/budget.test.mjs › stays within its budget` (listed in `timing`) pass, and two `skips` entries' tests run, one to a PASS and one to a FAIL |
| `load.test.mjs` | Landing 1 makes `lib/work.mjs` take 2.5 s, so `tests/timed.test.mjs › stays within its budget` (listed in `timing`, budget 1 s) fails. One tick at load 0, then on a fresh sandbox one at load `cores × 2 + 3`, polling `status` |
| `lint.test.mjs` | The lint lane on fixture repositories, and the check on this checkout's own file |

## Criteria to tests

Each criterion's ID is `#1873.<first 8 hex digits of the SHA-256 of its "- [ ]" text, trimmed, white space
collapsed>`, as `scripts/proof-change.mjs` (`criterionId`) works it out. Each test's name starts with its tag.

| Criterion | Test (file) | What it requires |
|---|---|---|
| AC1 `#1873.d1984163` A listed entry whose test passes on main fails the lane, naming it | `watch.test.mjs` | A `FAIL` line of the tick names `tests/fixed.test.mjs › passes again` (a `failures` entry), and one names `tests/budget.test.mjs › stays within its budget` (a `timing` entry), both of which passed in the run. A watch that reads them as known prints neither |
| AC2 `#1873.b9b52cba` lint and timing entries name an open issue and a date within 14 days | `lint.test.mjs` | A lint key with no `lintIssues` value, one whose issue is closed, one added 20 days ago, a timing ID with no `timingIssues` value and one added 20 days ago each fail the lane, named; the lint key and timing ID with an open issue added 2 days ago aren't named, and alone they pass. On main the check names no `lint` key or `timing` ID |
| AC3 `#1873.125cf93b` a lint key naming a missing file fails, naming it | `lint.test.mjs` | The `crates/deep-text/src/worker.rs` key fails the lane, named; the `cache.rs` key (file present) and the `embedded-io` key (no file) aren't named, and without the worker key the lane passes. On main the check names no `lint` key |
| AC4 `#1873.36e78550` a slowed timing test pauses landings at a load below the cores, and not above | `load.test.mjs` | At load 0, `status` reads paused after the tick, naming the test. At load `cores × 2 + 3`, `status` reads open at every poll and after, and a tick line names the test and that load |
| AC5 `#1873.48498355` a skips entry naming a deleted test fails the lint lane | `lint.test.mjs` | With `tests/gone.test.mjs` deleted, its entry fails the lane, named; the gated entry beside it isn't named, and alone it passes |
| AC6 `#1873.a54dd0d9` a listed skip whose test ran fails the tick, naming the entry and its state | `watch.test.mjs` | A `FAIL` line names `tests/gated.test.mjs › runs to a pass when opted in` and `PASS`; one names `… runs to a fail when opted in` and `FAIL` again. A watch that looks up only the skips it saw prints neither |
| AC7 `#1873.e084d5c1` a reason naming `DEEP_FIXTURE_OPT_IN` on a file that never reads it fails | `lint.test.mjs` | The entry fails the lane, one line naming the entry and `DEEP_FIXTURE_OPT_IN`; the same entry on a file that reads it passes |
| AC8 `#1873.f9faca98` on main every `skips` entry passes the rules | `lint.test.mjs` | The check fails a fixture entry naming a deleted test (so it reads `skips` at all), and on main it names no `skips` entry |

## Readings where the issue leaves a choice

- **AC8's "or the PR lists it".** A test can't read the PR. If main keeps an entry that breaks a rule, the check fails
  it, and this test fails; the PR's listing, with the run that shows it, is then the evidence for that entry, and the
  dispute goes to a blind redraft. AC8's second rule (a skipped test that ran in the main watch's run) needs a run of
  the watch on the real main, which these tests don't make; it's for the implementer to run once and report.
- **The Proof's "before and after".** The base run is `BASE-FAILURE.txt`. The planted wrong programs the criteria
  name (a lane that reads a passing listed test as known, a check that reads only `failures`, `lint` and `timing`, a
  watch that looks up only the skips it saw, a check that accepts any reason) are the implementer's twins; each
  behaves as the base does on the part its criterion's test checks.
- **AC4's load.** The tests pass the load in, so the machine's own load can't change a verdict. A watch that ignores
  the load passed in and reads the machine's fails AC4 only when the machine's load is on the other side of the core
  count; this Mac usually sits at or above it.
- **AC1's timing entry.** A listed timing test that passed was measured, so it fails the tick at any load. The scene
  passes load 0 so no reading of the load can excuse it.
- **AC6's tick with a FAIL.** The skip that runs to a FAIL is also a failing test; the base pauses landings for it as
  a new failure and starts an attempt (the stand-in). The test reads only the tick's lines.

## Files

- `helpers.mjs`: the sandbox, the stand-ins, launching, the lint repositories and lane, the watched repositories,
  `tick` and `status`.
- `watch.test.mjs`: AC1 and AC6.
- `load.test.mjs`: AC4.
- `lint.test.mjs`: AC2, AC3, AC5, AC7 and AC8.
- `BASE-FAILURE.txt`: the run on the base.

No fixture holds a secret or personal data. Issues 9101, 9801, 9802 and 9900 on, and pull request 9201, are made up.
