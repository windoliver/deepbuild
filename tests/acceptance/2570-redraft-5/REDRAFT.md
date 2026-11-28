# Blind redraft of #2570's criteria 1 and 2 tests: the scene's own steps, made to work on the base

Criteria: `#2570.0ed54a91` ("`deep hub start` asked for while a stopped hub's process is still exiting ends with a
hub answering, exit 0") and `#2570.03ae960a` ("With no hub and none exiting it starts one as today; a hub that never
answers still fails at 15 s with today's message and exit 3"). Base `254bdc87c`. This folder replaces the earlier
drafts' tests that fail in their own setup on the base. It edits no existing file; every replaced test keeps its
scenario, its tag and its judgement (the same assertions with the same messages). Only the scene's steps changed.

## What I read

- Issue #2570 (text, Scope, criteria, Proof, its comment); #2330 and #1865 only as they bear on `deep hub stop`.
- `AGENTS.md`; `docs/technical-design.md` (How it installs, Proven on the base, Dogfooding).
- The base tree: `packages/hub/src/service.ts` (`startHub`, `exiting`, `waitForHub`, `waitForStop`, `control`,
  `stopAsPeer`, `stopHub`, `launch`, the login service's `definition`), `server.ts` (`hub.stop`, `Hub.stop`,
  `Hub.exit`, `runHub`, where `DEEP_HUB_TEST_CONFIRM` reaches the core), `hub-command.ts`, `authority.ts`
  (`stopAsYou`), `trusted-actions.ts` (`confirmCommand`, the `you.confirm` behind an installed `hub.stop`),
  `confirm.ts` (the `DEEP_HUB_TEST_CONFIRM` stub), `session-state.ts` (`agentAbove`), `paths.ts`
  (`dropTestSettings`); `scripts/lanes-lists.mjs` (lane.json), `scripts/proof-runs.mjs` (twins.json), the comment,
  size, wait and alone lints.
- The existing suites `tests/acceptance/2570/`, `2570-redraft-ac1/`, `2570-redraft-3/`, `2570-redraft-4/`: their
  READMEs, helpers, fixtures and tests.

I read no pull request, diff, other branch, other worktree, notes, `tests/acceptance/2570-redraft-ac3/` or
`tests/acceptance/1334-redraft-2570/`.

## The dispute

Two scene steps no longer work on the base. Neither is something the tests judge.

1. **The installed hub's stop.** The earlier drafts stop the installed hub by sending `hub.stop` with the control
   token alone. Since #1865 the installed hub routes that call through `you.confirm`, which refuses a call that names
   no process: `{"code":"unconfirmed", … "deep hub stop changed nothing: the call names no process for the peer
   check; run the deep command itself."}`. The scene never reaches the start under test.
2. **The hold on a stopped hub.** Since #2330 `deep hub stop` returns only once the hub has closed the stop's own
   connection (`waitForStop`), which the base's hub does at its process exit. The first draft's hold stops the hub's
   main thread on a FIFO read, and `2570-redraft-ac1`'s keeps the core's stop message back. Either way the held hub
   never closes that connection, so the scene's `deep hub stop --root` exits 3 after 15 s. `2570-redraft-4`'s job
   lingers inside `process.exit`, with the connection still open, so a real `deep hub stop` would only return once
   the process is gone and there would be no exiting hub left to start beside.

Verified on the base on the Spark before this folder was laid in: `BASE-RESULTS.txt`, run 1. Every one of the
earlier drafts' failures there is one of these two scene steps.

## What changed in the scene

- **The installed hub is stopped by the real `deep hub stop`**, as a person runs it. The OS's confirmation of a person
  is stood in for by the base's own test seam `DEEP_HUB_TEST_CONFIRM` (a file reading `confirmed`), put where the
  installed hub gets its environment from: the login service's definition. `fixtures/confirm-in-definition.mjs` sits
  in front of each suite's service-manager stand-in (behind `DEEP_HUB_LAUNCHER`): it adds
  `DEEP_HUB_TEST_CONFIRM=<file>` to the definition's environment (`Environment=` of the unit, or the plist's
  `EnvironmentVariables`), then hands the same file to the stand-in unchanged. `dropTestSettings` keeps the variable,
  since the sandbox's root is not the real user's `~/.deepbuild`.
- **A dev hub is stopped by `deep hub stop --root`**, as before.
- **The held hub closes the stop's connection.** `fixtures/closes-stop.mjs`, loaded only in `deep hub run`'s main
  thread, records the connections the hub accepts on its `hub.sock` listener, and when the hub closes that listener
  (the first step of `Hub.stop`) it closes those still open, the stop's own included. The listener's close removes
  the socket file, so `deep hub stop`'s check that nothing answers any more succeeds and it exits 0. Everything else
  is as in the earlier drafts: the process keeps running and keeps the root's lock until the hold lets it go (the
  FIFO, the kept-back core stop) or until its linger ends (`2570-redraft-4`'s job). An old hub that never finishes
  exiting still never ends: its main thread stays on the FIFO read for as long as the test runs.
  - With the first draft's sandbox it is loaded through `NODE_OPTIONS`, after the hold, so its close runs right after
    the hold's.
  - `2570-redraft-4`'s stand-in sets the job's `NODE_OPTIONS` itself (to its `job.mjs`), so there it is added as
    `--import=<file URL>` after the node path of the definition's `ExecStart` (or `ProgramArguments`), by the same
    wrapper.
- **The process tree.** The brief warned that a `deep hub stop` run inside the test's own process tree might be
  refused as an agent's. On the base, `agentAbove` finds an agent only among the sessions recorded by that hub, and a
  sandbox hub has none, so the command is run as a direct child of the test, like every other `deep` command in these
  suites. Every run in `BASE-RESULTS.txt` was made that way, and the installed hub never refused it: every
  `deep hub stop` in the base run exited 0. The detached shell was not needed.

## Mapping

| Original test (path › name) | Replacement (path › name) |
| --- | --- |
| `2570/exiting.test.mjs` › `#2570.0ed54a91 a dev hub: deep hub start --root, asked for while the stopped hub's process is still exiting, ends with a hub answering, exit 0` | `exiting.test.mjs` › same name |
| `2570/exiting.test.mjs` › `#2570.0ed54a91 the installed hub: deep hub start, asked for while the stopped job is still exiting under the service manager, ends with a hub answering, exit 0` | `exiting.test.mjs` › same name |
| `2570/start.test.mjs` › `#2570.03ae960a a dev hub: with no hub and none exiting, deep hub start --root starts one, exit 0` (passes on the base) | `start.test.mjs` › same name, unchanged |
| `2570/start.test.mjs` › `#2570.03ae960a the installed hub: with no hub and none exiting, deep hub start asks the service manager once and a hub answers, exit 0` (passes) | `start.test.mjs` › same name, unchanged |
| `2570/start.test.mjs` › `#2570.03ae960a a dev hub that never answers: deep hub start --root fails at 15 s with today's message and exit 3` (passes) | `start.test.mjs` › same name, unchanged |
| `2570/start.test.mjs` › `#2570.03ae960a an installed hub that never answers: deep hub start fails at 15 s with today's message and exit 3` (passes) | `start.test.mjs` › same name, unchanged |
| `2570/start.test.mjs` › `#2570.03ae960a beside an old hub that never finishes exiting, deep hub start --root ends by itself with exit 3 and leaves that hub alone` | `start.test.mjs` › same name |
| `2570-redraft-ac1/exiting.test.mjs` › `#2570.0ed54a91 a dev hub: …` (as above) | `slow-stop.test.mjs` › same name |
| `2570-redraft-ac1/exiting.test.mjs` › `#2570.0ed54a91 the installed hub: …` (as above) | `slow-stop.test.mjs` › same name |
| `2570-redraft-ac1/exiting.test.mjs` › `scene: a dev hub kept exiting for the scene's longest hold, with no start asked for, ends by its own exit 0` | `slow-stop.test.mjs` › same name (untagged, as before) |
| `2570-redraft-ac1/exiting.test.mjs` › `scene: the installed hub's job kept exiting for the scene's longest hold, with no start asked for, ends by its own exit 0` | `slow-stop.test.mjs` › same name (untagged, as before) |
| `2570-redraft-4/exiting.test.mjs` › `#2570.0ed54a91 deep hub start asked for while a stopped hub's process is still exiting ends with a hub answering, exit 0` | `linger.test.mjs` › same name |
| `2570-redraft-4/start.test.mjs` › `#2570.03ae960a with no hub and none exiting, deep hub start starts one as today: exit 0, a hub answering` | `linger.test.mjs` › same name |
| `2570-redraft-4/start.test.mjs` › `#2570.03ae960a a hub that never answers still fails at 15 s with today's message and exit 3` (passes on the base) | `linger.test.mjs` › same name, unchanged |

Every test of each original file has a replacement here, so each whole file can be mapped to this folder:

- `tests/acceptance/2570/exiting.test.mjs`: both tests (2 of 2).
- `tests/acceptance/2570/start.test.mjs`: all five (5 of 5). The four that pass on the base are carried unchanged on
  the first draft's own sandbox, since they never stop a hub.
- `tests/acceptance/2570-redraft-ac1/exiting.test.mjs`: all four (4 of 4), the two untagged `scene:` tests included.
- `tests/acceptance/2570-redraft-4/exiting.test.mjs`: its one test (1 of 1).
- `tests/acceptance/2570-redraft-4/start.test.mjs`: both (2 of 2). "never answers" passes on the base and is carried
  unchanged on that suite's own sandbox.

`tests/acceptance/2570-redraft-3/start.test.ts` passes on the base (3 of 3) and is not touched.

What each replacement changes, and nothing else:

- `exiting.test.mjs`, `start.test.mjs`: the first draft's test bodies; the scene (`helpers.mjs` `exitingHub`) stops
  the hub with the real `deep hub stop` (installed) or `deep hub stop --root` (dev) and asserts it exits 0, with
  `closes-stop.mjs` loaded after the first draft's FIFO hold.
- `slow-stop.test.mjs`: `2570-redraft-ac1`'s test bodies, its hold (`fixtures/slow-stop.mjs`), `MAX_HELD_MS`,
  `QUIET_MS`, `exiting`, `finish` and `tail`, imported; its `stopAndHold` is rewritten in `helpers.mjs`
  (`slowExitingHub`) with the stop above.
- `start.test.mjs`'s four plain tests and `linger.test.mjs`'s "never answers": unchanged, on their own suites'
  sandboxes.
- `linger.test.mjs`: `2570-redraft-4`'s sandbox, stand-in, job preload and helpers, imported; `hub.stop` by token is
  replaced by `deep hub stop`, asserted to exit 0; the wait for the stopped process to end uses the first draft's
  `until` in place of a loop of its own.

## Planted wrong programs (`twins.json`, `twins/`)

Each is the base's `packages/hub/src/service.ts`, whole, with one fault marked `/* TWIN <name>: … */`.

| Twin | Tag | Fault | Must fail |
| --- | --- | --- | --- |
| `start-ignores-exiting` | `#2570.0ed54a91` | `startHub` as before #2570: no wait for an exiting hub, the service manager asked once | every `#2570.0ed54a91` test: "must end with exit 0" |
| `no-lock-is-exiting` | `#2570.03ae960a` | a root with no lock file is read as one whose hub is still exiting | the three "starts one" tests: "must exit 0" / "in a home with no hub didn't start one" |
| `held-exits-1` | `#2570.03ae960a` | beside a hub that never finishes exiting, today's message but exit 1 | `start.test.mjs` never-finishes: "must exit 3" |
| `waits-10-s` | `#2570.03ae960a` | a start gives a hub 10 s, not 15 (the message says 10 s) | the three never-answers tests: "today's message" |

## How to run

```sh
npm ci --no-audit --no-fund && npm rebuild better-sqlite3 && npm run build --workspaces --if-present
cargo build --locked -p deep-hook
for f in exiting start slow-stop linger; do node --test --test-concurrency=1 tests/acceptance/2570-redraft-5/$f.test.mjs; done
```

The folder runs alone (`lane.json`): its tests start real hubs and a service-manager stand-in each, hold a stopped
hub mid-exit and judge 15 s waits. Written for Linux and macOS; run on Linux (the Spark) only, with the stand-ins,
never real launchd or systemd.

Each twin type-checks (`npm run build --workspaces --if-present` passed on each twin copy), and each tagged test
fails at its own tag's assertion on at least one twin of its tag (`BASE-RESULTS.txt`, runs 3 to 6).

## Results (`BASE-RESULTS.txt`)

The Linux Spark, a fresh clone at the base, 1-minute load 95 to 290, one systemd unit per run, nothing retried:

- Run 1, the earlier drafts on the base: the dispute as stated. Installed hubs refuse `hub.stop` by token
  (`unconfirmed`), and `deep hub stop --root` exits 3 after about 15 s beside a held hub. 2570/start's four plain
  tests and redraft-4's "never answers" pass.
- Run 2, this folder on the base: 14 of 14 pass.
- Twins: `start-ignores-exiting` fails all five `#2570.0ed54a91` tests at their assertion; `no-lock-is-exiting`,
  `held-exits-1` and `waits-10-s` together fail all seven `#2570.03ae960a` tests at their assertion.

Not done: no macOS run, no run against real launchd or systemd (stand-ins only), and no proof-lane run.
