# Acceptance tests for #1014: a subagent's stop is not the session's

Written blind by a job that saw only the issue, the design and the base commit, and nothing of any work on #1014. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

What was read:

- Issue #1014: its problem, Scope, six acceptance criteria, Proof and References.
- `docs/technical-design.md`: One event log, with tables built from it; Tasks close themselves; the Claude Code row of
  What each agent gives us (SubagentStop); Dogfooding.
- At the base (`58862789`), to learn the surfaces: `packages/record/src/{index,projections}.ts`,
  `packages/hub/src/{hookmap,status,plant}.ts`, the `count.turns` fill in `packages/hub/src/core.ts`,
  `adapters/claude-code.facts.json`, `adapters/corpus/claude-code/2.1.308` (the SubagentStop payload and the hook order
  around an `Agent` call), `packages/contracts/schemas/agent.stop@5.json`, and the suites `tests/acceptance/85/hub` and
  `tests/acceptance/14` for the harness.

## Run

```sh
npm ci                                # once
npm run build --workspaces            # hub.test.ts starts `deep hub run` from packages/cli/dist
cargo build --locked -p deep-hook     # the hub won't start without it
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1014 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1014/tsconfig.json
```

About 5 s. No network, no live agent, no model call. Homes are under `/tmp/hub-1014-*`, removed after each hub; every
process is stopped by its PID. Run here on Node 23.9.0, the Mac's `node`; the repo's engines say 24.22.0, which this Mac
doesn't have.

## The surface used

- `projection.test.ts`: `openRecord`, `testStorage`, `ulid` and `PROJECTIONS` from `packages/record/src/index.ts`;
  `append`, `read`, `raw`, `table`, `rebuild`. Stops come from the contracts' `agent.stop@*` fixtures.
- `hub.test.ts`: `deep hub run` and `deep status` from the built CLI; Claude Code's hook lines on the socket as deep-hook
  writes them, with the 2.1.308 `SubagentStop` payload (`agent_id`, `agent_type`, `agent_transcript_path`,
  `stop_hook_active`, `last_assistant_message`) under the parent's `session_id`; a live stand-in process as the agent; the
  record's tables read-only from `ledger.db`; `openRecord(...).rebuild()` on that file once the hub has stopped.
- `reading.ts`: the criteria's IDs, and `turnBoundary`, the one reading of a turn both suites and the plant tests use.
- `hub.ts`: this suite's own copy of the hub tools in `tests/acceptance/85/hub/helpers.ts`.

## The plant (a new surface the work must add)

Name: **`turn-closes-at-child-stop`**. The wrong program: the projection's turn walk takes a child's stop as a turn end,
so the open turn closes there; nothing else changes. Live and in a rebuild alike.

- **Seam in the record:** `RecordOptions` gains `plant?: 'turn-closes-at-child-stop'`, read by `openRecord`. Selected, a
  stop naming a child goes through the same turn walk as a stop that names none. `projection.test.ts` opens a record with
  `{ plant: 'turn-closes-at-child-stop' }`.
- **Seam in the hub:** `turn-closes-at-child-stop` joins `Plant` and `PLANTS` in `packages/hub/src/plant.ts`, and the core
  passes it to `openRecord` when `DEEP_HUB_PLANT` selects it. `hub.test.ts` starts `deep hub run` with that variable.

Both `#1014.179e8e0c` tests hold the planted program to `turnBoundary`, at the child's stop and at the session's own stop:
each must give at least one finding starting `turn boundary: `. A planted program is the real one with this one change,
so the plant tests pass only on a tree whose turn walk leaves a child's stop out unless planted.

## How the issue was read

- **"Working"** is `sessions.status = 'working'`; `deep status` is read from its listing, the state column of the
  session's line.
- **`ended_log_pos` after the session's own stop**: the issue names only NULL until then. On the projection alone it's
  the stop's `log_pos`. On the hub it is at or after the stop's: the core's `session.attention` right after a stop sets it,
  with or without a child (measured on a no-child session: stop at 14, `ended_log_pos` 16).
- **The child's stop in `turn_events`**: not asserted either way. The Scope says it stays in the record as an event like
  any other, which is asserted through `read`.
- **A return under the child's ID**: the issue leaves it open, so only rows with `session` the session are read.
- **`turn` of the session's first stop is 1**: `the parent's turn count never includes it`. `turn` of the child's stop
  isn't asserted.
- **The projection's child stop** is `outcome: failed`, `owner: you`, with its own cause: the issue lists `failed` and
  `stuck` too. On the hub Claude Code's SubagentStop only ever maps to `finished`.
- **"The rows"** of criterion 5 are all of `PROJECTIONS` plus `turns` and `turn_events`, compared unordered.

## What the base does

3 of 15 fail; `BASE-FAILURE.txt` has the run. The issue's Proof says both surfaces fail on main as the turn splits. At
`58862789` they don't: `projections.ts` already leaves a child's stop out of the session's row, turn walk and `returns`.
These tests pass there, and were not bent to fail. What fails:

- `hub.test.ts`, `#1014.1eafe8b1`: the hub's `++count.turns` counts the child's stop, so a one-turn session's own stop
  has `turn` 2, in `returns` and in `turns.number`.
- Both `#1014.179e8e0c` tests: the plant's seam doesn't exist yet.

Since most tests pass on the base, each was run against wrong programs, with no product file changed: for
`projection.test.ts` a Vite transform of `projections.ts`, for `hub.test.ts` an edit of the ignored `dist`, restored after.

| Wrong program | Fails |
| --- | --- |
| The turn walk takes a child's stop | `#1014.020f9ec0`, `#1014.55bb9354`, the late child's stop; on the hub also `#1014.1eafe8b1` |
| The session's row takes a child's stop | `#1014.95b12f36`, the late child's stop; on the hub `#1014.fe476679` |
| `returns` takes a child's stop | `#1014.1eafe8b1`, the late child's stop; on the hub `#1014.55bb9354` |
| A stop older than `@5` reads as a child's | both old-stop Scope tests |
| Stand-in for the fix: the child's stop counts no turn, and the plant selectable | none; 7 of 7 on the hub, the plant test included |

## Not covered

- A background subagent that outlives the session's own stop, on the hub; the projection test covers a late child's stop.
- A subagent's own tool calls, which Claude Code sends under the parent's `session_id` with `agent_id`: the issue doesn't
  name them.
- Codex's SubagentStop: the issue's Proof names the Claude Code stand-in.
