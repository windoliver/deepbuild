# Acceptance tests for #2120: push holds, starts and runs

A forced push, an armed merge with no number and two starts at once are each held to their rule; a kept run, a
started session's issue and link, and a refused push to the default branch are each read right.

Written first, blind, by a job that never saw an implementation of #2120; none existed. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

The issue has eight checkbox criteria, AC1 to AC8 in the body's order. Each test's name carries its criterion's ID
(`#2120.` and the first 8 hex digits of SHA-256 of the criterion's text, trimmed, white space collapsed, as
`scripts/proof-change.mjs` reads it). Each test file binds its own ID in a string constant, so a test's name reads as
exactly one criterion; no helper holds an ID.

| AC | ID | Criterion (short) | File |
|---|---|---|---|
| AC1 | `#2120.9f18511b` | a merge armed with --auto and no number still holds pushes to its branch | `auto-no-number.test.ts` |
| AC2 | `#2120.eed5748f` | a push with a force mark, --all or --mirror is held while an armed merge names its branch | `push-forms.test.ts` |
| AC3 | `#2120.5a379749` | a commit offer is in scope only when no rule file the rules page reads reserves commits | `commit-offer.test.ts` |
| AC4 | `#2120.bc7c2b7d` | two starts sent at once take one slot each of the approval's at_once | `at-once.test.ts` |
| AC5 | `#2120.19250b4a` | a run rebuilt from the record is never started beside a kept run that still lives | `kept-run.test.ts` |
| AC6 | `#2120.606be734` | a session DeepBuild starts for an issue shows that issue in the session map | `issue-row.test.ts` |
| AC7 | `#2120.f803e5df` | a started run whose first hook comes after a hub restart is still linked to its session | `restart-link.test.ts` |
| AC8 | `#2120.dd8501f8` | a refused push to the default branch is recorded in a repo with no origin/HEAD | `default-branch.test.ts` |

## What was read

- Issue #2120 as of 2026-11-14T23:23:32Z (`updatedAt`): Scope, the eight criteria, What goes wrong today, Proof,
  Depends on. Its line numbers are from the audit's branch; the code at the base has moved.
- `docs/technical-design.md`: Sessions that know about each other, How it installs, Decided, the Threats row on
  sessions DeepBuild starts, and Dogfooding with Criteria to tests and Criteria in a checked shape. `AGENTS.md` (Proof).
- At the base `2baafea73726387c4fabe5057599be0831774f0a` (main, 2026-11-14), for surfaces and conventions only:
  `packages/hub/src` (`holds.ts`, `named.ts`, `questions.ts`, `rules.ts`, `starts.ts`, `runs.ts`, `siblings.ts`,
  `server.ts`, `core.ts`, `wire.ts`, `hub-control.ts`, `stop-reply.ts`, `ask-tasks.ts`, `hookmap.ts`,
  `session-state.ts`, `start-command.ts`), `packages/supervisor` (kept runs, `lives`, the terminal host's `pid` file),
  `crates/deep-hook/src/matcher.rs` (what a merge call names: `pr=`, `head=`, `auto`) and
  `crates/deep-hook/default-rules.json`; `scripts/proof-change.mjs` and `scripts/proof-runs.mjs` (how a test's name is
  read for its criterion ID, and what counts as failing at an assertion: each reading here ends in an `expect` in this
  folder, and each setup step that fails throws BLOCKED).
- Suites, for their form. Their helpers are imported by relative path, never copied: `tests/acceptance/1523` (the
  delivered thread, merges armed with --auto, merge-names-head), `tests/acceptance/84/sort` (commit offers, "proceed",
  commit-not-reserved), `tests/acceptance/1330` (the world for `deep start`, approvals, the stand-in's log, the session
  map's rows through `sessions.read`) and `tests/acceptance/996` (the hub on a root of its own, a damaged runs.json).
  `tests/acceptance/1325`'s Claude Code stand-in, which runs Bash turns, is read by path and installed as #1325 installs
  it; its refusals test showed `forge.refused` read from a call's output. `tests/acceptance/70` (kept runs across a hub
  restart) was read only.

## What the base does

Every test fails at its assertion, for the reason its criterion's "Today ..." sentence gives; `BASE-FAILURE.txt` has
each file's run.

- AC1: the merge is recorded armed with an empty number, which the reader of armed merges skips: the push runs.
- AC2: `pushBranches` reads `+b`, `+refs/heads/b` and `cur`; each of the four pushes runs.
- AC3: with the line in the root AGENTS.md, and with it in `~/.codex/AGENTS.md`, the offer is answered "proceed" by
  rule commit-not-reserved, on the record and in the stop's reply, and no authority ask is raised.
- AC4: both starts start.
- AC5: the rebuilt run is finished "stopped: hub restarted" while it lives, and its command starts again.
- AC6: the row's map shows branch `deep/41-<id>` and issue null.
- AC7: no start.session is recorded for the run.
- AC8: no forge.refused is recorded.

## Run them

Only where `/usr/bin/sandbox-exec` exists (the stand-in agent runs its hooks and commands in that sandbox, and #1330's
world reads BLOCKED without it), with the runtime `.node-version` names (24.22.0):

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH"
npm ci                                      # once
npm run build --workspaces                  # every test runs packages/cli/dist/main.js
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook   # every hook runs target/debug/deep-hook
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2120 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2120/tsconfig.json
```

- Every file starts hubs of its own, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list (`alone`), as
  its neighbours' suites are. The implementer adds it.
- Folders and processes are each imported suite's own: `/tmp/dh1523-*` (AC1, AC2), `/tmp/dh84s-*` (AC3),
  `/Users/Shared/dh1330-*` (AC4, AC6, AC7, AC8: the home #1330's README explains), `/tmp/dh996-*` (AC5). Each sets
  `HOME` to a test home for every process it starts and never touches the real `~/.deepbuild`, `~/.claude` or
  `~/.codex`; each removes its folders at the end. Processes are stopped by PID only, never by name or port: the hubs,
  what they started, the stand-ins and kept runs. This suite's own cleanup stops a gated agent only while its command
  line still names its test home.
- A missing CLI build or deep-hook, or a hub that won't start, reads BLOCKED (an Error whose message starts with
  `BLOCKED:`), never a pass. So does any step a criterion's reading stands on: an approval, a start, a thread's PASS.
- No model is called and nothing leaves 127.0.0.1. With `--root` here, the runner may write a cache under
  `tests/acceptance/2120/node_modules/`; it is not part of the suite.

## The stand-ins

The agent is the one boundary these tests don't own; nothing stands in for the hub, deep-hook, git or a worktree.

- **AC1 to AC3: the test plays a Claude Code session**, as #1523 and #84 do: each hook is deep-hook run as a child of
  the session's own process, with transcripts shaped like Claude Code's. A call the hub allows "runs" as the test
  writing its PostToolUse; nothing is pushed or merged. AC2's switch to branch c is made in the repo when it is allowed.
- **AC4, AC6 to AC8: `claude` on the test home's login PATH** is #1325's Claude Code stand-in
  (`../1325/fixtures/claude.mjs`, read by path, its version and log folder filled in as #1325 fills them), which plays
  #1330's agent and also runs `[standin:bash:<base64url>]` turns. In front of it this suite puts a gate
  (`helpers.ts`, `installStandIn`): `bin/claude` is a shell script that answers `--version` at once and otherwise, while
  the gate file is missing, waits, noting its PID and folder in `~/.gated/<pid>`, then execs the stand-in under the same
  PID. The gate is open from the start except in AC7, where it holds the agent's first hook until the hub has restarted.
  A gated agent gives up after 300 s.
- **AC8: the forge.** The started session's one Bash call prints `fixtures/gh013-main.txt` to stderr and exits 1: what
  git prints when GitHub refuses a push to refs/heads/main under a ruleset (GH013). Nothing is pushed; the hub reads the
  call's output, as it reads a session's git, whose children no hook sees.
- **AC5: the kept run** is `/bin/sh -c` noting its PID and each start in files of its folder, then `exec /bin/sleep
  600`. It writes nothing to its output, so it outlives the hub that holds its pipes.

## How each criterion is read

- **AC1** (`auto-no-number.test.ts`): #1523's thread on branch b: "Fix <link>, then create PR.", the fix, its commit,
  `git push origin HEAD`, `gh pr create --fill` (PR 12), the claim PASS on `head`, then "merge PR 12". The agent arms
  the merge as the issue writes it: `gh pr merge --auto --squash --match-head-commit=<head>`. deep-hook reads a number
  only from a third plain word after `gh`, which this call has none of, so the hub gates it with auto, the PASS head and
  no pr; it must go through (else BLOCKED). Then `git push origin b` must be denied, its reply naming
  `merge-names-head` (as #1523's `rulesIn` reads a guard's name).
- **AC2** (`push-forms.test.ts`): `pushBranches` (the function the issue names, imported from
  `packages/hub/src/named.ts`) must return `['b']`, `['b']` and `['*']` for the issue's three calls with `'cur'`. Then
  #1523's thread, with PR 12's merge armed by `gh pr merge 12 --auto --match-head-commit <head>` on b: `git push origin
  +b` and `git push -f origin +refs/heads/b` from b, then, after the agent's `git switch -q -c c`, `git push --all
  origin` and `git push --mirror origin` from c. Each must be denied naming `merge-names-head`. --all and --mirror go
  out from c because from b the base reads them as b and already holds them; the issue's own case is "from another
  branch". --mirror is in the criterion's heading, so it is pushed too.
- **AC3** (`commit-offer.test.ts`): #84's sort world, twice, each on a hub of its own. The session's working folder is
  `packages/x` (its hooks' cwd, its transcript's project folder and `CLAUDE_PROJECT_DIR`). You type "Is the x
  package's README clear?", which opens no task; the agent edits `packages/x/README.md`, which makes the stop a judged
  claim, and ends on "Want me to commit this?". The line `- Never commit unless I ask` is in the repo's root AGENTS.md
  (committed), then, in a fresh world, only in `~/.codex/AGENTS.md`. Each time: no `question.proceeded` on the
  session since the stop, the stop's reply doesn't name commit-not-reserved, and an `ask.created` of kind authority
  names the offer. The session is a Claude Code one both times: the Scope reads both user-level files for every
  session, as the rules page does.
- **AC4** (`at-once.test.ts`): #1330's world, an approval for issues 41 and 42, Claude Code, at most one at once. One
  cli connection, its hello naming this process as its peer as `deep start` names its own, writes two `start.session`
  requests (`{ repo, issue, agent, prompt }`, what `deep start` sends) in one write, so the second doesn't wait for the
  first's reply. The two replies must be one `started` and one `refused` with `bound: "at_once"`, in either order.
- **AC5** (`kept-run.test.ts`): #996's hub on a root of its own. `run.start` with `keep: true` starts the kept run; once
  it has noted its start and the record holds `process.tracked` for it, the hub is killed (kill -9) and `runs.json` cut
  to half its bytes (it must no longer parse, else BLOCKED). The run must still live (else BLOCKED: nothing in flight).
  The hub starts again on the root and is watched for 20 s; then the run must still live, no `run.finished` may name
  it, no other `run.started` may carry its argv, and its program must have noted one start.
- **AC6** (`issue-row.test.ts`): #1330's world, an approval for issue 41, `deep start --issue 41`. Once the stand-in's
  turn is done and `sessions.read` has the session's row with its session map (`map`), `map.issue` must be 41.
- **AC7** (`restart-link.test.ts`): as AC6 with the gate shut. Given the agent waits at the gate in the start's worktree,
  the record holds `process.tracked` for the run, and no start.session or stand-in turn exists yet, the hub is stopped
  (SIGTERM, by its PID) and `deep hub run` started again on the same home with #1330's settings. The gate opens; once
  the agent's turn is done and the new hub's record holds an event of its session, a `start.session` for the run must
  name that session, and only one.
- **AC8** (`default-branch.test.ts`): #1330's repo is made with `git init`, `remote add` and a push, so it has
  origin/main and no origin/HEAD; the test deletes origin/HEAD if git made one and checks both (else BLOCKED). Under an
  approval for issue 41, `deep start` starts a session from origin/main whose one Bash call prints the refusal. Given the
  call ran, its output holds GH013 and start.session links the session to the run, a `forge.refused` naming the run or
  session must have `action: "push-default-branch"`.

## Load

The machine is shared, and was loaded past its cores throughout (a 1-minute load up to about 280 on 18 cores). A
reading spoiled by load is skipped as INCONCLUSIVE, never passed:

- AC1 to AC3: the rules of the suites they import (#1523's and #84's `verdict`): a hook deep-hook couldn't hand to the
  hub within its budget; for AC1 and AC2 also a call let through before the hub decided it (`expectDecided`), and no
  locked definition or PASS in time on a loaded machine.
- AC1, AC2: a merge the hub recorded armed "on branch " with no name, its 2-second git read of the branch having
  timed out.
- AC6: a row whose map read no branch for the session.
- AC7: an agent whose first hook came more than 50 s after the start, within reach of the 60 s after which ending as
  never started is the criterion's other branch.

## Checked apart from the suite

Not part of the suite: one throwaway file, run once on the base and deleted, drove the base into the case it already
handles through the same harness as each criterion, to show each test's passing reading is reachable. Each passed,
one of them on its second run:

- AC3: with the line in `packages/x/AGENTS.md`, the session's own folder (which the base reads), the offer raised an
  authority ask and no proceed.
- AC1, AC2: with PR 12 armed on b by number, `git push origin b` was denied naming merge-names-head. (Its first run, at
  a load near 270 and without `expectDecided`, let the push through; run again it was denied. AC1 and AC2 read a late
  allow as INCONCLUSIVE.)
- AC4: two starts one after the other: the second was refused with bound at_once.
- AC7: the gated agent, with no restart, was linked by start.session once its first hook arrived.
- AC8: with origin/HEAD set, the same refusal was recorded as push-default-branch.
- AC5: with runs.json intact, the kept run was adopted: alive, no run.finished, one start.

## Drafting notes

- AC3's first draft opened a work item's task (#84's `startOnItem`) from the subfolder; at a load near 260 its
  definition didn't lock within 60 s, so the run read INCONCLUSIVE twice. The test now asks a question, which opens no
  task, so no definition has to lock; the criterion's reading is unchanged.
- AC5's first run stopped watching at the first `run.finished` and read the program's starts before the second copy
  noted its own; the test now watches the full 20 s.

## Not asserted

- `--branches` and `pushBranches` on --mirror (the Scope's, not the criterion's values); `--disable-auto` with no number.
- AC5's other half of its heading, a rebuilt run of another check kind (spec, outside) ending INCONCLUSIVE: its
  given and then name only the kept run.
- AC6's start notice and the "Keep which?" ask of two started sessions on one issue (the issue's note).
- AC7's other branch, a started agent that never hooks after the restart ending as never started.

## Known limits

- The stand-in plays Claude Code's hooks and argv as #1325's header lists them, and the forge's refusal is a transcript
  of GitHub's; neither is the real program.
- AC3 plays a Claude Code session; a Codex session's own hooks are not driven.
