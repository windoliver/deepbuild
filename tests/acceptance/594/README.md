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

## 2026-11-19: criterion tags and twins

The fix landed on main, and the closed-issue sweep reopened #594 because no test named its criteria IDs. The tests now carry them at the start of their names. No assertion, fixture or behavior changed, but `build-dirs.test.mjs` and `warm.test.mjs` each gained a two-line header comment saying why the test is or isn't tagged, which moves their assertion lines down by 2 (the line numbers in `TWINS-RUN.txt` are those of the commented files):

- `#594.5f88bcfc` (criterion 1 as amended, below): `build-dirs.test.mjs`, tagged first. Its second preflight must build no dependency on either side, in its warm-up or its measured run, which is contract 3 and the amended criterion.
- `#594.18edc4ce` (criterion 2): `margin.test.mjs` and `build-dirs.test.mjs`. The latter's change adds only a dependency the warm-up builds, plus a test file the compared run leaves out, and it holds the measured `cpuMs` within the margin on both preflights (contract 6).
- `#594.fb185499` (criterion 3): `margin.test.mjs`. Its name puts this tag first, before `#594.18edc4ce`, because the before lane tries a test's twins in its tags' order and takes the first one it fails on. So `margin-widened-on-lock` decides `margin.test.mjs`, and `build-dirs-not-kept` decides `build-dirs.test.mjs`. Both tests also fail on `warm-skips-clippy` (`TWINS-RUN.txt`), but with the tag order as it is, no test is decided by criterion 2's own twin.
- `reference.live.test.mjs` is untagged on purpose and kept for history only, run by hand. It tests criterion 1's old wording, which no criterion has now. Had it been tagged, the following would apply. The proof lanes pick tests by tag alone, so a tagged live test would run in the before lane on every machine, and its `assert.fail('BLOCKED: …')` would read as a failure on the change, not as BLOCKED. It also measures an external checkout, so no planted program could fail it, and a tag would let the closed-issue sweep count the old criterion held when no run had proven it.
- `warm.test.mjs` is untagged: it proves the mechanism, clippy warmed, but not the measured `cpuMs` within the margin that criterion 2 names.

With the fix on the merge base, the before lane needs planted wrong programs. `twins.json` and `twins/README.md` name them: `build-dirs-not-kept` for criterion 1, `warm-skips-clippy` for criterion 2 and `margin-widened-on-lock` for criterion 3. `TWINS-RUN.txt` shows each tagged test failing at an assertion on its criterion's twin.

Criterion 1 was amended on 2026-11-19, with the maintainer's approval. The old text was "With the #337 branch's dependency tree, a second preflight on the reference Mac finishes in under 5 minutes, perf included." (`#594.b71277c1`). It was out of reach: `benchmarks/budgets.json`'s `preflight` limit was raised from 300 s to 900 s on 2026-10-22. Its `changeReason` says the checks alone outgrew five minutes on the reference Mac (Mac15,12): the unit lane alone took about 790 s, and with everything that may overlap overlapped the floor is about 450 to 500 s. The new text is "A second preflight of the same change compiles no Rust dependency on either side, the merge base or the run without the change's own tests, in its warm-up or its measured run." (`#594.5f88bcfc`). That is contract 3, and `build-dirs.test.mjs` now holds it.

`reference.live.test.mjs` also hard-codes Mac15,7 (M3 Pro, 36 GB), while the design now names three reference Macs (Mac15,7; Mac15,12, M3, 16 GB; Mac17,10, M5 Max, 64 GB). It is kept as it was, for history.
