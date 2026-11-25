# Acceptance tests for #3250: a stop's recorded cost keeps "at least" and the cache-write split

Written first, from issue #3250 (its body, scope and four acceptance criteria; it has no comments), AGENTS.md (Proof)
and the design section the issue links (Plan usage, per account and per task), at base commit `118ec119f`, by a job
that never saw an implementation. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to
a blind redraft of this job.

## Redraft

Redrafted once, on a dispute about the base, not the implementation: a session's reading subject, and its
`deep numbers` line, name it as `session:<id with its hyphens removed>` (the record's subject pattern
`^session:[0-9A-Za-z]+$`), and #26's stand-in gives hyphenated UUIDs, so the first draft's `sessionRow` and
`sessionLine` (`includes(id)`) could never find the session's `spend.usd`. They now match `session:<id>` exactly, with
the id as given or with what isn't a letter or digit taken out (`world.ts`). Test names, tags and assertions are
unchanged; `BASE-FAILURE.txt` is the rerun.

## What was read

At the base, only to learn the surfaces: `packages/hub/src/core.ts` (`recordUsage`, where a Claude Code stop becomes a
`turn.usage@1`, and the comment saying its cost drops the count's "at least"), `packages/hub/src/numbers.ts`
(`numbersLines`, the `deep numbers` line), `packages/hub/src/log-reads.ts` (events.read gives each event's `v`),
`packages/readings/src/record.ts` (`spend.usd`, `cost.turn`, `tokens.session` from turn.usage), `packages/readings/src/usage.ts`
and `types.ts` (#3158's count: `cache_write_5m`, `cache_write_1h`, a cost's `at_least`),
`packages/contracts/schemas/turn.usage@1.json`, and the suites `tests/acceptance/3158/` (the dependency),
`tests/acceptance/45/` (hub.test.ts, events.ts) and `tests/acceptance/26/helpers.ts` (the hub, the agent stand-in, seeding).

## Run them

```sh
npm ci && npm run build --workspaces     # once: the hub and `deep` run from the built CLI
cargo build --locked -p deep-hook         # once: the hub refuses to start without it
npx vitest run tests/acceptance/3250 --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/3250/tsconfig.json
```

Node 24 (`.node-version`). No agent, no network, no model call. Each test starts its own hub
(`deep hub run`) in a temporary home under `/tmp` (26's `tempDir`, short for the socket path), and #26's `cleanup` stops
every process it started, by PID, and removes the folders (`world.ts`, `tidy`, removes one again with retries when a process the hub started was still
writing there). The suite imports `tests/acceptance/26/helpers.ts`, so a
lane picks #26's binaries for it.

## Surfaces this suite assumes

1. **A Claude Code stop through a real hub** (`stop.test.ts`). #26's agent stand-in (`fixtures/agent.mjs`) sends each
   hook to the hub's socket as deep-hook does, from a process the agent started, so the hub verifies the session. Its
   transcript is `<home>/.claude/projects/<cwd>/<session>.jsonl`. A turn is UserPromptSubmit, PreToolUse, the
   transcript's prompt and assistant lines, then Stop (`world.ts`, `turn`). The hub writes the stop's `turn.usage` off
   the hook's path; the test waits on events.read for it, for at most 60 s.
2. **A transcript line** as Claude Code 2.1.299 and later write it: the write total in
   `message.usage.cache_creation_input_tokens` and the split in `message.usage.cache_creation.ephemeral_1h_input_tokens`
   and `.ephemeral_5m_input_tokens`. "No split" is the total and no `cache_creation` at all. Every message is on
   `claude-opus-4-5`, which the shipped rate card prices, so each cost is an estimate.
3. **`turn.usage@2`**: the event's `v` as events.read gives it is `2`.
4. **The two parts in `turn.usage@2`'s tokens.** The issue names no field. The suite takes any number anywhere under
   `data.tokens` whose key path matches `1h`, `one hour` or `hour` as the one-hour part and `5m`, `five min` or `minute`
   as the five-minute part (`cache_write_1h` and `cache_write_5m`, as #3158's count names them, both match, and so does a
   nested `{ cache_write: { one_hour, five_minute } }`).
5. **`input`** stays `data.tokens.input`, taking the writes in whole, as `turn.usage@1` recorded it: input tokens plus
   every write token.
6. **"Reads at least"**, read as 3158 reads it: any field whose name matches `at least` (`at_least`, `atLeast`,
   `at-least`) set `true`, or any text saying "at least", at any depth. It is read on a `turn.usage`'s `data.cost`, on
   a `numbers.read` row (the whole row, its `cost` included), and in `deep numbers` output.
7. **Readings** come from `numbers.read` (`rows`): `spend.usd` and `tokens.session` with subject `session:<id>`, the id
   as given or with everything but letters and digits taken out (the record's subject is `^session:[0-9A-Za-z]+$`), and
   `cost.turn` with the turn (`data.turn`, the user.ask's id) as subject, each with `value` and `cost`, as at the base.
8. **The session's `deep numbers` line** is the line that starts with `spend.usd session:<id>:`, the id in either form
   of 7. For AC1 it
   must match `/at least/i`, words a person reads, not a field name.
9. **A record of @1 events** (`record.test.ts`): `turn.usage` events appended with `v: 1` through the real record before
   the hub starts (26's `seed`), in the shape the hub wrote at the base: `covers: session` running totals, estimated,
   for a Claude Code session; and `covers: turn` events, one reported and one unpriced.

## Criteria to tests

Each test's name starts with its criterion's tag. Each is a top-level `it`. None asserts with `toThrow`, and none waits
for time to pass: each waits on the event it needs, and the one bound (60 s for a turn.usage) is marked `// deadline:`.

| Criterion | Test | What it asserts | At the base |
|---|---|---|---|
| `#3250.1334628e` | `stop.test.ts` (1) | A stop whose one message wrote 1,000,000 tokens with no split: the hub's turn.usage is `v: 2`, its cost is estimated and reads "at least"; the session's `spend.usd` row reads "at least"; its `deep numbers` line says "at least" | fails: `v` is 1 |
| `#3250.060b349a` | `stop.test.ts` (2) | A stop whose transcript has a message with 300,000 one-hour writes and one with 800,000 five-minute writes, each with 10 input tokens: its `tokens.input` is 1,100,020, as @1 recorded it; it is `v: 2`; its tokens hold a one-hour part of 300,000 and a five-minute part of 800,000 | fails: `v` is 1 (the input assertion before it passes: the base's @1 records 1,100,020) |
| `#3250.639cf1ce` | `stop.test.ts` (3) | Two stops, every message giving its split (one-hour only, five-minute only, and both): each turn.usage is `v: 2` and reads no "at least"; no `numbers.read` row and no `deep numbers` line says "at least" | fails: `v` is 1 |
| `#3250.b5e3837c` | `record.test.ts` (1) | A record of four `turn.usage@1` events reads the spend and tokens the base reads (below), with the cost's basis and card; nothing reads "at least" | passes: by design |

## The frozen readings

`record.test.ts` seeds three sessions. The values are the base's readings of them, by its rules in
`packages/readings/src/record.ts`: a `covers: session` event is a running total whose growth is the turn's, tokens are
input + cached + output, and no cost is unpriced, never $0. The base run confirms each.

| Session | Events | `spend.usd` | `tokens.session` | `cost.turn` |
|---|---|---|---|---|
| Sa | session totals: 1,100,020 / 10,000 / 400 at 7.00, then 2,000,020 / 20,000 / 900 at 12.50, estimated | 12.5, estimated, card `anthropic-list-2026-10` | 2,020,920 | 7, then 5.5 |
| Sb | one turn: 100 / 0 / 50, reported 0.25 | 0.25, reported | 150 | 0.25 |
| Sc | one turn: 10 / 0 / 5, unpriced | null | 15 | (unpriced) |

`BASE-FAILURE.txt` is the base run: the three `stop.test.ts` tests fail at the `v: 2` assertion, each printing the
@1 event the base wrote; `record.test.ts` passes.

## Passing at the base, and the wrong programs

The implementing agent supplies these as planted twins.

| Criterion | The wrong program | Where the test fails it |
|---|---|---|
| 1334628e | The merge base: writes turn.usage@1 with the "at least" dropped | `v` is 1 |
| 1334628e | One that writes @2 with "at least" on the event but sums spend.usd without it | the spend.usd row's "at least" |
| 1334628e | One that carries it on the reading but `deep numbers` prints the basis alone | the line's "at least" |
| 060b349a | The merge base: @1, no parts | `v` is 1 |
| 060b349a | One that writes the parts but leaves the writes out of `input`, or counts them twice | `input` is 1,100,020 |
| 060b349a | One that keeps one part, or swaps them | the part assertions |
| 639cf1ce | The merge base: @1 | `v` is 1 |
| 639cf1ce | One that reads "at least" on every estimate, or on any session with one-hour writes | the event's, the rows' or the lines' "at least" |
| b5e3837c | None at the base: the test passes there by design. A reader that drops @1 events, reads their cost or tokens otherwise (for example sums running totals, or takes an unpriced cost as 0), or says "at least" on an @1 cost | the readings' values, or the "at least" assertions |

`639cf1ce`'s "never reads at least" half passes at the base, since nothing there says so; its `v: 2` assertions make
it fail there, and its twin is the "at least on every estimate" reader.

## Left open

- **A task's `spend.usd`** (scope) isn't asserted: the criteria name the session's.
- **Codex's readings unchanged** (scope) has no criterion and no test.
- **The `deep numbers` line's wording** beyond "at least" (where it sits, whether the amount stays) isn't pinned.
- **A mixed session**, an @1 event followed by an @2 one, isn't asserted.
- **The amount** of an "at least" cost isn't asserted here; #3158 holds the price.
