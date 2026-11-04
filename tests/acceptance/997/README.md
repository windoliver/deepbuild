# Acceptance tests for #997: Claude Code's Monitor keeps a session waiting on its watch, not finished

Written first, blind, by a job that never saw an implementation of #997; none existed. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- Issue #997 as of 2026-11-03T06:47:56Z (updatedAt): its problem, Scope, the two acceptance criteria, Proof and Depends on.
- `docs/technical-design.md`: How runs become one of five verdicts; An agent says it's done (Every stop is judged, A
  loop's turn end isn't a hand-back); What each agent gives us (the Claude Code row: prompt origins, loop facts); Hooks
  are evidence, not a state machine (Unknown, not finished: "a background wait, such as the waiter or an agent's own
  monitor"; Facts as data: each field with its conformance case); States people see; Dogfooding.
- At the base (`42060bb7`): `adapters/loops.facts.json`, `adapters/claude-code.facts.json`, `adapters/corpus/README.md`
  and the claude-code sets `loop`, `child-gates`, `crash` (Stop payloads carry `background_tasks`), `scripts/corpus.mjs`
  (`replay`, `check --facts`), `packages/hub/src/hookmap.ts` (`loopFact`), `packages/hub/src/core.ts` (`enrich`,
  `loopAt`, `follow`, `judging`, the stop rule, `status.read`), `packages/hub/src/status.ts` (`statusRows`),
  `packages/hub/src/plant.ts`, `packages/record/src/projections.ts` (the sessions row), `crates/deep-app/src/notify.rs`,
  `packages/conformance` (no loop-facts case exists), and the blind suites `tests/acceptance/907`, `965`, `39`
  (`loops.test.ts`'s corpus replay) and `18` (`mapping/helpers.ts`, `install/helpers.ts`'s corpus replay) for format.
- Claude Code's own Monitor and TaskStop tools, from this job's own session: Monitor takes `command`, `description` and
  `timeout_ms`; its result names the task (`Monitor started (task <id>, …`); each event arrives as a prompt carrying
  `<task-notification>\n<task-id><id></task-id>\n<summary>Monitor event: "<description>"</summary>\n<event>…</event>`
  with no `<tool-use-id>`; TaskStop takes `task_id` and answers `{message, task_id, task_type, command}`.

What the base does (measured, BASE-FAILURE.txt): `loopFact` reads no `Monitor`, so the session that armed one has no
loop at its first stop and its row reads `finished`. Each monitor event's prompt (`turnOrigin: task_notification`) maps
to `from: subagent`; its stop's loop reads `none_left` and its row `finished` again, so the session is handed back four
times. The core judges the claim at the first stop (a `claim.made` while the watch runs) and again after TaskStop.
`node scripts/corpus.mjs check` reads loops.facts.json as an agent with no versions and checks nothing in it.

## Run them

```sh
npm ci                            # once, if node_modules is missing
npm run build --workspaces        # replay.test.ts starts `deep hub run` from packages/cli/dist
cargo build --locked -p deep-hook # replay.test.ts sends every hook through target/debug/deep-hook
node node_modules/vitest/vitest.mjs run tests/acceptance/997/replay.test.ts
node node_modules/vitest/vitest.mjs run tests/acceptance/997/facts.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/997/tsconfig.json
```

Node 24.22.0. `replay.test.ts` takes seconds a test (a hub each); `facts.test.ts` under a second. Nothing needs the
network, a real `claude`, a sign-in or a model call. Folders are under `/tmp/dh18m-*` and removed after each file;
every process a test starts is stopped by its PID, never by name or port.

## Criteria to tests

Each test's name starts with its criterion's ID and tag (`#997.<first 8 hex of the SHA-256 of the criterion's text>`,
as `scripts/proof-change.mjs` computes it).

| ID | File | Tests |
|---|---|---|
| AC1 `#997.13bd3097` | `replay.test.ts` | the fixture holds the session; the recorded session replayed into the hub; its wrong program (`DEEP_HUB_PLANT=monitor-unread`); the made-up twin replayed into the hub; the twin under the wrong program |
| AC2 `#997.a820a75b` | `facts.test.ts` | the shipped loop facts name Monitor; the planted facts file fails the loop-facts conformance case naming `Monitor`; a control: the shipped facts don't |

### AC1, `replay.test.ts`

The session is replayed hook by hook, each payload through `deep-hook claude-code <event>` into a fresh `deep hub run`,
in a folder and transcript of the test's own (session ID kept, `cwd` and `transcript_path` rewritten, `scratchpad_dir`
dropped), its transcript written up to the hook's place in it (the prompt's entry, the call's tool_use or tool_result,
a turn's entries up to the next prompt's). After each of the session's four Stops the row is read (`status.read`).

Asserted, every problem collected and named by its turn (turn 1 your prompt, which armed the monitor; turns 2 to 4 the
monitor's three events, the last of which stopped the watch):

1. Stops 1 to 3 (the watch running): the row reads waiting on its monitor — its state is none of `finished`,
   `needs you`, `stuck`, `flagged`, `quiet`, and its `why` (or `note`) says it waits and names the monitor (`/wait/i`
   and `/monitor/i`); the stop's `agent.stop` `data.loop.state` is `looping`.
2. Stop 4 (after TaskStop): the row no longer reads waiting on the monitor.
3. The gate judges the claim once after the watch ends: the core's `claim.made` for the session, none before
   TaskStop's `tool.after` is in the record and exactly one after it.
4. You are notified once, at stop 4. A notification is a stop after which the row reads the session as handed back to
   you (not `working`, not waiting on its monitor); see Open points.
5. No monitor event's prompt is recorded as yours (`from` is never `person` or `app`).

The wrong program must fail these, its first stop's row `finished`, the failure counting `notified 4 times` and naming
turns 1 to 3.

## The fixture (the implementer records it)

`adapters/corpus/claude-code/<version>/monitor/` (`session.json`, `events.jsonl`, `transcript.jsonl`, as the corpus
README lays out), for a version `claude-code.facts.json` covers; the newest such version holding one is read. Recorded
from a real Claude Code (`node scripts/corpus.mjs record`, a `monitor` scenario), with `expect` written and reviewed for
every payload. It must hold, checked by content:

- `session.json` `scenario: "monitor"`.
- One `Monitor` call, PreToolUse and PostToolUse, its `tool_input.command` a string.
- One `TaskStop` call (PostToolUse) whose input names the watch: some string in its `tool_input` that the Monitor's
  `tool_response` also carries (the watch's ID; no field name is assumed).
- Exactly three UserPromptSubmit payloads whose `prompt` holds `<task-notification>` and the watch's ID, all after the
  Monitor call, each with its transcript entry (`type: user`, same `promptId`, text holding `<task-notification>`);
  TaskStop after the third.
- Exactly four Stops of the session's own (no `agent_id`): one after the Monitor call and before wake 1, one before
  each later wake, and one after TaskStop. So the agent stops the watch in the turn the third event started.
- `node scripts/corpus.mjs replay` reads every payload of the set as `match`, and the session verified.

## The twin

`helpers.ts` `twin()` builds the same session by hand, shaped as Claude Code 2.1.308 writes one (the corpus's
transcript entries and the event text above): your prompt, a `Monitor` call (`command`, `description`, `timeout_ms`;
response `{ taskId, description, timeoutMs }`, an assumption: the real response's fields are unknown here), a Stop
whose `background_tasks` lists the watch, three `<task-notification>` prompts (`turnOrigin: task_notification`, with
the queue's enqueue/dequeue entries), each ending in a Stop, and a `TaskStop` in the third with Claude Code's response
shape. It lets the base be replayed before the recording exists. If the recording shows Claude Code's Monitor response
differs, so that a hub built to the recording can't read the twin, that is a dispute for this suite's blind redraft,
never an edit.

## Surfaces the implementation must provide

None exists at the base.

- **The recorded set** above.
- **Loop facts for Monitor**: `adapters/loops.facts.json` names Claude Code's `Monitor` (its watch's ID and how it ends:
  a TaskStop naming it, the watched process ending, the session ending), and the hub reads them: a stop with the watch
  running reads `data.loop.state: 'looping'`, the row (`status.read`) reads waiting on its monitor, the claim isn't
  judged until the watch ends, and a monitor's turn notifies only with an ask or a verdict.
- **Plant `monitor-unread`**: `DEEP_HUB_PLANT=monitor-unread` reads loop facts as the merge base does, with no Monitor.
- **The loop-facts conformance case**, run by `node scripts/corpus.mjs check --facts <dir>` (the preflight's corpus
  lane, which already takes a facts folder): given a folder of facts files whose `loops.facts.json` has every `Monitor`
  key and list item taken out, it prints a `FAIL` line naming the loop facts (`/loop/i`) and `Monitor`, and exits
  non-zero; with the shipped files it prints no such line.

## Open points (choices the issue leaves open; the tests assert the least they can)

1. **"Notified".** The hub sends no notification itself (the app's notifier posts for asks and notices). The tests count
   the stops the row reads as handed back to you, the reading that would notify, which is what the issue's "each event
   … reads as a new turn finishing, notifying you again every time" describes. "Only if it ends with an ask or a
   verdict" is not asserted apart: the last stop is read as handed back whatever it shows.
2. **"Waiting on its monitor"** is asserted by the row's words (`wait`, `monitor`) and its not being a handed-back
   state; no exact sentence or new state word is asserted.
3. **"Judges the claim"** is the core's `claim.made` for the session (the stop rule's judgement); a verdict is not
   required, since the session has no definition.
4. **"Started by the monitor, not by you"**: asserted only as not `person`/`app`; the exact `from` value is open.
5. **The conformance case's surface** is the corpus lane's `check`, chosen as where facts are held to the recorded
   corpus; its message beyond naming the loop facts and `Monitor` is open.
6. **Not covered**: the watch ending by its process ending or by the session ending (the criteria name the TaskStop
   session only), a monitor's expiry, and Monitor's `ws` source.
