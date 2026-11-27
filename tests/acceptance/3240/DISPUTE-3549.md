# Dispute under #3549: `line.test.mjs` (#3240's line criterion)

#3549 makes the `build` number of `scripts/throttle.mjs` a ceiling, 4 on the Mac and 6 on the Spark, where it was a
fixed limit of 1 and 2: a build asked for under no grant is admitted while fewer than the ceiling are held, then takes
a turn on the machine's pool (`docs/parallel-proof.md`, sections 6 and 13). This test fills the build class with the
old number, in the test itself, one holder for "the Mac's build limit is 1", so on the right program the class isn't full and the scene fails before it reads what
its criterion asks. Run on #3549's change, where main without it passes:

```
#3240.f0d5ecc3: the second build request was granted beside the held one
```

The criterion still holds under #3549, read with the class full: the spinning grant and an idle holder for each other slot.

The blind redraft that runs in this file's place is `tests/acceptance/3240-redraft-3549/`. It reads the count from the
`LIMITS` line of `scripts/throttle.mjs`, as #2833's redraft of #1113 read `test`, so it holds the old count on main
and the ceiling under #3549. Each file once, under one test grant:

- `3240-redraft-3549/line.test.mjs`: on the change 1 pass, 0 fail; on main without it 1 pass, 0 fail.

The original file moves to the by-hand list (`scripts/lanes-lists.mjs`) until the owner rules on the swap.
