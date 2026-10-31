# Acceptance tests for #822: a runner job's deadline past 24.8 days stops it at once, and a deadline of 0 means none

Written first, blind, from issue #822 (its title, What happens on main, the three acceptance criteria and Proof),
`docs/technical-design.md` (Blocks for plug-ins that do real work, its Runner and Replay and a clock, for tests; How
we know version 0 works, Dogfooding), `AGENTS.md`, the acceptance tests of #159 and #349 for their conventions, and
the base commit `ff81b0d` (`packages/runner`, `packages/checks-command`, `packages/extension-host`,
`packages/hub/src/server.ts`; for `hub.test.ts`, `packages/hub/src/core.ts`, `wire.ts`, `hookmap.ts`, `children.ts`,
`paths.ts`, `tools.ts` and `@deepbuild/asks`' `duration`, and `tests/acceptance/27/waits.test.ts`, each read as it is at
`ff81b0d`), by a job that never saw an implementation of #822. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

## How to run

On macOS (Seatbelt is the sandbox the supervisor uses), with the repo's Node (`.node-version`, 24.22.0):

```sh
npm ci                                                       # once, if node_modules is missing
node node_modules/typescript/bin/tsc -p packages/hub/tsconfig.json   # hub.test.ts loads the hub's build
node node_modules/vitest/vitest.mjs run tests/acceptance/822
node node_modules/typescript/bin/tsc -p tests/acceptance/822/tsconfig.json
```

- About 25 s, and about 75 s more for `hub.test.ts`. Only `hub.test.ts` needs a build: the hub's own (`packages/hub/dist`,
  which git ignores), since the hub's core reads process start times from a thread it starts from
  `children-worker.js` beside its own module, which only the build writes; without it the test fails BLOCKED, naming
  the build. Nothing needs the network, a real `claude`, a sign-in or a model call.
- Every folder is under `/tmp/dh822-*` (real paths, as Seatbelt matches them) and is removed after its file; `HOME` is
  a temp folder for the test process and every child; the agent's own `CLAUDE*`, `DEEP_*` and `ANTHROPIC_*`
  variables are removed first.
- A process is stopped only by the PID or process group its own run recorded (`helpers.ts`, `own`/`stopOwn`), or by
  closing the runner and supervisor that started it; never by name or port.
- Vitest may write a cache to `tests/acceptance/822/node_modules/.vite/`; delete it before committing.

## The surface under test

The issue names the runner's `deadline_ms` and `output_timeout_ms`, a check's deadline in `checks-command`, and a
call's deadline in the extension host (`within`); the owner added the hub's check-run deadline (open point 4). The
first three are reached through their package's public entry, the fourth through the hub's core; all on real
components:

1. **`@deepbuild/runner`** (`packages/runner/src/index.ts`): `openRunner`, then `submit`, `status`, `wait`, `list`,
   `cancel`, `tick`. It runs on the real record, asks core, budget ledger and supervisor, so a job's process is a real
   one in the platform sandbox: the stand-in `claude` (`helpers.ts`, `standIn`), which answers `--version` as the
   facts' newest version, and as a job reads its prompt, prints one line and runs on for an hour. A window reading
   with room is reported first, so a job that may start starts at once. `job.submit` on the hub's socket
   (`server.ts`) hands the spec to this runner as given, so the runner is where the refusal is tested (Open points 3).
2. **`@deepbuild/checks-command`** (`packages/checks-command/src/index.ts`): `runCommandCheck({ host, run, spec,
   checkout, deadline })`, with the real supervisor as its host@1. The check's command is `node hold.mjs`, a real
   process in the sandbox that runs for an hour and prints nothing. The host is the supervisor seen through a wrapper
   that only counts the starts and signals the check asks for, keeps each process group's ID, and, for the long
   deadline, turns the fake clock on as the process starts, which is where the check arms its deadline.
3. **`@deepbuild/extension-host`** (`packages/extension-host/src/index.ts`): `openExtensionHost`, `install`, `check`,
   `load`, `checks`, `runCheck(kind, spec, { checkout, deadline })`. `ctx.deadline` is the caller's value that reaches
   `within`. The package is `fixtures/waiter`, a first-party package loaded in the hub (its `index.ts.fixture` is
   renamed when copied, so this suite's Vitest and type check don't pick it up): its check runner notes each call in a
   file and never answers, so only the host's deadline can end the run.

4. **The hub's check-run deadline**: the `deadline:` a check gives in the repo's `.deepbuild/done.yaml`, read by the
   hub (`checksOf`, through `@deepbuild/asks`' `duration`) and passed by `deep_run` to its run (`runCheck`, `runStart`,
   `launch`). A real hub process can't be put on a fake clock: its core runs in a worker thread of its own process,
   which this test's timers can't reach, and `CoreOptions.clock` moves only the core's `now`, not its timers. So the
   core runs in the test's own thread: `Core`, the class the hub runs in its worker and inline (`coreInline`), loaded
   from the hub's build (`packages/hub/dist/core.js`, typed by `src/core.ts`), with the injected clock. It isn't the
   hub's public entry (`packages/hub/src/index.ts` exports none), which is why this is said here. Under it everything
   is real: the record, the supervisor and the sandbox, so the check's command (`sh -c 'sleep 3600; : …'`) is a real
   process. The session is met as the hub meets one whose hook it missed: a SessionStart line as deep-hook writes it
   (hook.request on the wire) in the root's spool, which the core replays as it starts, with a transcript under the
   temp HOME's `~/.claude/projects` and this test process as the session's parent. Its deep mcp calls go in as
   `mcp.call` with the session bound, as the server forwards them: `deep_claim`, then `deep_run`. The fake clock is
   turned on once the core has started (so its own per-second timers stay real), before `deep_run`.

**The fake clock** is Vitest's fake timers: `setTimeout`, `setInterval` (and their clears), `Date` and
`performance.now`, all moving with real time too (`shouldAdvanceTime`), so processes, sandboxes and graces still run,
while the test moves days ahead at once (`advance`, a day per step, running each timer that comes due and the work it
queues). The runner's every clock is `Date.now`, so its `now` moves with the timers. A program may read any of these
clocks for a deadline, or count chunks of 2³¹ − 1 ms; all of them move together. Node's limit is kept by the fake
timers too: Vitest's clock sets a delay past 2³¹ − 1 ms to 1 ms, as Node does.

**Readings.**

- *Still running* (runner): `status` says `running` and the job's process is alive. *Waits its full time* (check and
  call): no signal reached the check's process and `runCommandCheck` / `runCheck` hasn't returned.
- *At 30 days*: not ended a minute before 30 days of fake time; ended once 30 days and a minute have passed, within
  30 s of real time: the job `stopped` with cause `timed_out` and its process gone; the check `overran` with its
  exit's cause `deadline`; the call `overran`.
- *Refused before it starts*: `submit` threw, or the job came back `refused`; and the supervisor recorded no process
  under the job's own run (`process.starting` with `run` = the job), and the job never read `running`, `stopping`,
  `stopped` or `finished`. For a check, no start reached the host. For a call, the package's runner was never called.
  A check or call that returns rather than throws must not return `passed` or `overran` (a refusal ran nothing).
- *Naming the field and the value*: the thrown message, or the record's `refused` (runner) or the words of the
  returned result (check, call: every string in it, without the JSON around it), contains the field (`deadline_ms`,
  `output_timeout_ms`; `deadline` for the check and the call) and the value as written (`0`, `-5`, `1.5`, `NaN`,
  `Infinity`) as a token of its own: the `0` in `deadline_ms 0` counts, the `0` in a run ID or `10` doesn't.
- *The hub*: *still running* is no `run.finished` for the run and its process (the leader the supervisor's
  `process.tracked` names) alive; *at 30 days*, `run.finished` with outcome `overran` and the process gone. *Refused
  before the run starts* is no `run.started` for the check and no `run.finished`, and `deep_run`'s refusal (its message
  and every string of its refusal, the value among them) or answer names `deadline` and the value as done.yaml writes
  it (`0m`, `-5m`, `1.5h`, `soon`; `.inf` or `Infinity`, since YAML reads `.inf` as a number); an answer must not read
  `passed`, `overran` or `running`. `deep_run` holds its answer while a run goes; 10 s with no answer counts as no
  refusal.
- *Leaving the field out*: a job with neither field starts and is still running, its process alive, after 60 days.

## Criteria to tests

| Criterion | Test (file › name) | Fails on the base because |
|---|---|---|
| AC1 30-day deadline, still running after 24.8 days, `timed_out` at 30 days, not at its start | `runner.test.ts` › AC1 is still running just after its start and after 24.8 days, and is stopped as timed_out at 30 days, not at its start | the deadline's `setTimeout` gets 2,592,000,000 ms, which Node (and the fake clock) keeps as 1 ms: the job is `stopped`, cause `timed_out`, about 300 ms after it started |
| AC2 `deadline_ms` not a positive whole number is refused before it starts, naming field and value | `runner.test.ts` › AC2 deadline_ms 0 / -5 / 1.5 / NaN / Infinity is refused before the job starts, naming deadline_ms and … | the runner takes every value and the job runs: `0` and `NaN` are falsy, so it runs with no deadline (Proof); `-5`, `1.5` and `Infinity` arm a timer of about 1 ms |
| AC2 `output_timeout_ms` the same | `runner.test.ts` › AC2 output_timeout_ms 0 / -5 / 1.5 / NaN / Infinity is refused … | the runner takes every value and the job runs |
| AC2 a positive whole value is still taken (guards a runner that refuses everything) | `runner.test.ts` › AC2 positive whole deadline_ms and output_timeout_ms are taken: the job starts and runs | passes on the base, which takes them (correct) |
| AC2 leaving the field out still means no deadline | `runner.test.ts` › AC2 a job with neither field is taken and still runs after 60 days on a fake clock | passes on the base (correct) |
| AC3 check's deadline past 2³¹ − 1 ms waits its full time | `checks.test.ts` › AC3 checks-command: a run with a deadline of 30 days is still running after 24.8 days on a fake clock, and ends overran at 30 days | `setTimeout(halt, 30 days)` fires after 1 ms: the run is signalled (`SIGKILL`) at once and ends `overran` |
| AC3 check's deadline not positive is refused, naming it | `checks.test.ts` › AC3 checks-command: deadline 0 / -5 / 1.5 / NaN / Infinity is refused before the check's process starts, naming deadline and … | the check starts its process for every value (`Math.max(1, deadline)`), then ends `overran` |
| AC3 call's deadline (`within`) past 2³¹ − 1 ms waits its full time | `extension.test.ts` › AC3 extension host within: runCheck with a deadline of 30 days hasn't returned after 24.8 days on a fake clock, and returns overran at 30 days | `within` races the call with `setTimeout(reject, 30 days)`, which fires after 1 ms: `runCheck` returns `overran` at once |
| AC3 hub check-run deadline (`deadline: 30d` in done.yaml) waits its full time | `hub.test.ts` › AC3 hub deep_run: a check with deadline: 30d is still running after 24.8 days on a fake clock, and ends overran at 30 days | the run's `setTimeout(stop, 30 days)` fires after 1 ms: the run ends `overran` at its start ("still running at its deadline of 30 days"); in 3 of 7 base runs the stop came before the run's process was tracked and was lost, so the run never ended and the test failed at 30 days instead |
| AC3 hub check-run deadline done.yaml writes that isn't a positive whole number of ms is refused before the run, naming it | `hub.test.ts` › AC3 hub deep_run: a check with deadline: 0m / -5m / 1.5h / soon / .inf is refused before its run starts, naming deadline and … | the hub reads each as no deadline (`duration` gives `0` for `0m` and nothing for the rest) and starts the run, which then runs with none |
| AC3 hub: a check with no `deadline:` still runs with none | `hub.test.ts` › AC3 hub deep_run: a check with no deadline: still runs with none, after 60 days on a fake clock | passes on the base (correct) |
| AC3 call's deadline not positive is refused, naming it | `extension.test.ts` › AC3 extension host within: runCheck with deadline 0 / -5 / 1.5 / NaN / Infinity is refused before the package's runner is called, naming deadline and … | the host calls the package's runner with every value, then returns `overran` |

Proof names two base failures; both are among them: *a 30-day deadline stopping the job at once* (AC1, the record
shows `ran` from start to end in 300 ms and `stop.cause` `timed_out`) and *a deadline of 0 running without one*
(AC2 deadline_ms 0: `the job is running`).

## Base results

`BASE-FAILURE.txt` holds the base run (repo path redacted to `<repo>`, temp folders to `/tmp/dh822-…`): **23 failed,
2 passed** for the first three test files. Appended to it, `hub.test.ts` run against the working tree, whose hub code is
still the base's: **6 failed, 1 passed**. Every criterion test fails for the reason in the table; the three that pass
are the controls the base already gets right (a positive whole value is taken; no field means no deadline; a check
with no `deadline:` runs with none). The type check passes with no errors.

## Wrong programs these fail on

Besides the base, each was run once against throwaway copies of the three packages outside the repo (not kept):

- **A right program** (each value checked with `Number.isSafeInteger(v) && v > 0` before anything starts, the message
  naming the field and `String(v)`; each long timer re-armed in chunks of at most 2³¹ − 1 ms until its due time):
  25 of 25 pass.
- **Clamp only, and a refusal that names no value** (`setTimeout(fn, Math.min(ms, 2 ** 31 - 1))`, the hub's own fix
  for its promise timer; the refusal says "isn't a positive whole number of ms" without the value): 23 fail. The three
  long-deadline tests fail at the 24.8-day reading (stopped, signalled or returned there); every refusal test fails on
  the value. Only the two controls pass.
- **The hub**, against copies of the base's sources (`git archive ff81b0d`) outside the repo, the hub built there:
  a right core (a `deadline:` given that `duration` can't read as a positive duration refused by `deep_run`, naming
  the check, `deadline` and the value as written; the run's timer re-armed in chunks of at most 2³¹ − 1 ms) passes 7
  of 7; clamp only, with a refusal that names no value, fails 6 (the 30d run ends at 24.8 days; every refusal misses
  the value), passing only the no-deadline control.
- **Refuses everything**: AC1, both AC3 long-deadline tests and the AC2 positive control need the value taken and the
  process running; a runner that refuses a job with no deadline fails the AC2 omitted-field test.
- **Starts, then stops at once** (the base's way with a check's `0`): fails the "no process started" / "runner never
  called" reading even where the message would name the value (the base's `ran past its deadline of NaN ms` does).

## Open points

1. **How a refusal is shaped** isn't said. `submit` throwing and a job record in state `refused` both count for the
   runner; for a check and a call, a throw or any returned outcome but `passed` and `overran` counts. Either way the
   text must name the field and the value.
2. **The field's name for a check and a call** is `deadline` (`CommandCheck.deadline`, `runCheck`'s `ctx.deadline`),
   as the code names them; the issue says "a check's deadline" and "a call's deadline".
3. **The hub's `job.submit`** isn't tested through the socket. The issue's Proof names runner tests, and the hub
   passes the spec as given, so the runner's refusal covers both the app and the CLI. Over JSON, `NaN` and `Infinity`
   arrive as `null`, which this suite doesn't cover; the runner's refusal of `null` would be the same rule.
4. **Other timers a caller's value reaches.** The owner ruled the hub's check-run deadline (`deadline:` in done.yaml,
   which `deep_run` passes to its run) in scope for AC3; `hub.test.ts` covers it. Which written values it covers is
   this job's reading of AC2's list in done.yaml's terms: `0m` (zero), `-5m` (a negative), `1.5h` (a fraction), `soon`
   (no number) and `.inf` (infinity); a YAML number such as `deadline: 0` or `deadline: 30` isn't tested. `within` is
   also reached by the hook request's `deadline` (`hook`), but the hub sets that from its own constant
   (`EXTENSION_HOOK_MS`), and by an install kit's case (`ctx.deadline` plus a grace), set by the kit; neither is a
   caller's value, so neither is tested. This job didn't search the rest of the code for other caller-set timers.
   The hub test reaches the core outside the hub's public entry, and loads the hub's build rather than its source
   (The surface under test, 4); once #822's hub part lands, the build must be redone before this file runs.
5. **Large finite values** past 2³¹ − 1 but far beyond 30 days (say `Number.MAX_SAFE_INTEGER`, or `1e300`, which is
   whole but not safe) aren't tested: the issue doesn't say whether they are taken.
6. **Which clock a deadline reads.** `RunnerOptions.now` is "the clock of records, windows, waits and daily counts;
   processes and graces run in real time". The fake clock moves `Date`, `performance.now`, every timer and the runner's
   `now` together, so a fix that reads any of them, or counts chunks, passes; one that reads a clock outside these
   (`process.hrtime`) would not see the 30 days pass.
7. **Unrelated finding (base):** the supervisor can't prove, and so can't stop, a job whose group leader was replaced
   by an `exec` of `/bin/sleep`: `cleanup` leaves it (`run.cleaned` `unfinished`, `left: ["pid:…"]`), the process stays alive and
   the job still read `stopping` 10 s later, without a fake clock too. The stand-in keeps its shell as the leader to stay clear of it. Worth an issue of its own.
8. **Unrelated findings (base, hub):** a check run whose deadline fires before the supervisor tracked its process
   (the sandbox took up to 11 s to start it here) was seen in 3 of 7 runs to keep running with no `run.finished`: the stop
   looks lost, not verified further. And `events.read` builds its next page on a `setImmediate` with no catch, so a
   read just before the core stops rejects unhandled ("The database connection is not open"); the test waits 100 ms
   before stopping the core to stay clear of it.
