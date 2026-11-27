# Acceptance tests for #3593: a settled suite is left to the main watch however the change reaches it

A blind job wrote these tests before any work on #3593 existed, from three inputs:

- issue #3593, as saved for this job: its Change and its acceptance criteria. Its fifth line, "Reading, not a
  criterion", has no test.
- the design: `docs/parallel-proof.md` sections 7a and 12b, `docs/technical-design.md` (Dogfooding, "Built to be hard
  to get wrong") and AGENTS.md.
- the base commit `5f95d82bb`, where #3064's rule holds: `affected.mjs` leaves a settled suite only when the change
  reaches each of its files through a process the suite starts. There I read `scripts/affected.mjs`,
  `scripts/main-watch.mjs`, `scripts/proof-runs.mjs` (how the before lane lays twins) and `tests/acceptance/3064/`.

Per AGENTS.md the implementing agent doesn't edit these files; a dispute goes to a blind redraft by this job.

## How to run

```sh
node --test tests/acceptance/3593/*.test.mjs
```

12 tests in 5 files, all offline. They need git, Node 24 and this checkout's `npm ci` (`affected.mjs` imports
`typescript`), and no package or cargo build. Every test sets #3064's limit of 45 minutes; nothing sleeps or is
timed. On a Mac at a load of about 30 on 12 cores each file took 6 to 23 s, run alone (`BASE-FAILURE.txt`).

## What is reused

The sandbox, the stand-ins (`gh`, `deep`, `cargo`), the fixture repository, the settled list's reader and writer,
the watched repository and the output readers are #3064's: `helpers.mjs` here re-exports
`tests/acceptance/3064/helpers.mjs` and imports nothing else of the code under test. Read that suite's README for the
sandbox (its own `HOME` and `TMPDIR`, `DEEP_*`/`GH_*`/`CLAUDE*` unset, each process stopped by its process group's
PID) and the stand-ins. Nothing under `tests/acceptance/3064/` is edited.

## The surfaces

Only what the issue and the design name:

- **`node scripts/affected.mjs --list <path …>`** and **`node scripts/affected.mjs <path …>`** in a fixture
  repository holding this checkout's `scripts/`, so a planted `affected.mjs` in the checkout is the one that runs.
  Paths stand for the change; with none, the change is the worktree against its merge base with `origin/main`, and its
  commit messages are those of the commits since that base.
- **Its stdout**: the selection's lines (`parallel node: <file> …`), the one line `SETTLED <n> …` with the count of
  suites left and their folders, the one line `SETTLED no list: …`, and the summary `<STATE> affected: …` with the exit
  status (2 for INCONCLUSIVE). A `SETTLED <n>` line names a suite when it holds `tests/acceptance/<issue>`.
- **`$HOME/.deepbuild/main-watch/settled.json`** in the sandbox's `HOME`, in the design's shape
  `{ "tree": …, "suites": { "tests/acceptance/<issue>/": "<git's ID of the folder>" } }`. The tests write it, except in
  `watch.test.mjs`, where the real `scripts/main-watch.mjs tick` writes it.
- **Whether a fixture test ran**: each notes its run, and whether it passed, in the sandbox's events file.

## The fixture repository (`importFixture()` in `helpers.mjs`)

#3064's fixture (`fixture()`: a git repository on `main` with `origin/main` at its one commit, a workspace package
`packages/a`, the near test, `node_modules` linked), with these files:

- `tests/acceptance/90001/started.test.mjs` and `90002/started.test.mjs`: each one test that imports
  `packages/a/src/util.mjs` itself and calls its `shout`, with no process between (`imported()`). That import is the
  only way they reach package a.
- `tests/acceptance/90003/started.test.mjs`: #3064's suite, which starts package a's build.
- `packages/a/greeting.txt`, which `imported(…, { reads: true })` also reads by path.
- `packages/a/test/util.test.mjs`, package a's own test, outside `tests/acceptance/`, which imports `util.mjs`.

**The change** is `packages/a/src/util.mjs` unless a test says otherwise. At the base, with or without a list, it
selects `90001`'s, `90002`'s and the package's own test file.

## The watch's scene (`watch.test.mjs`)

#3064's watched repository with two suites, each one test that imports `packages/a/src/main.mjs` itself:
`tests/acceptance/90021/`, whose issue the `gh` stand-in has closed as completed, and `90023/`, whose issue is open.
The scene ticks the real watch once on the first commit and nine times more with five landings before each, ten runs
of main's head, then runs `affected.mjs --list packages/a/src/main.mjs` in the clone the tests land in, with the list
the tenth run wrote.

## What each file proves

| Criterion | ID | Test | What it asserts |
|---|---|---|---|
| 1 | `#3593.419d4752` | `settled.test.mjs`, `--list` | With a list naming `90001/`, `--list` of the change prints one `SETTLED 1 …` line naming `90001/`, its file is in no block, `90002/` (off the list) is not named, and `90002`'s file and package a's own test are selected as today |
| 1 | `#3593.419d4752` | `settled.test.mjs`, a run | The run prints the line, `90001`'s test doesn't run, `90002`'s runs and passes, the summary reads `INCONCLUSIVE affected:` and the exit is 2 |
| 2 | `#3593.0f5c9115` | `runs.test.mjs`, names S's issue | The change is a commit over `origin/main` editing `util.mjs` whose message says `Part of #90001`: `90001` runs. With `Closes #90001`, `--list` selects it. With no issue named, `--list` leaves it on the SETTLED line |
| 2 | `#3593.0f5c9115` | `runs.test.mjs`, edits a file under S | The change's paths hold `util.mjs` and `tests/acceptance/90001/started.test.mjs`: `90001` runs |
| 2 | `#3593.0f5c9115` | `runs.test.mjs`, adds a file under S | The change's paths hold `util.mjs` and `tests/acceptance/90001/added.test.mjs`, a file added under S, with the list naming S's folder as it is with that file: both of S's files run |
| 2 | `#3593.0f5c9115` | `runs.test.mjs`, edits a file S reads by path | S's test also reads `packages/a/greeting.txt` by path; the change's paths hold `util.mjs` and `greeting.txt`: `90001` runs |
| 3 | `#3593.24d41793` | `not-settled.test.mjs`, off the list | The list names `90002/` only; `90001`, reached by the same import, runs and is on no SETTLED line |
| 3 | `#3593.24d41793` | `not-settled.test.mjs`, folder differs | The list names `90001/` by its folder's ID at one commit, a later commit on main edits its test file, and a run of the change runs `90001` |
| 3 | `#3593.24d41793` | `watch.test.mjs`, an open issue | After ten clean runs the watch's list holds `90021/` and not `90023/`, and with that list `--list` selects `90023`'s file and names it on no SETTLED line |
| 4 | `#3593.5d85614a` | `no-list.test.mjs`, no list | No `settled.json`: `90001` and `90002` are selected and run, package a's own test is selected, no `SETTLED <n>` line names a suite, and one `SETTLED no list: …` line names `main-watch/settled.json` |
| 4 | `#3593.5d85614a` | `no-list.test.mjs`, a list cut short | The same with the first 60 bytes of a list naming all three suites |
| 4 | `#3593.5d85614a` | `no-list.test.mjs`, another shape | The same with a JSON array of the three folders |

Every criterion 2 and criterion 3 test also holds a second suite reached only by the same import, on the list and
none of the cases (`90002/` or, in the watch's scene, `90021/`). It must be left on a `SETTLED 1 …` line and not run.
That shows the wider rule was in force when S ran, and it is what fails those tests on the base, where #3064's
own-package exception runs every suite whose test imports the changed package.

Each test fails at an assertion of its own, on what the program printed, wrote or ran; none asserts that the program
throws. The messages name the suite, or start with the case:

- criterion 1, a selection that runs S: `… no "SETTLED <n> …" line names it: it is still selected` (`… : it ran` in a
  run); one that drops S without the line: `… : the selection dropped it without the line`; a run that reads PASS:
  `the run left tests/acceptance/90001/ unrun and doesn't read INCONCLUSIVE`. Each names `tests/acceptance/90001/`.
- criterion 2: `names S's issue: …`, `edits a file under S: …`, `adds a file under S: …`, `edits a file S reads by
  path: …`, each with `tests/acceptance/90001/ didn't run`.
- criterion 3: `tests/acceptance/90001/ is off the settled list … and it didn't run: the list admitted it`,
  `tests/acceptance/90001/ holds a file that differs from the listed tree … and it didn't run`, and
  `the list admits tests/acceptance/90023/, whose issue #90023 is open`.
- criterion 4: `no settled list: the selection isn't today's: it lost tests/acceptance/90001/started.test.mjs` (and
  the same for the two lists that can't be read).

## The base, and the twins

`BASE-FAILURE.txt` is each file's output at `5f95d82bb`, trimmed to its results and assertion messages. All 9 tests
of criteria 1 to 3 fail there at an assertion for the expected reason: no SETTLED line names the import-reached suite
(criterion 1), or the import-reached control suite ran (criteria 2 and 3). The 3 tests of criterion 4 pass there, as
they must, since that behavior is unchanged from #3064.

So that every tagged test has a wrong program it fails on, and every case its own, `twins.json` names planted wrong
programs, one fault each. Each is a whole file under `twins/<name>/scripts/`. The `affected.mjs` twins are the base
file with the wider rule written in (in `select`: a suite's tests count as reached with no process between only by a
file they or their helpers read by path, and #3064's own-package exception is gone) plus one fault; the job also ran
every test on that file without a fault, and all 12 passed. `any-issue` is the base `main-watch.mjs` with one fault,
laid over the change's `affected.mjs`.

| Twin | Its one fault | Fails |
|---|---|---|
| `no-line` | the settled suites leave the selection with no `SETTLED <n>` line | both criterion 1 tests: `… the selection dropped it without the line` / `… the run dropped it without the line` |
| `reads-pass` | a run that leaves settled suites unrun reads PASS | criterion 1, the run: `… doesn't read INCONCLUSIVE: its summary is "PASS affected: …"` |
| `skips-named` | a change naming the suite's issue no longer runs it | criterion 2, names S's issue |
| `skips-edited` | a change adding or editing a file under the suite no longer runs it | criterion 2, edits a file under S and adds a file under S |
| `skips-read` | a change to a file a test of the suite reads by path no longer runs it | criterion 2, edits a file S reads by path |
| `admits-off-list` | a reached suite the list doesn't hold is settled too | criterion 3, off the list |
| `ignores-folder` | the listed folder ID isn't compared with the folder on disk | criterion 3, folder differs |
| `any-issue` | `main-watch.mjs` lists a suite with 10 clean runs whatever its issue's state | criterion 3, an open issue: `the list admits tests/acceptance/90023/, whose issue #90023 is open` |
| `missing-is-settled` | with no list, or one that can't be read, every reached suite is settled | all three criterion 4 tests |

Each twin was run by laying it over a copy of this checkout and running its tag's test file; each failed only the
tests in its row, each at the assertion quoted above, and passed the rest of that file.

The twins are whole files, as the job was asked and as #3064's are, so they do not depend on the lines the
implementing change writes. `scripts/twins-lint.mjs` (#1832) lists whole-file twins; it is in no lane's checks at the
base, where it lists about 670 of them. The implementing job may convert these to `lines.json` against its own lines.

## Where the issue leaves a choice, and how I read it

- **"Imports directly (no process between)" (criterion 1).** A suite whose test imports a package source file with a
  static `import`, and nothing else; the change is that file. A suite that also starts the build would be reached by
  both, which proves no more.
- **"Adds or edits a file under S" (criterion 2).** Two tests. The edit is named among the change's paths with the
  disk as the list has it, as #3064's test does, so the folder's ID can't be the reason. The add is a new test file
  committed under S, with the list naming S's folder as it is with that file, for the same reason.
- **"Reads by path" (criterion 2).** A file of the changed package read with `readFileSync(new URL(…))`; the change's
  paths hold both it and the imported file, so the suite is reached by import too and only the read can keep it.
- **"A suite of an open issue" (criterion 3).** `affected.mjs` reads no issue state: the design keeps an open issue's
  suite off the list in the watch (12b). So the case is proved on the real watch, as #3064's is, with the suites
  reached by import, and the planted list is a watch that admits any issue's suite.
- **"A planted list that admits each" (criterion 3).** For the off-list and folder cases, an `affected.mjs` that
  settles a suite the list doesn't hold, or holds with another folder ID.
- **"Own package" (Change).** Not a criterion of its own. It is criterion 1's case: the suite's test imports a file of
  the changed package itself, so #3064's own-package exception is what the base applies and the change removes. The
  package's own test outside `tests/acceptance/` is asserted selected in criterion 1's `--list` test and criterion 4's.

Not tested, since no criterion names it: `--settled` with an import-reached suite, a Rust binary's crate imported by
nothing (reach by process is #3064's and unchanged), and the docs line in 7a.
