# Acceptance tests for #2497: the locked-versions test reads the vello_cpu deep-marks-render resolves

Written first, blind, from issue #2497 ("deep-marks-render's locked-versions test reads the wrong vello_cpu: the
lockfile has held two since #220": its report, Scope, two acceptance criteria and Proof) as the brief quoted it, the
design and base commit `a12be6c8c` ("Merge pull request #2525 …"), by a job that never saw an implementation; none
existed, and no other branch, worktree or pull request was read, nor the live issue. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test
per criterion, both in one file so they run in order and never beside each other, AC2's plant inside its test.

| AC | ID | File (tests) |
|---|---|---|
| AC1 | `#2497.aa0d6f96` | `vello-cpu.test.mjs` (1): `cargo test -p deep-marks-render --lib --locked` on this checkout |
| AC2 | `#2497.b8e58294` | `vello-cpu.test.mjs` (1): the issue's test run with `VELLO_CPU` planted at `"0.0.8"` |

IDs are `scripts/proof-change.mjs`'s `criterionId` (sha256 of the text, first 8 hex) over each criterion's text as the
brief gave it, after `- [ ] `; the live issue body wasn't read, so they aren't checked against it. Each test's name
starts with its ID.

## What was read

- `AGENTS.md`; `docs/technical-design.md`: The canvas core (the issue's design link) and How we know version 0 works
  (Dogfooding).
- At the base: `crates/deep-marks-render/src/gpu.rs` (the test `gpu::tests::the_named_versions_are_the_locked_ones`, its
  `locked` reader, `VELLO_GPU`), `raster.rs` (`VELLO_CPU`, and the answer that names it), `lib.rs` (its modules),
  `arrays.rs` (the lib's one other test) and `Cargo.toml`; `Cargo.lock` (vello_cpu 0.0.8 at line 12166, then 0.3.0;
  deep-marks-render's own entry lists `vello_cpu 0.3.0`); `cargo tree` for deep-marks-render (vello_cpu 0.3.0 only)
  and inverted for vello_cpu 0.0.8 (hayro 0.7.1, typst-svg, typst-html, typst, deep-typeset);
  `scripts/known-failures.json` (no entry for the test); `scripts/proof-change.mjs` (`criterionId`);
  `scripts/lanes.mjs` (the unit lane leaves `tests/acceptance/`'s node suites to hand runs; the `alone` list and
  #1901's entry); `scripts/affected.mjs` (`plan`, and its parallel block beside `cargo test -p`);
  `scripts/throttle.mjs` and `scripts/lease`. Suites `2144/`, `2326/` and `1901/` for the house format and the
  in-place plant.

## Readings where the issue leaves a choice

- **"`cargo test -p deep-marks-render --lib` passes on main"**: that command on this checkout (on the work, the work's
  tree), with `--locked` added, as the lanes run cargo, so it tests the committed `Cargo.lock`. It exits 0, and the
  issue's test is among the tests it ran and reads `ok`: the issue's proof is that test's run, so a run without it, or
  with it `ignored`, doesn't pass. The test is found by its function name under any module path, so moving it out of
  `gpu.rs` is the implementer's choice.
- **"a version the crate doesn't resolve"**: `0.0.8`, the lockfile's other vello_cpu, the one the base's reader takes.
  Before planting, the test asks cargo's own resolver (`cargo tree -p deep-marks-render --locked -e normal,build,dev`)
  and needs vello_cpu 0.3.0 and nothing else there; otherwise it fails with a `BLOCKED:` message, never a pass. This
  plant fails the base, whose test passes with it, and a reader that accepts any lockfile entry of the name; a version
  no entry holds fails that reader too, so it couldn't tell it from a right one.
- **"With `VELLO_CPU` set"**: the plant rewrites the literal of the one `const VELLO_CPU: &str = "…"` in `raster.rs`, the
  file the issue names. A `VELLO_CPU` that isn't one string literal there fails the test, since the criterion sets it.
- **"the test fails"**: `cargo test -p deep-marks-render --lib --locked the_named_versions_are_the_locked_ones` exits
  non-zero and the issue's test reads `FAILED`.
- **"naming both versions"**: the planted version and the one the crate resolves, `0.0.8` and `0.3.0`, each appear as a
  whole version (0.3.0 isn't found in 10.3.0) in what that test printed when it failed: its `---- <path> stdout ----`
  section, where libtest puts the panic message. With this plant they are also the lockfile's two versions, so the
  other reading of "both" asks the same.

## Run them

```sh
export PATH=/opt/homebrew/opt/rustup/bin:$PATH    # when cargo isn't on PATH
node scripts/throttle.mjs build --wait 60 -- scripts/lease nice -n 10 env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node --test --test-reporter=spec tests/acceptance/2497/vello-cpu.test.mjs
```

Each test sets `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless the environment sets them, and builds
nothing but deep-marks-render's lib tests, into the checkout's `target/`. Node built-ins only.

AC2 changes a tracked file for one build, so **nothing else may build deep-marks-render in this checkout while it runs**.
`raster.rs` is restored byte for byte in a `finally`, and on SIGINT, SIGTERM, SIGHUP or exit while cargo runs; the test
then checks its bytes and its `git status` line are as they were. The restored file is newer than the planted build, so
the next build recompiles the crate rather than run the planted binary. A run killed with SIGKILL leaves the plant,
with which the base's own test passes; both tests of the next run find it and fail before building, and
`git checkout -- crates/deep-marks-render/src/raster.rs` restores it.

`scripts/affected.mjs` selects this file for a change to deep-marks-render and would run it in its parallel node block,
beside its own `cargo test -p deep-marks-render`, which could then build the planted file. This folder belongs in
`scripts/lanes.mjs`'s `alone` list, as #1901's does, for the same reason; that edit is the owner's to approve. Until it is
made, run the file by hand as above, and don't read affected.mjs's deep-marks-render results from a run during which this
file ran.

## Base results

`BASE-FAILURE.txt` is the one run at the base (2 tests, both fail, nothing BLOCKED), whole, with the checkout's path
replaced.

- **AC1 fails**, as it must, for the issue's reason: `cargo test -p deep-marks-render --lib --locked` exits 101. Of the
  lib's 2 tests, `gpu::tests::the_named_versions_are_the_locked_ones` fails with the assertion the issue quotes from
  `c56fe5407`, `left: Some("0.0.8")`, `right: Some("0.3.0")`; the other passes.
- **AC2 fails**, as it must, for the issue's reason: cargo tree finds deep-marks-render resolving vello_cpu 0.3.0 alone,
  and with `VELLO_CPU` set to `"0.0.8"` the issue's test reads `ok` and cargo test exits 0. Its reader takes the
  lockfile's first vello_cpu, 0.0.8, which is the planted constant. `raster.rs` came back byte for byte, and
  `git status` after the run was as before.

The suite took 6.5 s once the throttle's build slot came, after 13 min 21 s in its queue: AC1 1.2 s, AC2 5.3 s, of
which 4.4 s recompiled deep-marks-render with the plant. `target/` was warm from one
`cargo test -p deep-marks-render --lib --locked --no-run` at the base, which compiled 745 crates into a new `target/`
in 2 min 49 s; a cold first run adds that.

AC2's reading of libtest's output was also checked outside the suite, with no build, on AC1's base output above: it
finds the test's `FAILED` line, cuts out its failure section and finds both versions there. A planted run that fails
in that shape passes AC2.

## Not tested, because no criterion reaches it here

The test's vello_gpu half (the lockfile holds one vello_gpu, so the first entry is the resolved one); how the test
finds the version the crate resolves (its own `Cargo.lock` entry, cargo metadata or another way: any passes); the
crate's integration tests under `crates/deep-marks-render/tests/`, which `--lib` leaves out.
