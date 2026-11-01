# Blind redraft of AC17's claim half (`#30.a06dc35a`)

A fresh draft, 2026-11-01 at `40419393`, of the claim-half block of AC17 by a job that never saw an implementation.
It read the issue's Scope and AC17, the design's verdict section and its checks-command row, the suite's README,
`helpers.ts`, `fixtures/retry/`, `retries.test.ts` (the run's half, whose conventions it follows), the AC2, AC7 and
AC8 blocks of `claims.test.ts` for style (never the existing AC17 block), and the public entries of
`checks-command`, `gate` and `verdicts` (types only). It edits nothing outside this folder.

## What `ac17-claim.test.ts` asserts

The retry fixture (`settles the order`, `{ retry: 1 }`, fails its first attempt and passes its retry; `totals the
order` passes) runs for real through `runCommandCheck`, and the run is handed to
`claimVerdict(claimOf({ check: 'retry-suite', command: VITEST, runs: [r] }))`.

- **AC17 (real):** the record says whether the tool's retries were turned off (`retries` is `null` or a non-blank
  flag). Then `claimCountsEveryAttempt`: when `retries` is `null`, the report lists both attempts, so the check
  `retry-suite`, the claim and the requirement are `INCONCLUSIVE`; when `retries` names the flag, the test failed the
  run, so they are `FAIL`. Never `PASS` either way, and a reason names `settles the order`. Either reading of the
  criterion passes, as `retries.test.ts` accepts.
- **AC17 (wrong program):** the same run under `plant: 'last-attempt-only'` (reads only each test's last attempt).
  The planted run must have `passed` (else BLOCKED: the wrong program wasn't shown); its claim must be `PASS`; and
  `claimCountsEveryAttempt` must throw naming `settles the order`.

Why the first assertion's message carries the test's name: the planted runner lets the claim through, so its
verdict's reasons name nothing, and the first assertion to fail (the check's outcome, `PASS` where `INCONCLUSIVE` or
`FAIL` is expected) is the only place the name can come from (`tests/acceptance/29/REDRAFT.md`, the floor tests).
The verdict is made outside the `toThrow` expectation, so a run that never started is BLOCKED, never a match.

Every value asserted is the criterion's, the fixture's or the surface's: the outcomes `INCONCLUSIVE`/`FAIL`/`PASS`
(the verdict table), the test name (the fixture), `retries`, `attempts` and `plant: 'last-attempt-only'`
(`CommandRun`/`CommandCheck`), `checks[].outcome`, `requirements[].outcome` and `reasons` (`Verdict`).

## How to run

```sh
export PATH=/home/jing/.local/bin:$PATH   # node 24
env -u CLAUDECODE -u AI_AGENT node node_modules/vitest/vitest.mjs run --root tests/acceptance/30 --no-file-parallelism redraft/ac17-claim.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/30/tsconfig.json   # clean at 40419393
```

## The run here (Linux, 2026-11-01)

The supervisor refuses every start on this box (no Linux sandbox backend, #70), so every run is `missing` and both
tests fail BLOCKED, never pass. `tsc` exits 0.

```
 ❯ redraft/ac17-claim.test.ts (2 tests | 2 failed) 1017ms
   ❯ AC17 #30.a06dc35a a test that fails and passes on its retry within one run makes the claim INCONCLUSIVE naming it, or FAIL with the tool's retries off (the claim's half; the run's is in retries.test.ts) (2)
     × AC17 the claim on the retry suite's run, where "settles the order" fails once and passes on its retry, is INCONCLUSIVE naming the test (FAIL naming it when the run turned the tool's retries off by its flag), never PASS 311ms
     × AC17 (wrong program) a runner that reads only each test's last attempt passes the fixture test that fails once and passes on its retry, so its claim passes and fails this test, naming "settles the order" 307ms

 FAIL  redraft/ac17-claim.test.ts > ... > AC17 the claim on the retry suite's run, ...
Error: BLOCKED: run run:01M6CH78KV53P8EEAN0C22069H of retry-suite never started, so no verdict can be made from it: no platform sandbox backend for linux yet (#70); nothing runs outside one
 ❯ claimOf helpers.ts:213:40
 ❯ claim redraft/ac17-claim.test.ts:22:34
 ❯ redraft/ac17-claim.test.ts:49:28

 FAIL  redraft/ac17-claim.test.ts > ... > AC17 (wrong program) a runner that reads only each test's last attempt ...
Error: BLOCKED: the planted runner didn't pass the retried test (outcome missing), so the wrong program wasn't shown:
 ❯ redraft/ac17-claim.test.ts:55:39

 Test Files  1 failed (1)
      Tests  2 failed (2)
```
