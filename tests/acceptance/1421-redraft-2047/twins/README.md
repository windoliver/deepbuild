# Twins for #1421 (redraft for the #2047 sweep)

The fix is on main, so every test here passes on the merge base. Each twin is a full copy of
`scripts/benchmark.mjs`, changed in one line to undo what its criterion names. The before lane lays a
twin over the change and runs the tagged tests, which must fail at an assertion.

- `#1421.a9e736a2` (a planted 0.00 0.00 reading of a base run gets the comparison's own verdict, not `missing`):
  - `zero-read-as-missing`: `parseCpuMs` refuses a 0 ms reading (`ms <= 0`). Fails the two report tests at an
    assertion; the other five die on its throw, which isn't at an assertion.
  - `zero-compared-as-missing`: `compare` counts a 0 reading as missing for cpuMs too. Fails the five PASS,
    regression and INITIAL tests at an assertion.
- `#1421.c1887ea9` (a report with no CPU line is still refused as missing):
  - `no-line-read-as-zero`: `parseCpuMs` reads an absent or malformed CPU line as 0 ms. Fails the four report tests.
  - `missing-compared-as-read`: `compare` checks only for a 0 reading, so undefined, null, NaN and negative readings pass. Fails the eight base and checkout tests.
