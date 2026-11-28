# Acceptance tests for #3511, the folded criteria: what a host read and run rest on, and what the local read believes

Written first, blind, by a job that never saw an implementation of #3511; none exists at the base (`8748e5ca5`, main).
The suite covers only the six criteria folded in from #3589 and #3584, the 4th to the 9th checkboxes. The first three
have a suite of their own elsewhere, not read here. The implementing agent doesn't edit these files (AGENTS.md, Proof);
a dispute goes to a blind redraft of this job (design: Dogfooding).

**Not run.** This job was barred from building, installing or running anything (no npm, cargo, vitest or tsc: the
machine is loaded and the host files need a Mac's Lima VM). No test here has run and nothing was type-checked. The
only check made was that each `.ts` file parses once its types are stripped (Node's `stripTypeScriptTypes`). There is
no `BASE-FAILURE.txt`; whoever first runs the suite on the base saves one. Every failure at the base below is predicted
by reading.

## What was read

- Issue #3511 as `gh issue view 3511` gave it on 2026-11-27: the problem, Scope (with the parts folded in from #3589
  and #3584), the nine criteria, Proof and Depends on. #3589 and #3584 themselves were not read.
- `AGENTS.md`, and `docs/technical-design.md` as `node scripts/design-section.mjs --issue 3511` prints it: How runs
  become one of five verdicts (Whose checks count: a check's own files) and Blocks for work on your other machines
  (Sessions on a host).
- The base, for surfaces and conventions only: `packages/hub/src/claim-changes.ts` (`changesOf`, the local read),
  `packages/gate/src/own.ts` (`ownChanges`, `ownRead`, `targetBody`, `checkSource`), `packages/hub/src/gate-runner.ts`
  (`stop`, `ownChanged`, `verdictOf`, `ClaimCheck`), `packages/hub/src/gate-options.ts` (`invalid`),
  `packages/hub/src/host-gate.ts` (`stopOnHost`: no read, no `changes`, runs in the session's live folder),
  `packages/hub/src/ask-tasks.ts` (a handed definition's check and its approved digest), the comment in
  `packages/checks-command/src/index.ts` that a drafted check runs as `sh file`, `scripts/proof-change.mjs`
  (`criterionId`), `scripts/lanes-lists.mjs` (`lane.json`), `scripts/wait-ratchet.mjs`. The suites `999` (its
  README, `helpers.ts`, `session.test.ts`, `fixtures/agent.sh`, `lane.json`, `tsconfig.json`), `3114` (`bench.ts`,
  `quoted-paths.test.ts`, README), and the READMEs of `875` and `33`. No `1869` suite exists at the base.

## Criteria and files

Each `describe` title starts with the criterion's ID: `#3511.` and the first 8 hex of SHA-256 of the checkbox text
after `- [ ] `, trimmed, white space collapsed (`scripts/proof-change.mjs`'s `criterionId`, on the body `gh` returns).

| # | ID | File | Tests |
|---|---|---|---|
| 4 | `#3511.5bba85cf` | `live.test.ts` | the claim sets price.txt to 19.00 and leaves a process running that rewrites `test/price.test.sh` to `exit 0` once the check's run begins on the host (the read has been made by then): the claim does not read PASS |
| 5 | `#3511.89c2a00f` | `login.test.ts` (2) | the claim edits `test/price.test.sh` to `exit 0`, then the agent plants (a) a `git` first on the PATH its `~/.bashrc` and `~/.profile` set, printing nothing for `diff`, `ls-files` and `status`, or (b) a first line in those files that exits 0, printing nothing, for a command holding git and diff, ls-files or status: the claim does not read PASS |
| 6 | `#3511.1d3555aa` | `top.test.ts` | the session's folder is `app/` of its repo; the claim edits `../test/price.test.sh` to `exit 0` and writes `app/.git`, a gitfile to a clean clone whose `core.worktree` is itself: the claim does not read PASS |
| 7, on a host | `#3511.80ee3c2c` | `hidden.test.ts` (11) | below: each claim does not read PASS, and a reason names the check as the agent's own or names a read the gate couldn't make |
| 7, locally | `#3511.80ee3c2c` | `local.test.ts` (11 + a control) | the same eleven, on the local gate; the control edits the test file in plain sight |
| 8 | `#3511.173e6c70` | `local.test.ts` | a local claim that changes only price.txt, in a repo with none of those, reads PASS and no reason counts the check as the agent's own |
| 9 | `#3511.aeb1c56e` | `leftover.test.ts` | the first claim (price.txt 18.00) reads FAIL (a control) and its check leaves `test/last-run.log` untracked; the second claim changes only price.txt to 17.00 and reads PASS |

The eleven cases of criterion 7, in the same order in both files:

| Case of the criterion | How the claim hides it |
|---|---|
| a check's own file git is told to ignore | a new `test/cases/skip.sh` the check's test sources, listed in `.git/info/exclude` |
| the same | the same file, in `test/cases/`, which the base's `.gitignore` already ignores |
| an index flag | `git update-index --skip-worktree test/price.test.sh`, then the edit |
| an index flag | `git update-index --assume-unchanged test/price.test.sh`, then the edit |
| a replace ref | the edit, then `git replace <base> <a parentless commit of the edited tree>` |
| the stat settings | the base's `test/price.test.sh` committed with an mtime in 2001; `core.checkStat minimal`, `core.trustctime false`, the file rewritten to the same size and its mtime put back |
| a work tree set elsewhere | `core.worktree` set to an unedited copy of the base outside the folder, then the edit |
| a filter program | `.git/info/attributes` gives `test/*.sh` a clean filter that prints the file's base bytes, then the edit |
| a quoted path | a new `test/cases/é skip.sh` the check's test sources, not ignored |
| a changed Makefile target a check runs | the check runs `make -s check`; the claim changes the `check:` recipe to `@true` |
| a changed justfile target a check runs | the check runs `just check`; the claim changes the `check` recipe to `@true` |

## Run them

macOS with this Mac's Lima VM `deep-ubuntu` running (or the one `DEEP_TEST_VM` names), as #999's suite needs it, the
repo's Node (24.22.0) first on `PATH`:

```sh
npm ci                                           # once
npm run build --workspaces                       # the host files run packages/cli/dist/main.js through #999's helpers
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook
NO_COLOR=1 node node_modules/vitest/vitest.mjs run tests/acceptance/3511-redraft-ac4-ac9 --testTimeout=1800000 --hookTimeout=900000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/3511-redraft-ac4-ac9/tsconfig.json
```

`local.test.ts` alone runs on any machine with git in seconds, after `npm run build --workspaces` (it imports the gate
runner's source, as #3114's suite does, and the hub's packages need their `dist/`), and needs no VM:
`node node_modules/vitest/vitest.mjs run tests/acceptance/3511-redraft-ac4-ac9/local.test.ts`.

- **Two surfaces.** Host scenes go through #999's helpers, imported from `tests/acceptance/999/helpers.ts`: a hub of
  their own in a temp home, `deep host add` on the VM, a Claude Code session there whose hooks deep-hook runs, the
  handed definition whose one check is `.deepbuild/checks/price.sh`, and the held stop that makes the claim. What is
  read is the claim's last `verdict.made` in the hub's record (its `outcome` and `reasons`), once every run of the
  claim has ended before it (`scene.ts`, `stopAndJudge`). Local scenes go through the hub's own `GateRunner`, as
  #3114's bench does: a real git repo whose base is a real commit, the claim written into its worktree, the gate's
  `stop` reading what changed with `changesOf`, one passed run reading the files the test names, and the verdict the
  gate makes (`verdictOf`, or what it hands `invalid`).
- **One at a time.** `lane.json` puts the folder in the alone block for the VM, as #999's does. See Open points: the
  folder's name.
- **Needs.** On the VM: `git`, `tar`, `make` for the Makefile case and `just` for the justfile case; a missing one
  fails that test as `BLOCKED`. A VM that can't be reached, a binary that isn't built, a hub that doesn't start, an
  agent's call that isn't let through, or a scene that didn't come out as meant (the check doesn't exit 0 in the
  folder, plain git still lists the hidden file, the planted git isn't first on PATH, `git` in `app/` doesn't take
  the clone for its top, the first claim's check left no untracked log) fails as `BLOCKED`. Nothing skips, and nothing
  missing passes.
- **Safety.** #999's: local folders under `/tmp/dh999-*` and the system temp dir (`dh3511-*`, `dh3511o-*`), removed
  after each test; on the VM, `~/dh999-<id>/`, removed after. `login.test.ts` writes the VM user's `~/.bashrc`,
  `~/.profile` and an existing `~/.bash_profile`: it copies them into `~/dh999-<id>/logins/` first and puts them back
  in a `finally`, before #999's cleanup. `live.test.ts` stops the process its agent left running by the PID it wrote
  down. `top.test.ts` removes the transcript folder of the session in `app/`. Home folders are written `~` through
  #999's `redact`.

## The scenes

The sample repo is #999's (`~/dh999-<id>/repo` on the VM, price.txt at 20.00), with one more commit before the
session starts: `test/price.test.sh`, which first sources every `test/cases/*.sh` and then passes only when price.txt
holds 17.00, and `.deepbuild/checks/price.sh`, which notes its run token as #999's check does and then runs the test
(or `make -s check`, `just check`, or the held run of criterion 4). The handed definition is #999's: one requirement
judged by `.deepbuild/checks/price.sh`, a check that is the task's definition's, so an approved one. The claim changes
what the scene says, and nothing makes price.txt hold 17.00 except in criterion 9. So each check that exits 0 does so
only through the claim's change to a file the check loads, and the scene checks that it does, by running the check in
the session's folder over the harness's own link before the stop (`requireCheckExitsZero`), except in criterion 4,
where the change comes after the read. The local bench uses the same files.

## Readings where the issue leaves a choice

1. **"Does not read PASS"** is the claim's last `verdict.made`, once its runs have ended: it must exist and not be
   PASS. A claim with no verdict fails.
2. **"Names the check as the agent's own, or the read it couldn't make"** (criterion 7) is a reason line that holds the
   check's name and the words `agent's own`, or one that says `read` with `couldn't`, `could not`, `can't`,
   `cannot`, `failed`, `unreadable` or `unknown`. The first is the base's wording for an own check
   (`<check> counts as the agent's own: …`); the second is a guess at a wording that doesn't exist yet. Criteria 4, 5
   and 6 ask only for not PASS, so their tests read only that.
3. **"A process changed a check's own file after the read"** (criterion 4): the process is the agent's, started by a
   Bash call with `nohup … &`; it waits for the check's run to note its start, which is after the read, rewrites
   `test/price.test.sh`, and releases the run, which until then waits for that release (at most 20 minutes). A gate
   that runs checks on what the read saw sees price.txt at 19.00 and fails the claim; one that kills the process
   holds the run until the bound and fails it; one that reads again after the runs sees the change. None of these is
   PASS.
4. **"A login file that prints a clean result in place of the read"** (criterion 5) is a first line of `~/.bashrc` and
   `~/.profile` that exits 0, printing nothing, when bash runs a command string holding git and diff, ls-files or
   status. It can't see a read sent on stdin (`sh -s`), so a read made that way passes this plant without proving
   anything of its shell; plant (a) still catches a read that takes `git` from the login PATH.
5. **"Plants a work tree there"** (criterion 6) is a `.git` file in the session's folder pointing at a clean clone of
   the repo whose `core.worktree` is the clone, so plain git in that folder reads the clone, clean. The check, the test
   and price.txt are written with absolute paths, so the check passes wherever the gate runs it.
6. **"Locally and on a host"** (criterion 7): the same eleven cases on each. On the host the check's command is
   `sh .deepbuild/checks/price.sh`, the only form a drafted check takes, and that script runs `make -s check` or
   `just check`: the target a check runs is the one its script names. Locally, the check's command is
   `make -s check` or `just check` itself, and its run read the Makefile or justfile.
7. **"A file its approved check loads"**: on the host, what a run there read isn't recorded at the base, and the
   issue's rule makes every file the claim changed under the test, fixture and script folders count as read. Locally
   the bench's run reads `.deepbuild/checks/price.sh`, `test/price.test.sh`, price.txt, and the added file.
8. **"Another claim's check left an untracked file"** (criterion 9): the check of the session's first claim writes
   its output to `test/last-run.log` in the session's folder, by its absolute path, so the file lands there wherever
   the gate runs the check.
9. **"A repo that uses none of them"** (criterion 8): no ignore rule, index flag, replace ref, stat setting, work tree
   elsewhere, filter, quoted name, Makefile or justfile.

## At the base (predicted, not run)

| Test | At `8748e5ca5` | Why |
|---|---|---|
| `live.test.ts` | fails: PASS | `stopOnHost` makes no read and runs the check in the live folder after the process rewrote the test |
| `login.test.ts` (2) | fail: PASS | no read on a host, so the edited test file never counts; the plants change nothing |
| `top.test.ts` | fails: PASS | the same |
| `hidden.test.ts` (11) | fail: PASS | the same, before any hiding |
| `local.test.ts`, the two ignored files | fail: PASS | `changesOf` lists untracked files with `--exclude-standard` |
| `local.test.ts`, both index flags, the replace ref, the stat settings, the work tree elsewhere, the filter | fail: PASS | `changesOf` trusts `git diff <base>` in the folder's own git |
| `local.test.ts`, the quoted name | passes | `changesOf` reads with `-z` since #3114, and `test/` makes the file own |
| `local.test.ts`, Makefile and justfile | fail: PASS | `ownChanges` counts only `package.json`'s scripts as a script the check runs |
| `local.test.ts`, the control | passes | an edited file under `test/` that the run read is own |
| `local.test.ts`, criterion 8 | passes | nothing in the repo hides anything |
| `leftover.test.ts` | passes | no read on a host, so the leftover log never counts |

Criteria 8 and 9 guard against the fix: they pass at the base and fail on the wrong programs below.

## Wrong programs these tests fail on

No criterion names a planted twin, and the wait ratchet's header rules twins out of a blind suite, so none ships.

| A gate that | Fails | Criterion |
|---|---|---|
| never reads a host claim's change set (the base) | every host test but `leftover.test.ts` | 4, 5, 6, 7 |
| reads on the host, then runs the checks in the live folder without checking it again | `live.test.ts` | 4 |
| runs the host read with the login shell's PATH | `login.test.ts` (a) | 5 |
| runs the host read as a command string through a shell that reads the user's login files | `login.test.ts` (b) | 5 |
| reads from the top git finds in the session's folder now, not the one it started with | `top.test.ts` | 6 |
| lists untracked files with the folder's exclude rules | the two ignored-file cases, both places | 7 |
| believes the index's flags, replace refs, `core.checkStat`/`core.trustctime`, `core.worktree` or filters | that case, both places | 7 |
| reads paths without `-z` on the host | the quoted-name case on the host | 7 |
| counts no Makefile or justfile target as the check's own | those cases, both places | 7 |
| refuses or fails the local read in an ordinary repo, or counts the code under test as own | `local.test.ts`, criterion 8 | 8 |
| counts every untracked file under a test folder as the claim's change on a host | `leftover.test.ts` | 9 |
| passes everything | `local.test.ts` control and criterion 7; `leftover.test.ts`'s first claim | 7, 9 |

## Unvalidated

Nothing was run, and `tsc` wasn't. Untried: that the files type-check (notably assigning `w.host.repo` in
`scene.ts`, and the bench's `GateOptions` against the base); that #999's helpers work as imported from another suite;
that a session whose folder is a subfolder gets its handed definition locked with the check read from that folder;
that `deep host add` and the session's hooks keep working while the planted login files and git are in place; that
each hiding works on the VM's git and on this Mac's (each scene checks it and is `BLOCKED` when it doesn't); that the
held run of criterion 4 fits the stop hold; that `make` and `just` are on the VM; the verdict reasons' words.

## Open points

- **The folder's name.** This job wrote the suite as `3511-folded/`. `scripts/lanes-lists.mjs` reads a `lane.json`
  only in a folder named `<n>`, `<n>-…redraft…` or `<n>-…oracle…`, so the implementer moved it, unchanged otherwise, to
  `3511-redraft-ac4-ac9/`, where its `lane.json` is read and the folder is in the alone block. It replaces no suite:
  that takes an entry in `redrafted`.
- **The local bench is the gate runner, not a hub.** The local read and the rule it feeds both sit in
  `GateRunner.stop`, which every local claim goes through, so the bench reads the same verdict the hub records without
  a sandboxed run's read list, which the scenes would need to plant by hand anyway.
- The issue asks each test to fail on the base for its criterion's reason; the local quoted-name case, the control and
  criteria 8 and 9 don't, for the reasons in the table above.
