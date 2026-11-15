# Acceptance tests for #2365: a long session's transcript is archived by what it gained

Written first and blind by a job that never saw an implementation of #2365, its diff or another checkout. It read:

- `ISSUE-2365.json`: the issue's body, its Scope, its six criteria and its Proof
- `AGENTS.md`, and `docs/technical-design.md`: First-party extensions that ship on by default (the `archive` row),
  Evidence, Privacy (the scrub), Reading by reference, Numbers version 0 has to hold (Every task carries its own
  budgets; The reference Macs)
- the base commit `1c4d1f0e2aaad8c6a6573848823566d04ff73d17`: `packages/archive/src/index.ts` (`openArchive`,
  `copy()`), the record's public readers (`read`, `resolve`, `transcript`; `packages/record/src/learned.ts` for how a
  `session:` handle is read), the evidence store's (`get`, `read`, `scrubText`), `benchmarks/archive.mjs`,
  `benchmarks/budgets.json`, `scripts/benchmark.mjs`, `scripts/lanes.mjs`, `scripts/proof-change.mjs` (criterion
  IDs), and #20's acceptance suite (`tests/acceptance/20`), whose tools these tests reuse
- the conventions of `tests/acceptance/1700` (judging limits with the perf lane's `judgeLimit`)

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.
Nothing here was run by this job: the export has no `node_modules` and no build (see Unrun below).

## How to run

On macOS, with the repo's Node (24.22.0), from the repo root:

```sh
npm ci                                   # once, if node_modules is missing
# the default suite: AC3, AC4, AC5 and the Scope's tail (each file a few minutes at most)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/2365 --no-file-parallelism
# the heavy runs: AC1 (100 MB + 1 MB, six measured passes), AC2 (600 MB) and AC6 (budgets); they need the build
npm run build --workspaces
node node_modules/vitest/vitest.mjs run --config tests/acceptance/2365/heavy.config.ts
node node_modules/vitest/vitest.mjs run --config tests/acceptance/2365/heavy.config.ts heavy/ac1   # one of them
# the Proof's table (no verdict), in the merge base's checkout and then the change's, each built
node tests/acceptance/2365/probe/proof.mjs
node node_modules/typescript/bin/tsc -p tests/acceptance/2365/tsconfig.json
```

- **Default suite:** `tail.test.ts`, `rewrite.test.ts`, `identity.test.ts`. They load the archive from its source
  through #20's `openArchiveOn` and need no build. The unit lane (`scripts/lanes.mjs`, `tests/**/*.test.ts`) picks them
  up; `identity.test.ts`'s perf-task case pushes about 130 MB through the archive. #20's own folder runs `alone`;
  whether this one should too is for `scripts/lanes.mjs`, which this job may not edit.
- **Heavy runs:** `heavy/*.heavy.ts`, only through `heavy.config.ts`. They spawn `probe/pass.mjs`, which loads the
  built packages (`packages/*/dist`); without them they fail BLOCKED, never pass. AC1's timing and memory are judged
  by the perf lane's own judge, so they count only on a reference Mac in a fit state; anywhere else the test fails
  as INCONCLUSIVE, which is not a pass. They need about 2 GB of free disk (AC2's file and its copies).
- **Safety:** #20's helpers empty the agent's `CLAUDE*`, `CODEX*`, `DEEP_*` and `AI_AGENT` variables and set `HOME` to
  a temp folder. Every folder is under `/tmp/dh20-*` or `/tmp/dh2365-proof-*` and removed after its file. All text is
  synthetic; the keys are fresh fakes in gitleaks' `ghp_` shape. No network. The only processes started are the
  measured passes and `ps`, each awaited; nothing is stopped by name or port.

## The surface under test

Only what the issue, the design and the base already name:

- `openArchive(options)` (`@deepbuild/archive`), with `pass()` and `session(id)` ("The copy of one session on demand
  takes the same path"); #20's options, unchanged.
- The record's public reads: `read` (events), `resolve('session:<id>#<message>')` and `transcript(<session>)`, which
  is what "`session:` handles resolve across the parts as they do through one copy today" means, whatever the parts'
  shape (design: Reading by reference).
- The evidence store's `get`, `read`, and its folder layout `evidence/ab/cdef…` (design: Evidence).
- The asks the archive raises: `ask.created` events whose question says "rotat", in the session (as #20 reads them).

### How the joined parts are read (no event shape assumed)

How a part is recorded is the implementer's ("as a new version of `transcript.archived` or beside it"), so the tests
read a session's archived copy from data, not from a schema (`helpers.ts`, `expectCopy`):

1. the session's events: every event of a `transcript.*` kind whose `data.session` or `subject` is `session:<id>`,
   in log order;
2. each event's evidence, in order: its `evidence` list as the record keeps it, or `data.evidence` when that is empty;
3. the readings of the copy: the concatenated evidence of each run of events ending at the newest (a copy and the
   parts added since), and each suffix of the newest event's own list (an event that lists every part).

The copy holds when one reading's bytes, read back from the store a part at a time, equal the expected bytes. The
base's one whole copy per event is the reading "the newest event alone", so a one-copy implementation passes
wherever its bytes are right; a parts implementation passes whether each event names one part, several, or all of
them. When no reading matches, the failure names the closest reading (the one agreeing longest), its parts by hash,
and the first line that differs, with its message's `uuid`. Comparison streams, so a 600 MB copy is never held whole.

An implementation that records a part only inside a manifest evidence file (an event citing a file that lists other
hashes) would not be read by rule 2. The issue doesn't ask for one; if it is chosen, that is a dispute for a redraft.

## Criteria → tests

Criterion IDs are computed at load from the issue's words (`criteria.ts`), as `scripts/proof-change.mjs` computes them.

| Criterion | Tests | Runs in |
|---|---|---|
| AC1: 100 MB + 1 MB pass: under 2 MB evidence, within 1 s, under 64 MB RSS rise, 5 ms timer every 50 ms; a whole-file reader fails naming the peak | `heavy/ac1.heavy.ts`: the five measured passes after a warm-up; the planted whole-file reader (`probe/twin-whole.mjs`) | heavy |
| AC2: 600 MB never archived, copied in one pass; parts equal the file scrubbed a line at a time; `#m<n>` resolves for the last message | `heavy/ac2.heavy.ts`: by `pass()` and by `session(id)` | heavy |
| AC3: a key in a half-written line is in no part in any form; one rotate ask; a cut-at-the-end archive fails naming the part | `tail.test.ts`: by passes; on demand; a line written in three steps; the planted cut-at-end archive (`wrong.ts`) | default |
| AC4: first megabyte rewritten → copied again from its start, handles resolve through the new parts; an append-the-tail archive fails naming the first differing line | `rewrite.test.ts`: rewritten and grown; one letter rewritten at the same size; the planted append-tail archive (`wrong.ts`), which fails naming line 6 | default |
| AC5: for #20's suite's and the perf tasks' transcripts, parts joined byte-identical to the base's one copy; a second pass over unchanged ones reads none of them | `identity.test.ts`: #20's kinds of transcript; #20's budget sessions; the perf tasks' transcripts (`live`, `month`, `backlog`); the planted re-reading archive | default |
| AC6: a new perf task holds AC1's pass; `archive-live`, `archive-month`, `archive-backlog` stay within their limits against the merge base | `heavy/budgets.heavy.ts`: budgets.json valid against the merge base with a new #2365 task; each task runs. The merge-base comparison itself: the preflight's perf lane only | heavy + preflight |
| Scope: the tail after the last complete line waits; an unchanged tail is copied as it stands | `tail.test.ts` (Scope) | default |
| Regression: #20's suite | `tests/acceptance/20`, run unchanged (see Unrun) | #20's |

## Readings

Where the issue leaves a choice, this job read:

- **Units.** MB is 1,000,000 bytes, as #20's tests and `benchmarks/archive.mjs` count. So the limits are exactly the
  issue's: evidence added under 2,000,000 bytes; the pass's wall time within 1,000 ms; its RSS rise under 64,000,000
  bytes; the longest stretch the 5 ms timer goes unserved at most 50 ms. 600 MB is 600,000,000 bytes, past 512 MiB.
- **AC1's pass.** The setup archives the 100 MB transcript by one pass in a child; it then gains 1,000,000 bytes
  more (whole turns, so at most about 1.1 MB). "The pass that follows" runs in a fresh child on a clone of that home:
  the archive opened on the record, as the hub opens it when it starts, then one pass. Its RSS rise is the highest
  resident memory seen during the pass (the child's own 5 ms samples, its max RSS when the pass raised it, and `ps`
  from outside every 10 ms) less its RSS at the pass's start after a full GC. The evidence bytes are the files under
  the store's folder, before and after. The timer gap counts from the pass's start to its end.
- **AC1's and AC2's transcript.** Turns of four Claude Code lines: a typed prompt, a Read call, its tool result (20
  to 60 kB of numbered code, turn 50's 2,000,000 characters), and an answer sized so tool results are 94% of the
  bytes (checked between 93.5% and 95%). Each message's `uuid` is `m<n>`, its line, so `session:<id>#m<n>` names it.
- **"The file scrubbed a line at a time"** is `scrubText` of each line with its `\n`, joined. For JSONL, where no line
  break sits inside a value, this is also the file scrubbed whole, which the default tests use as the expected copy.
- **"The one copy the merge base stores of the finished file"** is what the base's `copy()` stores: the whole file
  decoded as UTF-8 and scrubbed with the values held, `scrubText(file, { held })` (#20's `redacted`).
- **"In no part in any form" (AC3)** is: no 12-character piece of the key's random part is in any evidence the store
  holds (every hash in its folder and every hash an event cites, read back) or in any event of the record.
- **"That pass copies up to the last complete line"** is checked as the copy equalling the transcript up to its last
  line end, scrubbed. A tail that changed since the last pass waits again (the three-step test); a tail unchanged at
  the next pass is copied as it stands, and when the agent then ends the line and goes on, the copy has every byte
  once (Scope).
- **"Copied again from its start" (AC4)** is checked by its result: the copy equals the rewritten transcript scrubbed,
  and its handles, including a prompt in the rewritten first megabyte, resolve to the rewritten text, through
  `resolve` and `transcript`. A same-size rewrite (one letter, the modification time moved on) counts too.
- **"Reads none of it" (AC5)** is: the pass after one that left every transcript current, in the same process (the
  hub's hourly pass), returns no byte from any source file through Node's file reads (`reads.ts`). Opening or
  `stat`-ing a file is no read. A pass after a restart is not held to this here: the issue doesn't say whether an
  archive may re-check a file after a restart, and AC1 holds that pass to its limits instead.
- **"For every transcript in #20's suite and its perf tasks"**: #20's tests build their transcripts inline, so this
  suite builds the same kinds with #20's own helpers (Claude Code, Codex, a new adapter's; grown 10 → 50 lines; a
  pasted key; a held value), plus one in non-ASCII text; #20's budget sessions with `generate.ts`; and the perf tasks'
  transcripts with `benchmarks/archive.mjs`'s generator, reproduced byte for byte in `identity.test.ts` because that
  file runs its task on import. Each is checked after every pass of its scenario.
- **AC6.** The comparison with the merge base is the perf lane's job in the local preflight (`judgeTask`), as for #20.
  The test checks what is checkable outside it: a valid budgets file with a new task that names #2365 in its reason
  or criteria, the three archive tasks unchanged, and each runs. Whether the new task "holds the first criterion's
  pass" is read from its reason, not measured.

## Wrong programs

Each is planted on the test side and must make its criterion's own check fail, naming what the criterion names:

- `wrong.ts` `cutAtEndArchive` (AC3): stores what the file gained up to its end, half lines too, each part scrubbed
  alone. The check fails naming the twin's first part by hash.
- `wrong.ts` `appendTailArchive` (AC4): copies from where its last part ended whenever the file is longer, never
  checking the bytes before. The check fails with `first differs at line 6 (message <uuid>)`.
- `probe/twin-whole.mjs` (AC1): the archive under test, but each pass first reads every transcript whole (a buffer
  and a string) and holds it. Every run's rise must be 64 MB or more, and the criterion fails naming the peak
  (`peak resident memory … MB`).
- `identity.test.ts`'s re-reading archive (AC5): reads unchanged sources through `fs/promises` `readFile`, a read
  stream and a `FileHandle`; the check fails naming each source. It proves the instrument sees each kind of read.

Each twin test passes when its check fails as named; it holds on the base too, since it tests the check.

## Expected at the base (not run)

- `tail.test.ts`: fails. The base copies the whole file, half line included, so after the first pass the key's first
  18 characters are in its copy (`the key's characters 5–16 … are in part <sha>`), or, should the scrub mask them, the
  copy holds the half line and isn't the transcript up to its last complete line. The rotate ask is never raised at
  the base either: it reads what was added from the old size, which starts mid-line. The Scope test fails at its first
  check: the base copies the unterminated tail at once. The cut-at-end twin test passes (it tests the check).
- `rewrite.test.ts`: passes. The base copies a changed transcript whole again, and that is the reference; these tests
  guard a parts implementation, and the append-tail twin shows the check has teeth.
- `identity.test.ts`: passes. The base's one copy is the reference, and its in-process `seen` map reads nothing on an
  unchanged second pass. These tests guard a parts implementation; the re-reading twin shows the instrument works.
- `heavy/ac1.heavy.ts`: fails. The issue's probe measured the base at 5.8 s or more, up to 1.2 s with no timer, peaks
  above 800 MB, and a whole new copy (about 100 MB) in the store each pass.
- `heavy/ac2.heavy.ts`: fails with `the archive pass left 1 copy undone: Cannot create a string longer than
  0x1fffffe8 characters`, and the session has no copy.
- `heavy/budgets.heavy.ts`: fails: the merge base's budgets have no #2365 task.

## Unrun, and gaps

- **Nothing here was run** by this job: no dependencies, no build, and the job may not run tests. No result above is a
  PASS; the expected base results are readings of the base's code.
- **#20's suite** is the regression suite and is reused, not copied. Its tests read the newest `transcript.archived`
  event's `data.evidence` as the whole copy (`expectArchived`, the budgets' `current`), as do `benchmarks/archive.mjs`
  and the record's `sessions.transcript`. A parts implementation that points `data.evidence` at a part breaks them;
  how it keeps them is the implementer's, and an unavoidable change to them is a dispute, not an edit.
- **AC6's merge-base comparison** is proved only by the preflight's perf lane on a reference Mac.
- **The read instrument** sees reads made in this process through `node:fs`, `node:fs/promises` and `FileHandle`. A
  read in a worker thread, a child process or a native addon is invisible to it.
- **AC1 off a reference Mac** reads INCONCLUSIVE for its time, timer and memory limits, by the design's rule; only its
  evidence bytes are judged on any machine.
- **What a held hook waits during a pass**, which the issue says its probe didn't measure, is not measured here either.
- **The Proof's table** (`probe/proof.mjs`) prints the probe's passes for the base and the change; it judges nothing.
