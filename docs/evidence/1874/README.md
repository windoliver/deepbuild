# #1874 proof

From this branch, on the Mac17,10 (a reference Mac since 2026-11-07), 18 cores, Node 24.22.0. Every window ran
through `node scripts/throttle.mjs window` in a fixture repository, as `tests/acceptance/1116/` runs one, with every
process on a temporary `HOME`. Other sessions held the 1-minute load at 110 to 390 throughout; the suites pin the load
their own processes read.

| File | What it shows |
|---|---|
| `blind-suite.txt` | The blind suite (`tests/acceptance/1874/`, drafted first at f28d8777 in 5446ce07 from the issue, the design and that base only). On the base, AC1 to AC3 fail at their assertions (`'CLOSED' !== 'OPEN'`: the base's window closes all three issues) and AC4 passes, as it holds "as today". On this branch all 4 pass. |
| `wrong-programs.txt` | The blind twins and three hand-made mutants of this branch's window, each run once in a scratch copy. `never-closes` fails AC4 at its assertion. Each mutant fails the criterion it plants against, at that criterion's assertion: an issue with no criteria section closing (AC3), a record without `unmeasured` (AC1), a close that ignores what the tasks name (AC1). The `silent-record` twin's run hit the load first (an INCONCLUSIVE and a `tar EPIPE` record), so it shows nothing about its own line, which mutant m2 covers. |
| `suites-1116.txt` | The blind redraft `tests/acceptance/1116-redraft-1874/` passes 5 of 5 on this branch. On the #1116 originals, the 5 tests the redraft replaces fail at the close they wait for, as `REDRAFT.md` says, and every other test passes. The guard test failed before `npm ci` and passed once `node_modules` was installed. |
| `proof-lanes.txt` | `node scripts/proof.mjs guard trace`, twice. Run 1: `before` PASS on AC1 to AC3, each failing on the merge base at its assertion. AC4 BLOCKED: building the change bay for the `never-closes` twin hit the lane's 20-minute cap at that load. Run 2, after main was merged in: the change bay's build itself hit that cap, so `before` ran nothing. Both runs' guard FAIL lines are commit e6115e717, which changes `scripts/budget-window.mjs` and `scripts/benchmark.mjs`. Those are the proof lanes' own code and need the maintainer's signed approval tag. |

Not run: `node scripts/affected.mjs`, the release preflight, and a window over real main commits. A real window on
this Mac would run every task of `benchmarks/budgets.json`, and `benchmarks/canvas.mjs`, which 34 of them run, hasn't
parsed since #501 (#2256).
