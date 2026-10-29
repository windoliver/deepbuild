# Acceptance tests for #69: plans before acting, so every yes with authority shows the steps, effects, undo and cost

Written first and blind, from three sources:

- Issue #69 as of 2026-10-29T05:23:28Z: its Scope, the 7 acceptance criteria, Proof, and Depends on #318, #321, #34 and #86.
- `docs/technical-design.md`: Plans before acting; the Lifecycles, Event, Ask, Decision and rule, Evidence, Budget, and Attempt and plan primitives; An ask, and your answer getting back (Every ask ends, batches); Threats (Approvals that drift); Privacy; Every task carries its own budgets; the reference Macs.
- `docs/canvas-primitives.md` (the event catalogue rows for `ask.*`, `plan.proposed`, `spend.*` and `evidence.put`; the `plans` projection; the Question card) and the base commit `5a6d09a4` (`origin/main`, no implementation of #69).

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft by this job.

## Run

```sh
npm ci                                   # once, if node_modules is missing
npx vitest run tests/acceptance/69       # from the checkout's root, with the repo's vitest.config.ts
npx tsc -p tests/acceptance/69           # type-check the tests against the surface (needs packages/buying)
```

You need Node 24.22 or newer and `git` (the perf-lane test reads the merge base). There is no network, no hub socket, no model and no wall clock, except in the timing test. Every world is a real record on SQLite in its own temporary folder, with:

- an evidence store beside it;
- the ask settings setup drafts (`draftAskSettings`) in a temporary home;
- the real asks core, and for buying, the real #86 ledger and the buying module;
- a virtual clock.

Two things are mocked, both boundaries DeepBuild doesn't own: the target a run acts on (a list the test reads) and the payment processor. Each world is removed afterwards. The suite takes about 25 s, 15 s of it the slow-preview plant.

On the base every criterion test fails (`BASE-FAILURE.txt`):

- `plan.test.ts` and `budgets.test.ts` fail at their assertions or on a missing surface.
- `buying.test.ts` and `plants.test.ts` fail to load because `packages/buying` doesn't exist.

## The surface

The issue names behaviors, not a code API. These tests use the base's surfaces where they exist and name new ones only where a criterion needs one. They reach the code only through these entries:

- **`@deepbuild/asks`, through `packages/asks/src/index.ts`, changed as below.** `raise`, `answer`, `card`, `inbox`, `tick`, `authorized`, `draftAskSettings`, `askSources`, `AskRefused` and `Card` stay as they are at the base.
- **`@deepbuild/buying`, a new workspace package, through `packages/buying/src/index.ts`.** This is buying, which the issue puts with the money extensions.
- **`@deepbuild/budget` as it is at the base (#86):** `openLedger`, `approve`, `budget(id)`.
- **`@deepbuild/record` as it is at the base:** `openRecord({path, now, evidence})`, `read`, `sync`, `close`, `toJson`.
- **`@deepbuild/evidence` as it is at the base:** `openEvidenceStore({root, now})` and `read(sha256)`. The tests also read its `records.jsonl` journal, to read back every file it holds.
- **Events the tests read, all already in the catalogue:** `ask.created`, `ask.batched` (`data.batch`, `data.asks[].ask`), `plan.proposed` (`data.ask`, `data.steps`) and `ask.defaulted` (`data.decision`). They also scan every event for the card number.
- **The perf lane:** a task in `benchmarks/budgets.json` (below).

```ts
// packages/asks/src/index.ts: what changes
export interface PlanStep { does: string; changes: string[]; undo: string | null; public: boolean; cost: number }
//   undo: null is a step with no undo. The core marks it "can't undo" in the plan it records and shows.
export type StepCheck = { run: true } | { run: false; ask: string };
/** A batch as its card shows it: every step of every plan in it, each with its switch. */
export interface BatchCard { batch: string; steps: { ask: string; step: number; does: string; undo: string; on: boolean }[] }
export interface Asks {
  // ...everything the base has, and:
  /** raise(connection, source, ask, plan?): an authority ask with no plan, or a plan of no steps, is refused: AskRefused, field 'plan'. */
  /** Before a run takes a step of an authority ask's plan: whether it may. When it may not, the ask it waits on. */
  beforeStep(ask: string, step: PlanStep): Promise<StepCheck>;
  /** The batch an ask.batched event names (`data.batch`), with each step's switch as it starts. */
  batch(batch: string): Promise<BatchCard>;
  /** Your yes to a batch, on the trusted path: each ask's plan, bound to your click, with the switches you turned. */
  approveBatch(connection: Connection, batch: string, input: { token: string; switches: { ask: string; step: number; on: boolean }[] }): Promise<void>;
}
```

```ts
// packages/buying/src/index.ts (new)
import type { Connection, RecordStore } from '@deepbuild/record';
import type { Asks } from '@deepbuild/asks';
import type { Ledger } from '@deepbuild/budget';

export interface PurchaseInput {
  purchase: string;        // `run:<ULID>`: a purchase is named as a paid run is
  what: string;            // what it buys
  seller: string;          // the seller, by host
  usd: number;             // its price
  budget: string;          // the budget you approved (#86) that it reserves against
  refund: string | null;   // its undo: how the seller refunds or cancels it; null where the seller allows none
}
export type Bought =
  | { purchase: string; status: 'reserved' }                   // its price reserved; payment is a task for you
  | { purchase: string; status: 'paid'; receipt: string }      // a card rule paid it; the receipt kept as evidence, `ev:<sha256>`
  | { purchase: string; status: 'asked'; ask: string };        // past what's left: stopped; an authority ask shows it as a plan with its price
/** The payment processor, outside DeepBuild: it holds the card and charges it under a card rule. */
export interface Processor {
  charge(request: { card: string; seller: string; usd: number; purchase: string }): Promise<{ receipt: Uint8Array; usd: number }>;
}
export interface BuyingOptions { record: RecordStore; asks: Asks; ledger: Ledger; now: () => number; processor: Processor }
export interface Buying {
  /** A card rule you set on the trusted path: purchases from `seller` up to `max_usd` are paid with `card`, the processor's reference to a card it holds. Its ID. */
  cardRule(connection: Connection, rule: { seller: string; max_usd: number; card: string }): Promise<string>;
  buy(connection: Connection, purchase: PurchaseInput): Promise<Bought>;
  /** A purchase's receipt lands: kept as evidence, its amount charged against the budget and its reservation released. Its handle, `ev:<sha256>`. */
  receipt(connection: Connection, purchase: string, receipt: { bytes: Uint8Array; usd: number }): Promise<string>;
}
export class BuyingRefused extends Error { readonly field?: string; readonly purchase?: string }
export function openBuying(options: BuyingOptions): Promise<Buying>;
```

Nothing else is needed: no other option, flag or export. The buying module gets no evidence store of its own. The record it's given was opened with one, and `record.keep` is how the base keeps a file as evidence.

**The perf lane.** The implementer adds a task `plan-preview` to `benchmarks/budgets.json`, as #23, #24 and #319 did:

- its command drafts one plan's preview once against a temporary root and exits 0;
- `margin: 0.5`, with empty `limits`;
- an `initialReason` naming #69.

The 2 s limit stays in the vitest test, since a command's p50 includes Node's start. Once a merge base has the task, the lane compares p50 and peak memory with it.

### How the tests drive it

- **The clock** starts at 2026-10-29 15:00 UTC. Setup's drafted settings batch asks at 00:00, 08:00 and 16:00 UTC, so an ask raised at the start shows in the 16:00 batch. `w.at(ms)` sets the clock and calls `asks.tick()`.
- **Authority asks** are the fixture asks of `ask.sources@1`'s own rows, each with a deadline a day out and a key of its own. They are raised over `core` for session `S1`, with options `approve` (allow) and `decline` (deny), and answered on the card (`app`) with the allow option, the plan's hash and a click token.
- **A run** is the test's loop: before each step it calls `beforeStep(ask, step)` with the same step object the plan was raised with. It takes the step on the target only on `{run: true}`, and stops at the first `{run: false}`.
- **Buying.** Budgets are approved on the card with scope `{kind: 'work', ref}` and `ends` 30 days out. Purchases come from an agent (`mcp:S1`); receipts and card rules come from you (`app`).
- **The processor** records every charge it's asked to make. It answers with a text receipt that prints the card number whole, as some do.
- **The card number** is `4000 0566 5566 5556`, a test number that passes the Luhn check. It's written three ways: run together, with spaces and with dashes. A text "holds" it when it shows up after spaces and dashes are taken out.

## The contract per criterion

1. **`#69.9eb13dee` No plan, no ask.**
   - For every row of `ask.sources@1` whose kind is authority, `raise` from `core` without a plan is refused (`AskRefused`, `field` ending in `plan`), and no `ask.created` is appended.
   - The same holds for an agent's own authority ask (options `none` and `deny`), and for a plan with no steps.
   - The same ask with its plan is created, and its card shows the plan's steps.
2. **`#69.f54debdc` Held to the plan your yes approved.** An `effect.delete` ask plans the deletion of branches `old-ui` and `old-api`.
   - Before your yes, `beforeStep` on its first step doesn't run.
   - After your yes, the run takes both steps. When it adds a third, deleting `release-1.3`, it stops before it: the target never sees that step.
   - `beforeStep` names a new ask, not the one you approved. It is an authority ask, unanswered. Its plan contains the added step, and its hash differs from the approved plan's.
   - Trying the same step again names the same ask, and it is the only open authority ask: asked once, per invariant 4.
   - After your yes to that ask, `beforeStep(newAsk, step)` runs the step.
3. **`#69.3f9c3f3d` "Can't undo", and no by default.**
   - A plan of `[delete branch old-ui (with its undo), empty bucket logs-2025 (undo: null)]`: the card's plan and the `plan.proposed` event both show the second step's undo as exactly `can't undo`. The first keeps its own undo.
   - A second ask, for a bucket with no undo, is raised with the approving option named as its default. The core may refuse it at raise, naming `default`; it is then raised with `decline`.
   - Both asks are shown at 16:00 and left unanswered. At their deadline each has exactly one closing event, `ask.defaulted`, with `decision: deny`, and `beforeStep` on its irreversible step doesn't run.
4. **`#69.06d40ef2` No card number, stored or seen.**
   - A card rule given the number, in any of the three forms, is refused (`BuyingRefused`, `field: 'card'`).
   - A rule naming the processor's reference (`pm_…`) is set. A $12 purchase from its seller is `paid`, and the processor is asked to charge exactly `[reference, seller, 12]`.
   - The receipt kept as evidence still reads `Total: $12.00` and doesn't hold the number.
   - An agent writes the number into a purchase's `what`. That is refused with `BuyingRefused` or taken without it.
   - Afterwards nothing holds the number:
     - every file under the world's folder (the record, its WAL, the evidence store, settings and anything else written there);
     - every event, as JSON;
     - every evidence file, read back through the store;
     - every delivery to the agent.
5. **`#69.d8443973` Reserved purchases count.** $100 is approved for office supplies.
   - A $60 purchase is `reserved`, and its payment is a task for you, so it stays unpriced.
   - A second $60 purchase is `asked`. Its ask is an authority ask, unanswered, whose plan shows a step costing 60.
   - The budget then reads reserved $60, spent $0, left $40, and the processor was asked for nothing.
   - The first purchase's receipt lands from you:
     - its handle names the SHA-256 of the receipt's bytes, and the evidence store holds those bytes exactly (this receipt holds no card number);
     - an event in the record cites that hash;
     - the budget reads reserved $0, spent $60, left $40.
6. **`#69.275c8f18` Switched off in a batch.**
   - Ask A plans `[delete branch old-ui, empty bucket logs-2025 (no undo)]` and ask B plans `[post release notes]`. Both show in one batch at 16:00.
   - The batch card shows the bucket step marked `can't undo` and switched off, and the other two switched on.
   - Approving the batch with no switch turned runs the branch and the post. The bucket step doesn't run.
   - In the next batch (00:00), ask C plans to drop two tables, neither with an undo. Both start switched off.
   - Approving with only the first one's switch on runs that drop. The other, whose own switch stayed off, doesn't run.
7. **`#69.eb8b7be8` Under 2 s.**
   - The perf lane has `plan-preview`, as above. It is valid against the merge base's budgets by `scripts/benchmark.mjs`'s `validateBudgets`, and its command runs to exit 0.
   - One preview is drafted: an `effect.delete` ask raised with a 500-step plan whose last step has no undo, until `card()` shows all 500 steps with the last marked `can't undo`.
   - Each run drafts one such preview in under 2 s. Five runs are timed after a warm-up and judged by the design's rule (`timing.ts`, as #23 and #319 do).
   - Off a reference Mac, on battery, with Low Power Mode on, a thermal warning or a load average above the core count, the readings print and the test skips as INCONCLUSIVE. It never passes by skipping.

## Readings where the issue leaves a choice

- **Where buying lives.** "Buying, with the money extensions" puts it outside the core: a package of its own over the asks core, the #86 ledger and the record. The core never imports it.
- **"Without a plan"** means no plan given, or a plan with no steps, since a plan shows "the exact steps". Steps missing a field are already refused by `plan.proposed@1` at the base.
- **"No undo"** is `undo: null` in the input. The core, not the raiser, writes the mark `can't undo`, and that exact text is what the plan records and the card shows. Treating an empty string the same way is the implementer's call; it isn't tested.
- **"Still defaults to no."** Authority asks already default to no at the base. The test closes the gap where a raiser names an approving default: refusing that at raise and defaulting to no are both accepted.
- **A step "outside" the plan** is a step not equal, field by field after the mark, to a step of the plan your yes approved. In a batch, a step whose switch you left off is outside too. Whether repeating an approved step counts as adding one isn't tested.
- **"Asks again"** is a new authority ask whose plan shows the added step. Whether that plan also repeats the approved steps is the implementer's call. Its source row and wording aren't tested.
- **The check is the core's.** `beforeStep` is the gate a run passes before each step, as PreToolUse does for a tool call (#321). The tests play the run themselves; wiring it into the hook is #321's and #34's.
- **A batch** is what one `ask.batched` event shows. Its switches are per step. The approve button's counts (how many steps it runs and how many can't be undone) are in the design but not in the criterion, so they're left out of `BatchCard`.
- **The purchase's budget** is named by the purchase. The design puts purchases in "a budget you approved for a project or a kind of work", and the #86 ledger only lets those be named, so the tests use a `work` budget.
- **Within the budget, no ask; past it, one.** A purchase that fits only reserves, and its payment is a task for you. The tests don't check that task's shape, since no criterion names it.
- **"Unpriced"** means reserved, with no receipt yet. The receipt's amount is the purchase's cost reading.
- **"Kept as evidence"** means the evidence store holds the receipt's bytes, by SHA-256, and an event in the record cites the hash. A receipt that prints the card number is kept without it, but the rest of it is kept. The last four digits may stay.
- **"Never sees".** The tests can see only what DeepBuild accepts and keeps. So:
  - a card rule takes a reference, never a number;
  - nothing under the state folder holds the number, in any of the three forms;
  - nothing is delivered to an agent with it.
- **"Drafted"** means from `raise` to the card showing the whole plan. With no model in the path, "model calls excluded" holds by construction. A target's dry run isn't part of the timed preview, since no target here has one.
- **500 steps** is the size of the timed plan: a deletion of a cache folder, file by file, ending in one step that can't be undone. The issue gives no size.
- **Not tested here:**
  - a dry run filling in effects (Scope, no criterion);
  - root plans on hosts (same shape, no criterion);
  - a refund as a purchase's undo (beyond its `refund` field);
  - the payment task's shape;
  - the approve button's counts;
  - the Proof's three plans shown in the app.

## Conflict with earlier suites

Criterion 1 can't pass while earlier frozen suites raise authority asks with no plan. On a sample fix (see `BASE-FAILURE.txt`), about 33 tests fail for that reason alone, in `318` (`raise`, `sources`), `319` (`deadlines`, `fold`, `restart`, `settings`, `plants`), `23/match` (`keys`, `merge`, `repeat`, `plants`) and `24`. Some raise the ask in the test itself, others through the implementer's own code (the hub, and the #86 ledger's budget-raise and paid-run asks). Under AGENTS.md the implementer edits none of them: the ones whose test code raises the ask are a dispute for those suites' blind redrafts.

## Criteria, tests and wrong programs

Each ID is the first 8 hex digits of the SHA-256 of the criterion's text: trimmed, whitespace collapsed, and the leading `- [ ] ` dropped (the command in `tests/acceptance/48/README.md`). Each test name starts with its ID. A "plant" is a wrong program in `plants.ts`, run by `plants.test.ts`. A "mutant" is the sample fix with one part changed, run outside this checkout (`BASE-FAILURE.txt`).

| # | ID | Criterion (short) | Tests | Wrong programs it fails on | On the base |
|---|---|---|---|---|---|
| 1 | `#69.9eb13dee` | an authority ask without a plan can't be created | `plan`: one; `plants`: one | plant: a placeholder plan drafted for an ask raised without one; the base (plan optional) | FAIL at its assertion |
| 2 | `#69.f54debdc` | a step added after your yes stops before it and asks again | `plan`: one; `plants`: one | plant: a run held to your yes, not the plan | FAIL (`beforeStep` missing) |
| 3 | `#69.3f9c3f3d` | no undo marked "can't undo"; irreversible still defaults to no | `plan`: two; `plants`: two | plants: a placeholder undo; a default that approves | FAIL (null undo refused) |
| 4 | `#69.06d40ef2` | never stores or sees a card number | `buying`: one; `plants`: one | plant: a processor adapter that logs the receipt under the state folder; mutants: receipt kept unscrubbed, card rule takes a number | fails to load |
| 5 | `#69.d8443973` | past what's left, counting reserved, asks; receipt kept as evidence | `buying`: one; `plants`: one | plant and mutant: a check against charges alone | fails to load |
| 6 | `#69.275c8f18` | in a batch, "can't undo" starts off and runs only on its own switch | `plan`: one; `plants`: two | plants: every step starts on; one switch per ask | FAIL (null undo refused; `batch` missing) |
| 7 | `#69.eb8b7be8` | a plan's preview drafted in under 2 s, vs the merge base | `budgets`: two; `plants`: one | plant: a preview that takes 2.5 s (FAIL by the timing rule); no perf-lane task | FAIL (no task; null undo refused) |

## Files

- `data.ts`: the clock, ULIDs, fixture asks from `ask.sources@1`, plans and steps, and the card number.
- `helpers.ts`: a world (a record and an evidence store in a temporary folder, drafted settings and the asks core), connections, the run loop with its target, `approve`, `batchOf` and `refused`.
- `buying.ts`: the buying world (the #86 ledger, the buying module and the processor), `buyingRefused` and `filesUnder`.
- `scenarios.ts`: criteria 1, 2, 3, 6 and 7. `buying-scenarios.ts`: criteria 4 and 5. Both are shared by the criterion tests and `plants.test.ts`.
- `timing.ts`: the design's timing rule and the reference-Mac check.
- `plan.test.ts` (criteria 1, 2, 3 and 6), `buying.test.ts` (4 and 5), `budgets.test.ts` (7) and `plants.test.ts`.
- `plants.ts`: the wrong programs, each the real program with one part wrong.
- `tsconfig.json`: type-checks the suite under the root's strict options, with `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the base run, the sample-fix run, the mutants, and the earlier tests in conflict with criterion 1.
