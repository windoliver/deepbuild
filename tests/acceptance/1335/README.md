# Acceptance tests for #1335: a standing run, issues that meet a rule you approved join on their own

Written first, blind, from issue #1335 as of 2026-11-14 (Scope, the five criteria, Proof, Depends on; it has no
comments), by a job that never saw an implementation; none existed. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

| AC | ID | Criterion, in short | File |
| --- | --- | --- | --- |
| AC1 | `#1335.d72bf6b5` | an issue added after approval that meets the rule starts with no new approval, one that doesn't starts nothing; a planted rule that reads the issue's text is refused at approval, naming the rule | `rule.test.ts` |
| AC2 | `#1335.4dced2b8` | an issue with the rule's labels by an outside author never joins, nor one a session opens | `authors.test.ts` |
| AC3 | `#1335.5396151b` | an issue with no acceptance criteria stays out, is named on the run's page, raises no ask | `criteria.test.ts` |
| AC4 | `#1335.adae4f21` | past 7 days with no ask, a weekly notice listing landed, left and spent; at its plan share it starts nothing until the next window, raises no ask | `week.test.ts` |
| AC5 | `#1335.846df82d` | a fifth attempt in a row ending in anything but PASS pauses the run with one ask | `breaker.test.ts` |

Each test's name is its criterion's ID and full text (`#1335.` and the first 8 hex digits of SHA-256 of the
criterion's text, white space collapsed, as `scripts/proof-change.mjs` computes it). Each criterion has a world and a
file of its own.

The Proof's first half, a fixture forge run, is what these tests run. Its second half, this repo's rule and what it
selected on the live issues, is by hand: no live test is written, so nothing here touches GitHub or a paid model.

## What was read

- Issue #1335 (`gh issue view 1335 --comments`): no comments.
- `docs/technical-design.md` at the base: Later, as extensions (the R6 work-run bullet, **Work runs** and **Landing in
  turn**), Threats, and what stops each one, What done means, fixed at the start, Plan usage, per account and per task,
  Attempt and plan, the What starts work bullet under One hub for a project shared by several people, and the
  Dogfooding paragraph under How we know version 0 works. `AGENTS.md` (Proof).
- At the base `a12be6c8c`, for surfaces and conventions only: `packages/hub/src/work.ts` and `land-command.ts` (#1332:
  `deep work "<scope>"`, `scopeOf`, `deep work show` and `pause`, `work.run`, `work.state`, `work.attempt`, the ready
  rule, the order, the per-issue breaker), `starts.ts` (#1330: `start.approve()`, `start.approval`, `start.started`,
  `start.refused` and its `plan_share` bound, the session's own forge credential), `landing.ts` (#1331),
  `github-source.ts` (an author's role from the repo's membership, a bot as automated, `criteriaOf`), `ask-tasks.ts`
  (handed definitions), `packages/runner/src/runner.ts` and `agents.ts` (`windows.report`, `windowUsed`, the account in
  `.claude.json`), `core.ts` and `server.ts` (the test clock), `crates/deep-hook/default-rules.json` and `matcher.rs`
  (which calls the shipped guards hold), `packages/github/src/apps.ts` (a session token's permissions),
  `.github/ISSUE_TEMPLATE/task.md` and `scripts/proof-change.mjs` (criterion IDs).
- The suites `tests/acceptance/1332` (whole), `1331` (its forge and README), `1330` (its bounds test), `1325` and `46`
  (their forges), `1328` and `63` (how an account's window reading is reported), for how a world is built. Imported by
  path, not copied: `../1332/forge.ts` (`WorkForge`, on `../1331/forge.ts`, `../1325/forge.ts` and `../46/forge.ts`),
  `../1332/helpers.ts` (`requirement`, `checkFile`, `names`, `waitUntil`, `shown`, the `Launch` and `Ran` shapes),
  `../1332/fixtures/agent.mjs` (the played agents, installed with one more behavior) and `../29/h-d.ts` (the hub's
  stop, `events.read`, `control`, the child environment, your ask settings).

## What the base does

At `a12be6c8c` all 5 tests fail, each at its first assertion in its own file (`BASE-FAILURE.txt`): `deep work "<scope>"`
whose words name a rule and no issue numbers is refused by #1332's `scopeOf` (`Name the issues by number, such as
"work through #12, #14 and #15 with Claude Code, two at a time".`, exit 1), so no approval is raised and no run starts.
Missing, in all: a rule in a run's words and its approval, a set that follows the forge, the author rule, the
ready-to-join check and its reading on the run's page, the weekly notice, the run's own breaker and its pause, and the
refusal of a rule that reads text. Each world (forge, repo, hub, played agents, and AC4's clock and account reading)
sets up on the base first.

Found on the base with throwaway checks (deleted; not part of this suite), in this suite's world, through #1332's
fixed-set run (`deep work "work through #100 and #101 with Claude Code, two at a time, up to 50% of each plan window"`):

- One approval starts both issues. #100's played agent works, its pull request is judged PASS and lands (merged, the
  issue closed, `landing.made` PASS) within seconds at a low load; the approval is the only ask.
- The session on #101, played as `open-issue`, opens #102 through the forge with its own credential, and the forge
  records `deepbuild-agents[bot]` as its author. No shipped guard holds that `curl -X POST`.
- The run reads each issue of its set again (`GET /repos/acme/shop/issues/<n>` and its `dependencies/blocked_by`) with
  your token, at most 30 s apart; the work source reads an issue's page and comments (`?per_page=100&page=1`).
- `deep work show --json` prints `{ "runs": [{ "ask", "repo", "paused", "issues": [{ "issue", "word", "waits_on",
  "why" }] }] }`, and `deep work pause` makes the run's `paused` true.
- With the account's five-hour window reported 60% used and the run's share 50%, each pass's start is refused,
  `start.refused` with `bound: "plan_share"` (23 in 45 s), the issue's row `queued`, waiting on that refusal, and no
  ask is raised. Once `test.clock` steps past the window's reset, the issue starts within seconds, before any new
  reading: an expired window reads unknown, and the start goes ahead.

## Run them

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH"   # the repo's Node
npm ci && npm run build --workspaces                                  # every test runs packages/cli/dist/main.js
cargo build --locked -p deep-hook                                     # the played agents' hooks
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1335 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1335/tsconfig.json
```

Each world lives under `/tmp/dh1335-*` (a short path, for the hub's socket), HOME set there, removed at the end. Every
process is stopped by its PID, and only one whose command names the world's folder or this checkout. Run the folder
alone (every test starts its own hub, so it belongs in `scripts/lanes.mjs`'s `alone` list, a file outside this
folder). Vitest with `--root` leaves `node_modules/.vite/` here; delete it before committing. A missing CLI build or
deep-hook reads BLOCKED, never a pass. On a right implementation AC4 runs real gate checks and lands a real merge, so
allow tens of minutes for it under load; the others start sessions and land nothing.

## What is real, what is played

Real: the hub (`deep hub run`) and its record, #1330's starts (worktrees, launch, the session's own credential),
#1332's run, the gate's check runs (`node --test`), #1331's landing, deep-hook, `deep mcp`, git, the CLI, the runner's
plan windows and the hub's test clock.

Played, at boundaries the repo doesn't own:

- **The forge** (GitHub), on 127.0.0.1: `forge.ts` in front of #1332's `WorkForge`. It adds each issue's author
  (`user` with its `type`, and GitHub's `author_association`), its labels in GitHub's label shape, `milestone: null`,
  and `performed_via_github_app` for an issue an app opened; the issue list with GitHub's filters (`state`, `labels`,
  `creator`, `milestone`, `since`, `sort`, `direction`, `per_page`, `page`, and a `link` header for the next page);
  `POST /repos/{owner}/{repo}/issues` by whoever holds the token, recording who opened it; the repo's collaborators
  (`GET /repos/{owner}/{repo}/collaborators`, `/collaborators/{login}`, `/collaborators/{login}/permission`: maya
  alone, an admin); `GET /user`; `GET /repos/{owner}/{repo}/labels` and `/milestones` (none); and
  `GET /repos/{owner}/{repo}/contents/{path}?ref=` from the repo itself. Everything else is #1332's forge: issue views'
  bodies and states, comments, blocked-by links (`dependencies/blocked_by`), pull requests, merges, git over HTTP.
  maya is the repo's admin; her own token is the hub's `GH_TOKEN`. An agents' app (#1325) is installed, its key in
  the Keychain stand-in (`DEEP_HUB_TEST_KEYCHAIN`) and named in `config.json` (`github.agents`), so a session the run
  starts gets its own `GH_TOKEN`, as `deepbuild-agents[bot]`. No search API and no GraphQL are served.
- **The agents**: #1332's `fixtures/agent.mjs`, installed as `claude` and `codex` first on the login PATH with one
  more behavior, `open-issue` (`fixtures/open-issue.mjs`, dispatched by one line `helpers.ts` adds beside the agent's
  own). The behaviors used here: `replaced` (stops with no tool call and nothing changed), `gated` (holds its turn
  until the test's go, then does `work`: writes `src/i<n>.txt`, commits, pushes its branch and opens a pull request
  `Closes #<n>` with the session's `GH_TOKEN`; only AC4's #100 is let go) and `open-issue` (one Bash call, `curl -X
  POST` to the forge's `/repos/acme/shop/issues` with the session's own `GH_TOKEN`, opening the issue its plan names;
  then it holds its turn as `gated` does). The issue it works is the number in its branch (`deep/<n>-…`). It logs what
  it did to `<world>/agents/log/<pid>.json`; the tests read starts there, without the hub's cooperation.
- **The definitions**: each issue number a world may use has a suite at the base (`tests/acceptance/<n>/i<n>.test.mjs`,
  so no blind job runs) and a definition handed through `DEEP_HUB_TEST_DRAFTS` (`issue: "acme/shop#<n>"`), one
  requirement on `.deepbuild/checks/i<n>.sh` = `node --test tests/acceptance/<n>/i<n>.test.mjs`, which passes unless
  `src/i<n>.txt` says BROKEN, as #1332's suite hands them. Numbers of issues added or opened later are prepared too.
- **The account** (AC4 only): `.claude.json` with an `oauthAccount.accountUuid`, at `~/.claude.json`, where Claude
  Code keeps it for its default home, and at `~/.claude/.claude.json`, where the base's start reads it for that home
  (`<home>/.claude.json`); and readings of its five-hour window through `windows.report`, as suites 1328 and 63 report
  them, the first 5% used.

## The surfaces under test

1. **`deep work "<scope>" --repo <checkout> --json`**, run in the checkout, its words naming a rule and no issue
   numbers: raises the run's one approval through the hub's `start.approve()` and prints `{ "ask": "ask:<id>" }`. The
   record holds its `ask.created` (an authority ask with an option whose `decision` is `allow`) and #1330's
   `start.approval` naming it; it is answered yes with `deep inbox answer <ask> <option>`. From then the hub runs the
   rule by itself.
2. **`deep work show --repo <checkout> --json`**: the run's page. An issue is named on it as `#<n>`, `issue <n>`,
   `issues/<n>` or `"issue": <n>`; the run is paused when the object naming its ask holds `paused: true`.
3. **The record** (`events.read`): `ask.created` (every ask), `start.approval` and `start.started` (#1330: a start's
   `issue` and the `ask` it ran under), `ask.answered`, `work.attempt` with `step: "ended"` (#1332: an attempt that
   ended, under the run's `ask`, with its `cause`), and the weekly notice (below).
4. **The forge**: issues with their authors, roles and labels, issues opened through the API and by whom, pull
   requests and merges, and every call that reached it with its token's login (`RuleForge.calls`), read off the forge
   itself.
5. **The hub's clock**: `DEEP_HUB_TEST_CLOCK` and `DEEP_HUB_TEST_CLOCK_STEPS=1`, stepped with `test.clock`
   (`advance_ms`); **plan windows**: `windows.report` with `{ agent: "claude-code", account, rate_limits: { five_hour:
   { used_percentage, resets_at } } }`.

## The plant

| Plant | Given as | Read by | Its failure names |
| --- | --- | --- | --- |
| a rule that reads the issue's text | the words of `deep work`: the run's own scope with `whose text mentions "refund"` added | AC1 | `refund`, the rule's own words, in the refusal `deep work` prints |

No `DEEP_HUB_PLANT` is used: the planted twin is input, the rule the person would approve. AC1 runs the right words
first, so on the base it fails there, before the plant is given.

## How each criterion is read

Every rule here is `labelled "checkout"`. An issue is yours (maya's, `author_association: OWNER`) with that label,
acceptance criteria and a design link that resolves, unless said otherwise.

- **AC1** (`rule.test.ts`): no issue is open at the approval (`two at a time`). After it, #100 without the label and
  #101 with it are opened, in that order, both played as `gated`. #101 starts within 15 minutes and the record's
  `start.started` for it names the run's ask; 60 s later #100 has no played agent and no `start.started`; the record
  holds no `ask.created` but the approval and no `start.approval` but the run's. Then `deep work` with the planted words
  exits non-zero, adds no `ask.created` and no `start.approval`, and prints `refund`.
- **AC2** (`authors.test.ts`): #100 yours, played as `open-issue`; #101 labelled the same but written by `drifter`
  (`author_association: NONE`, on no list of collaborators); `two at a time`. #100 starts; its session opens #102 with
  the label, criteria and design link, through the forge with its own credential, so GitHub records
  `deepbuild-agents[bot]` as its author. Once the hub (by maya's token) has read the issue list, or #102, after #102
  was opened, and 90 s more, neither #101 nor #102 has a played agent or a `start.started`, while a slot is free.
- **AC3** (`criteria.test.ts`): #100 has no `### Acceptance criteria` section; #101 is ready; `two at a time`, both
  `gated`. #101 starts; then, after the run's page names #100 (or 3 minutes) and 60 s more, `deep work show --json`
  names #100, #100 has no played agent and no `start.started`, and the record holds no `ask.created` but the approval.
- **AC4** (`week.test.ts`): the hub's clock is stepped by the test; the run's words add `up to 50% of each plan
  window`; `two at a time`, every issue `gated`. #100 and #101 start; 30 s later #100 is let go, and its change lands
  (merged, closed), so the landing falls inside any week counted from the approval; #101 holds its turn. Then the
  five-hour window reads 60% used, resetting at the same time as before, and #102 is opened: after the hub read the
  issues with it there (or 5 minutes) and 90 s more, #102 has not started and nothing was asked. Then the clock steps
  to 10 s past 7 days after the approval (its `start.approval` or `ask.answered`, whichever came later), which is past
  the window's reset, and a reading of the next window says 5% used: #102 starts within 10 minutes. Within 5 minutes
  the record holds the weekly notice: its `landed` lists #100, its `left` lists #101 and not #100, its `spent` says
  something. At the end the record still holds no `ask.created` but the approval.
- **AC5** (`breaker.test.ts`): #100 and #101, every attempt `replaced` (its turn ends with nothing changed in its
  worktree), `one at a time`. The run works #100 three times, then #1332's per-issue breaker asks about #100 and the
  run goes on to #101; #101's second attempt is the fifth in a row. Once a sixth attempt starts, an ask comes after the
  fifth `start.started`, or the page shows the run paused, and 60 s more: there were exactly five starts under the run
  (record and played agents alike) and five `work.attempt` ends, none with `cause: "PASS"`; exactly one `ask.created`
  came after the fifth start, and after the fifth attempt's end; and `deep work show` shows the run paused.

## Readings of what the criteria leave open

- **The scope words name a rule** by a label in quotes after `labelled` (`work through open issues labelled
  "checkout" with Claude Code, two at a time`): no issue numbers, so it isn't #1332's set. The agents, how many at
  once and the plan share (`up to 50% of each plan window`) are said as #1332's `scopeOf` reads them, and no end is
  named. The words name no author role: only issues by you or a collaborator join whatever a rule says (Scope).
  Milestones, epics and `Runs on:` lines are part of a rule but no criterion here needs them.
- **A rule that reads the issue's text** names the issue's text as what it matches: `whose text mentions "refund"`.
  Refused at approval means `deep work` exits non-zero, no ask is raised and no `start.approval` recorded, as #1332's
  `scopeOf` refuses words it can't take; naming the rule means its printed refusal holds the rule's own words, read as
  the value it would match, `refund`.
- **Author role** comes from the forge, never the text: GitHub's `author_association` on the issue and the repo's
  collaborators list, both served. You are maya, the login of the hub's token (`GET /user`, and `github.yours`); an
  outside author is an account on neither, with `author_association: NONE`.
- **A session opens an issue** when a session the run started opens it through the forge with its own credential
  (#1325's agents' app token, which can write issues), as one Bash call its hooks see: GitHub records the app's bot,
  `deepbuild-agents[bot]` (`type: Bot`, `author_association: NONE`, `performed_via_github_app` set), as its author. It
  carries the rule's label and is ready by every other reading.
- **Never joins** means it never starts while a slot of the run is free, after the hub read the forge's issues with it
  there; a played agent's launch and the record's `start.started` are both read.
- **A design link that resolves** is a `**Design:** [<section>](https://github.com/acme/shop/blob/main/<file>#<anchor>)`
  line, as this repo writes them: the file is on the repo's default branch (the checkout's `origin/main`, and the
  forge's contents API) and the anchor is one of its headings by GitHub's rule (`## The shop` is `#the-shop`). Nothing
  is fetched from github.com.
- **Readable dependencies**: every issue here names none (no `### Depends on` items), and the forge answers its
  `dependencies/blocked_by` with an empty list.
- **Acceptance criteria** are `- [ ]` lines under `### Acceptance criteria`, as this repo writes them and the base's
  `criteriaOf` reads them; an issue with none has no such section.
- **Named on the run's page** is the issue's number in `deep work show --json`'s output, whatever row or list holds it;
  the reason isn't read, since the issue doesn't name a wording.
- **The weekly notice** is a record event that names the run (its `subject` or `data.ask` is the run's ask, or its data
  holds the ask) and whose data holds `landed`, `left` and `spent`, at any depth; `work.run` with a step of its own is
  the existing kind it fits. It isn't an ask. `landed` and `left` name issues as numbers, `#<n>` or `"issue": <n>`.
- **Spent** is whatever the notice puts in `spent`, read only as not empty: the issue names no unit (plan share,
  tokens or sessions all fit the design's Plan usage, per task).
- **At its plan share** means the most used live window of the account the run's agent starts on is at or past the
  run's share, as #1330's `start.refused` with `bound: "plan_share"` reads it. **The next window** is the one after
  that window's `resets_at` has passed on the hub's clock, with a reading of the new window reported; a start then is
  the run going on, whether or not it waits for that reading.
- **Past 7 days** is the hub's clock stepped past 7 days after the approval (just past, so a week counted from the
  approval or back from the notice both hold the landing); nothing is asked over that time.
- **Pauses the run** is the state `deep work pause` leaves, which `deep work show` shows as `paused: true` for the run,
  and no attempt starts after the fifth. **One ask** is the one `ask.created` after the fifth attempt's start, which
  comes once that attempt ended; #1332's per-issue breaker asks about #100 at its third replaced attempt, before.
- **In a row** counts the run's attempts in the order they ended. With one at a time, the order is #1011's: the issue
  that unblocks most, then the lowest number, so #100 goes until #1332's breaker holds it.
- **Waits** in the tests (40 minutes for a landing, 15 for a start, 10 or 5 for a read, 3 for the page, 90 and 60 s
  after one) are test timeouts, not criteria.

## Not covered, because no criterion asks

The order by earliest milestone; `Runs on:` in a rule; epics; two reverted landings in a day tripping the breaker;
work an agent finds through `deep_propose` and the run's one batched ask; an issue whose design link doesn't resolve or
whose dependencies can't be read; a collaborator other than you; this repo's rule on the live issues (by hand).
