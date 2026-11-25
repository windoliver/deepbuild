# Acceptance tests for #3393: a run that exits non-zero never reads passed, and its controls alone never make it

Written first, blind, from:

- issue #3393 (its text as of November 24, 2026), with #1099, #33 and #2081 as it names them
- `docs/technical-design.md`: Check health (How runs become one of five verdicts), Dogfooding, Built to be hard to get wrong
- AGENTS.md
- the base commit, as it was exported for this job: `packages/checks-command/src/{controls,index,listing,report,shell}.ts`,
  `packages/checks-command/runtime/{preload,vitest-reporter}.mjs`, `packages/conformance/runtime/check-kind/*`,
  `packages/checks-command/test/regressions.test.ts`, and for shape the suite `tests/acceptance/2081`
- how Vitest 5.0.5 and Node 24.22.2 end a run, read from the installed packages and by running them

The job never saw an implementation. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes
to a blind redraft of this job.

## How to run

```sh
npm ci                                  # once, if node_modules is missing
npm run build --workspaces              # once
node scripts/throttle.mjs test -- node node_modules/vitest/vitest.mjs run tests/acceptance/3393 --testTimeout=900000
node node_modules/typescript/bin/tsc -p tests/acceptance/3393/tsconfig.json
```

On the base 12 of the 17 tests fail and 5 hold, and each of the 5 fails on its planted twin: the repo's `before` lane ran
the suite as it stands. This job ran an earlier form of it, 16 tests, on the base, and on two of the twins, a throwaway fix and
wrong programs by hand. BASE-FAILURE.txt and TWINS-RUN.txt say which result is whose. The throwaway passed 15 of the 16; its
last form was never run, so three tests, as they
stand, were seen to fail on wrong programs and not to pass on a right one (TWINS-RUN.txt, NOT RUN).

Nothing calls a model or the network, and nothing beyond Node, npm and the repo's own dependencies is needed. Those are
cloned once, then every Vitest case is laid beside them in the last one's place, in `dh3393-*` under the system's temporary
folder, removed after the file.

## Surface

Each run is a real one: `runCommandCheck` (`packages/checks-command/src/index.ts`) on a project laid for it, through the
real supervisor, as `regressions.test.ts` and #2081's suite run theirs. What is read of it is the record it gives
(`outcome`, `mask`, `exit`, `failures`, `attempts`, `testsRun`) and the file the checked command's own step writes. In
every run no attempt and no failure is named `deepbuild control <id>`: a control is never one of the run's tests.

## Criteria and their tests

The IDs are `criterionId` (`scripts/proof-change.mjs`) of each criterion's text.

| ID | Test | On the base | Wrong program |
|---|---|---|---|
| `#3393.1677935b` (AC1) | a step after `vitest run`, in the command and in a package script: one that exits 1, then one that exits 0 | fails: `passed`, and the step never ran | the base; a runner that never runs the step (TWINS-RUN.txt, part 2) |
| `#3393.1677935b` (AC1) | the same after `node --test` | fails: the same | the same |
| `#3393.ec7f411b` (AC2) | Vitest's `afterAll` in a `describe` throws | fails: `passed` | the base; a runner that fails by the exit alone, or places the error elsewhere |
| `#3393.ec7f411b` (AC2) | node:test's `after` in a `describe` throws | fails: `passed` | the same |
| `#3393.ec7f411b` (AC2) | node:test's `after` at the top of a file throws | holds | `twins/hooks-unread` |
| `#3393.f37b061d` (AC3) | a Vitest global teardown throws | fails: `passed` | the base; a runner that sets the exit to 0 whenever the report's only failures are controls |
| `#3393.f37b061d` (AC3) | a Vitest coverage provider sets a failing exit, its threshold not met | fails: `passed` | the same |
| `#3393.f37b061d` (AC3) | `node --test --experimental-test-coverage --test-coverage-lines=100`, not met | fails: `passed` | the same |
| `#3393.f37b061d` (AC3) | a node:test file whose process ends with status 1, set as it exits, then in its last hook | fails: `passed` | the base; a control marked `todo` |
| `#3393.7873278a` (AC4) | Vitest: a failing test, then a step | holds | `twins/exit-zero` |
| `#3393.7873278a` (AC4) | node:test: the same | holds | `twins/exit-zero` |
| `#3393.27163b72` (AC5) | Vitest, an ES module, and one that requires its product in a CommonJS package | fails (its earlier form: exit 1) | the base |
| `#3393.27163b72` (AC5) | Vitest, a CommonJS file | fails | the base |
| `#3393.27163b72` (AC5) | node:test, an ES module and a CommonJS file | fails: exit 1 | the base |
| `#3393.27163b72` (AC5) | three Vitest files under `bail: 1`, one at a time: all six tests run | fails: the later files never run | the base; a control that ends the run early |
| `#3393.8dce2db5` (AC6) | Vitest: a planted module under which no assertion fails, alone and with a step | holds | `twins/exit-for-result` |
| `#3393.8dce2db5` (AC6) | node:test: the same, an ES module and CommonJS | holds | `twins/exit-for-result`; a runner with no control in CommonJS files |

Each twin's edits are of lines a right change has no reason to touch. `exit-zero` sets the exit in two places: the preload
never loads into `node --test`'s own process, and the runner's node:test reporter does.

Proof's last part, `regressions.test.ts` and #2081's suite unchanged, is run on the change and read in its diff. No test
here reads either.

## Decisions where the issue is open

- **The step that exits 1** writes its file first, so a run that fails without ever starting the step isn't taken for one
  that ran it.
- **"Carries the hook's error and the line it threw at"** is a failure whose `file` and `line` are the `throw`'s own and
  whose message or stack holds the error's text. Which test or suite that failure names is left open. The throw sits on a
  line of its own, below the hook's and the suite's.
- **node:test's `after` at the top of a file** already reads `failed` at the base, with its error and its line, though the
  criterion says a runner that reads only test results passes it: the base reads the file's own entry of the report too.
  The test holds there, and the twin that leaves the hook's error unread fails it.
- **AC3's reading** is the outcome `failed` and an exit that isn't 0. What its failure says is left open. That "whose tests
  all pass" holds is read from the attempts.
- **The coverage provider** is a `custom` one, as no coverage package is installed. It checks its threshold in
  `reportCoverage`, where Vitest's own providers check theirs, and the config is the default otherwise. So it holds
  `reportOnFailure: false`, under which Vitest asks for no report once a test has failed: a run in which a control still
  counts as a failed test never reaches the threshold.
- **A node:test process that "ends with status 1"** is tried two ways, each in its own run: set in the process's `exit`
  event, and set by the file's last hook. A control that puts the status back may mask one and not the other.
- **Vitest in CommonJS.** Vitest's API can't be `require`d (its own `index.cjs` throws), so two forms are run: a test file of
  a `"type": "commonjs"` package that imports Vitest and requires its product, and a CommonJS file, with no `import` or
  `export`, that requires its product and takes Vitest's API as globals and by `import()`, as Vitest's own error says to.
  A file of the second form that names Vitest reads `failed` on the base, at the control appended to it, which requires
  Vitest (BASE-FAILURE.txt, at its end): a clean check that can't pass, which the criterion names. Whether such a file gets a
  control, and how it is written, is left open.
- **"With its controls held"** has no field in a run's record. A passing run's mask is null, and AC6 reads that Vitest and
  both forms of node:test have a control that has to fail.
- **`bail: 1`** runs one file at a time (`fileParallelism: false`), so what an early end leaves out doesn't hang on timing.
- **AC6's node:test module** empties every function of `node:assert` and its strict form, so it holds whichever of them a
  control asserts with. Vitest's is the gate corpus's `reporting-rewrite-on-import`. Whether the chained step runs there,
  and the run's exit, are left open.
- **Not tested:** what the issue's Scope names and no criterion does (an unhandled error in Vitest, which the
  base's reporter already writes as a failure: read in its source, not run), and the tools that get no control.
