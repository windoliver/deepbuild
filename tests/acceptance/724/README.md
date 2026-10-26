# Acceptance tests for #724: instructions retired judged against the merge base

These tests were drafted blind from issue #724 (its text as of October 25), `docs/technical-design.md` ("Numbers version 0 has to hold": "Every task carries its own budgets" and "The reference Macs") and the base commit `0954514`, which has no implementation. Per AGENTS.md, the implementing agent doesn't edit them. A dispute goes to a blind redraft by this job.

Run them with:

```
node --test 'tests/acceptance/724/*.test.mjs'
```

Don't pass the folder: Node 23 treats it as one test file. The four files that run perf run in parallel. The suite took 19 to 51 s on the base and 26 to 78 s with the sample implementation below, at load averages of 85 to 130 on battery; most of that is perf's 42 to 96 runs of the measured command per file, which a loaded Mac slows. On the base all 16 tests fail, each for the expected reason, as `BASE-FAILURE.txt` shows. They run by hand, like the other Node acceptance suites (`scripts/lanes.mjs`).

## Surfaces

Neither the issue nor the design names a function, a field or an output line, so I picked the smallest surface next to the existing perf lane: three exports of `scripts/benchmark.mjs` and the lines `node scripts/perf.mjs '<observation>'` already prints.

### `parseInstructions(report, platform)`

Beside `parseCpuMs` and `parsePeakRss`. Reads the count from a `/usr/bin/time` report and returns a positive safe integer, or `null` when the report has none.

- On `darwin` it is the number on the `instructions retired` line of `/usr/bin/time -l`, not `cycles elapsed` or `peak memory footprint`.
- A report without that line, on any platform, and GNU time's report on `linux` (the lane's `-f 'peak_rss_kb=%M\ncpu_s=%U %S'`, which has no counter) give `null`. It never returns 0 for a missing count, and never throws for one.

### `measureOnce(command, cwd, …)`

Its result gains `instructions`: `parseInstructions` of that run's report, the count of the command and every child it waited for. The other fields stay.

### `judgeInstructions(pairs)`

Judges a task against its merge base on the rounds `measure` alternates. `pairs` is one `{ current, base }` per measured round, in round order, each a count or `null`. It returns:

```js
{ status: 'PASS' | 'FAIL' | 'INCONCLUSIVE',
  pairs,   // as given, every pair, in round order; a missing count stays null
  change,  // the median of the pairs' differences; null when a count is missing
  spread,  // max - min of the pairs' differences; null when a count is missing
  margin,  // max(0.02, spread); null when a count is missing
  reason } // why, for anything but PASS
```

- A pair's **difference** is `current / base - 1`. **change** is their median (for an even number of pairs, the mean of the middle two). **spread** is the largest difference minus the smallest. All three are fractions: 0.02 is 2%.
- **FAIL** when `change > margin`. **PASS** when `change <= margin`; a fall in instructions passes.
- **INCONCLUSIVE** when there are no pairs or any count in them is not a positive safe integer (`null`, 0, missing). `reason` names the missing count (it matches `/instructions|counter|missing/i`).
- It ignores the machine: the same pairs get the same verdict on any Mac, under any load.

### `node scripts/perf.mjs '<observation>'`

perf keeps its JSON result lines, #568's `fingerprint` and `limits` included, and adds:

- **Every result line** (`"task": "preflight"` and each task) carries `"counter"`: a string naming where its counts came from. On macOS it contains `/usr/bin/time -l`. The macOS build is the line's `fingerprint.macosBuild` (#568), which must be the build the counter ran under.
- **The preflight line's readings** carry their count beside CPU time and peak memory: `current.instructions` is the observation's `instructions` (a count, or `null` when the observation's is `null`), and `base.instructions` is the merge base's workload count, or `null` when that host's report had none.
- **Each task line with a merge-base task** carries `"instructions"`: what `judgeInstructions` returns for that task's pairs, one pair per round `measure` alternates after its warm-up round, so 20 pairs.
- For an instruction comparison judged FAIL, perf prints `FAIL perf: <text naming the task and the word "instructions">`; for one judged INCONCLUSIVE, `INCONCLUSIVE perf: <same>`; each is followed by a `  Fix: ` line, and perf exits non-zero. `PASS perf (… s)` appears only when nothing failed, as before.
- #568's limits are unchanged: a `p50Ms` limit is judged by `judgeLimit` on five runs and the fingerprint, and the instruction comparison never changes its status.

### How the tests plant

The lane tests build a scratch git repository with a copy of this checkout's `scripts/`, a trivial `scripts/checks.mjs`, and `benchmarks/budgets.json` whose preflight budget and tasks are the same at the merge base (`origin/main`) and in the working tree, as frozen budgets are. Each task runs `/usr/bin/awk -f benchmarks/<id>.awk`, a program that counts to a number of iterations: 500,000 at the merge base, and in the working tree 500,000 (unchanged), 507,750 (1.5% more instructions retired) or 603,250 (20% more). The changes are real: before judging, each test reads the real counter itself under `/usr/bin/time -l`, in 15 rounds that run each program once in turn, takes each program's median, and requires the plants to retire 18–22% and 0.9–1.95% more instructions than the base program, and the lane's pairs to be within 2% of its own reading on each side. The 1.5% plant's window keeps it a rise and under the 2% floor. A loaded Mac adds about a million instructions to a run at random, about 0.3% of one here: a first draft that read three runs a side saw the 1.5% plant at 1.15% at load 65–75 (a blind-redraft dispute), and nine interleaved rounds read it at 1.21–1.67% in 15 repeats at load 110–122. Fifteen rounds read it at 1.475–1.541% in 10 repeats at load 87–105, and the 20% plant at 19.95–20.03%. `XDG_CACHE_HOME` points at the scratch directory, so perf's kept merge-base copy lands there.

Only boundaries the lane doesn't own are planted:

- `limits.test.mjs` replaces the copy's `scripts/benchmark.mjs` with a module that re-exports this checkout's real one and answers `fingerprint()` with #568's recorded other Mac (`fixtures/other-mac.json`), as #568's tests do.
- `missing.test.mjs` stands in for a host whose `/usr/bin/time` can't report the counter: in the copy's `scripts/benchmark.mjs`, every quoted `'/usr/bin/time'` literal is pointed at a shell script that runs the real `/usr/bin/time` and drops the `instructions retired` and `cycles elapsed` lines from its report. **So `measureOnce` must keep running `/usr/bin/time` by that quoted literal**, as at the base; if it no longer appears, the test fails saying it can't plant.
- `counter.test.mjs` parses recorded reports from this Mac: `time-l-darwin.txt`, the same report without its two counter lines (`time-l-no-counter.txt`), and a GNU time report (`time-f-linux.txt`).

No option, flag or environment variable is added for tests.

## Readings where the issue leaves a choice

1. **The paired difference** is the median of each round's `current / base - 1`, and **the pairs' spread** is the largest of those minus the smallest. A median keeps one disturbed round from moving the verdict; the spread still widens the margin for it.
2. **The verdict** has two outcomes on complete pairs: within the margin passes, over it fails. The issue's margin already absorbs the pairs' own noise, and its only INCONCLUSIVE is a missing counter. A count of 0 is treated as missing: a process that ran retired instructions.
3. **"Every perf result"** is every line perf prints for a result, the preflight's included. The preflight workload runs once a side, so it has no pairs and no instruction verdict; its readings carry their counts, and its missing count is `null` like any other. `scripts/preflight.mjs` should pass `measureOnce`'s `instructions` in the observation it hands perf; that isn't tested here, since it runs every check lane.
4. **The counter's source and the macOS build.** The source is the line's `counter`. The build is #568's `fingerprint.macosBuild` on the same line, rather than a second copy of it.
5. **The measured command is awk, not Node.** On this Mac at load averages of 100 to 200, a Node loop's instructions retired moved by up to 37% between identical runs (1.38 or 1.89 billion for the same program), because V8's background compiler reaches the loop later on a loaded machine and the loop runs longer in a slower tier; Twenty alternated pairs of Node with `--single-threaded` spread 2.9%, and of `md5` over a file 5.7%: wider than the 2% floor, so the margin would be the spread and a 1.5% plant couldn't tell a margin under 2% from one at it. awk has no JIT: 20 alternated pairs spread 0.65–1.04% at 500,000 iterations and 0.46% at a million (load averages 110 to 130), and 0.13% at five million (166). The issue's "instructions don't move with load" holds for it, so a planted 1.5% rise sits clearly inside the 2% floor and a planted 20% rise clearly outside it. The implementer should know that Node tasks may not be as steady (see Not covered).
6. **Load and power.** The two load criteria hold "at a load average above 40 on battery". The tests read the 1-minute load average (`os.loadavg()[0]`) and the power source (`pmset -g ps`) before and after the lane run. They always assert: an instruction comparison must hold under any load. Then, if either reading wasn't above 40 on battery, the test is skipped as `INCONCLUSIVE` with what it saw (`t.skip`, as #237's budget tests do), never passed. The suite doesn't make load itself; other sessions on this Mac kept it at 90 to 200.
7. **Off the reference Macs** is #568's recorded other Mac: the Mac15,12 (M3, 16 GB) on battery, with Low Power Mode on and the thermal state fair. Its hardware is a reference Mac's and its conditions aren't, which the design counts as off ("counts only on a run whose environment fingerprint is one of those machines', on mains power, with Low Power Mode off and the thermal state nominal"). Both of its tasks carry a 60,000 ms `p50Ms` limit that every run is far within, so only the reference-Mac rule can stop it passing. One task's instruction comparison reads PASS and the other's FAIL.
8. **Pairs attached** means all 20 measured rounds, the warm-up excluded, each pair a real count of each side.

## Criteria, tests and wrong programs

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the leading `- [ ] ` dropped (the command in `tests/acceptance/48/README.md`).

| ID | Criterion | Tests (file: name) | Wrong program it must fail on |
|---|---|---|---|
| `#724.2a0f8e22` | At a load average above 40 on battery, a planted 20% instruction rise fails its comparison with the merge base by instructions retired, with every pair attached; a lane that reads it INCONCLUSIVE from time alone fails | loaded: *at a load average above 40 on battery, a planted 20% rise in instructions fails its comparison with the merge base, with every pair attached*. judge: *a 20% rise in instructions retired fails the comparison, with every pair attached* | A lane that compares time alone (the base: plus-20 reads PASS on time). One that reads the instruction comparison INCONCLUSIVE because the Mac is loaded. One that judges but prints no FAIL line or exits 0. One that attaches a summary instead of the 20 pairs, or counts that aren't the counter's (cycles) |
| `#724.dd2beb6a` | Under the same load, an unchanged task passes its instruction comparison, with the margin and the pairs' spread reported; a margin under 2% fails on a planted 1.5% rise that must pass | loaded: *under the same load, an unchanged task passes its instruction comparison, with the margin and the pairs' spread reported*; *under the same load, a planted 1.5% rise passes: the margin is the larger of 2% and the pairs' spread, never under 2%*. judge: *an unchanged task passes…*; *a 1.5% rise passes: the margin is never under 2%*; *a 3% rise with a 0.4% spread fails…*; *the pairs' spread widens the margin past 2%…* | A margin floor under 2% (1%), or the spread alone. A margin with no spread (fixed 2%), or a wider floor (judgeLimit's 5%). A comparison read INCONCLUSIVE under load. One that doesn't report margin and spread |
| `#724.f2bcce5f` | Every perf result carries instructions retired, where the count came from and the macOS build; a host that can't read the counter carries it missing and reads INCONCLUSIVE; a lane that writes 0 fails | loaded: *every result perf prints carries instructions retired, the counter they came from and the macOS build*. missing: *a result from a host that can't read the counter carries it missing, never 0, and reads INCONCLUSIVE*. counter: all three tests. judge: *a missing count is never zero…*; *a count of 0, or no pairs at all, is not a reading…* | A parser, judge or preflight reading that writes 0 for a missing count, or judges 0 as a count. A line without `counter`, or without the counts. A missing counter read PASS. A `measureOnce` without the count, or reporting cycles |
| `#724.166afc88` | An absolute ms limit off the reference Macs stays INCONCLUSIVE whatever its instruction comparison reads; a lane that passes it on instructions fails | limits: *an absolute ms limit off the reference Macs stays INCONCLUSIVE whatever its instruction comparison reads* | A lane that marks an ms limit PASS when the instruction comparison passes. One whose instruction comparison depends on the fingerprint |

### Checked against a sample implementation and mutants

To check that the tests can pass and catch what they claim, I wrote a throwaway sample implementation in a scratch copy outside this checkout (not committed, not part of this change): about 30 lines in `scripts/benchmark.mjs` and 6 in `scripts/perf.mjs`. It passed all 16 tests twice: with the first draft at load averages of 92 to 128 on battery, and with the redrafted plant check at 85 to 102 (the load tests ran, not skipped; the unchanged task's pairs spread 0.66–1.04% and the 1.5% plant's 0.76–0.98%, all under the 2% floor, and the 1.5% plant's change read 1.49–1.55%). The existing `tests/perf.test.mjs`, `tests/benchmark.test.mjs` and `tests/acceptance/568/` still passed with it (56 of 56). Each of these mutants of it failed the tests named:

| Mutant | Tests that failed |
|---|---|
| Time-only lane: no instruction comparison, counts or `counter` on the lines (the base's behavior) | 6: limits; loaded 20%, unchanged, 1.5% and every-result; missing |
| The instruction comparison read INCONCLUSIVE when the load average is above 40, as time is | 4: limits; loaded 20%, unchanged and 1.5% |
| Margin floor 1% (under 2%) | 7: judge 20%, unchanged, 1.5% and 3%; loaded 20%, unchanged and 1.5% |
| Margin fixed at 2%, spread ignored | 1: judge *the pairs' spread widens the margin past 2%*. The real pairs spread under 2%, so no lane test can tell |
| Margin floor 5%, as judgeLimit's | 7: judge 20%, unchanged, 1.5% and 3%; loaded 20%, unchanged and 1.5% |
| Margin is the spread alone, no floor | 7: judge 20%, unchanged, 1.5% and 3%; loaded 20%, unchanged and 1.5% |
| Parser writes 0 for a missing counter | 2: counter *a host whose time reports no counter…*; missing |
| Judge turns missing counts into 0 and judges them | 3: judge *a missing count is never zero…* and *a count of 0, or no pairs at all…*; missing |
| Preflight reading writes 0 for a missing count | 1: missing |
| An ms limit passes when the instruction comparison passes | 1: limits |
| change is the mean, not the median | 3: loaded 20%, unchanged and 1.5% (the judge sets are symmetric, so mean and median agree there) |
| `measureOnce` reports cycles elapsed as instructions | 5 to 6: counter *read from /usr/bin/time -l's report* and *every measured run records…*; loaded 20%, unchanged and 1.5%; limits in one run of two (cycles move with load, so its verdicts drift) |
| An instruction FAIL or INCONCLUSIVE stays in the JSON: no verdict line, and the lane exits 0 | 2: loaded 20%; missing |
| No `counter` field on the lines | 1: loaded *every result perf prints carries…* |

Every mutant was run twice, before and after the blind redraft of the plant check, against all 16 tests. The lists above are from the second run. In the first, the `counter` mutant also "failed" the loaded 1.5% test, but only at the old three-run plant check, before any lane assertion: the false catch that dispute found. The runner kept only the names of failing tests, not their messages, so these lists don't say which assertion caught each mutant.

## Not covered here

- `scripts/preflight.mjs` passing `measureOnce`'s count in the observation it hands perf: it runs every check lane.
- Linux. `parseInstructions` returning `null` for GNU time's report is tested; a Linux run of the lane isn't.
- Node tasks. The suite measures awk because a Node loop's instructions moved with load on this Mac (Readings, 5). The lane's real tasks are Node programs and a Rust binary; how steady their counts are under load, and so how wide their margins run, isn't measured here.
- R4's ratcheted speed and cost ceilings: the issue names instructions retired as their measure, but the ceilings don't exist yet.
