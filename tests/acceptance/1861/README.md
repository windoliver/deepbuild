# Acceptance tests for #1861: a check that counts no test tool's tests is labelled `static_check`

Written first and blind at base `c740dede7`, from the issue, `docs/technical-design.md` and the base code only. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

| ID | Criterion (short) | Test |
|---|---|---|
| AC1 `#1861.0f1b7e41` | R1, covered only by `tsc --noEmit` over a clean file, passes and reads proof `static_check` | `proof-label.test.ts` |
| AC2 `#1861.129e4c71` | R2 in the same claim, covered by a passing Vitest file, reads `test_run` | `proof-label.test.ts` |

One claim through `deep_claim` on a real hub (#322's world and hub, #965's Session with its own `deep mcp`). The repo
has no `done.yaml`; R1's drafted check runs `tsc --noEmit -p tsconfig.json` (the fixture's tsconfig names `src/sum.ts`
alone, `types: []`), R2's runs `node_modules/.bin/vitest run tests/sum.test.ts`. TypeScript and Vitest are copied
into the fixture's ignored `node_modules`. Both checks are `on_base: passes`. A check that didn't run and pass on the
claim is BLOCKED, never judged.

Wrong programs: the merge base (every row `test_run`) fails AC1 naming R1; a gate labelling every command check
`static_check` fails AC2 naming R2.

## How to run

Needs `npm run build --workspaces` and `target/debug/deep-hook`. No network, no model. Folders under `/tmp/dh322-*`,
processes stopped by PID.

```sh
npx vitest run tests/acceptance/1861 --testTimeout=900000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1861/tsconfig.json
```

It starts a hub of its own, so `scripts/lanes.mjs` should list `tests/acceptance/1861/` under `alone` (the
implementer adds it).

## Base run

At the base, 1 failed, 1 passed, about 43 s: AC1 fails at its proof assertion naming R1 (row reads `"proof":"test_run"`,
outcome PASS); AC2 passes.
