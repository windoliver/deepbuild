# Acceptance tests for #1512: text-only rules join the review

Issue #1512, "Text-only rules join the review: each rule in scope of a diff becomes a rubric line, so a broken rule can
send a change back and be counted". Written first, blind, by a job that never saw an implementation. Sources:

- **The issue**: its Scope, the eight acceptance criteria, Proof and Depends on, and the body of #1453 (the enforcer
  and the count sit on the Rules page, with no new page).
- **The design**, `docs/technical-design.md`: the Check primitive (its kinds, and the review paragraph: "The hub puts
  into each run's request, never into a file in the checkout, every text-only rule on the rules page that you wrote or
  kept and whose scope covers a path in the diff, as rubric lines up to a size the check's spec sets; a rule left out
  is named in the run's output and stays text only for that run. A finding under such a rule names its ID. The rules
  page then reads review as that rule's enforcer, one that can send back and can't pass, and shows how many
  send-backs named it in the last 30 days and how each ended."); How runs become one of five verdicts; Before each
  command ("Your written rules, enforced"); the `wiki` row of the first-party extensions (how a claim was known; the
  rules page naming a guard only while its planted call is denied and its twin allowed); The learned layer (agents
  propose changes with `deep_propose` and can't apply any, their own included); How we know version 0 works (Criteria
  to tests, Wrong programs, Dogfooding, Tests written first).
- **`AGENTS.md`**, and the base commit's code, read for its surfaces only: `packages/checks-review` (`ReviewSpec`,
  `ReviewRequest`, how a finding counts), `packages/hub` (`kinds.ts`: `reviewSpec` and the review job's prompt;
  `stop-judging.ts`: the review on every claim of a session that opened a PR; `review-rounds.ts`: `review.read@1` and
  `review.settled@1`; `rules.ts` and `session-memory.ts`: the rules page; `mcp-operations.ts`: `deep_propose`;
  `plant.ts`; `runs.ts`: what a kind's run leaves in `run.finished` and `run.output`), `packages/runner` (`job.list`),
  `packages/wiki` (how a claim was known), and the suites of #1537, #1862, #344, #322 and #26.
- **The base commit**: `f6ddd396` (main).

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

With Node 24.22 first on `PATH`, `/usr/bin/perl` (the fake reviewer) and the Rust toolchain:

```sh
npm ci                                                                  # once
npm run build --workspaces                                              # the hub and the deep CLI the tests start
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook   # target/debug/deep-hook
npx vitest run tests/acceptance/1512 --testTimeout=600000 --hookTimeout=180000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1512/tsconfig.json
```

Every hook of every session runs `target/debug/deep-hook`: a machine that clears `target/` while the suite runs fails
it with `spawn …/deep-hook ENOENT`, so build it again right before a run if it's gone.

The suite starts hubs of its own, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list (`alone`), beside
#1537's and #1862's; the implementer adds it. No network, no real model, no paid call, no `gh` login. It reuses, by
import and unchanged: #1537's review world and readers (`tests/acceptance/1537/helpers.ts`, standing on #322's world:
the temp world under `/tmp/dh322-*` with `HOME` set to it, the hub as a process, Claude Code sessions through the real
deep-hook, `events.read`, processes stopped by PID only), #1862's reader of the fake reviewer's calls (`reviewCalls`),
#344's `deep guard add`, `goodGuard`, `deep rules sync` and rules-page reader, and #26's agent stand-in with its own
`deep mcp` (`Agent`, `initialize`, `callTool`) for the session that proposes a rule.

Every test reads one story, told once through one hub (`helpers.ts`, `theStory`); the planted halves read two
one-round stories, each through a hub planted with a wrong program (`thePlanted`). Any test run alone tells what it
needs. The first test pays for the story, so each test is given 45 minutes; a round whose claim has no verdict within
7 minutes of its stop, or whose runs and review jobs don't end within 3 minutes of the verdict, is BLOCKED, naming
what is still going and the steps reached, which the suite also prints at its end.

## The surface under test

- **The real hub**, `deep hub run`, with #322's test settings and, for the wrong programs, `DEEP_HUB_PLANT`.
- **A Claude Code session through deep-hook**, as #322, #1537 and #1862 drive it: SessionStart, the prompt, Read,
  Edit, Write, the `git commit` Bash calls, the `gh pr create` Bash call whose result is PR 21's link, and Stop. A
  stop the reply lets through ends the turn; the next turn starts with a typed question that opens no task.
- **Another Claude Code session with its own `deep mcp`** (#26's agent stand-in), whose agent calls `deep_propose`.
- **Real commits in the fixture repo**, made with git when deep-hook allows the agent's `git commit`, so each claim's
  snapshot is its commit.
- **`deep guard add`** and **`deep rules sync`** (#344), and **the rules page** `~/.deepbuild/wiki/rules.md`, read
  with #344's reader: one claim line per rule, `- <text> <!-- deep:claim {...} -->`, with `id`, `known`, `file`,
  `scope`, `enforcer` and `tokens`.
- **The socket** (cli role, control token): `events.read` (`claim.made`, `run.started`/`run.finished`,
  `verdict.made`, `review.read`, `learn.proposed`, and what would keep a proposal: `learn.applied`, `ask.answered`,
  `decision.created`), `windows.report` (5% of the five-hour window used), `job.list` (the runner's jobs; of kind
  `review`, each with its `result`), `run.output` (what a run printed, as `deep run follow` reads it).
- **The fake reviewer** (below), the one boundary we don't own: the second model.

### The request as sent to the second model

Each review job is one call of the fake reviewer, which echoes its whole prompt as `given` in its answer; `job.list`
returns that answer as the job's `result` (#1862's reader). The part of `given` before its first `diff --git ` line
holds the instructions and the rubric; the rest is the diff (the base puts rubric lines after a `Rubric:` line and the
diff after `Diff:`; the tests don't rely on those words). A request **gives** a rule when that part holds the rule's
text, case and white space aside; it **names** a rule when that part holds its text or its ID. The diff's files are
read from its `diff --git a/… b/…` lines.

### A rule's ID, in a rubric line, a finding and a send-back *(chosen)*

A rule's ID is its `id` on the rules page (#344's claim line; its handle `wiki:rules#<id>` holds it). A rubric line
the hub adds holds the rule's text and its ID on one line *(chosen)*, as `- <id>: <text>` or
`- wiki:rules#<id>: <text>` do; any other words on the line are the implementer's. The fake reviewer cites a rule by
the word of that line that holds the ID, a leading or trailing mark taken off (`wiki:rules#<id>:` cites
`wiki:rules#<id>`), so the finding's `rule`, and the send-back item's, names the ID. The check's own rule (a finding
counts only when its rule is one of the rubric's) is the implementer's to keep with that word.

### Sent back

Read from the record, through #87's and #1862's surfaces: the claim's round, `review.read@1` (`{pr, claim, commit,
sent, open}`), lists in `sent` an item `{rule, sites: [{file, line, quote}]}` whose `rule` names the rule's ID, with a
site at the file and line and a quote of that line; and the claim's newest verdict isn't PASS ("a model's finding can
send a change back and can never pass it").

### The run's output *(chosen reading)*

What the record holds of the review run on the claim's commit, its `run.finished` and any event whose subject is the
run, and what the run printed, read with `run.output`. A rule left out is named there when its ID or its text is.

### The rules page's enforcer and count *(chosen)*

After the reviews, a text-only rule the reviews held reads `{"kind": "review", …}` as its `enforcer` *(chosen kind
name)*, and the rule with a working guard keeps `{"kind": "guard", "name": "no-force-push"}`. A rule's claim line
carries `sent_back: {count, fixed, left}` *(chosen)*: how many send-backs named it in the last 30 days, and how many of
them ended fixed and left, from what #87 and #1862 record (`review.read@1`'s `sent`, `review.settled@1`'s
`ItemOutcome`s).

### The fake reviewer

`fixtures/fake-reviewer.pl` is installed as `claude` in `<tmp>/bin`, first on the runner's login PATH, in place of
#1537's. It answers what the runner asks of Claude Code as #1537's and #1862's do (`--version`, `auth status`, a
headless run with one stream-json run naming `claude-sonnet-5-5`, another model than the session's
`claude-haiku-5-5`). Once the rules page is synced, the test tells it the one rule it reviews by: "no default
exports", its ID on the page, and a pattern for a line that breaks it (`export\s+default`). It reviews by that rule
only when its prompt's rubric part holds a line with the rule's text and its ID, and it cites the rule as above. Every
line on the new side of the diff it is given, added or context, that the pattern matches is then a finding at that
file and line, quoting the line. A rule its prompt doesn't give it is never cited; a line its diff doesn't show is
never a finding. Its answer is the review check's `ReviewerAnswer` as JSON, `{"findings": [...], "summary": "…",
"given": "…"}`. It writes nothing and calls nothing.

## The fixture repo, and the story

#1537's world (its repo with `src/auth.js`, the unit test, `.deepbuild/done.yaml` and R1's drafted check; PR 21's
recorded GitHub answers; your plan reserve; a made-up Claude Code sign-in; the wiki's rubric page
`~/.deepbuild/wiki/review-rubric.md` with three rules), its base commit also holding:

- `AGENTS.md`: `never force-push`, enforced by the guard `no-force-push` (#344's `goodGuard`, added with
  `deep guard add`: planted call `git push --force origin main` denied, twin `git status` allowed, `proofs.rule` the
  rule's words). Scope `all`.
- `.github/instructions/exports.instructions.md`, `applyTo: "src/**"`: `no default exports`, the issue's text-only
  rule. Scope `src/**`.
- `docs/AGENTS.md`: 60 text-only rules, scope `docs/**`, each 46 tokens by the page (2,760 together).
- `docs/a.md`.

The story (`helpers.ts`, `tell`):

1. The hub starts; the window reads 5%; the guard is added. Another session in the repo, asked "What does
   src/auth.js export?", has its agent call `deep_propose` with target `wiki:rules` and the change `Add the rule "Keep
   every exported function under forty lines" for every file of the repo.`; nobody answers its ask. Your session opens
   the task ("make the auth middleware reject expired tokens, then open a pull request"), and `deep rules sync` writes
   the page.
2. **Round A**: the auth fix (the spec's unit check and R1's check pass), a Write of `src/a.ts` whose line 1 is
   `export default function total(…)`, the commit, PR 21, the stop.
3. **Round B**: a Write of `src/b.ts` whose line 1 is `export default function count(…)`, the commit, the stop.
4. **Round C, the clean twin**: `src/a.ts`'s line 1 becomes `export function total(…)`, the commit, the stop.
5. **Round D**: `docs/a.md` gains a line, the commit, the stop.
6. `deep rules sync` again.

Each round waits for its claim's verdict and for every run of the claim and every review job to end. Held as
preconditions, each BLOCKED when it doesn't hold: the guard installs; the proposal is a `learn.proposed` applied by no
one, its ask unanswered and nothing kept; the definition locks; the page lists "no default exports" (scope `src/**`,
no guard), "never force-push" with the guard, and the 60 rules for `docs/**` larger together than 1,500 tokens; each
commit is allowed and leaves the worktree clean; each stop makes a claim on its commit; round A's commands are green;
round C's and round D's reviews are given their commit's change (`src/a.ts` alone, `docs/a.md` alone).

## Criteria to tests

Each test name and failure message starts with its criterion's number and ID, `#1512.<first 8 hex of SHA-256 of the
criterion's text>`, trimmed and white space collapsed (`scripts/proof-change.mjs`'s `criterionId`). All eight are in
`review.test.ts`; a criterion's assertions are node:assert's.

| ID | Criterion (short) | What the test reads |
|---|---|---|
| AC1 `#1512.2a53228d` | a default export in `src/a.ts` is sent back naming the rule, with file, line and quote | round A's `review.read` sends back an item whose rule names "no default exports"'s ID, with a site at `src/a.ts:1` quoting `export default`; claim A's verdict isn't PASS |
| AC2 `#1512.08d20c73` | the same rule on a diff touching only `docs/a.md` isn't in that run's rubric | no request of round D names "no default exports" (its text or ID); each gives at least one rule for `docs/**`. Then the same reading of the planted hub's docs round fails, naming the rule |
| AC3 `#1512.eb715105` | the clean twin, with a named export, gets no finding on the rule | each request of round C gives the rule; round C sends back nothing naming it, and no review run of claim C failed naming it |
| AC4 `#1512.efb173ff` | a rule an agent proposed and you never kept isn't in the rubric, from the request | no request of the story gives "Keep every exported function under forty lines"; round A's requests give "no default exports". Then the same reading of the planted hub fails, naming the proposed rule |
| AC5 `#1512.53c08786` | a rule with a working guard stays out of the rubric; the page keeps the guard | no request of the story names "never force-push"; round A's give "no default exports"; after the reviews the page keeps the guard as its enforcer and reads review as "no default exports"'s. Then the planted reading fails, naming the guarded rule |
| AC6 `#1512.30209e04` | with 60 rules in scope, the added lines stay under the drafted size and the output names each rule left out | round D's request: the page's `tokens` of the rules it gives sum to at most 1,500; each of the 60 it doesn't give is named in the run's output; it gives at least one of them |
| AC7 `#1512.0ff8d322` | after two send-backs naming one rule, the page shows 2 and how each ended; the count never moves a verdict | rounds A and B each send back an item naming "no default exports"; after the story its line shows `sent_back` `count` 2, `fixed` 1 (`src/a.ts:1`, by commit C), `left` 1 (`src/b.ts:1`); claims C and D, judged after the second send-back, are PASS |
| AC8 `#1512.fd4a9a15` | a claim that opens a PR through a real hub starts one review run, from the record | claim A has exactly one review run on its commit (a run of the review on the merge base isn't counted). Then the same reading of the planted hub fails, naming its claim |

## Wrong programs

| Criterion | Wrong program | How |
|---|---|---|
| AC1 | a review that ignores the rules page passes it | the merge base, which is that program: claim A passes there (`BASE-FAILURE.txt`) |
| AC2 | a rubric that always holds every rule fails, naming the rule | `DEEP_HUB_PLANT=rubric-holds-every-rule` *(chosen)*: the review's rubric holds every rule the hub knows, whatever its scope, how it was known, whether you kept it and whatever enforces it (every rule on the rules page, and every rule an agent proposed), and no size bound leaves one out. The planted story is one round whose commit changes `docs/a.md` alone (its commands red: the review still runs). AC2's test fails there naming "no default exports" and its ID |
| AC4, AC5 | none named | the same plant: AC4's reading fails naming the proposed rule, AC5's naming "never force-push" |
| AC6 | a run that drops them unnamed fails, naming the count | the merge base gives none of the 60 and names none: AC6 fails there naming the count. A run that gives rules up to the size and names none left out fails the same assertion |
| AC8 | a hub with no caller for the review check starts none and fails, naming the claim | `DEEP_HUB_PLANT=review-without-caller` *(chosen)*: the hub holds the review kind, but nothing adds the review to the checks of a claim that opens a PR. The planted story is round A alone. AC8's test fails there naming claim A |
| AC3, AC7 | none named | the merge base fails both at an assertion; beyond it, mutants of the lines the change adds |

At the base each planted hub refuses to start (`DEEP_HUB_PLANT=<value> names no planted program`), so a planted half
is BLOCKED until the implementer builds the plant.

## Readings where the issue leaves a choice

- **The rule's ID** is the rules page's `id`, and a rubric line holds it with the rule's text (above). Whether the
  word is the bare `id` or the handle is the implementer's.
- **"Sent back"** is the round's `sent` item and a verdict other than PASS. At the base a review's finding is run
  again on the merge base, reads the same diff there and fails again, so the claim is BLOCKED as inherited (seen
  while this suite was written, with a finding under the wiki rubric's `swallowed-error`); FAIL and BLOCKED both read
  as sent back here. Where the send-back reaches the session and in what words are the hub's: at the base the stop's
  reply named neither the rule nor the line (the review ran in the slow lane and the reply read "says done 2/2 · 2
  tests · next: DeepBuild"), and the tests hold neither.
- **In scope of the diff.** A rule's scope (#344: `all`, a nested file's `<folder>/**`, or a glob as written) covers a
  path of the diff the run is given. With #1862's rounds a re-review reads only what changed since the last round's
  commit, so round D's diff touches `docs/a.md` alone though the PR's whole diff holds `src/a.ts`; the test holds
  that diff as a precondition before it reads the rubric. "A rule with no path scope covers every diff": the guarded
  rule (scope `all`) and the proposed rule (no path) would cover every diff in the story; their enforcer and their
  provenance keep them out.
- **"A rule an agent proposed and you never kept"** is an agent's `deep_propose` of a new rule (target `wiki:rules`):
  a `learn.proposed` applied by no one, and an ask whose "Apply it" would apply it, never answered, with nothing kept
  through `deep memory keep` either. Why: the design's learned layer has agents propose changes with `deep_propose`
  and never apply one, their own included, and "kept" is your act (applying it, or `deep memory keep` on #111's
  keep-or-remove list). An agent's Edit adding a line to a rule file was the other candidate; it wasn't chosen, since
  the design speaks of an agent's edit only as removing or weakening a rule line, and the base page reads a rule file
  as it stands. The proposing session is another session in the same repo, through #26's stand-in, because only a
  `deep mcp` whose parent is the session's own process binds to it, and #322's sessions run no `deep mcp`.
- **The drafted size, and how it's measured.** The added lines' size is the sum of the rules page's `tokens` over the
  rules the request gives; "stay under" is at most 1,500. The page's sizes (`tokensOf` in `rules.ts`: each word piece
  of up to five letters, each number and each mark is one) are what the page shows; a measure that also counts the
  ID and the line's marks counts more, so a hub that holds to 1,500 by it passes too. The 60 rules sum to 2,760, so
  some must be left out. Which ones is the implementer's.
- **Where the size comes from.** The check's spec; only the drafted value, 1,500, is held.
- **"Named in the run's output"**: by ID or by text, in the review run's record or what it printed (above).
- **Review as the enforcer** is read after the reviews held the rule. #344's suite reads a text-only rule with no
  review as `text`; this suite doesn't read the page for review before any review ran.
- **The count, and how each ended.** A send-back is one round's item naming the rule (rounds A and B here); how it
  ended is #1862's `review.settled` outcome for it: `src/a.ts:1` fixed by commit C, `src/b.ts:1` left. Both lie within
  the last 30 days.
- **"Never moves a verdict"**: the claims judged after the second send-back with nothing sent back of their own,
  claim C (in the rule's scope) and claim D, are PASS, as they are with no count at all (the base). That claim C
  passes with `src/b.ts:1` still open is #1862's behavior at the base.
- **One review run** is one run of the review on the claim's commit; the gate's run of a failed check on the merge
  base isn't counted.
- **The second model is Claude Code's**, through the runner, as in #1537 and #1862.

## What this suite could not encode

- The note that review "can send back and can't pass" on the rules page (Scope), and that a rule left out "stays text
  only for that run".
- A rule sent back in two tasks feeding #1107 as a failure class.
- Claims an agent inferred, or that rest on outside content, on the rules page: no base surface puts one there for a
  rule, so only the proposed rule is driven.
- The size as a field of the check's spec, and a size other than the drafted one.
- The 30-day window's edge (a send-back 31 days old), and a count across two PRs or tasks.
- The app's Rules page (`crates/deep-app`), beyond the page file it reads.
- Where a send-back reaches the session, and in what words.
- Codex sessions, and a Codex job as the second model.

## What the implementer adds outside this folder

- `scripts/lanes.mjs`: the folder on the one-at-a-time list, `alone.push('tests/acceptance/1512/');`, with a line
  saying its suite starts hubs of its own with a fake reviewer, as #1537's and #1862's do.
- `packages/hub/src/plant.ts`: the two planted values, `rubric-holds-every-rule` and `review-without-caller`, in `Plant`
  and `PLANTS`, and the wrong programs they select in the hub, as described under Wrong programs.

## Files

- `helpers.ts`: the criterion IDs, the world and its fixture rules, the fake reviewer's install, the proposing
  session, the story and the planted stories, and the readers (the request, a round's send-back, a run's output, the
  rules page), with the readings AC2, AC4, AC5 and AC8 share with their planted halves.
- `review.test.ts`: AC1 to AC8.
- `fixtures/fake-reviewer.pl`: the second model.
- `tsconfig.json`: the root's strict options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit.
