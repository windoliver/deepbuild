# #2570 — blind redraft 3: `deep hub start` while a stopped dev hub is still exiting

Drafted blind from issue #2570 (body and comments), `docs/technical-design.md`, `AGENTS.md`, and the base commit
`ed03dc60d51abe3d96cf61b766ecf92057a780eb` (origin/main). Of the base I read only the surfaces the tests drive:
`packages/hub/src/service.ts` (`startHub`, `stopHub`, `hubStatus`, `control`), `hub-command.ts`, `server.ts`
(`runHub`, `Hub.stop`/`exit`, the listen, `hub.health`), `lock.ts`, `paths.ts` (`rootOf`), `promote.ts`'s `stop` (named
by the issue), `packages/cli/src/main.ts`'s hub dispatch, `scripts/proof-change.mjs` (how criterion IDs are derived),
`scripts/lanes.mjs` and `vitest.config.ts` (how the folder would run), and for conventions only
`tests/acceptance/20/hub.ts`/`helpers.ts` and `tests/acceptance/2330/` (#2330 is named by the issue). No other branch,
PR, worktree, or test folder for #2570 was read.

Scope: the **dev hub** (`deep hub start --root <folder>`). The installed hub under launchd/systemd, the reference-Mac
run, and criterion 3 (#1334's crash case) are out of this draft's scope.

## Criteria

IDs as `scripts/proof-change.mjs` derives them (first 8 hex of SHA-256 of the criterion's text):

| ID | Criterion | Test |
|---|---|---|
| `#2570.0ed54a91` | `deep hub start` asked for while a stopped hub's process is still exiting ends with a hub answering, exit 0 | `start.test.ts`: "…still exiting ends with a hub answering, exit 0" |
| `#2570.03ae960a` | With no hub and none exiting it starts one as today; a hub that never answers still fails at 15 s with today's message and exit 3 | `start.test.ts`: "…starts one as today, also after a finished stop" and "…a hub that never answers still fails at 15 s…" |
| `#2570.1d553870` | #1334's crash case reaches "one notice, never twice" after its restart | not covered here (installed hub, #1334's suite) |

## How to run

Needs the workspace built (`npm ci && npm run build --workspaces --if-present`; `cargo build --locked -p deep-hook`
as the hub's core expects). Then, in a capped unit on the Spark:

```sh
node node_modules/vitest/vitest.mjs run --no-file-parallelism tests/acceptance/2570-redraft-3/
```

Lane: the folder starts real hubs and times a 15 s wait, so it belongs in `alone` in `scripts/lanes.mjs`
(`'tests/acceptance/2570-redraft-3/'`), run one file at a time after the parallel block. It is not added there by this
draft. A full run takes about 1–2 minutes at the base (one 15 s wait per failing/never-answering case).

## The scene

All real: `node packages/cli/dist/main.js hub start|stop --root <root>`, and the `deep hub run --root` it spawns.
HOME is a temp folder; every root is under `/tmp/d2570r3-*`.

**A stopped hub still exiting.** The old hub is started by `deep hub start --root R` with
`NODE_OPTIONS=--require linger.cjs` (the hub inherits the variable). `linger.cjs` wraps `net.Server.prototype.close`
in that process alone: when the hub closes *its own* socket — the first step of `Hub.stop` — the main thread is held
for `LINGER_MS` = 8 s (`Atomics.wait`) before the stop goes on to stop the core, release the lock and exit. That is the
issue's "stand-in hub that closes its socket, then exits after a set time", made from the real hub, so any fix that
finds the exiting hub (its pid from `hub.health`, a pid file, its lock) sees a real one. No product file changes.

The old hub is told to stop with `deep hub stop --root R`, not awaited (as the #1334 scene's `hub.stop()` is not).
Once the trace shows the socket closed, the test checks the old pid still runs and has no exit in the trace, then asks
`deep hub start --root R` (clean env, no preload). Afterwards it checks the old hub's exit came after the start was
asked for. Passing needs: start exit 0, a hub answering at the root's socket (its hello, read as the CLI reads it)
whose start ID's ready line in hub.log names a pid other than the old one, the old process gone, and the stop exit 0.

Pids come from each hub's own ready line in hub.log (`{"ready":true,"pid":…,"start":…}`), matched to the answering
hub by its hello's start ID. `deep hub status` was tried first and dropped: on this loaded machine its `hub.health`
call ran past its 2 s timeout or came back refused (`Cannot read properties of undefined (reading 'raw')`), which is
not what this issue is about.

At the base: start spawns a new `hub run`, which can't take the lock the exiting hub still holds (300 ms try) and
exits 1 ("a hub is already running … it holds the lock", in hub.log); nothing else starts it, so start fails after
15 s with exit 3.

**A hub that never answers.** `deep hub start --root R` with `ACC2570_HANG=1`: `linger.cjs` withholds the hub's
`listen` on its socket, so the real hub runs and holds the lock but never answers. Expected: exit 3, stderr exactly
`deep hub start: no hub answered at unix:<R>/hub.sock within 15 s; see <R>/logs/hub.log`, elapsed ≥ 15 s, and no more
than 3 s past 15 s from the hung hub's own start (beyond that: FAIL, or INCONCLUSIVE when the 1-minute load exceeds the
core count). This also catches a fix that mistakes a live, never-answering hub for an exiting one and waits on it.

**No hub, none exiting.** A new root: nothing answers, start exit 0, a hub answers. Then a finished `deep hub stop`
(process gone, its lock file and logs left), and start again: exit 0, a new pid. Durations are printed, not judged.

### Limits

- The hold is a blocked main thread after the socket's close, not a slow core stop; any "still exiting" detection that
  relies on the old hub answering or doing work during its exit would not see it. The lock stays held, as in a real
  slow stop.
- If the machine needs more than 8 s from the socket's close to the new `hub run`'s lock attempt, the base would pass
  the first test for the wrong reason; BASE-FAILURE.txt shows it failed for the expected reason here.
- Cases 2 and 3 describe today's behaviour and pass at the base; they guard the fix against regressions.
- Cleanup stops every hub pid the scene knows (the trace, hub.log's ready lines) by PID, checking `/proc/<pid>/cmdline`
  names the scene's root first: SIGTERM, then SIGKILL after 30 s.

## Results at the base

See BASE-FAILURE.txt for the run.

Base `ed03dc60d`, 2026-11-17T02:03Z, 1-minute load 254 on 20 cores (BASE-FAILURE.txt):

| Test | Criterion | Base | Why |
|---|---|---|---|
| still exiting ends with a hub answering, exit 0 | `#2570.0ed54a91` | **FAIL** (expected) | start asked 400 ms after the old hub closed its socket, while it still ran; exit 3 after 15.4 s with `deep hub start: no hub answered at unix:…/exiting/hub.sock within 15 s; see …/logs/hub.log`; hub.log shows the new `hub run` refused: `deep hub: a hub is already running on …: it holds the lock` |
| no hub and none exiting starts one as today, also after a finished stop | `#2570.03ae960a` | PASS (today's behaviour) | starts in 2.5 s and 0.8 s |
| a hub that never answers still fails at 15 s with today's message and exit 3 | `#2570.03ae960a` | PASS (today's behaviour) | exit 3, exact message, 15.5 s, 85 ms before 15 s past the hung hub's own start |

Two earlier runs at the base (load 250–280) gave the same result for the first test (start asked 288 ms after the
close, exit 3 after 15.2 s, same hub.log line).

### Checked against wrong and right programs (built `packages/hub/dist/service.js` edited in place, then restored; not committed)

| Program | still exiting | starts as today | never answers |
|---|---|---|---|
| base | FAIL | PASS | PASS |
| twin fix: dev start waits up to 30 s for the root's lock to be free before spawning `hub run` | PASS (28.8 s) | PASS | PASS |
| mutant: `WAIT_MS` 25 s | — | — | FAIL (message says 25 s) |
| mutant: start returns 0 without waiting for a hub | — | FAIL (no hub answered) | FAIL (`expected +0 to be 3`; first tried before its exit-3 assert was moved ahead of the scene checks, when it read BLOCKED instead) |

The never-answers case passes the twin fix too: that twin waits for a lock held by an earlier hub, and the hung hub
here is the one start itself spawns. A fix that waited on any live lock holder before checking the socket is not
covered beyond the timing bound.
