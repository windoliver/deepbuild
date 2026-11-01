# Acceptance tests for #85: tasks that close themselves, one cause as one task, and one automatic continue

Written first, blind, from issue #85 (its text as of October 28, 2026: Scope, the 12 acceptance criteria, Proof, and what it depends on, #320 and #25), `docs/technical-design.md` (An ask, and your answer getting back, especially Every ask ends, Asks stay current, One table for an ask's life, Tasks only you can do, Tasks close themselves and Where they reach you; One event log, with tables built from it, with the closed set of stop causes; The done loop, the row Tasks that close themselves; What each agent gives us, the Claude Code and Codex rows, StopFailure against Codex's Stop hooks; Parallel sessions and plan limits, Turns DeepBuild causes; How we know version 0 works, Dogfooding and Tests written first; and every mention of the automatic continue, 10 minutes, compaction, channels and chat apps) and the base commit `5a6d09a4` (`origin/main`: #318's, #319's and #320's asks core, #25's routes, `agent.stop@4` with its causes, signatures and owners, and no implementation of #85). The suites of #320 (this folder's shape), #318 and #319 (the asks surface), #25 (routes and stamps), #312 (the adapters' stop causes) and #83 (budgets on the reference Mac) set the conventions followed here. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft by this job.

## Run

```sh
npm ci                                                        # once, if node_modules is missing
npm run build --workspaces                                    # the asks core resolves @deepbuild/record and the adapters through dist/
node node_modules/vitest/vitest.mjs run --root tests/acceptance/85 --no-file-parallelism --exclude budgets.test.ts   # the behaviour tests, about 10 s
node node_modules/vitest/vitest.mjs run --root tests/acceptance/85 --no-file-parallelism budgets.test.ts             # criterion 12, on the reference Mac
node node_modules/typescript/bin/tsc -p tests/acceptance/85/tsconfig.json                                            # type-check the tests against the surface below
```

Node 24.22 or newer. The behaviour tests need no network, no hub socket, no git and no agent: every world is a real record on SQLite and a home folder in its own temporary folder, with a virtual clock, removed afterwards; every deadline and window (10 minutes, 60 s, 30 s, 9 hours, 2 minutes) is the clock moved, never a wait. `budgets.test.ts` runs the real clock and `git merge-base` (README: Budgets). With `--root` here, Vitest writes its cache to `tests/acceptance/85/node_modules/.vite/`; delete it before committing.

On the base, all 20 behaviour tests fail, each at an assertion: no task is raised for five sessions stopped by one cause; no dropped connection continues; the thread task is refused (`ask.created@3` has no `thread`); a session's row has no cause. `budgets.test.ts`'s lane test fails at its assertion (no lane runs the file), and its measurement reads INCONCLUSIVE on a loaded or non-reference machine, as designed, and on an idle reference Mac fails naming that no task was raised. `tsc` reports 6 errors on the base, all from the missing surface: `threads` is not on `AsksOptions` (1) and `missing` is not on `Card` (5). Against the surface below it reports none. `BASE-FAILURE.txt` has the base run trimmed to each failure's reason.

## The surface

The issue names behaviours (a task, Needs you, the session's row, an automatic continue, a stop's cause from the closed set, deep-hook's stamp, a read-only connector) and no code names. These tests define the smallest code surface they need on top of #318's, #319's and #320's, which stay as their READMEs define them. They reach the code only through:

- **`@deepbuild/asks`, through its public entry `packages/asks/src/index.ts`**: `openAsks` (with `home`), `raise`, `tick`, `card`, `needsYou`, `inbox`, `AskRefused`, with the additions below;
- **`@deepbuild/record`** as it is at the base: `openRecord`, `append`, `read`, `table('sessions')`, `close()`, with one column added below;
- **`@deepbuild/adapters`** as it is at the base: `shipped().mapHook` (criterion 4 only: the cause of a Stop whose text says "usage limit reached");
- **events** the tests append as the hook and the runner would, in the shapes the base already has: `session.start@1` (`agent`, `worktree`, `branch`, `thread`); `agent.stop@4` (`turn`, `did_work`, `claim`, `cause`, `usage`, `outcome`, and, as the adapter's facts give them, `signature`, `owner` and `plan_resets`), each with `ts` and `seq` from deep-hook's stamp; `user.ask@1` (`from: person`) for a prompt you typed; `verdict.made@1` (PASS or FAIL, one requirement whose `check` is the task's `proves`, with `reasons`) for a check's run. They read `ask.created`, `ask.moot`, `ask.superseded`, `ask.answered`, `ask.defaulted` and the one new kind below;
- **files**: `<home>/config.json` with #319's settings (no `batch`, so every ask shows when it's raised).

```ts
// packages/asks/src/index.ts: additions to #318's, #319's and #320's surface

export interface AsksOptions {
  // …record, now, deliver, home, plant, as before, and:
  /** The read-only connector to your chat app's threads: how a chat-app task's check reads the thread. Left out, no thread is read. */
  threads?: { read(link: string): Promise<{ from: string; text: string; at: number }[]> };
}

export interface Card {
  // …as #318 and #320 defined it, and:
  /** On a task whose check ran and still fails: the check, what's missing (the verdict's reasons, or the thread check's), and the thread link on a chat-app task. null otherwise. */
  missing: { check: string; reasons: string[]; link: string | null } | null;
}
```

```jsonc
// ask.created, the unblock branch: one optional field (in @3, which the core writes unblock tasks in, or a new major)
"thread": { "type": "object", "properties": { "link": { "type": "string" }, "expect": { "type": "string" } }, "required": ["link", "expect"], "additionalProperties": false }
// A step you take in a chat app: the thread its check reads through the connector, and the bot's reply it expects.
```

```jsonc
// session.continued@1: a new kind the core appends (writer core) when it starts a turn in a stopped session
"subject": "session:<id>",
"data": {
  "stop":    "<the ULID of the agent.stop it continues from>",
  "because": "transient" | "context_overflow" | "task_closed",   // one automatic continue after a transient cause; a context overflow compacted once and re-sent; the session's task closed
  "task":    "ask:<id>" | null                                    // the task that closed, on task_closed; null otherwise
}
```

```sql
-- packages/record: the sessions projection gains one column, a function of the session's events alone
sessions(…, cause TEXT)   -- the cause of the session's newest agent.stop; NULL before any stop
```

Nothing else is needed: no other option, flag or export. The tests don't say how a continue reaches the agent (the Stop hold's reply for a stop held within it, the waiter for an idle Claude Code session: #25's routes) or how the hub ticks the core when a verdict lands; they read the record.

### Behaviour the surface carries

- **A stop's structure decides.** The hook records each stop as `agent.stop@4` with its `cause` from the closed set and, from the adapter's facts, who can act on the block (`owner`) and the block's `signature`, the same for the same block in any session. The core reads nothing else: not the agent's text, which it never sees.
- **One cause, one task.** A stop whose block only you can act on (`owner: you`, as a revoked sign-in, a VPN you must reconnect or a spend limit), or whose plan window is spent (`plan_window_spent`, with `plan_resets`), raises one unblock task you own, in your inbox and Needs you; every session stopped by the same block (the same `signature`) shares it: one open unblock row in `inbox()`, one unblock card in `needsYou()`, and the task unblocks each of their sessions (`unblocks` lists `session:<id>`, on the task itself or on a session's task recorded `ask.superseded` by it). Its `proves` names the check that closes it.
- **It closes itself.** A PASS `verdict.made` whose requirement covers that check closes the task as `ask.moot` (the base's rule), and within 30 s every session it unblocks gets a `session.continued` from its stop, `because: task_closed`, naming the task. You never typed: no `ask.answered`, no `ask.defaulted`, no `user.ask` from you. A FAIL verdict leaves it open, in your inbox and Needs you, its card's `missing` carrying the check and the verdict's `reasons`.
- **A spent window waits for its reset.** Its task's check is the reset time: nothing runs; at `plan_resets` the task closes as `ask.moot`, with no verdict in the record, and its sessions resume within 60 s.
- **One automatic continue.** A stop with a transient cause (`timed_out` or `rate_limited`) that the service owns (`owner` other than `you`) gets one `session.continued`, `because: transient`, from that stop, when all of these hold: the stop is the session's newest; it is under 10 minutes old by its stamp (`ts`, from deep-hook's `seq`) when the core sees it; nothing you typed (`user.ask` from `person`) reached the session after it; and no earlier stop since the last prompt you typed was already continued. Otherwise the session stays stopped, its row's `cause` set, nothing in Needs you, no task, no continue. A context overflow (`context_overflow`) is continued the same way, once, `because: context_overflow`. A refusal, a sign-in problem, a spent window, and any cause not named here get none.
- **Where the facts show no hook.** A session whose agent's facts give no hook for a turn that ends in an error (Codex: `session.start`'s `agent: codex`) gets no automatic continue.
- **A chat-app step.** An unblock task raised with `thread: {link, expect}` is a step you take in a chat app. While it's open, each `tick()` reads the thread through `threads.read(link)`. A message from someone other than you, after your post, whose text contains `expect` closes the task as `ask.moot`, with nothing typed. Before you post, nothing changes. After you post, no reply or a reply that doesn't match keeps it open, its card's `missing` carrying the thread link and a reason.
- **The row.** `sessions.cause` shows the session's newest stop's cause.

### How the tests drive it

- As in #318 to #320: `session.start` before anything of a session; `raise` over a `core` connection from the `ask.sources@1` row `deep_ask.unblock` (the chat-app task only; every other task the core raises itself from stops); `tick()` after the clock moves (`World.at`).
- A stop is appended as the hook would (`World.stop`): `agent.stop@4`, writer `hook`, with `ts` and `seq` from the time the test names (`at`), so a stop stamped 9 hours ago reaches the core now. The shapes the criteria name are in `data.ts` (`STOPS`).
- A check passing or failing is the runner's `verdict.made` (`World.passed`, `World.failed`); nothing else runs a check.
- The thread is `FakeThreads`: the test posts as you and as the bot; the core only reads.
- The clock starts at 2026-10-28 12:00 UTC. You are actor and scope `you`. Unblock deadlines are #319's 2 days.

## The contract per criterion

1. **`#85.828d7241` A revoked sign-in that stopped five sessions shows as one task and resumes all five after `/login`.** S1 to S5 stop `sign_in_required` (owner `you`, one signature), one a second apart, a tick after each. One open unblock task in your inbox, owned by you, the one unblock card in Needs you, unblocking all five; each row's `cause` is `sign_in_required`; nothing resumed. Its check (`proves`) passes (the runner's PASS verdict, 5 minutes on); 30 s later the task is `moot`, nothing was typed or answered, and each of the five has one `session.continued` from its own stop, `because: task_closed`, naming the task; no task stays open. **Plant:** one task per stopped session (fails naming the five sessions).
2. **`#85.0840911e` A dropped connection resumes once by itself.** S1 stops `timed_out` (owner `service`); 5 s later it has one `session.continued`, `because: transient`, from that stop; no task, nothing in Needs you. The continued turn drops again a minute later: still one. You type; the turn you started drops: it gets one again. **Plant:** continues twice (fails naming the second drop).
3. **`#85.eb30d189` A task whose check still fails stays open with what's missing.** S1 stops by the sign-in; its task is raised. Its check fails (`reasons: ['gh auth status: not logged in …']`); 30 s later the task is open, in Needs you, its card's `missing` is `{check, reasons}` with `link: null`, and S1 hasn't resumed. The check passes; the task closes and S1 resumes.
4. **`#85.65bcfca8` A refusal stop gets no automatic continue, and a stop whose last message only says "usage limit reached" is sent back like any other.** R stops `refusal` (did work), D stops `timed_out` (service), and U's Stop, whose `last_assistant_message` is "usage limit reached" and whose payload and transcript carry no error, is mapped by Claude Code's shipped adapter: its cause is neither `plan_window_spent` nor `rate_limited`, and U stops with that cause. 5 s on: D continued once; R none, its row says `refusal`, no task for R, nothing in Needs you; U none, no task for U, its row shows the cause the adapter read. **Plant:** continues after a refusal (fails naming the refusal). The send-back itself is the done gate's reply (#83) and isn't in this surface: the test holds that nothing in the text made the stop a task or a continue, so it is judged like any other.
5. **`#85.6ba34710` Sessions stopped by a plan-window limit share one task whose check is the reset time, and resume within 60 s of it.** Five sessions stop `plan_window_spent`, `plan_resets` two hours on, one signature. One task, owned by you, for all five. An hour on, and a second before the reset: open, nothing resumed. A minute after the reset: `moot`, no `verdict.made` in the record, all five resumed from their stops `because: task_closed`, nothing typed.
6. **`#85.9732774d` A context overflow compacts once and re-sends the turn.** S1 stops `context_overflow`: one `session.continued`, `because: context_overflow`, from it. The re-sent turn overflows again: still one; the row says `context_overflow`; no task.
7. **`#85.e12ca936` After you post a test question, the task closes from the thread without you typing, and a missing or wrong bot reply sends the claim back with the thread link.** The agent raises the chat-app task (`thread: {link, expect}`); it's raised, not refused, and in Needs you. A minute on, nothing posted: open. You post the question: open, its card's `missing` has the thread link and a reason. The bot replies wrong: the same. The bot replies what the task expects: `moot`, the connector was read, nothing typed. **Plant:** closes on any bot reply (fails naming the wrong reply).
8. **`#85.0fa0b6d4` Sessions stopped by a network you must reconnect, such as a VPN, share one task and resume within 30 s of its check passing, without you typing.** As 1, with `timed_out`, owner `you`, one signature. **Plant:** one task per session.
9. **`#85.243cc63a` Sessions stopped by a spend limit share one task and resume within 30 s of its check passing, without you typing.** As 1, with `rate_limited`, owner `you`, one signature. **Plant:** one task per session.
10. **`#85.d96aabec` A dropped-connection stop that reaches the hub 9 hours after its stamp … starts no automatic continue … the same stop arriving 2 minutes after its stamp continues once. A rule keyed only on the cause continues the old stop and fails this test.** L's `timed_out` stop is stamped 9 hours before now, M's 2 minutes before; both reach the core now. L: no continue, now or 11 minutes on; its row says `timed_out`; nothing in Needs you; no task. M: one continue from its stop, and only one. **Plant:** keyed only on the cause (fails naming L's stop).
11. **`#85.348d7b85` A dropped-connection stop followed within its 10 minutes by a prompt you typed, or by a newer stop of the same session, starts no automatic continue from it.** P: a drop, then your prompt a minute on; Q: a drop, then a refusal; Q2: a drop, then a newer drop; C: a drop alone. Two minutes on: C continued once; P none; Q none; Q2 once, from the newer stop. **Plant:** continues after a typed prompt (fails naming P's stop).
12. **`#85.051a8df3` Budgets, on the reference Mac in the local preflight, compared with the merge base: a task closes within 10 s of its check passing, and five stopped sessions resume within 30 s.** `budgets.test.ts`: (a) some lane in `scripts/lanes.mjs` runs the file with Vitest and `--no-file-parallelism`, not excluded; (b) on the real clock, the asks core ticked once a second as the hub ticks it, five sessions stopped by one sign-in, their one task raised within 10 s, then its check's PASS verdict: the time to the task's `ask.moot` under 10 s and to the fifth `session.continued` under 30 s, over a warm-up and five runs, judged by #83's rule (PASS when every run is under; FAIL when every run is over the limit by more than their spread; INCONCLUSIVE between), and no reading more than 1.5× and a tick slower than the merge base's. The merge base is this checkout when its packages are the base's, else a copy at `/tmp/dh85-base-<sha>` built from `git archive`, whose built `packages/record/dist` and `packages/asks/dist` the same driver loads; a base that raises no task has no reading, and nothing regresses from it. Readings count only on a reference Mac (Mac15,7 or Mac15,12), Low Power Mode off, thermal state nominal, not loaded past its core count, as #83 gates; elsewhere the test skips as INCONCLUSIVE with the readings printed, never PASS.

## Readings where the issue leaves a choice

- **Which cause is which.** The closed set has no "dropped connection", "VPN" or "spend limit". A dropped connection is `timed_out`; an overloaded service is `rate_limited` (the facts map `overloaded` there); both are transient when the service owns them (`owner: service`). A network you must reconnect is `timed_out` with `owner: you`; a spend limit is `rate_limited` with `owner: you` (only you can raise it). A revoked sign-in is `sign_in_required`, `owner: you`. A refusal is `refusal`, `owner: agent`, a finished turn that did work. A context overflow is `context_overflow`. The tests set these fields on the stops they append, as the adapter's facts would; which payloads produce them is the adapters' business (#312) and isn't tested here.
- **"Transient" is the cause and the owner together,** since one cause (`timed_out`) is a dropped connection when the service owns it and a VPN you must reconnect when you do. A transient the service owns is continued; a block you own is a task. `max_turns`, `tool_schema_rejected`, `agent_crashed` and `unknown` are neither here: no criterion names them, so they aren't tested.
- **"Once"** is one automatic continue per turn you started: the continued turn stopping by a transient cause again gets no second one, and the next prompt you type starts the count again. A reading of "once per session, ever" fails criterion 2's last step; a reading of "once per stop" fails its middle step.
- **"Share one task"** is one open unblock row in your inbox and one unblock card in Needs you, whoever stopped first. What it unblocks is read from `unblocks` on the task, plus on any ask recorded `ask.superseded` by it, so a core that widens the one task in place and one that raises a session's task and folds it into the shared one both pass. A core that keeps five open rows and shows one card (the base's `rides`) fails: `deep inbox` would list five tasks.
- **"Resumes" and "continues"** are the one event `session.continued`, read from the record. How the turn is started in the agent (the Stop hold's reply for a Codex stop held within its hold, the waiter for an idle Claude Code session) is #25's route and isn't tested; nor is the content of the continue (a compaction before the re-send).
- **"Within 60 s / 30 s"** is the virtual clock moved that far past the check passing (or the reset) and one `tick()`: the resume must be in the record then. Criterion 12 measures the real time.
- **"Whose check is the reset time"** is read as behaviour: the task closes at `plan_resets` with no verdict in the record, and not a second before. No field names the reset on the task; its card isn't tested.
- **"What's missing"** is `Card.missing`: the check and the FAIL verdict's `reasons` (or the thread check's reason, with the thread link). The design's "sends the task back with what's still missing" reaches you on the card; the agent's send-back line isn't in this surface.
- **"The session's row shows the stop with its cause"** is the `sessions` projection's `cause` column, a function of the session's events (the design: a projection reads only the log). The hub's `sessions.read` and `deep status` print that table; they aren't driven here.
- **"A read-only connector"** is `AsksOptions.threads`, an object with one method, `read(link)`; it has no way to post. The test implements it in-process (`FakeThreads`), the one boundary mocked, since no chat app is named. "The bot's reply" is a message from someone other than you after your post; "checked against what the task expects" is its text containing `expect`.
- **"Sent back like any other"** (criterion 4): the text-only stop is a finished turn with the cause the adapter reads from structure (`unknown`, at the base's facts); the test holds that it raised no task and got no continue, and that the adapter's cause isn't a spent window. The done gate's reply to it (#83's send-back) isn't in this surface.
- **Codex** (Scope, not a criterion): one untagged test holds that a Codex session's dropped connection gets no automatic continue, by the design's "a turn that ends in an error runs no [Stop hook] and gets no automatic continue". A Codex stop held within its hold while its task's check passes isn't tested: the hold is the hub's.
- **No twins.** Planted twins under `twins/<name>/<repo path>` would have to name the files the implementation changes, which this job can't see; the plants in `plants.ts` are the wrong programs the Proof names, planted around the real core. The implementing session may add twins later (allowed); it can't edit the tests.
- **The budgets' driver ticks the core itself** once a second, as the hub's timer does, since the hub isn't started; a closing that waits for the next tick reads about a second, well under both limits, so the budgets guard a regression (a scan that grows with the record, a resume that waits for a batch) more than a race.

## Criteria, tests and wrong programs

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed and the leading `- [ ] ` dropped (`scripts/proof-change.mjs`). Each test name starts with its ID. A "plant" is a wrong program in `plants.ts`, run by `plants.test.ts`, which first runs the same scenario on the real program (it must pass) and then on the plant (it must fail with the named message).

| # | ID | Criterion (short) | Tests | Wrong programs it fails on | On the base |
|---|---|---|---|---|---|
| 1 | `#85.828d7241` | five sessions stopped by a revoked sign-in: one task, all resume after /login | `signin`: one; `plants`: one | plant: one task per session; the base | FAIL: no open task in your inbox (`expected [] to have a length of 1`) |
| 2 | `#85.0840911e` | a dropped connection resumes once by itself | `transient`: one; `plants`: one | plant: continues twice; the base | FAIL: no continue (`expected [] to deeply equal [['transient', …]]`) |
| 3 | `#85.eb30d189` | a task whose check still fails stays open with what's missing | `missing`: one | the base | FAIL: no open task in your inbox |
| 4 | `#85.65bcfca8` | a refusal gets no continue; "usage limit reached" in the text is sent back like any other | `refusal`: one; `plants`: one | plant: continues after a refusal; the base | FAIL: the dropped connection beside it doesn't continue |
| 5 | `#85.6ba34710` | a plan window: one task whose check is the reset time, resume within 60 s | `plan-window`: one | the base | FAIL: no open task in your inbox |
| 6 | `#85.9732774d` | a context overflow compacts once and re-sends | `transient`: one | the base | FAIL: no continue |
| 7 | `#85.e12ca936` | a chat-app step closes from the thread; a missing or wrong reply sends it back with the link | `thread`: one; `plants`: one | plant: closes on any reply; the base | FAIL: the task is refused (`ask.created@3` has no `thread`) |
| 8 | `#85.0fa0b6d4` | a VPN: one task, resume within 30 s of its check passing | `shared`: one; `plants`: one | plant: one task per session; the base | FAIL: no open task in your inbox |
| 9 | `#85.243cc63a` | a spend limit: one task, resume within 30 s | `shared`: one; `plants`: one | plant: one task per session; the base | FAIL: no open task in your inbox |
| 10 | `#85.d96aabec` | a 9-hour-old stop gets no continue; a 2-minute-old one continues once | `late-stop`: one; `plants`: one | plant: keyed only on the cause; the base | FAIL: the row has no cause (`expected undefined to be 'timed_out'`) |
| 11 | `#85.348d7b85` | a stop followed by your prompt or a newer stop: none from it | `transient`: one; `plants`: one | plant: continues after a typed prompt; the base | FAIL: the control stop doesn't continue |
| 12 | `#85.051a8df3` | budgets: close within 10 s, five resume within 30 s | `budgets`: two | the base (no lane; no task raised) | FAIL: no lane runs the file; the measurement INCONCLUSIVE here (load), on an idle reference Mac: no task within 10 s |

## Files

- `data.ts`: the clock's start, ULIDs and stamps, your settings, the causes and the stops the criteria name (`STOPS`), and `chatTask()`.
- `helpers.ts`: a world (virtual or real clock, record and home in a temporary folder, the asks core with `home` and `threads`, restart on the same record), stops, typed prompts and verdicts as the hook and the runner record them, `session.continued` and the session's row read back, `FakeThreads`, `raised`, `theOneTask`, `unblocksOf`, `nothingTyped`.
- `scenarios.ts`: the scenarios of criteria 1, 2, 4, 6, 7, 8, 9, 10 and 11, shared with `plants.test.ts`.
- `plants.ts`: the wrong programs the Proof names, each the real program with one part wrong.
- `signin.test.ts` (1), `transient.test.ts` (2, 6, 11, and the Codex line of the Scope), `missing.test.ts` (3), `refusal.test.ts` (4), `plan-window.test.ts` (5), `thread.test.ts` (7), `shared.test.ts` (8, 9), `late-stop.test.ts` (10), `budgets.test.ts` (12), `plants.test.ts`.
- `tsconfig.json`: type-checks the suite under the root's strict options with `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the base run and why each test fails there.
