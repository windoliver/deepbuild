# Blind redraft: criterion tags (#31, all 15 criteria)

Tags only. No assertion, fixture, expected value, test's own name or the surface in README.md changed.

What changed: every `describe` in `*.test.ts` carries its AC's tag right after the AC number (`describe('AC1 #31.5a0437de ...')`),
as #30's do, so each test's full name holds it. Each file's header comment names the tags too, and README.md's table has a Tag
column. No line was added or removed in a test file, so no line number a test reads moved. `helpers.ts` has no criterion and
stays untagged.

Why: the tests had no tags, so the proof lanes could not link them to the issue's criteria. Each tag is `criterionId` of
`scripts/proof-change.mjs`, computed by a script with that file's parsing and hash on the real body of issue #31.

## Not run

No test suite ran: names alone changed. The diff was reviewed to confirm it.
