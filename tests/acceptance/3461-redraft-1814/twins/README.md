# Twins for #3461's criterion b4a5c8f4 (redraft 1814)

The frozen suite's two twins for this criterion, `tests/acceptance/3461/twins/first-wins-reader/lines.json` and
`last-wins-reader/lines.json`, copied byte for byte. Each is the change with one rule broken, kept as its wrong lines and
applied to the change's file when the before lane runs (`scripts/proof-runs.mjs`, `twinOverlay`); neither touches a
file under `tests/`.

| Twin | Edits | The one rule it breaks | Where `table.test.ts` fails |
|---|---|---|---|
| `first-wins-reader` | `packages/cli/src/main.ts`, the line `} else if (givenTwice(args) !== undefined) {` | A flag shown once and given twice is dropped from its second use on, so the first value wins and the command runs on it | The failures assertion: "88 of 88 rows (commands and flags) took a repeated flag", each row `deep <command> <flag> (two values \| one value repeated): exits N, not 2; prints no usage of deep <command>` |
| `last-wins-reader` | the same line | The same, keeping the last use, so the last value wins | The same assertion: "86 of 88 rows" at the base |

The line each edits is in the base `9bbe0f24c` once. #1814 changes `main.ts`; the twins apply only while that line is
there once, unchanged (else the lane reports them stale and the criterion is BLOCKED, never a pass).

## Checked here

Both were run as plants on the base's built `packages/cli/dist/main.js`, through a Node load hook that replaces the
same line (in its compiled form, `else if (givenTwice(args) !== undefined) {`) as the file loads, so nothing on disk
changed. Results in `../BASE-RESULTS.txt`, checks 2, 3 and 5.
