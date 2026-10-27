# Acceptance tests for #20: transcript archive for Claude Code, Codex and pi

Written first, blind, by a job that never saw an implementation of #20. On October 26, 2026 it read:

- issue #20: its Scope, its 10 checkbox criteria, its Proof, its References and what it depends on (#14, #15, #348,
  #349)
- `docs/technical-design.md`: First-party extensions that ship on by default (the `archive` row); What each agent
  gives us, and the limits we design around (the Claude Code, Codex and pi rows: `transcript_path`, the 30-day
  cleanup, pi's `~/.pi/agent/sessions/`); Evidence (retention keeps "an archived transcript a `transcript.archived`
  event links"); Privacy (redaction by pattern and by value, "before any evidence is hashed"); Reading by reference
  (`session:` handles resolve through the record, through the `transcript.archived` link); the Secrets threat row
  ("A key pasted into chat opens a 'rotate this key' item"); the `quiet` status row; Every task carries its own
  budgets and The reference Macs; the Dogfooding rule
- `AGENTS.md`
- the acceptance suites of the issues it depends on and of #16 and #237, for conventions: `tests/acceptance/14`, `15`,
  `16` (the hub's retention pass on a test clock), `237` (budgets against the merge base), `348`, `349` (criterion IDs,
  wrong programs, BASE-FAILURE), `62` and `723` (archived transcripts and `session:` handles in the record)
- the public entries the surface builds on: `record` (`openRecord`, the `sessions` projection's `transcript` column,
  the learned layer's reading of `session:<id>#<message>`), `evidence` (`openEvidenceStore`, `scrubText`, `retain`),
  `contracts` (`transcript.archived@1`, frozen in `digests.json`), `asks` (`openAsks`, `raise`, `inbox`,
  `sources.json`), `adapters` (`shipped`, `factsAdapter`, each facts file's `transcripts` section), `hub` (`core.ts`:
  its retention pass keeps the evidence each `transcript.archived` event's `data.evidence` names), and
  `scripts/benchmark.mjs` with `benchmarks/budgets.json`
- the base commit `14561af` (origin/main)

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

On macOS, with the repo's Node (24.22.0):

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # AC9 starts the hub from packages/cli/dist
node node_modules/vitest/vitest.mjs run --root tests/acceptance/20 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/20/tsconfig.json   # needs the surface below
```

- **`--no-file-parallelism`:** AC9 starts hubs, and the budgets must run with nothing beside them.
- **The environment:** `helpers.ts` takes `CLAUDE*`, `CODEX*`, `DEEP_*`, `TINY_HOME` and `AI_AGENT` out of the test
  process's environment and points `HOME` at a temp folder. The archive gets its environment as an option, each
  world's own: a temp `HOME`, and `CLAUDE_CONFIG_DIR` or `CODEX_HOME` where a test moves an agent's home. No test reads
  the real `~/.claude`, `~/.codex` or `~/.deepbuild`.
- **Temp folders:** every world, home, agent folder and backlog is under `/tmp/dh20-*`, a real path, removed after
  its file. Each hub AC9 starts is stopped by its PID; nothing is stopped by name or port.
- **Clock:** every world runs on a test clock that starts on Monday 2026-10-05 09:00 UTC (day 0). The live-sessions
  and backlog budgets time real work with `process.cpuUsage()` and `performance.now()`, nothing else reads time.
- **Network:** none. The forge is a fake on 127.0.0.1 (`forge.ts`).

## The surface under test

The issue names a first-party extension (`archive`, design: First-party extensions) and event kinds, but no code
API. This job defines the smallest surface: one package with one function, the record and the store it writes
through, and three event kinds. The tests reach the archive only through `openArchive` and read what it did only
through the record (`read`, `table`), the evidence store (`get`, `read`) and the asks core (`inbox`): the archive
only writes (Scope).

### `packages/archive/src/index.ts` (`@deepbuild/archive`)

```ts
import type { AdapterRegistry } from '@deepbuild/adapters';
import type { Asks } from '@deepbuild/asks';
import type { EvidenceStore } from '@deepbuild/evidence';
import type { Connection, RecordStore } from '@deepbuild/record';

export interface ArchiveOptions {
  record: RecordStore;           // where the archive's events go, and where it reads what it already copied
  evidence: EvidenceStore;       // where each copy goes, by hash
  asks: Asks;                    // where a pasted key's "rotate this key" ask goes
  adapters: AdapterRegistry;     // the sources: each adapter's facts' `transcripts` section ({ home, path })
  env: Readonly<Record<string, string | undefined>>; // what the facts' `home` names resolve in: HOME, CLAUDE_CONFIG_DIR, CODEX_HOME…
  connection: Connection;        // what the archive writes through; the hub hands it one
  now: () => number;             // the only clock it reads
  held?: () => readonly string[];                    // the values DeepBuild holds by handle now; read at each copy
  forge?: { api: string; repos: readonly string[] }; // GitHub's REST API base (https://api.github.com) and the repos (owner/name) whose CI runs are copied
}
export interface Archive {
  /** One pass: copies every source that is new or changed since its last copy, and every completed CI run not yet copied. Resolves when the pass is done. */
  pass(): Promise<void>;
}
export function openArchive(options: ArchiveOptions): Promise<Archive>;
```

Why this shape:

- **One function, `pass()`.** Every criterion is "after the archive runs, X holds". How often the hub runs it, and
  how it is wired into the hub to run on its own, is the implementer's; the tests call `pass()` where the archive would
  run. A live minute (AC7) is one `pass()` after a minute of writes.
- **Sources from the adapters, not from agent names** (Scope: "a new adapter adds its folders with no change here").
  The archive reads `adapters.names()` and each adapter's `facts.transcripts`: `home` is the variable that moves the
  agent's home and then its default (`~` is `env.HOME`); `path` is the layout under it. AC1 registers a third adapter,
  `tiny`, whose facts are Claude Code's with `agent: "tiny"` and `transcripts: { home: ["TINY_HOME", "~/.tiny"], path:
  "sessions/{session}.jsonl" }`, and expects its transcript archived like the other two. (pi has no adapter in this
  repo yet; it is R2.)
- **`env` and `now` as options**, so a test points the agents' homes at temp folders and controls time without
  touching the process.
- **`held` as a function**, because the values the hub holds change while the archive runs.
- **`forge` as the GitHub REST API's base URL.** The forge is the boundary DeepBuild doesn't own, so the tests fake
  that API (`forge.ts`) and nothing else. The fake serves `GET /repos/{owner}/{repo}/actions/runs`, `…/runs/{id}`,
  `…/runs/{id}/jobs`, `…/jobs/{id}`, `…/jobs/{id}/logs` (302 to the log as text) and `…/runs/{id}/logs` (302 to a
  zip of one `{n}_{job name}.txt` per job), as GitHub documents them; either log route may be used.
- **`asks` and `connection` passed in**, as the asks core and the hub's connections are passed to every other
  first-party piece (#349's host, #237's lease table).

### Event kinds (published schemas; `digests.json` gains them)

`transcript.archived@1` is frozen with `data: { session, evidence }` and `additionalProperties: false`, so the source's
size and hash need a new version:

```jsonc
// transcript.archived@2: one per copy
{ "session": "session:<id>",                       // the agent's session ID with every character but letters and digits dropped
  "evidence": "<sha256>",                          // the copy: SHA-256 of the redacted bytes the archive wrote
  "source": { "size": <int>, "sha256": "<sha256>" } } // the transcript's bytes before redaction, as the archive read them

// archive.quiet@1: capture went quiet
{ "agent": "<adapter name>",                       // the source that went quiet: `claude` for Claude Code's folders
  "last": <int> }                                  // ms: when that source last captured, the ts of its newest copy's event

// ci.archived@1: one per CI run copied
{ "repo": "<owner/name>",
  "run": "<the forge's run id, as a string>",
  "result": "<the run's conclusion as the forge gives it: success, failure, …>",
  "logs": [ { "job": "<the forge's job id, as a string>", "evidence": "<sha256>" /* , … */ } ] }  // each job's log, by hash
```

The tests read only the fields named here; others may be added. `evidence` keeps its name in @2 because the hub's
retention pass (`core.ts`) and the `sessions` projection read `data.evidence` of `transcript.archived`, whatever its
version; the tests don't read `v`.

### A pasted key's ask

The rotate ask is raised through the asks core (`asks.raise(connection-with-the-session, '<source>', ask)`), which needs
a row in `ask.sources@1` (`packages/asks/sources.json`); `secret.pasted` is the obvious name, but the tests don't read
the source or the kind. They find the ask as an `ask.created` event whose `question` contains "rotat" (any case),
whose event session is the transcript's session (compared letters and digits only), and whose inbox row is open.

## Readings

Where the issue and design leave a choice, this job read:

- **The archived copy is the redacted transcript.** `EvidenceStore.read(<hash>)` returns the transcript's bytes after
  "the same redaction as ingestion": exactly `scrubText(source, { held })`, the store's own text scrub (by each held
  value in every printed form, then by pattern). The tests compare copies with that, byte for byte. So the copy is
  plain JSONL, which the record's own reader of `session:<id>#<message>` parses (#62); how bytes sit on disk
  (compressed or not) is the store's, and the size budget measures the folder on disk.
- **Session handles.** `session:` plus the agent's session ID with everything but letters and digits dropped, as the
  hub's handles hold them (`asks`' `letters`, the hub's backfill). Claude Code's session is the file's name (`{session}`);
  Codex's is the rollout's thread, which is both the end of its file name and its `session_meta` line's `payload.id`
  (the fixtures carry both).
- **A message handle.** `#<message>` is the transcript entry's `uuid`, as the record reads it (#62; `tests/acceptance/723`
  does the same). AC10's fixture names line *n* `m<n>`, so `#m40` is line 40 by either reading.
- **"Resolves through the record" (AC10).** The record's own resolution of a `session:` handle (design: Reading by
  reference): the `sessions` projection's `transcript` column names the session's newest copy, and the core finds a
  quote at `session:<id>#m40` in that copy when a learned change cites it there, so the change is applied; a quote that
  isn't at its handle is refused, "not at its handle". No `deep read` exists at this base (#63), so the core's reading
  at append is the one public reader.
- **"Re-running copies nothing new" (AC2).** No new `transcript.archived` or `ci.archived` event and no write at all
  to the evidence store (no `put`, no text sink closed; the store the archive gets is wrapped to count them), on a
  second pass and on a fresh archive over the reopened record and store, as after a hub restart. Re-reading and
  hashing the sources is allowed.
- **"Stopping capture for a day" (AC3).** The archive runs hourly on the test clock. Capture stops while the agent
  keeps working: its hooks keep landing in the record (`user.ask`, hourly) but its transcript lines go to a folder its
  facts don't name. Twenty hours after the last capture there is no `archive.quiet` yet; by 25 hours there is one
  naming `claude` with `last` the newest copy's time. With capture going on, none at all over 28 hours, including for
  sources that never captured anything (a source that never captured hasn't gone quiet). How often the alert repeats
  is not tested.
- **The rotate ask (AC4).** One ask per pasted key, in the session it was pasted in, that doesn't quote the key; the
  key appears nowhere in the record. The same key in the same session is asked about once, across passes and across a
  later copy of the grown session (invariant 4: never the same question twice). A key in a tool result, or a held value
  pasted, may or may not open one; not tested.
- **A held value (AC5).** "No recognizable pattern" is shown in the test: `scrubText` with no values leaves it in place.
  It is a 28-letter lower-case word, so only its value can scrub it.
- **A CI run (AC6).** Copied while the forge holds it; then the forge's retention deletes it (the fake answers 404 for
  every route that names it), and the result and each job's log read back from the record and the store, the log byte
  for byte as the forge served it (the logs carry nothing the scrub changes). The forge's retention runs on the test's
  word (`expire`), two days after the run. Whether CI copies outlive DeepBuild's own 30-day evidence retention is not in
  any criterion; see "Scope the tests leave alone".
- **Read back (AC8).** For each copy: the event's `source` is the size and SHA-256 of the transcript's bytes before
  redaction; `evidence` is the SHA-256 of the redacted bytes; the store's record of the file has their size; and
  `store.read` returns those bytes. The second test hands the archive a store whose writes land corrupted (the store
  says `stored`; one byte of the file then flips, as a torn or bad write would leave it): an archive that reads its copy
  back finds the mismatch and appends no `transcript.archived` event naming it. Whether it reports the failure some
  other way is its own; `pass()` may reject.
- **31 days after the agent deleted it (AC9).** Day 0: archived. Day 1: the agent's cleanup deletes the transcript.
  Day 32: the hub (`deep hub run`, `DEEP_HUB_TEST_CLOCK`) starts on the same home and runs its retention pass at start,
  which a control file nobody cites, stored on day 0, shows by being removed. Then the one event and the one evidence
  file remain and read back. The pass is the hub's, not a test's call to `retain()`.
- **The budgets (AC7).** The merge-base comparison is the perf lane's: `benchmarks/budgets.json` must hold three #20
  tasks (an `initialReason` naming #20, a command running `benchmarks/archive.mjs`), valid against the merge base's
  budgets by `scripts/benchmark.mjs`'s `validateBudgets`, and each must run and exit 0. The issue's numbers:
  - *10 live sessions under 1% of a core:* ten Claude Code sessions an hour in (1 MB each, generated by `generate.ts`)
    each gain a line every 5 seconds (12 a minute); each minute ends with one `pass()`, which must leave every session's
    newest copy equal to its transcript as it is (that's "keeps up"); its CPU time (`process.cpuUsage`, user + system)
    over the minute is the share of a core. Five minutes after a warm-up minute, judged by the timing rule against 1%.
  - *30 days compress to under 2 GB:* a heavy month is 20 sessions a day (as #24's and #26's heavy months are), each a
    5 MB transcript copied twice as it grows, at half and whole, so the archive holds what a live day leaves. Two such
    days are archived; the evidence store's folder, in allocated blocks, times 15 must be under 2 × 10⁹ bytes. Bytes on
    disk aren't a timing, so this is judged on any Mac, not only the reference Macs. The session sizes are this job's
    estimate; the issue gives none. On these generated sessions, plain copies come to about 4.5 GB a month, gzip about
    1.0 GB and zstd about 0.4 GB.
  - *A 1 GB backlog under 5 minutes:* 200 generated sessions of 5 MB on disk; one `pass()` on a fresh record and store,
    timed until it resolves, with every session archived after it. Five runs after a warm-up, judged against 300 s.
  - Timings count only on a reference Mac (Mac15,7 M3 Pro 36 GB or Mac15,12 M3 16 GB) on mains power, Low Power Mode
    off, thermal state nominal and the 1-minute load under the core count; anywhere else the test is skipped as
    INCONCLUSIVE, not measured, never passed. Each budget test loads the archive first, so at the base every one fails
    on the missing surface whatever the machine.

## Criteria to tests

Each test's name starts with its criterion's number. Each `describe` carries the criterion's ID,
`#20.<first 8 hex of the SHA-256 of its text>`, on the text trimmed, whitespace collapsed and `- [ ] ` dropped (as
`scripts/proof-change.mjs` does). A test headed `(wrong program)` runs the criterion's scenario on the real archive
first, then on the twin the criterion names, and expects the criterion's check to fail on the twin, naming the session
or handle.

| ID | Criterion (short) | Tests | At this base |
|---|---|---|---|
| AC1 `#20.eb5dbec4` | a transcript deleted by its agent still exists in the archive | `copies.test.ts` (1): Claude Code (moved home), Codex (moved home) and a new adapter (default home) archived, deleted, read back after another pass | fails (no `packages/archive`) |
| AC2 `#20.9b0ff45e` | re-running copies nothing new | `copies.test.ts` (1): second pass and a fresh archive after a restart: no copy event, no store write (transcripts and a CI run) | fails (no `packages/archive`) |
| AC3 `#20.e13bfd0e` | stopping capture for a day raises the alert | `quiet.test.ts` (2): no alert at 20 h, `archive.quiet` naming `claude` and its last capture by 25 h; none with capture going on | fails (no `packages/archive`) |
| AC4 `#20.0567345d` | a fake key in a user message opens a rotate ask and is redacted | `secrets.test.ts` (2): one open rotate ask, key in no event, copy redacted; asked once across passes and a later copy | fails (no `packages/archive`) |
| AC5 `#20.c93e8478` | a held value with no pattern is scrubbed from the copy | `secrets.test.ts` (1): copy equals the scrub with the held value, without it | fails (no `packages/archive`) |
| AC6 `#20.91899638` | a CI run's log and result copied before the forge's retention, read back intact | `ci.test.ts` (1): `ci.archived` with the result; each job's log byte for byte after the forge deleted the run | fails (no `packages/archive`) |
| AC7 `#20.1e107583` | budgets compared with the merge base | `budgets.test.ts` (5): three #20 perf-lane tasks valid against the merge base; each runs; live 10 sessions < 1% of a core; 30 days < 2 GB on disk; 1 GB backlog < 5 min | fails (no #20 tasks; no `packages/archive`) |
| AC8 `#20.2fe357c5` | each copy read back and matched by size and SHA-256; the source's size and SHA-256 on the event | `readback.test.ts` (2): source size and hash before redaction, copy size and hash after; a copy that lands corrupted is never linked | fails (no `packages/archive`) |
| AC9 `#20.5b690079` | one evidence file and one event per transcript, both kept 31 days after deletion | `retention.test.ts` (3): day 0, deletion on day 1, the hub's retention pass on day 32; wrong programs: own folder; link in a ledger of its own | fails (no `packages/archive`) |
| AC10 `#20.7a50eb28` | grown 10 → 50 lines: a new copy with its own event; `#m40` resolves through the newest | `growth.test.ts` (2): two copies, the record links the newest, a learned change quoting m40 is applied; wrong program: copies once | fails (no `packages/archive`) |

## Wrong programs

| Twin | Criterion | Where | What it does | How the test fails on it |
|---|---|---|---|---|
| `ownFolderArchive` | AC9 | `wrong.ts` | copies each Claude Code transcript, redacted, to `<root>/archive/claude/`, and nothing to the store or the record | no event and no evidence file on day 0 or 32; the check names the session |
| `privateLedgerArchive` | AC9 | `wrong.ts` | puts each copy in the evidence store and appends its `transcript.archived` link to a ledger of its own (`<root>/archive/ledger.db`), which the retention pass doesn't read | the copy is in the store on day 0 and gone on day 32, removed by the hub's retention; the check names the session |
| `copyOnceArchive` | AC10 | `wrong.ts` | copies and links each session the first time it sees it, never again | one copy; the learned change quoting m40 is refused, "not at its handle"; the check names `session:<id>#m40` |

The twins are built only on the record's and the store's entries, which exist at the base; each twin test runs the
real archive first, so it fails at the base too. Criteria that name no twin fail on the base, which has no archive;
past that, the mutation lane is their wrong program.

## Scope the tests leave alone

Scope items with no checkbox criterion; a PR should say how it proves what it claims of them:

- the archive shipping on by default: loaded by the extension host (#348) into its slot (#349) and run by the hub on
  its own; the tests call `pass()` directly;
- pi's sessions, which wait for pi's adapter (R2); the new-adapter case in AC1 stands in for "a new adapter adds its
  folders with no change here";
- whether CI copies outlive DeepBuild's 30-day evidence retention (the design's retention exception names archived
  transcripts only); AC6 reads them back two days after the run;
- Codex app sessions recorded from their transcripts, and subagent transcripts under a Claude Code session's folder.

No criterion here waits on an unbuilt issue, so a PR for #20 that passes every test here may say `Closes #20` after a
review of those Scope items.

## Files

- `helpers.ts`: the environment cleanup, temp folders, the test clock, IDs and handles, the adapters (shipped plus
  `tiny`), transcripts written as each agent writes them, the world (record, store, asks core in a hub's layout, the
  store the archive gets with its writes counted and optionally bent), the archive loaded lazily from its entry,
  reads of events and copies, and the criterion IDs.
- `forge.ts`: the fake forge (GitHub's Actions REST routes, 302s to the logs, a run-log zip, `expire`).
- `hub.ts`: `deep hub run` on a home and a test clock, stopped by PID: the retention pass for AC9.
- `generate.ts`: seeded Claude Code sessions of a given size for the budgets.
- `wrong.ts`: the three twins.
- The test files: `copies.test.ts` (AC1, AC2), `quiet.test.ts` (AC3), `secrets.test.ts` (AC4, AC5), `ci.test.ts` (AC6),
  `budgets.test.ts` (AC7), `readback.test.ts` (AC8), `retention.test.ts` (AC9), `growth.test.ts` (AC10).
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit.
