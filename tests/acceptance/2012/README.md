# Acceptance tests for #2012: cross-machine goldens, recorded on the reference Mac and matched on Linux x86_64 and in wasm32

Written first, from issue #2012 (its Scope, Fields, four acceptance criteria and Proof line: "Rapier's own determinism
tests and a golden recorded on macOS matching on Linux"), its Oracle page, the design sections it names and base commit
`903a1c07` ("Merge pull request #2162 …", which holds #2009's, #2010's and #1983's merges), by a job that never saw an
implementation; none existed, and no other worktree, branch or PR was read. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). The upstream scenes the
Oracle page links for criteria 1 and 3 are ported in `tests/acceptance/2012-oracle/`, on this suite's surface;
criterion 2, which names Rapier's own tests, runs them here.

## What was read

- The issue, live with `gh issue view 2012 --repo windoliver/deepbuild`, and its Oracle page
  (`doneright/oracles/issues/2012.md`, `DeepBuildAI/deepbuild`, branch `doneright`), with the four rapier3d files it pins
  at commit `3406750a38` (`vendor/rapier-3406750a38/crates/rapier3d/tests/`: snapshot_portability, simd_backend_determinism,
  simd_backend_parity, snapshot_roundtrip), each byte for byte the file the rapier3d 0.36.1 crate ships (`cmp`).
- `docs/technical-design.md`: The physics module; Platforms (CPU architecture: a linux/amd64 container on the reference
  Mac counts as the other architecture for CPU checks; the web player builds the canvas core for wasm32 on one thread and
  its suite needs physics step hashes); Seeded and replayable (goldens prove replays on arm64, x86_64 and wasm32);
  Dogfooding; Tests written first. AGENTS.md.
- `docs/canvas-primitives.md`: A timeline as data over a pinned backend; World and backend `physics.world@1`; Checkpoint
  ring; Bake; Golden; Registry and seal: runtime digest; Check input: `physics.determinism`.
- At the base: `tests/acceptance/2009/`, `2010/` (README, helpers.ts, every test), `2010-oracle/` (README, helpers.ts,
  snapshot-roundtrip-rapier.test.ts), `1983/` (README, helpers.ts); `crates/deep-canvas-physics` (bake.rs, golden.rs),
  `crates/deep-physics-rapier` (build.rs, main.rs, fp.rs, Cargo.toml); `scripts/lane-x86.mjs`, `scripts/lane-x86.json`,
  `scripts/lanes.mjs` (`alone`), `scripts/wasm32.mjs`, `scripts/physics-build.mjs`, `scripts/proof-change.mjs`
  (criterion IDs), `rust-toolchain.toml`, `.cargo/config.toml`, `Cargo.toml` (profiles).

What the base already answers, which these tests don't credit: #2010's `deep-physics` with `golden` (a `bake_key`
without the target triple, `machine: {os, arch, cpu}`, `record_on`, `step_hashes`, `checkpoint_hashes`), `golden_verify`
(`verdict`, `bake_key`, `runtime_digest`, `machine`, `target`, `report`, `failure`, and `refused` naming both keys when
they differ), `golden_cross` (a run on the recording architecture never counts) and `bake` with step hashes and
checkpoints; the lane's pin `scripts/lane-x86.json`, whose linux/amd64 and linux/arm64 images are on this Mac; a
toolchain that pins `wasm32-unknown-unknown`. Checked at the base, apart from the run: every world here builds, records
a golden and replays it PASS on this Mac; a replay shifted one ulp at step 120 answers FAIL with `first_step` 120; the
changed document of criterion 4 answers FAIL with `refused` naming the golden's key; both platforms of the lane's image
start with `--pull never` and `--network none` and report rustc 1.99.1 at the Mac's commit hash; and Rapier's four
files, built in a scratch package outside the checkout with the physics build's rapier3d features and the workspace's
lockfile, report all 11 named tests ok on this Mac (snapshot_roundtrip's in 49 s), so the names here are upstream's and
the criterion can pass. The base has no
`machine.target` in a golden, no `machines` or `step_hashes` in a replay, no wasm32 leg and none of Rapier's tests in the
workspace.

## Run them

```sh
npm ci                                   # once, if node_modules is missing
colima start                             # once, if Docker is down
docker pull --platform linux/amd64 "$(node -p "const p=require('./scripts/lane-x86.json'); p.image+'@'+p.digest")"   # once
docker pull --platform linux/arm64 "$(node -p "const p=require('./scripts/lane-x86.json'); p.image+'@'+p.digest")"   # once: the Linux VM
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/2012 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/2012/tsconfig.json
rm -rf tests/acceptance/2012/node_modules/.vite
```

What a run builds and needs (honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0`
unless set; Homebrew's rustup put on PATH when present, as #2009's helpers do):

- **`deep-physics`** for this Mac, once per file, through `../2009/helpers.ts` (`cargo build --locked --bin deep-physics`,
  the binary copied out). 41 s cold on this Mac at the base.
- **The wasm32 leg**, `node scripts/physics-wasm32.mjs`, which builds the physics module for wasm32-unknown-unknown itself
  (below), with the caller's `*RUSTFLAGS` cleared.
- **The second machines**: the #1983 lane's pinned image (`<image>@<digest>` from `scripts/lane-x86.json`), never pulled
  (`--pull never`), as linux/amd64 (Linux x86_64, under QEMU on this Mac) and linux/arm64 (the Linux VM, native in
  colima's arm64 VM). `cargo build --locked --bin deep-physics` (and criterion 2's `cargo test --locked --no-run`) runs in
  it with the checkout mounted read-only, `RUSTUP_TOOLCHAIN` set to rust-toolchain.toml's channel, and its caches under
  `target/acceptance-2012-linux/<amd64|arm64>/` (target, registry, git), with the network, as the lane's own build does;
  every run after that has `--network none`. The first emulated build of the workspace's resolution and Rapier takes long,
  so each test with a container leg has a 3-hour timeout (criterion 2's Linux test 4 hours: four emulated test runs after
  the build); every other test 60 minutes. None was built at the base (each test fails before it, see BASE-FAILURE.txt).
- **Rapier's own tests** (criterion 2): `cargo metadata`, `cargo tree`, and `cargo test --locked -p <package> --test
  <target>` natively and, `--offline`, in the linux/amd64 container.

Gates: a host other than the arm64 reference Mac, Docker unreachable (`colima start`), or no linux/amd64 or linux/arm64
image of the pinned digest (`docker pull --platform <platform> <image>@<digest>`) is `BLOCKED:` with that one ask, a
failed test, never a pass. A container build that fails is a failure. Temporary folders (binaries, golden stores) are
deleted; the container caches stay under `target/`. Node built-ins and vitest only. **`scripts/lanes.mjs` needs
`'tests/acceptance/2012/'` and `'tests/acceptance/2012-oracle/'` in its `alone` list** (the files build cargo binaries,
run Docker builds under emulation and cargo test in containers); this README is the instruction, the implementer makes
that edit.

`BASE-FAILURE.txt` is the run at the base: every test fails at an assertion because the surface is absent, before any
container or wasm32 build.

## The surface under test

The issue names goldens, their machines, step-for-step matches, the Linux VM's `machines: same`, a pending
cross-machine criterion, Rapier's own tests and a planted document change, but no command line. **Every call, reply
field, script, file rule and configuration below that the issue or the design doesn't give is this job's invention**,
the smallest the criteria need, extending #2010's (`tests/acceptance/2010/README.md`: The surface under test), whose
calls, fields and worlds stay as that README defines them. The implementer builds exactly these, or a dispute goes to a
blind redraft.

### `deep-physics`: what this suite adds

| Call | Addition |
|---|---|
| `golden` | the Golden's `machine` adds `"target"`: this host's target triple, as `record_on` names it (Golden: a golden "records the triple in its machine"); `bake_key` stays the key without the triple |
| `golden_verify` | the Run adds `"machines": "same" \| "different"`: `same` when this run's `machine.arch` is the golden's `machine.arch`, else `different` |
| `golden_verify` | the Run adds `"step_hashes": [16 hex]`: this replay's own step hashes, index k the state after k steps (index 0 as built), as a bake's; with `shift`, the shifted run's |
| `golden_verify` | (the base's field, named here) on a golden whose `bake_key` or `runtime_digest` isn't this run's: verdict `FAIL` and `"refused": string`, naming the golden's `bake_key` (and this run's) |

Everything else is #2010's: `golden` (`verify_on` as asked), `golden_verify` (`shift`, `report`, `failure`),
`golden_cross` (`machines` as `{name, target}`, verdicts PASS, FAIL, PENDING, BLOCKED), `bake` (`read`, `checkpoints`,
`key`). A replay on wasm32-unknown-unknown answers `target` `wasm32-unknown-unknown` and `machine.arch` `wasm32`
(`std::env::consts::ARCH`); its `failure` stays null, as wasm32 has no floating-point control register to set otherwise.

### The wasm32 leg: `node scripts/physics-wasm32.mjs`

A new script. Run from the checkout with `deep-physics` calls as JSON lines on stdin, it answers each with one JSON line
on stdout, in order, and exits 0: the `deep-physics` protocol. It builds the physics module for `wasm32-unknown-unknown`
(the target rust-toolchain.toml pins for the web) with cargo `--locked`, the caller's `*RUSTFLAGS` cleared, and answers
the calls inside Node's own WebAssembly engine (V8), on one thread, with no WASI and no native helper: no call is
answered by a native build. This suite sends `golden_verify` (with and without `shift`, never a `store`) and, in the
Oracle lane, `bake` (`checkpoints: true`, `read: []`, no store).

Why this surface: the web player doesn't exist yet. Its wasm32 is the canvas core built for wasm32-unknown-unknown and
run on one thread in a browser's engine, so the smallest honest stand-in runs that same target's build in that engine
without a browser: Node's V8, the engine of Chromium-based browsers, already this suite's runner, so nothing is
installed or pulled. wasm32-unknown-unknown has no stdin, files or processes, so a JavaScript host must carry the calls,
and one script keeps them in deep-physics's protocol so every judge here reads all three machines alike. Rapier's own CI
runs its portability test under wasm32-wasip1 and a WASI runtime instead; that target isn't the web player's and isn't
installed here. A replay shifted one ulp at step 120 must differ first at step 120, so a script that echoed the golden,
or ran anything but the stepping world, fails.

### The second machines: the lane's containers

"Linux x86_64" is the #1983 lane's machine: its pinned image as linux/amd64 on this Mac, our x86_64 build under
emulation, which counts as the other architecture for CPU checks (Platforms: CPU architecture). "A Linux VM on the reference Mac" is
the same image as linux/arm64, which colima's arm64 Linux VM runs. The tests run these containers themselves with the
lane's rules (the pin, `--pull never`, the checkout read-only, caches under `target/`, `--network none` for every run
after a build), because `scripts/lane-x86.mjs` replays deep-logic goldens and no criterion here reads a lane record; the
lane script isn't exercised. Each runs `deep-physics` built there by `cargo build --locked --bin deep-physics`.
`golden_cross`'s configured machines are `{name: "linux-amd64", target: "x86_64-unknown-linux-gnu"}`, `{name:
"web-player", target: "wasm32-unknown-unknown"}` and, for the VM's own target, `{name: "linux-vm", target:
"aarch64-unknown-linux-gnu"}`.

### Rapier's own tests in the workspace

Each of rapier3d 0.36.1's `tests/snapshot_portability.rs`, `tests/simd_backend_determinism.rs`,
`tests/simd_backend_parity.rs` and `tests/snapshot_roundtrip.rs` is the root file (`cargo metadata`'s `src_path`) of a
test target of a workspace package, its text upstream's exactly after an optional header of blank and plain `//` lines
(not `//!` or `///`), where its license notice goes (AGENTS.md: ported code keeps its license notice; Rapier is
Apache-2.0). The package and target names are the implementer's. Each file's tests are run by `cargo test --locked -p
<package> --test <target>` and must report `ok` by name: their `#![cfg(feature = "serde-serialize")]`,
`#![cfg(all(feature = "enhanced-determinism", not(feature = "simd8")))]` and the rest read the package's own features, so
the package must turn those on for the files to compile anything. The build is the pinned one: `cargo tree --locked -p
<package> -e normal,dev` resolves rapier3d and parry3d, wide, glam, glamx, simba and libm at the same versions with the
same features as `cargo tree --locked -p deep-physics-rapier -e normal`, for this Mac's target and for
x86_64-unknown-linux-gnu. The toolchain is rust-toolchain.toml's channel on both machines (the container's rustc at this
Mac's commit hash); the flags are the checkout's cargo configuration with the caller's `*RUSTFLAGS` cleared.

### Planted wrong programs

No `--planted` name is added. The wrong programs are the tests' own inputs, each caught by the judge that passes the
real program:

| Plant | Criterion | The wrong program |
|---|---|---|
| `shift: {step: 120, id: ball, field: linear.x, ulps: 1}` in a second `golden_verify` (#2010's field) on wasm32 and on Linux | 1, 3 | a replay one ulp off from step 120: its own step hashes must first differ at 120, its verdict FAIL, its report at 120 |
| the pile-and-flyer document with the flyer's x velocity one f32 ulp higher | 4 | a changed document replayed against the golden on Linux: FAIL under another key, naming the golden's key |
| `cargo tree … --features rapier3d/simd8` for the Rapier tests' package | 2 | a build of Rapier's tests off the pinned features: the feature judge names simd8 |

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed, computed from the live issue. Each test's name starts with its criterion's ID.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 `#2012.4d10a14c` | `ac1-mac-linux-wasm32.test.ts` (2) | The pile-and-flyer world's golden (240 steps) recorded here, verifying on x86_64-unknown-linux-gnu and wasm32-unknown-unknown: this Mac's replay reads `machines: same`, PASS, its own 241 step hashes the golden's. In wasm32 and on Linux x86_64 each replay names its target and arch (wasm32; x86_64 on linux), reads `machines: different`, PASS under the golden's key and runtime digest, and its 241 step hashes equal the golden's at every step; each leg's replay shifted at step 120 first differs at step 120. `golden_cross` with both runs (machines linux-amd64 and web-player configured) is PASS, with either alone PENDING. Then: a replay in the Linux VM (linux/arm64) reads target aarch64-unknown-linux-gnu, linux, aarch64, `machines: same`; with it the golden stays PENDING (asking nothing), also beside this Mac's run, and a golden verifying on aarch64-unknown-linux-gnu with the VM configured for that target stays PENDING after the VM has run it. Fails: a replay that differs at any step, a leg that echoes the golden or doesn't run where it says, a cross verdict that counts a same-architecture run or passes with a machine missing |
| 2 `#2012.13d17890` | `ac2-rapier-own-tests.test.ts` (2) | Rapier 0.36.1's four files are workspace test targets with upstream's text (pinned SHA-256s), snapshot_portability holding its golden `(488_334, 0x3f5e_ac53_ad07_5243)`; their build resolves rapier3d and the pinned crates as the physics build does (and the simd8 plant is caught naming simd8); rustc is rust-toolchain.toml's channel. On this Mac, then in the lane's linux/amd64 image (rustc host x86_64-unknown-linux-gnu, the Mac's commit hash, features compared for that target), each of the 11 named tests reports ok. Fails: a file edited, compiled out by its cfg or not run, a test that fails on either machine, a build off the pinned features or toolchain |
| 3 `#2012.53ff430e` | `ac3-goldens-on-linux.test.ts` (1) | Three goldens recorded on macOS (pile and flyer 240 steps; ball and goal 360; a 192-box pile with a ball-jointed chain through a sensor and eight CCD balls, 200): each replays here step for step reading `machines: same`, and on Linux x86_64 names its target, reads `machines: different`, PASS, under the golden's key, with every step hash the golden's; the first world's replay shifted at step 120 first differs at 120. Fails: any step that differs, a leg that doesn't step the world |
| 4 `#2012.562a3985` | `ac4-key-without-triple.test.ts` (1) | The golden's `machine.target` is this host's triple (as `record_on`); on Linux x86_64 its replay computes the golden's `bake_key` and passes, while a plain bake's key differs between the two machines; the same golden replayed there with the flyer's x velocity one ulp higher is FAIL under another key, `refused` naming the golden's key. Fails: a golden without its triple in its machine, a key that binds the triple (Linux computes another and fails) or omits the document (the changed one passes), a failure that doesn't name the key |

Test count: 2 + 2 + 1 + 1 = 6.

## Readings where the issue leaves a choice

- **"Step for step"**: the second machine's replay of the golden answers its own step hashes, and the test compares
  them with the golden's at every step, naming the first that differs; its verdict alone isn't taken as the match.
- **"The wasm32 build"**: the physics module built for wasm32-unknown-unknown, the web player's target, run in Node's
  V8 (The wasm32 leg, above). **"Linux x86_64" / "the Linux machine"**: the #1983 lane's pinned image as linux/amd64.
  **"A Linux VM on the reference Mac"**: that image as linux/arm64, run by colima's arm64 Linux VM.
- **"Reads machines: same"**: the VM's Run says `machines: "same"` (its arch is the recording machine's). **"Leaves the
  cross-machine criterion pending, never PASS"**: `golden_cross` with the configured machines and the VM's run is
  PENDING, and so is a golden whose own target is the VM's, with the VM configured and having run it.
- **"Matches on Linux x86_64 and in the wasm32 build"**: each replay PASS with every step hash equal, and `golden_cross`
  PASS with both runs; the shifted replays show each leg steps the world itself.
- **"Goldens recorded on macOS"**: three worlds of different kinds (contacts piling up, a kick with an output, joints,
  a sensor and CCD), each golden's `machine.os` `macos`.
- **"Binds the bake key without the target triple"**: the golden's `bake_key` is what the Linux replay computes there,
  while a plain bake's key, which binds the triple (Bake), differs by machine. **"Records the triple in its machine"**:
  `machine.target`. **"A planted change to the document"**: the test's own change, the smallest one, one f32 ulp of one
  body's initial velocity. **"Naming the key"**: `refused` holds the golden's `bake_key`.
- **"Rapier's own determinism tests at v0.36.1"**: the three files the criterion names plus simd_backend_parity, which
  the Oracle page maps to this criterion; each file's every test, its one `#[ignore]`d 43k-body stress scene aside, as
  upstream runs them. Run unchanged in the workspace (Rapier's tests in the workspace, above), so the run is against our
  pinned build, which is what the criterion makes of #136's "run against our output". **"The pinned features"**: the
  physics build's resolution, not merely its manifest. **"Toolchain"**: rust-toolchain.toml's channel. **"Build
  flags"**: the checkout's configuration, the shell's cleared (#2010's reading); the dev profile, whose rapier3d,
  parry3d, glam, glamx, nalgebra and simba build at opt-level 3. **"Reproduces the golden Rapier commits (488,334
  bytes)"**: snapshot_is_target_independent passes with upstream's text, whose constant is that size and digest.
- **The rapier2d portability test** the Oracle page lists for criteria 1 and 3 isn't run: no 2D backend is in the build.

## Not tested, because no criterion reaches it here

The lane script and its record (`scripts/lane-x86.mjs` replays deep-logic; `emulated: true` on a record); the
`physics.determinism` check kind and its `cross_machine` and `web` compares; input tracks and scene channels in the key;
the occurrences hash; the report's checkpoint field on another machine (no store crosses machines); the floating-point
control register on wasm32 or x86_64; a real browser; timing, budgets and the GPU; the rest of Rapier's tests.
