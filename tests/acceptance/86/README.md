# Acceptance tests for #86: one reservation ledger for the spending budgets you approve

Written first, blind, from issue #86 (its text as of October 21, 2026: Scope, Fields, the 8 acceptance criteria, Proof and Depends on #311, #14, #318), its siblings #36, #23, #69 and #159 (read only to keep their scope out), `docs/technical-design.md` (the Lifecycles, Event, Ask, Decision and rule, Lease and Budget primitives; The done loop; What done means, fixed at the start; the env-local and resolver-decisions rows of First-party extensions that ship on by default; Rules every primitive follows; How we know version 0 works; Threats) and the base commit `c9891b3` (`origin/main`, no implementation of #86). The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft by this job.

## Run

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # once: @deepbuild/record loads @deepbuild/evidence from its dist
npx vitest run tests/acceptance/86       # from the checkout's root, with the repo's vitest.config.ts
npx tsc -p tests/acceptance/86           # type-check the tests against the surface (needs packages/budget)
```

Node 24.22 or newer; nothing else: no network, no hub, no wall clock. Every world is a real record on SQLite in its own temporary folder, with the real asks core (#318) and the ledger on it, a virtual clock and a price lookup the test holds; each is removed afterwards. The suite takes about a minute, most of it the property test's 1,000 worlds.

On the base all 3 files fail to load: `packages/budget/src/index.ts` doesn't exist. `BASE-FAILURE.txt` shows that run, the same tests against a program that does nothing (each criterion test fails at its own assertion), the runs against a sample fix kept outside this checkout (all 24 pass), and each wrong program each test was run against.

## The surface

The issue names behaviors, the Budget's fields and the outcome `BLOCKED (cause: budget, owner: you)`, but no code API for the ledger, so these tests define the smallest one they need. The tests reach the code only through:

- **`@deepbuild/budget`, a new workspace package, through its public entry `packages/budget/src/index.ts`** (below): the kernel's one ledger;
- **`@deepbuild/record`** as it is at the base: `openRecord({path, now})`, `append`, `read`, `table('asks')`, `close()`;
- **`@deepbuild/asks`** as it is at the base: `openAsks`, `tick`, `card`, `answer`, `needsYou`, and the `budget.raise` and `generation.paid` rows of `askSources()` (both authority, both defaulting to no);
- **events** the tests append as the runner would: `run.finished@1` (writer `core`, with `outcome` `passed` or `failed`); and events they read: `ask.created` (its deadline), `ask.defaulted`, `decision.applied` (writer `core`, `data.ask`), and the `asks` table's `outcome`.

```ts
// packages/budget/src/index.ts
import type { Connection, RecordStore } from '@deepbuild/record';
import type { Asks } from '@deepbuild/asks';

export type ScopeKind = 'issue' | 'resource' | 'project' | 'work';     // work: a kind of work
/** A spending budget you approve. */
export interface BudgetInput { scope: { kind: ScopeKind; ref: string }; cap_usd: number; ends: number }   // ends: ms since the epoch
/** A paid run, asking to start. `inputs` is the digest of its inputs; `resource` the key of the resource it runs on. */
export interface RunRequest { run: string; check: string; inputs: string; issue: string; resource?: string }   // run: `run:<ULID>`
export interface Reserved { budget: string; usd: number }
export type Outcome =
  | { run: string; status: 'started'; reserved: Reserved[] }                                          // its price, against every budget that covers it
  | { run: string; status: 'BLOCKED'; cause: 'budget'; owner: 'you'; budget: string; ask: string }   // the budget with no room, and its raise: one authority ask
  | { run: string; status: 'BLOCKED'; cause: 'price'; missing: string }                               // names the missing price: contains the check
  | { run: string; status: 'asked'; ask: string };                                                    // waits on an ask that reaches you, or a resolver
/** A budget as the ledger shows it. left_usd = cap_usd - reserved_usd - spent_usd. */
export interface BudgetView {
  budget: string;
  scope: { kind: ScopeKind; ref: string };
  cap_usd: number;
  ends: number;
  reserved_usd: number;                          // the sum of its reservations
  spent_usd: number;                             // the sum of its runs' cost readings
  left_usd: number;
  reservations: { run: string; usd: number }[];  // held, unpriced, until each run's cost reading lands
}
/** Every refusal the ledger makes, naming what it refuses. */
export class BudgetRefused extends Error {
  readonly run?: string;
  readonly budget?: string;
}
export interface LedgerOptions {
  record: RecordStore;
  asks: Asks;                                               // the asks core it raises its asks through
  now: () => number;                                        // the only clock it reads
  price: (run: RunRequest) => Promise<number | null>;       // the price lookup; null is a price nobody knows
}
export interface Ledger {
  /** You approve a budget, over the trusted path (the card, `app`). Returns its ID. */
  approve(connection: Connection, budget: BudgetInput): Promise<string>;
  /** A paid run asks to start: priced, then reserved against every budget that covers it, or not started. */
  request(connection: Connection, run: RunRequest): Promise<Outcome>;
  /** A resolver answers a paid run's request (an `asked` outcome's ask) for you by naming a budget. */
  resolve(connection: Connection, ask: string, answer: { decision: string; budget: string }): Promise<Outcome>;
  /** A run's cost reading lands: the run is charged and its reservation released. */
  charge(connection: Connection, run: string, usd: number): Promise<void>;
  budget(id: string): Promise<BudgetView>;
}
export function openLedger(options: LedgerOptions): Promise<Ledger>;
```

Nothing else is needed: no option, flag or export beyond these. `Connection` is the record's. The ledger keeps everything in the record: the tests open a second ledger on the same record and require it to show the same budgets and reservations. The kinds it appends are its own new published schemas (in `packages/contracts/schemas/`), which the record must accept; the tests read none of them by name, so their names and shapes are the implementer's (the sample fix used `budget.approved@1`, `budget.reserved@1` with every budget of one reservation in one event, and `budget.charged@1`). The two the tests do read are the base's: `ask.*` from the asks core and `decision.applied@1` (`{decision, ask}`), which the core appends.

### How the tests drive it

- Budgets are approved over the `app` connection with `ends` 30 days after the clock's start. A budget **covers** a run when its scope is `issue` and its `ref` is the run's `issue`, or `resource` and its `ref` is the run's `resource`. The tests approve `project` and `work` budgets only for the resolver, which names them.
- The price lookup answers from a table of prices by check. "Held open": the test turns holding on, makes all its requests, waits until the ledger has made that many lookups (each still unanswered), and then releases them one by one in the order under test, letting the ledger run between releases. A ledger that looks up one price only after deciding the last never gets all of them open, and fails naming how many it made.
- Paid runs are requested over `core` (the done gate's paid checks), or over `mcp:S1` for the agent's own live runs. Cost readings come over `core`; the resolver is `ext:resolver-decisions`; the planted extension is `ext:planted-charges`.
- Prices are whole dollars, and one cost reading is $3.50, so a ledger that sums floating-point cents still gets them exact.
- The clock starts at 2026-10-20 12:00 UTC. A deadline is reached when `now() >= deadline`; the asks core applies it at `asks.tick()`.

## The contract per criterion

1. **`#86.fb5b8d9b` Three at once, room for two.** An issue budget of $10; three $4 runs requested together (`Promise.all`): two `started`, each `reserved: [{budget, usd: 4}]`, and one `BLOCKED {cause: budget, owner: you, budget}`. The budget holds $8 in the two started runs' reservations, never past its cap; after both cost readings ($4 each) it has spent $8 and holds nothing, and the blocked run asked again ($2 left) is still BLOCKED. A second ledger on the record reads the same. The property test (below) covers "never passed" across random caps, prices and release orders.
2. **`#86.80a13633` Unknown prices; release only by the cost reading.** A run whose check has no price is `BLOCKED {cause: price}` with `missing` naming the check; the budget holds and spends nothing (never free); once the check is priced at $6 the same run reserves $6 and starts. A $4 run that started and then ended (`run.finished`, passed, the clock two hours on) still holds its $4, in this ledger and in a second one on the record; its cost reading of $3.50 then charges it and releases the reservation.
3. **`#86.54597aa8` The agent's batch asks nothing.** Five $2 live runs requested together over `mcp:S1` against a $20 issue budget all start; after their cost readings and an `asks.tick()`, the record holds no `ask.created` and Needs you is empty.
4. **`#86.3dccb0b7` No re-run of a failed run.** A $4 run started, charged, then `run.finished` `failed`. A new run on the same check and the same inputs doesn't start, holds no reservation, and its outcome names an ask that is in Needs you. A run on changed inputs starts at once. Once you answer that ask on the card with its `allow` option, a run on the failed inputs starts.
5. **`#86.40d0717c` Two budgets on one run.** A GPU budget of $5 (`resource`) and two issue budgets of $10: a $3 run on the GPU for issue A starts with `reserved` = $3 against both the GPU's budget and A's (in any order), and both show it; a $3 GPU run for issue B is `BLOCKED {cause: budget, owner: you, budget: <the GPU's>}`.
6. **`#86.020ce247` A resolver naming a budget.** Two `work` budgets, $10 and $5; three runs for an issue no budget covers, each `asked`. The test resolver answers the first ($8) naming the $10 budget: `started`, `reserved: [{that budget, 8}]`, a `decision.applied` from `core` names its ask, the `asks` row reads `decided_for_you`, and it isn't in Needs you. It answers the second ($3) naming the same budget, which has $2 left counting the reservation: `BudgetRefused` naming that budget, no `decision.applied` for its ask, the ask in Needs you, the budget unchanged. A core that checks only that the named budget exists, or that ignores reservations, applies it. The third ($3) named against the $5 budget starts, decided for you.
7. **`#86.97e5a476` A planted charge.** With one $4 run reserved and a $20 run BLOCKED, the planted extension reports a $5 charge for a run never requested and for the BLOCKED run: each `BudgetRefused` with `run` naming it; the budget's view, and a second ledger's, equal what they were before.
8. **`#86.60e70718` Held open, every order, the GPU's budget.** Three issue budgets of $10 and a GPU budget of $6; three $3 GPU runs, one per issue, with every price lookup held until all three are in, then released in each of the six orders (one test per order): two start (each reserved against its issue and the GPU) and one is `BLOCKED {cause: budget, owner: you, budget: <the GPU's>}`; the blocked run's issue budget holds nothing and has all $10 left, here and in a second ledger; the GPU's holds the two started runs, $6. A ledger that keeps the first reservation fails, naming that issue's budget. The BLOCKED outcome's `ask` is an authority ask whose `ask.created` deadline is 1 day after it was raised; at that deadline, unanswered, it takes `ask.defaulted {decision: deny}` as its only close, the budget's cap is unchanged and the next run that doesn't fit is BLOCKED again.

**The property** (`concurrent.test.ts`, fast-check, seed `0x8608`, 1,000 cases): a GPU budget and one to three issue budgets with caps of $0 to $12, one to five runs of $1 to $6 each for an issue and on the GPU or not, every lookup held and released in a generated order. In every case no budget's reserved and spent pass its cap, each budget's `reserved_usd` is the sum of its reservations, every started run reserved its price against every budget that covers it, and every other run is `BLOCKED {cause: budget}` naming a budget that covers it and had no room for its price, and holds no reservation in any budget.

## Readings where the issue leaves a choice

- **A new package.** The ledger is the kernel's Budget, so it is a core package beside the record and the asks core, which neither grows. Its state is a function of the log: what the tests check through a second ledger opened on the record.
- **Covering.** Only issue and resource budgets cover a run on their own; a run has no project or kind of work in this surface. A paid run no approved budget covers is a request that waits on an ask (`asked`): that is "a paid run's request" a resolver answers by naming a budget. The ask's source is the implementer's (the sample used `generation.paid`).
- **Two budgets, one append.** All-or-none is tested by what the ledger shows (and a second ledger reads back); how many events a reservation takes isn't, though the design says one append.
- **Counting reservations.** What's left is the cap less the reservations held and the charges spent. Whether `ends` or a run count (`runs`) also limits a budget isn't tested: the issue gives `runs` no rule, so the input leaves it out and no test runs past `ends`.
- **The price lookup** is per run request; the tests key it by check. A price of `null` is one nobody knows. The lookup is outside the decision: the design's "no await between the read and the append" is about the decision, and its test rule holds every lookup open at once, so a ledger must not hold one lookup until the last is decided.
- **BLOCKED for price** has no owner in the issue; the tests read only `cause` and `missing`.
- **The re-run's yes.** "Without a change or your yes": a change is other inputs (another digest); your yes is the `allow` option of the ask the re-run's outcome names, answered on the card. The tests accept that outcome as `asked` or as `BLOCKED` carrying an ask, so long as the run doesn't start and the ask is in Needs you.
- **The budget raise** is the ask the BLOCKED outcome names, from `budget.raise` (or any authority source). What raising it does on your yes, and to how much, isn't tested; that it takes no at its 1-day deadline and leaves the cap is.
- **Decided for you** is `decision.applied {decision, ask}` from the core, which the asks core and the `asks` table already read as `decided_for_you`. The resolver's `decision` handle is the test's own; the core doesn't check it here.
- **Refusals** throw `BudgetRefused` and append nothing the ledger counts. Whether a refusal is also recorded isn't tested.
- **Not tested here:** that an agent can't approve, raise or widen a budget (a Fields "never" no criterion repeats), the plan-window reserve (#159), env-local's resource budgets beyond the GPU case (#36), resolver-decisions' matching (#23), buying (#69), and the done gate's pricing at the definition lock.

## Criteria, tests and wrong programs

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed and the leading `- [ ] ` dropped (the command in `tests/acceptance/48/README.md`). Each test name starts with its ID. "Plant" is a wrong program in `plants.ts`, run by `plants.test.ts`; "mutant" is the sample fix with one part changed, run outside this checkout (`BASE-FAILURE.txt`).

| # | ID | Criterion (short) | Tests | Wrong programs it fails on | On the base |
|---|---|---|---|---|---|
| 1 | `#86.fb5b8d9b` | three at once, room for two: two start, third BLOCKED (budget), cap never passed | `concurrent`: *three paid runs started at once…*; the property | mutant: decision without the lock (all three start); do-nothing program | FAIL (no ledger) |
| 2 | `#86.80a13633` | no known price BLOCKED naming it; released only on the cost reading | `ledger`: two; `plants`: two | plants: unknown price counted as free; released at run end; mutants: the same two | FAIL (no ledger) |
| 3 | `#86.54597aa8` | the agent's batch inside the budget asks nothing | `ledger`: *an agent's own batch…*; `plants`: one | plant and mutant: an ask for every paid run | FAIL (no ledger) |
| 4 | `#86.3dccb0b7` | a failed run never re-run on the same inputs without a change or your yes | `ledger`: *a failed paid run…*; `plants`: one | plant: failures never read; mutants: re-runs failed inputs; ignores your yes | FAIL (no ledger) |
| 5 | `#86.40d0717c` | $3 against the GPU's and the issue's; second GPU run BLOCKED naming the GPU's budget | `ledger`: *a $3 GPU run…*; `plants`: one | plant and mutant: covered by the issue's budget only | FAIL (no ledger) |
| 6 | `#86.020ce247` | resolver naming a budget: no room refused and asked; room reserved, decided for you | `ledger`: *a resolver naming a budget…*; `plants`: one | plant and mutant: checks only that the budget exists; mutants: room ignoring reservations; not logged as decided | FAIL (no ledger) |
| 7 | `#86.97e5a476` | planted charge for a run that never reserved refused naming it; ledger unchanged | `ledger`: *a planted extension…*; `plants`: one | plant and mutant: any charge taken | FAIL (no ledger) |
| 8 | `#86.60e70718` | held open, every order; GPU-blocked run leaves its issue whole; keeps-first fails naming it; raise takes no at 1 day | `concurrent`: six orders, *an unanswered budget raise…*, the property; `plants`: one | plant and mutant: keeps the first reservation; mutants: a raise's default taken as yes; a 2-day deadline; the lookup held under the lock | FAIL (no ledger) |

## Files

- `data.ts`: the clock's start, ULIDs, run and decision handles, input digests, the issues, the GPU and the checks.
- `helpers.ts`: a world (virtual clock, record in a temporary folder, the asks core, the ledger, the held price lookup, a second ledger on the same record), connections, `refused`.
- `scenarios.ts`: every criterion's scenario, shared by the criterion tests and `plants.test.ts`.
- `plants.ts`: the wrong programs the issue names, each the real program with one part wrong.
- `concurrent.test.ts` (criteria 1 and 8, and the property), `ledger.test.ts` (2 to 7), `plants.test.ts`.
- `tsconfig.json`: type-checks the suite under the root's strict options with `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the base run, the do-nothing run, the sample fix and the wrong programs.
