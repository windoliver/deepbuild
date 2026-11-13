# Twins for the 2201 tests

The fix edits `tests/agent-eval.test.mjs`, a file under the test paths. The `before` lane lays the change's test files
over the merge base, so its merge base already holds the fixed test, and no test here can fail there. A twin can't
replace a file under the test paths either. So each wrong program is planted in the scorer the test runs,
`scripts/agent-eval.mjs`, and `../twins.json` names it.

Each twin is the base's scorer (`331b68be1`) with one rule changed, on the lines marked `Planted`. It keeps the `score`
export and both commands. No build reads it.

| Criterion | Twin | What it plants | Why it is the criterion's wrong program |
|---|---|---|---|
| `#2201.85a64726` (the test passes on main) and `#2201.e938bd0d` (a tool added needs no edit) | `tools-by-hand` | The session's tools are the eight the base's test listed by hand, whatever the run lists | It is the base's fault, moved to where a twin may live. A run gets eight tools where the skill names more, so the test fails with the base's reasons (`../BASE-FAILURE.txt`). A tool added to the tool list and the skill isn't on the hand list, so the test fails until someone edits that list |
| `#2201.e1d48ffc` (a skill pinned to another version) | `names-one-version` | A version mismatch names the skill's version alone, never the installed one | A skill pinned to another version fails without naming both versions |

`tools-by-hand` holds eight tool names because the wrong program is a list by hand. It needs no edit when main adds or
drops a tool: after either, the tools the skill names and the eight still differ.

On either twin the real test fails as a whole, so all three tests of the suite fail on it. The table says which
criterion each twin is named for, and the README beside this folder gives each failure's first line.
