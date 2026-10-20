# Acceptance tests for #568: perf budgets on the reference Mac, judged on five runs

These tests were drafted blind from issue #568 (its text as of October 19), `docs/technical-design.md` ("Numbers version 0 has to hold": "Every task carries its own budgets" and "The reference Mac") and the base commit `6acd16c`, which has no implementation. Per AGENTS.md, the implementing agent doesn't edit them. A dispute goes to a blind redraft by this job.

Run them with:

```
node --test 'tests/acceptance/568/*.test.mjs'
```

Don't pass the folder: Node 23 treats it as one test file. The suite takes about 10 s. On the base all 27 tests fail, each for the expected reason, as `BASE-FAILURE.txt` shows.

## Surfaces

Neither the issue nor the design names a function, a field or an output line, so I picked the smallest surface next to the existing perf lane: two exports of `scripts/benchmark.mjs` and the lines `node scripts/perf.mjs '<observation>'` already prints.

### `judgeLimit({ limit, runs, fingerprint })`

Judges one limit (a timing limit in ms, or a memory limit in bytes) on five runs and the fingerprint they ran under. It returns a plain object:

```js
{ status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' /* or 'INVALID' | 'BLOCKED' when nothing can be judged */,
  limit, runs /* the five readings, in the order given */, margin /* a fraction: 0.05 is 5% */, reason /* why, for anything but PASS */ }
```

- It counts only when the fingerprint is the reference Mac's: `model` `Mac15,7`, a `chip` naming an M3 Pro, `memoryBytes` 38654705664 (36 GB, as `hw.memsize` reports it), `power` `ac`, `lowPowerMode` false, `thermalState` `nominal`, and a `macosBuild`. Anything else, including a missing field, a missing `macosBuild` or no fingerprint, makes it INCONCLUSIVE (or BLOCKED or INVALID), with the five runs attached. Off the reference Mac, `reason` names what's off: the model, chip, memory, power or battery, Low Power Mode or thermal state.
- On the reference Mac: PASS when every run is within the limit (run ≤ limit). FAIL when every run is over the limit by more than the margin (run > limit × (1 + margin)). Otherwise INCONCLUSIVE, with all five runs in `runs`.
- **Margin** = max(0.05, spread). **Spread** = (max − min of the five runs) / limit. "Over it by more than the margin" measures the excess against the limit, so the margin is a fraction of the limit, and the spread is put in the same unit.
- Fewer than five runs, or a run that is missing, `null`, NaN, infinite or negative, is never PASS or FAIL: it's INCONCLUSIVE, INVALID or BLOCKED.

### `fingerprint()`

Reads this machine. It returns, or resolves to, the object the fixtures hold:

```json
{ "model": "Mac15,7", "chip": "Apple M3 Pro", "memoryBytes": 38654705664, "power": "ac",
  "lowPowerMode": false, "thermalState": "nominal", "macosBuild": "25G104" }
```

`power` is `ac` or `battery`. `thermalState` is `nominal`, `fair`, `serious` or `critical`. `model` is `sysctl -n hw.model`, `chip` is `sysctl -n machdep.cpu.brand_string`, `memoryBytes` is `sysctl -n hw.memsize` as a number, and `macosBuild` is `sw_vers -buildVersion`. `power` and `lowPowerMode` agree with `pmset -g ps` and `pmset -g`.

### `node scripts/perf.mjs '<observation>'`

perf keeps its JSON result lines and adds two fields:

- Every result line (`"task": "preflight"` and each task) carries `"fingerprint"`: the whole fingerprint it ran under, the macOS build included.
- Each task line carries `"limits"`: one entry per key of the task's `limits` in `benchmarks/budgets.json`, each what `judgeLimit` returns for that limit on that task's five runs. A run of a `p50Ms` or `p95Ms` limit is a timing reading. A run of a `peakBytes` limit is that run's peak memory. The five runs come after at least one unmeasured warm-up run of the same command.

Then, for each limit judged FAIL, perf prints `FAIL perf: <text naming the task>` and, for each one judged INCONCLUSIVE (or INVALID or BLOCKED), a line starting with that word, `INCONCLUSIVE perf: <text naming the task>`, each followed by a `  Fix: ` line, and exits non-zero. It prints `PASS perf (… s)` and exits 0 only when nothing failed and every limit passed.

### How a test plants a fingerprint

perf.mjs takes the fingerprint by calling the `fingerprint` it imports from `./benchmark.mjs`, and passes it to `judgeLimit` and onto each line. Nothing else in the lane reads the machine. A lane test copies this checkout's `scripts/` into a scratch repository and replaces the copy's `scripts/benchmark.mjs` with a two-line module: `export *` from this checkout's real `scripts/benchmark.mjs`, plus a local `fingerprint()` that returns the planted fixture. The machine is the one boundary these tests stand in for. So the lane runs its real code, and no option, flag or environment variable is added for tests.

The judge tests pass the fingerprint as an argument. Only `fingerprint.test.mjs` reads this machine, and it doesn't assert a verdict.

## Readings where the issue leaves a choice

1. **Spread** is max − min of the five runs, as a fraction of the limit (above). The planted sets use a limit of 100, so a 13 ms spread is 13%.
2. **Within the limit** means ≤ the limit. **Over it by more than the margin** means > limit × (1 + margin). The planted sets and the property test never put a run exactly on either line.
3. **Memory.** The issue's five-run rule speaks only of timing results. A memory budget also counts only on the reference Mac (AC 1). It's judged under the same rule as timing, on the peak memory of each of the same five runs, so `judgeLimit` doesn't need to know which kind of limit it holds.
4. **What a run is for a p50 limit.** The tests don't pin it. A run may be one timed execution or one p50 of several. They require five readings, at least six invocations of the command, and that a 1 s cold first invocation isn't among the readings judged against a 500 ms limit.
5. **The merge-base comparison** (`margin` in `benchmarks/budgets.json`, 20 interleaved samples a side) isn't named in the issue's criteria, and these tests leave it alone. The existing `tests/perf.test.mjs` expects its PASS and FAIL verdicts on any machine, and the sample check below kept them passing.
6. **The preflight workload's `elapsedMs` cap** is held by `scripts/preflight.mjs` on its one measured run of the check lanes, outside the perf lane. These tests require the preflight result line to carry the fingerprint. They don't ask the preflight to run the check lanes five times. The implementer should note this in the PR.
7. **Lane exit codes.** INCONCLUSIVE never passes (invariant 2), so a perf run with an INCONCLUSIVE limit exits non-zero, as a FAIL does. A FAIL beside an INCONCLUSIVE isn't tested.
8. **Recorded fingerprints** are planted in `fixtures/`: `reference-mac.json` (the reference Mac on mains power) and `other-mac.json` (a Mac15,12 with an M3 and 16 GB, on battery, Low Power Mode on, thermal state fair). The values are invented but realistic, with no serial number or personal data. Each single-attribute variation is the reference fixture with one field changed: model `Mac15,9`, chip `Apple M3 Max`, 18 GB, `battery`, Low Power Mode on, thermal `fair`, `serious` and `critical`.

## Criteria, tests and wrong programs

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the leading `- [ ] ` dropped (the command in `tests/acceptance/48/README.md`).

| ID | Criterion | Tests (file: name) | Wrong program it must fail on |
|---|---|---|---|
| `#568.a43f29c2` | A budget counts only on the reference Mac, on mains power, Low Power Mode off, thermal nominal; anywhere else a reading and INCONCLUSIVE | judge: *model / chip / memory / battery power / Low Power Mode on / thermal state fair / serious / critical alone makes a budget INCONCLUSIVE…* (8 tests); *the recorded fingerprint of another Mac makes a budget INCONCLUSIVE, while the reference Mac's counts*; *a fingerprint missing any field, the macOS build included, never passes or fails*; *a memory budget counts only on the reference Mac, under the same five-run rule*. lane: *off the reference Mac, a task within its limits is a reading…*; *off the reference Mac, a task over its limit is a reading too: INCONCLUSIVE, never FAIL*; *on the reference Mac, a task over its limit… fails the lane* | A lane that counts a budget off the reference Mac, or ignores any one attribute. One that passes on a fingerprint with a missing field. One that is always INCONCLUSIVE (the reference-Mac PASS and FAIL tests) |
| `#568.8ddb15e4` | The macOS build is recorded with every result | lane: *every result perf prints records the whole fingerprint, the macOS build included, on and off the reference Mac*. judge: *a fingerprint missing any field, the macOS build included…*. fingerprint: *the live fingerprint on this Mac has every field, and its macOS build is sw_vers -buildVersion* | A lane that leaves the build, or any fingerprint field, off the preflight line or a task line. A `fingerprint()` that reads the wrong build |
| `#568.de3fe087` | Five runs after warm-up; PASS when all five within, FAIL when all five over by more than the margin, else INCONCLUSIVE with all five; margin = larger of 5% and the spread | judge: *on the reference Mac, five runs all within the limit pass*; *…over the limit by more than the 5% floor fail*; *…by more than their spread fail*; *a mixed set is INCONCLUSIVE with all five runs attached*; *the 5% floor decides…*; *the spread decides…*; *a set where any one run alone would pass or fail is INCONCLUSIVE*; *fewer than five runs never pass and never fail*; *a missing or broken reading among the five never passes*; *property (seed 0x568)…*. lane: *on the reference Mac, a task within its limits passes on five runs taken after an unmeasured warm-up*; *…over its limit in all five runs… fails the lane* | A lane that judges one run, or one summary of the runs. One with a fixed 5% margin. One whose margin is the spread with no 5% floor. One that drops the five runs from an INCONCLUSIVE result. One that passes on fewer than five runs or a broken reading. One that judges the cold first run |

### Checked against a sample implementation and mutants

To check that the tests can pass and catch what they claim, I wrote a throwaway sample implementation in a scratch copy outside this checkout (not committed, not part of this change). It passed all 27 tests, and the existing `tests/perf.test.mjs` and `tests/benchmark.test.mjs` still passed. Each of these mutants of it failed the tests named:

| Mutant | Tests that failed |
|---|---|
| Fixed 5% margin | spread fail, spread decides, property |
| Margin = spread, no 5% floor | 5% floor fail, floor decides, property |
| Judges the median run | mixed set, spread decides, property |
| Accepts fewer than five runs or a broken reading | fewer than five, missing or broken reading |
| Counts budgets off the reference Mac | all 8 single-attribute tests, other Mac, missing field, memory, both off-reference lane tests |
| Drops the runs from INCONCLUSIVE | 17 tests: 15 judge tests and both off-reference lane tests |
| Leaves the macOS build out of the fingerprint | every result records the fingerprint, both reference-Mac lane tests |
| perf judges one run | both reference-Mac and both off-reference lane tests |
| perf takes the five runs with no warm-up | five runs after an unmeasured warm-up |

## Not covered here

- The real numbers on the reference Mac. `fingerprint.test.mjs` reads this machine, but asserts no verdict.
- Linux or another OS: `fingerprint.test.mjs` fails with `BLOCKED` off macOS, and nothing here pins what `fingerprint()` returns there, beyond the rule that a fingerprint missing a field never counts.
- "Under the GPU lease, with DeepBuild's own other GPU work held": the design says this, the issue doesn't, and the perf lane has no GPU task yet.
