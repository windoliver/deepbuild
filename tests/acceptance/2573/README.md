# Acceptance tests for #2573: a hub stopped just after its start, whose exit is then held

Written first, blind, from issue #2573 (`gh issue view 2573 --repo windoliver/deepbuild --comments`), the design
(`docs/technical-design.md`: How it installs, Dogfooding, Proven on the base), `AGENTS.md` and base commit
`abf74b4ee`, by a job that never saw an implementation of #2573, a diff, a pull request, another branch or another
job's notes. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of
this job (design: Dogfooding).

## What was read

- The issue, its Scope, Acceptance criteria and Proof, and its comment, which narrows the failure to a stop that
  reaches the hub soon after its start, and reads criterion 1 as "a hub stopped as soon as it answers after its start,
  whose exit is then held 10 s".
- At the base, only for how its surfaces are driven: `packages/hub/src/server.ts` (`runHub`, `Hub.stop`, `exit`,
  `fatal`, the `hub.stop` method, the hello and the control token), `packages/hub/src/core-worker.ts` (how the core's
  start failure reaches the hub as `fatal`), `packages/hub/src/core.ts` (the start, `ready`, the evidence store),
  `packages/hub/src/paths.ts` (where the evidence folder is), `packages/hub/src/plant.ts` (the plants: none makes a
  core fail, so none is used), `scripts/proof-change.mjs` (`criterionId`) and `scripts/lanes.mjs`.
- `tests/acceptance/509-oracle/README.md`, for form only. No other suite's helpers are imported.

## Run

```sh
export PATH=/var/tmp/deep40/node/bin:$PATH        # node 24
npm ci --no-audit --no-fund                       # once, if node_modules is missing
npm run build --workspaces --if-present           # the hub runs from packages/*/dist
cargo build --locked -q -p deep-hook              # the hub's core needs target/debug/deep-hook
node node_modules/vitest/vitest.mjs run tests/acceptance/2573/
node node_modules/typescript/bin/tsc -p tests/acceptance/2573/tsconfig.json   # type-check
```

The suite takes about 2 minutes (four early plays of about 11 s, one late play of about 35 s, one failing start). Its
timing matters, so it should run alone: `scripts/lanes.mjs` needs `'tests/acceptance/2573/'` in its `alone` list.
This job writes only this folder, so that line is left to the change that implements #2573.

Each test makes its own sandbox under `/tmp/d2573-XXXXXX` (socket paths stay short) with a HOME of its own, starts
only a dev hub (`--root`, no service manager), and after the test stops any hub still running by the PID it started
and removes the sandbox.

## The hub and the stop

`helpers.ts` starts `deep hub run --root <sandbox>/r` the way `deep hub start --root` starts it: its own session,
stdout and stderr appended to `<root>/logs/hub.log`. It waits for the hub to answer on `<root>/hub.sock` (its hello
line, which the hub sends from the moment its socket exists, before its core has started), says hello as `cli` with the
root's `control.token`, makes the `hub.stop` call, and checks the hub answered `stopping: true`. Then it reads the
process's exit code and `hub.log`.

- **early**: `hub.stop` is sent on the very connection that first got the hello: the hub is stopped as soon as it
  answers after its start.
- **late**: the hub's `"ready":true` line is in hub.log and 20 s have passed since it first answered, then `hub.stop`.

## The hold

`hold.mjs` is loaded into the hub's process with `NODE_OPTIONS=--import=<hold.mjs>`. No product file changes and the
product has no seam for it. It acts only in the main thread of `deep hub run`, and only when the test sets
`D2573_HOLD_MS` and `D2573_MARK`. It wraps `Worker.prototype.postMessage`: the first time the hub posts `{ op: 'stop' }`
to its core's worker thread (which `Hub.stop` does after it closed its socket and dropped its connections), the
message goes, the hold appends a `held` line to the marker file, blocks the main thread with `Atomics.wait` for
`D2573_HOLD_MS`, then appends a `released` line and lets the hub go on. The core's thread keeps running and stops the
core meanwhile; only the hub's exit waits. That is the hold the issue's probe used ("the hub's main thread blocked
10 s after `hub.stop` closed the socket and told the core to stop").

The test waits on events: the hello on the socket, the `ready` line in hub.log (late only), the `held` line in the
marker file and the process's exit. The only timed wait is the hold's own 10 s, and the late scene's 20 s. Each test
also checks the hold lasted at least 10 s (`released` minus `held`), so a hold that let go early is BLOCKED, never a
pass.

## Tests and criteria

Criterion IDs are `#<issue>.<first 8 hex of sha256 of the criterion's text, spaces folded>`, as `criterionId` in
`scripts/proof-change.mjs` makes them.

Each test in `held-stop.test.ts`, its criterion, and what it does at the base:

- `#2573.ac0329fc stopped as soon as it answers after its start and held 10 s, ...` (4 plays). Criterion 1: a hub
  whose exit is held 10 s after `hub.stop()` ends with exit 0, and its log holds no `The database connection is not
  open`. At the base it FAILS: exit codes `[1, 1, 1, 1]`, and the log lines.
- `#2573.ac0329fc control: stopped 20 s after its start, ...`. Criterion 1, the scene's control: the hold alone does
  not cause the failure. Passes at the base.
- `#2573.4982dfe8 a core that cannot open its evidence store ends the hub with exit 1 ...`. Criterion 2: a core that
  stops by a real failure still ends the hub with exit 1 and `the core stopped`. Passes at the base (pins today's
  behavior).

Criterion 1's test asserts each play's exit code is 0 and that no line of any play's hub.log holds `The database
connection is not open`, as two soft assertions so both show. Its failure message names each play's exit code and
count of such lines.

Criterion 2's real failure: before the hub starts, `<root>/evidence` (the evidence store's folder, `paths.ts`) is made
a plain file. The core's start then can't open its evidence store, the worker posts `fatal`, and the hub writes
`deep hub: the core stopped: ...` and exits 1. No plant or seam is used: the plants in `plant.ts` are wrong programs for
other issues, and none makes a core fail. The test checks exit code 1 and a hub.log line starting
`deep hub: the core stopped:` that names the evidence folder.

## The arithmetic

Single early plays at the base (`abf74b4ee`), one at a time, each a fresh hub stopped on its first answer and held
10 s, on this shared Linux arm64 machine at load 100 to 320 on 20 cores:

| Play | Local time (PST) | Load | Exit code | Held | hub.log lines with `The database connection is not open` |
|---|---|---|---|---|---|
| 1 | 23:12:42 | 126 | 1 | 10.000 s | `archive:`, `archive index:`, `the core stopped: TypeError:` |
| 2 | 23:13:53 | 183 | 1 | 10.001 s | the same three |
| 3 | 23:15:04 | 152 | 1 | 10.002 s | the same three |
| 4 | 23:16:15 | 160 | 1 | 10.000 s | the same three |
| 5 | 23:17:26 | 177 | 1 | 10.006 s | the same three |
| 6 | 23:18:37 | 196 | 1 | 10.000 s | the same three |
| 7 | 23:19:48 | 214 | 1 | 10.001 s | the same three |
| 8 | 23:20:59 | 320 | 1 | 10.000 s | the same three |
| 9 | 23:22:11 | 306 | 1 | 10.004 s | `the core stopped: TypeError:` only |
| 10 | 23:23:25 | 288 | 1 | 10.000 s | the same three as play 1 |
| 11 | 00:04:45 | 101 | 1 | 10.000 s | the same three (under a 24 GB memory cap) |
| 12 | 00:04:56 | 105 | 1 | 10.000 s | the same three (under a 24 GB memory cap) |

Every play ended with exit 1 and the issue's line `deep hub: the core stopped: TypeError: The database connection
is not open`: 12 failures in 12. One late play (stopped 20 s after its first answer, once ready, held 10 s) at 00:05:07
ended with exit 0 and no such line. A machine-wide out-of-memory kill at 07:24 UTC (23:24 PST) came after play 10 had
printed its result; plays 11 and 12 were run afterwards under a memory cap and agree.

The issue's own table saw the failure in 3 runs of 4. Taking the issue's 3 in 4 as the per-play chance (lower than
any estimate from the plays above), a broken hub passes one play with chance at most 1/4, and passes all of the
test's 4 independent plays with chance at most (1/4)^4 = 1/256, about 0.4 %. So a run of the test at the base fails
at least 99.6 times in 100 by these numbers, above the 99 asked. From the plays above alone, 12 failures in 12 put the
per-play chance of failing at 0.78 or more with 95 % confidence (0.05^(1/12) = 0.78); then a run passes with chance at
most 0.22^4 = 0.0024, the same order. Four plays keep the test near 45 s; more would buy little.

## Wrong programs

Planted wrong programs for the implementation, and the test each must fail on (no twin files are written here):

- The base itself (`abf74b4ee`): must fail `#2573.ac0329fc stopped as soon as it answers ...` (exit 1, the log
  lines).
- A hub that swallows every core failure and always exits 0 (its `fatal` writes the line but exits 0): must fail
  `#2573.4982dfe8 ...` (exit 0, not 1).
- A hub that drops the `the core stopped` line but still exits 1: must fail `#2573.4982dfe8 ...`.
- A core that clears its timers only when stopped late (after its start finished), leaving the ones its start arms
  after an early stop: must fail `#2573.ac0329fc stopped as soon as it answers ...`.
- A hub that catches the work pass's rejection while the archive's timers still read the closed record: must fail
  `#2573.ac0329fc stopped as soon as it answers ...` (the `archive: The database connection is not open` lines).

## Proof on the base

`BASE-FAILURE.txt` holds the command and output of the suite at the base: criterion 1's test fails at its named
assertion with exit codes 1 and the log lines, the control and criterion 2's test pass.
