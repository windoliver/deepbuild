// #3218 AC4: an ask names several resources and is granted whole or refused whole, decided on one read of the log and
// appended together or not at all (design: Lease, Budget). The pool's read of what is free is its kind's free check,
// the `free` argument of `declare`, which the table asks before it grants a pool's lease; the race holds it open until
// both asks are in, then answers both in one turn of the event loop, in each order (design: Budget, "Tests hold every
// probe and price lookup open until all competing requests are in, then release them in every order").
import { describe, expect, it } from 'vitest';
import type { Need, Plant } from '@deepbuild/leases';
import { held, json, permutations, session, sleep, within, type Held } from './helpers.ts';
import { appendedFor, as, granted, grantedAsk, holding, MEM, mem, named, openWorld, slot, TEST_PLUGIN, unitsOf } from './world.ts';

const AC4 = '#3218.fe1eb34b';
const ASK: Need[] = [{ resource: slot(), mode: 'exclusive' }, { resource: mem(), mode: 'exclusive', units: 600 }];

async function noRoom(plant?: Plant): Promise<void> {
  const w = await openWorld({ cores: 8, ...(plant ? { plant } : {}) });
  try {
    await w.declare(TEST_PLUGIN, MEM);
    granted(await w.table.lease(as(session()), mem(), 'exclusive', 500), 'the 500 units another holds');
    const before = (await w.events()).length;
    const L = session();
    const r = await w.table.ask(as(L), ASK);
    const appended = (await w.events()).slice(before);
    expect(appended, `an ask for one cpu.slot and 600 units, with 500 free, appends nothing, but appended: ${named(appended)}`).toEqual([]);
    expect(r.status, `it grants neither: ${json(r)}`).toBe('refused');
    if (r.status !== 'refused') throw Error('unreachable');
    expect(r.reason, 'refused as the pool has no room').toBe('pool');
    expect(r.resource, 'it names the first resource that couldn\'t be granted: the pool').toEqual(mem());
    expect(r.message, 'its words name the pool').toContain('test.mem');
    expect((await holding(w.table)).filter((l) => l.holder === L), 'the asker holds neither').toEqual([]);
  } finally {
    await w.close();
  }
}

async function race(order: number[], plant?: Plant): Promise<void> {
  const w = await openWorld({ cores: 8, ...(plant ? { plant } : {}) });
  try {
    const reads: Held<boolean>[] = [];
    await w.declare(TEST_PLUGIN, MEM, () => {
      const open = held<boolean>();
      reads.push(open);
      return open.promise;
    });
    const holders = [session(), session()];
    const pending = holders.map((h) => w.table.ask(as(h), ASK));
    for (const deadline = Date.now() + 10_000; reads.length < 2 && Date.now() < deadline;) await sleep(5);
    expect(reads.length, 'each of the two asks reads the pool, neither held behind the other\'s read').toBe(2);
    expect(await within(Promise.race(pending), 50), 'no ask is decided while its read is open').toBe('pending');
    for (const i of order) reads[i]!.resolve(true);
    const results = await within(Promise.all(pending), 10_000);
    if (results === 'pending') throw Error('the asks were not decided within 10 s of their reads answering');
    const winners = results.flatMap((r, i) => (r.status === 'granted' ? [i] : []));
    expect(winners.length, `exactly one of the two asks, of which one fits, is granted: ${json(results)}`).toBe(1);
    const [win] = winners;
    const lose = 1 - win!;
    const loser = results[lose]!;
    const lost = await appendedFor(w.record, holders[lose]!);
    expect(lost, `the losing ask appends nothing, but appended: ${named(lost)}`).toEqual([]);
    expect(loser.status === 'refused' && loser.resource, `the loser is refused, naming the pool: ${json(loser)}`).toEqual(mem());
    const leases = grantedAsk(results[win!]!, 2, 'the winning ask');
    expect(leases.map((l) => [l.resource.kind, unitsOf(l)]), 'the winner holds its cpu.slot and its 600 units').toEqual([['cpu.slot', 1], ['test.mem', 600]]);
    const won = await appendedFor(w.record, holders[win!]!);
    expect(won.filter((e) => e.kind === 'lease.acquired').length, `the winner's two leases are in the record: ${named(won)}`).toBe(2);
    expect(won.filter((e) => e.kind === 'lease.released'), 'and none of them is released').toEqual([]);
  } finally {
    await w.close();
  }
}

describe(`AC4 ${AC4} an ask for several resources is granted whole or refused whole`, () => {
  it(`AC4 ${AC4} an ask for one cpu.slot and 600 units, with 500 free, grants neither and appends nothing`, async () => {
    await noRoom();
  });
  for (const order of permutations([0, 1])) {
    it(`AC4 ${AC4} with the read held open until two such asks are in, of which one fits, released in the order ${order.map((i) => i + 1).join(', ')}: exactly one is granted`, async () => {
      await race(order);
    });
  }
  it(`AC4 ${AC4} (wrong program) a table that takes them one at a time appends a grant and a release for the ask that doesn't fit, and fails this test naming the events`, async () => {
    await expect(noRoom('one-kind-at-a-time')).rejects.toThrow(/appends nothing, but appended: lease\.acquired@\d.*lease\.released@\d/);
  });
  it(`AC4 ${AC4} (wrong program) a table that takes them one at a time appends a grant and a release for the loser of the race, and fails this test naming the events`, async () => {
    await expect(race([0, 1], 'one-kind-at-a-time')).rejects.toThrow(/the losing ask appends nothing, but appended: lease\.acquired@\d.*lease\.released@\d/);
  });
});
