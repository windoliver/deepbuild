# Acceptance tests for #2649: what a sandboxed run costs in process starts

Drafted blind from issue #2649, `docs/technical-design.md` and base commit `b4a2049e8` (origin/main), by a job that saw no implementation. The implementing agent doesn't edit these files; a dispute goes to a blind redraft.

Run: `node --test tests/acceptance/2649/` (Node 24, no build, no network, nothing runs a sandbox). `validator.test.mjs` plants a fault per rule in a synthetic spike, so the checks fail on a wrong spike (the "wrong program" for a docs spike).

## The surface (my choice: the issue names only "a table under docs/spikes/" and "the measuring commands and their output, kept with the spike")

Per invariant 1, an agent's word is no evidence, so the tests recompute every reading from raw output kept beside the record. All paths are under `docs/spikes/2649/`:

- `README.md`: the human-readable table. Checked only for existing and naming every row's `program` and `caller` (except `<root>`).
- `record.json`: the machine-readable table and readings (below).
- the raw files the record cites, named by the record, relative to the spike folder (no absolute paths, no `..`), each pinned by sha256.

### `record.json`

- `main`: full hash of the main commit the counter ran on. `counter.command`: the command that ran the perf lane's child counter.
- `subjects["command-check"]` and `subjects["idle-hour"]`: `{ log, sha256, totalStarts }` (idle also `durationSeconds`, at least 3600). `log` is the counter's raw log as `scripts/count-children.c` writes it (`start`, `reap`, `unread`, `exit` lines). Tests parse it and require `totalStarts` and the rows' counts to equal its `start` lines.
- `rows[]`: `{ subject, caller, program, count, instructions, unread, use, verdict }`. `caller` is the basename of the parent's path (from its `start` line), or `<root>` for the measured command itself; `program` is the child's basename. Tests recompute `count`, `instructions` (sum of the child's `reap`, else `exit`, instructions) and `unread` (children with neither) per subject, caller and program, and require every `start` to be in exactly one row. `verdict` is `needed`, `repeated` or `replaceable`. `repeated` needs `heldBy` (the earlier answer in the run that holds it); `replaceable` needs `replacement` and `change` (what a person or test would see change). `use` (what the answer is for) is required on every row, from the issue's Scope.
- `cuts[]` (empty if none was tried): `{ id, description, mergeBase, change, measurements }`, hashes full; `measurements` has `sandbox-setup`, `runner-job` and `command-check-count`, each `{ command, rounds }` with exactly 15 rounds `{ base, change, first }`: instructions each side (positive numbers) and which side ran first, which must alternate round to round.
- `latency`: `{ main, command, unit: "ms", samplesFile, samplesSha256, samples, p50, p95 }`. The samples file is JSON lines `{ pid, forkedAtMs, trackedAtMs }`; tests recompute each delta, the count, and p50 and p95 by nearest rank (smallest sample with at least p of them at or below it).
- `recommendation`: either `{ cuts: [{ cut, criterion }] }` (non-empty, each with a drafted criterion) or `{ none: true, reason }`; not both, not neither.

Not asserted, since the issue gives no number: any saving a cut must show, any sample count, any threshold on instructions or latency. That the figures were taken on an idle Mac, by the perf lane, is for the reviewer and the lane, not these files.

## Criteria to tests (`spike.test.mjs`)

AC1 table of every start, recomputed from the kept counter output (superseded, below); AC2 verdicts and what replaces and changes; AC3 cuts; AC4 latency; AC5 recommendation. Missing record, missing file, or a row with no count fails.

AC1's test is `redraft/ac1.test.mjs` by the user's ruling of 2026-11-20 ("Logged starts, gaps named"); the AC1 test is removed from `spike.test.mjs`.
