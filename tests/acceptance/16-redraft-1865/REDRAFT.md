# #16 criteria AC7 and AC15 blind redraft, after #1865: the installed hub stops on `hub.stop` only once the OS confirms you

#16's AC7 (`#16.d8339694`) says the hub "records why it stopped", and its test stops one hub with `hub.stop` from the
CLI. #16's AC15 (`#16.ffcc7e73`) is the role table, whose `hub.stop` row has the app and the CLI allowed, and its test
waits for the hub to die after each allowed call. Both send `hub.stop` with the control token alone to a hub started
as `deep hub run` with `HOME` at a temporary home and no `--root`: the installed hub. #1865's Scope says "The installed
hub stops only once the OS confirms you inside the hub, as `gates.off` does", and its first criterion that such a stop
on the token alone "leaves the hub running and gets a refusal". So on a correct #1865 hub the AC7 test waits for an
exit that never comes and times out, and the two `hub.stop` cells time out waiting for the hub to die. Both criteria
still hold. The redraft keeps each scenario and every assertion that still holds, and changes only the stop.

Written from issue #16 (open; AC7 and AC15) and issue #1865 (open), each as this job was handed it; the frozen
`tests/acceptance/16/` (README.md, helpers.ts, fixtures, service.test.ts, roles.test.ts, tsconfig.json); #1865's own
blind suite (`tests/acceptance/1865/`: README.md, helpers.mjs, fixtures/client.mjs, stop.test.mjs,
confirmed.test.mjs, twins/README.md; tests, not an implementation), for how a confirmed stop is driven; the design
(`docs/technical-design.md` at the base: the trusted path, and Threats: Injected answers, Agents switching off what
watches them, What a command's children do); `tests/acceptance/19-redraft-2073/REDRAFT.md` and
`1342-redraft-1812/` for form; AGENTS.md; and base `dcb63a0a0`, read only for how the surfaces are driven:
`packages/hub/src/server.ts` (the hello's `peer`, `hub.stop`, `gates.off`), `trusted-actions.ts` (`trusted`,
`confirmCommand`, `pair`), `confirm.ts` (the `DEEP_HUB_TEST_CONFIRM` stub) and `trusted.ts` (the device verifier). I
never read an implementation of #1865, any diff, branch, pull request or other worktree.

## What #1865 changes, test by test

| Original (path › test) | Criterion | Why the old expectation no longer holds under #1865 | Replaced by |
|---|---|---|---|
| `16/service.test.ts` › AC7 every stop records its reason: SIGTERM, SIGINT, hub.stop from the CLI, and a kill -9 found at the next start | #16 AC7 `#16.d8339694` | Its third hub gets `cli.call('hub.stop')` on a hello with the token alone, naming no process, then `await hub.proc.exit`. #1865: the installed hub refuses that stop and keeps running, so the test times out at 90 s with nothing asserted | `16-redraft-1865/service.test.ts` › the same name with " (redraft 1865)": the third hub gets the OS confirmation stub (`DEEP_HUB_TEST_CONFIRM`, confirming), and the CLI's hello names its process (`peer`), as `deep hub stop` from your terminal does; its exit is awaited for at most 60 s, failing with the reply and the asks the stub saw. The other three stops and the assertion, `['signal:SIGTERM', 'signal:SIGINT', 'requested', 'crashed']` in order, are kept as they are |
| `16/roles.test.ts` › AC15 hub.stop from cli is allowed | #16 AC15 `#16.ffcc7e73` | The cell's raw `hub.stop` on the token alone gets a refusal under #1865 (`unconfirmed`, not `role`, so the cell's role check still passes), and the wait for the hub to die times out at 10 s | `16-redraft-1865/roles.test.ts` › "AC15 hub.stop from cli is allowed (redraft 1865)": the hub has the confirmation stub (confirming); the CLI's hello names its process; the cell's check (not refused for its role) is kept, and the hub must stop within 60 s |
| `16/roles.test.ts` › AC15 hub.stop from app is allowed | #16 AC15 `#16.ffcc7e73` | The same raw `hub.stop`, from the app. Under #1865 the installed hub doesn't stop on the token alone; from the app the design's trusted path is a paired device's signature, and the issue's "as `gates.off` does" is a call the base refuses from the app whatever it carries (Readings, 2). The wait for the hub to die times out | `16-redraft-1865/roles.test.ts` › "AC15 hub.stop from app is allowed (redraft 1865)": the same call on the token alone, on a hub with the confirmation stub (confirming). The cell's check (not refused for its role) is kept; in place of the wait for the hub to die, the installed hub must still run 3 s after the reply |

No expectation is dropped but "the hub dies on the app's or the CLI's `hub.stop` with the token alone", which is what
#1865 reverses. Its new form for the CLI, a stop once the OS confirms you, is in the redraft; for the app, the hub
staying up.

## Whole files in place of the originals

Each redrafted file is a whole copy of its original, so it can stand in its place: every other test in it is kept
word for word, with its name, its timeout and its tag.

- `service.test.ts`: the first test, "AC7 started by `deep hub start`, the hub outlives the terminal …", is unchanged.
  The redrafted test's timeout is 240 s in place of 90 s: five hub starts and a confirmation on a loaded Mac.
- `roles.test.ts`: the 40 cells of the first table, the `hub.stop` cells from the hook and from `deep mcp` (refused,
  the hub still runs), the hook-connection test and the credentials test are unchanged. The four `hub.stop` cells now
  all run on hubs started with the confirmation stub, so a cell that is refused is refused with a way to confirm at
  hand. Their timeout is 180 s in place of 60 s. The cells' names come from a `name` field (Vitest reads `$cell$mark`
  as one variable), and read as before but for the mark on the app's and the CLI's.
- `helpers.ts`, `fixtures/agent.mjs`, `fixtures/client.mjs`, `fixtures/launcher.mjs`, `tsconfig.json`: copies of the
  frozen `16/` files. `helpers.ts` adds one section at its end, "The OS confirmation": `confirmStub()` (an executable
  stub in a temp folder that exits 0 at every ask and notes the prompt's words), `peerOf(pid)` and `controlAsYou(hub,
  role)` (a control hello with the token and `peer: {pid, start}`, `start` as `ps -o lstart=` prints it).

## Readings

1. **Which hub is installed.** #16's `startHub` runs `deep hub run` with `HOME` at the test's home and no `--root`, so
   its root is `<home>/.deepbuild`: the installed hub, as #1865's suite reads "the installed hub". A dev hub started
   with `--root` stays exempt under #1865, so starting the hubs with `--root` would also have made the originals pass,
   but would no longer test the hub the criteria name (#16's "the hub runs as a per-user service"), and was not taken.
2. **The app's cell.** The criterion's table says `hub.stop` is allowed from the app, which the redraft keeps: the
   reply must not be a refusal for its role. What it does on the token alone is #1865's: the installed hub keeps
   running. The design says an answer with authority from the app "counts only when a device you paired signs it",
   but #1865 says the stop confirms "as `gates.off` does", and the base's `gates.off` goes through `confirmCommand`,
   which refuses the app whatever it signs. No criterion of #1865 or #16 asks for a signed app stop, so the redraft
   doesn't. (Read once on the candidate implementation in this worktree with a scratch script, not kept: a `hub.stop`
   from the app signed by a device paired through `device.pair` is refused like an unsigned one, `unconfirmed`, while
   its remediation says "from the app it counts only when a device you paired signs it". That's the base's
   `gates.off` wording; noted for the owner, not tested.)
3. **Who confirms.** The CLI's hello names this test process as `peer`, as the base's deep commands name their own
   process and #1865's suite's token holder does. No agent session's process tree holds it (the sessions of the role
   table are bound to the agent stand-in's children), so the hub has no reason to refuse it as an agent's. The OS's
   prompt is stubbed where the base's Confirmer looks, `DEEP_HUB_TEST_CONFIRM`, an executable run once per ask with
   the prompt's words, exit 0 being you confirming: a boundary the repo doesn't own, stubbed as #1865's suite stubs it.
   `childEnv` drops the runner's `DEEP_*`, so the stub reaches only the hubs given it.
4. **The reason a confirmed stop records.** #1865 changes what lets a `hub.stop` count, not what the stop records. So
   AC7's expected reason for it stays `requested`, as #16's README states for `hub.stop`.
5. **Time bounds.** The waits for the hub to die were 10 s (AC15) and unbounded inside a 90 s test (AC7); they are
   60 s now, with a confirmation's prompt in the way and loads near 100 on this Mac. No criterion names them.

## Wrong programs they still fail

- A hub that stops on the app's `hub.stop` with the control token alone, as the base does: "AC15 hub.stop from app is
  allowed (redraft 1865)", at "the installed hub must keep running".
- A hub that refuses the CLI's `hub.stop` even once the OS confirms you, or refuses it for the CLI's role: "AC15 hub.stop
  from cli is allowed (redraft 1865)" (the role check, or the wait), and the AC7 redraft, at "a confirmed hub.stop from
  the CLI … must stop the installed hub".
- A hub that refuses the app's `hub.stop` for its role: the app's cell, at the role check.
- A hub that records the confirmed stop's reason as anything but `requested`, or records no reason: the AC7 redraft,
  at its unchanged assertion.

Not run here: any of these programs. The base needs a build of its own, which this job was told not to make, so the
app cell's failure on the base is read from the code (`hub.stop` stops at once on any app or CLI connection), not run.

## Results

`RESULTS.txt` holds the run on the candidate #1865 implementation in this worktree (its `packages/*/dist`, built by
another job): 48 tests in the two files, all passed.

## Run it

On macOS, with Node 24.22 first on `PATH` and the workspaces built (the files start this checkout's hub; none of them
builds deep-hook):

```sh
npx vitest run tests/acceptance/16-redraft-1865/service.test.ts tests/acceptance/16-redraft-1865/roles.test.ts --no-file-parallelism --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/16-redraft-1865/tsconfig.json
```

Every folder is under `/tmp/dh16-*`, `HOME` is the test's own for every hub, and only processes the tests started are
stopped, by PID, as in `16/`.

## At merge

The frozen `tests/acceptance/16/service.test.ts` and `tests/acceptance/16/roles.test.ts` stay as written and are then
run by hand only; the lanes run this folder's two files in their place. The other files of `16/` are untouched by
#1865 (a search of the suite for `hub.stop` finds only these two and `protocol.test.ts`, whose generated methods leave
`hub.stop` out). The redrafted tests carry the same tags. `16/` has no `twins.json`; this folder has none either.
`scripts/lanes.mjs` has `'tests/acceptance/16/'` on its one-at-a-time (`alone`) and `exclusive` lists, and
`'tests/acceptance/16-redraft-1865/'` belongs on both, since its files start hubs. Those edits are the implementer's.
