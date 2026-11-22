# Parallel proof

A planted wrong program for #1111.bded4607 (tests/acceptance/1111-redraft-2047): every heading the T0–T10 issues link is here, but Budget windows gives no reading rule. It has the criteria reworded instead, which the issue rules out.

## 3. Placement: what runs where

Budgets, timing checks and GPU work run on the reference Mac; heavy test lanes run on the Spark.

## 4. Build reuse: fixed-path workspaces, not relocated targets

Bays are fixed-path proof workspaces that stay warm between runs.

## 5. Proof-run cost cuts inside one run

One build per run, and binaries built once for its tests.

## 6. Scheduling: a per-machine throttle table

One table per machine grants build, test and timed work.

## 7. The `alone` block, split by reason

A test stays alone only for a reason the list names.

## 8. Remote lanes

A lane may run on the Spark and is merged per test with the Mac's run.

## 9. Hygiene (do first, no design needed)

Old targets and caches are cleared before any tooling change.

## 10. Issue shaping

One issue per step.

### 10a. Open owner decision (gates T9)

Whether a skipped test blocks a change.

## 12. Rollout, and proof of each step

Each step lands with one criterion.

### 12a. Budget windows (owner decision 2026-11-02)

Budgets are measured in scheduled budget windows on the reference Mac, one record per merged commit.

An existing budget criterion that says "in the local preflight" is reworded to say "in the scheduled budget window", issue by issue.
