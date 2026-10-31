# @deepbuild/resolver-decisions

## What it is for

The first-party resolver that ships on by default (#23): it answers an ask only by naming a saved decision that covers it by kind and scope, never by wording, and answers a paid run's request by naming a budget you approved. The asks core gates every answer it gives; the hub registers it.

## Where new code goes

- `src/index.ts`: finding the covering decisions and budgets in the record.
- `src/rules.ts`: standing rules judged by what later broke.
- `fixtures/keys.json`: the design's key fixture file, pairs per kind that must share a key and near-misses that must not.
- There is no `test/` folder: its tests are the acceptance suite in `tests/acceptance/23`, which is never edited.

## What it may import

A first-party extension on the core: only `@deepbuild/asks`, `@deepbuild/budget` and `@deepbuild/record`, through public entries. It never imports the hub, CLI or app, and never applies an answer itself.

## Deviations

None.
