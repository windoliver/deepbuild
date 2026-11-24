// #3035.36c146dd: "The same file converts to the same bytes twice, and a rerun with the same inputs is a cache hit that
// starts no process"
//
// The file is fixtures/arm.urdf. A cache hit is no second conversion, so the two conversions compared by bytes are
// run in two hubs, each with a store and a cache of its own (README: Readings, twice): in each the run is a miss
// that starts a process, and the two return the same outputs by SHA-256, which each hub's store holds under that
// hash. In the first hub the same run again, with the same file and params, is a cache hit under the same key with
// the same outputs, and starts no process (#1922's `counted`: the record's process.starting events).
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, brief, convert, openHub, outputsOf, receiptOf, runFile, sha256, stored, type Converted, type Hub } from './helpers.ts';
import { ARM } from './model.ts';

const ID = AC[6];
const FILE = ARM.file;

let hub: Promise<Hub | string> | undefined;
let once: Promise<Converted | string> | undefined;
/** The first hub, and the arm converted in it once, for both tests. */
const first = (): Promise<Converted | string> => {
  hub ??= openHub();
  once ??= hub.then((h) => convert(h, FILE));
  return once;
};
/** Whether a run really converted: a miss that started a process. */
const ran = (c: Converted): [unknown, boolean] => [receiptOf(c.run.outcome)['cache'], c.run.started >= 1];
/** Each output's bytes in a hub's store, hashed again. */
const held = (h: Hub, outputs: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(outputs).map(([n, sha]) => { const bytes = stored(h, sha); return [n, bytes ? sha256(bytes) : 'not in the store']; }));

describe(`${ID} the conversion gives the same bytes again, and a rerun reads them from the cache`, () => {
  it(`${ID} the same file converts to the same bytes twice`, async () => {
    const a = await first();
    expect(typeof a === 'string' ? a : '', `deep_job converts ${FILE} in the first hub (import {from: urdf})`).toBe('');
    const other = await openHub();
    const b = await convert(other, FILE);
    expect(typeof b === 'string' ? b : '', `deep_job converts ${FILE} in a second hub, with a cache of its own`).toBe('');
    const [one, two] = [a as Converted, b as Converted];
    // Both really ran: each a miss that started a process, so neither read the other's bytes.
    expect([ran(one), ran(two)], `both conversions ran: ${brief(one.run)} | ${brief(two.run)}`).toEqual([['miss', true], ['miss', true]]);
    expect(['document', 'report'].filter((n) => !one.outputs[n]), 'the first conversion returns a document and a report by hash').toEqual([]);
    expect(two.outputs, 'the two conversions return the same outputs, by SHA-256').toEqual(one.outputs);
    expect([held((await hub) as Hub, one.outputs), held(other as Hub, two.outputs)], 'each hub\'s store holds those bytes under their hashes').toEqual([one.outputs, one.outputs]);
    expect(two.texts, 'the document and the report are the same bytes').toEqual(one.texts);
  }, TIMEOUT);

  it(`${ID} a rerun with the same inputs is a cache hit that starts no process`, async () => {
    const a = await first();
    expect(typeof a === 'string' ? a : '', `deep_job converts ${FILE} (import {from: urdf})`).toBe('');
    const one = a as Converted;
    expect(ran(one), `the first run is a miss that starts a process: ${brief(one.run)}`).toEqual(['miss', true]);
    const again = await runFile((await hub) as Hub, FILE);
    expect(typeof again === 'string' ? again : '', 'the rerun answers').toBe('');
    const rerun = again as Exclude<typeof again, string>;
    const [was, now] = [receiptOf(one.run.outcome), receiptOf(rerun.outcome)];
    expect(typeof was['key'] === 'string' && was['key'] !== '', `the first run's receipt names its key: ${JSON.stringify(was)}`).toBe(true);
    expect({ status: rerun.outcome.value['status'], cache: now['cache'], key: now['key'], outputs: outputsOf(rerun.outcome) }, `the rerun is a cache hit under the same key, with the same outputs: ${brief(rerun)}`)
      .toEqual({ status: 'done', cache: 'hit', key: was['key'], outputs: one.outputs });
    expect(rerun.started, `the cache hit starts no process: ${brief(rerun)}`).toBe(0);
  }, TIMEOUT);
});
