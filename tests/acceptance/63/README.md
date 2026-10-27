# Acceptance tests for #63: read by reference, a slice at a time, through handles

Written first, blind, by a job that never saw an implementation of #63 (none existed). On October 26, 2026 it read:

- issue #63: its Scope, its 10 checkbox criteria (AC1 to AC10 in the body's order), its Proof and what it depends on
  (#14 record, #15 evidence store, #159 runner, #20 transcript archive)
- `docs/technical-design.md`: Reading by reference (handles, `deep find`, `deep read <handle> --slice`, the 8,192
  character cap, sub-reads on a smaller model, answers that cite handles, the quote rule, plan usage and "212 sessions
  are read with 38 sub-reads, about 4% of one 5-hour window"); Hooks are evidence, not a state machine (DeepBuild's
  own jobs); Evidence and Privacy (redaction before hashing, archived transcripts kept); The learned layer (outside
  content: a fetch's, a search's or an MCP call's result; any other tool's result reads as first-hand); Every task
  carries its own budgets and The reference Macs; Criteria in a checked shape; Dogfooding
- `AGENTS.md`
- the suites of the issues it builds on, for conventions: `tests/acceptance/20` (README shape, criterion IDs, wrong
  programs, budgets against the merge base, BASE-FAILURE), `159` (the runner, its fake `claude`, plan windows), `355`
  (the wiki's pages and claim lines), `14`, `15`
- the public entries it builds on: `record` (`openRecord`, `resolve`, `parseClaimLine`, the `sessions` projection's
  `transcript` column), `evidence` (`openEvidenceStore`, `scrubText`), `archive` (`openArchive`, `transcript.archived`),
  `runner` (`openRunner`, `JobSpec.mcp`, `report`, `list`, `output`), `wiki` (`openWiki`, `learn`, `Known`), `budget`,
  `supervisor`, `asks`, `adapters` (`shipped`, `claude-code.facts.json`: `launch.readOnlyJob`, `modelFamily`),
  `packages/cli/src/main.ts`, `scripts/benchmark.mjs` with `benchmarks/budgets.json`
- the base commit `b7bccf9` (origin/main)

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

On macOS (the runner's jobs run in Seatbelt through the supervisor), with the repo's Node (24.22.0):

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the tests run deep find / deep read from packages/cli/dist
node node_modules/vitest/vitest.mjs run --root tests/acceptance/63 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/63/tsconfig.json   # needs the surface below
```

- **`--no-file-parallelism`:** the files run sandboxed jobs, and the budget must run with nothing beside it.
- **Nothing real is called.** Every `claude` is the fake in `fixtures/fake-reader.pl` (The fake agent, below),
  installed by the test as a file named `claude` on the login PATH the runner is given. No network, no sign-in, no
  model call, no keychain read.
- **The environment:** `helpers.ts` removes `CLAUDE*`, `CODEX*`, `DEEP_*`, `ANTHROPIC_*` and `AI_AGENT` and points
  `HOME` at a temp folder holding a fake Claude Code sign-in (made-up values). Agents' transcripts are written under a
  separate temp home, which only the archive is told about. `deep` runs with `HOME` a fresh empty folder each time.
- **Temp folders:** everything is under `/tmp/dh63-*` (real paths), removed after its file. Processes are stopped by
  PID only: those running a program from a folder this test process made. Never by name or port.
- **Clock:** real time (the runner's processes and graces are real), readable by the record, the wiki and the runner
  only through `now`.

## The surface under test

The issue names `deep find`, `deep read <handle> --slice`, handles, reading jobs, the runner and a structured answer,
but no code API. This job defines the smallest surface that reaches every criterion. Names marked *invented* are
this job's.

### 1. `deep read` and `deep find` (the CLI, read-only over the record)

```
deep read <handle> [--slice [<cursor>]] [--json] [--root <folder>]
deep find <query>  [--slice [<cursor>]] [--json] [--root <folder>]
```

- **`--root`** is the hub's root (default `~/.deepbuild`): the record at `<root>/ledger.db`, its evidence store at
  `<root>/evidence`, the wiki at `<root>/wiki`. Both commands work with no hub running, append nothing to the record
  and read no file outside the root (AC3 runs them with `HOME` an empty folder).
- **Handles:** `session:<id>` (the agent's session ID, letters and digits only, as the hub's handles hold it),
  `session:<id>#<message>` (the transcript entry's `uuid`, so `#m900` is message 900 here), `ev:<sha256>`,
  `wiki:<page>#<claim>`. A `session:` handle resolves through the record: the newest `transcript.archived` event
  naming the session links the evidence holding its redacted copy (as `record.resolve` already does for a message).
  A handle that names nothing exits non-zero, prints no slice on stdout and names the handle on stderr.
- **`--slice`** with no cursor is the first slice; `--slice <cursor>` continues where a cut reply said. A cursor is
  opaque and never starts with `-`.
- **The cap:** a slice's text holds at most 8,192 characters by default. A plain reply is the slice's text, then,
  when it was cut, one last line containing `deep read <handle> --slice <cursor>` (the text before that line is at
  most 8,192 characters). A slice of a message handle is that message's redacted text; slices of a handle, joined
  in order, are all of it.
- **`--json`** prints one `reading.slice@1` object (*invented*; a published schema in `packages/contracts`):

```ts
interface SliceJson {
  handle: string;          // as asked
  covers: string;          // which part of its source the slice covers, in words
  text: string;            // at most 8,192 characters
  next?: string;           // the cursor that continues it; absent when nothing is left
  // for a session handle: each message the slice holds, in order, where its text sits in `text`
  messages?: { at: string; role: string; outside: boolean; tool?: string; start: number; end: number }[];
}
```

  `role` is the transcript entry's role; `tool` the tool whose result the message holds (`WebFetch`, `Bash`, …);
  `outside` whether it is outside content. `start`/`end` index `text` as JavaScript does (UTF-16 code units; the
  fixtures hold BMP characters only). `deep find --json` prints `{ hits: { handle: string; context: string }[];
  next?: string }`, capped the same way.

### 2. The reading tools inside a job

A reading job's runner spec gets the reading tools as a stdio MCP server in `JobSpec.mcp` (the only servers it
gets), whose `tools/list` has `read` (`{ handle: string; slice?: string }`) and `find` (`{ query: string; slice?:
string }`). Each call's result is one text content holding the same JSON as `--json`. How that server reaches the
record from inside the job's sandbox is the implementer's (the job can't reach `hub.sock`, #159 AC19). Claude Code
runs headless with `--permission-mode dontAsk` (its facts' `readOnlyJob`), so the job must allow the tools
(`--allowedTools mcp__<server>__read`, …); the fake denies an MCP call that isn't allowed, as Claude Code does.

### 3. `@deepbuild/reading` (*invented*: `packages/reading/src/index.ts`)

```ts
import type { RecordStore } from '@deepbuild/record';
import type { Agent, Runner } from '@deepbuild/runner';
import type { Known, Wiki } from '@deepbuild/wiki';

export type ReadingKind = 'install' | 'replay' | 'premise' | 'summary';
export interface ReadingOptions {
  record: RecordStore;
  runner: Runner;          // every job of it starts here, kind 'read'
  root: string;            // the hub's root, which the job's reading tools read
  wiki: Wiki;              // where an install writes what it learned
  now: () => number;
}
export interface ReadingSpec {
  kind: ReadingKind;
  handles?: string[];      // what it is delivered; an install's default: every session a transcript.archived event links
  question?: string;       // what to find; an install has its own
  agent?: Agent;           // default 'claude-code'
}
export interface Cited { at: string; quote: string; known: Known; role?: string }   // role: a transcript source's message role
export interface Finding { text: string; cites: Cited[] }
export interface ReadingResult {
  reading: string;                                   // `reading:<ULID>`
  runs: string[];                                    // every runner job it started (`run:<ULID>`)
  findings: Finding[];                               // kept: every quote at its handle, every handle delivered in this job
  dropped: { at: string; quote: string; reason: string }[];   // each refused citation; the reason names the handle
  undelivered: number;                               // findings dropped for citing no handle delivered in this job
  plan: { five_hour_pct: number } | 'not captured';  // the plan usage it took, as a share of the 5-hour window
  models: { final: string; subreads: string[] };     // the model of its final answer (or premise review) and of each sub-read
  written: string[];                                 // the wiki claims it wrote (`wiki:<page>#<claim>`)
}
export interface Reading { run(spec: ReadingSpec): Promise<ReadingResult> }
export function openReading(options: ReadingOptions): Promise<Reading>;
```

The agent's answer is the job's final result text, `reading.answer@1` (*invented* schema):
`{ findings: { text: string; cites: { at: string; quote: string }[] }[] }`. An install turns its kept findings into
wiki candidates (`wiki.learn`), its page, claim ID and scope its own choice.

### 4. Event kinds (*invented*, published schemas; `digests.json` gains them)

```jsonc
// reading.finished@1: one per reading job
{ "reading": "reading:<ULID>", "kind": "install", "runs": ["run:<ULID>"], "findings": <int>, "dropped": <int>,
  "undelivered": <int>, "plan": { "five_hour_pct": <number> } /* or null when not captured */,
  "models": { "final": "<model>", "subreads": ["<model>"] } }
// reading.dropped@1: one per refused citation (AC2's "logged")
{ "reading": "reading:<ULID>", "at": "<handle>", "quote": "<the quote>", "reason": "<words naming the handle>" }
```

The tests read only the fields named here. Neither event, nor anything else in the record or the wiki, carries a
dropped finding's quote except `reading.dropped` (and `reading.finished`, if it lists them).

## The fake agent

`fixtures/fake-reader.pl` (`/usr/bin/perl`, so it runs in Seatbelt with the system's own runtime) stands in for
Claude Code and the model, the one boundary these tests don't own. It answers `--version` and `auth status`, refuses
to start with `CLAUDECODE=1`, and for a headless stream-json run (prompt on stdin) does what an agent reading by
reference does, from its flags and files alone (its head says the details):

- **Its context** is what Claude Code would send a model: `--system-prompt`/`--append-system-prompt`, `CLAUDE.md` in
  its folder (and `~/.claude/CLAUDE.md` when user settings load), its stdin, and every tool result. It reports each
  verbatim as a `{"type":"system","subtype":"fake"}` line, so the tests read every prompt the job sent.
- **Its handles** are the `session:`, `ev:` and `wiki:` handles in that context. It reads them only through the
  first MCP server whose tools include `read`, one slice of each.
- **Sub-reads.** With more than 6 handles and the Task tool, it hands them to sub-agents, 6 each, in one turn. A
  sub-agent runs on the model of the first agent `--agents` defines (by name), else on the session's (`--model`,
  default `claude-sonnet-5-5`); aliases resolve to the facts' names (`haiku` → `claude-haiku-5-5`, `opus` →
  `claude-opus-5-5`, …). Sub-agent messages carry `parent_tool_use_id`; the result's `modelUsage` names each model.
  A job that runs its sub-reads as separate runner jobs works too: the tests read every runner job that started
  during the reading job.
- **Its findings:** each `remember: <quote>.` in a message of a slice, cited at that message's handle with the exact
  quote. A top-level run adds the findings the test planted to its answer, as they are (AC2, AC6, AC10).
- **Its usage** is honest: each turn's input tokens are its context so far and its output tokens what it printed,
  in characters / 4 rounded up.

## Readings

- **The fixture corpus (AC1).** The repo holds no corpus of 212 sessions, so `corpus.ts` generates one from seeds:
  212 Claude Code sessions over four projects (api, web, cli, docs), 60 messages of about 1,000 characters each
  (about 60 KB of text, 12.7 M characters in all), each recorded by its hooks (`session.start` under its project) and
  archived by the real archive (#20). Each session's second message is your fact for its project.
- **Plan usage (AC1).** The plan's window is a boundary DeepBuild doesn't own; the fake's plan holds 20,000,000
  tokens in one 5-hour window (`WINDOW_TOKENS`), calibrated on the design's "38 sub-reads, about 4% of one 5-hour
  window": reading one slice of each session comes to about 3%, and pasting the corpus once to about 16%. The
  status line forwarder's stand-in reports the window (5% used at the start, then every 250 ms the share the job's
  runs have spent) through `runner.report`. AC1 holds the job's runs to under 5% by their own usage, and the job to
  showing a plan usage that is a number, at most 5, in its result and its `reading.finished` event.
- **"Reads 212 recorded sessions":** the job's runs read a slice of each of the 212 session handles.
- **"Every wiki line cites a handle":** every line of every page (other than headings, blank lines and the wiki's
  closing line) is a claim line citing at least one `at` handle, each a message of a session the job was delivered,
  its quote at that message; and each project's fact is on the wiki, so an empty wiki doesn't pass.
- **Delivered (AC6):** a handle in the job's spec (for an install, every archived session), a message handle under
  one, and a handle a `find` or `read` in that job returned. A handle delivered to an earlier job is not delivered to
  this one. A finding citing no handle doesn't cite one delivered.
- **"Capped slices" (AC4):** no prompt a job sent (its main context: system prompt, CLAUDE.md, stdin and argv; each
  sub-read's prompt) holds more than 8,192 characters of record text, and no reading tool's reply is past the cap.
  Record text is measured by each message's unique tag: the run of that message's text following its tag.
- **"Marked outside content" (AC5):** the finding's citation's `known` (the wiki's `Known`) and the wiki line's
  `known`. A WebFetch result is `outside`; a Bash result is never `you` (Open questions).
- **The quote rule (AC10):** read by the blind redraft; see `AC10-REDRAFT.md` and Blind redrafts, below.
- **The archive turned off (AC3):** it ran one pass (day 0) and none after the agent deleted the transcript.
  "The archive's folder": the archive keeps no folder of its own; a copy at `<root>/archive/claude/<id>.jsonl` (where
  #20's own-folder twin kept them) stands for one, and holds other text.
- **Budgets (AC8):** the perf lane's merge-base comparison, as #20's: `benchmarks/budgets.json` must hold a task
  whose `initialReason` names #63 and whose command runs `benchmarks/reading.mjs`, valid against the merge base's
  budgets by `validateBudgets`, and it must run and exit 0. The 200 ms: `deep read` as a process (what an agent's
  tool call costs), a message slice and a continuation slice of a 1,000-message session on a record holding the 212
  sessions, five runs after a warm-up each, judged by the design's rule, on a reference Mac (Mac15,7 M3 Pro 36 GB
  or Mac15,12 M3 16 GB, mains power, Low Power Mode off, thermal nominal, load under the core count), else skipped
  INCONCLUSIVE. The cap and "where to continue" are judged on any machine.

## Criteria to tests

Each test's name starts with its criterion's number; each `describe` carries the criterion's ID,
`#63.<first 8 hex of the SHA-256 of its text>` (trimmed, whitespace collapsed, as `scripts/proof-change.mjs` does).

| ID | Criterion (short) | Tests | Wrong program | At this base |
|---|---|---|---|---|
| AC1 `#63.f697c796` | install reads 212 sessions within 5% of a 5-hour window; every wiki line cites a handle | `install.test.ts` (3): the corpus; every session read, through the runner, < 5%, plan shown; every wiki line cites a delivered handle, each fact on the wiki | the mutation lane | fails (no `@deepbuild/reading`) |
| AC2 `#63.084da449` | a quote not at its handle is dropped and logged, never written | `quotes.test.ts` AC2 (1) | the mutation lane | fails (no `@deepbuild/reading`) |
| AC3 `#63.52524f64` | a deleted transcript reads from its linked evidence; an unlinked session errors naming the handle | `transcript.test.ts` (1) | `folderReader` (archive folder, then the agent's path) | fails (`deep read` unsupported) |
| AC4 `#63.e6ad4b93` | no prompt holds more than the capped slices | `install.test.ts` AC4 (2): install and replay; the twin | `pasteJob` | fails (no `@deepbuild/reading`) |
| AC5 `#63.69997dd3` | a quoted tool result is outside content, never your words | `outside.test.ts` (1) | the mutation lane | fails (`deep read` unsupported) |
| AC6 `#63.d01b86b0` | every finding cites a handle delivered in that job; others dropped and counted | `delivered.test.ts` (1) | the mutation lane | fails (no `@deepbuild/reading`) |
| AC7 `#63.b0064604` | sub-reads on a smaller model, final and premise on the strongest, each named | `models.test.ts` (2): a summary, a premise review | the mutation lane | fails (no `@deepbuild/reading`) |
| AC8 `#63.82892e51` | budgets vs the merge base: < 200 ms, ≤ 8,192 characters, a cut reply says where to continue | `budgets.test.ts` (4): the perf-lane task; it runs; the cap; the timing | — | fails (no #63 task; `deep read` unsupported) |
| AC9 `#63.d3ce9787` | a marker in message 900 is in no prompt; a pasting job fails naming the job | `marker.test.ts` (1) | `pasteJob` | fails (no `@deepbuild/reading`) |
| AC10 `#63.46c00344` | the quote rule; a case-folded check fails | `quotes-redraft.test.ts` (1), the blind redraft (below) | `foldedCheck` | fails (`deep read` unsupported; `AC10-REDRAFT-BASE.txt`) |

## Wrong programs

| Twin | Criterion | Where | What it does | How the test fails on it |
|---|---|---|---|---|
| `folderReader` | AC3 | `wrong.ts` | reads `<root>/archive/claude/<id>.jsonl`, else the agent's transcript path, and prints a slice as `deep read --json` would | the deleted session's slice is the folder's text, or an error once the folder is gone; the unlinked session gets a slice instead of an error; each problem names the handle |
| `pasteJob` | AC4, AC9 | `wrong.ts` | reads the session's archived copy through the record and runs one `read` job through the runner with all of it in its prompt | AC4: the prompt holds more than 8,192 characters of the record; AC9: the prompt holds the marker; each failure names the job's `run:<ULID>` |
| `foldedCheck` | AC10 | `wrong.ts` | the quote rule with case-folded comparison, on the same redacted slices (`deep read`) | exactly one case is judged wrong: `Port 3000` for `port 3000` |

Each twin test runs the real program first, so it fails at the base too. Criteria naming no twin fail on the base,
which has no reading surface; past that, the mutation lane is their wrong program.

## Scope the tests leave alone

Scope items with no checkbox criterion; a PR should say how it proves what it claims of them:

- **"Stops at the plan reserve":** the runner (#159 AC11) already keeps a job from starting at your reserve; a
  reading job stopping mid-way at the reserve has no criterion (and see Open questions).
- **`deep find`'s results** (handles to sessions, events, evidence and wiki pages, a line of context each): no
  criterion reads them; the fake reads only by `read`.
- **Token-heavy material read only inside sub-reads** (traces, long logs): no criterion names it.
- **The premise review and change summary as product flows**: AC7 runs a `premise` job; who starts one is not tested.
- **"Nothing else of the record reaches the prompt"** beyond AC4's and AC9's measures.

## Open questions

- **The reserve.** The issue's Scope says each job "stops at the plan reserve"; the design says it "waits when the
  plan window is down to your reserve". No criterion settles which; nothing here tests either.
- **AC5 and first-hand tool results.** The issue says a finding quoting "a tool result inside a transcript is marked
  outside content". The design (The learned layer) and #355's wiki mark only a fetch's, a search's or an MCP call's
  result as outside content; "any other tool's result reads as first-hand", which the wiki marks `inferred`. The
  test asks `outside` for a WebFetch result and only "never `you`" for a Bash result. If the issue means every tool
  result, a redraft should ask `outside` for the Bash result too, which the wiki would have to change for.
- **AC1's window.** No source gives a 5-hour window's size; `WINDOW_TOKENS` is this job's calibration (Readings).
  The plan usage the job shows is held to being a number at most 5; how it's computed from window readings is the
  implementer's.
- **AC7's "strongest available".** Claude Code's facts list `opus`, `sonnet`, `haiku` and `fable` families without
  an order, and nothing records which an account can use. The test reads `opus` as the strongest and `sonnet` or
  `haiku` as smaller; where `fable` ranks is open.
- **AC7's mechanism.** The fake follows models DeepBuild sets (`--model`, `--agents`), never one the prompt asks the
  agent to pick: an agent's word is never evidence, so a model the agent chose itself isn't a choice DeepBuild made.
- **The trial replay (Proof).** No trial surface exists at this base; the replay is a reading job of kind `replay`.
- **"Logged" (AC2)** is read as an event in the record, `reading.dropped@1`.
- **Codex** has no readOnlyJob launch for reading yet; every job here runs Claude Code.

## Files

- `helpers.ts`: the environment, temp folders and the fake sign-in, cleanup by PID, handles, the fake's install and
  what it reported (prompts, replies, models, tokens, answer), `deep` as a process, slices, criterion IDs, the
  reference-Mac gate and the timing judge.
- `corpus.ts`: seeded Claude Code sessions and transcripts; the 212-session corpus.
- `world.ts`: the record, store, asks, ledger, supervisor, runner, wiki and archive on a hub's root; seeding;
  `@deepbuild/reading` loaded lazily; `runReading` with the plan's forwarder stand-in.
- `checks.ts`: the criterion checks the twins are run through (AC3, AC4, AC9, AC10).
- `wrong.ts`: the three twins.
- `fixtures/fake-reader.pl`: the fake agent.
- The test files: `install.test.ts` (AC1, AC4), `quotes.test.ts` (AC2), `quotes-redraft.test.ts` (AC10),
  `transcript.test.ts` (AC3), `outside.test.ts` (AC5), `delivered.test.ts` (AC6), `models.test.ts` (AC7),
  `budgets.test.ts` (AC8), `marker.test.ts` (AC9).
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: a placeholder; the orchestrator runs the suite on the base commit and saves its output there.
  Its AC10 lines are the removed first draft's; the redraft's base run is `AC10-REDRAFT-BASE.txt`.

## Blind redrafts that replaced first drafts

One first draft couldn't pass on any implementation, so it went to a blind redraft of this job (design: Dogfooding):
a fresh run with the issue, the design and the base commit `b7bccf9`, never the work, the diff or the dispute. The
redraft fails on the base and passes on the work. On October 27, 2026 the owner approved it in place of the first
draft, and the first draft was removed. The criteria table above names the redraft.

| Criterion | First draft (removed) | Why it couldn't hold | Redraft | Notes |
|---|---|---|---|---|
| AC10 `#63.46c00344` | `quotes.test.ts`, the AC10 test | its NFC case planted `café` through `fixtures/fake-reader.pl`, which prints its answer without an encoding layer, so `é` (below U+0100) left the fake as the single byte `0xE9`, not UTF-8, and no check could find the quote; the quote and the slice were also both NFC, so the case never tested NFC | `quotes-redraft.test.ts` | `AC10-REDRAFT.md`, `AC10-REDRAFT-BASE.txt` |
