# @deepbuild/verdicts

## What it is for

The verdict engine (#28): a claim's run records, coverage and definition become one of five verdicts, or pending, with run counts, open items, send-backs and the record's verdict rows, plus the one verdict line in the chat (#83). The gate runner and the hub call it.

## Where new code goes

- `src/engine.ts`: the rule table, pure, with every input (the time included) an argument; `src/types.ts`: its shapes.
- `src/runs.ts`: run counts; `src/conduct.ts`: a check runner's conformance; `src/contract.ts`: numeric contracts.
- `src/record.ts`: verdicts into the record, each a new `verdict.made` from the core; `src/line.ts`: the verdict line.
- Regression tests go in `test/`; acceptance tests live in `tests/acceptance/28`, `83` and `684` and are never edited.

## What it may import

Core: only `@deepbuild/record` and `node:` built-ins, through public entries. The gate stands on it, so it never imports the gate, an extension, or the hub, CLI or app.

## Deviations

- `model`: a Lean 4 model of the engine's verdict table with its proofs (#684), kept beside the code it models; the engine never imports it, and the generator in `Vectors.lean` ties the two together on seeded claims (`tests/acceptance/684`).
