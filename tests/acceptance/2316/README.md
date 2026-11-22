# Acceptance tests for #2316: buying reads only card_rule.set rows, and one session's archive copy is fast beside 2,000 sibling transcripts

Written first, blind, from issue #2316 (its two findings, Scope, the 3 criteria and Proof; no comments), the design
sections "One event log, with tables built from it", "Plans before acting" and "Dogfooding", `AGENTS.md`, and base
commit `2eaaeb0e6` (origin/main), by a job that never saw an implementation; none existed, and no other branch,
worktree, pull request or session's notes were read. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

| AC | ID | File (tests) |
|---|---|---|
| AC1 on a record holding 10,000 non-`card_rule.set` events after the last purchase, `buy()` reads only `card_rule.set` rows (`record.read` is called with `kinds: ['card_rule.set']`) and advances its cursor to the log head | `#2316.b2850c01` | `buying.test.ts` (1); passes on the base, wrong programs in `twins.json` |
| AC2 copying a single active session via `archive.session(id)` with 2,000 unrelated transcript files in sibling project/date folders completes well within `ARCHIVE_WAIT_MS` and archives only the target session | `#2316.e3f1d78c` | `archive-session.test.ts` (2: a Claude Code target, a Codex target); pass on the base, wrong program in `twins.json` |
| AC3 `tests/acceptance/69/`, `tests/acceptance/20/` and `tests/acceptance/1156/` pass unchanged | `#2316.aaed1f0a` | no test here: checked by running those suites (below, "AC3") |

IDs are the issue's own (sha256 of each criterion's trimmed text, first 8 hex). Each test's name starts with its ID.
Every criterion is decided by a vitest `expect` in the test file; setup and controls throw plain `BLOCKED` errors,
so a broken setup is never read as proof.

## What was read

- The issue (as handed to this job, body only).
- `docs/technical-design.md`: the three sections above.
- At the base: `packages/buying/src/index.ts` (`Buyer.buy`, `Buyer.sync`), `packages/record/src/index.ts`
  (`readSince`, `RecordStore.read`), `packages/budget/src/index.ts` (its `readSince` fold, to know what else reads
  while `buy()` runs), `packages/archive/src/index.ts` (`sources`, `segmentPattern`, `session`, `copyNow`),
  `packages/archive/src/copy.ts`, `packages/hub/src/holds.ts` (`ARCHIVE_WAIT_MS`, the held-push wait),
  `adapters/claude-code.facts.json` and `adapters/codex.facts.json` (`transcripts.path`), `scripts/proof-runs.mjs`
  (`atAssertion`, `twinsOf`, how twins are laid) and `scripts/lanes.mjs` (`timed`).
- Suites `2134/` for the house format, `69/` (its buying world, reused through `69/buying.ts` and `69/helpers.ts`),
  `20/helpers.ts` (its archive world, reused: `openWorld`, `claudeTranscript`, `codexTranscript`, `openArchiveOn`,
  `allEvents`, `expectArchived`), `1156/` (README and `fast.test.ts` header, for AC3), and
  `packages/archive/test/session.test.ts`.

## The surface

- **AC1**: the real `@deepbuild/buying` (`openBuying`, from its source entry) over #69's world: a real record on
  SQLite in a temp folder, the evidence store, the asks core, the #86 ledger, and a payment processor the test holds
  (the one boundary DeepBuild doesn't own). The record it is handed is the real store seen through a spy
  (`buying.ts`, `openSpiedWorld`) that passes every call on unchanged and writes down what each `read` asked for
  (`after`, `limit`, `kinds`) and the kind and log position of each row it handed back. The criterion names
  `record.read` and its `kinds`, so what was asked of the record is what is observed. The 10,000 events are a
  session's tool calls as deep-hook appends them (`tool.before`, `tool.after`, writer `hook`), appended to the real
  record.
- **AC2**: the real archive, `openArchive` from `packages/archive/src/index.ts` through #20's `openArchiveOn`, over
  the shipped adapters' facts, in #20's temp `HOME` (`/tmp/dh20-*`), with real transcript files laid where each agent
  keeps them: Claude Code's `~/.claude/projects/<cwd with each non-alphanumeric as ->/<session>.jsonl`, Codex's
  `~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<thread>.jsonl`. What it archived is read back from the record
  (`transcript.archived`) and the evidence store.

## Readings where the issue leaves a choice

- **"10,000 non-`card_rule.set` events after the last purchase"**: a $12 purchase from `shop.example` is paid by a
  $25 card rule (control: `BLOCKED` unless paid), then 10,000 hook events land (control: the real store counts
  10,000 tool events and no `card_rule.set` after it, else `BLOCKED`), then `buy()` buys $15 from the same seller.
- **"`buy()` reads only `card_rule.set` rows"**: while that `buy()` runs, no read hands back a row of the 10,000
  events, no read is made without a kinds filter, at least one read asks for exactly `kinds: ['card_rule.set']`, and
  those reads hand back only `card_rule.set` rows. The ledger's own filtered reads of its spend and ask kinds, made
  inside `buy()` at the base, are not the buying module's and are allowed; that they also read none of the 10,000
  is held by the first check. The purchase is still paid by the rule set before the 10,000.
- **"Advances its cursor to the log head"**, by behavior: 500 more events land, and the next purchase's reads for
  `card_rule.set` start at or past the 10,000th event's log position (where the last purchase's read reached the
  head), with none of the 500 handed back. Then a new card rule for `lamps.example` is set between more events, and a
  $30 purchase from it is paid with the new rule's card: a cursor past the head that skips rules would fail here.
- **"A single active session"**: a session whose transcript is still growing. `archive.session(id)` is called five
  times, as the hub calls it before each held push: once, then after each of four more turns appended to the
  transcript. After each call the newest copy must read back as the whole transcript, redacted as ingestion
  redacts (`expectArchived`).
- **"2,000 unrelated transcript files in sibling project/date folders"**: exactly 2,000 others (`archive.ts`,
  `siblings`): 1,000 Claude Code sessions, 25 in each of 40 project folders, none the target's, and 1,000 Codex
  rollouts, 20 on each of the 50 days before the target's. Each holds a few messages as the agent writes them. The
  control counts 2,001 transcripts on disk, else `BLOCKED`. The criterion's session is either agent's, so one test
  targets a Claude Code session (in its own project folder) and one a Codex rollout (on its own day), each beside
  the same 2,000.
- **"Archives only the target session"**: after the five calls the record holds five `transcript.archived` events,
  all naming the target's `session:` handle.
- **"Well within `ARCHIVE_WAIT_MS`"** (2000 ms, `packages/hub/src/holds.ts`): see the bound, next.

## The bound

Each of the five calls must finish under `ARCHIVE_WAIT_MS` (2000 ms) and the **median of the five at most 200 ms**,
a tenth of the wait. A tenth reads as "well within": it leaves the hub nine tenths of its wait for the time a
loaded machine takes from the copy, and the median of five takes one slow call under load (one call of five took
214 ms at load average about 95 on this machine at the base) without letting a slow copy pass. Times are wall-clock
(`performance.now()`) around `archive.session(id)` alone, on an archive opened once, as the hub holds it. No load
gate: the bound is wide enough for a loaded machine, and a test that judges a wall-clock budget belongs in
`scripts/lanes.mjs` `timed` (`tests/acceptance/2316/archive-session.test.ts`), which this job can't edit; the
implementer adds it there with a signed tag if the lanes ask for it.

## What the base does, where it isn't what the issue says

The issue's findings were read from the code. At `2eaaeb0e6` neither reproduces as a failing criterion:

- **AC1 is already met.** `Buyer.sync()` already calls `readSince(this.o.record, this.cursor, ['card_rule.set'],
  ...)` (since `a4eb329a5`), which asks `record.read` with `kinds: ['card_rule.set']` and returns
  `max(cursor, head)`. So AC1's test passes on the base; its wrong programs are `twins/sync-reads-every-event` (the
  unfiltered `record.read({ after, limit })` loop the issue describes) and `twins/sync-cursor-at-last-rule` (the
  filter without the head), on each of which it fails at its assertion (`twins/README.md`).
- **AC2's time is already met at 2,000 files.** The base's `session(id)` does walk every registered agent's whole
  transcript tree (`sources`) before filtering, as the issue says, but the walk only reads directories, never the
  files: beside 2,000 transcripts in 90 folders a call took 17 to 214 ms, medians 41 and 50 ms (Claude Code and
  Codex targets), at load average about 95. It copies only the target. So AC2's tests pass on the base; their wrong
  program is `twins/session-copies-every-transcript`, on which they fail at their assertion.

Neither changes an assertion: the tests hold the issue's expected values as written. That the narrowed
`session(id)` walks no unrelated session files is not observable as time at 2,000 files, and the criterion names
2,000; see Open questions.

## AC3

`#2316.aaed1f0a` has no test in this folder. A tagged test here would have to run the three suites inside one test:
#1156's `fast.test.ts` builds Rust binaries and takes about 4 minutes, and #20 holds `budgets.test.ts`, a timed
file, so one test would carry a cargo build, a timed budget and a hub, in lane copies that have no `target/`, and a
wrong program for it would have to break one of three other suites. Those suites are already tagged with their own
issues' criteria and their own twins. So AC3 is checked by running them at the change, unchanged:

```sh
npx vitest run tests/acceptance/69 --reporter=verbose
npx vitest run tests/acceptance/20 --reporter=verbose
npx vitest run --root tests/acceptance/1156 --no-file-parallelism --testTimeout=600000 fast.test.ts
git diff --exit-code origin/main -- tests/acceptance/69 tests/acceptance/20 tests/acceptance/1156   # unchanged
```

and recording their output with the change. A hand-checked criterion stays open in the trace lane, so the pull
request says `Part of #2316` unless the owner accepts that record. `1156/session.live.test.ts` needs a live Claude
Code session and plan usage; it is the owner's to run.

## Open questions (not guessed, not tested)

- **Not walking unrelated files** (Scope: "without walking unrelated session files when avoidable") is not in a
  criterion as such, and at the criterion's 2,000 files the base's walk is fast. A count of directory reads would
  test the implementation, not behavior; a larger tree is not what the criterion names.
- **The hub's call** (Scope: "and its call from the hub"): the criterion is on `archive.session(id)`; the hold path
  in `packages/hub/src/holds.ts` is not driven here.
- **A session whose transcript isn't where its facts say** (moved to Codex's `archived_sessions/`): not named by a
  criterion; not tested.

## Run them

```sh
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH   # when node and npm aren't on PATH
npm ci                                                    # once
npx vitest run tests/acceptance/2316 --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/2316/tsconfig.json   # type-check (twins excluded)
```

Two files, three tests, no hub, no Rust. AC1's world is removed after its test; AC2's temp folders after the file.

## Base results

`BASE-FAILURE.txt` is the whole run at the base (3 tests, all pass, none blocked), then each twin laid over a copy of
the base: on each, the tests of the criterion it names fail at their assertion.
