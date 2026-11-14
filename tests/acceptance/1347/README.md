# Acceptance tests for #1347: a project with no forge, its tasks in the record

Written first, blind, from issue #1347 as of 2026-11-13 (Scope, the five criteria, Proof, Depends on; it has no
comments), by a job that never saw an implementation; none existed. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

| AC | ID | Criterion, in short | File |
| --- | --- | --- | --- |
| AC1 | `#1347.7361f8e4` | a workspace with 6 tasks and 7 blocked-by links runs to the end with no forge configured; a planted run that calls a forge fails, naming the call | `run.test.ts` |
| AC2 | `#1347.b6ca1fd3` | no task starts before its blockers finish; a killed session continues as a next attempt, as on a repo | `run.test.ts` |
| AC3 | `#1347.8994a8fa` | a task's verdict names its commit and its state digests; a drifted source makes it stale and re-runs only the checks reading it | `verdict.test.ts` |
| AC4 | `#1347.841043a4` | going back one step restores the last version byte for byte | `back.test.ts` |
| AC5 | `#1347.8f5ee69e` | moving the workspace to a fixture repo files each open task once, with its links | `move.test.ts` |

Each test's name is its criterion's ID and full text (`#1347.` and the first 8 hex digits of SHA-256 of the criterion's
text, white space collapsed, as `scripts/proof-change.mjs` computes it). AC1 and AC2 share one file because they read
one run (`run.test.ts` opens it once); every other criterion has a world of its own.

The Proof (a fixture workspace run with the forge unreachable, and its record) is what AC1's test runs. No live test is
written, so nothing here touches GitHub or a paid model.

## What was read

- Issue #1347 (`gh issue view 1347 --comments`).
- `docs/technical-design.md` at the base: Work outside a repo; Attempt and plan; Later, as extensions (the R6 work-run
  bullet, **Work runs** and **Landing in turn** especially); the **Work source** bullet (`work.item@1`'s fields); and
  Dogfooding under How we know version 0 works. `AGENTS.md` (Proof).
- At the base `f6d811c79`, for surfaces and conventions only: `packages/hub/src/workspaces.ts`, `workspace-command.ts`
  and `packages/workspaces` (#67: `deep workspace new|move|revert|diff|drift`, `state.read`, `.deepbuild/workspace.json`,
  the `host` source, `main` as a workspace's branch, a revert as a new commit), `work.ts` and `land-command.ts` (#1332:
  `deep work "<scope>"`, the scope's words, `work.state`, `work.attempt`, `work.run`), `starts.ts` (#1330:
  `start.approve()`, `start.approval`, worktrees), `landing.ts` (#1331), `ask-tasks.ts` (how a handed definition is
  found: `issue` against a work item's `source_id`), `plant.ts` (how a plant is selected and refused), `server.ts`
  (`DEEP_HUB_TEST_FORGE`), `hub-shared.ts` (`ghToken` reads no token in a temp HOME), the schemas `work.item@1`,
  `state.read@1`, `verdict.made@1`, `verdict.stale@1`, `run.started@1`, `work.state@1`, `start.started@1`, and
  `scripts/proof-change.mjs` (criterion IDs).
- The suites `tests/acceptance/67`, `1332` and `1331`, for how a world is built. Imported by path, not copied:
  `../1332/helpers.ts` (`must`, `mustFail`, `waitUntil`, `requirement`), `../1332/fixtures/agent.mjs` (the played
  agents), `../1332/forge.ts` (`WorkForge`, on `../1331/forge.ts`, `../1325/forge.ts` and `../46/forge.ts`),
  `../67/hub.ts` (`nodeCheck`, `CHECK`, `changed`) and `../29/h-d.ts` (the hub's stop, `events.read`, the child
  environment, your ask settings).

## What the base does

At `f6d811c79` all 5 tests fail, each at its own assertion in its own file (`BASE-FAILURE.txt`), on the first new
step: `deep workspace task` isn't a command, so `deep workspace` prints its usage and exits 2, and no task enters a
workspace's record. Each world sets up on the base: the hub, #67's `deep workspace new`, the played agents, and the
unreachable forge or the played forge with its fixture repo.

Found on the base with a throwaway probe (deleted; not part of this suite), in the same world: `deep work "<scope>"
--repo <workspace folder>` already raises #1330's approval for a workspace, and once it is answered yes #1332's pass
fails each time on "No such remote 'origin'" and starts nothing. In 150 s with that run approved, the idle hub made no
connection to the unreachable forge's address, so any connection there in AC1's world is the run's. `deep workspace
revert <id>` with no commit prints the usage; `deep workspace move <id> <folder>` refuses a folder that holds something.
Missing, in all: tasks in a workspace's record, a run over them, finishing a task on a workspace commit, going back one
step, moving a workspace to a repo, and the plant.

## Run them

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH"   # the repo's Node
npm ci && npm run build --workspaces                                  # every test runs packages/cli/dist/main.js
cargo build --locked -p deep-hook                                     # the played agents' hooks
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1347 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1347/tsconfig.json
```

Each world lives under `/tmp/dh1347-*` (a short path, for the hub's socket), HOME set there, removed at the end. Every
process is stopped by its PID, and only one whose command names the world's folder or this checkout. Run the folder
alone (every test starts its own hubs, so it belongs in `scripts/lanes.mjs`'s `alone` list, a file outside this
folder). Vitest with `--root` leaves `node_modules/.vite/` here; delete it before committing. A missing CLI build or
deep-hook, or a hub that won't start with a plant it doesn't list, reads BLOCKED, never a pass. On a right
implementation each file runs real gate checks and finishes real tasks, so allow tens of minutes per file under load.

## What is real, what is played

Real: the hub (`deep hub run`) and its record, #67's workspaces and state sources (the shipped `host` source), #1330's
starts, #1332's run, the gate's check runs (`node --test`), deep-hook, `deep mcp`, git, the CLI.

Played, at boundaries the repo doesn't own:

- **No forge** (AC1 to AC4): the hub's HOME is a temp folder with no `github` block in `config.json`, no `GH_TOKEN`
  and no `gh` on the login PATH, so it holds no forge token; its forge address, `DEEP_HUB_TEST_FORGE`, is a 127.0.0.1
  port that takes each connection, records the request line it sends and closes it with no answer (`DeadForge` in
  `helpers.ts`). Nothing else listens there.
- **The fixture repo's forge** (AC5): `forge.ts` in front of #1332's `WorkForge`. It adds each issue's `id` beside its
  number, `POST /repos/{owner}/{repo}/issues` by whoever holds a token (each one recorded), GitHub's blocked-by links
  (`POST /repos/{owner}/{repo}/issues/{n}/dependencies/blocked_by` with the blocking issue's `issue_id`, and `GET` of
  the same list) and `GET /user`. The repo `acme/shop` has one commit on `main`; the hub's checkout of it is
  `<world>/checkout`. maya is the repo's admin; her token is the hub's `GH_TOKEN`. Issues are numbered from #100.
- **The agents**: #1332's `fixtures/agent.mjs`, unchanged, installed as `claude` and `codex` first on the login PATH,
  reporting the newest version each agent's facts cover. A session fires the hooks of the agent's own config
  (`~/.claude/settings.json` with deep-hook as `deep setup` writes it) and plays one turn. Its task is the number in
  its worktree's branch (`deep/<n>-…`), else the first `#<n>` of its prompt. Its turn, by the test's plan for that task
  and launch: `work` (writes `src/i<n>.txt` = `done <n>`, commits it in its folder and stops claiming done; with no
  `GH_TOKEN` or no `origin` it pushes nothing and opens no pull request), `hang` (writes an uncommitted `notes-<n>.txt`,
  then hangs inside a Bash call) and `gated` (waits for the test's go, then works). It logs what it saw and did to
  `<world>/agents/log/<pid>.json`; the tests read starts, folders, found files and times there.
- **The definitions**: each task's requirements are handed through `DEEP_HUB_TEST_DRAFTS`, keyed by its record item's
  `source_id`. Each check is #67's drafted node:test check under `.deepbuild/checks/`, committed in the workspace before
  the run: a task's own check passes unless `src/i<n>.txt` says BROKEN; AC3's checks read a host's state too.
- **The hosts** (AC3): two of #67's `host` touches, each a change log under the world's folder.

## The surfaces under test

1. **`deep workspace new <topic>`** (#67, at the base): the workspace, `{"id", "folder"}`.
2. **`deep workspace task <id> <title> --criterion <text> [--criterion <text>]... [--blocked-by <n>]...`**: a task
   entered in the workspace's record. Exits 0 and prints one line of JSON, `{"task": <n>}`, its number in the
   workspace (a number, `#<n>`, or an ID ending in `#<n>`). `--blocked-by` names an earlier task's number.
3. **The record** (`events.read`): for each task an event whose data holds work.item@1's `source_id`, `title` and
   `criteria` and its blocked-by list (`blocked_by`, `blockedBy` or `blockers`; each entry a task's number, `#<n>`, the
   blocker's `source_id`, or an object naming one); `ask.created` and #1330's `start.approval` for the run's approval;
   `verdict.made` (`outcome`, `verdict`, `claim`, `requirements[].check`, `commit`, `key.state_digests`); `state.read`
   (`claim`, `readings[].touch`, `readings[].digest`); `verdict.stale` (`verdict`); `run.started` and `run.finished`
   (`run`, `check`).
4. **`deep work "<scope>" --repo <workspace folder> --json`**, run in the workspace's folder: raises the run's one
   approval through the hub's `start.approve()` and prints `{ "ask": "ask:<id>" }`; the record holds the ask's
   `ask.created` (an authority ask) and `start.approval` naming it. Answered yes with `deep inbox answer <ask> <option>`,
   the option whose `decision` is `allow`. From then the hub runs the set by itself.
5. **`deep workspace revert <id>`**, naming no commit: going back one step. Exits 0.
6. **`deep workspace drift <id>`** (#67, at the base). Exits 0.
7. **`deep workspace move <id> <checkout>`**, with a repo's checkout for the folder: moving the workspace to the repo.
   Exits 0.
8. **The workspace's own git history and files**: its `main` branch, the branch's reflog, commits' trees, the folder.
9. **The forges' own records**: each connection to the unreachable address; on the fixture forge, each issue opened,
   its final body and its blocked-by links.
10. **The plant**, a value of `DEEP_HUB_PLANT` that the implementation adds to `packages/hub/src/plant.ts`, given to the
    hub and to every `deep` command the test runs:

| Plant | The wrong program | Read by | Its failure names |
| --- | --- | --- | --- |
| `workspace-calls-forge` | a run over a workspace's tasks that reads or writes a forge | AC1 | the call: the first request line the forge's address received, such as `GET /repos/... HTTP/1.1` |

AC1 runs the right program first, so on the base it fails there, before a planted hub is ever started.

## How each criterion is read

- **AC1** (`run.test.ts`): a workspace "Client report" with six tasks, entered in order, and seven links shaped as
  #1332's first criterion's (task 1 blocks 3 and 4, 2 blocks 4 and 6, 3 and 4 block 5, 5 blocks 6). The record holds
  each as an item with its criteria and what it is blocked by. `deep work "work through #a, #b, … and #f with Claude
  Code, two at a time"` raises the one approval; once it is answered yes the run goes on alone (the first task's first
  attempt is killed for AC2). Within 45 minutes every task finished (reading below), and in the whole life of the
  world nothing reached the forge's address. The planted run of the same world runs until the address is reached (or
  30 minutes); the same judgement must then fail naming the first request line it received.
- **AC2** (`run.test.ts`, the same run): every played agent's start on a task came at or after the moment each task it
  is blocked by finished. The first task's first attempt writes `notes-<n>.txt`, never commits it, and hangs mid-call;
  the test kills it with SIGKILL. As on a repo (#1332's third criterion): the next attempt runs in the same worktree
  (real path), found the notes with the same bytes, started after the killed one hung, and, sampled every half second
  throughout, never two played agents live on the task at once.
- **AC3** (`verdict.test.ts`): a workspace touching two hosts, web-1 and web-2 (#67's `host` source). Task one's checks
  read web-1 (port 80) and web-2 (TLS), task two's web-2 (certificate); two at a time; both finish. Task one's verdict
  (the newest PASS on its checks covering a commit of `main` that holds its change) names a commit that is in the
  workspace's history and holds the change, and its `key.state_digests` are the digests of the record's `state.read`
  for its claim, which read web-1 and web-2. Then web-1's `workers` changes (its check still passes) and `deep
  workspace drift` runs: the `verdict.stale` events after it name task one's verdict and none of task two's, and the
  `run.started` events after it are for web-1's check alone, at least one (read once those runs finished, or 5
  minutes, and 30 s more).
- **AC4** (`back.test.ts`): a workspace "Trip plan" holding a CRLF note with no newline at its end, a binary file and a
  script that runs; task two blocked by task one; one at a time; task two's session waits for the test's go. Once task
  one finished and task two's session started, `main`'s tree is the last version. Then task two goes on and finishes,
  and `main`'s tree changed. `deep workspace revert <id>` exits 0, and the workspace's folder, every file but git's
  own, holds exactly that tree: the same paths, bytes and run bits.
- **AC5** (`move.test.ts`): a workspace "Shop launch" with four tasks; the second blocked by the first, the third by
  the second, the fourth by the second and the third. A run over the first alone finishes it; the other three stay
  open. `deep workspace move <id> <checkout>` exits 0; 2 minutes for the issues to arrive and 20 s more. The issues
  opened since the move carry exactly the open tasks' titles, each once, and none the finished task's; each one's
  blocked-by links are exactly the issues filed for its blockers that were open (the second's: none; the third's: the
  second's issue; the fourth's: the second's and the third's).

## Readings of what the criteria leave open

- **A task enters the record through `deep workspace task`**, a sixth subcommand of #67's `deep workspace`: one line
  of JSON, no question, like the other five. The issue names no surface for it; this is the smallest extension of the
  command that already makes and changes workspaces, and it needs no new file format. A task names its blockers by the
  numbers earlier tasks printed.
- **The record item** is an event of any kind whose data holds `work.item@1`'s `source_id`, `title` and `criteria`,
  plus the blocked-by list the scope asks for under `blocked_by` (`blockedBy` and `blockers` read too). Its other
  work.item@1 fields (`link`, `body`, `authors`, `updated`) aren't read.
- **A task has a number, and `<scope>` names it as `#<n>`**: "the run doesn't notice the difference", and the order
  "then the lowest number" needs one. The numbers are the ones `deep workspace task` printed. `--repo` names the
  workspace's folder, as `deep work` takes a checkout at the base ("a project is a repo or a workspace"), and the
  command runs there.
- **The run's brief names the task as `#<n>`** (or its worktree's branch is `deep/<n>-…`), as it names an issue, so the
  played agent knows which task it works.
- **A task's definition** is handed by its record item's `source_id`, as the base hands a work item's (`issue` against
  `source_id`).
- **Finished** (the issue: "a task finishes when its PASS covers the workspace's new commit and the digests of what its
  state sources read"): the workspace's default branch, `main`, holds the task's change, and a PASS on the task's own
  checks (a `verdict.made` whose requirements name exactly its checks) covers a commit of `main`'s history that holds
  the change. When it finished is the later of the first such PASS and the moment `main` first held the change, from
  `main`'s reflog to the second, rounded down, so a start in the same second reads in time. The task's verdict is the
  newest such PASS.
- **"No forge configured" and "unreachable"**: no forge token anywhere the hub reads one, and its forge address taking
  connections that get no answer. Any connection there, from any part of the hub, during the world's life is a call;
  the idle base hub made none (What the base does). "Naming the call" is naming its request line. "Runs to the end" is
  every task finished, read as above.
- **The run's one approval** is #1332's: `deep work "<scope>"` raises it through `start.approve()`, and the test
  answers it yes; whatever else the run asks isn't read (the criteria name no ask).
- **"As on a repo"** is #1332's third criterion: the same worktree, its uncommitted files intact, one live attempt at a
  time. No hub restart, which #1347 doesn't name.
- **"Its state digests"** are `key.state_digests` of the verdict, as #67 pins a workspace verdict, equal to what the
  record's `state.read` read for its claim. **"Goes stale"** is `verdict.stale`; **"run again"** is `run.started`. The
  drift is #67's `deep workspace drift`.
- **"Going back one step"** is `deep workspace revert <id>` with no commit: one step, nothing to pick. "The last
  version" is `main`'s tree before the last task finished, read once the task before it had finished and the last
  one's session waited. "Byte for byte" is every file in the folder, but `.git`, as #67's revert test reads a
  workspace: paths, bytes and whether each runs.
- **"Moving the workspace to a fixture repo"** is #67's `deep workspace move <id> <folder>` with the repo's checkout for
  the folder, in place of the empty folder a move takes at the base. A task is filed as an issue with its title.
  Its links are the issue's blocked-by links as the base reads them (a body's `### Depends on` list of `- #<n>` lines,
  read from the body as the forge holds it after any edit) or as GitHub keeps them (`dependencies/blocked_by`), either
  or both. A link to a finished task, which has no issue, is filed as no link. "Open" is not finished (reading above).
- **Waits** (45, 40, 30 and 30 minutes for runs, 2 minutes for issues, 30 s and 20 s of quiet) are test timeouts, not
  criteria.

## Not covered, because no criterion asks

`deep work show` and `deep work pause` for a workspace; asks a run raises; the order's reason; a state source that
can't undo a change saying so first (Scope); what the move does to the workspace's files and id; moving twice; a hub
restart.
