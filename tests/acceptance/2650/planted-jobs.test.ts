// #2650 AC2, the third planted program: a runner that keeps every ended job's output fails the benchmark, naming the
// cycle count and the growth, and its FAIL names `jobs`, the store that grew most. Selected with
// DEEP_HUB_PLANT=churn-keeps-every-output (README, Wrong programs). Each cycle's job prints 256 KB, so the store keeps
// at least half that a cycle.
import { afterEach, describe, it } from 'vitest';
import { AC2, cleanup, MINUTE, plantedFails } from './helpers.ts';

afterEach(cleanup, MINUTE);

describe(`${AC2} A planted host that keeps one answer per source call, one that keeps one result per action call, a planted runner that keeps every ended job's output and a planted store that keeps every set of names each fail the benchmark, naming the cycle count and the growth`, () => {
  it(`${AC2} churn-keeps-every-output, a runner that keeps every ended job's output, fails it, naming jobs`, async () => {
    await plantedFails('churn-keeps-every-output', 'jobs', 128_000_000);
  }, 60 * MINUTE);
});
