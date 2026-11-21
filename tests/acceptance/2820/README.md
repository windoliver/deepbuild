# Acceptance tests for #2820: a run builds its tests' Rust binaries under a build grant before its test grant

A blind job wrote these tests before any fix for #2820 existed, from issue #2820 (its scope and its five acceptance
criteria), AGENTS.md (Proof), and `docs/parallel-proof.md` sections 5 ("Binaries for tests"), 6 (Scheduling) and 7a
(Shards), at base commit `f17fa347c`. It read `scripts/affected.mjs`, `scripts/proof-binaries.mjs`,
`scripts/throttle.mjs` and `scripts/shards.mjs` there only to learn the surfaces it drives, and reuses #1115's sandbox
and scratch tree and #2574's `start` (imported, not edited). The implementing agent does not edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

## The setup (`helpers.mjs`)

- **An `affected.mjs` run on a fixture repository.** Each test builds a scratch git repository with #1115's `tree()`:
  a copy of this checkout's `scripts/` (the lint lane's own scripts stubbed), links to `node_modules`, a vitest config
  and a known-failures file, plus a tiny Cargo workspace (one or two bin crates, `fixture-a`, `fixture-b` or
  `fixture-broken`, each a `main.rs` with no dependencies) and its `Cargo.lock`, made by `cargo generate-lockfile
  --offline` and committed, so `--locked` builds work offline in seconds. `/target` is ignored. The run is
  `node scripts/affected.mjs <the planted test files>`, in its own process group.
- **A test table of its own.** `DEEP_THROTTLE_TABLE` points at a folder of the sandbox's, so the run's grants, and the
  `log` the tests read, are never the machine's `~/.deepbuild/throttle`. The run is a descendant of `node --test`, the
  only place the throttle reads that variable.
- **A HOME of its own.** The sandbox's HOME, so `~/deepbuild-shards` is the test's; `DEEP_TEST_SHARD_FLOOR=0`, so the
  machine's free space doesn't refuse a sandbox shard. Shards here hold the fixture's few files and their own small
  `target/`.
- **Real cargo.** No `CARGO_*` (but `CARGO_BUILD_JOBS`), `RUSTC*`, `MAKEFLAGS` from the test's process reach the run;
  `CARGO_HOME` is the sandbox's (so no user cargo config, as an `sccache` wrapper, applies), `RUSTUP_HOME` the real one.
- **Planted tests** (`node --test` files) note in a record file where they ran (their checkout: the folder up from them
  holding `Cargo.toml`) and what they saw. A self-building one runs
  `cargo build --locked --bin <name>` in its checkout with the acceptance helpers' profile
  (`CARGO_INCREMENTAL=0`, `CARGO_PROFILE_DEV_DEBUG=0` unless the environment says otherwise, as
  `tests/acceptance/935/helpers.ts` and the other ~70 helper files do) and notes every `Compiling` line cargo printed.

## What each file proves

- `worktree.test.mjs`, **`#2820.AC1`**: the selected `tests/fixture-2820/self-build.test.mjs` runs
  `cargo build --locked --bin fixture-a` itself in the worktree. The table's log must show exactly one `build` grant
  granted, then that grant released, before the run's top-level `test` grant is granted (the scope's "under one
  `build` grant of its own"); the test must have run in the worktree, and its own `cargo build` must have succeeded and
  printed no `Compiling` line.
- `shard.test.mjs`, **`#2820.AC2`**: two planted files, each in a different folder of `lanes.mjs`'s `alone` list (so
  each is an alone group of its own), with `DEEP_SHARDS=2`, so the alone block runs in two shards. One builds
  `fixture-a` itself; the other builds `fixture-b` through a helper module it imports (the scope's "a selected test or
  a helper it reaches"). Each must have run in a shard of its own under the sandbox's `~/deepbuild-shards/`; the log
  must show the same order as AC1 (one build grant, granted and released before the test grant); and in each shard the
  test's own `cargo build` must have succeeded with no `Compiling` line.
- `bin-dir.test.mjs`, **`#2820.AC3`**: the selected test reads `fixture-b` through `DEEP_BIN_DIR` and runs it. The
  binary prints a token generated for this run and written only into the fixture's `main.rs`, so the binary that ran
  was built from the run's own checkout. When the test starts, `DEEP_BIN_DIR` must be set and hold `fixture-b`; it must
  print the token; the log must show the build grant granted and released before the test grant is granted, and the
  test grant before the test started.
- `no-binary.test.mjs`, **`#2820.AC4`**: the fixture has a Cargo workspace, but the selected test neither builds nor
  reads a binary. The test must have run under a top-level test grant, and the log must hold no `granted` or `timeout`
  event of class `build` (a `passed` event, a job passing through on the run's test grant, is not a grant).
- `failures.test.mjs`, **`#2820.AC5a`**: the selected test runs `cargo build --locked --bin fixture-broken`, whose
  `main.rs` has a type error. The run must print a line starting `BLOCKED` that names `fixture-broken`, its last state
  line must be `BLOCKED`, it must exit non-zero, the log must hold no `test` grant, and the planted test must not run.
- `failures.test.mjs`, **`#2820.AC5b`**: other holders (#1115's `throttle.mjs build --wait 1 -- node stub.mjs`, on the
  same table) take every build slot (2 on Linux, 1 on macOS) for 9 minutes, and the run gets `DEEP_TEST_GRANT_WAIT=0.02`
  (the scope: "The run's build wait is its test-grant wait"). The run must print a line starting
  `INCONCLUSIVE no grant`, end on an `INCONCLUSIVE` state line, exit non-zero, its build request must have timed out in
  the log with `wait` 0.02, the log must hold no `test` grant, and the planted test must not run.

"Nothing passes" is read as: no `PASS` final state and a non-zero exit, with the planted test never started.

## Not tested here

- The Proof's **reading** (one `node scripts/affected.mjs` run on the Linux machine before and after, with the time from
  the test grant to the end and a self-building acceptance file's slot time) is a measurement of the real repository,
  not a pass/fail criterion; it isn't an acceptance test here.
- Scope bullets that no criterion names are not asserted on their own: "a `--bin <name>` whose name is a variable
  counts once per workspace binary the test's sources name", "a self-started build with arguments the source doesn't
  write out, or with its own `CARGO_TARGET_DIR`, is left to the test", and "holds [the shards] through its wait". AC2
  covers the shards being claimed and built in before the test grant.
- AC1 to AC3 say the build "starts and ends before the run's test grant is granted"; the tests read that through the
  issue's own surfaces, the log's build grant and the test's own `cargo build` output, not through process timing.

## Run

```sh
npm ci --ignore-scripts   # once, if node_modules is missing
node --test --test-reporter=spec tests/acceptance/2820/*.test.mjs
```

It needs cargo and a Rust toolchain and works offline. Each test allows its run 10 minutes; on an idle machine the
whole suite took 8 s at the base at load 70. The sandbox, with its HOME, shards, table, cargo home and the runs' logs, is removed
after each test, and only the processes a test started are stopped, by their process group's PID.

`BASE-FAILURE.txt` is the suite's output at the base `f17fa347c`, and why each test fails there.
