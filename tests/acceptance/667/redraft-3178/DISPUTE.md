# Dispute (#3178): the earlier tests wait on a choice that the design says goes on at once

This redraft, and `tests/acceptance/27/redraft-3178/`, `tests/acceptance/27/outcomes-redraft-3178/` and
`tests/acceptance/111/redraft-3178/`, exist because of this dispute (#3178). This file and the two short ones beside those redrafts are the work's, not the blind jobs': each job
wrote the other files of its folder from its issue, `docs/technical-design.md` and base `37dd3c0c8`, and never saw
these, the dispute or the reason a redraft was asked for.

## What fails

On main, these earlier tests raise a choice with a recommended option through `deep_ask` and expect the call to wait
until the hub files the ask (or expect the session's stop to be held while it is open):

| File | Tests | How it fails on main `37dd3c0c8` |
|---|---|---|
| `tests/acceptance/667/fold.test.ts` | AC5 ×2 | `BLOCKED: deep_ask … ended before the hub filed its ask` |
| `tests/acceptance/667/plants.test.ts` | AC4, AC5 | the same BLOCKED, where the planted failure is expected |
| `tests/acceptance/667/redraft-1463/raised.test.ts` | AC1, AC2 | the same BLOCKED |
| `tests/acceptance/27/repeat.test.ts` | AC2 | session A's `deep_ask` comes back provisional, not with your answer (the test's fault); session B's repeat, once your answer is saved, is told the recommendation too (the hub's fault, below) |
| `tests/acceptance/27/waits.test.ts` | AC4, the stop hold; the check run | the stop is held 114–122 ms against more than 5,000; the check run never starts within 60 s, which is not the question: its repo isn't trusted (#322) and its `sh -c` check can't be traced (the redraft's README) |
| `tests/acceptance/27-redraft-2073/waits.test.ts` | AC4, the stop hold | the stop goes through in 246 ms against more than 5,000 (its own BASE-RESULTS.txt; not named in #3178): it asks through `../27/helpers.ts` with blue recommended |
| `tests/acceptance/27/outcomes-redraft/outcomes.test.ts` | AC4, the stop held while a subagent runs | `BLOCKED: … stop went through before the subagent ran on` on every run at loads 50–280 (not load: its stand-in asks through `../helpers.ts` with blue recommended); not named in #3178, but it carries the 27/waits row's ID |
| `tests/acceptance/111/revive.test.ts` | the choice you answered | `the call ended before it filed anything`, timing-dependent: it passed 3/3 in one run and failed 1/3 in the next on the same copy |

The hub answers `{"status":"provisional","answer":"<recommended>"}` at once. That is #84's rule (`packages/hub/src/mcp-operations.ts`, `provisional`; #1332 exempts sessions a work run started), and it is the design's: "A taste call or a choice between options proceeds on the recommended option at once, marked as undoable, and only steps that leave the machine wait for your answer" (An ask, and your answer getting back: Work goes on while you decide), and "a taste call or choice that isn't provisional" is the only kind that holds the send-back (A question holds the send-back). The design held that sentence before every one of these suites was written (it is at `d122341ce`, `eed2f6b68` and `8bff1d36f`).

## Which change

A/B in one fresh GitHub clone, macOS, Node 24.22, each file alone:

| File | `22c47dd48` (before #84's merge) | `58078c057` (#84's merge, PR 1423) |
|---|---|---|
| 667/fold.test.ts | 2 passed | 2 failed (BLOCKED) |
| 667/plants.test.ts | 3 passed | 2 failed, 1 passed |
| 27/repeat.test.ts | 1 passed | 1 failed |
| 27/waits.test.ts | 4 passed | 1 failed, 3 passed (the stop hold) |
| 111/revive.test.ts | 3 passed | 1 failed, 2 passed |

`667/redraft-1463/raised.test.ts` was added after #84, at `d8d4af485`, and fails there with the same BLOCKED: it never
passed. `27/desktop-redraft/desktop.test.ts`, also named in #3178, fails the same way before and after #84 ("must read
delivered once the prompt carried it"): that is #906's dispute, it has run by hand since `05657dd84`, and its blind
redraft `tests/acceptance/27/desktop-redraft-2/` runs in its place and passes on main. Likewise #667's AC3–AC5 already
had `tests/acceptance/667/redraft-2047/`, which reads its asks from the record and passes on main.

The 27/waits check run passed at `58078c057` and fails on main for the reasons above since #2073, which has deep_run ask
the project's trust and run on the claim's commit; `27/waits.test.ts` has run by hand since then, with
`tests/acceptance/27-redraft-2073/waits.test.ts` in its place (its REDRAFT.md). That redraft asks through the same
recommended choice, so its stop hold fails on main too; `27/redraft-3178/waits.test.ts` covers its ask default, check run
and agent command as well, and runs in its place.

So in each of these files the test, not the hub, disagrees with the design, and #3178's second criterion keeps #84's
rule. Per AGENTS.md (Proof) they are not edited: they run by hand in `scripts/lanes.mjs`, and these redrafts run in
their place.

One thing the hub did get wrong, found through 27/repeat's session B: when the asks core closed a recommended choice
from a saved decision as it was raised (`decision.applied`, decided for you), `deep_ask` still replied provisional with
the recommended option, so the agent went on against your answer. The design's resolvers answer first ("try saved
decisions and rules … answered, logged as decided for you", then deliver). The change fixes that in
`packages/hub/src/mcp-operations.ts`, with `packages/hub/test/provisional-decided.test.ts`, which failed on the merge
base with `provisional` / `blue` while `decision.applied` had closed the ask with `green`; the #27 redraft's second
repeat test fails on the merge base the same way. 27/repeat.test.ts still can't pass: its session A expects the first,
unanswered ask to wait. #3178's second criterion says a recommended choice returns `provisional` unless the fix changes
#84's rule by an approved proposal; this fix doesn't change that rule, it keeps the design's order (saved decisions and
rules answer first, and only an ask they leave open goes on provisional), so a fresh choice still returns `provisional`.
If you read the criterion as covering a repeat your saved decision answers, this fix needs your approval.

## How the redrafts were made

One fresh run of each suite's blind job, in a fresh GitHub clone at `37dd3c0c8`, given only its issue, the design, the
base and the criteria (with their IDs) to redraft; never told why. Later additions to a brief came from review: the
earlier suite's IDs to carry beside the computed ones; for #27, the check run, the agent command and a repeat that
carries a recommendation; for #111, the earlier file's other two tests, so each redraft covers the whole of what it
replaces; and the removal of tests that duplicated redraft-2047 and desktop-redraft-2. #667's: AC1, AC2. #27's: AC2,
AC4 (twice: the ask, hold, check run and agent command in `27/redraft-3178/`; the Oct 9 cases in
`27/outcomes-redraft-3178/`). #111's: `#111.ddf55f68`. Each job's README and BASE-RESULTS.txt hold its runs at the base and on its wrong
programs.

## What is decided, and what is yours

Moving the earlier files to by hand is a `scripts/lanes.mjs` edit, so it lands in a commit of its own and needs your
signed approval tag. The rest is additions and the hub fix above. This is the dispute that comes to you (design:
Dogfooding): take the redrafts' reading, that a recommended choice goes on at once and the tests read its ask from the
record or ask a question with no recommendation; or hold the earlier tests' line, which would need #84's rule changed.
