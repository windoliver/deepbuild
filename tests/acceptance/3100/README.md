# Acceptance tests for #3100: the workspace builds and tests natively, and stated panics read as their state

Written blind at the base `b6317234f` (main), from issue #3100, the design and that base. The job saw no fix and read no
other branch, worktree or pull request for this issue. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## Sources

- **The issue**, #3100: its account (deep-player's `net.rs` calling wasm-only crates natively; the readings the unit
  lane's reader counts as FAIL though they panic with `INCONCLUSIVE:` or `BLOCKED:`; the failures; the ac5 cases blocked
  by design), its three criteria and its Proof line.
- **The design**: `docs/parallel-proof.md` (how a test run reads, section 10a; "Listed failures lapse") and
  `docs/technical-design.md` (Dogfooding). #3100 links no design section (`scripts/design-section.mjs` finds none).
  **AGENTS.md.**
- **The base, for surfaces only**: `scripts/lanes.mjs` (the unit lane's cargo command, `cargoResults`, `crates`,
  `testsOf`, `readRun`, the throttle class and lease each lane command runs under), `scripts/known-failures.json` and
  `scripts/known-failures-check.mjs` (the listing's form and rules), `scripts/throttle.mjs`, `scripts/lease`,
  `rust-toolchain.toml`; and, for the house form and how a workspace-wide cargo run was read before,
  `tests/acceptance/689-redraft-2047/` (what was needed is copied into `helpers.mjs`, not imported).

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed and white space collapsed (checked against
the issue's lines). Each test's name starts with its tag. The files are `node --test` files; run them one at a time,
`node --test --test-concurrency=1 tests/acceptance/3100/` (AC1 and AC2 build the whole workspace).

| ID | Criterion (short) | Test, and what it asserts |
|---|---|---|
| `#3100.18bcb434` | `cargo build --workspace --locked` succeeds natively | `ac1-build.test.mjs`. The command at the checkout's root, for the host's own target, exits 0 |
| `#3100.40d22871` | `cargo test --workspace --locked --no-fail-fast` leaves no FAIL but listed ones with an open issue | `ac2-test.test.mjs`. The command at the root; its output through `cargoResults`; every ID read as FAIL is listed under `failures` in `scripts/known-failures.json` with a note naming its issue, and that issue is open |
| `#3100.89720c19` | A cargo test panicking with `INCONCLUSIVE:` or `BLOCKED:` reads INCONCLUSIVE or BLOCKED, never FAIL or PASS | `ac3-stated-panics.test.mjs`. A throwaway crate's real tests, run by the unit lane's cargo command and read by `cargoResults`: each stated panic reads as the state it names and as nothing else, with no FAIL under its ID or its target's; a plain failure beside them still reads FAIL, and the passes PASS |

## How each criterion is read

**AC1.** "Natively" is for the machine's own target: no `--target`, and `CARGO_BUILD_TARGET` is cleared. "On main" is
the checkout the test is in, with its own toolchain (`rust-toolchain.toml`; `RUSTUP_TOOLCHAIN` is cleared). Success is
exit 0; a failure names the crates that don't compile and the first errors.

**AC2.** The command is the unit lane's own (`scripts/lanes.mjs`, the `unit` lane), at the root. "The unit lane reads as
FAIL" is the state `cargoResults` gives an ID, with the workspace from `crates()`, both of the checkout under test, as
the lane's `testsOf` calls them. "Lists with an open issue": the ID is a key of `failures` in
`scripts/known-failures.json`, its note ends `(#<issue>, added <YYYY-MM-DD>)` (the form `known-failures-check.mjs` holds
an entry to, and the only way an entry names its issue), and `gh issue view <issue>` says `OPEN` when the test runs. An
unlisted FAIL, one listed without an issue, or one whose issue is closed fails the test, each named with why. IDs read
BLOCKED, INVALID or INCONCLUSIVE aren't FAIL, so they don't fail it; the test prints each as a diagnostic, and they
stay unproven in the lane (the issue's ac5 cases need a person, so an unattended run never exits 0). The 14-day lapse
of a listing is the lint lane's check (`known-failures-check.mjs`), not read here.

**AC3.** The issue's wording, "read as INCONCLUSIVE or BLOCKED", is read as each panic's own state: `INCONCLUSIVE:` as
INCONCLUSIVE and `BLOCKED:` as BLOCKED, as the lanes keep a stated failure's own state elsewhere (`stateOf`). "Never
FAIL" covers the target too: a target whose only failures are stated panics must not read FAIL as a whole ("the target
failed outside any test it reported"). The crate, `probe3100`, has no dependencies and lives in the test's own
temporary folder with its own target folder; it takes the checkout's `rust-toolchain.toml`, so its output is the pinned
release's. Its library target holds an `INCONCLUSIVE:` panic (`panic!`), a `BLOCKED: setup: …` one (`assert!`'s
message) and a pass; its `plain` test target holds a plain `assert_eq!` failure, an `INCONCLUSIVE:` panic beside it and
a pass. The plain failure must read FAIL and the passes PASS, so a reader that reads every failure as unproven, or loses
tests, fails as well.

**All three.** A run the machine stopped or kept from starting reads INCONCLUSIVE, never PASS: no build grant within
its wait, the throttle ending a grant held past its bound, a time limit, a signal, a toolchain or component not
installed (rustup never downloads one here), crates that can't be fetched, a full disk, or a compiler or test binary
the system killed. In AC2 a FAIL of a test the run reached still fails the test when the output carries such a mark;
only target-level failures are then put down to the machine.

## How they run

AC1 and AC2 run their command as a lane runs one: `scripts/throttle.mjs build --wait 600 --` (a build grant of the
machine's table; the Mac runs one build at a time), then `scripts/lease`, at `nice -n 10`, with
`CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless the caller sets them (as the repository's scripts build).
Each keeps its whole output in `target/acceptance-3100/ac1-cargo-build.log` and `ac2-cargo-test.log`. AC3 runs its
probe's cargo directly: a crate of three small files, built in seconds.

## What no check here can hold

- **The whole unit lane.** AC2 runs the unit lane's cargo command and reads it with the lane's reader, not the lane
  around it (its vitest and node suites, `readRun`, the evidence record).
- **"On main".** The tests judge the checkout they are in. Run them on main once the change lands, or on the change
  merged with main.
- **The proof lane's 20-minute cap.** AC1 and AC2 build the whole workspace, which takes from minutes (warm) to hours on
  this machine at its load, so they finish only by hand.
- **The lapse of a listing.** Read by the lint lane, not here.

## What the implementer must provide

- deep-player building natively under its default features, and the whole workspace with it.
- `cargoResults` (or what replaces it as the unit lane's reader of cargo test's output, called as `testsOf` calls it
  today, `cargoResults(output, status, crates(cwd))`) reading a test whose panic message starts `INCONCLUSIVE:` or
  `BLOCKED:` as that state.
- Every other workspace test passing, or listed in `scripts/known-failures.json` with its open issue.
- If `scripts/affected.mjs` should treat the two long files as slow, a line in `scripts/lanes.mjs` (this job edits
  nothing outside its folder):

```js
// #3100's acceptance tests: AC1 builds the whole workspace; AC2 builds and tests it.
slow.push('tests/acceptance/3100/ac1-build.test.mjs', 'tests/acceptance/3100/ac2-test.test.mjs');
```

## What was run

See `BASE-FAILURE.txt` for the commands and their output at the base.
