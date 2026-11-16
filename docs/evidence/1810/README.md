# #1810 evidence

`final-13a35ce37/`: `tests/acceptance/1810` on the Mac (Mac15,12, macOS 27.2.1), in a GitHub-only fresh clone at 13a35ce37. That is the final code head; this folder is the only change after it.

- Setup exit 0: `npm ci`, the workspace build, `deep-hook`, and `deep-drive` prebuilt.
- 12 of 13 tests pass, including both `count.test.ts` tests (#1810.eebcb4a2, the replica's list on macOS among them), `defaulted.test.ts` (#1810.a646c123) and `width.test.ts` (#1810.1a3e8cda).
- The one failure is the blind redraft `redraft-replica/list.test.ts`, with one line: the open ask's row node "lacks its word "needs you"". The app draws the ask's kind there (#1461 AC27), while the hub's row says "needs you". That mismatch is #2690. Under the design's Dogfooding rule the first draft stands, since the redraft also fails on the work.
- After the run the clone's working tree was clean, and the secret scan found nothing.
