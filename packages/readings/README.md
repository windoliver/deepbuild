# @deepbuild/readings

## What it is for

The readings (#45): your time, agent spend and lifecycle numbers, each with its source, its age and whether it was observed or modeled, so Decision 1 can be judged. Pure folds over the record's events and the agents' transcripts: held time per stop, turn and session by reason against the fast-lane budget, what the budget costs, stale runs and loop holds, tokens and cost by each agent's counting rules, billing mode and plan-window tokens, the classifiers checked against your labelled sample, the pilot baseline recomputed from archived transcripts, and lifecycle numbers from a forge's merged pull requests. The hub feeds it the record and serves `numbers.read`, `deep numbers` and `deep_search` over it.

## Where new code goes

- `src/index.ts` is exactly `export * from './impl.js'`, the seam the blind suite's twins replace; `src/impl.ts` re-exports the files below. The hub and the CLI import only through the package's entry.
- `src/record.ts`: the folds over the record's events, a session at a time, and the incremental `update`.
- `src/usage.ts`: tokens and cost from Claude Code transcripts, the shipped rate card and the live `UsageTail`.
- `src/classify.ts`: the classifiers and their check against a labelled sample; `src/baseline.ts`: the baseline recompute; `src/panel.ts`: panel rows, freshness and search; `src/lifecycle.ts`: numbers from merged pull requests; `src/types.ts`: the shared shapes.
- Tests: `test/`; the blind acceptance suites are `tests/acceptance/45/` and `tests/acceptance/45-redraft/`.

## What it may import

Core foundation: `node:` built-ins only, no workspace package. It never imports the record, the hub, an extension, the CLI or the app; the hub imports it.

## Deviations

None.
