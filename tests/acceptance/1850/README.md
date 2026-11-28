# Acceptance tests for #1850: the pi package acts as with the hub away after 50 ms, and spools what the hub didn't take

Written blind, from the issue, `docs/technical-design.md` and base commit `e87cefc44`. Never edit these; a dispute goes to this job's blind redraft (design: Dogfooding).

## Run

```
DEEP_PI_CLI=<dir>/node_modules/@earendil-works/pi-coding-agent/dist/cli.js \
  node node_modules/vitest/vitest.mjs run --no-file-parallelism tests/acceptance/1850/
```

Keep the trailing slash: without it vitest also runs suites 18500 and up.

Node 24, `npm ci`, `npm run build --workspaces` and `cargo build --locked -p deep-hook` first. Install pi anywhere with `npm i @earendil-works/pi-coding-agent@1.4.0`. A missing `DEEP_PI_CLI`, pi of another version, an unbuilt hub or an unbuilt deep-hook fails with `BLOCKED: ...` and never skips. `lane.json` runs the file alone: every test is timed against the package's 50 ms or a hold.

The suite reuses `tests/acceptance/40/helpers.ts`: real pi 1.4.0 in RPC mode with the scripted provider (`tests/acceptance/40/fixtures/scripted-provider.ts`, the one boundary for the model API), the package loaded with `-e packages/pi`, the real hub (`deep hub run`) and a scratch `HOME` under `/tmp/dh40-*`. It never touches `~/.pi`, `~/.deepbuild` or any account, and stops only processes it started, by PID.

Three hubs stand in, each on `<HOME>/.deepbuild/hub.sock`, where the package finds the hub:

- **Stuck**: listens, accepts every connection, reads and discards, never writes a byte. A hub that is there but busy.
- **Stopped**: nothing listens; no socket file.
- **Holding**: says the real hub's hello (read from a real `deep hub run` started for it), acknowledges each `hook.request` with a `hook.ack@2` (`{"v":1,"ack":<id>,"hold_until_ms":null}`) and replies `{"v":1,"exit":0,"stdout":"","stderr":""}` at once, except the first `agent_before_settle`: that one is acknowledged with `hold_until_ms` 20 s ahead and replied 1.5 s later with `stdout` `{"decision":"block","reason":"<word>"}`, the hub's send-back. Where a criterion names a working hub after a stall (AC4, AC5), the real hub starts.

A call is fired when pi emits `tool_execution_start` for it (pi 1.4.0 emits it before the `tool_call` handlers run, `pi-agent-core` `executeToolCallsSequential`) and returned when pi emits its `tool_execution_end`, both as the RPC client reads them. Tool call IDs are the scripted provider's: `call_<request>_0`, so the `n`th call of a script with one call per step is `call_n_0`.

## Criteria

| ID | Criterion | Test |
|----|-----------|------|
| `#1850.081fc261` AC1 | Stuck hub: ten tool calls in a row each return within 60 ms; base takes 15 s for the first, naming the call | `pi-50ms.test.ts` |
| `#1850.8ddd247a` AC2 | Stuck hub: a call no-kill-by-name matches is still blocked with that entry's words | `pi-50ms.test.ts` |
| `#1850.517fa524` AC3 | Working hub: a stop acknowledged with a hold is held until its reply | `pi-50ms.test.ts` |
| `#1850.3d9c6d57` AC4 | Stopped hub: the tool calls and the stop land in the record once the hub starts, once each, with the spool line's `seq` and `id`; base spools nothing, naming the first event | `pi-50ms.test.ts` |
| `#1850.33ec08d6` AC5 | Stuck hub: each of the ten calls is spooled marked late, and recorded once, marked late, once a working hub starts; an unmarked late line fails, naming the call | `pi-50ms.test.ts` |

## The surface (my choice)

The issue names pi's events, the 50 ms, `hold_until_ms`, deep-hook's spool, `seq`, `id` and late. An implementation must provide exactly these:

- **The bound.** With no `hook.ack@2` for an event within 50 ms of pi firing it, the package acts as with the hub away. A `tool_call` then returns from its handler (blocked or not) within that bound, so `tool_execution_start` to `tool_execution_end` of a `read` of a two-byte file is at most 60 ms. AC1 and AC5 run with no `rules.json` and no `hook.binary`, so no matcher runs.
- **Fail closed.** AC2 writes `<HOME>/.deepbuild/rules.json` holding only the `no-kill-by-name` entry of `crates/deep-hook/default-rules.json`, and `<HOME>/.deepbuild/config.json` with `hook.binary` the built `target/debug/deep-hook`. The call is `bash` `pkill -x dh1850none; touch ran.txt` (no process has that name). It ends as an error whose text holds the entry's `reason` and `next_step`, and `ran.txt` is never made.
- **A hold.** An event acknowledged within 50 ms with `hold_until_ms` waits for its `hook.reply@2` until then. The stop is pi's `agent_before_settle`; a reply whose `stdout` is `{"decision":"block","reason":R}` sends the run back with R, as on base (#40), so the next model request holds R.
- **The spool.** What the hub didn't take is appended to `<HOME>/.deepbuild/spool/spool.jsonl` (any `*.jsonl` in that folder is read), one line per request: the `hook.request` line the package would have sent, beginning `{"v":1,"agent":"pi"`, with `event` pi's event name, `payload.tool_use_id` pi's call ID for a `tool_call`, and the `seq` and `id` taken when pi fired the event. A line for a hub that was there but slow carries `"late":true`. The real hub replays it on start: a `tool_call` line becomes `tool.before` (`data.call` the call ID, `data.late` when late), an `agent_before_settle` line `agent.stop`, each with the line's `id` and `seq`.
- **Plants.** `packages/pi/src/plant.ts` exports `plant: string | undefined`, read from `DEEP_PI_PLANT` and nothing else, and the package takes its plant only from there (moving #40's values, which keep their meaning). Only these named values change behavior here, compiled in the same code paths and doing nothing unset:

| Value | The wrong program |
|-------|-------------------|
| `away-lets-guarded` | with the hub not acknowledging within 50 ms, a call goes on even when a fail_closed entry matched |
| `hold-cut-at-50ms` | an acknowledged hold is treated as the hub away 50 ms after the event; the reply is dropped |
| `late-unmarked` | a late event is spooled without `"late":true` |

This follows the hub's `packages/hub/src/plant.ts`, which a proof lane's twin replaces alone. Each twin in `twins/` is that one file with the value fixed.

## Wrong programs

| AC | Wrong program | What catches it |
|----|---------------|-----------------|
| AC1 | the 15 s wait for the hub's hello and acknowledgement, each event behind the one before | base (see `BASE-FAILURE.txt`) |
| AC4 | nothing spooled; an event the hub didn't take is dropped | base |
| AC5 | nothing spooled | base |
| AC2 | a fail_closed entry ignored once the hub counts as away | twin `away-lets-guarded` |
| AC3 | a hold cut at 50 ms | twin `hold-cut-at-50ms` |
| AC5 | a late call spooled unmarked | twin `late-unmarked` |

AC2 and AC3 pass on base: base waits 15 s for the stuck hub, then still blocks with the matcher's denials, and holds any acknowledged event 70 s. Each needs its twin.

## How far these tests were checked

Type-checked under `tsconfig.json`. `deep-hook match` was run by hand on AC2's call and rules: it matches `no-kill-by-name` and its denial holds the entry's `reason` and `next_step`. The suite ran on base against real pi 1.4.0 and the real hub; see `BASE-FAILURE.txt`. Never run against an implementation, since none exists, and the twins weren't run.
