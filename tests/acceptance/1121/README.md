# Acceptance tests for #1121: the workspace builds and tests on Linux aarch64, and a Spark cargo test is INCONCLUSIVE (platform), never PASS (T8)

I drafted these tests blind from these sources:

- issue #1121, as saved verbatim for this job
- `docs/parallel-proof.md`, sections 3, 8, 10, 10a, 11 and 12
- `docs/technical-design.md`: Dogfooding, Proven on the base, Tests written first
- AGENTS.md
- the base commit `654c560c`

At the base I also read `scripts/lanes.mjs`, `proof-change.mjs`, `throttle.mjs` and `lease`,
`crates/deep-hook/src/spool_file.rs`, `main.rs`, `tests.rs` and `tests/cli.rs`, `crates/deep-app/Cargo.toml`,
`packages/supervisor/src/procs.ts`, `packages/env-local/src/stack.ts`, `packages/hub/test/env-resources.test.ts`, and
`tests/acceptance/1115/` and `1116/` for their shape. The helpers are written here, never imported from another suite.
I didn't read PR #1694, which the issue names, or any other work on this issue. Per AGENTS.md, the implementing agent
doesn't edit these tests. A dispute goes to a blind redraft by this job.

The issue's second paragraph says most of its Scope lines are done on main, and at the base they are. So of the seven
tests only the three of the third criterion can fail on the base; the other four pass there on the machine that can run
them, and each names in `twins.json` the planted wrong program that fails it (`twins/README.md`).

## Running them

```sh
# The Mac (darwin arm64): AC4, and the Mac's half of AC3. About 5 s once deep-hook is built.
node --test 'tests/acceptance/1121/*.test.mjs'

# The Spark (Linux aarch64): AC3's Spark half, AC4 and AC5, a few minutes cold.
npm ci                                   # once: AC5 builds env-local and what it needs with tsc
node --test tests/acceptance/1121/record.test.mjs tests/acceptance/1121/spool.test.mjs tests/acceptance/1121/lsof.test.mjs

# The Spark, when it has room: AC1 builds the whole workspace and AC2 runs its whole cargo test. Hours cold.
node --test tests/acceptance/1121/build.test.mjs tests/acceptance/1121/cargo-test.test.mjs
```

They're `*.test.mjs` under `tests/acceptance/`, so the unit lane doesn't pick them up; they run by hand, on both
machines, as the issue's `Runs on: Spark + Mac` has it. `cargo`, `git`, `node` 24 and, on Linux, `lsof` must be on
`PATH`. Set `CARGO_BUILD_JOBS` to bound cargo on a shared machine.

**A test that can't prove its criterion on the machine it runs on skips**, with a note that starts `INCONCLUSIVE
(platform):` and names the machine. A skip is unrun, never a pass (AGENTS.md, invariant 2): five of the seven skip on
the Mac, and one on the Spark, so the criteria are proven only by the runs of both machines together.

All run on real components: the real `runLanes` of `scripts/lanes.mjs` under the real throttle and lease script, the
real cargo on a real workspace, the real deep-hook binary, the real `@deepbuild/supervisor` and `@deepbuild/env-local`
built from their sources, the system's lsof, real sockets and real symlinks. Stand-ins:

- **The Mac's evidence record**, in the Spark's half of AC3. The Mac isn't there, so the test writes the record the
  Mac's run of the same tree writes, in the shape the Mac's half of AC3 requires (The surface, below).
- **The workspace** in AC3 is a fixture of two crates and ten tests, built by the real cargo, not the repository's 54
  crates: a test of the comparison needs to know which tests are absent, and it runs in seconds on either machine.
- **No hub.** deep-hook is given a home with no hub in it, as its own tests do, so it decides the call and spools it.

**AC3's tests point `HOME` at a temporary folder**, so `~/.deepbuild` is the sandbox's, never the real one; under
`node --test` the throttle's table is that home's too. `RUSTUP_HOME` and `CARGO_HOME` stay the machine's. deep-hook
runs with only a temporary `HOME` in its environment. AC1, AC2 and AC5 build in the checkout itself, into its `target/`
and `packages/*/dist`, and AC2 keeps the machine's `HOME`, as the workspace's tests are run by the lane. Each process a
test starts gets its own process group; nothing is killed by name or port.

## Criteria to tests

Each criterion's ID is `#1121.<first 8 hex digits of the SHA-256 of its "- [ ]" text, trimmed, white space
collapsed>`, as `scripts/proof-change.mjs` (`criterionId`) works it out; I took them by running `readIssue` on the
issue's text. Each test carries its tag at the start of its name.

| Criterion | Test (file) | Runs on | What it requires |
|---|---|---|---|
| AC1 `#1121.73d8f179` 27 of 27 crates build on the Spark | 1 in `build.test.mjs` | Spark | `cargo build --workspace --locked --keep-going` exits 0, and cargo names a built library or binary for every workspace crate that has one; a failure says `N of M crates build` and names the others. The workspace holds 27 crates or more |
| AC2 `#1121.b915783e` `cargo test` on the Spark has no FAIL or BLOCKED | 1 in `cargo-test.test.mjs` | Spark | The lane's own `cargo test --workspace …` command, read from `checks`, ran tests, and `cargoResults` reads no BLOCKED from it and no FAIL but those `scripts/known-failures.json` lists |
| AC3 `#1121.95fa4a52` Its record lists the tests absent by platform …, by comparison with the Mac's reference list, and the lane is INCONCLUSIVE (platform), not PASS | 3 in `record.test.mjs` | Mac: 1. Spark: 2 | **Mac:** the lane's record holds `list`, each target's `cargo test -- --list` names. **Spark, with the Mac's record:** each of the six absent tests (four whole test files' and two cfg-gated single tests) is a row of the record, `INCONCLUSIVE`, `skipped`, its note naming the platform; Linux's own tests pass; the record and the one summary line are `INCONCLUSIVE <lane> (platform)`; the exit is non-zero. **Spark, with no Mac record:** the lane is INCONCLUSIVE or BLOCKED, never PASS |
| AC4 `#1121.23cb368c` A symlinked spool path is refused by deep-hook on aarch64, and the planted x86_64 constant lets it through and fails, naming the path | 1 in `spool.test.mjs` | Mac and Spark | deep-hook spools a call into a home of its own; five calls into a home whose spool file is a symlink, and five into one whose spool folder is, leave the file the link leads to as it was. A failure names the link and the file |
| AC5 `#1121.301969cb` env-resources finds a free port on Linux, and a planted hardcoded `/usr/sbin/lsof` fails there, naming the path | 1 in `lsof.test.mjs` | Linux | `listening()` names this process on a port it listens on; that port is not free; `portKind()`'s keys, asked in turn, give a free port; lsof shows no listener there and it takes one. A failure carries what lsof said, which names the path it couldn't run |

## The surface (my choice where the issue leaves it open)

An implementer must match these. Each is the least I could add to what the base and the design already say.

### AC3: the lane, the list and the comparison

- **The lane is the one of `checks` in `scripts/lanes.mjs` with a command that starts `cargo test` and holds
  `--workspace`**, the `unit` lane at the base. The tests run the real `runLanes` on that lane object as exported, less
  its other runners' commands and its `paths`, so a property the lane gains stays on it. They never name the lane:
  whatever its `name` is, the record's file and the summary line follow it.
- **The work happens inside `runLanes`**, for a lane with that command, in the folder `runLanes` is given as `cwd`. No
  flag, variable or other script turns it on: the tests set none.
- **The Mac's record gains one field, `list`**: an object from each test target to the array of the test names
  `cargo test -- --list` prints for it (its `name: test` lines). A target is named as the base's test IDs name it, by
  the arguments that rerun it: `-p alpha --lib`, `-p alpha --test mixed`. So a test's ID is `cargo <target> › <name>`
  for a target and a name of the list. A target with no test may be left out or hold `[]`. The order is free. The
  record is the lane's own, `~/.deepbuild/lanes/<tree>-<lane>.json`, with the six fields it has at the base.
- **A Spark run finds the Mac's record in its own `~/.deepbuild/lanes/`**, as the Mac wrote it: the file
  `<tree>-<lane>.json` whose `tree` is the run's own tree and whose `platform` starts `darwin`. How it gets there is
  T7's (#1122, section 8); the test puts it there before the run. The Spark's own record may replace that file or
  sit beside it under another name: the test finds the Spark's record by its `platform`, `linux-arm64`, and its `tree`,
  and requires exactly one.
- **An absent test is a row of the Spark record's `tests`**, as section 10a's record holds every test: `id` as the
  Mac's list gives it, `state: "INCONCLUSIVE"`, `skipped: true`, and a `note` that names the platform as `lanes.mjs`
  reads a platform skip (its `PLATFORM` pattern: one of macOS, Linux, darwin, Metal, GPU, platform) and doesn't start
  with BLOCKED. Absent means named in the Mac's `list` and not by the Spark's own `cargo test -- --list`. A test only
  Linux has is not absent: it runs and passes.
- **The summary line is the base's**: `INCONCLUSIVE <lane> (platform): …`, the only line of the run that starts with a
  state and the lane's name, and `runLanes` returns non-zero.
- **With no Mac record of the tree**, the run's one such line starts `INCONCLUSIVE <lane>` or `BLOCKED <lane>`, any
  record it writes has that state, and `runLanes` returns non-zero.

### AC1 and AC2

- **A crate builds** when `cargo build --workspace --locked --keep-going --message-format=json` reports a
  `compiler-artifact` of kind lib, rlib, dylib, cdylib, staticlib, proc-macro or bin for it. A workspace member with no
  such target isn't counted.
- **27 of 27** is read as every crate of the workspace: the issue counted 27, and the base has 54.
- **AC2 reads the run with `cargoResults(output, status, crates(cwd))`**, both exported by `lanes.mjs` at the base, on
  cargo's stdout and stderr in the order written. A FAIL whose ID is a key of `failures` in
  `scripts/known-failures.json` is main's, as the lane reads it, and isn't the Spark's.

### AC4

- **`deep-hook claude-code PreToolUse`** with a Bash call of `ls <word>` on stdin and only `HOME` in its environment,
  the surface `crates/deep-hook/tests/cli.rs` drives. The spool is `$HOME/.deepbuild/spool/spool.jsonl`.
- The test builds `cargo build --locked -p deep-hook --bin deep-hook` and runs the executable cargo names.

### AC5

- **"env-resources finds a free port"** is read as what `packages/hub/test/env-resources.test.ts` needs of Linux before
  any of its stacks can come up: env-local's port kind finding a free port. The test asks `portKind()` of
  `@deepbuild/env-local` as the supervisor does, each of `keys` through `free(key)`, and `listening(port)` of
  `@deepbuild/supervisor`, both public exports at the base, loaded from `packages/*/dist/index.js`.
- The test builds `@deepbuild/env-local` and every workspace package it depends on, in order, with
  `npm run build -w <name>`, so a change to a source is what runs.

## The tests that can't fail on the base

| Test | On the base | Its wrong program (`twins/`) |
|---|---|---|
| AC1 `build.test.mjs` | Skips on the Mac. Unrun on the Spark: a whole-workspace build was outside this job's bounds there | `mac-only-dependency`: unrun, on both machines (`BASE-FAILURE.txt` says why) |
| AC2 `cargo-test.test.mjs` | Skips on the Mac. Unrun on the Spark, for the same reason | `umask-spool-folder`: unrun under the test. The deep-hook test it breaks, run alone on the Spark, is in `BASE-FAILURE.txt` |
| AC4 `spool.test.mjs` | Passes on the Mac and on the Spark | `x86-nofollow`: fails it on both |
| AC5 `lsof.test.mjs` | Skips on the Mac. Passes on the Spark | `sbin-lsof`: fails it on the Spark |

AC3's three tests fail on the base at their assertions: the first on the Mac, the other two on the Spark.

## Open questions for the implementer

- **How the Mac's record reaches the Spark.** The issue's Proof has both records "on one commit", and section 8's
  shipping is T7's. The tests assume only where the Spark run reads it (above). If the real route puts it elsewhere,
  the second AC3 test needs a redraft, not an edit.
- **`list`'s name and shape** are this draft's. The issue says only "`cargo test -- --list` per target".
- **A Spark run in which nothing is absent.** Section 3 says a Spark cargo test is never PASS on its own. No test here
  runs a workspace whose two lists agree, so none says what that lane reads.
- **A Linux-only test on the Mac.** The fixture has one. No test says whether the Mac's record lists it as absent, or
  what the Mac's lane then reads: the Mac's half requires only that the Mac's nine tests pass and are listed.
- **No Mac record: INCONCLUSIVE or BLOCKED.** Section 3 reads INCONCLUSIVE (platform); invariant 2 allows BLOCKED for
  what is missing. The third AC3 test takes either.
- **27 crates.** The count is the issue's; the workspace has grown to 54. AC1 requires all of them.
- **Listed failures.** AC2 lets a FAIL that `known-failures.json` lists stand, as the lane does. If "no FAIL" means
  none at all, AC2 needs a redraft.
- **The edited deep-hook test.** The issue says the 0700 change goes as its own approved proposal if that test carries
  a criterion tag. At the base it carries none, and the change is in.

## What these tests can't see

- **The real workspace's absent tests.** That the Spark's record of the repository itself lists "four whole test files
  plus cfg-gated single tests" needs both machines' records of one commit, which is the issue's Proof, by hand. The
  fixture has the issue's four files and two single tests.
- **Doc-tests and benches** in a list: the fixture has neither.
- **The whole of `env-resources.test.ts` on Linux.** Its stacks, hubs and agents run in the unit lane; AC5 here proves
  the port search and lsof under it.
- **The other lsof call** of `procs.ts`, the scan of every process. `sbin-lsof` plants both; the test reaches the first.
- **A symlinked spool path on Linux x86_64 or arm.** The test skips off aarch64.
- **A spool under a joined project's hub** (`remote::spool_folder`), which takes the same append.
- **Whether a lost spool line hides a write.** deep-hook gives its spool 45 ms. The test first requires a line in a
  plain spool, within five calls, and skips INCONCLUSIVE without one; then five calls go at each link.
- **deep-hook's own symlink test under a umask of 002.** `a_spool_path_that_leads_elsewhere_is_never_written` passes
  on the Spark with the x86_64 constant planted: its spool folder is group-writable there, so deep-hook refuses it
  before the open that the constant guards. AC4's test makes that folder 0700. Noted here as an unrelated finding.
- **#184's, #555's and #851's Mac-only status**, the last Scope line: no criterion names it.

## Files

- `helpers.mjs`: the machine, the sandbox, running a process, the fixture workspace and its two lists, the drivers
  that reach `lanes.mjs`, the records.
- `build.test.mjs` (AC1), `cargo-test.test.mjs` (AC2), `record.test.mjs` (AC3), `spool.test.mjs` (AC4),
  `lsof.test.mjs` (AC5).
- `twins.json`, `twins/`: the planted wrong programs (`twins/README.md`).
- `BASE-FAILURE.txt`: the runs on the base on both machines, and each planted program's run.

Outside this folder, for the implementing job: `scripts/wait-ceilings.json` needs the entry `twins/README.md` names,
or the lint lane's wait ratchet fails on the `x86-nofollow` twin.

No fixture holds a secret or personal data. The record's host `reference-mac` is made up.
