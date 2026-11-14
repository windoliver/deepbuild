# #27 criterion AC4 blind redraft, after #2073: the check run that never ends, in a trusted repo, as a check a claim's checks count

#27's AC4 says "Fixtures show each ask, hold, check run and agent command reaching a recorded outcome by its deadline".
Its suite, `tests/acceptance/27/waits.test.ts`, holds one fixture per kind of wait. The check run's fixture calls
`deep_run` of `sh -c 'sleep 600; : <marker>'`, with `deadline: 1m` in the repo's `done.yaml`, in a repo no trust record
covers. #2073's Scope says deep_run "in a project the core's trust decision doesn't mark trusted is refused before
anything starts", and that "in a trusted project, deep_run runs the check on the claim's commit in a temporary checkout,
as a claim's checks run". A correct program then starts no run in that fixture, and in a trusted one it leaves that
command uncounted before a process starts (design: Traced programs). #27's criterion still holds: a check run has a
deadline from the spec, and a run past it is stopped and recorded as overran. The redraft keeps the criterion, the
scenario and every assertion, and changes the fixture's trust and the check's command only.

Written from issue #27 (closed; AC4, "Added Oct 9", "Done when"), issue #2073 (open; Scope, criteria, Proof) and issue
#322 (closed; its Scope's line on project trust), each as this job was handed its text; the frozen
`tests/acceptance/27/` (README.md, helpers.ts, waits.test.ts, BASE-FAILURE.txt, twins.json, `fixtures/`); #2073's own
blind suite (`tests/acceptance/2073/`: README.md, helpers.ts,
run.test.ts, BASE-FAILURE.txt; tests, not an implementation); the design (`docs/technical-design.md`: Threats, and what
stops each one, its Untrusted repos and Agents gaming checks rows; How runs become one of five verdicts, its run
outcomes, Traced programs and Pinned to a commit; the checks-command, done-gate and spec-draft rows of First-party
extensions; Every wait ends; Dogfooding; AGENTS.md, Proof); `tests/acceptance/306-redraft-1958/REDRAFT.md` and
`tests/acceptance/724-redraft-1405/REDRAFT.md` for form; and base `1c4d1f0e2`, read only for how the surfaces are
driven: `packages/hub/src/mcp-operations.ts` (`runCheck`, which is deep_run; `checksOf`; `claim`), `runs.ts` (`start`,
`launch`: how deep_run's run and a claim's check each hold their deadline), `stop-judging.ts` (`projectTrusted`,
`specChecks`, `runClaim`, `runApproved`), `packages/record/src/trust.ts` (`openTrust`),
`packages/checks-command/src/index.ts` and `shell.ts` (what the command check kind counts, and how it ends a run at its
deadline), `packages/supervisor/src/supervisor.ts` (a run's start, and its signal), `scripts/lanes.mjs` and
`scripts/proof-runs.mjs` (where #27's file is listed, and how twins are found); and, for what the base run showed,
`crates/deep-hook/src/main.rs` (how long the hub has to acknowledge a hook, and what a hook does past it),
`packages/hub/src/server.ts` (`holdFor`) and `waits.ts` (a call's overrun). I never read an implementation of #2073,
any diff, branch, pull request or other worktree.

## What #2073 changes, test by test

| Original (path › test) | Criterion | Why the old expectation no longer holds | Replaced by |
|---|---|---|---|
| `27/waits.test.ts` › AC4 a check run that never ends on its own reaches overran by its deadline (1m in the repo's spec), its processes stopped | #27 AC4 `#27.e6116d56` | Two ways. (1) No trust record covers its repo, so under #2073 deep_run "is refused before anything starts": no `run.started` is appended, and the test ends BLOCKED after its 60 s wait for the run to start, before any assertion of the criterion. (2) Its command, `sh -c 'sleep 600; : <marker>'`, is one a claim's checks can't count: a shell given options and `sleep` are programs the run's tracers can't see into, which "makes the run uncounted before a process starts" (Traced programs). So a trusted repo's run of it ends `uncounted` at once, never `overran`. The fixture's other parts already fit #2073: it is a git repo, the claim names its one commit, and no file changes after the claim | `27-redraft-2073/waits.test.ts` › AC4 a check run that never ends on its own reaches overran by its deadline (1m in the repo's spec), its processes stopped (redraft 2073) |

The redraft keeps the original's scenario step for step: a home and a repo with one commit; the hub with `noAskWait`;
`deep setup`; a Claude Code stand-in session that asks through its own `deep mcp`; `deep_claim` at the repo's commit;
`deep_run {check: "forever", claim: null}`; the record read with `events.read`; the process table read with `ps`.

| Part of the test | In #27's test | In the redraft |
|---|---|---|
| The repo's trust | none | Changed: the core's decision marks the repo trusted, your answer on the trusted path appended to the home's record through `openTrust` before the hub starts, as #2073's suite records it |
| The check's command | `sh -c 'sleep 600; : <marker>'` | Changed: `node checks/forever.mjs <marker>`, one Node process running a file of the repo's one commit (a timer that never ends). The marker is that process's argument |
| The check's deadline | `deadline: 1m` in `done.yaml` | Kept |
| The claim | `deep_claim` at the repo's commit, scope session | Kept |
| The run starts | the first `run.started` naming `forever`, within 60 s, else BLOCKED | Kept. When deep_run has replied with an error and no run started, the BLOCKED message quotes the reply and the wait ends there |
| A recorded outcome by its deadline | a `run.finished` for the run by `run.started` + 1 minute (+10 s) | Kept |
| It reads overran, never passed | `outcome` is `overran` | Kept |
| Its processes stopped | no process whose command line holds the marker | Kept |

## Kept as they are

The file's three other tests call no `deep_run`, and their repos name no check, so #2073's Scope doesn't reach them.
They are carried over into this file word for word, in the original's order, with their names unchanged:

- AC4 an ask nobody answers reaches its default by its deadline (1m in your settings), recorded as defaulted, never as answered.
- AC4 a stop held for an open ask nobody answers goes through by the end of its hold, the record says how the hold ended, naming the ask, and the session doesn't read as finished.
- AC4 an agent command still running far past its expected time is recorded as an overrun while it runs, never as finished.

Their repos stay untrusted, as written. Every helper and fixture is #27's, imported from `../27/helpers.ts` unchanged;
this folder has no helper file. The test file adds two small pieces of its own: `trust`, and the check's script.

Outside this file, no other test of `tests/acceptance/27/` calls `deep_run`.

## Readings

- **Trusted by the core's decision alone**, #2073's own words ("the core's trust decision") and its suite's way.
  Nothing in the test home marks the repo trusted in Claude Code or Codex: `deep setup` writes DeepBuild's entries
  into the home's Claude Code files and no project's trust. The session is a Claude Code session, and #2073's Scope
  says the refusal goes through the trust read a claim's spec checks use, which also takes Claude Code's workspace
  trust; no criterion of #2073 states that for deep_run, so the redraft trusts the way both readings accept.
- **Recorded before the hub starts**, through the record's public entry (`packages/record/src/index.ts`), so the hub
  reads the decision from its record as it reads any other. A decision that can't be recorded is BLOCKED.
- **The check is one Node process.** Traced programs: a command check's run counts when every program it starts is one
  the tracers see into, and Node is one "as installed files outside the folders the run can write". The file it runs
  is in the claim's commit, so a temporary checkout of that commit holds it. The shape is #2073's suite's
  (`node checks/<file>.mjs <word>`). The base's deep_run runs the same line with `/bin/sh -c` in the worktree.
- **"Never ends on its own"** is a timer that keeps the process alive. It handles no signal, so a stop ends it at once.
- **"Its processes stopped"** is read as the original reads it: no process whose command line holds the marker. In the
  original only the shell's command line held it; here the Node process holds it too, so a run whose shell ended
  while its program ran on is seen.
- **Files as the claim's commit holds them.** The spec and the check's file are in the repo's one commit, and nothing
  in the worktree changes after it. So the test doesn't depend on which revision of `done.yaml` is read (#1864's) or
  on whether the run reads the worktree or a checkout: the base and a correct program run the same file.
- **The deadline's slack stays #27's**: `run.finished` by `run.started` + 1 minute, + 10 s. The base arms deep_run's
  deadline as the run starts. The command check kind, which a claim's checks run through, counts it "from the
  process's start, not from the wait for its sandbox or a lease", and gives the run's tool 500 ms before the kill. So
  on a correct program the time from `run.started` to the process's start comes out of the 10 s. It isn't widened:
  the criterion says "by its deadline", and neither issue gives another number. On this Mac at a 1-minute load of 219
  to 276 on 18 cores, the command check kind ended the check's line 11.4 s past an 8 s deadline, most of that before
  its process started (`BASE-RESULTS.txt`; one reading). So on a machine loaded like that a correct program could
  miss the 10 s for the load alone; how long the start takes on a quiet machine was not measured.
- **deep_run's reply isn't read**, as in the original: with `noAskWait` deep_run answers that the run is still
  running, and the outcome is read from the record. A reply that is an error is quoted only where no run started.
- **A run that never starts is BLOCKED, never a pass**, as in the original. In a trusted repo a correct program starts
  it; a hub that refuses there ends this test BLOCKED naming the refusal.

## Wrong programs they still fail

- #27's own wrong program for the check run is a hub whose deep_run has no deadline, as its merge base (`38b7a1a5`)
  was: the run never ends, and the test fails at "no run.finished for it", as the original did there
  (`27/BASE-FAILURE.txt`).
- A hub that ends the run at its deadline and records `passed`, `failed`, `stopped` or `uncounted` fails at `overran`.
  That covers a #2073 hub that runs the check as a claim's checks run and can't count it.
- A hub that records `overran` and leaves the run's process running fails at "its processes are gone".
- A hub that records `overran` later than the deadline plus 10 s fails at the outcome's time, or at "no run.finished".
- A hub that starts no run in the trusted repo (one that refuses every deep_run, say) ends BLOCKED, never passed.
- The ask's twin, `skip-default-at-deadline`, fails the carried-over ask test as before: #27's helpers pass
  `DEEP_HUB_PLANT` to the hub, and this file starts its hubs through them.

None of these was run by this job. The check's shape was run once on the base's command check kind with a scratch
script that is not kept (`BASE-RESULTS.txt`): the redraft's line ended `overran`, stopped at its deadline with no
process left, and #27's line ended `uncounted` ("untraced program sh") before a process started.

## On the base

`BASE-RESULTS.txt` is the one run of the file at `1c4d1f0e2` (November 14, 2026, 11:23 PST; 150 s; 1-minute load 276
at its start and 305 at its end, on 18 cores), by the first command of "Run it" with `--wait 240`, a longer wait for
the throttle's grant, which came at once: 4 tests, 3 passed and 1 failed. No implementation of #2073 was run; none
exists in this checkout.

- **The check run (redraft 2073): PASS**, 64.9 s. The base's deep_run asks no trust and runs
  `/bin/sh -c "node checks/forever.mjs <marker>"` as you in the live worktree, which holds what the claim's commit
  holds. It arms the spec's 1-minute deadline once `run.started` is appended, stops the run's process group at it and
  records `overran`. The trust decision changes nothing there. So on the base the redraft shows what #27's test
  shows: an overran run by its deadline, its processes gone.
- **The ask: PASS**, 65.6 s, and **the agent command: PASS**, 7.4 s. Both carried over as written.
- **The hold: FAIL**, 4.6 s, at its control, before any assertion of the criterion: "the stop was held while ask:…
  was open (the control): it took 246 ms: expected 246 to be greater than 5000". The test is #27's, word for word; it
  calls no deep_run and its repo names no check, so neither #2073 nor this redraft touches it. The Stop went through
  unheld. What in the base lets a Stop through unheld is deep-hook: it gives the hub 20 ms to acknowledge a hook, and
  at 48 ms its watchdog ends an unacknowledged one with the decision for the hub away, which for a Stop is to let it
  go. #27's README says so under "Machine load", and says to rerun and keep the load with the result. The hub's own
  rule (`holdFor`) holds a Claude Code stop of a session with an open ask, whatever the project's trust. The run
  doesn't show the hook's reply, so that reading comes from the base's code and the load and is not confirmed. The
  file was not run again: it was not changed, and the run was not cut short.

The type check is clean (exit 0, no output). The frozen `27/waits.test.ts` was not run.

This job ran twice. Its first run wrote the test file, `tsconfig.json` and this file's other sections, and was cut off
before it recorded a base run. Its second read them against the same sources, left the test file and `tsconfig.json`
as they were, and made the run recorded here. The first run's one log of the file on the base (November 13, load 154
to 139) is a first reading only: the same three passes and the same failure at the same control (101 ms).

## Run it

With Node 24.22 first on `PATH`, on macOS, with the Rust toolchain, after `npm ci`, `npm run build --workspaces` and
`cargo build --locked -q -p deep-hook --features env-plants` (#27's README; `setup` in #27's helpers runs that cargo
build each time, which does nothing once it is built), from the checkout's root:

```sh
node scripts/throttle.mjs test --wait 120 -- node node_modules/vitest/vitest.mjs run --root tests/acceptance/27-redraft-2073 --no-file-parallelism --testTimeout=600000 --reporter=verbose waits.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/27-redraft-2073/tsconfig.json
DEEP_HUB_PLANT=<name> node node_modules/vitest/vitest.mjs run --root tests/acceptance/27-redraft-2073 --no-file-parallelism waits.test.ts   # a wrong program, by hand
```

The file is slow: the ask's deadline, the stop's hold and the check's deadline are a minute each. Each test starts its
own hub, makes its folders under `/tmp/dh27-*`, sets `HOME` to `<tmp>/h` for every process it starts, and stops only
processes it started, by PID, as #27's helpers do. A run with `--root` leaves Vitest's cache in this folder's
`node_modules/.vite`; delete it.

`scripts/lanes.mjs` lists `tests/acceptance/27/waits.test.ts` on its one-at-a-time list (`alone`) and its `slow` list,
and not on `timed`. `tests/acceptance/27-redraft-2073/waits.test.ts` belongs on the same two. That edit is the
implementer's, at the swap; this job did not edit the file.

## At merge

The frozen `tests/acceptance/27/` stays as written. The owner's call is to swap `27/waits.test.ts` for the file here:
this one in the lanes, the original run by hand only. This folder has no `twins.json`. #27's maps `#27.e6116d56` to
its twins, and of those only `skip-default-at-deadline` is for a test of this file (the ask); the proof lane finds a
test's twins in its own acceptance folder, so the swap carries that entry and its twin folder here if the lane is to
read it.
