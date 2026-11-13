# Blind redraft of #501's AC10 test: audio across architectures

AC10, `#501.187057b7`: "Across architectures, audio is a reading: the peak per-sample difference of the export kinds'
fixture film's PCM between macOS arm64 and Linux x86_64 is reported in dBFS, and above −96 dBFS the cross-machine audio
result is INCONCLUSIVE, never PASS; a planted mixer whose Linux build is one 16-bit step off, about −90 dBFS, reads
INCONCLUSIVE, and a check that gives it PASS or FAIL fails this test"

Written by a fresh blind job after a dispute on the first draft (`tests/acceptance/501/across.test.ts` with
`helpers.ts`'s `onLinux` and `linuxShow`, at `c8542532`), from the same inputs: issue #501, `docs/technical-design.md`
(Platform seams: CPU architecture; the four invariants), `docs/canvas-primitives.md` (Determinism: "Across
architectures, audio is a reading"; Device gate), the base commit `4d219bc2`, which has no #501 implementation, the
first draft's README, helpers and across test, and #532's Linux x86_64 leg (`tests/acceptance/532/helpers.ts`). No
implementation was seen. The implementing agent doesn't edit these files (AGENTS.md, Proof).

## What changed from the first draft

The dispute: the first draft built `deep-show` in `rust:1.99.1-slim-bookworm` and counted any cargo failure there as
FAIL. That image has a C compiler but no C++ compiler and no libclang, and deep-show's locked dependency graph on Linux
needs both (meshopt and basisu_c_sys compile C++; basisu_c_sys's build script runs bindgen), so the build stops in a
dependency's build script before any of this issue's code, and the test read FAIL whatever the mixer does.

The decision: redraft. The criterion is about the mixer's two renders and the check's reading of them; a build host
without a C++ compiler leaves the Linux leg unrun, which says nothing about either. The design's invariants put an unrun
leg with a missing platform need at BLOCKED, never PASS, and a FAIL there would fail a right program as readily as a
wrong one. A cargo failure stays a FAIL only once every need of the build is in place.

What is different, and only in the Linux leg:

- **The image** is a local one, `deep-501-linux:<channel>` (`<channel>` from `rust-toolchain.toml`, today `1.99.1`): the
  pinned toolchain's slim image with `g++` and `libclang-dev` added. The suite never pulls or builds it; without it the
  test is BLOCKED and names the one command that makes it (Run it).
- **A toolchain probe** runs in the image before any build: the machine must be `x86_64`, and cargo of the pinned
  channel, `cc`, `c++` and libclang must be there. Each missing one is named in a BLOCKED failure.
- **Crate sources** are fetched in their own step (`cargo fetch --locked --target x86_64-unknown-linux-gnu`); a failure
  there is BLOCKED (the sources are a platform need). The build then runs offline:
  `cargo build --locked --offline --bin deep-show --no-default-features --features full`, so the Linux build is `full`
  by name, as the Mac's is (the first draft relied on the default features). `RUSTUP_TOOLCHAIN` is set to the channel,
  as #532's leg does, so rustup installs nothing for `rust-toolchain.toml`'s components and targets.
- **Verdicts of the leg:** a cargo failure with every probed need in place is the checkout's, a FAIL with cargo's
  error; a build that times out never ran to an answer, INCONCLUSIVE; everything missing above is BLOCKED.
- **The macOS arm64 side** is checked to be macOS arm64 before it builds; elsewhere the test is BLOCKED (the first draft
  didn't check).
- The test timeout is two hours (was one), as the first Linux build runs under emulation.

Unchanged from the first draft: the fixture film's sound, `media_mix` on both machines into one evidence store, this
suite's own peak per-sample difference, the `cross_machine` check held to it within 0.01 dB, INCONCLUSIVE above −96 dBFS
and PASS at or below it, and the planted mixer's run and bounds.

## The surface under test

The first draft's names, unchanged. `deep-show run` reads one JSON scenario on stdin and answers one line
`{"ok": true, "replies": [...]}` (#393, #499); its startup `--planted <name>` argument is #200's.

| Surface | Request fields | Reply fields read | New or existing |
|---|---|---|---|
| scenario | `evidence`, `calls` | `ok`, `replies` | existing |
| `media_mix` | `doc` (a media document), `segments: [{from, to, write: true}]` | `mix.segments[0].wav` (a float WAV in the evidence store) | existing (#499) |
| `cross_machine` | `audio: [wav sha256, wav sha256]` | `outcome: "read"`, `peak_dbfs` (number, or null when identical), `verdict` | new: the cross-machine audio check |
| `--planted mixer_linux_one_step` | — | — | new: the mixer's Linux build adds one 16-bit step (1/32,768) to every sample; other builds are unchanged |

Builds: `full` on this Mac (`cargo build --locked --bin deep-show --no-default-features --features full`) and `full`
for linux/amd64 in the container. The planted name goes to the Linux run only.

## Fixtures

The first draft's: the fixture film's sound as #499's media document, a 440 Hz mono tone of 4 s panned −0.4 and a 550 Hz
mono tone of 3 s from 0.5 s panned 0.6, at 48 kHz, as 16-bit WAVs written at test time into an evidence store under
`target/acceptance-501-linux/` (so the container can mount it). No personal data; CC0.

## Run it

```sh
# once, by a person: the Linux build image (needs the network; the suite never runs this)
printf 'FROM rust:1.99.1-slim-bookworm\nRUN apt-get update && apt-get install -y --no-install-recommends g++ libclang-dev && rm -rf /var/lib/apt/lists/*\n' \
  | docker build --platform linux/amd64 -t deep-501-linux:1.99.1 -

export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci
node node_modules/vitest/vitest.mjs run --root tests/acceptance/501-redraft-ac10 across.test.ts
```

Caches (Linux target, cargo registry and git) live under `target/acceptance-501-linux/`, shared with the first draft's
folder name. The first `cargo fetch` needs the network.

## Legs that read BLOCKED or INCONCLUSIVE

None is ever a pass.

- BLOCKED: this host isn't macOS arm64; Docker is unreachable; no linux/amd64 `deep-501-linux:<channel>`; the image
  doesn't run as x86_64 or lacks cargo of the channel, `cc`, `c++` or libclang (each named); `cargo fetch` fails.
- INCONCLUSIVE: the Linux build times out.
- FAIL: the Mac build or the Linux build fails with every need in place; either `deep-show run` doesn't answer; the
  check's reading or verdict is wrong; the planted mixer's Linux render isn't about −90 dBFS off.

## Readings where the issue and design leave a choice

- "The export kinds' fixture film's PCM" is the film's sound rendered by `media_mix` (the export's sound), since a
  frame-drawing export in the container would need a GPU (first draft's reading, kept).
- "Linux x86_64" is the linux/amd64 container on this Mac, which the design counts as the other architecture for CPU
  checks, recorded as emulated; the test logs the reading with "(emulated)".
- Which image holds the Linux toolchain is the design's to leave open; this job picked the pinned slim image plus the
  two packages the locked graph needs, so the image differs from the precedent only by what the build requires.
