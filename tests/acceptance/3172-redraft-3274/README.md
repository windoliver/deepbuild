# Blind redraft of #3172's Spark test (`#3172.5a315338`): the saved run read against its own commit's workspace

This folder replaces one test of the first draft, `../3172/`: the fourth test in `../3172/inconclusive.test.mjs`,
`#3172.5a315338 the Spark's cargo test at 0c73a8a4: …`. That test is retired by a separate commit, with the owner's
approval. It isn't edited here, and nothing else in `../3172/` is.

## Inputs

Only these, as a blind job sees them:

- issue #3172's body (its three criteria, the 19 targets and their lines);
- `AGENTS.md` and the design sections `node scripts/design-section.mjs --issue 3172` prints;
- the code at the base commit `727d0821e` (branch `claude/issue-3172-app992-redraft`): the first draft in
  `../3172/` (README, helpers, tests, twins) and the Spark's saved run `docs/evidence/1121/spark-test-0c73a8a4.txt`.

## The dispute and the ruling

The disputed test replays the Spark's saved `cargo test --workspace` through the checkout's own `cargoResults`
(`scripts/lanes.mjs`), with the workspace's targets taken from today's checkout by `cargo metadata`. `cargoResults` names
a target by cargo's `Running <source path relative to the crate>` line, keyed against those targets. At the base,
`acceptance_992_app` in `crates/deep-replica/Cargo.toml` points at `tests/acceptance/992-redraft-3172/app.rs`, a blind
redraft for #3172's third criterion; the saved run, made at `0c73a8a4`, names `../../tests/acceptance/992/app.rs`. The
replay can't match that line to the target, so it reads `acceptance_992_app` FAIL, not the BLOCKED its line says
(`RESULTS.txt`, part 3). A live run at the base would print the new path and read right.

Ruling: the replay must not read today's `[[test]]` paths. It reads the saved run against the workspace as it was at
`0c73a8a4` (`0c73a8a484332294d80b1f020bef3ac7af1cb5d0`), the commit the run was made at, which is in main's history.

How this test gets that workspace: `git archive` of `0c73a8a4` from the checkout's own git objects, limited to every
`Cargo.toml`, every `.rs` file and `Cargo.lock` (about 40 MB, under a second), unpacked into the test's sandbox; then the
lane's own `crates()` runs `cargo metadata --no-deps --offline` there. Every `Cargo.toml` alone isn't enough: cargo
needs a crate's `src/lib.rs` or `src/main.rs` and finds `tests/*.rs` by looking. With the `.rs` files, `crates()` reads
exactly what it reads of the full tree at `0c73a8a4` (compared once by hand while drafting). It is offline, makes no
worktree, and needs only that the repository holds the commit: a fresh clone does, and a bay reads the clone's objects
through its alternates. A shallow clone that lacks it fails the test at its setup assertion, never passes it.

## Old test, new test, criterion

| | Test | Workspace read | At the base |
|---|---|---|---|
| Criterion | `#3172.5a315338`: a cargo target that exits non-zero having printed `<its name>: INCONCLUSIVE; <reason>` and reported no test is read INCONCLUSIVE by the unit lane with that reason, never FAIL and never PASS; one that printed `<its name>: BLOCKED; <reason>` is read BLOCKED | | |
| Old (retired) | `../3172/inconclusive.test.mjs`, 4th: `#3172.5a315338 the Spark's cargo test at 0c73a8a4: each of the issue's 19 targets is read as its line says, an INCONCLUSIVE one with its reason, never FAIL or PASS` | today's checkout | fails: `acceptance_992_app` reads FAIL |
| New | `spark.test.mjs`: `#3172.5a315338 the Spark's cargo test at 0c73a8a4, read against that commit's workspace: each of the issue's 19 targets is read as its line says, an INCONCLUSIVE one with its reason, never FAIL or PASS` | `0c73a8a4`'s | passes |

The judgement is the old one, unchanged: for each of the 19 targets in `../3172/helpers.mjs`'s `SPARK_TARGETS`, exactly
one failure under its ID (`cargo <the arguments that rerun it>`), in the state its line gives (18 INCONCLUSIVE, each
message holding its reason; `acceptance_992_app` BLOCKED, its state only, as the criterion asks), and no pass under it.
The run, its exit status and the reader come from the first draft's helpers (`sparkRun`, `read`, `sandbox`, `ofTarget`).

## The wrong program

The merge base already holds #3172's lane fix, so this test passes there and the before lane needs a planted wrong
program. `twins.json` names one for `#3172.5a315338`:

| Twin | Replaces | The planted fault | Fails |
|---|---|---|---|
| `no-own-line` | `scripts/lanes.mjs` | The base's file with #3172's own-line reading taken out (the `said` map, the `<name>: INCONCLUSIVE\|BLOCKED; <reason>` match and its use): every target that fails outside any test it reported reads FAIL, as before #3172 | At its assertion (`spark.test.mjs:45`): all 19 targets read FAIL (`RESULTS.txt`, part 2) |

It replaces one file and no test or helper. A copy goes stale as `scripts/lanes.mjs` changes, and still holds its fault.

## Running it

```sh
node --test tests/acceptance/3172-redraft-3274/spark.test.mjs
```

Any machine with git and cargo: it builds nothing and runs no cargo test, only `cargo metadata`. About a second. The
twin was run on an APFS clone (`cp -c`) of `scripts/`, `tests/acceptance/3172/`, `docs/evidence/1121/` and this
folder, with a `.git` file naming the same repository, the twin's file over `scripts/lanes.mjs`; same command. No fixed
wait, so `scripts/wait-ceilings.json` needs no entry.

## Readings to revisit

- **The archive's file set.** `Cargo.toml`, `*.rs` and `Cargo.lock` is what `cargo metadata --no-deps` needed at
  `0c73a8a4`. A manifest that read some other file at metadata time (none did) would need it added.
- **`0c73a8a4` in the repository.** The test asserts git holds it; it doesn't fetch. A lane copy without the
  repository's objects would fail there, which is a setup failure, not a reading.
- **BLOCKED's reason.** As in the first draft, the criterion asks the reason only of an INCONCLUSIVE reading, so
  `acceptance_992_app`'s BLOCKED reading is checked for its state alone.
- **The machine.** Run on the Mac at a load near 60–80; the test has no timing in it, so load doesn't bear on it.

## Files

- `spark.test.mjs`: the one test.
- `twins.json`, `twins/no-own-line/scripts/lanes.mjs`: the wrong program.
- `RESULTS.txt`: the runs at the base, with the twin, and the first draft's test at the base.
