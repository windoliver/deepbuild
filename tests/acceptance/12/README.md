# Acceptance tests for #12: the monorepo, its local preflight and its quick start

I drafted these tests blind, before any work on #12, from these inputs only:

- issue #12's live body, as this job's brief quoted it verbatim: its scope (npm workspaces under `packages/`, strict
  TypeScript, ESM, Node 24.22 or newer; `crates/deep-hook`; Vitest and `cargo test`; `scripts/preflight` running every
  check locally, no CI on push or pull request), its eight acceptance criteria and its Proof line;
- the base commit `9b77cd2cdde54ba66b6fcdd4f9cbcda1829c51ca`;
- `docs/technical-design.md`: How it installs, Numbers version 0 has to hold (Every task carries its own budgets),
  Criteria to tests, Criteria in a checked shape, Wrong programs, Dogfooding and Failing on an assertion;
- `docs/parallel-proof.md`, section 6 (the throttle table) and its section list;
- `AGENTS.md`.

In the checkout I read `README.md`, `package.json`, `benchmarks/budgets.json`, `scripts/preflight`, `preflight.mjs`,
`checks.mjs`, `lanes.mjs`, `perf.mjs`, `benchmark.mjs`, `throttle.mjs`, `lease` and the twins part of
`proof-runs.mjs`, `tests/preflight.test.mjs`, `tests/takes-timed.test.mjs`, and suites 1115, 1432, 689, 594, 246 and 33
for their conventions. Nothing is imported from them, and no test imports the code under test.

Per `AGENTS.md`, the implementing agent doesn't edit these tests. A dispute goes to a blind redraft by this job.

## Run them

```sh
npx vitest run --root tests/acceptance/12 <file> --no-file-parallelism --testTimeout=600000
```

They need Node 24.22 or newer first on `PATH`, git, `cc` and `/usr/bin/time` (macOS), this checkout's `node_modules`
(`npm ci` once), and for `quick-start.test.ts` cargo through rustup (`/opt/homebrew/opt/rustup/bin` or `~/.cargo/bin`).
A missing one fails the test with a message starting `BLOCKED`. Every test has an explicit timeout.

## Criteria to tests

Each tag is `#12.<first 8 hex digits of the SHA-256 of the criterion's text, trimmed, white space collapsed>`, as
`scripts/proof-change.mjs` works it out. It starts each test's title and each failure message.

| AC | Tag | File | Test (title after the tag) | Wrong program it fails on |
|---|---|---|---|---|
| 1 | `#12.f47db3bd` | `clean-checkout.test.ts` | npm install succeeds on a clean checkout, and scripts/preflight there exits 0 only when every lane ran and passed within the preflight budget | twins `exit-zero`, `blocked-lane-passes`, `unit-reported-unrun` |
| 2 | `#12.2bd67310` | `failing-test.test.ts` | a deliberately failing test makes scripts/preflight exit non-zero | twins `exit-zero`, `test-failures-explained` |
| 3 | `#12.db1eb90a` | `workflows.test.ts` | no workflow under .github/workflows/ | twin `ci-workflow` |
| 4 | `#12.df90b3f0` | `lanes.test.ts` | scripts/preflight runs typecheck, lint, unit, parity quick and perf as lanes, keeps going after a failure, reports each failing lane with its first error and fix, and exits non-zero | the merge base (BASE-FAILURE.txt) |
| 5 | `#12.f9ab1605` | `perf-regression.test.ts` | the local preflight fails a p50 more than 50% above the merge base's from 20 samples a side, reports p95 without gating it, and lets an estimated budget move once with its reason | the merge base |
| 5 | `#12.f9ab1605` | `perf-regression.test.ts` | an estimated budget moves only once and only with its reason: a second move, or a move with no reason, is refused | twin `budgets-move-freely` |
| 6 | `#12.80d47cb4` | `budget-report.test.ts` | scripts/preflight holds its checks to the preflight budget in benchmarks/budgets.json, printing FAIL preflight budget over it, and the benchmark harness reports p50, p95 and peak memory against the merge base with its sample count | the merge base |
| 7 | `#12.f81e4f9f` | `release.test.ts` | npm run release:check starts scripts/preflight with DEEP_PREFLIGHT=release, running every lane the local run runs and the release-only lanes it prints as skipped | twins `release-drops-parity`, `release-check-local` |
| 8 | `#12.444f9722` | `quick-start.test.ts` | the README quick start works on a clean checkout with Node 24.22+ and Rust: npm run build builds the TypeScript packages and crates/deep-hook, and npm link puts deep on the PATH | twins `build-without-cargo`, `no-deep-bin` |

What each test asserts:

- **AC1.** A clean checkout (the files git lists, nothing it ignores: no `node_modules`, `dist/` or `target/`) gets a
  real `npm install`, which must exit 0 and install TypeScript and Vitest. Then the clean checkout's own
  `scripts/preflight` runs in a fixture (below) whose `node_modules` is that fresh install and nothing else: no built
  package, no `target/`, no `deep` on `PATH`, and the checkout's declared `preflight` budget. With every lane passing it
  must exit 0, report nothing below PASS, start the five named lanes, give every lane it started a `PASS` line, print
  no `FAIL preflight budget`, and its unit lane must have run the fixture's vitest and `node --test` tests (markers they
  write). With the lint lane's rustfmt check blocked (`BLOCKED rustfmt: ...`, as a check whose tool is missing says), it
  must report the lint lane below PASS and exit non-zero.
- **AC2.** The change adds one vitest test that fails on purpose. The unit lane must read FAIL, every other check lane
  PASS (perf waits for the checks, so it is left out), and the preflight must exit non-zero.
- **AC3.** No file under `.github/workflows/`, neither one git lists (tracked or new) nor one on disk.
- **AC4.** The change breaks four lanes, each with two errors in order: a real type error twice over (typecheck),
  rustfmt's check (lint), two failing vitest tests (unit) and the workspace build (parity quick). The preflight must
  start the five named lanes; run the lint and parity checks after typecheck failed; end every lane it started in PASS
  or a report; report each broken lane as FAIL naming its first error and not its second, with a `Fix:` line; report
  perf with a `Fix:` line; and exit non-zero. The failing tests assert plainly (`expect(1 + 1).toBe(3)`), and for the
  unit lane the first error is the first failing test's name or its assertion (`expected 2 to be 3`), as the runner
  prints them.
- **AC5, first test.** Three tasks in the fixture's `benchmarks/budgets.json`, judged by the perf lane against the
  merge base: `regressed` (the change sleeps 700 ms every run), `tail` (the change sleeps 1 s on two runs in each
  twenty) and `estimated` (a peak-memory limit marked as an estimate, which the change moves once, from 400 MB to
  600 MB, recording why in `changeReason`). Nothing may refuse the move, and `estimated` must be judged. `regressed` and
  `tail` must each run at least 20 times in the change and in its merge base's copy. When the harness's readings show
  `regressed`'s p50 more than 50% above the merge base's, a FAIL line must name it and p50. When they show `tail`'s p95
  more than 50% above and its p50 within 50%, nothing may fail it, and its report must give both sides' p95. The
  preflight must exit non-zero.
- **AC5, second test.** The wrong case of the move, in two fixtures: an estimate already moved once (its merge base
  has a `changeReason`) moved again, and an estimate moved with no `changeReason`. Each must be refused by a FAIL,
  BLOCKED or INVALID line naming its task, and the preflight must exit non-zero.
- **AC6.** Two fixtures. In the first the change's `benchmarks/budgets.json` gives the preflight 1 ms; the run must
  print `FAIL preflight budget` and exit non-zero. (One run can't hold both halves: perf gives the merge base's checks
  the preflight budget as their allowance, so a 1 ms budget leaves it nothing to measure a task with.) In the second
  the preflight has this checkout's declared budget and one task, a Node program that does nothing. The task's report,
  its JSON line in the output, must give p50 time, p95 time and peak memory for the change and for the merge base, and
  its sample count: 20, as a number or a list of samples, under a key that names samples.
- **AC7.** `scripts/preflight` runs locally (it must pass, so nothing holds the release lanes back, and must print
  some lanes as skipped), then `npm run release:check` through the real npm. The release run must start every lane the
  local run started, none of them skipped, and every lane the local run printed as skipped; end each in PASS or a
  report; and every check it ran must have seen `DEEP_PREFLIGHT=release`.
- **AC8.** README.md's quick start must run `npm install`, `npm run build` and `npm link` in that order. On a clean
  checkout those three run as written, with the box's HOME and npm's prefix in the box: `npm install` and
  `npm run build` must exit 0 (with rustup's proxies on `PATH`, as on a machine with Rust); every workspace package
  with a build that emits must have a non-empty `dist/`; the
  clean checkout's `target/debug/deep-hook` must exist and run `--version`; `npm link` must exit 0; with the prefix's
  `bin` first on `PATH`, `command -v deep` must find it there, and `deep --help` must exit 0 and print its usage.

## Surfaces

- `scripts/preflight`, run as a person runs it, and `npm run release:check` through the real npm: their exit codes,
  their output's lane lines (`RUN <lane>`, `PASS <lane>`, `SKIP <lane>: ...`, and a report starting
  `<FAIL|BLOCKED|INCONCLUSIVE|INVALID> <lane>` with indented lines under it, a `Fix:` line among them), and the
  `FAIL preflight budget` line.
- `benchmarks/budgets.json` (the fixture's) and the benchmark harness's report: the JSON line the perf lane prints per
  task, read by its `task` id, with the change's side under `current` (or `change`) and the merge base's under `base`,
  and p50, p95 and peak readings found by key names holding p50, p95 and peak.
- README.md's quick start, `npm install`, `npm run build`, `npm link` and the `deep` command they put on `PATH`.
- The repository tree: `.github/workflows/`, the files git lists, `target/debug/deep-hook`, the packages' `dist/`.

Where the issue leaves a shape open I chose the one the base already has: the lane lines above, the task report's
`current` and `base`, and `changeReason` for the reason a moved budget records (the base's `benchmarks/budgets.json`
records its one moved budget, `preflight`'s 300 s to 900 s, that way). The sample count is the one shape the base
lacks; any key naming samples counts.

## The fixture

Every test but AC3 and AC8 runs this checkout's `scripts/preflight` in a fixture checkout under the system temporary
folder, in a box of its own (`helpers.ts` lays it out):

- **Real:** `scripts/preflight` and `preflight.mjs`, `checks.mjs` and `perf.mjs`, with every file of `scripts/` they
  reach by an import or a path relative to themselves (the lane runner `lanes.mjs`, `benchmark.mjs`, `throttle.mjs`,
  `lease`, `bays.mjs`, the reporters, `count-children.c`), and the root `package.json`, all copied from this checkout,
  or for AC1 from its clean checkout. TypeScript's `tsc`, Vitest, `node --test`, git, `/usr/bin/time` and `cc` are real.
  So are the lanes, their order, their commands' first errors and fixes, the throttle, perf's merge-base copy and its
  20 rounds a side, and the budget check.
- **The workspace:** one TypeScript package, a `tsconfig.json`, one passing vitest test and one passing `node --test`
  test, and a `vitest.config.ts` that passes when a run finds no files, since the fixture holds none of the real
  repo's one-at-a-time suites.
- **Stood in for:** every `scripts/<name>.mjs` and `benchmarks/<name>.mjs` the real files name as a command to run,
  which are the lanes' own check programs (the lints, the corpus and catalogue checks, the proof lane, the release
  lanes' benches): each records its run and exits 0, or as a test plants. One the lane runner also imports
  (`verdict-proofs.mjs`, `config-eval.mjs`) keeps its exports. cargo and npm are stand-ins first on `PATH`: cargo
  records its run and leaves an executable for a `--bin` build, and npm links the box's `node_modules` for `ci` or
  `install`. Vitest runs whose `--root` names a folder the fixture doesn't hold (the real repo's live and Lean suites)
  record themselves and exit 0. A test plants a lane's failure through `<box>/control.json`.
- **Its merge base** is the fixture's first commit, `origin/main`; the change is written over it, uncommitted.
- **Its box:** `HOME`, `TMPDIR` and `XDG_CACHE_HOME` in the box, so the throttle table, the lane records and perf's
  kept copies are the box's own and need no entry in `scripts/lanes.mjs`'s `timed` list; `RUSTUP_HOME` and
  `CARGO_HOME` the user's, as `scripts/preflight.mjs` gives its lanes; a `PATH` of the stand-ins, this Node and the
  system folders; nothing else inherited. Each preflight runs under a build grant of the box's own table
  (`scripts/throttle.mjs build -- ...`, parallel-proof section 6), so its timed request is nested and starts at any
  load; a top-level one waits for the machine's load to fall under its cores, up to an hour.
- Every process a test starts runs in a process group of its own, stopped by its PID past its timeout. Each box is
  removed when its file ends. Nothing is killed by name or port, and nothing is written into this checkout's
  `node_modules/`, `target/` or a package's `dist/`.

## What is reused from the checkout, and why the criterion is still seen

- **AC2, AC4 to AC7** link the fixture's `node_modules` to this checkout's packages (read only; the box has its own
  caches). These criteria are about the preflight's lanes, budget, harness and release run, not the install, and the
  fixture still holds no build product: no built CLI, no `dist/`, no `target/`.
- **AC1** reuses nothing built: the clean checkout's own `npm install` provides the fixture's packages. It reads the
  user's npm cache first (`npm config get cache`, prefer-offline), a cache, not a build product.
- **AC8** reuses the npm cache the same way, and cargo's registry and git caches under the user's `CARGO_HOME`.
  `target/` is the clean checkout's own, empty at the start. One narrowing: cargo first on `PATH` passes every call to
  the real cargo, but builds `cargo build --workspace` as `cargo build -p deep-hook`. This Mac has no sccache, so a
  cold build of the whole workspace (43 crates with their GPU, text and sandbox dependencies) takes far past this
  suite's 15 minutes under load. The narrowing still sees the criterion: `npm run build` must start cargo, and that
  build must leave `crates/deep-hook`'s binary in the clean checkout's fresh `target/`; a build script without cargo
  leaves none (twin `build-without-cargo`). It does not see the rest of the workspace build on a clean machine, which
  the lint, unit and parity lanes build on every preflight.
- **AC3** reads this checkout's tree only.

## Timings

On the base, on the reference Mac Mac17,10 at a load of 90 to 360 on 18 cores (BASE-FAILURE.txt): workflows 12 s,
failing-test 30 to 116 s, lanes 38 s, release 52 to 202 s, budget-report 106 s, perf-regression 254 s (two tests),
clean-checkout 95 s at load 90 and 536 s at load 200 to 360, quick-start 132 s at load 90. A fixture preflight takes
about 6 s on a quiet machine and 30 to 110 s at a load past 200. Every test's timeout is a ceiling well above that:
15 minutes for most, 25 for budget-report's two preflights, and 45 for quick-start, whose TypeScript build alone took
8 minutes at a load of 200.

## On the base

Five files pass on the base, as most of #12 is there: clean-checkout, failing-test, workflows, release and
quick-start, and perf-regression's second test. Each fails on the twins named for its criterion. Three tests fail on
the base at their assertions:

- `lanes.test.ts`: the unit lane's report names a line `scripts/lease` prints on a checkout with nothing built, not
  the failing test. vitest colours its `AssertionError` line, so the lane's error pattern misses it, and its fallback
  takes the first line holding a state word, the lease line, through an excluded path, `tests/acceptance/874/invalid.test.ts`.
- `perf-regression.test.ts`, first test: the base freezes every established budget, so it refuses the estimate's one
  move with `BLOCKED perf: Budget estimated changed or disappeared; restore its frozen definition`.
- `budget-report.test.ts`: the task's report gives p50, p95 and peak memory for both sides but no sample count.

## Twins

`twins.json` maps each tag to its twins; each folder under `twins/` holds whole replacement files, laid over a copy
of the change. None touches a test path or `node_modules`. Each holds the base's file with one planted fault, marked
`Planted wrong program (#12 twin <name>)`. A copy goes stale as its file changes, and still holds its fault.

| Twin | Replaces | The planted fault | Fails |
|---|---|---|---|
| `exit-zero` | `scripts/preflight.mjs` | The exit ignores every lane; only the budget check can make it non-zero | AC1, AC2 |
| `blocked-lane-passes` | `scripts/lanes.mjs` | A BLOCKED lane is printed but not counted, so the run exits 0 | AC1 |
| `unit-reported-unrun` | `scripts/lanes.mjs` | The unit lane runs none of its commands and reads PASS | AC1 |
| `test-failures-explained` | `scripts/lanes.mjs` | A test command's non-zero exit always reads as explained by its report, so a failing test passes its lane | AC2 |
| `ci-workflow` | `.github/workflows/ci.yml` (new) | A workflow that runs the checks on push and pull request | AC3 |
| `budgets-move-freely` | `scripts/benchmark.mjs` | An established budget may change any number of times, with or without a reason | AC5 (second test) |
| `release-drops-parity` | `scripts/lanes.mjs` | The release run leaves out the parity quick lane | AC7 |
| `release-check-local` | `package.json` | `release:check` runs `scripts/preflight` without `DEEP_PREFLIGHT=release` | AC7 |
| `build-without-cargo` | `package.json` | `build` builds the TypeScript workspaces only | AC8 |
| `no-deep-bin` | `package.json` | No `bin` entry, so `npm link` puts no `deep` on `PATH` | AC8 |

I checked each twin myself: laid over a temporary copy of this checkout (a git repository of its own, whose
`node_modules` links to this checkout's packages), the test it names was run there once and failed at its assertion.
BASE-FAILURE.txt has each run.
