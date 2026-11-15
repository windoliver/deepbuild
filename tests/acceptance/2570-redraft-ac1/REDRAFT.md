# Blind redraft of #2570's first criterion: `deep hub start` beside a hub that is still exiting

Criterion `#2570.0ed54a91`: "`deep hub start` asked for while a stopped hub's process is still exiting ends with a
hub answering, exit 0". This is a second, independent draft of its tests. It stands beside the first draft in
`tests/acceptance/2570/` and changes no file there. The first draft's criterion-2 tests (`start.test.mjs`) are not
copied; they stay where they are.

## What I read

- Issue #2570 (text, Scope, criteria, Proof, its one comment), and #2330, #2565 and #1334 only as it names them.
- `docs/technical-design.md`: How it installs (Installs and updates, The hub, Platforms), Proven on the base,
  Dogfooding; and `AGENTS.md` (Proof).
- The base `51e4a2b34`, through `a280f89d7` (the base plus the first draft's folder, no product file changed), only
  for how its surfaces are driven: `packages/hub/src/service.ts` (`startHub`, `stopHub`, `launch`,
  `DEEP_HUB_LAUNCHER`, the login service's definition), `server.ts` (`runHub`, `Hub.stop`, `Hub.exit`, the core's
  worker), `lock.ts`, `paths.ts`, the `stop` in `promote.ts` the issue points at, the CLI's usage of `deep hub`.
- The first draft: its README, `helpers.mjs`, both fixtures, both test files and `BASE-FAILURE.txt`.

I saw no implementation, diff, pull request, other branch, other worktree or other job's notes.

## How to run

```sh
npm ci --no-audit --no-fund && npm run build --workspaces --if-present   # the deep CLI and the hub
cargo build --locked -p deep-hook       # a hub's core stops at its start without a built deep-hook
node --test --test-concurrency=1 tests/acceptance/2570-redraft-ac1/exiting.test.mjs
node tests/acceptance/2570-redraft-ac1/probe-hold.mjs                    # the scene's limits, no start involved
```

Four tests in one file, offline, about 60 s at the base. Each test starts hubs of its own in a sandbox under
`/tmp/d2570-*` with its own `HOME`, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list; the
implementer adds it. Written and run on Linux arm64 only.

| Test | At the base |
| --- | --- |
| `#2570.0ed54a91` a dev hub: `deep hub start --root` beside the exiting hub | fails, exit 3, no hub answers |
| `#2570.0ed54a91` the installed hub: `deep hub start` beside the exiting job | fails, exit 3, no hub answers |
| `scene:` a dev hub kept exiting for the longest hold, no start asked for | passes |
| `scene:` the installed hub's job kept exiting for the longest hold, no start asked for | passes |

## The two criterion tests

1. `deep hub start` starts a real hub (with `--root`, or the installed hub through the service manager's stand-in
   behind `DEEP_HUB_LAUNCHER`), and `deep hub status` names its pid.
2. The hub is told to stop (`deep hub stop --root`; for the installed hub the `hub.stop` call that command makes).
3. The test waits for the hub's `held` line, and checks that its process runs and that it no longer answers.
4. `deep hub start` is asked for. The old hub is let go once the start has acted beside it (below).
5. Asserted, in this order: the start ends with exit 0; a hub answers on the root's socket; `deep hub status` names a
   new pid; that pid is a running hub; the old hub was still exiting when the test let it go; the old hub ended by
   its own exit, code 0. For the installed hub also: the stand-in saw the old job end with exit 0 and no signal, the
   answering hub is a job the stand-in started, and nothing called `launchctl` or `systemctl`. For the dev hub also:
   the stand-in was never asked, and nothing called `launchctl` or `systemctl`.

## How the scene keeps the hub exiting

The old hub is a real hub, so whatever a fix looks at to find an exiting hub (its process, its lock, its log) is
there. `fixtures/slow-stop.mjs` is loaded into the sandbox's Node processes with `NODE_OPTIONS=--import`.

- The base's `Hub.stop` closes the socket, closes its connections, then sends its core (a worker thread) the message
  `{ op: 'stop' }` and waits for the answer before it removes its socket, drops the lock and exits 0.
- In the one hub the test has armed, the fixture keeps that one message back, writes `held`, and sends the message
  on, unchanged, when the test writes the file `go`. That is all it does to the hub.
- So the held hub is a hub whose core is slow to stop, which is the window the issue describes: the socket is
  closed and gone, the process runs, the root's lock is held. Its event loop is never stopped: its timers, its
  signal handlers, its core and its own 20 s limit all run as in any hub.
- No product file is changed and no product seam is used. The base has no seam for this, so nothing is BLOCKED.

**When the old hub is let go.** The start has acted beside the old hub when it asked the service manager (a line of
the stand-in's log), when a hub it started has ended (the fixture's `exit` line), or when the command has ended.
The test lets the old hub go at the first of these. A start that does none of them is waiting for the old hub: it
gets `QUIET_MS` (6 s), counted from the moment its own process runs (the fixture's `start-command` line, not from
the spawn), and then the old hub is let go. The old hub is never held past `MAX_HELD_MS` (12 s) from its `held`
line; if that comes first, the test fails as the scene's own step ("this machine was too slow"), never as the
criterion.

**Why this is deterministic.** Before the start is spawned, and again when the old hub is let go, the test checks
that the old hub's process runs, that it wrote no exit line and that it was not let go. Every wait is on a line in a
file or on a process ending. At the base the outcome hangs on an event: both base runs let the old hub go because
the start had acted (after 464 ms and 75 ms held), then waited out the start's own 15 s.

One limit remains, and it can only make the base pass, never a correct start fail: a base `deep hub start` whose
process is running but takes over 6 s to reach its first act. Here that took 0.1 to 0.5 s at loads of 18 to 28.

## Why the scene is valid: its limits, with no start involved

`probe-hold.mjs` never calls `deep hub start`. It starts each hub directly, stops it, keeps it exiting for a set
time and lets it go. At the base (`BASE-FAILURE.txt`, part 1, with the raw lines):

| Held (ms) | Dev hub ended | Installed job ended | Log after the ready line |
| --- | --- | --- | --- |
| 0 | own exit 0 at 1406 ms | own exit 0 at 1717 ms; stand-in: exit 0, no signal | none (stopped before the line) |
| 1000 | own exit 0 at 1085 ms | own exit 0 at 1082 ms; exit 0, no signal | nothing |
| 3000 | own exit 0 at 5616 ms | own exit 0 at 5036 ms; exit 0, no signal | nothing |
| 6000 | own exit 0 at 6084 ms | own exit 0 at 6080 ms; exit 0, no signal | nothing |
| 9000 | own exit 0 at 9441 ms | own exit 0 at 9568 ms; exit 0, no signal | nothing |
| 12000, the longest | own exit 0 at 13988 ms | own exit 0 at 14028 ms; exit 0, no signal | nothing |
| 15000 | own exit 0 at 16075 ms | own exit 0 at 15996 ms; exit 0, no signal | nothing |
| 18000 | own exit 0 at 20912 ms | own exit 0 at 20797 ms; exit 0, no signal | `the core took over 20 s to stop` |
| 19500 | own exit 0 at 20104 ms | own exit 0 at 20313 ms; exit 0, no signal | `the core took over 20 s to stop` |
| 22000 asked | own exit 0 at 20016 ms, by itself | own exit 0 at 20012 ms, by itself | the same line |
| 26000 asked | own exit 0 at 20022 ms, by itself | own exit 0 at 20014 ms, by itself | the same line |

What I found:

- At every duration the old hub ended by its own exit with code 0, never by a signal, and the stand-in saw exit 0,
  no signal, and started no second job. No duration gave another exit code or another line in the log.
- The base's hub gives its core 20 s to stop. Past that it writes `the core took over 20 s to stop` and exits 0 by
  itself, so no scene of this kind can keep a hub exiting longer than 20 s.
- Once let go, the core took 0.04 to 2.6 s to stop on this loaded machine. So a hub let go at 18 s or later can
  reach the 20 s first: still exit 0, with that line in its log.
- I set the longest hold to 12 s, so the scene stays in the range where the log has nothing after the ready line,
  with room for a slow core. Nothing had to change after the probe: the scene held at every time it can reach, and
  at every time past it up to the hub's own limit.
- A start that simply waits does one thing when the old hub is gone: it starts a hub. With `--then-start` the probe
  runs `deep hub start` only after the old hub's process is gone, after holds of 12 s and 19.5 s: exit 0, a hub
  answers, a new pid, for both kinds.

The two `scene:` tests repeat the 12 s row inside the suite, with the old hub started by `deep hub start` as in the
criterion tests and no second start. They pass at the base. If they fail on a change, the scene is no longer valid
there and a failure of the criterion tests proves nothing until that is sorted out.

## What differs from the first draft, and what is kept

Kept, as the first draft asserts them: the start's exit 0; a hub answers; it is a new hub; the old hub was not
stopped by the start (still exiting when let go, own exit 0, the stand-in saw exit 0 and no signal); nothing called
`launchctl` or `systemctl`. Also kept: the old hub is a real hub; the old hub is let go on the start's first act;
the first draft's sandbox, service manager stand-in (`fixtures/launcher.mjs`) and `deep hub` helpers, imported
unchanged from `../2570/helpers.mjs`.

Different:

- **How the hub is kept exiting.** The first draft stops the hub's main thread on a read of a FIFO, inside the close
  of its listener. This draft keeps back the one message that asks the core to stop, and the hub's event loop runs
  on. The held hub then differs from an unheld one in one thing only, the time its core takes to stop.
- **The hold has a proven limit.** 12 s at most, proven with no start involved up to and past it (above). The first
  draft's `BASE-FAILURE.txt` has no such run.
- **The wait for a quiet start** is 6 s from the moment the start's process runs, not 5 s from its spawn, and the
  test says so when a slow machine uses up the hold instead of passing or failing on it.
- **Asserted in addition:** the answering pid is a running hub; the installed hub answering is a job the service
  manager started; a dev hub's start never asks the service manager.
- **Two `scene:` tests** and `probe-hold.mjs`, which the first draft has no counterpart for.

## Planted wrong programs

No implementation exists and no twin file is written. Each program below names the assertion it must fail on. The
first five were also run here, by a few lines added to the fixture for the run only and removed before the commit
(`BASE-FAILURE.txt`, part 3); the implementer plants them in the product and records the runs.

| Wrong program | Must fail on | Run here |
| --- | --- | --- |
| The base: asks for the start at once | both tests, "must end with exit 0", exit 3 | yes, fails |
| Returns 0 beside an exiting hub, no hub answering | both tests, "exited 0, and no hub answers" | yes, fails |
| Stops the old hub with SIGKILL, then starts one | both tests, "must be left to finish its own exit" | yes, fails |
| Guards only a dev hub | the installed hub's test, "must end with exit 0" | yes, fails |
| Guards only the installed hub | the dev hub's test, "must end with exit 0" | yes, fails |
| Waits for the old hub's exit, then returns 0 without starting one | "exited 0, and no hub answers" | no |
| Answers with the old hub (never stops waiting on its socket) | "must be a new one" or exit 3 | no |
| Starts the installed hub itself, not as the service manager's job | "must be the job the service manager started" | no |
| Hands a dev hub to the service manager | "must not ask the service manager for a dev hub" | no |

A start that waits until the old hub's process is gone and then starts as the base does passes both tests (run
here the same way).

## Not done here

- Not run on macOS, and not against real launchd or systemd: every installed-hub run uses the stand-in. The issue's
  Scope question and its Mac run stay open.
- The base run was made in this job's worktree at `a280f89d7` with only this folder added, not in a fresh temporary
  checkout.
- The first draft's hold was not probed; nothing here says whether it is valid.
