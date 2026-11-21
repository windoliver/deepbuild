# Acceptance tests for #2738: deep-physics builds without a C++ compiler, and a drawn proxy band is unchanged

Written first, from issue #2738 (its report, Scope, three acceptance criteria and Proof line), the design sections it
links and those they lean on, and the base commit `86b99ac36` ("Merge pull request #2932 …", main), by a job that never
saw an implementation; none existed, and no other worktree, branch or PR was read. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- Issue #2738, live with `gh issue view 2738 --repo windoliver/deepbuild`.
- `docs/technical-design.md`: The physics module; Scenes, physics and the canvas core; Dogfooding. `AGENTS.md`.
- `docs/canvas-primitives.md`: Level of detail; Level of detail: levels by error; Level of detail: proxies ("made
  offline by the simplify job from the item's evaluated mesh at its content key … It can never: Be computed per frame").
- At the base: `rust-toolchain.toml` (channel 1.99.1); `Cargo.toml` (members, resolver 2); `.cargo/config.toml`;
  `crates/deep-physics-rapier/Cargo.toml` (scene3d on native targets since #524); `crates/deep-canvas-scene3d`
  (`Cargo.toml`: `meshopt = "0.7"`; `src/lod.rs`: `proxy_of`, `proxy_level`, `triangles`, `choose`, `resolve` and the
  unit test `a_proxy_band_draws_the_simplified_mesh_at_its_ratio`; `src/scene/scattered.rs`: `lod_of`;
  `src/builders.rs`: `ball`); `crates/deep-scene3d-render` (`lib.rs`: `prepare_placed`'s level-of-detail resolve;
  `diag.rs`); `crates/deep-gpu-layer` (`Cargo.toml`; `src/lod.rs`: `Selection::apply`, `rows`; `src/view3d.rs` and
  `src/view3d/parse.rs`: `lod`, `pixel_hash`); the suites `tests/acceptance/2010` (README, `helpers.ts`: the linux/amd64
  build of `deep-physics`), `2009/helpers.ts`, `425` (README, `helpers.ts`: `deep-gpu run`, `view3d`, its `lod` rows, the
  look), `524` and `1468` (READMEs); `scripts/proof-change.mjs` (criterion IDs), `scripts/lanes.mjs` (`alone`),
  `scripts/throttle.mjs`.

What the base already does, which these tests don't credit: on this Mac, which has a C++ compiler, `deep-physics`
builds; `view3d` with `lod: true` draws a `ball@1` in its `proxy` band, the proxy made by meshoptimizer while scene3d
evaluates the scene (`lod_of` → `proxy_of`), and reports the band, but its row's `triangles` is null for an item with no
mesh levels. It is the wrong program for criteria 1 and 2: scene3d links `meshopt`, so `deep-physics-rapier` →
`deep-canvas-scene3d` → `meshopt`, and in the slim image, which has `gcc` but no `c++`, meshopt's build script fails.

## Run them

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/2738 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/2738/tsconfig.json
```

Each test passes its own timeout, which overrides `--testTimeout`: criterion 1 six hours, criterion 3 three, criterion
2 thirty minutes. What a run needs and builds (honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and
`CARGO_PROFILE_DEV_DEBUG=0` unless set; Homebrew's rustup put on PATH when present):

- **Criterion 1**: Docker, and the linux/amd64 variant of `rust:<channel>-slim-bookworm` (the channel
  `rust-toolchain.toml` names) in the local image store. Nothing is pulled (`docker run --pull never`): no Docker or no
  such image is `BLOCKED:` naming the `docker pull` command. Both builds run in `/src`, the checkout mounted read-only,
  with `RUSTUP_TOOLCHAIN` set to the channel (so rustup in the image doesn't fetch the file's components and targets),
  one job at a time (`CARGO_BUILD_JOBS=1`: the VM has 4 CPUs and about 6 GB, which other sessions' containers share),
  and their caches under `target/acceptance-2738-linux/` (target, registry, git), kept between runs as #2010's are.
  Cargo fetches crates and git sources into that cache; a network failure is `BLOCKED:`. Docker Desktop on this Mac
  runs the image under QEMU, so a cold run takes hours (#2010's single-job build of `deep-physics` took about 57
  minutes in the full image). A build past 2¾ hours is stopped and its container removed by name. A build whose
  emulated toolchain is killed (exit 137, the VM's out-of-memory killer) or crashes (a segmentation fault in `cc`) fails
  with its message starting `INCONCLUSIVE:`, since that says nothing of the program; it is never a pass. Two of the
  three base runs ended so (BASE-FAILURE.txt): start a run when the VM's other containers leave it memory.
- **Criterion 2**: `cargo tree` twice, in the checkout.
- **Criterion 3**: `cargo build --locked --bin deep-gpu` on this Mac, once per file, the binary copied out; then one
  `deep-gpu run` drawing two one-frame scenes on macOS's Metal device. Off macOS, or where the GPU layer answers
  `unsupported_platform`, it fails with `INCONCLUSIVE:`, never a pass.

Temporary folders (the binary's copy, documents, outputs) are deleted. Node built-ins and vitest only.
**`scripts/lanes.mjs` needs `'tests/acceptance/2738/'` in its `alone` list** (the files build `deep-gpu` and run
emulated Docker builds); this README is the instruction, the implementer makes that edit. On this shared Mac, run the
suite through the throttle: `node scripts/throttle.mjs test -- npx vitest run --root tests/acceptance/2738 …`, after
`node scripts/throttle.mjs build -- cargo build --locked --bin deep-gpu`, so the test's own build finds it fresh.
(`--root` keeps vitest off the checkout's `vitest.config.ts`, which needs the workspace's packages built.)

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed, computed from the live issue. Each test's name starts with `AC<n> #2738.<id>`.

| ID | File (tests) | What it asserts, and the wrong program it fails on |
|---|---|---|
| AC1 `#2738.a13e05b2` | `ac1-linux-build.test.ts` (1) | `rust:<channel>-slim-bookworm` (linux/amd64) holds no `c++`, `g++` or `clang++`; in it, `cargo build --locked --bin deep-physics` at the workspace root and `cargo build --locked -p deep-physics-rapier --bin deep-physics` each exit 0. Both always run, so a failure names each command that failed. Fails: the base (meshopt's build script: `failed to find tool "c++"`), any build that still compiles C++ for physics, a premise broken by an image that has a C++ compiler |
| AC2 `#2738.4e863912` | `ac2-no-meshopt.test.ts` (1) | `cargo tree --locked -e normal,build -i meshopt`, at the workspace root and with `-p deep-physics-rapier`: the inverted tree names no `deep-physics-rapier`; cargo's `package ID specification \`meshopt\` did not match any packages` (meshopt in no selected graph) is no path; any other failure fails. Fails: the base (`meshopt` ← `deep-canvas-scene3d` ← `deep-physics-rapier` in both), a normal or build edge from physics to meshopt by any route |
| AC3 `#2738.99312f73` | `ac3-proxy-band.test.ts` (1) | one `deep-gpu run`, two `view3d` calls with `lod: true`, one frame each at 320 × 240: a 64-segment `ball@1` (radius 1 m, 4 m from a 40° camera, about 165 px across) whose `lod` has one band, `show: proxy`, `params.ratio` 0.25, below 100,000 px (it draws `proxy`) and the same ball below 1 px (it draws `full`). The proxy row's bands are `["proxy"]`, the full row's `["full"]`; the proxy's triangles are more than 0 and at most 30% of the full band's; the two frames' pixel hashes differ. Fails: the base (no triangle count for an item without mesh levels, see Assumed surfaces), the planted renderer below (same pixels), a proxy of more than 30% or of nothing, a proxy band drawn as another band |

Test count: 1 + 1 + 1 = 3.

## Assumed surfaces

Everything else the suite calls exists at the base: cargo, the Docker image, `deep-gpu run`, `view3d`, its `lod: true`
rows (#425) and its frames' `pixel_hash` (#378). One field does not:

1. **`view3d`'s `lod` row reports `triangles` for an item drawn from a mesh with no mesh levels.** #425 defines a row's
   `triangles` as "the item's triangles drawn in the color pass", but at the base it is null unless the item's mesh has
   levels, so a `ball@1` row reads `"triangles": null` in every band. This suite needs it to be the number of
   triangles the item's drawn band holds as the renderer draws it, for every item drawn from a mesh: in the `proxy` band
   the proxy mesh the renderer made, in the `full` band the full mesh. The rest of the row stays as #425 defines it.

## Planted wrong programs

- **Criteria 1 and 2**: the base itself (BASE-FAILURE.txt).
- **Criterion 3**: a renderer that draws a proxy band's item at its full mesh, which is what a renderer that gets no
  proxy from scene3d and makes none of its own draws. Planted at the base for this suite's run by a one-line edit, never
  committed: in `crates/deep-canvas-scene3d/src/scene/scattered.rs`, `lod_of`'s `proxy_mesh` set to `None`, so
  `lod::resolve` leaves the ball's full mesh in place in its proxy band. The test fails on it: the two frames draw the
  same pixels. A program that reports the proxy's count but draws the full mesh is caught by the same line; one that
  draws the full mesh and reports it is caught by the 30% bound too.

## Readings where the issue leaves a choice

- **"`rust:<rust-toolchain.toml's channel>-slim-bookworm` for linux/amd64"**: the channel read from
  `rust-toolchain.toml` when the test runs (1.99.1 at the base), the image run with `--platform linux/amd64`, emulated
  on this arm64 Mac, as #2010's suite runs its second machine.
- **"Which has no C++ compiler"** is the premise, checked: no `c++`, `g++` or `clang++` on the image's PATH (the slim
  image has `gcc`, which is C). An image that has one fails the test, since a build there shows nothing.
- **"Each succeed"**: cargo exits 0, run in the checkout's root as the issue writes the commands, `--locked`, from a
  read-only mount so neither can write the lockfile. One job at a time is a resource limit, not part of what builds.
- **"Neither build's dependency graph holds `meshopt`" … "shows no path from `deep-physics-rapier`"**: at the workspace
  root the inverted tree still holds meshopt through the renderers (the Scope keeps it there), so the test reads only
  whether any path starts at `deep-physics-rapier`. With `-p deep-physics-rapier` and no meshopt in that graph, cargo
  prints no tree and exits 101 saying the spec matched no package; that is the criterion met, not a failure. The
  commands run as written, on this machine's host target; the edge kinds are the criterion's `normal,build`.
- **"When the renderer draws a scene"**: the GPU layer's `view3d` drawing a scene document, which goes through
  `deep-gpu-layer` and `deep-scene3d-render`, the two crates the Scope says simplify a proxy band's mesh. A test of
  `deep-scene3d-render` alone would miss the GPU layer's own level-of-detail resolve (`Selection::apply`).
- **"Its full mesh's triangles"**: the triangles the same ball draws in its full band, read from the same report in the
  same process. (The base's builder gives a 64-segment uv ball 2 · 64 · 31 = 3,968 triangles; not asserted.)
- **"Draws"**: held to the pixels: a proxy band drawn with the full mesh draws the full band's pixels, so the two frames'
  pixel hashes must differ. At the base they do: its proxy, simplified toward a quarter of the triangles, changes the
  ball's silhouette and shading (BASE-FAILURE.txt).
- **"Unchanged"**: the bound is the base's own unit test's (`a_proxy_band_draws_the_simplified_mesh_at_its_ratio`: more
  than 0 and at most 0.3 × full), now read where the renderer draws.

## Not tested, because no criterion reaches it here

The Scope's "still once per content key" (no criterion names a count of simplifications); `deep-physics-rapier`
keeping its dependency on scene3d (a program that drops it passes criteria 1 and 2; the Scope, not a criterion, rules
it out); the wasm32 build refusing balloons and volumes (#2466); the Proof line's other suites (#2010's criterion 3
Linux leg, #182's criterion 5 Linux leg, #524's soft-body suites) and unit tests (`cargo test -p deep-canvas-scene3d`,
`-p deep-scene3d-render`), which the implementer runs as they stand.
