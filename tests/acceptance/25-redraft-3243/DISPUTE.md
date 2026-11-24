# Dispute (#3243): #25's held-stop and one-route tests wait on a choice the design says goes on at once

This file is the work's, not the blind job's. The job wrote the other files of this folder from #25's issue,
`docs/technical-design.md` and base `118ec119f`. It never saw this file, the dispute, or why a redraft was asked for.

## What fails

`tests/acceptance/25/routes/held.test.ts` (AC1 `#25.0215da31`) and `one-route.test.ts` (AC4 `#25.1eae4ef9`) raise their
ask through `beginAsk` (`tests/acceptance/25/routes/helpers.ts`): `{ kind: 'choice', options: [blue, green],
recommended: blue }`, in a session no work run started. On main the hub answers that ask at once:
`{"status":"provisional","answer":"blue…"}`. That is #84's rule (`packages/hub/src/mcp-operations.ts`, the `provisional`
branch; #1332 exempts sessions a work run started). `questionHolds` and `stopHold` (`packages/hub/src/stop-judging.ts`)
hold a stop only for asks with `provisional = 0`, so each test fails before anyone answers:
`AC1|AC4 the Stop of a session whose ask ask:… is open must be held for your answer; it ended before you answered`.
Their wrong-program tests (`answer-skips-held-stop`, `both-routes`) get the same error in place of the planted one.

The design states this. A choice with a recommendation "proceeds on the recommended option at once" (An ask, and your
answer getting back: Work goes on while you decide). Only "a taste call or choice that isn't provisional" holds the
send-back (A question holds the send-back). This is the same cause #3178 found for the #667, #27 and #111 suites
(`tests/acceptance/667/redraft-3178/DISPUTE.md`, PR #3249).

## What this change does

- Keeps #84's rule. `tests/acceptance/3243/` checks that a recommended choice still returns
  `provisional` at once (#3243's second criterion).
- Leaves `tests/acceptance/25/routes/` unedited. `held.test.ts` and `one-route.test.ts` run by hand
  (`scripts/lanes.mjs`, `byHand`). The other route files in that folder don't need a held stop (they pass on main, #3243's table), and they run as before.
- Runs this blind redraft in their place. Its session asks a choice with no recommended option, which the design keeps
  held until you answer. Its twins plant `answer-skips-held-stop` and `both-routes`.

## What is yours

Moving the two files to by hand is a `scripts/lanes.mjs` edit, in a commit of its own, and needs your signed approval
tag. If you would rather hold the earlier tests' line, #84's rule would have to change instead.
