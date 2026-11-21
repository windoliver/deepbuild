# Twins for the 2484 tests

The fix (`-w` on both of the environment kit's lsof calls) is on main since `86a6431f6`, so every test here passes on
the merge base and each needs a wrong program. Each twin is a copy of main's
`packages/conformance/src/slots/environment.ts` with one planted fault, laid over the change.

| Criterion | Twin | The planted fault | Tests it fails |
|---|---|---|---|
| `#2484.43cad8f7` (AC1) | `warning-reads-unreadable` | No `-w` on either lsof call, so a mount warning beside exit 1 reads as a failed lsof (main's program without `-w`: the base's reading) | all three AC1 tests |
| `#2484.c9d8cf75` (AC2) | `failed-reads-empty` | Only an lsof that can't be started reads as unreadable; any status, a real error or a signal reads as an answer | real error beside the warning; working-folder error; killed by a signal |
| `#2484.c9d8cf75` (AC2) | `missing-reads-empty` | An lsof that can't be started (missing from PATH) reads as "found nothing" | lsof missing from PATH |
