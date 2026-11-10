Written first, from issue #408's criterion 5 (`#408.5416e245`, quoted below), the design sections it leans on, and
base commit `d51be2c3` ("Merge pull request #2108 …"), by a job that never saw an implementation; none exists at the
base. It redrafts criterion 5 of `tests/acceptance/408/` (commit `5062d254`, `machines.test.ts`) for the dispute
below, and only that: the films, the surfaces, the macOS half, the timing half with judgeLimit and the `INCONCLUSIVE:`
rules are the original's. The implementing agent doesn't edit these files (AGENTS.md, Proof); this is the criterion's
one blind redraft (design: Dogfooding, "Each test is redrafted at most once").

# Redraft of #408's criterion 5: film.layout on macOS and Linux, and its time

> film.layout's results are equal on macOS and Linux, and 60 cue ends × 40 texts × 200 strokes of 64 segments check
> in under 50 ms on the reference Mac

## Why a redraft

The original's Linux half builds `deep-show` for linux/amd64 in Docker in `rust:<rust-toolchain.toml's
channel>-slim-bookworm`. A run on the owner's Mac showed two facts about that environment, and this job was told
only these:

1. The slim image has no C++ compiler, so `cargo build --bin deep-show --no-default-features --features full` fails in
   it at `meshopt v0.7.0`'s build script (`ToolNotFound: failed to find tool "c++"`). The Linux half could never build.
2. Docker there is a shared VM with 8 GB and 6 CPUs, running linux/amd64 under QEMU. At cargo's default job count the
   build was killed with exit 137 (out of memory) after about 70 crates; with `-j 2` it got past that point.

What changed, each in `helpers.ts`'s Linux section, and why:

- **The image.** The Linux build needs more than a C++ compiler. `cargo tree --offline --locked -p deep-show
  --no-default-features --features full --target x86_64-unknown-linux-gnu -e normal,build` (metadata only) puts two
  C++ crates in the tree: `meshopt 0.7.0` (through `deep-canvas-scene3d`) and `basisu_c_sys 0.9.1` (through
  `deep-codecs`, on every target). `basisu_c_sys`'s build script also always runs `bindgen 0.72.1`, which loads libclang
  (`clang-sys` 1.9.1). No other crate in that tree needs a system library or `pkg-config`. The official non-slim
  `rust:<channel>-bookworm` has g++ but no libclang, and no official rust image has libclang. So the container runs
  **`deepbuild-acceptance-408-linux:<channel>`**: that image of the same channel with only `libclang-dev` added
  (bindgen's documented package on Debian). It is made once, by a person, with the command below. The channel still
  comes from `rust-toolchain.toml`, and `RUSTUP_TOOLCHAIN` is set to it, as before.
- **Nothing is pulled or built into an image in the test.** When Docker lacks that image as linux/amd64, the Linux half
  is `INCONCLUSIVE:` with the exact commands: `docker pull --platform linux/amd64 rust:<channel>-bookworm`, then the
  one-line `docker build` that adds libclang-dev. Installing libclang inside the test would fetch packages on every
  run, and a pulled image's bytes would be chosen by the run, not by the person who set the machine up.
- **Two cargo jobs** (`cargo build … --jobs 2`, fixed). Two is the one count seen to get past the point where the
  default count (the VM's 6 CPUs) was killed out of memory. The VM is shared with other worktrees' containers, so
  the count must fit its free memory, not its size. Debug info and incremental stay off, as in the original.
- **Each container stops itself.** The build runs under coreutils' `timeout 4h`, and `deep-show run` under `timeout
  30m`, so a container never outlives the test (the original's client-side timeout killed only the `docker` client).
  Under QEMU at two jobs, a cold build may need more than one run. The target, registry and git caches stay under
  `target/acceptance-408-redraft-ac5-linux/`, so each run continues where the last one stopped.
- **A container that decides nothing is `INCONCLUSIVE:`, not FAIL.** That covers Docker unable to run or start it
  (125), its time running out (124), it or a compiler in it being killed (137, or cargo's `signal: 9, SIGKILL`),
  the image lacking a tool a build script looks for (`ToolNotFound`, `Unable to find libclang`), and cargo unable to
  fetch crates over the VM's network. Each message names the cause and the log's tail. Cargo's own failure in the
  container, or deep-show's (a non-zero exit, a refused scenario, rows that differ from the Mac's), still fails.
- The `it`'s timeout is 8 hours (the original's 4), to cover a Linux build of up to 4 hours plus the rest.

Unchanged and not in dispute: the five films are byte for byte the original's (a scratch script imported both
helpers and compared the SVGs, the five documents and the scenario). The macOS half judges them in one `deep-show run`
of `full` (debug), and each row must be decided, the crossing must be caught and the big film must FAIL. Results compare
as `{result, blocked, issues}` with each issue whole, as sorted canonical JSON. The timing half is judgeLimit's
five fresh release processes after a warm-up, each listing all 60 cue ends, reading `timing.check_ms` against 50 ms.
Off macOS, without Docker or the image, or on a machine that can't judge a timing, the test fails `INCONCLUSIVE:`.
The original README's "The surface under test" and "Readings" sections hold for this file as written.

## What was read

- The criterion and the two facts above, as the dispute's brief gave them.
- AGENTS.md; `docs/technical-design.md`: Document check, Dogfooding and "Who drafts it"; `docs/canvas-primitives.md`:
  Check input and Film layout ("Reads evaluated data, never pixels, so it holds on every machine"; the cost, "about 60
  cue ends × 40 texts × 200 strokes in under 50 ms").
- At the base: `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`), `rust-toolchain.toml` (channel 1.99.1),
  `Cargo.toml`, `Cargo.lock`, `.cargo/config.toml` (the `rquickjs` git patch, which the first Linux build fetches into
  its cache as cargo fetches crates), `crates/deep-codecs/Cargo.toml` and `crates/deep-canvas-scene3d/Cargo.toml` (where
  basisu_c_sys and meshopt come in), `cargo tree` as above, the list names in `scripts/lanes.mjs` (`alone`, `timed`,
  `byHand`), and the Docker helpers of `tests/acceptance/238/` and `tests/acceptance/532/`.
- From crates.io's sources in the local cargo registry: `basisu_c_sys-0.9.1/build.rs` and `Cargo.toml` (`fn main`
  always calls `bindgen()`, then compiles C++) and `bindgen-0.72.1/Cargo.toml` (`clang-sys`).
- Commit `5062d254`'s `tests/acceptance/408/` (README, helpers.ts, machines.test.ts, BASE-FAILURE.txt, tsconfig.json).
  `helpers.ts` here is copied from it, minus what criterion 5 doesn't use, with the new Linux section.

## Run it

It builds `deep-show` with cargo on this Mac and in Docker, so it runs alone. It reads the load and judges a timing,
so it is timed. The implementer adds these lines to `scripts/lanes.mjs` (this README is the instruction; this job
edits nothing outside the folder):

```js
// #408's criterion-5 redraft builds deep-show here (debug, and release for its timing) and for Linux x86_64 in Docker,
// and times film.layout against the lane's rule.
alone.push('tests/acceptance/408-redraft-ac5/');
timed.push('tests/acceptance/408-redraft-ac5/machines.test.ts');
```

If this redraft is swapped in for criterion 5 (design: Dogfooding), the original's file is kept as written and run by
hand only: `byHand.push('tests/acceptance/408/machines.test.ts');`.

Once per machine, with the network, for the Linux half (channel 1.99.1 at the base; the test's message names the
current channel's commands):

```sh
docker pull --platform linux/amd64 rust:1.99.1-bookworm && printf 'FROM rust:1.99.1-bookworm\nRUN apt-get update && apt-get install -y --no-install-recommends libclang-dev && rm -rf /var/lib/apt/lists/*\n' | docker build --platform linux/amd64 -t deepbuild-acceptance-408-linux:1.99.1 -
```

Then:

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/408-redraft-ac5 --no-file-parallelism
npx tsc -p tests/acceptance/408-redraft-ac5/tsconfig.json   # type-check
rm -rf tests/acceptance/408-redraft-ac5/node_modules/.vite
```

The file first runs `cargo build --locked --bin deep-show --no-default-features --features full` here, with
`CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0` unless set. It copies the binary out of `target/` (honoring
`CARGO_TARGET_DIR`), and the test fails if that build failed. In Docker it runs `cargo build --locked --bin deep-show
--no-default-features --features full --jobs 2`, with the checkout mounted read-only and the caches under
`target/acceptance-408-redraft-ac5-linux/`. On a machine judgeLimit says can judge a timing now, it also builds
`--release` here. Every test folder is temporary and deleted. Node built-ins and vitest only. A test that can't decide
here fails with a message starting `INCONCLUSIVE:`, never passing.
