# Acceptance tests for #1122: remote lanes on the Spark, merged per test with a Mac run of what the Spark can't see (T7)

I drafted these tests blind from these sources:

- issue #1122, as `gh issue view 1122` printed it on 2026-11-22
- `docs/parallel-proof.md`, section 8 (Remote lanes) and sections 3, 4, 6, 10, 10a and 11
- the Dogfooding part of `docs/technical-design.md`
- AGENTS.md
- the base commit `c948b6473`, which has no `scripts/lane-remote.mjs` and whose `mergeRecords` takes the worst state
  of a tree's records whole

At the base I also read `scripts/lanes.mjs`, `scripts/affected.mjs` (`select`), `scripts/proof-runs.mjs` (how the
lanes read tags, twins and a failure at its assertion), and `tests/acceptance/1115/`, `1117/`, `1327/` and `1983/` for
their conventions. The helpers are written here, never imported from another suite. Per AGENTS.md, the implementing
agent doesn't edit these tests. A dispute goes to a blind redraft by this job.

Run them with Node 24:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # once: the storage.ts scene imports the built contracts and evidence packages
node --test 'tests/acceptance/1122/*.test.mjs'
```

They're `*.test.mjs` under `tests/acceptance/`, so the unit lane doesn't pick them up. There are 15 tests in four
files. On the 12-core Mac they were drafted on, at a 1-minute load of 59 to 87, the suite took 259 s
against a throwaway implementation; most of that is one cold build of deep-hook's tests in a scratch workspace
(about 1 GB under the temp folder, removed after the test). No test judges a time. No test needs an idle machine,
and none needs to run alone, so there is no `lane.json`: every test has its own two HOMEs, its own throttle table and
its own scratch repositories, and holds no port.

## Criteria to tests

Each test carries its criterion's tag at the start of its name.

| Criterion | Tests (file) | What they require | Wrong program |
|---|---|---|---|
| `#1122.7d260bb4` A PR's merged unit verdict equals a full Mac run on the same tree | 4 scenes and 1 refusal in `only.test.mjs`, 2 in `merge.test.mjs` | In a scratch worktree, the real unit lane runs whole on this Mac; then the real `lane-remote.mjs --only unit` runs beside the Spark's record of the same tree, and its `<STATE> unit (merged)` line, its exit status and `mergeRecords(tree)` read the full run's state: a tree that passes; a bug in a darwin-only branch; a failing test the Spark skipped; a failing test only the Spark ran. The `--only` run ran the test reaching a `process.platform` source and the test of the skipped row, and no other. With no fetched record it runs nothing: `BLOCKED lane-remote`, exit 3. On planted records: a row that ran stands over a `skipped` row of the same ID; a lane with only a Spark record is INCONCLUSIVE | The base (no script; a merge of whole records). Twins `only-skipped-rows`, `only-platform-sources`, `skipped-row-stands`, `spark-alone-passes` |
| `#1122.b0863068` A planted bug in the darwin-only branch of `packages/record/src/storage.ts`, and one in deep-hook's macOS `args_of`, each make the merged verdict FAIL | 2 in `planted.test.mjs` | The real `packages/record` with its own tests, and the real `crates/deep-hook` with its own tests, each in a scratch worktree. Before the plant the full Mac run doesn't FAIL and the merged verdict is its state. With the plant, uncommitted, `--only unit` runs the component's tests on the Mac, one fails, and the run ends `FAIL unit (merged)`, exit 1, with `mergeRecords(tree)` FAIL | The two planted bugs themselves; the base; twin `only-skipped-rows` |
| `#1122.e6c3b0b8` A Spark FAIL plus a Mac pass of the same test id merges to FAIL | 1 in `merge.test.mjs`, 1 in `only.test.mjs` | Planted records: the Spark's FAIL of an ID and the Mac's `--only` pass of it merge to FAIL, naming `unit`. And for real: a bug in the branch only Linux runs, the Spark's record FAILing that test, the real `--only unit` passing it on the Mac (its record says so), ending `FAIL unit (merged)`, exit 1 | Twin `mac-pass-wins` (here, as a file); the base for the `--only` test |
| `#1122.821346f6` A Spark lint record never counts as the lint verdict | 2 in `merge.test.mjs` | A Spark lint FAIL beside the Mac's lint PASS leaves the tree PASS, and the Mac's lint FAIL beside a Spark lint PASS reads FAIL naming `lint`. A Spark lint PASS with no Mac lint record leaves the tree INCONCLUSIVE, naming `lint`, though its unit lane is whole | The base (both); twin `spark-lint-counts` |
| `#1122.51c750de` An untracked tagged test in the session worktree runs on the Spark | 1 in `ship.test.mjs` | A session worktree with an uncommitted edit, an untracked test whose name carries a tag, and an ignored file. The real `lane-remote.mjs --host <host> unit` exits 0 and prints `PASS unit on <host>` and `RECORD <path>`; the fetched record, `~/.deepbuild/lanes/<tree>-unit-<host>.json` on the session's machine, names the tree on the session's disk and holds the untracked test's row, PASS and not skipped; the test noted its run in the far machine's HOME, from a folder under its `~/deepbuild/.claude/worktrees/`, and not on the session's machine; the ignored file was not shipped | The base; twin `tracked-only` |
| `#1122.394befd9` A shipped merge base that differs from the one the Spark computes refuses the run, naming both | 1 in `ship.test.mjs` | A true shipment runs, and its record's `recipe` names the merge base and the commit. Then the far end is started again in the session's far worktree with the same manifest but for `base`, a commit beside the change: it prints `BLOCKED lane-remote: the merge base shipped is <shipped>; <host> computes <computed>` with both hashes, exits 3, prints no `RECORD` line, runs no test and writes no record | The base; twin `trusted-base` |

`twins.json` names each twin, and `twins/README.md` says which is here and which the implementing job plants.

## The surfaces (my choice where the design leaves it open)

Every surface is one the issue or section 8 names. The tests start processes and read files; they import nothing of
the code under test, so a missing script or export reads as a failed assertion.

- **The near end**: `node scripts/lane-remote.mjs --host <host> unit` in a session's worktree. Read: its exit status,
  the last line `<STATE> unit on <host>`, the last line `RECORD <path>`, and the file that names.
- **The far end**: `node scripts/lane-remote.mjs unit` in the far worktree, the manifest on stdin as one JSON object
  (`commit`, `base`, `tree`, `bundle`, `untracked`, `from`). Read: its exit status and its lines.
- **The Mac's run**: `node scripts/lane-remote.mjs --only unit`. Read: its exit status, its last line
  `<STATE> unit (merged)`, the Mac's record `<tree>-unit.json` and its `only`.
- **The merge**: `mergeRecords(tree)` of `scripts/lanes.mjs`, called in a child process with the sandbox's HOME. Read:
  `state`, and `lanes` as the names of the lanes holding that state (as #1983's tests read it at the base).
- **Records**: `~/.deepbuild/lanes/<tree>-<lane>.json` for a machine's own run and `<tree>-<lane>-<host>.json` for a
  fetched one, with #1115's fields (`lane`, `state`, `host`, `platform`, `tree`, `tests` as `{ id, state, note,
  skipped }`) and section 8's `bundle`, `recipe` and `only`. A planted Mac record has a `platform` of `darwin-arm64`;
  a planted Spark record `linux-arm64`, the host `spark`.
- **`only`** is read as every string it holds, however it groups files and crates: a test file's repository path, and
  for a crate a string that holds its name.
- **A full Mac run** is the real unit lane of the tree's `lanes.mjs` through the real `runLanes`, by a small driver, as
  #1115's tests reach it.
- **Exit statuses**: 0 PASS, 1 FAIL, 2 INCONCLUSIVE, 3 BLOCKED or INVALID, as section 8 gives them.

### The far machine

The network is the one boundary stood in for. `ssh` and `scp`, first on the session's PATH, run the command they are
given on this machine: as `/bin/sh -c` on the joined arguments, in the far machine's HOME (a second temporary folder),
with a fresh environment holding only `HOME`, `PATH`, `USER`, `LOGNAME`, `SHELL`, `LANG` and `TMPDIR`. A `git push`
to `<host>:<path>` goes through that `ssh`, as git starts it, and so does an `rsync`. A host other than the test's
(`far-1122`) is unknown and exits 255. So the far end really runs: it is a second process tree with its own HOME, its
own `~/.deepbuild` and its own throttle table. `sftp` is not stood in for.

What this assumes of the implementation: it reaches the other machine only through `ssh`, `scp`, `rsync` or `git`
found on PATH, with `<host>` as given; and the far machine's `~` is its HOME. The far PATH here holds `node`, `git`
and the two stand-ins below. The real Spark's non-interactive shell has no `node` on PATH (see What stays unproven).

Two more stand-ins, on both machines' PATH, each at a boundary this repository doesn't own:

- `npm`: `npm ci` (the registry) links this checkout's installed packages into `node_modules/`; any other call, as a
  package build, does nothing. Each call is logged.
- `cargo`, in the scenes with no crate: `metadata` reports no crates and every other call does nothing, as #1115's
  tests do. The deep-hook scene runs the real cargo, with the person's `CARGO_HOME` and `RUSTUP_HOME`.

Both machines here have one name, this machine's, so a fetched record's `<host>` is this machine's name. The far
record's `platform` is this machine's too, which is why no test merges a record fetched through the stand-in: the
merge tests plant the Spark's record with a Linux `platform`.

### The scratch repositories

A session's worktree is a fresh repository under the temp folder holding a copy of this checkout's `scripts/`, an empty
`known-failures.json`, a `package.json` and lock (the far end installs by its lock), a vitest config with the repo's
include written out, a folder of links to `node_modules` (ignored, so never shipped), and one passing test for each
runner command of the unit lane. `main` holds one commit, which `refs/remotes/origin/main` names; the branch
`change` holds a second, so the merge base is the first and never `HEAD`. Each test gets two HOMEs with a git
identity each, and `GIT_*`, `DEEP_THROTTLE*`, `DEEP_BIN_DIR`, `CARGO_TARGET_DIR` and the proof variables are unset.
Each process a test starts gets its own process group, and the test stops that group by its PID when it ends.

A fixture test notes its run by appending its name and folder to `.ran-1122` in its machine's HOME. That is how a
test tells what ran, and on which machine, apart from what a record says.

The planted-bug scenes copy real components from this checkout's disk: `packages/record` (with its built
`dist/versions.json`) and `packages/contracts/fixtures`, which its tests read; or `crates/deep-hook`,
`crates/deep-contracts`, the two `adapters/*.facts.json` files deep-hook includes, `rust-toolchain.toml`, and the
root `Cargo.toml` with its `members` cut to those two crates and the lock as `cargo metadata --offline` then cuts it.

### The Spark's record in the `--only` scenes

No Linux machine runs in these tests. In `only.test.mjs` and `planted.test.mjs` the Spark's record of a tree is
written by the test, from the full Mac run's own rows of the same tree: the test only a Mac with Metal runs is marked
`skipped` with its note, and a row a Linux run reads otherwise is given that state (PASS for the test of a darwin-only
bug; FAIL for the test of a Linux-only bug). In the planted-bug scenes the rows are the unplanted tree's, since a Linux
run never reaches the planted branch. The record is planted as fetched: `<tree>-unit-spark.json`, host `spark`,
platform `linux-arm64`.

## Assumptions, where the design is silent

1. **The merged line's state is the lane's merged state**, and `mergeRecords(tree).state` equals it in a tree whose
   only records are that lane's. Section 8 says `--only` "ends with the merged line, `<STATE> <lane> (merged)`".
2. **`mergeRecords(tree)` keeps the shape #1983 reads**, `{ state, lanes }`, `lanes` naming the lanes that hold the
   tree's state. Section 8 names no shape.
3. **The far end can be started again** in the worktree a shipment left, with that shipment's manifest on stdin, and
   gets as far as its merge-base check. Section 8: "The same script, started in that worktree with the lane's name and
   no `--host`, is the far end". The refusal test builds its manifest from the true shipment's `recipe` ("`recipe`,
   the manifest") and the record's `tree`.
4. **`<host>` in the refusal line is the far machine's own name** (`os.hostname()` there), as a record's `host` is.
   Section 8 writes `<host> computes <computed>` and names no source for it.
5. **A fetched record keeps its rows as the far lane wrote them**, so the untracked test's row has the ID
   `<path> › <test name>` and no `skipped`.
6. **The session's far worktree is the one folder** under the far `~/deepbuild/.claude/worktrees/` after a first
   shipment; its `<name>` is not read.
7. **A Mac's `--only` record needs no row for a test it didn't run**: the row the Spark ran stands alone. Section 8:
   "A row that ran stands over a `skipped` row of the same ID, and among the rows that ran the worst state stands."
8. **`--only` runs the narrowed tests and no other**: of the three fixture tests, the one reaching neither a
   platform-branching source nor a skipped row doesn't run. Section 8: "runs the lane's own test commands narrowed
   to those tests".
9. **A source that "reads `process.platform`"** is one whose text holds `process.platform`; the fixture's is
   `process.platform === 'darwin'`.

## What stays unproven here

- **Criterion 1 on the real repository.** No test compares a merged verdict with a full Mac run of deepbuild's own
  tree. A whole unit lane takes hours on either machine and can't build today (#3100), and the Spark has under 9 GB
  free. The scenes compare the two on trees small enough to run. What remains is the issue's Proof: one PR's lanes run
  both ways, by hand, with both records.
- **A real Spark.** No test opens a connection. The far end runs on this machine, on macOS when the suite runs on a
  Mac. So nothing here shows that the Spark's non-interactive shell finds `node` and `cargo` (it finds neither
  today without a login shell and `~/.cargo/env`), that `git push` reaches the far worktree over the network, that a
  real `npm ci` and package build run under the Spark's `build` grants, that the far worktree borrows `~/deepbuild`'s
  objects, or that the lane runs into a Spark bay pair. Every Spark record the merge reads is planted.
- **The two planted bugs on the real repository.** The scenes carry the real component and its own tests, not the
  whole repository: which of the repository's other tests reach `storage.ts` or deep-hook, and whether `--only` selects
  them there, is not seen. In the deep-hook scene the rows that fail are the crate's own
  `a_print_mode_agents_waiter_exits_at_once` and `a_print_runs_waiter_under_its_entrys_shell_exits_at_once`.
- **A tree check.** The far end's refusal of a tree that isn't the manifest's is in section 8 and in no criterion; no
  test plants one.
- **Crates the Spark skipped, wide tests, platform-branching helpers.** The fixture has one platform-branching source
  reached by import. `cargo test -p` for a crate a skipped row names, a wide test, and a helper that branches are not
  planted.
- **The near end's verdict by the record, not the far end's word.** The near end's exit statuses 1, 2 and 3 by the
  fetched record's state, and a run that brings no record back, are in section 8 and invariant 1 and in no
  criterion. A near end that reads the far end's exit status instead passes every test here (`BASE-FAILURE.txt`,
  `summary-trusted`).
- **A busy Mac.** The planted-bug scenes run each component's own real tests, and deep-hook's time a hub's answers.
  When the unit lane already FAILs before the plant, the test skips with a note starting `INCONCLUSIVE` that names the
  failing tests, since the plant could then be shown to change nothing. That happened once while drafting, at a load
  of 34 to 46; the deep-hook scene now runs the crate's tests one at a time (`RUST_TEST_THREADS=1`).
- **Linux.** On a machine that isn't a Mac the `--only` and planted-bug tests skip with a note starting
  `INCONCLUSIVE`, since `--only` is the Mac's run; the merge and shipping tests run anywhere, and were run only on a
  Mac.

## Where the criteria and the design disagree

Criterion 1 says the merged verdict equals a full Mac run. Criterion 3 says a Spark FAIL beside a Mac pass of the
same test ID merges to FAIL. A bug in a branch only Linux runs gives exactly that: the full Mac run of the tree is
PASS and the merge is FAIL. `only.test.mjs`'s `#1122.e6c3b0b8` test is that tree, and it holds criterion 3. So
criterion 1 can hold only for trees with no failure that is the Spark's alone, and its four scenes are such trees.

## How I checked the tests can pass

No implementation was written into the repository. To tell a test bug from a real failure, I wrote a throwaway
`lane-remote.mjs` and `mergeRecords` in this job's scratch folder, ran this suite against a copy of the checkout
holding them (15 of 15 passed), and planted each fault of `twins/README.md` in them. `BASE-FAILURE.txt` lists each
fault and the tests it failed. The throwaway isn't kept, isn't the program under test and proves nothing about the
real change. The one twin kept as a file, `mac-pass-wins`, holds only the faulty merge.

## Files

- `helpers.mjs`: the sandbox and its stand-ins, the scratch worktrees, the full-run driver, records and the merge.
- `merge.test.mjs`: how records merge, on planted records. Runs anywhere.
- `ship.test.mjs`: the near end, the far end and the fetched record, through the stand-in `ssh`. Runs anywhere.
- `only.test.mjs`: the Mac's `--only` run and the merged verdict beside a full Mac run. Mac only.
- `planted.test.mjs`: the issue's two planted bugs on the real components. Mac only; the deep-hook scene needs cargo
  and 5 GB free under the temp folder, and skips with a note starting `BLOCKED` or `INCONCLUSIVE` without them.
- `twins.json`, `twins/`: the planted wrong programs.
- `BASE-FAILURE.txt`: the run on the base and the planted wrong programs, with paths shortened.

No fixture holds a secret or personal data. Issue 9122 is made up.
