# Acceptance tests for #2118: claims and checks in the hub

A check that never started, a carried failure and a Closes check each end in the right verdict; an approved check is
never written outside its checkout; a person's hub.health, a standing rule's yes and a looping Codex session's slow
checks each read as the design says.

Written first and blind, at base commit `0e55727311da14cb0c4644f9afd5e33c9505fefa` (origin/main, 2026-11-15), by a job
that saw no implementation of #2118, no other checkout, branch, pull request or session. The implementing agent does
not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## Result on the base

Seven of the eight tests fail on the base, each at an assertion in its own file, for the reason its criterion gives
after "Today". **AC4 already holds on the base: its test passes.** `BASE-FAILURE.txt` holds the run.

| AC | ID | Criterion (short) | File | Kind | On the base |
|---|---|---|---|---|---|
| AC1 | `#2118.b16df21c` | a spec check's failure carried from another session reads as inherited | `carried-inherited.test.ts` | gate runner on the bench | fails: `expected 'FAIL' to be 'BLOCKED'` |
| AC2 | `#2118.bfff8439` | a check whose run never started runs again at the next claim on the same tree | `never-started.test.ts` | gate runner on the bench | fails: `expected [] to deeply equal [ 'sum passed' ]` (no run starts; BLOCKED again) |
| AC3 | `#2118.a5258d6e` | a drift rerun whose run can't start leaves its check BLOCKED, never pending | `rerun-refused.test.ts` | gate runner on the bench | fails: `expected 'pending' to be 'BLOCKED'` |
| AC4 | `#2118.53305b98` | a Closes check that fails to run denies the pull request, naming the cause | `closes-read.test.ts` | hub, end to end | **passes on the base** |
| AC5 | `#2118.fee60420` | an approved check's bytes are never written through a link out of the checkout | `check-link.test.ts` | hub, end to end | fails: the outside folder's file holds the approved bytes |
| AC6 | `#2118.6cbb26ce` | a person's hub.health names only the sessions that person may see | `health-person.test.ts` | hub, end to end | fails: bob's list includes the owner's session in maya/notes |
| AC7 | `#2118.8efe3220` | a standing rule's yes is an allow whether or not an extension handles tool.before | `rule-allow.test.ts` | hub, end to end | fails: `expected undefined to be 'allow'` |
| AC8 | `#2118.60587a8a` | a looping Codex session's slow checks wait for its loop | `codex-loop.test.ts` | hub, end to end | fails: a run of the check starts at that stop |

Each ID is `#2118.` and the first 8 hex digits of the SHA-256 of the criterion's checkbox text, trimmed, white space
collapsed, as `scripts/proof-change.mjs` reads it. Each test file binds its own ID in a string constant; no helper
holds one.

### AC4 on this base

The issue was read from the code at `20f19f16`, where the core swallowed a Closes rule that threw. Commit `49d0d25a5`
(#2064), in this base's own history, changed that catch: a Closes rule that throws now denies the call with the
error's words. So the criterion's "Today it is allowed" is no longer true here. The test is kept as written. It still
fails on a program that allows the call, and on one that denies it without the cause. The Scope line for this
criterion (drop the catch, let the server's failed path deny) is one way to keep it true, not the only one.

## Run them

Node 24.22.0 and the pinned Rust toolchain first on PATH, on macOS, from the checkout's root:

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:/opt/homebrew/opt/rustup/bin:$PATH"
npm ci                                                    # once
npm run build --workspaces                                # the hub tests run packages/cli/dist/main.js
cargo build --locked -p deep-hook                         # every hook runs target/debug/deep-hook; the hub won't start without it
node scripts/throttle.mjs test --wait 120 -- npx vitest run tests/acceptance/2118/<file> --testTimeout=1800000 --hookTimeout=600000
node scripts/affected.mjs tests/acceptance/2118/carried-inherited.test.ts tests/acceptance/2118/never-started.test.ts \
  tests/acceptance/2118/rerun-refused.test.ts tests/acceptance/2118/closes-read.test.ts tests/acceptance/2118/check-link.test.ts \
  tests/acceptance/2118/health-person.test.ts tests/acceptance/2118/rule-allow.test.ts tests/acceptance/2118/codex-loop.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/2118/tsconfig.json
```

- On the base each file took 2 to 37 s at a 1-minute load of 165 to 310 on 18 cores. `tsc` on the folder exits 0.
- Five files start hubs of their own. `scripts/affected.mjs` ran all eight side by side without trouble; whether the
  folder belongs on `scripts/lanes.mjs`'s one-at-a-time list is the implementer's call. This job changed no lane list.
- No model is called and nothing leaves 127.0.0.1. HOME is a temp folder for every child. Temp folders are the
  imported suites' own (`/tmp/dh31-*`, `/tmp/dh322-*`, `/tmp/dh16-*`, `/tmp/dh23p-*`, `/tmp/dh39-*`), removed at each
  file's end. Processes are stopped by PID or by their own handle, never by name or port.
- A missing build, a hub that won't start, or a step a reading stands on that didn't happen throws an Error whose
  message starts with `BLOCKED:`; it is never a pass.

## What was read

- Issue #2118 as of 2026-11-15T07:54:55Z: Scope, the eight criteria, What goes wrong today, Proof, Depends on. Its
  epic, #3, through `gh issue view 3`.
- `AGENTS.md`. `docs/technical-design.md`: How runs become one of five verdicts (the table, Fail before, pass after,
  Failing on an assertion); An agent says it's done (Fast and slow lanes, Slow runs start when the turn ends, A loop's
  turn end isn't a hand-back, Latest snapshot wins); Before each command; One hub for a project shared by several
  people; and, under How we know version 0 works, Dogfooding, Criteria to tests, Criteria in a checked shape, Wrong
  programs, The edit guard, Loops and Clean test processes.
- The base, for surfaces and conventions: `packages/hub/src` (`gate-runner.ts`, `shared-runs.ts`, `stop-judging.ts`,
  `stop-reply.ts`, `core.ts`, `server.ts`, `hub-readings.ts`, `hub-control.ts`, `session-state.ts`, `ask-tasks.ts`,
  `holds.ts`, `pr-commands.ts`, `codex-loops.ts`, `verdict-chat.ts`, `claim-refusal.ts`, `mods.ts`, `runs.ts`,
  `workspaces.ts`), `packages/verdicts/src` (`engine.ts`, `types.ts`, `record.ts`), `packages/gate/src` (`claim.ts`,
  `own.ts`, `checkouts.ts`), `packages/record/src` (`projections.ts`, the store's interface),
  `adapters/codex.facts.json`, `adapters/loops.facts.json` and the corpus's goal session, `scripts/proof-change.mjs`,
  `scripts/affected.mjs`, `scripts/throttle.mjs`, `tests/vitest-setup.ts`, and the hub's own tests
  `packages/hub/test/{shared-runs,gate-runner,extensions,pr-after-lookup-error}.test.ts`.
- `git log` and `git show` of `49d0d25a5` in the base's history, once AC4's test passed.
- Suites, for their form: #2120 and #2123. For their worlds, imported by relative path and never copied or edited:
  #31 (the base-commit service's world), #322 (hub, sessions through deep-hook, handed definitions), #1337 with #16
  (two people on one hub), #23 `permissions/` (standing rules), #39 (Codex hooks). Read only: #965 (`check.held`),
  #1018, #350, #1156, #1731, #1523, #2067-scope.

## How each criterion is read

- **AC1, AC2, AC3: the gate runner on a bench** (`gate.ts`). These three are about the gate's own logic, and AC2 and
  AC3 name its seams (`start`, `rerun()`, `verdictOf(claim)`). The bench gives the hub's `GateRunner` what
  `core.ts` gives it. Real: the gate runner; the base-commit service (`openCheckouts`, through #31's world), so each
  snapshot, claim checkout and merge-base checkout is git's, from a real repo and its linked worktrees; the record
  its queries and events go to; and each check's program, a node script run in the folder the gate names. What stands
  in is the hub's run service, at `start` and `ended`: a start the test refuses rejects; any other gets a handle, and
  at `ended` the script is run and the run is recorded and keyed as `runs.ts` does (`recorded`, then `keyed`).
  - **AC1**: one repo whose main is broken (`total` ignores the discount), two sessions in two linked worktrees, each
    with its own edit to `README.md`, which the spec check doesn't read, so the two keys are equal. Session A's claim
    must run the check on its snapshot and on the merge base, both failing, and be BLOCKED as inherited (else
    BLOCKED). Session B's claim must start no run on its own snapshot and count A's run (else BLOCKED: the keys
    weren't equal). Then B's verdict must be `BLOCKED`, its check's `inherited` true, and its reasons must name the
    failing test.
  - **AC2**: the first claim's one check is refused at `start`; the claim must be BLOCKED naming the cause (else
    BLOCKED). The session stops again with no file changed, as the hub hands such a stop to the gate (`same`: no work
    since the last claim), and `start` works. Then: one start for the new claim that got a run, which passed; the
    check's `counted` is that run alone; the verdict is `PASS`.
  - **AC3**: a workspace claim (a state pin, #67) whose check passed. `rerun()` with a new reading, `start` refused.
    Once the refused start is seen and the gate has read the claim again (`judged`) or its verdict is made, the
    verdict must be `BLOCKED`, the check `BLOCKED`, and the check's reasons must carry the cause `start` rejected with.
- **AC4** (`closes-read.test.ts`): #322's world. "Fix <link>, then create PR." opens the task for issue 7 and its
  handed definition locks. The prompt asks for the pull request so that only the Closes rule stands between the call
  and its run. With the hub running, the `requirements` column of the record's `definitions` table is renamed in the
  hub's `ledger.db` (as `pr-after-lookup-error.test.ts` breaks one read of the record), so the Closes rule's read of
  the task's definition rejects. The test makes the same read itself; SQLite's error is the cause. Then
  `gh pr create --body "Closes #7"` must be denied, and the denial must contain that cause. The column is put back.
- **AC5** (`check-link.test.ts`): #322's world, one requirement, a guard (`on_base: passes`) judged by the drafted
  check `.deepbuild/checks/expired-token.sh`. After the lock the session's folder holds `.deepbuild/checks` as a
  symlink to a folder outside the repo that holds two files of yours, one of the check's own name. The agent edits
  `src/auth.js` and stops. The outside folder must hold exactly what it held, byte for byte; and the newest
  `verdict.made` that judges the check's requirement must read it `BLOCKED`, its reasons naming the check's path.
- **AC6** (`health-person.test.ts`): #1337's world. maya owns the hub and works in maya/notes (repo A) and acme/shop
  (repo B); bob is on acme/shop only. The owner's `hub.health` must name both sessions, and bob's `sessions.read`
  must show the shop session and hide the notes one (else BLOCKED). bob's `hub.health` `sessions` must not hold the
  notes session, and must hold the shop session.
- **AC7** (`rule-allow.test.ts`): #23's permissions world, plus an outside package installed under the hub's root
  through the extension host's public entry before the hub starts, as `extensions.test.ts` installs one. Its
  `tool.before` handler denies nothing and adds one block to every call; a plain `ls` must carry the block (else
  BLOCKED). `npm install left-pad` is asked, you say yes with `deep inbox answer`, the decision is saved. A new
  session's `npm install is-odd` must get `permissionDecision: "allow"`, and its `permissionDecisionReason` or
  `additionalContext` must cite `decision:<id>`.
- **AC8** (`codex-loop.test.ts`): #39's world. One check declared to take 20 minutes (slow lane); its real run takes
  a second and passes. Turn 1 is yours: the rollout records a goal created and active, the agent writes a file and
  stops, and the test waits for that stop's run to end. Turn 2 has no prompt hook and opens in the rollout with
  Codex's goal context; the agent writes another file and stops. The record must show the turn's `user.ask` from
  `continuation`, the stop reading the goal active, a claim, and a reply that ends the turn (else BLOCKED). Then no
  `run.started` of the check on that claim within 30 s of the reply, and at least one `check.held` for it.

## Deviations, choices and limits

- **AC4 passes on the base** (above). Nothing was bent to make it fail.
- **AC1 to AC3 stand in for the hub's run service.** The bench plays `start` and `ended` and maps a script's exit to a
  run record. A fix that changes what the gate asks of `GateOptions`, or `stop`, `rerun`, `verdictOf`, `recorded` or
  `keyed`, breaks the bench before any assertion. No hub-level test of these three was written: the smallest real
  cause of a rejected start (a paid check's budget, a checkout gone) needed more scene than the criterion states.
- **Imports by path.** The bench imports `packages/hub/src/gate-runner.ts`, and AC7 imports package entries, by
  relative path, as the neighbouring suites do. The design's trace lane says it refuses an acceptance test that
  imports the code under test by path; the hub package exports no `GateRunner`. Not resolved here.
- **AC2 passes `same: true`.** That is what the hub passes for a stop with no work since the last claim. A fix that
  runs the check only when `same` is unset fails this test.
- **AC3's wait.** The rerun is read as over once its refused start is seen and `judged` was called, or the verdict
  is no longer pending; a fix that never calls `judged` on that path and stays pending fails at the assertion, as
  the base does.
- **AC4: "once" is not asserted.** One call, one denial is read. The cause is matched as SQLite's own error text
  (`no such column: requirements` here); a denial that paraphrases the error without its words fails.
- **AC5: the folder is `.deepbuild/checks`, not the issue's `tests/acceptance/12`.** On this base a handed definition
  locks only with drafted checks under `.deepbuild/`. "The check is BLOCKED" is read from `verdict.made`, whose
  requirements name their check; it holds no per-check list. The path named is the check's own. Because the
  session's folder no longer holds the check as a file, the core's floor also records the claim INVALID for a
  changed definition, on the base and after a fix; that verdict judges no requirement and is not read. Referenced
  expected outputs (the issue's "each referenced expected output") are not covered.
- **AC6 also asserts the session bob may see is listed**, so a health with no sessions can't pass. The Scope's
  `claude.readings` and `codex.readings` are not asserted; no criterion states them.
- **AC7: "the rule's words" is read as the rule's handle**, `decision:<id>`, in what the agent reads, as #23's suite
  reads "the agent sees the reason". The extension's block alongside the allow is not asserted.
- **AC8: "held for the loop" is read as a `check.held` record** (#965's surface), and "at that stop" as within 30 s of
  the reply, half the design's 60 s grace window. The stop's held time and its verdict line are not asserted. The
  rollout is written by the test in the corpus's shapes; no real Codex runs.
- **Load.** A reading load spoiled is a skip marked INCONCLUSIVE, never a pass: the base-commit service going over
  its 8 s of git work (AC1 to AC3), or a hook the hub never decided (AC4, AC7: deep-hook says it spooled the call,
  or the record marks it late). None occurred in any run.
- **Agent CLIs.** The hub runs `claude plugin list --json` when a session starts. AC4, AC5 and AC7 put a `claude` and
  a `codex` that list no plugins first on PATH, as #1337's world does, so no real agent program runs under a test's
  home. Before that was added, this job's early runs of those three files let the hub run the machine's real
  `claude` for that one command, under the temp HOME; it made no model call.
- **The repository's own tooling lists processes.** `tests/vitest-setup.ts` (at each file's end) and
  `scripts/throttle.mjs` call `ps`; this job didn't add or change that.

## Checked apart from the suite

Not part of the suite: throwaway files, each run once on the base and deleted, to show a passing reading is reachable
through the same harness.

- AC2: with `start` never refused, the claim read PASS, its check counting the one run.
- AC4: with the record whole, the same prompt and a body saying `Part of #7` listing R1 and R2, the call was
  allowed; with the read broken, `Closes #7` was denied with "DeepBuild denied this: the Closes rule failed: no such
  column: requirements". With a prompt that doesn't ask for a pull request, a call with no closing word was held by
  an authority ask, which is why the test's prompt asks for one.
- AC7: with no extension loaded, the same scene's reply had `permissionDecision: "allow"` and cited the rule.
- AC1, AC3, AC5, AC6 and AC8 had no control run. AC1's and AC3's first halves are controls of a kind: session A's
  claim reads BLOCKED as inherited, and the claim's first run reads PASS.

## Not run

- The suite against a fix: none exists.
- `scripts/affected.mjs --wide`, the proof lanes (`scripts/proof-runs.mjs`, the trace lane, mutation runs) and the
  full preflight.
- Linux. Any real agent.
