# Twins for the 1867 tests

No implementation existed when these tests were drafted, so no twin folder is here yet. A twin is the merged
implementation with exactly one rule broken as below, and nothing else changed: the same files watched, the same bytes
written, the same readings. It replaces a file of the product, never a file under `tests/`, and it is laid by
`scripts/proof-runs.mjs` from `twins/<name>/`: the product file whole at its repo path there, or `lines.json` beside
it, `{ "<repo path>": [{ "find": [lines], "wrong": [lines] }] }`. It is test code, never chosen by an environment
variable (design: Wrong programs). The implementing agent adds the folder; it edits nothing else here.

| Criterion | Twin | Replaces | The one rule it breaks | Test it fails, and where |
|---|---|---|---|---|
| `#1867.74eeacdf` | `puts-back-yours` | the product file that holds the recheck of DeepBuild's entries in Codex's `hooks.json` at a Codex session's start | The recheck puts an entry of ours whose command was changed back without asking the record whether a call wrote the change: yours goes back too | `codex-start.test.ts`, second test: once the new thread's start is in the record your change is gone, so `expect(…).toBe('stays')` fails, showing the file's PreToolUse commands |

Why only this one. The issue's Proof line names the merge base as each criterion's wrong program, and three of the
four tests fail there at their assertion (`../BASE-FAILURE.txt`). The fourth, "the same change made with no session
running stays", passes on the merge base, which puts nothing back at all; the before lane counts a test only once it
has failed on a wrong program, so this twin is that test's proof of failing first. A twin that breaks the same rule in
the watch instead (it puts a changed entry back with no call running) fails the same assertion and would do as well;
one of the two is enough.
