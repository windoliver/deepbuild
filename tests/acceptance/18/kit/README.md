# Acceptance tests for #18: the adapter kit, the permission reply and the budgets (AC16, AC17, AC18)

Written first, blind, by a job that never saw an implementation of #18. On October 26, 2026 it read:

- issue #18: its Scope, its 24 checkbox criteria, its Proof, "Added Oct 9" and what it depends on
- `docs/technical-design.md`: What each agent gives us, Hooks are evidence not a state machine, Before each command,
  An ask and your answer getting back, Socket roles and contract versions, Composition (the `deep.registerAdapter`
  row: adapter@1 and its broken fakes), Numbers version 0 has to hold (budgets, the timing rule, the reference Macs),
  How we know version 0 works (conformance tests), the Decided row "What an answer authorizes"
- `AGENTS.md`
- the conventions of tests/acceptance/313 (the kit, `shapeOnlyRunKit`, fill modules for `deep-conformance run`),
  349 (surfaces defined by the blind job, `wrong.ts`, plants), 26, 348 and 387 (budgets), 315's overhead redraft
- through their public entries: `@deepbuild/conformance` (`kits`, `runKit`, the adapter@1 kit and its fake agent,
  `deep-conformance run`), `@deepbuild/adapters` (`Adapter`, `shipped`, `claudeParts`), `@deepbuild/asks`
  (`Delivery`, `Decision`), `adapters/claude-code.facts.json`, `adapters/corpus/claude-code`, the hub's `hookmap.ts`,
  `scripts/benchmark.mjs` (`validateBudgets`), `benchmarks/budgets.json`
- the base commit `14561af` (origin/main)

Three other blind jobs cover the other criteria in `../mapping`, `../session` and `../install`. The implementing agent
doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

On macOS, with the repo's Node (24.22.0) first on PATH:

```sh
npm run build --workspaces                # AC17 runs the built conformance bin, which imports packages/*/dist
npx vitest run --root tests/acceptance/18/kit --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/18/kit/tsconfig.json
```

- **The environment:** `helpers.ts` takes `CLAUDE*`, `DEEP_*` and `AI_AGENT` out of the test process, points `HOME`
  at a temp folder, and gives every process it starts a temp `HOME` of its own. Nothing touches `~/.deepbuild`,
  `~/.claude` or `~/.codex`.
- **Temp folders:** under `/tmp/dk18-*`, removed after each file. The tests start only the conformance bin and the
  bench, each to completion with a timeout; nothing is stopped by name or port. No network, no model session.
- **Budgets:** `budgets.test.ts` runs the bench six times per budget on a reference Mac in a fit state (up to about
  15 minutes for the backfill); elsewhere it runs it once and skips as INCONCLUSIVE.

## The surface under test

The issue names no module for the kit's fill, the twins, the permission reply or the benches. This job defines the
smallest surface, in the places the existing pieces already sit, with the names the issue and the design use.

### `@deepbuild/conformance`: the fill of a shipped adapter, and its planted twins

```ts
/** The planted twins of a shipped adapter's fill. */
export type ShippedPlant = 'duplicate-event-id' | 'event-after-stop' | 'allow-from-label' | 'allow-from-yes';
/**
 * The fill of the shipped adapter the registry holds under `agent` (`shipped().names()`: `claude` for Claude Code,
 * its facts' `agent` field), as adapter@1's runner takes it: the adapter itself, the newest version its facts
 * cover, the kit revision it declares, its surface (Claude Code: `terminal`), its driven operations (each answered
 * as its adapter.unsupported lists it) and `deliver`. `planted` turns on exactly one wrong behavior; none is the
 * adapter as shipped.
 */
export function shippedFill(agent: string, options?: { planted?: ShippedPlant }): Fill;
```

`shippedFill(agent)` must load in the kit's runner (today the shipped Claude Code adapter doesn't: see Notes).
The tests reach it in-process from `packages/conformance/src/index.ts`, and through the runner from a module whose
default export is `shippedFill('claude'[, { planted }])`, imported from `packages/conformance/dist/index.js`.

### The adapter's permission reply (`@deepbuild/adapters`)

```ts
/** What the adapter is handed for a permission request: the asks core's Delivery, plus the chosen option's label. */
export interface PermissionAnswer {
  ask: string; session: string; option: string | null; label: string | null;
  decision: 'allow' | 'deny' | 'none'; words: string | null; provisional: boolean; undoes: string | null;
}
export interface Adapter {
  /* as today, plus */
  /** The hook output the agent reads for a PermissionRequest answered with `answer`. */
  permissionReply?(answer: PermissionAnswer, request: HookRequestLine): JsonValue;
}
```

For Claude Code the reply is its PermissionRequest hook output, `{ hookSpecificOutput: { hookEventName:
'PermissionRequest', decision: { behavior, message? } } }`. The tests reach it as `shippedFill('claude').adapter
.permissionReply`, so a twin's reply is the twin's.

### The adapter@1 kit (`kits()`)

What the kit's cases are is the implementer's. The tests hold the kit to what the criteria name:

- **AC16.** Run with `runKit(kit, fill, { headless: true })`: the twin `duplicate-event-id` fails a case whose message
  contains `duplicate event ID` and an ID the run used (a ULID in a hook line the kit fed it or in an event it
  mapped); the twin `event-after-stop` fails a case whose message contains `event after stop` and a turn the run
  used (a `prompt_id` the kit fed it or a `turn` it mapped); neither fails with the other's phrase; the
  unplanted fill passes each of those cases.
- **AC17.** Run as `deep-conformance run --fill <module>` (the built bin; one line per case, `FAIL <id>: <message>`,
  exit 1 on FAIL): the twins `allow-from-label` and `allow-from-yes` each exit 1 with a `FAIL` line whose message
  names the recorded request's command, `git push origin main`, and the case: the label `Allow` for the first
  (and not the words), the words `yes but not on main` for the second. The two are different cases. The unplanted
  fill's run passes both, and no case on that request fails for it.

### The benches (`benchmarks/claude-code.mjs`) and the perf lane

Two tasks in `benchmarks/budgets.json`, #18 first measurements (`initialReason` naming `#18`), valid against the
merge base's budgets by `validateBudgets`:

| id | command | its last line, one JSON object |
|---|---|---|
| `claude-code-map` | `node benchmarks/claude-code.mjs map` | `{"p95Ms": <ms the hub spends mapping one hook payload to its events, p95>, "hooks": <hooks mapped, ≥ 1,000>, "byHook": {"<hook name>": <events mapped from that hook's payloads>, …}}` |
| `claude-code-backfill` | `node benchmarks/claude-code.mjs backfill` | `{"elapsedMs": <ms to backfill>, "sessions": 100, "days": 30, "lines": <transcript lines read>, "events": <events the record holds from the backfill>}` |

The map bench maps recorded Claude Code payloads (the corpus's) on the path the hub maps a hook on, after a warm-up,
and covers each of the nine hooks the issue maps. The backfill bench backfills, through the hub, 100 sessions'
transcripts spread over 30 days, each at least 2,000 lines, on a temp home. Each prints its reading last.

## Readings

- **"Naming the ID", "naming the turn" (AC16).** The kit's hook lines are the kit's, so the test can't know the
  exact ID or turn beforehand. It observes the twin's `mapHook` during the run (every line fed, every event
  mapped; the observation changes nothing) and requires the failure to name one of the IDs or turns it saw.
- **"A kit that checks only reply shapes" (AC16).** `wrong.ts`'s `shapeOnlyKit`: the kit with one case that maps a
  Claude Code turn's hooks (start, prompt, a call's PreToolUse and PostToolUse, Stop, then a late PostToolUse of
  the stopped turn) through the runner's harness, which holds every mapping to adapter.event@1 and the mapping's
  own shape. It passes both twins, so this test's assertion fails on it naming each twin: the test's (wrong
  program) case runs it.
- **The answer (AC17).** "The answer is those words with `decision: none`": `decision: 'none'`, `words: 'yes but
  not on main'`, no option. "The chosen option's label reads Allow but it declares deny": option `allow`, label
  `Allow`, `decision: 'deny'`. "`decision` is `allow`": option `push`, label `Push it`, `decision: 'allow'`. The
  asks core's `Delivery` carries no label; the adapter is handed one here only so a label-reading adapter can be
  caught (design, Decided: "labels and your words never authorize").
- **The reply (AC17).** `deny` with your words as its message: `decision.message` is exactly `yes but not on main`.
  Without words no message is required.
- **"Adds under 1 ms at p95 in the hub" (AC18).** Read as the hub's own time to map one hook payload to its events,
  p95 per hook over at least 1,000 recorded payloads, not a difference of two round trips. The merge-base comparison
  is the perf lane's (p50 and peak memory, with the task's margin); the issue's limits are judged here.
- **"30 days of transcripts for 100 sessions" (AC18).** This job's floor for a session is 2,000 transcript lines
  (#62's bench uses transcripts of about 2,000 messages), so at least 200,000 lines in all, spread over 30
  calendar days.
- **Budgets off the reference Mac (AC18).** The design counts a timing budget only on a reference Mac on mains power,
  Low Power Mode off, thermal state nominal. Elsewhere the test runs the bench once (so a missing or empty bench
  still fails) and skips as INCONCLUSIVE with that reading; on a fit Mac, five runs after the warm-up are judged:
  PASS all within, FAIL all over by more than the margin, otherwise INCONCLUSIVE.

## Criteria to tests

Each test's name starts with `ACn #18.<first 8 hex of the SHA-256 of the criterion's text>`, computed as
`scripts/proof-change.mjs` computes it.

| ID | Criterion (short) | Tests | At this base |
|---|---|---|---|
| AC16 `#18.d4f60451` | twins fail the kit with "duplicate event ID" naming the ID and "event after stop" naming the turn; the adapter passes both cases; a shape-only kit fails this test | `kit.test.ts` (3): the `duplicate-event-id` twin; the `event-after-stop` twin; (wrong program) the shape-only kit | fails (no `shippedFill`) |
| AC17 `#18.c798e28d` | through the runner: deny with "yes but not on main" for decision none; deny for an "Allow" label declaring deny; allow only for decision allow; label or "yes" readers fail naming the case | `permission.test.ts` (4): the three replies; (wrong program) the reply assertion on both twins; the runner on the label twin; the runner on the yes twin | fails (no `shippedFill`; the runner can't import it) |
| AC18 `#18.42323f56` | mapping a hook payload adds under 1 ms at p95 in the hub; backfilling 30 days of transcripts for 100 sessions under 2 minutes; compared with the merge base | `budgets.test.ts` (3): the two perf-lane tasks; the map budget; the backfill budget | fails (no tasks, no bench) |

## Wrong programs

| Twin | Criterion | Where | What it does | How the test fails on it |
|---|---|---|---|---|
| `duplicate-event-id` | AC16 (the issue's twin) | `shippedFill(…, { planted })` | maps the PreToolUse and the PostToolUse of one call (one `tool_use_id`) to one event ID | the kit fails it with "duplicate event ID" naming the ID |
| `event-after-stop` | AC16 (the issue's twin) | `shippedFill(…, { planted })` | opens a new turn for a PostToolUse that arrives after its turn's Stop | the kit fails it with "event after stop" naming the turn |
| `shapeOnlyKit` | AC16 | `wrong.ts` | a kit that checks only reply shapes | it passes both twins, so the assertion throws naming each twin |
| `allow-from-label` | AC17 | `shippedFill(…, { planted })` | `permissionReply` answers `behavior: allow` when the chosen option's label reads "Allow", whatever `decision` says | the reply assertion fails naming the "Allow" case; the runner exits 1 naming that case |
| `allow-from-yes` | AC17 | `shippedFill(…, { planted })` | `permissionReply` answers `behavior: allow` when your words contain "yes", whatever `decision` says | the reply assertion fails naming the words case; the runner exits 1 naming that case |

Each planted twin changes exactly one behavior of the shipped adapter's fill. AC18 names no wrong program; a bench
that maps or backfills nothing fails its reading checks, and a slow one fails the judge.

## Disputes

- **No recorded `git push origin main` (AC17).** The corpus holds no PermissionRequest for that command.
  `fixtures/permission-request.json` is Claude Code 2.1.304's recorded Bash PermissionRequest
  (`adapters/corpus/claude-code/2.1.304/tools/events.jsonl`) with three fields changed: `tool_input.command` is
  `git push origin main`, `tool_input.description` is `Push main to origin`, and the suggestion's rule is
  `Bash(git push:*)` with `behavior: allow`. A suggestion is not a decision, so a reply taken from it fails too.
  If the implementer records a real one into the corpus, a redraft may point the fixture at it.
- **"Through the conformance runner" (AC17).** The runner prints only case lines, so the reply's `behavior` and
  `message` are checked through the adapter's `permissionReply`, and the runner is held to failing the twins naming
  the case and passing the adapter.

## Notes for the implementer (observed at this base, not tested beyond the criteria)

Running adapter@1 on a fill built from today's shipped Claude Code adapter (a scratch run, not part of this suite):

- The runner refuses it at load: its doctor item code `claude.binary` isn't in doctor.item@1's codes, and its facts'
  `readUsage.conformance` names `claude/readUsage/model-switch`, a case the kit doesn't have.
- With both bypassed, `hooks/late-event-in-stopped-turn` fails ("event after stop": the facts map no `turn`), and the
  kit's only duplicate-ID check, `drive/order-by-seq`, needs `startTurn`, which Claude Code's terminal surface lists
  unsupported, so it can't catch a duplicate event ID from hooks (INVALID).
- `twins.json` (the before lane's twin folders) is left to the implementer; the twins above are reached through
  `planted`.

## Files

- `helpers.ts`: the environment, temp folders, `shippedFill` and `permissionReply` read through the public entry,
  the recorded request line, the conformance runner as a process, the machine gate and the timing judge.
- `wrong.ts`: the shape-only kit.
- `kit.test.ts` (AC16), `permission.test.ts` (AC17), `budgets.test.ts` (AC18).
- `fixtures/permission-request.json`: the recorded request (Disputes).
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit.
