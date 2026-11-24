# Acceptance tests for #3295: the late-close cli test reads INCONCLUSIVE, not FAIL, when the hook is given no time

I drafted these tests blind from these sources:

- issue #3295, as its body reads at the base
- AGENTS.md, `docs/technical-design.md` (Dogfooding and the proof sections)
- the base commit `a288ae247`

At the base I also read `crates/deep-hook/tests/cli.rs` (the late-close test and its helpers),
`crates/deep-hook/src/main.rs` (`forward`, `watchdog`, `unanswered`, `spool_by`, `RULING_LIMIT`),
`scripts/lanes.mjs` (`cargoResults`, `crates`, #3100's reading of a panic's state), `scripts/proof-runs.mjs` (tags,
twins and `lines.json`, the at-assertion rule, the 20-minute cap) and `tests/acceptance/3170/` for its shape. I read no
other branch, PR or session's notes. Per AGENTS.md, the implementing agent doesn't edit these tests; a dispute goes to a
blind redraft by this job.

## Running them

```sh
node --test --test-concurrency=1 tests/acceptance/3295/late-close.test.mjs
```

`cargo` (the toolchain `rust-toolchain.toml` names, with the workspace's git dependencies already fetched) and `node` 24
must be on `PATH`. The folder runs alone (`lane.json`): the test under it reads the hook's exit against 500 ms and 1 s.
A cold build of deep-hook takes about 3 minutes on a loaded Mac; the three tests share one copy and one target folder, so
the later builds take seconds.

## The surface

- **The late-close test** is `a_call_whose_agent_closes_stdin_late_is_decided_and_spooled_without_waiting_for_it` in
  `crates/deep-hook/tests/cli.rs`, as the checkout holds it, run by the issue's command,
  `cargo test -p deep-hook --test cli --locked`, narrowed with `-- --exact <that test>`.
- **How it reads** is how the lanes read it: cargo's whole output goes through `cargoResults` of the checkout's
  `scripts/lanes.mjs`, which since #3100 reads a failed test whose panic starts `INCONCLUSIVE:` as INCONCLUSIVE. So
  "reads INCONCLUSIVE, never FAIL or PASS" is the state the lanes give that test.
- **The checkout is never written.** The workspace (manifests, `Cargo.lock`, `.cargo`, `crates`, `vendor`, `tests`,
  `adapters`) is copied, copy-on-write where the disk can (`cp -c` on APFS, `--reflink=auto` on Linux), into a
  temporary folder with its own `CARGO_TARGET_DIR` and `HOME`; each build writes its `main.rs` there.

## The stand-ins

Each stand-in is the checkout's own `crates/deep-hook/src/main.rs`, written into the copy with a few lines added at
lines found by their text, each of which must be there exactly once. Every stand-in also appends `start` to a log in the
temporary folder (an absolute path compiled in, since the cli test clears the hook's environment) at the top of
`forward`, so a run shows how many times the hook started. They are the scenarios, not wrong programs of the change: they
exist on the base and on the change alike, and are built by the test itself.

| Stand-in | What is added | What the hook then does |
|---|---|---|
| `starved` | `std::thread::sleep(RULING_LIMIT + 300 ms)` in `forward` right after `READ_RULES.store(true, …)`: rules.json is read (there is none, so no fail_closed entry holds the call) and the call is not | The issue's starved hook: its main thread waits past `RULING_LIMIT` before it reads the call, so the watchdog lets the call through at 500 ms with exit 0 and nothing spooled |
| `waits-for-close` | At the top of `forward`, before the watchdog starts, stdin read to its close into a buffer; the call is then read from that buffer | Decides only once its agent closes stdin, so the late-close test kills it at its one-second deadline |
| `never-spools` | `spool_by` returns at once | Reads, matches and allows the call (exit 0), and spools nothing |

Why this way: a starved hook can't be made by load deterministically, and the cli test spawns the binary cargo built
(`CARGO_BIN_EXE_deep-hook`) with its environment cleared, so no variable or wrapper can slow the hook's main thread
alone. A build of the checkout's own source with one line added is the least that does it, and the issue names it. One
copy serves all four builds (the checkout's hook as it is, then the three stand-ins), so only the first is cold.

## Criteria to tests

Each ID is `#3295.<first 8 hex digits of the SHA-256 of its "- [ ]" text, trimmed, white space collapsed>`, as
`criterionId` in `scripts/proof-change.mjs` works it out. Each test carries its tag at the start of its name. All are in
`late-close.test.mjs`.

| Criterion | Test | What it requires |
|---|---|---|
| `#3295.63a9095d` still fails on a hook that decides only once stdin closes | `#3295.63a9095d the late-close test still fails on a deep-hook that decides only once its agent closes stdin: killed at the one-second deadline` | The late-close test reads PASS on the checkout's own hook (the control), and on `waits-for-close` the hook started, the lanes read the test FAIL, and the test ran at least 1 s (the hook was killed at the deadline, not let through before it) |
| `#3295.2acd3e71` still fails on a hook that allows the call and never spools it | `#3295.2acd3e71 the late-close test still fails on a deep-hook that allows the call and never spools it` | The control reads PASS, and on `never-spools` the hook started and the lanes read the test FAIL |
| `#3295.fae86cca` INCONCLUSIVE on a hook given no time to read its call | `#3295.fae86cca the late-close test reads INCONCLUSIVE, never FAIL or PASS, on a deep-hook given no time to read its call` | On `starved`: not PASS; the lanes read INCONCLUSIVE; its panic's first line starts `INCONCLUSIVE: ` and names the reason (no time, starved, 500 ms, `RULING_LIMIT`, the watchdog or the CPU); the hook started at least 20 times; the test ran at least 20 × 0.5 s = 10 s |
| `#3295.ef4b8343` On the Spark at load 100 or more, the cli target reads the late-close test PASS or INCONCLUSIVE, with the load recorded | None: **checked by hand**, as the criterion says | A person runs `cargo test -p deep-hook --test cli --locked` on the Spark while `/proc/loadavg` reads 100 or more, records the load before and after, and reads the late-close test's line. It stays open in the trace lane, so a commit says `Part of #3295` |

A control that the lanes read INCONCLUSIVE (the machine starved the checkout's own hook) skips the first two tests with
a note starting `INCONCLUSIVE:`: a stand-in's failure then proves nothing, and a skip is unrun, never a pass.

## On the base

| Test | Result |
|---|---|
| `#3295.63a9095d` | Passes: the late-close test fails on `waits-for-close`, killed at the deadline |
| `#3295.2acd3e71` | Passes: the late-close test fails on `never-spools` |
| `#3295.fae86cca` | FAILS at its assertion: on `starved` the late-close test panics `the call is spooled: ""` after one try, which the lanes read FAIL |

`BASE-FAILURE.txt` holds the run on the base on the Mac (load 87 at its start) and each twin's run of its test there.

## Twins

The first two criteria hold on the base already, so each names a planted wrong program in `twins.json`. A twin is a
`lines.json` that edits the change's `crates/deep-hook/src/main.rs`, product source only; neither touches a test path.
Each makes its test fail at its control assertion: the checkout's own hook is then the wrong program, and the late-close
test fails on it.

| Criterion | Twin | The planted fault | How its test fails |
|---|---|---|---|
| `#3295.63a9095d` | `waits-for-close` | The read loop no longer stops at the call's end but reads to stdin's close, and the watchdog waits for the request with no limit | The late-close test is killed at its deadline on the checkout's own hook, so the control reads FAIL |
| `#3295.2acd3e71` | `never-spools` | `spool_by` returns at once: every call is allowed unspooled | The late-close test reads FAIL on the checkout's own hook (`the call is spooled: ""`) |

## What these tests can't see

- **The Spark under load** (`#3295.ef4b8343`): by hand only.
- **The other two tests the issue names** (`a_call_its_agent_sends_past_the_watchdog_is_still_spooled` and
  `a_hook_given_no_time_past_the_watchdog_with_its_call_sent_is_still_spooled`): the issue asks the implementer to check
  them, and its criteria name only the late-close test.
- **A real starved CPU**: the stand-in sleeps where a loaded machine would not schedule the main thread; the watchdog's
  decision is the checkout's own either way.

## Files

- `late-close.test.mjs`: the three tests, the copy, the stand-ins and the lanes' reading.
- `lane.json`: the folder runs alone.
- `twins.json`, `twins/`: the planted wrong programs.
- `BASE-FAILURE.txt`: the run on the base and each twin's run.

No fixture holds a secret or personal data.
