# Acceptance tests for #23: answers from saved decisions by kind and scope, logged as decided for you

Written first, blind, from issue #23 (its text as of October 27, 2026: Scope, Fields, the 23 acceptance criteria, Proof, References and Depends on #304, #318, #319, #348, #349, #86), its siblings #318, #319, #86, #304, #24, #34 and #18 (read only to keep their scope out), `docs/technical-design.md` (First-party extensions that ship on by default, the resolver-decisions row; An ask, and your answer getting back, with Asks stay current, One table for an ask's life and Before each command; One event log, with tables built from it, and The learned layer; Decision and rule, Ask and Budget in The contract; the Extension API and its "A resolver answers an ask for you only by naming what covers it"; the slot table's `resolver@1` row; Decided, "Question matching" and "Answers typed in a session"; How we know version 0 works) and the base commit `debda22` (`origin/main`, no implementation of #23). The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft by the job that wrote the file.

Four blind jobs share the 23 criteria. This README's surface section is the one surface for all of #23. Each job owns one folder and may extend the surface only where its criteria need it, saying so in its own section below:

| Folder | Criteria |
|---|---|
| `match/` (this job) | 9d16cbb5, 6b5caf42, 6ab3f608, cf7a32f5, eba26419, 6d3abd93, 86908fce, d5c718b3, d8c645da, 6477f693, 2395159c, b439b4e7 |
| `rules/` | b2a26445 (frozen, FAIL revokes), 65434b19 (margin 1.5 and 60 cases) |
| `budgets/` | 67403f66 (inside an approved budget), d3776517 (doesn't fit, counting reservations) |
| `permissions/` | 7232c832, 02482c32, 3b29ddde, 15c1cac3, 56633035, e3e9bdfd, 1e4ae1da |

## Run

```sh
npm ci                                   # once; npm 11 skips better-sqlite3's install script unless allowed
npm run build --workspaces               # once: the record loads @deepbuild/contracts and evidence from dist
npx vitest run tests/acceptance/23/match # from the checkout's root, with the repo's vitest.config.ts
npx tsc -p tests/acceptance/23           # type-check every folder against the surface
```

Node 24.22 or newer and `git` (the budget test reads the merge base). No network, no hub socket, no model. Every world is a real record on SQLite in its own temporary folder with the real asks core and resolver-decisions on it and a virtual clock; each is removed afterwards. The match suite takes about 7 minutes: three generated properties of 100 worlds each (about 30 to 40 s each) and the budget test, which saves 10,000 decisions through the real path (150 to 200 s on a loaded Mac).

## The surface

The issue names behaviours, a fixture file and outcomes, but no code API, so these tests define the smallest surface they need. It extends what the base already has: the asks core's resolver gate, `saveDecision`, `revokeDecision` and `refusals` (#349), the record's `decision.*` events, the ledger (#86) and the hub. The tests reach the code only through:

- **`@deepbuild/asks`**, through `packages/asks/src/index.ts`, with the additions below;
- **`@deepbuild/resolver-decisions`**, a new first-party extension package, through `packages/resolver-decisions/src/index.ts`, and its key fixture file `packages/resolver-decisions/fixtures/keys.json`;
- **`@deepbuild/record`** as it is at the base: `openRecord`, `append`, `read`, `close()`;
- **events** the tests append as the hook does: `session.start@1` (data `thread`, `worktree`), under a connection whose `project` names the repo. They read `ask.created` (its `key`), `ask.batched`, `decision.created` (`key`, `scope`, `answer`, `ask`) and `decision.applied` (`decision`, `ask`, writer `core`);
- **the perf lane**: a task in `benchmarks/budgets.json` (below).

```ts
// packages/asks/src/index.ts: additions to #318's, #319's, #320's and #349's surface

/** The change a push or a merge carries: its kind (fix, feature, …), its size in changed lines, and the paths it touches, relative to the repo root. */
export interface Change { kind: string; lines: number; paths: string[] }
/** An authority ask's subject: the effect class (push, merge, …), its target, and the change it carries. */
export interface EffectSubject {
  effect: string;
  target: { kind: string; ref: string; owner: string };   // a PR: kind 'pr', ref 'pr:215', owner 'thread:<thread that opened it>'
  change: Change | null;
}
/** A taste call's subject: the screen or journey step, and the element's stable name. */
export interface TasteSubject { screen: string; element: string }
/** A choice's or a definition's subject: the requirement or decision point it is pinned to (`req:<id>`). */
export interface PointSubject { point: string }
export type Subject = EffectSubject | TasteSubject | PointSubject;   // which one, by the ask's kind

// raise(connection, source, ask): an ask of kind authority, taste, choice or definition may carry `subject`
// (by its kind) in place of `key`. The core then sets `key` from the subject alone, never from the question's
// words, the option labels or any key the raiser gives, and keeps the subject in the ask's record.
// An ask with no subject keeps today's behaviour (its raiser's key): the core's own asks and the ledger's.

export interface Card {
  // …as today, and:
  /** The nearest saved decision, suggested and never applied, when none covers the ask. null otherwise. */
  suggested: { decision: string; answer: string; scope: string } | null;
  /** When decisions or resolvers that cover the ask disagree: each answer, with the resolver and the decision it named. [] otherwise. */
  conflict: { resolver: string; decision: string; answer: string }[];
  /** The files in a push's or merge's change that need you whatever a decision says: CI workflow files and git hook scripts. [] otherwise. */
  needs_person: string[];
}
export interface InboxRow {
  // …as today, and:
  /** For an ask decided for you, the decision it reused; null otherwise. */
  decision: string | null;
}
export interface Delivery {
  // …as today, and:
  /** For an automatic answer, the decision it reused; null otherwise. */
  because: string | null;
}
export interface Asks {
  // …as today; answer(), and:
  /** The one-click overrule of an automatic answer, on the trusted path: another option for the ask a decision answered.
   *  Saved as a decision at the ask's scope (its repo); the decision it overrules stops answering there and keeps
   *  answering wherever else it covers. Returns your new decision's handle. */
  overrule(connection: Connection, ask: string, input: { option: string; plan_hash?: string | null; token?: string }): Promise<string>;
  /** Your confirmation of the wider match the ask's card suggested (`card.suggested.decision`), on the trusted path:
   *  that decision now covers all your repos, and the ask is answered with it. */
  widen(connection: Connection, ask: string, decision: string): Promise<void>;
}
```

```ts
// packages/resolver-decisions/src/index.ts: the first-party extension (on by default; the hub registers its resolver with the asks core)
import type { Resolver } from '@deepbuild/asks';
import type { RecordStore } from '@deepbuild/record';
/** The resolver it registers: reads saved decisions from the record and answers an ask only by naming the one that covers it by kind (key) and scope. */
export function resolverDecisions(options: { record: RecordStore }): Resolver;
```

```jsonc
// packages/resolver-decisions/fixtures/keys.json: the design's key fixture file. A list of pairs; for each of the
// kinds authority, taste, choice and definition, at least one pair that must share a key and one near-miss that must not.
[{ "kind": "choice", "same": true, "why": "a paraphrase",
   "a": { "question": "…", "options": ["json", "text"], "subject": { "point": "req:…" } },
   "b": { "question": "…", "options": ["json", "text"], "subject": { "point": "req:…" } } }]
// Authority subjects name `thread:T1` for the asking thread and `thread:T2` for another one; the tests raise both asks
// in thread T1 of one repo. Option IDs: an authority ask's first option allows, the rest deny.
```

The perf lane gets a task `resolver-match-10k` in `benchmarks/budgets.json`, a #23 first measurement (its `initialReason` names #23), whose command runs to exit 0.

Nothing else is needed for `match/`. The record must accept what the core appends; the tests read no new event kind by name, so how a subject, an overrule at a scope or a widening is recorded (a new `ask.created` major or an in-place edit, a `decision.overruled` with a scope, a new `decision.created` at `all` or its own kind) is the implementer's. A sample fix kept outside this checkout passed every test (BASE-FAILURE.txt).

### Behaviour the surface carries

- **Keys.** The key is DeepBuild's, from the subject's structured fields only: for an authority ask the effect class, the target's kind, its owner and the kind of change (never the target's number, `ref`); for a taste call the screen and element; for a choice or definition the point and its options' IDs. A PR's owner is related to the asking ask's thread, so "your own fix PRs" are PRs the asking thread opened.
- **Saved for its repo.** `answer()` on the trusted path, choosing an option, saves your answer as one decision for the ask's repo (`repo:<project>`), or its session when it has no repo, whatever the ask's words claim. (At the base the hub saves it after calling `answer`; with this change the hub must not save it twice: #24 counts exactly one.) Words alone save nothing, as at the base.
- **Answered for you.** An ask a saved decision covers (same key, a scope covering its session, within its bounds, active and not overruled there) closes as decided for you: one `decision.applied` from the core, the option handed to the agent once with `because`, its inbox row's `decision`, never shown. The same holds for an ask already open when the matching decision is saved.
- **Bounds.** A decision saved from an ask with a change covers only changes of that kind and within a size bound DeepBuild sets from that change. The tests assume only that a decision saved from a 40-line fix covers 30- and 31-line fixes and not a 4,000-line one. A push or merge whose change touches `.github/workflows/…` or `.gitlab-ci.yml` (or a git hook script) is never covered; its card names those files in `needs_person`.
- **Not covered.** An ask no decision covers reaches you, with `suggested` set to the nearest decision when one is near (the same key at another scope; or the same ask kind, the most fields alike). It is never applied without `widen`.
- **Disagreeing.** When covering decisions, or several resolvers' answers, disagree, nothing is applied; the ask reaches you with each in `conflict`. Your answer to it, saved for its repo, overrules there each decision it contradicts, which keeps answering elsewhere.
- **One card.** An ask from another thread with the same key, pinned to the same thing as an open one, shows through that one: one card, and your answer reaches both sessions.

### How the later jobs reach the rest (they may refine these)

- **`rules/`.** Standing rules are decisions (`decision.created`) with a state, active, frozen or revoked, as the base's `decisions` table holds it (`record.table('decisions')`). Judging is a pure function the package exports, for example `judge(rule: { cases: number; broke: number }, yours: { cases: number; broke: number }, margin: number): { verdict: 'widen' | 'undecided' | 'FAIL'; rule: { lower: number; upper: number }; yours_upper: number; limit: number; more: number | null }`, with Clopper-Pearson one-sided 95% bounds. Each change of state is an event the core appends and the record shows; a revoked rule covers nothing (the asks core's gate already refuses a revoked decision).
- **`budgets/`.** `resolverDecisions({ record, ledger })` with #86's `Ledger`: on the ledger's `asked` outcome for a paid run, the extension answers through `ledger.resolve(connection 'ext:resolver-decisions', ask, { decision, budget })`, which the core checks against what's left, reservations included; the ask's `decision.applied` and `outcome: decided_for_you` log it. How "how much is left" is said (an `Outcome` field or the delivery's words) is that job's.
- **`permissions/`.** At the hub: a `PermissionRequest` hook raises a `permission.request` authority ask with an `EffectSubject` (effect `permission`, target the tool and its command class); resolver-decisions answers it; the reply goes through the adapter's `permissionReply` as `permission.answer@1` (`decision`: allow, deny or cancel; `for`: call or session). A cancelled ask replies cancel. A typed approval (`user.ask`) is offered back on the card or `deep inbox` and saved only by `answer()` on the trusted path. A guard (#304) or the session's permission mode denies before any decision is consulted. Plans name dependencies and cloud resources; `rules.json` (written by `packages/hub/src/guards.ts`) gains the standing rules the hub copies, and `crates/deep-hook` applies them with the hub stopped.

## Readings where the issue leaves a choice

- **"A repo-scope decision … in another repo it covers"** (6ab3f608). A repo-scope decision covers one repo, so a decision that answers in another repo is one saved for all your repos. The tests save it with `saveDecision(card, ask, 'all')` (#349's), overrule it on an ask in repo A, and read "repo-scope" as the overrule's scope: your answer is saved for repo A.
- **Saving at `all` doesn't overrule by itself.** Only your answer to an ask that showed a contradiction, or your overrule of an automatic answer, overrules, and only at that ask's scope. 86908fce's two disagreeing decisions are made that way: your prettier saved for repo A, then your dprint in repo B saved for all repos.
- **Taste calls** are answered only by "an explicit rule"; a decision you saved from your own answer is read as explicit (6d3abd93).
- **"Nearest"** isn't defined by the design. The tests use only unambiguous cases: the same key in another repo, and the only merge decision for a feature merge, with a taste decision present that must not be chosen.
- **Owner.** "Covers only PRs this thread opened": a PR opened by the thread that asks to merge it. The tests ask only in the thread that saved the decision, so both readings (the asking thread, or the saving thread) pass; the surface relates the owner to the asking thread.
- **Size bound.** Set by DeepBuild from the ask it was saved from; no size between 41 and 3,999 lines is tested.
- **Git hook scripts** are named in the Scope with no path set in the design; the tests generate only `.github/workflows/<name>.yml|yaml` and `.gitlab-ci.yml`.
- **"Reaches the inbox"** means: open, in Needs you, nothing applied, nothing delivered. "Without reaching the inbox" means closed as decided for you and never shown (no `ask.batched` names it). Every ask is still a row of the inbox projection, as at the base.
- **The 10 ms budget** times resolver-decisions' resolver on the asks the core hands it, after 10,000 decisions saved through `answer()`, with no socket, fetch or child process started meanwhile ("no model call"). The merge-base comparison is the perf lane's, as #24 and #319 left it. Off a reference Mac, on battery, with Low Power Mode on or a thermal warning, or a load average above the core count, the readings are printed and the test skips as INCONCLUSIVE; it never waits for a quieter machine.
- **Not covered by `match/`:** the hub's `deep_ask` still keys an ask on its question text and session at the base (`packages/hub/src/core.ts`, `askFor`). These tests drive the asks core, so they don't reach that path; the implementer must give `deep_ask` a subject (the requirement a choice is pinned to) for the hub to match as the core does. The hub saving a second decision after `answer()` is caught by #24's tests, not these.

## Criteria, tests and wrong programs (`match/`)

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed and the leading `- [ ] ` dropped (the command in `tests/acceptance/48/README.md`). Each test name starts with its ID. A plant is a wrong program in `match/plants.ts`, the real program with one part wrong, run by `plants.test.ts`; each must fail its criterion's scenario with the message named there.

| ID | Criterion (short) | Tests | Wrong programs it fails on | On the base |
|---|---|---|---|---|
| `#23.9d16cbb5` | a repeated question is answered without reaching the inbox | `repeat`: one; the `cites` property | do-nothing resolver | fails to load |
| `#23.6b5caf42` | another kind or scope reaches the inbox, nearest decision suggested | `repeat`: one | do-nothing (no suggestion) | fails to load |
| `#23.6ab3f608` | overrule at an ask's scope; the old decision answers elsewhere | `scope`: one; `plants`: one | plant: keeps answering from the old decision in repo A (fails naming it) | fails to load |
| `#23.cf7a32f5` | "Merge #215?" answered whatever the PR number | `merge`: one; `plants`: one | plant: keyed on the PR number (fails naming "Merge #215?") | fails to load |
| `#23.eba26419` | never another thread's PR, nor past size or kind bounds | `merge`: one and a property (seed `0x2310`, 100 cases); `plants`: two | plants: owner never read (merges #216); size never read (merges #217) | fails to load |
| `#23.6d3abd93` | one card for one screen, two for two commits; an open match closes decided for you | `join`: one | do-nothing (two cards) | fails to load |
| `#23.86908fce` | two decisions or two resolvers that disagree answer nothing | `scope`: two; `plants`: one | plant: a core that takes the first resolver's answer; do-nothing (no conflict shown) | fails to load |
| `#23.d5c718b3` | saved for its repo; another repo only after you confirm | `scope`: one; `plants`: two | plants: every answer saved for all repos (fails naming the decision); a resolver answering in another repo on #349's planted gate (fails naming the decision) | fails to load |
| `#23.d8c645da` | 10,000 decisions, under 10 ms at p95, no model call, vs the merge base | `budgets`: two | do-nothing (no task; answers from none) | fails to load |
| `#23.6477f693` | each automatic answer cites the decision it reused | `cites`: one and a property (seed `0x2306`, 100 cases) | do-nothing (nothing decided, nothing cited) | fails to load |
| `#23.2395159c` | tabs pair shares one key; another requirement reaches you | `keys`: one, 12 key pairs from the design, the fixture file; `plants`: two | plants: keyed on the question's text (fails the first, naming the pair); keyed on kind alone (answers the second, naming the pair) | fails to load |
| `#23.b439b4e7` | 30-line fix merges; plus one line in release.yml reaches you naming it | `merge`: one and a property (seed `0x2311`, 100 cases); `plants`: one | plant: size and kind bounds alone (merges it) | fails to load |

The other 11 criteria are the `rules/`, `budgets/` and `permissions/` jobs' tables.

## Files

- `tsconfig.json`: type-checks every folder under the root's strict options with `allowImportingTsExtensions`.
- `match/data.ts`: the clock, ULIDs, repos, requirements, and the asks as data (choice, definition, taste, merge) with their subjects; the changes (`FIX_40`, `FIX_30`, `FIX_30_PLUS_CI`, `FIX_HUGE`, `FEATURE_30`).
- `match/helpers.ts`: a world (record, asks core, resolver-decisions registered, sessions, raising, your answers), `decidedForYou` and `reachesYou`.
- `match/scenarios.ts`: each criterion's scenario, the design's key pairs (`BLIND_PAIRS`) and `runPair`.
- `match/plants.ts`, `match/plants.test.ts`: the wrong programs.
- `match/repeat.test.ts`, `cites.test.ts`, `scope.test.ts`, `merge.test.ts`, `keys.test.ts`, `join.test.ts`, `budgets.test.ts`.
- `match/BASE-FAILURE.txt`: the base run, the do-nothing program, the plants and the sample fix.
