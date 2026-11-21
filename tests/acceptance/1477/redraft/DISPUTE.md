# Dispute: #1477.e66d9bdb's first draft (`tests/acceptance/1477/record.test.ts`)

**The criterion, as amended on 2026-11-09:** "The record gives all arms with their fingerprint, and an unrun arm reads
INCONCLUSIVE; a table arm that can't show its rows reads missed, with the reason, and counts as a miss. It ends in one
line: stop, or build".

**What the first draft knows:** two arm readings, `measured` and INCONCLUSIVE. Its `judgeRecord` calls any other
reading a problem, and its rule decides only from measured table arms. It was written before the amendment, so a record
whose panel arm reads `missed` can't pass it on any program.

**Why the panel reads missed on the work:** the panel arm draws 100,000 rows of 8 columns through a panel's
`DataTable` in gpui-shell, pinned at gpui-kit `1676826d`. gpui-shell caps a component's data at 10,000 array items,
4,096 nodes and 1,024 object keys, so a panel's table holds at most 127 such rows, and it shows an error line instead.
The committed record, `docs/spikes/1477/record.json`, says so and decides build. Measuring the panel again so that it
reads `measured` would need those caps raised in the upstream crate. With kit at 2.311 ms p99 net of the blank arm, a
measured panel within 4 ms would also turn the decision to stop, after ours was built.

## The failing output on the work

On main `212f16d09`, in PR #2795's runs, `record.test.ts` failed at its assertion:

```
#1477.e66d9bdb an arm left out reads INCONCLUSIVE and so does the decision; …
  this run's record: problems: expected [ …(2) ] to deeply equal []
```

Each draft's own `judgeRecord` was then run on the committed record at `197e759a9`, with no bench run. These are the
two problems the first draft finds:

```
first draft, word build, problems (2):
  - docs/spikes/1477/record.json: panel reads "missed", neither measured nor INCONCLUSIVE
  - docs/spikes/1477/record.json decides build though blank, kit and panel didn't all run
redraft, word build, problems (0); missed: panel (the panel's table drew no rows: gpui-shell refuses its 100,000
  rows of 8 columns …)
```

## The blind redraft

`record.test.ts` beside this file holds one test, for #1477.e66d9bdb. The same job wrote it blind (`90b7cfc7b`) from
issue #1477 as amended, the design, `docs/canvas-primitives.md`, base `dd83ac2f` and the first draft (`README.md`
here). Neither draft was edited.

On the work, the redraft's record checks find no problems, and it decides build. Its timed readings read INCONCLUSIVE
by the lane's rule under load (PR #1748, PR #2795). It reads PASS only on a quiet reference Mac.

| Criterion | First draft (disputed) | Blind redraft |
|---|---|---|
| `#1477.e66d9bdb` | `../record.test.ts`, its first test | `record.test.ts` (1 test) |

## The ruling

The owner ruled in the session on Nov 20, 2026: "Yes, swap it". The redraft proves #1477.e66d9bdb.

The lanes work by file, so the first draft's `record.test.ts` is kept as written and runs by hand only
(`scripts/lanes.mjs`). Its four other tests run by hand with it: #1477.46aa3ab4, #1477.466ab542, #1477.af9cb943 and
#1477.55753e50. The same change (#2806) removes the waiver in `scripts/known-failures.json` that covered the first
draft's failure.

## What the swap leaves

`tests/acceptance/2569/main.test.ts` (#2569.97a55309) runs `node scripts/affected.mjs --timed` on #1477's three files.
It needs every one of their 14 tests either passed or printed KNOWN. With `record.test.ts` by hand, five of those
tests don't run there, so at most 9 of 14 pass, and that test fails by count. It isn't edited: only its own blind
job can redraft it.
