# #995 acceptance test, blind sweep (2047)

Issue #995, "The canvas panel drops pictures no shown revision uses". One criterion, `#995.1c8866b5`:

> Presenting 1,000 revisions, each with a new 1 MB picture, into one panel leaves the app's memory within 20 MB of its
> level after the first 10, and only the shown pictures held; the merge base grows by about 1 GB and fails, naming the
> panel

## What was read

The issue text, `AGENTS.md`, `docs/technical-design.md` (Panels and devices, How we know version 0 works, Dogfooding),
and the base commit's sources: `crates/deep-app/src/show.rs`, `crates/deep-app/tests/headless.rs`,
`crates/deep-gpu/src/footprint.rs`, `crates/deep-canvas/src/gauge.rs`, `vendor/gpui-pre`'s test context,
`scripts/lanes.mjs`, `vitest.config.ts`, `tests/vitest-setup.ts`, and `tests/acceptance/1431` and
`tests/acceptance/1111-redraft-2047` for layout. Not read: `tests/acceptance/995/`, `docs/evidence/995/`, any PR, issue
comment or history of `show.rs`.

## The surface

`deep_app::show`'s public `CanvasPanel` (`new`, `present`, `held`, `decoding`), `Presented`/`Layer`/`Item`, and the
`PICTURES` gauge (`CanvasPanel::pictures`); pictures are PNGs in an evidence store at `<sha[..2]>/<sha[2..]>`, as
`show.rs` reads them. Memory is the process's physical footprint on macOS (`deep_gpu::footprint::footprint`,
`proc_pid_rusage` `ri_phys_footprint`) and `VmRSS + VmSwap` on Linux.

## What it checks

`crates/deep-app/tests/sweep_995_panel.rs`, a test binary of its own with one test, on gpui's headless test context (no
window, GPU or display). One `CanvasPanel` entity is presented revision 1 of a document `kept` (its own panel rect),
then 1,000 revisions of a document `redrawn` (one rect each), each with a new 512 x 512 one-color PNG (1,048,576 B
decoded), the context run until parked after each so every picture is decoded. It fails, naming the canvas panel, when:

- the memory after revision 1,000 is more than 20,000,000 B from its level after revision 10;
- after any revision the panel doesn't hold exactly 2 pictures (the two shown revisions'), or is still decoding;
- after any revision, the two shown revisions presented again (the newest of `redrawn` and `kept`, same pictures) start
  a decoding, or leave the panel holding a different count than before: `present` decodes only a picture the panel
  doesn't hold, and each picture's PNG leaves the evidence store once it has decoded, so a panel that let a shown
  picture go can't decode it back. This reads which pictures it holds, not only how many;
- at the end `held()` isn't 2 or the gauge doesn't read 2 entries, 2,097,152 B.

Holding exactly the shown pictures, with a document presented once and kept shown, fails a panel that keeps every
picture, one that keeps only the newest revision's (1), one that frees or loads nothing (0), and one that holds two
pictures but the wrong ones (the previous revision's in place of the newest).

`panel.test.ts` (the lane's file) runs `cargo test --locked -p deep-app --test sweep_995_panel -- --nocapture
--test-threads 1` at the repo root. Cargo that doesn't start, a test that doesn't build or run (no `running 1 test` and
`test result:` lines), a `BLOCKED:` line, or a non-zero exit without the test's own `FAIL #995:` verdict throws a plain
`BLOCKED` error, never reaching an `expect`, so a program that doesn't build is never counted as failing the criterion.
Otherwise it asserts at an `expect` that cargo exited 0 (the readings and FAIL lines in the message) and that
`1 passed` was reported.

The spawn allows two hours for a hand run. The lanes stop each vitest run after 20 minutes (`scripts/proof-runs.mjs`,
`TIMEOUT`), so in a lane copy with no `target/` a cold deep-app test build past that reads as not run, never PASS.

The file builds deep-app's test target, so like other `cargo test -p deep-app` wrappers it may race parallel files that
spawn `target/debug/deep-app`; it isn't in `scripts/lanes.mjs`'s `alone` list.

A verdict counts only as a Rust panic's message, the line after libtest's `panicked at <file>:<line>:<col>:` line: a
compiler warning quoting a `BLOCKED:` or `FAIL #995:` source line counts as neither.

## What it doesn't check

The GPU half isn't exercised. Headless, nothing paints: in `show.rs` a dropped picture goes to `unused` only if it was
painted, and `unused` is drained only in `render()` (`window.drop_image`). So a program that never drains `unused`, and
keeps every painted picture on the GPU, passes here. This suite judges the panel's decoded pictures and the process's
memory without a window, not the GPU's copies.

The Rust file sits at `crates/deep-app/tests/` because cargo finds an integration test there with no `[[test]]` entry,
so no `Cargo.toml` edit is needed, and `crates/*/tests/**` is a test path; under `tests/acceptance/` it would need a
`Cargo.toml` entry.

## How to run

From the repo root, with Node 24 and cargo on PATH (and `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0` to keep the
build small): `npx vitest run tests/acceptance/995-sweep-2047/panel.test.ts`.

## Platforms

Headless: no window, GPU or display. Run on macOS (arm64) only. Linux was not run; there the memory read is
`/proc/self/status` (`VmRSS + VmSwap`), and whether deep-app's tests build there wasn't checked. Any other OS panics
with `BLOCKED:`.

## Results

- Base (ccafae68f): PASS. Memory after revision 10 14,828,048 B, after 1,000 12,501,520 B (grew -2,326,528 B); held 2;
  gauge 2 entries, 2,097,152 B; no shown picture decoded again (`BASE-RUN.txt`).
- Wrong program `keeps-unused-pictures`, the twin (`twins/README.md`): FAIL at the exit-status `expect`: "the canvas
  panel (CanvasPanel) grew the app's memory by 1042924264 B from revision 10 (22200848 B) to revision 1000 (1065125112
  B), over the 20000000 B limit; after revision 2 the canvas panel holds 3 pictures ...", 1,001 held, the gauge at
  1,049,624,576 B (`WRONG-PROGRAM.txt`).
- A second wrong program, from review and not a twin: `show` reads which pictures are used before the revision takes its
  place, so the panel lets go of the newest picture. Memory is flat (grew 65,536 B), but with each PNG gone from the
  store once decoded it can't get the picture back: FAIL at the same `expect`, "after revision 1 the canvas panel holds 0
  pictures; its shown revisions use 2; after revision 1 the canvas panel doesn't hold the picture of shown revision 1 of
  redrawn ..." (its diff in `WRONG-PROGRAM.txt`).
- Not a run: that program with a syntax error appended to `show.rs` throws "BLOCKED: the sweep_995_panel test didn't
  build or run", never reaching an `expect` (`WRONG-PROGRAM.txt`).
