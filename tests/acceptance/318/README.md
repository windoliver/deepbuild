# Acceptance tests for #318: ask kinds, the ask schema, its outcomes, and answers that authorize only through decision

Written first, blind, from issue #318 (its text as of October 21, 2026: Scope, Fields, the 14 acceptance criteria, Proof and "Added Oct 9"), its parent #22 and siblings #319, #320 and #321 (read only to keep their scope out), `docs/technical-design.md` (One event log, with tables built from it; Hook protocol; the Lifecycles, Event, Ask, Decision and rule, and Attempt and plan primitives; Plans before acting; An ask, and your answer getting back, all of it; Questions at the stop; Decided; How we know version 0 works; Threats), `docs/canvas-primitives.md` (Question card, The event catalogue, Projections the canvas reads, Closed enums) and the base commit `4f6dec5` (`origin/main`, no implementation of #318). The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft by this job.

The issue has 14 criteria, not 13. Every one has tests below.

## Run

```sh
npm ci                                   # once, if node_modules is missing
npx vitest run tests/acceptance/318      # from the checkout's root, with the repo's vitest.config.ts
npx tsc -p tests/acceptance/318          # type-check the tests against the surface (needs packages/asks)
```

Node 24.22 or newer. The tests need `git` on `PATH` (criterion 4 makes a real repository in a temporary folder) and nothing else: no network, no hub, no wall clock. Every world is a real record on SQLite in its own temporary folder with a virtual clock, removed afterwards; the suite takes about 2 s.

On the base, `contract.test.ts`'s 4 tests pass (the published `ask.created@1` already holds the schema halves of criteria 1, 6, 9 and 11) and the other 6 files fail to load: `packages/asks/src/index.ts` doesn't exist. `BASE-FAILURE.txt` shows that run, the same tests against a program that does nothing (each fails at its own assertion), the runs against a sample fix kept outside this checkout (all 27 pass), and each wrong program each test was run against.

## The surface

The issue names behaviors and a table, `ask.sources@1`, but no code API for the asks core, so these tests define the smallest one they need, as #14's job did. The tests reach the code only through:

- **`@deepbuild/asks`, a new workspace package, through its public entry `packages/asks/src/index.ts`** (below);
- **`@deepbuild/contracts`** as it is at the base: `validate(name, value)` and `listSchemas()`, plus one new published schema, `ask.sources@1` (`packages/contracts/schemas/ask.sources@1.json`), which the table must pass;
- **`@deepbuild/record`** as it is at the base: `openRecord({path, now, schemas?})`, `append`, `read`, `table('asks')`, `table('decisions')`, `rebuild()`, `close()`, `RecordError`;
- **events** the tests append as the hook or the core would: `session.start@1` (`thread`, `worktree`), `user.ask@1` (`from: person`), `run.finished@1`, `verdict.made@1`; and events they read: `ask.created`, `plan.proposed` (through the card), `ask.answered`, `ask.defaulted`, `ask.escalated`, `ask.superseded`, `ask.moot`, `decision.created`, and the event that records a refused answer (any kind);
- **`git`**, for one real repository.

```ts
// packages/asks/src/index.ts
import type { JsonValue } from '@deepbuild/contracts';
import type { Connection, RecordStore } from '@deepbuild/record';

export type AskKind = 'authority' | 'unblock' | 'taste' | 'exception' | 'choice' | 'definition';
export type Decision = 'allow' | 'deny' | 'none';

/** One row of ask.sources@1: a place that raises asks, the one kind it raises, and its fixture. */
export interface AskSource {
  source: string;                                   // unique; the tests name two: 'budget.raise' and 'generation.paid'
  kind: AskKind;
  fixture: {
    ask: JsonValue;                                 // ask.created@1 data of the row's kind
    at_deadline: { decision: Decision };            // what that ask takes when its deadline passes unanswered
  };
}
/** The ask.sources@1 table. validate('ask.sources@1', askSources()) is { ok: true }. */
export function askSources(): AskSource[];

export interface PlanStep { does: string; changes: string[]; undo: string; public: boolean; cost: number }
export interface PlanInput { steps: PlanStep[]; diff: string }   // plan.proposed@1's data, less ask and hash
/** A step the agent is about to take; whether it leaves the machine comes from the guard engine (#304). */
export interface Step { leaves_machine: boolean }

/** What the core hands the agent's adapter for one ask. */
export interface Delivery {
  ask: string;              // ask:<id>
  session: string;
  option: string | null;    // the option taken, by ID; null for words alone
  decision: Decision;
  words: string | null;     // your words, as the reason
  provisional: boolean;     // true only for the recommended option handed over at once under a provisional ask
  undoes: string | null;    // the provisional option your different answer undoes
}

/** What the question card shows for one ask. */
export interface Card {
  ask: string;
  kind: AskKind;
  options: { id: string; label: string; decision: Decision }[];
  plan: { hash: string; steps: PlanStep[] } | null;          // an authority ask's plan, by the digest an approval binds
  words: string[];                                           // text typed in the session, shown beside an authority ask
  changed: { from: string; to: string; files: string[]; diff: string } | null;   // since the pinned commit, when HEAD moved
  folded: string[];                                          // on the exception: the asks folded into it
  undo: boolean;                                             // Needs you offers the undo (a defaulted ask)
}

/** Every refusal the core makes. Each names what it refuses in one of these. */
export class AskRefused extends Error {
  readonly field?: string;     // the field: 'kind', 'question', 'decision', 'fallback' … or a pointer ending in it
  readonly option?: string;    // the option, by ID
  readonly source?: string;    // the place with no row
  readonly ask?: string;
  readonly outcome?: string;   // how the ask had closed
  readonly closed_at?: number; // when, in ms since the epoch
}

export interface AsksOptions {
  record: RecordStore;
  now: () => number;                          // the only clock the core reads
  deliver: (delivery: Delivery) => void;      // the adapter boundary
}
export interface Asks {
  /** Raises an ask from a place in ask.sources@1. Returns `ask:<ID of its ask.created event>`. */
  raise(connection: Connection, source: string, ask: unknown, plan?: PlanInput): Promise<string>;
  /** An answer on the trusted path: the card (writer app) or `deep inbox answer` (writer cli). */
  answer(connection: Connection, ask: string, input: unknown): Promise<void>;
  /** Reads what the record gained since the last call and applies every deadline now() has reached. */
  tick(): Promise<void>;
  card(ask: string): Promise<Card>;
  /** The cards Needs you shows. */
  needsYou(): Promise<Card[]>;
  /** The open asks a step of this session waits on. */
  holds(session: string, step: Step): Promise<string[]>;
  /** The click token your approval bound to this plan digest, or null: only an approved plan runs. */
  authorized(ask: string, planHash: string): Promise<string | null>;
}
export function openAsks(options: AsksOptions): Promise<Asks>;
```

Nothing else is needed: no option, flag or export beyond these. `Connection` is the record's (`writer` from the socket, `session` the agent session). The answer `input` the tests send is `{option?, words?, plan_hash?, token?}`.

### How the tests drive it

- The tests append `session.start` (writer `hook`) before a session raises anything, then call `raise` at once, with no `tick` between: `raise` reads the session's thread and worktree from the record itself. After appending any other event (typed text, a run, a verdict) or moving the clock, the tests call `tick()` before reading.
- DeepBuild's own asks are raised over a `core` connection with the session set; `deep_ask` over `mcp:<session>`; an answer over `app` (the card) or `cli` (`deep inbox answer`). Agent connections are `hook` and `mcp:*`.
- Outcomes are read from the record: its `asks` table (`id` is the ask.created event's ID, `outcome`, `fallback`, `owner`, `key`, `pinned_to`) and the events whose `subject` is the ask's `ask:<id>` handle.
- The clock starts at 2026-10-20 12:00 UTC. A deadline is reached when `now() >= deadline`.

## The contract per criterion

1. **`#318.b64bd314` Ask kinds.** `ask.created@1` refuses 16 near-miss kinds (`bug`, `question`, `permission`, `Authority`, `taste `, `choices`, the empty string …) at `/data/kind`, and the record refuses to append them (`contract.test.ts`, passes on the base). `raise` raises an ask of each of the six kinds, from a row of that kind, and refuses each near-miss with `AskRefused`, appending no `ask.created`.
2. **`#318.471f0611` Provisional taste call.** Raised with `provisional: true`, it delivers `{option: recommended, provisional: true}` during `raise`, `holds(session, {leaves_machine: false})` is `[]`, and the ask stays in Needs you. Answering another option on the card delivers `{option: 'green', undoes: 'blue'}`; a twin answered with the recommended option delivers nothing with `undoes`.
3. **`#318.4c8ff7fb` Steps that leave the machine.** Under a provisional taste call and a provisional choice, `holds(session, {leaves_machine: true})` contains both, for a push, a post and a payment alike; a local step is held by neither; after both are answered a push is held by neither.
4. **`#318.a4005788` Pins that moved.** A taste ask and a provisional choice are pinned to commit A of a real repo, the session's worktree. A commit B changes `src/a.ts`. The taste ask's card shows `changed = {from: A, to: B, files: ['src/a.ts'], diff ⊇ '+export const a = 2;'}`; answering it appends an `ask.answered` whose data names A, and its outcome is `answered`. The choice, about `src/b.ts`, isn't asked again: no new `ask.created`, no `ask.superseded`, outcome still `unanswered`, one card.
5. **`#318.4fbf5336` Superseded and moot.** A second taste ask from the same session with the same `key` (other wording, other pin) supersedes the first (`ask.superseded {by: second}`, outcome `superseded`). An unblock whose `proves` is `auth.unit` closes as moot (`ask.moot`, outcome `moot`) once a passed `run.finished` and a PASS `verdict.made` for check `auth.unit` are in the record. Needs you then shows exactly the second ask.
6. **`#318.785af8ee` What an ask states.** Without `question` (or with it empty), `options`, `recommended` or `default`, `ask.created@1` refuses it at that field (passes on the base), and `raise` refuses it with `field` naming it, for each of the six kinds, appending nothing.
7. **`#318.4f134efa` Text typed in the session.** S1 holds a taste ask and an authority ask with a plan; S2 a taste ask with the same key. A person's `user.ask` in S1 closes S1's taste ask: one `ask.answered` with `decision: none` whose data says `session` and `unverified` (or `"verified": false`); no `decision.created`; S2's ask stays `unanswered`. The authority ask stays `unanswered` and in Needs you, its card's `words` hold the typed text, `authorized` stays null, and one answer on the card with its allow option answers it. With the clock past every deadline, neither ask gets an `ask.defaulted`.
8. **`#318.e41be4c3` Plan digest and click token.** The card shows the plan's 64-hex digest and its steps as raised. Before any answer `authorized` is null; an answer over `mcp:S1` or `hook` is refused, the record refuses an `ask.answered` from the agent, and `authorized` stays null. After `{option: 'push', plan_hash: h1, token: 'click-7'}` on the card, `authorized(ask, h1) === 'click-7'` and any other digest is null. A changed plan (the same push with a tag) raised as a new authority ask on the same subject has a new digest, isn't authorized by the old approval or answered for you, waits in Needs you, and is authorized only by its own click (`'click-8'`).
9. **`#318.fc8e493b` Option decisions.** `ask.created@1` refuses an authority option with no `decision`, or with any of 14 other values (`yes`, `approve`, `Allow`, `''`, `null`, `1` …), at `/data/options/<i>/decision` (passes on the base); `raise` refuses the same, naming `decision`. Over an agent's connection, a taste ask whose own option `go` declares `allow` is refused naming `go`, and an authority ask with an `allow` option is refused naming it; the twin whose options declare `deny` and `none` is raised.
10. **`#318.d249acdc` Decision only from the option.** An answer carrying `decision` is refused naming `decision`, and nothing is recorded. Words alone, "yes but not on main", record `decision: none`, deliver `{decision: none, words}`, and the push's plan isn't authorized. Choosing the allow option records `ask.answered {decision: allow, plan_hash: <shown digest>}`, and only that digest is authorized, to its click.
11. **`#318.e4675a8d` The four fields in the log.** `ask.created@1` refuses each of `fallback`, `owner`, `key`, `pinned_to` missing, naming it (passes on the base); `raise` refuses the same, and the `ask.created` it appends carries all four. Three asks raised, `record.rebuild()` (which drops every projection and replays the log): each `asks` row has the fallback, owner, key and pinned_to it was raised with. A new core on the rebuilt record, past every deadline, closes each with exactly one `ask.defaulted` or `ask.escalated`.
12. **`#318.b4c25197` Threads.** S1 (thread T1) raises a taste ask; S2, a rotated ID of T1 (`/compact`), raises a newer one on the same key: the first is superseded by it and Needs you shows one card. S3 (thread T2) raises three, S4 (T2, after `/clear`) two more and a sixth: the sixth has no card of its own, and the card whose `folded` holds it is of kind `exception`.
13. **`#318.898ac861` A late allow.** An authority ask created 2026-10-20 12:00 with a 1-day deadline takes, at the tick at 2026-10-21 12:00, an `ask.defaulted {decision: deny}` stamped 12:00, and the agent hears that deny once. At 12:01 an allow over `cli` is refused with `outcome: 'defaulted'` and `closed_at` = 12:00; the agent hears nothing more; there's no `ask.answered`; one event about the ask appended after the default records the refusal, its data naming `defaulted` and 12:00 (as the ms value or `2026-10-21T12:00…`); the outcome stays `defaulted`; nothing is authorized; and the card's `undo` is true.
14. **`#318.af2a2599` ask.sources@1.** The table passes `ask.sources@1`, has one row per source, a row of each of the six kinds, and rows `budget.raise` and `generation.paid` of kind `authority`. Each row's fixture is a valid `ask.created` of the row's kind, and an authority row's `at_deadline.decision` is `deny`. Each fixture, raised from its row in a fresh world an hour before its deadline and ticked at it, takes an `ask.defaulted` whose decision is the row's. `budget.raise` and `generation.paid` asks whose `default` names an option that approves still take `deny` (or are refused at `raise`). A planted source `planted.no_row` is refused naming it, appending nothing.

## Readings where the issue leaves a choice

- **A new package.** The asks core is the core's fourth part (record, gates, asks, adapters); it lives in its own workspace package so neither the record nor the contracts package grows behavior. The record keeps its projections; the core writes events through it and reads them back.
- **The trusted path is a writer.** An answer counts only over the `app` (the card) or `cli` connection; OS confirmation of a CLI answer, and the card's arming, are the app's and CLI's (Decided: Answers from the terminal, Clicks on the question card), outside this core. Every `hook` or `mcp:*` writer is an agent's. `deep inbox answer` is tested as an answer over a `cli` connection: there is no hub socket yet (#16), so the CLI command itself isn't run.
- **Agent options.** "Options an agent writes" are the options of an ask raised over a `hook` or `mcp:*` connection. The tests use a taste and an authority ask for the `deep_ask` case; the rule holds for any kind.
- **The subject is the key.** "Same subject" is the same `key`. Computing a key from structured fields belongs to the resolver; the tests pass it in the ask, as `ask.created@1` requires.
- **Sources and kinds.** Each row names one kind, so a place that raises several kinds (as `deep_ask` does) takes one row per kind. The tests take the first row of a kind wherever they need one, and raise any row over the `core` connection, and taste, choice and authority rows over an agent's connection too; the core may refuse a raise whose kind isn't its row's, but not a source's writer. The two rows the criterion names are pinned by the names `budget.raise` and `generation.paid`.
- **A fixture's default** is `at_deadline.decision`; at one person's deadline every row closes as `defaulted`. An authority ask takes `deny` whatever its `default` names ("anything irreversible defaults to no").
- **An ask's check** is the check its unblock `proves` names; the only check an ask schema carries. The tests append both a passed `run.finished` and a PASS `verdict.made` for it, so either can trigger the moot (`ask.moot@1` needs the verdict).
- **A commit that moved** is the session's worktree HEAD (from `session.start`) leaving the pinned commit. "Recorded as answered on the old commit": the `ask.answered` data names the pinned commit. "Asked again": a new `ask.created`, or the choice superseded or re-pinned. How a choice names its files is left open; the change touches only a file the choice doesn't name, and a choice whose files it did touch isn't tested.
- **Typed text** is a `user.ask` from a person in the ask's own session. With one open non-authority ask there, it answers that one; which one it answers when several are open is left open. "Its action already ran" covers both the typed answer and the tapped authority ask: neither is defaulted afterwards.
- **Leaving the machine** comes in as `Step.leaves_machine`; classifying calls is the guard engine's (#304, #321). `holds` lists the open asks of that session the step waits on.
- **A changed plan** arrives as a new authority ask with the new plan on the same subject; your earlier approval never covers it, and it isn't answered for you. `authorized` returns the click's token, so a binding without the token fails.
- **The default reaches the agent.** "Delivers a second answer" means the default no was the first: the tests require exactly one delivery, `deny`.
- **12:00** is UTC; `closed_at` is the ms value. The recorded refusal may be any event kind about the ask.
- **"Goes to its fallback"**, for one person, is `defaulted` (or `escalated` when the fallback names a queue); the tests accept either, once.
- **The fold** counts the open asks of a thread (five, drafted at setup; the tests rely on the default). The folded ask keeps no card of its own; the exception's card lists it. Batching, the cap, deadlines drafted at setup, escalation and the inbox projection are #319's.
- **Not tested here:** the "Added Oct 9" bullets that no criterion repeats (Later, a question from a BLOCKED claim merged by its normalized text, no agent closing one), unblock tasks (#320), holds at PreToolUse (#321), and the key's computation.

## Criteria, tests and wrong programs

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed and the leading `- [ ] ` dropped (the command in `tests/acceptance/48/README.md`). Each test name starts with its ID. "Plant" is a wrong program in `plants.ts`, run by `plants.test.ts`; "mutant" is the sample fix with one part changed, run outside this checkout (`BASE-FAILURE.txt`).

| # | ID | Criterion (short) | Tests | Wrong programs it fails on | On the base |
|---|---|---|---|---|---|
| 1 | `#318.b64bd314` | no item but the six kinds is an ask | `contract`: *an item of no ask kind fails ask.created…*; `raise`: *…raises an ask of each of the six kinds and refuses any other…* | mutant: raise skips the schema; do-nothing program | contract PASS; raise FAIL (no core) |
| 2 | `#318.471f0611` | provisional taste: on at once, undone by a different answer | `flow`: *a provisional taste call hands the agent…* | mutants: no delivery at once; no undo; local steps held | FAIL (no core) |
| 3 | `#318.4c8ff7fb` | push, post, payment wait under a provisional ask | `flow`: *a step that leaves the machine waits…* | mutants: nothing held; local steps held | FAIL (no core) |
| 4 | `#318.a4005788` | moved pin: diff shown, answered on old commit, untouched choice not re-asked | `flow`: *an answer after the pinned commit moved…* | mutants: no change on the card; answer recorded on the moved HEAD | FAIL (no core) |
| 5 | `#318.4fbf5336` | superseded and moot, neither counted | `flow`: *a second ask on the same subject supersedes…* | mutants: no supersede; no moot | FAIL (no core) |
| 6 | `#318.785af8ee` | no question, options, recommendation or default fails the schema | `contract`: *an ask without what it decides…*; `raise`: *…refuses to raise an ask without what it decides…* | mutant: raise skips the schema | contract PASS; raise FAIL |
| 7 | `#318.4f134efa` | typed text: answers its question only, unverified, never a decision; authority stays for one tap; no default after | `flow`: *text typed in the session answers its question only…* | mutants: typed text answers the authority ask; recorded as verified; deadline defaults answered asks | FAIL (no core) |
| 8 | `#318.e41be4c3` | only the approved digest runs, bound to the click; changed plan re-asks; agent flag never approves | `authority`: *only the plan whose digest you approved runs…* | mutants: answers from any writer; any plan runs once approved; an old approval answers the changed plan | FAIL (no core) |
| 9 | `#318.fc8e493b` | option decision required and closed; deep_ask's allow refused naming the option | `contract`: *an authority ask with an option that has no decision…*; `raise`: *…a deep_ask whose own option declares allow…* | mutants: raise skips the schema; agent allow allowed | contract PASS; raise FAIL |
| 10 | `#318.d249acdc` | answer's own decision refused; words are none; allow runs only its plan | `authority`: *an answer carrying decision is refused…*; `plants`: two | plants: infers allow from "yes"; copies decision from the request; mutant: any plan runs | FAIL (no core) |
| 11 | `#318.e4675a8d` | fallback, owner, key, pinned_to in every ask.created; rebuilt from the log; still ends | `contract`: *an ask.created without its fallback…*; `raise`: *…refuses to raise an ask without its fallback…*; `sources`: *dropping the asks table and replaying the log…*; `plants`: one | plant: a catalogue that leaves fallback to the live table (fails naming the ask); mutant: raise skips the schema | contract PASS; the rest FAIL |
| 12 | `#318.b4c25197` | supersede and fold follow the thread across /compact and /clear | `threads`: two; `plants`: two | plant: a hub keyed on session ID (fails naming T1, and T2); mutants: no supersede; fold counts per session | FAIL (no core) |
| 13 | `#318.898ac861` | late allow after default refused naming defaulted and 12:00; nothing reaches the agent; undo offered | `authority`: *an allow from deep inbox answer at 12:01…*; `plants`: one | plant: records the late allow as answered (fails naming the ask); mutants: refusal not recorded; default not delivered; deadline only after it passes | FAIL (no core) |
| 14 | `#318.af2a2599` | one row per source naming its kind; fixtures take their defaults; budget raise and paid generation take no; a source with no row raises nothing | `sources`: *every place that raises an ask has one row…*; `plants`: one | plant: paid generation filed as a choice with an approving default (fails naming the row); mutants: no source check; authority takes its default option; deadline only after it passes | FAIL (no core) |

## Files

- `data.ts`: the clock's start, ULIDs, asks as `ask.created@1` data, plans, the values the schema refuses, and the refusal check against a published schema. It loads only the contracts package.
- `helpers.ts`: a world (virtual clock, record in a temporary folder, the asks core, its deliveries), connections, `refused`, `sourceOf`, a real git repository.
- `scenarios.ts`: the scenarios of criteria 10, 11, 12, 13 and 14, shared with `plants.test.ts`.
- `plants.ts`: the wrong programs the issue names, each the real program with one part wrong.
- `contract.test.ts` (criteria 1, 6, 9, 11 on the schema), `raise.test.ts` (the same through `raise`), `flow.test.ts` (2, 3, 4, 5, 7), `authority.test.ts` (8, 10, 13), `threads.test.ts` (12), `sources.test.ts` (14, and 11's rebuild), `plants.test.ts`.
- `tsconfig.json`: type-checks the suite under the root's strict options with `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the base run, the do-nothing run, the sample fix and the wrong programs.
