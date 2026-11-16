# Acceptance tests for #2495: a configuration eval's report reaches the evidence store

Written first, blind, from issue #2495 (title, Scope, three acceptance criteria, Proof), the design's The learned layer,
`AGENTS.md`, and base commit `1c4d1f0e2aaad8c6a6573848823566d04ff73d17` (also the merge base), by a job that never saw
an implementation. The implementing agent doesn't edit these files; a dispute goes to a blind redraft (design: Dogfooding).

```sh
npm ci                                  # once, if node_modules is missing
npm run build --workspaces              # the hub test starts packages/cli/dist/main.js
node node_modules/vitest/vitest.mjs run tests/acceptance/2495
node node_modules/vitest/vitest.mjs run tests/acceptance/112 tests/acceptance/1108   # AC3: the two suites, unchanged
```

No live agent, network, credential or personal data. The only stand-ins are fake `claude` (the agents under test) and
`codex` (the judge) executables on PATH, the boundary this repo doesn't own: the first grades a variant whose
`CLAUDE.md` says "osprey" 0.8-0.86 and any other 0.5, the second scores each unlabeled output by the grade in it. The
script, a real hub on a root of its own (its address in the temp home's `~/.deepbuild/config.json`, as every client
reads it), the evidence store, the eval, the comparison rule and the learned layer are real. Temp folders (`/tmp/d2495-*`)
are removed and the hub is stopped by its PID.

## Criteria to assertions

| Criterion | Assertion (`report.test.ts`) |
|---|---|
| After an eval run, the store holds the report's bytes and the printed handle resolves to them | AC1: `node scripts/config-eval.mjs run <input>` prints an `ev:<64 hex>` handle (its surrounding message is not tested); the hub's store (read-only, after the run) `get`s that hash; the bytes hash to the handle; they parse to the frozen plan (equal to the input's) and all 12 runs, and equal the report in the kept file |
| The file under `~/.deepbuild/evals/` stays | AC1: the kept file is found, and its report equals the stored one; the fixture's eval must read `adopt` there |
| A `learn.widened` change by the local-first rule citing the handle passes `replayCheck` when the report adopts | AC2 adopt: the stored bytes (read back from the hub's store) are put in a record's own store under the same handle; a session's change applied by the rule is widened to `repo:shop` citing that handle; the row is `applied` and a later session in the repo reads the line |
| ...and is refused naming the outcome when it doesn't | AC2 regresses: the same on a report that regresses (the variants swapped); the row is not `applied`, its reason matches `regresses`, and a later session doesn't read the line |
| #112's and #1108's suites pass unchanged | AC3: the second command above, reused as they are, not copied |

On the merge base the script keeps the file and prints no handle, so every test fails at "the run prints the report's
ev:<sha256> handle" (the store holds nothing). The implementer saves that output before editing code.

## Left open

- The exact message around the handle, and whether the stored bytes are the kept file's bytes or the same report
  serialized another way: the tests compare parsed JSON and the hash, not bytes to the file, and match `ev:<64 hex>` anywhere in the output.
- The test for AC2 puts the stored bytes into a record world's store rather than pointing the record at the hub's
  store (the hub owns its ledger); AC1 proves the store the run wrote to resolves the handle.
