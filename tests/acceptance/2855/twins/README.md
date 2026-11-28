# Twins for the 2855 tests

`../twins.json` names them. Each replaces one file with the change's own, one rule changed: the planted wrong
programs the criteria name. The implementing session wrote them, not the blind job.

| Twin | File | What it gets wrong | The tests that fail on it |
|---|---|---|---|
| `result-type-left-off` | `packages/hub/src/mcp.ts` | results served with no handshake carry no `resultType` | `ac2-no-handshake.test.ts`, `deep mcp` and `deep mcp actions`, naming `tools/list` and the tool call |
| `serves-unheld-version` | `packages/hub/src/mcp.ts` | a request naming `2099-01-01` is served as a request naming no version, so it reaches the hub | `ac3-unheld-version.test.ts`, `deep mcp` and `deep mcp actions`, naming `2099-01-01` |
| `name-at-initialize-only` | `packages/hub/src/mcp.ts` | the client's name is read at `initialize` only, so a Codex named in `_meta` waits 55 s | `ac4-codex-wait.test.ts`, naming the wait |
| `probe-waits-whole-limit` | `packages/hub/src/mcp-servers.ts` | the probe waits the whole 10 s, so a server that never answers it is never listed | `ac6-lists-handshake.test.ts`, naming `mute` |
| `minus32601-ends-listing` | `packages/hub/src/mcp-servers.ts` | a probe answered -32601 ends the listing | `ac6-lists-handshake.test.ts`, naming `refuser` |
| `budgets-widened` | `benchmarks/budgets.json` | `deep-mcp-30d`'s margin doubled to 1, so the perf lane would give the change more room than the merge base | `ac7-budgets.test.ts` |

Every other test fails on the merge base itself at its assertion (`../BASE-FAILURE.txt`): each server answers
`server/discover` -32601, serves a request with no handshake as a handshake one and the `2099-01-01` request too,
reads a Codex's name only at `initialize`, and the lister opens with `initialize` alone. The deep-hook and reading
tools tests of AC1 to AC3 and the lister's AC5 are proven by the base alone. The budgets test passes on the base by
its nature (the base compared with itself), so its twin is what proves it.
