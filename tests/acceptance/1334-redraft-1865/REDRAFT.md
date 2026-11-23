# #1334 criteria AC5, AC1 and AC2 and the fail-closed scope line, blind redraft after #1865: the restarts' stop

#1334's AC5 (`#1334.33ca60cb`) says "A session whose deep-hook is older than the hub's contract gets a clear refusal,
and nothing is recorded as a PASS", and its Scope that "a mismatch fails closed with a reason". Both tests of
`tests/acceptance/1334/contract.test.mjs` read one shared scene, played in `before`: a control session on a hub of this
checkout, then the same session on a hub planted one contract major ahead, then "a restart of the hub (which replays
deep-hook's spool)" and the record read once it is quiet. The restart's stop is `helpers.mjs`'s `stopHub`, which sends
`hub.stop` with the control token alone to a hub run as `deep hub run` with `HOME` at the sandbox and no `--root`: the
installed hub. #1865's Scope: "The installed hub stops only once the OS confirms you inside the hub"; its first
criterion, that a stop on the token alone "leaves the hub running and gets a refusal". On a correct #1865 hub,
`stopHub` swallows the refusal, the hub keeps running, and the planted hub's second start finds it holding the lock,
so both tests fail at "the hub planted one contract major ahead must run … a hub is already running …: it holds the
lock". The criterion still holds. The redraft keeps the scene and every assertion, and changes only how the hub is
stopped for the restart.

AC1 (`#1334.775c65d4`, `crash.test.mjs`) and AC2 (`#1334.14e4b3e9`, `misjudge.test.mjs`) share `helpers.mjs`'s
`rollbackScene`, which ends with "one restart of the hub, as a login or `deep hub start` brings it up again" and judges
"one notice, never twice" across it (`rolledBack`). Its restart's stop is the same `stopHub`. Under #1865 the refused
`hub.stop` returns silently, `deep hub start` finds the hub still running, and the test reads the record again with no
restart: it passes, but its "after one restart" is no longer tested. Added at the coordinator's request, the same
change applies: the restart's stop really stops the hub, and a stop that fails is BLOCKED.

Written from issue #1334 (closed; AC5 and the Scope line "fails closed with a reason") and issue #1865 (open), each as
this job was handed it; the frozen `tests/acceptance/1334/` (README.md, helpers.mjs, fixtures, contract.test.mjs,
twins.json, twins/ by file and marker only); #1865's own blind suite (`tests/acceptance/1865/`: README.md,
helpers.mjs, stop.test.mjs, confirmed.test.mjs, twins/README.md); `tests/acceptance/19-redraft-2073/REDRAFT.md` and
`1342-redraft-1812/` for form; AGENTS.md; and base `dcb63a0a0`, read only for how the surfaces are driven:
`packages/hub/src/server.ts` (`hub.stop`, the hello's `peer`, `runHub`'s SIGTERM handler), `trusted-actions.ts`
(`confirmCommand`) and `confirm.ts`. I never read an implementation of #1865, any diff, branch, pull request or other
worktree.

## What #1865 changes, test by test

| Original (path › test) | Criterion | Why the old expectation no longer holds under #1865 | Replaced by |
|---|---|---|---|
| `1334/contract.test.mjs` › #1334.33ca60cb a session whose deep-hook is older than the hub's contract gets a clear refusal, and nothing is recorded as a PASS | #1334 AC5 `#1334.33ca60cb` | The scene's restart stops the installed hub with `hub.stop` on the control token alone (`helpers.mjs`, `stopHub`). #1865 refuses that stop and the hub keeps running, so the planted hub's second start fails on the lock and the test fails at "must run", with none of its own assertions reached | `1334-redraft-1865/contract.test.mjs` › the same name with " (redraft 1865)": the same scene and assertions; the restart's stop is SIGTERM to the PID the hub's `hub.health` names, then a wait (60 s) for the process to end and the socket to go quiet. A stop that fails sets the planted hub BLOCKED, naming why |
| `1334/crash.test.mjs` › #1334.775c65d4 a planted build that crashes at start is rolled back within 60 s, with no attempt lost and one notice naming the commit | #1334 AC1 `#1334.775c65d4` | The scene's last step stops the installed hub with `hub.stop` on the token alone before `deep hub start`; #1865 refuses it, so no restart happens and "one notice, never twice … after one restart" is read on the hub that never stopped. Not a failure: a check that stopped testing its restart | `1334-redraft-1865/crash.test.mjs` › the same name with " (redraft 1865)": the same scene and assertions; the restart's stop is the redrafted `stopHub` (SIGTERM by PID, then the old process gone and no hub answering with its start); `rolledBack` reads a failed stop as BLOCKED, before its restart assertions |
| `1334/crash.test.mjs` › the hub runs from a promoted build in a versioned folder: its login service names ~/.deepbuild/versions/current, never a checkout or a temporary path | #1334 Scope "never from a worktree, a checkout or a temp path" (untagged) | Not changed by #1865: it reads the scene's first promotion only. Redrafted with its file, so the file stands whole in its original's place | the same name with " (redraft 1865)", word for word otherwise |
| `1334/misjudge.test.mjs` › #1334.14e4b3e9 a planted build that starts but judges the fixture claim wrongly is rolled back the same way; a health check that only pings the hub passes this plant and fails, naming the claim | #1334 AC2 `#1334.14e4b3e9` | As AC1's: the same scene's restart, the same silent refusal | `1334-redraft-1865/misjudge.test.mjs` › the same name with " (redraft 1865)", as AC1's |
| `1334/contract.test.mjs` › a contract mismatch fails closed with its reason: a call a fail_closed guard entry matches is denied, as with the hub away | #1334 Scope "fails closed with a reason" (untagged; `twins.json`'s `scope: fails closed`) | The same shared scene: it fails at the same "must run" | the same name with " (redraft 1865)", in the same file, reading the same redrafted scene; its assertions are as they were |

No expectation is dropped. What #1865 reverses is only the means of the restart's stop, a `hub.stop` on the token alone.

| Part of the scene | In #1334's test | In the redraft |
|---|---|---|
| The control (this checkout's hub and deep-hook) | as written | Kept as it is |
| The planted hub (`DEEP_HUB_PLANT=contract-major-ahead`), its hello, the older session's turn | as written | Kept as it is |
| The restart's stop (contract's scene and the rollback scene alike) | `call(box, 'hub.stop')` with the token alone, then a wait (30 s) for no hello; a refused call returns at once, unnoticed | Changed: SIGTERM to the PID `hub.health` names, then a wait (60 s) for the PID to end and no hello; a failure names itself and makes the planted hub BLOCKED (contract) or `rolledBack` BLOCKED (AC1, AC2) |
| The second start, the quiet record, no PASS | as written | Kept as it is |

## Readings

1. **SIGTERM, not a confirmed `hub.stop`.** The scene needs a restart so the spool is replayed at the next start; how
   the hub stops is not part of AC5. #1865 leaves the installed hub two ways to stop that a test can take: once the OS
   confirms you, and by a signal to its process, which the hub handles as a stop (`runHub`'s SIGTERM handler, a `hub.stopped`
   with `signal:SIGTERM`, #16's AC7). A confirmed stop would need the OS's prompt stubbed in the hub's environment for
   the whole scene, and a `peer` naming this test process, which is the agent every played deep-hook names as its
   parent; a hub that refuses an agent's process tree its stop (as `confirmCommand` refuses `deep off` there) could
   then rightly refuse it. A signal to a process the test started has neither problem, and stops the hub as the
   service's own stop does. So SIGTERM, by the PID the hub names, the process this test started.
2. **Under a login service.** In the rollback scene the hub runs under the launchd stand-in, which starts a job again
   that exits non-zero or on a signal. So "stopped" is the old process gone and no hub answering with the old hello's
   start: a hub the stand-in brought back at once counts as the restart, as a login would, and `deep hub start` then
   finds it running. Either way the record is read across one real restart.
3. **The PID.** `stopHub` reads it from `hub.health` (a read the CLI's role is allowed), as #1865's suite does, rather
   than from the spawned child, so it stops the process that answers the socket, whatever started it.
4. **A stop that fails is BLOCKED.** The original's `stopHub` returned silently when its call was refused, which is how
   #1865 turned into a lock failure two steps later. The redraft's returns why and the scene stops there, so a hub that
   won't stop reads BLOCKED with its reason, never as the criterion failing.

## Whole files and helpers

- `contract.test.mjs`: a whole copy of the original, so it can stand in its place. Changed: the note at its head, the
  restart's three lines (`const stopped = await stopHub(b)` and the BLOCKED line) and the two names' " (redraft 1865)".
- `crash.test.mjs`, `misjudge.test.mjs`: whole copies of the originals. Changed: the note at each head and the names'
  " (redraft 1865)" (both of crash's tests, misjudge's one).
- `helpers.mjs`, `fixtures/launcher.mjs`, `fixtures/gh.mjs`: copies of the frozen `1334/` files. `helpers.mjs` changes
  its head note, `stopHub`, and two lines of the rollback scene: `o.stopped = await stopHub(box)` in `rollbackScene`,
  and in `rolledBack`, before its restart assertions, `o.stopped` must be undefined or the test is BLOCKED, naming it.
  The rest (builds, main watch, the fixture's lanes) is kept word for word so the copy reads against its original line
  by line; the fixtures are copied because `sandbox()` writes stand-ins that name them. The watched repository is
  unchanged: no `node_modules/typescript` link was added (Results).

## Wrong programs they still fail

`1334/twins.json` names, for these two tests, `silent-refusal` and `replays-as-normal` (`#1334.33ca60cb`) and
`fails-open` (`scope: fails closed`), and for AC1 `slow-rollback`, `two-notices`, `notice-names-restored`,
`fresh-root-on-rollback`, and for AC2 `pings-only`, `judges-in-promote`, as `1334/twins.json` lists them (read by this
job by name only; crash's untagged versioned-folder test has no entry there). The contract twins each replace `packages/hub/src/server.ts` with a copy carrying one fault in the
contract refusal or the replay, marked `/* TWIN <name> */`; none touches the stop. The redraft changes nothing those
faults are caught by, so each still fails it as it fails the original. Not run here: laying a twin over this checkout
needs a build of `packages/hub`, which this job was told not to make. `two-notices` is the one that leans on the restart
(a notice made twice); with the original's silent stop under #1865 it could only show at the first read, and with the
redraft's real restart it can show after it too. (Each twin's `server.ts` predates #1865; laid
over a #1865 checkout it also takes #1865's changes to that file out, which the redraft no longer depends on, since its
stop is a signal.) This folder has no `twins.json` of its own: see At merge.

## Results

`RESULTS.txt` holds the run on the candidate #1865 implementation in this worktree (its `packages/*/dist` and
`target/debug/deep-hook`, built by another job):

- `contract.test.mjs`: 2 tests, both passed, in 198 s.
- `crash.test.mjs` (2 tests) and `misjudge.test.mjs` (1): all fail in about 4 s, before any promotion, at the scene's
  first promotion: "deep hub promote: <c1> isn't a commit main watch passed, so it isn't promoted: its last clean run
  here is none yet". Main watch never records a clean run of c1 in the fixture on this Mac; the coordinator reports
  the originals fail the same way here, and names the lanes runner's `typescript` import as the likely cause (#1865's
  suite links `node_modules/typescript` into its sandbox for it). This is an environment block, not a result of the
  redraft: nothing #1865 changes was reached. Not worked around here, since that would change the fixture beyond what
  #1865 requires. So the redrafted restart step of AC1 and AC2 is unverified on this Mac.

## Run it

On macOS, with Node 24.22 first on `PATH`, the workspaces built and `cargo build --locked -p deep-hook` done:

```sh
node --test tests/acceptance/1334-redraft-1865/contract.test.mjs
node --test tests/acceptance/1334-redraft-1865/crash.test.mjs
node --test tests/acceptance/1334-redraft-1865/misjudge.test.mjs
```

Every folder is under `/tmp/d1334-*`, `HOME` is the sandbox's own, and only processes the test started are stopped, by
PID, as in `1334/`.

## At merge

The frozen `tests/acceptance/1334/contract.test.mjs`, `crash.test.mjs` and `misjudge.test.mjs` stay as written and are
then run by hand only; the lanes run this folder's three files in their place. `1334/hold.test.mjs` and
`doctor.test.mjs` call no `stopHub` and are untouched. The owner's call is to swap them in (with `helpers.mjs` as here)
under `1334/`, where `1334/twins.json` covers their tags and scope lines, as the proof lanes read a test's twins from its own
acceptance folder. `scripts/lanes.mjs` names no `1334` path on its one-at-a-time lists today, and the original isn't
on them, so nothing there changes. Those edits are the implementer's.
