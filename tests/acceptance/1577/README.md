# Acceptance tests for #1577: a write retried gets its first result

Request IDs, receipts and the log position, and your words saved before the hub says it has them. A job that never saw
an implementation wrote these first, blind, from the issue, the design and base commit `35df4523f`. The implementing
agent doesn't edit them (AGENTS.md, Proof). A dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- **The issue**, windoliver/deepbuild#1577: its body, Scope, the eight acceptance criteria and Proof.
- **The design**, `docs/technical-design.md`. Under "Socket roles and contract versions": "Reads and writes a slow
  link can afford" (every app or CLI write with an effect takes a request ID; same device, ID and params get the first
  result and write nothing; the same ID with other params is refused; a receipt commits with its event; every reply
  carries the log position it landed at; your words are in the record before the hub says it has them) and "The
  trusted path is a device you paired" (the signature envelope; a spent `once` is refused, "and a retry of the same
  write follows its request ID (#1577)"). "An ask, and your answer getting back", "One table for an ask's life": the
  first answer appended decides, and a later one is refused, naming it, and recorded `answer.refused`. "One event log,
  with tables built from it": `log_pos`. The Dogfooding paragraph.
- **The base**, for surfaces and conventions only: `packages/hub/src/core.ts` (`dispatch`, `answer`, `undo`,
  `overrule`, `saveOffered`, `note`, `appNotes`, `offer` and the waiter, `noteText`, the `DEEP_HUB_TEST_CRASH` cut
  points in `crashing`), `server.ts` (roles, the hello's `hub`, the reply line, `test.clock`), `wire.ts`, `staging.ts`,
  `runs.ts`, `log-reads.ts` (`events.read` and the `log_pos` a read reflects), `packages/asks/src/index.ts` (the answer
  path, `ANSWER_FIELDS`, the closed-ask refusal that records `answer.refused`).
- **Sibling suites**, for conventions and helpers: 16 (the hub process, the socket client, cleanup by PID), 34 (the
  OS stand-in `Confirmer`), 1579 (the signature envelope and `signNew`, imported), 65/redraft-1579 (a second device
  answering an ask the app answered), 340/app (`session.note`, the transcript shape, the waiter's text), 23 (ask
  settings, an offer you said yes to in the terminal), 347 (a staged delete).

## What the base already does (from the base run, BASE-FAILURE.txt)

- `session.note {session, text, request}` is served to the app. A repeat with a request ID it still holds changes
  nothing. A note is held in memory only: the waiter or the next prompt's context carries it, and the record holds it
  only once a prompt shows it (`user.ask` `from: app`, `request`). Once delivered, the ID is forgotten.
- `ask.answer` refuses any field the asks core doesn't list, `request` among them: "an answer has no field request",
  `/params/request`. `ask.undo`, `decision.overrule`, `offer.save`, `run.start` and `staged.undo` ignore extra fields.
- A second signed send of the same answer is refused at `/params/signature/signed/once`. A second answer under a new
  signature is refused naming the first answer and recorded `answer.refused` (AC1's control, which passes).
- No write's reply carries `log_pos`. The reads do (`events.read`, `inbox.read`).
- `DEEP_HUB_TEST_CRASH=before:<kind>` makes the hub SIGKILL itself 50 ms before it appends an event of that kind.

## How to run

```sh
npm ci && npm run build --workspaces          # packages/cli/dist/main.js, which the tests start as `deep hub run`
cargo build --locked -p deep-hook             # target/debug/deep-hook; the hub won't start without it
NO_COLOR=1 node node_modules/vitest/vitest.mjs run tests/acceptance/1577 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1577/tsconfig.json
```

Each test starts its own hub in a temp home under `/tmp/dh1577-*` (`HOME=<tmp>/h`). It stops only the processes it
started, by PID, and removes the folder. It never touches the real `~/.deepbuild`. No network, no model, no real agent.

## The surfaces under test

- **The hub**: `deep hub run` from `packages/cli/dist/main.js`, started with `DEEP_HUB_TEST_CONFIRM` (the OS stand-in),
  `DEEP_HUB_TEST_CLOCK_STEPS=1` (`test.clock`, to take a default), and in AC7 `DEEP_HUB_TEST_CRASH`. Asks are seeded
  through the real asks core before the hub starts. Ask settings go in `config.json`, as setup drafts them.
- **The app's and the CLI's socket API**: an `app` and a `cli` connection with the control token. The writes are
  `ask.answer`, `ask.undo`, `decision.overrule`, `offer.save`, `run.start`, `staged.undo` and `session.note`. The reads
  are `events.read`, `inbox.read` and `session.wait`.
- **Two paired devices**: this Mac's app and your phone, each paired with `device.pair`. Each signs a trusted write in
  the design's envelope `signature: {signed: {device, method, hub, at, once, params}, sig}` (#1579's `signNew`).
- **A cut reply** (`cutter`): a Unix socket in front of the hub's that carries every line both ways, except the reply
  whose `id` it names. It keeps that reply and never hands it on, as when a phone's link drops after the hub wrote it.
- **The agent side**: hook lines for a Claude Code session (SessionStart, UserPromptSubmit, Stop, PermissionRequest,
  PostToolUse, PreToolUse with `stage`), sent as deep-hook sends them, with a transcript in Claude Code's shape. The
  session works in a git repository with one commit. The waiter is deep-hook's `session.wait`, which Claude Code's Stop
  entry runs. A wake is the prompt its exit 2 starts, carrying its text as a task notification.

## Criteria to tests

| Criterion | Test | How it fails on the base |
|---|---|---|
| `#1577.7967d9e6` AC1: an answer whose reply is cut, sent again with its ID, returns the first result; one `ask.answered`, no `answer.refused`; the base fails naming the refusal | `ac1-retry.test.ts`: the app's signed `ask.answer {ask, option: sqlite, request}` through the cutter; the hub's reply is cut. The very same line again: no error, `result` equal to the cut reply's `result`, no new event about the ask, `ask.answered` `[sqlite]`, no `answer.refused`, inbox `answered`. Control: two answers with no request ID, the second refused and recorded `answer.refused` | at "must return the first result, not a refusal; it was refused: …" (the spent `once`) |
| `#1577.7ab8071a` AC2: the same ID with another option is refused, naming the ID | `ac2-other-params.test.ts`: `sqlite` under ID R, then `files` under R, freshly signed. Refused, and the error's JSON contains R. `ask.answered` stays `[sqlite]` | at the first answer: `request` is an unknown field |
| `#1577.f0851143` AC3: a second device's answer is refused naming the first, with or without an ID | `ac3-second-device.test.ts`: the app answers `sqlite` with ID R. The phone, signing as itself, answers `files` with no ID, with its own ID, and with R. Each is refused, naming `sqlite`, and none gets a result. `ask.answered` stays `[sqlite]` | at the app's first answer (`request`) |
| `#1577.1cb11a67` AC4: the hub killed after a note's reply and before delivery loses nothing; the base loses the note | `ac4-note-crash.test.ts`: after a turn, `session.note` is taken. The hub gets SIGKILL by its PID and starts again. Then the next prompt, a waiter, its wake and one more prompt: the note's words reach the agent at least once | at "the note … was lost: after the restart no prompt's reply, waiter or wake gave the agent its words" |
| `#1577.75136933` AC5: a note retried after delivery reaches the agent once; the base delivers it twice | `ac5-note-once.test.ts`: the note is handed to the waiter, and the wake carries it. The same `session.note` again (taken, not refused), then a prompt, a waiter, its wake and a prompt: the words were given once in all | at "must reach the agent once; it was delivered twice or more, by waiter, UserPromptSubmit" |
| `#1577.0e40df84` AC6: each write returns a log position, and a read at it shows the write | `ac6-log-position.test.ts`, one write of each kind the Scope lists, each with a request ID: `ask.answer`, `ask.undo` of a default, `offer.save` of an offer you said yes to in the terminal, `decision.overrule` of that decision, `run.start`, `staged.undo` of a staged delete, `session.note`. Each reply's `result.log_pos` is a positive integer, the log has reached it, and `events.read` from the log's end before the write, cut at `log_pos`, holds the write's event | at the first write (`request`). Past it, at the missing `log_pos` |
| `#1577.a6b9b799` AC7: the hub killed after reading an answer with its ID and before its commit; the same ID after the restart applies once, one `ask.answered`; a pending mark kept across the restart fails | `ac7-crash-before-commit.test.ts`: under `DEEP_HUB_TEST_CRASH=before:ask.answered`, the signed answer with ID R. The hub must die at its cut point, and is started again without it. Nothing is committed. The same line again: no error, `answer: files`, `ask.answered` `[files]`, no `answer.refused`. A third send gets the same result, still one `ask.answered` | at "must be read and on its way to its commit … the hub stayed up and replied" (`request`) |
| `#1577.0d3ede71` AC8: an undo from a view at P, for a default another device answered after P, is refused naming that answer, and the answer stands; a hub that applies it fails | `ac8-stale-undo.test.ts`: a taste ask takes its default. The app reads `inbox.read` (P is its `log_pos`) and sees it defaulted. After P the phone undoes the default and answers `green`. The app's `ask.undo {ask, view: P, request}`: refused, naming `green`. There is no new `default.undone`, `ask.answered` stays `[green]` and the inbox reads `answered` | at the phone's answer (`request`) |

### The wrong programs AC7 and AC8 name

- **AC7, "a hub that keeps a pending mark for the ID across the restart, and answers that it is still in progress"**:
  such a hub writes the mark when it reads the answer, before its commit, and finds it after the restart. Its reply to
  the retry is an error ("still in progress"), so the test fails at "must apply, not be refused (a mark that it is in
  progress must not outlive the hub)". If it answered with a result and no event, it fails at `ask.answered` `[files]`.
- **AC8, "a hub that applies the undo"**: it takes the stale undo, so `stale.error` is undefined and the test fails
  at "must be refused, since the phone answered … after it; it was taken". Had it opened the ask anyway, the
  `default.undone` count and the inbox checks fail too.

Neither program is planted in the hub. The tests fail on each by the assertions named above.

## Readings of what the criteria leave open

- **The request ID's field is `request`**, a string in the write's params beside its other fields. `session.note`
  takes `request` at the base, and `user.ask` and `action.entered` record the same name. The tests send `req-` and 16
  base64url characters, which fits `session.note`'s base pattern (1 to 64 of `[0-9A-Za-z_-]`).
- **A signed write's request ID is inside what it signs.** `request` is one of the params, so the signature's
  `params` hash covers it. A retry is the very same line: the same device, signature (with its spent `once`), request
  ID and params. The design says "a retry of the same write follows its request ID", so for a retry the request ID
  decides before the spent `once` does: the retry gets the first result. A new answer under a reused ID is freshly
  signed with its own `once` (AC2, AC3), so only the ID is reused. "Same device" is the signing device; the phone
  sending the app's ID (AC3) is another device's write, refused naming the first answer, never given the app's result.
- **"The first result comes back"** means the retry's reply has no `error`, and its `result` deep-equals the first
  reply's `result`, the one the hub wrote and the cutter kept. That includes any `log_pos` it carries, since the write
  landed once. "No event is written" is read as no event about the ask after the log's end before the retry. Events of
  no subject the hub writes on its own (readings, state passes) are not counted.
- **The log position field is `log_pos`** in each write's `result`, a positive integer, as the base's reads carry it.
  "A read at that position shows the write": the log has reached `log_pos` (the end `events.read` reflects is at least
  it), and `events.read` from the log's end before the write, cut at `log_pos`, holds the write's event. Each write's
  event is the base's kind for it: `ask.answered` (subject the ask), `default.undone`, `decision.created` (the
  decision `offer.save` returns), `decision.overruled`, `run.started` (subject the run), an event that names the staged
  handle or its ID, and for a note an event whose data carries its request ID. The design says "your words are in the
  record before the hub says it has them". The base has no event for a staged undo, so one must be added. The test
  takes any event that names `staged:<id>` or `<id>` in its subject or data.
- **The view a write names is `view`**, the `log_pos` of the read the app showed (here `inbox.read`'s), in the
  write's params. The issue: "carries the log position of what you were shown". The phone's own undo in AC8 carries
  the then-current view. Refusal "naming that answer" is read as the error's JSON containing the answer's option ID.
- **Killed after reading an answer with its request ID and before its commit** (AC7): the base's cut point
  `DEEP_HUB_TEST_CRASH=before:ask.answered`. The hub SIGKILLs itself just before it appends `ask.answered`, after the
  answer's checks (the signature, the trusted path). It's the closest point the base offers to "before its commit".
  A pending mark written on reading the request sits before that point, so the test still catches the wrong program.
  The restart leaves the variable out.
- **Killed after a note's reply and before delivery** (AC4): SIGKILL of the hub's PID, which the test started, right
  after the note's reply. No prompt, waiter or wake ran between them, so the note was not delivered. No cut point is
  needed. The reply is in hand before the kill, so a hub that saves the words before replying keeps them.
- **"Reaches the agent" and "delivers it twice"** are counted by the note's words in what the agent is given: a hook
  reply's stdout and stderr (a prompt's `additionalContext`) and the waiter's text. The wake the waiter starts carries
  that text in its prompt, so it isn't counted again. AC4 needs at least one; AC5 needs exactly one over the waiter's
  delivery and every route after the retry.
- **A retried note is taken, not refused** (AC5): the issue says a late retry "sends nothing", not that it is refused.
- **The second device** is a second paired key, "your phone", calling over an app connection with its own signature,
  as #1579's verifier serves every device. The #65 channel route is not used, since the issue's "with or without an
  ID" is about the socket write.
