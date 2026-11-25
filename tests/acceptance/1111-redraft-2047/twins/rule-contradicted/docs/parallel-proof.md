# Parallel proof

A planted wrong program for #1111 (twin `rule-contradicted`), never a design: section 12a states the reading rule and section 12 still states the old one.

## 3. Placement: what runs where

Budgets, timing checks and GPU work run on the reference Mac. Heavy test lanes run on the Spark.

## 4. Build reuse: fixed-path workspaces, not relocated targets

A bay is a fixed-path proof workspace that stays warm between runs.

## 5. Proof run: cost cuts inside one run

One run builds once, and `npm ci` runs only when the lock file changes.

## 6. Scheduling: a per-machine throttle table

Each machine has one throttle table, and a timed test runs only under the timed grant.

## 7. The alone block, split by reason

A test stays in the `alone` block only for a reason the block names.

## 8. Remote lanes

A remote lane runs on the Spark and is merged per test with the Mac run of what the Spark can't run.

## 9. Hygiene (do first, no design needed)

Stale targets and temporary copies are cleared before any tooling change is measured.

## 10. Issue shaping

One issue per step, each with one criterion.

## 10a. Open owner decision gates T9

Two decisions are the owner's: whether a skipped test blocks, and where timed tests may run.

## 11. Invariants

Nothing missing or unrun passes.

## 12. Rollout and proof of each step

Each step lands with the one criterion that proves it. A budget criterion that says "in the local preflight" is met only by its benchmark's run in the local preflight of its change.

## 12a. Budget windows (owner decision 2026-11-02)

The scheduled budget window measures every merged commit on the reference Mac and records the result for that commit. An existing budget criterion that says "in the local preflight" is met by the scheduled budget window's record for its commit. Those criteria keep their text, so their IDs and the tests tagged with them stand.

## 13. Capacity

One reference Mac measures about one commit an hour.
