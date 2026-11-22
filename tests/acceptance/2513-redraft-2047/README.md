# Acceptance test for #2513, blind redraft for the closed-issue sweep (#2047): #1939's suite and #1938's machines.test.ts pass unchanged

This test was written by a job that saw only issue #2513's body, its two dependencies' titles (#1938 the loop's render
checks, #1939 light readings on every snapshot), the design sections it links and base commit `5330aaf29` ("Merge pull
request #2509 …", main on Nov 14). It never saw the work that implements #2513. It covers one criterion, the third:

> `tests/acceptance/1939/` and `tests/acceptance/1938/machines.test.ts` pass unchanged

Its ID is `#2513.296f5cfc`: `#2513.` and the first 8 hex digits of the SHA-256 of the criterion's text, `- [ ] `
dropped, trimmed, whitespace collapsed (`criterionId` in `scripts/proof-change.mjs`, run on the issue's line). The
sweep over closed issues (#2047) holds a criterion only when a code file under the test paths names its ID; none named
this one, so the issue was reopened. The first two criteria are held by another suite and aren't here.

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job
(design: Dogfooding).

## What was read

- Issue #2513's body: its scope ("Nothing else changes: render.exposure's limits, results, fixes and verdicts, the
  readings' fields, and the frames other pixel checks read are as #1938 and #1939 left them"), its Fields line, its
  three criteria and its Proof line ("#1939's and #1938's suites passing unchanged").
- `docs/canvas-primitives.md`: Check input: loop kinds (render.exposure; "exposure, contrast, noise and effect timing
  read pixels on one machine and are INCONCLUSIVE elsewhere"; "pixel kinds one GPU reduction and a few KB read back per
  checked time") and Render-back. `docs/technical-design.md`: Proven on the base ("One for behavior that must not change
  must pass"), Dogfooding, and Every task carries its own budgets (timings judged only on a reference Mac).
- At the base, for surfaces and conventions only: `AGENTS.md`; `tests/acceptance/1939/` (README, both tests, helpers,
  BASE-FAILURE.txt: its ac2 timing is INCONCLUSIVE off a reference Mac at rest); `tests/acceptance/1938/machines.test.ts`
  and its `helpers.ts`, README and BASE-FAILURE.txt; `tests/acceptance/1434/ac5-unchanged.test.ts` (another suite run
  unchanged through vitest's JSON report); `crates/deep-show/src/pixels.rs` (`light3d`, the snapshot readings;
  `read_against`, a pixel row read against another machine's verdict) and `verdict.rs` (a row's `kind`, `machines`,
  `fingerprint`); `crates/deep-canvas-loop/src/exposure.rs` (`measure`, `subject_px`), `pixels.rs` and `contrast.rs`
  (which of the shared reads each pixel check takes); `crates/deep-canvas-marks/src/finish.rs` (`exposure_scale`) and
  `deep-show`'s `scene3d.rs` (`look_of`: the camera's EV100 to the frame's exposure); `scripts/proof-change.mjs` (`criterionId`,
  `underTestPaths`), `scripts/proof-runs.mjs` (`twinsOf`, `prepareRuns`, `atAssertion`), `scripts/lanes.mjs` and other
  suites' `twins.json` and `twins/` (#1407's replace Rust files).

## What "unchanged" and "pass" mean here

- **Unchanged** is byte for byte the base's files, pinned in the test by SHA-256: every file of
  `tests/acceptance/1939/` (no file added or gone; the `node_modules/.vite` cache a vitest run with `--root` leaves is
  left out), and `tests/acceptance/1938/machines.test.ts` with the `helpers.ts` it imports, since a test whose helpers
  changed isn't the same test. It is checked first; a changed file fails the test before anything runs. A later change
  to those files that main takes through an approved proposal moves these pins with it.
- **Pass** is each guarded test file run as its own README runs it (vitest with `--root` at its folder,
  `--no-file-parallelism`, one file at a time, in the criterion's order), read from vitest's JSON report: it reports as
  many tests as the base holds (one each, `#1939.398baf58`, `#1939.9c67dc55` and `#1938.636cd049`, whose names the pins
  fix) and every one passed. A file that writes no report or reports no test, a test skipped, todo or missing, or a
  test that failed fails this test, naming each; the first file with a failure ends the run. The test's code writes no
  other issue's criterion ID, so the closed-issue sweep never reads it as holding #1939's or #1938's criteria; the
  twins' comments don't name this criterion's ID either.
- **INCONCLUSIVE.** A child test that failed with a message starting `INCONCLUSIVE:` can't be judged on this machine:
  #1939's `ac2-budget` off a reference Mac at rest, a machine with no cargo or no Metal GPU. Then this test fails with a
  message starting `INCONCLUSIVE:`, listing each, and never passes. A failure outranks it.
- Children get `NO_COLOR=1` and `/opt/homebrew/opt/rustup/bin` at the end of `PATH`: #1939's helpers look for cargo
  there themselves, and #1938's take `PATH`'s.

## What the base does

At `5330aaf29` the guarded files are the base's, `1939/ac1-readings.test.ts` and `1938/machines.test.ts` pass,
and `1939/ac2-budget.test.ts` holds its structure and then reads INCONCLUSIVE off a reference Mac at rest (this Mac's
thermal state was "fair" and its load 380 on 18 cores). So here, at the base, this guard ends INCONCLUSIVE for a reason
of the machine and fails at no assertion. On a reference Mac at rest, `ac2-budget` builds `deep-show` for release and
times the readings. The issue's body puts them at about 130 ms at 1936 × 1584 (at load 100), far past
#1939's 20 ms, so there the base may fail `ac2-budget` at its timing assertion, and this guard with it: the #1939 half of
the criterion holds there only once #2513's reduction brings the readings under 20 ms. That run wasn't made here.
`BASE-FAILURE.txt` holds the run that was.

## Run it

The guard runs #1939's two files and #1938's machines file in turn; each builds `deep-show` with cargo and draws on this
Mac's Metal GPU, and #1939's `ac2-budget` reads the machine's load for its timing. The implementer adds these lines to
`scripts/lanes.mjs`; this job edits nothing outside its folder:

```js
// #2513's blind redraft for #2513.296f5cfc runs #1939's suite and #1938's machines.test.ts, which build deep-show and
// draw on the GPU, and #1939's ac2-budget judges a timing on the reference Mac.
alone.push('tests/acceptance/2513-redraft-2047/');
timed.push('tests/acceptance/2513-redraft-2047/unchanged.test.ts');
```

```sh
npm ci                          # once, if node_modules is missing
PATH="$PATH:/opt/homebrew/opt/rustup/bin" NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  scripts/lease nice -n 10 npx vitest run --root tests/acceptance/2513-redraft-2047 --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/2513-redraft-2047/tsconfig.json   # type-check
rm -rf tests/acceptance/2513-redraft-2047/node_modules tests/acceptance/1939/node_modules tests/acceptance/1938/node_modules
```

The test prints each child's judgment as a line starting `PROOF #2513`. Reports go to temporary folders it deletes.

## Criteria to tests

| ID | File (tests) | What it asserts |
|---|---|---|
| `#2513.296f5cfc` | `unchanged.test.ts` (1) | The guarded files are the base's by SHA-256; then `1939/ac1-readings.test.ts`, `1939/ac2-budget.test.ts` and `1938/machines.test.ts`, each run as its suite runs it, report the base's one test each and every one passed. A child INCONCLUSIVE makes it INCONCLUSIVE, never PASS |

## Wrong programs (`twins.json`)

A twin replaces code under test, never a test's own files (`prepareRuns` refuses one that does), so the twin plants a
wrong program the guarded suites catch. The proof lanes lay a twin over a later tree than this base (the pull
request's merge base), so the twin's file is one whose bytes are the same at the base `5330aaf29` and on main at
`5f5791e2d`, checked by blob ID alone (`git rev-parse <commit>:<path>`: `02bdbbd3f0986af76acc1ce9f2d42b14cf28545c` at
both); main's contents weren't read. A copy of that file with one line changed builds wherever the file is unchanged.

| Twin | File it replaces | The wrong program | Where the guard fails |
|---|---|---|---|
| `ev-sign-flipped` | `crates/deep-canvas-marks/src/finish.rs` (447 lines), byte-equal at `5330aaf29` and `5f5791e2d` | `exposure_scale` reads EV100 with its sign flipped, 1 ÷ (1.2 × 2^−EV100), so a camera set three stops under exposes the subject over | `1939/ac1-readings.test.ts` fails: render.exposure reads the planted under-exposure fixture with its key above −0.5 EV, so the guard fails at its pass assertion and stops |

The camera's exposure reaches both render.exposure and the snapshot readings through `exposure_scale` (`deep-show`'s
`scene3d.rs` `look_of` at the base), so the twin should still fail #1939 after #2513 moves the measure onto a GPU
reduction; that is read, not run. Its risk on a later main: if `finish.rs` changes on main after `5f5791e2d`, the copy
drops that change and may fail to build there, a failure elsewhere, not at this test's assertion.

Two earlier twins were dropped: `subject-px-none` (`mask` reads no px) and `text-bounds-none` (`bounds` finds
no box), each a copy of `crates/deep-canvas-loop/src/pixels.rs`. That file isn't byte-equal on main, and other files of
its crate there use items the base's copy doesn't define, so neither builds on main. A third, `ground-median-zero`
(`median` reads 0), was dropped before them: the guard passed `1938/machines.test.ts` on it. The likely reason, read
and not run: that file's planted contrast text also fails the document's own check (`number_unsourced`), so
render.contrast's row stays FAIL whatever ratio it reads. Their base runs are in BASE-FAILURE.txt.

The unchanged half can't take a twin; `BASE-FAILURE.txt` records two mutant runs of it (a guarded file edited, a file
added to #1939's folder).

## Not tested

The first two criteria (another suite holds them); #1938's `faults.test.ts` (the criterion names only its
machines file); the timings of #1939's `ac2-budget` beyond what that file itself judges.
