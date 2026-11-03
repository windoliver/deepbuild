# Acceptance tests for #323: the done gate's open items

What the final message leaves open, placeholders, the solve line, targets resolved before each run, and "I did it"
re-run.

Written first, blind, by a job that never saw an implementation of #323. Sources:

- **The issue**: its text as of 2026-11-03: Scope, the 15 checkbox criteria, Proof, Depends on and "Added Oct 9"
  (each journey has a negative case; "remaining proof gaps", "not run" and "not exercised" sections; receipt lines
  labelled by their proof).
- **The design**, `docs/technical-design.md`:
  - [How runs become one of five verdicts]: Open items as records (IDs hashed from normalized text and scope; waivers
    matched with placeholders; closes only on evidence, your answer or a rule, and reaches you only through an ask),
    Known failures are waivers ("Closing an open item without evidence … is a waiver too"), Proof depth, Coverage claim
    by claim (each journey has a negative case), Evidence states (each receipt line names its proof), Protection.
  - [What done means, fixed at the start]: Solved or not (one solve line; a threshold without a unit is BLOCKED),
    Done means switched on (review notes on the PR and limits the change writes into its docs become open items).
  - [An agent says it's done]: Every stop is judged, Open items, Stalled claims, The verdict in the chat, Questions at
    the stop (a send is held with an authority ask).
  - Stable names for what checks target (a target that can't be resolved is INVALID; a value's change first shows
    the verdicts it would make stale).
  - Tasks only you can do ('"I did it" re-runs that check'), Tasks close themselves.
  - [First-party extensions that ship on by default]: the done-gate row (the "still open" list, placeholder text in
    changed files) and the github row.
  - [How we know version 0 works]: Dogfooding.
- **The closed dependencies**, for the base behaviour they landed: #322 (spec checks beside the definition, project
  trust, `DEEP_HUB_TEST_GITHUB`, #322's criteria lint and its threshold reading), #320 (unblock tasks, `proves`,
  `missing` on a task's inbox row), #47 (the corpus), and before them #303 (ask-tasks, `DEEP_HUB_TEST_DRAFTS`, the
  lock), #25 (the Stop hold), #26 (`deep mcp`, `deep_ask`), #24 (`deep inbox`).
- **The base commit**: `83e4159c` (main). The base code read for its surfaces only: `packages/hub/src/` (`core.ts`:
  `deep_open_item`, the claim lane, `specChecks`, `inbox`; `ask-tasks.ts`: the lock, `references`, the proposals a
  changed check or expected output makes; `github-source.ts`: `recordedFetch`; `forge.ts`: `prUrlIn`; `server.ts`: the
  `DEEP_HUB_TEST_*` settings; `plant.ts`), `packages/asks/src/index.ts` (unblock tasks, `missing`),
  `packages/verdicts/src/engine.ts` (`openItemId`, the receipt's `proof`), the schemas `open_item.opened@1`,
  `open_item.closed@1`, `verdict.made@1`, `ask.created@3`, `adapters/*.facts.json` and the corpus,
  `crates/deep-hook/src/matcher.rs` (the effect classes).
- **Sibling suites, for their conventions**: tests/acceptance/322 (this suite's template), 303, 320, 26, 39, 120.

The implementing agent does not edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

With Node 24.22 (`.node-version`) first on `PATH` and the Rust toolchain:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub and the deep CLI the tests start
cargo build --locked -q -p deep-hook     # target/debug/deep-hook, which every hook runs
npx vitest run --root tests/acceptance/323 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/323/tsconfig.json
```

- Each file starts hubs of its own, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list (`alone`),
  beside #322's. The implementer adds it.
- Every test makes its folders under `/tmp/dh323-*` (a Unix socket path must fit in 104 bytes on macOS), sets `HOME`
  to `<tmp>/h` for every process it starts, and never touches the real `~/.deepbuild`, `~/.claude` or `~/.codex`.
- It stops only processes it started, by PID (`helpers.ts`, `cleanup`), never by name or port.
- No network, no model, no `claude` or `codex` binary, no `gh` call. A child never inherits this process's billing
  keys, forge tokens or its `DEEP_*`, `GIT_*`, `XDG_*`, `CLAUDE*` or `CODEX*` settings. GitHub's answers are recorded.
- Every hub runs with `DEEP_HUB_TEST_STOP_HOLD_MS=20000`; the fast-lane checks end well inside it, so a stop's reply
  comes when they end. On the base the suite took 195 s on a lightly loaded Mac and 447 s at a load of 55 on 12
  cores; on a correct hub it runs every scenario to its end, about 10 to 15 minutes, most of it the checks' runs.
- Under heavy load a hook can miss the hub (deep-hook's "could not spool within the hook's 50 ms") and a prompt or
  a stop never reaches the record. A scenario's setup that never sees its task or its verdict says `BLOCKED`, never
  a criterion's failure; run it again on a quieter machine.

## The surface under test

The tests reach DeepBuild only through these:

- **deep-hook** (`target/debug/deep-hook`), run as Claude Code runs our hook entry (`deep-hook claude-code <event>`)
  and as Codex runs it (`deep-hook codex <event>`), the hook's JSON on stdin, `HOME` the test's. Payloads and
  transcripts are shaped like the corpus's (`adapters/corpus`), each carrying the newest version its facts cover. A
  Stop's reply is read from deep-hook's stdout (`decision: block` with its `reason`, and `systemMessage`) or, at exit
  2, its stderr; a PreToolUse refusal the same way.
- **`deep mcp`**, the session's own MCP server, a child of the session's Claude Code process (AC10's `deep_ask`).
- **`deep hub run`** with its test settings: `DEEP_HUB_TEST_CONFIRM`, `DEEP_HUB_TEST_DRAFTS`,
  `DEEP_HUB_TEST_STOP_HOLD_MS`, `DEEP_HUB_PLANT` and `DEEP_HUB_TEST_GITHUB`, all of which the base has; the GitHub
  recording gains GraphQL answers (below).
- **The socket**, as the cli role with the control token: `events.read` and `inbox.read` (your inbox, as `deep inbox`
  reads it).
- **The record** through `events.read`: `user.ask`, `task.created`, `definition.locked`, `ask.created`, `agent.stop`,
  `claim.made`, `run.started`/`run.finished`, `verdict.made`, `*.proposed`, `open_item.opened` and
  `open_item.closed`, each as the base's catalogue has it, with the fields below.
- **`deep inbox answer <ask> <option>`** (#24): your answer on the trusted path, the OS confirmation stubbed
  `confirmed`.
- **The projects' trust decision** as #348 landed it (`openTrust` over the record, before the hub starts), as #322's
  suite records it, for every repo.

### Playing the agents

As in #322's suite: each Claude Code session has its own long-lived process, `fixtures/agent.mjs`, which runs every
deep-hook of that session and its one `deep mcp` as its children, so the hub binds both to the session and `deep inbox
answer`, run by the test process, is outside every session's process tree. A call runs only when PreToolUse allows
it; then its result is written to the transcript and PostToolUse fires. A stop is the assistant's last words and the
Stop hook with `last_assistant_message`. The Codex session writes its rollout under
`~/.codex/sessions/2026/11/03/` (the facts' `transcripts.path`) and fires `deep-hook codex <event>` as a child of its
own `fixtures/agent.mjs` process, as Codex is the parent of its hooks; its patches go through `apply_patch`'s hook
pair, after its definition has locked.

### The world

Each repo is `<tmp>/<name>`, one commit on `main`: `src/auth.js` (`checkToken`, `token.exp > 0`; `rejectsExpired:
false`), `tests/unit.test.js` (fails until `FIX`), `.deepbuild/done.yaml` (`claims.done.checks: [unit]`, `unit` a
node:test command with `min_tests: 1`), `.deepbuild/checks/expired-token.sh` (the drafted check R1 names, failing
until `FLAG`), `README.md`, `package.json`, and the files a test adds. The definitions are handed by prompt
(`DEEP_HUB_TEST_DRAFTS`, #303's shape), one per prompt, each requirement with #303's Fields and #322's `references`.

Drafted checks are as the hub drafts them: `.deepbuild/checks/<name>.sh`, run as `sh <file>`, whose one line is
`node --test .deepbuild/checks/<name>.test.js`, so the hermetic runner traces the run and counts its one test; the
test's assertion is its line 4, which the requirement's `asserts` names (`helpers.ts`, `testCheck`). A check that
runs `node -e` alone runs no test and is INVALID, "ran nothing", on the base.

## New surfaces the implementer adds

The issue needs a few surfaces the base lacks. Each is named here in the base's existing shape; the tests read
nothing else.

1. **Open items in the record.** The core writes `open_item.opened` (a new major of the kind; `@1` has only
   `task_ref` and `text`) with `task_ref`, `text` (the item, quoting what it came from, as data) and **`item`**, its
   ID, the hash of its normalized text and scope (the engine's `openItemId`; the tests also accept the field as `id`).
   It closes with `open_item.closed` carrying the same `item`. A later `open_item.opened` with that `item` reopens
   or revises it. The tests find an item by any string its data holds (`strings`), case and Unicode form aside, so
   the item's text, or another field of it, may carry the quote, the file, the thread or the resolver. They open,
   at a stop, for:
   - each line under a final-message section headed `Still open:`, `Not verified:` or `Follow-ups:`, one item per
     `- ` line (the issue's list also names "next steps", "remaining proof gaps", "not run" and "not exercised");
   - an issue the turn filed instead of fixing, as its final message says ("filed it as #12
     (https://github.com/acme/shop/issues/12) instead of fixing it here") after its `gh issue create` call printed
     that link: the item names `#12` or `issues/12` and the bug ("rate limiter");
   - placeholder text in a file the claim changed or added: `TODO` and `not implemented`, the item naming the file
     (`src/auth.js`, `src/refresh.js`); never one in an unchanged file (`src/legacy.js`'s `FIXME`);
   - a limit the change writes into its PR body (`Known limit: a token with no exp claim is still accepted.`, the
     body of the session's `gh pr create`, and of PR 22 as recorded) or into its docs (README.md's added
     `The middleware doesn't check the token's audience yet.`);
   - each unresolved review thread on the claim's PR (item 5);
   - each TodoWrite item, and each step of Codex's last `update_plan`, left `pending` or `in_progress` (item 6).
2. **An open item reaches you through an ask** (AC11). The item AC11 waives, a "Not verified" line, raises an
   `ask.created` whose data names its text (or its `item`), with an option whose `id` or `label` matches
   `/waive|won.?t[ -]?fix|out[ -]of[ -]scope/i` (else `/accept/i`): the answer that closes it without evidence, a
   waiver. Your answer through `deep inbox answer` writes its `open_item.closed`. A later item whose text matches the
   waived one after normalization with temporary paths, PIDs, addresses and timestamps as placeholders is not left
   open (never opened, or closed by the waiver) and raises no ask. No other test reads an open item's ask.
3. **The solve line** (AC5): a string field **`solve`** on an event naming the task (`data.task_ref`), such as the
   `definition.locked` itself, written at the lock, before any claim. One line: it matches `/fully covered/i` for a
   definition whose every requirement has a check, and `/no check/i` naming the requirement (`R2` or its text) for
   one with none.
4. **Targets** (AC4): a handed requirement may carry **`targets`**, stable names as strings; this suite uses one
   form, `<file>#<symbol>` (`src/auth.js#checkToken`): the file in the claim's snapshot defines the symbol. Before
   each run the target is resolved; one that doesn't resolve makes the claim's `verdict.made` `INVALID`, its
   `reasons` or requirement rows naming the symbol (`checkToken`). One that resolves changes nothing.
5. **Review threads in the recorded GitHub answers** (`DEEP_HUB_TEST_GITHUB`, #322's file, extended). An entry may
   be a GraphQL answer: `{ "method": "POST", "path": "/graphql", "variables": { "owner": "acme", "repo": "shop",
   "number": 21 }, "status": 200, "body": { "data": { "repository": { "pullRequest": { … } } } } }`, matched when the
   request is a POST to `/graphql` and each of the entry's `variables` equals the request's variable of that name;
   so the gate's query sends `owner`, `repo` and `number`. The body is GitHub's shape: `pullRequest { number url body
   reviewThreads { totalCount pageInfo { hasNextPage endCursor } nodes { id isResolved isOutdated path line
   resolvedBy { login } comments { totalCount nodes { id databaseId author { login } body url createdAt } } } } }`
   (`github.ts`). The REST answers add `/user` (the account `gh` and the session's token are signed in as, `you-gh`)
   and `/repos/acme/shop/pulls/<n>` (the PR, with its `body`). The claim's PR is the one the session's `gh pr
   create` printed (`https://github.com/acme/shop/pull/<n>`, as `prUrlIn` reads it). The file is read at each
   request, so a test rewrites it when a thread is resolved.
   - Each unresolved thread is one open item naming the thread, by its node `id` (`PRRT_…`) or its first comment's
     link (`#discussion_r<databaseId>`), and quoting its first comment's `body`. The claim's verdict is not `PASS`
     while one is open.
   - A thread whose `resolvedBy.login` is the `/user` login, the session's own account, keeps its item open, and an
     event after that stop names the thread and the resolver (`you-gh`, or the session's ID). A thread resolved by
     anyone else (`maya`) closes its item (`open_item.closed`).
6. **The agent's own task list** (AC15), named in each adapter's facts (`adapters/claude-code.facts.json`,
   `adapters/codex.facts.json`; the base names neither, and the corpus records neither):
   - Claude Code: the `TodoWrite` tool call, `tool_input.todos[]` with `content`, `status` (`pending`,
     `in_progress`, `completed`) and `activeForm`, its response `{ oldTodos, newTodos }`; the newest list before the
     stop counts.
   - Codex: the rollout's `response_item` `{ "type": "function_call", "name": "update_plan", "arguments":
     "{\"explanation\":null,\"plan\":[{\"step\":…,\"status\":…}]}", "call_id" }` and its `function_call_output`
     (`Plan updated`); the last one before the stop counts, so a step only an earlier update had is no item.
   - An item the agent later marks `completed` closes nothing.
7. **A command the final message tells you to run** (AC7): a command in backticks after "run" (``To verify, run
   `node scripts/verify-expiry.js` from the repo root.``) is run once by the gate on the claim's snapshot before the
   stop's reply, as a run of the claim: a `run.started` whose data names the command, and its `run.finished`
   (`failed` here). A failing one sends the stop back (a block), the reason carrying the command and its output
   (node's `Cannot find module`). The base's validity gate instead sends it back before any check runs, as a run
   "never made in this session".
8. **A threshold without a unit** (AC6) is read from the requirement's text as #322's lint reads a criterion's
   (`under 300` has none; `under 300 ms` has one). Its requirement row in `verdict.made` is `BLOCKED`, and the
   verdict's strings name the value (`300`) and `unit`.
9. **A journey with no negative case** (AC8): a requirement at depth `journey` whose `near_misses` is empty is
   flagged by an event after its task's creation whose strings, other than a requirement record's own fields, say
   `negative case` and name the requirement (`R2` or its text). The receipt is `verdict.made`'s requirement rows,
   whose `proof` the base already writes (`statement`, `static_check`, `test_run`, `journey`, `decision`): a shell
   command check is never shown above `test_run`, and a requirement with no check shows `statement`.
10. **The verdicts a value's change would make stale** (AC9): when a value a check depends on changes on disk, here
    a file a locked definition `references` (`.deepbuild/checks/latency.floor`), the change is proposed (the base's
    `learn.proposed` at the next claim, or an `ask.created` for it) naming the file, and its data lists each verdict
    it would make stale, by `verdict:<id>` (`verdict.made`'s `data.verdict`), the verdict event's ID, or its
    `claim:<id>`; a verdict whose checks don't read the value is not listed.
11. **"I did it"** (AC10): your answer `done` to an unblock task (`deep_ask` kind `unblock`, `check: "ready"`, which
    the base raises with `proves: "ready"`) runs that check again at once: a `run.started` whose `check` is `ready`
    after your answer, with its `run.finished`. While it still fails, the task is open again in `inbox.read` (a row of
    kind `unblock` whose `status` isn't `closed`, the same ask or a new one) whose row names the check and its
    failure (`the speech model license is not accepted yet`, or the test's title); a stop meanwhile is not `PASS`.
    Once it passes, the task closes.
12. **A reply to a review thread is a send** (AC14): `gh api --method POST
    repos/acme/shop/pulls/23/comments/9101/replies -f body='…'` is denied at PreToolUse (the base's send class names
    only `gh pr comment`, `gh issue comment` and `gh pr review`) and held as one `ask.created` whose data names the
    comment (`9101`), `replies` or the reply's text; the same call tried again raises no second ask.

## Wrong programs

Each is code the implementer writes, selected with `DEEP_HUB_PLANT=<name>` on `deep hub run`. A plant the base
doesn't list stops the hub from starting, so its test fails BLOCKED, never passes. Each runs its criterion's scenario
from the start on a planted hub and must fail with a message naming what the issue says it names. `failureOf`
rethrows BLOCKED and INCONCLUSIVE, so neither counts as the plant's failure.

| Name | Criterion | What the plant does | How the test fails on it |
|---|---|---|---|
| `normalizer-drops-numbers` | AC11 | the open items' normalizer, the waiver's included, drops numbers | `port 3001` takes `port 3000`'s ID (and the 6000 ms timeout matches the 5000 ms waiver); the failure names `port 3001` |
| `pr-body-only` | AC12 | the gate reads the claim's PR body only, never its review threads | no open item for either thread; the failure names `PRRT_kwDOAcme0021a` |
| `resolved-counts-closed` | AC13 | the gate closes the item of every resolved thread, whoever resolved it | the session-resolved thread's item closes; the failure names `PRRT_kwDOAcme0023a` |
| `completed-closes-item` | AC15 | an item the agent marks `completed` in its task list closes its open item | the TodoWrite items close at the second stop; the failure names the item |

The issue names no wrong program for the other criteria; the base is theirs (`BASE-FAILURE.txt`).

## Criteria to tests

Each `describe` and test name starts with its criterion's number and ID, `#323.<first 8 hex of SHA-256 of the
criterion's text>`: trimmed, whitespace collapsed, `- [ ] ` dropped, as `scripts/proof-change.mjs` computes it, from
the issue's text as this job was given it (the live issue was not read). Every failure message starts with them too.

| ID | Criterion (short) | Test file | What the test does |
|---|---|---|---|
| AC1 `#323.035dc227` | a placeholder in a changed file is an open item | `final-message.test.ts` | session A's TODO in src/auth.js and "not implemented" in the new src/refresh.js are items; the FIXME in untouched src/legacy.js is not |
| AC2 `#323.70229cc2` | follow-ups and filed issues are items; none closes without evidence, answer or rule | `final-message.test.ts` | two follow-ups and #12 give three items; after a stop saying all are fixed, all three are open |
| AC3 `#323.5966273a` | limits in the PR body or docs are items, as a "still open" list is | `final-message.test.ts` | the PR body's known limit, README's "doesn't … yet" and the "Still open" line each give an item |
| AC4 `#323.a78cd64d` | a target that no longer resolves is INVALID with the reason | `targets.test.ts` | R1 targets `src/auth.js#checkToken`; renamed: INVALID naming checkToken; kept (control): not INVALID |
| AC5 `#323.73adf79a` | an uncovered requirement shows in the solve line before any claim | `definition.test.ts` | the lock's solve line names R2 with no check, no claim made; a covered definition reads fully covered |
| AC6 `#323.6f18b734` | a threshold without a unit makes its check BLOCKED | `definition.test.ts` | "under 300": R1 BLOCKED naming 300 and unit; "under 300 ms": R2 not BLOCKED |
| AC7 `#323.d33fe764` | a command the final message says to run is run once first; failing, sent back with its output | `final-message.test.ts` | session B, all checks green, says to run `node scripts/verify-expiry.js`: one run, failed, stop blocked with "Cannot find module" |
| AC8 `#323.cd7cac96` | a journey with no negative case is flagged; no receipt line overstates its proof | `definition.test.ts` | R2 (journey, no near miss) flagged, R1 not; R1 and R2 proof at most test_run; R3 statement |
| AC9 `#323.15c51ef6` | a value's change first lists the verdicts it would make stale | `targets.test.ts` | X and Z pass; the floor becomes 100 ms; at Y's stop the floor's proposal lists X's verdict, not Z's |
| AC10 `#323.11d61eef` | "I did it" re-runs the check; still failing, the task returns with what's missing; no pass on it alone | `did-it.test.ts` | deep_ask unblock naming `ready`; "I did it": `ready` re-runs and fails, the task is open naming it; the stop isn't PASS; license accepted, "I did it": passes, closed |
| AC11 `#323.056bfe4d` | items match on normalized text and scope; waivers match with placeholders | `match.test.ts` (2) | port 3000 in two forms is one ID, port 3001 another; the waived 5000 ms timeout seen with another path, PID and time stays closed, 6000 ms opens; the plant |
| AC12 `#323.9ddcf826` | two unresolved threads: an item each, naming it; no pass | `review.test.ts` (2) | PR 21's two threads: one item each, quoting the first comment; verdict not PASS; the plant |
| AC13 `#323.b0a29209` | a session-resolved thread stays open naming the session; a reviewer's closes | `review.test.ts` (2) | PR 23: T3 resolved by you-gh stays open naming it, T4 by maya closes; the plant |
| AC14 `#323.d6d5ec0c` | a reply under your name to a review thread is held as one ask | `review.test.ts` | the replies call tried twice: both denied, one ask |
| AC15 `#323.bc9c6272` | TodoWrite and Codex's last plan: pending and in-progress items open; completed closes nothing | `todos.test.ts` (2) | Claude: two items, still open after all four are marked completed; Codex: two items from the last update, none from the first; the plant |

## What this suite could not encode

- **Where open items go beyond the record**: the question sort (#84), the stalled-claim rule and the PR's "Part of"
  list read them; only the `open_item.*` events are asserted.
- **Every final-message heading**: the tests write `Still open`, `Not verified` and `Follow-ups`; "next steps",
  "remaining proof gaps", "not run" and "not exercised" have no fixture here.
- **"Quoting … as data"** (AC12) is read as the item holding the comment's text; how it is shown isn't checked.
- **A route as a target** (AC4): the world has no router, so the target is a file and symbol, the design's other
  example of a stable name; the issue says "such as a renamed route".
- **A budget or a margin** (AC9): the value is a latency floor in a file the definition references, the design's
  own example; no budget is priced here.
- **Who changes the value** (AC9): the floor changes on disk outside any guarded call, and the proposal the next
  claim makes is read as "before it changes"; the base has no CLI or app path to change a value to drive.
- **"I did it" from a channel** (paseo, a chat app): only `deep inbox answer`.
- **Every open item's ask**: only AC11's waived item is required to reach you through one.

## Files

- `helpers.ts`: temp worlds (a home, repos with the spec, unit test and drafted checks, the drafts and the GitHub
  recording, the trust decision), the hub as a process, `events.read` and `inbox.read`, Claude Code sessions with
  their `deep mcp`, Codex sessions, deep-hook replies (`decision`, `replyText`), the record readers (`expectTask`,
  `lockedFor`, `claimsOf`, `runsOf`, `taskVerdicts`, `reqRow`, `asksRaised`) and the open-item readers (`itemsOf`,
  `itemsNaming`, `itemId`, `closingsOf`, `isOpen`), `deep inbox answer`, `failureOf`, `Inconclusive`.
- `github.ts`: the recorded answers for the repo, `/user`, each PR and its review threads.
- `fixtures/agent.mjs`: each Claude Code session's stand-in, the parent of its deep-hook runs and its `deep mcp`.
- `final-message.test.ts` (AC1, AC2, AC3, AC7), `definition.test.ts` (AC5, AC6, AC8), `targets.test.ts` (AC4, AC9),
  `did-it.test.ts` (AC10), `match.test.ts` (AC11), `review.test.ts` (AC12, AC13, AC14), `todos.test.ts` (AC15).
- `tsconfig.json`: the root's strict options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit, trimmed to each test's failing assertion.

[How runs become one of five verdicts]: ../../../docs/technical-design.md
[What done means, fixed at the start]: ../../../docs/technical-design.md
[An agent says it's done]: ../../../docs/technical-design.md
[First-party extensions that ship on by default]: ../../../docs/technical-design.md
[How we know version 0 works]: ../../../docs/technical-design.md
