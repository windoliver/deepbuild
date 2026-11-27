# Dispute under #3694: `test-grants.test.mjs`, `blocked.test.mjs` and `log.test.mjs` (#2924's tests whose scene held a plain test request on the load or off the pool)

#3694 admits a `test` request from a chain under no grant that isn't an `affected.mjs` run's as a run is, by the test
ceiling and the memory rule but not the load, and has it take a turn on the machine's pool as a run of one job, as #3549
made builds do (`docs/parallel-proof.md`, sections 6 and 13). Its command starts only once it holds a token of the
pool, which on a test's own table is the readings' cores less one, at least one.

These tests make a second plain test request wait on the load, beside one held test grant, then read what the criterion
asks. Under #3694 that request is granted at that load, so on the right program the scene fails before its criterion is
read:

```
#2924.AC2 with one test grant held, a second request waits while the readings show load equal to the cores
#2924.AC3 a request waiting on load is granted without a restart once its readings file is rewritten to allow it
#2924.AC5 a readings file rewritten to not-JSON while a request waits is BLOCKED throttle at the next read, exit 2
  second's command started while the readings show load 100 on 8 cores
#2924.AC6 each test grant's granted entry carries the readings it was decided on, the rewritten ones for a request that waited
  second's command started while the readings show load 9 on 8 cores
```

AC5 and AC6 still hold under #3694, read with a request that waits on memory. AC2's and AC3's load clause for a second
plain test request is what #3694 replaces: #3694's first criterion (granted at load 57 on 18 cores) and second (its
command waits for a free token) now say what such a request does. The redraft keeps both tests' titles and expected
values with a scene that holds on both programs, and the swap of that clause needs the owner's ruling.

Each file once with `node --test`, no throttle grant (the owner's word for 2026-11-27, relayed by the parent session),
one at a time, on the Mac (18 cores):

- on #3694's change: `test-grants` 4 pass, 2 fail (14:26:50Z–14:27:29Z); `blocked` 5 pass, 1 fail (14:25:39Z–14:25:52Z);
  `log` 1 pass, 1 fail (14:26:15Z–14:26:24Z), at a 1-minute load of 76 to 80;
- on the merge base 894a293f2: `test-grants` 6 pass (14:44:53Z–14:45:27Z); `blocked` 6 pass (14:45:27Z–14:45:37Z);
  `log` 2 pass (14:45:38Z–14:45:46Z), at a load of 110 to 124.

The blind redraft that runs in this file's place is `tests/acceptance/2924-redraft-3694/` (its `REDRAFT.md` says what each test
keeps and what changed). Each file of it once, on #3694's change, no grant: every test passes (see the PR). The original
files move to the by-hand list (`scripts/lanes-lists.mjs`) until the owner rules on the swap.
