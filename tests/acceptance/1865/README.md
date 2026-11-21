# Acceptance tests for #1865: the installed hub stops only once the OS confirms you inside the hub

I drafted these tests blind, at base commit `dcb63a0a0` (origin/main, no implementation), from these sources:

- issue #1865, as saved verbatim for this job: its problem, Scope, three criteria and Proof
- `docs/technical-design.md`: Threats, and what stops each one (the rows Injected answers, Agents switching off what
  watches them, and What a command's children do), and How it installs (the login service)
- AGENTS.md

At the base I also read the hub's `server.ts` (the hello and its `peer`, `hub.stop`, `gates.off`, `stop()`, `runHub`),
`hub-control.ts` and `trusted-actions.ts` (`you.confirm`, `confirmCommand`), `confirm.ts` (the `DEEP_HUB_TEST_CONFIRM`
stub), `authority.ts`, `hub-command.ts`, `service.ts` (the login service's definition, `DEEP_HUB_LAUNCHER`,
`control`, `stopIfRunning`), `promote.ts` (#1334), `paths.ts` (`installedRoot`, `dropTestSettings`, `underTemp`),
`session-state.ts` (`agentAbove`), `client.ts` and `wire.ts` (`startOf`); `scripts/main-watch.mjs`, `scripts/lanes.mjs`
and `scripts/proof-change.mjs` (`criterionId`); and, for their shape only, `tests/acceptance/1334/` (the launcher
stand-in, the watched repository, planted builds and twins). The helpers are written here, never imported from another
suite. Per AGENTS.md, the implementing agent doesn't edit these tests; a dispute goes to a blind redraft by this job.

## How to run

```sh
npm ci && npm run build --workspaces       # the deep CLI and the hub the tests start
cargo build --locked -p deep-hook          # target/debug/deep-hook, which the promotion's builds hold
node --test --test-concurrency=3 'tests/acceptance/1865/*.test.mjs'   # on Node 24.22
```

There are 5 tests in 3 files, all offline, on macOS (Linux would read the systemd unit, which the stand-in parses too,
but isn't run here). They're `*.test.mjs` under `tests/acceptance/`, so the unit lane doesn't pick them up. Each test
starts hubs of its own in a sandbox of its own, so files can run side by side. Timings seen on this Mac at 1-minute
loads of 65 to 210: the whole suite in 100 to 120 s on the base; `stop.test.mjs` 15 s, `confirmed.test.mjs` 40 s (it
watches a stopped hub for 35 s), `promote.test.mjs` 40 s (two main watch ticks and two promotions) on the throwaway
implementation.

They run real components: this checkout's built `deep` CLI and hub (`deep hub start`, `deep hub stop`, `deep hub start
--root`, `deep hub promote`, `deep hub run` as the login service runs it), main watch's real job
(`scripts/main-watch.mjs tick` and `status`, with this checkout's `scripts/` copied into the watched repository), real
git, and the hub's socket reached by a process holding the control token (`fixtures/client.mjs`).

### Stand-ins, all at boundaries the repo doesn't own

- **launchd, or systemd, behind the base's `DEEP_HUB_LAUNCHER` seam** (`fixtures/launcher.mjs`). The hub's service code
  runs `$DEEP_HUB_LAUNCHER <definition file>` where it would run `launchctl bootstrap` and `kickstart`. Each call is a
  load, as at a login: the first loads the definition into a supervisor of the stand-in's own and starts the job; a
  later one starts the job if it isn't running and does nothing if it is. In between, the supervisor keeps the job as
  the base's definition says (`KeepAlive` with `SuccessfulExit` false, systemd's `Restart=on-failure`): a job that exits
  non-zero, or on a signal, starts again 10 s after its last start (launchd's throttle), at least 0.5 s after its exit;
  one that exits 0 stays stopped until the next load. It reads the definition again at each start. Every load, start
  and exit is a line of its log, which the tests read.
- **The OS confirmation**, behind the base's `DEEP_HUB_TEST_CONFIRM` seam, as an executable stub (`confirm` in the
  sandbox's `bin`): the hub's Confirmer runs it once per ask with the prompt's words; it notes each ask in `asks.log`
  and exits 0 (you confirm) only while the sandbox's `confirm.mode` says `confirmed`. Every test starts with it
  cancelled. The launcher stand-in passes `DEEP_HUB_TEST_CONFIRM` into the hub's environment, as the real launchd never
  would: it is the stub's one way in, at that boundary. (`dropTestSettings` keeps test settings away from your real
  `~/.deepbuild` only, so a sandbox home's hub reads it.)
- **`launchctl` and `systemctl`**, first on `PATH`: each records the call and exits 1. Nothing a test starts reaches
  the real launchd.

**Every test points `HOME`, `TMPDIR` and `XDG_*` at a temporary folder** under `/tmp/d1865-*` (short, because the
hub's socket path must fit in 104 bytes), so the installed hub of each test is that sandbox's `~/.deepbuild` hub, its
login service's definition the sandbox's `~/Library/LaunchAgents/com.deepbuild.hub.plist`, never the real
`~/.deepbuild` or launchd job. The sandbox drops every `DEEP_*`, `CLAUDE*`, `CODEX_*`, `GH_*`, `GITHUB_*`,
`ANTHROPIC*`, `OPENAI*`, `AWS_*`, `GIT_*` and `XDG_*` variable, `NODE_OPTIONS` and `NODE_TEST_CONTEXT`, and its `PATH` is
its own `bin`, `/usr/bin`, `/bin`, `/usr/sbin` and `/sbin`. Each process a test starts gets its own process group, and
the test stops that group by its PID at the end, with the stand-in's supervisor, every job it started (by the PIDs it
logged) and any dev hub (by the PID its `hub.health` gave), then removes the sandbox. Nothing is killed by name or port.
No model is called and no network is used. Assertion messages redact the token and the sandbox's path.

## The surface (my choice where the issue leaves it open)

- **The installed hub** is the hub of `~/.deepbuild` (no `--root`), started through its login service by
  `deep hub start`, or by `deep hub promote`.
- **A process that holds the control token** says hello on the installed socket as the CLI does,
  `{"hello":"cli","token":…}`, and sends `{"id":1,"method":"hub.stop","params":{}}`. In AC1 it runs as a process of its
  own (`node fixtures/client.mjs`), a command's child, and names its own process as `peer` (its PID and `ps -o lstart=`
  start), as the base's deep commands do, so the hub can ask the OS for that process; it then sends the same call naming
  no process.
- **A refusal naming the confirmation**: the reply is an `error` (no `result`) whose JSON holds `confirm`, and the stub
  saw an ask: the hub asked the OS, which cancelled.
- **"Leaves the hub running"**: 5 s after the reply, the hub says hello with the same start ID, and its process (the
  PID `hub.health` gave) still runs.
- **A confirmed `deep hub stop`**: `deep hub stop` with the stub confirming: exit 0, then within 60 s no hello and the
  hub's process gone. Which process asks the OS (the CLI through `you.confirm`, or the hub inside `hub.stop`) is the
  implementation's.
- **"Before your next login"**: for 35 s after the stop (three of launchd's 10 s throttles) no hub answers and the
  login service's stand-in starts no job. Then a login, the stand-in loading the same definition file again, brings it
  back within 120 s, so the stop didn't unload or remove the service.
- **A restart asked for with the token alone**: `hub.restart` on the installed socket with the token and no peer; where
  the hub serves no such method (`unknown_method`), `hub.stop` with `{"restart":true}`. The reply is a `result`, the
  stub sees no ask, and within 60 s of the request a hub answers with a new start ID, the old process gone and the
  login service's stand-in having started a job since. How the hub gets back (an exit the login service restarts, or
  the hub asking the service) is the implementation's; that it is the login service that starts it is tested.
- **`deep hub promote` of a good build**, as #1334 has it (Run in the clone main watch watches; a build is a folder with
  `build.json` naming its commit, `bin/deep` and `bin/deep-hook`): a first promotion of c1's build with no hub running,
  five landings and a tick, then the promotion of c2's build while c1's hub runs, with the stub cancelling any prompt.
  It must exit 0 with no ask, `~/.deepbuild/versions/current` names c2's build under `versions/`, the hub answers with a
  new start ID, the old process is gone, the new one is c2's `bin/deep hub run` started since the promotion began, and
  it keeps its start ID 5 s later.

### The promotion's fixture

`watched()` builds `origin.git` (a bare repository standing for GitHub's), `work` (where the test lands commits) and
`mac` (the clone main watch ticks in and promote runs in). Its first commit holds this checkout's `scripts/` with
`lanes.mjs` moved to `lanes-real.mjs` and a `scripts/lanes.mjs` that re-exports it and cuts `checks` to two tiny lanes
(`unit` runs `node --test tests/sum.test.mjs`, `lint` runs nothing), an empty `known-failures.json`, `lib/sum.mjs` and
its test. The lanes' runner loads `scripts/proof-binaries.mjs`, which imports `typescript`, and the fixture has no
`package.json`, so the sandbox holds `node_modules/typescript`, a link to this checkout's, in a folder above main watch's
tree. A good build's `bin/deep` notes each run (the build, its PID, the time, its arguments) and runs this checkout's
CLI; its `bin/deep-hook` is a copy of `target/debug/deep-hook`. Issues 9861 on are made up.

## Criteria to tests

Each criterion's ID is `#1865.<first 8 hex digits of the SHA-256 of its "- [ ]" text, trimmed, white space
collapsed>`, as `scripts/proof-change.mjs` (`criterionId`) works it out. Each test's name starts with its tag.

| Criterion | Test (file) | Fails on |
|---|---|---|
| AC1 `#1865.c16bc3be` A token holder's raw `hub.stop()`, the confirmation cancelled, leaves the hub running and gets a refusal naming the confirmation | `stop.test.mjs` | the base (naming `hub.stop`: it answers `{"stopping":true}` and the hub no longer answers); twin `confirms-only-with-peer` |
| AC2 `#1865.2e5dc4d0` A confirmed `deep hub stop` still stops the installed hub, and the login service doesn't start it again before your next login | `confirmed.test.mjs` | twins `confirmed-stop-exits-nonzero`, `refuses-every-stop` (passes on the base, where it already works) |
| AC3 `#1865.bd65df36` `deep hub promote` of a good build still moves the hub to it with no prompt | `promote.test.mjs`, the promotion test | twin `promote-stops-confirmed` (passes on the base) |
| AC3 `#1865.bd65df36` a restart asked for with the token alone brings the hub back within 60 s | `promote.test.mjs`, the restart test | the base (no restart: `hub.stop {"restart":true}` exits 0 and the hub stays down); twin `restart-exits-zero` |

| Scope line | Test (file) | What it requires |
|---|---|---|
| "A dev hub started with `--root` stays exempt" | `stop.test.mjs` | `deep hub start --root <folder>`; a raw `hub.stop` with that hub's token, naming no process, is served and the dev hub stops within 60 s, with no ask |

## Readings where the issue leaves a choice

- **"Sends `hub.stop()` straight to the installed hub's socket"** is read as both a holder naming its process (so
  the hub can ask the OS, and the refusal names the confirmation) and one naming none (refused for any reason). A hub
  that confirms only when a peer is named, and stops on the token alone otherwise, fails.
- **"A refusal naming the confirmation"** needs the word `confirm` in the error and an ask of the OS: a hub that
  refuses every raw stop without asking passes neither AC1 (no ask) nor AC2.
- **"The login service brings it back at once"** and **"within 60 s"**: from the restart's request to the first hello
  with a new start ID. The stand-in keeps launchd's 10 s throttle from the last start, so a hub that exits non-zero
  comes back after about 10 s plus its own start.
- **"`deep setup --undo` goes through that confirmation"**: not tested here. The issue's criteria don't name it, and
  testing it needs the full setup in a sandbox; `deep hub stop` exercises the same confirmed stop.
- **Not tested:** the real launchd's `KeepAlive` (the stand-in reads the base's definition as launchd would);
  deep-hook's denial of an agent's `deep hub stop` (#17's, unchanged here); the app's stop.

## Files

- `helpers.mjs`: the sandbox, launching, the socket, the installed hub, the restart, the watched repository and main
  watch's ticks, the builds, promote.
- `fixtures/launcher.mjs`: the login service's stand-in. `fixtures/client.mjs`: the process holding the control token.
- `stop.test.mjs`, `confirmed.test.mjs`, `promote.test.mjs`: the tests above.
- `twins.json`, `twins/`: the planted wrong programs (`twins/README.md`).
- `BASE-FAILURE.txt`: the run on the base, the throwaway implementation's run, and which test caught each twin.

No fixture holds a secret or personal data.
