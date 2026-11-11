# #2012 evidence: physics goldens across machines

Taken on the arm64 reference Mac (Mac17,10, macOS) on Nov 10, 2026, from commit 14cfb9335. The
second machines are the #1983 lane's pinned image
(`rust:1.99.1-slim-bookworm@sha256:f2c004e3…`, `scripts/lane-x86.json`) as linux/amd64 (Linux x86_64, emulated) and as
linux/arm64 (a Linux VM on the Mac), each replay run with `--network none`. The wasm32 build is
`node scripts/physics-wasm32.mjs`: deep-physics-rapier built for wasm32-unknown-unknown and run in Node's WebAssembly
engine. The world is #2010's pile-and-flyer (`docs/evidence/2010/golden-macos.json`), 240 steps.

| File | Criterion | What it shows |
|---|---|---|
| `golden-macos.json` | 1, 3, 4 | the world and its golden: `bake_key` without the target triple, `machine` with `target: aarch64-apple-darwin`, 241 step hashes, `verify_on` x86_64-unknown-linux-gnu and wasm32-unknown-unknown |
| `replays.json` | 1, 3, 4 | `golden_verify` on the Mac, wasm32, Linux x86_64 and the Linux VM: PASS under the golden's key and runtime digest, each run's own 241 step hashes equal to the golden's (`first_differing_step: -1`); `machines: different` on wasm32 and x86_64, `same` on the Mac and the VM. Each leg shifted one ulp at step 120 (ball `linear.x`) first differs at step 120 and FAILs. The document with the ball's x velocity one ulp higher FAILs on Linux x86_64 with `refused` naming the golden's key |
| `cross.json` | 1 | `golden_cross` with linux-amd64 and web-player configured: PASS with the Mac's, wasm32's and Linux x86_64's runs; PENDING with either second machine missing, with the VM's run alone, and with the Mac's and the VM's |
| `rapier-tests-macos.txt`, `rapier-tests-linux-x86_64.txt` | 2 | Rapier 0.36.1's own snapshot_portability (its 488,334-byte golden), simd_backend_determinism, simd_backend_parity and snapshot_roundtrip, as `cargo test --locked -p deep-physics-rapier` on the Mac and `--offline` in the linux/amd64 container: 11 passed on each, the 43k-body stress scene ignored as upstream ignores it |
| `rustc-macos.txt`, `rustc-linux-x86_64.txt` | 2 | the same rustc 1.99.1 release build (commit 58cf8f9c) on both machines |

The blind suites passed on the same code: `tests/acceptance/2012/` 6/6 (ac1, ac3 and ac4 in 51 s with warm container
caches; ac2 in 246 s after a lint fix), and `tests/acceptance/2012-oracle/` 2/2 (13 s), where the snapshot_portability
and simd_backend_determinism scenes, written as world documents, match the Mac's step hashes and whole-world checkpoint
bytes on wasm32 and Linux x86_64. The emulated linux/amd64 build of the workspace's deep-physics and Rapier's tests took
9.5 min from caches cloned from #2010's and #1983's worktrees.
