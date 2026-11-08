# Acceptance tests for #1121: the whole workspace builds and tests on Linux aarch64, and a Spark cargo test is INCONCLUSIVE (platform), never PASS (T8)

I drafted these tests blind from these sources:

- issue #1121, as saved verbatim for this job
- `docs/parallel-proof.md`, sections 3, 8, 10a, 11 and 12
- the Dogfooding part of `docs/technical-design.md`
- AGENTS.md
- the base commit `063e410a`, which has no implementation

At the base I also read the code the issue names: `crates/deep-hook/src/main.rs` (the spool's `append` and the
`NOFOLLOW` constant) and its tests, `packages/env-local/src/stack.ts` (the port kind and its lsof),
`packages/hub/src/stacks.ts` and `packages/supervisor/src/procs.ts` (their hardcoded `/usr/sbin/lsof`),
`packages/hub/test/env-resources.test.ts`, `scripts/lanes.mjs` (`runLanes`, `cargoResults`, `writeRecord`,
`isPlatform`), and `tests/acceptance/1115/` and `1116/helpers.mjs` for their conventions. The helpers are written here,
never imported from another suite. Per AGENTS.md, the implementing agent doesn't edit these tests. A dispute goes to a
blind redraft by this job.

Run them with:

```sh
npm ci                                   # once, if node_modules is missing
node --test 'tests/acceptance/1121/*.test.mjs'
```

On the Spark, give the Mac's unit record of the same commit, so the Spark's run is compared against it:

```sh
T1121_MAC_RECORD=/path/to/<tree>-unit.json node --test 'tests/acceptance/1121/*.test.mjs'
```

They're `*.test.mjs` under `tests/acceptance/`, so the unit lane doesn't pick them up. They're offline and run on real
components: the real `runLanes` on the real `unit` lane's commands, a real `cargo build` of deep-hook and the real
binary, env-local's real port kind through its public entry, real `lsof`, and on the Spark real `cargo build`,
`cargo test` and the hub's real env-resources suite. Stubbed, at boundaries #1121 doesn't own:

- `cargo`, first on `PATH`, in the two AC3 tests that run anywhere. It answers for a fixture workspace (below).
- `process.platform`, in those same two tests, so one machine runs both a Mac's and a Linux run (below).
- The unit lane's vitest and `node --test` commands are left out of those runs: their fixtures aren't this issue's.

**Every test points `HOME` at a temporary folder**, so `~/.deepbuild` is the sandbox's, never the real one. `CARGO_HOME`
and `RUSTUP_HOME` keep the real toolchains. The sandbox unsets `DEEP_THROTTLE`, `DEEP_PERF_LOCK`, `NODE_TEST_CONTEXT`,
`DEEP_PREFLIGHT`, `DEEP_OPEN_ISSUES`, `CARGO_TARGET_DIR`, `DEEP_PROOF_ISSUES`, `DEEP_APPROVERS`,
`DEEP_PROOF_VITEST_REPORT`, `DEEP_HUB_PLANT`, `DEEP_REFERENCE_RECORD` and `NODE_OPTIONS`. Each process a test starts gets
its own process group, stopped by its PID when the test ends. Nothing is killed by name or port.

There are 8 tests. Run on the base on this Mac (an arm64 MacBook, `darwin-arm64`), 2 fail at their assertions, 4 skip
with the platform note before they run, and 2 do their check, pass it, then skip with the platform note, as
`BASE-FAILURE.txt` shows. None passes. Each of the 6 that can't fail on a Mac is named below with the wrong program that
fails it.

## Criteria to tests

Each criterion's ID is `#1121.<first 8 hex digits of the SHA-256 of its "- [ ]" text, trimmed, white space collapsed>`,
as `scripts/proof-change.mjs` works it out. I took them by running `readIssue` on the saved issue. Each test carries its
tag at the start of its name.

| Criterion | Tests (file) | What they require |
|---|---|---|
| AC1 `#1121.73d8f179` 27 of 27 crates build on the Spark | 1 in `spark.test.mjs`, Spark only | `cargo build --workspace --locked` exits 0 and builds every workspace member, N of N. The failure says how many of how many, and which didn't |
| AC2 `#1121.b915783e` `cargo test` on the Spark has no FAIL or BLOCKED | 1 in `spark.test.mjs`, Spark only | The real unit lane's cargo commands through the real `runLanes` in this checkout: the lane isn't FAIL, BLOCKED or INVALID, and its record holds no FAIL or BLOCKED test |
| AC3 `#1121.95fa4a52` Its record lists the tests absent by platform …, by comparison with the Mac's reference list, and the lane is INCONCLUSIVE (platform), not PASS | 2 in `lanes.test.mjs`, anywhere; 1 in `spark.test.mjs`, Spark only | A Mac's run writes each target's `cargo test -- --list` into its unit record, beside `tests`. A Linux run handed that record names each absent test (two whole files, one cfg-gated single test) in its summary and its record, flags no test that ran, and reads `INCONCLUSIVE unit (platform)`, exiting non-zero. On the Spark, against the real Mac record: every Mac test it never ran is listed, four whole test files among them, plus single tests |
| AC4 `#1121.23cb368c` A symlinked spool path is refused by deep-hook on aarch64, and the planted x86_64 constant lets it through and fails, naming the path | 1 in `spool.test.mjs`, checks anywhere, proves on the Spark | The real deep-hook spools a SessionStart to a plain spool (the control), then, with `spool.jsonl` a link to a file elsewhere, leaves that file as it was, the link in place, and says so on stderr. The failure names the link's path and where it points |
| AC5 `#1121.301969cb` env-resources finds a free port on Linux, and a planted hardcoded `/usr/sbin/lsof` fails there, naming the path | 1 in `lsof.test.mjs`, checks anywhere, proves on the Spark; 1 in `lsof.test.mjs`, Spark only | env-local's port kind, through `packages/env-local/src/index.ts`: a port nothing listens on reads free, one a process listens on reads taken, and a lsof really ran. The failure names each lsof it ran and its error (`spawn /usr/sbin/lsof ENOENT`). On the Spark, the hub's own `packages/hub/test/env-resources.test.ts` passes with nothing skipped; its failure names `/usr/sbin/lsof` when the output does |

## The surface (my choice where the issue leaves it open)

These are the assumptions the implementer must match, or dispute through a blind redraft.

- **The unit lane** is reached by a small driver that imports the tree's `scripts/lanes.mjs` in a child, takes the
  `unit` entry of `checks`, drops its vitest and `node --test` commands, and calls `runLanes([that lane], { cwd })`. So
  the reference list must come from the unit lane: its `cargo test` command, or a command the change adds to that lane,
  or `runLanes` itself. A lane of another name isn't run.
- **The reference list comes from `cargo test … -- --list`**, as the issue words it: the stub answers any `cargo test`
  whose arguments after `--` hold `--list`, for every crate or those `-p` names, with cargo's `Running …` and
  `Doc-tests …` lines on stderr and the list on stdout. `cargo metadata` answers for the fixture workspace. A change that
  lists tests another way (running test binaries itself, `--no-run`) won't see the stub's lists.
- **The Mac's reference list is in its unit record, beside `tests`.** The test requires each target's binary name and
  each of its tests' names somewhere in the record's fields other than `lane`, `state`, `host`, `platform`, `tree` and
  `tests`. No field name is fixed.
- **The platform is `process.platform`** (and `os.platform()`, which reads it). A run is "the Mac" when it reads
  `darwin`, and "the Spark" when it reads `linux` and `arm64`.
- **A Linux run is handed the Mac's record both ways** (open question 1): `DEEP_REFERENCE_RECORD` names a copy of the
  Mac's record file, and the same file also sits in that run's `~/.deepbuild/lanes/` under its own name
  (`<tree>-unit.json`), as T7 would fetch it back. The change needs to read one.
- **The absent tests are listed** on lines of the run's output (each line holding the test's name; `runLanes` prints
  each unproven test as `  <STATE> <id>: <note>`), and in the Linux record anywhere but in its PASS rows of `tests`. A
  test that ran and passed on Linux stays a PASS row and is never on a line starting with a state. The natural shape is a
  `tests` row `{ id, state: 'INCONCLUSIVE', note: '<names the platform>', skipped: true }` per absent test, as section
  10a's record has for a test that never ran, but the tests don't require it.
- **The lane line** is the last line starting `<STATE> unit`, as `runLanes` prints it. AC3 requires it to start
  `INCONCLUSIVE unit (platform)`, and the record's `state` to be `INCONCLUSIVE`.
- **env-local's public entry** is `packages/env-local/src/index.ts`, the file its package's `development` export names.
  It's loaded by a small loader that maps `./x.js` to `./x.ts` and compiles TypeScript with this checkout's
  `typescript`. `portKind().free(port)` resolves a boolean. The probe notes the program of every `child_process` call
  env-local makes, and its error, without changing the call, so a failure can name the lsof that ran.
- **deep-hook** is built with `cargo build --locked -p deep-hook --bin deep-hook` in this checkout and run as
  `deep-hook claude-code SessionStart` with the hook's JSON on stdin and only the sandbox's `HOME`. No hub is up, so it
  spools. The spool is `~/.deepbuild/spool/spool.jsonl`, the folder 0700. deep-hook gives its spool write 45 ms from
  its start, which a loaded machine (this Mac ran at a load of 85) often misses before the open. So the control and the
  linked case each try up to 40 calls until one decides: a line in the plain spool, and for the link a stderr line
  naming the spool that isn't the "within the hook's 50 ms" timeout. Every linked call must leave the target file as it
  was. If no call decides, the test fails `INCONCLUSIVE: …`, never PASS.

### Two platforms, one machine

`process.platform` can't be changed for a real child, so the AC3 tests set it: every node process of a run imports a
preload (`NODE_OPTIONS=--import=…/platform.mjs`) that redefines `process.platform` and `process.arch` from
`T1121_PLATFORM` (`darwin-arm64` or `linux-arm64`). The cargo stub reads the same variable. The Mac's run and the Linux
run have their own HOMEs. On a real Mac only the Linux half is pretend, and on the Spark only the Mac half.

### The fixture workspace

Two crates, `t1121-alpha` and `t1121-beta`, each with its library's unit tests and one integration test file. On Linux
the stub's run and list leave out both integration files' tests, as `#![cfg(target_os = "macos")]` on the whole file
does, and one cfg-gated unit test of `t1121-alpha`. Every test that runs passes. The Linux stub never prints an absent
test's name, so any line or record field naming one came from the comparison.

## The tests that can't fail on this Mac

| Test | What it does here | Wrong program that fails it |
|---|---|---|
| AC1, AC2 and AC3's Spark test | Skip: `INCONCLUSIVE (platform): … proven only on Linux aarch64 (the Spark) …` | The base itself, on the Spark: 21 of 27 crates build there (the issue), so AC1 and the `cargo test` run fail |
| AC4 | Checks, passes, then skips with the platform note: the base's macOS constant is right | `x86-nofollow` (twins). Shown failing here in `BASE-FAILURE.txt`: on macOS `0o400000` is `O_NOCTTY`, so the line went through the link, and the failure names the path |
| AC5, env-local | Checks, passes, then skips with the platform note: the base's env-local already runs `/usr/sbin/lsof` on macOS and `/usr/bin/lsof` on Linux | `usr-sbin-lsof` on the Spark; its mirror `usr-bin-lsof`, shown failing here in `BASE-FAILURE.txt` naming `/usr/bin/lsof` |
| AC5, the hub's env-resources | Skips with the platform note | The base itself, on the Spark: `packages/hub/src/stacks.ts` runs `/usr/sbin/lsof` |

The two AC3 tests that run anywhere fail on the base at their assertions: the Mac's record holds nothing beside `tests`,
and the Linux run reads `PASS unit`.

## Open questions for the implementer

1. **How does a Spark run get the Mac's reference list?** Neither the issue nor section 8 says, and T7, which fetches
   records back, isn't landed. The tests offer it both ways (above). If the change reads it another way, such as a
   committed file, say so and ask for a redraft.
2. **"27 of 27".** The base's workspace has 37 members, not 27, and the issue says the count needs a fresh Spark run.
   AC1's test requires every member to build, N of N, and names N.
3. **"Four whole test files".** The Spark test requires exactly four targets absent whole, the issue's value, against
   the real Mac record. If the fresh Spark run finds another number, that's for the owner, not for this test.
4. **A Spark run with no Mac record.** Section 3 says a Spark `cargo test` is never PASS on its own. AC2's test reads only
   that it isn't FAIL, BLOCKED or INVALID, so a change may read such a run INCONCLUSIVE.

## What the tests can't see

- **The Spark, here.** I ran these on a Mac. The Spark-only tests and the Spark halves are written but unrun.
- **deep-app on Linux.** The `image` / `picture()` scope line is covered only by AC1's Spark build.
- **The supervisor's `openUnder`.** Its hardcoded `/usr/sbin/lsof` maps to no criterion except as the hub's suite
  reaches it on the Spark, so no test of its own.
- **The deep-hook test's 0700 folder.** The issue makes that a test edit for its own approved proposal; AC2's Spark run
  sees it only as a FAIL or not.
- **Unblocking #184, #555 and #851.** Not a criterion of this issue.

## Files

- `helpers.mjs`: the sandbox, launching, the lanes driver and platform preload, the cargo stub and fixture workspace,
  reading records, cargo builds, the TypeScript loader and the port probe.
- `lanes.test.mjs`: AC3 on any machine.
- `spark.test.mjs`: AC1, AC2 and AC3 on the Spark.
- `spool.test.mjs`: AC4.
- `lsof.test.mjs`: AC5.
- `twins.json`, `twins/README.md`: the planted wrong programs.
- `BASE-FAILURE.txt`: the run on the base, and the Mac's twins, with paths redacted.

No fixture holds a secret or personal data.
