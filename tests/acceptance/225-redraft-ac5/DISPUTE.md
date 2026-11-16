# Dispute: the first draft's test for criterion 5

Criterion 5 (#225.eb041fdb): "The Lorenz system (σ 10, ρ 28, β 8/3) from (1, 1, 1) at step 0.005 for time 40 gives
byte-identical points on two machines, at most 16,384 points".

## The disputed test

`tests/acceptance/225/ac5-lorenz-two-machines.test.ts`. Its second machine is `deep-show` built with `--features full`
for linux/amd64 in `rust:<channel>-slim-bookworm`, and it pulls nothing. On this work its first half passes (this Mac's
stream: 8,001 points, the test's RK4 within 1e-6, both lobes); its second half can't build.

## Why it can't pass on any program

The full deep-show build compiles C++ (the `meshopt` crate's build script needs `c++`) and runs bindgen (`basisu_c_sys`,
`thorvg-sys`, which need libclang). The slim image has neither, so the build fails in that image whatever the program.
Six resumed builds in its own target folder all stopped at the same place:

```
warning: meshopt@0.7.0: Compiler family detection failed due to error: ToolNotFound: failed to find tool "c++": No such file or directory (os error 2)
error: failed to run custom build command for `meshopt v0.7.0`
```

The test's two runs on this work also met the emulated linker crashing (`linking with cc failed: signal: 11 (SIGSEGV)`,
on `quote` and then `thiserror`), which a resumed build gets past; the missing compiler it can't.

## The redraft

A fresh run of the blind job (the issue, the design, the Oracle page and the base; criterion 5 only) wrote this folder.
Its brief gave base facts only, never the work or this dispute: that the full build needs `c++`, that the slim image
lacks it and the full rust image has it, and that the emulated build has crashed intermittently under load. It found the
libclang need itself and builds in a local image from the pinned rust image with `libclang-dev`.

On this work (deep-show full build, this branch): the twin test passes; the main test's macOS half decides `lorenz#s0`
(8,001 points) and its Linux half is BLOCKED, since that image doesn't exist here yet:

```
BLOCKED: macOS arm64 decided lorenz#s0 (8001 points), but Linux x86_64 can't run here: Docker has no linux/amd64 image
deepbuild-acceptance-225-ac5-linux:1.99.1 built from rust:1.99.1-bookworm@sha256:e6f2cff3… with libclang.
 Tests  1 failed | 1 passed (2)
```

## What is asked

1. One ruling: the redraft runs in the first draft's place for criterion 5 (`scripts/lanes.mjs`: the redraft folder in
   `alone`, the first draft's file in `byHand`).
2. One unblock, which downloads Debian packages into a local image (so it's yours to run):

```sh
printf 'FROM rust:1.99.1-bookworm@sha256:e6f2cff35d0f309acf8433b4f05878ed77092602c5065cc81801177da0bb3a9c\nRUN apt-get update && apt-get install -y --no-install-recommends libclang-dev && rm -rf /var/lib/apt/lists/*\n' | docker build --platform linux/amd64 -t deepbuild-acceptance-225-ac5-linux:1.99.1 -
```
