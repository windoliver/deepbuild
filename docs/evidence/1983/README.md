# #1983 evidence: the x86_64 lane on the reference Mac

Taken on the reference Mac (Mac17,10, macOS arm64, Docker 29.5.2 through colima) on Nov 10, 2026, from the tree of
commit fc8ec9c9, with the image pinned in `scripts/lane-x86.json` (`rust:1.99.1-slim-bookworm@sha256:f2c004e3…`).
Each file holds the lane's printed line, its record, logic.determinism `cross_machine`'s reply on it, and whether the
runtime's image list was the same after the run as before. The hostname is redacted as `<host>`.

| File | Criterion | What it shows |
|---|---|---|
| `ac1-pass.json` | 1 | a golden recorded on macos/aarch64 replays on x86_64, `emulated: true`, network `none`, the pinned digest; cross_machine PASS, `machines: different` |
| `ac2-step-37.json` | 2 | the planted replay: record FAIL at step 37, `tally.x`, values one ulp apart; cross_machine FAIL naming step 37, `tally`, `tally.x` |
| `ac3-container-arm64.json`, `ac3-native.json` | 3 | replays on aarch64 (linux/arm64 container, native): cross_machine INVALID, `machines: same`, refused naming `lane_arch` aarch64 |
| `ac4-no-image.json`, `ac4-unreachable.json` | 4 | BLOCKED with one ask: the pull command with the digest, or docker unreachable; image list unchanged |
| `ac5-readings.json` | 5 | logic.budget refuses the lane's step time, frame time and budget reading, naming `x86_64` and `emulated: true`, with the verdict it gives alone; the planted reader counts them and FAILs |
| `ac6-default-network.json` | 6 | the planted replay on the default network: record `network: bridge`, cross_machine refuses naming `network` |
| `ac7-merge.json` | 7 | the lane's FAIL and the Mac's `unit` PASS for one tree merge to FAIL, naming `x86_64` |

The blind suite (`tests/acceptance/1983/`, 11 tests) passed in three runs on the same tree: files 5 and 7 (3 tests,
98 s), file 4 (2 tests, 10 s), and files 1, 2, 3 and 6 (6 tests, 1,109 s, including the emulated rebuild of deep-logic
and the linux/arm64 build). Machine load was 150–250 during the runs.
