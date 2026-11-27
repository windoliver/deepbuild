# Dispute under #3694: `passes.test.mjs`, `timed.test.mjs` and `window.test.mjs` (#3549's tests whose scene held a plain test request on the load or off the pool)

#3694 admits a `test` request from a chain under no grant that isn't an `affected.mjs` run's as a run is, by the test
ceiling and the memory rule but not the load, and has it take a turn on the machine's pool as a run of one job, as #3549
made builds do (`docs/parallel-proof.md`, sections 6 and 13). Its command starts only once it holds a token of the
pool, which on a test's own table is the readings' cores less one, at least one.

These scenes hold every token of the pool with builds beside plain test grants, and need those grants' commands
running. Under #3694 each plain test grant's command waits for a token of its own, so on the right program the scene
never forms:

```
#3549.c607aa63 no build request was refused: 3 builds are held at once on a table whose ceiling is 4, so starting at once shows nothing
#3549.7ba8246d (timed, second) the build that holds the pool's token, or one of the two test grants' commands, never started
#3549.7ba8246d (window, second) the build that holds the pool's token, or the test grant's command, never started
#3549.7ba8246d (window, third) the build that holds the pool's token, or the test grant's holder, never started
```

Both criteria still hold under #3694, read with a pool that gives each plain test grant its token first.

Each file once with `node --test`, no throttle grant (the owner's word for 2026-11-27, relayed by the parent session),
one at a time, on the Mac (18 cores):

- on #3694's change: `passes` 1 pass, 1 fail (14:33:39Z–14:35:42Z); `timed` 1 pass, 1 fail (14:35:42Z–14:37:46Z);
  `window` 1 pass, 2 fail (14:37:46Z–14:41:53Z), at a 1-minute load of about 90;
- on the merge base 894a293f2: `passes` 2 pass (14:45:48Z–14:45:53Z); `timed` 2 pass (14:45:53Z–14:45:58Z); `window`
  3 pass (14:45:58Z–14:46:22Z), at a load of 91 to 110.

The blind redraft that runs in this file's place is `tests/acceptance/3549-redraft-3694/` (its `REDRAFT.md` says what each test
keeps and what changed). Each file of it once, on #3694's change, no grant: every test passes (see the PR). The original
files move to the by-hand list (`scripts/lanes-lists.mjs`) until the owner rules on the swap.
