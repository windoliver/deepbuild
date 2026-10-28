# Acceptance tests for #23, standing rules (`rules/`)

Written first, blind, by the `rules/` job, from issue #23 (its text as of October 28, 2026), `docs/technical-design.md` (the resolver-decisions row of First-party extensions that ship on by default; The learned layer; Decision and rule, Lifecycles and Event in The contract; Tests written first, Wrong programs, Universal rules as generated properties and Lifecycle tables checked by enumeration in How we know version 0 works; the `rules:` block of your settings), the shared surface in `../README.md` and the base commit `debda22` (`origin/main`, no implementation of #23). The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft by this job.

## Run

```sh
npx vitest run tests/acceptance/23/rules   # from the checkout's root, after npm ci and npm run build --workspaces
npx tsc -p tests/acceptance/23             # type-checks every folder against the surface
```

No network, no hub, no model, no wall clock. Each world is match/'s: a real record on SQLite in its own temporary folder, the real asks core with resolver-decisions registered, a virtual clock; each is removed afterwards. The folder takes about 15 s: ten worlds of about 100 asks each, and a generated property of 300 cases.

## The surface, added for `rules/`

Everything in `../README.md` holds. These tests add the judging of standing rules. Judging is resolver-decisions' work; recording a change of state is the core's, since only the core appends the kinds that record a decision.

```ts
// packages/asks/src/index.ts: additions
/** What a standing rule is judged on: cases decided, and how many of them later broke. */
export interface Tally { cases: number; broke: number }
/** A judgment. Rates are fractions (0.0487, not 4.87). */
export interface Judgment {
  verdict: 'widen' | 'undecided' | 'FAIL';
  rule: { lower: number; upper: number };   // the rule's breakage rate: one-sided 95% Clopper-Pearson bounds
  yours: number;                            // your rate, taken at its one-sided 95% upper bound (never 0)
  limit: number;                            // yours × margin
  more: number | null;                      // undecided: the fewest more cases with no breakage that would let it widen; null otherwise
}
export type RuleState = 'active' | 'frozen' | 'revoked';
export interface Asks {
  // …as in ../README.md, and:
  /** A standing rule's judgment, from resolver-decisions (connection writer `ext:resolver-decisions`). The core sets
   *  its state from the verdict (widen: active, undecided: frozen, FAIL: revoked; revoked is final), records each
   *  change of state as one decision.judged event, and returns the state it is in now. */
  judged(connection: Connection, decision: string, judged: { rule: Tally; yours: Tally; margin: number; judgment: Judgment }): Promise<RuleState>;
  /** As in ../README.md, and: it may name any active decision of the ask's key, the card's suggestion or another.
   *  A frozen or revoked rule can't widen: refused with an AskRefused whose message names the decision and the
   *  word for its state (`frozen`, `revoked`); the ask stays open and reaches you. */
  widen(connection: Connection, ask: string, decision: string): Promise<void>;
}
```

```ts
// packages/resolver-decisions/src/index.ts: additions
import type { Judgment, Tally } from '@deepbuild/asks';
/** The judging rule, pure: Clopper-Pearson bounds exact for the binomial, one-sided 95%. Yours at its upper bound;
 *  the limit is that times the margin; FAIL when the rule's lower bound is above the limit, widen when its upper
 *  bound is at or below it, undecided otherwise. */
export function judge(rule: Tally, yours: Tally, margin: number): Judgment;
/** What each standing rule is judged on, counted from the record over the window ending at `now`. */
export interface Evidence { decision: string; rule: Tally; yours: Tally }
export function evidence(options: { record: RecordStore; now: number; window: number }): Promise<Evidence[]>;
```

**Events.** The tests append, as the hub's watchers would record what later broke:

- `work.broke@1`, writer `core`, subject the ask, data `{ ask: 'ask:<ULID>', cause: 'revert' | 'follow_up_fix' | 'is_it_done' | 'issue' }`: the work an ask decided later broke.

The tests read:

- `decision.judged@1`, writer `core`, one per change of a rule's state, data `{ decision, state, verdict, rule: { cases, broke, lower, upper }, yours: { cases, broke, upper }, margin, limit, more }`;
- the `decisions` table's `state` (`active`, `frozen` or `revoked`), the same after `record.rebuild()`.

**Wiring, as the hub runs it on its timer** (`helpers.ts`, `judgeRound`): for each entry of `evidence({ record, now, window })`, `judge(entry.rule, entry.yours, margin)`, then `asks.judged(…)`. The margin and window are your settings' `rules: { window: 30d, margin: 1.5 }`; the tests pass them as the hub would read them. The wrong judges are handed to the same wiring in place of `judge`.

### Behaviour the surface carries

- **A standing rule** is a decision that has decided at least one ask for you (`decision.applied`) in the window. `evidence` lists each one; a decision that never answered for you isn't judged, so match/'s widening of a fresh decision is untouched.
- **The work it decided**: the asks it decided for you in the window; one breaks when a `work.broke` names it.
- **The same kind of work you decided yourself**: the asks of the rule's key you answered on the trusted path in the window, in every scope, the answer the rule was saved from included; one breaks when a `work.broke` names it.
- **Frozen** keeps deciding at its scope: the core's gate accepts a frozen decision a resolver names, and resolver-decisions keeps naming it. It can't widen (above). Judged again on more evidence, it moves to active or revoked.
- **Revoked** answers nothing and can't widen, and judging again leaves it revoked.

## Criteria, tests and wrong programs (`rules/`)

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed and the leading `- [ ] ` dropped (the command in `tests/acceptance/48/README.md`). Each test name starts with its ID. A plant is a wrong program in `plants.ts`, run by `plants.test.ts`; each must fail its criterion's scenario with the message named there, which names the rule by handle.

| ID | Criterion (short) | Tests | Wrong programs it fails on | On the base |
|---|---|---|---|---|
| `#23.65434b19` | margin 1.5, your 60 cases: 40/0 widens (7.22%); 39/0 frozen, 1 more; 1 in 40 frozen, 24 more; 7 in 40 FAILs and is revoked | `margin`: four, one world each; a property (seed `0x2365`, 300 cases) against exact bounds; `plants`: three | plants: your rate taken as the 0 observed (revokes the 1-in-40 rule); point rates (widens the 39 rule); two-sided bounds (keeps the 7-in-40 rule); do-nothing | fails to load |
| `#23.b2a26445` | frozen keeps deciding at its scope but can't widen; FAIL revokes; each change recorded and shown | `states`: two; `plants`: one | plant: a resolver that stops deciding from a frozen rule; mutant: a core whose widen lets a frozen rule through (recorded in BASE-FAILURE.txt); do-nothing | fails to load |

The scenarios (`scenarios.ts`) for `#23.65434b19` check, per rule: the counts `evidence` finds (the rule's, and your 60 with no breakage), its state in the decisions table and the recorded `decision.judged` (state, verdict, `more`, counts), the state after a rebuild, then the judgment's numbers to two decimals in percent: your bound 4.87%, the limit 7.31%, and the rule's bounds. The 40/0 rule also widens on your confirmation in repo B. The `#23.b2a26445` scenarios run the 39/0 rule on: it decides one more ask in repo A while frozen (the one more case it said it needed), your confirmation to widen it to repo B is refused naming it as frozen, judged again it is active with a second `decision.judged`, and then it widens. The 7-in-40 rule is revoked, an ask in repo A reaches you, widening is refused naming it as revoked, and it stays revoked when judged again.

## Readings where the issue leaves a choice

- **Every number in the issue reproduces** with exact one-sided 95% Clopper-Pearson bounds (bisection on the exact binomial tail, in 60-digit decimals; `bounds.ts` is the same in doubles): your 0 in 60 gives 4.8703%, the limit 7.3054% (7.31%); 0 in 40 gives 7.2158% (7.22%, widen); 0 in 39 gives 7.3938% (7.39%, undecided; 0 in 40 widens, so 1 more); 1 in 40 gives 0.1282% to 11.3188% (0.13% to 11.32%, undecided; 1 in 63 is 7.3099%, above the limit, and 1 in 64 is 7.1990%, so 24 more); 7 in 40 has a lower bound of 8.5133% (8.51%, FAIL).
- **The three wrong judges**, as the plants build them. Taking your rate as the 0 observed makes the limit 0, so 1 in 40 (lower bound 0.13%) FAILs. Point rates compare 0/39 = 0 with 0 × 1.5 = 0 and widen it. Two-sided means 95% two-sided intervals for both rates, 2.5% in each tail: your bound 5.96%, the limit 8.94%, and 7 in 40's lower bound 7.34% is below it, so the rule stays frozen. A judge that used two-sided bounds for the rule but kept yours one-sided would still revoke it (7.34% > 7.31%) and pass this test; the criterion's wording ("one with two-sided bounds keeps the rule") only holds when both are two-sided, so the plant reads it that way.
- **"Can widen"** is permission, not a widening: widening to all your repos still waits for your confirmation (Scope: "widens to all your repos only when you confirm a suggested wider match"). So "can't widen" is read as: your confirmation of a frozen rule's wider match is refused. This extends match/'s `widen` in two ways: it may name any active decision of the ask's key (in these worlds 59 other decisions share the key, so which one a card suggests is the implementer's), and it refuses a frozen or revoked rule.
- **"Recorded and shown."** Recorded: one `decision.judged` from the core per change of state. Shown: the `decisions` table's state, which the views read, and the judgment in the event (including how many more cases would decide). No new UI surface is asked for. A round that changes nothing may record nothing; the tests don't count events beyond "at least one when the state changed".
- **A standing rule** is a decision that has decided an ask for you; your 60 cases count across every scope. A judge that counted yours only at the rule's scope would see 1 case and let every rule widen; these tests fail it.
- **The design and the base:** the `decisions` table already has `state: active | frozen | revoked`, but no event at the base moves a decision to frozen, and `decision.revoked@1` carries no judgment. So the tests name one new core-only kind, `decision.judged@1`, and one new evidence kind, `work.broke@1`. The design lists the core-only decision kinds without one for judging; the implementer adds it to that list.
- **Not tested here:** the hub's timer that runs the round, reading `rules.margin` and `rules.window` from your settings (and a repo's `done.yaml` overriding them), the window cutting off old cases, how a revert, a follow-up fix, "is it done?" or a later issue becomes `work.broke`, "a rate clearly above yours, even inside the margin, comes to you once with the evidence", and pooling a kind too rare to decide within a year. None is in these two criteria.

## Files

- `bounds.ts`: the test's exact reference bounds (`upper`, `lower`) and `pct`.
- `helpers.ts`: a rule's world on match/'s (`ruleWorld`), `decideAnother`, `broke`, `judgeRound` (the hub's wiring), `stateOf`, `judgedEvents`, `judgedIn`, `recordedAs`.
- `scenarios.ts`: each criterion's scenario, taking the judge to use.
- `plants.ts`, `plants.test.ts`: the wrong programs.
- `margin.test.ts` (`#23.65434b19`), `states.test.ts` (`#23.b2a26445`).
- `BASE-FAILURE.txt`: the base run, the do-nothing programs, the plants, a mutant and the sample fix.
