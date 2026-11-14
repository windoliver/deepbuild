# Acceptance tests for #1577: a write retried gets its first result

Written blind, from the issue, `docs/technical-design.md` and base commit `f6d811c7` (main). Never edit these; a dispute goes to this job's blind redraft (design: Dogfooding).

What this job read: issue #1577 (its Scope, 8 criteria and Proof) as of November 13, 2026; epic #1571, and #65 and #576 only to keep their scope out; in the design, "Socket roles and contract versions" (the bullets "Reads and writes a slow link can afford" and "The trusted path is a device you paired", with its `once` table), "An ask, and your answer getting back" ("One table for an ask's life", "Where they reach you", the delivery outcomes) and Dogfooding; `AGENTS.md`; at base, `packages/hub/src` (`hub-control.ts`'s dispatch of `ask.answer`, `ask.undo`, `decision.overrule`, `offer.save`, `run.start`, `staged.undo` and `session.note`; `human-answers.ts`; `answer-delivery.ts`'s `note()` and how a prompt's hook carries notes; `trusted.ts`; `staging.ts`; `runs.ts`; `server.ts`'s roles and reply lines; `wire.ts`; `log-reads.ts`; `hub-shared.ts`'s `DEEP_HUB_TEST_CRASH` seam; `plant.ts`), `packages/asks/src/index.ts` (the closed-ask path that writes `answer.refused`, `undo`), `packages/record`, `packages/contracts` (error@3, answer.refused@1); and the suites `tests/acceptance/16`, `34`, `65`, `340` and `1579`, whose helpers these reuse or follow.

## Run

```sh
npm ci && npm run build --workspaces      # the tests run the built CLI: deep hub run
scripts/lease cargo build --locked -q -p deep-hook   # the hub won't start without target/debug/deep-hook
node node_modules/vitest/vitest.mjs run --testTimeout=600000 --no-file-parallelism --root tests/acceptance/1577
node node_modules/typescript/bin/tsc -p tests/acceptance/1577/tsconfig.json
```

- Node 24 on macOS. `--no-file-parallelism`: every test starts its own hub.
- Every hub runs under `HOME=/tmp/dh1577-*/h`, so its root is `<tmp>/h/.deepbuild`; the real `~/.deepbuild` is never touched. Each hub has `DEEP_HUB_TEST_CONFIRM` set to #34's stand-in (it says yes only while a device is paired), `DEEP_HUB_TEST_CLOCK_STEPS=1` (#965's `test.clock`) and `TZ=UTC`. Processes are stopped by PID, never by name or port; a crash is `SIGKILL` sent to the hub's own PID.
- No network beyond the hub's socket, no model, no account. With `--root` here Vitest writes `tests/acceptance/1577/node_modules/.vite`; delete it before committing.
- `DEEP_HUB_PLANT=<name>` set by hand reaches every hub the suite starts, to try a wrong program.

## The worlds

Everything this repo owns runs for real: the hub (`deep hub run`), its record and asks core, the trusted path's verifier, staging and runs. What it doesn't own is a stand-in:

- **Your settings**: `<root>/config.json` holds the asks block setup drafts (each kind's deadline and default), as #65's worlds write it; without it the base refuses to save an offer for want of an authority deadline.
- **Asks in the record** before a hub starts, raised through the real asks core from rows of `ask.sources@1`: `deep_ask.choice` (options `sqlite` and `files`), and `effect.push` (an authority ask, `approve` or `decline`, defaulting to `decline`) that waits 3 minutes, so stepping the hub's clock 4 minutes defaults it. AC6's third ask is raised in a session ID, so answering it saves a decision for that session.
- **Two devices you paired** with `device.pair`, the OS stand-in confirming you: this Mac's app (A) and your phone (B). Each signs its calls in the design's format, `signature: {signed: {device, method, hub, at, once, params}, sig}`, `at` by the hub's clock, a fresh `once` per signature, `params` the hash of every param but `signature`. Both call on `app` connections.
- **An agent's session**: hook lines this process sends to the hub's socket as a Claude Code session's deep-hook sends them (#16's `hookRequest`, with this process's PID): `SessionStart` and a first `UserPromptSubmit` make it live. A note reaches the agent as the reply to its next `UserPromptSubmit`, as the hub delivers notes today. AC6's permission prompt (`PermissionRequest`, then the `PostToolUse` of the call you said yes to) and destructive call (a `PreToolUse` deep-hook matched with `no-unknown-reach-delete`, naming the folder its reach can't be worked out past) are such lines too, with `<root>/rules.json` the first-party entries an install writes.
- **A cut reply** (AC1): the frame goes on a connection the device loses once the hub has replied; the test keeps that reply only to compare with the retry's. **A crash** (AC4): the hub killed with `SIGKILL` by its PID right after its reply. AC7's crash is the hub's own, at the seam below.

## Criteria

| ID | Criterion | Test | Wrong program it fails on |
|----|-----------|------|---------------------------|
| `#1577.7967d9e6` AC1 | an answer whose reply is cut, sent again with its ID, returns the first result; one `ask.answered`, no `answer.refused` | `answers.test.ts` | the merge base (BASE-FAILURE.txt) |
| `#1577.7ab8071a` AC2 | the same ID with another option is refused, naming the ID | `answers.test.ts` | none named |
| `#1577.f0851143` AC3 | a second device's answer is refused naming the first, with or without an ID | `answers.test.ts` | none named |
| `#1577.1cb11a67` AC4 | the hub killed after a note's reply and before delivery loses nothing | `notes.test.ts` | the merge base, which loses the note |
| `#1577.75136933` AC5 | a note retried after delivery reaches the agent once | `notes.test.ts` | the merge base, which delivers it twice |
| `#1577.0e40df84` AC6 | each write returns a log position, and a read at that position shows the write | `positions.test.ts` | none named |
| `#1577.a6b9b799` AC7 | the hub killed after reading an answer with its request ID and before its commit: the same ID after the restart applies once, one `ask.answered` | `crash.test.ts` | `pending-across-restart` (hub) |
| `#1577.0d3ede71` AC8 | an undo from a view at P, for a default another device answered after P, is refused naming that answer, and the answer stands | `views.test.ts` | `applies-stale-undo` (hub) |

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed. `twins.json` maps each criterion that names a wrong hub to its twin under `twins/`. The Proof, "each lost-reply case on this branch and the merge base", is the lost-reply tests (AC1, AC4, AC5 and AC7) run on both: the proof lane runs them on the merge base with the branch's tests, and `BASE-FAILURE.txt` holds this job's run of every test there. No test was added for it.

## The surface (my choice)

The issue names request IDs, receipts, a reply's log position, the view a write was made from and a read at a position; not their params, fields or refusals. These follow the base's own wire: `session.note` already takes `request` (#340), every App API read already replies with the `log_pos` it reflects, and every refusal is error@3 (`code`, `path`, `actual`, `remediation`). An implementation must provide exactly these.

**`request`, the request ID.** Each write with an effect takes an optional param `request`, a string of 1 to 64 characters from `[0-9A-Za-z_-]`, as `session.note` has it: `ask.answer`, `ask.undo`, `decision.overrule`, `offer.save`, `run.start`, `staged.undo` and `session.note` (where it stays required). It is a param like any other, so a device's signature covers it (`signed.params` is the hash of every param but `signature`).

**A retry.** A call's device is the paired device its signature names (`signature.signed.device`), and for a call that carries no signature the connection's role (`app` or `cli`). A call whose device already sent the same method with the same `request`:

- with the same params (every param but `signature`, compared by their RFC 8785 bytes) gets the first call's reply again: its `result` deep-equal to the first's, `log_pos` included. Nothing is appended for it, `answer.refused` included. This holds for the very frame sent again, its `signature` and its spent `once` included: a retry follows its request ID and is never refused for its `once`.
- with other params is refused, changing nothing: error@3 with `path` `/params/request` and `actual` the request ID.

The same `request` from another device is no retry: the call is handled as a new write. So a second device's answer to an ask already answered is refused as #65 has it, with or without a `request` and whatever it carries: `path` `/params/ask`, its words naming the first answer's option.

**Receipts.** A write's receipt commits in one transaction with its events and outlives a restart. Nothing of a write whose commit a crash cut outlives the hub process: no receipt, no mark that its request ID is in progress, and no spent `once` that would refuse its frame. The same frame sent after the restart applies once, as a first call.

**`log_pos`, where a write landed.** The `result` of each of the seven writes carries `log_pos`, an integer: the log position the write landed at, at or after each event the write appended and no later than the log's end when the reply is read. A retry's `result` carries the first call's. A read at that position is `events.read` paged up to it, and it holds the write's own event:

| Write | Its own event |
|-------|---------------|
| `ask.answer` | the `ask.answered` whose `subject` is the ask |
| `ask.undo` | the `default.undone` whose `subject` is the ask |
| `decision.overrule` | the `decision.overruled` whose `subject` is the decision (`decision:<id>`) |
| `offer.save` | the `decision.created` the reply's `decision` names (`decision:<its id>`) |
| `run.start` | the `run.started` whose `subject` is the reply's `run` |
| `staged.undo` | a new event naming the staging's handle `staged:<id>` (its `subject` or in its `data`) |
| `session.note` | a new event whose `data` holds the note's words and its request ID |

**`view`, what you were shown.** `ask.undo`, `decision.overrule` and `staged.undo` carry `view`: the `log_pos` of the read the call's view came from (any App API read: `inbox.read`, `sessions.read`, `events.read`). When an event after `view` changed the call's target (for an ask: an answer, a default, or an undo of its default; for a decision: its overrule; for a staging: its undo), the call is refused and changes nothing: error@3 with `path` `/params/view`, `actual` the log position, in decimal, of the newest such event, and `remediation` saying what it was, for an answer the option it chose. The tests always send `view` on these three; a call without one isn't tested here.

**A note.** `session.note {session, text, request}` on an `app` connection, as #340 has it. Its reply comes only once the note is in the record ("Your words are in the record before the hub says it has them"); the reply's `result` carries `log_pos` beside `session` and `request`. A note reaches the agent once: in the reply to its session's next prompt hook (`UserPromptSubmit`), as today, its words in what that reply carries; after a restart, a note the record holds and no prompt carried goes with the session's next prompt. A note delivered stays known: the same `request` sent again for that session, at any time after, delivers nothing more.

**Test-only settings.** `DEEP_HUB_TEST_CRASH=before:ask.answered`, the seam as base has it (`hub-shared.ts`, `crashing`): the hub kills itself with `SIGKILL` before an `ask.answered` commits, after everything the answer does before that, its request ID read. The implementation keeps it firing on whatever path commits an answer with its receipt. A restart starts without it.

## Wrong programs

Each twin is `packages/hub/src/plant.ts` as base `f6d811c7` has it, with `plantOf` and `activePlant` fixed to its name; the implementation adds each name to `Plant` and `PLANTS` and makes the hub do that wrong thing under it.

| Value | The wrong program |
|-------|-------------------|
| `pending-across-restart` | the hub marks a request ID in progress where the mark outlives the process, before the write commits; after a restart it answers a call with that ID that it is still in progress (AC7) |
| `applies-stale-undo` | an undo whose target changed after its `view` is applied anyway: the default is undone though another device answered the ask after that view (AC8) |

## Readings where the issue leaves a choice

- **"Its ID" (AC1, AC7)** is `request`, and "sent again" is the very frame: the same params, signature and `once`. The design says a retry of the same write follows its request ID, not the spent-`once` refusal.
- **"Returns the first result" (AC1)** is the retry's `result` deep-equal to the reply that was cut.
- **"Naming the ID" (AC2)** is `path` `/params/request` with `actual` the ID; **"naming the first" (AC3)** is the refusal #65 gives a second answer, `/params/ask`, naming the first answer's option. AC3's "with an ID" is sent twice: with the first answer's ID and another option, and with the first answer's ID and its very params, a replay from another device, which must not get the first's result.
- **"Before delivery" (AC4)** is before the session's next hook line: no waiter or held stop is set up, so a prompt's hook is the only way the note reaches the agent.
- **"A read at that position" (AC6)** is `events.read` up to it; "shows the write" is the write's own event in that read (table above). AC6's setup answer that saves the decision carries no request ID and is not one of the seven measured writes.
- **"A view at log position P" (AC8)** is the `log_pos` of the app's `inbox.read` that showed the default; "another device answered after P" is the phone undoing the default (from its own fresh view) and approving, since a defaulted ask takes an answer only once its default is undone. "Naming that answer" is `actual` the approval's log position and `remediation` naming `approve`, the option it chose; the default, `decline`, would not do. "The answer stands" is one `default.undone` (the phone's), one `ask.answered` (`approve`), and the ask answered in the inbox.
- **The phone's setup writes in AC8** carry no request ID; the app's undo under test does.

## How far these tests were checked

Type-checked with this tsconfig. Run once each on base `f6d811c7`: all 8 fail (`BASE-FAILURE.txt`), AC4 and AC5 as the issue says (the note lost, the note delivered twice), the rest for the missing surface (the base's `ask.answer` refuses `request`; no write's reply carries `log_pos`; the stale undo is refused at `/params/ask`, not `/params/view`). The setup each test needs was first tried on the base with a throwaway probe: two paired devices signing in the design's format, an answer without a request ID counting, a decision saved by answering an ask raised in a session and then overruled, a default by the stepped clock and its undo, a run started, a note delivered at the next prompt, a permission prompt offered back and saved, a staging of a matched delete and its undo, and the crash seam killing the hub with `SIGKILL` before an `ask.answered`. Never run against an implementation, because none exists, nor against the twins.
