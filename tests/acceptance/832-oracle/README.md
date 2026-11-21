# Acceptance tests for #832, Oracle lane: the exact binomial interval against upstream rows

Written first, blind, at base commit cfc1e6a71, from issue #832, its Oracle page (as the brief gave it) and the design
(`docs/canvas-primitives.md`: Check input: catalog kinds, As built (#832)), by the job that wrote
`tests/acceptance/832/`, which never saw an implementation; none existed. #136's rule applies: a linked test counts only
when run against our output, so every upstream row here is asserted against what our `binomialInterval` answers. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

Scope: criteria 1 and 2 (#832.d6fbcd45, #832.c07dc2c3), the two the Oracle page links one upstream test to; each test
carries both IDs. The planted card, the limit and INCONCLUSIVE on a straddling interval are ours and stay with
`tests/acceptance/832/`. Criterion 3 (#832.d550c82e) has no upstream test: pairing on one seed with a row's offers off,
and its replays, are our playtest rules.

## Source

| Criteria | Upstream, pinned | What | Use |
|---|---|---|---|
| 1, 2 | an upstream statistics library's binomial-test tests at commit e4e854eaa8 (e4e854eaa8f18d807cd3496028e257e36caa93cc) | its two-sided exact (Clopper–Pearson) interval rows, whose expected values come from a reference statistics environment's exact binomial test | port |

No upstream code is copied. The four rows, with the upstream test's own tolerances, are copied into `binomial.test.ts`:

| k | n | confidence | low | high | tolerance (relative) |
|---|---|---|---|---|---|
| 20 | 100 | 0.95 | 0.1266555521019559 | 0.2918426890886281 | 1e-12 |
| 3 | 50 | 0.99 | 0.006872485 | 0.202706269 | 1e-6 |
| 0 | 10 | 0.95 | exactly 0 | 0.3084971 | 1e-6 |
| 10 | 10 | 0.95 | 0.6915029 | exactly 1 | 1e-6 |

The same upstream tests also hold one-sided intervals and other methods; those aren't ours.

## Run

```sh
node scripts/throttle.mjs build --wait 240 -- npm ci --no-audit --no-fund     # once, in a fresh worktree
node scripts/throttle.mjs build --wait 240 -- npm run build --workspaces      # once
NO_COLOR=1 npx vitest run --root tests/acceptance/832-oracle --testTimeout=600000
npx tsc -p tests/acceptance/832-oracle/tsconfig.json
rm -rf tests/acceptance/832-oracle/node_modules/.vite
```

It builds nothing, starts nothing and runs in well under a second; it needs no `scripts/lanes.mjs` entry.

## The surface under test

`binomialInterval(k, n, confidence = 0.95)`, which the design names as exported from
`packages/checks/catalog/dominance.ts` and answering the exact two-sided interval [lo, hi] for any confidence in (0, 1).
Read here as an array of two numbers. Each row's test calls it with the row's confidence, and the 0.95 rows also call
it without one, which must answer the same.

## Wrong programs it fails

A normal-approximation or Wilson interval; one-sided ends, or α in place of α/2; Beta(k, n − k) below or Beta(k + 1,
n − k − 1) above in place of the exact interval's Beta(k, n − k + 1) and Beta(k + 1, n − k); the confidence read as α;
an end at k = 0 or k = n clamped short of 0 or 1, or left NaN; a default confidence other than 0.95.

## Files

`README.md`, `BASE-FAILURE.txt`, `tsconfig.json`, `binomial.test.ts`.
