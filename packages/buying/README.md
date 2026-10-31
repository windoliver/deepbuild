# @deepbuild/buying

## What it is for

Buying within a budget you approved (#69, with the money extensions). A purchase reserves its price in the #86 ledger before anything is paid, one past what's left asks you as an authority ask, and payment is a task for you or a card rule you set for one seller, paid by the payment processor. Its receipt is kept as evidence and charges the budget.

## Where new code goes

- `src/index.ts`: the whole package (`openBuying`). DeepBuild never stores or sees a card number: a rule names the processor's reference, text carrying a number is refused, and a receipt's numbers are masked to their last four digits. New code keeps all three.
- Reservations and charges go through the `Ledger` from `@deepbuild/budget`, never a ledger of its own.
- Tests: none in this package; the acceptance suite is `tests/acceptance/69/`.

## What it may import

Extension layer. It reaches `@deepbuild/asks`, `@deepbuild/budget`, `@deepbuild/contracts` and `@deepbuild/record` through their package entries. The processor is handed in (`Processor`); it never imports a payment SDK, the hub, the CLI or the app.

## Deviations

None.
