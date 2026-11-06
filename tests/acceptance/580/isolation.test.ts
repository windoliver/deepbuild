// #580 AC2: a journey that places one order and expects the orders page to show exactly 1 passes three runs in a row on
// one warm stack, each starting with no orders, and the visit counter the app keeps in the stack's Redis reads 0 at
// each run's start. A planted environment that keeps one database across runs shows 2 orders on the second run and
// fails environment@1, naming the database; one that keeps Redis running between runs fails it, naming the service.
import { afterEach, describe, expect, it } from 'vitest';
import { Bench, environmentFailures, failureOf, nameOf, passed, type Done } from './helpers.ts';

let bench: Bench | undefined;
afterEach(async () => { await bench?.close(); bench = undefined; }, 300_000);

async function runs(n: number, plant?: string): Promise<Done[]> {
  const b = bench = await Bench.open(plant ? { plant } : {});
  const s = await b.session();
  const out: Done[] = [];
  for (let i = 0; i < n; i++) out.push(await b.whole(s));
  return out;
}
function clean(d: Done, i: number): void {
  expect(environmentFailures(d.finished), `run ${i + 1} failed environment@1`).toEqual([]);
  expect(d.start?.orders, `run ${i + 1} starts with no orders`).toBe(0);
  expect(d.start?.visits, `the visit counter reads 0 at run ${i + 1}'s start`).toBe(0);
  expect(d.start?.seeded, `run ${i + 1}'s Redis holds what the seed left`).toBe('1');
  expect(d.end?.count, `the orders page shows exactly 1 order on run ${i + 1}`).toBe(1);
  passed(d);
}

describe('AC2 #580 three runs in a row on one warm stack each start from the seed\'s state', () => {
  it('AC2 three runs each start with no orders and the visit counter at 0, show exactly 1 order, and share one warm stack with a database of their own', async () => {
    const all = await runs(3);
    all.forEach(clean);
    expect(new Set(all.map((d) => d.served.stack)).size, 'one warm stack served all three').toBe(1);
    expect(new Set(all.map((d) => d.served.project)).size, 'one compose project').toBe(1);
    const names = all.map((d) => nameOf(d.app!.database));
    expect(new Set(names).size, `each run had its own database (${names.join(', ')})`).toBe(3);
  }, 1_500_000);

  it('AC2 (wrong program) an environment that keeps one database across runs (DEEP_HUB_PLANT=env-keeps-database) shows 2 orders on the second run and fails environment@1, naming the database', async () => {
    const all = await runs(2, 'env-keeps-database');
    clean(all[0]!, 0);
    expect(all[1]!.end?.count, 'the scenario formed: the second run shows 2 orders').toBe(2);
    const failure = await failureOf(() => clean(all[1]!, 1));
    expect(failure, 'the planted environment passed').not.toBeNull();
    const line = environmentFailures(all[1]!.finished).join(' | ');
    expect(line, 'it fails environment@1').toContain('environment@1');
    expect(line, 'naming the database').toContain(nameOf(all[1]!.app!.database));
  }, 1_500_000);

  it('AC2 (wrong program) an environment that keeps Redis running between runs (DEEP_HUB_PLANT=env-keeps-redis) fails environment@1, naming the service', async () => {
    const all = await runs(2, 'env-keeps-redis');
    expect(all[1]!.start?.visits, 'the scenario formed: the counter carries over').toBeGreaterThan(0);
    const failure = await failureOf(() => clean(all[1]!, 1));
    expect(failure, 'the planted environment passed').not.toBeNull();
    const line = environmentFailures(all[1]!.finished).join(' | ');
    expect(line, 'it fails environment@1').toContain('environment@1');
    expect(line, 'naming the service').toContain('redis');
  }, 1_500_000);
});
