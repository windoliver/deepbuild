// #2650 AC2, the fourth planted program: a series store that keeps every set of names it decoded fails the benchmark,
// naming the cycle count and the growth, and its FAIL names `names`, the store that grew most. Selected with
// DEEP_HUB_PLANT=churn-keeps-every-name-set (README, Wrong programs). Each cycle's series call answers a new set of 100
// names, so a store that keeps them all grows by at least the heap's whole limit a cycle, 200 bytes.
import { afterEach, describe, it } from 'vitest';
import { AC2, cleanup, HEAP_LIMIT_PER_1000, MINUTE, plantedFails } from './helpers.ts';

afterEach(cleanup, MINUTE);

describe(`${AC2} A planted host that keeps one answer per source call, one that keeps one result per action call, a planted runner that keeps every ended job's output and a planted store that keeps every set of names each fail the benchmark, naming the cycle count and the growth`, () => {
  it(`${AC2} churn-keeps-every-name-set, a series store that keeps every set of names, fails it, naming names`, async () => {
    await plantedFails('churn-keeps-every-name-set', 'names', HEAP_LIMIT_PER_1000);
  }, 60 * MINUTE);
});
