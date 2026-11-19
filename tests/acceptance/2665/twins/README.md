# Twins for the 2665 tests

The planted wrong programs the issue's criteria name, one per criterion that names one. `../twins.json` maps each
criterion's ID to its twin. AC1's wrong program is the merge base, which refuses the lowering as a changed definition
(`../BASE-FAILURE.txt`).

The blind job built them on its own throwaway window, which isn't kept: the base's `scripts/budget-window.mjs` with 125
lines added and 38 removed (mostly doc comments), meeting the surface in `../README.md`. It holds its own validation and ceiling judges and calls only what the
base already exports: `measure`, `measureOnce`, `judgeLimit`, `judgeInstructions`, `compare`, `fingerprint`,
`judgeTargets` and `prepareCopy` from `./benchmark.mjs`, `worst` and `writeRecord` from `./lanes.mjs`, `readApprovals`
from `./proof-change.mjs`, `holds` from `./throttle.mjs`, and `./affected.mjs`'s selection. It passed all six tests.

Each twin is that window with one line changed, and its header line naming the fault. It replaces
`scripts/budget-window.mjs` alone, so it runs over whatever `benchmark.mjs` the change has, as long as those exports keep
their shape. A copy goes stale as the real files change, and still holds its fault.

| Criterion | Twin | The planted fault | Fails at |
|---|---|---|---|
| `#2665.d2a7b8af` (AC2) | `any-approval` | Its validator takes an approval for a raise when the field and both numbers match, whichever task the item names | the misapproved raise: `the window took an approval naming eta for zeta's raise in <commit>` |
| `#2665.9583c77c` (AC3) | `own-number` | It judges each commit by the ceilings its own tree holds, so the lowering commit by its own new number | `the commit <lowering commit>, which lowers tight's peakBytes ceiling from <old> to <new>, was judged against <new>` |
| `#2665.f5e661f9` (AC4) | `reads-time` | Its judge of an instructions ceiling reads the five timed runs' elapsed ms, not the count | `counted's instructions ceiling read PASS on a command retiring 5% more than its <ceiling>` |
| `#2665.5222fad8` (AC5) | `zero-count` | Its count of instructions reads a count it can't read as 0 | `uncountable's command waits for a child no count covers, so each of its counts is missing (null), never 0` |
| `#2665.9afb008a` (AC6) | `drops-uncapped` | Its record leaves out a task with no ceiling when the task names criteria | `the record of <commit> doesn't list open-b, a task with no ceiling` |

Each twin ran once, on the file that holds its criterion's test (`../BASE-FAILURE.txt`). There every other test passed,
except that `zero-count` also fails AC6: a reading of 0 lists `uncountable` as more than 20% under its ceiling.
