# @deepbuild/asks

## What it is for

The asks core (#318): an ask is raised only from a place in ask.sources@1, holds to ask.created, and ends answered on the trusted path, superseded, moot or defaulted at its deadline. It also decides when an ask shows (#319), gates resolvers (#349) and keys decisions by kind and scope (#23). The budget, buying, supervisor, runner, resolver-decisions, extension host, archive, routing replay and hub raise and answer asks through it.

## Where new code goes

- `src/index.ts`: the public entry, record fold and core wiring. Each method first reads what the log gained, then appends what that state calls for; it keeps the exclusive boundary around both.
- `src/resolver-gate.ts`: resolver registration, refusals and answer gating. Its options are the plant, decision lookup, coverage check, recorded application and delivery. Collection runs outside the core's lock; acceptance runs after a fresh read under it.
- `src/showing.ts`: showing, folding, shared cards and batch rules, with the record-derived batch indexes. Its options are ask lookup, open asks, thread's open asks, clock, schedule and batch append. Appending each identity's batch precedes the next log read, as before.
- `src/decision-keys.ts`: structured keys, scopes, bounds, suggestions and target-origin exclusions. Its options are session lookup, decisions by key and near key, and the plant.
- `src/model.ts`: shared data and public types, reexported by `index.ts`; no seam imports the entry, even for types.
- `sources.json`: the ask.sources@1 table. A new place that raises asks gets a row here, with its kind and a fixture, or it can't raise one.
- Tests: `test/` for rules beyond the acceptance suites in `tests/acceptance/318/` and `tests/acceptance/319/`.

## What it may import

Core layer. It reaches `@deepbuild/contracts` and `@deepbuild/record` through their package entries, plus `@deepbuild/adapters` (the shipped adapters' `errorTurnHook` cap, which decides whether a block's automatic continue can reach a session) and `node:` built-ins. It never imports an extension, the hub, the CLI or the app, and no resolver decides inside it: the gate stays here.

## Deviations

- `sources.json`: the ask.sources@1 table kept as data beside the package and read at runtime by `askSources()`, not code in `src/`.
