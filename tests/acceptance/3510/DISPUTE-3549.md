# Dispute under #3549: `stalled-line.test.mjs`, `drain.test.mjs` and `under-grant.test.mjs`

#3549 makes the `build` number of `scripts/throttle.mjs` a ceiling, 4 on the Mac and 6 on the Spark, where it was a
fixed limit of 1 and 2: a build asked for under no grant is admitted while fewer than the ceiling are held, then takes
a turn on the machine's pool (`docs/parallel-proof.md`, sections 6 and 13, "Builds on the pool"). These tests fill the
build class with the old number, `SLOTS` from `tests/acceptance/3334/helpers.mjs` (1 Mac, 2 Linux), so on a right
program the class isn't full: the call is admitted at once and the scene fails before it reads what its criterion
asks. On a merged tree:

```
#3510.773f906e: the call got its build grant after the timed request ended
#3510.9618ba88: the call returns nothing: it got no grant
```

`under-grant.test.mjs` (#3510.87170af2) still passes there, but its scene no longer holds every build slot (it holds
`SLOTS`, 2 of 6), so it no longer proves what its criterion states; it is redrafted with the other two.

All three criteria still hold under #3549, read with every build slot of the ceiling held. The blind redraft that runs
in these files' place is `tests/acceptance/3510-redraft-3549/`; it reads the count from the `LIMITS` line through
`buildLimit()` of `tests/acceptance/3334-redraft-3549/helpers.mjs`, as #3334's redraft does. Its REDRAFT.md has the
table and the runs. The original files are not edited; they move to the by-hand list (`scripts/lanes-lists.mjs`) once
the owner approves the swap.
