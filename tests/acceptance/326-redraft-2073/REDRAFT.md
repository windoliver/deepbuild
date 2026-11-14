# #326 criterion `#326.523de34e` blind redraft, after #2073: the drafted check fails in a repo you trust, and its stop still isn't held

#326's first criterion says "After the one Set up click, the hooks are in place in watch-only mode, and no stop is held
and no verdict blocks until a repo's checks are approved; the fast safety rules apply from the start". Two files of its
suite, `tests/acceptance/326/setup/click.test.ts` and `first-command.test.ts`, end in `watchOnlyFromTheStart` of
`scenario.ts`. Its session calls `deep_claim` and then `deep_run` of the repo's drafted, unapproved check `unit`
(`exit 1`), in a repo no trust record covers, and is BLOCKED unless that run comes back failed. #2073's Scope says
"deep_run in a project the core's trust decision doesn't mark trusted is refused before anything starts", and "In a
trusted project, deep_run runs the check on the claim's commit in a temporary checkout, as a claim's checks run". A
correct hub then never starts that run, and every test that reaches the scenario's claim ends BLOCKED. The criterion
still holds. The redraft keeps the scenario and every assertion, and changes only the fixture, in two places: the repo
is one you trust, and its drafted check is a command a claim's checks count. It is the same change as
`tests/acceptance/19-redraft-2073/` makes to #19's AC6, whose scenario #326's was adapted from.

Written from issue #326 (closed; its first criterion and the Scope's Set up sentence), issue #2073 (open) and issue
#322 (closed; project trust), each as this job was handed it, and #19's AC6; the frozen `tests/acceptance/326/setup/`
(README.md, helpers.ts, scenario.ts, click.test.ts, first-command.test.ts, twins, fixtures, BASE-FAILURE.txt) and
`tests/acceptance/19/setup/`; #2073's own blind suite (`tests/acceptance/2073/`: README.md, helpers.ts, run.test.ts,
BASE-FAILURE.txt; tests, not an implementation) and #322's (`README.md`, `helpers.ts`, `trust.test.ts`), for how a
fixture repo is trusted and which checks run both ways; the design (`docs/technical-design.md`: Threats, Untrusted repos
and Agents gaming checks; How runs become one of five verdicts, the run outcomes, Check health, Traced programs and
Pinned to a commit; First-party extensions, the done-gate, spec-draft and checks-command rows; How it installs, Setup;
Dogfooding; AGENTS.md, Proof); `tests/acceptance/306-redraft-1958/REDRAFT.md` and `724-redraft-1405/REDRAFT.md` for
form; `scripts/lanes.mjs` and `scripts/known-failures.json`, for where the originals are listed; and base `1c4d1f0e2`,
read only for how the surfaces are driven: `packages/hub/src/mcp-operations.ts` (`runCheck`, which is deep_run;
`checksOf`), `stop-judging.ts` (`projectTrusted`, `runClaim`, `stopRule`), `server.ts` (`holdFor`), `core.ts`
(`promptDraft`, `askingNow`), `packages/record/src/trust.ts`, `packages/checks-command/src/index.ts`,
`packages/gate/src/mask.ts`, and `packages/cli/src/main.ts` (when a first command sets up). I never read an
implementation of #2073, any diff, branch, pull request or other worktree.

## What #2073 changes, test by test

| Original (path › test) | Criterion | Why the old expectation no longer holds | Replaced by |
|---|---|---|---|
| `326/setup/click.test.ts` › #326.523de34e the Set up click says one line; then a session that claims done and fails the drafted check stops unheld and unblocked, its next calls go through, and its pkill -f vite is denied with the hub up and down | `#326.523de34e` | The scenario's `claimAndFail` needs a failed `deep_run` of `unit` in a repo no trust record covers. #2073: that `deep_run` "is refused before anything starts". A correct hub refuses, and the test ends BLOCKED ("the drafted check's run didn't come back failed") before the stop is probed. Trusting the repo alone doesn't mend it: `exit 1` run "as a claim's checks run" is uncounted, not failed (Readings, 3) | `326-redraft-2073/click.test.ts` › the same name, with "(redraft 2073)": the same click, steps and assertions, in the repo trusted and its check `node checks/unit.mjs` |
| `326/setup/click.test.ts` › #326 (control right-set-up) a right click built from merged code passes these checks | untagged control | The same: BLOCKED, so the control no longer shows the checks pass on a right program | `click.test.ts` › the same name, with "(redraft 2073)" |
| `326/setup/click.test.ts` › #326 (wrong program gating-set-up) a click whose hub gates unapproved checks fails, naming the stop | untagged wrong program | The same: `failureOn` rethrows the BLOCKED before the twin's stop is probed | `click.test.ts` › the same name, with "(redraft 2073)" |
| `326/setup/click.test.ts` › #326 (wrong program watch-rules-set-up) a click that leaves the fast safety rules in watch mode fails, naming pkill -f vite | untagged wrong program | The same: BLOCKED before `pkill -f vite` is tried | `click.test.ts` › the same name, with "(redraft 2073)" |
| `326/setup/first-command.test.ts` › #326.523de34e the first deep status in a fresh home sets DeepBuild up and says so in one line, the second says nothing and writes nothing, and then a failed claim stops unheld and unblocked while pkill -f vite is denied with the hub up and down | `#326.523de34e` | The same: its first and second commands pass their checks, then the scenario ends BLOCKED | `326-redraft-2073/first-command.test.ts` › the same name, with "(redraft 2073)" |
| `326/setup/first-command.test.ts` › #326 (control deep-sets-up-once) a right first command built from merged code passes these checks | untagged control | The same | `first-command.test.ts` › the same name, with "(redraft 2073)" |

No expectation of either file is dropped. What #2073 reverses is the fixture's premise, a failed run of a check in a
repo no trust record covers. It has no form that still holds, since nothing runs there, and no test is written for it:
that `deep_run` is refused there is #2073's own first criterion and its own test.

| Part of the scenario | In #326's files | In the redraft |
|---|---|---|
| The repo | `draftedRepo`: `<tmp>/shop`, one commit: `.deepbuild/done.yaml` ("Drafted for you; not approved yet", one check `unit`) and `app.js`; no trust record covers it | Changed: `trustedDraftedRepo` of this folder's `scenario.ts`: the same repo, plus `checks/unit.mjs` in its one commit. `<home>/.claude.json` marks it trusted in Claude Code's workspace trust (`projects[<repo>].hasTrustDialogAccepted: true`), written before the click or the first command; a way in that drops that record is BLOCKED |
| The drafted check | `unit`: `exit 1` | Changed: `unit`: `node checks/unit.mjs`, a script whose one statement is `process.exitCode = 1` |
| The way in | `deep-app --set-up` or a twin of it; the first `deep status`, then the second | Kept as it is: the click's exit and its one line, the hooks in place, the hub answering, the second command saying and writing nothing |
| The scenario | `watchOnlyFromTheStart`: the claim and the failed run, the stop not held (`hold_until_ms: null`), no `decision`, the next Edit and `ls`, `pkill -f vite` denied with the hub up and down | Kept as it is: #326's own function, imported unchanged and called once the trust record is seen to stand |
| The twins and controls | #326's `twins/` | Kept as they are, run from #326's folder |

## Kept as they are

Three tests of the two files end before any `deep_run`, so #2073 changes nothing they assert. They are carried into the
redraft files with their names and assertions unchanged, and run in the same fixture as the rest of their file, whose
trust record and check they never reach:

- `click.test.ts` › #326 (wrong program chatty-set-up) a click that shows all of deep setup's output fails, naming the
  line count: it fails at the click's one line.
- `click.test.ts` › #326 (wrong program no-hub-set-up) a click that adds the hooks but leaves no hub running fails,
  naming the hub: it fails where the hub must answer.
- `first-command.test.ts` › #326 (wrong program deep-sets-up-every-time) a deep that sets up again on every command
  fails, naming the second command: it fails at the second command.

Every other file of `tests/acceptance/326/`: `setup/same.test.ts` doesn't use the scenario, and by a search of the
suite nothing in `surfaces/` or `panels/` calls `deep_run`.

## Readings

1. **Trusting a project approves none of its checks.** The criterion says "until a repo's checks are approved". The
   design keeps the two apart. A repo's specs "run only after you trust the project" (Threats, Untrusted repos). "A
   drafted or proposed check decides nothing until you approve it" (Agents gaming checks). A draft reaches you "with
   its checks already run, and verdicts there are watch-only until approved" (spec-draft), and "the hooks start
   watch-only, so no verdict blocks and no stop is held until you approve something, such as a repo's drafted checks"
   (How it installs). So under #2073 the state the scenario needs, a drafted check with a failed run that nobody
   approved, is a trusted project's, and the criterion's words still decide it. "Nobody approved" stays #326's reading:
   the repo's `.deepbuild/done.yaml` says it is a draft, and the home holds no approval of it.
2. **Trusted before the click, by Claude Code.** Trust "is reused from the agents: Claude Code's workspace trust and
   Codex's trusted projects already record which folders you trust, so a repo trusted in either needs no second answer"
   (spec-draft). It is also the only trust these tests can give the repo. Both files start from "a fresh home where
   nothing is set up", and on the base the first `deep` command sets up only in a home with no `~/.deepbuild`, where
   the core's own decision would be kept. `~/.claude.json` is Claude Code's file, not DeepBuild's, so the home is still
   a first launch's. The record is written as #322's suite writes it and as #322's AC1 test proves a claim's spec
   checks read it. #2073's Scope says the refusal "goes through the same trust read the claim's spec checks use".
   #2073's own suite trusts by the core's decision alone and leaves the agents' trust untested (its README, Not
   covered), so this is the one thing the redraft needs of an implementation that no criterion of #2073 states.
3. **Nothing stands in for the failed run: it is still a run, with another command.** In the trusted repo `deep_run`
   still runs `unit` for the claim. Its command can't stay `exit 1`. Run "as a claim's checks run", through the command
   check kind, `exit 1` is uncounted before any process starts: the core's masked-exit rule names an `exit N` (Check
   health), and its run's mask reads `exit 1`. An uncounted run "is never a pass and never a failure" (Traced
   programs), so the scenario would be BLOCKED on it. `node checks/unit.mjs` is one Node process and fails the same run
   either way: as the base's deep_run runs it (`/bin/sh -c` in the worktree), and through the command check kind
   (outcome failed, "the command exited 1"). Read once on the base with a scratch script, not kept
   (`tests/acceptance/19-redraft-2073/BASE-RESULTS.txt` has both scratch readings). The shape is #2073's own suite's.
4. **What a trusted repo's stop does on the base.** The base keeps no record of approving a repo's checks; trust is
   its one switch. Where a stop makes a claim of its own, `runClaim` runs a trusted repo's spec checks on it and a
   failed one sends the stop back, while an untrusted repo's never run (read from the code and #322's criteria, not
   run here). This scenario's stop makes no such claim: its turn's only calls are `deep_claim` and `deep_run`, whose
   `PostToolUse` the scenario never fires. Read once on the base with a scratch test, not kept: with the fixture
   trusted and untrusted alike, the hub acknowledged the Stop with a hold 60 s on, and DeepBuild's Stop entry answered
   0.2 s later, exit 0, with no `decision`. So trusting the fixture changes nothing the base does here. That the base
   gates a stop's own claim on trust alone, with nothing approved, is older than #2073 and not this redraft's to
   settle.
5. **The scenario file.** `tests/acceptance/326/setup/scenario.ts` is frozen and still serves: its
   `watchOnlyFromTheStart` and `hooksInPlace` are imported unchanged. This folder's `scenario.ts` holds only what must
   differ: the fixture (`trustedDraftedRepo`, in place of #326's `draftedRepo`, whose check line is the part that
   can't stay) and `watchOnlyInATrustedRepo`, which checks that the trust record outlived the way in and then calls
   #326's scenario.
6. **The claim's commit.** The claim names the repo's one commit, which holds `done.yaml`, the script and `app.js`,
   and the worktree is clean from the commit to the run, so the run reads the same files in the live worktree and in a
   checkout of the claim's commit. The Edit of `app.js` in the next turn is a `PreToolUse` only; no file is written.

## Wrong programs they still fail

- `chatty-set-up`, `no-hub-set-up` and `deep-sets-up-every-time`: as before, each with its own message.
- `gating-set-up`, which installs with #19's plant `gates-before-approval`: the stop check fails with "the hub held"
  or "a verdict blocked", naming the session. The plant as #19's README states it acts "when the session's latest
  claim has a failed run"; the trusted fixture has that run, where the original's under #2073 has none.
- `watch-rules-set-up`: `pkill -f vite` goes through with the hub up, once the scenario gets that far.
- A click or a first command whose hub takes trust for approval and holds or blocks this stop because the trusted
  repo's `unit` failed: the tagged tests, at "the hub held" or "a verdict blocked".
- Never a pass: a hub that refuses `deep_run` in the trusted repo, one whose trust read leaves out Claude Code's
  workspace trust, and one that returns the run uncounted or still running, each end BLOCKED, naming the reply.

## On the base

`BASE-RESULTS.txt` holds the runs at `1c4d1f0e2` on November 13, 2026. Eight of the nine tests ran.

| Test | On the base | Why |
|---|---|---|
| click › #326.523de34e (redraft 2073) | not run | It needs `target/debug/deep-app`, which this checkout doesn't have. #326's helper would build it inside the test's 600 s, a cold build of some 680 crates on a machine at load 100 to 170; this job didn't start it |
| click › control right-set-up (redraft 2073) | FAIL | "the hub held the Stop of session <id>": the base holds this stop (below) |
| click › chatty-set-up | PASS | fails at the one line, as it must |
| click › no-hub-set-up | PASS | fails at the hub, as it must |
| click › gating-set-up (redraft 2073) | PASS | the plant's hub holds the stop, and the check names it |
| click › watch-rules-set-up (redraft 2073) | FAIL | the scenario stops at the held stop, before `pkill -f vite`, so the failure isn't the twin's own |
| first-command › #326.523de34e (redraft 2073) | FAIL | "the hub held the Stop of session <id>", after the first command set up and said one line and the second said and wrote nothing |
| first-command › control deep-sets-up-once (redraft 2073) | FAIL | the same |
| first-command › deep-sets-up-every-time | PASS | fails at the second command, as it must |

Every failure is the same one, and it has nothing to do with trust or with #2073. The scenario's prompt, "Make the
header green, then claim it done.", opens a task, and the base holds the stops of a session whose prompt opened one, for
the core's reply (`promptDraft` and `holdFor`; #82 by the code's own note). The scratch reading under Readings 4 shows
it holds with the fixture trusted and untrusted alike, and not with a prompt that opens no task. In each of the four
the claim was recorded and `deep_run` of `node checks/unit.mjs` came back failed before the stop. This job did not run
the originals. `scripts/known-failures.json` lists the original first-command `#326.523de34e` test under `timing`; the
redraft's name ends "(redraft 2073)", so that entry doesn't name it. The assertions are #326's and are not bent to the
base.

Not run: the real click (above), and any implementation of #2073 (none exists here), so the redraft's passing side, a
trusted repo's `deep_run` run on the claim's commit and coming back failed, is unverified beyond the scratch run of
the command check kind.

## Run it

On macOS, with Node 24.22 first on `PATH`, the workspaces built and cargo on `PATH` (#326's helpers run `cargo build
--locked -q -p deep-hook`, and for the real click `-p deep-app --bin deep-app`, themselves):

```sh
node scripts/throttle.mjs test --wait 120 -- node node_modules/vitest/vitest.mjs run --root tests/acceptance/326-redraft-2073 first-command.test.ts --no-file-parallelism --testTimeout=600000 --reporter=verbose
node scripts/throttle.mjs test --wait 120 -- node node_modules/vitest/vitest.mjs run --root tests/acceptance/326-redraft-2073 click.test.ts --no-file-parallelism --testTimeout=600000 --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/326-redraft-2073/tsconfig.json
```

The files import `tests/acceptance/326/setup/helpers.ts`, `scenario.ts`, `twins/` and `fixtures/` unchanged. Every
folder is under `/tmp/da326s-*`, HOME is the test's own for every process, and only processes the test started are
stopped, by PID. A run with `--root` leaves Vitest's cache in this folder's `node_modules/.vite`; delete it.

## At merge

The frozen `tests/acceptance/326/setup/click.test.ts`, `first-command.test.ts` and `scenario.ts` stay as written; the
two test files are then run by hand only. The owner's call is to swap them for the two here, with this folder's
`scenario.ts` beside #326's. `scripts/lanes.mjs` has `'tests/acceptance/326/setup/click.test.ts'` on its slow list, and
`'tests/acceptance/326-redraft-2073/click.test.ts'` belongs there too; neither original is on the one-at-a-time or the
timed list. Whether the redrafted first-command test takes the original's place in `scripts/known-failures.json` is
the owner's call. Those edits are the implementer's, at the swap.
