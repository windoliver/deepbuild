# Acceptance tests for #1894: an agent's transcript reader belongs to its adapter

Written first, blind, from issue #1894 (its text as the job's brief quoted it: the problem, Scope, the four acceptance
criteria and Proof), the surface the user decided for it, `docs/technical-design.md`'s rules as AGENTS.md states them,
and the base commit `e87cefc44` (`origin/main`). The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft by this job.

## What this job read

- issue #1894 and the decided surface, as the brief quoted them.
- `AGENTS.md`; `tests/acceptance/1515` (shape, README, BASE-FAILURE, a base-only golden writer); `tests/acceptance/111`
  (the pi and Cursor transcript shapes), `tests/acceptance/352` (Codex rollout lines).
- `packages/record/src/index.ts` (`openRecord`, `openRecordReader`, `RecordStore.resolve`/`transcript`/`table`),
  `packages/record/src/learned.ts` (the base's transcript parse, to know which lines the four formats hold and which
  fixtures reach each branch), `packages/record/src/projections.ts` (the `learned_layer` columns),
  `packages/record/test/learned.test.ts` (how a session is archived and a learned change appended and judged),
  `packages/adapters/src/index.ts` (the public entry), `packages/contracts/schemas` (`session.start@1`,
  `transcript.archived@1`).

## The surface the tests use

From `packages/record/src/index.ts`: `Turn`, `TranscriptReader` (types only), `openRecord(options)` and
`openRecordReader(options)` with `readers?: readonly TranscriptReader[]`. From `packages/adapters/src/index.ts`:
`transcriptReaders`. A turn's `id` is the message part of `session:<id>#<turn id>`.

## Run

```sh
npx vitest run --root tests/acceptance/1894 --reporter=verbose
npx tsc -p tests/acceptance/1894         # type-check the tests; at the base it fails on the three missing exports
```

No hub, no build: the tests import the record, the evidence store and the adapters from their sources. About 10 s,
most of it the 33 MiB Codex rollout of AC3.

## Criteria to tests

| Criterion | Test | What it checks |
|---|---|---|
| 1 | `names.test.ts` › no file under packages/record/src names an agent or imports an adapter | the scan of every file under `packages/record/src` finds nothing |
| 1 | `names.test.ts` › the scan fails on a copy of the sources with … planted (10 cases) | the same scan, over a temp copy of `packages/record/src` with one line appended to `learned.ts`, finds that line: each agent name, `claude-code`, an identifier (`codexCommand`), an `@deepbuild/adapters` import, a relative path into `adapters/src`, a dynamic import |
| 1 | `names.test.ts` › ordinary words that look like agent names are not findings | `cursor`, `readCursor`, `Math.PI`, `pipeline`, `api`, `epic`, `codec`, `precursor`, `./adapter-facts.js` give no finding |
| 2 | `format.test.ts` › a learned change quoting a turn of the new format is in force; one quoting words the turn lacks is refused | see "The test adapter" |
| 2 | `format.test.ts` › the record and its reader resolve the new format's handles and give its turns, a reader started for each transcript | `record.resolve`, `record.transcript`, `openRecordReader(...).resolve`/`.transcript` give the turns |
| 2 | `format.test.ts` › for each line the first reader that returns a turn names it | readers `[silent, tallowmere, greedy]` |
| 2 | `format.test.ts` › with no readers the record reads no turn of the new format | the same transcript, `readers: []` |
| 2 | `format.test.ts` › nothing under packages/record names the new format | no file under `packages/record` (outside `node_modules`) holds `tallowmere` |
| 3 | `rows.test.ts` › with the shipped agents' readers, the record gives the base's learned rows, resolved handles and session transcripts | `runScenario(transcriptReaders)` against `fixtures/learned-rows.json` |
| 3 | `rows.test.ts` › the golden holds every shipped format, with rows both in force and refused | a guard on the golden itself |
| 4 | none | the implementer runs the suites of the touched files and each package's type-check (brief) |

### Criterion 1: the patterns

`helpers.ts` `AGENT_WORDS`. Each name matches with no letter before it and no lower-case letter after it, so it also
catches an identifier part (`codexCommand`, `ClaudeCode`, `CLAUDE_`), and is case-sensitive in the forms below so
ordinary words don't match:

- `Claude`, `claude`, `CLAUDE` (covers "Claude Code", `claude-code`, `claude_code`); `Codex`, `codex`, `CODEX`;
  `Gemini`, `gemini`, `GEMINI`; `OpenCode`, `opencode`, `Opencode`, `openCode`, `OPENCODE`. None of these is an
  English word, so any case is safe.
- `pi` / `Pi`, as a whole word with no letter, digit, `_`, `$` or `.` around it: `Math.PI`, `pi2`, `api`, `epic`,
  `pipeline` don't match; `pi's`, `pi,`, `'pi'` do.
- `Cursor` / `CURSOR` only capitalised, plus `cursor-agent`, `cursor_cli` and `.cursor`: the record pages the log with
  a lower-case `cursor` (`readSince`), which is an ordinary word there. A sentence starting with the word "Cursor"
  would be a finding; reword it.

An adapter import is a module specifier (`from '…'`, `import '…'`, `import('…')`, `require('…')`) that is
`@deepbuild/adapters` or under it, holds `packages/adapters`, or is a relative `../…/adapters` path.

At the base the scan finds `learned.ts` (Claude Code, Codex, pi, Cursor, `codexCommand`, `codexFailed`) and
`replay.ts:83`, whose `MAKERS` maps model IDs starting `claude`, `codex` and `gemini` to their makers. The issue's
criterion is "names no agent", and Claude, Codex and Gemini are agents' names, so that line is a finding too.

## The test adapter (criterion 2)

`format.test.ts` defines a made-up agent, `tallowmere`, whose transcript is JSON lines with a `tm` kind:
`{"tm":"say","no":"t1","who":"person","words":…}` (yours when `who` is `person`, else the agent's),
`{"tm":"call","no":"t3","tool":"disk","words":…}`, `{"tm":"result","no":"t4","for":"t3","words":…,"bad":false}`, and a
`head` line it passes over. A line with no `no` is named by its line number, `n<line>`. Its reader keeps the calls it
has seen in the state `start()` makes, so a result's `tool` and `of` come from its own transcript; a disk read's result
is first-hand, any other tool's is outside content.

Two sessions are archived in that format through `openEvidenceStore` and `transcript.archived@1`, the record opened
with `readers: [tallowmere]`, and learned changes appended as `learn.applied` (the core, `rule:localfirst`, for a
`slice:` claim; you, through the app, for a `rule:`):

- quoting `closes at midnight` from your turn `t1`: in force, no reason; the same from the line-numbered turn `n5`, a
  rule you typed quoting `t1`, and a claim quoting the disk read's result `t4`: in force.
- quoting `closes at noon` at `t1`: refused, the reason naming `session:<S>#t1`.
- quoting the agent's turn `t2`: refused (rests only on outside content).
- `transcript(S)` is exactly the five turns in order, with `tool`, `of` and `error` on the result; the second session,
  whose only line is a result `for: "t3"`, resolves with `tool: ""` and `outside: true`: its reader was started for
  that transcript, not shared with the first.

## The golden (criterion 3)

`fixtures/learned-rows.json` is the merge base's output, not hand-written. It was made on November 27, 2026 at
`e87cefc44b8dc017c6a642ef8f5f8b7e141a81b4` with nothing changed under `packages/`:

```sh
DH1894_GOLDEN=write npx vitest run --root tests/acceptance/1894 golden.test.ts
```

`golden.test.ts` refuses to write unless `HEAD` is the base and `git status -- packages` is clean; every other run
skips it. At the base the record parses transcripts itself and ignores `readers`, so `runScenario(undefined)` there is
the base's answer. The implementer never runs it (AGENTS.md: never re-record goldens).

`runScenario` (`helpers.ts`) builds one record over a real evidence store with five archived sessions, in the shapes
the record's suites and the acceptance suites use, chosen to reach every branch of the base's parse:

| Session | Agent | Lines that matter |
|---|---|---|
| `claude-code` | `claude-code` | your messages (string and text blocks); the agent's text and `tool_use`; WebFetch, Grep, Read and Bash results (Bash with `is_error` and `of`); a result whose call isn't in the transcript; a compaction summary, a sidechain and a meta entry; a `summary` line with no `uuid` |
| `codex` | `codex` | `session_meta`; user messages with no ID (named `l<line>`); an assistant message `msg_cx01` (named `cx01`); `shell` and `exec_command` function calls and their outputs (exit 1, exit 0 metadata); `apply_patch` and an `exec` script as custom tool calls; a `web_search` call; an output whose call isn't there; an `event_msg`; a developer message |
| `pi` | `pi` | the `session` line; user, assistant and `toolResult` messages; a `model_change` entry |
| `cursor` | `cursor` | role lines named by line number, with a torn (non-JSON) line 3 between them |
| `codex-large` | `codex` | a 33.6 MiB rollout (4,400 filler `event_msg` lines), past the record's 32 MiB bound, so it is read in pieces: a call at line 2 and its output at line 4,403, and a user message at line 4,404 |

Then 43 `slice:` changes and one `wiki:` change citing those handles (each quote either in the turn or not, from
first-hand and outside turns), and two `rule:` changes. The golden holds:

- `learned_layer`: every row of `record.table('learned_layer')` in log order, each `JSON.stringify` of the row as the
  record returns it (column order; bigints as `<n>n`). Compared byte for byte.
- `resolved`: `record.resolve` of each listed handle, including ones the base names nothing at (`l0`, `msg_cx01`,
  `call_p1`, `pi-4`, `l3`, `nope`), and `transcripts`: `record.transcript(session)`; the large session's as the
  SHA-256 of its turns and their count. These are compared as canonical JSON (keys sorted, `undefined` dropped), so the
  order a reader builds a turn's keys in is not a difference; every value is.
- `reader`: the same through `openRecordReader({ path, evidence, readers })` after the writer closed.

Note what the base does with the large rollout: `call_big.out` has `tool: "shell"` but no `of`, because the base
parses each piece apart and the call is in an earlier piece. The golden keeps that, as criterion 3 asks.

## Wrong programs each test catches

- **Agent names left in, renamed only in comments, or moved into a record-internal file**: the AC1 scan (every file
  under `src`, identifiers included). **The record importing the adapters to get the readers**: the AC1 import check.
- **`readers` ignored** (the base): AC2 fails (`t1`'s quote refused, `resolve` undefined); AC3 fails (with no parse of
  its own, every quoted change is refused and no handle resolves).
- **Readers that return nothing**, or a record that drops the turns: AC2 and AC3 fail the same way.
- **The reader's `outside` ignored or inverted**: AC2's claim on the agent's turn `t2` would go in, or the one on
  `t1` be refused; AC3's rows change state.
- **The line number passed wrong** (1-based, per piece, or skipping torn lines): AC2's `n5`, AC3's Cursor `l4` and the
  large rollout's `l4404` and `call_big` handles.
- **One `start()` shared by every transcript**: AC2's second session would read `t3` as a disk call.
- **The last reader, not the first, naming a line**, or a reader that returns undefined stopping the search: AC2's
  `[silent, tallowmere, greedy]` test.
- **`openRecordReader` not passing its readers**: AC2's and AC3's reader checks.
- **A shipped reader that differs from the base's parse** (a role, `outside`, `tool`, `of`, `error`, an ID, text joined
  differently, an entry the base skips): AC3's resolved handles, transcripts and rows.

## Not tested here

- Criterion 4 (the suites of touched files and each package's type-check): the implementer's run, per the brief.
- The hub's transcript reader moving to the adapters (Scope's second line) has no criterion of its own; AC1 covers
  only `packages/record/src`.
