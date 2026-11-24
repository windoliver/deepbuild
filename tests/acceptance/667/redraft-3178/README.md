# Blind redraft of #667 AC1 and AC2: the choice ask listed, answered, and heard back once

Written blind at base `37dd3c0c8` (Merge pull request #3072, `origin/main`) from issue #667's body (summary, Scope,
five criteria, Proof, Depends on; its comments not read), `docs/technical-design.md` and the base, by a fresh run of
the blind acceptance-test job (AGENTS.md, Proof; design, Dogfooding) for two criteria. It edits no file outside this
folder; the earlier suite (`../`) is an input it imports from and doesn't change.

## The criteria

- AC1 `#667.254d6157` (the earlier suite's `#667.84442921`): "`deep inbox` lists the choice ask with its kind, session
  and age within a second of its append, and the stream consumer gets its frame at the same log position"
- AC2 `#667.8700acae` (the earlier suite's `#667.b25a1d05`): "`deep inbox answer` on the choice ask saves a decision
  with its scope, the ask leaves `deep inbox`, the stream shows it answered, and the test process that raised it gets
  the answer once"

### Criterion IDs

Computed as `criterionId` in `scripts/proof-change.mjs` does (first 8 hex of SHA-256 of the text after `- [ ] `,
trimmed, white space collapsed) from the body `gh issue view 667` serves today. Each test name starts with the
computed ID, followed by the earlier suite's ID, so the lanes find either tag; every failure message starts with the
computed ID.

## What was read

- AGENTS.md; issue #667's body.
- `docs/technical-design.md`: An ask, and your answer getting back ("Work goes on while you decide": a choice with a
  recommendation goes on at once, provisionally; "One table for an ask's life": a later answer is refused and recorded
  as `answer.refused`, nothing reaches the agent; Where they reach you); Ask; Decision and rule (scope set from the ask,
  saved for this repo, widened only on your confirmation, never saved at a scope its card didn't show); States people
  see; the Claude Code row of the adapters table (answers as PostToolUse context or at the stop hold, delivered once).
- At the base: `packages/hub/src/inbox.ts`, `mcp-operations.ts` (`askFor`, `waitFor`), `answer-delivery.ts`
  (`deliver`, `shown`, `unwoken`), `answers.ts`, `hub-shared.ts` (`said`, `SHOWN_SOON`, `WAKE_GRACE`), `plant.ts`,
  `packages/asks/src/index.ts` and `dist/decision-keys.js` (`scopeOf`); `scripts/proof-change.mjs`; `../helpers.ts`,
  `../fixtures/agent.mjs`, `../redraft-1463/` and `../redraft-2047/` for the layout.

## How to run

Node 24.22 first on `PATH`, macOS, from the checkout's root, after `npm ci && npm run build --workspaces`:

```sh
npx vitest run tests/acceptance/667/redraft-3178/criteria.test.ts --reporter=verbose --silent=false
npx vitest run tests/acceptance/667/redraft-3178/plants.test.ts --reporter=verbose --silent=false
bash tests/acceptance/667/redraft-3178/mutants.sh <built checkout> <scratch folder> inbox-drops-session   # or scope-all
npx tsc --noEmit -p tests/acceptance/667/redraft-3178
```

Each test runs on a world of its own, with no model and no network: `../helpers.ts`'s fresh `/tmp/dh667-*` home, the
hub and every `deep` run with `HOME` there, the OS confirmation stubbed `confirmed` by `DEEP_HUB_TEST_CONFIRM` (no
real Touch ID prompt), every process stopped by PID (`cleanup`). Each test prints its proof at the end: every
`deep inbox` output, the stream's frames with their log positions, the record's ask, answer and decision rows, the
`delivery.*` rows, and the stdout of every hook reply after the answer.

## The surface, and what the implementation must provide

- **`deep inbox`** and **`deep inbox answer <ask> <option>`**, run by you as children of the test process.
- **The agent stand-in** (`../fixtures/agent.mjs`): `establish` sends its first hooks; its own `deep mcp` raises the
  choice ask with `deep_ask` ("Keep the invoices/receipts on SQLite or plain files?", `sqlite` recommended, `files`);
  `world.ts` then sends its later hooks (PreToolUse/PostToolUse, Stop, Stop with `stop_hook_active`,
  UserPromptSubmit) from its own process, and, as Claude Code does, writes each reply's `additionalContext` or block
  reason into its transcript (a hook-context attachment, or a user entry), and each prompt before its hook.
- **The socket** as `cli`: `events.read`, `inbox.read` (only its `log_pos`) and `stream.subscribe`.
- **`config.json`'s `asks` block** as `../helpers.ts` writes it (choice `4h`, default recommended).

The implementation must: file the ask within 30 s of the `deep_ask` call, whether the call returns at once or waits; a
`deep inbox` line naming the ask's ULID with the word `choice` outside the question, the session's ID (whole or its
first 8 letters and digits) and its age as a count and unit (or `just now`); frame the `ask.created` and the
`ask.answered` at the `log_pos` the record holds them at, within 5 s; on your answer exit 0, append one `ask.answered`
`files` and one `decision.created` (`data.ask` the handle, `data.answer` `files`, `data.scope`
`repo:<project letters>` when the ask or its session names a project, else `session:<session letters>`); drop the ask
from `deep inbox`; carry the answer to the agent exactly once over its `deep_ask` reply and every later hook; refuse a
second answer with a non-zero exit, record one `answer.refused`, and send nothing of the ask after it.

## Wrong programs

| Name | Where | What it does | Criterion | How the test fails on it |
|---|---|---|---|---|
| `inbox-drops-session` | `mutants.sh`, over `packages/hub/dist/inbox.js` in an APFS clone | `deep inbox` lists each ask without the session that raised it | AC1 | `#667.254d6157: deep inbox lists ask:… with its session, …: <the line>` |
| `scope-all` | `mutants.sh`, over `packages/asks/dist/decision-keys.js` in an APFS clone | every answer saved as a decision for all your repos | AC2 | `#667.8700acae: your answer to ask:… is saved as one decision with its scope, session:…` (received `all`) |
| `sends-shown-again` | `DEEP_HUB_PLANT` (the base's `plant.ts`), `plants.test.ts` | keeps no answer in flight, so each later route sends it again | AC2 | `#667.8700acae: the agent that raised ask:… got your answer 5 times, once expected` |

The issue's Proof names two wrong programs (a hub skipping the default, an inbox counting an answer from inside the
session); both belong to AC3 to AC5, which `../redraft-2047` covers. No plant at the base reaches AC1, and none reaches AC2's
scope, hence the two mutants; they change only a clone, never the checkout.

## Criterion to tests

| Criterion | Test | What counts as failure |
|---|---|---|
| AC1 `#667.254d6157` | `criteria.test.ts`, AC1 | no `ask.created` within 30 s (BLOCKED); it isn't a choice from the agent's session with a 4-hour deadline and the default `sqlite`; a `deep inbox` run exits non-zero, or one started a second or more after the append doesn't list it; the first listing lacks `choice`, the session or an age matching the time since the append; no frame at the record's `log_pos` for the `ask.created` within 5 s. A first listing that started in time but ended over a second after the append is INCONCLUSIVE (skipped with the reading and the load), never PASS |
| AC2 `#667.8700acae` | `criteria.test.ts`, AC2; `plants.test.ts` on `sends-shown-again` | the answer exits non-zero; not one `ask.answered` `files`; not one decision at the ask's scope; the ask still in `deep inbox`; no frame for the answer at its `log_pos`; the agent gets the answer other than exactly once (its `deep_ask` reply if that waited, plus every later hook reply naming the ask's ULID), or what it got isn't `files`; a second answer exits 0, isn't one `answer.refused`, adds an answer or a decision, or any later hook names the ask |

## Outcome on the base

See `BASE-RESULTS.txt`: both tests PASS at `37dd3c0c8`; AC1 FAILS on `inbox-drops-session`; AC2 FAILS on `scope-all`
and on `sends-shown-again`, each naming the criterion and the ask. The earlier `../redraft-1463` fails BLOCKED at this
base because `deep_ask` returns `provisional` at once, as the design says a choice with a recommendation does; this
redraft reads the ask from the record instead and waits for the answer on the session's routes.

## Readings and assumptions a redraft may revisit

1. **The choice ask goes on at once.** It has a recommendation (its default, by #319's drafted `recommended`), so
   `deep_ask` may return provisional; the test accepts that or a waiting call.
2. **"Gets the answer once"** counts every way the answer can reach the raising process: its `deep_ask` reply (if it
   waited) and the replies to its next tool calls, its Stop and the Stop after the hold, the next turn's prompt, tool
   call and stops. A reply carries the answer when it names the ask's ULID. The rules context the next prompt gets
   (`- files`, from your saved decision) names no ask, so it isn't counted: it is the decision as a rule, not the answer.
   The test doesn't call `deep_wait`, which is the agent asking again, not the hub delivering.
3. **Claude Code's transcript** is the boundary mocked: the stand-in writes what Claude Code writes for a hook reply,
   so the hub can read that a turn carried the answer. Without it, a real hub would rightly send it again.
4. **"With its scope"** is the ask's scope as the design and the asks core set it: the session's repo, else the
   session (this world's agent works in a folder with no repo).
5. **"Within a second"**: every run started a second after the append must list it (FAIL), and the first listing must
   end within 1,000 ms of the append, else INCONCLUSIVE.
6. **The line's layout** (question first, handle last) isn't checked: the criterion names kind, session and age only.
7. **"At the same log position"** is the record's `log_pos` for the `ask.created`, read with `events.read`.
8. **The stand-in's later hooks** go through `Agent`'s private `send` (`world.ts`, `hook`), reached with
   `as unknown as`. `../helpers.ts` has no public surface for it: `establish` sends only its fixed SessionStart,
   UserPromptSubmit and PreToolUse, and a hook client started from the test process would have the test, not the agent,
   as its parent, so the hub wouldn't place it in the agent's session. `send` is the channel `establish` itself uses,
   so the hooks are the stand-in's own.

## AC4 and AC5: added, then removed

At the coordinator's request this folder briefly held AC4 and AC5 tests (`deadlines.ts`, `deadlines.test.ts` and two
`skip-default-at-deadline` tests in `plants.test.ts`); they passed at the base and failed on the plant
(`BASE-RESULTS.txt`). A review then found they duplicate `../redraft-2047/`, which #3178's suite now lets stand in for
AC4 and AC5 by folder with the computed IDs as aliases (AGENTS.md: no duplicate test), so they were removed.

## Files

- `world.ts`: the IDs; the world; the agent's later hooks with their transcript writes; the AC1 and AC2 scenarios.
- `criteria.test.ts`: AC1 and AC2 on the real hub.
- `plants.test.ts`: AC2 on `sends-shown-again`.
- `mutants.sh`: the two mutants over a clone, and the run there.
- `tsconfig.json`: as `../redraft-2047`'s.
- `BASE-RESULTS.txt`: the runs.
