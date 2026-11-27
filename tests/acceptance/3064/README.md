# Acceptance tests for #3064: settled suites are left to the main watch

A blind job wrote these tests before any work on #3064 existed, from three inputs:

- issue #3064, as saved for this job: its Change and its five acceptance criteria (its sixth line, "Reading, not a
  criterion", has no test)
- the design: `docs/parallel-proof.md` sections 6, 7, 7a and 12b as amended for #3064 (7a "Settled suites" and 12b
  "The settled list", which main does not hold yet), `docs/technical-design.md` (Dogfooding) and AGENTS.md
- the base commit `c7dc0edc3`, which knows nothing of the rule. There I read `scripts/affected.mjs`, `main-watch.mjs`,
  `lanes.mjs`, `proof-change.mjs` (`criterionId`, the tag reader), `known-failures-check.mjs` and `scripts/lease`, and
  `tests/acceptance/1333/`, `2574/` and `1115/` for their shape.

The helpers and the `gh` stand-in are written here and import no other suite's. Per AGENTS.md the implementing agent
doesn't edit these files; a dispute goes to a blind redraft by this job.

## How to run

```sh
node --test 'tests/acceptance/3064/*.test.mjs'
```

14 tests in 5 files, all offline. They need git, Node 24 and this checkout's `npm ci` (`affected.mjs` imports
`typescript`), and no package build. Every test sets its own limit of 45 minutes, and nothing in them sleeps or is
timed. The whole suite took 23 s on a Mac at a load of about 100 on 12 cores, files in parallel (`BASE-FAILURE.txt`
has each test's time). Run them with
`node --test`: under it the throttle uses the sandbox's table (docs/parallel-proof.md, section 6, tables of a test's
own), so no run here waits on the machine's.

They run real components: this checkout's `scripts/affected.mjs` (copied with the rest of `scripts/` into a fixture
repository, and run there), `scripts/main-watch.mjs`, the real `lanes.mjs` (`runLanes`, its report readers, its
evidence records), `throttle.mjs`, `scripts/lease`, `known-failures-check.mjs`, real git, real `node --test` and a real
`npm run build --workspaces`.

Stand-ins, all first on `PATH`, all at boundaries the repo doesn't own:

- **`gh`**, for GitHub (`gh.mjs`). Issues and pull requests are JSON files in the sandbox and every call is recorded.
  It answers the call the design names, `gh issue list --state closed --limit 100000 --json number,stateReason`, with
  each closed issue and its `stateReason` (`COMPLETED` for the fixture's), and the calls `main-watch.mjs` makes at the
  base: `issue create|list|view|reopen|close|comment|edit`, `pr create|list|view|merge|comment|close`, `repo view`,
  `auth status`, with `--json` and a plain `-q`/`--jq` path. Anything else exits 1 and is recorded.
- **`deep`**, for the hub's `deep lease` (#1015), which `scripts/lease` calls first: it runs the command.
- **`cargo`**: `cargo metadata` names no crate, or the one crate of the Rust fixture; nothing is built.

**Every test points `HOME` and `TMPDIR` at a temporary folder**, so `~/.deepbuild/main-watch/` (the settled list and
the job's state), the throttle table and the lane records are the sandbox's. The sandbox unsets `DEEP_*`, `CLAUDE*`,
`CODEX_*`, `GH_*`, `GITHUB_*`, `NODE_TEST_CONTEXT` and `NODE_OPTIONS`. Each process a test starts gets its own process
group and is stopped by that group's PID. Nothing is killed by name or port, no model is called and no network is used.

## The surfaces

Only what the issue and the design name:

- **`node scripts/affected.mjs --list <path …>`** and **`node scripts/affected.mjs <path …>`** in a fixture repository,
  with that repository's own copy of `scripts/`. Paths stand for the change; with none, the change is the worktree
  against its merge base with `origin/main`, and its commit messages are the commits' since that base.
- **Its stdout.** The selection's lines as the base prints them (`parallel node: <file> …`, `parallel cargo test: …`),
  the one line `SETTLED <n> …` holding the count of suites left and each one's folder, the one line
  `SETTLED no list: …` naming the file, and the summary line `<STATE> affected: …` with the exit status (2 for
  INCONCLUSIVE). A `SETTLED <n>` line names a suite when it holds `tests/acceptance/<issue>` (with or without the
  closing `/`).
- **`--settled`**, which runs the settled suites too.
- **`$HOME/.deepbuild/main-watch/settled.json`**, in the design's shape: `{ "tree": "<the tree of the head the watch
  ran>", "suites": { "tests/acceptance/<issue>/": "<git's ID of that folder in that tree>" } }`. The tests on
  `affected.mjs` write it; the tests on the watch read it.
- **`node scripts/main-watch.mjs tick`** in a clone of a watched repository, with origin's main moving between ticks.
- **Whether a fixture test ran**: each notes its run, and whether it passed, in a file the sandbox names
  (`T3064_EVENTS`).

No test imports a function of `scripts/affected.mjs` or `scripts/main-watch.mjs`.

## The fixture repository (`fixture()` in `helpers.mjs`)

A fresh git repository on `main`, with `origin/main` at its one commit:

- `scripts/`: this checkout's, copied, so a planted `affected.mjs` in the checkout is the one that runs. Its
  `lanes.mjs` is a shim: this checkout's `lanes.mjs` whole, with `checks` cut to a unit lane (`node --test` on the
  suites) and a lint lane of the real `known-failures-check.mjs`, and `known-failures.json` is empty. So a run's jobs
  are the package build, one `node --test` block and one lint script, and take seconds.
- `packages/a`, a workspace package. `src/main.mjs` prints `hello from a`; its build copies it to `dist/main.js`
  (ignored by git; the run builds it, since the change is under `packages/a/src/`).
- Three suites, `tests/acceptance/90001/`, `90002/` and `90003/`, each one file, `started.test.mjs`, whose one test
  starts `packages/a/dist/main.js` as a process and reads what it prints. That is the only way they reach package a.
- `tests/near.test.mjs`, outside every suite, which reads `packages/a/src/main.mjs` itself: it is selected by the
  change with no process between, list or no list.
- `node_modules/`, a folder of links to this checkout's (ignored by git).

**The change** is `packages/a/src/main.mjs` unless a test says otherwise. At the base it selects all four test files.

**The settled list** a test writes names a suite's folder with `git rev-parse HEAD:tests/acceptance/<issue>` and the
tree with `git rev-parse HEAD^{tree}`, as the watch would have for that commit.

`binaryFixture()` is the same repository with one suite, whose test starts a Rust binary, `deep-fix`, and a crate of
that name which the `cargo` stand-in's metadata lists; the change there is `crates/deep-fix/src/main.rs`. It is only
ever listed, never run.

## The watched repository (`watched()`)

As #1333's: `origin.git`, a bare repository standing for GitHub's; `work`, the clone the tests land in; and `mac`, the
clone the job runs in, left at the first commit, so only a job that fetches origin's main sees the landings. Main
holds the same `scripts/` and shim, package a with its build committed (the watch builds nothing there: the repository
has no root `package.json`), and the suites. A landing is one commit on main that adds `tags/l<k>`.

### The watch's scene (`watch.test.mjs`)

One scene for three tests. Four suites, each one test that starts package a's build:

| Suite | Its issue, by the `gh` stand-in | On main since | In the scene |
|---|---|---|---|
| `tests/acceptance/90011/` | closed, `COMPLETED` | the first commit | passes in every run |
| `tests/acceptance/90012/` | closed, `COMPLETED` | the first landing after run 1 | passes in every run, so it has 9 runs at the tenth |
| `tests/acceptance/90013/` | open | the first commit | passes in every run |
| `tests/acceptance/90014/` | closed, `COMPLETED` | the first commit | fails once in the eleventh run, and passes when run again alone |

The scene ticks once on the first commit, then nine times more with five landings before each, which is ten runs of
main's head. It reads `settled.json`, and runs `affected.mjs --list packages/a/src/main.mjs` in `work`, at main's head,
with that list. Then `90014`'s test is armed to fail once, five more landings reach main, the eleventh tick runs, and
`settled.json` is read again. The scene is built in a `before` hook that never throws: what goes wrong is kept and
every test fails on it at its first assertion.

## What each file proves

| Criterion | ID | Test | What it asserts |
|---|---|---|---|
| AC1 | `#3064.25bec8c3` | `settled.test.mjs`, `--list`, a build | With a list naming `90001/`, `--list` of the change prints one `SETTLED 1 …` line naming `90001/`, its file is in no block, and `90002`, `90003` and the near test are selected as today |
| AC1 | `#3064.25bec8c3` | `settled.test.mjs`, `--list`, a Rust binary | The same for a suite that starts a Rust binary whose crate changed; the crate stays in `parallel cargo test:` |
| AC1 | `#3064.25bec8c3` | `settled.test.mjs`, a run | The run prints the line, `90001`'s test doesn't run while the others run and pass, the summary reads `INCONCLUSIVE affected:` and the exit is 2 |
| AC2 | `#3064.1c658f8a` | `runs.test.mjs`, names S's issue | The change is a commit over `origin/main` whose message says `Part of #90001`: `90001` runs. With `Closes #90001`, `--list` selects it. With no issue named, `--list` leaves it on the SETTLED line |
| AC2 | `#3064.1c658f8a` | `runs.test.mjs`, edits a file of S | The change's paths hold `tests/acceptance/90001/started.test.mjs`: `90001` runs |
| AC2 | `#3064.1c658f8a` | retired by #3593 | S's own package: the test and its twin `skips-own-package` were removed by #3593 (owner decision 2026-11-26), under which a settled suite the change reaches by import is left to the watch |
| AC3 | `#3064.a5a02f7e` | `watch.test.mjs`, 9 clean runs | The tenth run's list doesn't hold `90012/`, and with it `--list` selects `90012`'s file |
| AC3 | `#3064.a5a02f7e` | `watch.test.mjs`, an open issue | The tenth run's list doesn't hold `90013/`, and with it `--list` selects `90013`'s file |
| AC3 | `#3064.a5a02f7e` | `changed-suite.test.mjs` | The list names `90001/` by the folder's ID at one commit, a later commit on main edits its file, and a run of the change runs `90001` |
| AC4 | `#3064.3deceb81` | `watch.test.mjs`, a settled suite fails | `90014/` is on the tenth run's list; its test fails in the eleventh run; that run's `settled.json`, keyed by the eleventh head's tree, doesn't hold it, and still holds `90011/` |
| AC5 | `#3064.c0da1789` | `no-list.test.mjs`, no list | No `settled.json`: all three suites are selected and run, no `SETTLED <n>` line names one, and one `SETTLED no list: …` line names `main-watch/settled.json` |
| AC5 | `#3064.c0da1789` | `no-list.test.mjs`, a list cut short | The same with the first 60 bytes of a list that names all three |
| AC5 | `#3064.c0da1789` | `no-list.test.mjs`, another shape | The same with a JSON array of the three folders |
| Change, `--settled` | none | `settled.test.mjs`, `scope: --settled` | Without the flag `--list` leaves `90001/`; with `--settled` the run runs it and no `SETTLED <n>` line names it |

Each test fails at an assertion of its own, on what the program printed, wrote or ran; none asserts that the program
throws. The planted wrong programs the criteria name fail like this:

- AC1, a selection that drops S without the line: `… no "SETTLED <n> …" line names it: the selection dropped it
  without the line`, naming `tests/acceptance/90001/`. In the run, such a program also reads PASS, which the summary
  assertion would catch after it.
- AC2, a selection that skips S in one of the three: the message starts with the case (`names S's issue:`, `edits a
  file of S:`, `is in S's own package:`) and says `tests/acceptance/90001/ didn't run`.
- AC3, a list that admits each: `the list admits tests/acceptance/90012/ after 9 clean watch runs`, `the list admits
  tests/acceptance/90013/, whose issue #90013 is open`, and `tests/acceptance/90001/ holds a file that differs from the
  listed tree … and didn't run`.
- AC4, a watch that keeps it: `the watch kept tests/acceptance/90014/ on the list of the run its test failed in`.
- AC5, a run that treats a missing list as "all settled": `no settled list: the selection isn't today's: it lost
  tests/acceptance/90001/started.test.mjs`.

Every AC2 test and the third AC3 test also hold a second settled suite, `90002/`, which is none of the cases: it must
be left on a `SETTLED 1 …` line and not run. That shows the list was in force when S ran, and it is what fails those
tests on the base, where S runs because every suite does.

## Where the issue leaves a choice, and how I read it

- **"Through a binary" (AC1).** The design names two processes: a Rust binary, and a package's build such as
  `packages/cli/dist/main.js`. The run is proved on a package's build, which a fixture can build in a second; the Rust
  binary is proved on `--list` only, since running it would mean a real cargo build.
- **"Edits a file of S" (AC2).** The paths given stand for the change, as for a slow file today, so the test names
  S's test file among them and leaves the disk as the list has it. Editing the file on disk too would also make it
  differ from the listed tree, which is AC3's reason, and a program without AC2's rule would still pass.
- **"S's own package" (AC2).** By the design it is a package whose files S's tests import or read themselves, with no
  process between. So S imports `packages/a/src/util.mjs`, and the change is another file of that package,
  `src/main.mjs`, which reaches S only through the build. A change to `util.mjs` itself would reach S by import and
  prove nothing about the package.
- **"Names S's issue" (AC2).** Read from the commit messages since the merge base with `origin/main`, as the trace
  lane reads them, so that test gives no path and makes a real commit. `Part of` is proved on a run and `Closes` on
  `--list`.
- **"Differs from the listed tree" (AC3).** The file changed in a commit on main after the tree the list is keyed by,
  and the change under test doesn't touch it.
- **"Fails in a watch run" (AC4).** The test fails once and passes when the watch runs it again alone, which the design
  says changes nothing ("whatever a repeat alone says afterwards"). It also keeps the scene short: the base watch files
  a flaky test and pauses nothing, so no bisection or revert follows.
- **"9 clean runs" (AC3).** The suite landed after the watch's first run, so the tenth run is its ninth. The same
  list holds a suite with ten, so ten is shown to be enough and nine not.
- **"Can't be read" (AC5).** Two cases: JSON cut short, and JSON of another shape (an array of folders, with no tree
  and no IDs).
- **`SETTLED no list:` on `--list`.** The design says the `SETTLED <n>` line prints "on `--list` too" and doesn't say
  so of this one, so the three AC5 tests read it from a run.
- **The state after `--settled`, and with no list.** The design says the run "then reads no list" and "selects as it
  did before"; the tests assert what ran and which `SETTLED` lines printed, not the summary's state.

Not tested, since no criterion names it: that a suite stays off the list until it has ten clean runs again, that a
change to a suite's files starts its count again on the watch's side, an issue closed as not planned, a `gh issue
list` that fails, and that the release preflight runs every suite.

## The base, and how the tests were checked

`BASE-FAILURE.txt` is this suite's output at `c7dc0edc3`, where neither script knows the rule. All 14 tests fail
there, each at an assertion, for the expected reason: no `SETTLED` line, or no `settled.json`.

A base where everything fails says little about what the tests catch, so the job also ran them on a throwaway
implementation of its own, written from the design and not kept (about 40 lines in `affected.mjs` and 25 in
`main-watch.mjs`): all 14 pass on it. With one fault planted at a time, the tests of that criterion's case failed at
an assertion as quoted above, and no other criterion's did: no `SETTLED` line (the `--settled` test fails with it); the line with a PASS summary; no rule for the named
issue, for the edited file, for the own package; a list at 9 runs; a list that ignores the issue's state; a reader that
ignores the folder's ID; a watch that keeps a failed suite, and one that keeps it because its repeat alone passed; a
missing list read as every suite settled; no `SETTLED no list:` line; an array of folders trusted as a list; and
`--settled` ignored. The implementing job plants its own twins in its real code.
