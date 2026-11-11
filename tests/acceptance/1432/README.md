# Acceptance tests for #1432: a file-size ratchet, and the canvas lint's bans

These tests were drafted blind from issue #1432 ("Two repo guards: a file-size ratchet that only goes down, and lint bans on clocks and env in the pure crates"), `docs/technical-design.md` (the Repo guards and Dogfooding bullets) and the base commit `de304b9ff`, which has no ratchet. Per AGENTS.md, the implementing agent doesn't edit them. A dispute goes to a blind redraft by this job.

Run them with cargo on PATH:

```
node --test 'tests/acceptance/1432/*.test.mjs'
```

The tests use the PATH they're given, as the lint lane does. On this Mac cargo isn't on the default PATH; put `/opt/homebrew/opt/rustup/bin` in front. Without cargo the canvas lint prints `BLOCKED canvas-lint: cargo metadata could not run (spawn cargo ENOENT)` and both AC3 tests fail with that output.

The suite takes about ten seconds. On the base 6 of its 7 tests fail, each for the expected reason, as `BASE-FAILURE.txt` shows.

`budgets.test.mjs` judges a wall-clock budget, so it belongs on the `timed` list in `scripts/lanes.mjs`. This job doesn't edit scripts, so the implementing agent adds it there.

## Surfaces

- The lint lane's ratchet command, from `scripts/lanes.mjs`'s exported `checks`. It's the `lint` lane's command `[process.execPath or 'node', 'scripts/size-ratchet.mjs', …]`. The tests run that command as the lane lists it, as a process with cwd at the checkout it checks. That checkout is either a scratch git repository or this checkout, read-only.
- `scripts/size-ceilings.json`, the checked-in ceilings. Each scratch repository gets its own copy in the layout below, and the checkout test reads this checkout's copy.
- `node scripts/canvas-lint.mjs --root <workspace>`, run as a process from this checkout over a scratch Cargo workspace.

Scratch repositories live under the system temporary folder, realpathed. Their git commands run with `-c user.name=Fixture -c user.email=fixture@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null`. Everything is removed in `t.after`. Nothing is written into this checkout.

## Readings where the issue leaves a choice

1. **Script and ceilings file.** The issue names neither. The tests use `scripts/size-ratchet.mjs` beside `scripts/size-ceilings.json`, the same pairing as `scripts/repo-rules.mjs` with `repo-rules.json` and `scripts/known-failures-check.mjs` with `known-failures.json`. The ratchet isn't a sixth line of `scripts/repo-rules.mjs`, because #246's acceptance test requires exactly five lines from that script on a clean checkout.
2. **The ceilings layout.** One JSON object maps each file's repo-relative POSIX path to its ceiling, a whole number of lines. Only files over 1,500 lines have one:

   ```json
   {
     "crates/deep-app/src/views.rs": 3658
   }
   ```

   The ratchet reads it from disk, so a ceiling that has been lowered but not committed counts.
3. **"Fails the lint lane".** The lint lane includes `[process.execPath, 'scripts/size-ratchet.mjs']` (or `'node'` first) as a command of its own. Extra arguments are allowed, inline code (`-e`, `--eval`, `-p`, `--print`) is not, and the canvas lint stays in the lane. The tests run that command directly. They don't go through `runLanes`, because its throttle wrapper waits up to 30 minutes for a build grant, and this Mac is shared. `runLanes` prints each command's output in full and takes the `FAIL lint: …` summary from the first FAIL line (#246's lane tests). So the ratchet's FAIL line is what the lint lane names.
4. **Which files, and how lines are counted.** The ratchet checks the files git lists in the work tree, read from disk. A tracked file counts as it was edited, committed or not, and a planted line is an uncommitted edit. Lines are lines of text, and a last line without a newline counts. For a file that ends in a newline, that's the same number `wc -l` gives. Every line counts, blank or comment, but the fixture's lines are all code, so the count is the same under any counter.
5. **"Hand-written source file".** Source is code a person writes, by language: Rust, TypeScript, JavaScript, shell, Python, WGSL, Swift and the like. Data, docs and media are not source: JSON, Markdown, text, CSV, TOML, lockfiles, images, fonts and video. Hand-written means not generated. The fixtures use only a `.rs` file, which is source under any reading. No test depends on whether vendored code under `vendor/` counts as written here, so that's left to the implementation.
6. **"Generated".** A generated file is one a tool writes. It says so in its first five lines, with `@generated` (as Cargo's lockfile header does) or "Do not edit" (as `crates/deep-contracts/src/generated.rs` does, 72,984 lines at the base). Lockfiles are generated too. A generated file has no ceiling and never fails.
7. **What the ratchet prints.**
   - A failure is a line that starts with `FAIL ` and holds the file's path, its size and its ceiling. Each number is a whole number, with or without a thousands comma. The words around them are free, for example `FAIL size: crates/fixture/src/big.rs: 1,601 lines, over its ceiling of 1,600`.
   - A shrunk file's FAIL line holds the same three things, for example `…: 1,599 lines, under its ceiling of 1,600; lower it to 1,599`.
   - A FAIL exits 1, as the lint lane's other guards do.
   - A pass prints a line that starts with `PASS ` and exits 0, with no FAIL, INVALID, BLOCKED or INCONCLUSIVE line. A silent exit 0 doesn't count as a pass (invariant 2).
8. **"Fails until its ceiling is lowered".** The ceiling has to come down to the file's new size. A one-line shrink fails, so there's no slack. With the ceiling lowered to the size, the run passes.
9. **The scratch repositories.**
   - Each one holds a copy of every flat file in this checkout's `scripts/`, so the ratchet can import its siblings. `.git/info/exclude` hides that folder from git's listing.
   - Each one holds `crates/fixture/src/big.rs`, 1,600 lines of Rust, and `scripts/size-ceilings.json` giving it a ceiling of 1,600. The ceilings file is force-added. Both are committed, and `origin/main` points at that commit, so a ratchet that also checks ceilings against the merge base has one to read.
10. **"Passes on this checkout".** The lane's command runs in this checkout and has to pass. `git status --porcelain=v1 --untracked-files=all` must be the same before and after, and `scripts/size-ceilings.json` must be tracked. The test also checks the ceilings against an oracle of its own, without the script: every tracked `.rs` file under `crates/` with over 1,500 lines and no generated marker in its first five lines has a ceiling equal to its line count, and no file with the marker has one. At the base that's 44 hand-written files and one generated file.
11. **AC3, "fails".** "Fails" means the canvas lint's FAIL: exit 1, its exit for a finding (its usage line says "exits 1 on a finding, 2 when cargo can't run"), and no BLOCKED line.
    - For the planted call, the FAIL line names `deep-canvas-fixture/src/lib.rs:<line>:<column>` at the call's line, and `Instant::now`.
    - For the allowed use, the FAIL line names the file at either the attribute's line or the call's line.
    - The attribute is `#[allow(clippy::disallowed_methods, clippy::disallowed_types)]`, because the path `std::time::Instant::now` trips `disallowed_types` as well. Allowing `disallowed_methods` alone would still fail through `disallowed_types` in a lint that honoured allows, so it couldn't tell such a lint from one that forbids them.
    - "With no reason": the issue makes the lints forbidden, so an allow with a reason fails as well. That case isn't tested.
12. **AC3's twins.** A forbidden lint refuses the `#[allow]` attribute itself, whatever it covers. So the allowed case's clean twin drops both the attribute and the call, and is the same clean crate as the planted call's twin. Each test runs its twin first, then the plant, in one workspace.
13. **AC3's workspace.** It's a plain folder, not a git repository, because the canvas lint reads no git. It holds one dependency-free crate, `deep-canvas-fixture`, and a copy of this checkout's `rust-toolchain.toml`, so clippy is the pinned one the lane uses. `CARGO_TARGET_DIR` is set to a folder inside the workspace.
14. **AC4, the time added, and load.**
    - The time the ratchet adds is the wall time of the lane's command on this checkout, from spawn to exit, node's start included. The test takes the median of three runs, and each run must pass.
    - The lane's throttle and lease wrapper isn't counted: it costs the same for every command, and its wait depends on other sessions.
    - A median under 2 s passes, and it's always a real measurement. If the median is 2 s or more while the one-minute load is at or above the core count, the test skips with `INCONCLUSIVE: …` and the reading. That's never a pass. Otherwise the test fails.
    - This Mac (Mac17,10, Apple M5 Max, 64 GiB) is on the reference-Mac list in `tests/acceptance/1551/helpers.ts`. It's shared and often runs at load 40 or more (300 to 500 while this was drafted), so an over-budget reading here is often INCONCLUSIVE.

## Criteria and tests

| Acceptance criterion | Tests (file: name) |
|---|---|
| A planted line added to a file at its ceiling fails the lint lane, naming the file, its size and its ceiling | ratchet: *AC1: a line planted in a file at its ceiling fails the lint lane, naming the file, its size and its ceiling; at its ceiling it passes*; ratchet: *the lint lane runs scripts/size-ratchet.mjs as a command of its own, beside the canvas lint* |
| A shrunk file with an unchanged ceiling fails until its ceiling is lowered | ratchet: *AC2: a file shrunk under an unchanged ceiling fails, naming its size and ceiling, until the ceiling is lowered to its size* |
| A planted `Instant::now` in `deep-canvas` fails, naming the line. An allowed use with no reason fails | canvas-lint: *AC3: a planted Instant::now in a deep-canvas crate fails the canvas lint, naming its line; the clean twin passes*; canvas-lint: *AC3: an Instant::now under an #[allow] with no reason still fails the canvas lint; the clean twin passes* |
| The lint lane's time grows by under 2 s on the reference Mac | budgets: *AC4: the size ratchet adds under 2 s to the lint lane on this checkout* |
| (Scope) the ratchet passes on the checkout as it stands, with its ceilings checked in | ratchet: *on this checkout the ratchet passes without changing git status, and the checked-in ceilings are the checkout's own* |

## On the base

- Every ratchet test fails because the lint lane has no `scripts/size-ratchet.mjs` command.
- AC3's planted-call test passes on the base, as a regression check should.
- AC3's allowed-use test fails on the base. The canvas lint does refuse the allow, but it reports it as `BLOCKED canvas-lint: …:3:9 allow(clippy::disallowed_methods) incompatible with previous forbid (E0453)` with exit 2. It also prints the Fix line for a missing toolchain ("Install Rust with Cargo and clippy…"), and the lint lane reads that run as BLOCKED, not FAIL.
- So the second half of AC3 isn't a pure regression check. The canvas lint has to report an allow of its own forbidden lints as a FAIL.

## Not covered here

- Two scope sentences that aren't acceptance criteria get no fixture: "a new file over 1,500 lines fails", and "generated files are out of scope". The checkout test's oracle does check that the generated file in `crates/` has no ceiling.
- "This task adds no second `clippy.toml`." That's for diff review.
- Environment reads and unseeded random sources in the canvas lint. AC3 names only `Instant::now`.
- An allow that gives a reason.
