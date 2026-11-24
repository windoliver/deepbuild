# Acceptance tests for #3172: a cargo target that prints `<its name>: INCONCLUSIVE; …` or `…: BLOCKED; …` and exits 1 is read as it says, not FAIL

I drafted these tests blind from these sources:

- issue #3172, as saved verbatim for this job
- `docs/technical-design.md`: Dogfooding, Tests written first, Failing on an assertion
- `docs/parallel-proof.md`, section 3
- AGENTS.md
- the base commit `61aa8eb06`

At the base I also read `scripts/lanes.mjs` (`cargoResults`, `crates`, `testsOf`, the `unit` lane's command and how
`runLanes` logs a run), `scripts/proof-runs.mjs` (twins and the at-assertion rule), `scripts/proof-change.mjs`
(`criterionId`), `tests/acceptance/992/app.rs`, `crates/deep-replica/Cargo.toml`, the Spark's run
`docs/evidence/1121/spark-test-0c73a8a4.txt`, and `tests/acceptance/1121/` and `1115/` for their shape. The helpers are
written here, never imported from another suite. I read no PR, branch or other work on this issue. Per AGENTS.md, the
implementing agent doesn't edit these tests. A dispute goes to a blind redraft by this job.

## Running them

```sh
# The Mac (darwin arm64): AC1 and AC2; AC3 skips. About 15 s, cargo building four tiny fixtures.
node --test 'tests/acceptance/3172/*.test.mjs'

# The Spark (Linux aarch64): all three. Seconds. In a checkout of the tree there, with cargo's and node 24's env:
source ~/.cargo/env; export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$PATH"
node --test 'tests/acceptance/3172/*.test.mjs'
```

They're `*.test.mjs` under `tests/acceptance/`, so the unit lane doesn't pick them up; they run by hand and in the proof
lanes. `cargo`, `rustc` and `node` 24 must be on `PATH`. Nothing here builds the repository's crates: AC1 and AC2 build
a fixture workspace of two crates in a temporary folder, and AC3 builds one source file with `rustc`, so the suite is
cheap on the Spark's shared disk.

**A test that can't prove its criterion on the machine it runs on skips**, with a note that starts `INCONCLUSIVE
(platform):` and names the machine. A skip is unrun, never a pass (AGENTS.md, invariant 2). AC3's test skips on the
Mac, so AC3 is proven only by a run off macOS, the Spark's.

## Real components and stand-ins

Real: the checkout's own `cargoResults` and `crates` of `scripts/lanes.mjs`, the pair `testsOf` reads a cargo test run
with, imported in a process of their own from the checkout under test; the machine's cargo, running the `unit` lane's
command at the base, `cargo test --workspace --locked --no-fail-fast`, on a real workspace of real `harness = false`
targets that print their line and exit 1; the log as the lane keeps it, stderr and stdout in one stream in the order
written, trimmed; and the Spark's own run of the whole workspace at `0c73a8a4`, the 19 targets the issue names among
them, as #1121 saved it. Stand-ins:

- **The workspace** in AC1 and AC2 is a fixture, not the repository's 54 crates: two packages (two, so cargo names a
  failed target `-p <package> --test <target>` as it names the real workspace's; with one it leaves `-p` out), a library
  with one passing test, and the `harness = false` targets each test names. It runs offline in seconds on either
  machine.
- **The lane is read at its reader**, `cargoResults(output, status, crates(cwd))`, as the issue's Proof asks ("a
  fixture target of each kind through `cargoResults`"), not through `runLanes`, its throttle and its record.
- **AC3 builds `acceptance_992_app` with `rustc`**, not `cargo test -p deep-replica`: the source is the one `cargo
  metadata` names for that target, built with its package's edition as a binary, as cargo builds a `harness = false`
  target. Off macOS that source's `main` needs only std, as at the base, and a cold build of deep-replica and its
  dependencies (deep-app, gpui) on the Spark is hours and tens of gigabytes. It runs with no `DH992_APP_CASES`, as the
  lane's `cargo test` runs it.

## Criteria to tests

Each criterion's ID is `#3172.<first 8 hex digits of the SHA-256 of its "- [ ]" text, trimmed, white space
collapsed>`, as `scripts/proof-change.mjs` (`criterionId`) works it out; I took them by running `readIssue` on the
issue's text. Each test carries its tag at the start of its name.

| Criterion | Test (file) | Runs on | What it requires | On the base |
|---|---|---|---|---|
| AC1 `#3172.5a315338` a target that exits non-zero having printed `<its name>: INCONCLUSIVE; <reason>` and reported no test reads INCONCLUSIVE with that reason, never FAIL or PASS; `…: BLOCKED; …` reads BLOCKED | 4 in `inconclusive.test.mjs` | Mac and Spark | **1.** A run whose only failing target prints `inconclusive_target: INCONCLUSIVE; <reason>`: that target has exactly one failure, its own ID, `INCONCLUSIVE`, its message holding the reason; the run has no FAIL at all and no pass of the target. **2.** The same for `blocked_target: BLOCKED; <reason>`, read `BLOCKED`. **3.** Both, and a target with no such line, in one run: each of the two reads its own state, the INCONCLUSIVE one with its reason. **4.** The Spark's run at `0c73a8a4`: each of the 19 targets reads as its line says, the 18 `INCONCLUSIVE` with their reasons and `acceptance_992_app` `BLOCKED`, and none has a pass | All four fail at their assertions on both machines: each target reads `FAIL`, "the target failed outside any test it reported" |
| AC2 `#3172.531b8e24` a target that exits non-zero with no such line still reads FAIL | 3 in `fail.test.mjs` | Mac and Spark | A target that prints `plain_failure: the fixture could not open its window` and exits 1 reads `FAIL`, every failure of it `FAIL`: **1.** alone in its run, **2.** beside targets that print INCONCLUSIVE and BLOCKED lines, **3.** a target that prints another target's line, `inconclusive_target: INCONCLUSIVE; …`, which is no line of its own | All three pass on both machines; each fails on a twin (`twins/README.md`) |
| AC3 `#3172.f7060cf1` `acceptance_992_app` off macOS states INCONCLUSIVE for its platform, as its 18 neighbours do | 1 in `app-992.test.mjs` | Off macOS (the Spark) | deep-replica's one test target `acceptance_992_app`, built for this machine and run, exits non-zero and prints exactly one line starting `acceptance_992_app:`, which is `acceptance_992_app: INCONCLUSIVE; <reason>`, the reason naming a platform as `lanes.mjs`'s `PLATFORM` pattern reads one (macOS, Linux, darwin, Metal, GPU, platform), as the 18 neighbours' do | Fails at its assertion on the Spark: the line says `BLOCKED`. Skips on the Mac |

## The surface (my choice where the issue leaves it open)

An implementer must match these. Each is the least I could add to what the base and the issue already say.

- **A target's ID** is the base's: `cargo <the arguments that rerun it>`, as `cargo -p fixture-3172 --test
  inconclusive_target`. A target read INCONCLUSIVE or BLOCKED is one entry of `failures` with that ID and that `state`.
- **"With that reason"**: the entry's `message` contains the reason as the line gives it, the text after `; `. Other
  words around it are free. Of a BLOCKED reading only its state is required, as the criterion says.
- **"Never FAIL"**: in a run whose only failing target printed its line, `failures` holds no FAIL at all, so neither the
  target nor the run as a whole (`cargo test`) reads FAIL. **"Never PASS"**: no ID in `passed` is the target's or a test
  under it.
- **"Its name"** is the target's name as cargo's `Running … (…/deps/<name>-<hash>)` line gives it, the word after
  `--test` in the arguments that rerun it. A line under one target that names another isn't "such a line" (AC2's third
  test).
- **A target's line** is read where cargo's output puts it: after the target's `Running` line and before cargo's `error:
  test failed, to rerun pass …` line, in a run of the whole workspace with `--no-fail-fast`, which ends with every failed
  target listed again (`error: N targets failed:`).
- **AC3** reads only what the target prints and its exit. The reason is free if it names its platform; the Spark's 18
  say "… macOS only, so nothing ran" and the like.

## What these tests can't see

- **The whole lane.** No test runs `runLanes`: its summary line, record and exit for a Spark run of these targets are
  #1121's and section 3's (the Spark's lane is INCONCLUSIVE (platform) whatever its reader says).
- **The 19 targets run anew on the Spark.** The issue's Proof ends with "then the 19 targets on the Spark". AC1's fourth
  test reads their saved run at `0c73a8a4`, and AC3 runs one of them; a fresh `cargo test --workspace` on the Spark,
  after the fix, is the implementer's hand run.
- **A target that printed such a line and also reported tests.** The criterion is of a target that reported no test; no
  test here says how one that did is read.
- **A target that prints such a line and exits 0**, such as `screens: skipped; …` in the Spark's run, is outside the
  criteria.
- **#3100's panicking form** (`INCONCLUSIVE:` in a test's panic) is that issue's, as #3172 says.

## Files

- `helpers.mjs`: the machine, the temporary folder, running a process, the fixture workspace and its targets, the
  reader, the Spark's saved run and the 19 targets' lines.
- `inconclusive.test.mjs` (AC1), `fail.test.mjs` (AC2), `app-992.test.mjs` (AC3).
- `twins.json`, `twins/`: the planted wrong programs for AC2 (`twins/README.md`).
- `BASE-FAILURE.txt`: the run on the base on both machines, each twin's run, and the checks of the tests on throwaway
  right programs.

Outside this folder, for the implementing job: none. `scripts/lanes.mjs` is guarded lane code, and
`tests/acceptance/992/app.rs` is #992's test, so AC3's one-word change to it goes by that issue's rules.

No fixture holds a secret or personal data; the paths in `BASE-FAILURE.txt` are redacted.
