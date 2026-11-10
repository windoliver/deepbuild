# Criterion 5 is proven by its redraft

Criterion `#408.5416e245` ("film.layout's results are equal on macOS and Linux, and 60 cue ends × 40 texts × 200
strokes of 64 segments check in under 50 ms on the reference Mac") is proven by
`tests/acceptance/408-redraft-ac5/machines.test.ts`, not by this folder's `machines.test.ts`.

**The dispute:** this folder's file builds `deep-show` for Linux x86_64 in `rust:<channel>-slim-bookworm`. That image has
no C++ compiler, so `meshopt`'s build script stops there with `ToolNotFound: failed to find tool "c++"`. Its
Linux half could never build. On this Mac, Docker is also a shared 8 GB VM, and the emulated build at cargo's default
job count was killed with exit 137.

**The redraft:** a blind job wrote it from the issue, the design, the base d51be2c3 and that dispute alone. It builds in
a local image with a C++ toolchain and libclang, which `basisu_c_sys`'s bindgen needs, and runs cargo at two jobs. Its
README gives the setup.

**The swap:** the owner approved it on Nov 10, 2026, in the session that built #408 ("Yes, swap it"). In
`scripts/lanes.mjs`, the original file moved to `byHand`, and the redraft runs alone with its file timed. None of
this folder's files was edited.
