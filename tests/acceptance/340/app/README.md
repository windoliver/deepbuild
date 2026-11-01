# Acceptance tests for #340, AC6: a note from the app, recorded as `from: app` by its request ID

A note the app sends into a session is recorded as `user.ask` with `from: app` and its delivery's request ID, on the
waiter's route and on prompt context's, and opens a task as a typed prompt would; your terminal's words never pass
for the app's; an earlier reader reads `app` as `unknown`.

Written first, blind, by a job that never saw an implementation of #340. The implementing agent does not edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job. A sibling blind job covers AC1 to AC5 in
`../flow/`.

## Sources

- **The issue**, windoliver/deepbuild#340, as of `updatedAt` 2026-10-29T04:23:42Z: Scope, AC6, Proof and Depends on.
- **#25**, as amended on Oct 29 for #85: setup writes the waiter's entry under Stop and under StopFailure.
- **The design**, `docs/technical-design.md`:
  - "Your words, from one box" (Extension API): every message the app sends into a session carries its origin, `from:
    app` with its delivery's request ID, matched by that ID whichever route carried it, the waiter included; it opens a
    task as a prompt you typed would; it never answers an authority ask or saves a decision.
  - What done means, fixed at the start, "When": "Words you sent from the app count as typed by you: they're recorded
    `from: app` by their delivery's request ID, whichever route carried them."
  - An ask, and your answer getting back: the delivery routes, steer and interrupt, the four outcomes, "Text that shows
    up in a session's own prompt never answers an authority ask".
  - What each agent gives us, Claude Code's row: the `asyncRewake` waiter, prompt context as the fallback, "and `app`
    for words DeepBuild delivered from the app, matched by the delivery's request ID".
  - Socket roles and contract versions: one role per credential, the control token held by the app and the CLI only,
    and "What a minor may change" (a member added to an extensible set is a minor; a reader at an earlier minor maps it
    to `unknown`).
- **The base commit**: `fe593280` (origin/main on Oct 28; the worktree's HEAD `248c9695` changes only server.ts's
  extension wiring and a hub unit test). Base files read:
  - `packages/hub/src/server.ts` (roles, `ALLOWED`, the control token, `session.wait`), `core.ts` (`enrich`, the
    `user.ask` origin, `queuedAsks`, `hookReply`, `offer`, `waitAnswer`, `unwoken`, how a waiter's answer is confirmed
    from the wake's prompt or the transcript), `ask-tasks.ts` (`tasksOf`, `asksForChange`, `opened`), `plant.ts`.
  - `packages/contracts/schemas/user.ask@1.json` (its `from` enum, marked extensible with `unknown`;
    `data.additionalProperties: false`), `delivery.outcome@1.json`, `action.entered@1.json` (its `request` field), and
    the contracts' and conformance's public entries (`getSchema`, `listSchemas`, `validate`, `registry`, `d1Digest`;
    `contractStep`, `serveAt`).
  - `adapters/claude-code.facts.json` (the UserPromptSubmit origin rules) and `spikes/80/logs` (the desktop app's wake).
- **Sibling suites, for conventions and copied helpers**: tests/acceptance/25/routes and 25/fallbacks (the Claude Code
  stand-in, the waiter's wake, prompt context to a session whose waiter is off), 303 (README, how a task opens, plants),
  313 (`contractStep`, `serveAt`), 321 and 24 (control token, app and CLI roles).
- **For `authority.test.ts`** (added on the owner's request to close the Scope clause the first draft left out):
  tests/acceptance/321's README and helpers (the planted sorter `DEEP_HUB_TEST_SORTER`, the seeded `rules.json` and ask
  settings, "Held at PreToolUse"), and the base's `packages/hub/src/server.ts` (`gated`, `gateReply`, `holdFor`),
  `holds.ts` (`gate`, `heldEffect`, `proceeding`, `raise`), `core.ts` (`toolGate`, `inbox`) and
  `crates/deep-hook/default-rules.json` (`authority-push`).

## How to run

With Node 24.22 first on `PATH` and the Rust toolchain:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub and the deep CLI the tests start
cargo build --locked -q -p deep-hook     # target/debug/deep-hook, which every hook and the waiter run
npx vitest run --root tests/acceptance/340/app --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/340/app/tsconfig.json
```

- Each hub test starts its own hub, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list, beside #25's
  and #303's. The implementer adds it. A full run on a correct hub should take a few minutes.
- Every test makes its folders under `/tmp/dh340a-*` (a Unix socket path must fit in 104 bytes on macOS), sets `HOME` to
  `<tmp>/h` for every process it starts, and never touches the real `~/.deepbuild`, `~/.claude` or `~/.codex`.
  `<tmp>/bin` is first on `PATH`, with stand-ins for `launchctl`, `systemctl` and `claude` and a `deep` that runs the
  built CLI.
- It stops only processes it started, by PID (`helpers.ts`, `cleanup`); the stand-in stops the process groups it
  started for hook entries. Nothing is killed by name or port. No network, no model, no real `claude` binary. No child
  inherits this process's `DEEP_*`, `GIT_*`, `XDG_*`, `CLAUDE*` settings or a billing key.
- With `--root` here, Vitest writes its cache to `node_modules/.vite/` in this folder; delete it before committing.
- deep-hook drops hooks when the machine is loaded past about 40; a failure seen at such a load should be re-run
  before it is believed. The base run (`BASE-FAILURE.txt`) was at a 1-minute load of 34.

## The surface under test

### Merged surfaces, used as their suites define them

- **The hub**: `deep hub run` with `HOME` the temp home, its ready line, the socket's line protocol, `events.read`.
  `DEEP_HUB_PLANT=<name>` selects a planted program; a name `plant.ts` doesn't list stops the hub at start, so a
  wrong-program test fails BLOCKED on the base, never passes. `DEEP_HUB_TEST_CONFIRM` stubs the OS confirmation.
  `DEEP_HUB_TEST_SORTER` (#321's planted sorter, `{"rule", "proceed": [questions]}`) answers a listed question at a
  Stop "proceed"; only `authority.test.ts` sets it. `inbox.read` lists the open asks by handle (`ask`).
- **The control token**: `<home>/.deepbuild/control.token`; a connection says `{"v":1,"hello":"app","token":…}` and
  is the app's (the `cli` hello reads the record).
- **`deep setup`** (#18): DeepBuild's entries in `~/.claude/settings.json`, among them the waiter, the entry with
  `asyncRewake: true`, written under Stop and under StopFailure with the same command and timeout (#25's Scope and
  the design's Waiter limit, amended Oct 29 for #85); any other count is BLOCKED. A base whose setup writes the waiter
  under Stop alone is BLOCKED there, before `sendNote`, so `BASE-FAILURE.txt` (run before the amendment) shows the
  failures past that step.
- **The Claude Code stand-in** (`fixtures/claude.mjs`, copied unchanged from `../../25/fallbacks/fixtures/`): one
  process per session, running the settings' entries as Claude Code does. An `asyncRewake` entry that exits 2 wakes
  the idle session with a UserPromptSubmit whose prompt is a task-notification carrying the entry's stderr (#80's
  terminal and desktop logs); a `skip: ['asyncRewake']` session runs no waiter; a hook's `additionalContext` is written
  into the transcript as a `hook_additional_context` attachment.
- **A prompt you typed**, the words "written into the session's terminal by a test process": a transcript entry with
  `turnOrigin: human` and `origin.kind: human`, then UserPromptSubmit with that prompt, as #303's and #25's suites type.
- **`user.ask@1`** in the record (`data.from`, `data.text`, `data.tasks`) and **`task.created@1`** (`task_ref`,
  `thread`), as #303 reads them; the session's thread is its `session.start`'s `data.thread`.
- **The contracts**: `getSchema`, `listSchemas`, `validate`, `registry`, `d1Digest` from
  `packages/contracts/src/index.ts`; `contractStep` and `serveAt` from `packages/conformance/src/index.ts`.

### New: `session.note`, the app's note into a session

Neither the issue nor the design names the socket method; the base has none. This suite names the smallest one,
shaped like `ask.answer`:

- **Method** `session.note`, served to an `app` connection, the role that holds the control token as the app does. (The
  CLI holds the token too; whether `cli` may call it is the implementer's call, and no test reads it.)
- **Params** `{ "session": "<the session's ID, as its hooks carry it>", "text": "<the note's words>", "request": "<the
  delivery's request ID>" }`. The request ID is the app's, one per delivery; these tests send a ULID-shaped string.
- **Result** an object whose `request` is the request ID sent. Anything else in it is free.
- The hub then delivers the note by the route the session's flags allow, as #25 delivers an answer: the waiter for an
  idle Claude Code session that has shown it, else the context of the next prompt.

### New: `user.ask@1`'s `data.request`, and `app` in `data.from`

- `app` joins `data.from`'s enum, which stays marked extensible with `unknown` (a minor of `user.ask@1`, the issue says).
- **`data.request`**: an optional string, the delivery's request ID, carried by the note's `user.ask` only. The name
  follows `action.entered@1`'s `request`, the record's other request ID; the design gives none. A typed prompt carries
  none. Since `data` is closed (`additionalProperties: false`), the schema must list it, as an optional field.

## The scenario

- **An idle session** (`helpers.ts`, `idleSession`): its Claude Code starts, you type a question (`What does the settings
  page show today?`, which opens no task under #303's rule), the agent answers, and it stops; the stop goes through.
  With its waiter, the test waits until Claude Code's waiter run is live, then 2 s more for it to reach the hub.
- **The note**: `Add a dark mode toggle to the settings page, named theme <tag>.`, which asks for changed behavior, and a
  fresh request ID.
- **The waiter's route** (`waiter.test.ts`): the app sends the note; within 30 s the session wakes with a prompt carrying
  the note's words (what the waiter printed); the agent answers and stops.
- **Prompt context's route** (`prompt.test.ts`): the session runs no waiter, so the note waits; you type `Is the settings
  page finished?`, and DeepBuild's reply to that UserPromptSubmit must carry the note's words; the agent answers and
  stops.
- **The typed copy**: after each route, the test types the note's exact words into the terminal, and the agent stops.
- **The terminal's words while the note waits** (`terminal.test.ts`): the note waits for a session with no waiter, and
  the test types the note's exact words, so the very prompt that carries the note as context has the same words.
- **An open authority ask** (`authority.test.ts`), raised by #321's gate as #321's AC1 raises it. The home is seeded
  as #321's suite seeds it: the shipped `crates/deep-hook/default-rules.json` as the first `rules.json`, and ask
  settings with no batch (authority 1 day) in `config.json`; the session works in a git repository with one commit.
  The hub runs with `DEEP_HUB_TEST_SORTER`, #321's planted sorter, answering `want me to push to main?` "proceed". You
  type `Fix the login bug in src/login.ts.`; the agent ends its turn on that question; the sorter's proceed continues
  the turn (a Stop block saying proceed); the agent's `git push origin main` is held at PreToolUse (not allowed) with
  an authority ask naming it. The agent stops; that stop is held for the open ask and goes through with no answer, so
  the session is idle. Each step before the note is a precondition, BLOCKED if it doesn't hold. Then the note
  `Yes, approve it, go ahead and push (<tag>).` goes by the waiter (the session wakes with it) or, in a session whose
  waiter is off, by prompt context at your next prompt, `Did the push go through?`. The agent's next stop is held for
  the open ask while the checks run.

## What the tests read

- **"Recorded as `user.ask` with `from: app` and its delivery's request ID"** (`expectAppNote`), within 30 s of the
  route's last hook: a `user.ask` of the session with `from: app` and `request` the request ID sent, whose `text`
  contains the note's words, passing `user.ask@1` (its top-level schema fields). No `user.ask` of the session with
  `from: person` contains the note's words (before the typed copy), and no other `user.ask` carries that request ID.
- **"Opens a task as a typed prompt would"** (`expectTask`): its `tasks` names one task, and a `task.created` with that
  `task_ref` is in the record under the session's thread. The typed copy, a prompt asking for the same change, opens
  one the same way (the control).
- **"Never recorded `app`"** (`typedCopy`): every `user.ask` of the session after the typing whose `text` is the words
  has a `from` other than `app` and no `request`. In `terminal.test.ts` also: every `user.ask` from `app` in the session
  carries the note's request ID, and there is at most one.
- **"A reader built against `user.ask`'s minor before `app`"**: `@deepbuild/conformance`'s `serveAt` with the base
  commit's `user.ask@1` (`fixtures/user.ask@1.base.json`, `git show fe593280:packages/contracts/schemas/user.ask@1.json`),
  applied to the note's recorded event: its `data.from` reads `unknown`, and the served value passes the base schema
  (through the contracts' `registry`). The control: served at the current schema, it reads `app`.
- **"`app` joins `from`'s extensible set as a minor of `user.ask`, so #303's and #311's schemas on the verdict spine
  stay as they are"** (Scope): `contractStep` from the base's `user.ask@1` to the current one names no change; no
  `user.ask@2` is published; the d1 digests of `task.created@1`, `definition.locked@1`, `definition.locked@2`,
  `claim.made@3`, `agent.stop@4`, `verdict@1`, `verdict.made@1` and `verdict.outcome@1` equal the base's
  (`fixtures/spine-digests.base.json`, copied from the base's `packages/contracts/digests.json`).
- **"Never answers an authority ask or saves a decision"** (`authority.test.ts`, `expectStillOpen`), 5 s after the
  note's `user.ask` is in the record: no `ask.answered`, `ask.defaulted`, `ask.escalated`, `ask.cancelled`,
  `ask.superseded` or `ask.moot` whose subject or data names the push's ask; no `decision.created` or
  `decision.applied` anywhere in the record (nothing else in the scenario saves one); and `inbox.read` still lists the
  ask, its row (the asks core's `InboxRow`) with any `status` but `closed` and `outcome` `unanswered`, which the base's
  contract says an open ask reads (redrafted on a dispute: no inbox status is `open`). The note is still recorded as above
  (`expectAppNote`).
- **"The held call stays held"** is read as that ask staying open and in the inbox. The push isn't sent again: after
  the turn ends, a push is outside the proceed's turn, where #321 holds nothing, so a retry there would assert what
  #321 doesn't state.

## Wrong programs

Each is code the implementer adds to `packages/hub/src/plant.ts` (the `Plant` type and `PLANTS`), selected with
`DEEP_HUB_PLANT=<name>`. The tests pass the variable to the hub, `deep setup` and the stand-in (so every hook and the
waiter run under it). `failureOf` rethrows BLOCKED, so a hub that won't start with the plant never counts as its
failure.

| Name | What the plant does | Test | How the test fails on it |
|---|---|---|---|
| `app-note-unrecorded` | delivers a note by the waiter as the correct hub does (the waiter exits 2 with the note's words and the session wakes), and records nothing for it: no `user.ask` and no task. Other routes as the correct hub. | `waiter.test.ts` (2) | at the recording assertion: `AC6 #340.b3c2bc3d the app's note "<words>" (request <ID>), delivered by the waiter to the idle Claude Code session, must be recorded as user.ask with from: app and request <ID> …`; the test requires the words and the request ID in it |
| `app-note-as-person` | delivers a note by every route as the correct hub does, and records the app's words as `from: person` with no `request` | `prompt.test.ts` (3) | at the same assertion on prompt context's route (no `user.ask` from `app` with the request ID), or at `the app's words "<words>" (request <ID>) must never be recorded from: person`; the test requires the words and the request ID |
| `app-note-answers-authority` | delivers and records a note as the correct hub does (`from: app`, its request ID), and then, when the session has an open authority ask and the note's words say yes (they contain `yes`, `approve` or `go ahead`, any case), answers that ask with its option whose `decision` is `allow`, as an answer on the trusted path would: the asks core records `ask.answered` (and any decision the core saves for it) | `authority.test.ts` (3), on prompt context's route | at `the app's note "<words>" (request <ID>) must never answer the authority ask ask:<id> …`; the test requires the request ID and an ask handle in the message |

## Criterion clauses to tests

The ID is `#340.b3c2bc3d`: the first 8 hex of the SHA-256 of AC6's text (the text after `AC6: `, trimmed, white space
collapsed), as `scripts/proof-change.mjs` computes it. Every test name and failure message starts with it.

| Clause of AC6 | Test | On the base |
|---|---|---|
| a note sent over the hub's socket with the control token, as the app sends one | every hub test (`sendNote`) | FAIL: `session.note … must be taken, not refused; the hub replied {"error":{"code":"unknown_method",…}}` |
| that asks for changed behavior is recorded as `user.ask` with `from: app` and its delivery's request ID, when the waiter delivered it to an idle Claude Code session | `waiter.test.ts` (1) | FAIL at `sendNote` (above) |
| … or prompt context carried it at the next prompt | `prompt.test.ts` (1) | FAIL at `sendNote` |
| and opens a task as a typed prompt would | `waiter.test.ts` (1), `prompt.test.ts` (1), `expectTask` | FAIL at `sendNote` |
| the same words written into the session's terminal by a test process are never recorded `app` | `waiter.test.ts` (1), `prompt.test.ts` (1) after delivery; `terminal.test.ts` while the note waits | FAIL at `sendNote`; the typed-copy check alone passes on the base (it records `person`), as it should |
| a reader built against `user.ask`'s minor before `app` reads the note's `from` as `unknown` | `prompt.test.ts` (2) | FAIL: `the record must hold the note's user.ask from: app …` |
| (Scope) `app` joins `from` as a minor; #303's and #311's spine schemas stay as they are | `contract.test.ts` (1–3) | (1) FAIL: `user.ask@1's from must list app`; (2) and (3) pass on the base, as guards should |
| an adapter that records a waiter-delivered note as nothing fails this test, naming the message | `waiter.test.ts` (2), `app-note-unrecorded` | BLOCKED: the base has no such plant |
| or marks the app's words `person` with no request ID | `prompt.test.ts` (3), `app-note-as-person` | BLOCKED: the base has no such plant |
| (Scope) an `app` prompt, like any text in a session, never answers an authority ask or saves a decision; the note is still recorded `from: app` with its request ID | `authority.test.ts` (1) by the waiter, (2) by prompt context | FAIL at `sendNote` (`unknown_method`), after #321's gate held the push with an authority ask on the base |
| a hub whose note answers the open authority ask fails, naming the ask | `authority.test.ts` (3), `app-note-answers-authority` | BLOCKED: the base has no such plant |

The harness's other steps were checked on the base with a throwaway probe (deleted): the idle session with its live
waiter, the typed copy recorded `person` with no request and opening a task under the session's thread, and, on a
planted twin of `user.ask@1` (app and an optional `request` added), `contractStep` finding no change, a required
`request` found as a break, and `serveAt` at the base reading `unknown` and dropping `request`.

## Not covered by AC6, and open questions

- **An `app` note never answers an authority ask or saves a decision** is now covered by `authority.test.ts` (above),
  for one authority ask: #321's hold of a push in a proceed's turn. Other authority asks (an MCP tool update's, #23's
  dependency and cloud-resource asks, a permission prompt's) are not exercised. Not tested either: "it can close a
  question that needs no authority, recorded as answered from the app", and "its card shows the words beside it".
- **The `user.ask`'s `text`.** The tests require only that it contains the note's words; whether it is the words alone
  or the wake's whole prompt is the implementer's.
- **The wake's own prompt.** On the waiter's route the wake's task-notification is a prompt too. The tests forbid only a
  `person` record of the note's words and a second record of the request ID; whether the wake's prompt is also
  recorded (say as `unknown` or `continuation`) beside the note's `user.ask` is left open.
- **The context label** ("labelled as yours, sent from the app") has no wording in the design, so none is asserted; the
  tests require only the note's words in DeepBuild's reply on prompt context's route.
- **The note's delivery outcome** (`delivery.outcome@1` names a `delivery`, `ask:<id>` for answers today): whether a
  note's delivery is recorded there, and under what handle, is not read.
- **Other routes**: a running turn's PostToolUse context, the stop hold, Codex, R2's steers and follow-ups, a card's
  words and a start's first prompt are not exercised; AC6 names the waiter and prompt context.
- **While the note waits and the same words are typed** (`terminal.test.ts`), the tests don't require the note itself
  to be recorded in that turn, only that your typed words aren't the app's and the request ID marks nothing else.
- **A note to a session the hub doesn't know**, or from a role without the control token, is not asserted.
- **Open**: the method's name, `session.note`, and the field's, `data.request`, are this suite's choices (New, above).
  If the implementer's design review picks others, that is a dispute for a blind redraft, not an edit here.

## Files

- `helpers.ts`: temp homes, the hub as a process, `app` and `cli` connections with the control token, `events.read`,
  sessions and transcripts, the stand-in, `deep setup`, `idleSession`, `sendNote`, the record readers
  (`expectAppNote`, `expectTask`, `typedCopy`), `failureOf`, `namesTheMessage`, and the plant names.
- `waiter.test.ts`, `prompt.test.ts`, `terminal.test.ts`: the hub tests; `contract.test.ts`: the schema step.
- `authority.test.ts`: the note with an open authority ask; it keeps its own world (the seeded guards and ask
  settings, the git repository, the sorter) and uses `helpers.ts` unchanged.
- `fixtures/claude.mjs`, `fixtures/stub-bin.sh`: copied from `../../25/fallbacks/fixtures/`.
- `fixtures/user.ask@1.base.json`: the base commit's `user.ask@1`, the earlier minor.
- `fixtures/spine-digests.base.json`: the base's d1 digests of the spine schemas.
- `tsconfig.json`: the root's strict options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base, trimmed to each test's failing assertion.
