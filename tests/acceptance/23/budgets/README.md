# Acceptance tests for #23 (`budgets/`): a paid run's request answered from the budget you approved

Written first, blind, from issue #23 (its text as of October 28, 2026: the Scope line "Answers an agent's request to start a paid or live run by naming the approved budget that covers it, which the core checks against its ledger (#86), saying how much is left", and the two criteria below), `docs/technical-design.md` (the resolver-decisions row of First-party extensions that ship on by default; Budget and Decision and rule in The contract; "A resolver answers an ask for you only by naming what covers it"), the ledger at the base commit `debda22` (`packages/budget`, #86), the asks core (`packages/asks`), the record, `tests/acceptance/86` (criterion 6, a test resolver naming a budget) and the shared surface in `../README.md`. There is no implementation of #23 at the base. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft by this job.

## Run

```sh
npx vitest run tests/acceptance/23/budgets   # from the checkout's root, after npm ci and npm run build --workspaces
npx tsc -p tests/acceptance/23               # type-check against the surface
```

About a second. No network, no hub, no model, no wall clock. Each world is the match suite's world (`../match/helpers.ts`: a real record on SQLite in a temporary folder, the real asks core with a virtual clock, sessions started in repos) with the real ledger (#86) opened on the same record and asks core, and resolver-decisions opened with that ledger and registered with the asks core under `resolver-decisions`. Prices come from a table the test holds.

## What #86 already proved, and what this folder adds

#86's criterion 6 proved the core's half with a test resolver: `ledger.resolve` over `ext:resolver-decisions` reserves against a budget with room, logs `decision.applied`, and refuses (`BudgetRefused`) a budget without room counting reservations. These tests don't repeat that. They prove #23's half with resolver-decisions itself: it chooses the budget, the per-run approval request never reaches you when that budget has room, the agent is told how much is left, and when the core refuses, the ask reaches you naming the budget.

## Surface additions

On top of the shared surface in `../README.md` and the ledger as it is at the base:

```ts
// packages/resolver-decisions/src/index.ts: the shared signature, with the ledger (#86)
import type { Ledger } from '@deepbuild/budget';
export function resolverDecisions(options: { record: RecordStore; ledger?: Ledger }): Resolver;

// packages/asks/src/index.ts
export interface Delivery {
  // …as in ../README.md, and:
  /** For a paid run's request answered by naming a budget: that budget and what's left in it once this run's price
   *  is reserved, counting runs reserved and not yet charged. null on every other delivery. */
  budget: { budget: string; left_usd: number } | null;
}
export interface Card {
  // …as in ../README.md, and:
  /** On a paid run's request whose named budget the core refused: that budget and what's left in it, counting runs
   *  reserved and not yet charged, which the run's price doesn't fit. null on every other card. */
  budget: { budget: string; left_usd: number } | null;
}
```

How the tests drive it:

- **Which budget covers a run.** A `project` budget whose `ref` is a repo's project name (`repoA`, as the session's `session.start` connection names it) covers the paid runs agents ask for in sessions of that repo. Budgets are approved over `app` with `ledger.approve`, ending 30 days after the clock's start. Every run is for an issue no issue or resource budget covers, so the ledger's own covering never applies and each run is a per-run approval request.
- **The request.** The agent asks over its MCP connection (`mcp:S1`, bound to its session): `ledger.request(connection, { run, check, inputs, issue })`. The request adds exactly one ask to the inbox, in that session: the per-run approval request. Its outcome is either `started` (with `reserved` naming the budget) or `asked` naming that ask; the tests accept both.
- **Answered.** resolver-decisions answers only through `ledger.resolve(connection 'ext:resolver-decisions', ask, { decision, budget })`, the core's check of what's left. Which decision it names is the implementer's; the tests read only that it is a `decision:` handle the automatic answer cites.
- **Decided for you** is the match suite's `decidedForYou`: the ask closes as `decided_for_you` with one `decision.applied` from the core, is never shown (no `ask.batched` names it), its allow option is handed to the agent once with `because`, and its inbox row cites the decision. Here, also: the delivery's `budget` names the budget and what's left, and the ledger holds the run's reservation.
- **Reaches you** is the match suite's `reachesYou`: open, in Needs you, nothing applied or handed to the agent.

## Readings where the issue leaves a choice

- **"Saying how much is left"** is said to the agent, in the structured `budget` field of the delivery that answers its request: the dollars left in the named budget after this run's reservation, counting every run reserved and not yet charged and every cost reading. A field, not the delivery's words, so the test doesn't parse prose.
- **"The ask reaches you naming that budget"** is the card's `budget` field: the budget the resolver named and what's left in it. A run in a repo with no budget reaches you with `budget` null.
- **"Without reaching you"** is never shown, as in the match suite. Since an ask with no batches declared shows when it is raised, the answer has to land while the ledger raises the ask (the asks core consults its resolvers then). The base ledger raises it inside its own lock and appends its `spend.asked` after, so the implementer has to let `ledger.resolve` answer the ask being raised; how is theirs.
- **A project is a repo.** The design lists `project` among a budget's scopes and the resolver row says "within a spending budget you approved". The tests use the project budget for the repo the request was asked in. `work` budgets (a kind of work) are not tested: nothing in a run's request names its kind of work.
- **Inside vs outside.** The criterion says "inside an approved budget"; the Scope says "the approved budget that covers it". So a run asked in a repo with no approved budget reaches you, even when another repo's budget has room for it. The base ledger checks only that the named budget is in force, not that it covers the run, so this half rests on resolver-decisions (or a core that also checks coverage; the test accepts either, as the plant's two failure messages show).
- **The resolver's own count.** A resolver that counts only what was charged both says that count to the agent and lets a run through on it. Its plant does both, so it fails at whichever comes first: in this scenario, the first answer already says $12 left of a $12 budget holding a $2 reservation, where the ledger has $10; on a program that reads what's left only from the core, it fails at the $4 run let through. Both messages name the budget.
- **The issue and the design agree** on this part. One note: the design's resolver row says "Every firing shows in Needs you with an overrule", while the criterion says the request is "answered without reaching you". The tests read the criterion: never shown as a question; the overrule belongs to the decided-for-you log (the match suite's `InboxRow.decision`), not to Needs you.
- **Not tested here:** a resolver choosing among several budgets that cover one run; `work` budgets; the agent's own batch inside an issue budget (#86's 54597aa8 already covers asking nothing there); raising a budget.

## Criteria, tests and wrong programs

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed and the leading `- [ ] ` dropped (the command in `tests/acceptance/48/README.md`). Each test name starts with its ID. A plant is a wrong program in `plants.ts`, the real program with one part wrong, run by `plants.test.ts`.

| ID | Criterion (short) | Tests | Wrong programs it fails on | On the base |
|---|---|---|---|---|
| `#23.67403f66` | a per-run approval request inside an approved budget is answered without reaching you, logged as decided for you | `budgets`: one ($4 then $5 against $10 in repoA, each decided for you, saying $6 then $1 left; $1 in repoB reaches you, no budget named); `plants`: one | plant `repoIgnored`: never reads which repo a run was asked in (answers repoB's run from repoA's budget, naming the decision); do-nothing (nothing decided) | fails to load |
| `#23.d3776517` | a request that doesn't fit what's left, counting runs reserved and not yet charged, is refused by the core and reaches you naming the budget; a resolver counting only charges fails | `budgets`: one ($12 budget, $2 charged, $7 reserved and unpriced: a $4 run reaches you naming the budget and $3 left, the budget unchanged; after the $7 run's $5 cost reading, the next $4 run is decided for you, $1 left); `plants`: one | plant `chargedOnly`: a resolver counting only what was charged (says $12 left where $10 is, or lets the $4 run through, naming the decision); do-nothing (nothing decided) | fails to load |

## Files

- `helpers.ts`: the budget world on top of `../match/helpers.ts`: the ledger, resolver-decisions opened with it, the price table, `approve`, `paid`, `charge`, `view`.
- `scenarios.ts`: each criterion's scenario, shared by `budgets.test.ts` and `plants.test.ts`.
- `plants.ts`, `plants.test.ts`: the wrong programs.
- `budgets.test.ts`: the criterion tests.
- `BASE-FAILURE.txt`: the base run, the do-nothing program, the plants and the sample fix.
