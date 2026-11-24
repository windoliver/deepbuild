# Acceptance tests for #2570: `deep hub start` beside a hub that is still exiting

I drafted these tests blind, before any implementation, from these sources only:

- issue #2570 (its text, Scope, three criteria, Proof and one comment), and for context #2330, #2565 and #1334 as the
  issue names them
- `docs/technical-design.md`: How it installs (Installs and updates, The hub, Platforms), Proven on the base,
  Dogfooding; and `AGENTS.md` (Proof)
- the base commit `51e4a2b34` (origin/main on 2026-11-14), read only for how its surfaces are driven:
  `packages/hub/src/service.ts` (`startHub`, `stopHub`, `launch`, `DEEP_HUB_LAUNCHER`, the login service's
  definition), `server.ts` (`runHub`, `Hub.stop`, `Hub.exit`, `hub.stop`, `hub.health`), `lock.ts`, `paths.ts`,
  `hub-command.ts`, the CLI's `main.ts`, `promote.ts` (the `stop` the issue points at) and
  `scripts/proof-change.mjs` (`criterionId`)
- for form only: `tests/acceptance/1334/` (its README, helpers and `fixtures/launcher.mjs`). The helpers and both
  fixtures here are written for this suite; nothing is imported from another suite.

I saw no implementation, diff, pull request, other branch or other job's notes. Per AGENTS.md the implementing agent
doesn't edit these tests; a dispute goes to a blind redraft by this job.

## How to run

```sh
npm ci --no-audit --no-fund && npm run build --workspaces --if-present   # the deep CLI and the hub
cargo build --locked -p deep-hook       # a hub's core stops at its start without a built deep-hook
node --test --test-concurrency=1 'tests/acceptance/2570/*.test.mjs'
```

There are 7 tests in 2 files, all offline, about 90 s in all (four of them wait out the 15 s). They are `*.test.mjs`
under `tests/acceptance/`, so the unit lane doesn't pick them up. Each test starts hubs of its own, so the folder
belongs on `scripts/lanes.mjs`'s one-at-a-time list (`alone`); the implementer adds it. Written and run on Linux
arm64; on macOS the same code reads the launchd plist where Linux reads the systemd unit, and that wasn't run.

Every test has a sandbox under `/tmp/d2570-*` (short, for the socket's path) with its own `HOME`, `TMPDIR` and
`XDG_*`, so the record, the login service's definition and the socket are the sandbox's, never the real
`~/.deepbuild`, systemd or launchd. The sandbox drops every `DEEP_*`, `NODE_*`, `XDG_*`, `GIT_*` and agent variable,
and its `PATH` is its own `bin`, `/usr/bin`, `/bin`, `/usr/sbin` and `/sbin`. Each command a test starts gets a
process group of its own. At the end the test stops, by PID, only what it started and what hasn't ended by its own
account: its commands, the stand-in's supervisor and jobs, and the hubs, whose PIDs the fixtures log. Nothing is
stopped by name or port.

## The tests

Criterion IDs are `criterionId` of `scripts/proof-change.mjs` on the issue's criterion text.

| Test | Criterion | At the base |
| --- | --- | --- |
| `exiting.test.mjs`: a dev hub, `deep hub start --root` beside the exiting hub | `#2570.0ed54a91` (1) | fails |
| `exiting.test.mjs`: the installed hub, `deep hub start` beside the exiting job | `#2570.0ed54a91` (1) | fails |
| `start.test.mjs`: a dev hub, no hub and none exiting, starts one | `#2570.03ae960a` (2) | passes |
| `start.test.mjs`: the installed hub, no hub and none exiting, starts one | `#2570.03ae960a` (2) | passes |
| `start.test.mjs`: a dev hub that never answers fails at 15 s, exit 3 | `#2570.03ae960a` (2) | passes |
| `start.test.mjs`: an installed hub that never answers fails at 15 s, exit 3 | `#2570.03ae960a` (2) | passes |
| `start.test.mjs`: beside an old hub that never finishes exiting, ends with exit 3 | `#2570.03ae960a` (2) | passes |

**Criterion 3** (`#2570.1d553870`, #1334's crash case reaches "one notice, never twice" after its restart) has no
test here. It lives in #1334's suite as redrafted under #2565, which is not on the base. It stays open until that
suite's crash case is run on the implementation.

**The issue's Proof also asks for one run on the reference Mac against real launchd**, and its Scope asks what
launchd and systemd do with a start asked for while the process is exiting. No test here answers either: every
installed-hub test runs against the stand-in. Both stay open for a person or a Mac run.

### Criterion 1, in both tests

1. `deep hub start` starts a real hub (a dev hub with `--root`, or the installed hub through the stand-in), and
   `deep hub status` names its pid.
2. The hub is told to stop: `deep hub stop --root` for the dev hub; for the installed one the `hub.stop` call that
   command makes, sent as the CLI with the root's token, because `deep hub stop` first asks the OS to confirm a
   person.
3. The test waits until the hub is held at its exit (below), and checks it still runs and no longer answers.
4. `deep hub start` is asked for. The old hub is let go once the start has acted beside it, then finishes its exit.
5. The start must end with exit 0, a hub must answer on the root's socket, `deep hub status` must name a new pid,
   and the old hub must have ended by its own exit with code 0 (for the installed hub, the stand-in must have seen
   exit 0 and no signal, and nothing may have called `launchctl` or `systemctl`).

At the base both fail at the first assertion of step 5, as the issue says: exit 3 after 15 s, no hub answering. For
the dev hub the new hub was refused by the lock the old one still held; for the installed hub the stand-in was asked
while the job ran and did nothing, and the job then exited 0 and stayed stopped (`BASE-FAILURE.txt`).

### Criterion 2

- **Starts one as today**: with nothing at the root, `deep hub start` exits 0 and a hub answers. The installed hub's
  start asks the stand-in once, with the definition file, and it starts the job. A second start beside the answering
  hub exits 0, leaves that hub running and starts no other.
- **Never answers**: the root holds `restore.pending`, on which the base's hub refuses to start and exits 1. The
  start must exit 3 with exactly today's message on stderr and nothing on stdout,
  `deep hub start: no hub answered at unix:<root>/hub.sock within 15 s; see <root>/logs/hub.log`, after at least
  15 s and less than 30 s (15 s of slack for a loaded machine).
- **An old hub that never finishes exiting** (my reading, see Choices): the start must end by itself within 60 s
  with exit 3 and a line starting `deep hub start: `, and the old hub must still be running, untouched.

## The exiting window

The issue's window is a hub whose socket is quiet while its process still runs. Racing a real stop (60 ms in the
report) proves nothing, so the tests hold it open, and wait on events:

- **The old hub is a real hub.** `fixtures/hold-exit.mjs` is loaded into the sandbox's Node processes with
  `NODE_OPTIONS=--import` and acts only in the main thread of `deep hub run`. It wraps the close of the hub's own
  listener. When the test has armed it (a file, removed by the one hub that takes it), the hub's stop runs as far as
  its first wait, and then its main thread stops on a read of a FIFO. At that point the hub has done what the base's
  `Hub.stop` does first: its socket is closed and removed, its connections are closed, its core was told to stop. Its
  process runs and holds the root's lock (`hub-lock.sqlite`), as `runHub` took it. It writes `hold/holding` with its
  pid, which the test waits for. A write to the FIFO lets the hub's own stop go on to its own `exit(0)`.
- **No product seam is added or used**, and no product file is changed. The base has no seam that holds a hub's exit;
  a wrapper around the real program did it, so nothing is BLOCKED. A real hub was chosen over a stand-in program so
  that whatever a future hub holds or writes while exiting, the held hub holds or writes too.
- **When the old hub is let go.** The start has acted beside the old hub when it asked the service manager (a line of
  the stand-in's log), when a hub it started has ended (a line of `hold/hubs.jsonl`, which every hub writes at its
  start and its exit), or when the command itself has ended. The test waits for the first of these. A start that does
  none of them is waiting, and gets `HOLD_MS` (5 s) before the old hub is let go. So the base's outcome hangs on an
  event, never on that timer, and a start that waits passes however long the wait. The test's diagnostic line says
  which of the two happened. The one limit: on a machine so loaded that the base's `deep hub start` takes over 5 s to
  reach its first act, the base could pass; at loads of 35 to 60 here its first act came within about a second.

## Stand-ins

- **The service manager, behind the base's `DEEP_HUB_LAUNCHER` seam** (`fixtures/launcher.mjs`). The hub's service
  code runs `$DEEP_HUB_LAUNCHER <definition file>` where it would run `systemctl` or `launchctl`. The stand-in keeps
  one job, as the definition the base writes says (`Restart=on-failure`; launchd's `KeepAlive` with `SuccessfulExit`
  false): a call while the job isn't running starts it, a call while it runs does nothing, a job that exits 0 stays
  stopped, and one that exits non-zero or on a signal starts again 10 s after its last start. It reads the program
  and environment from the definition (the unit or the plist). Each call returns once the supervisor answered it, and
  the log says for each ask whether the job ran and what was done. This is a model: what real launchd and systemd do
  is the issue's open question. The seam takes only the definition file, so a start can't ask the stand-in whether
  the job runs or what its pid is.
- **`launchctl` and `systemctl`**, first on `PATH`: each records its call and exits 1. The installed-hub tests assert
  that neither was called.
- **The hold on a hub's exit** (`fixtures/hold-exit.mjs`), described above. It also logs each hub's pid and exit
  code, which is how a test knows a hub ended by itself (a signal leaves no exit line).

## Choices where the issue is silent

- **An old hub that never finishes exiting.** The issue says a start waits for the exiting process and that a hub
  that never answers still fails with exit 3. It doesn't say how long a start may wait for an old hub. I took the
  loosest reading that still ends: within 60 s, exit 3, a `deep hub start: ` line, the old hub left alone. Today's
  exact message and the 15 s are asserted only where the issue states them (a started hub that never answers).
- **"A hub answering"** is a `deep-hub` hello on the root's socket, as the base's `startHub` reads it, and a pid from
  `deep hub status` other than the old hub's. The helper asks `deep hub status` again for up to 30 s, since a hub
  answers its hello before its core can serve `hub.health`.

## Planted wrong programs for the implementation

No implementation exists, so none of these was run and no twin file is written. Each names the test that must fail
on it; the implementer plants them and records the runs.

| Wrong program | Must fail |
| --- | --- |
| The base: asks for the start at once, never looks for an exiting hub | both `exiting.test.mjs` tests (seen) |
| Returns 0 beside an exiting hub, no hub answering | both `exiting.test.mjs` tests, "exited 0, and no hub answers" |
| Waits for the old hub's exit, then returns 0 without asking for a start | the same assertion |
| Guards only the installed hub, or only a dev hub | the other kind's `exiting.test.mjs` test |
| Stops the old hub with a signal, waiting for nothing | `exiting.test.mjs`, "must end by its own exit, code 0" |
| The same, seen where the old hub never ends | `start.test.mjs`, "leaves that hub alone" |
| Waits for the old hub forever | `start.test.mjs`, "beside an old hub that never finishes exiting" |
| Waits for a hub longer or shorter than 15 s, or changes the message or the exit code | both "never answers" tests |
| Waits for an exit when there is no hub, so a first start is slow or fails | both "starts one" tests |
| Starts a second hub beside one that answers | both "starts one" tests, "must start no other" |

## Unrelated finding at the base

`deep hub start` exits 0 as soon as the socket's hello arrives. In a checkout with no deep-hook built, the hub's core
then stops ("no deep-hook is built under …/target") and the hub is gone, after the start said 0. Not in #2570's
scope; noted here only.
