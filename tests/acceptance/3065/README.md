# Acceptance tests for #3065: a reading of how many selected tests really run the changed binary or file

A blind job wrote these tests before any work on #3065 existed, from issue #3065 (its Change and its four acceptance
criteria), its checkpoint #2673 (the three fixture changes), AGENTS.md (Proof), the design's "How we know version 0
works" and `docs/parallel-proof.md` sections 5 ("Binaries for tests") and 7a, at base commit `c7dc0edc3`. It read
`scripts/affected.mjs` (`--list`), `scripts/lanes.mjs` (the unit lane's commands), `scripts/proof-binaries.mjs`,
`scripts/proof-reporter.mjs`, `scripts/proof-vitest-reporter.mjs`, `scripts/proof-runs.mjs` and
`scripts/proof-change.mjs` there only to learn the surfaces it drives, and reuses #1115's scratch tree and #2820's
sandbox (imported, not edited). `scripts/reach.mjs` does not exist at the base. The implementing agent does not edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

## The setup (`helpers.mjs`)

- **A fixture repository.** #1115's `tree()`: a scratch git repository with a copy of this checkout's `scripts/` (the
  lint lane's own scripts stubbed), links to `node_modules`, a vitest config, a known-failures file and one passing
  file per command of the unit lane; committed, so the checkout is clean. `/target` is ignored.
- **A small Cargo workspace**, with no dependencies and a `Cargo.lock` made by `cargo generate-lockfile --offline`, so
  it builds offline in seconds: the bin crate `deep-hook`, and the canvas crate `deep-canvas`, a library whose own
  binary is `deep-show`.
- **A hub**, as far as a selection needs one: `packages/hub/src/core.mjs`, `cli.mjs`, which imports it, and three
  files `only-unrun.mjs`, `only-skipped.mjs`, `only-killed.mjs`, each named by one planted test alone. And a design doc,
  `docs/technical-design.md`.
- **Planted tests**, all `node --test` files the unit lane's node command reads (`tests/*.test.mjs`) but one:

  | File | What it does | In the record |
  |---|---|---|
  | `tests/fixture-3065-hook-named.test.mjs` | imports `tests/fixture-3065/hook.mjs`, which names `deep-hook` and can start it from `DEEP_BIN_DIR`; never starts it | a row, no binary |
  | `tests/fixture-3065-hook-started.test.mjs` | its twin: starts `deep-hook` through the helper | a row with `deep-hook` |
  | `tests/fixture-3065-hook-target.test.mjs` | runs `cargo build --locked --bin deep-hook`, then starts `target/debug/deep-hook` | a row with `deep-hook` |
  | `tests/fixture-3065-hub-loaded.test.mjs` | imports `core.mjs` through a helper | a row with `packages/hub/src/core.mjs` |
  | `tests/fixture-3065-hub-child.test.mjs` | starts `node packages/hub/src/cli.mjs`, which loads `core.mjs` | a row with both files |
  | `tests/fixture-3065-hub-named.test.mjs` | names `packages/hub/src/core.mjs` in a literal; loads nothing | a row without it |
  | `tests/fixture-3065-canvas-started.test.mjs` | starts `deep-show` through `tests/fixture-3065/show.mjs` | a row with `deep-show` |
  | `tests/fixture-3065-canvas-named.test.mjs` | imports that helper; never starts it | a row, no binary |
  | `tests/fixture-3065/unrun.test.mjs` | names `core.mjs`, `only-unrun.mjs` and `deep-show`; a folder deeper than the unit lane's node command reads, so it never runs | no row |
  | `tests/fixture-3065-skipped.test.mjs` | names `core.mjs` and `only-skipped.mjs`; its only test is skipped | no row |
  | `tests/fixture-3065-killed.test.mjs` | names `core.mjs` and `only-killed.mjs`; its test sends its own process SIGKILL | no row |

  The unit lane of the fixture, run as it is at the base, took 5 s here: it ends FAIL on the killed file and lists the
  skipped one INCONCLUSIVE, as main's own unit lane ends on its known failures.
- **A HOME of its own**, the sandbox's, so `~/.deepbuild/reach/` is the test's and the machine's is never read or
  written; **a throttle table of its own** (`DEEP_THROTTLE_TABLE`); **real cargo**, with a `CARGO_HOME` of the
  sandbox's (#2820's sandbox). The sandbox is removed after each test file, and only the processes a test started are
  stopped, by their process group's PID.
- **One recording per test file.** Each of the two test files builds the fixture once and runs
  `node scripts/reach.mjs record` in it once; every test of the file reads that run's record. The tree is not touched
  between the recording and a `compare`.
- **Planted values.** Three tokens made for the run: one in the sources the tests load (`core.mjs`, `cli.mjs`, the
  helpers), one given as an argument to `deep-hook`, `deep-show` and the node process, one as an environment value of
  the recording run (`T3065_ENV`) and of each process a test starts (`T3065_SPAWN`).

## Surfaces this suite assumes

The issue names the record file, `node scripts/reach.mjs compare <path ...>` and `affected.mjs`'s selection. Where it
is silent, the suite takes the smallest surface, and reads it loosely:

1. **The recording is made by `node scripts/reach.mjs record`**, run in the checkout with no argument: it runs that
   checkout's unit lane once and writes the record. The issue names no command; the recording can't be a flag or an
   environment variable of `affected.mjs` or `lanes.mjs`, which this change does not edit. Its exit status is not
   asserted (the fixture's lane fails on the killed file, as main's fails on its known failures); the record must be
   written all the same.
2. **The record is the one `.json` file under `$HOME/.deepbuild/reach/`** after that run. Its name is not checked
   beyond `.json`, nor any field outside the rows.
3. **A test file's row** is found anywhere in the JSON: the value under a key that is the file's path, or an object
   one of whose values is the file's path. The path is the repository's, as `affected.mjs` prints it
   (`tests/fixture-3065-hook-named.test.mjs`), or the same file's absolute path. No field name is assumed. "No row" is
   no such key and no such object; a bare list of names that holds the path is not a row.
4. **A row lists a binary** when a string in it, at any depth, is the binary's name (`deep-hook`) or a path that ends
   in it (`target/debug/deep-hook`). **It lists a file** when a string in it is the file's repository path, or its
   absolute path.
5. **`compare <path>` prints three counts on its standard output, each on the line of its label**: `selected`,
   `reaching` (not after `not`) and `not reaching`, the issue's "selected, recorded as reaching, and recorded as not
   reaching". A count is the whole number directly before its label, with only the words `tests`, `files`,
   `of them`, `recorded`, `as`, `is`, `are`, `was`, `were` between (`6 selected`, `5 recorded as reaching`,
   `1 of them recorded as not reaching`), or directly after it behind `:` or `=` (`selected: 6`). Each label must come
   with one value. Anything else it prints, and its exit status, are not read.
6. **`selected` counts test files**: those `node scripts/affected.mjs --list <path>` prints on its block lines and
   `SKIP` lines. Whether the crate on its `parallel cargo test:` line is counted too the issue leaves open, so both
   are accepted; a counted crate has no row and must then be among those reaching.
7. **A change to a crate reaches a test through the crate's own binary**: the canvas crate `deep-canvas` has its
   binary `deep-show` in the same package. A binary of another crate that depends on the changed one is not tested.

## What each file proves

`record.test.mjs`:

- **`#3065.AC1`** (the pair): the row of `hook-started` lists `deep-hook` and no other workspace binary; the row of
  `hook-named` exists, lists the helper `tests/fixture-3065/hook.mjs` among its files, and lists no workspace binary.
  The wrong program it is meant to catch: *a recorder that reads the helper's source instead of the process*, which
  lists `deep-hook` for every test that imports the helper. It fails on the last assertion, whose message names the
  first test (`tests/fixture-3065-hook-named.test.mjs imports the helper that names deep-hook and never starts it, and
  the record lists deep-hook for it`).
- **`#3065.AC1`** (by path): the row of `hook-target` lists `deep-hook`: the Change's "by path under `target/`".
- **`#3065.AC2`** (three tests, the record's half): no row for the file that didn't run, for the skipped one and for
  the killed one, while `hub-loaded`, which ran, has one. The wrong program: *a recorder that writes an empty row* for
  such a file. Each fails naming the file.
- **`#3065.AC4`**: the record's text holds none of the three planted values (content, argument, environment), while
  the rows that carried them are there (`hook-started` with `deep-hook`, `hub-child` with `core.mjs` and `cli.mjs`,
  `hub-loaded` with `core.mjs`); and every string in the rows of the eight files that ran is a workspace binary
  (surface 4) or a path of a file in the checkout. The criterion names no planted program; a mutant that keeps an
  argument, an environment value or a source line in a row fails it, naming the value's kind.

`compare.test.mjs`:

- **`#3065.AC2`** (three tests, compare's half): `compare packages/hub/src/only-<case>.mjs`, a change that selects
  the one file with no row, prints selected 1, recorded as reaching 1, recorded as not reaching 0. The wrong programs:
  the empty-row recorder (the file would count as not reaching), and a compare that counts a missing row as not
  reaching, or not at all.
- **`#3065.AC3`** (three tests), #2673's three fixture changes, each one path:

  | Change | `--list` selects | selected | reaching | not reaching |
  |---|---|---|---|---|
  | `packages/hub/src/core.mjs` | 6 test files | 6 | 5: `hub-loaded`, `hub-child`, and the three with no row | 1: `hub-named` |
  | `crates/deep-canvas/src/lib.rs` | 3 test files and the crate | 3 (or 4) | 2 (or 3): `canvas-started`, `unrun` (and the crate) | 1: `canvas-named` |
  | `docs/technical-design.md` | nothing | 0 | 0 | 0 |

  Each test first checks that `affected.mjs --list` selects exactly those files in the fixture (true at the base),
  then that selected is that count, that reaching plus not reaching equals selected, and each count. The wrong
  program: *a count that drops the no-row tests*, which prints 2 + 1 of 6 and 1 + 1 of 3; it fails on the sum, naming
  the three counts and the files with no row.

The twins themselves (`twins.json` and the planted files) are the implementing agent's: a twin is a wrong version of
code this job never sees.

## Judgment calls

- **Fixture, not the real tree, for #2673's three changes.** A record of this repository needs a full unit-lane run,
  hours on these machines; the fixture stands the three changes up as one hub source file, one canvas crate and one
  design doc of its own, with `affected.mjs`'s real selection over them.
- **A skipped file** is one whose every test is skipped (here, its only test). A file with some tests skipped and some
  run is not tested.
- **A killed file** kills its own process, by its PID, inside its test, having loaded no repository file but itself.
- **The node process a test starts counts as the test's** (`hub-child`): the Change says "its node processes". It is
  asserted in AC3's hub row (reaching 5 needs it) and as AC4's carrier of the planted argument.
- **AC4's "paths and binary names only"** is held on the rows' strings and, for the three planted values, on the whole
  file. Numbers, booleans and the fields outside the rows (a tree, a host, a date) are not judged.
- **`compare` is given one path a change**; several paths in one call are not tested.

## Not tested here

- The reading itself: one run of the unit lane on main, and what share of selected tests it shows not reaching a
  change. It is a measurement of the real repository, and its outcome decides only whether a follow-up issue is filed.
- That `affected.mjs`'s selection is untouched: this suite reads `--list` as it is; the guard and the diff hold the
  rest.
- vitest files. The fixture's planted tests are `node --test` files; the unit lane's two vitest commands run one
  passing file each.
- The list of selected tests `compare` may print beside its counts.

## Run

```sh
npm ci --ignore-scripts   # once, if node_modules is missing
node --test --test-reporter=spec tests/acceptance/3065/*.test.mjs
```

It needs Node 24, cargo and a Rust toolchain, and works offline. Each file allows its recording run 15 minutes and
each `compare` or `--list` 5. At the base the suite takes a second, since the recording ends at once.

`BASE-FAILURE.txt` is the suite's output at the base `c7dc0edc3`, and why each test fails there.
