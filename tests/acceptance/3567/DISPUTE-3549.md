# Dispute under #3549: `grant.test.mjs` (#3567's fourth criterion, the build-grant test)

#3549 makes the `build` number of `scripts/throttle.mjs` a ceiling, 4 on the Mac and 6 on the Spark, where it was a
fixed limit of 1 and 2: a build asked for under no grant is admitted while fewer than the ceiling are held, then takes
a turn on the machine's pool (`docs/parallel-proof.md`, sections 6 and 13). This test fills the build class with the
old number, in the test itself, two neighbours, so on the right program the class isn't full and the scene fails before it reads what
its criterion asks. Run on #3549's change, where main without it passes:

```
#3567.f4411929: the run's summary doesn't read INCONCLUSIVE, waiting for its build grant, the first it asks for; affected.mjs: exit 3 1.8 s after its start
```

The criterion still holds under #3549, read with a neighbour for each build slot. The file's test-grant test passes on the change; the swap is by file, so it is carried into the redraft as it is.

The blind redraft that runs in this file's place is `tests/acceptance/3567-redraft-3549/`. It reads the count from the
`LIMITS` line of `scripts/throttle.mjs`, as #2833's redraft of #1113 read `test`, so it holds the old count on main
and the ceiling under #3549. Each file once, under one test grant:

- `3567-redraft-3549/grant.test.mjs`: on the change 2 pass, 0 fail; on main without it 2 pass, 0 fail.

The original file moves to the by-hand list (`scripts/lanes-lists.mjs`) until the owner rules on the swap.
