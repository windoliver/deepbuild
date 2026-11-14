# #19 criterion AC6 blind redraft, after #2073: the drafted check fails in a repo you trust, and its stop still isn't held

#19's AC6 (`#19.3cfcabc5`) says "Right after install, no stop is held and no verdict blocks until the user approves a
repo's checks, while the fast safety rules apply from the start". Its file, `tests/acceptance/19/setup/watchonly.test.ts`,
makes "a verdict an enforcing gate would act on" with `deep_claim` and then `deep_run` of the repo's drafted, unapproved
check `unit` (`exit 1`), in a repo no trust record covers, and is BLOCKED unless that run comes back failed. #2073's
Scope says "deep_run in a project the core's trust decision doesn't mark trusted is refused before anything starts", and
"In a trusted project, deep_run runs the check on the claim's commit in a temporary checkout, as a claim's checks run".
A correct hub then never starts that run, so both tests of the file end BLOCKED before their first assertion. The
criterion still holds. The redraft keeps the scenario and every assertion, and changes only the fixture, in two places:
the repo is one you trust, and its drafted check is a command a claim's checks count.

Written from issue #19 (closed; AC6), issue #2073 (open) and issue #322 (closed; project trust), each as this job was
handed it; the frozen `tests/acceptance/19/setup/` (README.md, helpers.ts, fixtures, watchonly.test.ts,
BASE-FAILURE.txt); #2073's own blind suite (`tests/acceptance/2073/`: README.md, helpers.ts, run.test.ts,
BASE-FAILURE.txt; tests, not an implementation) and #322's (`README.md`, `helpers.ts`, `trust.test.ts`), for how a
fixture repo is trusted and which checks run both ways; the design (`docs/technical-design.md`: Threats, Untrusted repos
and Agents gaming checks; How runs become one of five verdicts, the run outcomes, Check health, Traced programs and
Pinned to a commit; First-party extensions, the done-gate, spec-draft and checks-command rows; How it installs, Setup;
Dogfooding; AGENTS.md, Proof); `tests/acceptance/306-redraft-1958/REDRAFT.md` and `724-redraft-1405/REDRAFT.md` for
form; and base `1c4d1f0e2`, read only for how the surfaces are driven: `packages/hub/src/mcp-operations.ts` (`runCheck`,
which is deep_run; `checksOf`; `claim`), `stop-judging.ts` (`projectTrusted`, `specChecks`, `runClaim`, `stopRule`,
`judging`), `server.ts` (`holdFor`), `core.ts` (`promptDraft`, `askingNow`), `ask-tasks.ts` (`tasksOf`),
`packages/record/src/trust.ts`, `packages/checks-command/src/index.ts` and `shell.ts`, `packages/gate/src/mask.ts`,
and `packages/cli/src/main.ts` (when a first command sets up). I never read an implementation of #2073, any diff,
branch, pull request or other worktree.

## What #2073 changes, test by test

| Original (path › test) | Criterion | Why the old expectation no longer holds | Replaced by |
|---|---|---|---|
| `19/setup/watchonly.test.ts` › AC6 #19.3cfcabc5 straight after deep setup, a session that claims done and fails the drafted check stops unheld and unblocked, its next calls go through, and its pkill -f vite is denied with the hub up and down | #19 AC6 `#19.3cfcabc5` | Its `claimAndFail` needs a failed `deep_run` of `unit` in a repo no trust record covers. #2073: that `deep_run` "is refused before anything starts". A correct hub refuses, and the test ends BLOCKED ("the drafted check's run didn't come back failed") with nothing asserted. Trusting the repo alone doesn't mend it: `exit 1` run "as a claim's checks run" is uncounted, not failed (Readings, 3) | `19-redraft-2073/watchonly.test.ts` › the same name, with "(redraft 2073)": the same steps and assertions, in the repo trusted and its check `node checks/unit.mjs` |
| `19/setup/watchonly.test.ts` › AC6 #19.3cfcabc5 (wrong program) a hub that gates a repo's drafted checks before you approve them (gates-before-approval) fails this test, naming the stop | #19 AC6 `#19.3cfcabc5` | The same `claimAndFail`: BLOCKED before the plant's stop is probed | `19-redraft-2073/watchonly.test.ts` › the same name, with "(redraft 2073)": the same fixture and the same check on the plant |

No expectation of the file is dropped. What #2073 reverses is the fixture's premise, a failed run of a check in a repo
no trust record covers. It has no form that still holds, since nothing runs there, and no test is written for it: that
`deep_run` is refused there is #2073's own first criterion and its own test.

| Part of the scenario | In #19's test | In the redraft |
|---|---|---|
| The repo | `<tmp>/shop`, one commit: `.deepbuild/done.yaml` ("Drafted for you; not approved yet", one check `unit`) and `app.js`; no trust record covers it | Changed: the same repo, plus `checks/unit.mjs` in its one commit. `<home>/.claude.json` marks it trusted in Claude Code's workspace trust (`projects[<repo>].hasTrustDialogAccepted: true`), written before `deep setup`; a setup that drops that record is BLOCKED |
| The drafted check | `unit`: `exit 1` | Changed: `unit`: `node checks/unit.mjs`, a script whose one statement is `process.exitCode = 1` |
| The failed run | `deep_claim` at the repo's commit predicting `unit` passes, then `deep_run {check: "unit", claim: null}`; BLOCKED unless the reply says failed | Kept as it is. Nothing in the worktree changes between the commit, the claim and the run |
| The stop isn't held | the hub's acknowledgement of the session's Stop has `hold_until_ms: null`, read off the forwarded socket | Kept as it is |
| No verdict blocks | DeepBuild's foreground Stop entry exits 0 with no `decision`; the next turn's Edit and `ls` aren't denied | Kept as it is |
| The fast safety rules | `pkill -f vite` denied saying "name or port", with the hub up and with it stopped by PID | Kept as it is |
| The wrong program | on `gates-before-approval` the stop check fails with "the hub held" or "a verdict blocked", naming the session | Kept as it is |

## Kept as they are

Every other file of `tests/acceptance/19/` (in `setup/`: undo, userlevel, strict, symlink and uninstall; and the
`authority`, `doctor` and `status` folders): by a search of the suite, only `setup/watchonly.test.ts` calls `deep_run`.

## Readings

1. **Trusting a project approves none of its checks.** AC6 says "until the user approves a repo's checks". The design
   keeps the two apart. A repo's specs "run only after you trust the project" (Threats, Untrusted repos). "A drafted or
   proposed check decides nothing until you approve it" (Agents gaming checks). A draft reaches you "with its checks
   already run, and verdicts there are watch-only until approved" (spec-draft), and "the hooks start watch-only, so no
   verdict blocks and no stop is held until you approve something, such as a repo's drafted checks" (How it installs).
   So under #2073 the state AC6's scenario needs, a drafted check with a failed run that nothing approved, is a trusted
   project's, and the criterion's words still decide it: the stop isn't held and no verdict blocks. "A repo whose
   checks you haven't approved" stays #19's reading, "a repo with a `.deepbuild/done.yaml` that nothing approved": the
   file says it is a draft, and the home holds no approval of it.
2. **Trusted before install, by Claude Code.** Trust "is reused from the agents: Claude Code's workspace trust and
   Codex's trusted projects already record which folders you trust, so a repo trusted in either needs no second answer"
   (spec-draft). Right after install that is the trust a project has. The core's own decision is your answer on the
   trusted path, which is DeepBuild's, and a home that held one before `deep setup` ran would not be a first install.
   The record is `<home>/.claude.json`, as #322's suite writes it and as #322's AC1 test proves a claim's spec checks
   read it. #2073's Scope says the refusal "goes through the same trust read the claim's spec checks use". #2073's own
   suite trusts by the core's decision alone and leaves the agents' trust untested (its README, Not covered), so this
   is the one thing the redraft needs of an implementation that no criterion of #2073 states.
3. **Nothing stands in for the failed run: it is still a run, with another command.** In the trusted repo `deep_run`
   still runs `unit` for the claim. Its command can't stay `exit 1`. Run "as a claim's checks run", through the command
   check kind, `exit 1` is uncounted before any process starts: the core's masked-exit rule names an `exit N` (Check
   health), and its run's mask reads `exit 1`. `exit 0` goes the same way, and `false` is uncounted because no process
   the tracers see wrote the run's read record. An uncounted run "is never a pass and never a failure" (Traced
   programs), so #19's `claimAndFail` would be BLOCKED on it. `node checks/unit.mjs` is one Node process and fails the
   same run either way: as the base's deep_run runs it (`/bin/sh -c` in the worktree), and through the command check
   kind (outcome failed, "the command exited 1", read set `checks/unit.mjs`). Read once on the base with a scratch
   script on a supervisor of its own, not kept. The shape is #2073's own suite's (`node checks/holds.mjs <word>`).
4. **What a trusted repo's stop does on the base.** The base keeps no record of approving a repo's checks; trust is
   its one switch. Where a stop makes a claim of its own, `runClaim` runs a trusted repo's spec checks on it and a
   failed one sends the stop back, while an untrusted repo's never run (read from the code and #322's criteria, not
   run here). This scenario's stop makes no such claim. Its turn's only calls are `deep_claim` and `deep_run`, whose `PostToolUse` the scenario never
   fires, as #19 plays it, so the stop is recorded `did_work: false, claim: false` and nothing at it reads the
   project's trust or the failed run. Read once on the base with a scratch test, not kept: with the fixture trusted and
   untrusted alike, the hub acknowledged the Stop with a hold 60 s on, and DeepBuild's Stop entry answered 0.2 s later,
   exit 0, with no `decision`. So trusting the fixture changes nothing the base does here. The redraft adds no tool
   call to the turn: a stop that claims for itself in a trusted repo is #322's send-back, and that the base gates such
   a claim on trust alone, with nothing approved, is older than #2073 and not this redraft's to settle.
5. **The claim's commit.** The claim names the repo's one commit, which holds `done.yaml`, the script and `app.js`,
   and the worktree is clean from the commit to the run. So the run reads the same files in the live worktree, as the
   base runs it, and in a checkout of the claim's commit, and which revision of `done.yaml` is read (#1864's) doesn't
   matter here. The Edit of `app.js` in the next turn is a `PreToolUse` only; no file is written.

## Wrong programs they still fail

- `gates-before-approval`, #19's plant, whose hub holds every Claude Code stop on the base: the second test, with "the
  hub held the Stop of session <id>".
- The plant as #19's README states it, a hub that holds or blocks a stop "when the session's latest claim has a failed
  run": the trusted fixture has that run, so the same test fails it. In the original's fixture under #2073 no run
  exists, and that plant would never act.
- A hub that takes trust for approval and holds or blocks this stop because the trusted repo's `unit` failed: the
  first test, at "the hub held" or "a verdict blocked".
- A setup with no `rules.json`, or with the fast rules in watch mode: the first test, at `pkill -f vite`.
- Never a pass: a hub that refuses `deep_run` in the trusted repo, one whose trust read leaves out Claude Code's
  workspace trust, and one that returns the run uncounted or still running, each end BLOCKED, naming the reply.

## On the base

`BASE-RESULTS.txt` holds the runs at `1c4d1f0e2` on November 13, 2026: 2 tests, 1 failed, 1 passed, in 27 s.

- First test: FAIL, at "AC6 right after install the hub held the Stop of session <id> (hold_until_ms …)". The claim was
  recorded and the run of `node checks/unit.mjs` came back failed; the failure is the stop's acknowledgement. The base
  holds this stop for a reason that has nothing to do with trust or with #2073: the scenario's prompt, "Make the
  header green, then claim it done.", opens a task, and the base holds the stops of a session whose prompt opened one,
  for the core's reply (`promptDraft` and `holdFor`; #82 by the code's own note). The scratch reading under Readings 4
  shows it: held with the fixture trusted and untrusted alike, and `hold_until_ms: null` with a prompt that opens no
  task. This job was told the original's first test failed on this base and machine at the same assertion; it did not
  run the original. The assertion is #19's and is not bent to the base.
- Second test (wrong program): PASS. The plant's hub holds the stop, and the check fails naming it. On this base the
  hub without the plant fails the same check, so this pass doesn't tell the two apart here.

Not run: any implementation of #2073 (none exists here), so the redraft's passing side, a trusted repo's `deep_run`
run on the claim's commit and coming back failed, is unverified beyond the scratch run of the command check kind.

## Run it

On macOS, with Node 24.22 first on `PATH`, the workspaces built and cargo on `PATH` (the helpers run `cargo build
--locked -q -p deep-hook` themselves, as #19's do):

```sh
node scripts/throttle.mjs test --wait 120 -- node node_modules/vitest/vitest.mjs run --root tests/acceptance/19-redraft-2073 --no-file-parallelism --testTimeout=600000 --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/19-redraft-2073/tsconfig.json
```

The file imports `tests/acceptance/19/setup/helpers.ts` and its fixtures unchanged; it adds only the trust record, the
check's script and a BLOCKED check that the record outlived setup. Every folder is under `/tmp/dh19s-*`, HOME is the
test's own for every process, and only processes the test started are stopped, by PID. A run with `--root` leaves
Vitest's cache in this folder's `node_modules/.vite`; delete it.

## At merge

The frozen `tests/acceptance/19/setup/watchonly.test.ts` stays as written and is then run by hand only. The owner's
call is to swap it for this file. The redraft's tests carry the same tag, `#19.3cfcabc5`. The proof lanes read a
test's twins from its own acceptance folder, so `tests/acceptance/19/twins.json` covers the tag only once the file
sits under `19/`; this folder has no `twins.json`. `scripts/lanes.mjs` has `'tests/acceptance/19/'` on its
one-at-a-time list, and `'tests/acceptance/19-redraft-2073/'` belongs there too, since each test runs setup, which
starts a hub. Those edits are the implementer's, at the swap.
