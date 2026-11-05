# #995 evidence

Proof for `cargo test --locked -p deep-app --test acceptance_995` (tests/acceptance/995), at head afd6be94 and at its merge base 9120d4e5.

## macOS (Mac15,12, macOS 14.7.7, phys_footprint, which counts GPU textures), relayed from the reference Mac

- This branch: exit 0, "test result: ok. 2 passed; 0 failed". revision 10: 155.1 MB, revision 1000: 150.8 MB (−4.3 MB). Both the memory verdict and the GPU verdict pass.
- Merge base (show.rs from 9120d4e5): exit 1. revision 10: 165.5 MB, 100: 258.4 MB, 500: 1009.6 MB, 1000: 2047.8 MB. Both verdicts FAIL: "the canvas panel held 1883.9 MB more after 1,000 revisions than after the first 10 (165.5 MB at revision 10, 2049.4 MB at revision 1,000), past the 20 MB allowed: it keeps pictures no shown revision uses".

## Linux arm64 (wgpu headless, VmRSS + VmSwap)

- This branch, memory verdict: ok, 217.4 → 219.9 MB. The GPU verdict is INCONCLUSIVE off macOS by design.
- Merge base: tests/acceptance/995/BASE-FAILURE.txt (+1034 MB, FAIL naming the panel).

## By hand

- `panel-after-revision-1.png` and `panel-after-revision-1000.png`: the window as the test read it back after revisions 1 and 1,000 (a frame dump added to a scratch copy of the test). The left rect shows the newest revision's picture (green, then blue); the right rect keeps the other document's one picture throughout. `e2e-fixed.txt` is that run.
- `e2e-mutant.txt`: a planted show.rs that drops every picture, shown or not (`keep = used(..) && false`). It fails both pixel checks, naming the panel, so the "only the shown pictures held" check bites.
