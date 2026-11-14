# Acceptance tests for #1882: `deep run --result` ranks INVALID above BLOCKED

Written blind from issue #1882 (read live on November 14, 2026), `docs/technical-design.md` at the base `72fe11a11` (How runs become one of five verdicts: "precedence when several apply: FAIL > INVALID > BLOCKED > INCONCLUSIVE > PASS"; and Dogfooding), and the base, read only to learn how to drive the CLI and which codes a result can carry: `packages/cli/src/main.ts` (`run`, the `--result` path), `packages/conformance/src/families.ts` (`judge`, `exitCode` and the code table), `packages/conformance/src/runner.ts` (`worst`), `packages/contracts/schemas/run.finished@1.json` and `check.code@1.json`, and `tests/acceptance/313/packaging.test.ts` with its `fixtures/run-results/`. No implementation existed when these were written. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft by this job.

## Run

```sh
npm ci
npm run build -w @deepbuild/conformance -w @deepbuild/cli
node node_modules/vitest/vitest.mjs run tests/acceptance/1882
node node_modules/typescript/bin/tsc -p tests/acceptance/1882/tsconfig.json
```

The tests don't build. `precedence.test.ts` runs the built CLI, `packages/cli/dist/main.js`, and stops at a precondition when it is missing or older than a file under `packages/cli/src`, so a stale build can't pass or fail for the source. `BASE-FAILURE.txt` holds the base run.

## What's real

Everything. AC1 runs the built CLI as its bin does (`node packages/cli/dist/main.js run --result <file>`) on result files written to a temporary folder. AC2 reads the files under `packages/cli/src` as they are; its planted twins are copies of that folder in a temporary folder, and nothing under `packages/` is written.

## The surfaces read

- **What `deep run --result` prints**: its standard output, one line, whose first word is the verdict (`INVALID …`). The words after it aren't held.
- **Its exit status**: by the one exit-code table (#313, `exit.code@1`): 1 for a FAIL, 0 for a PASS, 3 for a result not decided.
- **The source text of `packages/cli/src`**: every file, at any depth.

## How the issue and the design were read

- **"A result whose findings judge one INVALID and one BLOCKED."** No check code reads BLOCKED: `check.code@1` lists six codes, four reading INVALID (`exit_masked`, `no_tests_ran`, `crashed_before_first_assertion`, `type_error_as_assertion`) and two INCONCLUSIVE (`reported_after_deadline`, `output_dropped`). The only listed code a `run.finished@1` result can carry that reads BLOCKED is the outcome `missing`. So the result is read as one whose judgements, the outcome's and its findings', hold one INVALID and one BLOCKED: outcome `missing` with a finding that is an INVALID check code. Each of the four is tried, and the INVALID finding before and after an INCONCLUSIVE one, since two findings can't be one INVALID and one BLOCKED. Every test first holds its result to `run.finished@1` and each code to the code table's reading (`judge`), as preconditions, so a change to the table shows as that and not as this issue's failure.
- **"Prints INVALID."** The first word of standard output is `INVALID`, and the output is one line. The message isn't held.
- **The exit status** is 3 for INVALID as for BLOCKED, so it can't tell the base from the fix; it is asserted after the printed verdict, by the exit table.
- **The rest of the precedence line** is held through the CLI where listed codes can make the pair: FAIL above INVALID and INCONCLUSIVE, INVALID above INCONCLUSIVE (both ways round) and PASS, BLOCKED above INCONCLUSIVE, INCONCLUSIVE above PASS. FAIL with BLOCKED and BLOCKED with PASS can't be made: both would need the outcome. These pass on the base; they fail a CLI that takes the first or the last judgement, or reverses the line.
- **"No list of the five verdicts in order."** A list is read as five verdict names in a row in the code, each at most 8 tokens after the one before, that are the five verdicts, in any order: the base's order is not the design's, so a detector for one order would miss the other. The source is parsed as TypeScript (the `typescript` package the repo already builds with), so comments are never read, and a name counts wherever a token holds it as a whole word: a string in any quotes, a word inside a longer string, an object key. The 8 tokens let a rank, a `case … return` or a comparison sit between entries. Verdicts used one at a time (`verdict('INVALID', …)`, `!== 'PASS'`), a list of four, and the precedence line quoted in a comment are not lists.
- **"A test that reads the source fails on a planted second list."** The detector that reads the real source is run on copies of it with a second list planted: appended to `main.ts` in nine forms, and in new files (`ranks.mjs`, `run/lib/rank.ts`). Each must be reported, at its own lines, and nothing else new. These proofs pass on the base, where the detector reports the base's own list beside the planted one.

## Criteria, tests and wrong programs

| Criterion | Test | Wrong programs it fails on | On the base |
|---|---|---|---|
| AC1 | `AC1 outcome missing (BLOCKED) with the finding <code> (INVALID) prints INVALID, never BLOCKED, and exits 3` (four codes) | the base: its own order puts BLOCKED above INVALID | FAIL, each: `AC1: a result that is both INVALID (<code>) and BLOCKED (missing) prints INVALID; deep run --result printed: BLOCKED run code missing reads BLOCKED; check code <code> reads INVALID: expected 'BLOCKED' to be 'INVALID'` |
| AC1 | `AC1 outcome missing (BLOCKED) with <the INVALID finding before / after an INCONCLUSIVE one / two INVALID findings> prints INVALID and exits 3` | the base; a CLI that takes the last finding's verdict | FAIL, each: `AC1: INVALID is above BLOCKED wherever its finding stands; deep run --result printed: BLOCKED …: expected 'BLOCKED' to be 'INVALID'` |
| the design's precedence line | `<higher> above <lower>: outcome … prints <higher> and exits <n>` (seven pairs) | a CLI that takes the first or last judgement, or one whose order is reversed | pass |
| AC2 | `AC2 no file under packages/cli/src holds a list of the five verdicts` | the base: `main.ts` holds its own order | FAIL: `AC2: packages/cli/src keeps no order of its own …` with `packages/cli/src/main.ts:110 lists FAIL, BLOCKED, INVALID, INCONCLUSIVE, PASS` |
| AC2, "fails on a planted second list" | `AC2 the reader fails on a second list planted in main.ts: <form>` (nine forms: the base's array; the design's order double-quoted over several lines with comments between entries; a reversed array in backticks; a record of ranks; a map of pairs; one string split; a switch; a chain of comparisons; a union type) and `… planted in a new file at any depth` | the planted twins themselves; a detector that reads only `main.ts`, only one order, one quote style or only arrays would miss one | pass (the detector's proof) |
| AC2 | `AC2 the reader passes verdicts used one at a time, four of the five, and the precedence line in a comment` | a detector that reads comments, or fails on any use of a verdict name | pass (the detector's proof) |
| AC3 | none here | #313's suite (`tests/acceptance/313`, with `packages/conformance/src/precedence.test.ts`), run unchanged by the implementer | not run by this job |

To check that the AC1 tests can pass, this job ran `precedence.test.ts` once against a throwaway change to the compiled `packages/cli/dist/main.js` only (its order's INVALID and BLOCKED swapped), restored afterwards by copying the built file back and comparing: 14 of 14 passed. For AC2, the detector was run once on a scratch copy of `packages/cli/src` with line 110's array emptied and reported nothing. Neither is a proposed implementation, and nothing under `packages/` was changed.

## Not covered here

- AC3 ("#313's precedence suite passes unchanged"): this job writes no test for it.
- The scope's "takes the worst verdict from conformance's `worst`": no test names the function called. AC1 holds what it prints and AC2 that the CLI keeps no list of its own.
- An order kept without naming the five verdicts close together: a list of four with the fifth implied, names built from pieces, lower-case or renamed constants, or entries more than 8 tokens apart.
- The message after the verdict, and a finding written as a code with its detail (`exit_masked: npm test`).

## Files

- `helpers.ts`: the CLI run, the result, and the detector (`verdictLists`, `verdictListsUnder`).
- `precedence.test.ts`: AC1 and the rest of the precedence line, 14 tests.
- `one-order.test.ts`: AC2 and the detector's proofs, 12 tests.
- `BASE-FAILURE.txt`: the base run, trimmed to each failure's reason.
