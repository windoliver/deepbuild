# Acceptance tests for #2043, blind redraft for the closed-issue sweep (#2047)

#2043: one hook line whose agent or event is a name every object has ends the hub.

Written blind at base commit `8b9f8d6c7`, from the issue's live body, `docs/technical-design.md` (Hook protocol; One
hub per user; Threats; Dogfooding and the wrong-programs layer), AGENTS.md and the base. The first draft,
`tests/acceptance/2043/`, names IDs from an older text of the criteria; this suite is written anew and names the live
ones. Per AGENTS.md nobody edits these files once they land.

## Criterion IDs

Each ID is `#2043.` + the first 8 hex digits of SHA-256 of the criterion's text in the issue's `### Acceptance
criteria`, trimmed and white space collapsed (`criterionId` in `scripts/proof-change.mjs`), recomputed from the live
body.

| ID | Criterion (start) | Test | Twin(s) |
| --- | --- | --- | --- |
| `#2043.3139319d` | A new fixture line … agent `pi` and event `constructor` … | `lookups.test.ts`, first test | `event-lookup-inherited` |
| `#2043.630d1d3d` | Lines with agent `constructor`, `toString`, … 15 lines and 15 answers … | `lookups.test.ts`, second test | `agent-lookup-inherited`, `event-lookup-inherited` |
| `#2043.a1a91749` | With a parser worker planted to throw on one line … | `workers.test.ts`, first test | `pool-messages-only` |
| `#2043.e52db1b5` | With a parser worker planted to exit while it holds a line … | `workers.test.ts`, second test | `pool-leaves-line-waiting` |

## The surface under test

- `deep hub run` on a temp home under `/tmp`, a real process, started and stopped by PID through
  `tests/acceptance/16/helpers.ts`.
- Its socket: each hook line is a new connection's first line after the hub's hello, as deep-hook writes it, through
  #16's `sendHook`, which waits for a line with `exit` or `error`, the connection's close, or 10 s.
- `hub.health` on a control connection, for `pid` and `parsers` (the count of parser workers the pool holds).
- `validate('hook.request@3', …)` from `@deepbuild/contracts`, for the fixture line.
- The planted worker faults the base's parser worker reads, `DEEP_HUB_TEST_PARSER_THROW=<text>` and
  `DEEP_HUB_TEST_PARSER_EXIT=<text>`: a worker handed a line holding the text throws where nothing catches it, or
  exits. The text is the marked line's own fresh ULID.

## How each criterion is judged

- **#2043.3139319d**: `fixtures/pi-constructor.jsonl` is one line, valid against `hook.request@3`, agent `pi`, event
  `constructor`. On one hub, a `pi` line with an event no adapter maps (`no_such_event_2047`) is the reference; the
  fixture's bytes must get the same lines back (its own id in the ack) and an answer; then a Claude Code `PreToolUse`
  line on a new connection must be answered (an ack naming its id and a reply with a numeric `exit`). Failures name
  the line by file, agent, event and id, and say whether the hub's process still runs.
- **#2043.630d1d3d**: on one hub, the references are an agent no adapter is for (`no-such-agent-2047`, refused at
  `/agent`) and `pi`'s and `paseo`'s unmapped event. Each of the five names as the agent must be refused at `/agent`
  with the reference's lines (its own id and name swapped in); `pi` and `paseo` with each name as the event must each
  be answered as their unmapped event is. All 15 are sent and judged; 15 must get a last line back; `hub.health`'s
  `pid` afterwards must be the ready line's.
- **#2043.a1a91749**: a hub with `DEEP_HUB_TEST_PARSER_THROW` set to the marked line's id. That line's connection must
  get a refusal (error@1's shape: a non-empty `code` and a `remediation`, no ack, no reply); the next 100 `PreToolUse`
  lines, each on a new connection, must each be answered; `hub.health`'s `pid` must be unchanged. The criterion's
  wrong program, "a planted pool that listens to its workers for messages only", is the twin `pool-messages-only`.
- **#2043.e52db1b5**: a hub with `DEEP_HUB_TEST_PARSER_EXIT` set to the marked line's id. `parsers` is read before the
  line (a whole number of at least 1); the line must be refused within the 10 s bound; `parsers` read afterwards must
  equal the first reading. The criterion's wrong program, "a planted pool that leaves the line waiting", is the twin
  `pool-leaves-line-waiting`: the line gets nothing for 10 s and the assertion names it by id.

## Twins

Each twin is a full copy of one source file at the base, changed only to undo what its criterion requires; laid over
the base and rebuilt (`npm run build -w packages/hub`), each tagged test fails at its own `expect`.

- `event-lookup-inherited/packages/hub/src/hookmap.ts`: the event lookup reads inherited names
  (`moments?.[request.event] ?? request.event`), so `constructor` maps to a function.
- `agent-lookup-inherited/packages/hub/src/hookmap.ts`: the agent lookup reads inherited names
  (`ADAPTERS[request.agent]`), so `constructor` and the others find a "name".
- `pool-messages-only/packages/hub/src/parser-pool.ts`: the pool listens to each worker for its messages only: no
  `error` or `exit` listener, no replacement.
- `pool-leaves-line-waiting/packages/hub/src/parser-pool.ts`: the pool hears a worker end and replaces it, but leaves
  each line that worker held waiting.

`RUNS.txt` holds the base run and each twin's run.

## Running them

```
npm ci && npm run build --workspaces --if-present && cargo build --locked -p deep-hook
npx vitest run tests/acceptance/2043-redraft-2047
node node_modules/typescript/bin/tsc -p tests/acceptance/2043-redraft-2047/tsconfig.json
```

Node 24. Nothing touches the real `~/.deepbuild`; each hub this suite starts is stopped by its PID. The suite has no
fixed waits: every wait is #16's bounded wait for a line, a close or a reply.
