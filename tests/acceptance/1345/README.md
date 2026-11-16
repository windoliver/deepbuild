# Acceptance tests for #1345: taste calls wait for you, the work doesn't

Written first, blind, from issue #1345 as of 2026-11-15 (Scope, the eight criteria, Proof, Overlaps, Depends on; it has
no comments), at base `0e5572731` (origin/main), by a job that never saw an implementation; none existed. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

| AC | ID | Criterion, in short | File |
| --- | --- | --- | --- |
| AC1 | `#1345.21f21363` | a reversible change with one open taste call lands, its issue stays open naming the call, no view reads PASS; a planted lander that records a PASS fails, naming the claim | `lands.test.ts` |
| AC2 | `#1345.ba6681c8` | a change that reaches a release, or a published page, stays held; a planted lander that lets it through fails, naming the change | `held.test.ts` |
| AC3 | `#1345.9c5710a8` | five calls from five issues reach one person as one card, and that day raises one notification | `batch.test.ts` |
| AC4 | `#1345.464309b0` | a call unanswered at its deadline takes its recommended answer, the issue closes, the record reads default, never your answer | `deadline.test.ts` |
| AC5 | `#1345.cdb5061b` | a "no" starts an attempt on that issue and raises no second ask | `no.test.ts` |
| AC6 | `#1345.45221c69` | issues blocked by a landed change with an open call start; issues blocked by a held one don't | `blocked.test.ts` |
| AC7 | `#1345.aaa324a9` | five calls draw as #328's card with five rows, no second batch card; a row whose Send back would revert says so before it's pressed; a planted row that reverts unannounced fails, naming the issue | `batch.test.ts` |
| AC8 | `#1345.69fa185d` | each row of the five-row card shows when its recommended answer applies, the rows add up to the count; a planted card with no time on a row fails, naming the row | `batch.test.ts` |

Each test's name is its criterion's ID and full text (`#1345.` and the first 8 hex digits of SHA-256 of the
criterion's text, white space collapsed, as `scripts/proof-change.mjs` computes it). AC3, AC7 and AC8 share one file
and one world, the five calls from five issues they all speak of; every other criterion has a world of its own.

The Proof, a fixture run with five calls across a day, its one card and what each answer did, is what these tests
run: `batch.test.ts` is its five calls and card (and one Send back pressed), `deadline.test.ts` the call nobody answers,
`no.test.ts` a "no". No live test is written, so nothing here touches GitHub or a paid model.

## What was read

- Issue #1345 (`gh issue view 1345 --comments`): no comments.
- `docs/technical-design.md` at the base: An ask, and your answer getting back; An agent says it's done; Decision and
  rule, Ask and Verdict under The contract (kernel); the **Work runs** and **Landing in turn** bullets under Later, as
  extensions; First-party extensions that ship on by default (done-gate, resolver-decisions, view, and the `done.yaml`
  with its `asks` settings); Needs-you view; Decided (its ask and taste rows); States people see; the Dogfooding
  paragraph under How we know version 0 works. `AGENTS.md` (Proof).
- For context only, read-only: #84, #1331 (and its comments: `settled_by: "budget-window"`, the gate's landing
  identity), #1335, #1342, #1347, #328 and its parts #2030 (the batched taste card) and #2027, #1461, #357, #1332, #1011.
- At the base `0e5572731`, for surfaces and conventions only: `packages/hub/src/landing.ts` (`landing.made`, `onlyWindow`,
  the budget window's landing: `Part of`, the issue reopened and a comment naming the requirement), `stop-judging.ts`
  (`judgeLanding`, `judgeMerge`, `VERDICT_WAIT_MS`), `work.ts` and `work-rule.ts` (#1332's run, #1335's standing rule,
  `work.state`, `work.attempt`, `deep work show`, done for dependents), `starts.ts`, `ask-tasks.ts` (handed
  definitions, `oracle`), `packages/verdicts/src/engine.ts` (`requirementOutcome`: a person's requirement is pending,
  "waits on your answer to …"), `packages/gate/src/claim.ts` (the JudgeFault note: the hub doesn't gather your answer
  to one yet), `packages/asks/src/index.ts` and `showing.ts` (visits, `ask.batched`, deadlines, defaults, #908's
  notice, answers and their `words`), `core.ts` (the asks beat, `test.clock`), `server.ts`, `human-answers.ts`,
  `trusted-actions.ts`, `confirm.ts`, `inbox.ts`, `plant.ts`, `forge.ts` (`released`) and `release.ts` (`done.yaml`'s
  `release:` and `switches:`); `crates/deep-app/src/{card,question,kinds,list,views,notify,states,plain}.rs` and
  `crates/deep-replica/src/{snapshot.rs,drive/mod.rs,drive/frames.rs}` (the card's ids, the list's rows and slots, the
  Needs you count, the notifier, `launch`, `open`, `wait_for`, `see`, `close` and its trace); `scripts/proof-change.mjs`.
- The suites `tests/acceptance/1335` (whole), `1332`, `1331`, `29`, `2029`, `2026`, `1461`, `1100`, `994` and `82`, for
  how a world, a definition with a person's requirement, a replica and a notification are read. Imported by path, not
  copied: `../1335/forge.ts` (`RuleForge` and `MAYA`, on `../1332/forge.ts`, `../1331/forge.ts`, `../1325/forge.ts`
  and `../46/forge.ts`), `../1332/helpers.ts` (`requirement`, `checkFile`, `names`, `rowsOf`, `waitUntil`, `shown`,
  the `Launch`, `Line` and `Ran` shapes), `../1332/fixtures/agent.mjs` (the played agents, installed with one more
  behavior) and `../29/h-d.ts` (the hub's stop, `events.read`, `control`, `run`, the child environment, your ask settings).

## What the base does

At `0e5572731`, one run (2026-11-15, 19:09Z to 23:23Z, a 1-minute load of 392 at its start and 109 at its end, 18
cores; `BASE-FAILURE.txt`): 7 of the 8 tests failed, each at its own first wait in its own file. **AC1
(`lands.test.ts`) was not run to its end on the base.** Something outside the suite removed this checkout's `target/`,
with deep-hook, twice during the run; `lands.test.ts`'s build then waited 80 minutes for a grant of the machine's
throttle, its world had just started when the run was stopped (by PID) so as not to wait longer, and the run ended
before vitest printed its failure messages. Each failure's place comes from its duration, just past its 25-minute first
wait plus setup, and from the worlds' records, read while they ran:

- `deadline.test.ts:13` (AC4), `held.test.ts:16` (AC2), `blocked.test.ts:16` (AC6), `batch.test.ts:21` (AC3, and AC7
  and AC8 with it, which await the same world): no reversible change with its taste call open merged within 25
  minutes. `held.test.ts` took 67 minutes in all: 41 of them waited on the throttle and rebuilt after `target/` was
  removed.
- `no.test.ts:13` (AC5): no taste call was raised for the change within 25 minutes.
- Why: the verdict engine leaves a requirement whose oracle is a person `pending` ("waits on your answer to its ask")
  and the hub raises no ask for it, and the landing judgement (#1331's `judgeMerge`) waits up to 30 minutes of wall time
  for a verdict that is no longer pending, holding the repo's landings and the run's pass, then holds the change
  BLOCKED, "no verdict was made on its merge with main". In the five-issue world, read at 19:10Z: all five attempts had
  worked, pushed and opened their pull requests, their claims and the lander's first judgement claim were made, and the
  record held no `verdict.made`, no `landing.made` and no ask but the run's approval; `deep work show` read each issue
  `working`.
- Each world set up on the base first: the forge (with its Pages site and the repo's release paths), the repo, the hub,
  the standing run and its approval, the played agents, your visits and the stepped clock.

Found on the base in an earlier run that was stopped (18:38Z, load 351): one of five sessions pushed its branch before
the hub had recorded its `start.session` (deep-hook had spooled the session's first hooks), and `push-needs-ask` held the
push with an authority ask, so its attempt gave up its slot; hence the played agent's 20 s of thought (below).

## Run them

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH"   # the repo's Node
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"         # cargo, for the builds below
npm ci && npm run build --workspaces                                  # every test runs packages/cli/dist/main.js
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1345 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1345/tsconfig.json
```

- **Builds.** In one grant of `scripts/throttle.mjs build --wait 120`, with #1172's build environment
  (`CARGO_INCREMENTAL=0`, `CARGO_PROFILE_DEV_DEBUG=0`), the helpers build `deep-hook` into the checkout's target, where
  the hub and the played agents' hooks look for it, then `deep-drive` with `-p deep-replica --features env-plants` and
  plain, each copied out of the target folder into `$TMPDIR/dh1345-bin-<uid>-<checkout>/`, as #2029's do. Each one
  newer than every file the Rust build reads is used as it is; only a missing or older one is built. A failed build
  reads BLOCKED, never a pass. The hub and the hooks need `target/debug/deep-hook` for the whole run: a cleanup that
  removes the checkout's `target/` mid-run (one did, twice, while the base ran here) breaks the world it runs in.
- **Folders and processes.** Each world lives under `/tmp/dh1345-*` (a short path, for the hub's socket), HOME set
  there, removed at the end. Every process is stopped by its PID, and only one whose command names the world's folder
  or this checkout. Nothing touches the real `~/.deepbuild`, `~/.claude` or the Keychain.
- **Lanes.** The files start hubs and draw, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list in a
  macOS lane (a file outside this folder); the implementer makes that edit.
- **Time.** On a right implementation each world runs real gate checks and lands real merges: allow tens of minutes
  per file under load, and more for `batch.test.ts`, which lands five changes and one revert.
- Vitest with `--root` leaves `node_modules/.vite/` here; delete it before committing.

## What is real, what is played

Real: the hub (`deep hub run`) and its record, the asks core (visits, deadlines, defaults, answers), #1330's starts,
#1332's run and #1335's standing rule, the gate's check runs (`node --test`), #1331's landing, deep-hook, `deep mcp`,
git, the CLI, the hub's test clock, and the app's views and notifier, drawn headless by the real `deep-drive`.

Played, at boundaries the repo doesn't own:

- **The forge** (GitHub), on 127.0.0.1: `forge.ts` in front of #1335's `RuleForge`. It adds the repo's GitHub Pages
  site, `GET /repos/{owner}/{repo}/pages`: `{ status: "built", build_type: "legacy", source: { branch: "main", path:
  "/docs" }, html_url, public: true, … }` in a world with a page-reaching change, else 404 as GitHub answers for a repo
  with none; its releases (`GET …/releases` is `[]`, `…/releases/latest` 404); and a pull request's body edited by
  `PATCH …/pulls/{n}`, as GitHub applies it (#1331's forge keeps only a state). Everything else is #1335's forge: issues
  with their authors and labels, blocked-by links (`dependencies/blocked_by`, and the body's `### Depends on`),
  comments, pull requests, commit statuses, merges, git over HTTP. maya is the repo's admin and her token the hub's
  `GH_TOKEN`; the agents' app (#1325) gives each session its own credential, as in #1335's suite.
- **The agents**: #1332's `fixtures/agent.mjs`, installed as `claude` and `codex` first on the login PATH, with two more
  turns, `slow` and `page` (`fixtures/turns.mjs`, dispatched by two lines `helpers.ts` adds). Each first thinks for 20
  s, as a model does before its first call (below). An issue's first start is `slow`, which then does #1332's `work`
  (writes `src/i<n>.txt`, commits, pushes its branch and opens a pull request `Closes #<n>`, then stops), or `page` for
  the page-reaching change (writes `docs/i<n>.md` and stages it, then the same); every later start on the issue is
  `gated`, holding its turn, so a next attempt is seen without making a second change. AC6's two blocked issues are
  `gated` from their first start: seen starting, they make no change. The agent logs what it did to
  `<world>/agents/log/<pid>.json`; the tests read starts there, without the hub's cooperation.
- **Why the agent thinks first.** On the base, at a load of 350, one of five sessions a run started pushed its branch
  before the hub had recorded that the session was the run's (`start.session`): deep-hook had spooled the session's
  first hooks, so its push reached the hub first, and the shipped guard `push-needs-ask` held it with an authority ask
  ("no request in this thread names that"), and the attempt gave up its slot. Twenty seconds before the first call
  let a spooled session start reach the hub first. It is a race of the base's (#1332), not of #1345.
- **The definitions**: each issue's, handed through `DEEP_HUB_TEST_DRAFTS` (`issue: "acme/shop#<n>"`, as #1332's suite
  hands them), with two requirements: `R1`, "the shop does <n>", on `.deepbuild/checks/i<n>.sh` = `node --test
  tests/acceptance/<n>/i<n>.test.mjs`, which passes unless `src/i<n>.txt` says BROKEN; and `R2`, the taste call, "the
  look of #<n>'s change is right to you", with `oracle: "person"` and no check (as suite 82 hands one). Every issue
  has its suite at the base, so no blind job runs.
- **You**: your answers go on the trusted path as `deep inbox answer` sends them (`ask.answer` on the hub's socket as
  the CLI, the OS confirming you through `DEEP_HUB_TEST_CONFIRM`), with your words when a Send back needs a note.

## The surfaces under test

1. **The standing run** (#1335): `deep work "work through open issues labelled \"checkout\" with Claude Code, <one …
   five> at a time" --repo <checkout> --json`, its one approval answered yes with `deep inbox answer`. Each issue is
   yours, labelled `checkout`, with criteria and a design link that resolves. This is what turns #1345 on.
2. **Your visits**: `~/.deepbuild/config.json` `asks.batch: { "every": "1d", "cap": 20 }` in the worlds of AC3, AC7,
   AC8 and AC4; the other worlds declare none, so every ask shows when it's raised. A showing is the asks core's
   `ask.batched` (`data.batch`, `data.asks[].ask`).
3. **The hub's clock** (AC3, AC4, AC7, AC8): `DEEP_HUB_TEST_CLOCK` (its start: now, or the next UTC midnight when that
   is under 6 hours away) and `DEEP_HUB_TEST_CLOCK_STEPS=1`, stepped with `test.clock` (`advance_ms`): to a minute past
   the next UTC midnight (your next visit), and past a call's deadline.
4. **The record** (`events.read`): `ask.created` (a call is one of `data.kind: "taste"` whose data holds its taste
   requirement's text, or names the issue), its `data.options`, `data.recommended` and `data.deadline`;
   `deadline.moved`; `ask.batched`; `ask.answered`, `ask.defaulted` and the rest of the closed set; `decision.created`;
   `landing.made` (`step`, `issue`, `pr`, `claim`, `outcome`); `verdict.made` (`claim`, `outcome`); `work.state`
   (`issue`, `word`); `start.started` (`issue`).
5. **`deep work show --json`**: the issue's row word (#1332's reading, `rowsOf`).
6. **The forge**: merges of a pull request linking the issue (a change landed), issues' state, bodies and comments,
   commit statuses' descriptions, and the file `src/i<n>.txt` on main (git, read from the forge's own repo).
7. **What a change reaches** (README: readings): `.deepbuild/done.yaml` on main, `release: { paths: [src/i<n>.txt] }`;
   the forge's Pages site, built from main's `docs/`.
8. **The app**, drawn headless by the real `deep-drive` (#124) in the world's HOME: `launch { from: "record_copy",
   size: [1512, 2000] }`, `open { address: "ask/<ULID>" }`, `wait_for { t }` (three seconds of its clock), `see`,
   `close` (its trace's `notifications`, the app's model of Notification Center). In the tree (#1459's shape, drawn
   text among the nodes): the list's rows `ask:<ULID>`, `session:<id>`, `quiet:<project>` and their `:word` and `:time`
   slots, `see`'s `rows`, the heading `heading:needs-you` valued the one count (#2026), and the card `question-card`.
9. **Plants**, below.

### Pinned here: the implementation must provide these

1. **A call for each taste call**: once a change whose only open requirements are taste calls is judged, the hub
   raises one ask for each (`ask.created`, `data.kind: "taste"`, its data holding the requirement's text or naming
   `#<n>`), with #328's two answers as options (Yes, recommended; Send back), and its deadline and default from your
   settings. One open call per requirement.
2. **Landing on everything else**: under a standing rule, such a change lands when it reaches no release and no
   published page (`.deepbuild/done.yaml`'s `release.paths`, and `GET /repos/{owner}/{repo}/pages`); its issue stays
   open, its body or a comment naming the call; nothing reads PASS. One that reaches either stays held, its call raised.
   A landed change with its call open is done for the issues it blocks; a held one isn't.
3. **Visits**: with `asks.batch.every: "1d"`, the day's calls show in one `ask.batched` once the hub's clock passes the
   next UTC midnight, with nothing else landing in the hub; the app's notifier posts one notification for them.
4. **The card's rows**: on the card (`question-card`), one node per call `card-row:<ULID>`, `<ULID>` its ask's ID,
   whose subtree's strings (names, values, drawn text) hold `Yes`, `Send back`, the words under Send back (`reverts
   this change` for a call whose change landed, `starts another attempt` for one held), and when its recommended answer
   applies, as the list's row for that call shows it in its `ask:<ULID>:time` slot (the same moment, in the same words).
5. **Answers**: a call's Send back, answered with your words on the trusted path, starts another attempt on a held
   change's issue, or reverts a landed change on main, and raises no ask; a call unanswered past its deadline is closed
   by `ask.defaulted` with its recommended answer, and its issue closes on the forge.
6. **The four plants**, listed below, each given as the table says.

## The plants

| Plant | Given as | The wrong program | Read by | Its failure names |
| --- | --- | --- | --- | --- |
| `lands-as-pass` | `DEEP_HUB_PLANT`, listed in `packages/hub/src/plant.ts` | the lander records the landing of a change whose only open requirements are taste calls as PASS (its `landing.made`'s `outcome`) | AC1 | the claim the lander judged it by (`landing.made`'s `claim`), on a view that reads PASS |
| `lands-unreversible` | `DEEP_HUB_PLANT`, listed in `packages/hub/src/plant.ts` | the lander lands a change with an open taste call that reaches a release or a published page, as a reversible one | AC2 | the change: `#<issue>` and `PR #<n>` |
| `card-row-reverts-unannounced` | `DEEP_HUB_PLANT` to `deep-drive` built with `--features env-plants`, read through `deep_app::plain::planted` | the batched taste card's first row (in the tree's order) whose Send back reverts doesn't say so | AC7 | that row's issue, `#<n>` |
| `card-row-without-time` | the same | the batched taste card draws no time on its first row (in the tree's order) | AC8 | that row, `card-row:<ULID>` |

Each test holds the right program to the same judgement first, so on the base it fails there, before a plant is
given. A hub refuses a plant it doesn't list, which reads BLOCKED; a plant `deep-drive` ignores leaves the planted card
passing, which fails ("a pass proves nothing").

## How each criterion is read

Every world is a standing run over the repo's open issues labelled `checkout`; every change is reversible unless its
issue says it reaches a release or the page; nobody answers a call unless a test says so. Waits are test timeouts, not
criteria: 25 minutes for a world's first landing (or call), 45 for the five, 5 for a call, a showing, a default or a
close to follow, 10 for a held change's call or a start, 20 for a revert, then 30, 60 or 90 s more where something
must not happen.

- **AC1** (`lands.test.ts`): one issue, `one at a time`. Its change lands (a merge of its pull request) within 25
  minutes; then its open call and the issue naming it (or 5 minutes) and 30 s more. The judgement: the change landed;
  #100 is open; the record holds exactly one open taste call for it, and the issue's body or comments name it; and no
  view reads PASS: no `landing.made` for #100 and no `verdict.made` for its claims has `outcome: "PASS"`, no
  `work.state` for #100 has `word: "PASS"`, `deep work show`'s row for #100 isn't PASS, no commit status's description
  starts with PASS, and the app's list over a copy of the record has no row whose word is PASS. Each failure names the
  claims. The plant world, the same, must fail it on a view that reads PASS, naming each claim the lander judged #100 by.
- **AC2** (`held.test.ts`): #100 reversible, #101 reaches a release, #102 the published page; `three at a time`. #100
  lands within 25 minutes (so the lander lands such changes); #101's and #102's calls are raised (they wait for you);
  90 s more. Neither has merged nor has a `landing.made` with `step: "landed"`. The plant world, #100 reaching a release
  alone, runs until it merges (or 25 minutes); the same judgement must fail, naming `#100` and its `PR #<n>`.
- **AC3** (`batch.test.ts`): five issues, `five at a time`, visits once a day, the hub's clock stepped. All five land
  within 45 minutes, each with its call open; the clock steps to your next visit, and within 5 minutes a showing holds
  each call. Exactly one `ask.batched` holds any of the five calls, and it holds all five. The app over a copy of the
  record, its clock run three seconds, posts exactly one notification.
- **AC4** (`deadline.test.ts`): one issue, visits once a day, the hub's clock stepped. Its change lands within 25
  minutes and its call is open; the clock steps to your next visit (its showing waited for up to 2 minutes), then past
  the call's deadline (its `ask.created` deadline, or the newest `deadline.moved`) by 2 minutes, up to three times
  while it moves. The call's `ask.defaulted` comes, its `answer` the call's `recommended`; #100 closes on the forge
  within 5 minutes; the call closed as `ask.defaulted`; the record holds no `ask.answered` and no `decision.created`
  for it.
- **AC5** (`no.test.ts`): one issue whose change reaches a release, `one at a time`. Its call is raised within 25
  minutes; 30 s later its change hasn't merged (held). You answer the call's Send back with "Make the pay button
  green." on the trusted path; it is recorded. Within 5 minutes a played agent starts on #100 after the answer, and the
  record holds a `start.started` for #100 after it; 60 s more, and no `ask.created` came after your answer.
- **AC6** (`blocked.test.ts`): #100 reversible, #101 blocked by it, #102 reaches a release, #103 blocked by it; `four at
  a time`. #100 lands within 25 minutes; #101 starts within 10 minutes, no earlier than #100's merge ended, with
  #100's call still open and #100 open. #102's call is raised (it waits for you), 90 s more; it hasn't merged, and #103
  has no played agent and no `start.started`.
- **AC7** (`batch.test.ts`, AC3's world, drawn before any answer, on the first call's page): exactly one `question-card`
  in the tree; for each call exactly one `card-row:<ULID>`, inside it, and no other `card-row:`; each row holds `Yes`
  and `Send back`; each landed change's row says `reverts this change` (and not `starts another attempt`). The planted
  card, the same, must fail, naming the issue of its first reverting row. Then the first row's Send back is answered
  ("Keep the look it had.") on the trusted path, and within 20 minutes main's `src/i<n>.txt` reads as before the change.
- **AC8** (`batch.test.ts`, the same drawing): each call's row holds the text of the list's `ask:<ULID>:time` slot for
  that call; the card's rows number five, the calls five, and `heading:needs-you`'s value is 5. The planted card, the
  same, must fail, naming its first row, `card-row:<ULID>`.

## Readings of what the criteria leave open

- **Reversible, and what a change reaches.** Read from structure, never from text, and declared, never guessed
  (design: "Values the rules leave open are declared"). A change reaches a **release** when it changes a file the
  repo's `.deepbuild/done.yaml` says a release ships: `release: { paths: [<path or glob>, …] }`, the `release:` block
  #325's release checks already read, with `paths` added. It reaches a **published page** when it changes a file under
  the folder the forge's GitHub Pages site is built from, on the branch it's built from (`GET
  /repos/{owner}/{repo}/pages`: `source.branch` and `source.path`; a 404 is no site). An outside service isn't
  exercised. Any other change is reversible: a revert of its landing undoes it.
- **A taste call** is a requirement of the issue's definition whose oracle is a person (`oracle: "person"`, no check).
  The call is the ask the hub raises for it: `ask.created` with `data.kind: "taste"`, its data holding the
  requirement's text or naming the issue, with #328's two answers as its options (Yes, the recommended one, and Send
  back), and its deadline and default from your settings (taste: 3 days, the recommended answer). One open call per
  requirement.
- **Lands** is the forge's merge of the pull request linking the issue (#1331's lander). **Stays held** is: its call
  raised, so it waits for you, and, once a reversible change beside it landed and 90 s more, never merged and no
  `landing.made` with `step: "landed"`. A held change's call is raised as any other's: "anything that isn't reversible
  still waits for the person, as #84 holds".
- **Its issue stays open, naming the call**: open on the forge after the landing, as #1331's budget-window landing
  leaves one, and its body or a comment holds the call's ULID (its handle, or a `deepbuild://ask/<ULID>` link), its
  question, or its requirement's text.
- **No view reads PASS**: the views of the change and its issue the base has: the record's `landing.made`,
  `verdict.made` for the lander's claims and `work.state`; `deep work show`; the forge's commit statuses; the app's list.
  The planted lander's PASS is its `landing.made`'s `outcome`.
- **One card per person, at most once a day**: your visits are `asks.batch` with `every: "1d"` (the base's visits, a
  UTC day's midnight); the day's calls show in one `ask.batched`, which is one person's (one identity's) one card. The
  visit shows the batch at its time: the hub shows the day's calls once its clock passes the visit, with nothing else
  landing in the hub (at the base the asks beat reads the asks only when a stop or a verdict lands or a deadline
  passes).
- **That day's one notification** is what the app's notifier posts to its model of Notification Center, in the
  replica launched over the record after the visit (`close`'s trace `notifications`): one, and nothing else posts in
  that world.
- **The card** is #2030's batched taste card, the presented card `question-card` (#1461): a row per call, each with
  Yes and Send back. Its row ids are pinned above (Pinned here, 4), as #1461 pinned the list's. **No second batch card**:
  one `question-card` in the tree, and every row inside it.
- **Send back reverts this change** when the call's change landed (the landed change is what it undoes), and **starts
  another attempt** when it didn't, as a change held for you, which has nothing landed to revert. So all five rows of
  AC7's card revert. Pressed, a revert puts main's file back as it was before the change.
- **When its recommended answer applies** is the moment its default (the recommended answer, for a taste call)
  applies, in the words the list's row for that call writes in its time slot.
- **The count** is the one count of what needs you (#2026): `heading:needs-you`'s value. The five rows add up to it
  when each call counts once, so it reads 5.
- **A "no"** is the call's Send back (its option whose id or label says Send back, else no, else the one it doesn't
  recommend), answered on the trusted path with a note. **Starts an attempt** is a new session on the issue: a played
  agent's start after the answer and a `start.started`. **No second ask** is no `ask.created` after the answer.
- **The record reads default, never your answer**: the call closed by `ask.defaulted` (its `answer` the recommended
  one), with no `ask.answered` and no `decision.created` for it.
- **Blocked by**: the body's `### Depends on` list, which the forge also serves as blocked-by links.
- AC5's call is on a held change (it reaches a release) because there a "no" starts an attempt by any reading of when
  Send back reverts; AC7's press is on a landed change, where it reverts.

## Not covered, because no criterion asks

A call answered from a decision already made (by the call's key, its screen and the element's stable name); a
workspace's tasks, finished with the last version a step back; a topic's card (#1342) turning this on, and a run over a
fixed set leaving it off; a wiki question joining the batch (#357); each row's before and after; selecting a call's row
in the list shows the card with that row in view (the card is opened at its first call); outside services; overruling
a default later; a "yes".
