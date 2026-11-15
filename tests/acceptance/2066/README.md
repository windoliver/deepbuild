# #2066: only a person's prompt saves rules or rejections

The owner approved adopting `redraft/recorded-origin.test.ts` in place of the two earlier drafts, including adding criterion tags, after reviewing PR #2519's drafts and failing output. The earlier draft bytes remain in commit `47aba2b4d`, the independently written redraft in `3e7f97070`, and their before/after output in `reports/2066/`. No acceptance assertion or expected value in the adopted redraft changed: only the test-name tags below were added.

The independent job's inputs, test surfaces and limitations are in `redraft/README.md`. The suite drives the real hub over its hook socket, reads the real event log and guard file, and checks person controls alongside every denied origin.

| Criterion | Tag | Test |
|---|---|---|
| Scheduled rule never saves or propagates | `#2066.be686212` | non-person matrix |
| Session/subagent/continuation/unknown rules never save | `#2066.0f5e890b` | non-person matrix |
| Same rule typed by a person saves once and reaches another open session | `#2066.6caf3df8` | typed twin |
| Scheduled rejection saves neither decision nor guard; person saves both | `#2066.99a5e19f` | both tests |

Tags are the first eight SHA-256 hex digits of each complete checkbox sentence, trimmed with whitespace collapsed, as `scripts/proof-change.mjs` defines. Once-only origin-naming readings and delivery at an automatic prompt are checked too.

The non-person matrix must fail on the merge base at its assertions. The typed twin is existing behavior and should pass the base, so `twins/person-origin-reversed/` reverses only the production person-origin guard. Its copied `session-memory.ts` differs from the candidate by that one comparison; it edits no test, fixture or runner. The typed twin must fail it because a person's rule is no longer saved or delivered. `twins.json` maps it only to AC3, which needs this regression proof.

```sh
npm run build --workspaces
cargo build --locked -p deep-hook
node scripts/affected.mjs tests/acceptance/2066/redraft/recorded-origin.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/2066/tsconfig.json
node scripts/proof.mjs before trace
```

No test rerun or baseline change is implied by adoption. Any later failure remains a failure. The earlier `SELECT *`/64-bit sequence error and fixture-cleanup failures are retained in evidence rather than concealed.
