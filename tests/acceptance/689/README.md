# Acceptance tests for #689: pin Rust 1.99.1, and keep rustup's and Cargo's homes for every check

These tests were drafted blind from issue #689 (its text as of October 22), AGENTS.md, `docs/technical-design.md` and the base commit, which has no implementation. Per AGENTS.md, the implementing agent doesn't edit them. A dispute goes to a blind redraft by this job.

Run them from the repository root with:

```sh
node --test 'tests/acceptance/689/*.test.mjs'
```

They're `*.test.mjs` under `tests/acceptance/`, so the unit lane doesn't pick them up: run them by hand. They need Node 24.22 or newer, rustup with the 1.99.1 toolchain installed, and `/usr/bin/time` (the preflight measures its check workload with it). They run offline and take about 6 s. No test downloads a toolchain: the criterion 1 test runs `rustc` with `RUSTUP_AUTO_INSTALL=0`, so a pinned toolchain that isn't installed fails the test instead of downloading. The criterion 3 tests run no real Rust or npm at all.

On the base, the criterion 1 test and the first criterion 3 test fail, each for the reason its criterion names. The second criterion 3 test passes on the base, as it should: the base passes the caller's values through untouched. It guards against an implementation that overwrites them. `BASE-FAILURE.txt` has the base output and the planted programs each test was run against.

## What each test proves

### `toolchain.test.mjs`: criterion 1

"`rustc --version` run at the repository root reports `1.99.1`". The test runs `rustc --version` with its working directory at this checkout's root (three folders up from this file) and requires stdout to start with `rustc 1.99.1 `. It removes `RUSTUP_TOOLCHAIN` from the environment, so only the checkout's own pin can choose the compiler, never a caller's override. On the base, rustup's default toolchain answers (`rustc 1.95.0` on this machine). A pin to another installed release (1.93.0) fails too.

### `preflight-env.test.mjs`: criterion 3

"The preflight's check workload runs with `RUSTUP_HOME` and `CARGO_HOME` set to the user's `~/.rustup` and `~/.cargo` when the caller left them unset, and with the caller's own values when set."

The surface is `scripts/preflight`, the entry the issue names and `npm run preflight` runs. `helpers.mjs` copies this checkout's `scripts/` into a temporary folder and runs the copy's `scripts/preflight` as a process, so the real `preflight`, `preflight.mjs`, `checks.mjs`, `lanes.mjs` and `benchmark.mjs` all run. Only the lanes' commands are stand-ins, each a recorder that writes the command it stands for and the `RUSTUP_HOME` and `CARGO_HOME` it was started with:

- `cargo` and `npm` are recorders first on `PATH`;
- the lanes' own node scripts (`repo-rules`, `canvas-lint`, `conformance-lint`, `catalogue-drift`, `corpus`, `parity`) are replaced by recorders in the copy, and `perf.mjs` by a no-op;
- `node_modules/typescript/bin/tsc` and `node_modules/vitest/vitest.mjs` are recorders, and `tests/record.test.mjs` is one the unit lane's `node --test` runs.

The tests keep the records from the typecheck lane's first command on. `warm()`'s untimed builds before it are left out, since they aren't the check workload. Each test first requires a command from every lane (`tsc`, `cargo fmt`, `cargo clippy`, `vitest`, `cargo test --workspace --locked`, `node --test`, `catalogue-drift`, `corpus`, `cargo build`, `parity`), so a run whose lanes never started can't pass. Then it requires every lane command to have the expected pair:

1. **Unset.** The caller's `RUSTUP_HOME` and `CARGO_HOME` are removed. Every lane command must see `join(os.homedir(), '.rustup')` and `join(os.homedir(), '.cargo')`. The test leaves the caller's real `HOME` in place, so an implementation that reads `$HOME` and one that reads the account's home directory both agree. Nothing is written there.
2. **Set.** The caller sets `RUSTUP_HOME=/opt/caller-689/rustup` and `CARGO_HOME=/opt/caller-689/cargo`, paths that don't exist. Every lane command must see exactly those.

The tests don't say where the defaults are set: in the `scripts/preflight` wrapper, in `preflight.mjs`, in `checks.mjs` or in `lanes.mjs` (for each lane's child). All of these pass. Setting them only on `cargo` commands fails, because the issue says "for every lane", and #16 AC2's cargo run is started by a vitest file, a node command in the unit lane.

## What isn't a test here, and why

- **Criterion 2** ("On 1.99.1, `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets --locked -- -D warnings` and `cargo test --workspace --locked` pass"). These are the lint lane's and the unit lane's own commands. The proof is those lanes' output from `scripts/preflight` on the fixed checkout: `PASS lint` and the unit lane's cargo test results, with criterion 1's test passing in the same checkout to show which compiler ran them. Running the three commands again here would only repeat the lanes.
- **Criterion 4** ("#16 AC2 … passes in the unit lane, its cargo run downloading no toolchain into the test's `HOME`"). The proof is the unit lane's output with `tests/acceptance/16/address.test.ts` AC2 passing. To show nothing was downloaded, run the preflight with `RUSTUP_AUTO_INSTALL=0` exported: then any cargo that tries to install the pinned toolchain into a temporary `HOME` fails AC2 instead of downloading. Also check that no `.rustup` folder was left in the test's home. This suite doesn't repeat it. #16's test builds the app crate, which takes minutes, and criterion 3's tests already show the homes reach the unit lane's vitest commands.
- **Scope items without a criterion.** These are left to diff review: the pin's `rustfmt` and `clippy` components (criterion 2's lint lane uses them), the README's setup naming the pin, code changes limited to what 1.99.1 asks for, and the crates' `rust-version` minimums staying at 1.95.
