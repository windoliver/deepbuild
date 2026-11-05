# Acceptance tests for #87, part `models`: who answered a review, and whether it counts

Written first, blind, from issue #87 ("Check kinds: review by a second model, and numbers re-run against their
source": its Scope, Fields and acceptance criteria), the design sections it links and those around them in
`docs/technical-design.md` (In version 0; How runs become one of five verdicts; the Check primitive; Plan usage per
account and per task, with "Turns DeepBuild causes"; Threats; the Runner; Facts as data; How we know version 0
works: Conformance tests, Wrong programs, Dogfooding), `AGENTS.md`, the acceptance tests of #68 and #159 for their
shape, and the base commit `29d29ba5` (origin/main), where these surfaces were read: `packages/runner` (#159: how it
reads a job's output, model and usage, its window readings and reserve, its planted switches), `packages/adapters`
and `adapters/*.facts.json` (`modelFamily`, `launch.readOnlyJob`, `versions`), `packages/verdicts` (`verdict`, the
run outcomes `uncounted` and `missing`, a model's check as a reading), `packages/budget` and `packages/conformance`
(`KindBudget`). The job never saw an implementation. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job.

Four blind jobs share #87's criteria. This one, `models`, holds seven: the plan window, the same-model criterion with
its two wrong programs, "model unknown", the review half of the budgets, canonical IDs, the answering model by output
tokens, and the proxied route. The `review` job's tests hold the findings (items, rubric, send-backs, rounds, fixed or
left), the `numbers` job's the numbers check, and the `gate` job's the done gate, hub and preflight.

## Environment and running

macOS (the runner starts every job through the supervisor's Seatbelt sandbox), Node 24.22.0 (`.node-version`), from
the worktree root, after `npm ci`:

```sh
npx vitest run --root tests/acceptance/87/models --testTimeout=600000
npx tsc -p tests/acceptance/87/models/tsconfig.json
```

Nothing needs the network, a real `claude`, a sign-in or a model call. Every review job is a real job through the
real runner, opened by #159's test world (`tests/acceptance/159/world.ts`: a real record on SQLite, the asks core,
the budget ledger and the supervisor), with #159's safety: folders under `/tmp/dh159-*`, a temp `HOME` with a fake
sign-in, processes stopped by PID only. Its `claude` is this folder's fake (below).

## The surface under test

The issue names the review check, the runner reading the answering model, each agent's facts naming a model's family,
canonical IDs, and each adapter recording the route at session start, but no code API. These tests define the
smallest one they need, in three places: the review check's new workspace package, where the `review` job defines
its findings surface in the same entry (the names here are about models, independence, routes and the plan window,
so the two don't collide); one operation on the adapter contract; and one planted switch on the runner. Everything
is reached through public entries, and the review check and the adapter's new operation are imported or called
lazily, so each test fails on its own at the base.

```ts
// @deepbuild/checks-review — packages/checks-review/src/index.ts (new workspace package)
import type { KindBudget } from '@deepbuild/conformance';
import type { SessionRoute } from '@deepbuild/adapters';
import type { JobRecord } from '@deepbuild/runner';
import type { ClaimCheck, Run } from '@deepbuild/verdicts';

/** The session that made the change, as the review check reads the model that made it: its agent, its transcript as
 *  the agent wrote it (JSONL), and the route its adapter recorded at its start. The review's second model never
 *  reads any of it; only the check does, to decide whether the review counts. */
export interface ChangeSession { agent: 'claude-code' | 'codex'; transcript: string; route: SessionRoute }
/** Where a review job's run lands: the claim and the commit it reviews, and the review check as the claim selected
 *  it (its digest, environment and tools key the run, so the verdict engine counts it). */
export interface ReviewAt { claim: string; commit: string; check: ClaimCheck }
/** Whether a review counts toward its claim. Models are compared by canonical ID: a context suffix such as `[1m]`, a
 *  date suffix, `-latest`, a cloud prefix such as `us.anthropic.` and a Bedrock version suffix such as `-v1:0` are
 *  dropped before the comparison and before the family lookup, which reads each agent's facts. */
export interface Independence {
  /** The model that answered the review, exactly as the runner recorded it from the job's own output
   *  (`JobRecord.model`), or 'unknown'. */
  answered: string;
  /** The model that made the change, by canonical ID, read from its session's transcript only on the agent's own
   *  route; 'unknown' when the transcript names none, or behind a base URL or model provider other than the agent's
   *  default (Bedrock and Vertex name their own models, so they stay known). */
  change: string;
  counted: boolean;
  /** Why it is uncounted, null when it counts: "review not independent: same model" (the change's model answered);
   *  "model unknown" (the job's output names no model, or no agent's facts name its family); "model unknown: proxied
   *  route" (the change's model is unknown because its session was proxied). */
  reason: string | null;
  /** What the claim's verdict line says of it: "same-family review" when another model of the change's family
   *  answered and the review counts; null otherwise (another family, or uncounted). */
  note: string | null;
}
export interface ReviewJobRun {
  /** The review's run record, as the core's verdict reads it: `run` is the job's run (`JobRecord.job`); outcome
   *  'missing', with `missing: { cause: 'plan window', owner: 'you', since }`, while the job waits at your reserve;
   *  'uncounted' when `independence` says so; otherwise the outcome its findings give (the `review` job's surface). */
  run: Run;
  /** Null while the job hasn't answered (waiting, or stopped before an answer). */
  independence: Independence | null;
}
/** Planted wrong programs these tests select; tests only. drops-same-family: a review by another model of the
 *  change's family is uncounted. raw-names: models compared by their raw names. raw-family: the family looked up by
 *  the raw name. trusts-proxied-transcript: the transcript's model read whatever the session's route. */
export type ModelPlant = 'drops-same-family' | 'raw-names' | 'raw-family' | 'trusts-proxied-transcript';
/** A review job, as the runner recorded it (finished, or waiting), turned into its run for the claim. */
export function reviewJobRun(job: JobRecord, change: ChangeSession, at: ReviewAt, plant?: ModelPlant): ReviewJobRun;
/** The review check's priced budget per run: the wall time a review may take, in ms, from submitting its job to
 *  its run record, and what it may cost, in US dollars, as the job's own output reports its cost. */
export const reviewBudget: KindBudget;
```

```ts
// @deepbuild/adapters — packages/adapters/src/types.ts, SessionRoute exported from its index
/** What an adapter records at a session's start about the route to its model: each variable or setting its facts
 *  name, by name, whether it was set, true or false, never its value. Claude Code: ANTHROPIC_BASE_URL,
 *  ANTHROPIC_AUTH_TOKEN, Bedrock (CLAUDE_CODE_USE_BEDROCK) and Vertex (CLAUDE_CODE_USE_VERTEX); Codex: whether its
 *  model provider or OPENAI_BASE_URL differs from its default. */
export type SessionRoute = Record<string, boolean>;
export interface Adapter { /* as at the base, plus: */
  /** The route of a session started in `env`, the environment the agent gave its hooks at session start. */
  routeAtStart?(env: Readonly<Record<string, string | undefined>>): SessionRoute;
}

// @deepbuild/runner — packages/runner/src/types.ts
/** As at the base, plus 'first-model-listed': records the first model the job's output lists in its usage. */
export type Plant = /* the base's four */ | 'first-model-listed';
// JobRecord.model: the model with the most output tokens in the job's usage, as its output reports it, or 'unknown'.
```

Nothing else: no option, flag or export beyond these.

### The fake CLI

`fixtures/fake-claude.pl` (`/usr/bin/perl`, which runs inside Seatbelt with only the system's own runtime) is
installed as `claude` in a folder of its own, first on the login shell's PATH the runner records. It answers
`--version` with the newest version Claude Code's facts cover and `auth status` as signed in, refuses to start with
`CLAUDECODE=1` as Claude Code does, and for a headless run prints one recorded stream-json run, the one its prompt
names on a line `@stream <name>`. The runs (`STREAMS` in `helpers.ts`) are in Claude Code's own shapes, as #159's fake
and the corpus have them: `system/init` naming the launched model, assistant messages with `message.id`,
`message.model` and `message.usage`, and a `result` with `total_cost_usd`, `usage` and `modelUsage` in the order
listed. Each review job is launched for `gpt-5-codex` (`JobSpec.model`) unless a test says otherwise.

## Criteria to tests

| Criterion (its start) | Test file | Wrong programs |
|---|---|---|
| With the window at your reserve, the review waits and the claim shows BLOCKED with the cause plan window | `plan-window.test.ts` | — |
| A change made in a Claude Code session on `claude-opus-4-1`, reviewed by a job launched for `gpt-5-codex` whose own output names `claude-opus-4-1`… | `same-model.test.ts` | the runner's `records-launched-model` (#159's switch); `drops-same-family` |
| A review job whose output names no model is an uncounted run naming "model unknown"… | `model-unknown.test.ts` | — |
| Budgets…: a review check stays within its priced budget (the review half) | `budgets.test.ts` | — |
| A change made on `claude-opus-4-1-20250805[1m]`, reviewed by a job whose output names `us.anthropic.claude-opus-4-1-20250805-v1:0`… | `canonical.test.ts` | `raw-names`; `raw-family` |
| A Claude Code review job whose usage lists `claude-haiku-4-5` with 40 output tokens first and `claude-sonnet-4-5` with 3,000… | `answering-model.test.ts` | the runner's `first-model-listed` |
| A change made in a Claude Code session started with `ANTHROPIC_BASE_URL` at a local listener… | `proxied-route.test.ts` | `trusts-proxied-transcript` |

What each holds:

- **Plan window.** Reserve 10%, the account's 5-hour window at 92% (as #159's AC11). The review job, submitted as the
  check submits it (kind `review`, the diff as its prompt, naming the claim and task), is `waiting` with no process
  and `blocked: { status: 'BLOCKED', cause: 'plan window', owner: 'you' }`; `reviewJobRun` makes its run `missing`
  with cause `plan window`, owner `you`; the core's verdict on the claim is BLOCKED, a reason naming plan window.
- **Same model.** The change's session transcript names `claude-opus-4-1`; its route is unproxied. Three review jobs
  launched for `gpt-5-codex`, whose outputs name `claude-opus-4-1`, `claude-sonnet-4-5` and `gpt-5-codex`. The first:
  `answered` is `claude-opus-4-1`, uncounted, "review not independent: same model", its run `uncounted`, and the
  claim, with no other review, INCONCLUSIVE. The second counts, note "same-family review". The third counts, no note.
  With the runner's `records-launched-model` switch the first records `gpt-5-codex` and counts, and the test fails
  naming that; with `drops-same-family` the second is uncounted and the test fails naming it.
- **Model unknown.** A review job whose output names no model (no init model, no message model, no `modelUsage`):
  the runner records `unknown`; the review is uncounted, "model unknown", its run `uncounted`; the claim isn't PASS.
- **Budgets.** `reviewBudget` declares a time and a cost above 0; a review (job through the runner, then its run
  record) takes no longer than `time_ms`, and the job's reported cost is within `cost_usd`.
- **Canonical IDs.** The change's transcript names `claude-opus-4-1-20250805[1m]`. A review whose output names
  `us.anthropic.claude-opus-4-1-20250805-v1:0` is uncounted, "review not independent: same model"; one naming
  `claude-sonnet-4-5-20250929` counts with "same-family review", and neither its reason nor its note says "model
  unknown". `raw-names` counts the first; `raw-family` reads the second's family as unknown; each fails the test.
- **Answering model.** A Claude Code review job launched for `claude-sonnet-4-5` whose messages are sonnet's (3,000
  output tokens) and whose `modelUsage` lists `claude-haiku-4-5` (40) first and `claude-sonnet-4-5` (3,000) second
  records `claude-sonnet-4-5`; the runner's `first-model-listed` records `claude-haiku-4-5` and fails the test.
- **Proxied route.** A real loopback listener; Claude Code's adapter records the session's route from an environment
  with `ANTHROPIC_BASE_URL` at it: `ANTHROPIC_BASE_URL: true`, and neither the route nor the review's run and
  independence hold the URL or `127.0.0.1:<port>`. A review answered by `gpt-5-codex`: `change` is `unknown`,
  uncounted, "model unknown: proxied route", the claim not PASS. The same session with the variable unset:
  `ANTHROPIC_BASE_URL: false`, `change` is `claude-opus-4-1`, the review counts. `trusts-proxied-transcript` counts
  the first and fails the test.

## Readings where the issue leaves a choice

- **Family.** The criteria fix it: `claude-opus-4-1` and `claude-sonnet-4-5` are one family, `gpt-5-codex` another.
  The facts' `modelFamily.families` at the base names neither of the first two and groups models by rate card (opus,
  sonnet, haiku), which would part them; so each agent's facts need the family the review compares named per model
  (Claude Code's facts for the Claude models, Codex's for `gpt-5-codex`). How the facts carry it is the
  implementer's. A canonical ID no agent's facts name is "model unknown", which is why `raw-family` fails.
- **The answering model is the runner's.** The review check reads `JobRecord.model`, which the runner read from the
  job's own output (#159), and never the model it asked for. A check that records the model it asked for is planted
  through the runner's existing `records-launched-model` switch, which puts the launched model in the record. The
  "same model" job is a Claude Code job launched for `gpt-5-codex`, as the criterion words it; `codex exec --json`
  names no model at the base, so a Codex review job records `unknown` there, and these tests don't lean on it.
- **"Most output tokens in its usage"** reads `result.modelUsage`'s `outputTokens` for Claude Code. In the recorded
  run the assistant messages are all sonnet's, as in a real run, where Claude Code's own small haiku calls show only
  in `modelUsage`; the base's runner, which takes the last message's model, already records sonnet here, so the
  criterion's force is its wrong program (BASE-FAILURE.txt).
- **Uncounted is the core's.** The review's run is a `Run` with outcome `uncounted`, which the verdict engine never
  counts; with the claim's other check passing, the review check's "0 of 1 clean runs" leaves the claim
  INCONCLUSIVE. The reason and the verdict-line note live on `Independence`; how the gate puts the note on the line
  is the `gate` job's. A counted run's outcome comes from its findings, which are the `review` job's, so these tests
  hold only that a counted run isn't `uncounted`, and judge the claim only where the outcome is the counting's own
  (uncounted, missing).
- **Plan window.** The runner already waits at your reserve (#159's AC11). How the check builds its job (prompt,
  rubric) is the `review` job's; the test submits it as the check would (kind `review`, the diff, the claim and
  task). The check's half is that a waiting job's run is `missing`, cause `plan window`, owner `you`, so the core
  shows BLOCKED.
- **The route.** "Each adapter records at session start" is an adapter operation, `routeAtStart`, driven by its facts
  as the contract wants. Its input is the environment the agent gave its hooks at session start; deep-hook already
  carries such booleans for billing keys in a SessionStart request, never a value, and where the hub gets the route's
  booleans from (deep-hook's line, as for billing) is the implementer's. The "local listener" is a real loopback HTTP
  listener; nothing connects to it. The record's half is held on what the adapter and the check record.
- **Budgets.** As #68 read it: the check's `KindBudget` (`time_ms`, `cost_usd`); "on the reference Mac in the local
  preflight, compared with the merge base" is the preflight's budget window, and the merge base has no review check,
  so there is no base side. The cost is the job's reported `total_cost_usd` (a plan-billed job reports it too).
- **One run per test where the criterion allows.** The two wrong programs of a criterion rerun its scenario with the
  switch; each is expected to fail on the assertion the criterion names, by its message.

## Files

- `helpers.ts`: lazy imports, the recorded runs and the fake's install, review jobs through #159's world, the
  change's session (transcript and route), and the core's verdict on the claim.
- `fixtures/fake-claude.pl`: the fake `claude`.
- `plan-window.test.ts`, `same-model.test.ts`, `model-unknown.test.ts`, `budgets.test.ts`, `canonical.test.ts`,
  `answering-model.test.ts`, `proxied-route.test.ts`: one per criterion, with its wrong programs.
- `BASE-FAILURE.txt`: the base run and the type check.
