# Blind redraft of the scenario helper (#427)

A fresh run of the blind acceptance job (design: Dogfooding), given the issue, the design, the base and the dispute's
criterion only. It never saw an implementation, a diff or the dispute's code.

## What was disputed

`helpers.ts`, `scenario(...)`, which every test reaches through `runShow`, `runLive`, `allDrawn` and `quietProblems`.
It puts #96's virtual clock (`clock: {refresh_hz: 60, lead: 0, check: 0}`) in every deep-show scenario but gives its
calls no `at`. #96's scenario surface (`tests/acceptance/96/README.md`, the `clock` bullet) says: "With `clock`, every
call carries `"at": flicks` (its arrival)". The base's parse (`crates/deep-show/src/main.rs`, the per-call `at` read
after the calls) refuses any call without `at` when `clock` is set, so `deep-show run` and `deep-show live` answer
`{"ok":false,"code":"bad_input"}` for every scenario the helper builds, before any call runs.

## What changed

Only `scenario(...)`. `helpers-redraft.ts` is `helpers.ts` with that one function's calls stamped with arrivals on the
same clock: call `i` gets `at: i × 10 frames` (one frame at 60 Hz is 11,760,000 flicks), unless it already carries
`at`. That is #140's `showScenario` spacing (`tests/acceptance/140/view/helpers.ts`), so the calls arrive in the order
the tests list them and replies stay in call order. The clock itself is kept, so a run still reads no wall time.

`deep-show live`'s `after` entries are unchanged: #140's surface (`tests/acceptance/140/view/README.md`, `after`) times
them by `after_ms`, and their `at` is optional (the base's `watch.rs` reads a missing one as 0 and never moves the
virtual clock back), so they already parse.

No other file changes: the suite sends only `deep_show` and `verdict` calls through `scenario`, and neither reads `at`
as anything but its arrival (only `deep_query`, `geometry` and `fn` use `arrives`).

## Why it keeps the criteria

Every assertion, expected value, fixture, planted program, criterion ID and judge is byte for byte the same. Whole
revisions from `deep_show` become current when their call runs, not at a latch, so spacing the arrivals changes nothing
the tests read: the revisions (1 to 13), the mode replies' `rev`, the snapshots, the `drawn` rows at the document time
`t` the calls name, and the live window's `showing`, `presented`, `wakeups` and `rung`.

## Adopting it

`helpers-redraft.ts` has the same exports as `helpers.ts`. It replaces `helpers.ts` (the test files import
`./helpers.ts`); that swap is the owner's call on the dispute, not this job's.

## Checked

- Typecheck: `node node_modules/typescript/bin/tsc -p tests/acceptance/427/tsconfig.json` passes with both files.
- Not run: no `deep-show` binary was built for this redraft, so the claim that the base now accepts the scenario rests
  on reading its parse (`main.rs`, the calls' `at`; `watch.rs`, the `after` entries' `at`), not on a run.
