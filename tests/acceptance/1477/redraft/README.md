# #1477 redraft: how the record decides, after the 2026-11-09 amendment

A blind redraft by the same acceptance-test job. Inputs: issue #1477 as it reads now, `docs/technical-design.md`,
`docs/canvas-primitives.md`, the base commit `dd83ac2f`, and this job's first draft in `..` (README.md, helpers.ts,
record.test.ts, built.test.ts, probe.swift). Nothing else in the working tree was read. The first draft's files are not
edited; the implementing agent doesn't edit these either (AGENTS.md, Proof).

The amendment changes one criterion and one line of Scope:

- `#1477.e66d9bdb` now reads: "The record gives all arms with their fingerprint, and an unrun arm reads INCONCLUSIVE;
  a table arm that can't show its rows reads missed, with the reason, and counts as a miss. It ends in one line: stop,
  or build".
- Scope: "A table arm that can't show the 100,000 rows at all misses 4 ms: it reads `missed` in the record with the
  reason, never INCONCLUSIVE." (gpui-shell's caps hold a panel's `DataTable` to at most 127 rows of 8 columns.)

## What this replaces

| First draft | Redraft | Why |
|---|---|---|
| `../record.test.ts`, the `#1477.e66d9bdb` test | `record.test.ts`, the `#1477.e66d9bdb` test | Its `judgeRecord` calls any status other than `measured` or `INCONCLUSIVE` a problem, so a record with a missed panel arm can't pass, and its rule can't decide build from a missed arm |

Everything else in the first draft stands, unchanged:

- `../record.test.ts`'s other four tests (`#1477.46aa3ab4`, `#1477.466ab542`, `#1477.af9cb943`, `#1477.55753e50`)
  read list arms, `remeasure` and the citation, never the decision rule.
- `../built.test.ts` is not redrafted: its gate's verdict is the same under the amended rule in every case.
  `builtOrProvenStop` returns `build` on the record's word `build` before judging the record, so a build decided by a
  missed panel runs the "If built" criteria as in the first draft. Under `stop`, a committed record with a missed table
  arm fails in both drafts (the first draft: "neither measured nor INCONCLUSIVE"; the amended rule: that record decides
  build), and a fresh stop proof whose kit or panel arm reads missed fails in both (it isn't `measured`; under the
  amended rule that's a build). So no "If built" test's verdict depends on the amendment.

## Run it

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/1477/redraft --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1477/redraft/tsconfig.json   # type-check
```

Run the first draft's other tests as its README says, with `../record.test.ts`'s `#1477.e66d9bdb` test replaced by
this one. Builds, real windows, the machine rule, the cache note and the time are the first draft's (one partial and
one full `measure`, about 3 min after the build). **Lanes**: `tests/acceptance/1477/` is already `alone` by the first
draft's README; `tests/acceptance/1477/redraft/record.test.ts` joins `timed` too (it calls `judgeLimit` through
`laneProblem`). The implementer makes that edit.

## Surface additions

Everything in the first draft's README "The surface under test" stays: bench `lists_1477`, its calls, the record at
`docs/spikes/1477/record.json`, the field names, the `plant-*` features and the lane rule. Added:

- **A third arm status, `missed`.** `arm <name>` for a table arm (`kit`, `panel`, or `ours` when it exists) that runs
  and can't show the 100,000 rows of 8 columns prints, and the record holds:

  ```json
  { "arm": "panel", "status": "missed", "reason": "<why it can't show the rows>",
    "fingerprint": { … }, "rows": 100000, "columns": 8 }
  ```

  `reason` is a non-empty string; `fingerprint` is `fingerprint()`'s fields, as on a measured arm; `rows` and `columns`
  are the 100,000 × 8 it couldn't show. It has no `raw` and no `net`: it took no reading, and a reading of fewer rows
  isn't one of 100,000. `blank` and the list arms never read `missed`. It is never written INCONCLUSIVE.
- **Unrun is still INCONCLUSIVE.** Under `measure --arms …`, an arm not run reads INCONCLUSIVE with its reason, even a
  table arm that would read `missed` when run: `missed` is what running the arm finds.

## How `missed` enters the decision and the `net` checks

- **Decision** (`decide` in helpers.ts). INCONCLUSIVE while blank, kit or panel is unrun, as before. Otherwise `build`
  when kit or panel reads `missed`, or reads over 4 ms at p99 net of the blank arm; `stop` only when both were measured
  within 4 ms. A missed arm needs no blank arm to miss, but the record still runs blank and the other table, and both
  count by the lane's rule, so a record reads INCONCLUSIVE rather than build while one of them is unrun.
- **The record's word** must equal that rule's whenever it says stop or build. INCONCLUSIVE is allowed only while some
  arm is unrun: with every arm measured or missed, it ends in stop or build.
- **`net`.** Each measured arm but blank still carries `net` equal to its raw readings less the blank arm's, recomputed
  here. A missed arm carries neither `raw` nor `net`, and none is computed for it.
- **The lane's rule** reads measured arms only. A missed arm took no timing, so its fingerprint is required but not
  judged; the timed arms beside it are, and any the lane doesn't count make the test INCONCLUSIVE, as before.
- **The test.** A partial `measure --arms blank,list-10k` lists kit, panel and list-100k INCONCLUSIVE with reasons, no
  arm missed, and decides INCONCLUSIVE. A full `measure` here and the committed record each pass every check above,
  every arm measured or missed, none unrun, and decide the same, else INCONCLUSIVE. It logs the missed arms with their
  reasons and the decision line.

A record that shows a missed panel and says `stop` or INCONCLUSIVE, a missed arm without a reason, a missed list or
blank arm, or a missed arm carrying numbers each fail. A bench that writes a panel that can't show its rows as
INCONCLUSIVE never passes: the full run reads INCONCLUSIVE.

## What this can't check

Whether an arm that reads `missed` really can't show its rows, or one that reads `measured` really showed 100,000: the
bench says so and the test can't see inside gpui-shell. The `measured` arm's `rows` and frame count are checked as in
the first draft; the cap itself (10,000 array items, 127 rows) is the issue's measurement, not this test's.
