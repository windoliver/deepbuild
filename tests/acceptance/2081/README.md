# Acceptance tests for #2081: a run whose own focus or a filter leaves its control out

Written first, blind, from:

- issue #2081 (its text as of November 24, 2026), with #1099 and #33 as it names them
- `docs/technical-design.md`: The done loop, Check health, Dogfooding
- AGENTS.md
- the base commit `a2cbc50d9`: `packages/checks-command/src/{controls,index,listing,report,shell}.ts`,
  `packages/checks-command/runtime/vitest-reporter.mjs`, `packages/checks-command/test/regressions.test.ts`,
  `packages/gate/src/claim.ts`, the gate corpus case `reporting-rewrite-on-import`, and for shape the suites
  `tests/acceptance/30`, `3245` and `1832`

The job never saw an implementation. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes
to a blind redraft of this job.

## How to run

```sh
npm ci                                  # once, if node_modules is missing
npm run build --workspaces              # once
node node_modules/vitest/vitest.mjs run tests/acceptance/2081
node node_modules/typescript/bin/tsc -p tests/acceptance/2081/tsconfig.json
```

BASE-FAILURE.txt is the base run: 5 of the 11 tests fail, 6 hold. TWINS-RUN.txt has the planted twins, and the wrong
programs tried by hand on a throwaway fix that passes all 11. Nothing calls a model or the network. The repo's dependencies are cloned once, then every Vitest case is laid beside
them in the last one's place, in `dh2081-*` under the system's temporary folder, removed after the file.

## Surface

Each run is a real one: `runCommandCheck` (`packages/checks-command/src/index.ts`) on a project laid for it, through the
real supervisor, as `regressions.test.ts` runs its cases. What is read of it is the record it gives: `outcome`, `mask`,
`evidence`, `failures`, `attempts`, `testsRun` and `output`. A claim is judged by `claimVerdict`
(`packages/gate/src/index.ts`) on one check with that run. AC4 reads `scripts/known-failures.json`.

## The owner's call

The issue leaves open what a filter in the checkout's config or a package script gives. It is settled: `failed`, naming
the test left out. No expectation of `regressions.test.ts` changes, and that file stays as it is at the base. Criterion 2's
last half, that the regression file states the outcome, is read in the diff: its four cases expect `failed` at the base.
A planted twin can't hold a test file, so no test here reads it.

## Criteria and their tests

The IDs are `criterionId` (`scripts/proof-change.mjs`) of each criterion's text.

| ID | Test | On the base | Wrong program |
|---|---|---|---|
| `#2081.3c38e0f8` (AC1) | one run of five files under `allowOnly`: `test.only`, `describe.only`, a nested `it.only`, `{ only: true }`, and one that only mentions `.only` in a comment and a string | fails: `uncounted`, a focused file's control missing | the base; a runner that gives a focused file no control fails at the printed report; one that reads `.only` in a comment or a string as a focus fails, as that file's tests never run (TWINS-RUN.txt, part 2) |
| `#2081.3c38e0f8` (AC1) | a focused run whose planted module marks its failed result passed, then one that also drops the control | holds | `twins/no-controls` |
| `#2081.9e2d000b` (AC2) | `testNamePattern` in the config | fails: `uncounted` | the base |
| `#2081.9e2d000b` (AC2) | a tag marked `only` in the config, under `allowOnly` | fails: `uncounted` | the base |
| `#2081.9e2d000b` (AC2) | a blob report the config replays (`mergeReports`) | fails: `uncounted` | the base |
| `#2081.9e2d000b` (AC2) | `--test-name-pattern` in the package script `npm run filtered` runs | fails: `uncounted` | the base |
| `#2081.9e2d000b` (AC2) | the four filters the command itself names still pass | holds | `twins/command-filters-unread` |
| `#2081.82c87353` (AC3) | a planted module that marks every failed result passed: the run, then the claim | holds | `twins/no-controls` |
| `#2081.82c87353` (AC3) | a control missing with nothing the run can name as having left it out | holds | `twins/no-controls` |
| `#2081.82c87353` (AC3) | a package script's filter that leaves out nothing but the control | holds | `twins/no-controls` |
| `#2081.cf48270f` (AC4) | `scripts/known-failures.json` sets none of the five cases apart | holds | `twins/cases-still-listed` |

## Decisions where the issue is open

- **The control's word.** A control is never among a run's counts, attempts or failures, so AC1's second half is read
  from what the tool printed: the `FAIL` report of each file's control, with its `AssertionError` and its place, which is
  past the file's own last line. Its name holds `deepbuild control <id>`, as the issue's mask gives it; its line and its
  block are the runner's.
- **"Names what left the test out"** is read by substance, in the run's own record (`mask`, `evidence`, the failures'
  messages), never in the printed output, where npm echoes the script: `^cart`, the tag `fast`, the replay
  (`mergeReports`, replay or blob), `--test-name-pattern`. "Names the test left out" is a failure whose `test` is the
  test's name, or whose message holds it.
- **The replayed blob** is the regression file's own case: the test passed when the blob was made and fails now. The
  replay ran nothing, so the test left out is that test, though the blob's old pass of it is in the report.
- **A package script's filter that leaves out only the control** is named by no criterion. It can be named, and it leaves
  no test out, so reading it by the older rule alone would let a planted module's run pass. Invariant 2 says it can't:
  the test asks only that the run isn't `passed` and the claim isn't PASS.
- **`--test-only`** (Scope) is tested nowhere here. In the command itself it passes at the base, which
  `regressions.test.ts` holds; what it gives in a package script no criterion says.
- **Criterion 4** is an interim ("until then"): the fix lands with these tests, so at the merge there is no interim left,
  and no listing is owed. What can be tested is that it ended: none of the five cases is listed, so `affected.mjs` sets
  none apart. At the base none is listed either, so it holds there, and its twin lists one.
