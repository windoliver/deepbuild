# Blind redraft of #2570's acceptance tests: the installed hub

This draft covers the **installed hub**: plain `deep hub start`, no `--root`, run as a per-user service under the
service manager. The dev hub (`--root`) is another draft's.

## What I read

- Issue #2570 and its one comment (`gh issue view 2570 --comments`), nothing more of the issues it names.
- `AGENTS.md`. I did not read `docs/technical-design.md`: the issue and the base's source were enough for these
  surfaces. That is a gap a reviewer may want closed.
- The base `ed03dc60d` source: `packages/hub/src/service.ts` (`startHub`, `launch`, the `DEEP_HUB_LAUNCHER` seam,
  `control`, `waitForStop`, the login service's definition), `hub-command.ts`, `paths.ts` (`installedRoot`,
  `installedPrograms`, `rootOf`), `server.ts` (`Hub.stop`, `exit`, `runHub`, `hub.health`), `lock.ts`, `promote.ts`
  (its `stop`), `wire.ts`, `packages/cli/src/main.ts`, and `scripts/proof-change.mjs` (`criterionId`).
- For conventions only: `tests/acceptance/1334/` (README, `helpers.mjs`, `fixtures/launcher.mjs`) and
  `tests/acceptance/16/fixtures/launcher.mjs`. Nothing is imported from them.

I read no other branch, PR, worktree, scratchpad or #2570 test folder.

## Criteria and tests

| ID | Criterion | Test |
|---|---|---|
| `#2570.0ed54a91` | `deep hub start` asked for while a stopped hub's process is still exiting ends with a hub answering, exit 0 | `exiting.test.mjs` |
| `#2570.03ae960a` | With no hub and none exiting it starts one as today; a hub that never answers still fails at 15 s with today's message and exit 3 | `start.test.mjs`, two tests |
| `#2570.1d553870` | #1334's crash case reaches "one notice, never twice" after its restart (its redraft under #2565) | not here: #1334's own suite proves it (see Limits) |

The IDs come from the issue's text the way `scripts/proof-change.mjs` derives them; `helpers.mjs` derives them again
from the criteria's text, so a test's name carries its ID.

## How to run

```sh
npm ci --no-audit --no-fund && npm run build --workspaces --if-present   # the deep CLI and the hub
cargo build --locked -p deep-hook                                         # the hub's core needs it
node --test --test-concurrency=1 'tests/acceptance/2570-redraft-4/*.test.mjs'
```

Node 24.22 (`.node-version`). Three tests, about 1 to 2 minutes in all; each starts hubs of its own and times the
CLI, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list (`alone`). I left `lanes.mjs` alone.

## The scene

**Real components.** This checkout's built `deep` CLI (`packages/cli/dist/main.js`) runs `deep hub start` and
`deep hub status`; the service definition it writes runs the real `deep hub run`, the real hub with its real core.
The tests speak the hub's socket as the CLI does (hello, the CLI's token, `hub.health`, `hub.stop`).

**The sandbox.** Each test gets `/tmp/b2570-*/`: HOME, TMPDIR and XDG_* inside it, PATH limited to a `bin/` of its own
and the system folders. Nothing is written to the real `~/.deepbuild`, `~/.config/systemd` or `~/Library/LaunchAgents`.
Every test ends by checking that tripwire `launchctl` and `systemctl` on PATH (they log any call and exit 1) were
never called, and that the real home's hub unit and plist didn't change. At the end the test stops every process it
started, by PID, as a group: the CLI runs, the stand-in's supervisor and every job it started. Then it removes the sandbox.

**The service manager's stand-in** (`fixtures/service-manager.mjs`), behind the base's own seam: `launch(file)` runs
`$DEEP_HUB_LAUNCHER <definition file>` in place of `launchctl` or `systemctl`. It models what the issue says both do:
the first call loads the definition into a supervisor, which starts the job; a later call asks the supervisor to
start the job, which starts it if it isn't running and **does nothing if it is**; a job that exits 0 stays stopped
until a call starts it (the definition's `Restart=on-failure`, launchd's `KeepAlive`/`SuccessfulExit false`); one that
fails is started again after 2 s. It starts the program the definition names, with its environment. Each call, ask
(with whether the job was running), start and exit is a line of `sm/events.jsonl`.

**How a stopped hub is "still exiting".** The stand-in starts the job with a preload, `fixtures/job.mjs`, through
`NODE_OPTIONS` (dropped from the hub's own environment so nothing it starts carries it). It doesn't change the hub's
code. With `exitMs` set in the scene's behaviour file, the hub's process stays alive for that long in its `exit`
event, after the hub itself has closed its server, removed its socket and released its lock, and then ends with the
hub's own exit code, 0. The job's PID is the hub's PID, the one `hub.health` reports. AC1 uses 12 s.

**What stops the old hub.** The test does, not a CLI command. It sends `hub.stop` on the socket, reads the
`{stopping: true}` reply and closes the connection without waiting for the process. This is the "stop, then start at once"
the issue's #1334 scene makes. (`deep hub stop` of the installed hub needs the OS to confirm you, and the base's
`control` waits for the requester connection to close, which it does only when the process ends. So no scene step
depends on a CLI command returning while the hub's process runs.) The test waits for the socket to go quiet
(ENOENT or ECONNREFUSED), checks that the old PID still runs, and runs `deep hub start`.

At the base, the events show the issue's picture exactly: the stand-in is asked about 0.2 s after `deep hub start`
begins, while the job is running. The old process begins its exit about 0.3 s later (it was still in its core's stop),
then exits 0 at about 12.5 s and stays stopped. `deep hub start` fails at 15 s, exit 3.

**A hub that never answers.** With `neverAnswers` set, the preload never lets the hub's program run: the process stays
up and never listens.

**Load.** The machine ran at a 1-minute load of 200 to 235 on 20 cores. Every test first times `deep hub status` with no
hub (the probe: a deep command's start and end). A judgement that the machine's speed could decide reads
`INCONCLUSIVE: …`, naming the load, never PASS or FAIL:
- AC1, when the probe takes over a third of the 12 s linger, when the old process ended before `deep hub start` was
  spawned, or when it was gone by the time the socket went quiet;
- AC2's "as today", when `deep hub start` asked the service manager later than twice the probe plus 3 s and the probe
  itself took over 3 s;
- AC2's "at 15 s", when it ended later than 15 s plus the larger of 5 s and twice the probe, and the probe took over 2.5 s.

## What each test checks

- `exiting.test.mjs` (AC1): first start exits 0 with a hub answering, and the stand-in's job is the hub's PID. Then
  stop, quiet, old PID alive, `deep hub start`. It must exit 0, a hub must answer with a new start ID and a new PID,
  and the old process must be gone. **Fails at the base.**
- `start.test.mjs`, "starts one as today" (AC2, first half): in a home that never had a hub, and again after a hub
  stopped and its process ended, `deep hub start` exits 0, a hub answers (a new one the second time), and it asked the
  service manager without waiting first (bound: twice the probe plus 3 s). Today's behaviour, so **passes at the base**.
- `start.test.mjs`, "never answers" (AC2, second half): exit 3, stderr exactly
  `deep hub start: no hub answered at unix:<sandbox>/h/.deepbuild/hub.sock within 15 s; see <sandbox>/h/.deepbuild/logs/hub.log`,
  ending no sooner than 15 s after the stand-in's call and no later than the bound above. Today's behaviour, so
  **passes at the base**.

## Results: base, twin and mutants

I planted each one by editing `packages/hub/dist/service.js` and `server.js` in place and restored them from saved copies. After
each, `cmp` against the saved copies matched. None of it is committed.

- **Twin** (the fix as the issue scopes it, as `deep hub promote`'s `stop` does): the hub writes its PID to
  `~/.deepbuild/hub.pid` once it holds its lock. `deep hub start` with no hub answering reads it and waits, up to 30 s,
  while that PID runs, then asks the service manager.
- **M1** the twin, its wait capped at 1 s. **M2** the twin, waiting 20 s whenever a PID file is there, whether or not
  its process runs. **M3** `WAIT_MS` 30 s instead of 15 s. **M4** the 15 s failure exits 1 instead of 3.

| Test | Base `ed03dc60d` | Twin | M1 short wait | M2 waits for the dead | M3 wait 30 s | M4 exit 1 |
|---|---|---|---|---|---|---|
| AC1 still exiting | **FAIL**: exit 3 after 15.3 s, "no hub answered … within 15 s"; stand-in asked while running, old job exited 0 at +12.6 s | PASS | FAIL (exit 3) | PASS | FAIL (exit 3 after 30 s) | FAIL (exit 1) |
| AC2 starts as today | PASS | PASS | PASS | FAIL: waited 21 159 ms before asking (bound 3 932 ms) | PASS | PASS |
| AC2 never answers | PASS | PASS | PASS | PASS | FAIL: message says "within 30 s" | FAIL: exit 1 |

The real output at the base is in `BASE-FAILURE.txt`. AC1 fails at the base for the reason the issue names. AC2's two
tests describe today's behaviour and pass at the base; M2, M3 and M4 show that each fails on a wrong program as AC2
names it.

## Limits

- **The stand-in, not real launchd or systemd.** The issue's Proof asks for one run on the reference Mac against
  real launchd. That is not done here, and this folder cannot do it: it never touches the real service manager.
- **What the scene can judge.** The base's seam is one command, `$DEEP_HUB_LAUNCHER <definition file>`, with no way
  to ask whether the job runs. So the scene judges a fix that learns of the exiting process from the hub (its PID, read
  while it answered or from a file it leaves, or the process table), or one that asks again. A fix that asks the real
  `launchctl print` or `systemctl show` whether the job still runs reaches the tripwires here, so this scene cannot
  judge it. A dispute goes to a blind redraft.
- **Where the linger sits.** The preload delays the process's end after the hub released its lock, so a fix that
  waits only for the lock fails here. The base's own picture has the same order: `exit()` releases the lock before
  `process.exit`. A fix that waits for the lock alone would also miss the earlier gap, from `server.close()` to `exit()`.
- **AC3 (`#2570.1d553870`)** is about #1334's crash case after its redraft under #2565. Its proof is that suite's own
  run, `tests/acceptance/1334/crash.test.mjs`, after the fix. This folder doesn't wrap it, and I didn't run it.
- **Unrelated finding.** At the base, `deep hub start` exits 0 as soon as the socket says hello. A `hub.health` asked
  right then can be refused with `unavailable`, retryable, `Cannot read properties of undefined (reading 'raw')`: the
  record isn't open yet. The helpers ask a retryable refusal again. This isn't #2570's.
