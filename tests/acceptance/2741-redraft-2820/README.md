# Acceptance test for #2741, redrafted for #2820: an `affected.mjs` run's shard builds stay within the machine's cores

A blind redraft of `tests/acceptance/2741/`, approved by the owner after a dispute (design: Dogfooding). It was written
from issue #2741 (its one acceptance criterion and its Proof line), issue #2820, AGENTS.md, `docs/parallel-proof.md`
sections 5 ("Binaries for tests"), 6 and 7a as they stand with #2820 (commit `436e26abb`), and the repository at the
base `f17fa347c`, where it read `scripts/` only to learn the surfaces it drives. The implementing agent does not edit
these files (AGENTS.md, Proof).

## The dispute, and what changed

The original test plants, in each of three shards, a test that runs `cargo build --offline -p planted-bin` itself, and
asserts that build compiled all `LEAVES + 1` planted crates, relying on the shards being new ("each on a `target/` that
must recompile"). Under #2820 a run builds, before its test grant and in each shard, every self-started `cargo build`
of its selected tests whose arguments the source writes out, under the profile the tests get. The planted build is
such a build, so it is fresh when the test runs, it compiles nothing, the original's precondition fails, and the test
proves nothing about #2741's criterion.

This redraft keeps the original's run, workspace, shards, sampler and assertions, and changes three things:

- **A `target/` that must recompile, whoever built there before.** Each planted test first writes a seed no earlier
  build saw into every planted leaf crate (`let mut acc: u64 = <seed>;`), then runs the same written-out
  `cargo build --offline -p planted-bin`. Cargo's fingerprints, rustc's incremental cache and any compiler cache all
  miss, so each leaf's constant is evaluated again: the run's pre-build (under #2820) can't leave it fresh. Only
  bumping the sources' mtimes was tried first and is not enough: cargo then prints `Compiling` for every crate, but
  rustc's incremental cache answers in a fraction of a second, and the test rightly refused that run, since no `rustc`
  of the build was seen under the grant.
- **Under its grant, with #2820's two grants.** Under #2820 a run holds a `build` grant for its binaries before its
  `test` grant. The rustc counted are those whose parent chain reaches the holder of any top-level grant in the
  sandbox's table, which nothing but the run uses, so a compile moved under either grant is counted. The test asserts
  the run took a top-level `test` grant (the original asserted any top-level grant).
- **A table named outright.** The run gets `DEEP_THROTTLE_TABLE` pointing into the sandbox's HOME, as well as that
  HOME: inside a test run `throttle.mjs` reads it, and outside one it refuses it (section 6) rather than falling back to
  the machine's table.

The original's helpers it used (#1115's sandbox, scratch tree and `dump`, #2574's `start`) are copied, trimmed to what
it uses, into `helpers.mjs`, so this folder stands alone once `tests/acceptance/2741/` is retired.

## What `cores.test.mjs` checks

One test, tagged with the criterion as the original is: "An `affected.mjs` run whose alone block puts a cargo-building
file in each of at least three shards, each on a `target/` that must recompile, never has more `rustc` processes under
its grant than the machine has cores, sampled once a second; on the merge base the same run exceeds the core count."

- **An `affected.mjs` run.** This checkout's real `scripts/` run in a scratch git repository: a copy of `scripts/` with
  the lint lane's own scripts stubbed, links to `node_modules`, a vitest config and an empty known-failures file, all
  committed, with a HOME and a throttle table of its own. It runs `node scripts/affected.mjs <the three planted files>`
  in its own process group.
- **A cargo-building file in each of at least three shards.** Three planted files (two vitest, one `node --test`), each
  in a folder of `lanes.mjs`'s `alone` list that is its own group (not exclusive, timed, slow, by hand or in a lane of
  its own), with `DEEP_SHARDS=3` and `DEEP_TEST_SHARD_FLOOR=0`. The test asserts each build ran, exited 0, and the three
  ran in three different shards under the sandbox's `~/deepbuild-shards/`.
- **Each on a `target/` that must recompile.** The fresh seed above; the test asserts cargo printed `Compiling` for all
  `cores + 1` planted crates in each shard, and that `rustc` of each shard's build was seen under the run's grants, so a
  build that isn't really compiling, or one moved out from under the grant, can't pass by not being counted. The
  workspace is as many independent leaf crates as the machine has cores, each a constant cargo evaluates while it
  compiles, and a binary needing them all, so one cargo at its default job count runs a `rustc` per core.
- **Never more `rustc` than cores, sampled once a second.** `ps -A -o pid=,ppid=,ucomm=` starts every second from the
  run's start to its end; each reading counts the `rustc` under the run's grants, by the planted file they descend from.
  Cores are `os.availableParallelism()`. Any reading above it fails the test.

The run starts with no `CARGO_*`, `RUSTC*`, `RUSTUP_TOOLCHAIN`, `MAKEFLAGS` or `MFLAGS` from the test's process, so
whatever limits its builds comes from the code under test. `RUSTUP_HOME` is the real one, `CARGO_HOME` the sandbox's.
Nothing is killed by name or port: the run's process group is stopped by its PID if still running, and the sandbox is
removed.

## Base and wrong programs (`BASE-FAILURE.txt`)

**This redraft passes on the base `f17fa347c`**: main already meets #2741's criterion (#2743's jobserver), as the
original also would there. The criterion's "on the merge base the same run exceeds the core count" was the original's
base (before #2743); here it is shown on planted wrong programs instead. `BASE-FAILURE.txt` holds four runs on the
Linux machine (20 cores):

1. The base unchanged: PASS, peak 19 `rustc` under the run's grants.
2. The base's `scripts/` with the jobserver never handed to cargo (one line of `affected.mjs`): FAIL, peak 60 (20 in
   each shard).
3. A stand-in for #2820 (not its code, which this job may not read): the base's `affected.mjs` with each shard's
   planted `cargo build` run first, one at a time, then once more to show the shard's `target/` fresh (0 crates
   compiled, so the original's precondition would fail): PASS, the planted builds still compile all crates within the
   cores.
4. That stand-in with the jobserver removed too: FAIL, peak 60.

## Run

```sh
npm ci   # once, if node_modules is missing
node --test --test-reporter=spec tests/acceptance/2741-redraft-2820/cores.test.mjs
```

It needs cargo and a Rust toolchain, works offline, and builds three times as many crates as the machine has cores
(seconds to about a minute on 20 cores). It allows the run 55 minutes.
