# Acceptance tests for #2365 AC5 (blind redraft): the parts joined equal the merge base's one copy

A blind redraft of AC5 only (AGENTS.md, Proof; design: Dogfooding). Written on 2026-11-15 by a job that read only:

- issue #2365 (`ISSUE-2365.json`): its Scope and its acceptance criteria, AC5 above all;
- `AGENTS.md` and `docs/technical-design.md`;
- the base export `1c4d1f0e2aaad8c6a6573848823566d04ff73d17`: `packages/archive/src/index.ts` (the one-copy
  archive), the public entries of `record`, `evidence`, `asks`, `adapters` and `contracts`
  (`transcript.archived@2`), `benchmarks/archive.mjs` and `benchmarks/budgets.json` (#20's perf tasks), and #20's
  acceptance suite in `tests/acceptance/20/` (its README, helpers, generator, twins and tests), which it reuses.

It saw no other checkout, no earlier test for #2365, no diff, no implementation and no session. The implementing
agent doesn't edit these files; a dispute goes to another blind redraft.

## The criterion

> For every transcript in #20's suite and its perf tasks, the parts joined are byte-identical to the one copy the
> merge base stores of the finished file, and a second pass over an unchanged transcript reads none of it

Its ID, `#2365.<first 8 hex of the SHA-256 of that text>` (trimmed, whitespace collapsed), is computed in
`scenarios.ts` (`AC5`) and heads every `describe`; every test's name starts with `AC5`.

## How to run

On macOS, with the repo's Node (24.22.0 or later), from the repo root, in a git checkout whose `origin/main` is
fetched:

```sh
npm ci                                   # once, if node_modules is missing
node node_modules/vitest/vitest.mjs run --root tests/acceptance/2365-redraft-ac5 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/2365-redraft-ac5/tsconfig.json
```

- Nothing needs building: the change is loaded from `packages/archive/src/index.ts` through #20's `openArchiveOn`,
  and the merge base runs from its own sources.
- `perf.test.ts` writes and archives #20's 1 GB backlog and heavy month, twice (the change, then the merge base), in
  batches; allow up to about an hour and a few GB under `/tmp`. `suite.test.ts` and `meter.test.ts` take minutes.
- Safety, as #20's: every folder is under `/tmp/dh20-*` and removed (each run's world after the run, the rest after
  the file); `HOME` is a temp folder; no network; the only child process is the merge base's archive, waited for.

## The surface under test

No new surface. The tests reach the change only as #20's suite does, through `openArchive` (`packages/archive`,
via `tests/acceptance/20/helpers.ts`, `openArchiveOn`) and `pass()`, and read what it did only through the record
(`read`) and the evidence store (`read`). The merge base is reached through its own public entries, from its sources.

## Readings

- **"#20's suite."** Every transcript a test in `tests/acceptance/20/` writes, written and archived in the same steps
  (`scenarios.ts`, `SUITE`): AC1's Claude Code, Codex and `tiny` transcripts in moved and default homes; AC2's two
  Claude Code sessions (one grown before its first pass) and Codex rollout over two passes; AC3's sessions captured
  hourly for 3 and for 28 hours; AC4's keyed sessions, one grown after two passes; AC5's session with a held value
  (passed as `held` to both archives); AC8's plain, keyed, Codex and "bent" sessions (the bent one archived unbent:
  the store bending is not the transcript); AC9's session with a deploy token; AC10's 10 → 50 line session; and AC7's
  budget transcripts from `generate.ts`: the ten live sessions over six minutes, both days of the heavy month (half,
  then whole) and all 200 sessions of the 1 GB backlog. The keys and the held value #20 draws at random are drawn
  from fixed seeds. #20 AC6's CI logs are not transcripts. AC3's lines written outside the facts' folders are not
  transcripts the archive reads.
- **"Its perf tasks."** `archive-live`, `archive-month` and `archive-backlog`, as `benchmarks/archive.mjs` at the
  merge base runs them: its own `transcript(seed, size)` generator, taken from the merge base's file, and its steps
  (ten 1 MB sessions gaining 12 lines a minute for five minutes; four 5 MB sessions at half and whole; twenty 5 MB
  sessions in one pass), under a temp `CLAUDE_CONFIG_DIR`, folder `projects/-tmp-shop`. The steps are replayed in the
  test so the record and the store can be read after; the task's own script only checks the newest copy.
- **"The one copy the merge base stores of the finished file."** The merge base is `git merge-base HEAD origin/main`,
  as #20's budgets find it. Its `packages/`, `adapters/` and `benchmarks/archive.mjs` are exported with `git archive`
  to a temp folder, given the repo's installed `node_modules` with the workspace's own packages pointing at the
  exported ones, and its archive runs in a child process (`base-copy.mjs`, under Node's
  `--experimental-transform-types --conditions=development`) with its own record and store, one pass over the same
  finished files, the same homes and held values. What its `transcript.archived` event links, read back from its
  store, is the one copy. So the comparison is with the merge base's own code and scrub, not with anything the change
  may touch. The test requires the merge base to have stored exactly one copy per transcript and its pass to have
  failed nothing; otherwise it reports BLOCKED.
- **"The parts joined."** How a part is recorded is the implementer's (Scope), so the tests accept both the old whole
  copy and parts linked by ordered events. A session's events are those written through the archive's connection
  (`writer` `ext:deepbuild/archive`) that name the session, by `data.session` (`session:<letters>`, as
  `transcript.archived` does) or by the event's own `session`, other than the asks core's `ask.*`, with the evidence
  each links in the record's own `evidence` list, in log order. The parts joined hold when any one of these, read back
  from the store and concatenated in order, is byte-identical to the merge base's copy:
  - one event's `evidence` list (a whole copy, as the merge base links; or an event that lists every part);
  - the `evidence` lists of a run of consecutive events ending with the newest (one or more parts per event; a
    transcript copied again from its start begins a new run).
  Nothing else of an event's `data` is read, so no future schema is assumed.
- **"The finished file."** The transcript as the scenario leaves it, after its last write and pass.
- **"A second pass over an unchanged transcript reads none of it."** After the scenario's last pass, the clock moves
  an hour and the same archive runs one more pass with nothing changed. During it, the read meter (`meter.ts`) counts
  the bytes this process reads of each transcript through every reading entry of `node:fs`, `node:fs/promises` and
  `FileHandle` (named imports included, via `syncBuiltinESMExports`); copying, `openAsBlob` or a web stream of it
  counts as reading it. Each must be 0. Stats, opens without a read and reading the record or the store are allowed.
  The pass must also resolve. A restarted archive's first pass is not this criterion's.
- **At the merge base** these tests are expected to pass: the merge base keeps one whole copy (accepted as its own
  parts) and skips a file unchanged by size and modification time without reading it. AC5 guards what the change must
  keep; its teeth are the planted twins below and `meter.test.ts`.

## Criteria to tests

| ID | Criterion (short) | Tests | Expected at the merge base |
|---|---|---|---|
| AC5 `#2365.<computed>` | for every #20 suite and perf transcript, the parts joined equal the merge base's one copy; an unchanged second pass reads none | `suite.test.ts` (10 scenarios + 2 twin tests), `perf.test.ts` (3 perf tasks + live, month, backlog budgets), `meter.test.ts` (1) | pass (not run here) |

## Wrong programs

| Twin | Where | What it does | How the check fails on it |
|---|---|---|---|
| `rereadingArchive` | `wrong.ts` | whole copies, scrubbed as ingestion scrubs, but every pass reads and hashes every transcript to see whether it changed | the unchanged pass reads each transcript whole: "`<scenario>: session:<id> (<agent>, <path>, <n> bytes): the second pass over the unchanged transcript read <n> bytes of it`" |
| `cutBeforeNewlineArchive` | `wrong.ts` | reads only what a transcript gained (nothing when its size is unchanged), stored in parts cut at the last line's end, but with that newline left out of the part | no join of its parts equals the merge base's copy; the check names the session and "line <n> differs" |

Each twin test runs the same scenarios (#20 AC1's three agents, #20 AC10's growth) on the real archive first and
requires them to hold. Both twins are built only on the record's and the store's public entries and #20's helpers.

## Gaps

- **The meter sees this process's JavaScript `fs` calls only.** Reads in a worker thread, a child process or a native
  addon are not counted; an archive that reads its sources there would pass the zero-read clause unseen.
- **Parts named elsewhere.** If an implementation links its parts only through some field of `data` and not the
  event's `evidence` list, or through a connection other than the archive's, the parts read as missing and AC5 fails;
  that is a dispute for another redraft, not a reason to edit these files.
- **The merge base must be reachable**: `git` and a fetched `origin/main`, and a Node whose
  `--experimental-transform-types` runs the merge base's TypeScript (24.22 does). Otherwise every test reports
  BLOCKED. If `origin/main` has moved past the PR's real base, `merge-base` still finds the fork point.
- **The perf tasks are replayed, not spawned.** The steps follow `benchmarks/archive.mjs` at the merge base; its
  generator is taken from that file by text, so a merge base without `function transcript(seed, size)` is BLOCKED.
- **Not run.** This job wrote the files only (no installs, no runs, no type check), as instructed; the first run
  and its `BASE-FAILURE`-style transcript are the implementer's to record.

## Files

- `scenarios.ts`: the criterion and its ID; the scenarios (`SUITE`, `BUDGET_LIVE`, `budgetMonthDay`,
  `budgetBacklog`, `PERF`); the runner (`runScenario`); the parts reader (`readings`); the check (`problemsOf`).
- `base.ts`: the merge base's export, its archive run once (`baseCopies`), and its perf generator (`perfGenerator`).
- `base-copy.mjs`: the child that runs the merge base's archive and writes its copies.
- `meter.ts`: the read meter. `meter.test.ts`: the meter sees each way of reading.
- `wrong.ts`: the two twins.
- `suite.test.ts`: #20's suite and the twin tests. `perf.test.ts`: #20's perf tasks and budget transcripts.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
