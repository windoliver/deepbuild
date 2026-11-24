# Issue #25: two criteria, redrafted blind

Written from issue #25, `docs/technical-design.md` and the base commit `118ec119f` only.

## Criteria to tests

| Criterion | ID | Test | Wrong program (twin) |
|---|---|---|---|
| AC1 A held stop continues with the answer | `#25.0215da31` | `held.test.ts`: an answer given while the stop is held comes back as that Stop's `decision: block`, and the turn goes on with it | `answer-skips-held-stop` |
| AC4 An answer that lands while the session's stop is held and its waiter is alive goes back through the Stop hold only, the waiter exits without waking, and the transcript shows the answer's ID once; a host that sends it by both routes fails this test, naming the routes | `#25.1eae4ef9` | `one-route.test.ts`: with the stop held and the waiter alive, the answer goes back by the Stop hold only, the waiter exits without waking, and the transcript shows its ID once | `both-routes` |

Both tests run a real hub (`deep hub run`), `deep setup` into a temporary home, and the Claude Code stand-in of
`tests/acceptance/25/routes/fixtures/claude.mjs`, which runs every entry setup wrote into Claude Code's user
settings (deep-hook in the foreground, the waiter in the background) and the session's own `deep mcp`. You answer
with `deep inbox answer`. The infrastructure is imported from `../25/routes/helpers.ts`; the ask is this folder's own
(`asking.ts`).

## The ask

The agent calls `deep_ask` with `kind: choice`, two options and `recommended: null` (the tool's other fields null).

The design says which asks go on at once and which leave the session waiting on you:

- "A taste call or a choice between options proceeds on the recommended option at once, marked as undoable" (An ask,
  and your answer getting back: Work goes on while you decide), and an ask's shape: "With a provisional ask, work goes
  on with the recommended option".
- "A stop that ends on a question that becomes a step only you can take, an exception, or a taste call or choice that
  isn't provisional leaves the agent waiting on you" (An agent says it's done: A question holds the send-back).

A choice with no recommended option has nothing to go on with, so it isn't provisional: the agent waits on you, and
its stop is the one the issue's Scope holds ("Stop hold: `decision: block` with the answer as the reason, only when
the agent left a question"). Each test first checks the ask is recorded not provisional and deep_ask didn't tell the
agent to go on.

A stop is shown held by events, never by a wait: the hub's record of the session's `agent.stop` and the waiter Claude
Code started at that Stop running, with the Stop hook still unanswered. Waits are bounded by `waitFor` deadlines.

## Twins

Each twin is a whole-file copy of `packages/hub/src/plant.ts` at the base with one line changed: `plantOf` returns
the planted program when `DEEP_HUB_PLANT` is unset, so the hub runs that wrong program always.

- `twins/answer-skips-held-stop`: the hub lets the held stop go when the answer comes, leaving the answer to the
  waiter. AC1 fails at its assertion that the Stop got `decision: block` carrying the answer.
- `twins/both-routes`: the hub sends the answer through the Stop hold and also hands it to the waiter, which exits 2.
  AC4 fails at its assertion naming the routes it went by ("the Stop hold (decision: block) and the waiter (exit 2 …)").

## Runs

`BASE-RESULTS.txt` holds the runs at the base and on each twin, with the commands and the machine's load.
