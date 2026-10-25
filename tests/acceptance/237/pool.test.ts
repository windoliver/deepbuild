// #237 AC2: the core's `cpu.slot`, a pool of half the CPU cores, counted as a pool of n and not as one key.
import { availableParallelism } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { Lease, Plant } from '../../../packages/leases/src/index.ts';
import { cleanup, json, session } from './helpers.ts';
import { as, atOnce, granted, openWorld, slot } from './world.ts';

afterEach(cleanup);

async function threeAtOnce(plant?: Plant): Promise<void> {
  const w = await openWorld({ cores: 4, ...(plant ? { plant } : {}) });
  try {
    const cpu = (await w.table.kinds()).find((k) => k.name === 'cpu.slot');
    expect(cpu, 'the core declares cpu.slot').toMatchObject({ name: 'cpu.slot', match: 'pool(2)', plugin: 'core' });
    const [A, B, C] = [session(), session(), session()];
    const results = await atOnce(w.table, [A, B, C].map((h) => ({ caller: as(h), resource: slot('local'), mode: 'exclusive' as const })));
    const grants = results.flatMap((r) => (r.status === 'granted' ? [r.lease] : []));
    expect(grants.length, `three holders asking at once get two leases: ${json(results)}`).toBe(2);
    const third = results.find((r) => r.status !== 'granted')!;
    expect(third.status, `the third is refused: ${json(third)}`).toBe('refused');
    if (third.status !== 'refused') throw Error('unreachable');
    expect(third.reason, 'refused as the pool is full').toBe('pool');
    expect(third.message, 'the refusal names the pool').toContain('cpu.slot');
    expect(third.message, 'the refusal says the pool is full').toMatch(/full/i);
    // One of the two ends (its session ended, and it has no process to prove gone): a request after that is granted.
    const ending: Lease = grants[0]!;
    await w.endSession(ending.holder);
    await w.table.tick();
    expect((await w.table.leases()).map((v) => v.lease.id), 'the ended holder\'s slot is no longer held').not.toContain(ending.id);
    granted(await w.table.lease(as(session()), slot('local'), 'exclusive'), 'a request after one of the two ends');
    // And the pool is full again.
    const again = await w.table.lease(as(session()), slot('local'), 'exclusive');
    expect(again.status === 'refused' && again.reason, `a third slot again: ${json(again)}`).toBe('pool');
  } finally {
    await w.close();
  }
}

describe('AC2 #237.01b91df6 cpu.slot as pool(2)', () => {
  it('AC2 three holders asking at once get two leases and the third is refused naming the pool as full; a request after one of the two ends is granted', async () => {
    await threeAtOnce();
  });
  it('AC2 (wrong program) a table that treats the pool as one exact key refuses the second and fails this test', async () => {
    await expect(threeAtOnce('pool-as-exact-key')).rejects.toThrow(/three holders asking at once get two leases/);
  });
  it('AC2 (wrong program) a table that ignores n grants the third and fails this test', async () => {
    await expect(threeAtOnce('pool-ignores-n')).rejects.toThrow(/three holders asking at once get two leases/);
  });
  it('AC2 (scope) unless told the cores, the core declares cpu.slot as a pool of half this machine\'s cores', async () => {
    const w = await openWorld();
    try {
      const n = Math.max(1, Math.floor(availableParallelism() / 2));
      expect((await w.table.kinds()).find((k) => k.name === 'cpu.slot')).toMatchObject({ match: `pool(${n})`, plugin: 'core' });
    } finally {
      await w.close();
    }
  });
});
