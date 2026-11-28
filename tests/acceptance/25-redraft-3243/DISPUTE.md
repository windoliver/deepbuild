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
  (`scripts/lanes.mjs`, `byHand`). The other route files in that folder don't need a held stop, and they run as
  before. Of those, `wake.test.ts` and `twenty-minutes.test.ts` had intermittent 30 s waiter timeouts at loads of
  110–150 (#3243's table), which aren't shown to have this cause.
- Runs this blind redraft in their place, alone (`scripts/lanes.mjs`). Its session asks a choice with no recommended
  option, which the design keeps held until you answer. Its twins plant `answer-skips-held-stop` and `both-routes`.
  The blind job also wrote a `lane.json` here; the lanes read that file only in a numbered suite folder, so the work
  dropped it and lists the folder in `alone` instead.

## A starved machine (a second round with the blind job)

On the Spark at load 150–300, the redraft's tests sometimes failed on a correct hub. The Stop went through unheld,
and deep-hook's stderr said `spooled <id>, but its sync didn't finish within the hook's 50 ms`. That is deep-hook
failing open as the design asks: "A hub that takes a request and doesn't acknowledge it within 50 ms of the hook's
start counts as down for that call". So a FAIL there says nothing about the hold. The work gave a fresh blind job that
fact and the kept message, and nothing else of this change. It revised the folder, so a try with deep-hook's own
fail-open evidence is made again and reads INCONCLUSIVE after its bounded tries (README: A starved machine), as #3295
did for deep-hook's late-close test. A Stop that went through unheld without that evidence still fails.

## What is yours

Moving the two files to by hand, and running this folder alone, is a `scripts/lanes.mjs` edit, in a commit of its own,
and needs your signed approval tag. If you would rather hold the earlier tests' line, #84's rule would have to change instead.
