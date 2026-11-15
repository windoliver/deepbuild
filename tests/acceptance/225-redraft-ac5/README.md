# Acceptance test for #225, criterion 5, redrafted blind: the Lorenz stream, byte for byte on two machines

Written first, blind, for criterion 5 of issue #225 only (`#225.eb041fdb`): "The Lorenz system (σ 10, ρ 28, β 8/3)
from (1, 1, 1) at step 0.005 for time 40 gives byte-identical points on two machines, at most 16,384 points". The
job read the issue live (`gh issue view 225 --repo windoliver/deepbuild`), its Oracle page (criterion 5 has no upstream
test: cross-machine bytes are our determinism rule), the design sections below, and base commit `dc9b43154` ("Merge
pull request #2578 …"). No implementation of #225 existed for it, and it read no other worktree, branch, PR or
session, and no folder under `tests/acceptance/225*`. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to another blind redraft (design: Dogfooding). Lean: one file, one test for the criterion and
one that shows its judge failing on twins made in test code.

**Not run against a binary.** The machine is shared and loaded, so no cargo binary was built and the suite was not run
at the base; `BASE-FAILURE.txt` says why it fails there. The type-check passes, and the twin test, which builds
nothing, was run in a scratch copy and passed (see `BASE-FAILURE.txt`).

## What was read

- Issue #225, live: its Scope (streams integrated by RK4 at a fixed step in pinned f64 at check; "up to 16,384 points
  when there are 8 starts or fewer, so a single-start trajectory such as the Lorenz system is one stream"), its Fields
  and criterion 5, quoted at the top of the test file; its Proof line ("goldens across two machines").
- `docs/canvas-primitives.md`: Vector field `vector_field@1` (fields, semantics, the read-only `<id>#s<i>` and
  `<id>#streams`, "It can never"); Golden (a golden that feeds a check verifies on the other CPU architecture, Linux
  x86_64 for one recorded on the arm64 reference Mac; an emulated linux/amd64 container on that Mac counts as the
  other architecture for CPU checks; a run on the same architecture never satisfies `cross_machine`; a golden with no
  machine to run it is BLOCKED with one unblock ask; a report names the first differing field with both values and
  their ulp distance).
- `docs/technical-design.md`, How we know version 0 works: Criteria to tests, Criteria in a checked shape (tests reach
  their observable through a surface the issue or a contract names), Wrong programs (a planted twin lives in test code
  or behind a build feature), Independent first oracles and the parity suite (a golden's first expected value set
  outside the implementation), Dogfooding; Bake and golden.
- At the base, for surfaces only: `crates/deep-show` (`main.rs`'s calls, `path`, `deep show`, `golden_record` and
  `golden_verify`; `Cargo.toml`'s `full`); `crates/deep-canvas/src/streams.rs` (`streams@1`, today x, y pairs only);
  `crates/deep-canvas-test-modules/src/swirl.rs`; `crates/deep-canvas-marks/src/modules.rs` (the module `data`);
  `scripts/proof-change.mjs` (`criterionId`), `scripts/lane-x86.mjs` and `scripts/lane-x86.json` (the pinned
  linux/amd64 toolchain image); the sibling suites `tests/acceptance/408/` (README, `machines.test.ts`,
  `REDRAFT-AC5.md`), `223/` and `226/`. Code was read to learn the surface; every expected value comes from the issue
  and the design.

## Run

```sh
npm ci   # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease npx vitest run --root tests/acceptance/225-redraft-ac5 --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/225-redraft-ac5/tsconfig.json   # type-check
```

The file builds cargo binaries, in the checkout and in a container, so it runs alone. The implementer adds to
`scripts/lanes.mjs` (this job writes only its folder):

```js
// #225's criterion 5, redrafted: builds deep-show `full` here and for Linux x86_64 in a linux/amd64 container.
alone.push('tests/acceptance/225-redraft-ac5/');
```

The main test builds `cargo build --locked --bin deep-show --no-default-features --features full` here
(`CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0` unless set, honoring `CARGO_TARGET_DIR`), copies the binary out of
`target/`, and then the same build for linux/amd64 in Docker. Its own timeout is 10 hours, above the command line's.
Temporary folders are deleted. Node built-ins and vitest only.

### Linux x86_64 (the second machine) *(chosen image)*

`deep-show` `full` links `meshopt`, which needs a C++ compiler, and `basisu_c_sys` and `thorvg-sys`, whose build
scripts run bindgen, which needs libclang. The pinned toolchain image of `scripts/lane-x86.json`
(`rust:1.99.1-bookworm@sha256:e6f2cff3…`) has `c++` but no libclang (checked: no `libclang*` in it), and the
`-slim-bookworm` image has neither. So the test builds in a local image made once from the pin with libclang added:

```sh
docker build --platform linux/amd64 -t deepbuild-acceptance-225-ac5-linux:1.99.1 - <<'EOF'
FROM rust:1.99.1-bookworm@sha256:e6f2cff35d0f309acf8433b4f05878ed77092602c5065cc81801177da0bb3a9c
RUN apt-get update && apt-get install -y --no-install-recommends libclang-dev && rm -rf /var/lib/apt/lists/*
EOF
```

The test never pulls or builds an image. Before building it checks that Docker answers, that the pin names
`rust:<rust-toolchain.toml's channel>-bookworm`, that the pinned image is here for linux/amd64, and that the build image
is linux/amd64 and made from it (the pin's layers are the first layers of the build image). If any is missing, the test
fails `BLOCKED: …` with one unblock ask (the command above, or `docker pull --platform linux/amd64 <pin>`, or "start
Docker").

The build runs `docker run --rm --pull never --platform linux/amd64` with the checkout mounted read-only at `/src`, its
caches under `target/acceptance-225-ac5-linux/` (target, cargo registry and git), `RUSTUP_TOOLCHAIN` set to the
channel, and `CARGO_BUILD_JOBS=2` to keep memory down. Under emulation the compiler or linker sometimes dies on a
signal; on such a crash (exit 139, or `SIGSEGV`, `SIGBUS`, `SIGILL` or `signal: 10/11` in cargo's output) cargo runs
again in the same target folder, which resumes from the crates already built, at most twice. A third crash is
`BLOCKED` ("run again when the machine is less loaded"); any other build failure fails with cargo's error. This
resumes a build, never a test.

The run is one `deep-show run` in the same image with `--network none`, the build mounted read-only, an empty evidence
folder at `/evidence`, and `sh -c 'echo "machine: $(uname -m)" >&2; exec /target/debug/deep-show run'`; the test
requires the container to report `x86_64`.

## The surface under test

`deep-show run` (#393), one scenario line in and one answer line out, with `deep show` from your shell (as #223's
suite sends documents). What the issue names and the base lacks is added as below; **names the issue and design don't
give are this job's choice, marked *(chosen)***. The implementer builds exactly these, or a dispute goes to a blind
redraft.

### The document

A film your shell shows (no `id`, `layers` or item `layer`), 800 × 600 u, `requires: {modules: {data: "^1"}}`
*(reading: `vector_field@1` is the data module's kind, as `follow_stream` and `axes3d@1` are)*, holding one item:

```json
{"id": "lorenz", "kind": "vector_field@1", "name": "Lorenz system", "order": "a0", "params": {
  "fn": {"x": "10 * (y - x)", "y": "x * (28 - z) - y", "z": "x * y - 8 / 3 * z"},
  "arrows": {"grid": {"x": [-30, 30, 10], "y": [-30, 30, 10], "z": [0, 60, 10]}},
  "streams": {"starts": {"points": [[1, 1, 1]]}, "jitter": 0, "seed": 1, "step": 0.005, "time": 40,
              "method": "rk4", "pad": 3, "max_points": 16384}}}
```

Every field is the design's spelling. `starts: {points: [...]}` is the design's `points [vec3]` form as a key
*(chosen spelling, as #223 wrote `linear {matrix}`)*. `deep show` must present it with no error-severity issue.

### The `streams` call *(chosen)*

`{"call": "streams", "doc": <doc>, "item": <vector field id>}` answers with the field's streams as integrated at
check: `{"item", "streams": [{"id": "<item>#s<i>", "points": [[x, y, z], …]}, …]}`. Each stream's `id` is its
read-only address `<item>#s<i>` (the design's), in start order; `points` are the stream's points in field
coordinates, in order from its start, each the integrator's f64 values written as JSON numbers that read back to the
same f64 (serde_json's shortest form does). A 2D field's points are `[x, y]`; this suite reads only 3D. Other reply
fields are allowed and not read. The design leaves the reading surface open (`<id>#s<i>` and `<id>#streams` are
read-only addresses, and `streams@1`'s table carries x, y pairs only at the base), so the test reads plain numbers
and makes the bytes itself, rather than fixing a table layout.

## Criteria to tests

The ID is `#225.` and the first 8 hex digits of SHA-256 of the criterion's text (`- [ ] ` dropped, trimmed,
whitespace collapsed), as `scripts/proof-change.mjs` computes it. Each test's name starts with `AC5 #225.eb041fdb`.

| Criterion | File (tests) | What it asserts | Wrong programs it fails on |
|---|---|---|---|
| AC5 `#225.eb041fdb` | `ac5-lorenz-two-machines.test.ts` (2) | On this arm64 Mac and on Linux x86_64 in a linux/amd64 container, each running `full` deep-show from this checkout: the film is presented with no error; `streams` gives exactly one stream, `lorenz#s0`; it has at most 16,384 points, 8,000 to 8,002 of them, its first (1, 1, 1) exactly, and is within 1e-6 of a classic f64 RK4 of the Lorenz system written in test code up to field time 10 (2,000 steps); and the two machines' points, each x, y, z as little-endian f64, have the same SHA-256, else the first differing point and axis are named with both values and their ulps. Off an arm64 Mac, without Docker, the pinned image or the build image: `BLOCKED` with one ask. The second test runs the judges on twins made in test code: the reference stream passes; the same stream with point 4,000's z one ulp up on the second machine fails, naming `point 4000, z` and `1 ulps apart`; an Euler stream equal on both machines fails, naming point 1 and RK4; a stream cut at time 20 and one of 16,385 points each fail on their counts | the base (no `vector_field@1`, no `streams` call); points one bit apart across architectures (an fma or a platform libm on one); equal but wrong points (another integrator, a coarser step, f32 storage, a stream cut short); more than 16,384 points |

## Readings where the issue and design leave a choice

- **The two machines** are the arm64 reference Mac and Linux x86_64 in an emulated linux/amd64 container on it, as the
  design's Golden section allows for CPU checks. Two runs on the Mac, or Linux arm64 in a VM, don't count (`machines:
  same`). The results are compared in the same test run, never against a digest recorded earlier or by an agent.
- **"Byte-identical points"** is every coordinate of every point equal bit for bit as f64, in order, compared as the
  SHA-256 of their little-endian bytes. The design's "pinned f64" makes f64 the unit; an f32 stream is caught by the
  1e-6 trajectory check (points stored as f32 drift past it by field time 0.24, checked in a scratch run).
- **The points are decided first.** Byte equality between two empty or wrong streams proves nothing, so each machine's
  stream must first be the criterion's Lorenz trajectory: started at (1, 1, 1), run its whole time 40 (time ÷ step =
  8,000 steps, so 8,001 points with the start, one either way for how the last step is counted), and within 1e-6 of
  the reference RK4 up to field time 10. Two f64 RK4s that round differently stay within about 2e-13 there; Euler at
  this step is off by 5 at time 2, and RK4 at step 0.01 by 2e-3 by time 10 (checked in a scratch run). The trajectory
  past time 10 is chaotic, so only the cross-machine bytes judge it.
- **σ, ρ and β** are written into the formula as numbers (`8 / 3 * z`), since `vars` bind a path, a control or a
  channel, and the criterion fixes the values.
- **The box.** A stream stops where it leaves "the grid's box widened by `pad`"; with `starts` as points, the only grid
  is the arrows' grid, so the film gives one, x and y from −30 to 30 and z from 0 to 60 in steps of 10 (343 arrows,
  under 4,096), around the whole attractor (x −18.7 to 19.6, y −25.4 to 27.2, z 0.96 to 47.8 from this start) even
  before `pad`. An implementation that boxes a points-start stream otherwise must keep the attractor inside, or the
  stream is cut short and fails on its count.
- **`max_points`** defaults to 512, so the film raises it to 16,384, the cap with 8 starts or fewer; the stream needs
  8,001, and "at most 16,384" is checked on each machine's count.
- **`seed`** has no default in the design; with `jitter: 0` it moves nothing, so the film gives `seed: 1`.

Not tested, because criterion 5 doesn't ask: arrows, color, flow, `follow_stream`, a var change re-integrating, a
grid of starts, 2D fields, timing.
