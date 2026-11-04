# Acceptance tests for #1117: bays, fixed-path proof workspaces (T1)

These tests were drafted blind from issue #1117 (its text on 2026-11-03), `docs/parallel-proof.md` (sections 4, 6,
10 and 11), the Dogfooding part of `docs/technical-design.md`, AGENTS.md and the base commit `d2623d97`, which has no
`scripts/bays.mjs`. At the base I also read `scripts/throttle.mjs` (T5, merged), `scripts/proof-runs.mjs`
(`checkout`, `changeCopy`, `undoBuild`, `childEnv`, `temporary`), `scripts/proof-change.mjs` (`listFiles`),
`tests/proof.test.mjs`, `tests/acceptance/569/helpers.mjs` and `tests/acceptance/1113/`. The helpers are written here
and import nothing under test. Per AGENTS.md, the implementing agent doesn't edit these tests; a dispute goes to a
blind redraft by this job.

Run them with:

```sh
npm ci                                   # once, if node_modules is missing (proof-change.mjs imports typescript)
node --test 'tests/acceptance/1117/*.test.mjs'
```

They need `git`, `cargo` (found on `PATH`, or in `$CARGO_HOME/bin`, default `~/.cargo/bin`) and `touch`. They are
offline: the fixture has no crate or npm dependency. All 10 run on real processes, real bays, real cargo and real
git; nothing is mocked. The suite takes about 80 s on the Spark: the two `proofs.test.mjs` tests take about 38 s
each (all of it the real `tests/proof.test.mjs` and `tests/acceptance/569/before.test.mjs`), every other test 1-2 s.
On the base all 10 fail at their assertions, as `BASE-FAILURE.txt` shows.

**Every test points `HOME` at a temporary folder**, so bays are `<HOME>/deepbuild-bays/<k>/` and the throttle table
and log are `<HOME>/.deepbuild/throttle/`, never the real ones. `RUSTUP_HOME` and `CARGO_HOME` stay the machine's
(default `~/.rustup`, `~/.cargo`), so no toolchain is fetched into the sandbox. The sandbox unsets `DEEP_THROTTLE`,
`DEEP_PERF_LOCK`, `NODE_TEST_CONTEXT`, `CARGO_TARGET_DIR`, `CARGO_BUILD_TARGET_DIR` and the rustc wrappers (AC7 sets
`CARGO_TARGET_DIR` on purpose). Each `bays.mjs` a test starts gets its own process group; the test stops that group,
and any command it orphaned, by PID when it ends.

## The surface (my choice where the issue leaves it open)

The issue names `scripts/bays.mjs` and no surface. The tests reach it only as a CLI, the way `throttle.mjs` is
reached, so that on the base a missing script is an assertion failure:

```sh
node scripts/bays.mjs change -- <command> [args ...]     # cwd: the proof's root, a worktree
```

- **What it does.** It claims a bay pair through `throttle.mjs`'s `bay-pair` class, whose grant index `k` names the
  pair's folder `~/deepbuild-bays/<k>/`. It replaces the pair's change bay in place to the run's exact tree (the
  worktree as `listFiles` sees it: HEAD's tree, the uncommitted changes and the untracked non-ignored files),
  checks the seal, runs the command with its cwd in the bay, seals the bay at release, releases the grant and exits
  with the command's status. `change` is the role; the base role (`base`, the merge base) belongs to the same
  design, but no test uses it.
- **Where the bay is.** The bay is `~/deepbuild-bays/<k>/` itself or any folder under it (for example
  `~/deepbuild-bays/<k>/change/`), the same path on every claim of that pair and role. Tests read it from the record.
- **Environment.** The command gets bays.mjs's environment without `CARGO_TARGET_DIR` (anything else passes through;
  the tests need `PATH`, `HOME`, `RUSTUP_HOME`, `CARGO_HOME`).
- **The record: two lines on stdout**, each `BAY <event> <one-line JSON object>`, and no other line starting `BAY `:
  - `BAY claim {...}` printed after the bay is replaced and its seal checked, **before the command starts**. Keys
    the tests read: `index` (the grant index `k`, an integer), `bay` (absolute path), `seal` (`"none"` when there was
    no seal, as on first use; `"intact"` when the seal matched; `"broken"` when it didn't), `cold` (`true` when
    `target/` and `node_modules/` were deleted or absent, `false` when kept). Other keys (the tree, bundle and
    untracked hashes the issue records, the role) may be there; no test reads them.
  - `BAY release {...}` printed after the command ends and the seal is written. Keys the tests read: `targetBytes`,
    the size of `<bay>/target` in bytes (a reading: apparent or allocated size, links counted once or not; the test
    allows a factor of 2 either way), `0` when there is no target. Also printed when the command fails.
- **Refusal.** When the root isn't a worktree of the machine's repository, or an ancestor process holds a bay pair,
  bays.mjs prints a stdout line starting `NO BAY` (for example `NO BAY: <why>`), runs nothing, asks the throttle for
  nothing, creates nothing under `~/deepbuild-bays/`, and exits **2**.
- **What a bay holds when the command starts.** Outside `.git/`, `target/` and `node_modules/`, exactly the tree's
  files with the tree's bytes. So bays.mjs keeps its own seal, manifest or marker files outside the bay folder, or
  inside one of those three.
- **The throttle log.** AC6 reads `~/.deepbuild/throttle/log` as merged T5 writes it (JSON lines with `event`,
  `class`, `index`): a pair asked for is a `granted`, `timeout` or `passed` line of class `bay-pair`.

### The machine's repository

The issue gives a bay only to "a proof rooted in a worktree of the machine's repository" and leaves the test of that
open. The fixture meets every reading I found plausible at once, so an implementation may use any of them:

- it is the repository at `~/deepbuild` (the Spark's worktrees are `~/deepbuild/.claude/worktrees/<name>`, design
  section 8), here `<sandbox HOME>/deepbuild`;
- its common git directory is the one of the repository `bays.mjs` itself runs from: the fixture commits a copy of
  this checkout's `scripts/`, and the tests run the worktree's own `scripts/bays.mjs`;
- its `origin` is `https://github.com/windoliver/deepbuild.git` (set, never fetched);
- the proof's root is a linked worktree of it, made by `git worktree add`: `<HOME>/deepbuild/.claude/worktrees/w`.

So `bays.mjs` and what it imports must live in `scripts/` (node resolves `typescript` through a link from
`<HOME>/deepbuild/node_modules` to this checkout's `node_modules`). The scene repositories of `tests/proof.test.mjs`
and #569 are none of these: a plain `git init` in a temporary folder, with no origin, reached through this checkout's
`scripts/bays.mjs`, as those tests run this checkout's `proof.mjs`.

### The fixture and the probe

The fixture's tree is a two-crate cargo workspace (`word`, a lib holding a word and `include_str!` of
`crates/word/kit-ledger.json`; `greet`, a binary printing `word|ledger|greeting`, the greeting `include_str!`'d from
`crates/greet/greeting.txt`), a `Cargo.lock`, a `package.json` and `package-lock.json` with no dependencies,
`packages/p/index.mjs`, a `.gitignore` (`target/`, `node_modules/`, `dist/`, `*.log`, `.claude/`) and the copy of
`scripts/`. The integration test `crates/greet/tests/bin.rs` runs the binary through `CARGO_BIN_EXE_greet` and checks
that `CARGO_MANIFEST_DIR` is where it runs and that the binary lies in `<bay>/target`: a target warm from another
path reads fresh to cargo, but fails this test. The worktree adds an uncommitted edit (`lib.rs`), an untracked file
(`greeting.txt`) and an ignored one (`crates/word/notes.log`), so the tree has all three parts.

The command every test hands bays.mjs is a probe (`node <sandbox>/probe.mjs '<json>'`), which writes what it saw to
a file outside the bay and prints nothing. Its steps: `build` runs `cargo build --workspace --all-targets --offline
--locked --message-format=json` (each `compiler-artifact` message's `fresh` flag, and the `Compiling` lines on
stderr), then `cargo test --workspace --offline --locked`, then `target/debug/greet`; `snapshot` hashes every file
in the bay outside `.git/`, `target/` and `node_modules/`; `write`, `stamp` and `restamp` change files and put an
old mtime back (`touch -r`); `hold` waits to be killed; `run` runs a command.

**"Compiles 0 crates"** is read from cargo's own output: every `compiler-artifact` message `fresh: true` (at least
3: lib, bin, test), and no `Compiling` line from `cargo build` or `cargo test`.

## Criteria to tests

Each criterion's ID is `#1117.<first 8 hex digits of the SHA-256 of its "- [ ]" text, trimmed, white space
collapsed>`, as `scripts/proof-change.mjs` (`criterionId`) works it out. Each test carries its tag at the start of
its name.

| Criterion | Test (file) | What it requires |
|---|---|---|
| AC1 `#1117.e77894d3` A second run of the same tree in a bay compiles 0 crates | `warm.test.mjs` | Two `build` runs of the same worktree. The second: same `bay` path, every artifact fresh, no `Compiling` line, `cargo test` passes, the binary prints the tree's text |
| AC2 `#1117.b2c7cfc4` A run after an aborted run rebuilds every file the abort left different | `replace.test.mjs` | A built and sealed run; then the worktree changes; a run gets that tree, its command rewrites `lib.rs` and `greeting.txt` with other bytes of the same size and puts their mtimes back, deletes `kit-ledger.json`, plants three files, and the run is killed (SIGKILL to its group). The next run's command sees exactly the tree's files and bytes, none of the planted files, the two rewritten files with an mtime from this run (never backdated), and its build prints the tree's text and passes `cargo test` |
| AC3 `#1117.af1d4c7e` A planted mutant or a rewritten `kit-ledger.json` from a previous run never survives into the next | `replace.test.mjs` | A previous run builds, rewrites `lib.rs` with a same-size mutant and `kit-ledger.json` with other bytes, builds them into the target (checked), puts both old mtimes back, plants an untracked source, an ignored `dist/` file and log and `.git/planted`, and ends normally (sealed). The next run of the same tree: exactly the tree's bytes, no planted file, both files rewritten with a fresh mtime, and the binary prints the tree's text, not the mutant's or the ledger's |
| AC4 `#1117.4ebbfb21` A tampered `target/` … is detected at claim and built cold, and the record says so | `seal.test.mjs`, two tests | After a sealed build: (a) `target/debug/greet` replaced by a planted program of the same size and mtime (new inode) and a new `target/debug/planted-tool`; (b) each `libword-*.rlib` replaced by other bytes of the same size and mtime (new inode). No fingerprint is touched. The next claim gets the same pair; its record says `"seal":"broken"` and `"cold":true`; the planted tool is gone; cargo compiles every artifact (none fresh); the binary and `cargo test` are the tree's |
| AC5 `#1117.a9ce2b57` Lock holder death releases the bay | `holder.test.mjs` | Every pair is held by a `bays.mjs` run (1 on macOS, 3 elsewhere). One holder's `bays.mjs` is killed by its PID with SIGKILL, then its orphaned command by its PID. A new claim, within 120 s, gets that holder's index, while the others still hold theirs |
| AC6 `#1117.ab479591` `tests/proof.test.mjs` and the 569 scene proofs run on temporary copies and take no pair, inside and outside a held pair | `proofs.test.mjs`, two tests | Outside: this checkout's `bays.mjs` asked from a scene repository prints `NO BAY`, exits 2, runs nothing; then `node --test tests/proof.test.mjs tests/acceptance/569/before.test.mjs` runs (more than 0 tests); the throttle log has no bay-pair grant, timeout or pass-through, and `deepbuild-bays` is absent or empty. Inside: a bay run's command (a descendant of the holder) asks bays.mjs for a bay from the worktree and from a scene repository (each `NO BAY`, exit 2, command never run) and runs the same proofs; the log has exactly one bay-pair grant, the holder's, and `deepbuild-bays` holds only its pair's folder |
| AC7 `#1117.029c15e6` A bay build with `CARGO_TARGET_DIR` set in the parent environment still writes to `<bay>/target` | `target-dir.test.mjs` | bays.mjs starts with `CARGO_TARGET_DIR` at an empty sandbox folder. After a `build` run that folder is still empty, `<bay>/target/debug/greet` was written in this run, and the binary and `cargo test` (whose `CARGO_BIN_EXE_greet` must lie in `<bay>/target`) are the tree's |
| AC8 `#1117.f25af808` Bay-target size is a reading | `warm.test.mjs` | A run with no build, then a `build` run. Both release records have a numeric `targetBytes`; after the build it is within a factor of 2 of the bytes under `<bay>/target` (each inode once), and the reading before the build is under a tenth of it |

## Readings where the issue leaves a choice

- **The pair and its bays.** "Bays … in pairs" and "the grant index k names `~/deepbuild-bays/<k>/`" read together
  as: `<k>/` is the pair's folder and its two bays lie in it. A test accepts the folder itself as the bay.
- **An aborted run (AC2)** is a run killed with SIGKILL while its command runs, after the bay was replaced. A run
  killed during the replace itself is not tested: its timing can't be hit reliably on a fixture this small.
- **"Rebuilds every file the abort left different"** is read as: every such file gets the tree's bytes with a new
  mtime, and the next build reflects the tree. Whether the claim after an abort goes cold isn't tested either way.
- **"Never survives" (AC3)** covers tracked files rewritten in place (same size, old mtime put back), deleted tracked
  files (AC2), untracked and ignored files planted outside `target/` and `node_modules/` (including a `dist/`
  folder), and a file planted in `.git/` (recreated each run).
- **AC4's "record says so"** is the claim line's `seal` and `cold`. The tampering keeps size and mtime, so a seal of
  path, size and mtime alone misses the replaced rlib; the inode or the bytes catch it.
- **AC6 "inside a held pair"** is a proof run as a descendant of the process holding a pair, as a proof's tagged
  tests would run under T2. The proofs run from this checkout, not from the bay, since the fixture's tree holds no
  copy of them; the ancestor rule is the same either way. **The cost**: the real `tests/proof.test.mjs` (56 tests)
  and `tests/acceptance/569/before.test.mjs` (6) run twice, about 38 s each time. The whole #569 suite is not run
  (its mutation lane runs StrykerJS for minutes); `before.test.mjs` is the part that makes temporary copies of the
  merge base and the change. At T1 the proofs never call bays.mjs, so the "takes no pair" half passes on the base;
  the test fails there on bays.mjs's own refusal, and its log half guards T2.
- **AC5's "the bay"** is the pair the dead holder held, read by its index; every other pair is held so the next claim
  can only get a pair by that release.
- **Who builds.** bays.mjs may run `npm ci` itself (the fixture's lock has no dependencies); the cargo builds are the
  command's. Nothing tests `npm ci` keying, the `packages/*/dist` deletion before the workspace build (beyond AC3's
  planted `dist/` file), `undoBuild` in a bay, the three hashes in the record, the guard regex or the base role:
  they are scope, not criteria.

## Files

- `helpers.mjs`: the sandbox, the fixture (the machine's repository and its worktree, a scene repository), the
  probe, launching `bays.mjs`, the record and throttle-log readers.
- `warm.test.mjs`: AC1 and AC8.
- `replace.test.mjs`: AC2 and AC3.
- `seal.test.mjs`: AC4 (two tests).
- `holder.test.mjs`: AC5.
- `proofs.test.mjs`: AC6 (two tests).
- `target-dir.test.mjs`: AC7.
- `twins.json`, `twins/README.md`: the three planted wrong programs the issue's Proof names, to be laid down as
  `twins/<name>/scripts/bays.mjs` once an implementation exists.
- `BASE-FAILURE.txt`: the run on the base, and the planted program and wrong programs checked against the tests.

No fixture holds a secret or personal data.
