// AC16: a driver quirk is reviewed data, never a code branch. A test adapter (vendor 4660, device 22136) reports every
// feature of the tier; a quirk-table row matching it withholds the tier's first gated feature, F. The seam must run F's
// absent path, carry the table's digest in every result, and change the content keys it feeds when the row changes.
// The test's own check (helpers.ts, unexplainedWithholds) reads the adapter's reported and the device's granted
// features against the table the test wrote: a feature withheld with no row and no --withhold is a code branch.
// `--planted withholds_in_code` withholds F by a branch on the adapter's IDs with an empty table: its gated fixtures
// pass, and this test fails it, naming F. At the base there is no test-seam build.
import { describe, expect, it } from 'vitest';
import {
  ADAPTER, adapterReply, adaptersFile, gatedCall, gatedReply, quirksFile, requireMac, run, unexplainedWithholds, useBuilds, useOut,
  type AdapterReply, type GatedReply, type QuirkRow, type Startup,
} from './helpers.ts';

const bins = useBuilds(['default', 'test-seam']);
const out = useOut();
const VENDOR = 4660;
const DEVICE = 22136;

/** One run on the test adapter: the adapter call, then the gated call on `feature`. */
function both(feature: string, startup: Startup): { a: AdapterReply; g: GatedReply } {
  const [a, g] = run(bins.bin('test-seam'), out(), [ADAPTER, gatedCall(feature)], startup);
  return { a: adapterReply(a!, `the adapter call (${JSON.stringify(startup)})`), g: gatedReply(g!, `the gated call on ${feature}`) };
}

describe('AC16 a test adapter whose quirk-table row withholds a feature it reports runs that feature\'s absent path, carries the table\'s digest, and changing the row changes its content keys', () => {
  it('AC16 the row withholds F on the matching test adapter: its absent path runs, every result carries the table\'s digest, the same table keeps the keys and a changed row changes every one; a row for another adapter withholds nothing', () => {
    requireMac();
    const mac = adapterReply(run(bins.bin(), out(), [ADAPTER])[0]!, 'the adapter call on this Mac');
    const row = mac.table.find((r) => !r.required);
    expect(row, 'the tier has a gated feature').toBeDefined();
    const first = row!.feature;
    expect(mac.granted, `this Mac grants ${first}, so the test adapter can report it`).toContain(first);
    const dir = out();
    const adapters = adaptersFile(dir, 'quirky.json', [{ name: 'quirky adapter', type: 'integrated_gpu', vendor: VENDOR, device: DEVICE, driver: '9.9.9', memory: 8 * 2 ** 30, features: mac.table.map((r) => r.feature) }]);
    const rowA: QuirkRow = { backend: mac.seam.name, match: { vendor: VENDOR, device: DEVICE }, withholds: first, reason: `test: the quirky adapter's ${first} is withheld` };
    const rowB: QuirkRow = { ...rowA, reason: `test: the quirky adapter's ${first} is withheld, reviewed again` };
    const rowC: QuirkRow = { ...rowA, match: { vendor: 9999, device: DEVICE } };
    const A = quirksFile(dir, 'a.json', [rowA]);
    const B = quirksFile(dir, 'b.json', [rowB]);
    const C = quirksFile(dir, 'c.json', [rowC]);

    const a1 = both(first, { adapters, quirks: A });
    expect(a1.a.adapter.name, 'the seam opened the quirky test adapter').toBe('quirky adapter');
    expect(a1.a.reported, `the adapter reports ${first}`).toContain(first);
    expect(a1.a.granted, `the row withheld ${first} at device creation`).not.toContain(first);
    expect(unexplainedWithholds(a1.a, [rowA], []), 'every withheld feature is the table\'s').toEqual([]);
    expect(a1.g.granted, `${first} is absent`).toBe(false);
    expect(a1.g.took, `${first}'s absent path, the fallback ${row!.fallback}, ran`).toBe(row!.fallback);
    expect(a1.g.fixtures.length, `${first}'s fixtures ran`).toBeGreaterThan(0);
    for (const x of a1.g.fixtures) {
      expect(x.result, `${x.fixture} on the absent path`).toBe('PASS');
      expect(x.took, `${x.fixture} took the fallback`).toBe(row!.fallback);
      expect(x.receipt.quirks, `${x.fixture}'s result carries the table's digest`).toBe(a1.a.quirks);
      expect(x.receipt.adapter, `${x.fixture}'s result names the adapter`).toBe('quirky adapter');
    }
    const keys = (g: GatedReply): Map<string, string> => new Map(g.fixtures.map((x) => [x.fixture, x.content_key]));
    const a2 = both(first, { adapters, quirks: A });
    expect(a2.a.quirks, 'the same table has the same digest').toBe(a1.a.quirks);
    expect(keys(a2.g), 'the same table feeds the same content keys').toEqual(keys(a1.g));

    const b = both(first, { adapters, quirks: B });
    expect(b.a.quirks, 'a changed row changes the table\'s digest').not.toBe(a1.a.quirks);
    expect(b.a.granted, `the changed row still withholds ${first}`).not.toContain(first);
    for (const x of b.g.fixtures) {
      expect(x.receipt.quirks, `${x.fixture}'s result carries the changed table's digest`).toBe(b.a.quirks);
      expect(x.content_key, `${x.fixture}: changing the row changes the content key it feeds`).not.toBe(keys(a1.g).get(x.fixture));
    }

    const c = both(first, { adapters, quirks: C });
    expect(c.a.granted, `a row matching another vendor withholds nothing here: ${first} is granted`).toContain(first);
    expect(c.g.took, `${first}'s own path runs`).toBe(first);
  }, 1_800_000);

  it('AC16 a planted backend that withholds F in code without a table row passes its gated fixtures and fails this test, naming F', () => {
    requireMac();
    const mac = adapterReply(run(bins.bin(), out(), [ADAPTER])[0]!, 'the adapter call on this Mac');
    const first = mac.table.find((r) => !r.required)?.feature ?? '';
    expect(first, 'the tier has a gated feature').not.toBe('');
    const dir = out();
    const adapters = adaptersFile(dir, 'quirky.json', [{ name: 'quirky adapter', type: 'integrated_gpu', vendor: VENDOR, device: DEVICE, driver: '9.9.9', memory: 8 * 2 ** 30, features: mac.table.map((r) => r.feature) }]);
    const empty = quirksFile(dir, 'empty.json', []);
    const clean = both(first, { adapters, quirks: empty });
    expect(clean.a.granted, `with no row, ${first} is granted on the clean backend`).toContain(first);
    expect(unexplainedWithholds(clean.a, [], []), 'the clean backend withholds nothing in code').toEqual([]);
    const planted = both(first, { adapters, quirks: empty, planted: 'withholds_in_code' });
    expect(planted.g.granted, `the planted backend withheld ${first}`).toBe(false);
    for (const x of planted.g.fixtures) expect(x.result, `the planted backend passes its gated fixture ${x.fixture}`).toBe('PASS');
    expect(planted.g.fixtures.length, 'its gated fixtures ran').toBeGreaterThan(0);
    const failures = unexplainedWithholds(planted.a, [], []);
    expect(failures.length, 'this test fails the planted backend').toBeGreaterThan(0);
    expect(failures.join('\n'), `naming the feature ${first}`).toContain(first);
  }, 1_800_000);
});
