# Twins for the 2316 tests

Every tagged test in this suite passes on the base (`2eaaeb0e6`), so the base can't show any of them failing
(`../README.md`, "What the base does"). `../twins.json` names a wrong program for each criterion, and on each the
criterion's tests fail at their assertion (`../BASE-FAILURE.txt`, sections 2 to 4).

| Criterion | Twin | The wrong program |
|---|---|---|
| `#2316.b2850c01` (AC1) | `sync-reads-every-event` | The one the issue describes: `Buyer.sync()` pages through `record.read({ after: cursor, limit: 1000 })` with no kinds filter, decoding every event since the last `buy()` and keeping only `card_rule.set`, its cursor the last row read. A whole copy of the base's `packages/buying/src/index.ts` with `sync()`'s `readSince(..., ['card_rule.set'], ...)` replaced by that loop and `readSince` dropped from the import. It still pays by the rules, so only the reads tell it apart: the 10,000 tool events are handed back while `buy()` runs |
| `#2316.b2850c01` (AC1) | `sync-cursor-at-last-rule` | Half a fix: `sync()` reads with `kinds: ['card_rule.set']`, but its cursor is the last `card_rule.set` row it read, never the log head, so each purchase seeks from the old rule again. The same file with `sync()` as a `record.read({ after, limit: 1000, kinds: ['card_rule.set'] })` loop. The next purchase's read starts at log position 2, before the 10,000 events |
| `#2316.e3f1d78c` (AC2) | `session-copies-every-transcript` | A narrowing that loses the session: `archive.session()` copies every transcript the walk finds, as `pass()` does. A whole copy of the base's `packages/archive/src/index.ts` with `session(id)`'s filter on `letters(source.session) === wanted` removed (and its unused `id`). The target is copied, so only "archives only the target session" (and the time, once 2,000 copies are made) tells it apart |

The blind job wrote them with the tests, from the base. Each was laid over an APFS clone of the base checkout
(`cp -cR`), its package type-checked (`tsc -p packages/<pkg>/tsconfig.json --noEmit`, exit 0) and the criterion's
tests run with `-t '<tag>'`.

Each is a whole file of the base, so laid over the change it also takes the change out of that file. If the change
moves `sync()` out of `packages/buying/src/index.ts` or `session()` out of `packages/archive/src/index.ts`, or the
base's file no longer builds beside the change's other files, plant the same reading in the change's own file and
replace the twin; the tests stay as they are.
