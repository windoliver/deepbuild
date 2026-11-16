# Acceptance tests for #1332: the first work run, with no app

Written first, blind, from issue #1332 as of 2026-11-12 (Scope, the nine criteria, Proof, Overlaps, Depends on, and its
two comments, which settled the budget-window exception now in the body), by a job that never saw an implementation;
none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of
this job (design: Dogfooding).

| AC | ID | Criterion, in short | File |
| --- | --- | --- | --- |
| AC1 | `#1332.09a2eb02` | 6 issues, 7 blocked-by links, one approval runs the set to the end; no issue starts before its blockers are done; a planted early start fails naming both issues | `order.test.ts` |
| AC2 | `#1332.4a073ef1` | a blocker closed with its PR unmerged keeps its dependent waiting, naming the PR; one on the baseline list satisfies the link, reads closed before the gate, never PASS | `landed.test.ts` |
| AC3 | `#1332.0ec9d14a` | a session killed mid-turn continues as a next attempt in the same worktree, uncommitted files intact; never two live attempts, across a hub restart too | `next-attempt.test.ts` |
| AC4 | `#1332.59986399` | a third replaced attempt raises one ask, and the other issues go on | `replaced.test.ts` |
| AC5 | `#1332.02e0e76f` | a taste ask gives up the slot within 10 s and takes the next free one after the answer | `taste.test.ts` |
| AC6 | `#1332.479b1c3f` | an issue whose `Runs on:` names a machine the host can't serve starts nothing and reads what it waits for | `show.test.ts` |
| AC7 | `#1332.dc2b15bb` | `deep work show` prints the record's state words; a planted reader taking a state from a comment fails, naming the issue | `show.test.ts` |
| AC8 | `#1332.6efb16d5` | Claude Code, Codex, Claude Code on another model, each replaced: one ask listing agent, model and cause; a planted per-agent breaker lets a fourth start and fails, naming the attempt | `breaker.test.ts` |
| AC9 | `#1332.13dcebe8` | a blocker landed with only a budget window's requirement open satisfies its dependents' link and they start; a planted run that waits for the window fails, naming both issues | `budget.test.ts` |

Each test's name is its criterion's ID and full text (`#1332.` and the first 8 hex digits of SHA-256 of the
criterion's text, white space collapsed, as `scripts/proof-change.mjs` computes it). AC6 and AC7 share one file because
they read one run (`show.test.ts` opens it once); every other criterion has a world of its own.

The Proof (five real issues of this repo under one approval) is by hand, on a plan. No live test is written, so
nothing here touches GitHub or a paid model.

## What was read

- Issue #1332 with its comments (`gh issue view 1332 --comments`).
- `docs/technical-design.md` at the base: Later, as extensions (the R6 work-run bullet, **Work runs**, **Landing in
  turn**), Attempt and plan, Sessions that know about each other, Plan usage, per account and per task, States people
  see, and Dogfooding under How we know version 0 works. `docs/parallel-proof.md` 12a and 12b, and its `Runs on:` line
  (section 10: "names the machines a step's proof needs: Mac, Spark, or both"). `AGENTS.md` (Proof).
- At the base `53c0e72a3`, for surfaces and conventions only: `packages/hub/src/starts.ts` and `start-command.ts`
  (#1330: `start.approve()`, `start.approval`, `start.started`, the worktree and branch `deep/<issue>-<id>`, the agents'
  launch facts), `landing.ts` and `land-command.ts` (#1331: `deep land judge`, `deep land`, `deep work --once`,
  `landing.made`), `acceptance.ts` (#1328), `forge.ts` (`Forge.nextIssue`, which reads blocked-by links from a body's
  `### Depends on` list), `plant.ts` (how a plant is selected and refused), `mcp-operations.ts` and `tools.ts`
  (`deep_ask`, `deep_wait`), `session-state.ts` (`row.set`), `codex-settings.ts` (Codex's `hooks.json`),
  `adapters/claude-code.facts.json` and `codex.facts.json` (versions, `launch.started`, Codex's hook events),
  `packages/checks-command` (it reads `node --test` reports), `scripts/proof-change.mjs` (criterion IDs).
- The suites `tests/acceptance/1325`, `1328`, `1330` and `1331`, for how a world is built. Imported by path, not
  copied: `../1331/forge.ts` (`LandForge`, on `../1325/forge.ts` and `../46/forge.ts`) and `../29/h-d.ts` (the hub's
  start and stop, `events.read`, the child environment, your ask settings).

## What the base does

At `53c0e72a3` all 9 tests fail, each at its own assertion in its own file (`BASE-FAILURE.txt`): `deep work "<scope>"`
is #1331's `deep work --once` command, which wants `--issues` and `--once`, so it prints its usage and exits 2. No
approval is raised and no run starts. Missing, in all: the run from words, the ready rule with done means landed, the
baseline list, the order, slots, the attempt loop and its breaker, `Runs on:`, the restart reconcile, `deep work show`
and the record's state words for a run's issues, and the four plants. Each world sets up on the base.

Found on the base with a throwaway check (deleted; not part of this suite), through #1330's `deep start` and #1331's
`deep land` in the same world: a started played Claude Code session links to its run (`start.session`), the gate
PASSes its claim, and Codex starts too. Two shipped guards stop such a session from finishing an issue, so a run must
deal with both under its one approval:

- #1330 makes each worktree under `~/.deepbuild/worktrees/`, and the shipped guard `no-deepbuild-home-write`
  (`write:~/.deepbuild ~/.deepbuild/* !~/.deepbuild/workspaces/*`) denies the session's own Write to its worktree.
- The shipped guard `push-needs-ask` holds the session's push of its own branch with an authority ask ("no request you
  typed in this thread names it"). The design says each session a work run starts has a credential that "can push
  branches, open PRs and comment".

With both relaxed in that throwaway world's rules, the played agent's change was pushed with the session's own
credential, its pull request opened as `deepbuild-agents[bot]`, judged PASS by `deep land judge`, landed by `deep land`,
and the issue closed; a played taste ask went through `deep_ask` and was answered; a hung session was killed by PID.
The suite's own rules are the shipped ones, unchanged.

## Run them

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH"   # the repo's Node
npm ci && npm run build --workspaces                                  # every test runs packages/cli/dist/main.js
cargo build --locked -p deep-hook                                     # the played agents' hooks
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1332 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1332/tsconfig.json
```

Each world lives under `/tmp/dh1332-*` (a short path, for the hub's socket), HOME set there, removed at the end. Every
process is stopped by its PID, and only one whose command names the world's folder or this checkout. Run the folder
alone (every test starts its own hubs, so it belongs in `scripts/lanes.mjs`'s `alone` list, a file outside this
folder). Vitest with `--root` leaves `node_modules/.vite/` here; delete it before committing. A missing CLI build or
deep-hook, or a hub that won't start with a plant it doesn't list, reads BLOCKED, never a pass. On a right
implementation each file runs real gate checks and lands real merges, so allow tens of minutes per file under load.

## What is real, what is played

Real: the hub (`deep hub run`) and its record, #1330's starts (worktrees, launch, the session's own credential), the
gate's check runs (`node --test`), #1331's landing, deep-hook, `deep mcp`, git, the CLI.

Played, at boundaries the repo doesn't own:

- **The forge** (GitHub), on 127.0.0.1: `forge.ts` in front of #1331's `LandForge`. It adds an issue's whole view (opened,
  closed, by whom), the issue list a page at a time, blocked-by links (a body's `### Depends on` list, and the same links
  at GitHub's `GET /repos/{owner}/{repo}/issues/{n}/dependencies/blocked_by`), and `POST /repos/{owner}/{repo}/pulls` by
  whoever holds the token, of a branch the repo holds. Issues are numbered from #100, pull requests from #1. maya is the repo's admin; her own token
  is the hub's `GH_TOKEN`. An agents' app (#1325) is installed, its key in the Keychain stand-in
  (`DEEP_HUB_TEST_KEYCHAIN`) and named in `config.json` (`github.agents`), so a session the run starts gets its own
  `GH_TOKEN`.
- **The agents**: `fixtures/agent.mjs`, installed as `claude` and `codex` first on the login PATH, reporting the newest
  version each agent's facts cover. A session fires the hooks of the agent's own config as its children
  (`~/.claude/settings.json` merged with `--settings`; `~/.codex/hooks.json`; deep-hook as `deep setup` writes them),
  plays one turn, then waits as the agent's terminal does until it is signalled. The issue it works is the number in
  its branch (`deep/<n>-…`), else the prompt's first `#<n>`. The test's plan for that issue and launch stands for the
  model: `work` (writes `src/i<n>.txt`, commits it, pushes the branch and opens a pull request `Closes #<n>` with the
  session's `GH_TOKEN`, then stops; a push denied or failed opens no pull request; a held stop is stopped again, up to
  three times), `replaced` (stops with no tool
  call and nothing changed), `hang` (writes an uncommitted `notes-<n>.txt`, then hangs inside a Bash call), `gated`
  (waits for the test's go, then works) and `taste` (asks a taste question through `deep_ask`, waits with `deep_wait`,
  then works). It logs what it saw and did to `<world>/agents/log/<pid>.json`; the tests read starts, worktrees, found
  files, models and times there, without the hub's cooperation.
- **The definitions**: each issue's requirements are handed through `DEEP_HUB_TEST_DRAFTS` (`issue: "acme/shop#<n>"`, as
  #1331's suite hands them), one requirement on `.deepbuild/checks/i<n>.sh` = `node --test
  tests/acceptance/<n>/i<n>.test.mjs`, which passes unless `src/i<n>.txt` says BROKEN. AC9's blocker adds a requirement
  `settled_by: "budget-window"` with no check.

## The surfaces under test

1. **`deep work "<scope>" --repo <checkout> --json`**, run in the checkout: raises the run's one approval through the
   hub's `start.approve()` and prints `{ "ask": "ask:<id>" }`, as `deep start approve --json` does. The record holds the
   ask's `ask.created` (an authority ask) and #1330's `start.approval` naming it, with `issues`, `agents` and `at_once`
   the words' bounds (AC1 reads them). The approval is answered yes with `deep inbox answer <ask> <option>`, the option
   whose `decision` is `allow`. From then the hub runs the set by itself; no other command is run.
2. **`deep work show --repo <checkout> --json`**: rows, one per issue in the set, each an object with `issue` (its number,
   or `#<n>` / `acme/shop#<n>`) and `word` (its state word); whatever else the row holds (`why`, `waits_on`, ...) is read
   as what it waits for. Rows may sit anywhere in the JSON; the shallowest object naming an issue is its row.
3. **The record** (`events.read`): `ask.created` (the approval, the breaker's ask, the taste ask), `start.approval` and
   `start.started` (#1330), `landing.made` with `step: "landed"`, `issue` and `outcome: "PASS"` (#1331: a change on main
   with a PASS in the record), and the run's state words: an event whose `data.issue` is the issue's number and whose
   `data.word` is a string. The record's word for an issue is the newest such event's.
4. **The forge**: issues and their state, comments, pull requests and merges (`LandForge.merges`, with when each ended:
   an issue's change has landed when a pull request linking it merged), all read off the forge itself.
5. **The issue body**: `Runs on: <machine>` on a line of its own; `### Depends on` with `- #<n>` lines.
6. **The baseline**: `.deepbuild/closed-before-gate.json` on main, `{ "closed_before_gate": [<n>, ...] }`, added in one
   commit after the repo's first (the baseline commit, set once).
7. **Plants**, each a value of `DEEP_HUB_PLANT` that the implementation adds to `packages/hub/src/plant.ts`, given to the
   hub and to every `deep` command the test runs:

| Plant | The wrong program | Read by | Its failure names |
| --- | --- | --- | --- |
| `starts-before-blockers-done` | a run that starts an issue before every issue it is blocked by is done | AC1 | the started issue and its blocker (`#<d>`, `#<b>`) |
| `state-from-comment` | `deep work show` takes an issue's state word from a comment on it | AC7 | `#100` |
| `breaker-counts-per-agent` | a breaker that counts an issue's replaced attempts per agent | AC8 | `attempt 4` and that attempt's session ID |
| `waits-for-budget-window` | a run that keeps a budget-only blocker's dependents waiting for the window | AC9 | `#101` and `#100` |

Each test runs the right program first, so on the base it fails there, before a planted hub is ever started.

## How each criterion is read

- **AC1** (`order.test.ts`): issues #100 to #105, links 100→102, 100→103, 101→103, 102→104, 103→104, 101→105,
  104→105, all worked, two at a time. Within 45 minutes every issue's pull request merged and its issue closed, each
  with a `landing.made` PASS; the approval is the only ask; and every played agent's start on an issue came after the
  merge that landed each of its blockers. The plant runs until an early start (or 30 minutes); the same judgement
  must then fail naming the first early start's issue and blocker.
- **AC2** (`landed.test.ts`): #100 closed 30 days ago and on the baseline list; #101 closed an hour ago by maya while
  its pull request #1 (from before the run, BROKEN) is open and unmerged; #102 blocked by #100, #103 by #101. The set is
  #100, #102, #103, one at a time. #102 starts; once it has landed (or 20 minutes) and 30 s more, `deep work show`'s row
  for #103 names pull request #1 (`#1`, `pull/1`, `PR 1`, `pull request 1` or `"pr": 1`), #103 never started, and #1 is
  unmerged. #100's row says "closed before the gate" and its word isn't PASS; the record's word for #100 isn't PASS and
  it holds no `landing.made` PASS for #100.
- **AC3** (`next-attempt.test.ts`): one issue. Its first attempt writes `notes-100.txt`, never commits it, and hangs mid
  call; the test kills that agent with SIGKILL. The next attempt runs in the same worktree (real path) and found the
  notes with the same bytes. While it is live and mid-turn the hub is restarted (SIGTERM by PID, then `deep hub run`
  again on the same root); 45 s later it is let go and stops. Sampled every half second throughout, never more than one
  played agent lives on the issue.
- **AC4** (`replaced.test.ts`): #100's every attempt stops with nothing changed (replaced); #101 is worked; one at a
  time, Claude Code only. An ask other than the approval naming #100 is raised when #100 has had three attempts; #101's
  change lands; a minute later #100 still has three attempts and that one ask.
- **AC5** (`taste.test.ts`): one at a time. #100 asks a taste question; #101 then starts, at or after the ask, within
  10 s of the ask's `ask.created`. The test answers it (`pay`); for 30 s, while #101 still works, #100 does no work;
  then #101 is let go; #100's work comes after the answer and no earlier than #101's stop.
- **AC6** (`show.test.ts`): #100 `Runs on: Mac`, #101 `Runs on: Spark`, #102 blocked by #100; the run is on this Mac.
  Once #100 and #102 have landed (or 40 minutes), #101 never started (no played agent, no `start.started`), and its
  `deep work show` row contains "Spark".
- **AC7** (`show.test.ts`, the same run): a comment `State: <word>` is put on #100 with a state word other than the
  record's (and other than PASS); then, for #100, #101 and #102, `deep work show`'s word equals the record's (read before
  and after the show; while the record moved in between it is read again, up to five times). The planted reader on its
  own run must fail this, naming #100.
- **AC8** (`breaker.test.ts`): one issue, Claude Code and Codex, one at a time, every attempt replaced. Claude Code
  reports `claude-haiku-5-5` on its first start on the issue and `claude-sonnet-5-5` on its second unless launched with
  `--model`, Codex `gpt-5.5-codex`. The attempts go Claude Code, Codex, Claude Code, the third on another model than the
  first; there is no fourth a minute after the ask; one ask other than the approval names #100, and its JSON names each
  attempt's agent and model and the cause "replaced". The plant must start a fourth, and the judgement must fail naming
  `attempt 4` and its session.
- **AC9** (`budget.test.ts`): #100 has a check and a budget requirement; #101 and #102 are blocked by it; two at a time.
  #100's change lands, #100 stays open and its body or comments hold the requirement's text (#1331's comment); then
  each dependent starts within 5 minutes of the landing. The plant must fail that, naming #101 and #100.

## Readings of what the criteria leave open

- **`<scope>` words name a set** by its issue numbers (`#100, #101 and #102`), its agents by name (`with Claude Code`,
  `with Claude Code and Codex`) and how many run at once (`one at a time`, `two at a time`), as the design's example
  ("work through #219's open issues with Claude Code and Codex, three at a time, until Friday") does. The repo is given
  as `--repo <checkout>`, as every `deep land`, `deep work` and `deep start approve` takes it at the base, and the
  command runs in the checkout. No plan share or end is named; the implementation's defaults stand.
- **Approved agents take turns** in the order the words name them, per issue (AC8's one issue makes per-issue and
  per-run turns the same). "Claude Code with another model" is the model the agent itself reports at session start:
  the played Claude Code reports another model on its second start on the issue, standing for the account's model,
  unless the run launches it with `--model`, which it then reports.
- **Blocked-by links** are the body's `### Depends on` list of `- #<n>` lines, as the base's `Forge.nextIssue` reads
  them; the forge also serves GitHub's `dependencies/blocked_by` list with the same links, so either reading works.
- **The baseline commit's list** lives in the repo, at `.deepbuild/closed-before-gate.json`
  (`{ "closed_before_gate": [...] }`), added in one commit of its own. The issue says a commit "lists them"; `.deepbuild/`
  is where the repo's DeepBuild files live at the base.
- **An issue has a suite** when `tests/acceptance/<n>/` holds a test at the base, as this repo's do; every fixture issue
  has one, so no test here runs the blind job (#1328), which no criterion names.
- **Done means landed** is read off the forge (a merge of a pull request linking the issue, and the issue closed)
  together with #1331's `landing.made` PASS for the issue.
- **Starts** are the played agents' own launches (their logs), which the hub can't edit: "starts" and "never started"
  mean a played agent was (or wasn't) launched on the issue. AC6 also reads the record's `start.started`.
- **"Live attempt"**: a played agent process on the issue that is alive (not a zombie) and hasn't ended its session.
- **Replaced**: an attempt whose turn ends with nothing changed in its worktree (the R6 bullet's "ends with no change to
  its worktree, counts as replaced"). The played agent then waits until it is stopped; ending it is the run's job.
- **A taste ask** is one the attempt raises through `deep_ask` with `kind: "taste"` (`subject.screen: "checkout"`,
  `subject.element: "pay-button"`). "Gives up its slot" is read as the next issue starting; "takes the next free one"
  as its next work coming after the answer and after the issue that held the slot ended its turn. If the run ends the
  waiting session to free the slot, the next attempt's `deep_ask` gets the recorded answer.
- **A machine the host can't serve**: `Runs on: Spark`, the repo's Linux machine (docs/parallel-proof.md), on a run
  hosted on this Mac; `Runs on: Mac` is one it can. What it waits for is read as the row naming the machine.
- **The record's state words** are events naming the issue by `data.issue` with a string `data.word` (a `row.set`
  with `issue`, or a kind of the run's own); the reader of the plant takes them from an issue comment instead.
- **The breaker's ask** names the issue (`#100`, `issue 100` or `issues/100`) and holds each attempt's agent, model
  and cause in its record JSON (`ask.created` data), with the cause's word "replaced".
- **A hub restart** is SIGTERM to the hub's PID, waiting for it to exit, and `deep hub run` again with the same root and
  environment; the started agents are kept by the supervisor, as #1330 keeps them.
- **The 10 s budget** (AC5) follows the repo's reading of timing under load (design: Load; `Inconclusive` in
  `tests/acceptance/29/h-d.ts`): measured from the taste ask's `ask.created` time to the next issue's played agent
  starting; over 10 s while the 1-minute load is at or above the cores, the test reads INCONCLUSIVE (a skip, never a
  pass); over 10 s below that, it fails. The rest of AC5 is judged first, so a wrong program still fails.
- **Waits** in the tests (45, 40, 30 and 20 minutes for landings, 5 minutes for a dependent to start after its blocker
  landed, a minute for a fourth attempt) are test timeouts, not criteria.

## Not covered, because no criterion asks

`deep work pause`; an unreadable blocked-by link keeping an issue waiting; the ready rule's open PR from another account;
the order's reason and the agents' turn reason; the next attempt's brief; the run's end notice.
