# #2570's third criterion: #1334's crash case after its restart

Criterion `#2570.1d553870` (the first 8 hex digits of the sha256 of its line):
"#1334's crash case reaches "one notice, never twice" after its restart (its redraft under #2565)".

Written blind: from issue #2570 (and #1334, #2565, #2330 as it names them), `AGENTS.md`,
`docs/technical-design.md` and the base `254bdc87c`'s tree. No pull request, diff, other branch or worktree was read.

## What the test does

`restart.test.mjs` runs the #2565 redraft's crash scene as it stands: `rollbackScene(t, 'crash')` from
`../1334-redraft-2565/helpers.mjs`, imported, not copied. In it the good build of c1 is promoted, a session works,
a build of c2 that crashes at start is promoted and rolled back, the record is read, the hub is "stopped" through its
socket (`hub.stop`) and `deep hub start` is asked for at once, and the record is read again. That restart is the one
#2570 was seen failing in. Then the test restarts the hub itself (below).

## Why a restart of its own

On this base the scene's restart restarts nothing. Its `hub.stop` goes over the socket with the token alone, and since
#1865 the installed hub refuses that:

```
hub.stop refused: {"code":"unconfirmed", … "remediation":"deep hub stop changed nothing: the call names no process for the peer check; run the deep command itself."}
```

The scene's helper swallows the refusal, and its `deep hub start` then reads "The hub is up; it was already running."
I saw this in a probe on the Spark (Linux) at 254bdc87c: same hub `start` before and after. The first version of this
test judged only the scene's restart, and it passed on the base and on `start-ignores-exiting` alike
(`BASE-RESULTS.txt`, first runs). It proved nothing about a restart.

So the test keeps the scene unchanged and then restarts the hub itself, the way the scene means to:

1. **The OS prompt's stand-in.** It writes an executable that exits 0 and adds `DEEP_HUB_TEST_CONFIRM=<it>` to the
   login service's definition that the base wrote. The launchd stand-in passes a job only its definition's environment.
2. **`hub.restart`** (the token's own restart). The stand-in starts the hub again, now with the stand-in prompt.
3. **`deep hub stop`**, the real CLI. It runs from a shell that exits at once, so it isn't a child of the test
   process, which the scene's session names as its agent; a deep command inside an agent's process tree is refused.
   The hub asks the stand-in prompt, stops, and exits 0.
4. **`deep hub start`** at once, the #2570 race, then the record is read again.

Steps 1 to 3 are the sandbox's reach, not the criterion: if any of them fails, the test fails with `BLOCKED:`. The
scene's own restart is still judged (a hub answers after it, one notice), and a diagnostic says whether it started a
new hub. The #2565 redraft's scene itself needs a stop the installed hub accepts. That is for its owners; this job
edits no existing file.

## What it asserts

One test, named `#2570.1d553870 …`, asserts in order:

1. the scene reached its rollback: the first promotion left a hub answering, the crash build ran, the last good
   build answered again, and `versions/current` names c1;
2. before any restart the record holds exactly one `build.rolled_back`, and it names the promoted commit c2;
3. after the scene's restart a hub answers and the record still holds one notice;
4. (BLOCKED if not) the stand-in prompt is set up, `hub.restart` brings up a new hub, and `deep hub stop` exits 0 with
   the socket quiet;
5. `deep hub start`, asked for right after that stop, exits 0, and a hub with a new `start` answers;
6. after all the restarts the record holds exactly the same one `build.rolled_back` (same event id, same commit), and
   no other.

## What it leaves out, and why

`rolledBack()` in the frozen helpers judges #1334's AC1 whole, and it checks deep-hook's 50 ms spool budget
(INCONCLUSIVE when a hook run couldn't spool) before it reaches the notice and the restart. On a loaded machine that
cut the crash test off before the restart every time (`../1334-redraft-2565/BASE-RESULTS.txt`: both base runs
INCONCLUSIVE at loads 117 to 157). This criterion is about the restart and the one notice, not about lost attempts,
so this test does not call `rolledBack()` and does not judge the session's calls, the spool budget, or the 60 s bound
on the rollback; those stay #1334's AC1, judged by `../1334-redraft-2565/crash.test.mjs`. The scene still plays its
session and its timed turns, since the scene is run unchanged; only the judgement differs.

## Planted wrong programs

`twins.json` names two for `#2570.1d553870`. Each is a whole copy of the base's file with one fault marked
`/* TWIN <name>: … */`; none replaces a test-path file.

| Twin | Files | The fault | Fails at |
|---|---|---|---|
| `start-ignores-exiting` | `packages/hub/src/service.ts`, `packages/hub/src/server.ts` | `deep hub start` neither waits for an exiting hub nor asks the service manager again (the start before #2570); and a stopped hub closes the stop's own connection (which `deep hub stop` waits for) and releases its lock, then lives 3 s before it exits, so the start is always asked for while the old job still runs | `deep hub start, asked for right after deep hub stop, must end with a hub answering, exit 0` (exit 3 after 15 s) |
| `notice-again-at-start` | `packages/hub/src/core.ts` | a hub's start records the last `build.rolled_back` again | `one notice, never twice` (more than one notice) |

The 3 s linger in `start-ignores-exiting` makes the race #2570 describes certain instead of load-dependent: without
it the old start fails only when the stand-in launchd is asked before the old hub exits (seen once, 94 ms vs 155 ms).
The linger alone is not a fault the base fails: `controls/linger-only/` is the same `server.ts` with the base's
`service.ts`, a control expected to pass. Its final form passed (`BASE-RESULTS.txt`, run 8). It is not listed in
`twins.json`. Both close the stop's own connection before they linger: a linger before that close is invisible to
`deep hub start`, since `deep hub stop` waits for the connection to close (run 4, where the first twin passed).

On the Mac the prompt's stand-in goes into the plist's `EnvironmentVariables`, and `DEEP_HUB_TEST_CONFIRM` is the
hub's stand-in there too. The test is written for that case but was not run there.

To run one in a scratch copy of a built checkout (with `target/debug/deep-hook`):

```sh
cp -R tests/acceptance/2570-redraft-ac3/twins/<name>/packages/. packages/
npm run build --workspaces --if-present
node --test tests/acceptance/2570-redraft-ac3/restart.test.mjs
```

## How to run

```sh
npm ci --no-audit --no-fund && npm run build --workspaces --if-present
cargo build --locked -p deep-hook
node --test tests/acceptance/2570-redraft-ac3/restart.test.mjs
```

Offline; 1 to 3 minutes on the Spark at loads 30 to 80. It starts hubs in a sandbox under `/tmp/d1334-*` with its
own `HOME`, `TMPDIR` and `XDG_*`, and the launchd stand-in behind `DEEP_HUB_LAUNCHER`, as the #1334 helpers do; it
stops only processes it started, by PID. Like `tests/acceptance/1334-redraft-2565/`, it belongs on
`scripts/lanes.mjs`'s one-at-a-time list; this job edits no existing file, so the implementer adds it.

Run on Linux only (`BASE-RESULTS.txt`); not run against real launchd or systemd, which the stand-in models.
