# Acceptance tests for #2316: buying folds only card_rule.set, and archive's session copy finds its session without walking every transcript

Written first, from issue #2316 (its two findings, scope, three acceptance criteria and proof line), the design sections
it links (One event log, with tables built from it; Plans before acting; Dogfooding) and the base commit `11eb8c6fd`
("Merge pull request #3069 …"), by a job that never saw a fix. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test per criterion,
and AC3 is three existing suites run unchanged.

## What was read

- Issue #2316, AGENTS.md and the design sections above.
- At the base: `packages/buying/src/index.ts` (`Buyer.sync`, `buy`), `packages/record/src/index.ts` (`readSince`,
  `RecordStore.read` and its `kinds`), `packages/archive/src/index.ts` (`sources`, `session`, `pass`),
  `packages/hub/src/holds.ts` (`ARCHIVE_WAIT_MS = 2000` and the held push's race against it), `packages/hub/src/core.ts`
  (where the hub hands `archive.session` to the holds), `adapters/{claude-code,codex}.facts.json` (`transcripts.path`),
  and the suites `tests/acceptance/69/`, `20/` (its `helpers.ts`), `1156/` and `3025/` (house form).

## Run them

```sh
npm ci && npm run build --workspaces     # once: the packages' sources import each other's built entries
node node_modules/vitest/vitest.mjs run tests/acceptance/2316/buying.test.ts
node node_modules/vitest/vitest.mjs run tests/acceptance/2316/archive.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/2316/tsconfig.json
```

No cargo, no GPU, no agent, no network. `buying.test.ts` keeps its record under the OS temp folder (suite 69's world);
`archive.test.ts` keeps its home, record and 2,001 transcripts under the OS temp folder too, and loads suite 20's
helpers, which point `HOME` at a temp folder and take the agents' own variables out of the test process. Both remove
what they made. `archive.test.ts` reads the wall clock once, around one call; run it alone, and note the load.

AC3, the three suites as their own READMEs run them:

```sh
node node_modules/vitest/vitest.mjs run tests/acceptance/69
node node_modules/vitest/vitest.mjs run --root tests/acceptance/20 --no-file-parallelism
npx vitest run --root tests/acceptance/1156 --no-file-parallelism --testTimeout=600000 fast.test.ts   # builds deep-hook with cargo
```

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the leading `- [ ] `
dropped. Each test's name starts with `AC<n> #2316.<id>`; its file's header states the fixture and the wrong programs.

| ID | Test | What it asserts | At the base |
|---|---|---|---|
| AC1 `#2316.b2850c01` | `buying.test.ts` (1) | After a paid purchase, 10,000 `user.ask` events and one card rule set among them: every `record.read` the next `buy()` makes names `kinds: ['card_rule.set']`; the rows it gets are that one rule's event and none of the 10,000; the purchase is paid by it; the `buy()` after that reads from the log head the last one saw | passes: the base already has this |
| AC2 `#2316.e3f1d78c` | `archive.test.ts` (1) | Beside 1,000 Claude Code transcripts in 100 sibling project folders and 1,000 Codex rollouts in 100 date folders, `archive.session(id)` for one Claude Code session leaves exactly one `transcript.archived` event, the session's, whose copy reads back as its transcript redacted, and returns in under 1,000 ms | passes, though the base walks every transcript: see below |
| AC3 `#2316.aaed1f0a` | `tests/acceptance/69/`, `20/` and `1156/`, run unchanged | Proven by running the three suites unchanged on the change; this suite holds no copy of them | BASE-FAILURE.txt |

## What the base holds at each site

The issue was written against `145315636`. At the base, `11eb8c6fd`:

- **Buying (finding 1) is already as the issue asks.** `Buyer.sync()` is `this.cursor = await readSince(this.o.record,
  this.cursor, ['card_rule.set'], …)`. `readSince` reads pages with `kinds`, and returns the larger of the last row's
  position and the log head. So AC1's test passes at the base. It proves the criterion only against a wrong program
  (a `sync` that reads with no `kinds`, or leaves its cursor at the last card rule), which is the implementing
  session's to plant.
- **Archive (finding 2) is as the issue found it.** `session(id)` calls `sources(options)`, which reads every folder of
  every registered agent's `transcripts.path` and `transcripts.archived`, then keeps the sources whose session's
  letters match. AC2's test still passes at the base: on this machine that walk over 2,000 files costs tens of
  milliseconds, far under any reading of "well within" 2,000 ms (numbers in BASE-FAILURE.txt). With the issue's 2,000
  files and its named surfaces, this job found no assertion the criterion states that fails at the base.

## Left open

- **"Well within `ARCHIVE_WAIT_MS`" names no number.** This suite reads it as under half, 1,000 ms. The issue gives
  only the bound itself (2,000 ms) and the risk (a copy that times it out), so any number below 2,000 is a choice; half
  leaves the hub's race a margin as large as the copy. The base's walk meets it by a wide margin, so the timing
  doesn't tell a lookup that walks every transcript from one that doesn't. The criterion's wording can't either: both
  finish in time and both archive only the target. Telling them apart would take a far larger tree than 2,000 files,
  a ratio against a run with no siblings (a threshold the issue doesn't give, inside this machine's noise), or
  counting the archive's folder reads (an internal the issue doesn't name). None of those is this job's to add.
- **"`ARCHIVE_WAIT_MS`"** isn't exported; the test states 2,000 ms as `packages/hub/src/holds.ts` does.
- **"2,000 unrelated transcript files in sibling project/date folders"** is read as both kinds: 1,000 in sibling
  Claude Code project folders and 1,000 in Codex date folders, 10 a folder. The active session is a Claude Code one,
  alone in its own project folder, never archived before.
- **The time read is `archive.session(id)` alone**, on an archive already open, as the hub holds one. The hub's held
  push (holds.ts) races that same call against the wait; the test doesn't start a hub.
- **"Reads only `card_rule.set` rows"** needs a `card_rule.set` row to read, so one card rule is set among the 10,000
  events; the criterion's 10,000 are the `user.ask` events, counted by the test before the purchase.
- **"Advances its cursor to the log head"**: the cursor is private, so it is read where it shows, the `after` of the
  next `buy()`'s first `record.read`, against the log head noted when the processor was asked to charge, which is
  right after the read. Only the buying module's reads are recorded; the ledger and the asks core read the record
  directly.

Not tested, because no criterion asks: the hub's card when a copy is late (`unknown` targets), `archive.pass()`,
`archive.archived()`, Codex or Pi sessions as the target, and the other folds' use of `readSince`.
