# Blind redraft of #2086's criteria, for the closed-issue sweep (#2047)

Written blind at the base `c52dc3e73` ("Merge pull request #3153 …", main on Nov 22), from issue #2086, the design and
that base. The sweep reopened #2086 because no test on main names its criteria; this folder names both. The job saw no
fix and no earlier suite for the issue; it read no other commit, branch, worktree, stash or pull request (#2113 and
#2356 included), and no history of any file under `crates/`. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## Sources

- **The issue**, #2086: its account (the lint lane's clippy step fails on main; `-D warnings` stops at the first crate
  that fails; 123 findings from `OpError` growing past clippy's Err size limit once #1732 gave it what the operator
  found, 96 small lints, 3 in vendored code; acceptance-test lines change only by an approved proposal or are listed),
  its Scope (`OpError` under the limit; the rest cleared where the line is ours to edit, or listed under `lint` in
  `scripts/known-failures.json`; no lint switched off for the workspace), its two criteria, its Proof line ("The clippy
  run on main before and after, and #1732's suite") and its comments, the sweep's among them.
- **#1732**, whose suite AC2 names: its criteria (the six-chairs refusal names the relation missed and its shortfall).
- **The design**, `docs/technical-design.md`: Dogfooding, Check health (a silencing directive in a source file), the
  known-failure rule beside the edit guard (each entry names an open issue and a date, lapses after 14 days).
  `node scripts/design-section.mjs --issue 2086` finds no linked section. **AGENTS.md.**
- **The base, for surfaces only**: `scripts/lanes.mjs` (`checks`, the lint lane's commands, `alone`, `aloneReasons`,
  `slow`), `scripts/affected.mjs` (`lintFindings`, `classify`), `scripts/main-watch.mjs` (how a tick reads a lint lane's
  failures, its untouched checkout), `scripts/known-failures.json`, `scripts/known-failures-check.mjs`,
  `scripts/proof-runs.mjs` (`twinsOf`, how twins are laid, its 20-minute cap), `scripts/proof-change.mjs`
  (`underTestPaths`), `scripts/lease`, `scripts/alone-lint.mjs`; `Cargo.toml`, `.cargo/config.toml`,
  `rust-toolchain.toml`, `lint/canvas/clippy.toml`; `OpError` and its way to an issue
  (`crates/deep-canvas/src/schedule/mod.rs`, `crates/deep-show/src/frames.rs`'s `op_issue`, the arrange operator in
  `crates/deep-canvas-motion/src/module.rs`); `tests/acceptance/1732/` (README, tests, helpers, BASE-FAILURE.txt);
  `tests/vitest-setup.ts`, `vitest.config.ts`; for the house format, `tests/acceptance/689-redraft-2047/`,
  `2513-redraft-2047/` and `1297-redraft-2047/`.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, `- [ ] ` dropped, trimmed, whitespace collapsed
(checked against the issue's lines). Each test's name starts with `AC<n> #2086.<id>` (from `helpers.ts`).

| ID | Criterion (short) | Test, and what it asserts |
|---|---|---|
| AC1 `#2086.248ca2cc` | Workspace clippy exits 0 on main or leaves only findings listed under `lint`, and the lint lane reads no new lint failure on an untouched checkout | `ac1-workspace-clippy.test.ts` (1). The lint lane runs the issue's command exactly; nothing in the checkout switches a lint off for the workspace; the issue's command with `--keep-going` exits 0, or every finding it prints, read by the lane's reader, is listed as many times as found, no error is left unread and no library fails; the lane's own clippy command, read through `lintFindings` and `classify`, reads nothing new and nothing unsure |
| AC2 `#2086.a865933b` | An operator's error still reaches its issue with what the operator found: #1732's suite passes unchanged | `ac2-1732-unchanged.test.ts` (1). Every code file of `tests/acceptance/1732/` has the base's bytes (SHA-256), none added or gone; the suite, run as its README runs it, reports its 9 tests in its 5 files, and every one passes |

## How each criterion is read

**AC1, "exits 0 on main, or every finding left is one `scripts/known-failures.json` lists under `lint`".** The issue
says `-D warnings` stops a run at the first crate that fails, so a run shows that crate's findings and nothing after.
"Every finding left" is every finding cargo can reach, so the test runs the issue's command with `--keep-going`
(`cargo clippy --workspace --all-targets --locked --keep-going -- -D warnings`). Exit 0 holds the clause. Otherwise:

- A finding is what the lint lane's reader, `lintFindings` in `scripts/affected.mjs`, reads from the output: an
  `error` line placed at a file and line, keyed `clippy: <path> <message>` with no line number. Each must be a key of
  `lint` in `scripts/known-failures.json`, listed at least as many times as it is found, as `classify` counts.
- A crate that doesn't build counts like any other failure: its compile errors are `error[E…]` lines placed at a file,
  which the reader keys as it keys a lint, and no entry lists them.
- An error line the reader can't place (a build script that fails, a lock file `--locked` refuses) fails the test,
  naming it, since no entry could list it; cargo's own summaries (`could not compile … due to N previous errors`) are
  not findings.
- No library may fail. With `-D warnings` a lint error in a library ends its build, and cargo then lints none of the
  crates that depend on it, even with `--keep-going` (at the base, nothing behind `deep-canvas-marks` is linted:
  `deep-show`, `deep-app`, `deep-player` and the rest). Their findings are then not "left" but unread, so a failing
  library (`(lib)`, `(build script)` or `(proc-macro)` in cargo's summary) fails AC1 even when its own findings are
  listed. Findings in leaf targets (tests, examples, benches, binaries), which the issue's account expects to list for
  acceptance-test lines, can stand listed.
- Vendored crates aren't workspace members, so `-D warnings` doesn't reach them: their warnings (at the base, three in
  `vendor/quickjs-jit-runtime`, the issue's three, and two in `vendor/mitex-spec`) don't fail the command and need no
  entry.

**AC1, "the lint lane reads no new lint failure on an untouched checkout of main".** The issue opens on "the lint lane's
clippy step", so the lane here is its clippy step. The test takes the step from `checks` in `scripts/lanes.mjs` and
first holds it equal to the issue's command, once (a lane that narrowed or loosened it would read nothing). It runs
the step as the lane lists it and reads the output as the lane's readers do: `lintFindings`, then `classify` against
`scripts/known-failures.json` (affected.mjs reads a lint job so, and main-watch.mjs reads main's lint lane the same way,
by count). Nothing may be new, and nothing BLOCKED, INVALID or INCONCLUSIVE; a nonzero exit must name a finding. The
lane's other commands (fmt, repo rules, the canvas lint and the rest) are other issues' checks and aren't run.
"Untouched" is read as: the checkout is linted as it stands, and nothing outside it changes the lint. The test fixes
nothing and writes no configuration, and its cargo children run without the caller's `RUSTFLAGS`,
`CARGO_ENCODED_RUSTFLAGS`, `CARGO_BUILD_RUSTFLAGS`, `CARGO_TARGET_<triple>_RUSTFLAGS`, `CLIPPY_CONF_DIR`, `CLIPPY_ARGS`,
`RUSTUP_TOOLCHAIN` and `CARGO_BUILD_TARGET`, so the checkout's pin and its own config decide. "On main" is the program
the test runs on; before a merge that is the change.

**AC1, the issue's Scope, "No lint is switched off for the workspace to get there".** Held as a guard of AC1's pass,
before any build, since switching a lint off is the cheap way to make clippy exit 0: no `allow` in a
`[workspace.lints]` table of `Cargo.toml`; no `-A`, `--allow` or `--cap-lints` in `.cargo/config.toml` (or
`.cargo/config`); and no `clippy.toml` or `.clippy.toml` that clippy reads for a workspace member, in a member's folder
or any folder above it up to the root. The base has none of these (`lint/canvas/clippy.toml` is the canvas lint's,
reached only through `CLIPPY_CONF_DIR`), so any such file is new workspace configuration; a raised limit there, such
as `large-error-threshold`, is how `OpError` would "fit" without being boxed.

**AC2.** "#1732's suite" is `tests/acceptance/1732/`: five files, nine tests at the base. "An operator's error still
reaches its issue with what the operator found" is what that suite's six-chairs refusal reads: the arrange operator puts
the relations it still misses, with each shortfall in m, in its `OpError` (`with`), and the scheduler carries them into
the revision's issue (`OpIssue.actual`, then the issue's own fields). The criterion's colon makes the suite the check, so
the test runs it unchanged rather than drawing a fixture of its own.

- **Unchanged** is held on the bytes: every file of the folder but its prose (`.md`, `.txt`) and the cache a vitest run
  with `--root` leaves under `node_modules` has its SHA-256 at the base, and no such file is added or gone. Its README
  and BASE-FAILURE.txt don't run, so a reworded line there isn't a changed suite. If an approved change to the suite
  lands later, its pins move by the same approval.
- **Passes** is the suite run as its README runs it (one vitest with `--root tests/acceptance/1732` and
  `--no-file-parallelism`, so one file at a time, with its README's `CARGO_INCREMENTAL=0` and
  `CARGO_PROFILE_DEV_DEBUG=0`), read from vitest's JSON report: each file reports the tests the base holds (2, 2, 1, 2,
  2) and every one passed. A file that fails outside its tests, a test skipped, todo, missing or failed, fails AC2,
  naming each.
- The test writes none of #1732's criterion IDs, so the closed-issue sweep never reads it as holding them; the pins fix
  which tests run.

**INCONCLUSIVE, never PASS.** No toolchain or no clippy for the checkout's pin, `cargo metadata` failing, a cargo run
ended by a signal or by its 4-hour limit, a compiler or build script killed (`signal: 9`), a full disk, no memory,
crates that can't be fetched, a compiler crash, or the lease saying BLOCKED: AC1 fails with a message starting
`INCONCLUSIVE:`. In AC2, a child test that fails with `INCONCLUSIVE:` or whose message says the machine stopped it (its
deep-show build killed, a full disk, no toolchain) makes the test INCONCLUSIVE, unless another child test failed,
which outranks it. Every child runs with `RUSTUP_AUTO_INSTALL=0` and rustup's servers at a closed local port, so
nothing here installs or downloads a toolchain.

## What the implementer must provide

- **AC1**: `cargo clippy --workspace --all-targets --locked --keep-going -- -D warnings` on 1.99.1 exiting 0, or with
  every finding listed under `lint` and no library failing. At the base it fails in three libraries (below), and
  everything behind them is unlinted until they pass, so more findings will show once they do, `deep-player`'s native
  build among them if it still doesn't build (#3100). A finding left listed goes in `lint` under its exact key
  (`clippy: <path> <message>`, as `lintFindings` writes it) with its `lintIssues` note naming an open issue and the date,
  as `scripts/known-failures-check.mjs` requires; only leaf targets' findings can stand listed.
- Nothing that switches a lint off for the workspace (above), and the lint lane's clippy step left exactly
  `cargo clippy --workspace --all-targets --locked -- -D warnings`.
- **AC2**: nothing new; `tests/acceptance/1732/` unchanged and passing.
- Lines for `scripts/lanes.mjs`, which this job doesn't edit: both files start cargo (AC1 a whole-workspace clippy, two
  runs; AC2 #1732's suite, whose files each build deep-show), so they run alone with the reason `binary`, and both
  take minutes warm and much longer cold, so they're slow:

```js
// #2086's blind redraft: AC1 runs whole-workspace clippy; AC2 runs #1732's suite, whose files each build deep-show.
alone.push('tests/acceptance/2086-redraft-2047/');
slow.push('tests/acceptance/2086-redraft-2047/ac1-workspace-clippy.test.ts', 'tests/acceptance/2086-redraft-2047/ac2-1732-unchanged.test.ts');
```

  and `'tests/acceptance/2086-redraft-2047/'` in the `binary` list of `aloneReasons`, which `scripts/alone-lint.mjs`
  asks of every `alone` entry.

## What no check here can hold

- **A fresh checkout of main.** The tests lint and run the checkout they're given, as it stands. They don't check that
  it holds nothing uncommitted: the proof lane lays twins over a checkout as uncommitted files, and a check of that
  would fail every twin for the wrong reason. Main's own lint lane, on a fresh checkout of main's head after a merge,
  is main-watch's tick.
- **"Where the line is ours to edit."** The test can't tell a line that is ours to edit from one that isn't; it accepts
  any listed finding in a leaf target. An `#[allow]` on an item or a crate's own `#![allow]` isn't "for the workspace"
  and isn't held here; the gate's rule on silencing directives in a claim's diff (design: Check health) covers those.
- **Findings behind a failing library.** They can't be read until it passes; AC1 fails on the library instead.
- **The lint lane's other commands**, and **the counts in the issue's account** (231 findings, 123 from `OpError`):
  those were main at 7dd8cf19, not a criterion.
- **The proof lane's time cap.** `scripts/proof-runs.mjs` stops a runner after 20 minutes in a fresh copy with no
  `target/`: a whole-workspace clippy and a deep-show build there take longer on a loaded Mac, so these run by hand or
  in a bay that keeps its builds.

## Twins

`twins.json` maps each criterion to planted wrong programs under `twins/`, laid over the fixed program.

| Twin | Criterion | Files | Fault | Where it fails |
|---|---|---|---|---|
| `err-past-limit` | AC1 | adds `crates/deep-canvas/examples/op_error_unboxed.rs` | an operator's error holding what it found inline (`Option<Value>`, as `OpError` before #2086), returned by a function: clippy's `result_large_err`, a finding no entry lists; cargo finds the example itself and `--all-targets` lints it | AC1's every-finding-left assertion, naming `clippy: crates/deep-canvas/examples/op_error_unboxed.rs the `Err`-variant returned from this function is very large` |
| `limit-raised` | AC1 | the same example, and adds a root `clippy.toml` | `large-error-threshold = 4096` for the workspace, which hides that finding | AC1's switched-off assertion, naming `clippy.toml`, before any build |
| `found-dropped` | AC2 | replaces `crates/deep-canvas/src/schedule/mod.rs` | the scheduler makes an operator's error into its issue with `actual: None`, so what the operator found never reaches the issue; the rest of the file is the base's (it lints clean at the base, so the fix has no reason to touch it) | AC2's pass assertion: #1732's six-chairs refusal names no missed relation |

## What was run

See `BASE-FAILURE.txt` for the commands and output. On this Mac (Mac17,10, 18 cores, macOS 27.2), load 100 to 450:

- **The suite, once, at the base**: 1186 s in all.
  - AC1 **fails at the base** (34 s, warm), at its every-finding-left assertion: four findings no entry lists, in
    three libraries (`deep-canvas-sandbox`'s `link.rs`: `result_large_err` and `type_complexity`; `deep-relay`'s
    `relay.rs`: `result_large_err` on a closure; `deep-canvas-marks`' `light.rs`: "using `chunks_exact_mut` with a
    constant chunk size"). Its guards held: the lane's step is the issue's command, and nothing switches a lint off.
  - AC2 **passes at the base** (about 19 min, most of it deep-show's build): the base already boxes `OpError`'s found
    value, and #1732's suite, unchanged, passes 9 of 9. It is a guard of behavior that must not change, proven by its
    twin and by an edited suite file.
- AC1 rerun alone on the final file (its cargo helper also reads a lease's BLOCKED line as INCONCLUSIVE): the same
  failure, 17 s.
- **Twins**, each laid over a scratch copy of the base with a target of its own: `limit-raised` fails AC1 at the
  switched-off assertion in 5 s; `err-past-limit` fails AC1 at the every-finding-left assertion (498 s cold), naming
  the example's finding beside the base's four; over a stand-in that lists the base's four, it fails there naming the
  example's alone, while the stand-in by itself fails later, at the no-library-fails assertion. `found-dropped` fails
  AC2 at its pass assertion (772 s, deep-show built cold): #1732's six-chairs test fails on "the refusal's missed
  relations is an array, got undefined", and its other 8 tests pass.
- A control: a blank line added to `tests/acceptance/1732/helpers.ts` fails AC2 at its unchanged assertion in 1 s.
- Not run: either test on a program where AC1 passes (clearing the base's three libraries lets cargo reach crates no
  one has linted yet, which is the implementer's work), so AC1's lane-reading half and its pass path ran only as code;
  and the proof lanes themselves.

## Run them

```sh
PATH=/opt/homebrew/opt/rustup/bin:$PATH RUSTUP_AUTO_INSTALL=0 NO_COLOR=1 \
  node node_modules/vitest/vitest.mjs run --no-file-parallelism --testTimeout=600000 --hookTimeout=600000 \
  tests/acceptance/2086-redraft-2047/
node node_modules/typescript/bin/tsc -p tests/acceptance/2086-redraft-2047/tsconfig.json   # type-check
```

AC1's cargo runs go through `scripts/lease` at `nice -n 10`; set `CARGO_BUILD_JOBS` on a shared Mac. They honor
`CARGO_TARGET_DIR`; a warm `target/` makes AC1 take minutes.
