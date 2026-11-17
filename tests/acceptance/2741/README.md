# Acceptance test for #2741: an `affected.mjs` run's shard builds stay within the machine's cores

A blind job wrote this test before any fix for #2741 existed, from issue #2741 (its one acceptance criterion and its
Proof line), AGENTS.md, the design's Dogfooding section and `docs/parallel-proof.md` sections 6 (the throttle table,
inherited grants), 7a (shards) and 13 (capacity), at base commit `80561d40c`. It read `scripts/affected.mjs`,
`scripts/shards.mjs`, `scripts/throttle.mjs` and `scripts/lanes.mjs` there only to learn the surfaces it drives, and
reuses #1115's sandbox and scratch tree and #2574's `start` (imported, not edited). The implementing agent does not edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

## What `cores.test.mjs` checks

One test, for the criterion: "An `affected.mjs` run whose alone block puts a cargo-building file in each of at least
three shards, each on a `target/` that must recompile, never has more `rustc` processes under its grant than the
machine has cores, sampled once a second; on the merge base the same run exceeds the core count."

- **An `affected.mjs` run.** This checkout's real `scripts/` (affected, shards, throttle, lanes and the rest) run in a
  scratch git repository made by #1115's `tree()`: a copy of `scripts/` with the lint lane's own scripts stubbed, links
  to `node_modules`, a vitest config and a known-failures file, all committed. The run gets a HOME of its own, so its
  throttle table, its log and `~/deepbuild-shards/` are the sandbox's, and its grant comes from a table no other session
  uses. It runs as `node scripts/affected.mjs <the three planted files>`, in its own process group.
- **Whose alone block puts a cargo-building file in each of at least three shards.** Three planted test files, each in
  a different folder of `lanes.mjs`'s `alone` list (the first three where such a file is neither `exclusive`, timed,
  slow, left to a person nor in a lane of its own, so each is a group of its own): two vitest files and one
  `node --test` file, since the alone block runs both runners in shards. The change names those three files, and
  `DEEP_SHARDS=3` (with `DEEP_TEST_SHARD_FLOOR=0`, so the disk floor doesn't refuse a sandbox shard) asks for three
  shards. Each file runs `cargo build --offline -p planted-bin` in its own tree, as an alone file that builds a binary
  first does. The test asserts each file's build ran, exited 0, and that the three ran in three different shards under
  the sandbox's `~/deepbuild-shards/`.
- **Each on a `target/` that must recompile.** The scratch tree has no `target/` and the shards are new, so each build
  compiles every planted crate: the test asserts cargo printed `Compiling` for all of them (the number of cores plus
  one) in each shard. The planted workspace is as many leaf crates as the machine has cores, none needing another, each
  a constant cargo evaluates while it compiles (1,000,000 steps, about 2.3 s of one core on the 18-core Mac this was
  drafted on), and a binary needing them all. So one cargo at its default job count runs a `rustc` per core at once,
  and each `rustc` lives seconds, long enough for a reading once a second to see it.
- **Under its grant.** A process is under the run's grant when its parent-pid chain reaches the process holding that
  grant, the check section 6 makes of `DEEP_THROTTLE` ("the holder's place in the requester's parent-pid chain"). The
  run's grant is the first top-level `granted` event in the sandbox's `~/.deepbuild/throttle/log`. The test asserts the
  run took one, and that `rustc` of each shard's build was seen under it, so a build moved out from under the grant
  can't pass by not being counted.
- **Never more `rustc` processes than the machine has cores, sampled once a second.** From the run's start until it
  ends, `ps -A -o pid=,ppid=,ucomm=` starts every second. Each reading counts the processes named `rustc` under the
  holder, split by the planted file whose process they descend from. The machine's cores are
  `os.availableParallelism()`. The test fails when any reading counts more `rustc` than cores. A reading is labelled
  with the second it started; on a loaded machine `ps` can take seconds, so readings overlap and one can see the table a
  few seconds after its label (the base's lone `+153 s: 25` among readings of 1 is most likely one such).
- **On the merge base the same run exceeds the core count.** `BASE-FAILURE.txt` is the test's output at the base,
  where every check before the count holds and it fails at the count: 54 `rustc` under the run's grant at once (18 in
  each of the three shards) on 18 cores, in 72 of 182 readings above 18, while the run itself read
  `PASS affected: ... 3 passed`. It took 3.5 minutes at a one-minute load of 850 to 940.

The output shows what the Proof line asks for: the per-second `rustc` count under the run's grant and the core count.
On a pass they are the test's two diagnostic lines (the peak, with its count per shard, and every reading that counted
any); on a failure they head the message, followed by each planted build's record and the run's output.

## The run's cargo

The run starts with no `CARGO_*`, `RUSTC*`, `RUSTUP_TOOLCHAIN`, `MAKEFLAGS` or `MFLAGS` from the test's own process, so
no job count, jobserver, wrapper or target folder reaches it from outside: whatever limits its builds comes from the
code under test. `RUSTUP_HOME` is the real one (the toolchains), `CARGO_HOME` a folder of the sandbox's (the crates
are path-only and built `--offline`, so no registry is needed, and no user cargo config applies). `cargo` comes from
`PATH`, or else from rustup's proxies in `~/.cargo/bin` or `/opt/homebrew/opt/rustup/bin`. The scratch tree has no
built CLI, so `scripts/lease` runs each job unleased unless `deep` is on `PATH` (it wasn't on the Mac this was drafted
on).

Stubbed: only the lint lane's own scripts (#1115's `tree()`). Everything else is real: `affected.mjs`, `shards.mjs`,
`throttle.mjs`, `lanes.mjs`, vitest, `node --test`, cargo and rustc. Nothing is killed by name or port: the run's process
group is stopped by its PID if it is still running when the test ends, and the sandbox folder, with its HOME, shards,
cargo home and the run's logs, is removed.

## Run

```sh
npm ci   # once, if node_modules is missing
node --test --test-reporter=spec tests/acceptance/2741/cores.test.mjs
```

It needs cargo and a Rust toolchain, works offline, and builds three times as many crates as the machine has cores
(about two minutes of CPU on 18 cores). It allows the run 55 minutes.
