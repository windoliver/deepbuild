# Acceptance tests for #1830: timing suites give judgeLimit the load

Written blind at base `3557b3489` from issue #1830 (and its dependency #1555), `docs/technical-design.md` (How we know
version 0 works: Every task carries its own budgets, The reference Macs, Criteria to tests, Wrong programs, Dogfooding),
AGENTS.md, `scripts/benchmark.mjs` (`judgeLimit`, `fingerprint`), `scripts/lanes.mjs` (`byHand`, `timed`, `alone`, the
`lint` check), `scripts/plant-lint.mjs` and `scripts/proof-change.mjs` (`criterionId`). Nothing of #1830 exists at the base.
The implementer doesn't edit these files; a dispute goes to a blind redraft.

## Run

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1830 --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1830/tsconfig.json
```

`ac1-lint`, `ac2-redrafts` and `ac3-judge` run on any machine in a few minutes: they run the lint on scratch checkouts and
on this one, and #568's redrafted judge suite (seconds). `ac2-timing.test.ts` runs #311's redrafted AC12 for real, four
times, so it builds what that suite builds and needs a fit reference Mac (one of the three, mains power, Low Power Mode
off, thermal state nominal, load at or below the cores, as `judgeLimit` decides it). Anywhere else it is skipped as
`INCONCLUSIVE: ...`, never passed. It is a timed file: it belongs in `timed` and `alone` in `scripts/lanes.mjs`.

On the base every test fails at its first assertion, as `BASE-FAILURE.txt` shows.

## Surfaces

- `node scripts/loads-lint.mjs [--root <checkout>]` reads every `.ts`, `.mts`, `.js` and `.mjs` file under
  `<root>/tests/acceptance` (default: the checkout holding the script), except under a `twins/` folder, and finds each call
  of benchmark's `judgeLimit` with an object argument: by name, through its module (`bench.judgeLimit({...})`), through a
  variable holding the function, or inside a string of code a suite runs in a child process. A call whose object literal
  has no `loads` key is a finding; a spread may carry it, so a call with one is not. It prints
  `FAIL loads: <path relative to root>:<line>: judgeLimit gives no loads` per finding and exits 1, or one `PASS loads`
  line and exits 0. A local function of the same name called with positional arguments, a type signature, a comment and a
  README are not read. The `lint` check of `scripts/lanes.mjs`'s `checks` runs it.
- `scripts/lanes.mjs` exports `redrafted`: each original file (repo-relative) whose calls a blind redraft replaced, mapped
  to that redraft's folder (repo-relative, ending in `/`). An original test file in it is in `byHand`. The lint skips an
  original only while its redraft folder exists under the root.
- The redrafts sit at `tests/acceptance/<n>-redraft-1830/`; #311's AC12 at `311-redraft-1830/`, #1018's AC6 at
  `1018-redraft-1830/`, #568's judge suite at `568-redraft-1830/judge.test.mjs` (node:test, finding
  `../../../scripts/benchmark.mjs` from its own file and its fixtures in its own folder).

## Criteria, tests and wrong programs

IDs are `criterionId` of each checkbox's text (`scripts/proof-change.mjs`).

| ID | Criterion | Tests (file: name after the ID) | Wrong program it fails on |
|---|---|---|---|
| `#1830.c80971bc` | A lint over `tests/acceptance` fails any `judgeLimit` call that gives no `loads`, naming the file and line; it lists none once the redrafts land | `ac1-lint`: *the lint fails each planted judgeLimit call that gives no loads…*; *calls that give loads or a spread, a local judgeLimit… are not findings*; *an original a redraft replaced is listed… until its redraft folder exists under the root*; *over this checkout the lint lists none once the redrafts land, and the lint lane runs it* | The base (no lint). The planted suites in `twins/lint/`: 8 marked calls (by name, a multi-line call, through the module, a destructured dynamic import, two variables, two lane strings) that a lint reading only names, only members or no strings misses, and calls it must not list (shorthand and keyed `loads`, two spreads, `[...runs]` is not one, a positional local `judgeLimit`, an interface method and a `declare function` with a destructured parameter, comments, a README, a `twins/` folder). A lint that skips `redrafted` originals whether or not the folder exists, or never. A lint left out of the lint lane |
| `#1830.c69ecf39` | Each redrafted timing suite reads PASS on a fit reference Mac with runs inside its limit and FAIL with runs over it; on the merge base the same suite reads INCONCLUSIVE, naming the load | `ac2-redrafts`: one test per suite, *`<suite>`: the lint lists the original's judgeLimit calls, which give no loads, and its blind redraft, listed in redrafted, gives loads* (18). `ac2-timing`: *on a fit reference Mac, #311's redrafted AC12 reads PASS… FAIL… INCONCLUSIVE at a planted load, naming it, and the original reads INCONCLUSIVE, naming the load* | The base (no redraft folder, no `redrafted`). A redraft whose calls give no loads (the lint lists it beside the original). An original left running in a lane. On the reference Mac: a redraft that gives constant loads, or reads them anywhere but the one-minute load (the planted `os.loadavg`, `twins/machine.mjs`, must reach every call); one that skips or passes when its runs are over the limit (`twins/judge-plant/judge.mjs` moves them over) |
| `#1830.7a035631` | #568's redrafted judge suite passes on any machine, and fails on a planted `judgeLimit` that ignores `loads` | `ac3-judge`: *#568's redrafted judge suite passes on this machine, loaded or not, and on planted machines of 2 cores at load 300 and 256 cores at load 0.1*; *a copy of #568's redrafted judge suite passes beside the real judgeLimit and fails beside a planted judgeLimit that ignores loads* | The base (no redraft). `twins/judge/ignores-loads.mjs`: `judgeLimit` judging every run as if the machine were idle, as before #1555, laid in a scratch checkout as `scripts/benchmark.mjs`; `twins/judge/honest.mjs` is the control, laid the same way. A redraft that reads this machine's load or core count (the planted machines) |

## How the plants work

- **Lint plants** (`twins/lint/`) are stored with a `.txt` suffix, so no lane, typecheck or the lint itself reads them in
  place. A test lays them, without the suffix, as `tests/acceptance/9830/` in a scratch checkout holding a copy of
  `scripts/`, and runs this checkout's lint with `--root` on it. The expected FAIL lines are the lines each plant marks
  `// finding`.
- **Before and after per suite** (`ac2-redrafts`): a scratch checkout holds a copy of the original's script files only
  (as the merge base has them); every file the lint lists there must map to the suite's redraft in `redrafted`, and be in
  `byHand` when it is a test file. With the redraft folder copied beside it, the lint must list none.
- **The planted judge** (`twins/judge-plant/`): `judge.mjs` re-exports `scripts/benchmark.mjs` and wraps `judgeLimit`,
  recording each call and the real verdict, and with `JUDGE_PLANT_OVER=1` moves each run over its limit by twice the limit
  plus the runs' spread, which `judgeLimit` reads FAIL whatever the margin. `vitest.config.mjs` puts it in place of
  `scripts/benchmark.mjs` for what vitest resolves; `register.mjs`, through `NODE_OPTIONS=--import`, for what node
  resolves, child processes included. Checked here on a throwaway suite: calls by static import, dynamic import and a
  `node -e` child were all recorded, and a planted load reached each.
- **Planted machines** (`twins/machine.mjs`, through `NODE_OPTIONS=--import`): `node:os` answers `PLANT_CORES` cores
  (`availableParallelism`, `cpus`) and a load of `PLANT_LOAD`. The machine is the boundary these tests stand in for; no
  shipped program reads an environment variable for it.

## Readings where the issue leaves a choice

1. **The line** of a finding is the line where the call starts (its callee), also for a call whose object runs over
   several lines; inside a one-line string of code it is that string's line.
2. **"Lists none once the redrafts land"** is read on this checkout, with `--root` and without, and per suite on a scratch
   checkout holding the original and its redraft.
3. **"Each redrafted timing suite reads PASS … and FAIL"** is run for real on one suite, #311's AC12 (the issue's own
   example, and its Proof asks for one suite's PASS and FAIL runs). For every suite it is held statically: the redraft
   exists, calls `judgeLimit`, and the lint lists none of its calls. A suite whose runs on the reference Mac are over its
   limit can't show the PASS half; the test is then skipped as INCONCLUSIVE, naming the run.
4. **"On the merge base … INCONCLUSIVE, naming the load"**: the base's `judgeLimit` given no loads reads INCONCLUSIVE with
   a reason naming the load (#1555). The per-suite tests show each original's calls give none; `ac2-timing` runs #311's
   original and requires every call to read INCONCLUSIVE with `load` in its reason.
5. **The planted load** is the cores plus 7.25. A redraft that skips before measuring at that load may call nothing; it
   must then pass no test.
6. **"Any machine"** for #568's judge suite is this Mac (loaded far above its cores when this was written) and two planted
   machines: 2 cores at load 300, 256 cores at load 0.1. No test of it may be skipped.
7. **#417** calls benchmark's `judgeLimit` through a local async getter of the same name, `(await judgeLimit())({ ... })`
   and a variable holding its result (`git grep judgeLimit tests/acceptance/417`). The issue's Scope names #417, so the
   lint must list those calls on the base; its per-suite test requires it.

## Checked against a sample implementation and mutants

In a scratch copy outside this checkout (not committed) I wrote a sample lint on the TypeScript parser, a `redrafted`
with #568's entry, the lint-lane entry, and a sample #568 redraft (the original with idle loads on each call, plus a case
above the cores). `ac1-lint` (4/4), `ac3-judge` (2/2) and the 568 case of `ac2-redrafts` passed. Each mutant failed the
tests named:

| Mutant | Failed |
|---|---|
| Lint that reads no strings of code | the planted findings |
| Lint that never skips a redrafted original | redraft folder, this checkout |
| Lint that skips redrafted originals with no folder | redraft folder |
| Line-based regex lint (reads comments and signatures) | all four AC1 tests |
| `redrafted` original not in `byHand` | the 568 case of `ac2-redrafts` |
| #568 redraft with idle loads only, no loaded case | the ignores-loads plant test |

The sample lint over this base listed: 103 (2), 124 (1), 148 (1), 149 (1), 166 (2), 262 (2), 268 (2), 311/redraft-ac12
(1), 365 (2), 465 (2), 568/judge.test.mjs (20), 761 (2), 968 (2), 1018/redraft-ac6 (2), 1098 (1), 1425 (1), 1427 (1),
and no other file. It missed #417's getter form (reading 7 above), which the real lint must catch.

## Not covered here

- The real timing runs of the other 16 redrafted timing suites (#124's and #1427's are live, spending plan usage); they
  are held by the lint and the per-suite tests only.
- That each redraft keeps the replaced tests' names.
- `ac2-timing` was not run to its end here: this Mac is a reference Mac but ran at a load far above its cores with its
  thermal state fair, so it skips.
