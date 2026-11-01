# Acceptance tests for #39, the Codex adapter

Written blind, before any implementation: from the issue, the design and base commit 244a3455. Status: see BASE-FAILURE.txt, which is incomplete.

Run: `npx vitest run --root tests/acceptance/39 --no-file-parallelism` under Node 24 after building. Type-check: `npx tsc --noEmit -p tests/acceptance/39/tsconfig.json`.

## Criterion to test

| AC | File |
|---|---|
| 1, 2, 3, 5, 7, 8, 16 | session.test.ts |
| 9, 10, 11, 14, 24 | setup.test.ts |
| 17, 18, 19, 25 | lanes.test.ts |
| 12, 13, 15, 21 | replies.test.ts (12 also engine.ts) |
| 4, 20, 23 | kit.test.ts |
| 6, 26, 28 | runner.test.ts (uses tests/acceptance/159's world) |
| 27, 29, 30 | loops.test.ts |
| 22 | budgets.test.ts |
| 4, 12, 13, 26, live | app.live.test.ts |

criteria.json holds each criterion's text and ID.

## What stays BLOCKED, never passed

The four tests in app.live.test.ts skip until run by hand: a stop held in the Codex app (AC4); Codex's engine for the eleven events other than Stop (AC12); no prompt shown for a saved deny (AC13); real Codex's sandbox refusing a write (AC26). The issue's one live CLI session is also not run. AC22's p95 skips as INCONCLUSIVE off a reference Mac.

## Assumed surfaces

The issue names none of these; an implementation that differs should dispute through the blind redraft.

- `lanes.slow.expected_ms` in `~/.deepbuild/config.json`; drafted requirement fields `expected_ms`, `deadline_ms`
- MCP server name `deep` in config.toml; `tool_timeout_sec` under `[mcp_servers.deep]`
- `health` and `deep doctor --json` text for relations and modified entries
- `~/.codex/automations/<id>/automation.toml` with `kind`, `status`, `rrule`, `target_thread_id`, `last_run_at`
- goal and heartbeat readings in the status row or `agent.stop` data; window text `% left` and an age in the row
- `shippedFill('codex', { permissionFixture })`; a kit case whose ID contains "permission"
- a saved deny made by answering an authority `deep_ask` with deny, recorded as `decision.created`, and that ask's shape
- generated types under packages/adapters/src whose header names `codex-rs/hooks/schema/generated`
- `Interrupt` as a hook event; `refusal` read from a failed command in `codex exec --json`
- `job.event` with `data.job` and `data.event`

## Test doubles and Codex's trust

fixtures/fake-codex.pl stands in for `codex` where a real one would spend plan usage. Its read-only refusal is a stand-in, so AC26's real sandbox stays BLOCKED.

AC12, AC14 and AC24 run the real codex in a temporary CODEX_HOME. `trustAll` writes `[hooks.state."<key>"] trusted_hash` into that temporary config.toml. Nothing touches the real `~/.codex`. `--dangerously-bypass-hook-trust` is not used.

## Registration

No registration was made. Before-lane twins and `lanes.mjs` entries for budgets and live tests are still open; `lanes.mjs` needs a signed tag.

## Licenses

fixtures/schemas and fixtures/patch-scenarios.json derive from openai/codex rust-v0.160.0, Apache-2.0, copyright OpenAI.
