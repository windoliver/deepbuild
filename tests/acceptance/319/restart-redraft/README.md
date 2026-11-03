# #319, the hub stopped across a batch time (blind redraft)

The criterion, from the issue:

> With the hub stopped across a batch time, each open ask whose deadline comes before the next batch shows in Needs you within 5 s of the hub's start; a hub that waits for the next batch fails this test, naming the ask.

This job saw only issue #319 (its parent #22 and epic #2, only to keep their scope out), the design and commit a7e140b2. It didn't read the other files in `tests/acceptance/319/`.

## What I read

- `docs/technical-design.md`:
  - "An ask, and your answer getting back": asks come in batches, and an ask whose deadline would pass before the next batch shows at once.
  - Lifecycles, and `ask.machine@1`'s states (queued, shown and the rest).
  - The `done.yaml` block, `asks:` (deadline per kind, definition `4h`), and the paragraph after it: your own values are drafted at setup into `~/.deepbuild/config.json`.
  - Timing relations, "Asks and batches": the hub checks every open ask again when it starts, since a batch can pass while it's down.
  - Decided, "Ask deadlines and defaults".
- `@deepbuild/asks` through `packages/asks/src/index.ts`: `draftAskSettings`, `openAsks`, `askSources`, `duration`, `needsYou`, `inbox`. The drafted batches run every 8 h (00:00, 08:00 and 16:00 UTC) with a cap of 20 asks a day.
- `@deepbuild/record` through its public entry: `openRecord` and `Connection`.
- `packages/hub/src/core.ts`, only for how the hub starts and stops. Its `init` opens the record on the ledger, then `openAsks({ record, now, deliver, home: <root dir> })`. Its stop clears its timers and closes the record. Its once-a-second beat ticks the asks core only once a deadline has passed (or a stop or verdict lands).

## Surface

The real components, with no mocks:

- A real SQLite record in a temp folder.
- The asks core opened over that record.
- `config.json`, drafted by `draftAskSettings` in the same folder.
- A virtual clock as `now`.

"Shows in Needs you" means the ask's handle is among the cards `needsYou()` returns.

## Choices that are mine

- **The hub's start** (`hub.ts`, `startHub`) is what `core.ts` does for asks: `openRecord` on `<home>/ledger.db`, then `openAsks` with `home`. I left out the hub's every-second beat. While nothing has passed its deadline, that beat never ticks the core, so the start itself has to show these asks.
- **The hub's stop** closes the record. While the hub is down nothing reads or writes the record, and the virtual clock jumps forward.
- **The 5 s** is real time. It runs from just before the record opens until the ask's card is in `needsYou()`, polled every 50 ms. The virtual clock stays at the start time during those 5 s.
- **The scenario.** UTC, on 2030-03-04, with the drafted batches:
  - At 12:30 two asks are filed that wait for the 16:00 batch:
    - an early question about done (`definition.draft`), whose deadline is your drafted 4 h, so 16:30;
    - a taste call (`deep_ask.taste`) raised with a 22:00 deadline.
  - The test checks that both are `queued` and not in Needs you.
  - The hub stops at 12:35 and starts again at 16:10, after the 16:00 batch. The next batch is then 00:00, and both deadlines come before it.
- **Two cases:**
  - There is still room in the day's cap.
  - The day's cap of 20 is already used up by 20 asks shown in the 08:00 batch. Here the missed 16:00 batch can't show the two asks, so only the start-time check can. A probe confirmed they show through a `now:` showing, not the `batch:16:00` one.
- **The plant** (`waits-for-next-batch`) starts the same way, but drives the asks core only once the virtual clock reaches the next batch time after its start. It checks once a second, like the hub's beat. Until then its Needs you is empty.

## How to run

From the repo root, on Node 24.22, after `npm ci` and `npm run build -w @deepbuild/contracts -w @deepbuild/evidence -w @deepbuild/record -w @deepbuild/config-eval`:

```
node node_modules/vitest/vitest.mjs run tests/acceptance/319/restart-redraft
npx tsc -p tests/acceptance/319/restart-redraft
```

The suite has four tests:

- Two run the criterion against the hub. They pass when each due ask is in Needs you within 5 s.
- Two run it against the plant. They pass when the plant misses each due ask and the failure line names that ask's handle.

To see the plant fail the criterion's own tests, run:

```
DEEP_319_PLANT=waits-for-next-batch node node_modules/vitest/vitest.mjs run tests/acceptance/319/restart-redraft
```

`BASE-FAILURE.txt` holds both runs at a7e140b2. The criterion passes at this commit (the asks core already carries #319). The plant fails, naming each ask.
