# Evidence for #1918: occurrence lists and outputs, sorted per step and read through the column view

Recorded on the reference Mac on 2026-11-10, at the change's working tree, with the blind suite
`tests/acceptance/1918/` (commit f5e1ed6f6, written from the issue, the design and base f0405959a by a
job that never saw the implementation) unchanged.

| File | Criterion | What it shows |
|---|---|---|
| `blind-suite.txt` | 1–5 | Each blind file run on the change, and again after merging main: 17 of 17 tests pass both times (ac1 3, ac2 6, ac3 4, ac4 2, ac5 2). |
| `lab-occurrences.json` | 2, 3 | The ball-and-goal lab's occurrence list over 360 steps: the kick leaves the floor at step 2, the first landing writes `contact_begin` and `hit` at step 74 (0.6167 s; 2 × 3 ÷ g = 0.6116 s) at 2.97 m/s, and the bounce lands again at step 102. Sorted by (step, kind, a, b), `a` the lower ID. |
| `guards.txt` | — | What this change could move in earlier suites: #2010's oracle round-trips (checkpoint bytes and step hashes) and its frame-rate key test, the runtime digest and pins before and after the motion dependency, the wasm32 build baking the lab, the canvas kit, the unit tests run and the lints. |

The suite's base run is the blind job's `tests/acceptance/1918/BASE-FAILURE.txt`.
