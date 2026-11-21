# Acceptance tests for #2973: a token holder can restart the installed hub at most 6 times an hour

I drafted these tests blind, at base commit `4b6ce2f41` (the head of #2969, which adds `hub.restart`; no budget), from
these sources:

- issue #2973, as saved verbatim for this job: its problem, Scope, seven criteria and Proof
- `docs/technical-design.md`: Threats, and what stops each one; Dogfooding
- AGENTS.md

At the base I also read the hub's `server.ts` (`hub.restart`, `RESTART_AFTER_MS`, `RESTART_EXIT`, `hub.stop`,
`stop()`, `runHub` and its clock from `DEEP_HUB_TEST_CLOCK`), `core.ts` (`test.clock`, which steps only the core
worker's clock, and the `hub.state` crash reading), `hub-control.ts` (`hub.drain`, `start.session` refused while
draining), `wire.ts` (`refusal`), `paths.ts` (`rootOf`, `dropTestSettings`), `service.ts` (`control`, the login
service's definition, `DEEP_HUB_LAUNCHER`), `promote.ts` (#1334), and `scripts/proof-change.mjs` (`criterionId`) and
`scripts/proof-runs.mjs` (twins); and, for their shape only, `tests/acceptance/1865/` and `tests/acceptance/1334/` (the
launcher stand-in, the token holder, the watched repository, planted builds, twins). The helpers are written here,
never imported from another suite. Per AGENTS.md, the implementing agent doesn't edit these tests; a dispute goes to a
blind redraft by this job.

## How to run

```sh
npm ci && npm run build --workspaces       # the deep CLI and the hub the tests start
cargo build --locked -p deep-hook          # target/debug/deep-hook, which the promotions' builds hold
node --test --test-concurrency=3 'tests/acceptance/2973/*.test.mjs'   # on Node 24.22
```

There are 8 tests in 6 files, all offline, on macOS (Linux would read the systemd unit, which the stand-in parses too,
but isn't run here). They're `*.test.mjs` under `tests/acceptance/`, so the unit lane doesn't pick them up. Each file
starts hubs of its own in a sandbox of its own, so files run side by side; the three tests of `spent.test.mjs` share
one sandbox and run in order. Timings on this Mac (1-minute loads of 18 to 128, other sessions'
runs alongside): the whole suite in 212 s on the base and 334 s on the throwaway implementation at concurrency 3;
`spent.test.mjs` about 3.5 to 4 minutes (each restart waits out the hub's 15 s minimum up), `crash.test.mjs` 75 to 95 s
(the stand-in's 10 s throttle per crash), `badfile.test.mjs` 45 to 75 s, each promotion file 85 to 110 s.

They run real components: this checkout's built `deep` CLI and hub (`deep hub start`, `deep hub stop`, `deep hub
promote`, `deep hub run` as the login service runs it), main watch's real job (`scripts/main-watch.mjs tick` and
`status`, with this checkout's `scripts/` copied into the watched repository), real git, and the hub's socket reached by
a process holding the control token (`fixtures/client.mjs`).

### Stand-ins, all at boundaries the repo doesn't own

- **launchd, or systemd, behind the base's `DEEP_HUB_LAUNCHER` seam** (`fixtures/launcher.mjs`). The hub's service code
  runs `$DEEP_HUB_LAUNCHER <definition file>` where it would run `launchctl bootstrap` and `kickstart`. Each call is a
  load, as at a login: the first loads the definition into a supervisor of the stand-in's own and starts the job; a
  later one starts the job if it isn't running. In between, the supervisor keeps the job as the base's definition says
  (`KeepAlive` with `SuccessfulExit` false, systemd's `Restart=on-failure`): a job that exits non-zero (a restart's 75),
  or on a signal (a crash), starts again 10 s after its last start (launchd's throttle), at least 0.5 s after its exit;
  one that exits 0 stays stopped until the next load. Every load, start and exit is a line of its log, which the tests
  read.
- **The test clock (#965)**, through that stand-in: while the sandbox's `launchd/clock.offset` holds a number of ms,
  each start gives the hub `DEEP_HUB_TEST_CLOCK` = the wall clock plus that offset, so the hub's clock is moved on by a
  restart on the same record, and stays moved for later starts. (`test.clock` steps the core worker's clock only, so a
  budget kept on the hub's main thread wouldn't see it; a start with the clock ahead moves both.)
- **The OS confirmation**, behind the base's `DEEP_HUB_TEST_CONFIRM` seam, as an executable stub (`confirm` in the
  sandbox's `bin`): it notes each ask and exits 0 (you confirm) only while the sandbox's `confirm.mode` says
  `confirmed`. The launcher stand-in passes it into the hub's environment, as the real launchd never would.
- **`launchctl` and `systemctl`**, first on `PATH`: each records the call and exits 1. Nothing reaches the real launchd.

**Every sandbox points `HOME`, `TMPDIR` and `XDG_*` at a temporary folder** under `/tmp/d2973-*` (short, because the
hub's socket path must fit in 104 bytes), so the installed hub of each test is that sandbox's `~/.deepbuild` hub, never
the real one. The sandbox drops every `DEEP_*`, `CLAUDE*`, `CODEX_*`, `GH_*`, `GITHUB_*`, `ANTHROPIC*`, `OPENAI*`,
`AWS_*`, `GIT_*` and `XDG_*` variable, `NODE_OPTIONS` and `NODE_TEST_CONTEXT`, and its `PATH` is its own `bin`,
`/usr/bin`, `/bin`, `/usr/sbin` and `/sbin`. Each process a test starts gets its own process group, and the sandbox's
cleanup stops that group by its PID, with the stand-in's supervisor and every job it started (by the PIDs it logged),
then removes the sandbox. A crash is `SIGKILL` sent to the PID the hub's own `hub.health` gave: a job the stand-in
started for the test. Nothing is killed by name or port. No model is called and no network is used. Assertion messages
redact the token and the sandbox's path.

## The surface (my choice where the issue leaves it open)

- **The installed hub** is the hub of `~/.deepbuild` (no `--root`), started through its login service by `deep hub
  start`, or by `deep hub promote`.
- **A process that holds the control token** runs as a process of its own (`node fixtures/client.mjs`), says hello on
  the installed socket as the CLI does, `{"hello":"cli","token":…}`, naming no peer, and sends `hub.restart` with no
  params. "Once the hub is back" is the first hello with a new start ID; each restart is sent then.
- **A restart that goes through**: a `result` reply, a hub answering with a new start ID within 90 s, the old process
  gone, and (AC1) the old hub's exit code 75 in the stand-in's log.
- **A refusal**: an `error` reply with no `result`. **Naming the budget**: its JSON text says `restart`, `6` (as a
  number of its own) and `60 min…` or `hour`. **The time the next restart frees up**: an absolute time in the text
  (ISO 8601 or RFC 3339, epoch ms or s, or a clock time `HH:MM[:SS]` in UTC or this Mac's zone) within 60 minutes after
  the first restart's spending, which lies between its request and its hub's exit; a time to the minute counts if its
  minute overlaps. It must also contain `deep hub stop` and `deep hub start`.
- **The hub that answered is still running 20 s later**: the same start ID in its hello, its PID running, and the
  login service having started no job meanwhile.
- **Spent restarts before a promotion**: restarts by the token holder, each once the hub is back, after a first
  promotion of c1's good build with no hub running (which restarts nothing).
- **A build that fails its health check**: #1334's plant, a build whose `bin/deep` runs this checkout's CLI with
  `DEEP_HUB_PLANT=judges-claims-wrongly`: it starts and answers, so promote's rollback needs a second restart.
- **"Both restarts done"**: since the promotion began, the stand-in logged exactly two exits with code 75, the first
  of the hub that was in, the second of the bad build's hub; then the hub is the last good build's `bin/deep hub run`,
  started since the promotion began, and `current` names it.
- **"Exits 1 before draining, with current and the running hub unchanged"**: exit 1; its output names the budget as
  above; `versions/current` exactly as before; the same start ID and PID, no start by the login service and no run of
  the new build's hub since; and the hub doesn't refuse `start.session` as drained (the base's drain refusal says
  "draining").

## The scenes

- `spent.test.mjs`, one sandbox, three tests in order. AC1: `deep hub start`, then 7 restarts by the token holder, each
  once the hub is back; the first 6 go through, the 7th is refused as above and the hub stays up 20 s. AC2: the hub
  crashes, and the stand-in starts it with the clock at 60 minutes and 15 s past the first restart's hub exit (before
  the 6th restart's window ends, at least 75 s later), then one more `hub.restart` must go through. AC3: restarts until
  one is refused (the moved window lets some through; at most 7 tries), then `deep hub stop` with the stub confirming
  exits 0 and the hub is gone within 60 s, and `deep hub start` exits 0 and a hub answers with a new start ID and
  `hub.health`.
- `crash.test.mjs` (AC4): `deep hub start`, then 7 crashes, each `SIGKILL` to the hub's PID and the hub back through
  the stand-in, which logs each exit on `SIGKILL`; then one `hub.restart` must go through.
- `badfile.test.mjs` (AC5): one restart, then the budget file (Readings) made unparseable, then a crash so a hub that
  reads it at start reads it, then `hub.restart` refused naming the file and the hub up 20 s; then the file's own bytes
  back (one restart spent, which would grant one) with mode 000, a crash, and the same.
- `promote-good.test.mjs`, `promote-rollback.test.mjs` (AC6, one tag): c1's build promoted, 4 restarts spent, five
  landings and a tick passing c2, then the promotion of c2's good build (exit 0, no ask of the OS, `current` names c2's
  build under `versions/`, the hub is a new one, c2's `bin/deep hub run`, still up 5 s later), or of c2's misjudging
  build (exit 1, both restarts done, `current` and the hub back on c1's build).
- `promote-refused.test.mjs` (AC7): the same with 5 restarts spent and c2's good build: exit 1 before draining as above.

## Criteria to tests

Each criterion's ID is `#2973.<first 8 hex digits of the SHA-256 of its "- [ ]" text, trimmed, white space
collapsed>`, as `scripts/proof-change.mjs` (`criterionId`) works it out. Each test's name starts with its tag.

| Criterion | Test (file) | Fails on |
|---|---|---|
| AC1 `#2973.6813ca11` 7 restarts by a token holder; the 7th refused, naming budget, time, stop and start; the hub up 20 s later | `spent.test.mjs`, first | the base, naming the 7th restart: it is served and a new hub answers 15 s later |
| AC2 `#2973.fe35afca` past 60 minutes after the first restart on the hub's clock, one more restart goes through | `spent.test.mjs`, second | the base (the budget never spent); twins `window-by-wall-clock`, `window-never-slides` |
| AC3 `#2973.19139acc` with the budget spent, a confirmed `deep hub stop` stops it and `deep hub start` starts it | `spent.test.mjs`, third | the base (the budget never spent); twins `stop-refused-when-spent`, `start-refused-when-spent` |
| AC4 `#2973.5462ab8d` 7 crashes leave the budget unspent | `crash.test.mjs` | twin `crash-spends` (passes on the base) |
| AC5 `#2973.47e2f0df` an unreadable or unparseable budget file: refused, naming it, the hub up | `badfile.test.mjs` | the base (no budget file under the root); twin `bad-file-reads-empty` |
| AC6 `#2973.88dce79f` with 4 spent, a good build's promotion exits 0 with no prompt | `promote-good.test.mjs` | twin `promote-needs-three` (passes on the base) |
| AC6 `#2973.88dce79f` with 4 spent, a failing build rolls back, exit 1, both restarts done | `promote-rollback.test.mjs` | twins `promote-needs-three`, `rollback-without-restart` (passes on the base) |
| AC7 `#2973.ff5ebbbe` with 5 spent, promote exits 1 before draining, naming the budget, nothing changed | `promote-refused.test.mjs` | the base (the promotion goes through, exit 0); twins `promote-room-for-one`, `promote-checks-after-drain` |

## Readings where the issue leaves a choice

- **The budget file's name and shape** are the implementation's. Where AC5 needs a bad one, the budget file is every
  regular file under `~/.deepbuild` that the base doesn't keep and that was last written at or after the first
  restart's request. The base's own files, listed in `helpers.mjs` (`BASE_FILES`, `BASE_FOLDERS`), are the paths
  `rootOf` names (the record `ledger.db` and its `-wal`/`-shm`/`-journal`, `hub-lock.sqlite*`, `control.token`,
  `hub.state`, `hub.sock`, `transcripts.json`, `runs.json`, `devices.json`, `confirm.key`, `restore.pending`), those
  the base hub wrote in a sandbox here (`hub.key`, `hub.key.cert`, `rules.json`, `github.json`), the other JSON files
  its code names (`gates.json`, `config.json`, `people.json`, `pack.json`, `rules-held.json`, `rules-page.json`,
  `claude-hooks.json`, `codex-hooks.json`, `codex-trust.json`, `setup*.json`, `slack.json`, `moved.json`,
  `servers.json`), and the folders `objects/`, `logs/`, `extensions/`, `compose/`, `versions/`,
  `evidence/`, `wiki/`, `spool/`); files ending `.tmp` or `.<digits>` are a write in progress. A hub that kept the
  budget inside one of the base's files (say `hub.state`) would fail AC5 here; the issue's "a file it writes before it
  exits for a restart" reads as a file of its own. Every such file is corrupted: unparseable is the bytes
  `{"restarts": [ this is not a budget` and a newline; unreadable is the file's own bytes with mode 000. **Names the
  file** is its base name in the refusal's text.
- **When a bad file is read** is the implementation's: before each `hub.restart` the test crashes the hub (not a
  restart, so it spends nothing) so a hub that reads the file at start reads the bad one too.
- **"The hub's clock"** is moved on by a restart with `DEEP_HUB_TEST_CLOCK` ahead (the base's own seam, which
  `runHub` reads, so both the hub's threads see it), through the login service's stand-in; the restart that moves it is
  a crash, which per the issue spends nothing.
- **"Past 60 minutes after the first restart"** is placed between the first restart's window end and the 6th's, so a
  window that frees only 60 minutes after the newest restart fails, as does one read by the wall clock.
- **"The time the next restart frees up"** is read as an absolute time (Surface); a relative "in 59 minutes" alone
  fails.
- **"Not retryable"** is in the Scope, not a criterion, and isn't asserted; nor is the dev hub's budget under its
  `--root`, nor a missing file reading as nothing spent beyond the first restarts of each scene (where none exists yet).
- **AC3 with the budget spent** is re-spent after AC2 moved the window on: the test restarts until one is refused, so
  it never rests on what an earlier test only assumed.
- **Not tested:** the real launchd's `KeepAlive` and systemd's `Restart=on-failure` (the stand-in reads the base's
  definition as they would); that promote's own restarts spend the budget (no criterion names it).

## Files

- `helpers.mjs`: the sandbox, launching, the socket, restarts, crashes, staying up, the refusal's readings, the files
  under the root, the watched repository and main watch's ticks, the builds, promote.
- `fixtures/launcher.mjs`: the login service's stand-in, with the test clock. `fixtures/client.mjs`: the process
  holding the control token.
- `spent.test.mjs`, `crash.test.mjs`, `badfile.test.mjs`, `promote-good.test.mjs`, `promote-rollback.test.mjs`,
  `promote-refused.test.mjs`: the tests above.
- `twins.json`, `twins/`: the planted wrong programs (`twins/README.md`).
- `BASE-FAILURE.txt`: the run on the base, the throwaway implementation's run, and which test caught each twin.

No fixture holds a secret or personal data.
