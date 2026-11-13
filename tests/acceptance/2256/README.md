# #2256 acceptance tests

Run: `node --test tests/acceptance/2256/canvas-parses.test.mjs` (plain `node:test`, as in `tests/acceptance/1432/`).

| Criterion | Test |
|---|---|
| `node --check benchmarks/canvas.mjs` exits 0 | `node --check ... exits 0` |
| `canvas.mjs judge` on the issue's stdin prints a judged line instead of a SyntaxError | `judge on an empty release reading prints a judged line` |

On the broken base both fail by assertion: the messages carry the `SyntaxError: Unexpected reserved word` stderr.

Scope: the judged line is only checked to be JSON naming `task: canvas-look-frames` with a known status. The issue
doesn't fix the verdict for empty runs (expected BLOCKED, but the issue doesn't say), so it isn't asserted. The 34
budget tasks aren't run. Nothing was run by the drafting job.
