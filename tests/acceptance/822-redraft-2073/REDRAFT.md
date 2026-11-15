# #822 criterion 3 blind redraft, after #2073: the hub's check-run deadline, in a trusted repo at the claim's commit

#822's third criterion says every other timer a caller's value can set "behaves the same: a value past 2³¹ − 1 ms waits
its full time, and a value that isn't positive is refused, naming it". The owner ruled the hub's check-run deadline in
scope: the `deadline:` a check gives in `.deepbuild/done.yaml`, which `deep_run` passes to its run. Its suite,
`tests/acceptance/822/hub.test.ts`, proves it with seven tests that call `deep_run`. #2073's Scope changes what a correct
hub does with that call: "deep_run in a project the core's trust decision doesn't mark trusted is refused before anything
starts", and "In a trusted project, deep_run runs the check on the claim's commit in a temporary checkout, as a claim's
checks run". The suite's fixture is invalid under each line: its `repo` is a plain folder, its claim names a commit no
repo holds, no trust record covers it, and its checks are `sh -c 'sleep 3600; …'`, which a claim's checks leave uncounted
before a process starts (design: Traced programs). A correct hub refuses all seven calls there. The criterion still
holds, so the redraft keeps #822's scenario and what each test asserts of the deadline, and changes the fixture.

Written from issue #822 (closed; as handed, updated 2026-10-30) and issue #2073 (open; as handed, updated 2026-11-12),
#322's text for project trust, the frozen `tests/acceptance/822/` (README.md, helpers.ts, hub.test.ts, checks.test.ts),
#2073's own blind suite (`tests/acceptance/2073/`: README.md, helpers.ts, run.test.ts, BASE-FAILURE.txt; tests, not an
implementation), `tests/acceptance/322/helpers.ts` (how its suite records trust), the design (`docs/technical-design.md`:
Threats, Untrusted repos and Agents gaming checks; How runs become one of five verdicts, the run outcomes, Traced
programs, Pinned to a commit; First-party extensions, the checks-command, done-gate and spec-draft rows; Dogfooding;
AGENTS.md, Proof), `306-redraft-1958/REDRAFT.md` and `724-redraft-1405/REDRAFT.md` for form, and base `1c4d1f0e2`, read
only for how the surfaces are driven: `packages/hub/src/mcp-operations.ts` (`runCheck`, which is deep_run; `checksOf`;
`claim`), `runs.ts` (`start`, `launch`, `CHECK_DEADLINE_MS`), `stop-judging.ts` (`specChecks`, `projectTrusted`,
`claimed`), `hub-runtime.ts`, `hub-control.ts` (`run.start`), `paths.ts` (`rootOf`), `packages/record/src/trust.ts`
(`openTrust`), `packages/checks-command/src/index.ts` and `shell.ts` (what the command check kind counts, and how it
holds a deadline), `packages/supervisor/src/timer.ts` and `supervisor.ts` (`after`, `start`, the timed scan) and
`scripts/lanes.mjs`. I never read an implementation of #2073, a diff, a branch, a pull request or another checkout's files.

## What #2073 changes, test by test

| Original (path › test) | Criterion | Why the old expectation no longer holds | Replaced by |
|---|---|---|---|
| `822/hub.test.ts` › AC3 hub deep_run: a check with deadline: 30d is still running after 24.8 days on a fake clock, and ends overran at 30 days | #822 AC3 | The expectation holds; the fixture doesn't. #2073: deep_run in a project no trust record covers "is refused before anything starts", so no run starts and the original fails at "the check run started". Trusted, the run is "on the claim's commit in a temporary checkout, as a claim's checks run": the fixture has no commit to check out, and a claim's check that starts `sleep` is uncounted before a process starts, so nothing would run for 30 days | `822-redraft-2073/hub.test.ts` › the same name, with "(redraft 2073)": the same readings in a trusted git repo, the claim at its commit, the check `node hold.mjs` |
| `822/hub.test.ts` › AC3 hub deep_run: a check with deadline: 0m is refused before its run starts, naming deadline and 0m; and the same for -5m, 1.5h, soon and .inf (five tests) | #822 AC3 | The expectation holds; in the untrusted fixture a correct hub's refusal is #2073's, "naming the project and that its spec checks run only once you trust it", and nothing makes it name the deadline too. The original fails at "the refusal names the field", or passes only where a hub happens to read the deadline before the trust | the same five names, with "(redraft 2073)": the same assertions in the trusted repo, where the deadline is the only reason to refuse |
| `822/hub.test.ts` › AC3 hub deep_run: a check with no deadline: still runs with none, after 60 days on a fake clock | #822 AC3, as the original read "behaves the same" after AC2's "leaving the field out still means no deadline" | #2073's Scope reverses it: run "as a claim's checks run", a check that names no deadline is stopped at the hub's day and recorded overran. No form of "runs with none" holds | No redraft (below) |

What the fixture changes, and nothing else does:

| In #822's fixture | Under #2073's Scope | In the redraft |
|---|---|---|
| `repo`, a plain folder holding `.deepbuild/done.yaml` | No commit to run on | A git repo, `<tmp>/repo`, with one commit on `main` holding `.deepbuild/done.yaml` and `hold.mjs`; the worktree stays as the commit holds it |
| The claim at `c0ffee…0822`, a commit no repo holds | Nothing to check out | The claim at the repo's commit, made with `deep_claim` while the worktree is clean |
| No trust record | deep_run is refused, naming trust | The core's decision marks the repo trusted: your answer on the trusted path, appended to the root's record through `openTrust` before the core starts, as #2073's own suite records it. The temp HOME holds no Claude Code workspace trust and no Codex config, so nothing else trusts it |
| `run: "sh -c 'sleep 3600; : dh822<name>'"` | Uncounted before a process starts: `sh -c` and `sleep` are programs the tracers can't see into | `run: "node hold.mjs dh822<name>"`: one Node process that runs for an hour of real time and prints nothing, the command #822's own `checks.test.ts` gives the command check kind |

Each redrafted test asserts what its original asserts. The 30d test: the run started; its process was tracked; just after
its start the run hasn't ended and its process is alive; the same at 24.8 days and a minute; not ended a minute before
30 days; ended once 30 days and a minute have passed, `overran`, its process gone. The five refusal tests: no
`run.started` and no `run.finished` for the check; an answer that isn't a refusal doesn't read `passed`, `overran` or
`running`; the refusal names `deadline` and the value as done.yaml writes it.

### No redraft: a check with no deadline still runs with none, after 60 days

- A claim's check that names no deadline doesn't run with none. The design's checks-command row: "Each run has a
  deadline, which spec-draft sets from the time the check took when it was drafted; a run past it is stopped through its
  own process group and recorded as overran". The base holds a claim's check to a day until then (`runs.ts`,
  `CHECK_DEADLINE_MS`: "How long a claim's check runs when its definition names no deadline: a day, so a run no tool ends
  is still stopped and recorded overran"). Seen once on the base (`BASE-RESULTS.txt`): a run started as a claim's checks
  run, with no deadline, was still running a minute before a day and ended `overran` a minute after it.
- So under #2073 a correct hub stops the test's run at a day, and the original's last assertion, "a check with no
  deadline ended within 60 days", fails on it.
- The opposite expectation, stopped at a day, is the base's own stand-in for a deadline spec-draft will set. Neither
  issue states it, so no test here pins it.
- What is left, that a check with no `deadline:` is taken and its run starts, #2073's own criterion-3 test proves under
  the new Scope: `tests/acceptance/2073/run.test.ts` › `#2073.7513ec0a` runs `holds-committed`, which names no deadline,
  to `passed`. In this file the 30d test is the control a hub that refuses every `deep_run` fails.

## Kept as they are

Every other test of `tests/acceptance/822/`: `runner.test.ts`, `checks.test.ts` and `extension.test.ts` reach the runner,
the command check kind and the extension host through their own public entries, and none calls `deep_run`. The frozen
`helpers.ts` is imported unchanged: its temp folders and temp HOME, its fake clock (`fakeClock`), its real-time waits
(`until`, `realSleep`), `tracked`, `alive`, `own` and `stopOwn`, `namesValue` and its constants.

## Readings

- **Trusted** is by the core's decision alone, #2073's own words ("the core's trust decision") and its suite's reading.
  The test reads the decision back from the core's record before any run; missing, the test is BLOCKED.
- **Files as the claim's commit holds them**: nothing is written in the repo after its commit, so a run in the live
  worktree and a run in a checkout of the commit read the same `done.yaml` and `hold.mjs`. Which revision of `done.yaml`
  a hub reads is #1864's, and no test here depends on it.
- **The check's command** drops the original's `; : dh822<name>` tail, since a command after the tool on `;` masks its
  exit status for a claim's check (design: Check health); the name stays as an argument Node ignores. Its `node` is the
  test's own Node both ways: the file puts that Node's folder first on its process's PATH, which a run as you inherits,
  and the command check kind links the Node its hub runs on.
- **Still refused for its deadline.** In a trusted project a `deadline:` the hub can't read is still refused by
  `deep_run` before its run starts, as #822 has it. #2073's Scope says nothing against it. The base's own claim checks
  read such a deadline as none (`specChecks`), so "as a claim's checks run" is read as where and how the check runs,
  not as dropping `deep_run`'s refusal.
- **Waits.** A wait for this machine that runs out is never a result: no session from the spool or no trust decision
  in the record is BLOCKED; no `run.started` and no answer from `deep_run` within 120 s, or a run with no process and
  no end within 120 s, is INCONCLUSIVE. Each throws. A reading that has evidence is a result: a refusal where a run
  was due, a run where a refusal was due, a run that ended early, or one still going 120 s of real time after 30 days
  and a minute. The original's "10 s with no answer counts as no refusal" becomes a wait that ends at `deep_run`'s
  answer or at a run's start, so a hub that starts the run fails as soon as its `run.started` is read.
- **Where the readings sit.** The fake clock moves with real time too, and a loaded machine can take a minute to start
  a sandbox. So "not yet" is read against the clock just before `deep_run` is called (the deadline is armed no
  earlier), and "by now" against the clock once the run's process was seen and 1.5 s passed (the deadline is armed by
  then): still running 24.8 days and a minute after the second, not ended a minute before 30 days after the first, and
  ended once 30 days and a minute passed after the second. A finish read a minute before 30 days when the reading itself
  came after them is INCONCLUSIVE.

## The fake clock's steps

The redraft moves the frozen fake clock with a function of its own, `move`, in place of the frozen `advance`. This is not
#2073's change. It is what the 30d test needs to end at all on this base, and it is the one piece of the frozen helpers
the redraft doesn't use.

- `advance` runs each timer with Vitest's `advanceTimersByTimeAsync`, which gives the event loop a turn after every
  timer. On this base the supervisor's timed scan stops while no run is live and starts again with a run, so in these
  tests, where the fake clock is on before `deep_run`, the scan is a 100 ms interval of the fake clock: 864,000 timers
  a fake day. Measured on the base with the 30d run's process live: one fake minute by `advance` took 93 ms and 59 ms
  of real time in two probes, which is 42 to 67 minutes for 30 days. The first base run, with `advance`, ran out of its
  600 s, using 3 m 5 s of user and 6 m 11 s of system time. Not run, by reading: the original's two long tests have the
  same loop under a 180 s limit, so on this base they time out whatever the load.
- `move` runs the same timers with `advanceTimersByTime`, 10 s of fake time a step, and lets the promise work the timers
  queued run after each step. The rest of the event loop's work runs when the move ends, before each reading. One fake
  minute took 0 to 1 ms; the 30d test took 19.9 s.
- What a program may do for its deadline stays what the frozen README says: read any of the faked clocks or count
  chunks of 2³¹ − 1 ms. A deadline re-armed from a promise is at most 10 s late, inside the minute each reading leaves;
  one that waits on the event loop between timers is seen in real time after the last move, as its clock already reads
  past 30 days.

## Wrong programs they still fail

Each was run with this file as it is, byte for byte, against a copy of the hub's build kept outside the checkout with
the wrong program planted, and removed:

- **The hub before #822** (one `setTimeout` for a run's deadline; a deadline it can't read taken as none): 6 of 6 fail.
  The 30d test at "a 30-day deadline ended the run at its start" (the run `overran` at once); each refusal test at "a
  run started for a check with deadline: …".
- **Clamp only, and a refusal that names no value** (the deadline's timer armed with at most 2³¹ − 1 ms; the refusal
  says "a whole number above 0 of m, h or d" without what done.yaml wrote): 6 of 6 fail. The 30d test at "ended before
  30 days, after 24.8"; each refusal test at "the refusal names the value … as written".

By reading, not run:

- **Refuses everything**, or reads no trust for the fixture: the 30d test fails at "the check run started", with the
  refusal's text; a refusal for trust names neither `deadline` nor the value, so the five fail too.
- **Starts, then stops at once**: fails "a run started for a check with deadline: …" whatever its message names.
- **Never stops the run**: fails "no run.finished within 120 s of real time once 30 days passed".

A hub that gives a check with no `deadline:` a deadline of its own failed the original's seventh test. Under #2073 that
hub is right, and no test here reads it.

## On the base

`BASE-RESULTS.txt` holds the runs at `1c4d1f0e2` on November 13, 2026, on a heavily loaded Mac. The base asks no trust and
runs `deep_run` in the live worktree, as you, with `/bin/sh`; the fixture is trusted and unchanged since the claim, so
each test gives what its original's expectation says: 6 of 6 pass in 24.9 s, the 30d test in 19.9 s and each refusal test
in under a second. The type check is clean. Three runs of the file: the first INCONCLUSIVE for the 30d test (The fake
clock's steps), the second and third 6 of 6.

No implementation of #2073 exists here, so the passing side under #2073 is unverified. The nearest the base has was run
by hand: the 30d test with its `deep_run` call replaced by a run the hub starts as a claim's checks run (`run.start`
with `command`, through the command check kind, in a folder holding `hold.mjs`) passes, every reading of it, in 23.6 s.
What that leaves open for #2073's own run: the trust read, the temporary checkout of the claim's commit, and that the
check's deadline is held by a timer of the hub's own thread, which the fake clock can reach, as it is on the base.

## Run it

With Node 24.22.0 first on `PATH`, `git`, and the checkout built (`npm ci`, `npm run build --workspaces`,
`cargo build -p deep-hook`), from the checkout's root:

```sh
node node_modules/vitest/vitest.mjs run tests/acceptance/822-redraft-2073/hub.test.ts --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/822-redraft-2073/tsconfig.json
```

About 25 s. The file builds nothing: a missing hub build is BLOCKED, naming the command, and a missing deep-hook fails
the core's start, naming its build, which reads as BLOCKED too. Every folder is under `/tmp/dh822-*` and is
removed after the file; `HOME` is a temp folder for the test process and every child; a process is stopped only by the
process group its own run recorded, or by stopping the core that started it. No network, no model, no sign-in.

## At merge

The frozen `tests/acceptance/822/hub.test.ts` stays as written, to be run by hand only. The owner's call is to swap this
file in for it, and to keep the rest of `tests/acceptance/822/` as it stands. `scripts/lanes.mjs` lists
`tests/acceptance/822/` on none of its one-at-a-time, timed or slow lists, and this file needs none of them: it runs in
25 s, opens no socket and no port, and a wait that runs out under load reads INCONCLUSIVE, never a result.
