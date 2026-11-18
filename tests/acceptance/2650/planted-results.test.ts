// #2650 AC2, the second planted program: a host that keeps one result per action call, every request ID's result
// and never lets one go, fails the benchmark, naming the cycle count and the growth, and its FAIL names `results`, the
// store that grew most. Selected with DEEP_HUB_PLANT=churn-keeps-every-result (README, Wrong programs). Each kept result
// moves the store by at least the heap's whole limit a cycle, 200 bytes, or the plant couldn't fail the benchmark.
import { afterEach, describe, it } from 'vitest';
import { AC2, cleanup, HEAP_LIMIT_PER_1000, MINUTE, plantedFails } from './helpers.ts';

afterEach(cleanup, MINUTE);

describe(`${AC2} A planted host that keeps one answer per source call, one that keeps one result per action call, a planted runner that keeps every ended job's output and a planted store that keeps every set of names each fail the benchmark, naming the cycle count and the growth`, () => {
  it(`${AC2} churn-keeps-every-result, a host that keeps one result per action call, fails it, naming results`, async () => {
    await plantedFails('churn-keeps-every-result', 'results', HEAP_LIMIT_PER_1000);
  }, 60 * MINUTE);
});
