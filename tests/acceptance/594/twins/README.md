# Twins for the 594 tests

The #594 fix is on main, so the tagged tests pass on the merge base and the before lane needs a planted wrong
program for each criterion (design: Wrong programs). `../twins.json` names them. Each is a copy of the base's
`scripts/benchmark.mjs` or `scripts/perf.mjs` with one rule taken out, from the planted programs `../BASE-FAILURE.txt`
lists. The tests copy `scripts/` into their fixture repository, so the twin is what the fixture's preflight runs.
`../TWINS-RUN.txt` records each tagged test's result on each twin. The before lane tries a test's twins in its tags'
order. `margin.test.mjs` names `#594.fb185499` first, so `margin-widened-on-lock` decides it. `build-dirs.test.mjs`
names `#594.5f88bcfc` first, so `build-dirs-not-kept` decides it.

The twins are whole-file copies of `scripts/perf.mjs` and `scripts/benchmark.mjs` at b4a2049e8. Whenever those files change
on main, re-cut each twin from main's file, changing only the plant.

| Criterion | Twin | What it leaves out |
|---|---|---|
| `#594.5f88bcfc` (AC1 as amended on 2026-11-19, no dependency rebuilt on a second preflight) | `build-dirs-not-kept` | Keeping the build directories: perf deletes each side's kept directory at the end of every run |
| `#594.18edc4ce` (AC2, cpuMs within the margin) | `warm-skips-clippy` | The clippy step of `warm()`: the measured lint check-compiles the dependency tree cold |
| `#594.fb185499` (AC3, a real slowdown fails perf) | `margin-widened-on-lock` | The margin: perf widens it to 100x when `Cargo.lock` changed, so a dependency change never fails on cpuMs |

Criterion 1's old text (`#594.b71277c1`, under 5 minutes on the reference Mac) was amended on 2026-11-19 with the
maintainer's approval, since the preflight budget is now 900 s. `../reference.live.test.mjs` tested that wording. It
stays untagged, with no twin, kept for history only and run by hand.
