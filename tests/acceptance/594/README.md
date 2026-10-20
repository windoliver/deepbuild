# Acceptance tests for #594: warm Rust builds in the perf lane's copies, and a warmed clippy

These tests were drafted blind from issue #594 (its text as of October 19), `docs/technical-design.md` and the base commit `fcf82f4`, which is `origin/main` and has no implementation. Per AGENTS.md, the implementing agent doesn't edit them. A dispute goes to a blind redraft by this job.

Run them with:

```
node --test 'tests/acceptance/594/*.test.mjs'
```

`node --test tests/acceptance/594/` doesn't work on Node 23: it treats the folder as one test file. They need `cargo` and `cargo clippy` on `PATH` and run offline. Three of the four take well under a minute together on a fix. The fourth, `reference.live.test.mjs`, is criterion 1 and only passes on the reference Mac (below). On the base all four fail, each for the expected reason, as `BASE-FAILURE.txt` shows (local paths redacted). That file also lists the planted wrong programs each test was run against.

## The surface (my choice, since none was named)

The issue names `scripts/perf.mjs`, `warm()` in `scripts/benchmark.mjs` and the preflight. The tests reach the code only through these:

- `node scripts/preflight.mjs`, run as a process with cwd at a scratch fixture repository whose `scripts/` is a copy of this checkout's `scripts/`. This is the whole lane the issue measures: preflight's own `warm()` of the working tree, the measured check run, then `scripts/perf.mjs` with its merge-base copy and its copy without the change's own tests.
- `warm(cwd)` exported from `scripts/benchmark.mjs`, called in a child process from the fixture's copy of `scripts/`.
- `fingerprint()` from `scripts/benchmark.mjs`, for the reference-Mac test only.
- What perf prints: the `PASS perf (…)`, `FAIL perf: …` and `BLOCKED perf: …` lines, and the JSON verdict line with `"task":"preflight"`, its `current.cpuMs` and `base.cpuMs`.

### The fixture

Each test gets a sandbox under the system temporary folder (realpathed), removed in `t.after`:

- A Cargo workspace with one member, `crates/app`, a binary that depends on `dep-a`. Its "registry" is a vendored directory source in the sandbox (`.cargo/config.toml` replaces crates-io with it), so it builds offline and cargo fingerprints those crates like registry crates, not by file times. The change under test adds `dep-b`, a heavy crate: about 2 s of CPU to check, about as much to build.
- `probe-macro`, a proc macro each probed crate (`dep-a`, `dep-b`, `app`) calls once. Each time rustc compiles one of them it appends a line to the sandbox's compile log: the crate, its `--emit` (`dep-info,metadata` is clippy's check, `…,link` a build or a test build) and the realpath of its `--out-dir`. A crate cargo finds fresh isn't compiled, so it writes nothing. That's how the tests see which side built what, where, and whether a build directory was reused, wherever the implementation puts it.
- `scripts/checks.mjs`, the fixture's check workload, runs Rust as the lanes do: the lint lane's `cargo clippy --workspace --all-targets --locked -- -D warnings`, the unit lane's `cargo test --workspace --locked --no-run`, and the parity lane's `./target/debug/app`. It writes begin and end marks to the compile log, so a compile between them is one the measured run paid for. It is labelled `base` on the merge base and `checkout` on the change.
- `package.json`'s `build` is `cargo build --workspace --locked`, as this repo's is. `benchmarks/budgets.json` holds the frozen `preflight` entry (margin 0.5) and no tasks.
- Every process runs with `HOME`, `XDG_CACHE_HOME` and `TMPDIR` in the sandbox and an empty `CARGO_HOME`. `CARGO_TARGET_DIR`, `CARGO_BUILD_TARGET_DIR`, `CARGO_BUILD_BUILD_DIR`, compiler wrappers and `RUSTFLAGS` are removed. `RUSTUP_HOME` stays the caller's, so the toolchain is found.

## The contract the implementation must meet

1. **`warm(cwd)` also warms clippy.** After `warm(cwd)`, the lint lane's clippy in `cwd` compiles no dependency. `warm()` must run clippy over the workspace's own targets: `cargo clippy --workspace --all-targets --locked`, as the issue says, or the lane's exact command with `-- -D warnings`. Either is accepted. After `warm()`, at least one of the two commands finds `app` fresh. `cargo check` warms the dependencies but not the member, so it fails.
2. **No measured run compiles a dependency.** In one preflight, the measured check runs of the working tree, the merge-base copy and the copy without the change's own tests compile neither `dep-a` nor `dep-b`.
3. **One build directory per side, kept between runs.** On a first preflight, the merge-base copy builds its own dependencies, and so does the copy without the change's own tests, both `dep-a` and `dep-b`. They build into different directories. Neither is the working tree's `target/` or anything inside it, neither is inside the throwaway copy, and both still exist after the run. On a second preflight of the same change, no side compiles any dependency, in its warm-up or its measured run.
4. **Where the directories live.** The tests don't name a location. They only isolate `TMPDIR` (`os.tmpdir()`), `HOME` and `XDG_CACHE_HOME`, and the checkout itself is per test. A directory keyed under any of these, such as `<tmpdir>/…/<side>`, `~/Library/Caches/…` or the checkout's `.git/`, works. A hard-coded absolute path outside them would leak between tests and runs, so it isn't supported.
5. **`./target/debug` still works in each copy.** `scripts/preflight.mjs` notes that the parity lane and the budgets run `./target/debug` binaries, so a shared Cargo target directory would misplace them. The fixture's checks run `./target/debug/app` from the copy's root. A copy whose build output isn't reachable there (for example `CARGO_TARGET_DIR` set elsewhere with nothing at `./target`) makes the checks exit 1, and perf says `BLOCKED perf`. A `target/` in the copy that links to the kept directory works.
6. **Criterion 2.** For a change that only adds a dependency (`dep-b`, built by preflight's own warm-up), the first preflight prints `PASS perf (…)` and no `FAIL perf` or `BLOCKED perf`. The verdict line has `"status":"PASS"` and `current.cpuMs <= base.cpuMs * 1.5`. The same holds for the dependency-plus-test change in contract 3, on both runs.
7. **Criterion 3.** The same tree, with check work that spends 3 s more CPU and a test file of its own, fails perf. Preflight exits 1 with no `PASS perf` and no `BLOCKED perf`, and a `FAIL perf: … cpuMs <n> …` line with `n >= 3000`. That `n` comes from the run without the change's own test.

## What only the reference Mac can prove

Criterion 1 ("with the #337 branch's dependency tree, a second preflight on the reference Mac finishes in under 5 minutes, perf included") can't be measured here. This job has neither the reference Mac nor the #337 branch, and a timing budget counts only on the reference Mac (design: The reference Mac). Contract 3 is the deterministic part of it: a second preflight rebuilds nothing of the dependency tree on either side.

`reference.live.test.mjs` is the criterion itself. Run it by hand on the reference Mac, in a checkout of `spike/337-gpui-decision` with the fix merged:

```
DEEP_594_CHECKOUT=<that checkout> node --test tests/acceptance/594/reference.live.test.mjs
```

It runs that checkout's `scripts/preflight.mjs` twice and judges the second. That run must print `PASS perf (…)`, and its `preflight elapsed: <s> s` and its wall time must both be under 300 s. It fails with `BLOCKED:` in its message, and never skips, in three cases: `fingerprint()` isn't the reference Mac's (Mac15,7, Apple M3 Pro, 36 GB, mains power, Low Power Mode off, thermal state nominal, with a macOS build), `DEEP_594_CHECKOUT` is unset, or the checkout's `Cargo.lock` adds no `gpui` package over its merge base. So it fails on every other machine, with or without a fix, and criterion 1 stays open until someone runs it there.

## Readings where the issue leaves a choice

- **"A change that only adds dependencies already built."** I read "already built" as built by the untimed warm-up before the measured run, which is what preflight does for the working tree. The test's change adds one dependency and nothing else, and its first preflight must pass within the margin.
- **"Really slows the checks."** This is check work that costs 3 s more CPU per run, ten times the fixture base's few hundred ms. It lives in the check workload, so it shows up in every measured run, not only in an untimed build.
- **"Each side's builds stay its own."** I read this as no build directory shared by the merge-base copy and the copy without the change's own tests, and neither side using the working tree's `target/`. So the base never gets a cache the change's side made, or the reverse.
