# Twins for the 2584 tests

The first `#2584.ae5eab8b` test fails on the base at its assertion (`../BASE-FAILURE.txt`). The other four pass there,
so each needs a wrong program. Each twin is a copy of the change's `packages/supervisor/src/procs.ts` with one planted
fault, laid over the change.

| Criterion | Twin | The planted fault | Tests it fails |
|---|---|---|---|
| `#2584.ae5eab8b` (AC1) | `warning-means-empty` | No `-w`; any `WARNING` on lsof's stderr is read as `{ pids: [], empty: true }`, whatever lsof printed on stdout | a port a process listens on, with the warning |
| `#2584.6f1bcc3c` (AC2) | `errors-read-empty` | Every failed lsof (any exit status, a signal, a missing binary) is read as `{ pids: [], empty: true }` | all three AC2 tests |
