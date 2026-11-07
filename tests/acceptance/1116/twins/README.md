# Twins for the 1116 tests

The base has no window, so every test but one simply has nothing to run, and that proves little about what the tests
can catch. These are planted wrong programs, each of a plausible way to fake a criterion. `../twins.json` names them.

The blind job built them on its own throwaway window: `scripts/throttle.mjs` at the base plus a `window` command of about
a dozen lines, and a `scripts/budget-window.mjs` of about 110 lines. That window passes the 12 tests and isn't kept. Each
twin replaces one file, and no test or helper. A throttle twin leaves the real `budget-window.mjs` in place, and a
window twin the real `throttle.mjs`, and reads only what section 6 exports (`holds`) and `benchmark.mjs`. A copy goes
stale as the real file changes, and still holds its fault.

| Criterion | Twin | Replaces | The planted fault |
|---|---|---|---|
| `#1116.8a08ae16` (AC1) | `no-drain` | `scripts/throttle.mjs` | A top-level timed request is granted at once, over every holder |
| `#1116.8a08ae16` (AC1) | `releases-early` | `scripts/throttle.mjs` | The grant goes back 1.5 s into the window, so the machine reopens while samples run |
| `#1116.8e06730a` (AC2) | `first-parent-base` | `scripts/budget-window.mjs` | Each commit is measured against the commit before it on main, not its merge base |
| `#1116.dead61b9` (AC3) | `ignores-regression` | `scripts/budget-window.mjs` | A regression on p50 or instructions reads PASS, so every issue closes |
| `#1116.dead61b9` (AC3) | `merge-side` | `scripts/budget-window.mjs` | The merge commit is measured, not the branch, so the commit merged after the regression is blamed for it |
| `#1116.5aa02a5a` (AC4) | `marks-the-end` | `scripts/budget-window.mjs` | The window fetches again and marks main's new tip, so a commit merged during it is never measured |
| `#1116.96a59f57` (AC5) | `stays-shut` | `scripts/throttle.mjs` | The log says the window closed, and the grant is held 70 s more |
