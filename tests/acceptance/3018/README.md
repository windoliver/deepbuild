# Acceptance tests for #3018: a merge train runs one affected suite for several lane-passed PRs

A blind job wrote these tests before any work on #3018 existed, from issue #3018 (its Change section and its five
acceptance criteria), AGENTS.md (Proof), `docs/technical-design.md` (Dogfooding; Tests written first) and
`docs/parallel-proof.md` sections 6 (Scheduling) and 6a (Merge trains), at base commit `b8056599c`, where there is no
`scripts/train.mjs` and `affected.mjs` has no `--results`. It read `scripts/affected.mjs`, `scripts/throttle.mjs` and
`scripts/lanes.mjs` there only to learn the surfaces it drives, and reuses #1115's sandbox and scratch tree (imported,
not edited). The implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of
this job.

## The setup (`helpers.mjs`)

- **A checkout and its origin.** Each test builds a scratch git repository with #1115's `tree()`: a copy of this
  checkout's `scripts/` (the lint lane's own scripts stubbed), links to `node_modules`, a known-failures file, and a
  cargo stub on PATH that reports no crate, so nothing builds. Its `main` holds two tiny packages, `packages/alpha`
  and `packages/beta`, each one `lib/index.mjs` and one `node --test` file that imports it (`lib/`, not `src/`, so no
  `npm run build` starts). Its `origin` is a bare repository of the sandbox's. The checkout is on `main` at origin's
  `refs/heads/main`, clean, with a fixture identity in its own git config. PRs are commits made in another clone and
  pushed as origin's `refs/pull/<n>/head`; main moves by a push to `refs/heads/main` from that clone.
- **A recording shim before `scripts/affected.mjs`**, committed on the fixture's `main`, as #2574 puts one before
  `throttle.mjs`: each `node scripts/affected.mjs` command line is noted with the checkout's branch, commit and tree,
  then the real script (`affected-real.mjs`, this checkout's file) runs with the same arguments. The shim passes on the
  real script's exports. A command line with `--list` prints a selection and runs nothing, so it isn't counted as a run.
- **Planted tests** note each time they start, with the tree of the checkout they ran in and what their lib returned.
- **A table, a HOME and a TMPDIR of the test's own.** `DEEP_THROTTLE_TABLE` is a folder of the sandbox's, read because
  the run descends from this `node --test`; its `log` is where the tests count grants. HOME is the sandbox's, so
  `~/.deepbuild/trains/` is the test's.
- **The record** is found by the run's `RECORD` line: the first `.json` path on it. It must be
  `<sandbox HOME>/.deepbuild/trains/<its own "tree">.json`.
- **Per-PR lines** are read as `<STATE> #<n> <head>[: <why>]`, the last such line for each PR. A commit in a line may be
  whole or short (7 or more characters): it must be the start of the commit it stands for.

## What each file proves

- `one-run.test.mjs`, **`#3018.d8181ce1`**: `train.mjs 11@<head> 12@<head>`, #11 changing alpha's lib and #12 beta's.
  One `affected.mjs` run, on the tree of the two PRs merged onto main (made independently in the other clone), given
  exactly the two changed paths; each package's test ran once, on that tree; the table's log holds one `granted`
  event, a top-level `test` grant, and no other. The record's `main` is origin's main, its `prs` are both PRs with
  their heads in train order, its `tree` the train's, its `files` exactly the two test files, each `PASS`, alpha's
  naming #11 and beta's #12, and its `state` `PASS`.
- `conflict.test.mjs`, **`#3018.3731c052`**: #21 and #22 rewrite the same lines of alpha's lib. One line reads
  `BLOCKED train: #22 doesn't merge after <something naming 21>: conflict in <paths with alpha's lib>`, the exit is 3,
  no planted test ran, no `affected.mjs` ran, no grant was taken, there is no `RECORD` line and no file under
  `~/.deepbuild/trains/`, and the checkout's branch, commit, status and `train/*` branches are as before.
- `failing-file.test.mjs`, **`#3018.ccecaf52`**: #31 changes beta's lib and stays sound; #32, second in the train,
  breaks alpha's. The record reads alpha's test `FAIL` naming only #32, beta's `PASS` naming only #31, state `FAIL`.
  The run's last lines and `train.mjs --read <record>` both read `FAIL #32 <head>: <alpha's test, not beta's>` and
  `INCONCLUSIVE #31 <head>: the train read FAIL`, one line for each PR, and `--read` exits 1.
- `stale.test.mjs`, **`#3018.e7f2db4e`**, two tests, each on a green two-PR train whose `--read` first prints `PASS`
  for both PRs and exits 0, so an always-INCONCLUSIVE reading fails too. After a push to origin's main, `--read` prints
  `INCONCLUSIVE #<n> <head>: main moved from <old> to <new>` for both PRs. After a new commit is pushed as #44's head,
  it prints `INCONCLUSIVE #<n> <head>: #44's head moved from <old> to <new>` for #44 and for #43 (the design: one PR's
  new head leaves none of them proven). Either way no line starts `PASS` or `NO NEW FAILURES`, and the exit is 2.
- `one-pr.test.mjs`, **`#3018.b346cfaa`**: one PR whose four files read four ways: alpha's test passes, beta's fails
  anew, a test that fails on main too (listed in the fixture's `known-failures.json`) and a file at a path of the real
  `timed` list, left unrun without `--timed`. First the PR's own run: its head (a child of the main commit) checked
  out, `node scripts/affected.mjs --results=<file>` with no path, so the change is the worktree against origin/main.
  Its results file must read `PASS`, `FAIL`, `KNOWN` and `INCONCLUSIVE` for the four files and `FAIL` as its state
  (section 6a, "Each file's result"). Then, back on main, `train.mjs 51@<head>`: the record's `main` is the same main
  commit, its one PR is #51 at that head, and its files' states and its state equal the own run's.

## Readings taken where the issue and the design leave room

- **The record's folder** is read as HOME's `~/.deepbuild/trains/`, as `lanes.mjs` keeps `~/.deepbuild/lanes/`.
  Section 6 makes the throttle's table an exception (the password database's home); 6a states none for the record.
- **The `RECORD` line's wording** isn't given, only that it names the record; the tests take the first `.json` path.
- **"Runs one `affected.mjs`"** is counted on command lines that run something. The design says a file's `prs` come
  from "`affected.mjs`'s selection over the paths its merge changed" without saying how the train asks for it, so
  `--list` command lines, and an import of the script, are left free.
- **A PR number's type** in the record (`"number"`, `"prs": [<number>]`) is compared as a number, whether it is written
  as one or as a string.
- **`<what was merged before it>`** has no stated wording; the test asks only that it names 21.
- **The train run's own exit status** isn't stated for a train that merges (only `--read`'s is), so it isn't asserted;
  the conflict's exit 3 is.

## Not tested here

- The pinned-head check at the start (`BLOCKED train: #<n>'s head is <sha>, not <the pinned sha>`), a dirty checkout,
  `--wide`, `--timed` and `--slow` being passed on, crates (`cargo test -p <name>` entries), the record's `host` and
  `platform`, `NO NEW FAILURES` trains, `: origin can't be read`, a record left by a run with no grant (`files` empty,
  `INCONCLUSIVE`), and the checkout going back with its `train/<12 characters>` branch deleted after a run: the design
  names them, no criterion does. The conflict test does check the checkout is untouched.
- That the merges are "made in git's object store", and that nothing is pushed: internals, or an absence the criteria
  don't name.
- "Builds once" and the 45 GiB a run saves: the fixture builds nothing. One build follows from the one run counted.
- Merging itself (`gh pr merge --match-head-commit`): the owner's step, outside the script.
- **Runs on: Mac and Spark.** The suite is written for both; this job ran it on the Mac only.

## Run

```sh
npm ci --ignore-scripts   # once, if node_modules is missing
node --test --test-reporter=spec tests/acceptance/3018/*.test.mjs
```

It needs git and Node 24, no cargo and no network. Each run is allowed 10 minutes and each test 30; at the base the
whole suite took 29 s at load 181 to 211. The sandbox, with its HOME, table, origin and the runs' logs, is removed
after each test, and only the processes a test started are stopped, by their process group's PID.

`BASE-FAILURE.txt` is the suite's output at the base `b8056599c`, and why each test fails there.
