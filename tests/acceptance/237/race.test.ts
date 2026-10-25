// #237 AC9: a grant is one append, decided on the log state it read, with no await between the read and the
// append (design: Budget). The port kind's free check (the probe env-local runs before a port is leased) is the
// test's own, held open until all three requests for port 5173 are in, then released in each of the six orders,
// all in one turn of the event loop.
import { afterEach, describe, expect, it } from 'vitest';
import type { Plant } from '../../../packages/leases/src/index.ts';
import { cleanup, held, json, permutations, session, sleep, within, type Held } from './helpers.ts';
import { acquiredFor, as, ENV_LOCAL, granted, openWorld, port, PORT, refusedNaming } from './world.ts';

afterEach(cleanup);

async function race(order: number[], plant?: Plant): Promise<void> {
  const w = await openWorld(plant ? { plant } : {});
  try {
    const probes: { key: string; open: Held<boolean> }[] = [];
    await w.table.declare(ENV_LOCAL, PORT, (key: string) => {
      const open = held<boolean>();
      probes.push({ key, open });
      return open.promise;
    });
    const holders = [session(), session(), session()];
    const pending = holders.map((h) => w.table.lease(as(h), port('local'), 'exclusive'));
    for (const deadline = Date.now() + 5000; probes.length < 3 && Date.now() < deadline;) await sleep(5);
    expect(probes.length, 'each of the three requests asks the port probe, none held behind another\'s probe').toBe(3);
    expect(probes.map((p) => p.key), 'the probe is asked about port 5173').toEqual(['5173', '5173', '5173']);
    expect(await within(Promise.race(pending), 50), 'no request is decided while its probe is open').toBe('pending');
    for (const i of order) probes[i]!.open.resolve(true);
    const results = await within(Promise.all(pending), 5000);
    if (results === 'pending') throw Error('the requests were not decided within 5 s of their probes answering');
    const grants = results.flatMap((r) => (r.status === 'granted' ? [r.lease] : []));
    expect(grants.length, `exactly one of three requests for port 5173 is granted: ${json(results)}`).toBe(1);
    const winner = granted(results.find((r) => r.status === 'granted')!, 'the one grant');
    for (const r of results) if (r !== results.find((x) => x.status === 'granted')) refusedNaming(r, winner, 'a request that lost the race');
    expect((await acquiredFor(w, winner)).length, 'one lease.acquired for port 5173').toBe(1);
    expect((await w.events('lease.acquired')).filter((e) => json(e.data).includes('"5173"')).length, 'no other lease.acquired for port 5173').toBe(1);
  } finally {
    await w.close();
  }
}

describe('AC9 #237.7ebfc24e three requests for port 5173 with the probe held open', () => {
  for (const order of permutations([0, 1, 2])) {
    it(`AC9 released in the order ${order.map((i) => i + 1).join(', ')}: exactly one is granted`, async () => {
      await race(order);
    });
  }
  it('AC9 (wrong program) a table that awaits between its check and its append grants two and fails this test', async () => {
    await expect(race([0, 1, 2], 'await-before-append')).rejects.toThrow(/exactly one of three requests for port 5173 is granted/);
  });
});
