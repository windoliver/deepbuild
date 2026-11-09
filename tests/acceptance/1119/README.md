# Acceptance tests for #1119: perf's kept copies per machine (T3)

These tests were drafted blind from issue #1119 (its text on 2026-11-04), `docs/parallel-proof.md` (sections 4, 5,
6, 10, 11 and 12), the Dogfooding part of `docs/technical-design.md`, AGENTS.md and the base commit `a2ea54a5`, whose
`scripts/perf.mjs` keys its kept copies by worktree path (`sha256(realpathSync(root))`). At the base I also read
`scripts/bays.mjs` (T1's byte-compare rule), `scripts/throttle.mjs` (T5), `scripts/benchmark.mjs` (`warm`,
`measureOnce`), `tests/perf.test.mjs` and `tests/acceptance/1117/`, whose layout these follow. The helpers are written
here and import nothing under test. Per AGENTS.md, the implementing agent doesn't edit these tests; a dispute goes
to a blind redraft by this job.

Run them with:

```sh
npm ci                                   # once, if node_modules is missing (scripts/proof-change.mjs imports typescript)
node --test 'tests/acceptance/1119/*.test.mjs'
```

They need `git`, `cargo` (found on `PATH`, or in `$CARGO_HOME/bin`, default `~/.cargo/bin`) and `/usr/bin/time`
(perf's own `measureOnce`). They are offline: the fixture has no crate or npm dependency. All 3 run the real
`scripts/perf.mjs` as a CLI, on real processes, real git and real cargo; nothing is mocked. Each test takes a few
seconds once perf has its grant; the suite takes about 15 s on the Spark. On the base all 3 fail at their
assertions, as `BASE-FAILURE.txt` shows.

**Every test points `HOME` and `XDG_CACHE_HOME` at temporary folders**, so the throttle table and log are
`<HOME>/.deepbuild/throttle/` and perf's kept copies are `<cache>/deepbuild-perf/…`, never the real ones. `RUSTUP_HOME`
and `CARGO_HOME` stay the machine's (default `~/.rustup`, `~/.cargo`), so no toolchain is fetched into the sandbox.
The sandbox unsets `DEEP_THROTTLE`, `DEEP_PERF_LOCK`, `DEEP_OPEN_ISSUES`, `NODE_TEST_CONTEXT`, `CARGO_TARGET_DIR`,
`CARGO_BUILD_TARGET_DIR` and the rustc wrappers. Each perf a test starts gets its own process group; the test stops
that group by its PID when it ends.

**The timed grant.** perf takes the throttle's `timed` class, which waits for a 1-minute load below the core count.
A perf that prints no `RUN perf` line within 10 minutes is stopped, and its test fails with `INCONCLUSIVE no grant:
… so this test could not run`, as does a perf that prints perf's own `INCONCLUSIVE no grant`. That failure means the
machine was too loaded to run the test, never that the criterion holds or fails; rerun on a quieter machine.

## The surface (my choice where the issue leaves it open)

The issue names no new flag, option or command, and the tests add none. perf is run exactly as `preflight.mjs` runs
it, from a worktree's root:

```sh
node scripts/perf.mjs '{"status":0,"elapsedMs":1,"cpuMs":1,"peakBytes":1}'      # cwd: a worktree
```

with `XDG_CACHE_HOME` set. The observation is a passing run cheaper than any base, so a working perf ends `PASS
perf (<s> s)` and exits 0. What the tests read:

- **Where the kept copies are.** perf runs `scripts/checks.mjs` with its cwd in each side's kept copy and
  `CARGO_TARGET_DIR` at that side's kept builds, as at the base. Both must lie under
  `<XDG_CACHE_HOME>/deepbuild-perf/<machine>/<side>/` (the copy and the builds may be any folders under it, the
  builds not inside the copy), where `<side>` is `base` or `without-tests` and `<machine>` is one folder name, the
  same whichever worktree perf runs from. How `<machine>` is spelled is the implementation's choice.
- **The lock.** A perf that finds the machine's kept copies held by another live perf, not named to it by
  `DEEP_PERF_LOCK`, prints a line starting `BLOCKED perf: `, exits non-zero and runs no checks (as at the base, but
  across worktrees). Where the lock file lives is not read.
- **The record of the rebuild (AC2): one stdout line.** When perf replaces a kept copy's tree and a file there held
  other bytes than the tree's, it prints a line starting `perf: <side>` that names that file by its path in the tree.
  The test reads the second run's stdout for a line matching `^perf: base\b.*crates/deep-show/kit-ledger\.json`, for
  example `perf: base rewrote crates/deep-show/kit-ledger.json: its bytes differed from the tree, so deep-show and its
  dependents rebuild`. A file whose bytes matched is not named: after a rewrite with the same bytes, no `perf:` line
  names `kit-ledger.json`. Other files the line names, and other lines, are free.
- **What a kept copy holds when checks.mjs starts.** Outside `.git/`, `target/` and `node_modules/`, exactly the
  tree's files with the tree's bytes, so perf keeps any manifest of its own outside the copy or inside one of those
  three.
- **Wall time (AC3).** perf's `PASS perf (<s> s)` line, as at the base. No test judges it.

### The fixture and the workload

The machine's repository is `<HOME>/deepbuild`: this checkout's whole `scripts/` (so perf can import any module
beside it) and the fixture in one commit, dated 2001 so a copy that keeps commit times is seen, with `origin/main`
at that commit and `origin` at this project's URL (never fetched). `<HOME>/deepbuild/node_modules` links to this
checkout's `node_modules`. Two worktrees of that commit, `<HOME>/deepbuild/.claude/worktrees/{a,b}`, are made by `git
worktree add`; the merge base of each is the commit itself. In the first AC1 test each worktree also holds the same
untracked `tests/added.test.mjs`, so perf keeps its `without-tests` side too.

The fixture's tree is a three-crate cargo workspace: `deep-show` (`include_str!` of
`crates/deep-show/kit-ledger.json`), `show-panel` (depends on deep-show) and `plain` (depends on nothing), with its
`Cargo.lock`; `benchmarks/budgets.json` with a preflight budget, so perf measures a base side; a `package.json` and
`package-lock.json` with no dependencies; and `scripts/checks.mjs`, the workload.

perf runs `npm ci`, `warm()` and then the workload in each kept copy. The workload reads what to do from a control
file in the sandbox and appends what it saw to a file in the sandbox, outside every copy: its cwd, `CARGO_TARGET_DIR`,
the bytes and mtime of `kit-ledger.json`, every file of the copy outside `.git/`, `target/` and `node_modules/`, and
each build's cargo output. It builds with `cargo build --release --workspace --locked --offline
--message-format=json`, then, as the control says, rewrites `kit-ledger.json` with the same bytes or with other
bytes (then also leaving an untracked `planted.txt`) and builds again, or starts a nested perf from the other worktree.

**"Compiles 0 crates"** is read from the workload's first build in the second run's base copy: every
`compiler-artifact` message `fresh: true` (3, one per crate), and no `Compiling` line. The build is in release
because `warm()` builds only the dev profile (`cargo test --no-run`) and clippy's check artifacts before checks.mjs
starts: a dev build in checks.mjs would read fresh even in a copy perf had just built cold, so it could not tell a
warm copy from a cold one. A release build is compiled by checks.mjs alone, which is the count the criterion names.
The fixture has no nested proof lane, so nothing it builds in a temporary copy is counted or needs excluding.

## Criteria to tests

Each criterion's ID is `#1119.<first 8 hex digits of the SHA-256 of its "- [ ]" text, trimmed, white space
collapsed>`, as `scripts/proof-change.mjs` (`criterionId`) works it out. Each test carries its tag at the start of
its name.

| Criterion | Test (file) | What it requires |
|---|---|---|
| AC1 `#1119.a84127b8` A perf run from a second worktree on the same machine compiles 0 crates on its base side … | `warm.test.mjs`, first test | perf from worktree a (its checks rewrite `kit-ledger.json` with the same bytes), then from worktree b. Both PASS. In b's run, the base copy's release build: 3 artifacts, all fresh, no `Compiling` line. Each side's copy and builds lie under `<cache>/deepbuild-perf/<machine>/<side>/`, the builds outside the copy, with one `<machine>` for all four, and b's base and without-tests copies and builds are at a's paths. No `perf:` line of b's names `kit-ledger.json` |
| AC1 `#1119.a84127b8` (scope: the lock machine-wide) | `warm.test.mjs`, second test | perf from worktree a, whose checks start a perf from worktree b (a descendant, so its timed request passes through; `DEEP_PERF_LOCK` removed). The nested perf runs no checks, exits non-zero and prints `BLOCKED perf: …`; a's run PASSes |
| AC2 `#1119.d33bc868` The one exception: deep-show and its dependents rebuild when the canvas-kit lane rewrote `kit-ledger.json` with different bytes, and the record names it | `ledger.test.mjs` | perf from worktree a, whose checks build, rewrite `kit-ledger.json` with other bytes, leave `planted.txt` and build again (deep-show compiles: checked). Then perf from worktree b. In b's base copy: the first build compiles exactly `deep-show` and `show-panel` (by fresh flags and by `Compiling` lines) and `plain` is fresh; `kit-ledger.json` has the tree's bytes and an mtime from this run (not backdated); the copy holds exactly the tree's files (no `planted.txt`); b's stdout has a `perf: base …` line naming `crates/deep-show/kit-ledger.json` |
| AC3 `#1119.d289b927` perf wall time before and after is a reading | none (a reading) | See Readings. Each test prints its runs' `PASS perf (<s> s)` times as a `reading:` diagnostic, never asserted |

## Readings where the issue leaves a choice

- **"A second worktree on the same machine"** is a worktree of the same repository at the same commit, after a perf
  run from the first; both sides' trees are then the same, so a warm copy has nothing to rebuild. A worktree of
  another commit is not tested: its base side would rebuild what the merge bases differ in.
- **"Its base side"** is the copy perf builds from the merge base (`base`). The without-tests side is held only to
  its paths (shared per machine, as section 5 names `{base,without-tests}`), not to a compile count, which the
  criterion doesn't give it.
- **The same-bytes rewrite in AC1.** The real canvas kit lane rewrites `kit-ledger.json` on every run. With T1's
  byte-compare rule a file whose bytes match the tree is left alone, so a rewrite with the same bytes is not the
  exception and the second run still compiles 0 crates. An implementation that rewrites every file, or compares
  mtimes, fails here.
- **AC2's "deep-show and its dependents"** is `deep-show` and `show-panel` in the fixture; `plain` must stay fresh.
  **"The record names it"** is perf's stdout, the record perf already prints (its `perf: …` and JSON lines), read as
  a `perf: base …` line naming the rewritten file. Naming the file, not a crate list, is my reading: it is what the
  byte-compare rule knows, and the path names deep-show.
- **No backdating** is read as: a file whose bytes perf put back has an mtime from this run (within 50 ms of the test's
  clock before the run started). The fixture's commit is dated 2001, so a copy that keeps commit times (`git archive
  | tar -x` without `-m`) is caught, and cargo would keep deep-show fresh there, which the compile check also catches.
- **The lock machine-wide** is tested through a perf nested in the first one's checks, since two top-level perf runs
  can never overlap: timed is exclusive. The nested run is refused by the lock, not by the throttle. Whether a refused
  perf waits for the lock instead is not tested beyond its ending within the workload's 10-minute timeout, refused.
- **The lock only under timed** (scope) is not tested separately: every perf here holds timed, and no test plants a
  lock file, since where the machine's lock lives is the implementation's choice.
- **AC3: wall time before and after is a reading.** "Before" is perf's `PASS perf (<s> s)` from a second worktree with
  the base's `scripts/perf.mjs`, "after" the same with the change's, on one commit on the Mac (perf runs only there),
  reported in the PR beside these tests' results. It depends on the machine's load, so it is never a criterion and no
  test asserts it (section 10). The diagnostics these tests print are a fixture's times, not that reading.
- **The guard's signed tag** on `perf.mjs` (scope) is the guard's to check, not these tests'.

## Files

- `helpers.mjs`: the sandbox, the fixture (the machine's repository, its two worktrees, the workload), running perf
  with the grant watch, and readers for the workload's records and the kept copies' paths.
- `warm.test.mjs`: AC1 (two tests) and AC3's diagnostics.
- `ledger.test.mjs`: AC2.
- `twins.json`, `twins/README.md`: the planted wrong program the issue's Proof names, `path-keyed-copy`, to be laid
  down as `twins/path-keyed-copy/scripts/perf.mjs` once an implementation exists.
- `BASE-FAILURE.txt`: the run on the base, and a planted program and wrong programs checked against the tests.

No fixture holds a secret or personal data.
