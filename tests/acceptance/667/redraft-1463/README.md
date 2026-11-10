# Blind redraft of #667 AC1 and AC2: the ask raised and answered in the terminal, in the design's `deep inbox` layout

Written blind at base `32628dba` (Merge pull request #2095) from issue #667 (body last edited 2026-10-22T17:11:09Z:
its summary, Scope, five criteria, Proof and Depends on), `docs/technical-design.md` and the base, by a fresh run of
the blind acceptance-test job (AGENTS.md, Proof; design, Dogfooding) for two criteria. It never saw an implementation,
a plan, a session or the dispute. It edits no file outside this folder; the earlier #667 suite (`../`) is an input it
imports from and doesn't change.

## The criteria

- AC1 `#667.84442921`: "`deep inbox` lists the choice ask with its kind, session and age within a second of its
  append, and the stream consumer gets its frame at the same log position"
- AC2 `#667.b25a1d05`: "`deep inbox answer` on the choice ask saves a decision with its scope, the ask leaves `deep
  inbox`, the stream shows it answered, and the test process that raised it gets the answer once"

### Criterion IDs

The two IDs above are the ones this job was given, and the ones `../helpers.ts` and `../README.md` use. They don't
match the issue's text: `criterionId` in `scripts/proof-change.mjs` (SHA-256 of the text after `- [ ] `, trimmed,
white space collapsed) gives `#667.254d6157` for AC1 and `#667.8700acae` for AC2 from the body as `gh` serves it today,
and the issue's edit history holds no other wording (its one edit, 2026-10-22T17:11:09Z, has the same five lines).
Each test name starts with the given ID and names the computed one beside it, so either finds it.

## What was read

- AGENTS.md; issue #667 (`gh issue view 667`, and its body and edit history through `gh api`).
- `docs/technical-design.md`: An ask, and your answer getting back; States people see (the one row shape, and "`deep
  inbox` puts the question first and the handle last ... `--json` on `deep status` and `deep inbox` prints the rows");
  the Extension API's live stream (frames by `log_pos`, every read returns the `log_pos` it reflects); One event log;
  Where they reach you; Dogfooding.
- At the base: `packages/hub/src/inbox.ts` (`deep inbox` prints `ask:<ULID>  kind  session  age  status  question`, and
  refuses any flag), `packages/hub/src/promises.ts` (`elapsed`), `packages/asks/src/index.ts` (`scopeOf`, the card's
  `saves`), `packages/hub/src/core.ts` (`askCard`), `scripts/proof-change.mjs`; the earlier suite's README,
  `helpers.ts`, `raised.test.ts`, `fixtures/agent.mjs` and `BASE-FAILURE.txt`; `tests/acceptance/1459/README.md` and
  `tests/acceptance/34/redraft-1579/` for the layout.

## How to run

Node 24.22 first on `PATH`, macOS, from the checkout's root:

```sh
npm ci && npm run build --workspaces          # once: the tests run the built CLI, packages/cli/dist/main.js, and the hub it starts
npx vitest run tests/acceptance/667/redraft-1463
npx tsc -p tests/acceptance/667/redraft-1463  # type-check
```

Two tests on one world, no model and no network. The world is `../helpers.ts`'s: a real `deep hub run` under a fresh
`/tmp/dh667-*` home, its OS confirmation stubbed by `DEEP_HUB_TEST_CONFIRM` (`confirmed`), so no test raises a real
Touch ID prompt, and nothing touches your `~/.deepbuild`; every process the tests started is stopped by PID
(`cleanup`). The unit lane already runs `tests/acceptance/667/` alone (`scripts/lanes.mjs`), which covers this folder.
Each run prints its proof at the end (`Proof`): every `deep inbox` output, `deep inbox --json`, the stream's frames
with their log positions, and the record's ask, answer and decision rows.

## The surface, and what the implementation must provide

Merged surfaces, used as `../helpers.ts` uses them: `deep hub run` with `DEEP_HUB_TEST_CONFIRM`; `~/.deepbuild/config.json`'s
`asks` block (choice `4h`, the fold at 5, no batch); the agent stand-in (`fixtures/agent.mjs`), its hooks and its own
`deep mcp` with `deep_ask` and `deep_wait`; the socket as `cli` with `events.read`, `inbox.read` (only its `log_pos`)
and `stream.subscribe`.

What the implementation must provide:

1. **`deep inbox` puts the question first and the handle last.** One line per open ask. After any glyph or mark that
   leads the line (anything but a letter or digit), the line starts with the ask's question; its last field is the
   handle, `ask:<ULID>`, or the item's link `deepbuild://ask/<ULID>` directly after the handle.
2. **Between them, the ask's kind, its session and its age.** For a choice ask the line holds the word `choice` (any
   case) outside the question; the session by its ID, whole or from its first 8 letters and digits, with or without its
   dashes; and its age, floored, from the ask's append to when the command ran, as a count and a unit (`0s`, `12s`,
   `3m`, `2h`, `1d`, `5 seconds ago`) or `just now`.
3. **`deep inbox --json` prints the rows and exits 0.** As JSON: an array of rows, an object holding it (under `rows`,
   `asks` or `items`, or as its one array of rows), or one row object per line. The ask's row has `id` its handle
   (the bare ULID is accepted too); a `kind` field, if it has one, is `choice`, and some string in the row other than
   `id` and the question says `choice`; some string in it holds the session's ID; and `since` is the ask's append
   time, as epoch milliseconds, epoch seconds or ISO 8601, within a second of its `ask.created`'s `ts`.
4. **A closed ask leaves both.** Neither `deep inbox` nor `deep inbox --json` prints an answered ask's ULID.
5. **`deep inbox answer <handle> <option>` answers by handle as before.** Exit 0 once the OS confirms you; one
   `ask.answered` with the option as `data.answer`; one `decision.created` with `data.ask` the handle, `data.answer`
   the option and `data.scope` the ask's scope: `repo:<project, letters and digits>` when the ask's `ask.created` or its
   session's `session.start` names a project, else `session:<the session's letters and digits>`. A second answer to
   the closed ask exits non-zero and is recorded as one `answer.refused` naming the handle (its `subject` or
   `data.ask`); `deep_wait` still returns the first answer.
6. **The stream frames every step.** The `ask.created` and the `ask.answered` are framed at the `log_pos` the record
   holds them at, within 5 s, and every `ask.*`, `answer.*` and `decision.*` event after the subscription is framed
   once, as the record holds it (`../helpers.ts`, `expectFramed` and `expectStreamMatchesRecord`).

## The fixture

`../helpers.ts`'s settings and agent stand-in, as they are. The agent's session is a fresh UUID; it raises one choice
ask through `deep_ask`: "Keep the orders on SQLite or plain files?", options `sqlite` (SQLite, recommended) and `files`
(Plain files). The question holds no word `choice`, so the kind can't be read off the question. You answer `files`,
then `sqlite`.

## Criterion to tests

All in `raised.test.ts`, on one world.

| Criterion | Test | What counts as failure |
|---|---|---|
| AC1 `#667.84442921` | `deep inbox` lists the choice ask with its kind, session and age within a second of its append, and the stream consumer gets its frame at the same log position | the ask's `ask.created` isn't a choice with a 4-hour deadline and the default `sqlite`; a `deep inbox` run started a second or more after the append doesn't list it; the line starts with anything but the question, or ends with anything but the handle (or its link); the line has no `choice`, no session ID or an age that isn't the time since the append; `deep inbox --json` fails, prints no rows, or the ask's row lacks the kind, the session or a `since` at its append; no frame at the record's `log_pos` for the `ask.created`. A first listing that started in time but ended over a second after the append is INCONCLUSIVE (skipped with the reading and the load), never PASS |
| AC2 `#667.b25a1d05` | `deep inbox answer` on the choice ask saves a decision with its scope, the ask leaves `deep inbox`, the stream shows it answered, and the test process that raised it gets the answer once | the answer exits non-zero; no `ask.answered` `files`, or more than one; no decision, or one at another scope; the ask still in `deep inbox` or `deep inbox --json`, or `--json` failing; no frame for the answer at its `log_pos`; the agent's `deep_ask` doesn't return `files`; a second answer counts, isn't recorded as refused, or reaches the agent; a step the stream frames differently from the record, or not at all |

On the base, by reading the code (not run): AC1 fails at "puts the question first", since the base line starts with the
handle; AC2 fails at "`deep inbox --json` exits 0", since the base refuses any flag with its usage and exit 2. Every
other step these tests check is one the earlier suite checked in `#24`'s layout. Not run: neither test ran here, on the
base or on any implementation, so both outcomes are unverified, and `npx tsc` wasn't run either (the worktree has no
`node_modules`).

## Scope not covered

AC3 to AC5 stay with `../`. Not tested here, as no criterion names them: the row fields beyond `id`, `since`, a kind
and a session (`address`, `title`, `entry`, `word`, `why`, `waits_on`, `actions`); `deep status`; the link beside each
item; what `deep inbox answer` prints; the card's words for what an answer will be saved as; the "decided for you"
lines and the offers.

## Readings and assumptions a redraft may revisit

1. **The design's layout wins.** The issue names `deep inbox` and #24's layout put the handle first; the design now
   says the question first and the handle last, and the rows as `--json`. The tests read the text for the layout and
   the person's view, and `--json` for the row.
2. **One line per ask.** The design keeps a call on one line and puts the question and the handle on the ask's line,
   so the kind, session and age are read from that line.
3. **The kind in words.** The design says what a person reads holds no internal kind name. The criterion asks for the
   kind, and a choice ask's kind in plain words is "choice", the design's own word for one ("a choice between
   options"), so the line must hold it. A dotted event kind or a code such as `needs_you` would be an internal name;
   the tests don't look for those.
4. **The session by its ID.** The issue's session is the one the stand-in's hooks established; the tests take its ID,
   as the hub records it, as the way both the line and the row name it. A short form keeps its first 8 letters and
   digits.
5. **`since` is a time, not an age.** The row's `since` is when the ask began waiting, its append; the line's age is
   the time since then.
6. **"At the same log position."** The frame's `log_pos` is the record's for the `ask.created`, read through
   `events.read`; the stream subscribed after an `inbox.read` whose `log_pos` is before the append, so it must frame
   it. Only `inbox.read`'s `log_pos` is used, not its rows, so a change to that read's row shape doesn't touch these
   tests.
7. **"Within a second"** as the earlier suite reads it: every run started a second after the append must list it
   (FAIL), and the first listing must end within 1,000 ms of the append, else INCONCLUSIVE.
8. **"A decision with its scope"** is the ask's scope as the asks core saves one from your inbox answer: the session's
   repo, else the session. **"Gets the answer once"** is the agent's waiting `deep_ask` returning `files`, and a second
   answer refused, recorded as `answer.refused` (design: "a later answer to a closed ask is refused ... and recorded as
   `answer.refused`; nothing reaches the agent"), with `deep_wait` still returning `files`.
9. **The stream's own match against the record** comes from the issue's summary ("every step shows the same on the
   stream"), as the earlier suite checks it.
