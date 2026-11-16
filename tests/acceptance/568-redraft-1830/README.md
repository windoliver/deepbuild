# Blind redraft of #568's judge suite for #1830: judgeLimit is given the loads

`judge.test.mjs` here replaces `../568/judge.test.mjs`. Since #1555, `judgeLimit` reads INCONCLUSIVE when a call gives no
`loads`, and the first draft called it with `limit`, `runs` and `fingerprint` only, so its PASS and FAIL tests failed on
every machine. Every call here passes `loads`, one `{ start, end }` per run in the runs' order, and two tests are added for
the load rule itself. Every first-draft test is here under its own name, with the same planted sets and the same
assertions. `../568/fingerprint.test.mjs` and `../568/lane.test.mjs` are not part of this redraft and stay where they are.

Written blind at base `3557b348` from: AGENTS.md; issues #1830 and #568 (bodies only); `../568/judge.test.mjs`,
`../568/helpers.mjs`, `../568/fixtures/`, `../568/README.md`; `scripts/benchmark.mjs` (`judgeLimit`, `fingerprint`);
`docs/technical-design.md`: How we know version 0 works (the timing rule: a loaded run counts neither way; Load: a timing
check run while other work loads the machine past its core count counts as neither a pass nor a failure), The reference Macs
(three: Mac15,7, Mac15,12, Mac17,10), and Dogfooding (a disputed test goes to a blind redraft).

## Run

```sh
node --test tests/acceptance/568-redraft-1830/judge.test.mjs
```

Pure logic: no process, network, build or sign-in, under a second. It reads nothing of the machine it runs on.

## Self-contained, so it can judge a plant

The suite finds `scripts/benchmark.mjs` at `../../../scripts/benchmark.mjs` from its own file and keeps its two recorded
fingerprints in `fixtures/` (copies of the first draft's: the reference Mac, a Mac15,7 on mains, and a Mac15,12 on battery
with Low Power Mode on and the thermal state fair). It imports nothing from `../568/`. A copy of this folder placed at
`tests/acceptance/568-redraft-1830/` in a scratch tree beside another `scripts/benchmark.mjs` judges that one.

## Loads that no core count can turn

An unloaded run reads `0` at its start and its end; a loaded one reads `1e6` at one end. `judgeLimit` compares each reading
with `availableParallelism()`, which is at least 1 and far below 1e6, so the machine's core count never changes a verdict here.

## Tests

| Test (name unchanged unless new) | Criterion | What it proves |
|---|---|---|
| on the reference Mac, five runs all within the limit pass | `#568.de3fe087` | PASS when all five are within the limit |
| …all over the limit by more than the 5% floor fail | `#568.de3fe087` | FAIL past the 5% floor (margin 0.05 on a 2% spread) |
| …all over the limit by more than their spread fail | `#568.de3fe087` | FAIL past the spread (margin 0.10) |
| a mixed set is INCONCLUSIVE with all five runs attached | `#568.de3fe087` | the rest is INCONCLUSIVE, runs attached |
| the 5% floor decides… | `#568.de3fe087` | no margin below 5% |
| the spread decides… | `#568.de3fe087` | the margin grows with the spread |
| a set where any one run alone would pass or fail is INCONCLUSIVE… | `#568.de3fe087` | all five are judged, in any order |
| fewer than five runs never pass and never fail | `#568.de3fe087` | five runs; each count given its own unloaded loads, so only the count is wrong |
| a missing or broken reading among the five never passes | `#568.de3fe087` | a broken run reading never passes |
| model / chip / memory / battery power / Low Power Mode on / thermal state fair / serious / critical alone makes a budget INCONCLUSIVE… (8) | `#568.a43f29c2` | each attribute off the reference Mac alone makes it a reading, naming what is off |
| the recorded fingerprint of another Mac makes a budget INCONCLUSIVE, while the reference Mac's counts | `#568.a43f29c2` | |
| a fingerprint missing any field, the macOS build included, never passes or fails | `#568.a43f29c2`, `#568.8ddb15e4` | |
| a memory budget counts only on the reference Mac, under the same five-run rule | `#568.a43f29c2` | |
| property (seed 0x568): over 1000 integer five-run sets… | `#568.de3fe087` | status and margin follow the rule, reversed too |
| **new** AC3 #1830.7a035631 a run loaded past the core count at its start or its end makes a budget INCONCLUSIVE, naming the load… | `#1830.7a035631` (and the design's timing rule) | a passing set and a failing set, each with one of the ten readings (five runs, start or end) at 1e6, read INCONCLUSIVE with the five runs attached and a reason that says "load" and gives the reading; the same sets unloaded PASS and FAIL in the same test |
| **new** AC3 #1830.7a035631 a call with no loads, or loads that can't be read, makes a budget INCONCLUSIVE… | `#1830.7a035631` | `loads` left out, `undefined` or `null` reads INCONCLUSIVE; an empty list, four or six entries, bare numbers, a `null` or `{}` entry, a missing start or end, NaN, −1, Infinity or a string never passes or fails |

`NOT_JUDGED` (INCONCLUSIVE, INVALID or BLOCKED) is kept where the first draft used it.

## Results at base `3557b348`, 2026-11-15 (a Mac17,10, 18 cores, one-minute load about 569; the suite reads neither)

```text
node --test tests/acceptance/568-redraft-1830/judge.test.mjs
ℹ tests 23
ℹ pass 23
ℹ fail 0
```

The first draft at the same base, for comparison: 21 tests, 15 pass, 6 fail (the three reference-Mac PASS and FAIL tests,
the other-Mac test's reference controls, the memory test and the property test), each reading INCONCLUSIVE because no loads
were given.

### Against planted judgeLimits

Each run copied this folder to `tests/acceptance/568-redraft-1830/` in a scratch tree outside the repository, beside a copy
of `scripts/benchmark.mjs` with `judgeLimit`'s load check changed, and ran the command above there:

| Plant | Result |
|---|---|
| ignores `loads` (the two load lines deleted, as before #1555) | exit 1; 21 pass, 2 fail: the loaded-run test (`run 1 read 1000000 at its start, runs 90,92,95,91,99: {"status":"PASS",…}`) and the no-loads test (`loads null, runs 90,92,95,91,99: {"status":"PASS",…}`) |
| takes a call with no loads as unloaded | exit 1; 22 pass, 1 fail: the no-loads test (`loads null, … {"status":"PASS",…}`) |
| reads only each run's start | exit 1; 21 pass, 2 fail: the loaded-run test (`run 1 read 1000000 at its end, … {"status":"PASS",…}`) and the no-loads test (an entry with no end passes) |

## Readings

- **"Naming the load"** is read as a reason that contains the word "load" and the reading itself (`1000000`, `1e6` or
  `1,000,000`).
- **No loads** must read INCONCLUSIVE exactly, as #1830 says; loads given but unreadable may also read INVALID or BLOCKED,
  the first draft's convention for broken input.
- **A load equal to the core count** is not tested: the design says "past its core count", and a test of the boundary
  would need this machine's core count.
