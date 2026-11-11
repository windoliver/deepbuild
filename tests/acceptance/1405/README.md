# Acceptance tests for #1405: paired sign-flip tests judge instructions retired

These tests were drafted blind from issue #1405 (its text of November 10), `AGENTS.md` ("Proof"), `docs/technical-design.md` ("Dogfooding", "Every task carries its own budgets", "Proven on the base") and the base commit `de304b9ff`, which has no implementation. I also read that commit's `scripts/benchmark.mjs`, `scripts/perf.mjs`, `benchmarks/budgets.json` and `tests/acceptance/724/` and `1404/` as models. #1404's counter is out of scope. Per AGENTS.md, the implementing agent doesn't edit these. A dispute goes to a blind redraft by this job.

Run them with:

```
node --test 'tests/acceptance/1405/*.test.mjs'
```

Don't pass the folder: Node treats it as one test file. They need macOS, its `/usr/bin/time -l` and `cc`; off macOS each real-counter test fails as `BLOCKED`, never passes. `proof.test.mjs` also needs the four packages `verdict-1000-runs` imports built (`npm ci`, then `npm run build -w @deepbuild/<name>` for contracts, evidence, record and verdicts); without them it fails as `BLOCKED`, naming what's missing. The live files took 10 s to 6 minutes each on the base at load averages of 245 to 438 on this Mac's 18 cores (Mac17,10). `BASE-FAILURE.txt` has the base run.

## Surfaces

The issue names `judgeInstructions` and `measure` in `scripts/benchmark.mjs`, and leaves open how the seed goes in and what the result calls the seed and the two p values. I picked the smallest surface next to today's.

### `judgeInstructions(pairs, uncounted = [], seed)`

A third positional argument, `seed`, a number. When it is left out, as `judgeTask` calls it today, the function picks one itself. `pairs` and `uncounted` are as today: one `{ current, base }` per measured round, in round order. The result keeps `status`, `pairs`, `uncounted` and `reason`, and adds:

```js
{ seed,    // the seed the two tests used: the one passed in, or the one it picked
  pAbove,  // p value of the one-sided sign-flip test of "the change is above 2%"
  pBelow } // p value of the one-sided sign-flip test that rejects "the change is at least 2%"
```

- A pair's difference is `current / base - 1`. Both tests are on the 20 paired differences, against 2%.
- **FAIL** when `pAbove < 0.01`. **PASS** when `pBelow < 0.01`. **INCONCLUSIVE** otherwise. A missing count is still INCONCLUSIVE, as #724 and #1404 fixed; what the two p values hold then isn't tested.
- The same pairs and the same seed give a deep-equal result, p values included, every time. A result judged with no seed carries the seed it used, and judging the same pairs with that seed gives the same result.
- `change`, `spread` and `margin` aren't tested. The margin, max(2%, spread), is what the issue removes.

### `measure(command, cwd, base)`

Signature and return as today: `[current, base]`, each with `instructions`, one count per measured round in round order. Each round runs each side once and swaps which side runs first; the 20 measured rounds are the last 20 a run makes, after any warm-up.

## Criteria, tests and expected values

| Criterion | Test (file: name) | Expected | On the base |
|---|---|---|---|
| 19 pairs at +15% and 1 at −5% read FAIL; on main they read PASS | judge: *19 pairs at +15% and 1 at -5% read FAIL* | `status` FAIL, `pAbove` < 0.01 | fails: reads PASS (margin 20%) |
| 20 pairs within ±0.5% read PASS | judge: *20 pairs within ±0.5% read PASS* | `status` PASS | passes (guard; mutants below) |
| 19 pairs at +0.1% and 1 at +30% don't read FAIL | judge: *19 pairs at +0.1% and 1 at +30% don't read FAIL* | `status` PASS or INCONCLUSIVE | passes (guard; mutants below) |
| 20 pairs at +2% read INCONCLUSIVE | judge: *20 pairs at +2% read INCONCLUSIVE* | `status` INCONCLUSIVE, both p values ≥ 0.01 | fails: reads PASS |
| The same pairs and seed give the same result and p values twice | judge: *the same pairs and seed give the same result and p values twice* | `seed` is the one passed; `pAbove`, `pBelow` in [0, 1]; the second result deep-equals the first; with no seed, the result's seed replays it | fails: no `seed` |
| Over 20 rounds each side runs first 10 times | order: *over 20 rounds each side runs first 10 times* | in the last 20 rounds, each runs both sides once; current first 10 times, base first 10 times | fails: current first 20 times |
| A planted two-thread spin bench, A/A over 20 pairs at load above the cores, never reads FAIL | spin: *a planted two-thread spin bench, A/A …* | `status` PASS or INCONCLUSIVE | passes (guard; see below) |
| The same bench at +10% reads INCONCLUSIVE; on main it reads PASS | spin: *the same bench at +10% reads INCONCLUSIVE* | `status` INCONCLUSIVE | fails: reads PASS (margin = spread 137%) |
| A pair run with one side at lower QoS reads INCONCLUSIVE or FAIL, never PASS | qos: *a pair run with one side at lower QoS …* | `status` INCONCLUSIVE or FAIL | skipped in the final run (the lower-QoS side counted fewer); an earlier form failed reading PASS. Readings 5 |
| Proof: an A/A run of one real budget that doesn't read FAIL | proof: *an A/A run of the real budget verdict-1000-runs doesn't read FAIL* | `status` PASS or INCONCLUSIVE | passes (guard) |

The scope's last item, removing the comments that say load can't move the count (`parseInstructions`' and `judgeTask`'s), is something no test can reach: check it by reading the diff.

## Readings where the issue leaves a choice

1. **The seed and p values' names and the seed's place** are the Surfaces above. Nothing new is added for tests.
2. **The statistic.** The issue says "sign-flip tests on the paired differences" and no more. The tests don't pin a statistic. The fixture pairs read as the issue says under the usual one, the sum of each difference less 2% with its signs flipped at random, whether a difference is `current / base - 1` or `log(current / base)` against `log(1.02)`. **The spin criteria need a symmetric difference.** With the spin bench's noise, `current / base - 1` is skewed right (a ratio can go to +300% but never below −100%): a sample summing plain differences read one spin A/A at p 0.075 for "above 2%", median +21%, close to a false FAIL. The same sample on `log(current / base)` passed both spin tests. The implementer should know; the tests ask only for the outcomes.
3. **"20 pairs at +2%"** are each within one instruction of 2% over their base, alternately one over and one under (bases are multiples of 50, so 2% of each is a whole count). Counts are whole numbers, and `1.02 - 1` isn't 0.02 in floating point: twenty pairs set to exactly 2% all sit 1.7e-17 over the line, and a judge computing `current / base - 1 - 0.02` would see twenty positive differences and read FAIL from rounding alone. One instruction in a billion either way is still +2%.
4. **"The same bench at +10%"** is the bench plus a fixed single-threaded spin after its handoffs, sized to 10% of the bench's typical count: the test reads the instructions per spin (about 7) and the median of five runs of the bench, then plants that many spins on the current side. It comes last because two other plants weren't +10%: 10% more handoffs, or the same extra spin run *before* the handoffs, read +25% to +63% median changes in five runs while A/A runs read −8% to +21%. Work that changes a run's length changes how its threads are scheduled, so it isn't an addition. The bench's typical count also drifts with load (0.9 to 3 billion within minutes), so the test checks the plant against the run's own merge-base median and, outside 5% to 20%, is skipped as INCONCLUSIVE before it is judged.
5. **"One side at lower QoS"** is the current side, started by `taskpolicy -c utility` (below the default a command runs at); the merge-base side runs as it is. `-c background` starves at this Mac's load: a 20-handoff run didn't finish in two minutes at load 280. The criterion's "never PASS" presumes what the issue says of spin code, that a side scheduled worse counts more of its own waiting. That held in a probe at load 290 with small turns (200 handoffs of 2,000 spins: 41–225 M at utility against 35–66 M), but in the base run at load 435 with this bench the utility side retired 76% *fewer* instructions than the default side, consistently (spread 36%). Then a correct sign-flip judge reads PASS, and so would any judge of these pairs. So the test reads the direction first: if the lower-QoS side's median count isn't above the other side's, it is skipped as INCONCLUSIVE with what it saw. Lowering the merge-base side instead mirrors the problem. **This needs the issue author's reading**: which side, and whether the count's direction is part of the plant.
6. **"At load above the cores"** is the 1-minute load average (`os.loadavg()[0]`) above `os.availableParallelism()`, read before and after the run. The tests don't make load: this Mac sat at 280 to 440 on 18 cores. The A/A test asserts first, since an A/A must never read FAIL at any load, and is then skipped as INCONCLUSIVE if the load wasn't above the cores. The +10% test checks first, since its INCONCLUSIVE depends on the noise: a run below the cores load, or whose pairs spread less than the 133% the issue saw on a spin handoff, is skipped as INCONCLUSIVE before it is judged.
7. **The real budget** is `verdict-1000-runs`, the one the issue saw move 3.5%, run with its own command from `benchmarks/budgets.json` on both sides of `measure`, in the checkout under test.
8. **The +10% INCONCLUSIVE is a statistical expectation.** At the bench's noise (pairs spread 125% to 640% in seven runs), a sum statistic tells a 10% rise apart at p under 0.01 only rarely; a quieter run makes that likelier, which the 133% spread check guards against.

## How the tests plant

- **Fixture pairs** (judge): twenty bases, 1,000,000,000 + 7,900 per round, with currents set to the issue's differences; the outliers sit in round 7.
- **The order** (order): each side's command is `/bin/sh -c 'echo <side> >> order.log'` in one scratch directory, so the log holds the order the runs began in, as `measure` ran them.
- **The spin bench** (spin, qos): `fixtures/handoff.c`, built by `cc -O2`: two threads pass a token through one atomic word 200 times, each spinning without yielding until its turn, then spinning a volatile counter 100,000 times. It is native for #724's reason, a Node loop's own count moving under load; here the movement is the plant's point, and it comes only from the spin. At load 280–310, twelve runs spread 948 M to 3,834 M instructions and took 0.1 to 1.5 s each; a `measure` of it took 4 s to 3 minutes. The same binary runs on both sides in one scratch directory. Its optional third argument is the +10% plant's spin count (Readings, 4).
- **The real budget** (proof): the checkout's own `node benchmarks/verdicts.mjs verdict-1000-runs` on both sides.

No option, flag or environment variable is added for tests.

## Guards and the wrong programs each test fails on

Each test was checked against a throwaway sample implementation in a scratch copy of the base (not committed): a sum statistic over 20,000 seeded sign flips, p = (hits + 1) / 20,001, and `measure` reversing the side order on odd rounds, once on `current / base - 1` and once on `log(current / base)`. Both passed the six fast tests. Live, the plain-difference sample passed the real budget's A/A (PASS, spread 6.3%) and the spin A/A (INCONCLUSIVE, p 0.075), and the qos test skipped (lower-QoS median 2.1 B against 3.6 B); the log sample passed the spin A/A (INCONCLUSIVE, spread 141%) and +10% (INCONCLUSIVE, plant 9.5%, change +9.4%, p 0.116). The plain-difference sample wasn't run on the final +10% plant. No run has yet had the lower-QoS side count more, so the qos assertion has never run against a sample. Mutants of the sample:

| Mutant | Tests that failed |
|---|---|
| The base's rule (margin max(2%, spread)) | judge +15%/−5%, +2%, seed; order |
| Both tests against 0% instead of 2% | judge ±0.5%, +0.1%/+30%, +2% |
| A judge that never reads PASS (FAIL or INCONCLUSIVE) | judge ±0.5% |
| Flips drawn from `Math.random`, ignoring the seed | judge seed |
| `measure` without the swap | order |

So the two fixture guards that pass on the base (±0.5%, +0.1%/+30%) fail on named mutants. Two further wrong programs follow from the issue's own text and weren't run: FAIL when any one pair is above 2% fails the +0.1%/+30% test; a PASS threshold no 20 pairs can reach (p under 2^-20) fails the ±0.5% test.

The live guards, the spin A/A and the real budget's A/A, hold on the base too: the old margin is the spread, so an A/A reads PASS. A wrong program fails them only by chance, on the run's noise: a judge testing against 0% instead of 2% reads an A/A FAIL about 1% of the time, and one that fails on the median alone above 2% (the old rule without its spread) reads a noisy A/A FAIL often (the spin A/A's median difference moves several percent). They are kept because the Proof asks for the real budget's A/A and the criterion for the bench's, not because they catch a mutant every run.

## Not covered here

- The issue's 34% on a mutex: only the spin handoff is planted.
- perf's printed lines and `judgeTask`: the tests stop at `measure` and `judgeInstructions`, the functions the issue names. `judgeTask` passes no seed, which is the "picks one itself" case of the seed test.
- The removed comments (scope's last item): diff review.
