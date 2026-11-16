# Why the judge failed #22.48b6696b at 97fffed5 (#318.af2a2599)

- The Mac's judge on AC (`../mac-97fffed5/judge-rerun/`): FAIL on #22.48b6696b, PASS on the other three.
- Cause: main's #1345 (PR #2701) added a `work.call` row to `packages/asks/sources.json` whose fixture carries
  `ask.subject`. `ask.sources@1` says fixtures are `ask.created@1` data, which has no subject, so
  `tests/acceptance/318` fails 2 of 27: `unlisted_field` at `/26/fixture/ask/subject`.
  - `failing-first.txt`: at #22's head.
  - `main-b1fc9abb.txt`: main b1fc9abb fails the same way on this machine.
- The fix (drop the fixture's subject) is main's to take, in its own PR (branch `claude/fix-2701-work-call-fixture`).
  #22 merges main after it lands.
- 318 with the fix on the Spark: INCONCLUSIVE. `plants.test.ts` passes. `sources.test.ts` hit its 5 s limit (8.2 to
  8.5 s) at load 118–148, under other runs. The Mac judge at #22's next head is the run that counts.
