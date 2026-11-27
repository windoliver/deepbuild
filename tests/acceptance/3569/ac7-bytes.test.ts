// #3569.f14e11fa: "The job run on two machines writes byte-identical outputs. Changing one byte of one input changes
// the job's key and the output's hash. A rerun with the output present runs nothing"
//
// No second machine is at hand, so the second machine is a second hub with nothing shared: its own home, evidence
// store, cache and record, its processes under another time zone and locale (TZ=Pacific/Chatham, LC_ALL
// fr_FR.UTF-8), its tables imported in the other order (README: Readings, two machines). AC1's job runs in each, a miss
// that starts a process in each, and every output (the table, the lineage and any other) is the same SHA-256 in both,
// and each store holds those bytes under it. fixtures/counties-changed.csv is counties.csv with one byte changed
// (county 6's 7 becomes 8): its run has another key and another table hash. The same run again in the first hub is a
// cache hit under the first key, with the same outputs, and starts no process (#1922's `counted`).
// Wrong programs it fails on: the merge base; a tool whose output holds a time, a locale's number form, a path, a
// random or a hash-map order; a key that leaves out the input's hash; a rerun that runs the tool again.
import { describe, expect, it } from 'vitest';
import { AC, COUNTY_UNITS, METRO, TIMEOUT, brief, byMetro, derive, derivedOf, importTables, openHub, proof, receiptOf, sha256, stored, type Derived, type Hub } from './helpers.ts';

const ID = AC[7];
const OTHER = { TZ: 'Pacific/Chatham', LC_ALL: 'fr_FR.UTF-8', LANG: 'fr_FR.UTF-8' };

/** Each output's bytes in a hub's store, hashed again. */
const held = (hub: Hub, outputs: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(outputs).map(([n, sha]) => { const bytes = stored(hub, sha); return [n, bytes ? sha256(bytes) : 'not in the store']; }));

describe(`${ID} the job's outputs are the same bytes on two machines, its key follows its inputs' bytes, and a rerun runs nothing`, () => {
  it(`${ID} two machines write byte-identical outputs; one changed input byte changes the key and the output's hash; a rerun with the output present runs nothing`, async () => {
    const one = await openHub();
    expect(typeof one === 'string' ? one : '', 'the first hub, with packages/jobs/asset-tools installed').toBe('');
    if (typeof one === 'string') return;
    const a = await importTables(one, [{ name: 'counties.csv', key: 'county', units: COUNTY_UNITS }, { name: 'metros.csv', key: METRO.key }, { name: 'counties-changed.csv', key: 'county', units: COUNTY_UNITS }]);
    expect(typeof a === 'string' ? a : '', 'the tables fetched into the first hub').toBe('');
    if (typeof a === 'string') return;
    const params = byMetro({ county: a.sha['counties.csv']!, metro: a.sha['metros.csv']! });

    const first = derivedOf(one, await derive(one, params), 'the job in the first hub');
    expect(typeof first === 'string' ? first : '', 'deep_job derives the table in the first hub').toBe('');
    if (typeof first === 'string') return;
    expect([receiptOf(first.run.outcome).cache, first.run.started >= 1], `the first run is a miss that starts the tool: ${brief(first.run)}`).toEqual(['miss', true]);
    const key = receiptOf(first.run.outcome).key;
    expect(typeof key === 'string' && key !== '', `the receipt names the job's key: ${brief(first.run)}`).toBe(true);

    const rerun = await derive(one, params);
    expect(typeof rerun === 'string' ? rerun : '', 'the rerun gets a reply').toBe('');
    if (typeof rerun === 'string') return;
    const again = derivedOf(one, rerun, 'the rerun');
    expect(typeof again === 'string' ? again : '', 'the rerun is done').toBe('');
    if (typeof again === 'string') return;
    expect({ cache: receiptOf(rerun.outcome).cache, key: receiptOf(rerun.outcome).key, started: rerun.started, outputs: again.outputs }, `the rerun with the output present is a hit under the same key that starts no process: ${brief(rerun)}`)
      .toEqual({ cache: 'hit', key, started: 0, outputs: first.outputs });

    const changed = derivedOf(one, await derive(one, byMetro({ county: a.sha['counties-changed.csv']!, metro: a.sha['metros.csv']! })), 'the job with one input byte changed');
    expect(typeof changed === 'string' ? changed : '', 'the job on the changed county table is done').toBe('');
    if (typeof changed === 'string') return;
    expect(receiptOf(changed.run.outcome).key, `one changed byte of one input changes the job's key: ${brief(changed.run)}`).not.toBe(key);
    expect(changed.outputs.table, 'and the output\'s hash').not.toBe(first.outputs.table);

    const two = await openHub(OTHER);
    expect(typeof two === 'string' ? two : '', 'the second hub, nothing shared with the first, with packages/jobs/asset-tools installed').toBe('');
    if (typeof two === 'string') return;
    const b = await importTables(two, [{ name: 'metros.csv', key: METRO.key }, { name: 'counties.csv', key: 'county', units: COUNTY_UNITS }]);
    expect(typeof b === 'string' ? b : '', 'the tables fetched into the second hub').toBe('');
    if (typeof b === 'string') return;
    const second: Derived | string = derivedOf(two, await derive(two, byMetro({ county: b.sha['counties.csv']!, metro: b.sha['metros.csv']! })), 'the job in the second hub');
    expect(typeof second === 'string' ? second : '', 'deep_job derives the table in the second hub').toBe('');
    if (typeof second === 'string') return;
    proof('ac7.json', { inputs: a.sha, first: { outputs: first.outputs, key, receipt: receiptOf(first.run.outcome) }, second: { outputs: second.outputs, receipt: receiptOf(second.run.outcome) }, changed: { outputs: changed.outputs, key: receiptOf(changed.run.outcome).key }, rerun: receiptOf(rerun.outcome) });
    expect([receiptOf(second.run.outcome).cache, second.run.started >= 1], `the second hub ran the tool itself: ${brief(second.run)}`).toEqual(['miss', true]);
    expect(second.outputs, 'both machines write the same outputs, byte for byte, by SHA-256').toEqual(first.outputs);
    expect([held(one, first.outputs), held(two, second.outputs)], 'each store holds those bytes under their hash').toEqual([first.outputs, second.outputs]);
  }, TIMEOUT);
});
