// #2650 AC2, the first planted program: a host that keeps one answer per source call, though the hub opens it not
// recording, fails the benchmark, naming the cycle count and the growth, and its FAIL names `answers`, the store that
// grew most. Selected with DEEP_HUB_PLANT=churn-keeps-every-answer (README, Wrong programs). Each cycle's source call
// answers 64 KB, so the store keeps at least half that a cycle.
import { afterEach, describe, it } from 'vitest';
import { AC2, cleanup, MINUTE, plantedFails } from './helpers.ts';

afterEach(cleanup, MINUTE);

describe(`${AC2} A planted host that keeps one answer per source call, one that keeps one result per action call, a planted runner that keeps every ended job's output and a planted store that keeps every set of names each fail the benchmark, naming the cycle count and the growth`, () => {
  it(`${AC2} churn-keeps-every-answer, a host that keeps one answer per source call, fails it, naming answers`, async () => {
    await plantedFails('churn-keeps-every-answer', 'answers', 32_000_000);
  }, 60 * MINUTE);
});
