// #3218 AC8 and AC9: the hub's heavy queue, the `lease.wait` that `deep lease [kind...] -- <command>` calls with the
// kinds it names (hub-control.ts; README, The surface under test). The queue is driven in this process on the real
// table and record, as #2122's suite drives it; the peer is this test process, alive throughout, and each command
// takes no job tokens (`jobs: 'none'`), so the job pool doesn't enter. A pool kind's units for a queued command come
// from the hub (`unitsOf`), never from the call (Fields: "have its units named or raised by an agent's call").
import { describe, expect, it } from 'vitest';
import type { HeavyOptions } from '@deepbuild/hub/lease';
import type { LeaseKind, LeaseTable } from '@deepbuild/leases';
import { json, session } from './helpers.ts';
import { appendedFor, as, baseQueueParts, granted, holding, MEM, mem, named, openWorld, queueOn, TEST_PLUGIN } from './world.ts';

const AC8 = '#3218.b4429bec';
const AC9 = '#3218.44836290';

/** The units the hub reads for each queued command of the test: 800 and 100 of the test pool. */
const UNITS: NonNullable<HeavyOptions['unitsOf']> = ({ kind, command }) => (kind === MEM.name ? ({ 'big build': 800, 'small build': 100 } as Record<string, number>)[command] : undefined);

async function firstInLine(plant?: string): Promise<void> {
  const w = await openWorld({ cores: 8 });
  try {
    await w.declare(TEST_PLUGIN, MEM);
    const q = queueOn(w, { unitsOf: UNITS, ...(plant ? { plant } : {}) });
    const HOLDER = session();
    granted(await w.table.lease(as(HOLDER), mem(), 'exclusive', 700), 'the 700 units another session holds');
    const big = await q.join('BIG', ['test.mem'], 'big build');
    expect(big.status, `the waiter for 800 units, with 300 free, waits: ${json(big)}`).toBe('waiting');
    expect(String(big.line), 'its line names the pool').toContain('test.mem');
    const small = await q.join('SMALL', ['test.mem'], 'small build');
    expect(small.status, `a later waiter for 100 units of the same pool waits behind the 800 first in line, though 300 are free: ${json(small)}`).toBe('waiting');
    expect(String(small.line), 'its line names the waiter ahead of it').toContain('session:BIG');
    const none = await q.join('NONE', [], 'other build');
    expect(none.status, `one that needs none of that pool starts: ${json(none)}`).toBe('granted');
    const again = await q.poll(small, 'SMALL');
    expect(again.status, `asked again, the 100 still waits behind the 800: ${json(again)}`).toBe('waiting');
    const waiting = (await holding(w.table)).filter((l) => l.holder === 'session:BIG' || l.holder === 'session:SMALL');
    expect(waiting, 'neither waiter holds a lease while it waits').toEqual([]);
    // The 700 ends: the 800 first in line starts, then the 100 behind it.
    await w.endSession(HOLDER);
    await w.table.tick();
    const bigNow = await q.poll(big, 'BIG');
    expect(bigNow.status, `once the 700 has ended, the 800 first in line starts: ${json(bigNow)}`).toBe('granted');
    const smallNow = await q.poll(small, 'SMALL');
    expect(smallNow.status, `then the 100 behind it starts: ${json(smallNow)}`).toBe('granted');
    const pool = (await holding(w.table)).filter((l) => l.resource.kind === MEM.name).map((l) => [l.holder, l.units]);
    expect(pool, 'the pool holds the 800 and the 100, each with its units').toEqual(expect.arrayContaining([['session:BIG', 800], ['session:SMALL', 100]]));
    expect(pool.length).toBe(2);
  } finally {
    await w.close();
  }
}

describe(`AC8 ${AC8} first in line holds`, () => {
  it(`AC8 ${AC8} with a waiter for 800 units first in line and 300 free, a later waiter for 100 units of the same pool waits behind it, and one that needs none of that pool starts`, async () => {
    await firstInLine();
  });
  it(`AC8 ${AC8} (wrong program) a queue that serves whichever fits starts the later one and fails this test`, async () => {
    await expect(firstInLine('serves-whichever-fits')).rejects.toThrow(/a later waiter for 100 units of the same pool waits behind the 800 first in line/);
  });
});

const EXACT = (name: string): LeaseKind => ({ name, match: 'exact', cap: 1000, cooldown: 0, cost: 0 });

/** `deep lease test.first test.second -- <command>` while another session holds test.second; four asks, a second's polling. */
async function twoKinds(onBase: boolean): Promise<void> {
  const w = await openWorld({ cores: 8 });
  try {
    let table: LeaseTable = w.table;
    let q;
    if (onBase) {
      const parts = await baseQueueParts(w.record, w.clock.now);
      table = parts.table;
      for (const name of ['test.first', 'test.second']) await table.declare(TEST_PLUGIN, EXACT(name));
      q = queueOn({ ...w, table }, { base: parts.HeavyQueue });
    } else {
      for (const name of ['test.first', 'test.second']) await w.declare(TEST_PLUGIN, EXACT(name));
      q = queueOn(w);
    }
    const OTHER = session();
    granted(await table.lease(as(OTHER), { host: 'local', kind: 'test.second', key: 'test.second' }, 'exclusive'), 'another session\'s lease on test.second');
    let reply = await q.join('MINE', ['test.first', 'test.second'], 'two-kind build');
    for (let i = 0; i < 3; i++) reply = await q.poll(reply, 'MINE');
    expect(reply.status, `the command waits for test.second: ${json(reply)}`).toBe('waiting');
    const mine = await appendedFor(w.record, 'session:MINE');
    if (onBase) {
      const first = (kind: string) => mine.filter((e) => e.kind === kind && (e.data as { resource?: { kind?: string } }).resource?.kind === 'test.first');
      expect(first('lease.acquired').length, `on the merge base it appends a grant of test.first: ${named(mine)}`).toBeGreaterThan(0);
      expect(first('lease.released').length, `and a release of it: ${named(mine)}`).toBeGreaterThan(0);
      return;
    }
    expect(mine, `\`deep lease\` with two kinds, the second held by another session, appends no grant for the first, but appended: ${named(mine)}`).toEqual([]);
    expect(String(reply.line), 'its line names the kind it waits for').toContain('test.second');
    expect(String(reply.line), 'and who holds it').toContain(OTHER);
    // The second ends: the command gets every kind in one ask.
    await w.endSession(OTHER);
    await w.table.tick();
    const now = await q.poll(reply, 'MINE');
    expect(now.status, `once test.second is free, the command starts: ${json(now)}`).toBe('granted');
    const held = (await holding(w.table)).filter((l) => l.holder === 'session:MINE').map((l) => l.resource.kind).sort();
    expect(held, 'it holds its cpu.slot and both kinds').toEqual(['cpu.slot', 'test.first', 'test.second']);
    const after = await appendedFor(w.record, 'session:MINE');
    expect(after.filter((e) => e.kind === 'lease.released'), `and nothing of it was released: ${named(after)}`).toEqual([]);
    expect(after.filter((e) => e.kind === 'lease.acquired').length, `three grants, one per lease: ${named(after)}`).toBe(3);
  } finally {
    await w.close();
  }
}

describe(`AC9 ${AC9} \`deep lease\` takes the kinds it names in one ask`, () => {
  it(`AC9 ${AC9} \`deep lease\` with two kinds, the second held by another session, appends no grant for the first`, async () => {
    await twoKinds(false);
  });
  it(`AC9 ${AC9} (the merge base) on the merge base it appends a grant and a release`, async () => {
    await twoKinds(true);
  });
});
