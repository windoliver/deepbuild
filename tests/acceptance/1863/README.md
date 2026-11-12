# Acceptance tests for #1863: a speed a claim states, and a term its diff adds, reach the numbers check

Issue #1863. Written first, blind, by a job that never saw an implementation. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

Read: the issue (Scope, two criteria, Proof, Depends on); #87's speed claims and added-term criterion and #1537's
numbers criterion; `AGENTS.md`; the design's How runs become one of five verdicts (Speed claims name their baseline,
Fail before pass after, Pinned to a commit, Check health, Failing on an assertion), Every task carries its own
budgets, the Definition of done, Claim and Check primitives, What done means, An agent says it's done, and How we know
version 0 works (Criteria in a checked shape, Wrong programs, Dogfooding). The base is `c52f1c66d`, where these were
read for surfaces and conventions only: `packages/checks-numbers` (`checkSpeed`, `AddedTerm`, `Side`), `packages/hub`
(`kinds.ts` `numbersSpec`, `core.ts` `runClaim`, `ask-tasks.ts`), and the suites of #1537, #87, #322, #323, #965.

## How to run

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH"
npx vitest run tests/acceptance/1863 --testTimeout=900000 --no-file-parallelism
npx tsc -p tests/acceptance/1863/tsconfig.json
```

Needs `npm run build --workspaces` and `target/debug/deep-hook`. No network, no model, no `gh`. Folders are under
`/tmp/dh322-*` (#322's world, `HOME` in it); every process is stopped by PID. The hub, deep-hook and the session's
`deep mcp` are the real ones; the suite reuses #322's world and hub, #965's `Session` (its own `deep mcp`, so
`deep_claim` is called as Claude Code calls it), #323's drafted check and #1537's readers, never editing them.

## The surface under test

- **`deep_claim`** through the session's own `deep mcp`, then the session's Stop with the final message. The hub's
  verdict is read back through `events.read` (`verdict.made`), as #1537 does.
- **The claim's other checks are held green** (the spec's unit check and R1's drafted check each ran and passed), so
  only the behavior under test can fail it; a setup that doesn't hold is BLOCKED, never a pass or a failure.
- **A timing check** (AC1) is a JSON file in the repo, `.deepbuild/timing/speed.json` (helpers.ts: `TIMING_FILE`),
  with #87's fields: `repeats` (5), `machine` (fingerprint), `toolchain` `{baseline, change}` each `{compiler, driver,
  runtime}` by version, and no `baseline` (the merge base by default) and no `warm` (cold caches). Each side runs four
  commands in its own checkout, the base side at the merge base's code and the change side at the claim's:
  `warmup`; `flush` (exit 0 means flushed); `work` (one timed repeat); `report` (prints the toolchain and machine
  the side ran with, as JSON).
- **How a final message cites it**: in plain words after the stated speed, `(timing check <path>)`, as #1537 cites a
  query. Not in backticks: the validity gate reads a backticked span as a file the session must have read.
- **A definition names its read-only sample** (AC2) by a field of the handed definition (DEEP_HUB_TEST_DRAFTS):
  `sample: "data/orders-sample.db"` (helpers.ts: `SAMPLE_FIELD`), a SQLite file in the repo.
- **A filter the diff adds**: the claim changes a `*.sql` file (`queries/paid-orders.sql`) by adding a `WHERE` term.
  The hub runs that file's merge-base text (without) and the claim's text (with) on the sample, opened read-only.

## Criteria to tests

| ID | Criterion (short) | Test file | What the test does |
|---|---|---|---|
| AC1 `#1863.2d3f3f89` | "1.8× faster than the merge base" over a timing check showing 1.2× is FAIL naming the speed | `speed.test.ts` | the session edits `bench.env` (wait 6 s to 5 s), claims through `deep_claim`, stops saying "… 1.8× faster than the merge base (timing check .deepbuild/timing/speed.json)"; the claim's verdict must be FAIL and name `1.8×` |
| AC2 `#1863.da28004d` | a filter the diff adds that changes no row of the sample fails, showing the sample | `filter.test.ts` | the session adds `AND status <> 'void'` to the query; none of the sample's 40 orders is void; the verdict must be FAIL, naming the filter and showing the sample (`data/orders-sample.db`) |

Each name and failure message starts with its ID, `#1863.<first 8 hex of SHA-256 of the criterion text>`, as
`scripts/proof-change.mjs` computes it (checked against the issue's body).

## Fixtures and their numbers

- **AC1.** `bench.sh`'s `work` waits `DELAY` seconds, read from `bench.env`: 6 at the merge base, 5 after the edit, so
  the change is 1.2× faster, five repeats a side (about 55 s of waiting, ~1 minute with the hub's own per-repeat
  work). A wait is the one cost a loaded machine can't stretch: the one-minute load has been 300 to 950 on 18 cores,
  where CPU-bound work or a short repeat would read INCONCLUSIVE. What a repeat adds beyond the wait (starting `sh`)
  is the same on both sides, so every repeat's ratio sits between about 1.1 and 1.2, its spread under 10%, and the
  failing rule (every repeat misses 1.8× by more than the margin, the larger of 5% and the spread) holds with room to
  spare: it would take a stall of several seconds on one repeat to push the margin past 33%. If that happens the
  verdict reads INCONCLUSIVE and the test says BLOCKED (a reading, not a decision), never a pass.
  Both sides report the same toolchain (`sh-1`, `none-1`, `sleep-1`) and machine (`fixture-machine-1`) the check names.
- **AC2.** `data/orders-sample.db`: table `orders(id, total, status)`, 40 rows, every `status` `paid`. The query is
  `SELECT id, total FROM orders WHERE total > 0 ORDER BY id`; the filter `status <> 'void'` leaves 40 rows of 40, which
  the test checks itself (BLOCKED otherwise).

## Wrong programs

| Test | Wrong program | Where it fails |
|---|---|---|
| AC1 | the merge base: a stated speed is never judged | the claim is PASS, so the FAIL assertion fails, naming the claim and its stated speed |
| AC2 | the merge base: an added filter never runs on the sample | the claim is PASS, so the FAIL assertion fails, naming the filter |

`BASE-FAILURE.txt` is the run on the base. No planted program is added to shipped code.

## Readings where the issue leaves a choice

- **Surfaces named above** (timing file, its fields, the four side commands, the plain-words citation, the `sample`
  field, a changed `*.sql` file as the filter) are this suite's choice; each name is in `helpers.ts` once.
- **The merge base** is the definition's base commit; no `baseline` field is given, as #87 makes it the default.
- **FAIL naming the stated speed** is a FAIL verdict whose data holds `1.8×`; **showing the sample** is a FAIL verdict
  whose data holds the sample's file path (the numbers check's added-term failure shows the sample by its file), and
  the filter's text.
- **Numbers neither the issue nor the design gives**: the 6 s and 5 s waits (so the 1.2× the issue gives is real), the
  40 sample rows. The timing check needs a deadline longer than the numbers kind's 30 s budget in `numbersFill()`
  (about one minute for the five repeats a side); the implementer sets it, the test doesn't.
- **The claim's commit** is passed as the world's merge base by the session's `deep_claim`; the edits are in its working
  tree, which the hub snapshots as it does for any claim.

## Not tested (no criterion asks)

- A passing twin (a speed that holds, a filter that changes rows) and the INVALID / INCONCLUSIVE paths of #87 (they
  are #87's suite, at the plug-in's level).
- A speed in the form "40 µs at batch 8"; a scoring term, input or data source (only the filter is named by a criterion).
- The budget of the numbers re-run.

## For the implementer, outside this folder

`scripts/lanes.mjs`: every test starts a hub of its own, so add `'tests/acceptance/1863/'` to the `alone` list, and
to the `timed` list (the speed test times a check with a wall clock).

## Files

`helpers.ts`, `speed.test.ts` (AC1), `filter.test.ts` (AC2), `tsconfig.json`, `BASE-FAILURE.txt`.
