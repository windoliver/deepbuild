// #1919.adaa86f8: a test backend that wraps Rapier and counts its calls sees every physics.query ray, sweep and overlap
// arrive through query(); a planted physics.query that calls Rapier's query pipeline directly leaves the count short and
// fails, naming the call.
//
// The test backend is deep-physics built with the cargo feature `test-count-calls` (README: The test backend), which
// answers `backend_calls` with the backend-interface calls the module made, query()'s by kind. One process bakes the
// projectile into a store and runs physics.query once with a ray, once with a sweep and once with an overlap, each at
// step 0 against the floor (the only shape under each probe there), then reads the counts: one query() of each kind.
// The twin `--planted query_bypasses_backend`, on the same build, answers the same probes from Rapier's query pipeline
// directly, so the counts come back short and the judge fails, naming query().
import { describe, expect, it } from 'vitest';
import {
  COUNTING, CRITERIA, OVERLAP_FLOOR, RAY_DOWN, STEPS, STEP_0, SWEEP_DOWN, TIMEOUT, bake, caught, checked, countingBin, deepPhysics, none,
  prebuildFeatures, projectile, query, queryCounts, resultOf, scratch, throughQueryFailures, type JsonObject, type Planted, type QueryCounts,
} from './helpers.ts';

prebuildFeatures([['deep-physics-rapier', 'deep-physics', COUNTING]]);

const ID = CRITERIA[1];
const PROBES: Array<[string, JsonObject]> = [['ray', RAY_DOWN], ['sweep', SWEEP_DOWN], ['overlap', OVERLAP_FLOOR]];
const ONE_EACH: QueryCounts = { ray: 1, sweep: 1, overlap: 1 };

/** The bake, the three probes and the counts, in one process of the counting build. */
function probeAndCount(planted?: Planted): { replies: JsonObject[]; counts: QueryCounts } {
  const w = projectile();
  const store = scratch('ac1');
  const calls = [
    bake(w, STEPS, { store, read: [] }),
    ...PROBES.map(([, p]) => query(w, store, p, { ids: ['floor'] }, { state: STEP_0 })),
    { call: 'backend_calls' },
  ];
  const replies = deepPhysics(calls, { bin: countingBin(), ...(planted ? { planted } : {}), where: 'the counting test backend' });
  expect(replies[0]!['ok'], `the projectile bakes: ${JSON.stringify(replies[0]).slice(0, 800)}`).toBe(true);
  return { replies, counts: queryCounts(replies[calls.length - 1], 'backend_calls') };
}

describe(`${ID} physics.query reaches the backend only through query()`, () => {
  it(`${ID} the counting backend sees each physics.query ray, sweep and overlap arrive through query(), one call each`, () => {
    const { replies, counts } = probeAndCount();
    PROBES.forEach(([kind], i) => {
      const c = checked(replies[i + 1], `the ${kind} probe`);
      expect(c.verdict, `the ${kind} probe at step 0 finds the floor: ${JSON.stringify(c.raw).slice(0, 800)}`).toBe('PASS');
      expect(resultOf(c, `the ${kind} probe`).ids, `the ${kind} probe's hits`).toEqual(['floor']);
    });
    none(throughQueryFailures(counts, ONE_EACH), 'every probe arrives through query()');
  }, TIMEOUT);

  it(`${ID} a planted physics.query that calls Rapier's query pipeline directly leaves the count short and fails, naming the call`, () => {
    const { counts } = probeAndCount('query_bypasses_backend');
    const failures = throughQueryFailures(counts, ONE_EACH);
    caught(failures, 'query_bypasses_backend');
    expect(failures.join('\n'), 'the failure names the call').toContain('query(');
  }, TIMEOUT);
});
