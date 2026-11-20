# Twins for the 594 tests

The #594 fix is on main, so the tagged tests pass on the merge base and the before lane needs a planted wrong
program for each criterion (design: Wrong programs). `../twins.json` names them. Each is a copy of the base's
`scripts/benchmark.mjs` or `scripts/perf.mjs` with one rule taken out, from the planted programs `../BASE-FAILURE.txt`
lists. The tests copy `scripts/` into their fixture repository, so the twin is what the fixture's preflight runs.
`../TWINS-RUN.txt` records each tagged test's result on each twin.

The twins are whole-file copies of `scripts/perf.mjs` and `scripts/benchmark.mjs` at b4a2049e8. Whenever those files change
on main, re-cut each twin from main's file, changing only the plant.

| Criterion | Twin | What it leaves out |
|---|---|---|
| `#594.18edc4ce` (AC2, cpuMs within the margin) | `warm-skips-clippy` | The clippy step of `warm()`: the measured lint check-compiles the dependency tree cold |
| `#594.fb185499` (AC3, a real slowdown fails perf) | `margin-widened-on-lock` | The margin: perf widens it to 100x when `Cargo.lock` changed, so a dependency change never fails on cpuMs |

`#594.b71277c1` (AC1) has no tag and no twin. `../reference.live.test.mjs` measures an external checkout
(`DEEP_594_CHECKOUT`) and fails `BLOCKED` everywhere but the reference Mac, so no planted program could make it fail
for the criterion's reason, and tagged it would run in the before lane on every machine (see `../README.md`).
