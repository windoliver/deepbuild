# Dispute under #3221: `refill.test.mjs` (#2848's criterion) and `tests/jobserver-blind.test.mjs`

#3221 takes away the jobserver each `affected.mjs` run made for itself (#2741). Each job of an admitted run now takes a
turn on the machine's pool of job tokens, a core less one, and its cargo draws on a pipe of the job's own that the pool
lends to (`docs/parallel-proof.md`, sections 6 and 7a). This test was written for the run's own pipe, so it fails on
the right program at a precondition, before it reads a count. Run on #3221's change:

```
two jobs of the run running at once were handed different jobservers (<tmp>/deep-turn-…/tokens, <tmp>/deep-turn-…/tokens), not one of the run's
the machine's cores: 18; the run's share: 17 tokens (no shards)
```

Its share is also the old one: `cores - 1` for the run, where a lone job's share on the pool is the pool less its own
turn.

#2848's criterion still holds under #3221, read for a job's pipe, so it went to a blind redraft that runs in this
test's place: `tests/acceptance/2848-redraft-3221/`. On the change it passes: the later job's pipe was lent 11 tokens,
its share on a pool of 12, after a client holding 3 was SIGKILLed in an earlier job, and the run read PASS.

`tests/jobserver-blind.test.mjs` runs this test's scenario with a `fuser` that sees nothing, to prove the run's refill
path (#2848's fix), which #3221 removes with the run's pipe. On the change it fails the same way.

Both move to the by-hand list (`scripts/lanes-lists.mjs`) until the owner rules on the swap.
