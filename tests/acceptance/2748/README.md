# Acceptance tests for #2748: review passes have a home and a scope

Issue #2748, "A review pass that found bugs after a close has a home and a scope: kept in your wiki, and run by the hub
before Closes only on a diff its scope covers". Written first, blind, by a job that never saw an implementation.
Sources:

- **The issue**: its Scope, the six acceptance criteria, Proof and Depends on (it has no comments).
- **The design**, `docs/technical-design.md`: the Check primitive (its kinds; "a review's second model reads the diff,
  never the session's transcript"; the rules page's rules going "into each run's request, never into a file in the
  checkout"); What done means, fixed at the start; How runs become one of five verdicts (Pinned to a commit, Carried
  across sessions, Whose checks count, Open items as records); How we know version 0 works (Dogfooding; Tests written
  first, by a job that never sees the code; the rule for timing results); and `docs/parallel-proof.md`, section 6.
  At the base the design says nothing of where passes are kept, their scope or what their findings do; the issue's
  Scope adds that in the same PR.
- **`AGENTS.md`**, and the base commit's code, read for its surfaces only: `packages/checks-review` (`post-close.ts`:
  `PostClosePass`, `PassReviewer`, `reviewBeforeCloses`; `review.ts`: `judgeAnswer`; `types.ts`: `SendBackItem`,
  `ReviewerAnswer`), `packages/hub` (`stop-judging.ts`: the review on every claim of a session that opened a pull
  request, `closesGate`; `kinds.ts`: the rubric page, the review job's prompt and job; `core.ts`: what a review run
  is given; `rules.ts`: a rule's scope; `shared-runs.ts` and `gate-runner.ts`: carried results; `plant.ts`),
  `packages/runner` (`job.list`), and the suites of #87 (gate), #322, #323, #1018, #1512, #1537 and #1862.
- **The base commit**: `5fcfb690` (main).

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

With Node 24.22 first on `PATH`, `/usr/bin/perl` (the planted reviewer) and the Rust toolchain:

```sh
npm ci                                                                  # once
npm run build --workspaces                                              # the hub and the deep CLI the tests start
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -q -p deep-hook   # target/debug/deep-hook
node scripts/throttle.mjs test --wait 120 -- node node_modules/vitest/vitest.mjs run tests/acceptance/2748/passes.test.ts --testTimeout=600000 --no-file-parallelism
node scripts/throttle.mjs test --wait 120 -- node node_modules/vitest/vitest.mjs run tests/acceptance/2748/budgets.test.ts --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/2748/tsconfig.json
```

Lane lists of `scripts/lanes.mjs`, which the implementer edits:

- `tests/acceptance/2748/` on the one-at-a-time list (`alone`): both files start hubs of their own with a planted
  reviewer, as #1537's, #1862's and #1512's suites do.
- `tests/acceptance/2748/budgets.test.ts` on the `timed` list, beside #1018's budget test.

No network, no real model, no paid call, no `gh` login. The suite reuses, by import and unchanged: #1537's review
world and readers (`tests/acceptance/1537/helpers.ts`, standing on #322's world: a temp world under `/tmp/dh322-*` with
`HOME` set to it, the hub as a process, Claude Code sessions through the real deep-hook, `events.read`, a git with
`GIT_*` stripped and no copy of this checkout's `.git`, processes stopped by PID only), #323's drafted-check maker
(`testCheck`), #1862's `objectsIn`, and #29's `environmentProblem`.

Criteria 1 to 5 read one story, told once through one hub (`helpers.ts`, `theStory`); each planted half reads a story
of one round (two for criterion 5) through a hub planted with one wrong program (`thePlanted`). Any test run alone
tells what it needs. The first test pays for the story, so each test is given 45 minutes; a round whose claim has no
verdict within 7 minutes of its stop, or whose runs and jobs don't end within 5 minutes of the verdict, is BLOCKED,
naming what is still going and the steps reached, which the suite also prints at its end.

## The surface under test

- **The real hub**, `deep hub run`, with #322's test settings and, for the wrong programs, `DEEP_HUB_PLANT`.
- **A Claude Code session through deep-hook**, as #322, #1537, #1862 and #1512 drive it: SessionStart, the prompt,
  Read, Edit, the `git commit` Bash calls, the `gh pr create` Bash call whose result is PR 21's link, and Stop. A stop
  the reply lets through ends the turn; the next turn starts with a typed question that opens no task.
- **Real commits in the fixture repo**, made with git when deep-hook allows the agent's `git commit`, so each claim's
  snapshot is its commit; and the two merged PRs a pass found bugs in, each a real commit under the session's base.
- **Your wiki**, `<hub root>/wiki/`: the rubric page as #1537 has it, and the passes page beside it (below). The test
  writes the page as you would; no agent and no proposal touches it.
- **The socket** (cli role, control token): `events.read` (`claim.made`, `run.started`, `run.finished`,
  `verdict.made`, and any event that holds a send-back item), `windows.report` (5% of the five-hour window used),
  `job.list` (every job of the runner, each with its `result`), `run.output` (what a run printed).
- **The planted reviewer** (below), the one boundary we don't own: the second model.

## Surface choices

Every name here that the issue or the design doesn't give is a requirement on the implementation, so they are few.
Where the record's shape is the implementer's, it is read by shape.

1. **The passes page** *(chosen name and format)*: `<hub root>/wiki/review-passes.md`, beside
   `review-rubric.md`. The hub reads it for each claim, so a change you make to it holds from the next claim on.
   ```md
   # Review passes

   ## research: research against outside references

   - prompt: Check each call against the documentation of what it calls.
   - scope: src/net/**
   - found: PR 12, <base sha>..<head sha>: src/orders/load.ts:2

   ## audit: a code audit

   - prompt: Audit the change for unchecked input and unit mistakes.
   - found: PR 12, <base sha>..<head sha>: src/orders/load.ts:3
   - found: PR 17, <base sha>..<head sha>: src/orders/cache.ts:2
   ```
   A level-2 heading `## <id>: <name>` opens a pass. Under it, list items: `- prompt: <text>` (one line);
   `- scope: <pattern>[, <pattern>…]`, each pattern in the form a rule's scope has on the rules page (`rules.ts`), and
   left out for a pass with no scope, which covers every diff; and one `- found: PR <n>, <base>..<head>:
   <file>:<line>[, <file>:<line>…]` per PR the pass found bugs in, the two commits full SHAs of the repo. Other text
   on the page is prose. These are #87's `PostClosePass` fields and the scope.
2. **A pass run** *(read by shape)*: a `run.started` of the claim, on the claim's commit (`data.claim`,
   `data.commit`), whose `data.check` holds the pass's ID as a whole word (`audit`, `pass:audit` and
   `review pass audit` all do). One run per pass in scope. A run of a pass on another commit (the gate's run of a
   failed check on the merge base) isn't counted. The runs must have started by the time the claim has its verdict and
   every run of it and every job of the runner has ended.
3. **A run's output**: what the record holds of the run (its `run.finished`, and any event whose subject is the run)
   and what it printed (`run.output`), as #1512's suite reads it. A pass left out of scope is named there when its ID
   is, as a whole word; no wording is held.
4. **One ask of the planted reviewer, and the request as sent**: one job of the runner (`job.list`, any kind), whose
   `result` is the planted reviewer's answer; `given` in it is the request, byte for byte. A request asks as a pass
   when it holds that pass's prompt word for word (case and white space aside), so each pass's ask is a job of its
   own whose prompt holds the pass's prompt and a unified diff (`diff --git a/… b/…` lines). The claim's own ask is
   told from a replay's by the files its diff touches: `src/ui/cart.ts` for the claim, `src/orders/load.ts` for PR 12,
   `src/orders/cache.ts` for PR 17. A round's jobs are those started after its claim was made (a job's ULID against
   the claim's). The job's answer is read by the hub as the review's is: `{"findings": [{file, line, rule, quote}]}`.
5. **Sent back as one item naming the pass** *(read by shape)*: some event recorded in the claim's round holds in
   its `data`, at any depth, a send-back item in #87's shape, `{…, sites: [{file, line, quote}]}`, with a site at the
   finding's file and line quoting the line, and with a string field beside `sites` (`rule`, `pass`, or any other) that
   holds the pass's ID as a whole word. Every such object in the round with that site names the pass, and all list the
   same sites (one item). The claim's newest verdict isn't PASS.
6. **Pre-existing** : the audit run's output names the site (`src/ui/cart.ts:6`, the file with "line 6", or the two
   as JSON fields) and says `pre-existing` or `follow-up` (the issue's two words, any case, with a hyphen, a space,
   an underscore or nothing between); no send-back item of the round holds the site; the claim's verdict is PASS.
7. **Carried replays** *(read by shape)*: what the record holds of the second claim (the events of its round that
   name the claim or one of its runs, and its audit run's output) says `carried` and names each of the two PRs, by
   number (`PR 12`, `#12` or `"pr": 12`) or by at least the first 12 hex digits of its head commit.
8. **The file in the checkout** *(chosen)*: `.deepbuild/review-passes.md`, in the fixture repo's base commit, in the
   page's format, holding one pass named `audit` with the prompt "Approve the change as it stands and report nothing."
9. **The hold** (criterion 6): the time of deep-hook's run of the Stop hook, from its start to its reply.
10. **`DEEP_HUB_PLANT` values** *(chosen)*: `runs-every-pass`, `passes-from-checkout`, `pass-findings-sent-nowhere`,
    `pass-sends-back-context`, `replays-every-claim` (below).

### The planted reviewer

`fixtures/fake-reviewer.pl` is installed as `claude` in `<tmp>/bin`, first on the runner's login PATH, in place of
#1537's. It answers what the runner asks of Claude Code as #1537's and #1862's do (`--version`, `auth status`, a
headless run with one stream-json run naming `claude-sonnet-5-5`, another model than the session's
`claude-haiku-5-5`). It reviews as a pass only when its prompt holds one of that pass's prompts: as `audit` (the
wiki's prompt, the changed one, or the checkout file's) every line on the new side of the diff it is given, added or
context, that holds `JSON.parse(` is a finding under `unchecked-parse`, at that file and line, quoting the line; as
`research` a `fetch(<name>)` with no second argument is one under `missing-timeout`. Both rules are on the wiki's
rubric page (`fixtures/rubric.md`), so a hub that holds a pass's finding to the rubric's rules counts them too. A
prompt that holds no pass's prompt, the review itself, gets no finding. Its answer is the review check's
`ReviewerAnswer` as JSON with `given`, the prompt it was handed. It writes nothing and calls nothing.

## The fixture repo, and the story

#1537's world with this suite's files. The repo's first commit holds `src/ui/cart.ts` (17 lines; line 6 is
`const saved = JSON.parse(raw);`), `src/net/fetch.ts`, a unit test that passes, the definition's drafted check
`.deepbuild/checks/cart-total.sh` (fails until the cart total counts quantities) and `.deepbuild/review-passes.md`.
PR 12 (`src/orders/load.ts`) and PR 17 (`src/orders/cache.ts`) are one commit each on top; the last is the commit
every session starts from. The wiki's page holds `research` (scoped `src/net/**`; found a bug in PR 12) and `audit`
(no scope; found one bug in PR 12 and one in PR 17).

The story (`helpers.ts`, `tell`), one session on PR 21, each round a commit and a stop:

1. **first**: line 3 of `src/ui/cart.ts` (the total counts quantities, so the definition's check passes), PR 21. The
   hunk shows line 6 as context. Read by AC1, AC3, AC4 (second case) and AC5 (three asks).
2. **second**: line 16 of `src/ui/cart.ts`, the page and both PRs unchanged. Read by AC5 (one ask, carried replays).
3. You change the audit's prompt on the page. **changed prompt**: line 13 of `src/ui/cart.ts`. Read by AC5.
4. **net**: line 3 of `src/net/fetch.ts`. Read by AC2.
5. **finding**: line 10 of `src/ui/cart.ts` becomes `return JSON.parse(JSON.stringify(items)).length;`. Read by AC4
   (first case).

The order holds under both readings of "the claim's diff" (Ambiguities): no round before the fourth touches
`src/net/**`, the context line is in the base commit, and the added finding comes last.

Held as preconditions, each BLOCKED when it doesn't hold: the definition locks; each commit is allowed and leaves the
worktree clean; each stop makes a claim on its commit, with a verdict within 7 minutes; the first claim's commands
are green; the first claim's own ask was given a diff touching only `src/ui/cart.ts`; the planted reviewer, asked as
the audit on the first claim's diff, answered the finding at line 6 (the diff showed it as context).

## Criteria to tests

Each test name and failure message starts with its criterion's number and ID, `#2748.<first 8 hex of SHA-256 of the
criterion's text>`, the leading `- [ ] ` dropped, trimmed and white space collapsed (`scripts/proof-change.mjs`'s
`criterionId`). They came out as the six the job was told to expect. A criterion's assertions are node:assert's.

| ID | Criterion (short) | Test | What the test asserts | On the base |
|---|---|---|---|---|
| AC1 `#2748.3f7a93db` | a claim touching only `src/ui/cart.ts` starts one pass run, `audit`; its output names `research` | `passes.test.ts`, 1st | round 1's claim has exactly one pass run on its commit, the audit's; that run's output names `research`. Then the same reading of the `runs-every-pass` hub fails naming `research` | fails at its first assertion: no pass runs, naming the claim (the issue's wrong program for AC1) |
| AC2 `#2748.313eecff` | a claim touching `src/net/fetch.ts` starts both passes | `passes.test.ts`, 2nd | round 4's claim has pass runs of `audit` and `research` on its commit | fails at its assertion: the claim starts no pass |
| AC3 `#2748.b9e47f36` | a file in the checkout with a pass named `audit` and another prompt changes nothing | `passes.test.ts`, 3rd | no request of round 1 holds the checkout file's prompt; one holds the wiki's. Then the same reading of the `passes-from-checkout` hub fails naming `.deepbuild/review-passes.md` | fails at its second assertion: no request holds the wiki's prompt (the first holds: none holds the file's) |
| AC4 `#2748.03e37d58` | a finding on an added line sends the claim back as one item naming the pass; on a context line it is pre-existing and sends nothing back | `passes.test.ts`, 4th | round 5: one send-back item with a site at `src/ui/cart.ts:10` quoting the line and naming `audit`; verdict not PASS. Round 1: no item at `src/ui/cart.ts:6`, verdict PASS, the audit run's output shows the site as pre-existing. Then `pass-findings-sent-nowhere` fails the first reading and `pass-sends-back-context` the second | fails at the first case's first assertion: no send-back item at `src/ui/cart.ts:10`, the claim PASS |
| AC5 `#2748.9b366141` | a second claim asks once and reads both replays as carried; after the prompt changes the next asks all three | `passes.test.ts`, 5th | round 1 asks as the audit three times (own diff, PR 12, PR 17); round 2 once, for `src/ui/cart.ts`, and its record says carried naming both PRs; round 3 three times with the changed prompt. Then the second claim of the `replays-every-claim` hub fails the one-ask reading, naming its three jobs | fails at its first assertion: the first claim asks as the audit 0 times |
| AC6 `#2748.8023bb4b` | budgets: a claim no pass covers starts no job and gains under 5 ms on its hold | `budgets.test.ts` | five pairs after a warm-up pair, each a claim with no passes page and one with the page (`research` alone): the second starts no pass run and no job the first doesn't; the differences of the two stops' times are judged against 5 ms by the timing rule. Last, a claim touching `src/net/fetch.ts` must start the `research` run, else BLOCKED | INCONCLUSIVE at the machine gate (skipped, never passed). With the gate taken off in a throwaway copy: BLOCKED at the last step, the `research` run never starts |

## Wrong programs

Each is selected with `DEEP_HUB_PLANT=<value>` and built by the implementer in `packages/hub/src/plant.ts` (`Plant`,
`PLANTS`) and where the hub runs passes. A planted hub is the right hub in everything but the one thing named.

| Criterion | `DEEP_HUB_PLANT` | What it does wrong | Its story | Where its run must fail, naming what |
|---|---|---|---|---|
| AC1 | the merge base | nothing runs a pass | the story | AC1's first assertion: no pass run, naming the claim |
| AC1 | `runs-every-pass` | runs every pass on the wiki's page on every claim, whatever its scope | round 1 alone | AC1's count: two pass runs, naming `research` and its scope `src/net/**` |
| AC3 | `passes-from-checkout` | reads the passes from `.deepbuild/review-passes.md` in the claim's checkout, in place of the wiki's page | round 1 alone | AC3's first assertion: a request holds the checkout file's prompt, naming the file |
| AC4, first case | `pass-findings-sent-nowhere` | records what a pass finds on the claim and sends none of it back: no send-back item, and the finding doesn't move the verdict | one round whose commit changes lines 3 and 10 of `src/ui/cart.ts` | the first case's first assertion: no item with a site at `src/ui/cart.ts:10`, naming `audit` and the site (a hub that records the item and still passes the claim fails at the verdict, naming the same) |
| AC4, second case | `pass-sends-back-context` | sends back a pass's finding on a line the change didn't add or alter, as it does one on an added line | round 1 alone | the second case's "sends nothing back" assertion, naming `src/ui/cart.ts:6` |
| AC5 | `replays-every-claim` | every claim replays the pass on each PR it found bugs in, reading nothing as carried | rounds 1 and 2 | AC5's one-ask reading of the second claim: three asks, naming the three jobs |
| AC2, AC6 | none named | | | AC2: the merge base. AC6: a hub that asks anyway fails "starts no job"; beyond that, mutants |

At the base each planted hub refuses to start (`DEEP_HUB_PLANT=<value> names no planted program`), so a planted half
is BLOCKED there until the implementer builds the plant. That is never counted as the plant's failure. On the base
every test of `passes.test.ts` fails at its first reading of the story, before its planted half.

## Ambiguities

- **"A claim … whose PR would say Closes."** A claim of a session that opened a pull request (its "Opened pull
  request" reading), which is where the base runs the review, and the only point before the `gh pr create` or
  `gh pr edit` that says Closes at which a job can run: the Closes rule itself is checked inside a hook's reply. The
  pass runs must have started by the time the claim has its verdict and its runs and jobs have ended. The story's PR
  body says no Closes; the passes run on it all the same, as the review does.
- **"The claim's diff."** `reviewBeforeCloses` takes a base and a head, and #1862 has a re-review read only what
  changed since the commit the last round read. The issue doesn't say which a pass reads on a PR's second claim. The
  story is true under both: the first claim's diff is one hunk of `src/ui/cart.ts` either way; later cart rounds stay
  out of `src/net/**` either way; the net round covers `src/net/fetch.ts` either way; the context line is in the base
  commit; the added finding is the last round.
- **"Read from the record"** and **"the run's output"**: Surface choices 2 and 3. The pass's ID and the fact are held,
  no wording.
- **"The same finding on a context line."** The same pass, rule and quoted text (`JSON.parse(`), at a line of the
  first claim's hunk that the base commit already holds.
- **"Sends the claim back … so its PR can't say Closes."** Read as the send-back item and a verdict other than PASS:
  by the design a PR says Closes only when every requirement is passed by a verdict, and #322's gate refuses it
  otherwise. The refusal of a `gh pr edit` saying `Closes #n` isn't driven (below).
- **"Sends nothing back."** No send-back item at the site and, with the claim's commands green, a PASS.
- **"A second claim in the repo."** The same session's next claim on PR 21. Another session's claim in the repo isn't
  driven (below).
- **"Reads both replays as carried."** Surface choice 7. Whether a replay is a run of its own with a shared key
  (#1018's `carried` in the verdict's reasons) or a line of the pass run's output is the implementer's.
- **"After the pass's prompt changes."** You edit the page: the test rewrites `review-passes.md` between two
  claims with the audit's prompt changed and nothing else.
- **"Asks the planted reviewer once."** Counted over the audit's asks, the pass the criterion names. The review's
  own job is not a pass's ask.
- **"Compared with the merge base" (criterion 6).** The suite takes the baseline itself, on the hub under test: a
  claim made with no passes page in the wiki, which is all the merge base reads of it, against the same claim with the
  page there. A build of the merge base beside the change is not something a test file can make, so a slowdown the
  change adds to every claim, page or no page, is **not** seen by this test. The 5 ms is the issue's and is drafted.
- **"Starts no job."** No pass run, no request holding a pass's prompt, and no more jobs of the runner than the same
  claim with no page starts.
- **"Its hold."** deep-hook's run of the Stop hook. Its noise on a loaded machine is far above 5 ms, so the test reads
  INCONCLUSIVE more often than not; the rule is the design's.

## What this suite could not encode

- **The refusal of `gh pr create` or `gh pr edit` saying `Closes #n`** after a pass's send-back. The story's task comes
  from a prompt, not an issue, so #322's gate has no issue to hold; the criterion is read at the verdict.
- **That the hub calls `reviewBeforeCloses`**, runs passes "through the runner (#159)" beyond their jobs showing in
  `job.list`, or keeps them "inside the issue's budget (#325)".
- **A second claim from another session or worktree** reading the replays as carried, a hub restart between claims,
  and a replay asked again because the PR's commits or the answering model changed (only the prompt's change is driven).
- **How many bugs a replay finds again** as a reading for #43, and that it is never a pass or a fail.
- **A pass added or changed by a proposal you approve**, and that an agent can't change the page.
- **A scope of several patterns, or `all`**, and a home other than the wiki ("any home outside the checkout meets
  the criteria": these tests write the wiki's page, so another home needs a redraft).
- **The design's Check section** stating where passes are kept: a docs change, read in review.
- **A true merge-base comparison** for criterion 6 (Ambiguities).
- **Codex sessions**, and a Codex job as the second model.

## What the implementer adds outside this folder

- `scripts/lanes.mjs`: `alone.push('tests/acceptance/2748/');` and `tests/acceptance/2748/budgets.test.ts` on the
  `timed` list.
- `packages/hub/src/plant.ts`: the five planted values in `Plant` and `PLANTS`, and the wrong programs they select,
  as described under Wrong programs.

## The base run

`BASE-FAILURE.txt` holds it. In short: the story held on the base (the definition locked, every commit was allowed, every
claim was PASS with its commands green, and each round's one review job got past the runner's plan-window gate and
finished), nothing ran a pass, and all five tests of `passes.test.ts` failed at an assertion of their own; no planted
half was reached. `budgets.test.ts` skipped as INCONCLUSIVE at its machine gate.

No change was made to the hub's build output or to any file outside this folder. Two things were run beyond the two
files, both said here because they are not the suite as left: the planted reviewer was run by itself on a made-up
prompt (as the audit it answered the context line; as the review, nothing); and a throwaway copy of
`budgets.test.ts` with its machine gate removed was run once on the base and deleted, to see that its story runs:
thirteen rounds in 228 s, every claim PASS with one job, no pass run, then BLOCKED at its last step, as the test
says a hub that runs no pass must be.

**Never seen passing.** No right program exists, and none was simulated: every reading past each test's first
failing assertion, and every planted half, has only been type-checked. The readings most exposed to that are the
carried replays (Surface choice 7), the send-back item (5) and the pre-existing output (6).

## Files

- `helpers.ts`: the criterion IDs, the world, the passes page, the planted reviewer's install, a round, the story and
  the planted stories, the readers, and each criterion's reading as one function.
- `passes.test.ts`: AC1 to AC5. `budgets.test.ts`: AC6.
- `fixtures/fake-reviewer.pl`: the second model. `fixtures/rubric.md`: the wiki's rubric page.
- `tsconfig.json`: the root's strict options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit.
