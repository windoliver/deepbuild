# @deepbuild/budget

## What it is for

The kernel's Budget (#86): the one ledger of the spending you approved. A paid run reserves its price against every budget that covers it before it starts, and is charged when its cost reading lands; a run that doesn't fit, or whose price nobody knows, is BLOCKED. The runner, the hub, buying and resolver-decisions call `openLedger`.

## Where new code goes

- `src/index.ts`: the whole ledger. Each method reads what the log gained, then decides and appends with no await between that read and the append; price lookups run before the decision. Keep that order.
- Your yes reaches it only as the asks core's answer: new approval paths go through `@deepbuild/asks`, not a method here.
- Purchases are `@deepbuild/buying`'s, not this package's.
- Tests: `test/` for rules beyond the acceptance suite in `tests/acceptance/86/`.

## What it may import

Kernel layer, beside the asks core. It reaches `@deepbuild/asks`, `@deepbuild/contracts` and `@deepbuild/record` through their package entries. It never imports `@deepbuild/buying`, another extension, the hub, the CLI or the app.

## Deviations

None.
