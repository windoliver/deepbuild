# Dispute under #3694: `inherited.test.mjs` (#3238's tests whose scene held a plain test request on the load or off the pool)

#3694 admits a `test` request from a chain under no grant that isn't an `affected.mjs` run's as a run is, by the test
ceiling and the memory rule but not the load, and has it take a turn on the machine's pool as a run of one job, as #3549
made builds do (`docs/parallel-proof.md`, sections 6 and 13). Its command starts only once it holds a token of the
pool, which on a test's own table is the readings' cores less one, at least one.

Its readings give a pool of one token, which a build holder takes; the plain test grant the lease command runs under
then waits for a token, so its command, and the lease command under it, never start on the right program:

```
#3238.664c776d the job `node stub.mjs repo-rules-lint` didn't start at once under its run's test grant: nothing happened in 3 min
```

The criterion still holds under #3694, read with a pool that leaves the test grant a token.

Each file once with `node --test`, no throttle grant (the owner's word for 2026-11-27, relayed by the parent session),
one at a time, on the Mac (18 cores):

- on #3694's change: 0 pass, 1 fail (14:30:23Z–14:33:24Z), at a 1-minute load of about 90;
- on the merge base 894a293f2: 1 pass (14:45:46Z–14:45:48Z), at a load of 110.

The blind redraft that runs in this file's place is `tests/acceptance/3238-redraft-3694/` (its `REDRAFT.md` says what each test
keeps and what changed). Each file of it once, on #3694's change, no grant: every test passes (see the PR). The original
files move to the by-hand list (`scripts/lanes-lists.mjs`) until the owner rules on the swap.
