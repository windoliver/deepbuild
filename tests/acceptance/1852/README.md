# Acceptance tests for #1852: the hub starts the OTLP receiver, and the doctor says when nothing listens where Claude Code exports

Drafted blind, at base commit `e87cefc44b8dc017c6a642ef8f5f8b7e141a81b4` (no implementation), by a job that saw only:

- issue #1852: its problem, Scope, three acceptance criteria, Proof ("#42's live test, run against the installed hub")
  and Depends on (#42)
- `docs/technical-design.md`: Five ways in, all onto the same core (the OTLP row of the interfaces table), Plan usage,
  per account and per task, and Dogfooding (Who drafts it)
- AGENTS.md, and at the base: #42's suite `tests/acceptance/42/` (its README, helpers, live and doctor tests and
  BASE-FAILURE.txt), `packages/otlp` (its README, `doctor.ts`, how `index.ts` appends), `packages/hub/src/hub-command.ts`,
  `server.ts`'s `runHub`, `paths.ts` (`installedRoot`, `rootOf`), the hub's `events.read` and `hub.health` methods,
  `packages/contracts/schemas/doctor.item@1.json`, `scripts/proof-change.mjs` (`criterionId`), and for shape only
  `tests/acceptance/999/` and `tests/acceptance/1294/` (a hub started with `deep hub run` in a temp home, read over its
  socket)

The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

## How to run

```sh
npm ci && npm run build --workspaces         # the deep CLI and the hub the tests start
cargo build --locked -p deep-hook            # the hub's deep-hook
npx vitest run --root tests/acceptance/1852  # or: node node_modules/vitest/vitest.mjs run --root tests/acceptance/1852
```

Three tests in one file, run one after another: each needs 127.0.0.1:4318 free at its start, which it checks by binding
it once, and a test finding it held fails at once, BLOCKED, naming the address. `lane.json` runs the suite alone, since
#42's suite and any receiver bind the same port. Offline: no model is called, and the only network is 127.0.0.1.

## The surfaces under test

- **The installed hub**: `deep hub run` with no `--root`, as the login service runs it, in a temp home
  (`/tmp/d1852-*/home`, so the hub is that home's `~/.deepbuild` hub and its socket path fits). The test starts no
  receiver of its own: the hub must start it. The hub is ready when it prints its `ready` line, and stopped by SIGTERM
  to its PID, as the login service stops it.
- **The record**: read back through the hub's socket as the `cli` role with the control token, `events.read` with
  `kinds: ["tool.span", "request.cost"]`, the event kinds #42 published.
- **A scripted Claude Code session** (`fixtures/claude-code.mjs`), a process of its own, not a model: it reads
  Claude Code's telemetry settings the way Claude Code does (`env` of `~/.claude/settings.json` over the shell's) and
  exports one prompt's telemetry over OTLP/HTTP to the endpoint those settings name, `/v1/traces` and `/v1/logs`, in
  the protocol they name (`http/protobuf` here). The prompt is #42's: the `claude_code.interaction`,
  `claude_code.llm_request`, `claude_code.tool` (Bash), `claude_code.tool.blocked_on_user` and
  `claude_code.tool.execution` spans, and the `user_prompt`, `api_request` (cost 0.0123), `tool_decision` and
  `tool_result` logs, all with its `session.id`; the protobuf encoder is adapted from `tests/acceptance/42/helpers.ts`
  (same repo, same license). Like an OTLP exporter it retries a refused or 429/502/503/504 export with backoff, up to a
  30 s export timeout, so a receiver that starts a moment after the hub's `ready` line still gets the export, and on
  the base it reports the refused connection to 127.0.0.1:4318.
- **The doctor item**: `deep doctor --json`, its `otlp.telemetry` item for Claude Code (#42's surface), run in the
  same temp home with `~/.claude/settings.json`'s `env` set to export traces and logs over `http/protobuf` to
  `http://127.0.0.1:4318`, as #42's doctor test sets it. The test's own `CLAUDE*`, `OTEL_*`, `DEEP_*` and `XDG_*`
  variables never reach the hub, the doctor or the stand-in. If managed settings exist at
  `/Library/Application Support/ClaudeCode/managed-settings.json` the test fails BLOCKED, since they'd override the
  home's.

## Criteria to tests

All in `hub-receiver.test.ts`; each test's name is its criterion's ID (`#1852.` and the first 8 hex of the SHA-256 of
its text, as `scripts/proof-change.mjs` reads it) and text.

| ID | Test asserts | On the base |
|---|---|---|
| AC1 `#1852.215083f6` | with 4318 free and no receiver the test starts, the installed hub up, the stand-in's export leaves a `tool.span` and a `request.cost` for its session in the record, read through the hub; the failure message names `http://127.0.0.1:4318 (port 4318)` and the stand-in's own report. Then, the hub stopped, nothing answers on 127.0.0.1:4318 (Scope: the hub stops the receiver when it stops) | no receiver: the export is refused, the record holds neither kind, and the message names the port |
| AC2 `#1852.ee6ff135` | with nothing listening on 127.0.0.1:4318 and no hub, the item's level is `fail` and its evidence or fix names `127.0.0.1:4318`, and `deep doctor` exits non-zero; then, with the installed hub started in the same home (its receiver on 4318), the same settings read `ok` / `healthy`, so a doctor that always fails doesn't pass | the item reads `ok` from the settings alone |
| AC3 `#1852.d94f17eb` | with 127.0.0.1:4318 held by a listener of the test's own (a plain HTTP server answering 404), the installed hub starts (its `ready` line, `hub.health` answers, still running after the doctor), and the item is flagged (`warn` or `fail`) with port `4318` in its evidence or fix | the item reads `ok` (its healthy evidence already names the endpoint, so the port alone can't tell; the level does) |

## Left open by the issue, and not tested (the early questions)

- The doctor item's exact words, code and fix for "no receiver answers" and "the port is taken": tested only as the
  level and the address or port appearing in the item.
- Whether the AC3 item is `warn` or `fail` when the port is taken: either passes; `ok` and `skip` don't.
- How the doctor tells the hub's receiver from another process on 4318 (a probe, the hub's own report, or both); the
  holder here answers HTTP 404 to everything, as an unrelated server would. A holder that is itself an OTLP collector
  answering 200 isn't tested.
- What the hub shows elsewhere (`deep status`, the hub's log, `hub.health`) when it runs without the receiver.
- Whether `deep hub run --safe` (no extension loaded) starts the receiver; a dev hub (`--root`) and two hubs on one
  machine contending for 4318.
- How soon after the hub's `ready` line the receiver listens: the stand-in retries for 30 s, as an exporter does.
- The live proof the issue names ("#42's live test, run against the installed hub"): a real `claude -p` spends plan
  usage and is left to that hand run; the scripted stand-in sends the same span and log names.
- `request.cost` and `tool.span` field values (#42's criteria hold those); this suite checks only that both kinds
  reach the record for the exported session.

## Safety

Every folder is under `/tmp/d1852-*`, removed after its test. Every process (the hub, the stand-in, `deep doctor`)
is one the test started, stopped by its own PID (SIGTERM, then SIGKILL); the port holder is a server in the test's own
process, closed after its test. Nothing is killed by name or port. The session, account and organization IDs are made
up; no fixture holds a secret or personal data, and output written to BASE-FAILURE.txt shows home folders as `~`.

## Files

- `helpers.ts`: criterion IDs, the temp home, the hub as a process and its socket, the port check and holder, the
  stand-in's run, `deep doctor --json`.
- `fixtures/claude-code.mjs`: the scripted Claude Code session.
- `hub-receiver.test.ts`: AC1, AC2, AC3.
- `lane.json`: runs alone (the fixed port).
- `BASE-FAILURE.txt`: the run on the base commit.
