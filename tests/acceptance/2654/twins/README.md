# Twins for the 2654 tests

`../twins.json` names them. Each replaces one file with the change's own, one rule changed and marked `Planted:`.
The implementing session wrote them, not the blind job.

| Twin | File | What it gets wrong | The tests that fail on it |
|---|---|---|---|
| `keeps-dropped` | `packages/hub/src/mcp.ts` | A line past the cap is refused, but its bytes are kept up to its newline | `ac1-gigabyte.test.ts`; `ac2-exact-cap.test.ts`, the 256 MiB line |
| `decodes-each-chunk` | `packages/hub/src/mcp.ts` | Each read's bytes are decoded alone, so a character cut across two reads comes out as U+FFFD | `ac3-split-reads.test.ts`, the multi-byte character |
| `reads-as-lines` | `packages/hub/src/mcp.ts` | The end of a read ends its line, so a line cut across two reads is read as two | `ac3-split-reads.test.ts`, the line cut across two reads (and every other test but the budgets one) |
| `budgets-widened` | `benchmarks/budgets.json` | `deep-mcp-30d`'s margin doubled to 1, so the perf lane would give the change more room than the merge base | `ac5-budgets.test.ts` |

On the merge base itself the two memory tests, the exact-cap test and the held reply's test fail at their assertions
(`../BASE-FAILURE.txt`); the split-read tests and the budgets test pass there, and are proven by these twins.
