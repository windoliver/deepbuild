# Acceptance tests for #2075: a claim's slow checks start when its fast lane ends past the stop's hold

Written blind from `../issue.md`, `docs/technical-design.md` (An agent says it's done: Fast and slow lanes, Slow runs
start when the turn ends), AGENTS.md and base commit `1c4d1f0e2aaad8c6a6573848823566d04ff73d17`.

## Run

```sh
node scripts/affected.mjs tests/acceptance/2075/slow-checks.test.ts   # not the folder: it selects unrelated suites
npx vitest run --root tests/acceptance/2075 --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/2075/tsconfig.json
```

Needs `npm run build` and `cargo build -p deep-hook` (as tests/acceptance/29). Each test takes about 30-50 s. Vitest
writes a cache to `tests/acceptance/2075/node_modules/.vite/`; delete it before committing.

## Surface

A real hub (`deep hub run`), deep-hook and a Claude Code stand-in (`tests/acceptance/29/h-d.ts`), real check scripts run
by the real gate runner, read from the record (`run.started`, `run.finished`, `verdict.made`). Only addition: the hub's
test-only `DEEP_HUB_TEST_STOP_HOLD_MS=3000`, so the reply's deadline falls before the fast check ends. The fast check
(R1, `fast.sh`) has no clean run, so it counts 0 ms and is admitted to the fast lane; it runs 9 s. The slow check (R2,
`slow.sh`) has `expected_ms` 20000, past the 10 s budget, so it is a slow-lane check. Prerequisites checked in every
scenario (BLOCKED otherwise): the fast check started in the fast lane and had not ended when the stop was let through; the
stop was not sent back.

## Criteria

| Criterion | Test | On base |
|---|---|---|
| 1. slow check starts after the fast one passes, no new prompt, verdict reached; names the check | AC1 | FAILS: `slow.sh` has no run, claim pending, fast ended `passed` at log 36, no verdict |
| 2. fast check failing after the hold: no slow start, FAIL | AC2 | passes (guard) |
| 3. new prompt before the fast check ends: no slow start of the old snapshot | AC3 | passes (guard) |

`BASE-FAILURE.txt` is the verbose vitest output on base; `affected-output.txt` the `affected.mjs` output (its 173 "new"
failures are repo-wide lint/deps checks plus git shard errors unrelated to these files; the only one in this folder is
AC1). `RUN-SCOPE.txt` was left by the coordinator: an earlier folder-argument run was stopped and is not evidence.

## Unproven

- Hold is 3 s, not the shipped 60 s; the "runner's hold outlasts the reply" gap is reproduced, not the exact 60 s timing.
- The slow lane comes from a declared `expected_ms`, not a release check or a recorded history.
- AC3 asserts only that nothing of the old snapshot starts; that it waits for the new turn's stop is not tested.
- Loop/background rules ("same as at a turn end") and an INVALID fast lane are not tested; only FAIL (AC2).
