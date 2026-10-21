# Acceptance tests for #603: agent.stop carries a stop's cause and each turn's usage

Written first, from issue #603 (its text as of October 20), the design lines it cites (technical-design.md:145
on stop causes and usage; canvas-primitives.md:562, the event catalogue's `agent.stop` row) and the base
commit `f346706` (origin/main, no implementation), by a job that never saw an implementation. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

Run them (offline; the repo's `vitest.config.ts` also takes `tests/**/*.test.ts`, so the unit lane runs them):

```sh
npm ci                      # once, if node_modules is missing
npx vitest run --root tests/acceptance/603
```

`codegen.test.ts` runs `cargo build --locked -q -p deep-contracts --bin deep-contracts` first, as
`packages/contracts/test/rust-checks.test.ts` does. Two tests type-check a small module against the committed
generated types with the repo's own `node_modules/typescript`, in a folder under the OS temp folder. The AC3
tests copy `adapters/corpus/` to a temp folder before changing anything; the real corpus is never edited. The
whole run takes a few seconds once the Rust binary is built. On the base all 29 tests fail on an assertion, as
`BASE-FAILURE.txt` shows, with the planted programs the tests were run against.

## The surface under test

Only what the base already exposes, and the files it already has:

- `@deepbuild/contracts`' public entry, `packages/contracts/src/index.ts`: `listSchemas`, `getSchema`,
  `fixtures`, `validate` (with its issues' JSON Pointer `path`), `decode`, `catalogue`, `checkViewBindings`,
  `frozenDigests`, `frozenDrift`, `d1Digest`, `generateTypeScript`, `generateRust`.
- The committed generated files, `packages/contracts/src/generated/types.ts` and
  `crates/deep-contracts/src/generated.rs`. The tests find the TypeScript type of each version by the doc
  comment the generator writes above it (`/** agent.stop@2 */`), so they don't depend on its name.
- The `deep-contracts` binary's `check <schema>` (one `ok` or `refused …` per line, the command the
  `rust-checks` differential uses) and `roundtrip <schema>`, both over the generated Rust `from_json`.
- The adapters' public entry, `adapters/index.mjs` (`replaySession`), over the recorded sessions and the facts
  files `adapters/claude-code.facts.json` and `adapters/codex.facts.json`.
- `node scripts/corpus.mjs replay [--corpus <dir>]`, its JSON lines (`payload` lines with `result` and `diffs`,
  the `summary` line's `verdict`).
- `adapters/corpus/<agent>/<version>/<session>/events.jsonl` (each payload's stored `expect`) and
  `transcript.jsonl`, read as files.

## The contract the tests hold an implementation to

The planted stops are agent.stop@1's published fixture with `v: 2` and a new `data`:

```json
{"turn": 7, "did_work": true, "cause": "<one of the eleven>", "plan_resets": 1760020000000, "usage": null}
```

with `plan_resets` only when the cause is `plan_window_spent`, and `usage` either `null` or, as the issue's
Shape gives it:

```json
{"covers": "turn", "model": "claude-haiku-4-5",
 "input": {"value": 1200, "exact": true}, "cached": {"value": 800, "exact": true}, "output": {"value": 64, "exact": true},
 "context_fill": 0.42, "cost": {"usd": 0.0125, "basis": "reported"}}
```

or the same covering the session, with estimated counts and `"cost": {"usd": 0.031, "basis": "estimated",
"rate_card": "openai-2026-10"}`.

1. **AC1.** Each of the eleven causes validates, with usage null and with a usage. A cause outside the set
   (the agent's own error names such as `overloaded` or `rate_limit`, `finished`, case or spacing variants, the
   empty string, a non-string) or no cause is refused with an issue at `/data/cause`. `plan_window_spent`
   without `plan_resets` is refused at `/data/plan_resets`, as is a `plan_resets` that isn't a whole number, and
   every other cause with a `plan_resets`.
2. **AC2.** Usage null validates for every cause; a stop without `usage` is refused at `/data/usage`. A count
   `{value: 0, exact: false}` is refused at `/data/usage/<count>` while its twin `{value: 0, exact: true}` and
   `{value: 5, exact: false}` validate. An estimated cost without `rate_card` is refused at `/data/usage/cost`
   while its twin with one validates; a reported cost with a `rate_card`, and a basis outside reported,
   estimated and unpriced, are refused there. `covers` outside turn and session, a count without `exact`, a
   bare number or -1 as a count, and a `context_fill` outside 0 to 1 are refused at their field. A missing
   count written as null (in one of the forms under Readings) validates.
3. **AC3.** Replayed through `replaySession`, every recorded `Stop` and `StopFailure` payload of both agents
   (58 on the base corpus) maps to an `agent.stop` whose data has `cause` in the set and a `usage` key, null or
   an object, and that cause and usage (with `plan_resets` when written) make valid agent.stop@2 data. The
   facts entry the adapter names for each stop (`rule`) exists in that agent's facts file. Some stop of each
   agent carries a non-null usage, and a usage's `model`, when a string, is one the session's transcript names.
   `node scripts/corpus.mjs replay` passes, and every recorded stop's stored `expect` carries `cause` and
   `usage`. Replacing every word the agent wrote (each stop payload's `last_assistant_message`; Claude Code's
   assistant text and thinking blocks; Codex's assistant messages, `agent_message`, `task_complete`'s
   `last_agent_message` and completed `AgentMessage` items) with planted text naming several causes changes no
   stop's cause or usage, and the replay of that copy still passes. Changing only Claude Code's `StopFailure`
   payload `error` to `rate_limit`, `overloaded`, `authentication_failed` or `oauth_org_not_allowed` gives
   `rate_limited`, `rate_limited`, `sign_in_required` and `sign_in_required`, and the replay reports that stop
   as a mismatch at its cause.
4. **AC4.** The committed `types.ts` and `generated.rs` equal the generators' output over `listSchemas()`, and
   the Rust dispatch names `agent.stop@2`. Under the root tsconfig's strict options, the TypeScript type's
   `data.cause` is exactly the eleven strings; `plan_window_spent` needs `plan_resets`, which narrows to a
   `number` there and doesn't exist on any other cause; `usage` is required, may be `null` (reading it unchecked
   is an error) and its `covers` is `'turn' | 'session'`. Rust round-trips a usage-null stop, a stop with a
   usage and a `plan_window_spent` stop back to the same JSON (a null usage stays `null`). Over 50 planted stops
   (every cause with usage null and with a usage, every other cause with `plan_resets`, and the AC1 and AC2
   refusals), the TypeScript validator gives each its expected verdict and `deep-contracts check` gives the
   same verdict on every one. agent.stop@2 has fixtures, which validate and Rust takes, among them one with
   usage null, one with a usage and one `plan_window_spent`. The catalogue lists `agent.stop` at versions 1
   and 2, with schemas `agent.stop@1` and `agent.stop@2`. agent.stop@1's frozen digest and its schema's d1 are
   still the base's `d1:19afe153…b236`, it still refuses a `cause` or `usage` in its data, agent.stop@2's frozen
   digest is its own d1, and `frozenDrift` is empty.
5. **AC5.** Both versions are catalogued as feeding `claims`, and `checkViewBindings(['agent.stop'])` is ok. A
   stop of either version decodes with the same `turn` and `did_work`, for every cause, with usage null or not.
   agent.stop@2 refuses a stop without `turn` or `did_work`, a non-boolean `did_work` or a negative `turn`
   under every cause. One TypeScript function `(event: AgentStop | <its v2 type>) => {turn, did_work}`
   type-checks against the generated types.

## Readings where the issue leaves a choice

- **The cause spellings.** The issue's Shape spells only `unknown` and `plan_window_spent`. The base already
  spells the whole set: `adapters/corpus/README.md` ("Stop causes", the closed set as slugs:
  `sign_in_required`, `token_refresh_failed`, `plan_window_spent`, `rate_limited`, `refusal`, `max_turns`,
  `context_overflow`, `tool_schema_rejected`, `agent_crashed`, `timed_out`, `unknown`), and
  `adapters/claude-code.facts.json` maps to them. The tests use those eleven and hold the generated type's
  cause to exactly them.
- **Field spellings** are the Shape's: `cause`, `plan_resets`, `usage`, `covers`, `model`, `input`, `cached`,
  `output`, `context_fill`, `cost`, `usd`, `basis`, `rate_card`, `value`, `exact`. `turn` and `did_work` stay,
  since AC5 reads them from version 2.
- **The envelope.** Only `data` changes between versions: a version 2 stop is agent.stop@1's published
  fixture with `v: 2` and a new `data`.
- **Refusal paths.** The tests hold each refusal to the field it refuses, by the base's error shape (a missing
  field's own pointer; a union's tag at the tag): `/data/cause`, `/data/plan_resets`, `/data/usage`, and for
  nested refusals any pointer at or under `/data/usage/<field>` (for a count, a union on `exact` may report
  at `/data/usage/input/value` or `/exact`; for a cost, at `/data/usage/cost/rate_card` or `/basis`).
- **"A missing count is null, never 0".** The issue doesn't say whether the count or its value is null. The
  base's closed node forms allow null beside one type but not beside a union, so either is plausible. The test
  takes any one of `null`, `{value: null, exact: false}` or `{value: null, exact: true}`.
- **What isn't pinned.** The values and types the issue leaves open aren't asserted beyond the Shape:
  whether `model` may be null, the form of an unpriced cost (only the basis name is held, by refusing others),
  whether an unpriced cost may carry `usd: 0` (the design's "never $0" suggests not; no criterion says so),
  the `rate_card` format (the tests use `openai-2026-10`), and whether `usd` must be positive. A `context_fill`
  of 0 and of 1 must validate, as a fraction.
- **The cause of a normal stop.** The closed set has no "finished" member, and the issue makes `cause`
  required, so a turn that simply ended must carry one of the eleven; the tests don't say which (presumably
  `unknown`).
- **"The facts map hook payloads, transcript error records and rate-limit records to a cause".** The tests
  hold it through behavior, without guessing a facts layout the issue doesn't give: every recorded stop's cause
  is decided by an entry of that agent's facts file (the `rule` pointer the adapter already writes for
  `deep explain`), and a change to the hook payload's error record moves the cause by the mapping the corpus
  README states. A planted transcript error record or rate-limit record is not tested: the issue doesn't give
  those records' formats for a stop that hits them, and the corpus records none that names a cause (Claude Code's
  `stop-failure` session has an `isApiErrorMessage` entry with `model_not_found`, which maps to `unknown` like
  its payload; Codex's `token_count` entries carry `rate_limits` with nothing reached). Planting one would mean
  guessing a format, so those two sources are proven only to the extent the recorded corpus reaches them.
- **"From the payload and never from the agent's text".** Usage comes from transcript records (the facts say
  so already: Claude Code's assistant `message.usage`, Codex's `token_count`), so the invariance test replaces
  only the agent's words and keeps every record. It replaces them in the stop payloads too.
- **A replayed stop's usage has the contract's shape.** The corpus events are the adapter's, not hub events
  (they carry `session`, `outcome`, `continued`), but the issue names the same `cause` and `usage`; the tests
  hold the replayed cause and usage to agent.stop@2's `data` by validating them inside a planted stop.
- **"The model that actually answered"** is held only as: a captured usage's `model`, when a string, is a
  `model` value the session's transcript holds. Which turn's model, and the counting rules, live in the facts
  and aren't pinned.
- **The `rust-checks` differential.** The repo's `packages/contracts/test/rust-checks.test.ts` mutates every
  published schema's fixtures, so it covers agent.stop@2 once the schema is published with fixtures. These
  tests don't run it again (the unit lane does); they require fixtures that reach the union and both usage
  forms, and run their own 50 planted stops through the same `deep-contracts check` command.
- **"The canvas's claims projection".** The base has no claims projection code. What it names is the binding:
  the catalogue entry's `feeds` (`x-feeds: ["claims"]` on agent.stop@1) and the canvas table's row
  (`agent.stop` `{turn, did_work}` feeding claims). The tests read "still reads `{turn, did_work}` from either
  version" as: both versions feed `claims`, both carry and require `turn` and `did_work` with the same types,
  decode gives the same reading from either, and one function over the generated types of both reads them.
- **"The catalogue lists both versions"** is `catalogue()`, built from the published schemas. The canvas
  table in `docs/canvas-primitives.md` isn't required to change.
- **The lint.** The base's schema lint (`lintSchemas`, run by `npm run generate`) is not one of the issue's
  criteria, so it isn't asserted here. Note for the implementer: its closed forms take only string union tags
  and no null beside a union, which bears on how a count can refuse `{value: 0, exact: false}` with `exact` a
  boolean.

## Criteria to tests

Each test's name starts with its criterion. Where a test catches a named wrong program, a comment at the
assertion says so.

| AC | Criterion (short) | Tests |
|---|---|---|
| AC1 | each cause validates, one outside is refused; `plan_resets` only with and required for `plan_window_spent` | `causes.test.ts` (4) |
| AC2 | usage null validates; count 0 with exact false and estimated without rate_card refused; missing usage refused | `usage.test.ts` (9) |
| AC3 | facts map the records to a cause; replay writes cause and usage for every stop, from the payload, never the agent's text | `corpus.test.ts` (5) |
| AC4 | generated TS and Rust carry the union and nullable usage; Rust refuses what TS refuses; catalogue lists both | `codegen.test.ts` (7) |
| AC5 | the claims projection reads `{turn, did_work}` from either version | `claims.test.ts` (4) |

## Files

- `helpers.ts`: the planted stops and usages, the cause set, refusal assertions, the Rust binary calls, the
  type check over the generated types, the corpus reader and scratch copy, the replay CLI call.
- `causes.test.ts`, `usage.test.ts`, `corpus.test.ts`, `codegen.test.ts`, `claims.test.ts`: the criteria above.
- `BASE-FAILURE.txt`: the run on the base, where all 29 fail on an assertion, and the planted programs.

No fixture holds a secret or personal data; the IDs and session IDs are made up or are the corpus's own,
already redacted.
