# Acceptance tests for #723: learned changes that loosen safety are held, and step specs are checked at load

Written first, blind, from issue #723 (its text as of October 25, 2026: Scope, the five acceptance criteria, Proof
and Depends on; it has no comments), the design sections it rests on (The learned layer, Reading by reference, One
event log with tables built from it, Hook protocol, Before each command, Threats and what stops each one, and the
Dogfooding bullet, all in `docs/technical-design.md`), the suites of the issues it depends on
(`tests/acceptance/62`, the learned layer, and `tests/acceptance/316`, the deep-hook matcher) and base commit
`50e517d`, by a job that never saw an implementation of #723. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

Run them:

```sh
npm ci                                  # once, if node_modules is missing
npm run build --workspaces              # the packages export dist/; run it twice after a fresh install
npx vitest run tests/acceptance/723
node node_modules/typescript/bin/tsc -p tests/acceptance/723/tsconfig.json   # type check
```

They import `packages/record/src/index.ts`, `packages/contracts/src/index.ts` and
`packages/evidence/src/index.ts` by relative path with their `.ts` extension, as `tests/acceptance/62` does.
Nothing needs the network or a hub, and no test reads the clock: every world runs on a test clock that starts on
Monday 2026-10-05 09:00 UTC (day 1).

## The surface under test

The issue names a hold, a card, a guard rule and a load into a session, but no code API, so these tests use the
record's own surface (`openRecord`, `append`, `read`, `table('learned_layer')`, `rebuild`, `startSlice`, as #14
and #62 left it) and add one method to `RecordStore`:

```ts
// packages/record/src/index.ts, beside what #62 exports
export interface HeldAtLoad { target: string; reason: string }   // reason names the guard rule
export interface LearnedLoad { loaded: SliceEntry[]; held: HeldAtLoad[] }
export interface RecordStore {
  // … #14's and #62's methods …
  /**
   * What a session loads of the learned layer's step specs, playbooks and compositions: every one in force whose
   * scope covers the session, folded as startSlice folds its entries (`text` is its lines, without signs), each
   * checked against the guard rules in force now. One that a rule denies a command of is not in `loaded`; it is in
   * `held`, its reason naming the rule. Read from the record as it is now, as startSlice is.
   */
  loadLearned(session: string): Promise<LearnedLoad>;
}
```

Why a new method: the issue's load check is of step specs, playbooks and compositions, which `startSlice` doesn't
hold (it holds slice entries, your typed rules and your decisions, and #62's frozen tests compare whole slices), and
a held one must be visible beside what loaded. Why it reads the record now: `startSlice` already does, and the
layer is a projection of the log, so what a session loads comes from the log alone (both checks rebuild and
compare). The tests call `loadLearned` for each session right after that session starts, so a loader that
remembers what it loaded at the start reads the same.

**Held** is #62's state: a learned change whose diff loosens safety is still appended (the append resolves), and
its `learned_layer` row reads `state: 'held'`, with a `reason` that quotes the clause that loosens. "Its card
quotes the clause" is read as that reason: the card the app draws from it is out of this suite. A held change is
not in force, so no session loads its lines. Nothing here requires an ask to be filed for it.

No new schema is published. Learned changes and guard rules are `learn.applied@1` events (frozen), verdicts are
the published `verdict.made@1` fixtures, sessions are `session.start` and `transcript.archived`, as in #62.

## Readings where the issue and design leave a choice

- **A diff's structure.** A diff is #62's lines: `+ <line>` adds one, `- <line>` removes one, and a `-` line with
  a `+` line for the same field is a replacement. On the structured targets, step specs (`step:`), playbooks
  (`playbook:`), compositions (`composition:`), extension patches (`ext:<owner>/<name>`) and guard rules
  (`guard:`), each line is `<field>: <value>`, split at the first `: `. On the free-text targets (`wiki:`,
  `slice:`, `offer:`, `drafting:`) a line is text, as #62 wrote it.
- **The fields the classifier knows** (the tests use these spellings):
  - in a step spec, playbook or composition: `run` (a command it runs), `check` (a check it runs), `assert` (an
    assertion), `verify` (a certificate or signature check), `mode` (the permission mode it runs an agent in) and
    `note` (prose; it changes nothing that runs);
  - in an extension patch: `grant.words` (an access word from access@1), `grant.hosts` (an egress host),
    `grant.paths` (a path glob), `guard.<name>.<field>` for each field of a guard@1 entry the manifest lists
    (`match`, `scope`, `mode`, `reason`, `next_step`, `fail_closed`), and `note`;
  - a guard rule's lines are its guard@1 fields: `match`, `scope`, `mode`, `reason`, `next_step`, `fail_closed`.
- **What loosens** (each is held, its reason quoting the line as written without its sign):
  - removing or narrowing a verification step: a `-` line of `check`, `assert` or `verify` in a step spec,
    playbook or composition, unless the same line comes back. Replacing one (`--project=all` by `--project=smoke`)
    is narrowing; the reason may quote either line. This holds whether or not the check ever caught a bug.
  - widening a grant: a `+` line of `grant.words`, `grant.hosts` or `grant.paths`. A `-` line of one narrows and
    applies (AC2's removed host, AC5's removed path).
  - widening a permission mode: a `+ mode:` line whose mode lets more through than the one it replaces, in the
    order `plan` < `default` < `acceptEdits` < `bypassPermissions`. The reverse narrows and applies.
  - lowering a guard's coverage: a `-` line of a listed guard's field that isn't replaced by one at least as strong:
    `mode` lowered in the order `watch` < `warn` < `block`, or `match` replaced (the classifier can't vouch that a
    new match is as wide, so a replaced match counts as lowering). Adding a guard, or raising its mode, applies.
  - a flag known to switch verification off, in any added line of any target in the closed list: `--insecure`,
    `curl` with `-k`, `NODE_TLS_REJECT_UNAUTHORIZED=0`, `GIT_SSL_NO_VERIFY` and `verify=False`. Their twins apply:
    `curl https://…` without `-k`, `verify=True`, and the same instructions without the flag.
  - a change to a field the classifier doesn't know, inside a grant (`grant.<unknown>`) or a step (an unknown field
    of a step spec), added or removed: a removal of an unknown field may lift a limit, so it is no narrowing the
    classifier can vouch for. The tests mint each unknown field name from fresh random hex on every run
    (`helpers.ts`, `unknownField`), so no list of names can know it ahead of time.
- **Whatever its replay shows.** Every planted loosening change carries `replay: {tasks: 20, regressions: 0}` and is
  applied by the local-first rule (`rule:localfirst`) to the session it came from, citing first-hand evidence (your
  message in that session), so #62's checks would apply it; only the loosening holds it.
- **What the tests leave alone.** Every loosening change here is applied by the local-first rule. Changes you apply
  yourself (`applied_by: "you"`, from the app) appear only as the non-loosening baselines a test starts from; whether
  your own apply of a loosening change is held is not tested.
- **How definitions are drafted (an open point for the owner).** The Scope says the hold covers every target in the
  closed list, "beside the existing rule that holds a change dropping a check that once caught a real bug". #62's
  frozen AC7 (`tests/acceptance/62/drafting.test.ts`) requires dropping `app.lint`, a check that never caught a bug,
  from `drafting:shop` (`- app.lint`) to **apply**. AC3's "removes a verification step that never caught a bug" would
  hold it. These tests don't decide between them: AC3's verification steps are the `check`/`assert`/`verify` lines of
  step specs, playbooks and compositions, and a drafting target's check list keeps #62's rule. A flag in a drafting
  line is still held (the Proof's `drafting:shop` case). If the owner wants drafting check lists held too, #62 AC7
  needs an approved change; this suite would not need one.
- **A guard rule you add** is a base change, the way #62 records a rule you typed: a `learn.applied` with
  `layer: "base"`, `target: "guard:<name>"`, `applied_by: "you"`, `scope: "all"`, from the `app` connection, citing
  your message, its diff one `+ <field>: <value>` line per guard@1 field (`helpers.ts`, `addGuard`). The frozen
  `learn.applied@1` fixture 02 is exactly such a base change to `guard:no-kill-by-name`. It is in force from its
  place in the log, so a projection can read it; nothing here reads `~/.deepbuild/rules.json`, which the hub
  rewrites from what is installed. The rule's `match` is read as deep-hook's matcher reads it
  (`crates/deep-hook/src/matcher.rs`, the one matcher every guard runs through); AC4 uses only the `run:` form
  (`run:npm publish`, `run:npx playwright`) against plain command lines, so the test doesn't depend on wrappers or
  quoting. A rule **denies** a command when its mode is `block`; a `watch` rule only records, so a spec it matches
  still loads.
- **"At the next session start on day 3."** Day 1 is T0, day 2 T0 + 24 h, day 3 T0 + 48 h. The step spec and the
  playbook are applied by you for the repo (`repo:shop`) on day 1, so later sessions in shop load them. The day-2
  session starts, and loads them, before the rule is added that day. The test appends no learned change about them
  after day 1 (it checks the log for that); it does not forbid the core recording its own check. What a session
  already open when a rule is added loads afterwards is not asserted.
- **Held at load, naming the rule**: the day-3 session's `held` entry for the spec has a reason containing the rule's
  name (`no-npm-publish`), and the spec is not in `loaded`.

## Criteria to tests

| ID | Criterion (short) | Test | The wrong program, and how it fails |
|---|---|---|---|
| AC1 | a step spec change adding `curl -k`, replay 20/0, is held naming the flag | `loosening.test.ts` AC1 | a layer that applies it on its replay: state `applied`, not `held`; one holding any curl or any added command: the twin `curl https://…` is held, not applied; one that marks the row but still loads the line: the session's journeys step holds `curl -k` |
| AC2 | an extension patch adding an egress host is held naming the host; removing a host applies | `loosening.test.ts` AC2 | a layer with no hold applies the added host; one holding every grant change holds the removal |
| AC3 | removing a verification step that never caught a bug is held naming the step | `loosening.test.ts` AC3 | a classifier holding only checks named in a FAIL verdict applies the removal of `shop.visual` (PASS only); one holding every removal or check-list change holds `+ check: shop.a11y` or `- run: npm run seed` |
| AC4 | a step spec applied day 1, a rule denying one of its commands added day 2: held at the day-3 session start, naming the rule | `load.test.ts` AC4 | a loader that checks only when a change applies loads it on day 3; one holding every spec after any rule, or reading a watch rule as a denial, holds the journeys spec; one keeping the hold outside the log differs after the rebuild |
| AC5 | an unknown field inside a grant counts as loosening and is held | `loosening.test.ts` AC5 | a classifier that lets unknown fields through applies the added or the removed field (its name is fresh random hex each run); one holding every grant change holds the removed known path |
| Proof | one planted loosening change of each kind, held with its quoted clause; a step spec held at load by a rule added after it applied | `proof.test.ts`, `load.test.ts` | 18 planted changes over all eight learned targets (a check, an assertion and a signature check removed; a check narrowed; an access word, a host and a path widened; a permission mode widened; a guard's mode and match lowered; each of the five flags; an unknown field in a grant and in a step), every one held with its clause, beside 13 controls that apply, so a layer that holds nothing or holds everything fails, named per case; the session then loads the verification lines and none of the loosening ones; `learned_layer` and the session's load rebuild to the same rows |

The suite was checked against a throwaway right program (built in a copy outside this worktree and deleted, never
in the repo): all six tests and #62's suite pass on it. Six mutants of it each failed the tests named: unknown fields
let through (AC5, Proof), verification removals held only for a check with a FAIL verdict (AC3, Proof), a loader
that checks no guard (AC4), every grant change held (AC2, AC5, Proof), watch rules read as denials (AC4), and any
`curl` held (AC1, Proof). The other wrong programs in the table were not planted.

## Files

- `helpers.ts`: the test clock, ULIDs, connections, sessions with archived transcripts, learned changes, guard rules
  you add, verdicts, unknown field names, reads of `learned_layer` and of `loadLearned`, and row comparison.
- `loosening.test.ts` (AC1, AC2, AC3, AC5), `load.test.ts` (AC4), `proof.test.ts` (Proof).
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`, as `tests/acceptance/316`.
- `BASE-FAILURE.txt`: the run on the base commit, where every test fails at a named assertion: the layer applies
  every loosening change (`applied`, not `held`), and the record has no `loadLearned`.

No fixture holds a secret or personal data; the hosts (`*.example.net`, `*.shop.test`), IDs and quotes are made up.
