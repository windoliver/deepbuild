// #237 AC1, AC8 and AC12: overlap on an exact kind (the port kind, as env-local declares it), the mode of both
// leases, and hosts that never overlap. Each scenario runs on the table as it ships and on the planted wrong
// program its criterion names (README, Wrong programs).
import { afterEach, describe, expect, it } from 'vitest';
import type { Plant } from '../../../packages/leases/src/index.ts';
import { cleanup, json, session } from './helpers.ts';
import { acquiredFor, as, ENV_LOCAL, granted, openWorld, port, PORT, refusedNaming, slot } from './world.ts';

afterEach(cleanup);

async function exactOverlap(plant?: Plant): Promise<void> {
  const w = await openWorld(plant ? { plant } : {});
  try {
    await w.table.declare(ENV_LOCAL, PORT);
    const [A, B, C, D] = [session(), session(), session(), session()];
    const a = granted(await w.table.lease(as(A), port('local', '5173'), 'exclusive'), "A's exclusive lease on port 5173");
    expect(a.holder).toBe(A);
    expect(a.mode).toBe('exclusive');
    expect(a.resource).toEqual({ host: 'local', kind: 'port', key: '5173' });
    refusedNaming(await w.table.lease(as(B), port('local', '5173'), 'exclusive'), a, "B's exclusive lease on A's key");
    refusedNaming(await w.table.lease(as(B), port('local', '5173'), 'shared'), a, "B's shared lease on A's key");
    const b = granted(await w.table.lease(as(B), port('local', '5174'), 'exclusive'), "B's lease on another key, 5174");
    const c = granted(await w.table.lease(as(C), port('local', '5175'), 'shared'), "C's shared lease on 5175");
    const d = granted(await w.table.lease(as(D), port('local', '5175'), 'shared'), "the second shared lease on 5175, D's");
    // One table, and it is the record's: each grant is a lease.acquired, and the table shows each lease held.
    for (const lease of [a, b, c, d]) expect((await acquiredFor(w, lease)).length, `lease.acquired for ${json(lease)}`).toBeGreaterThanOrEqual(1);
    const shown = (await w.table.leases()).map((v) => v.lease.id);
    for (const lease of [a, b, c, d]) expect(shown, `the table shows ${lease.holder}'s lease`).toContain(lease.id);
  } finally {
    await w.close();
  }
}

describe('AC1 #237.acb97f9b overlap on an exact kind', () => {
  it('AC1 with A holding an exclusive lease, B is refused on the same key naming A\'s lease and granted on another key; two shared leases on one key are both granted', async () => {
    await exactOverlap();
  });
  it('AC1 (wrong program) a table that ignores the mode refuses the second shared lease and fails this test', async () => {
    await expect(exactOverlap('ignores-mode')).rejects.toThrow(/the second shared lease on 5175/);
  });
});

async function sharedThenExclusive(plant?: Plant): Promise<void> {
  const w = await openWorld(plant ? { plant } : {});
  try {
    await w.table.declare(ENV_LOCAL, PORT);
    const [A, B, C] = [session(), session(), session()];
    const a = granted(await w.table.lease(as(A), port('local', '5173'), 'shared'), "A's shared lease on port 5173");
    refusedNaming(await w.table.lease(as(B), port('local', '5173'), 'exclusive'), a, "B's exclusive lease on A's shared lease");
    // Not a table that refuses everything on a held key: a second shared lease is granted.
    granted(await w.table.lease(as(C), port('local', '5173'), 'shared'), "C's shared lease beside A's");
  } finally {
    await w.close();
  }
}

describe('AC8 #237.f102d9a8 the held lease\'s mode and the requested one both count', () => {
  it('AC8 with A holding a shared lease on port 5173, B\'s exclusive lease on it is refused, naming A\'s lease', async () => {
    await sharedThenExclusive();
  });
  it('AC8 (wrong program) a table that checks only the held lease\'s mode grants it and fails this test', async () => {
    await expect(sharedThenExclusive('checks-held-mode-only')).rejects.toThrow(/B's exclusive lease on A's shared lease/);
  });
});

async function portsOnTwoHosts(plant?: Plant): Promise<void> {
  const w = await openWorld(plant ? { plant } : {});
  try {
    await w.table.declare(ENV_LOCAL, PORT);
    const [A, B, C] = [session(), session(), session()];
    const a = granted(await w.table.lease(as(A), port('local'), 'exclusive'), "A's exclusive lease on port 5173 on local");
    const b = granted(await w.table.lease(as(B), port('h2'), 'exclusive'), "B's exclusive lease on port 5173 on h2");
    expect(b.resource.host).toBe('h2');
    // Each host's key still overlaps on that host.
    refusedNaming(await w.table.lease(as(C), port('local'), 'exclusive'), a, "C's exclusive lease on port 5173 on local");
    refusedNaming(await w.table.lease(as(C), port('h2'), 'exclusive'), b, "C's exclusive lease on port 5173 on h2");
  } finally {
    await w.close();
  }
}

async function poolOnTwoHosts(plant?: Plant): Promise<void> {
  const w = await openWorld({ cores: 4, ...(plant ? { plant } : {}) });
  try {
    const cpu = (await w.table.kinds()).find((k) => k.name === 'cpu.slot');
    expect(cpu?.match, 'cpu.slot is declared as pool(2) on a 4-core machine').toBe('pool(2)');
    const [A, B, C, D, E] = [session(), session(), session(), session(), session()];
    granted(await w.table.lease(as(A), slot('local'), 'exclusive'), 'the first lease on local');
    granted(await w.table.lease(as(C), slot('h2'), 'exclusive'), 'the first lease on h2');
    granted(await w.table.lease(as(D), slot('h2'), 'exclusive'), 'the second lease on h2');
    granted(await w.table.lease(as(B), slot('local'), 'exclusive'), 'the second lease on local');
    const third = await w.table.lease(as(E), slot('local'), 'exclusive');
    expect(third.status, `a third lease on local: ${json(third)}`).toBe('refused');
    if (third.status !== 'refused') throw Error('unreachable');
    expect(third.reason, 'refused as the pool is full').toBe('pool');
    expect(third.message, 'the refusal names the pool').toContain('cpu.slot');
    expect(third.message, 'the refusal names the pool on local').toContain('local');
    expect(third.message, 'the refusal says the pool is full').toMatch(/full/i);
    expect(third.holders.every((l) => l.resource.host === 'local'), `only local's leases fill local's pool: ${json(third.holders)}`).toBe(true);
  } finally {
    await w.close();
  }
}

describe('AC12 #237.eb9f1f5f leases on two hosts never overlap', () => {
  it('AC12 with A holding an exclusive lease on port 5173 on local, B\'s exclusive lease on port 5173 on h2 is granted', async () => {
    await portsOnTwoHosts();
  });
  it('AC12 with cpu.slot declared as pool(2), two leases on each host are granted and a third on local is refused, naming the pool on local', async () => {
    await poolOnTwoHosts();
  });
  it('AC12 (wrong program) a table that leaves the host out of the key refuses B and fails this test', async () => {
    await expect(portsOnTwoHosts('host-blind')).rejects.toThrow(/B's exclusive lease on port 5173 on h2/);
  });
  it('AC12 (wrong program) a table that counts the pool across hosts refuses the second lease on h2 and fails this test', async () => {
    await expect(poolOnTwoHosts('pool-across-hosts')).rejects.toThrow(/the second lease on h2/);
  });
});
