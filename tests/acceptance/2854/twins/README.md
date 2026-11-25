# Twins for the 2854 tests

`../twins.json` names them. Each replaces one file with the change's own, one rule changed. The implementing session
wrote them, not the blind job.

| Twin | File | What it gets wrong | The test that fails on it |
|---|---|---|---|
| `budgets-widened` | `benchmarks/budgets.json` | `deep-mcp-30d`'s margin doubled to 1, so the perf lane would give the change more room than the merge base | `ac6-budgets.test.ts` |

Every other test fails on the merge base itself at its assertion (`../BASE-FAILURE.txt`): the servers send back
`1900-01-01` and `2026-07-28`, hold no list, there is no `mcp.handshake@1` and no `mcpHandshake` section. The budgets
test passes on the base by its nature (the base compared with itself), so this twin is what proves it.
