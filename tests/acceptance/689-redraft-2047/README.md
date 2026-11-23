# Blind redraft of #689's criteria, for the closed-issue sweep (#2047)

Written blind at the base `edf0e0349` (main `188b3100a` with #689's change undone and its old suite left out), from
issue #689, the design and that base. The sweep reopened #689 because no test on main names its criteria. This folder
names all four. The job saw no fix and no earlier suite for the issue; it read no other commit, branch, worktree or pull
request, and no history of the files the change touches. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## Sources

- **The issue**, #689: its account (the checkout builds with whatever rustup's default is; a test that gives a child a
  temporary `HOME`, as #16's `childEnv` does, leaves rustup and Cargo looking for their homes inside it, so with a pin
  rustup downloads the toolchain, about 1.3 GB, into it on every run), its Scope, four criteria and Proof line ("Tooling
  tests for the pin and the environment; the lint and unit lanes' output on 1.99.1"), and the sweep's comment.
- **The design**, `docs/technical-design.md`: Dogfooding. #689 links no design section (`scripts/design-section.mjs`
  finds none). **AGENTS.md.**
- **The base, for surfaces only**: `rust-toolchain.toml`; `scripts/preflight`, `preflight.mjs`, `checks.mjs`,
  `lanes.mjs` (`checks`, `runLanes`, the throttle class and lease of each lane command, `exactTree` and `writeRecord`,
  `cargoResults`, `crates`, `readRun`), `throttle.mjs` (the test-run table, nested timed grants), `benchmark.mjs`
  (`warm`, `measureOnce`), `lease`, `known-failures.json`, `proof-runs.mjs` (`twinsOf`, `runNode`, its 20-minute cap,
  `atAssertion`), `proof-change.mjs` (`criterionId`); `tests/vitest-setup.ts`; `vitest.config.ts`; the suites
  `tests/acceptance/16/` (`address.test.ts`, `helpers.ts`), `tests/acceptance/12/` (its preflight fixture, `helpers.ts`)
  and `tests/acceptance/2444/` (runLanes in a scratch tree); for the house format, `tests/acceptance/2513-redraft-2047/`
  and `1297-redraft-2047/`.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed and whitespace collapsed (checked against
the issue's lines). Each test's name starts with `AC<n> #689.<id>` (from `helpers.mjs`). The files are `node --test`
files: run them with `node --test --test-concurrency=1 tests/acceptance/689-redraft-2047/` (one at a time; AC2 and AC4
build Rust).

| ID | Criterion (short) | Test, and what it asserts |
|---|---|---|
| AC1 `#689.6c214cc8` | `rustc --version` at the root reports `1.99.1` | `ac1-pin.test.mjs`. rustc through rustup's proxy at the checkout's root reports 1.99.1 twice: with the user's own rustup home, and with a rustup home of the test's own that holds the user's installed 1.99.1 toolchain (linked) and no default, where only a pin in the checkout can choose a toolchain |
| AC2 `#689.aa1fa756` | On 1.99.1, fmt, clippy `-D warnings` and `cargo test --workspace` pass | `ac2-checks.test.mjs`. On 1.99.1 (asked for by name), at the root, in the issue's order: `cargo fmt --all -- --check` exits 0, `cargo clippy --workspace --all-targets --locked -- -D warnings` exits 0, and `cargo test --workspace --locked` exits 0 or fails only on tests `scripts/known-failures.json` lists for main |
| AC3 `#689.4283cde6` | The preflight's check workload gets the user's homes when unset, the caller's when set | `ac3-preflight-homes.test.mjs`. The real `scripts/preflight` in a fixture; every check lane of `scripts/lanes.mjs` records the environment it was given: with the caller's `RUSTUP_HOME` and `CARGO_HOME` unset, each lane has the user's `~/.rustup` and `~/.cargo`; with both set, each lane has the caller's values |
| AC4 `#689.a5c89962` | #16 AC2's app test passes in the unit lane, its cargo run downloading no toolchain into the test's `HOME` | `ac4-app-in-unit-lane.test.mjs`. The real `scripts/preflight` in a fixture, called with `RUSTUP_HOME` and `CARGO_HOME` unset, runs the unit lane narrowed to #16's "AC2 the app (#34)" test at this checkout: the lane PASSes, the test passes, and each cargo run of deep-app's `hub_client` test had a `HOME` of its own, took rustup's and Cargo's homes from outside it, left no toolchain in it and exited 0 |

## How each criterion is read

**AC1.** "Run at the repository root" is `rustc --version` with the checkout's root as its folder, through rustup's
proxy, so the checkout's toolchain file applies (`RUSTUP_TOOLCHAIN` is cleared; any `rustup override` the user set for
the folder still applies, as it would for them). The first run is the criterion as written. It can't tell a pin from a
default that happens to be 1.99.1, so the second run takes the default away: a rustup home with only the 1.99.1
toolchain and no settings. There, rustup 1.29.3 falls back to `stable`, which isn't installed, so a checkout without a
pin, or one pinning `stable` or another release, gets no rustc and fails. A missing 1.99.1 toolchain reads INCONCLUSIVE;
nothing is installed. The pin's `rustfmt` and `clippy` components and the README's setup line are Scope, not a
criterion: no test reads them (AC2 needs 1.99.1's rustfmt and clippy installed to run at all).

**AC2.** "On 1.99.1" is a condition of the run, so the test asks for 1.99.1 by name (`RUSTUP_TOOLCHAIN=1.99.1`) and
judges the code on that release whatever the checkout pins; AC1 judges the pin. A guard first checks that rustc,
rustfmt and clippy answer on 1.99.1 (INCONCLUSIVE otherwise). "Pass" is exit 0, in the issue's order, the first failure
ending the test. `cargo test` runs with `--no-fail-fast`, as the unit lane runs it, so a failure names every failing
test; a test whose ID (as the unit lane's reader, `cargoResults` in `scripts/lanes.mjs`, gives it) is listed under
`failures` in `scripts/known-failures.json` is set apart as the lane sets it apart (none is listed today); any other
failure fails the test, and a nonzero exit that names no failing test fails it too. A harness case that ends BLOCKED,
INVALID or INCONCLUSIVE leaves the test INCONCLUSIVE. A run stopped by a signal or its time limit, a missing toolchain,
crates that can't be fetched, a full disk or a compiler killed by the system read INCONCLUSIVE. Each command runs under
`scripts/lease` at `nice -n 10`.

**AC3.** "The preflight's check workload" is what `scripts/preflight` runs as its checks, `scripts/checks.mjs` and the
lanes it runs. The test runs the real `scripts/preflight` of this checkout in a fixture (`helpers.mjs`,
`fixturePreflight`): this checkout's `scripts/` (every file at its top level) and `benchmarks/budgets.json` in a
temporary folder that is no git repository. In the fixture, and never in the checkout, `lanes.mjs` becomes
`lanes-689.mjs` behind a module that keeps all its exports and hands the check workload the real lane objects of
`checks` with their commands swapped for one probe each (and `paths` dropped, so every lane runs); `perf.mjs` and
`agent-harness.mjs` are stand-ins. The preflight, its timed grant and timer, `checks.mjs`, `runLanes` with its throttle
and lease all run as they are. Each probe writes down `RUSTUP_HOME`, `CARGO_HOME` and `HOME` and fails, so the
preflight goes on to no perf and no agent. "The user's `~/.rustup` and `~/.cargo`" are under the user's home as the
password database has it; the preflight is called with that as its `HOME` too, so `~` means the same either way. The
caller's values are two folders of the test's own. The fixture runs under a build grant of its own throttle table
(`DEEP_THROTTLE_TABLE`, which the throttle reads only inside a test run), so its timed grant is nested, starts at any
load and holds up nothing on the machine; no lane writes an evidence record, since the fixture is no repository and
git looks for none above it. It takes about 5 to 15 s.

**AC4.** "Passes in the unit lane" is #16's test run by the unit lane of a real preflight. The test runs the fixture
preflight with the caller's `RUSTUP_HOME` and `CARGO_HOME` unset (the issue's failing case) and the user's own `HOME`,
and gives its check workload one lane: the `unit` lane object of `scripts/lanes.mjs`, its command the unit lane's own
one-at-a-time vitest block (`--no-file-parallelism`) narrowed to `tests/acceptance/16/address.test.ts -t "AC2 the app
\(#34\)"`, run at this checkout with the repository's vitest config and setup, its JSON report kept. First on `PATH` is
a cargo that writes down the `HOME`, `RUSTUP_HOME` and `CARGO_HOME` of each run, passes the run unchanged to rustup's
cargo, and when it ends notes what the run's `HOME` holds under `.rustup` and `.cargo`. "Its cargo run downloading no
toolchain into the test's `HOME`" is judged on each cargo run of deep-app's `hub_client` test: it had a `HOME` other
than the user's (#16's `childEnv` gives it a temporary one), rustup's and Cargo's homes (an unset or empty value means
`<HOME>/.rustup` and `<HOME>/.cargo`) were outside that `HOME`, no toolchain was in it afterwards, and the run exited 0.
Before the fixture, the test builds that test target once with the user's homes (`cargo test --locked -p deep-app
--test hub_client --no-run`, not judged), as the preflight warms its builds, so the lane's run isn't a cold build inside
#16's 30-minute limit.

## What no check here can hold

- **A real download.** Every child that may start rustup runs with `RUSTUP_AUTO_INSTALL=0` and rustup's servers set to
  a closed local port, so nothing here can download a toolchain or a component (the pinned one is about 1.3 GB). A
  program that would have downloaded one into the test's `HOME` fails AC4 instead: its cargo run finds no toolchain and
  exits nonzero, and the location checks name where rustup looked. The tests never watch a download happen.
- **The whole unit lane.** AC4 runs the unit lane object with its command narrowed to one test; the rest of the lane
  (every other vitest file, `cargo test --workspace`, the node suites) isn't run. AC2 runs the lint lane's two cargo
  commands and the unit lane's cargo command as commands, not the lanes around them.
- **The proof lane's time cap.** `scripts/proof-runs.mjs` stops a node test file after 20 minutes. AC2 builds and tests
  the whole workspace, tens of minutes to hours on this Mac at its load, so on a program whose formatting passes it can
  only finish by hand; its result then is the lint and unit lanes' cargo output the issue's Proof line asks for.
- **Components and setup text.** The pin's components and the README naming the pin (Scope) aren't read by any test.

## What the implementer must provide

- `rust-toolchain.toml` at the root with `channel = "1.99.1"`, so rustup chooses 1.99.1 there with no default.
- The preflight gives its check workload `RUSTUP_HOME` and `CARGO_HOME`: the caller's values when set, else `~/.rustup`
  and `~/.cargo` under the user's home, set where the lanes inherit them (`scripts/preflight`, `scripts/preflight.mjs`,
  `scripts/checks.mjs` or `runLanes`; the test reads only what each lane gets).
- Surfaces the fixture relies on, as at the base: `scripts/preflight` runs `scripts/checks.mjs` as its check workload,
  which runs `checks` from `scripts/lanes.mjs` through `runLanes` with a lane named `unit`; the preflight's own files are
  top-level files of `scripts/` plus `benchmarks/budgets.json`; `scripts/throttle.mjs build -- <command>` grants a build
  and runs it; perf and the harness budgets run as `scripts/perf.mjs` and `scripts/agent-harness.mjs`.
- The code passing fmt, clippy `-D warnings` and `cargo test --workspace` on 1.99.1 (at the base, fmt fails on 35 files).
- For the run: rustup with 1.99.1 and its rustfmt and clippy installed in the user's rustup home (no test installs
  them); `npm ci` and `npm run build --workspaces` before AC4 (it reads INCONCLUSIVE without `packages/cli/dist`).
- These are `node --test` files, which the unit lane doesn't run (it runs only `tests/*.test.mjs` of node's suites), so
  they run by hand and in the proof lane. This job edits nothing outside its folder; if the implementer wants
  `scripts/affected.mjs` to treat the two long files as slow, these lines go in `scripts/lanes.mjs`:

```js
// #689's blind redraft: AC2 builds and tests the whole workspace on 1.99.1; AC4 builds deep-app's hub_client test.
slow.push('tests/acceptance/689-redraft-2047/ac2-checks.test.mjs', 'tests/acceptance/689-redraft-2047/ac4-app-in-unit-lane.test.mjs');
```

## Twins

`twins.json` maps each criterion to planted wrong programs under `twins/`, laid over the fixed program. Each replaces
one file whole with a complete copy of it apart from its fault. The base's own files were the copies (the fix's
versions weren't seen), so a twin of a file the fix also edits takes the base's version of the rest of that file.

| Twin | Criterion | File it replaces | Fault | Where it fails (runs below) |
|---|---|---|---|---|
| `pin-stable` | AC1 | `rust-toolchain.toml` | pins `channel = "stable"` with the same components and target | AC1's first assertion here (stable is 1.100.0 on this Mac); where stable is 1.99.1, its isolated-home assertion (stable isn't installed there) |
| `fmt-violation` | AC2 | `crates/deep-canvas-drawn/src/lib.rs` | `pub  mod geometry;`, two spaces | AC2's fmt assertion, naming `crates/deep-canvas-drawn/src/lib.rs` among the unformatted files |
| `homes-dropped` | AC3 | `scripts/checks.mjs` | the check workload deletes both homes before running its lanes | AC3's unset-case assertion (each lane's homes `null`); with the homes set in `runLanes` instead, its set-case assertion |
| `caller-overridden` | AC3 | `scripts/checks.mjs` | the check workload always sets the user's homes, over the caller's | AC3's set-case assertion |
| `fresh-homes` | AC4 | `scripts/checks.mjs` | the check workload gives its lanes an empty rustup and Cargo home of the run's own | AC4's "exited 0" assertion: the app test's cargo run finds no toolchain there (with downloads off; it would download one each run) |

## What was run

See `BASE-FAILURE.txt` for the commands and output.

- **The base, once** (all four files, one at a time, load 70 to 140 on 18 cores): AC1 fails at its assertion (rustc at
  the root reports `1.100.0`, rustup's stable here); AC2 fails at its fmt assertion (35 files unformatted on 1.99.1's
  rustfmt) in 5 s; AC3 fails at its unset-case assertion (every check lane's `RUSTUP_HOME` and `CARGO_HOME` are unset)
  in 4 s; **AC4 passes** in 158 s (2.5 min of it the warm build). AC4 passes at the base because
  `tests/vitest-setup.ts`, there before this change, gives every vitest file `RUSTUP_HOME` and `CARGO_HOME` from
  `homedir()` when unset, so #16's cargo run finds the user's toolchains whatever the preflight passes, and with no pin
  at the base there is nothing to download (it built on stable, 1.100.0). A twin can't remove that setup (it is under
  the test paths), so AC4's wrong program is a preflight that hands the lanes wrong homes, `fresh-homes`.
- **A stand-in fix**, in a scratch copy of this checkout's `scripts/`, `benchmarks/budgets.json` and this folder:
  `rust-toolchain.toml` pinning 1.99.1 with rustfmt, clippy and the wasm32 target, and two lines in
  `scripts/preflight.mjs` setting `RUSTUP_HOME ??= ~/.rustup` and `CARGO_HOME ??= ~/.cargo` before the checks. AC1 and
  AC3 pass on it. Laid over it, `pin-stable` fails AC1, and `homes-dropped`, `caller-overridden` and `fresh-homes` each
  fail AC3, all at their assertions.
- **`fmt-violation`** laid over a copy of the base fails AC2 at its fmt assertion with 36 files, the twin's among them
  (35 at the base, without it). Its clippy and test halves can't be shown failing on a twin here: the base's fmt fails
  first, and a clippy twin would cost a whole-workspace clippy run.
- **AC4 over clone copies of the base** (no `.git`), each with a cold `target/`: on the stand-in fix it passes in
  144 s, building on 1.99.1 by the pin; with `fresh-homes` laid over the base it fails in 125 s at its "exited 0"
  assertion (the app test's cargo run: "toolchain 'stable-aarch64-apple-darwin' is not installed" in the run's empty
  rustup home).
- **Not run**: AC2 past formatting on any program (the base's fmt fails first; a whole-workspace clippy and test run
  on 1.99.1 is the implementer's, by hand), and AC1's isolated-home assertion on a machine whose stable is 1.99.1.
