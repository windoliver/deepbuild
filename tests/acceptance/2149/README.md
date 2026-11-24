# #2149 acceptance tests: `cargo fmt --all -- --check` passes on main, and the commit that formats it is only rustfmt's

Written blind at the base `b6317234f` (main), from issue #2149, the design and that base, for the closed-issue sweep
(#2047). The sweep reopened #2149 because no test on main names its criteria; there is no earlier suite for it, so this
folder is the plain issue number and names both. The job saw no fix: it read no pull request (not #2361, which the
issue's comment names), no other commit, branch or worktree, and no history of any Rust file or of a `rustfmt.toml`. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

## Sources

- **The issue**, #2149: its account (`cargo fmt --all -- --check` fails on main; "One command fixes it: `cargo fmt
  --all`", best "in one commit ... with nothing else in it"), its Scope ("One commit that is only `cargo fmt --all`";
  the `fmt` entries out of `scripts/known-failures.json` in the same change), two criteria, Proof ("The command's own
  run, before and after"), the owner's comment (done in #2361 then; rustfmt leaves `tests/acceptance` as written), and
  the sweep's comment with each criterion's ID.
- **The design**, `docs/technical-design.md`: Dogfooding. #2149 links no design section (`scripts/design-section.mjs`
  finds none). **AGENTS.md.**
- **The base, for surfaces only**: `rust-toolchain.toml` (1.99.1 with rustfmt and clippy); `tests/acceptance/rustfmt.toml`
  and `crates/deep-physics-rapier/tests/rustfmt.toml` (`disable_all_formatting`); the root `Cargo.toml` (a virtual
  workspace) and the head of `.cargo/config.toml`; `scripts/lanes.mjs` (the lint lane's first command, `testPaths`,
  the `slow` and `timed` lists); `scripts/lease`; `scripts/known-failures.json` (no `fmt` entries); the proof lanes,
  `scripts/proof-runs.mjs` (`checkout`, `prepare`, `copyChange`, `baseCheckout`, `runNode`, `atAssertion`, `twinsOf`,
  `prepareRuns`, `mutation`, `cargoMutants`), `scripts/proof-change.mjs` (`criterionId`, `readChange`, `readIssue`) and
  `scripts/proof-reporter.mjs`; for the house format, `tests/acceptance/689-redraft-2047/` and `tests/acceptance/2470/`.

## Run

```sh
node --test --test-concurrency=1 'tests/acceptance/2149/*.test.mjs'
```

Plain `node:test` and Node built-ins. It needs rustup with the toolchain `rust-toolchain.toml` pins and its rustfmt
(cargo is found on PATH, else in `/opt/homebrew/opt/rustup/bin`, `/usr/local/opt/rustup/bin` or `~/.cargo/bin`, and put
first; no test installs a toolchain, and every cargo runs with downloads off), git, and a checkout with git history of
its own (a clone, a worktree, or the proof lanes' checkout). Every cargo runs under the checkout's `scripts/lease` at
`nice -n 10`. Nothing is written in the checkout: AC1's `--check` writes nothing, and AC2 formats a copy in a folder
of its own under the system's temporary folder, removed when the test ends. At load 275 to 340 on 18 cores, AC1 took
60 to 100 s and AC2 about 4 minutes on a fixed program (three `cargo fmt --all` runs of about 75 s each), under a
second at the base, where there is no commit to judge; see `BASE-FAILURE.txt`.

## Criteria to tests

IDs are `criterionId` in `scripts/proof-change.mjs` (the first 8 hex digits of SHA-256 of each criterion's text,
trimmed, white space collapsed), as the sweep's comment gives them. Each test's name starts with `AC<n> #2149.<id>`,
from a const string in its own file, so the lanes read the full name from the source.

| ID | Criterion | Test, and what it asserts | Wrong programs it fails on |
|---|---|---|---|
| AC1 `#2149.715a06c4` | `cargo fmt --all -- --check` exits 0 on main | `ac1-fmt-check.test.mjs`: the issue's command at the checkout's root, with the toolchain the checkout pins, exits 0 | The base: exit 1, 177 hunks in 36 files. The twin `file-left-out` |
| AC2 `#2149.976fa716` | The commit's diff is empty under `git diff -w --ignore-blank-lines` apart from line breaks rustfmt moved | `ac2-commit-diff.test.mjs`: there is a commit since this suite's base, not a merge, whose subject names `#2149` and `cargo fmt --all`; for the newest, each file it changes is, under `git diff --no-index -w --ignore-blank-lines`, the same as what `cargo fmt --all` makes of its parent's | The base: no such commit. The proof lanes' merge base side: the commit's files read from a checkout that holds the parent's. The twin `edit-in-format` |

## How each criterion is read

**AC1.** "On main" is the checkout the test runs in, at whatever it holds, as #2470's suite reads it. The test runs
`cargo fmt --all -- --check` at the checkout's root, as the lint lane's first command does, with `RUSTUP_TOOLCHAIN`
cleared so the checkout's `rust-toolchain.toml` picks the rustfmt, and holds its exit code to 0. The message names
each file and hunk rustfmt would change. A guard first asks `cargo fmt --version` there; a toolchain or rustfmt that
isn't installed, a run stopped by a signal or its time limit, or a full disk reads INCONCLUSIVE. Files under
`tests/acceptance/` are rustfmt's to leave (`tests/acceptance/rustfmt.toml`), so blind tests, twins included, never fail
it.

**AC2.** Three phrases need a reading.

- **"The commit"** is the Scope's "one commit that is only `cargo fmt --all`". The test takes the commits HEAD holds and
  this suite's base `b6317234f` doesn't (`git log --no-merges HEAD ^b6317234f`), and of those the first, so the newest,
  whose subject (git's `%s`) names `#2149` as a whole number and `cargo fmt --all`. The base is main as this suite was
  written at it, where `cargo fmt --all -- --check` fails, so the commit that formats main comes after it; two commits
  before it already have such a subject and are never judged. A message is the one surface that finds the same commit
  on every side the proof lanes run (below), on a pull request branch that also carries this suite's commit and merges
  of main (neither matches: this suite's subject doesn't name the command, and merges are left out), and on main after
  the change lands. No such commit fails the test at its assertion: nothing missing passes.
- **"Line breaks rustfmt moved"** is what `cargo fmt --all` makes of the commit's parent. The test copies the parent's
  `*.rs` and `*.toml` files (`git archive`), which is everything cargo fmt reads (at the base, `cargo fmt --all --
  --check` on such a copy prints the checkout's own output byte for byte), and runs `cargo fmt --all` there with the
  toolchain the parent pins. Two things make this more than white space. At the base, 91 of rustfmt's 177 hunks change
  more than white space: the trailing comma it adds to a list it breaks over lines, the braces around a closure or
  match arm it breaks, the `;` after a `continue` it moves into a block. They come with the line breaks it moves, so
  rustfmt's whole output counts as moved line breaks. And rustfmt doesn't settle in one run here: after one `cargo fmt
  --all`, `crates/deep-logic/src/shell.rs` still fails the check and a second run changes it again. So the test runs
  `cargo fmt --all` until a run changes none of the commit's files (at most four runs), and any run's version counts.
- **"Empty under `git diff -w --ignore-blank-lines` apart from"**: for each file the commit changes, some run's version
  and the commit's version, laid out as two folders, give no output from `git diff --no-index -w --ignore-blank-lines`.
  A file the commit adds or removes fails, as rustfmt adds and removes none; a file rustfmt leaves alone, such as any
  file that isn't Rust, keeps its parent's version, so the commit's edit to it fails unless `-w` hides it. The message
  names each failing file and shows its diff against rustfmt's last version.

**The commit's version of a file** is the checkout's own when HEAD still holds the commit's blob at that path, and the
commit's blob from git when a later commit, such as a merge of main, changed the file. The proof lanes run every side
in a checkout whose `.git` they make (`prepare` in `scripts/proof-runs.mjs`): the repository's objects through
alternates, its refs, HEAD at the change's head, the index read from HEAD. History is the change's on every side; only
the files differ. So:

- on the change, the checkout holds the commit's files, and the test passes;
- on the merge base, the checkout holds the base's files (with the change's files under the test paths laid over them,
  such as `crates/deep-show/tests/canvas_packs.rs`), so the commit's other files read as the parent's, which rustfmt
  changes, and the test fails at its assertion;
- on a twin, the twin's file is the one read;
- on main after the change lands, a later change to a file the commit formatted is judged from the commit's own blob,
  so a later edit to main doesn't fail this test (AC1 holds main's formatting from then on).

The test reads INCONCLUSIVE, never PASS, when the checkout has no git history of its own (a `git archive` copy without
`.git`), when the suite's base or the commit's parent isn't in the repository (a shallow clone), when the parent's
toolchain or rustfmt isn't installed, when `cargo fmt --all` fails on the parent or doesn't settle in four runs, or when
a run is stopped by a signal or its time limit.

## What no check here can hold

- **How the commit was made.** The test sees the commit's result, not the command that made it: a hand edit identical to
  rustfmt's output passes.
- **White space inside a string literal.** `git diff -w` ignores it, so the criterion, read as written, lets the commit
  change it; the test does too.
- **One commit.** The test judges the newest matching commit; it can't tell whether an earlier one in the change
  formatted part of the code first. AC1 holds the result.
- **Stricter than the words in one case: a file the commit changes only in white space within its lines, where
  rustfmt moves line breaks.** Its own `-w` diff is empty, but it is no run's version, so it fails here. Such a commit
  also leaves AC1 failing.
- **The Scope's `scripts/known-failures.json` entries.** The base has no `fmt` entry, so there is nothing to remove; no
  test reads the file.
- **The Proof line's runs.** `BASE-FAILURE.txt` holds the run before; the run after is the implementer's.
- **The mutation lane.** cargo-mutants mutates the Rust lines the change adds and runs cargo's tests, not these, so its
  kills prove neither criterion (both name a twin). Over the lines a whole-workspace format adds, it may run for hours.

## What the implementer must provide

- **The checkout formatted:** `cargo fmt --all -- --check` exits 0 at the root with the pinned toolchain's rustfmt
  (1.99.1 at the base, where it fails with 177 hunks in 36 files). One `cargo fmt --all` isn't enough at the base:
  `crates/deep-logic/src/shell.rs` needs a second run.
- **One commit, made on `b6317234f` or later, holding only what `cargo fmt --all` makes of its parent:** run the command
  (until the check passes) on a clean tree and commit everything it changed and nothing else. Its subject names `#2149`
  and `cargo fmt --all`, such as `fmt(#2149): cargo fmt --all`; it is no merge; and it is the newest commit since
  `b6317234f` with such a subject (a later formatting commit of the issue would be judged in its place). Everything
  else the change needs goes in commits of its own: this suite's commit, merges of main, a `scripts/lanes.mjs` entry.
- **The pinned toolchain for the commit:** the test formats the parent with the toolchain the parent's
  `rust-toolchain.toml` pins, so a commit made with another rustfmt release can differ from it.
- **For the run:** rustup with that toolchain and its rustfmt installed in the user's rustup home; git; a checkout with
  history that holds `b6317234f` and the commit's parent (the proof lanes' checkouts, a clone or a worktree).
- These are `node --test` files, which the unit lane doesn't run, so they run by hand and in the proof lanes. Neither
  judges a time, so neither is `timed`. This job edits nothing outside its folder; AC2 takes over two minutes under
  load, so if the implementer wants `scripts/affected.mjs` to treat it as slow, this line goes in `scripts/lanes.mjs`,
  in a commit of its own:

```js
// #2149's blind suite: AC2 runs cargo fmt --all on a copy of the formatting commit's parent until it settles.
slow.push('tests/acceptance/2149/ac2-commit-diff.test.mjs');
```

## Twins

`twins.json` maps each criterion to planted wrong programs under `twins/`, laid over the fixed program as the before
lane lays them. Each replaces one Rust file outside the test paths, whole.

| Twin | Criterion | File it replaces | Fault | Where it fails |
|---|---|---|---|---|
| `file-left-out` | AC1 | `crates/deep-logic/src/track.rs` | The base's file as it is, unformatted: a formatting run that left one file out | AC1's assertion, naming `crates/deep-logic/src/track.rs:150` as the one unformatted file. It fails AC2 too, the file being one the commit formats |
| `edit-in-format` | AC2 | `crates/deep-canvas/src/horizon.rs` | rustfmt's version of the base's file (made by this job's own `cargo fmt --all` in a scratch copy) with one hand edit inside the lines rustfmt broke: `(v - r as f64)` becomes `(v - c as f64)` in `surface` | AC2's assertion, naming `crates/deep-canvas/src/horizon.rs` with that one line. AC1 passes on it: the file is formatted |

A twin works only while the commit formats its file and HEAD still holds the commit's version of it; at the base
`crates/deep-logic/src/track.rs` and `crates/deep-canvas/src/horizon.rs` are both among the 36 unformatted files. The
before lane runs twins only for a test the merge base didn't prove at its assertion, and both tests fail at their
assertions on the merge base side whenever the commit formats a file outside the test paths.

## What was run

See `BASE-FAILURE.txt` for the commands and output. Every result was read from `scripts/proof-reporter.mjs` and judged
by a throwaway copy of the before lane's `atAssertion`.

- **The base, once**, in this worktree with the suite uncommitted: AC1 fails at its assertion in 62 s (177 hunks in
  36 files); AC2 fails at its assertion in 0.3 s (no commit since `b6317234f` names `#2149` and `cargo fmt --all`).
- **A stand-in fix**, in a scratch repository whose objects come from this one through alternates: the base's Rust
  sources, this suite's commit, and `fmt(#2149): cargo fmt --all`, made by running the command until the check
  passed (two runs). Both tests pass: AC1 in 87 s, AC2 in 243 s.
- **The twins** over the stand-in: `edit-in-format` passes AC1 and fails AC2 at its assertion, naming
  `crates/deep-canvas/src/horizon.rs` and the one edited line; `file-left-out` fails AC1 at its assertion, naming
  `crates/deep-logic/src/track.rs:150`.
- **The proof lanes' merge base side** over the stand-in: HEAD kept at the formatting commit, its 35 files outside the
  test paths laid back to the parent's: AC2 fails at its assertion, naming all 35.
- **Not run**: `scripts/proof.mjs` or any lane, so no lane has built its own checkouts or laid these twins; `spans()`
  on these files (no `node_modules` in this worktree); AC2 on `file-left-out`; cargo-mutants.
