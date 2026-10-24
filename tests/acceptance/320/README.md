# Acceptance tests for #320: unblock tasks and drafted requests

Written first, blind, from issue #320 (its text as of October 24, 2026: Scope, the 4 acceptance criteria and Proof), its parent #22 and siblings #321, #32 (with its part #323, which owns "I did it" re-running the check) and #23 (read only to keep their scope out), `docs/technical-design.md` (An ask, and your answer getting back, especially Tasks only you can do, Could the agent do it?, Tasks close themselves and Every ask ends; Checks for work beyond code; Plans before acting (Buying); How runs become one of five verdicts, with One cause, one send-back; the Ask-task, Definition of done, Claim, Check, Verdict, Ask, Decision and rule, and Budget primitives; Socket roles and contract versions, What a minor may change), `docs/canvas-primitives.md` (Question card, the event catalogue) and the base commit `8b98570` (`origin/main`, with #318's and #319's asks core and no implementation of #320). The suites of #318 and #319 set the shape followed here. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft by this job.

## Run

```sh
npm ci                                   # once, if node_modules is missing
npm run build -w @deepbuild/contracts -w @deepbuild/evidence -w @deepbuild/record   # the record resolves these through dist/
npx vitest run tests/acceptance/320      # from the checkout's root, with the repo's vitest.config.ts
npx tsc -p tests/acceptance/320          # type-check the tests against the surface below
```

Node 24.22 or newer and `git` on `PATH` (criterion 4 makes a real repository in a temporary folder). Nothing else: no network, no hub socket. Every world is a real record on SQLite and a home folder in its own temporary folder, with a virtual clock, removed afterwards. The suite took about 12 s here, and 31 s while other work loaded the machine; the git-backed tests have 30 s timeouts.

On the base, all 9 tests fail, each at an assertion: the block Sam owns is in your inbox; no drafted request exists; a task with a price is refused, since `ask.created@1` has no field for it; and a task with an empty list of steps passes its schema and is raised. `npx tsc -p tests/acceptance/320` reports 10 errors on the base, all from the missing surface: `request` is not on `InboxRow` (7) and `cost_usd` is not on `Card` (3). Against the surface below it reports none. `BASE-FAILURE.txt` has the base run, a sample fix kept outside this checkout that passes every test, how each plant fails, and the mutants of that fix each test catches.

## The surface

The issue names behaviours, a schema ("its schema") and your inbox. These tests define the smallest code surface they need on top of #318's and #319's, which stay as `tests/acceptance/318/README.md` and `tests/acceptance/319/README.md` define them. They reach the code only through:

- **`@deepbuild/asks`, through its public entry `packages/asks/src/index.ts`**: `openAsks` (with `home`), `raise`, `tick`, `card`, `needsYou`, `inbox`, `askSources`, `AskRefused`, with the additions below;
- **`@deepbuild/contracts`** as it is at the base: `validate`, plus `getSchema` and `registry` (only to build the planted schema in `plants.ts`);
- **`@deepbuild/record`** as it is at the base: `openRecord`, `append`, `read`, `close()`;
- **files**: `<home>/config.json` with #319's settings (no `batch`, so every ask shows when it's raised);
- **events** the tests append as the hook would: `session.start@1` (`thread`, `worktree`). They read `ask.created` events.
- **`git`**, for one real repository.

```ts
// packages/asks/src/index.ts: additions to #318's and #319's surface

export interface Card {
  // …ask, kind, options, plan, words, changed, folded, undo, as #318 defined them, and:
  /** A task with a cost you pay: its price in USD, from the task's cost_usd. null on every other ask. */
  cost_usd: number | null;
}

export interface InboxRow {
  // …ask, kind, session, status, outcome, owner, age, as #319 defined them, and:
  /** On a drafted request: the owner it's for, and the block (ask:<id>) it asks them to clear. null on every other row. */
  request: { to: string; block: string } | null;
}
```

```jsonc
// The schema the core writes an unblock task in (ask.created, kind unblock): two changes to its branch
"steps":    { "type": "array", "minItems": 1, "items": … },   // a task has at least one step
"unblocks": { "type": "array", "minItems": 1, "items": … },   // and unblocks at least one thing
"cost_usd": { "type": "number", "minimum": 0 }               // optional: present only on a task with a cost you pay
```

Nothing else is needed: no other option, flag or export. The tests don't say which major carries the schema change. They read the `v` of the `ask.created` the core writes for a whole task and validate against `ask.created@<v>`. Under the design's "What a minor may change", forbidding an empty list is not a minor change. So the implementer either edits `ask.created@1` in place with its frozen digest, as pre-release review fixes have done, or adds a new major that the core writes unblock tasks in, as #394 did with `@2`. Either passes.

### Behaviour the surface carries

- **Whose block.** An unblock whose `owner` is someone other than you (the connection's actor, `you` here) is a block owned by someone else. `raise` records it as raised, owner and all, and returns its handle. It never reaches your inbox: `inbox()` has no row for it, now, past its deadline, or after the hub restarts on the same record. `needsYou()` never shows its card.
- **Its drafted request.** That block gets one drafted request in your inbox: an ask whose `inbox()` row has `request: {to: <the block's owner>, block: <the block's handle>}` and `owner: 'you'`. It shows in Needs you as any ask does. Its kind, options, source row and wording are up to the implementer, as long as it passes the schemas and every ask ends. One reading: sending it is a send, so it would be an authority ask from a new `ask.sources@1` row that takes no at its deadline.
- **Re-checked against its source.** The request is pinned to what its block shows (the block's `pinned_to`). Each time its card is made for Needs you, it is compared with that source as it stands. When the item has moved, as when the session's worktree HEAD has left the commit the block is pinned to, the card's `changed` says so, with `{from, to, files, diff}` as #318's card does. When it hasn't moved, `changed` is null. A card made when the request was drafted and shown later as it stood fails.
- **The price.** A task raised with `cost_usd` keeps it in its `ask.created`, and its card shows it as `cost_usd`. A task without one shows `null`.
- **The schema.** A task that lacks its `steps`, `where`, `unblocks` or `proves` fails the schema, at `/data/<part>`. That covers a part left out, an empty list of steps or of what it unblocks, and an empty `where` or `proves`. `raise` refuses it with `AskRefused` whose `field` is that pointer, and records nothing.

### How the tests drive it

- As in #318 and #319: the tests append `session.start` before a session raises anything, then call `raise` over a `core` connection with the session set, from the `ask.sources@1` row of kind unblock (`deep_ask.unblock`). `tick()` runs after the clock moves (`World.at`).
- Tasks bring their own default (`wait`, the option that leaves the claim BLOCKED), since only the raiser names it (#319's reading). Their deadline comes from your settings (2 days for an unblock).
- The clock starts at 2026-10-24 12:00 UTC. You are actor and scope `you`. The teammates are `sam` and `lee`.

## The contract per criterion

1. **`#320.dbf54286` A block owned by someone else never reaches your inbox; its drafted request does.** In session S1 the agent raises a task you own and a block Sam owns (`owner: 'sam'`). The block's `ask.created` says `owner: sam`. `inbox()` has no row for the block. Your task's row has `request: null`. Exactly one row has `request: {to: 'sam', block}`, with owner `you`. `needsYou()` shows your task and the request, never the block. The same holds an hour later (same request), past the block's 2-day deadline, and after the hub restarts on the same record. **Plants:** an inbox that lists every ask in the record, as #319's did (fails naming the block); a hub that keeps the block out but drafts no request (fails naming the block whose request is missing).
2. **`#320.d9222c7a` A task with a cost you pay shows the price.** A task to accept a speech model's licence, raised with `cost_usd: 49`, is raised, not refused. Its `ask.created` carries `cost_usd: 49`. Its card in Needs you, and from `card()`, shows `cost_usd: 49`. A task with no cost shows `cost_usd: null`.
3. **`#320.424a72ad` A task without its steps, where to take them, what it unblocks and the check that proves it fails its schema.** A whole task passes `ask.created@<v>`. For each of `steps`, `where`, `unblocks` and `proves`, the task with that part left out, and with it empty (`[]` or `""`), fails at `/data/<part>`. `raise` refuses each with `AskRefused` naming `/data/<part>` and appends no `ask.created`. **Plant:** the real schema with every `minItems` taken out, so a list may be empty as at the base (fails naming the steps).
4. **`#320.ce2e38fe` A drafted request for someone else is re-checked against its source before it's shown, and one whose item has changed says so.** A real repository, where Sam's commit A changes `db/credentials.ts`, is S1's worktree. A block Sam owns is pinned to A. Sam's commit B lands, and then a block Lee owns is pinned to B. When Needs you first shows the two requests, Sam's says its item changed (`changed` from A to B, files `db/credentials.ts`), and Lee's says nothing changed (`null`). Commit C lands. Shown again, Lee's request says B to C, and Sam's says A to C. **Plant:** a hub that makes a request's card once, when the request reaches your inbox, and shows that card unchanged after (fails naming Sam's block).

## Readings where the issue leaves a choice

- **"Someone else"** is an `owner` other than the person behind the connection. In version 0 that person is you, so the tests' owners are `you`, `sam` and `lee`. Whether the core compares `owner` with the actor or with the literal `you` doesn't change any test.
- **"Your inbox"** is #319's inbox projection, `inbox()`, which `deep inbox` prints. The tests also hold Needs you (`needsYou()`) to the same rule, since the design says asks and tasks wait in both.
- **The drafted request is an ask in your inbox, linked to its block.** The design says "a teammate's commit gets one drafted request", and the criterion says the request reaches your inbox. The only link the tests read is the row's `request` field. Who sends the request, and how, is left out: no criterion says.
- **"Its source" is what the block is pinned to.** "Re-checked … before it's shown" means compared with that source each time its card is made, not once when drafted. For a commit pin, the comparison is #318's: the session's worktree HEAD against the pinned commit. The tests use a commit pin, the design's example of a teammate's commit. A block pinned to evidence or a document revision isn't tested.
- **"Shows the price"** is the card in Needs you, where you read a task. `cost_usd` follows the design's money fields (`cap_usd`, `usd`): DeepBuild's money is USD. How a price nobody knows is handled, which the design makes BLOCKED, isn't in this issue's criteria and isn't tested.
- **"Without its steps … what it unblocks"** includes an empty list. At the base, the schema already requires all four parts and refuses an empty `where` or `proves`, so the base fails only on an empty `steps` or `unblocks`. `why` is required at the base too. The criterion doesn't name it, so it isn't tested here.
- **Out of scope**, by the siblings: "I did it" re-running the named check through the done gate (#32, #323); the definition's fallback past the deadline (the done gate's definition); "Could the agent do it?" (#23's resolvers); authority at PreToolUse (#321); a step's sign-in naming a provider, never a URL (no criterion).

## Criteria, tests and wrong programs

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed and the leading `- [ ] ` dropped (the command in `tests/acceptance/48/README.md`). Each test name starts with its ID. A "plant" is a wrong program in `plants.ts`, run by `plants.test.ts`, which first runs the same scenario on the real program (it must pass) and then on the plant (it must fail with the named message). A "mutant" is the sample fix with one part changed, run outside this checkout (`BASE-FAILURE.txt`).

| # | ID | Criterion (short) | Tests | Wrong programs it fails on | On the base |
|---|---|---|---|---|---|
| 1 | `#320.dbf54286` | a block owned by someone else never reaches your inbox; its drafted request does | `inbox`: one; `plants`: two | plants: inbox lists every ask; no request drafted. Mutants: inbox lists others' blocks; no request drafted; block shows in Needs you; request addressed to you; inbox drops the request link | FAIL: the block is in your inbox (`[ 'sam' ]`) |
| 2 | `#320.d9222c7a` | a task with a cost you pay shows the price | `price`: one | mutants: card drops the price; card shows a price (0) on every task | FAIL: the priced task is refused (`/data/cost_usd`) |
| 3 | `#320.424a72ad` | a task without its steps, where, what it unblocks and its check fails its schema | `schema`: two; `plants`: one | plant: lists may be empty. Mutants: steps may be empty; unblocks may be empty | FAIL: an empty list of steps passes the schema and is raised |
| 4 | `#320.ce2e38fe` | a drafted request is re-checked against its source; a changed one says so | `request`: one; `plants`: one | plant: card made once when drafted. Mutants: request pinned to its own text, not its source; no request drafted; inbox drops the request link | FAIL: no drafted request in your inbox |

## Files

- `data.ts`: the clock's start, ULIDs, your settings, the people (`you`, `sam`), and `task()`, an unblock task as `ask.created` data.
- `helpers.ts`: a world (virtual clock, record and home in a temporary folder, the asks core with `home`, restart on the same record), connections, `raised` and `refusal`, `created`, `requestRow`, `cardIn` and a real git repository.
- `scenarios.ts`: the scenarios of criteria 1, 3 and 4, shared with `plants.test.ts`.
- `plants.ts`: the wrong programs the Proof names, each the real program with one part wrong.
- `inbox.test.ts` (criterion 1), `price.test.ts` (2), `schema.test.ts` (3), `request.test.ts` (4), `plants.test.ts`.
- `tsconfig.json`: type-checks the suite under the root's strict options with `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the base run, the sample fix, the plants and the mutants.
