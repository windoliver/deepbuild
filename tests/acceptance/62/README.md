# Acceptance tests for #62: the learned layer over a base it never changes

Written first, from issue #62 (its Scope, the twelve acceptance criteria and its Proof), the design sections
it rests on (The learned layer, Reading by reference, One event log with tables built from it, the wiki row of
the extension table, Numbers version 0 has to hold, and How we know version 0 works, all in
`docs/technical-design.md`) and base commit `a8f844f`, by a job that never saw an implementation. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

Run them:

```sh
npm ci                                  # once, if node_modules is missing
npx vitest run tests/acceptance/62
```

They import `packages/record/src/index.ts`, `packages/contracts/src/index.ts` and
`packages/evidence/src/index.ts` by relative path with their `.ts` extension, as `tests/acceptance/14` does.

## The surface under test

The issue names events, a layer, a start slice, rollbacks and refusals, but no code API, so these tests use
the record's own surface (`openRecord`, `append`, `read`, `table`, `rebuild`) and add the smallest one they
need: two methods on `RecordStore`, and the `learned_layer` projection's columns.

```ts
// packages/record/src/index.ts, beside what #14 exports
export interface SliceEntry { target: string; text: string }   // the tests read only its text, and compare whole slices
export interface RecordStore {
  // … #14's methods …
  /** What the session reads at its start, and (for the rules you typed) at its next prompt. `session` is its bare ID. */
  startSlice(session: string): Promise<SliceEntry[]>;
  /**
   * Rolls back one learned change (by the ID of its learn.applied or learn.widened event) or everything learned
   * since a time (ms since the epoch, compared with each change's `ts`). Appends one learn.rolled_back per
   * compensated change, through `connection`, newest first, and deletes nothing. Resolves with the compensated
   * changes' event IDs in the order it compensated them.
   */
  rollBack(connection: Connection, what: { change: string } | { since: number }): Promise<string[]>;
}
```

### `learned_layer`

One row per `learn.*` event, keyed by the event's `id` (the stub's key). The tests read these columns:

| Column | Holds |
|---|---|
| `id` | the learn.* event's ID |
| `kind` | `learn.proposed`, `learn.applied`, `learn.widened` or `learn.rolled_back` |
| `target`, `scope` | the event's `target` and `scope`, as plain text (not JSON-quoted) |
| `evidence` | JSON text of the event's `evidence` array, exactly as recorded (`[{at, quote}]`) |
| `created` | the event's `ts` (an integer) |
| `state` | for a learn.proposed: `proposed`; for a learn.applied or learn.widened: `applied` (in force), `refused`, `held` or `rolled_back`. A learn.rolled_back row's state isn't read |
| `reason` | for `refused` and `held`: text naming the refused target, the handle whose quote failed, or the check that would be dropped |
| `flagged` | null, or text naming the rolled-back change (its event ID or its handle) this change supersedes or cites |
| `handle` | a record handle naming this change, of the frozen pattern `<scheme>:<id>[#<fragment>]` with a scheme from `HANDLE_SCHEMES`; later events put it in `supersedes` or cite it in `evidence[].at`, and it resolves to the change's `diff` for the quote check |

The table must equal its rebuild row by row, values as stored (AC12), so every state, reason and flag comes
from the log alone.

### Events and connections the tests append

All through `append`, with the frozen schemas of `packages/contracts/schemas` (nothing new is published):

- **A session** is `session.start` from a `hook` connection whose `session` is its ID and whose `project` is
  its repo (`shop`, `blog`, `docs`). Its repo's scope is `repo:<project>`.
- **Its transcript** is Claude Code JSONL put into the real evidence store (the record's `evidence` option),
  linked by `transcript.archived` from the `app`. A user message is `{type:"user", uuid, message:{role:"user",
  content:"…"}}`; an agent message has `content:[{type:"text", text}]`; a fetch is an assistant `tool_use` named
  `WebFetch` followed by a user entry whose `content` is `[{type:"tool_result", tool_use_id, content:"…"}]`.
- **A learned change** is `learn.applied` with `layer: "learned"`: from the `app` with `applied_by: "you"`, or
  from the `core` with `applied_by: "rule:localfirst"` (the local-first rule) or `"rule:install"` (claims
  learned at install). A widening is `learn.widened`, same shape, its new `scope`, and `supersedes` = the
  `handle` of the change it widens. An agent's proposal is `learn.proposed` from `mcp:<session>` with
  `applied_by: null`.
- **A rule you typed** is a change to the base: `learn.applied` with `layer: "base"`, `target: "rule:<id>"`,
  `diff: "+ <your words>"`, `scope: "all"`, `applied_by: "you"`, from the `app`, citing the message you typed it in.
- **A decision** is `decision.created` from the `core`; **a check that caught a bug** is named in a core
  `verdict.made` (the published fixture of that outcome, its requirement's `check` set).

## Readings where the issue and design leave a choice

- **Refused and recorded.** A learned change the core refuses is still appended: `append` resolves, the event
  stays in the log, and its `learned_layer` row reads `refused` with a `reason` naming the target or handle.
  It is never applied. (The frozen `tests/acceptance/14/ac6-redraft.test.ts` appends the published
  `learn.applied` fixtures, whose quote resolves nowhere, and requires every append to resolve, so a refusal
  can't be a rejected append. An empty `evidence` array still fails its schema and is never appended.)
- **The base**: targets `kernel:<rule>`, `invariant:<name>`, `spec:<name>`, `check:<name>` (an approved check),
  `decision:<id>` and `rule:<id>` (a rule you typed). A change of layer `learned` aimed at any of them is
  refused, whoever applied it; a change of layer `base` that you apply goes through. The learned targets are
  the design's closed list; the tests use `slice:<entry>` (a start-slice entry) and `drafting:<repo>` (how a
  repo's definitions are drafted).
- **Diffs** are lines: `+ <text>` adds the line, `- <text>` removes it. The start slice's learned part is the
  fold, in log order, of the in-force changes aimed at `slice:` entries whose scope covers the session; it
  also holds every rule you typed and every decision whose scope covers the session.
- **Removing your rule** is a learned change whose `- ` line is a rule you typed; it is refused, its reason
  naming the rule (`rule:nopush`) or its words.
- **Scope covers a session**: `session:<id>` that session; `repo:<p>` every session whose project is `p`;
  `all` every session. A widening by `rule:localfirst` to `all` is refused (only your OK or a rule you approved
  reaches all repos; the repo step by rule waits for #61). Your rule reaches open sessions because
  `startSlice` reads the record now, not as it stood when the session started.
- **Install claims** (`applied_by: "rule:install"`) apply at the scope their evidence covers: sessions of one
  repo, that repo; sessions of two or more repos, `all`. One that claims more than its evidence covers reaches
  no other repo (refused or narrowed; the tests accept either).
- **A quote is at its handle** when, after NFC and collapsing each whitespace run to one space, it is a
  substring of the text the handle names: `session:<id>#<message>` the transcript entry whose `uuid` is the
  message (its string `content`, or its text blocks and `tool_result` contents); `ev:<sha256>` the evidence
  file as UTF-8; `decision:<id>` the decision's `answer`; a learned change's `handle` its `diff`. A
  `session:<id>` with no message, or one with no archived transcript, resolves to nothing. Every handle of a
  change must hold, or the change is refused naming the first that fails.
- **Outside content** is a `tool_result` of a tool the agent's adapter facts map to `fetch` or `search`
  (Claude Code's `WebFetch`, `WebSearch`, `Glob`, `Grep`), or an `mcp` call. A claim rests only on outside
  content when every handle it cites, other than `decision:` handles, is outside content. Such a change to a
  `slice:` entry is refused, its reason naming the target, unless it cites a `decision:` whose answer holds
  the line it adds (your decision promoting it); citing a decision about something else promotes nothing.
- **A check that once caught a real bug** is one named in a requirement of a core `verdict.made` with outcome
  `FAIL`. A `drafting:` change with a `- <check>` line for such a check is `held` (not applied), its reason
  naming the check; dropping a check seen only in PASS or INVALID verdicts is applied.
- **Rollback**: rolling back one change flags each change (in force or proposed) that supersedes it or cites
  its handle; the dependants stay as they were, flagged. Rolling back to a date compensates every
  learn.applied and learn.widened in force with `ts` at or after the date, newest first; refused attempts,
  proposals and changes to the base are not learned and aren't compensated. A widening that is rolled back
  returns its change to its earlier scope. The rollback itself goes through `rollBack`, from your `app`
  connection.
- **"What did you learn this week?"** reads `learned_layer`: every learned change whose `created` falls in the
  week, each with its evidence, scope and state. The app's box and the agent's tool read it there.

## Criteria to tests

| ID | Criterion (short) | Test | The wrong program, and how it fails |
|---|---|---|---|
| AC1 | no learned change edits a check, a decision, a kernel rule or an invariant; refused and recorded | `base.test.ts` | a core that checks only `layer` applies them; one keeping refusals outside the log loses them at the rebuild; one refusing every change to those targets refuses your base change |
| AC2 | every change resolves to its handles; one without evidence never applied | `evidence.test.ts` | a core checking only handle syntax applies a change on a session with no archived transcript; a layer not listing evidence fails the equality |
| AC3 | a session's change doesn't reach another repo until widened or approved; your typed rule reaches every open session | `scope.test.ts` | a core honouring any event's scope lets the rule's widening reach the blog session; a slice fixed at session start keeps your rule from open sessions |
| AC4 | rollback to a date restores the start slice exactly and flags dependants | `rollback.test.ts`, `proof.test.ts` | a rollback that skips the widening leaves the repo's other session reading it; one that only marks rows leaves the superseded wording lost; a pending dependant left unflagged |
| AC5 | an outside-only claim stays out of the start slice unless your decision promoted it | `evidence.test.ts` | a core treating every transcript message alike applies the fetched claim; one taking any decision as a promotion applies it on "merge with a squash" |
| AC6 | an install claim from one repo applies to that repo; a habit across repos applies everywhere | `scope.test.ts` | a core taking the written scope lets a one-repo fact reach the blog; one starting install claims at a session leaves the docs repo without the habit |
| AC7 | a drafting change dropping a check that caught a real bug is held | `drafting.test.ts` | a core with no hold applies dropping `app.e2e`; one holding every drop holds `app.lint` or `app.flaky` |
| AC8 | apply or roll back under 100 ms; the layer rebuilds in under 5 s | `budgets.test.ts` | measured; off a reference Mac the result is INCONCLUSIVE |
| AC9 | learned changes at `spec:shop`, a decision, an approved check, your rule, and one removing your rule from the slice, refused naming the target | `base.test.ts` | a core checking only `layer` applies all five; the rule then disappears from the slices |
| AC10 | a quote not at its handle is refused, naming the handle | `evidence.test.ts` | a core searching the whole transcript accepts a quote from another message; one checking only the first handle accepts the second's bad quote; one comparing raw bytes refuses the NFC/whitespace control |
| AC11 | rollback appends `learn.rolled_back`, deletes nothing; to a date, newest first | `rollback.test.ts`, `proof.test.ts` | a rollback that deletes or rewrites the change's event fails the log comparison; one compensating oldest first fails the order |
| AC12 | the rebuilt layer equals the incremental projection byte for byte | `proof.test.ts` | judgments kept outside the log, flags written by the rollback call but by no event, or a layer reading the clock (the rebuild runs a week later) differ, named by row and column |
| Proof | a week replayed: changes with evidence and scopes, one rollback, a rollback to a date | `proof.test.ts` | each of the above, together, over 14 sessions in two repos |

## Criterion 8: budgets

`budgets.test.ts` holds the issue's limits: an awaited apply (a `learn.applied` append on a layer already
holding 1,000 changes) under 100 ms at p95 of 40 per run; a `rollBack` of one change under 100 ms at p95 of 40
per run; `rebuild()` of a record holding 10,000 learned events (applies, widenings, refusals and rollbacks over
200 sessions) under 5 s. Per the design's rule for timing results (the same judge as `tests/acceptance/14`),
each takes five runs after a warm-up (one run for the rebuild), passes when all are within the limit, fails
when all are over it by more than the margin (the larger of 5% and the runs' spread), and is otherwise
INCONCLUSIVE. It counts only on a reference Mac (Mac15,7 or Mac15,12, on mains power, Low Power Mode off, no
thermal warning); anywhere else, and when INCONCLUSIVE, the test is skipped with that reason, never passed.
The comparison with the merge base belongs to the perf lane (`scripts/perf.mjs`, `benchmarks/budgets.json`):
the implementer adds tasks that apply, roll back and rebuild in a loop and exit 0, with an `initialReason`
saying the merge base has no learned layer.

## Files

- `helpers.ts`: the test clock, ULIDs, connections, sessions with archived transcripts, learned-change events,
  reads of the layer and the slice, row comparison, the reference-Mac gate and the judge.
- `BASE-FAILURE.txt`: the run on the base commit, where every test fails because the layer has no states,
  `startSlice` or `rollBack`.

No fixture holds a secret or personal data; the IDs, hashes, ports and quotes are made up.
