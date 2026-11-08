# Evidence for #1421: a 0.00 0.00 CPU reading is a reading, not a missing one

Spark (Linux arm64, 20 cores), node v24.22.0, GNU time, 2026-11-08, on main d4ed7be7 (the measureonce files were taken on ede4b367, whose `compare` main hasn't changed). Load is recorded in each file; other sessions ran beside these runs. Paths are redacted.

## The fix

`compare()` (`scripts/benchmark.mjs`) took any metric `<= 0` as missing. GNU time and macOS `time -l` print user and system CPU seconds each truncated to 10 ms, so a bare `node` start sometimes reads `cpu_s=0.00 0.00`, and perf failed with `missing base cpuMs` / `missing cpuMs`. Now:

- a `cpuMs` of 0 is a reading; undefined, NaN, null and negative are still missing, and 0 is still missing for every other metric;
- a report with no CPU line still throws in `parseCpuMs` ("Missing or invalid CPU time", perf's `BLOCKED`), so nothing missing passes;
- since any CPU reading may be up to 20 ms short, the base's counts as up to 20 ms more before the margin applies.

Two perf fixtures whose compared side is itself measured got measurable CPU work, so a node start's spread can't flip them: the links test spins 200 ms on every side, and the cap test's copy without tests spins 500 ms (was 200 ms) against one node start.

## Files

| File | What it shows |
|---|---|
| `acceptance-base.txt` | The blind acceptance tests at main d4ed7be7: both planted-zero tests fail with `FAIL perf: preflight: missing base cpuMs`; both no-CPU-line tests pass (they guard kept behaviour). |
| `acceptance-fix.txt` | The same four tests on the fix: all pass. |
| `unit-base.txt` | The new `compare` unit test in `tests/benchmark.test.mjs`, run against main's `benchmark.mjs`: fails with `preflight: missing cpuMs`. |
| `unit-fix.txt` | `tests/benchmark.test.mjs` on the fix: 15 pass, 1 skipped (macOS only). |
| `measureonce-flake.json` | 200 pairs of real `measureOnce([node, empty.mjs])`, load ~60, each judged by main's and the fix's `compare`: no 0 readings at that load; main 6 regressed, fix 0. |
| `measureonce-flake-low-load.json` | 500 pairs at load 21–50: 106 of 1000 runs read 0 CPU. Main failed 163 pairs (43 `missing base cpuMs`, 56 `missing cpuMs`, 64 regressed); the fix failed 2 (regressed: two trivial measured runs that spread apart, a comparison no test makes now). |
| `measureonce-flake-spin200.json` | 300 pairs of a 200 ms check, as the links fixture now does: readings 200–240 ms, all PASS under both. |
| `perf-loop.txt` | `tests/perf.test.mjs` plus `tests/acceptance/1421` run 10 times on the final code at f873e191, load 8–19: 240 of 240 pass, no `missing`. (An earlier 10 runs on ede4b367 at load 13–43 also passed 240 of 240.) Each perf run measures its merge base once, so that is well over 50 real `measureOnce` base readings. |
