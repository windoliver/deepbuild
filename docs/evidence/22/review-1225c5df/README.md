# #22: the sixth review, of the final diff at 1225c5df1, and its two fixes

A fresh agent, not shown the earlier rounds or this folder, read `git diff b10b51f8a 1225c5df1` (outside
`docs/evidence`) without building or running anything. Two findings were real and are fixed here.

1. **A refused answer still saved its decision.** `answer()` appends `ask.answered` and the decision it saves in one
   turn (one FULL commit). `ask.answered@6` caps `words` and `token` at 8192 characters and `answer()` checked only that
   they were non-empty, so words over the cap made the record refuse the answer while `decision.created` still
   committed: the ask stayed open, yet later asks of its key were answered by it. On main the answer is appended first,
   so its refusal saves nothing. The PR's earlier disclosure ("no test can force the refusal") was wrong.
   - `failing-first-refused.txt`: the new asks test before the fix; a `decision.created` is in the record.
   - Fix (`packages/asks/src/index.ts`): `answer()` refuses `words` or a `token` over 8192 characters before anything
     is appended. `passing-refused.txt`: the asks package, 83 of 83.
2. **The hub's batch-time test could pass without `batchDue()`.** Main's once-a-minute look for an ask with no batch
   (#1345, merged in after the test was written) fires 60 s after the hub starts; the test started the hub up to 30 s
   into a minute, so a start in a minute's first seconds put that look inside the test's 5 s window.
   - Fix (`packages/hub/test/asleep.test.ts`): the test starts 30 to 50 s before the batch, so the look comes at least
     10 s after it.
   - `mutant-no-batchdue.txt`: the test against the hub's beat with `batchDue()` taken out of `due()`: it fails on its
     assertion (no batch shown within 5 s). `passing-batch-pinned.txt`: it passes on the real hub.

Disclosed, not changed:
- A record conflict or storage failure on the answer alone can still leave the decision saved or reject both; after a
  rejected answer `saveAt()`'s own sync may still be running when the next caller syncs.
- The app fills a session's thread only from `session.start` events it applied; for a session started before its
  window it keys the fold on the session ID, where the core keys on the thread, until a `row.set` or a re-read corrects it.
- The app's count fold is fixed at five and ignores the `fold` setting (as on main); with a higher setting a sixth ask
  reads folded with no exception.
- At each batch time the beat runs one tick even with nothing waiting, beside #1345's once-a-minute look.

`guard-1225c5df1.txt`: `node scripts/proof.mjs guard` at 1225c5df1 passes, 79 commits. The full `affected.mjs` run at
1225c5df1 (affected-22-17: isolated HOME, so outside the shared throttle table, and MemoryMax=32G) was stopped with no
results when this review landed: INCONCLUSIVE, superseded by the run at the fixed head.
