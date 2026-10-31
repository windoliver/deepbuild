# @deepbuild/asks

## What it is for

The asks core (#318): an ask is raised only from a place in ask.sources@1, holds to ask.created, and ends answered on the trusted path, superseded, moot or defaulted at its deadline. It also decides when an ask shows (#319), gates resolvers (#349) and keys decisions by kind and scope (#23). The budget, buying, supervisor, runner, resolver-decisions, extension host, archive and hub raise and answer asks through it.

## Where new code goes

- `src/index.ts`: the core. Its state is a function of the record: each method first reads what the log gained, then appends what that state calls for. New rules follow the same read-then-append order.
- `sources.json`: the ask.sources@1 table. A new place that raises asks gets a row here, with its kind and a fixture, or it can't raise one.
- Tests: `test/` for rules beyond the acceptance suites in `tests/acceptance/318/` and `tests/acceptance/319/`.

## What it may import

Core layer. It reaches `@deepbuild/contracts` and `@deepbuild/record` through their package entries, plus `node:` built-ins. It never imports an extension, the hub, the CLI or the app, and no resolver decides inside it: the gate stays here.

## Deviations

- `sources.json`: the ask.sources@1 table kept as data beside the package and read at runtime by `askSources()`, not code in `src/`.
