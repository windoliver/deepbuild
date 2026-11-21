# Acceptance tests for #2975: a signal to the installed hub is a restart, not a stop

I drafted these tests blind, at base commit `4b6ce2f41` (the head of PR #2969: `hub.restart`, exit 75 and the
OS-confirmed `hub.stop`, with no fix for #2975), from these sources:

- issue #2975, as saved verbatim for this job: its problem, proposed fix, seven criteria and Proof
- `docs/technical-design.md`: Threats, and what stops each one (the rows Agents switching off what watches them, What a
  command's children do, A broken hub), and How it installs (the login service)
- AGENTS.md

At the base I also read the hub's `server.ts` (`RESTART_EXIT`, `RESTART_AFTER_MS`, `hub.stop`, `hub.restart`, `stop()`,
`runHub` and its signal handlers), `service.ts` (the plist and the unit `definition()` writes, the `DEEP_HUB_LAUNCHER`
seam, `startHub`, `removeService`), `setup.ts` (where `deep setup` starts the hub), `authority.ts` (`stopAsYou`),
`confirm.ts` (the `DEEP_HUB_TEST_CONFIRM` stub), `paths.ts` (`installedRoot`, `dropTestSettings`, `underTemp`),
`core.ts` (the `hub.stopped` event and its reason); `scripts/proof-change.mjs` (`criterionId`), `scripts/proof-runs.mjs`
(twins and the at-assertion rule), `docs/parallel-proof.md`; and, for their shape only, `tests/acceptance/1865/` (its
README, launcher stand-in, helpers and twins) and `tests/acceptance/16-redraft-1865/` (how a test reads `hub.stopped`).
The helpers are written here, never imported from another suite. Per AGENTS.md, the implementing agent doesn't edit
these tests; a dispute goes to a blind redraft by this job.

## How to run

```sh
npm ci && npm run build --workspaces       # the deep CLI and the hub the tests start
cargo build --locked -p deep-hook          # target/debug/deep-hook: the hub's core won't start without it
node --test --test-concurrency=1 tests/acceptance/2975/signal.test.mjs     # on Node 24.22; one file at a time
node --test tests/acceptance/2975/dev.test.mjs
node --test tests/acceptance/2975/confirmed.test.mjs
node --test tests/acceptance/2975/definition.test.mjs
```

There are 7 tests in 4 files, all offline. They're `*.test.mjs` under `tests/acceptance/`, so
the unit lane doesn't pick them up. Each test starts hubs of its own in a sandbox of its own, so files can run side by
side; one file at a time keeps each under the 10-minute bound of a background shell on a loaded Mac.

They run real components: this checkout's built `deep` CLI and hub (`deep hub start`, `deep hub stop`, `deep hub run
--root`, and `deep hub run` as the login service runs it), real signals sent by PID to the hub's process (`/bin/kill`
as a process of its own, or the test's `process.kill` where a timing or a window is measured), and the hub's socket:
its hello (the start ID), `hub.health` (the PID) and `events.read` (the record's `hub.stopped` events and their reasons).

### Stand-ins, all at boundaries the repo doesn't own

- **launchd, or systemd, behind the base's `DEEP_HUB_LAUNCHER` seam** (`fixtures/launcher.mjs`). The hub's service code
  runs `$DEEP_HUB_LAUNCHER <definition file>` where it would run `launchctl bootstrap`/`kickstart` (systemd's `enable
  --now`). The first call loads the definition into a supervisor of the stand-in's own and starts the job; a later one
  starts it if it isn't running. The supervisor keeps the job by the restart rule the issue names, **restart unless the
  exit is 0**: an exit other than 0, or a death on a signal, starts the job again 10 s after its last start (launchd's
  `ThrottleInterval`), at least 0.5 s after its exit; an exit 0 leaves it stopped. Each load, start and exit (with its
  code and signal) is a line of its log, which the tests read: that log is how a test sees the installed hub's exit
  code, since the hub is the stand-in's child, not the test's.
- **The OS confirmation**, behind the base's `DEEP_HUB_TEST_CONFIRM` seam, as an executable stub (`confirm` in the
  sandbox's `bin`): it notes each ask in `asks.log` and exits 0 (you confirm) only while `confirm.mode` says
  `confirmed`. Every test starts with it cancelled, so the signalling process holds no confirmation. The launcher
  stand-in passes it into the hub's environment, as the real launchd never would: the stub's one way in.
- **`launchctl` and `systemctl`**, first on `PATH`: each records the call and exits 1. Nothing a test starts reaches the
  real launchd or systemd.

**Every test points `HOME`, `TMPDIR` and `XDG_*` at a temporary folder** under `/tmp/d2975-*` (short, for the 104-byte
socket path), so its installed hub is that sandbox's `~/.deepbuild` hub and its login service's definition is the
sandbox's plist or unit. The sandbox drops every `DEEP_*`, `CLAUDE*`, `CODEX_*`, `GH_*`, `GITHUB_*`, `ANTHROPIC*`,
`OPENAI*`, `AWS_*`, `GIT_*` and `XDG_*` variable, `NODE_OPTIONS` and `NODE_TEST_CONTEXT`; its `PATH` is its own `bin`,
`/usr/bin`, `/bin`, `/usr/sbin`, `/sbin`. Each process a test starts gets its own process group, and at the end the test
stops by PID that group, the stand-in's supervisor and every job it logged starting, then removes the sandbox. Nothing is
killed by name or port. No model is called and no network is used. Assertion messages redact the token and the
sandbox's path.

## Criteria to tests

Each criterion's ID is `#2975.<first 8 hex digits of the SHA-256 of its "- [ ]" text, trimmed, white space collapsed>`,
computed with `criterionId` from `scripts/proof-change.mjs`. Each test's name starts with its tag.

| Criterion | Test (file) | Fails on |
|---|---|---|
| AC1 `#2975.0cab1d79` kill -TERM on the installed root records `signal:SIGTERM`, exits 75, and the login service brings it back with a new PID and start ID | `signal.test.mjs` | the base (exits 0; the stand-in leaves it down) |
| AC2 `#2975.8459f39f` kill -INT likewise: `signal:SIGINT`, exit 75, started again | `signal.test.mjs` | the base (exits 0) |
| AC3 `#2975.20c7734e` a SIGTERM to an installed hub listening 1 s exits within 5 s | `signal.test.mjs` | twin `signal-waits-restart-after` (passes on the base, which exits at once) |
| AC4 `#2975.c596419b` a dev hub (`--root`) still exits 0 on SIGTERM and SIGINT and stays down | `dev.test.mjs` | twin `dev-signal-exits-75` (passes on the base) |
| AC5 `#2975.03961608` a confirmed `deep hub stop` still exits 0 and stays down, with a SIGTERM after the confirmation and before the exit | `confirmed.test.mjs` | twins `signal-75-during-confirmed-stop`, `confirmed-stop-exits-75` (passes on the base) |
| AC6 `#2975.4668c24b` the systemd unit: `Restart=on-failure`, `RestartSec=3`, `SuccessExitStatus=75`, `RestartForceExitStatus=75` | `definition.test.mjs`, the unit test (Linux only) | the base on Linux (no `RestartSec`, `SuccessExitStatus`, `RestartForceExitStatus`); skipped on macOS |
| AC6 `#2975.4668c24b` the plist still has `SuccessfulExit` = `false` | `definition.test.mjs`, the plist test (macOS only) | twin `keepalive-always` (passes on the base) |
| AC7 `#2975.0071134f` by hand on real launchd and systemd --user | none: **hand-checked** | (the PR says `Part of #2975` until it is recorded) |

## Readings where the issue leaves a choice

- **"From a process that holds no confirmation"**: `/bin/kill -<signal> <pid>` run as a process of its own in the
  sandbox, a command's child, with the OS confirmation's stub cancelled. The PID is the one `hub.health` gave.
- **"Records a stop with reason `signal:SIGTERM`"**: once the hub is back, `events.read` holds exactly one `hub.stopped`
  event since the first hub started, with that reason (so no second stop, no `crashed`, no `requested`).
- **"Exits 75"**: the exit code the login service's stand-in saw for that PID (75, and no signal).
- **"Answers `hub.health` again with a new PID and a new start ID"**: a hello with another start ID, then `hub.health`
  with another PID, within 90 s of the exit (the stand-in's 10 s throttle plus a start under heavy load), and the
  stand-in's log shows it started that PID. The criterion gives no bound; AC7 by hand has 30 s.
- **"Listening for 1 s" and "exits within 5 s"** (AC3): from the hub's first hello after `deep hub start` (the socket
  listening; its core may still be starting) the test waits 1 s, sends SIGTERM by PID, and times until the PID no longer
  runs or the stand-in logged its exit, whichever is first. It doesn't check the exit code, which AC1 does.
- **"A dev hub started with `--root`"** (AC4): `deep hub run --root <folder>`, the program `deep hub start --root`
  spawns, run as the test's own child so its exit status is seen (a hub that `deep hub start --root` detached gives its
  exit status to no one). It is first up (`hub.health`), then signalled; once for SIGTERM, then a fresh one for SIGINT.
  **"Stays down"**: nothing answers at its socket for 12 s after SIGTERM's exit and 35 s after SIGINT's, and the login
  service's stand-in is never loaded or started.
- **"After the confirmation and before it exits"** (AC5): once the stub has been asked (and confirms) and the hub's
  socket refuses connections (its `stop()` has closed the listener), the test sends SIGTERM to the hub's PID every 10 ms
  until the stand-in logs its exit. If no SIGTERM could be delivered in that window the test is skipped as
  INCONCLUSIVE rather than passed. A `process.kill` that succeeds on a zombie not yet reaped would also count as
  delivered; the loop stops as soon as the stand-in logs the exit, to keep that small. "Still exits 0" is the exit
  code the stand-in saw, and `deep hub stop` exiting 0; "stays down" is no hello and no start for 35 s.
- **"The systemd unit `deep setup` writes"** (AC6): the unit the login service's definition holds as the hub's start
  through it writes it: `deep hub start` on the installed root, which runs the same `startHub` → `startService` →
  `definition()` that `deep setup` runs (`setup.ts` calls `startHub`). Running the whole `deep setup` in a sandbox needs
  built agents' hooks, deep-hook and the history step, which this criterion doesn't concern. `RestartSec=3` also
  accepts `3s`/`3sec`; `SuccessExitStatus` and `RestartForceExitStatus` must list `75` among their values.
  **The base gives no way to get the Linux unit on macOS** (`definition()` branches on `process.platform` with no
  seam), so the unit test runs on Linux only and is skipped on macOS with that reason; the plist test runs on macOS
  only. The plist is read by `/usr/bin/plutil`, the OS's parser.
- **Not tested:** AC7 (by hand: the real launchd's and systemd's restart, throttle, start limit, `bootout`/`stop`
  leaving the hub down and the unit `inactive`, and `deep setup --undo`); logout and shutdown; the design sentence the
  issue adds; the issue's out-of-scope gaps (`launchctl bootout`, `systemctl stop`, `kill -STOP` from a child).

## Files

- `helpers.mjs`: the sandbox, launching, signals, the socket, the record, the installed hub.
- `fixtures/launcher.mjs`: the login service's stand-in.
- `signal.test.mjs` (AC1, AC2, AC3), `dev.test.mjs` (AC4), `confirmed.test.mjs` (AC5), `definition.test.mjs` (AC6).
- `twins.json`, `twins/`: the planted wrong programs (`twins/README.md`).
- `BASE-FAILURE.txt`: the run on the base, the throwaway implementation's run, and which test caught each twin.

No fixture holds a secret or personal data.
