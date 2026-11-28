# Dispute under #3549: `bound.test.mjs` and `granted.test.mjs` (#3588's first and second criteria)

#3549 makes the `build` number of `scripts/throttle.mjs` a ceiling, 4 on the Mac and 6 on the Spark, where it was a
fixed limit of 1 and 2: a build asked for under no grant is admitted while fewer than the ceiling are held, then takes
a turn on the machine's pool (`docs/parallel-proof.md`, sections 6 and 13, "Builds on the pool"). Both tests take
"every build slot of the table" with the old number, `BUILD_SLOTS` of `tests/acceptance/2820/helpers.mjs`, which
`runScene` in `helpers.mjs` starts that many holders for. So on a right program the class isn't full: the rebuild
before the timed job is admitted at once beside the holders, and the scene fails before it reads what its criterion
asks. Run on a merged tree with #3549:

```
#3588.7a8aaa71 (bound.test.mjs): no INCONCLUSIVE line names the timed file tests/acceptance/1113/load.test.mjs with "not started: the run reached its bound of 3 min"
#3588.704a8c75 (granted.test.mjs): no build grant was granted to the run once the holders let go: nothing was built again of what the cleanup removed
```

Both criteria still hold under #3549, read with a holder for each build slot of the ceiling.

The blind redraft that runs in these files' place is `tests/acceptance/3588-redraft-3549/`. It reads the count from the
`LIMITS` line of `scripts/throttle.mjs` (`buildLimit()` of `tests/acceptance/2820-redraft-3549/helpers.mjs`), as
#3334's and #2820's redrafts under #3549 do, so it holds the ceiling. Each file once, on a throwaway right program
built from the issue's text: 2 pass, 0 fail; on the base `d303e2b64`, #3588.7a8aaa71 fails as it names and
#3588.704a8c75 passes. The details are in its `REDRAFT.md`.

The original files move to the by-hand list (`scripts/lanes-lists.mjs`) until the owner rules on the swap.
