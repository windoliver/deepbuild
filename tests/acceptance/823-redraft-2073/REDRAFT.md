# #823 blind redraft, after #2073: the deep_run tests play in a trusted repo, on checks a claim's checks count

#823's suite has two tests that call `deep_run`: `stop.test.ts`'s second test (criterion `#823.d60a913c`, a hub stopping
while a call waits answers it unavailable, never with a success) and `run.test.ts`'s one test (`#823.da880762`, a run's
result reaches a waiting `deep_run` within 20 ms of `run.finished`). Both were written before #2073, whose Scope says:
"deep_run in a project the core's trust decision doesn't mark trusted is refused before anything starts", and "In a
trusted project, deep_run runs the check on the claim's commit in a temporary checkout, as a claim's checks run". Their
fixture repo has no trust record, its checks are `sleep 60` and `sleep $(cat pause)`, and `run.test.ts` rewrites the
worktree's `pause` file after the claim. Under #2073 a correct hub refuses both tests' `deep_run`; trusted, it would
leave both checks uncounted before a process starts (design: Traced programs), and would never read the rewritten file.
Neither criterion of #823 is touched: only the world the two tests play in is. The redraft keeps each test's scenario
and every assertion, and changes the fixture and the two check commands.

Written from issue #823 (closed) and issue #2073 (open, updatedAt 2026-11-12T19:27:09Z), as handed to this job; the
frozen `tests/acceptance/823/` (README.md, helpers.ts, fixtures/agent.mjs, stop.test.ts, run.test.ts, BASE-FAILURE.txt,
twins.json, tsconfig.json; `wait.test.ts` searched for `deep_run` only); #2073's own blind suite
(`tests/acceptance/2073/`: README.md, helpers.ts, run.test.ts, BASE-FAILURE.txt; tests, not an implementation); the
design (`docs/technical-design.md`: Threats, Untrusted repos and Agents gaming checks; How runs become one of five
verdicts, the run outcomes, Pinned to a commit and Traced programs; the MCP tools row; the checks-command, done-gate and
spec-draft rows; Dogfooding) and AGENTS.md, Proof; `tests/acceptance/306-redraft-1958/REDRAFT.md` and
`724-redraft-1405/REDRAFT.md` for form; and base `1c4d1f0e2`, read only for how the surfaces are driven:
`packages/hub/src/mcp-operations.ts` (`runCheck`, `checksOf`), `runs.ts` (`start`, `launch`, a claim's check and its
default deadline), `stop-judging.ts` (`projectTrusted`), `server.ts` (`stop`), `packages/record/src/trust.ts`
(`openTrust`), `packages/checks-command/src/` (`index.ts`, `shell.ts`, `controls.ts`) with `runtime/preload.mjs` and
the conformance package's `runtime/check-kind/tracer.mjs` (what a claim's check counts), and `scripts/lanes.mjs`,
`scripts/proof-runs.mjs` (`twinsOf`) and `scripts/throttle.mjs`. I never read an implementation of #2073, a diff, a
branch, a pull request, another checkout or another job's redraft folder.

## What #2073 changes, test by test

| Original (path › test) | Criterion | Why the old expectation no longer holds | Replaced by |
|---|---|---|---|
| `823/stop.test.ts` › #823.d60a913c a deep_run waiting on its run when the hub stops is answered unavailable, never with a success | `#823.d60a913c` | Its world is `agentWorld()`: no trust record covers `<tmp>/work`, so under #2073 `deep_run` of `long` is refused before anything starts, no `run.started` is appended, and the test stops at "BLOCKED unless deep_run started the run of long". Were the repo trusted, `long` is `sleep 60`: `sleep` is a program the tracers can't see into, so a run made as a claim's checks run is uncounted before a process starts, `deep_run` answers at once, and the test fails at "came back before the hub stopped". No call is left waiting either way, so the criterion is never reached | `823-redraft-2073/stop.test.ts` › the same name with "(redraft 2073)" |
| `823/run.test.ts` › #823.da880762 a run's result reaches a waiting deep_run within 20 ms of run.finished (p95 over 20 runs) | `#823.da880762` | The same world: untrusted, so every `deep_run` of `pause` is refused and the test fails at "must return the run's result". Were the repo trusted, `pause` is `sleep $(cat pause)`: a shell substitution and `sleep`, uncounted before a process starts, so the test fails at `passed`. And it sets each run's time by rewriting the worktree's `pause` file after the claim, which a run on the claim's commit never reads | `823-redraft-2073/run.test.ts` › the same name with "(redraft 2073)" |

What each redraft keeps and what it changes:

| | In #823's test | In the redraft |
|---|---|---|
| The world | `agentWorld()`: a home, a one-commit git repo `<tmp>/work`, the session's start seeded in the record, the hub, the agent stand-in's session through its hooks, its `deep mcp` | The same, step for step (`helpers.ts`, `trustedWorld`), from the frozen helpers' own pieces. Added: the core's trust decision for `<tmp>/work`, appended to the home's record before the hub starts, as #2073's suite records it |
| The spec | `pause: sleep $(cat pause)`, `long: sleep 60`, and a tracked `pause` file | `pause: node checks/wait.mjs 0.2 0.3`, `long: node checks/wait.mjs 60`, and `checks/wait.mjs` in the same one commit; no `pause` file. The `claims` and `asks` blocks are the original's |
| The claim | one `deep_claim` at the repo's commit, the worktree clean | Kept. Nothing in the worktree changes after it, so the claim's commit and the live worktree hold the same files |
| stop: the run left waiting | `deep_run` of `long`; its `run.started` awaited (20 s); 1.5 s more with no reply; then SIGTERM to the hub by PID | Kept as written |
| stop: the assertions | a tool error, `code: "unavailable"`, arriving within 1 s of the hub's exit | Kept as written |
| run: the runs | 22 `deep_run`s of `pause` for the one claim, the first two a warm-up, each 200 to 300 ms long, the time drawn by the test and written to the worktree before the run | 22 `deep_run`s of `pause` for the one claim, the first two a warm-up, each 200 to 300 ms long, the time drawn by the check's own process (reading 2) |
| run: the assertions | each call not an error, `run` a `run:` handle, `outcome: "passed"`; every run's `run.finished` in the record; p95 (nearest rank of 20) of arrival less `run.finished`'s `ts` at most 20 ms; INCONCLUSIVE, never passed, when over the limit on a machine loaded past its cores | Kept as written |

## Kept as they are

- `823/stop.test.ts` › #823.d60a913c a deep_wait waiting when the hub stops is answered unavailable, never with a
  success. It calls no `deep_run`; trust and check commands don't reach `deep_wait`. The redraft file replaces the whole
  original file, so it carries this test over as written: the frozen `agentWorld({ asks: 1 })`, the same name, the same
  assertions.
- `823/wait.test.ts`, all three tests: `deep_wait` only, no `deep_run` anywhere in the file. Not part of this redraft.
- `823/helpers.ts`, `823/fixtures/agent.mjs`, `823/twins.json` and `823/twins/`: imported or left unchanged.

## Readings

1. **Trusted how.** By the core's decision alone, #2073's own words and its suite's way: your answer on the trusted
   path, appended through `openTrust` of the record's public entry with the app's connection, before the hub starts.
   The home holds no `~/.claude.json` and no `~/.codex/config.toml`. Trust through an agent's own record would hold
   only under the Scope's second line, so it isn't leaned on.
2. **"Each run ends at no fixed phase", without a file rewritten after the claim.** Two forms were open: a time the
   check's own process draws, or a claim per run at a commit that holds the time. I took the first. `checks/wait.mjs`
   draws 200 to 300 ms with `Math.random()` in its own process, the range the original drew in the test. It keeps the
   original's scenario, one claim and 22 runs of one check for it, and the worktree stays as the claim's commit holds
   it, so the test reads the same whichever tree a hub runs in and whichever revision of `done.yaml` it reads (#1864's).
   A claim per run would add 22 commits and 22 claims the original never made and make every run the first of its
   commit, a different scenario from "again and again". The test never needed a run's time: it reads only the reply's
   arrival and the `ts` of the run's `run.finished`. That the times differ is not asserted, as it wasn't.
3. **Check lines that run both ways.** Each is one Node process running a script the claim's commit holds: no shell
   substitution, no redirection, no other program, no file read, exit 0 when its timer ends. The base's `deep_run` runs
   the line with `/bin/sh -c` in the worktree and reads its exit. Run as a claim's checks run, Node is a traced program
   and a command that starts no test tool has one result, its exit status (design: Traced programs; #2073's suite,
   surface 5, runs the same shape, `node checks/holds.mjs <word>`). Both lines were run both ways on the base (On the
   base).
4. **`long` and its deadline.** The spec gives `long` no deadline, as the original's didn't. A claim's check with none
   has the hub's own, a day on the base, so a minute's wait is still running when the hub stops, as `sleep 60` was.
5. **"As today"** stays #823's reading 4: the hub destroys its connections before its core stops, so `deep mcp` answers
   the waiting call unavailable. A run made as a claim's checks run is stopped when the hub goes down and ends
   `stopped` (design: the run outcomes); a hub that let that `run.finished` answer the waiting `deep_run` with an
   outcome would be answering with a success, which is what the test fails.
6. **The session's start** is seeded in the record before the hub starts, as #823's `seed` appends it, so the redraft's
   world differs from the original's by the trust decision and the spec alone.

## Wrong programs they still fail

- **`stop-answers-waiting`**, #823's twin for `#823.d60a913c`, on the base as `DEEP_HUB_PLANT=stop-answers-waiting`: a
  stopping hub keeps its connections until its core has stopped, so the waiting `deep_run` is answered `outcome:
  "running"`, a success. The redraft fails at "deep_run must not succeed when the hub stops while it waits", the
  original's assertion. Run once on the base (On the base).
- **A hub that polls for `run.finished`**, #823's own merge base (`runCheck` reading the record every 100 ms): the
  delays spread to 100 ms whatever the check runs, so `run.test.ts` fails at the p95 as the original did
  (`823/BASE-FAILURE.txt`: p95 97 ms). Not run here: the base no longer holds that program and #823's twins plant none
  for `deep_run`.
- The redraft adds no wrong-program test, as neither original file has one.

## On the base

`BASE-RESULTS.txt` is the one run at `1c4d1f0e2` (November 14, 2026, 08:17 PST; 39.5 s; 1-minute load 258 at the start
and 288 at the end, on 18 cores): 3 tests, 3 passed, none BLOCKED or INCONCLUSIVE. On the base `deep_run` asks no trust
and runs in the live worktree, which here holds what the claim's commit holds, so each redraft passes there as a
correct program for #823 must (the base holds #823's change; the frozen originals were not run here):

- `stop.test.ts` › deep_wait: PASS (regression protection, as in `823/BASE-FAILURE.txt`): unavailable, 81 ms before
  the hub's exit.
- `stop.test.ts` › deep_run (redraft 2073): PASS. The run of `long` started, no reply came in 1.5 s, and the stopping
  hub's call was answered unavailable ("it closed the connection"), 5.1 s before the hub's exit.
- `run.test.ts` (redraft 2073): PASS. All 22 runs `passed`; p95 10 ms over 20 runs (median 3 ms, max 18 ms). The base
  holds #823's change, so the original's failure on #823's own base (p95 97 ms) is not expected here. The machine was
  loaded far past its cores; the load rule makes a reading over the limit INCONCLUSIVE and leaves one within it a pass,
  since load only adds delay. It is one reading at that load, not chased.

The type check is clean (exit 0), over this folder's three `.ts` files and `823/helpers.ts`.

By hand at the base, one scratch run, not kept (its file was this folder's `helpers.ts` with the plant passed to
`startHub`, and the redrafted stop test's body):

- The two check lines on the command check kind, as a claim's checks run (`runCommandCheck` of
  `packages/checks-command`, on a supervisor of its own, `HOME` a temporary folder, in a copy of the fixture repo):
  `node checks/wait.mjs 0.2 0.3` three times, each `passed`, exit 0, one test counted, no mask, read set
  `checks/wait.mjs`; `node checks/wait.mjs 60`, stopped after 2.5 s, `stopped` with exit cause `stop`, so its process
  had started and nothing left it uncounted. So both lines run the same as the base's `deep_run` runs them and as a
  claim's checks run.
- The redrafted deep_run stop test on `DEEP_HUB_PLANT=stop-answers-waiting`: FAIL at "deep_run must not succeed when
  the hub stops while it waits", the reply `outcome: "running"`, `isError: false`.

Not run: any implementation of #2073 (none exists here), so the passing side under #2073 is unverified; the frozen
originals; a polling hub for `run.test.ts`; a second run of either file.

## Run it

With Node 24.22.0 first on `PATH`, from the checkout's root, after `npm ci` and `npm run build --workspaces` (the tests
run the built CLI and build nothing):

```sh
node scripts/throttle.mjs test --wait 120 -- node node_modules/vitest/vitest.mjs run --root tests/acceptance/823-redraft-2073 --no-file-parallelism --testTimeout=600000 --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/823-redraft-2073/tsconfig.json
```

`helpers.ts` holds only what differs from `../823/helpers.ts`: the spec, the script, the trust decision and
`trustedWorld`, which follows `agentWorld` step for step. Folders are the original's, `/tmp/dh823-*`, removed by its
`cleanup`; `HOME` is `<tmp>/h` for the hub, the agent stand-in and its `deep mcp`, and the fixture repo's own folder
for the `git` calls that make it, never the real one; processes are stopped by PID. A run with `--root` leaves
Vitest's cache in this folder's `node_modules/.vite`; delete it.

## At merge

The frozen `tests/acceptance/823/` stays as written. The owner's call is to swap `823/stop.test.ts` and
`823/run.test.ts` for the two files here, and to keep `823/wait.test.ts` as it stands. `scripts/lanes.mjs` then needs
this folder where the originals are: `'tests/acceptance/823-redraft-2073/'` in `alone`, beside `'tests/acceptance/823/'`,
and `'tests/acceptance/823-redraft-2073/run.test.ts'` in `timed`, beside `'tests/acceptance/823/run.test.ts'`. The
proof lane finds a test's twins in its own acceptance folder (`twinsOf`), and this folder holds no `twins.json`: if the
redrafted stop test is to be run against `stop-answers-waiting` there, the swap gives it one. Those edits are the
implementer's.
