# #3171 acceptance tests: the span test on a shared GPU reads PASS or INCONCLUSIVE, never FAIL, and states its readings

Written blind at the base `ccafae68f` (main, "Merge pull request #3168 …"), from issue #3171, the design and that base.
The job saw no fix: it read no pull request (not #3127, which the issue names for its evidence), no other branch,
worktree or commit after the base, and no notes folder. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## Sources

- **The issue**, #3171: the failure (`-p deep-gpu --lib` › `spans::tests::a_span_holds_its_submission_and_not_the_gap_after_it`
  panics at `crates/deep-gpu/src/spans.rs:508` with "trial 0: 153.56… ms covered, the passes' own 13.57…: the gap
  counted" in whole-workspace runs on the Spark, and passes alone), its two readings of it (the span counts time that
  isn't its submission's on a shared GPU, or the 100 ms bound is too tight there and the reading is INCONCLUSIVE), two
  criteria and its Proof line (three whole-workspace `cargo test` runs on the Spark, and the test alone beside a GPU
  load).
- **The design**, `docs/technical-design.md`: Dogfooding and "Tests written first"; #3171 links no section
  (`node scripts/design-section.mjs --issue 3171`: "no section"). **AGENTS.md.**
- **The base, for surfaces only**: `crates/deep-gpu/src/spans.rs` (the test, its 200 ms gap and 100 ms bound, its
  message), `device.rs` (`Gpu::open`, `Backend::Gpu`, `Device`), `counted.rs` (`Wgpu`, `Queue`), `Cargo.toml`;
  `scripts/lanes.mjs` (`cargoResults`, `crates`, `worst`, `readSkips`, the `alone` list and `lane.json`),
  `scripts/proof-runs.mjs` (`atAssertion`, `twinsOf`, `prepareRuns`, `wrongProgram`), `scripts/proof-change.mjs`
  (`criterionId`, `isTestFile`, `readIssue`); `crates/deep-hook/tests/busy_disk.rs` (how a cargo target reads
  INCONCLUSIVE in the lanes); the suites `tests/acceptance/2149/`, `2629/` and `3016/` for the house form.

## Run

```sh
node --test --test-concurrency=1 tests/acceptance/3171/ac1-readings.test.mjs tests/acceptance/3171/ac2-shared.test.mjs
```

Node 24 and a Rust toolchain (`cargo` on PATH or in `~/.cargo/bin`); a GPU with timestamp queries (Metal on a Mac,
Vulkan on the Spark). The first test builds `deep-gpu`'s test targets (`cargo test --locked -p deep-gpu --no-run`) and
the load (`cargo build --locked -p deep-gpu --example acceptance_3171_load`); a build that fails fails the test before
its assertion. Each test then runs `cargo test --locked -p deep-gpu --no-fail-fast -- a_span_holds_its_submission_and_not_the_gap_after_it --show-output`
once, a few seconds (the first build takes minutes; the suite took 14 s on the Spark with it built, 45 s on the Mac
at a load of 150), and reads its output with the lanes' own `cargoResults` (`scripts/lanes.mjs`). Nothing is
written in the checkout but cargo's `target/`.

**Lane needs.** `lane.json` puts this folder in the alone block: the tests use the GPU and start a second process that
keeps it busy, so nothing may run beside them, and they must not run beside the workspace's other GPU tests (which is
the very sharing the issue is about). The cargo lane's whole-workspace `cargo test` builds the load as an example and
never runs it.

## The load: `load.rs` (the example `acceptance_3171_load`, registered in `crates/deep-gpu/Cargo.toml`)

A second process that keeps the GPU busy, as the Proof line's "GPU load": it opens the GPU through `deep_gpu::device`,
times a full-screen pass looping 1,024 times a pixel over a 4,096 px target (doubling its instances until one pass
takes 50 ms), then draws passes sized to about 200 ms of GPU time, two submissions at a time, back to back, for the
seconds its argument gives. It prints `busy <ms>`, the wall time of its first two passes, once they are done; a test's
message gives half of it as the load's pass time. The tests start it, wait for that line, run the span test, and stop
it by its own handle (SIGKILL to that PID only). 200 ms is past the test's 100 ms bound, so a span that waits for one of
its passes counts more than the bound allows; on the Spark, at the base, a span beside it covers one such pass (about
212 to 216 ms covered, the passes' own 14; half of `busy` 197 to 203 ms), as the issue's whole-workspace runs did (153 ms
covered, 13.6 own). On the Apple M6 half of `busy` reads 72 to 76 ms (its two submissions overlap, or the sizing
undershoots there), and at the base the span test passes beside it, as it passed beside a load of 1.25 s passes in a
trial run while this suite was drafted: on this Mac no span was held past the bound behind the other process's work.

## Criteria to tests

IDs are `criterionId` in `scripts/proof-change.mjs` (the first 8 hex digits of SHA-256 of each criterion's text,
trimmed, white space collapsed), checked against the issue body. Each test's name starts with `AC<n> #3171.<id>` from a
const string in its own file.

| ID | Criterion | Tests, and what each asserts | Wrong programs it fails on |
|---|---|---|---|
| AC1 `#3171.952eea5a` | It is known which of the two it is: the covered time and the passes' own timestamps, read on the Spark alone and beside a second process that keeps the GPU busy | `ac1-readings.test.mjs`, two tests: alone, and beside the load, the span test (whatever it reads) states in its output, for each trial it ran from trial 0 on with none left out, `trial <k>: <covered> ms covered, the passes' own <own>` (the base message's words), each a time above 0 | The base, alone, on both machines: a passing test states nothing. The twin `silent-pass` |
| AC2 `#3171.52591b24` | In a whole-workspace `cargo test` on the Spark the test passes, or states that the GPU was shared and reads INCONCLUSIVE; it never reads FAIL for another process's work | `ac2-shared.test.mjs`, two tests. Beside the load: the lanes read the span test as PASS or INCONCLUSIVE, never FAIL (nor BLOCKED, INVALID or not run); an INCONCLUSIVE's message names the GPU as shared; a PASS has every trial it states within 100 ms of the passes' own. Alone: the lanes read it PASS, every trial it states within 100 ms | The base, beside the load, on the Spark: FAIL, 216.1 ms covered, own 13.7 (it passes on the Mac). The twins `gap-counted` (both machines) and `bound-loosened` (the Spark) |

### How each criterion is read

**AC1.** "Which of the two it is" is a conclusion drawn from readings, and only a person can draw it: the implementer
records, in the change's evidence (for example `docs/evidence/3171/`), the readings this suite's runs print on the
Spark, alone and beside the load, and says which of the issue's two it is. That part is judged by hand from the
evidence and stays open in the trace lane until then. What a test can hold is that the readings are there to judge, in
both conditions, from the test the issue names: today a passing run says nothing of them. The words are the base
message's, the one the issue quotes, so any run, PASS, FAIL or INCONCLUSIVE, can be read the same way. "The passes'
own timestamps" is read as that message gives them, as the union of the two passes' own begin-end spans in ms.

**AC2.** The whole-workspace runs of the Proof line are evidence: three `cargo test --workspace --locked
--no-fail-fast` runs on the Spark, read with the lanes, each with the span test PASS or INCONCLUSIVE (the cargo lane
runs them; hours each, so no test here repeats them). The test here makes the sharing those runs met on purpose and
reads the result the same way the lanes read the whole run (`cargoResults`), so it is decided on any machine, in a few
seconds, and fails on the base wherever the load pushes a span past its bound (the Spark). The test is found by its
own name in any `deep-gpu` target, the library's or one of its own. "Reads INCONCLUSIVE" is the lanes' reading, not a
word in a panic: the lanes read a libtest panic as FAIL whatever it says, and read INCONCLUSIVE from a target's
`test result: INCONCLUSIVE.` line or a `test <name> ... INCONCLUSIVE` line (`cargoResults`; `crates/deep-hook/tests/busy_disk.rs`
is a target that prints them). A `test result: INCONCLUSIVE.` line counts for the span test when it names it. The
span test's own bound is never loosened here: a PASS must hold the base's 100 ms on every trial it states, so a span
that counts the CPU's 200 ms gap still reads FAIL. Alone, nothing shares the GPU, so the test must read PASS there, not
INCONCLUSIVE: an INCONCLUSIVE everywhere would never read FAIL and would prove nothing.

A silent PASS beside the load (a trial past the bound ending the test unread) passes AC2's first test but fails AC1's:
it states no reading.

## Twins (`twins.json`, `twins/<name>/crates/deep-gpu/src/spans.rs`)

Each is the whole of the base's `spans.rs` with one planted change, marked by a `#3171's planted wrong program` comment.

- **`silent-pass`** (AC1): the test returns as soon as a trial is past the bound, and states no reading. Alone, it
  passes and states nothing: AC1's alone test fails at its assertion, on both machines.
- **`gap-counted`** (AC2): only a frame's first submission begins a span, so the second pass's end moves the first
  span's end and the span holds the CPU's 200 ms gap. The span test fails alone ("the gap counted"): AC2's alone test
  fails at its assertion, on both machines (beside the load it fails too).
- **`bound-loosened`** (AC2): the test states its readings every trial and its bound is 1,000 ms, past the gap. Beside
  the load on the Spark it reads PASS with 228 ms covered and 14 own: AC2's beside-the-load test fails at its
  assertion. On the Mac the load pushes no span past 100 ms, so there it passes; `gap-counted` fails AC2 there.

All three compile at the base. Results on each machine at the base are in `BASE-FAILURE.txt`.
