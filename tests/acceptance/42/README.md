# Acceptance tests for #42: the OTLP receiver for agent telemetry

Written first, from issue #42 (Scope, the six acceptance criteria, Proof and References), the design sections
it links or leans on (Extension API (TypeScript, in-process); Plan usage, per account and per task; One event
log, with tables built from it; the OTLP row of the interfaces table; Privacy; How we know version 0 works and
its Wrong programs; the budget rule for timing results, all in `docs/technical-design.md`), the record from #14
(`packages/record`), `packages/contracts`, `adapters/claude-code.facts.json`, `packages/cli/src/main.ts`,
`scripts/perf.mjs`, `scripts/lanes.mjs` and base commit `a8f844fe8e8375d57097243bd3f52e6e48e4d3e7`, by a job
that never saw an implementation. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job.

Span, log and attribute names come from Claude Code's monitoring page (code.claude.com/docs/en/monitoring-usage,
read October 21): the `claude_code.interaction`, `claude_code.llm_request`, `claude_code.tool`,
`claude_code.tool.blocked_on_user` and `claude_code.tool.execution` spans, the `claude_code.api_request`,
`claude_code.tool_result`, `claude_code.tool_decision` and `claude_code.user_prompt` events with `session.id`
and `prompt.id`, and the variables `CLAUDE_CODE_ENABLE_TELEMETRY`, `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA`,
`OTEL_{TRACES,LOGS,METRICS}_EXPORTER`, `OTEL_EXPORTER_OTLP_PROTOCOL` (`grpc`, `http/json`, `http/protobuf`),
`OTEL_EXPORTER_OTLP_ENDPOINT` and their per-signal `OTEL_EXPORTER_OTLP_{TRACES,LOGS}_{PROTOCOL,ENDPOINT}`. The
page says Claude Code reads these from the shell, from `~/.claude/settings.json`'s `env` and from managed
settings, and ignores them in a repo's `.claude/settings.json`. The OTLP/HTTP paths (`/v1/traces`,
`/v1/logs`), content types (`application/x-protobuf`, `application/json`), the response in the request's
content type, port 4318 (4317 is gRPC) and the JSON mapping (lowerCamelCase, hex IDs, int64 as decimal strings)
come from opentelemetry.io/docs/specs/otlp. The GenAI semantic-conventions page now only points to another
repo; Claude Code's own names (`model`, `tool_name`) are what it sends, so the tests use those.

Run them (a root with no config of its own uses Vitest's defaults; the repo's `vitest.config.ts` also takes
`tests/**/*.test.ts`, so the unit lane runs them too, with the live test skipped):

```sh
npm ci && npm run build --workspaces          # once: the record resolves its siblings through dist/
npx vitest run --root tests/acceptance/42
DEEP_OTLP_LIVE=1 npx vitest run --root tests/acceptance/42 live   # the issue's Proof: a real claude -p session, spends plan usage
```

The tests import `packages/otlp/src/index.ts`, `packages/record/src/index.ts` and
`packages/contracts/src/index.ts` with their `.ts` extension, and type-check under the root `tsconfig.json`'s
strict options with `allowImportingTsExtensions` (checked against a declaration-only copy of the surface below
outside the repo). `doctor.test.ts` runs `npm run build --workspaces` and then `packages/cli/dist/main.js`.

## The surface under test

The issue names behavior but no code API, so these tests define the smallest one they need. The receiver is
an optional first-party extension, so it is its own workspace package, `@deepbuild/otlp`, at
`packages/otlp/src/index.ts` (built to `dist/` like `@deepbuild/record`). It may import `@deepbuild/record`
and `@deepbuild/contracts`; the record and the contracts never import it. `deep doctor` is a command of
`packages/cli`, which reaches the receiver's doctor item only through `@deepbuild/otlp`'s public entry.

```ts
import type { Connection, RecordStore } from '@deepbuild/record';

export interface ReceiverOptions {
  record: RecordStore;
  /** What the hub proved for the extension's writer (writer `ext:otlp`); the receiver adds `session` (the
   *  span's or log's `session.id`) and `agent` (`claude-code`) to it for each append. */
  connection: Connection;
  /** Default 4318, OTLP/HTTP's own; 0 takes a free port (tests). There is no host option: always 127.0.0.1. */
  port?: number;
}
export interface Receiver {
  readonly host: string;   // '127.0.0.1'
  readonly port: number;
  readonly url: string;    // `http://127.0.0.1:${port}`, what OTEL_EXPORTER_OTLP_ENDPOINT points at
  close(): Promise<void>;
}
/** Listens on 127.0.0.1 only, for POST /v1/traces and /v1/logs in application/x-protobuf and application/json.
 *  Answers 200, in the request's content type, only once the export's events are committed to the record. */
export function startReceiver(options: ReceiverOptions): Promise<Receiver>;

/** A session's or a task's request cost, as its row and its task show it. */
export type Cost = { captured: true; usd: number } | { captured: false; text: 'not captured' };
/** The sum of the `request.cost` events of the session, or of every session with an attempt at the task
 *  (`attempts`, from `claim.made`). None at all reads not captured, never { captured: true, usd: 0 }. */
export function costOf(record: RecordStore, of: { session: string } | { task: string }): Promise<Cost>;
```

### Events the record must accept that the base doesn't publish

The catalogue is closed, so the implementer adds both schemas, with a fixture each, to
`packages/contracts/schemas/`, with a writer pattern that admits `ext:otlp` (as `turn.usage@1` does):

- **`tool.span@1`**, one per `claude_code.tool` span, joined with its children by `parentSpanId`:
  `data = { tool, tool_use_id, duration_ms, blocked_ms, decision }`, where `blocked_ms` is the
  `claude_code.tool.blocked_on_user` child's `duration_ms` (null when there is none) and `decision` its
  `decision` (null when there is none). `tool` is the name as sent.
- **`request.cost@1`**, one per model request, from its `claude_code.api_request` log, never a second one from
  the `claude_code.llm_request` span for the same `request_id`: `data = { model, request_id, cost: { basis:
  'reported', usd }, tokens: { input, cached, output, exact: true } }`, with `input` = `input_tokens` +
  `cache_creation_tokens` and `cached` = `cache_read_tokens` (the facts' counting rule), `usd` = `cost_usd`.

An attribute's value may arrive as a string, an int or a double (the docs don't fix the types; the fixtures
send both); the event holds numbers.

### `deep doctor`

`deep doctor --json` prints one JSON object per line per item: `{ item, agent?, ...doctor.item@1 }`, where
everything but `item` and `agent` validates as `doctor.item@1`. The receiver's item is
`item: "otlp.telemetry"`, one per agent, here `agent: "claude-code"`. Plain `deep doctor` prints the same
items for a person, naming the agent ("Claude Code"). Either form exits non-zero when any item's level is
`fail`.

The item reads Claude Code's telemetry settings the way Claude Code does, never the repo's
`.claude/settings*.json`: the `env` block of `settings.json` in the config home (`$CLAUDE_CONFIG_DIR`, else
`~/.claude`), managed settings, then the environment `deep doctor` itself inherited (the shell Claude Code
starts from). With `CLAUDE_CODE_ENABLE_TELEMETRY=1` and an `otlp` traces or logs exporter, each such signal's
protocol (`OTEL_EXPORTER_OTLP_<SIGNAL>_PROTOCOL`, else `OTEL_EXPORTER_OTLP_PROTOCOL`) must be `http/protobuf`
or `http/json`, and its endpoint (the per-signal one, else the generic one) must be the receiver,
`http://127.0.0.1:4318`. A setting that fails makes the item level `fail` with a code from the doctor family
other than `healthy`, `not_checked` or `unknown` (the implementer adds one, e.g. `telemetry_unreadable`), its
`evidence` naming the variable and its value; all readable makes it `ok` / `healthy`. The tests give the
child process `HOME`, `CLAUDE_CONFIG_DIR` and `cwd` in a temp folder and only `PATH` from this process, so
they never read your `~/.claude`.

### Readings

AC4 reads the record's `readings` projection (`record.table('readings')`), each row keyed by its `reading`
column. How the receiver gets its readings there (and which ones) is the implementer's; the test only holds
that a model or tool name absent from `adapters/claude-code.facts.json` (`modelFamily.families`,
`toolKinds.tools`) is folded to `other` before any reading names it.

## Readings where the issue and design leave a choice

- **"Refuses non-local connections"** is: the listening socket is bound to 127.0.0.1 alone (checked with
  `lsof` on the receiver's port), and an export sent to this machine's own non-loopback address is refused and
  appends nothing, while the same export to 127.0.0.1 is accepted. The journey-run host-gateway listener and
  the run's service spans (scope item 4, #260) are not tested here: they need env-local's run and its token.
- **"Telemetry on whose exports never arrive"** is the scenario of AC5; `costOf` reads only the record, so
  a session with no `request.cost` reads not captured whatever its settings. Tokens come from transcripts (#603),
  so AC5 holds the cost, the value only telemetry gives.
- **The 50 MB budget** is the growth of the receiver process's resident set over the measured runs (as #14
  reads working memory); 5% of a core is this process's user + system CPU time over wall time while another
  process sends 2,000 spans a second.

## Criteria to tests

| ID | Criterion (short) | Test | The wrong program, and how it fails |
|---|---|---|---|
| AC1 | a Claude Code session exporting produces tool and cost events | `receiver.test.ts` (fixture, protobuf and JSON); `live.test.ts` (`DEEP_OTLP_LIVE=1`) | a receiver that drops the spans or keeps only one signal has no `tool.span` with `blocked_ms: 1500` or no `request.cost` of 0.0123; one counting the span and the log has two |
| AC2 | refuses non-local connections | `receiver.test.ts` | a receiver bound to 0.0.0.0 shows `*:<port>` in `lsof` and answers 200 on the network address. With no non-loopback address the test skips INCONCLUSIVE |
| AC3 | grpc flagged naming the variable, exit non-zero; http/protobuf at the receiver passes | `doctor.test.ts` | a doctor that checks only that the receiver is up exits 0 with a passing (or missing) item in each flagged case. Skips INCONCLUSIVE when 4318 is taken or managed settings exist |
| AC4 | unlisted models fold to other; 1,000 made-up names add no readings | `receiver.test.ts` (each made-up name sent as Claude Code sends a request: its `llm_request` span and its `api_request` log with a cost; blind redraft, `AC4-REDRAFT.md`) | a receiver keying readings by raw name, from the spans or from the cost logs, has about 1,000 more distinct `reading` keys, and rows naming `made-up-model-…` |
| AC5 | telemetry on, no exports: cost "not captured" on its row and task, never $0 | `receiver.test.ts` | a reader summing nothing to 0 returns `{ captured: true, usd: 0 }` for session A and task A |
| AC6 | 2,000 spans/s under 5% of a core and 50 MB, on the reference Mac | `budgets.test.ts` | measured; off a reference Mac, or within the margin, INCONCLUSIVE (skipped, never passed) |

## Criterion 6: budgets and the merge base

`budgets.test.ts` holds the issue's limits on the reference Mac (Mac15,7 or Mac15,12, mains power, Low Power
Mode off, no thermal warning; the gate and judge of `tests/acceptance/14`): five 5 s runs after a 2 s warm-up,
each a share of a core against 0.05, PASS when all are within, FAIL when all are over by more than the margin,
otherwise INCONCLUSIVE, and the resident set's growth under 50 MB; every export must be accepted and every
tool span reach the record, so a receiver that drops work can't pass by being cheap. The merge-base comparison
belongs to the perf lane (`scripts/perf.mjs`, `benchmarks/budgets.json`): the implementer adds a task that runs
the receiver under the same 2,000 spans/s load and exits 0, with an `initialReason` saying the merge base has
no receiver, so the local preflight compares later changes with it.

## Boundaries the tests inject instead of building

The hub isn't built, so the tests hand the receiver what the hub would: the record (`openRecord` at a temp
folder), the connection the hub proved for the extension (`ext:otlp`), and the hook's and the app's events
(`session.start`, `task.created`, `claim.made`, built from the contracts fixtures). Claude Code's exports are
built in `helpers.ts` from its documented names, in OTLP/JSON and as protobuf encoded by hand with the
opentelemetry-proto field numbers (checked once against `protoc --decode` while writing them); the live test
is the real one.

## Files

- `helpers.ts`: OTLP requests and their protobuf encoding, a Claude Code prompt's export, a temp record,
  event builders, the reference-Mac gate and judge.
- `receiver.test.ts` (AC1, AC2, AC4, AC5), `doctor.test.ts` (AC3), `live.test.ts` (AC1 live),
  `budgets.test.ts` (AC6).
- `AC4-REDRAFT.md`: the blind redraft of AC4 (BigInt-safe rows; made-up names sent on spans and cost logs).
- `BASE-FAILURE.txt`: the run on the base commit, where every suite fails because `packages/otlp` doesn't exist.

No fixture holds a secret or personal data; session, account and organization IDs are made up.
