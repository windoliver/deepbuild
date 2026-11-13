// #1919.6198ed94: physics.query on a bake whose golden hasn't matched on its second machine reports machines: same, and
// any once it has; a planted result that always reports any fails, naming the probe.
//
// The projectile's golden is recorded on this Mac (#2010's `golden`, which keeps its bake in the store the probe reads),
// verifying on the web player's wasm32 alone, its second machine (Golden: a golden that feeds a check verifies on
// another architecture and in wasm32; this one asks for one target, as #2010's suite does). physics.query is given the
// golden and the replays made of it (README: `query`'s `golden` and `runs`). Not matched: no replay, then this Mac's own
// PASS replay, which reads `machines: same` and never counts across machines; both results say `same`. Matched: the
// replay #2012's wasm32 leg (`node scripts/physics-wasm32.mjs`) makes in Node's WebAssembly engine, PASS on another
// architecture; the result says `any`. The twin `--planted query_machines_any` reports `any` before any match.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, STEPS, TIMEOUT, WASM32, X_AT_FIRST_HIT, X_AT_FIRST_HIT_TEXT, caught, checked, deepPhysics, goldenOf, machinesFailures, none, onWasm32,
  prebuild, projectile, query, recordGolden, scratch, verifyGolden, type JsonObject, type Planted,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[4];
const EXPECT: JsonObject = { value: 10.19 };

/** The projectile's golden, recorded here into `store`, verifying on wasm32. */
function goldenHere(store: string): { w: JsonObject; golden: JsonObject } {
  const w = projectile();
  const golden = goldenOf(deepPhysics([recordGolden(w, STEPS, store, [WASM32])], { where: 'recording the golden' })[0]!, 'the projectile\'s golden');
  return { w, golden };
}
const probe = (w: JsonObject, store: string, golden: JsonObject, runs: JsonObject[], planted?: Planted): JsonObject =>
  deepPhysics([query(w, store, X_AT_FIRST_HIT, EXPECT, { tolerance: 0.1, golden, runs })], planted ? { planted } : {})[0]!;

describe(`${ID} physics.query reports machines: same until the bake's golden matches on its second machine, and any once it has`, () => {
  it(`${ID} same while the golden hasn't matched on its second machine (this Mac's own replay aside), any once wasm32 has matched it`, () => {
    const store = scratch('ac4');
    const { w, golden } = goldenHere(store);
    const [here] = deepPhysics([verifyGolden(golden, w, STEPS)], { where: 'this Mac\'s replay' });
    expect([here!['verdict'], here!['machines']], `this Mac's replay passes on the recording architecture: ${JSON.stringify(here).slice(0, 600)}`).toEqual(['PASS', 'same']);

    const unmatched = checked(probe(w, store, golden, []), 'the probe, no replay');
    none(machinesFailures(unmatched, 'same', X_AT_FIRST_HIT_TEXT, 'has no replay'), 'not matched');
    const sameArch = checked(probe(w, store, golden, [here!]), 'the probe, this Mac\'s replay');
    none(machinesFailures(sameArch, 'same', X_AT_FIRST_HIT_TEXT, 'has only this Mac\'s replay'), 'not matched on its second machine');

    const [web] = onWasm32([verifyGolden(golden, w, STEPS)]);
    expect([web!['verdict'], web!['target'], web!['machines']], `the wasm32 replay matches the golden: ${JSON.stringify(web).slice(0, 600)}`).toEqual(['PASS', WASM32, 'different']);
    const matched = checked(probe(w, store, golden, [here!, web!]), 'the probe, matched on wasm32');
    expect(matched.verdict, `the probe still passes: ${JSON.stringify(matched.raw).slice(0, 600)}`).toBe('PASS');
    none(machinesFailures(matched, 'any', X_AT_FIRST_HIT_TEXT, 'matched on wasm32, its second machine'), 'matched');
  }, TIMEOUT);

  it(`${ID} a planted result that always reports any fails, naming the probe`, () => {
    const store = scratch('ac4-twin');
    const { w, golden } = goldenHere(store);
    const twin = checked(probe(w, store, golden, [], 'query_machines_any'), 'the probe on query_machines_any');
    const failures = machinesFailures(twin, 'same', X_AT_FIRST_HIT_TEXT, 'has no replay');
    caught(failures, 'query_machines_any');
    expect(failures.join('\n'), 'the failure names the probe').toContain(X_AT_FIRST_HIT_TEXT);
  }, TIMEOUT);
});
